/**
 * 应用菜单(自 main/index.ts 抽取,行为零变化):
 * 文件(打开文件…/退出)。菜单项只做转发/胶水,
 * 不复刻业务逻辑;退出用 role(平台默认行为)。「关于」入口已迁至标题栏按钮
 * (renderer → about:open IPC),不再走帮助菜单。
 */
import { app, BrowserWindow, Menu, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../core/i18n.js";
import { IPC_CHANNELS as CH } from "./ipc/channels.js";
import { openExternalIfHttp } from "./services/web-hardening.js";
import { getMainWindow } from "./windows/main-window.js";

ipcMain.handle("about:open-external", (_e, url: string) => {
  openExternalIfHttp(url);
});

// 标题栏「关于」按钮(renderer 经 window.api.openAbout → about:open 转发)打开自定义关于窗口
ipcMain.on(CH.aboutOpen, () => {
  showAboutDialog();
});

/**
 * 菜单「打开文件…」:只做转发——聚焦主窗口后经 webContents.send 通知 renderer,
 * renderer 复用现有 openDialog(false) 链路(对话框/过滤/目录记忆/选择应用全在既有代码,
 * 不重复实现);预览窗口无 preload 不订阅,消息自然丢弃。
 */
function openFromAppMenu(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(CH.menuOpen);
}

/** 菜单「关于」:应用名 + 版本(app.getVersion())+ 简短说明。 */
function showAboutDialog(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const aboutUrl = path.join(here, "..", "renderer", "about.html");
  const preload = path.join(here, "..", "renderer", "about-preload.cjs");
  const parent = getMainWindow() ?? undefined;
  const W = 500;
  const H = 560;
  const win = new BrowserWindow({
    width: W,
    height: H,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent,
    modal: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#F1F1EE",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void win.loadFile(aboutUrl, { query: { v: app.getVersion() } });
  win.once("ready-to-show", () => {
    if (parent) {
      const b = parent.getBounds();
      win.setPosition(
        Math.round(b.x + (b.width - W) / 2),
        Math.round(b.y + (b.height - H) / 2),
      );
    }
    win.show();
  });
}

/**
 * 最小应用菜单:autoHideMenuBar 保持(Alt 唤出,不常显)。
 */
export function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t("menu.file"),
      submenu: [
        { label: t("menu.openFile"), click: openFromAppMenu },
        { type: "separator" },
        { label: t("menu.quit"), role: "quit" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
