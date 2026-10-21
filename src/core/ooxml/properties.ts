/**
 * OOXML 属性词汇:run/段落两套属性集的形状定义 + 从 XML 元素抽属性的纯函数 + 合并规则。
 * 为什么单独成文件:样式表解析(part-styles.ts)与文档树解析(part-document.ts)读的是同一批
 * 属性元素(w:rPr / w:pPr),形状与合并规则若各写一份就会漂移 —— 一处改了字段名另一处不认,
 * 症状是「样式解析对、文档解析错」。故形状与抽取都收在此处,那两份只 import。
 * 形状约定:
 * ① 数值一律用 OOXML 原生单位(字号半磅 w:sz、缩进/行距 twip、级别序号 w:ilvl),换算归消费方
 *    —— 解析层不做单位转换,免得同一个数在两处被换两次。
 * ② 属性缺失与「显式置零」要能区分:缺失 ⇒ 该字段 absent(不覆写继承链上的值);
 *    显式 0 ⇒ 字段在(覆写)。
 * ③ 主题引用(asciiTheme 这类)与显式字体名并存留两处字段,不互相抹除:OOXML 里主题引用优先于
 *    显式名,但「优先」要结合 theme 部件才能判,那是消费方(步 #02)的事。
 * 互指:属性元素的本地名约定见 src/core/ooxml/xml.ts(一律按本地名匹配,不写死前缀)。
 */
import { attrOf, childOf, numAttr, toggleOf, type XmlElement } from "./xml.js";

/** 字体集合(w:rFonts):显式字体名与主题引用分列 */
export interface RunFonts {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
  asciiTheme?: string;
  hAnsiTheme?: string;
  eastAsiaTheme?: string;
  csTheme?: string;
}

/** 字符级属性(w:rPr) */
export interface RunProperties {
  fonts?: RunFonts;
  /** 字符样式 id(w:rStyle) */
  runStyle?: string;
  /** 字号(半磅,w:sz 的原值) */
  sizeHalfPoints?: number;
  /** 复杂文种字号(半磅,w:szCs);与 sizeHalfPoints 分列,不混用 */
  sizeCsHalfPoints?: number;
  bold?: boolean;
  italic?: boolean;
  /** 下划线形态(w:u 的 val,如 "single";无 val 时按 "single" 记) */
  underline?: string;
  /** 颜色(w:color 的 val,十六进制串或 "auto") */
  color?: string;
  /** 上下标(w:vertAlign 的 val:superscript / subscript) */
  vertAlign?: string;
}

/** 缩进(w:ind):字符单位字段与缇单位字段分列 */
export interface ParagraphIndent {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  leftChars?: number;
  rightChars?: number;
  firstLineChars?: number;
  hangingChars?: number;
}

/** 段间距(w:spacing) */
export interface ParagraphSpacing {
  before?: number;
  after?: number;
  /** 行距值(w:line) */
  line?: number;
  /** 行距规则(w:lineRule:auto/exact/atLeast) */
  lineRule?: string;
  beforeLines?: number;
  afterLines?: number;
}

/** 编号引用(w:numPr) */
export interface ParagraphNumbering {
  numId: string;
  /** 级别(w:ilvl;缺省 0) */
  level: number;
}

/** 段落级属性(w:pPr) */
export interface ParagraphProperties {
  /** 段落样式 id(w:pStyle) */
  style?: string;
  align?: string;
  indent?: ParagraphIndent;
  spacing?: ParagraphSpacing;
  numbering?: ParagraphNumbering;
  pageBreakBefore?: boolean;
  /** 大纲级别(w:outlineLvl) */
  outlineLevel?: number;
}

/**
 * 从 w:rPr 元素读字符级属性(元素为 null ⇒ 空属性集)。
 * @param rPr w:rPr 元素(可空)
 * @returns 字符级属性
 */
