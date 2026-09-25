/**
 * 格式注册表:md → 各格式渲染产物(无 IO、无 Electron,便于测试与 CLI 复用)。
 * docx → Buffer;pdf → HTML 文档 + 页码页脚模板(printToPDF 由主进程执行)。
 * 图片等外部资源经 context 注入,保持 core 纯逻辑。
 *
 * 双管线差异(选型结论,勿合并;与 docx 侧差异是有意的,各差异点均有对应测试段):
 * - 解析:docx 走 remark 自研渲染管线(mdast AST → docx 组件,parse.ts);
 *   pdf 走 markdown-it → HTML 模板(renderPdfHtml)。两套解析器输出语义对齐,
 *   差异点由双格式断言段覆盖(basic-render/cross-ref 等)。
 * - 公式:docx 渲染为 Office MathML(docx/handlers/math.ts);pdf 渲染为 KaTeX HTML
 *   (katexDir 注入,缺资源降级)。→ formula.test.js
 * - 代码高亮:双格式均走 hljs——docx 已知语言逐 token 着色(code-highlight.ts,
 *   无语言/未知语言/解析失败降级等宽);pdf 高亮进 HTML(抛错回退转义)。
 *   → basic-render.test.js
 * - mermaid:docx 内嵌 PNG(2x);pdf 内联 SVG(矢量)。→ mermaid.test.js
 * - 目录:docx 静态目录(打开即见、可点击跳转、无页码);pdf 目录同开关。
 *   → toc-caption.test.js
 * - 编号开关(headingNumbering / captionNumbering):本层只透传显式项,
 *   默认值由两侧 render 的 `options.X ?? typography.X` 解析(见两字段 JSDoc)。
 * - 脚注:docx 写 footnotes.xml 部件;pdf 渲染为 HTML 脚注。→ footnotes.test.js
 */
