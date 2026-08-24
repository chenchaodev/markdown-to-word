/**
 * 表格块渲染(CORE-5 自 render.ts 拆分):GFM 表格 → docx Table。
 * 单元格行内经 renderPhrasing(表头加粗);列对齐映射见 renderTable 内注释。
 */
import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableRow, WidthType } from "docx";
import type { Table as MdTable } from "mdast";
import { renderPhrasing } from "./content.js";
import { normalizeInlineHtml } from "./inline-html.js";
import type { Ctx } from "../ctx.js";

export async function renderTable(node: MdTable, ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = [];
  for (const [rowIndex, row] of node.children.entries()) {
    const cells: TableCell[] = [];
    for (const [colIndex, cell] of row.children.entries()) {
      const runs = await renderPhrasing(normalizeInlineHtml(cell.children), ctx, rowIndex === 0 ? { bold: true } : {});
      // B3:GFM 列对齐(:--- / :---: / ---:)映射为段落对齐;未声明列(null)保持缺省左对齐
      // (此前 mdast table.align 被忽略,双格式保真不一致:pdf 侧 markdown-it 原生支持)
      const align = node.align?.[colIndex];
      const alignment =
        align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : undefined;
      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: runs,
              ...(alignment ? { alignment } : {}),
            }),
          ],
        }),
      );
    }
    rows.push(new TableRow({ children: cells }));
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows,
  });
}
