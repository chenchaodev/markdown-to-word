import {
  AlignmentType,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Math as DocxMath,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import type { INumberingOptions, ParagraphChild } from "docx";
import type {
  BlockContent,
  Blockquote,
  Code,
  FootnoteDefinition,
  Heading,
  Image,
  List,
  ListItem,
  Paragraph as MdParagraph,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";
import { CODE_FONT, CODE_SIZE, LINK_COLOR } from "./theme.js";
import { texToDocxMath } from "./math.js";
import { highlightCodeRuns } from "./code-highlight.js";
import { buildCaptionContext, renderCaptionParagraph, type CaptionInfo, type CaptionLabelInfo } from "./captions.js";
import { buildEquationContext, type EquationContext } from "./equations.js";
import { collectPlainText } from "../mdast-utils.js";
import { sniffImageType, imageSizeFromBuffer } from "../image-type.js";
import { imageLoadFailedWarning } from "../image-warning.js";
import { DEFAULT_PAGE_SETUP } from "../convert.js";
import type { PageSetup } from "../convert.js";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import { DEFAULT_TYPOGRAPHY } from "../typography.js";
import { docxBookmarkId } from "../slug.js";
import { isAllowedInlineHtml } from "../html-whitelist.js";
import { normalizeInlineHtml, parseInlineHtml, inlineHtmlItemsToRuns, renderBodyParagraph, renderInlineHtmlParagraph } from "./inline-html.js";
import type { MermaidResolver } from "../mermaid.js";

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败 */
export type ImageResolver = (src: string) => Promise<Buffer | null>;

/** 静态目录条目(docx 库 ToCEntry 为内部类型未导出,结构兼容即可;
 *  href 为标题书签名(无 # 前缀),hyperlink 开启时条目渲染为可点击跳转) */
interface TocEntry {
  title: string;
  level: number;
  href: string;
}

export interface RenderOptions {
  imageResolver?: ImageResolver;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页) */
  metadata?: DocMetadata;
  /** 文档标题(docx 页眉用;优先级低于 metadata.title) */
  title?: string;
  /** 警告收集(图片加载失败统一文案 imageLoadFailedWarning;webp 降级等) */
  warnings?: string[];
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY):字号/字体/行距/缩进/对齐/标题编号 */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节自动编号(h1-h3 挂 numbering;显式传值优先,否则取 typography.headingNumbering) */
  headingNumbering?: boolean;
  /** 自动生成目录页(默认开;开时 docx 插入静态目录:打开即见、可点击跳转、无页码、免更新域) */
  toc?: boolean;
  /** 公式编号开关(默认开;关时 display 公式不编号、{#eq:label} 段原样渲染、引用保持原文本) */
  equationNumbering?: boolean;
  /** 图/表题注自动编号(默认开,取 typography.captionNumbering;显式传值优先) */
  captionNumbering?: boolean;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
}

