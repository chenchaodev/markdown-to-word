/**
 * GitHub Light 代码高亮色板单源(docx 与 pdf 双管线共享)。
 * 不变量:docx 逐 token 着色(code-highlight.ts)与 pdf 模板 .hljs-* CSS
 * (template.ts,经 buildHljsCss 生成)均只从本模块取值,调色改一处两侧同步。
 * 形态:色值 6 位大写 hex、无 # 前缀(docx OOXML 直用;pdf 侧生成 CSS 时
 * 转小写并拼 #,CSS hex 大小写等价)。
 * 顺序即契约:按 hljs style guide 分组顺序排列,相邻同风格条目在 pdf CSS 中
 * 合并为一条选择器组(见 buildHljsCss),勿随意调序。
 */

/** 单 token 样式(docx 消费 color/italics/bold;background 为 pdf CSS 专用底色) */
export interface HljsTokenStyle {
  /** 前景色(6 位大写 hex,无 #) */
  color?: string;
  /** 底色(6 位大写 hex,无 #;deletion/addition 的 diff 底色,docx 侧不消费——OOXML run 背景另走 shading 且当前未启用) */
  background?: string;
  italics?: boolean;
  bold?: boolean;
}

/** token 类(hljs 输出的 hljs-<类> 后缀)→ 样式 */
export const HLJS_PALETTE: Record<string, HljsTokenStyle> = {
  keyword: { color: "CF222E" },
  "selector-tag": { color: "CF222E" },
  literal: { color: "CF222E" },
  string: { color: "0A3069" },
  regexp: { color: "0A3069" },
  number: { color: "0550AE" },
  comment: { color: "6E7781", italics: true },
  title: { color: "8250DF" },
  function: { color: "8250DF" },
  attr: { color: "953800" },
  attribute: { color: "953800" },
  variable: { color: "953800" },
  "template-variable": { color: "953800" },
  built_in: { color: "0550AE" },
  meta: { color: "57606A" },
  symbol: { color: "0550AE" },
  bullet: { color: "0550AE" },
  type: { color: "116329" },
  "selector-class": { color: "116329" },
  name: { color: "116329" },
  tag: { color: "116329" },
  property: { color: "0550AE" },
  operator: { color: "CF222E" },
  link: { color: "0A3069" },
  quote: { color: "6E7781" },
  doctag: { color: "6E7781" },
  section: { color: "8250DF" },
  deletion: { color: "CF222E", background: "FFEBE9" },
  addition: { color: "116329", background: "DAFBE1" },
  emphasis: { italics: true },
  strong: { bold: true },
};

/** 样式 → CSS 声明串(声明顺序固定:color → background → font-style → font-weight) */
function cssDeclarations(style: HljsTokenStyle): string {
  const decls: string[] = [];
  if (style.color) decls.push(`color: #${style.color.toLowerCase()}`);
  if (style.background) decls.push(`background: #${style.background.toLowerCase()}`);
  if (style.italics) decls.push("font-style: italic");
  if (style.bold) decls.push("font-weight: 600");
  return decls.join("; ");
}

/**
 * 生成 pdf 模板的 .hljs-* 规则块(与调色板同源,消除双写)。
 * 相邻且样式相同的 token 合并为一条选择器组(hljs style guide 分组顺序,
 * 与历史手写 CSS 逐条等价);每行 2 空格缩进,无首尾换行。
 */
export function buildHljsCss(): string {
  const lines: string[] = [];
  let group: string[] = [];
  let groupStyle: HljsTokenStyle | undefined;
  const flush = (): void => {
    if (group.length === 0 || !groupStyle) return;
    const selectors = group.map((cls) => `.hljs-${cls}`).join(", ");
    lines.push(`  ${selectors} { ${cssDeclarations(groupStyle)}; }`);
    group = [];
  };
  for (const [cls, style] of Object.entries(HLJS_PALETTE)) {
    const same = groupStyle !== undefined && JSON.stringify(style) === JSON.stringify(groupStyle);
    if (!same) flush();
    group.push(cls);
    groupStyle = style;
  }
  flush();
  return lines.join("\n");
}
