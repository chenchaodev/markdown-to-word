/**
 * renderer 转换命令/预检 single-flight 直测:
 * - withPrecheck 对同一活动命令返回同一 Promise,预检只调用一次;
 * - 模态/向导可见时拒绝背景命令,转换 mode 也计入锁;
 * - 预检报告 Promise 单实例,显式关闭路径必定结算。
 * 用最小 DOM stub 动态载入真实 dist renderer 模块,不引入新依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(`convert-command-lock 断言失败:${msg}`);
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const enabled = force ?? !values.has(name);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

function makeElement() {
  const listeners = new Map();
  return {
    classList: makeClassList(["hidden"]),
    dataset: {},
    style: {},
    textContent: "",
    title: "",
    disabled: false,
    hidden: false,
    value: "",
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {},
    replaceChildren() {},
    setAttribute() {},
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    append() {},
    appendChild() {},
    get listener() { return listeners; },
  };
}

export async function run() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let modalVisible = false;
  let precheckCalls = 0;
  let resolvePrecheck;
  const precheckResult = new Promise((resolve) => { resolvePrecheck = resolve; });
  const element = makeElement();
  const fakeDocument = {
    activeElement: element,
    documentElement: makeElement(),
    body: makeElement(),
    getElementById: () => element,
    querySelector: (selector) => (
      modalVisible && selector.includes("dialog-overlay") ? element : null
    ),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = fakeDocument;
  globalThis.window = {
    api: {
      precheck: () => {
        precheckCalls++;
        return precheckResult;
      },
    },
    setTimeout,
    clearTimeout,
  };

  try {
    const testUrl = pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/renderer/convert/convert-flow.js"),
    );
    const flow = await import(testUrl.href);
    const dialogsUrl = pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/renderer/ui/dialogs.js"),
    );
    const dialogs = await import(dialogsUrl.href);
    const stateUrl = pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/renderer/state/state.js"),
    );
    const { state } = await import(stateUrl.href);

    let actionCalls = 0;
    const action = () => { actionCalls++; };
    const first = flow.withPrecheck(["a.md"], action);
    const duplicate = flow.withPrecheck(["b.md"], () => { actionCalls += 100; });
    assert(first === duplicate, "重复 withPrecheck 应复用同一活动 Promise");
    assert(precheckCalls === 1, "活动预检期间重复命令不应再次调用 main");
    assert(flow.isConvertCommandBlocked(), "预检期间 command lock 应为 true");
    resolvePrecheck([]);
    await first;
    assert(actionCalls === 1, "唯一活动预检完成后只执行首个 action");
    assert(!flow.isConvertCommandBlocked(), "预检 Promise 结算后应释放 command lock");

    modalVisible = true;
    assert(flow.isConvertCommandBlocked(), "模态/向导可见时应阻止背景命令");
    const beforeBlockedCalls = precheckCalls;
    await flow.withPrecheck(["blocked.md"], action);
    assert(precheckCalls === beforeBlockedCalls, "模态期间不得启动新预检");
    modalVisible = false;

    const eventsUrl = pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/renderer/convert/events/convert-actions.js"),
    );
    await import(eventsUrl.href);
    state.mode = "single";
    assert(flow.isConvertCommandBlocked(), "转换 mode 期间 command lock 应为 true");
    state.mode = null;

    const dialogPromise1 = dialogs.showPrecheckDialog([]);
    const dialogPromise2 = dialogs.showPrecheckDialog([]);
    assert(dialogPromise1 === dialogPromise2, "同一预检报告 Promise 应为单实例");
    dialogs.closePrecheckDialog(true);
    assert((await dialogPromise1) === true, "显式关闭必须结算预检 Promise(true)");

    const dialogPromise3 = dialogs.showPrecheckDialog([]);
    dialogs.closePrecheckDialog(false);
    assert((await dialogPromise3) === false, "取消关闭必须结算预检 Promise(false)");

    const dialogPromise4 = dialogs.showPrecheckDialog([]);
    dialogs.closePrecheckDialog(false);
    assert((await dialogPromise4) === false, "Esc 统一关闭函数必须结算另一条预检 Promise");

    const eventsSource = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/renderer/convert/events/dialogs-events.ts"),
      "utf8",
    );
    assert(
      eventsSource.includes("closePrecheckDialog(false)") &&
      eventsSource.includes("isConvertCommandBlocked()"),
      "Esc 关闭链与菜单命令必须分别走 Promise 结算和 command lock",
    );
    console.log("[ok] convert-command-lock:withPrecheck/command guard/precheck Promise 单实例与结算断言通过");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}
