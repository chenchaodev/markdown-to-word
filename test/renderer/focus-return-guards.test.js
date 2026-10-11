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
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/paths.js";
import { installDomStub, makeElement } from "./dom-stub.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("focus-return-guards");

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测的 dist 模块由 `await import(distUrl(...))` 的**运行期动态 import** 载入
 * (路径 `path.join` 逐段拼出,不在 import 语句位置),段内零 renderer import。
 *
 * 主体依据(头注 + 实现位置):头注写「契约(浮层「关掉后焦点回到哪」是键盘可用性的地基):
 * 打开前记下来源(rememberFocusOrigin),关闭时原样归还(restoreFocusOrigin)」,并逐条点名
 * 抽屉 / 预设保存弹窗 / 弹窗三种浮层。故声明:
 * - `dom/dom-ops.ts` —— `rememberFocusOrigin` / `restoreFocusOrigin` / `trapFocus` 的定义处
 *   (三个浮层模块都从它 import,「按栈记」那条语义也落在它);
 * - `settings/settings-drawer.ts` 与 `settings/settings-preset-actions.ts` —— 抽屉与预设弹窗
 *   的记/还调用点(头注「关抽屉才回顶栏 ⚙」「关弹窗只回抽屉内那一层」两格);
 * - `ui/dialogs.ts` —— 弹窗的记/还调用点与「来源已失效时退到可见主操作钮」那一格;
 * - `state/state.ts` —— 抽屉落当前激活分组 Tab 那一格读的状态单例。
 */
export const covers = [
  "src/renderer/dom/dom-ops.ts",
  "src/renderer/settings/settings-drawer.ts",
  "src/renderer/settings/settings-preset-actions.ts",
  "src/renderer/ui/dialogs.ts",
  "src/renderer/state/state.ts",
];

/** 取元素 id(失败消息用)。 */
const idOf = (/** @type {{ id?: string }} */ el) => `#${el?.id ?? "?"}`;

