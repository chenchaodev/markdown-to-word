/**
 * pdf 公式编号规则:eq_numbering core 规则 + math_block 渲染包装单源。
 */
import type MarkdownIt from "markdown-it";
import { EQ_LABEL_RE, EQ_REF_HREF_RE } from "../../markdown/cross-ref.js";
import { createDepthTracker, forEachRefLink } from "./shared.js";

/**
 * 公式编号 + 交叉引用(与 docx 侧契约一致;免更新路线,编号静态注入文本):
 * - 编号对象:顶层(blockquote/list_item/table 单元格外)display 公式(math_block,
 *   由 @mdit/plugin-katex 产生),按文档顺序全文连续编号 1,2,3…
 * - label 语法:公式块之后紧跟独立段落 {#eq:label}(整段纯文本串接恰为该标记,
 *   粗斜体包裹亦命中以对齐 docx 口径,label 为 [\w-]+),
 *   该段标记 hidden 不渲染,label 登记给前一个 math_block(生成页内锚点)
 * - 引用语法:链接 [式](#eq:label) / [公式](#eq:label) 文本替换为「式 (N)」/「公式 (N)」
 *   并保留跳转;其他文本的 #eq:label 链接保持原文本;未知 label → 「式 (?)」
 *   (warnings 通道存在时追加提示,经 render 的 env.warnings 注入,见 renderPdfHtml)
 * - 编号渲染:math_block 包 <div class="eq-block">(内可选 <span id="eq:label"> 锚点 +
 *   KaTeX 输出 + <span class="eq-num">(N)</span>),CSS 使公式居中、编号右缘垂直居中
 * - numbering=false(公式编号开关关闭):规则仍注册,但只做 label 段隐藏(三 token
 *   hidden + children 清空,语法标记不显示);不做 math_block 编号(data-eq-index
 *   不设置)、labelIndex 登记、第二遍引用替换(引用保持原文本)
 */
export function overrideEquationRule(md: MarkdownIt, numbering: boolean = true): void {
  md.core.ruler.push("eq_numbering", (state) => {
    const tokens = state.tokens;
    // 第一遍:顶层遍历(容器深度跟踪同 caption_recognize),编号 + label 段识别
    const depth = createDepthTracker();
    let eqIndex = 0;
    let lastMathToken: (typeof tokens)[number] | null = null;
    const labelIndex = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      depth.feed(token.type);
      if (
        token.type === "math_block" &&
        depth.isTopLevel()
      ) {
        // 仅顶层公式编号(容器内公式与 docx 侧一致:不计数不编号,原样渲染)
        if (!numbering) continue; // 关开关:不编号(不设 data-eq-index)
        eqIndex++;
        token.attrSet("data-eq-index", String(eqIndex));
        lastMathToken = token;
      } else if (
        token.type === "paragraph_close" &&
        depth.isTopLevel()
      ) {
        // label 段:paragraph_open + inline + paragraph_close。
        // 口径对齐 docx:整段「纯文本串接」恰为 {#eq:label} 即命中——此前要求
        // 唯一 text child,粗斜体包裹的 label(如 **{#eq:a}**)双格式登记结果不同
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children) continue;
        let plain = "";
        for (const child of inline.children) {
          if (child.type === "text") plain += child.content;
        }
        const match = EQ_LABEL_RE.exec(plain);
        if (!match) continue;
        if (numbering) {
          if (!lastMathToken) continue; // 无前置公式 → 保持原样(按普通段落渲染)
          const label = match[1]!; // 捕获组结构保证
          lastMathToken.attrSet("data-eq-label", label);
          labelIndex.set(label, eqIndex);
        }
        // 三 token 置 hidden 不渲染。注意:markdown-it 主渲染循环对 inline token
        // 直接 renderInline(children),不检查 inline 自身 hidden(仅 renderToken 检查,
        // text 等走独立规则的 children 亦然)→ 必须同时清空 children 才能彻底不输出
        tokens[i - 2]!.hidden = true; // 契约:paragraph_close 前必有 paragraph_open
        inline.hidden = true;
        inline.children = [];
        token.hidden = true;
      }
    }
    if (!numbering) return; // 关开关:不做引用替换(引用保持原文本)
    // 第二遍:链接引用替换(遍历所有 inline 的 children,含容器/脚注内;
    // 骨架见 forEachRefLink)
    const unknownLabels = new Set<string>();
    forEachRefLink(tokens, EQ_REF_HREF_RE, ({ labels, textToken }) => {
      const label = labels[0]!; // 捕获组结构保证
      const num = labelIndex.get(label);
      if (num === undefined && !unknownLabels.has(label)) {
        unknownLabels.add(label); // 同标签只提示一次,避免重复刷屏
        // 与 docx 侧同场景文案不同(历史差异,勿单侧改):docx 为
        // 「交叉引用未找到公式 label: <label>」(warn.crossRefNotFound)
        state.env.warnings?.push({
          key: "warn.eqLabelUndefined",
          params: { label },
          fallback: `引用未定义的公式标签: eq:${label}`,
        });
      }
      // 仅默认文本「式」/「公式」替换为「式 (N)」(未知 label 占位 ?);
      // eq 引用恒保留链接结构(与 xref 悬空解包不同)
      if (textToken && (textToken.content === "式" || textToken.content === "公式")) {
        textToken.content = `${textToken.content} (${num ?? "?"})`;
      }
      return false;
    });
  });
  wrapMathBlockRenderer(md);
}

/** 包装 math_block 渲染规则(原规则由 @mdit/plugin-katex 提供,保存后包装):
 *  带 data-eq-index 的公式包 eq-block 容器(eq-num 编号 + 可选 label 锚点)。 */
function wrapMathBlockRenderer(md: MarkdownIt): void {
  const defaultRule = md.renderer.rules.math_block;
  md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const html = defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : md.utils.escapeHtml(token.content);
    const eqIndex = token.attrGet("data-eq-index");
    if (!eqIndex) return html; // 未被编号的公式(如容器内),原样输出
    const label = token.attrGet("data-eq-label");
    const anchor = label ? `<span id="eq:${label}"></span>` : "";
    return `<div class="eq-block">${anchor}${html}<span class="eq-num">(${eqIndex})</span></div>`;
  };
}
