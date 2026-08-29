/**
 * 转换上下文与共享构造器:
 * - ConvertContext/createConvertContext/ConvertCanceledError/throwIfCanceled:取消语义
 * - getImageResolver + resolverCache:批量场景按 baseDir 共享图片解析器(LRU 上限)
 * - buildConvertContext:settings → core convert() 上下文映射收敛
 * 依赖方向:single/batch/merge 反向 import 本模块,本模块不依赖三者(无环)。
 */
import fs from "node:fs/promises";
import type { ConvertContext as CoreConvertContext } from "../../core/convert.js";
import type { ConvertWarning } from "../../core/i18n.js";
import type { ImageResolver } from "../../core/image/image-resolver.js";
import { sniffImageType } from "../../core/image/image-type.js";
import { headerLogoLoadFailedWarning } from "../../core/image/image-warning.js";
import type { HeaderLogoData } from "../../core/docx/chrome.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import { DEFAULT_HEADER_FOOTER, DEFAULT_WATERMARK, type HeaderFooterSettings, type WatermarkSettings } from "../../core/settings/settings-defaults.js";
import type { MermaidResolver } from "../../core/markdown/mermaid.js";
import { createImageResolver } from "../services/image-downloader.js";
import type { AppSettings } from "../persist/settings.js";

/** 批量共享 imageResolver:按 baseDir 缓存,HTTP 去重缓存跨文件生效。
 *  容量上限(超限淘汰最早条目)——长会话跨多目录使用时不再单调增长。 */
const RESOLVER_CACHE_MAX = 16;
const resolverCache = new Map<string, ImageResolver>();

/**
 * 转换调用上下文:取消标志随调用携带,根治全局可变状态(历史 bug fd40480/f809c57
 * 即全局标志跨调用残留导致误判取消)。每次新转换调用新建 context(cancelRequested
 * 初始 false),「取消后复位」语义天然成立;IPC 层经 ctxByWebContents 注册表
 * (windows/web-contents-registry.ts)接 convert:cancel。
 * 原独立 ConvertOptions(仅 skipAfterConvert 一字段、批量调用处
 * undefined 占位)并入 ctx,签名 5 参 → 4 参,行为不变。
 */
export interface ConvertContext {
  /** 已请求取消(检查点只读;取消经 cancel() 置位) */
  cancelRequested: boolean;
  /** 请求取消(convert:cancel 经 ctxByWebContents 注册表定位 ctx 后调用) */
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
 * 页眉 logo 文件读取(main 层唯一 IO 点,core 零 IO):
 * 仅 headerMode=custom 且配置了路径时读取;魔数嗅探结果原样传递
 * (webp/null 的逐管线降级与告警在 core 侧 render.ts 统一处理);
 * 读取失败 → keyed 警告 + undefined(降级为无 logo,不中断转换)。
 */
export async function resolveHeaderLogo(
  headerFooter: HeaderFooterSettings,
  warnings?: ConvertWarning[],
): Promise<HeaderLogoData | undefined> {
  if (headerFooter.headerMode !== "custom" || !headerFooter.headerLogoPath) return undefined;
  try {
    const data = await fs.readFile(headerFooter.headerLogoPath);
    return { data, extension: sniffImageType(data) };
  } catch {
    warnings?.push(headerLogoLoadFailedWarning(headerFooter.headerLogoPath));
    return undefined;
  }
}

/**
 * settings → core convert() 上下文映射收敛:
 * convertImpl / mergeConvertImpl / openPreviewWindow 三处统一经此构造,防止
 * pageSetup/typography/breakBeforeH1/toc/imageResolver 逐字重复导致漂移。
 * 改为 async——页眉 logo 需读文件(main 层 IO),三处调用方均为 async 上下文,
 * await 透传即可。katexDir 由调用方(main 入口层)传入:getKatexDir()(现居
 * resource-dirs.ts)经 electron app.getAppPath() 计算(保证 dev/打包一致),
 * 本 helper 不依赖 electron app,convertImpl 可脱离 Electron 直测(docx 走 MathML
 * 本就不需要 katexDir)。
 */
export interface BuildConvertContextOptions {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** 文档标题(docx 元数据 / pdf <title>) */
  title: string;
  /** 显式文档元数据(封面用);优先于 frontmatter 解析出的 metadata */
  metadata?: DocMetadata;
  /** 警告收集器(与调用方共享同一数组;转换中发现的问题追加至此;元素为 ConvertWarning) */
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

export async function buildConvertContext(options: BuildConvertContextOptions): Promise<CoreConvertContext> {
  // 页眉页脚配置归一化(缺字段补默认 = 现状行为)+ logo 文件读取(失败降级)
  const headerFooter: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER, ...options.settings.headerFooter };
  const headerLogo = await resolveHeaderLogo(headerFooter, options.warnings);
  // 水印配置归一化(缺字段补默认 = 不启用)
  const watermark: WatermarkSettings = { ...DEFAULT_WATERMARK, ...options.settings.watermark };
  return {
    baseDir: options.baseDir,
    title: options.title,
    metadata: options.metadata,
    warnings: options.warnings,
    pageSetup: options.settings.pageSetup,
    typography: options.settings.typography,
    breakBeforeH1: options.settings.breakBeforeH1,
    toc: options.settings.toc,
    tocMode: options.settings.tocMode,
    equationNumbering: options.settings.equationNumbering,
    pdfCss: options.settings.pdfCss,
    imageResolver: options.imageResolver,
    katexDir: options.katexDir,
    mermaidResolver: options.mermaidResolver,
    onStage: options.onStage,
    headerFooter,
    headerLogo,
    watermark,
  };
}
