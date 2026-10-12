// @ts-check
/**
 * supply 门禁家族的共享测试助手(沙盒临时目录 / 沙盒 lockfile / CLI 子进程)—— 单一来源。
 *
 * 为何收成一处:这三个助手是 supply 各段公用的夹具机制。它们此前每段各持一份逐字相同的
 * 私有副本,唯一差异是 withTempDir 的目录名前缀。而这正是最坏的复制形态 —— 任何一段
 * 「顺手改一笔」都只让该段内部仍自洽,没有任何东西会红:「沙盒 lockfile 里没有缺许可证的
 * 包了」在 gen-sbom 段是 NOASSERTION 断言当场红,在别的段却只是少一条夹具成分;而
 * runCli 丢掉 ELECTRON_RUN_AS_NODE=1 时,Electron 宿主下的进程级 CLI 根本跑不起来。
 * 收口后「夹具长什么样」只有这一份定义,改它对全家族同时生效。
 *
 * 前缀**参数化**而不是写死:沙盒目录名带各段自己的前缀(m2w-supply-common- / m2w-sbom- /
 * m2w-licenses- / m2w-sca- / m2w-fulltext-),系统临时区里的残留因此能按段反查,而同机
 * 并发跑的两套验收也不会互相顶歪彼此的前缀统计。
 *
 * 刻意不收的三族(合并不改变任何语义,只改变阅读顺序):
 * - `runCliAsync`:子进程要访问**同进程内**的桩 OSV 服务时必须用异步版 —— spawnSync 会
 *   堵死本进程事件循环,桩服务收不到请求,子进程只会等到超时。它与 runCli 是两个助手,
 *   不是同一函数的两个形态。
 * - 各段专属夹具(makeFallbackLockfile / makeFulltextLockfile / makePackageDir /
 *   makeDecisionLockfile / makeDecisions / makeSandboxLock):回落口径、多选一决策、
 *   许可证全文、五类固定形态各有精确到「哪个包有字段、哪个包只有文件」的断言,
 *   属段自己的口径,与这里的开关式夹具不是一条契约。
 * - 段顶层 `function assert` 窄化壳:harness 的 assert 刻意不声明 `asserts cond`
 *   (TS2775 禁从解构模式调断言函数),依赖收窄的段自带一层壳,逐段保留。
 *
 * 依赖方向单向:只依赖 node 内置模块与 test/harness 的两个既有单一来源
 * (paths.js 的 ROOT、temp-resource.js 的 removeTree),可被 supply 各段直接引用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./paths.js";
import { removeTree } from "./temp-resource.js";

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 *
 * 与 temp-resource.js 的 `withTempResource` 分工:本助手**不进注册表** —— 它是段内
 * 「建了当场就删」的同步沙盒,删除由调用点自己的 finally 保证;注册表服务的是「段崩了 /
 * 忘了 finally 时还能被兜底寻址」那一类跨段资源。两条清理链各有归宿,勿互相「统一」。
 *
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是各段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 *
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @param {string} prefix 目录名前缀(各段不同 ⇒ 系统临时区的残留能按段反查)
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
export async function withTempDir(fn, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 造一份沙盒 lockfile。刻意做成「有生产依赖、有仅 dev 依赖、有嵌套依赖、有缺许可证
 * 的包」,这样 production/dev 判定、copyleft 分类、未知许可证三条都能在同一份夹具上验证。
 * @param {string} dir 沙盒目录
 * @param {{ noLicense?: boolean }} [options] 夹具开关:`noLicense !== false`(缺省)时追加
 *   缺许可证的包 —— 断言 NOASSERTION / 未知许可证 / 待复核计数的段依赖它存在
 * @returns {string} lockfile 绝对路径
 */
export function makeLockfile(dir, options = {}) {
  /** @type {Record<string, any>} */
  const packages = {
    "": {
      name: "sandbox-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "prod-lib": "^1.0.0", "mixed-lib": "^1.0.0" },
      devDependencies: { "dev-tool": "^2.0.0" },
    },
    "node_modules/prod-lib": { version: "1.0.2", resolved: "https://registry.npmmirror.com/prod-lib/-/prod-lib-1.0.2.tgz", integrity: "sha512-aaa", license: "MIT" },
    "node_modules/mixed-lib": { version: "1.0.0", license: "MIT", dependencies: { "inner-lib": "^1.0.0" } },
    "node_modules/mixed-lib/node_modules/inner-lib": { version: "1.0.1", license: "LGPL-3.0-or-later" },
    "node_modules/dev-tool": { version: "2.0.0", dev: true, license: "GPL-3.0-or-later" },
    "node_modules/inner-lib": { version: "1.0.0", license: "Apache-2.0" },
  };
  if (options.noLicense !== false) {
    packages["node_modules/no-license"] = { version: "0.1.0" };
    packages[""].dependencies = { ...packages[""].dependencies, "no-license": "^0.1.0" };
  }
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

/**
 * 跑 CLI 子进程(Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 Node 行为)。
 *
 * 同步版适用于子进程不依赖本进程继续服务事件的场景;异步版是**另一个助手**
 * (check-supply-chain 段的 runCliAsync):子进程要访问同进程内的桩 OSV 服务时必须用
 * 异步版 —— spawnSync 会堵死本进程事件循环,桩服务收不到请求,子进程只会等到超时。
 *
 * @param {string[]} args 脚本参数
 * @returns {{ status: number | null; output: string }} 退出码与 stdout+stderr 合并输出
 */
export function runCli(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
