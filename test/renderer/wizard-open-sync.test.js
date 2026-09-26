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
 *
 * 用最小 DOM stub 驱动 dist 向导模块(元素工厂与 dom-stub.js 同款)。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDomStub } from "./dom-stub.js";

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

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dom = installDomStub({ api: {} });
  try {
    const i18n = await import(distUrl("core/i18n/index.js")); // DICT / 语言注册表
    const { setLanguage } = await import(distUrl("core/i18n.js")); // 语言状态切换
    const { DEFAULT_SETTINGS } = await import(distUrl("core/settings/settings-defaults.js"));
    const { state } = await import(distUrl("renderer/state/state.js"));
    const bookWizard = await import(distUrl("renderer/wizard/book-wizard.js"));

    state.settings = {
      ...DEFAULT_SETTINGS,
      pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
      typography: { ...DEFAULT_SETTINGS.typography },
      headerFooter: { ...DEFAULT_SETTINGS.headerFooter },
      watermark: { ...DEFAULT_SETTINGS.watermark },
    };
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

    console.log("[ok] wizard-open-sync:复开重建外壳 / 设置快照同步 / 步骤名随语言刷新 / 关闭焦点兜底 断言通过");
  } finally {
    dom.restore();
  }
}
