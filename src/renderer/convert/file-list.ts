/**
 * 文件选择与列表:拖放区三态渲染、统一队列卡构建与排序、移除按钮工厂、
 * 选择应用/追加、操作按钮可用性。只经 state.ts 读写状态。
 *
 * 不变量:data-stage(empty/single/multi)驱动 CSS 切换同一 .pane-files;
 * renderMultiList 覆盖 n≥1 全部情形(n=1 省略 grip/序号且不可拖拽);
 * 「预览」仅单文件可见,「清空列表」兼并单文件移除语义。
 * 操作按钮忙态 = 转换中(state.mode 单源)或命令锁持有中(预检,探针注入,
 * 与各入口点击守卫同源)。
 * 会话持久化(lastSessionFiles)只有一个写入点:renderQueue 内的 persistSessionFiles;
 * renderSelection 与 renderMultiList(排序/移除重排)都经它,同一次渲染不重复写盘,
 * 纯重渲染(语言切换等)内容未变亦不产生 mutation;写失败不静默(状态区提示 + 留痕)。
 */
import {
  appendFileBtn,
  batchBtn,
  clearListBtn,
  convertBtn,
  convertHint,
  dropZone,
  mergeBtn,
  multiCount,
  multiList,
  previewBtn,
  selectBtn,
  statusEl,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError, setStatus, translate } from "../state/utils.js";
import { baseName, partitionDuplicates, selectionStatus, truncateMiddle } from "../state/pure.js";
import { t } from "../../core/i18n.js";

export function renderSelection(): void {
  const n = state.selectedFiles.length;
  // data-stage 驱动 CSS 切换;几何恒定,外部开合变化不影响本区块尺寸
  dropZone.dataset.stage = n === 0 ? "empty" : n === 1 ? "single" : "multi";
  // has-file 标记保留供拖入高亮分支与测试诊断使用
  dropZone.classList.toggle("has-file", n > 0);
  // 舞台状态变化通知:历史浮出面板据此自动收起;handler 由 recent-files 注册,
  // 反向注册避免 ESM 环
  state.stageChangedHandler?.();

  // 队列行渲染与会话持久化一次完成(同一写入点,不再按空/非空分支各写一次)
  renderQueue();
  updateActionButtons();
}

/** 重建队列列表(移除/键盘排序/拖拽排序后重排,不经 renderSelection 的快捷入口)。
 *  行结构契约见 renderQueue:n=1 单行(无 grip/序号,draggable=false,双击仍可预览);
 *  n≥2 完整队列行(手柄 + 序号 + 文件名 + 移除),严格按 selectedFiles 顺序。 */
export function renderMultiList(): void {
  renderQueue();
}

/** 队列渲染 + 会话持久化的唯一组合入口:
 *  - n≥1 渲染队列行,n=0 时 replaceChildren 清空(选择被清空的既有行为);
 *  - 排序 = 整行拖拽 + 键盘补偿(行聚焦后 Alt+↑/↓),预览 = 行双击(见 events/selection);
 *  - 收尾经 persistSessionFiles 落一次会话持久化,两条渲染路径共用此单一写入点。 */
function renderQueue(): void {
  const n = state.selectedFiles.length;
  multiCount.textContent = t("file.selectedCount", { count: n });
  multiList.replaceChildren(
    ...state.selectedFiles.map((filePath, index) => {
      const li = document.createElement("li");
      li.className = "multi-item";
      const sortable = n >= 2;
      li.draggable = sortable;
      li.dataset.index = String(index);
      li.tabIndex = 0; // 可聚焦:键盘 Alt+↑/↓ 排序的落点
      li.title = `${filePath}\n${t("file.dblclickPreview")}`;

      if (sortable) {
        const grip = document.createElement("span");
        grip.className = "multi-grip";
        grip.setAttribute("aria-hidden", "true");
        grip.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>';

        const num = document.createElement("span");
        num.className = "multi-index";
        num.textContent = String(index + 1);

        li.append(grip, num);
      }

      const name = document.createElement("span");
      name.className = "multi-name";
      name.textContent = baseName(filePath);

      const actions = document.createElement("span");
      actions.className = "multi-actions";
      actions.append(makeRemoveButton(baseName(filePath)));

      li.append(name, actions);
      return li;
    }),
  );
  persistSessionFiles();
}

/** 已成功写盘(uiStateSet resolve)的会话文件内容键:用于跳过内容未变的重复写入
 *  (纯重渲染,如语言切换后的 renderSelection)。失败不记入,保证下次保存仍会重试。 */
let persistedSessionKey: string | null = null;

/**
 * 会话文件持久化(唯一写入点,由 renderQueue 调用):
 * - 内容与上次成功写盘一致 → 跳过,避免同一渲染路径产生重复 ui-state mutation;
 * - 写失败:保留编辑内容(列表不变、main 缓存与磁盘停在最后一次成功值),状态区
 *   统一提示保存失败并留痕,禁止静默显示成功;不记入 key,后续保存可恢复。
 */
