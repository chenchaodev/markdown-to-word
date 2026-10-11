// @ts-check
/**
 * convert 呈现面(`ConvertFlowDeps`)的**测试侧装配**(对应
 * `src/renderer/renderer.ts` 里的 `convertFlowDeps`,ADR-075 §四:组合根组装 ·
 * feature 侧接形参)。
 *
 * 为什么测试要自己装配而不是 import 组合根:`renderer.ts` 是应用入口,import 它
 * 就会执行整段启动装配(建 DOM stub / 绑事件 / 拉设置),而这些段要的是**被测的
 * dist 模块在干净文档下的行为**。所以这里按同一份清单从 dist 模块取值,装配成同形的
 * deps 对象 —— 端口清单只此一份(各段共用本文件),组合根那份是另一处,两者同源于
 * `ConvertFlowDeps` 类型,少一个字段两处都会在 `typecheck` 处编译不过。
 *
 * 为什么不写死 dist 根:各段的 `distUrl` 基准不同(有的以 `dist/renderer/` 起、
 * 有的以 `dist/` 起),故由调用方传入自己的 `distUrl` 与可选前缀。
 *
 * ⚠ 加端口时**两处一起改**(本文件 + 组合根),否则漏的一处会在 typecheck 处红 ——
 * 这是刻意的:deps 类型是必填形参、无默认值,漏项不可能静默通过。
 */

/**
 * @param {(rel: string) => string} distUrl 调用方自己的 dist 路径函数
 * @param {string} [prefix] distUrl 之上的相对前缀(如 `renderer/`),默认空
 * @returns {Promise<import("../../dist/renderer/convert/convert-flow.js").ConvertFlowDeps>}
 */
export async function loadConvertFlowDeps(distUrl, prefix = "") {
  const dialogs = await import(distUrl(`${prefix}ui/dialogs.js`));
  return {
    // ui/dialogs.js —— convert-flow 的结果呈现面(原为 convert/convert-flow → ui/dialogs
    // 的静态 import,REQ-218 #10 阶段④ convert 刀拆边后改为端口注入)
    precheckFileLabels: dialogs.precheckFileLabels,
    showBatchDialog: dialogs.showBatchDialog,
    showCompleteDialog: dialogs.showCompleteDialog,
    showPrecheckDialog: dialogs.showPrecheckDialog,
    showSummary: dialogs.showSummary,
  };
}