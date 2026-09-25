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

function assert(cond, msg) {
  if (!cond) throw new Error(`command-entry-guard 断言失败:${msg}`);
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

/** 元素 stub:listeners 按事件类型存单一处理器(与既有测试段一致);
 *  closestSelector 非空时模拟「该元素自身命中某个选择器」(内部交互控件)。 */
function makeElement(closestSelector = "") {
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
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {},
    replaceChildren() {},
    setAttribute() {},
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    closest(selector) {
      return closestSelector !== "" && selector.includes(closestSelector) ? el : null;
    },
    append() {},
    appendChild() {},
    get listener() { return listeners; },
  };
  return el;
}

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
 */
function stubDom() {
  globalThis.__m2wRendererDomStub ??= { elements: new Map(), windowListeners: new Map() };
  return globalThis.__m2wRendererDomStub;
}

/** window 事件登记(同一事件类型可有多个模块监听)。 */
function addWindowListener(listeners, type, fn) {
  const list = listeners.get(type) ?? [];
  list.push(fn);
  listeners.set(type, list);
}

export async function run() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let modalVisible = false;
  let precheckCalls = 0;
  let openDialogCalls = 0;
  let convertCalls = 0;
  const elements = stubDom().elements;
  const docListeners = new Map();
  const windowListeners = stubDom().windowListeners;
  /** 逐次返回新的未决 Promise,模拟主进程预检往返(用于观察 single-flight)。 */
  const pendingPrechecks = [];
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
    getElementById: (id) => elementFor(id),
    querySelector: (selector) => (
      modalVisible && selector.includes("dialog-overlay") ? elementFor("overlay") : null
    ),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener(type, fn) { docListeners.set(type, fn); },
    removeEventListener(type) { docListeners.delete(type); },
  };
  globalThis.document = fakeDocument;
  globalThis.window = {
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
    addEventListener(type, fn) { addWindowListener(windowListeners, type, fn); },
    removeEventListener(type) { windowListeners.delete(type); },
  };

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
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
    assert(openDialogCalls === 1, "点击拖放区自身应打开一次文件对话框");
    dropZone.listener.get("keydown")(makeEvent({ key: "Enter", target: dropZone }));
    assert(openDialogCalls === 2, "拖放区自身 Enter 应打开一次文件对话框");

    // ② 内部交互控件冒泡:不得叠加第二个动作(按钮/label、click 与 Enter/Space)
    for (const control of [innerButton, innerLabel]) {
      clickOnDropZone(makeEvent({ target: control }));
      dropZone.listener.get("keydown")(makeEvent({ key: "Enter", target: control }));
      dropZone.listener.get("keydown")(makeEvent({ key: " ", target: control }));
    }
    assert(openDialogCalls === 2, "内部控件 click/Enter/Space 冒泡不得再打开文件对话框");

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
    assert(precheckCalls === 1, "连续 Ctrl+Enter 只应启动一次预检");
    assert(flow.isConvertCommandBlocked(), "预检进行中命令锁应生效");
    // 预检未决时按钮再点一次:仍复用同一链
    elementFor("convertBtn").listener.get("click")(makeEvent({ target: elementFor("convertBtn") }));
    assert(precheckCalls === 1, "预检未决时按钮再点不得另起预检");
    pendingPrechecks.shift()([]); // 预检通过(无警告)→ 链进入转换
    await flush();
    assert(convertCalls === 1, "唯一活动预检完成后只执行一次转换");
    assert(!flow.isConvertCommandBlocked(), "转换结束(命令锁释放)后应可发起新命令");

    // ⑤ 模态(成书向导)打开:快捷键与按钮命令统一阻断
    modalVisible = true;
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    elementFor("convertBtn").listener.get("click")(makeEvent({ target: elementFor("convertBtn") }));
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(precheckCalls === 1, "模态打开时不得启动新预检");
    assert(convertCalls === 1, "模态打开时不得启动新转换");
    assert(openDialogCalls === 2, "模态打开时 Ctrl+O 不得打开文件对话框");
    // 阻断时不吞默认行为(模态内控件的 Enter/Space 激活不受影响)
    const blockedKey = makeEvent({ key: "Enter", ctrlKey: true });
    keydown(blockedKey);
    assert(!blockedKey.defaultPrevented, "被阻断的快捷键不应 preventDefault");
    modalVisible = false;

    // ⑥ 转换进行中:新命令阻断
    state.mode = "single";
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    assert(precheckCalls === 1, "转换进行中不得启动新预检");
    state.mode = null;

    // ⑦ 预检中再点「打开文件」:同锁阻断
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(openDialogCalls === 3, "空闲时 Ctrl+O 应打开一次文件对话框");
    const beforePrecheck = precheckCalls;
    keydown(makeEvent({ key: "Enter", ctrlKey: true }));
    keydown(makeEvent({ key: "o", ctrlKey: true }));
    assert(precheckCalls === beforePrecheck + 1, "预检只应启动一次");
    assert(openDialogCalls === 3, "预检未决时不得打开文件对话框");
    pendingPrechecks.shift()([]); // 释放本条链
    await flush();
    assert(!flow.isConvertCommandBlocked(), "预检链结算后应释放命令锁");

    console.log("[ok] command-entry-guard:事件边界/连续快捷键/预检与模态阻断断言通过");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}
