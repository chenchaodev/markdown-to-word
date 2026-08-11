import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Node, Root, Heading } from "mdast";
import { uniqueSlug } from "./slug.js";
import { collectPlainText as collectText } from "./mdast-utils.js";

/**
 * mdast Data 为声明合并接口:扩展标题的 data.id(本模块解析时写入,
 * docx 书签 / 内部锚点等消费端读取)。属公共契约,勿移除。
 */
declare module "mdast" {
  interface Data {
    id?: string;
  }
}

/**
 * 用 remark + remark-gfm + remark-math 将 markdown 解析为 mdast AST。
 * GFM 提供:表格 / 删除线 / 任务列表(按普通列表处理)。
 * remark-math(批次 6)提供:inlineMath($..$)与 math(display,$$..$$ / ```math)节点。
 * 解析后为所有标题生成唯一 id(挂 node.data.id):
 * 二期公共底座,TOC / docx 书签 / 内部锚点链接共用。
 */
export function parseMarkdown(md: string): Root {
  const ast = remark().use(remarkGfm).use(remarkMath).parse(md);
  const seen = new Map<string, number>();
  walkHeadings(ast, seen);
  return ast;
}

/** 递归为所有 heading 生成唯一 id(标题文本拼接所有 text 子节点)。 */
function walkHeadings(node: Node, seen: Map<string, number>): void {
  if (node.type === "heading") {
    const heading = node as Heading;
    const text = collectText(heading);
    heading.data = { ...heading.data, id: uniqueSlug(text, seen) };
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walkHeadings(child, seen);
  }
}
