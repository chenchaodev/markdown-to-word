/**
 * WebContents 加固段(src/main/services/web-hardening.ts;TEST-4 覆盖缺口补测,
 * main/services 此前唯二无专属测试的服务之二):
 * 实现事实(读源码确认,B1 安全审计语义):
 * - isHttpUrl:仅 http/https(大小写不敏感)放行;ftp:/javascript:/file:/about: 等一律拒绝
 * - openExternalIfHttp:非 http(s) 直接跳过(无副作用、不抛);http(s) 交 shell.openExternal
 *   (真实外开有用户可见副作用,不在自动断言面内,未覆盖)
 * - hardenWebContents:setWindowOpenHandler 一律返回 { action: "deny" }(window.open 全拒);
 *   will-navigate 监听无条件 event.preventDefault()(页内真实导航全拦)再按协议分流。
 *   经注入假 win 对象(鸭子类型,捕获 handler)直测,不起真实窗口;
 *   非 http URL 分流到 openExternalIfHttp 为无副作用路径,可安全断言不抛。
 */
import { hardenWebContents, isHttpUrl, openExternalIfHttp } from "../../dist/main/services/web-hardening.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`web-hardening 断言失败:${msg}`);
}

/** 构造假 BrowserWindow:捕获 setWindowOpenHandler / will-navigate 注册的 handler */
function captureHandlers() {
  const captured = {};
  const fakeWin = {
    webContents: {
      setWindowOpenHandler(fn) {
        captured.windowOpen = fn;
      },
      on(event, fn) {
        if (event === "will-navigate") captured.willNavigate = fn;
      },
    },
  };
  hardenWebContents(fakeWin);
  return captured;
}

/** 构造可观察 preventDefault 的假事件 */
function fakeEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

export async function run() {
  // ---- 1. isHttpUrl 协议白名单 ----
  assert(isHttpUrl("http://example.com") === true, "http 应放行");
  assert(isHttpUrl("https://example.com/a?b=1") === true, "https 应放行");
  assert(isHttpUrl("HTTP://EXAMPLE.COM") === true, "大写协议应放行(大小写不敏感)");
  assert(isHttpUrl("Https://example.com") === true, "混合大小写 https 应放行");
  assert(isHttpUrl("ftp://example.com") === false, "ftp 应拒绝");
  assert(isHttpUrl("javascript:alert(1)") === false, "javascript: 应拒绝");
  assert(isHttpUrl("file:///C:/x.html") === false, "file: 应拒绝");
  assert(isHttpUrl("about:blank") === false, "about: 应拒绝");
  assert(isHttpUrl("chrome://version") === false, "自定义 scheme 应拒绝");
  console.log("[ok] web-hardening:isHttpUrl 仅 http/https 放行 断言通过");

  // ---- 2. openExternalIfHttp:非 http(s) 无副作用直通(不抛、立即返回) ----
  assert(openExternalIfHttp("javascript:alert(1)") === undefined, "非 http 目标应直接跳过(返回 undefined)");
  assert(openExternalIfHttp("file:///C:/x.html") === undefined, "file: 目标应直接跳过");
  console.log("[ok] web-hardening:openExternalIfHttp 非 http(s) 无副作用跳过 断言通过");

  // ---- 3. setWindowOpenHandler:任意 URL 一律 deny(http 与非 http 同样拒新窗口) ----
  const { windowOpen } = captureHandlers();
  assert(typeof windowOpen === "function", "setWindowOpenHandler 应被注册");
  for (const url of ["https://evil.example.com", "javascript:void(0)", "file:///C:/x.html"]) {
    const result = windowOpen({ url });
    assert(
      result && result.action === "deny",
      `window.open 目标 ${url} 应返回 action:"deny",实际 ${JSON.stringify(result)}`,
    );
  }
  console.log("[ok] web-hardening:setWindowOpenHandler 一律 deny 断言通过");

  // ---- 4. will-navigate:页内真实导航无条件 preventDefault;非 http 目标分流后无副作用 ----
  const { willNavigate } = captureHandlers();
  assert(typeof willNavigate === "function", "will-navigate 监听应被注册");
  for (const url of ["javascript:alert(1)", "file:///C:/other.html", "data:text/html,x"]) {
    const ev = fakeEvent();
    willNavigate(ev, url);
    assert(ev.prevented === true, `导航目标 ${url} 应被 preventDefault 拦截`);
    // 非 http URL 分流到 openExternalIfHttp 为无副作用路径:走到这里未抛即通过
  }
  console.log("[ok] web-hardening:will-navigate 一律 preventDefault + 非 http 分流无副作用 断言通过");

  // 注:http(s) 外链真实外开(shell.openExternal 会唤起系统浏览器)属用户可见副作用,
  // 维持人工实测覆盖,不在自动断言面(CODE-GUIDE 验证分层)。
}
