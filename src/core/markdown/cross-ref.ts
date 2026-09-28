/**
 * 交叉引用契约单源:fig/tab/sec/eq 四类引用的类型常量与章节 label({#sec:label})
 * 正则族收敛于此,docx/pdf 两侧渲染共用,消除原两份平行定义的人肉同步。
 * 纯模块:零导入,无运行时依赖。
 */

/**
 * 交叉引用类型常量:fig/tab/sec/eq 四类引用集中定义。
 * - label 前缀:行内链接 #<prefix>:<label> 匹配([\w-]+);
 * - defaultText:引用文本恰为此文本时替换为编号(其他文本保持原样仍跳转);
 * - danglingText:查表未命中时默认文本的占位;
 * - kindName:悬空警告文案用(「交叉引用未找到<kindName> label: <prefix>:<label>」)。
 * - defaultTexts:该 kind 全部被视作「默认文本」的写法(eq 接受「式」与「公式」两种);
 *   fig/tab/sec 只有一个,故与 defaultText 同值。**只给一组渲染层消费**,
 *   免得各侧再写一份 `text === "式" || text === "公式"`。
 *
 * eq 此前游离在这张表之外(docx link-xref.ts 与 pdf equation.ts 各判一次
 * 「式」/「公式」,悬空文案也各写一份),故本表此前不覆盖公式 —— 见 adr-030 6-D3。
 * 公式的编号文本形态与其他三类不同(「式 (N)」而非「图 1.1」),故用 numberSuffix
 * 表达括号包裹;该字段是 eq 独有条目,其余三类不带。
 */
export const CROSS_REF_KINDS = {
  fig: { defaultText: "图", defaultTexts: ["图"], danglingText: "图 (?)", kindName: "图" },
  tab: { defaultText: "表", defaultTexts: ["表"], danglingText: "表 (?)", kindName: "表" },
  sec: { defaultText: "章节", defaultTexts: ["章节"], danglingText: "(?)", kindName: "章节" },
  eq: {
    defaultText: "式",
    defaultTexts: ["式", "公式"],
    danglingText: "(?)",
    kindName: "公式",
    /** 编号括号包裹:「式 (3)」;其余 kind 的编号文本不带括号,故不带此字段。 */
    numberSuffix: " (",
  },
} as const;

export type CrossRefKind = keyof typeof CROSS_REF_KINDS;

/**
 * `CROSS_REF_HREF_RE` 实际匹配的 kind(fig/tab/sec)。
 *
 * 与 {@link CrossRefKind} 分开声明的原因:6-D3 把 eq 并入本表后,后者多出 eq,
 * 而 href 正则**不含 eq**(公式引用走 `EQ_REF_HREF_RE` 与独立的编号/占位形态)。
 * 若让调用方把正则捕获组直接断言成 CrossRefKind,tsc 就拦不住「拿 eq 去查题注
 * 命名空间」这类误用 —— 故单源声明这个更窄的集合。
 */
export type CrossRefHrefKind = Exclude<CrossRefKind, "eq">;

/**
 * 引用文本是否该被替换成编号(该 kind 的默认文本之一)。
 *
 * eq 接受「式」与「公式」两种写法,其余 kind 只有一种;两侧渲染层经此单点判定,
 * 不再各写一份 `text === "式" || text === "公式"`(adr-030 6-D3)。
 */
export function isCrossRefDefaultText(kind: CrossRefKind, text: string): boolean {
  return (CROSS_REF_KINDS[kind].defaultTexts as readonly string[]).includes(text);
}

/**
 * 该 kind 的编号文本(引用文本 → 编号的替换结果)。
 *
 * fig/tab/sec 直接给编号文本;eq 的编号带括号包裹(「式 (3)」)—— 该差异由表里的
 * numberSuffix 表达,两侧渲染层不再各拼一次。
 *
 * @param kind 引用种类
 * @param numberText 查表命中的编号文本
 * @param refText 引用原文(命中默认文本时以其为前缀,故 eq 保留「式」/「公式」写法)
 */
