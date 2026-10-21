/**
 * 文档部件(word/document.xml)解析:产出结构化文档树(段落 / 表格 / 其内游程与内联对象)与节属性。
 * 本文件只产「中间表示」,不产 Markdown、不产 mdast —— 那是回读层(步 #03)的事;本层不知道
 * Markdown 语法,也不知道本仓的转换选项。
 * 不变量:
 * ① 段落内元素保序:文本游程、超链接、图片、域、修订、批注按文档序排在 items 里,消费方
 *    按序回放即可还原阅读顺序(顺序一乱,图文混排的稿子就会读错)。
 * ② 一切按本地名匹配(w:p / w:r / w:t / a:blip / wp:extent …),前缀不写死。
 * ③ 畸形输入尽力解析 + 降级,不抛:读不到的关系、图片、域都留空位而不是丢整段。
 * 已知不覆盖(登记在此,步 #03 才知道自家稿是否命中):VML 老式图片(w:pict)、域的分隔/结束
 * 游程(w:fldChar,只保留指令文本)、移动修订(w:moveFrom/w:moveTo)、符号游程(w:sym)。
 * 互指:关系解析在 src/core/ooxml/part-rels.ts;属性形状在 src/core/ooxml/properties.ts。
 */
import {
  readParagraphProperties,
  readRunProperties,
  type ParagraphIndent,
  type ParagraphNumbering,
  type ParagraphSpacing,
  type RunProperties,
} from "./properties.js";
import { findRelationship, type RelationshipMap } from "./part-rels.js";
import { attrOf, childOf, childrenOf, findDescendant, findDescendants, numAttr, parseXml, type XmlElement } from "./xml.js";

/** 一个游程(w:r) */
export interface DocumentRun {
  /** 文本(w:t 与修订删除文本 w:delText 的合并;无文本则空串) */
  text: string;
  /** 换行数(w:br) */
  breaks: number;
  /** 制表符数(w:tab) */
  tabs: number;
  /** 游程属性(w:rPr) */
  properties: RunProperties;
  /**
   * run 级字符样式 id(w:rPr/w:rStyle 的 val)。
   *
   * 与 `properties.runStyle` 同值:后者是 `w:rPr` 全量属性集里的那个字段,本字段是给
   * 「样式引用闭合性」判据用的**便捷出口**(判据要按游程逐个收集样式引用)。
   * 值只取一次(读 `w:rPr` 得到属性集,本字段从属性集取),不存在第二份真源。
   */
  rStyle?: string;
}

/** 段落内的有序条目 */
export type ParagraphItem =
  | { kind: "run"; run: DocumentRun }
  | {
      kind: "hyperlink";
      /** 关系 id(r:id);内部锚点链接无此字段 */
      relationshipId?: string;
      /** 内部锚点(w:anchor) */
      anchor?: string;
      external: boolean;
      /** 关系里的原始目标(外部为 URL) */
      target?: string;
      items: ParagraphItem[];
    }
  | {
      kind: "drawing";
      /** 图片关系 id(a:blip 的 r:embed) */
      relationshipId?: string;
      /** 关系里的原始目标 */
      target?: string;
      /** 宽(EMU,w:drawing 里的 wp:extent 的 cx) */
      widthEmu?: number;
      /** 高(EMU,wp:extent 的 cy) */
      heightEmu?: number;
    }
  | {
      kind: "field";
      /** 域形态:简单域(w:fldSimple)或指令流(w:instrText) */
      form: "simple" | "instrText";
      /** 域指令(如 PAGE / TOC) */
      instruction: string;
      items: ParagraphItem[];
    }
  | {
      kind: "revision";
      /** 修订形态:插入(w:ins)或删除(w:del) */
      form: "insertion" | "deletion";
      author?: string;
      date?: string;
      items: ParagraphItem[];
    }
  | { kind: "commentStart"; commentId: string }
  | { kind: "commentEnd"; commentId: string }
  | { kind: "commentReference"; commentId: string }
  | { kind: "bookmark"; name?: string; id?: string };

/** 一个段落(w:p) */
export interface DocumentParagraph {
  kind: "paragraph";
  /** 段落样式 id(w:pStyle) */
  style?: string;
  /** 编号引用(w:numPr) */
  numbering?: ParagraphNumbering;
  align?: string;
  indent?: ParagraphIndent;
  spacing?: ParagraphSpacing;
  pageBreakBefore?: boolean;
  /** 大纲级别(w:outlineLvl) */
  outlineLevel?: number;
  /** 段内条目(文档序) */
  items: ParagraphItem[];
}

