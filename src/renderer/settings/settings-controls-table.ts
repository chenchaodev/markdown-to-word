/**
 * 设置控件声明表(纯数据 + 纯函数,**零 DOM**):一条声明同时给出
 * 「设置键 → 控件定位 → 所属组 → 读设置 → 转控件值 → 复位处置」,
 * hydrate 由本表驱动,bind / reset 从同一张表取读侧与复位口径 ——
 * 新增一个控件的 renderer 侧改动因此收敛为「1 个表条目 + 1 个 HTML 控件」。
 *
 * 为什么零 DOM:本表的下游有一层纯逻辑(回显值映射 settingsToControlValues)在
 * 无 Electron 环境直测,声明表若 import dom/refs 就把 DOM 拉进那条链,纯层即死。
 * 元素由装配处(settings-panel)按「定位」经 ControlDom 注入 —— 本表只说
 * 「要哪个 id / 哪个 radio 组名」,不说去哪里拿。
 *
 * 键路径不经手写字符串:每条的 read 是一个吃 AppSettings 的取值器,
 * 键名拼错或类型不符在 tsc 期即报错("typography.align" 这类串编译器看不见)。
 *
 * 形态分四类,各有各的表达,不合成一套通用描述:值控件(开关 / 文本 / 数值 /
 * 枚举档)· path-chip(可写控件与展示位分离,可带双写镜像)· 派生键(不落
 * AppSettings)· 无控件键(没有控件但复位口径仍须登记)。合成后每条都要带一堆
 * 用不上的可选字段,编译器也就再也指不出「这条少声明了复位处置」。
 *
 * 依赖(3 个手写门控 + 设置值驱动的显隐 / 双写 / 文案合成)刻意**只登记事实、
 * 不做声明式**:见 CONTROL_GATES 与 VALUE_DRIVEN_EFFECTS 的说明。
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

/** 顶层块键(整块写回的定位)。字面量受 keyof AppSettings 约束:块名拼错在 tsc 期报错。 */
export type BlockKey = keyof AppSettings & string;

/** 控件定位:单元素控件按 id,seg 分段按 document 级 radio 组名。 */
export type ControlLocator =
  | { readonly by: "id"; readonly id: string }
  | { readonly by: "radio"; readonly name: string };

