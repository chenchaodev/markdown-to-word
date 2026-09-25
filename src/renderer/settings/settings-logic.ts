/**
 * 设置面板纯逻辑层:自 settings-panel.ts 抽出的零 DOM 依赖纯函数——不触碰
 * document/window/dom.ts 导出、不依赖模块级 DOM 状态,可直接 Node 单测。
 * 依赖仅 core/settings-defaults(契约/常量/硬编码预设,纯模块)。
 * 行为与抽取前逐一对应(settings-panel.ts 仅改 import 路径,零行为改动)。
 * 另抽 applySettingsToControls 的匹配/回填计算、预设保存/删除数据变换、
 * 设置对象与控件值互转、输入校验/钳制——settings-panel.ts 仅保留 DOM 赋值与事件绑定。
 */
import {
  DEFAULT_SETTINGS,
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
  correctPageSetup,
  matchesPreset,
  type AppSettings,
  type CustomPreset,
  type PageSetup,
  type PageSetupCorrectionResult,
  type TemplatePreset,
  type ThemePreference,
} from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";

/** 自定义预设下拉 id 前缀(选中/删除判定与 id 解析共用)。 */
export const CUSTOM_PRESET_ID_PREFIX = "custom:";

/** 同一迁移在 main cache→renderer 多次同步时只显示一次 warning。 */
const shownMigrationWarnings = new Set<string>();

function migrationWarningKey(migration: NonNullable<AppSettings["migration"]>): string {
  return migration.id ?? JSON.stringify({
    original: migration.original,
    corrected: migration.corrected,
    reasons: migration.reasons,
  });
}

export interface SettingsRuntimeEffects {
  setSelectedFormat(format: AppSettings["format"]): void;
  setLanguage(language: AppSettings["language"]): void;
  mirrorLanguage(language: AppSettings["language"]): void;
  applyStaticTexts(): void;
  applyTheme(theme: AppSettings["theme"]): void;
}

/** 设置权威值的运行时副作用单源;保存失败回滚与成功收敛都必须走此顺序。 */
export function applySettingsRuntimeEffects(
  settings: AppSettings,
  effects: SettingsRuntimeEffects,
): void {
  effects.setSelectedFormat(settings.format);
  effects.setLanguage(settings.language);
  effects.mirrorLanguage(settings.language);
  effects.applyStaticTexts();
  effects.applyTheme(settings.theme);
}

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
 * 修复场景:自定义预设值与某硬编码预设全等时,find 命中硬编码项
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

/* ---------- loadSettings / applySettingsToControls / 预设保存删除 / 输入校验 ---------- */

/** renderer normalize 直接返回 core 纠正契约,仅以 error 保留旧调用面字段名。 */
export type NormalizedPageSetup = PageSetupCorrectionResult & {
  /** @deprecated 兼容既有 renderer 调用面;值与 message 相同。 */
  error: string | null;
};

/**
 * renderer 页面设置防线:委托 core 唯一纠正策略。
 * fallback 默认为 DEFAULT_PAGE_SETUP；partial pageSetup patch 传当前 pageSetup 后，
 * 未提供的边距沿用当前值，不会重置为默认。
 */
export function normalizePageSetup(
  value: unknown,
  fallback: PageSetup = DEFAULT_SETTINGS.pageSetup,
): NormalizedPageSetup {
  const result = correctPageSetup(value, fallback);
  return { ...result, error: result.message };
}

/**
 * 设置对象与默认值防御性合并(loadSettings:旧版本设置缺字段时按默认值兜底)。
 * 双源显式化:main 侧 loadSettings 已保证返回完整合法 AppSettings,本函数是
 * renderer 侧的第二道防御(跨进程边界各自兜底,不信任 IPC 对端)——两套实现语义
 * 必须一致(theme/outputDir/pdfCss 等缺失兜底两边各写一遍,改动须双侧同步);
 * 恒等断言由 test 侧守护段落地。
 */
