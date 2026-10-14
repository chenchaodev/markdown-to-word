// @ts-check
/**
 * renderer 持久化失败反馈直测(测试经 dist/renderer/**,零依赖最小 DOM stub):
 * - 会话持久化单一写入点:renderSelection 与 renderMultiList/moveItem 每次变更
 *   只发一次 uiStateSet;内容未变的纯重渲染不再产生重复 mutation;
 * - ui-state 四处写入(完成弹窗偏好 / 抽屉开合 / 清空最近 / 首启引导)写失败统一
 *   给出状态区可见提示(文案取自 i18n 单源)并保留编辑内容,不静默显示成功;
 * - 设置保存失败(persistSettings):保留用户当前编辑内容与控件值(不回滚到
 *   main cache),状态区给出可见提示;下一次保存并入待重试草稿并真正落盘,
 *   成功后清除未保存提示;成功路径的权威回填与语言/主题副作用保持不变。
 * - 舞台浮层的自动收起与最近区块刷新(REQ-239:这两条此前零断言):舞台跃迁
 *   通知端口(convert/file-list 的 onStageChanged)真的驱动收起,手动切换受尊重;
 *   转换成功后经 state.recentRefreshHandler 刷新历史条,失败路径不多读一次
 *   ui-state,读取失败静默保持当前展示。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { globalSlot, setGlobalSlot } from "./dom-stub.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";
import { ROOT } from "../harness/paths.js";

const { assert: harnessAssert } = createAsserter("session-persist-feedback");

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
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**。本段主体一部分(state / settings-panel /
 * settings-drawer / dom refs)由 `await load("../../dist/renderer/…")` 的**运行期动态
 * import** 载入(相对路径经 `path.resolve` 拼出,判据的静态抽取器看不见),故仍需 covers
 * 声明本层主体;file-list / convert-flow / recent-files / first-run-guide 写成字面量
 * `import("../../dist/renderer/…")`。
 *
 * 主体依据(头注 + 段内加载位置):头注写「renderer 持久化失败反馈直测」并逐条点名:
 * - `state/state.ts` —— 会话持久化单一写入点(`renderSelection` / `renderMultiList` /
 *   `moveItem` 每次变更只发一次 `uiStateSet`,内容未变的纯重渲染不重复 mutation);
 * - `convert/file-list.ts` —— 多文件列表的变更与移动那一侧,以及舞台跃迁通知端口
 *   (`onStageChanged`,组合根注入)的调用点;
 * - `convert/convert-flow.ts` —— 转换成功后/失败后是否通知刷新最近区块(端口两端
 *   的消费侧);
 * - `settings/settings-panel.ts` 与 `settings/settings-drawer.ts` —— 设置保存失败
 *   (`persistSettings`)与抽屉开合两处 ui-state 写入;
 * - `ui/recent-files.ts` 与 `ui/first-run-guide.ts` —— 历史条的折叠判定与渲染、
 *   清空最近、首启引导三处写入;
 * - `dom/refs.js` 对应的 `dom/refs.ts` —— 被驱动的 DOM 元素解析。
 *
 * 另加载 `dist/core/i18n/index.js` 的 `t` 与 `dist/core/settings/settings-defaults.js` 的
 * `DEFAULT_SETTINGS` 作**夹具输入**(文案单源与设置基线,本段不替它们下断言),故不声明
 * core 层元素。
 */
