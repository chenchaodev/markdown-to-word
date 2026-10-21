/**
 * 设置面板:设置加载/回填/校验/钳制/持久化写回(persistSettings + 四组整体
 * 写回)、预设选项重建、PDF CSS 与 Word 模板导入;全部设置控件的事件绑定见
 * settings-bindings.ts 六组分组文件(单向依赖本模块),自定义预设弹窗/保存/删除/
 * 导入导出见 settings-preset-actions.ts(单向依赖本模块)——两者均不被本模块反向引用。
 * 抽屉开合/焦点/副标题写入见 settings-drawer.ts(本模块单向依赖之)。
 * 依赖方向:本模块 → core/settings-defaults、dom.ts、state.ts、settings-drawer、
 * settings-controls-table;不反向引用 renderer.ts 的私有符号。
 * 组合根 renderer.ts 调用:init 处 bindSettingsEvents() 后再 loadSettings()
 * (时序与拆分前一致:事件绑定先于回填)。
 * 控件回填与 change 接线由声明表(settings-controls-table)驱动,本模块只提供
 * 「按声明里的定位取元素」与「落值通道」两处接缝 —— 键、id、组、读侧、写侧、
 * 复位口径的单源都在表里。
 * 快速参数条(主界面)为抽屉的高频镜像——模板预设 select 与输出目录 chip 在回填/
 * 选项重建处双写;paper/orientation 分段为同名 radio 组自动成组,无需显式镜像。
 */
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../../core/settings/settings-defaults.js";
import { cjkFontSizeOfPt } from "../../core/settings/typography.js";
// 未映射字段的标识与常量单源在零依赖模块(core/docx/template-fields.ts):界面要取
// 「恒不接管的六类」那份**常量**渲染固定说明,不能经 core/docx/template-import.js 取
// (那会把 jszip 拖进 renderer 产物)。
import {
  ALWAYS_UNMAPPED_TEMPLATE_FIELDS,
  type AlwaysUnmappedTemplateField,
  type FactualUnmappedTemplateField,
} from "../../core/docx/template-fields.js";
import { htmlLangOf } from "../../core/i18n/index.js";
import {
  headerLogoDisplayName,
  applySettingsRuntimeEffects,
  mergeSettingsWithDefaults,
  outputDirDisplayText,
  resolvePresetHint,
  resolvePresetSelection,
  allPresets,
  applyThemeOn,
} from "./settings-logic.js";
import {
  CONTROL_ENTRIES,
  controlTable,
  hydrateControls,
  type ControlDom,
  type ControlGroup,
  type ControlHandle,
  type GateId,
  type WriteContext,
} from "./settings-controls-table.js";
import { persistSettings, registerSettingsSaveHooks } from "./settings-save.js";
import {
  checkedRadioValue,
  completeDialogSuppressInput,
  aiCleanupInput,
  aiCleanupTidyInput,
  aiCleanupRewriteInput,
  aiCleanupTiersLocked,
  cjkFontSizeSelect,
  headerCustomFields,
  headerLogoClearBtn,
  headerLogoStatus,
  headerModeInputs,
  languageSelect,
  outputDirValue,
  paperInputs,
  pdfCssClearBtn,
  pdfCssStatus,
  pdfCssTextInput,
  presetDeleteBtn,
  quickOutputDirChip,
  quickPresetSelect,
  settingsFilterInput,
  settingsFilterStatus,
  statusEl,
  templatePresetHint,
  templatePresetSelect,
  tocInput,
  tocModeRoot,
  watermarkFields,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError, setStatus } from "../dom/dom-ops.js";
// toast 轻提示(单实例,dom/toast):模板导入的「未映射字段」摘要走这条既有通道
import { showToast } from "../dom/toast.js";
import { errorMessage } from "../state/pure.js";
import { applyStaticTexts, setLanguage, t, LANGUAGES, type I18nKey, type Language } from "../../core/i18n/index.js";
// 抽屉副标题文案写入归抽屉模块(本模块只负责由设置值合成文案)
import { updateDrawerMeta } from "./settings-drawer.js";

/**
 * 「自定义」档的 option value:磅值不在号数制表内(如 11pt / 13.5pt)时显示此档。
 * 它是**状态**而非可选目标 —— 用户挑不出一个「自定义」来(档位只有 9 个号数制档),
 * 故与档位 id(来自 core 的 CJK_FONT_SIZES)分开定义。
 */
export const CUSTOM_FONT_SIZE_ID = "custom";

/**
 * 外观主题应用到文档根元素:显式 light/dark 设 data-theme,
 * system 移除属性(CSS @media prefers-color-scheme 接管)。
 * 契约计算在 settings-logic.applyThemeOn(纯函数,直测见 settings-logic 段),
 * 本包装只注入 document.documentElement。
 */
export function applyTheme(theme: AppSettings["theme"]): void {
  applyThemeOn(document.documentElement, theme);
}