export function mergeSettingsWithDefaults(
  loaded: Partial<AppSettings>,
  onPageSetupError?: (error: string) => void,
): AppSettings {
  const source = loaded ?? {};
  const pageSetup = normalizePageSetup(source.pageSetup);
  const migration = source.migration;
  if (migration?.kind === "page-setup-correction") {
    if (onPageSetupError) {
      const key = migrationWarningKey(migration);
      if (!shownMigrationWarnings.has(key)) {
        shownMigrationWarnings.add(key);
        onPageSetupError(migration.message);
      }
    }
  } else if (pageSetup.error) {
    onPageSetupError?.(pageSetup.error);
  }
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...source,
    outputDir: source.outputDir ?? DEFAULT_SETTINGS.outputDir,
    pageSetup: pageSetup.pageSetup,
    typography: { ...DEFAULT_SETTINGS.typography, ...source.typography },
    // headerFooter 逐字段深合并——旧档缺整块或缺单字段均按默认兜底,
    // 与 main 侧 sanitizeHeaderFooter 语义一致(双侧防御)
    headerFooter: { ...DEFAULT_SETTINGS.headerFooter, ...source.headerFooter },
    // watermark 逐字段深合并(同 headerFooter 先例)
    watermark: { ...DEFAULT_SETTINGS.watermark, ...source.watermark },
    customPresets: source.customPresets ?? DEFAULT_SETTINGS.customPresets,
    pdfCss: source.pdfCss ?? DEFAULT_SETTINGS.pdfCss,
    // theme 缺失(旧 settings.json)→ "system"(显式 null/undefined 同样兜底)
    theme: source.theme ?? DEFAULT_SETTINGS.theme,
  };
  // migration 是 main→renderer 的瞬时提示，不进入 renderer 设置状态或后续 patch。
  delete merged.migration;
  return merged;
}

export type SettingsSaveOutcome = "saved" | "failed" | "superseded";

/** 保存协调器的依赖注入契约:apply 只在成功时用 main 权威值同步 renderer state
 *  与全部控件回填;失败不调用 apply(草稿保留),由 onFailure 呈现失败与未保存状态。 */
export interface SettingsSaveReconciler<T> {
  save(): Promise<T>;
  isCurrent(): boolean;
  apply(settings: T): void;
  onFailure(error: unknown): void;
}

/**
 * 设置保存事务协调:成功且为最新请求时用 main 返回值回填 renderer(权威值);
 * 失败时**不回滚**——不读 main cache、不覆盖控件,用户当前编辑内容原样保留为
 * 草稿(失败期间 main 缓存与磁盘停在最后一次成功值),交由 onFailure 呈现失败与
 * 未保存状态,待下一次保存把草稿一并提交(见 mergePendingSavePatch)。
 * 较旧请求(已被更新请求取代)既不回填也不报错,最终由 isCurrent 判定的最新请求收敛。
 */
export async function reconcileSettingsSave<T>(
  reconciler: SettingsSaveReconciler<T>,
): Promise<SettingsSaveOutcome> {
  let saved: T;
  try {
    saved = await reconciler.save();
  } catch (error: unknown) {
    if (!reconciler.isCurrent()) return "superseded";
    reconciler.onFailure(error);
    return "failed";
  }
  if (!reconciler.isCurrent()) return "superseded";
  reconciler.apply(saved);
  return "saved";
}

/** 块级设置字段(patch 合并时需逐字段深合并,其余为标量后值覆盖)。 */
function mergeBlock<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  // 仅两侧都有值才需合并;缺侧时直接沿用另一侧(展开 current 的语义在调用方兜底)
  if (!a || !b) return undefined;
  return { ...a, ...b };
}

/**
 * 待重试草稿 patch 与新 patch 的合并(纯函数):块级字段逐字段合并、标量后者覆盖。
 * 用途:上次保存失败而保留的草稿必须并入下一次提交,否则失败期间编辑的字段会
 * 永远只留在 renderer 内存(main 侧无该值),形成"控件看起来已改、实际未落盘"的
 * 静默分叉。pending 更早、next 为用户最新编辑,故 next 覆盖 pending。
 */