export interface Ctx {
  imageResolver?: ImageResolver;
  warnings?: string[];
  listLevel: number;
  /** 排版设置(已解析默认,渲染时以 typography 为准) */
  typography: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节自动编号(h1-h3 挂 numbering,默认开) */
  headingNumbering?: boolean;
  /** 图/表题注自动编号(默认开) */
  captionNumbering?: boolean;
  /** 自动生成目录页(默认开) */
  toc: boolean;
  /** 公式编号开关(默认开;关时公式原样渲染、label 段原样渲染、引用保持原文本) */
  equationNumbering: boolean;
  /** 脚注定义索引:identifier → definition 节点(renderDocx 预扫) */
  footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** 脚注收集器:引用渲染时写入,id 字符串从 "1" 起 */
  footnotes: Record<string, { children: Paragraph[] }>;
  /** 下一个脚注 id(可变对象,嵌套引用共用计数器) */
  footnoteNextId: { value: number };
  /** 公式 label → 编号查表(9d,renderDocx 预扫后挂入;行内交叉引用渲染用) */
  equationLabels?: Map<string, number>;
  /** 题注 label → 编号文本(批次 10 功能 2:图/表交叉引用查表;buildCaptionContext 预扫时登记) */
  captionLabels: Map<string, CaptionLabelInfo>;
  /** 章节 label → 章节号文本 + 标题书签 slug(批次 10 功能 2:章节交叉引用查表;renderDocx 预扫登记) */
  headingLabels: Map<string, HeadingLabelInfo>;
  /** docx 书签 linkId 自增计数器(逐文档新建,保证文档内 bookmarkStart/End id 唯一) */
  bookmarkNextId: { value: number };
  /** 批注 id 自增计数器(逐文档新建,保证文档内 commentRangeStart/End/Reference id 唯一) */
  commentNextId: { value: number };
  /** 批注收集器:引用渲染时写入,id 字符串从 "1" 起(与脚注同模式) */
  comments: Record<string, { children: Paragraph[] }>;
  /** Mermaid 渲染回调(mermaid 围栏代码块 → 内嵌 PNG 图片;缺失时按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
}

/** 章节 label 登记信息(批次 10 功能 2:交叉引用查表) */
interface HeadingLabelInfo {
  /** 静态章节号文本(「1」「3.2」「3.2.1」;无 h1 时从「1」起,见 chapterNumberFromCounters) */
  chapterText: string;
  /** 标题书签 slug(引用跳转 anchor = docxBookmarkId(slug)) */
  slug: string;
}

/**
 * 交叉引用类型常量(批次 10 功能 2):fig/tab/sec 三类引用集中定义,
 * pdf 侧渲染实现与此表同步(同一契约,勿单侧改文案)。
 * - label 前缀:行内链接 #<prefix>:<label> 匹配([\w-]+);
 * - defaultText:引用文本恰为此文本时替换为编号(其他文本保持原样仍跳转);
 * - danglingText:查表未命中时默认文本的占位(无链接);
 * - kindName:悬空警告文案用(「交叉引用未找到<kindName> label: <prefix>:<label>」)。
 */
export const CROSS_REF_KINDS = {
  fig: { defaultText: "图", danglingText: "图 (?)", kindName: "图" },
  tab: { defaultText: "表", danglingText: "表 (?)", kindName: "表" },
  sec: { defaultText: "章节", danglingText: "(?)", kindName: "章节" },
} as const;
type CrossRefKind = keyof typeof CROSS_REF_KINDS;

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

/** G1 支持的块级节点类型(mdast 中 image 属 PhrasingContent,在段落内处理;
 *  math 为 display 公式,独立居中段落) */
function isSupportedBlock(node: RootContent): node is BlockContent {
  return ["heading", "paragraph", "list", "table", "code", "blockquote", "thematicBreak", "html", "math"].includes(
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
    captionNumbering: options.captionNumbering ?? typography.captionNumbering,
    toc: options.toc ?? true,
    equationNumbering: options.equationNumbering ?? true,
    footnoteDefinitions: new Map(),
    footnotes: {},
    footnoteNextId: { value: 1 },
    bookmarkNextId: { value: 1 },
    commentNextId: { value: 1 },
    comments: {},
    captionLabels: new Map(),
    headingLabels: new Map(),
    mermaidResolver: options.mermaidResolver,
  };
  // 页眉标题:metadata.title 优先,其次 options.title(无标题时不渲染页眉)
  const title = options.metadata?.title ?? options.title;
  // 预扫脚注定义:identifier → definition 节点(正文循环跳过,引用渲染时取内容)
  for (const node of ast.children) {
    if (node.type === "footnoteDefinition") {
      ctx.footnoteDefinitions.set(node.identifier, node);
    }
  }
  // 预扫目录条目 + 题注上下文(题注编号:章节号 = 最近 h1 计数,图/表序按 h1 章节重置,
  // 与 Word SEQ \s 1 语义一致;headingNumbering 关闭时无章节号、全文档连续)
  const tocEntries: TocEntry[] = [];
  const captions = buildCaptionContext(ast, ctx);
  // 预扫章节 label(批次 10 功能 2):渲染前按文档顺序遍历标题,静态章节号计数 +
  // {#sec:label} 登记(引用可能出现在目标标题之前,渲染期登记会漏;与
  // captions/equations 预扫模式一致)。计数镜像 Word numbering 引擎逐段计数
  // (h1 增 → h2/h3 清零,h2 增 → h3 清零;depth 4-6 不计数,与 numbering
  // 只挂 h1-h3 一致);headingNumbering 关闭时不计数 → 引用侧按悬空处理
  const headingCounters = { h1: 0, h2: 0, h3: 0 };
  for (const node of ast.children) {
    if (node.type !== "heading" || ctx.headingNumbering !== true || node.depth > 3) continue;
    if (node.depth === 1) {
      headingCounters.h1 += 1;
      headingCounters.h2 = 0;
      headingCounters.h3 = 0;
    } else if (node.depth === 2) {
      headingCounters.h2 += 1;
      headingCounters.h3 = 0;
    } else {
      headingCounters.h3 += 1;
    }
    const chapterText = chapterNumberFromCounters(headingCounters, node.depth);
    const secLabel = node.data?.secLabel;
    const id = node.data?.id;
    if (chapterText !== null && secLabel !== undefined && typeof id === "string" && id !== "") {
      ctx.headingLabels.set(secLabel, { chapterText, slug: id });
    }
  }
  // 预扫公式编号上下文(9d:display 公式全文连续编号 + {#eq:label} 标签登记 + 交叉引用查表)。
  // 公式编号开关关闭时仍调用 buildEquationContext(numbering=false):label 段照常识别并
  // 跳过渲染(语法标记不显示),但公式不编号、label 不登记、无孤立 label 警告;引用查表
  // 为空 → 行内引用保持原文本(见 pushRuns 的 equationNumbering 门控)
  const equations: EquationContext = buildEquationContext(ast, ctx, ctx.equationNumbering !== false);
  // label 查表挂到 ctx(行内链接渲染处 pushRuns 经 ctx 访问)
  ctx.equationLabels = equations.labelIndex;
  if (ctx.toc) {
    for (const node of ast.children) {
      if (node.type === "heading" && node.depth <= 3) {
        const id = node.data?.id;
        if (typeof id === "string" && id !== "") {
          // 目录条目文本同标题渲染:尾部 {#sec:label} 不显示(与 renderHeading 一致)
          tocEntries.push({
            title: stripSecLabelSuffix(collectPlainText(node)),
            level: node.depth,
            href: docxBookmarkId(id),
          });
        }
      }
    }
  }
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const paper = PAPER_SIZES_MM[pageSetup.paper];
  const landscape = pageSetup.orientation === "landscape";
  // 文本区宽(公式编号 tab 制表位基准):PAPER_SIZES_MM 给纵向值,landscape 下
  // 视觉宽度为纸高(参照下方 size 的处理语义)— 左右边距 = 可用文本宽度
  const textWidthTwips = mmToTwips((landscape ? paper.height : paper.width) - pageSetup.marginLeft - pageSetup.marginRight);
  const children: (Paragraph | Table | TableOfContents)[] = [];
  // 封面页:metadata.title 存在时置于文档最前(独占一页,不计入标题层级/书签)
  if (options.metadata?.title) {
    children.push(...renderCoverPage(options.metadata));
  }
  // 目录页:开关开启且正文含标题节点时插入(封面之后/文档最前,独占一页;无标题的短文档不生成)
  if (ctx.toc && tocEntries.length > 0) {
    children.push(...renderTocPage(tocEntries));
  }
  for (const node of ast.children) {
    if (isSupportedBlock(node)) {
      children.push(...(await renderBlock(node, ctx, captions, equations, textWidthTwips)));
    }
    // definition 等:跳过不渲染
  }
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
    // 批注容器(批次 11):渲染期收集的批注按 id 组装;author 固定
    // "markdown-to-word",date 缺省由库取当前时间(库对空容器同样生成
    // comments.xml,传 undefined 与空容器等价,此处仅非空时显式传入;
    // comments 选项收 ICommentOptions 普通对象,非 Comment 实例)
    comments:
      Object.keys(ctx.comments).length > 0
        ? {
            children: Object.entries(ctx.comments).map(([id, c]) => ({
              id: Number(id),
              author: "markdown-to-word",
              children: c.children,
            })),
          }
        : undefined,
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
 * 目录页:标题居中加粗(36 half-points = 18pt)+ 静态目录,独占一页。
 * 标题用普通 Paragraph(不用 HeadingLevel,避免被 TOC 域 \o "1-3" 收集到目录自身)。
 * 免更新路线(beginDirty:false + cachedEntries):打开即见静态条目(纯超链接、
 * 无页码),不弹「更新域」提示;条目引用 TOC1..TOC9 样式 + 右对齐点线制表位。
 */
function renderTocPage(entries: TocEntry[]): (Paragraph | TableOfContents)[] {
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
      beginDirty: false, // 免更新:不标记 dirty,打开不提示
      cachedEntries: entries,
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

/**
 * 书签包裹:name → BookmarkStart/End 首尾包裹 children(输出
 * <w:bookmarkStart w:name="…" w:id="N"/>…<w:bookmarkEnd w:id="N"/>,
 * 内部锚点 InternalHyperlink 按 name 跳转,不受 id 影响)。
 * 不用 docx Bookmark 组件:其实例每枚独立 linkId 计数(恒为 1)→ 文档内
 * 标题书签与公式书签全部 w:id="1" 冲突(Word 要求文档内唯一,实测 WPS 显示异常);
 * 改用导出组件 + ctx.bookmarkNextId 自增保证文档内唯一。
 * BookmarkStart/End 不在 ParagraphChild 联合类型内(d.ts 实证),children 断言。
 */
function bookmarkChildren(ctx: Ctx, name: string, children: readonly ParagraphChild[]): ParagraphChild[] {
  const linkId = ctx.bookmarkNextId.value++;
  return [new BookmarkStart(name, linkId), ...children, new BookmarkEnd(linkId)] as unknown as ParagraphChild[];
}

async function renderBlock(
  node: BlockContent,
  ctx: Ctx,
  captions: Map<MdParagraph, CaptionInfo>,
  equations: EquationContext,
  textWidthTwips: number,
): Promise<(Paragraph | Table)[]> {
  switch (node.type) {
    case "heading":
      return [await renderHeading(node, ctx)];
    case "paragraph": {
      // 公式 label 段({#eq:label} 整段,见 buildEquationContext):登记后跳过渲染
      if (equations.skipSet.has(node)) return [];
      // 题注段(前缀行识别,见 buildCaptionContext):渲染为居中题注段落(带自动编号),
      // 不应用正文排版(无首行缩进/两端对齐),不进目录/书签(普通段落样式)。
      const caption = captions.get(node);
      if (caption) return [renderCaptionParagraph(caption, ctx)];
      // 普通正文段落:应用排版设置(对齐/行距/首行缩进)。
      // 作用范围仅限正文:heading/列表/代码/表格等段落保持各自样式,
      // 列表项不加首行缩进(与 PDF 侧 p { text-indent } 规则对齐语义)。
      return [renderBodyParagraph(await renderPhrasing(normalizeInlineHtml(node.children), ctx), ctx)];
    }
    case "list":
      return renderList(node, ctx);
    case "table":
      return [await renderTable(node, ctx)];
    case "code":
      return [await renderCode(node, ctx)];
    case "math":
      // display 公式。9d:有编号信息时按「公式居中 + 编号右对齐」排版——
      // center tab(50% 文本区宽)+ right tab(100% 文本区宽),
      // children = [Tab(), 公式, Tab(), "(N)"];label 存在时外包书签 eq-label
      // 供交叉引用跳转(编号静态注入,免更新域)。无编号信息(理论不可达)走原居中逻辑;
      // 降级(解析失败/未覆盖节点)输出 TeX 源码等宽灰字并追加警告,内容不丢失
      // (降级公式同样占编号)。不应用 5a 排版(无首行缩进/两端对齐,与 pdf 侧
      // .katex-display 居中语义对齐)。
      {
        const eq = equations.indexByNode.get(node);
        const result = texToDocxMath(node.value);
        if (!eq) {
          if (result.ok) {
            return [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new DocxMath({ children: result.children })],
              }),
            ];
          }
          ctx.warnings?.push(`公式解析失败,降级为 TeX 源码: ${node.value}`);
          return [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: result.text, font: CODE_FONT, color: "888888" })],
            }),
          ];
        }
        if (!result.ok) {
          ctx.warnings?.push(`公式解析失败,降级为 TeX 源码: ${node.value}`);
        }
        // 公式主体:解析成功 → docx Math;失败 → TeX 源码等宽灰字
        const mathChild: DocxMath | TextRun = result.ok
          ? new DocxMath({ children: result.children })
          : new TextRun({ text: result.text, font: CODE_FONT, color: "888888" });
        // 制表位跳格:Tab 必须包在 TextRun 内(裸 <w:tab/> 是非法段落级元素,
        // WPS 实测会把公式段降级显示;TextRun({ children: [Tab] }) 输出
        // <w:r><w:tab/></w:r> 合法结构)。包后全部为 ParagraphChild,无需断言
        const equationRuns: ParagraphChild[] = [
          new TextRun({ children: [new Tab()] }),
          mathChild,
          new TextRun({ children: [new Tab()] }),
          new TextRun({ text: `(${eq.index})` }),
        ];
        const paragraph = new Paragraph({
          // 制表位:center tab 于文本区正中(公式居中),right tab 于文本区右缘(编号右对齐)
          tabStops: [
            { type: TabStopType.CENTER, position: Math.floor(textWidthTwips / 2) },
            { type: TabStopType.RIGHT, position: textWidthTwips },
          ],
          children:
            eq.label !== undefined
              ? bookmarkChildren(ctx, docxBookmarkId(`eq-${eq.label}`), equationRuns)
              : equationRuns,
        });
        return [paragraph];
      }
    case "blockquote":
      return renderBlockquote(node, ctx);
    case "thematicBreak":
      return [renderThematicBreak()];
    case "html":
      // 显式分页符:<!-- page-break -->(trim 后精确匹配);
      // 内联格式白名单(无属性标签对,契约与 PDF 侧 isAllowedInlineHtml 逐字一致)
      // → 渲染为正文段落(排版设置生效);
      // 其余 html(脚本/块级/带属性标签)维持现状:跳过,安全兜底
      {
        const value = node.value.trim();
        if (value === "<!-- page-break -->") {
          return [new Paragraph({ children: [new PageBreak()] })];
        }
        if (isAllowedInlineHtml(value)) {
          return [renderInlineHtmlParagraph(node.value, ctx)];
        }
        return [];
      }
    default:
      return [];
  }
}

