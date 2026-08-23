/**
 * 主进程入口:窗口生命周期 + IPC 薄层(转换编排在 ./converter.ts,smoke 在 ./smoke.ts)。
 * 职责:
 * - app 生命周期(whenReady / activate / window-all-closed)
 * - BrowserWindow 创建(主窗口 createWindow + 预览 openPreviewWindow)
 * - IPC 注册(handler 委托给 converter 函数 / settings / shell)
 * - SMOKE 入口(--smoke 分支一行委托 ./smoke.ts 的 runSmoke)
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from "electron";
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
  isConvertFormat,
  isString,
  isStringArray,
  runConvertTask,
} from "./ipc-logic.js";
import {
  loadSettings,
  updateSettings,
  MAX_PDF_CSS_BYTES,
  type AppSettings,
  type ExportPresetsResult,
  type ImportPdfCssResult,
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
import { hardenWebContents } from "./web-hardening.js";
import { escapeHtml } from "../core/utils.js";
import { setLanguage, t } from "../core/i18n.js";

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
 * convert 系 handler 共用样板(R10-3;B11 抽纯逻辑至 ipc-logic.runConvertTask,
 * 本函数只保留 Electron 触点:win 解析 + 按 webContents id 注册/注销 + 取消错误判定)。
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
  const senderId = event.sender.id;
  return runConvertTask(
    {
      createContext: createConvertContext,
      registerCtx: (ctx) => ctxByWebContents.set(senderId, ctx),
      unregisterCtx: () => ctxByWebContents.delete(senderId),
      isCanceledError: (err) => err instanceof ConvertCanceledError,
    },
    (ctx) => fn(ctx, win),
    onCanceled,
  );
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
    title: t("app.title"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  hardenWebContents(win); // B1:导航收口(拒绝新窗口/页内跨文档导航,http(s) 外开系统浏览器)
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html")).catch((err) => {
    // B2:加载失败不再静默(此前 void 无 catch,失败进 unhandledRejection 黑洞)
    console.error("[main] renderer index.html 加载失败:", err);
  });
  // mermaid 渲染窗口为常驻隐藏单例:主窗口关闭时销毁,否则 window-all-closed 永不触发
  // (隐藏窗口未关 → 应用无法退出);服务懒重建,后续渲染不受影响
  win.on("closed", () => {
    mainWindow = null;
    disposeMermaidService();
  });
  // 批次 11:关闭时保存窗口位置(最大化/全屏不记录,恢复默认尺寸);
  // preventDefault + 写盘完成后 destroy,保证退出前写入落盘(不丢状态)。
  // B2:转换进行中先拦截确认(直接销毁会令 send 抛 "Object has been destroyed",
  // 且 fs.writeFile 后中断可能留下半成品输出文件)
  win.on("close", (event) => {
    if (ctxByWebContents.has(win.webContents.id) && !closeAborts.has(win)) {
      event.preventDefault();
      void confirmCloseDuringConvert(win);
      return;
    }
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

/** 已进入「放弃转换并关闭」流程的窗口(close 事件放行标记;防轮询期间重复弹确认)。 */
const closeAborts = new WeakSet<BrowserWindow>();

/** 放弃转换后等待 ctx 释放(finally 删除)再关窗;超时强杀防卡死。 */
const CLOSE_ABORT_TIMEOUT_MS = 30_000;

/**
 * B2:关窗时转换进行中的确认弹窗。
 * 「继续转换」→ 不动作(窗口保留);「放弃并关闭」→ cancel 转换并等 finally
 * 释放 ctx(取消检查点在打印/写盘前后均有),正常路径重新 close;超时兜底 destroy。
 */
async function confirmCloseDuringConvert(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const choice = await dialog.showMessageBox(win, {
    type: "warning",
    title: t("close.confirmTitle"),
    message: t("close.confirmMessage"),
    buttons: [t("close.keepConverting"), t("close.abortAndClose")],
    defaultId: 0,
    cancelId: 0,
  });
  if (choice.response !== 1 || win.isDestroyed()) return;
  closeAborts.add(win);
  const id = win.webContents.id;
  ctxByWebContents.get(id)?.cancel();
  const deadline = Date.now() + CLOSE_ABORT_TIMEOUT_MS;
  while (ctxByWebContents.has(id) && Date.now() < deadline && !win.isDestroyed()) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (win.isDestroyed()) return;
  if (ctxByWebContents.has(id)) win.destroy();
  else win.close();
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
<head><meta charset="utf-8"><title>${t("preview.errorTitle")}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa; }
  .box { max-width: 480px; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; color: #333; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 13px; color: #666; margin: 0; word-break: break-all; }
</style></head>
<body><div class="box"><h1>${t("preview.errorTitle")}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
    /* B2:错误页加载失败(窗口恰被关闭等),静默即可,无进一步动作可做 */
  });
}