export function crossRefNumberText(kind: CrossRefKind, numberText: string, refText: string): string {
  const suffix = "numberSuffix" in CROSS_REF_KINDS[kind] ? CROSS_REF_KINDS[kind].numberSuffix : undefined;
  return suffix === undefined ? numberText : `${refText}${suffix}${numberText})`;
}

/** 题注 kind:fig/tab 各占一个交叉引用命名空间(见 captionLabelKey) */
export type CaptionKind = "fig" | "tab";

/** 题注 label 查表键(kind 分命名空间):`${kind}:${label}`。
 *  fig 与 tab 同名 label 各登记各的、互不覆盖;引用侧只在本 kind 命名空间内
 *  查找,跨 kind 必然查不到 → 判悬空(不跨 kind 命中)。
 *  同一 kind 内 label 重名仍为后写覆盖(先到先得语义不变)。
 *  分隔符取 ":" 与引用 href(#fig:label)前缀写法一致,且 label 由 [\w-]+ 限定
 *  不含 ":"(见 kindLabelRegex / CROSS_REF_HREF_RE),故拼接无歧义。
 *  docx(ctx.xref.captionLabels)与 pdf(rules/xref.ts captionLabels)两侧共用
 *  本函数,勿各写一份拼接逻辑。 */
export function captionLabelKey(kind: CaptionKind, label: string): string {
  return `${kind}:${label}`;
}

/** 标题行内 label 后缀({#sec:label};捕获组 1 = label)。
 *  parse.ts 提取 label、渲染侧剥离标题文本共用同一实例(剥离场景忽略捕获组,
 *  replace 行为与无捕获组版本逐字等价)。 */
export const SEC_LABEL_RE = /\s*\{#sec:([\w-]+)\}$/;

/** 按 kind 构造尾部 label 匹配正则(fig/tab/sec;捕获组 1 = label)。
 *  每次调用新建实例,无 /g 标志无状态,与原内联 new RegExp 等价。 */
export function kindLabelRegex(kind: string): RegExp {
  return new RegExp(`\\s*\\{#${kind}:([\\w-]+)\\}$`);
}

/** 纯文本尾部 {#sec:label} 剥离(目录条目标题等纯文本场景;mdast text 叶子
 *  与 pdf inline.content 的同步剥离同用此函数)。 */
export function stripSecLabelSuffix(text: string): string {
  return text.replace(SEC_LABEL_RE, "");
}

/* ---------- 正则族单源:docx/pdf 两侧渲染共用,勿散落硬编码 ---------- */

/** 公式 label 段正则:整段纯文本串接恰为 {#eq:label} 即命中(粗斜体包裹亦命中),
 *  捕获组 1 = label。docx equations.ts 与 pdf equation.ts 共用。 */
export const EQ_LABEL_RE = /^\{#eq:([\w-]+)\}$/;

/** 公式引用 href 正则:[式](#eq:label) 链接 url 匹配,捕获组 1 = label。
 *  docx link-xref.ts 与 pdf equation.ts 引用替换共用。 */
export const EQ_REF_HREF_RE = /^#eq:([\w-]+)$/;

/** 图/表/章节引用 href 正则:[图](#fig:label) 等,捕获组 1 = kind、2 = label。
 *  docx link-xref.ts 与 pdf xref.ts 引用替换共用。 */
export const CROSS_REF_HREF_RE = /^#(fig|tab|sec):([\w-]+)$/;

/** 题注前缀正则(8b):「图:」/「表:」(半角/全角冒号)+ 紧随空白,锚定段首;
 *  捕获组 1 = 类别字(图/表)。docx captions.ts 与 pdf caption.ts 共用;
 *  前缀之后剩余文本由调用方 slice(match[0].length) 取得。 */
export const CAPTION_PREFIX_RE = /^(图|表)[:：]\s*/;
