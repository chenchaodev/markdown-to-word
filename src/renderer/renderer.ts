/**
 * G2 阶段:renderer 骨架。
 * 仅实现文件选择(系统对话框 + 拖放)与格式选择;转换逻辑未接入,转换按钮禁用。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 */

declare global {
  interface Window {
    api: { openMarkdownDialog: () => Promise<string | null> };
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
const formatInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="format"]',
);

/* ---------- 状态 ---------- */
let selectedFormat: "docx" | "pdf" = "docx";
let errorFlashTimer: number | undefined;

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

// 格式选择:记录当前选中格式(G3 转换时使用)
formatInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      selectedFormat = input.value as "docx" | "pdf";
    }
  });
});

// 转换按钮 G2 阶段禁用;G3 接入转换逻辑后移除 disabled 并绑定点击事件