export function readRunProperties(rPr: XmlElement | null): RunProperties {
  const out: RunProperties = {};
  if (!rPr) return out;
  const fontsEl = childOf(rPr, "rFonts");
  if (fontsEl) {
    const fonts: RunFonts = {};
    const ascii = attrOf(fontsEl, "ascii");
    const hAnsi = attrOf(fontsEl, "hAnsi");
    const eastAsia = attrOf(fontsEl, "eastAsia");
    const cs = attrOf(fontsEl, "cs");
    const asciiTheme = attrOf(fontsEl, "asciiTheme");
    const hAnsiTheme = attrOf(fontsEl, "hAnsiTheme");
    const eastAsiaTheme = attrOf(fontsEl, "eastAsiaTheme");
    const csTheme = attrOf(fontsEl, "csTheme") ?? attrOf(fontsEl, "cstheme");
    if (ascii !== undefined) fonts.ascii = ascii;
    if (hAnsi !== undefined) fonts.hAnsi = hAnsi;
    if (eastAsia !== undefined) fonts.eastAsia = eastAsia;
    if (cs !== undefined) fonts.cs = cs;
    if (asciiTheme !== undefined) fonts.asciiTheme = asciiTheme;
    if (hAnsiTheme !== undefined) fonts.hAnsiTheme = hAnsiTheme;
    if (eastAsiaTheme !== undefined) fonts.eastAsiaTheme = eastAsiaTheme;
    if (csTheme !== undefined) fonts.csTheme = csTheme;
    if (Object.keys(fonts).length > 0) out.fonts = fonts;
  }
  const runStyle = attrOf(childOf(rPr, "rStyle"), "val");
  if (runStyle !== undefined) out.runStyle = runStyle;
  const size = numAttr(childOf(rPr, "sz"), "val");
  if (size !== undefined) out.sizeHalfPoints = size;
  const sizeCs = numAttr(childOf(rPr, "szCs"), "val");
  if (sizeCs !== undefined) out.sizeCsHalfPoints = sizeCs;
  const bold = toggleOf(childOf(rPr, "b"));
  if (bold !== undefined) out.bold = bold;
  const italic = toggleOf(childOf(rPr, "i"));
  if (italic !== undefined) out.italic = italic;
  const underlineEl = childOf(rPr, "u");
  if (underlineEl) {
    const underline = attrOf(underlineEl, "val");
    out.underline = underline === undefined ? "single" : underline;
  }
  const color = attrOf(childOf(rPr, "color"), "val");
  if (color !== undefined) out.color = color;
  const vertAlign = attrOf(childOf(rPr, "vertAlign"), "val");
  if (vertAlign !== undefined) out.vertAlign = vertAlign;
  return out;
}

/**
 * 从 w:pPr 元素读段落级属性(元素为 null ⇒ 空属性集)。
 * @param pPr w:pPr 元素(可空)
 * @returns 段落级属性
 */
