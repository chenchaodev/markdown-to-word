/**
 * CLI 入口(进程外交付面,ADR-060):`node dist/cli/index.js <输入路径...> [选项]`。
 *
 * 本文件只做**编排**,不含判定逻辑:参数解析与设置构造在 options.ts(纯函数),
 * 产物落盘与渲染在装配层(src/convert/),pdf 打印在 Electron 宿主(main/cli-pdf-host.ts),
 * 拉起宿主的那套判定与传话在装配层(src/convert/pdf-host-launch.ts,与 MCP 共用一份)。
 * 「能力注入」的结构与 GUI 的 single.ts 完全同构 —— 这是步序 1 把装配层抽出来的收益:
 * CLI 不是「另一条转换实现」,只是第三个消费点。
 *
 * 两条形态(PLAN 步序 2):
 * - docx:纯 node 同进程跑装配层(零 Electron 启动,毫秒级);
 * - pdf:壳自动重入 Electron(子进程),因为 printToPDF 是宿主能力。
 *   `--format both` 即「一条命令两个格式」:逐个跑,各自成败独立记账。
 *
 * 流约定(两处都不可混):
 * - **stdout = 数据**:`--json` 时输出结构化结果数组;非 json 时输出产物路径,一行一个。
 * - **stderr = 人读诊断**:警告、进度、错误。
 * 这样 `m2w a.md --json | jq` 不会被任何一行提示语污染。
 *
 * 退出码见 convert/cli-pdf-job.ts 的 exitCodes(与 pdf 子进程共用单源):
 * 0 成功 / 1 用法错 / 2 输入读不到 / 3 转换失败 / 4 输出写不了。
 * 多输入时取**最严重**的一个(4 > 3 > 2),使脚本能靠退出码判「有没有失败」。
 */
import path from "node:path";
import { collectMarkdownPaths } from "../convert/paths.js";
// 「输出写不了」的错误码取值域单源(装配层抛出点自带 code,判定侧只读码不读文案)
import { OUTPUT_UNWRITABLE_CODES as OUTPUT_UNWRITABLE_CODE_TABLE } from "../convert/artifact-writer.js";
import { prepareMarkdown } from "../convert/preprocess.js";
import { createConvertContext } from "../convert/context.js";
import { emitConvertedArtifact } from "../convert/run.js";
// readback 形态(docx → Markdown):回读层在 core(零 IO),落盘在装配层(唯一写文件处)
import { readbackDocx } from "../core/ooxml/readback/readback.js";
import { writeReadbackOutput } from "../convert/docx-readback/writer.js";
import { readDocxSource } from "../convert/docx-readback/source.js";
import { errorMessage } from "../core/text/error-message.js";
import {
  exitCodes,
  type CliPdfJob,
  type ExitCode,
} from "../convert/cli-pdf-job.js";
import type { AppSettings, ConvertFormat } from "../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../core/i18n/index.js";
import {
  CliUsageError,
  expandFormats,
  parseCliArgs,
  resolveCliSettings,
  usageText,
  type CliParsedOptions,
  type CliReadbackOptions,
  type CliReadbackResultItem,
  type CliResultItem,
} from "./options.js";
// pdf 宿主的拉起判定与传话机制与 MCP 共用一份(住在 convert 层:ADR-060 定了 cli 与 mcp
// 二者零依赖,共同依赖只能落在两层之下,理由见该模块文件头)
import { isElectronProvidedNode, runPdfHostJob } from "../convert/pdf-host-launch.js";

/**
 * 「输出写不了」的判据(退出码 4 的唯一来源):读**错误码**,不匹配文案。
 *
 * 形态上是 `error.code ∈ {三个码}`。此前这一族靠**匹配三条中文文案**,而文案是
 * 「给人看」的、随时会被改 —— 改一次措辞(如「产物路径已存在」→「输出路径已被占用」)
 * 就让判据**静默失效**:退出码从 4 悄悄变成 3,而没有任何东西报红,脚本侧只是
 * 「重试策略错了」。码由抛出点自带(artifact-writer / paths.ts 的
 * `outputUnwritableError`),因此改文案不影响判定。
 *
 * ⚠ **兜底档为什么是「判失败」而不是「当成功」**:读不到码意味着「这条失败不属于
 * 任何已登记的『写不了』类别」,处置是按**最一般的转换失败**(退出码 3)处理 ——
 * 保留原始 `item.error` 文案不丢信息。反过来若兜底成「不是写不了 ⇒ 成功」,
 * 任何未登记的落盘失败都会被报成成功,那是把不确定当确定,比判错类别严重得多。
 * 换言之:码缺失时**只损失分类精度,不损失失败判定**。
 *
 * 新增一个「写不了」的失败点时,同批在 artifact-writer 的
 * `OUTPUT_UNWRITABLE_CODES` 登记(该表的注释写明了这条耦合)。
 */
