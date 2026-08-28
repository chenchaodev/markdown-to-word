import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkComment } from "../markdown/comment.js";
import type { Node, Root, Heading } from "mdast";
import { uniqueSlug } from "../markdown/slug.js";
import { collectPlainText as collectText } from "../util/mdast-utils.js";
// 章节 label 正则族单源:SEC_LABEL_RE 定义于 core/cross-ref.ts
import { SEC_LABEL_RE } from "../markdown/cross-ref.js";
// 表格列宽信号:分隔行 dash 比例 → 百分比,纯函数单源 markdown/table-width.ts
import { tableColumnWidthsFromSource } from "../markdown/table-width.js";

/**
 * mdast Data 为声明合并接口:扩展标题的 data.id(本模块解析时写入,
 * docx 书签 / 内部锚点等消费端读取)与 data.secLabel。
 * 属公共契约,勿移除。
 */
declare module "mdast" {
  interface Data {
    id?: string;
    /** 标题行内 label({#sec:label} 尾部后缀;label 不进 slug/标题文本) */
    secLabel?: string;
    /**
      * 表格列宽百分比(分隔行 dash 比例触发阈值时写入,和恒为 100;
     * 未触发/无信号时缺省——消费端 renderTable 按现状等宽布局处理)。
     */
    colWidthsPct?: number[];
  }
}

/**
 * 用 remark + remark-gfm + remark-math + remark-comment 将 markdown 解析为 mdast AST。
 * GFM 提供:表格 / 删除线 / 任务列表(按普通列表处理)。
 * remark-math 提供:inlineMath($..$)与 math(display,$$..$$ / ```math)节点。
 * remark-comment 提供:comment 节点([锚定文本]{批注=内容},见 comment.ts)。
 * 解析后为所有标题生成唯一 id(挂 node.data.id):
 * 公共底座,TOC / docx 书签 / 内部锚点链接共用。
 */
export function parseMarkdown(md: string): Root {
  const ast = remark().use(remarkGfm).use(remarkMath).use(remarkComment).parse(md);
  const seen = new Map<string, number>();
  // 源码行只切一次:标题 slug 与表格列宽信号共用同一行数组
  // (mdast position.line 为 1-based,转 0-based 下标消费)
  const lines = md.split(/\r\n|\n|\r/);
  walkHeadings(ast, seen);
  attachTableWidths(ast, lines);
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

/**
 * 为 table 节点挂 data.colWidthsPct(分隔行 dash 比例触发阈值时)。
 * mdast 不保留分隔行,经 node.position.start.line(表头行,1-based)回读源码
 * 下一行解析;无信号(未触发阈值/非分隔行/无 position)不写 data,
 * 渲染端维持现状等宽布局。pdf 侧不经此路径(markdown-it token.map 同构计算,
 * 见 pdf/rules/table.ts),两侧共用 markdown/table-width.ts 纯函数保证语义对齐。
 */
function attachTableWidths(node: Node, lines: readonly string[]): void {
  if (node.type === "table" && node.position) {
    const pct = tableColumnWidthsFromSource(lines, node.position.start.line - 1);
    if (pct) node.data = { ...node.data, colWidthsPct: pct };
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) attachTableWidths(child, lines);
  }
}
