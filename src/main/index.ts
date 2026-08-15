/**
 * 主进程入口:窗口生命周期 + IPC 薄层(转换编排在 ./converter.ts,smoke 在 ./smoke.ts)。
 * 职责:
 * - app 生命周期(whenReady / activate / window-all-closed)
 * - BrowserWindow 创建(主窗口 createWindow + 预览 openPreviewWindow)
 * - IPC 注册(handler 委托给 converter 函数 / settings / shell)
 * - SMOKE 入口(--smoke 分支一行委托 ./smoke.ts 的 runSmoke)
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert, type ConvertFormat } from "../core/convert.js";
import { decodeMarkdown } from "../core/encoding.js";
import { createImageResolver } from "./image-downloader.js";
import {
  baseNameFromMdPath,
  buildPresetsExportPayload,
  buildRecentFileEntries,
  errorMessage,
  importPresetsFromText,
} from "./ipc-logic.js";
import {
  loadSettings,
  updateSettings,
  type AppSettings,
  type ExportPresetsResult,
  type ImportPresetsResult,
} from "./settings.js";
import {
  loadUiState,
  pickWindowBounds,
  saveUiState,
  type UiState,
} from "./ui-state.js";
import { writeTempHtml } from "./temp-html.js";
import {
  batchConvertImpl,
  buildConvertContext,
  collectMarkdownPaths,
  ConvertCanceledError,
  convertImpl,
  createConvertContext,
  filterExistingPaths,
  mergeConvertImpl,
  type BatchProgressInfo,
  type BatchResult,
  type ConvertContext,
  type ConvertResult,
} from "./converter.js";
import { getKatexDir } from "./katex-dir.js";
import { disposeMermaidService, renderMermaid } from "./mermaid-service.js";
import { runSmoke } from "./smoke.js";
import { escapeHtml } from "../core/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

/**
 * IPC 层持有各窗口进行中的转换 context(convert:cancel 入口按 webContents id 取,
 * 多窗口并发互不串扰,M3);转换完成/异常/取消后删除,避免悬挂引用。
 */
const ctxByWebContents = new Map<number, ConvertContext>();

/** 主窗口引用:菜单「打开文件…」/「关于」需定位主窗口(预览窗口无 preload,不响应菜单)。 */
let mainWindow: BrowserWindow | null = null;

/**
 * convert 系 handler 共用样板(R10-3):context 注册/释放 + 错误归一化集中一处。
 * 取消语义(刚根治的历史 bug 领域)不再分散在三个 handler:
 * - ctx 每次调用新建(「取消后复位」语义),按 webContents id 注册(多窗口隔离,M3)
 * - finally 删除引用(含异常/取消路径,避免悬挂)
 * - ConvertCanceledError → onCanceled()(调用方给出取消结果形态);其他错误归一 { ok:false, error }
 */
async function runWithCtx<T>(
  event: Electron.IpcMainInvokeEvent,
  fn: (ctx: ConvertContext, win: BrowserWindow | null) => Promise<T>,
  onCanceled: () => T | { ok: false; error: string },
): Promise<T | { ok: false; error: string }> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ctx = createConvertContext(); // 每次调用新建,取消标志不复用(「取消后复位」语义)
  ctxByWebContents.set(event.sender.id, ctx);
  try {
    return await fn(ctx, win);
  } catch (err) {
    if (err instanceof ConvertCanceledError) return onCanceled();
    return { ok: false, error: errorMessage(err) };
  } finally {
    ctxByWebContents.delete(event.sender.id); // 释放引用,避免悬挂(含异常/取消路径)
  }
}

