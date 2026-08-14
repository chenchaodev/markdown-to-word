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
  MARGIN_MIN_MM as MARGIN_MIN,
  TEMPLATE_PRESETS,
  type AppSettings,
  type PageSetup,
  matchesPreset,
} from "../core/settings-defaults.js";
import {
  afterConvertInputs,
  alignJustifyInput,
  bodySizeError,
  bodySizePtInput,
  breakBeforeH1Input,
  captionNumberingInput,
  completeDialogPromptInput,
  completeDialogSuppressInput,
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
  templatePresetHint,
  templatePresetSelect,
  tocInput,
} from "./dom.js";
import { state } from "./state.js";
import { hideFieldError, setError, showFieldError } from "./utils.js";

/* ---------- 设置类型(契约收敛于 core/settings-defaults.ts) ---------- */
type Paper = "A4" | "A3" | "A5" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";
type AfterConvert = "none" | "show-in-folder" | "open";
type BodyAlign = "left" | "justify";

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
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...loaded,
    outputDir: loaded.outputDir ?? DEFAULT_SETTINGS.outputDir,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, ...loaded.pageSetup },
    typography: { ...DEFAULT_SETTINGS.typography, ...loaded.typography },
  };
  state.hydratingSettings = true;
  applySettingsToControls();
  state.hydratingSettings = false;
  state.selectedFormat = state.settings.format; // 转换格式与设置保持一致
}

/** 将内存设置回填到所有控件(仅赋值,不触发 change 事件)。 */
function applySettingsToControls(): void {
  paperSelect.value = state.settings.pageSetup.paper;
  orientationInputs.forEach(
    (input) =>
      (input.checked = input.value === state.settings.pageSetup.orientation),
  );
  (
    Object.keys(marginInputs) as (keyof PageSetup & keyof typeof marginInputs)[]
  ).forEach((key) => {
    marginInputs[key].value = String(state.settings.pageSetup[key]);
  });
  fontAsciiInput.value = state.settings.typography.fontAscii;
  fontEastAsiaInput.value = state.settings.typography.fontEastAsia;
  bodySizePtInput.value = String(state.settings.typography.bodySizePt);
  lineSpacingInput.value = String(state.settings.typography.lineSpacing);
  firstLineIndentInput.checked = state.settings.typography.firstLineIndent;
  alignJustifyInput.checked = state.settings.typography.align === "justify";
  headingNumberingInput.checked = state.settings.typography.headingNumbering;
  captionNumberingInput.checked = state.settings.typography.captionNumbering;
  // 模板预设:与某预设完全一致时选中,否则回退「默认」并提示已进入自定义模式
  const matchedPreset = TEMPLATE_PRESETS.find((preset) =>
    matchesPreset(preset, state.settings),
  );
  templatePresetSelect.value = matchedPreset?.id ?? "default";
  const isCustom = !matchedPreset;
  templatePresetHint.textContent = isCustom
    ? "已微调,与模板预设不一致"
    : (matchedPreset ?? TEMPLATE_PRESETS[0]).hint;
  templatePresetHint.classList.toggle("template-hint--custom", isCustom);
  breakBeforeH1Input.checked = state.settings.breakBeforeH1;
  tocInput.checked = state.settings.toc;
  afterConvertInputs.forEach(
    (input) => (input.checked = input.value === state.settings.afterConvert),
  );
  formatInputs.forEach(
    (input) => (input.checked = input.value === state.settings.format),
  );
  // 输出目录:空串显示「源文件所在目录」
  outputDirValue.textContent = state.settings.outputDir || "源文件所在目录";
  outputDirValue.title = state.settings.outputDir || "源文件所在目录";
}

/** 写回设置;失败静默(下次交互仍以磁盘为准),不打断用户操作。 */
function persistSettings(patch: Partial<AppSettings>): void {
  void window.api.settingsSet(patch).catch(() => {
    /* 忽略:设置写入失败不阻塞主流程 */
  });
}

/* ---------- 转换完成弹窗提示(批次 11 迭代 2;ui-state 字段,非 settings.json) ---------- */
/**
 * 同步「转换完成弹窗提示」两处 checkbox 与内存态(设置面板 + 弹窗内;不持久化)。
 * 供启动恢复(initUiStateRestore)与 setSuppressCompleteDialog 共用。
 */
export function syncSuppressCompleteDialog(checked: boolean): void {
  state.suppressCompleteDialog = checked;
  completeDialogSuppressInput.checked = checked;
  completeDialogPromptInput.checked = checked;
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
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    input.value = String(state.settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    showFieldError(marginError, `请输入 0–${MARGIN_MAX} 之间的数字`);
    return;
  }
  const clamped = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, value));
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
  if (!Number.isFinite(value) || value < min || value > max) {
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
  templatePresetSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const preset = TEMPLATE_PRESETS.find(
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

  // 批次 7:输出目录选择 / 恢复默认(空串 = 源文件所在目录)
  outputDirPick.addEventListener("click", async () => {
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
  });

  outputDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    outputDirValue.textContent = "源文件所在目录";
    outputDirValue.title = "源文件所在目录";
    persistSettings({ outputDir: "" });
  });

  // 批次 11 迭代 2:转换完成弹窗提示(ui-state 字段;与弹窗内「不再提示」双向同步)
  completeDialogPromptInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    setSuppressCompleteDialog(completeDialogPromptInput.checked);
  });
}
