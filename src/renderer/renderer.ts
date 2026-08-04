/**
 * G3 阶段:renderer 接入转换逻辑(含转换完成弹窗)。
 * 二期批次 1:页面设置面板(纸张/方向/边距/H1 分页/导出后行为)与持久化,
 * 完成弹窗新增「打开所在文件夹 / 打开文件」按钮。
 * 二期批次 2:完成弹窗新增「预览」按钮,经主进程打开独立预览窗口
 * (与 PDF 同排版),预览使用源 md 路径(selectedFiles[0])。
 * 二期批次 3:多文件选择与「批量转换 / 合并转换」。
 *   - 选择:对话框多选(openMarkdowns)+ 拖放多文件/文件夹(collectMarkdowns 展开)。
 *   - 状态:1 个文件保持单文件态;≥2 个文件显示数量 + 可滚动名称列表。
 *   - 批量:convertBatch + onBatchProgress 实时进度,完成弹汇总弹窗逐条展示;
 *   - 合并:convertMerge 合成一个文档,复用现有完成弹窗。
 * 二期批次 4:多文件列表排序(序号 + 上移/下移按钮 + 拖拽排序),直接重排
 * selectedFiles 数组,批量 / 合并按新顺序执行(合并顺序即文档章节顺序)。
 * 导出后行为的自动执行由主进程在转换完成后按设置触发(runAfterConvert),
 * renderer 只负责持久化与弹窗内手动操作,避免重复执行。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 */

declare global {
  interface Window {
    api: {
      openMarkdownDialog: () => Promise<string | null>;
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
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: string[] }>;
      /** 批量转换:每文件独立输出;始终 ok:true,成败看 items 逐条。 */
      convertBatch: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<BatchResult>;
      /** 合并转换:所有文件合成一个文档。 */
      convertMerge: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: string[] }>;
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
      /** 在资源管理器中显示目标文件。 */
      revealInFolder: (filePath: string) => Promise<void>;
      /** 用系统默认程序打开目标文件;失败返回 { ok: false, error }。 */
      openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 在主进程独立窗口预览转换排版(与 PDF 同排版);失败返回 { ok: false, error }。 */
      openPreview: (mdPath: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

/* ---------- 设置类型(与主进程 settings.ts 契约一致) ---------- */
type Paper = "A4" | "A3" | "A5" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";
interface PageSetup {
  paper: Paper;
  orientation: Orientation;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}
type AfterConvert = "none" | "show-in-folder" | "open";
interface AppSettings {
  version: 1;
  format: "docx" | "pdf";
  pageSetup: PageSetup;
  breakBeforeH1: boolean;
  afterConvert: AfterConvert;
}

/* ---------- 批量 / 合并契约类型 ---------- */
interface BatchProgressInfo {
  index: number;
  total: number;
  file: string;
  stage: string;
}

interface BatchItem {
  file: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
  warnings?: string[];
}

interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
}

/** 与主进程 DEFAULT_SETTINGS 一致;设置读取失败时静默回退到此值。 */
const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  format: "docx",
  pageSetup: {
    paper: "A4",
    orientation: "portrait",
    marginTop: 25,
    marginBottom: 25,
    marginLeft: 32,
    marginRight: 32,
  },
  breakBeforeH1: false,
  afterConvert: "none",
};

/** 边距钳制范围,与主进程 sanitizePageSetup 一致 */
const MARGIN_MIN = 0;
const MARGIN_MAX = 1000;

export {};

