/**
 * 转换上下文装配与共享构造器:
 * - createConvertContext(返回 CancellationHandle):signal/deadline 随上下文透传 core
 * - getImageResolver + resolverCache:批量场景按 baseDir 共享图片解析器(LRU 上限)
 * - buildConvertContext:settings → core convert() 上下文映射收敛
 * 取消语义的类型 / 错误 / 闸门(ConversionHandle/ConvertCanceledError/throwIfCanceled)
 * 住在 ./cancellation.ts(ADR-064 处置表第 2 条),本文件只引用、不重复定义。
 * 依赖方向:single/batch/merge 反向 import 本模块,本模块不依赖三者(无环)。
 */
import { readFileSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConvertContext as CoreConvertContext } from "../core/convert.js";
import type { ConvertWarning } from "../core/i18n/index.js";
// 阶段键联合单源 core/ipc-contract.ts(与跨进程 payload 契约同源,避免契约与发射面各留一份)
import type { ConvertStage } from "../core/ipc-contract.js";
import type { ImageResolver } from "../core/image/image-resolver.js";
import { sniffImageType } from "../core/image/image-type.js";
import { headerLogoLoadFailedWarning } from "../core/image/image-warning.js";
import type { HeaderLogoData } from "../core/docx/chrome.js";
import type { DocMetadata } from "../core/pipeline/frontmatter.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_WATERMARK,
  type AppSettings,
  type HeaderFooterSettings,
  type WatermarkSettings,
} from "../core/settings/settings-defaults.js";
import type { MermaidResolver } from "../core/markdown/mermaid.js";
import { ConvertCanceledError, type ConversionHandle } from "./cancellation.js";
import { createImageResolver } from "./image-downloader.js";

/** 批量共享 imageResolver:按解析 baseDir + trusted roots 组合键缓存,HTTP 去重缓存跨文件生效。
 *  容量上限(超限淘汰最早条目)——长会话跨多目录使用时不再单调增长。 */
const RESOLVER_CACHE_MAX = 16;
const resolverCache = new Map<string, ImageResolver>();

/**
 * 新建转换上下文:取消标志初始 false,每次调用不复用旧标志。
 * deadline 为可选的绝对时间上限,随上下文透传给 core(见 ConversionHandle.deadline)。
 */
export function createConvertContext(options: { deadline?: number } = {}): ConversionHandle {
  let cancelRequested = false;
  const controller = new AbortController();
  return {
    get cancelRequested() {
      return cancelRequested;
    },
    cancel() {
      // 幂等:重复取消不再改写 signal.reason(已取消时保持首次原因)
      if (cancelRequested) return;
      cancelRequested = true;
      controller.abort(new ConvertCanceledError());
    },
    signal: controller.signal,
    deadline: options.deadline,
  };
}

export interface ImageResolverOptions {
  /** 额外的输入源目录;解析 baseDir 与允许读取的 trusted roots 分离。 */
  trustedRoots?: readonly string[];
}

function imageResolverCacheKey(baseDir: string, trustedRoots: readonly string[]): string {
  return JSON.stringify([path.resolve(baseDir), [...trustedRoots].map((root) => path.resolve(root)).sort()]);
}

export function getImageResolver(baseDir: string, options: ImageResolverOptions = {}): ImageResolver {
  const trustedRoots = [...new Set((options.trustedRoots ?? []).map((root) => path.resolve(root)))];
  const cacheKey = imageResolverCacheKey(baseDir, trustedRoots);
  let resolver = resolverCache.get(cacheKey);
  if (!resolver) {
    if (resolverCache.size >= RESOLVER_CACHE_MAX) {
      const oldest = resolverCache.keys().next().value;
      if (oldest !== undefined) resolverCache.delete(oldest);
    }
    resolver = createImageResolver(baseDir, undefined, { trustedRoots });
    resolverCache.set(cacheKey, resolver);
  }
  return resolver;
}

