/**
 * toast 轻提示(ui-guidelines §2 控件模式:即时操作反馈,动作栏上方居中浮入):
 * - 单实例:写入 refs 的 #toast(role="status"),新调用顶替前一条(清旧 timer);
 * - 2.4s 自动消失;显隐走 .show 类(CSS 过渡已就绪),只陈述事实不阻塞操作。
 * 依赖方向:本模块 → dom/refs,无反向引用。
 */
import { toastEl } from "../dom/refs.js";

/** 自动消失时长(ms;与 ui-guidelines「2.4s 自动消失」一致)。 */
const TOAST_DURATION_MS = 2400;

/** 当前 toast 的消失定时器(单实例顶替时先清除)。 */
let toastTimer: number | undefined;

/** 显示一条轻提示;重复调用顶替前一条并重置计时。 */
export function showToast(message: string): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("show");
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
    toastTimer = undefined;
  }, TOAST_DURATION_MS);
}
