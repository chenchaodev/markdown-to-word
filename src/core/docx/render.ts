import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { INumberingOptions } from "docx";
import type {
  BlockContent,
  Blockquote,
  Code,
  Heading,
  Image,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";
import { CODE_FONT, CODE_SIZE, DEFAULT_FONT, LINK_COLOR } from "./theme.js";
import { DEFAULT_PAGE_SETUP } from "../convert.js";
import type { PageSetup } from "../convert.js";
import { docxBookmarkId } from "../slug.js";

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败 */
export type ImageResolver = (src: string) => Promise<Buffer | null>;

export interface RenderOptions {
  imageResolver?: ImageResolver;
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
}

interface Ctx {
  imageResolver?: ImageResolver;
  listLevel: number;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
}

/** 纸张 mm 尺寸表(宽 × 高) */
const PAPER_SIZES_MM: Record<PageSetup["paper"], { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** mm → twips(docx 长度单位;1mm = 56.6929 twips,四舍五入) */
function mmToTwips(mm: number): number {
  return Math.round(mm * 56.6929);
}

/** G1 支持的块级节点类型(mdast 中 image 属 PhrasingContent,在段落内处理) */
function isSupportedBlock(node: RootContent): node is BlockContent {
  return ["heading", "paragraph", "list", "table", "code", "blockquote", "thematicBreak", "html"].includes(
    node.type,
  );
}

/** 列表编号配置:bullet 与 decimal 各一套,0-3 级缩进(docx 9.x:Document 直接收 INumberingOptions) */
function numberingOptions(): INumberingOptions {
  const bulletText = ["•", "◦", "▪"];
  const levels = (ordered: boolean) =>
    [0, 1, 2, 3].map((level) => ({
      level,
      format: ordered ? ("decimal" as const) : ("bullet" as const),
      text: ordered ? `%${level + 1}.` : bulletText[level % bulletText.length],
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: { left: 720 * (level + 1), hanging: 360 },
        },
      },
    }));
  return {
    config: [
      { reference: "md-list-bullet", levels: levels(false) },
      { reference: "md-list-number", levels: levels(true) },
    ],
  };
}

/**
 * 将 mdast AST 渲染为 docx Buffer。
 * core 层保持无 IO:图片一律经 imageResolver 注入(由调用方负责读文件)。
 */
export async function renderDocx(ast: Root, options: RenderOptions = {}): Promise<Buffer> {
  const ctx: Ctx = {
    imageResolver: options.imageResolver,
    listLevel: 0,
    breakBeforeH1: options.breakBeforeH1,
  };
  const children: (Paragraph | Table)[] = [];
  for (const node of ast.children) {
    if (isSupportedBlock(node)) {
      children.push(...(await renderBlock(node, ctx)));
    }
    // definition 等:跳过不渲染
  }
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const paper = PAPER_SIZES_MM[pageSetup.paper];
  const landscape = pageSetup.orientation === "landscape";
  // docx 库在 orientation=landscape 时自动交换 width/height 写入 pgSz,
  // 故此处始终传原始(纵向)尺寸,勿手动交换(实测:手动交换会双重交换导致宽高反)
  const size = {
    width: mmToTwips(paper.width),
    height: mmToTwips(paper.height),
    orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  };
  const margin = {
    top: mmToTwips(pageSetup.marginTop),
    bottom: mmToTwips(pageSetup.marginBottom),
    left: mmToTwips(pageSetup.marginLeft),
    right: mmToTwips(pageSetup.marginRight),
  };
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: { ...DEFAULT_FONT }, size: 24 },
        },
      },
    },
    numbering: numberingOptions(),
    sections: [{ properties: { page: { size, margin } }, children }],
  });
  return Packer.toBuffer(doc);
}

// ---------- 块级节点 ----------

