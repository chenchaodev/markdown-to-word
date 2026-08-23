/**
 * 容器内降级渲染(B8 拆分):列表项/引用块内不完整支持的块级内容的
 * 降级输出与警告。纯叶子模块(不依赖行内渲染簇)。
 */
import { PageBreak, Paragraph, TextRun } from "docx";
import type { Html as MdHtml, Table as MdTable } from "mdast";
import type { BlockContent } from "mdast";
import type { KeyedWarning } from "../i18n.js";
import { CODE_FONT, MUTED_TEXT_GRAY } from "./theme.js";
import { collectPlainText } from "../mdast-utils.js";
import { isAllowedInlineHtml } from "../html-whitelist.js";
import { renderInlineHtmlParagraph } from "./inline-html.js";
import { warnDedup, type Ctx } from "./ctx.js";

/**
 * 容器内不支持块级的降级警告(B4 失败可见性):blockType/container 为中文类别词
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

/** 容器内降级文本段落:等宽灰字(与顶层公式解析失败降级同款样式) */
function fallbackTextParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: CODE_FONT, color: MUTED_TEXT_GRAY })],
  });
}

/** mdast math 节点(display 公式;经 remark-math/mdast-util-math 扩充进 BlockContent,
 *  与 equations.ts 同一取型方式) */
type MdMath = Extract<BlockContent, { type: "math" }>;

/**
 * B4:列表项/引用块内不完整支持的块级内容降级渲染(此前静默丢弃,内容丢失):
 * - 公式(math)→ TeX 源码等宽灰字 + 警告;
 * - html → 分页注释照常分页、白名单行内标签照常渲染,其余原样等宽文本 + 警告;
 * - 表格 → 逐行文本段落(单元格纯文本以「 | 」连接)+ 警告。
 * 代码块由调用方处理(列表内既有 renderCode 路径;引用块内补齐为同款)。
 */
export async function renderContainerFallback(
  node: MdMath | MdHtml | MdTable,
  ctx: Ctx,
  container: string,
): Promise<Paragraph[]> {
  switch (node.type) {
    case "math":
      warnDedup(ctx, unsupportedBlockWarning("公式", container));
      return [fallbackTextParagraph(node.value)];
    case "html": {
      const value = node.value.trim();
      if (value === "<!-- page-break -->") {
        return [new Paragraph({ children: [new PageBreak()] })];
      }
      if (isAllowedInlineHtml(value)) {
        return [renderInlineHtmlParagraph(node.value, ctx)];
      }
      warnDedup(ctx, unsupportedBlockWarning("HTML", container));
      return [fallbackTextParagraph(node.value)];
    }
    case "table": {
      warnDedup(ctx, unsupportedBlockWarning("表格", container));
      return node.children.map((row) =>
        new Paragraph({
          children: [
            new TextRun({ text: row.children.map((cell) => collectPlainText(cell)).join(" | ") }),
          ],
        }),
      );
    }
  }
}
