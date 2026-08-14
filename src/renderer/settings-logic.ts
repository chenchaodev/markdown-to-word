/**
 * 设置面板纯逻辑层(方向 B「代码质量与测试」速赢项;批次 12 抽取):
 * 自 settings-panel.ts 抽出的零 DOM 依赖纯函数——不触碰 document/window/dom.ts
 * 导出、不依赖模块级 DOM 状态,可直接 Node 单测(经 dist/renderer/settings-logic.js)。
 * 依赖仅 core/settings-defaults(契约/常量/硬编码预设,纯模块)。
 * 行为与抽取前逐一对应(settings-panel.ts 仅改 import 路径,零行为改动)。
 */
import {
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
  type CustomPreset,
  type TemplatePreset,
} from "../core/settings-defaults.js";

/** 自定义预设下拉 id 前缀(选中/删除判定与 id 解析共用)。 */
export const CUSTOM_PRESET_ID_PREFIX = "custom:";

/**
 * 预设名校验(另存为弹窗):空名/同名/达上限 → 错误文案;合法 → null。
 * 校验顺序与抽取前一致:空名 → 同名 → 上限(上限文案含全角逗号,勿改)。
 */
export function validatePresetName(
  name: string,
  existing: readonly CustomPreset[],
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "请输入预设名称";
  if (existing.some((preset) => preset.name === trimmed)) {
    return "已存在同名预设,请换一个名称";
  }
  if (existing.length >= MAX_CUSTOM_PRESETS) {
    return `已达 ${MAX_CUSTOM_PRESETS} 个上限，请先删除`;
  }
  return null;
}

/** 自定义预设 → 下拉选项形态(与硬编码预设同构,matchesPreset/套用逻辑直接复用)。 */
export function customPresetToTemplate(preset: CustomPreset): TemplatePreset {
  return {
    id: `${CUSTOM_PRESET_ID_PREFIX}${preset.name}`,
    name: preset.name,
    hint: "自定义预设",
    typography: preset.typography,
    pageSetup: preset.pageSetup,
  };
}

/** 全部可选预设:硬编码 3 项 + 自定义项(自定义项追加在末尾)。 */
export function allPresets(
  customPresets: readonly CustomPreset[],
): TemplatePreset[] {
  return [...TEMPLATE_PRESETS, ...customPresets.map(customPresetToTemplate)];
}

/** 解析自定义预设下拉值:custom: 前缀 → 名称;非自定义值 → null。 */
export function customPresetNameFromId(value: string): string | null {
  return value.startsWith(CUSTOM_PRESET_ID_PREFIX)
    ? value.slice(CUSTOM_PRESET_ID_PREFIX.length)
    : null;
}

/** 边距钳制到 [MARGIN_MIN_MM, MARGIN_MAX_MM](调用方已过滤非有限数)。 */
export function clampMargin(value: number): number {
  return Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, value));
}