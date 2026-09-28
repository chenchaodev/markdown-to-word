/**
 * 应用设置持久化:userData/settings.json(手写实现,不引 electron-store)。
 * 模块级内存缓存 + 惰性加载:首次 loadSettings 读盘,之后读缓存;
 * 因此 app.getPath("userData") 天然只在 app.whenReady 之后才被调用。
 * 文件损坏(JSON parse 失败或非 pageSetup 字段形状非法)→ 返回默认值,不写盘；
 * pageSetup 非法则只迁移该块并保留其它用户设置，纠正结果经 IPC 瞬时 warning 交给
 * renderer，同时排入原子写队列固化。
 * 回退策略(与 ui-state.ts 的差异是有意的,勿对齐):settings 的非 pageSetup
 * 字段为「整文件回退」——任一字段非法即整体回退 DEFAULT_SETTINGS；ui-state.ts
 * 为「字段级宽松回退」——UI 状态损坏只丢对应字段(见 ui-state.ts 头注释)。
 * 写入经 promise 链串行化(saveSettings 写队列):并发调用不会交错写同一
 * tmp 文件,调用序 = 写盘序,链尾即最终态(防并发丢更新);
 * 「读当前值 → 合并 patch → 落盘 → 提交缓存」整体在同一 mutation queue 内完成,
 * 故并发不同字段 patch 互不覆盖;写失败不提交缓存——内存与磁盘都停在最后一次
 * 成功值(重启读回一致),错误上抛由调用方呈现,不静默显示成功。
 * 契约(AppSettings 类型/DEFAULT_SETTINGS/范围常量)收敛于 core/settings-defaults.ts,
 * 此处只做持久化与校验;AppSettings/DEFAULT_SETTINGS re-export 保持既有导入面
 * (converter/ipc 各模块经 persist/settings 导入)。
 * 形状校验与预设文件逻辑在纯模块 preset-file.ts(零 electron 依赖),本模块
 * 只保留 electron/fs 触点(userData 路径、读盘、写队列),确保纯逻辑层
 * (ipc/logic.ts)不经本模块即可取用预设解析/合并,依赖图不触达 electron。
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createJsonWriter } from "./atomic-json.js";
import {
  sanitizeCustomPresets,
  sanitizePageSetup,
  sanitizeTypography,
} from "./preset-file.js";
// 页面设置契约单源(settings-defaults;原经 core/convert.js 导入形成环,已解环)
import type {
  PageSetupCorrectionResult,
  SettingsMigrationNotice,
} from "../../core/settings/settings-defaults.js";
import { correctPageSetup } from "../../core/settings/settings-defaults.js";
import {
  DEFAULT_SETTINGS,
  DEFAULT_AI_CLEANUP,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_OBSIDIAN,
  DEFAULT_WATERMARK,
  type AiCleanupSettings,
  type AppSettings,
  type HeaderFooterSettings,
  type ObsidianSettings,
  type WatermarkSettings,
} from "../../core/settings/settings-defaults.js";
import { isLanguage } from "../../core/i18n.js";
export { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";
// 跨进程结果契约单源 core/ipc-contract.ts;此处 re-export 保持 ipc/register.ts
// 既有导入面(实现不消费这些类型,仅类型转发)。
export type {
  ExportPresetsResult,
  ImportDocxTemplateResult,
  ImportPdfCssResult,
  ImportPresetsResult,
} from "../../core/ipc-contract.js";

const SETTINGS_FILE_NAME = "settings.json";
const FORMATS = ["docx", "pdf"] as const;
const AFTER_CONVERT_ACTIONS = ["none", "show-in-folder", "open"] as const;
const THEMES = ["system", "light", "dark"] as const;
const TOC_MODES = ["static", "field"] as const;
const HEADER_MODES = ["default", "custom", "none"] as const;
const HEADER_LAYOUTS = ["center", "leftRight"] as const;
const SETTING_KEYS = [
  "version",
  "format",
  "pageSetup",
  "typography",
  "breakBeforeH1",
  "toc",
  "tocMode",
  "equationNumbering",
  "afterConvert",
  "outputDir",
  "customPresets",
  "pdfCss",
  "language",
  "theme",
  "headerFooter",
  "watermark",
  "aiCleanup",
  "obsidian",
] as const;

/**
 * 分组前的旧平铺键(只列改名的 4 个:旧的 aiCleanup 布尔与新键同名,被新对象
 * 直接覆盖,不会搭车)。它们只在迁移取值时被读,不得留在内存对象或
 * settings.json 里 —— loadSettings/persistedSettings 都是整对象展开,
 * 不显式剔除就会每次写盘原样带回,文件永远收敛不到新形状。
 */