/* ---------- DOM 引用 ---------- */
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const selectBtn = document.getElementById("selectBtn") as HTMLButtonElement;
const dropDefault = document.getElementById("dropDefault") as HTMLDivElement;
const dropFile = document.getElementById("dropFile") as HTMLDivElement;
const fileNameEl = document.getElementById("fileName") as HTMLParagraphElement;
const filePathEl = document.getElementById("filePath") as HTMLParagraphElement;
const dropMulti = document.getElementById("dropMulti") as HTMLDivElement;
const multiCount = document.getElementById("multiCount") as HTMLParagraphElement;
const multiList = document.getElementById("multiList") as HTMLUListElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const convertBtn = document.getElementById("convertBtn") as HTMLButtonElement;
const batchBtn = document.getElementById("batchBtn") as HTMLButtonElement;
const mergeBtn = document.getElementById("mergeBtn") as HTMLButtonElement;
const convertHint = document.querySelector<HTMLSpanElement>(".convert .hint");
const completeDialog = document.getElementById(
  "completeDialog",
) as HTMLDivElement;
const completeOutputPath = document.getElementById(
  "completeOutputPath",
) as HTMLParagraphElement;
const completeDialogOk = document.getElementById(
  "completeDialogOk",
) as HTMLButtonElement;
const formatInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="format"]',
);
// 页面设置面板
const paperSelect = document.getElementById("paperSelect") as HTMLSelectElement;
const orientationInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="orientation"]',
);
const breakBeforeH1Input = document.getElementById(
  "breakBeforeH1",
) as HTMLInputElement;
const afterConvertInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="afterConvert"]',
);
const marginInputs = {
  marginTop: document.getElementById("marginTop") as HTMLInputElement,
  marginBottom: document.getElementById("marginBottom") as HTMLInputElement,
  marginLeft: document.getElementById("marginLeft") as HTMLInputElement,
  marginRight: document.getElementById("marginRight") as HTMLInputElement,
};
// 完成弹窗附加按钮与错误提示
const completeDialogReveal = document.getElementById(
  "completeDialogReveal",
) as HTMLButtonElement;
const completeDialogOpen = document.getElementById(
  "completeDialogOpen",
) as HTMLButtonElement;
const completeDialogPreview = document.getElementById(
  "completeDialogPreview",
) as HTMLButtonElement;
const completeDialogError = document.getElementById(
  "completeDialogError",
) as HTMLParagraphElement;
// 批量结果汇总弹窗
const batchDialog = document.getElementById("batchDialog") as HTMLDivElement;
const batchSummary = document.getElementById("batchSummary") as HTMLParagraphElement;
const batchResultList = document.getElementById(
  "batchResultList",
) as HTMLUListElement;
const batchDialogOk = document.getElementById(
  "batchDialogOk",
) as HTMLButtonElement;
const batchDialogReveal = document.getElementById(
  "batchDialogReveal",
) as HTMLButtonElement;
const batchDialogError = document.getElementById(
  "batchDialogError",
) as HTMLParagraphElement;

/* ---------- 状态 ---------- */
/** 当前选中的 Markdown 文件列表(1 个或 N 个)。 */
let selectedFiles: string[] = [];
let selectedFormat: "docx" | "pdf" = "docx";
let converting = false;
/** 当前转换模式:控制进度事件归属(忽略迟到事件)。 */
let mode: "single" | "batch" | "merge" | null = null;
let errorFlashTimer: number | undefined;
let unsubscribeProgress: (() => void) | undefined;
let unsubscribeBatchProgress: (() => void) | undefined;
/** 最近一次批量结果(供弹窗「打开所在文件夹」定位成功项)。 */
let lastBatchItems: BatchItem[] | null = null;
/** 拖拽排序状态:源项下标 / 是否插到悬停项之后(-1 表示未在拖拽中)。 */
let dragIndex = -1;
let dragDropAfter = false;
/** 当前设置的内存态(乐观更新,持久化走 settingsSet) */
let settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
};
/** 回填控件期间置位,避免回填触发 change 事件写回 */
let hydratingSettings = false;
/** 弹窗对应输出文件路径(供「打开所在文件夹 / 打开文件」按钮使用) */
let dialogOutputPath = "";

const ERROR_MESSAGE = "仅支持 .md / .markdown 文件";

/* ---------- 工具函数 ---------- */
function isMarkdown(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** 超长路径中间截断,保留首尾(尾部含文件名,信息价值最高)。 */
function truncateMiddle(text: string, max = 88): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.62);
  const tail = max - head - 1;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function setStatus(text: string, isError = false, isWarning = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.toggle("status--warning", isWarning);
  statusEl.title = text;
}

/** 错误提示:状态区红色文字 + 拖放区短暂红色描边。 */
function setError(message: string): void {
  setStatus(message, true);
  dropZone.classList.add("drop-zone--error");
  window.clearTimeout(errorFlashTimer);
  errorFlashTimer = window.setTimeout(
    () => dropZone.classList.remove("drop-zone--error"),
    1400,
  );
}

