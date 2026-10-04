/**
 * 语言状态与文案查表(逻辑层的「状态 + 取文」那一半):
 * - current:模块级当前语言(默认 zh,setLanguage 更新)
 * - setLanguage / t:对外门面;t 的 key 参数受 I18nKey 编译期约束,拼错即编译报错
 * - tByKey:字典查找原始实现(运行期 string key),供 t 的类型化门面与**动态 key 场景**
 *   共用 —— formatWarning 的 KeyedWarning.key 经 IPC 传输、applyStaticTexts 的
 *   data-i18n 属性都是运行期才知道的 key。
 *
 * 回退链:当前语言 → en → key(zh 为源语言永不全缺;en/ja 全量由编译期 satisfies
 * 键集锁定,回退仅对运行期查表遇到的未知 key 生效,字典层无缺口);两级均缺时返回
 * key 本身,不抛错。参数插值:模板用 ${name} 占位,缺失参数保留占位符原样。
 *
 * 为什么单独成文件(ADR-064 把 i18n.ts 这个桶溶进 i18n/ 目录):
 * 「语言状态」与「翻译表」是两件事,后者已是三个数据文件,前者此前与警告构造器、
 * DOM 面挤在一个 201 行的桶里。tByKey 刻意**导出**给同目录的 warning.ts / dom.ts
 * 用(它们各自需要动态 key 通道),但对外只由 index.ts 暴露 setLanguage / t。
 *
 * ⚠ 与 index.ts 之间是**模块环**(index 再导出本模块的 setLanguage/t,本模块取
 * index 的 DICT):这是「index 既是注册表又是唯一公开桶」这个已裁决结构下的必然结果,
 * 换不掉(注册表归 index.ts 是本阶段的既定目标)。环是安全的 —— 本模块的模块体
 * **不在求值期读 DICT**(只有 tByKey 的函数体读),而函数声明与 `let current` 均在
 * 模块体完成初始化;ESM 的活绑定在调用时已就绪,产物侧 CJS 的 `exports.DICT` 属性
 * 访问同样是晚绑定。改这个结构需要把注册表拆成第四个文件,那是本步裁决表之外的改动。
 */
import { DICT, type Dict, type Language } from "./index.js";

/** 当前语言(模块级状态;默认 zh,setLanguage 更新)。
 *  **刻意不导出这个绑定**,而是导出读它的函数:同目录的 dom.ts 需要它来同步
 *  <html lang>,而一个 `export let` 就是给可变绑定开的后门 —— 与 ADR-064 为
 *  core/i18n/dom.ts 立的那条判据(i18n-dom-no-export-let)同一个道理,自己先不犯。 */
let current: Language = "zh";

/** 读当前语言(供同目录 dom.ts 同步 <html lang> 用;只读出口) */
export function currentLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
}

/**
 * 字典查找原始实现(运行期 string key):供 t 的类型化门面与动态 key 场景
 * (formatWarning 的 KeyedWarning.key 经 IPC 传输、applyStaticTexts 的
 * data-i18n 属性)共用。回退链:当前语言 → en → key;
 * 缺失 key 回退返回 key 本身(不抛错)。
 */
export function tByKey(key: string, params?: Record<string, string | number>): string {
  const table = DICT[current] as Partial<Record<string, string>>;
  const enTable = DICT.en as Partial<Record<string, string>>;
  const template = table[key] ?? enTable[key] ?? key;
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * 取当前语言文案(key 参数受 I18nKey 编译期约束,拼错即编译报错;
 * 缺失 key 运行期经回退链兜底,最终返回 key 本身,不抛错——动态 key 场景走 tByKey)。
 * 参数插值:模板 ${name} 占位,params 提供同名值;缺失参数保留占位符原样。
 */
export function t(key: Dict, params?: Record<string, string | number>): string {
  return tByKey(key, params);
}