/**
 * 语言镜像写 localStorage(FOUC 缓解,最小方案):
 * 语言真源在 settings.json(经主进程),renderer 在语言设置/切换落定时镜像写入
 * localStorage("m2w.language") 与 "m2w.htmlLang"(值来自注册表 htmlLangOf 单源);
 * index.html <head> 的 lang-bootstrap.js 尽早读取该镜像设置 <html lang>
 * (只消 lang/字体方向性闪烁,不做文案替换)。
 * 选型记录:未采用「body 初始 visibility:hidden」方案——CSP 为 script-src 'self'
 * 内联脚本被拦,且隐藏 body 若初始化失败会白屏;外部 bootstrap 脚本改动最小。
 * htmlLang 镜像:bootstrap 不再自带 code→htmlLang 映射(原 zh/en
 * 硬编码在多语言注册表化后失效),改为读本镜像;旧镜像无 htmlLang 时 bootstrap
 * 走遗留 zh/en 回退,首次启动 applyStaticTexts 纠正后即被本函数补齐。
 */
export function mirrorLanguage(lang: Language): void {
  try {
    localStorage.setItem("m2w.language", lang);
    localStorage.setItem("m2w.htmlLang", htmlLangOf(lang));
  } catch {
    /* localStorage 不可用(隐私模式等)时静默:仅失去 FOUC 缓解,不影响功能 */
  }
}

/**
 * 重建界面语言选项(i18n 多语言改造;自 radio 组迁移为 select):
 * 按 core/i18n LANGUAGES 注册表动态生成 option(label = 本地化自称,不再经字典
 * data-i18n),新增语言注册后自动出现。
 * 须在 bindSettingsEvents 绑定语言事件之前调用(输入为运行期生成);
 * 生成期即按当前设置选中(hydration 前的空窗期也有选中项;回填以
 * applySettingsToControls 为准)。
 */
export function rebuildLanguageOptions(): void {
  languageSelect.replaceChildren();
  for (const { code, label } of LANGUAGES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    languageSelect.appendChild(option);
  }
  languageSelect.value = state.settings.language;
}

/* ---------- 设置:加载 / 回填 / 写回 ---------- */
/* 写回流水线(保存修订号 / 待重试草稿 / 失败文案原文)已移入 settings-save.ts:
 * 那三份状态是**跨模块共享**的 —— 抽屉与向导必须落在同一份草稿上,否则交替写入会丢字段。
 * 本模块只保留 DOM 触点(applySettingsToControls / applyAuthoritativeSettings /
 * composeDrawerMetaText),并在模块初始化时经 registerSettingsSaveHooks 交出去。 */

/** main 权威值同时覆盖 renderer state、语言/主题副作用与全部控件。 */
function applyAuthoritativeSettings(settings: AppSettings): void {
  state.settings = mergeSettingsWithDefaults(settings);
  applySettingsRuntimeEffects(state.settings, {
    setSelectedFormat: (format) => { state.selectedFormat = format; },
    setLanguage,
    mirrorLanguage,
    applyStaticTexts,
    applyTheme,
  });
  state.hydratingSettings = true;
  try {
    rebuildPresetOptions();
    applySettingsToControls();
  } finally {
    state.hydratingSettings = false;
  }
}

/** 启动时读取持久化设置,失败静默回退默认值;回填后解除 hydration 标记。 */
export async function loadSettings(): Promise<void> {
  let loaded: AppSettings;
  try {
    loaded = await window.api.settingsGet();
  } catch {
    loaded = DEFAULT_SETTINGS;
  }
  // 防御性合并:旧版本设置缺字段时按默认值兜底(outputDir 缺省 = 源目录)
  state.settings = mergeSettingsWithDefaults(loaded, (message) => {
    setError(message);
  });
  // i18n:主进程语言来源 = 持久化设置;启动即应用(静态文案 + 动态文案经 t() 自动跟随)
  setLanguage(state.settings.language);
  mirrorLanguage(state.settings.language); // 镜像写 localStorage 供 lang-bootstrap.js 尽早读
  applyStaticTexts();
  applyTheme(state.settings.theme); // 外观主题启动即应用(设/移除 data-theme)
  state.hydratingSettings = true;
  rebuildPresetOptions(); // 自定义预设选项先就位,再回填 select 值
  applySettingsToControls();
  state.hydratingSettings = false;
  state.selectedFormat = state.settings.format; // 转换格式与设置保持一致
}

/* ---------- 声明表 → DOM 的接缝 ---------- */
/**
 * 声明表不碰 DOM(保持可 Node 直测),元素在装配处按「声明里的定位」取来。
 * id 与 radio 组名的单源是声明表,此处不重述任何一个 —— 新增控件因此不必再动
 * dom/refs;refs 留给手写接线(动作按钮、门控、动态文案)。
 *
 * 回填(hydrateControls)与 change 订阅(bindControlGroup)共用这一个接缝,
 * 故全表只有**一处** DOM 定位,不会出现「回填按声明走、绑定按 refs 走」的错位。
 */
