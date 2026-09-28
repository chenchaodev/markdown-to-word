/**
 * docx 渲染主入口:renderDocx 编排(预扫 → 正文块渲染 → Document 组装)。
 * 不变量:各渲染职责拆分到独立模块(编号/标题/表格/公式/chrome/预扫/行内/
 * 链接/图片/代码块/容器降级),本模块仅做编排,core 层保持无 IO。
 *
 * 双管线对应(与 src/core/pdf/render.ts 成对;格式差异总览单源 core/convert.ts
 * 头注「双管线差异」):本侧输入 mdast AST(pipeline/parse.ts 预解析)产 Buffer;
 * pdf 侧输入 markdown 源文、经 markdown-it 产 HTML 文档(printToPDF 在主进程)。
 * 结构信息获取方式相反:本侧渲染前经 prescan.ts 全文预扫(题注/章节/公式上下文
 * 写入 ctx、目录条目),pdf 侧无预扫(rules/* 在渲染期即时识别),目录条目渲染后
 * 由 pdf/postprocess.ts 从 HTML 提取。chrome 分居 docx/chrome.ts(封面/目录页/
 * 页眉页脚/水印组件)与 pdf/template.ts + pdf/postprocess.ts(封面/页眉页脚/水印
 * 模板、目录)。选项契约:RenderOptions 与 pdf 侧 RenderPdfHtmlOptions 的同名开关
 * (pageSetup/typography/toc/headingNumbering/captionNumbering/equationNumbering/
 * mermaidResolver/watermark)语义与默认值须两侧对齐(默认值单源
 * settings-defaults/typography);本侧独有 tocMode/headerFooter/headerLogo,
 * pdf 侧独有 baseDir/pdfCss/katexDir/onStage。修改任一侧的选项语义或渲染主流程,
 * 须同步核对 src/core/pdf/render.ts 对应项。
 */
