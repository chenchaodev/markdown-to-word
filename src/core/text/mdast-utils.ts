/**
 * 「节点的纯文本是什么」这一问题的**唯一判定处**。
 *
 * 为什么单点:同一段 mdast 子树要喂给三处彼此独立的消费 —— 标题 slug(TOC / 书签 / 内部
 * 锚点共用)、目录条目文本、题注前缀识别。三处各写一份遍历,只要有一处把批注正文或样式
 * 标记算进去,就会出现「目录里的标题和文档里的标题不一样」这类症状,且症状离根因很远。
 *
 * 不变量在哪:批注节点只计 anchor 子树、批注内容是元数据不进文本(见下方 comment 分支)。
 * 新增 mdast 节点类型时,「它算不算文本」的决定必须写在这里而不是各消费点。
 */
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