export const controlDom: ControlDom = {
  element: (id) => {
    const el = document.getElementById(id);
    // 控件 id 与 index.html 的偏差在设置控件段已被交叉校验判掉;运行期再错要响,
    // 不能静默把值写到 null 上(那会呈现为"回填没生效"这种查不到源的故障)
    if (!el) throw new Error(`设置控件 #${id} 在 DOM 中不存在(声明表与 index.html 不一致)`);
    return el;
  },
  radioGroup: (name) => document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  onChange: (id, handler) => {
    const el = controlDom.element(id);
    el.addEventListener("change", () => handler(controlHandle(el)));
  },
  onRadioChange: (name, handler) => {
    // 全文档同名成组:快速参数条里的镜像分段自动纳入订阅,此处零额外代码
    for (const input of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      input.addEventListener("change", () => handler(controlHandle(input)));
    }
  },
};

/** 元素 → 结构化控制面(本模块是唯一知道 DOM 类型的地方:声明表与写侧钩子
 *  只见 value / checked / valueAsNumber 与一次回写)。valueAsNumber 的 NaN 语义
 *  由浏览器提供(空串与非数值给 NaN 而非 0,钳制分支靠它区分「空输入」)。 */
function controlHandle(
  el: HTMLElement & { value?: string; checked?: boolean; valueAsNumber?: number },
): ControlHandle {
  return {
    get value() { return el.value ?? ""; },
    get checked() { return el.checked === true; },
    get valueAsNumber() { return el.valueAsNumber ?? Number.NaN; },
    setValue: (value: string) => { el.value = value; },
  };
}

/** 三个手写门控的同步函数:键集 = 声明表登记的门控 id(少登记一个门控即多一个
 *  必填槽,编译期红);回填时逐个调用、change 侧按登记的 master 反查调用,
 * 两条路径共用这一份映射,不把依赖做成声明式。 */
export const GATE_SYNCERS: Record<GateId, () => void> = {
  headerCustomVisibility: syncHeaderCustomVisibility,
  aiCleanupTierAvailability: syncAiCleanupTierAvailability,
  tocModeVisibility: syncTocModeVisibility,
  watermarkFieldVisibility: syncWatermarkFieldVisibility,
};

/** 写侧落值通道(声明表不 import state / persist —— 由本模块注入,依赖方向保持单向)。
 *  settings 按函数读:落权威值时 state.settings 会被整体换成新对象,持引用会写回旧对象。 */
export const settingsWriteContext: WriteContext = {
  settings: () => state.settings,
  hydrating: () => state.hydratingSettings,
  persist: (patch) => { persistSettings(patch); },
  syncGate: (id) => { GATE_SYNCERS[id](); },
  setSelectedFormat: (format) => { state.selectedFormat = format; },
};

/** 将内存设置回填到所有控件(仅赋值,不触发 change 事件)。
 *  值控件由声明表驱动(键 → 控件 → 值的映射与 seg 分段组的按值勾选都在表里);
 *  派生键、门控、动态展示位、抽屉副标题各按自己的机制在后段处理 ——
 *  它们都不是「控件值 = 设置值」的直连关系,故不进表驱动那一段。 */
export function applySettingsToControls(): void {
  hydrateControls(state.settings, controlDom);
  syncPresetSelection();
  syncCjkFontSizeSelection();
  for (const syncGate of Object.values(GATE_SYNCERS)) syncGate();
  refreshDynamicSettingsText();
  updateDrawerMeta(composeDrawerMetaText());
}

/**
 * 中文字号(号数制)下拉回显:把当前正文字号磅值反解成号数制档位写进下拉。
 *
 * 派生控件(值是「磅值落在哪一档」的结论,不是设置字段):本函数**只读设置、只写下拉** ——
 * 程序性赋值不派发 change,故不会产生「回显 → 写回」的回环。
 * 落在号数制表外的磅值(如 11pt / 13.5pt)显示「自定义」档(它标示状态,不是可选目标)。
 * 真值仍是 typography.bodySizePt(唯一真值),本控件不新增持久化键。
 */
export function syncCjkFontSizeSelection(): void {
  const entry = cjkFontSizeOfPt(state.settings.typography.bodySizePt);
  cjkFontSizeSelect.value = entry?.id ?? CUSTOM_FONT_SIZE_ID;
}

/** 模板预设 select 回填(派生键:值是「当前设置匹配哪个预设」的结论,不是设置字段)。
 *  优先保持当前选中(其值与设置一致时不被弹回——自定义预设与硬编码预设值全等时
 *  find 会抢走),否则回退全局匹配;无匹配回退「默认」。抽屉 select 与快速参数条
 *  镜像 select 同步同值;仅自定义预设可删(选中项以 custom: 前缀标识)。
 *  导出:声明表把这条登记为「派生键可删性」效果,设置控件段据此逐条点名
 *  (where 字段指向的必须是真实存在的导出,不能只是一段注释里的名字)。 */
export function syncPresetSelection(): void {
  const matchedPresetId = resolvePresetSelection(
    state.settings.customPresets,
    state.settings,
    templatePresetSelect.value,
  );
  templatePresetSelect.value = matchedPresetId;
  quickPresetSelect.value = matchedPresetId;
  presetDeleteBtn.classList.toggle("hidden", !matchedPresetId.startsWith("custom:"));
}

