/**
 * 文件选择与列表:拖放区三态渲染、统一队列卡构建与排序、移除按钮工厂、
 * 选择应用/追加、操作按钮可用性。只经 state.ts 读写状态。
 *
 * 不变量:data-stage(empty/single/multi)驱动 CSS 切换同一 .pane-files;
 * renderMultiList 覆盖 n≥1 全部情形(n=1 省略 grip/序号且不可拖拽);
 * 「预览」仅单文件可见,「清空列表」兼并单文件移除语义。
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
import { setStatus, translate } from "../state/utils.js";
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

  if (n >= 1) {
    renderMultiList();
  }
  updateActionButtons();
  persistSessionFiles();
}

/** 重建队列列表:
 *  n=1 → 单行(无 grip/序号,draggable=false,双击仍可预览);
 *  n≥2 → 完整队列行:手柄 + 序号 + 文件名 + 移除,严格按 selectedFiles 顺序渲染。
 *  排序 = 整行拖拽 + 键盘补偿(行聚焦后 Alt+↑/↓);预览 = 行双击。 */
export function renderMultiList(): void {
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

/**
 * 文件列表变化(增/删/清空/排序)后同步 lastSessionFiles,下次启动恢复;
 * 写入失败静默(不阻塞主流程)。
 */
export function persistSessionFiles(): void {
  void window.api.uiStateSet({ lastSessionFiles: [...state.selectedFiles] }).catch(() => {
    /* 忽略:UI 状态写入失败不阻塞主流程 */
  });
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

export function updateActionButtons(): void {
  const n = state.selectedFiles.length;
  const multi = n >= 2;
  const single = n === 1;
  const busy = state.mode !== null; // 转换中 = mode 单源
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
