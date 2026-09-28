/**
 * 设置控件声明表(纯数据 + 纯函数,**零 DOM**):一条声明同时给出
 * 「设置键 → 控件定位 → 所属组 → 读设置 → 写设置 → 转控件值 → 复位处置」,
 * hydrate / bind / reset 三件事都由本表驱动 —— 新增一个控件的 renderer 侧改动
 * 因此收敛为「1 个表条目 + 1 个 HTML 控件」。
 *
 * 为什么零 DOM:本表的下游有一层纯逻辑(回显值映射 settingsToControlValues)在
 * 无 Electron 环境直测,声明表若 import dom/refs 就把 DOM 拉进那条链,纯层即死。
 * 元素由装配处(settings-panel)按「定位」经 ControlDom 注入 —— 本表只说
 * 「要哪个 id / 哪个 radio 组名」,不说去哪里拿。change 订阅走同一个接缝。
 *
 * 键路径不经手写字符串:每条只声明「顶层块 + 块内字段名」,读写两半由
 * readPath / writePath 从同一条路径生成(键名拼错或类型不符在 tsc 期即报错;
 * "typography.align" 这类串编译器看不见,且读侧与写侧也不可能各自漂移)。
 *
 * 形态分四类,各有各的表达,不合成一套通用描述:值控件(开关 / 文本 / 数值 /
 * 枚举档)· path-chip(可写控件与展示位分离,可带双写镜像)· 派生键(不落
 * AppSettings)· 无控件键(没有控件但复位口径仍须登记)。合成后每条都要带一堆
 * 用不上的可选字段,编译器也就再也指不出「这条少声明了复位处置」。
 *
 * 依赖(3 个手写门控 + 设置值驱动的显隐 / 双写 / 文案合成)刻意**只登记事实、
 * 不做声明式**:见 CONTROL_GATES 与 VALUE_DRIVEN_EFFECTS 的说明。门控的判定与
 * 实现仍是手写同步函数,本表只登记「谁驱动谁」—— change 侧据此反查调用,
 * 回填侧据此逐个调用,两条路径共用同一份登记。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";

/** 抽屉六组(= index.html 的 data-group;mirror = 抽屉外的镜像与顶栏控件,无 data-group)。 */
export type ControlGroup =
  | "preset"
  | "typography"
  | "headerwatermark"
  | "numbering"
  | "convert"
  | "app"
  | "mirror";

/**
 * 抽屉「恢复默认」的处置。刻意保留集是复位的真源,故必须**显式声明**:
 * - reset    :复位到 DEFAULT_SETTINGS 的同路径
 * - preserve :抽屉「恢复默认」刻意不重置(应用偏好与用户预设)
 * - derived  :无独立设置字段(派生键 / 展示位),随其来源字段复位而重算
 */
export type ResetPolicy = "reset" | "preserve" | "derived";

/**
 * 值控件形态。radio 与 select 都落"枚举档",但读写机制不同:
 * radio 是 document 级同名成组(快速参数条的镜像分段自动并入,一处回填覆盖两处),
 * select 是单元素。
 */
export type ValueForm = "switch" | "text" | "number" | "radio" | "select";

/** 顶层块键(整块写回与复位的定位)。字面量受 keyof AppSettings 约束:块名拼错在 tsc 期报错。 */
export type BlockKey = keyof AppSettings & string;

/** 控件定位:单元素控件按 id,seg 分段按 document 级 radio 组名。 */
export type ControlLocator =
  | { readonly by: "id"; readonly id: string }
  | { readonly by: "radio"; readonly name: string };

/**
 * 顶层块的块内字段名(标量块没有字段,故为 never —— 在标量块上写 path 即 tsc 报错)。
 */
type BlockField<K extends BlockKey> = AppSettings[K] extends infer B
  ? B extends object
    ? keyof B & string
    : never
  : never;

/** 键路径的值类型:path 缺省即「块自身」(标量顶层键),否则为块内字段的值。 */
type PathValue<K extends BlockKey, P> = [P] extends [never]
  ? AppSettings[K]
  : P extends keyof NonNullable<AppSettings[K]> & string
    ? NonNullable<AppSettings[K]>[P]
    : never;

/**
 * 键路径的读侧(全表唯一的属性读点)。
 * cast 只把「泛型索引访问」落成一次属性读:块名与字段名在调用处已受
 * BlockKey / BlockField 收窄,值的类型由 PathValue 从这两者算出,故这里不丢检查。
 */
function readPath<K extends BlockKey, P extends BlockField<K>>(
  settings: AppSettings,
  block: K,
  path: P | undefined,
): PathValue<K, P> {
  if (path === undefined) return settings[block] as PathValue<K, P>;
  const target = settings[block] as unknown as Record<string, unknown>;
  return target[path] as PathValue<K, P>;
}