export function readParagraphProperties(pPr: XmlElement | null): ParagraphProperties {
  const out: ParagraphProperties = {};
  if (!pPr) return out;
  const style = attrOf(childOf(pPr, "pStyle"), "val");
  if (style !== undefined) out.style = style;
  const align = attrOf(childOf(pPr, "jc"), "val");
  if (align !== undefined) out.align = align;
  const indentEl = childOf(pPr, "ind");
  if (indentEl) {
    const indent: ParagraphIndent = {};
    const left = numAttr(indentEl, "left");
    const right = numAttr(indentEl, "right");
    const firstLine = numAttr(indentEl, "firstLine");
    const hanging = numAttr(indentEl, "hanging");
    const leftChars = numAttr(indentEl, "leftChars");
    const rightChars = numAttr(indentEl, "rightChars");
    const firstLineChars = numAttr(indentEl, "firstLineChars");
    const hangingChars = numAttr(indentEl, "hangingChars");
    if (left !== undefined) indent.left = left;
    if (right !== undefined) indent.right = right;
    if (firstLine !== undefined) indent.firstLine = firstLine;
    if (hanging !== undefined) indent.hanging = hanging;
    if (leftChars !== undefined) indent.leftChars = leftChars;
    if (rightChars !== undefined) indent.rightChars = rightChars;
    if (firstLineChars !== undefined) indent.firstLineChars = firstLineChars;
    if (hangingChars !== undefined) indent.hangingChars = hangingChars;
    if (Object.keys(indent).length > 0) out.indent = indent;
  }
  const spacingEl = childOf(pPr, "spacing");
  if (spacingEl) {
    const spacing: ParagraphSpacing = {};
    const before = numAttr(spacingEl, "before");
    const after = numAttr(spacingEl, "after");
    const line = numAttr(spacingEl, "line");
    const lineRule = attrOf(spacingEl, "lineRule");
    const beforeLines = numAttr(spacingEl, "beforeLines");
    const afterLines = numAttr(spacingEl, "afterLines");
    if (before !== undefined) spacing.before = before;
    if (after !== undefined) spacing.after = after;
    if (line !== undefined) spacing.line = line;
    if (lineRule !== undefined) spacing.lineRule = lineRule;
    if (beforeLines !== undefined) spacing.beforeLines = beforeLines;
    if (afterLines !== undefined) spacing.afterLines = afterLines;
    if (Object.keys(spacing).length > 0) out.spacing = spacing;
  }
  const numPr = childOf(pPr, "numPr");
  if (numPr) {
    const numId = attrOf(childOf(numPr, "numId"), "val");
    if (numId !== undefined) {
      const level = numAttr(childOf(numPr, "ilvl"), "val");
      out.numbering = { numId, level: level ?? 0 };
    }
  }
  const pageBreakBefore = toggleOf(childOf(pPr, "pageBreakBefore"));
  if (pageBreakBefore !== undefined) out.pageBreakBefore = pageBreakBefore;
  const outlineLevel = numAttr(childOf(pPr, "outlineLvl"), "val");
  if (outlineLevel !== undefined) out.outlineLevel = outlineLevel;
  return out;
}

/**
 * 合并两套字符级属性(后者覆盖前者;字体集合逐字段合并)。
 * @param base 基线(通常是继承链上更靠近根的那一层)
 * @param over 覆盖层(更派生的一层)
 * @returns 合并结果
 */
export function mergeRunProperties(base: RunProperties, over: RunProperties): RunProperties {
  const out: RunProperties = { ...base };
  if (over.fonts) out.fonts = { ...(base.fonts ?? {}), ...over.fonts };
  if (over.runStyle !== undefined) out.runStyle = over.runStyle;
  if (over.sizeHalfPoints !== undefined) out.sizeHalfPoints = over.sizeHalfPoints;
  if (over.sizeCsHalfPoints !== undefined) out.sizeCsHalfPoints = over.sizeCsHalfPoints;
  if (over.bold !== undefined) out.bold = over.bold;
  if (over.italic !== undefined) out.italic = over.italic;
  if (over.underline !== undefined) out.underline = over.underline;
  if (over.color !== undefined) out.color = over.color;
  if (over.vertAlign !== undefined) out.vertAlign = over.vertAlign;
  return out;
}

/**
 * 合并两套段落级属性(后者覆盖后者;缩进/间距逐字段合并)。
 * @param base 基线
 * @param over 覆盖层
 * @returns 合并结果
 */
export function mergeParagraphProperties(base: ParagraphProperties, over: ParagraphProperties): ParagraphProperties {
  const out: ParagraphProperties = { ...base };
  if (over.style !== undefined) out.style = over.style;
  if (over.align !== undefined) out.align = over.align;
  if (over.indent) out.indent = { ...(base.indent ?? {}), ...over.indent };
  if (over.spacing) out.spacing = { ...(base.spacing ?? {}), ...over.spacing };
  if (over.numbering !== undefined) out.numbering = over.numbering;
  if (over.pageBreakBefore !== undefined) out.pageBreakBefore = over.pageBreakBefore;
  if (over.outlineLevel !== undefined) out.outlineLevel = over.outlineLevel;
  return out;
}
