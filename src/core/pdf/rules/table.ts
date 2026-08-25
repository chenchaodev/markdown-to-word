/**
 * pdf 表格列宽规则(F2 表格列宽控制,B8 规则拆分惯例):
 * GFM 无标准列宽语法,采用分隔行 dash 比例信号(core/markdown/table-width.ts
 * 单源解析,与 docx 侧 parse.ts 同构:表头行号 docx 取 node.position.start.line − 1,
 * 本侧取 table_open token.map[0],均为 0-based 表头行)。
 *
 * 注入方式(Chromium 打印稳定):table_open 挂 style table-layout:fixed,
 * 首行 th_open 挂 width:N%(fixed 布局下列宽由首行单元格决定,无需 colgroup
 * token 注入)。对齐样式(markdown-it 原生 text-align)以「;」拼接保留,不覆盖。
 * 未触发阈值 → 不注入任何样式,行为与旧版完全一致(回归保障)。
 *
 * 实现注意:markdown-it 内置 renderer 对 table_open/th_open 等无默认规则条目
 * (nesting ±1 的 token 走 renderToken 兜底),故此处直接赋规则并显式回调
 * renderer.renderToken 复现默认输出(含闭合 token 尾部换行),不读旧规则。
 */
import type MarkdownIt from "markdown-it";
import { tableColumnWidthsFromSource } from "../../markdown/table-width.js";

/** 结构化最小契约(与 rules/image.ts 同惯例,不直接 import markdown-it Token 类型) */
interface StyleToken {
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}

/** 样式声明追加(「;」拼接;markdown-it attrJoin 是空格拼接,不适用于 style) */
function joinStyle(token: StyleToken, decl: string): void {
  const prev = token.attrGet("style");
  token.attrSet("style", prev ? `${prev};${decl}` : decl);
}

/**
 * 表格列宽规则:渲染期拦截 table_open / th_open。
 * lines 为源码行数组(renderPdfHtml 对 body 一次性 split,行号与 token.map 同源)。
 */
export function overrideTableWidthRule(md: MarkdownIt, lines: readonly string[]): void {
  // 当前表的列宽百分比(GFM 无嵌套表格,单变量即可;每次 table_open 重算,
  // 表外 th_open 不存在,无需 table_close 复位)
  let current: number[] | null = null;
  md.renderer.rules.table_open = (tokens, idx, options) => {
    const tok = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const headerLine = tok.map?.[0];
    current = headerLine === undefined ? null : tableColumnWidthsFromSource(lines, headerLine);
    if (current) joinStyle(tok, "table-layout:fixed");
    return md.renderer.renderToken(tokens, idx, options);
  };
  md.renderer.rules.th_open = (tokens, idx, options) => {
    if (current) {
      // 列下标 = 首行内本 th_open 之前的 th_open 数(表头行只含 th)
      let col = 0;
      for (let i = idx - 1; i >= 0 && tokens[i]!.type !== "tr_open"; i--) {
        if (tokens[i]!.type === "th_open") col++;
      }
      const pct = current[col];
      if (pct !== undefined) joinStyle(tokens[idx]!, `width:${pct}%`);
    }
    return md.renderer.renderToken(tokens, idx, options);
  };
}