async function renderHeading(node: Heading, ctx: Ctx): Promise<Paragraph> {
  const levels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  // 行内 label(批次 10 功能 2):{#sec:label} 尾部后缀不渲染——渲染前从最后一个
  // 叶子文本节点剥离(递归副本,不改 AST;parse.ts 已从 slug 剥离,此处剥离
  // 渲染文本,label 不进标题文本;label 的章节号登记在 renderDocx 预扫完成)
  const secLabel = node.data?.secLabel;
  const children = secLabel !== undefined ? stripTrailingSecLabel(node.children) : node.children;
  const runs = await renderPhrasing(children, ctx);
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
    // docx 9.x Paragraph 无 bookmarks 选项:书签以 BookmarkStart/End 包裹标题 runs
    // 实现(linkId 由 ctx.bookmarkNextId 自增,避免组件级恒为 1 的书签 id 冲突)
    children:
      typeof id === "string" && id !== ""
        ? bookmarkChildren(ctx, docxBookmarkId(id), runs)
        : runs,
  });
}

/**
 * 静态章节号(批次 10 功能 2,镜像 Word numbering 引擎逐级计数):
 * 编号文本 = 深度 1..depth 当前计数拼接;前导未出现的级(计数 0)跳过
 * (无 h1 时 h2 从「1」起,与题注章节语义一致),中间未出现的级保留 0
 * (h1 后直接 h3 →「1.0.1」,与 Word 引擎显示一致)。
 * 仅镜像:headingNumberingOptions 模板或 numbering 配置变更会漂移(免更新路线已声明)。
 */