async function renderBlock(node: BlockContent, ctx: Ctx): Promise<(Paragraph | Table)[]> {
  switch (node.type) {
    case "heading":
      return [renderHeading(node, ctx)];
    case "paragraph":
      return [new Paragraph({ children: await renderPhrasing(node.children, ctx) })];
    case "list":
      return renderList(node, ctx);
    case "table":
      return [await renderTable(node, ctx)];
    case "code":
      return [renderCode(node)];
    case "blockquote":
      return renderBlockquote(node, ctx);
    case "thematicBreak":
      return [renderThematicBreak()];
    case "html":
      // 显式分页符:<!-- page-break -->(trim 后精确匹配);其他 html 跳过
      if (node.value.trim() === "<!-- page-break -->") {
        return [new Paragraph({ children: [new PageBreak()] })];
      }
      return [];
    default:
      return [];
  }
}

function renderHeading(node: Heading, ctx: Ctx): Paragraph {
  const levels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  const runs = renderPhrasingSync(node.children, ctx);
  // parse.ts 将标题 id 挂于 data.id(mdast Data 已声明合并,见 parse.ts)
  const id = node.data?.id;
  return new Paragraph({
    heading: levels[node.depth] ?? HeadingLevel.HEADING_6,
    spacing: { before: 240, after: 120 },
    pageBreakBefore: node.depth === 1 && ctx.breakBeforeH1 === true,
    // docx 9.x Paragraph 无 bookmarks 选项:书签以 Bookmark 组件包裹标题 runs 实现
    children:
      typeof id === "string" && id !== ""
        ? [new Bookmark({ id: docxBookmarkId(id), children: runs })]
        : runs,
  });
}

/** 列表:listItem 内第一个块挂编号,嵌套列表递归加深 level */
async function renderList(node: List, ctx: Ctx): Promise<Paragraph[]> {
  const reference = node.ordered ? "md-list-number" : "md-list-bullet";
  const result: Paragraph[] = [];
  for (const item of node.children as ListItem[]) {
    for (const child of item.children) {
      if (child.type === "list") {
        result.push(...(await renderList(child, { ...ctx, listLevel: ctx.listLevel + 1 })));
      } else if (child.type === "paragraph") {
        result.push(
          new Paragraph({
            numbering: { reference, level: Math.min(ctx.listLevel, 3) },
            children: await renderPhrasing(child.children, ctx),
          }),
        );
      }
      // 其他块(代码/引用等)在列表项内:G1 按普通段落降级渲染
      else if (child.type === "code") {
        result.push(renderCode(child));
      } else if (child.type === "blockquote") {
        result.push(...(await renderBlockquote(child, ctx)));
      }
    }
  }
  return result;
}

function renderCode(node: Code): Paragraph {
  const lines = node.value.split("\n");
  const children: TextRun[] = [];
  lines.forEach((line, i) => {
    children.push(new TextRun({ text: line, font: CODE_FONT, size: CODE_SIZE }));
    if (i < lines.length - 1) children.push(new TextRun({ text: "", break: 1 }));
  });
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    indent: { left: 360 },
    children,
  });
}

async function renderBlockquote(node: Blockquote, ctx: Ctx): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          children: await renderPhrasing(child.children, ctx),
          shading: { type: "clear", fill: "F2F2F2" },
        }),
      );
    } else if (child.type === "blockquote") {
      paragraphs.push(...(await renderBlockquote(child, ctx)));
    }
  }
  return paragraphs;
}

async function renderTable(node: MdTable, ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = [];
  for (let rowIndex = 0; rowIndex < node.children.length; rowIndex++) {
    const row = node.children[rowIndex];
    const cells: TableCell[] = [];
    for (const cell of row.children) {
      const runs = await renderPhrasing(cell.children, ctx, rowIndex === 0 ? { bold: true } : {});
      cells.push(new TableCell({ children: [new Paragraph({ children: runs })] }));
    }
    rows.push(new TableRow({ children: cells }));
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows,
  });
}

function renderThematicBreak(): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999" } },
  });
}

