/**
 * renderer 通用工具(R8 自 renderer.ts 抽出,行为等价;B1 纯函数层拆至 pure.ts):
 * 状态区/错误提示/字段内错误、进度条控制、焦点回给主操作按钮。
 * 纯函数(isMarkdown/baseName/truncateMiddle/STAGE_TEXT/stageText/STAGE_PERCENT)
 * 已拆至 state/pure.ts(零 DOM 依赖,可 Node 直测;批③目录重组前为 src/renderer/pure.ts),本文件 re-export
 * 保持导入符号不变(各模块经 ../state/utils.js 导入)。
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
} from "../dom/refs.js";
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

/* ---------- 弹窗焦点陷阱(批次 12:C9) ---------- */
/** 弹窗内可聚焦元素(button/input/select 等;disabled 与隐藏元素排除)。 */
const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 启用弹窗焦点陷阱:Tab/Shift+Tab 在弹窗内循环(首 ⇄ 尾),
 * 焦点逃逸到弹窗外(程序性失焦)时强制拉回第一个可聚焦元素。
 * 返回解除函数(弹窗关闭时调用);弹窗内无可聚焦元素时为空操作。
 */
export function trapFocus(dialog: HTMLElement): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (focusables.length === 0) return;
    // 上方已守卫 length > 0,首末项必存在
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey) {
      // Shift+Tab:焦点在第一个或已逃逸 → 回到最后一个
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      // Tab:焦点在最后一个或已逃逸 → 回到第一个
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", handleKeydown, true); // capture:先于弹窗内/全局监听
  return () => document.removeEventListener("keydown", handleKeydown, true);
}

/* ---------- 焦点管理 ---------- */
/** 焦点还给当前可见的主操作按钮(弹窗关闭后)。 */
export function focusActionButton(): void {
  const visible = [batchBtn, convertBtn, mergeBtn].find(
    (btn) => !btn.classList.contains("hidden") && !btn.disabled,
  );
  visible?.focus();
}
