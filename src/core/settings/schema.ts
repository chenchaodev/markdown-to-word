/**
 * 持久化 schema:每键一条,声明「缺失是否合法 · 非法时处置 · 取值域 · 默认值来源」,
 * 形状校验 / 加载兜底 / patch 更新三个消费点读同一张表(adr-028 决定要点一)。
 *
 * 放 core 的理由(adr-028 决定要点三):它描述 AppSettings 的形状与取值域,属该类型的
 * 定义层;renderer 将来复用同一份「键 → 类型 / 枚举 / 默认」即可消掉 settings-logic.ts
 * 那份手写平行副本。**本表不接线 renderer**(那是后续步的事)。
 *
 * 必须是三轴而不是一条「校验模式」单选字段(adr-028 决定要点一 + 备选方案第 1 条):
 * 单选字段会把现状三个处置档压成一档,而其中两档各有既存注释说明它是有意的 ——
 *   - repair-block   : pageSetup,非法只修正该块,不能让旧配置连带丢失其它用户设置
 *   - fallback-field : language,语言裁撤迁移场景下整文件拒绝会把用户全部偏好覆盖成默认
 *   - 「完全不做形状校验」= 缺失合法 + fallback-field 组合(typography / headerFooter /
 *     watermark / customPresets:它们连整文件形状校验都不出现,只有 sanitizer 兜底),
 *     故不需要第四个枚举值
 * 由此得一条可判定的推论:**处置档 = reject-whole-file ⇔ 该键参与整文件形状校验**。
 * 消费点据此推导参与集合,不得另设白名单(键组与校验分处两文件正是本步要消灭的形态)。
 *
 * 本模块只放**声明**(枚举值 + 档位 + 槽位名),判定与清洗实现在 main:outputDir 的绝对
 * 路径判定需要 node:path(core 不得 import node: 内建),块级清洗器与 preset-file 共用。
 * 依赖方向单向(core ← main),故表不反向依赖实现。
 */

/**
 * settings.json 的格式版本参数。
 *
 * 刻意**不**是表里的一条(adr-028 决定要点二):表若含 version,就等于「用版本号去选
 * 参与校验的键」,而表自己又被那个键组约束 —— 循环依赖。故它在本模块是常量,
 * isValidSettings 单独读它一次,表不感知版本。
 *
 * 刻意**不升位**:步 02 已把 5 个平铺键收成 2 个对象(形状变了而它仍是 1),加载器靠
 * **形状**判别(旧键读取 + aiCleanup 双形状放行),version 从未参与判别;升位只会多加
 * 一条什么都不决定的分支,反倒制造「version 说 1 却可能是两种形状」的新含糊。
 */
export const CURRENT_SETTINGS_VERSION = 1;

/** settings.json 的格式版本类型(取值单源于上方常量,AppSettings.version 由此派生)。 */
export type SettingsVersion = typeof CURRENT_SETTINGS_VERSION;

/** 非法值的处置档(三档,勿增勿改;理由见文件头与 adr-028)。 */
export type InvalidDisposition = "reject-whole-file" | "repair-block" | "fallback-field";

/**
 * 键的角色:落盘键 / 仅迁移期校验的旧形状键。
 *
 * 旧形状键(aiCleanupTidy 等)不落盘也不进 patch 白名单,只在形状校验与迁移取值路径出现。
 * 它们与落盘键走**同一条**校验代码路径,另找地方放就等于把同一个 switch 拆成两处
 * (adr-028 备选方案第 2 条),故并入同一张表、用角色字段区分。
 */
export type SettingsSchemaRole = "persisted" | "legacy-migration";

/**
 * 块内字段的类型。块内更细的判定(枚举白名单、数值钳制区间)留在既有清洗器与
 * `correctPageSetup` 里 —— 那些是策略单源,复制进本表只会造出第二份口径。
 */
export type BlockFieldType = "boolean" | "string" | "number";

/** 单键的取值域(形状校验的判定依据;块内字段类型随对象域声明)。 */
export type SettingDomain =
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "string" }
  /** 空串(源文件同目录)或绝对路径;判定需要 node:path,谓词实现在 main。 */
  | { readonly kind: "absolute-dir-or-empty" }
  /** i18n 语言注册表的成员;注册表单源在 core/i18n,故本表只声明「按注册表判定」。 */
  | { readonly kind: "language" }
  /** 自定义预设数组;逐条判定在 sanitizeCustomPresets,本层不判。 */
  | { readonly kind: "preset-list" }
  | {
      readonly kind: "object";
      readonly fields: Readonly<Record<string, BlockFieldType>>;
      /**
       * 允许旧形状的布尔总开关:分组前的 aiCleanup 是 boolean,与新对象同名。
       * 按类型区分而非按名字区分(读入能力保留一个版本,adr-024 决定要点四),
       * 所以同一个键名两种形状都能读。
       */
      readonly acceptLegacyBoolean?: boolean;
    };

