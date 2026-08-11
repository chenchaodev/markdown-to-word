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
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  DEFAULT_SETTINGS,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM as MARGIN_MAX,
  MARGIN_MIN_MM as MARGIN_MIN,
  type AppSettings,
  type PageSetup,
  type TypographySettings,
} from "../core/settings-defaults.js";

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
      /** 在资源管理器中显示目标文件。 */
      revealInFolder: (filePath: string) => Promise<void>;
      /** 用系统默认程序打开目标文件;失败返回 { ok: false, error }。 */
      openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 在主进程独立窗口预览转换排版(与 PDF 同排版);失败返回 { ok: false, error }。 */
      openPreview: (mdPath: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

/* ---------- 设置类型(契约收敛于 core/settings-defaults.ts) ---------- */
type Paper = "A4" | "A3" | "A5" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";
type AfterConvert = "none" | "show-in-folder" | "open";
type BodyAlign = "left" | "justify";

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
  /** 用户取消导致未执行转换的项。 */
  canceled?: boolean;
}

interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
  /** 用户取消未执行的项数。 */
  canceledCount: number;
}

/* ---------- 模板预设:排版 + 页面设置的快照(套用后仍可微调,不写死模板 id) ---------- */
interface TemplatePreset {
  id: string;
  /** 中文名,用户可见 */
  name: string;
  /** 简短说明,显示在模板选择行 */
  hint: string;
  typography: TypographySettings;
  pageSetup: PageSetup;
}

/** 预设值已定稿,勿改(与批次 6 规划一致)。 */
const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "default",
    name: "默认",
    hint: "常规文档:微软雅黑正文、两端对齐、行距 1.5",
    typography: { ...DEFAULT_SETTINGS.typography },
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
  },
  {
    id: "paper",
    name: "学术论文",
    hint: "论文常用:宋体正文 + Times New Roman 西文、两端对齐、标准页边距",
    typography: {
      fontAscii: "Times New Roman",
      fontEastAsia: "宋体",
      bodySizePt: 12,
      lineSpacing: 1.5,
      firstLineIndent: true,
      align: "justify",
      headingNumbering: true,
      captionNumbering: true,
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 25.4,
      marginBottom: 25.4,
      marginLeft: 31.7,
      marginRight: 31.7,
    },
  },
  {
    id: "business",
    name: "商务简报",
    hint: "简报常用:微软雅黑正文、左对齐、行距 1.15、页边距更紧凑",
    typography: {
      fontAscii: "Calibri",
      fontEastAsia: "微软雅黑",
      bodySizePt: 11,
      lineSpacing: 1.15,
      firstLineIndent: false,
      align: "left",
      headingNumbering: false,
      captionNumbering: false,
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 19.1,
      marginBottom: 19.1,
      marginLeft: 25.4,
      marginRight: 25.4,
    },
  },
];

