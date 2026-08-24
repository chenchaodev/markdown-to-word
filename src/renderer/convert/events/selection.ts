/**
 * 事件域·选择与列表(批③自 events.ts 按域拆出,行为零变化):
 * - 系统对话框选择(openDialog:替换 / 追加两语义)与拖放区点击/键盘入口;
 * - 单文件态操作行(移除 / 预览 / 追加)与多文件态工具条(追加 / 清空);
 * - 多文件列表交互:点击委托(上移/下移/预览/移除)、双击预览、拖拽排序
 *   (dragstart/dragover/drop/dragend,含插入指示与边缘自动滚动)。
 * 与原单文件 bindEvents 的差异仅为本域监听集中注册;各监听的元素/事件类型
 * 组合互不重复,注册顺序变化无可观察行为影响。
 * 依赖方向:本模块 → dom/state/utils/file-list/pure/core/i18n 与同目录
 * dialogs-events(仅 openPreviewFor);不反向引用组合根。
 */
import {
  appendBtn,
  appendFileBtn,
  clearListBtn,
  dropZone,
  multiList,
  previewBtn,
  removeFileBtn,
  selectBtn,
} from "../../dom/refs.js";
import { state } from "../../state/state.js";
import { baseName, errorMessage, isMarkdown } from "../../state/pure.js";
import { setError, setStatus } from "../../state/utils.js";
import {
  applySelection,
  appendSelection,
  clearDragState,
  moveItem,
  renderMultiList,
  renderSelection,
} from "../file-list.js";
import { t } from "../../../core/i18n.js";

/** 列表边缘自动滚动步长(MR-15 具名;px/次,dragover 事件粒度)。 */
const EDGE_SCROLL_STEP_PX = 14;

/* ---------- 预览(转换前,经主进程打开与 PDF 同排版的窗口) ---------- */
/** 打开指定文件的预览窗口;失败时状态区提示(文件名 + 原因 + 操作)。
 *  方案原划 dialogs-events(预览打开),实际全部触发入口都在列表域(单文件态
 *  「预览」按钮 / 列表行「预览」/ 行双击),且 dialogs-events 的菜单转发需要
 *  本模块的 openDialog——放此处使依赖单向(dialogs-events → selection),避免环。 */
export function openPreviewFor(filePath: string): void {
  const fileName = baseName(filePath);
  const fail = (reason: string) =>
    setError(t("preview.failed", { name: fileName, reason }));
  window.api
    .openPreview(filePath)
    .then((result) => {
      if (!result.ok) fail(result.error ?? t("common.unknownReason"));
    })
    .catch((err) => fail(errorMessage(err)));
}

/* ---------- 选择文件(系统对话框) ---------- */
// B6:原模块级 `const ERROR_MESSAGE = t("file.onlyMarkdown")` 在模块加载期求值,
// 语言切换后不更新 → 移到使用点直接 t()(openDialog 内)。

