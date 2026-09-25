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
 * 生命周期:open 时**重建**外壳(各步骤在构建期读最新 settings,步骤名按当前语言
 * 生成),close 仅隐藏——下次 open 走 dispose + build,不复用旧控件快照。
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
import {
  isBackgroundCommandBlocked,
  isConvertCommandBlocked,
  runMerge,
  withPrecheck,
} from "../convert/convert-flow.js";
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

/** 步骤标签(设计 §3.3 七步名):构建期取当前语言,
 *  不得在模块加载期求值(启动语言未定,且语言切换后旧缓存不会更新)。 */
function stepLabels(): string[] {
  return [
    t("wizard.stepTemplate"),
    t("wizard.stepCover"),
    t("wizard.stepHeader"),
    t("wizard.stepWatermark"),
    t("wizard.stepMerge"),
    t("wizard.stepToc"),
    t("wizard.stepOutput"),
  ];
}

/* ---------- 模块级可变(向导单例外的外壳生命周期:焦点陷阱/触发钮) ---------- */
let releaseTrap: (() => void) | null = null;
let triggerBtn: HTMLElement | null = null;

/* ---------- 向导外壳构建 ---------- */
function buildWizard(): HTMLElement {
  const labels = stepLabels();
  const steps = h("ol", { class: "wizard-steps", id: "wizardSteps", "aria-label": t("wizard.title") });
  for (let i = 1; i <= WIZARD_TOTAL_STEPS; i++) {
    steps.appendChild(
      h("li", { dataset: { step: String(i) } }, [
        h("span", { class: "wz-dot" }),
        h("span", { class: "wz-step-label", text: labels[i - 1] ?? `步骤 ${i}` }),
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

  // 向导内命令入口统一前置校验:转换/预检期间一律不响应(判定口径见 isWizardCommandBlocked),
  // 拒绝时步序不变,用户可继续停留在当前步;关闭向导始终可用,不留死路。
  skipBtn.addEventListener("click", () => {
    if (isWizardCommandBlocked()) return;
    goTo(nextStep(currentStep));
  });
  prevBtn.addEventListener("click", () => {
    if (isWizardCommandBlocked()) return;
    goTo(prevStep(currentStep));
  });
  nextBtn.addEventListener("click", () => {
    if (isWizardCommandBlocked()) return;
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

/**
 * 向导内命令锁判定:与全局入口同一前置校验口径,但不计向导自身遮罩。
 * 向导是当前唯一前台层,它的可见性是自身状态的表达,不是「背景被模态阻断」的信号;
 * 若直接取 isConvertCommandBlocked,向导内每个命令都会被自身遮罩否决。
 * 取判定时临时摘掉自身遮罩并在同一任务内恢复(不产生重排/闪烁,焦点陷阱不受影响)。
 */
function isWizardCommandBlocked(): boolean {
  if (!wizardEl) return isConvertCommandBlocked();
  const visible = !wizardEl.classList.contains("hidden");
  if (visible) wizardEl.classList.add("hidden");
  const blocked = isConvertCommandBlocked();
  if (visible) wizardEl.classList.remove("hidden");
  return blocked;
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

/**
 * 付印提交:整条链(单格式 or docx+pdf 两格式)作为一条命令执行。
 * 期间另有命令(转换/预检)时本次付印不生效且向导保持打开;先解除自身模态再进链,
 * 使链内命令锁判定只反映外部命令;链本身经 withPrecheck 单一 flight 持链,
 * 不会与背景命令并发起第二条链。
 */
async function finishWizard(): Promise<void> {
  if (isWizardCommandBlocked()) return;
  const files = draft.sources.length ? draft.sources : state.selectedFiles;
  const metadata = cleanMetadata(draft.cover);
  const format = draft.format;
  closeBookWizard();
  await withPrecheck([], async () => {
    if (format === "both") {
      await runMerge({ files, format: "docx", metadata });
      // 两次转换处于同一微任务续段,无用户事件可插入;显式复检统一守卫,
      // 前序若留下前台模态(完成弹窗)则第二次转换按单一明确结果拦下
      if (isBackgroundCommandBlocked()) return;
      await runMerge({ files, format: "pdf", metadata });
    } else {
      await runMerge({ files, format, metadata });
    }
  });
}

/* ---------- 打开 / 关闭 ---------- */
export function openBookWizard(): void {
  if (wizardEl && !wizardEl.classList.contains("hidden")) return;
  // 与设置抽屉互斥:打开向导前若抽屉开着,先关抽屉(释放其陷阱)
  if (isSettingsDrawerOpen()) closeSettingsDrawer();
  triggerBtn = document.activeElement as HTMLElement;
  resetDraft();
  setStep(1);
  // 每次打开重建外壳:各步骤控件在构建期从 state.settings 取值,复用旧 DOM 会让
  // 向导停留在上次打开时的设置快照(向导外改过排版/页眉/水印/目录后再开会失真);
  // 重建同时让步骤名按当前语言生成(stepLabels 构建期取 t)。
  wizardEl?.remove();
  releaseTrap?.();
  releaseTrap = null;
  const el = buildWizard();
  setWizardEl(el);
  document.body.appendChild(el);
  // 重置瞬时字段(草稿与控件同源,避免上次输入残留)
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
  const btn = triggerBtn;
  triggerBtn = null;
  if (btn?.isConnected) btn.focus();
  // 触发按钮可能已随舞台状态切换而失效(如向导内选了文件 → 空态按钮消失),
  // 焦点无落点时退回舞台容器(region + tabindex),避免焦点掉到 body
  if (!document.activeElement || document.activeElement === document.body) {
    document.getElementById("dropZone")?.focus();
  }
}