const LEGACY_TRANSFORM_KEYS = [
  "aiCleanupTidy",
  "aiCleanupRewrite",
  "obsidianCompat",
  "obsidianAttachmentFolder",
] as const;

/** 旧形状平铺键的取值(仅供迁移补位,不落盘);缺项即"该旧键没写过"。 */
interface LegacyTransformFlags {
  enabled?: unknown;
  tidy?: unknown;
  rewrite?: unknown;
  compat?: unknown;
  attachmentFolder?: unknown;
}

const NO_LEGACY_TRANSFORM_FLAGS: LegacyTransformFlags = {};

/**
 * 从任意落盘对象里取旧形状取值(读入能力保留一个版本,adr-024 决定要点四)。
 * 旧 aiCleanup 是布尔总开关、新 aiCleanup 是对象:按类型区分而非按名字区分,
 * 所以同一个键名两种形状都能读。
 */
function readLegacyTransformFlags(source: object): LegacyTransformFlags {
  const record = source as Record<string, unknown>;
  return {
    enabled: typeof record.aiCleanup === "boolean" ? record.aiCleanup : undefined,
    tidy: record.aiCleanupTidy,
    rewrite: record.aiCleanupRewrite,
    compat: record.obsidianCompat,
    attachmentFolder: record.obsidianAttachmentFolder,
  };
}

/** 剔除旧平铺键(就地改传入的浅拷贝,不改调用方对象)。 */
function stripLegacyTransformKeys(settings: AppSettings): AppSettings {
  const target = { ...settings } as AppSettings & Record<string, unknown>;
  for (const key of LEGACY_TRANSFORM_KEYS) delete target[key];
  return target;
}

/** 模块级内存缓存:惰性加载(首次 loadSettings 读盘,之后读缓存) */
let settingsCache: AppSettings | null = null;

/** 原子写 + 写队列(共享工具,见 atomic-json.ts;独立队列,与 ui-state 互不串扰) */
const writeSettingsJson = createJsonWriter();

/** migration 仅供 IPC 瞬时消费;写盘前必须从完整设置剥离。 */
function persistedSettings(settings: AppSettings): AppSettings {
  const persisted = { ...settings };
  delete persisted.migration;
  return stripLegacyTransformKeys(persisted);
}

function warnPageSetupCorrection(
  result: PageSetupCorrectionResult,
  context: "load" | "update",
): void {
  if (!result.corrected || !result.message) return;
  console.warn(
    `[settings] ${context} pageSetup 已自动修正:${result.message}${JSON.stringify(result.pageSetup)}`,
  );
}