export const covers = [
  "src/renderer/state/state.ts",
  "src/renderer/convert/file-list.ts",
  "src/renderer/convert/convert-flow.ts",
  "src/renderer/settings/settings-panel.ts",
  "src/renderer/settings/settings-drawer.ts",
  "src/renderer/ui/recent-files.ts",
  "src/renderer/ui/first-run-guide.ts",
  "src/renderer/dom/refs.ts",
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
 * 元素 stub:只实现设置/会话持久化链路触及的 DOM 成员。
 * @typedef {object} StubElement
 * @property {StubClassList} classList
 * @property {Record<string, string>} dataset
 * @property {Record<string, string>} style
 * @property {string} textContent
 * @property {string} title
 * @property {string} innerHTML
 * @property {string} value
 * @property {boolean} disabled
 * @property {boolean} checked
 * @property {boolean} inert
 * @property {unknown[]} selectedOptions
 * @property {(type: string, fn: (...args: unknown[]) => unknown) => void} addEventListener
 * @property {(type: string) => void} removeEventListener
 * @property {() => void} focus
 * @property {() => void} replaceChildren
 * @property {(key: string, value: unknown) => void} setAttribute
 * @property {(key: string) => void} removeAttribute
 * @property {(key: string) => string | null} getAttribute
 * @property {(key: string) => boolean} hasAttribute
 * @property {(selector: string) => null} querySelector
 * @property {(selector: string) => never[]} querySelectorAll
 * @property {() => boolean} contains
 * @property {() => void} append
 * @property {() => void} appendChild
 * @property {(event: { type: string }) => boolean} dispatchEvent
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
  /** @type {Map<string, string>} */
  const attributes = new Map();
  const el = {
    classList: makeClassList([]),
    dataset: {},
    style: {},
    textContent: "",
    title: "",
    innerHTML: "",
    value: "",
    disabled: false,
    checked: false,
    inert: false,
    selectedOptions: [],
    addEventListener(/** @type {string} */ type, /** @type {(...args: unknown[]) => unknown} */ fn) {
      listeners.set(type, fn);
    },
    removeEventListener(/** @type {string} */ type) { listeners.delete(type); },
    focus() {},
    replaceChildren() {},
    // 属性真存真取:aria-* 语义(aria-expanded / aria-invalid 等)是被测代码**写完再读**
    // 的,存成空实现会让「写对了」恒真(读回恒为 null)⇒ 那类断言等于没写。
    setAttribute(/** @type {string} */ key, /** @type {unknown} */ value) {
      attributes.set(key, String(value));
    },
    removeAttribute(/** @type {string} */ key) { attributes.delete(key); },
    getAttribute(/** @type {string} */ key) { return attributes.get(key) ?? null; },
    hasAttribute(/** @type {string} */ key) { return attributes.has(key); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    append() {},
    appendChild() {},
    /** 派发本元素上登记的监听器(段内 stub 契约:只有本段能触达被测代码自绑的监听)。 */
    dispatchEvent(/** @type {{ type: string }} */ event) {
      const fn = listeners.get(event.type);
      if (typeof fn === "function") fn(event);
      return true;
    },
  };
  return /** @type {StubElement} */ (el);
}

/**
 * 取记录数组的指定一条(缺失即断言失败,避免断言在 undefined 上静默失真)。
 * @template T
 * @param {T[]} list
 * @param {number} index
 * @returns {T}
 */
function recordAt(list, index) {
  const item = list[index];
  assert(item, `记录数组缺少第 ${index + 1} 条`);
  return item;
}

/**
 * 取记录数组的最后一条(缺失即断言失败)。
 * @template T
 * @param {T[]} list
 * @returns {T}
 */
function lastRecord(list) {
  const item = list.at(-1);
  assert(item, "记录数组应已有一条写入");
  return item;
}

/** 等待挂起的 promise 回调(persist 的 then 分支)落地。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 补齐元素 stub 形状:验收 runner 为单进程顺序执行,前序段可能已按自己的
 * document stub 加载过 dom/refs.js(元素绑定在当时的 stub 上)。本段只做"补缺",
 * 不覆盖已有实现,避免跨段加载顺序影响本段断言。
 */
function hardenElementShape(/** @type {unknown} */ value, /** @type {Set<unknown>} */ seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => hardenElementShape(item, seen));
    return;
  }
  // 元素/容器 stub 是开放对象(成员由 refs 模块与 harden 目标动态给出),按字符串键读写
  const open = /** @type {Record<string, unknown>} */ (value);
  const members = Object.values(open);
  // 容器对象(成员全是对象,如 refs.marginInputs 这类 id→元素映射):
  // 只递归成员,绝不注入元素成员(否则回填会遍历到伪键)
  if (members.length > 0 && members.every((item) => item && typeof item === "object")) {
    members.forEach((item) => hardenElementShape(item, seen));
    return;
  }
  const template = makeElement();
  for (const [key, fallback] of Object.entries(template)) {
    if (open[key] !== undefined) continue;
    open[key] = typeof fallback === "function" ? fallback.bind(value) : fallback;
  }
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const originalDocument = globalSlot("document");
  const originalWindow = globalSlot("window");
  const originalMutationObserver = globalSlot("MutationObserver");
  const originalError = console.error;
  // 供 finally 复位用(try 内赋值;模块加载失败时保持 null,复位即跳过)
  let stateSnapshot = null;
  let stateRef = null;
  let setLanguageRef = null;
  /** @type {Map<string, StubElement>} */
  const elements = new Map();
  /** @param {string} id @returns {StubElement} */
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    const found = elements.get(id);
    assert(found, `元素 #${id} 应已登记`);
    return found;
  };
  // settingsGet/settingsSet 记录调用;uiStateSet 可切换成功/失败,记录每次 patch
  // (用于断言写入点唯一与内容)
  /** @type {Array<Record<string, unknown>>} */
  const calls = [];
  /** @type {Array<Record<string, unknown>>} */
  const settingsCalls = [];
  let rejectWrites = false;
  let rejectSettings = false;
  /** @type {Record<string, unknown> | null} */
  let mainSettings = null;
  // ---- 9 档(最近区块刷新链)的编排位:ui-state 读取可计数 / 可切失败;main 侧历史记录可编排 ----
  /** @type {number[]} */
  const uiStateGetCalls = [];
  let uiStateGetFails = false;
  /** @type {import("../../dist/core/ipc-contract.js").RecentFile[]} */
  let mainRecentFiles = [];
  let convertOutcome = /** @type {{ ok: boolean, outputPath?: string, error?: string }} */ ({
    ok: true,
    outputPath: "C:\\session-persist\\out.docx",
  });
  // 被测代码造的节点流水(本段 stub 的 createElement 不挂树,只能按创建顺序看内容):
  // 历史行的文件名就落在这些节点的 textContent 上。
  /** @type {StubElement[]} */
  const createdNodes = [];
  // window.api 桩:本段单独持有引用,便于按用例改写单个方法(被测模块始终经 window.api 调用)
  const apiStub = {
    uiStateSet: (/** @type {Record<string, unknown>} */ patch) => {
      calls.push(patch);
      return rejectWrites
        ? Promise.reject(new Error("EACCES: ui-state.json"))
        : Promise.resolve({ ...patch });
    },
    uiStateGet: () => {
      uiStateGetCalls.push(uiStateGetCalls.length);
      return uiStateGetFails
        ? Promise.reject(new Error("EIO: ui-state.json"))
        : Promise.resolve({
            panelOpen: { page: false },
            suppressCompleteDialog: false,
            firstRun: false,
            lastSessionFiles: [],
            recentFiles: mainRecentFiles,
          });
    },
    // 预检无告警 ⇒ 单文件转换直接放行(本段只关心转换**之后**的通知行为)
    precheck: () => Promise.resolve([]),
    // 模拟 main 侧:成功才把这次产物记进历史列表(main 自己维护 ui-state.json)
    convert: (/** @type {string} */ filePath, /** @type {"docx" | "pdf"} */ format) => {
      if (convertOutcome.ok) {
        mainRecentFiles = [
          ...mainRecentFiles,
          { path: filePath, name: filePath.split("\\").pop() ?? filePath, format, ts: 1 },
        ];
      }
      return Promise.resolve({ ...convertOutcome });
    },
    settingsSet: (/** @type {Record<string, unknown>} */ patch) => {
      settingsCalls.push(patch);
      if (rejectSettings) return Promise.reject(new Error("EPERM: settings.json"));
      // 模拟 main 侧 patch 合并(只提交本次 patch 携带的字段)
      mainSettings = { ...(mainSettings ?? {}), ...patch };
      return Promise.resolve({ ...mainSettings });
    },
    settingsGet: () => Promise.resolve(mainSettings ?? {}),
    previewRefresh: () => Promise.resolve(),
  };
  setGlobalSlot("document", {
    documentElement: makeElement(),
    body: makeElement(),
    getElementById: /** @param {string} id */ (id) => el(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => {
      const node = makeElement();
      createdNodes.push(node);
      return node;
    },
    createElementNS: () => {
      const node = makeElement();
      createdNodes.push(node);
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
  });
  // 首启引导经 MutationObserver 监听 #dropZone 的 data-stage;此处只需注册不触发,
  // 舞台切换由用例直接改 dataset 后显式调 syncFirstRunGuide 驱动。
  setGlobalSlot("MutationObserver", class {
    observe() {}
    disconnect() {}
  });
  setGlobalSlot("window", {
    api: apiStub,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    location: { href: "file:///index.html" },
    localStorage: { getItem: () => null, setItem() {} },
  });

  try {
    // 被测代码在写失败时用 console.error 留痕(契约的一部分,需断言);
    // 全程静音并收集,避免污染段输出
    /** @type {string[]} */
    const loggedErrors = [];
    console.error = (...args) => { loggedErrors.push(args.map(String).join(" ")); };
    // 未捕获的 rejection 也收集:被测链路的异常必须显式暴露而非静默
    /** @type {string[]} */
    const unhandled = [];
    process.on("unhandledRejection", (reason) => {
      // 放宽理由:rejection reason 可能是 Error 也可能是任意抛出值,按 { stack? } 视图读取
      const err = /** @type {{ stack?: string } | undefined} */ (reason);
      unhandled.push(String(err?.stack ?? reason));
    });    const here = path.dirname(fileURLToPath(import.meta.url));
    /** @param {string} rel @returns {Promise<any>} */
    const load = (rel) => import(pathToFileURL(path.resolve(here, rel)).href);
    const { state } = await load("../../dist/renderer/state/state.js");
    stateRef = state;
    // 本段主体这几个模块走**字面量 import()** 而非 load(…):说明符写成字面量后,门禁的
    // 静态抽取器才看得见它们(判据只认 `import("字面量")`),否则「已被测试到达」这一事实
    // 只能靠豁免表记着。仍是动态 import —— refs 在模块初始化期抓 document,必须晚于上面的
    // setGlobalSlot 才加载,改成静态 import 会直接跑不通。
    const fileList = await import("../../dist/renderer/convert/file-list.js");
    const convertFlow = await import("../../dist/renderer/convert/convert-flow.js");
    const settingsPanel = await load("../../dist/renderer/settings/settings-panel.js");
    const settingsDrawer = await load("../../dist/renderer/settings/settings-drawer.js");
    const recentFiles = await import("../../dist/renderer/ui/recent-files.js");
    const firstRunGuide = await import("../../dist/renderer/ui/first-run-guide.js");
    const { t } = await load("../../dist/core/i18n/index.js");
    // 状态元素取自 refs 模块自身:同进程内前序段可能已加载过该模块(元素绑定在
    // 当时的 document stub 上),读自己的 stub 会与被测模块脱节。
    const { DEFAULT_SETTINGS } = await load("../../dist/core/settings/settings-defaults.js");
    const refs = await load("../../dist/renderer/dom/refs.js");
    const { dropZone, histCount, histToggle, historyBar, statusEl, tocInput } = refs;
    for (const exported of Object.values(refs)) hardenElementShape(exported);
    /**
     * ADR-075 阶段④:`ui/recent-files` 与 `ui/first-run-guide` 的跨功能协作改为收
     * deps 形参(由组合根 renderer.ts 组装;这两个模块不再静态 import convert/settings/wizard)。
     * 桩带计数而非空函数:本段驱动的两条路径(清空最近 / 离开空态收起)按理都不触达
     * 协作面,若哪条经它们走了,下面的断言当场变红 —— 空桩会把断链静默放过(fail-open)。
     * @type {string[]}
     */
    const crossFeatureCalls = [];
    /** @type {import("../../dist/renderer/ui/recent-files.js").RecentFilesDeps} */
    const recentFilesDeps = {
      applySelection: (files) => { crossFeatureCalls.push(`applySelection:${files.length}`); },
      runConvert: (filePath, format) => {
        crossFeatureCalls.push(`runConvert:${filePath}:${format}`);
        return Promise.resolve();
      },
      syncSuppressCompleteDialog: (checked) => {
        crossFeatureCalls.push(`syncSuppressCompleteDialog:${checked}`);
      },
      applyDrawerOpenState: (open) => {
        crossFeatureCalls.push(`applyDrawerOpenState:${open}`);
      },
    };
    /** @type {import("../../dist/renderer/ui/first-run-guide.js").FirstRunGuideDeps} */
    const firstRunGuideDeps = {
      openBookWizard: () => { crossFeatureCalls.push("openBookWizard"); },
    };
    // 长度经函数取,不被前面的 `length === 0` 断言收窄成字面量 0(见 8b 的注)
    const callCount = () => crossFeatureCalls.length;
    // state / i18n 为进程级单例(验收 runner 顺序跑段):本段会改语言与设置,
    // 收尾必须复位,否则后续段的文案/状态断言会被污染。
    const { setLanguage } = await load("../../dist/core/i18n/index.js");
    setLanguageRef = setLanguage;
    stateSnapshot = {
      settings: state.settings,
      selectedFormat: state.selectedFormat,
      selectedFiles: state.selectedFiles,
      suppressCompleteDialog: state.suppressCompleteDialog,
      firstRun: state.firstRun,
    };
    // file-list 的舞台跃迁通知端口:实现体在 ui/recent-files 的 evaluateAutoCollapse,
    // 这里接**真实实现**(与组合根 renderer.ts 的 fileListDeps 同一份)。此前接的是空桩,
    // 「自动收起」这条语义因此零断言(REQ-239)。本块(9 档)排在下面各步之前正是因为
    // 该实现体持有一份模块级快照(上次「有无文件」),它的「首次渲染」前提要求那时
    // 还一次舞台跃迁都没发生过。
    /** @type {import("../../dist/renderer/convert/file-list.js").FileListDeps} */
    const fileListDeps = { onStageChanged: recentFiles.evaluateAutoCollapse };
    const saveFailed = t("preset.saveFailed");
    const countCalls = () => calls.filter((c) => "lastSessionFiles" in c).length;

    /* ================= 9. 舞台浮层自动收起 + 最近区块刷新(REQ-239) =================
     * 这两条语义此前在整棵测试树里零断言:舞台跃迁通知(convert/file-list 的
     * onStageChanged 端口)与转换成功后的最近区块刷新(state.recentRefreshHandler)。
     * 两者的可观测面都很窄,且都不是「调用计数」而是**产物**:
     * - 收起 = historyBar.dataset.open 与 histToggle 的 aria-expanded 两个写点
     *   (recent-files 的 setHistoryOpen 是唯一写者);
     * - 刷新 = histCount 文本与新建的历史行节点上的文件名。
     * 故断言全落在产物上,不落在「桩被调了几次」上(否则反向变异一改就穿帮)。
     */
    // 组合根那一行接线(9i 的钉点)与本段自装的 deps 是同一句:段内跑不了组合根
    // (它在模块体里就跑初始化与 IPC),所以接线那一半只能读源文本,见 9i。
    recentFiles.bindRecentFilesEvents(recentFilesDeps); // 历史条的 toggle/清空/行点击监听
    const historyOpen = () => historyBar.dataset.open;
    const ariaExpanded = () => histToggle.getAttribute("aria-expanded");
    /** 派发 toggle 点击(= 用户手动展开/收起;派发而非直接改 dataset:那条监听本身
     *  也得钉住,且下面的 9c 断言只有「监听真的跑了」才会绿)。 */
    const clickHistToggle = () => histToggle.dispatchEvent({ type: "click" });

    // ---- 9a. 首次渲染一律收起(浮层语义:默认展开即默认遮挡) ----
    await suite.case("历史条首次渲染一律收起(舞台此刻为空也收起)", () => {
      historyBar.dataset.open = "true"; // 先摆成「展开」:收起必须是一次真实写入
      state.selectedFiles = [];
      recentFiles.renderRecentList([
        { path: "C:\\session-persist\\recent-a.md", name: "recent-a.md", format: "docx", ts: 1 },
      ]);
      assert(
        historyOpen() === "false" && ariaExpanded() === "false",
        `首次渲染应收起浮层(data-open/aria-expanded 同写),实际 ${historyOpen()}/${ariaExpanded()}`,
      );
      assert(histCount.textContent === "1", `首次渲染应渲染出历史行,计数实际 ${histCount.textContent}`);
    });

    // ---- 9b(A1):空 → 有文件 收起浮层(舞台跃迁端口真的被通知) ----
    await suite.case("舞台空→有文件时收起历史浮层", () => {
      clickHistToggle(); // 手动展开(9a 之后是收起,点一下即展开)
      assert(historyOpen() === "true", `前置条件:手动展开应写成 data-open=true,实际 ${historyOpen()}`);
      fileList.applySelection(fileListDeps, ["C:\\session-persist\\x.md"]);
      assert(
        historyOpen() === "false",
        `空→有文件应自动收起浮层,实际 ${historyOpen()}(端口未通知时此处保持展开)`,
      );
      assert(
        ariaExpanded() === "false",
        `收起必须同步读屏语义,实际 aria-expanded=${ariaExpanded()}`,
      );
    });

    // ---- 9c(A2):已有文件时尊重手动切换(不因再次通知而收起) ----
    await suite.case("舞台有文件时尊重手动展开(不自动收起)", () => {
      // 9b 之后是收起态,点一下即展开;此后 applySelection 不该把它收回去
      clickHistToggle();
      assert(historyOpen() === "true", `前置条件:手动展开应写成 data-open=true,实际 ${historyOpen()}`);
      fileList.applySelection(fileListDeps, ["C:\\session-persist\\y.md"]);
      assert(
        historyOpen() === "true",
        `已有文件时新的通知不应收起手动展开的浮层,实际 ${historyOpen()}`,
      );
      assert(ariaExpanded() === "true", `展开态应同步给读屏,实际 aria-expanded=${ariaExpanded()}`);
    });

    // ---- 9d:非空 → 空 不收起(收起只发生在「让位新内容」这一个方向) ----
    await suite.case("舞台非空→空不收起浮层", () => {
      fileList.applySelection(fileListDeps, []); // 9c 之后浮层是展开态
      assert(
        historyOpen() === "true",
        `清空选择不是「新内容」,不该收起浮层,实际 ${historyOpen()}`,
      );
    });

    // ---- 9e:语言切换(纯重渲染,内容未变)不改折叠态 ----
    await suite.case("语言切换的纯重渲染不改动折叠态也不重复写盘", async () => {
      fileList.applySelection(fileListDeps, ["C:\\session-persist\\y.md"]); // 空→有文件:收起
      await flush(); // 去重键在写成功后回填:不等它落地,下一次重渲染会被判成新内容
      clickHistToggle(); // 手动展开
      const writesBefore = countCalls();
      setLanguage("en");
      try {
        fileList.renderSelection(fileListDeps); // 语言切换后的纯重渲染(内容未变)
        await flush();
        assert(
          historyOpen() === "true",
          `语言切换属纯重渲染,不应改动折叠态,实际 ${historyOpen()}`,
        );
        assert(
          countCalls() === writesBefore,
          `纯重渲染不应重复写会话文件,实际新增 ${countCalls() - writesBefore} 次`,
        );
      } finally {
        // 复位放 finally:上面任一断言失败都不能把英文文案漏给后续各步
        // (它们的期望文案是进入本块时按中文取的)。
        setLanguage("zh");
      }
    });

    /* ---- 9f-9h(B 档):最近区块的刷新通知(state.recentRefreshHandler) ---- */
    // 消费侧走真实转换(convert/convert-flow 的单文件流程),成功/失败两态都跑一遍;
    // 呈现面(ui/dialogs)按组合根同一份端口清单装配,只记调用不真弹窗。
    /** @type {import("../../dist/renderer/convert/convert-flow.js").ConvertFlowDeps} */
    const convertFlowDeps = {
      showPrecheckDialog: () => Promise.resolve(true),
      precheckFileLabels: (paths) => [...paths],
      showSummary: () => {},
      showCompleteDialog: () => {},
      showBatchDialog: () => {},
    };
    state.recentRefreshHandler = recentFiles.refreshRecentFiles; // 与组合根 renderer.ts 同一行接线
    mainRecentFiles = [
      { path: "C:\\session-persist\\recent-a.md", name: "recent-a.md", format: "docx", ts: 1 },
    ];
    recentFiles.renderRecentList(mainRecentFiles);
    const nodesBefore = createdNodes.length;
    const rowTextPresent = (/** @type {string} */ name) =>
      createdNodes.slice(nodesBefore).some((node) => node.textContent === name);

    await suite.case("转换成功后最近区块被刷新(计数与行文本都更新)", async () => {
      await convertFlow.runConvert(convertFlowDeps, "C:\\session-persist\\fresh.md", "docx");
      await flush(); // 刷新回调是 void 启动,须等它落地
      assert(
        histCount.textContent === "2",
        `成功转换后历史计数应更新为 2,实际 ${histCount.textContent}`,
      );
      assert(
        rowTextPresent("fresh.md"),
        "成功转换后历史条应渲染出新行的文件名,实际未找到该行节点",
      );
      assert(
        uiStateGetCalls.length === 1,
        `成功转换应恰好读一次 ui-state,实际 ${uiStateGetCalls.length} 次`,
      );
      // 接线那一半:段内跑不了组合根(它模块体即初始化 + IPC),故这一行读源文本。
      // 钉的是「组合根确实把刷新回调接到 ui 侧的 refreshRecentFiles」——
      // 上面那段运行期行为钉的是「回调确实被调用且刷出了新行」,两半合起来才闭环。
      // 仓库根取 harness/paths.js 的单源,不在段内按目录层级上跳自算 —— 自算写法
      // 会被 no-self-computed-root 判红(上跳基准随目录改层级静默指错位置)。
      const rendererSource = fs.readFileSync(
        path.resolve(ROOT, "src/renderer/renderer.ts"),
        "utf8",
      );
      assert(
        rendererSource.includes("state.recentRefreshHandler = refreshRecentFiles"),
        "组合根应把 state.recentRefreshHandler 接到 ui 侧的 refreshRecentFiles",
      );
    });

    await suite.case("转换失败不刷新最近区块(ui-state 不多读一次)", async () => {
      convertOutcome = { ok: false, error: "EACCES: 源文件不可读" };
      statusEl.textContent = "";
      const readsBefore = uiStateGetCalls.length;
      await convertFlow.runConvert(convertFlowDeps, "C:\\session-persist\\failed.md", "docx");
      await flush();
      assert(
        uiStateGetCalls.length === readsBefore,
        `失败路径不应多读 ui-state,实际新增 ${uiStateGetCalls.length - readsBefore} 次`,
      );
      assert(
        histCount.textContent === "2" && !rowTextPresent("failed.md"),
        `失败转换不应进历史条,实际计数 ${histCount.textContent}`,
      );
      assert(
        statusEl.textContent !== "" && statusEl.classList.contains("status--error"),
        "失败路径本身仍须有可见反馈(本档只钉「不刷新」,不顺带放过静默)",
      );
      convertOutcome = { ok: true, outputPath: "C:\\session-persist\\out.docx" };
    });

    await suite.case("最近区块刷新时读 ui-state 失败:列表原样且状态区不报错", async () => {
      uiStateGetFails = true;
      statusEl.textContent = "";
      statusEl.classList.remove("status--error");
      const nodesBefore2 = createdNodes.length;
      await recentFiles.refreshRecentFiles();
      await flush();
      assert(
        histCount.textContent === "2",
        `读取失败应保持当前展示,实际计数 ${histCount.textContent}`,
      );
      assert(
        createdNodes.length === nodesBefore2,
        `读取失败不应重绘历史行,实际新建 ${createdNodes.length - nodesBefore2} 个节点`,
      );
      assert(
        statusEl.textContent === "" && !statusEl.classList.contains("status--error"),
        `刷新失败是静默降级(保持展示),不该在状态区报错,实际 ${JSON.stringify(statusEl.textContent)}`,
      );
      uiStateGetFails = false;
    });

    // ---- 9i:舞台跃迁端口的组合根接线(源文本层,理由同 9f 的那一半) ----
    await suite.case("组合根把舞台跃迁端口接到 evaluateAutoCollapse", () => {
      // 仓库根取 harness/paths.js 的单源,不在段内按目录层级上跳自算 —— 自算写法
      // 会被 no-self-computed-root 判红(上跳基准随目录改层级静默指错位置)。
      const rendererSource = fs.readFileSync(
        path.resolve(ROOT, "src/renderer/renderer.ts"),
        "utf8",
      );
      assert(
        rendererSource.includes("onStageChanged: evaluateAutoCollapse"),
        "组合根的 fileListDeps 应把 onStageChanged 接到 ui 侧的 evaluateAutoCollapse",
      );
    });

    // 本块自己也经 applySelection 写过会话文件;下面第 1 步起以 `calls` 为**绝对**
    // 计数基线(recordAt(calls, 0/1/2)),故此处把写入流水交还到零起点。
    calls.length = 0;

    // ---- 1. renderSelection:一次变更 = 一次 uiStateSet(单一写入点,无重复 mutation) ----
    state.selectedFiles = ["C:\\session-persist\\case-1.md"];
    await suite.case("renderSelection 一次变更只写一次会话文件", async () => {
    fileList.renderSelection(fileListDeps);
    await flush(); // 去重键在写成功后回填,须等 then 分支落地
    assert(countCalls() === 1, `renderSelection 应只写一次会话文件,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(recordAt(calls, 0).lastSessionFiles) === JSON.stringify(["C:\\session-persist\\case-1.md"]),
      `写入内容应等于当前选择,实际 ${JSON.stringify(recordAt(calls, 0))}`,
    );
    });

    await suite.case("内容未变的纯重渲染不重复写", async () => {
    // 内容未变的纯重渲染(语言切换等)不重复写
    fileList.renderSelection(fileListDeps);
    await flush();
    assert(countCalls() === 1, `内容未变的重渲染不应重复写,实际 ${countCalls()} 次`);
    });

    await suite.case("清空选择经同一写入点落一次空数组", async () => {
    // 清空选择同样经同一写入点落一次
    state.selectedFiles = [];
    fileList.renderSelection(fileListDeps);
    await flush();
    assert(countCalls() === 2, `清空选择应写一次,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(recordAt(calls, 1).lastSessionFiles) === JSON.stringify([]),
      "清空选择应写入空数组",
    );
    });

    // ---- 2. 排序路径(moveItem → renderMultiList)也只写一次,内容为重排后顺序 ----
    const pair = ["C:\\session-persist\\sort-a.md", "C:\\session-persist\\sort-b.md"];
    state.selectedFiles = [...pair];
    fileList.moveItem(0, 1);
    await flush();
    await suite.case("排序重排只写一次且内容为重排后顺序", () => {
    assert(countCalls() === 3, `排序重排应写一次,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(recordAt(calls, 2).lastSessionFiles) === JSON.stringify([...pair].reverse()),
      `排序后应写入新顺序,实际 ${JSON.stringify(recordAt(calls, 2).lastSessionFiles)}`,
    );
    assert(
      JSON.stringify(state.selectedFiles) === JSON.stringify([...pair].reverse()),
      "编辑内容(内存选择)应与写入内容一致",
    );
    });

    // ---- 3. 写失败:不静默,状态区给统一失败文案 + 保留编辑内容 ----
    rejectWrites = true;
    statusEl.textContent = "";
    state.selectedFiles = ["C:\\session-persist\\case-3.md"];
    fileList.renderSelection(fileListDeps);
    await flush();
    await suite.case("会话文件写失败在状态区可见并保留编辑内容", () => {
    assert(
      statusEl.textContent === saveFailed,
      `会话文件写失败应在状态区可见(期望 ${JSON.stringify(saveFailed)},实际 ${JSON.stringify(statusEl.textContent)})`,
    );
    assert(statusEl.classList.contains("status--error"), "写失败应走错误语义样式(非静默成功)");
    assert(
      JSON.stringify(state.selectedFiles) === JSON.stringify(["C:\\session-persist\\case-3.md"]),
      "写失败必须保留编辑内容(不清空/不回滚列表)",
    );
    });

    // ---- 4. 失败后可恢复:同内容下一次保存仍真正重试(失败不记入去重键) ----
    const beforeRetry = countCalls();
    rejectWrites = false;
    fileList.renderSelection(fileListDeps);
    await flush();
    await suite.case("失败后同内容再次保存真正重试一次", () => {
    assert(
      countCalls() === beforeRetry + 1,
      `失败后同内容再次保存应重试一次,实际新增 ${countCalls() - beforeRetry} 次`,
    );
    });

    // ---- 5. 设置面板「不再提示」写失败同一反馈口径,勾选态保留 ----
    rejectWrites = true;
    statusEl.textContent = "";
    settingsPanel.setSuppressCompleteDialog(false);
    await flush();
    await suite.case("完成弹窗偏好写失败给出同一文案且保留勾选态", () => {
    assert(
      statusEl.textContent === saveFailed,
      `完成弹窗偏好写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      state.suppressCompleteDialog === false,
      "写失败必须保留用户勾选态(编辑内容不丢)",
    );
    });

    // ---- 6. 抽屉开合记忆(settings-drawer):写失败同一反馈口径,开合态保留 ----
    rejectWrites = true;
    statusEl.textContent = "";
    settingsDrawer.openSettingsDrawer();
    settingsDrawer.closeSettingsDrawer();
    await flush();
    await suite.case("抽屉开合记忆写失败给出同一文案且开合态保留", () => {
    assert(
      statusEl.textContent === saveFailed,
      `抽屉开合记忆写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      !settingsDrawer.isSettingsDrawerOpen(),
      "抽屉开合是本次会话的真实状态:写失败不应强制改变开合",
    );
    });

    // ---- 7. 清空最近记录(recent-files):写失败保留列表,不静默显示为空 ----
    /** @type {Array<Record<string, unknown>>} */
    const recentCalls = [];
    // 该模块的 uiStateSet 单独可控(清空动作走 recentFiles 字段)
    apiStub.uiStateSet = (/** @type {Record<string, unknown>} */ patch) => {
      recentCalls.push(patch);
      if (!("recentFiles" in patch)) return Promise.resolve({ ...patch });
      return Promise.reject(new Error("EACCES: ui-state.json"));
    };
    recentFiles.renderRecentList([
      { path: "C:\\session-persist\\keep.md", name: "keep.md", format: "docx", ts: 5 },
    ]);
    statusEl.textContent = "";
    await recentFiles.clearRecentFiles();
    await suite.case("清空最近只发一次写且提交空数组", () => {
    assert(recentCalls.length === 1, `清空最近应只发一次 ui-state 写,实际 ${recentCalls.length} 次`);
    assert(
      JSON.stringify(recordAt(recentCalls, 0)) === JSON.stringify({ recentFiles: [] }),
      `清空最近应提交空数组,实际 ${JSON.stringify(recordAt(recentCalls, 0))}`,
    );
    });

    await suite.case("清空最近写失败保留历史列表且不隐藏历史条", () => {
    assert(
      statusEl.textContent === saveFailed,
      `清空最近写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      histCount.textContent === "1",
      `写失败必须保留历史列表(main 侧记录仍在),实际计数 ${JSON.stringify(histCount.textContent)}`,
    );
    assert(
      !historyBar.classList.contains("hidden"),
      "写失败不应把历史条隐藏成已清空的样子",
    );
    // 注入桩可观测性:渲染/清空这两条路径按理都不触达 convert·settings 的协作面,
    // 一旦某天悄悄直连过去(或桩退化成空函数),这条会先红。空桩会让它恒绿。
    assert(
      crossFeatureCalls.length === 0,
      `清空最近路径不应触达跨功能协作面,实际调用 ${JSON.stringify(crossFeatureCalls)}`,
    );
    });

    // ---- 8. 首启引导(first-run-guide):写失败同一反馈口径,收起态保留 ----
    // 直接构造"空态 + firstRun"后离开空态:引导收起并写回 firstRun=false
    state.firstRun = true;
    dropZone.dataset.stage = "empty";
    firstRunGuide.initFirstRunGuide(firstRunGuideDeps);
    dropZone.dataset.stage = "single"; // 离开空态 → 视为已引导 → 写回 firstRun=false
    firstRunGuide.syncFirstRunGuide();
    await flush();
    await suite.case("首启引导离开空态写回 firstRun=false 并保留收起态", () => {
    assert(
      lastRecord(recentCalls).firstRun === false,
      `离开空态应写回 firstRun=false,实际 ${JSON.stringify(lastRecord(recentCalls))}`,
    );
    assert(state.firstRun === false, "引导收起后内存标志应为 false");
    assert(
      statusEl.textContent === saveFailed,
      `首启引导状态写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    console.log("[ok] ui-state-failure-feedback:完成弹窗/抽屉开合/清空最近/首启引导 四处静默点统一反馈 断言通过");
    });

    // ---- 8b. 注入面:必填形参 + 桩本身可观测(两条都防「静默不生效」) ----
    await suite.case("跨功能协作面是必填形参且注入桩真的在记录", () => {
      // ① arity:port 若被改成「带默认值的可选形参」,缺接线时运行期静默不生效
      //    (fail-open),门禁与本段其余断言都看不见这一层,只有 arity 会当场翻脸。
      //    JS 侧形参带默认值 ⇒ Function.length 不计它 ⇒ 退化即 length 变小。
      assert(
        recentFiles.initUiStateRestore.length === 1
          && recentFiles.bindRecentFilesEvents.length === 1,
        "recent-files 真正用到协作面的两个入口应各自必收 deps 形参(不得设为可选/带默认值)",
      );
      assert(
        firstRunGuide.initFirstRunGuide.length === 1,
        "initFirstRunGuide 应必收 deps 形参(不得设为可选/带默认值)",
      );
      // ② 桩自检:直接打一次桩并确认记录到了 —— 否则「路径不应触达协作面」那条
      //    断言在「桩其实是空函数」时恒绿,等于没写。
      //    长度经 helper 取:紧邻的 `length === 0` 断言会把 TS 的类型收窄成字面量 0,
      //    随后的 `=== 1` 就被判为「两型无交集」(TS2367),而收窄本身是假信号。
      assert(crossFeatureCalls.length === 0,
        `前七步不应触达跨功能协作面,实际 ${JSON.stringify(crossFeatureCalls)}`);
      recentFilesDeps.applySelection(["C:\\probe\\only.md"]);
      assert(
        callCount() === 1 && crossFeatureCalls[0] === "applySelection:1",
        `注入桩应当真的记录调用(空函数会让协作面断言恒绿),实际 ${JSON.stringify(crossFeatureCalls)}`,
      );
      crossFeatureCalls.length = 0;
    });

    // ---- 9. 设置保存失败(persistSettings):保留编辑内容与控件,不回滚到 main cache ----
    state.settings = { ...DEFAULT_SETTINGS, toc: false };
    tocInput.checked = false;
    rejectSettings = true;
    statusEl.textContent = "";
    // 用户在控件上改了 toc 并触发整组写回(模拟绑定层的 state 先行更新)
    state.settings.toc = true;
    tocInput.checked = true;
    settingsPanel.persistSettings({ toc: true });
    await flush();
    await flush();
    await suite.case("设置保存失败保留编辑内容与控件值且不回滚到 main cache", () => {
    assert(
      state.settings.toc === true && tocInput.checked === true,
      "设置保存失败必须保留用户当前编辑内容与控件值(不得回滚到 main cache)",
    );
    assert(
      statusEl.textContent === saveFailed,
      `设置保存失败应给出可见提示,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      lastRecord(settingsCalls).toc === true,
      `失败请求应已提交用户编辑值,实际 ${JSON.stringify(lastRecord(settingsCalls))}`,
    );
    assert(
      loggedErrors.some((line) => line.includes("设置写盘失败")),
      `保存失败必须留痕(console.error),实际 ${JSON.stringify(loggedErrors)}`,
    );
    console.log("[ok] settings-save-failure:失败保留草稿与控件/状态区可见提示 断言通过");
    });

    // ---- 10. 失败后的下一次保存:并入待重试草稿并真正落盘(main 权威值回填) ----
    rejectSettings = false;
    statusEl.textContent = "";
    settingsPanel.persistSettings({ format: "pdf" });
    await flush();
    await flush();
    await suite.case("重试保存同时提交失败草稿与新编辑且 state 为 main 权威合并值", () => {
    assert(
      lastRecord(settingsCalls).toc === true && lastRecord(settingsCalls).format === "pdf",
      `重试保存应同时提交失败草稿与新编辑,实际 ${JSON.stringify(lastRecord(settingsCalls))}`,
    );
    assert(
      state.settings.toc === true && state.settings.format === "pdf",
      "重试成功后 state 应为 main 权威合并值",
    );
    assert(
      statusEl.textContent === "",
      `成功后未保存提示应被清除,实际 ${JSON.stringify(statusEl.textContent)} / errors=${JSON.stringify(loggedErrors)}`,
    );
    });

    // 草稿已清空:再保存只带新编辑(不重复携带已落盘字段的 patch)
    settingsPanel.persistSettings({ theme: "dark" });
    await flush();
    await flush();
    await suite.case("成功后待重试草稿清空且权威回填不丢用户编辑", () => {
    assert(
      lastRecord(settingsCalls).toc === undefined,
      `成功后待重试草稿应清空,实际 ${JSON.stringify(lastRecord(settingsCalls))}`,
    );
    assert(
      state.settings.toc === true && state.settings.theme === "dark",
      "草稿清空后仍应保留 main 已落盘值(权威回填不丢用户编辑)",
    );
    console.log("[ok] settings-save-retry:草稿并入重试/成功后清除未保存提示/权威回填不丢编辑 断言通过");
    });

    // ---- 11. 成功保存的既有副作用不受影响(语言/主题/格式回填链路) ----
    mainSettings = null;
    state.settings = { ...DEFAULT_SETTINGS };
    settingsPanel.persistSettings({ language: "en", theme: "dark" });
    await flush();
    await flush();
    await suite.case("成功保存仍回填语言/主题并同步转换格式且无未捕获 rejection", () => {
    assert(
      state.settings.language === "en" && state.settings.theme === "dark" &&
        state.selectedFormat === state.settings.format,
      "成功保存仍应回填语言/主题并同步转换格式(验收 3:成功路径不破坏)",
    );
    assert(
      unhandled.length === 0,
      `持久化链路不应产生未捕获 rejection,实际 ${JSON.stringify(unhandled)}`,
    );
    console.log("[ok] settings-save-success:成功权威回填与副作用保持 断言通过");
    });
  } finally {
    console.error = originalError;
    process.removeAllListeners("unhandledRejection");
    // 复位进程级单例(state / i18n 语言),避免污染后续段
    if (stateSnapshot && stateRef) Object.assign(stateRef, stateSnapshot);
    if (setLanguageRef) setLanguageRef("zh");
    setGlobalSlot("document", originalDocument);
    setGlobalSlot("window", originalWindow);
    setGlobalSlot("MutationObserver", originalMutationObserver);
  }
  return { cases: suite.results };
}
