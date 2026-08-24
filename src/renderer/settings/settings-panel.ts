/**
 * renderer 设置面板(R10-5 自 renderer.ts 抽出,行为等价):
 * - 设置加载/回填/校验/钳制/预设套用/persist 三件套,以及预设弹窗与导入导出交互;
 *   全部设置控件的事件绑定见 settings-bindings.ts(B8 抽出,单向依赖本模块),
 *   契约与语义注释随代码搬移不精简
 * - 依赖方向遵循 R8 既定单向依赖:本模块 → core/settings-defaults(契约/常量/预设)、
 *   dom.ts(元素映射)、state.ts(共享状态单一来源);不反向引用 renderer.ts 的私有符号
 * - 组合根 renderer.ts 调用:init 处 bindSettingsEvents()(settings-bindings)后再
 *   loadSettings()(时序与拆分前一致:事件绑定先于回填;loadSettings 的 await 回填
 *   不受绑定顺序影响)
 */
import {
  DEFAULT_SETTINGS,
  TEMPLATE_PRESETS,
  type AppSettings,
  type PageSetup,
} from "../../core/settings/settings-defaults.js";
import {
  buildCustomPresetEntry,
  customPresetNameFromId,
  customPresetToTemplate,
  mergeSettingsWithDefaults,
  removeCustomPresetByName,
  resolvePresetHint,
  resolvePresetSelection,
  applyThemeOn,
  settingsToControlValues,
  validatePresetName,
} from "./settings-logic.js";
import {
  afterConvertInputs,
  alignJustifyInput,
  bodySizePtInput,
  breakBeforeH1Input,
  captionNumberingInput,
  completeDialogPromptInput,
   completeDialogSuppressInput,
   equationNumberingInput,
   firstLineIndentInput,
   fontAsciiInput,
   fontEastAsiaInput,
   formatInputs,
   getLanguageInputs,
   headingNumberingInput,
   languageOptionsEl,
  lineSpacingInput,
  marginInputs,
  orientationInputs,
  outputDirValue,
  paperSelect,
  pdfCssClearBtn,
  pdfCssStatus,
  presetDeleteBtn,
  presetNameInput,
  presetSaveBtn,
  presetSaveDialog,
   presetSaveError,
   templatePresetHint,
   templatePresetSelect,
   themeInputs,
   tocInput,
 } from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError, setStatus, trapFocus } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import { applyStaticTexts, setLanguage, t, LANGUAGES, type Language } from "../../core/i18n.js";

/* 另存为预设弹窗焦点陷阱句柄(批次 12:C9):打开时启用,关闭时解除 */
let presetSaveTrap: (() => void) | null = null;

/**
 * 外观主题应用到文档根元素(B13):显式 light/dark 设 data-theme,
 * system 移除属性(CSS @media prefers-color-scheme 接管)。
 * 契约计算在 settings-logic.applyThemeOn(纯函数,直测见 settings-logic 段),
 * 本包装只注入 document.documentElement。
 */
export function applyTheme(theme: AppSettings["theme"]): void {
  applyThemeOn(document.documentElement, theme);
}

/**
 * 语言镜像写 localStorage(B6 FOUC 缓解,最小方案):
 * 语言真源在 settings.json(经主进程),renderer 在语言设置/切换落定时镜像写入
 * localStorage("m2w.language");index.html <head> 的 lang-bootstrap.js 尽早读取该
 * 镜像设置 <html lang>(只消 lang/字体方向性闪烁,不做文案替换)。
 * 选型记录:未采用「body 初始 visibility:hidden」方案——CSP 为 script-src 'self'
 * 内联脚本被拦,且隐藏 body 若初始化失败会白屏;外部 bootstrap 脚本改动最小。
 */
export function mirrorLanguage(lang: Language): void {
  try {
    localStorage.setItem("m2w.language", lang);
  } catch {
    /* localStorage 不可用(隐私模式等)时静默:仅失去 FOUC 缓解,不影响功能 */
  }
}

/**
 * 重建界面语言选项(i18n 多语言改造):按 core/i18n LANGUAGES 注册表动态生成
 * radio 选项(label = 本地化自称,不再经字典 data-i18n),新增语言注册后自动出现。
 * 须在 bindSettingsEvents 绑定语言事件之前调用(输入为运行期生成,refs 走惰性查询)。
 */