/** 打开文件对话框;append=true 时与现有列表合并(「追加文件 / 继续添加」入口)。 */
export async function openDialog(append = false): Promise<void> {
  if (state.mode !== null) return;
  try {
    const paths = await window.api.openMarkdowns();
    if (paths.length === 0) return; // 用户取消,保持现状
    const files = paths.filter(isMarkdown);
    if (files.length === 0) {
      setError(t("file.onlyMarkdown"));
      return;
    }
    if (append) {
      appendSelection(files, paths.length - files.length);
    } else {
      applySelection(files, paths.length - files.length);
    }
  } catch (err) {
    const message = errorMessage(err);
    setError(t("dialog.openFailed", { error: message }));
  }
}

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindSelectionEvents(): void {
  selectBtn.addEventListener("click", (event) => {
    event.stopPropagation(); // 避免冒泡触发拖放区点击,重复打开对话框
    void openDialog(false);
  });

  // 点击拖放区打开对话框;键盘可用(Enter / 空格)。
  // 批次 12(C1):行为与文案对齐——多文件态(≥2)点击=追加(与「可继续添加」一致),
  // 单文件/默认态点击=更换/选择;列表内按钮已 stopPropagation,行为不变
  dropZone.addEventListener("click", () => {
    void openDialog(state.selectedFiles.length >= 2);
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openDialog(state.selectedFiles.length >= 2);
    }
  });

  // 批次 7:单文件态「移除」按钮(清空选择,回到初始态)
  removeFileBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    applySelection([]);
  });

  // 迭代 4:单文件态「预览」按钮(转换前预览排版;stopPropagation 避免触发拖放区打开对话框)
  previewBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null || state.selectedFiles.length !== 1) return;
    openPreviewFor(state.selectedFiles[0]!); // 上行已守卫 length === 1
  });

  // 批次 7:多文件态「追加文件」按钮(对话框追加,与现有列表合并去重)
  appendBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void openDialog(true);
  });

  // 批次 12(A):单文件态「追加文件」按钮(用户反馈:1 个文件时无增加入口)。
  // 与多文件态 appendBtn 同语义:对话框追加合并;stopPropagation 防冒泡触发
  // 拖放区点击=更换文件(C1 语义);追加后 n≥2 由 renderSelection 自动切多文件态
  appendFileBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void openDialog(true);
  });

  // 批次 7:多文件态「清空列表」按钮
  clearListBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    applySelection([]);
  });

  // 多文件列表:点击列表本身不触发换文件(避免误开对话框);
  // 上移/下移/预览/移除按钮走事件委托,点击后按行内 data-index 定位文件
  multiList.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".multi-move, .multi-remove, .multi-preview",
    );
    if (!btn) return;
    const li = btn.closest<HTMLLIElement>(".multi-item");
    if (!li) return;
    const index = Number(li.dataset.index);
    if (btn.classList.contains("multi-preview")) {
      // 迭代 4:预览该行文件(转换前,不产生产物)
      openPreviewFor(state.selectedFiles[index]!); // 列表行由 renderMultiList 按序生成,data-index 必有效
      return;
    }
    if (btn.classList.contains("multi-remove")) {
      // 移除该文件:从数组删除并重建;清空后回到初始态
      state.selectedFiles.splice(index, 1);
      renderSelection();
      setStatus(
        state.selectedFiles.length > 0
          ? t("file.removedRemaining", { count: state.selectedFiles.length })
          : "",
      );
      return;
    }
    const dir = btn.dataset.dir;
    moveItem(index, dir === "up" ? -1 : 1);
  });

  // 批次 11 迭代 4:多文件列表行双击 = 预览该行(复用 openPreviewFor 现有链路,不重复实现)。
  // 双击落在行内按钮上不触发(按钮单击已有各自语义,避免双击「预览」连开多个窗口);
  // 双击行的序号/文件名/空白处才预览;dblclick 由两次 click 组成,click 已在上面
  // stopPropagation,不会误触拖放区打开对话框。
  multiList.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(".multi-item");
    if (!li) return;
    openPreviewFor(state.selectedFiles[Number(li.dataset.index)]!); // 同上,行与列表一一同步
  });

  // 拖拽排序(HTML5 drag events):列表位于可滚动容器内,悬停边缘时自动滚动。
  // 所有内部拖拽事件 stopPropagation,避免触发拖放区的外部文件高亮 / 换文件逻辑。
  multiList.addEventListener("dragstart", (event) => {
    if (state.mode !== null) {
      event.preventDefault();
      return;
    }
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(
      ".multi-item",
    );
    if (!li) return;
    state.dragIndex = Number(li.dataset.index);
    state.dragDropAfter = false;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // 部分平台需 setData 才会启动拖拽
      event.dataTransfer.setData("text/plain", String(state.dragIndex));
    }
    li.classList.add("dragging");
  });

  multiList.addEventListener("dragover", (event) => {
    event.preventDefault(); // 允许 drop
    event.stopPropagation(); // 不触发拖放区的外部拖入高亮
    if (state.dragIndex < 0 || state.mode !== null) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(
      ".multi-item",
    );
    if (!li) return;
    const targetIndex = Number(li.dataset.index);
    const rect = li.getBoundingClientRect();
    state.dragDropAfter = event.clientY > rect.top + rect.height / 2;

    // 更新插入指示:目标项上/下沿高亮
    multiList.querySelectorAll(".multi-item").forEach((el) => {
      el.classList.remove("drop-before", "drop-after");
    });
    if (targetIndex !== state.dragIndex) {
      li.classList.add(state.dragDropAfter ? "drop-after" : "drop-before");
    }

    // 列表边缘自动滚动(拖到可视区上下沿时)
    const listRect = multiList.getBoundingClientRect();
    const threshold = 36;
    if (event.clientY < listRect.top + threshold) multiList.scrollTop -= EDGE_SCROLL_STEP_PX;
    else if (event.clientY > listRect.bottom - threshold) multiList.scrollTop += EDGE_SCROLL_STEP_PX;
  });

  multiList.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.dragIndex < 0 || state.mode !== null) return;
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(
      ".multi-item",
    );
    if (!li || Number(li.dataset.index) === state.dragIndex) {
      clearDragState(); // 落在自身或列表空白处:放弃
      return;
    }
    const targetIndex = Number(li.dataset.index);
    let insertAt = state.dragDropAfter ? targetIndex + 1 : targetIndex;
    if (insertAt > state.dragIndex) insertAt -= 1; // 移除源项后目标下标前移
    const [moved] = state.selectedFiles.splice(state.dragIndex, 1);
    state.selectedFiles.splice(insertAt, 0, moved!); // dragstart 仅对已渲染行记录 dragIndex,splice 必移除一项
    renderMultiList();
    clearDragState();
  });

  multiList.addEventListener("dragend", () => clearDragState());
}
