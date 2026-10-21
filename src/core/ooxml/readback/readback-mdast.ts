/**
 * docx → mdast:把解析层(part-document / part-styles / part-numbering)的文档树还原成 mdast。
 *
 * 承诺边界(ADR-086 决定 6):**只承诺读回本仓自己导出的 docx**,不承诺通用 Word 保真。
 * 本层认的形态集与「明确不处理」的清单见 docs/evidence/20261021-220818-自家docx产物形态实测.md
 * §五;逐条对应关系:
 * - `w:p` / `w:pPr`(pStyle/numPr/jc/ind/spacing) → 标题 / 列表 / 段落(排版属性不回读,见
 *   readback-fields.ts 的「不接管」清单);
 * - `w:r` / `w:rPr`(b/i/rFonts/sz) → 粗体 / 斜体 / 行内代码(等宽字体);字号与颜色不回读;
 * - `w:hyperlink`(w:anchor 与 r:id 两种) → md 锚点链接 / 外链;
 * - `w:drawing` → a:blip@r:embed 取关系目标(图片落地在装配层,本层只给可读名);
 * - `w:bookmarkStart/End` → 丢弃(链接文字保留,目标不落地);
 * - `w:tbl` / `w:tr` / `w:tc` → GFM 表格(首行为表头);
 * - `w:fldChar` + `w:instrText`(目录域) → 域指令丢弃,域结果(条目)照常还原;
 * - `m:oMath` → 纯文本(见 readback-math.ts);
 * - `word/numbering.xml` → numFmt 判有序/无序(不看 lvlText 的字面量),start 还原有序列表起始号;
 * - `word/styles.xml` → 段落样式判标题层级(pStyle → outlineLvl 兜底)。
 *
 * 明确不处理(自家稿不会出现,处理了也没回报):`w:ins`/`w:del` 的修订并回、
 * `w:fldSimple`(自家稿只用 instrText)、主题色引用(自家稿无 theme 部件)、`w:latentStyles`。
 *
 * 不变量:
 * ① 段落序与 traits 侧信道**逐段对齐**(见 readback-math.ts);对不上时调用方传空 traits,
 *    本层按「读不到」降级(公式/分隔线/引用块都不还原),绝不猜位置。
 * ② 编号计数按 numId 累计且**跨列表连续** —— 自家稿里同一类列表共用一个 numId,
 *    Word 的渲染就是连续编号(第二个有序列表从 3 起),还原成同一套编号才是忠实的。
 * ③ 图片按**文档内出现顺序**编号(image1、image2 …),与落地顺序一致。
 */
import type {
  BlockContent,
  Blockquote,
  Break,
  Code,
  Content,
  Heading,
  Html,
  Image,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
  Text,
  ThematicBreak,
} from "mdast";
import type {
  DocumentBlock,
  DocumentParagraph,
  DocumentRun,
  DocumentTable,
  DocumentTree,
  ParagraphItem,
} from "../part-document.js";
import { paragraphsOf } from "../part-document.js";
import { resolveNumberingLevel, type NumberingTable } from "../part-numbering.js";
import { styleOutlineLevel, type StyleTable } from "../part-styles.js";
import { resolvePartPath } from "../part-rels.js";
// 代码字体与引用块底纹是**自家稿的渲染约定**,常量单源在 docx/theme.ts ——
// 这里复制一份字面量就等于造第二个真源(改字体名时两处漂移,且没人会发现)。
import { CODE_FONT, QUOTE_BG_GRAY } from "../../docx/theme.js";
import type { DocumentTraits, ParagraphTraits } from "./readback-math.js";
import { traitsAt } from "./readback-math.js";
import type { ReadbackCounts } from "./readback-fields.js";

/** 图片清单项(源部件名 + 落地用的可读名) */
export interface ReadbackImageRef {
  /** 源 docx 里的媒体部件名(如 word/media/<sha1>.png) */
  partName: string;
  /** 落地用的可读文件名(如 image1.png);md 里按它引用 */
  fileName: string;
}

/** 回读产物:mdast 树 + 图片清单 + 计数 */
export interface ReadbackTree {
  /** mdast 根 */
  root: Root;
  /** 图片清单(文档序) */
  images: ReadbackImageRef[];
  /** 各类结构的计数 */
  counts: ReadbackCounts;
}

/** 转换入参(解析层产物 + 侧信道) */
export interface ReadbackTreeInput {
  /** 文档树 */
  tree: DocumentTree;
  /** 编号表(判有序/无序与起始号) */
  numbering: NumberingTable;
  /** 样式表(判标题层级) */
  styles: StyleTable;
  /** 段落特征侧信道;与段落数对不齐时传空集合(按「读不到」降级) */
  traits: DocumentTraits;
}

