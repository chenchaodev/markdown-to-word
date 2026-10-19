/**
 * 剪贴板富文本片段的**内联样式构建器**(纯函数,零 IO)。
 *
 * 为什么全部写成内联 style:目标编辑器是 Word / WPS,经 CF_HTML 粘贴时不携带
 * `<style>` 或页面级 CSS;任何依赖 class 的样式都会在粘贴后失效。本模块只产出
 * `style="…"` 里的属性串,元素拼装归 render.ts / blocks.ts。
 *
 * 视觉取值来源(不新立常量模块):
 * - 内容区宽 pt = validatePageSetup(pageSetup).contentWidthMm / 25.4 × 72,四舍五入 1 位;
 * - 标题字号/间距、题注字号、行内/代码块字号全部走 settings/typography.ts 的共享
 *   推导函数(与 pdf/docx 同源),避免第三份字面量。
 *
 * 实测约束(见 docs/evidence 的剪贴板保真 spike):
 * - Word 丢弃 `<pre>` 的 background-color/border ⇒ 代码块改单格表格;
 * - Word 丢弃 `<blockquote>` 边框 ⇒ 引用块改单格表格;
 * - `border-left` 只能挂在 `<td>` 上(WPS 会对块级元素按行盒逐行画框);
 * - `width:100%` 表格在两端都溢出 ⇒ 一律写死 pt 宽,列宽也用 pt(Word 不认百分比列宽);
 * - Word 不认 CSS `table-layout` ⇒ 固定布局与零缩进另写 `mso-table-layout-alt` /
 *   `mso-table-lspace/rspace`;单元格补 `mso-padding-alt` / `mso-border-left-alt`;
 * - 中文字体槽独立 ⇒ 每个声明 `font-family` 的地方都跟一条 `mso-fareast-font-family`。
 */
import { validatePageSetup, type PageSetup } from "../settings/settings-defaults.js";
import {
  captionFontSizePt,
  codeBlockFontSizePt,
  headingFontSizePt,
  headingSpacingPt,
  inlineCodeFontSizePt,
  type TypographySettings,
} from "../settings/typography.js";

/** 正文色(与 pdf 模板 body 同值,避免粘贴后比 pdf 更深/更浅) */
export const BODY_COLOR = "#1f2328";
/** 标题色(与 pdf 模板 heading 色同值) */
export const HEADING_COLOR = "#1a1a1a";
/** 链接色(实测两端都可读,且与代码块左侧强调线同色系) */
export const LINK_COLOR = "#0070cc";

/** 数值 → CSS pt 字面量:最多两位小数,去掉无意义的尾零(7.5 / 12 / 13.38) */
export function formatPt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isFinite(rounded) ? String(rounded) : "0";
}

/**
 * 正文内容区宽(pt):唯一换算点。
 *
 * 使用 validatePageSetup(landscape 已按视觉方向交换),与 pdf 侧内容区宽同源;
 * 表格/代码块/引用块/图片上限都用这一个值,避免多份 pt 常量漂移。
 */
export function contentWidthPt(pageSetup: PageSetup): number {
  const { contentWidthMm } = validatePageSetup(pageSetup);
  return Math.round((contentWidthMm / 25.4) * 72 * 10) / 10;
}

