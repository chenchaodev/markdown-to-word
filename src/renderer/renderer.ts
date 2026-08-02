/**
 * G3 阶段:renderer 接入转换逻辑(含转换完成弹窗)。
 * 文件选择(系统对话框 + 拖放)与格式选择;docx 转换已接通(主进程执行),
 * PDF 待 G4;转换按钮点击后走 window.api.convert,进度经 onConvertProgress 订阅。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 */

declare global {
  interface Window {
    api: {
      openMarkdownDialog: () => Promise<string | null>;
      convert: (
        filePath: string,
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
      /** 订阅转换进度(read / render / done),返回取消订阅函数。 */
      onConvertProgress: (
        cb: (stage: "read" | "render" | "done") => void,
      ) => () => void;
    };
  }
}

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

/* ---------- 状态 ---------- */
let selectedFile: string | null = null;
let selectedFormat: "docx" | "pdf" = "docx";
let converting = false;
let errorFlashTimer: number | undefined;
let unsubscribeProgress: (() => void) | undefined;

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

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("status--error", isError);
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

/* ---------- 转换完成弹窗 ---------- */
function showCompleteDialog(outputPath: string): void {
  completeOutputPath.textContent = outputPath;
  completeOutputPath.title = outputPath; // 路径超长滚动时悬停可看全文
  completeDialog.classList.remove("hidden");
  completeDialogOk.focus(); // 焦点落在默认操作(确定)上
}

function hideCompleteDialog(): void {
  completeDialog.classList.add("hidden");
  convertBtn.focus(); // 焦点还给触发按钮,便于键盘继续操作
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

// 格式选择:记录当前选中格式(转换时使用)
formatInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      selectedFormat = input.value as "docx" | "pdf";
    }
  });
});

// 转换按钮:docx 直接转换,pdf 待 G4
convertBtn.addEventListener("click", () => {
  if (!selectedFile) {
    setError("请先选择 Markdown 文件");
    return;
  }
  if (selectedFormat === "pdf") {
    setError("PDF 功能暂未支持(开发中)");
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
// 按钮旁说明文案同步更新(原为「转换功能开发中」)
if (convertHint) convertHint.textContent = "PDF 功能开发中";
