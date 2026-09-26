// @ts-check
/**
 * renderer 命令入口事件边界与 single-flight 行为测试:
 * - 拖放区祖先容器只对自身目标响应:内部控件(button/label)的 click 与 Enter/Space
 *   冒泡不得叠加第二个动作(打开文件对话框);
 * - Ctrl+Enter 连续触发 / 转换按钮重复点击只起一条预检链(预检只调一次 main);
 * - 预检进行中、模态(成书向导)打开时,快捷键与新转换命令统一阻断;
 * - index.html 舞台容器角色不再声明为 button(容器内嵌交互元素)。
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
  if (!cond) throw new Error(`command-entry-guard 断言失败:${msg}`);
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
 * 元素 stub:listeners 按事件类型存单一处理器(与既有测试段一致);
 * closestSelector 非空时模拟「该元素自身命中某个选择器」(内部交互控件)。
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
 * @property {(selector: string) => StubElement | null} closest
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

/** @param {string} [closestSelector] @returns {StubElement} */
function makeElement(closestSelector = "") {
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
    closest(/** @type {string} */ selector) {
      return closestSelector !== "" && selector.includes(closestSelector) ? el : null;
    },
    append() {},
    appendChild() {},
    get listener() { return listeners; },
  };
  return /** @type {StubElement} */ (el);
}

/**
 * 合成事件:只实现被测 handler 读取的字段(修饰键 / 目标 / 默认行为标记)。
 * @typedef {object} StubEvent
 * @property {boolean} ctrlKey
 * @property {boolean} metaKey
 * @property {boolean} altKey
 * @property {boolean} shiftKey
 * @property {unknown} target
 * @property {boolean} defaultPrevented
 * @property {() => void} preventDefault
 * @property {() => void} stopPropagation
 * @property {string} [key]
 */

/** @param {Partial<StubEvent>} [props] @returns {StubEvent} */
function makeEvent(props) {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    ...props,
  };
}