/* ---------- 选择状态:单文件态 / 多文件态 ---------- */
/** 按当前选择渲染拖放区三种状态,并刷新操作按钮可用性。 */
function renderSelection(): void {
  const n = selectedFiles.length;
  dropZone.classList.toggle("has-file", n > 0);

  if (n === 0) {
    dropDefault.classList.remove("hidden");
    dropFile.classList.add("hidden");
    dropMulti.classList.add("hidden");
  } else if (n === 1) {
    const filePath = selectedFiles[0];
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
}

/** 重建多文件列表:序号 + 文件名 + 上移/下移按钮,严格按 selectedFiles 顺序渲染。 */
function renderMultiList(): void {
  const n = selectedFiles.length;
  multiCount.textContent = `已选择 ${n} 个 Markdown 文件`;
  multiList.replaceChildren(
    ...selectedFiles.map((filePath, index) => {
      const li = document.createElement("li");
      li.className = "multi-item";
      li.draggable = true; // 整行可拖拽排序
      li.dataset.index = String(index);
      li.title = filePath; // 截断展示,悬停看完整路径

      const num = document.createElement("span");
      num.className = "multi-index";
      num.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "multi-name";
      name.textContent = baseName(filePath);

      const actions = document.createElement("span");
      actions.className = "multi-actions";
      actions.append(
        makeMoveButton("up", index > 0, baseName(filePath)),
        makeMoveButton("down", index < n - 1, baseName(filePath)),
      );

      li.append(num, name, actions);
      return li;
    }),
  );
}

/** 上移 / 下移图标按钮(首项上移、末项下移禁用)。 */
function makeMoveButton(
  dir: "up" | "down",
  enabled: boolean,
  fileName: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "multi-move";
  btn.dataset.dir = dir;
  btn.disabled = !enabled;
  btn.title = dir === "up" ? "上移" : "下移";
  btn.setAttribute(
    "aria-label",
    `${dir === "up" ? "上移" : "下移"} ${fileName}`,
  );

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", dir === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6");
  svg.appendChild(path);
  btn.appendChild(svg);
  return btn;
}

/** 相邻交换并重建列表(上移 / 下移按钮共用)。 */
function moveItem(index: number, offset: -1 | 1): void {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= selectedFiles.length) return;
  const [moved] = selectedFiles.splice(index, 1);
  selectedFiles.splice(target, 0, moved);
  renderMultiList();
}

/** 清理拖拽排序的临时状态与视觉类。 */
function clearDragState(): void {
  dragIndex = -1;
  dragDropAfter = false;
  multiList.querySelectorAll(".multi-item").forEach((el) => {
    el.classList.remove("dragging", "drop-before", "drop-after");
  });
}

/**
 * 记录已选文件并更新界面。
 * @param skipped 被跳过(非 md / 无法读取)的项数,>0 时状态区黄色提示。
 */
function applySelection(files: string[], skipped = 0): void {
  selectedFiles = files;
  renderSelection();
  const summary =
    files.length === 1
      ? truncateMiddle(files[0])
      : `已选择 ${files.length} 个文件`;
  const full =
    skipped > 0 ? `${summary}(跳过 ${skipped} 个非 Markdown 项)` : summary;
  setStatus(full, false, skipped > 0);
  statusEl.title = files.length === 1 ? files[0] : full;
}

/** 按当前选择与转换状态刷新操作按钮(选择入口 + 三个转换按钮)。 */
function updateActionButtons(): void {
  const n = selectedFiles.length;
  const multi = n >= 2;
  const busy = converting;
  convertBtn.classList.toggle("hidden", multi);
  batchBtn.classList.toggle("hidden", !multi);
  mergeBtn.classList.toggle("hidden", !multi);
  convertBtn.disabled = busy || n !== 1;
  batchBtn.disabled = busy || !multi;
  mergeBtn.disabled = busy || !multi;
  selectBtn.disabled = busy;
}

/** 焦点还给当前可见的主操作按钮(弹窗关闭后)。 */
function focusActionButton(): void {
  const visible = [batchBtn, convertBtn, mergeBtn].find(
    (btn) => !btn.classList.contains("hidden") && !btn.disabled,
  );
  visible?.focus();
}

