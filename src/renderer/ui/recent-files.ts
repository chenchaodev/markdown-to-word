/**
 * renderer 最近转换(界面重构 v3 自「空态快捷 chips」改造为「常驻折叠历史条」):
 * - 历史条位于主舞台与消息区之间(不在拖放区内部),无记录整块 hidden 不占位;
 * - 行渲染走 rrow 模式(ui-guidelines §2):图标 + 文件名 + 格式徽标 + mono 时间,
 *   行内动作(重新转换 / 打开所在文件夹)默认安静,hover / focus-within 浮现;
 * - 折叠语义:data-open 驱动 CSS 展开/收起(histToggle 切换 + aria-expanded 同步);
 *   「空态默认展开、有文件默认收起」仅在舞台有无文件的状态发生变化时自动设定,
 *   用户手动切换后尊重其选择,直到该条件再次变化才自动干预;
 * - 交互语义沿用:单击行 = 加载到文件列表(不转换);「重新转换」= 按该条目记录的
 *   格式直接重转;「清空记录」清空并隐藏整条;
 * - 转换成功后由 convert-flow 经 state.recentRefreshHandler 回调刷新
 *   (批次 15 R5 接线,打破 recent-files ↔ convert-flow ESM 环);
 * - 启动恢复(initUiStateRestore):panelOpen 回填抽屉可见态、lastSessionFiles
 *   逐项校验存在性(主进程保序过滤)、历史条首次渲染(置于会话恢复之后,
 *   使折叠自动判定一次到位)。
 * 依赖方向:recent-files → file-list(applySelection)/convert-flow(runConvert)/
 * settings-drawer(applyDrawerOpenState)。
 */
import {
  histCount,
  histToggle,
  historyBar,
  recentClearBtn,
  recentList,
  statusEl,
} from "../dom/refs.js";
import type { RecentFile, UiState } from "../../main/persist/ui-state.js";
import { applySelection } from "../convert/file-list.js";
import { runConvert } from "../convert/convert-flow.js";
import { baseName, errorMessage, formatRecentTime } from "../state/pure.js";
import { setError, setStatus } from "../state/utils.js";
import { state } from "../state/state.js";
import { syncSuppressCompleteDialog } from "../settings/settings-panel.js";
import { applyDrawerOpenState } from "../settings/settings-drawer.js";
import { t, type I18nKey } from "../../core/i18n.js";

/** 展示上限(与主进程 ui-state.ts 的 MAX_RECENT_FILES 一致;主进程已截断,防御性再截断)。
 *  MR-4 双源显式化:本值必须与 main 侧 ui-state.ts MAX_RECENT_FILES 恒等(恒等断言
 *  由 test 侧守护段落地,车道 D);改此值须双侧同步。列表内部滚动由 CSS 负责。 */
const MAX_RECENT_FILES = 10;

/* ---------- 折叠状态 ---------- */
/** 上一次自动干预时的「舞台有无文件」状态(null = 尚未初始化,首次渲染必设定)。 */
let lastStageHasFiles: boolean | null = null;

/** 写入折叠态:data-open 驱动 CSS(grid-rows 过渡),aria-expanded 同步给读屏。 */
function setHistoryOpen(open: boolean): void {
  historyBar.dataset.open = open ? "true" : "false";
  histToggle.setAttribute("aria-expanded", String(open));
}

/* ---------- 历史条渲染 ---------- */
/** 重建历史行;空列表隐藏整个历史条(含标题条与「清空记录」)。 */
export function renderRecentList(recent: RecentFile[]): void {
  const items = recent.slice(0, MAX_RECENT_FILES);
  historyBar.classList.toggle("hidden", items.length === 0);
  if (items.length === 0) return; // 整块隐藏时无需渲染行与折叠态
  histCount.textContent = String(items.length);
  recentList.replaceChildren(...items.map(renderRecentRow));
  // 空态默认展开、有文件默认收起:仅当舞台状态变化时自动设定(尊重手动切换)
  const stageHasFiles = state.selectedFiles.length > 0;
  if (stageHasFiles !== lastStageHasFiles) {
    lastStageHasFiles = stageHasFiles;
    setHistoryOpen(!stageHasFiles);
  }
}

/** 单条历史行(li.rrow):图标 + 主信息(文件名 + 徽标/时间)+ 行内动作组。
 *  行本体承载单击加载(data-path);动作按钮经 data-action 区分,不用嵌套交互元素。 */
