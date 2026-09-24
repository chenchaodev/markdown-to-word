const { contextBridge, ipcRenderer } = require("electron");
// channel 名单源在 src/main/ipc/channels.ts;本文件为纯 CJS preload,无法 import
// ESM 单源模块,侧内镜像 about 域键(同 preload.cts 手法),漂移由
// test/segments/ipc-channels.test.js 对 dist 两侧提取恒等断言兜底。
const CH = {
  aboutOpenExternal: "about:open-external",
  aboutCheckUpdate: "about:check-update",
};
contextBridge.exposeInMainWorld("aboutApi", {
  openExternal: (url) => ipcRenderer.invoke(CH.aboutOpenExternal, url),
  checkUpdate: () => ipcRenderer.invoke(CH.aboutCheckUpdate),
});
