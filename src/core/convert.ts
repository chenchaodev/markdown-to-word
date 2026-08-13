/**
 * 格式注册表:md → 各格式渲染产物(无 IO、无 Electron,便于测试与 CLI 复用)。
 * docx → Buffer;pdf → HTML 文档 + 页码页脚模板(printToPDF 由主进程执行)。
 * 图片等外部资源经 context 注入,保持 core 纯逻辑。
 */
import { parseMarkdown } from "./parse.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { DocMetadata } from "./frontmatter.js";
import type { TypographySettings } from "./typography.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfHtml } from "./pdf/render.js";
import { PDF_FOOTER_TEMPLATE } from "./pdf/template.js";
import type { MermaidResolver } from "./mermaid.js";
// 页面设置契约收敛于 settings-defaults.ts(单一来源),此处 re-export 保持既有导入面
// (docx/pdf render、main settings、测试等历史 import 源不变)
export { DEFAULT_PAGE_SETUP, type PageSetup } from "./settings-defaults.js";
import type { PageSetup } from "./settings-defaults.js";

export type ConvertFormat = "docx" | "pdf";

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** docx:图片读取回调,返回 null 表示跳过该图(缺失检查并入此失败路径,单次 IO) */
  imageResolver?: (src: string) => Promise<Buffer | null>;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 警告收集器(可选):转换中发现的非致命问题(如缺失图片)追加至此 */
  warnings?: string[];
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY;docx 与 pdf 双格式共用) */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 自动生成目录页(默认开;docx 静态目录 / PDF 目录同开关) */
  toc?: boolean;
  /** KaTeX 资源目录(pdf 用,见 renderPdfHtml katexDir;docx 走 MathML 不需要) */
  katexDir?: string;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
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
  /** frontmatter 元数据(PDF Info 注入用) */
  metadata?: DocMetadata;
}

export type ConvertArtifact = DocxArtifact | PdfArtifact;

export async function convert(
  md: string,
  format: ConvertFormat,
  context: ConvertContext,
): Promise<ConvertArtifact> {
  const warnings = context.warnings ?? [];
  // 先剥离 frontmatter:解析与渲染均只作用于正文(body)
  const { metadata, body } = parseFrontmatter(md);
  const ast = parseMarkdown(body);

  if (format === "pdf") {
    return {
      kind: "pdf",
      html: await renderPdfHtml(body, {
        baseDir: context.baseDir,
        title: context.title,
        metadata,
        warnings,
        imageResolver: context.imageResolver,
        pageSetup: context.pageSetup,
        typography: context.typography,
        breakBeforeH1: context.breakBeforeH1,
        toc: context.toc,
        katexDir: context.katexDir,
        mermaidResolver: context.mermaidResolver,
      }),
      footerTemplate: PDF_FOOTER_TEMPLATE,
      metadata,
    };
  }
  return {
    kind: "docx",
    buffer: await renderDocx(ast, {
      imageResolver: context.imageResolver,
      metadata,
      warnings,
      pageSetup: context.pageSetup,
      typography: context.typography,
      breakBeforeH1: context.breakBeforeH1,
      toc: context.toc,
      title: context.title,
      mermaidResolver: context.mermaidResolver,
    }),
  };
}
