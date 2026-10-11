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
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/paths.js";
import { globalSlot, setGlobalSlot } from "./dom-stub.js";
import { loadConvertFlowDeps } from "./convert-flow-deps.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("convert-command-lock");

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
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测的四个 dist renderer 模块由 `await import(pathToFileURL(...).href)` 的**运行期
 * 动态 import** 载入(路径逐段 `path.join` 拼出,不在 import 语句位置),段内零
 * renderer import。
 *
 * 主体依据(头注 + 段内实现位置):头注写「renderer 转换命令/预检 single-flight 直测」,
 * 逐条对应到四处实现:
 * - `convert/convert-flow.ts` —— `withPrecheck` / `isConvertCommandBlocked`(命令锁与预检单飞);
 * - `ui/dialogs.ts` —— `showPrecheckDialog` / `closePrecheckDialog`(预检报告 Promise 单实例
 *   与四条关闭路径的结算);
 * - `state/state.ts` —— `state.mode`(转换 mode 也计入锁那一格);
 * - `convert/events/convert-actions.ts` —— 导入它以挂上菜单命令侧的锁判定;
 *   `convert/events/dialogs-events.ts` —— 段末读其 src 文本断 Esc 关闭链与菜单命令的走向。
 */
export const covers = [
  "src/renderer/convert/convert-flow.ts",
  "src/renderer/ui/dialogs.ts",
  "src/renderer/state/state.ts",
  "src/renderer/convert/events/convert-actions.ts",
  "src/renderer/convert/events/dialogs-events.ts",
];

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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
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
      path.join(ROOT, "dist/renderer/convert/convert-flow.js"),
    );
    const flow = await import(testUrl.href);
    const dialogsUrl = pathToFileURL(
      path.join(ROOT, "dist/renderer/ui/dialogs.js"),
    );
    const dialogs = await import(dialogsUrl.href);
    const stateUrl = pathToFileURL(
      path.join(ROOT, "dist/renderer/state/state.js"),
    );
    const { state } = await import(stateUrl.href);

    // convert 刀起结果呈现面(ui/dialogs 的五个符号)改为组合根注入的端口(ADR-075 §四),
    // 测试侧按同一份清单装配(convert-flow-deps.js,与组合根同源于 ConvertFlowDeps)。
    /** @param {string} rel @returns {string} */
    const testUrlForDeps = (rel) =>
      pathToFileURL(path.join(ROOT, "dist/renderer", rel)).href;
    const convertFlowDeps = await loadConvertFlowDeps(testUrlForDeps);
    // ui/dialogs 的关闭路径同理收 deps;遮罩重算用真实 file-list 出口。
    const { updateActionButtons } = await import(
      pathToFileURL(path.join(ROOT, "dist/renderer/convert/file-list.js")).href
    );
    const dialogsDeps = { recomputeActionButtons: updateActionButtons };
    // 预检弹窗的按钮/遮罩接线自 convert 刀起由组合根带 deps 登记(原先在模块加载期),
    // 本段要在驱动遮罩点击之前补上这一步。
    dialogs.bindPrecheckDialogEvents(dialogsDeps);

    let actionCalls = 0;
    const action = () => { actionCalls++; };

    // ---- 1. single-flight:同一活动命令复用同一 Promise,预检只调一次 ----
    await suite.case("withPrecheck 单飞:复用同一 Promise 且结算后释放锁", async () => {
      // 这一串必须整条跑完:结算(resolvePrecheck)是后面几条断言的前置,
      // 中途失败会让 await first 悬挂,故合成一个 case。
      const first = flow.withPrecheck(convertFlowDeps, ["a.md"], action);
      const duplicate = flow.withPrecheck(convertFlowDeps, ["b.md"], () => { actionCalls += 100; });
      assert(first === duplicate, "重复 withPrecheck 应复用同一活动 Promise");
      assert(precheckCount() === 1, "活动预检期间重复命令不应再次调用 main");
      assert(flow.isConvertCommandBlocked(), "预检期间 command lock 应为 true");
      resolvePrecheck([]);
      await first;
      assert(actionCalls === 1, "唯一活动预检完成后只执行首个 action");
      assert(!flow.isConvertCommandBlocked(), "预检 Promise 结算后应释放 command lock");
    });

    // ---- 2. 模态/向导可见时拒绝背景命令 ----
    await suite.case("模态可见时阻止背景命令", async () => {
      modalVisible = true;
      assert(flow.isConvertCommandBlocked(), "模态/向导可见时应阻止背景命令");
      const beforeBlockedCalls = precheckCount();
      await flow.withPrecheck(convertFlowDeps, ["blocked.md"], action);
      assert(precheckCount() === beforeBlockedCalls, "模态期间不得启动新预检");
      modalVisible = false;
    });

    const eventsUrl = pathToFileURL(
      path.join(ROOT, "dist/renderer/convert/events/convert-actions.js"),
    );
    await import(eventsUrl.href);

    // ---- 3. 转换 mode 也计入锁 ----
    await suite.case("转换 mode 期间 command lock 生效", () => {
      state.mode = "single";
      assert(flow.isConvertCommandBlocked(), "转换 mode 期间 command lock 应为 true");
      state.mode = null;
    });

    // ---- 4. 预检报告 Promise 单实例 + 显式关闭结算 ----
    await suite.case("预检报告 Promise 单实例且显式关闭结算", async () => {
      const dialogPromise1 = dialogs.showPrecheckDialog([]);
      const dialogPromise2 = dialogs.showPrecheckDialog([]);
      assert(dialogPromise1 === dialogPromise2, "同一预检报告 Promise 应为单实例");
      dialogs.closePrecheckDialog(true, dialogsDeps);
      assert((await dialogPromise1) === true, "显式关闭必须结算预检 Promise(true)");
    });

    // ---- 5. 取消关闭结算 ----
    await suite.case("取消关闭结算预检 Promise", async () => {
      const dialogPromise3 = dialogs.showPrecheckDialog([]);
      dialogs.closePrecheckDialog(false, dialogsDeps);
      assert((await dialogPromise3) === false, "取消关闭必须结算预检 Promise(false)");
    });

    // ---- 6. Esc 统一关闭函数结算另一条 ----
    await suite.case("Esc 统一关闭函数结算预检 Promise", async () => {
      const dialogPromise4 = dialogs.showPrecheckDialog([]);
      dialogs.closePrecheckDialog(false, dialogsDeps);
      assert((await dialogPromise4) === false, "Esc 统一关闭函数必须结算另一条预检 Promise");
    });

    // ---- 7. 遮罩点击路径:点遮罩本身按取消结算(点卡片内部不关闭) ----
    await suite.case("遮罩点击结算且点卡片内部不关闭", async () => {
      const dialogPromise5 = dialogs.showPrecheckDialog([]);
      const precheckDialogEl = elementFor("precheckDialog");
      const overlayClick = handlerOf(precheckDialogEl, "click");
      assert(typeof overlayClick === "function", "预检弹窗应绑定遮罩点击处理器");
      overlayClick({ target: makeElement() });
      assert(precheckDialogEl.classList.contains("hidden") === false, "点卡片内部不应关闭预检弹窗");
      overlayClick({ target: precheckDialogEl });
      assert((await dialogPromise5) === false, "遮罩点击必须结算预检 Promise(false)");
    });

    // 窗口关闭路径:unload 结算(不归还焦点),否则预检链与命令锁永久悬挂。
