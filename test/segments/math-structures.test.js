// @ts-check
/**
 * docx 公式结构矩阵 + 容器内降级(被测:src/core/docx/handlers/math.ts
 * texToDocxMath / parseMathMl / walk / structured / textToRuns、
 * src/core/docx/handlers/equations.ts renderDisplayMath / renderContainerMath /
 * mathBody、
 * src/core/docx/handlers/fallback.ts renderContainerFallback /
 * fallbackTextParagraph / unsupportedBlockWarning、
 * src/core/docx/ctx.ts formulaParseFailedWarning、
 * src/core/resource-limits.ts hasUntrustedTexCommand、
 * src/core/docx/handlers/inline-html.ts renderInlineHtmlParagraph)。
 *
 * 全部经公开转换管线 `convert(md, "docx")` 驱动,断言命中 word/document.xml 的
 * 具体 OOXML 产物(公式节点 / 编号 / 降级样式 / 警告文案),不直接 import 内部
 * 函数——这些 handler 是纯函数,但它们的契约是「产物长什么样」,测实现细节将来
 * 重构即假绿。
 *
 * 第一部分:公式结构映射与整式降级。覆盖面对照 KaTeX 0.18.1 的 MathML 产物
 * (displayMode 开启与否产物结构不同,本段逐条锁定两条路径):
 * - mroot(`\sqrt[3]{x}`)→ MathRadical(degree) → <m:rad><m:deg>;
 * - mover(`\overline{AB}`)→ MathLimitUpper → <m:limUpp>;munder(`\underline{x}`)
 *   → MathLimitLower → <m:limLow>;
 * - mspace(`\pmod{n}`,含自闭合标签)→ 跳过,公式其余部分照常成文;
 * - mtext(`\text{中文}`)→ 文本叶;
 * - 未覆盖节点(mtable / menclose / mstyle / mphantom)→ 整式降级为 TeX 源码
 *   等宽灰字(Consolas + w:color 888888)+「公式解析失败,降级为 TeX 源码」警告;
 * - 不可信 TeX(`\href` / `\includegraphics`;KaTeX trust=false 只把这类命令渲染成
 *   红色 mstyle)→ 渲染层提前拦截(单源 hasUntrustedTexCommand),同样整式降级,
 *   且外部引用绝不进产物(不产出 w:hyperlink);
 * - katex-error(throwOnError:false 下的解析失败产物)→ 整式降级。
 *
 * displayMode 双路径(核心断言,两向都锁,防「一律改 display」的过度修复):
 * display 公式 `$$..$$`(mdast `math` 节点)→ 大运算符上下限走 <munderover>/
 * <munder>(∑ → <m:nary>、\lim → <m:limLow>);同一 TeX 写在行内 `$..$`
 * (mdast `inlineMath` 节点)→ 走 <msubsup>/<m:sub>(<m:sSubSup>/<m:sSub>)。
 * display ∑ 的 <m:e> 内必须是被加数(MathSum.children 即 m:e,必填;传空数组
 * 得空基 → WPS 显示方框 □),另断「只消费紧邻一个兄弟」与「无被加数则整式降级」;
 * 行内同 TeX 走 <msubsup>/<m:sSubSup>(<m:e> 装运算符本身,非空,形态不变)。
 * 判定单源在 texToDocxMath 的 displayMode 入参(真值来源 = mdast 节点类型),
 * 本段按「display 产 nary/limLow 且无 sSubSup」与「行内产 sSubSup/sSub 且无
 * nary/limLow」两侧成对断言。
 *
 * 第二部分:列表项 / 引用块内块级内容。
 * 公式:容器内 display 公式走与顶层同一条 Office MathML 管线(分式成 <m:f>;
 * displayMode 仍为 true;不编号、不排 5a 制表位),仅 KaTeX 真解析失败才降级
 * TeX 源码等宽灰字 + 公式降级警告——该兜底是公式自身的能力降级,与
 * 「容器支不支持」是两回事,单独钉住。
 * html / 表格:三条降级路径 + 三条「不该降级」的旁路全部钉在产物上:
 * - 表格 → 逐行文本段落(单元格纯文本以「 | 」连接),不成 <w:tbl>;
 * - 非白名单 html → 原文(XML 转义)等宽灰字 + 「HTML 在…」;
 * - `<!-- page-break -->` → 照常分页,不产警告;
 * - 白名单行内标签(<br>)→ 照常按正文 5a 排版成段,不产警告;
 * - 同一容器同类降级经 warnDedup 去重(同类型同容器只报一次)。
 */

/** @typedef {import("../../src/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../src/core/i18n.js").ConvertWarning} ConvertWarning */

import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { docxBufferOf } from "../common/convert-helpers.js";
import { FIXTURES_DIR } from "../common/paths.js";

// 本段只断言公式结构与容器内降级的产物形态,不产出人工实测样例(公式常规渲染与
// 列表/引用块常规排版分别由 segments/formula.test.js、segments/eq-numbering.test.js、
// segments/basic-render.test.js 承担),显式声明无样例。
export const fixtures = null;

