/**
 * 转换装配层:一段 markdown → core 渲染 → 落盘 →(可选)导出后行为。
 *
 * 本模块是 headless 的(零 electron import,见 gates/repo/check-import-boundary.mjs 的
 * convert-no-gui):GUI / CLI / MCP / 库四个交付面共用同一套装配,宿主能力全部经入参注入。
 * 注入点恰好四个(settings / printPdf / mermaidResolver / onAfterCommit),它们是本模块
 * 离宿主的**全部**距离 —— 新增宿主依赖前先数这四个,数不动就说明该能力不属于装配层。
 *
 * 入参刻意**不含文件列表**:多对一的塌缩在骨架**上游**完成(合并把 N 个文件压成一段
 * markdown,发生在落盘之前),故骨架内部看不到「N 个」进来(见 adr-029 决定)。
 *
 * 依赖方向(单向无环):本模块只向下依赖 core 与同层的 paths / artifact-writer / context;
 * 消费点(GUI 的 single / merge,将来的 CLI / MCP)import 本模块,本模块不 import 任何消费点。
 *
 * 刻意**不在**本模块内、相似但不统一的项(理由见 adr-029 决定要点一/三/四/五,
 * 下一个人看到又一份相似代码时答案在那里):
 * - 合并侧「N 文件有界并发读取完成、合并正文之前」的第 4 道取消闸门 —— 单文件没有
 *   「长批次读取」这个窗口,并进来要么删掉一道真实防护、要么在单文件造假闸门;
 * - 批量的第三份「导出后行为」实现(取第一个成功项,与本骨架的「判让位标志」语义不同构);
 * - 两侧的参数/预算校验段(单文件查扩展名,合并查空数组与上限,判据完全不同);
 * - 预览侧映射上下文的差异(降级 Mermaid、不共享图片缓存、无取消);
 * - pdf 打印(BrowserWindow/printToPDF)、书签、PDF Info 元数据注入:属宿主能力,
 *   经 printPdf 整体迁出(见 main/converter/electron-side.ts)。
 */
import path from "node:path";
import { convert } from "../core/convert.js";
import type { ConvertFormat } from "../core/settings/settings-defaults.js";
import type { PdfArtifact, PreprocessedMarkdown } from "../core/convert.js";
import type { DocMetadata } from "../core/pipeline/frontmatter.js";
import type { ConvertWarning } from "../core/i18n/index.js";
// 阶段键联合单源 core/ipc-contract.ts(与跨进程 payload 契约同源,避免契约与发射面各留一份)
import type { ConvertStage } from "../core/ipc-contract.js";
// 取消判定按错误码单源(main 闸门与 core 渲染期取消同码,见 core/cancel.ts)
import { isConversionCanceled } from "../core/cancel.js";
import type { MermaidResolver } from "../core/markdown/mermaid.js";
import type { AppSettings } from "../core/settings/settings-defaults.js";
import { commitArtifact, type CommitArtifactOptions } from "./artifact-writer.js";
import { resolveOutputPath, stripMarkdownExt } from "./paths.js";
import { ConvertCanceledError, throwIfCanceled, type ConversionHandle } from "./cancellation.js";
import { buildConvertContext, getImageResolver } from "./context.js";

/** 骨架的文档面入参:一段 markdown + 来源路径 + 可选基名 + 解析基准目录/可信根 */
export interface OutputSkeletonDoc {
  /**
   * 一段 markdown 的**阶段产物**(合并侧已完成 N→1 的塌缩;骨架内部看不到几个文件进来)。
   *
   * 形状是 core 的 `PreprocessedMarkdown`(body 已去 frontmatter + metadata 已解析),
   * 不是裸字符串:core 的 `convert` 不再自己解析 frontmatter(否则同一次转换解析两次),
   * 两个消费点都必须把准备阶段的解析结果交下来。
   */
  markdown: PreprocessedMarkdown;
  /** 来源路径(合并取首个源文件):定文档标题基名与产物落盘目录 */
  sourcePath: string;
  /** 相对路径的解析基准目录(单文件=源文件目录;合并=各输入目录的公共祖先) */
  baseDir: string;
  /** 额外可信读根(合并传各输入源目录;缺省则只有 baseDir 可读) */
  trustedRoots?: readonly string[];
  /** 产物落盘首名(缺省与 sourcePath 同名;合并传 `{基名}-合并`) */
  baseName?: string;
  /**
   * 钉死产物路径(CLI 的 `--output`):非空即逐字采用该路径,并**禁重名自动避让**
   * ——已存在时提交失败而不是悄悄改名(见 artifact-writer 的 renameOnConflict)。
   * GUI 面恒不传(它要的就是「名 (2).docx」不覆盖用户既有文件)。
   */
  pinOutputPath?: string;
  /** 封面元数据(合并专属可选实参,单文件恒不传) */
  metadata?: DocMetadata;
}