function renderRecentRow(item: RecentFile): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "rrow";
  row.dataset.path = item.path;

  // 图标块(纯装饰)
  const icon = document.createElement("span");
  icon.className = "rico";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />' +
    '<path d="M14 2v6h6" /></svg>';

  // 主信息:文件名(title 悬浮看完整路径)+ 徽标与 mono 相对时间
  const main = document.createElement("div");
  main.className = "rmain";

  const name = document.createElement("div");
  name.className = "rname";
  name.textContent = item.name || baseName(item.path);
  name.title = item.path;

  const meta = document.createElement("div");
  meta.className = "rmeta";

  const format = document.createElement("span");
  format.className = `tag ${item.format}`;
  format.textContent = item.format.toUpperCase();

  const time = document.createElement("span");
  time.className = "rtime";
  // 相对时间文案走字典(recent.time.*);t 为类型化门面,此处动态 key 经窄化适配
  time.textContent = formatRecentTime(
    item.ts,
    undefined,
    (key, params) => t(key as I18nKey, params),
  );

  meta.append(format, time);
  main.append(name, meta);

  // 行内动作:hover / :focus-within 浮现(键盘可达)
  const ops = document.createElement("div");
  ops.className = "rops";

  const reconvert = document.createElement("button");
  reconvert.type = "button";
  reconvert.className = "icon-btn";
  reconvert.dataset.action = "reconvert";
  reconvert.dataset.path = item.path;
  reconvert.dataset.format = item.format;
  reconvert.title = t("history.reconvert");
  reconvert.setAttribute("aria-label", t("history.reconvert"));
  reconvert.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>';

  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "icon-btn";
  reveal.dataset.action = "reveal";
  reveal.dataset.path = item.path;
  reveal.title = t("common.reveal");
  reveal.setAttribute("aria-label", t("common.reveal"));
  reveal.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>';

  ops.append(reconvert, reveal);
  row.append(icon, main, ops);
  return row;
}

/* ---------- 会话恢复 / 抽屉开合恢复 ---------- */
/**
 * 启动恢复(组合根 init 处调用):panelOpen → 抽屉可见态(settings-drawer);
 * lastSessionFiles → 主进程保序过滤存在性(缺失剔除,不提示)→ 单文件态/多文件态恢复;
 * 历史条首次渲染(在会话恢复之后,折叠自动判定以最终舞台状态一次到位)。
 */
export async function initUiStateRestore(): Promise<void> {
  let ui: UiState;
  try {
    ui = await window.api.uiStateGet();
  } catch {
    return; // 读取失败:保持默认(不恢复会话/面板/历史条)
  }
  // panelOpen → 设置抽屉可见态(P0-3:开合写回已迁至 settings-drawer,此处只恢复)
  applyDrawerOpenState(ui.panelOpen.page);
  // 批次 11 迭代 2:完成弹窗「不再提示」→ 同步弹窗内 checkbox 与内存态(不写回,避免启动写盘)
  syncSuppressCompleteDialog(ui.suppressCompleteDialog);
  // 会话文件恢复:逐项校验存在性(主进程 filterExistingPaths 保序过滤,缺失剔除)
  try {
    const existing = await window.api.filterExistingPaths(ui.lastSessionFiles);
    if (existing.length > 0) applySelection(existing);
  } catch {
    /* 静默:过滤失败不恢复会话 */
  }
  renderRecentList(ui.recentFiles);
}

/** 转换成功后刷新历史条(uiStateGet 重新拉取;失败保持当前展示)。 */
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
 * 交互接线:histToggle 切换折叠(data-open + aria-expanded,CSS 按 data-open 展开);
 * recentList 事件委托——动作按钮按 data-action 分派(重新转换 / 打开所在文件夹),
 * 其余点击落在行上 = 仅加载到列表(不转换)。历史条不在拖放区内部,无需拦截冒泡。
 */
export function bindRecentFilesEvents(): void {
  histToggle.addEventListener("click", () => {
    setHistoryOpen(historyBar.dataset.open !== "true");
  });

  recentList.addEventListener("click", (event) => {
    if (state.mode !== null) return; // 转换中守卫(mode 单源)
    const target = event.target as HTMLElement;
    const actionBtn = target.closest<HTMLButtonElement>("[data-action]");
    if (actionBtn?.dataset.path) {
      const filePath = actionBtn.dataset.path;
      if (actionBtn.dataset.action === "reconvert") {
        // 按该条目记录的格式直接重转
        const format = (actionBtn.dataset.format ?? state.selectedFormat) as "docx" | "pdf";
        void runConvert(filePath, format);
      } else if (actionBtn.dataset.action === "reveal") {
        // 打开源文件所在文件夹(MR-12:白名单外路径主进程返回 { ok:false, error })
        void window.api
          .revealInFolder(filePath)
          .then((result) => {
            if (!result.ok) setError(t("common.revealFailed", { error: result.error ?? "" }));
          })
          .catch((err) =>
            setError(t("common.revealFailed", { error: errorMessage(err) })),
          );
      }
      return;
    }
    const row = target.closest<HTMLElement>(".rrow");
    if (row?.dataset.path) loadRecentItem(row.dataset.path);
  });

  // 「清空记录」:清空并隐藏整条(以主进程合并结果为准)
  recentClearBtn.addEventListener("click", () => {
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