/** 降级样式的两个权威 needle:CODE_FONT=Consolas + MUTED_TEXT_GRAY=888888 */
const MONO_GRAY_FONT = "Consolas";
const MONO_GRAY_COLOR = '<w:color w:val="888888"/>';
/** 容器内降级警告的固定文案(见 fallback.ts unsupportedBlockWarning) */
const UNSUPPORTED_IN_CONTAINER = "暂不支持,已降级为文本";
/** 公式整式降级警告的固定文案(见 ctx.ts formulaParseFailedWarning) */
const FORMULA_DEGRADED = "公式解析失败,降级为 TeX 源码";

/**
 * 单篇 md → document.xml + 格式化后的警告文案(公开管线的唯一入口)。
 * @param {string} md markdown 文本
 * @returns {Promise<{ xml: string; warns: string[] }>} 产物 XML 与警告文案
 */
async function renderDocxXml(md) {
  /** @type {ConvertWarning[]} */
  const warnings = [];
  const artifact = /** @type {ConvertArtifact} */ (
    await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings })
  );
  return {
    xml: await unzipPart(docxBufferOf(artifact), "word/document.xml"),
    warns: warnings.map((w) => formatWarning(w)),
  };
}

/**
 * 断言产物 XML 同时命中全部 needle。
 * @param {string} xml document.xml
 * @param {string[]} needles 必须出现的片段
 * @param {string} label 失败标签
 */
function expectPresent(xml, needles, label) {
  const missing = needles.filter((n) => !xml.includes(n));
  if (missing.length > 0) {
    throw new Error(`docx 公式/容器降级断言失败:${label} —— document.xml 缺少 ${missing.join(" / ")}`);
  }
}

/**
 * 断言产物 XML 不含任何 needle(命中即红)。
 * @param {string} xml document.xml
 * @param {string[]} needles 禁止出现的片段
 * @param {string} label 失败标签
 */
function expectAbsent(xml, needles, label) {
  const hit = needles.filter((n) => xml.includes(n));
  if (hit.length > 0) {
    throw new Error(`docx 公式/容器降级断言失败:${label} —— document.xml 不应出现 ${hit.join(" / ")}`);
  }
}

/**
 * 断言警告通道恰好命中 count 条含 needle 的文案(去重口径由此锁住)。
 * @param {string[]} warns 格式化后的警告文案
 * @param {string} needle 必须出现的文案片段
 * @param {number} count 期望条数
 * @param {string} label 失败标签
 */
function expectWarningCount(warns, needle, count, label) {
  const hits = warns.filter((text) => text.includes(needle)).length;
  if (hits !== count) {
    throw new Error(
      `docx 公式/容器降级断言失败:${label} —— 含「${needle}」的警告应为 ${count} 条,实际 ${hits} 条(${JSON.stringify(warns)})`,
    );
  }
}

/**
 * 断言警告通道不含 needle(用于「已正常渲染,不得再报降级」的反向锁)。
 * @param {string[]} warns 格式化后的警告文案
 * @param {string} needle 禁止出现的文案片段
 * @param {string} label 失败标签
 */
function expectNoWarning(warns, needle, label) {
  const hit = warns.filter((text) => text.includes(needle));
  if (hit.length > 0) {
    throw new Error(
      `docx 公式/容器降级断言失败:${label} —— 警告不应出现「${needle}」,实际 ${JSON.stringify(hit)}`,
    );
  }
}

/**
 * 断言 needle 在文本中恰好出现 count 次(编号文本/结构计数口径)。
 * @param {string} xml document.xml
 * @param {string} needle 待计数的片段
 * @param {number} count 期望次数
 * @param {string} label 失败标签
 */
function expectCount(xml, needle, count, label) {
  const hits = xml.split(needle).length - 1;
  if (hits !== count) {
    throw new Error(
      `docx 公式/容器降级断言失败:${label} —— 「${needle}」应出现 ${count} 次,实际 ${hits} 次`,
    );
  }
}

/**
 * 取包裹 needle 的最近一个 <w:p>…</w:p> 片段(段落级断言用:同文档其他段落的
 * 属性不能干扰对公式段本身的判定)。needle 不在任何段落内 → 报错。
 * @param {string} xml document.xml
 * @param {string} needle 目标片段
 * @returns {string} 该段落的完整 XML
 */
function paragraphContaining(xml, needle) {
  const at = xml.indexOf(needle);
  if (at === -1) {
    throw new Error(`docx 公式/容器降级断言失败:段落片段定位失败,document.xml 不含 ${needle}`);
  }
  const start = xml.lastIndexOf("<w:p>", at);
  const end = xml.indexOf("</w:p>", at);
  if (start === -1 || end === -1) {
    throw new Error(`docx 公式/容器降级断言失败:${needle} 不在 <w:p>…</w:p> 内`);
  }
  return xml.slice(start, end + "</w:p>".length);
}

