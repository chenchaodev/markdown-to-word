// @ts-check
/**
 * renderer 转换命令/预检 single-flight 直测:
 * - withPrecheck 对同一活动命令返回同一 Promise,预检只调用一次;
 * - 模态/向导可见时拒绝背景命令,转换 mode 也计入锁;
 * - 预检报告 Promise 单实例,按钮 / 遮罩 / Esc / 窗口关闭各关闭路径必定结算。
 * 用最小 DOM stub 动态载入真实 dist renderer 模块,不引入新依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { globalSlot, setGlobalSlot } from "./dom-stub.js";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`convert-command-lock 断言失败:${msg}`);
}

/**
 * classList stub:只实现被测代码触及的成员。
 * @typedef {object} StubClassList
 * @property {(...names: string[]) => void} add
 * @property {(...names: string[]) => void} remove
 * @property {(name: string) => boolean} contains
 * @property {(name: string, force?: boolean) => boolean} toggle
 */

/**
 * 元素 stub:listeners 按事件类型存单一处理器(与既有测试段一致)。
 * @typedef {object} StubElement
 * @property {StubClassList} classList
 * @property {Record<string, string>} dataset
 * @property {Record<string, string>} style
 * @property {string} textContent
 * @property {string} title
 * @property {boolean} disabled
 * @property {boolean} hidden
 * @property {string} value
 * @property {(type: string, fn: (...args: unknown[]) => unknown) => void} addEventListener
 * @property {(type: string) => void} removeEventListener
 * @property {() => void} focus
 * @property {() => void} replaceChildren
 * @property {() => void} setAttribute
 * @property {() => boolean} hasAttribute
 * @property {(selector: string) => null} querySelector
 * @property {(selector: string) => never[]} querySelectorAll
 * @property {() => boolean} contains
 * @property {(selector: string) => null} closest
 * @property {() => void} append
 * @property {() => void} appendChild
 * @property {Map<string, (...args: unknown[]) => unknown>} listener
 */

/** @param {string[]} [initial] @returns {StubClassList} */
function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (/** @type {string[]} */ ...names) => names.forEach((name) => values.add(name)),
    remove: (/** @type {string[]} */ ...names) => names.forEach((name) => values.delete(name)),
    contains: (/** @type {string} */ name) => values.has(name),
    /**
     * @param {string} name
     * @param {boolean} [force]
     * @returns {boolean}
     */
    toggle(name, force) {
      const enabled = force ?? !values.has(name);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

/** @returns {StubElement} */
function makeElement() {
  /** @type {Map<string, (...args: unknown[]) => unknown>} */
  const listeners = new Map();
  const el = {
    classList: makeClassList(["hidden"]),
    dataset: {},
    style: {},
    textContent: "",
    title: "",
    disabled: false,
    hidden: false,
    value: "",
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      listeners.set(type, fn);
    },
    removeEventListener(/** @type {string} */ type) { listeners.delete(type); },
    focus() {},
    replaceChildren() {},
    setAttribute() {},
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    closest() { return null; },
    append() {},
    appendChild() {},
    get listener() { return listeners; },
  };
  return /** @type {StubElement} */ (el);
}

/**
 * 进程内共享的 DOM stub:dist renderer 模块在进程内只 import 一次,dom/refs 的元素
 * 解析与 dialogs 的模块级事件绑定(含 window unload)都发生在首个 import 段里。
 * 各段各自安装的 document/window 只影响之后的调用,若元素与监听器表不共享,
 * 后跑的段拿不到模块级监听器所在的宿主。共享同一批对象,任一段都能驱动它们。
 * @typedef {object} SharedDomStub
 * @property {Map<string, StubElement>} elements
 * @property {Map<string, ((...args: unknown[]) => unknown)[]>} windowListeners
 */

/** @returns {SharedDomStub} */
function stubDom() {
  const existing = globalSlot("__m2wRendererDomStub");
  if (existing) return /** @type {SharedDomStub} */ (existing);
  /** @type {SharedDomStub} */
  const host = { elements: new Map(), windowListeners: new Map() };
  setGlobalSlot("__m2wRendererDomStub", host);
  return host;
}

/**
 * window 事件登记(同一事件类型可有多个模块监听,dialogs 与 convert-actions 都挂 unload)。
 * @param {Map<string, ((...args: unknown[]) => unknown)[]>} listeners
 * @param {string} type
 * @param {(...args: unknown[]) => unknown} fn
 * @returns {void}
 */
function addWindowListener(listeners, type, fn) {
  const list = listeners.get(type) ?? [];
  list.push(fn);
  listeners.set(type, list);
}

/**
 * 触发已登记的 window 事件(dialogs 的关闭结算路径经此驱动)。
 * @param {Map<string, ((...args: unknown[]) => unknown)[]>} listeners
 * @param {string} type
 * @returns {void}
 */
