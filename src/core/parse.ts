import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkComment } from "./comment.js";
import type { Node, Root, Heading } from "mdast";
import { uniqueSlug } from "./slug.js";
import { collectPlainText as collectText } from "./mdast-utils.js";

/**
 * mdast Data 为声明合并接口:扩展标题的 data.id(本模块解析时写入,
 * docx 书签 / 内部锚点等消费端读取)与 data.secLabel(批次 10 功能 2)。
 * 属公共契约,勿移除。
 */
declare module "mdast" {
  interface Data {
    id?: string;
    /** 标题行内 label(批次 10 功能 2:{#sec:label} 尾部后缀;label 不进 slug/标题文本) */
    secLabel?: string;
  }
}

/** 标题行内 label 后缀(批次 10 功能 2:{#sec:label};与 docx/render.ts
 *  renderHeading 渲染文本剥离正则一致,勿单侧改动) */
const SEC_LABEL_RE = /\s*\{#sec:([\w-]+)\}$/;

/**
 * 用 remark + remark-gfm + remark-math + remark-comment 将 markdown 解析为 mdast AST。
 * GFM 提供:表格 / 删除线 / 任务列表(按普通列表处理)。
 * remark-math(批次 6)提供:inlineMath($..$)与 math(display,$$..$$ / ```math)节点。
 * remark-comment(批次 11)提供:comment 节点([锚定文本]{批注=内容},见 comment.ts)。
 * 解析后为所有标题生成唯一 id(挂 node.data.id):
 * 二期公共底座,TOC / docx 书签 / 内部锚点链接共用。
 */
export function parseMarkdown(md: string): Root {
  const ast = remark().use(remarkGfm).use(remarkMath).use(remarkComment).parse(md);
  const seen = new Map<string, number>();
  walkHeadings(ast, seen);
  return ast;
}

/** 递归为所有 heading 生成唯一 id(标题文本拼接所有 text 子节点;
 *  尾部 {#sec:label} 后缀剥离,label 不进 slug——渲染文本的剥离在
 *  docx/render.ts renderHeading,两处正则与 SEC_LABEL_RE 一致)。 */
function walkHeadings(node: Node, seen: Map<string, number>): void {
  if (node.type === "heading") {
    const heading = node as Heading;
    const text = collectText(heading);
    const labelMatch = SEC_LABEL_RE.exec(text);
    const plain = labelMatch ? text.slice(0, labelMatch.index) : text;
    heading.data = {
      ...heading.data,
      id: uniqueSlug(plain, seen),
      ...(labelMatch ? { secLabel: labelMatch[1] } : {}),
    };
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walkHeadings(child, seen);
  }
}