export function rebuildLanguageOptions(): void {
  languageOptionsEl.replaceChildren();
  for (const { code, label } of LANGUAGES) {
    const labelEl = document.createElement("label");
    labelEl.className = "setting-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "language";
    input.value = code;
    // 生成期即按当前设置选中(hydration 前的空窗期也有选中项;回填以 applySettingsToControls 为准)
    input.checked = code === state.settings.language;
    const span = document.createElement("span");
    span.textContent = label;
    labelEl.append(input, span);
    languageOptionsEl.appendChild(labelEl);
  }
}

/* ---------- 设置:加载 / 回填 / 写回 ---------- */
/** 启动时读取持久化设置,失败静默回退默认值;回填后解除 hydration 标记。 */
export async function loadSettings(): Promise<void> {
  let loaded: AppSettings;
  try {
    loaded = await window.api.settingsGet();
  } catch {
    loaded = DEFAULT_SETTINGS;
  }
  // 防御性合并:旧版本设置缺字段时按默认值兜底(outputDir 缺省 = 源目录)
  state.settings = mergeSettingsWithDefaults(loaded);
  // i18n:主进程语言来源 = 持久化设置;启动即应用(静态文案 + 动态文案经 t() 自动跟随)
  setLanguage(state.settings.language);
  mirrorLanguage(state.settings.language); // B6:镜像写 localStorage 供 lang-bootstrap.js 尽早读
  applyStaticTexts();
  applyTheme(state.settings.theme); // B13:外观主题启动即应用(设/移除 data-theme)
  state.hydratingSettings = true;
  rebuildPresetOptions(); // 自定义预设选项先就位,再回填 select 值
  applySettingsToControls();
  state.hydratingSettings = false;
  state.selectedFormat = state.settings.format; // 转换格式与设置保持一致
}

/** 将内存设置回填到所有控件(仅赋值,不触发 change 事件)。
 *  值计算(设置 → 控件值映射/预设匹配/hint)在 settings-logic,本函数只做 DOM 赋值。 */
export function applySettingsToControls(): void {
  const v = settingsToControlValues(state.settings);
  paperSelect.value = v.paper;
  orientationInputs.forEach(
    (input) => (input.checked = input.value === v.orientation),
  );
  (
    Object.keys(marginInputs) as (keyof PageSetup & keyof typeof marginInputs)[]
  ).forEach((key) => {
    marginInputs[key].value = v.margins[key];
  });
  fontAsciiInput.value = v.fontAscii;
  fontEastAsiaInput.value = v.fontEastAsia;
  bodySizePtInput.value = v.bodySizePt;
  lineSpacingInput.value = v.lineSpacing;
  firstLineIndentInput.checked = v.firstLineIndent;
  alignJustifyInput.checked = v.alignJustify;
  headingNumberingInput.checked = v.headingNumbering;
  captionNumberingInput.checked = v.captionNumbering;
  // 模板预设:优先保持当前选中(值与设置一致时不弹回——自定义预设与硬编码预设
  // 值全等时不被 find 抢走),否则回退全局匹配;无匹配回退「默认」并提示已进入自定义模式
  const matchedPresetId = resolvePresetSelection(
    state.settings.customPresets,
    state.settings,
    templatePresetSelect.value,
  );
  templatePresetSelect.value = matchedPresetId;
  const { hint, isCustom } = resolvePresetHint(
    state.settings.customPresets,
    matchedPresetId,
  );
  templatePresetHint.textContent = hint;
  // 单行省略时完整文案经 title 悬浮可见(与 textContent 同步)
  templatePresetHint.title = hint;
  templatePresetHint.classList.toggle("template-hint--custom", isCustom);
  // 批次 11 迭代 3:仅自定义预设可删(选中项以 custom: 前缀标识)
  presetDeleteBtn.classList.toggle(
    "hidden",
    !templatePresetSelect.value.startsWith("custom:"),
  );
  breakBeforeH1Input.checked = v.breakBeforeH1;
  tocInput.checked = v.toc;
  equationNumberingInput.checked = v.equationNumbering;
  afterConvertInputs.forEach(
    (input) => (input.checked = input.value === v.afterConvert),
  );
  formatInputs.forEach(
    (input) => (input.checked = input.value === v.format),
  );
  // i18n:界面语言 radio 回填(选项由 LANGUAGES 动态生成,经惰性查询获取)
  getLanguageInputs().forEach(
    (input) => (input.checked = input.value === v.language),
  );
  // B13:外观主题 radio 回填(system/light/dark)
  themeInputs.forEach(
    (input) => (input.checked = input.value === v.theme),
  );
  // 输出目录:空串显示「与源文件相同目录」
  outputDirValue.textContent = v.outputDirText;
  outputDirValue.title = v.outputDirText;
  // 批次 16:PDF 样式 CSS 回显(settings.json 只存内容不存文件名,显示通用文案;
  // 非空 → 「已导入自定义 CSS」+ 清除按钮可用)
  pdfCssStatus.textContent = state.settings.pdfCss
    ? t("settings.pdfCssImported")
    : t("settings.pdfCssNone");
  pdfCssClearBtn.classList.toggle("hidden", !state.settings.pdfCss);
}

