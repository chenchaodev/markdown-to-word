// preload:CJS 输出(preload.cjs),沙箱兼容;contextBridge 白名单暴露 API
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  openMarkdownDialog: (): Promise<string | null> => ipcRenderer.invoke("dialog:openMarkdown"),
});
