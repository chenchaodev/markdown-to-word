/**
 * 内联格式白名单测试(原 make-batch4-sample.mjs 段 6):
 * 双格式一致:白名单无属性标签渲染为对应格式(pdf 原样输出 / docx 样式运行);
 * 危险样例(脚本/块级 div/带属性标签)安全兜底(pdf 转义 / docx 跳过)。
 * 序列化名已实证(docx 9.7.1 index.cjs):bold → <w:b/>(OnOffElement true 无 val)、
 * sub/sup → w:vertAlign w:val="subscript"/"superscript"、mark → w:highlight
 * w:val="yellow"、strike → <w:strike/>、underline → <w:u w:val="single"/>、
 * 换行 → <w:br/>(TextRun break: 1)。
 */
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { FIXTURES_DIR } from "../common/paths.js";

/** 主样例:白名单标签 + 危险样例(gen-fixtures 落盘为 acceptance/raw-html.md) */
const htmlMd = `# 白名单测试

<strong>粗体</strong> 与 <em>斜体</em>、<code>code()</code>、x<sub>1</sub> 和 y<sup>2</sup>、<u>下划线</u>、<s>删除线</s>、<mark>高亮</mark>、<span>普通</span>、<strong>粗<em>斜</em></strong>。<br>换行后内容。

<script>alert(1)</script>、<div class="x">块级</div>、<strong class="y">带属性</strong>
`;
/** 交叉边界场景:行首白名单块 + 危险段交错(落盘为 acceptance/raw-html-cross.md) */
const crossMd = `# 交叉边界测试

<strong>行首粗体</strong>

前缀 <strong>险</div> 结尾

前缀 <strong>乙</strong></div> 结尾
`;
export const fixtures = { main: htmlMd, cross: crossMd };

export async function run() {
  const htmlDocx = await convert(htmlMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const htmlDocument = await unzipPart(htmlDocx.buffer, "word/document.xml");
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
  for (const [needle, label] of htmlDocxChecks) {
    if (!htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 缺少 ${label}(${needle})`);
  }
  // 危险样例 docx 侧整体跳过(块级 html 节点跳过 + 段落内危险段归一化丢弃,内容文本不残留)
  for (const [needle, label] of [
    ["alert", "script 内容"],
    ["块级", "div 内容"],
    ["带属性", "带属性标签内容"],
    ['class="', "属性标签"],
  ]) {
    if (htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 不应含 ${label}`);
  }
  console.log("[ok] docx 白名单:白名单标签渲染 + 危险样例跳过 全部通过");

  // pdf:白名单整串原样输出(Chromium 渲染);危险样例转义。
  // 注:转义仅作用于标签字符(< > & "),标签内文本(如 alert(1)、块级)按转义语义
  // 保留为可见文本,故断言"标签被转义"(&lt;script&gt; / &lt;div)而非文本消失。
  const htmlPdf = await convert(htmlMd, "pdf", { baseDir: FIXTURES_DIR, title: "白名单测试", warnings: [] });
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
    if (!htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 缺少 ${label}(${needle})`);
  }
  for (const [needle, label] of [
    ["<script", "script 明文标签"],
    ['<div class="x"', "div 明文标签(用户输入特有,模板 div 为 page-break/cover 等,不受影响)"],
    ["<strong class=", "带属性 strong 明文标签"],
  ]) {
    if (htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 不应含 ${label}`);
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
  const crossDocx = await convert(crossMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const crossDocument = await unzipPart(crossDocx.buffer, "word/document.xml");
  if (crossDocument.includes("</div>")) {
    throw new Error("交叉边界断言失败:docx 不应残留危险闭标签 </div>");
  }
  if (crossDocument.includes("险")) {
    throw new Error("交叉边界断言失败:docx 危险段文本(险)不应残留(危险段整体丢弃)");
  }
  if (!/<w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>乙<\/w:t>/.test(crossDocument)) {
    throw new Error("交叉边界断言失败:docx 白名单整串应保留且 乙 渲染为粗体运行");
  }
  if (!crossDocument.includes("前缀") || !crossDocument.includes("行首粗体")) {
    throw new Error("交叉边界断言失败:docx 危险段周边文本/行首 html 块内容不应丢失");
  }
  console.log("[ok] docx 交叉边界:危险段整体丢弃(无 </div> 残留/文本不残留)+ 白名单整串保留 + 行首 html 块渲染");

  const crossPdf = await convert(crossMd, "pdf", { baseDir: FIXTURES_DIR, title: "交叉边界测试", warnings: [] });
  if (!crossPdf.html.includes("<strong>行首粗体</strong>")) {
    throw new Error("交叉边界断言失败:PDF 行首白名单 html_block 应原样输出");
  }
  if (crossPdf.html.includes("&lt;strong&gt;行首粗体")) {
    throw new Error("交叉边界断言失败:PDF 行首白名单不应被转义");
  }
  if (!crossPdf.html.includes("&lt;strong&gt;险&lt;/div&gt;")) {
    throw new Error("交叉边界断言失败:PDF 危险交错应整体转义");
  }
  console.log("[ok] PDF 交叉边界:行首 html_block 白名单原样输出 + 危险交错转义");

  const htmlPdfBin = await htmlToPdf(htmlPdf.html, htmlPdf.footerTemplate);
  await saveArtifact("raw-html", { docx: htmlDocx.buffer, pdf: htmlPdfBin });
}
