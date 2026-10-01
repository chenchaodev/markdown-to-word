// @ts-check
/**
 * electron 最小 mock(供 gen-fixtures 纯 Node 环境使用):
 * electron 包是 CJS(默认导出 exe 路径字符串),命名导入会抛 SyntaxError;
 * 段模块依赖链(如 test/common/pdf-utils.js 的 BrowserWindow)需要命名导出,
 * 但模块顶层只做 import 声明、方法在 run() 内才被调用,空实现即可满足。
 *
 * 边界契约:本文件的命名导出集合必须覆盖 src/main、src/core 对 electron 的全部
 * 具名 import(type-only 说明符已被编译期擦除,不需要 mock)。缺项会让依赖该模块的
 * 测试段在纯 Node 下 import 失败,静态守护见 test/segments/electron-mock-coverage.test.js
 * ——新增/删除导出前先跑该段,别等 check:fixtures 报运行期错误。
 */
export const app = {
  // userData 必须落到真实目录:段内 settings/ui-state 直读 `app.getPath("userData")`
  // 再 path.join(..., "settings.json"),而此处若返回空串,join 的结果就是 **cwd 相对路径**
  // —— 同一目录被多个进程/多段共享,一段写下的设置成为下一段的起点(实测读 settings 的段
  // 成批失败,且失败点看起来像"设置没生效",与真因毫无关联)。故由调用方经环境变量注入
  // 一次性目录(键名与 shared/userdata.js 的 USER_DATA_ENV 同源)。
  // 未设该变量时返回空串 —— 与本文件改造前逐字一致,gen-fixtures 走的仍是这条老路径。
  getPath: (/** @type {string} */ name) =>
    name === "userData" ? (process.env.M2W_SEGMENT_USER_DATA ?? "") : "",
  getAppPath: () => "",
  // 补 no-op:shared/userdata.js 的 redirectUserData 走 app.setPath("userData", dir)。
  // 纯 node 下没有 electron 的路径注册表可写(写入也不会被 getPath 读回,故真值仍由
  // 上面的 getPath 从环境变量给出),但**方法必须存在** —— shared/userdata.js 拿到的是
  // electron app 的同形状替身,缺方法会让整条 userData 重定向路径抛 TypeError。
  setPath: () => {},
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
export const nativeTheme = { shouldUseDarkColors: false, themeSource: "system" };
export const webUtils = { getPathForFile: () => "" };
export const protocol = { registerFileProtocol: () => {}, handle: () => {} };
export const net = { isOnline: () => true };
export const session = { defaultSession: null, fromPartition: () => null };
export const webContents = { getAllWebContents: () => [] };
export const globalShortcut = { register: () => true, unregister: () => {} };
export const powerMonitor = { on: () => {}, off: () => {} };
export const crashReporter = { start: () => {} };
export const baseURL = "";