/**
 * 主进程转换编排层(从 index.ts 抽出的独立模块):
 * 读取 md → core 渲染 → 落盘 / printToPDF → 书签/元数据注入 → 导出后行为(runAfterConvert)。
 * 定位 = 主进程编排层(非纯逻辑,纯逻辑在 src/core/):依赖 electron(app/BrowserWindow/shell)
 * 是允许的;converter 可 import settings/image-downloader/core,反向(settings/image-downloader
 * import converter)禁止,index.ts import converter。
 * 取消语义:每次调用新建 ConvertContext(取消标志不复用,根治历史 bug fd40480/f809c57
 * 全局可变状态跨调用残留)。
 */
import { BrowserWindow, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  convert,
  type ConvertContext as CoreConvertContext,
  type ConvertFormat,
  type PdfArtifact,
} from "../core/convert.js";
import { decodeMarkdown } from "../core/encoding.js";
import { mergeMarkdowns } from "../core/merge.js";
import { buildBookmarkTree, injectBookmarks } from "../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../core/pdf/metadata.js";
import { extractHeadings } from "../core/pdf/postprocess.js";
import { createImageResolver, type ImageResolver } from "./image-downloader.js";
import { renderMermaid } from "./mermaid-service.js";
import type { MermaidResolver } from "../core/mermaid.js";
import { loadSettings, type AppSettings } from "./settings.js";
import { writeTempHtml } from "./temp-html.js";

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带 */
  warnings?: string[];
  /** 用户主动取消(非错误) */
  canceled?: boolean;
}

export interface BatchProgressInfo {
  index: number;
  total: number;
  file: string;
  stage: string;
}

export interface BatchItem {
  file: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
  warnings?: string[];
  /** 用户主动取消(未开始即跳过) */
  canceled?: boolean;
}

export interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
  /** 用户主动取消的未开始项数量 */
  canceledCount: number;
}

/** 批量共享 imageResolver:按 baseDir 缓存,HTTP 去重缓存跨文件生效(转换后不清理,键为路径,无泄漏风险) */
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

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析输出路径(批次 7「体验优化」):
 * - outputDir 空串 → 源文件同目录;非空 → outputDir(不存在则创建,失败回落源目录)
 * - 重名自动加序号「名 (2).ext」,绝不覆盖已有文件
 * - 超长路径(>250 字符)→ 回落源目录并警告(Windows MAX_PATH 限制,Electron 侧无解)
 * 返回 warnings 携带回落原因;调用方负责把 warnings 并入转换结果。
 */
export async function resolveOutputPath(
  filePath: string,
  format: ConvertFormat,
  outputDir: string,
  baseName?: string,
): Promise<{ outputPath: string; warnings: string[] }> {
  const warnings: string[] = [];
  const name = baseName ?? path.basename(filePath).replace(MARKDOWN_EXT_RE, "");
  const ext = format === "docx" ? ".docx" : ".pdf";
  const srcDir = path.dirname(filePath);
  let dir = outputDir && outputDir.trim() !== "" ? path.resolve(outputDir) : srcDir;
  if (dir !== srcDir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      warnings.push(`输出目录不可用(${dir}),已输出到源文件目录`);
      dir = srcDir;
    }
  }
  let candidate = path.join(dir, `${name}${ext}`);
  if (candidate.length > 250) {
    warnings.push("输出路径过长,已输出到源文件目录");
    dir = srcDir;
    candidate = path.join(dir, `${name}${ext}`);
  }
  let i = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(dir, `${name} (${i})${ext}`);
    i++;
  }
  return { outputPath: candidate, warnings };
}

export function getImageResolver(baseDir: string): ImageResolver {
  let resolver = resolverCache.get(baseDir);
  if (!resolver) {
    resolver = createImageResolver(baseDir);
    resolverCache.set(baseDir, resolver);
  }
  return resolver;
}

