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
 * 为什么写死字面量而不是继续收 `distUrl` 形参:四个调用方传进来的 `distUrl` 基准并不
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

/**
 * @returns {Promise<import("../../dist/renderer/convert/convert-flow.js").ConvertFlowDeps>}
 */
export async function loadConvertFlowDeps() {
  const dialogs = await import("../../dist/renderer/ui/dialogs.js");
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