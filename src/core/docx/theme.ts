import type { IStylesOptions } from "docx";

/**
 * 字体集中配置(硬约束:中文 eastAsia 统一在此,不散落硬编码)。
 * docx 库传对象字体时会写全 ascii / hAnsi / eastAsia / cs 四属性,
 * 中文显示由 eastAsia 决定。
 */
export const DEFAULT_FONT = {
  ascii: "Calibri",
  eastAsia: "微软雅黑",
  hAnsi: "Calibri",
} as const;

/** 代码块 / 行内代码的等宽字体 */
export const CODE_FONT = "Consolas";

/** 正文默认字号:24 half-points = 12pt */
export const DEFAULT_SIZE = 24;

/** 代码字号:20 half-points = 10pt */
export const CODE_SIZE = 20;

/** 引用块文字灰色 */
export const QUOTE_COLOR = "595959";

/** 链接蓝色 */
export const LINK_COLOR = "0563C1";

/**
 * 默认文档样式:Normal 全局挂 DEFAULT_FONT,保证全文中文字体统一。
 */
export function createDefaultStyles(): IStylesOptions {
  return {
    default: {
      document: {
        run: {
          font: { ...DEFAULT_FONT },
          size: DEFAULT_SIZE,
        },
      },
    },
  };
}