// 该 Promise 由下一条 case 拿来比「结算后单实例不残留」,故在 run() 层建一次。
const dialogPromise6 = dialogs.showPrecheckDialog([]);
    await suite.case("窗口 unload 路径结算预检 Promise", async () => {
      assert(
        (windowListeners.get("unload") ?? []).length >= 1,
        "预检弹窗应注册 unload 结算路径",
      );
      fireWindow(windowListeners, "unload");
      assert((await dialogPromise6) === false, "窗口关闭必须结算预检 Promise(false)");
    });

    // ---- 9. 结算后单实例不残留,下一次预检照常放行 ----
    await suite.case("结算后单实例不残留且下一次预检可放行", async () => {
      const dialogPromise7 = dialogs.showPrecheckDialog([]);
      assert(dialogPromise7 !== dialogPromise6, "结算后应可开启下一次预检(单实例不残留)");
      dialogs.closePrecheckDialog(true, dialogsDeps);
      assert((await dialogPromise7) === true, "结算后的下一次预检同样可正常放行");
    });

    // ---- 10. Esc 关闭链与菜单命令各走各自路径(源文本契约) ----
    await suite.case("Esc 关闭链与菜单命令各走各自路径", () => {
      const eventsSource = fs.readFileSync(
        path.join(ROOT, "src/renderer/convert/events/dialogs-events.ts"),
        "utf8",
      );
      assert(
        eventsSource.includes("closePrecheckDialog(false)") &&
        eventsSource.includes("isConvertCommandBlocked()"),
        "Esc 关闭链与菜单命令必须分别走 Promise 结算和 command lock",
      );
    });

    // ---- 11. Esc 链末位语义(ADR-075 §二 禁令 4 的**源文本层**那一半) ----
    // 钉的是「谁在末位」而不是「链路通」:六段的被调函数名按顺序逐段相等。
    // 为什么读源文本:末位语义 = `else if` 的求值顺序,运行期任何一次按键只会命中
    // 一段,单靠运行期断言量不出「顺序」这件事;而这一段一旦被改成惰性 port
    // (void / 微任务 / 回调),末位就会静默改掉而没有任何测试变红。
    await suite.case("Esc 链六段顺序:预检→另存为预设→完成→批量→抽屉→向导(末位)", () => {
      const eventsSource = fs.readFileSync(
        path.join(ROOT, "src/renderer/convert/events/dialogs-events.ts"),
        "utf8",
      );
      // 只取 keydown 处理器本体:从 Esc 监听器登记处到文件末(该监听器是本域最后一段)。
      const escStart = eventsSource.indexOf('document.addEventListener("keydown"');
      assert(escStart > 0, "dialogs-events 应有 document keydown(Esc 关闭链)监听器");
      const escBlock = eventsSource.slice(escStart);
      // 按出现顺序抽出被调端口名;抽屉那段的判据(可见性查询)与动作同段,一并入列,
      // 于是六段共七个名字 —— 判据与动作的相邻关系也被钉住。
      const called = [...escBlock.matchAll(/deps\.(\w+)\(/g)].map((m) => m[1]);
      const expected = [
        "closePrecheckDialog",
        "closePresetSave",
        "hideCompleteDialog",
        "hideBatchDialog",
        "isSettingsDrawerOpen",
        "closeSettingsDrawer",
        "closeWizard",
      ];
      assert(
        JSON.stringify(called) === JSON.stringify(expected),
        `Esc 链六段顺序应为 预检→另存为预设→完成→批量→抽屉→向导(向导末位),实际 ${JSON.stringify(called)}`,
      );
      // 同段钉「同步调用」:禁令 4 的另一半,链上不得出现 void / 微任务包装。
      assert(
        !/\bvoid\s+deps\./.test(escBlock),
        "Esc 链各段必须同步调用(禁令 4:末位语义不许交给惰性 port)",
      );
    });

    console.log("[ok] convert-command-lock:withPrecheck/command guard/precheck Promise 单实例与结算断言通过");
    return { cases: suite.results };
  } finally {
    setGlobalSlot("document", originalDocument);
    setGlobalSlot("window", originalWindow);
  }
}