/* ---------- 选择文件(系统对话框) ---------- */
async function openDialog(): Promise<void> {
  if (converting) return;
  try {
    const paths = await window.api.openMarkdowns();
    if (paths.length === 0) return; // 用户取消,保持现状
    const files = paths.filter(isMarkdown);
    if (files.length === 0) {
      setError(ERROR_MESSAGE);
      return;
    }
    applySelection(files, paths.length - files.length);
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
    applySelection(files, skipped.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`读取文件失败:${message}`);
  }
}

/* ---------- 转换 ---------- */
const STAGE_TEXT: Record<"read" | "render" | "done", string> = {
  read: "正在读取文件…",
  render: "正在渲染文档…",
  done: "正在完成…",
};

/** 阶段文案:主进程可能发「read」等键名,也可能是现成中文文案,原样兜底。 */
function stageText(stage: string): string {
  return STAGE_TEXT[stage as keyof typeof STAGE_TEXT] ?? stage;
}

/** 单文件转换(与旧版行为一致)。 */
async function runConvert(
  filePath: string,
  format: "docx" | "pdf",
): Promise<void> {
  mode = "single";
  converting = true;
  updateActionButtons(); // 禁用选择入口与转换按钮,防止重复点击
  setStatus("正在转换…");
  try {
    const result = await window.api.convert(filePath, format);
    if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setStatus(`转换完成:${outputPath}`);
      statusEl.title = outputPath; // 长路径悬停可看完整
      showCompleteDialog(outputPath); // 弹窗展示完整路径,便于复制
      if (result.warnings?.length) {
        // 缺失图片等警告:黄色覆盖状态区(悬停 title 保留完成路径 + 警告全文)
        setStatus(`⚠ 警告:${result.warnings.join("; ")}`, false, true);
        statusEl.title = `转换完成:${outputPath}\n警告:${result.warnings.join("; ")}`;
      }
    } else {
      setError(`转换失败:${result.error ?? "未知错误"}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`转换失败:${message}`);
  } finally {
    mode = null;
    converting = false;
    updateActionButtons();
  }
}

/** 批量转换:每文件独立输出,完成弹汇总弹窗逐条展示。 */
async function runBatch(): Promise<void> {
  if (selectedFiles.length < 2) return;
  mode = "batch";
  converting = true;
  updateActionButtons();
  setStatus(`正在批量转换 ${selectedFiles.length} 个文件…`);
  try {
    const result = await window.api.convertBatch(selectedFiles, selectedFormat);
    lastBatchItems = result.items;
    setStatus(
      result.failCount > 0
        ? `批量转换完成:成功 ${result.okCount} / 失败 ${result.failCount}`
        : `批量转换完成:成功 ${result.okCount} 个文件`,
      false,
      result.failCount > 0,
    );
    showBatchDialog(result); // 成败均弹窗,逐条可见
  } catch (err) {
    lastBatchItems = null;
    const message = err instanceof Error ? err.message : String(err);
    setError(`批量转换失败:${message}`);
  } finally {
    mode = null;
    converting = false;
    updateActionButtons();
  }
}

/** 合并转换:所有文件合成一个文档,复用完成弹窗。 */
async function runMerge(): Promise<void> {
  if (selectedFiles.length < 2) return;
  mode = "merge";
  converting = true;
  updateActionButtons();
  setStatus("正在合并转换…");
  try {
    const result = await window.api.convertMerge(selectedFiles, selectedFormat);
    if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setStatus(`合并完成:${outputPath}`);
      statusEl.title = outputPath;
      showCompleteDialog(outputPath);
      if (result.warnings?.length) {
        setStatus(`⚠ 警告:${result.warnings.join("; ")}`, false, true);
        statusEl.title = `合并完成:${outputPath}\n警告:${result.warnings.join("; ")}`;
      }
    } else {
      setError(`合并失败:${result.error ?? "未知错误"}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`合并失败:${message}`);
  } finally {
    mode = null;
    converting = false;
    updateActionButtons();
  }
}

/* ---------- 设置:加载 / 回填 / 写回 ---------- */
/** 启动时读取持久化设置,失败静默回退默认值;回填后解除 hydration 标记。 */
async function loadSettings(): Promise<void> {
  let loaded: AppSettings;
  try {
    loaded = await window.api.settingsGet();
  } catch {
    loaded = DEFAULT_SETTINGS;
  }
  settings = { ...loaded, pageSetup: { ...loaded.pageSetup } };
  hydratingSettings = true;
  applySettingsToControls();
  hydratingSettings = false;
  selectedFormat = settings.format; // 转换格式与设置保持一致
}

