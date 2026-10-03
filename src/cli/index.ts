/**
 * CLI 入口(进程外交付面,ADR-060):`node dist/cli/index.js <输入路径...> [选项]`。
 *
 * 本文件只做**编排**,不含判定逻辑:参数解析与设置构造在 options.ts(纯函数),
 * 产物落盘与渲染在装配层(src/convert/),pdf 打印在 Electron 宿主(main/cli-pdf-host.ts)。
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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdownPaths } from "../convert/paths.js";
import { prepareMarkdown } from "../convert/preprocess.js";
import { createConvertContext } from "../convert/context.js";
import { emitConvertedArtifact } from "../convert/run.js";
import {
  exitCodes,
  readJobResult,
  type CliPdfJob,
  type CliPdfJobResult,
  type ExitCode,
} from "../convert/cli-pdf-job.js";
import type { AppSettings, ConvertFormat } from "../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../core/i18n.js";
import {
  CliUsageError,
  expandFormats,
  parseCliArgs,
  resolveCliSettings,
  usageText,
  type CliOptions,
  type CliResultItem,
} from "./options.js";

/** CLI 自身的模块目录(编译产物在 dist/cli/,源在 src/cli/) */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 「输出写不了」的判据(退出码 4 的唯一来源)。
 *
 * 形态上这是**文案匹配**,脆弱;之所以仍这么做:装配层把落盘失败与转换失败都抛成普通
 * Error,没有错误码可判(骨架层不产错误分类)。三处文案都是本仓自己写的且带固定措辞:
 * artifact-writer 的「产物路径已存在」与「不支持硬链接」,paths.ts 的「无法创建输出目录」。
 * 改动那三处文案时必须同改这里 —— 这不是隐式约定,故写明出处。
 *
 * 若将来给装配层加了错误码,本函数应改为读码;在那之前,「三处文案 + 一处判定」
 * 优于「无判定」(脚本无法区分「重名」与「磁盘满」,只能全部当失败处理)。
 */
const OUTPUT_UNWRITABLE_MARKERS = ["产物路径已存在", "不支持硬链接", "无法创建输出目录"] as const;

function isOutputUnwritable(message: string): boolean {
  return OUTPUT_UNWRITABLE_MARKERS.some((marker) => message.includes(marker));
}

/**
 * pdf 宿主产物路径(dist/main/cli-pdf-host.js)。
 *
 * ⚠ 这是**已知的编译产物深度假设**,与 resource-dirs.ts 的 Mermaid 定位同一形态
 * (编译产物恒在 <root>/dist/cli/ → 上溯一级即 dist/main)。刻意不引 shared/paths.js:
 * 本文件随 dist 分发到打包产物内,而 ROOT 指向**源码仓**,在 asar 内不成立
 * (同 smoke.ts 的打包面纪律)。
 */
function pdfHostEntry(): string {
  return path.resolve(moduleDir, "..", "main", "cli-pdf-host.js");
}

/**
 * 定位 Electron 可执行文件(开发态)。
 *
 * 走 `electron` 包的导出(其 index.js 返回 dist/electron[.exe] 的绝对路径),
 * **不 import electron 本身** —— import 它会把 Electron 拖进 CLI 的依赖图,
 * 那正是门禁 faces-no-host 要挡的形态(CLI 必须是纯 node 进程)。
 * electron 是 devDependency,打包形态不随包分发;打包后的 CLI 由应用自身承载,
 * 不经过本函数(与 ADR-060「打包形态的入口」口径一致)。
 */
function resolveDevElectron(): string {
  return String(createRequire(import.meta.url)("electron"));
}

/** 一次性目录(pdf 任务描述用;mkdtemp 保证每次运行都拿到全新目录) */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "m2w-cli-"));
}

/** 删除失败只告警不抛:清理是尽力而为,不该把一次成功的转换判成失败 */
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(
      `[warn] 临时目录清理失败(${dir}):${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
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
 * pdf 经子进程重入 Electron 执行。
 *
 * 任务描述经**文件**而非 argv 传递、结果经**结果文件**返回:设置对象序列化后含嵌套块
 * 与中文,命令行转义在 Windows 上是长期的痛点且长度受限;结果不走 stdout 的理由见
 * convert/cli-pdf-job.ts 的 writeJobResult 注释(Windows 管道 + app.exit 会丢数据)。
 * 两个文件同在一次性目录,由本函数统一回收。
 */
function convertPdfViaHost(job: CliPdfJob): CliResultItem {
  const tempDir = makeTempDir();
  try {
    const jobPath = path.join(tempDir, "job.json");
    const resultPath = path.join(tempDir, "result.json");
    fs.writeFileSync(jobPath, JSON.stringify(job), "utf8");
    const run = spawnSync(resolveDevElectron(), [pdfHostEntry(), jobPath, resultPath], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (run.error) {
      // 未找到 Electron 可执行文件 = 环境前置条件未满足,不是转换失败
      process.stderr.write(
        `[cli] pdf 需要 Electron 宿主,开发态下未能启动:${run.error.message}\n` +
          "[cli] 请先执行 npm install;或改用 --format docx(pdf 无宿主不可用)\n",
      );
      return { input: job.input, format: "pdf", ok: false, warnings: [], elapsedMs: 0, error: run.error.message };
    }
    let result: CliPdfJobResult;
    try {
      result = readJobResult(resultPath);
    } catch (error) {
      process.stderr.write(
        `[cli] pdf 宿主未产出结果(退出码 ${run.status ?? "null"},${run.stderr ?? ""}):` +
          `${error instanceof Error ? error.message : String(error)}\n`,
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
    };
  } finally {
    cleanupTempDir(tempDir);
  }
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
    return { input, format, ok: false, warnings: [], elapsedMs: Date.now() - started, error: message };
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

/** 单项失败的退出码:落盘类文案 → 4(输出写不了),其余 → 3(转换失败) */
function itemExitCode(item: CliResultItem): ExitCode {
  if (item.ok) return exitCodes.ok;
  if (item.error !== undefined && isOutputUnwritable(item.error)) return exitCodes.outputUnwritable;
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
  let options: CliOptions;
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