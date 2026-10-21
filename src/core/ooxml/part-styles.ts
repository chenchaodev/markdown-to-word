/**
 * 样式部件(word/styles.xml)解析:读 docDefaults 与全部 w:style,并按 basedOn 链解出继承后的完整属性。
 * 为什么本文件是本层的核心:模板深导入(步 #02)吃不吃得下真实模板,取决于继承链解得对不对 ——
 * 模板里「标题 1」往往只写 basedOn 一句,字体字号全在祖先样式上;不解继承就会只拿到空壳。
 * 不变量:
 * ① 继承按 basedOn 链多层合并,越派生越靠后覆盖;docDefaults 是所有样式的底。
 * ② 链成环(A basedOn B、B 又 basedOn A)不死循环:判为不可解析,只返回该样式自身属性 +
 *    cycle 标记,由消费方决定降级口径。
 * ③ 属性合并到「子字段」粒度(字体集合逐字段),不整块替换 —— 否则派生样式只写 eastAsia 就会
 *    把祖先的 ascii 抹掉。
 * 互指:属性形状与合并规则在 src/core/ooxml/properties.ts;XML 读取原语在 src/core/ooxml/xml.ts。
 */
import {
  mergeParagraphProperties,
  mergeRunProperties,
  readParagraphProperties,
  readRunProperties,
  type ParagraphProperties,
  type RunProperties,
} from "./properties.js";
import { attrOf, boolAttr, childOf, childrenOf, parseXml } from "./xml.js";

/** 一个 w:style(自身属性,未解继承) */
export interface OoxmlStyle {
  styleId: string;
  /** w:type:paragraph / character / table / numbering */
  type?: string;
  /** w:name 的 val(显示名) */
  name?: string;
  /** w:basedOn 的 val(父样式 id) */
  basedOn?: string;
  /** w:next 的 val(后继样式 id;按 Enter 后接的段落样式) */
  next?: string;
  /** w:link 的 val(配对样式 id;段落样式 ↔ 字符样式的成对引用) */
  link?: string;
  /** w:default="1":该类型下的默认样式 */
  isDefault?: boolean;
  /** w:customStyle="1":自定义样式(非内置) */
  custom?: boolean;
  run: RunProperties;
  paragraph: ParagraphProperties;
}

/** 样式表:文档默认属性 + 全部样式 */
export interface StyleTable {
  docDefaults: {
    run: RunProperties;
    paragraph: ParagraphProperties;
  };
  /** 按 styleId 索引 */
  styles: Map<string, OoxmlStyle>;
}

/** 解继承后的样式 */
export interface ResolvedStyle {
  styleId: string;
  run: RunProperties;
  paragraph: ParagraphProperties;
  /** basedOn 链(自样式起向上,根在末尾);环时为已访问到的部分 */
  chain: string[];
  /** 继承链成环 ⇒ 该样式判为不可解析(只含自身属性 + docDefaults) */
  cycle: boolean;
}

/**
 * 解析样式部件。
 * @param xml word/styles.xml 文本(缺部件时传 null/空串 ⇒ 空表)
 * @returns 样式表(部件缺失/畸形 ⇒ 空表)
 */
export function parseStyles(xml: string | null | undefined): StyleTable {
  const table: StyleTable = {
    docDefaults: { run: {}, paragraph: {} },
    styles: new Map<string, OoxmlStyle>(),
  };
  const root = parseXml(xml);
  if (!root) return table;
  const defaults = childOf(root, "docDefaults");
  if (defaults) {
    table.docDefaults.run = readRunProperties(childOf(childOf(defaults, "rPrDefault"), "rPr"));
    table.docDefaults.paragraph = readParagraphProperties(childOf(childOf(defaults, "pPrDefault"), "pPr"));
  }
  for (const el of childrenOf(root, "style")) {
    const styleId = attrOf(el, "styleId");
    if (styleId === undefined || styleId === "") continue;
    const style: OoxmlStyle = {
      styleId,
      type: attrOf(el, "type"),
      name: attrOf(childOf(el, "name"), "val"),
      basedOn: attrOf(childOf(el, "basedOn"), "val"),
      next: attrOf(childOf(el, "next"), "val"),
      link: attrOf(childOf(el, "link"), "val"),
      isDefault: boolAttr(el, "default") === true ? true : undefined,
      custom: boolAttr(el, "customStyle") === true ? true : undefined,
      run: readRunProperties(childOf(el, "rPr")),
      paragraph: readParagraphProperties(childOf(el, "pPr")),
    };
    table.styles.set(styleId, style);
  }
  return table;
}