const OUTPUT_UNWRITABLE_CODES: ReadonlySet<string> = new Set<string>(
  Object.values(OUTPUT_UNWRITABLE_CODE_TABLE),
);

/** 从抛错对象上取稳定错误码(只认 `code` 字段上的非空字符串,其余一律 undefined) */
function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

function isOutputUnwritable(item: CliResultItem): boolean {
  return item.errorCode !== undefined && OUTPUT_UNWRITABLE_CODES.has(item.errorCode);
}

/**
 * 纯 node 侧跑一次 docx 转换(不经 Electron)。
 *
 * 能力注入与 GUI 的 single.ts 同构但**更少**:printPdf(docx 不消费)/ mermaidResolver /
 * onAfterCommit 一个都不给 —— CLI 不打开产物(打开文件夹是 GUI 的副作用所有权,
 * ADR-060 明确「让位语义不进装配层」),也不渲染 mermaid(本面无 Electron 窗口)。
 * 缺省即降级为普通代码块,是装配层既有契约(core convert.ts 的 mermaidResolver JSDoc)。
 */
async function convertDocx(
  input: string,
  settings: AppSettings,
  pinOutputPath: string | undefined,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const warnings: ConvertWarning[] = [];
  const prepared = await prepareMarkdown(input, settings, warnings, "warn.gbkEncoding");
  const result = await emitConvertedArtifact(
    {
      markdown: { body: prepared.body, metadata: prepared.metadata },
      sourcePath: input,
      baseDir: path.dirname(input),
      ...(pinOutputPath !== undefined ? { pinOutputPath } : {}),
    },
    { format: "docx", settings, ctx: createConvertContext(), warnings },
  );
  return { outputPath: result.outputPath, warnings: result.warnings };
}

/**
 * 经子进程重入宿主跑一次 pdf 转换,并把四态结果归一成 `CliResultItem`。
 *
 * **拉起判定与传话(写任务文件 / spawn / 读结果 / 回收临时目录)在 `convert/pdf-host-launch.ts`**,
 * 本函数只做两件事:① 按 CLI 的流约定写诊断(stderr);② 把机制层的四态结果映射成
 * `CliResultItem`(成功项带 outputPath,失败项带人读 error 与机器可判 errorCode)。
 * 机制层不写任何流、不认识退出码 —— 那两个约定各面不同,压进机制层就是把所有复用者
 * 塞进一份与自己无关的说明。
 *
 * **导出供验收段直调**(同 `convertPdfJob` 的先例):本文件虽是入口(有守卫、可被
 * import),但 pdf 拉起路径此前只有 `--format pdf` 会走到,而没有任何段真跑过 pdf ——
 * 于是拉起判定与 `ELECTRON_RUN_AS_NODE` 剔除这两处「漏一行就静默失败」的位置全在
 * 覆盖率外。直调本函数是覆盖它们的唯一办法(派生真 node 子进程跑 pdf 则覆盖不到子进程
 * 里的判定)。
 */
export function convertPdfViaHost(job: CliPdfJob): CliResultItem {
  // 不给 timeoutMs:CLI 的「等多久」是人的决定,硬掐在这里等于替人做主
  // (机制层的四种结果里也刻意留了 timeout 态给真有闸门的调用方,见 PdfHostRun)。
  const run = runPdfHostJob(job);
  if (run.cleanupWarning !== undefined) process.stderr.write(`[warn] ${run.cleanupWarning}\n`);
  if (run.reason === "spawn-failed") {
    // 宿主可执行文件起不来 = 环境前置条件未满足,不是转换失败。
    // 已安装形态下这意味着「应用 exe 不可执行」,源码检出形态下是「electron 没装」——
    // 两者的下一步动作不同,故文案按上下文给,不要笼统说「请先 npm install」。
    process.stderr.write(
      isElectronProvidedNode()
        ? `[cli] pdf 需要宿主应用可执行文件,未能启动:${run.message}\n` +
          "[cli] 请确认本程序已完整安装;或改用 --format docx(pdf 无宿主不可用)\n"
        : `[cli] pdf 需要 Electron 宿主,开发态下未能启动:${run.message}\n` +
          "[cli] 请先执行 npm install;或改用 --format docx(pdf 无宿主不可用)\n",
    );
    return { input: job.input, format: "pdf", ok: false, warnings: [], elapsedMs: 0, error: run.message };
  }
  if (run.reason === "timeout") {
    process.stderr.write(`[cli] pdf 宿主超时未完成(${run.timeoutMs}ms),已强杀\n`);
    return { input: job.input, format: "pdf", ok: false, warnings: [], elapsedMs: 0, error: `pdf 宿主超时(${run.timeoutMs}ms)` };
  }
  if (run.reason === "no-result") {
    process.stderr.write(
      `[cli] pdf 宿主未产出结果(退出码 ${run.exitStatus ?? "null"},${run.stderr}):${run.message}\n`,
    );
    return {
      input: job.input,
      format: "pdf",
      ok: false,
      warnings: [],
      elapsedMs: 0,
      error: "pdf 宿主未产出结构化结果",
    };
  }
  const result = run.result;
  if (result.ok && typeof result.outputPath === "string") {
    return {
      input: job.input,
      format: "pdf",
      ok: true,
      outputPath: result.outputPath,
      warnings: result.warnings,
      elapsedMs: result.elapsedMs,
    };
  }
  const message = result.error ?? "pdf 转换失败";
  process.stderr.write(`[cli] pdf 转换失败:${message}\n`);
  return {
    input: job.input,
    format: "pdf",
    ok: false,
    warnings: result.warnings,
    elapsedMs: result.elapsedMs,
    error: message,
    // 码由宿主跨进程透传而来:缺它则 pdf 的落盘失败会落兜底档(3)而非 4
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
  };
}