/** 键路径的写侧(全表唯一的属性写点,与 readPath 同一条路径)。 */
function writePath<K extends BlockKey, P extends BlockField<K>>(
  settings: AppSettings,
  block: K,
  path: P | undefined,
  value: PathValue<K, P>,
): void {
  if (path === undefined) {
    (settings as unknown as Record<string, unknown>)[block] = value;
    return;
  }
  const target = settings[block] as unknown as Record<string, unknown>;
  target[path] = value;
}

/** 值控件:读设置 / 写设置 / 转控件值 / 回填控件。 */
export interface ValueEntry<F extends ValueForm, V, C> {
  readonly kind: "value";
  readonly form: F;
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly block: BlockKey;
  readonly locator: ControlLocator;
  /** 设置取值:参数类型即 AppSettings,键路径的类型错误在这一步暴露。 */
  readonly read: (settings: AppSettings) => V;
  /** 写回设置:与 read 同一条键路径(两者由同一处声明生成,不可能指向不同字段)。 */
  readonly write: (settings: AppSettings, value: V) => void;
  /** 控件回填值(数值转字符串等控件语义就地声明,不另立一份映射表)。 */
  readonly controlValue: (settings: AppSettings) => C;
  /**
   * 同一控件值的副显位(随回填同写;如行距滑杆的 mono 实时回显)。
   * 只写 textContent:这类副显位是只读展示节点(<output>),写它的 value
   * 属性不会改显示内容(HTMLOutputElement.value 走的是 value 内容属性)。
   */
  readonly echo?: readonly string[];
}

/**
 * path-chip:可写控件(动作按钮)与展示位分离。
 * 展示文本不是设置值本身(路径 → 文件名 / 空值 → 占位文案),故不进回显值映射,
 * 由「设置值驱动的那组同步函数」算(登记见 VALUE_DRIVEN_EFFECTS)。
 */
export interface ChipEntry {
  readonly kind: "chip";
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly block: BlockKey;
  /** 抽屉内展示位。 */
  readonly display: string;
  /** 双写镜像(快速参数条等抽屉外同值展示位)。 */
  readonly mirrors: readonly string[];
  /** 写入 / 清除入口:path-chip 的「可写控件」是动作按钮,不是文本输入。 */
  readonly write: readonly string[];
  /** 设置取值(供动态展示与显隐判据读)。 */
  readonly read: (settings: AppSettings) => string;
}

/**
 * 派生键:控件值由别的设置反解(预设 id 是「当前设置匹配哪个预设」的结论,
 * 不是 AppSettings 的字段),故无 block;复位时随其来源字段一起重算。
 */
export interface DerivedEntry {
  readonly kind: "derived";
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly locator: { readonly by: "id"; readonly id: string };
}

/** 三类条目的并集(按 kind 判别)。 */
export type ControlEntry = ValueEntry<ValueForm, unknown, unknown> | ChipEntry | DerivedEntry;

/** 值控件条目(工厂):保住 read / write / toControl 的具体类型 ——
 *  整表用 satisfies 注解会把类型擦成 unknown,派生映射就无从谈起。 */
function valueEntry<F extends ValueForm, K extends BlockKey, P extends BlockField<K> = never, C = PathValue<K, P>>(
  spec: {
    readonly form: F;
    readonly group: ControlGroup;
    readonly reset: ResetPolicy;
    readonly block: K;
    /** 块内字段名;缺省表示该块是标量顶层键(键即块名)。 */
    readonly path?: P;
    readonly locator: ControlLocator;
    /** 控件回填值转换(数值转字符串等控件语义);缺省即恒等。 */
    readonly toControl?: (value: PathValue<K, P>) => C;
    readonly echo?: readonly string[];
  },
): ValueEntry<F, PathValue<K, P>, C> {
  const toControl =
    spec.toControl ?? ((value: PathValue<K, P>) => value as unknown as C);
  const read = (settings: AppSettings): PathValue<K, P> =>
    readPath(settings, spec.block, spec.path);
  return {
    kind: "value",
    form: spec.form,
    group: spec.group,
    reset: spec.reset,
    block: spec.block,
    locator: spec.locator,
    echo: spec.echo,
    read,
    write: (settings, value) => {
      writePath(settings, spec.block, spec.path, value);
    },
    controlValue: (settings) => toControl(read(settings)),
  };
}

function chipEntry(spec: {
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly block: BlockKey;
  readonly display: string;
  readonly mirrors: readonly string[];
  readonly write: readonly string[];
  readonly read: (settings: AppSettings) => string;
}): ChipEntry {
  return { kind: "chip", ...spec };
}

function derivedEntry(spec: {
  readonly group: ControlGroup;
  readonly locator: { readonly by: "id"; readonly id: string };
}): DerivedEntry {
  return { kind: "derived", reset: "derived", ...spec };
}

/* ---------- 声明表本体(声明序 = 抽屉组序 × 组内视觉序,与 settings-ia §2 一致) ---------- */

