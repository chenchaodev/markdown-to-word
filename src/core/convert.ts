/**
 * 格式注册表:md → 各格式渲染产物(无 IO、无 Electron,便于测试与 CLI 复用)。
 * docx → Buffer;pdf → HTML 文档 + 页码页脚模板(printToPDF 由主进程执行)。
 * 图片等外部资源经 context 注入,保持 core 纯逻辑。
 */
import { parseMarkdown } from "./parse.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfHtml, PDF_FOOTER_TEMPLATE } from "./pdf/render.js";

export type ConvertFormat = "docx" | "pdf";

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** docx:图片读取回调,返回 null 表示跳过该图 */
  imageResolver?: (src: string) => Promise<Buffer | null>;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
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
  const ast = parseMarkdown(md);
  return {
    kind: "docx",
    buffer: await renderDocx(ast, {
      imageResolver: context.imageResolver,
    }),
  };
}
