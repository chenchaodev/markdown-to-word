/**
 * 表格块渲染:GFM 表格 → docx Table。
 * 单元格行内经 renderPhrasing(表头加粗);列对齐映射见 renderTable 内注释。
 * 列宽控制:解析期挂 data.colWidthsPct(见 pipeline/parse.ts)时按比例生成
 * tblGrid(gridCol,DXA)+ 固定布局 + 单元格 tcW;无信号时行为与旧版完全一致
 * (不产 tblGrid、自动布局)。
 * 双管线对应:src/core/pdf/rules/table.ts(列宽注入);列宽信号解析单源
 * core/markdown/table-width.ts(本侧 parse.ts 读源码行,pdf 侧读 token.map 表头行,
 * 其头注载明同构口径)。差异:边框本侧 six-side borders 黑线(theme.ts
 * TABLE_BORDER_BLACK),pdf 侧走模板 CSS #d0d7de(theme.ts 注:双管线观感既有差异,
 * 勿混改)。修改列宽信号/列对齐语义须同步核对 src/core/pdf/rules/table.ts。
 */
import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableLayoutType, TableRow, WidthType } from "docx";
import type { Table as MdTable } from "mdast";
import { renderPhrasing } from "./content.js";
import { normalizeInlineHtml } from "./inline-html.js";
import { TABLE_BORDER_BLACK } from "../theme.js";
import type { Ctx } from "../ctx.js";

export async function renderTable(node: MdTable, ctx: Ctx): Promise<Table> {
  // 列宽百分比(和=100)→ DXA(1px = 15 twips,contentWidthPx 与页面几何
  // 同源)。末列吸收取整余量,保证 gridCol 合计恰为内容区总宽。
  const pcts = node.data?.colWidthsPct;
  const totalDxa = Math.round(ctx.contentWidthPx * 15);
  const colDxa = pcts
    ? pcts.map((p, i) =>
        i < pcts.length - 1 ? Math.round((totalDxa * p) / 100) : totalDxa - sumPrev(pcts, totalDxa),
      )
    : undefined;
  const rows: TableRow[] = [];
  for (const [rowIndex, row] of node.children.entries()) {
    const cells: TableCell[] = [];
    for (const [colIndex, cell] of row.children.entries()) {
      const runs = await renderPhrasing(normalizeInlineHtml(cell.children), ctx, rowIndex === 0 ? { bold: true } : {});
      // GFM 列对齐(:--- / :---: / ---:)映射为段落对齐;未声明列(null)保持缺省左对齐
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
          // 单元格宽与 gridCol 同步(固定布局下列宽以网格为准,tcW 保持一致防歧义)
          ...(colDxa ? { width: { size: colDxa[colIndex]!, type: WidthType.DXA } } : {}),
        }),
      );
    }
    rows.push(new TableRow({ children: cells }));
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_BLACK };
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
    // 比例宽度信号存在时才写 tblGrid + 固定布局;缺省不写(等宽/自动布局回归保障)
    ...(colDxa ? { columnWidths: colDxa, layout: TableLayoutType.FIXED } : {}),
    rows,
  });
}

/** 前 n-1 列 DXA 取整和(末列 = 总宽 − 该值,合计守恒) */
function sumPrev(pcts: readonly number[], totalDxa: number): number {
  let sum = 0;
  for (let i = 0; i < pcts.length - 1; i++) sum += Math.round((totalDxa * pcts[i]!) / 100);
  return sum;
}
