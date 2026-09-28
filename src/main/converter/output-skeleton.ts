/**
 * 转换输出骨架(消费点 2 处:single 的单文件转换、merge 的合并转换):
 * 一段 markdown → core 渲染 → 落盘(printToPDF / 产物提交器)→ 两道取消闸门 → 导出后行为。
 *
 * 入参刻意**不含文件列表**:多对一的塌缩在骨架**上游**完成(合并把 N 个文件压成一段
 * markdown,发生在落盘之前),故骨架内部看不到「N 个」进来(见 adr-029 决定)。
 *
 * 依赖方向(单向无环):本模块只向下依赖 core / context / paths / artifact-writer /
 * services / persist;两个消费点 import 本模块,本模块不 import 任何消费点。
 *
 * 刻意**不在**本模块内、相似但不统一的项(理由见 adr-029 决定要点一/三/四/五,
 * 下一个人看到又一份相似代码时答案在那里):
 * - 合并侧「N 文件有界并发读取完成、合并正文之前」的第 4 道取消闸门 —— 单文件没有
 *   「长批次读取」这个窗口,并进来要么删掉一道真实防护、要么在单文件造假闸门;
 * - 批量的第三份「导出后行为」实现(取第一个成功项,与本骨架的「判让位标志」语义不同构);
 * - 两侧的参数/预算校验段(单文件查扩展名,合并查空数组与上限,判据完全不同);
 * - 预览侧映射上下文的差异(降级 Mermaid、不共享图片缓存、无取消)。
 */
import path from "node:path";
import { BrowserWindow, shell } from "electron";
import { convert } from "../../core/convert.js";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { PdfArtifact } from "../../core/convert.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { buildBookmarkTree, injectBookmarks, pageNumbersForNames, type PdfHeading } from "../../core/pdf/bookmarks.js";
import { setPdfMetadata } from "../../core/pdf/metadata.js";
import { extractHeadings, injectTocPageNumbers } from "../../core/pdf/postprocess.js";
import { PDFDocument } from "pdf-lib";
// 取消判定按错误码单源(main 闸门与 core 渲染期取消同码,见 core/cancel.ts)
import { isConversionCanceled } from "../../core/cancel.js";
import { renderMermaidStrict } from "../services/mermaid-service.js";
import type { AppSettings } from "../persist/settings.js";
import { hardenWebContents } from "../services/web-hardening.js";
import { writeTempHtml } from "../services/temp-html.js";
import { commitArtifact } from "./artifact-writer.js";
import {
  buildConvertContext,
  ConvertCanceledError,
  getImageResolver,
  throwIfCanceled,
  type ConvertContext,
} from "./context.js";
import { resolveOutputPath, stripMarkdownExt } from "./paths.js";

/** 骨架的文档面入参:一段 markdown + 来源路径 + 可选基名 + 解析基准目录/可信根 */
export interface OutputSkeletonDoc {
  /** 一段 markdown(合并侧已完成 N→1 的塌缩;骨架内部看不到几个文件进来) */
  markdown: string;
  /** 来源路径(合并取首个源文件):定文档标题基名与产物落盘目录 */
  sourcePath: string;
  /** 相对路径的解析基准目录(单文件=源文件目录;合并=各输入目录的公共祖先) */
  baseDir: string;
  /** 额外可信读根(合并传各输入源目录;缺省则只有 baseDir 可读) */
  trustedRoots?: readonly string[];
  /** 产物落盘首名(缺省与 sourcePath 同名;合并传 `{基名}-合并`) */
  baseName?: string;
  /** 封面元数据(合并专属可选实参,单文件恒不传) */
  metadata?: DocMetadata;
}

/** 骨架的运行面入参:与文档面分开的调用期环境(两侧完全同构,无一处按调用方分叉) */
export interface OutputSkeletonRun {
  format: ConvertFormat;
  settings: AppSettings;
  /** 取消上下文:signal/deadline 透传 core;两道闸门与导出后行为的复查都读它 */
  ctx: ConvertContext;
  /** 警告收集器(与调用方共享同一数组,返回值即它;准备期 warning 由调用方先写入) */
  warnings: ConvertWarning[];
  /** 公式资源目录(pdf 用;docx 走 MathML 不需要) */
  katexDir?: string;
  onProgress?: (stage: string) => void;
}

/**
 * 渲染 → 落盘 → 导出后行为的共享骨架(单文件与合并各一个消费点)。
 *
 * 取消闸门两处,**位置是刻意论证过的,勿挪**:
 * - 「渲染完成 / 落盘前」:整篇渲染可能耗时数秒,用户在此期间取消则不产出半成品;
 * - 「落盘后 / 导出后行为前」:落盘之后到打开产物之间是最后一道可取消窗口,此处取消
 *   (用户取消或关窗放弃)则抛 ConvertCanceledError,调用方回「已取消」,**绝不打开产物**
 *   ——只依赖落盘前的检查点会让已落盘的产物在取消后仍被打开。
 *
 * 让位标志:本骨架**读** ctx.skipAfterConvert 决定是否触发副作用,但**不判谁拥有它**
 * —— 让位上下文的构造留在批量侧(见 context.ts 的 ConvertContext)。
 */
