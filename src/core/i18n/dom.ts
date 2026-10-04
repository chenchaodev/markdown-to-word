/**
 * 静态文案落到宿主树的**唯一一份职责**(ADR-064 把 i18n.ts 溶进 i18n/ 时拆出):
 * 全 core 内**只有本文件**出现 `document` / `window`(判据 core-i18n-dom-only 的
 * exceptFiles 只豁免它一个)。翻译表、语言状态、警告构造器三项都与 DOM 无关 ——
 * 它们一旦碰 DOM,这一层就被绑死在「只能在 renderer 里跑」上,而消费方里有一批是
 * main 进程那些(main import 本模块不触碰 DOM)。
 *
 * main 进程安全性的两个前提(勿在改动时丢掉任何一个):
 * - 模块加载期零副作用:`document` 只在 applyStaticTexts 的函数体内被读,模块顶层
 *   零引用 ⇒ main 进程 import 本文件不炸;
 * - 入口守卫:`typeof document === "undefined"` 直接返回,这行**不是**冗余 ——
 *   判据刻意不判它(只认「取到 DOM 对象」与「在宿主树上查元素」两种形态),
 *   删掉它就等于把 main 侧的那次求值变成硬崩。
 *
 * 语言切换后须再次调用本函数。
 */
import { htmlLangOf } from "./index.js";
import { currentLanguage, tByKey } from "./t.js";

/**
 * 应用静态文案(仅 renderer 调用;main 进程 import 本模块不触碰 DOM):
 * - [data-i18n] → textContent(含 <title>/<option> 等)
 * - [data-i18n-placeholder] → placeholder 属性
 * - [data-i18n-title] → title 属性
 * - [data-i18n-aria-label] → aria-label 属性
 * 同时同步 <html lang>(查 LANGUAGES.htmlLang)。语言切换后须再次调用。
 */
export function applyStaticTexts(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = htmlLangOf(currentLanguage());
  // data-i18n* 属性值为运行期字符串(HTML 静态标注),走 tByKey 动态通道
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = tByKey(el.dataset.i18n ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", tByKey(el.dataset.i18nPlaceholder ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", tByKey(el.dataset.i18nTitle ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", tByKey(el.dataset.i18nAriaLabel ?? ""));
  });
}
