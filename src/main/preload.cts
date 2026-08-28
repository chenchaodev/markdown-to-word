// preload:CJS 输出(preload.cjs),沙箱兼容;contextBridge 白名单暴露 API
// B12:channel 名单源在 ./ipc/channels.ts;本文件因沙箱隔离(sandbox:true 下
// preload.cjs 运行时只能 require electron,不能加载本项目 ESM 模块)无法直接
// import,侧内镜像同名常量,漂移由 test/segments/ipc-channels.test.js 恒等断言兜底。
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings, ExportPresetsResult, ImportDocxTemplateResult, ImportPdfCssResult, ImportPresetsResult } from "./persist/settings.js";
import type { ConvertWarning } from "../core/i18n.js";
import type { ConvertProgressPayload } from "./ipc/channels.js";
import type { UiState } from "./persist/ui-state.js";
// MR-4:批量进度 payload 类型单源 converter/batch.ts(原内联 shape 三份镜像清零)
import type { BatchProgressInfo, BatchResult } from "./converter/batch.js";
import type { ConvertResult } from "./converter/merge.js";

/** IPC channel 名镜像(与 src/main/ipc/channels.ts IPC_CHANNELS 逐键同值,勿单侧改动)。 */
const CH = {
  fileOpenDialog: "file:openDialog",
  fileCollectMarkdown: "file:collectMarkdown",
  fileFilterExisting: "file:filterExisting",
  dirSelect: "dir:select",
  headerLogoSelect: "header-logo:select",
  convertSingle: "convert:single",
  convertBatch: "convert:batch",
  convertMerge: "convert:merge",
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

// MR-5:api 对象提为具名 const,实现即契约——renderer.ts 的 window.api 类型由
// PreloadApi 推导(preload 改签名时 renderer 调用点编译期暴露,不再手工第三镜像);
// channel 名恒等测试(ipc-channels.test.js)保留。
const api = {
  /** 拖放取路径:File.path 已随 Electron 32+ 移除,须经 webUtils 解析(勿回退) */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** 多选文件对话框,返回所选文件路径数组;空数组 = 用户取消。 */
  openMarkdowns: (): Promise<string[]> => ipcRenderer.invoke(CH.fileOpenDialog),
  /** 批次 7:选择输出目录(取消返回 null) */
  selectDir: (): Promise<string | null> => ipcRenderer.invoke(CH.dirSelect),
  /** F4:选择页眉 logo 图片(限图片扩展名;取消返回 null) */
  selectHeaderLogo: (): Promise<string | null> => ipcRenderer.invoke(CH.headerLogoSelect),
  /** 批次 7:取消当前转换(单文件/批量/合并通用) */
  convertCancel: (): Promise<void> => ipcRenderer.invoke(CH.convertCancel),
  /** 展开拖入路径(文件 + 文件夹递归),过滤出 Markdown 文件;skipped 为被跳过的项。 */
  collectMarkdowns: (paths: string[]): Promise<{ files: string[]; skipped: string[] }> =>
    ipcRenderer.invoke(CH.fileCollectMarkdown, paths),
  // MR-5:三个转换方法显式返回类型(原依赖 renderer 手工镜像兜底,现实现即契约)
  convert: (filePath: string, format: "docx" | "pdf"): Promise<ConvertResult> =>
    ipcRenderer.invoke(CH.convertSingle, filePath, format),
  convertBatch: (files: string[], format: "docx" | "pdf"): Promise<BatchResult> =>
    ipcRenderer.invoke(CH.convertBatch, files, format),
  convertMerge: (files: string[], format: "docx" | "pdf"): Promise<ConvertResult> =>
    ipcRenderer.invoke(CH.convertMerge, files, format),
  // F6:转换前静态预检;main 读文件 + 解析 + 扫描,返回 ConvertWarning[]
  precheck: (filePath: string): Promise<ConvertWarning[]> => ipcRenderer.invoke(CH.convertPrecheck, filePath),
  // B12:payload 带 mode 标识(single/batch/merge),renderer 直接消费归属
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
  /** 界面重构 v3:主题变更后通知 main 同步 Windows 标题栏 overlay 配色
   *  (传主题偏好;system 由 main 经 nativeTheme 解析实际生效主题)。 */
  syncTitleBarOverlay: (theme: "system" | "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke(CH.themeSyncOverlay, theme),
  /** 发版 1.0.0:应用版本号(header 显示,与「关于」对话框同源)。 */
  getVersion: (): Promise<string> => ipcRenderer.invoke(CH.appVersion),
  /** 批次 13:导入模板预设 JSON(选文件 → 校验合并 → 持久化);取消 → { ok:true, canceled:true } */
  importPresets: (): Promise<ImportPresetsResult> => ipcRenderer.invoke(CH.presetsImport),
  /** 批次 13:导出全部自定义预设为 JSON(保存对话框);无预设 → { ok:false, error } */
  exportPresets: (): Promise<ExportPresetsResult> => ipcRenderer.invoke(CH.presetsExport),
  /** 批次 16:导入 CSS 文件作为 PDF 样式模板(选文件 → 读内容 → 返回 css+文件名);
   *  取消 → { ok:true, canceled:true };超限/读取失败 → { ok:false, error } */
  importPdfCss: (): Promise<ImportPdfCssResult> => ipcRenderer.invoke(CH.cssImport),
  /** F9:导入 Word 模板(.docx,浅导入 v1):选文件 → 解包提取样式/页面 → 合并持久化;
   *  取消 → { ok:true, canceled:true };解析/读取失败 → { ok:false, error } */
  importDocxTemplate: (): Promise<ImportDocxTemplateResult> => ipcRenderer.invoke(CH.templateImportDocx),
  /** 批次 11:读取 UI 状态(最近文件/会话文件/记忆目录/窗口位置/面板展开态)。 */
  uiStateGet: (): Promise<UiState> => ipcRenderer.invoke(CH.uiStateGet),
  /** 批次 11:局部更新 UI 状态并持久化,返回合并后的完整状态。 */
  uiStateSet: (patch: Partial<UiState>): Promise<UiState> => ipcRenderer.invoke(CH.uiStateSet, patch),
  /** 批次 11:保序过滤仍存在的路径(会话文件逐项校验,缺失剔除)。 */
  filterExistingPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke(CH.fileFilterExisting, paths),
  /** 在资源管理器中显示目标文件(MR-12:仅限本会话转换产物白名单;
   *  白名单外/失败返回 { ok:false, error },renderer 走既有错误提示通道)。 */
  revealInFolder: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.shellRevealInFolder, filePath),
  /** 用系统默认程序打开目标文件(MR-12:仅限本会话转换产物白名单);失败返回 { ok: false, error }。 */
  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.shellOpenPath, filePath),
  openPreview: (mdPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.previewOpen, mdPath),
  /** 批次 11 迭代 3:刷新所有预览窗口(设置变更后调用;无预览窗口时为空操作)。 */
  previewRefresh: (): Promise<void> => ipcRenderer.invoke(CH.previewRefresh),
  /** 批次 11 迭代 4:应用菜单「文件 → 打开文件…」触发(renderer 复用现有选择链路)。 */
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

/** preload 暴露面类型单源(MR-5):renderer.ts 经 `import type` 推导 window.api 形状。 */
export type PreloadApi = typeof api;
