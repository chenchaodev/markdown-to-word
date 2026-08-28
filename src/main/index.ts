/**
 * 主进程入口:应用生命周期编排。
 * 本文件只留:app 生命周期(whenReady / activate / window-all-closed)、
 * 单实例锁、进程级兜底、SMOKE 入口(--smoke 分支动态 import test/tools/smoke/smoke.mjs)。
 * 子模块:windows/main-window(主窗口)、windows/preview(预览)、ipc/register(IPC 注册)、menu(菜单)。
 */
import { app, BrowserWindow, session } from "electron";
import { setLanguage } from "../core/i18n.js";
import { loadSettings } from "./persist/settings.js";
import { createWindow, getMainWindow } from "./windows/main-window.js";
import { registerIpc } from "./ipc/register.js";
import { buildAppMenu } from "./menu.js";

const SMOKE = process.argv.includes("--smoke");

/* ---------- 进程级兜底(此前 rejection/异常静默进黑洞,排障无据) ---------- */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  // 桌面工具韧性优先:记录留痕不主动退出(状态不可续时用户可手动重启)
  console.error("[uncaughtException]", err);
});

// 单实例锁:双开实例各自持有 settings/uiState 内存缓存与独立写队列,后写覆盖前写,用户感知为「预设和最近文件莫名其妙丢失」且无法归因。SMOKE 豁免:冒烟需与开发实例并存运行。
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 已有实例时再次启动 → 聚焦既有主窗口(无则重建,darwin 关窗驻留场景)
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    // i18n:主进程语言来源 = 持久化设置(菜单/对话框标题/预览错误页按此语言)
    setLanguage(loadSettings().language);
    // 权限请求显式全拒:应用无相机/定位/通知等需求;默认拒绝之上显式声明,防未来新增窗口/webview 类型时遗漏收口
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    buildAppMenu(); // 菜单先于窗口创建,窗口创建即带应用菜单(autoHideMenuBar 下 Alt 唤出)
    registerIpc();
    // activate 先于首次 createWindow 注册(macOS 极早期 dock 点击不丢失)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    const win = createWindow();
    // 渲染进程 console 错误转发到主进程输出(诊断用)
    win.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    if (SMOKE) {
      try {
        // 冒烟入口(迁出生产路径):源码 test/tools/smoke/smoke.mjs(dev-only 诊断设施,不进 src 编译面 → 不进 dist → 打包天然排除)。经 URL 动态 import,说明符保持非字面量以避免对 dev-only 路径做编译期解析;打包产物无此文件,--smoke 仅 dev 使用,缺失时走 catch 退出。
        const smokeUrl = new URL("../../test/tools/smoke/smoke.mjs", import.meta.url).href;
        const { runSmoke } = await import(smokeUrl);
        await runSmoke(win);
      } catch (err) {
        console.error("[smoke] convert FAILED:", err);
        app.exit(1);
        return;
      }
      setTimeout(() => app.quit(), 500);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
