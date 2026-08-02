/**
 * 格式注册表:md → 各格式渲染产物(无 IO、无 Electron,便于测试与 CLI 复用)。
 * docx → Buffer;pdf → HTML 文档 + 页码页脚模板(printToPDF 由主进程执行)。
 * 图片等外部资源经 context 注入,保持 core 纯逻辑。
 */
import { parseMarkdown } from "./parse.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfHtml, PDF_FOOTER_TEMPLATE } from "./pdf/render.js";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Root, Node } from "mdast";

export type ConvertFormat = "docx" | "pdf";

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** docx:图片读取回调,返回 null 表示跳过该图 */
  imageResolver?: (src: string) => Promise<Buffer | null>;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 警告收集器(可选):转换中发现的非致命问题(如缺失图片)追加至此 */
  warnings?: string[];
}

/**
 * 遍历 mdast 检查本地图片是否存在,缺失的追加警告文案到 warnings。
 * 跳过 http(s)/data: 开头的远程或内嵌图片;异步 stat 并行执行。
 */
async function collectMissingImageWarnings(
  ast: Root,
  baseDir: string,
  warnings: string[],
): Promise<void> {
  const checks: Promise<void>[] = [];
  const walk = (node: Node): void => {
    if (node.type === "image") {
      const src = (node as { url?: string }).url;
      if (!src || /^(https?:|data:)/i.test(src)) return;
      checks.push(
        stat(path.resolve(baseDir, src)).then(
          () => undefined,
          () => {
            warnings.push(`缺少图片文件: ${src}`);
          },
        ),
      );
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(ast);
  await Promise.all(checks);
}

export interface DocxArtifact {
  kind: "docx";
  /** 可直接落盘的 .docx 文件内容 */
  buffer: Buffer;
}

export interface PdfArtifact {
  kind: "pdf";
  /** 完整 HTML 文档,落盘临时文件后 loadFile + printToPDF */
  html: string;
  /** printToPDF 的 footerTemplate(页码) */
  footerTemplate: string;
}

export type ConvertArtifact = DocxArtifact | PdfArtifact;

export async function convert(
  md: string,
  format: ConvertFormat,
  context: ConvertContext,
): Promise<ConvertArtifact> {
  const warnings = context.warnings ?? [];
  const ast = parseMarkdown(md);
  await collectMissingImageWarnings(ast, context.baseDir, warnings);

  if (format === "pdf") {
    return {
      kind: "pdf",
      html: await renderPdfHtml(md, {
        baseDir: context.baseDir,
        title: context.title,
      }),
      footerTemplate: PDF_FOOTER_TEMPLATE,
    };
  }
  return {
    kind: "docx",
    buffer: await renderDocx(ast, {
      imageResolver: context.imageResolver,
    }),
  };
}
