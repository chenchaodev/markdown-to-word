import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

/**
 * 用 remark + remark-gfm 将 markdown 解析为 mdast AST。
 * GFM 提供:表格 / 删除线 / 任务列表(按普通列表处理)。
 */
export function parseMarkdown(md: string): Root {
  return remark().use(remarkGfm).parse(md);
}
