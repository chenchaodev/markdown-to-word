/**
 * renderer 设置面板(R10-5 自 renderer.ts 抽出,行为等价):
 * - 设置加载/回填/校验/钳制/预设套用/persist 三件套,以及全部设置控件的事件绑定
 *   (格式 / 页面设置 / 排版 / 模板预设 / 输出目录),契约与语义注释随代码搬移不精简
 * - 依赖方向遵循 R8 既定单向依赖:本模块 → core/settings-defaults(契约/常量/预设)、
 *   dom.ts(元素映射)、state.ts(共享状态单一来源)、utils.ts(字段错误提示);
 *   不反向引用 renderer.ts 的私有符号(所需类型 Paper/Orientation/AfterConvert/BodyAlign
 *   随拆分移入本模块)
 * - 组合根 renderer.ts 只调用:init 处 bindSettingsEvents() 后再 loadSettings()
 *   (时序与拆分前一致:事件绑定先于回填;loadSettings 的 await 回填不受绑定顺序影响)
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  DEFAULT_SETTINGS,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM as MARGIN_MAX,
  TEMPLATE_PRESETS,
  type AppSettings,
  type PageSetup,
} from "../core/settings-defaults.js";
import {
  allPresets,
  buildCustomPresetEntry,
  customPresetNameFromId,
  customPresetToTemplate,
  mergeSettingsWithDefaults,
  outputDirDisplayText,
  parseMarginValue,
  removeCustomPresetByName,
  resolvePresetHint,
  resolvePresetSelection,
  settingsToControlValues,
  validateNumberRange,
  validatePresetName,
} from "./settings-logic.js";
import {
  afterConvertInputs,
  alignJustifyInput,
  bodySizeError,
  bodySizePtInput,
  breakBeforeH1Input,
  captionNumberingInput,
  completeDialogPromptInput,
  completeDialogSuppressInput,
  equationNumberingInput,
  firstLineIndentInput,
  fontAsciiError,
  fontAsciiInput,
  fontEastAsiaError,
  fontEastAsiaInput,
  formatInputs,
  headingNumberingInput,
  lineSpacingError,
  lineSpacingInput,
  marginError,
  marginInputs,
  orientationInputs,
  outputDirPick,
  outputDirReset,
  outputDirValue,
  paperSelect,
  pdfCssClearBtn,
  pdfCssImportBtn,
  pdfCssStatus,
  presetDeleteBtn,
  presetExportBtn,
  presetImportBtn,
  presetNameInput,
  presetSaveBtn,
  presetSaveCancel,
  presetSaveDialog,
  presetSaveError,
  presetSaveOk,
  templatePresetHint,
  templatePresetSelect,
  tocInput,
} from "./dom.js";
import { state } from "./state.js";
import { hideFieldError, setError, setStatus, showFieldError, trapFocus } from "./utils.js";

/* 另存为预设弹窗焦点陷阱句柄(批次 12:C9):打开时启用,关闭时解除 */
let presetSaveTrap: (() => void) | null = null;

/* ---------- 设置类型(契约收敛于 core/settings-defaults.ts) ---------- */
type Paper = "A4" | "A3" | "A5" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";
type AfterConvert = "none" | "show-in-folder" | "open";

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
  state.hydratingSettings = true;
  rebuildPresetOptions(); // 自定义预设选项先就位,再回填 select 值
  applySettingsToControls();
  state.hydratingSettings = false;
  state.selectedFormat = state.settings.format; // 转换格式与设置保持一致
}

/** 将内存设置回填到所有控件(仅赋值,不触发 change 事件)。
 *  值计算(设置 → 控件值映射/预设匹配/hint)在 settings-logic,本函数只做 DOM 赋值。 */
