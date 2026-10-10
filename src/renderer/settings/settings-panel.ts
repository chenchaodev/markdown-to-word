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
  hydrateControls,
  type ControlDom,
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
  statusEl,
  templatePresetHint,
  templatePresetSelect,
  tocInput,
  tocModeSelect,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError, setStatus } from "../dom/dom-ops.js";
import { errorMessage } from "../state/pure.js";
import { applyStaticTexts, setLanguage, t, LANGUAGES, type I18nKey, type Language } from "../../core/i18n/index.js";
// 抽屉副标题文案写入归抽屉模块(本模块只负责由设置值合成文案)
import { updateDrawerMeta } from "./settings-drawer.js";

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
  for (const syncGate of Object.values(GATE_SYNCERS)) syncGate();
  refreshDynamicSettingsText();
  updateDrawerMeta(composeDrawerMetaText());
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
  const { hint, isCustom } = resolvePresetHint(
    state.settings.customPresets,
    matchedPresetId,
  );
  templatePresetHint.textContent = hint;
  // 单行省略时完整文案经 title 悬浮可见(与 textContent 同步)
  templatePresetHint.title = hint;
  templatePresetHint.classList.toggle("template-hint--custom", isCustom);
  // 三处动态展示位取各自声明条目的读侧(键路径单源在声明表,不在这里重述)
  syncOutputDirDisplay(CONTROL_ENTRIES.outputDir.read(state.settings));
  syncPdfCssState(CONTROL_ENTRIES.pdfCss.read(state.settings));
  syncHeaderLogoDisplay(CONTROL_ENTRIES.headerLogoPath.read(state.settings));
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
 * 目录模式下拉的显隐:仅 toc 开启时可见(设置抽屉 04 组),关闭时**整块移除**
 * 而非灰禁 —— 模式不满足就摆一个可点的下拉,用户能选一个不会生效的模式。
 * 走 .hidden 工具类而非直接切 style.display:index.html 给该 select 留了行内
 * `display: block`,而 .hidden 带 !important(见 base.css 注释),压得住它;
 * 反过来在 TS 里写 display 字面量等于把展示决策复制一份到逻辑层,违反
 * 「走 CSS 单一来源」。display:none 已把控件移出焦点序与无障碍树,无需 inert。
 * 隐藏不动 select.value —— toc 重新打开时恢复上次选择(与分档灰禁同理由)。
 * 回填与总开关切换共用本函数(单一来源)。
 */
export function syncTocModeVisibility(): void {
  tocModeSelect.classList.toggle("hidden", !tocInput.checked);
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

/* ---------- docx 模板导入(浅导入 v1;main 内选文件 + 解包提取 + 合并持久化全包) ---------- */
/** 导入 Word 模板:main 打开对话框 → 解包提取 Normal/Heading1 样式与 sectPr →
 *  合并进 typography/pageSetup 并持久化。成功后刷新内存设置并回填控件;取消无动作;
 *  失败状态区提示。v1 浅导入:仅字体/字号/页面尺寸边距,颜色等深导入留后续。 */
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
    setStatus(t("template.imported"));
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

/* ---------- 设置抽屉 Tab 导航(6 组切换) ---------- */
/** 绑定左侧竖向 tab 与右侧面板:点击切换 active 组,默认激活 preset。
 *  仅控制显隐与高亮,不触碰任何设置控件的 id/name(绑定逻辑零改动)。 */
export function initSettingsTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".settings-tab");
  const panels = document.querySelectorAll<HTMLElement>(".settings-panels > .sec");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const group = tab.dataset.group;
      if (!group) return;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) =>
        p.classList.toggle("active", p.dataset.group === group),
      );
    });
  });
}
