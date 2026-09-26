/**
 * 事件域·选择与列表:
 * - 系统对话框选择(openDialog:替换 / 追加两语义)与拖放区点击/键盘入口
 *   (拖放区只对自身目标响应,内部控件冒泡不叠加第二个动作;openDialog 单飞,
 *   在途期间的重复调用一律忽略,双击/连点只出一个原生窗);
 * - 队列卡头侧动作(预览[单文件可见] / 追加 / 清空;旧单文件「移除」按钮退役,
 *   清空列表覆盖其语义);
 * - 多文件列表交互:点击委托(移除)、双击/回车预览、键盘 Alt+↑↓ 排序、
 *   拖拽排序(dragstart/dragover/drop/dragend,含插入指示与边缘自动滚动)。
 * 依赖方向:本模块 → dom/state/utils/file-list/pure/core/i18n 与同目录
 * dialogs-events(仅 openPreviewFor);不反向引用组合根。
 */
import {
  appendFileBtn,
  bookWizardBtn,
  clearListBtn,
  dropZone,
  multiList,
  pasteConvertBtn,
  previewBtn,
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
import { runConvert, isConvertCommandBlocked } from "../convert-flow.js";
import { openBookWizard } from "../../wizard/book-wizard.js";
import { t } from "../../../core/i18n.js";

/** 列表边缘自动滚动步长(px/次,dragover 事件粒度)。 */
const EDGE_SCROLL_STEP_PX = 14;

/**
 * 容器内自带行为的交互元素选择器(事件边界):祖先容器只对自身目标响应,
 * 内部控件的 click / Enter / Space 冒泡不得再叠加第二个动作。
 * 覆盖 button/link/表单控件/label(summary 同理)+ 显式交互 role
 * + .multi-item(队列行 tabindex=0 且有行级 Enter/Space 语义,最易穿透容器键盘入口)。
 */
const OWN_ACTION_SELECTOR =
  "button, a[href], input, select, textarea, label, summary, .multi-item, [role='button'], [role='radio'], [role='switch'], [role='tab'], [role='combobox']";

/**
 * 事件是否发源于容器自身(而非内部交互控件)。
 * 拖放区容器 role=region(非 button),故非交互子节点(纸面壳/题字/文案)仍算自身目标,
 * 点击空白处照常打开文件对话框。closest 缺席时按自身目标处理(无祖先可冒泡)。
 */
function isOwnEventTarget(event: Event): boolean {
  const target = event.target as (Element & { closest?: unknown }) | null;
  if (target === null || typeof target.closest !== "function") return true;
  return target.closest(OWN_ACTION_SELECTOR) === null;
}

/* ---------- 预览(转换前,经主进程打开与 PDF 同排版的窗口) ---------- */
/** 打开指定文件的预览窗口;失败时状态区提示(文件名 + 原因 + 操作)。
 *  方案原划 dialogs-events(预览打开),实际全部触发入口都在列表域(队列卡头侧
 *  「预览」按钮 / 行双击),且 dialogs-events 的菜单转发需要
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
// 原模块级常量在模块加载期求值,语言切换后不更新 → 移到使用点直接 t()

/**
 * 原生文件对话框「在途」标记(模块级 single-flight):
 * - true = 已有一次 openMarkdowns() 未决。此时任何新调用(按钮双击/连点、拖放区
 *   click/keydown、Ctrl+O、「追加文件 / 继续添加」)一律**忽略**——一次选择意图
 *   应对应一个原生窗;原生对话框是系统模态,叠开的第二层用户看不见也关不掉。
 * - 忽略而非排队:排队会在用户选完第一窗后立刻又弹第二个窗,等于把双击放大成两次
 *   选择,比叠窗更难收拾。
 * - 与 isConvertCommandBlocked() 正交:那条锁看的是「能不能发起选择」(转换/预检/
 *   模态),本标记看的是「上一个选择是否还在途」,两条都必须过,互不替代。
 */
let fileDialogInFlight = false;

/**
 * 打开文件对话框;append=true 时与现有列表合并(「追加文件 / 继续添加」入口)。
 * 与转换命令同锁:转换中/预检中/模态或向导打开时不另开对话框(避免叠第二层模态)。
 * 在途期间的后续调用直接忽略(单飞,见 fileDialogInFlight);守卫由 finally 释放,
 * 成功 / 用户取消 / 抛错三条路径都不残留,异常不会把入口永久卡死。
 */
export async function openDialog(append = false): Promise<void> {
  if (isConvertCommandBlocked()) return;
  if (fileDialogInFlight) return; // 在途 → 忽略(不排队,见上方语义)
  fileDialogInFlight = true;
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
  } finally {
    // 三条路径(成功 / 取消 return / 抛错)都经此释放,异常不会永久卡死入口
    fileDialogInFlight = false;
  }
}

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindSelectionEvents(): void {
  selectBtn.addEventListener("click", (event) => {
    event.stopPropagation(); // 避免冒泡触发拖放区点击,重复打开对话框
    void openDialog(false);
  });

  // 「粘贴 Markdown 转换」按钮(仅空态显示,按钮在 .pane-empty 内,文件态该 pane 已隐藏):
  // 读系统剪贴板 → 文件路径走 drop 管线展开/过滤,文本写临时 md 走 runConvert,
  // 空/非文本非文件 toast 提示;转换/预检/模态期间阻断,结束后恢复。stopPropagation 防冒泡触发拖放区。
  pasteConvertBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pasteConvertBtn.disabled || isConvertCommandBlocked()) return;
    pasteConvertBtn.disabled = true;
    void (async () => {
      try {
        const res = await window.api.clipboardRead();
        if (res.type === "empty") {
          setStatus(t("b3.empty"));
          return;
        }
        if (res.type === "files") {
          const mdPaths = await window.api.collectMarkdowns(res.paths); // 复用 drop 管线展开/过滤
          appendSelection(mdPaths.files, mdPaths.skipped.length);
          return;
        }
        await runConvert(res.mdPath, state.selectedFormat);
      } catch (err) {
        setError(errorMessage(err)); // 复用现有错误提示
      } finally {
        pasteConvertBtn.disabled = false;
      }
    })();
  });

  // 点击拖放区打开对话框;键盘可用(Enter / 空格)。
  // 多文件态(≥2)点击=追加,单文件/默认态点击=更换/选择。
  // 事件边界(事件只对容器自身目标生效):容器内控件(队列动作、首启引导、
  // 快速参数条)各自处理点击与 Enter/Space,冒泡到本监听器时不再起第二个动作;
  // 容器 role=region(非 button),嵌套交互元素不再与按钮语义冲突。
  dropZone.addEventListener("click", (event) => {
    if (!isOwnEventTarget(event)) return;
    void openDialog(state.selectedFiles.length >= 2);
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!isOwnEventTarget(event)) return;
    event.preventDefault();
    void openDialog(state.selectedFiles.length >= 2);
  });

  // 单文件态「预览」按钮:stopPropagation 避免触发拖放区打开对话框;仅单文件可见
  previewBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null || state.selectedFiles.length !== 1) return;
    openPreviewFor(state.selectedFiles[0]!); // 上行已守卫 length === 1
  });

  // 「成书向导」按钮(仅空态显示,位于 .pane-empty 内;文件态该 pane 已隐藏):
  // 打开 7 步成书向导模态;stopPropagation 防冒泡触发拖放区点击=打开文件对话框。
  bookWizardBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (bookWizardBtn.disabled) return;
    openBookWizard();
  });

  // 「追加文件」按钮(两态共用):对话框追加合并,与现有列表去重;
  // stopPropagation 防冒泡触发拖放区点击=更换文件;追加后 n≥2 由
  // renderSelection 自动切多文件态
  appendFileBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void openDialog(true);
  });

  // 「清空列表」按钮(兼并旧单文件「移除」语义):清空选择回初始态
  clearListBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    applySelection([]);
  });

  // 多文件列表:点击列表本身不触发换文件(避免误开对话框);
  // 行内唯一常驻控件为「移除」,走事件委托按行内 data-index 定位。
  // (排序 = 整行拖拽 / 行聚焦后 Alt+↑↓,见下方 keydown;预览 = 行双击)
  multiList.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".multi-remove");
    if (!btn) return;
    const li = btn.closest<HTMLLIElement>(".multi-item");
    if (!li) return;
    const index = Number(li.dataset.index);
    // 移除该文件:从数组删除并重建;清空后回到初始态
    state.selectedFiles.splice(index, 1);
    renderSelection();
    setStatus(
      state.selectedFiles.length > 0
        ? t("file.removedRemaining", { count: state.selectedFiles.length })
        : "",
    );
  });

  // 队列行键盘:行级激活(Enter/Space)+ 排序(Alt+↑/↓)。两支同属一个监听器。
  // 行为边界——行内 Enter/Space 属行自身,冒泡到拖放区会被判为「容器自身目标」
  // 而打开文件对话框,叠加出第二个动作(焦点落在行上时尤其明显)。故先判行激活并吞冒泡:
  // Enter 与行双击同语义 = 预览该行(键盘补齐);Space 仅占用,避免误开预览窗口。
  // 排序 = 整行拖拽(鼠标) / 行聚焦后 Alt+↑↓(键盘);转换中与拖拽中守卫同拖拽路径;
  // 移动后焦点跟随被移动的行;单文件态行无 grip/序号且不可拖拽,Alt+± 越界守卫天然拦截。
  multiList.addEventListener("keydown", (event) => {
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(".multi-item");
    if (li && (event.key === "Enter" || event.key === " ")) {
      event.stopPropagation(); // 不再穿透到 dropZone 的容器级键盘入口
      event.preventDefault(); // 阻止 Space 触发列表滚动
      if (state.mode !== null || event.key !== "Enter") return;
      const previewPath = state.selectedFiles[Number(li.dataset.index)];
      if (previewPath) openPreviewFor(previewPath);
      return;
    }
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (state.mode !== null) return;
    if (!li) return;
    event.preventDefault(); // 阻止滚动等默认行为
    const index = Number(li.dataset.index);
    const offset = event.key === "ArrowUp" ? -1 : 1;
    const target = index + offset;
    if (target < 0 || target >= state.selectedFiles.length) return;
    moveItem(index, offset === -1 ? -1 : 1);
    // moveItem 重建列表后原 DOM 已替换,焦点跟到新列表的同名行(移动后的位置)
    const moved = multiList.querySelector<HTMLLIElement>(
      `.multi-item[data-index="${target}"]`,
    );
    moved?.focus();
  });

  // 列表行双击 = 预览该行(单/多文件态一致,复用 openPreviewFor 现有链路)。
  // 双击落在行内按钮上不触发(避免连开多个窗口);dblclick 由两次 click 组成,
  // 上方 click 已 stopPropagation,不会误触拖放区打开对话框。
  multiList.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    if (state.mode !== null) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const li = (event.target as HTMLElement).closest<HTMLLIElement>(".multi-item");
    if (!li) return;
    openPreviewFor(state.selectedFiles[Number(li.dataset.index)]!); // 同上,行与列表一一同步
  });

  // 拖拽排序(HTML5 drag events;仅多文件态 draggable=true):
  // 列表位于可滚动容器内,悬停边缘时自动滚动。
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
