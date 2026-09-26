/**
 * 主进程入口:应用生命周期编排。
 * 本文件只留:app 生命周期(whenReady / activate / window-all-closed)、
 * 单实例锁、进程级兜底、SMOKE 入口(--smoke 分支动态 import ./smoke.js)。
 * 子模块:windows/main-window(主窗口)、windows/preview(预览)、ipc/register(IPC 注册)、menu(菜单)、
 * smoke(--smoke 冒烟实现;落在 src 编译面 → dist/main/smoke.js 随包分发,解包产物也能跑冒烟)。
 */
import { app, BrowserWindow, session } from "electron";
import { loadSettings, whenSettingsIdle } from "./persist/settings.js";
import { createWindow, getMainWindow } from "./windows/main-window.js";
import { applyStartupSettingsRuntime, registerIpc } from "./ipc/register.js";
import { applyDefaultDenyPermissions } from "./services/session-permissions.js";

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
    // i18n + 应用菜单:主进程语言来源 = 持久化设置(菜单/对话框标题/预览错误页按此
    // 语言);启动与运行期设置变更共用同一副作用编排(单源,见 ipc/register 的运行时
    // 副作用区块),避免两处各写一份初始化。菜单先于窗口创建,窗口创建即带应用菜单
    // (autoHideMenuBar 下 Alt 唤出);此刻无主窗口,标题栏 overlay 同步为空操作
    // (createWindow 内按持久化主题同步)。
    applyStartupSettingsRuntime(loadSettings());
    // 权限三通道显式全拒(request/check/device):应用无相机/麦克风/定位/通知/硬件直连需求,
    // 默认拒绝之上显式声明,防未来新增窗口/webview/partition 类型时遗漏收口。
    // 威胁模型与「勿改为允许」的论证见 services/session-permissions.ts 文件头。
    applyDefaultDenyPermissions(session.defaultSession);
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
        // 冒烟入口(单一实现,编译进 dist/main/smoke.js):dev 与打包产物同一条代码路径
        // ——发布侧检查正是以 --smoke 启动真实可执行文件并断言诊断标记,入口必须随包分发。
        // 动态 import(而非静态)只为不在正常启动路径上加载冒烟模块;说明符是字面量相对
        // 路径,编译产物里恒解析到同目录 smoke.js(dev 与 app.asar 内均成立)。
        const { runSmoke } = await import("./smoke.js");
        await runSmoke(win);
      } catch (err) {
        console.error("[smoke] convert FAILED:", err);
        app.exit(1);
        return;
      }
      // 成功路径:留一拍让渲染进程把 console 转发落盘,再以退出码 0 结束
      setTimeout(() => app.quit(), 500);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // 退出前排空设置写队列:loadSettings 的迁移写是 fire-and-forget(不等它落盘就返回),
  // 不排空则队列里未落盘的迁移结果随进程一起丢掉。排空失败不阻止退出 —— 此时
  // 旧值仍在盘上,比起「退不出去」更可取。
  void whenSettingsIdle()
    .catch((error: unknown) => {
      console.error("[main] 退出前排空设置写队列失败(继续退出):", error);
    })
    .then(() => app.quit());
});
