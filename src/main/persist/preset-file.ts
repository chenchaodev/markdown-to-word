/**
 * 持久化纯形状校验层 + 预设文件纯逻辑(零 electron / 零 fs 依赖):
 * - typography / pageSetup / customPresets 的形状校验(字段钳制、去重、截断),
 *   供 settings.ts(读写 settings.json)与本模块的预设文件解析共用,保证两条入口
 *   产出的 CustomPreset 形状完全一致;
 * - 预设文件解析(presetsImport)与合并(同名覆盖)纯逻辑。
 * 依赖方向单向:本模块 → core/(settings 契约 + i18n),不反向依赖 settings.ts,
 * 亦不触达 electron app(读取 userData 路径/写盘留在 settings.ts)——
 * 故 ipc/logic.ts 等纯逻辑层可经本模块取用预设解析/合并,依赖图不触达 electron。
 * 契约类型(ImportPresetsResult 等跨进程形状)单源 core/ipc-contract.ts。
 */
import { t } from "../../core/i18n.js";
import type { TypographySettings } from "../../core/settings/typography.js";
import {
  DEFAULT_TYPOGRAPHY,
  HEADING_SCALE_TIERS,
  HEADING_SPACING_TIERS,
} from "../../core/settings/typography.js";
import type { CustomPreset, PageSetup, PageSetupCorrectionResult } from "../../core/settings/settings-defaults.js";
import { correctPageSetup, DEFAULT_PAGE_SETUP, MAX_CUSTOM_PRESETS } from "../../core/settings/settings-defaults.js";

const ALIGNS = ["left", "justify"] as const;

/** 枚举白名单守卫:本地实现(settings.ts/ui-state.ts 同样自带同款谓词——
 * 为一个一行谓词引入共享 util 不划算,靠各模块自持 + 行为断言防漂移)。 */
function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * typography 逐字段校验:字体非空字符串、字号 8-24pt、行距 1.0-2.5、
 * firstLineIndent/headingNumbering 布尔、align 枚举;任一非法(或缺失字段)
 * → 该项回退 DEFAULT_TYPOGRAPHY 默认值。始终返回合法完整对象(整块兜底)。
 */
export function sanitizeTypography(value: unknown): TypographySettings {
  const src =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const out: TypographySettings = { ...DEFAULT_TYPOGRAPHY };
  if (typeof src.fontAscii === "string" && src.fontAscii.trim() !== "") out.fontAscii = src.fontAscii;
  if (typeof src.fontEastAsia === "string" && src.fontEastAsia.trim() !== "") {
    out.fontEastAsia = src.fontEastAsia;
  }
  if (isFiniteNumber(src.bodySizePt) && src.bodySizePt >= 8 && src.bodySizePt <= 24) {
    out.bodySizePt = src.bodySizePt;
  }
  if (isFiniteNumber(src.lineSpacing) && src.lineSpacing >= 1.0 && src.lineSpacing <= 2.5) {
    out.lineSpacing = src.lineSpacing;
  }
  if (typeof src.firstLineIndent === "boolean") out.firstLineIndent = src.firstLineIndent;
  if (isOneOf(src.align, ALIGNS)) out.align = src.align;
  if (typeof src.headingNumbering === "boolean") out.headingNumbering = src.headingNumbering;
  if (typeof src.captionNumbering === "boolean") out.captionNumbering = src.captionNumbering;
  // 标题排版粒度:档位枚举,非法(或缺失,旧 settings.json)→ 默认 standard 档
  if (isOneOf(src.headingScale, HEADING_SCALE_TIERS)) out.headingScale = src.headingScale;
  if (isOneOf(src.headingSpacing, HEADING_SPACING_TIERS)) out.headingSpacing = src.headingSpacing;
  return out;
}

/**
 * 持久化侧 pageSetup 入口:仅委托 core 唯一纠正策略。
 * 非对象 patch 视为未提供(返回 undefined);对象 patch 以 current 合并语义交给策略,
 * 缺边距不重置。onCorrection 由调用方注入(留痕策略属调用方职责,本模块不落日志)。
 */