/** 字体名转义(内联 style 用单引号包裹,故转义单引号与反斜杠) */
function cssFontName(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * 正文字体栈:中文优先、西文兜底(与 pdf 模板 body 的 font-family 同序)。
 * 用单引号包裹字体名,因为整串最终落在双引号包围的 style 属性里。
 */
export function bodyFontFamily(typography: TypographySettings): string {
  return `'${cssFontName(typography.fontEastAsia)}','${cssFontName(typography.fontAscii)}',sans-serif`;
}

/**
 * 正文字体声明单源:`font-family` 必须紧跟 `mso-fareast-font-family`。
 *
 * Word 把中文放在独立的 eastAsia 字体槽;只写 CSS `font-family` 时,粘贴后中文会
 * 回落到 Word 的默认中文字体(与用户排版设置脱钩)。实测官方文档口径:凡声明
 * `font-family` 的块/行内元素都补一条 `mso-fareast-font-family`。
 */
export function bodyFontDeclarations(typography: TypographySettings): string {
  return (
    `font-family:${bodyFontFamily(typography)};` +
    `mso-fareast-font-family:'${cssFontName(typography.fontEastAsia)}';`
  );
}

/** 代码字体栈:实测两端都稳定的等宽组合 */
export function codeFontFamily(): string {
  return "'Consolas',monospace";
}

/** 片段最外层 div:承载基础字体/字号/行距,内部元素仍各自带 style */
export function fragmentStyle(typography: TypographySettings): string {
  return (
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(typography.bodySizePt)}pt;` +
    `line-height:${typography.lineSpacing};` +
    `color:${BODY_COLOR};`
  );
}

/**
 * 正文段落样式。
 * 列表内段落由 `inList` 关闭首行缩进(否则列表项会出现二次缩进);其余设置
 * (对齐/行距/首行缩进)跟随用户排版设置。
 */
export function paragraphStyle(typography: TypographySettings, inList: boolean): string {
  const rules = [
    bodyFontDeclarations(typography).replace(/;$/, ""),
    `font-size:${formatPt(typography.bodySizePt)}pt`,
    `line-height:${typography.lineSpacing}`,
    "margin:0 0 6pt 0",
    `text-align:${typography.align}`,
  ];
  // 用 pt 而非 em:Word 粘贴路径对相对单位不可靠(实测 `em` 在表格/段落内常被忽略)
  if (!inList && typography.firstLineIndent) rules.push(`text-indent:${formatPt(typography.bodySizePt * 2)}pt`);
  return `${rules.join(";")};`;
}

/** 题注段落:居中、小一号字、无首行缩进(与 pdf/docx 题注观感同源) */
export function captionStyle(typography: TypographySettings): string {
  return (
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(captionFontSizePt(typography.bodySizePt))}pt;` +
    "line-height:1.5;" +
    "color:#333;" +
    "text-align:center;" +
    "margin:4pt 0 12pt 0;"
  );
}

/** 标题:字号/段前段后走共享推导(档位参数化),编号文本由渲染器写进标题文本 */
export function headingStyle(typography: TypographySettings, depth: number): string {
  const size = headingFontSizePt(typography.bodySizePt, typography.headingScale, depth);
  const spacing = headingSpacingPt(typography.headingSpacing, depth);
  return (
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(size)}pt;` +
    "font-weight:bold;" +
    `color:${HEADING_COLOR};` +
    `margin:${formatPt(spacing.before)}pt 0 ${formatPt(spacing.after)}pt 0;`
  );
}

/** 无序/有序列表容器(嵌套列表共用同一形态) */
export function listStyle(typography: TypographySettings): string {
  return `margin:0 0 6pt 0;padding-left:${formatPt(typography.bodySizePt * 2)}pt;`;
}

/** 列表项:紧凑间距 + 基础字体(tight list 没有段落元素,字体必须挂在 li 上) */
export function listItemStyle(typography: TypographySettings): string {
  return (
    "margin:2pt 0;" +
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(typography.bodySizePt)}pt;` +
    `line-height:${typography.lineSpacing};`
  );
}

/** 行内代码(字号走共享推导,不随标题字号放大) */
export function inlineCodeStyle(typography: TypographySettings): string {
  return (
    `font-family:${codeFontFamily()};` +
    `mso-fareast-font-family:'${cssFontName(typography.fontEastAsia)}';` +
    `font-size:${formatPt(inlineCodeFontSizePt(typography.bodySizePt))}pt;` +
    "background-color:#f0f0f0;" +
    "border:1pt solid #ddd;" +
    "padding:1pt 3pt;"
  );
}

/** 链接(内部锚点在渲染器里已降级为纯文本,不会带这个样式) */
export function linkStyle(): string {
  return `color:${LINK_COLOR};text-decoration:underline;`;
}

/** 图片:固定内容区宽为上限,高度自适应 */
export function imageStyle(widthPt: number): string {
  return `max-width:${formatPt(widthPt)}pt;height:auto;`;
}

/** 分页符(不占 `---` 的 hr 语义;`<!-- page-break -->` 专用) */
export function pageBreakHtml(): string {
  return '<p style="page-break-before:always;margin:0;font-size:1pt;line-height:1pt;">&#160;</p>';
}

/** 单格表格外壳(代码块/引用块共用;实测固定 pt 宽不溢出) */
export function blockTableStyle(widthPt: number): string {
  return (
    `border-collapse:collapse;width:${formatPt(widthPt)}pt;` +
    // Word 不认 CSS table-layout,固定布局必须走 mso-table-layout-alt;
    // 左右缩进清零,否则 Word 会给表格补默认 0.19cm 缩进导致右侧溢出。
    "mso-table-layout-alt:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;" +
    "margin:0 0 8pt 0;"
  );
}

