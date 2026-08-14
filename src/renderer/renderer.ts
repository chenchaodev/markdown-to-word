/**
 * G3 阶段:renderer 接入转换逻辑(含转换完成弹窗)。
 * 二期批次 1:页面设置面板(纸张/方向/边距/H1 分页/导出后行为)与持久化,
 * 完成弹窗新增「打开所在文件夹 / 打开文件」按钮。
 * 二期批次 2:预览功能经主进程打开独立预览窗口(与 PDF 同排版),预览使用源 md 路径。
 * 迭代 4:预览入口迁移到转换前——选中文件后即可预览(单文件态操作行「预览」按钮 +
 * 多文件态每行「预览」按钮),完成弹窗移除「预览」按钮(打开文件夹/打开文件保留)。
 * 二期批次 3:多文件选择与「批量转换 / 合并转换」。
 *   - 选择:对话框多选(openMarkdowns)+ 拖放多文件/文件夹(collectMarkdowns 展开)。
 *   - 状态:1 个文件保持单文件态;≥2 个文件显示数量 + 可滚动名称列表。
 *   - 批量:convertBatch + onBatchProgress 实时进度,完成弹汇总弹窗逐条展示;
 *   - 合并:convertMerge 合成一个文档,复用现有完成弹窗。
 * 二期批次 4:多文件列表排序(序号 + 上移/下移按钮 + 拖拽排序),直接重排
 * selectedFiles 数组,批量 / 合并按新顺序执行(合并顺序即文档章节顺序)。
 * 导出后行为的自动执行由主进程在转换完成后按设置触发(runAfterConvert),
 * renderer 只负责持久化与弹窗内手动操作,避免重复执行。
 * 二期批次 5a:排版设置面板(西文/中文字体、字号、行距、首行缩进、两端对齐、章节编号)。
 * renderer 侧类型、默认值与控件接线先行就位;主进程 settings.ts 的 typography 字段由
 * 下一批次补充,因此加载设置时对缺失的 typography 按默认值兜底(防御性合并)。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 * R8:renderer 模块化拆分——DOM 映射收敛 dom.ts、共享状态与 IPC 契约收敛 state.ts、
 * 通用工具 utils.ts、选择与列表 file-list.ts、结果展示 dialogs.ts、转换编排
 * convert-flow.ts;本文件为组合根:API 契约、事件接线与初始化。
 * R10-5:设置面板(加载/回填/校验/钳制/预设套用/persist 三件套 + 全部设置控件
 * 事件绑定)抽 src/renderer/settings-panel.ts;组合根 init 处
 * bindSettingsEvents() 后再 loadSettings()(时序与拆分前一致)。
 */
import { type AppSettings } from "../core/settings-defaults.js";
import type { UiState } from "../main/ui-state.js";
import {
  appendBtn,
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
  convertHint,
  dropZone,
  mergeBtn,
  multiList,
  previewBtn,
  presetDeleteBtn,
  presetSaveBtn,
  presetSaveDialog,
  removeFileBtn,
  selectBtn,
  summaryDetailsBtn,
  summaryOpenBtn,
  summaryRevealBtn,
} from "./dom.js";
import {
  state,
  type BatchProgressInfo,
  type BatchResult,
} from "./state.js";
import {
  STAGE_PERCENT,
  STAGE_TEXT,
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
  updateActionButtons,
} from "./file-list.js";
import {
  hideBatchDialog,
  hideCompleteDialog,
  showBatchDialog,
  showDialogError,
} from "./dialogs.js";
import { runBatch, runConvert, runMerge } from "./convert-flow.js";
import { bindSettingsEvents, loadSettings, setSuppressCompleteDialog } from "./settings-panel.js";
import { initUiStateRestore } from "./recent-files.js";
import { batchRetryPaths, batchSuccessPaths } from "./pure.js";

