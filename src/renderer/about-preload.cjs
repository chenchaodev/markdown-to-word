const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("aboutApi", {
  openExternal: (url) => ipcRenderer.invoke("about:open-external", url),
  checkUpdate: () => ipcRenderer.invoke("about:check-update"),
});
