/**
 * 交叉引用契约单源(B7 第 1 波):fig/tab/sec 三类引用的类型常量与
 * 章节 label({#sec:label})正则族收敛于此,docx/pdf 两侧渲染共用,
 * 消除原「同一契约两份平行定义、注释互指勿单侧改」的人肉同步。
 * 纯模块:零导入,无运行时依赖。
 */

/**
 * 交叉引用类型常量(批次 10 功能 2):fig/tab/sec 三类引用集中定义。
 * - label 前缀:行内链接 #<prefix>:<label> 匹配([\w-]+);
 * - defaultText:引用文本恰为此文本时替换为编号(其他文本保持原样仍跳转);
 * - danglingText:查表未命中时默认文本的占位;
 * - kindName:悬空警告文案用(「交叉引用未找到<kindName> label: <prefix>:<label>」)。
 */
export const CROSS_REF_KINDS = {
  fig: { defaultText: "图", danglingText: "图 (?)", kindName: "图" },
  tab: { defaultText: "表", danglingText: "表 (?)", kindName: "表" },
  sec: { defaultText: "章节", danglingText: "(?)", kindName: "章节" },
} as const;

export type CrossRefKind = keyof typeof CROSS_REF_KINDS;

/** 标题行内 label 后缀(批次 10 功能 2:{#sec:label};捕获组 1 = label)。
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
