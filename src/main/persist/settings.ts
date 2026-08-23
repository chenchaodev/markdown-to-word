/**
 * 应用设置持久化:userData/settings.json(手写实现,不引 electron-store)。
 * 模块级内存缓存 + 惰性加载:首次 loadSettings 读盘,之后读缓存;
 * 因此 app.getPath("userData") 天然只在 app.whenReady 之后才被调用。
 * 文件损坏(JSON parse 失败或形状非法)→ 返回默认值,不写盘。
 * 回退策略(与 ui-state.ts 的差异是有意的,勿对齐):settings 为「整文件回退」——
 * 任一字段非法即整体回退 DEFAULT_SETTINGS(核心配置契约,宁可全默认也不半保留);
 * ui-state.ts 为「字段级宽松回退」——UI 状态损坏只丢对应字段(见 ui-state.ts 头注释)。
 * 写入经 promise 链串行化(saveSettings 写队列):并发调用不会交错写同一
 * tmp 文件,调用序 = 写盘序,链尾即最终态(防并发丢更新)。
 * 契约(AppSettings 类型/DEFAULT_SETTINGS/范围常量)收敛于 core/settings-defaults.ts,
 * 此处只做持久化与校验;AppSettings 类型 re-export 保持 index.ts/converter.ts 导入面。
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createJsonWriter } from "./atomic-json.js";
// 页面设置契约单源(settings-defaults;原经 core/convert.js 导入形成环,B7 解环)
import type { PageSetup } from "../../core/settings/settings-defaults.js";
import { DEFAULT_PAGE_SETUP } from "../../core/settings/settings-defaults.js";
import type { TypographySettings } from "../../core/settings/typography.js";
import { DEFAULT_TYPOGRAPHY } from "../../core/settings/typography.js";
import {
  DEFAULT_SETTINGS,
  MARGIN_MIN_MM,
  MARGIN_MAX_MM,
  MAX_CUSTOM_PRESETS,
  type AppSettings,
  type CustomPreset,
} from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
export { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";

const SETTINGS_FILE_NAME = "settings.json";
const FORMATS = ["docx", "pdf"] as const;
const AFTER_CONVERT_ACTIONS = ["none", "show-in-folder", "open"] as const;
const PAPERS = ["A4", "A3", "A5", "Letter", "Legal"] as const;
const ORIENTATIONS = ["portrait", "landscape"] as const;
const ALIGNS = ["left", "justify"] as const;
const THEMES = ["system", "light", "dark"] as const;
const SETTING_KEYS = [
  "version",
  "format",
  "pageSetup",
  "typography",
  "breakBeforeH1",
  "toc",
  "equationNumbering",
  "afterConvert",
  "outputDir",
  "customPresets",
  "pdfCss",
  "language",
  "theme",
] as const;

/** 模块级内存缓存:惰性加载(首次 loadSettings 读盘,之后读缓存) */
let settingsCache: AppSettings | null = null;

/** 原子写 + 写队列(共享工具,见 atomic-json.ts;独立队列,与 ui-state 互不串扰) */
const writeSettingsJson = createJsonWriter();

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 输出目录:空串(源文件同目录)或绝对路径字符串;其余(相对路径/非字符串)非法 */
function isValidOutputDir(value: unknown): value is string {
  return typeof value === "string" && (value === "" || path.isAbsolute(value));
}

/**
 * 整文件形状校验:任一字段非法即视为损坏,整体回退默认。
 * 导出供直测(R3,presets-import 同模式):loadSettings 的「整文件回退」语义
 * 由本函数判定,测试直接断言合法/非法输入,不依赖磁盘 IO。
 */
