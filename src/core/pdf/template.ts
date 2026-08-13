/**
 * PDF 模板集:页眉页脚模板(PDF_FOOTER_TEMPLATE)、文档模板 CSS(buildTemplateCss)、
 * KaTeX CSS 加载(loadKatexCss)、完整 HTML 模板(buildTemplate)、封面 HTML(buildCoverHtml)。
 * 自 pdf/render.ts 拆分(R3 行为等价重构,原注释语义与实现原样保留)。
 * escapeHtml/decodeEntities 已集中 src/core/utils.ts(R8 批 4 L3),此处 re-export 保持外部 import 兼容。
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import type { PageSetup } from "../settings-defaults.js";
import { escapeHtml, decodeEntities } from "../utils.js";

export { escapeHtml, decodeEntities };

/** 页码页脚模板(printToPDF footerTemplate 用;模板内必须内联样式,字体大小需显式设置)。 */
export const PDF_FOOTER_TEMPLATE =
  '<div style="font-size:9px;color:#888;width:100%;text-align:center;">' +
  '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>';

/** 转换矩阵与 docx 路线对齐的文档模板样式(分页、中文字体、代码高亮、表格、跨页避让)。
 *  @page 尺寸/边距由 pageSetup 生成(margin 顺序 top right bottom left);
 *  breakBeforeH1 为 true 时追加一级标题前分页规则;
 *  typography 参数化 body 字体/字号/行距,并追加首行缩进/两端对齐规则;
 *  headingNumbering 为 true 时追加章节编号规则(与 docx 侧 decimal 编号语义一致)。
 *  注意:编号经 ::before 伪元素渲染,不进入 HTML 文本节点,
 *  故 extractHeadings/书签/目录文本不受影响(与 docx 侧书签不含编号一致)。 */