/** 转换期状态 */
interface BuildContext {
  numbering: NumberingTable;
  styles: StyleTable;
  traits: DocumentTraits;
  /** 图片清单(按文档序累积) */
  images: ReadbackImageRef[];
  /** numId → 各 ilvl 的当前计数(跨列表连续,见文件头不变量 ②) */
  counters: Map<string, number[]>;
  /** 段落的全局序号(与 traits 对齐) */
  paragraphIndex: number;
}

/** 打开的列表项(嵌套栈的一层) */
interface ListEntry {
  item: ListItem;
  /** 该项的 w:ilvl(目录条目用 TOC 级别) */
  level: number;
}

/** 标题级别(mdast 的 heading.depth 只收 1..6) */
type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 分页符在 markdown 侧的写法(本仓约定:`<!-- page-break -->`,不占 `---` 的 hr 语义)。
 *
 * ⚠ 字面量与 core/docx/render.ts、core/docx/handlers/fallback.ts、
 * core/clipboard/render-fragment.ts 三处相同 —— 那是本仓既有的约定重复(没有共享常量),
 * 本层按同一约定产出,保证「自家稿 → md → 自家稿」的分页符往返可还原。
 */
const PAGE_BREAK_MARKDOWN = "<!-- page-break -->";

/** 段落样式 id → 标题级别(Heading1..Heading6);不是标题 ⇒ undefined */
function headingDepthOf(styleId: string | undefined, styles: StyleTable): HeadingDepth | undefined {
  if (styleId === undefined) return undefined;
  const byId = /^Heading([1-6])$/.exec(styleId);
  if (byId !== null) return Number(byId[1]) as HeadingDepth;
  // 兜底:大纲级别(0..5);「Title」样式常带 outlineLvl 0,不算章节标题
  if (/^title$/i.test(styleId)) return undefined;
  const outline = styleOutlineLevel(styles, styleId);
  if (outline === undefined || outline < 0 || outline > 5) return undefined;
  return (outline + 1) as HeadingDepth;
}

/** 目录条目样式 id → 目录层级(TOC1 → 1);不是目录条目 ⇒ undefined */
function tocLevelOf(styleId: string | undefined): number | undefined {
  if (styleId === undefined) return undefined;
  const matched = /^TOC([1-9])$/.exec(styleId);
  return matched === null ? undefined : Number(matched[1]);
}

/** 该游程是否等宽(自家稿的行内代码 / 代码块形态) */
function isMonoRun(run: DocumentRun): boolean {
  const fonts = run.properties.fonts;
  if (fonts === undefined) return false;
  return fonts.ascii === CODE_FONT || fonts.hAnsi === CODE_FONT;
}

/**
 * 该段内条目是否「不反对」代码块判定。
 *
 * 空游程(只有换行、没有文字与格式)是**中性**的:自家稿的代码块里,换行游程不带 rPr
 * (docx 库把 break 单独成游程),若要求「每个游程都等宽」就会把代码块判成普通段落。
 * 但空游程也不能**证明**它是代码块 —— 故判定另需「至少有一个带文字的游程」。
 */
function isNeutralOrMono(item: ParagraphItem): boolean {
  if (item.kind !== "run") return false;
  // 没有可见文字的游程是**中性**的:自家稿的代码块里,换行游程不带 rPr
  // (docx 库把 break 单独成游程),若要求「每个游程都等宽」就会把代码块判成普通段落。
  if (item.run.text === "") return true;
  return isMonoRun(item.run);
}

/** 取行内内容的文本长度(包裹节点递归求和;图片不计) */
function phrasingLength(nodes: readonly PhrasingContent[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === "text") total += node.value.length;
    else if ("children" in node && Array.isArray(node.children)) {
      total += phrasingLength(node.children as PhrasingContent[]);
    }
  }
  return total;
}

/** 一个游程 → 行内内容(粗体/斜体/行内代码;游程自带的换行 → mdast 的 break 节点) */
function buildRunContent(run: DocumentRun): PhrasingContent[] {
  const props = run.properties;
  /** 行内代码:等宽字体(自家稿的 inline code 形态) */
  const mono = isMonoRun(run);
  /** @type {PhrasingContent[]} */
  const out: PhrasingContent[] = [];
  if (run.text !== "") {
    /** @type {PhrasingContent} */
    let node: PhrasingContent = mono
      ? { type: "inlineCode", value: run.text }
      : ({ type: "text", value: run.text } satisfies Text);
    if (!mono) {
      if (props.italic === true) node = { type: "emphasis", children: [node] };
      if (props.bold === true) node = { type: "strong", children: [node] };
    }
    out.push(node);
  }
  for (let index = 0; index < run.breaks; index += 1) {
    const hardBreak: Break = { type: "break" };
    out.push(hardBreak);
  }
  return out;
}