export function isValidSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.version !== 1) return false;
  if (!isOneOf(s.format, FORMATS)) return false;
  if (!isOneOf(s.afterConvert, AFTER_CONVERT_ACTIONS)) return false;
  if (typeof s.breakBeforeH1 !== "boolean") return false;
  // toc 缺失(旧 settings.json)视为合法,loadSettings 兜底为 true;存在则须合法
  if ("toc" in s && typeof s.toc !== "boolean") return false;
  // equationNumbering 缺失(旧 settings.json)视为合法,loadSettings 兜底为 true;存在则须合法
  if ("equationNumbering" in s && typeof s.equationNumbering !== "boolean") return false;
  // outputDir 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "";存在则须合法
  if ("outputDir" in s && !isValidOutputDir(s.outputDir)) return false;
  // pdfCss 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "";存在则须 string
  if ("pdfCss" in s && typeof s.pdfCss !== "string") return false;
  // language 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "zh";存在则须 zh/en
  if ("language" in s && s.language !== "zh" && s.language !== "en") return false;
  // theme 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "system";存在则须枚举内值
  if ("theme" in s && !isOneOf(s.theme, THEMES)) return false;
  const ps = s.pageSetup as Record<string, unknown> | undefined;
  if (typeof ps !== "object" || ps === null) return false;
  if (!isOneOf(ps.paper, PAPERS)) return false;
  if (!isOneOf(ps.orientation, ORIENTATIONS)) return false;
  if (
    !isFiniteNumber(ps.marginTop) ||
    !isFiniteNumber(ps.marginBottom) ||
    !isFiniteNumber(ps.marginLeft) ||
    !isFiniteNumber(ps.marginRight)
  ) {
    return false;
  }
  return true;
}

export function loadSettings(): AppSettings {
  if (settingsCache) return settingsCache;
  let loaded: AppSettings = DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(settingsFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isValidSettings(parsed)) {
      // typography 不参与整文件形状校验:旧 settings.json 缺该字段时,
      // 其余设置保留,typography 经 sanitize 自然落到默认,不报错
      // outputDir 同理:缺失(旧文件)→ 兜底 ""
      loaded = {
        ...parsed,
        outputDir: isValidOutputDir(parsed.outputDir) ? parsed.outputDir : "",
        toc: typeof parsed.toc === "boolean" ? parsed.toc : DEFAULT_SETTINGS.toc,
        equationNumbering:
          typeof parsed.equationNumbering === "boolean"
            ? parsed.equationNumbering
            : DEFAULT_SETTINGS.equationNumbering,
        // 批次 16:pdfCss 缺失(旧文件)→ "";存在 → 原样保留
        pdfCss: typeof parsed.pdfCss === "string" ? parsed.pdfCss : DEFAULT_SETTINGS.pdfCss,
        // i18n:language 缺失(旧文件)→ "zh";存在 → 原样保留(zh/en 已过形状校验)
        language: parsed.language === "en" ? "en" : "zh",
        // B13:theme 缺失(旧文件)→ "system";存在 → 原样保留(枚举已过形状校验)
        theme: isOneOf(parsed.theme, THEMES) ? parsed.theme : DEFAULT_SETTINGS.theme,
        typography: sanitizeTypography(parsed.typography),
        // 批次 11 迭代 3:customPresets 缺失(旧文件)→ [];存在 → 逐条校验
        customPresets: sanitizeCustomPresets(parsed.customPresets),
      };
    }
  } catch {
    // 缺文件 / 读取失败 / parse 失败 → 默认值(不写盘)
  }
  settingsCache = loaded;
  return loaded;
}

/** 原子写:临时文件 + rename(Windows 下 rename 可覆盖已存在文件)。
 *  M4:经写队列串行执行——write+rename 之间不得插入其它写(同 tmp 路径),
 *  调用序 = 写盘序,链尾即最终态;缓存更新与写盘同序,失败不截断队列。 */
export async function saveSettings(next: AppSettings): Promise<void> {
  await writeSettingsJson(settingsFilePath(), next, () => {
    settingsCache = next;
  });
}

