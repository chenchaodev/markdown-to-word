/**
 * 表格列宽信号解析(纯模块零运行时导入):
 * GFM 无标准列宽语法,采用 Pandoc pipe-tables 行为——分隔行各单元格 dash 数
 * 比例作为列宽信号。docx(mdast position)/pdf(markdown-it token.map)两侧
 * 共用同一实现,保证双管线语义对齐。
 *
 * 语义(与消费方约定):
 * - 对齐冒号不计入 dash 数(`:---:` 按 3 个 dash 计);
 * - 触发阈值:最大 dash / 最小 dash ≥ 3 且至少一列 ≥ 5 个 dash;
 *   不满足(dash 数相同或都很少)→ 返回 null,维持现状等宽/自动布局(回归保障);
 * - 满足阈值 → 按比例返回整数百分比数组(和恒为 100:前 n-1 列四舍五入,
 *   末列吸收余数);
 * - 非分隔行(含普通表格内容行/转义管道等)→ parseDelimiterRow 返回 null,
 *   调用方按无信号处理。
 */

/** 触发比例宽度的单列最小 dash 数(至少一列达到该值) */
export const TABLE_WIDTH_MIN_MAX_DASHES = 5;
/** 最大/最小 dash 数比例阈值(≥ 该值才视为「差异显著」) */
export const TABLE_WIDTH_RATIO_THRESHOLD = 3;

/** 分隔行单元格形态:`---` / `:---` / `---:` / `:---:`(容忍空白) */
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;

/**
 * 从分隔行文本解析各列 dash 数(冒号不计)。非分隔行返回 null:
 * - 不含管道符 / 单元格不全是 `:?-+:?` 形态(如内容行、`| --- | :-- | 文字 |`);
 * - 空单元格(连续管道)同样非法。
 */
export function parseDelimiterRow(line: string): number[] | null {
  let t = line.trim();
  if (!t.includes("|")) return null;
  // 剥除首尾包裹管道(GFM 允许省略;转义管道 \| 在分隔行无合法语义,剥尾部时
  // 不特判——`\|` 结尾会使末单元格形如 `-+:\` 不匹配 DELIM_CELL_RE 而整体判 null)
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  const cells = t.split("|");
  if (cells.length === 0) return null;
  const dashes: number[] = [];
  for (const cell of cells) {
    if (!DELIM_CELL_RE.test(cell)) return null;
    dashes.push((cell.match(/-/g) ?? []).length);
  }
  return dashes;
}

/**
 * dash 数 → 列宽百分比数组(和 = 100);不满足触发阈值返回 null。
 * 阈值:max ≥ TABLE_WIDTH_MIN_MAX_DASHES 且 max ≥ min × TABLE_WIDTH_RATIO_THRESHOLD。
 * 取整:前 n-1 列 Math.round,末列 = 100 − 前缀和(保证总和恰为 100)。
 */
export function delimiterWidthsPercent(dashes: readonly number[]): number[] | null {
  const n = dashes.length;
  if (n === 0) return null;
  const max = Math.max(...dashes);
  const min = Math.min(...dashes);
  if (max < TABLE_WIDTH_MIN_MAX_DASHES || max < min * TABLE_WIDTH_RATIO_THRESHOLD) return null;
  const total = dashes.reduce((sum, d) => sum + d, 0);
  const pct: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      const v = Math.round((dashes[i]! / total) * 100);
      pct.push(v);
      acc += v;
    } else {
      pct.push(100 - acc);
    }
  }
  return pct;
}

/**
 * 源码行 + 表头行号(0-based)→ 列宽百分比;无信号返回 null。
 * 分隔行约定在表头行的下一行(GFM 结构保证);越界/非分隔行均按无信号处理。
 * docx 侧传 node.position.start.line − 1,pdf 侧传 table_open token.map[0]。
 */
export function tableColumnWidthsFromSource(
  lines: readonly string[],
  headerLineIndex: number,
): number[] | null {
  const delim = lines[headerLineIndex + 1];
  if (delim === undefined) return null;
  const dashes = parseDelimiterRow(delim);
  return dashes ? delimiterWidthsPercent(dashes) : null;
}