declare global {
  interface Window {
    api: {
      /** 拖放文件 → 真实路径(File.path 已被 Electron 32+ 移除,须经主进程 webUtils 解析)。 */
      getPathForFile: (file: File) => string;
      /** 多选文件对话框,返回所选文件路径数组;空数组 = 用户取消。 */
      openMarkdowns: () => Promise<string[]>;
      /** 展开拖入路径(文件 + 文件夹递归),过滤出 Markdown 文件;skipped 为被跳过的项。 */
      collectMarkdowns: (
        paths: string[],
      ) => Promise<{ files: string[]; skipped: string[] }>;
      convert: (
        filePath: string,
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: string[]; canceled?: boolean }>;
      /** 批量转换:每文件独立输出;始终 ok:true,成败看 items 逐条。 */
      convertBatch: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<BatchResult>;
      /** 合并转换:所有文件合成一个文档。 */
      convertMerge: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: string[]; canceled?: boolean }>;
      /** 请求取消当前转换(单文件 / 批量 / 合并通用;批量在文件间检查)。 */
      convertCancel: () => Promise<void>;
      /** 选择输出目录对话框(批次 7);用户取消返回 null。 */
      selectDir: () => Promise<string | null>;
      /** 订阅转换进度(read / render / done),返回取消订阅函数。 */
      onConvertProgress: (
        cb: (stage: "read" | "render" | "done") => void,
      ) => () => void;
      /** 订阅批量转换进度(第 i 个文件 / 阶段文案),返回取消订阅函数。 */
      onBatchProgress: (cb: (info: BatchProgressInfo) => void) => () => void;
      /** 读取持久化设置(启动时回填控件)。 */
      settingsGet: () => Promise<AppSettings>;
      /** 局部更新设置并持久化,返回合并后的完整设置。 */
      settingsSet: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      /** 读取 UI 状态(最近文件/会话文件/记忆目录/窗口位置/面板展开态)。 */
      uiStateGet: () => Promise<UiState>;
      /** 局部更新 UI 状态并持久化,返回合并后的完整状态。 */
      uiStateSet: (patch: Partial<UiState>) => Promise<UiState>;
      /** 保序过滤仍存在的路径(会话文件逐项校验,缺失剔除)。 */
      filterExistingPaths: (paths: string[]) => Promise<string[]>;
      /** 在资源管理器中显示目标文件。 */
      revealInFolder: (filePath: string) => Promise<void>;
      /** 用系统默认程序打开目标文件;失败返回 { ok: false, error }。 */
      openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 在主进程独立窗口预览转换排版(与 PDF 同排版);失败返回 { ok: false, error }。 */
      openPreview: (mdPath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 批次 11 迭代 3:刷新所有预览窗口(设置变更后调用;无预览窗口时为空操作)。 */
      previewRefresh: () => Promise<void>;
      /** 批次 11 迭代 4:应用菜单「文件 → 打开文件…」触发,复用现有选择对话框链路。 */
      onMenuOpen: (cb: () => void) => () => void;
    };
  }
}

/* ---------- 预览(转换前,经主进程打开与 PDF 同排版的窗口) ---------- */
/** 打开指定文件的预览窗口;失败时状态区提示(文件名 + 原因 + 操作)。 */
function openPreviewFor(filePath: string): void {
  const fileName = baseName(filePath);
  const fail = (reason: string) =>
    setError(`无法预览「${fileName}」:${reason}。请确认文件仍可读后重试`);
  window.api
    .openPreview(filePath)
    .then((result) => {
      if (!result.ok) fail(result.error ?? "未知原因");
    })
    .catch((err) => fail(err instanceof Error ? err.message : String(err)));
}

/* ---------- 选择文件(系统对话框) ---------- */
const ERROR_MESSAGE = "仅支持 .md / .markdown 文件";

/** 打开文件对话框;append=true 时与现有列表合并(「追加文件 / 继续添加」入口)。 */
async function openDialog(append = false): Promise<void> {
  if (state.converting) return;
  try {
    const paths = await window.api.openMarkdowns();
    if (paths.length === 0) return; // 用户取消,保持现状
    const files = paths.filter(isMarkdown);
    if (files.length === 0) {
      setError(ERROR_MESSAGE);
      return;
    }
    if (append) {
      appendSelection(files, paths.length - files.length);
    } else {
      applySelection(files, paths.length - files.length);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`打开文件对话框失败:${message}`);
  }
}

/* ---------- 拖放(多文件 / 文件夹) ---------- */
async function resolveDropped(paths: string[]): Promise<void> {
  try {
    const { files, skipped } = await window.api.collectMarkdowns(paths);
    if (files.length === 0) {
      setError(
        skipped.length > 0
          ? `未找到 Markdown 文件(跳过 ${skipped.length} 个非 Markdown 项)`
          : "未找到 Markdown 文件",
      );
      return;
    }
    appendSelection(files, skipped.length); // 拖入始终追加到现有列表
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`读取文件失败:${message}`);
  }
}