/** 写回设置;失败静默(下次交互仍以磁盘为准),不打断用户操作。
 *  批次 11 迭代 3:写盘成功后刷新所有预览窗口(设置变更即时反映到预览)。 */
export function persistSettings(patch: Partial<AppSettings>): void {
  void window.api
    .settingsSet(patch)
    .then(() => window.api.previewRefresh())
    .catch(() => {
      /* 忽略:设置写入失败不阻塞主流程 */
    });
}

/* ---------- 自定义模板预设(批次 11 迭代 3;F 模板另存为预设) ---------- */
/* 纯逻辑(预设映射/名校验/上限判断/名称解析/边距钳制)收敛于 settings-logic.ts,
 * 本模块只保留 DOM 交互(弹窗显隐/焦点陷阱/错误提示/持久化调用)。 */

/** 重建下拉选项:硬编码 3 项保留(HTML 静态),仅重刷自定义项(按 data-custom 标记)。 */
function rebuildPresetOptions(): void {
  templatePresetSelect
    .querySelectorAll("option[data-custom]")
    .forEach((option) => option.remove());
  for (const preset of state.settings.customPresets.map(customPresetToTemplate)) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    option.dataset.custom = "1";
    templatePresetSelect.appendChild(option);
  }
}

/** 另存为预设弹窗:打开(清空输入与错误,焦点进输入框)。 */
export function openPresetSaveDialog(): void {
  presetNameInput.value = "";
  presetSaveError.classList.add("hidden");
  presetSaveError.textContent = "";
  presetSaveDialog.classList.remove("hidden");
  presetNameInput.focus();
  // 批次 12(C9):Tab 循环不逃逸到背景页。B8 卫生项:二次调用防御——先解除
  // 旧陷阱再启用新陷阱,避免重复 open 时旧 keydown 监听句柄被覆盖而泄漏。
  presetSaveTrap?.();
  presetSaveTrap = trapFocus(presetSaveDialog);
}

/** 关闭另存为预设弹窗(导出:renderer Esc 分支与弹窗内按钮共用,统一解除焦点陷阱)。 */
export function closePresetSaveDialog(): void {
  presetSaveTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  presetSaveTrap = null;
  presetSaveDialog.classList.add("hidden");
  presetSaveBtn.focus(); // 焦点还给触发按钮,便于键盘继续操作
}

function showPresetSaveError(message: string): void {
  presetSaveError.textContent = message;
  presetSaveError.classList.remove("hidden");
}

/** 保存当前排版+页面设置为自定义预设(名称非空、同名拒绝;成功后下拉选中新预设)。 */
export async function saveCustomPreset(): Promise<void> {
  const name = presetNameInput.value.trim();
  // 批次 12(C6):达上限不再静默截断,弹窗内明确提示先删除(校验逻辑在 settings-logic)
  const error = validatePresetName(name, state.settings.customPresets);
  if (error) {
    showPresetSaveError(error);
    return;
  }
  const entry = buildCustomPresetEntry(name, state.settings);
  const next = [...state.settings.customPresets, entry];
  try {
    const saved = await window.api.settingsSet({ customPresets: next });
    state.settings.customPresets = saved.customPresets;
    closePresetSaveDialog();
    rebuildPresetOptions();
    // 显式选中新预设(值=当前设置,resolvePresetSelection 保持选中,不被硬编码项弹回)
    templatePresetSelect.value = customPresetToTemplate(entry).id;
    applySettingsToControls(); // 当前设置即新预设 → 自动选中并显示其 hint
  } catch {
    showPresetSaveError(t("preset.saveFailed"));
  }
}

