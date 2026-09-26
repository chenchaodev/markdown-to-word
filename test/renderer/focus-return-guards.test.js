// @ts-check
/**
 * 焦点落点与归还段(此前零覆盖,从零建立):
 *
 * 契约(浮层「关掉后焦点回到哪」是键盘可用性的地基):
 * - 打开前记下来源(rememberFocusOrigin),关闭时原样归还(restoreFocusOrigin);
 * - 归还必须命中**具体元素**(断言 document.activeElement 逐个比,只判
 *   「有焦点」会把「掉到 body」也放过 —— 那是本段最该拦的回归);
 * - 叠层不乱:预设保存弹窗叠在设置抽屉之上,关弹窗只回抽屉内那一层,
 *   关抽屉才回顶栏 ⚙(来源按栈记,不按单值);
 * - 来源已失效(元素被移除 / disabled)时不硬按,退到可见主操作钮。
 *
 * 初始落点侧:设置抽屉落当前激活分组 Tab(以 tablist 开场的对话框),
 * 弹窗落默认操作钮;主窗首屏落舞台容器(那一条由 init-barrier 段按源契约守护)。
 *
 * DOM 侧用共享 stub 的 trackFocus 能力(见 dom-stub.js 文件头):focus() 真的
 * 改写 document.activeElement;抽屉的分组 Tab 走段内注入的元素级 querySelector
 * 探针(stub 契约:选择器命中由用例给,不在 stub 里做全局表)。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDomStub, makeElement } from "./dom-stub.js";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`focus-return-guards 断言失败:${msg}`);
}

/** 取元素 id(失败消息用)。 */
const idOf = (/** @type {{ id?: string }} */ el) => `#${el?.id ?? "?"}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const distUrl = (/** @type {string} */ rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 批量结果(弹窗标题/汇总条需要,本段只关心焦点,给最小可用形状)。
 * @param {number} okCount
 */
const batchResult = (okCount) => ({
  items: [],
  okCount,
  failCount: 0,
  canceledCount: 0,
});

export async function run() {
  const dom = installDomStub({
    api: {
      uiStateSet: async () => ({}),
      uiStateGet: async () => ({}),
      settingsGet: async () => ({}),
    },
    trackFocus: true,
  });

  // 设置抽屉的初始落点是「当前激活分组 Tab」:被测代码在抽屉元素上调
  // querySelector 取它(不是 document 级),按 stub 契约段内注入最小命中实现。
  // 探针元素自造,须显式过一次 withFocus 才会真的落焦(见 dom-stub.js 装配注记)。
  const activeTab = dom.withFocus(
    makeElement({ id: "settingsTab-typography", className: "settings-tab active" }),
  );

  try {
    const dialogs = await import(distUrl("renderer/ui/dialogs.js"));
    const drawer = await import(distUrl("renderer/settings/settings-drawer.js"));
    const presetActions = await import(distUrl("renderer/settings/settings-preset-actions.js"));
    const { batchDialogOk, completeDialogOk, precheckContinue, presetNameInput } =
      await import(distUrl("renderer/dom/refs.js"));
    const el = (/** @type {string} */ id) => dom.elementFor(id);
    el("settingsDrawer").querySelector = (/** @type {string} */ sel) =>
      sel === ".settings-tab.active" ? activeTab : null;

    // 段间共享:dist 模块在一个进程内只 import 一次,焦点来源栈是模块级单例。
    // 前序段(convert-command-lock 等)开过弹窗未必关,栈里会留残余;先把栈排空,
    // 否则本段第一次「关闭归还焦点」取到的是别人的条目。8 次足够覆盖现有段。
    for (let i = 0; i < 8; i += 1) dialogs.hideCompleteDialog();

    // ---- 1. 完成弹窗:开 → 焦点落默认操作钮;关 → 回触发元素 ----
    el("convertBtn").classList.remove("hidden");
    dom.document.activeElement = el("convertBtn");
    dialogs.showCompleteDialog("C:\\out\\a.docx");
    assert(
      dom.document.activeElement === completeDialogOk,
      `完成弹窗打开后焦点应落「确定」${idOf(completeDialogOk)},实际 ${idOf(dom.document.activeElement)}`,
    );
    dialogs.hideCompleteDialog();
    assert(
      dom.document.activeElement === el("convertBtn"),
      `完成弹窗关闭后焦点应回触发元素 #convertBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 2. 批量弹窗:同链,触发元素换成批量钮 ----
    el("batchBtn").classList.remove("hidden");
    dom.document.activeElement = el("batchBtn");
    dialogs.showBatchDialog(batchResult(2));
    assert(
      dom.document.activeElement === batchDialogOk,
      `批量弹窗打开后焦点应落「确定」${idOf(batchDialogOk)},实际 ${idOf(dom.document.activeElement)}`,
    );
    dialogs.hideBatchDialog();
    assert(
      dom.document.activeElement === el("batchBtn"),
      `批量弹窗关闭后焦点应回触发元素 #batchBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 3. 预检弹窗:焦点落「继续转换」(肯定动作),关闭回发起转换的元素 ----
    el("mergeBtn").classList.remove("hidden");
    dom.document.activeElement = el("mergeBtn");
    const decided = dialogs.showPrecheckDialog([]);
    assert(
      dom.document.activeElement === precheckContinue,
      `预检弹窗打开后焦点应落「继续转换」${idOf(precheckContinue)},实际 ${idOf(dom.document.activeElement)}`,
    );
    dialogs.closePrecheckDialog(false);
    assert(await decided === false, "预检关闭应按 false 结算(用户取消)");
    assert(
      dom.document.activeElement === el("mergeBtn"),
      `预检弹窗关闭后焦点应回发起元素 #mergeBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 4. 另存为预设弹窗:焦点进输入框,关闭回抽屉内那一枚钮 ----
    el("presetSaveBtn").classList.remove("hidden");
    dom.document.activeElement = el("presetSaveBtn");
    presetActions.openPresetSaveDialog();
    assert(
      dom.document.activeElement === presetNameInput,
      `另存为弹窗打开后焦点应进名称输入框 ${idOf(presetNameInput)},实际 ${idOf(dom.document.activeElement)}`,
    );
    presetActions.closePresetSaveDialog();
    assert(
      dom.document.activeElement === el("presetSaveBtn"),
      `另存为弹窗关闭后焦点应回 #presetSaveBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 5. 设置抽屉:初始焦点落当前激活分组 Tab,关闭回顶栏 ⚙ ----
    dom.document.activeElement = el("settingsOpenBtn");
    drawer.openSettingsDrawer();
    assert(
      dom.document.activeElement === activeTab,
      `抽屉打开后焦点应落当前激活分组 Tab(${idOf(activeTab)}),实际 ${idOf(dom.document.activeElement)}`,
    );
    drawer.closeSettingsDrawer();
    assert(
      dom.document.activeElement === el("settingsOpenBtn"),
      `抽屉关闭后焦点应回 #settingsOpenBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 6. 叠层:抽屉开着时开预设弹窗,逐层归还(来源按栈记,不按单值) ----
    dom.document.activeElement = el("settingsOpenBtn");
    drawer.openSettingsDrawer();
    // 抽屉内点「另存为预设」:焦点此时在该钮上
    el("presetSaveBtn").classList.remove("hidden");
    dom.document.activeElement = el("presetSaveBtn");
    presetActions.openPresetSaveDialog();
    presetActions.closePresetSaveDialog();
    assert(
      dom.document.activeElement === el("presetSaveBtn"),
      `叠层关闭内层弹窗后焦点应回抽屉内触发钮,实际 ${idOf(dom.document.activeElement)}`,
    );
    drawer.closeSettingsDrawer();
    assert(
      dom.document.activeElement === el("settingsOpenBtn"),
      `叠层再关抽屉后焦点才回 #settingsOpenBtn,实际 ${idOf(dom.document.activeElement)}`,
    );

    // ---- 7. 兜底:触发元素已失效时不硬按,退到可见主操作钮 ----
    // 触发元素 disabled(disabled 的元素按下去不会有焦点,按上去等于丢焦点)
    el("mergeBtn").classList.add("hidden");
    const trigger = el("convertBtn");
    dom.document.activeElement = trigger;
    trigger.disabled = true;
    dialogs.showCompleteDialog("C:\\out\\b.docx");
    dialogs.hideCompleteDialog();
    const landed = dom.document.activeElement;
    assert(
      landed === el("batchBtn"),
      `触发元素 disabled 时应退到可见主操作钮 #batchBtn,实际 ${idOf(landed)}`,
    );
    assert(landed !== trigger, "触发元素已失效时不得把焦点按回它(按上去等于丢焦点)");

    console.log(
      "[ok] focus-return-guards:弹窗/抽屉默认落点 + 四类关闭归还具体元素 + 叠层栈序 + 失效兜底 断言通过",
    );
  } finally {
    dom.restore();
  }
}
