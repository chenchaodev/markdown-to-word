/**
 * 界面多语言(i18n)逻辑层:main + renderer 共享的纯模块。
 * 字典(ZH/EN/DICT)在 ./i18n-dict.ts(两字典必须同文件维持键集编译期相等约束),
 * 本模块 re-export DICT 保持既有 import 面不变。
 * - 参数插值:t("key", { error }) 模板用 ${error} 占位(与既有模板字符串一致)
 * - 缺失 key:回退返回 key 本身(不抛错)
 * - applyStaticTexts:遍历 [data-i18n] / [data-i18n-placeholder] / [data-i18n-title] /
 *   [data-i18n-aria-label] 替换静态文案(仅 renderer 调用;main 进程 import 本模块
 *   不触碰 DOM——document 只在函数体内引用,模块加载期零副作用)
 * - 语言来源:renderer 经 settings.language(loadSettings 后 setLanguage + applyStaticTexts);
 *   main 进程启动时 setLanguage(loadSettings().language)
 */
import { DICT } from "./i18n-dict.js";

export { DICT };

export type Language = "zh" | "en";

/**
 * keyed 警告(B6 i18n 收口):core 生成的警告不再硬编码中文文案,
 * 携带字典 key + 插值参数 + 缺失 key 时的兜底文案(fallback = 改造前中文原文逐字保留,
 * 保证 zh 界面行为等价)。经 IPC 原样传到 renderer,显示层 formatWarning 按当前语言格式化。
 */
export interface KeyedWarning {
  key: string;
  params?: Record<string, string | number>;
  /** 缺失 key 时的兜底文案(= 现有中文原文逐字保留) */
  fallback: string;
}

/** warnings 通道元素:历史纯字符串(直通)或 keyed 警告(走字典) */
export type ConvertWarning = string | KeyedWarning;

/** 显示层格式化:string 原样返回;KeyedWarning 走 t(key, params),t 返回值 === key(缺失)时回退 fallback */
export function formatWarning(w: ConvertWarning): string {
  if (typeof w === "string") return w;
  const text = t(w.key, w.params);
  return text === w.key ? w.fallback : text;
}

/**
 * 交叉引用未找到警告构造(docx/pdf 渲染共用单一来源):
 * kind 为中文类别词(图/表/章节,来自两侧 CROSS_REF_KINDS.kindName),
 * ref 为「前缀:label」串;en 文案省略 kind 参数避免中英混排(见 EN 字典注释)。
 */
export function crossRefNotFoundWarning(kind: string, ref: string): KeyedWarning {
  return {
    key: "warn.crossRefNotFound",
    params: { kind, ref },
    fallback: `交叉引用未找到${kind} label: ${ref}`,
  };
}

/**
 * 代码高亮降级警告(B4,docx/pdf 共用单一来源):
 * hljs 语言包命中但 highlight 抛错 / 解析校验失败时,两侧均降级为纯文本并上报本警告。
 */
export function highlightFallbackWarning(lang: string): KeyedWarning {
  return {
    key: "warn.highlightFallback",
    params: { lang },
    fallback: `代码高亮失败,已降级为纯文本: ${lang}`,
  };
}

/** 当前语言(模块级状态;默认 zh,setLanguage 更新)。 */
let current: Language = "zh";

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
}

/**
 * 取当前语言文案;缺失 key 回退返回 key 本身(不抛错)。
 * 参数插值:模板 ${name} 占位,params 提供同名值;缺失参数保留占位符原样。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = DICT[current][key] ?? key;
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * 应用静态文案(仅 renderer 调用;main 进程 import 本模块不触碰 DOM):
 * - [data-i18n] → textContent(含 <title>/<option> 等)
 * - [data-i18n-placeholder] → placeholder 属性
 * - [data-i18n-title] → title 属性
 * - [data-i18n-aria-label] → aria-label 属性
 * 同时同步 <html lang>。语言切换后须再次调用。
 */
export function applyStaticTexts(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel ?? ""));
  });
}