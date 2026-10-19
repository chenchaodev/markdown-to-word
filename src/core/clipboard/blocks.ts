/**
 * 剪贴板片段的块级结构工具:表格承载的代码块/引用块、GFM 表格外壳、列宽分配。
 *
 * 代码块与引用块**不用** `<pre>` / `<blockquote>`:保真 spike 实测 Word 会丢弃
 * `<pre>` 的 background-color/border,也会丢弃 `<blockquote>` 边框;而单格 `<td>`
 * 上的底色/边框在 Word 与 WPS 两端都保留。`border-left` 也只能挂在 td 上 ——
 * WPS 会对任何块级元素的左边框按行盒逐行画框。
 *
 * 表格宽度一律由调用方传入固定 pt(contentWidthPt),不用 `width:100%`:
 * 实测两端都会溢出。列宽也用 pt —— Word 不认 CSS 百分比列宽。
 *
 * Word 保真的硬性形态(官方文档 + 实测):表格必须同时带 HTML 属性
 * `border="0" cellspacing="0" cellpadding="0"` 与 style 里的
 * `mso-table-layout-alt:fixed`(Word 忽略 `table-layout`)和
 * `mso-table-lspace/rspace:0pt`;单元格的 padding/left-border 另补
 * `mso-padding-alt` / `mso-border-left-alt`,否则 Word 按默认 0.19cm 处理。
 */
import type { TypographySettings } from "../settings/typography.js";
import { escapeHtml } from "../text/text-escape.js";
import {
  blockTableStyle,
  codeCellStyle,
  quoteCellStyle,
  tableStyle,
} from "./styles.js";

/** 代码块/引用块的单格表格开标签(Word 需要的表格属性不能只写在 style 里) */
export function blockTableOpen(widthPt: number): string {
  return `<table border="0" cellspacing="0" cellpadding="0" style="${blockTableStyle(widthPt)}"><tr>`;
}

/** 代码块/引用块的单元格开标签 */
export function codeCellOpen(typography: TypographySettings, widthPt: number): string {
  return `<td style="${codeCellStyle(typography, widthPt)}">`;
}

/** 引用块单元格开标签 */
export function quoteCellOpen(typography: TypographySettings, widthPt: number): string {
  return `<td style="${quoteCellStyle(typography, widthPt)}">`;
}

/** 单格表格闭标签(代码块/引用块共用) */
export function blockTableClose(): string {
  return "</td></tr></table>";
}

/**
 * 代码块 → 单格表格。
 *
 * 内容按行 `escapeHtml` 后用 `<br>` 连接;前导空格原样保留(单元格声明了
 * `white-space:pre-wrap`,实测 Word/WPS 都保留缩进)。末尾换行只剥一个,保留
 * 代码自身有意留出的空行。
 */
export function codeBlockTable(
  text: string,
  widthPt: number,
  typography: TypographySettings,
): string {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const body = lines.map((line) => escapeHtml(line)).join("<br>");
  return `${blockTableOpen(widthPt)}${codeCellOpen(typography, widthPt)}${body}${blockTableClose()}`;
}

/** 引用块开:单格表格 + 左边框单元格;内部段落/列表照常带各自 style */
export function blockquoteOpen(widthPt: number, typography: TypographySettings): string {
  return `${blockTableOpen(widthPt)}${quoteCellOpen(typography, widthPt)}`;
}

/** 引用块闭 */
export function blockquoteClose(): string {
  return blockTableClose();
}

/** GFM 表格外壳(固定 pt 宽 + fixed 布局) */
export function tableOpen(widthPt: number): string {
  return `<table border="0" cellspacing="0" cellpadding="0" style="${tableStyle(widthPt)}">`;
}

/** GFM 表格闭合 */
export function tableClose(): string {
  return "</table>";
}

/**
 * 列宽 pt:源码分隔行有显著 dash 差异时按 `table-width.ts` 的比例换算,
 * 否则按列数均分。末列吸收舍入余数,保证总和恰等于内容区总宽。
 * 不用百分比:Word 对百分比列宽不可靠(见文件头实测约束)。
 */
export function resolveColumnWidths(
  columnCount: number,
  sourceWidths: readonly number[] | null,
  totalWidthPt: number,
): number[] {
  if (columnCount <= 0) return [];
  const ratio = (index: number): number =>
    sourceWidths && sourceWidths.length === columnCount
      ? (sourceWidths[index] ?? 0) / 100
      : 1 / columnCount;
  const widths: number[] = [];
  let used = 0;
  for (let i = 0; i < columnCount; i++) {
    if (i === columnCount - 1) {
      widths.push(Math.round((totalWidthPt - used) * 100) / 100);
    } else {
      const width = Math.round(totalWidthPt * ratio(i) * 100) / 100;
      widths.push(width);
      used += width;
    }
  }
  return widths;
}

/**
 * markdown-it 在 th/td 上写入的 `style="text-align:left"`:只提取白名单值,
 * 不把任意 style 原样搬进输出(避免用户/插件注入非预期属性)。
 */
export function textAlignFromTokenStyle(style: string | null): string | undefined {
  if (!style) return undefined;
  const match = /(?:^|;)\s*text-align\s*:\s*(left|right|center)\b/i.exec(style);
  return match?.[1]?.toLowerCase();
}
