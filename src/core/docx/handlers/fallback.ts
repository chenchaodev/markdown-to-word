/**
 * 容器内降级渲染:列表项/引用块内不完整支持的块级内容的
 * 降级输出与警告。纯叶子模块(不依赖行内渲染簇)。
 * 公式不在此列:容器内公式由 equations.ts renderContainerMath 正常渲染为
 * Office MathML(仅 KaTeX 真解析失败才降级 TeX 源码,那是公式自身的兜底)。
 */
import { PageBreak, Paragraph, TextRun } from "docx";
import type { IParagraphOptions } from "docx";
import type { Html as MdHtml, Table as MdTable } from "mdast";
import type { KeyedWarning } from "../../i18n/index.js";
import { CODE_FONT, MUTED_TEXT_GRAY } from "../theme.js";
import { collectPlainText } from "../../text/mdast-utils.js";
import { isAllowedInlineHtml, parseAllowedContainer, stripUnsupportedHtml } from "../../markdown/html-whitelist.js";
import { renderContainerParagraph, renderInlineHtmlParagraph } from "./inline-html.js";
import { warnDedup, type Ctx } from "../ctx.js";

/**
 * 容器内不支持块级的降级警告:blockType/container 为中文类别词
 * (推送期无法按显示语言翻译,en 文案保留插值定位,同 warn.crossRefNotFound 口径);
 * 经 warnDedup 去重(同类型同容器只报一次)。
 */
export function unsupportedBlockWarning(blockType: string, container: string): KeyedWarning {
  return {
    key: "warn.unsupportedBlockInContainer",
    params: { blockType, container },
    fallback: `${blockType} 在${container}内暂不支持,已降级为文本`,
  };
}

/** 容器内降级文本段落:等宽灰字(与顶层公式解析失败降级同款样式)。
 *  paragraphProps 为所在容器注入的段落装饰(引用块 = 左缩进 + 底纹),
 *  装饰归容器语义所有,本降级通道只负责透传。 */
function fallbackTextParagraph(text: string, paragraphProps: IParagraphOptions = {}): Paragraph {
  return new Paragraph({
    ...paragraphProps,
    children: [new TextRun({ text, font: CODE_FONT, color: MUTED_TEXT_GRAY })],
  });
}

/**
 * 列表项/引用块内不完整支持的块级内容降级渲染(此前静默丢弃,内容丢失):
 * - html → 分页注释照常分页;对齐容器(div/p 的 align)与白名单行内标签照常渲染;
 *   其余标签剥掉、文本保留,按等宽降级段落输出 + 警告(容器/属性仍属降级);
 * - 表格 → 逐行文本段落(单元格纯文本以「 | 」连接)+ 警告。
 * 代码块由调用方处理(列表内既有 renderCode 路径;引用块内补齐为同款);
 * 公式由 equations.ts renderContainerMath 正常渲染,不经本降级通道。
 * paragraphProps:所在容器注入的段落装饰(引用块 = 左缩进 + 底纹,与其内普通
 * 段落同一份)。表格逐行段与 html 降级段一并带上,免得灰底带只盖住引用块内的
 * 一部分内容(公式/段落有装饰、表格/代码块无装饰的断带形态)。唯一例外:
 * - 分页注释段是版式标记而非块内内容,不上装饰(否则新页页首留一条无内容灰带);
 * - 容器/白名单行内段经 renderContainerParagraph / renderInlineHtmlParagraph 的
 *   paragraphProps 透传同一份装饰,故容器内此类段与相邻段一致。
 */
export async function renderContainerFallback(
  node: MdHtml | MdTable,
  ctx: Ctx,
  container: string,
  paragraphProps: IParagraphOptions = {},
): Promise<Paragraph[]> {
  switch (node.type) {
    case "html": {
      const value = node.value.trim();
      if (value === "<!-- page-break -->") {
        return [new Paragraph({ children: [new PageBreak()] })];
      }
      // 对齐容器:与顶层同一路径,align 覆盖正文默认值,引用块装饰经 paragraphProps 透传
      const allowedContainer = parseAllowedContainer(value);
      if (allowedContainer !== null) {
        return [renderContainerParagraph(allowedContainer, ctx, paragraphProps)];
      }
      if (isAllowedInlineHtml(value)) {
        return [renderInlineHtmlParagraph(node.value, ctx, paragraphProps)];
      }
      // 白名单外 html:剥标签留文本;剥完为空(如脚本/样式段)则不产出空段
      const stripped = stripUnsupportedHtml(node.value);
      if (stripped.trim() === "") return [];
      warnDedup(ctx, unsupportedBlockWarning("HTML", container));
      return [fallbackTextParagraph(stripped, paragraphProps)];
    }
    case "table": {
      warnDedup(ctx, unsupportedBlockWarning("表格", container));
      return node.children.map((row) =>
        new Paragraph({
          ...paragraphProps,
          children: [
            new TextRun({ text: row.children.map((cell) => collectPlainText(cell)).join(" | ") }),
          ],
        }),
      );
    }
  }
}