function fireWindow(listeners, type) {
  for (const fn of listeners.get(type) ?? []) fn();
}

/**
 * 取元素上登记的监听器(段内元素表约定:单类型单槽,缺失即断言失败)。
 * @param {StubElement} el
 * @param {string} type
 * @returns {(...args: unknown[]) => unknown}
 */
function handlerOf(el, type) {
  const fn = el.listener.get(type);
  assert(fn, `元素应登记 ${type} 监听器(模块级绑定是否仍挂在该元素?)`);
  return fn;
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const originalDocument = globalSlot("document");
  const originalWindow = globalSlot("window");
  let modalVisible = false;
  let precheckCalls = 0;
  // 计数经读取函数取值:断言函数的类型收窄会把变量锁在上一次比较的字面量上,
  // 而该计数由被测回调在断言之间递增。
  const precheckCount = () => precheckCalls;
  /** 预检 Promise 的结算入口(由 executor 同步赋值;占位实现只在构造异常时暴露问题)。 */
  /** @type {(value: unknown) => void} */
  let resolvePrecheck = () => { throw new Error("预检 Promise 尚未构造"); };
  const precheckResult = new Promise((resolve) => { resolvePrecheck = resolve; });
  const element = makeElement();
  // 共享 stub 宿主:元素与 window 监听器表跨段复用(模块只 import 一次,见 stubDom)
  const { elements, windowListeners } = stubDom();
  /** @param {string} id @returns {StubElement} */
  const elementFor = (id) => {
    let el = elements.get(id);
    if (!el) {
      el = makeElement();
      elements.set(id, el);
    }
    return el;
  };
  const fakeDocument = {
    activeElement: element,
    documentElement: makeElement(),
    body: makeElement(),
    getElementById: /** @param {string} id */ (id) => elementFor(id),
    querySelector: /** @param {string} selector */ (selector) => (
      modalVisible && selector.includes("dialog-overlay") ? element : null
    ),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
  };
  setGlobalSlot("document", fakeDocument);
  setGlobalSlot("window", {
    api: {
      precheck: () => {
        precheckCalls++;
        return precheckResult;
      },
    },
    setTimeout,
    clearTimeout,
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      addWindowListener(windowListeners, type, fn);
    },
    removeEventListener(/** @type {string} */ type) { windowListeners.delete(type); },
  });

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
    assert(precheckCount() === 1, "活动预检期间重复命令不应再次调用 main");
    assert(flow.isConvertCommandBlocked(), "预检期间 command lock 应为 true");
    resolvePrecheck([]);
    await first;
    assert(actionCalls === 1, "唯一活动预检完成后只执行首个 action");
    assert(!flow.isConvertCommandBlocked(), "预检 Promise 结算后应释放 command lock");

    modalVisible = true;
    assert(flow.isConvertCommandBlocked(), "模态/向导可见时应阻止背景命令");
    const beforeBlockedCalls = precheckCount();
    await flow.withPrecheck(["blocked.md"], action);
    assert(precheckCount() === beforeBlockedCalls, "模态期间不得启动新预检");
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

    // 遮罩点击路径:点遮罩本身按取消结算(点卡片内部不关闭)
    const dialogPromise5 = dialogs.showPrecheckDialog([]);
    const precheckDialogEl = elementFor("precheckDialog");
    const overlayClick = handlerOf(precheckDialogEl, "click");
    assert(typeof overlayClick === "function", "预检弹窗应绑定遮罩点击处理器");
    overlayClick({ target: makeElement() });
    assert(precheckDialogEl.classList.contains("hidden") === false, "点卡片内部不应关闭预检弹窗");
    overlayClick({ target: precheckDialogEl });
    assert((await dialogPromise5) === false, "遮罩点击必须结算预检 Promise(false)");

    // 窗口关闭路径:unload 结算(不归还焦点),否则预检链与命令锁永久悬挂
    const dialogPromise6 = dialogs.showPrecheckDialog([]);
    assert(
      (windowListeners.get("unload") ?? []).length >= 1,
      "预检弹窗应注册 unload 结算路径",
    );
    fireWindow(windowListeners, "unload");
    assert((await dialogPromise6) === false, "窗口关闭必须结算预检 Promise(false)");
    const dialogPromise7 = dialogs.showPrecheckDialog([]);
    assert(dialogPromise7 !== dialogPromise6, "结算后应可开启下一次预检(单实例不残留)");
    dialogs.closePrecheckDialog(true);
    assert((await dialogPromise7) === true, "结算后的下一次预检同样可正常放行");

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
    setGlobalSlot("document", originalDocument);
    setGlobalSlot("window", originalWindow);
  }
}
