/**
 * 主窗口创建与关闭确认族:
 * createWindow(位置/最大化记忆 + web 加固 + 关闭确认拦截)与
 * confirmCloseDuringConvert(转换进行中关窗确认;确认/取消/等待释放/超时强杀
 * 的判定收口在 runCloseAbortFlow,Electron 触点经依赖注入,判定可直测)。
 * win32 走 titleBarStyle:hidden + titleBarOverlay 无边框自绘标题栏
 * (overlay 配色单源 windows/title-bar-overlay.ts,主题同步经 IPC theme:syncOverlay)。
 * 依赖方向:本模块 → windows/web-contents-registry(共享活动操作注册表,查询
 * 转换/预检状态;注册表下沉后不再依赖 ipc 层);
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
import {
  cancelWebContentsOperation,
  hasWebContentsOperation,
} from "./web-contents-registry.js";

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
    // 最小高度须保证主 stage 几何恒定:标题栏(44)+ 历史(40)+ stage 设计高(362)
    // + 结果区典型余量(~234)≈680;低于此值结果区撑高会挤压 stage-wrap 致主舞台跳动,
    // 且 >640 使矮窗档媒体查询不触发(恒定用常规档令牌)
    minHeight: 680,
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
    if (hasWebContentsOperation(win.webContents.id) && !closeAborts.has(win)) {
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
 * 关窗放弃流程的可观察结局(判定单一来源,close handler 与直测共用):
 * - keep:用户选择继续转换,不动作(窗口保留)
 * - destroyed:流程期间窗口已销毁,不动作
 * - idle:确认放弃时已无活动操作,直接关闭(无需 cancel/等待)
 * - closed:活动操作已释放,正常关闭
 * - forced:超时仍未释放,强杀窗口(兜底防卡死)
 */
export type CloseAbortOutcome = "keep" | "destroyed" | "idle" | "closed" | "forced";

/** 关窗放弃流程依赖(Electron 触点经此注入,流程本身零 Electron 运行时依赖可直测)。 */
export interface CloseAbortDeps {
  /** 关闭确认:用户是否选择「放弃并关闭」 */
  confirm(): Promise<boolean>;
  isDestroyed(): boolean;
  /** 同一 webContents 当前是否仍有活动操作(转换/预检/批量/合并共用注册表) */
  hasOperation(): boolean;
  /** 请求取消当前活动操作(无活动操作为空操作) */
  cancelOperation(): void;
  now(): number;
  delay(ms: number): Promise<void>;
  close(): void;
  destroy(): void;
}

/** 轮询与超时参数(调用方注入真实常量,测试可压缩时间轴)。 */
export interface CloseAbortTiming {
  pollMs: number;
  timeoutMs: number;
}

/**
 * 关窗放弃流程编排(纯判定 + 依赖注入):
 * 确认放弃 → cancel 当前活动操作 → 轮询等待注册表释放(任务 finally 的
 * compare-and-delete)→ 释放则正常 close,超时兜底 destroy。
 * 轮询期间若旧操作已释放但同一 webContents 又出现新操作,继续等待新操作,
 * 避免在转换进行中销毁窗口(旧 token 的 finally 也不会误删新操作 context)。
 */
export async function runCloseAbortFlow(
  deps: CloseAbortDeps,
  timing: CloseAbortTiming,
): Promise<CloseAbortOutcome> {
  if (deps.isDestroyed()) return "destroyed";
  if (!(await deps.confirm())) return "keep";
  if (deps.isDestroyed()) return "destroyed";
  if (!deps.hasOperation()) {
    deps.close();
    return "idle";
  }
  deps.cancelOperation();
  const deadline = deps.now() + timing.timeoutMs;
  while (deps.hasOperation() && !deps.isDestroyed() && deps.now() < deadline) {
    await deps.delay(timing.pollMs);
  }
  if (deps.isDestroyed()) return "destroyed";
  if (deps.hasOperation()) {
    deps.destroy();
    return "forced";
  }
  deps.close();
  return "closed";
}

/**
 * 关窗时转换进行中的确认弹窗(Electron 薄壳:对话框/窗口/注册表/计时经
 * deps 注入 runCloseAbortFlow,关闭与超时判定见该函数)。
 * 「继续转换」→ 不动作(窗口保留);「放弃并关闭」→ cancel 转换并等 finally
 * 释放 ctx(取消检查点在打印/写盘前后均有),正常路径重新 close;超时兜底 destroy。
 * closeAborts 放行标记只在「放弃并关闭」落地时登记:keep 分支若登记,
 * 下一次关闭将绕过确认在转换进行中直接关窗。
 */
export async function confirmCloseDuringConvert(win: BrowserWindow): Promise<void> {
  const id = win.webContents.id;
  const outcome = await runCloseAbortFlow(
    {
      confirm: async () => {
        const choice = await dialog.showMessageBox(win, {
          type: "warning",
          title: t("close.confirmTitle"),
          message: t("close.confirmMessage"),
          buttons: [t("close.keepConverting"), t("close.abortAndClose")],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) return false;
        closeAborts.add(win);
        return true;
      },
      isDestroyed: () => win.isDestroyed(),
      hasOperation: () => hasWebContentsOperation(id),
      cancelOperation: () => {
        cancelWebContentsOperation(id);
      },
      now: () => Date.now(),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      close: () => win.close(),
      destroy: () => win.destroy(),
    },
    { pollMs: CLOSE_ABORT_POLL_MS, timeoutMs: CLOSE_ABORT_TIMEOUT_MS },
  );
  if (outcome === "forced") {
    console.warn("[main] 放弃转换后等待活动操作释放超时,强制关闭窗口");
  }
}