/** 当前排版与页面设置是否与某预设完全一致(用于回填时选中对应模板)。 */
function matchesPreset(preset: TemplatePreset, settings: AppSettings): boolean {
  const { typography: t, pageSetup: p } = preset;
  const { typography: st, pageSetup: sp } = settings;
  return (
    t.fontAscii === st.fontAscii &&
    t.fontEastAsia === st.fontEastAsia &&
    t.bodySizePt === st.bodySizePt &&
    t.lineSpacing === st.lineSpacing &&
    t.firstLineIndent === st.firstLineIndent &&
    t.align === st.align &&
    t.headingNumbering === st.headingNumbering &&
    t.captionNumbering === st.captionNumbering &&
    p.paper === sp.paper &&
    p.orientation === sp.orientation &&
    p.marginTop === sp.marginTop &&
    p.marginBottom === sp.marginBottom &&
    p.marginLeft === sp.marginLeft &&
    p.marginRight === sp.marginRight
  );
}

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
const tocInput = document.getElementById("toc") as HTMLInputElement;
const afterConvertInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="afterConvert"]',
);
const marginInputs = {
  marginTop: document.getElementById("marginTop") as HTMLInputElement,
  marginBottom: document.getElementById("marginBottom") as HTMLInputElement,
  marginLeft: document.getElementById("marginLeft") as HTMLInputElement,
  marginRight: document.getElementById("marginRight") as HTMLInputElement,
};
// 排版设置面板
const fontAsciiInput = document.getElementById("fontAscii") as HTMLInputElement;
const fontEastAsiaInput = document.getElementById(
  "fontEastAsia",
) as HTMLInputElement;
const bodySizePtInput = document.getElementById(
  "bodySizePt",
) as HTMLInputElement;
const lineSpacingInput = document.getElementById(
  "lineSpacing",
) as HTMLInputElement;
const firstLineIndentInput = document.getElementById(
  "firstLineIndent",
) as HTMLInputElement;
const alignJustifyInput = document.getElementById(
  "alignJustify",
) as HTMLInputElement;
const headingNumberingInput = document.getElementById(
  "headingNumbering",
) as HTMLInputElement;
const captionNumberingInput = document.getElementById(
  "captionNumbering",
) as HTMLInputElement;
// 模板预设
const templatePresetSelect = document.getElementById(
  "templatePreset",
) as HTMLSelectElement;
const templatePresetHint = document.getElementById(
  "templatePresetHint",
) as HTMLSpanElement;
// 完成弹窗附加按钮与错误提示
const completeDialogReveal = document.getElementById(
  "completeDialogReveal",
) as HTMLButtonElement;
const completeDialogOpen = document.getElementById(
  "completeDialogOpen",
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
// 批次 7:列表工具(单文件移除 / 多文件追加与清空)
const removeFileBtn = document.getElementById(
  "removeFileBtn",
) as HTMLButtonElement;
// 迭代 4:单文件态「预览」按钮(转换前预览排版,与 PDF 同排版)
const previewBtn = document.getElementById("previewBtn") as HTMLButtonElement;
const appendBtn = document.getElementById("appendBtn") as HTMLButtonElement;
const clearListBtn = document.getElementById(
  "clearListBtn",
) as HTMLButtonElement;
// 批次 7:转换进度(进度条 + 百分比 + 取消)
const progressArea = document.getElementById("progressArea") as HTMLDivElement;
const progressTrack = document.getElementById(
  "progressTrack",
) as HTMLDivElement;
const progressFill = document.getElementById("progressFill") as HTMLDivElement;
const progressText = document.getElementById("progressText") as HTMLSpanElement;
const cancelBtn = document.getElementById("cancelBtn") as HTMLButtonElement;
// 批次 7:转换结果汇总(常驻,不依赖弹窗;打开引导 + 可折叠警告)
const resultSummary = document.getElementById("resultSummary") as HTMLDivElement;
const summaryIcon = document.getElementById("summaryIcon") as HTMLElement;
const summaryText = document.getElementById("summaryText") as HTMLParagraphElement;
const summaryPath = document.getElementById("summaryPath") as HTMLParagraphElement;
const summaryError = document.getElementById("summaryError") as HTMLParagraphElement;
const summaryRevealBtn = document.getElementById(
  "summaryRevealBtn",
) as HTMLButtonElement;
const summaryOpenBtn = document.getElementById(
  "summaryOpenBtn",
) as HTMLButtonElement;
const summaryDetailsBtn = document.getElementById(
  "summaryDetailsBtn",
) as HTMLButtonElement;
const summaryWarnings = document.getElementById(
  "summaryWarnings",
) as HTMLDetailsElement;
const summaryWarningsToggle = document.getElementById(
  "summaryWarningsToggle",
) as HTMLElement;
const summaryWarningsList = document.getElementById(
  "summaryWarningsList",
) as HTMLUListElement;
// 批次 7:字段级错误提示(边距 / 字体 / 字号 / 行距)
const marginError = document.getElementById("marginError") as HTMLParagraphElement;
const fontAsciiError = document.getElementById(
  "fontAsciiError",
) as HTMLParagraphElement;
const fontEastAsiaError = document.getElementById(
  "fontEastAsiaError",
) as HTMLParagraphElement;
const bodySizeError = document.getElementById(
  "bodySizeError",
) as HTMLParagraphElement;
const lineSpacingError = document.getElementById(
  "lineSpacingError",
) as HTMLParagraphElement;
// 批次 7:输出目录设置
const outputDirValue = document.getElementById(
  "outputDirValue",
) as HTMLSpanElement;
const outputDirPick = document.getElementById(
  "outputDirPick",
) as HTMLButtonElement;
const outputDirReset = document.getElementById(
  "outputDirReset",
) as HTMLButtonElement;
// 批次 7:完成弹窗复制路径
const completeDialogCopy = document.getElementById(
  "completeDialogCopy",
) as HTMLButtonElement;
const completeDialogTitle = document.getElementById(
  "completeDialogTitle",
) as HTMLHeadingElement;
const completeDialogDesc = document.getElementById(
  "completeDialogDesc",
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
  typography: { ...DEFAULT_SETTINGS.typography },
};
/** 回填控件期间置位,避免回填触发 change 事件写回 */
let hydratingSettings = false;
/** 弹窗对应输出文件路径(供「打开所在文件夹 / 打开文件」按钮使用) */
let dialogOutputPath = "";
/** 最近一次批量结果(供汇总条「失败详情」重开弹窗)。 */
let lastBatchResult: BatchResult | null = null;
/** 最近一次汇总条展示的输出路径(供「打开所在文件夹 / 打开文件」按钮使用)。 */
let summaryOutputPath = "";

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
        makePreviewButton(baseName(filePath)),
        makeRemoveButton(baseName(filePath)),
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

/** 预览该文件的文字按钮(迭代 4:转换前预览排版,与 PDF 同排版)。 */
function makePreviewButton(fileName: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "multi-preview";
  btn.title = "预览转换排版(与 PDF 同排版)";
  btn.setAttribute("aria-label", `预览 ${fileName}`);
  btn.textContent = "预览";
  return btn;
}

/** 移除该文件的图标按钮(批次 7 列表增删)。 */
function makeRemoveButton(fileName: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "multi-remove";
  btn.dataset.dir = "remove";
  btn.title = "移除";
  btn.setAttribute("aria-label", `移除 ${fileName}`);

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

/**
 * 追加选择:与现有列表合并(去重),供「追加文件 / 点击继续添加」使用。
 * @param skipped 本次被跳过的非 md 项数(与重复项合并提示)。
 */
function appendSelection(files: string[], skipped = 0): void {
  const seen = new Set(selectedFiles);
  const added = files.filter((filePath) => !seen.has(filePath));
  const dupCount = files.length - added.length;
  applySelection([...selectedFiles, ...added], skipped + dupCount);
}

/** 按当前选择与转换状态刷新操作按钮(选择入口 + 三个转换按钮 + 单文件态预览)。 */
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
  // 单文件态预览:仅在选中 1 个文件时可见(dropFile 区),转换中禁用
  previewBtn.disabled = busy || n !== 1;
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
/** 打开文件对话框;append=true 时与现有列表合并(「追加文件 / 继续添加」入口)。 */
async function openDialog(append = false): Promise<void> {
  if (converting) return;
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

/* ---------- 批次 7:进度条与汇总条 ---------- */
/** 阶段 → 进度百分比(主进程只发阶段键,映射近似进度:读取 15% / 渲染 70% / 完成 95%)。 */
const STAGE_PERCENT: Record<string, number> = { read: 15, render: 70, done: 95 };

/** 更新进度条宽度与百分比文本(0–100 钳制)。 */
function setProgress(percent: number): void {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  progressFill.style.width = `${clamped}%`;
  progressText.textContent = `${clamped}%`;
  progressTrack.setAttribute("aria-valuenow", String(clamped));
}

/** 显示进度区并复位进度(同时使能取消按钮)。 */
function showProgress(): void {
  progressArea.classList.remove("hidden");
  cancelBtn.disabled = false;
  setProgress(0);
}

/** 隐藏进度区(转换结束;取消按钮状态随之下次 showProgress 复位)。 */
function hideProgress(): void {
  progressArea.classList.add("hidden");
}

/** 转换结果汇总条(常驻,不依赖弹窗;成功/失败/取消三态 + 打开引导 + 可折叠警告)。 */
interface SummaryOptions {
  kind: "ok" | "fail" | "canceled";
  title: string;
  outputPath?: string;
  error?: string;
  warnings?: string[];
  /** 批量场景:有失败详情可回看(「失败详情」按钮重开批量弹窗)。 */
  hasDetails?: boolean;
}

function showSummary(opts: SummaryOptions): void {
  resultSummary.classList.remove("hidden");
  const ok = opts.kind === "ok";
  resultSummary.classList.toggle("result-summary--ok", ok);
  resultSummary.classList.toggle("result-summary--fail", !ok);
  summaryIcon
    .querySelector("path")
    ?.setAttribute("d", ok ? "M20 6L9 17l-5-5" : "M18 6L6 18M6 6l12 12");
  summaryText.textContent = opts.title;
  summaryOutputPath = opts.outputPath ?? "";
  summaryPath.classList.toggle("hidden", !opts.outputPath);
  if (opts.outputPath) {
    summaryPath.textContent = opts.outputPath;
    summaryPath.title = opts.outputPath;
  }
  summaryError.classList.toggle("hidden", !opts.error);
  if (opts.error) summaryError.textContent = opts.error;
  summaryRevealBtn.classList.toggle("hidden", !opts.outputPath);
  summaryOpenBtn.classList.toggle("hidden", !opts.outputPath);
  summaryDetailsBtn.classList.toggle("hidden", !opts.hasDetails);
  const warnings = opts.warnings ?? [];
  summaryWarnings.classList.toggle("hidden", warnings.length === 0);
  summaryWarningsToggle.textContent = `警告(${warnings.length})`;
  summaryWarningsList.replaceChildren(
    ...warnings.map((warning) => {
      const li = document.createElement("li");
      li.className = "summary-warnings-item";
      li.textContent = warning;
      return li;
    }),
  );
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
  showProgress();
  try {
    const result = await window.api.convert(filePath, format);
    if (result.canceled) {
      setStatus("已取消");
      showSummary({ kind: "canceled", title: "转换已取消" });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(`转换完成:${outputPath}`);
      statusEl.title = outputPath; // 长路径悬停可看完整
      showSummary({
        kind: "ok",
        title: "转换完成",
        outputPath,
        warnings: result.warnings,
      });
      showCompleteDialog(outputPath); // 弹窗展示完整路径,便于复制
    } else {
      const error = result.error ?? "未知错误";
      setError(`转换失败:${error}`);
      showSummary({ kind: "fail", title: "转换失败", error });
      showCompleteDialog("", error, baseName(filePath)); // 失败弹窗:错误三要素
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`转换失败:${message}`);
    showSummary({ kind: "fail", title: "转换失败", error: message });
  } finally {
    mode = null;
    converting = false;
    hideProgress();
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
  showProgress();
  try {
    const result = await window.api.convertBatch(selectedFiles, selectedFormat);
    lastBatchItems = result.items;
    lastBatchResult = result;
    setProgress(100);
    const canceledText =
      result.canceledCount > 0 ? `,取消 ${result.canceledCount}` : "";
    const title =
      result.failCount > 0
        ? `批量完成:成功 ${result.okCount} / 失败 ${result.failCount}${canceledText}`
        : `批量完成:成功 ${result.okCount} 个文件${canceledText}`;
    setStatus(title, false, result.failCount > 0);
    showSummary({
      kind: result.failCount > 0 ? "fail" : "ok",
      title,
      hasDetails: result.failCount > 0,
      warnings: result.items.flatMap((item) => item.warnings ?? []),
    });
    showBatchDialog(result); // 成败均弹窗,逐条可见
  } catch (err) {
    lastBatchItems = null;
    lastBatchResult = null;
    const message = err instanceof Error ? err.message : String(err);
    setError(`批量转换失败:${message}`);
    showSummary({ kind: "fail", title: "批量转换失败", error: message });
  } finally {
    mode = null;
    converting = false;
    hideProgress();
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
  showProgress();
  try {
    const result = await window.api.convertMerge(selectedFiles, selectedFormat);
    if (result.canceled) {
      setStatus("已取消");
      showSummary({ kind: "canceled", title: "合并已取消" });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(`合并完成:${outputPath}`);
      statusEl.title = outputPath;
      showSummary({
        kind: "ok",
        title: "合并完成",
        outputPath,
        warnings: result.warnings,
      });
      showCompleteDialog(outputPath);
    } else {
      const error = result.error ?? "未知错误";
      setError(`合并失败:${error}`);
      showSummary({ kind: "fail", title: "合并失败", error });
      showCompleteDialog("", error, `${baseName(selectedFiles[0])}-合并`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`合并失败:${message}`);
    showSummary({ kind: "fail", title: "合并失败", error: message });
  } finally {
    mode = null;
    converting = false;
    hideProgress();
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
  // 防御性合并:旧版本设置缺字段时按默认值兜底(outputDir 缺省 = 源目录)
  settings = {
    ...DEFAULT_SETTINGS,
    ...loaded,
    outputDir: loaded.outputDir ?? DEFAULT_SETTINGS.outputDir,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, ...loaded.pageSetup },
    typography: { ...DEFAULT_SETTINGS.typography, ...loaded.typography },
  };
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
  fontAsciiInput.value = settings.typography.fontAscii;
  fontEastAsiaInput.value = settings.typography.fontEastAsia;
  bodySizePtInput.value = String(settings.typography.bodySizePt);
  lineSpacingInput.value = String(settings.typography.lineSpacing);
  firstLineIndentInput.checked = settings.typography.firstLineIndent;
  alignJustifyInput.checked = settings.typography.align === "justify";
  headingNumberingInput.checked = settings.typography.headingNumbering;
  captionNumberingInput.checked = settings.typography.captionNumbering;
  // 模板预设:与某预设完全一致时选中,否则回退「默认」并提示已进入自定义模式
  const matchedPreset = TEMPLATE_PRESETS.find((preset) =>
    matchesPreset(preset, settings),
  );
  templatePresetSelect.value = matchedPreset?.id ?? "default";
  const isCustom = !matchedPreset;
  templatePresetHint.textContent = isCustom
    ? "已微调,与模板预设不一致"
    : (matchedPreset ?? TEMPLATE_PRESETS[0]).hint;
  templatePresetHint.classList.toggle("template-hint--custom", isCustom);
  breakBeforeH1Input.checked = settings.breakBeforeH1;
  tocInput.checked = settings.toc;
  afterConvertInputs.forEach(
    (input) => (input.checked = input.value === settings.afterConvert),
  );
  formatInputs.forEach(
    (input) => (input.checked = input.value === settings.format),
  );
  // 输出目录:空串显示「源文件所在目录」
  outputDirValue.textContent = settings.outputDir || "源文件所在目录";
  outputDirValue.title = settings.outputDir || "源文件所在目录";
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

/** 排版相关字段(字体/字号/行距/段落样式)整体写回。 */
function persistTypography(): void {
  persistSettings({ typography: { ...settings.typography } });
}

/** 边距输入:非法值回显当前设置,合法值钳制后写回;非法时字段内提示。 */
function handleMarginChange(key: keyof typeof marginInputs): void {
  if (hydratingSettings) return;
  const input = marginInputs[key];
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    input.value = String(settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    showFieldError(marginError, `请输入 0–${MARGIN_MAX} 之间的数字`);
    return;
  }
  const clamped = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, value));
  settings.pageSetup[key] = clamped;
  input.value = String(clamped); // 回显钳制后的值,与主进程持久化结果一致
  hideFieldError(marginError);
  persistPageSetup();
}

/** 字号 / 行距输入:空、非数字或超出范围时回显当前设置值,并字段内提示。 */
function handleTypographyNumberChange(
  key: "bodySizePt" | "lineSpacing",
  min: number,
  max: number,
): void {
  if (hydratingSettings) return;
  const input = key === "bodySizePt" ? bodySizePtInput : lineSpacingInput;
  const errorEl = key === "bodySizePt" ? bodySizeError : lineSpacingError;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < min || value > max) {
    input.value = String(settings.typography[key]); // 空/非法/超范围:恢复为当前设置值
    showFieldError(errorEl, `请输入 ${min}–${max} 之间的数字`);
    return;
  }
  settings.typography[key] = value;
  hideFieldError(errorEl);
  persistTypography();
}

/** 字段内错误提示:显示消息并保持控件值可编辑(仅提示,不阻塞)。 */
function showFieldError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideFieldError(el: HTMLElement): void {
  el.classList.add("hidden");
}

/* ---------- 转换完成弹窗(单文件 / 合并) ---------- */
/**
 * 打开完成弹窗;error 非空时进入失败态(标题「转换失败」、路径行红色显示原因、
 * 隐藏复制/打开按钮),满足错误三要素:文件名(desc)+ 原因(路径行)+ 操作(确定)。
 */
function showCompleteDialog(
  outputPath: string,
  error?: string,
  fileName?: string,
): void {
  dialogOutputPath = outputPath;
  const ok = !error;
  completeDialogTitle.textContent = ok ? "转换完成" : "转换失败";
  completeDialogDesc.textContent = ok
    ? "文档已生成,输出路径如下"
    : `${fileName ?? ""} 未能转换`;
  completeOutputPath.textContent = ok ? outputPath : (error ?? "");
  completeOutputPath.title = completeOutputPath.textContent;
  completeOutputPath.classList.toggle("dialog-path--error", !ok);
  completeDialogCopy.classList.toggle("hidden", !ok);
  completeDialogError.classList.add("hidden");
  completeDialogError.textContent = "";
  completeDialogReveal.classList.toggle("hidden", !ok);
  completeDialogOpen.classList.toggle("hidden", !ok);
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
  const canceledText =
    result.canceledCount > 0 ? ` / 取消 ${result.canceledCount}` : "";
  batchSummary.textContent = `成功 ${result.okCount} / 失败 ${result.failCount}${canceledText}`;
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

/** 逐条结果:文件名 + 成功/失败/取消图标 + 警告(黄)/错误(红)/取消(灰)信息。 */
function renderBatchItem(item: BatchItem): HTMLLIElement {
  const li = document.createElement("li");
  li.className = item.canceled
    ? "batch-item batch-item--canceled"
    : `batch-item batch-item--${item.ok ? "success" : "fail"}`;

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
  path.setAttribute(
    "d",
    item.canceled
      ? "M6 12h12" // 取消:横线
      : item.ok
        ? "M20 6L9 17l-5-5"
        : "M18 6L6 18M6 6l12 12",
  );
  icon.appendChild(path);
  head.appendChild(icon);

  const name = document.createElement("span");
  name.className = "batch-item-name";
  name.textContent = baseName(item.file);
  name.title = item.file; // 截断展示,悬停看完整路径
  head.appendChild(name);
  li.appendChild(head);

  // 信息行:警告在前(黄),错误(红)/取消(灰)在后
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
  if (item.canceled) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--canceled";
    p.textContent = "已取消,未转换";
    msgs.appendChild(p);
    hasMsgs = true;
  } else if (item.error) {
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
  void openDialog(false);
});

// 点击拖放区同样打开对话框;键盘可用(Enter / 空格)
dropZone.addEventListener("click", () => void openDialog());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void openDialog();
  }
});

// 批次 7:单文件态「移除」按钮(清空选择,回到初始态)
removeFileBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (converting) return;
  applySelection([]);
});