/**
 * 断言某条 TeX 走「整式降级」:无 <m:oMath>(不混排)+ TeX 源码以等宽灰字成文
 * + 降级警告(警告文案含源码,便于定位)。
 * @param {"inline" | "display"} mode 公式位置(行内 / display 块)
 * @param {string} tex TeX 源码(单行)
 * @param {string} sourceNeedle 源码在 XML 中的可见形态(避开 & < 转义,只取稳定片段)
 * @param {string} label 失败标签
 * @returns {Promise<void>}
 */
async function assertFormulaDegraded(mode, tex, sourceNeedle, label) {
  const md = mode === "inline" ? `公式 $${tex}$ 尾。\n` : `$$\n${tex}\n$$\n`;
  const { xml, warns } = await renderDocxXml(md);
  expectAbsent(xml, ["<m:oMath"], `${label}(整式降级不应产出 m:oMath)`);
  expectPresent(xml, [MONO_GRAY_FONT, MONO_GRAY_COLOR, sourceNeedle], `${label}(降级 TeX 源码等宽灰字)`);
  if (!warns.some((text) => text.includes(FORMULA_DEGRADED) && text.includes(sourceNeedle))) {
    throw new Error(`docx 公式/容器降级断言失败:${label} —— 缺少公式降级警告,实际 warnings=${JSON.stringify(warns)}`);
  }
}

