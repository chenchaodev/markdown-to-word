// 沙盒建/构建/清:工程副本的建(整树镜像 + node_modules 联接)、沙盒内构建、删沙盒。
//
// 沙箱纪律的落点全在这里(其它 island 只调用,不自行摸文件系统根):
// 一切故障注入只发生在系统临时目录的副本里;node_modules 以目录联接挂入,清理时先摘
// 链接再删目录(绝不递归真实依赖)。
//
// 「真实工作树零注入」的内容指纹**不在本文件**:它必须活过 S4(删 gates/probe/ 这一步),
// 落点是 gates/repo/protected-tree.mjs,由已在链上的 gates/repo/check-temp-cleanup.mjs 调用。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, SANDBOX_PREFIX, TREE_MIRROR_PATHS } from "./contract.mjs";
import { runProcess } from "../../smoke/smoke-proc.mjs";
import { resolveNode } from "./proc.mjs";

/**
 * 在沙盒内写文件(自动建父目录)。
 * @param {string} root 沙盒根
 * @param {string} relative POSIX 风格相对路径
 * @param {string | Buffer} content 内容
 * @returns {string} 落盘绝对路径
 */
export function writeFileIn(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/**
 * 摘掉一个联接/符号链接(非递归,只删链接本身,绝不递归真实目录)。
 *
 * 为什么不能一条 `rmSync(path, { force: true })` 走天下:同一段代码在纯 node 下可用,
 * 在 Electron 里会抛 `Path is a directory`(Electron 的 fs 层对「指向目录的链接」的
 * 判定与 node 不同)。两条按优先级试的删除方式都不递归:unlink 适用于符号链接;
 * Windows 上对 junction 用 rmdir 只摘掉 reparse point、不碰目标目录内容。
 * 两条都不行时交给纯 node 子进程(段内跑在 Electron 里,fs 层不可靠)。
 * @param {string} target 联接路径
 * @returns {boolean} true = 已摘除
 */
function removeJunction(target) {
  for (const remove of [fs.unlinkSync, fs.rmdirSync]) {
    try {
      remove(target);
      if (!fs.existsSync(target)) return true;
    } catch {
      // 换下一种方式
    }
  }
  const node = resolveNode();
  const child = spawnSync(
    node.command,
    ["-e", `require("node:fs").unlinkSync(${JSON.stringify(target)})`],
    { stdio: "ignore", windowsHide: true, env: node.env },
  );
  return child.status === 0 && !fs.existsSync(target);
}

/**
 * 删沙盒:先摘掉 node_modules 联接(非递归,只摘链接不碰真实目录),再删沙盒本体。
 * 联接若不是符号链接(junction 在 Windows 上被 lstat 记为符号链接)则拒绝删除,
 * 宁可让沙盒残留也不误删真实依赖目录。本函数不抛错:清理失败只留告警,由调用方
 * 登记为 advisory —— 清理异常不得盖过门禁本身的判定。
 * @param {string} root 沙盒根
 * @returns {string[]} 清理过程中的告警(非空即表示有残留)
 */
export function removeSandbox(root) {
  /** @type {string[]} */
  const warnings = [];
  if (!fs.existsSync(root)) return warnings;
  const junction = path.join(root, "node_modules");
  if (fs.existsSync(junction)) {
    if (!fs.lstatSync(junction).isSymbolicLink()) {
      warnings.push(`沙盒 node_modules 不是联接,已跳过删除(避免误删真实依赖):${path.basename(junction)}`);
      return warnings;
    }
    if (!removeJunction(junction)) {
      warnings.push(`沙盒 node_modules 联接摘除失败,已保留整个沙盒(避免误删真实依赖):${path.basename(junction)}`);
      return warnings;
    }
  }
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    warnings.push(`沙盒目录删除失败(可能有句柄占用):${path.basename(root)}`);
    return warnings;
  }
  if (fs.existsSync(root)) warnings.push(`沙盒目录删除后仍存在:${path.basename(root)}`);
  return warnings;
}

