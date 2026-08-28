/**
 * docx numbering 配置:列表编号与标题章节编号的 INumberingOptions 构造。
 * 纯配置工厂,无 AST/ctx 依赖。
 * 不变量:标题编号模板(%1.%2.%3)与 prescan 的静态章节号计数(heading-numbering.ts)
 * 语义对齐——变更编号格式须同步该模块口径。
 */
import { AlignmentType } from "docx";
import type { INumberingOptions } from "docx";

/** 列表编号配置:bullet 与 decimal 各一套,0-3 级缩进(docx 9.x:Document 直接收 INumberingOptions) */
export function numberingOptions(): INumberingOptions {
  const bulletText = ["•", "◦", "▪"];
  const levels = (ordered: boolean) =>
    [0, 1, 2, 3].map((level) => ({
      level,
      format: ordered ? ("decimal" as const) : ("bullet" as const),
      text: ordered ? `%${level + 1}.` : bulletText[level % bulletText.length],
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: { left: 720 * (level + 1), hanging: 360 },
        },
      },
    }));
  return {
    config: [
      { reference: "md-list-bullet", levels: levels(false) },
      { reference: "md-list-number", levels: levels(true) },
    ],
  };
}

/** 标题章节编号:h1-h3 挂段落级 numbering(静态渲染,打开 Word/WPS 无需更新域即显示) */
export function headingNumberingOptions(): INumberingOptions {
  const textFor = (level: number): string =>
    Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join(".");
  const levels = [0, 1, 2].map((level) => ({
    level,
    format: "decimal" as const,
    text: textFor(level),
    alignment: AlignmentType.LEFT,
    start: 1,
    style: {
      paragraph: {
        indent: { left: 360, hanging: 360 },
      },
    },
  }));
  return { config: [{ reference: "md-heading", levels }] };
}
