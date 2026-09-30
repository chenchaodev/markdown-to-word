// @ts-check
/**
 * 成书向导「每次打开同步最新设置 + 步骤名随语言刷新」回归段:
 *
 * - 外壳在 open 时重建(而非复用首次构建的 DOM):各步骤控件在构建期读
 *   state.settings,向导外改过排版/页眉页脚/水印/目录后再开,必须显示新值,
 *   否则用户在向导里看到的是过期快照,改一个字段还会把旧值写回。
 * - 步骤名按构建期的当前语言生成(模块加载期冻结的标签,启动语言未定、
 *   语言切换后也不会更新)。
 * - 关闭时焦点兜底不抛错(触发按钮可能已随舞台状态切换而失效)。
 * - 目录模式下拉随自动目录开关整块收起(与设置抽屉 04 组同源门控):回填
 *   路径与开关 change 路径都要重算显隐,收起不丢上次选择。
 *
 * 用最小 DOM stub 驱动 dist 向导模块(元素工厂与 dom-stub.js 同款)。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fireListener, installDomStub } from "./dom-stub.js";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`wizard-open-sync 断言失败:${msg}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
/** @param {string} rel @returns {string} */
const distUrl = (rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dom = installDomStub({
    api: {
      // 本段只断言控件显隐,不关心落盘:settingsSet 永不落定,写回流水线停在
      // await 处(不产生回填/失败反馈等副作用,也不把无关噪声打进验收输出)。
      settingsSet: () => new Promise(() => {}),
      previewRefresh: () => Promise.resolve(),
    },
  });
  try {
    const i18n = await import(distUrl("core/i18n/index.js")); // DICT / 语言注册表
    const { setLanguage } = await import(distUrl("core/i18n.js")); // 语言状态切换
    const { cloneDefaultSettings } = await import(
      distUrl("core/settings/settings-defaults.js")
    );
    const { state } = await import(distUrl("renderer/state/state.js"));
    const bookWizard = await import(distUrl("renderer/wizard/book-wizard.js"));

    // 与生产(renderer/state/state.ts 初始 state)共用同一个工厂:此前这里手写的
    // 4 组展开与生产的 2 组展开不同形,生产新增分组时本段会静默漏掉一块。
    state.settings = cloneDefaultSettings();
    state.selectedFiles = [];
    state.mode = null;

    /** 取本次 open 新建的元素(避免跨次误取)。 @param {number} mark */
    const openedSince = (mark) => dom.created.slice(mark);
    /**
     * @param {import("./dom-stub.js").StubElement[]} nodes
     * @param {string} id
     * @returns {import("./dom-stub.js").StubElement | null}
     */
    const findById = (nodes, id) => nodes.find((el) => el.id === id) ?? null;
    /**
     * @param {import("./dom-stub.js").StubElement[]} nodes
     * @returns {import("./dom-stub.js").StubElement | null}
     */
    const firstLabel = (nodes) =>
      nodes.find((el) => el.className === "wz-step-label") ?? null;
    /**
     * 目录下拉所在字段块(wz-field,含可见 label + sel-wrap):门控作用在这一整块上
     * (整块移除,而非只藏 select —— 藏掉控件会留下一个悬空的标签),故断言块的显隐。
     * stub 不建 parentElement 指针,只能按「后代里含 #wizardTocMode」反查。
     * @param {import("./dom-stub.js").StubElement[]} nodes
     * @returns {import("./dom-stub.js").StubElement | null}
     */
    const findModeField = (nodes) => {
      /** @param {import("./dom-stub.js").StubNode} node @returns {boolean} */
      const hasSelect = (node) => {
        if (typeof node === "string") return false;
        if (node.id === "wizardTocMode") return true;
        return node.children.some((child) => hasSelect(child));
      };
      return (
        nodes.find((el) => el.className === "wz-field" && hasSelect(el)) ?? null
      );
    };

    // ---- 中文首开:步骤名取当前语言 ----
    setLanguage("zh");
    let mark = dom.created.length;
    bookWizard.openBookWizard();
    let nodes = openedSince(mark);
    let overlay = findById(nodes, "bookWizard");
    assert(overlay, "首开应构建向导模态容器");
    let label = firstLabel(nodes);
    assert(
      label && label.textContent === i18n.DICT.zh["wizard.stepTemplate"],
      `中文首开首步名应取 zh 文案,实际 ${label?.textContent}`,
    );

    // ---- 初始回填:自动目录默认为开,目录下拉应当可见 ----
    // 这条与下方「关掉后应隐藏」构成非空洞的一对:stub 元素 classList 初值自带
    // hidden,只断言「隐藏」会恒真(门控整个删掉也不红),必须先有一条要求它可见的。
    const modeFieldOn = findModeField(nodes);
    assert(modeFieldOn, "首开应构建目录模式下拉所在的字段块");
    assert(
      !modeFieldOn.classList.contains("hidden"),
      "自动目录默认为开时,目录下拉字段块不应被收起(回填路径已接线)",
    );

    // ---- 向导外改设置 → 关闭后复开必须同步(且外壳为重建) ----
    bookWizard.closeBookWizard(); // 复开的前置:向导处于关闭态
    state.settings.watermark.text = "机密";
    state.settings.headerFooter.headerText = "青崖大学文学院";
    state.settings.toc = false;
    mark = dom.created.length;
    bookWizard.openBookWizard();
    nodes = openedSince(mark);
    const overlay2 = findById(nodes, "bookWizard");
    assert(overlay2, "复开应重新构建外壳");
    assert(overlay2 !== overlay, "复开必须是新容器(重建),不是复用旧 DOM");
    assert(overlay.isConnected === false, "复开应摘除旧容器(不残留两个模态)");

    const wmInput = findById(nodes, "wizardWmText");
    assert(
      wmInput && wmInput.value === "机密",
      `复开应显示最新水印文字,实际 ${wmInput?.value}`,
    );
    const headerInput = findById(nodes, "wizardHeaderText");
    assert(
      headerInput && headerInput.value === "青崖大学文学院",
      `复开应显示最新页眉文字,实际 ${headerInput?.value}`,
    );
    const tocSwitch = findById(nodes, "wizardToc");
    assert(
      tocSwitch && tocSwitch.checked === false,
      "复开应同步最新自动目录开关(与向导外设置一致)",
    );

    // ---- 目录模式下拉门控:关掉自动目录后整块移除(回填路径 + change 路径双向) ----
    // 与设置抽屉 04 组同源(settings-ia §3 规则 1):模式不满足就摆一个可点的下拉,
    // 用户能选一个不生效的模式,故整块 .hidden 收起而非灰禁。
    const tocModeSelect = findById(nodes, "wizardTocMode");
    assert(tocModeSelect, "复开应构建目录模式下拉控件");
    // 开关的 change 会走真实写回流水线,其同步段经 hooks 刷抽屉副标题,那里读
    // templatePreset.selectedOptions —— dom stub 未提供该成员(段内最小补齐,
    // 不改共享 stub,免得影响其它段)
    /** @type {Record<string, unknown>} */ (dom.elementFor("templatePreset")).selectedOptions = [
      { textContent: "学术论文" },
    ];
    const modeField = findModeField(nodes);
    assert(modeField, "复开应能定位到目录下拉所在的字段块");
    assert(
      modeField.classList.contains("hidden"),
      "回填路径:复开时自动目录为关,目录下拉字段块应已整块移除",
    );
    tocModeSelect.value = "field";
    tocSwitch.checked = true;
    fireListener(tocSwitch, "change");
    assert(
      !modeField.classList.contains("hidden"),
      "打开自动目录后目录下拉应重新出现(change 路径已接线)",
    );
    assert(
      tocModeSelect.value === "field",
      `展开后应仍是收起前那次选择(收起不得丢值),实际 ${tocModeSelect.value}`,
    );
    tocSwitch.checked = false;
    fireListener(tocSwitch, "change");
    assert(
      modeField.classList.contains("hidden"),
      "再次关掉自动目录后目录下拉应重新整块移除",
    );
    assert(
      tocModeSelect.value === "field",
      "收起不得丢掉上次选的目录模式(重新打开即恢复)",
    );
    // 复原:后续语言切换用例不依赖该态
    tocSwitch.checked = true;
    fireListener(tocSwitch, "change");
    state.settings.tocMode = "static";

    // ---- 语言切换后复开:步骤名随语言刷新 ----
    bookWizard.closeBookWizard();
    setLanguage("en");
    mark = dom.created.length;
    bookWizard.openBookWizard();
    nodes = openedSince(mark);
    label = firstLabel(nodes);
    assert(
      label && label.textContent === i18n.DICT.en["wizard.stepTemplate"],
      `英文复开首步名应取 en 文案,实际 ${label?.textContent}`,
    );
    setLanguage("zh");

    // ---- 关闭:焦点兜底路径不抛错 ----
    bookWizard.closeBookWizard();

    console.log("[ok] wizard-open-sync:复开重建外壳 / 设置快照同步 / 目录模式下拉门控 / 步骤名随语言刷新 / 关闭焦点兜底 断言通过");
  } finally {
    dom.restore();
  }
}
