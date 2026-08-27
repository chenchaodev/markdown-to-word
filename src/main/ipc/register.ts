/**
 * IPC 注册体(自 main/index.ts 抽取,行为零变化):全部 ipcMain.handle 注册 +
 * convert 系 handler 共用的 ctx 注册表与样板。
 * 依赖方向(单向,防循环):本模块 → windows/preview、windows/web-contents-registry
 * (ctxByWebContents 注册表,MR-9 自本模块下沉)/ converter / persist /
 * services / logic;窗口层不再反向依赖本模块。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConvertFormat } from "../../core/convert.js";
import { t } from "../../core/i18n.js";
import { precheckMarkdown } from "../../core/markdown/precheck.js";
import type { ConvertWarning } from "../../core/i18n.js";
import {
  buildPresetsExportPayload,
  buildRecentFileEntries,
  errorMessage,
  importPresetsFromText,
  isConvertFormat,
  isString,
  isStringArray,
  runConvertTask,
} from "./logic.js";
import {
  loadSettings,
  updateSettings,
  MAX_PDF_CSS_BYTES,
  type AppSettings,
  type ExportPresetsResult,
  type ImportDocxTemplateResult,
  type ImportPdfCssResult,
  type ImportPresetsResult,
} from "../persist/settings.js";
import {
  loadUiState,
  saveUiState,
  type UiState,
} from "../persist/ui-state.js";
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
} from "../converter/index.js";
import { getKatexDir } from "../services/resource-dirs.js";
import { importDocxTemplate } from "../../core/docx/template-import.js";
import { getMainWindow } from "../windows/main-window.js";
import { isThemePreference, syncTitleBarOverlay } from "../windows/title-bar-overlay.js";
import { IPC_CHANNELS as CH, type ConvertMode } from "./channels.js";
import { openPreviewWindow, previews, refreshPreviewWindow } from "../windows/preview.js";
import { ctxByWebContents } from "../windows/web-contents-registry.js";

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

/**
 * 导入类 handler 共用模板(MR-7 自 presetsImport/cssImport 同构流程抽出):
 * 打开对话框(取消 → { ok:true, canceled:true })→ readFile → process 校验/持久化
 * → 成功后记忆所选目录 → catch 归一为可读文案。process 返回 ok:false 时跳过目录记忆。
 */