export const CONTROL_ENTRIES = {
  // 01 预设
  templatePreset: derivedEntry({ group: "preset", locator: { by: "id", id: "templatePreset" } }),
  // 02 排版
  paper: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "pageSetup", path: "paper",
    locator: { by: "radio", name: "paper" },
  }),
  orientation: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "pageSetup", path: "orientation",
    locator: { by: "radio", name: "orientation" },
  }),
  marginTop: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup", path: "marginTop",
    toControl: String, locator: { by: "id", id: "marginTop" },
  }),
  marginBottom: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup", path: "marginBottom",
    toControl: String, locator: { by: "id", id: "marginBottom" },
  }),
  marginLeft: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup", path: "marginLeft",
    toControl: String, locator: { by: "id", id: "marginLeft" },
  }),
  marginRight: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup", path: "marginRight",
    toControl: String, locator: { by: "id", id: "marginRight" },
  }),
  fontEastAsia: valueEntry({
    form: "text", group: "typography", reset: "reset", block: "typography", path: "fontEastAsia",
    locator: { by: "id", id: "fontEastAsia" },
  }),
  fontAscii: valueEntry({
    form: "text", group: "typography", reset: "reset", block: "typography", path: "fontAscii",
    locator: { by: "id", id: "fontAscii" },
  }),
  bodySizePt: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "typography", path: "bodySizePt",
    toControl: String, locator: { by: "id", id: "bodySizePt" },
  }),
  lineSpacing: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "typography", path: "lineSpacing",
    toControl: String, locator: { by: "id", id: "lineSpacing" },
    echo: ["lineSpacingValue"],
  }),
  headingScale: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography", path: "headingScale",
    locator: { by: "radio", name: "headingScale" },
  }),
  headingSpacing: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography", path: "headingSpacing",
    locator: { by: "radio", name: "headingSpacing" },
  }),
  firstLineIndent: valueEntry({
    form: "switch", group: "typography", reset: "reset", block: "typography", path: "firstLineIndent",
    locator: { by: "id", id: "firstLineIndent" },
  }),
  align: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography", path: "align",
    locator: { by: "radio", name: "align" },
  }),
  // 03 页眉页脚与水印
  headerMode: valueEntry({
    form: "radio", group: "headerwatermark", reset: "reset", block: "headerFooter", path: "headerMode",
    locator: { by: "radio", name: "headerMode" },
  }),
  headerText: valueEntry({
    form: "text", group: "headerwatermark", reset: "reset", block: "headerFooter", path: "headerText",
    locator: { by: "id", id: "headerText" },
  }),
  headerLogoPath: chipEntry({
    group: "headerwatermark", reset: "reset", block: "headerFooter",
    display: "headerLogoStatus", mirrors: [], write: ["headerLogoPick", "headerLogoClear"],
    read: (s) => s.headerFooter.headerLogoPath,
  }),
  headerLayout: valueEntry({
    form: "radio", group: "headerwatermark", reset: "reset", block: "headerFooter", path: "headerLayout",
    locator: { by: "radio", name: "headerLayout" },
  }),
  footerEnabled: valueEntry({
    form: "switch", group: "headerwatermark", reset: "reset", block: "headerFooter", path: "footerEnabled",
    locator: { by: "id", id: "footerEnabled" },
  }),
  watermarkText: valueEntry({
    form: "text", group: "headerwatermark", reset: "reset", block: "watermark", path: "text",
    locator: { by: "id", id: "watermarkText" },
  }),
  watermarkAngle: valueEntry({
    form: "number", group: "headerwatermark", reset: "reset", block: "watermark", path: "angle",
    toControl: String, locator: { by: "id", id: "watermarkAngle" },
  }),
  watermarkOpacity: valueEntry({
    form: "number", group: "headerwatermark", reset: "reset", block: "watermark", path: "opacity",
    toControl: String, locator: { by: "id", id: "watermarkOpacity" },
  }),
  watermarkGray: valueEntry({
    form: "switch", group: "headerwatermark", reset: "reset", block: "watermark", path: "gray",
    locator: { by: "id", id: "watermarkGray" },
  }),
  // 04 编号与目录
  headingNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "typography", path: "headingNumbering",
    locator: { by: "id", id: "headingNumbering" },
  }),
  captionNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "typography", path: "captionNumbering",
    locator: { by: "id", id: "captionNumbering" },
  }),
  equationNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "equationNumbering",
    locator: { by: "id", id: "equationNumbering" },
  }),
  toc: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "toc",
    locator: { by: "id", id: "toc" },
  }),
  tocMode: valueEntry({
    form: "select", group: "numbering", reset: "reset", block: "tocMode",
    locator: { by: "id", id: "tocMode" },
  }),
  breakBeforeH1: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "breakBeforeH1",
    locator: { by: "id", id: "breakBeforeH1" },
  }),
  // 05 转换
  aiCleanup: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup", path: "enabled",
    locator: { by: "id", id: "aiCleanup" },
  }),
  aiCleanupTidy: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup", path: "tidy",
    locator: { by: "id", id: "aiCleanupTidy" },
  }),
  aiCleanupRewrite: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup", path: "rewrite",
    locator: { by: "id", id: "aiCleanupRewrite" },
  }),
  obsidianCompat: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "obsidian", path: "compat",
    locator: { by: "id", id: "obsidianCompat" },
  }),
  obsidianAttachmentFolder: valueEntry({
    form: "text", group: "convert", reset: "reset", block: "obsidian", path: "attachmentFolder",
    locator: { by: "id", id: "obsidianAttachmentFolder" },
  }),
  outputDir: chipEntry({
    group: "convert", reset: "reset", block: "outputDir",
    display: "outputDirValue", mirrors: ["quickOutputDir"],
    write: ["outputDirPick", "quickOutputPick", "outputDirReset"],
    read: (s) => s.outputDir,
  }),
  afterConvert: valueEntry({
    form: "radio", group: "convert", reset: "reset", block: "afterConvert",
    locator: { by: "radio", name: "afterConvert" },
  }),
  pdfCss: valueEntry({
    form: "text", group: "convert", reset: "reset", block: "pdfCss",
    locator: { by: "id", id: "pdfCssText" },
  }),
  // 06 应用(theme / language 属刻意保留集,见 reset 字段)
  theme: valueEntry({
    form: "radio", group: "app", reset: "preserve", block: "theme",
    locator: { by: "radio", name: "theme" },
  }),
  languageSelect: valueEntry({
    form: "select", group: "app", reset: "preserve", block: "language",
    locator: { by: "id", id: "languageSelect" },
  }),
  // 抽屉外:快速参数条的两处镜像 + 顶栏格式分段
  quickPreset: derivedEntry({ group: "mirror", locator: { by: "id", id: "quickPreset" } }),
  format: valueEntry({
    form: "radio", group: "mirror", reset: "preserve", block: "format",
    locator: { by: "radio", name: "format" },
  }),
} as const;

