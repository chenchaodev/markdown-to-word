/**
 * i18n 语言注册表(单一事实源):
 * - LANGUAGES:有序注册表(zh/en 在前),语言选项/校验/htmlLang 映射全部由此派生,
 *   新增语言 = 新建字典文件 + 在此登记一项,不再散落硬编码
 *   (历史注:ko/fr/ru 曾随 1.3.0 注册表化加入,后按需求裁撤;已存用户的该偏好
 *   经 settings 校验字段级兜底回退 zh,见 main/persist/settings.ts)
 * - Language:由注册表派生的联合类型(消灭 "zh" | "en" 硬编码)
 * - DICT:聚合字典对象,供逻辑层(i18n.ts)查表;zh 全量(键集唯一事实源)、
 *   en 全量(satisfies 锁定)、ja Partial(缺失键走回退链)
 */
import { dict as zh, type Dict } from "./zh.js";
import { dict as en } from "./en.js";
import { dict as ja } from "./ja.js";

export type { Dict };

/** 有序语言注册表:code = settings.json 持久化值;label = 本地化自称(设置面板直接显示);
 *  htmlLang = BCP 47(<html lang> 值)。zh/en 保持在前(历史默认序)。 */
export const LANGUAGES = [
  { code: "zh", label: "中文", htmlLang: "zh-CN" },
  { code: "en", label: "English", htmlLang: "en" },
  { code: "ja", label: "日本語", htmlLang: "ja" },
] as const;

/** 语言代码联合类型(由注册表派生,勿手写) */
export type Language = (typeof LANGUAGES)[number]["code"];

/** 聚合字典:zh/en 全量,其余 Partial(缺失键由回退链兜底,见 i18n.ts tByKey) */
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
