/**
 * 单文件转换实现(目录重组批⑤自 converter.ts 拆出):
 * 读取 md → core 渲染 → 落盘 / printToPDF → 书签/元数据注入 → 导出后行为。
 * renderPdf/runAfterConvert 供 batch/merge 复用(模块内导出,不经桶导出对外)。
 */
import { BrowserWindow, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { convert, type ConvertFormat, type PdfArtifact } from "../../core/convert.js";
import { decodeMarkdown } from "../../core/util/encoding.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { t } from "../../core/i18n.js";
import { buildBookmarkTree, injectBookmarks, pageNumbersForNames } from "../../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../../core/pdf/metadata.js";
import { extractHeadings, injectTocPageNumbers } from "../../core/pdf/postprocess.js";
import { PDFDocument } from "pdf-lib";
import { renderMermaid } from "../services/mermaid-service.js";
import { loadSettings, type AppSettings } from "../persist/settings.js";
import { hardenWebContents } from "../services/web-hardening.js";
import { writeTempHtml } from "../services/temp-html.js";
import {
  buildConvertContext,
  createConvertContext,
  getImageResolver,
  throwIfCanceled,
  type ConvertContext,
} from "./context.js";
import { MARKDOWN_EXT_RE, resolveOutputPath, stripMarkdownExt } from "./paths.js";
import { preprocessMarkdown } from "./preprocess.js";

/**
 * GBK 解码 + 警告收集(MR-6 自 convertImpl/mergeConvertImpl 同构样板抽出):
 * 读文件 → decodeMarkdown;GBK 编码时向共享 warnings 追加警告(gbkKey 由调用方
 * 给定:单文件 warn.gbkEncoding / 合并逐文件 warn.gbkEncodingFile+文件名参数)。
 */
export async function readMarkdownDecoded(
  filePath: string,
  warnings: ConvertWarning[],
  gbkKey: "warn.gbkEncoding" | "warn.gbkEncodingFile",
): Promise<string> {
  const { text, encoding } = decodeMarkdown(await fs.readFile(filePath));
  if (encoding === "gbk") {
    warnings.push(
      gbkKey === "warn.gbkEncodingFile"
        ? {
            key: gbkKey,
            params: { file: path.basename(filePath) },
            fallback: `已按 GBK 编码读取:${path.basename(filePath)}`,
          }
        : { key: gbkKey, fallback: "已按 GBK 编码读取:文件编码非 UTF-8" },
    );
  }
  return text;
}

/**
 * 渲染产物落盘收尾(MR-6 自 convertImpl/mergeConvertImpl 同构尾部抽出):
 * 解析输出路径(重名序号/超长回落)→ docx 直接写盘 / pdf 经隐藏窗口 printToPDF
 * → onProgress("done")。导出后行为(runAfterConvert)仍由调用方按各自语义执行。
 */
export async function persistArtifact(
  artifact: PdfArtifact | { kind: "docx"; buffer: Uint8Array },
  sourcePath: string,
  format: ConvertFormat,
  outputDir: string,
  ctx: ConvertContext,
  onProgress?: (stage: string) => void,
  baseName?: string,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const { outputPath, warnings } = await resolveOutputPath(sourcePath, format, outputDir, baseName);
  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
  } else {
    // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘(与合并共用 renderPdf;print 阶段在内部上报)
    await renderPdf(artifact, outputPath, ctx, onProgress);
    onProgress?.("done");
  }
  return { outputPath, warnings };
}

/**
 * 转换实现:读取 md → core 注册表渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于冒烟自测与未来 CLI 复用;进度经 onProgress 上报。
 * pdf 链路:core 产出 HTML → 写临时文件 → 隐藏窗口 loadFile → printToPDF。
 * 取消:ctx 默认新建(「取消后复位」语义);skipAfterConvert 经 ctx 携带(见 ConvertContext)。
 * katexDir(pdf 公式资源目录)由调用方(main 入口层)传入,本函数不依赖 electron app。
 */
