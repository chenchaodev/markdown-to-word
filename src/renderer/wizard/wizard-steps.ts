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
  type MarginField,
} from "../settings/settings-logic.js";
import {
  bindFontInput,
  bindHeadingTier,
  bindMarginInput,
  bindTypographyNumber,
  checkedValue,
  h,
  pickHeaderLogo,
  radio,
  setChecked,
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
    const opt = h("option", { value: preset.id, text: preset.i18nKey ? t(preset.i18nKey as never) : preset.name });
    select.appendChild(opt);
  }
  select.addEventListener("change", () => applyTemplatePreset(select.value));

  const importBtn = h("button", {
    type: "button",
    class: "btn btn-ghost sm",
    dataset: { i18n: "wizard.template.import" },
  }, [t("wizard.template.import")]);
  importBtn.addEventListener("click", () => void importDocxTemplate());

  /* 排版微调折叠区:页面边距 + 字体微调(预设选定后用户可微调) */
  const marginError = h("p", { class: "field-error hidden" });
  const marginCell = (key: MarginField, label: string): HTMLElement => {
    const input = h("input", {
      type: "number", class: "tin", min: "0", max: String(MARGIN_MAX_MM), step: "0.5",
      value: String(state.settings.pageSetup[key]),
    }) as HTMLInputElement;
    bindMarginInput(key, input, marginError);
    return h("div", { class: "mm-cell" }, [
      h("label", { text: label }),
      h("div", { class: "mm-in" }, [input, h("span", { text: "mm" })]),
    ]);
  };
  const marginGrid = h("div", { class: "mm-grid" }, [
    marginCell("marginTop", t("settings.marginTop")),
    marginCell("marginBottom", t("settings.marginBottom")),
    marginCell("marginLeft", t("settings.marginLeft")),
    marginCell("marginRight", t("settings.marginRight")),
  ]);

  const fontEaInput = h("input", {
    type: "text", class: "tin",
    value: state.settings.typography.fontEastAsia,
  }) as HTMLInputElement;
  fontEaInput.setAttribute("list", "fontEastAsiaSuggestions");
  const fontEaError = h("p", { class: "field-error hidden" });
  bindFontInput("fontEastAsia", fontEaInput, fontEaError, "settings.fontEastAsiaEmpty");

  const fontAsciiInput = h("input", {
    type: "text", class: "tin",
    value: state.settings.typography.fontAscii,
  }) as HTMLInputElement;
  fontAsciiInput.setAttribute("list", "fontAsciiSuggestions");
  const fontAsciiError = h("p", { class: "field-error hidden" });
  bindFontInput("fontAscii", fontAsciiInput, fontAsciiError, "settings.fontAsciiEmpty");

  const bodySizeError = h("p", { class: "field-error hidden" });
  const bodySizeInput = h("input", {
    type: "number", class: "stepper-value", value: String(state.settings.typography.bodySizePt),
    min: String(BODY_SIZE_MIN), max: String(BODY_SIZE_MAX), step: "0.5",
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

  const lineSpacingError = h("p", { class: "field-error hidden" });
  const lineSpacingInput = h("input", {
    type: "range", min: String(LINE_SPACING_MIN), max: String(LINE_SPACING_MAX), step: "0.05",
    value: String(state.settings.typography.lineSpacing),
  }) as HTMLInputElement;
  const lineSpacingOut = h("output", { class: "wz-range-out", text: String(state.settings.typography.lineSpacing) });
  lineSpacingInput.addEventListener("input", () => { lineSpacingOut.textContent = lineSpacingInput.value; });
  bindTypographyNumber("lineSpacing", lineSpacingInput, lineSpacingError, LINE_SPACING_MIN, LINE_SPACING_MAX);

  const headingScaleRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
    radio("wizardHeadingScale", "compact", t("settings.tierCompact"), state.settings.typography.headingScale === "compact"),
    radio("wizardHeadingScale", "standard", t("settings.tierStandard"), state.settings.typography.headingScale === "standard"),
    radio("wizardHeadingScale", "spacious", t("settings.tierSpacious"), state.settings.typography.headingScale === "spacious"),
  ]);
  headingScaleRadios.addEventListener("change", () => bindHeadingTier("headingScale", checkedValue(headingScaleRadios)));

  const headingSpacingRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
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
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.margins" }, text: t("settings.margins") }),
        marginGrid,
        marginError,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.fontEastAsia" }, text: t("settings.fontEastAsia") }),
        fontEaInput,
        fontEaError,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.fontAscii" }, text: t("settings.fontAscii") }),
        fontAsciiInput,
        fontAsciiError,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label" }, [
          h("span", { dataset: { i18n: "settings.bodySize" }, text: t("settings.bodySize") }),
          h("span", { class: "setting-label-hint", dataset: { i18n: "settings.bodySizeHint" }, text: t("settings.bodySizeHint") }),
        ]),
        bodySizeStepper,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label" }, [
          h("span", { dataset: { i18n: "settings.lineSpacing" }, text: t("settings.lineSpacing") }),
          h("span", { class: "setting-label-hint", dataset: { i18n: "settings.lineSpacingHint" }, text: t("settings.lineSpacingHint") }),
        ]),
        h("span", { class: "row-r" }, [lineSpacingInput, lineSpacingOut]),
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.headingScaleTier" }, text: t("settings.headingScaleTier") }),
        headingScaleRadios,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.headingSpacingTier" }, text: t("settings.headingSpacingTier") }),
        headingSpacingRadios,
      ]),
    ]),
  ]);

  return h("section", { class: "wz-pane", dataset: { step: "1" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.template.label" }, text: t("wizard.template.label") }),
      h("span", { class: "sel-wrap" }, [select]),
    ]),
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
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.cover.fieldTitle" }, text: t("wizard.cover.fieldTitle") }),
      coverTitleInput,
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.cover.fieldAuthor" }, text: t("wizard.cover.fieldAuthor") }),
      coverAuthorInput,
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.cover.fieldDate" }, text: t("wizard.cover.fieldDate") }),
      coverDateInput,
    ]),
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
export function buildStepHeader(): HTMLElement {
  const modeRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
    radio("wizardHeaderMode", "default", t("settings.modeDefault"), true),
    radio("wizardHeaderMode", "custom", t("settings.headerModeCustom"), false),
    radio("wizardHeaderMode", "none", t("settings.headerModeNone"), false),
  ]);
  const headerText = h("input", { type: "text", class: "tin", id: "wizardHeaderText" }) as HTMLInputElement;
  const layoutRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
    radio("wizardHeaderLayout", "center", t("settings.headerLayoutCenter"), true),
    radio("wizardHeaderLayout", "leftRight", t("settings.headerLayoutLeftRight"), false),
  ]);
  const footerSwitch = h("input", { type: "checkbox", class: "switch-input", id: "wizardFooter" }) as HTMLInputElement;
  const cond = h("div", { class: "cond", inert: true }, [
    h("div", { class: "cond-in" }, [
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.headerText" }, text: t("settings.headerText") }),
        headerText,
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.headerLogo" }, text: t("settings.headerLogo") }),
        (() => {
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
        })(),
      ]),
      h("div", { class: "wz-field" }, [
        h("label", { class: "wz-label", dataset: { i18n: "settings.headerLayout" }, text: t("settings.headerLayout") }),
        layoutRadios,
      ]),
      h("div", { class: "sw-row" }, [
        h("span", {}, [
          h("span", { class: "row-l", dataset: { i18n: "settings.footerEnabledLabel" }, text: t("settings.footerEnabledLabel") }),
          h("span", { class: "row-sub", dataset: { i18n: "settings.footerEnabledDesc" }, text: t("settings.footerEnabledDesc") }),
        ]),
        footerSwitch,
      ]),
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
  footerSwitch.addEventListener("change", () => {
    state.settings.headerFooter.footerEnabled = footerSwitch.checked;
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });

  // 回填当前设置值
  setChecked(modeRadios, state.settings.headerFooter.headerMode);
  headerText.value = state.settings.headerFooter.headerText;
  setChecked(layoutRadios, state.settings.headerFooter.headerLayout);
  footerSwitch.checked = state.settings.headerFooter.footerEnabled;
  syncCond();

  return h("section", { class: "wz-pane", dataset: { step: "3" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.headerModeLabel" }, text: t("settings.headerModeLabel") }),
      modeRadios,
    ]),
    cond,
  ]);
}

