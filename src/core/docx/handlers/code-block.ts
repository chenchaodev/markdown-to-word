/**
 * 代码块渲染:mermaid 围栏降级、语法高亮与等宽文本兜底。
 * 纯叶子模块(不依赖行内渲染簇),供正文/列表/引用块/脚注定义共用。
 */
import { ImageRun, Paragraph, TextRun } from "docx";
import type { IParagraphOptions } from "docx";
import type { Code } from "mdast";
import { CODE_FONT } from "../theme.js";
import { codeBlockFontSizePt, ptToHalfPoints } from "../../settings/typography.js";
import { highlightCodeRuns } from "./code-highlight.js";
import { highlightFallbackWarning, mermaidEmptyWarning, mermaidFailedWarning } from "../../i18n.js";
import { scaleToFit } from "./image-run.js";
import { MERMAID_LANG } from "../../markdown/mermaid.js";
import { warnDedup, type Ctx } from "../ctx.js";

/** 代码块:mermaid 围栏且有 resolver 时渲染为内嵌 PNG 图片(宽超 IMAGE_MAX_WIDTH 等比缩,
 *  与行内图片共用 scaleToFit);渲染失败(null/抛错)或缺失 resolver 时降级为
 *  等宽文本代码块(行为不变,内容不丢失,与公式降级语义一致)。
 *  已知语言(hljs.getLanguage 命中)走语法高亮(code-highlight.ts,GitHub Light
 *  色板);无语言/未知语言/高亮解析失败 → 等宽文本代码块。
 *  段落装饰(引用块的左缩进 + 底纹)由调用方经 paragraphProps 注入:装饰归容器
 *  语义所有(content.ts renderBlockquote 与其内普通段落共用同一份),代码块
 *  本身不感知所在容器。装饰展开在自带 spacing/indent **之后**——容器缩进须
 *  整体覆盖代码块自身的 360,否则灰底带左缘与同块其他段落错开(灰带只盖一段)。
 *  mermaid 图片段一并带上:图片也是引用块内的一行内容,同样不该断带。 */
export async function renderCode(
  node: Code,
  ctx: Ctx,
  paragraphProps: IParagraphOptions = {},
): Promise<Paragraph> {
  if (node.lang === MERMAID_LANG && ctx.mermaidResolver) {
    try {
      const result = await ctx.mermaidResolver(node.value);
      if (result) {
        const { width, height } = scaleToFit(result.width, result.height);
        return new Paragraph({
          ...paragraphProps,
          children: [new ImageRun({ type: "png", data: result.png, transformation: { width, height } })],
        });
      }
      ctx.warning.list?.push(mermaidEmptyWarning());
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ctx.warning.list?.push(mermaidFailedWarning(reason));
    }
  }
  // 代码块字号:由正文字号推导(单源 codeBlockFontSizePt),highlights 路径与
  // 等宽兜底路径共用同一取值 —— 两条路径曾各读 theme 常量,故换算只在此处做一次
  const size = ptToHalfPoints(codeBlockFontSizePt(ctx.config.typography.bodySizePt));
  // 语言已知但高亮失败(hljs 抛错/解析校验失败)→ 上报降级警告
  // (无语言/未知语言的正常降级不警告);warnDedup 按语言去重
  const highlighted = highlightCodeRuns(node.value, node.lang ?? undefined, size, (lang) => {
    warnDedup(ctx, highlightFallbackWarning(lang));
  });
  if (highlighted) {
    return new Paragraph({
      spacing: { before: 120, after: 120 },
      indent: { left: 360 },
      ...paragraphProps,
      children: highlighted,
    });
  }
  const lines = node.value.split("\n");
  const children: TextRun[] = [];
  lines.forEach((line, i) => {
    children.push(new TextRun({ text: line, font: CODE_FONT, size }));
    if (i < lines.length - 1) children.push(new TextRun({ text: "", break: 1 }));
  });
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    indent: { left: 360 },
    ...paragraphProps,
    children,
  });
}
