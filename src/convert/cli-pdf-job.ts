/**
 * CLI ↔ pdf 宿主之间的**任务描述契约**(纯数据 + 纯函数,零 IO 依赖以外的东西)。
 *
 * 为什么住在 convert 层:pdf 能力是宿主能力,装配层不自带(ADR-060 后果 2),
 * 于是 CLI 侧必须「壳自动重入 Electron」去做 pdf —— 本模块就是那次重入的传话协议。
 * 协议被两个**同层 adapter**(cli 与 main)共用,故按既有先例(跨面契约如
 * `PdfPrinter` 住在 convert/run.ts)放装配层:cli → convert 与 main → convert
 * 都是合法方向,而 cli → main / main → cli 都不是。
 *
 * 本模块零 electron、零 fs(除 readJob 的读文件):可被纯 node 直测。
 */
import fs from "node:fs";

/** 退出码表(单一来源):CLI 主进程与 pdf 宿主子进程共用,保证两侧语义逐字一致。 */
export const exitCodes = Object.freeze({
  ok: 0,
  usage: 1,
  inputUnreadable: 2,
  convertFailed: 3,
  outputUnwritable: 4,
} as const);

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

/** 一次 pdf 转换任务的完整描述(CLI 写文件 → pdf 宿主读文件)。 */
export interface CliPdfJob {
  /** 输入 markdown 绝对路径 */
  input: string;
  /** 图片相对路径的解析基准目录(= 输入文件所在目录) */
  baseDir: string;
  /** 本次设置(CLI 由 DEFAULT_SETTINGS + --template 构造;不含迁移瞬时字段) */
  settings: Record<string, unknown>;
  /** 钉死的产物路径(CLI 的 --output);缺省 = 源文件旁同名换扩展名 */
  outputPath?: string;
}

/**
 * 读任务描述文件。
 *
 * 失败**抛错**而非返回 undefined:调用方(pdf 宿主)据此判「调用方传错了」,
 * 与「转换失败」分属不同退出码 —— 返回 undefined 会把两者压成同一个码。
 */
export function readJob(jobPath: string): CliPdfJob {
  const raw = fs.readFileSync(jobPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`pdf 任务描述不是对象:${jobPath}`);
  }
  const job = parsed as Record<string, unknown>;
  // 必填字段逐个断言(不做整体信任):pdf 宿主拿不到正确的 input/baseDir/settings
  // 时会在很远的地方炸,报错信息指向不了「是任务描述坏了」。
  // settings 是**对象**不是字符串 —— 它是 AppSettings 的序列化结果,故分开校验。
  for (const key of ["input", "baseDir"] as const) {
    if (typeof job[key] !== "string" || job[key] === "") {
      throw new Error(`pdf 任务描述缺字段 ${key}:${jobPath}`);
    }
  }
  if (typeof job.settings !== "object" || job.settings === null || Array.isArray(job.settings)) {
    throw new Error(`pdf 任务描述缺字段 settings:${jobPath}`);
  }
  if (job.outputPath !== undefined && typeof job.outputPath !== "string") {
    throw new Error(`pdf 任务描述的 outputPath 不是字符串:${jobPath}`);
  }
  return {
    input: job.input as string,
    baseDir: job.baseDir as string,
    settings: job.settings as Record<string, unknown>,
    ...(job.outputPath !== undefined ? { outputPath: job.outputPath as string } : {}),
  };
}

/** 一次 pdf 转换的结果(宿主写、CLI 读)。字段与 CLI 的 CliResultItem 同构。 */
export interface CliPdfJobResult {
  ok: boolean;
  /** 产物绝对路径;失败时缺席 */
  outputPath?: string;
  /** 警告 key 列表 */
  warnings: string[];
  /** 耗时(ms) */
  elapsedMs: number;
  /** 失败原因(人读文案);ok 为真时缺席 */
  error?: string;
}

/**
 * 写结果到文件(同步)。
 *
 * ⚠ 为什么结果**不走 stdout**:实测(2026-10-03)Electron 子进程在 Windows 上把 stdout
 * 接到管道时,`process.stdout.write` 是异步的,而 `app.exit()` 立即终止进程不等落盘 ——
 * 症状是「子进程退出码 0、父进程读到空 stdout」,且只在真实调用形态(管道)下出现,
 * 重定向到文件时完全正常,是典型的「只在生产形态暴露」类坑。文件写是同步的,无此问题。
 * 代价是多一次临时文件读写(与任务描述同一个临时目录,生命周期由 CLI 侧统一回收)。
 */
export function writeJobResult(resultPath: string, result: CliPdfJobResult): void {
  fs.writeFileSync(resultPath, JSON.stringify(result), "utf8");
}

/**
 * 读结果文件。**文件不存在**即视为「宿主没跑完」(被强杀 / 启动失败):
 * 此时抛错而非返回 undefined,调用方据此归为转换失败而不是「成功的空结果」。
 */
export function readJobResult(resultPath: string): CliPdfJobResult {
  const raw = fs.readFileSync(resultPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`pdf 结果不是对象:${resultPath}`);
  }
  return parsed as CliPdfJobResult;
}