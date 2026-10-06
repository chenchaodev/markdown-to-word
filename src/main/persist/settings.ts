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
import { isLanguage } from "../../core/i18n/index.js";
// 持久化 schema:逐键的「缺失是否合法 / 非法时处置 / 取值域」声明单源(adr-028)。
// 本模块的形状校验、加载兜底、patch 更新三处都读它,不再各自手写键枚举;
// 判定与清洗实现在此(需要 node:path 与 preset-file 清洗器,core 侧不得有)。
import {
  CURRENT_SETTINGS_VERSION,
  LEGACY_TRANSFORM_KEYS,
  SETTINGS_SCHEMA,
  SHAPE_CHECKED_ENTRIES,
  type SettingDomain,
  type SettingsFallbackSlot,
  type SettingsSchemaEntry,
} from "../../core/settings/schema.js";
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
// headerFooter 的块内枚举白名单:块内更细的判定留在清洗器里(schema 表的 blockFields
// 只声明「是什么类型」,枚举/区间白名单是清洗器与 correctPageSetup 的职责,不复制到表里)。
const HEADER_MODES = ["default", "custom", "none"] as const;
const HEADER_LAYOUTS = ["center", "leftRight"] as const;

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
 * 键名不再手写:旧平铺键的名单在 schema 表的 role = "legacy-migration" 条目里,
 * 这里只把「键名 → 归并后的字段名」显式列出(两者不同名,故必须一一对应)。
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

/** 剔除旧平铺键(就地改传入的浅拷贝,不改调用方对象)。泛型保留调用方的形状:
 *  load 侧传的是尚未收窄成 AppSettings 的落盘对象,persist 侧传的是完整设置。 */
function stripLegacyTransformKeys<T extends object>(settings: T): T {
  const target = { ...settings } as Record<string, unknown>;
  for (const key of LEGACY_TRANSFORM_KEYS) delete target[key];
  return target as T;
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

/** 分组块的字段类型表与混合类型表的判定口径:块内字段缺省合法(旧 settings.json
 *  缺字段交由加载兜底补默认,与 toc/theme 可选字段同一口径),存在则须为声明类型。 */
function hasDeclaredTypes(
  source: Record<string, unknown>,
  fields: Readonly<Record<string, "boolean" | "string" | "number">>,
): boolean {
  for (const [key, fieldType] of Object.entries(fields)) {
    if (!(key in source)) continue;
    const value = source[key];
    if (fieldType === "number") {
      if (!isFiniteNumber(value)) return false;
    } else if (typeof value !== fieldType) return false;
  }
  return true;
}

/**
 * 单键取值域判定(schema 表的 domain 声明在此落地;core 侧只有声明,没有谓词 ——
 * outputDir 要 node:path,core 不得 import node: 内建)。
 */
function matchesDomain(domain: SettingDomain, value: unknown): boolean {
  switch (domain.kind) {
    case "enum":
      return isOneOf(value, domain.values);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "absolute-dir-or-empty":
      return isValidOutputDir(value);
    case "language":
      return isLanguage(value);
    case "preset-list":
      return Array.isArray(value);
    case "object": {
      if (domain.acceptLegacyBoolean && typeof value === "boolean") return true;
      return isPlainObject(value) && hasDeclaredTypes(value, domain.fields);
    }
  }
}

/**
 * 整文件形状校验:参与校验的键由 schema 表推导(处置档 = reject-whole-file 者,
 * 见 schema.ts 文件头的推论),任一非法即视为损坏、整体回退默认;
 * pageSetup / typography / headerFooter / watermark / customPresets / language
 * 六键不参与整文件拒绝(各自理由见 schema 表内注释),交由加载兜底。
 * 导出供直测:loadSettings 的「整文件回退 + pageSetup 迁移」语义由本函数判定,
 * 测试直接断言合法/非法输入,不依赖磁盘 IO。
 */
export function isValidSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  // 格式版本读 schema 声明值:version 不在表内(表不得被版本号选取),故单独判一次。
  if (s.version !== CURRENT_SETTINGS_VERSION) return false;
  for (const entry of SHAPE_CHECKED_ENTRIES) {
    const present = entry.key in s;
    if (!present) {
      // 必填键缺失即损坏;缺失合法的键(旧文件兼容)交由加载兜底补默认。
      if (!entry.optional) return false;
      continue;
    }
    if (!matchesDomain(entry.domain, s[entry.key])) return false;
  }
  return true;
}

/** 该键的默认值(除旧形状键外一律取 DEFAULT_SETTINGS 同名键 —— 值只有一个家)。 */
function defaultFor(entry: SettingsSchemaEntry): unknown {
  // 经 unknown 中转:AppSettings 无索引签名,而条目键含旧形状键(不在 AppSettings 上)。
  return (DEFAULT_SETTINGS as unknown as Partial<Record<string, unknown>>)[entry.key];
}

/**
 * 「无兜底槽位」键(fallback = none)的统一取值规则:合法即采用、否则取默认。
 * 加载与 patch 两条路共用这一句 —— 加载时形状校验已保证「存在即合法」,
 * 故它退化为「存在即原样、缺失取默认」;patch 时它就是「非法回退默认」。
 * 逐键再写一遍这三种形态正是本表要消灭的编辑点。
 */
function takeOrDefault(entry: SettingsSchemaEntry, value: unknown): unknown {
  return matchesDomain(entry.domain, value) ? value : defaultFor(entry);
}

/** 加载兜底的上下文(旧平铺键取值 + pageSetup 纠正的副作用出口)。 */
interface LoadFallbackContext {
  legacy: LegacyTransformFlags;
  onPageSetupCorrected: (result: PageSetupCorrectionResult) => void;
}

