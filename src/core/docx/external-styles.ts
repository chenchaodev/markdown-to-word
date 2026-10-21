/**
 * 本仓补进 docx 样式表的 6 个样式(外部 XML 片段):产物样式表「本仓侧」的唯一来源。
 *
 * 为什么要有这 6 个样式(ADR-086 §一):库(docx@9.x)只写 `w:docDefaults` + 16 个内置样式,
 * **不写 `Normal` / `DefaultParagraphFont`**,而内置样式与目录条目却引用它们
 * (`basedOn="Normal"`、`basedOn="DefaultParagraphFont"`、`pStyle="TOC1"`、`rStyle="IndexLink"`)
 * ⇒ 产物样式表带 4 处悬空引用:任何按 styleId 查样式的工具(Pandoc / python-docx / Word 的
 * 「修改样式」面板)都查不到,目录层级样式也不生效。本文件补齐这一层,让产物**自洽**。
 *
 * 两个必须记住的坑(库行为,实测见 ADR-086):
 * ① **`externalStyles` 与 `options.styles.paragraphStyles`/`characterStyles` 互斥** ——
 *    库走 external 分支时(`File` 构造里那个 `else if`)后两者被**整段丢弃**。
 *    ⇒ 本仓所有自定义样式**只**放外部 XML,绝不再往 `options.styles` 里加。
 * ② **外部 XML 的根属性接管了 `styles.xml` 的命名空间集** —— 库默认那套
 *    (`mc`/`r`/`w`/`w14`/`w15` + `mc:Ignorable="w14 w15"`)会被本文件的根属性**替换**,
 *    且库**不拦**未声明前缀(实测 `mc:Ignorable` 写未声明前缀时库原样透传 ⇒ 产物成 MCE
 *    非法文档、Word 可能弹「内容有问题」)⇒ 命名空间从此是本仓的责任,由产物级判据兜住
 *    (src/core/ooxml/package-integrity.ts 的 C6)。
 *
 * 分层归属(ADR-086 §一):`w:docDefaults` 仍由库写(`options.styles.default` → typography
 * 设置单源);库内置 16 样式仍由库写(**不 fork**);本文件只补缺失的这 6 个。
 * ⇒ `Normal` 与 `DefaultParagraphFont` **不带 rPr**:正文属性继续唯一来自 `w:docDefaults`
 * (`theme.ts` 集中配置),不在样式里产生第二真源。
 * 外部 XML **只放 `w:style` 元素**:放 `docDefaults` 会重复(库里永远产一份),放
 * `w:latentStyles` 会序列违规(合并分支只能追加到末尾,而 `CT_Styles` 要求它在所有
 * `w:style` 之前)⇒ 两者**有意不补**(理由入 ADR-086,不落常驻告警判据)。
 *
 * 互指:缩进阶梯常量在 src/core/docx/theme.ts(样式常量集中配置);消费方是
 * src/core/docx/render.ts(唯一的 `externalStyles` 接线点);判据在
 * src/core/ooxml/package-integrity.ts。
 */
import { TOC_INDENT_LADDER_TWIPS } from "./theme.js";

/**
 * 外部样式片段的命名空间集。
 *
 * ⚠ **与库默认集逐字一致**(库那套来自 `DocumentAttributeNamespaces`:mc/r/w/w14/w15 +
 * `mc:Ignorable="w14 w15"`):根属性**接管** `styles.xml` 的命名空间集(坑 ②),
 * 少声明一个前缀,产物里用到它的元素就成了未声明前缀 ⇒ MCE 非法。
 */
const STYLE_ROOT_NAMESPACES = [
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"',
].join(" ");

/**
 * 目录条目样式的层级(1/2/3);与 `TOC_INDENT_LADDER_TWIPS` 的下标一一对应。
 *
 * ⚠ 缓存目录条目的 `w:pPr` 里**只有 `w:tabs`(点线引导 + 右对齐制表位),没有 `w:ind`**
 * ⇒ 层级缩进**只能来自样式定义**,且 static 模式下条目永不重生成 ⇒ styles.xml 的
 * 这三档定义是缩进的唯一来源。
 */
const TOC_LEVELS = [1, 2, 3] as const;

/**
 * 取某级目录样式的缩进值(twips)。
 * @param level 层级(1 起)
 * @returns 缩进 twips;阶梯缺该级时回落 0
 */
function tocIndentOf(level: number): number {
  return TOC_INDENT_LADDER_TWIPS[level - 1] ?? 0;
}

/**
 * 造一个目录条目段落样式(`TOC1`/`TOC2`/`TOC3`)。
 * @param level 层级(1 起)
 * @returns `w:style` 元素 XML
 */
function tocStyleXml(level: number): string {
  return [
    `  <w:style w:type="paragraph" w:styleId="TOC${level}">`,
    `    <w:name w:val="toc ${level}"/>`,
    `    <w:basedOn w:val="Normal"/>`,
    `    <w:next w:val="Normal"/>`,
    `    <w:uiPriority w:val="39"/>`,
    `    <w:pPr><w:ind w:left="${tocIndentOf(level)}"/></w:pPr>`,
    `  </w:style>`,
  ].join("\n");
}

/**
 * 造本仓补的外部样式 XML(`w:styles` 根 + 6 个 `w:style` 元素)。
 *
 * 纯函数、零 IO:产物只由常量与 `theme.ts` 的缩进阶梯决定。
 *
 * 元素顺序遵循 `CT_Style` 序列(name → basedOn → next → uiPriority → semiHidden →
 * unhideWhenUsed → qFormat → pPr → rPr);`w:style` 之间的顺序不影响规范,但按「默认样式
 * 在前、目录样式居中、字符样式在后」排,便于人读。
 *
 * @returns 外部样式 XML 文本(交给库的 `options.externalStyles`)
 */
export function buildExternalStylesXml(): string {
  return [
    `<w:styles ${STYLE_ROOT_NAMESPACES} mc:Ignorable="w14 w15">`,
    `  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">`,
    `    <w:name w:val="Normal"/>`,
    `    <w:qFormat/>`,
    `  </w:style>`,
    `  <w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">`,
    `    <w:name w:val="Default Paragraph Font"/>`,
    `    <w:uiPriority w:val="1"/>`,
    `    <w:semiHidden/>`,
    `    <w:unhideWhenUsed/>`,
    `  </w:style>`,
    ...TOC_LEVELS.map((level) => tocStyleXml(level)),
    `  <w:style w:type="character" w:styleId="IndexLink">`,
    `    <w:name w:val="Index Link"/>`,
    `    <w:basedOn w:val="DefaultParagraphFont"/>`,
    `    <w:uiPriority w:val="99"/>`,
    `    <w:unhideWhenUsed/>`,
    `  </w:style>`,
    `</w:styles>`,
  ].join("\n");
}