/** 单个 (输入 × 格式) 的一次尝试:成功与失败都归一成 CliResultItem,失败不中断整批 */
async function convertOne(
  input: string,
  format: ConvertFormat,
  settings: AppSettings,
  pinOutputPath: string | undefined,
  json: boolean,
): Promise<CliResultItem> {
  const started = Date.now();
  try {
    if (format === "pdf") {
      const job: CliPdfJob = {
        input,
        baseDir: path.dirname(input),
        settings: settings as unknown as Record<string, unknown>,
        ...(pinOutputPath !== undefined ? { outputPath: pinOutputPath } : {}),
      };
      return convertPdfViaHost(job);
    }
    const { outputPath, warnings } = await convertDocx(input, settings, pinOutputPath);
    if (!json) reportWarnings(input, warnings);
    return {
      input,
      format,
      ok: true,
      outputPath,
      warnings: warnings.map(warningKey),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[cli] 转换失败(${input} → ${format}):${message}\n`);
    const code = errorCodeOf(error);
    return {
      input,
      format,
      ok: false,
      warnings: [],
      elapsedMs: Date.now() - started,
      error: message,
      // 码随失败项一起上报(itemExitCode 只读它判 4);无码即未登记分类,按兜底档走
      ...(code !== undefined ? { errorCode: code } : {}),
    };
  }
}

/** 人读警告:一律 stderr(--json 模式下 stdout 必须是干净的数据流) */
function reportWarnings(input: string, warnings: readonly unknown[]): void {
  for (const warning of warnings) {
    const text =
      typeof warning === "object" && warning !== null && "fallback" in warning
        ? String((warning as { fallback?: unknown }).fallback)
        : String(warning);
    if (text === "") continue;
    process.stderr.write(`[warn] ${path.basename(input)}: ${text}\n`);
  }
}

/** 警告的 key(结构化输出用;ConvertWarning 是 string | KeyedWarning 联合) */
function warningKey(warning: unknown): string {
  if (typeof warning === "string") return warning;
  if (typeof warning === "object" && warning !== null && "key" in warning) {
    const key = (warning as { key?: unknown }).key;
    if (typeof key === "string") return key;
  }
  return "warning";
}

/** 单项失败的退出码:落盘类错误码 → 4(输出写不了),其余 → 3(转换失败,含码缺失的兜底) */
function itemExitCode(item: CliResultItem): ExitCode {
  if (item.ok) return exitCodes.ok;
  if (isOutputUnwritable(item)) return exitCodes.outputUnwritable;
  return exitCodes.convertFailed;
}

/** 最严重优先:输出写不了(4) > 转换失败(3) > 成功(0) */
function worstExit(results: readonly CliResultItem[]): ExitCode {
  let worst: ExitCode = exitCodes.ok;
  for (const item of results) {
    const code = itemExitCode(item);
    if (code > worst) worst = code;
  }
  return worst;
}

/**
 * 主流程:返回退出码(不直接 process.exit —— 入口守卫处统一收口,便于测试直调)。
 *
 * @param argv 进程参数(不含 node 与脚本路径)
 */
export async function runCli(argv: readonly string[]): Promise<ExitCode> {
  let options: CliParsedOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`[cli] ${error.message}\n\n${usageText()}\n`);
      return exitCodes.usage;
    }
    throw error;
  }
  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return exitCodes.ok;
  }
  // 两种形态分派:readback 是**独立能力**(docx → Markdown),与 md → docx/pdf 无交集。
  if (options.mode === "readback") {
    return runReadback(options);
  }

  const settings = resolveCliSettings(options);
  const formats = expandFormats(options.format);
  const scanWarnings: ConvertWarning[] = [];
  // 目录输入经 collectMarkdownPaths 递归展开(GUI 的导入语义同源,含扫描预算与循环保护)
  const { files } = await collectMarkdownPaths([...options.inputs], scanWarnings);
  if (files.length === 0) {
    process.stderr.write("[cli] 没有可转换的 markdown 文件(输入不存在、不可读,或都不是 .md/.markdown)\n");
    return exitCodes.inputUnreadable;
  }
  // --output 只对唯一输入生效(多输入已在解析期拒绝,此处是类型收窄而非重复校验)
  const pinOutputPath = options.outputPath === undefined ? undefined : path.resolve(options.outputPath);

  const results: CliResultItem[] = [];
  for (const input of files) {
    for (const format of formats) {
      results.push(await convertOne(input, format, settings, pinOutputPath, options.json));
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } else {
    for (const item of results) {
      if (item.ok && item.outputPath !== undefined) process.stdout.write(`${item.outputPath}\n`);
    }
  }
  return worstExit(results);
}

/**
 * readback 形态的编排:读 .docx → 回读成 Markdown + 落图片目录 → 出结果。
 *
 * 落盘经装配层的 `writeReadbackOutput`(这条链路上**唯一**写文件的地方),
 * 产物固定落在源文件同目录(与 GUI 侧同一口径)—— 本形态不支持指定输出路径
 * (`--output` 在该形态判用法错,见 options.ts 的 parseReadbackArgs)。
 *
 * 退出码复用既有四态表:用法错 1 / 输入读不到 2 / 转换失败 3 / 输出写不了 4。
 * 「输出写不了」靠**错误码**判定(不读文案):装配层的落盘失败带
 * `code`(OUTPUT_UNWRITABLE_CODES 族),命中即 4,否则兜底 3 —— 与 convert 形态
 * 的 itemExitCode 同一口径。
 */
async function runReadback(options: CliReadbackOptions): Promise<ExitCode> {
  const input = path.resolve(options.inputs[0]!);
  const started = Date.now();
  let buf: Uint8Array;
  try {
    buf = await readDocxSource(input);
  } catch (err) {
    process.stderr.write(`[cli] 读不到输入文件:${input}(${errorMessage(err)})\n`);
    return exitCodes.inputUnreadable;
  }
  let result: Awaited<ReturnType<typeof readbackDocx>>;
  try {
    result = await readbackDocx(buf);
  } catch (err) {
    process.stderr.write(`[cli] 回读失败:${errorMessage(err)}\n`);
    return exitCodes.convertFailed;
  }
  if (result.status === "unreadable") {
    process.stderr.write("[cli] 回读失败:文件不是有效的 Word 文档(.docx),或已损坏\n");
    return exitCodes.convertFailed;
  }
  let written: Awaited<ReturnType<typeof writeReadbackOutput>>;
  try {
    written = await writeReadbackOutput({
      sourcePath: input,
      root: result.root,
      images: result.images,
    });
  } catch (err) {
    const code = errorCodeOf(err);
    process.stderr.write(`[cli] 回读产物落盘失败:${errorMessage(err)}\n`);
    // 判「输出写不了」只读**错误码**不读文案(与 convert 形态同一口径):码缺失时兜底判
    // 转换失败(保守判失败,不当成功)。
    return code !== undefined && OUTPUT_UNWRITABLE_CODES.has(code)
      ? exitCodes.outputUnwritable
      : exitCodes.convertFailed;
  }
  const item: CliReadbackResultItem = {
    input,
    ok: true,
    markdownPath: written.markdownPath,
    ...(written.mediaDir !== undefined ? { mediaDir: written.mediaDir } : {}),
    counts: result.counts,
    preserved: result.preserved,
    dropped: result.dropped,
    notManaged: result.notManaged,
    elapsedMs: Date.now() - started,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify([item])}\n`);
  } else {
    process.stdout.write(`${item.markdownPath}\n`);
  }
  return exitCodes.ok;
}

/**
 * 入口守卫:被 import(测试直调 runCli)时不接管进程生命周期。
 *
 * 判据取 argv[1] 的文件名而非完整路径 —— 编译产物与源文件同名不同扩展
 * (.ts / .js),两种形态都要能被直接执行。
 */
const entryArg = path.basename(process.argv[1] ?? "");
if (entryArg === "index.js" || entryArg === "index.ts") {
  void runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `[cli] 未预期失败:${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = exitCodes.convertFailed;
    },
  );
}