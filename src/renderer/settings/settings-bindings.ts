/**
 * renderer 设置控件事件绑定(B8 自 settings-panel.ts 抽出,行为零变化):
 * bindSettingsEvents 集中全部设置控件 change/click 接线(格式 / 页面设置 / 排版 /
 * 模板预设 / 输出目录 / 语言),以及仅绑定侧使用的字段处理器(边距钳制、字号/行距
 * 校验)与页面/排版整体写回。加载/回填/持久化/预设弹窗交互仍单源 settings-panel.ts,
 * 本模块单向依赖之(不反向),组合根 renderer.ts 直接 import 本模块的
 * bindSettingsEvents(避免 panel⇄bindings 环)。
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  DEFAULT_SETTINGS,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM as MARGIN_MAX,
  type AppSettings,
  type PageSetup,
  type TemplatePreset,
} from "../../core/settings/settings-defaults.js";
import {
  allPresets,
  headerLogoDisplayName,
  outputDirDisplayText,
  parseMarginValue,
  validateNumberRange,
} from "./settings-logic.js";
import {
  afterConvertInputs,
  alignInputs,
  bodySizeDecBtn,
  bodySizeError,
  bodySizeIncBtn,
  bodySizePtInput,
  breakBeforeH1Input,
  captionNumberingInput,
  drawerResetBtn,
  equationNumberingInput,
  firstLineIndentInput,
  fontAsciiError,
  fontAsciiInput,
  fontEastAsiaError,
  fontEastAsiaInput,
   formatInputs,
   footerEnabledInput,
   headerLayoutInputs,
   headerLogoClearBtn,
   headerLogoPickBtn,
   headerLogoStatus,
   headerModeInputs,
   headerTextInput,
   headingNumberingInput,
   headingScaleInputs,
   headingSpacingInputs,
  languageSelect,
  lineSpacingError,
  lineSpacingInput,
  lineSpacingValue,
  marginError,
  marginInputs,
  orientationInputs,
  outputDirPick,
  outputDirReset,
  outputDirValue,
  paperInputs,
  pdfCssClearBtn,
  pdfCssImportBtn,
  pdfCssStatus,
  pdfCssTextInput,
  presetDeleteBtn,
  presetExportBtn,
  presetImportBtn,
  presetNameInput,
  presetSaveBtn,
  presetSaveCancel,
  presetSaveDialog,
  presetSaveOk,
  templatePresetSelect,
  themeInputs,
  tocInput,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { hideFieldError, setError, setStatus, showFieldError } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import { renderSelection } from "../convert/file-list.js";
import { applyStaticTexts, setLanguage, t, type Language } from "../../core/i18n.js";
// 单源 settings-panel(依赖方向单向:bindings → panel,不反向)
import {
  applySettingsToControls,
  applyTheme,
  clearPdfCss,
  closePresetSaveDialog,
  deleteCustomPreset,
  exportCustomPresets,
  importCustomPresets,
  importPdfCss,
   mirrorLanguage,
   openPresetSaveDialog,
   persistSettings,
   rebuildLanguageOptions,
   saveCustomPreset,
   syncHeaderCustomVisibility,
 } from "./settings-panel.js";
// 界面重构 v3:预设切换即时反馈(toast 单实例,ui/toast)
import { showToast } from "../ui/toast.js";

/* ---------- 设置类型(契约单源 core/settings-defaults.ts,B7:type-only 派生,
   编译期擦除,不新增运行时依赖) ---------- */
type Paper = PageSetup["paper"];
type Orientation = PageSetup["orientation"];
type AfterConvert = AppSettings["afterConvert"];

/** 页面尺寸相关字段(纸张/方向/边距)整体写回。 */
function persistPageSetup(): void {
  persistSettings({ pageSetup: { ...state.settings.pageSetup } });
}

/** 排版相关字段(字体/字号/行距/段落样式)整体写回。 */
function persistTypography(): void {
  persistSettings({ typography: { ...state.settings.typography } });
}

/** 页眉页脚字段(F4)整体写回。 */
function persistHeaderFooter(): void {
  persistSettings({ headerFooter: { ...state.settings.headerFooter } });
}

/**
 * 预设切换 toast 的被覆盖组标签(界面重构 v3;与模板预设应用逻辑同步):
 * 预设整体写入 pageSetup(「页面」组)与 typography——其中字体/字号/行距/缩进/
 * 对齐/标题档位属「文字」组,headingNumbering/captionNumbering 属「编号与目录」组。
 * TemplatePreset 契约两组均为必填,正常全部列出;字段级判断仅为契约演进留余地。
 */