export function mergePendingSavePatch(
  pending: Partial<AppSettings>,
  next: Partial<AppSettings>,
): Partial<AppSettings> {
  const merged: Partial<AppSettings> = { ...pending, ...next };
  const pageSetup = mergeBlock(pending.pageSetup, next.pageSetup);
  if (pageSetup) merged.pageSetup = pageSetup;
  const typography = mergeBlock(pending.typography, next.typography);
  if (typography) merged.typography = typography;
  const headerFooter = mergeBlock(pending.headerFooter, next.headerFooter);
  if (headerFooter) merged.headerFooter = headerFooter;
  const watermark = mergeBlock(pending.watermark, next.watermark);
  if (watermark) merged.watermark = watermark;
  return merged;
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
  headingScale: string;
  headingSpacing: string;
  firstLineIndent: boolean;
  /** 对齐方式枚举(radio 组 name="align",left/justify) */
  align: AppSettings["typography"]["align"];
  headingNumbering: boolean;
  captionNumbering: boolean;
  breakBeforeH1: boolean;
  toc: boolean;
  tocMode: string;
  equationNumbering: boolean;
  aiCleanup: boolean;
  obsidianCompat: boolean;
  obsidianAttachmentFolder: string;
  afterConvert: string;
  format: string;
  outputDirText: string;
  language: string;
  theme: string;
  /** 页眉页脚 */
  headerMode: AppSettings["headerFooter"]["headerMode"];
  headerText: string;
  headerLayout: AppSettings["headerFooter"]["headerLayout"];
  footerEnabled: boolean;
  headerLogoPath: string;
  /** 文字水印 */
  watermarkText: string;
  watermarkAngle: string;
  watermarkOpacity: string;
  watermarkGray: boolean;
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
    headingScale: settings.typography.headingScale,
    headingSpacing: settings.typography.headingSpacing,
    firstLineIndent: settings.typography.firstLineIndent,
    align: settings.typography.align,
    headingNumbering: settings.typography.headingNumbering,
    captionNumbering: settings.typography.captionNumbering,
    breakBeforeH1: settings.breakBeforeH1,
    toc: settings.toc,
    tocMode: settings.tocMode,
    equationNumbering: settings.equationNumbering,
    aiCleanup: settings.aiCleanup,
    obsidianCompat: settings.obsidianCompat,
    obsidianAttachmentFolder: settings.obsidianAttachmentFolder,
    afterConvert: settings.afterConvert,
    format: settings.format,
    outputDirText: outputDirDisplayText(settings.outputDir),
    language: settings.language,
    theme: settings.theme,
    headerMode: settings.headerFooter.headerMode,
    headerText: settings.headerFooter.headerText,
    headerLayout: settings.headerFooter.headerLayout,
    footerEnabled: settings.headerFooter.footerEnabled,
    headerLogoPath: settings.headerFooter.headerLogoPath,
    watermarkText: settings.watermark.text,
    watermarkAngle: String(settings.watermark.angle),
    watermarkOpacity: String(settings.watermark.opacity),
    watermarkGray: settings.watermark.gray,
  };
}

/**
 * 页眉 logo 路径 → 回显文件名:取末段路径段(兼容 / 与 \ 分隔),
 * 空路径返回空串(调用方显示「未选择」文案)。renderer 无 node:path,自实现。
 */
export function headerLogoDisplayName(headerLogoPath: string): string {
  const segments = headerLogoPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/* ---------- 外观主题:data-theme 属性应用(纯函数,DOM 无关可直测) ---------- */
/** data-theme 属性应用目标最小接口(测试注入假对象,不依赖真实 DOM)。 */
export interface ThemeAttributeTarget {
  setAttribute(qualifiedName: string, value: string): void;
  removeAttribute(qualifiedName: string): void;
}

/**
 * 外观主题 → data-theme 属性(与视觉代理的契约单源):
 * - 显式 light/dark → 设 data-theme="light"|"dark"
 * - system → 移除 data-theme 属性(CSS @media prefers-color-scheme 接管)
 * DOM 无关纯函数:settings-panel.applyTheme 注入 document.documentElement 调用。
 */
export function applyThemeOn(target: ThemeAttributeTarget, theme: ThemePreference): void {
  if (theme === "light" || theme === "dark") target.setAttribute("data-theme", theme);
  else target.removeAttribute("data-theme");
}