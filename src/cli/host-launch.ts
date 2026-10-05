/**
 * 「怎么把 pdf 宿主拉起来」的判定 —— CLI 侧**唯一的上下文判定点**。
 *
 * 为什么独立成模块而不是留在 index.ts:该文件头写明「本文件只做编排,不含判定逻辑」,
 * 而这里就是判定逻辑。更实际的原因是**可测**:验收段跑在 Electron 里
 * (`process.versions.electron` 有值),若判定函数直接读全局,「纯 node 上下文」
 * 那条分支在同一个进程里永远测不到 —— 只能靠真跑一次转换来间接观察,而
 * 「两种上下文下的解析结果有断言,不是靠实测日志说话」这条完成标准(载体全文已入档 `docs/evidence/20261003-223213-安装版命令行入口规划与实施复测.md`「步序 1 · 宿主可执行文件定位重构」)。
 * 故拆成「纯判定核心 + 读进程状态的薄封装」两半。
 *
 * 两种上下文(差异**同时**体现在 exe 与 args 上,所以合在一次判定里返回,
 * 不给两处各判一次的机会 —— 那种写法必然在某条分支上漏改):
 *
 * - **源码检出**(本进程是纯 node):宿主是开发态 electron,以**脚本路径**形态启动,
 *   `dist/main/cli-pdf-host.js` 直接充当 Electron 的应用路径。既有形态,参数一字不变。
 * - **已安装**(本进程由 Electron 提供,`ELECTRON_RUN_AS_NODE=1`):宿主就是本进程的
 *   可执行文件,以 **flag 形态**启动(`PDF_HOST_FLAG`)。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDF_HOST_FLAG } from "../convert/cli-pdf-job.js";

/** 本模块目录(编译产物在 dist/cli/) */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** 一次宿主调用的结果:拉起谁、用什么 argv、给它什么环境。 */
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
 * `ELECTRON_RUN_AS_NODE=1` 让 CLI 进程以纯 node 方式跑应用 exe;若子进程继承到它,
 * 宿主就会**也**以纯 node 方式启动 —— 它随即以 `SyntaxError: The requested module
 * 'electron' does not provide an export named 'shell'` 崩掉,结果文件不产出,
 * pdf 转换失败(2026-10-03 实测,退出码 3)。dev 形态同样中招:开发机 shell 里若恰好有
 * 这个变量,dev 形态的宿主一样起不来。
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
 * (编译产物恒在 <root>/dist/cli/ → 上溯一级即 dist/main)。刻意不引 shared/paths.js:
 * 本文件随 dist 分发到打包产物内,而 ROOT 指向**源码仓**,在 asar 内不成立
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
 * 拖进 CLI 的依赖图,那正是门禁 faces-no-host 要挡的形态。
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
 * 而 CLI 也可能被当脚本以不同相对路径启动,信号随调用方式漂 —— 用一个只描述
 * 「本进程是什么」的量,比用「我从哪被叫起来」稳。
 *
 * 单独导出是为了让调用方(index.ts 的报错文案)与判定用的是**同一个**判据;
 * 两处各写一遍 `process.versions.electron` 判断,将来改判据必漏一处。
 */
export function isElectronProvidedNode(): boolean {
  return typeof process.versions.electron === "string";
}

/**
 * 判定核心(纯函数:上下文全由入参给出,便于验收段对两种上下文各断言一次)。
 *
 * @param input.electronProvided 本进程是否由 Electron 提供
 * @param input.execPath已装形态的宿主 exe(= 应用自身)
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
    // ⚠ 漏掉这一行等于把 CLI 自己的形态泄漏给宿主:已安装形态下宿主会跟着以纯 node
    // 启动并崩掉(pdf 失败),dev 形态下开发机 shell 里恰好有该变量时同样中招。
    env: hostEnv(),
  };
}