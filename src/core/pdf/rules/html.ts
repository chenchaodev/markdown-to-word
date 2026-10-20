/**
 * pdf 行内 HTML 规则:html_whitelist 解析规则 + html_block/html_inline 渲染包装。
 *
 * 白名单判定、对齐容器解析、白名单外标签的剥壳全部单源在
 * core/markdown/html-whitelist.ts;本文件只负责格式侧的两件事:
 * - 解析层:把 markdown-it 默认 html_inline 的单标签匹配组合成完整源码表达式;
 * - 渲染层:决定表达式原样交给 Chromium、容器重新序列化,还是降级为转义文本。
 *
 * 安全边界不由本文件决定:不解析 style/class/id,align 只经容器序列化产出,
 * 因此渲染层任何分支都拼不出白名单外的标签或属性。
 */
import type MarkdownIt from "markdown-it";
import {
  htmlExpressionLength,
  isAllowedInlineHtml,
  parseAllowedContainer,
  serializeAllowedContainer,
  stripUnsupportedHtml,
} from "../../markdown/html-whitelist.js";

/** HTML 白名单:page-break 注释 → 分页 div;对齐容器 → 共享序列化结果;
 *  白名单整串(无属性行内标签对)→ 原样输出(Chromium 渲染,与 docx 侧一致);
 *  其余裸 HTML 只保留文本并转义,维持"裸 HTML 不渲染"的安全行为。
 *  注意:html_block 也走同一判定——markdown-it 会把行首的 <strong>粗体</strong>
 *  归为 html_block 而非 html_inline,不放行则行首白名单在 pdf 侧被转义,双格式不一致;
 *  div/table/script 等非白名单标签依旧降级为文本。 */
export function overrideHtmlRules(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml;
  // 解析层:默认 html_inline 的 HTML_TAG_RE 不认嵌套,白名单整串须在源码上提前配平。
  // 配平只给出边界事实,是否属于白名单仍由共享模块裁定。
  md.inline.ruler.before("html_inline", "html_whitelist", (state, silent) => {
    if (!state.md.options.html || state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const len = htmlExpressionLength(state.src, state.pos);
    if (len < 0) return false;
    const expr = state.src.slice(state.pos, state.pos + len);
    if (!isAllowedInlineHtml(expr) && parseAllowedContainer(expr) === null) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = expr;
    }
    state.pos += len;
    return true;
  });
  const renderHtml = (token: { content: string }): string => {
    const content = token.content.trim();
    if (content === "<!-- page-break -->") return '<div class="page-break"></div>';
    const container = parseAllowedContainer(content);
    if (container !== null) return serializeAllowedContainer(container);
    if (isAllowedInlineHtml(content)) return token.content;
    // 白名单外:标签剥掉、文本留下。HTML 会把换行折叠成空格,故保留的换行转 br,
    // 用户原本的空行/分行不至于把多行内容挤成一段。
    const text = stripUnsupportedHtml(token.content);
    if (text.trim() === "") return "";
    return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
  };
  // 渲染器契约:idx 必为有效下标
  md.renderer.rules.html_block = (tokens, idx) => renderHtml(tokens[idx]!);
  md.renderer.rules.html_inline = (tokens, idx) => renderHtml(tokens[idx]!);
}
