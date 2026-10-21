/**
 * 事件域·拖放与跳过列表:
 * - 拖放区外部文件/文件夹拖入(dragover 高亮 / dragleave 防闪烁 / drop 解析);
 * - File.path 已被 Electron 32+ 移除,经 preload webUtils 解析真实路径后交
 *   主进程 collectMarkdowns 展开过滤;
 * - 拖放反馈:被跳过的非 Markdown 文件名可折叠列表 + 转换中拖入提示 +
 *   重复文件单独文案(appendSelection 内部);
 * - document 级兜底:阻止浏览器默认「打开文件/跳转」。
 * - **docx 回读入口**:拖入的 `.docx`(自家稿)不进「跳过」清单,而是走回读通道 ——
 *   解包还原成 Markdown 并落盘(.md + 图片目录),结果与「会保真/会丢弃」清单进状态区。
 *   为什么落在拖放域:本仓的静态界面在 index.html(按钮等控件的唯一载体),而本泳道
 *   的可写文件不含 index.html —— 新增按钮要改 HTML,拖放是既有的、可复用的入口通道。
 *   IPC 侧同时支持「不传路径 ⇒ 弹文件对话框」,供后续入口(CLI/MCP、将来的按钮)复用。
 * dropZone 的 click/keydown(打开对话框)属 selection 域,与本域监听事件类型不同,
 * 顺序无行为影响。
 */
import { dropSkipped, dropSkippedList, dropSkippedToggle, dropZone } from "../../dom/refs.js";
import { state } from "../../state/state.js";
import { baseName, errorMessage } from "../../state/pure.js";
import { setError, setStatus } from "../../dom/dom-ops.js";
import { showToast } from "../../dom/toast.js";
import { appendSelection, clearDragState, type FileListDeps } from "../file-list.js";
import { t } from "../../../core/i18n/index.js";
import type {
  ReadbackDroppedField,
  ReadbackNotManagedField,
  ReadbackPreservedField,
} from "../../../core/ooxml/readback/readback-fields.js";
import type { ReadbackDocxResult } from "../../../core/ipc-contract.js";

/**
 * 「会保真 / 会丢弃 / 本仓不接管」的本地化标签表:键 = 稳定标识(单源在
 * core/ooxml/readback/readback-fields.ts),值 = i18n 键。
 *
 * 形态约束:值类型写成模板字面量 `readback.preserved.${...}` ⇒
 * ① 标识集新增成员而此处漏登记 ⇒ tsc 判红(Record 的键必须齐全);
 * ② 字典缺某个 `readback.*` 键 ⇒ t() 的入参类型不成立 ⇒ tsc 判红。
 */
const READBACK_PRESERVED_KEYS: Record<
  ReadbackPreservedField,
  `readback.preserved.${ReadbackPreservedField}`
> = {
  headings: "readback.preserved.headings",
  lists: "readback.preserved.lists",
  tables: "readback.preserved.tables",
  images: "readback.preserved.images",
  links: "readback.preserved.links",
  paragraphs: "readback.preserved.paragraphs",
};

const READBACK_DROPPED_KEYS: Record<
  ReadbackDroppedField,
  `readback.dropped.${ReadbackDroppedField}`
> = {
  formula: "readback.dropped.formula",
  comments: "readback.dropped.comments",
  footnotes: "readback.dropped.footnotes",
};

const READBACK_NOT_MANAGED_KEYS: Record<
  ReadbackNotManagedField,
  `readback.notManaged.${ReadbackNotManagedField}`
> = {
  revisions: "readback.notManaged.revisions",
  headingNumber: "readback.notManaged.headingNumber",
  paragraphLayout: "readback.notManaged.paragraphLayout",
  runAppearance: "readback.notManaged.runAppearance",
  pageSetup: "readback.notManaged.pageSetup",
  tableWidth: "readback.notManaged.tableWidth",
  imageSize: "readback.notManaged.imageSize",
  codeHighlight: "readback.notManaged.codeHighlight",
};

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

/** .docx 扩展名判定(回读入口的判据;大小写不敏感) */
function isDocxPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".docx");
}

/**
 * 回读结果 → 状态区 + toast。
 *
 * 状态区走**警告态**(可换行):回读只还原自家稿里的一部分信息(见「本工具不接管」),
 * 逐条列出来才不显得像「完整还原」—— 与模板导入的「已应用但有未映射字段」同一口径。
 * toast 只报一句结论(轻提示不承载清单)。
 */
function showReadbackResult(result: Extract<ReadbackDocxResult, { ok: true; canceled: false }>): void {
  const preserved = result.preserved.map((field) => t(READBACK_PRESERVED_KEYS[field])).join(" · ");
  const dropped = result.dropped.map((field) => t(READBACK_DROPPED_KEYS[field])).join(" · ");
  const notManaged = result.notManaged.map((field) => t(READBACK_NOT_MANAGED_KEYS[field])).join(" · ");
  const parts = [
    t("readback.done", { path: result.markdownPath }),
    t("readback.summary", { ...result.counts }),
    `${t("readback.preservedTitle")}${preserved}`,
  ];
  if (dropped !== "") parts.push(`${t("readback.droppedTitle")}${dropped}`);
  parts.push(`${t("readback.notManagedTitle")}${notManaged}`);
  setStatus(parts.join(" "), false, true);
  showToast(t("readback.toast"));
}

/** 拖入的 .docx → 回读为 Markdown(逐个;每个文件各自报结果) */
async function readbackDroppedDocx(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      const result = await window.api.readbackDocx(filePath);
      if (!result.ok) {
        setError(t("readback.failed", { error: result.error }));
        continue;
      }
      if (result.canceled) continue; // 用户取消:无动作
      showReadbackResult(result);
    } catch (err) {
      setError(t("readback.failed", { error: errorMessage(err) }));
    }
  }
}

async function resolveDropped(deps: FileListDeps, paths: string[]): Promise<void> {
  try {
    const { files, skipped } = await window.api.collectMarkdowns(paths);
    // 拖入的 .docx 不进「跳过」清单:走回读通道(自家稿 → Markdown)
    const docxFiles = skipped.filter(isDocxPath);
    const otherSkipped = skipped.filter((filePath) => !isDocxPath(filePath));
    showSkippedList(otherSkipped); // 跳过项列具体文件名(可折叠);无跳过时隐藏
    if (docxFiles.length > 0) await readbackDroppedDocx(docxFiles);
    if (files.length === 0) {
      if (docxFiles.length > 0) return; // 已走回读通道,各自报过结果,不叠加「没有 Markdown」的报错
      setError(
        otherSkipped.length > 0
          ? t("file.noMarkdownSkipped", { count: otherSkipped.length })
          : t("file.noMarkdown"),
      );
      return;
    }
    appendSelection(deps, files, otherSkipped.length); // 拖入始终追加到现有列表(重复文件单独提示)
  } catch (err) {
    const message = errorMessage(err);
    setError(t("file.readFailed", { error: message }));
  }
}

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
/** 本域只经 file-list 的 `FileListDeps` 端口走选择管线,故接同一份 deps(不另造局部闭包)。 */
export function bindDropEvents(deps: FileListDeps): void {
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
      // 转换中拖入不再静默忽略,状态区给出提示
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
    void resolveDropped(deps, paths);
  });

  // 未落入拖放区时,阻止浏览器默认「打开文件/跳转」行为
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
}
