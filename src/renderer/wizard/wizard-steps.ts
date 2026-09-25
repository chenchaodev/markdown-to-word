/**
 * 成书向导步骤渲染·版式四步(拆分自 book-wizard.ts,D1,纯搬移零行为改动)
 * 「步骤渲染」块之一:①模板预设(含排版微调折叠区)②封面(含实时预览)
 * ③页眉页脚 ④水印;控件形态沿用既有令牌类(枚举 ≤5 → seg、布尔 → switch)。
 * 交付三步(合并源/目录/付印)见 wizard-steps-delivery.ts,字段校验绑定见
 * wizard-fields.ts,外壳/导航/付印提交见 book-wizard.ts。
 * 封面控件引用在本模块赋值(buildStepCover),外壳打开重置与交付步预填经
 * import 读取(ESM 实时绑定,导入只读——赋值仅在本模块,不越界)。
 * 依赖方向:本模块 → wizard-fields、wizard-runtime、core / state / settings-*
 * (单向),不反向引用外壳。
 */
import { t } from "../../core/i18n.js";
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM,
} from "../../core/settings/settings-defaults.js";
import { state } from "../state/state.js";
import { applyTemplatePreset } from "../settings/settings-bindings-preset.js";
import { importDocxTemplate, persistSettings } from "../settings/settings-panel.js";
import {
  allPresets,
  headerLogoDisplayName,
  presetDisplayName,
  type MarginField,
} from "../settings/settings-logic.js";
import {
  bindFontInput,
  bindHeadingTier,
  bindMarginInput,
  bindTypographyNumber,
  checkedValue,
  fieldErrorNode,
  fieldRow,
  groupRow,
  h,
  pickHeaderLogo,
  radio,
  radioGroup,
  setChecked,
  swRow,
  type AppHeaderMode,
  type AppHeaderLayout,
} from "./wizard-fields.js";
import { draft } from "./wizard-runtime.js";

/* 各步需读写的封面控件引用(每次 open 由 buildStepCover 重建) */
export let coverTitleInput: HTMLInputElement;
export let coverAuthorInput: HTMLInputElement;
export let coverDateInput: HTMLInputElement;
export let coverPreview: HTMLElement;
export let coverFromFm: HTMLElement;

