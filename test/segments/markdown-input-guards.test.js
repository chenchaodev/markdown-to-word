// @ts-check
/**
 * markdown 解析层的输入守卫(pdf 不可信 TeX 闸门 + 批注语法放弃/转义分支)。
 *
 * 被测:
 * - src/core/pdf/render.ts guardUntrustedMath —— inline / block 两条渲染规则包装
 *   与 reject 文案;
 * - src/core/pdf/rules/equation.ts wrapMathBlockRenderer —— 编号容器包装;
 * - src/core/resource-limits.ts hasUntrustedTexCommand —— 双管线共用的不可信
 *   TeX 判定单源;
 * - src/core/markdown/comment.ts tokenizeComment 状态机的放弃/转义分支 +
 *   exitComment / parseInlinePhrasing。
 *
 * 为什么把两件事放一段:它们是同一类问题——**不可信 / 不合法输入在解析期如何处置**。
 * 公式侧:KaTeX 在 trust=false 下只把 \href / \includegraphics 渲染成红色 mstyle
 * (不抛错、不进 katex-error 通道),故 pdf 侧必须在交给插件之前显式拦截,才能与
 * docx 侧(segments/math-structures.test.js 断言)产出同一降级形态;批注侧:扫描器
 * 遇到行尾 / 关键字失配就放弃,整段回退既有解析,绝不静默吞内容。
 *
 * 全部经公开转换管线 `convert(md, "pdf" | "docx")` 驱动,断言命中 PDF HTML 与
 * word/document.xml、word/comments.xml 的具体产物,不直接 import 内部函数。
 */

/** @typedef {import("../../src/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../src/core/i18n.js").ConvertWarning} ConvertWarning */

import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { unzipPart, zipContains } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { asPdfArtifact, docxBufferOf, pdfHtmlOf } from "../common/convert-helpers.js";
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";

// 本段只断言输入守卫的产物形态,不产出人工实测样例(公式常规渲染由
// segments/formula.test.js、segments/eq-numbering.test.js,常规批注由
// segments/comments.test.js 承担),显式声明无样例。
export const fixtures = null;

/** 不可信 TeX 的降级容器与说明文案(pdf/render.ts guardUntrustedMath reject) */
const UNTRUSTED_SPAN_OPEN =
  '<span class="katex-error" title="公式含不受信任的外部引用指令,已按源码显示">';

/**
 * 单篇 md → PDF HTML + 格式化后的警告文案(公开管线的唯一入口)。
 * @param {string} md markdown 文本
 * @param {string} title 文档标题
 * @returns {Promise<{ html: string; warns: string[] }>} PDF HTML 与警告文案
 */
async function renderPdf(md, title) {
  /** @type {ConvertWarning[]} */
  const warnings = [];
  const artifact = /** @type {ConvertArtifact} */ (
    await convert(md, "pdf", { baseDir: FIXTURES_DIR, title, warnings, katexDir: KATEX_DIR })
  );
  return { html: pdfHtmlOf(artifact), warns: warnings.map((w) => formatWarning(w)) };
}

/**
 * 单篇 md → document.xml / comments.xml / docx 字节(公开管线的唯一入口)。
 * @param {string} md markdown 文本
 * @returns {Promise<{ buffer: Buffer; document: string; comments: string | null }>} docx 产物与其两个 XML 部件
 */
async function renderDocxParts(md) {
  const artifact = /** @type {ConvertArtifact} */ (
    await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings: [] })
  );
  const buffer = docxBufferOf(artifact);
  return {
    buffer,
    document: await unzipPart(buffer, "word/document.xml"),
    comments: zipContains(buffer, "word/comments.xml")
      ? await unzipPart(buffer, "word/comments.xml")
      : null,
  };
}

/**
 * 断言文本同时命中全部 needle。
 * @param {string} text 被检文本(PDF HTML 或 docx XML 部件)
 * @param {string[]} needles 必须出现的片段
 * @param {string} label 失败标签
 */
function expectPresent(text, needles, label) {
  const missing = needles.filter((n) => !text.includes(n));
  if (missing.length > 0) {
    throw new Error(`解析层输入守卫断言失败:${label} —— 缺少 ${missing.join(" / ")}`);
  }
}

/**
 * 断言文本不含任何 needle(命中即红)。
 * @param {string} text 被检文本
 * @param {string[]} needles 禁止出现的片段
 * @param {string} label 失败标签
 */
