import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { INumberingOptions } from "docx";
import type {
  BlockContent,
  Blockquote,
  Code,
  FootnoteDefinition,
  Heading,
  Image,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";
import { CODE_FONT, CODE_SIZE, LINK_COLOR } from "./theme.js";
import { DEFAULT_PAGE_SETUP } from "../convert.js";
import type { PageSetup } from "../convert.js";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import { DEFAULT_TYPOGRAPHY } from "../typography.js";
import { docxBookmarkId } from "../slug.js";

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败 */
export type ImageResolver = (src: string) => Promise<Buffer | null>;

export interface RenderOptions {
  imageResolver?: ImageResolver;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页) */
  metadata?: DocMetadata;
  /** 文档标题(docx 页眉用;优先级低于 metadata.title) */
  title?: string;
  /** 警告收集(外链图片下载失败等,与缺失图片警告同构) */
  warnings?: string[];
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY):字号/字体/行距/缩进/对齐/标题编号 */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节自动编号(h1-h3 挂 numbering;显式传值优先,否则取 typography.headingNumbering) */
  headingNumbering?: boolean;
}

interface Ctx {
  imageResolver?: ImageResolver;
  warnings?: string[];
  listLevel: number;
  /** 排版设置(已解析默认,渲染时以 typography 为准) */
  typography: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节自动编号(h1-h3 挂 numbering,默认开) */
  headingNumbering?: boolean;
  /** 脚注定义索引:identifier → definition 节点(renderDocx 预扫) */
  footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** 脚注收集器:引用渲染时写入,id 字符串从 "1" 起 */
  footnotes: Record<string, { children: Paragraph[] }>;
  /** 下一个脚注 id(可变对象,嵌套引用共用计数器) */
  footnoteNextId: { value: number };
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

/** 标题章节编号:h1-h3 挂段落级 numbering(静态渲染,打开 Word/WPS 无需 F9 即显示) */
function headingNumberingOptions(): INumberingOptions {
  const textFor = (level: number): string =>
    Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join(".");
  const levels = [0, 1, 2].map((level) => ({
    level,
    format: "decimal" as const,
    text: textFor(level),
    alignment: AlignmentType.LEFT,
    start: 1,
    style: {
      paragraph: {
        indent: { left: 360, hanging: 360 },
      },
    },
  }));
  return { config: [{ reference: "md-heading", levels }] };
}

/**
 * 将 mdast AST 渲染为 docx Buffer。
 * core 层保持无 IO:图片一律经 imageResolver 注入(由调用方负责读文件)。
 */
export async function renderDocx(ast: Root, options: RenderOptions = {}): Promise<Buffer> {
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  const ctx: Ctx = {
    imageResolver: options.imageResolver,
    warnings: options.warnings,
    listLevel: 0,
    typography,
    breakBeforeH1: options.breakBeforeH1,
    headingNumbering: options.headingNumbering ?? typography.headingNumbering,
    footnoteDefinitions: new Map(),
    footnotes: {},
    footnoteNextId: { value: 1 },
  };
  // 页眉标题:metadata.title 优先,其次 options.title(无标题时不渲染页眉)
  const title = options.metadata?.title ?? options.title;
  // 预扫脚注定义:identifier → definition 节点(正文循环跳过,引用渲染时取内容)
  for (const node of ast.children) {
    if (node.type === "footnoteDefinition") {
      ctx.footnoteDefinitions.set(node.identifier, node);
    }
  }
  const children: (Paragraph | Table | TableOfContents)[] = [];
  // 封面页:metadata.title 存在时置于文档最前(独占一页,不计入标题层级/书签)
  if (options.metadata?.title) {
    children.push(...renderCoverPage(options.metadata));
  }
  // 目录页:正文含标题节点时插入(封面之后/文档最前,独占一页;无标题的短文档不生成)
  if (ast.children.some((node) => node.type === "heading")) {
    children.push(...renderTocPage());
  }
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
          // 排版设置:字体以 typography 为准(theme.ts 保留作兜底);
          // 字号 half-points = pt × 2(如 14pt → 28)
          run: {
            font: {
              ascii: typography.fontAscii,
              eastAsia: typography.fontEastAsia,
              hAnsi: typography.fontAscii,
            },
            size: Math.round(typography.bodySizePt * 2),
          },
        },
      },
    },
    numbering: { config: [...numberingOptions().config, ...headingNumberingOptions().config] },
    // 空脚注表不生成 footnotes part(避免空 part 导致打开异常)
    footnotes: Object.keys(ctx.footnotes).length > 0 ? ctx.footnotes : undefined,
    sections: [
      {
        properties: { page: { size, margin } },
        headers: title ? { default: renderHeader(title) } : undefined,
        footers: { default: renderFooter() },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------- 块级节点 ----------

/**
 * 封面页:标题居中加粗(44 half-points = 22pt,与 pdf 封面标题字号一致)+
 * 下方 author/date 居中灰色小字;末尾 PageBreak 独占一页。
 * 用普通 Paragraph(不用 HeadingLevel),不进导航窗格/标题层级/书签。
 */
function renderCoverPage(metadata: DocMetadata): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  // 顶部留白:Word 忽略页首段落的 before 间距,故用空段落撑开(视觉居中)
  paragraphs.push(new Paragraph({ spacing: { after: 2400 }, children: [] }));
  paragraphs.push(new Paragraph({ spacing: { after: 2400 }, children: [] }));
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 600 },
      children: [new TextRun({ text: metadata.title ?? "", bold: true, size: 44 })],
    }),
  );
  if (metadata.author) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: metadata.author, color: "808080", size: 22 })],
      }),
    );
  }
  if (metadata.date) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: metadata.date, color: "808080", size: 22 })],
      }),
    );
  }
  paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
  return paragraphs;
}