/** 值控件:读设置 → 转控件值 → 回填控件。 */
export interface ValueEntry<F extends ValueForm, V, C> {
  readonly kind: "value";
  readonly form: F;
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly block: BlockKey;
  readonly locator: ControlLocator;
  /** 设置取值:参数类型即 AppSettings,键路径的类型错误在这一步暴露。 */
  readonly read: (settings: AppSettings) => V;
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

/** 值控件条目(工厂):保住 read / toControl 的具体类型 ——
 *  整表用 satisfies 注解会把类型擦成 unknown,派生映射就无从谈起。 */
function valueEntry<F extends ValueForm, V, C>(spec: {
  readonly form: F;
  readonly group: ControlGroup;
  readonly reset: ResetPolicy;
  readonly block: BlockKey;
  readonly locator: ControlLocator;
  readonly read: (settings: AppSettings) => V;
  readonly toControl: (value: V) => C;
  readonly echo?: readonly string[];
}): ValueEntry<F, V, C> {
  return { kind: "value", ...spec, controlValue: (settings) => spec.toControl(spec.read(settings)) };
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
    form: "radio", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "radio", name: "paper" },
    read: (s) => s.pageSetup.paper, toControl: (v) => v,
  }),
  orientation: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "radio", name: "orientation" },
    read: (s) => s.pageSetup.orientation, toControl: (v) => v,
  }),
  marginTop: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "id", id: "marginTop" },
    read: (s) => s.pageSetup.marginTop, toControl: (v) => String(v),
  }),
  marginBottom: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "id", id: "marginBottom" },
    read: (s) => s.pageSetup.marginBottom, toControl: (v) => String(v),
  }),
  marginLeft: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "id", id: "marginLeft" },
    read: (s) => s.pageSetup.marginLeft, toControl: (v) => String(v),
  }),
  marginRight: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "pageSetup",
    locator: { by: "id", id: "marginRight" },
    read: (s) => s.pageSetup.marginRight, toControl: (v) => String(v),
  }),
  fontEastAsia: valueEntry({
    form: "text", group: "typography", reset: "reset", block: "typography",
    locator: { by: "id", id: "fontEastAsia" },
    read: (s) => s.typography.fontEastAsia, toControl: (v) => v,
  }),
  fontAscii: valueEntry({
    form: "text", group: "typography", reset: "reset", block: "typography",
    locator: { by: "id", id: "fontAscii" },
    read: (s) => s.typography.fontAscii, toControl: (v) => v,
  }),
  bodySizePt: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "typography",
    locator: { by: "id", id: "bodySizePt" },
    read: (s) => s.typography.bodySizePt, toControl: (v) => String(v),
  }),
  lineSpacing: valueEntry({
    form: "number", group: "typography", reset: "reset", block: "typography",
    locator: { by: "id", id: "lineSpacing" },
    read: (s) => s.typography.lineSpacing, toControl: (v) => String(v),
    echo: ["lineSpacingValue"],
  }),
  headingScale: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography",
    locator: { by: "radio", name: "headingScale" },
    read: (s) => s.typography.headingScale, toControl: (v) => v,
  }),
  headingSpacing: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography",
    locator: { by: "radio", name: "headingSpacing" },
    read: (s) => s.typography.headingSpacing, toControl: (v) => v,
  }),
  firstLineIndent: valueEntry({
    form: "switch", group: "typography", reset: "reset", block: "typography",
    locator: { by: "id", id: "firstLineIndent" },
    read: (s) => s.typography.firstLineIndent, toControl: (v) => v,
  }),
  align: valueEntry({
    form: "radio", group: "typography", reset: "reset", block: "typography",
    locator: { by: "radio", name: "align" },
    read: (s) => s.typography.align, toControl: (v) => v,
  }),
  // 03 页眉页脚与水印
  headerMode: valueEntry({
    form: "radio", group: "headerwatermark", reset: "reset", block: "headerFooter",
    locator: { by: "radio", name: "headerMode" },
    read: (s) => s.headerFooter.headerMode, toControl: (v) => v,
  }),
  headerText: valueEntry({
    form: "text", group: "headerwatermark", reset: "reset", block: "headerFooter",
    locator: { by: "id", id: "headerText" },
    read: (s) => s.headerFooter.headerText, toControl: (v) => v,
  }),
  headerLogoPath: chipEntry({
    group: "headerwatermark", reset: "reset", block: "headerFooter",
    display: "headerLogoStatus", mirrors: [], write: ["headerLogoPick", "headerLogoClear"],
    read: (s) => s.headerFooter.headerLogoPath,
  }),
  headerLayout: valueEntry({
    form: "radio", group: "headerwatermark", reset: "reset", block: "headerFooter",
    locator: { by: "radio", name: "headerLayout" },
    read: (s) => s.headerFooter.headerLayout, toControl: (v) => v,
  }),
  footerEnabled: valueEntry({
    form: "switch", group: "headerwatermark", reset: "reset", block: "headerFooter",
    locator: { by: "id", id: "footerEnabled" },
    read: (s) => s.headerFooter.footerEnabled, toControl: (v) => v,
  }),
  watermarkText: valueEntry({
    form: "text", group: "headerwatermark", reset: "reset", block: "watermark",
    locator: { by: "id", id: "watermarkText" },
    read: (s) => s.watermark.text, toControl: (v) => v,
  }),
  watermarkAngle: valueEntry({
    form: "number", group: "headerwatermark", reset: "reset", block: "watermark",
    locator: { by: "id", id: "watermarkAngle" },
    read: (s) => s.watermark.angle, toControl: (v) => String(v),
  }),
  watermarkOpacity: valueEntry({
    form: "number", group: "headerwatermark", reset: "reset", block: "watermark",
    locator: { by: "id", id: "watermarkOpacity" },
    read: (s) => s.watermark.opacity, toControl: (v) => String(v),
  }),
  watermarkGray: valueEntry({
    form: "switch", group: "headerwatermark", reset: "reset", block: "watermark",
    locator: { by: "id", id: "watermarkGray" },
    read: (s) => s.watermark.gray, toControl: (v) => v,
  }),
  // 04 编号与目录
  headingNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "typography",
    locator: { by: "id", id: "headingNumbering" },
    read: (s) => s.typography.headingNumbering, toControl: (v) => v,
  }),
  captionNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "typography",
    locator: { by: "id", id: "captionNumbering" },
    read: (s) => s.typography.captionNumbering, toControl: (v) => v,
  }),
  equationNumbering: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "equationNumbering",
    locator: { by: "id", id: "equationNumbering" },
    read: (s) => s.equationNumbering, toControl: (v) => v,
  }),
  toc: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "toc",
    locator: { by: "id", id: "toc" },
    read: (s) => s.toc, toControl: (v) => v,
  }),
  tocMode: valueEntry({
    form: "select", group: "numbering", reset: "reset", block: "tocMode",
    locator: { by: "id", id: "tocMode" },
    read: (s) => s.tocMode, toControl: (v) => v,
  }),
  breakBeforeH1: valueEntry({
    form: "switch", group: "numbering", reset: "reset", block: "breakBeforeH1",
    locator: { by: "id", id: "breakBeforeH1" },
    read: (s) => s.breakBeforeH1, toControl: (v) => v,
  }),
  // 05 转换
  aiCleanup: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup",
    locator: { by: "id", id: "aiCleanup" },
    read: (s) => s.aiCleanup.enabled, toControl: (v) => v,
  }),
  aiCleanupTidy: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup",
    locator: { by: "id", id: "aiCleanupTidy" },
    read: (s) => s.aiCleanup.tidy, toControl: (v) => v,
  }),
  aiCleanupRewrite: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "aiCleanup",
    locator: { by: "id", id: "aiCleanupRewrite" },
    read: (s) => s.aiCleanup.rewrite, toControl: (v) => v,
  }),
  obsidianCompat: valueEntry({
    form: "switch", group: "convert", reset: "reset", block: "obsidian",
    locator: { by: "id", id: "obsidianCompat" },
    read: (s) => s.obsidian.compat, toControl: (v) => v,
  }),
  obsidianAttachmentFolder: valueEntry({
    form: "text", group: "convert", reset: "reset", block: "obsidian",
    locator: { by: "id", id: "obsidianAttachmentFolder" },
    read: (s) => s.obsidian.attachmentFolder, toControl: (v) => v,
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
    read: (s) => s.afterConvert, toControl: (v) => v,
  }),
  pdfCss: valueEntry({
    form: "text", group: "convert", reset: "reset", block: "pdfCss",
    locator: { by: "id", id: "pdfCssText" },
    read: (s) => s.pdfCss, toControl: (v) => v,
  }),
  // 06 应用(theme / language 属刻意保留集,见 reset 字段)
  theme: valueEntry({
    form: "radio", group: "app", reset: "preserve", block: "theme",
    locator: { by: "radio", name: "theme" },
    read: (s) => s.theme, toControl: (v) => v,
  }),
  languageSelect: valueEntry({
    form: "select", group: "app", reset: "preserve", block: "language",
    locator: { by: "id", id: "languageSelect" },
    read: (s) => s.language, toControl: (v) => v,
  }),
  // 抽屉外:快速参数条的两处镜像 + 顶栏格式分段
  quickPreset: derivedEntry({ group: "mirror", locator: { by: "id", id: "quickPreset" } }),
  format: valueEntry({
    form: "radio", group: "mirror", reset: "preserve", block: "format",
    locator: { by: "radio", name: "format" },
    read: (s) => s.format, toControl: (v) => v,
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

/* ---------- 回填(表驱动;DOM 由装配处注入) ---------- */

/** seg 分段组:document 级同名 radio 成组,故按组名而非单个元素定位。 */
export interface RadioGroup {
  forEach(visit: (input: { readonly value: string; checked: boolean }) => void): void;
}

/** 控件的 DOM 供给(依赖注入):本表只说"要哪个 id / 哪个组名",不说去哪里拿。 */
export interface ControlDom {
  element(id: string): HTMLElement;
  radioGroup(name: string): RadioGroup;
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
  for (const entry of Object.values(CONTROL_ENTRIES)) {
    if (entry.kind !== "value") continue;
    if (entry.locator.by === "radio") {
      const value = entry.controlValue(settings);
      dom.radioGroup(entry.locator.name).forEach((input) => {
        input.checked = input.value === value;
      });
      continue;
    }
    const id = entry.locator.id;
    if (entry.form === "switch") {
      (dom.element(id) as CheckableElement).checked = entry.controlValue(settings);
      continue;
    }
    (dom.element(id) as WritableElement).value = entry.controlValue(settings);
    for (const echoId of entry.echo ?? []) dom.element(echoId).textContent = entry.controlValue(settings);
  }
}

/* ---------- 依赖登记(显式例外;刻意不做成第二套声明式依赖语言) ---------- */

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
        };
    }
  });
}