function expectAbsent(text, needles, label) {
  const hit = needles.filter((n) => text.includes(n));
  if (hit.length > 0) {
    throw new Error(`解析层输入守卫断言失败:${label} —— 不应出现 ${hit.join(" / ")}`);
  }
}

export async function run() {
  // ================= 一、pdf 不可信 TeX 闸门 =================

  // ---------- 行内不可信 TeX → katex-error 降级容器,URL 不变成链接 ----------
  const inlineUntrusted = await renderPdf("行内 $\\href{http://example.com/a}{y}$ 与正常 $a^b$。\n", "输入守卫");
  expectPresent(
    inlineUntrusted.html,
    [UNTRUSTED_SPAN_OPEN + "\\href{http://example.com/a}{y}</span>", 'class="katex"'],
    "行内不可信 TeX 降级 + 同段正常公式照常渲染",
  );
  // 外部引用只作为源码文本出现:不得产出可点击链接(否则等于放行外链),
  // 也不得留下 KaTeX「红色 mstyle」痕迹(说明闸门没拦住,降级走了另一条通道)
  expectAbsent(
    inlineUntrusted.html,
    ['href="http://example.com/a"', "<m:mstyle"],
    "行内不可信 TeX 不得产出链接 / KaTeX 红色 mstyle 痕迹",
  );
  if (inlineUntrusted.warns.length > 0) {
    throw new Error(
      `解析层输入守卫断言失败:不可信 TeX 是既定降级形态,不应追加警告,实际 ${JSON.stringify(inlineUntrusted.warns)}`,
    );
  }
  console.log("[ok] PDF 行内不可信 TeX(\\href)→ katex-error 降级容器 + 源码文本,零警告、无外链");

  // ---------- display 不可信 TeX → 同样降级,且仍占公式编号 ----------
  // 闸门只改渲染形态,不改变编号语义(公式仍是一个编号位),与 docx 侧一致。
  const blockUntrusted = await renderPdf("$$\n\\includegraphics{logo.png}\n$$\n", "输入守卫");
  expectPresent(
    blockUntrusted.html,
    [
      'class="eq-block"',
      UNTRUSTED_SPAN_OPEN + "\\includegraphics{logo.png}",
      '<span class="eq-num">(1)</span>',
    ],
    "display 不可信 TeX 降级",
  );
  expectAbsent(blockUntrusted.html, ['src="logo.png"'], "不可信 TeX 不得让外部图片进入产物");
  console.log("[ok] PDF display 不可信 TeX(\\includegraphics)→ 同样降级,仍占编号 (1),不引入外部图片");

  // ---------- 正常 display 公式 → eq-block 包装 + eq-num 编号 ----------
  // 锁住 pdf 侧对 @mdit/plugin-katex 原 math_block 规则的包装(编号容器 + 编号文本)。
  const numbered = await renderPdf("$$\nE = mc^2\n$$\n\n行内 $a+b$。\n", "输入守卫");
  expectPresent(
    numbered.html,
    ['<div class="eq-block">', '<span class="eq-num">(1)</span>', 'class="katex-display"', '<span class="katex">'],
    "正常公式编号包装",
  );
  expectAbsent(numbered.html, ["katex-error"], "正常公式不应命中 katex-error 降级");
  console.log("[ok] PDF 正常 display 公式 → <div class=\"eq-block\"> + <span class=\"eq-num\">(1)</span>");

  // ================= 二、批注语法放弃 / 转义分支 =================
  // 常规批注(锚定/内容/多批注 id 唯一/author)由 segments/comments.test.js 覆盖;
  // 本段专打**放弃分支与转义分支**——它们决定「哪些看似批注的写法会被静默吞掉」。

  // ---------- 转义分支:锚定文本内的 `\]` / `\[` ----------
  // 期望:反斜杠被扫描器吃掉,锚定文本按字面成文「锚定]文本」,批注结构完整
  // (commentRangeStart/End + Reference + comments.xml 里的批注内容)。
  const escaped = await renderDocxParts("正文[锚定\\]文本]{批注=内容A}与[另一\\[锚]{批注=内容B}后续。\n");
  if (escaped.comments === null) {
    throw new Error("解析层输入守卫断言失败:转义锚定的批注未产出 comments.xml 部件");
  }
  expectPresent(
    escaped.document,
    [
      '<w:commentRangeStart w:id="1"/>',
      '<w:commentRangeEnd w:id="1"/>',
      '<w:commentReference w:id="1"/>',
      // 反斜杠不落文(扫描器在 scanAnchorEscaped 消费掉)
      '<w:t xml:space="preserve">锚定]文本</w:t>',
      '<w:t xml:space="preserve">另一[锚</w:t>',
      '<w:commentRangeStart w:id="2"/>',
    ],
    "转义锚定的批注结构与锚定文本",
  );
  expectAbsent(escaped.document, ["\\]文本", "\\[锚"], "锚定文本里的反斜杠不应落文");
  expectPresent(escaped.comments, ["内容A", "内容B"], "转义锚定的批注内容");
  console.log("[ok] docx 批注转义锚定(锚定文本内 \\] / \\[):反斜杠被消费 + 锚定文本按字面成文 + 批注内容齐全");

  // ---------- 放弃分支:批注内容含行尾 ----------
  // scanContent 遇行尾放弃 → 整段按普通文本落文,**不得**产生任何批注结构
  // (静默吞掉内容是最坏的失败形态,故此处正向断言「回退为普通文本」)。
  const contentBreak = await renderDocxParts("正文[锚定]{批注=跨行\n内容B}后续。\n");
  expectAbsent(
    contentBreak.document,
    ["<w:commentRangeStart", "<w:commentReference"],
    "批注内容含行尾应整段回退普通文本",
  );
  expectPresent(contentBreak.document, ["正文[锚定]{批注=跨行", "内容B}后续。"], "回退后原文按字面落文");

  // ---------- 放弃分支:锚定文本跨行 ----------
  // scanAnchor 遇行尾放弃(与内容跨行同理),回退普通文本。
  const anchorBreak = await renderDocxParts("正文[锚定\n续行]{批注=内容C}后续。\n");
  expectAbsent(anchorBreak.document, ["<w:commentRangeStart", "<w:commentReference"], "锚定跨行应整段回退普通文本");
  expectPresent(anchorBreak.document, ["正文[锚定"], "回退后原文按字面落文");

  // ---------- 放弃分支:关键字不匹配 → 交回既有解析(链接等) ----------
  // `[锚定]{批注文x=x}`:scanKeyword 在第二个字符失配 → nok,按普通文本;
  // `[锚定](https://example.com)`:关键字分支不命中 → 链接照常解析。
  const keywordMiss = await renderDocxParts("正文[锚定]{批注文x=内容D}与[链接](https://example.com)后续。\n");
  expectAbsent(keywordMiss.document, ["<w:commentRangeStart", "<w:commentReference"], "关键字失配不应产生批注");
  expectPresent(keywordMiss.document, ["{批注文x=内容D}"], "关键字失配后原文按字面落文");
  const link = await renderDocxParts("正文[锚定](https://example.com)后续。\n");
  expectAbsent(link.document, ["<w:commentRangeStart"], "链接不应被误判为批注");
  expectPresent(link.document, ["<w:hyperlink", "锚定"], "链接照常解析为超链接");
  console.log("[ok] docx 批注内容/锚定跨行与关键字失配 → 放弃批注解析,原文与链接解析不受影响");

  // ---------- pdf 路线:批注语法不解析,原样输出 ----------
  const commentPdfHtml = (await renderPdf("正文[锚定]{批注=内容E}后续。\n", "输入守卫")).html;
  expectPresent(commentPdfHtml, ["[锚定]{批注=内容E}"], "pdf 路线原样输出批注语法");
  expectAbsent(commentPdfHtml, ["katex-error"], "pdf 路线不应因批注语法报错");
  console.log("[ok] PDF 路线:批注语法原样输出(不解析)");

  // ================= 落盘产物(供人工核对) =================
  const pdfArtifact = /** @type {ConvertArtifact} */ (
    await convert("$$\nE = mc^2\n$$\n\n行内 $\\href{http://example.com/a}{y}$。\n", "pdf", {
      baseDir: FIXTURES_DIR,
      title: "输入守卫",
      warnings: [],
      katexDir: KATEX_DIR,
    })
  );
  const pdfBinary = await htmlToPdf(pdfHtmlOf(pdfArtifact), asPdfArtifact(pdfArtifact).footerTemplate);
  await saveArtifact("markdown-input-guards", { docx: escaped.buffer, pdf: pdfBinary });
}
