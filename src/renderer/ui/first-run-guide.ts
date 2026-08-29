/**
 * 首启引导(增强空态):firstRun 且空态时,在空态投放区呈现一张克制引导卡,
 * 列出三步(选预设 → 成书向导(可选) → 转换),明确「零配置出稿」路径;
 * 绝不强制打开设置抽屉。引导可跳过(写 firstRun=false 持久化);
 * 用户离开空态(开始使用)亦视为已引导,不再出现。
 *
 * 依赖方向单向:本模块 → state / refs / wizard / i18n;不反向引用组合根,
 * 经 initUiStateRestore 在读取到 firstRun 后调用 syncFirstRunGuide 触发首屏呈现。
 * 舞台状态变化经 MutationObserver 监听 #dropZone 的 data-stage(避免与 file-list
 * 形成 ESM 环),离开空态即收起并标记已引导。
 */
import { state } from "../state/state.js";
import { dropZone } from "../dom/refs.js";
import { openBookWizard } from "../wizard/book-wizard.js";

let guideEl: HTMLElement | null = null;

/** 初始装配:接线跳过/步骤按钮 + 监听舞台状态变化(离开空态即视为已引导)。 */
export function initFirstRunGuide(): void {
  guideEl = document.getElementById("firstRunGuide");
  if (!guideEl) return;

  const dismissBtn = document.getElementById("firstRunDismiss");
  dismissBtn?.addEventListener("click", () => dismissGuide());

  // 步骤按钮:① 聚焦预设 select(温和指向,不强制);② 打开成书向导(用户显式点击,非强制);
  // ③ 静态文案(空态下转换按钮禁用,仅作路径终点说明)
  guideEl
    .querySelectorAll<HTMLButtonElement>(".frg-step-btn[data-action]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "preset") {
          document.getElementById("quickPreset")?.focus();
        } else if (action === "wizard") {
          openBookWizard();
        }
      });
    });

  // 舞台状态变化:空态 ↔ 文件态;离开空态(用户已着手使用)→ 收起并标记已引导
  const observer = new MutationObserver(() => syncFirstRunGuide());
  observer.observe(dropZone, { attributes: true, attributeFilter: ["data-stage"] });
}

/** 由 initUiStateRestore 在读取到 firstRun 后调用,决定首屏是否呈现引导。 */
export function syncFirstRunGuide(): void {
  if (!guideEl) return;
  const isEmpty = dropZone.dataset.stage === "empty";
  const show = state.firstRun && isEmpty;
  guideEl.classList.toggle("hidden", !show);
  dropZone.classList.toggle("show-guide", show);
  // 离开空态(用户已着手使用)→ 视为已引导,写回 firstRun=false,后续不再出现
  if (!isEmpty && state.firstRun) {
    dismissGuide();
  }
}

/** 收起引导并持久化 firstRun=false(跳过/关闭/离开空态共用)。 */
function dismissGuide(): void {
  // 已收起:仅确保隐藏,避免重复写盘
  if (!state.firstRun) {
    guideEl?.classList.add("hidden");
    dropZone.classList.remove("show-guide");
    return;
  }
  state.firstRun = false;
  guideEl?.classList.add("hidden");
  dropZone.classList.remove("show-guide");
  void window.api.uiStateSet({ firstRun: false }).catch(() => {
    /* 忽略:持久化失败不阻塞主流程 */
  });
}
