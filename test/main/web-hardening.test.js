// @ts-check
/**
 * WebContents 加固段(src/main/services/web-hardening.ts;main/services 此前无专属测试的服务,覆盖缺口补测):
 * 实现事实(读源码确认):
 * - isHttpUrl:仅 http/https(大小写不敏感)放行;ftp:/javascript:/file:/about: 等一律拒绝
 * - openExternalIfHttp:非 http(s) 直接跳过(无副作用、不抛);http(s) 交 shell.openExternal
 *   (测试内以记录桩替换 openExternal 隔离真实外开副作用,并断言分流调用)
 * - hardenWebContents:setWindowOpenHandler 一律返回 { action: "deny" }(window.open 全拒);
 *   will-navigate 监听无条件 event.preventDefault()(页内真实导航全拦)再按协议分流。
 *   经注入假 win 对象(鸭子类型,捕获 handler)直测,不起真实窗口;
 *   非 http URL 分流到 openExternalIfHttp 为无副作用路径,可安全断言不抛。
 */
import { shell } from "electron";
import { hardenWebContents, isHttpUrl, openExternalIfHttp } from "../../dist/main/services/web-hardening.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("web-hardening");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游代码依赖收窄 ⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/**
 * 假窗口 → BrowserWindow 的入参收窄:hardenWebContents 的入参是 electron 的
 * BrowserWindow(175 个成员),而本段只消费其 webContents 上的
 * setWindowOpenHandler / on 两个成员 —— 假窗口按被消费的那两个面如实建模,
 * 注入契约面时在此单点收窄。
 * @param {{ webContents: unknown }} win 假窗口(只实现被消费的两个 webContents 成员)
 * @returns {import("electron").BrowserWindow} 契约面的窗口引用
 */
const asBrowserWindow = (win) => /** @type {import("electron").BrowserWindow} */ (/** @type {unknown} */ (win));

/**
 * 构造假 BrowserWindow:捕获 setWindowOpenHandler / will-navigate 注册的 handler
 * @returns {{
 *   windowOpen?: (details: { url: string }) => { action: string },
 *   willNavigate?: (event: { preventDefault: () => void }, url: string) => void,
 * }} 捕获到的 handler(未注册则该键缺失)
 */
function captureHandlers() {
  /** @type {{ windowOpen?: (details: { url: string }) => { action: string }, willNavigate?: (event: { preventDefault: () => void }, url: string) => void }} */
  const captured = {};
  const fakeWin = {
    webContents: {
      /**
       * @param {(details: { url: string }) => { action: string }} fn 注册的 handler
       * @returns {void}
       */
      setWindowOpenHandler(fn) {
        captured.windowOpen = fn;
      },
      /**
       * @param {string} event 事件名
       * @param {(event: { preventDefault: () => void }, url: string) => void} fn 监听器
       * @returns {void}
       */
      on(event, fn) {
        if (event === "will-navigate") captured.willNavigate = fn;
      },
    },
  };
  hardenWebContents(asBrowserWindow(fakeWin));
  return captured;
}

/**
 * 构造可观察 preventDefault 的假事件
 * @returns {{ prevented: boolean, preventDefault: () => void }} 假事件
 */
function fakeEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // ---- 1. isHttpUrl 协议白名单 ----
  await suite.case("isHttpUrl 仅 http/https 放行", () => {
    assert(isHttpUrl("http://example.com") === true, "http 应放行");
    assert(isHttpUrl("https://example.com/a?b=1") === true, "https 应放行");
    assert(isHttpUrl("HTTP://EXAMPLE.COM") === true, "大写协议应放行(大小写不敏感)");
    assert(isHttpUrl("Https://example.com") === true, "混合大小写 https 应放行");
    assert(isHttpUrl("ftp://example.com") === false, "ftp 应拒绝");
    assert(isHttpUrl("javascript:alert(1)") === false, "javascript: 应拒绝");
    assert(isHttpUrl("file:///C:/x.html") === false, "file: 应拒绝");
    assert(isHttpUrl("about:blank") === false, "about: 应拒绝");
    assert(isHttpUrl("chrome://version") === false, "自定义 scheme 应拒绝");
  });

  // ---- 2. openExternalIfHttp:非 http(s) 无副作用直通(不抛、立即返回) ----
  await suite.case("openExternalIfHttp 非 http(s) 无副作用跳过", () => {
    assert(openExternalIfHttp("javascript:alert(1)") === undefined, "非 http 目标应直接跳过(返回 undefined)");
    assert(openExternalIfHttp("file:///C:/x.html") === undefined, "file: 目标应直接跳过");
  });

  // ---- 3~5. handler 驱动(shell.openExternal 桩替换隔离真实外开副作用) ----
  // http(s) 目标经 openExternalIfHttp 会转交系统浏览器——真实执行会在验收机上
  // 唤起默认浏览器(2026-08-24 实测踩坑)。以记录桩替换并顺带断言分流调用;
  // ESM 严格模式下对只读属性赋值会抛错→段失败响亮暴露,不会静默真开浏览器。
  const externalCalls = /** @type {string[]} */ ([]);
  const realOpenExternal = shell.openExternal;
  shell.openExternal = async (url) => { externalCalls.push(url); };
  try {
    // 桩可替换是以下两条 case 的前提(不可替换则驱动 http 用例会真开浏览器),
    // 故留在 case 之前硬失败,而不是降级为某条 case 的失败
    assert(shell.openExternal !== realOpenExternal, "shell.openExternal 应可桩替换(不可替换则本段无法安全驱动 http 用例)");

    // ---- 3 + 5. window.open 一律 deny,且仅 http(s) 目标经 openExternal 分流恰好一次 ----
    // 5 与 3 同源(externalCalls 正是 3 里的 window.open(http) 写入的),合成一条
    await suite.case("setWindowOpenHandler 一律 deny + http(s) 外开分流恰好一次", () => {
      const { windowOpen } = captureHandlers();
      assert(typeof windowOpen === "function", "setWindowOpenHandler 应被注册");
      for (const url of ["https://evil.example.com", "javascript:void(0)", "file:///C:/x.html"]) {
        const result = windowOpen({ url });
        assert(
          result && result.action === "deny",
          `window.open 目标 ${url} 应返回 action:"deny",实际 ${JSON.stringify(result)}`,
        );
      }
      assert(
        externalCalls.length === 1 && externalCalls[0] === "https://evil.example.com",
        `http(s) 目标应恰好外开分流一次且 URL 正确,实际 ${JSON.stringify(externalCalls)}`,
      );
    });

    // ---- 4. will-navigate:页内真实导航无条件 preventDefault;非 http 目标分流后无副作用 ----
    await suite.case("will-navigate 一律 preventDefault + 非 http 分流无副作用", () => {
      const { willNavigate } = captureHandlers();
      assert(typeof willNavigate === "function", "will-navigate 监听应被注册");
      for (const url of ["javascript:alert(1)", "file:///C:/other.html", "data:text/html,x"]) {
        const ev = fakeEvent();
        willNavigate(ev, url);
        assert(ev.prevented === true, `导航目标 ${url} 应被 preventDefault 拦截`);
        // 非 http URL 分流到 openExternalIfHttp 为无副作用路径:走到这里未抛即通过
      }
    });
  } finally {
    shell.openExternal = realOpenExternal;
  }
  return { cases: suite.results };
}