// ---------- 行内节点 ----------

interface RunStyle {
  italics?: boolean;
  bold?: boolean;
  strike?: boolean;
}

/** 段落内可出现的 docx 子元素:文本 run 或行内图片 */
type InlineChild = TextRun | ImageRun;

/** 行内节点 → 元素数组;样式沿父子链累积传递 */
async function renderPhrasing(
  nodes: PhrasingContent[],
  ctx: Ctx,
  style: RunStyle = {},
): Promise<InlineChild[]> {
  const runs: InlineChild[] = [];
  for (const node of nodes) {
    await pushRuns(runs, node, ctx, style);
  }
  return runs;
}

/** 标题等无图片需求的场景用同步版(图片退化为占位文本) */
function renderPhrasingSync(nodes: PhrasingContent[], ctx: Ctx): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    pushRunsSync(runs, node, ctx, {});
  }
  return runs;
}

async function pushRuns(runs: InlineChild[], node: PhrasingContent, ctx: Ctx, style: RunStyle): Promise<void> {
  switch (node.type) {
    case "text":
      runs.push(new TextRun({ text: node.value, ...style }));
      break;
    case "emphasis":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, italics: true });
      break;
    case "strong":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, bold: true });
      break;
    case "delete":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, strike: true });
      break;
    case "inlineCode":
      runs.push(new TextRun({ text: node.value, font: CODE_FONT, size: CODE_SIZE, ...style }));
      break;
    case "link":
      runs.push(
        new TextRun({
          text: node.children.map((c) => ("value" in c ? (c as { value: string }).value : "")).join(""),
          color: LINK_COLOR,
          underline: {},
          ...style,
        }),
      );
      break;
    case "image":
      runs.push(await imageToDocx(node, ctx, style));
      break;
    default:
      break;
  }
}

function pushRunsSync(runs: TextRun[], node: PhrasingContent, ctx: Ctx, style: RunStyle): void {
  switch (node.type) {
    case "text":
      runs.push(new TextRun({ text: node.value, ...style }));
      break;
    case "emphasis":
      for (const child of node.children) pushRunsSync(runs, child, ctx, { ...style, italics: true });
      break;
    case "strong":
      for (const child of node.children) pushRunsSync(runs, child, ctx, { ...style, bold: true });
      break;
    case "delete":
      for (const child of node.children) pushRunsSync(runs, child, ctx, { ...style, strike: true });
      break;
    case "inlineCode":
      runs.push(new TextRun({ text: node.value, font: CODE_FONT, size: CODE_SIZE, ...style }));
      break;
    case "link":
      runs.push(
        new TextRun({
          text: node.children.map((c) => ("value" in c ? (c as { value: string }).value : "")).join(""),
          color: LINK_COLOR,
          underline: {},
          ...style,
        }),
      );
      break;
    case "image":
      runs.push(new TextRun({ text: `[图片: ${node.alt || ""}]`, color: "808080" }));
      break;
    default:
      break;
  }
}

/** 行内图片:经 resolver 加载为 ImageRun;失败时占位文本 */
async function imageToDocx(node: Image, ctx: Ctx, style: RunStyle): Promise<InlineChild> {
  const fallback = () => new TextRun({ text: `[图片: ${node.alt || node.url}]`, color: "808080", ...style });
  if (!ctx.imageResolver) return fallback();
  let data: Buffer | null;
  try {
    data = await ctx.imageResolver(node.url);
  } catch {
    data = null;
  }
  if (!data) return fallback();
  return new ImageRun({
    type: sniffImageType(data),
    data,
    transformation: { width: 400, height: 300 },
  });
}

// ---------- 工具 ----------

/** 依据文件魔数判断图片类型(docx ImageRun 接受 png/jpg/gif/bmp/svg) */
function sniffImageType(data: Buffer): "png" | "jpg" | "gif" {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
    return "jpg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "gif";
  }
  return "png";
}
