/**
 * 转换入口:md → 目标格式产物(无 IO、无 Electron,便于测试与复用)。
 * **当前实现是二分分支,不是格式注册表** —— `format === "pdf"` 走 HTML 路线,其余落到 docx 路线。
 * 全库共 6 处 format 分支跨 3 层(本文件、main/converter 的 single/merge/paths),
 * 故新增格式须逐处改判定,而不是「往注册表加一条目」。裁决见 campaign REF-025 计划项 #01 与 D-02。
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
 * - 编号开关(headingNumbering / captionNumbering):**不在生产 ConvertContext 里**,
 *   它们连同 imageBudget 收在第 4 参 ConvertTestOverrides(生产零写入者,见该类型注释)。
 *   本层只透传显式项,两侧 render 按 `options.X ?? typography.X` 解析(见两字段 JSDoc);
 *   实际生效的只有 typography.X 与 render 构造默认两档。
 * - 脚注:docx 写 footnotes.xml 部件;pdf 渲染为 HTML 脚注。→ footnotes.test.js
 */
import { parseMarkdown } from "./pipeline/parse.js";
import type { DocMetadata } from "./pipeline/frontmatter.js";
import type { TypographySettings } from "./settings/typography.js";
import type { ConvertWarning } from "./i18n.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfDocument, type PdfFsCapabilities } from "./pdf/render.js";
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
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "./settings/settings-defaults.js";
// 渲染选项默认值解析单源(adr-030 6-D1):convert 层与两侧渲染层共用同一份
import { resolveHeaderFooter, resolveRenderSwitches, resolveTocMode } from "./settings/render-options.js";
// 取消契约单源:signal/deadline → CancellationGuard,两条渲染管线共用同一守卫
import { createCancellationGuard } from "./cancel.js";
import type { ImageResourceBudget } from "./resource-limits.js";

/**
 * 已完成「frontmatter 隔离 + 渲染前变换」的 markdown —— 阶段产物的类型名,单一声明点。
 *
 * 阶段顺序:**先变换后渲染**。本文件的入参必须是已跑过
 * `core/markdown/preprocess-body.ts`(渲染前变换的分派点)的正文,本文件只做
 * 「解析 → 渲染」,不再改写内容 —— 变换类设置对渲染层不可见,它们在阶段分派处
 * 就已消费完毕。
 *
 * **为什么是 `{ body, metadata }` 而不是裸字符串**:frontmatter 的隔离与解析在
 * 上游准备阶段(`convert/preprocess.ts` 的 `prepareMarkdown`)已经做过一次,
 * 那次结果连同正文一起作为阶段产物传下来。底座若仍是裸字符串,本层就不得不
 * **为了拿 metadata 再解析一遍**——同一次转换 frontmatter 被解析两次,且没有任何
 * 一处能断言「只解析一次」(裸字符串里看不出它带没带 frontmatter)。结构化入参把
 * 「body 已剥离、metadata 已解析」写进类型,重复解析在编译期就不可能发生。
 *
 * 底座刻意是**普通 interface 而非品牌类型**:生产侧入口恒真(都先准备再调本函数),
 * 而多个测试段直接构造本对象调本函数。品牌化会让那些测试里的断言变成谎言
 * (见 adr-026 对三个「品牌化」形状的否决)。
 */
export interface PreprocessedMarkdown {
  /** 去除 frontmatter 后的正文(两条渲染管线都只消费它) */
  body: string;
  /**
   * 上游已解析出的 frontmatter 元数据(缺省=源文档无 frontmatter)。
   * `ConvertContext.metadata` 是**显式覆盖项**(向导封面),优先于本字段。
   */
  metadata?: DocMetadata;
}

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
   * 生产零注入 / 仅测试注入:生产侧无参构造(`logic.ts` 的 `deps.createContext()`),
   * 故该字段在真实转换里恒为 undefined、截止时间机制目前只有测试在用。
   */
  deadline?: number;
  /** 图片解析回调(契约单源 core/image-resolver.ts):返回 null 表示跳过该图
   *  (缺失检查并入此失败路径,单次 IO);exists 轻量存在性通道可选 */
  imageResolver?: ImageResolver;
  /** 宿主文件系统能力(REF-025 #07 注入点):pdf 渲染路径不做文件 IO,其两次读
   *  (图片边界 realpathSync、KaTeX CSS 读取)由 main 层经此提供。
   *  此处**可选**是因为 ConvertContext 由 docx 与 pdf 共用,docx 路线不消费它;
   *  但 pdf 分支会强校验(缺则抛错),故不存在「忘注入 → 边界静默不判定」的降级
   *  —— 那等于把 adr-012 的符号链接逃逸防线变成可静默关闭的开关。 */
  fs?: PdfFsCapabilities;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 显式文档元数据(封面用);优先于阶段产物已解析出的 frontmatter metadata(覆盖语义) */
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