/** 提交器选项的本地别名(PdfPrinter 签名用,避免在类型位重复写长名)。 */
type CommitOptions = CommitArtifactOptions;

/**
 * pdf 打印能力(宿主注入):把 pdf 产物提交到 preferredPath,返回实际落盘路径。
 *
 * 形状是**整体搬迁**而非「打印成字节」,故 pdf 两遍法(目录页码回填)、书签注入、
 * PDF Info 元数据注入、以及末尾的提交器调用,全部留在宿主侧按原顺序执行
 * (setPdfMetadata 经 pdf-lib 整体重存,必须最后执行,否则会丢弃书签)。
 * 装配层不重组这段顺序,只决定「有没有能力」。
 */
export type PdfPrinter = (
  artifact: PdfArtifact,
  preferredPath: string,
  ctx: ConversionHandle,
  onStage?: (stage: ConvertStage) => void,
  /** 落盘提交选项(取消闸门 + 重名避让开关);宿主实现必须原样透传给 commitArtifact,
   *  否则装配层的 pinOutputPath 语义在 pdf 路径上失效(禁避让只对 docx 生效)。 */
  commit?: CommitOptions,
) => Promise<string>;

/** 骨架的运行面入参:与文档面分开的调用期环境 */
export interface OutputSkeletonRun {
  format: ConvertFormat;
  settings: AppSettings;
  /** 取消上下文:signal/deadline 透传 core;两道闸门与导出后行为的复查都读它 */
  ctx: ConversionHandle;
  /** 警告收集器(与调用方共享同一数组,返回值即它;准备期 warning 由调用方先写入) */
  warnings: ConvertWarning[];
  /** 公式资源目录(pdf 用;docx 走 MathML 不需要) */
  katexDir?: string;
  onProgress?: (stage: ConvertStage) => void;
  /**
   * pdf 打印能力:docx 路径不消费它,故可省;**pdf 路径缺省即报错,不降级** ——
   * 降级会把「本机装了什么」变成一条可静默关闭的开关(headless 面无 Electron 时
   * 必然失败,早失败早暴露;降级会让同一份输入在不同交付面上产出不同结果)。
   */
  printPdf?: PdfPrinter;
  /**
   * Mermaid 渲染能力:缺省 = 不注入,core 按普通代码块渲染(既有契约,零新增代码)。
   * 刻意不做静默降级:宿主侧不提供时应由该宿主显式告知调用方「本面不支持 mermaid」。
   */
  mermaidResolver?: MermaidResolver;
  /**
   * 产物落盘**之后**的副作用(打开产物/资源管理器):缺省 = 不触发。
   * 触发条件与闸门二绑死(见 emitConvertedArtifact),故「要不要副作用」由宿主决定,
   * 「副作用前要不要复查取消」由本层保证。
   */
  onAfterCommit?: (outputPath: string) => void | Promise<void>;
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
 * 让位语义不进本层:是否触发导出后行为由**宿主**经 onAfterCommit 有无表达。
 * 批量让位(逐文件不各自打开、批次末尾统一开一次)是 GUI 的副作用所有权问题,
 * 与 path→path 转换无关;把它做成参数会让每个非 GUI 消费点都得先决定「我想不想开文件夹」。
 */
export async function emitConvertedArtifact(
  doc: OutputSkeletonDoc,
  run: OutputSkeletonRun,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const { markdown, sourcePath, baseDir, trustedRoots, baseName, pinOutputPath, metadata } = doc;
  const { format, settings, ctx, warnings, katexDir, onProgress } = run;
  const { printPdf, mermaidResolver, onAfterCommit } = run;
  // 进度分阶段:docx 沿用粗粒度 render;pdf 由 core 经 onStage 细分
  // parse/inline/mermaid/katex,print 在宿主打印能力内 printToPDF 前上报
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
        // Mermaid 渲染服务(单例隐藏窗口;core 层 mermaidResolver 契约)。宿主注入时用
        // 严格模式:失败带真实原因抛出,core 既有 warning 通道据此在 UI 呈现
        // (warn.mermaidFailed),降级渲染仍由 core 负责(代码块,内容不丢)。
        // 不注入则该键整体缺席 —— core 侧据此按普通代码块渲染(见 mermaidResolver 的 JSDoc)。
        ...(mermaidResolver ? { mermaidResolver } : {}),
        ...(format === "pdf" ? { onStage: (stage: ConvertStage) => onProgress?.(stage) } : {}),
      }),
    );
  } catch (err) {
    // 渲染期取消(core 抛 core 侧取消错误)归一为本层 ConvertCanceledError:调用方
    // 的取消判定(IPC 取消分支与批量汇总)只认本层类型,不归一会把「用户取消/时间上限」
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
    printPdf,
    pinOutputPath,
  );
  warnings.push(...outWarnings);

  // 副作用闸门:触发点在此,但**是否触发由宿主决定**(onAfterCommit 有无 = 让位语义)。
  // 闸门二与该条件绑死,不得提成无条件执行:批量路径刻意让位逐文件的副作用,
  // 若此处无条件跑,批量会在 commitArtifact 写完文件之后再做一次取消检查,
  // 造出「文件在、却报已取消」的新失败模式。
  if (onAfterCommit) {
    // 闸门二刻意落在「产物已落盘 → 打开产物」的最后窗口(理由见本函数 JSDoc)。
    throwIfCanceled(ctx);
    await onAfterCommit(outputPath);
  }
  return { outputPath, warnings };
}

