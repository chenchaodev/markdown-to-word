/**
 * preload 组合根:沙箱隔离下经 contextBridge 向 renderer 暴露受控 API。
 * 不变量:channel 名与 ./ipc/channels.ts 逐键同值,勿单侧改动。
 */
// channel 名单源在 ./ipc/channels.ts;本文件因沙箱隔离(sandbox:true 下
// preload.cjs 运行时只能 require electron,不能加载本项目 ESM 模块)无法直接
// import,侧内镜像同名常量,漂移由 test/segments/ipc-channels.test.js 恒等断言兜底。
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings, ExportPresetsResult, ImportDocxTemplateResult, ImportPdfCssResult, ImportPresetsResult } from "./persist/settings.js";
import type { ConvertWarning } from "../core/i18n.js";
import type { ConvertProgressPayload } from "./ipc/channels.js";
import type { ClipboardReadResult } from "./ipc/types.js";
import type { UiState } from "./persist/ui-state.js";
// 批量进度 payload 类型单源 converter/batch.ts(原内联 shape 三份镜像清零)
import type { BatchProgressInfo, BatchResult } from "./converter/batch.js";
import type { ConvertResult } from "./converter/merge.js";
import type { DocMetadata } from "../core/pipeline/frontmatter.js";

/** IPC channel 名镜像(与 src/main/ipc/channels.ts IPC_CHANNELS 逐键同值,勿单侧改动)。 */
const CH = {
  fileOpenDialog: "file:openDialog",
  fileCollectMarkdown: "file:collectMarkdown",
  readFrontmatter: "file:readFrontmatter",
  fileFilterExisting: "file:filterExisting",
  dirSelect: "dir:select",
  headerLogoSelect: "header-logo:select",
  convertSingle: "convert:single",
  convertBatch: "convert:batch",
  convertMerge: "convert:merge",
  clipboardRead: "clipboard:read",
  convertCancel: "convert:cancel",
  convertProgress: "convert:progress",
  convertBatchProgress: "convert:batchProgress",
  convertPrecheck: "convert:precheck",
  presetsImport: "presets:import",
  presetsExport: "presets:export",
  cssImport: "css:import",
  templateImportDocx: "template:importDocx",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  themeSyncOverlay: "theme:syncOverlay",
  uiStateGet: "ui-state:get",
  uiStateSet: "ui-state:set",
  appVersion: "app:version",
  shellRevealInFolder: "shell:revealInFolder",
  shellOpenPath: "shell:openPath",
  previewOpen: "preview:open",
  previewRefresh: "preview:refresh",
  menuOpen: "menu:open",
  /** 打开「关于」窗口(标题栏按钮触发) */
  aboutOpen: "about:open",
} as const;