/** 代码块单元格(实测通过形态,勿改成 `<pre>` 或百分比宽) */
export function codeCellStyle(typography: TypographySettings, widthPt: number): string {
  return (
    `width:${formatPt(widthPt)}pt;` +
    "background-color:#f5f5f5;" +
    "border:1pt solid #d0d0d0;" +
    "border-left:4pt solid #0070cc;" +
    "mso-border-left-alt:4pt solid #0070cc;" +
    "padding:8pt;" +
    "mso-padding-alt:8pt 8pt 8pt 8pt;" +
    `font-family:${codeFontFamily()};` +
    `mso-fareast-font-family:'${cssFontName(typography.fontEastAsia)}';` +
    `font-size:${formatPt(codeBlockFontSizePt(typography.bodySizePt))}pt;` +
    "line-height:1.5;" +
    "color:#222;" +
    "white-space:pre-wrap;"
  );
}

/** 引用块单元格(left border 只挂在 td 上:WPS 对块级元素按行盒逐行画框) */
export function quoteCellStyle(typography: TypographySettings, widthPt: number): string {
  return (
    `width:${formatPt(widthPt)}pt;` +
    "border-left:3pt solid #999999;" +
    "mso-border-left-alt:3pt solid #999999;" +
    "background-color:#fafafa;" +
    "padding:6pt 10pt;" +
    "mso-padding-alt:6pt 10pt 6pt 10pt;" +
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(typography.bodySizePt)}pt;` +
    "line-height:1.7;" +
    "color:#555;"
  );
}

/** GFM 表格:固定布局 + 固定 pt 宽(两端都不溢出) */
export function tableStyle(widthPt: number): string {
  return (
    `border-collapse:collapse;width:${formatPt(widthPt)}pt;` +
    "table-layout:fixed;" +
    // Word 忽略 CSS table-layout,固定布局与零缩进走 mso-* 属性
    "mso-table-layout-alt:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;" +
    "margin:0 0 8pt 0;"
  );
}

/**
 * 表头单元格:列宽写死 pt(Word 对百分比列宽不可靠;固定布局以首行为准)
 * + 表头底色。textAlign 来自 markdown-it 对齐语法(`:---:` 等)。
 */
export function headerCellStyle(
  widthPt: number,
  typography: TypographySettings,
  textAlign: string | undefined,
): string {
  return (
    `width:${formatPt(widthPt)}pt;` +
    "border:1pt solid #999;" +
    "mso-border-left-alt:1pt solid #999;" +
    "padding:5pt 7pt;" +
    "mso-padding-alt:5pt 7pt 5pt 7pt;" +
    "background-color:#f0f0f0;" +
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(typography.bodySizePt)}pt;` +
    "line-height:1.5;" +
    "font-weight:bold;" +
    (textAlign ? `text-align:${textAlign};` : "")
  );
}

/** 表格数据单元格 */
export function bodyCellStyle(
  typography: TypographySettings,
  textAlign: string | undefined,
): string {
  return (
    "border:1pt solid #999;" +
    "mso-border-left-alt:1pt solid #999;" +
    "padding:5pt 7pt;" +
    "mso-padding-alt:5pt 7pt 5pt 7pt;" +
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(typography.bodySizePt)}pt;` +
    "line-height:1.5;" +
    (textAlign ? `text-align:${textAlign};` : "")
  );
}

/** 脚注区标题/条目:字号与颜色与正文区分,避免依赖浏览器默认样式 */
export function footnoteListStyle(typography: TypographySettings): string {
  return (
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(captionFontSizePt(typography.bodySizePt))}pt;` +
    "line-height:1.5;" +
    "color:#555;" +
    "margin:0 0 6pt 0;" +
    `padding-left:${formatPt(typography.bodySizePt * 2)}pt;`
  );
}

/** 脚注引用上标(脚注链接已降级为纯文本,不生成内部锚点) */
export function footnoteRefStyle(typography: TypographySettings): string {
  return (
    `${bodyFontDeclarations(typography)}` +
    `font-size:${formatPt(captionFontSizePt(typography.bodySizePt))}pt;` +
    `color:${LINK_COLOR};`
  );
}