/* ---------- 事件绑定 ---------- */
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
  if (state.converting) return;
  applySelection([]);
});

// 迭代 4:单文件态「预览」按钮(转换前预览排版;stopPropagation 避免触发拖放区打开对话框)
previewBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.converting || state.selectedFiles.length !== 1) return;
  openPreviewFor(state.selectedFiles[0]);
});

// 批次 7:多文件态「追加文件」按钮(对话框追加,与现有列表合并去重)
appendBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  void openDialog(true);
});

// 批次 7:多文件态「清空列表」按钮
clearListBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.converting) return;
  applySelection([]);
});

// 多文件列表:点击列表本身不触发换文件(避免误开对话框);
// 上移/下移/预览/移除按钮走事件委托,点击后按行内 data-index 定位文件
multiList.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.converting) return;
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
    ".multi-move, .multi-remove, .multi-preview",
  );
  if (!btn) return;
  const li = btn.closest<HTMLLIElement>(".multi-item");
  if (!li) return;
  const index = Number(li.dataset.index);
  if (btn.classList.contains("multi-preview")) {
    // 迭代 4:预览该行文件(转换前,不产生产物)
    openPreviewFor(state.selectedFiles[index]);
    return;
  }
  if (btn.classList.contains("multi-remove")) {
    // 移除该文件:从数组删除并重建;清空后回到初始态
    state.selectedFiles.splice(index, 1);
    renderSelection();
    setStatus(
      state.selectedFiles.length > 0
        ? `已移除,剩余 ${state.selectedFiles.length} 个文件`
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
  if (state.converting) return;
  if ((event.target as HTMLElement).closest("button")) return;
  const li = (event.target as HTMLElement).closest<HTMLLIElement>(".multi-item");
  if (!li) return;
  openPreviewFor(state.selectedFiles[Number(li.dataset.index)]);
});

// 拖拽排序(HTML5 drag events):列表位于可滚动容器内,悬停边缘时自动滚动。
// 所有内部拖拽事件 stopPropagation,避免触发拖放区的外部文件高亮 / 换文件逻辑。
multiList.addEventListener("dragstart", (event) => {
  if (state.converting) {
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
  if (state.dragIndex < 0 || state.converting) return;
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
  if (state.dragIndex < 0 || state.converting) return;
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
  state.selectedFiles.splice(insertAt, 0, moved);
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
  if (state.converting) return;

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
    setError("无法获取文件路径,请改用「选择文件」按钮");
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
        `无法打开所在文件夹:${err instanceof Error ? err.message : String(err)}`,
      ),
    );
});

completeDialogOpen.addEventListener("click", () => {
  if (!state.dialogOutputPath) return;
  window.api
    .openFile(state.dialogOutputPath)
    .then((result) => {
      if (!result.ok) showDialogError(result.error ?? "无法打开文件");
    })
    .catch((err) =>
      showDialogError(
        `无法打开文件:${err instanceof Error ? err.message : String(err)}`,
      ),
    );
});

