/**
 * 成书向导模态(renderer 内 stepper 模态,非独立窗口):
 * 把模板预设 / 封面 / 页眉页脚 / 水印 / 合并 / 目录 / 付印 串成一条「成书」流程。
 * 严格复用既有设计令牌、`.dialog-overlay` 模态模式与栈式 `trapFocus`(与设置抽屉/
 * 完成弹窗同机制);不发明新控件形态(枚举 ≤5 → seg、布尔 → switch、路径/文本 → tin)。
 *
 * D1 拆分(纯搬移零行为改动,967 行 → 五文件),三块口径:
 * - 步骤渲染:wizard-steps.ts(版式四步:模板/封面/页眉页脚/水印)+
 *   wizard-steps-delivery.ts(交付三步:合并源/目录/付印,含与合并源联动的
 *   当前步渲染 renderStep——互调同岛,拆分以依赖无环优先)
 * - 校验:wizard-fields.ts(边距/字号/行距/字体钳制校验绑定 + 共用 DOM/radio 零件)
 * - 提交:本文件「付印提交」节(cleanMetadata + finishWizard)+ 外壳/导航/打开关闭
 * - wizard-runtime.ts:草稿/容器/步序单例(ESM 导入绑定只读,赋值经
 *   resetDraft/setStep/setWizardEl 收口,避免单例留外壳成环)
 *
 * 状态归属(设计 §3.6):向导内改的模板/页眉/水印/目录直接写 `state.settings` +
 * `persistSettings`(与设置抽屉同源,实时落盘);封面元数据(标题/作者/日期)走
 * `wizardDraft.cover`,付印时随 `runMerge` 传入,不写 settings。
 *
 * 依赖方向单向:本模块 → wizard-runtime/fields/steps/steps-delivery(渲染)/
 * state/utils(焦点陷阱)/ settings-drawer / convert-flow(runMerge)/ wizard-state(纯 reducer);
 * 不反向引用组合根,closeBookWizard 供 dialogs-events 的 Esc 链调用。
 */
import { t, applyStaticTexts } from "../../core/i18n.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import { state } from "../state/state.js";
import { trapFocus } from "../state/utils.js";
import { runMerge } from "../convert/convert-flow.js";
import {
  WIZARD_TOTAL_STEPS,
  canAdvance,
  nextStep,
  prevStep,
  type WizardDraft,
} from "./wizard-state.js";
import { closeSettingsDrawer, isSettingsDrawerOpen } from "../settings/settings-drawer.js";
import { h, setChecked } from "./wizard-fields.js";
import {
  currentStep,
  draft,
  resetDraft,
  setStep,
  setWizardEl,
  wizardEl,
} from "./wizard-runtime.js";
import {
  buildStepCover,
  buildStepHeader,
  buildStepTemplate,
  buildStepWatermark,
  coverAuthorInput,
  coverDateInput,
  coverFromFm,
  coverTitleInput,
  renderCoverPreview,
} from "./wizard-steps.js";
import {
  buildStepMerge,
  buildStepOutput,
  buildStepToc,
  formatRadios,
  renderStep,
  sourcesEmpty,
  sourcesList,
} from "./wizard-steps-delivery.js";

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

/* ---------- 模块级可变(向导单例外的外壳生命周期:焦点陷阱/触发钮) ---------- */
let releaseTrap: (() => void) | null = null;
let triggerBtn: HTMLElement | null = null;

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

function goTo(step: number): void {
  setStep(Math.min(Math.max(step, 1), WIZARD_TOTAL_STEPS));
  renderStep();
}

/* ---------- 付印提交 ---------- */
/* 封面元数据清洗:全空则不传(回落 frontmatter) */
function cleanMetadata(cover: WizardDraft["cover"]): DocMetadata | undefined {
  const title = cover.title.trim();
  const author = cover.author.trim();
  const date = cover.date.trim();
  if (!title && !author && !date) return undefined;
  return { title: title || undefined, author: author || undefined, date: date || undefined };
}

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
  resetDraft();
  setStep(1);
  let el = wizardEl;
  if (!el) {
    el = buildWizard();
    setWizardEl(el);
    document.body.appendChild(el);
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
  el.classList.remove("hidden");
  // 翻译静态文案(动态构建的 data-i18n 属性);applyStaticTexts 扫描整文档,幂等
  applyStaticTexts();
  renderStep();
  renderCoverPreview();
  // 焦点陷阱(栈式,与抽屉/弹窗同机制)
  releaseTrap?.();
  releaseTrap = trapFocus(el);
  // 焦点落首个可聚焦元素(关闭钮)
  el.querySelector<HTMLButtonElement>("#wizardCloseBtn")?.focus();
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