// api 对象提为具名 const,实现即契约——renderer.ts 的 window.api 类型由
// PreloadApi 推导(preload 改签名时 renderer 调用点编译期暴露,不再手工第三镜像);
// channel 名恒等测试(ipc-channels.test.js)保留。
const api = {
  /** 拖放取路径:File.path 已随 Electron 32+ 移除,须经 webUtils 解析(勿回退) */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** 多选文件对话框,返回所选文件路径数组;空数组 = 用户取消。 */
  openMarkdowns: (): Promise<string[]> => ipcRenderer.invoke(CH.fileOpenDialog),
  /** 取消返回 null */
  selectDir: (): Promise<string | null> => ipcRenderer.invoke(CH.dirSelect),
  /** 限图片扩展名;取消返回 null */
  selectHeaderLogo: (): Promise<string | null> => ipcRenderer.invoke(CH.headerLogoSelect),
  /** 单文件/批量/合并通用 */
  convertCancel: (): Promise<void> => ipcRenderer.invoke(CH.convertCancel),
  /** 展开拖入路径(文件 + 文件夹递归),过滤出 Markdown 文件;skipped 为被跳过的项。 */
  collectMarkdowns: (paths: string[]): Promise<{ files: string[]; skipped: string[] }> =>
    ipcRenderer.invoke(CH.fileCollectMarkdown, paths),
  // 三个转换方法显式返回类型(实现即契约,不再依赖 renderer 手工镜像兜底)
  convert: (filePath: string, format: "docx" | "pdf"): Promise<ConvertResult> =>
    ipcRenderer.invoke(CH.convertSingle, filePath, format),
  convertBatch: (files: string[], format: "docx" | "pdf"): Promise<BatchResult> =>
    ipcRenderer.invoke(CH.convertBatch, files, format),
  convertMerge: (
    files: string[],
    format: "docx" | "pdf",
    options?: { metadata?: DocMetadata },
  ): Promise<ConvertResult> => ipcRenderer.invoke(CH.convertMerge, files, format, options),
  /** 读取单文件 frontmatter 元数据(向导封面预填用) */
  readFrontmatter: (filePath: string): Promise<DocMetadata> =>
    ipcRenderer.invoke(CH.readFrontmatter, filePath),
  /** 读取系统剪贴板:文本写临时 md 返回路径,或返回文件路径,或 empty */
  clipboardRead: (): Promise<ClipboardReadResult> => ipcRenderer.invoke(CH.clipboardRead),
  // 转换前静态预检:main 读文件 + 解析 + 扫描,返回 ConvertWarning[]
  precheck: (filePath: string): Promise<ConvertWarning[]> => ipcRenderer.invoke(CH.convertPrecheck, filePath),
  // payload 带 mode 标识(single/batch/merge),renderer 直接消费归属
  onConvertProgress: (cb: (info: ConvertProgressPayload) => void): (() => void) => {
    const listener = (_event: unknown, data: ConvertProgressPayload): void => cb(data);
    ipcRenderer.on(CH.convertProgress, listener);
    return () => {
      ipcRenderer.removeListener(CH.convertProgress, listener);
    };
  },
  onBatchProgress: (cb: (info: BatchProgressInfo) => void): (() => void) => {
    const listener = (_event: unknown, data: BatchProgressInfo): void =>
      cb(data);
    ipcRenderer.on(CH.convertBatchProgress, listener);
    return () => {
      ipcRenderer.removeListener(CH.convertBatchProgress, listener);
    };
  },
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsGet),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsSet, patch),
  /** 主题变更后通知 main 同步 Windows 标题栏 overlay 配色
   *  (传主题偏好;system 由 main 经 nativeTheme 解析实际生效主题)。 */
  syncTitleBarOverlay: (theme: "system" | "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke(CH.themeSyncOverlay, theme),
  /** 应用版本号(header 显示,与「关于」对话框同源)。 */
  getVersion: (): Promise<string> => ipcRenderer.invoke(CH.appVersion),
  /** 取消 → { ok:true, canceled:true } */
  importPresets: (): Promise<ImportPresetsResult> => ipcRenderer.invoke(CH.presetsImport),
  /** 无预设 → { ok:false, error } */
  exportPresets: (): Promise<ExportPresetsResult> => ipcRenderer.invoke(CH.presetsExport),
  /** 取消 → { ok:true, canceled:true };超限/读取失败 → { ok:false, error } */
  importPdfCss: (): Promise<ImportPdfCssResult> => ipcRenderer.invoke(CH.cssImport),
  /** 取消 → { ok:true, canceled:true };解析/读取失败 → { ok:false, error } */
  importDocxTemplate: (): Promise<ImportDocxTemplateResult> => ipcRenderer.invoke(CH.templateImportDocx),
  uiStateGet: (): Promise<UiState> => ipcRenderer.invoke(CH.uiStateGet),
  uiStateSet: (patch: Partial<UiState>): Promise<UiState> => ipcRenderer.invoke(CH.uiStateSet, patch),
  /** 逐项校验,缺失剔除(保序)。 */
  filterExistingPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke(CH.fileFilterExisting, paths),
  /** 安全边界:仅放行本会话转换产物,防被攻破的 renderer 打开任意文件;
   *  白名单外/失败返回 { ok:false, error },renderer 走既有错误提示通道。 */
  revealInFolder: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.shellRevealInFolder, filePath),
  /** 安全边界:仅放行本会话转换产物,防被攻破的 renderer 打开任意文件;失败返回 { ok: false, error }。 */
  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.shellOpenPath, filePath),
  openPreview: (mdPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.previewOpen, mdPath),
  /** 无预览窗口时为空操作。 */
  previewRefresh: (): Promise<void> => ipcRenderer.invoke(CH.previewRefresh),
  onMenuOpen: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.menuOpen, listener);
    return () => {
      ipcRenderer.removeListener(CH.menuOpen, listener);
    };
  },
  /** 标题栏「关于」按钮 → 打开关于窗口(无返回值,fire-and-forget) */
  openAbout: (): void => {
    ipcRenderer.send(CH.aboutOpen);
  },
};

contextBridge.exposeInMainWorld("api", api);

/** preload 暴露面类型单源:renderer.ts 经 `import type` 推导 window.api 形状。 */
export type PreloadApi = typeof api;