/**
 * 渲染产物落盘收尾:
 * 解析输出首选路径(输出目录/超长回落,或 `pinOutputPath` 的逐字路径)→ docx 直接提交 /
 * pdf 经注入的宿主打印能力 → onProgress("done")。落盘统一经产物提交器(独占创建 +
 * 魔数校验),两种格式、单文件/批量/合并共用同一提交路径;实际路径可能带重名序号
 * 「名 (2).ext」(pinOutputPath 形态下禁用,见 OutputSkeletonDoc)。
 * 导出后行为(onAfterCommit)仍由调用方按各自语义执行。
 */
export async function persistArtifact(
  artifact: PdfArtifact | { kind: "docx"; buffer: Uint8Array },
  sourcePath: string,
  format: ConvertFormat,
  outputDir: string,
  ctx: ConversionHandle,
  onProgress?: (stage: ConvertStage) => void,
  baseName?: string,
  printPdf?: PdfPrinter,
  pinOutputPath?: string,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const { outputPath: preferredPath, warnings } = await resolveOutputPath(
    sourcePath,
    format,
    outputDir,
    baseName,
    pinOutputPath,
  );
  const commitOptions = {
    beforeCommit: () => throwIfCanceled(ctx),
    // pinOutputPath:调用方点名了产物路径,重名避让会把产物改名交付
    renameOnConflict: pinOutputPath === undefined,
  };
  // 取消闸门:产物已渲染完但用户已取消 → 提交器在写最终路径前复查,取消则零副作用
  // (临时文件在提交器 finally 内清理,不留半成品)。
  let outputPath: string;
  if (artifact.kind === "docx") {
    outputPath = await commitArtifact(preferredPath, artifact.buffer, commitOptions);
  } else {
    // pdf 分岔:打印能力是宿主注入的整体函数(两遍法/书签/元数据/提交都在其内按序完成)。
    // 缺能力即报错:本层不提供降级的 pdf 路径,否则「产物能不能打印出来」变成一个
    // 取决于宿主配置的静默开关,同一份输入在不同交付面上行为分叉。
    if (!printPdf) {
      throw new Error("pdf 转换需要宿主提供 printPdf 能力(printToPDF 是宿主能力,装配层不自带)");
    }
    outputPath = await printPdf(artifact, preferredPath, ctx, onProgress, commitOptions);
  }
  onProgress?.("done");
  return { outputPath, warnings };
}