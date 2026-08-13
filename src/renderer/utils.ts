/**
 * renderer 通用工具(R8 自 renderer.ts 抽出,行为等价;B1 纯函数层拆至 pure.ts):
 * 状态区/错误提示/字段内错误、进度条控制、焦点回给主操作按钮。
 * 纯函数(isMarkdown/baseName/truncateMiddle/STAGE_TEXT/stageText/STAGE_PERCENT)
 * 已拆至 src/renderer/pure.ts(零 DOM 依赖,可 Node 直测),本文件 re-export
 * 保持 renderer 内部 import 路径不变(renderer.ts 等仍从 ./utils.js 导入)。
 * 只依赖 dom.ts 元素映射与 state.ts 的 errorFlashTimer。
 */
import {
  batchBtn,
  cancelBtn,
  convertBtn,
  dropZone,
  mergeBtn,
  progressArea,
  progressFill,
  progressText,
  progressTrack,
  statusEl,
} from "./dom.js";
import { state } from "./state.js";
export {
  isMarkdown,
  baseName,
  truncateMiddle,
  STAGE_TEXT,
  stageText,
  STAGE_PERCENT,
} from "./pure.js";

export function setStatus(text: string, isError = false, isWarning = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.toggle("status--warning", isWarning);
  statusEl.title = text;
}

/** 错误提示:状态区红色文字 + 拖放区短暂红色描边。 */
export function setError(message: string): void {
  setStatus(message, true);
  dropZone.classList.add("drop-zone--error");
  window.clearTimeout(state.errorFlashTimer);
  state.errorFlashTimer = window.setTimeout(
    () => dropZone.classList.remove("drop-zone--error"),
    1400,
  );
}

/* ---------- 转换进度 ---------- */
/** 更新进度条宽度与百分比文本(0–100 钳制)。 */
export function setProgress(percent: number): void {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  progressFill.style.width = `${clamped}%`;
  progressText.textContent = `${clamped}%`;
  progressTrack.setAttribute("aria-valuenow", String(clamped));
}

/** 显示进度区并复位进度(同时使能取消按钮)。 */
export function showProgress(): void {
  progressArea.classList.remove("hidden");
  cancelBtn.disabled = false;
  setProgress(0);
}

/** 隐藏进度区(转换结束;取消按钮状态随之下次 showProgress 复位)。 */
export function hideProgress(): void {
  progressArea.classList.add("hidden");
}

/* ---------- 字段级错误提示(边距 / 字体 / 字号 / 行距) ---------- */
/** 字段内错误提示:显示消息并保持控件值可编辑(仅提示,不阻塞)。 */
export function showFieldError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.classList.remove("hidden");
}

export function hideFieldError(el: HTMLElement): void {
  el.classList.add("hidden");
}

/* ---------- 焦点管理 ---------- */
/** 焦点还给当前可见的主操作按钮(弹窗关闭后)。 */
export function focusActionButton(): void {
  const visible = [batchBtn, convertBtn, mergeBtn].find(
    (btn) => !btn.classList.contains("hidden") && !btn.disabled,
  );
  visible?.focus();
}