/** 控件键(声明表的键 = 控件自身的键,故与几何规格的控件键同形)。 */
export type ControlKey = keyof typeof CONTROL_ENTRIES;

/**
 * 无控件的顶层键:不参与任何控件读写,但**复位口径仍须显式登记**
 * (version = settings.json 的格式版本,不是用户可复位项;
 *  customPresets = 用户预设,抽屉「恢复默认」刻意保留)。
 * 登记在此而非靠"表里没有它就是保留",是为了让复位白名单有一处可读的真源。
 */
export const KEYS_WITHOUT_CONTROL = ["customPresets", "version"] as const satisfies
  readonly (keyof AppSettings & string)[];

/** 无控件键的并集类型。 */
export type KeyWithoutControl = (typeof KEYS_WITHOUT_CONTROL)[number];

/**
 * 声明表登记过的顶层块(块名受 BlockKey 约束,拼错在 tsc 期报错)。
 *
 * 「复位块集合是否齐全」这项判据落在**运行期断言**而不是类型层:从条目并集里
 * 反推键名字面量会退化成 string,判不出「少登记一个块」——实测 tsc 只在给
 * 一个非法字面量时报错,给一个未登记的合法字面量不报(见 git 历史里本行的取舍)。
 * 故这一层交给设置控件段:拿 DEFAULT_SETTINGS 的顶层键集与本函数 + KEYS_WITHOUT_CONTROL
 * 比对。保留集是复位的真源,不能靠「表里没有它就算保留」。
 */
export function declaredBlockKeys(): readonly BlockKey[] {
  const blocks = new Set<BlockKey>();
  for (const entry of Object.values(CONTROL_ENTRIES)) {
    if (entry.kind !== "derived") blocks.add(entry.block);
  }
  return [...blocks];
}

/**
 * 抽屉「恢复默认」的复位集:由条目的 reset 字段**算**出来,而不是另抄一份名单。
 * 「表里没有它」因此不再等于「它被保留」——保留与否是每条显式声明的。
 */
export function resetBlockKeys(): readonly BlockKey[] {
  const blocks = new Set<BlockKey>();
  for (const entry of Object.values(CONTROL_ENTRIES)) {
    if (entry.kind !== "derived" && entry.reset === "reset") blocks.add(entry.block);
  }
  return [...blocks];
}

/* ---------- 回显值映射(从 AppSettings 派生,不再是手写平行副本) ---------- */

type ValueEntries = {
  [K in ControlKey as (typeof CONTROL_ENTRIES)[K] extends { readonly kind: "value" }
    ? K
    : never]: (typeof CONTROL_ENTRIES)[K];
};

type ControlValueOf<E> = E extends { readonly controlValue: (settings: AppSettings) => infer C }
  ? C
  : never;

/**
 * 设置 → 控件回填值映射的类型:键 = 值控件的键,值的类型逐条由该条的
 * `controlValue` 推断。AppSettings 加字段 / 改类型时,漏改的条目在这里现形 ——
 * 原先是靠一份 36 键的手抄副本对齐,编译器全程看不见。
 */
export type SettingsControlValues = {
  readonly [K in keyof ValueEntries]: ControlValueOf<ValueEntries[K]>;
};