/**
 * 建工程副本沙盒:逐字节复制 TREE_MIRROR_PATHS + node_modules 目录联接。
 * 保留时间戳(preserveTimestamps)以免复制动作本身把 src/dist 的新鲜度关系搅乱。
 * @returns {string} 沙盒根
 */
export function createTreeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  for (const relative of TREE_MIRROR_PATHS) {
    const source = path.join(ROOT, relative);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(root, relative), { recursive: true, preserveTimestamps: true });
  }
  const realNodeModules = path.join(ROOT, "node_modules");
  if (fs.existsSync(realNodeModules)) {
    fs.symlinkSync(realNodeModules, path.join(root, "node_modules"), "junction");
  }
  return root;
}

/**
 * 沙盒内构建(src → dist + renderer 资源拷贝),使门禁在「刚 build 完」的形态下被探测。
 *
 * 为什么不用 `npm run build`:那要经 cmd.exe 走 .bin 批处理垫片,引入了与被测行为无关的
 * shell 层。改为直接跑 npm 脚本背后的同一个编译器入口,并核对 .bin 垫片确实指向它
 * (核对结果写进报告,不一致即登记 caveat,而不是默默换编译器)。
 *
 * @param {string} root 沙盒根
 * @param {number} timeoutMs 硬超时
 * @returns {Promise<{ clean: boolean, compilerExitCode: number | null, rendererExitCode: number | null, errorFiles: string[], caveat?: string }>}
 */
export async function buildSandbox(root, timeoutMs) {
  const shim = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  const shimText = fs.existsSync(shim) ? fs.readFileSync(shim, "utf8").replace(/\\/g, "/") : "";
  const candidates = [
    path.join(ROOT, "node_modules", "@typescript", "native", "bin", "tsc"),
    path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  ];
  const compiler = candidates.find((candidate) => fs.existsSync(candidate));
  /** @type {string[]} */
  const errorFiles = [];
  if (compiler === undefined) {
    return {
      clean: false,
      compilerExitCode: null,
      rendererExitCode: null,
      errorFiles,
      caveat: "沙盒内找不到 tsc 入口,构建未执行(dist 为复制自真实工作树的产物)",
    };
  }
  // 垫片一致性核对:取编译器入口所属包名,确认 .bin 垫片确实指向它(不一致即登记 caveat)
  const packageJson = path.join(compiler, "..", "..", "package.json");
  const compilerPackage = fs.existsSync(packageJson)
    ? (JSON.parse(fs.readFileSync(packageJson, "utf8")).name ?? "")
    : "";
  const node = resolveNode();
  const compiled = await runProcess({
    command: node.command,
    args: [compiler],
    cwd: root,
    env: node.env,
    timeoutMs,
  });
  for (const match of compiled.output.matchAll(/^(src[/\\][^(]+)\(/gm)) {
    const file = (match[1] ?? "").split(path.sep).join("/");
    if (!errorFiles.includes(file)) errorFiles.push(file);
  }
  const renderer = await runProcess({
    command: node.command,
    args: [path.join(root, "tools", "copy-renderer.mjs")],
    cwd: root,
    env: node.env,
    timeoutMs,
  });
  /** @type {string | undefined} */
  let caveat;
  if (shimText !== "" && compilerPackage !== "" && !shimText.includes(compilerPackage)) {
    caveat = `node_modules/.bin/tsc 垫片未指向本次使用的编译器(${compilerPackage}),沙盒构建可能与 npm run build 有偏差`;
  }
  return {
    clean: compiled.code === 0 && renderer.code === 0 && errorFiles.length === 0,
    compilerExitCode: compiled.code,
    rendererExitCode: renderer.code,
    errorFiles,
    ...(caveat === undefined ? {} : { caveat }),
  };
}
