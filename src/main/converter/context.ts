/**
 * 转换上下文与共享构造器(目录重组批⑤自 converter.ts 拆出):
 * - ConvertContext/createConvertContext/ConvertCanceledError/throwIfCanceled:取消语义
 * - getImageResolver + resolverCache:批量场景按 baseDir 共享图片解析器(LRU 上限)
 * - buildConvertContext:settings → core convert() 上下文映射收敛(R10-1)
 * 依赖方向:single/batch/merge 反向 import 本模块,本模块不依赖三者(无环)。
 */
import type { ConvertContext as CoreConvertContext } from "../../core/convert.js";
import type { ConvertWarning } from "../../core/i18n.js";
import type { ImageResolver } from "../../core/image/image-resolver.js";
import type { MermaidResolver } from "../../core/markdown/mermaid.js";
import { createImageResolver } from "../image-downloader.js";
import type { AppSettings } from "../settings.js";

/** 批量共享 imageResolver:按 baseDir 缓存,HTTP 去重缓存跨文件生效。
 *  B2:容量上限(超限淘汰最早条目)——长会话跨多目录使用时不再单调增长。 */
const RESOLVER_CACHE_MAX = 16;
const resolverCache = new Map<string, ImageResolver>();

/**
 * 转换调用上下文:取消标志随调用携带,根治全局可变状态(历史 bug fd40480/f809c57
 * 即全局标志跨调用残留导致误判取消)。每次新转换调用新建 context(cancelRequested
 * 初始 false),「取消后复位」语义天然成立;IPC 层经 currentCtx 接 convert:cancel。
 * fix-10 遗留归并:原独立 ConvertOptions(仅 skipAfterConvert 一字段、批量调用处
 * undefined 占位)并入 ctx,签名 5 参 → 4 参,行为不变。
 */
export interface ConvertContext {
  /** 已请求取消(检查点只读;取消经 cancel() 置位) */
  cancelRequested: boolean;
  /** 请求取消(convert:cancel 经 currentCtx 调用) */
  cancel(): void;
  /** 跳过 runAfterConvert(批量模式避免逐个打开 N 个文件;当前批量调用未置位) */
  skipAfterConvert?: boolean;
}

/** 新建转换上下文:取消标志初始 false,每次调用不复用旧标志 */
export function createConvertContext(): ConvertContext {
  let cancelRequested = false;
  return {
    get cancelRequested() {
      return cancelRequested;
    },
    cancel() {
      cancelRequested = true;
    },
  };
}

export class ConvertCanceledError extends Error {
  constructor() {
    super("已取消");
    this.name = "ConvertCanceledError";
  }
}

export function throwIfCanceled(ctx: ConvertContext): void {
  if (ctx.cancelRequested) throw new ConvertCanceledError();
}

export function getImageResolver(baseDir: string): ImageResolver {
  let resolver = resolverCache.get(baseDir);
  if (!resolver) {
    if (resolverCache.size >= RESOLVER_CACHE_MAX) {
      const oldest = resolverCache.keys().next().value;
      if (oldest !== undefined) resolverCache.delete(oldest);
    }
    resolver = createImageResolver(baseDir);
    resolverCache.set(baseDir, resolver);
  }
  return resolver;
}

/**
 * settings → core convert() 上下文映射收敛(R10-1):
 * convertImpl / mergeConvertImpl / openPreviewWindow 三处统一经此构造,防止
 * pageSetup/typography/breakBeforeH1/toc/imageResolver 逐字重复导致漂移。
 * katexDir 由调用方(main 入口层)传入:getKatexDir()(现居 resource-dirs.ts)
 * 经 electron app.getAppPath() 计算(批次 6,保证 dev/打包一致),本 helper 不依赖
 * electron app,convertImpl 可脱离 Electron 直测(docx 走 MathML 本就不需要 katexDir)。
 */
export interface BuildConvertContextOptions {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** 文档标题(docx 元数据 / pdf <title>) */
  title: string;
  /** 警告收集器(与调用方共享同一数组;转换中发现的问题追加至此;B6 起元素为 ConvertWarning) */
  warnings?: ConvertWarning[];
  /** 应用设置(pageSetup/typography/breakBeforeH1/toc 取用) */
  settings: AppSettings;
  /** 图片解析器(本地直接读 / http(s) 下载;批量场景传 getImageResolver 缓存实例) */
  imageResolver: ImageResolver;
  /** KaTeX 资源目录(pdf 用;docx 走 MathML 不需要;main 入口层经 getKatexDir() 计算) */
  katexDir?: string;
  /** Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约,见 src/core/markdown/mermaid.ts) */
  mermaidResolver?: MermaidResolver;
  /** PDF 渲染子阶段回调(B9:parse/inline/mermaid/katex,透传 core ConvertContext) */
  onStage?: (stage: string) => void;
}

export function buildConvertContext(options: BuildConvertContextOptions): CoreConvertContext {
  return {
    baseDir: options.baseDir,
    title: options.title,
    warnings: options.warnings,
    pageSetup: options.settings.pageSetup,
    typography: options.settings.typography,
    breakBeforeH1: options.settings.breakBeforeH1,
    toc: options.settings.toc,
    equationNumbering: options.settings.equationNumbering,
    pdfCss: options.settings.pdfCss,
    imageResolver: options.imageResolver,
    katexDir: options.katexDir,
    mermaidResolver: options.mermaidResolver,
    onStage: options.onStage,
  };
}