// 迭代 4:单文件态「预览」按钮(转换前预览排版;stopPropagation 避免触发拖放区打开对话框)
previewBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (converting || selectedFiles.length !== 1) return;
  openPreviewFor(selectedFiles[0]);
});

// 批次 7:多文件态「追加文件」按钮(对话框追加,与现有列表合并去重)
appendBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  void openDialog(true);
});

// 批次 7:多文件态「清空列表」按钮
clearListBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (converting) return;
  applySelection([]);
});

// 多文件列表:点击列表本身不触发换文件(避免误开对话框);
// 上移/下移/预览/移除按钮走事件委托,点击后按行内 data-index 定位文件
multiList.addEventListener("click", (event) => {
  event.stopPropagation();
  if (converting) return;
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
    ".multi-move, .multi-remove, .multi-preview",
  );
  if (!btn) return;
  const li = btn.closest<HTMLLIElement>(".multi-item");
  if (!li) return;
  const index = Number(li.dataset.index);
  if (btn.classList.contains("multi-preview")) {
    // 迭代 4:预览该行文件(转换前,不产生产物)
    openPreviewFor(selectedFiles[index]);
    return;
  }
  if (btn.classList.contains("multi-remove")) {
    // 移除该文件:从数组删除并重建;清空后回到初始态
    selectedFiles.splice(index, 1);
    renderSelection();
    setStatus(
      selectedFiles.length > 0
        ? `已移除,剩余 ${selectedFiles.length} 个文件`
        : "",
    );
    return;
  }
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

tocInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.toc = tocInput.checked;
  persistSettings({ toc: settings.toc });
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

/* ---------- 排版设置面板:任一控件变更即时生效并持久化 ---------- */
fontAsciiInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  const value = fontAsciiInput.value.trim();
  if (!value) {
    fontAsciiInput.value = settings.typography.fontAscii; // 空输入:恢复为当前设置值
    showFieldError(fontAsciiError, "西文字体不能为空,已恢复原值");
    return;
  }
  settings.typography.fontAscii = value;
  hideFieldError(fontAsciiError);
  persistTypography();
});

fontEastAsiaInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  const value = fontEastAsiaInput.value.trim();
  if (!value) {
    fontEastAsiaInput.value = settings.typography.fontEastAsia; // 空输入:恢复为当前设置值
    showFieldError(fontEastAsiaError, "中文字体不能为空,已恢复原值");
    return;
  }
  settings.typography.fontEastAsia = value;
  hideFieldError(fontEastAsiaError);
  persistTypography();
});

bodySizePtInput.addEventListener("change", () =>
  handleTypographyNumberChange("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX),
);

lineSpacingInput.addEventListener("change", () =>
  handleTypographyNumberChange("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX),
);

firstLineIndentInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.typography.firstLineIndent = firstLineIndentInput.checked;
  persistTypography();
});

alignJustifyInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.typography.align = alignJustifyInput.checked ? "justify" : "left";
  persistTypography();
});

headingNumberingInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.typography.headingNumbering = headingNumberingInput.checked;
  persistTypography();
});

captionNumberingInput.addEventListener("change", () => {
  if (hydratingSettings) return;
  settings.typography.captionNumbering = captionNumberingInput.checked;
  persistTypography();
});

// 模板预设:整体套用排版与页面设置,一次性回填所有相关控件并持久化
templatePresetSelect.addEventListener("change", () => {
  if (hydratingSettings) return;
  const preset = TEMPLATE_PRESETS.find(
    (p) => p.id === templatePresetSelect.value,
  );
  if (!preset) return;
  settings.typography = { ...preset.typography };
  settings.pageSetup = { ...preset.pageSetup };
  // hydration 保护下统一回填,避免逐个控件触发 change 写回;
  // 回填同时按匹配结果同步 select 与 hint(当前即所选预设)
  hydratingSettings = true;
  applySettingsToControls();
  hydratingSettings = false;
  persistSettings({
    typography: { ...settings.typography },
    pageSetup: { ...settings.pageSetup },
  });
});

