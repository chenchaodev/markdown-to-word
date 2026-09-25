/**
 * PDF 文档模板 CSS:分页/基础排版/标题节奏/目录/代码高亮/编号/水印对齐规则。
 * 纯函数生成(输入 pageSetup/typography/编号开关,输出 CSS 文本),零 IO 零 DOM;
 * 与 HTML 组装分离——template.ts 负责模板结构与安全(TEMPLATE_CSP/sanitizeStyleCss),
 * render.ts 编排两者。
 */
import {
  headingFontSizePt,
  headingSpacingPt,
  type TypographySettings,
} from "../settings/typography.js";
import type { PageSetup } from "../settings/settings-defaults.js";
import { buildHljsCss } from "../style/hljs-palette.js";

/**
  * h1-h6 规则生成:字号/段前段后间距由 headingScale/headingSpacing 档位经
  * core/settings/typography.ts 纯函数换算(与 docx 侧同源,双格式观感对齐);
  * 装饰性样式固定:h1/h2 下边线 + padding-bottom,h5/h6 弱化灰。
  */
function buildHeadingRules(typography: TypographySettings): string {
  const rules: string[] = [];
  for (let level = 1; level <= 6; level++) {
    const size = headingFontSizePt(typography.bodySizePt, typography.headingScale, level);
    const spacing = headingSpacingPt(typography.headingSpacing, level);
    const border =
      level === 1
        ? " border-bottom: 2px solid #d0d7de; padding-bottom: 8px;"
        : level === 2
          ? " border-bottom: 1px solid #d0d7de; padding-bottom: 6px;"
          : "";
    const color = level >= 5 ? " color: #57606a;" : "";
    rules.push(
      `  h${level} { font-size: ${size}pt; margin: ${spacing.before}pt 0 ${spacing.after}pt;${border}${color} }`,
    );
  }
  return rules.join("\n");
}

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

  /* 标题节奏:字号/段前段后间距由 headingScale/headingSpacing
     档位参数化,与 docx 侧同源换算(core/settings/typography.ts 纯函数,standard 档
     = 升级前固定值);h1/h2 下边线锚定章节,3-6 级靠字号与间距区分;
     标题行高收紧,且不与后续内容分离(break-after: avoid,避免孤立标题) */
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; break-after: avoid; }
${buildHeadingRules(typography)}
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
  /* 目录页码:条目与页码两端对齐 + 点线引导,页码右置灰色 */
  .toc li { display: flex; align-items: baseline; }
  .toc li a { flex: 1 1 auto; display: flex; align-items: baseline; color: inherit; text-decoration: none; }
  .toc li a::after { content: ""; flex: 1 1 auto; border-bottom: 1px dotted #c8c8c8; margin: 0 .4em .35em; min-width: 1.5em; }
  .toc-page { flex: 0 0 auto; color: #888; margin-left: .3em; }

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
  /* 独立成段图片(figure 语义):居中渲染,首行缩进/两端对齐不适用;
     紧随的 .fig-caption 题注保持在图下方(编号机制不变) */
  p.fig-image { text-align: center; text-indent: 0; }
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

  /* 代码高亮(GitHub Light 色板;printBackground 打印背景)。
     色板与选择器组由 core/style/hljs-palette.ts 单源生成(与 docx 逐 token 着色同源) */
${buildHljsCss()}
${breakBeforeH1 ? `
  /* 一级标题前分页(breakBeforeH1);文档首元素为 h1 时避免空白首页 */
  h1 { break-before: page; }
  body > h1:first-child { break-before: auto; }` : ""}
${headingNumbering ? (
  hasH1 ? `
  /* 章节编号:与 docx 标题编号语义一致(1 / 1.1 / 1.1.1) */
  body { counter-reset: h1c h2c h3c; }
  h1 { counter-increment: h1c; counter-reset: h2c h3c; }
  h2 { counter-increment: h2c; counter-reset: h3c; }
  h3 { counter-increment: h3c; }
  h1::before { content: counter(h1c) " "; }
  h2::before { content: counter(h1c) "." counter(h2c) " "; }
  h3::before { content: counter(h1c) "." counter(h2c) "." counter(h3c) " "; }` : `
  /* 章节编号(无 h1 文档,统一 Word 口径):跳过前导零级,
     h2 从「1」起(::before 省略 h1c 前缀),与 xref_recognize 登记的引用
     编号文本(heading-numbering.ts 共享纯函数)一致。已知罕见边界:无 h1 且
     首个标题前无 h2 的 h3,CSS 显示「0.1」而引用文本为「1」——CSS counter
     无法按计数器取值条件省略中间零级,验收已声明接受。 */
  body { counter-reset: h2c h3c; }
  h2 { counter-increment: h2c; counter-reset: h3c; }
  h3 { counter-increment: h3c; }
  h2::before { content: counter(h2c) " "; }
  h3::before { content: counter(h2c) "." counter(h3c) " "; }`) : ""}
${captionNumbering ? `
  /* 题注编号:图/表题注居中小一号,编号经 ::before 伪元素(不进文本节点,
     书签/目录不受影响);章节号 = 最近 h1,图/表序在 h1 处重置(与 docx 侧
     SEQ \s 1 语义一致)。文档无 h1 时退化为纯序数(全文档连续,与 docx 对齐) */
  .fig-caption, .tab-caption { text-align: center; font-size: 10pt; margin: 4px 0 12px; break-inside: avoid; }
  /* 图/表序自增(遗留修复:此前缺 counter-increment,序数恒为 0,
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
  /* 公式块:display 公式居中,编号右缘垂直居中(编号绝对定位,
     KaTeX display 外边距归零避免与公式块外边距双重叠加) */
  .eq-block { position: relative; text-align: center; margin: 1em 0; }
  .eq-block .katex-display { margin: 0; }
  .eq-num { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
`;
}