import { parseMarkdown } from "./pipeline/parse.js";
import { parseFrontmatter } from "./pipeline/frontmatter.js";
import type { DocMetadata } from "./pipeline/frontmatter.js";
import type { TypographySettings } from "./settings/typography.js";
import type { ConvertWarning } from "./i18n.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfDocument } from "./pdf/render.js";
// PdfHeading 契约单源在 pdf/bookmarks.ts(docx 侧无对应物:目录由 Word 域生成)
import type { PdfHeading } from "./pdf/bookmarks.js";
import {
  buildPdfHeaderTemplate,
  PDF_EMPTY_CHROME_TEMPLATE,
  PDF_FOOTER_TEMPLATE,
} from "./pdf/template.js";
import type { HeaderLogoData } from "./docx/chrome.js";
import type { MermaidResolver } from "./markdown/mermaid.js";
// 契约单源:ImageResolver 类型收敛于 core/image/image-resolver.ts(此处仅类型导入)
import type { ImageResolver } from "./image/image-resolver.js";
// 页面设置与格式契约单源在 settings-defaults.ts;本文件不再转手 re-export(双入口
// 已清):下游(main/测试)一律直连 settings-defaults 取类型与默认值。
import type { ConvertFormat, PageSetup, TocMode } from "./settings/settings-defaults.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_WATERMARK,
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "./settings/settings-defaults.js";
// 取消契约单源:signal/deadline → CancellationGuard,两条渲染管线共用同一守卫
import { createCancellationGuard } from "./cancel.js";
import type { ImageResourceBudget } from "./resource-limits.js";

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /**
   * 外部取消信号(AbortSignal):main 层 convert:cancel / 关窗放弃经此传播到
   * 渲染层各检查点与图片/图表回调。取消以 ConversionCanceledError
   * (code = ERR_CONVERSION_CANCELLED)退出,不与普通失败混用同一通道。
   */
  signal?: AbortSignal;
  /**
   * 绝对截止时间(epoch ms):到期即按取消处理;已过期者在 convert 入口即短路,
   * 不启动任何 resolver。与 signal 任一触发均取消。
   */
  deadline?: number;
  /** 图片资源预算覆盖(缺省取 core/resource-limits.ts 默认值) */
  imageBudget?: ImageResourceBudget;
  /** 图片解析回调(契约单源 core/image-resolver.ts):返回 null 表示跳过该图
   *  (缺失检查并入此失败路径,单次 IO);exists 轻量存在性通道可选 */
  imageResolver?: ImageResolver;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 显式文档元数据(封面用);优先于 frontmatter 解析出的 metadata(覆盖语义) */
  metadata?: DocMetadata;
  /** 警告收集器(可选):转换中发现的非致命问题(如缺失图片)追加至此;
   *  元素为 ConvertWarning(keyed 警告经显示层 formatWarning 按语言格式化) */
  warnings?: ConvertWarning[];
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY;docx 与 pdf 双格式共用) */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 自动生成目录页(默认开;docx 静态目录 / PDF 目录同开关) */
  toc?: boolean;
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码;docx 生效) */
  tocMode?: TocMode;
  /**
   * 标题章节自动编号显式项(透传 docx/pdf 双管线)。
   * 优先级契约:显式项 > typography.headingNumbering > 各 render 的构造默认;
   * 默认值的解析留在两侧 render(renderDocx / renderPdfHtml 内的
   * `options.X ?? typography.X`),本层只做原样透传,不做归一化——这样
   * 「谁解析默认」只有一处实现,两侧 render 的默认口径不会因本层新增字段而漂移。
   * 不传时行为与既有调用方(只给 typography)完全一致。
   */
  headingNumbering?: boolean;
  /**
   * 图/表题注自动编号显式项(透传 docx/pdf 双管线)。
   * 优先级契约同 headingNumbering:显式项 > typography.captionNumbering > render 构造默认。
   */
  captionNumbering?: boolean;
  /** 公式编号开关(默认开;docx/pdf 双格式同开关,关时公式不编号、label 段原样渲染、引用保持原文本) */
  equationNumbering?: boolean;
  /** KaTeX 资源目录(pdf 用,见 renderPdfHtml katexDir;docx 走 MathML 不需要) */
  katexDir?: string;
  /** 用户自定义样式 CSS(pdf 用,见 renderPdfHtml pdfCss;docx 路线不消费 CSS) */
  pdfCss?: string;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
  /** 页眉页脚配置(缺省 DEFAULT_HEADER_FOOTER:标题页眉 + 页码页脚) */
  headerFooter?: HeaderFooterSettings;
  /** 页眉 logo 已读数据(main 层读文件后注入,core 零 IO;仅 headerMode=custom 消费) */
  headerLogo?: HeaderLogoData;
  /** 文字水印(缺省 DEFAULT_WATERMARK = 不启用;text 空串即关闭) */
  watermark?: WatermarkSettings;
  /**
   * PDF 渲染子阶段进度回调:pdf 链路经此上报 parse / inline / mermaid / katex
   * 四个子阶段(main/converter.ts 在 printToPDF 前另上报 print 阶段)。
   * 缺省不上报(core 层零依赖,行为不变)。协议只增不改:旧消费方对未知
   * stage 键原样兜底(renderer 的 stageText 对未知键透传)。
   */
  onStage?: (stage: string) => void;
}

export interface DocxArtifact {
  kind: "docx";
  /** 可直接落盘的 .docx 文件内容 */
  buffer: Buffer;
}

export interface PdfArtifact {
  kind: "pdf";
  /** 完整 HTML 文档,落盘临时文件后 loadFile + printToPDF */
  html: string;
  /** printToPDF 的 headerTemplate(default/none = 空模板,custom = 文字 + logo) */
  headerTemplate: string;
  /** printToPDF 的 footerTemplate(页码;footerEnabled=false 时为空模板) */
  footerTemplate: string;
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码;PDF 两遍渲染时用于回填页码) */
  tocMode: TocMode;
  /**
   * 结构化标题(文档顺序,level 1-3;h4-h6 不入列)。
   * 与 html 同一次渲染管线产出,供 PDF 两遍法回填目录页码与书签树消费,
   * 避免下游对成品 HTML 做正则反解析(见 pdf/render.ts renderPdfDocument)。
   */
  headings: PdfHeading[];
  /** frontmatter 元数据(PDF Info 注入用) */
  metadata?: DocMetadata;
}

export type ConvertArtifact = DocxArtifact | PdfArtifact;

