/**
 * 关于窗 preload:与主窗 preload 刻意分成两个文件,不共用一个暴露面。
 *
 * 为什么分开:contextBridge 暴露面是**按窗授予的最小权限**;关于窗只需要"打开外链"与
 * "查更新"两条,把它塞进主窗的 `window.api` 就等于让一个只读静态页拿到整个转换面。
 *
 * 不变量在哪:① 纯 CJS —— Electron preload 不走 ESM 解析,故 channel 名单**无法** import
 * ESM 单源(src/main/ipc/channels.ts),只能侧内镜像;两侧漂移由
 * test/main/ipc-channels.test.js 对 dist 两份产物提取后做恒等断言兜底,改这一处必须同步
 * 改 main/preload.cts 与 channels.ts。② 外链一律走 IPC 让主进程过会话级白名单
 * (output-allowlist),本窗不得自己开 shell。
 */
const { contextBridge, ipcRenderer } = require("electron");
// channel 名单源在 src/main/ipc/channels.ts;本文件为纯 CJS preload,无法 import
// ESM 单源模块,侧内镜像 about 域键(同 preload.cts 手法),漂移由
// test/main/ipc-channels.test.js 对 dist 两侧提取恒等断言兜底。
const CH = {
  aboutOpenExternal: "about:open-external",
  aboutCheckUpdate: "about:check-update",
};
contextBridge.exposeInMainWorld("aboutApi", {
  openExternal: (url) => ipcRenderer.invoke(CH.aboutOpenExternal, url),
  checkUpdate: () => ipcRenderer.invoke(CH.aboutCheckUpdate),
});
