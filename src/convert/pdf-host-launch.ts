/**
 * 「怎么把 pdf 宿主拉起来」+「一次任务怎么传话」—— **cli 与 mcp 共用**的一份。
 *
 * **为什么住在 convert 层**:ADR-060 定了 `cli` 与 `mcp` 是同一层的两个 adapter、
 * **二者零依赖**(见 ADR-060 分层段),故两面共用的机制只能落在两层之下 —— 与
 * `delivery-settings.ts`「共同依赖下沉到装配层」同一处置。本模块原先住在
 * `src/cli/host-launch.ts`,那是在**只有 CLI 用 pdf** 时代的就近放置:它自己就
 * `import { PDF_HOST_FLAG } from "../convert/cli-pdf-job.js"`,已经是半个装配层模块
 * 落在交付面下。MCP 也要用 pdf 之后,两份拉起判定(尤其下面 `hostEnv` 那条
 * 「必须 delete、不能置 0」的 env 不变量)留在 cli 侧只会逼出第二份会漂的副本。
 *
 * 两块内容:
 * - **判定**(`decideHostInvocation` / `hostInvocation` / `hostEnv` …):本进程是什么形态
 *   ⇒ 拉起谁、用什么 argv、给它什么环境;
 * - **传话**(`runPdfHostJob`):写任务文件 → spawn 宿主 → 读结果文件 → 回收临时目录。
 *
 * **本模块不写任何 stdout/stderr**:两个消费面各有自己的流约定(CLI 的 stdout 是数据
 * 通道、诊断走 stderr;MCP 的 stdout 是协议帧通道),诊断文案与前缀也各面不同 ⇒ 失败
 * 以**结构化的返回形态**交回调用方,由调用方按自己的约定拼文案。
 *
 * ⚠ 依赖方向:本模块 import `node:child_process` 与 `./cli-pdf-job.js`,**不 import
 * electron**、不 import 任何交付面(见门禁 `convert-no-host` / `convert-no-gui`)。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDF_HOST_FLAG, readJobResult, type CliPdfJob, type CliPdfJobResult } from "./cli-pdf-job.js";

/** 本模块目录(编译产物在 <root>/dist/convert/) */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** 一次宿主调用的结果:拉起谁、用什么 argv。 */
export interface HostLaunchTarget {
  /** 宿主可执行文件的绝对路径 */
  exe: string;
  /** 传给它的 argv(不含 exe 自身) */
  args: string[];
}

/** 一次宿主调用的完整结果(在拉起目标之外还须指定环境,理由见 hostEnv)。 */
export interface HostInvocation extends HostLaunchTarget {
  /** 传给子进程的环境变量(已剔除会改变宿主形态的那些) */
  env: NodeJS.ProcessEnv;
}

/**
 * 宿主子进程的环境变量 —— **必须显式剔除 `ELECTRON_RUN_AS_NODE`**。
 *
 * 为什么这是硬要求而不只是「顺手清理」:已安装形态由 launcher 设
 * `ELECTRON_RUN_AS_NODE=1` 让交付面进程以纯 node 方式跑应用 exe;若子进程继承到它,
 * 宿主就会**也**以纯 node 方式启动 —— 它随即以 `SyntaxError: The requested module
 * 'electron' does not provide an export named 'shell'` 崩掉,结果文件不产出,
 * pdf 转换失败(2026-10-03 实测,退出码 3)。开发态同样中招:开发机 shell 里若恰好有
 * 这个变量,宿主一样起不来。
 *
 * ⚠ **必须 `delete`,不能置 `=0`** —— Electron 只判断该变量**是否存在**,不看取值。
 * 实测 `ELECTRON_RUN_AS_NODE=0` 与 `=1` 同样导致宿主崩溃(两者都留下 ENOENT result.json)。
 * 写成 `env: { ...process.env, ELECTRON_RUN_AS_NODE: "0" }` 是**看起来修了其实没修**。
 *
 * ⚠ `ELECTRON_NO_ASAR` 同样会改变形态(置 1 会让 asar 不再透明,已安装形态随即读不到
 * 自己的代码),但**本函数暂不剔除它**:是否该剔除、以及「置空」是否有效都还没实测,
 * 凭推测加进剔除列表比留着更危险。它记在载体「修复项复测 · 2026-10-03 · 步序 1 开工」里待验(全文见 `docs/evidence/20261003-223213-安装版命令行入口规划与实施复测.md`)。
 *
 * @param source 环境来源(默认当前进程);抽成入参是为了能在验收段里对两种污染态断言
 * @returns 新的环境对象 —— **不修改传入的那个**
 */
export function hostEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * 源码检出形态的宿主脚本入口(`dist/main/cli-pdf-host.js`)。
 *
 * ⚠ 这是**已知的编译产物深度假设**,与 resource-dirs.ts 的 Mermaid 定位同一形态
 * (编译产物恒在 <root>/dist/convert/ → 上溯一级即 dist/main)。刻意不引 shared/paths.js:
 * 本模块随 dist 分发到打包产物内,而 ROOT 指向**源码仓**,在 asar 内不成立
 * (同 smoke.ts 的打包面纪律)。
 *
 * 已安装形态**用不到**这个函数产出的路径(走 flag),它在那里只是被算出来不生效。
 */