/** 设置对象 → 控件回填值(表驱动;chip 的展示文本与派生键不是设置值本身,故不入此映射)。 */
export function settingsToControlValues(settings: AppSettings): SettingsControlValues {
  const values: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(CONTROL_ENTRIES)) {
    if (entry.kind === "value") values[key] = entry.controlValue(settings);
  }
  // 断言只把动态键的累积收回上面那张派生类型:键集与类型同源(都出自本表),
  // 故这里不可能掩盖一个键或一个值的形状错误。
  return values as SettingsControlValues;
}

/* ---------- 回填与 change 订阅(表驱动;DOM 与落值通道均由装配处注入) ---------- */

/** seg 分段组:document 级同名 radio 成组,故按组名而非单个元素定位。 */
export interface RadioGroup {
  forEach(visit: (input: { readonly value: string; checked: boolean }) => void): void;
}

/**
 * 控件的结构化读侧:本表与写侧钩子只见这一面,不见 DOM 类型
 * (「唯一知道 DOM 类型的地方」是装配处,见 settings-panel.controlHandle)。
 */
export interface ControlHandle {
  /** 字符串位(input / select / textarea / radio 的 value)。 */
  readonly value: string;
  /** 勾选位(只有 checkbox 形态的 input 有)。 */
  readonly checked: boolean;
  /** 数值视图(与浏览器一致:空串与非数值给 NaN 而非 0,钳制分支靠它区分「空输入」)。 */
  readonly valueAsNumber: number;
  /** 回写字符串位(钳制后回显)。 */
  setValue(value: string): void;
}

/** 控件的 DOM 供给(依赖注入):本表只说"要哪个 id / 哪个组名",不说去哪里拿。 */
export interface ControlDom {
  element(id: string): HTMLElement;
  radioGroup(name: string): RadioGroup;
  /** 订阅单元素控件的 change(装配处把元素包成 ControlHandle 递进来)。 */
  onChange(id: string, handler: (control: ControlHandle) => void): void;
  /** 订阅同名 seg 分段组(组内每个成员各挂一个;非选中者由本表前置过滤)。 */
  onRadioChange(name: string, handler: (control: ControlHandle) => void): void;
}

/** 字符串位的写入面:input / select / textarea / output 都有 value。 */
type WritableElement = HTMLElement & { value: string };

/** 勾选位的写入面:只有 checkbox 形态的 input 有 checked。 */
type CheckableElement = HTMLElement & { checked: boolean };

/**
 * 值控件回填:开关写勾选位,其余写字符串位,seg 分段组按值勾选 ——
 * 分段组的这处 forEach 是**全表唯一**(原先 10 处分段回填逐字同款)。
 * chip 展示位、派生键、门控与动态文案不在此:它们不是"控件值 = 设置值",各有落点。
 */
export function hydrateControls(settings: AppSettings, dom: ControlDom): void {
  for (const raw of Object.values(CONTROL_ENTRIES)) {
    if (raw.kind !== "value") continue;
    // 取成宽形态:整表遍历时 TS 只知道这是「某个」值控件,值类型是所有条目的并集,
    // 落到勾选位 / 字符串位需要按 form 收窄(收窄的正当性由每条的 form 声明保证:
    // switch 只可能是 boolean,其余是字符串语义)。
    const entry = raw as ValueEntry<ValueForm, unknown, unknown>;
    const value = entry.controlValue(settings);
    if (entry.locator.by === "radio") {
      dom.radioGroup(entry.locator.name).forEach((input) => {
        input.checked = input.value === value;
      });
      continue;
    }
    const id = entry.locator.id;
    if (entry.form === "switch") {
      (dom.element(id) as CheckableElement).checked = value === true;
      continue;
    }
    (dom.element(id) as WritableElement).value = String(value);
    for (const echoId of entry.echo ?? []) dom.element(echoId).textContent = String(value);
  }
}

/* ---------- change 接线(表驱动) ---------- */

/**
 * 写侧钩子:通用落值之外**必须自己做**的那一步。三类都走这一套挂法,不再各自发明接法:
 *  - 钳制 / 校验 / 错误回显(边距、字体、字号、行距、水印角度与不透明度)——
 *    合法区间与提示文案是该控件自己的口径,不是样板;
 *  - 运行时副作用(外观主题、界面语言、顶栏格式的镜像态);
 *  - 动作落点同步(PDF CSS 的状态行与清除按钮)。
 * 三段的分工固定:ctx 给落值通道与门控、control 给读侧、write 落值
 * (写设置 + 整块持久化 + 重算本控件驱动的门控)。回填期判定由驱动统一做,
 * 故钩子体直接从「读控件」开始。
 */
export type WriteHook = (
  ctx: WriteContext,
  control: ControlHandle,
  write: (value: unknown) => void,
) => void;

/**
 * 声明了写侧钩子的控件键(通用落值之外还有别的事要做的那几条)。
 * 键集受 ControlKey 约束:表里没有的键写在这里即 tsc 报错;反过来,
 * 编排根的钩子表类型是本清单的全量 Record,少一个实现即编译期红。
 */
