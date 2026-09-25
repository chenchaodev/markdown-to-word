/**
 * pdf 标题 id 锚点规则:heading_open 渲染包装单源——slug id 去重 + sec 交叉引用锚点注入,
 * 并在渲染期顺带产出目录/书签用的结构化标题(level/id/text)。
 * 双管线对应:src/core/docx/handlers/heading.ts(docx 侧标题段渲染 + 书签锚点)。
 * 差异与同步点:id 去重单源 core/markdown/slug.ts uniqueSlug(docx 侧 id 在
 * pipeline/parse.ts 生成后渲染期经 docxBookmarkId 包书签,本侧在本规则内生成
 * HTML id);{#sec:label} 本侧在 xref_recognize 扫描期剥离(stripSecLabelSuffix
 * 单源),docx 侧渲染期剥离。修改 id/label 剥离/锚点语义须同步核对
 * src/core/docx/handlers/heading.ts。
 *
 * 目录层级口径(双向指针,勿单侧调整):本规则只收 h1-h3(PDF_TOC_MAX_LEVEL),
 * 与 docx 侧 src/core/docx/prescan.ts 第 5 轮 tocEntries 的取层级口径一致;
 * 任一侧改目录层级,另一侧必须同步(该侧注释亦指回此处)。
 */
import type MarkdownIt from "markdown-it";
import { uniqueSlug } from "../../markdown/slug.js";
import { decodeEntities } from "../../util/utils.js";
import type { PdfHeading } from "../bookmarks.js";
import { attrDel } from "./shared.js";

/** 目录/书签收录的最大标题层级(1-3;h4-h6 虽有 id 也不进目录/书签)。
 *  与 docx 侧 prescan.ts 第 5 轮 tocEntries 同步(双向指针,勿单侧调整)。 */
export const PDF_TOC_MAX_LEVEL = 3;

/** 标题标签 → 层级(非 h1-h6 返回 null) */
function headingLevel(tag: string): number | null {
  const level = Number(tag[1]);
  return tag[0] === "h" && tag.length === 2 && level >= 1 && level <= 6 ? level : null;
}

/** 标题 id(锚点目录/内部跳转底座):seen 在渲染闭包内维护,按文档顺序去重。
 *  注意:markdown-it 14.3 的 heading_open token 不带 content(初始为 "" 且不填充,
 *  标题纯文本落在下一个 inline token 上),故用 || 兜底取 tokens[idx + 1].content;
 *  若契约声明的 token.content 非空则优先使用。
 * heading_open 带 data-xref-anchor(sec:<label>)时,开标签后注入
 *  <span id="sec:<label>"> 锚点(引用 [章节](#sec:label) 跳转目标;label 已在
 *  xref_recognize 从 inline.content 剥离,slug 不含 label)。
 *  headings 为结构化标题出参(入列顺序 = 文档顺序),供目录/书签直接消费,
 *  免去从渲染后 HTML 反解析标题。
 *  文本取值:heading_open 设位、紧随其后的 inline 渲染完成时补写(剥标签 + 实体解码,
 *  与渲染产物同源,故与旧的 HTML 反解析口径逐字一致)。不在 heading_open 里预渲染
 *  inline——行内规则(脚注登记、公式展开等)有 env 副作用,二次渲染会重复登记。 */
export function overrideHeadingIdRule(
  md: MarkdownIt,
  seen: Map<string, number>,
  headings: PdfHeading[],
): void {
  const defaultRule = md.renderer.rules.heading_open;
  let pending: PdfHeading | null = null; // 待补文本的标题(heading_open 设位)
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const text = token.content || tokens[idx + 1]?.content || "";
    const id = uniqueSlug(text, seen);
    token.attrSet("id", id);
    const level = headingLevel(token.tag);
    if (level !== null && level <= PDF_TOC_MAX_LEVEL) pending = { level, id, text: "" };
    const anchor = token.attrGet("data-xref-anchor");
    if (anchor) attrDel(token, "data-xref-anchor");
    const html = defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (!anchor) return html;
    return html.replace(">", `><span id="${anchor}"></span>`);
  };
  // 行内渲染出口(markdown-it 的 inline token 走 renderer.renderInline,无 rules.inline 钩子):
  // 先取位清空再渲染,防行内规则内再入 heading 造成文本错配
  const renderInline = md.renderer.renderInline.bind(md.renderer);
  md.renderer.renderInline = (children, options, env) => {
    const current = pending;
    pending = null;
    const html = renderInline(children, options, env);
    if (current) {
      current.text = decodeEntities(html.replace(/<[^>]+>/g, ""));
      headings.push(current);
    }
    return html;
  };
}