/* ---------- 步骤 1:模板预设 ---------- */
export function buildStepTemplate(): HTMLElement {
  const select = h("select", { id: "wizardPreset", class: "setting-select" }) as HTMLSelectElement;
  for (const preset of allPresets(state.settings.customPresets)) {
    // 预设名本地化口径与设置面板下拉一致(内置走字典/自定义走 name;缺键回退 name)
    const opt = h("option", { value: preset.id, text: presetDisplayName(preset) });
    select.appendChild(opt);
  }
  select.addEventListener("change", () => applyTemplatePreset(select.value));

  const importBtn = h("button", {
    type: "button",
    class: "btn btn-ghost sm",
    dataset: { i18n: "wizard.template.import" },
  }, [t("wizard.template.import")]);
  importBtn.addEventListener("click", () => void importDocxTemplate());

  /* 排版微调折叠区:页面边距 + 字体微调(预设选定后用户可微调)
   * 无障碍:每个控件都有 id + label[for];错误节点 role=alert 并由
   * show/hideFieldError 维护控件 aria-invalid(见 wizard-fields 注释)。 */
  const marginError = fieldErrorNode();
  const marginLabelId = "wiz-margin-label";
  const marginCell = (key: MarginField, label: string): HTMLElement => {
    const inputId = `wiz-margin-${key}`;
    const input = h("input", {
      type: "number", class: "tin", min: "0", max: String(MARGIN_MAX_MM), step: "0.5",
      id: inputId, "aria-describedby": marginError.id,
      value: String(state.settings.pageSetup[key]),
    }) as HTMLInputElement;
    bindMarginInput(key, input, marginError);
    return h("div", { class: "mm-cell" }, [
      h("label", { for: inputId, text: label }),
      h("div", { class: "mm-in" }, [input, h("span", { text: "mm" })]),
    ]);
  };
  const marginGrid = h("div", { class: "mm-grid" }, [
    marginCell("marginTop", t("settings.marginTop")),
    marginCell("marginBottom", t("settings.marginBottom")),
    marginCell("marginLeft", t("settings.marginLeft")),
    marginCell("marginRight", t("settings.marginRight")),
  ]);
  // 四格共享一条错误:按组播报(role=group + aria-labelledby),不逐格标红
  const marginField = h("div", {
    class: "wz-field", role: "group", "aria-labelledby": marginLabelId,
  }, [
    h("span", { class: "wz-label", id: marginLabelId, dataset: { i18n: "settings.margins" }, text: t("settings.margins") }),
    marginGrid,
    marginError,
  ]);

  const fontEaInput = h("input", {
    type: "text", class: "tin",
    value: state.settings.typography.fontEastAsia,
  }) as HTMLInputElement;
  fontEaInput.setAttribute("list", "fontEastAsiaSuggestions");
  const fontEaError = fieldErrorNode();
  bindFontInput("fontEastAsia", fontEaInput, fontEaError, "settings.fontEastAsiaEmpty");

  const fontAsciiInput = h("input", {
    type: "text", class: "tin",
    value: state.settings.typography.fontAscii,
  }) as HTMLInputElement;
  fontAsciiInput.setAttribute("list", "fontAsciiSuggestions");
  const fontAsciiError = fieldErrorNode();
  bindFontInput("fontAscii", fontAsciiInput, fontAsciiError, "settings.fontAsciiEmpty");

  const bodySizeError = fieldErrorNode();
  const bodySizeInput = h("input", {
    type: "number", class: "stepper-value", value: String(state.settings.typography.bodySizePt),
    min: String(BODY_SIZE_MIN), max: String(BODY_SIZE_MAX), step: "0.5",
    id: "wiz-bodySize", "aria-describedby": bodySizeError.id,
  }) as HTMLInputElement;
  const bodySizeDec = h("button", { type: "button", "aria-label": t("settings.stepDecreaseAria") }, ["−"]);
  const bodySizeInc = h("button", { type: "button", "aria-label": t("settings.stepIncreaseAria") }, ["+"]);
  const stepBody = (delta: number): void => {
    const base = Number.isFinite(bodySizeInput.valueAsNumber)
      ? bodySizeInput.valueAsNumber
      : state.settings.typography.bodySizePt;
    bodySizeInput.value = String(Math.min(BODY_SIZE_MAX, Math.max(BODY_SIZE_MIN, base + delta)));
    bodySizeInput.dispatchEvent(new Event("change"));
  };
  bodySizeDec.addEventListener("click", () => stepBody(-0.5));
  bodySizeInc.addEventListener("click", () => stepBody(0.5));
  bindTypographyNumber("bodySizePt", bodySizeInput, bodySizeError, BODY_SIZE_MIN, BODY_SIZE_MAX);
  const bodySizeStepper = h("span", { class: "stepper" }, [bodySizeDec, bodySizeInput, bodySizeInc]);

  const lineSpacingError = fieldErrorNode();
  const lineSpacingInput = h("input", {
    type: "range", min: String(LINE_SPACING_MIN), max: String(LINE_SPACING_MAX), step: "0.05",
    id: "wiz-lineSpacing", "aria-describedby": lineSpacingError.id,
    value: String(state.settings.typography.lineSpacing),
  }) as HTMLInputElement;
  const lineSpacingOut = h("output", { class: "wz-range-out", text: String(state.settings.typography.lineSpacing) });
  lineSpacingInput.addEventListener("input", () => { lineSpacingOut.textContent = lineSpacingInput.value; });
  bindTypographyNumber("lineSpacing", lineSpacingInput, lineSpacingError, LINE_SPACING_MIN, LINE_SPACING_MAX);

  const headingScaleRadios = radioGroup([
    radio("wizardHeadingScale", "compact", t("settings.tierCompact"), state.settings.typography.headingScale === "compact"),
    radio("wizardHeadingScale", "standard", t("settings.tierStandard"), state.settings.typography.headingScale === "standard"),
    radio("wizardHeadingScale", "spacious", t("settings.tierSpacious"), state.settings.typography.headingScale === "spacious"),
  ]);
  headingScaleRadios.addEventListener("change", () => bindHeadingTier("headingScale", checkedValue(headingScaleRadios)));

  const headingSpacingRadios = radioGroup([
    radio("wizardHeadingSpacing", "compact", t("settings.tierCompact"), state.settings.typography.headingSpacing === "compact"),
    radio("wizardHeadingSpacing", "standard", t("settings.tierStandard"), state.settings.typography.headingSpacing === "standard"),
    radio("wizardHeadingSpacing", "spacious", t("settings.tierSpacious"), state.settings.typography.headingSpacing === "spacious"),
  ]);
  headingSpacingRadios.addEventListener("change", () => bindHeadingTier("headingSpacing", checkedValue(headingSpacingRadios)));

  const fold = h("details", { class: "wz-fold", open: true }, [
    h("summary", {}, [
      h("span", { class: "wz-fold-title", dataset: { i18n: "wizard.typography.fold" }, text: t("wizard.typography.fold") }),
    ]),
    h("div", { class: "wz-fold-body" }, [
      h("p", { class: "wz-hint", dataset: { i18n: "wizard.typography.foldHint" }, text: t("wizard.typography.foldHint") }),
      marginField,
      fieldRow("settings.fontEastAsia", fontEaInput, { errorEl: fontEaError }),
      fieldRow("settings.fontAscii", fontAsciiInput, { errorEl: fontAsciiError }),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", for: "wiz-bodySize" }, [
          h("span", { dataset: { i18n: "settings.bodySize" }, text: t("settings.bodySize") }),
          h("span", { class: "setting-label-hint", dataset: { i18n: "settings.bodySizeHint" }, text: t("settings.bodySizeHint") }),
        ]),
        bodySizeStepper,
        bodySizeError,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", for: "wiz-lineSpacing" }, [
          h("span", { dataset: { i18n: "settings.lineSpacing" }, text: t("settings.lineSpacing") }),
          h("span", { class: "setting-label-hint", dataset: { i18n: "settings.lineSpacingHint" }, text: t("settings.lineSpacingHint") }),
        ]),
        h("span", { class: "row-r" }, [lineSpacingInput, lineSpacingOut]),
        lineSpacingError,
      ]),
      groupRow("settings.headingScaleTier", headingScaleRadios),
      groupRow("settings.headingSpacingTier", headingSpacingRadios),
    ]),
  ]);

  return h("section", { class: "wz-pane", dataset: { step: "1" } }, [
    groupRow("wizard.template.label", h("span", { class: "sel-wrap" }, [select]), select),
    h("div", { class: "wz-actions" }, [importBtn]),
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.template.hint" }, text: t("wizard.template.hint") }),
    fold,
  ]);
}