/**
 * 取文档默认属性(docDefaults)。
 * @param table 样式表
 * @returns 默认 run/段落属性
 */
export function getDocDefaults(table: StyleTable): { run: RunProperties; paragraph: ParagraphProperties } {
  return { run: { ...table.docDefaults.run }, paragraph: { ...table.docDefaults.paragraph } };
}

/**
 * 列出全部样式 id。
 * @param table 样式表
 * @returns 样式 id 列表
 */
export function styleIds(table: StyleTable): string[] {
  return [...table.styles.keys()];
}

/**
 * 取某类型下的默认样式(w:default="1" 的那个;模板里「正文」常是它)。
 * @param table 样式表
 * @param type 样式类型(如 "paragraph")
 * @returns 样式 id;该类型没有默认样式 ⇒ undefined
 */
export function defaultStyleId(table: StyleTable, type: string): string | undefined {
  for (const style of table.styles.values()) {
    if (style.type === type && style.isDefault) return style.styleId;
  }
  return undefined;
}

/**
 * 沿 basedOn 链上行,记录链与是否成环。
 * @param table 样式表
 * @param styleId 起始样式 id
 * @returns 链(自样式起向上)与环标记
 */
function chainOf(table: StyleTable, styleId: string): { chain: string[]; cycle: boolean } {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = styleId;
  let cycle = false;
  while (current !== undefined) {
    if (seen.has(current)) {
      cycle = true;
      break;
    }
    const style = table.styles.get(current);
    if (!style) break;
    seen.add(current);
    chain.push(current);
    current = style.basedOn;
  }
  return { chain, cycle };
}

/**
 * 按 styleId 取解继承后的样式;无此样式 ⇒ null。
 * @param table 样式表
 * @param styleId 样式 id
 * @returns 解继承后的样式或 null
 */
export function resolveStyle(table: StyleTable, styleId: string): ResolvedStyle | null {
  const own = table.styles.get(styleId);
  if (!own) return null;
  const { chain, cycle } = chainOf(table, styleId);
  let run: RunProperties = { ...table.docDefaults.run };
  let paragraph: ParagraphProperties = { ...table.docDefaults.paragraph };
  if (cycle) {
    // 继承链成环:判为不可解析,只并入该样式自身属性(不猜祖先次序)
    run = mergeRunProperties(run, own.run);
    paragraph = mergeParagraphProperties(paragraph, own.paragraph);
  } else {
    for (const id of [...chain].reverse()) {
      const style = table.styles.get(id);
      if (!style) continue;
      run = mergeRunProperties(run, style.run);
      paragraph = mergeParagraphProperties(paragraph, style.paragraph);
    }
  }
  return { styleId, run, paragraph, chain, cycle };
}

/**
 * 取样式的段落级别(w:outlineLvl),供「标题层级」类映射用;无则 undefined。
 * @param table 样式表
 * @param styleId 样式 id
 * @returns 大纲级别或 undefined
 */
export function styleOutlineLevel(table: StyleTable, styleId: string): number | undefined {
  const style = table.styles.get(styleId);
  if (!style) return undefined;
  const own = style.paragraph.outlineLevel;
  if (own !== undefined) return own;
  const resolved = resolveStyle(table, styleId);
  return resolved?.paragraph.outlineLevel;
}

/**
 * 取样式自身的 w:styleId 对应的 w:name(显示名);无则 undefined。
 * @param table 样式表
 * @param styleId 样式 id
 * @returns 显示名或 undefined
 */
export function styleDisplayName(table: StyleTable, styleId: string): string | undefined {
  const style = table.styles.get(styleId);
  if (!style) return undefined;
  return style.name;
}

/** 供消费方核对:样式表里某个 id 的 w:type(未登记 ⇒ undefined) */
export function styleType(table: StyleTable, styleId: string): string | undefined {
  return table.styles.get(styleId)?.type;
}

/** 供消费方核对:样式表里某个 id 的 w:basedOn(未登记 ⇒ undefined) */
export function styleBasedOn(table: StyleTable, styleId: string): string | undefined {
  return table.styles.get(styleId)?.basedOn;
}
