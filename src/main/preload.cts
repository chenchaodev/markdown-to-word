// preload:CJS 输出(preload.cjs),沙箱兼容;contextBridge 白名单暴露 API
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings } from "./settings.js";
import type { UiState } from "./ui-state.js";

contextBridge.exposeInMainWorld("api", {
  /** 拖放取路径:File.path 已随 Electron 32+ 移除,须经 webUtils 解析(勿回退) */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  openMarkdowns: (): Promise<string[]> => ipcRenderer.invoke("dialog:openMarkdowns"),
  /** 批次 7:选择输出目录(取消返回 null) */
  selectDir: (): Promise<string | null> => ipcRenderer.invoke("dialog:selectDir"),
  /** 批次 7:取消当前转换(单文件/批量/合并通用) */
  convertCancel: (): Promise<void> => ipcRenderer.invoke("convert:cancel"),
  collectMarkdowns: (paths: string[]): Promise<{ files: string[]; skipped: string[] }> =>
    ipcRenderer.invoke("paths:collectMarkdown", paths),
  convert: (filePath: string, format: "docx" | "pdf") => ipcRenderer.invoke("convert", filePath, format),
  convertBatch: (files: string[], format: "docx" | "pdf") =>
    ipcRenderer.invoke("convert:batch", files, format),
  convertMerge: (files: string[], format: "docx" | "pdf") =>
    ipcRenderer.invoke("convert:merge", files, format),
  onConvertProgress: (cb: (stage: string) => void): (() => void) => {
    const listener = (_event: unknown, data: { stage: string }): void => cb(data.stage);
    ipcRenderer.on("convert:progress", listener);
    return () => {
      ipcRenderer.removeListener("convert:progress", listener);
    };
  },
  onBatchProgress: (cb: (info: { index: number; total: number; file: string; stage: string }) => void): (() => void) => {
    const listener = (_event: unknown, data: { index: number; total: number; file: string; stage: string }): void =>
      cb(data);
    ipcRenderer.on("batch:progress", listener);
    return () => {
      ipcRenderer.removeListener("batch:progress", listener);
    };
  },
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke("settings:set", patch),
  /** 批次 11:读取 UI 状态(最近文件/会话文件/记忆目录/窗口位置/面板展开态)。 */
  uiStateGet: (): Promise<UiState> => ipcRenderer.invoke("ui-state:get"),
  /** 批次 11:局部更新 UI 状态并持久化,返回合并后的完整状态。 */
  uiStateSet: (patch: Partial<UiState>): Promise<UiState> => ipcRenderer.invoke("ui-state:set", patch),
  /** 批次 11:保序过滤仍存在的路径(会话文件逐项校验,缺失剔除)。 */
  filterExistingPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke("paths:filterExisting", paths),
  revealInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke("shell:reveal", filePath),
  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("shell:open", filePath),
  openPreview: (mdPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("preview:open", mdPath),
  /** 批次 11 迭代 3:刷新所有预览窗口(设置变更后调用;无预览窗口时为空操作)。 */
  previewRefresh: (): Promise<void> => ipcRenderer.invoke("preview:refresh"),
  /** 批次 11 迭代 4:应用菜单「文件 → 打开文件…」触发(renderer 复用现有选择链路)。 */
  onMenuOpen: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("menu:open", listener);
    return () => {
      ipcRenderer.removeListener("menu:open", listener);
    };
  },
});