/* ---------- 动态状态节点(内容来自设置状态,index.html 中不带 data-i18n) ----------
 * 契约:applyStaticTexts 只负责静态文案;这些节点的值是「用户当前真实值」
 * (输出目录 / Logo 文件名 / 导入状态 / 当前预设提示),若挂 data-i18n 会被
 * 字典默认值覆盖(路径回默认目录、已选 Logo 显示未选、CSS 显示未导入)。
 * 因此改由本组函数按当前语言重算,语言切换后必须重跑。 */

/** 输出目录双写:抽屉 chip + 快速参数条镜像 chip(同值同 title)。 */
export function syncOutputDirDisplay(dir: string): void {
  const text = outputDirDisplayText(dir);
  for (const chip of [outputDirValue, quickOutputDirChip]) {
    chip.textContent = text;
    chip.title = text;
  }
}

/** PDF 样式 CSS 导入状态(label 用于导入后带文件名的即时反馈,缺省按有无内容取通用文案)。 */
export function syncPdfCssState(css: string, label?: string): void {
  pdfCssStatus.textContent =
    label ?? (css ? t("settings.pdfCssImported") : t("settings.pdfCssNone"));
  pdfCssClearBtn.classList.toggle("hidden", !css);
}

/** 页眉 Logo 回显(仅文件名;清除钮随路径显隐)。 */
export function syncHeaderLogoDisplay(path: string): void {
  const name = headerLogoDisplayName(path);
  headerLogoStatus.textContent = name || t("settings.headerLogoNone");
  headerLogoStatus.title = name;
  headerLogoClearBtn.classList.toggle("hidden", !path);
}

/**
 * 动态状态节点重算:回填与语言切换共用(切换语言后静态文案已刷,
 * 动态节点必须按新语言重算,否则显示旧语言;也不能靠 data-i18n,见上)。
 */
export function refreshDynamicSettingsText(): void {
  const matchedPresetId = resolvePresetSelection(
    state.settings.customPresets,
    state.settings,
    templatePresetSelect.value,
  );
  const hint = resolvePresetHint(
    state.settings.customPresets,
    matchedPresetId,
  );
  templatePresetHint.textContent = hint;
  // 说明行默认换行(不截断),故不再另写 title —— 那只是把同一句话再挂一次悬浮提示
  // 三处动态展示位取各自声明条目的读侧(键路径单源在声明表,不在这里重述)
  syncOutputDirDisplay(CONTROL_ENTRIES.outputDir.read(state.settings));
  syncPdfCssState(CONTROL_ENTRIES.pdfCss.read(state.settings));
  syncHeaderLogoDisplay(CONTROL_ENTRIES.headerLogoPath.read(state.settings));
  // 检索的计数与状态行文案按当前语言现算(label 与命中数文案都不是静态节点),
  // 语言切换后须随静态文案一起重算,否则停留在旧语言(与上面三处同一理由)。
  refreshSearchResults();
}

/**
 * 自定义页眉控件块显隐:仅 headerMode=custom 时展开文字/logo/布局(整块收起而非
 * 灰禁;.cond:not(.show) 内 visibility:hidden 保证折叠时不可聚焦),与
 * default(标题页眉)/none(无页眉)无关。回填与模式 seg 切换共用。
 */
export function syncHeaderCustomVisibility(): void {
  const custom = checkedRadioValue(headerModeInputs) === "custom";
  headerCustomFields.classList.toggle("show", custom);
  // inert 随折叠同步:收起态字段不可聚焦(键盘/焦点陷阱不落入不可见区)
  headerCustomFields.inert = !custom;
}

/**
 * AI 清理两个分档的可用性:总开关关闭时置灰(disabled)+ 显式说明行。
 * 与 .cond 折叠容器的既定语义不同 —— 这里刻意**灰禁而非整块移除**:
 * 分档位置与上次选择要留在原处,总开关重新打开即恢复原选择(不移除即不丢值)。
 * 可用性不只靠颜色表达:disabled 移出焦点序(键盘/读屏都会跳过),
 * 另有一行可见文字说明「需先开启总开关」。回填与总开关切换共用本函数。
 */
export function syncAiCleanupTierAvailability(): void {
  const enabled = aiCleanupInput.checked;
  aiCleanupTidyInput.disabled = !enabled;
  aiCleanupRewriteInput.disabled = !enabled;
  aiCleanupTiersLocked?.classList.toggle("hidden", enabled);
}

/**
 * 目录模式(两档 seg)条件子行的显隐:仅 toc 开启时可见(设置抽屉 04 组),
 * 关闭时**整块移除**而非灰禁 —— 模式不满足就摆一个可点的档位,用户能选一个
 * 不会生效的模式。
 * 收起/展开作用在**容器** #tocMode 上(值载体是容器内的 radio 组
 * input[name="tocMode"],见 settings-controls-table 的 tocMode 条目)——
 * 隐藏不动选中态,故 toc 重新打开时恢复上次选择(与分档灰禁同理由)。
 * 走 .hidden 工具类而非直接切 style.display:index.html 给该容器留了行内
 * `display: block`,而 .hidden 带 !important(见 base.css 注释),压得住它;
 * 反过来在 TS 里写 display 字面量等于把展示决策复制一份到逻辑层,违反
 * 「走 CSS 单一来源」。display:none 已把控件移出焦点序与无障碍树,无需 inert。
 * 回填与总开关切换共用本函数(单一来源)。
 */