/** 表格单元格 */
export interface DocumentTableCell {
  /** 单元格内的块(段落与嵌套表格) */
  blocks: DocumentBlock[];
  /** 单元格宽(缇,w:tcPr/w:tcW 的 w) */
  widthTwips?: number;
  /** 跨列数(w:gridSpan) */
  gridSpan?: number;
}

/** 表格行 */
export interface DocumentTableRow {
  cells: DocumentTableCell[];
}

/** 一个表格(w:tbl) */
export interface DocumentTable {
  kind: "table";
  /** 列宽(缇,w:tblGrid/w:gridCol 的 w) */
  gridWidthsTwips: number[];
  rows: DocumentTableRow[];
}

/** 块(段落或表格) */
export type DocumentBlock = DocumentParagraph | DocumentTable;

/** 节属性(w:sectPr) */
export interface DocumentSection {
  pageWidthTwips?: number;
  pageHeightTwips?: number;
  marginTopTwips?: number;
  marginBottomTwips?: number;
  marginLeftTwips?: number;
  marginRightTwips?: number;
  /** 朝向(w:pgSz 的 orient;缺省时按宽高比判定) */
  orientation?: "portrait" | "landscape";
}

/** 文档树 */
export interface DocumentTree {
  /** 正文块(文档序) */
  blocks: DocumentBlock[];
  /** 节属性(文档序;末节在最后) */
  sections: DocumentSection[];
}

/**
 * 读一个游程元素。
 * @param el w:r 元素
 * @returns 游程
 */
function readRun(el: XmlElement): DocumentRun {
  let text = "";
  let breaks = 0;
  let tabs = 0;
  for (const child of el.children) {
    switch (child.localName) {
      case "t":
      case "delText":
        text += child.text;
        break;
      case "br":
      case "cr":
        breaks += 1;
        break;
      case "tab":
        tabs += 1;
        break;
      case "noBreakHyphen":
        text += "-";
        break;
      case "softHyphen":
        text += "­";
        break;
      default:
        break;
    }
  }
  const properties = readRunProperties(childOf(el, "rPr"));
  return { text, breaks, tabs, properties, rStyle: properties.runStyle };
}

/**
 * 读一张图片(w:drawing)。
 * @param el w:drawing 元素
 * @param rels 关系表(可空)
 * @returns 图片条目
 */
function readDrawing(el: XmlElement, rels: RelationshipMap | undefined): ParagraphItem {
  const extent = findDescendant(el, "extent");
  const blip = findDescendant(el, "blip");
  const relationshipId = blip ? attrOf(blip, "embed") ?? attrOf(blip, "link") : undefined;
  const relationship = relationshipId ? findRelationship(rels, relationshipId) : null;
  const widthEmu = numAttr(extent, "cx");
  const heightEmu = numAttr(extent, "cy");
  return {
    kind: "drawing",
    relationshipId,
    target: relationship?.target,
    widthEmu,
    heightEmu,
  };
}

/**
 * 解析容器内的条目(段落 / 超链接 / 域 / 修订等)。
 * @param el 容器元素
 * @param rels 关系表(可空)
 * @returns 条目列表(文档序)
 */