/** 将内存设置回填到所有控件(仅赋值,不触发 change 事件)。 */
function applySettingsToControls(): void {
  paperSelect.value = settings.pageSetup.paper;
  orientationInputs.forEach(
    (input) => (input.checked = input.value === settings.pageSetup.orientation),
  );
  (Object.keys(marginInputs) as (keyof PageSetup & keyof typeof marginInputs)[]).forEach(
    (key) => {
      marginInputs[key].value = String(settings.pageSetup[key]);
    },
  );
  breakBeforeH1Input.checked = settings.breakBeforeH1;
  afterConvertInputs.forEach(
    (input) => (input.checked = input.value === settings.afterConvert),
  );
  formatInputs.forEach(
    (input) => (input.checked = input.value === settings.format),
  );
}

/** 写回设置;失败静默(下次交互仍以磁盘为准),不打断用户操作。 */
function persistSettings(patch: Partial<AppSettings>): void {
  void window.api.settingsSet(patch).catch(() => {
    /* 忽略:设置写入失败不阻塞主流程 */
  });
}

/** 页面尺寸相关字段(纸张/方向/边距)整体写回。 */
function persistPageSetup(): void {
  persistSettings({ pageSetup: { ...settings.pageSetup } });
}

/** 边距输入:非法值回显当前设置,合法值钳制后写回。 */
function handleMarginChange(key: keyof typeof marginInputs): void {
  if (hydratingSettings) return;
  const input = marginInputs[key];
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    input.value = String(settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    return;
  }
  const clamped = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, value));
  settings.pageSetup[key] = clamped;
  input.value = String(clamped); // 回显钳制后的值,与主进程持久化结果一致
  persistPageSetup();
}

/* ---------- 转换完成弹窗(单文件 / 合并) ---------- */
function showCompleteDialog(outputPath: string): void {
  dialogOutputPath = outputPath;
  completeOutputPath.textContent = outputPath;
  completeOutputPath.title = outputPath; // 路径超长滚动时悬停可看全文
  completeDialogError.classList.add("hidden");
  completeDialogError.textContent = "";
  completeDialog.classList.remove("hidden");
  completeDialogOk.focus(); // 焦点落在默认操作(确定)上
}

function hideCompleteDialog(): void {
  completeDialog.classList.add("hidden");
  focusActionButton(); // 焦点还给触发按钮,便于键盘继续操作
}

/** 弹窗内错误提示(打开文件失败等非致命错误,不打断弹窗)。 */
function showDialogError(message: string): void {
  completeDialogError.textContent = message;
  completeDialogError.classList.remove("hidden");
}

/* ---------- 批量结果汇总弹窗 ---------- */
function showBatchDialog(result: BatchResult): void {
  batchSummary.textContent = `成功 ${result.okCount} / 失败 ${result.failCount}`;
  batchSummary.classList.toggle("batch-summary--fail", result.failCount > 0);
  batchResultList.replaceChildren(...result.items.map(renderBatchItem));
  batchDialogReveal.classList.toggle("hidden", result.okCount === 0);
  batchDialogError.classList.add("hidden");
  batchDialogError.textContent = "";
  batchDialog.classList.remove("hidden");
  batchDialogOk.focus(); // 焦点落在默认操作(确定)上
}

function hideBatchDialog(): void {
  batchDialog.classList.add("hidden");
  focusActionButton();
}

/** 逐条结果:文件名 + 成功/失败图标 + 警告(黄)/错误(红)信息。 */
function renderBatchItem(item: BatchItem): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `batch-item batch-item--${item.ok ? "success" : "fail"}`;

  const head = document.createElement("div");
  head.className = "batch-item-head";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "batch-item-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2.5");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", item.ok ? "M20 6L9 17l-5-5" : "M18 6L6 18M6 6l12 12");
  icon.appendChild(path);
  head.appendChild(icon);

  const name = document.createElement("span");
  name.className = "batch-item-name";
  name.textContent = baseName(item.file);
  name.title = item.file; // 截断展示,悬停看完整路径
  head.appendChild(name);
  li.appendChild(head);

  // 信息行:警告在前(黄),错误在后(红)
  const msgs = document.createElement("div");
  msgs.className = "batch-item-msgs";
  let hasMsgs = false;
  for (const warning of item.warnings ?? []) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--warning";
    p.textContent = `警告:${warning}`;
    msgs.appendChild(p);
    hasMsgs = true;
  }
  if (item.error) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--error";
    p.textContent = item.error;
    msgs.appendChild(p);
    hasMsgs = true;
  }
  if (hasMsgs) li.appendChild(msgs);

  return li;
}