export function pdfHostEntry(): string {
  return path.resolve(moduleDir, "..", "main", "cli-pdf-host.js");
}

/**
 * 源码检出形态的宿主 exe —— 走 `electron` 包的导出(其 index.js 返回
 * dist/electron[.exe] 的绝对路径),**不 import electron 本身**:import 它会把 Electron
 * 拖进交付面的依赖图,那正是门禁 `faces-no-host`(与 `convert-no-host`)要挡的形态。
 *
 * ⚠ 已安装形态**不能**用它:electron 是 devDependency、打包时该包被剥离,且它的
 * index.js 读的是 `path.txt` —— 那文件只在开发机安装时生成、发布包内根本没有。
 * 依据与实测见 `docs/evidence/20261003-180918-命令行exe分发路径调研.md` §四·D0。
 */
function resolveDevElectron(): string {
  return String(createRequire(import.meta.url)("electron"));
}

/**
 * 当前进程是否由 Electron 提供(而非纯 node)。
 *
 * 判据取 `process.versions.electron` 是否有值:它只在 Electron 进程里存在
 * (含 `ELECTRON_RUN_AS_NODE` 形态),纯 node 下是 undefined。
 * 刻意**不用**「自己的路径里有没有 app.asar」这类间接信号:那要读 `argv[1]`,
 * 而交付面也可能被当脚本以不同相对路径启动,信号随调用方式漂 —— 用一个只描述
 * 「本进程是什么」的量,比用「我从哪被叫起来」稳。
 *
 * 单独导出是为了让调用方(各自拼「宿主不可用」的报错文案)与判定用的是**同一个**判据;
 * 两处各写一遍 `process.versions.electron` 判断,将来改判据必漏一处。
 */
export function isElectronProvidedNode(): boolean {
  return typeof process.versions.electron === "string";
}

/**
 * 判定核心(纯函数:上下文全由入参给出,便于验收段对两种上下文各断言一次)。
 *
 * 两种上下文(差异**同时**体现在 exe 与 args 上,所以合在一次判定里返回,
 * 不给两处各判一次的机会 —— 那种写法必然在某条分支上漏改):
 *
 * - **源码检出**(本进程是纯 node):宿主是开发态 electron,以**脚本路径**形态启动,
 *   `dist/main/cli-pdf-host.js` 直接充当 Electron 的应用路径。既有形态,参数一字不变。
 * - **已安装**(本进程由 Electron 提供,`ELECTRON_RUN_AS_NODE=1`):宿主就是本进程的
 *   可执行文件,以 **flag 形态**启动(`PDF_HOST_FLAG`)。
 *
 * @param input.electronProvided 本进程是否由 Electron 提供
 * @param input.execPath 已装形态的宿主 exe(= 应用自身)
 * @param input.devElectron 源码检出形态的宿主 exe(已装形态下可传空串,不会被读)
 * @param input.devEntry 源码检出形态的脚本入口
 */
export function decideHostInvocation(input: {
  electronProvided: boolean;
  execPath: string;
  devElectron: string;
  devEntry: string;
  jobPath: string;
  resultPath: string;
}): HostLaunchTarget {
  return input.electronProvided
    ? { exe: input.execPath, args: [PDF_HOST_FLAG, input.jobPath, input.resultPath] }
    : { exe: input.devElectron, args: [input.devEntry, input.jobPath, input.resultPath] };
}

/**
 * 生产入口:从进程状态取上下文后判定。
 *
 * ⚠ `resolveDevElectron()` **只在 dev 分支里调** —— 已装形态下 `electron` 包不存在,
 * 无条件解析会在这里抛错,而那正是本函数存在的理由(见 resolveDevElectron 的注释)。
 * 这行若被改成无条件调用,已安装用户会拿到一个「找不到模块」的裸栈,而不是
 * 「pdf 需要宿主」的可读提示 —— 是本函数要防的那类失败自己撞进来了。
 */
export function hostInvocation(jobPath: string, resultPath: string): HostInvocation {
  const electronProvided = isElectronProvidedNode();
  return {
    ...decideHostInvocation({
      electronProvided,
      execPath: process.execPath,
      devElectron: electronProvided ? "" : resolveDevElectron(),
      devEntry: pdfHostEntry(),
      jobPath,
      resultPath,
    }),
    // ⚠ 漏掉这一行等于把调用方自己的形态泄漏给宿主:已安装形态下宿主会跟着以纯 node
    // 启动并崩掉(pdf 失败),dev 形态下开发机 shell 里恰好有该变量时同样中招。
    env: hostEnv(),
  };
}

/**
 * 一次「拉起宿主跑完一个 pdf 任务」的完整结果。
 *
 * **四态而非一个 error 字符串**:四者的**下一步动作不同**(环境前置未满足 / 宿主异常 /
 * 被超时掐掉 / 转换本身失败),压成一个字符串就等于把这份判断推回每个调用方各写一份。
 * `result.ok` 为假时**转换失败的原因在 `result.error` 里**,与上面三态正交。
 */