function chapterNumberFromCounters(
  counters: { h1: number; h2: number; h3: number },
  depth: number,
): string | null {
  const parts: number[] = [];
  let started = false;
  for (let i = 1; i <= depth; i++) {
    const v = counters[(`h${i}`) as keyof typeof counters];
    if (!started && v === 0) continue;
    started = true;
    parts.push(v);
  }
  return parts.length > 0 ? parts.join(".") : null;
}

/** 递归剥离最后一个叶子文本节点尾部的 {#sec:label}(渲染文本不含 label;
 *  返回副本,不改 AST;label 位于强调/加粗等嵌套节点内也命中) */
function stripTrailingSecLabel(children: PhrasingContent[]): PhrasingContent[] {
  if (children.length === 0) return children;
  const result = children.slice();
  const last = result[result.length - 1];
  if (last.type === "text") {
    result[result.length - 1] = { ...last, value: last.value.replace(/\s*\{#sec:[\w-]+\}$/, "") };
  } else if ("children" in last && Array.isArray(last.children) && last.children.length > 0) {
    // mdast children 联合类型收窄不完全,渲染场景恒为数组,显式断言后递归
    result[result.length - 1] = {
      ...last,
      children: stripTrailingSecLabel(last.children as PhrasingContent[]),
    } as PhrasingContent;
  }
  return result;
}

/** 纯文本尾部 {#sec:label} 剥离(目录条目标题等纯文本场景;与
 *  stripTrailingSecLabel / parse.ts SEC_LABEL_RE 同一正则,勿单侧改动) */
function stripSecLabelSuffix(text: string): string {
  return text.replace(/\s*\{#sec:[\w-]+\}$/, "");
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
            children: await renderPhrasing(normalizeInlineHtml(child.children), ctx),
          }),
        );
      }
      // 其他块(代码/引用等)在列表项内:G1 按普通段落降级渲染
      else if (child.type === "code") {
        result.push(await renderCode(child, ctx));
      } else if (child.type === "blockquote") {
        result.push(...(await renderBlockquote(child, ctx)));
      }
    }
  }
  return result;
}

