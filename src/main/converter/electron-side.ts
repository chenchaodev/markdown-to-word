/**
 * GUI 宿主的电子侧能力:pdf 打印(临时 HTML → 隐藏窗口 printToPDF → 提交落盘)
 * 与导出后行为(资源管理器/默认程序打开)。
 *
 * 本模块是装配层 `convert/run.ts` 的**能力提供者**,不是它的同类:前者是零 electron 的
 * headless 装配,本模块持有 BrowserWindow / shell / pdf-lib 三处宿主触点。两者是
 * 「注入方 / 被注入方」关系,故 renderPdf 的形状是整体搬迁(而非「打印成字节」)——
 * pdf 两遍法(目录页码回填)、书签注入、PDF Info 元数据注入、末尾的产物提交,
 * 这四步的先后顺序在装配层重组过一次就会错(setPdfMetadata 经 pdf-lib 整体重存,
 * 必须最后执行,否则会丢弃书签)。顺序留在本模块,装配层只决定「有没有能力」。
 *
 * 依赖方向(单向无环):本模块 → convert(run 的 PdfPrinter 契约 / context / artifact-writer)
 * + core 的 pdf 纯逻辑 + services 的宿主服务;装配层不 import 本模块,
 * 由 single.ts / merge.ts 在调用点注入(故 test/main 经 single.js 消费这两个符号的
 * 导入面保持零改动,见 docs/adr/adr-029-main侧输出骨架抽函数.md)。
 */
import { BrowserWindow, shell } from "electron";
import { PDFDocument } from "pdf-lib";
import type { PdfArtifact } from "../../core/convert.js";
import { buildBookmarkTree, injectBookmarks, pageNumbersForNames, type PdfHeading } from "../../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../../core/pdf/metadata.js";
import { extractHeadings, injectTocPageNumbers } from "../../core/pdf/postprocess.js";
import { commitArtifact, type CommitArtifactOptions } from "../../convert/artifact-writer.js";
import { throwIfCanceled, type ConversionHandle } from "../../convert/cancellation.js";
import type { PdfPrinter } from "../../convert/run.js";
import type { AppSettings } from "../persist/settings.js";
import { hardenWebContents } from "../services/web-hardening.js";
import { writeTempHtml } from "../services/temp-html.js";

/**
 * pdf 标题来源:优先用产物透传的结构化标题(与 HTML 同一次渲染管线产出,见
 * core/pdf/render.ts renderPdfDocument);产物未透传(旧产物/直构 PdfArtifact)时
 * 回退 postprocess 的 HTML 反解析兼容层。两条路径的 id 同源(rules/heading-id.ts
 * 生成,与 /Dests 命名目标一一对应),故目录/书签行为一致。
 */
function resolvePdfHeadings(artifact: PdfArtifact): PdfHeading[] {
  const structured = (artifact as PdfArtifact & { headings?: PdfHeading[] }).headings;
  return Array.isArray(structured) && structured.length > 0 ? structured : extractHeadings(artifact.html);
}

/**
 * pdf 产物落盘:临时 HTML → 隐藏窗口 printToPDF → 经产物提交器提交到 preferredPath。
 * 单文件/合并共用;临时文件与窗口在 finally 中清理,失败也会销毁窗口。
 * preferredPath 为首选路径(重名序号由提交器独占创建时决定),返回实际落盘路径。
 * onStage(可选)在 printToPDF 前上报 "print" 阶段(printToPDF 不可中断,
 * renderer 据此置灰取消按钮 + 显示「正在写入 PDF…」)。
 *
 * 本函数整体作为 `PdfPrinter` 注入装配层(见 convert/run.ts 的 PdfPrinter JSDoc:
 * 两遍法/书签/元数据/提交的顺序不可在装配层重组)。
 */