export const HOOKED_WRITE_KEYS = [
  // 钳制 / 校验 / 错误回显
  "marginTop", "marginBottom", "marginLeft", "marginRight",
  "fontEastAsia", "fontAscii", "bodySizePt", "lineSpacing",
  "watermarkAngle", "watermarkOpacity",
  // 运行时副作用与动作落点同步
  "format", "theme", "languageSelect", "pdfCss",
] as const satisfies readonly ControlKey[];

/** 有写侧钩子的控件键。 */
export type HookedWriteKey = (typeof HOOKED_WRITE_KEYS)[number];

/** 某条目所属的组(按清单反推某键归哪一组,故组归属只有一处声明)。 */
type GroupOf<K extends ControlKey> = (typeof CONTROL_ENTRIES)[K]["group"];

/** 某组自己的那几条写侧钩子(多写/漏写都在 tsc 期报错)。 */
export type WriteHooksOf<G extends ControlGroup> = {
  readonly [K in HookedWriteKey as GroupOf<K> extends G ? K : never]: WriteHook;
};

/** 全量钩子表(编排根据此判「表里声明的钩子都有实现」)。 */
export type WriteHookRegistry = WriteHooksOf<ControlGroup>;

const HOOKED_WRITE_KEY_SET: ReadonlySet<string> = new Set<string>(HOOKED_WRITE_KEYS);

/**
 * 落值通道(依赖注入):本表不 import state / persist —— 装配处注入,
 * 依赖方向保持单向(settings-* → 本表,反之不成立)。
 */
export interface WriteContext {
  /**
   * 内存设置的**当前**对象:落权威值时 state.settings 会被整体换成新对象,
   * 故按函数读而不持引用(持引用会让写回落到已被丢弃的旧对象上)。
   */
  readonly settings: () => AppSettings;
  /** 回填期标志:回填与整体套用期间控件只赋值不落值。 */
  readonly hydrating: () => boolean;
  /** 持久化通道(装配处的唯一写路径)。 */
  readonly persist: (patch: Partial<AppSettings>) => void;
  /** 手写门控同步(依赖例外:表登记「谁驱动谁」,判定与实现仍在装配处)。 */
  readonly syncGate: (id: GateId) => void;
  /** 顶栏格式的镜像态(转换时读它;settings 之外唯一需要写侧通知的旁支)。 */
  readonly setSelectedFormat: (format: AppSettings["format"]) => void;
}

/** 整块写回 payload:块是对象则带上整块当前值(不做「只写被改的那个子字段」的局部 patch)。 */
function blockPatch(settings: AppSettings, block: BlockKey): Partial<AppSettings> {
  const value: unknown = settings[block];
  return {
    [block]: typeof value === "object" && value !== null ? { ...(value as object) } : value,
  } as Partial<AppSettings>;
}

/** 一次落值:写设置 → 整块持久化 → 重算本控件驱动的门控。 */
function commitWrite(
  entry: ValueEntry<ValueForm, unknown, unknown>,
  key: string,
  ctx: WriteContext,
  value: unknown,
): void {
  const settings = ctx.settings();
  entry.write(settings, value);
  ctx.persist(blockPatch(settings, entry.block));
  // 门控的 change 侧接缝:按登记的「主控」反查 —— 依赖方向单一且已在 CONTROL_GATES
  // 登记过 master,故不在条目上再登记第二遍(回填侧调的也是同一批同步函数)。
  for (const gate of CONTROL_GATES) {
    if (gate.master === key) ctx.syncGate(gate.id);
  }
}

/** 控件读侧 → 落值(通用路径):勾选位 / 字符串位 / 数值视图 / seg 分段组的选中值。 */
function controlValueOf(
  entry: ValueEntry<ValueForm, unknown, unknown>,
  control: ControlHandle,
): unknown {
  if (entry.locator.by === "radio") return control.value;
  if (entry.form === "switch") return control.checked;
  if (entry.form === "number") return control.valueAsNumber;
  return control.value;
}

/** 一次 change 的落地:回填期只读不写;有钩子交给钩子,否则走通用两行。 */
function deliver(
  key: string,
  entry: ValueEntry<ValueForm, unknown, unknown>,
  control: ControlHandle,
  ctx: WriteContext,
  hook: WriteHook | undefined,
): void {
  if (ctx.hydrating()) return;
  const write = (value: unknown): void => { commitWrite(entry, key, ctx, value); };
  if (hook) {
    hook(ctx, control, write);
    return;
  }
  write(controlValueOf(entry, control));
}

/**
 * 某一组值控件的 change 接线(各分组绑定文件经 bindSettingsEvents 编排调用)。
 * 「新增一个开关」从此只是往 CONTROL_ENTRIES 加一条:定位、读侧、落值、整块写回
 * 与门控联动都在这里按声明走完,分组文件不必再逐字写一遍监听体。
 */
