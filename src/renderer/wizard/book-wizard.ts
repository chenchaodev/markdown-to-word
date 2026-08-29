/**
 * 成书向导模态(renderer 内 stepper 模态,非独立窗口):
 * 把模板预设 / 封面 / 页眉页脚 / 水印 / 合并 / 目录 / 付印 串成一条「成书」流程。
 * 严格复用既有设计令牌、`.dialog-overlay` 模态模式与栈式 `trapFocus`(与设置抽屉/
 * 完成弹窗同机制);不发明新控件形态(枚举 ≤5 → seg、布尔 → switch、路径/文本 → tin)。
 *
 * 状态归属(设计 §3.6):向导内改的模板/页眉/水印/目录直接写 `state.settings` +
 * `persistSettings`(与设置抽屉同源,实时落盘);封面元数据(标题/作者/日期)走
 * `wizardDraft.cover`,付印时随 `runMerge` 传入,不写 settings。
 *
 * 依赖方向单向:本模块 → state/utils(焦点陷阱)/ settings-bindings(preset)/
 * settings-panel(persist/importDocx)/ convert-flow(runMerge)/ wizard-state(纯 reducer);
 * 不反向引用组合根,closeBookWizard 供 dialogs-events 的 Esc 链调用。
 */
import { t, applyStaticTexts } from "../../core/i18n.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import { state } from "../state/state.js";
import { trapFocus } from "../state/utils.js";
import { applyTemplatePreset } from "../settings/settings-bindings.js";
import { importDocxTemplate, persistSettings } from "../settings/settings-panel.js";
import { allPresets } from "../settings/settings-logic.js";
import { renderSelection } from "../convert/file-list.js";
import { runMerge } from "../convert/convert-flow.js";
import {
  canAdvance,
  createDraft,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
  WIZARD_TOTAL_STEPS,
  type WizardDraft,
} from "./wizard-state.js";
import { closeSettingsDrawer, isSettingsDrawerOpen } from "../settings/settings-drawer.js";

/* ---------- 极简 DOM 构造助手(仅本模块使用,避免散落 createElement) ---------- */
type Props = Record<string, unknown>;
function h(tag: string, props: Props = {}, children: (Node | string)[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") el.className = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v as Record<string, string>);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.append(c);
  return el;
}

/** 步骤标签(设计 §3.3 七步名) */
const STEP_LABELS: string[] = [
  t("wizard.stepTemplate"),
  t("wizard.stepCover"),
  t("wizard.stepHeader"),
  t("wizard.stepWatermark"),
  t("wizard.stepMerge"),
  t("wizard.stepToc"),
  t("wizard.stepOutput"),
];

/* ---------- 模块级可变(向导单例) ---------- */
let wizardEl: HTMLElement | null = null;
let releaseTrap: (() => void) | null = null;
let triggerBtn: HTMLElement | null = null;
let draft: WizardDraft = createDraft();
let currentStep = 1;

/* 各步需读写的控件引用(每次 open 重建) */
let coverTitleInput: HTMLInputElement;
let coverAuthorInput: HTMLInputElement;
let coverDateInput: HTMLInputElement;
let coverPreview: HTMLElement;
let coverFromFm: HTMLElement;
let sourcesList: HTMLUListElement;
let sourcesEmpty: HTMLElement;
let formatRadios: HTMLElement;

/* ---------- 封面元数据清洗:全空则不传(回落 frontmatter) ---------- */
function cleanMetadata(cover: WizardDraft["cover"]): DocMetadata | undefined {
  const title = cover.title.trim();
  const author = cover.author.trim();
  const date = cover.date.trim();
  if (!title && !author && !date) return undefined;
  return { title: title || undefined, author: author || undefined, date: date || undefined };
}

/* ---------- 步骤 1:模板预设 ---------- */
function buildStepTemplate(): HTMLElement {
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

  return h("section", { class: "wz-pane", dataset: { step: "1" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.template.label" }, text: t("wizard.template.label") }),
      h("span", { class: "sel-wrap" }, [select]),
    ]),
    h("div", { class: "wz-actions" }, [importBtn]),
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.template.hint" }, text: t("wizard.template.hint") }),
  ]);
}

