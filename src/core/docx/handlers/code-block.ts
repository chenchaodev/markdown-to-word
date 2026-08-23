/**
 * 代码块渲染(B8 拆分):mermaid 围栏降级、语法高亮与等宽文本兜底。
 * 纯叶子模块(不依赖行内渲染簇),供正文/列表/引用块/脚注定义共用。
 */
import { ImageRun, Paragraph, TextRun } from "docx";
import type { Code } from "mdast";
import { CODE_FONT, CODE_SIZE } from "../theme.js";
import { highlightCodeRuns } from "./code-highlight.js";
import { highlightFallbackWarning } from "../../i18n.js";
import { scaleToFit } from "./image-run.js";
import { warnDedup, type Ctx } from "../ctx.js";

/** 代码块:mermaid 围栏且有 resolver 时渲染为内嵌 PNG 图片(宽超 IMAGE_MAX_WIDTH 等比缩,
 *  与行内图片共用 scaleToFit);渲染失败(null/抛错)或缺失 resolver 时降级为
 *  等宽文本代码块(行为不变,内容不丢失,与公式降级语义一致)。
 *  已知语言(hljs.getLanguage 命中)走语法高亮(code-highlight.ts,GitHub Light
 *  色板);无语言/未知语言/高亮解析失败 → 等宽文本代码块。 */
export async function renderCode(node: Code, ctx: Ctx): Promise<Paragraph> {
  if (node.lang === "mermaid" && ctx.mermaidResolver) {
    try {
      const result = await ctx.mermaidResolver(node.value);
      if (result) {
        const { width, height } = scaleToFit(result.width, result.height);
        return new Paragraph({
          children: [new ImageRun({ type: "png", data: result.png, transformation: { width, height } })],
        });
      }
      ctx.warnings?.push({
        key: "warn.mermaidEmpty",
        fallback: "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ctx.warnings?.push({
        key: "warn.mermaidFailed",
        params: { reason },
        fallback: `Mermaid 渲染失败: ${reason},已降级为代码块`,
      });
    }
  }
  // B4:语言已知但高亮失败(hljs 抛错/解析校验失败)→ 上报降级警告
  // (无语言/未知语言的正常降级不警告);warnDedup 按语言去重
  const highlighted = highlightCodeRuns(node.value, node.lang ?? undefined, (lang) => {
    warnDedup(ctx, highlightFallbackWarning(lang));
  });
  if (highlighted) {
    return new Paragraph({
      spacing: { before: 120, after: 120 },
      indent: { left: 360 },
      children: highlighted,
    });
  }
  const lines = node.value.split("\n");
  const children: TextRun[] = [];
  lines.forEach((line, i) => {
    children.push(new TextRun({ text: line, font: CODE_FONT, size: CODE_SIZE }));
    if (i < lines.length - 1) children.push(new TextRun({ text: "", break: 1 }));
  });
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    indent: { left: 360 },
    children,
  });
}