/* ---------- 事件绑定 ---------- */
selectBtn.addEventListener("click", (event) => {
  event.stopPropagation(); // 避免冒泡触发拖放区点击,重复打开对话框
  void openDialog();
});

// 点击拖放区同样打开对话框;键盘可用(Enter / 空格)
dropZone.addEventListener("click", () => void openDialog());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void openDialog();
  }
});

// 多文件列表:点击列表本身不触发换文件(避免误开对话框);
// 上移/下移按钮走事件委托,点击后重排 selectedFiles 并重建列表
multiList.addEventListener("click", (event) => {
  event.stopPropagation();
  if (converting) return;
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
    ".multi-move",
  );
  if (!btn) return;
  const li = btn.closest<HTMLLIElement>(".multi-item");
  if (!li) return;
  const index = Number(li.dataset.index);
  const dir = btn.dataset.dir;
  moveItem(index, dir === "up" ? -1 : 1);
});

// 拖拽排序(HTML5 drag events):列表位于可滚动容器内,悬停边缘时自动滚动。
// 所有内部拖拽事件 stopPropagation,避免触发拖放区的外部文件高亮 / 换文件逻辑。
multiList.addEventListener("dragstart", (event) => {
  if (converting) {
    event.preventDefault();
    return;
  }
  const li = (event.target as HTMLElement).closest<HTMLLIElement>(
    ".multi-item",
  );
  if (!li) return;
  dragIndex = Number(li.dataset.index);
  dragDropAfter = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // 部分平台需 setData 才会启动拖拽
    event.dataTransfer.setData("text/plain", String(dragIndex));
  }
  li.classList.add("dragging");
});

multiList.addEventListener("dragover", (event) => {
  event.preventDefault(); // 允许 drop
  event.stopPropagation(); // 不触发拖放区的外部拖入高亮
  if (dragIndex < 0 || converting) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const li = (event.target as HTMLElement).closest<HTMLLIElement>(
    ".multi-item",
  );
  if (!li) return;
  const targetIndex = Number(li.dataset.index);
  const rect = li.getBoundingClientRect();
  dragDropAfter = event.clientY > rect.top + rect.height / 2;

  // 更新插入指示:目标项上/下沿高亮
  multiList.querySelectorAll(".multi-item").forEach((el) => {
    el.classList.remove("drop-before", "drop-after");
  });
  if (targetIndex !== dragIndex) {
    li.classList.add(dragDropAfter ? "drop-after" : "drop-before");
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
  if (dragIndex < 0 || converting) return;
  const li = (event.target as HTMLElement).closest<HTMLLIElement>(
    ".multi-item",
  );
  if (!li || Number(li.dataset.index) === dragIndex) {
    clearDragState(); // 落在自身或列表空白处:放弃
    return;
  }
  const targetIndex = Number(li.dataset.index);
  let insertAt = dragDropAfter ? targetIndex + 1 : targetIndex;
  if (insertAt > dragIndex) insertAt -= 1; // 移除源项后目标下标前移
  const [moved] = selectedFiles.splice(dragIndex, 1);
  selectedFiles.splice(insertAt, 0, moved);
  renderMultiList();
  clearDragState();
});

multiList.addEventListener("dragend", () => clearDragState());

// 拖放:dragover 必须 preventDefault,否则 drop 不会触发
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (dragIndex >= 0) return; // 内部排序拖拽:不显示外部拖入高亮
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
  if (dragIndex >= 0) {
    clearDragState(); // 内部排序拖拽落到列表外:放弃排序
    return;
  }
  if (converting) return;

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

// 格式选择:记录当前选中格式(转换时使用),并持久化到设置
formatInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked || hydratingSettings) return;
    selectedFormat = input.value as "docx" | "pdf";
    settings.format = selectedFormat;
    persistSettings({ format: selectedFormat });
  });
});

