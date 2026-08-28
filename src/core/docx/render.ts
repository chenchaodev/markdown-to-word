/**
 * docx 渲染主入口:renderDocx 编排(预扫 → 正文块渲染 → Document 组装)。
 * 不变量:各渲染职责拆分到独立模块(编号/标题/表格/公式/chrome/预扫/行内/
 * 链接/图片/代码块/容器降级),本模块仅做编排,core 层保持无 IO。
 */
import {
  AlignmentType,
  Document,
  Header,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableOfContents,
} from "docx";
import type { BlockContent, Paragraph as MdParagraph, Root, RootContent } from "mdast";
import type { CaptionInfo } from "./handlers/captions.js";
import { renderCaptionParagraph } from "./handlers/captions.js";
import { renderDisplayMath, type EquationContext } from "./handlers/equations.js";
import { type Ctx } from "./ctx.js";
import { prescanDocument } from "./prescan.js";
import { renderCoverPage, renderTocPage, renderHeader, renderFooter, renderWatermarkParagraph, type HeaderLogoData } from "./chrome.js";
import { renderPhrasing, renderList, renderBlockquote, renderThematicBreak } from "./handlers/content.js";
import { renderCode } from "./handlers/code-block.js";
import { renderBodyParagraph, renderInlineHtmlParagraph, normalizeInlineHtml } from "./handlers/inline-html.js";
import { renderHeading } from "./handlers/heading.js";
import { renderTable } from "./handlers/table.js";
// 页面设置契约单源(settings-defaults;原经 convert.js 导入形成 convert⇄render 环,此处解环)
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_SETUP,
  DEFAULT_WATERMARK,
  mmToTwips,
  PAPER_SIZES_MM,
  twipsToPx,
  type HeaderFooterSettings,
  type PageSetup,
  type WatermarkSettings,
} from "../settings/settings-defaults.js";
import type { DocMetadata } from "../pipeline/frontmatter.js";
import type { TypographySettings } from "../settings/typography.js";
import { DEFAULT_TYPOGRAPHY } from "../settings/typography.js";
import { isAllowedInlineHtml } from "../markdown/html-whitelist.js";
import { isFigureParagraph } from "../markdown/image-size.js";
import { CROSS_REF_KINDS } from "../markdown/cross-ref.js";
export { CROSS_REF_KINDS };
import { headingNumberingOptions, numberingOptions } from "./numbering.js";
import type { ConvertWarning } from "../i18n.js";
import {
  unrecognizedImageWarning,
  webpSkippedWarning,
} from "../image/image-warning.js";
import type { MermaidResolver } from "../markdown/mermaid.js";
import type { TocMode } from "../settings/settings-defaults.js";
import type { ImageResolver } from "../image/image-resolver.js";

export interface RenderOptions {
  imageResolver?: ImageResolver;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页) */
  metadata?: DocMetadata;
  /** 文档标题(docx 页眉用;优先级低于 metadata.title) */
  title?: string;
  /** 警告收集(图片加载失败统一文案 imageLoadFailedWarning;webp 降级等;
   *  元素为 ConvertWarning,keyed 警告经显示层 formatWarning 按语言格式化) */
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
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码) */
  tocMode?: TocMode;
  /** 公式编号开关(默认开;关时 display 公式不编号、{#eq:label} 段原样渲染、引用保持原文本) */
  equationNumbering?: boolean;
  /** 图/表题注自动编号(默认开,取 typography.captionNumbering;显式传值优先) */
  captionNumbering?: boolean;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
  /** 页眉页脚配置(缺省 DEFAULT_HEADER_FOOTER = 现状行为:标题页眉+页码页脚) */
  headerFooter?: HeaderFooterSettings;
  /** 页眉 logo 已读数据(main 层读文件后注入,core 零 IO;仅 headerMode=custom 消费;
 *  webp/null 魔数降级为无 logo + keyed 警告) */
  headerLogo?: HeaderLogoData;
  /** 文字水印(缺省 DEFAULT_WATERMARK = 不启用;text 空串即关闭) */
  watermark?: WatermarkSettings;
}

/** 支持的块级节点类型(mdast 中 image 属 PhrasingContent,在段落内处理;
 *  math 为 display 公式,独立居中段落) */
function isSupportedBlock(node: RootContent): node is BlockContent {
  return ["heading", "paragraph", "list", "table", "code", "blockquote", "thematicBreak", "html", "math"].includes(
    node.type,
  );
}

/**
 * 将 mdast AST 渲染为 docx Buffer。
 * core 层保持无 IO:图片一律经 imageResolver 注入(由调用方负责读文件)。
 */
