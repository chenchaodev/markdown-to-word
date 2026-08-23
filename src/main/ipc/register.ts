/**
 * IPC 注册体(自 main/index.ts 抽取,行为零变化):全部 ipcMain.handle 注册 +
 * convert 系 handler 共用的 ctx 注册表与样板。
 * 依赖方向(单向,防循环):本模块 → windows/preview / converter / settings /
 * ui-state / ipc-logic;windows/main-window 反向 import 本模块的 ctxByWebContents
 * (关窗确认需查询转换进行中状态),故共享状态必须收敛于此而非窗口模块。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConvertFormat } from "../../core/convert.js";
import { t } from "../../core/i18n.js";
import {
  buildPresetsExportPayload,
  buildRecentFileEntries,
  errorMessage,
  importPresetsFromText,
  isConvertFormat,
  isString,
  isStringArray,
  runConvertTask,
} from "../ipc-logic.js";
import {
  loadSettings,
  updateSettings,
  MAX_PDF_CSS_BYTES,
  type AppSettings,
  type ExportPresetsResult,
  type ImportPdfCssResult,
  type ImportPresetsResult,
} from "../settings.js";
import {
  loadUiState,
  saveUiState,
  type UiState,
} from "../ui-state.js";
import {
  batchConvertImpl,
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
} from "../converter.js";
import { getKatexDir } from "../katex-dir.js";
import { IPC_CHANNELS as CH, type ConvertMode } from "../ipc-channels.js";
import { openPreviewWindow, previews, refreshPreviewWindow } from "../windows/preview.js";

/**
 * IPC 层持有各窗口进行中的转换 context(convert:cancel 入口按 webContents id 取,
 * 多窗口并发互不串扰,M3);转换完成/异常/取消后删除,避免悬挂引用。
 */
export const ctxByWebContents = new Map<number, ConvertContext>();

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

