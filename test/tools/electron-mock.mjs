/**
 * electron 最小 mock(供 gen-fixtures 纯 Node 环境使用):
 * electron 包是 CJS(默认导出 exe 路径字符串),命名导入会抛 SyntaxError;
 * 段模块依赖链(如 test/common/pdf-utils.js 的 BrowserWindow)需要命名导出,
 * 但模块顶层只做 import 声明、方法在 run() 内才被调用,空实现即可满足。
 */
export const app = {
  getPath: () => "",
  getAppPath: () => "",
  whenReady: async () => {},
  on: () => {},
  once: () => {},
  quit: () => {},
  exit: () => {},
  isPackaged: false,
};

export class BrowserWindow {
  constructor() {
    this.webContents = {
      printToPDF: async () => Buffer.alloc(0),
      on: () => {},
      once: () => {},
      send: () => {},
    };
  }
  static getAllWindows() {
    return [];
  }
  loadFile() {
    return Promise.resolve();
  }
  loadURL() {
    return Promise.resolve();
  }
  on() {}
  once() {}
  close() {}
  destroy() {}
  hide() {}
  show() {}
  setTitle() {}
}

export const ipcMain = { handle: () => {}, on: () => {}, once: () => {}, removeHandler: () => {} };
export const ipcRenderer = { invoke: async () => {}, on: () => {}, once: () => {}, send: () => {}, removeAllListeners: () => {} };
export const shell = { openPath: async () => {}, showItemInFolder: () => {}, openExternal: async () => {} };
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: "" }),
  showMessageBox: async () => ({ response: 0 }),
};
export const nativeImage = {
  createFromPath: () => ({ toPNG: () => Buffer.alloc(0), resize: () => ({ toPNG: () => Buffer.alloc(0) }) }),
};
export const clipboard = { writeText: () => {}, readText: () => "" };
export const screen = {
  getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1080 } }),
};
export const Menu = { buildFromTemplate: () => ({ popup: () => {}, append: () => {} }) };
export const contextBridge = { exposeInMainWorld: () => {} };
export const protocol = { registerFileProtocol: () => {}, handle: () => {} };
export const net = { isOnline: () => true };
export const session = { defaultSession: null, fromPartition: () => null };
export const webContents = { getAllWebContents: () => [] };
export const globalShortcut = { register: () => true, unregister: () => {} };
export const powerMonitor = { on: () => {}, off: () => {} };
export const crashReporter = { start: () => {} };
export const baseURL = "";