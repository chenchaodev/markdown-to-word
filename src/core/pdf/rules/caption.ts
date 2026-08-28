/**
 * pdf 题注前缀行识别规则:caption_recognize core 规则单源。
 */
import type MarkdownIt from "markdown-it";
import { CAPTION_PREFIX_RE } from "../../markdown/cross-ref.js";
import { createDepthTracker } from "./shared.js";

/**
 * 题注前缀行识别(与 docx 侧 buildCaptionContext 顶层预扫契约一致):
 * 块 token 流中,顶层「含图片段落」或「表格」之后紧跟的、以「图:」/「表:」
 * (半角/全角冒号)开头的段落 → 标记为 fig-caption/tab-caption 并剥除前缀。
 * 编号由 CSS counter 伪元素渲染(不进文本节点,目录/书签不受影响)。
 * 容器深度限制(blockquote/list_item/table 单元格内不识别,与 docx 侧
 * 只遍历 ast.children 顶层一致);文档开头(首 h1 之前)的图题注在无 h1
 * 文档中按纯序数渲染,有 h1 文档中渲染为「图 0.N」(与 docx 侧「图 N」
 * 的差异为 CSS counter 无法条件输出的罕见边界,验收清单已标注)。
 */
export function overrideCaptionRule(md: MarkdownIt): void {
  md.core.ruler.push("caption_recognize", (state) => {
    const tokens = state.tokens;
    const depth = createDepthTracker();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      depth.feed(token.type);
      if (token.type === "paragraph_close" && depth.isTopLevel()) {
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
        const first = inline.children[0]!; // 上方刚排除 children 为空
        if (first.type !== "text") continue;
        const match = CAPTION_PREFIX_RE.exec(first.content);
        if (!match) continue;
        const prev = tokens[i - 3];
        if (!prev) continue;
        if (prev.type === "table_close") {
          // 表格后紧跟的题注段
        } else if (prev.type === "paragraph_close") {
          const prevInline = tokens[i - 4];
          const hasImage = prevInline?.type === "inline" && prevInline.children?.some((t) => t.type === "image");
          if (!hasImage) continue;
        } else {
          continue;
        }
        // 剥前缀(前缀完整落在首 text token:契约「图:/表:」紧贴且其后为行内内容)
        first.content = first.content.slice(match[0].length);
        tokens[i - 2]!.attrSet("class", match[1] === "图" ? "fig-caption" : "tab-caption"); // 契约:paragraph_close 前必有 paragraph_open
      }
    }
  });
}
