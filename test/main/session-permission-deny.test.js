// @ts-check
/**
 * session 权限默认拒绝段(位于 test/main/ = 被测主体为 src/main 的主进程层段;被测为
 * src/main/services/session-permissions.ts,经 dist/main/services/session-permissions.js,
 * electron 环境):
 *
 * 威胁模型(与被测文件头一致):应用无相机/麦克风/定位/通知/硬件直连需求,只加载本地
 * file:// 与 data: URL。renderer 一旦被攻破(XSS/注入/被劫持的预览页),浏览器侧权限
 * 就是它通往宿主的提权通道,而三条通道必须各自收口:
 * request(弹窗式请求)/ check(同步询问,决定某能力是否可用)/ device(USB·串口·HID 直连)。
 * 断言面:
 * - 三条通道**都**已注册(漏一条即红:漏哪条就留哪条提权路径);
 * - 三条都默认拒绝:request 的 callback 收到 false、check 返回 false、device 返回
 *   false(只判「已注册」不够——注册成允许同样是漏洞);
 * - 幂等:重复应用后仍是拒绝(启动路径可能重入);
 * - 对真实 Electron Session(defaultSession)应用不抛错,把签名漂移挡在运行期。
 * 不在自动断言面:真实权限弹窗的端到端拒绝(Chromium 不提供程序化触发权限请求的
 * API,只能靠 GUI 手测;此处断言的是本进程注册的 handler 行为本身)。
 */
import { session } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { applyDefaultDenyPermissions } from "../../dist/main/services/session-permissions.js";
import { ROOT } from "../common/paths.js";

/** @typedef {import("../../src/main/services/session-permissions.js").PermissionDenyHost} PermissionDenyHost */
/** 权限 handler 的宽松签名(本段只关心「回不回答、答什么」,不关心 Electron 的具体形参类型) */
/** @typedef {(...args: any[]) => any} LooseHandler */

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`session-permission-deny 断言失败:${msg}`);
}

export const meta = { description: "session 权限三通道默认拒绝:request/check/device 均注册且拒绝" };
// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---- 1+2. 注入宿主:三条通道均已注册,且每条都以 false 拒绝 ----
  // 未注册的兜底实现直接抛错(handler 漏注册时本段即红,而不是静默通过)
  const notRegistered = (/** @type {string} */ channel) => () => {
    throw new Error(`session-permission-deny 断言失败:${channel} handler 未被注册`);
  };
  let requestHandler = /** @type {LooseHandler} */ (notRegistered("request"));
  let checkHandler = /** @type {LooseHandler} */ (notRegistered("check"));
  let deviceHandler = /** @type {LooseHandler} */ (notRegistered("device"));
  /** @type {string[]} */
  const registered = [];
  const host = /** @type {PermissionDenyHost} */ (
    /** @type {unknown} */ ({
      setPermissionRequestHandler: (/** @type {LooseHandler} */ handler) => {
        registered.push("request");
        requestHandler = handler;
      },
      setPermissionCheckHandler: (/** @type {LooseHandler} */ handler) => {
        registered.push("check");
        checkHandler = handler;
      },
      setDevicePermissionHandler: (/** @type {LooseHandler} */ handler) => {
        registered.push("device");
        deviceHandler = handler;
      },
    })
  );

  applyDefaultDenyPermissions(host);
  assert(
    JSON.stringify(registered) === JSON.stringify(["request", "check", "device"]),
    `三条权限通道都应注册,实际 ${JSON.stringify(registered)}`,
  );
  // request:callback 必须被以 false 结算(不回答 = 请求方无限挂起)
  /** @type {boolean[]} */
  const requestGrants = [];
  requestHandler({ id: 1 }, "media", (/** @type {boolean} */ granted) => requestGrants.push(granted));
  assert(
    JSON.stringify(requestGrants) === JSON.stringify([false]),
    `权限请求必须拒绝,实际 callback 收到 ${JSON.stringify(requestGrants)}`,
  );
  // check:同步询问一律 false
  assert(
    checkHandler({ id: 1 }, "geolocation", "file:///preview.html", {}) === false,
    "权限同步询问(geolocation)必须返回 false",
  );
  assert(checkHandler(null, "media", "https://example.test", {}) === false, "权限同步询问(media)必须返回 false");
  // device:硬件直连一律 false
  assert(
    deviceHandler({ deviceType: "serial", requestingUrl: "file:///preview.html" }) === false,
    "设备权限(串口)必须返回 false",
  );
  assert(
    deviceHandler({ deviceType: "usb", requestingUrl: "file:///preview.html" }) === false,
    "设备权限(USB)必须返回 false",
  );
  console.log("[ok] session-permission-deny:request/check/device 三通道均已注册且默认拒绝");

  // ---- 3. 幂等:重复应用后仍为拒绝(启动路径重入不得退回允许) ----
  registered.length = 0;
  applyDefaultDenyPermissions(host);
  assert(
    JSON.stringify(registered) === JSON.stringify(["request", "check", "device"]),
    "重复应用应重新注册三条通道",
  );
  /** @type {boolean[]} */
  const recheckGrants = [];
  requestHandler({ id: 1 }, "notifications", (/** @type {boolean} */ granted) => recheckGrants.push(granted));
  assert(
    JSON.stringify(recheckGrants) === JSON.stringify([false]),
    `重复应用后仍须拒绝,实际 ${JSON.stringify(recheckGrants)}`,
  );
  assert(checkHandler(null, "hid", "file:///x.html", {}) === false, "重复应用后 check 仍须返回 false");
  assert(deviceHandler({ deviceType: "hid" }) === false, "重复应用后 device 仍须返回 false");
  console.log("[ok] session-permission-deny:重复应用幂等,仍为全拒");

  // ---- 4. 真实 Session + 启动路径接线 ----
  // 4a. 对真实 Electron Session 应用不抛错(签名漂移挡在运行期,而非只靠编译期)
  applyDefaultDenyPermissions(session.defaultSession);
  // 4b. 启动接线:index.ts 是应用入口(import 即触发单实例锁/建窗,无法在段内 import),
  //     故此处只静态核对接线仍在位——handler 全部注册了却没被启动路径调用,等于没开
  const entrySource = await fs.readFile(path.join(ROOT, "src", "main", "index.ts"), "utf8");
  assert(
    /applyDefaultDenyPermissions\(\s*session\.defaultSession\s*\)/.test(entrySource),
    "index.ts 启动路径应调用 applyDefaultDenyPermissions(session.defaultSession)",
  );
  assert(
    !/setPermissionCheckHandler|setDevicePermissionHandler/.test(entrySource),
    "权限收口须走 session-permissions 单源,index.ts 不得就地另写 handler",
  );
  console.log("[ok] session-permission-deny:真实 defaultSession 应用成功 + index.ts 启动接线在位");
}