/** 冲刷微任务与已就绪的宏任务,让未 await 的命令链(void 启动)跑完。 */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
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
 * window 事件登记(同一事件类型可有多个模块监听)。
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
  let openDialogCalls = 0;
  let convertCalls = 0;
  // 计数经读取函数取值:断言函数的类型收窄会把变量锁在上一次比较的字面量上,
  // 而这些计数由被测回调在断言之间递增。
  const precheckCount = () => precheckCalls;
  const dialogCount = () => openDialogCalls;
  const convertCount = () => convertCalls;
  const elements = stubDom().elements;
  /** @type {Map<string, (...args: unknown[]) => unknown>} */
  const docListeners = new Map();
  const windowListeners = stubDom().windowListeners;
  /** 逐次返回新的未决 Promise,模拟主进程预检往返(用于观察 single-flight)。 */
  /** @type {Array<(result: unknown[]) => void>} */
  const pendingPrechecks = [];
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
    activeElement: makeElement(),
    documentElement: makeElement(),
    body: makeElement(),
    getElementById: /** @param {string} id */ (id) => elementFor(id),
    querySelector: /** @param {string} selector */ (selector) => (
      modalVisible && selector.includes("dialog-overlay") ? elementFor("overlay") : null
    ),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      docListeners.set(type, fn);
    },
    removeEventListener(/** @type {string} */ type) { docListeners.delete(type); },
  };
  setGlobalSlot("document", fakeDocument);
  setGlobalSlot("window", {
    api: {
      precheck: () => {
        precheckCalls++;
        const p = new Promise((resolve) => { pendingPrechecks.push(resolve); });
        return p;
      },
      convert: () => {
        convertCalls++;
        return Promise.resolve({ ok: true, outputPath: "out.docx", warnings: [] });
      },
      convertBatch: () => Promise.resolve({ ok: true }),
      convertMerge: () => Promise.resolve({ ok: true }),
      convertCancel: () => Promise.resolve(),
      onConvertProgress: () => () => {},
      onBatchProgress: () => () => {},
      openMarkdowns: () => {
        openDialogCalls++;
        return Promise.resolve([]);
      },
      clipboardRead: () => Promise.resolve({ type: "empty" }),
      collectMarkdowns: () => Promise.resolve({ files: [], skipped: [] }),
    },
    setTimeout,
    clearTimeout,
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      addWindowListener(windowListeners, type, fn);
    },
    removeEventListener(/** @type {string} */ type) { windowListeners.delete(type); },
  });

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    /** @param {string} rel @returns {string} */
    const distUrl = (rel) => pathToFileURL(path.resolve(here, "../../dist/renderer", rel)).href;
    const flow = await import(distUrl("convert/convert-flow.js"));
    const { state } = await import(distUrl("state/state.js"));
    const selection = await import(distUrl("convert/events/selection.js"));
    const actions = await import(distUrl("convert/events/convert-actions.js"));

    selection.bindSelectionEvents();
    actions.bindConvertActionsEvents();
    // 元素表跨段共享,前序段可能留下可见弹窗遮罩:统一复位为隐藏,模态判定从干净态起算
    for (const [id, el] of elements) {
      if (id.endsWith("Dialog")) el.classList.add("hidden");
    }

    const dropZone = elementFor("dropZone");
    const innerButton = makeElement("button");
    const innerLabel = makeElement("label");
    const clickOnDropZone = dropZone.listener.get("click");
    const keydownOnDropZone = dropZone.listener.get("keydown");
    assert(clickOnDropZone && keydownOnDropZone, "拖放区应绑定 click/keydown 入口");

    // ① 容器自身目标:照常打开文件对话框
    clickOnDropZone(makeEvent({ target: dropZone }));
    assert(dialogCount() === 1, "点击拖放区自身应打开一次文件对话框");
    keydownOnDropZone(makeEvent({ key: "Enter", target: dropZone }));
    assert(dialogCount() === 2, "拖放区自身 Enter 应打开一次文件对话框");

    // ② 内部交互控件冒泡:不得叠加第二个动作(按钮/label、click 与 Enter/Space)
    for (const control of [innerButton, innerLabel]) {
      clickOnDropZone(makeEvent({ target: control }));
      keydownOnDropZone(makeEvent({ key: "Enter", target: control }));
      keydownOnDropZone(makeEvent({ key: " ", target: control }));
    }
    assert(dialogCount() === 2, "内部控件 click/Enter/Space 冒泡不得再打开文件对话框");

    // ③ 容器角色:role=button 会与内部交互元素语义冲突,应为 region
    const html = fs.readFileSync(path.resolve(here, "../../src/renderer/index.html"), "utf8");
    const dropZoneTag = html.match(/<div\s[^>]*id="dropZone"[\s\S]*?>/)?.[0] ?? "";
    assert(dropZoneTag.includes('role="region"'), "拖放区容器应声明 role=region");
    assert(!dropZoneTag.includes('role="button"'), "拖放区容器不应再声明 role=button");
    assert(dropZoneTag.includes('tabindex="0"'), "拖放区容器应保留可聚焦性(键盘可达投放区)");

    // ④ 连续 Ctrl+Enter:只起一条预检链
    state.selectedFiles.push("a.md");
    const keydown = docListeners.get("keydown");
    assert(keydown, "转换域应在 document 上绑定快捷键");
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    assert(precheckCount() === 1, "连续 Ctrl+Enter 只应启动一次预检");
    assert(flow.isConvertCommandBlocked(), "预检进行中命令锁应生效");
    // 预检未决时按钮再点一次:仍复用同一链
    const convertBtn = elementFor("convertBtn");
    handlerOf(convertBtn, "click")(makeEvent({ target: convertBtn }));
    assert(precheckCount() === 1, "预检未决时按钮再点不得另起预检");
    const settleFirstPrecheck = pendingPrechecks.shift();
    assert(settleFirstPrecheck, "应有一条未决预检链可结算");
    settleFirstPrecheck([]); // 预检通过(无警告)→ 链进入转换
    await flush();
    assert(convertCount() === 1, "唯一活动预检完成后只执行一次转换");
    assert(!flow.isConvertCommandBlocked(), "转换结束(命令锁释放)后应可发起新命令");

    // ⑤ 模态(成书向导)打开:快捷键与按钮命令统一阻断
    modalVisible = true;
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    handlerOf(convertBtn, "click")(makeEvent({ target: convertBtn }));
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(precheckCount() === 1, "模态打开时不得启动新预检");
    assert(convertCount() === 1, "模态打开时不得启动新转换");
    assert(dialogCount() === 2, "模态打开时 Ctrl+O 不得打开文件对话框");
    // 阻断时不吞默认行为(模态内控件的 Enter/Space 激活不受影响)
    const blockedKey = makeEvent({ key: "Enter", ctrlKey: true });
    keydown(blockedKey);
    assert(!blockedKey.defaultPrevented, "被阻断的快捷键不应 preventDefault");
    modalVisible = false;

    // ⑥ 转换进行中:新命令阻断
    state.mode = "single";
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    assert(precheckCount() === 1, "转换进行中不得启动新预检");
    state.mode = null;

    // ⑦ 预检中再点「打开文件」:同锁阻断
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(dialogCount() === 3, "空闲时 Ctrl+O 应打开一次文件对话框");
    const beforePrecheck = precheckCalls;
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(precheckCount() === beforePrecheck + 1, "预检只应启动一次");
    assert(dialogCount() === 3, "预检未决时不得打开文件对话框");
    const settleRetryPrecheck = pendingPrechecks.shift();
    assert(settleRetryPrecheck, "应有一条未决预检链可结算");
    settleRetryPrecheck([]); // 释放本条链
    await flush();
    assert(!flow.isConvertCommandBlocked(), "预检链结算后应释放命令锁");

    console.log("[ok] command-entry-guard:事件边界/连续快捷键/预检与模态阻断断言通过");
  } finally {
    setGlobalSlot("document", originalDocument);
    setGlobalSlot("window", originalWindow);
  }
}