export function bindControlGroup(
  group: ControlGroup,
  dom: ControlDom,
  ctx: WriteContext,
  hooks: Partial<WriteHookRegistry>,
): void {
  const registry = hooks as Partial<Record<string, WriteHook>>;
  for (const [key, entry] of Object.entries(CONTROL_ENTRIES)) {
    if (entry.kind !== "value" || entry.group !== group) continue;
    const target = entry as ValueEntry<ValueForm, unknown, unknown>;
    const hook = registry[key];
    // 声明了钩子却没给实现:宁可响,也不静默走通用路径(那会让钳制整段失效且不报错)
    if (HOOKED_WRITE_KEY_SET.has(key) && typeof hook !== "function") {
      throw new Error(`控件 ${key} 在 HOOKED_WRITE_KEYS 里声明了写侧钩子,却没有提供实现`);
    }
    if (target.locator.by === "radio") {
      dom.onRadioChange(target.locator.name, (control) => {
        // seg 分段组:组内每个成员的 change 都会派发,只有被选中的那一个才该落值
        // (这条前置是语义,不是样板冗余)
        if (!control.checked) return;
        deliver(key, target, control, ctx, hook);
      });
      continue;
    }
    const id = target.locator.id;
    dom.onChange(id, (control) => { deliver(key, target, control, ctx, hook); });
  }
}

/* ---------- 复位(表驱动:复位集与白名单同源) ---------- */

/**
 * 抽屉「恢复默认」:按复位集把内存设置复位到默认,并返回**同一键集**的持久化 payload。
 * 赋值与 payload 由同一处循环产出,故两者不会再分叉成两份手写镜像(原先是
 * 13 条赋值 + 一份 13 字段 patch 各写一遍)。
 * 对象块换新对象(不与 defaults 共享引用),标量块直赋 —— 与旧接线逐字一致。
 */
export function resetSettingsToDefaults(
  settings: AppSettings,
  defaults: AppSettings,
): Partial<AppSettings> {
  /** @param {unknown} value @returns {unknown} */
  const copy = (value: unknown): unknown =>
    typeof value === "object" && value !== null ? { ...(value as object) } : value;
  const writable = settings as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const block of resetBlockKeys()) {
    const value: unknown = defaults[block];
    writable[block] = copy(value);
    patch[block] = copy(value);
  }
  return patch as Partial<AppSettings>;
}

/* ---------- 依赖登记(显式例外;刻意不做第二套声明式依赖语言) ---------- */

/** 门控的收起形态:整块移除(IA §3 规则 1 的条件字段)或灰禁不移除(分档类从属项的唯一例外)。 */
export type GateForm = "collapse" | "disable";

/** 设置值驱动的展示位处置形态。 */
export type ValueDrivenForm = "toggle-hidden" | "mirror-text" | "compose-text";

export interface ControlGate {
  /** 门控键(装配处手写同步函数映射表的键集:少登记一个门控即多一个必填槽)。 */
  readonly id: string;
  readonly master: ControlKey;
  readonly dependents: readonly ControlKey[];
  readonly form: GateForm;
  /** 实现落点(本仓内函数名),便于按图索骥。 */
  readonly where: string;
}

/**
 * 三个手写门控的登记(页眉自定义折叠 / AI 清理分档灰禁 / 目录模式整块移除)。
 * 只登记"谁驱动谁 + 收起形态",不登记判定与实现:依赖是少数情况,
 * 把它声明式化只会让表里长出第二套 mini 语言(见 docs/large/01 步 03 高风险点 1)。
 * 收起形态是 IA 拍板的,不是实现细节 —— 条件字段整块移除、分档灰禁不移除。
 *
 * master 同时是 change 侧的接缝:主控控件落值后由 bindControlGroup 按它反查同步函数
 * (回填侧则逐个调用 GATE_SYNCERS),两条路径共用这一份登记,不会只接上一半。
 */
export const CONTROL_GATES = [
  {
    id: "headerCustomVisibility",
    master: "headerMode",
    dependents: ["headerText", "headerLogoPath", "headerLayout", "footerEnabled"],
    form: "collapse",
    where: "settings-panel.syncHeaderCustomVisibility",
  },
  {
    id: "aiCleanupTierAvailability",
    master: "aiCleanup",
    dependents: ["aiCleanupTidy", "aiCleanupRewrite"],
    form: "disable",
    where: "settings-panel.syncAiCleanupTierAvailability",
  },
  {
    id: "tocModeVisibility",
    master: "toc",
    dependents: ["tocMode"],
    form: "collapse",
    where: "settings-panel.syncTocModeVisibility",
  },
] as const satisfies readonly ControlGate[];

/** 门控键并集(装配处用它约束"每个门控都得有一个手写同步函数")。 */
export type GateId = (typeof CONTROL_GATES)[number]["id"];

