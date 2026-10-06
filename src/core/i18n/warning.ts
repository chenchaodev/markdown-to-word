/**
 * keyed 警告的**类型与构造器**(逻辑层的「产出结构化警告」那一半):
 * core 生成的警告不再硬编码中文文案,携带字典 key + 插值参数 + 缺失 key 时的
 * 兜底文案(fallback = 改造前中文原文逐字保留,保证 zh 界面行为等价)。经 IPC 原样
 * 传到 renderer,显示层 formatWarning 按当前语言格式化。
 *
 * 各警告构造器是 docx/pdf 双管线共用的**单一来源**,文案改动单点生效;
 * 失败分类口径（超时降级 / 原样上抛 / 取消不归一）由调用方按各自通道决定,
 * 本模块只负责「造出哪一条」。
 *
 * 为什么单独成文件(ADR-064 把 i18n.ts 这个桶溶进 i18n/ 目录):
 * 「产出警告」与「取文案」是相反方向的两件事 —— 本模块只 import tByKey 一个取文
 * 原语,不持有任何语言状态;此前它们与语言状态、DOM 面挤在一个 201 行的桶里。
 */
import { tByKey } from "./t.js";
import type { Dict } from "./zh.js";

/**
 * 警告 key 的合法取值 = 字典里全部 `warn.*` 键。
 *
 * 为什么收窄而不是留 `string`:警告 key 经 IPC 传到 renderer 后由 tByKey 查表,
 * 字典里没有的 key 会**静默**走回退链(显示原始 key 或 fallback 文案)—— 实测发生过
 * 一次:`warn.precheckFailed` 在代码里存在而三份字典都没有,用户看到的是兜底文案
 * 而非翻译后的提示,且没有任何门禁会红。收窄后「代码发了字典没有的 key」变成编译错误。
 *
 * 为什么用 Extract 而不是直接用 Dict:Dict 有 465 个键,只有 28 个是 warn.* ——
 * 直接用 Dict 会把 437 个无关键(dialog.* / menu.* / convert.stage.* 等)也放进合法集。
 *
 * ⚠ 那个显式例外 `convert.merge.blockedUnclosedFence`:它是**合并阻断告警**,却住在
 * convert.merge.* 命名空间里而非 warn.* —— 命名不一致,但它是用户可见文案、key 被
 * convert-flow.ts 引用,改命名是另一件事。显式列出来而不是放宽成前缀规则
 * (`convert.merge.${string}` 会放进 blockedUnclosedFenceMore 等**非**警告键)。
 * 新增非 warn.* 的警告 key 时,必须在这里显式加一条 —— 那正是要人判断的时刻。
 *
 * ⚠ 收窄的代价要说清:`fallback` 字段从类型系统看变成「构造不出 key 缺失的
 * KeyedWarning」而不可达。但 tByKey 的运行期回退链仍在、formatWarning 的
 * `text === w.key ? w.fallback : text` 仍在 —— 它从「常态路径」降级为「动态 key 的防御」。
 * 这是有意的:让不一致从运行期静默兜底变成编译期错误。
 */
export type WarningKey = Extract<Dict, `warn.${string}`> | "convert.merge.blockedUnclosedFence";

/**
 * keyed 警告(i18n 收口):core 生成的警告不再硬编码中文文案,
 * 携带字典 key + 插值参数 + 缺失 key 时的兜底文案(fallback = 改造前中文原文逐字保留,
 * 保证 zh 界面行为等价)。经 IPC 原样传到 renderer,显示层 formatWarning 按当前语言格式化。
 */
export interface KeyedWarning {
  key: WarningKey;
  params?: Record<string, string | number>;
  /** 缺失 key 时的兜底文案(= 现有中文原文逐字保留) */
  fallback: string;
  /**
   * 该告警在**合并转换**里不可「继续」,消费方据此阻断合并流程。
   * 只承诺这一个维度,故不设通用 severity 字段:「单文件里什么算 blocking」没有统一
   * 答案,而 severity 这类通用名会 invites 误用(调用方会拿去判「单文件是否阻断」)。
   * 为什么是合并专属:合并把多份拼成**一份**文档,未闭合围栏会跨越文件边界把后续文件
   * 一并吞成代码块 —— 受害的不止本文件,且用户按惯例点「继续」就会直接踩到;
   * 而单文件/批量里损害止于本文件,预检弹窗已逐条告知,用户知情后自行承担是合理的。
   * 取字面量 `true` 而非 `boolean`:让「只有真正阻断的那一类才带这个字段」在类型上成立。
   */
  blocksMerge?: true;
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
 * kindName 为中文类别词(图/表/章节,来自两侧 CROSS_REF_KINDS.kindName),
 * ref 为「前缀:label」串;en 及其余语言文案省略该占位符避免中英混排(见各字典注释)。
 * 参数名刻意叫 kindName 而非 kind:`warn.pathScanLimit` 的 kind 是**触顶维度**
 * (条目数/层级,en/ja 保留占位符),两者同名同型却不同义,照后者的口径给前者补翻译
 * 会把中文类别词硬塞进英文界面(见 adr-023)。
 */
export function crossRefNotFoundWarning(kindName: string, ref: string): KeyedWarning {
  return {
    key: "warn.crossRefNotFound",
    params: { kindName, ref },
    fallback: `交叉引用未找到${kindName} label: ${ref}`,
  };
}

/**
 * 代码高亮降级警告(docx/pdf 共用单一来源):
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
 * Mermaid 渲染失败警告族(docx/pdf 共用单一来源):
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
 * 代码块未标注语言警告(转换预检):``` 后缺语言标识,高亮/排版可能降级。
 */
export function unlabeledCodeBlockWarning(): KeyedWarning {
  return {
    key: "warn.unlabeledCodeBlock",
    fallback: "代码块未标注语言,可能无法正确高亮排版",
  };
}

/**
 * 警告去重键(单源,docx/pdf 双管线共用):key + JSON(params)。params 相同才
 * 视为同一警告(不同 TeX 源码/label 的降级各自保留一条);调用侧勿自定义键格式。
 */
export function warnDedupKey(warning: KeyedWarning): string {
  return `${warning.key}:${JSON.stringify(warning.params ?? null)}`;
}

/**
 * 去重入列(纯函数,双管线共用):同一去重键只入 warnings 一次,防 GUI 警告列表
 * 刷屏(悬空交叉引用被引 N 次只产生 1 条)。seen 集合由调用方持有,生命周期 =
 * 单次转换/单次渲染(docx 侧为 ctx.warning.warnedKeys,pdf 各规则为规则内集合,键含
 * warning key 故互不冲突);即使 warnings 缺省也登记 seen(与既有行为一致)。
 */
export function pushWarningOnce(
  seen: Set<string>,
  warnings: ConvertWarning[] | undefined,
  warning: KeyedWarning,
): void {
  const key = warnDedupKey(warning);
  if (seen.has(key)) return;
  seen.add(key);
  warnings?.push(warning);
}