export function registerIpc(): void {
  // 选择多个 markdown 文件(批量/合并入口;取消返回 []);
  // 批次 11:defaultPath 记忆上次目录,成功后回写所选文件所在目录
  ipcMain.handle(CH.fileOpenDialog, async () => {
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
  ipcMain.handle(CH.convertSingle, async (event, filePath: unknown, format: unknown): Promise<ConvertResult> => {
    if (!isString(filePath) || !isConvertFormat(format)) {
      return { ok: false, error: t("common.invalidParams") };
    }
    return runWithCtx(
      event,
      async (ctx, win) => {
        // B12:progress payload 带 mode 标识,renderer 直接消费归属(不再按调用上下文推断)
        const send = (stage: string): void =>
          win?.webContents.send(CH.convertProgress, { stage, mode: "single" satisfies ConvertMode });
        const { outputPath, warnings } = await convertImpl(filePath, format, send, ctx, getKatexDir());
        await recordRecentFiles([filePath], format); // 批次 11:成功后记最近文件
        return { ok: true, outputPath, warnings };
      },
      () => ({ ok: false, canceled: true, error: t("common.canceled") }),
    );
  });

  // 取消当前窗口的转换(单文件/批量/合并通用;批量由 batchConvertImpl 内部检查)
  ipcMain.handle(CH.convertCancel, (event): void => {
    ctxByWebContents.get(event.sender.id)?.cancel();
  });

  // 选择输出目录(批次 7;取消返回 null);批次 11:defaultPath 记忆 + 成功后回写所选目录
  ipcMain.handle(CH.dirSelect, async (): Promise<string | null> => {
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
    CH.fileCollectMarkdown,
    (_event, paths: unknown): Promise<{ files: string[]; skipped: string[] }> => {
      return collectMarkdownPaths(isStringArray(paths) ? paths : []);
    },
  );

  // 批量转换:并发 2,失败不中断,进度走 convert:batchProgress;取消由 batchConvertImpl 内部收集 canceledCount,
  // 不抛 ConvertCanceledError(onCanceled 分支为防御兜底,与 catch-all 归一一致)
  ipcMain.handle(
    CH.convertBatch,
    async (event, files: unknown, format: unknown): Promise<BatchResult | { ok: false; error: string }> => {
      if (!isStringArray(files) || !isConvertFormat(format)) {
        return { ok: false, error: t("common.invalidParams") };
      }
      return runWithCtx(
        event,
        async (ctx, win) => {
          const send = (info: BatchProgressInfo): void =>
            win?.webContents.send(CH.convertBatchProgress, info);
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
  ipcMain.handle(CH.convertMerge, async (event, files: unknown, format: unknown): Promise<ConvertResult> => {
    if (!isStringArray(files) || !isConvertFormat(format)) {
      return { ok: false, error: t("common.invalidParams") };
    }
    return runWithCtx(
      event,
      async (ctx, win) => {
        // B12:与单文件同通道,payload.mode = "merge" 区分归属
        const send = (stage: string): void =>
          win?.webContents.send(CH.convertProgress, { stage, mode: "merge" satisfies ConvertMode });
        const result = await mergeConvertImpl(files, format, send, ctx, getKatexDir());
        // 批次 11:合并成功 → 全部源文件均成功转换,逐个记最近文件
        if (result.ok) await recordRecentFiles(files, format);
        return result;
      },
      () => ({ ok: false, canceled: true, error: t("common.canceled") }),
    );
  });
  ipcMain.handle(CH.settingsGet, (): AppSettings => loadSettings());
  // 发版 1.0.0:界面版本信息(renderer header 显示;与「关于」对话框同源 app.getVersion)
  ipcMain.handle(CH.appVersion, (): string => app.getVersion());

  ipcMain.handle(CH.settingsSet, (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    return updateSettings(patch);
  });

  // 批次 13:导入模板预设 JSON(选文件 → 解析校验 → 同名覆盖合并 → 上限 10 → 持久化)。
  // 取消 → { ok:true, canceled:true };解析/读取异常 → { ok:false, error }(可读文案)
  ipcMain.handle(CH.presetsImport, async (): Promise<ImportPresetsResult> => {
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
  ipcMain.handle(CH.presetsExport, async (): Promise<ExportPresetsResult> => {
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
  ipcMain.handle(CH.cssImport, async (): Promise<ImportPdfCssResult> => {
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
  ipcMain.handle(CH.uiStateGet, (): UiState => loadUiState());
  ipcMain.handle(CH.uiStateSet, (_event, patch: Partial<UiState>): Promise<UiState> => {
    return saveUiState(patch);
  });

  // 批次 11:会话恢复用——保序过滤仍存在的路径(缺失剔除,不打乱用户排列顺序)
  ipcMain.handle(CH.fileFilterExisting, (_event, paths: unknown): Promise<string[]> => {
    return filterExistingPaths(isStringArray(paths) ? paths : []);
  });

  // 导出后行为:资源管理器中显示 / 默认程序打开(B1:入参类型守卫)
  ipcMain.handle(CH.shellRevealInFolder, (_event, filePath: unknown): void => {
    if (isString(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle(CH.shellOpenPath, async (_event, filePath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });

  // 预览:独立可见窗口展示与 PDF 同排版的 HTML(复用 renderPdfHtml),多窗口并发安全
  ipcMain.handle(CH.previewOpen, (_event, mdPath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(mdPath)) return Promise.resolve({ ok: false, error: t("common.invalidParams") });
    return openPreviewWindow(mdPath);
  });

  // 批次 11 迭代 3:设置变更后刷新所有预览窗口(renderer 在 settingsSet 成功后调用;
  // 无预览窗口时为空操作;刷新失败在窗口内显示错误页,不影响主窗口)
  ipcMain.handle(CH.previewRefresh, (): void => {
    for (const entry of previews) void refreshPreviewWindow(entry);
  });
}
