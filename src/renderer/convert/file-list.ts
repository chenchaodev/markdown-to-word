/**
 * renderer 文件选择与列表(R8 自 renderer.ts 抽出,行为等价):
 * 拖放区三态渲染、多文件列表构建与移动/排序、按钮工厂(上移/下移/预览/移除)、
 * 选择应用/追加、操作按钮可用性。只经 state.ts 读写状态。
 */
import {
  appendFileBtn,
  batchBtn,
  convertBtn,
  convertHint,
  dropDefault,
  dropFile,
  dropMulti,
  dropZone,
  fileNameEl,
  filePathEl,
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

/** 按当前选择渲染拖放区三种状态,并刷新操作按钮可用性。 */
export function renderSelection(): void {
  const n = state.selectedFiles.length;
  dropZone.classList.toggle("has-file", n > 0);
  // P0-1:单文件态标记。主舞台高度已固定(clamp(280px,40vh,400px),样式见
  // style/drop.css .file-area),本 class 不再影响容器几何,仅保留供单文件态
  // 内部布局分支与测试诊断使用
  dropZone.classList.toggle("drop-zone--single", n === 1);

  if (n === 0) {
    dropDefault.classList.remove("hidden");
    dropFile.classList.add("hidden");
    dropMulti.classList.add("hidden");
  } else if (n === 1) {
    const filePath = state.selectedFiles[0]!; // 本分支 n === 1,首项必存在
    fileNameEl.textContent = baseName(filePath);
    filePathEl.textContent = filePath;
    filePathEl.title = filePath;
    dropDefault.classList.add("hidden");
    dropFile.classList.remove("hidden");
    dropMulti.classList.add("hidden");
  } else {
    renderMultiList();
    dropDefault.classList.add("hidden");
    dropFile.classList.add("hidden");
    dropMulti.classList.remove("hidden");
  }
  updateActionButtons();
  persistSessionFiles();
}

/** 重建多文件列表(P1-4 降噪行):手柄 + 序号 + 文件名 + 移除,严格按 selectedFiles
 *  顺序渲染。排序 = 整行拖拽(手柄为视觉锚点)+ 键盘补偿(行聚焦后 Alt+↑/↓,
 *  监听在 events/selection.ts);预览 = 行双击(列表下方常驻提示可见化)。 */
export function renderMultiList(): void {
  const n = state.selectedFiles.length;
  multiCount.textContent = t("file.selectedCount", { count: n });
  multiList.replaceChildren(
    ...state.selectedFiles.map((filePath, index) => {
      const li = document.createElement("li");
      li.className = "multi-item";
      li.draggable = true; // 整行可拖拽排序
      li.dataset.index = String(index);
      li.tabIndex = 0; // 可聚焦:键盘 Alt+↑/↓ 排序的落点
      li.title = `${filePath}\n${t("file.dblclickPreview")}`;

      const grip = document.createElement("span");
      grip.className = "multi-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>';

      const num = document.createElement("span");
      num.className = "multi-index";
      num.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "multi-name";
      name.textContent = baseName(filePath);

      const actions = document.createElement("span");
      actions.className = "multi-actions";
      actions.append(makeRemoveButton(baseName(filePath)));

      li.append(grip, num, name, actions);
      return li;
    }),
  );
  persistSessionFiles();
}

/**
 * 会话记忆(批次 11):文件列表变化(增/删/清空/排序)后同步 lastSessionFiles,
 * 下次启动恢复。经 renderSelection / renderMultiList 兜底所有变更路径;
 * 写入失败静默(下次交互仍以磁盘为准)。
 */
export function persistSessionFiles(): void {
  void window.api.uiStateSet({ lastSessionFiles: [...state.selectedFiles] }).catch(() => {
    /* 忽略:UI 状态写入失败不阻塞主流程 */
  });
}

/** 移除该文件的图标按钮(批次 7 列表增删;P1-4 起为行内唯一常驻控件)。 */
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

/** 相邻交换并重建列表(上移 / 下移按钮共用)。 */
export function moveItem(index: number, offset: -1 | 1): void {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.selectedFiles.length) return;
  const [moved] = state.selectedFiles.splice(index, 1);
  state.selectedFiles.splice(target, 0, moved!); // 上方边界守卫保证 index 合法,splice 必移除一项
  renderMultiList();
}

/** 清理拖拽排序的临时状态与视觉类。 */
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
 * @param duplicates 重复文件数(B9 拖放反馈细化:与非 Markdown 跳过分开提示)。
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
  statusEl.title = files.length === 1 ? files[0]! : full; // 同上,length === 1 分支
}

/**
 * 追加选择:与现有列表合并(去重),供「追加文件 / 点击继续添加」使用。
 * @param skipped 本次被跳过的非 md 项数。
 * B9:重复文件不再并入 skipped 计数,单独文案提示(N 个重复已跳过)。
 */
export function appendSelection(files: string[], skipped = 0): void {
  const { added, duplicates } = partitionDuplicates(state.selectedFiles, files);
  applySelection([...state.selectedFiles, ...added], skipped, duplicates.length);
}

/** 按当前选择与转换状态刷新操作按钮(选择入口 + 三个转换按钮 + 单文件态预览)。 */
export function updateActionButtons(): void {
  const n = state.selectedFiles.length;
  const multi = n >= 2;
  const busy = state.mode !== null; // 转换中 = mode 单源(B8:原 converting 字段合一)
  convertBtn.classList.toggle("hidden", multi);
  batchBtn.classList.toggle("hidden", !multi);
  mergeBtn.classList.toggle("hidden", !multi);
  convertBtn.disabled = busy || n !== 1;
  batchBtn.disabled = busy || !multi;
  mergeBtn.disabled = busy || !multi;
  // 单文件态预览:仅在选中 1 个文件时可见(dropFile 区),转换中禁用
  previewBtn.disabled = busy || n !== 1;
  // 批次 12(A):单文件态「追加文件」按钮,转换中禁用(openDialog 另有 converting 守卫)
  appendFileBtn.disabled = busy || n !== 1;
  selectBtn.disabled = busy;
  // 批次 12(C4):footer 快捷键提示随模式切换(多文件态提示批量语义)
  if (convertHint) {
    convertHint.textContent = multi ? t("hint.batch") : t("hint.single");
  }
}
