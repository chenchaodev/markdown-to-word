/**
 * renderer 通用工具(R8 自 renderer.ts 抽出,行为等价;B1 纯函数层拆至 pure.ts):
 * 状态区/错误提示/字段内错误、进度条控制、焦点回给主操作按钮。
 * 纯函数(isMarkdown/errorMessage/baseName/truncateMiddle/STAGE_TEXT/stageText/
 * STAGE_PERCENT 等)单源 state/pure.ts(零 DOM 依赖,可 Node 直测)。
 * MR-10:原「保持旧导入路径」的 re-export 过渡层已退役——消费方直接从
 * ./pure.js 导入纯函数,同一符号不再有两条活跃导入路径。
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
import { t, type I18nKey } from "../../core/i18n.js";

/** 错误提示红色描边自动消退时长(MR-15 具名)。 */
const ERROR_FLASH_MS = 1400;

/**
 * translate 注入适配(CORE-10 衔接):t 的 key 参数已收紧为 I18nKey(编译期防拼错),
 * 而 pure 层零 import 约束只能声明 string 键的 translate 契约;经此包装放宽注入
 * (运行时同一 t;键均来自 pure 层内部契约,不存在拼错面)。
 */
export function translate(key: string, params?: Record<string, string | number>): string {
  return t(key as I18nKey, params);
}

export function setStatus(text: string, isError = false, isWarning = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.toggle("status--warning", isWarning);
  statusEl.title = text;
  // 错误/警告为确定性终态:清除 busy/ok 呼吸色,避免与语义色叠加
  if (isError || isWarning) setStatusTone("");
}

/** 状态行圆点 tone(busy/ok 呼吸色;见 base.css)。空串复位为中性灰。 */
let statusTone = "";
export function setStatusTone(tone: "" | "busy" | "ok"): void {
  if (statusTone) statusEl.classList.remove(`status--${statusTone}`);
  statusTone = tone;
  if (tone) statusEl.classList.add(`status--${tone}`);
}

/** 错误提示:状态区红色文字 + 拖放区短暂红色描边。 */
export function setError(message: string): void {
  setStatus(message, true);
  setStatusTone("");
  dropZone.classList.add("drop-zone--error");
  window.clearTimeout(state.errorFlashTimer);
  state.errorFlashTimer = window.setTimeout(
    () => dropZone.classList.remove("drop-zone--error"),
    ERROR_FLASH_MS,
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

/* ---------- 弹窗焦点陷阱(批次 12:C9;P0-3 扩展为栈式多弹窗协调) ---------- */
/** 弹窗内可聚焦元素(button/input/select 等;disabled 与隐藏元素排除)。 */
const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 当前活跃陷阱栈(注册序 = 打开序;释放即出栈)。
 * P0-3 起设置抽屉常驻陷阱,其上可能再叠完成弹窗/另存预设弹窗——多个陷阱并存时,
 * 仅栈顶(最后打开且未关闭者)处理 Tab,避免双重焦点劫持(Tab 永远跳首项)。
 */
const trapStack: HTMLElement[] = [];

/**
 * 启用弹窗焦点陷阱:Tab/Shift+Tab 在弹窗内循环(首 ⇄ 尾),
 * 焦点逃逸到弹窗外(程序性失焦)时强制拉回第一个可聚焦元素。
 * 返回解除函数(弹窗关闭时调用);弹窗内无可聚焦元素时为空操作。
 */
export function trapFocus(dialog: HTMLElement): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    // 非栈顶陷阱不处理(更上层的弹窗正在持有键盘流)
    if (trapStack[trapStack.length - 1] !== dialog) return;
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
  const release = (): void => {
    const index = trapStack.indexOf(dialog);
    if (index >= 0) trapStack.splice(index, 1);
    document.removeEventListener("keydown", handleKeydown, true);
  };
  trapStack.push(dialog);
  return release;
}

/* ---------- 焦点管理 ---------- */
/** 焦点还给当前可见的主操作按钮(弹窗关闭后)。 */
export function focusActionButton(): void {
  const visible = [batchBtn, convertBtn, mergeBtn].find(
    (btn) => !btn.classList.contains("hidden") && !btn.disabled,
  );
  visible?.focus();
}
