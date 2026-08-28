/**
 * 主窗口创建与关闭确认族:
 * createWindow(位置/最大化记忆 + web 加固 + 关闭确认拦截)与
 * confirmCloseDuringConvert(转换进行中关窗确认)。
 * win32 走 titleBarStyle:hidden + titleBarOverlay 无边框自绘标题栏
 * (overlay 配色单源 windows/title-bar-overlay.ts,主题同步经 IPC theme:syncOverlay)。
 * 依赖方向:本模块 → windows/web-contents-registry(共享 ctxByWebContents,查询
 * 转换进行中状态;注册表下沉后不再依赖 ipc 层);
 * menu.ts 反向 import 本模块的 getMainWindow(菜单定位主窗口),不构成循环。
 */
import { app, BrowserWindow, dialog, nativeTheme, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../../core/i18n.js";
import { disposeMermaidService } from "../services/mermaid-service.js";
import { loadUiState, pickWindowBounds, saveUiState } from "../persist/ui-state.js";
import { loadSettings } from "../persist/settings.js";
import {
  syncTitleBarOverlay,
  TITLE_BAR_OVERLAY_COLORS,
  TITLE_BAR_OVERLAY_HEIGHT,
} from "./title-bar-overlay.js";
import { hardenWebContents } from "../services/web-hardening.js";
import { ctxByWebContents } from "./web-contents-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 主窗口引用:菜单「打开文件…」/「关于」需定位主窗口(预览窗口无 preload,不响应菜单)。 */
let mainWindow: BrowserWindow | null = null;

/** nativeTheme updated 监听只注册一次(主窗口单例,防重建堆叠监听)。 */
let systemThemeWatcherRegistered = false;

function watchSystemThemeForOverlay(): void {
  if (systemThemeWatcherRegistered) return;
  systemThemeWatcherRegistered = true;
  nativeTheme.on("updated", () => {
    // 仅 theme=system 需要跟随系统切换;显式 light/dark 由 IPC 通道驱动,勿覆盖
    if (loadSettings().theme === "system") syncTitleBarOverlay(mainWindow, "system");
  });
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): BrowserWindow {
  // 恢复上次窗口位置(x/y 须在某显示器工作区内,否则丢弃用默认尺寸)
  const savedBounds = pickWindowBounds(
    loadUiState().windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  // 窗口最大化状态记忆(关闭时最大化 → 启动恢复 maximize())
  const restoreMaximized = loadUiState().isMaximized;
  // 窗口/任务栏图标指向钤印新标(build/icon.ico)。dev 下 app 根即仓库根;
  // 打包版 electron-builder 已把同源图标烧进 exe(build/ 不随 asar 分发),existsSync
  // 兜底回退 exe 默认图标,两形态一致。
  const windowIcon = path.join(app.getAppPath(), "build", "icon.ico");
  const win = new BrowserWindow({
    // 默认尺寸放大(960×680)配合自绘标题栏与更宽的设置面板布局
    width: 960,
    height: 680,
    // 最小尺寸,防止窗口过小导致布局挤压不可用;
    // 统一内容列自适应收缩 + ≤720 档参数条折两行,支持 1280/1366 屏半屏操作
    minWidth: 640,
    minHeight: 560,
    ...(savedBounds ?? {}),
    title: t("app.title"),
    ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
    autoHideMenuBar: true,
    // 无边框自绘标题栏路线仅 win32 启用——titleBarStyle:hidden 隐藏
    // 原生标题栏但保留原生最小化/最大化/关闭按钮与 Snap 布局(titleBarOverlay);
    // 其他平台保持普通系统边框(降级回退,渲染层自绘标题栏按平台隐藏)。
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            ...TITLE_BAR_OVERLAY_COLORS.light, // 初始浅色;启动后按持久化主题立即同步(下方)
            height: TITLE_BAR_OVERLAY_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  hardenWebContents(win); // 导航收口(拒绝新窗口/页内跨文档导航,http(s) 外开系统浏览器)
  // 启动即按持久化主题同步 overlay 配色(初始 options 恒为浅色,
  // 不同步则深色用户每次启动都闪一下浅色标题栏);并监听系统深浅色切换——
  // theme=system 时 CSS 侧由 prefers-color-scheme 自动接管,overlay 是原生绘制
  // 必须由 main 手动跟随(渲染层无需感知)。
  if (process.platform === "win32") {
    syncTitleBarOverlay(win, loadSettings().theme);
    watchSystemThemeForOverlay();
  }
  // 恢复最大化状态(先于 loadFile,避免可见的尺寸跳变)
  if (restoreMaximized) win.maximize();
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html")).catch((err) => {
    // 加载失败不再静默(此前 void 无 catch,失败进 unhandledRejection 黑洞)
    console.error("[main] renderer index.html 加载失败:", err);
  });
  // mermaid 渲染窗口为常驻隐藏单例:主窗口关闭时销毁,否则 window-all-closed 永不触发
  // (隐藏窗口未关 → 应用无法退出);服务懒重建,后续渲染不受影响
  win.on("closed", () => {
    mainWindow = null;
    disposeMermaidService();
  });
  // 关闭时保存窗口位置;最大化状态一并记忆(isMaximized + 还原态
  // 尺寸 getNormalBounds(),恢复时 maximize() 后还原态尺寸仍正确);
  // 全屏不记录(保持原行为,恢复默认尺寸);
  // preventDefault + 写盘完成后 destroy,保证退出前写入落盘(不丢状态)。
  // 转换进行中先拦截确认(直接销毁会令 send 抛 "Object has been destroyed",
  // 且 fs.writeFile 后中断可能留下半成品输出文件)
  win.on("close", (event) => {
    if (ctxByWebContents.has(win.webContents.id) && !closeAborts.has(win)) {
      event.preventDefault();
      void confirmCloseDuringConvert(win);
      return;
    }
    if (win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    event.preventDefault();
    void saveUiState({ windowBounds: bounds, isMaximized: maximized })
      .catch(() => {
        /* 静默:UI 状态写失败不影响关闭 */
      })
      .finally(() => win.destroy());
  });
  return win;
}

/** 已进入「放弃转换并关闭」流程的窗口(close 事件放行标记;防轮询期间重复弹确认)。 */
const closeAborts = new WeakSet<BrowserWindow>();

/** 放弃转换后等待 ctx 释放(finally 删除)再关窗;超时强杀防卡死。 */
const CLOSE_ABORT_TIMEOUT_MS = 30_000;
/** 等待 ctx 释放的轮询间隔(粒度权衡:过密空转、过疏延迟关窗)。 */
const CLOSE_ABORT_POLL_MS = 100;

/**
 * 关窗时转换进行中的确认弹窗。
 * 「继续转换」→ 不动作(窗口保留);「放弃并关闭」→ cancel 转换并等 finally
 * 释放 ctx(取消检查点在打印/写盘前后均有),正常路径重新 close;超时兜底 destroy。
 */
async function confirmCloseDuringConvert(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const choice = await dialog.showMessageBox(win, {
    type: "warning",
    title: t("close.confirmTitle"),
    message: t("close.confirmMessage"),
    buttons: [t("close.keepConverting"), t("close.abortAndClose")],
    defaultId: 0,
    cancelId: 0,
  });
  if (choice.response !== 1 || win.isDestroyed()) return;
  closeAborts.add(win);
  const id = win.webContents.id;
  ctxByWebContents.get(id)?.cancel();
  const deadline = Date.now() + CLOSE_ABORT_TIMEOUT_MS;
  while (ctxByWebContents.has(id) && Date.now() < deadline && !win.isDestroyed()) {
    await new Promise((resolve) => setTimeout(resolve, CLOSE_ABORT_POLL_MS));
  }
  if (win.isDestroyed()) return;
  if (ctxByWebContents.has(id)) win.destroy();
  else win.close();
}