/**
 * settings → core convert() 上下文映射收敛(R10-1):
 * convertImpl / mergeConvertImpl / openPreviewWindow 三处统一经此构造,防止
 * pageSetup/typography/breakBeforeH1/toc/imageResolver 逐字重复导致漂移。
 * katexDir 由调用方(main 入口层)传入:getKatexDir() 经 electron app.getAppPath()
 * 计算(批次 6,保证 dev/打包一致),本 helper 不依赖 electron app,
 * convertImpl 可脱离 Electron 直测(docx 走 MathML 本就不需要 katexDir)。
 */
export interface BuildConvertContextOptions {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** 文档标题(docx 元数据 / pdf <title>) */
  title: string;
  /** 警告收集器(与调用方共享同一数组;转换中发现的问题追加至此) */
  warnings?: string[];
  /** 应用设置(pageSetup/typography/breakBeforeH1/toc 取用) */
  settings: AppSettings;
  /** 图片解析器(本地直接读 / http(s) 下载;批量场景传 getImageResolver 缓存实例) */
  imageResolver: ImageResolver;
  /** KaTeX 资源目录(pdf 用;docx 走 MathML 不需要;main 入口层经 getKatexDir() 计算) */
  katexDir?: string;
  /** Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约,见 src/core/mermaid.ts) */
  mermaidResolver?: MermaidResolver;
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
    imageResolver: options.imageResolver,
    katexDir: options.katexDir,
    mermaidResolver: options.mermaidResolver,
  };
}

/**
 * 转换实现:读取 md → core 注册表渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于 smoke 自测与未来 CLI 复用;进度经 onProgress 上报。
 * pdf 链路:core 产出 HTML → 写临时文件 → 隐藏窗口 loadFile → printToPDF。
 * 取消:ctx 默认新建(「取消后复位」语义);skipAfterConvert 经 ctx 携带(见 ConvertContext)。
 * katexDir(pdf 公式资源目录)由调用方(main 入口层)传入,本函数不依赖 electron app。
 */
export async function convertImpl(
  filePath: string,
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<{ outputPath: string; warnings: string[] }> {
  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new Error("仅支持 .md / .markdown 文件");
  }
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  onProgress?.("read");
  const warnings: string[] = [];
  const { text: md, encoding } = decodeMarkdown(await fs.readFile(filePath));
  if (encoding === "gbk") warnings.push("已按 GBK 编码读取:文件编码非 UTF-8");

  onProgress?.("render");
  const artifact = await convert(
    md,
    format,
    buildConvertContext({
      baseDir: path.dirname(filePath),
      title: path.basename(filePath).replace(/\.(md|markdown)$/i, ""),
      warnings,
      settings,
      // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重;按 baseDir 跨文件共享
      imageResolver: getImageResolver(path.dirname(filePath)),
      katexDir,
      // Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约,失败返回 null 由 core 降级)
      mermaidResolver: renderMermaid,
    }),
  );
  throwIfCanceled(ctx);

  const { outputPath, warnings: outWarnings } = await resolveOutputPath(
    filePath,
    format,
    settings.outputDir,
  );
  warnings.push(...outWarnings);

  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    if (!ctx.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘(与合并共用 renderPdf)
  await renderPdf(artifact, outputPath, ctx);
  onProgress?.("done");
  if (!ctx.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
  return { outputPath, warnings };
}

/**
 * pdf 产物落盘:临时 HTML → 隐藏窗口 printToPDF → 写输出文件。
 * 单文件/合并共用;临时文件与窗口在 finally 中清理,失败也会销毁窗口。
 */
async function renderPdf(artifact: PdfArtifact, outputPath: string, ctx: ConvertContext): Promise<void> {
  const { htmlPath, cleanup } = await writeTempHtml(artifact.html);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    throwIfCanceled(ctx); // 批次 7:打印前检查(loadFile/字体等待期间用户可能已取消)
    await printWin.loadFile(htmlPath);
    // 批次 6:等待公式字体(KaTeX woff2)加载完成再打印,否则 printToPDF 缺字形
    // (did-finish-load 后字体仍在加载,printToPDF 不等待字体)
    await printWin.webContents.executeJavaScript("document.fonts.ready");
    throwIfCanceled(ctx); // 批次 7:打印前复查(大文档字体等待可长达数秒)
    const data = await printWin.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: artifact.footerTemplate,
    });
    // 批次 7:printToPDF 不可中断(Electron 原子调用),取消需等本轮打印结束;
    // 但落盘/书签/元数据必须中止 → 打印后立即检查,取消则不产出文件、不报成功。
    throwIfCanceled(ctx);
    // 批次 4:从渲染后 HTML 提取标题(与目录同源,封面/目录本身非 h 标签不受影响),
    // 注入 PDF 书签大纲(读 /Dests 命名目标,标题 id 即命名目标名,无需文本定位)。
    // 无标题时原样落盘(输出为 Buffer → Uint8Array 无拷贝)。
    const headings = extractHeadings(artifact.html);
    const bookmarked =
      headings.length > 0
        ? await injectBookmarks(new Uint8Array(data), buildBookmarkTree(headings))
        : new Uint8Array(data);
    // 批次 5c:书签注入之后追加 PDF Info 元数据注入(frontmatter title/author/date → 文档属性)。
    // 顺序固定:书签 → 元数据(后者经 pdf-lib 整体重存,必须最后执行,否则会丢弃书签)。
    const output = await setPdfMetadata(bookmarked, artifact.metadata);
    await fs.writeFile(outputPath, output);
  } finally {
    printWin.destroy();
    await cleanup();
  }
}

