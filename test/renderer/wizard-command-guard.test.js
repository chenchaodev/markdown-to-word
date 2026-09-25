/**
 * renderer 向导命令守卫与预检按钮忙态测试:
 * - 向导 skip/下一步/上一步/付印入口统一前置校验:转换/预检期间一律不响应、步序不变,
 *   命令结算后恢复;
 * - 付印链:整条链 single-flight(docx → pdf 依次执行,链内不再起第二条命令),
 *   前序留下前台模态(完成弹窗)时第二次格式转换按单一明确结果拦下;
 * - 向导打开(模态)期间背景快捷键与新命令阻断,结算后恢复;
 * - 预检进行中转换按钮视觉置灰(忙态探针与点击守卫同源),结算后复位。
 * 用最小 DOM stub 动态载入真实 dist renderer 模块,不引入新依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(`wizard-command-guard 断言失败:${msg}`);
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
    replace(list) {
      values.clear();
      for (const name of list) values.add(name);
    },
    list: () => [...values],
  };
}

/** 元素 stub:记录监听器与子节点(向导控件由 h() 动态创建,不在 refs,需按 id 定位)。
 *  className 与 classList 双向同步:动态外壳按 class 串建类,弹窗按 classList 显隐。 */
function makeElement(closestSelector = "") {
  const listeners = new Map();
  const classes = makeClassList(["hidden"]);
  const el = {
    id: "",
    dataset: {},
    style: {},
    textContent: "",
    innerHTML: "",
    title: "",
    disabled: false,
    hidden: false,
    type: "",
    value: "",
    checked: false,
    inert: false,
    selectedOptions: [],
    children: [],
    classList: classes,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {},
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) {
      if (name === "id") this.id = String(value);
      if (name === "class") classes.replace(String(value).split(/\s+/).filter(Boolean));
    },
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    closest(selector) {
      return closestSelector !== "" && selector.includes(closestSelector) ? el : null;
    },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    get listener() { return listeners; },
  };
  Object.defineProperty(el, "className", {
    get: () => classes.list().join(" "),
    set: (value) => classes.replace(String(value).split(/\s+/).filter(Boolean)),
  });
  return el;
}