/** 合并 + 持久化 + 返回;patch 按 DEFAULT_SETTINGS 键白名单校验,非法值回退默认 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...loadSettings(), ...sanitizePatch(patch) };
  await saveSettings(next);
  return next;
}

function sanitizePatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return {};
  const src = patch as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in src)) continue;
    switch (key) {
      case "version":
        out.version = src.version === 1 ? 1 : DEFAULT_SETTINGS.version;
        break;
      case "format":
        out.format = isOneOf(src.format, FORMATS) ? src.format : DEFAULT_SETTINGS.format;
        break;
      case "afterConvert":
        out.afterConvert = isOneOf(src.afterConvert, AFTER_CONVERT_ACTIONS)
          ? src.afterConvert
          : DEFAULT_SETTINGS.afterConvert;
        break;
      case "breakBeforeH1":
        out.breakBeforeH1 =
          typeof src.breakBeforeH1 === "boolean" ? src.breakBeforeH1 : DEFAULT_SETTINGS.breakBeforeH1;
        break;
      case "toc":
        out.toc = typeof src.toc === "boolean" ? src.toc : DEFAULT_SETTINGS.toc;
        break;
      case "equationNumbering":
        out.equationNumbering =
          typeof src.equationNumbering === "boolean"
            ? src.equationNumbering
            : DEFAULT_SETTINGS.equationNumbering;
        break;
      case "outputDir":
        out.outputDir = isValidOutputDir(src.outputDir) ? src.outputDir : DEFAULT_SETTINGS.outputDir;
        break;
      case "pageSetup": {
        const pageSetup = sanitizePageSetup(src.pageSetup);
        if (pageSetup) out.pageSetup = pageSetup;
        break;
      }
      case "typography":
        out.typography = sanitizeTypography(src.typography);
        break;
      case "customPresets":
        out.customPresets = sanitizeCustomPresets(src.customPresets);
        break;
      case "pdfCss":
        out.pdfCss = typeof src.pdfCss === "string" ? src.pdfCss : DEFAULT_SETTINGS.pdfCss;
        break;
      case "language":
        out.language = src.language === "en" || src.language === "zh" ? src.language : DEFAULT_SETTINGS.language;
        break;
      case "theme":
        out.theme = isOneOf(src.theme, THEMES) ? src.theme : DEFAULT_SETTINGS.theme;
        break;
    }
  }
  return out;
}

/**
 * customPresets 逐条校验(批次 11 迭代 3):
 * - 非数组 → []
 * - 条目须为对象且 name 非空字符串(trim 后);typography 经 sanitizeTypography
 *   逐字段钳制(始终合法),pageSetup 经 sanitizePageSetup(非法对象 → 整条丢弃)
 * - 按名称去重(保留先出现的条目);截断到 MAX_CUSTOM_PRESETS
 */
function sanitizeCustomPresets(value: unknown): CustomPreset[] {
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

/* ---------- 批次 13:模板预设导入/导出(纯逻辑;对话框/文件 IO 在 index.ts IPC 层) ---------- */
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
export type ImportPresetsResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; imported: number; overridden: number }
  | { ok: false; error: string };
export type ExportPresetsResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; count: number }
  | { ok: false; error: string };

/* ---------- 批次 16:PDF 样式 CSS 导入(对话框/文件 IO 在 index.ts IPC 层) ---------- */
/** PDF 自定义 CSS 导入大小上限(字节;超出拒绝导入,防误选大文件拖垮 settings.json)。 */
export const MAX_PDF_CSS_BYTES = 100 * 1024;

export type ImportPdfCssResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; css: string; name: string }
  | { ok: false; error: string };

/** 导出文件的 schemaVersion(导入侧仅接受 === 1 或裸数组)。 */
export const PRESETS_SCHEMA_VERSION = 1;

/**
 * 解析导入的预设 JSON(批次 13):
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
 * 导入合并(批次 13):incoming 覆盖 existing 的同名项——合并序 incoming 在前,
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

/** pageSetup 逐字段校验:paper/orientation 枚举,数值钳制 0-1000mm,非法字段回退默认 */
function sanitizePageSetup(value: unknown): PageSetup | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const ps = value as Record<string, unknown>;
  const out: PageSetup = { ...DEFAULT_PAGE_SETUP };
  if (isOneOf(ps.paper, PAPERS)) out.paper = ps.paper;
  if (isOneOf(ps.orientation, ORIENTATIONS)) out.orientation = ps.orientation;
  const clamp = (v: unknown, fallback: number): number =>
    isFiniteNumber(v) ? Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, v)) : fallback;
  out.marginTop = clamp(ps.marginTop, DEFAULT_PAGE_SETUP.marginTop);
  out.marginBottom = clamp(ps.marginBottom, DEFAULT_PAGE_SETUP.marginBottom);
  out.marginLeft = clamp(ps.marginLeft, DEFAULT_PAGE_SETUP.marginLeft);
  out.marginRight = clamp(ps.marginRight, DEFAULT_PAGE_SETUP.marginRight);
  return out;
}

/**
 * typography 逐字段校验:字体非空字符串、字号 8-24pt、行距 1.0-2.5、
 * firstLineIndent/headingNumbering 布尔、align 枚举;任一非法(或缺失字段)
 * → 该项回退 DEFAULT_TYPOGRAPHY 默认值。始终返回合法完整对象(整块兜底)。
 */
function sanitizeTypography(value: unknown): TypographySettings {
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
  return out;
}
