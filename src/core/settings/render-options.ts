/**
 * 双管线渲染选项的共有契约与默认解析单源(docx ↔ pdf)。
 *
 * 存在的理由有两条,缺一不可(adr-030 决定要点三):
 * - **6-D2(类型单源)**:两侧 RenderOptions 原本各声明一遍 15 个同名同义的字段。
 *   交叉继承后 JSDoc 与语义注释只有一份,改一侧语义不必记得改另一侧的注释。
 * - **6-D1(默认单源)**:光有类型单源**不解决漏传** —— 类型系统对可选字段没有
 *   默认值检查,漏传既不报错也不留痕,只静默用默认值。这与 6-B/6-C 关掉的
 *   「设置项在一侧静默失效」是同一类病(下同)。故默认解析必须收进**一个纯函数**,
 *   两侧渲染入口都经它,且其返回值类型**全字段必填**。
 *
 * 形状取自 docx 侧既有的「构造时统一解析、故 Ctx.config 全字段必填」惯例
 * (docx/render.ts 的 ctx 组装点),把它推广到 pdf 侧 —— pdf 侧原先把
 * `options.X ?? 默认` 散在 renderPdfDocument 的三处、另有两处在 convert 层,
 * 逐处默认值字面量是 6-B2/6-B3 两处失效得以藏身的直接原因。
 *
 * 依赖方向:本模块只 import 类型(编译期擦除)+ 纯常量模块,运行期零外部依赖,
 * 故 renderer 浏览器环境经 settings-defaults 导入本模块不会拉进 node 依赖
 * (同 settings-defaults 的既有约束)。
 */
import type { DocMetadata } from "../pipeline/frontmatter.js";
import type { MermaidResolver } from "../markdown/mermaid.js";
import type { ImageResolver } from "../image/image-resolver.js";
import type { CancellationGuard } from "../cancel.js";
import type { ImageResourceBudget } from "../resource-limits.js";
// 仅类型导入(编译期擦除):ConvertWarning 契约单源在 core/i18n/warning.ts,与 settings-defaults
// 导入 Language 同款(type-only,不成运行期依赖)
import type { ConvertWarning } from "../i18n/index.js";
import { DEFAULT_TYPOGRAPHY, type TypographySettings } from "./typography.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_SETUP,
  DEFAULT_WATERMARK,
  type HeaderFooterSettings,
  type PageSetup,
  type TocMode,
  type WatermarkSettings,
} from "./settings-defaults.js";

/** 目录模式默认值单源(docx 渲染层与 convert 层原先各写一份 `"static"` 字面量) */
export const DEFAULT_TOC_MODE: TocMode = "static";

/**
 * 双管线渲染选项的**共有字段**(docx 与 pdf 语义一致的部分)。
 *
 * 两侧各自的独有条目不写在这里:docx 侧有 tocMode/headerFooter/headerLogo,
 * pdf 侧有 baseDir/pdfCss/katexDir/fs/onStage。**刻意不强迫 docx 声明 pdf-only
 * 字段** —— 那会让 docx 的类型承诺它根本不消费的东西(类型谎言)。
 */
export interface SharedRenderOptions {
  /** 前置元数据(封面用);优先于 frontmatter 解析出的 metadata(覆盖语义) */
  metadata?: DocMetadata;
  /** 文档标题(docx 页眉 / pdf 页眉与 <title> 用;优先级低于 metadata.title) */
  title?: string;
  /** 警告收集(元素为 ConvertWarning,keyed 警告经 formatWarning 按语言格式化) */
  warnings?: ConvertWarning[];
  /** 外链图片解析回调(契约单源 core/image/image-resolver.ts) */
  imageResolver?: ImageResolver;
  /** 取消守卫(convert 层构造:signal/deadline 单源);缺省由各渲染入口新建 */
  guard?: CancellationGuard;
  /** 图片资源预算覆盖(缺省取 core/resource-limits.ts 默认值) */
  imageBudget?: ImageResourceBudget;
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY) */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节自动编号(显式传值优先,否则取 typography.headingNumbering;默认开) */
  headingNumbering?: boolean;
  /** 图/表题注自动编号(显式传值优先,否则取 typography.captionNumbering;默认开) */
  captionNumbering?: boolean;
  /** 自动生成目录页(默认开) */
  toc?: boolean;
  /** 公式编号开关(默认开) */
  equationNumbering?: boolean;
  /** Mermaid 图表渲染回调(缺失时 mermaid 围栏按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
  /** 文字水印(缺省 DEFAULT_WATERMARK;text 空串即关闭) */
  watermark?: WatermarkSettings;
}

/**
 * 解析后的渲染开关:**全字段必填**,下游一律不再判空。
 *
 * 这一层是 6-D1 的实际约束力所在 —— 返回可选字段就等于把「漏传」放回去。
 */
export interface ResolvedRenderSwitches {
  /** 页面设置(已解析默认) */
  pageSetup: PageSetup;
  /** 排版设置(已解析默认) */
  typography: TypographySettings;
  /** 一级标题前分页(已解析默认:关) */
  breakBeforeH1: boolean;
  /** 标题章节自动编号(已解析默认:取 typography.headingNumbering) */
  headingNumbering: boolean;
  /** 图/表题注自动编号(已解析默认:取 typography.captionNumbering) */
  captionNumbering: boolean;
  /** 自动生成目录页(已解析默认:开) */
  toc: boolean;
  /** 公式编号开关(已解析默认:开) */
  equationNumbering: boolean;
  /** 文字水印(已解析默认:text 空串即关闭) */
  watermark: WatermarkSettings;
}

/**
 * 解析共有渲染选项的默认值(纯函数,两侧渲染入口唯一调用点)。
 *
 * 取值逐条与迁移前各调用点的字面量一致,故行为等价;差别只在于**从 N 处收到 1 处**。
 *
 * @param options 调用方给的共有选项(可全缺省)
 * @returns 全字段必填的开关组
 */
export function resolveRenderSwitches(options: SharedRenderOptions): ResolvedRenderSwitches {
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  return {
    pageSetup: options.pageSetup ?? DEFAULT_PAGE_SETUP,
    typography,
    breakBeforeH1: options.breakBeforeH1 ?? false,
    headingNumbering: options.headingNumbering ?? typography.headingNumbering,
    captionNumbering: options.captionNumbering ?? typography.captionNumbering,
    toc: options.toc ?? true,
    equationNumbering: options.equationNumbering ?? true,
    watermark: { ...DEFAULT_WATERMARK, ...options.watermark },
  };
}

/**
 * 解析页眉页脚设置(缺省字段补 DEFAULT_HEADER_FOOTER)。
 *
 * 页眉页脚是**跨格式**的文档外壳设置(pdf 侧在 convert 层据此造 header/footer
 * 模板),故归本模块而非任一渲染层;先前 convert 层与 docx 渲染层各有一份
 * `{ ...DEFAULT_HEADER_FOOTER, ...x }`,两处默认值漂移无从发现。
 */
export function resolveHeaderFooter(
  headerFooter: HeaderFooterSettings | undefined,
): HeaderFooterSettings {
  return { ...DEFAULT_HEADER_FOOTER, ...headerFooter };
}

/**
 * 解析目录模式(缺省 DEFAULT_TOC_MODE)。
 *
 * convert 层要把结果放进 PdfArtifact 透传给下游两遍法,docx 渲染层要放进 Ctx.config;
 * 两处原先各写一份 `"static"`。
 */
export function resolveTocMode(tocMode: TocMode | undefined): TocMode {
  return tocMode ?? DEFAULT_TOC_MODE;
}
