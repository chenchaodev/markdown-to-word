/**
 * 应用菜单(自 main/index.ts 抽取,行为零变化):
 * 文件(打开文件…/退出)+ 帮助(关于)。菜单项只做转发/胶水,
 * 不复刻业务逻辑;退出用 role(平台默认行为)。
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
  const win = new BrowserWindow({
    width: 520,
    height: 600,
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
  win.once("ready-to-show", () => win.show());
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
    {
      label: t("menu.help"),
      submenu: [{ label: t("menu.about"), click: showAboutDialog }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