export interface ValueDrivenEffect {
  /** 效果键。 */
  readonly id: string;
  /** 驱动源(设置控件键;副标题是两处合成故可多个)。 */
  readonly sources: readonly ControlKey[];
  /** 落点展示位及其处置形态。 */
  readonly sites: readonly { readonly target: string; readonly effect: ValueDrivenForm }[];
  /** 实现落点(本仓内函数名)。 */
  readonly where: string;
}

/**
 * 设置值驱动的显隐 / 双写 / 文案合成(5 处 + 预设提示行,共 6 条):
 * 派生键可删性 · 预设提示文案 · PDF CSS 状态行与清除钮 · 页眉 Logo 清除钮 ·
 * 输出目录双写(抽屉 chip + 快速参数条镜像)· 抽屉副标题合成。
 * 与门控同理只登记事实;一处不漏由设置控件段的交叉校验兜住
 * (每个落点 id 必须在 index.html 里,且必须出现在本表内)。
 *
 * 其中只有 **pdfCssState** 有 change 侧落点(文本域改动即时改状态行与清除钮);
 * 其余 5 条分别由动作入口(选目录 / 选 logo / 选预设)或整体回填驱动,故不在写侧接线。
 */
export const VALUE_DRIVEN_EFFECTS = [
  {
    id: "presetDeletable",
    sources: ["templatePreset"],
    sites: [{ target: "presetDeleteBtn", effect: "toggle-hidden" }],
    where: "settings-panel.syncPresetSelection",
  },
  {
    id: "presetHint",
    sources: ["templatePreset"],
    sites: [{ target: "templatePresetHint", effect: "compose-text" }],
    where: "settings-panel.refreshDynamicSettingsText",
  },
  {
    id: "pdfCssState",
    sources: ["pdfCss"],
    sites: [
      { target: "pdfCssStatus", effect: "compose-text" },
      { target: "pdfCssClearBtn", effect: "toggle-hidden" },
    ],
    where: "settings-panel.syncPdfCssState",
  },
  {
    id: "headerLogoState",
    sources: ["headerLogoPath"],
    sites: [{ target: "headerLogoClear", effect: "toggle-hidden" }],
    where: "settings-panel.syncHeaderLogoDisplay",
  },
  {
    id: "outputDirChips",
    sources: ["outputDir"],
    sites: [
      { target: "outputDirValue", effect: "mirror-text" },
      { target: "quickOutputDir", effect: "mirror-text" },
    ],
    where: "settings-panel.syncOutputDirDisplay",
  },
  {
    id: "drawerSubtitle",
    sources: ["templatePreset", "paper"],
    sites: [{ target: "drawerSubtitle", effect: "compose-text" }],
    where: "settings-panel.composeDrawerMetaText",
  },
] as const satisfies readonly ValueDrivenEffect[];

/** 设置值驱动效果键并集。 */
export type ValueDrivenEffectId = (typeof VALUE_DRIVEN_EFFECTS)[number]["id"];

/* ---------- 扁平视图(跨源对照的唯一读法) ---------- */

/** 声明表的一行扁平视图:键 + 形态 + 组 + 复位处置 + 顶层块 + 全部 DOM 标识。 */
export interface ControlRow {
  readonly key: string;
  readonly kind: ControlEntry["kind"];
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  /** 顶层块(派生键无块)。 */
  readonly block: string | null;
  /** 元素 id(控件本体 / chip 展示位与镜像 / 副显位 / 动作入口 / 展示位落点)。 */
  readonly ids: readonly string[];
  /** document 级 radio 组名(seg 分段定位)。 */
  readonly radioNames: readonly string[];
  /** 是否声明了写侧钩子(通用落值之外还有别的事要做)。 */
  readonly hooked: boolean;
}

/**
 * 扁平视图:测试侧的四项交叉校验(逐控件 ⇄ 声明表、声明表 ⇄ index.html、
 * 声明表 ⇄ 几何规格、复位块覆盖)一律经它读,不各自重述键与 id。
 */
export function controlTable(): readonly ControlRow[] {
  return Object.entries(CONTROL_ENTRIES).map(([key, entry]) => {
    switch (entry.kind) {
      case "value": {
        const ids =
          entry.locator.by === "id"
            ? [entry.locator.id, ...(entry.echo ?? [])]
            : [...(entry.echo ?? [])];
        return {
          key,
          kind: entry.kind,
          group: entry.group,
          reset: entry.reset,
          block: entry.block,
          ids,
          radioNames: entry.locator.by === "radio" ? [entry.locator.name] : [],
          hooked: HOOKED_WRITE_KEY_SET.has(key),
        };
      }
      case "chip":
        return {
          key,
          kind: entry.kind,
          group: entry.group,
          reset: entry.reset,
          block: entry.block,
          ids: [entry.display, ...entry.mirrors, ...entry.write],
          radioNames: [],
          hooked: false,
        };
      case "derived":
        return {
          key,
          kind: entry.kind,
          group: entry.group,
          reset: entry.reset,
          block: null,
          ids: [entry.locator.id],
          radioNames: [],
          hooked: false,
        };
    }
  });
}