/* ---------- 步骤 2:封面 ---------- */
function buildStepCover(): HTMLElement {
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
function renderCoverPreview(): void {
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
function buildStepHeader(): HTMLElement {
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
function buildStepWatermark(): HTMLElement {
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

/* ---------- 步骤 5:合并源 ---------- */
function buildStepMerge(): HTMLElement {
  const addBtn = h("button", { type: "button", class: "btn btn-ghost", dataset: { i18n: "wizard.merge.add" } }, [t("wizard.merge.add")]);
  addBtn.addEventListener("click", () => void addSources());
  sourcesList = h("ul", { class: "mlist", id: "wizardSources" }) as HTMLUListElement;
  sourcesEmpty = h("p", { class: "wz-hint", dataset: { i18n: "wizard.merge.empty" }, text: t("wizard.merge.empty") });

  return h("section", { class: "wz-pane", dataset: { step: "5" } }, [
    h("div", { class: "wz-actions" }, [addBtn]),
    sourcesEmpty,
    sourcesList,
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.merge.hint" }, text: t("wizard.merge.hint") }),
  ]);
}

/** 添加合并源文件(多选对话框) */
async function addSources(): Promise<void> {
  try {
    const paths = await window.api.openMarkdowns();
    if (paths.length === 0) return;
    draft.sources.push(...paths);
    syncSources();
    // 选完首文件后预填封面(设计 §4.2 / §4.5)
    if (draft.sources.length >= 1 && !draft.cover.title && !draft.cover.author && !draft.cover.date) {
      await prefillCoverFromFirstSource();
    }
  } catch {
    /* 忽略:对话框失败不阻断向导 */
  }
}

/** 渲染合并源列表(上移/下移/移除) */
function syncSources(): void {
  sourcesList.replaceChildren();
  draft.sources.forEach((file, i) => {
    const name = file.split(/[\\/]/).pop() ?? file;
    const up = h("button", { type: "button", class: "btn btn-ghost sm", text: "↑", title: t("wizard.merge.up") ?? "up" });
    const down = h("button", { type: "button", class: "btn btn-ghost sm", text: "↓", title: t("wizard.merge.down") ?? "down" });
    const remove = h("button", { type: "button", class: "btn btn-text sm", dataset: { i18n: "common.remove" }, text: t("common.remove") });
    if (i === 0) (up as HTMLButtonElement).disabled = true;
    if (i === draft.sources.length - 1) (down as HTMLButtonElement).disabled = true;
    up.addEventListener("click", () => moveSource(i, -1));
    down.addEventListener("click", () => moveSource(i, 1));
    remove.addEventListener("click", () => {
      draft.sources.splice(i, 1);
      syncSources();
    });
    sourcesList.appendChild(
      h("li", { class: "multi-item" }, [
        h("span", { class: "multi-grip", text: String(i + 1) }),
        h("span", { class: "multi-name", text: name, title: file }),
        h("span", { class: "multi-actions" }, [up, down, remove]),
      ]),
    );
  });
  sourcesEmpty.classList.toggle("hidden", draft.sources.length >= 2);
  // 同步主舞台文件列表(向导关闭后可见)
  state.selectedFiles = [...draft.sources];
  renderSelection();
}

function moveSource(i: number, offset: number): void {
  const target = i + offset;
  if (target < 0 || target >= draft.sources.length) return;
  const [m] = draft.sources.splice(i, 1);
  draft.sources.splice(target, 0, m!);
  syncSources();
}

/** 读首文件 frontmatter 预填封面(设计 §4.2) */
async function prefillCoverFromFirstSource(): Promise<void> {
  const first = draft.sources[0];
  if (!first) return;
  try {
    const fm = await window.api.readFrontmatter(first);
    if (fm.title) coverTitleInput.value = draft.cover.title = fm.title;
    if (fm.author) coverAuthorInput.value = draft.cover.author = fm.author;
    if (fm.date) coverDateInput.value = draft.cover.date = fm.date;
    if (fm.title || fm.author || fm.date) coverFromFm.classList.remove("hidden");
    renderCoverPreview();
  } catch {
    /* 忽略:预填失败不阻断 */
  }
}

/* ---------- 步骤 6:目录 ---------- */
function buildStepToc(): HTMLElement {
  const tocSwitch = h("input", { type: "checkbox", class: "switch-input", id: "wizardToc" }) as HTMLInputElement;
  const modeSelect = h("select", { class: "setting-select", id: "wizardTocMode" }, [
    h("option", { value: "static", dataset: { i18n: "wizard.toc.modeStatic" }, text: t("wizard.toc.modeStatic") }),
    h("option", { value: "field", dataset: { i18n: "wizard.toc.modeField" }, text: t("wizard.toc.modeField") }),
  ]) as HTMLSelectElement;

  tocSwitch.addEventListener("change", () => {
    state.settings.toc = tocSwitch.checked;
    persistSettings({ toc: tocSwitch.checked });
  });
  modeSelect.addEventListener("change", () => {
    state.settings.tocMode = modeSelect.value as AppTocMode;
    persistSettings({ tocMode: modeSelect.value as AppTocMode });
  });

  tocSwitch.checked = state.settings.toc;
  modeSelect.value = state.settings.tocMode;

  return h("section", { class: "wz-pane", dataset: { step: "6" } }, [
    h("div", { class: "sw-row" }, [
      h("span", {}, [
        h("span", { class: "row-l", dataset: { i18n: "wizard.toc.enable" }, text: t("wizard.toc.enable") }),
        h("span", { class: "row-sub", dataset: { i18n: "settings.tocHint" }, text: t("settings.tocHint") }),
      ]),
      tocSwitch,
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.toc.mode" }, text: t("wizard.toc.mode") }),
      h("span", { class: "sel-wrap" }, [modeSelect]),
    ]),
  ]);
}

/* ---------- 步骤 7:付印 ---------- */
function buildStepOutput(): HTMLElement {
  formatRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
    radio("wizardFormat", "docx", t("wizard.output.docx"), true),
    radio("wizardFormat", "pdf", t("wizard.output.pdf"), false),
    radio("wizardFormat", "both", t("wizard.output.both"), false),
  ]);
  formatRadios.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) =>
    r.addEventListener("change", () => {
      if (r.checked) draft.format = r.value as WizardDraft["format"];
    }),
  );
  return h("section", { class: "wz-pane", dataset: { step: "7" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.output.format" }, text: t("wizard.output.format") }),
      formatRadios,
    ]),
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.output.start" }, text: t("wizard.output.start") }),
  ]);
}