import {
  AlignmentType,
  Document,
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
import { renderCoverPage, renderTocPage, renderFooter, type HeaderLogoData } from "./chrome.js";
import { buildHeaders } from "./headers.js";
import { renderPhrasing, renderList, renderBlockquote, renderThematicBreak } from "./handlers/content.js";
import { renderCode } from "./handlers/code-block.js";
import { renderBodyParagraph, renderInlineHtmlParagraph, normalizeInlineHtml } from "./handlers/inline-html.js";
import { renderHeading } from "./handlers/heading.js";
import { renderTable } from "./handlers/table.js";
// 页面设置契约单源(settings-defaults;原经 convert.js 导入形成 convert⇄render 环,此处解环)
import {
  mmToTwips,
  PAPER_SIZES_MM,
  twipsToPx,
  validatePageSetup,
  type HeaderFooterSettings,
  type TocMode,
} from "../settings/settings-defaults.js";
// 双管线渲染选项的共有字段与默认值解析单源(adr-030 6-D1/6-D2)
import {
  resolveHeaderFooter,
  resolveRenderSwitches,
  resolveTocMode,
  type SharedRenderOptions,
} from "../settings/render-options.js";
import { isAllowedInlineHtml } from "../markdown/html-whitelist.js";
import { isFigureParagraph } from "../markdown/image-size.js";
import { CROSS_REF_KINDS } from "../markdown/cross-ref.js";
export { CROSS_REF_KINDS };
import { headingNumberingOptions, numberingOptions } from "./numbering.js";
import {
  unrecognizedImageWarning,
  webpSkippedWarning,
} from "../image/image-warning.js";
// 取消与资源预算:守卫由 convert 层构造并注入(signal/deadline 单源),
// 图片 resolver 在此包上请求契约(信号/单请求时限/单图与文档字节预算)。
import { createCancellationGuard, createGuardedImageResolver } from "../cancel.js";
import { ImageBudgetLedger, resolveImageBudget } from "../resource-limits.js";

/**
 * docx 渲染选项 = 双管线共有字段(SharedRenderOptions)+ 本侧独有条目。
 *
 * 共有字段不在此重复声明(adr-030 决定要点三的 6-D2):改一个共有开关的语义只需改
 * settings/render-options.ts 一处,两侧 JSDoc 不会互相说谎。默认值解析也在那里
 * 统一做(6-D1)——光有类型单源不解决漏传,类型系统对可选字段没有默认值检查。
 *
 * 独有条目(tocMode/headerFooter/headerLogo)是 docx 侧载体专属,故不在共有契约里;
 * 反向也不强迫 docx 声明 pdf-only 字段(那会让类型承诺它不消费的东西)。
 */
export interface RenderOptions extends SharedRenderOptions {
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码) */
  tocMode?: TocMode;
  /** 页眉页脚配置(缺省 DEFAULT_HEADER_FOOTER = 现状行为:标题页眉+页码页脚) */
  headerFooter?: HeaderFooterSettings;
  /** 页眉 logo 已读数据(main 层读文件后注入,core 零 IO;仅 headerMode=custom 消费;
   *  webp/null 魔数降级为无 logo + keyed 警告) */
  headerLogo?: HeaderLogoData;
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
  // 入口检查点:预取消/过期 deadline 在建 ctx、预扫之前短路,不启动任何 resolver
  const guard = options.guard ?? createCancellationGuard();
  guard.throwIfCanceled();
  // 开关默认值解析单源(6-D1):一次解析,下游全字段必填
  const switches = resolveRenderSwitches(options);
  const { typography, pageSetup } = switches;
  // 页面几何提前计算:contentWidthPx 注入 Ctx.config,图片尺寸属性百分比换算用
  const geometry = validatePageSetup(pageSetup);
  const paper = PAPER_SIZES_MM[pageSetup.paper];
  const landscape = pageSetup.orientation === "landscape";
  // 文本区宽(公式编号 tab 制表位基准)复用核心 validator 的视觉方向结果。
  const textWidthTwips = mmToTwips(geometry.contentWidthMm);
  // 图片预算(缺省取单源默认值):台账生命周期 = 单次 renderDocx,不跨转换累计
  const imageBudget = resolveImageBudget(options.imageBudget);
  // 开关统一「构造时解析默认」:Ctx 与各子对象全字段必填,下游无需判空
  // (Ctx 分组契约见 ctx.ts;本函数是唯一的 Ctx 组装点)
  const ctx: Ctx = {
    listLevel: 0,
    config: {
      typography,
      breakBeforeH1: switches.breakBeforeH1,
      headingNumbering: switches.headingNumbering,
      captionNumbering: switches.captionNumbering,
      toc: switches.toc,
      tocMode: resolveTocMode(options.tocMode),
      equationNumbering: switches.equationNumbering,
      contentWidthPx: twipsToPx(textWidthTwips),
    },
    xref: {
      captionLabels: new Map(),
      headingLabels: new Map(),
      bookmarkNextId: { value: 1 },
    },
    footnote: {
      definitions: new Map(),
      notes: {},
      nextId: { value: 1 },
      idByLabel: new Map(),
    },
    comment: {
      nextId: { value: 1 },
      notes: {},
    },
    image: {
      // 图片解析经守卫包装:注入 request(signal/maxBytes/timeoutMs)、单请求时限、
      // 文档级数量/字节预算(记账口径 = 原始字节,docx 内嵌即原始字节)。
      resolver: createGuardedImageResolver({
        resolver: options.imageResolver,
        guard,
        budget: imageBudget,
        ledger: new ImageBudgetLedger(imageBudget),
      }),
      memo: new Map(),
    },
    warning: {
      list: options.warnings,
      warnedKeys: new Set(),
    },
    mermaidResolver: options.mermaidResolver,
  };
  // 页眉标题:metadata.title 优先,其次 options.title(无标题时不渲染页眉)
  const title = options.metadata?.title ?? options.title;
  // 页眉页脚与水印的默认字段补全也在单源(convert 层此前另有一份,两处会漂移)
  const headerFooter = resolveHeaderFooter(options.headerFooter);
  const watermark = switches.watermark;
  // custom 模式 logo 魔数降级:webp 不支持 docx 内嵌、未知魔数不伪装——均降级为
  // 无 logo + keyed 警告(复用正文图片同款文案,src = 设置的 logo 路径)
  let headerLogo = options.headerLogo;
  if (headerLogo && headerFooter.headerMode === "custom") {
    const src = headerFooter.headerLogoPath;
    if (headerLogo.extension === "webp") {
      ctx.warning.list?.push(webpSkippedWarning(src));
      headerLogo = undefined;
    } else if (headerLogo.extension === null) {
      ctx.warning.list?.push(unrecognizedImageWarning(src));
      headerLogo = undefined;
    }
  }
  // 五轮预扫(脚注定义/题注上下文/章节 label/公式编号/目录条目,详见 prescan.ts);
  // 预扫就地写入 ctx(footnote.definitions/xref.headingLabels/xref.equationLabels)
  const { tocEntries, captions, equations } = prescanDocument(ast, ctx);
  const children: (Paragraph | Table | TableOfContents)[] = [];
  // 封面页:metadata.title 存在时置于文档最前(独占一页,不计入标题层级/书签)
  if (options.metadata?.title) {
    children.push(...renderCoverPage(options.metadata));
  }
  // 目录页:开关开启且正文含标题节点时插入(封面之后/文档最前,独占一页;无标题的短文档不生成)
  if (ctx.config.toc && tocEntries.length > 0) {
    children.push(...renderTocPage(tocEntries, ctx.config.tocMode));
  }
  for (const node of ast.children) {
    // 块级检查点:逐块复查取消/期限,长文档(块数多、单块重)不必跑完整篇才退出
    guard.throwIfCanceled();
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
    footnotes: Object.keys(ctx.footnote.notes).length > 0 ? ctx.footnote.notes : undefined,
    // 批注容器:渲染期收集的批注按 id 组装;author 固定
    // "markdown-to-word",date 缺省由库取当前时间(库对空容器同样生成
    // comments.xml,传 undefined 与空容器等价,此处仅非空时显式传入;
    // comments 选项收 ICommentOptions 普通对象,非 Comment 实例)
    comments:
      Object.keys(ctx.comment.notes).length > 0
        ? {
            children: Object.entries(ctx.comment.notes).map(([id, c]) => ({
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
  // 打包前最后一道检查点:Packer.toBuffer 不可中断,取消在此之后只能等它跑完,
  // 故必须先查——否则取消仍会产出一个完整的 docx Buffer(上层会误以为成功)
  guard.throwIfCanceled();
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