function applySettingsToControls(): void {
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
  // 输出目录:空串显示「与源文件相同目录」
  outputDirValue.textContent = v.outputDirText;
  outputDirValue.title = v.outputDirText;
  // 批次 16:PDF 样式 CSS 回显(settings.json 只存内容不存文件名,显示通用文案;
  // 非空 → 「已导入自定义 CSS」+ 清除按钮可用)
  pdfCssStatus.textContent = state.settings.pdfCss ? "已导入自定义 CSS" : "未导入";
  pdfCssClearBtn.classList.toggle("hidden", !state.settings.pdfCss);
}

/** 写回设置;失败静默(下次交互仍以磁盘为准),不打断用户操作。
 *  批次 11 迭代 3:写盘成功后刷新所有预览窗口(设置变更即时反映到预览)。 */
function persistSettings(patch: Partial<AppSettings>): void {
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
function openPresetSaveDialog(): void {
  presetNameInput.value = "";
  presetSaveError.classList.add("hidden");
  presetSaveError.textContent = "";
  presetSaveDialog.classList.remove("hidden");
  presetNameInput.focus();
  presetSaveTrap = trapFocus(presetSaveDialog); // 批次 12(C9):Tab 循环不逃逸到背景页
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
async function saveCustomPreset(): Promise<void> {
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
    showPresetSaveError("保存失败,请重试");
  }
}

/** 删除当前选中的自定义预设;删除后回退「默认」预设(整体套用并持久化)。 */
function deleteCustomPreset(): void {
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
    .catch(() => setError("删除预设失败,请重试"));
}

/* ---------- 模板预设导入/导出(批次 13;main 内选文件 + 合并/导出 + 持久化全包) ---------- */
/** 导入自定义预设 JSON:main 打开对话框 → 读文件 → 与现有合并(同名覆盖,上限 10)→ 持久化。
 *  成功后同步最新列表并重刷下拉;取消无动作;失败状态区提示。 */
async function importCustomPresets(): Promise<void> {
  try {
    const r = await window.api.importPresets();
    if (!r.ok) {
      setError(`导入预设失败:${r.error}`);
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
        ? `已导入 ${r.imported} 个预设(覆盖 ${r.overridden} 个同名)`
        : `已导入 ${r.imported} 个预设`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`导入预设失败:${message}`);
  }
}

/** 导出全部自定义预设为 JSON 文件;成功时反馈数量,取消无动作。 */
async function exportCustomPresets(): Promise<void> {
  try {
    const r = await window.api.exportPresets();
    if (!r.ok) {
      setError(`导出预设失败:${r.error}`);
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    setStatus(`已导出 ${r.count} 个预设`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`导出预设失败:${message}`);
  }
}

/* ---------- PDF 样式 CSS 导入(批次 16;main 内选文件 + 读内容,内容持久化到 settings.pdfCss) ---------- */
/** 导入 CSS 文件作为 PDF 样式模板:main 打开对话框 → 读文件(≤100KB)→ 持久化 pdfCss。
 *  成功后更新状态显示(文件名)并启用清除;取消无动作;失败状态区提示。 */
async function importPdfCss(): Promise<void> {
  try {
    const r = await window.api.importPdfCss();
    if (!r.ok) {
      setError(`导入 CSS 失败:${r.error}`);
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    state.settings.pdfCss = r.css;
    persistSettings({ pdfCss: r.css });
    pdfCssStatus.textContent = `已导入: ${r.name}`;
    pdfCssClearBtn.classList.remove("hidden");
    setStatus(`已导入 PDF 样式:${r.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`导入 CSS 失败:${message}`);
  }
}

/** 清除已导入的 PDF 样式 CSS:持久化空串 + 状态复位「未导入」+ 清除按钮禁用。 */
function clearPdfCss(): void {
  state.settings.pdfCss = "";
  persistSettings({ pdfCss: "" });
  pdfCssStatus.textContent = "未导入";
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

/** 页面尺寸相关字段(纸张/方向/边距)整体写回。 */
function persistPageSetup(): void {
  persistSettings({ pageSetup: { ...state.settings.pageSetup } });
}

/** 排版相关字段(字体/字号/行距/段落样式)整体写回。 */
function persistTypography(): void {
  persistSettings({ typography: { ...state.settings.typography } });
}

/** 边距输入:非法值回显当前设置,合法值钳制后写回;非法时字段内提示。 */
function handleMarginChange(key: keyof typeof marginInputs): void {
  if (state.hydratingSettings) return;
  const input = marginInputs[key];
  const clamped = parseMarginValue(input.valueAsNumber);
  if (clamped === null) {
    input.value = String(state.settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    showFieldError(marginError, `请输入 0–${MARGIN_MAX} 之间的数字`);
    return;
  }
  state.settings.pageSetup[key] = clamped;
  input.value = String(clamped); // 回显钳制后的值,与主进程持久化结果一致
  hideFieldError(marginError);
  persistPageSetup();
}

/** 字号 / 行距输入:空、非数字或超出范围时回显当前设置值,并字段内提示。 */
function handleTypographyNumberChange(
  key: "bodySizePt" | "lineSpacing",
  min: number,
  max: number,
): void {
  if (state.hydratingSettings) return;
  const input = key === "bodySizePt" ? bodySizePtInput : lineSpacingInput;
  const errorEl = key === "bodySizePt" ? bodySizeError : lineSpacingError;
  const value = input.valueAsNumber;
  if (!validateNumberRange(value, min, max)) {
    input.value = String(state.settings.typography[key]); // 空/非法/超范围:恢复为当前设置值
    showFieldError(errorEl, `请输入 ${min}–${max} 之间的数字`);
    return;
  }
  state.settings.typography[key] = value;
  hideFieldError(errorEl);
  persistTypography();
}

/* ---------- 设置事件绑定(组合根 init 处调用;任一控件变更即时生效并持久化) ---------- */
export function bindSettingsEvents(): void {
  // 格式选择:记录当前选中格式(转换时使用),并持久化到设置
  formatInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.selectedFormat = input.value as "docx" | "pdf";
      state.settings.format = state.selectedFormat;
      persistSettings({ format: state.selectedFormat });
    });
  });

  /* ---------- 页面设置面板:任一控件变更即时生效并持久化 ---------- */
  paperSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.pageSetup.paper = paperSelect.value as Paper;
    persistPageSetup();
  });

  orientationInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.pageSetup.orientation = input.value as Orientation;
      persistPageSetup();
    });
  });

  breakBeforeH1Input.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.breakBeforeH1 = breakBeforeH1Input.checked;
    persistSettings({ breakBeforeH1: state.settings.breakBeforeH1 });
  });

  tocInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.toc = tocInput.checked;
    persistSettings({ toc: state.settings.toc });
  });

  equationNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.equationNumbering = equationNumberingInput.checked;
    persistSettings({ equationNumbering: state.settings.equationNumbering });
  });

  afterConvertInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.afterConvert = input.value as AfterConvert;
      persistSettings({ afterConvert: state.settings.afterConvert });
    });
  });

  (Object.keys(marginInputs) as (keyof typeof marginInputs)[]).forEach((key) => {
    marginInputs[key].addEventListener("change", () => handleMarginChange(key));
  });

  /* ---------- 排版设置面板:任一控件变更即时生效并持久化 ---------- */
  fontAsciiInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const value = fontAsciiInput.value.trim();
    if (!value) {
      fontAsciiInput.value = state.settings.typography.fontAscii; // 空输入:恢复为当前设置值
      showFieldError(fontAsciiError, "西文字体不能为空,已恢复原值");
      return;
    }
    state.settings.typography.fontAscii = value;
    hideFieldError(fontAsciiError);
    persistTypography();
  });

  fontEastAsiaInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const value = fontEastAsiaInput.value.trim();
    if (!value) {
      fontEastAsiaInput.value = state.settings.typography.fontEastAsia; // 空输入:恢复为当前设置值
      showFieldError(fontEastAsiaError, "中文字体不能为空,已恢复原值");
      return;
    }
    state.settings.typography.fontEastAsia = value;
    hideFieldError(fontEastAsiaError);
    persistTypography();
  });

  bodySizePtInput.addEventListener("change", () =>
    handleTypographyNumberChange("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX),
  );

  lineSpacingInput.addEventListener("change", () =>
    handleTypographyNumberChange("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX),
  );

  firstLineIndentInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.firstLineIndent = firstLineIndentInput.checked;
    persistTypography();
  });

  alignJustifyInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.align = alignJustifyInput.checked
      ? "justify"
      : "left";
    persistTypography();
  });

  headingNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.headingNumbering = headingNumberingInput.checked;
    persistTypography();
  });

  captionNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.captionNumbering = captionNumberingInput.checked;
    persistTypography();
  });

  // 模板预设:整体套用排版与页面设置,一次性回填所有相关控件并持久化
  // (批次 11 迭代 3:硬编码 + 自定义预设统一走此路径)
  templatePresetSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const preset = allPresets(state.settings.customPresets).find(
      (p) => p.id === templatePresetSelect.value,
    );
    if (!preset) return;
    state.settings.typography = { ...preset.typography };
    state.settings.pageSetup = { ...preset.pageSetup };
    // hydration 保护下统一回填,避免逐个控件触发 change 写回;
    // 回填同时按匹配结果同步 select 与 hint(当前即所选预设)
    state.hydratingSettings = true;
    applySettingsToControls();
    state.hydratingSettings = false;
    persistSettings({
      typography: { ...state.settings.typography },
      pageSetup: { ...state.settings.pageSetup },
    });
  });

  // 批次 11 迭代 3:另存为预设(弹窗输入名称 → 保存当前排版+页面设置)
  presetSaveBtn.addEventListener("click", openPresetSaveDialog);
  presetSaveCancel.addEventListener("click", closePresetSaveDialog);
  presetSaveOk.addEventListener("click", () => void saveCustomPreset());
  presetNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCustomPreset();
    }
  });
  presetSaveDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === presetSaveDialog) closePresetSaveDialog();
  });
  // 仅自定义预设可删;删除后回退「默认」
  presetDeleteBtn.addEventListener("click", deleteCustomPreset);
  // 批次 13:预设 JSON 导入 / 导出(IIFE + void,规避 no-misused-promises)
  presetImportBtn.addEventListener("click", () => void importCustomPresets());
  presetExportBtn.addEventListener("click", () => void exportCustomPresets());
  // 批次 16:PDF 样式 CSS 导入 / 清除(IIFE + void,规避 no-misused-promises)
  pdfCssImportBtn.addEventListener("click", () => void importPdfCss());
  pdfCssClearBtn.addEventListener("click", clearPdfCss);

  // 批次 7:输出目录选择 / 恢复默认(空串 = 与源文件相同目录)
  outputDirPick.addEventListener("click", () => {
    void (async () => {
    try {
      const dir = await window.api.selectDir();
      if (!dir) return; // 用户取消
      state.settings.outputDir = dir;
      outputDirValue.textContent = dir;
      outputDirValue.title = dir;
      persistSettings({ outputDir: dir });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`选择输出目录失败:${message}`);
    }
    })();
  });

  outputDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    outputDirValue.textContent = outputDirDisplayText("");
    outputDirValue.title = outputDirDisplayText("");
    persistSettings({ outputDir: "" });
  });

  // 批次 11 迭代 2:转换完成弹窗提示(ui-state 字段;与弹窗内「不再提示」双向同步)
  // 勾选 = 提示弹窗 = suppress=false,故取反后写入
  completeDialogPromptInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    setSuppressCompleteDialog(!completeDialogPromptInput.checked);
  });
}
