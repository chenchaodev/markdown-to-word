/**
 * 设置面板纯逻辑层(方向 B「代码质量与测试」速赢项;批次 12 抽取):
 * 自 settings-panel.ts 抽出的零 DOM 依赖纯函数——不触碰 document/window/dom.ts
 * 导出、不依赖模块级 DOM 状态,可直接 Node 单测(经 dist/renderer/settings-logic.js)。
 * 依赖仅 core/settings-defaults(契约/常量/硬编码预设,纯模块)。
 * 行为与抽取前逐一对应(settings-panel.ts 仅改 import 路径,零行为改动)。
 * 批次 15(R2):再抽 applySettingsToControls 的匹配/回填计算、预设保存/删除数据变换、
 * 设置对象与控件值互转、输入校验/钳制——settings-panel.ts 仅保留 DOM 赋值与事件绑定。
 */
import {
  DEFAULT_SETTINGS,
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
  matchesPreset,
  type AppSettings,
  type CustomPreset,
  type TemplatePreset,
} from "../core/settings-defaults.js";
import { t } from "../core/i18n.js";

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
  if (!trimmed) return t("preset.nameRequired");
  if (existing.some((preset) => preset.name === trimmed)) {
    return t("preset.nameDuplicate");
  }
  if (existing.length >= MAX_CUSTOM_PRESETS) {
    return t("preset.nameLimit", { max: MAX_CUSTOM_PRESETS });
  }
  return null;
}

/** 自定义预设 → 下拉选项形态(与硬编码预设同构,matchesPreset/套用逻辑直接复用)。 */
export function customPresetToTemplate(preset: CustomPreset): TemplatePreset {
  return {
    id: `${CUSTOM_PRESET_ID_PREFIX}${preset.name}`,
    name: preset.name,
    hint: t("preset.customHint"),
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

/**
 * 计算模板预设下拉应显示的值:优先保持当前选中(其值与设置一致时不被弹回),
 * 否则回退 matchesPreset 全局匹配(loadSettings/导入/删除后自动选中)。
 * 修复场景(批次 13 bug):自定义预设值与某硬编码预设全等时,find 命中硬编码项
 * 导致选中自定义预设后被弹回——先按 currentValue 精确命中,再走全局匹配。
 */
export function resolvePresetSelection(
  customPresets: readonly CustomPreset[],
  settings: AppSettings,
  currentValue: string,
): string {
  const all = allPresets(customPresets);
  const current = all.find((p) => p.id === currentValue);
  if (current && matchesPreset(current, settings)) return current.id;
  const matched = all.find((preset) => matchesPreset(preset, settings));
  return matched?.id ?? "default";
}

/* ---------- 批次 15(R2):loadSettings / applySettingsToControls / 预设保存删除 / 输入校验 ---------- */

/** 设置对象与默认值防御性合并(loadSettings:旧版本设置缺字段时按默认值兜底)。 */
export function mergeSettingsWithDefaults(loaded: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    outputDir: loaded.outputDir ?? DEFAULT_SETTINGS.outputDir,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, ...loaded.pageSetup },
    typography: { ...DEFAULT_SETTINGS.typography, ...loaded.typography },
    customPresets: loaded.customPresets ?? DEFAULT_SETTINGS.customPresets,
    pdfCss: loaded.pdfCss ?? DEFAULT_SETTINGS.pdfCss,
  };
}

/**
 * 模板预设 hint 计算(applySettingsToControls 回填):选中项为自定义/不存在 →
 * 自定义提示文案 + isCustom=true;否则返回该预设 hint + isCustom=false。
 * 文案与抽取前一致(「已微调,与模板预设不一致」)。
 */
export function resolvePresetHint(
  customPresets: readonly CustomPreset[],
  matchedPresetId: string,
): { hint: string; isCustom: boolean } {
  const matchedPreset = allPresets(customPresets).find((p) => p.id === matchedPresetId);
  const isCustom = !matchedPreset;
  return {
    hint: isCustom
      ? t("preset.modifiedHint")
      : (matchedPreset ?? TEMPLATE_PRESETS[0]).hint,
    isCustom,
  };
}

/** 输出目录显示文案:空串 = 「与源文件相同目录」(回填与恢复默认共用)。 */
export function outputDirDisplayText(outputDir: string): string {
  return outputDir || t("settings.outputDirDefault");
}

/** 另存为预设条目构造:名称 + 当前排版/页面设置快照(深拷贝,后续修改不影响源)。 */
export function buildCustomPresetEntry(name: string, settings: AppSettings): CustomPreset {
  return {
    name,
    typography: { ...settings.typography },
    pageSetup: { ...settings.pageSetup },
  };
}

/** 按名称删除自定义预设(保序;无匹配返回原列表)。 */
export function removeCustomPresetByName(
  customPresets: readonly CustomPreset[],
  name: string,
): CustomPreset[] {
  return customPresets.filter((preset) => preset.name !== name);
}

/** 边距输入解析:非有限数 → null(调用方恢复当前值并提示);有限数 → 钳制后值。 */
export function parseMarginValue(value: number): number | null {
  return Number.isFinite(value) ? clampMargin(value) : null;
}

/** 数值范围校验(字号/行距输入):有限数且在 [min, max] 内 → true。 */
export function validateNumberRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/* ---------- 设置对象 → 控件回填值映射(applySettingsToControls 纯计算抽取) ---------- */
/** 边距字段键(与 dom.ts marginInputs 键集一致)。 */
export type MarginField = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";

/** 设置 → 控件回填值(纯计算;DOM 赋值留在 settings-panel.ts)。 */
export interface SettingsControlValues {
  paper: string;
  orientation: string;
  margins: Record<MarginField, string>;
  fontAscii: string;
  fontEastAsia: string;
  bodySizePt: string;
  lineSpacing: string;
  firstLineIndent: boolean;
  alignJustify: boolean;
  headingNumbering: boolean;
  captionNumbering: boolean;
  breakBeforeH1: boolean;
  toc: boolean;
  equationNumbering: boolean;
  afterConvert: string;
  format: string;
  outputDirText: string;
  language: string;
}

/** 设置对象 → 控件回填值(数值字段转字符串,与 DOM value 赋值一致)。 */
export function settingsToControlValues(settings: AppSettings): SettingsControlValues {
  return {
    paper: settings.pageSetup.paper,
    orientation: settings.pageSetup.orientation,
    margins: {
      marginTop: String(settings.pageSetup.marginTop),
      marginBottom: String(settings.pageSetup.marginBottom),
      marginLeft: String(settings.pageSetup.marginLeft),
      marginRight: String(settings.pageSetup.marginRight),
    },
    fontAscii: settings.typography.fontAscii,
    fontEastAsia: settings.typography.fontEastAsia,
    bodySizePt: String(settings.typography.bodySizePt),
    lineSpacing: String(settings.typography.lineSpacing),
    firstLineIndent: settings.typography.firstLineIndent,
    alignJustify: settings.typography.align === "justify",
    headingNumbering: settings.typography.headingNumbering,
    captionNumbering: settings.typography.captionNumbering,
    breakBeforeH1: settings.breakBeforeH1,
    toc: settings.toc,
    equationNumbering: settings.equationNumbering,
    afterConvert: settings.afterConvert,
    format: settings.format,
    outputDirText: outputDirDisplayText(settings.outputDir),
    language: settings.language,
  };
}