const distUrl = (/** @type {string} */ rel) => pathToFileURL(path.join(ROOT, "dist", rel)).href;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
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
  const suite = createCaseSuite();
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
    const { state } = await import(distUrl("renderer/state/state.js"));
    const { batchDialogOk, completeDialogOk, precheckContinue, presetNameInput } =
      await import(distUrl("renderer/dom/refs.js"));
    const el = (/** @type {string} */ id) => dom.elementFor(id);
    el("settingsDrawer").querySelector = (/** @type {string} */ sel) =>
      sel === ".settings-tab.active" ? activeTab : null;

    // 关闭路径自 convert 刀起收 deps(遮罩显隐重算的端口,ADR-075 §四):弹窗走
    // ui/dialogs 的 ModalCloseDeps,另存为预设弹窗走 settings 的 PresetActionsDeps。
    // 两份都按组合根的同一份端口清单在测试侧装配。
    const fileList = await import(distUrl("renderer/convert/file-list.js"));
    const dialogsDeps = { recomputeActionButtons: fileList.updateActionButtons };
    const presetActionsDeps = {
      afterModalClosed: () => dialogs.afterModalClosed(dialogsDeps),
    };

    // 段间共享:dist 模块在一个进程内只 import 一次,焦点来源栈是模块级单例。
    // 前序段(convert-command-lock 等)开过弹窗未必关,栈里会留残余;先把栈排空,
    // 否则本段第一次「关闭归还焦点」取到的是别人的条目。8 次足够覆盖现有段。
    for (let i = 0; i < 8; i += 1) dialogs.hideCompleteDialog(dialogsDeps);

    // ---- 1. 完成弹窗:开 → 焦点落默认操作钮;关 → 回触发元素 ----
    await suite.case("完成弹窗默认落点与关闭归还", async () => {
      // 选中数按各条用例的触发按钮给:关闭弹窗时 dialogs 会重算动作按钮可用性
      // (isBusy 的判据含「恰好一个文件」与「≥2 个文件」两条可见性规则),归还焦点
      // 只落在**未 disabled**的候选上 —— 选中数不给对,期望的触发按钮就是灰的,
      // 焦点按浏览器语义压根落不上去(此前本段靠「弹窗开着却零选中」这个够不到
      // 的前提才成立:真实流程里完成/批量弹窗必在有选中项时打开)。
      state.selectedFiles = ["C:\\docs\\a.md"];
      el("convertBtn").classList.remove("hidden");
      dom.document.activeElement = el("convertBtn");
      dialogs.showCompleteDialog("C:\\out\\a.docx");
      assert(
        dom.document.activeElement === completeDialogOk,
        `完成弹窗打开后焦点应落「确定」${idOf(completeDialogOk)},实际 ${idOf(dom.document.activeElement)}`,
      );
      dialogs.hideCompleteDialog(dialogsDeps);
      assert(
        dom.document.activeElement === el("convertBtn"),
        `完成弹窗关闭后焦点应回触发元素 #convertBtn,实际 ${idOf(dom.document.activeElement)}`,
      );
    });

    // ---- 2. 批量弹窗:同链,触发元素换成批量钮 ----
    await suite.case("批量弹窗默认落点与关闭归还", () => {
      state.selectedFiles = ["C:\\docs\\a.md", "C:\\docs\\b.md"];
      el("batchBtn").classList.remove("hidden");
      dom.document.activeElement = el("batchBtn");
      dialogs.showBatchDialog(batchResult(2));
      assert(
        dom.document.activeElement === batchDialogOk,
        `批量弹窗打开后焦点应落「确定」${idOf(batchDialogOk)},实际 ${idOf(dom.document.activeElement)}`,
      );
      dialogs.hideBatchDialog(dialogsDeps);
      assert(
        dom.document.activeElement === el("batchBtn"),
        `批量弹窗关闭后焦点应回触发元素 #batchBtn,实际 ${idOf(dom.document.activeElement)}`,
      );
    });

    // ---- 3. 预检弹窗:焦点落「继续转换」(肯定动作),关闭回发起转换的元素 ----
    await suite.case("预检弹窗落肯定动作且关闭按取消结算", async () => {
      state.selectedFiles = ["C:\\docs\\a.md", "C:\\docs\\b.md"];
      el("mergeBtn").classList.remove("hidden");
      dom.document.activeElement = el("mergeBtn");
      const decided = dialogs.showPrecheckDialog([]);
      assert(
        dom.document.activeElement === precheckContinue,
        `预检弹窗打开后焦点应落「继续转换」${idOf(precheckContinue)},实际 ${idOf(dom.document.activeElement)}`,
      );
      dialogs.closePrecheckDialog(false, dialogsDeps);
      assert(await decided === false, "预检关闭应按 false 结算(用户取消)");
      assert(
        dom.document.activeElement === el("mergeBtn"),
        `预检弹窗关闭后焦点应回发起元素 #mergeBtn,实际 ${idOf(dom.document.activeElement)}`,
      );
    });

    // ---- 4. 另存为预设弹窗:焦点进输入框,关闭回抽屉内那一枚钮 ----
    await suite.case("另存为预设弹窗焦点进输入框并归还", () => {
      el("presetSaveBtn").classList.remove("hidden");
      dom.document.activeElement = el("presetSaveBtn");
      presetActions.openPresetSaveDialog();
      assert(
        dom.document.activeElement === presetNameInput,
        `另存为弹窗打开后焦点应进名称输入框 ${idOf(presetNameInput)},实际 ${idOf(dom.document.activeElement)}`,
      );
      presetActions.closePresetSaveDialog(presetActionsDeps);
      assert(
        dom.document.activeElement === el("presetSaveBtn"),
        `另存为弹窗关闭后焦点应回 #presetSaveBtn,实际 ${idOf(dom.document.activeElement)}`,
      );
    });

    // ---- 5. 设置抽屉:初始焦点落当前激活分组 Tab,关闭回顶栏 ⚙ ----
    await suite.case("设置抽屉初始落激活分组 Tab 并归还顶栏", () => {
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
    });

    // ---- 6. 叠层:抽屉开着时开预设弹窗,逐层归还(来源按栈记,不按单值) ----
    await suite.case("叠层浮层逐层归还焦点", () => {
      dom.document.activeElement = el("settingsOpenBtn");
      drawer.openSettingsDrawer();
      // 抽屉内点「另存为预设」:焦点此时在该钮上
      el("presetSaveBtn").classList.remove("hidden");
      dom.document.activeElement = el("presetSaveBtn");
      presetActions.openPresetSaveDialog();
      presetActions.closePresetSaveDialog(presetActionsDeps);
      assert(
        dom.document.activeElement === el("presetSaveBtn"),
        `叠层关闭内层弹窗后焦点应回抽屉内触发钮,实际 ${idOf(dom.document.activeElement)}`,
      );
      drawer.closeSettingsDrawer();
      assert(
        dom.document.activeElement === el("settingsOpenBtn"),
        `叠层再关抽屉后焦点才回 #settingsOpenBtn,实际 ${idOf(dom.document.activeElement)}`,
      );
    });

    // ---- 7. 兜底:触发元素已失效时不硬按,退到可见主操作钮 ----
    await suite.case("触发元素已失效时退到可见主操作钮", () => {
      // 触发元素 disabled(disabled 的元素按下去不会有焦点,按上去等于丢焦点)
      el("mergeBtn").classList.add("hidden");
      const trigger = el("convertBtn");
      dom.document.activeElement = trigger;
      trigger.disabled = true;
      // 兜底落点 #batchBtn 要既可见又可用:多文件态(≥2)正是批量/合并接棒、转换钮
      // 单独置灰的那一档,选中数按此给(关闭时的重算会照这条规则落 disabled)
      state.selectedFiles = ["C:\\docs\\a.md", "C:\\docs\\b.md"];
      dialogs.showCompleteDialog("C:\\out\\b.docx");
      dialogs.hideCompleteDialog(dialogsDeps);
      const landed = dom.document.activeElement;
      assert(
        landed === el("batchBtn"),
        `触发元素 disabled 时应退到可见主操作钮 #batchBtn,实际 ${idOf(landed)}`,
      );
      assert(landed !== trigger, "触发元素已失效时不得把焦点按回它(按上去等于丢焦点)");
    });

    console.log(
      "[ok] focus-return-guards:弹窗/抽屉默认落点 + 四类关闭归还具体元素 + 叠层栈序 + 失效兜底 断言通过",
    );
    return { cases: suite.results };
  } finally {
    dom.restore();
  }
}