/**
 * 导出后行为(按设置):资源管理器中显示 / 默认程序打开。
 * openPath 返回非空字符串即失败,仅日志记录,不抛给用户。
 */
async function runAfterConvert(action: AppSettings["afterConvert"], outputPath: string): Promise<void> {
  if (action === "show-in-folder") {
    shell.showItemInFolder(outputPath);
    return;
  }
  if (action === "open") {
    const error = await shell.openPath(outputPath);
    if (error) console.log(`[afterConvert] 打开失败: ${error}`);
  }
}

/**
 * 批量转换:并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
 * 批次 7:取消支持(未开始项跳过,记 canceledCount);完成后按 afterConvert
 * 打开第一个成功项(与单文件一致,不再强制跳过);进度经 onProgress 上报。
 */
export async function batchConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (info: BatchProgressInfo) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<BatchResult> {
  const total = files.length;
  const items: BatchItem[] = new Array<BatchItem>(total);
  let okCount = 0;
  let failCount = 0;
  let canceledCount = 0;
  let next = 0; // 下一个待取任务的索引(worker 共享,JS 单线程自增安全)

  async function worker(): Promise<void> {
    for (;;) {
      if (ctx.cancelRequested) {
        // 未开始项(含当前索引)标记取消,不再处理
        for (let i = next; i < total; i++) {
          if (!items[i]) {
            items[i] = { file: files[i], ok: false, canceled: true };
            canceledCount++;
          }
        }
        return;
      }
      const index = next++;
      if (index >= total) return;
      const file = files[index];
      const send = (stage: string): void =>
        onProgress?.({ index: index + 1, total, file: path.basename(file), stage });
      try {
        const { outputPath, warnings } = await convertImpl(file, format, send, ctx, katexDir);
        items[index] = { file, ok: true, outputPath, warnings };
        okCount++;
      } catch (err) {
        if (err instanceof ConvertCanceledError) {
          items[index] = { file, ok: false, canceled: true };
          canceledCount++;
          return;
        }
        items[index] = { file, ok: false, error: err instanceof Error ? err.message : String(err) };
        failCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, total) }, () => worker()));
  // 批量导出后行为:与单文件一致,作用于第一个成功项(避免打开 N 个文件)
  if (!ctx.cancelRequested) {
    const firstOk = items.find((i) => i.ok);
    if (firstOk?.outputPath) {
      const settings = await loadSettings();
      await runAfterConvert(settings.afterConvert, firstOk.outputPath);
    }
  }
  return { ok: true, items, okCount, failCount, canceledCount };
}