/* ---------- 步骤 2:封面 ---------- */
export function buildStepCover(): HTMLElement {
  coverTitleInput = h("input", { type: "text", class: "tin", id: "wizardCoverTitle" }) as HTMLInputElement;
  coverAuthorInput = h("input", { type: "text", class: "tin", id: "wizardCoverAuthor" }) as HTMLInputElement;
  coverDateInput = h("input", { type: "text", class: "tin", id: "wizardCoverDate" }) as HTMLInputElement;
  coverPreview = h("div", { class: "wz-cover-preview" });
  coverFromFm = h("p", { class: "wz-hint hidden", dataset: { i18n: "wizard.cover.fromFrontmatter" }, text: t("wizard.cover.fromFrontmatter") });

  const onInput = (): void => {
    draft.cover.title = coverTitleInput.value;
    draft.cover.author = coverAuthorInput.value;
    draft.cover.date = coverDateInput.value;
    renderCoverPreview();
  };
  coverTitleInput.addEventListener("input", onInput);
  coverAuthorInput.addEventListener("input", onInput);
  coverDateInput.addEventListener("input", onInput);

  return h("section", { class: "wz-pane", dataset: { step: "2" } }, [
    fieldRow("wizard.cover.fieldTitle", coverTitleInput),
    fieldRow("wizard.cover.fieldAuthor", coverAuthorInput),
    fieldRow("wizard.cover.fieldDate", coverDateInput),
    coverFromFm,
    h("div", { class: "wz-preview-wrap" }, [
      h("span", { class: "wz-label", dataset: { i18n: "wizard.cover.preview" }, text: t("wizard.cover.preview") }),
      coverPreview,
    ]),
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.cover.missingTitle" }, text: t("wizard.cover.missingTitle") }),
  ]);
}