/**
 * 兜底实现槽位:`none` 之外的值都对应 main 侧一个已有的清洗器/纠正策略。
 * 加新键不需要加槽位(缺失取默认即足);只有「块级或字段级兜底」才占一个槽位。
 */
export type SettingsFallback =
  | "none"
  | "typography"
  | "pageSetup"
  | "customPresets"
  | "language"
  | "headerFooter"
  | "watermark"
  | "aiCleanup"
  | "obsidian";

/** 实际占槽的兜底种类(消费点的兜底注册表按此键全覆盖)。 */
export type SettingsFallbackSlot = Exclude<SettingsFallback, "none">;

/** 一条 schema 条目 = 一键在三轴上的完整声明。 */
export interface SettingsSchemaEntry {
  /** 落盘键名(顶层键,分组块的块内字段见 domain.fields)。 */
  readonly key: string;
  readonly role: SettingsSchemaRole;
  /** 缺失是否合法:true = 缺失合法(旧文件兼容,由加载兜底补默认)。 */
  readonly optional: boolean;
  readonly invalid: InvalidDisposition;
  readonly domain: SettingDomain;
  readonly fallback: SettingsFallback;
  /**
   * 默认值来源。除旧形状键外一律取 `DEFAULT_SETTINGS` 的同名键 —— 值只有一个家在
   * settings-defaults,本表不复制;旧形状键没有默认值(`none`),它们只被读不被写。
   */
  readonly defaultSource: "default-settings" | "none";
}

/**
 * 逐键声明表。顺序按「页面设置在前、渲染前变换在后」,与 settings.json 的可读顺序一致。
 *
 * ⚠️ 每一档都是**现状复刻**,各有既存注释说明理由;改任一档都是行为变更
 * (整文件拒绝 ↔ 字段级兜底 互不可换),须先推翻 adr-028。
 */