function createWindow(): BrowserWindow {
  // 批次 11:恢复上次窗口位置(x/y 须在某显示器工作区内,否则丢弃用默认尺寸)
  const savedBounds = pickWindowBounds(
    loadUiState().windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    // 批次 12(C3):最小尺寸,防止窗口过小导致布局挤压不可用
    minWidth: 720,
    minHeight: 560,
    ...(savedBounds ?? {}),
    title: "Markdown 转换工具",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // mermaid 渲染窗口为常驻隐藏单例:主窗口关闭时销毁,否则 window-all-closed 永不触发
  // (隐藏窗口未关 → 应用无法退出);服务懒重建,后续渲染不受影响
  win.on("closed", () => {
    mainWindow = null;
    disposeMermaidService();
  });
  // 批次 11:关闭时保存窗口位置(最大化/全屏不记录,恢复默认尺寸);
  // preventDefault + 写盘完成后 destroy,保证退出前写入落盘(不丢状态)
  win.on("close", (event) => {
    if (win.isMaximized() || win.isFullScreen()) return;
    const bounds = win.getBounds();
    event.preventDefault();
    void saveUiState({ windowBounds: bounds })
      .catch(() => {
        /* 静默:UI 状态写失败不影响关闭 */
      })
      .finally(() => win.destroy());
  });
  return win;
}

/**
 * 预览窗口注册表(批次 11 迭代 3「E 预览跟随刷新」):
 * 允许并发多开;closed 清理注册与临时文件;focus 时按 mtime 对比源文件,
 * 变更则重渲染(复用 openPreviewWindow 的渲染路径);设置变更经 preview:refresh
 * 全量刷新。转换中不触碰预览(预览与转换互不干扰,保持现状)。
 */
interface PreviewEntry {
  win: BrowserWindow;
  mdPath: string;
  /** 打开/上次刷新时记录的源文件 mtime(focus 时对比,变了才重渲染)。 */
  mtimeMs: number;
  /** 当前展示的临时 HTML 清理函数(每次刷新替换为新临时文件的清理)。 */
  cleanup: () => Promise<void>;
}
const previews = new Set<PreviewEntry>();

/** 预览渲染:读 md → convert("pdf") 复用 PDF 排版 HTML(打开与刷新共用同一路径)。 */
async function renderPreviewHtml(mdPath: string): Promise<string> {
  const settings = await loadSettings();
  const { text: md } = decodeMarkdown(await fs.readFile(mdPath));
  const baseName = baseNameFromMdPath(mdPath);
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
      mermaidResolver: renderMermaid,
    }),
  );
  if (artifact.kind !== "pdf") throw new Error("预览仅支持 pdf 渲染");
  return artifact.html;
}

