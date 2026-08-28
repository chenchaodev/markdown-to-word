/**
 * 内联格式白名单:docx/pdf 双格式共享的单一实现。
 * 原 docx/render.ts 与 pdf/render.ts 各持一份逐字副本,抽取后任何标签集/判定规则
 * 变更只改此处,双格式自动一致。
 * 渲染差异保留在各侧扫描器(双向同步指针):
 * - docx:src/core/docx/handlers/inline-html.ts normalizeInlineHtml(节点流合并)
 * - pdf:src/core/pdf/rules/html.ts matchAllowedHtmlExpression(源码栈扫描)
 * 两份扫描算法对 br/自闭合/嵌套的处理规则逐条对齐,修改任一侧须同步另一侧。
 */

/** 内联格式白名单标签(无属性才渲染;docx/pdf 双格式契约) */
export const ALLOWED_INLINE_TAGS = new Set([
  "strong", "b", "em", "i", "u", "s", "del", "code", "kbd", "sub", "sup", "mark", "br", "span",
]);

/**
 * 内联 HTML 白名单判定:整串须完全由「白名单无属性标签 + 文本」构成才合法。
 * 开标签仅允许纯标签名(可带尾随空白,`<strong>` / `<strong >` 无属性合法,
 * 带属性如 `<strong class="x">` 一律非法);闭标签须与栈顶匹配;br 为空标签
 * 不入栈,B3 起自闭合 `<br/>` / `<br />` 同样合法(非空标签的自闭合形式仍非法);
 * 文本段不允许出现 `<`;扫描结束栈须为空。未闭合/错配/带属性/
 * 非白名单 → false(调用方按安全兜底处理:pdf 转义 / docx 跳过)。
 */
export function isAllowedInlineHtml(content: string): boolean {
  const text = content.trim();
  const stack: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) break; // 剩余均为文本(不含 <)
    const close = text.indexOf(">", open + 1);
    if (close === -1) return false; // 未闭合
    const inner = text.slice(open + 1, close);
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return false; // 闭标签带属性/非法
      if (name === "br" || !ALLOWED_INLINE_TAGS.has(name)) return false;
      if (stack.length === 0 || stack[stack.length - 1] !== name) return false; // 无对应/错配
      stack.pop();
    } else {
      const raw = inner.trim();
      const selfClosed = raw.endsWith("/");
      const name = (selfClosed ? raw.slice(0, -1) : raw).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return false; // 带属性/非法开标签
      if (!ALLOWED_INLINE_TAGS.has(name)) return false;
      if (name === "br") {
        // br 空标签不入栈;自闭合 <br/> 走同一分支
      } else {
        if (selfClosed) return false; // 非空标签自闭合不放行(保守)
        stack.push(name);
      }
    }
    i = close + 1;
  }
  return stack.length === 0;
}