/**
 * 仅测试注入的上下文覆盖项(生产零写入者)。
 *
 * 为什么它们不在 `ConvertContext` 里(adr-028 决定要点五):生产侧无任何写入者
 * —— 编号在用的是 `typography.headingNumbering` / `captionNumbering`,图片预算在用的是
 * `core/resource-limits.ts` 的默认值。生产类型宣告支持某字段而生产侧无人写它,就是
 * 「类型谎言」:读代码的人会以为调它能生效。独立成第 4 参后,「生产不传」由签名本身
 * 表达,测试要注入必须显式走这一参。
 *
 * 默认值的解析仍在两侧 render(`options.X ?? typography.X` / `resolveImageBudget`),
 * 本层只做原样透传,不做归一化 —— 这样「谁解析默认」只有一处实现,两侧 render 的
 * 默认口径不会因本层新增字段而漂移。不传时行为与只给 typography 的既有调用方完全一致。
 */
export interface ConvertTestOverrides {
  /** 标题章节自动编号显式项(压过 typography.headingNumbering,透传 docx/pdf 双管线) */
  headingNumbering?: boolean;
  /** 图/表题注自动编号显式项(压过 typography.captionNumbering,透传 docx/pdf 双管线) */
  captionNumbering?: boolean;
  /** 图片资源预算覆盖(缺省取 core/resource-limits.ts 默认值) */
  imageBudget?: ImageResourceBudget;
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
  /** printToPDF 的 headerTemplate(default=文档标题居中 / custom=文字 + logo / none=空模板) */
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
  md: PreprocessedMarkdown,
  format: ConvertFormat,
  context: ConvertContext,
  testOverrides?: ConvertTestOverrides,
): Promise<ConvertArtifact> {
  // 取消守卫单一来源:signal/deadline 收敛为一个信号,两条管线共用;
  // 入口检查点在任何解析/渲染之前——预取消与已过期 deadline 不启动任何 resolver。
  const guard = createCancellationGuard({ signal: context.signal, deadline: context.deadline });
  try {
    guard.throwIfCanceled();
    // 注意:context.warnings 缺省时退化为局部空数组,收集到的警告在调用结束后被丢弃;
    // 需要拿到警告的调用方必须显式传入 context.warnings 数组。
    const warnings = context.warnings ?? [];
    // frontmatter 已在上游准备阶段隔离并解析(见 PreprocessedMarkdown):本层只取用,
    // **不再解析第二次** —— 裸字符串入参时代这里有一次重复的解析调用。
    const body = md.body;
    // 显式 metadata(context.metadata)优先于阶段产物携带的 frontmatter metadata:
    // 向导封面覆盖 frontmatter 即走此路径;未传则回落 frontmatter(回归不变)
    const metadata = context.metadata ?? md.metadata;
    // 页眉页脚/水印/目录模式的默认字段补全统一走 settings/render-options(6-D1):
    // 本层与两侧渲染层此前各有一份 `{ ...DEFAULT_X, ...x }`,默认值漂移无从发现
    const headerFooter: HeaderFooterSettings = resolveHeaderFooter(context.headerFooter);
    const watermark: WatermarkSettings = resolveRenderSwitches(context).watermark;
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
      // (PDF 目录/页码改走结构化数据,不再对成品 HTML 做正则反解析;
      // renderPdfHtml 保留为仅取 html 的薄封装)。
      // pdf 分支强校验宿主能力(REF-025 #07):core 的 pdf 渲染路径不 import node:fs,
      // 两次读必须由 main 注入。缺能力时**抛错**而非降级 —— 若静默跳过 realpath,
      // 图片的符号链接逃逸防线(adr-012)就变成可静默关闭的开关。
      if (!context.fs) {
        throw new Error(
          "convert(pdf):调用方未注入 ConvertContext.fs(宿主文件系统能力)"
          + "—— core 的 pdf 渲染路径不做文件 IO,图片边界校验与 KaTeX CSS 读取都依赖它",
        );
      }
      const { html, headings } = await renderPdfDocument(body, {
        baseDir: context.baseDir,
        fs: context.fs,
        title: context.title,
        metadata,
        warnings,
        imageResolver: context.imageResolver,
        guard,
        imageBudget: testOverrides?.imageBudget,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        // 编号显式项原样透传:默认值解析在 renderPdfDocument 内(options.X ?? typography.X)
        headingNumbering: testOverrides?.headingNumbering,
        captionNumbering: testOverrides?.captionNumbering,
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
        // 页眉标题与 renderPdfDocument 的 <title> 同源(frontmatter metadata.title
        // 优先、其次文件名),default 模式据此出「文档标题居中页眉」——与 docx 侧
        // headers.ts 的 default 分支同口径(adr-030 6-B3)
        headerTemplate: buildPdfHeaderTemplate(headerFooter, metadata?.title ?? context.title, context.headerLogo),
        footerTemplate: headerFooter.footerEnabled ? PDF_FOOTER_TEMPLATE : PDF_EMPTY_CHROME_TEMPLATE,
        tocMode: resolveTocMode(context.tocMode),
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
        imageBudget: testOverrides?.imageBudget,
        metadata,
        warnings,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        tocMode: context.tocMode,
        // 编号显式项原样透传:默认值解析在 renderDocx 内(options.X ?? typography.X)
        headingNumbering: testOverrides?.headingNumbering,
        captionNumbering: testOverrides?.captionNumbering,
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
