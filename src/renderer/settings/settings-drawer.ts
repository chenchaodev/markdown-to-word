/**
 * 设置抽屉:开合管理(⚙ 按钮 / 关闭按钮 / 遮罩 / Esc 链末位关闭,焦点陷阱防逃逸,
 * 打开时焦点落当前分组 Tab、关闭后焦点归还触发元素)、开合记忆(ui-state.panelOpen.page;
 * typography 字段为 main 侧形状兼容保留镜像同值,sanitize 契约不变)、转换中可打开
 * (即时生效链路不经过本模块)、副标题「当前预设名 · 纸张」(自顶栏 chip 迁入,由
 * settings-panel 回填/写回后刷新;空文案时 CSS :empty 隐藏)。
 * 依赖方向:本模块 → dom/state/utils 与 core/i18n;不反向引用消费方。
 */
import {
  drawerCloseBtn,
  drawerDoneBtn,
  drawerSubtitle,
  settingsDrawer,
  settingsOpenBtn,
} from "../dom/refs.js";
import { trapFocus, setError, rememberFocusOrigin, restoreFocusOrigin } from "../state/utils.js";
import { t } from "../../core/i18n.js";

/* 焦点陷阱句柄(二次调用防御:先解除旧陷阱再启用新陷阱) */
let drawerTrap: (() => void) | null = null;

export function isSettingsDrawerOpen(): boolean {
  return !settingsDrawer.classList.contains("hidden");
}

/** 抽屉初始焦点落点:当前激活的分组 Tab(roving tabindex 里 tabindex=0 的那枚)。
 *  取 Tab 而非关闭钮的理由:抽屉的主体结构就是左侧六组竖向导航,焦点落在
 *  导航上,方向键即可在组间走,Tab 直接进入当前组面板 —— 与 ARIA 对
 *  「以 tablist 开场的对话框」的落点约定一致。取 .active 类为准(aria-selected
 *  目前只有初始态正确,组切换只同步类名,见 settings-panel.initSettingsTabs)。
 *  导航缺失时退回关闭钮,保证焦点不丢。 */
function focusDrawerEntry(): void {
  const activeTab = settingsDrawer.querySelector<HTMLElement>(".settings-tab.active");
  (activeTab ?? drawerCloseBtn).focus();
}

/** 打开抽屉(幂等);焦点落当前分组 Tab,Tab 循环锁定在抽屉内。 */
export function openSettingsDrawer(): void {
  if (isSettingsDrawerOpen()) return;
  settingsDrawer.classList.remove("hidden");
  rememberFocusOrigin(); // 记下触发元素(顶栏 ⚙),关闭后原样归还
  focusDrawerEntry();
  drawerTrap?.(); // 二次调用防御:先解除旧陷阱再启用新陷阱
  drawerTrap = trapFocus(settingsDrawer);
}

/** 关闭抽屉(幂等);解除陷阱并把焦点还给触发元素(失效则退回可见的主操作钮)。 */
export function closeSettingsDrawer(): void {
  if (!isSettingsDrawerOpen()) return;
  drawerTrap?.();
  drawerTrap = null;
  settingsDrawer.classList.add("hidden");
  restoreFocusOrigin();
  persistDrawerOpen();
}

/**
 * 启动恢复(ui.panelOpen.page → 抽屉可见态;initUiStateRestore 调用)。
 * 恢复打开时同样启用焦点陷阱,键盘行为与手动打开一致;不落焦、不写回。
 */
export function applyDrawerOpenState(open: boolean): void {
  settingsDrawer.classList.toggle("hidden", !open);
  if (open) {
    drawerTrap?.();
    drawerTrap = trapFocus(settingsDrawer);
  }
}

/**
 * panelOpen 写回(page = 抽屉开合;typography 兼容镜像同值,主进程逐字段布尔
 * sanitize 不变)。
 */
function persistDrawerOpen(): void {
  const open = isSettingsDrawerOpen();
  void window.api
    .uiStateSet({ panelOpen: { page: open, typography: open } })
    .catch((err: unknown) => {
      // 开合本身已生效(抽屉状态是本次会话内的真实状态),但下次启动会回到旧值:
      // 写盘失败必须可见,不静默当作"已记住"。
      console.error("[settings-drawer] 抽屉开合记忆写盘失败(下次启动可能恢复旧开合)", err);
      setError(t("preset.saveFailed"));
    });
}

/**
 * 抽屉副标题写入:「预设名 · 纸张」(自顶栏 chip 迁此)。
 * 由 settings-panel 在 applySettingsToControls(回填)与 persistSettings(任一写回)
 * 后调用;空串时按钮经 CSS :empty 隐藏。
 */
export function updateDrawerMeta(metaText: string): void {
  drawerSubtitle.textContent = metaText;
  drawerSubtitle.title = metaText; // 截断时悬浮可看全文
}

/* ---------- 本模块事件绑定(renderer.ts 组合入口调用) ---------- */
export function bindSettingsDrawerEvents(): void {
  // ⚙ 打开
  settingsOpenBtn.addEventListener("click", openSettingsDrawer);

  drawerCloseBtn.addEventListener("click", closeSettingsDrawer);

  // 抽屉底部「完成」按钮与关闭按钮同一关闭路径(焦点归还链一致)
  drawerDoneBtn.addEventListener("click", closeSettingsDrawer);

  // 遮罩点击关闭(只响应遮罩本身,点面板内部不关闭——与弹窗遮罩同语义)
  settingsDrawer.addEventListener("click", (event) => {
    if (event.target === settingsDrawer) closeSettingsDrawer();
  });
}
