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
 * 为什么写死字面量而不是继续收 `distUrl` 形参:两个调用方传进来的 `distUrl` 基准并不
 * 相同(一派以 `dist/renderer/` 起、一派以 `dist/` 起再拼 `renderer/`),但它们解析到的
 * 是**同一个**绝对路径 —— 形参曾经只是在桥接各段自己的本地路径风格,不是在指向不同目标。
 * 现在写死字面量 `import("../../dist/renderer/…")`,理由是门禁的静态抽取器只认
 * `import("字面量")`:形参化之后,这些 dist 模块在「已被 test/ 实际到达」这件事上永久
 * 失明,而本文件正是见证它们被加载的那一处。仍是**动态** import —— dist 模块必须晚于
 * DOM stub 安装才加载,改成静态 import 会把加载提到 stub 之前、直接跑不通。
 *
 * ⚠ 加端口时**两处一起改**(本文件 + 组合根),否则漏的一处会在 typecheck 处红 ——
 * 这是刻意的:deps 类型是必填形参、无默认值,漏项不可能静默通过。
 */
import { loadConvertFlowDeps } from "./convert-flow-deps.js";

/**
 * @returns {Promise<import("../../dist/renderer/wizard/book-wizard.js").BookWizardDeps>}
 */
export async function loadBookWizardDeps() {
  const [flow, fileList, drawer, logic, save, presetBindings, panel, dialogs, flowDeps] =
    await Promise.all([
      import("../../dist/renderer/convert/convert-flow.js"),
      import("../../dist/renderer/convert/file-list.js"),
      import("../../dist/renderer/settings/settings-drawer.js"),
      import("../../dist/renderer/settings/settings-logic.js"),
      import("../../dist/renderer/settings/settings-save.js"),
      import("../../dist/renderer/settings/settings-bindings-preset.js"),
      import("../../dist/renderer/settings/settings-panel.js"),
      import("../../dist/renderer/ui/dialogs.js"),
      loadConvertFlowDeps(),
    ]);
  return {
    // convert/convert-flow.js —— convert 刀起 runMerge / withPrecheck 各接一份呈现面
    // deps,组合根把 deps 绑成「对 deps 形状而言的零参闭包」,测试侧同形。
    isBackgroundCommandBlocked: flow.isBackgroundCommandBlocked,
    isConvertCommandBlocked: flow.isConvertCommandBlocked,
    runMerge: (opts) => flow.runMerge(flowDeps, opts),
    withPrecheck: (filePaths, action) => flow.withPrecheck(flowDeps, filePaths, action),
    // convert/file-list.js —— 舞台跃迁通知的端口实现体在 ui/recent-files,而向导这一侧
    // 不判历史浮层的收起时机(那是 ui 域的主体),故此处接空实现,只把 deps 形状喂对。
    renderSelection: () => fileList.renderSelection({ onStageChanged: () => {} }),
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