/**
 * 加载兜底实现注册表:键 = schema 表的槽位名,值 = 既有清洗器/纠正策略。
 * 槽位全覆盖由 Record<SettingsFallbackSlot, …> 在编译期保证(加槽位不实现即编译红)。
 * patch 路径用同一组清洗器但**不读旧平铺键**(补位只发生在加载迁移,见 PATCH_FALLBACKS 注释)。
 */
const LOAD_FALLBACKS: Record<
  SettingsFallbackSlot,
  (value: unknown, ctx: LoadFallbackContext) => unknown
> = {
  // pageSetup 由 core 唯一纯策略纠正(整块修正档,理由见 schema 表内注释)
  pageSetup: (value, ctx) => {
    const result = correctPageSetup(value);
    ctx.onPageSetupCorrected(result);
    return result.pageSetup;
  },
  typography: (value) => sanitizeTypography(value),
  customPresets: (value) => sanitizeCustomPresets(value),
  // i18n:language 缺失(旧文件)→ 默认;存在但已不在注册表(语言裁撤,如 ko/fr/ru)→
  // 字段级兜底默认语言,其余偏好原样保留(不整文件拒绝)
  language: (value) => (isLanguage(value) ? value : DEFAULT_SETTINGS.language),
  headerFooter: (value) => sanitizeHeaderFooter(value),
  watermark: (value) => sanitizeWatermark(value),
  // 旧 settings.json 缺整块/缺字段 → 逐字段兜底默认;旧平铺键在对应新字段缺位时补位
  aiCleanup: (value, ctx) => sanitizeAiCleanup(value, ctx.legacy),
  obsidian: (value, ctx) => sanitizeObsidian(value, ctx.legacy),
};

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
      const record = parsed as unknown as Record<string, unknown>;
      // 旧形状取值(分组前的平铺键):只用于补位,不进最终对象
      const legacy = readLegacyTransformFlags(record);
      // 逐键取最终值:键集合、缺失合法性与兜底档位全部由 schema 表给,此处不再逐键列举。
      // pageSetup 的纠正带副作用(日志 + 迁移提示),故经回调收集,提示在循环后统一组装。
      let pageSetupCorrection: PageSetupCorrectionResult | undefined;
      const fields: Record<string, unknown> = stripLegacyTransformKeys(record);
      for (const entry of SETTINGS_SCHEMA) {
        if (entry.role !== "persisted") continue;
        const value = record[entry.key];
        fields[entry.key] =
          entry.fallback === "none"
            ? takeOrDefault(entry, value)
            : LOAD_FALLBACKS[entry.fallback](value, {
                legacy,
                onPageSetupCorrected: (result) => {
                  warnPageSetupCorrection(result, "load");
                  pageSetupCorrection = result;
                },
              });
      }
      const corrected = pageSetupCorrection;
      const migration: SettingsMigrationNotice | undefined = corrected?.corrected
        ? {
            kind: "page-setup-correction",
            id: JSON.stringify({
              original: record.pageSetup,
              corrected: corrected.pageSetup,
              reasons: corrected.reasons,
            }),
            original: record.pageSetup,
            corrected: corrected.pageSetup,
            reasons: corrected.reasons,
            message: corrected.message ?? "页面设置已自动修正。",
            persistence: "scheduled",
          }
        : undefined;
      if (migration) fields.migration = migration;
      loaded = fields as unknown as AppSettings;
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

/**
 * patch 路径的兜底实现:与加载同组清洗器,但**不读旧平铺键** —— 旧键补位只发生在
 * 加载迁移(读入能力保留一个版本),patch 收到的是本版本形状。
 * pageSetup 额外以 current 为合并基准(缺边距不重置),与加载的 DEFAULT 基准不同;
 * 纠正留痕由调用方注入(见 sanitizePatch 内的 warnPageSetupCorrection 调用)。
 */
const PATCH_FALLBACKS: Record<
  SettingsFallbackSlot,
  (value: unknown, current: AppSettings, onCorrection: (result: PageSetupCorrectionResult) => void) => unknown
> = {
  pageSetup: (value, current, onCorrection) =>
    sanitizePageSetup(value, current.pageSetup, onCorrection),
  typography: (value) => sanitizeTypography(value),
  customPresets: (value) => sanitizeCustomPresets(value),
  language: (value) => (isLanguage(value) ? value : DEFAULT_SETTINGS.language),
  headerFooter: (value) => sanitizeHeaderFooter(value),
  watermark: (value) => sanitizeWatermark(value),
  aiCleanup: (value) => sanitizeAiCleanup(value),
  obsidian: (value) => sanitizeObsidian(value),
};

/** 合并 + 持久化 + 返回;patch 键集合与逐键处置读 schema 表,非法值回退默认。 */
function sanitizePatch(patch: unknown, current: AppSettings): Partial<AppSettings> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return {};
  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // version 单独一行:它不在 schema 表内(表不得被格式版本选取,见 schema.ts),
  // 故按声明的格式版本判定而非按逐键规则。
  if ("version" in src) {
    out.version = src.version === CURRENT_SETTINGS_VERSION ? CURRENT_SETTINGS_VERSION : DEFAULT_SETTINGS.version;
  }
  for (const entry of SETTINGS_SCHEMA) {
    if (entry.role !== "persisted") continue;
    if (!(entry.key in src)) continue;
    // pageSetup 的非对象 patch 视为未提供(返回 undefined),故跳过 undefined 而非写入。
    const value = entry.fallback === "none"
      ? takeOrDefault(entry, src[entry.key])
      : PATCH_FALLBACKS[entry.fallback](src[entry.key], current, (result: PageSetupCorrectionResult) =>
          warnPageSetupCorrection(result, "update"));
    if (value !== undefined) out[entry.key] = value;
  }
  return out as Partial<AppSettings>;
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
