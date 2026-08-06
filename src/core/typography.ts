/**
 * 排版设置契约(core 侧定义;主进程 settings.ts 持久化,renderer 侧有平行定义
 * ——进程隔离不共享,字段名/默认值任一侧改动必须同步另一侧,勿单独修改)。
 * 应用范围:docx styles.default 与普通正文段落、PDF 模板 CSS(body/正文段落)。
 */

export interface TypographySettings {
  /** 西文字体,默认 "Calibri" */
  fontAscii: string;
  /** 中文字体,默认 "微软雅黑" */
  fontEastAsia: string;
  /** 正文字号 pt,默认 12 */
  bodySizePt: number;
  /** 行距倍数,默认 1.5 */
  lineSpacing: number;
  /** 首行缩进 2 字符,默认 true */
  firstLineIndent: boolean;
  /** 正文对齐,默认 "justify" */
  align: "left" | "justify";
  /** 章节自动编号,默认 true */
  headingNumbering: boolean;
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontAscii: "Calibri",
  fontEastAsia: "微软雅黑",
  bodySizePt: 12,
  lineSpacing: 1.5,
  firstLineIndent: true,
  align: "justify",
  headingNumbering: true,
};
