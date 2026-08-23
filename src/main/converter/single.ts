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
import { buildBookmarkTree, injectBookmarks } from "../../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../../core/pdf/metadata.js";
import { extractHeadings } from "../../core/pdf/postprocess.js";
import { renderMermaid } from "../mermaid-service.js";
import { loadSettings, type AppSettings } from "../settings.js";
import { hardenWebContents } from "../web-hardening.js";
import { writeTempHtml } from "../temp-html.js";
import {
  buildConvertContext,
  createConvertContext,
  getImageResolver,
  throwIfCanceled,
  type ConvertContext,
} from "./context.js";
import { resolveOutputPath } from "./paths.js";

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
  if (!/\.(md|markdown)$/i.test(filePath)) {
    // 生成期本地化(B6 决策):throw 文案经 error.message 单次字符串通道到 GUI,
    // 显示层无法重映射,只能在抛出点用 t()(main 进程启动时已 setLanguage)。
    throw new Error(t("file.onlyMarkdown"));
  }
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  onProgress?.("read");
  const warnings: ConvertWarning[] = [];
  const { text: md, encoding } = decodeMarkdown(await fs.readFile(filePath));
  if (encoding === "gbk") {
    warnings.push({
      key: "warn.gbkEncoding",
      fallback: "已按 GBK 编码读取:文件编码非 UTF-8",
    });
  }

  // B9 进度分阶段:docx 沿用粗粒度 render;pdf 由 core 经 onStage 细分
  // parse/inline/mermaid/katex,print 在 renderPdf 内 printToPDF 前上报
  if (format === "docx") onProgress?.("render");
  const artifact = await convert(
    md,
    format,
    buildConvertContext({
      baseDir: path.dirname(filePath),
      title: path.basename(filePath).replace(/\.(md|markdown)$/i, ""),
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

  const { outputPath, warnings: outWarnings } = await resolveOutputPath(
    filePath,
    format,
    settings.outputDir,
  );
  warnings.push(...outWarnings);

  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    if (!ctx.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
    return { outputPath, warnings };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘(与合并共用 renderPdf;print 阶段在内部上报)
  await renderPdf(artifact, outputPath, ctx, onProgress);
  onProgress?.("done");
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
  const { htmlPath, cleanup } = await writeTempHtml(artifact.html);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  hardenWebContents(printWin); // B1:打印窗口与预览同源加固(内容含用户 markdown 渲染的链接)
  try {
    throwIfCanceled(ctx); // 批次 7:打印前检查(loadFile/字体等待期间用户可能已取消)
    onStage?.("print"); // B9:进入不可中断的打印/写盘阶段
    await printWin.loadFile(htmlPath);
    // 批次 6:等待公式字体(KaTeX woff2)加载完成再打印,否则 printToPDF 缺字形
    // (did-finish-load 后字体仍在加载,printToPDF 不等待字体)
    await printWin.webContents.executeJavaScript("document.fonts.ready");
    throwIfCanceled(ctx); // 批次 7:打印前复查(大文档字体等待可长达数秒)
    const data = await printWin.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: artifact.footerTemplate,
    });
    // 批次 7:printToPDF 不可中断(Electron 原子调用),取消需等本轮打印结束;
    // 但落盘/书签/元数据必须中止 → 打印后立即检查,取消则不产出文件、不报成功。
    throwIfCanceled(ctx);
    // 批次 4:从渲染后 HTML 提取标题(与目录同源,封面/目录本身非 h 标签不受影响),
    // 注入 PDF 书签大纲(读 /Dests 命名目标,标题 id 即命名目标名,无需文本定位)。
    // 无标题时原样落盘(输出为 Buffer → Uint8Array 无拷贝)。
    const headings = extractHeadings(artifact.html);
    const bookmarked =
      headings.length > 0
        ? await injectBookmarks(new Uint8Array(data), buildBookmarkTree(headings))
        : new Uint8Array(data);
    // 批次 5c:书签注入之后追加 PDF Info 元数据注入(frontmatter title/author/date → 文档属性)。
    // 顺序固定:书签 → 元数据(后者经 pdf-lib 整体重存,必须最后执行,否则会丢弃书签)。
    const output = await setPdfMetadata(bookmarked, artifact.metadata);
    await fs.writeFile(outputPath, output);
  } finally {
    printWin.destroy();
    await cleanup();
  }
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
