/**
 * pdf 标题 id 锚点规则(B8 拆分自 render.ts,行为零变化):
 * heading_open 渲染包装单源——slug id 去重 + sec 交叉引用锚点注入。
 * 语义注释随代码搬移不精简。
 */
import type MarkdownIt from "markdown-it";
import { uniqueSlug } from "../../markdown/slug.js";
import { attrDel } from "./shared.js";

/** 标题 id(批次 2 锚点目录/内部跳转底座):seen 在渲染闭包内维护,按文档顺序去重。
 *  注意:markdown-it 14.3 的 heading_open token 不带 content(初始为 "" 且不填充,
 *  标题纯文本落在下一个 inline token 上),故用 || 兜底取 tokens[idx + 1].content;
 *  若契约声明的 token.content 非空则优先使用。
 *  批次 10 功能 2:heading_open 带 data-xref-anchor(sec:<label>)时,开标签后注入
 *  <span id="sec:<label>"> 锚点(引用 [章节](#sec:label) 跳转目标;label 已在
 *  xref_recognize 从 inline.content 剥离,slug 不含 label)。 */
export function overrideHeadingIdRule(md: MarkdownIt, seen: Map<string, number>): void {
  const defaultRule = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const text = token.content || tokens[idx + 1]?.content || "";
    token.attrSet("id", uniqueSlug(text, seen));
    const anchor = token.attrGet("data-xref-anchor");
    if (anchor) attrDel(token, "data-xref-anchor");
    const html = defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (!anchor) return html;
    return html.replace(">", `><span id="${anchor}"></span>`);
  };
}