export const SETTINGS_SCHEMA = [
  { key: "format", role: "persisted", optional: false, invalid: "reject-whole-file", domain: { kind: "enum", values: ["docx", "pdf"] }, fallback: "none", defaultSource: "default-settings" },
  {
    key: "pageSetup",
    role: "persisted",
    optional: true,
    // 整块修正而非整文件拒绝:非法 paper/orientation/几何只修正该块,不能让旧配置
    // 连带丢失其它用户设置(纠正策略单源 core correctPageSetup)。
    invalid: "repair-block",
    domain: {
      kind: "object",
      fields: {
        paper: "string",
        orientation: "string",
        marginTop: "number",
        marginBottom: "number",
        marginLeft: "number",
        marginRight: "number",
      },
    },
    fallback: "pageSetup",
    defaultSource: "default-settings",
  },
  {
    key: "typography",
    role: "persisted",
    optional: true,
    // 不参与整文件形状校验(旧文件缺字段走字段级兜底,不因部分字段缺失整体回退默认)。
    invalid: "fallback-field",
    domain: {
      kind: "object",
      fields: {
        fontAscii: "string",
        fontEastAsia: "string",
        bodySizePt: "number",
        lineSpacing: "number",
        firstLineIndent: "boolean",
        align: "string",
        headingNumbering: "boolean",
        captionNumbering: "boolean",
        headingScale: "string",
        headingSpacing: "string",
      },
    },
    fallback: "typography",
    defaultSource: "default-settings",
  },
  { key: "breakBeforeH1", role: "persisted", optional: false, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "default-settings" },
  { key: "toc", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "default-settings" },
  { key: "tocMode", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "enum", values: ["static", "field"] }, fallback: "none", defaultSource: "default-settings" },
  { key: "equationNumbering", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "default-settings" },
  { key: "afterConvert", role: "persisted", optional: false, invalid: "reject-whole-file", domain: { kind: "enum", values: ["none", "show-in-folder", "open"] }, fallback: "none", defaultSource: "default-settings" },
  { key: "outputDir", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "absolute-dir-or-empty" }, fallback: "none", defaultSource: "default-settings" },
  { key: "customPresets", role: "persisted", optional: true, invalid: "fallback-field", domain: { kind: "preset-list" }, fallback: "customPresets", defaultSource: "default-settings" },
  { key: "pdfCss", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "string" }, fallback: "none", defaultSource: "default-settings" },
  {
    key: "language",
    role: "persisted",
    optional: true,
    // 不参与整文件形状校验:语言裁撤迁移场景(已存 ko/fr/ru)若在此整文件拒绝,用户
    // 全部偏好将被默认值覆盖 —— 改由 loadSettings 字段级兜底默认语言。
    invalid: "fallback-field",
    // 取值域是 i18n 语言注册表(单源 core/i18n),故此处只声明「按注册表判定」;
    // 判定实现在 main 的兜底槽位里,本表不把注册表拉进来(renderer 也导入本表)。
    domain: { kind: "language" },
    fallback: "language",
    defaultSource: "default-settings",
  },
  { key: "theme", role: "persisted", optional: true, invalid: "reject-whole-file", domain: { kind: "enum", values: ["system", "light", "dark"] }, fallback: "none", defaultSource: "default-settings" },
  {
    key: "headerFooter",
    role: "persisted",
    optional: true,
    // 同 typography 先例:连 isValidSettings 都不出现,只有字段级 sanitizer 兜底。
    invalid: "fallback-field",
    domain: {
      kind: "object",
      fields: {
        headerMode: "string",
        headerText: "string",
        headerLogoPath: "string",
        headerLayout: "string",
        footerEnabled: "boolean",
      },
    },
    fallback: "headerFooter",
    defaultSource: "default-settings",
  },
  {
    key: "watermark",
    role: "persisted",
    optional: true,
    // 同 headerFooter 先例。
    invalid: "fallback-field",
    domain: {
      kind: "object",
      fields: { text: "string", angle: "number", opacity: "number", gray: "boolean" },
    },
    fallback: "watermark",
    defaultSource: "default-settings",
  },
  {
    key: "aiCleanup",
    role: "persisted",
    optional: true,
    // 分组后仍参与整文件形状校验(adr-024 决定要点一:不得因分组把「任一字段非法 →
    // 整文件回退」放宽成字段级兜底)。两种形状都放行,见 domain.acceptLegacyBoolean。
    invalid: "reject-whole-file",
    domain: {
      kind: "object",
      fields: { enabled: "boolean", tidy: "boolean", rewrite: "boolean" },
      acceptLegacyBoolean: true,
    },
    fallback: "aiCleanup",
    defaultSource: "default-settings",
  },
  {
    key: "obsidian",
    role: "persisted",
    optional: true,
    invalid: "reject-whole-file",
    domain: { kind: "object", fields: { compat: "boolean", attachmentFolder: "string" } },
    fallback: "obsidian",
    defaultSource: "default-settings",
  },
  // ---- 仅迁移期校验的旧平铺键(不落盘、不进 patch 白名单;读入能力保留一个版本) ----
  { key: "aiCleanupTidy", role: "legacy-migration", optional: true, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "none" },
  { key: "aiCleanupRewrite", role: "legacy-migration", optional: true, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "none" },
  { key: "obsidianCompat", role: "legacy-migration", optional: true, invalid: "reject-whole-file", domain: { kind: "boolean" }, fallback: "none", defaultSource: "none" },
  { key: "obsidianAttachmentFolder", role: "legacy-migration", optional: true, invalid: "reject-whole-file", domain: { kind: "string" }, fallback: "none", defaultSource: "none" },
] as const satisfies readonly SettingsSchemaEntry[];

/**
 * 参与整文件形状校验的条目 —— 处置档为 reject-whole-file 者(见文件头的推论)。
 * 校验顺序不影响判定结果(纯合取),但保持与表同序便于逐键定位。
 */
export const SHAPE_CHECKED_ENTRIES: readonly SettingsSchemaEntry[] = SETTINGS_SCHEMA.filter(
  (entry) => entry.invalid === "reject-whole-file",
);

/** 落盘键集合:形状校验表的持久化键 + version(version 不在表内,见 CURRENT_SETTINGS_VERSION)。 */
export const PERSISTED_KEYS: readonly string[] = [
  ...SETTINGS_SCHEMA.filter((entry) => entry.role === "persisted").map((entry) => entry.key),
  "version",
];

/**
 * 旧平铺键(仅迁移期)。它们不得留在内存对象或 settings.json 里 —— loadSettings 与
 * persistedSettings 都是整对象展开,不显式剔除就会每次写盘原样带回,文件永远收敛不到新形状。
 */
export const LEGACY_TRANSFORM_KEYS: readonly string[] = SETTINGS_SCHEMA.filter(
  (entry) => entry.role === "legacy-migration",
).map((entry) => entry.key);