/** 封面实时预览(右侧卡;标题衬线 / 作者 UI / 日期 mono) */
export function renderCoverPreview(): void {
  const title = draft.cover.title.trim();
  const author = draft.cover.author.trim();
  const date = draft.cover.date.trim();
  coverPreview.replaceChildren();
  if (!title) {
    coverPreview.appendChild(h("p", { class: "wz-cover-empty", text: t("wizard.cover.missingTitle") }));
    return;
  }
  coverPreview.appendChild(h("p", { class: "wz-cover-title", text: title }));
  if (author || date) {
    coverPreview.appendChild(h("p", { class: "wz-cover-meta", text: [author, date].filter(Boolean).join(" · ") }));
  }
}

/* ---------- 步骤 3:页眉页脚 ---------- */
/** 页眉图片行(状态 chip + 选择/清除):抽出成独立函数,便于 groupRow 整组标注 */
function buildHeaderLogoRow(): HTMLElement {
  const logoStatus = h("span", {
    class: "path-chip",
    id: "wizardHeaderLogoStatus",
    text: headerLogoDisplayName(state.settings.headerFooter.headerLogoPath) || t("settings.headerLogoNone"),
  });
  const logoClear = h("button", {
    type: "button", class: "btn btn-text sm hidden", dataset: { i18n: "settings.cssClear" },
  }, [t("settings.cssClear")]) as HTMLButtonElement;
  const logoPick = h("button", {
    type: "button", class: "btn btn-ghost sm", dataset: { i18n: "settings.headerLogoPick" },
  }, [t("settings.headerLogoPick")]);
  logoPick.addEventListener("click", () => void pickHeaderLogo(logoStatus, logoClear));
  logoClear.addEventListener("click", () => {
    state.settings.headerFooter.headerLogoPath = "";
    logoStatus.textContent = t("settings.headerLogoNone");
    logoStatus.title = "";
    logoClear.classList.add("hidden");
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });
  if (state.settings.headerFooter.headerLogoPath) logoClear.classList.remove("hidden");
  return h("div", { class: "outputdir-row" }, [logoStatus, logoPick, logoClear]);
}

