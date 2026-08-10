import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { convert, type ConvertFormat, type PdfArtifact } from "../core/convert.js";
import { mergeMarkdowns } from "../core/merge.js";
import { buildBookmarkTree, injectBookmarks } from "../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../core/pdf/metadata.js";
import { extractHeadings } from "../core/pdf/render.js";
import { createImageResolver, type ImageResolver } from "./image-downloader.js";
import { loadSettings, updateSettings, type AppSettings } from "./settings.js";
import { decodeMarkdown } from "../core/encoding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带 */
  warnings?: string[];
  /** 用户主动取消(非错误) */
  canceled?: boolean;
}

export interface ConvertOptions {
  /** 批量模式跳过 runAfterConvert(避免批量后自动打开 N 个文件) */
  skipAfterConvert?: boolean;
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

/** 取消标志:renderer 经 convert:cancel IPC 置位;转换循环在检查点读取(批次 7) */
let cancelRequested = false;

class ConvertCanceledError extends Error {
  constructor() {
    super("已取消");
    this.name = "ConvertCanceledError";
  }
}

function throwIfCanceled(): void {
  if (cancelRequested) throw new ConvertCanceledError();
}

async function pathExists(p: string): Promise<boolean> {
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
async function resolveOutputPath(
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

function getImageResolver(baseDir: string): ImageResolver {
  let resolver = resolverCache.get(baseDir);
  if (!resolver) {
    resolver = createImageResolver(baseDir);
    resolverCache.set(baseDir, resolver);
  }
  return resolver;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    title: "Markdown 转换工具",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

/**
 * 转换实现:读取 md → core 注册表渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于 smoke 自测与未来 CLI 复用;进度经 onProgress 上报。
 * pdf 链路:core 产出 HTML → 写临时文件 → 隐藏窗口 loadFile → printToPDF。
 */
export async function convertImpl(
  filePath: string,
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  options?: ConvertOptions,
): Promise<{ outputPath: string; warnings: string[] }> {
  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new Error("仅支持 .md / .markdown 文件");
  }
  throwIfCanceled();
  const settings = await loadSettings();
  onProgress?.("read");
  const warnings: string[] = [];
  const { text: md, encoding } = decodeMarkdown(await fs.readFile(filePath));
  if (encoding === "gbk") warnings.push("已按 GBK 编码读取:文件编码非 UTF-8");

  onProgress?.("render");
  const artifact = await convert(md, format, {
    baseDir: path.dirname(filePath),
    title: path.basename(filePath).replace(/\.(md|markdown)$/i, ""),
    warnings,
    pageSetup: settings.pageSetup,
    typography: settings.typography,
    breakBeforeH1: settings.breakBeforeH1,
    toc: settings.toc,
    // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重;按 baseDir 跨文件共享
    imageResolver: getImageResolver(path.dirname(filePath)),
    // 批次 6:KaTeX 资源目录(app.getAppPath() 保证 dev/打包一致;docx 走 MathML 不需要)
    katexDir: path.join(app.getAppPath(), "node_modules", "katex", "dist"),
  });
  throwIfCanceled();

  const { outputPath, warnings: outWarnings } = await resolveOutputPath(
    filePath,
    format,
    settings.outputDir,
  );
  warnings.push(...outWarnings);

  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    if (!options?.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘(与合并共用 renderPdf)
  await renderPdf(artifact, outputPath);
  onProgress?.("done");
  if (!options?.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
  return { outputPath, warnings };
}

/**
 * pdf 产物落盘:临时 HTML → 隐藏窗口 printToPDF → 写输出文件。
 * 单文件/合并共用;临时文件与窗口在 finally 中清理,失败也会销毁窗口。
 */
async function renderPdf(artifact: PdfArtifact, outputPath: string): Promise<void> {
  const htmlPath = path.join(os.tmpdir(), `m2w-${process.pid}-${Date.now()}.html`);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    throwIfCanceled(); // 批次 7:打印前检查(loadFile/字体等待期间用户可能已取消)
    await fs.writeFile(htmlPath, artifact.html, "utf8");
    await printWin.loadFile(htmlPath);
    // 批次 6:等待公式字体(KaTeX woff2)加载完成再打印,否则 printToPDF 缺字形
    // (did-finish-load 后字体仍在加载,printToPDF 不等待字体)
    await printWin.webContents.executeJavaScript("document.fonts.ready");
    throwIfCanceled(); // 批次 7:打印前复查(大文档字体等待可长达数秒)
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
    throwIfCanceled();
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
    await fs.rm(htmlPath, { force: true });
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
): Promise<BatchResult> {
  const total = files.length;
  const items: BatchItem[] = new Array<BatchItem>(total);
  let okCount = 0;
  let failCount = 0;
  let canceledCount = 0;
  let next = 0; // 下一个待取任务的索引(worker 共享,JS 单线程自增安全)
  cancelRequested = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (cancelRequested) {
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
        const { outputPath, warnings } = await convertImpl(file, format, send);
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
  if (!cancelRequested) {
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
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error("未选择文件");
  // 批次 7:每次转换复位取消标志(与单文件 handler / batchConvertImpl 一致),
  // 否则上次取消后 cancelRequested 残留 true,二次合并立即被 throwIfCanceled 误判取消。
  cancelRequested = false;
  throwIfCanceled();
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
  const artifact = await convert(mergedMd, format, {
    baseDir: path.dirname(files[0]),
    title: baseName,
    warnings,
    pageSetup: settings.pageSetup,
    typography: settings.typography,
    breakBeforeH1: settings.breakBeforeH1,
    toc: settings.toc,
    imageResolver: getImageResolver(path.dirname(files[0])),
    katexDir: path.join(app.getAppPath(), "node_modules", "katex", "dist"),
  });
  throwIfCanceled();
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
    await renderPdf(artifact, outputPath);
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
async function collectMarkdownPaths(paths: string[]): Promise<{ files: string[]; skipped: string[] }> {
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
 * 预览窗口:读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发打开多个预览(各自独立临时文件);closed 事件里清理临时文件。
 * 任何失败:销毁窗口(如已创建)+ 删除临时文件,返回 { ok: false, error }。
 */
async function openPreviewWindow(mdPath: string): Promise<{ ok: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  let htmlPath = "";
  try {
    const settings = await loadSettings();
    const { text: md } = decodeMarkdown(await fs.readFile(mdPath));
    const baseName = path.basename(mdPath).replace(/\.(md|markdown)$/i, "");
    const artifact = await convert(md, "pdf", {
      baseDir: path.dirname(mdPath),
      title: baseName,
      pageSetup: settings.pageSetup,
      typography: settings.typography,
      breakBeforeH1: settings.breakBeforeH1,
      toc: settings.toc,
      imageResolver: createImageResolver(path.dirname(mdPath)),
      katexDir: path.join(app.getAppPath(), "node_modules", "katex", "dist"),
    });
    if (artifact.kind !== "pdf") throw new Error("预览仅支持 pdf 渲染");
    htmlPath = path.join(
      os.tmpdir(),
      `m2w-preview-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`,
    );
    await fs.writeFile(htmlPath, artifact.html, "utf8");
    win = new BrowserWindow({
      width: 900,
      height: 1100,
      title: `预览 - ${baseName}`,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.on("closed", () => {
      fs.rm(htmlPath, { force: true }).catch(() => {
        // 临时文件删除失败(如仍被 Chromium 占用)仅记录,不阻断
        console.log(`[preview] 临时文件清理失败: ${htmlPath}`);
      });
    });
    await win.loadFile(htmlPath);
    return { ok: true };
  } catch (err) {
    win?.destroy();
    if (htmlPath) {
      await fs.rm(htmlPath, { force: true }).catch(() => undefined);
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function registerIpc(): void {
  // 选择 markdown 文件
  ipcMain.handle("dialog:openMarkdown", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 Markdown 文件",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // 选择多个 markdown 文件(批量/合并入口;取消返回 [])
  ipcMain.handle("dialog:openMarkdowns", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 Markdown 文件",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示;用户取消返回 { ok:false, canceled:true }
  ipcMain.handle("convert", async (event, filePath: string, format: ConvertFormat): Promise<ConvertResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (stage: string) => win?.webContents.send("convert:progress", { stage });
    cancelRequested = false;
    try {
      const { outputPath, warnings } = await convertImpl(filePath, format, send);
      return { ok: true, outputPath, warnings };
    } catch (err) {
      if (err instanceof ConvertCanceledError) return { ok: false, canceled: true, error: "已取消" };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 取消当前转换(单文件/批量/合并通用;批量由 batchConvertImpl 内部检查)
  ipcMain.handle("convert:cancel", (): void => {
    cancelRequested = true;
  });

  // 选择输出目录(批次 7;取消返回 null)
  ipcMain.handle("dialog:selectDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择输出目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // 拖放路径收集:目录递归取 md,非 md 的传入路径进 skipped
  ipcMain.handle(
    "paths:collectMarkdown",
    (_event, paths: string[]): Promise<{ files: string[]; skipped: string[] }> => {
      return collectMarkdownPaths(Array.isArray(paths) ? paths : []);
    },
  );

  // 批量转换:并发 2,失败不中断,进度走 batch:progress
  ipcMain.handle(
    "convert:batch",
    async (event, files: string[], format: ConvertFormat): Promise<BatchResult | { ok: false; error: string }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const send = (info: BatchProgressInfo): void => win?.webContents.send("batch:progress", info);
      try {
        return await batchConvertImpl(files, format, send);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 合并转换:多文件 → mergeMarkdowns → 单次 convert,输出 {首文件名}-合并.{ext}
  // 批次 7 补:进度走 convert:progress(与单文件同通道),renderer 的 runMerge 已订阅该事件;
  // 用户取消 → 返回 { ok:false, canceled:true }(与单文件 handler 一致,renderer 据此走取消分支)。
  ipcMain.handle("convert:merge", async (event, files: string[], format: ConvertFormat): Promise<ConvertResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
    try {
      return await mergeConvertImpl(files, format, send);
    } catch (err) {
      if (err instanceof ConvertCanceledError) return { ok: false, canceled: true, error: "已取消" };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("settings:get", (): AppSettings => loadSettings());

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    return updateSettings(patch);
  });

  // 导出后行为:资源管理器中显示 / 默认程序打开
  ipcMain.handle("shell:reveal", (_event, filePath: string): void => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:open", async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });

  // 预览:独立可见窗口展示与 PDF 同排版的 HTML(复用 renderPdfHtml),多窗口并发安全
  ipcMain.handle("preview:open", (_event, mdPath: string): Promise<{ ok: boolean; error?: string }> => {
    return openPreviewWindow(mdPath);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  const win = createWindow();
  // 渲染进程 console 错误转发到主进程输出(诊断用)
  win.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  if (SMOKE) {
    // 冒烟自测:构造样例 md → 走完整 convertImpl 链路 → 校验产物
    try {
      const outDir = path.join(__dirname, "..", "..", "output", "test", "smoke");
      const sampleMd = path.join(outDir, "g3-smoke.md");
      await fs.mkdir(outDir, { recursive: true });
      // 批次 7 起重名保护:同名产物不再覆盖 → smoke 自清理本次会生成的产物(含 (2) 序号变体),
      // 保证断言确定性;output/ 下的验收样例等其他文件不受影响。
      // Windows 下被阅读器占用的文件删除会 EBUSY,容错跳过(残留由重名序号机制规避)。
      const smokePrefixes = ["g3-smoke", "g4-smoke", "batch-", "merge-a", "merge-b"];
      for (const name of await fs.readdir(outDir)) {
        const base = name.replace(/\.(md|docx|pdf|png)$/i, "").replace(/\s\(\d+\)$/, "");
        if (smokePrefixes.some((p) => base.startsWith(p))) {
          try {
            await fs.rm(path.join(outDir, name), { force: true });
          } catch {
            // 被外部程序占用:跳过,不阻塞 smoke
          }
        }
      }
      await fs.writeFile(
        sampleMd,
        "# 冒烟测试 中文标题\n\n<!-- page-break -->\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n",
      );
      const { outputPath } = await convertImpl(sampleMd, "docx");
      const stat = await fs.stat(outputPath);
      console.log(`[smoke] convert ok: ${outputPath} (${stat.size} bytes)`);
      // 批次 1:设置持久化往返 + 页面设置端到端(landscape → docx pgSz orient)
      const origSettings = loadSettings();
      try {
        await updateSettings({ breakBeforeH1: true });
        if (!loadSettings().breakBeforeH1) throw new Error("设置持久化失败: breakBeforeH1 未生效");
        console.log("[smoke] settings persist ok");
        await updateSettings({ pageSetup: { ...origSettings.pageSetup, orientation: "landscape" } });
        const landResult = await convertImpl(sampleMd, "docx");
        const landZip = await JSZip.loadAsync(await fs.readFile(landResult.outputPath));
        const landEntry = landZip.file("word/document.xml");
        if (!landEntry) throw new Error("docx 缺少 document.xml");
        const landXml = await landEntry.async("string");
        if (!landXml.includes('w:orient="landscape"')) throw new Error("页面设置 landscape 未生效");
        console.log("[smoke] pageSetup landscape ok");
      } finally {
        await updateSettings(origSettings);
      }
      // G4:pdf 链路(中文/表格/代码块/任务列表/本地图片 → printToPDF)
      const pngPath = path.join(outDir, "g4-smoke.png");
      await fs.writeFile(
        pngPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      const pdfSampleMd = path.join(outDir, "g4-smoke.md");
      await fs.writeFile(
        pdfSampleMd,
        [
          "# G4 PDF 冒烟 中文标题",
          "",
          "| 列A | 列B |",
          "| --- | --- |",
          "| 你好 | world |",
          "",
          "<!-- page-break -->",
          "",
          "```ts",
          "const x: number = 1;",
          "```",
          "",
          "- [x] 已完成项",
          "- [ ] 待办项",
          "",
          "~~删除线~~ 与 `行内代码`",
          "",
          "![本地图片](g4-smoke.png)",
          "",
        ].join("\n"),
      );
      const pdfResult = await convertImpl(pdfSampleMd, "pdf");
      const pdfStat = await fs.stat(pdfResult.outputPath);
      const pdfHead = (await fs.readFile(pdfResult.outputPath)).subarray(0, 5).toString("latin1");
      if (pdfHead !== "%PDF-") throw new Error(`PDF 魔数校验失败: ${pdfHead}`);
      console.log(`[smoke] pdf convert ok: ${pdfResult.outputPath} (${pdfStat.size} bytes)`);
      // 批次 4:书签注入断言(读回 /Outlines,标题中文正确;覆盖用户实测「侧边栏书签为空」问题)
      {
        const outlineDoc = await PDFDocument.load(await fs.readFile(pdfResult.outputPath));
        const outlinesRef = outlineDoc.catalog.get(PDFName.of("Outlines"));
        if (!outlinesRef) throw new Error("PDF 缺少 Outlines 大纲");
        const outlinesDict = outlineDoc.context.lookup(outlinesRef, PDFDict);
        if (!outlinesDict) throw new Error("Outlines 字典解析失败");
        const firstRef = outlinesDict.get(PDFName.of("First"));
        if (!firstRef) throw new Error("大纲缺少 First 条目");
        const firstDict = outlineDoc.context.lookup(firstRef, PDFDict);
        const title = firstDict?.get(PDFName.of("Title"));
        if (!(title instanceof PDFHexString) || title.decodeText() !== "G4 PDF 冒烟 中文标题") {
          throw new Error(`书签标题异常: ${title?.toString()}`);
        }
        // 回归:书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转,见批次 4 修复)
        const destArr = firstDict?.get(PDFName.of("Dest"));
        if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
          throw new Error(`书签 Dest 异常: ${destArr?.toString()}`);
        }
        console.log(`[smoke] pdf 书签 ok: Outlines 注入,中文标题 + Dest 页面引用正确`);
      }
      // 批次 3:批量转换(3 成功 + 1 缺失 → 汇总逐条正确)+ 合并转换(frontmatter 仅首个/图片嵌入/标题齐全)
      const batchFiles = ["batch-a.md", "batch-b.md", "batch-c.md"].map((name) => path.join(outDir, name));
      for (const [i, f] of batchFiles.entries()) {
        await fs.writeFile(f, `# 批量文件 ${i + 1}\n\n正文 ${i + 1}\n`);
      }
      const batchMissing = path.join(outDir, "batch-missing.md"); // 故意不写盘
      const batch = await batchConvertImpl([...batchFiles, batchMissing], "docx");
      if (batch.okCount !== 3 || batch.failCount !== 1) {
        throw new Error(`批量汇总错误: ok=${batch.okCount} fail=${batch.failCount}`);
      }
      const failItem = batch.items.find((i) => !i.ok);
      if (failItem?.file !== batchMissing || !failItem.error) {
        throw new Error("批量失败项汇总不正确");
      }
      // 产物断言用 convertImpl 实际返回路径(输出目录可配置后不再固定为 output/)
      for (const item of batch.items) {
        if (item.ok) {
          if (!item.outputPath) throw new Error("批量成功项缺少 outputPath");
          await fs.stat(item.outputPath); // 批量产物存在
        }
      }
      console.log(`[smoke] batch ok: 3 成功 1 失败(汇总逐条正确)`);
      const mergeA = path.join(outDir, "merge-a.md");
      const mergeB = path.join(outDir, "merge-b.md");
      await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](g4-smoke.png)\n`);
      await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
      const mergeResult = await mergeConvertImpl([mergeA, mergeB], "docx");
      // 重名序号变体兼容:输出目录可配置后产物可能为「merge-a-合并 (2).docx」,
      // 断言剥离 (N) 序号后缀后须以 -合并.docx 结尾(与 batch 断言同源修复)
      const mergeBase = mergeResult.outputPath?.replace(/\s\(\d+\)(?=\.docx$)/, "");
      if (!mergeResult.ok || !mergeResult.outputPath || !mergeBase?.endsWith("-合并.docx")) {
        throw new Error(`合并输出异常: ${mergeResult.error ?? mergeResult.outputPath}`);
      }
      const mergeZip = await JSZip.loadAsync(await fs.readFile(mergeResult.outputPath));
      const mergeXml = await mergeZip.file("word/document.xml")!.async("string");
      if (!mergeXml.includes("合并第一章") || !mergeXml.includes("合并第二章")) {
        throw new Error("合并产物缺少文件标题");
      }
      if (mergeXml.includes("合并第二文件")) throw new Error("合并产物残留后续 frontmatter title");
      const mergeRels = await mergeZip.file("word/_rels/document.xml.rels")!.async("string");
      if (!mergeRels.includes("image")) throw new Error("合并产物图片未嵌入");
      console.log(`[smoke] merge ok: ${path.basename(mergeResult.outputPath)} (frontmatter/图片/标题正确)`);
      // 批次 4:合并 PDF 书签断言(用户实测「合并 PDF 侧边栏书签为空」的直接回归场景)
      const mergePdfResult = await mergeConvertImpl([mergeA, mergeB], "pdf");
      // 同 docx:重名序号变体兼容
      const mergePdfBase = mergePdfResult.outputPath?.replace(/\s\(\d+\)(?=\.pdf$)/, "");
      if (!mergePdfResult.ok || !mergePdfResult.outputPath || !mergePdfBase?.endsWith("-合并.pdf")) {
        throw new Error(`合并 PDF 输出异常: ${mergePdfResult.error ?? mergePdfResult.outputPath}`);
      }
      {
        const outlineDoc = await PDFDocument.load(await fs.readFile(mergePdfResult.outputPath));
        const outlinesRef = outlineDoc.catalog.get(PDFName.of("Outlines"));
        if (!outlinesRef) throw new Error("合并 PDF 缺少 Outlines 大纲");
        const outlinesDict = outlineDoc.context.lookup(outlinesRef, PDFDict);
        if (!outlinesDict) throw new Error("合并 PDF Outlines 字典解析失败");
        const firstRef = outlinesDict.get(PDFName.of("First"));
        if (!firstRef) throw new Error("合并 PDF 大纲缺少 First 条目");
        const firstDict = outlineDoc.context.lookup(firstRef, PDFDict);
        const title = firstDict?.get(PDFName.of("Title"));
        if (!(title instanceof PDFHexString) || title.decodeText() !== "合并第一章") {
          throw new Error(`合并 PDF 书签标题异常: ${title?.toString()}`);
        }
        // 回归:合并书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转)
        const destArr = firstDict?.get(PDFName.of("Dest"));
        if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
          throw new Error(`合并 PDF 书签 Dest 异常: ${destArr?.toString()}`);
        }
        console.log(`[smoke] merge pdf 书签 ok: 合并产物 Outlines 注入,中文标题 + Dest 页面引用正确`);
      }
    } catch (err) {
      console.error("[smoke] convert FAILED:", err);
      app.exit(1);
      return;
    }
    // renderer 侧诊断:window.api 是否注入、转换按钮是否可点、点击后状态区反馈
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 等页面加载
      const diag = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const report = { api: typeof window.api };
        const btn = document.getElementById("convertBtn");
        report.btnExists = !!btn;
        if (btn) {
          report.btnDisabledBefore = btn.disabled;
          btn.click();
          await sleep(50);
          const status = document.getElementById("status");
          report.statusAfterClick = status ? status.textContent : "";
          report.statusIsError = status ? status.classList.contains("status--error") : null;
        }
        // 防回归:完成弹窗启动时必须隐藏(曾因 CSS 特异性覆盖而失效)
        const dlg = document.getElementById("completeDialog");
        report.dialogExists = !!dlg;
        report.dialogHiddenAtStart = dlg ? dlg.classList.contains("hidden") : null;
        report.dialogVisibleAtStart = dlg ? getComputedStyle(dlg).display !== "none" : null;
        return report;
      })()`);
      console.log(`[smoke] renderer diag: ${JSON.stringify(diag)}`);
    } catch (err) {
      console.error("[smoke] renderer diag FAILED:", err);
      app.exit(1);
      return;
    }
    setTimeout(() => app.quit(), 500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