/**
 * 目录页:标题居中加粗(36 half-points = 18pt)+ TOC 域,独占一页。
 * 标题用普通 Paragraph(不用 HeadingLevel,避免被 TOC 域 \o "1-3" 收集到目录自身);
 * 域结构(begin/instrText/separate/end)由 docx 9.x TableOfContents 生成,
 * Word/WPS 打开后右键 → 更新域 生成目录;更新前显示域内占位文案。
 */
function renderTocPage(): (Paragraph | TableOfContents)[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 480 },
      children: [new TextRun({ text: "目录", bold: true, size: 36 })],
    }),
    new TableOfContents("目录", {
      hyperlink: true, // \h
      headingStyleRange: "1-3", // \o "1-3"
      useAppliedParagraphOutlineLevel: true, // \u
      hideTabAndPageNumbersInWebView: true, // \z
      contentChildren: [
        new Paragraph({
          children: [new TextRun("(目录:请右键 → 更新域 生成)")],
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** 页眉:文档标题居中灰色小字(size 14 = 7pt,颜色 888888);无标题时不调用 */
function renderHeader(title: string): Header {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, size: 14, color: "888888" })],
    })],
  });
}

/** 页脚:第 X 页 / 共 X 页 居中(与 PDF footerTemplate 文案一致;PageNumber 域) */
function renderFooter(): Footer {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "第 ", size: 14, color: "888888" }),
        new TextRun({ size: 14, color: "888888", children: [PageNumber.CURRENT] }),
        new TextRun({ text: " 页 / 共 ", size: 14, color: "888888" }),
        new TextRun({ size: 14, color: "888888", children: [PageNumber.TOTAL_PAGES] }),
        new TextRun({ text: " 页", size: 14, color: "888888" }),
      ],
    })],
  });
}