export function persistSessionFiles(): void {
  const files = [...state.selectedFiles];
  const key = JSON.stringify(files);
  if (key === persistedSessionKey) return;
  void window.api.uiStateSet({ lastSessionFiles: files }).then(
    () => {
      persistedSessionKey = key;
    },
    (err: unknown) => {
      console.error("[file-list] 会话文件写盘失败", err);
      setError(t("preset.saveFailed"));
    },
  );
}

/** 移除该文件的图标按钮。 */
export function makeRemoveButton(fileName: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "multi-remove";
  btn.dataset.dir = "remove";
  btn.title = t("common.remove");
  btn.setAttribute("aria-label", t("file.removeAria", { name: fileName }));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M18 6L6 18M6 6l12 12");
  svg.appendChild(path);
  btn.appendChild(svg);
  return btn;
}

export function moveItem(index: number, offset: -1 | 1): void {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.selectedFiles.length) return;
  const [moved] = state.selectedFiles.splice(index, 1);
  state.selectedFiles.splice(target, 0, moved!); // 上方边界守卫保证 index 合法,splice 必移除一项
  renderMultiList();
}

export function clearDragState(): void {
  state.dragIndex = -1;
  state.dragDropAfter = false;
  multiList.querySelectorAll(".multi-item").forEach((el) => {
    el.classList.remove("dragging", "drop-before", "drop-after");
  });
}

/**
 * 记录已选文件并更新界面。
 * @param skipped 被跳过(非 md / 无法读取)的项数,>0 时状态区黄色提示。
 * @param duplicates 重复文件数,与非 Markdown 跳过分开提示。
 */
export function applySelection(files: string[], skipped = 0, duplicates = 0): void {
  state.selectedFiles = files;
  renderSelection();
  const summary =
    files.length === 1
      ? truncateMiddle(files[0]!) // length === 1 分支下标 0 必存在
      : t("file.selectedSummary", { count: files.length });
  const full = selectionStatus(summary, skipped, duplicates, translate);
  setStatus(full, false, skipped > 0 || duplicates > 0);
  statusEl.title = files.length === 1 ? files[0]! : full; // length === 1 分支下标 0 必存在
}

/**
 * 追加选择:与现有列表合并(去重),供「追加文件 / 点击继续添加」使用。
 * @param skipped 本次被跳过的非 md 项数。
 * 重复文件不再并入 skipped 计数,单独文案提示。
 */
export function appendSelection(files: string[], skipped = 0): void {
  const { added, duplicates } = partitionDuplicates(state.selectedFiles, files);
  applySelection([...state.selectedFiles, ...added], skipped, duplicates.length);
}

/**
 * 命令忙探针(依赖注入):命令锁持有中(预检进行中)时按钮同样置灰,
 * 与各入口点击守卫同源,避免「看着可点、点了没反应」。
 * 探针由 convert-flow 在模块加载期注入(它持命令锁,且已依赖本模块),
 * 本模块不反向 import,保持依赖单向。
 */
let commandBusyProbe: (() => boolean) | null = null;

/** 注册命令忙探针(命令域加载期注册一次,单源)。 */
export function setCommandBusyProbe(probe: () => boolean): void {
  commandBusyProbe = probe;
}

export function updateActionButtons(): void {
  const n = state.selectedFiles.length;
  const multi = n >= 2;
  const single = n === 1;
  // 忙 = 转换中(mode 单源)或命令锁持有中(预检)
  const busy = state.mode !== null || commandBusyProbe?.() === true;
  convertBtn.classList.toggle("hidden", multi);
  batchBtn.classList.toggle("hidden", !multi);
  mergeBtn.classList.toggle("hidden", !multi);
  convertBtn.disabled = busy || n !== 1;
  batchBtn.disabled = busy || !multi;
  mergeBtn.disabled = busy || !multi;
  // 就绪态主按钮脉冲引导;CSS 以 .pulse:not(:disabled) 守卫,转换中禁用即自动停脉冲
  convertBtn.classList.toggle("pulse", !busy && single);
  batchBtn.classList.toggle("pulse", !busy && multi);
  mergeBtn.classList.toggle("pulse", !busy && multi);
  previewBtn.classList.toggle("hidden", !single);
  previewBtn.disabled = busy || !single;
  // 追加文件:两态共用,转换中禁用(openDialog 另有守卫)
  appendFileBtn.disabled = busy;
  // 清空列表:empty 态随 pane 隐藏;转换中禁用防误清(监听内另有 mode 守卫)
  clearListBtn.disabled = busy;
  selectBtn.disabled = busy;
  // footer 快捷键提示随模式切换(多文件态提示批量语义)
  if (convertHint) {
    convertHint.textContent = multi ? t("hint.batch") : t("hint.single");
  }
}