/** 删除当前选中的自定义预设;删除后回退「默认」预设(整体套用并持久化)。 */
export function deleteCustomPreset(): void {
  const name = customPresetNameFromId(templatePresetSelect.value);
  if (!name) return;
  const next = removeCustomPresetByName(state.settings.customPresets, name);
  void window.api
    .settingsSet({ customPresets: next })
    .then((saved) => {
      state.settings.customPresets = saved.customPresets;
      rebuildPresetOptions();
      // 回退「默认」:与下拉选中 default 行为一致(整体套用 + 回填 + 持久化)
      const preset = TEMPLATE_PRESETS.find((p) => p.id === "default");
      if (!preset) return;
      state.settings.typography = { ...preset.typography };
      state.settings.pageSetup = { ...preset.pageSetup };
      state.hydratingSettings = true;
      applySettingsToControls();
      state.hydratingSettings = false;
      persistSettings({
        typography: { ...state.settings.typography },
        pageSetup: { ...state.settings.pageSetup },
      });
    })
    .catch(() => setError(t("preset.deleteFailed")));
}

/* ---------- 模板预设导入/导出(批次 13;main 内选文件 + 合并/导出 + 持久化全包) ---------- */
/** 导入自定义预设 JSON:main 打开对话框 → 读文件 → 与现有合并(同名覆盖,上限 10)→ 持久化。
 *  成功后同步最新列表并重刷下拉;取消无动作;失败状态区提示。 */
export async function importCustomPresets(): Promise<void> {
  try {
    const r = await window.api.importPresets();
    if (!r.ok) {
      setError(t("preset.importFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    // 合并结果已在 main 持久化,这里只同步内存列表供下拉重刷(失败静默,反馈不受影响)
    try {
      const fresh = await window.api.settingsGet();
      state.settings.customPresets = fresh.customPresets;
    } catch {
      /* 忽略:列表刷新失败时下拉保持旧数据 */
    }
    rebuildPresetOptions();
    applySettingsToControls(); // 重刷后按 matchesPreset 重算 select/hint,不强制切换选中项
    setStatus(
      r.overridden > 0
        ? t("preset.importedOverridden", {
            imported: r.imported,
            overridden: r.overridden,
          })
        : t("preset.imported", { count: r.imported }),
    );
  } catch (err) {
    const message = errorMessage(err);
    setError(t("preset.importFailed", { error: message }));
  }
}

/** 导出全部自定义预设为 JSON 文件;成功时反馈数量,取消无动作。 */
export async function exportCustomPresets(): Promise<void> {
  try {
    const r = await window.api.exportPresets();
    if (!r.ok) {
      setError(t("preset.exportFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    setStatus(t("preset.exported", { count: r.count }));
  } catch (err) {
    const message = errorMessage(err);
    setError(t("preset.exportFailed", { error: message }));
  }
}

/* ---------- PDF 样式 CSS 导入(批次 16;main 内选文件 + 读内容,内容持久化到 settings.pdfCss) ---------- */
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
    persistSettings({ pdfCss: r.css });
    pdfCssStatus.textContent = t("settings.cssImported", { name: r.name });
    pdfCssClearBtn.classList.remove("hidden");
    setStatus(t("settings.cssImportedStatus", { name: r.name }));
  } catch (err) {
    const message = errorMessage(err);
    setError(t("settings.cssImportFailed", { error: message }));
  }
}

/** 清除已导入的 PDF 样式 CSS:持久化空串 + 状态复位「未导入」+ 清除按钮禁用。 */
export function clearPdfCss(): void {
  state.settings.pdfCss = "";
  persistSettings({ pdfCss: "" });
  pdfCssStatus.textContent = t("settings.pdfCssNone");
  pdfCssClearBtn.classList.add("hidden");
}

/* ---------- 转换完成弹窗提示(批次 11 迭代 2;ui-state 字段,非 settings.json) ---------- */
/**
 * 同步「转换完成弹窗提示」两处 checkbox 与内存态(设置面板 + 弹窗内;不持久化)。
 * 供启动恢复(initUiStateRestore)与 setSuppressCompleteDialog 共用。
 */
export function syncSuppressCompleteDialog(checked: boolean): void {
  state.suppressCompleteDialog = checked;
  completeDialogSuppressInput.checked = checked;
  // 设置面板 checkbox 语义为「提示弹窗」(勾选 = 提示 = suppress=false),与 suppress 相反
  completeDialogPromptInput.checked = !checked;
}

/** 更新并持久化「转换完成弹窗提示」(两处 checkbox 双向同步同一字段;写入失败静默)。 */
export function setSuppressCompleteDialog(checked: boolean): void {
  syncSuppressCompleteDialog(checked);
  void window.api.uiStateSet({ suppressCompleteDialog: checked }).catch(() => {
    /* 忽略:UI 状态写入失败不阻塞主流程 */
  });
}