export async function convertImpl(
  filePath: string,
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  if (!MARKDOWN_EXT_RE.test(filePath)) {
    // 生成期本地化(B6 决策):throw 文案经 error.message 单次字符串通道到 GUI,
    // 显示层无法重映射,只能在抛出点用 t()(main 进程启动时已 setLanguage)。
    throw new Error(t("file.onlyMarkdown"));
  }
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  onProgress?.("read");
  const warnings: ConvertWarning[] = [];
  const rawMd = await readMarkdownDecoded(filePath, warnings, "warn.gbkEncoding");
  // B1/C1:转换前文本预处理(AI 清理 / Obsidian 兼容),按设置开关组合
  const md = preprocessMarkdown(rawMd, settings);

  // B9 进度分阶段:docx 沿用粗粒度 render;pdf 由 core 经 onStage 细分
  // parse/inline/mermaid/katex,print 在 renderPdf 内 printToPDF 前上报
  if (format === "docx") onProgress?.("render");
  const artifact = await convert(
    md,
    format,
    await buildConvertContext({
      baseDir: path.dirname(filePath),
      title: stripMarkdownExt(path.basename(filePath)),
      warnings,
      settings,
      // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重;按 baseDir 跨文件共享
      imageResolver: getImageResolver(path.dirname(filePath)),
      katexDir,
      // Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约,失败返回 null 由 core 降级)
      mermaidResolver: renderMermaid,
      ...(format === "pdf" ? { onStage: (stage: string) => onProgress?.(stage) } : {}),
    }),
  );
  throwIfCanceled(ctx);

  const { outputPath, warnings: outWarnings } = await persistArtifact(
    artifact,
    filePath,
    format,
    settings.outputDir,
    ctx,
    onProgress,
  );
  warnings.push(...outWarnings);

  if (!ctx.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
  return { outputPath, warnings };
}

/**
 * pdf 产物落盘:临时 HTML → 隐藏窗口 printToPDF → 写输出文件。
 * 单文件/合并共用;临时文件与窗口在 finally 中清理,失败也会销毁窗口。
 * B9:onStage(可选)在 printToPDF 前上报 "print" 阶段(printToPDF 不可中断,
 * renderer 据此置灰取消按钮 + 显示「正在写入 PDF…」)。
 */
export async function renderPdf(
  artifact: PdfArtifact,
  outputPath: string,
  ctx: ConvertContext,
  onStage?: (stage: string) => void,
): Promise<void> {
  // 单遍打印:写临时 HTML → 隐藏窗口加载 → printToPDF → 返回 bytes(窗口/临时文件 finally 清理)
  const printOnce = async (html: string): Promise<Uint8Array> => {
    const { htmlPath, cleanup } = await writeTempHtml(html);
    const printWin = new BrowserWindow({
      show: false,
      // MR-13:webPreferences 全显式(与 mermaid-service 对齐;默认值虽安全,显式防漂移)
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    hardenWebContents(printWin); // B1:打印窗口与预览同源加固(内容含用户 markdown 渲染的链接)
    try {
      throwIfCanceled(ctx); // 批次 7:打印前检查(loadFile/字体等待期间用户可能已取消)
      onStage?.("print"); // B9:进入不可中断的打印/写盘阶段
      await printWin.loadFile(htmlPath);
      // 批次 6:等待公式字体(KaTeX woff2)加载完成再打印,否则 printToPDF 缺字形
      await printWin.webContents.executeJavaScript("document.fonts.ready");
      throwIfCanceled(ctx); // 批次 7:打印前复查(大文档字体等待可长达数秒)
      return await printWin.webContents.printToPDF({
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        // F4:页眉模板随设置注入(default/none = 空 span 占位,维持现状无页眉);
        // ?? 兜底旧调用方手工构造的 PdfArtifact(无 headerTemplate 字段)
        headerTemplate: artifact.headerTemplate ?? "<span></span>",
        footerTemplate: artifact.footerTemplate,
      });
    } finally {
      printWin.destroy();
      await cleanup();
    }
  };
  // 批次 4:从渲染后 HTML 提取标题(与目录同源,封面/目录本身非 h 标签不受影响),
  // 注入 PDF 书签大纲(读 /Dests 命名目标,标题 id 即命名目标名,无需文本定位)。
  const headings = extractHeadings(artifact.html);
  // F7-②:field 模式 → 两遍法注入目录页码(第一遍打印解析 /Dests 定位标题页码,
  // 第二遍注入页码重印;TOC 后硬分页符保证正文分页一致、页码准确)
  let data = await printOnce(artifact.html);
  if (artifact.tocMode === "field" && headings.length > 0) {
    const doc = await PDFDocument.load(new Uint8Array(data));
    const pageNumbers = pageNumbersForNames(doc, headings.map((h) => h.id));
    data = await printOnce(injectTocPageNumbers(artifact.html, pageNumbers));
  }
  // 批次 7:printToPDF 不可中断(Electron 原子调用),取消需等本轮打印结束;
  // 但落盘/书签/元数据必须中止 → 打印后立即检查,取消则不产出文件、不报成功。
  throwIfCanceled(ctx);
  const bookmarked =
    headings.length > 0
      ? await injectBookmarks(new Uint8Array(data), buildBookmarkTree(headings))
      : new Uint8Array(data);
  // 批次 5c:书签注入之后追加 PDF Info 元数据注入(frontmatter title/author/date → 文档属性)。
  // 顺序固定:书签 → 元数据(后者经 pdf-lib 整体重存,必须最后执行,否则会丢弃书签)。
  const output = await setPdfMetadata(bookmarked, artifact.metadata);
  await fs.writeFile(outputPath, output);
}

/**
 * 导出后行为(按设置):资源管理器中显示 / 默认程序打开。
 * openPath 返回非空字符串即失败,仅日志记录,不抛给用户。
 */
export async function runAfterConvert(action: AppSettings["afterConvert"], outputPath: string): Promise<void> {
  if (action === "show-in-folder") {
    shell.showItemInFolder(outputPath);
    return;
  }
  if (action === "open") {
    const error = await shell.openPath(outputPath);
    if (error) console.log(`[afterConvert] 打开失败: ${error}`);
  }
}
