/**
 * renderer 设置抽屉(P0-3 自主页面 details 面板迁移):
 * - 开合管理:⚙ 按钮打开,关闭按钮 / 遮罩 / Esc(经 dialogs-events Esc 链末位)
 *   关闭;焦点陷阱开启期间 Tab 不逃逸,关闭后焦点还给 ⚙ 按钮;
 * - 开合记忆:ui-state.panelOpen.page(语义自「details 展开」迁移为「抽屉可见」;
 *   typography 字段为 main 侧形状兼容保留镜像同值,sanitize 契约不变);
 * - 转换中可打开:设置「即时生效+自动保存」链路(persistSettings → previewRefresh)
 *   不经过本模块,开合不影响转换流程;
 * - 抽屉副标题:「当前预设名 · 纸张」(问题 3 自顶栏 chip 迁入),由 settings-panel
 *   在回填/写回后调用 updateDrawerMeta 刷新;空文案时 CSS :empty 隐藏。
 * 依赖方向:本模块 → dom/state/utils 与 core/i18n;不反向引用消费方。
 */
import {
  drawerCloseBtn,
  drawerSubtitle,
  settingsDrawer,
  settingsOpenBtn,
} from "../dom/refs.js";
import { trapFocus } from "../state/utils.js";

/* 焦点陷阱句柄(与弹窗 trapFocus 同款二次调用防御:B8 卫生项) */
let drawerTrap: (() => void) | null = null;

export function isSettingsDrawerOpen(): boolean {
  return !settingsDrawer.classList.contains("hidden");
}

/** 打开抽屉(幂等);焦点落关闭按钮,Tab 循环锁定在抽屉内。 */
export function openSettingsDrawer(): void {
  if (isSettingsDrawerOpen()) return;
  settingsDrawer.classList.remove("hidden");
  drawerCloseBtn.focus();
  drawerTrap?.(); // 二次调用防御:先解除旧陷阱再启用新陷阱
  drawerTrap = trapFocus(settingsDrawer);
}

/** 关闭抽屉(幂等);解除陷阱并把焦点还给触发按钮。 */
export function closeSettingsDrawer(): void {
  if (!isSettingsDrawerOpen()) return;
  drawerTrap?.();
  drawerTrap = null;
  settingsDrawer.classList.add("hidden");
  persistDrawerOpen();
  settingsOpenBtn.focus();
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
 * sanitize 不变)。写入失败静默(UI 状态不阻塞主流程)。
 */
function persistDrawerOpen(): void {
  const open = isSettingsDrawerOpen();
  void window.api
    .uiStateSet({ panelOpen: { page: open, typography: open } })
    .catch(() => {
      /* 忽略:UI 状态写入失败不阻塞主流程 */
    });
}

/**
 * 抽屉副标题写入:「预设名 · 纸张」(问题 3 自顶栏 chip 迁此)。
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

  // 遮罩点击关闭(只响应遮罩本身,点面板内部不关闭——与弹窗遮罩同语义)
  settingsDrawer.addEventListener("click", (event) => {
    if (event.target === settingsDrawer) closeSettingsDrawer();
  });
}