// 完成弹窗:打开所在文件夹 / 打开文件(失败在弹窗内提示,不打断)
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

// 批次 7:取消当前转换(单文件 / 批量 / 合并;主进程在检查点终止并返回 canceled)
cancelBtn.addEventListener("click", () => {
  if (!converting) return;
  cancelBtn.disabled = true; // 防重复点击;转换结束后 hideProgress 隐藏整块
  setStatus("正在取消…");
  window.api.convertCancel().catch(() => {
    cancelBtn.disabled = false;
    setStatus("取消失败,请重试");
  });
});

// 批次 7:汇总条「打开所在文件夹 / 打开文件 / 失败详情」
summaryRevealBtn.addEventListener("click", () => {
  if (!summaryOutputPath) return;
  window.api.revealInFolder(summaryOutputPath).catch((err) => {
    setError(
      `无法打开所在文件夹:${err instanceof Error ? err.message : String(err)}`,
    );
  });
});

summaryOpenBtn.addEventListener("click", () => {
  if (!summaryOutputPath) return;
  window.api
    .openFile(summaryOutputPath)
    .then((result) => {
      if (!result.ok) setError(result.error ?? "无法打开文件");
    })
    .catch((err) =>
      setError(`无法打开文件:${err instanceof Error ? err.message : String(err)}`),
    );
});

