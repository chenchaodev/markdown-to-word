/**
 * renderer 持久化失败反馈直测(测试经 dist/renderer/**,零依赖最小 DOM stub):
 * - 会话持久化单一写入点:renderSelection 与 renderMultiList/moveItem 每次变更
 *   只发一次 uiStateSet;内容未变的纯重渲染不再产生重复 mutation;
 * - ui-state 四处写入(完成弹窗偏好 / 抽屉开合 / 清空最近 / 首启引导)写失败统一
 *   给出状态区可见提示(文案取自 i18n 单源)并保留编辑内容,不静默显示成功;
 * - 设置保存失败(persistSettings):保留用户当前编辑内容与控件值(不回滚到
 *   main cache),状态区给出可见提示;下一次保存并入待重试草稿并真正落盘,
 *   成功后清除未保存提示;成功路径的权威回填与语言/主题副作用保持不变。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(`session-persist-feedback 断言失败:${msg}`);
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
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {},
    replaceChildren() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    append() {},
    appendChild() {},
  };
}

/** 等待挂起的 promise 回调(persist 的 then 分支)落地。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 补齐元素 stub 形状:验收 runner 为单进程顺序执行,前序段可能已按自己的
 * document stub 加载过 dom/refs.js(元素绑定在当时的 stub 上)。本段只做"补缺",
 * 不覆盖已有实现,避免跨段加载顺序影响本段断言。
 */
