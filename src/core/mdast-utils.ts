import type { Node } from "mdast";

/** 节点子树纯文本拼接(目录条目标题 / 题注前缀识别共用;样式标志剥除) */
export function collectPlainText(node: Node): string {
  let text = "";
  if ("value" in node && typeof node.value === "string") text += node.value;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) text += collectPlainText(child as Node);
  }
  return text;
}