summaryDetailsBtn.addEventListener("click", () => {
  if (lastBatchResult) showBatchDialog(lastBatchResult);
});

// 批次 7:输出目录选择 / 恢复默认(空串 = 源文件所在目录)
outputDirPick.addEventListener("click", async () => {
  try {
    const dir = await window.api.selectDir();
    if (!dir) return; // 用户取消
    settings.outputDir = dir;
    outputDirValue.textContent = dir;
    outputDirValue.title = dir;
    persistSettings({ outputDir: dir });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`选择输出目录失败:${message}`);
  }
});

outputDirReset.addEventListener("click", () => {
  settings.outputDir = "";
  outputDirValue.textContent = "源文件所在目录";
  outputDirValue.title = "源文件所在目录";
  persistSettings({ outputDir: "" });
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
unsubscribeProgress = window.api.onConvertProgress((stage) => {
  if (mode !== "single" && mode !== "merge") return;
  const text = STAGE_TEXT[stage];
  if (text) setStatus(text);
  const percent = STAGE_PERCENT[stage];
  if (percent !== undefined) setProgress(percent);
});

unsubscribeBatchProgress = window.api.onBatchProgress((info) => {
  if (mode !== "batch") return;
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
    if (converting) return;
    if (selectedFiles.length === 1) {
      void runConvert(selectedFiles[0], selectedFormat);
    } else if (selectedFiles.length >= 2) {
      void runBatch();
    }
  } else if (key === "o") {
    event.preventDefault();
    void openDialog(true);
  }
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
// 按钮旁说明文案(docx / pdf 均已支持;与 HTML 静态文案保持一致)
if (convertHint) convertHint.textContent = "输出格式:Word / PDF";
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled)
updateActionButtons();
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
