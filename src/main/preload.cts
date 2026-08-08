// preload:CJS 输出(preload.cjs),沙箱兼容;contextBridge 白名单暴露 API
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings } from "./settings.js";

contextBridge.exposeInMainWorld("api", {
  /** 拖放取路径:File.path 已随 Electron 32+ 移除,须经 webUtils 解析(勿回退) */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  openMarkdownDialog: (): Promise<string | null> => ipcRenderer.invoke("dialog:openMarkdown"),
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
  revealInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke("shell:reveal", filePath),
  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("shell:open", filePath),
  openPreview: (mdPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("preview:open", mdPath),
});
