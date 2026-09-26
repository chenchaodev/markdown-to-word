/**
 * session 权限默认拒绝收口(main 层单源;index.ts 启动时对 defaultSession 调用一次)。
 *
 * 威胁模型(勿回退,论证见本段):
 * 应用只加载本地 file:// 与 data: URL,自身不申请任何设备/媒体/定位/通知权限。
 * 一旦 renderer 被攻破(XSS、注入、被劫持的预览页),浏览器侧权限就是它通往宿主的
 * 提权通道,而三条通道必须**各自**收口,缺一条即留缺口:
 * - setPermissionRequestHandler:弹窗式请求(媒体、通知、定位、剪贴板读取…),
 *   不注册则走 Chromium 默认询问,弹窗由用户随手点「允许」;
 * - setPermissionCheckHandler:同步询问(页面脚本探测某能力是否可用),
 *   不注册则默认放行,可枚举设备/静默取流;
 * - setDevicePermissionHandler:硬件直连(USB/串口/HID,配合 request 侧的
 *   mediaId-usb),同步询问,返回 false 即拒;不注册则同样落到默认放行。
 * 故在默认拒绝之上显式声明三者,而不是依赖「默认恰好也是拒绝」——
 * 后者会随 Chromium 版本与新窗口类型(webview / 新 partition)漂移。
 * 未来新增窗口或 partition 窗口时,须对同一 host 再调一次本函数,不得就地新写 handler。
 */
import type { Session } from "electron";

/** 权限收口宿主:Electron Session 的最小面(只取三个 set*Handler),抽成接口便于直测注入 */
export interface PermissionDenyHost {
  setPermissionRequestHandler: Session["setPermissionRequestHandler"];
  setPermissionCheckHandler: Session["setPermissionCheckHandler"];
  setDevicePermissionHandler: Session["setDevicePermissionHandler"];
}

/**
 * 把 host 的三条权限通道全部设为默认拒绝(幂等,可重复调用)。
 * 三者形态不同:request 走 callback 结算(显式 false 优先于「不回答」,
 * 否则请求方无限挂起),check 与 device 都是同步返回布尔。
 */
export function applyDefaultDenyPermissions(host: PermissionDenyHost): void {
  host.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  host.setPermissionCheckHandler(() => false);
  host.setDevicePermissionHandler(() => false);
}