export function syncTocModeVisibility(): void {
  tocModeRoot.classList.toggle("hidden", !tocInput.checked);
}

/**
 * 水印总闸 → 四个水印字段的收起:「文字」档展开、其余(含非法值)整块收起。
 * 走 .cond 的 show 态 + inert —— 收起时字段不可聚焦(键盘/焦点陷阱不落入不可见区)。
 * 🔴 **收起不重置值**:水印文字保留、切回「文字」档即恢复(同 tocMode 收起保留
 * 上次选择的取向 —— 若清空,等于在用户切档时丢掉他输入的水印文字)。
 * 回填与总闸切换共用本函数(单一来源)。
 */
export function syncWatermarkFieldVisibility(): void {
  const expanded = state.settings.watermark.mode === "text";
  watermarkFields.classList.toggle("show", expanded);
  watermarkFields.inert = !expanded;
}

/** 抽屉副标题文案合成(DOM 单源:模板 select 选中项 + 纸张 seg 选中值)。
 *  导出:声明表把它登记为「抽屉副标题合成」效果的实现落点,设置控件段逐条点名
 *  (同 syncPresetSelection 的理由:where 指向的必须是真实导出)。 */
export function composeDrawerMetaText(): string {
  const presetName = templatePresetSelect.selectedOptions[0]?.textContent ?? "";
  return `${presetName} · ${checkedRadioValue(paperInputs)}`;
}

/* 写回流水线的 DOM 触点在此交出:台账与写回逻辑在 settings-save.ts,本模块只提供
 * 「回填控件 / 落 main 权威值 / 刷抽屉副标题 / 状态区读写与判源」这几个触点。
 * 必须在模块初始化时注册 —— 向导(wizard/)直接调 settings-save 的 persistSettings,
 * 靠这份注册拿到与从前逐字一致的回填与失败反馈。 */
registerSettingsSaveHooks({
  applyControls: () => applySettingsToControls(),
  applyAuthoritative: (settings) => applyAuthoritativeSettings(settings),
  setError: (message) => setError(message),
  isStatusMine: (text) => statusEl.textContent === text,
  clearStatus: () => setStatus(""),
  refreshDrawerMeta: () => updateDrawerMeta(composeDrawerMetaText()),
});

/* 写回入口转出自 settings-save.ts:保持本模块既有导出面不变
 * (settings-bindings-* 与 settings-preset-actions 仍从此处取),而向导改从
 * settings-save.js 直取,不再经由本模块 —— 见 settings-save.ts 文件头「拆法」。
 * 本模块自身也用 persistSettings(下方四个分组写回),故是 import + export 两段:
 * 单纯 `export … from` 只再导出、不产生局部绑定。 */
export { persistSettings };

/* 整块写回(六组绑定共用)原先是 persistPageSetup / persistTypography /
 * persistHeaderFooter / persistWatermark 四个手写函数,现已由声明表的
 * bindControlGroup 按条目的顶层块统一产出 payload(键集与赋值同源),
 * 故此处不再留第二份「哪个块整块写回」的手写名单。 */

/* ---------- 预设选项重建 ---------- */
/* 纯逻辑(预设映射/名校验/上限判断/名称解析)收敛于 settings-logic.ts,
 * 弹窗显隐/焦点陷阱/保存删除/导入导出 DOM 交互归 settings-preset-actions.ts。 */

/** 重建下拉选项(双写):全部预设(硬编码 TEMPLATE_PRESETS + 自定义)统一由
 *  allPresets() 动态生成,HTML 不再写死;硬编码预设经 i18nKey + data-i18n 随语言本地化,
 *  自定义预设用 name。抽屉 #templatePreset 与快速参数条 #quickPreset 同步。 */
export function rebuildPresetOptions(): void {
  const presets = allPresets(state.settings.customPresets);
  for (const select of [templatePresetSelect, quickPresetSelect]) {
    const prev = select.value;
    select.innerHTML = "";
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      if (preset.i18nKey) {
        option.setAttribute("data-i18n", preset.i18nKey);
        option.textContent = t(preset.i18nKey as I18nKey);
      } else {
        option.textContent = preset.name;
      }
      if (preset.id.startsWith("custom:")) option.dataset.custom = "1";
      select.appendChild(option);
    }
    if (presets.some((p) => p.id === prev)) select.value = prev;
  }
}

/* ---------- PDF 样式 CSS 导入(main 内选文件 + 读内容,内容持久化到 settings.pdfCss) ---------- */
/** 导入 CSS 文件作为 PDF 样式模板:main 打开对话框 → 读文件(≤100KB)→ 持久化 pdfCss。
 *  成功后更新状态显示(文件名)并启用清除;取消无动作;失败状态区提示。 */