function readItems(el: XmlElement, rels: RelationshipMap | undefined): ParagraphItem[] {
  /** @type {ParagraphItem[]} */
  const items: ParagraphItem[] = [];
  /** 当前打开的指令流域(连续 instrText 游程合并为一个域) */
  let openField: Extract<ParagraphItem, { kind: "field" }> | null = null;
  for (const child of el.children) {
    switch (child.localName) {
      case "r": {
        const instruction = childOf(child, "instrText");
        if (instruction) {
          if (!openField) {
            openField = { kind: "field", form: "instrText", instruction: "", items: [] };
            items.push(openField);
          }
          openField.instruction += instruction.text;
          continue;
        }
        openField = null;
        const drawings = childrenOf(child, "drawing");
        const run = readRun(child);
        // 空游程(只有域分隔/结束符或只有格式)不成项:它不携带可见内容,留着只会在回读时
        // 变成空段落噪声;带文字/换行/制表符的游程才成项。
        if (run.text !== "" || run.breaks > 0 || run.tabs > 0) {
          items.push({ kind: "run", run });
        }
        // 批注引用标记(w:commentReference)在 Word 里包在游程内,不成段级条目会整条丢掉
        for (const reference of childrenOf(child, "commentReference")) {
          items.push({ kind: "commentReference", commentId: attrOf(reference, "id") ?? "" });
        }
        for (const drawing of drawings) {
          items.push(readDrawing(drawing, rels));
        }
        break;
      }
      case "hyperlink": {
        const relationshipId = attrOf(child, "id");
        const relationship = relationshipId ? findRelationship(rels, relationshipId) : null;
        items.push({
          kind: "hyperlink",
          relationshipId,
          anchor: attrOf(child, "anchor"),
          external: relationship?.external ?? false,
          target: relationship?.target,
          items: readItems(child, rels),
        });
        break;
      }
      case "fldSimple": {
        items.push({
          kind: "field",
          form: "simple",
          instruction: attrOf(child, "instr") ?? "",
          items: readItems(child, rels),
        });
        break;
      }
      case "ins":
      case "del": {
        items.push({
          kind: "revision",
          form: child.localName === "ins" ? "insertion" : "deletion",
          author: attrOf(child, "author"),
          date: attrOf(child, "date"),
          items: readItems(child, rels),
        });
        break;
      }
      case "commentRangeStart": {
        items.push({ kind: "commentStart", commentId: attrOf(child, "id") ?? "" });
        break;
      }
      case "commentRangeEnd": {
        items.push({ kind: "commentEnd", commentId: attrOf(child, "id") ?? "" });
        break;
      }
      case "commentReference": {
        items.push({ kind: "commentReference", commentId: attrOf(child, "id") ?? "" });
        break;
      }
      case "bookmarkStart": {
        items.push({ kind: "bookmark", name: attrOf(child, "name"), id: attrOf(child, "id") });
        break;
      }
      case "sdt": {
        const content = childOf(child, "sdtContent");
        if (content) items.push(...readItems(content, rels));
        break;
      }
      default:
        break;
    }
  }
  return items;
}

/**
 * 读一个段落元素。
 * @param el w:p 元素
 * @param rels 关系表(可空)
 * @returns 段落
 */
function readParagraph(el: XmlElement, rels: RelationshipMap | undefined): DocumentParagraph {
  const props = readParagraphProperties(childOf(el, "pPr"));
  return {
    kind: "paragraph",
    style: props.style,
    numbering: props.numbering,
    align: props.align,
    indent: props.indent,
    spacing: props.spacing,
    pageBreakBefore: props.pageBreakBefore,
    outlineLevel: props.outlineLevel,
    items: readItems(el, rels),
  };
}

/**
 * 读容器内的块(段落与表格)。
 *
 * ⚠ **块级 w:sdt(内容控件)在这里展开**:本仓导出的稿子把目录包在
 * `<w:sdt><w:sdtContent><w:p>…` 里(Word 的目录控件形态),sdtContent 里装的是**块**而不是
 * 行内条目 —— 若只在行内层面展开 sdt,目录整段会被丢掉(表现为回读稿少一节)。
 * @param container 容器元素(正文或单元格)
 * @param rels 关系表(可空)
 * @returns 块列表(文档序)
 */
function readBlocks(container: XmlElement, rels: RelationshipMap | undefined): DocumentBlock[] {
  /** @type {DocumentBlock[]} */
  const blocks: DocumentBlock[] = [];
  for (const el of container.children) {
    if (el.localName === "p") blocks.push(readParagraph(el, rels));
    else if (el.localName === "tbl") blocks.push(readTable(el, rels));
    else if (el.localName === "sdt") {
      const content = childOf(el, "sdtContent");
      if (content) blocks.push(...readBlocks(content, rels));
    }
  }
  return blocks;
}

/**
 * 读一个表格元素。
 * @param el w:tbl 元素
 * @param rels 关系表(可空)
 * @returns 表格
 */