function presetCoveredGroupLabels(preset: TemplatePreset): string {
  const groups: string[] = [];
  if (preset.pageSetup) groups.push(t("settings.groupPage"));
  if (preset.typography) {
    const typo = preset.typography;
    const hasTextGroup = [
      typo.fontAscii,
      typo.fontEastAsia,
      typo.bodySizePt,
      typo.lineSpacing,
      typo.firstLineIndent,
      typo.align,
      typo.headingScale,
      typo.headingSpacing,
    ].some((value) => value !== undefined);
    if (hasTextGroup) groups.push(t("settings.groupText"));
    if (
      typo.headingNumbering !== undefined ||
      typo.captionNumbering !== undefined
    ) {
      groups.push(t("settings.groupNumbering"));
    }
  }
  return groups.join(" · ");
}

/** 边距输入:非法值回显当前设置,合法值钳制后写回;非法时字段内提示。 */
function handleMarginChange(key: keyof typeof marginInputs): void {
  if (state.hydratingSettings) return;
  const input = marginInputs[key];
  const clamped = parseMarginValue(input.valueAsNumber);
  if (clamped === null) {
    input.value = String(state.settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    showFieldError(marginError, t("settings.marginRange", { max: MARGIN_MAX }));
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
    showFieldError(errorEl, t("settings.numberRange", { min, max }));
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
  // 界面重构 v3:纸张/方向改 seg 分段(radio 组;枚举 ≤5 → seg,guidelines §3.1),
  // 组绑定模式与 alignInputs/themeInputs 一致
  paperInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.pageSetup.paper = input.value as Paper;
      persistPageSetup();
    });
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
      showFieldError(fontAsciiError, t("settings.fontAsciiEmpty"));
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
      showFieldError(fontEastAsiaError, t("settings.fontEastAsiaEmpty"));
      return;
    }
    state.settings.typography.fontEastAsia = value;
    hideFieldError(fontEastAsiaError);
    persistTypography();
  });

  bodySizePtInput.addEventListener("change", () =>
    handleTypographyNumberChange("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX),
  );

  // 界面重构 v3:正文字号 stepper ± 按钮(±0.5,上下限钳制后经既有 change 链路
  // 校验/持久化;非法输入以当前设置值为基准,不放大脏值)
  const stepBodySize = (delta: number): void => {
    if (state.hydratingSettings) return;
    const base = Number.isFinite(bodySizePtInput.valueAsNumber)
      ? bodySizePtInput.valueAsNumber
      : state.settings.typography.bodySizePt;
    const next = Math.min(BODY_SIZE_MAX, Math.max(BODY_SIZE_MIN, base + delta));
    bodySizePtInput.value = String(next);
    bodySizePtInput.dispatchEvent(new Event("change"));
  };
  bodySizeDecBtn.addEventListener("click", () => stepBodySize(-0.5));
  bodySizeIncBtn.addEventListener("click", () => stepBodySize(0.5));

  lineSpacingInput.addEventListener("change", () =>
    handleTypographyNumberChange("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX),
  );

  // 界面重构 v3:行距 range 滑杆 mono 实时回显(input 拖动期跟随;
  // change 落定走上方既有校验/持久化链路)
  lineSpacingInput.addEventListener("input", () => {
    lineSpacingValue.textContent = lineSpacingInput.value;
  });

  // F3 标题排版粒度:标题字号/间距档位(界面重构 v3 自 select 改 seg 分段,
  // 三档;变更即时生效并持久化)
  headingScaleInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.headingScale = input.value as AppSettings["typography"]["headingScale"];
      persistTypography();
    });
  });

  headingSpacingInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.headingSpacing = input.value as AppSettings["typography"]["headingSpacing"];
      persistTypography();
    });
  });

  firstLineIndentInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.firstLineIndent = firstLineIndentInput.checked;
    persistTypography();
  });

  // 界面重构 v3:对齐方式由布尔 checkbox 升级为枚举 radio 组(left/justify),
  // 存储契约不变(typography.align);选中值即写入
  alignInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.align = input.value as AppSettings["typography"]["align"];
      persistTypography();
    });
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

  /* ---------- 页眉页脚(F4):任一控件变更即时生效并持久化 ---------- */
  // 界面重构 v3:页眉模式改 seg 分段(模式 + 条件字段容器,IA §3.1);
  // 自定义控件块仅 custom 模式展开(.cond.show)
  headerModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.headerFooter.headerMode = input.value as AppSettings["headerFooter"]["headerMode"];
      // 自定义控件块(文字/logo/布局)仅 custom 模式可见
      syncHeaderCustomVisibility();
      persistHeaderFooter();
    });
  });

  headerTextInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.headerFooter.headerText = headerTextInput.value.trim();
    persistHeaderFooter();
  });

  headerLayoutInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.headerFooter.headerLayout = input.value as AppSettings["headerFooter"]["headerLayout"];
      persistHeaderFooter();
    });
  });

  footerEnabledInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.headerFooter.footerEnabled = footerEnabledInput.checked;
    persistHeaderFooter();
  });

  // logo 选择:main 打开文件对话框(限图片扩展名),返回绝对路径或 null(取消)
  headerLogoPickBtn.addEventListener("click", () => {
    void (async () => {
      try {
        const logoPath = await window.api.selectHeaderLogo();
        if (!logoPath) return; // 用户取消
        state.settings.headerFooter.headerLogoPath = logoPath;
        const name = headerLogoDisplayName(logoPath);
        headerLogoStatus.textContent = name;
        headerLogoStatus.title = name;
        headerLogoClearBtn.classList.remove("hidden");
        persistHeaderFooter();
      } catch (err) {
        setError(t("settings.selectDirFailed", { error: errorMessage(err) }));
      }
    })();
  });

  headerLogoClearBtn.addEventListener("click", () => {
    state.settings.headerFooter.headerLogoPath = "";
    headerLogoStatus.textContent = t("settings.headerLogoNone");
    headerLogoStatus.title = "";
    headerLogoClearBtn.classList.add("hidden");
    persistHeaderFooter();
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
    // 界面重构 v3:预设切换即时反馈——toast 列出被覆盖的设置组(只陈述事实)
    showToast(
      t("toast.presetSwitched", {
        name: preset.name,
        groups: presetCoveredGroupLabels(preset),
      }),
    );
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

  // 界面重构 v3:PDF 自定义 CSS 文本域(IA 06 textarea 形态;与导入/清除同写
  // settings.pdfCss,状态行与清除按钮可见性同步回填逻辑)
  pdfCssTextInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.pdfCss = pdfCssTextInput.value;
    persistSettings({ pdfCss: pdfCssTextInput.value });
    pdfCssStatus.textContent = pdfCssTextInput.value
      ? t("settings.pdfCssImported")
      : t("settings.pdfCssNone");
    pdfCssClearBtn.classList.toggle("hidden", !pdfCssTextInput.value);
  });

  // 界面重构 v3:抽屉底部「恢复默认」——转换相关各组复位为默认值并整体持久化
  //(07 应用偏好 theme/language 与自定义预设保留,不随此键重置;toast 只陈述事实)
  drawerResetBtn.addEventListener("click", () => {
    if (state.hydratingSettings) return;
    const d = DEFAULT_SETTINGS;
    state.settings.pageSetup = { ...d.pageSetup };
    state.settings.typography = { ...d.typography };
    state.settings.breakBeforeH1 = d.breakBeforeH1;
    state.settings.toc = d.toc;
    state.settings.equationNumbering = d.equationNumbering;
    state.settings.afterConvert = d.afterConvert;
    state.settings.outputDir = d.outputDir;
    state.settings.pdfCss = d.pdfCss;
    state.settings.headerFooter = { ...d.headerFooter };
    state.hydratingSettings = true;
    applySettingsToControls();
    state.hydratingSettings = false;
    persistSettings({
      pageSetup: { ...state.settings.pageSetup },
      typography: { ...state.settings.typography },
      breakBeforeH1: state.settings.breakBeforeH1,
      toc: state.settings.toc,
      equationNumbering: state.settings.equationNumbering,
      afterConvert: state.settings.afterConvert,
      outputDir: state.settings.outputDir,
      pdfCss: state.settings.pdfCss,
      headerFooter: { ...state.settings.headerFooter },
    });
    showToast(t("toast.settingsReset"));
  });

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
      const message = errorMessage(err);
      setError(t("settings.selectDirFailed", { error: message }));
    }
    })();
  });

  outputDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    outputDirValue.textContent = outputDirDisplayText("");
    outputDirValue.title = outputDirDisplayText("");
    persistSettings({ outputDir: "" });
  });

  // i18n:界面语言切换(P0-4 自 radio 组改 select;选项由 LANGUAGES 注册表动态生成,
  // 须先于事件绑定重建;即时生效:静态文案重刷 + 动态文案经 t() 自动跟随,
  // 状态栏/文件列表/最近区块等动态区域显式重渲染)
  rebuildLanguageOptions();
  languageSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const lang = languageSelect.value as Language;
    state.settings.language = lang;
    setLanguage(lang);
    mirrorLanguage(lang); // B6:切换落定即镜像,下次启动 lang-bootstrap.js 尽早生效
    applyStaticTexts();
    persistSettings({ language: lang });
    setStatus("");
    renderSelection();
    void state.recentRefreshHandler?.();
  });

  // B13:外观主题切换(radio;即时生效:data-theme 属性设/移除 + 持久化;
  // system = 移除属性,CSS @media prefers-color-scheme 接管)
  themeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      const theme = input.value as AppSettings["theme"];
      state.settings.theme = theme;
      applyTheme(theme);
      persistSettings({ theme });
    });
  });
}