/** 预览窗口内显示错误页(源文件缺失/渲染失败;保留窗口,恢复后 focus 会重新检查)。 */
function showPreviewError(win: BrowserWindow, message: string): void {
  if (win.isDestroyed()) return;
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>预览不可用</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa; }
  .box { max-width: 480px; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; color: #333; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 13px; color: #666; margin: 0; word-break: break-all; }
</style></head>
<body><div class="box"><h1>预览不可用</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/**
 * 重渲染单个预览窗口:重读设置 + 源文件 → 渲染 → 写新临时文件 → loadFile。
 * 刷新成功后替换注册表清理函数(旧临时文件在新页面加载完成后清理)并更新 mtime;
 * 任何失败(含源文件缺失)→ 窗口内错误页。
 */
async function refreshPreviewWindow(entry: PreviewEntry): Promise<void> {
  if (entry.win.isDestroyed()) return;
  try {
    const html = await renderPreviewHtml(entry.mdPath);
    const tmp = await writeTempHtml(html);
    const oldCleanup = entry.cleanup;
    entry.cleanup = tmp.cleanup;
    // 渲染完成后再 stat:捕获渲染期间的最新 mtime,下次 focus 以新值对比
    const st = await fs.stat(entry.mdPath);
    entry.mtimeMs = st.mtimeMs;
    await entry.win.loadFile(tmp.htmlPath);
    await oldCleanup(); // 旧临时文件已不再被引用
  } catch (err) {
    showPreviewError(entry.win, errorMessage(err));
  }
}

/** focus 时检查源文件:缺失 → 错误页;mtime 变更 → 重渲染。 */
async function checkPreviewSource(entry: PreviewEntry): Promise<void> {
  if (entry.win.isDestroyed()) return;
  let st;
  try {
    st = await fs.stat(entry.mdPath);
  } catch {
    showPreviewError(entry.win, `源文件已不存在:${entry.mdPath}`);
    return;
  }
  if (st.mtimeMs !== entry.mtimeMs) await refreshPreviewWindow(entry);
}

/**
 * 预览窗口:读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发打开多个预览(各自独立临时文件);closed 事件里清理注册与临时文件。
 * 任何失败:销毁窗口(如已创建)+ 删除临时文件,返回 { ok: false, error }。
 */
async function openPreviewWindow(mdPath: string): Promise<{ ok: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    // 打开时记录源文件 mtime(focus 对比基准;缺失在 readFile 处抛错走失败路径)
    const st = await fs.stat(mdPath);
    const html = await renderPreviewHtml(mdPath);
    const tmp = await writeTempHtml(html);
    cleanup = tmp.cleanup;
    const baseName = baseNameFromMdPath(mdPath);
    win = new BrowserWindow({
      width: 900,
      height: 1100,
      title: `预览 - ${baseName}`,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    const entry: PreviewEntry = {
      win,
      mdPath,
      mtimeMs: st.mtimeMs,
      cleanup: tmp.cleanup,
    };
    previews.add(entry);
    win.on("closed", () => {
      previews.delete(entry);
      void entry.cleanup().catch(() => undefined);
    });
    // 批次 11 迭代 3:源文件变更(或恢复)时刷新;已是最新则不动作
    win.on("focus", () => void checkPreviewSource(entry));
    await win.loadFile(tmp.htmlPath);
    return { ok: true };
  } catch (err) {
    win?.destroy();
    await cleanup?.();
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * 转换成功钩子(批次 11):记录最近文件条目 {path,name,format,ts}。
 * saveUiState 内部按 path 去重(保留 ts 最大)+ 截断 10,重复转换自然置顶;
 * 写入失败静默,不影响转换结果。
 */
async function recordRecentFiles(filePaths: string[], format: ConvertFormat): Promise<void> {
  const entries = buildRecentFileEntries(filePaths, format, Date.now());
  if (entries.length === 0) return;
  try {
    await saveUiState({ recentFiles: entries });
  } catch {
    /* 静默:UI 状态写入失败不影响转换 */
  }
}

/** 上次对话框目录:仅当仍存在且为目录时使用(记忆失效自动回落默认)。 */
async function lastOpenDirIfValid(): Promise<string | undefined> {
  const dir = loadUiState().lastOpenDir;
  if (!dir) return undefined;
  try {
    const st = await fs.stat(dir);
    return st.isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

function registerIpc(): void {
  // 选择多个 markdown 文件(批量/合并入口;取消返回 []);
  // 批次 11:defaultPath 记忆上次目录,成功后回写所选文件所在目录
  ipcMain.handle("dialog:openMarkdowns", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 Markdown 文件",
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await saveUiState({ lastOpenDir: path.dirname(result.filePaths[0]) }).catch(() => undefined);
    }
    return result.canceled ? [] : result.filePaths;
  });

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示;用户取消返回 { ok:false, canceled:true }
  ipcMain.handle("convert", async (event, filePath: string, format: ConvertFormat): Promise<ConvertResult> => {
    return runWithCtx(
      event,
      async (ctx, win) => {
        const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
        const { outputPath, warnings } = await convertImpl(filePath, format, send, ctx, getKatexDir());
        await recordRecentFiles([filePath], format); // 批次 11:成功后记最近文件
        return { ok: true, outputPath, warnings };
      },
      () => ({ ok: false, canceled: true, error: "已取消" }),
    );
  });

  // 取消当前窗口的转换(单文件/批量/合并通用;批量由 batchConvertImpl 内部检查)
  ipcMain.handle("convert:cancel", (event): void => {
    ctxByWebContents.get(event.sender.id)?.cancel();
  });

  // 选择输出目录(批次 7;取消返回 null);批次 11:defaultPath 记忆 + 成功后回写所选目录
  ipcMain.handle("dialog:selectDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择输出目录",
      defaultPath: await lastOpenDirIfValid(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      await saveUiState({ lastOpenDir: result.filePaths[0] }).catch(() => undefined);
    }
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // 拖放路径收集:目录递归取 md,非 md 的传入路径进 skipped
  ipcMain.handle(
    "paths:collectMarkdown",
    (_event, paths: string[]): Promise<{ files: string[]; skipped: string[] }> => {
      return collectMarkdownPaths(Array.isArray(paths) ? paths : []);
    },
  );

  // 批量转换:并发 2,失败不中断,进度走 batch:progress;取消由 batchConvertImpl 内部收集 canceledCount,
  // 不抛 ConvertCanceledError(onCanceled 分支为防御兜底,与 catch-all 归一一致)
  ipcMain.handle(
    "convert:batch",
    async (event, files: string[], format: ConvertFormat): Promise<BatchResult | { ok: false; error: string }> => {
      return runWithCtx(
        event,
        async (ctx, win) => {
          const send = (info: BatchProgressInfo): void => win?.webContents.send("batch:progress", info);
          const result = await batchConvertImpl(files, format, send, ctx, getKatexDir());
          // 批次 11:成功后记录每个成功项的最近文件条目
          await recordRecentFiles(
            result.items.filter((item) => item.ok && item.file).map((item) => item.file),
            format,
          );
          return result;
        },
        () => ({ ok: false, error: "已取消" }),
      );
    },
  );

  // 合并转换:多文件 → mergeMarkdowns → 单次 convert,输出 {首文件名}-合并.{ext}
  // 批次 7 补:进度走 convert:progress(与单文件同通道),renderer 的 runMerge 已订阅该事件;
  // 用户取消 → 返回 { ok:false, canceled:true }(与单文件 handler 一致,renderer 据此走取消分支)。
  ipcMain.handle("convert:merge", async (event, files: string[], format: ConvertFormat): Promise<ConvertResult> => {
    return runWithCtx(
      event,
      async (ctx, win) => {
        const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
        const result = await mergeConvertImpl(files, format, send, ctx, getKatexDir());
        // 批次 11:合并成功 → 全部源文件均成功转换,逐个记最近文件
        if (result.ok) await recordRecentFiles(files, format);
        return result;
      },
      () => ({ ok: false, canceled: true, error: "已取消" }),
    );
  });
  ipcMain.handle("settings:get", (): AppSettings => loadSettings());

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    return updateSettings(patch);
  });

  // 批次 13:导入模板预设 JSON(选文件 → 解析校验 → 同名覆盖合并 → 上限 10 → 持久化)。
  // 取消 → { ok:true, canceled:true };解析/读取异常 → { ok:false, error }(可读文案)
  ipcMain.handle("presets:import", async (): Promise<ImportPresetsResult> => {
    const result = await dialog.showOpenDialog({
      title: "导入模板预设",
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true };
    }
    try {
      const text = await fs.readFile(result.filePaths[0], "utf8");
      const merged = importPresetsFromText(text, loadSettings().customPresets);
      if (!merged.ok) return { ok: false, error: merged.error };
      await updateSettings({ customPresets: merged.presets });
      // 与其它打开对话框一致:成功后记忆所选目录(下次默认打开位置)
      await saveUiState({ lastOpenDir: path.dirname(result.filePaths[0]) }).catch(() => undefined);
      return {
        ok: true,
        canceled: false,
        imported: merged.imported,
        overridden: merged.overridden,
      };
    } catch (err) {
      return { ok: false, error: `读取文件失败:${errorMessage(err)}` };
    }
  });

  // 批次 13:导出全部自定义预设为 JSON(保存对话框;schemaVersion:1 包装,2 空格缩进)。
  // 空预设 main 侧前置拦截(renderer 侧可同样提示,两处一致);取消 → { ok:true, canceled:true }
  ipcMain.handle("presets:export", async (): Promise<ExportPresetsResult> => {
    const presets = loadSettings().customPresets;
    if (presets.length === 0) return { ok: false, error: "暂无自定义预设可导出" };
    const result = await dialog.showSaveDialog({
      title: "导出模板预设",
      defaultPath: path.join(app.getPath("documents"), "presets.json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    try {
      const payload = buildPresetsExportPayload(presets);
      await fs.writeFile(result.filePath, payload, "utf8");
      return { ok: true, canceled: false, count: presets.length };
    } catch (err) {
      return { ok: false, error: `写入文件失败:${errorMessage(err)}` };
    }
  });

  // 批次 11:UI 状态读写(最近文件/会话文件/记忆目录/窗口位置/面板展开态;独立于 settings)
  ipcMain.handle("ui-state:get", (): UiState => loadUiState());
  ipcMain.handle("ui-state:set", (_event, patch: Partial<UiState>): Promise<UiState> => {
    return saveUiState(patch);
  });

  // 批次 11:会话恢复用——保序过滤仍存在的路径(缺失剔除,不打乱用户排列顺序)
  ipcMain.handle("paths:filterExisting", (_event, paths: string[]): Promise<string[]> => {
    return filterExistingPaths(Array.isArray(paths) ? paths : []);
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

  // 批次 11 迭代 3:设置变更后刷新所有预览窗口(renderer 在 settingsSet 成功后调用;
  // 无预览窗口时为空操作;刷新失败在窗口内显示错误页,不影响主窗口)
  ipcMain.handle("preview:refresh", (): void => {
    for (const entry of previews) void refreshPreviewWindow(entry);
  });
}

/* ---------- 批次 11 迭代 4:应用菜单(文件:打开文件…/退出;帮助:关于) ---------- */
/**
 * 菜单「打开文件…」:只做转发——聚焦主窗口后经 webContents.send 通知 renderer,
 * renderer 复用现有 openDialog(false) 链路(对话框/过滤/目录记忆/选择应用全在既有代码,
 * 不重复实现);预览窗口无 preload 不订阅,消息自然丢弃。
 */
function openFromAppMenu(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("menu:open");
}

/** 菜单「关于」:应用名 + 版本(app.getVersion())+ 简短说明。 */
function showAboutDialog(): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "关于",
    message: "Markdown 转换工具",
    detail: `版本 ${app.getVersion()}\n\n将 Markdown 文件转换为 Word 或 PDF 文档`,
    buttons: ["确定"],
  };
  if (win && !win.isDestroyed()) void dialog.showMessageBox(win, options);
  else void dialog.showMessageBox(options);
}

/**
 * 最小应用菜单:autoHideMenuBar 保持(Alt 唤出,不常显)。
 * 菜单项只做转发/胶水,不复刻业务逻辑;退出用 role(平台默认行为)。
 */
function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "打开文件…", click: openFromAppMenu },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "帮助",
      submenu: [{ label: "关于", click: showAboutDialog }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

void app.whenReady().then(async () => {
  buildAppMenu(); // 菜单先于窗口创建,窗口创建即带应用菜单(autoHideMenuBar 下 Alt 唤出)
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