/** 深度优先按 id 找动态构建的元素(向导外壳由 h() 创建;子节点含文本,需跳过非元素)。 */
function findById(root, id) {
  if (root === null || typeof root !== "object") return null;
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** 冲刷微任务与宏任务,让未 await 的命令链(void 启动)跑完。 */
async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** index.html 中的模态遮罩容器 id(动态创建的向导遮罩走 class 判定)。 */
const OVERLAY_IDS = new Set(["precheckDialog", "completeDialog", "batchDialog", "presetSaveDialog"]);

export async function run() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const mergeCalls = [];
  const pendingPrechecks = [];
  let precheckCalls = 0;
  const docListeners = new Map();
  const body = makeElement();
  // 进程内共享的 DOM stub:dist 模块在进程内只 import 一次(dom/refs 元素解析与
  // dialogs 的模块级事件绑定发生在首个 import 段),元素表须跨段共享
  globalThis.__m2wRendererDomStub ??= { elements: new Map(), windowListeners: new Map() };
  const { elements, windowListeners } = globalThis.__m2wRendererDomStub;
  const elementFor = (id) => {
    let el = elements.get(id);
    if (!el) {
      el = makeElement();
      elements.set(id, el);
    }
    return el;
  };
  /** 可见遮罩判定:refs 元素按 id 识别,动态外壳按 class 识别。
   *  元素表跨段共享,元素可能由其他测试段的工厂创建(className 不一定存在)→ 兜底取值。 */
  const isOverlay = (el, id) => OVERLAY_IDS.has(id) || String(el.className ?? "").includes("dialog-overlay");
  // 元素表跨段共享,前序段可能留下可见弹窗遮罩:统一复位为隐藏,模态判定从干净态起算
  const hideOverlays = () => {
    for (const [id, el] of elements) if (OVERLAY_IDS.has(id)) el.classList.add("hidden");
  };
  const fakeDocument = {
    activeElement: makeElement(),
    documentElement: makeElement(),
    body,
    getElementById: (id) => elementFor(id),
    querySelector: (selector) => {
      if (!selector.includes("dialog-overlay")) return null;
      for (const [id, el] of elements) {
        if (isOverlay(el, id) && !el.classList.contains("hidden")) return el;
      }
      return null;
    },
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
        return new Promise((resolve) => { pendingPrechecks.push(resolve); });
      },
      convert: () => Promise.resolve({ ok: true, outputPath: "out.docx", warnings: [] }),
      convertMerge: (files, format) => {
        mergeCalls.push(format);
        return Promise.resolve({ ok: true, outputPath: `out.${format}`, warnings: [] });
      },
      convertBatch: () => Promise.resolve({ ok: true }),
      convertCancel: () => Promise.resolve(),
      onConvertProgress: () => () => {},
      onBatchProgress: () => () => {},
      openMarkdowns: () => Promise.resolve([]),
      settingsSet: () => Promise.resolve(),
      uiStateSet: () => Promise.resolve(),
    },
    setTimeout,
    clearTimeout,
    addEventListener(type, fn) {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener(type) { windowListeners.delete(type); },
  };

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const distUrl = (rel) => pathToFileURL(path.resolve(here, "../../dist/renderer", rel)).href;
    const flow = await import(distUrl("convert/convert-flow.js"));
    const { state } = await import(distUrl("state/state.js"));
    const runtime = await import(distUrl("wizard/wizard-runtime.js"));
    const bookWizard = await import(distUrl("wizard/book-wizard.js"));
    const actions = await import(distUrl("convert/events/convert-actions.js"));
    const fileList = await import(distUrl("convert/file-list.js"));

    actions.bindConvertActionsEvents();
    const keydown = docListeners.get("keydown");
    const convertBtn = elementFor("convertBtn");
    const completeDialog = elementFor("completeDialog");
    const step = () => runtime.currentStep;
    hideOverlays();

    // ---- 1. 预检进行中:转换按钮视觉置灰(忙态探针与点击守卫同源) ----
    state.selectedFiles = ["C:\\work\\a.md"];
    state.suppressCompleteDialog = true; // 结果弹窗不参与本段判定
    fileList.updateActionButtons();
    assert(convertBtn.disabled === false, "空闲态转换按钮应可用");
    const chain = flow.withPrecheck(["C:\\work\\a.md"], () => {});
    assert(convertBtn.disabled === true, "预检进行中转换按钮应置灰");
    assert(flow.isConvertCommandBlocked(), "预检进行中命令锁应生效");
    keydown({ key: "Enter", ctrlKey: true, preventDefault() {} });
    assert(precheckCalls === 1, "预检未决时快捷键不得另起预检");
    pendingPrechecks.shift()([]);
    await chain;
    await flush();
    assert(convertBtn.disabled === false, "预检结算后转换按钮应恢复可用");
    assert(!flow.isConvertCommandBlocked(), "预检结算后命令锁应释放");

    // ---- 2. 预检未决时按钮点击被阻断(视觉与守卫一致),结算后恢复 ----
    const chain2 = flow.withPrecheck(["C:\\work\\a.md"], () => {});
    assert(convertBtn.disabled === true, "第二条预检链未决时按钮应保持置灰");
    convertBtn.listener.get("click")();
    assert(precheckCalls === 2, "预检未决时按钮点击不得另起预检");
    pendingPrechecks.shift()([]);
    await chain2;
    await flush();
    assert(convertBtn.disabled === false, "预检结算后按钮忙态复位");

    // ---- 3. 向导打开:自身遮罩不计阻断,背景命令/快捷键阻断 ----
    bookWizard.openBookWizard();
    const overlay = body.children[0];
    assert(overlay && overlay.id === "bookWizard", "向导应构建自己的模态容器");
    // 动态外壳不在 refs 中,登记进元素表以便模态判定与按 id 定位(Esc 链亦按 id 查询)
    elements.set("bookWizard", overlay);
    assert(!overlay.classList.contains("hidden"), "向导打开后遮罩可见");
    assert(flow.isBackgroundCommandBlocked(), "向导打开时背景命令应被判定阻断");
    const precheckBeforeModal = precheckCalls;
    keydown({ key: "Enter", ctrlKey: true, preventDefault() {} });
    await flow.withPrecheck(["C:\\work\\a.md"], () => {});
    assert(precheckCalls === precheckBeforeModal, "向导打开时不得启动新预检");

    // ---- 4. 向导内入口统一前置校验:受阻不动,结算后恢复 ----
    const skipBtn = findById(overlay, "wizardSkip");
    const prevBtn = findById(overlay, "wizardPrev");
    const nextBtn = findById(overlay, "wizardNext");
    const finishBtn = findById(overlay, "wizardFinish");
    assert(skipBtn && prevBtn && nextBtn && finishBtn, "向导应构建 skip/prev/next/finish 控件");
    assert(step() === 1, "向导应停在第 1 步");

    state.mode = "single"; // 转换进行中
    skipBtn.listener.get("click")();
    nextBtn.listener.get("click")();
    prevBtn.listener.get("click")();
    finishBtn.listener.get("click")();
    await flush();
    assert(step() === 1, "转换进行中向导步序不应变化");
    assert(mergeCalls.length === 0, "转换进行中付印不应发起合并转换");
    state.mode = null; // 结算

    nextBtn.listener.get("click")();
    assert(step() === 2, "命令结算后下一步应恢复");
    prevBtn.listener.get("click")();
    assert(step() === 1, "命令结算后上一步应恢复");
    skipBtn.listener.get("click")();
    assert(step() === 2, "命令结算后跳过应恢复");

    // ---- 5. 付印链:single-flight + 两格式依次,链内不起第二条命令 ----
    runtime.draft.sources = ["C:\\work\\a.md", "C:\\work\\b.md"];
    runtime.draft.format = "both";
    state.selectedFiles = ["C:\\work\\a.md", "C:\\work\\b.md"];
    for (let i = 0; i < 6 && step() < 7; i++) nextBtn.listener.get("click")();
    assert(step() === 7, "应可推进到最后一步(付印入口)");
    const precheckBeforeFinish = precheckCalls;
    finishBtn.listener.get("click")();
    await flush();
    assert(mergeCalls.length === 2, `付印两格式应依次执行两次合并,实际 ${mergeCalls.length} 次`);
    assert(
      mergeCalls[0] === "docx" && mergeCalls[1] === "pdf",
      `付印格式序应为 docx→pdf,实际 ${mergeCalls}`,
    );
    assert(precheckCalls === precheckBeforeFinish, "付印链经 withPrecheck 持链,空文件列表不发预检 IPC");
    assert(!flow.isConvertCommandBlocked(), "付印链结算后命令锁应释放");
    assert(overlay.classList.contains("hidden"), "付印后向导应关闭");

    // ---- 6. 转换进行中再付印:不并发起第二条链;结算后可再付印 ----
    bookWizard.openBookWizard();
    assert(step() === 1 && !overlay.classList.contains("hidden"), "向导应可复开");
    const finishBtn2 = findById(overlay, "wizardFinish");
    runtime.draft.sources = ["C:\\work\\a.md", "C:\\work\\b.md"];
    state.mode = "merge";
    const mergesBeforeBlocked = mergeCalls.length;
    finishBtn2.listener.get("click")();
    await flush();
    assert(mergeCalls.length === mergesBeforeBlocked, "转换进行中再付印不得并发起第二条链");
    assert(!overlay.classList.contains("hidden"), "受阻时向导保持打开");
    state.mode = null;
    finishBtn2.listener.get("click")(); // 结算后付印生效(单格式 docx,草稿已被 open 重置)
    await flush();
    assert(mergeCalls.length === mergesBeforeBlocked + 1, "结算后付印应恢复");
    assert(mergeCalls.at(-1) === "docx", "单格式付印按草稿格式执行");
    assert(overlay.classList.contains("hidden"), "付印后向导应关闭");

    // ---- 7. 前序留下前台模态(完成弹窗):第二次格式转换按单一明确结果拦下 ----
    bookWizard.openBookWizard();
    runtime.draft.sources = ["C:\\work\\a.md", "C:\\work\\b.md"];
    runtime.draft.format = "both";
    state.suppressCompleteDialog = false; // 转换结束展示完成弹窗(前台模态)
    const mergesBeforeModal = mergeCalls.length;
    findById(overlay, "wizardFinish").listener.get("click")();
    await flush();
    assert(
      mergeCalls.length === mergesBeforeModal + 1,
      `完成弹窗在前台时第二次格式转换应被统一守卫拦下,实际新增 ${mergeCalls.length - mergesBeforeModal} 次`,
    );
    assert(!completeDialog.classList.contains("hidden"), "付印完成应展示完成弹窗");
    completeDialog.classList.add("hidden");
    assert(!flow.isConvertCommandBlocked(), "弹窗关闭后命令锁应释放");

    // ---- 8. 付印链持链口径固定:整条链经 withPrecheck 单一 flight,两格式之间复检统一守卫 ----
    const wizardSource = fs.readFileSync(
      path.resolve(here, "../../src/renderer/wizard/book-wizard.ts"),
      "utf8",
    );
    const finishBody = wizardSource.slice(wizardSource.indexOf("async function finishWizard"));
    assert(
      finishBody.includes("withPrecheck(") && finishBody.includes("isBackgroundCommandBlocked()"),
      "付印链应经 withPrecheck 持链,并在两格式之间复检统一前置校验",
    );
    const entryBlock = wizardSource.slice(
      wizardSource.indexOf('skipBtn.addEventListener("click"'),
      wizardSource.indexOf('finishBtn.addEventListener("click"'),
    );
    assert(
      (entryBlock.match(/isWizardCommandBlocked\(\)/g) ?? []).length >= 3,
      "skip/上一步/下一步三个入口应各自经统一前置校验",
    );

    console.log("[ok] wizard-command-guard:向导入口守卫/付印链/预检按钮忙态断言通过");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}
