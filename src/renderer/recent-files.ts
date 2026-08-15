/**
 * renderer 最近转换区块与会话恢复(批次 11 迭代 1「状态记忆」):
 * - 最近文件 UI:默认态(无文件)与单文件态显示;条目 = 文件名 + 格式 + 相对时间;
 *   点击条目 → 加载该文件到列表(单文件态)并立即开始转换(一键重转,沿用条目记录的格式);
 *   「清空最近」→ 清空并隐藏;空列表不显示区块
 * - 转换成功后由 convert-flow 调用 refreshRecentFiles()(uiStateGet 重新拉取;
 *   主进程在返回转换结果前已完成 recentFiles 写入,读回必为最新)
 * - 启动恢复(initUiStateRestore):panelOpen 回填两个设置面板 details 展开态、
 *   lastSessionFiles 逐项校验存在性(主进程保序过滤,缺失剔除,不提示)、最近区块首次渲染
 * - 设置面板 details toggle → 记忆 panelOpen(ui-state 独立文件,不碰 settings.json)
 * 依赖方向:recent-files → file-list(applySelection)/convert-flow(runConvert);
 * 转换成功后刷新最近区块由 convert-flow 经 state.recentRefreshHandler 回调触发
 * (批次 15 R5:组合根 renderer.ts 接线,打破原 recent-files ↔ convert-flow ESM 环)。
 */
import {
  recentClearBtn,
  recentList,
  recentSection,
  settingsPanel,
  statusEl,
  typographyPanel,
} from "./dom.js";
import type { RecentFile, UiState } from "../main/ui-state.js";
import { applySelection } from "./file-list.js";
import { runConvert } from "./convert-flow.js";
import { baseName, formatRecentTime } from "./pure.js";
import { setStatus } from "./utils.js";
import { state } from "./state.js";
import { syncSuppressCompleteDialog } from "./settings-panel.js";

/** 展示上限(与主进程 ui-state.ts 的 MAX_RECENT_FILES 一致;主进程已截断,防御性再截断)。 */
const MAX_RECENT_FILES = 10;

/* ---------- 最近转换区块渲染 ---------- */
/** 重建最近文件列表;空列表隐藏整个区块。 */
export function renderRecentList(recent: RecentFile[]): void {
  const items = recent.slice(0, MAX_RECENT_FILES);
  state.recentFiles = items;
  // 显隐双条件:列表非空 且 当前为默认态/单文件态(多文件态由 renderSelection 管理同条件)
  recentSection.classList.toggle(
    "hidden",
    items.length === 0 || state.selectedFiles.length >= 2,
  );
  recentList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = "recent-item-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-item";
      btn.title = `重新转换 ${item.path}`;
      btn.dataset.path = item.path;
      btn.dataset.format = item.format;
      btn.setAttribute("aria-label", `重新转换 ${item.name}`);

      const name = document.createElement("span");
      name.className = "recent-name";
      name.textContent = item.name || baseName(item.path);
      name.title = item.path;

      const format = document.createElement("span");
      format.className = `recent-format recent-format--${item.format}`;
      format.textContent = item.format.toUpperCase();

      const time = document.createElement("span");
      time.className = "recent-time";
      time.textContent = formatRecentTime(item.ts);

      btn.append(name, format, time);
      li.appendChild(btn);

      // 批次 12(C12):「仅加载」次级入口——载入列表(替换选择,不转换),
      // 用户可调整设置后再转换;点击条目主区域仍是一键重转
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "recent-load";
      loadBtn.textContent = "仅加载";
      loadBtn.title = `仅加载到文件列表(不转换) ${item.path}`;
      loadBtn.dataset.path = item.path;
      loadBtn.setAttribute("aria-label", `仅加载 ${item.name}`);
      li.appendChild(loadBtn);
      return li;
    }),
  );
}

/* ---------- 会话恢复 / 面板展开态 ---------- */
/**
 * 启动恢复(组合根 init 处调用):面板展开态 → 两个 details;
 * lastSessionFiles → 主进程保序过滤存在性(缺失剔除,不提示)→ 单文件态/多文件态恢复;
 * 最近文件区块首次渲染。
 */
export async function initUiStateRestore(): Promise<void> {
  let ui: UiState;
  try {
    ui = await window.api.uiStateGet();
  } catch {
    return; // 读取失败:保持默认(不恢复会话/面板/最近列表)
  }
  // panelOpen → 两个设置面板展开态(程序化赋值会触发 toggle,写回相同值,无害)
  settingsPanel.open = ui.panelOpen.page;
  typographyPanel.open = ui.panelOpen.typography;
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

/** 转换成功后刷新最近区块(uiStateGet 重新拉取;失败保持当前展示)。 */
export async function refreshRecentFiles(): Promise<void> {
  try {
    const ui = await window.api.uiStateGet();
    renderRecentList(ui.recentFiles);
  } catch {
    /* 静默:刷新失败保持当前展示 */
  }
}

/* ---------- 事件绑定 ---------- */
/** 设置面板 details 展开态记忆(批次 11;ui-state 独立于 settings)。 */
function persistPanelOpen(): void {
  void window.api
    .uiStateSet({ panelOpen: { page: settingsPanel.open, typography: typographyPanel.open } })
    .catch(() => {
      /* 忽略:UI 状态写入失败不阻塞主流程 */
    });
}

// 最近条目点击:加载到列表(单文件态)并立即开始转换(一键重转,沿用该条目记录的格式)
recentList.addEventListener("click", (event) => {
  if (state.converting) return;
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".recent-item");
  if (!btn?.dataset.path) return;
  const filePath = btn.dataset.path;
  const format = (btn.dataset.format ?? state.selectedFormat) as "docx" | "pdf";
  applySelection([filePath]);
  void runConvert(filePath, format);
});

// 批次 12(C12):「仅加载」→ 替换选择载入列表(不转换),状态区提示文件名;
// 与主区域点击互斥(loadBtn 不是 .recent-item 的后代,上方委托天然跳过)
recentList.addEventListener("click", (event) => {
  if (state.converting) return;
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".recent-load");
  if (!btn?.dataset.path) return;
  const filePath = btn.dataset.path;
  applySelection([filePath]);
  setStatus(`已加载:${baseName(filePath)}`);
  statusEl.title = filePath; // 悬浮可看完整路径(applySelection 的 title 被覆盖后补回)
});

// 「清空最近」:清空并隐藏区块(以主进程合并结果为准)
recentClearBtn.addEventListener("click", () => {
  void window.api
    .uiStateSet({ recentFiles: [] })
    .then((ui) => renderRecentList(ui.recentFiles))
    .catch(() => renderRecentList([]));
});

settingsPanel.addEventListener("toggle", persistPanelOpen);
typographyPanel.addEventListener("toggle", persistPanelOpen);