export type PdfHostRun =
  /** 宿主跑完了,并产出了可读的结果文件(注意 `ok` 指「机制跑完了」,转换本身成不成功读 `result.ok`) */
  | { ok: true; reason: "done"; result: CliPdfJobResult; cleanupWarning?: string }
  /** 宿主可执行文件起不来 = 环境前置条件未满足(不是转换失败) */
  | { ok: false; reason: "spawn-failed"; message: string; cleanupWarning?: string }
  /** 起来了但没产出结果文件(崩在 ready 之前 / 被强杀 / 写不了结果) */
  | {
      ok: false;
      reason: "no-result";
      message: string;
      exitStatus: number | null;
      stderr: string;
      cleanupWarning?: string;
    }
  /** 超过调用方给的时限,宿主已被强杀 */
  | { ok: false; reason: "timeout"; timeoutMs: number; cleanupWarning?: string };

/** 一次性目录(pdf 任务描述用;mkdtemp 保证每次运行都拿到全新目录) */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "m2w-pdf-host-"));
}

/**
 * 删除临时目录;清理失败**只返回告警不抛** —— 清理是尽力而为,不该把一次成功的转换
 * 判成失败(产物早已落盘,删不掉的是临时文件)。
 *
 * @returns 清理失败时的告警文案;成功即 undefined(交回调用方按各自前缀写诊断)
 */
function cleanupTempDir(dir: string): string | undefined {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return undefined;
  } catch (error) {
    return `临时目录清理失败(${dir}):${error instanceof Error ? error.message : String(error)}`;
  }
}

/** 真正跑一次宿主调用(临时目录由调用者分配,故本函数不负责回收) */
function invokeHost(tempDir: string, job: CliPdfJob, timeoutMs: number | undefined): PdfHostRun {
  const jobPath = path.join(tempDir, "job.json");
  const resultPath = path.join(tempDir, "result.json");
  // 任务描述经**文件**而非 argv 传递、结果经**结果文件**返回:设置对象序列化后含嵌套块
  // 与中文,命令行转义在 Windows 上是长期的痛点且长度受限;结果不走 stdout 的理由见
  // cli-pdf-job.ts 的 writeJobResult 注释(Windows 管道 + app.exit 会丢数据)。
  fs.writeFileSync(jobPath, JSON.stringify(job), "utf8");
  const host = hostInvocation(jobPath, resultPath);
  const run = spawnSync(host.exe, host.args, {
    // ⚠ env 必须显式给:不传就是全继承,已安装形态下宿主会跟着以纯 node 启动并崩掉
    // (ELECTRON_RUN_AS_NODE 泄漏,详见本文件 hostEnv 注释)
    env: host.env,
    encoding: "utf8",
    windowsHide: true,
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  });
  if (run.error) {
    // 超时要与「起不来」分属两态:前者是调用方给了时限并被触发(可提示调时限/拆小输入),
    // 后者是环境前置未满足(提示装宿主)。合成一句「启动失败」会让两种下一步动作都指错方向。
    // 读法:`run.error` 是 spawnSync 的产物,带 NodeJS.ErrnoException 的 `code`;
    // 这里按结构收窄而不是断言类型(拿不到 code 时自然落「起不来」那一档)。
    const code = (run.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT" && timeoutMs !== undefined) {
      return { ok: false, reason: "timeout", timeoutMs };
    }
    return { ok: false, reason: "spawn-failed", message: run.error.message };
  }
  try {
    return { ok: true, reason: "done", result: readJobResult(resultPath) };
  } catch (error) {
    return {
      ok: false,
      reason: "no-result",
      message: error instanceof Error ? error.message : String(error),
      exitStatus: run.status ?? null,
      stderr: run.stderr ?? "",
    };
  }
}

/**
 * 跑完一次 pdf 转换任务(写任务 → spawn 宿主 → 读结果 → 回收临时目录)。
 *
 * 临时目录与两个文件同在一次 `mkdtemp` 里、由本函数统一回收:调用方只给任务描述,
 * 拿不到也不该管临时路径。
 *
 * @param job 任务描述(契约见 cli-pdf-job.ts)
 * @param options.timeoutMs 硬上限;给了就由 `spawnSync` 计时强杀宿主。
 *   **CLI 不给**(等多久是人的决定,ADR-060 入口能力矩阵「生命周期」行);
 *   MCP 必须给 —— 它是长驻进程,没有「用户关窗口」这个天然中止时机。
 * @returns 四态之一(见 `PdfHostRun`)
 */
export function runPdfHostJob(job: CliPdfJob, options: { timeoutMs?: number } = {}): PdfHostRun {
  const tempDir = makeTempDir();
  // 回收放在拿结果之后、返回之前(不是 finally):返回对象是**值**,
  // finally 里赋值不会出现在已经构造好的返回值上,告警会静默丢失。
  const outcome = invokeHost(tempDir, job, options.timeoutMs);
  const cleanupWarning = cleanupTempDir(tempDir);
  return cleanupWarning === undefined ? outcome : { ...outcome, cleanupWarning };
}