function hardenElementShape(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => hardenElementShape(item, seen));
    return;
  }
  const members = Object.values(value);
  // 容器对象(成员全是对象,如 refs.marginInputs 这类 id→元素映射):
  // 只递归成员,绝不注入元素成员(否则回填会遍历到伪键)
  if (members.length > 0 && members.every((item) => item && typeof item === "object")) {
    members.forEach((item) => hardenElementShape(item, seen));
    return;
  }
  const template = makeElement();
  for (const [key, fallback] of Object.entries(template)) {
    if (value[key] !== undefined) continue;
    value[key] = typeof fallback === "function" ? fallback.bind(value) : fallback;
  }
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalError = console.error;
  // 供 finally 复位用(try 内赋值;模块加载失败时保持 null,复位即跳过)
  let stateSnapshot = null;
  let stateRef = null;
  let setLanguageRef = null;
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  // settingsGet/settingsSet 记录调用;uiStateSet 可切换成功/失败,记录每次 patch
  // (用于断言写入点唯一与内容)
  const calls = [];
  const settingsCalls = [];
  let rejectWrites = false;
  let rejectSettings = false;
  let mainSettings = null;
  globalThis.document = {
    documentElement: makeElement(),
    body: makeElement(),
    getElementById: (id) => el(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    createElementNS: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
  };
  // 首启引导经 MutationObserver 监听 #dropZone 的 data-stage;此处只需注册不触发,
  // 舞台切换由用例直接改 dataset 后显式调 syncFirstRunGuide 驱动。
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.window = {
    api: {
      uiStateSet: (patch) => {
        calls.push(patch);
        return rejectWrites
          ? Promise.reject(new Error("EACCES: ui-state.json"))
          : Promise.resolve({ ...patch });
      },
      settingsSet: (patch) => {
        settingsCalls.push(patch);
        if (rejectSettings) return Promise.reject(new Error("EPERM: settings.json"));
        // 模拟 main 侧 patch 合并(只提交本次 patch 携带的字段)
        mainSettings = { ...(mainSettings ?? {}), ...patch };
        return Promise.resolve({ ...mainSettings });
      },
      settingsGet: () => Promise.resolve(mainSettings ?? {}),
      previewRefresh: () => Promise.resolve(),
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    location: { href: "file:///index.html" },
    localStorage: { getItem: () => null, setItem() {} },
  };

  try {
    // 被测代码在写失败时用 console.error 留痕(契约的一部分,需断言);
    // 全程静音并收集,避免污染段输出
    const loggedErrors = [];
    console.error = (...args) => { loggedErrors.push(args.map(String).join(" ")); };
    // 未捕获的 rejection 也收集:被测链路的异常必须显式暴露而非静默
    const unhandled = [];
    process.on("unhandledRejection", (reason) => {
      unhandled.push(String(reason?.stack ?? reason));
    });    const here = path.dirname(fileURLToPath(import.meta.url));
    const load = (rel) => import(pathToFileURL(path.resolve(here, rel)).href);
    const { state } = await load("../../dist/renderer/state/state.js");
    stateRef = state;
    const fileList = await load("../../dist/renderer/convert/file-list.js");
    const settingsPanel = await load("../../dist/renderer/settings/settings-panel.js");
    const settingsDrawer = await load("../../dist/renderer/settings/settings-drawer.js");
    const recentFiles = await load("../../dist/renderer/ui/recent-files.js");
    const firstRunGuide = await load("../../dist/renderer/ui/first-run-guide.js");
    const { t } = await load("../../dist/core/i18n.js");
    // 状态元素取自 refs 模块自身:同进程内前序段可能已加载过该模块(元素绑定在
    // 当时的 document stub 上),读自己的 stub 会与被测模块脱节。
    const { DEFAULT_SETTINGS } = await load("../../dist/core/settings/settings-defaults.js");
    const refs = await load("../../dist/renderer/dom/refs.js");
    const { dropZone, histCount, historyBar, statusEl, tocInput } = refs;
    for (const exported of Object.values(refs)) hardenElementShape(exported);
    // state / i18n 为进程级单例(验收 runner 顺序跑段):本段会改语言与设置,
    // 收尾必须复位,否则后续段的文案/状态断言会被污染。
    const { setLanguage } = await load("../../dist/core/i18n.js");
    setLanguageRef = setLanguage;
    stateSnapshot = {
      settings: state.settings,
      selectedFormat: state.selectedFormat,
      selectedFiles: state.selectedFiles,
      suppressCompleteDialog: state.suppressCompleteDialog,
      firstRun: state.firstRun,
    };
    const saveFailed = t("preset.saveFailed");
    const countCalls = () => calls.filter((c) => "lastSessionFiles" in c).length;

    // ---- 1. renderSelection:一次变更 = 一次 uiStateSet(单一写入点,无重复 mutation) ----
    state.selectedFiles = ["C:\\session-persist\\case-1.md"];
    fileList.renderSelection();
    await flush(); // 去重键在写成功后回填,须等 then 分支落地
    assert(countCalls() === 1, `renderSelection 应只写一次会话文件,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(calls[0].lastSessionFiles) === JSON.stringify(["C:\\session-persist\\case-1.md"]),
      `写入内容应等于当前选择,实际 ${JSON.stringify(calls[0])}`,
    );
    // 内容未变的纯重渲染(语言切换等)不重复写
    fileList.renderSelection();
    await flush();
    assert(countCalls() === 1, `内容未变的重渲染不应重复写,实际 ${countCalls()} 次`);
    // 清空选择同样经同一写入点落一次
    state.selectedFiles = [];
    fileList.renderSelection();
    await flush();
    assert(countCalls() === 2, `清空选择应写一次,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(calls[1].lastSessionFiles) === JSON.stringify([]),
      "清空选择应写入空数组",
    );

    // ---- 2. 排序路径(moveItem → renderMultiList)也只写一次,内容为重排后顺序 ----
    const pair = ["C:\\session-persist\\sort-a.md", "C:\\session-persist\\sort-b.md"];
    state.selectedFiles = [...pair];
    fileList.moveItem(0, 1);
    await flush();
    assert(countCalls() === 3, `排序重排应写一次,实际 ${countCalls()} 次`);
    assert(
      JSON.stringify(calls[2].lastSessionFiles) === JSON.stringify([...pair].reverse()),
      `排序后应写入新顺序,实际 ${JSON.stringify(calls[2].lastSessionFiles)}`,
    );
    assert(
      JSON.stringify(state.selectedFiles) === JSON.stringify([...pair].reverse()),
      "编辑内容(内存选择)应与写入内容一致",
    );

    // ---- 3. 写失败:不静默,状态区给统一失败文案 + 保留编辑内容 ----
    rejectWrites = true;
    statusEl.textContent = "";
    state.selectedFiles = ["C:\\session-persist\\case-3.md"];
    fileList.renderSelection();
    await flush();
    assert(
      statusEl.textContent === saveFailed,
      `会话文件写失败应在状态区可见(期望 ${JSON.stringify(saveFailed)},实际 ${JSON.stringify(statusEl.textContent)})`,
    );
    assert(statusEl.classList.contains("status--error"), "写失败应走错误语义样式(非静默成功)");
    assert(
      JSON.stringify(state.selectedFiles) === JSON.stringify(["C:\\session-persist\\case-3.md"]),
      "写失败必须保留编辑内容(不清空/不回滚列表)",
    );

    // ---- 4. 失败后可恢复:同内容下一次保存仍真正重试(失败不记入去重键) ----
    const beforeRetry = countCalls();
    rejectWrites = false;
    fileList.renderSelection();
    await flush();
    assert(
      countCalls() === beforeRetry + 1,
      `失败后同内容再次保存应重试一次,实际新增 ${countCalls() - beforeRetry} 次`,
    );

    // ---- 5. 设置面板「不再提示」写失败同一反馈口径,勾选态保留 ----
    rejectWrites = true;
    statusEl.textContent = "";
    settingsPanel.setSuppressCompleteDialog(false);
    await flush();
    assert(
      statusEl.textContent === saveFailed,
      `完成弹窗偏好写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      state.suppressCompleteDialog === false,
      "写失败必须保留用户勾选态(编辑内容不丢)",
    );

    // ---- 6. 抽屉开合记忆(settings-drawer):写失败同一反馈口径,开合态保留 ----
    rejectWrites = true;
    statusEl.textContent = "";
    settingsDrawer.openSettingsDrawer();
    settingsDrawer.closeSettingsDrawer();
    await flush();
    assert(
      statusEl.textContent === saveFailed,
      `抽屉开合记忆写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      !settingsDrawer.isSettingsDrawerOpen(),
      "抽屉开合是本次会话的真实状态:写失败不应强制改变开合",
    );

    // ---- 7. 清空最近记录(recent-files):写失败保留列表,不静默显示为空 ----
    const recentCalls = [];
    // 该模块的 uiStateSet 单独可控(清空动作走 recentFiles 字段)
    globalThis.window.api.uiStateSet = (patch) => {
      recentCalls.push(patch);
      if (!("recentFiles" in patch)) return Promise.resolve({ ...patch });
      return Promise.reject(new Error("EACCES: ui-state.json"));
    };
    recentFiles.renderRecentList([
      { path: "C:\\session-persist\\keep.md", name: "keep.md", format: "docx", ts: 5 },
    ]);
    statusEl.textContent = "";
    await recentFiles.clearRecentFiles();
    assert(recentCalls.length === 1, `清空最近应只发一次 ui-state 写,实际 ${recentCalls.length} 次`);
    assert(
      JSON.stringify(recentCalls[0]) === JSON.stringify({ recentFiles: [] }),
      `清空最近应提交空数组,实际 ${JSON.stringify(recentCalls[0])}`,
    );
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

    // ---- 8. 首启引导(first-run-guide):写失败同一反馈口径,收起态保留 ----
    // 直接构造"空态 + firstRun"后离开空态:引导收起并写回 firstRun=false
    state.firstRun = true;
    dropZone.dataset.stage = "empty";
    firstRunGuide.initFirstRunGuide();
    dropZone.dataset.stage = "single"; // 离开空态 → 视为已引导 → 写回 firstRun=false
    firstRunGuide.syncFirstRunGuide();
    await flush();
    assert(
      recentCalls.at(-1)?.firstRun === false,
      `离开空态应写回 firstRun=false,实际 ${JSON.stringify(recentCalls.at(-1))}`,
    );
    assert(state.firstRun === false, "引导收起后内存标志应为 false");
    assert(
      statusEl.textContent === saveFailed,
      `首启引导状态写失败应给出同一失败文案,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    console.log("[ok] ui-state-failure-feedback:完成弹窗/抽屉开合/清空最近/首启引导 四处静默点统一反馈 断言通过");

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
    assert(
      state.settings.toc === true && tocInput.checked === true,
      "设置保存失败必须保留用户当前编辑内容与控件值(不得回滚到 main cache)",
    );
    assert(
      statusEl.textContent === saveFailed,
      `设置保存失败应给出可见提示,实际 ${JSON.stringify(statusEl.textContent)}`,
    );
    assert(
      settingsCalls.at(-1)?.toc === true,
      `失败请求应已提交用户编辑值,实际 ${JSON.stringify(settingsCalls.at(-1))}`,
    );
    assert(
      loggedErrors.some((line) => line.includes("设置写盘失败")),
      `保存失败必须留痕(console.error),实际 ${JSON.stringify(loggedErrors)}`,
    );
    console.log("[ok] settings-save-failure:失败保留草稿与控件/状态区可见提示 断言通过");

    // ---- 10. 失败后的下一次保存:并入待重试草稿并真正落盘(main 权威值回填) ----
    rejectSettings = false;
    statusEl.textContent = "";
    settingsPanel.persistSettings({ format: "pdf" });
    await flush();
    await flush();
    assert(
      settingsCalls.at(-1)?.toc === true && settingsCalls.at(-1)?.format === "pdf",
      `重试保存应同时提交失败草稿与新编辑,实际 ${JSON.stringify(settingsCalls.at(-1))}`,
    );
    assert(
      state.settings.toc === true && state.settings.format === "pdf",
      "重试成功后 state 应为 main 权威合并值",
    );
    assert(
      statusEl.textContent === "",
      `成功后未保存提示应被清除,实际 ${JSON.stringify(statusEl.textContent)} / errors=${JSON.stringify(loggedErrors)}`,
    );
    // 草稿已清空:再保存只带新编辑(不重复携带已落盘字段的 patch)
    settingsPanel.persistSettings({ theme: "dark" });
    await flush();
    await flush();
    assert(
      settingsCalls.at(-1)?.toc === undefined,
      `成功后待重试草稿应清空,实际 ${JSON.stringify(settingsCalls.at(-1))}`,
    );
    assert(
      state.settings.toc === true && state.settings.theme === "dark",
      "草稿清空后仍应保留 main 已落盘值(权威回填不丢用户编辑)",
    );
    console.log("[ok] settings-save-retry:草稿并入重试/成功后清除未保存提示/权威回填不丢编辑 断言通过");

    // ---- 11. 成功保存的既有副作用不受影响(语言/主题/格式回填链路) ----
    mainSettings = null;
    state.settings = { ...DEFAULT_SETTINGS };
    settingsPanel.persistSettings({ language: "en", theme: "dark" });
    await flush();
    await flush();
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
  } finally {
    console.error = originalError;
    process.removeAllListeners("unhandledRejection");
    // 复位进程级单例(state / i18n 语言),避免污染后续段
    if (stateSnapshot && stateRef) Object.assign(stateRef, stateSnapshot);
    if (setLanguageRef) setLanguageRef("zh");
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.MutationObserver = originalMutationObserver;
  }
}