async function importFileViaDialog<T extends ImportPresetsResult | ImportPdfCssResult>(options: {
  title: string;
  filters: { name: string; extensions: string[] }[];
  process: (text: string, filePath: string) => Promise<T>;
}): Promise<T> {
  const result = await dialog.showOpenDialog({
    title: options.title,
    defaultPath: await lastOpenDirIfValid(),
    filters: options.filters,
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    // 两个结果联合类型均含 { ok:true, canceled:true } 分支,此处收窄安全
    return { ok: true, canceled: true } as T;
  }
  try {
    const filePath = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
    const text = await fs.readFile(filePath, "utf8");
    const out = await options.process(text, filePath);
    if (out.ok) {
      // 与其它打开对话框一致:成功后记忆所选目录(下次默认打开位置)
      await saveUiState({ lastOpenDir: path.dirname(filePath) }).catch(() => undefined);
    }
    return out;
  } catch (err) {
    return { ok: false, error: t("preset.readFailed", { error: errorMessage(err) }) } as T;
  }
}

/* ---------- MR-12 加固:shell.openPath/showItemInFolder 白名单 ----------
 * 仅允许本会话成功转换产物的输出路径(各转换 handler 成功时登记)。被攻破的
 * renderer 原本可借主进程打开任意文件;白名单外路径拒绝并返回错误,renderer
 * 走既有错误提示通道展示。会话级集合即可覆盖全部合法入口(弹窗/汇总条的
 * 路径均来自当次转换结果);应用重启后 renderer 侧缓存同样清零,无合法场景受损。 */
const allowedOutputPaths = new Set<string>();

function allowOutputPath(outputPath: string): void {
  allowedOutputPaths.add(outputPath);
}

function isAllowedOutputPath(p: string): boolean {
  return allowedOutputPaths.has(p);
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
        allowOutputPath(outputPath); // MR-12:产物路径入 shell 白名单
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

  // F6:转换前静态预检(读取 → 解析 → 扫描;返回 ConvertWarning[])。
  // 仅读取与解析,不触发实际渲染;文件不可读时返回 [] 交由转换自身报错,不阻断流程。
  ipcMain.handle(
    CH.convertPrecheck,
    async (_event, filePath: unknown): Promise<ConvertWarning[]> => {
      if (!isString(filePath)) return [];
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf8");
      } catch {
        return [];
      }
      return precheckMarkdown(content, path.dirname(filePath));
    },
  );

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

  // F4:选择页眉 logo 图片(限图片扩展名;取消返回 null)。
  // 与 dirSelect 同样板记忆 lastOpenDir,便于连续选择同目录资源
  ipcMain.handle(CH.headerLogoSelect, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: t("dialog.selectHeaderLogo"),
      defaultPath: await lastOpenDirIfValid(),
      properties: ["openFile"],
      filters: [
        { name: t("dialog.imageFiles"), extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
      ],
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
          // MR-12:成功项产物路径入 shell 白名单
          for (const item of result.items) {
            if (item.ok && item.outputPath) allowOutputPath(item.outputPath);
          }
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
        if (result.ok) {
          if (result.outputPath) allowOutputPath(result.outputPath); // MR-12:产物路径入 shell 白名单
          await recordRecentFiles(files, format);
        }
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

  // 界面重构 v3:标题栏 overlay 配色同步(renderer 主题变更后调用;主题主动方是
  // renderer,main 只负责原生 overlay 绘制)。入参守卫:非法值警告留痕不静默
  // (配色失同步可感知但不致命,不值得走错误弹窗打断主题切换)。
  ipcMain.handle(CH.themeSyncOverlay, (_event, theme: unknown): void => {
    if (!isThemePreference(theme)) {
      console.warn("[main] theme:syncOverlay 收到非法主题值:", theme);
      return;
    }
    syncTitleBarOverlay(getMainWindow(), theme);
  });

  // 批次 13:导入模板预设 JSON(选文件 → 解析校验 → 同名覆盖合并 → 上限 10 → 持久化)。
  // 取消 → { ok:true, canceled:true };解析/读取异常 → { ok:false, error }(可读文案)
  // MR-7:对话框/读文件/记目录/catch 样板收敛 importFileViaDialog
  ipcMain.handle(CH.presetsImport, (): Promise<ImportPresetsResult> =>
    importFileViaDialog({
      title: t("dialog.importPresets"),
      filters: [{ name: "JSON", extensions: ["json"] }],
      process: async (text) => {
        const merged = importPresetsFromText(text, loadSettings().customPresets);
        if (!merged.ok) return { ok: false, error: merged.error };
        await updateSettings({ customPresets: merged.presets });
        return {
          ok: true,
          canceled: false,
          imported: merged.imported,
          overridden: merged.overridden,
        };
      },
    }),
  );

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
  // MR-7:对话框/读文件/记目录/catch 样板收敛 importFileViaDialog
  ipcMain.handle(CH.cssImport, (): Promise<ImportPdfCssResult> =>
    importFileViaDialog({
      title: t("dialog.importPdfCss"),
      filters: [{ name: "CSS", extensions: ["css"] }],
      process: async (css, cssPath) => {
        if (Buffer.byteLength(css, "utf8") > MAX_PDF_CSS_BYTES) {
          return { ok: false, error: t("settings.cssTooLarge", { kb: MAX_PDF_CSS_BYTES / 1024 }) };
        }
        return { ok: true, canceled: false, css, name: path.basename(cssPath) };
      },
    }),
  );

  // F9:导入 Word 模板(.docx,浅导入 v1,ADR-008):选文件 → 读字节 → 解包提取样式/页面
  // → 与现有设置合并(typography/pageSetup 各自深合并)→ 持久化 → 返回合并后完整对象。
  // 取消 → { ok:true, canceled:true };读取/解析异常 → { ok:false, error }(可读文案)
  ipcMain.handle(CH.templateImportDocx, async (): Promise<ImportDocxTemplateResult> => {
    const result = await dialog.showOpenDialog({
      title: t("dialog.importDocxTemplate"),
      defaultPath: await lastOpenDirIfValid(),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true };
    }
    try {
      const filePath = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
      const buf = await fs.readFile(filePath);
      const partial = await importDocxTemplate(new Uint8Array(buf));
      const settings = loadSettings();
      const merged = {
        typography: { ...settings.typography, ...partial.typography },
        pageSetup: { ...settings.pageSetup, ...partial.pageSetup },
      };
      await updateSettings({ typography: merged.typography, pageSetup: merged.pageSetup });
      await saveUiState({ lastOpenDir: path.dirname(filePath) }).catch(() => undefined);
      return { ok: true, canceled: false, typography: merged.typography, pageSetup: merged.pageSetup };
    } catch (err) {
      return { ok: false, error: t("template.readFailed", { error: errorMessage(err) }) };
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

  // 导出后行为:资源管理器中显示 / 默认程序打开(B1:入参类型守卫)。
  // MR-12:仅允许本会话转换产物白名单内的路径;拒绝时返回 { ok:false, error }
  // (revealInFolder 签名由 void 改为结果对象,renderer 据此走既有错误提示通道)。
  ipcMain.handle(CH.shellRevealInFolder, (_event, filePath: unknown): { ok: boolean; error?: string } => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    if (!isAllowedOutputPath(filePath)) return { ok: false, error: t("shell.notAllowed") };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle(CH.shellOpenPath, async (_event, filePath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    if (!isAllowedOutputPath(filePath)) return { ok: false, error: t("shell.notAllowed") }; // MR-12 白名单
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