export function sanitizePageSetup(
  value: unknown,
  fallback: PageSetup = DEFAULT_PAGE_SETUP,
  onCorrection?: (result: PageSetupCorrectionResult) => void,
): PageSetup | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result = correctPageSetup(value, fallback);
  if (onCorrection) onCorrection(result);
  return result.pageSetup;
}

/**
 * customPresets 逐条校验:
 * - 非数组 → []
 * - 条目须为对象且 name 非空字符串(trim 后);typography 经 sanitizeTypography
 *   逐字段钳制(始终合法),pageSetup 经 sanitizePageSetup(非法对象 → 整条丢弃)
 * - 按名称去重(保留先出现的条目);截断到 MAX_CUSTOM_PRESETS
 */
export function sanitizeCustomPresets(value: unknown): CustomPreset[] {
  if (!Array.isArray(value)) return [];
  const out: CustomPreset[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const src = item as Record<string, unknown>;
    if (typeof src.name !== "string" || src.name.trim() === "") continue;
    const name = src.name.trim();
    if (seen.has(name)) continue; // 同名去重,保留先出现的条目
    const pageSetup = sanitizePageSetup(src.pageSetup);
    if (!pageSetup) continue; // pageSetup 非法 → 整条丢弃
    out.push({ name, typography: sanitizeTypography(src.typography), pageSetup });
    seen.add(name);
    if (out.length >= MAX_CUSTOM_PRESETS) break;
  }
  return out;
}

/* ---------- 模板预设导入/导出纯逻辑(对话框/文件 IO 在 ipc/register.ts) ---------- */
export type ParsePresetsResult =
  | { ok: true; presets: CustomPreset[] }
  | { ok: false; error: string };
export type MergePresetsResult = {
  presets: CustomPreset[];
  /** 合并后保留的 incoming 条数(含覆盖项;受上限截断影响) */
  imported: number;
  /** incoming 与 existing 同名的条数(被覆盖数) */
  overridden: number;
};

/** 导出文件的 schemaVersion(导入侧仅接受 === 1 或裸数组)。 */
export const PRESETS_SCHEMA_VERSION = 1;

/**
 * 解析导入的预设 JSON:
 * - JSON.parse 失败 → 「文件不是有效的 JSON」
 * - 裸数组兼容(归一化);对象须 schemaVersion === 1,其余 → 「不支持的模板文件版本」
 * - 逐条过 sanitizeCustomPresets:空名/非法 pageSetup 丢弃、数值钳制、同名去重保留先出现、截断 10
 * - 无有效预设(空数组/全非法/对象缺 presets 字段)→ 「文件不含有效预设」
 */
export function parsePresetsFile(text: string): ParsePresetsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: t("preset.invalidJson") };
  }
  let rawPresets: unknown;
  if (Array.isArray(parsed)) {
    rawPresets = parsed; // 裸数组兼容
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as { schemaVersion?: unknown; presets?: unknown };
    if (obj.schemaVersion !== PRESETS_SCHEMA_VERSION) {
      return { ok: false, error: t("preset.unsupportedVersion") };
    }
    rawPresets = obj.presets; // 缺 presets 字段 → undefined → 空 → 下方报「文件不含有效预设」
  } else {
    return { ok: false, error: t("preset.unsupportedVersion") };
  }
  const presets = sanitizeCustomPresets(rawPresets);
  if (presets.length === 0) return { ok: false, error: t("preset.noValidPresets") };
  return { ok: true, presets };
}

/**
 * 导入合并:incoming 覆盖 existing 的同名项——合并序 incoming 在前,
 * 复用 sanitizeCustomPresets 去重「保留先出现」的语义;其余追加,截断 10。
 * 入参不被修改(结果为新对象数组)。
 */
export function mergePresets(
  existing: readonly CustomPreset[],
  incoming: readonly CustomPreset[],
): MergePresetsResult {
  const presets = sanitizeCustomPresets([...incoming, ...existing]);
  const overridden = incoming.filter((item) =>
    existing.some((e) => e.name === item.name),
  ).length;
  const imported = presets.filter((item) =>
    incoming.some((i) => i.name === item.name),
  ).length;
  return { presets, imported, overridden };
}