export async function importPdfCss(): Promise<void> {
  try {
    const r = await window.api.importPdfCss();
    if (!r.ok) {
      setError(t("settings.cssImportFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    state.settings.pdfCss = r.css;
    pdfCssTextInput.value = r.css; // 导入内容同步进文本域
    persistSettings({ pdfCss: r.css });
    syncPdfCssState(r.css, t("settings.cssImported", { name: r.name }));
    setStatus(t("settings.cssImportedStatus", { name: r.name }));
  } catch (err) {
    const message = errorMessage(err);
    setError(t("settings.cssImportFailed", { error: message }));
  }
}

/** 清除已导入的 PDF 样式 CSS:持久化空串 + 文本域/状态复位「未导入」+ 清除按钮禁用。 */
export function clearPdfCss(): void {
  state.settings.pdfCss = "";
  pdfCssTextInput.value = ""; // 文本域同步清空
  persistSettings({ pdfCss: "" });
  syncPdfCssState(""); // 状态行与清除按钮一并复位
}

/* ---------- docx 模板导入(字段级深导入;main 内选文件 + 解包提取 + 合并持久化全包) ---------- */

/**
 * 「未映射字段」的本地化标签表:键 = 稳定标识(单源在 core/docx/template-fields.ts),
 * 值 = i18n 键。
 *
 * 形态约束:值类型写成模板字面量 `template.unmapped.${...}` ⇒
 * ① 标识集新增成员而此处漏登记 ⇒ tsc 判红(Record 的键必须齐全);
 * ② 字典缺某个 `template.unmapped.*` 键 ⇒ t() 的入参类型不成立 ⇒ tsc 判红。
 * 两道都是编译期护栏,不靠人记。
 *
 * 分两张表:恒不映射六类(本仓能力边界)与事实性七类(本次模板的诊断)性质不同 ——
 * 前者渲染成**一句固定说明**,后者**逐条列**(ADR-086 实施约束四)。
 */
const ALWAYS_UNMAPPED_LABEL_KEYS: Record<
  AlwaysUnmappedTemplateField,
  `template.unmapped.${AlwaysUnmappedTemplateField}`
> = {
  color: "template.unmapped.color",
  themeColor: "template.unmapped.themeColor",
  numbering: "template.unmapped.numbering",
  settingsCompat: "template.unmapped.settingsCompat",
  characterStyle: "template.unmapped.characterStyle",
  latentStyles: "template.unmapped.latentStyles",
};

const FACTUAL_UNMAPPED_LABEL_KEYS: Record<
  FactualUnmappedTemplateField,
  `template.unmapped.${FactualUnmappedTemplateField}`
> = {
  bodySizeOutOfRange: "template.unmapped.bodySizeOutOfRange",
  lineSpacingRule: "template.unmapped.lineSpacingRule",
  lineSpacingOutOfRange: "template.unmapped.lineSpacingOutOfRange",
  alignUnsupported: "template.unmapped.alignUnsupported",
  headingScaleUndetermined: "template.unmapped.headingScaleUndetermined",
  headingSpacingUndetermined: "template.unmapped.headingSpacingUndetermined",
  paperUnrecognized: "template.unmapped.paperUnrecognized",
};

/** 未映射项之间的分隔符(中性符号,三语通用 —— 同 presetCoveredGroupLabels 的做法) */
const UNMAPPED_FIELD_SEPARATOR = " · ";

/**
 * 「本仓不接管」那句固定说明:恒不映射的六类(能力边界)折叠成**一行**,
 * **不**与本次模板的诊断项混列(混列会把一次性诊断读成常驻能力清单)。
 *
 * 顺序取自常量清单本身(单一事实源),文案名取自各标识的 i18n 键。
 */
function notManagedSummary(): string {
  const labels = ALWAYS_UNMAPPED_TEMPLATE_FIELDS.map((field) =>
    t(ALWAYS_UNMAPPED_LABEL_KEYS[field]),
  );
  return t("template.notManaged", { fields: labels.join(UNMAPPED_FIELD_SEPARATOR) });
}

/** 导入 Word 模板:main 打开对话框 → 解包提取排版/页面字段 →
 *  合并进 typography/pageSetup 并持久化。成功后刷新内存设置并回填控件;取消无动作;
 *  失败状态区提示(**失败态由 main 侧判别,这里不再猜** —— 整包解不开时界面只显示
 *  错误,绝不显示「已应用」)。
 *  两类「没吃下的东西」分开呈现(ADR-086 实施约束四):
 *  - 本仓恒不接管的六类 ⇒ 折叠成**一句固定说明**(不与本次诊断混列);
 *  - 本次模板判不出的项 ⇒ **逐条列**(警告态可换行,一行放不下),toast 只报事实性条数。 */
export async function importDocxTemplate(): Promise<void> {
  try {
    const r = await window.api.importDocxTemplate();
    if (!r.ok) {
      setError(t("template.readFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    try {
      const fresh = await window.api.settingsGet();
      state.settings.typography = fresh.typography;
      state.settings.pageSetup = fresh.pageSetup;
    } catch {
      /* 忽略:刷新失败时控件保持旧值,但设置已持久化 */
    }
    applySettingsToControls();
    if (r.unmapped.length === 0) {
      // 完全吃下:只报「已应用」(能力边界的固定说明只在有诊断时随附,免得每次都糊一长句)
      setStatus(t("template.imported"));
      return;
    }
    const labels = r.unmapped.map((field) => t(FACTUAL_UNMAPPED_LABEL_KEYS[field]));
    const diagnosis = t("template.importedPartial", {
      fields: labels.join(UNMAPPED_FIELD_SEPARATOR),
    });
    setStatus(`${diagnosis} ${notManagedSummary()}`, false, true);
    showToast(t("template.unmappedToast", { count: r.unmapped.length }));
  } catch (err) {
    const message = errorMessage(err);
    setError(t("template.readFailed", { error: message }));
  }
}

/* ---------- 转换完成弹窗提示(ui-state 字段,非 settings.json) ---------- */
/**
 * 同步「不再提示」checkbox 与内存态(控件仅存于完成弹窗内;设置面板侧控件已按
 * settings-ia.md 迁移映射表移除——场景被 afterConvert 覆盖;不持久化)。
 * 供启动恢复(initUiStateRestore)与 setSuppressCompleteDialog 共用。
 */
export function syncSuppressCompleteDialog(checked: boolean): void {
  state.suppressCompleteDialog = checked;
  completeDialogSuppressInput.checked = checked;
}

/** 更新并持久化「不再提示」(弹窗内 checkbox;与设置保存同一失败反馈口径:
 *  写失败保留勾选态、状态区提示保存失败并留痕,不静默显示成功;
 *  写回路径为 ui-state 而非 settings.json,故不进 pendingSavePatch 草稿队列)。 */
export function setSuppressCompleteDialog(checked: boolean): void {
  syncSuppressCompleteDialog(checked);
  void window.api.uiStateSet({ suppressCompleteDialog: checked }).catch((err: unknown) => {
    // 勾选态保留(本次会话行为一致),但下次启动会回到旧值:必须可见,不静默
    console.error("[settings] 完成弹窗偏好写盘失败(本次勾选仅存于内存)", err);
    setError(t("preset.saveFailed"));
  });
}

/* ---------- 设置抽屉 Tab 导航(6 组切换)+ 跨组检索(P2 · ADR-077) ---------- */

/** 竖向导航 tab 与右侧面板的选择器(两处配对读,组名是唯一键)。 */
const SETTINGS_TAB_SELECTOR = ".settings-tab";
const SETTINGS_PANEL_SELECTOR = ".settings-panels > .sec";

/** 取当前 tab 与面板集合(按 DOM 顺序;空集合下各调用点自行容忍)。 */
function collectSettingsTabs(): {
  tabs: HTMLButtonElement[];
  panels: HTMLElement[];
} {
  return {
    tabs: Array.from(document.querySelectorAll<HTMLButtonElement>(SETTINGS_TAB_SELECTOR)),
    panels: Array.from(document.querySelectorAll<HTMLElement>(SETTINGS_PANEL_SELECTOR)),
  };
}

/**
 * 激活某分组:显隐类名(几何驱动读 `.sec.active`)、`aria-selected`、roving tabindex
 * 三处同改 —— 三者说的是同一件事,分开写必然漂移。
 * `focus` 只在键盘导航时为真:点击与检索激活都不抢焦点(检索还要把焦点留在输入框,
 * 否则用户打下一个字就断了)。
 */
function activateSettingsGroup(
  tabs: readonly HTMLButtonElement[],
  panels: readonly HTMLElement[],
  group: string,
  focus: boolean,
): void {
  for (const tab of tabs) {
    const active = tab.dataset.group === group;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    // roving tabindex:整组只有当前项可 Tab 到达,其余移出焦点序
    tab.setAttribute("tabindex", active ? "0" : "-1");
    if (active && focus) tab.focus();
  }
  for (const panel of panels) {
    panel.classList.toggle("active", panel.dataset.group === group);
  }
}

/**
 * 竖向 tablist 的方向键导航:↑/↓ 环形移动,Home/End 跳首尾(ARIA 竖向 tablist 的必备
 * 键位)。采用「自动激活」—— 焦点到哪一组就切到哪一组,与点击行为一致。
 */
function onSettingsTabKeydown(
  event: KeyboardEvent,
  index: number,
  tabs: readonly HTMLButtonElement[],
  panels: readonly HTMLElement[],
): void {
  const last = tabs.length - 1;
  let next: number;
  switch (event.key) {
    case "ArrowUp":
      next = index === 0 ? last : index - 1;
      break;
    case "ArrowDown":
      next = index === last ? 0 : index + 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return;
  }
  event.preventDefault();
  const group = tabs[next]?.dataset.group;
  if (!group) return;
  activateSettingsGroup(tabs, panels, group, true);
}

/**
 * 一条可检索的控件行:本地化后的标签文案 + 命中后滚入视野的落点(二形态)。
 * radio 分段按组名取组内首个成员(成员 id 集合为空),其余按 id 取。
 */
interface SettingsSearchHit {
  readonly group: ControlGroup;
  readonly label: string;
  readonly elemId: string | null;
  readonly radioName: string | null;
}

/**
 * 可检索控件行的数据面:**只**取抽屉内(非 mirror)且有 `labelKey` 的条目,标签文案经
 * `t(labelKey)` 现算。不取描述行(`row-sub`)文案 —— 那需要第二份「控件 → 描述」映射,
 * 正是 ADR-077 否决的那一份;标签单源在声明表,这里不再另抄。
 */
function searchableSettingsRows(): SettingsSearchHit[] {
  return controlTable()
    .filter((row) => row.group !== "mirror" && row.labelKey !== null)
    .map((row) => ({
      group: row.group,
      label: t(row.labelKey as I18nKey),
      elemId: row.ids[0] ?? null,
      radioName: row.radioNames[0] ?? null,
    }));
}

/** 一次检索的结果:总命中数 + 首个命中行(供跳转)。 */
interface SettingsSearchOutcome {
  readonly total: number;
  readonly firstHit: SettingsSearchHit | null;
}

/**
 * 跨组检索的唯一读点:对六组全部控件标签做包含匹配(大小写不敏感)。三件事一处做完
 * —— 每 tab 命中计数、状态行文案、首个命中落点;语言切换(经 refreshDynamicSettingsText)
 * 与输入两条路径共用同一实现,故计数与文案不可能与查询漂移。
 *
 * **不隐藏任何控件**:几何规格只有两种可见性形态,本功能不入第三种,只做计数与跳转。
 */
function refreshSearchResults(): SettingsSearchOutcome {
  const query = settingsFilterInput?.value.trim().toLowerCase() ?? "";
  const tabs = document.querySelectorAll<HTMLButtonElement>(SETTINGS_TAB_SELECTOR);
  // 空查询:清空计数与状态行(CSS :empty 收掉两处占位),不切组、不滚动
  if (query === "") {
    for (const tab of tabs) {
      const countNode = tab.querySelector<HTMLElement>(".tab-count");
      if (countNode) countNode.textContent = "";
    }
    if (settingsFilterStatus) settingsFilterStatus.textContent = "";
    return { total: 0, firstHit: null };
  }
  const hitCounts = new Map<string, number>();
  let total = 0;
  let firstHit: SettingsSearchHit | null = null;
  for (const row of searchableSettingsRows()) {
    if (!row.label.toLowerCase().includes(query)) continue;
    hitCounts.set(row.group, (hitCounts.get(row.group) ?? 0) + 1);
    total += 1;
    firstHit ??= row;
  }
  for (const tab of tabs) {
    const group = tab.dataset.group;
    const countNode = tab.querySelector<HTMLElement>(".tab-count");
    if (!group || !countNode) continue;
    const count = hitCounts.get(group) ?? 0;
    countNode.textContent = count > 0 ? String(count) : "";
  }
  if (settingsFilterStatus) {
    settingsFilterStatus.textContent =
      total > 0
        ? t("settings.searchHits", { count: total })
        : t("settings.searchNoHits");
  }
  return { total, firstHit };
}

/** 首个命中控件的落点解析(radio 分段取组内首个成员,其余取 id 节点)。 */
function settingsSearchHitElement(hit: SettingsSearchHit): HTMLElement | null {
  if (hit.radioName) {
    return document.querySelector<HTMLElement>(`input[name="${hit.radioName}"]`);
  }
  return hit.elemId ? document.getElementById(hit.elemId) : null;
}

/**
 * 命中跳转:切到首个命中组并把该控件滚入视野。`scrollIntoView` 按能力探测调用
 * (测试 stub 不提供它,缺失时只切组不滚动,不抛错)。
 */
function jumpToFirstSearchHit(hit: SettingsSearchHit): void {
  const { tabs, panels } = collectSettingsTabs();
  activateSettingsGroup(tabs, panels, hit.group, false);
  const target = settingsSearchHitElement(hit);
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "nearest" });
  }
}

/**
 * 跨组检索接线:输入即算(计数 + 状态行 + 首个命中跳转)。导出供 initSettingsTabs 调用,
 * 也供测试直测 —— 与 Tab 导航各自可测。
 */
export function initSettingsSearch(): void {
  settingsFilterInput?.addEventListener("input", () => {
    const outcome = refreshSearchResults();
    if (outcome.firstHit) jumpToFirstSearchHit(outcome.firstHit);
  });
  // 初始算一次:清掉 HTML 里可能残留的占位(与「打开抽屉即见真实态」一致)
  refreshSearchResults();
}

/**
 * 绑定左侧竖向 tab 与右侧面板:点击切换 active 组,默认激活 preset。
 * 仅控制显隐与高亮,不触碰任何设置控件的 id/name(绑定逻辑零改动)。
 * P2 增补:`aria-selected` + roving tabindex + ↑/↓/Home/End 键盘导航,并接上跨组检索。
 */
export function initSettingsTabs(): void {
  const { tabs, panels } = collectSettingsTabs();
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      const group = tab.dataset.group;
      if (!group) return;
      activateSettingsGroup(tabs, panels, group, false);
    });
    tab.addEventListener("keydown", (event) => {
      onSettingsTabKeydown(event as KeyboardEvent, index, tabs, panels);
    });
  });
  initSettingsSearch();
}