export async function run() {
  // ================= 第一部分:公式结构映射 =================

  // ---------- mroot:`\sqrt[3]{x}` → MathRadical(degree) ----------
  // 结构断言锁定 OOXML 序列化名(docx 9.7.1 实证):<m:rad><m:radPr/><m:deg>…</m:deg>
  // <m:e>…</m:e></m:rad>。次数/根值位置错位(如 degree 取反)会立即改写这两段文本。
  const root = await renderDocxXml("$$\n\\sqrt[3]{x}\n$$\n");
  expectPresent(
    root.xml,
    [
      "<m:oMath>",
      "<m:rad>",
      "<m:deg><m:r><m:t>3</m:t></m:r></m:deg>",
      "<m:e><m:r><m:t>x</m:t></m:r></m:e>",
      // display 公式走「居中公式 + 右对齐编号」排版:两个制表位 + 静态编号 (1)
      'w:val="center"',
      'w:val="right"',
      "(1)",
    ],
    "mroot(三次根号)",
  );
  if (root.warns.length > 0) {
    throw new Error(`docx 公式/容器降级断言失败:mroot 不应产生警告,实际 ${JSON.stringify(root.warns)}`);
  }
  console.log("[ok] docx 公式 mroot:\\sqrt[3]{x} → <m:rad> + <m:deg>3</m:deg> + 居中/右对齐制表位 + 编号 (1)");

  // ---------- mover / munder:`\overline{AB}` / `\underline{x}` ----------
  // MathLimitUpper → <m:limUpp>(<m:e> 基 + <m:lim> 上),MathLimitLower → <m:limLow>。
  // 两者与 msub/msup 走不同分支,错配会变成 <m:sSubSup>,故整体锁定标签与次序。
  const limits = await renderDocxXml("$\\overline{AB}$ 与 $\\underline{x}$。\n");
  expectPresent(
    limits.xml,
    [
      "<m:limUpp><m:e><m:r><m:t>A</m:t></m:r><m:r><m:t>B</m:t></m:r></m:e>" +
        "<m:lim><m:r><m:t>‾</m:t></m:r></m:lim></m:limUpp>",
      "<m:limLow><m:e><m:r><m:t>x</m:t></m:r></m:e>" +
        "<m:lim><m:r><m:t>‾</m:t></m:r></m:lim></m:limLow>",
    ],
    "mover/munder(上下限)",
  );
  expectAbsent(limits.xml, ["<m:sSubSup>"], "mover/munder(不应退化成普通下标 msub/msup)");
  console.log("[ok] docx 公式 mover/munder:\\overline{AB} → <m:limUpp>,\\underline{x} → <m:limLow>");

  // ---------- mspace / mtext:`\pmod{n}`(自闭合 mspace)、`\text{中文混排}` ----------
  // mspace 无文本贡献、直接跳过(不产生空 MathRun、不降级);mtext 为文本叶。
  // 断言「不降级」(无等宽灰字)+ 关键文本成文,锁住 mspace 分支不被误判为未覆盖节点。
  const spacing = await renderDocxXml("$\\pmod{n}$ 与 $\\text{中文混排}$。\n");
  expectPresent(spacing.xml, ["<m:t>(</m:t>", "<m:t>n</m:t>", "<m:t>中文混排</m:t>"], "mspace/mtext");
  expectAbsent(spacing.xml, [MONO_GRAY_COLOR, "<m:t>  </m:t>"], "mspace/mtext(不应降级且不吐空白 run)");
  console.log("[ok] docx 公式 mspace(\\pmod{n} 自闭合标签跳过)/mtext(\\text 中文成文,不降级)");

  // ---------- displayMode 双路径:同一 TeX 在 display / 行内产出结构不同 ----------
  // KaTeX 0.18.1 实证:display 模式大运算符上下限进 <munderover>/<munder>(上下方),
  // 行内模式同一 TeX 走 <msubsup>/<m:sub>(右侧)。两侧成对断言,任一侧被改成
  // 「一律 display」或「一律行内」都会立即变红。
  // ① display `$$ \sum_{i=1}^{n} i $$` → munderover → MathSum → <m:nary>
  //   (naryPr 内置 ∑ 字符;**children 必须是被加数** → <m:e>。被加数 i 由
  //   walkChildren 从 munderover 的下一个兄弟节点取来并消费掉,见 math.ts
  //   munderoverToNary 的注释。此前传空数组 → <m:e/> 空基 + 被加数漏成兄弟
  //   run,WPS 整式显示方框 □,而只查 <m:nary> 查不出这个)
  const sumDisplay = await renderDocxXml("$$\n\\sum_{i=1}^{n} i\n$$\n");
  expectPresent(
    sumDisplay.xml,
    [
      "<m:nary>",
      '<m:chr m:val="∑"/>',
      // 上下限在 naryPr 之后依次为 <m:sub>/<m:sup>(上下方排布的 OOXML 形态),
      // 末位是被加数槽 <m:e>:被加数 i 必须在 m:e 内,不能是 m:nary 的兄弟节点
      '<m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>' +
        "<m:sub><m:r><m:t>i</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>1</m:t></m:r></m:sub>" +
        "<m:sup><m:r><m:t>n</m:t></m:r></m:sup>" +
        "<m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>",
    ],
    "display ∑ 结构(MathSum/<m:nary> + <m:e> 被加数)",
  );
  expectAbsent(
    sumDisplay.xml,
    ["<m:sSubSup>", "<m:e/>", "</m:nary><m:r>"],
    "display ∑(不退回行内形态;<m:e> 不得为空;被加数不得漏成 m:nary 的兄弟 run)",
  );
  console.log(
    "[ok] docx 公式 display ∑ → <m:nary>(<m:chr ∑> + limLoc undOvr + <m:sub>/<m:sup> + <m:e> 被加数 i),无 <m:e/>、无兄弟 run、无 <m:sSubSup>",
  );

  // ①b 只消费一个兄弟:`∑_{i=1}^{n} i = …` 的等号与分式必须仍留在 m:nary 之外
  const sumThenMore = await renderDocxXml("$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n");
  expectPresent(
    sumThenMore.xml,
    [
      "<m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>" +
        '<m:r><m:t>=</m:t></m:r><m:f>',
    ],
    "display ∑ 只把紧邻的一个兄弟当被加数,后续项留在 m:nary 外",
  );
  console.log("[ok] docx 公式 display ∑ 后接等式/分式:被加数只取紧邻一项,其余留作兄弟");

  // ①c 无被加数(公式以 ∑ 结尾)→ 无法构造合法 <m:e>,整式降级而非留空基
  await assertFormulaDegraded(
    "display",
    "\\sum_{i=1}^{n}",
    "\\sum_{i=1}^{n}",
    "display ∑ 无被加数降级(不产空 <m:e/>)",
  );
  console.log("[ok] docx 公式 display ∑ 无被加数 → 整式降级为 TeX 源码(不产空 <m:e/> 显示方框)");

  // ② 行内 `$\sum_{i=1}^{n} i$` → msubsup → MathSubSuperScript → <m:sSubSup>
  //   (∑ 以 MathRun 文本进 base,上下限为兄弟节点)——行内形态保持不变
  //   (行内是 m:sSubSup 而非 m:nary,<m:e> 装的是运算符本身、非空,不受本轮修正影响)
  const sumInline = await renderDocxXml("行内 $\\sum_{i=1}^{n} i$。\n");
  expectPresent(
    sumInline.xml,
    [
      "<m:sSubSup><m:sSubSupPr/><m:e><m:r><m:t>∑</m:t></m:r></m:e>" +
        "<m:sub><m:r><m:t>i</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>1</m:t></m:r></m:sub>" +
        "<m:sup><m:r><m:t>n</m:t></m:r></m:sup></m:sSubSup>",
    ],
    "行内 ∑ 结构(MathSubSuperScript/<m:sSubSup>)",
  );
  expectAbsent(
    sumInline.xml,
    ["<m:nary"],
    "行内 ∑(上下限在右侧,不应被改成 display 的 <m:nary>)",
  );
  console.log("[ok] docx 公式行内 ∑ → <m:sSubSup>(∑ 进 base + <m:sub>/<m:sup>),无 <m:nary>");

  // ③ 第二组判别式 \lim:display 侧 <munder> → MathLimitLower(<m:limLow>);
  //   行内侧 <msub> → MathSubScript(<m:sSub>)。排除「只对 ∑ 特判」的实现。
  const limDisplay = await renderDocxXml("$$\n\\lim_{x \\to 0} f(x)\n$$\n");
  expectPresent(limDisplay.xml, ["<m:limLow>", "<m:lim><m:r><m:t>x</m:t></m:r>"], "display \\lim 结构");
  expectAbsent(limDisplay.xml, ["<m:sSub>"], "display \\lim(应为 <m:limLow>,不应退化成行内 <m:sSub>)");
  const limInline = await renderDocxXml("行内 $\\lim_{x \\to 0} f(x)$。\n");
  expectPresent(limInline.xml, ["<m:sSub><m:sSubPr/>"], "行内 \\lim 结构");
  expectAbsent(limInline.xml, ["<m:limLow>"], "行内 \\lim(应为 <m:sSub>,不应被改成 display 的 <m:limLow>)");
  console.log("[ok] docx 公式 \\lim:display → <m:limLow>,行内 → <m:sSub>(非 ∑ 路径同样按 displayMode 分流)");

  // ---------- 未覆盖节点 → 整式降级(mtable / menclose / mstyle / mphantom) ----------
  // 逐个单式文档:断言「无 m:oMath」才说明整式降级(同文档混多式会互相干扰)。
  await assertFormulaDegraded("display", "\\begin{matrix}a & b\\\\c & d\\end{matrix}", "\\begin{matrix}", "mtable 降级");
  await assertFormulaDegraded("inline", "\\cancel{x}", "\\cancel{x}", "menclose 降级");
  await assertFormulaDegraded("inline", "\\displaystyle x", "\\displaystyle x", "mstyle 降级");
  await assertFormulaDegraded("inline", "\\phantom{x}", "\\phantom{x}", "mphantom 降级");
  console.log("[ok] docx 公式未覆盖节点(mtable/menclose/mstyle/mphantom)→ 整式降级为 TeX 源码等宽灰字 + 警告");

  // ---------- 不可信 TeX → 提前拦截降级,且外部引用不进产物 ----------
  // 依据(handlers/math.ts 头注 + resource-limits.ts):KaTeX trust=false 只把
  // \href/\includegraphics 渲染成红色 mstyle,不进 katex-error 通道;渲染层因此在
  // 交给 KaTeX 前用单源 hasUntrustedTexCommand 拦下,使双管线降级形态一致。
  await assertFormulaDegraded("inline", "\\href{http://example.com/a}{y}", "\\href{http://example.com/a}{y}", "href 拦截");
  await assertFormulaDegraded("display", "\\includegraphics{logo.png}", "\\includegraphics{logo.png}", "includegraphics 拦截");
  const untrusted = await renderDocxXml("$\\href{http://example.com/a}{y}$\n");
  expectAbsent(untrusted.xml, ["<w:hyperlink"], "不可信 TeX 不得产出超链接");
  console.log("[ok] docx 公式不可信 TeX(\\href/\\includegraphics)→ 拦截降级 + 外部引用不进产物(无 w:hyperlink)");

  // ---------- katex-error(throwOnError:false 的解析失败产物)→ 整式降级 ----------
  await assertFormulaDegraded("inline", "\\frac{1}{", "\\frac{1}{", "katex-error 行内降级");
  await assertFormulaDegraded("display", "\\frac{1}{", "\\frac{1}{", "katex-error display 降级");
  console.log("[ok] docx 公式解析失败(katex-error)行内/display 双路径均整式降级 + 警告");

  // ================= 第二部分:容器内块级内容 =================

  // ---------- 容器内 display 公式 → Office MathML 分式(非 TeX 源码文本) ----------
  // renderList / renderBlockquote 的 math 分支委托 equations.ts renderContainerMath,
  // 与顶层 renderDisplayMath 共用 mathBody → texToDocxMath(displayMode=true)。
  // 本组断言钉「真的成公式」:<m:oMath> + <m:f> 分子分母齐全,且 TeX 源码
  // (`\frac{1}{2}`)不得以任何形态出现在产物里(此前走的正是这条降级文本路径)。
  const listMath = await renderDocxXml("- 列表项公式\n\n  $$\n  \\frac{1}{2}\n  $$\n");
  expectPresent(
    listMath.xml,
    [
      "<m:oMath>",
      "<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>" +
        "<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>",
      // 居中排版(与顶层无编号 display 公式、pdf 侧 .katex-display 同一语义)
      '<w:jc w:val="center"/>',
    ],
    "列表内公式渲染为 Office MathML 分式",
  );
  expectAbsent(
    listMath.xml,
    ["\\frac{1}{2}", MONO_GRAY_FONT, MONO_GRAY_COLOR],
    "列表内公式不得退化为 TeX 源码文本",
  );
  expectNoWarning(listMath.warns, UNSUPPORTED_IN_CONTAINER, "列表内公式正常渲染不应报「暂不支持」");
  console.log("[ok] docx 列表项内 display 公式 → <m:oMath><m:f>(分子 1 / 分母 2),无 TeX 源码文本、无降级警告");

  const quoteMath = await renderDocxXml("> $$\n> \\frac{1}{2}\n> $$\n");
  expectPresent(
    quoteMath.xml,
    [
      "<m:oMath>",
      "<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>" +
        "<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>",
      // 沿用引用段落装饰(与同块普通段落同一份 QUOTE_PARAGRAPH_PROPS)
      'w:fill="F2F2F2"',
      'w:ind w:left="720"',
      '<w:jc w:val="center"/>',
    ],
    "引用块内公式渲染为 Office MathML 分式",
  );
  expectAbsent(
    quoteMath.xml,
    ["\\frac{1}{2}", MONO_GRAY_FONT, MONO_GRAY_COLOR],
    "引用块内公式不得退化为 TeX 源码文本",
  );
  expectNoWarning(quoteMath.warns, UNSUPPORTED_IN_CONTAINER, "引用块内公式正常渲染不应报「暂不支持」");
  console.log("[ok] docx 引用块内 display 公式 → <m:oMath><m:f> + 引用段落底纹/缩进,无 TeX 源码文本");

  // ---------- 容器内公式 displayMode 仍为 true(不随容器降级为行内) ----------
  // mdast 块级 math 节点即 display 公式,真值来源是节点类型而非所在容器:
  // 容器内 \sum_{i=1}^{n} 的大运算符上下限排在上下方(<m:nary> + limLoc undOvr),
  // 与行内同 TeX 的 <m:sSubSup> 形态不同。若被误传 displayMode=false 即变红。
  const listSum = await renderDocxXml("- 列表内求和\n\n  $$\n  \\sum_{i=1}^{n} i\n  $$\n");
  expectPresent(
    listSum.xml,
    ["<m:nary>", '<m:chr m:val="∑"/>', '<m:limLoc m:val="undOvr"/>'],
    "容器内公式 displayMode=true(∑ 走 <m:nary> 上下方排布)",
  );
  expectAbsent(listSum.xml, ["<m:sSubSup>"], "容器内 display 公式不应走行内 <m:sSubSup> 形态");
  console.log("[ok] docx 容器内 display 公式 displayMode 仍为 true(<m:nary> + limLoc undOvr,无 <m:sSubSup>)");

  // ---------- 容器内公式不编号(编号仅顶层;pdf 侧同一契约) ----------
  // buildEquationContext 只扫顶层块,故容器内公式段:居中但无编号制表位
  // (<w:tabs>)、无编号文本、不挂列表编号(<w:numPr>);同文档内的顶层公式仍
  // 从 (1) 起编号,容器内公式不占号。断言逐段取「含 <m:oMath 的那个 <w:p>」,
  // 避免被同列表项正文段自身的编号干扰。
  const containerOnly = await renderDocxXml("- 列表项公式\n\n  $$\n  \\frac{1}{2}\n  $$\n");
  const formulaPara = paragraphContaining(containerOnly.xml, "<m:oMath>");
  expectAbsent(
    formulaPara,
    ["<w:tabs>", "(1)", "<w:numPr>"],
    "容器内公式段不编号(无制表位/无编号文本/不挂列表编号)",
  );
  expectPresent(formulaPara, ['<w:jc w:val="center"/>'], "容器内公式段居中");
  const mixedNumbering = await renderDocxXml(
    "顶层公式:\n\n$$\n\\frac{1}{2}\n$$\n\n- 列表项公式\n\n  $$\n  \\frac{3}{4}\n  $$\n",
  );
  expectCount(mixedNumbering.xml, "(1)", 1, "顶层公式仍编号 (1),容器内公式不占号");
  expectAbsent(mixedNumbering.xml, ["(2)"], "容器内公式不占第二个编号");
  console.log("[ok] docx 容器内公式不编号(公式段无 <w:tabs>/无编号文本/不挂 <w:numPr>;同文档顶层公式仍为 (1))");

  // ---------- 容器内公式的解析失败兜底仍保留(与「容器支不支持」是两回事) ----------
  // KaTeX 真解析失败(未覆盖节点 mtable / katex-error 未闭合分组)时,容器内
  // 公式与顶层同款整式降级:TeX 源码等宽灰字 + 「公式解析失败,降级为 TeX 源码」,
  // 不产 m:oMath;且**不得**报「容器内暂不支持」(公式本身是被支持的)。
  const listDegrade = await renderDocxXml(
    "- 列表内未覆盖节点\n\n  $$\n  \\begin{matrix}a & b\\\\c & d\\end{matrix}\n  $$\n",
  );
  expectPresent(
    listDegrade.xml,
    [MONO_GRAY_FONT, MONO_GRAY_COLOR, "\\begin{matrix}"],
    "容器内公式解析失败仍降级为 TeX 源码等宽灰字",
  );
  expectAbsent(listDegrade.xml, ["<m:oMath"], "容器内公式降级不混排(不产 m:oMath)");
  if (!listDegrade.warns.some((text) => text.includes(FORMULA_DEGRADED) && text.includes("\\begin{matrix}"))) {
    throw new Error(
      `docx 公式/容器降级断言失败:列表内公式解析失败缺少公式降级警告,实际 ${JSON.stringify(listDegrade.warns)}`,
    );
  }
  expectNoWarning(listDegrade.warns, UNSUPPORTED_IN_CONTAINER, "容器内公式解析失败不报「暂不支持」");

  const quoteDegrade = await renderDocxXml("> $$\n> \\frac{1}{\n> $$\n");
  expectPresent(
    quoteDegrade.xml,
    [MONO_GRAY_FONT, MONO_GRAY_COLOR, "\\frac{1}{"],
    "引用块内公式 katex-error 仍降级为 TeX 源码等宽灰字",
  );
  expectAbsent(quoteDegrade.xml, ["<m:oMath"], "引用块内公式降级不混排(不产 m:oMath)");
  if (!quoteDegrade.warns.some((text) => text.includes(FORMULA_DEGRADED) && text.includes("\\frac{1}{"))) {
    throw new Error(
      `docx 公式/容器降级断言失败:引用块内公式解析失败缺少公式降级警告,实际 ${JSON.stringify(quoteDegrade.warns)}`,
    );
  }
  console.log("[ok] docx 容器内公式解析失败兜底仍保留:TeX 源码等宽灰字 + 公式降级警告(不报「暂不支持」)");

  // ---------- 容器内表格 → 逐行文本段落(单元格纯文本以「 | 」连接) ----------
  // 断言两行各自成段(而非一张真表格:无 <w:tbl>),单元格内容顺序与分隔符锁定。
  const listTable = await renderDocxXml("- 列表内表格\n\n  | 甲 | 乙 |\n  | --- | --- |\n  | 丙 | 丁 |\n");
  expectPresent(listTable.xml, ["甲 | 乙", "丙 | 丁"], "列表内表格逐行文本段落");
  expectAbsent(listTable.xml, ["<w:tbl>"], "容器内表格不渲染为真表格");
  expectWarningCount(listTable.warns, `表格 在列表内${UNSUPPORTED_IN_CONTAINER}`, 1, "列表内表格警告");

  const quoteTable = await renderDocxXml("> | 列一 | 列二 |\n> | --- | --- |\n> | 甲 | 乙 |\n");
  expectPresent(quoteTable.xml, ["列一 | 列二", "甲 | 乙"], "引用块内表格逐行文本段落");
  expectAbsent(quoteTable.xml, ["<w:tbl>"], "引用块内表格不渲染为真表格");
  expectWarningCount(quoteTable.warns, `表格 在引用块内${UNSUPPORTED_IN_CONTAINER}`, 1, "引用块内表格警告");
  console.log("[ok] docx 容器内表格(列表/引用块)→ 逐行「 | 」连接文本段落 + 警告,不成 <w:tbl>");

  // ---------- 容器内同一类降级去重(warnDedup:同类型同容器只报一次) ----------
  const dedup = await renderDocxXml(
    "> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n>\n> | 戊 | 己 |\n> | --- | --- |\n> | 庚 | 辛 |\n",
  );
  expectWarningCount(dedup.warns, `表格 在引用块内${UNSUPPORTED_IN_CONTAINER}`, 1, "同容器同类降级去重");
  const mixed = await renderDocxXml(
    "- 列表内表格\n\n  | 甲 | 乙 |\n  | --- | --- |\n  | 丙 | 丁 |\n\n> | 戊 | 己 |\n> | --- | --- |\n> | 庚 | 辛 |\n",
  );
  expectWarningCount(mixed.warns, `表格 在列表内${UNSUPPORTED_IN_CONTAINER}`, 1, "列表侧去重");
  expectWarningCount(mixed.warns, `表格 在引用块内${UNSUPPORTED_IN_CONTAINER}`, 1, "引用块侧去重(容器不同不合并)");
  console.log("[ok] docx 容器内降级去重:同类型同容器只报 1 条,容器不同各报 1 条");

  // ---------- 容器内非白名单 html → 原文等宽灰字 + 「HTML 在…」警告 ----------
  // 尖括号按 XML 转义成 &lt;/&gt;(断言可见形态,勿直接找原始尖括号)。
  const quoteDiv = await renderDocxXml("> <div>提示</div>\n");
  expectPresent(
    quoteDiv.xml,
    [MONO_GRAY_FONT, MONO_GRAY_COLOR, "&lt;div&gt;提示&lt;/div&gt;"],
    "引用块内非白名单 html 降级为原文等宽灰字",
  );
  expectWarningCount(quoteDiv.warns, `HTML 在引用块内${UNSUPPORTED_IN_CONTAINER}`, 1, "引用块内 html 警告");
  console.log("[ok] docx 容器内非白名单 html → 原文(XML 转义)等宽灰字 + 「HTML 在…」警告");

  // ---------- 旁路一:`<!-- page-break -->` 在容器内照常分页且不产警告 ----------
  // renderContainerFallback 的 html 分支先判分页注释:注释不显示、分页照做,
  // 也不追加降级警告(否则每个容器内分页都会刷警告)。
  const quoteBreak = await renderDocxXml("> <!-- page-break -->\n");
  expectPresent(quoteBreak.xml, ['<w:br w:type="page"/>'], "容器内分页注释照常分页");
  expectAbsent(quoteBreak.xml, [MONO_GRAY_COLOR, "page-break"], "容器内分页注释不降级为源码文本");
  if (quoteBreak.warns.length > 0) {
    throw new Error(
      `docx 公式/容器降级断言失败:容器内分页注释不应产生警告,实际 ${JSON.stringify(quoteBreak.warns)}`,
    );
  }
  console.log("[ok] docx 容器内 <!-- page-break --> 照常分页(<w:br w:type=\"page\"/)且零警告");

  // ---------- 旁路二:白名单行内标签(<br>)在容器内照常按正文排版成段 ----------
  // 白名单判定单源 core/markdown/html-whitelist.ts;命中 → renderInlineHtmlParagraph
  // (复用正文 5a 排版:行距 + 首行缩进 + 两端对齐),不追加降级警告。
  const quoteBr = await renderDocxXml("> <br>\n");
  expectPresent(
    quoteBr.xml,
    ["<w:br/>", 'w:firstLineChars="200"', 'w:jc w:val="both"'],
    "容器内白名单行内 html 按正文排版成段",
  );
  expectAbsent(quoteBr.xml, [MONO_GRAY_COLOR], "容器内白名单 html 不走降级样式");
  if (quoteBr.warns.length > 0) {
    throw new Error(
      `docx 公式/容器降级断言失败:容器内白名单 html 不应产生警告,实际 ${JSON.stringify(quoteBr.warns)}`,
    );
  }
  console.log("[ok] docx 容器内白名单行内 html(<br>)→ 按正文 5a 排版成段,不降级不告警");

  // ---------- 旁路三:引用块内代码块按代码块渲染 + 「代码块 在引用块内」警告 ----------
  // unsupportedBlockWarning 的第三个调用点(content.ts renderBlockquote 的 code 分支):
  // 警告类别词是「代码块」,内容走既有 renderCode 路径(等宽 + 关键字着色),不是纯文本降级。
  const quoteCode = await renderDocxXml("> ```js\n> const a = 1;\n> ```\n");
  expectPresent(
    quoteCode.xml,
    [
      // 代码块排版(段前后间距 + 左缩进),与普通正文段不同
      'w:after="120" w:before="120"',
      'w:ind w:left="360"',
      // 关键字着色色值证明走的是「代码块 + 高亮」路径而非纯文本降级;
      // 文本按高亮 token 切 run,故逐 token 断言而非找整行
      '<w:color w:val="CF222E"/>',
      '<w:t xml:space="preserve">const</w:t>',
      '<w:t xml:space="preserve"> a = </w:t>',
    ],
    "引用块内代码块内容成文",
  );
  expectAbsent(quoteCode.xml, [MONO_GRAY_COLOR], "引用块内代码块走代码块样式而非降级灰字");
  expectWarningCount(quoteCode.warns, `代码块 在引用块内${UNSUPPORTED_IN_CONTAINER}`, 1, "引用块内代码块警告");
  console.log("[ok] docx 引用块内代码块 → 代码块样式成文 + 「代码块 在引用块内暂不支持」警告");

  // ================= 落盘样例(供人工在 Word/WPS 核对实际排版) =================
  // display ∑ 与行内 ∑ 成对入样例:上下方排布 vs 右侧排布只能目视确认,
  // 自动断言只覆盖 OOXML 结构,视觉效果留人工核对。
  // 容器内公式也入样例:列表项与引用块内的 \frac{1}{2} 应目视确认为分式
  // (自动断言已锁 <m:f>,WPS/Word 的实际排版效果仍需人眼确认)。
  const showcaseMd =
    "# 公式结构与容器降级\n\n$$\n\\sqrt[3]{x}\n$$\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n" +
    "行内对照 $\\sum_{i=1}^{n} i$、$\\lim_{x \\to 0} f(x)$。\n\n$$\n\\lim_{x \\to 0} f(x)\n$$\n\n" +
    "$\\overline{AB}$、$\\underline{x}$、$\\pmod{n}$、$\\text{中文混排}$。\n\n- 列表项公式\n\n  $$\n  \\frac{1}{2}\n  $$\n\n" +
    "> $$\n> \\frac{1}{2}\n> $$\n\n> | 列一 | 列二 |\n> | --- | --- |\n> | 甲 | 乙 |\n";
  const showcase = await renderDocxXml(showcaseMd);
  expectPresent(
    showcase.xml,
    [
      "<m:rad>",
      "<m:limUpp>",
      "<m:limLow>",
      "<m:nary>",
      "<m:sSubSup>",
      "<m:t>中文混排</m:t>",
      "甲 | 乙",
      // 容器内两个分式(列表 + 引用块)也成公式
      "<m:f>",
      // display ∑ 的被加数在 <m:e> 内(样例即人工目视「∑ 处不该有方框」的核对材料)
      '<m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>',
    ],
    "落盘样例",
  );
  await saveArtifact("math-structures", {
    docx: docxBufferOf(
      /** @type {ConvertArtifact} */ (
        await convert(showcaseMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] })
      ),
    ),
  });
}