async function renderBlock(node: BlockContent, ctx: Ctx): Promise<(Paragraph | Table)[]> {
  switch (node.type) {
    case "heading":
      return [renderHeading(node, ctx)];
    case "paragraph":
      // 普通正文段落:应用排版设置(对齐/行距/首行缩进)。
      // 作用范围仅限正文:heading/列表/代码/表格等段落保持各自样式,
      // 列表项不加首行缩进(与 PDF 侧 p { text-indent } 规则对齐语义)。
      return [
        new Paragraph({
          alignment: ctx.typography.align === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
          spacing: { line: Math.round(ctx.typography.lineSpacing * 240), lineRule: LineRuleType.AUTO },
          indent: ctx.typography.firstLineIndent ? { firstLineChars: 200 } : undefined,
          children: await renderPhrasing(node.children, ctx),
        }),
      ];
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
    numbering:
      node.depth <= 3 && ctx.headingNumbering === true
        ? { reference: "md-heading", level: node.depth - 1 }
        : undefined,
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

/** 段落内可出现的 docx 子元素:文本 run、行内图片、脚注引用或超链接 */
type InlineChild = TextRun | ImageRun | FootnoteReferenceRun | InternalHyperlink | ExternalHyperlink;

/** 同步场景(标题等)可产生的 docx 子元素:文本 run 或超链接(图片/脚注降级为文本) */
type InlineSyncChild = TextRun | InternalHyperlink | ExternalHyperlink;

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
function renderPhrasingSync(nodes: PhrasingContent[], ctx: Ctx): InlineSyncChild[] {
  const runs: InlineSyncChild[] = [];
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
    case "link": {
      const text = node.children.map((c) => ("value" in c ? (c as { value: string }).value : "")).join("");
      const url = node.url;
      if (url.startsWith("#")) {
        // 内部锚点:[text](#slug) → 跳转同名书签(标题已用 docxBookmarkId 生成)
        runs.push(
          new InternalHyperlink({
            anchor: docxBookmarkId(url.slice(1)),
            children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
        break;
      }
      if (/^https?:/i.test(url)) {
        runs.push(
          new ExternalHyperlink({
            link: url,
            children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
        break;
      }
      // 相对路径等:保持假链接样式
      runs.push(new TextRun({ text, color: LINK_COLOR, underline: {}, ...style }));
      break;
    }
    case "image":
      runs.push(await imageToDocx(node, ctx, style));
      break;
    case "footnoteReference": {
      const def = ctx.footnoteDefinitions.get(node.identifier);
      if (def) {
        const id = ctx.footnoteNextId.value++;
        ctx.footnotes[String(id)] = { children: await renderFootnoteDefinition(def, ctx) };
        runs.push(new FootnoteReferenceRun(id));
      }
      break;
    }
    default:
      break;
  }
}

function pushRunsSync(runs: InlineSyncChild[], node: PhrasingContent, ctx: Ctx, style: RunStyle): void {
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
    case "link": {
      const text = node.children.map((c) => ("value" in c ? (c as { value: string }).value : "")).join("");
      const url = node.url;
      if (url.startsWith("#")) {
        // 内部锚点:[text](#slug) → 跳转同名书签(标题已用 docxBookmarkId 生成)
        runs.push(
          new InternalHyperlink({
            anchor: docxBookmarkId(url.slice(1)),
            children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
        break;
      }
      if (/^https?:/i.test(url)) {
        runs.push(
          new ExternalHyperlink({
            link: url,
            children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
        break;
      }
      // 相对路径等:保持假链接样式
      runs.push(new TextRun({ text, color: LINK_COLOR, underline: {}, ...style }));
      break;
    }
    case "image":
      runs.push(new TextRun({ text: `[图片: ${node.alt || ""}]`, color: "808080" }));
      break;
    case "footnoteReference":
      // 同步场景(标题等)无脚注收集器:渲染为字面标记避免静默丢失
      runs.push(new TextRun({ text: `[^${node.label ?? node.identifier}]`, ...style }));
      break;
    default:
      break;
  }
}

/** 脚注定义内容 → Paragraph[](复用现有块渲染;table 等罕见块跳过) */
async function renderFootnoteDefinition(def: FootnoteDefinition, ctx: Ctx): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  for (const child of def.children) {
    switch (child.type) {
      case "paragraph":
        paragraphs.push(new Paragraph({ children: await renderPhrasing(child.children, ctx) }));
        break;
      case "list":
        paragraphs.push(...(await renderList(child, ctx)));
        break;
      case "code":
        paragraphs.push(renderCode(child));
        break;
      case "blockquote":
        paragraphs.push(...(await renderBlockquote(child, ctx)));
        break;
      case "thematicBreak":
        paragraphs.push(renderThematicBreak());
        break;
      default:
        break; // table 等:跳过
    }
  }
  return paragraphs;
}

/** 行内图片:经 resolver 加载为 ImageRun;失败时占位文本。
 *  外链(http/s)失败额外追加警告(本地缺失已由 collectMissingImageWarnings 处理)。 */
async function imageToDocx(node: Image, ctx: Ctx, style: RunStyle): Promise<InlineChild> {
  const fallback = () => new TextRun({ text: `[图片: ${node.alt || node.url}]`, color: "808080", ...style });
  const isExternal = /^https?:/i.test(node.url);
  const warnExternal = (): void => {
    if (isExternal) ctx.warnings?.push(`外链图片下载失败: ${node.url}`);
  };
  if (!ctx.imageResolver) {
    warnExternal();
    return fallback();
  }
  let data: Buffer | null;
  try {
    data = await ctx.imageResolver(node.url);
  } catch {
    data = null;
  }
  if (!data) {
    warnExternal();
    return fallback();
  }
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
