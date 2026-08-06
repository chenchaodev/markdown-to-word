/**
 * 格式注册表:md → 各格式渲染产物(无 IO、无 Electron,便于测试与 CLI 复用)。
 * docx → Buffer;pdf → HTML 文档 + 页码页脚模板(printToPDF 由主进程执行)。
 * 图片等外部资源经 context 注入,保持 core 纯逻辑。
 */
import { parseMarkdown } from "./parse.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { DocMetadata } from "./frontmatter.js";
import { renderDocx } from "./docx/render.js";
import { renderPdfHtml, PDF_FOOTER_TEMPLATE } from "./pdf/render.js";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Root, Node } from "mdast";

export type ConvertFormat = "docx" | "pdf";

/** 页面设置(批次 1:docx section / pdf @page 参数化;单位 mm)。 */
export interface PageSetup {
  paper: "A4" | "A3" | "A5" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** 默认页面设置:近似 Word 默认(A4 纵向,上下 25mm 左右 32mm)。 */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: "A4",
  orientation: "portrait",
  marginTop: 25,
  marginBottom: 25,
  marginLeft: 32,
  marginRight: 32,
};

export interface ConvertContext {
  /** markdown 文件所在目录(图片相对路径基准) */
  baseDir: string;
  /** docx:图片读取回调,返回 null 表示跳过该图 */
  imageResolver?: (src: string) => Promise<Buffer | null>;
  /** 文档标题(pdf 用 <title>) */
  title?: string;
  /** 警告收集器(可选):转换中发现的非致命问题(如缺失图片)追加至此 */
  warnings?: string[];
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
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
  // 先剥离 frontmatter:解析与图片警告检查均只作用于正文(body)
  const { metadata, body } = parseFrontmatter(md);
  const ast = parseMarkdown(body);
  await collectMissingImageWarnings(ast, context.baseDir, warnings);

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
        breakBeforeH1: context.breakBeforeH1,
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
      breakBeforeH1: context.breakBeforeH1,
      title: context.title,
    }),
  };
}