export function buildStepHeader(): HTMLElement {
  const modeRadios = radioGroup([
    radio("wizardHeaderMode", "default", t("settings.modeDefault"), true),
    radio("wizardHeaderMode", "custom", t("settings.headerModeCustom"), false),
    radio("wizardHeaderMode", "none", t("settings.headerModeNone"), false),
  ]);
  const headerText = h("input", { type: "text", class: "tin", id: "wizardHeaderText" }) as HTMLInputElement;
  const layoutRadios = radioGroup([
    radio("wizardHeaderLayout", "center", t("settings.headerLayoutCenter"), true),
    radio("wizardHeaderLayout", "leftRight", t("settings.headerLayoutLeftRight"), false),
  ]);
  // 页脚开关走共用开关行(swRow 已带 aria-labelledby/describedby)
  const footerRow = swRow(
    "settings.footerEnabledLabel",
    "settings.footerEnabledDesc",
    state.settings.headerFooter.footerEnabled,
    (v) => {
      state.settings.headerFooter.footerEnabled = v;
      persistSettings({ headerFooter: { ...state.settings.headerFooter } });
    },
  );
  const cond = h("div", { class: "cond", inert: true }, [
    h("div", { class: "cond-in" }, [
      fieldRow("settings.headerText", headerText),
      groupRow("settings.headerLogo", buildHeaderLogoRow()),
      groupRow("settings.headerLayout", layoutRadios),
      footerRow,
    ]),
  ]);

  const syncCond = (): void => {
    const custom = checkedValue(modeRadios) === "custom";
    cond.classList.toggle("show", custom);
    cond.inert = !custom;
  };
  modeRadios.addEventListener("change", () => {
    state.settings.headerFooter.headerMode = checkedValue(modeRadios) as AppHeaderMode;
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
    syncCond();
  });
  headerText.addEventListener("change", () => {
    state.settings.headerFooter.headerText = headerText.value.trim();
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });
  layoutRadios.addEventListener("change", () => {
    state.settings.headerFooter.headerLayout = checkedValue(layoutRadios) as AppHeaderLayout;
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });
  layoutRadios.addEventListener("change", () => {
    state.settings.headerFooter.headerLayout = checkedValue(layoutRadios) as AppHeaderLayout;
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });

  // 回填当前设置值
  setChecked(modeRadios, state.settings.headerFooter.headerMode);
  headerText.value = state.settings.headerFooter.headerText;
  setChecked(layoutRadios, state.settings.headerFooter.headerLayout);
  syncCond();

  return h("section", { class: "wz-pane", dataset: { step: "3" } }, [
    groupRow("settings.headerModeLabel", modeRadios),
    cond,
  ]);
}

/* ---------- 步骤 4:水印 ---------- */
export function buildStepWatermark(): HTMLElement {
  const text = h("input", { type: "text", class: "tin", id: "wizardWmText" }) as HTMLInputElement;
  const angle = h("input", { type: "number", class: "tin tin-num", min: "0", max: "360", step: "1", id: "wizardWmAngle" }) as HTMLInputElement;
  const opacity = h("input", { type: "number", class: "tin tin-num", min: "0", max: "1", step: "0.05", id: "wizardWmOpacity" }) as HTMLInputElement;
  const grayRow = swRow(
    "settings.watermarkGray",
    "settings.watermarkGrayDesc",
    state.settings.watermark.gray,
    (v) => {
      state.settings.watermark.gray = v;
      persistSettings({ watermark: { ...state.settings.watermark } });
    },
  );

  text.addEventListener("change", () => {
    state.settings.watermark.text = text.value;
    persistSettings({ watermark: { ...state.settings.watermark } });
  });
  angle.addEventListener("change", () => {
    state.settings.watermark.angle = Math.min(360, Math.max(0, angle.valueAsNumber || 0));
    angle.value = String(state.settings.watermark.angle);
    persistSettings({ watermark: { ...state.settings.watermark } });
  });
  opacity.addEventListener("change", () => {
    state.settings.watermark.opacity = Math.min(1, Math.max(0, opacity.valueAsNumber || 0));
    opacity.value = String(state.settings.watermark.opacity);
    persistSettings({ watermark: { ...state.settings.watermark } });
  });

  text.value = state.settings.watermark.text;
  angle.value = String(state.settings.watermark.angle);
  opacity.value = String(state.settings.watermark.opacity);

  return h("section", { class: "wz-pane", dataset: { step: "4" } }, [
    fieldRow("settings.watermarkText", text),
    // 角度带行内单位:单位与输入同行,label[for] 指向输入即可
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", for: "wizardWmAngle", dataset: { i18n: "settings.watermarkAngle" }, text: t("settings.watermarkAngle") }),
      angle,
      h("span", { class: "row-unit", dataset: { i18n: "settings.degree" }, text: t("settings.degree") }),
    ]),
    fieldRow("settings.watermarkOpacity", opacity),
    grayRow,
  ]);
}
