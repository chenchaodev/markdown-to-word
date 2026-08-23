/**
 * renderer 事件绑定(B8 自 renderer.ts 抽出,行为零变化):
 * 全部 DOM/IPC 事件接线集中于此——选择与拖放、多文件列表(点击委托/双击预览/
 * 拖拽排序)、转换入口(按钮 + 快捷键)、弹窗交互(打开文件夹/打开文件/复制/
 * 重试/遮罩/Esc)、进度订阅、菜单事件。组合根 renderer.ts 只在 init 处调用
 * bindEvents()(时序与拆分前一致:绑定先于设置回填)。
 * 依赖方向单向:本模块 → dom/state/utils/file-list/dialogs/convert-flow/
 * settings-panel/pure/core 共享模块;不反向引用组合根。
 */
import {
  appendBtn,
  appendFileBtn,
  batchBtn,
  batchDialog,
  batchDialogCopyAll,
  batchDialogError,
  batchDialogOk,
  batchDialogRetry,
  batchDialogReveal,
  cancelBtn,
  clearListBtn,
  completeDialog,
  completeDialogCopy,
  completeDialogOk,
  completeDialogOpen,
  completeDialogReveal,
  completeDialogSuppressInput,
  completeOutputPath,
  convertBtn,
  dropSkipped,
  dropSkippedList,
  dropSkippedToggle,
  dropZone,
  mergeBtn,
  multiList,
  previewBtn,
  presetSaveDialog,
  removeFileBtn,
  selectBtn,
  summaryDetailsBtn,
  summaryOpenBtn,
  summaryRevealBtn,
} from "./dom.js";
import { state } from "./state.js";
import {
  STAGE_PERCENT,
  baseName,
  isMarkdown,
  setError,
  setProgress,
  setStatus,
  stageText,
} from "./utils.js";
import {
  applySelection,
  appendSelection,
  clearDragState,
  moveItem,
  renderMultiList,
  renderSelection,
} from "./file-list.js";
import {
  hideBatchDialog,
  hideCompleteDialog,
  showBatchDialog,
  showDialogError,
} from "./dialogs.js";
import { runBatch, runConvert, runMerge } from "./convert-flow.js";
import { closePresetSaveDialog, setSuppressCompleteDialog } from "./settings-panel.js";
import { batchRetryPaths, batchSuccessPaths } from "./pure.js";
import { t } from "../core/i18n.js";

/* ---------- 预览(转换前,经主进程打开与 PDF 同排版的窗口) ---------- */
/** 打开指定文件的预览窗口;失败时状态区提示(文件名 + 原因 + 操作)。 */
function openPreviewFor(filePath: string): void {
  const fileName = baseName(filePath);
  const fail = (reason: string) =>
    setError(t("preview.failed", { name: fileName, reason }));
  window.api
    .openPreview(filePath)
    .then((result) => {
      if (!result.ok) fail(result.error ?? t("common.unknownReason"));
    })
    .catch((err) => fail(err instanceof Error ? err.message : String(err)));
}

/* ---------- 选择文件(系统对话框) ---------- */
// B6:原模块级 `const ERROR_MESSAGE = t("file.onlyMarkdown")` 在模块加载期求值,
// 语言切换后不更新 → 移到使用点直接 t()(openDialog 内)。

/** 打开文件对话框;append=true 时与现有列表合并(「追加文件 / 继续添加」入口)。 */
async function openDialog(append = false): Promise<void> {
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
    const message = err instanceof Error ? err.message : String(err);
    setError(t("dialog.openFailed", { error: message }));
  }
}

/* ---------- 拖放(多文件 / 文件夹) ---------- */
/** 展示被跳过的非 Markdown 文件名(可折叠;空列表隐藏整块)。 */
function showSkippedList(skipped: string[]): void {
  dropSkipped.classList.toggle("hidden", skipped.length === 0);
  if (skipped.length === 0) return;
  dropSkippedToggle.textContent = t("file.skippedListToggle", { count: skipped.length });
  dropSkippedList.replaceChildren(
    ...skipped.map((filePath) => {
      const li = document.createElement("li");
      li.className = "summary-warnings-item";
      li.textContent = baseName(filePath);
      li.title = filePath; // 截断展示,悬停看完整路径
      return li;
    }),
  );
}

async function resolveDropped(paths: string[]): Promise<void> {
  try {
    const { files, skipped } = await window.api.collectMarkdowns(paths);
    showSkippedList(skipped); // B9:跳过项列具体文件名(可折叠);无跳过时隐藏
    if (files.length === 0) {
      setError(
        skipped.length > 0
          ? t("file.noMarkdownSkipped", { count: skipped.length })
          : t("file.noMarkdown"),
      );
      return;
    }
    appendSelection(files, skipped.length); // 拖入始终追加到现有列表(重复文件单独提示)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(t("file.readFailed", { error: message }));
  }
}

