import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { convert, type ConvertFormat, type PdfArtifact } from "../core/convert.js";
import { mergeMarkdowns } from "../core/merge.js";
import { createImageResolver, type ImageResolver } from "./image-downloader.js";
import { loadSettings, updateSettings, type AppSettings } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带 */
  warnings?: string[];
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
}

export interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
}

/** 批量共享 imageResolver:按 baseDir 缓存,HTTP 去重缓存跨文件生效(转换后不清理,键为路径,无泄漏风险) */
const resolverCache = new Map<string, ImageResolver>();

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
  const settings = await loadSettings();
  onProgress?.("read");
  const md = await fs.readFile(filePath, "utf8");

  onProgress?.("render");
  const warnings: string[] = [];
  const artifact = await convert(md, format, {
    baseDir: path.dirname(filePath),
    title: path.basename(filePath).replace(/\.(md|markdown)$/i, ""),
    warnings,
    pageSetup: settings.pageSetup,
    breakBeforeH1: settings.breakBeforeH1,
    // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重;按 baseDir 跨文件共享
    imageResolver: getImageResolver(path.dirname(filePath)),
  });

  if (artifact.kind === "docx") {
    const outputPath = filePath.replace(/\.(md|markdown)$/i, ".docx");
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    if (!options?.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘(与合并共用 renderPdf)
  const outputPath = filePath.replace(/\.(md|markdown)$/i, ".pdf");
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
    await fs.writeFile(htmlPath, artifact.html, "utf8");
    await printWin.loadFile(htmlPath);
    const data = await printWin.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: artifact.footerTemplate,
    });
    await fs.writeFile(outputPath, data);
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
 * 批量模式跳过 runAfterConvert;进度经 onProgress 上报(index 从 1 开始,file=文件名)。
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
  let next = 0; // 下一个待取任务的索引(worker 共享,JS 单线程自增安全)

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      const file = files[index];
      const send = (stage: string): void =>
        onProgress?.({ index: index + 1, total, file: path.basename(file), stage });
      try {
        const { outputPath, warnings } = await convertImpl(file, format, send, { skipAfterConvert: true });
        items[index] = { file, ok: true, outputPath, warnings };
        okCount++;
      } catch (err) {
        items[index] = { file, ok: false, error: err instanceof Error ? err.message : String(err) };
        failCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, total) }, () => worker()));
  return { ok: true, items, okCount, failCount };
}

/**
 * 合并转换:读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 * 输出与 files[0] 同目录,`{basename}-合并.{ext}`;执行 runAfterConvert(单输出,与单文件一致)。
 * 任一步失败直接抛(调用方 catch 为 { ok:false, error })。
 */
export async function mergeConvertImpl(files: string[], format: ConvertFormat): Promise<ConvertResult> {
  if (files.length === 0) throw new Error("未选择文件");
  const settings = await loadSettings();
  const inputs = await Promise.all(
    files.map(async (file) => ({ content: await fs.readFile(file, "utf8"), baseDir: path.dirname(file) })),
  );
  const mergedMd = mergeMarkdowns(inputs);
  const baseName = path.basename(files[0]).replace(/\.(md|markdown)$/i, "");
  const warnings: string[] = [];
  const artifact = await convert(mergedMd, format, {
    baseDir: path.dirname(files[0]),
    title: baseName,
    warnings,
    pageSetup: settings.pageSetup,
    breakBeforeH1: settings.breakBeforeH1,
    imageResolver: getImageResolver(path.dirname(files[0])),
  });
  const outputPath = path.join(
    path.dirname(files[0]),
    `${baseName}-合并${format === "docx" ? ".docx" : ".pdf"}`,
  );
  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
  } else {
    await renderPdf(artifact, outputPath);
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
    const md = await fs.readFile(mdPath, "utf8");
    const baseName = path.basename(mdPath).replace(/\.(md|markdown)$/i, "");
    const artifact = await convert(md, "pdf", {
      baseDir: path.dirname(mdPath),
      title: baseName,
      pageSetup: settings.pageSetup,
      breakBeforeH1: settings.breakBeforeH1,
      imageResolver: createImageResolver(path.dirname(mdPath)),
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

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示
  ipcMain.handle("convert", async (event, filePath: string, format: ConvertFormat): Promise<ConvertResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (stage: string) => win?.webContents.send("convert:progress", { stage });
    try {
      const { outputPath, warnings } = await convertImpl(filePath, format, send);
      return { ok: true, outputPath, warnings };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
  ipcMain.handle("convert:merge", async (_event, files: string[], format: ConvertFormat): Promise<ConvertResult> => {
    try {
      return await mergeConvertImpl(files, format);
    } catch (err) {
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
      const outDir = path.join(__dirname, "..", "..", "output");
      const sampleMd = path.join(outDir, "g3-smoke.md");
      await fs.mkdir(outDir, { recursive: true });
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
      for (const f of batchFiles) {
        await fs.stat(f.replace(/\.md$/, ".docx")); // 批量产物存在
      }
      console.log(`[smoke] batch ok: 3 成功 1 失败(汇总逐条正确)`);
      const mergeA = path.join(outDir, "merge-a.md");
      const mergeB = path.join(outDir, "merge-b.md");
      await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](g4-smoke.png)\n`);
      await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
      const mergeResult = await mergeConvertImpl([mergeA, mergeB], "docx");
      if (!mergeResult.ok || !mergeResult.outputPath?.endsWith("-合并.docx")) {
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
