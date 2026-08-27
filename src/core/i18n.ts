/**
 * 界面多语言(i18n)逻辑层:main + renderer 共享的纯模块。
 * 字典与语言注册表在 ./i18n/(zh.ts 键集唯一事实源,en.ts satisfies 全量,
 * ja Partial;index.ts 为 LANGUAGES/DICT 注册表单一事实源),
 * 本模块 re-export DICT/I18nKey/Language 保持既有 import 面不变。
 * - 参数插值:t("key", { error }) 模板用 ${error} 占位(与既有模板字符串一致)
 * - 回退链:当前语言 → en → key(zh 为源语言永不全缺;en 全量约束由编译期锁定;
 *   Partial 语言缺失键回退 en 文案而非裸 key)
 * - 缺失 key(两级均无):回退返回 key 本身(不抛错)
 * - applyStaticTexts:遍历 [data-i18n] / [data-i18n-placeholder] / [data-i18n-title] /
 *   [data-i18n-aria-label] 替换静态文案(仅 renderer 调用;main 进程 import 本模块
 *   不触碰 DOM——document 只在函数体内引用,模块加载期零副作用);
 *   <html lang> 经 LANGUAGES.htmlLang 映射,勿硬编码
 * - 语言来源:renderer 经 settings.language(loadSettings 后 setLanguage + applyStaticTexts);
 *   main 进程启动时 setLanguage(loadSettings().language)
 */
import {
  DICT,
  LANGUAGES,
  htmlLangOf,
  isLanguage,
  type Dict,
  type Language,
} from "./i18n/index.js";

export { DICT, LANGUAGES, htmlLangOf, isLanguage };
export type { Dict as I18nKey, Language };

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

/** 显示层格式化:string 原样返回;KeyedWarning 走 tByKey(key, params)(含回退链),
 *  返回值 === key(两级字典均缺失)时回退 fallback */
export function formatWarning(w: ConvertWarning): string {
  if (typeof w === "string") return w;
  const text = tByKey(w.key, w.params);
  return text === w.key ? w.fallback : text;
}

/**
 * 交叉引用未找到警告构造(docx/pdf 渲染共用单一来源):
 * kind 为中文类别词(图/表/章节,来自两侧 CROSS_REF_KINDS.kindName),
 * ref 为「前缀:label」串;en 及其余语言文案省略 kind 参数避免中英混排(见各字典注释)。
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

/**
 * Mermaid 渲染失败警告族(CORE-4 工厂化,docx/pdf 共用单一来源):
 * resolver 返回空结果 → mermaidEmpty;抛错 → mermaidFailed(params.reason)。
 * 两侧降级语义一致(内容不丢失、不中断转换),文案改动单点生效。
 */
export function mermaidEmptyWarning(): KeyedWarning {
  return {
    key: "warn.mermaidEmpty",
    fallback: "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块",
  };
}

export function mermaidFailedWarning(reason: string): KeyedWarning {
  return {
    key: "warn.mermaidFailed",
    params: { reason },
    fallback: `Mermaid 渲染失败: ${reason},已降级为代码块`,
  };
}

/**
 * 代码块未标注语言警告(F6 转换预检):``` 后缺语言标识,高亮/排版可能降级。
 */
export function unlabeledCodeBlockWarning(): KeyedWarning {
  return {
    key: "warn.unlabeledCodeBlock",
    fallback: "代码块未标注语言,可能无法正确高亮排版",
  };
}

/** 当前语言(模块级状态;默认 zh,setLanguage 更新)。 */
let current: Language = "zh";

export function setLanguage(lang: Language): void {
  current = lang;
}

/**
 * 字典查找原始实现(运行期 string key):供 t 的类型化门面与动态 key 场景
 * (formatWarning 的 KeyedWarning.key 经 IPC 传输、applyStaticTexts 的
 * data-i18n 属性)共用。回退链:当前语言 → en → key;
 * 缺失 key 回退返回 key 本身(不抛错)。
 */
function tByKey(key: string, params?: Record<string, string | number>): string {
  const table = DICT[current] as Partial<Record<string, string>>;
  const enTable = DICT.en as Partial<Record<string, string>>;
  const template = table[key] ?? enTable[key] ?? key;
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * 取当前语言文案(CORE-10:key 参数受 I18nKey 编译期约束,拼错即编译报错;
 * 缺失 key 运行期经回退链兜底,最终返回 key 本身,不抛错——动态 key 场景走 tByKey)。
 * 参数插值:模板 ${name} 占位,params 提供同名值;缺失参数保留占位符原样。
 */
export function t(key: Dict, params?: Record<string, string | number>): string {
  return tByKey(key, params);
}

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
  document.documentElement.lang = htmlLangOf(current);
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