/**
 * 合并转换:读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 * 输出与 files[0] 同目录,`{basename}-合并.{ext}`;执行 runAfterConvert(单输出,与单文件一致)。
 * 任一步失败直接抛(调用方 catch 为 { ok:false, error })。
 * 批次 7 补:进度经 onProgress 上报(与单文件同构:read/render/done 阶段键),修复合并进度条不动。
 */
export async function mergeConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error("未选择文件");
  // 每次调用使用新建 context(取消标志初始 false),上次取消不再残留:
  // 否则二次合并立即被 throwIfCanceled 误判取消(历史 bug fd40480)。
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  const warnings: string[] = [];
  onProgress?.("read");
  const inputs = await Promise.all(
    files.map(async (file) => {
      const { text, encoding } = decodeMarkdown(await fs.readFile(file));
      if (encoding === "gbk") warnings.push(`已按 GBK 编码读取:${path.basename(file)}`);
      return { content: text, baseDir: path.dirname(file) };
    }),
  );
  const mergedMd = mergeMarkdowns(inputs);
  const baseName = path.basename(files[0]).replace(/\.(md|markdown)$/i, "");
  onProgress?.("render");
  const artifact = await convert(
    mergedMd,
    format,
    buildConvertContext({
      baseDir: path.dirname(files[0]),
      title: baseName,
      warnings,
      settings,
      imageResolver: getImageResolver(path.dirname(files[0])),
      katexDir,
      mermaidResolver: renderMermaid,
    }),
  );
  throwIfCanceled(ctx);
  const { outputPath, warnings: outWarnings } = await resolveOutputPath(
    files[0],
    format,
    settings.outputDir,
    `${baseName}-合并`,
  );
  warnings.push(...outWarnings);
  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
  } else {
    await renderPdf(artifact, outputPath, ctx);
    onProgress?.("done");
  }
  await runAfterConvert(settings.afterConvert, outputPath);
  return { ok: true, outputPath, warnings };
}

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/**
 * 收集 markdown 路径:目录递归收集其下所有 .md/.markdown 文件(跳过点开头的目录,如 .git),
 * 文件直接保留;非 md 的传入路径进 skipped(目录内非 md 文件静默忽略,目录不列入 skipped)。
 * 结果按字典序排序(大小写不敏感);seen 集合防符号链接循环。
 */
export async function collectMarkdownPaths(paths: string[]): Promise<{ files: string[]; skipped: string[] }> {
  const files: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  async function visit(p: string, passedDirectly: boolean): Promise<void> {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return; // 循环保护
    seen.add(resolved);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(resolved);
    } catch {
      if (passedDirectly) skipped.push(p); // 不存在/无法访问的传入路径
      return;
    }
    if (st.isDirectory()) {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue; // 跳过 .git 等点开头目录
        await visit(path.join(resolved, entry.name), false);
      }
      return;
    }
    if (MARKDOWN_EXT_RE.test(resolved)) {
      files.push(resolved);
    } else if (passedDirectly) {
      skipped.push(p);
    }
  }

  for (const p of paths) await visit(p, true);
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { files, skipped };
}

/**
 * 保序过滤仍存在的路径(批次 11 会话恢复用):逐个 fs.stat,存在即保留,缺失剔除,
 * 不改变传入顺序(会话列表顺序 = 用户排列的合并顺序,不可被打乱)。
 * 与 collectMarkdownPaths 不同:不排序、不展开目录、不做扩展名过滤。
 */
export async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      await fs.stat(p);
      out.push(p);
    } catch {
      /* 缺失/不可访问:剔除 */
    }
  }
  return out;
}
