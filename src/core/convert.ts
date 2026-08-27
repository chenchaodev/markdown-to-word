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
 * - 脚注:docx 写 footnotes.xml 部件;pdf 渲染为 HTML 脚注。→ footnotes.test.js
 */
import { parseMarkdown } from "./pipeline/parse.js";
import { parseFrontmatter } from "./pipeline/frontmatter.js";
import type { DocMetadata } from "./pipeline/frontmatter.js";
import type { TypographySettings } from "./settings/typography.js";
import type { ConvertWarning } from "./i18n.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfHtml } from "./pdf/render.js";
import {
  buildPdfHeaderTemplate,
  PDF_EMPTY_CHROME_TEMPLATE,
  PDF_FOOTER_TEMPLATE,
} from "./pdf/template.js";
import type { HeaderLogoData } from "./docx/chrome.js";
import type { MermaidResolver } from "./markdown/mermaid.js";
// 契约单源(B7):ImageResolver 类型收敛 core/image/image-resolver.ts(仅类型导入)
import type { ImageResolver } from "./image/image-resolver.js";
// 页面设置契约收敛于 settings-defaults.ts(单一来源),此处 re-export 保持既有导入面
// (docx/pdf render、main settings、测试等历史 import 源不变)
export {
  DEFAULT_PAGE_SETUP,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_WATERMARK,
  type PageSetup,
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "./settings/settings-defaults.js";
// ConvertFormat 单源 settings-defaults(CORE-8 收敛 B7 平行类型残留);
// re-export 保持 main 侧既有 import 路径(core/convert.js)不变
export type { ConvertFormat } from "./settings/settings-defaults.js";
import type { ConvertFormat, PageSetup, TocMode } from "./settings/settings-defaults.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_WATERMARK,
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "./settings/settings-defaults.js";

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** 图片解析回调(契约单源 core/image-resolver.ts):返回 null 表示跳过该图
   *  (缺失检查并入此失败路径,单次 IO);exists 轻量存在性通道可选 */
  imageResolver?: ImageResolver;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 警告收集器(可选):转换中发现的非致命问题(如缺失图片)追加至此;
   *  B6 起元素为 ConvertWarning(keyed 警告经显示层 formatWarning 按语言格式化) */
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
  /** 页眉页脚配置(F4;缺省 DEFAULT_HEADER_FOOTER = 现状行为) */
  headerFooter?: HeaderFooterSettings;
  /** 页眉 logo 已读数据(main 层读文件后注入,core 零 IO;仅 headerMode=custom 消费) */
  headerLogo?: HeaderLogoData;
  /** 文字水印(F5;缺省 DEFAULT_WATERMARK = 不启用;text 空串即关闭) */
  watermark?: WatermarkSettings;
  /** PDF 渲染子阶段回调(B9 进度分阶段上报):pdf 链路经此上报 parse/inline/
   *  mermaid/katex 四个子阶段(print 由 main/converter.ts 在 printToPDF 前上报);
   *  缺省不上报(core 层零依赖,行为不变)。向后兼容:旧消费方对未知 stage 键
   *  原样兜底(renderer stageText 未知键透传),协议只增不改。 */
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
  /** printToPDF 的 headerTemplate(F4:default/none = 空模板,custom = 文字+logo) */
  headerTemplate: string;
  /** printToPDF 的 footerTemplate(页码;footerEnabled=false 时为空模板) */
  footerTemplate: string;
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码;F7 两遍法页码用) */
  tocMode: TocMode;
  /** frontmatter 元数据(PDF Info 注入用) */
  metadata?: DocMetadata;
}

export type ConvertArtifact = DocxArtifact | PdfArtifact;

export async function convert(
  md: string,
  format: ConvertFormat,
  context: ConvertContext,
): Promise<ConvertArtifact> {
  // footgun(CORE-11):context.warnings 缺省时本函数内部以临时数组兜底,
  // 收集到的警告随调用结束静默丢弃——需要警告的调用方必须显式传入数组。
  const warnings = context.warnings ?? [];
  // 先剥离 frontmatter:解析与渲染均只作用于正文(body)
  const { metadata, body } = parseFrontmatter(md);
  // 页眉页脚配置归一化(F4):缺省字段补默认(= 现状行为),双管线共用同一取值
  const headerFooter: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER, ...context.headerFooter };
  // F5:水印配置归一化(缺省字段补默认;text 空串视为关闭,由渲染层判定零渲染)
  const watermark: WatermarkSettings = { ...DEFAULT_WATERMARK, ...context.watermark };

  if (format === "pdf") {
    // pdf 分支只消费 body 字符串(markdown-it 在 renderPdfHtml 内另行解析),
    // 不做 remark 解析(CORE-1:原无条件 parseMarkdown 使每次 PDF 转换
    // 白做一次 AST 构建 + 全标题 slug 遍历)
    return {
      kind: "pdf",
      html: await renderPdfHtml(body, {
        baseDir: context.baseDir,
        title: context.title,
        metadata,
        warnings,
        imageResolver: context.imageResolver,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        equationNumbering: context.equationNumbering,
        katexDir: context.katexDir,
        pdfCss: context.pdfCss,
        mermaidResolver: context.mermaidResolver,
        onStage: context.onStage,
        watermark,
      }),
      // F4:页眉模板按配置构造(logo data URI 内嵌);页脚开关关闭时空模板占位
      // (displayHeaderFooter 常开,机制不变,见 PDF_EMPTY_CHROME_TEMPLATE 注释)
      headerTemplate: buildPdfHeaderTemplate(headerFooter, context.headerLogo),
      footerTemplate: headerFooter.footerEnabled ? PDF_FOOTER_TEMPLATE : PDF_EMPTY_CHROME_TEMPLATE,
      tocMode: context.tocMode ?? "static",
      metadata,
    };
  }
  // docx 分支才需要 remark AST(解析责任在 convert 层,与 pdf 层「传原文」不对称
  // 是双管线有意差异,见头注释)
  const ast = parseMarkdown(body);
  return {
    kind: "docx",
    buffer: await renderDocx(ast, {
      imageResolver: context.imageResolver,
      metadata,
      warnings,
      pageSetup: context.pageSetup,
      typography: context.typography,
      breakBeforeH1: context.breakBeforeH1,
      toc: context.toc,
      tocMode: context.tocMode,
      equationNumbering: context.equationNumbering,
      title: context.title,
      mermaidResolver: context.mermaidResolver,
      headerFooter,
      headerLogo: context.headerLogo,
      watermark,
    }),
  };
}