function readTable(el: XmlElement, rels: RelationshipMap | undefined): DocumentTable {
  /** @type {number[]} */
  const gridWidthsTwips: number[] = [];
  for (const col of childrenOf(childOf(el, "tblGrid"), "gridCol")) {
    gridWidthsTwips.push(numAttr(col, "w") ?? 0);
  }
  /** @type {DocumentTableRow[]} */
  const rows: DocumentTableRow[] = [];
  for (const rowEl of childrenOf(el, "tr")) {
    /** @type {DocumentTableCell[]} */
    const cells: DocumentTableCell[] = [];
    for (const cellEl of childrenOf(rowEl, "tc")) {
      const tcPr = childOf(cellEl, "tcPr");
      const widthTwips = numAttr(childOf(tcPr, "tcW"), "w");
      const gridSpan = numAttr(childOf(tcPr, "gridSpan"), "val");
      cells.push({ blocks: readBlocks(cellEl, rels), widthTwips, gridSpan });
    }
    rows.push({ cells });
  }
  return { kind: "table", gridWidthsTwips, rows };
}

/**
 * 读节属性元素。
 * @param sectPr w:sectPr 元素
 * @returns 节属性
 */
function readSection(sectPr: XmlElement): DocumentSection {
  /** @type {DocumentSection} */
  const section: DocumentSection = {};
  const pgSz = childOf(sectPr, "pgSz");
  const pageWidthTwips = numAttr(pgSz, "w");
  const pageHeightTwips = numAttr(pgSz, "h");
  if (pageWidthTwips !== undefined) section.pageWidthTwips = pageWidthTwips;
  if (pageHeightTwips !== undefined) section.pageHeightTwips = pageHeightTwips;
  const orient = attrOf(pgSz, "orient");
  if (orient === "landscape" || orient === "portrait") {
    section.orientation = orient;
  } else if (pageWidthTwips !== undefined && pageHeightTwips !== undefined) {
    section.orientation = pageHeightTwips >= pageWidthTwips ? "portrait" : "landscape";
  }
  const pgMar = childOf(sectPr, "pgMar");
  const marginTopTwips = numAttr(pgMar, "top");
  const marginBottomTwips = numAttr(pgMar, "bottom");
  const marginLeftTwips = numAttr(pgMar, "left");
  const marginRightTwips = numAttr(pgMar, "right");
  if (marginTopTwips !== undefined) section.marginTopTwips = marginTopTwips;
  if (marginBottomTwips !== undefined) section.marginBottomTwips = marginBottomTwips;
  if (marginLeftTwips !== undefined) section.marginLeftTwips = marginLeftTwips;
  if (marginRightTwips !== undefined) section.marginRightTwips = marginRightTwips;
  return section;
}

/**
 * 解析文档部件。
 * @param xml word/document.xml 文本(缺部件时传 null/空串 ⇒ 空树)
 * @param rels 关系表(可空;给了才能把超链接/图片还原成目标)
 * @returns 文档树(部件缺失/畸形 ⇒ 空树)
 */
export function parseDocument(xml: string | null | undefined, rels?: RelationshipMap): DocumentTree {
  /** @type {DocumentTree} */
  const tree: DocumentTree = { blocks: [], sections: [] };
  const root = parseXml(xml);
  if (!root) return tree;
  const body = childOf(root, "body");
  if (!body) return tree;
  tree.blocks = readBlocks(body, rels);
  for (const sectPr of findDescendants(body, "sectPr")) {
    tree.sections.push(readSection(sectPr));
  }
  return tree;
}

/**
 * 取树里的全部段落(表格单元格内的段落也算,文档序)。
 * @param tree 文档树
 * @returns 段落列表
 */
export function paragraphsOf(tree: DocumentTree): DocumentParagraph[] {
  /** @type {DocumentParagraph[]} */
  const out: DocumentParagraph[] = [];
  /**
   * @param blocks 块列表
   * @returns {void}
   */
  const walk = (blocks: DocumentBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === "paragraph") out.push(block);
      else for (const row of block.rows) {
        for (const cell of row.cells) walk(cell.blocks);
      }
    }
  };
  walk(tree.blocks);
  return out;
}

/**
 * 取树里的全部表格。
 * @param tree 文档树
 * @returns 表格列表
 */
export function tablesOf(tree: DocumentTree): DocumentTable[] {
  /** @type {DocumentTable[]} */
  const out: DocumentTable[] = [];
  /**
   * @param blocks 块列表
   * @returns {void}
   */
  const walk = (blocks: DocumentBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === "table") {
        out.push(block);
        for (const row of block.rows) {
          for (const cell of row.cells) walk(cell.blocks);
        }
      }
    }
  };
  walk(tree.blocks);
  return out;
}