/** 段内条目 → 行内内容 */
function buildItemContent(item: ParagraphItem, ctx: BuildContext): PhrasingContent[] {
  switch (item.kind) {
    case "run":
      return buildRunContent(item.run);
    case "hyperlink": {
      const children = buildItemsContent(item.items, ctx);
      if (children.length === 0) return [];
      // 内部锚点(w:anchor)→ md 锚点链接;外链(r:id)→ 关系里的目标 URL
      const url = item.anchor !== undefined ? `#${item.anchor}` : (item.target ?? "");
      const link: Link = { type: "link", url, children };
      return [link];
    }
    case "drawing": {
      if (item.target === undefined) return []; // 关系目标缺失:图片无法落地,丢弃
      const partName = resolvePartPath("word/document.xml", item.target);
      const fileName = `image${ctx.images.length + 1}${extensionOf(partName)}`;
      ctx.images.push({ partName, fileName });
      const image: Image = { type: "image", url: fileName, alt: "" };
      return [image];
    }
    case "field":
      // 域指令丢弃,域结果照常还原(目录域的结果就是那些条目段落)
      return buildItemsContent(item.items, ctx);
    case "revision":
      // 插入内容保留;删除内容丢弃(自家稿不产生修订,这里是防御性口径)
      return item.form === "insertion" ? buildItemsContent(item.items, ctx) : [];
    case "bookmark":
    case "commentStart":
    case "commentEnd":
    case "commentReference":
      return [];
    default:
      return [];
  }
}

/** 段内条目序列 → 行内内容 */
function buildItemsContent(items: readonly ParagraphItem[], ctx: BuildContext): PhrasingContent[] {
  /** @type {PhrasingContent[]} */
  const out: PhrasingContent[] = [];
  for (const item of items) out.push(...buildItemContent(item, ctx));
  return out;
}

