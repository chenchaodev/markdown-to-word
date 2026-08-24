/**
 * renderer 最近转换(P1-3 自「主页面独立区块」改造为「主舞台空态快捷 chips」):
 * - 空态(未选文件)时在拖放区内渲染最近 ≤5 条 chips(文件名 + 格式徽标);
 *   有文件后随空态一起隐藏——发生在固定高度主舞台内部,不引起布局跳动,
 *   同时消除原「≥2 文件时区块整体显隐」的推移问题;
 * - 交互收敛为两个可见入口:单击 chip = 加载到文件列表(不转换),
 *   行尾 hover/focus 出现的 ↻ 按钮 = 按该条目记录的格式直接重转
 *   (取代不可发现的双击语义);「清空最近」为 chips 行尾轻量入口;
 * - 转换成功后由 convert-flow 经 state.recentRefreshHandler 回调刷新
 *   (批次 15 R5 接线,打破 recent-files ↔ convert-flow ESM 环);
 * - 启动恢复(initUiStateRestore):panelOpen 回填抽屉可见态、lastSessionFiles
 *   逐项校验存在性(主进程保序过滤)、chips 首次渲染。
 * 依赖方向:recent-files → file-list(applySelection)/convert-flow(runConvert)/
 * settings-drawer(applyDrawerOpenState)。
 */
import {
  recentChips,
  recentChipList,
  recentClearBtn,
  statusEl,
} from "../dom/refs.js";
import type { RecentFile, UiState } from "../../main/persist/ui-state.js";
import { applySelection } from "../convert/file-list.js";
import { runConvert } from "../convert/convert-flow.js";
import { baseName } from "../state/pure.js";
import { setStatus } from "../state/utils.js";
import { state } from "../state/state.js";
import { syncSuppressCompleteDialog } from "../settings/settings-panel.js";
import { applyDrawerOpenState } from "../settings/settings-drawer.js";
import { t } from "../../core/i18n.js";

/** 展示上限(与主进程 ui-state.ts 的 MAX_RECENT_FILES 一致;主进程已截断,防御性再截断)。
 *  MR-4 双源显式化:本值必须与 main 侧 ui-state.ts MAX_RECENT_FILES 恒等(恒等断言
 *  由 test 侧守护段落地,车道 D);改此值须双侧同步。 */
const MAX_RECENT_FILES = 10;

/** 空态 chips 展示条数上限(P1-3:3~5 条取上限,快捷入口保持轻量)。 */
const RECENT_CHIPS_MAX = 5;

/* ---------- 最近转换 chips 渲染 ---------- */
/** 重建快捷 chips;空列表隐藏整个容器(含「清空最近」)。 */
export function renderRecentList(recent: RecentFile[]): void {
  const items = recent.slice(0, MAX_RECENT_FILES).slice(0, RECENT_CHIPS_MAX);
  recentChips.classList.toggle("hidden", items.length === 0);
  recentChipList.replaceChildren(...items.map(renderRecentChip));
}

/** 单条 chip:wrapper(定位上下文)= 主按钮(文件名+格式徽标,单击加载)+ 行尾 ↻ 重转按钮。
 *  不用 button 嵌套(HTML 不允许交互元素嵌套);↻ 经 CSS hover/:focus-within 显现。 */
function renderRecentChip(item: RecentFile): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "recent-chip";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "recent-chip-main";
  // 单击 = 仅加载到列表(不转换);↻ 按钮 = 直接重转(title/aria 同步提示)
  main.title = t("recent.itemTitle", { path: item.path });
  main.dataset.path = item.path;
  main.dataset.format = item.format;
  main.setAttribute("aria-label", t("recent.itemAria", { name: item.name }));

  const name = document.createElement("span");
  name.className = "recent-chip-name";
  name.textContent = item.name || baseName(item.path);

  const format = document.createElement("span");
  format.className = `recent-format recent-format--${item.format}`;
  format.textContent = item.format.toUpperCase();

  main.append(name, format);

  // ↻ 重转按钮:hover/:focus-within 时显现(键盘可达),单击按记录格式直接重转
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "recent-reload";
  reload.title = t("recent.reloadTitle", { path: item.path });
  reload.dataset.path = item.path;
  reload.dataset.format = item.format;
  reload.setAttribute("aria-label", t("recent.reloadAria", { name: item.name }));
  reload.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>';

  wrap.append(main, reload);
  return wrap;
}