export async function renderDocx(ast: Root, options: RenderOptions = {}): Promise<Buffer> {
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  // 页面几何提前计算:contentWidthPx 注入 Ctx,图片尺寸属性百分比换算用
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const paper = PAPER_SIZES_MM[pageSetup.paper];
  const landscape = pageSetup.orientation === "landscape";
  // 文本区宽(公式编号 tab 制表位基准):PAPER_SIZES_MM 给纵向值,landscape 下
  // 视觉宽度为纸高(参照下方 size 的处理语义)— 左右边距 = 可用文本宽度
  const textWidthTwips = mmToTwips((landscape ? paper.height : paper.width) - pageSetup.marginLeft - pageSetup.marginRight);
  // 开关统一「构造时解析默认」:Ctx 全字段必填,下游无需判空
  const ctx: Ctx = {
    imageResolver: options.imageResolver,
    warnings: options.warnings,
    listLevel: 0,
    typography,
    breakBeforeH1: options.breakBeforeH1 ?? false,
    headingNumbering: options.headingNumbering ?? typography.headingNumbering,
    captionNumbering: options.captionNumbering ?? typography.captionNumbering,
    toc: options.toc ?? true,
    tocMode: options.tocMode ?? "static",
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
    contentWidthPx: twipsToPx(textWidthTwips),
  };
  // 页眉标题:metadata.title 优先,其次 options.title(无标题时不渲染页眉)
  const title = options.metadata?.title ?? options.title;
  // 页眉页脚配置归一化:缺省字段补 DEFAULT_HEADER_FOOTER(= 现状行为)
  const headerFooter: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER, ...options.headerFooter };
  // 水印配置归一化(缺省字段补 DEFAULT_WATERMARK;text 空串视为关闭)
  const watermark: WatermarkSettings = { ...DEFAULT_WATERMARK, ...options.watermark };
  // custom 模式 logo 魔数降级:webp 不支持 docx 内嵌、未知魔数不伪装——均降级为
  // 无 logo + keyed 警告(复用正文图片同款文案,src = 设置的 logo 路径)
  let headerLogo = options.headerLogo;
  if (headerLogo && headerFooter.headerMode === "custom") {
    const src = headerFooter.headerLogoPath;
    if (headerLogo.extension === "webp") {
      ctx.warnings?.push(webpSkippedWarning(src));
      headerLogo = undefined;
    } else if (headerLogo.extension === null) {
      ctx.warnings?.push(unrecognizedImageWarning(src));
      headerLogo = undefined;
    }
  }
  // 五轮预扫(脚注定义/题注上下文/章节 label/公式编号/目录条目,详见 prescan.ts);
  // 预扫就地写入 ctx(footnoteDefinitions/headingLabels/equationLabels)
  const { tocEntries, captions, equations } = prescanDocument(ast, ctx);
  const children: (Paragraph | Table | TableOfContents)[] = [];
  // 封面页:metadata.title 存在时置于文档最前(独占一页,不计入标题层级/书签)
  if (options.metadata?.title) {
    children.push(...renderCoverPage(options.metadata));
  }
  // 目录页:开关开启且正文含标题节点时插入(封面之后/文档最前,独占一页;无标题的短文档不生成)
  if (ctx.toc && tocEntries.length > 0) {
    children.push(...renderTocPage(tocEntries, ctx.tocMode));
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
    // 批注容器:渲染期收集的批注按 id 组装;author 固定
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
        // 页眉分流 + 水印合并:default=标题居中/custom=文字+logo/none=无页眉;
        // 水印(text 非空)与页眉共存于同一 default 头(置底),互不覆盖
        headers: buildHeaders(headerFooter, title, headerLogo, textWidthTwips, watermark),
        // 页脚开关:false 时不装配 footers(docx 不生成 footer part)
        footers: headerFooter.footerEnabled ? { default: renderFooter() } : undefined,
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------- 块级节点 ----------

/**
 * section 页眉装配分流:按 headerMode 产出 headers 配置或 undefined。
 * - default:现状行为——有标题才装配(标题居中)
 * - custom:文字(trim 后)与 logo 至少一项存在才装配(全空无内容可显示)
 * - none:不装配
 */
function buildHeaderForSection(
  headerFooter: HeaderFooterSettings,
  title: string | undefined,
  headerLogo: HeaderLogoData | undefined,
  contentWidthTwips: number,
): { default: ReturnType<typeof renderHeader> } | undefined {
  if (headerFooter.headerMode === "none") return undefined;
  if (headerFooter.headerMode === "custom") {
    const text = headerFooter.headerText.trim();
    if (!text && !headerLogo) return undefined;
    return {
      default: renderHeader({ kind: "custom", text, logo: headerLogo, layout: headerFooter.headerLayout }, contentWidthTwips),
    };
  }
  return title ? { default: renderHeader({ kind: "title", title }, contentWidthTwips) } : undefined;
}

/**
 * 页眉 + 水印合并装配:headerFooter 经 buildHeaderForSection 产出 title/
 * custom 页眉(可能无);水印(text 非空)作为置底段落并入同一 default 头——
 * docx 头类型仅 default/first/even,标题头与水印须共存于同一 default 头,
 * 故以「标题头段落 + 水印段落」重构一个 Header(标题头段落经其 options.children 取回)。
 * 水印关闭(text 空)或标题头无(default none 且无标题)时,仅水印自成 default 头。
 */
function buildHeaders(
  headerFooter: HeaderFooterSettings,
  title: string | undefined,
  headerLogo: HeaderLogoData | undefined,
  contentWidthTwips: number,
  watermark: WatermarkSettings,
): { default: Header } | undefined {
  const base = buildHeaderForSection(headerFooter, title, headerLogo, contentWidthTwips);
  if (!watermark.text.trim()) return base;
  const wmPara = renderWatermarkParagraph(watermark);
  if (!base) return { default: new Header({ children: [wmPara] }) };
  return {
    default: new Header({ children: [...(base.default.options.children as readonly Paragraph[]), wmPara] }),
  };
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
      // 独立成段的图片(段落唯一内容是图片[+尾随尺寸属性块])视为 figure →
      // 居中渲染;紧随其后的「图: xxx」题注行仍由 captions 预扫识别,保持在图
      // 下方(captionNumbering 编号机制不变)。行内内容渲染复用 renderPhrasing
      // (尾随属性块消费与非法值警告在其中统一处理)。
      if (isFigureParagraph(node.children)) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            children: await renderPhrasing(node.children, ctx),
          }),
        ];
      }
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
      // display 公式:有编号信息走「居中 + 编号右对齐」,无编号信息(equationNumbering
      // 关闭时的主路径)走原居中逻辑;降级输出 TeX 源码等宽灰字并追加警告。
      // 详见 handlers/equations.ts renderDisplayMath。
      return renderDisplayMath(node, ctx, equations.indexByNode.get(node), textWidthTwips);
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
