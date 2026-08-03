import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { convert, type ConvertFormat } from "../core/convert.js";
import { createImageResolver } from "./image-downloader.js";
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
    // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重
    imageResolver: createImageResolver(path.dirname(filePath)),
  });

  if (artifact.kind === "docx") {
    const outputPath = filePath.replace(/\.(md|markdown)$/i, ".docx");
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘
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
    const outputPath = filePath.replace(/\.(md|markdown)$/i, ".pdf");
    await fs.writeFile(outputPath, data);
    onProgress?.("done");
    await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
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

  // 设置:读取 / 更新(更新经 updateSettings 白名单校验 + 原子持久化)
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
