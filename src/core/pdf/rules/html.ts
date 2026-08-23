/**
 * pdf 行内 HTML 白名单规则(B8 拆分自 render.ts,行为零变化):
 * html_whitelist 解析规则 + html_block/html_inline 渲染包装单源。
 * 语义注释随代码搬移不精简。
 */
import type MarkdownIt from "markdown-it";
import { ALLOWED_INLINE_TAGS, isAllowedInlineHtml } from "../../html-whitelist.js";

/**
 * 从 src 的 pos(`<` 处)起匹配一个完整白名单表达式(标签对可嵌套,br 可单独,
 * 文本段不含 `<`);返回表达式长度;无法匹配(非白名单/带属性/未闭合)→ -1。
 * 供 html_inline 解析层组合 token 使用:markdown-it 14.3 的默认 html_inline
 * 只匹配单个标签(HTML_TAG_RE 无嵌套),白名单整串须在此提前组合。
 */
function matchAllowedHtmlExpression(src: string, pos: number): number {
  const stack: string[] = [];
  let i = pos;
  while (i < src.length) {
    const open = src.indexOf("<", i);
    if (open === -1) return -1; // 残留文本,表达式不完整
    const close = src.indexOf(">", open + 1);
    if (close === -1) return -1; // 未闭合
    const inner = src.slice(open + 1, close);
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return -1;
      if (name === "br" || !ALLOWED_INLINE_TAGS.has(name)) return -1;
      if (stack.length === 0 || stack[stack.length - 1] !== name) return -1;
      stack.pop();
      if (stack.length === 0) return close + 1 - pos; // 完整表达式
    } else {
      // B3:自闭合 <br/> / <br /> 此前整串判非法转义;仅空标签 br 放行自闭合
      const raw = inner.trim();
      const selfClosed = raw.endsWith("/");
      const name = (selfClosed ? raw.slice(0, -1) : raw).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return -1;
      if (!ALLOWED_INLINE_TAGS.has(name)) return -1;
      if (name === "br") {
        if (stack.length === 0) return close + 1 - pos; // 独立 <br>(含自闭合)
        // 嵌套内的 br:继续扫描
      } else {
        if (selfClosed) return -1; // 非空标签自闭合不放行(与 isAllowedInlineHtml 一致)
        stack.push(name);
      }
    }
    i = close + 1;
  }
  return -1;
}

/** HTML 白名单:page-break 注释 → 分页 div;白名单整串(无属性行内标签对)→ 原样输出
 *  (Chromium 渲染,与 docx 侧一致);其余裸 HTML 一律转义输出,维持"裸 HTML 不渲染"的安全行为。
 *  注意:html_block 也放行白名单整串——markdown-it 会把行首的 <strong>粗体</strong>
 *  归为 html_block 而非 html_inline,不放行则行首白名单在 pdf 侧被转义,双格式不一致;
 *  div/table/script 等块级标签不在白名单集内,依旧转义。 */
export function overrideHtmlRules(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml;
  // 解析层:html_inline 之前组合白名单表达式(默认规则只产出单标签 token)
  md.inline.ruler.before("html_inline", "html_whitelist", (state, silent) => {
    if (!state.md.options.html || state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const len = matchAllowedHtmlExpression(state.src, state.pos);
    if (len < 0) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = state.src.slice(state.pos, state.pos + len);
    }
    state.pos += len;
    return true;
  });
  const renderHtml = (token: { content: string }): string => {
    const content = token.content.trim();
    if (content === "<!-- page-break -->") return '<div class="page-break"></div>';
    if (isAllowedInlineHtml(content)) return token.content;
    return escapeHtml(token.content);
  };
  // 渲染器契约:idx 必为有效下标
  md.renderer.rules.html_block = (tokens, idx) => renderHtml(tokens[idx]!);
  md.renderer.rules.html_inline = (tokens, idx) => renderHtml(tokens[idx]!);
}
