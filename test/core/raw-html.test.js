// @ts-check
/**
 * 内联格式白名单测试:
 * 双格式一致:白名单无属性标签渲染为对应格式(pdf 原样输出 / docx 样式运行);
 * 危险样例(脚本/块级 div/带属性标签)安全兜底(pdf 转义 / docx 跳过)。
 * 序列化名已实证(docx 9.7.1 index.cjs):bold → <w:b/>(OnOffElement true 无 val)、
 * sub/sup → w:vertAlign w:val="subscript"/"superscript"、mark → w:highlight
 * w:val="yellow"、strike → <w:strike/>、underline → <w:u w:val="single"/>、
 * 换行 → <w:br/>(TextRun break: 1)。
 */
import { unzipPart } from "../harness/docx-utils.js";
import { htmlToPdf } from "../harness/pdf-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,判据静态看不见本段的主体 —— 全链路经
 * `test/harness/convert-helpers.js` 的 `convertWithFs` 到达 core,段内零 core import。
 *
 * 主体依据(头注 + 段内实现指针注释):头注写「内联格式白名单测试:双格式一致」。白名单的
 * **单一实现**在 `markdown/html-whitelist.ts`(其文件头写明「原 docx/render.ts 与
 * pdf/render.ts 各持一份逐字副本,抽取后任何标签集变更只改此处」);两侧扫描器按该文件头
 * 登记的双向同步指针各自声明。段内第 104-110 行的实现指针注释亦点名
 * `overrideHtmlRules`(pdf 侧)与 `normalizeInlineHtml`(docx 侧)。
 */
export const covers = [
  "src/core/markdown/html-whitelist.ts",
  "src/core/docx/handlers/inline-html.ts",
  "src/core/pdf/rules/html.ts",
];

/** 主样例:白名单标签 + 危险样例(gen-fixtures 落盘为 docs/raw-html.md) */
const htmlMd = `# 白名单测试

<strong>粗体</strong> 与 <em>斜体</em>、<code>code()</code>、x<sub>1</sub> 和 y<sup>2</sup>、<u>下划线</u>、<s>删除线</s>、<mark>高亮</mark>、<span>普通</span>、<strong>粗<em>斜</em></strong>。<br>换行后内容。

<script>alert(1)</script>、<div class="x">块级</div>、<strong class="y">带属性</strong>
`;
/** 交叉边界场景:行首白名单块 + 危险段交错(落盘为 docs/raw-html-cross.md) */
const crossMd = `# 交叉边界测试

<strong>行首粗体</strong>

前缀 <strong>险</div> 结尾

前缀 <strong>乙</strong></div> 结尾
`;
export const meta = { description: "内联格式白名单测试:" };
export const fixtures = { main: htmlMd, cross: crossMd };

