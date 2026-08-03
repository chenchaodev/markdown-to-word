// preload:CJS 输出(preload.cjs),沙箱兼容;contextBridge 白名单暴露 API
import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "./settings.js";

contextBridge.exposeInMainWorld("api", {
  openMarkdownDialog: (): Promise<string | null> => ipcRenderer.invoke("dialog:openMarkdown"),
  convert: (filePath: string, format: "docx" | "pdf") => ipcRenderer.invoke("convert", filePath, format),
  onConvertProgress: (cb: (stage: string) => void): (() => void) => {
    const listener = (_event: unknown, data: { stage: string }): void => cb(data.stage);
    ipcRenderer.on("convert:progress", listener);
    return () => {
      ipcRenderer.removeListener("convert:progress", listener);
    };
  },
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke("settings:set", patch),
  revealInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke("shell:reveal", filePath),
  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("shell:open", filePath),
  openPreview: (mdPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("preview:open", mdPath),
});