export function buildTemplateCss(
  pageSetup: PageSetup,
  breakBeforeH1: boolean,
  typography: TypographySettings,
  headingNumbering: boolean,
  captionNumbering: boolean,
  hasH1: boolean,
): string {
  const size = pageSetup.paper + (pageSetup.orientation === "landscape" ? " landscape" : "");
  const { marginTop, marginRight, marginBottom, marginLeft } = pageSetup;
  return `
  @page { size: ${size}; margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm; }
  .page-break { break-before: page; height: 0; }
  /* 分页符后紧跟的 h1 不再强制分页:breakBeforeH1 下两个相邻 break-before 叠加,
     Chromium printToPDF 会产生 1 个空白页(实测确认,相邻分页符不合并);
     breakBeforeH1 关闭时 h1 无 break-before,本规则无副作用,故无条件加 */
  .page-break + h1 { break-before: auto; }
  * { box-sizing: border-box; }

  /* 基础排版:行高兼顾中英混排(排版设置参数化);orphans/widows 保证跨页段落不零碎。
     字体/字号/行距由排版设置参数化(中文为主 + 西文衬底) */
  body {
    font-family: "${typography.fontEastAsia}", "${typography.fontAscii}", sans-serif;
    font-size: ${typography.bodySizePt}pt; line-height: ${typography.lineSpacing}; color: #1f2328; margin: 0;
    orphans: 2; widows: 2;
  }

  /* 标题节奏:h1/h2 带下边线锚定章节,3-6 级靠字号与间距区分;
     标题行高收紧,且不与后续内容分离(break-after: avoid,避免孤立标题) */
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; break-after: avoid; }
  body > :first-child { margin-top: 0; } /* 文档首元素不产生多余顶距 */

  /* 封面页:居中大标题 + 灰色作者/日期,顶部留白视觉居中 */
  .cover { text-align: center; padding-top: 80mm; }
  .cover-title { font-size: 28pt; font-weight: 700; margin: 0 0 20px; }
  .cover-meta { font-size: 12pt; color: #888; }

  /* 目录页:无页码,条目为页内锚点链接(printToPDF 保留为可点击链接);
     层级靠左缩进区分,链接沿用正文颜色(继承而非蓝色) */
  .toc-title { font-size: 18pt; font-weight: 700; margin-bottom: 16px; }
  .toc ul { list-style: none; padding: 0; margin: 0; }
  .toc-l1 { margin: 6px 0; }
  .toc-l2 { margin-left: 1.5em; }
  .toc-l3 { margin-left: 3em; }
  .toc a { color: inherit; text-decoration: none; }
  h1 { font-size: 22pt; border-bottom: 2px solid #d0d7de; padding-bottom: 8px; margin: 0 0 16px; }
  h2 { font-size: 17pt; border-bottom: 1px solid #d0d7de; padding-bottom: 6px; margin: 24px 0 12px; }
  h3 { font-size: 14pt; margin: 20px 0 10px; }
  h4 { font-size: 12pt; margin: 16px 0 8px; }
  h5, h6 { font-size: 11pt; margin: 14px 0 8px; color: #57606a; }

  p { margin: 0 0 10px; }
  a { color: #0969da; text-decoration: none; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 18px 0; }

  /* 行内代码与代码块 */
  code {
    font-family: Consolas, "Cascadia Mono", monospace;
    font-size: 0.9em; background: #f6f8fa; padding: 2px 5px; border-radius: 4px;
    overflow-wrap: break-word; /* 长行内代码换行而非溢出页边 */
  }
  pre.hljs {
    background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px;
    padding: 12px 14px; overflow: hidden; break-inside: avoid;
  }
  pre.hljs code {
    background: none; padding: 0; font-size: 9.5pt; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; /* 长代码行折行,避免打印裁切 */
  }

  /* 引用块:末段收敛间距;整块避免跨页 */
  blockquote {
    margin: 0 0 10px; padding: 2px 14px; color: #57606a;
    border-left: 4px solid #d0d7de; break-inside: avoid;
  }
  blockquote > :last-child { margin-bottom: 0; }

  /* 表格:表头底色 + 斑马纹;行内不跨页,长表格按行断开 */
  table {
    border-collapse: collapse; width: 100%; margin: 0 0 12px;
    font-size: 10pt; break-inside: avoid;
  }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f0f3f6; font-weight: 600; }
  tr:nth-child(even) td { background: #f8f9fa; }
  tr { break-inside: avoid; }

  img { max-width: 100%; break-inside: avoid; }
  ul, ol { margin: 0 0 10px; padding-left: 26px; }
  li { margin: 2px 0; }
  li > p { margin: 0 0 4px; } /* 宽松列表项内的段落收紧,避免空洞 */
  li > p:last-child { margin-bottom: 0; }
  li.task-list-item { list-style: none; margin-left: -18px; }
  li.task-list-item::before { content: ""; }
  /* 脚注区:缩小字号与正文区分(Chromium 不支持 float: footnote,
     脚注按文档流集中在内容末尾渲染,为 HTML→PDF 固有行为) */
  .footnotes { font-size: 9pt; }
  hr.footnotes-sep { border: none; border-top: 1px solid #d0d7de; margin: 16px 0 8px; }
  ol.footnotes-list { padding-left: 22px; }
  li.footnote-item { break-inside: avoid; }
  sup.footnote-ref a { text-decoration: none; color: inherit; }
  a.footnote-backref { text-decoration: none; margin-left: 2px; }
  del { color: #8c959f; }

  /* 代码高亮(GitHub Light 色板;printBackground 打印背景) */
  .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #cf222e; }
  .hljs-string, .hljs-regexp { color: #0a3069; }
  .hljs-number { color: #0550ae; }
  .hljs-comment { color: #6e7781; font-style: italic; }
  .hljs-title, .hljs-function { color: #8250df; }
  .hljs-attr, .hljs-attribute { color: #953800; }
  .hljs-variable, .hljs-template-variable { color: #953800; }
  .hljs-built_in { color: #0550ae; }
  .hljs-meta { color: #57606a; }
  .hljs-symbol, .hljs-bullet { color: #0550ae; }
  /* 补充常见 token 类(沿用同色板,补上 highlight.js 各语言的高频输出) */
  .hljs-type, .hljs-selector-class, .hljs-name, .hljs-tag { color: #116329; }
  .hljs-property { color: #0550ae; }
  .hljs-operator { color: #cf222e; }
  .hljs-link { color: #0a3069; }
  .hljs-quote, .hljs-doctag { color: #6e7781; }
  .hljs-section { color: #8250df; }
  .hljs-deletion { color: #cf222e; background: #ffebe9; }
  .hljs-addition { color: #116329; background: #dafbe1; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }
${breakBeforeH1 ? `
  /* 一级标题前分页(breakBeforeH1);文档首元素为 h1 时避免空白首页 */
  h1 { break-before: page; }
  body > h1:first-child { break-before: auto; }` : ""}
${headingNumbering ? `
  /* 章节编号:与 docx 标题编号语义一致(1 / 1.1 / 1.1.1) */
  body { counter-reset: h1c h2c h3c; }
  h1 { counter-increment: h1c; counter-reset: h2c h3c; }
  h2 { counter-increment: h2c; counter-reset: h3c; }
  h3 { counter-increment: h3c; }
  h1::before { content: counter(h1c) " "; }
  h2::before { content: counter(h1c) "." counter(h2c) " "; }
  h3::before { content: counter(h1c) "." counter(h2c) "." counter(h3c) " "; }` : ""}
${captionNumbering ? `
  /* 题注编号(8b):图/表题注居中小一号,编号经 ::before 伪元素(不进文本节点,
     书签/目录不受影响);章节号 = 最近 h1,图/表序在 h1 处重置(与 docx 侧
     SEQ \\s 1 语义一致)。文档无 h1 时退化为纯序数(全文档连续,与 docx 对齐) */
  .fig-caption, .tab-caption { text-align: center; font-size: 10pt; margin: 4px 0 12px; break-inside: avoid; }
  /* 图/表序自增(8b 遗留修复:此前缺 counter-increment,序数恒为 0,
     所有题注显示「图 N.0」;编号文本与 xref_recognize 登记同源,勿漂移) */
  .fig-caption { counter-increment: figc; }
  .tab-caption { counter-increment: tabc; }
${headingNumbering && hasH1 ? `
  body { counter-reset: h1c h2c h3c figc tabc; }
  h1 { counter-reset: h2c h3c figc tabc; }
  .fig-caption::before { content: "图 " counter(h1c) "." counter(figc) " "; }
  .tab-caption::before { content: "表 " counter(h1c) "." counter(tabc) " "; }` : `
  body { counter-reset: figc tabc; }
  .fig-caption::before { content: "图 " counter(figc) " "; }
  .tab-caption::before { content: "表 " counter(tabc) " "; }`}
` : ""}
${typography.firstLineIndent ? `
  /* 首行缩进 2 字符(排版设置;中文排版惯例,与 docx 侧 firstLineChars=200 语义一致) */
  p { text-indent: 2em; }` : ""}
${typography.align === "justify" ? `
  /* 正文两端对齐(排版设置) */
  p { text-align: justify; }` : ""}
  /* 公式块(8d):display 公式居中,编号右缘垂直居中(编号绝对定位,
     KaTeX display 外边距归零避免与公式块外边距双重叠加) */
  .eq-block { position: relative; text-align: center; margin: 1em 0; }
  .eq-block .katex-display { margin: 0; }
  .eq-num { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
`;
}

