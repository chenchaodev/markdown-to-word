/**
 * 事件域·拖放与跳过列表:
 * - 拖放区外部文件/文件夹拖入(dragover 高亮 / dragleave 防闪烁 / drop 解析);
 * - File.path 已被 Electron 32+ 移除,经 preload webUtils 解析真实路径后交
 *   主进程 collectMarkdowns 展开过滤;
 * - 拖放反馈:被跳过的非 Markdown 文件名可折叠列表 + 转换中拖入提示 +
 *   重复文件单独文案(appendSelection 内部);
 * - document 级兜底:阻止浏览器默认「打开文件/跳转」。
 * dropZone 的 click/keydown(打开对话框)属 selection 域,与本域监听事件类型不同,
 * 顺序无行为影响。
 */
import { dropSkipped, dropSkippedList, dropSkippedToggle, dropZone } from "../../dom/refs.js";
import { state } from "../../state/state.js";
import { baseName, errorMessage } from "../../state/pure.js";
import { setError, setStatus } from "../../state/utils.js";
import { appendSelection, clearDragState } from "../file-list.js";
import { t } from "../../../core/i18n.js";

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
    showSkippedList(skipped); // 跳过项列具体文件名(可折叠);无跳过时隐藏
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
    const message = errorMessage(err);
    setError(t("file.readFailed", { error: message }));
  }
}

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindDropEvents(): void {
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
    void resolveDropped(paths);
  });

  // 未落入拖放区时,阻止浏览器默认「打开文件/跳转」行为
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
}
