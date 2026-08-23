/**
 * WebContents 加固(B1 安全审计):导航收口 + 外链外开。
 * - setWindowOpenHandler:拒绝一切 window.open/新窗口;http(s) 目标转交系统浏览器
 * - will-navigate:拦截页内真实导航(编程式 loadFile/loadURL 不触发此事件,
 *   Electron 官方语义,故自身刷新不受影响);http(s) 外链转 shell.openExternal,
 *   其余协议(自定义 scheme/javascript: 等)静默拒绝
 * 适用于主窗口/预览/打印/mermaid 四类窗口(均 sandbox + contextIsolation)。
 */
import type { BrowserWindow } from "electron";
import { shell } from "electron";

/** 仅 https/http 允许外开;其余协议一律拒绝(openExternal 对任意协议有逃逸风险)。 */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** http(s) 外链交系统默认浏览器;openExternal 失败静默(无 UI 通道可反馈)。 */
export function openExternalIfHttp(url: string): void {
  if (isHttpUrl(url)) {
    shell.openExternal(url).catch(() => undefined);
  }
}

/**
 * 导航收口:预览 HTML 由用户 markdown 渲染而来,链接 href 不可信任——
 * 点击外链不再让窗口导航到外部站点(file:// → http 混合导航面),
 * 统一改走系统浏览器;窗口内只允许自身加载的文档。
 */
export function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfHttp(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    // 同文档锚点(#id)不触发 will-navigate;能到这里即真实跨文档导航,一律拦截
    event.preventDefault();
    openExternalIfHttp(url);
  });
}