/* ---------- 会话恢复 / 抽屉开合恢复 ---------- */
/**
 * 启动恢复(组合根 init 处调用):panelOpen → 抽屉可见态(settings-drawer);
 * lastSessionFiles → 主进程保序过滤存在性(缺失剔除,不提示)→ 单文件态/多文件态恢复;
 * 最近 chips 首次渲染。
 */
export async function initUiStateRestore(): Promise<void> {
  let ui: UiState;
  try {
    ui = await window.api.uiStateGet();
  } catch {
    return; // 读取失败:保持默认(不恢复会话/面板/chips)
  }
  // panelOpen → 设置抽屉可见态(P0-3:开合写回已迁至 settings-drawer,此处只恢复)
  applyDrawerOpenState(ui.panelOpen.page);
  // 批次 11 迭代 2:完成弹窗「不再提示」→ 同步两处 checkbox 与内存态(不写回,避免启动写盘)
  syncSuppressCompleteDialog(ui.suppressCompleteDialog);
  renderRecentList(ui.recentFiles);
  // 会话文件恢复:逐项校验存在性(主进程 filterExistingPaths 保序过滤,缺失剔除)
  try {
    const existing = await window.api.filterExistingPaths(ui.lastSessionFiles);
    if (existing.length > 0) applySelection(existing);
  } catch {
    /* 静默:过滤失败不恢复会话 */
  }
}

/** 转换成功后刷新 chips(uiStateGet 重新拉取;失败保持当前展示)。 */
export async function refreshRecentFiles(): Promise<void> {
  try {
    const ui = await window.api.uiStateGet();
    renderRecentList(ui.recentFiles);
  } catch {
    /* 静默:刷新失败保持当前展示 */
  }
}

/* ---------- 事件绑定(MR-10:顶层监听迁入 bind*Events 范式,组合根 renderer.ts
 *  在 bindEvents() 后调用) ---------- */
/**
 * P1-3 交互语义:单击 chip = 仅加载到列表(不转换);单击 ↻ = 直接重转
 * (沿用该条目记录的格式)。chips 位于拖放区内部,容器级 stopPropagation
 * 阻止冒泡触发拖放区的「点击打开对话框」(click 与 Enter/Space keydown 两路都拦)。
 */
export function bindRecentFilesEvents(): void {
  recentChips.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return; // 转换中守卫(mode 单源)
    const target = event.target as HTMLElement;
    const reloadBtn = target.closest<HTMLButtonElement>(".recent-reload");
    if (reloadBtn?.dataset.path) {
      const filePath = reloadBtn.dataset.path;
      const format = (reloadBtn.dataset.format ?? state.selectedFormat) as "docx" | "pdf";
      void runConvert(filePath, format);
      return;
    }
    const chipMain = target.closest<HTMLButtonElement>(".recent-chip-main");
    if (chipMain?.dataset.path) loadRecentItem(chipMain.dataset.path);
  });

  // 键盘激活(Enter/Space)同样拦截,防冒泡触发拖放区「打开对话框」
  recentChips.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    },
  );

  // 「清空最近」:清空并隐藏 chips(以主进程合并结果为准)
  recentClearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void window.api
      .uiStateSet({ recentFiles: [] })
      .then((ui) => renderRecentList(ui.recentFiles))
      .catch(() => renderRecentList([]));
  });
}

/** 单击加载:替换选择载入列表(不转换),状态区提示文件名。 */
function loadRecentItem(filePath: string): void {
  applySelection([filePath]);
  setStatus(t("recent.loaded", { name: baseName(filePath) }));
  statusEl.title = filePath; // 悬浮可看完整路径(applySelection 的 title 被覆盖后补回)
}