/** 取扩展名(含点,如 ".png");无扩展名 ⇒ "" */
function extensionOf(partName: string): string {
  const slash = partName.lastIndexOf("/");
  const name = slash === -1 ? partName : partName.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

/** 取下一个段落的 traits(并推进段落序号 —— 每个段落恰好推进一次) */
function takeTraits(ctx: BuildContext): ParagraphTraits | undefined {
  const traits = traitsAt(ctx.traits, ctx.paragraphIndex);
  ctx.paragraphIndex += 1;
  return traits;
}

/**
 * 段落 → 行内内容(公式按「公式前的文本长度」插回正确位置)。
 *
 * 为什么靠文本长度定位:解析层的条目序列里公式是缺席的(它不在 run / hyperlink 任何一种里),
 * 侧信道给出的 beforeLength 是「公式之前已出现的可见文本长度」——
 * 逐条累加行内内容的文本长度即可找到公式该落在哪两条之间。
 */
function buildParagraphContent(
  paragraph: DocumentParagraph,
  ctx: BuildContext,
  traits: ParagraphTraits | undefined,
): PhrasingContent[] {
  const slots = traits?.math ?? [];
  /** @type {PhrasingContent[]} */
  const out: PhrasingContent[] = [];
  let length = 0;
  let slotIndex = 0;
  /** 把 beforeLength ≤ 当前长度的公式槽位插进来 */
  const flushSlots = (): void => {
    while (slotIndex < slots.length) {
      const slot = slots[slotIndex]!;
      if (slot.beforeLength > length) break;
      out.push({ type: "text", value: slot.text });
      slotIndex += 1;
    }
  };
  for (const item of paragraph.items) {
    flushSlots();
    const nodes = buildItemContent(item, ctx);
    out.push(...nodes);
    length += phrasingLength(nodes);
  }
  flushSlots();
  return out;
}

/** 代码块内容(按 run 序拼文本,换行 run 记为换行) */
function codeContentOf(paragraph: DocumentParagraph): string {
  let code = "";
  for (const item of paragraph.items) {
    if (item.kind !== "run") continue;
    code += item.run.text;
    for (let index = 0; index < item.run.breaks; index += 1) code += "\n";
  }
  return code;
}

/** 递增某 numId 某级的计数,并复位更深级(Word 的编号规则) */
function bumpCounter(ctx: BuildContext, numId: string, level: number, start: number): number {
  const counters = ctx.counters.get(numId) ?? [];
  const current = counters[level] ?? (start - 1);
  const next = current + 1;
  counters[level] = next;
  for (let deeper = level + 1; deeper < counters.length; deeper += 1) counters[deeper] = 0;
  ctx.counters.set(numId, counters);
  return next;
}

/** 开一个新列表项(顶层开列表 / 嵌套开子列表) */
function openListItem(
  out: BlockContent[],
  stack: ListEntry[],
  level: number,
  ordered: boolean,
  start: number | undefined,
): ListEntry {
  const list: List = { type: "list", ordered, children: [] };
  if (ordered && start !== undefined) list.start = start;
  const item: ListItem = { type: "listItem", children: [] };
  list.children.push(item);
  if (stack.length === 0) out.push(list);
  else stack[stack.length - 1]!.item.children.push(list);
  const entry: ListEntry = { item, level };
  stack.push(entry);
  return entry;
}

/** 列表段落 → 追加到当前列表(必要时开新列表 / 新嵌套层) */
function appendListParagraph(
  paragraph: DocumentParagraph,
  traits: ParagraphTraits | undefined,
  ctx: BuildContext,
  out: BlockContent[],
  stack: ListEntry[],
): void {
  const numbering = paragraph.numbering;
  if (numbering === undefined) return;
  const level = numbering.level;
  const resolved = resolveNumberingLevel(ctx.numbering, numbering.numId, level);
  // 有序/无序看 numFmt(不看 lvlText 的字面量 —— 自家稿的无序档字面量是 ●○■)
  const ordered =
    resolved !== null && resolved.numFmt !== undefined && resolved.numFmt !== "bullet";
  const counter = bumpCounter(ctx, numbering.numId, level, resolved?.start ?? 1);
  while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
  const entry = openListItem(out, stack, level, ordered, counter);
  const paragraphNode: Paragraph = {
    type: "paragraph",
    children: buildParagraphContent(paragraph, ctx, traits),
  };
  entry.item.children.push(paragraphNode);
}

/** 目录条目段落 → 追加到当前目录列表(按 TOC 层级嵌套) */
function appendTocParagraph(
  paragraph: DocumentParagraph,
  traits: ParagraphTraits | undefined,
  ctx: BuildContext,
  out: BlockContent[],
  stack: ListEntry[],
  level: number,
): void {
  while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
  const entry = openListItem(out, stack, level, false, undefined);
  const paragraphNode: Paragraph = {
    type: "paragraph",
    children: buildParagraphContent(paragraph, ctx, traits),
  };
  entry.item.children.push(paragraphNode);
}

/** 表格 → mdast 表格(首行为表头;单元格多段以空格相接) */
function buildTable(table: DocumentTable, ctx: BuildContext): Table {
  /** @type {TableRow[]} */
  const rows: TableRow[] = [];
  for (const row of table.rows) {
    /** @type {TableCell[]} */
    const cells: TableCell[] = [];
    for (const cell of row.cells) {
      /** @type {PhrasingContent[]} */
      const children: PhrasingContent[] = [];
      for (const block of cell.blocks) {
        if (block.kind !== "paragraph") continue; // 单元格内的嵌套表格:跳过(GFM 单元格只放行内内容)
        const traits = takeTraits(ctx);
        if (children.length > 0) children.push({ type: "text", value: " " });
        children.push(...buildParagraphContent(block, ctx, traits));
      }
      cells.push({ type: "tableCell", children });
    }
    rows.push({ type: "tableRow", children: cells });
  }
  return { type: "table", children: rows };
}

/** 块序列 → mdast 块序列(列表 / 引用块 / 目录条目按连续性归并) */
function buildBlocks(blocks: readonly DocumentBlock[], ctx: BuildContext): BlockContent[] {
  /** @type {BlockContent[]} */
  const out: BlockContent[] = [];
  /** 当前打开的列表(嵌套栈) */
  let listStack: ListEntry[] = [];
  /** 当前打开的引用块 */
  let quote: Blockquote | null = null;
  /** 当前打开的目录条目列表 */
  let tocStack: ListEntry[] = [];

  for (const block of blocks) {
    if (block.kind === "table") {
      listStack = [];
      quote = null;
      tocStack = [];
      out.push(buildTable(block, ctx));
      continue;
    }
    const paragraph = block;
    const traits = takeTraits(ctx);
    const depth = headingDepthOf(paragraph.style, ctx.styles);
    const tocLevel = tocLevelOf(paragraph.style);
    const isList = paragraph.numbering !== undefined;
    const isQuote = traits?.shadingFill === QUOTE_BG_GRAY;
    const isRule = traits !== undefined && traits.bottomBorder && paragraph.items.length === 0;
    const isCode =
      !isList &&
      depth === undefined &&
      tocLevel === undefined &&
      paragraph.indent?.left === 360 &&
      paragraph.items.some((item) => item.kind === "run" && item.run.text !== "") &&
      paragraph.items.every(isNeutralOrMono);

    if (isRule) {
      listStack = [];
      quote = null;
      tocStack = [];
      const rule: ThematicBreak = { type: "thematicBreak" };
      out.push(rule);
      continue;
    }
    if (depth !== undefined) {
      listStack = [];
      quote = null;
      tocStack = [];
      const heading: Heading = {
        type: "heading",
        depth,
        children: buildParagraphContent(paragraph, ctx, traits),
      };
      out.push(heading);
      continue;
    }
    if (isList) {
      quote = null;
      tocStack = [];
      appendListParagraph(paragraph, traits, ctx, out, listStack);
      continue;
    }
    if (tocLevel !== undefined) {
      listStack = [];
      quote = null;
      appendTocParagraph(paragraph, traits, ctx, out, tocStack, tocLevel);
      continue;
    }
    if (isQuote) {
      listStack = [];
      tocStack = [];
      if (quote === null) {
        quote = { type: "blockquote", children: [] };
        out.push(quote);
      }
      quote.children.push({
        type: "paragraph",
        children: buildParagraphContent(paragraph, ctx, traits),
      });
      continue;
    }
    // 普通段落(或代码块)
    listStack = [];
    quote = null;
    tocStack = [];
    if (isCode) {
      const code: Code = { type: "code", lang: null, value: codeContentOf(paragraph) };
      out.push(code);
      continue;
    }
    const paragraphNode: Paragraph = {
      type: "paragraph",
      children: buildParagraphContent(paragraph, ctx, traits),
    };
    if (paragraphNode.children.length === 0) continue; // 空段落不产出(否则 md 里一片空行)
    if (paragraphNode.children.every((child) => child.type === "break")) {
      // 只有换行的段落:分页符 → 本仓 markdown 的分页符约定(往返可还原);
      // 其余换行(没有可见文字)不产出内容。
      if (traits?.pageBreak === true) {
        const pageBreak: Html = { type: "html", value: PAGE_BREAK_MARKDOWN };
        out.push(pageBreak);
      }
      continue;
    }
    out.push(paragraphNode);
  }
  return out;
}

/** 统计 mdast 里的各类节点(公式 / 脚注 / 批注来自侧信道,不在 mdast 里) */
function countNodes(root: Root, counts: ReadbackCounts): void {
  const walk = (node: Content): void => {
    switch (node.type) {
      case "heading":
        counts.headings += 1;
        break;
      case "paragraph":
        counts.paragraphs += 1;
        break;
      case "listItem":
        counts.listItems += 1;
        break;
      case "table":
        counts.tables += 1;
        break;
      case "image":
        counts.images += 1;
        break;
      case "link":
        counts.links += 1;
        break;
      default:
        break;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) walk(child as Content);
    }
  };
  for (const child of root.children) walk(child);
}

