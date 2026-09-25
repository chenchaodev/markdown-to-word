/**
 * 成书向导步骤渲染·交付三步(拆分自 book-wizard.ts,D1,纯搬移零行为改动)
 * 「步骤渲染」块之二:⑤合并源(列表增删/排序 + 首文件 frontmatter 预填封面)
 * ⑥目录与编号 ⑦付印格式/输出目录/导出后行为;控件形态与设置抽屉同源。
 * 另含当前步渲染 renderStep:合并源增减后须即时刷新导航按钮态(「下一步」
 * disabled 依赖 canAdvance 第 5 步门槛,否则停留陈旧值),与 syncSources 互调
 * 同岛落位——拆分以依赖无环优先(renderStep 不入外壳,否则本岛 ⇄ 外壳成环)。
 * 版式四步见 wizard-steps.ts,字段校验见 wizard-fields.ts,外壳/付印提交见
 * book-wizard.ts。
 * 依赖方向:本模块 → wizard-fields、wizard-runtime、wizard-steps(封面预览/引用)、
 * core / state / settings-* / convert(单向),不反向引用外壳。
 */
import { t } from "../../core/i18n.js";
import { AppSettings } from "../../core/settings/settings-defaults.js";
import { state } from "../state/state.js";
import { persistSettings } from "../settings/settings-panel.js";
import { outputDirDisplayText } from "../settings/settings-logic.js";
import { renderSelection } from "../convert/file-list.js";
import {
  canAdvance,
  isFirstStep,
  isLastStep,
  type WizardDraft,
} from "./wizard-state.js";
import { checkedValue, h, pickOutputDir, radio, swRow, type AppTocMode } from "./wizard-fields.js";
import { currentStep, draft, wizardEl } from "./wizard-runtime.js";
import {
  coverAuthorInput,
  coverDateInput,
  coverFromFm,
  coverTitleInput,
  renderCoverPreview,
} from "./wizard-steps.js";

/* 各步需读写的合并源/格式控件引用(每次 open 由 buildStepMerge/buildStepOutput 重建) */
export let sourcesList: HTMLUListElement;
export let sourcesEmpty: HTMLElement;
export let formatRadios: HTMLElement;

/* ---------- 步骤 5:合并源 ---------- */
export function buildStepMerge(): HTMLElement {
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
  // 合并源增减后即时刷新导航按钮态(否则「下一步」disabled 停留陈旧值,见 canAdvance 第 5 步门槛)
  renderStep();
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
export function buildStepToc(): HTMLElement {
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

  /* 编号开关区:章节/题注/公式编号 + H1 前分页(与设置抽屉 04 组同源) */
  const numberingTitle = h("div", { class: "sub-label", dataset: { i18n: "settings.groupNumbering" }, text: t("settings.groupNumbering") });
  const numRows = h("div", { class: "wz-num-block" }, [
    swRow("settings.headingNumbering", "settings.headingNumberingDesc", state.settings.typography.headingNumbering, (v) => {
      state.settings.typography.headingNumbering = v;
      persistSettings({ typography: { ...state.settings.typography } });
    }),
    swRow("settings.captionNumbering", "settings.captionNumberingDesc", state.settings.typography.captionNumbering, (v) => {
      state.settings.typography.captionNumbering = v;
      persistSettings({ typography: { ...state.settings.typography } });
    }),
    swRow("settings.equationNumbering", "settings.equationNumberingDesc", state.settings.equationNumbering, (v) => {
      state.settings.equationNumbering = v;
      persistSettings({ equationNumbering: v });
    }),
    swRow("settings.breakBeforeH1", "settings.breakBeforeH1Desc", state.settings.breakBeforeH1, (v) => {
      state.settings.breakBeforeH1 = v;
      persistSettings({ breakBeforeH1: v });
    }),
  ]);

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
    numberingTitle,
    numRows,
  ]);
}

/* ---------- 步骤 7:付印 ---------- */
export function buildStepOutput(): HTMLElement {
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

  /* 输出目录 + 导出后行为(与设置抽屉 05 组同源) */
  const outDirChip = h("span", {
    class: "path-chip",
    id: "wizardOutputDir",
    text: outputDirDisplayText(state.settings.outputDir),
  });
  const outDirPick = h("button", {
    type: "button", class: "btn btn-ghost sm", dataset: { i18n: "settings.outputDirPick" },
  }, [t("settings.outputDirPick")]);
  const outDirReset = h("button", {
    type: "button", class: "btn btn-text sm", dataset: { i18n: "settings.outputDirReset" },
  }, [t("settings.outputDirReset")]);
  outDirPick.addEventListener("click", () => void pickOutputDir(outDirChip));
  outDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    outDirChip.textContent = t("settings.outputDirDefault");
    outDirChip.title = "";
    persistSettings({ outputDir: "" });
  });

  const afterRadios = h("span", { class: "segmented seg-sm", role: "radiogroup" }, [
    radio("wizardAfterConvert", "none", t("settings.afterNone"), state.settings.afterConvert === "none"),
    radio("wizardAfterConvert", "show-in-folder", t("common.reveal"), state.settings.afterConvert === "show-in-folder"),
    radio("wizardAfterConvert", "open", t("common.open"), state.settings.afterConvert === "open"),
  ]);
  afterRadios.addEventListener("change", () => {
    state.settings.afterConvert = checkedValue(afterRadios) as AppSettings["afterConvert"];
    persistSettings({ afterConvert: state.settings.afterConvert });
  });

  return h("section", { class: "wz-pane", dataset: { step: "7" } }, [
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "wizard.output.format" }, text: t("wizard.output.format") }),
      formatRadios,
    ]),
    h("div", { class: "sub-label", dataset: { i18n: "wizard.output.title" }, text: t("wizard.output.title") }),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.outputDir" }, text: t("settings.outputDir") }),
      h("span", { class: "row-sub", dataset: { i18n: "settings.outputDirHint" }, text: t("settings.outputDirHint") }),
      h("div", { class: "outputdir-row" }, [outDirChip, outDirPick, outDirReset]),
    ]),
    h("div", { class: "wz-field" }, [
      h("label", { class: "wz-label", dataset: { i18n: "settings.afterConvert" }, text: t("settings.afterConvert") }),
      afterRadios,
    ]),
    h("p", { class: "wz-hint", dataset: { i18n: "wizard.output.start" }, text: t("wizard.output.start") }),
  ]);
}

/* ---------- 渲染当前步(导航态;与合并源联动刷新同岛,见文件头) ---------- */
export function renderStep(): void {
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
