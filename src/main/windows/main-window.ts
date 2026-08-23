/**
 * 主窗口创建与关闭确认族(自 main/index.ts 抽取,行为零变化):
 * createWindow(位置/最大化记忆 + web 加固 + 关闭确认拦截)与
 * confirmCloseDuringConvert(转换进行中关窗确认)。
 * 依赖方向:本模块 → ipc/register(共享 ctxByWebContents,查询转换进行中状态);
 * menu.ts 反向 import 本模块的 getMainWindow(菜单定位主窗口),不构成循环。
 */
import { BrowserWindow, dialog, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../../core/i18n.js";
import { disposeMermaidService } from "../services/mermaid-service.js";
import { loadUiState, pickWindowBounds, saveUiState } from "../persist/ui-state.js";
import { hardenWebContents } from "../services/web-hardening.js";
import { ctxByWebContents } from "../ipc/register.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 主窗口引用:菜单「打开文件…」/「关于」需定位主窗口(预览窗口无 preload,不响应菜单)。 */
let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): BrowserWindow {
  // 批次 11:恢复上次窗口位置(x/y 须在某显示器工作区内,否则丢弃用默认尺寸)
  const savedBounds = pickWindowBounds(
    loadUiState().windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  // B9:窗口最大化状态记忆(关闭时最大化 → 启动恢复 maximize())
  const restoreMaximized = loadUiState().isMaximized;
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    // 批次 12(C3):最小尺寸,防止窗口过小导致布局挤压不可用
    minWidth: 720,
    minHeight: 560,
    ...(savedBounds ?? {}),
    title: t("app.title"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  hardenWebContents(win); // B1:导航收口(拒绝新窗口/页内跨文档导航,http(s) 外开系统浏览器)
  // B9:恢复最大化状态(先于 loadFile,避免可见的尺寸跳变)
  if (restoreMaximized) win.maximize();
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html")).catch((err) => {
    // B2:加载失败不再静默(此前 void 无 catch,失败进 unhandledRejection 黑洞)
    console.error("[main] renderer index.html 加载失败:", err);
  });
  // mermaid 渲染窗口为常驻隐藏单例:主窗口关闭时销毁,否则 window-all-closed 永不触发
  // (隐藏窗口未关 → 应用无法退出);服务懒重建,后续渲染不受影响
  win.on("closed", () => {
    mainWindow = null;
    disposeMermaidService();
  });
  // 批次 11:关闭时保存窗口位置;B9:最大化状态一并记忆(isMaximized + 还原态
  // 尺寸 getNormalBounds(),恢复时 maximize() 后还原态尺寸仍正确);
  // 全屏不记录(保持原行为,恢复默认尺寸);
  // preventDefault + 写盘完成后 destroy,保证退出前写入落盘(不丢状态)。
  // B2:转换进行中先拦截确认(直接销毁会令 send 抛 "Object has been destroyed",
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

/**
 * B2:关窗时转换进行中的确认弹窗。
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (win.isDestroyed()) return;
  if (ctxByWebContents.has(id)) win.destroy();
  else win.close();
}