/* ---------- 事件绑定(组合根 init 处调用一次) ---------- */
export function bindEvents(): void {
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
    if (event.clientY < listRect.top + threshold) multiList.scrollTop -= 14;
    else if (event.clientY > listRect.bottom - threshold) multiList.scrollTop += 14;
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

  // 拖放:dragover 必须 preventDefault,否则 drop 不会触发
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (state.dragIndex >= 0) return; // 内部排序拖拽:不显示外部拖入高亮
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", (event) => {
    // 仍在子元素上时不取消高亮,避免拖过文字/按钮时闪烁
    if (event.relatedTarget && dropZone.contains(event.relatedTarget as Node)) {
      return;
    }
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    if (state.dragIndex >= 0) {
      clearDragState(); // 内部排序拖拽落到列表外:放弃排序
      return;
    }
    if (state.mode !== null) {
      // B9:转换中拖入不再静默忽略,状态区给出提示
      setStatus(t("drop.busy"), false, true);
      return;
    }

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // 拖放路径解析:File.path 已被 Electron 32+ 移除,须经 preload 的
    // webUtils.getPathForFile 获取真实路径(文件夹同样适用);
    // 文件 + 文件夹路径统一交给主进程 collectMarkdowns 展开与过滤
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      const filePath = window.api.getPathForFile(file);
      if (filePath) paths.push(filePath);
    }
    if (paths.length === 0) {
      setError(t("file.pathUnavailable"));
      return;
    }
    void resolveDropped(paths);
  });

  // 未落入拖放区时,阻止浏览器默认「打开文件/跳转」行为
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  // 完成弹窗:打开所在文件夹 / 打开文件(失败在弹窗内提示,不打断)
  completeDialogReveal.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .revealInFolder(state.dialogOutputPath)
      .catch((err) =>
        showDialogError(
          t("common.revealFailed", { error: err instanceof Error ? err.message : String(err) }),
        ),
      );
  });

  completeDialogOpen.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .openFile(state.dialogOutputPath)
      .then((result) => {
        if (!result.ok) showDialogError(result.error ?? t("common.openFailedPlain"));
      })
      .catch((err) =>
        showDialogError(
          t("common.openFailed", { error: err instanceof Error ? err.message : String(err) }),
        ),
      );
  });

  // 转换按钮:单文件(docx / pdf 均已支持)
  convertBtn.addEventListener("click", () => {
    const filePath = state.selectedFiles[0];
    if (!filePath) {
      setError(t("file.selectFirst"));
      return;
    }
    void runConvert(filePath, state.selectedFormat);
  });

  // 批量转换按钮(≥2 个文件时可见)
  batchBtn.addEventListener("click", () => {
    if (state.selectedFiles.length < 2) return;
    void runBatch();
  });

  // 合并转换按钮(≥2 个文件时可见)
  mergeBtn.addEventListener("click", () => {
    if (state.selectedFiles.length < 2) return;
    void runMerge();
  });

  // 批量汇总弹窗:打开所在文件夹(定位第一个成功项)/ 确定
  batchDialogReveal.addEventListener("click", () => {
    const target = state.lastBatchResult?.items.find(
      (item) => item.ok && item.outputPath,
    )?.outputPath;
    if (!target) return;
    window.api
      .revealInFolder(target)
      .catch((err) => {
        batchDialogError.textContent = t("common.revealFailed", {
          error: err instanceof Error ? err.message : String(err),
        });
        batchDialogError.classList.remove("hidden");
      });
  });

  batchDialogOk.addEventListener("click", hideBatchDialog);
  batchDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === batchDialog) hideBatchDialog();
  });

  // 批次 11 迭代 2:批量弹窗「重试失败项」——失败(非取消)项替换当前列表并立即重转,
  // 按原格式(lastBatchFormat)执行;允许单个失败文件单独重转
  batchDialogRetry.addEventListener("click", () => {
    if (state.mode !== null || !state.lastBatchResult) return;
    const failed = batchRetryPaths(state.lastBatchResult.items);
    if (failed.length === 0) return;
    hideBatchDialog();
    applySelection(failed);
    void runBatch(failed, state.lastBatchFormat);
  });

  // 批次 11 迭代 2:批量弹窗「复制全部路径」——成功项输出路径换行拼接复制到剪贴板
  batchDialogCopyAll.addEventListener("click", () => {
    void (async () => {
    if (!state.lastBatchResult) return;
    const paths = batchSuccessPaths(state.lastBatchResult.items);
    if (paths.length === 0) return;
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
      batchDialogCopyAll.textContent = t("common.copied");
      window.setTimeout(() => {
        batchDialogCopyAll.textContent = t("batch.copyAll");
      }, 1500);
    } catch {
      batchDialogError.textContent = t("common.copyFailed");
      batchDialogError.classList.remove("hidden");
    }
    })();
  });

  // 批次 11 迭代 2:完成弹窗「不再提示」——与设置面板「转换完成弹窗提示」同字段双向同步
  completeDialogSuppressInput.addEventListener("change", () => {
    setSuppressCompleteDialog(completeDialogSuppressInput.checked);
  });

  // 批次 7:取消当前转换(单文件 / 批量 / 合并;主进程在检查点终止并返回 canceled)
  cancelBtn.addEventListener("click", () => {
    if (state.mode === null) return;
    cancelBtn.disabled = true; // 防重复点击;转换结束后 hideProgress 隐藏整块
    setStatus(t("convert.canceling"));
    window.api.convertCancel().catch(() => {
      cancelBtn.disabled = false;
      setStatus(t("convert.cancelFailed"));
    });
  });

  // 批次 7:汇总条「打开所在文件夹 / 打开文件 / 失败详情」
  summaryRevealBtn.addEventListener("click", () => {
    if (!state.summaryOutputPath) return;
    window.api.revealInFolder(state.summaryOutputPath).catch((err) => {
      setError(
        t("common.revealFailed", { error: err instanceof Error ? err.message : String(err) }),
      );
    });
  });

  summaryOpenBtn.addEventListener("click", () => {
    if (!state.summaryOutputPath) return;
    window.api
      .openFile(state.summaryOutputPath)
      .then((result) => {
        if (!result.ok) setError(result.error ?? t("common.openFailedPlain"));
      })
      .catch((err) =>
        setError(t("common.openFailed", { error: err instanceof Error ? err.message : String(err) })),
      );
  });

  summaryDetailsBtn.addEventListener("click", () => {
    if (state.lastBatchResult) showBatchDialog(state.lastBatchResult);
  });

  // 批次 7:完成弹窗「复制路径」(仅成功态显示;失败态隐藏该按钮)
  completeDialogCopy.addEventListener("click", () => {
    void (async () => {
    const text = completeOutputPath.textContent ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      completeDialogCopy.textContent = t("common.copied");
      window.setTimeout(() => {
        completeDialogCopy.textContent = t("common.copyPath");
      }, 1500);
    } catch {
      showDialogError(t("common.copyFailed"));
    }
    })();
  });

  // 进度订阅:单文件/合并走 convert:progress;批量走 batch:progress。
  // mode 标志确保只响应当前模式的进度,转换结束后的迟到事件直接忽略。
  // 单文件/合并只有阶段键(无百分比),按 STAGE_PERCENT 映射近似进度。
  // B9:pdf 链路细分 parse/inline/mermaid/katex/print 阶段键;print(printToPDF)
  // 不可中断 → 取消按钮置灰,防无效点击。
  state.unsubscribeProgress = window.api.onConvertProgress((stage) => {
    if (state.mode !== "single" && state.mode !== "merge") return;
    const text = stageText(stage, t);
    if (text !== stage) setStatus(text); // 未知阶段原样兜底,不覆盖状态栏
    const percent = STAGE_PERCENT[stage];
    if (percent !== undefined) setProgress(percent);
    if (stage === "print") cancelBtn.disabled = true;
  });

  state.unsubscribeBatchProgress = window.api.onBatchProgress((info) => {
    if (state.mode !== "batch") return;
    const text = t("convert.batch.progress", {
      index: info.index,
      total: info.total,
      file: baseName(info.file),
      stage: stageText(info.stage, t),
    });
    setStatus(text);
    // 批量进度:已完成 (index-1)/total 个文件 + 当前文件阶段权重 /total
    const base = ((info.index - 1) / info.total) * 100;
    const step = (STAGE_PERCENT[info.stage] ?? 0) / info.total;
    setProgress(base + step);
  });

  // 批次 7:快捷键 Ctrl+Enter 触发主转换(单文件/批量),Ctrl+O 添加文件
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "enter") {
      event.preventDefault();
      if (state.mode !== null) return;
      if (state.selectedFiles.length === 1) {
        void runConvert(state.selectedFiles[0]!, state.selectedFormat); // 上行已守卫 length === 1
      } else if (state.selectedFiles.length >= 2) {
        void runBatch();
      }
    } else if (key === "o") {
      event.preventDefault();
      void openDialog(true);
    }
  });

  // 批次 11 迭代 4:应用菜单「文件 → 打开文件…」→ 复用现有选择链路(替换选择,与「选择文件」按钮一致)
  window.api.onMenuOpen(() => void openDialog(false));

  // 窗口关闭时取消进度订阅。生命周期说明(B8 卫生项):unload 后整个 renderer
  // JS 上下文随页面销毁——本模块注册的 DOM 监听(document/dropZone/multiList 等)
  // 与 IPC 订阅一并消亡,不存在跨页泄漏;此处显式退订仅为主进程侧 IPC 通道卫生,
  // 不补其他监听清理(补清理与页面销毁语义等价,无行为差异)。
  window.addEventListener("unload", () => {
    state.unsubscribeProgress?.();
    state.unsubscribeBatchProgress?.();
  });

  // 弹窗关闭:确定按钮 / 点击遮罩 / Esc 三种方式
  completeDialogOk.addEventListener("click", hideCompleteDialog);
  completeDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === completeDialog) hideCompleteDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!presetSaveDialog.classList.contains("hidden")) {
      // 批次 11 迭代 3:另存为预设弹窗(焦点还给触发按钮;批次 12 C9:统一走
      // closePresetSaveDialog 以解除焦点陷阱,不再直接操作 DOM)
      closePresetSaveDialog();
    } else if (!completeDialog.classList.contains("hidden")) {
      hideCompleteDialog();
    } else if (!batchDialog.classList.contains("hidden")) {
      hideBatchDialog();
    }
  });
}
