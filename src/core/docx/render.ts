/**
 * docx 渲染主入口(B8 拆分后):renderDocx 编排(预扫 → 正文块渲染 → Document 组装),
 * 文档 chrome 见 chrome.ts、预扫见 prescan.ts、行内/嵌套内容见 content.ts、
 * 链接交叉引用见 link-xref.ts、图片见 image-run.ts、代码块见 code-block.ts、
 * 容器降级见 fallback.ts、共享契约见 ctx.ts。
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Math as DocxMath,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableOfContents,
  TableCell,
  TableRow,
  Tab,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import type { INumberingOptions, ParagraphChild } from "docx";
import type {
  BlockContent,
  Heading,
  Paragraph as MdParagraph,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";
import { CODE_FONT, MUTED_TEXT_GRAY } from "./theme.js";
import { wrapBookmark } from "./bookmark.js";
import { texToDocxMath } from "./math.js";
import { renderCaptionParagraph, type CaptionInfo } from "./captions.js";
import type { EquationContext } from "./equations.js";
import { formulaParseFailedWarning, type Ctx } from "./ctx.js";
import { prescanDocument } from "./prescan.js";
import { renderCoverPage, renderTocPage, renderHeader, renderFooter } from "./chrome.js";
import { renderPhrasing, renderList, renderBlockquote, renderThematicBreak } from "./content.js";
import { renderCode } from "./code-block.js";
import { renderBodyParagraph, renderInlineHtmlParagraph, normalizeInlineHtml } from "./inline-html.js";
// 页面设置契约单源(settings-defaults;原经 convert.js 导入形成 convert⇄render 环,B7 解环)
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../settings-defaults.js";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import { DEFAULT_TYPOGRAPHY } from "../typography.js";
import { docxBookmarkId } from "../slug.js";
import { isAllowedInlineHtml } from "../html-whitelist.js";
import { stripSecLabelSuffix, CROSS_REF_KINDS } from "../cross-ref.js";
export { CROSS_REF_KINDS };
import type { ConvertWarning } from "../i18n.js";
import type { MermaidResolver } from "../mermaid.js";
// 契约单源(B7):ImageResolver 类型收敛 core 共享模块(render.js 保持 re-export 兼容)
import type { ImageResolver } from "../image-resolver.js";
export type { ImageResolver };

export interface RenderOptions {
  imageResolver?: ImageResolver;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页) */
  metadata?: DocMetadata;
  /** 文档标题(docx 页眉用;优先级低于 metadata.title) */
  title?: string;
  /** 警告收集(图片加载失败统一文案 imageLoadFailedWarning;webp 降级等;
   *  B6 起元素为 ConvertWarning,keyed 警告经显示层 formatWarning 按语言格式化) */
  warnings?: ConvertWarning[];
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
    footnoteIdByLabel: new Map(),
    warnedKeys: new Set(),
    bookmarkNextId: { value: 1 },
    commentNextId: { value: 1 },
    comments: {},
    captionLabels: new Map(),
    headingLabels: new Map(),
    mermaidResolver: options.mermaidResolver,
    imageMemo: new Map(),
  };
  // 页眉标题:metadata.title 优先,其次 options.title(无标题时不渲染页眉)
  const title = options.metadata?.title ?? options.title;
  // 五轮预扫(脚注定义/题注上下文/章节 label/公式编号/目录条目,详见 prescan.ts);
  // 预扫就地写入 ctx(footnoteDefinitions/headingLabels/equationLabels)
  const { tocEntries, captions, equations } = prescanDocument(ast, ctx);
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
          // 排版设置:字体/字号唯一来源是 typography 设置(theme.ts 只收固定样式常量);
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
          ctx.warnings?.push(formulaParseFailedWarning(node.value));
          return [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: result.text, font: CODE_FONT, color: MUTED_TEXT_GRAY })],
            }),
          ];
        }
        if (!result.ok) {
          ctx.warnings?.push(formulaParseFailedWarning(node.value));
        }
        // 公式主体:解析成功 → docx Math;失败 → TeX 源码等宽灰字
        const mathChild: DocxMath | TextRun = result.ok
          ? new DocxMath({ children: result.children })
          : new TextRun({ text: result.text, font: CODE_FONT, color: MUTED_TEXT_GRAY });
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
              ? wrapBookmark(ctx.bookmarkNextId, docxBookmarkId(`eq-${eq.label}`), equationRuns)
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
        ? wrapBookmark(ctx.bookmarkNextId, docxBookmarkId(id), runs)
        : runs,
  });
}

/** 递归剥离最后一个叶子文本节点尾部的 {#sec:label}(渲染文本不含 label;
 *  返回副本,不改 AST;label 位于强调/加粗等嵌套节点内也命中) */
function stripTrailingSecLabel(children: PhrasingContent[]): PhrasingContent[] {
  if (children.length === 0) return children;
  const result = children.slice();
  const last = result[result.length - 1]!; // 函数首行已守卫 children.length > 0
  if (last.type === "text") {
    result[result.length - 1] = { ...last, value: stripSecLabelSuffix(last.value) };
  } else if ("children" in last && Array.isArray(last.children) && last.children.length > 0) {
    // mdast children 联合类型收窄不完全,渲染场景恒为数组,显式断言后递归
    result[result.length - 1] = {
      ...last,
      children: stripTrailingSecLabel(last.children as PhrasingContent[]),
    } as PhrasingContent;
  }
  return result;
}

async function renderTable(node: MdTable, ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = [];
  for (const [rowIndex, row] of node.children.entries()) {
    const cells: TableCell[] = [];
    for (const [colIndex, cell] of row.children.entries()) {
      const runs = await renderPhrasing(normalizeInlineHtml(cell.children), ctx, rowIndex === 0 ? { bold: true } : {});
      // B3:GFM 列对齐(:--- / :---: / ---:)映射为段落对齐;未声明列(null)保持缺省左对齐
      // (此前 mdast table.align 被忽略,双格式保真不一致:pdf 侧 markdown-it 原生支持)
      const align = node.align?.[colIndex];
      const alignment =
        align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : undefined;
      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: runs,
              ...(alignment ? { alignment } : {}),
            }),
          ],
        }),
      );
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