/* ---------- 页面设置面板:任一控件变更即时生效并持久化 ---------- */
paperSelect.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.pageSetup.paper = paperSelect.value as Paper;
  persistPageSetup();
});

orientationInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked || hydratingSettings) return;
    settings.pageSetup.orientation = input.value as Orientation;
    persistPageSetup();
  });
});

breakBeforeH1Input.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.breakBeforeH1 = breakBeforeH1Input.checked;
  persistSettings({ breakBeforeH1: settings.breakBeforeH1 });
});

afterConvertInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked || hydratingSettings) return;
    settings.afterConvert = input.value as AfterConvert;
    persistSettings({ afterConvert: settings.afterConvert });
  });
});

(Object.keys(marginInputs) as (keyof typeof marginInputs)[]).forEach((key) => {
  marginInputs[key].addEventListener("change", () => handleMarginChange(key));
});

// 完成弹窗:预览 / 打开所在文件夹 / 打开文件(失败在弹窗内提示,不打断)
completeDialogPreview.addEventListener("click", () => {
  // 预览使用源 md 路径(selectedFiles[0]);转换成功必然先选了文件,此处仅做兜底
  const mdPath = selectedFiles[0];
  if (!mdPath) {
    showDialogError("无法预览:源文件路径缺失");
    return;
  }
  window.api
    .openPreview(mdPath)
    .then((result) => {
      if (!result.ok) showDialogError(result.error ?? "无法打开预览");
    })
    .catch((err) =>
      showDialogError(
        `无法打开预览:${err instanceof Error ? err.message : String(err)}`,
      ),
    );
});

completeDialogReveal.addEventListener("click", () => {
  if (!dialogOutputPath) return;
  window.api
    .revealInFolder(dialogOutputPath)
    .catch((err) =>
      showDialogError(
        `无法打开所在文件夹:${err instanceof Error ? err.message : String(err)}`,
      ),
    );
});

completeDialogOpen.addEventListener("click", () => {
  if (!dialogOutputPath) return;
  window.api
    .openFile(dialogOutputPath)
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
  const filePath = selectedFiles[0];
  if (!filePath) {
    setError("请先选择 Markdown 文件");
    return;
  }
  void runConvert(filePath, selectedFormat);
});

// 批量转换按钮(≥2 个文件时可见)
batchBtn.addEventListener("click", () => {
  if (selectedFiles.length < 2) return;
  void runBatch();
});

// 合并转换按钮(≥2 个文件时可见)
mergeBtn.addEventListener("click", () => {
  if (selectedFiles.length < 2) return;
  void runMerge();
});

// 批量汇总弹窗:打开所在文件夹(定位第一个成功项)/ 确定
batchDialogReveal.addEventListener("click", () => {
  const target = lastBatchItems?.find((item) => item.ok && item.outputPath)
    ?.outputPath;
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

// 进度订阅:单文件/合并走 convert:progress;批量走 batch:progress。
// mode 标志确保只响应当前模式的进度,转换结束后的迟到事件直接忽略。
unsubscribeProgress = window.api.onConvertProgress((stage) => {
  if (mode !== "single" && mode !== "merge") return;
  const text = STAGE_TEXT[stage];
  if (text) setStatus(text);
});

unsubscribeBatchProgress = window.api.onBatchProgress((info) => {
  if (mode !== "batch") return;
  const text = `第 ${info.index} / ${info.total} 个:${baseName(info.file)} · ${stageText(info.stage)}`;
  setStatus(text);
});

// 窗口关闭时取消进度订阅
window.addEventListener("unload", () => {
  unsubscribeProgress?.();
  unsubscribeBatchProgress?.();
});

// 弹窗关闭:确定按钮 / 点击遮罩 / Esc 三种方式
completeDialogOk.addEventListener("click", hideCompleteDialog);
completeDialog.addEventListener("click", (event) => {
  // 只响应遮罩本身,点卡片内部不关闭
  if (event.target === completeDialog) hideCompleteDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!completeDialog.classList.contains("hidden")) {
    hideCompleteDialog();
  } else if (!batchDialog.classList.contains("hidden")) {
    hideBatchDialog();
  }
});

/* ---------- 初始化 ---------- */
// 按钮旁说明文案(docx / pdf 均已支持)
if (convertHint) convertHint.textContent = "输出格式:docx / PDF";
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled)
updateActionButtons();
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
