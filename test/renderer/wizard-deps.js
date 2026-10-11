// @ts-check
/**
 * wizard 跨功能协作面的**测试侧装配**(对应 `src/renderer/renderer.ts` 里的
 * `bookWizardDeps`,ADR-075 §四:组合根组装 · feature 侧接形参)。
 *
 * 为什么测试要自己装配而不是 import 组合根:`renderer.ts` 是应用入口,import 它
 * 就会执行整段启动装配(建 DOM stub / 绑事件 / 拉设置),而这些段要的是**被测的
 * dist 模块在干净文档下的行为**。所以这里按同一份清单从 dist 模块取值,装配成同形的
 * deps 对象 —— 端口清单只此一份(两段共用本文件),组合根那份是另一处,两者同源于
 * `BookWizardDeps` 类型,少一个字段两处都会在 `typecheck` 处编译不过。
 *
 * 为什么不写死 dist 根:两个段的 `distUrl` 基准不同(一个以 `dist/renderer/` 起、
 * 一个以 `dist/` 起),故由调用方传入自己的 `distUrl` 与可选前缀。
 *
 * ⚠ 加端口时**两处一起改**(本文件 + 组合根),否则漏的一处会在 typecheck 处红 ——
 * 这是刻意的:deps 类型是必填形参、无默认值,漏项不可能静默通过。
 */
import { loadConvertFlowDeps } from "./convert-flow-deps.js";

/**
 * @param {(rel: string) => string} distUrl 调用方自己的 dist 路径函数
 * @param {string} [prefix] distUrl 之上的相对前缀(如 `renderer/`),默认空
 * @returns {Promise<import("../../dist/renderer/wizard/book-wizard.js").BookWizardDeps>}
 */
export async function loadBookWizardDeps(distUrl, prefix = "") {
  const [flow, fileList, drawer, logic, save, presetBindings, panel, dialogs, flowDeps] =
    await Promise.all([
      import(distUrl(`${prefix}convert/convert-flow.js`)),
      import(distUrl(`${prefix}convert/file-list.js`)),
      import(distUrl(`${prefix}settings/settings-drawer.js`)),
      import(distUrl(`${prefix}settings/settings-logic.js`)),
      import(distUrl(`${prefix}settings/settings-save.js`)),
      import(distUrl(`${prefix}settings/settings-bindings-preset.js`)),
      import(distUrl(`${prefix}settings/settings-panel.js`)),
      import(distUrl(`${prefix}ui/dialogs.js`)),
      loadConvertFlowDeps(distUrl, prefix),
    ]);
  return {
    // convert/convert-flow.js —— convert 刀起 runMerge / withPrecheck 各接一份呈现面
    // deps,组合根把 deps 绑成「对 deps 形状而言的零参闭包」,测试侧同形。
    isBackgroundCommandBlocked: flow.isBackgroundCommandBlocked,
    isConvertCommandBlocked: flow.isConvertCommandBlocked,
    runMerge: (opts) => flow.runMerge(flowDeps, opts),
    withPrecheck: (filePaths, action) => flow.withPrecheck(flowDeps, filePaths, action),
    // convert/file-list.js
    renderSelection: fileList.renderSelection,
    // settings/settings-drawer.js
    closeSettingsDrawer: drawer.closeSettingsDrawer,
    isSettingsDrawerOpen: drawer.isSettingsDrawerOpen,
    // ui/dialogs.js —— 向导遮罩关闭后的「遮罩显隐重算」通知(ADR-075 §四 交汇点),
    // 同样绑成零参闭包,向导不必知道 afterModalClosed 的 deps 形状。
    afterModalClosed: () => dialogs.afterModalClosed({
      recomputeActionButtons: fileList.updateActionButtons,
    }),
    // settings/settings-logic.js
    allPresets: logic.allPresets,
    headerLogoDisplayName: logic.headerLogoDisplayName,
    outputDirDisplayText: logic.outputDirDisplayText,
    parseMarginValue: logic.parseMarginValue,
    presetDisplayName: logic.presetDisplayName,
    validateNumberRange: logic.validateNumberRange,
    // settings/settings-save.js
    persistSettings: save.persistSettings,
    // settings/settings-bindings-preset.js
    applyTemplatePreset: presetBindings.applyTemplatePreset,
    // settings/settings-panel.js
    importDocxTemplate: panel.importDocxTemplate,
  };
}