/** KaTeX CSS 内联:读 katex.min.css,把相对字体引用改写为 file:// 绝对路径
 *  (katex.min.css 用 url(fonts/X.woff2),fonts 与 css 必须同级,file:// 下相对
 *  路径按 html 文件位置解析会失败,须绝对化),并追加打印/超宽保护规则。
 *  读取失败返回空串(公式仍渲染为 KaTeX HTML,仅缺字体样式,不抛错)。 */
export function loadKatexCss(katexDir: string): string {
  try {
    const fontsBase = path.join(katexDir, "fonts").replace(/\\/g, "/");
    const css = readFileSync(path.join(katexDir, "katex.min.css"), "utf8");
    return (
      css.replace(/url\(fonts\//g, `url(file://${fontsBase}/`) +
      "\n/* 批次 6:打印色彩保真 + 超宽公式保护(KaTeX 超宽溢出固有,保守处理) */\n" +
      "body { print-color-adjust: exact; }\n" +
      ".katex-display { max-width: 100%; overflow-x: auto; }\n"
    );
  } catch {
    return "";
  }
}

export function buildTemplate(bodyHtml: string, title: string, css: string, katexCss: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
${katexCss ? `<style>${katexCss}</style>` : ""}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * 封面 HTML:metadata.title 存在时生成。居中大标题(28pt)+ 作者/日期灰色小字,
 * 末尾 <div class="page-break"></div> 复用现有分页样式,封面独占一页。
 */
export function buildCoverHtml(metadata: DocMetadata | undefined): string {
  if (!metadata?.title) return "";
  const metaLine = [metadata.author, metadata.date].filter(Boolean).join(" · ");
  return (
    '<div class="cover">' +
    `<div class="cover-title">${escapeHtml(metadata.title)}</div>` +
    (metaLine ? `<div class="cover-meta">${escapeHtml(metaLine)}</div>` : "") +
    "</div>" +
    '<div class="page-break"></div>'
  );
}

