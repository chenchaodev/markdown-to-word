/**
 * 主进程入口:窗口生命周期 + IPC 薄层(转换编排在 ./converter.ts,smoke 在 ./smoke.ts)。
 * 职责:
 * - app 生命周期(whenReady / activate / window-all-closed)
 * - BrowserWindow 创建(主窗口 createWindow + 预览 openPreviewWindow)
 * - IPC 注册(handler 委托给 converter 函数 / settings / shell)
 * - SMOKE 入口(--smoke 分支一行委托 ./smoke.ts 的 runSmoke)
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert, type ConvertFormat } from "../core/convert.js";
import { decodeMarkdown } from "../core/encoding.js";
import { createImageResolver } from "./image-downloader.js";
import { loadSettings, updateSettings, type AppSettings } from "./settings.js";
import { writeTempHtml } from "./temp-html.js";
import {
  batchConvertImpl,
  buildConvertContext,
  collectMarkdownPaths,
  ConvertCanceledError,
  convertImpl,
  createConvertContext,
  mergeConvertImpl,
  type BatchProgressInfo,
  type BatchResult,
  type ConvertContext,
  type ConvertResult,
} from "./converter.js";
import { getKatexDir } from "./katex-dir.js";
import { runSmoke } from "./smoke.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

/**
 * IPC 层持有各窗口进行中的转换 context(convert:cancel 入口按 webContents id 取,
 * 多窗口并发互不串扰,M3);转换完成/异常/取消后删除,避免悬挂引用。
 */
const ctxByWebContents = new Map<number, ConvertContext>();

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
 * 预览窗口:读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发打开多个预览(各自独立临时文件);closed 事件里清理临时文件。
 * 任何失败:销毁窗口(如已创建)+ 删除临时文件,返回 { ok: false, error }。
 */
async function openPreviewWindow(mdPath: string): Promise<{ ok: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const settings = await loadSettings();
    const { text: md } = decodeMarkdown(await fs.readFile(mdPath));
    const baseName = path.basename(mdPath).replace(/\.(md|markdown)$/i, "");
    const artifact = await convert(
      md,
      "pdf",
      buildConvertContext({
        baseDir: path.dirname(mdPath),
        title: baseName,
        settings,
        // 预览不经 getImageResolver 共享缓存:允许并发打开多个预览,各自独立解析器
        imageResolver: createImageResolver(path.dirname(mdPath)),
        katexDir: getKatexDir(),
      }),
    );
    if (artifact.kind !== "pdf") throw new Error("预览仅支持 pdf 渲染");
    const tmp = await writeTempHtml(artifact.html);
    cleanup = tmp.cleanup;
    win = new BrowserWindow({
      width: 900,
      height: 1100,
      title: `预览 - ${baseName}`,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.on("closed", () => {
      void cleanup?.();
    });
    await win.loadFile(tmp.htmlPath);
    return { ok: true };
  } catch (err) {
    win?.destroy();
    await cleanup?.();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function registerIpc(): void {
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
    const ctx = createConvertContext(); // 每次调用新建,取消标志不复用(「取消后复位」语义)
    ctxByWebContents.set(event.sender.id, ctx);
    try {
      const { outputPath, warnings } = await convertImpl(filePath, format, send, ctx, getKatexDir());
      return { ok: true, outputPath, warnings };
    } catch (err) {
      if (err instanceof ConvertCanceledError) return { ok: false, canceled: true, error: "已取消" };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      ctxByWebContents.delete(event.sender.id); // 释放引用,避免悬挂(含异常/取消路径)
    }
  });

  // 取消当前窗口的转换(单文件/批量/合并通用;批量由 batchConvertImpl 内部检查)
  ipcMain.handle("convert:cancel", (event): void => {
    ctxByWebContents.get(event.sender.id)?.cancel();
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
      const ctx = createConvertContext(); // 每次调用新建,取消标志不复用
      ctxByWebContents.set(event.sender.id, ctx);
      try {
        return await batchConvertImpl(files, format, send, ctx, getKatexDir());
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        ctxByWebContents.delete(event.sender.id); // 释放引用(含异常路径)
      }
    },
  );

  // 合并转换:多文件 → mergeMarkdowns → 单次 convert,输出 {首文件名}-合并.{ext}
  // 批次 7 补:进度走 convert:progress(与单文件同通道),renderer 的 runMerge 已订阅该事件;
  // 用户取消 → 返回 { ok:false, canceled:true }(与单文件 handler 一致,renderer 据此走取消分支)。
  ipcMain.handle("convert:merge", async (event, files: string[], format: ConvertFormat): Promise<ConvertResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
    const ctx = createConvertContext(); // 每次调用新建,取消标志不复用(「取消后复位」语义)
    ctxByWebContents.set(event.sender.id, ctx);
    try {
      return await mergeConvertImpl(files, format, send, ctx, getKatexDir());
    } catch (err) {
      if (err instanceof ConvertCanceledError) return { ok: false, canceled: true, error: "已取消" };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      ctxByWebContents.delete(event.sender.id); // 释放引用(含异常/取消路径)
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
    try {
      await runSmoke(win);
    } catch (err) {
      console.error("[smoke] convert FAILED:", err);
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