export const renderPdf: PdfPrinter = async (
  artifact: PdfArtifact,
  preferredPath: string,
  ctx: ConversionHandle,
  onStage?: (stage: string) => void,
  commit?: CommitArtifactOptions,
): Promise<string> => {
  // 单遍打印:写临时 HTML → 隐藏窗口加载 → printToPDF → 返回 bytes(窗口/临时文件 finally 清理)
  const printOnce = async (html: string): Promise<Uint8Array> => {
    const { htmlPath, cleanup } = await writeTempHtml(html);
    const printWin = new BrowserWindow({
      show: false,
      // webPreferences 全显式(与 mermaid-service 对齐;默认值虽安全,显式防漂移)
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    hardenWebContents(printWin); // 打印窗口与预览同源加固(内容含用户 markdown 渲染的链接)
    try {
      throwIfCanceled(ctx); // 打印前检查(loadFile/字体等待期间用户可能已取消)
      onStage?.("print"); // 进入不可中断的打印/写盘阶段
      await printWin.loadFile(htmlPath);
      // 等待公式字体(KaTeX woff2)加载完成再打印,否则 printToPDF 缺字形
      await printWin.webContents.executeJavaScript("document.fonts.ready");
      throwIfCanceled(ctx); // 打印前复查(大文档字体等待可长达数秒)
      return await printWin.webContents.printToPDF({
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        // 页眉模板随设置注入(default/none = 空 span 占位,维持现状无页眉);
        // ?? 兜底旧调用方手工构造的 PdfArtifact(无 headerTemplate 字段)
        headerTemplate: artifact.headerTemplate ?? "<span></span>",
        footerTemplate: artifact.footerTemplate,
      });
    } finally {
      printWin.destroy();
      await cleanup();
    }
  };
  // 标题(与目录同源,封面/目录本身非 h 标签不受影响):优先结构化数据,缺失时回退
  // HTML 反解析兼容层。用于注入 PDF 书签大纲(读 /Dests 命名目标,标题 id 即
  // 命名目标名,无需文本定位)与 field 模式两遍法的目录项定位。
  const headings = resolvePdfHeadings(artifact);
  // field 模式 → 两遍法注入目录页码(第一遍打印解析 /Dests 定位标题页码,
  // 第二遍按已知 id 集合注入页码重印;TOC 后硬分页符保证正文分页一致、页码准确)
  let data = await printOnce(artifact.html);
  if (artifact.tocMode === "field" && headings.length > 0) {
    const ids = headings.map((h) => h.id);
    const doc = await PDFDocument.load(new Uint8Array(data));
    const pageNumbers = pageNumbersForNames(doc, ids);
    data = await printOnce(injectTocPageNumbers(artifact.html, pageNumbers, ids));
  }
  // printToPDF 不可中断(Electron 原子调用),取消需等本轮打印结束;
  // 但落盘/书签/元数据必须中止 → 打印后立即检查,取消则不产出文件、不报成功。
  throwIfCanceled(ctx);
  const bookmarked =
    headings.length > 0
      ? await injectBookmarks(new Uint8Array(data), buildBookmarkTree(headings))
      : new Uint8Array(data);
  // 书签注入之后追加 PDF Info 元数据注入(frontmatter title/author/date → 文档属性)。
  // 顺序固定:书签 → 元数据(后者经 pdf-lib 整体重存,必须最后执行,否则会丢弃书签)。
  const output = await setPdfMetadata(bookmarked, artifact.metadata);
  // 提交器在写最终路径前再查一次取消(此处到落盘之间仍有 await):取消则不产出文件。
  // commit 由装配层传入(取消闸门 + 重名避让开关):spread 在前、本地 beforeCommit 在后,
  // 故取消闸门永远由宿主侧兜住(不被入参覆盖),而 renameOnConflict 透传给提交器 ——
  // 漏掉后者会让 pdf 路径绕开 pinOutputPath 的「禁避让」(它是装配层语义,不是宿主的)。
  return commitArtifact(preferredPath, output, {
    ...commit,
    beforeCommit: () => throwIfCanceled(ctx),
  });
};

/**
 * 导出后行为(按设置):资源管理器中显示 / 默认程序打开。
 * 所有权:仅「拥有者」调用——单文件(每次转换一次)、合并(整个合并一次,单产物)、
 * 批量(整个批次一次);本函数不判所有权,让位由调用方是否传本函数决定。
 * 取消闸门:传 ctx 时在触发 shell 的最后一刻复查(与 shell 调用之间无 await,
 * 「检查通过 → 触发」不可被取消插入)——取消后一律无产物副作用(不打开文件/文件夹),
 * 且静默跳过不抛:是否报「已取消」由拥有者决定(单文件/合并在调用前显式
 * throwIfCanceled,批量经 canceledCount 汇总)。
 * openPath 返回非空字符串即失败,仅日志记录,不抛给用户。
 */
export async function runAfterConvert(
  action: AppSettings["afterConvert"],
  outputPath: string,
  ctx?: ConversionHandle,
): Promise<void> {
  if (action === "none") return;
  if (ctx?.cancelRequested) return; // 取消闸门:最后一刻复查,取消后不打开产物
  if (action === "show-in-folder") {
    shell.showItemInFolder(outputPath);
    return;
  }
  const error = await shell.openPath(outputPath);
  if (error) console.log(`[afterConvert] 打开失败: ${error}`);
}