/**
 * 把文档树还原成 mdast。
 *
 * @param input 解析层产物 + 段落特征侧信道
 * @returns mdast 树 + 图片清单 + 计数
 */
export function buildReadbackTree(input: ReadbackTreeInput): ReadbackTree {
  const ctx: BuildContext = {
    numbering: input.numbering,
    styles: input.styles,
    traits: input.traits,
    images: [],
    counters: new Map(),
    paragraphIndex: 0,
  };
  const children = buildBlocks(input.tree.blocks, ctx);
  const root: Root = { type: "root", children };
  const counts: ReadbackCounts = {
    headings: 0,
    paragraphs: 0,
    listItems: 0,
    tables: 0,
    images: 0,
    links: 0,
    footnotes: input.traits.footnoteReferences,
    // 公式数取**全文 oMath 元素数**(与位置无关):侧信道作废时公式位置不可信,
    // 但「文档里有几个公式」这件事仍要知道 —— 计数说 0 而文档里有公式是撒谎。
    formulas: input.traits.mathElements,
    comments: input.traits.commentReferences,
  };
  countNodes(root, counts);
  return { root, images: ctx.images, counts };
}

/** 对齐校验:侧信道的段落数与解析层的段落数是否一致(不一致 ⇒ 侧信道作废) */
export function traitsAligned(tree: DocumentTree, traits: DocumentTraits): boolean {
  if (traits.paragraphCount === 0) return false;
  return traits.paragraphCount === paragraphsOf(tree).length;
}