/** 代码块:mermaid 围栏且有 resolver 时渲染为内嵌 PNG 图片(宽 >400 等比缩,
 *  与行内图片共用 scaleToFit);渲染失败(null/抛错)或缺失 resolver 时降级为
 *  等宽文本代码块(行为不变,内容不丢失,与公式降级语义一致)。
 *  已知语言(hljs.getLanguage 命中)走语法高亮(code-highlight.ts,GitHub Light
 *  色板);无语言/未知语言/高亮解析失败 → 等宽文本代码块。 */
async function renderCode(node: Code, ctx: Ctx): Promise<Paragraph> {
  if (node.lang === "mermaid" && ctx.mermaidResolver) {
    try {
      const result = await ctx.mermaidResolver(node.value);
      if (result) {
        const { width, height } = scaleToFit(result.width, result.height);
        return new Paragraph({
          children: [new ImageRun({ type: "png", data: result.png, transformation: { width, height } })],
        });
      }
      ctx.warnings?.push("Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ctx.warnings?.push(`Mermaid 渲染失败: ${reason},已降级为代码块`);
    }
  }
  const highlighted = highlightCodeRuns(node.value, node.lang ?? undefined);
  if (highlighted) {
    return new Paragraph({
      spacing: { before: 120, after: 120 },
      indent: { left: 360 },
      children: highlighted,
    });
  }
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
          children: await renderPhrasing(normalizeInlineHtml(child.children), ctx),
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
      const runs = await renderPhrasing(normalizeInlineHtml(cell.children), ctx, rowIndex === 0 ? { bold: true } : {});
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

/** 段落内可出现的 docx 子元素:文本 run、行内图片、脚注引用、超链接、公式或
 *  批注范围标记(d.ts 实证:Math 与 CommentRangeStart/End/Reference 均属
 *  ParagraphChild,可与 TextRun 同段混排)。
 *  export:inline-html.ts 的 renderBodyParagraph 参数类型引用(R10-6 拆分)。 */
export type InlineChild =
  | TextRun
  | ImageRun
  | FootnoteReferenceRun
  | InternalHyperlink
  | ExternalHyperlink
  | DocxMath
  | CommentRangeStart
  | CommentRangeEnd
  | CommentReference;

/** 行内节点 → 元素数组;样式沿父子链累积传递。
 * 标题等场景同样经 pushRuns 渲染(标题内图片/脚注引用按常规渲染,占位与警告语义与正文一致)。 */
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
    case "inlineMath": {
      // 行内公式:KaTeX MathML → docx Math 组件,随所在段落自然继承 5a 排版;
      // 降级(解析失败/未覆盖节点)→ TeX 源码等宽灰字 + 警告,内容不丢失
      const result = texToDocxMath(node.value);
      if (result.ok) {
        runs.push(new DocxMath({ children: result.children }));
      } else {
        runs.push(new TextRun({ text: result.text, font: CODE_FONT, color: "888888" }));
        ctx.warnings?.push(`公式解析失败,降级为 TeX 源码: ${node.value}`);
      }
      break;
    }
    case "link": {
      const text = node.children.map((c) => ("value" in c ? (c as { value: string }).value : "")).join("");
      const url = node.url;
      // 公式交叉引用(9d):[式](#eq:label) / [公式](#eq:label) → 文本替换为
      // 「式 (N)」/「公式 (N)」并跳转公式书签 eq-label;未知 label → 普通文本
      // 「式 (?)」无链接 + 警告;其他文本的 #eq: 链接保持原文本跳转公式书签。
      // 公式编号开关关闭时整个分支不生效:按普通 # 锚点链接渲染(保持原文本,
      // 不降级「(?)」、不追加警告,与 pdf 侧不注册 eq_numbering 规则行为一致)
      const eqMatch = ctx.equationNumbering === false ? null : /^#eq:([\w-]+)$/.exec(url);
      if (eqMatch) {
        const label = eqMatch[1];
        const n = ctx.equationLabels?.get(label);
        if (text === "式" || text === "公式") {
          if (n !== undefined) {
            runs.push(
              new InternalHyperlink({
                anchor: docxBookmarkId(`eq-${label}`),
                children: [new TextRun({ text: `${text} (${n})`, color: LINK_COLOR, underline: {}, ...style })],
              }),
            );
          } else {
            ctx.warnings?.push(`交叉引用未找到公式 label: ${label}`);
            runs.push(new TextRun({ text: `${text} (?)`, ...style }));
          }
          break;
        }
        runs.push(
          new InternalHyperlink({
            anchor: docxBookmarkId(`eq-${label}`),
            children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
        break;
      }
      // 图/表/章节交叉引用(批次 10 功能 2,文案与占位见 CROSS_REF_KINDS,勿散落硬编码):
      // [图](#fig:label) → 静态编号文本「图 3.1」+ 跳题注书签 fig-<label>;
      // [表](#tab:label) → 「表 1」+ 跳 tab-<label>;[章节](#sec:label) →
      // 静态章节号「3.2」+ 跳标题书签;引用文本非约定文本 → 保持原文本仍跳转
      // (与 #eq: 非「式/公式」行为一致);悬空 → 默认文本占位 + 警告,非约定
      // 文本保持原样不带链接(目标书签不存在,不生成死链;公式悬空非默认文本
      // 无警告的死链行为不复制,此处更安全)
      const crossMatch = /^#(fig|tab|sec):([\w-]+)$/.exec(url);
      if (crossMatch) {
        const kind = crossMatch[1] as CrossRefKind;
        const label = crossMatch[2];
        const def = CROSS_REF_KINDS[kind];
        let numberText: string | undefined;
        let anchor: string | undefined;
        if (kind === "sec") {
          const info = ctx.headingLabels.get(label);
          if (info) {
            numberText = info.chapterText;
            anchor = docxBookmarkId(info.slug);
          }
        } else {
          const info = ctx.captionLabels.get(label);
          // captionLabels 登记时已限定 kind 与前缀一致(见 captions.ts),此处防御性校验
          if (info && info.kind === kind) {
            numberText = info.numberText;
            anchor = docxBookmarkId(`${kind}-${label}`);
          }
        }
        if (numberText !== undefined && anchor !== undefined) {
          runs.push(
            new InternalHyperlink({
              anchor,
              children: [new TextRun({ text: text === def.defaultText ? numberText : text, color: LINK_COLOR, underline: {}, ...style })],
            }),
          );
        } else {
          ctx.warnings?.push(`交叉引用未找到${def.kindName} label: ${kind}:${label}`);
          runs.push(new TextRun({ text: text === def.defaultText ? def.danglingText : text, ...style }));
        }
        break;
      }
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
    case "comment": {
      // 批注(批次 11):[锚定文本]{批注=内容} → commentRangeStart + 锚定文本
      // runs(递归渲染 anchor 行内,继承当前样式)+ commentRangeEnd +
      // commentReference(必须包在 TextRun 内);批注内容收集为独立段落
      // (author 固定 "markdown-to-word",date 缺省由库取当前时间;内容不继承
      // 锚定处样式,批注气泡独立排版)
      const id = ctx.commentNextId.value++;
      runs.push(new CommentRangeStart(id));
      for (const child of node.anchor) await pushRuns(runs, child, ctx, style);
      runs.push(new CommentRangeEnd(id));
      runs.push(new TextRun({ children: [new CommentReference(id)] }));
      ctx.comments[String(id)] = {
        children: [new Paragraph({ children: await renderPhrasing(node.content, ctx) })],
      };
      break;
    }
    case "html":
      // 白名单行内 html(经 normalizeInlineHtml 已合并为整串):渲染为样式运行;
      // 非白名单(理论不可达,防御):跳过
      if (isAllowedInlineHtml(node.value)) {
        runs.push(...inlineHtmlItemsToRuns(parseInlineHtml(node.value)));
      }
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
        paragraphs.push(new Paragraph({ children: await renderPhrasing(normalizeInlineHtml(child.children), ctx) }));
        break;
      case "list":
        paragraphs.push(...(await renderList(child, ctx)));
        break;
      case "code":
        paragraphs.push(await renderCode(child, ctx));
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

/** 图片尺寸缩放(行内图片与 mermaid PNG 共用):宽 ≤ 400 原尺寸(不放大),
 *  宽 > 400 等比缩到 400 宽(高度按同比例取整)。 */
function scaleToFit(width: number, height: number): { width: number; height: number } {
  if (width > 400) {
    const scale = 400 / width;
    return { width: 400, height: Math.round(height * scale) };
  }
  return { width, height };
}

/** 行内图片:经 resolver 加载为 ImageRun;失败或 webp 时占位文本。
 *  尺寸规则:能解析出 PNG/JPEG 尺寸时,宽 ≤ 400 原尺寸(不放大),宽 > 400 等比缩到
 *  400 宽;无法解析尺寸(其他格式/畸形数据)→ 400×300 兜底。
 *  M6:本地缺失与外链下载失败统一经 resolver 失败路径告警(单次 IO),
 *  文案 imageLoadFailedWarning(三处统一,见 core/image-warning.ts)。 */
async function imageToDocx(node: Image, ctx: Ctx, style: RunStyle): Promise<InlineChild> {
  const fallback = () => new TextRun({ text: `[图片: ${node.alt || node.url}]`, color: "808080", ...style });
  const isExternal = /^https?:/i.test(node.url);
  // 失败统一告警:本地(缺失/不可读)与外链(下载失败)同一文案;
  // 无 resolver 时本地无从检查(不做 stat 预扫),仅外链可判定失败
  const warnFail = (): void => {
    if (ctx.imageResolver || isExternal) ctx.warnings?.push(imageLoadFailedWarning(node.url));
  };
  if (!ctx.imageResolver) {
    warnFail();
    return fallback();
  }
  let data: Buffer | null;
  try {
    data = await ctx.imageResolver(node.url);
  } catch {
    data = null;
  }
  if (!data) {
    warnFail();
    return fallback();
  }
  const type = sniffImageType(data);
  if (type === "webp") {
    ctx.warnings?.push(`webp 图片不支持 docx 内嵌,已跳过: ${node.url}`);
    return fallback();
  }
  const size = imageSizeFromBuffer(data);
  const { width, height } = size ? scaleToFit(size.width, size.height) : { width: 400, height: 300 };
  return new ImageRun({ type, data, transformation: { width, height } });
}

