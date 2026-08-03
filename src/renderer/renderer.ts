/**
 * G3 阶段:renderer 接入转换逻辑(含转换完成弹窗)。
 * 二期批次 1:页面设置面板(纸张/方向/边距/H1 分页/导出后行为)与持久化,
 * 完成弹窗新增「打开所在文件夹 / 打开文件」按钮。
 * 二期批次 2:完成弹窗新增「预览」按钮,经主进程打开独立预览窗口
 * (与 PDF 同排版),预览使用源 md 路径(selectedFile)。
 * 导出后行为的自动执行由主进程在转换完成后按设置触发(runAfterConvert),
 * renderer 只负责持久化与弹窗内手动操作,避免重复执行。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 */

declare global {
  interface Window {
    api: {
      openMarkdownDialog: () => Promise<string | null>;
      convert: (
        filePath: string,
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: string[] }>;
      /** 订阅转换进度(read / render / done),返回取消订阅函数。 */
      onConvertProgress: (
        cb: (stage: "read" | "render" | "done") => void,
      ) => () => void;
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
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const convertBtn = document.getElementById("convertBtn") as HTMLButtonElement;
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

/* ---------- 状态 ---------- */
let selectedFile: string | null = null;
let selectedFormat: "docx" | "pdf" = "docx";
let converting = false;
let errorFlashTimer: number | undefined;
let unsubscribeProgress: (() => void) | undefined;
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

/** 记录已选文件并更新界面。 */
function showFile(filePath: string): void {
  selectedFile = filePath;
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  fileNameEl.textContent = fileName;
  filePathEl.textContent = filePath;
  filePathEl.title = filePath;
  dropDefault.classList.add("hidden");
  dropFile.classList.remove("hidden");
  dropZone.classList.add("has-file");
  setStatus(truncateMiddle(filePath));
  statusEl.title = filePath; // 截断展示,悬停可看完整路径
}

/* ---------- 选择文件(系统对话框) ---------- */
async function openDialog(): Promise<void> {
  try {
    const filePath = await window.api.openMarkdownDialog();
    if (filePath === null) return; // 用户取消,保持现状
    if (!isMarkdown(filePath)) {
      setError(ERROR_MESSAGE);
      return;
    }
    showFile(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`打开文件对话框失败:${message}`);
  }
}

/* ---------- 转换 ---------- */
const STAGE_TEXT: Record<"read" | "render" | "done", string> = {
  read: "正在读取文件…",
  render: "正在渲染文档…",
  done: "正在完成…",
};

async function runConvert(
  filePath: string,
  format: "docx" | "pdf",
): Promise<void> {
  converting = true;
  convertBtn.disabled = true; // 防止重复点击
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
    converting = false;
    convertBtn.disabled = false;
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

/* ---------- 转换完成弹窗 ---------- */
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
  convertBtn.focus(); // 焦点还给触发按钮,便于键盘继续操作
}

/** 弹窗内错误提示(打开文件失败等非致命错误,不打断弹窗)。 */
function showDialogError(message: string): void {
  completeDialogError.textContent = message;
  completeDialogError.classList.remove("hidden");
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

// 拖放:dragover 必须 preventDefault,否则 drop 不会触发
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
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

  const file = event.dataTransfer?.files[0];
  if (!file) return;

  // Chromium 桌面端 File 对象带 path 属性(非 Web 标准,仅 Electron 可用):
  // const filePath = (file as File & { path?: string }).path;
  const filePath = (file as File & { path?: string }).path;
  if (!filePath) {
    setError("无法获取文件路径,请改用「选择文件」按钮");
    return;
  }
  if (!isMarkdown(filePath)) {
    setError(ERROR_MESSAGE);
    return;
  }
  showFile(filePath);
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
  // 预览使用源 md 路径(selectedFile);转换成功必然先选了文件,此处仅做兜底
  if (!selectedFile) {
    showDialogError("无法预览:源文件路径缺失");
    return;
  }
  window.api
    .openPreview(selectedFile)
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

// 转换按钮:docx / pdf 均已支持
convertBtn.addEventListener("click", () => {
  if (!selectedFile) {
    setError("请先选择 Markdown 文件");
    return;
  }
  void runConvert(selectedFile, selectedFormat);
});

// 进度订阅:主进程推送 read / render / done 阶段,实时更新状态文案
unsubscribeProgress = window.api.onConvertProgress((stage) => {
  if (!converting) return; // 转换结束后的迟到事件直接忽略
  const text = STAGE_TEXT[stage];
  if (text) setStatus(text);
});

// 窗口关闭时取消进度订阅
window.addEventListener("unload", () => unsubscribeProgress?.());

// 完成弹窗关闭:确定按钮 / 点击遮罩 / Esc 三种方式
completeDialogOk.addEventListener("click", hideCompleteDialog);
completeDialog.addEventListener("click", (event) => {
  // 只响应遮罩本身,点卡片内部不关闭
  if (event.target === completeDialog) hideCompleteDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !completeDialog.classList.contains("hidden")) {
    hideCompleteDialog();
  }
});

/* ---------- 初始化 ---------- */
// HTML 中按钮为 G2 阶段禁用态(disabled 属性写死),docx 已可用,解除禁用
convertBtn.disabled = false;
// 按钮旁说明文案(docx / pdf 均已支持)
if (convertHint) convertHint.textContent = "输出格式:docx / PDF";
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