/* ---------- 小工具:radio / 取值 / 回填 ---------- */
function radio(name: string, value: string, label: string, checked: boolean): HTMLElement {
  const input = h("input", { type: "radio", name, value, ...(checked ? { checked: true } : {}) });
  return h("label", { class: "segment" }, [input, h("span", { text: label })]);
}
function checkedValue(group: HTMLElement): string {
  const inputs = group.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  return Array.from(inputs).find((i) => i.checked)?.value ?? "";
}
function setChecked(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((i) => {
    i.checked = i.value === value;
  });
}

/* 设置类型别名(避免重复 import 长类型链) */
type AppHeaderMode = "default" | "custom" | "none";
type AppHeaderLayout = "center" | "leftRight";
type AppTocMode = "static" | "field";

/* ---------- 向导外壳构建 ---------- */
function buildWizard(): HTMLElement {
  const steps = h("ol", { class: "wizard-steps", id: "wizardSteps", "aria-label": t("wizard.title") });
  for (let i = 1; i <= WIZARD_TOTAL_STEPS; i++) {
    steps.appendChild(
      h("li", { dataset: { step: String(i) } }, [
        h("span", { class: "wz-dot" }),
        h("span", { class: "wz-step-label", text: STEP_LABELS[i - 1] ?? `步骤 ${i}` }),
      ]),
    );
  }

  const body = h("div", { class: "wizard-body", id: "wizardBody" }, [
    buildStepTemplate(),
    buildStepCover(),
    buildStepHeader(),
    buildStepWatermark(),
    buildStepMerge(),
    buildStepToc(),
    buildStepOutput(),
  ]);

  const skipBtn = h("button", { type: "button", id: "wizardSkip", class: "btn btn-text sm", dataset: { i18n: "wizard.skip" } }, [t("wizard.skip")]);
  const prevBtn = h("button", { type: "button", id: "wizardPrev", class: "btn btn-ghost", dataset: { i18n: "wizard.prev" } }, [t("wizard.prev")]);
  const nextBtn = h("button", { type: "button", id: "wizardNext", class: "btn btn-solid", dataset: { i18n: "wizard.next" } }, [t("wizard.next")]);
  const finishBtn = h("button", { type: "button", id: "wizardFinish", class: "btn btn-primary hidden", dataset: { i18n: "wizard.finish" } }, [t("wizard.finish")]);

  skipBtn.addEventListener("click", () => goTo(nextStep(currentStep)));
  prevBtn.addEventListener("click", () => goTo(prevStep(currentStep)));
  nextBtn.addEventListener("click", () => {
    if (canAdvance(currentStep, draft)) goTo(nextStep(currentStep));
  });
  finishBtn.addEventListener("click", () => void finishWizard());

  const closeBtn = h("button", { type: "button", id: "wizardCloseBtn", class: "icon-btn", dataset: { i18nAriaLabel: "wizard.close" }, "aria-label": t("wizard.close") }, [
    h("span", { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' }),
  ]);
  closeBtn.addEventListener("click", () => closeBookWizard());

  const card = h("div", { class: "dialog dialog--wizard", role: "dialog", "aria-modal": "true", "aria-labelledby": "wizardTitle" }, [
    h("header", { class: "wizard-head" }, [
      h("div", { class: "wizard-head-texts" }, [
        h("h2", { id: "wizardTitle", class: "dialog-title", dataset: { i18n: "wizard.title" }, text: t("wizard.title") }),
        h("p", { class: "wizard-sub", dataset: { i18n: "wizard.sub" }, text: t("wizard.sub") }),
      ]),
      closeBtn,
    ]),
    steps,
    body,
    h("footer", { class: "wizard-foot" }, [
      skipBtn,
      h("span", { class: "spacer" }),
      prevBtn,
      nextBtn,
      finishBtn,
    ]),
  ]);

  const overlay = h("div", { id: "bookWizard", class: "dialog-overlay hidden", role: "dialog", "aria-modal": "true", "aria-labelledby": "wizardTitle" }, [card]);
  // 点遮罩关闭(只响应遮罩本身)
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeBookWizard();
  });
  return overlay;
}