/* ---------- 步骤 4:水印 ---------- */
export function buildStepWatermark(): HTMLElement {
  const text = h("input", { type: "text", class: "tin", id: "wizardWmText" }) as HTMLInputElement;
  const angle = h("input", { type: "number", class: "tin tin-num", min: "0", max: "360", step: "1", id: "wizardWmAngle" }) as HTMLInputElement;
  const opacity = h("input", { type: "number", class: "tin tin-num", min: "0", max: "1", step: "0.05", id: "wizardWmOpacity" }) as HTMLInputElement;
  const gray = h("input", { type: "checkbox", class: "switch-input", id: "wizardWmGray" }) as HTMLInputElement;

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
  gray.addEventListener("change", () => {
    state.settings.watermark.gray = gray.checked;
    persistSettings({ watermark: { ...state.settings.watermark } });
  });

  text.value = state.settings.watermark.text;
  angle.value = String(state.settings.watermark.angle);
  opacity.value = String(state.settings.watermark.opacity);
  gray.checked = state.settings.watermark.gray;

  return h("section", { class: "wz-pane", dataset: { step: "4" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.watermarkText" }, text: t("settings.watermarkText") }),
      text,
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.watermarkAngle" }, text: t("settings.watermarkAngle") }),
      angle,
      h("span", { class: "row-unit", dataset: { i18n: "settings.degree" }, text: t("settings.degree") }),
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.watermarkOpacity" }, text: t("settings.watermarkOpacity") }),
      opacity,
    ]),
    h("div", { class: "sw-row" }, [
      h("span", {}, [
        h("span", { class: "row-l", dataset: { i18n: "settings.watermarkGray" }, text: t("settings.watermarkGray") }),
        h("span", { class: "row-sub", dataset: { i18n: "settings.watermarkGrayDesc" }, text: t("settings.watermarkGrayDesc") }),
      ]),
      gray,
    ]),
  ]);
}