export async function convert(
  md: string,
  format: ConvertFormat,
  context: ConvertContext,
): Promise<ConvertArtifact> {
  // 取消守卫单一来源:signal/deadline 收敛为一个信号,两条管线共用;
  // 入口检查点在任何解析/渲染之前——预取消与已过期 deadline 不启动任何 resolver。
  const guard = createCancellationGuard({ signal: context.signal, deadline: context.deadline });
  try {
    guard.throwIfCanceled();
    // 注意:context.warnings 缺省时退化为局部空数组,收集到的警告在调用结束后被丢弃;
    // 需要拿到警告的调用方必须显式传入 context.warnings 数组。
    const warnings = context.warnings ?? [];
    // 先剥离 frontmatter:解析与渲染均只作用于正文(body)
    const { metadata: parsedMetadata, body } = parseFrontmatter(md);
    // 显式 metadata(context.metadata)优先于 frontmatter 解析出的 metadata:
    // 向导封面覆盖 frontmatter 即走此路径;未传则回落 frontmatter(回归不变)
    const metadata = context.metadata ?? parsedMetadata;
    // 页眉页脚配置归一化:以 DEFAULT_HEADER_FOOTER 为基准补缺失字段,docx 与 pdf 共用同一份取值
    const headerFooter: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER, ...context.headerFooter };
    // 水印配置归一化(缺省字段补默认;text 空串视为关闭,由渲染层判定零渲染)
    const watermark: WatermarkSettings = { ...DEFAULT_WATERMARK, ...context.watermark };
    // Mermaid 渲染回调与取消竞速(隐藏窗口服务不配合取消时也能退出);
    // 未注入 resolver 时保持 undefined(docx 侧按普通代码块渲染)
    const injectedMermaid = context.mermaidResolver;
    const mermaidResolver = injectedMermaid
      ? (code: string) => guard.race(injectedMermaid(code))
      : undefined;

    if (format === "pdf") {
      // pdf 分支只消费 body 字符串(markdown-it 在 renderPdfDocument 内另行解析),
      // 不做 remark 解析(原无条件 parseMarkdown 使每次 PDF 转换
      // 白做一次 AST 构建 + 全标题 slug 遍历)
      // 结构化 headings 与 html 出自同一次渲染管线:下游两遍法回填目录页码、
      // 书签树注入与 metadata 解析统一消费,不再对成品 HTML 做正则反解析
      // (OPT-5.2 第四条;renderPdfHtml 保留为仅取 html 的薄封装)。
      const { html, headings } = await renderPdfDocument(body, {
        baseDir: context.baseDir,
        title: context.title,
        metadata,
        warnings,
        imageResolver: context.imageResolver,
        guard,
        imageBudget: context.imageBudget,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        // 编号显式项原样透传:默认值解析在 renderPdfDocument 内(options.X ?? typography.X)
        headingNumbering: context.headingNumbering,
        captionNumbering: context.captionNumbering,
        equationNumbering: context.equationNumbering,
        katexDir: context.katexDir,
        pdfCss: context.pdfCss,
        mermaidResolver,
        onStage: context.onStage,
        watermark,
      });
      return {
        kind: "pdf",
        html,
        headings,
        // 页眉模板按配置构造(logo data URI 内嵌);页脚开关关闭时空模板占位
        // (displayHeaderFooter 常开,机制不变,见 PDF_EMPTY_CHROME_TEMPLATE 注释)
        headerTemplate: buildPdfHeaderTemplate(headerFooter, context.headerLogo),
        footerTemplate: headerFooter.footerEnabled ? PDF_FOOTER_TEMPLATE : PDF_EMPTY_CHROME_TEMPLATE,
        tocMode: context.tocMode ?? "static",
        metadata,
      };
    }
    // docx 分支才需要 remark AST(解析责任在 convert 层,与 pdf 层「传原文」不对称
    // 是双管线有意差异,见头注释)
    guard.throwIfCanceled(); // 同步解析(remark + 全文预扫)前复查:长文本不必解析完才退出
    const ast = parseMarkdown(body);
    return {
      kind: "docx",
      buffer: await renderDocx(ast, {
        imageResolver: context.imageResolver,
        guard,
        imageBudget: context.imageBudget,
        metadata,
        warnings,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        tocMode: context.tocMode,
        // 编号显式项原样透传:默认值解析在 renderDocx 内(options.X ?? typography.X)
        headingNumbering: context.headingNumbering,
        captionNumbering: context.captionNumbering,
        equationNumbering: context.equationNumbering,
        title: context.title,
        mermaidResolver,
        headerFooter,
        headerLogo: context.headerLogo,
        watermark,
      }),
    };
  } finally {
    // 释放 deadline 计时器(不 unref 也能退出,但显式释放避免长会话累积)
    guard.dispose();
  }
}
