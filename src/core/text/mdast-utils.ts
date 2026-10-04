import type { Node } from "mdast";
import type { CommentNode } from "../markdown/comment.js";

/** 节点子树纯文本拼接(目录条目标题 / 题注前缀识别共用;样式标志剥除) */
export function collectPlainText(node: Node): string {
  let text = "";
  if ("value" in node && typeof node.value === "string") text += node.value;
  if (node.type === "comment") {
    // 批注节点:仅锚定文本计入纯文本(批注内容为元数据,
    // 不进标题 slug / 目录条目 / 题注前缀识别)
    for (const child of (node as CommentNode).anchor) text += collectPlainText(child);
    return text;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) text += collectPlainText(child as Node);
  }
  return text;
}
