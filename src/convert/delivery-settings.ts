/**
 * **非 GUI 交付面**(CLI / MCP)的设置基线 —— 两者共用的一份。
 *
 * 为什么住在 convert 层而不是各写一份:ADR-060 定了「cli 与 mcp 是同一层的两个
 * adapter,二者**零依赖**」。零依赖意味着 mcp 不能 import cli 的任何东西 ⇒
 * 「默认设置 + 覆盖两处固定项 + 可选预设」这段逻辑若两边各写一份,就是第二处
 * 会漂的映射(第一处是 flag → 设置的映射,已在 options.ts 收敛)。
 * 共同依赖只能落在两层**之下**,而这段逻辑正是「设置怎么喂进装配层」的问题 ⇒
 * 装配层是它唯一的合法位置。
 *
 * 三处固定覆盖不是随手写的,逐条有理由:
 * - `outputDir: ""` —— 输出到源文件旁。CLI 另有一条 `--output` 走 pinOutputPath,
 *   但那是**装配层入参**不是设置;留空串才不会在多输入时把产物堆到一个用户
 *   没指定的目录。
 * - `afterConvert: "none"` —— 「导出后行为」(打开文件夹 / 用默认程序打开)是 GUI 的
 *   副作用所有权,ADR-060 明确「让位语义不进装配层」。CLI 与 MCP 都不注入
 *   `onAfterCommit`,这里写死 none 是第二道保险:将来有人给某个交付面塞进一份带
 *   afterConvert 的设置时,产物不会在用户不知情下被打开。
 * - 不读用户 settings.json —— GUI 的 `loadSettings()` 经 `app.getPath`,需 Electron
 *   宿主。两个交付面都是无宿主进程,故设置**只由入参决定**,跨会话可复现。
 */
import { cloneDefaultSettings, type AppSettings } from "../core/settings/settings-defaults.js";
import { TEMPLATE_PRESETS, presetSettingsPatch } from "../core/settings/presets.js";

/** 内置模板预设 id 清单(供交付面在报错时列清单,免得各写一份枚举)。 */
export function templatePresetIds(): string[] {
  return TEMPLATE_PRESETS.map((preset) => preset.id);
}

/**
 * 构造本次转换的设置:默认设置 + 可选内置预设 + 两处固定覆盖。
 *
 * @param options.templateId 内置预设 id;缺省 = 不套预设(纯默认设置)
 * @throws {Error} templateId 不是已知预设 —— 调用方应先校验并转成自己的错误形态
 *   (CLI 转用法错、MCP 转工具错误),不要让这个 Error 直接面到用户
 */
export function resolveDeliverySettings(options: { templateId?: string } = {}): AppSettings {
  const settings = cloneDefaultSettings();
  settings.outputDir = "";
  settings.afterConvert = "none";
  if (options.templateId !== undefined) {
    const preset = TEMPLATE_PRESETS.find((candidate) => candidate.id === options.templateId);
    if (!preset) {
      throw new Error(`未知预设:${options.templateId}(可用:${templatePresetIds().join("/")})`);
    }
    // 与 GUI 的 applyTemplatePreset 消费同一个 presetSettingsPatch —— 预设新增可选
    // 字段时三个交付面同步生效,不会出现「CLI/MCP 少应用一项」。
    Object.assign(settings, presetSettingsPatch(preset));
  }
  return settings;
}
