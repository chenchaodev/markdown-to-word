/**
 * core/i18n 的**唯一公开桶**(ADR-064 把原 201 行的 `core/i18n.ts` 溶进本目录):
 * 消费方一律经 `core/i18n/index.js` 取符号,符号归属的路由全在本文件内完成 ——
 * 桶的意义就是让「谁住哪」这件事只在一个文件里可见。
 *
 * 本文件同时是**语言注册表单一事实源**:
 * - LANGUAGES:有序注册表(zh/en 在前),语言选项/校验/htmlLang 映射全部由此派生,
 *   新增语言 = 新建字典文件 + 在此登记一项,不再散落硬编码
 * - Language:由注册表派生的联合类型(消灭 "zh" | "en" 硬编码)
 * - DICT:聚合字典对象,供逻辑层(t.ts)查表;zh/en/ja 三语全量
 *   (en/ja 由各自 satisfies 键集锁定,缺失键编译报错)
 * 未知语言码经 settings 校验兜底回退 zh(兼容已移除语言的存量用户配置)。
 *
 * 四份文件的分工(拆开是为了让「谁碰 DOM」「谁持有可变状态」各自唯一):
 * - 本文件:注册表 + 唯一公开桶(无副作用、不 import t/warning/dom 的内部件)
 * - `t.ts`:语言状态(setLanguage)与查表(t / tByKey)
 * - `warning.ts`:KeyedWarning / ConvertWarning 类型 + 警告构造器
 * - `dom.ts`:applyStaticTexts —— core 内**唯一**碰 `document` 的文件
 *   (判据 core-i18n-dom-only)
 *
 * ⚠ `t.ts` 反过来 import 本文件的 DICT,与本文件对它的再导出构成一个**模块环**。
 *   它是安全的:t.ts 的模块体不在求值期读 DICT(只有 tByKey 的函数体读),活绑定在
 *   调用时已就绪。要拆掉这个环就得把注册表挪进第四个文件,那是本步裁决表之外的改动。
 */
import { dict as zh, type Dict } from "./zh.js";
import { dict as en } from "./en.js";
import { dict as ja } from "./ja.js";

export type { Dict };

/** 有序语言注册表:code = settings.json 持久化值;label = 本地化自称(设置面板直接显示);
 *  htmlLang = BCP 47(<html lang> 值)。zh/en 保持在前(默认序)。 */
export const LANGUAGES = [
  { code: "zh", label: "中文", htmlLang: "zh-CN" },
  { code: "en", label: "English", htmlLang: "en" },
  { code: "ja", label: "日本語", htmlLang: "ja" },
] as const;

/** 语言代码联合类型(由注册表派生,勿手写) */
export type Language = (typeof LANGUAGES)[number]["code"];

/** 聚合字典:三语全量(编译期 satisfies 键集锁定);运行期查表未知 key 的
 *  回退语义(当前语言 → en → key)由 ./t.ts 的 tByKey 兜底 */
export const DICT: Record<Language, Partial<Record<Dict, string>>> = {
  zh,
  en,
  ja,
};

const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

/** 运行期语言校验(settings 持久化/sanitize 共用;未知值一律拒绝) */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGE_CODES.includes(value);
}

/** <html lang> 映射(BCP 47;applyStaticTexts 与测试共用,勿在别处硬编码) */
export function htmlLangOf(lang: Language): string {
  return LANGUAGES.find((l) => l.code === lang)?.htmlLang ?? "en";
}

// ---- 唯一公开面对外再导出面(消费方只经本文件取符号) ----
// 语言状态与查表。刻意**不**再导出 t.ts 的 `currentLanguage()` 与 `tByKey`:
// 它们是同目录兄弟文件(dom.ts / warning.ts)的内部件,不是 core/i18n 的对外语义。
export { setLanguage, t } from "./t.js";
// Dict 以 I18nKey 之名对外(沿用原桶的别名:它是「t() 的 key 参数类型」,叫 Dict
// 会与字典聚合对象 DICT 混淆)。Dict 本名一并再导出,供需要原名的类型引用。
export type { Dict as I18nKey };
// 警告类型与构造器。
export {
  formatWarning,
  crossRefNotFoundWarning,
  highlightFallbackWarning,
  mermaidEmptyWarning,
  mermaidFailedWarning,
  unlabeledCodeBlockWarning,
  warnDedupKey,
  pushWarningOnce,
} from "./warning.js";
export type { KeyedWarning, ConvertWarning, WarningKey } from "./warning.js";
// DOM 面(core 内唯一碰 document 的那份职责,由本桶再导出以维持既有导入面)。
export { applyStaticTexts } from "./dom.js";