/**
 * 重渲染单个预览窗口:重读设置 + 源文件 → 渲染 → 写新临时文件 → loadFile。
 * 刷新成功后替换注册表清理函数(旧临时文件在新页面加载完成后清理)并更新 mtime;
 * 任何失败(含源文件缺失)→ 窗口内错误页。
 */
async function refreshPreviewWindow(entry: PreviewEntry): Promise<void> {
  if (entry.win.isDestroyed()) return;
  // B2:新临时文件清理函数提升到 try 外——失败路径(stat/loadFile 中断)也能回收,
  // 此前失败时新 tmp 引用丢失,临时 HTML 残留至进程退出
  let newCleanup: (() => Promise<void>) | null = null;
  try {
    const html = await renderPreviewHtml(entry.mdPath);
    const tmp = await writeTempHtml(html);
    newCleanup = tmp.cleanup;
    const oldCleanup = entry.cleanup;
    entry.cleanup = tmp.cleanup;
    // 渲染完成后再 stat:捕获渲染期间的最新 mtime,下次 focus 以新值对比
    const st = await fs.stat(entry.mdPath);
    entry.mtimeMs = st.mtimeMs;
    await entry.win.loadFile(tmp.htmlPath);
    await oldCleanup(); // 旧临时文件已不再被引用
  } catch (err) {
    await newCleanup?.().catch(() => undefined);
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
    showPreviewError(entry.win, t("preview.sourceMissing", { path: entry.mdPath }));
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
      title: t("preview.windowTitle", { name: baseName }),
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    hardenWebContents(win); // B1:预览 HTML 含用户 markdown 渲染的链接,导航收口
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
      title: t("dialog.openMarkdowns"),
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await saveUiState({ lastOpenDir: path.dirname(result.filePaths[0]!) }).catch(() => undefined); // length>0 已守卫
    }
    return result.canceled ? [] : result.filePaths;
  });

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示;用户取消返回 { ok:false, canceled:true }
  // B1:入参类型守卫(format 非 docx/pdf 时此前静默落 pdf 分支,现显式失败)
  ipcMain.handle("convert", async (event, filePath: unknown, format: unknown): Promise<ConvertResult> => {
    if (!isString(filePath) || !isConvertFormat(format)) {
      return { ok: false, error: t("common.invalidParams") };
    }
    return runWithCtx(
      event,
      async (ctx, win) => {
        const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
        const { outputPath, warnings } = await convertImpl(filePath, format, send, ctx, getKatexDir());
        await recordRecentFiles([filePath], format); // 批次 11:成功后记最近文件
        return { ok: true, outputPath, warnings };
      },
      () => ({ ok: false, canceled: true, error: t("common.canceled") }),
    );
  });

  // 取消当前窗口的转换(单文件/批量/合并通用;批量由 batchConvertImpl 内部检查)
  ipcMain.handle("convert:cancel", (event): void => {
    ctxByWebContents.get(event.sender.id)?.cancel();
  });

  // 选择输出目录(批次 7;取消返回 null);批次 11:defaultPath 记忆 + 成功后回写所选目录
  ipcMain.handle("dialog:selectDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: t("dialog.selectDir"),
      defaultPath: await lastOpenDirIfValid(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      await saveUiState({ lastOpenDir: result.filePaths[0] }).catch(() => undefined);
    }
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // 拖放路径收集:目录递归取 md,非 md 的传入路径进 skipped
  // B1:元素级校验(此前只 guard Array.isArray,非字符串元素会让 path.resolve 抛 TypeError)
  ipcMain.handle(
    "paths:collectMarkdown",
    (_event, paths: unknown): Promise<{ files: string[]; skipped: string[] }> => {
      return collectMarkdownPaths(isStringArray(paths) ? paths : []);
    },
  );

  // 批量转换:并发 2,失败不中断,进度走 batch:progress;取消由 batchConvertImpl 内部收集 canceledCount,
  // 不抛 ConvertCanceledError(onCanceled 分支为防御兜底,与 catch-all 归一一致)
  ipcMain.handle(
    "convert:batch",
    async (event, files: unknown, format: unknown): Promise<BatchResult | { ok: false; error: string }> => {
      if (!isStringArray(files) || !isConvertFormat(format)) {
        return { ok: false, error: t("common.invalidParams") };
      }
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
        () => ({ ok: false, error: t("common.canceled") }),
      );
    },
  );

  // 合并转换:多文件 → mergeMarkdowns → 单次 convert,输出 {首文件名}-合并.{ext}
  // 批次 7 补:进度走 convert:progress(与单文件同通道),renderer 的 runMerge 已订阅该事件;
  // 用户取消 → 返回 { ok:false, canceled:true }(与单文件 handler 一致,renderer 据此走取消分支)。
  ipcMain.handle("convert:merge", async (event, files: unknown, format: unknown): Promise<ConvertResult> => {
    if (!isStringArray(files) || !isConvertFormat(format)) {
      return { ok: false, error: t("common.invalidParams") };
    }
    return runWithCtx(
      event,
      async (ctx, win) => {
        const send = (stage: string): void => win?.webContents.send("convert:progress", { stage });
        const result = await mergeConvertImpl(files, format, send, ctx, getKatexDir());
        // 批次 11:合并成功 → 全部源文件均成功转换,逐个记最近文件
        if (result.ok) await recordRecentFiles(files, format);
        return result;
      },
      () => ({ ok: false, canceled: true, error: t("common.canceled") }),
    );
  });
  ipcMain.handle("settings:get", (): AppSettings => loadSettings());
  // 发版 1.0.0:界面版本信息(renderer header 显示;与「关于」对话框同源 app.getVersion)
  ipcMain.handle("app:version", (): string => app.getVersion());

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    return updateSettings(patch);
  });

  // 批次 13:导入模板预设 JSON(选文件 → 解析校验 → 同名覆盖合并 → 上限 10 → 持久化)。
  // 取消 → { ok:true, canceled:true };解析/读取异常 → { ok:false, error }(可读文案)
  ipcMain.handle("presets:import", async (): Promise<ImportPresetsResult> => {
    const result = await dialog.showOpenDialog({
      title: t("dialog.importPresets"),
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true };
    }
    try {
      const presetPath = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
      const text = await fs.readFile(presetPath, "utf8");
      const merged = importPresetsFromText(text, loadSettings().customPresets);
      if (!merged.ok) return { ok: false, error: merged.error };
      await updateSettings({ customPresets: merged.presets });
      // 与其它打开对话框一致:成功后记忆所选目录(下次默认打开位置)
      await saveUiState({ lastOpenDir: path.dirname(presetPath) }).catch(() => undefined);
      return {
        ok: true,
        canceled: false,
        imported: merged.imported,
        overridden: merged.overridden,
      };
    } catch (err) {
      return { ok: false, error: t("preset.readFailed", { error: errorMessage(err) }) };
    }
  });

  // 批次 13:导出全部自定义预设为 JSON(保存对话框;schemaVersion:1 包装,2 空格缩进)。
  // 空预设 main 侧前置拦截(renderer 侧可同样提示,两处一致);取消 → { ok:true, canceled:true }
  ipcMain.handle("presets:export", async (): Promise<ExportPresetsResult> => {
    const presets = loadSettings().customPresets;
    if (presets.length === 0) return { ok: false, error: t("preset.noneToExport") };
    const result = await dialog.showSaveDialog({
      title: t("dialog.exportPresets"),
      defaultPath: path.join(app.getPath("documents"), "presets.json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    try {
      const payload = buildPresetsExportPayload(presets);
      await fs.writeFile(result.filePath, payload, "utf8");
      return { ok: true, canceled: false, count: presets.length };
    } catch (err) {
      return { ok: false, error: t("preset.writeFailed", { error: errorMessage(err) }) };
    }
  });

  // 批次 16:导入 CSS 文件作为 PDF 样式模板(选文件 → 读内容 → 大小上限校验 → 返回内容+文件名)。
  // 内容由 renderer 经 settings:set 持久化到 settings.pdfCss(pdf 渲染时追加到默认样式后覆盖)。
  // 取消 → { ok:true, canceled:true };读取异常/超限 → { ok:false, error }(可读文案)
  ipcMain.handle("import:pdf-css", async (): Promise<ImportPdfCssResult> => {
    const result = await dialog.showOpenDialog({
      title: t("dialog.importPdfCss"),
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "CSS", extensions: ["css"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true };
    }
    try {
      const cssPath = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
      const css = await fs.readFile(cssPath, "utf8");
      if (Buffer.byteLength(css, "utf8") > MAX_PDF_CSS_BYTES) {
        return { ok: false, error: t("settings.cssTooLarge", { kb: MAX_PDF_CSS_BYTES / 1024 }) };
      }
      // 与其它打开对话框一致:成功后记忆所选目录(下次默认打开位置)
      await saveUiState({ lastOpenDir: path.dirname(cssPath) }).catch(() => undefined);
      return { ok: true, canceled: false, css, name: path.basename(cssPath) };
    } catch (err) {
      return { ok: false, error: t("preset.readFailed", { error: errorMessage(err) }) };
    }
  });

  // 批次 11:UI 状态读写(最近文件/会话文件/记忆目录/窗口位置/面板展开态;独立于 settings)
  ipcMain.handle("ui-state:get", (): UiState => loadUiState());
  ipcMain.handle("ui-state:set", (_event, patch: Partial<UiState>): Promise<UiState> => {
    return saveUiState(patch);
  });

  // 批次 11:会话恢复用——保序过滤仍存在的路径(缺失剔除,不打乱用户排列顺序)
  ipcMain.handle("paths:filterExisting", (_event, paths: unknown): Promise<string[]> => {
    return filterExistingPaths(isStringArray(paths) ? paths : []);
  });

  // 导出后行为:资源管理器中显示 / 默认程序打开(B1:入参类型守卫)
  ipcMain.handle("shell:reveal", (_event, filePath: unknown): void => {
    if (isString(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:open", async (_event, filePath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });

  // 预览:独立可见窗口展示与 PDF 同排版的 HTML(复用 renderPdfHtml),多窗口并发安全
  ipcMain.handle("preview:open", (_event, mdPath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(mdPath)) return Promise.resolve({ ok: false, error: t("common.invalidParams") });
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
    title: t("dialog.about.title"),
    message: t("dialog.about.message"),
    detail: t("dialog.about.detail", { version: app.getVersion() }),
    buttons: [t("common.ok")],
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
      label: t("menu.file"),
      submenu: [
        { label: t("menu.openFile"), click: openFromAppMenu },
        { type: "separator" },
        { label: t("menu.quit"), role: "quit" },
      ],
    },
    {
      label: t("menu.help"),
      submenu: [{ label: t("menu.about"), click: showAboutDialog }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- B2:进程级兜底(此前 rejection/异常静默进黑洞,排障无据) ---------- */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  // 桌面工具韧性优先:记录留痕不主动退出(状态不可续时用户可手动重启)
  console.error("[uncaughtException]", err);
});

// B2:单实例锁——双开实例各自持有 settings/uiState 内存缓存与独立写队列,后写覆盖
// 前写,用户感知为「预设和最近文件莫名其妙丢失」且无法归因。SMOKE 豁免:冒烟需与
// 开发实例并存运行。
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 已有实例时再次启动 → 聚焦既有主窗口(无则重建,darwin 关窗驻留场景)
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    // i18n:主进程语言来源 = 持久化设置(菜单/对话框标题/预览错误页按此语言)
    setLanguage(loadSettings().language);
    // B1:权限请求显式全拒(应用无相机/定位/通知等需求;默认拒绝之上显式声明,
    // 防未来新增窗口/webview 类型时遗漏收口)
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    buildAppMenu(); // 菜单先于窗口创建,窗口创建即带应用菜单(autoHideMenuBar 下 Alt 唤出)
    registerIpc();
    // B2:activate 先于首次 createWindow 注册(macOS 极早期 dock 点击不丢失)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
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
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