export async function run() {
  const suite = createCaseSuite();
  const htmlDocx = docxBufferOf(
    await convertWithFs(htmlMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] }),
  );
  const htmlDocument = await unzipPart(htmlDocx, "word/document.xml");
  /** @type {[string, string][]} 断言表 [XML 片段, 中文标签] */
  const htmlDocxChecks = [
    ["粗体", "strong 文本"],
    ["斜体", "em 文本"],
    ["<w:b/>", "bold 序列化(w:b)"],
    ["w:vertAlign", "sub/sup 序列化(w:vertAlign)"],
    ['w:val="subscript"', "subScript 序列化值"],
    ['w:val="superscript"', "superScript 序列化值"],
    ["w:highlight", "mark 序列化(w:highlight)"],
    ["<w:strike/>", "strike 序列化"],
    ['<w:u w:val="single"/>', "underline 序列化"],
    ["Consolas", "code 等宽字体"],
  ];
  // 断言表逐项一个 case:label 是该片段的稳定标识,一处序列化改名不该掩盖其余各项
  for (const [needle, label] of htmlDocxChecks) {
    await suite.case(`docx 白名单标签:${label}`, () => {
      if (!htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 缺少 ${label}(${needle})`);
    });
  }
  // 危险样例 docx 侧整体跳过(块级 html 节点跳过 + 段落内危险段归一化丢弃,内容文本不残留)
  /** @type {[string, string][]} 断言表 [XML 片段, 中文标签] */
  const htmlDocxDangerChecks = [
    ["alert", "script 内容"],
    ["块级", "div 内容"],
    ["带属性", "带属性标签内容"],
    ['class="', "属性标签"],
  ];
  for (const [needle, label] of htmlDocxDangerChecks) {
    await suite.case(`docx 危险样例已跳过:${label}`, () => {
      if (htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 不应含 ${label}`);
    });
  }
  console.log("[ok] docx 白名单:白名单标签渲染 + 危险样例跳过 全部通过");

  // pdf:白名单整串原样输出(Chromium 渲染);危险样例转义。
  // 注:转义仅作用于标签字符(< > & "),标签内文本(如 alert(1)、块级)按转义语义
  // 保留为可见文本,故断言"标签被转义"(&lt;script&gt; / &lt;div)而非文本消失。
  const htmlPdf = asPdfArtifact(
    await convertWithFs(htmlMd, "pdf", { baseDir: FIXTURES_DIR, title: "白名单测试", warnings: [] }),
  );
  /** @type {[string, string][]} 断言表 [HTML 片段, 中文标签] */
  const htmlPdfChecks = [
    ["<strong>粗体</strong>", "strong 原样输出"],
    ["<em>斜体</em>", "em 原样输出"],
    ["<sub>1</sub>", "sub 原样输出"],
    ["<sup>2</sup>", "sup 原样输出"],
    ["<mark>高亮</mark>", "mark 原样输出"],
    ["<strong>粗<em>斜</em></strong>", "嵌套原样输出"],
    ["<br>", "br 原样输出"],
    ["&lt;script&gt;", "script 转义形式"],
    ["&lt;div", "div 转义形式"],
    ["&lt;strong class=", "带属性 strong 转义形式"],
  ];
  for (const [needle, label] of htmlPdfChecks) {
    await suite.case(`PDF 白名单:${label}`, () => {
      if (!htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 缺少 ${label}(${needle})`);
    });
  }
  /** @type {[string, string][]} 断言表 [HTML 片段, 中文标签] */
  const htmlPdfDangerChecks = [
    ["<script", "script 明文标签"],
    ['<div class="x"', "div 明文标签(用户输入特有,模板 div 为 page-break/cover 等,不受影响)"],
    ["<strong class=", "带属性 strong 明文标签"],
  ];
  for (const [needle, label] of htmlPdfDangerChecks) {
    await suite.case(`PDF 危险样例已转义:${label}`, () => {
      if (htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 不应含 ${label}`);
    });
  }
  console.log("[ok] PDF 白名单:白名单原样输出 + 危险样例转义 全部通过");

  // 交叉边界(注释级契约点):
  // 场景 A(pdf 侧):行首白名单整串会被 markdown-it 归为 html_block 而非 html_inline
  // (pdf/render.ts 304 行注释),overrideHtmlRules 对 html_block 同样走白名单放行 →
  // 原样输出,而非转义;docx 侧同一输入为 html 块节点,isAllowedInlineHtml 放行渲染。
  // 场景 B(docx 侧):行内白名单开标签 + 危险闭标签交错(normalizeInlineHtml 危险段
  // 丢弃语义):「<strong>险</div>」无法构成白名单表达式 → 危险段(开标签起至首个
  // 闭标签 html 节点)整体丢弃、内容文本(险)不残留;而「<strong>乙</strong></div>」
  // 白名单整串合并先行 → 乙 保留为粗体运行,孤立危险闭标签丢弃。
  const crossDocument = await unzipPart(
    docxBufferOf(await convertWithFs(crossMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] })),
    "word/document.xml",
  );
  const crossPdf = asPdfArtifact(
    await convertWithFs(crossMd, "pdf", { baseDir: FIXTURES_DIR, title: "交叉边界测试", warnings: [] }),
  );
  await suite.case("docx 交叉边界:不残留危险闭标签 </div>", () => {
    if (crossDocument.includes("</div>")) {
      throw new Error("交叉边界断言失败:docx 不应残留危险闭标签 </div>");
    }
  });
  await suite.case("docx 交叉边界:危险段文本(险)不残留(危险段整体丢弃)", () => {
    if (crossDocument.includes("险")) {
      throw new Error("交叉边界断言失败:docx 危险段文本(险)不应残留(危险段整体丢弃)");
    }
  });
  await suite.case("docx 交叉边界:白名单整串保留且 乙 渲染为粗体运行", () => {
    if (!/<w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>乙<\/w:t>/.test(crossDocument)) {
      throw new Error("交叉边界断言失败:docx 白名单整串应保留且 乙 渲染为粗体运行");
    }
  });
  await suite.case("docx 交叉边界:危险段周边文本与行首 html 块内容未丢失", () => {
    if (!crossDocument.includes("前缀") || !crossDocument.includes("行首粗体")) {
      throw new Error("交叉边界断言失败:docx 危险段周边文本/行首 html 块内容不应丢失");
    }
  });
  console.log("[ok] docx 交叉边界:危险段整体丢弃(无 </div> 残留/文本不残留)+ 白名单整串保留 + 行首 html 块渲染");

  await suite.case("PDF 交叉边界:行首白名单 html_block 原样输出", () => {
    if (!crossPdf.html.includes("<strong>行首粗体</strong>")) {
      throw new Error("交叉边界断言失败:PDF 行首白名单 html_block 应原样输出");
    }
  });
  await suite.case("PDF 交叉边界:行首白名单不被转义", () => {
    if (crossPdf.html.includes("&lt;strong&gt;行首粗体")) {
      throw new Error("交叉边界断言失败:PDF 行首白名单不应被转义");
    }
  });
  await suite.case("PDF 交叉边界:危险交错整体转义", () => {
    if (!crossPdf.html.includes("&lt;strong&gt;险&lt;/div&gt;")) {
      throw new Error("交叉边界断言失败:PDF 危险交错应整体转义");
    }
  });
  console.log("[ok] PDF 交叉边界:行首 html_block 白名单原样输出 + 危险交错转义");

  const htmlPdfBin = await htmlToPdf(htmlPdf.html, htmlPdf.footerTemplate);
  await saveArtifact("raw-html", { docx: htmlDocx, pdf: htmlPdfBin });
  return { cases: suite.results };
}