/* ---------- 渲染当前步 ---------- */
function renderStep(): void {
  const body = wizardEl?.querySelector<HTMLElement>("#wizardBody");
  if (!body) return;
  body.querySelectorAll<HTMLElement>(".wz-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.step === String(currentStep));
  });
  // stepper 状态着色
  wizardEl?.querySelectorAll<HTMLElement>(".wizard-steps > li").forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle("wz-step--current", step === currentStep);
    li.classList.toggle("wz-step--done", step < currentStep);
    li.classList.toggle("wz-step--future", step > currentStep);
    if (step === currentStep) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  // 导航按钮态
  const prevBtn = wizardEl?.querySelector<HTMLButtonElement>("#wizardPrev");
  const nextBtn = wizardEl?.querySelector<HTMLButtonElement>("#wizardNext");
  const finishBtn = wizardEl?.querySelector<HTMLButtonElement>("#wizardFinish");
  if (prevBtn) prevBtn.disabled = isFirstStep(currentStep);
  if (nextBtn) nextBtn.classList.toggle("hidden", isLastStep(currentStep));
  if (finishBtn) finishBtn.classList.toggle("hidden", !isLastStep(currentStep));
  if (nextBtn) nextBtn.disabled = !canAdvance(currentStep, draft);
  // 进入封面步时若已有源文件则预填
  if (currentStep === 2) void prefillCoverFromFirstSource();
}

function goTo(step: number): void {
  currentStep = Math.min(Math.max(step, 1), WIZARD_TOTAL_STEPS);
  renderStep();
}

/* ---------- 付印 ---------- */
async function finishWizard(): Promise<void> {
  const files = draft.sources.length ? draft.sources : state.selectedFiles;
  const metadata = cleanMetadata(draft.cover);
  closeBookWizard();
  if (draft.format === "both") {
    await runMerge({ files, format: "docx", metadata });
    await runMerge({ files, format: "pdf", metadata });
  } else {
    await runMerge({ files, format: draft.format, metadata });
  }
}

/* ---------- 打开 / 关闭 ---------- */
export function openBookWizard(): void {
  if (wizardEl && !wizardEl.classList.contains("hidden")) return;
  // 与设置抽屉互斥:打开向导前若抽屉开着,先关抽屉(释放其陷阱)
  if (isSettingsDrawerOpen()) closeSettingsDrawer();
  triggerBtn = document.activeElement as HTMLElement;
  draft = createDraft();
  currentStep = 1;
  if (!wizardEl) {
    wizardEl = buildWizard();
    document.body.appendChild(wizardEl);
  }
  // 重置瞬时字段(向导复用缓存 DOM,避免上次输入残留与 draft 不一致)
  coverTitleInput.value = "";
  coverAuthorInput.value = "";
  coverDateInput.value = "";
  coverFromFm.classList.add("hidden");
  renderCoverPreview();
  setChecked(formatRadios, "docx");
  draft.format = "docx";
  sourcesList.replaceChildren();
  sourcesEmpty.classList.remove("hidden");
  wizardEl.classList.remove("hidden");
  // 翻译静态文案(动态构建的 data-i18n 属性);applyStaticTexts 扫描整文档,幂等
  applyStaticTexts();
  renderStep();
  renderCoverPreview();
  // 焦点陷阱(栈式,与抽屉/弹窗同机制)
  releaseTrap?.();
  releaseTrap = trapFocus(wizardEl);
  // 焦点落首个可聚焦元素(关闭钮)
  wizardEl.querySelector<HTMLButtonElement>("#wizardCloseBtn")?.focus();
}

export function closeBookWizard(): void {
  if (!wizardEl || wizardEl.classList.contains("hidden")) return;
  wizardEl.classList.add("hidden");
  releaseTrap?.();
  releaseTrap = null;
  // 焦点归还触发按钮(与 closeSettingsDrawer 同模式)
  triggerBtn?.focus();
  triggerBtn = null;
}