export async function emitConvertedArtifact(
  doc: OutputSkeletonDoc,
  run: OutputSkeletonRun,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const { markdown, sourcePath, baseDir, trustedRoots, baseName, metadata } = doc;
  const { format, settings, ctx, warnings, katexDir, onProgress } = run;
  // 进度分阶段:docx 沿用粗粒度 render;pdf 由 core 经 onStage 细分
  // parse/inline/mermaid/katex,print 在 renderPdf 内 printToPDF 前上报
  if (format === "docx") onProgress?.("render");
  let artifact: Awaited<ReturnType<typeof convert>>;
  try {
    artifact = await convert(
      markdown,
      format,
      await buildConvertContext({
        baseDir,
        // 取消与时间上限透传 core:整篇单次 convert 可被中途取消,
        // 否则取消只能等渲染结束才在下方闸门生效;批量逐文件经 batchCtx 同样生效
        convert: ctx,
        // 标题基名由来源路径推导(合并取首个源文件,与落盘首名同源)
        title: stripMarkdownExt(path.basename(sourcePath)),
        metadata,
        warnings,
        settings,
        // 本地文件直接读取;http(s) 下载(10s 超时,失败返回 null);同 URL 并发去重;按 baseDir 跨文件共享
        imageResolver: getImageResolver(baseDir, { trustedRoots }),
        katexDir,
        // Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约)。
        // 用严格模式:失败带真实原因抛出,core 既有 warning 通道据此在 UI 呈现
        // (warn.mermaidFailed),降级渲染仍由 core 负责(代码块,内容不丢)
        mermaidResolver: renderMermaidStrict,
        ...(format === "pdf" ? { onStage: (stage: string) => onProgress?.(stage) } : {}),
      }),
    );
  } catch (err) {
    // 渲染期取消(core 抛 core 侧取消错误)归一为本层 ConvertCanceledError:main 面的取消
    // 判定(IPC 取消分支与调用方 catch)只认本层类型,不归一会把「用户取消/时间上限」
    // 上报为转换失败。普通失败原样上抛。
    if (isConversionCanceled(err)) throw new ConvertCanceledError();
    throw err;
  }
  // 闸门一「渲染完成 / 落盘前」:渲染可能已耗时数秒,取消则零产物
  throwIfCanceled(ctx);
  const { outputPath, warnings: outWarnings } = await persistArtifact(
    artifact,
    sourcePath,
    format,
    settings.outputDir,
    ctx,
    onProgress,
    baseName,
  );
  warnings.push(...outWarnings);

  // 副作用闸门:本骨架是「导出后行为」的触发点,但**只读让位标志、不判其归属**。
  if (!ctx.skipAfterConvert) {
    // 闸门二刻意落在「产物已落盘 → 打开产物」的最后窗口(理由见本函数 JSDoc)。
    // 合并路径此分支恒真:skipAfterConvert 的唯一写入者是 batch.ts 的
    // batchConvertImpl,而 batch 只调 convertImpl、从不调 mergeConvertImpl;
    // 合并路径的 ctx 出自无参 createConvertContext,其返回值不含该字段 ⇒ 恒 undefined。
    // 单文件路径此分支是真分支(批量逐文件经它让位),两侧同名不同性质。
    throwIfCanceled(ctx);
    await runAfterConvert(settings.afterConvert, outputPath, ctx);
  }
  return { outputPath, warnings };
}

/**
 * 渲染产物落盘收尾:
 * 解析输出首选路径(输出目录/超长回落)→ docx 直接提交 / pdf 经隐藏窗口 printToPDF
 * → onProgress("done")。落盘统一经产物提交器(独占创建 + 魔数校验),两种格式、
 * 单文件/批量/合并共用同一提交路径;实际路径可能带重名序号「名 (2).ext」。
 * 导出后行为(runAfterConvert)仍由调用方按各自语义执行。
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
  const { outputPath: preferredPath, warnings } = await resolveOutputPath(sourcePath, format, outputDir, baseName);
  // 取消闸门:产物已渲染完但用户已取消 → 提交器在写最终路径前复查,取消则零副作用
  // (临时文件在提交器 finally 内清理,不留半成品)。
  const outputPath =
    artifact.kind === "docx"
      ? await commitArtifact(preferredPath, artifact.buffer, { beforeCommit: () => throwIfCanceled(ctx) })
      : // pdf:临时 HTML → 隐藏窗口 printToPDF → 提交落盘(与合并共用 renderPdf;print 阶段在内部上报)
        await renderPdf(artifact, preferredPath, ctx, onProgress);
  onProgress?.("done");
  return { outputPath, warnings };
}

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
 */
export async function renderPdf(
  artifact: PdfArtifact,
  preferredPath: string,
  ctx: ConvertContext,
  onStage?: (stage: string) => void,
): Promise<string> {
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
  return commitArtifact(preferredPath, output, { beforeCommit: () => throwIfCanceled(ctx) });
}

/**
 * 导出后行为(按设置):资源管理器中显示 / 默认程序打开。
 * 所有权:仅「拥有者」调用——单文件(每次转换一次)、合并(整个合并一次,单产物)、
 * 批量(整个批次一次);本函数不判所有权,让位由 ctx.skipAfterConvert 表达。
 * 取消闸门:传 ctx 时在触发 shell 的最后时刻复查(与 shell 调用之间无 await,
 * 「检查通过 → 触发」不可被取消插入)——取消后一律无产物副作用(不打开文件/文件夹),
 * 且静默跳过不抛:是否报「已取消」由拥有者决定(单文件/合并在调用前显式
 * throwIfCanceled,批量经 canceledCount 汇总)。
 * openPath 返回非空字符串即失败,仅日志记录,不抛给用户。
 */
export async function runAfterConvert(
  action: AppSettings["afterConvert"],
  outputPath: string,
  ctx?: ConvertContext,
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