function schedulePageSetupMigration(
  settings: AppSettings,
  migration: SettingsMigrationNotice,
): void {
  // 必须进入同一写队列，并在真正执行时取最新 cache，不能把 load 时的旧完整
  // 快照排在后续 update 之前写回；否则迁移写成功但会把用户刚改的字段覆盖掉。
  void writeSettingsJson.enqueue(async (write) => {
    const current = settingsCache ?? settings;
    const persisted = persistedSettings(current);
    try {
      await write(settingsFilePath(), persisted, () => {
        if (settingsCache?.migration === migration) {
          settingsCache.migration.persistence = "committed";
        }
      });
    } catch (error: unknown) {
      if (settingsCache?.migration === migration) {
        settingsCache.migration.persistence = "failed";
      }
      // renderer 已收到 migration；这里再留持久化失败日志，禁止静默吞错。
      console.error("[settings] pageSetup 迁移结果写盘失败", error);
    }
  });
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 分组块的字段类型表:形状校验一处声明,字段名不各写一遍。 */
const AI_CLEANUP_BOOLEAN_FIELDS = ["enabled", "tidy", "rewrite"] as const;
const OBSIDIAN_FIELD_TYPES: readonly (readonly [string, "boolean" | "string"])[] = [
  ["compat", "boolean"],
  ["attachmentFolder", "string"],
];

/**
 * 块内字段类型校验:字段缺省合法(旧 settings.json 缺字段交由加载兜底补默认,
 * 与 toc/theme 可选字段同一口径),存在则须为声明类型。同类型字段表与
 * 混合类型表各走一个重载,避免调用点重复展开成 if 链。
 */
function hasTypesOf(
  source: Record<string, unknown>,
  fields: readonly string[],
  type: "boolean" | "string",
): boolean;
function hasTypesOf(
  source: Record<string, unknown>,
  fields: readonly (readonly [string, "boolean" | "string"])[],
): boolean;
function hasTypesOf(
  source: Record<string, unknown>,
  fields: readonly (string | readonly [string, "boolean" | "string"])[],
  type?: "boolean" | "string",
): boolean {
  for (const field of fields) {
    const [key, fieldType] = typeof field === "string" ? [field, type] : field;
    if (key === undefined) continue;
    if (!(key in source)) continue;
    if (typeof source[key] !== fieldType) return false;
  }
  return true;
}

/**
 * 整文件形状校验:非 pageSetup 字段任一非法即视为损坏,整体回退默认；
 * pageSetup 非法交由 core correctPageSetup 做字段级迁移。
 * 导出供直测:loadSettings 的「整文件回退 + pageSetup 迁移」语义由本函数判定,
 * 测试直接断言合法/非法输入,不依赖磁盘 IO。
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
  // tocMode 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "static";存在则须枚举内值
  if ("tocMode" in s && !isOneOf(s.tocMode, TOC_MODES)) return false;
  // equationNumbering 缺失(旧 settings.json)视为合法,loadSettings 兜底为 true;存在则须合法
  if ("equationNumbering" in s && typeof s.equationNumbering !== "boolean") return false;
  // outputDir 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "";存在则须合法
  if ("outputDir" in s && !isValidOutputDir(s.outputDir)) return false;
  // pdfCss 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "";存在则须 string
  if ("pdfCss" in s && typeof s.pdfCss !== "string") return false;
  // language 不参与整文件形状校验(缺失与非法值均放行):语言裁撤迁移场景
  // (已存 ko/fr/ru)若在此整文件拒绝,用户全部偏好将被默认值覆盖——
  // 改由 loadSettings 对 language 字段级兜底 DEFAULT_SETTINGS.language(zh)
  // theme 缺失(旧 settings.json)视为合法,loadSettings 兜底为 "system";存在则须枚举内值
  if ("theme" in s && !isOneOf(s.theme, THEMES)) return false;
  // 新增开关为可选字段(旧 settings.json 缺省视为合法,loadSettings 兜底默认)
  // 分组后的两块同样参与整文件形状校验(adr-024 决定要点一:不得因分组而把
  // 「任一字段非法 → 整文件回退」放宽成字段级兜底)。两种形状都放行:
  // 新形状是对象,旧形状是平铺 boolean/字符串(迁移读入,见 readLegacyTransformFlags)。
  if ("aiCleanup" in s) {
    // 旧形状 = 布尔总开关;新形状 = 对象(块内三个字段存在则须 boolean,缺字段合法)
    if (typeof s.aiCleanup === "boolean") {
      // 旧形状,合法
    } else if (isPlainObject(s.aiCleanup) && hasTypesOf(s.aiCleanup, AI_CLEANUP_BOOLEAN_FIELDS, "boolean")) {
      // 新形状,合法
    } else return false;
  }
  if ("obsidian" in s && (!isPlainObject(s.obsidian) || !hasTypesOf(s.obsidian, OBSIDIAN_FIELD_TYPES))) {
    return false;
  }
  if ("aiCleanupTidy" in s && typeof s.aiCleanupTidy !== "boolean") return false;
  if ("aiCleanupRewrite" in s && typeof s.aiCleanupRewrite !== "boolean") return false;
  if ("obsidianCompat" in s && typeof s.obsidianCompat !== "boolean") return false;
  if ("obsidianAttachmentFolder" in s && typeof s.obsidianAttachmentFolder !== "string") return false;
  // pageSetup 整块交由 core correctPageSetup 迁移：非法 paper/orientation/几何只
  // 修正该块，不能让旧配置连带丢失其它用户设置。
  return true;
}

export function loadSettings(): AppSettings {
  // 双源显式化:本函数(main 侧 sanitize/兜底)与 renderer 侧
  // settings-logic.ts mergeSettingsWithDefaults 是有意的双侧防御——跨进程边界
  // (settingsGet IPC)两侧各自保证「返回完整合法 AppSettings」,任一侧兜底逻辑
  // 改动(尤其 theme/outputDir/pdfCss 缺失兜底)必须保持语义一致;恒等断言由
  // test 侧守护段落地,改此处前先核对另一侧。
  if (settingsCache) return settingsCache;
  let loaded: AppSettings = DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(settingsFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isValidSettings(parsed)) {
      // 旧形状取值(分组前的平铺键):只用于补位,不进最终对象
      const legacy = readLegacyTransformFlags(parsed);
      // pageSetup 由 core 唯一纯策略纠正；其它旧字段仍按原策略逐项兜底。
      const pageSetupCorrection = correctPageSetup(parsed.pageSetup);
      warnPageSetupCorrection(pageSetupCorrection, "load");
      const migration: SettingsMigrationNotice | undefined = pageSetupCorrection.corrected
        ? {
            kind: "page-setup-correction",
            id: JSON.stringify({
              original: parsed.pageSetup,
              corrected: pageSetupCorrection.pageSetup,
              reasons: pageSetupCorrection.reasons,
            }),
            original: parsed.pageSetup,
            corrected: pageSetupCorrection.pageSetup,
            reasons: pageSetupCorrection.reasons,
            message: pageSetupCorrection.message ?? "页面设置已自动修正。",
            persistence: "scheduled",
          }
        : undefined;
      loaded = {
        ...stripLegacyTransformKeys(parsed),
        pageSetup: pageSetupCorrection.pageSetup,
        ...(migration ? { migration } : {}),
        outputDir: isValidOutputDir(parsed.outputDir) ? parsed.outputDir : "",
        toc: typeof parsed.toc === "boolean" ? parsed.toc : DEFAULT_SETTINGS.toc,
        // tocMode 缺失(旧文件)→ "static";存在 → 原样保留(枚举已过形状校验)
        tocMode: isOneOf(parsed.tocMode, TOC_MODES) ? parsed.tocMode : DEFAULT_SETTINGS.tocMode,
        equationNumbering:
          typeof parsed.equationNumbering === "boolean"
            ? parsed.equationNumbering
            : DEFAULT_SETTINGS.equationNumbering,
        // pdfCss 缺失(旧文件)→ "";存在 → 原样保留
        pdfCss: typeof parsed.pdfCss === "string" ? parsed.pdfCss : DEFAULT_SETTINGS.pdfCss,
        // i18n:language 缺失(旧文件)→ 默认 zh;存在但已不在注册表(语言裁撤,
        // 如 ko/fr/ru)→ 字段级兜底 zh,其余偏好原样保留
        language: isLanguage(parsed.language) ? parsed.language : DEFAULT_SETTINGS.language,
        // theme 缺失(旧文件)→ "system";存在 → 原样保留(枚举已过形状校验)
        theme: isOneOf(parsed.theme, THEMES) ? parsed.theme : DEFAULT_SETTINGS.theme,
        typography: sanitizeTypography(parsed.typography),
        // customPresets 缺失(旧文件)→ [];存在 → 逐条校验
        customPresets: sanitizeCustomPresets(parsed.customPresets),
        // headerFooter 不参与 isValidSettings 整文件形状校验(同 typography 先例——旧文件缺字段走字段级兜底,不因部分字段缺失整体回退默认)
        headerFooter: sanitizeHeaderFooter(parsed.headerFooter),
        // watermark 同 headerFooter 先例(整文件形状校验不查;字段级兜底)
        watermark: sanitizeWatermark(parsed.watermark),
        // 旧 settings.json 缺整块/缺字段 → 逐字段兜底默认(与 headerFooter/watermark
        // 同先例);旧平铺键在对应新字段缺位时补位(迁移,读入能力保留一个版本)
        aiCleanup: sanitizeAiCleanup(parsed.aiCleanup, legacy),
        obsidian: sanitizeObsidian(parsed.obsidian, legacy),
      };
      if (!migration) delete loaded.migration;
      if (migration) schedulePageSetupMigration(loaded, migration);
    }
  } catch {
    // 缺文件 / 读取失败 / parse 失败 → 默认值(不写盘)
  }
  settingsCache = loaded;
  return loaded;
}

/** 原子写:临时文件 + rename(Windows 下 rename 可覆盖已存在文件)。
 *  读当前值、合并 patch、序列化、提交缓存整体在 writeSettingsJson 队列中完成。
 *  这样并发不同字段 patch 不会因“队列外读旧缓存”互相覆盖;失败向调用方抛出,
 *  不提交缓存,后续队列任务仍可继续。 */
export async function saveSettings(next: AppSettings): Promise<void> {
  const persisted = persistedSettings(next);
  await writeSettingsJson.enqueue(async (write) => {
    await write(settingsFilePath(), persisted, () => {
      settingsCache = persisted;
    });
  });
}

/** 等设置写队列排空:loadSettings 的迁移写是 fire-and-forget(见其调度处),退出前
 *  必须 drain,否则队列里未落盘的迁移结果会随进程一起丢掉。 */
export function whenSettingsIdle(): Promise<void> {
  return writeSettingsJson.drain();
}

/** 合并 + 持久化 + 返回;patch 按 DEFAULT_SETTINGS 键白名单校验,非法值回退默认。 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return writeSettingsJson.enqueue(async (write) => {
    const current = loadSettings();
    const next: AppSettings = {
      ...persistedSettings(current),
      ...sanitizePatch(patch, current),
    };
    await write(settingsFilePath(), next, () => {
      settingsCache = next;
    });
    return next;
  });
}

function sanitizePatch(patch: unknown, current: AppSettings): Partial<AppSettings> {
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
      case "tocMode":
        out.tocMode = isOneOf(src.tocMode, TOC_MODES) ? src.tocMode : DEFAULT_SETTINGS.tocMode;
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
        const pageSetup = sanitizePageSetup(src.pageSetup, current.pageSetup, (result) =>
          warnPageSetupCorrection(result, "update"),
        );
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
        out.language = isLanguage(src.language) ? src.language : DEFAULT_SETTINGS.language;
        break;
      case "theme":
        out.theme = isOneOf(src.theme, THEMES) ? src.theme : DEFAULT_SETTINGS.theme;
        break;
      case "headerFooter":
        out.headerFooter = sanitizeHeaderFooter(src.headerFooter);
        break;
      case "watermark":
        out.watermark = sanitizeWatermark(src.watermark);
        break;
      case "aiCleanup":
        out.aiCleanup = sanitizeAiCleanup(src.aiCleanup);
        break;
      case "obsidian":
        out.obsidian = sanitizeObsidian(src.obsidian);
        break;
    }
  }
  return out;
}

/**
 * headerFooter 逐字段校验(仿 sanitizeTypography 整块兜底):
 * 枚举字段(headerMode/headerLayout)非法或缺失 → 默认;字符串字段钳制为 string
 * (非 string 丢弃);布尔钳制。始终返回合法完整对象。
 */
function sanitizeHeaderFooter(value: unknown): HeaderFooterSettings {
  const src =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const out: HeaderFooterSettings = { ...DEFAULT_HEADER_FOOTER };
  if (isOneOf(src.headerMode, HEADER_MODES)) out.headerMode = src.headerMode;
  if (typeof src.headerText === "string") out.headerText = src.headerText;
  if (typeof src.headerLogoPath === "string") out.headerLogoPath = src.headerLogoPath;
  if (isOneOf(src.headerLayout, HEADER_LAYOUTS)) out.headerLayout = src.headerLayout;
  if (typeof src.footerEnabled === "boolean") out.footerEnabled = src.footerEnabled;
  return out;
}

/**
 * watermark 逐字段校验(仿 sanitizeHeaderFooter):
 * text 钳制为 string(空串 = 关闭);angle 钳制到 [0,360];opacity 钳制到 [0,1];
 * gray 钳制为 boolean。始终返回合法完整对象。
 */
function sanitizeWatermark(value: unknown): WatermarkSettings {
  const src =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const out: WatermarkSettings = { ...DEFAULT_WATERMARK };
  if (typeof src.text === "string") out.text = src.text;
  if (isFiniteNumber(src.angle)) out.angle = Math.min(360, Math.max(0, src.angle));
  if (isFiniteNumber(src.opacity)) out.opacity = Math.min(1, Math.max(0, src.opacity));
  if (typeof src.gray === "boolean") out.gray = src.gray;
  return out;
}

/**
 * aiCleanup 分组块逐字段兜底(仿 sanitizeHeaderFooter/sanitizeWatermark:非对象/数组/null
 * → 打底值,逐字段 if 覆盖、从不 delete)。打底值是 DEFAULT_AI_CLEANUP 而非 current ——
 * 分组前这三个平铺键在 sanitizePatch 里各自回退默认,改用 current 会让「非法值回退」
 * 静默变成「保留旧值」,与 headerFooter/watermark 的块级先例也相反。
 * legacy 旧平铺键只在对应新字段**缺失或非法**时补位(分组前的文件迁移);
 * 新键与旧键同时存在时**一律以新键为准** —— 新键是本版本写出的权威形状,
 * 旧键只补缺,手改文件同时写两套时不会让旧值盖掉新值。
 */
function sanitizeAiCleanup(
  value: unknown,
  legacy: LegacyTransformFlags = NO_LEGACY_TRANSFORM_FLAGS,
): AiCleanupSettings {
  const src = isPlainObject(value) ? value : {};
  const out: AiCleanupSettings = { ...DEFAULT_AI_CLEANUP };
  if (typeof src.enabled === "boolean") out.enabled = src.enabled;
  else if (typeof legacy.enabled === "boolean") out.enabled = legacy.enabled;
  if (typeof src.tidy === "boolean") out.tidy = src.tidy;
  else if (typeof legacy.tidy === "boolean") out.tidy = legacy.tidy;
  if (typeof src.rewrite === "boolean") out.rewrite = src.rewrite;
  else if (typeof legacy.rewrite === "boolean") out.rewrite = legacy.rewrite;
  return out;
}

/** obsidian 分组块逐字段兜底(仿 sanitizeAiCleanup;旧键名 obsidianCompat/obsidianAttachmentFolder)。 */
function sanitizeObsidian(
  value: unknown,
  legacy: LegacyTransformFlags = NO_LEGACY_TRANSFORM_FLAGS,
): ObsidianSettings {
  const src = isPlainObject(value) ? value : {};
  const out: ObsidianSettings = { ...DEFAULT_OBSIDIAN };
  if (typeof src.compat === "boolean") out.compat = src.compat;
  else if (typeof legacy.compat === "boolean") out.compat = legacy.compat;
  if (typeof src.attachmentFolder === "string") out.attachmentFolder = src.attachmentFolder;
  else if (typeof legacy.attachmentFolder === "string") out.attachmentFolder = legacy.attachmentFolder;
  return out;
}

/* ---------- PDF 样式 CSS 导入(对话框/文件 IO 在 ipc/register.ts) ---------- */
/** PDF 自定义 CSS 导入大小上限(字节;超出拒绝导入,防误选大文件拖垮 settings.json)。 */
// 刻意非用户可配:环境/资源类硬边界,进设置面板即成「调坏即出事」的旋钮。
export const MAX_PDF_CSS_BYTES = 100 * 1024;