/**
 * 页眉 logo 文件读取(装配层唯一 IO 点,core 零 IO):
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
 * 改为 async——页眉 logo 需读文件(装配层 IO),三处调用方均为 async 上下文,
 * await 透传即可。katexDir 由调用方(main 入口层)传入:getKatexDir()(现居
 * resource-dirs.ts)经 electron app.getAppPath() 计算(保证 dev/打包一致),
 * 本 helper 不依赖 electron app,convertImpl 可脱离 Electron 直测(docx 走 MathML
 * 本就不需要 katexDir)。
 *
 * 设置字段的映射按**类别成组**(页面几何 / 排版 / 文档结构开关 / pdf 专用 / 文档外壳),
 * 每组在返回字面量里连续成段;「生产有的」与「仅测试注入的」在
 * `TEST_ONLY_CONTEXT_KEYS` 注释与字面量末段已分开点名,后者刻意不接进来。
 *
 * 为什么不用「遍历一张表 + 展开」:下游(main 各入口与测试)打的是 dist 产物,dist 无
 * 类型标注,展开一个推导不出成员的值会让这些调用点**丢掉全部字段类型**(按字段取值即
 * 报 TS2339)。故分组以字面量分段表达,「加了不该加的字段」由测试真跑一次
 * `buildConvertContext` 并断言产物键集来守(见 test/convert/context-mapping.test.js)。
 */
export interface BuildConvertContextOptions {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /**
   * 本次转换的取消上下文(装配层 ConversionHandle):其 signal/deadline 透传给
   * core,使「用户取消 / 关窗放弃 / 时间上限」能到达渲染层检查点与异步回调。
   * 缺省(预览等无取消通道的调用方)则 core 侧无外部取消,行为不变。
   */
  convert?: ConversionHandle;
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
  /** PDF 渲染子阶段回调(parse/inline/mermaid/katex,透传 core ConvertContext) */
  onStage?: (stage: ConvertStage) => void;
}

/**
 * 生产侧「设置 → 上下文」映射按类别成组(见 buildConvertContext 的字面量分组)。
 * 刻意**不在此**的三项:headingNumbering / captionNumbering / imageBudget ——
 * 它们生产零写入者,接进生产映射就造出「设了也不生效」的假开关。
 */
export const TEST_ONLY_CONTEXT_KEYS: readonly string[] = [
  "headingNumbering",
  "captionNumbering",
  "imageBudget",
];

export async function buildConvertContext(options: BuildConvertContextOptions): Promise<CoreConvertContext> {
  // 页眉页脚配置归一化(缺字段补默认 = 现状行为)+ logo 文件读取(失败降级)
  const headerFooter: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER, ...options.settings.headerFooter };
  const headerLogo = await resolveHeaderLogo(headerFooter, options.warnings);
  // 水印配置归一化(缺字段补默认 = 不启用)
  const watermark: WatermarkSettings = { ...DEFAULT_WATERMARK, ...options.settings.watermark };
  return {
    // —— 宿主与运行时能力(与 settings 无关)——
    baseDir: options.baseDir,
    // 宿主文件系统能力(REF-025 #07):core 的 pdf 渲染路径自己不 import node:fs,
    // 其两次读(图片边界 realpathSync、KaTeX CSS 读取)由此注入。能力面刻意收窄到
    // 这两个函数而非整个 fs 模块 —— 新增用途必须显式改 PdfFsCapabilities。
    fs: { realpathSync, readTextFile: (file) => readFileSync(file, "utf8") },
    // 取消与时间上限透传(core 渲染层据此在阶段边界与异步回调处退出)
    signal: options.convert?.signal,
    deadline: options.convert?.deadline,
    title: options.title,
    metadata: options.metadata,
    warnings: options.warnings,
    imageResolver: options.imageResolver,
    katexDir: options.katexDir,
    mermaidResolver: options.mermaidResolver,
    onStage: options.onStage,

    // —— 设置映射,按类别成组(键名与 core 同名 → 直通)——
    // 类别一 · 页面几何
    pageSetup: options.settings.pageSetup,
    // 类别二 · 排版
    typography: options.settings.typography,
    // 类别三 · 文档结构开关(分页 / 目录 / 编号:双管线同名同义,故成组)
    breakBeforeH1: options.settings.breakBeforeH1,
    toc: options.settings.toc,
    tocMode: options.settings.tocMode,
    equationNumbering: options.settings.equationNumbering,
    // 类别四 · pdf 专用
    pdfCss: options.settings.pdfCss,
    // 类别五 · 文档外壳(需先归一化;logo 由 main 读文件后注入,core 零 IO)
    headerFooter,
    headerLogo,
    watermark,

    // ⚠️ 刻意**不在此**的三项:headingNumbering / captionNumbering / imageBudget。
    // 它们生产零写入者(在用的是 typography 的同名字段与 resource-limits 默认预算),
    // 接进生产映射就造出「设了也不生效」的假开关 —— 正是步 01 刚清掉的静默失效。
    // 它们由 core convert() 的第 4 参 ConvertTestOverrides 承接(见 core/convert.ts)。
  };
}