// 转换按钮:单文件(docx / pdf 均已支持)
convertBtn.addEventListener("click", () => {
  const filePath = state.selectedFiles[0];
  if (!filePath) {
    setError("请先选择 Markdown 文件");
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
      batchDialogError.textContent = `无法打开所在文件夹:${err instanceof Error ? err.message : String(err)}`;
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
  if (state.converting || !state.lastBatchResult) return;
  const failed = batchRetryPaths(state.lastBatchResult.items);
  if (failed.length === 0) return;
  hideBatchDialog();
  applySelection(failed);
  void runBatch(failed, state.lastBatchFormat);
});

// 批次 11 迭代 2:批量弹窗「复制全部路径」——成功项输出路径换行拼接复制到剪贴板
batchDialogCopyAll.addEventListener("click", async () => {
  if (!state.lastBatchResult) return;
  const paths = batchSuccessPaths(state.lastBatchResult.items);
  if (paths.length === 0) return;
  try {
    await navigator.clipboard.writeText(paths.join("\n"));
    batchDialogCopyAll.textContent = "已复制";
    window.setTimeout(() => {
      batchDialogCopyAll.textContent = "复制全部路径";
    }, 1500);
  } catch {
    batchDialogError.textContent = "复制失败,请手动选择文本复制";
    batchDialogError.classList.remove("hidden");
  }
});

// 批次 11 迭代 2:完成弹窗「不再提示」——与设置面板「转换完成弹窗提示」同字段双向同步
completeDialogSuppressInput.addEventListener("change", () => {
  setSuppressCompleteDialog(completeDialogSuppressInput.checked);
});

// 批次 7:取消当前转换(单文件 / 批量 / 合并;主进程在检查点终止并返回 canceled)
cancelBtn.addEventListener("click", () => {
  if (!state.converting) return;
  cancelBtn.disabled = true; // 防重复点击;转换结束后 hideProgress 隐藏整块
  setStatus("正在取消…");
  window.api.convertCancel().catch(() => {
    cancelBtn.disabled = false;
    setStatus("取消失败,请重试");
  });
});

// 批次 7:汇总条「打开所在文件夹 / 打开文件 / 失败详情」
summaryRevealBtn.addEventListener("click", () => {
  if (!state.summaryOutputPath) return;
  window.api.revealInFolder(state.summaryOutputPath).catch((err) => {
    setError(
      `无法打开所在文件夹:${err instanceof Error ? err.message : String(err)}`,
    );
  });
});

summaryOpenBtn.addEventListener("click", () => {
  if (!state.summaryOutputPath) return;
  window.api
    .openFile(state.summaryOutputPath)
    .then((result) => {
      if (!result.ok) setError(result.error ?? "无法打开文件");
    })
    .catch((err) =>
      setError(`无法打开文件:${err instanceof Error ? err.message : String(err)}`),
    );
});

summaryDetailsBtn.addEventListener("click", () => {
  if (state.lastBatchResult) showBatchDialog(state.lastBatchResult);
});

// 批次 7:完成弹窗「复制路径」(仅成功态显示;失败态隐藏该按钮)
completeDialogCopy.addEventListener("click", async () => {
  const text = completeOutputPath.textContent ?? "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    completeDialogCopy.textContent = "已复制";
    window.setTimeout(() => {
      completeDialogCopy.textContent = "复制路径";
    }, 1500);
  } catch {
    showDialogError("复制失败,请手动选择文本复制");
  }
});

// 进度订阅:单文件/合并走 convert:progress;批量走 batch:progress。
// mode 标志确保只响应当前模式的进度,转换结束后的迟到事件直接忽略。
// 单文件/合并只有阶段键(无百分比),按 STAGE_PERCENT 映射近似进度。
state.unsubscribeProgress = window.api.onConvertProgress((stage) => {
  if (state.mode !== "single" && state.mode !== "merge") return;
  const text = STAGE_TEXT[stage];
  if (text) setStatus(text);
  const percent = STAGE_PERCENT[stage];
  if (percent !== undefined) setProgress(percent);
});

state.unsubscribeBatchProgress = window.api.onBatchProgress((info) => {
  if (state.mode !== "batch") return;
  const text = `第 ${info.index} / ${info.total} 个:${baseName(info.file)} · ${stageText(info.stage)}`;
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
    if (state.converting) return;
    if (state.selectedFiles.length === 1) {
      void runConvert(state.selectedFiles[0], state.selectedFormat);
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

// 窗口关闭时取消进度订阅
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
    // 批次 11 迭代 3:另存为预设弹窗(焦点还给触发按钮)
    presetSaveDialog.classList.add("hidden");
    presetSaveBtn.focus();
  } else if (!completeDialog.classList.contains("hidden")) {
    hideCompleteDialog();
  } else if (!batchDialog.classList.contains("hidden")) {
    hideBatchDialog();
  }
});

/* ---------- 初始化 ---------- */
// 按钮旁说明文案(docx / pdf 均已支持;与 HTML 静态文案保持一致)
if (convertHint) convertHint.textContent = "输出格式:Word / PDF";
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled)
updateActionButtons();
// 设置面板:事件绑定先于回填(时序与拆分前一致:绑定在模块加载期,回填在 await 之后)
bindSettingsEvents();
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
// 批次 11:UI 状态恢复(面板展开态 / 会话文件 / 最近转换区块;失败静默保持默认)
void initUiStateRestore();
