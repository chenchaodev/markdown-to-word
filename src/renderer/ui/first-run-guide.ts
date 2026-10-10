/**
 * 首启引导(增强空态):firstRun 且空态时,在空态投放区呈现一张克制引导卡,
 * 列出三步(选预设 → 成书向导(可选) → 转换),明确「零配置出稿」路径;
 * 绝不强制打开设置抽屉。引导可跳过(写 firstRun=false 持久化);
 * 用户离开空态(开始使用)亦视为已引导,不再出现。
 *
 * 依赖方向单向:本模块 → state / refs / dom-ops / i18n;不反向引用组合根,
 * 经 initUiStateRestore 在读取到 firstRun 后调用 syncFirstRunGuide 触发首屏呈现。
 * 舞台状态变化经 MutationObserver 监听 #dropZone 的 data-stage(避免与 file-list
 * 形成 ESM 环),离开空态即收起并标记已引导。
 * 对 wizard 的协作经组合根注入的 FirstRunGuideDeps 形参,不再有静态 import。
 */
import { state } from "../state/state.js";
import { dropZone } from "../dom/refs.js";
import { setError } from "../dom/dom-ops.js";
import { t } from "../../core/i18n/index.js";

/**
 * 跨功能协作面(ADR-075 阶段④:组合根组装 · 本模块接形参 · 类型由本 feature 自报;
 * 不新建共享 ports 文件,理由同 ui/recent-files 的同名类型)。
 * **不许给任一项设默认值/可选参数**:port 缺失必须编译不过,不得静默不生效。
 */
export interface FirstRunGuideDeps {
  /** wizard/book-wizard:打开成书向导(引导卡步骤②,用户显式点击才触发)。 */
  openBookWizard: () => void;
}

let guideEl: HTMLElement | null = null;

/** 初始装配:接线跳过/步骤按钮 + 监听舞台状态变化(离开空态即视为已引导)。 */
export function initFirstRunGuide(deps: FirstRunGuideDeps): void {
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
          deps.openBookWizard();
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
  void window.api.uiStateSet({ firstRun: false }).catch((err: unknown) => {
    // 收起与内存态照旧生效(本次会话不再打扰),但下次启动引导会回来:
    // 写盘失败必须可见,否则用户以为"跳过"已生效。
    console.error("[first-run] 引导跳过状态写盘失败(下次启动可能重现引导)", err);
    setError(t("preset.saveFailed"));
  });
}
