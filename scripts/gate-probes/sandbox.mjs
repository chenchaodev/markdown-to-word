// 沙盒与真实工作树守护:工程副本的建/构建/清,以及「真实工作树零注入」的内容指纹。
//
// 沙箱纪律的落点全在这里(其它 island 只调用,不自行摸文件系统根):
// - 一切故障注入只发生在系统临时目录的副本里;node_modules 以目录联接挂入,清理时先摘
//   链接再删目录(绝不递归真实依赖);
// - 探针前后对真实工作树做内容指纹(相对路径 + 字节数 + SHA-256)+ node_modules 哨兵,
//   不一致即由 report 层判红;
// - 报告自身所在目录从指纹里豁免:它是探针的产物,不算工作树被改动。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROTECTED_PATHS, REPORT_DIR_RELATIVE, ROOT, SANDBOX_PREFIX, TREE_MIRROR_PATHS } from "./contract.mjs";
import { runProcess } from "../smoke-proc.mjs";
import { resolveNode } from "./proc.mjs";

// TS 的 JS 模式下 JSDoc typedef 是**文件作用域**:不显式引入就会解析失败并静默退化为 any,
// 使下游(段)的回调参数变成隐式 any 而报 TS7006。下列 typedef 只作类型引入,无运行时开销。
/** @typedef {import("./contract.mjs").ProtectedTreeState} ProtectedTreeState */

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
 * 收集被保护路径下的全部文件条目(仓库相对 POSIX 路径 → 「字节数:内容哈希前 16」)。
 * 报告自身所在目录(REPORT_DIR_RELATIVE)被跳过:它是探针的产物,不算工作树被改动。
 * @returns {Map<string, string>} 条目表
 */
function collectProtectedEntries() {
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const relative of PROTECTED_PATHS) {
    const label = relative.split(path.sep).join("/");
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) {
      entries.set(label, "<absent>");
      continue;
    }
    /**
     * @param {string} dir 当前目录
     * @param {string} prefix 当前目录的仓库相对前缀
     * @returns {void}
     */
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relativeChild = `${prefix}/${entry.name}`;
        if (relativeChild === REPORT_DIR_RELATIVE || relativeChild.startsWith(`${REPORT_DIR_RELATIVE}/`)) continue;
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(child, relativeChild);
          continue;
        }
        if (!entry.isFile()) continue;
        const bytes = fs.readFileSync(child);
        entries.set(relativeChild, `${bytes.length}:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`);
      }
    };
    if (fs.statSync(absolute).isDirectory()) {
      walk(absolute, label);
    } else {
      const bytes = fs.readFileSync(absolute);
      entries.set(label, `${bytes.length}:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`);
    }
  }
  return entries;
}

/**
 * 真实工作树指纹快照(被保护路径 + 逐文件条目 + node_modules 哨兵)。
 * @returns {ProtectedTreeState} 快照
 */
export function snapshotProtectedTree() {
  const entries = collectProtectedEntries();
  /** @type {Record<string, string>} */
  const fingerprints = {};
  for (const relative of PROTECTED_PATHS) {
    const label = relative.split(path.sep).join("/");
    fingerprints[label] = [...entries.entries()]
      .filter(([file]) => file === label || file.startsWith(`${label}/`))
      .map(([file, hash]) => `${file}:${hash}`)
      .sort()
      .join("|");
  }
  const nodeModules = path.join(ROOT, "node_modules");
  return {
    fingerprints,
    entries,
    nodeModules: {
      exists: fs.existsSync(nodeModules),
      topLevelEntries: fs.existsSync(nodeModules) ? fs.readdirSync(nodeModules).length : 0,
    },
  };
}

/**
 * 比对两份工作树快照,返回发生变化(或消失)的路径与具体文件。
 * @param {ProtectedTreeState} before 探针前
 * @param {ProtectedTreeState} after 探针后
 * @returns {{ unchanged: boolean, changedPaths: string[], changedFiles: string[], nodeModulesIntact: boolean }}
 */
export function diffProtectedTree(before, after) {
  /** @type {string[]} */
  const changedPaths = [];
  for (const [label, fingerprint] of Object.entries(before.fingerprints)) {
    if (after.fingerprints[label] !== fingerprint) changedPaths.push(label);
  }
  /** @type {string[]} */
  const changedFiles = [];
  for (const [file, hash] of after.entries) {
    if (before.entries.get(file) !== hash) changedFiles.push(file);
  }
  for (const file of before.entries.keys()) {
    if (!after.entries.has(file)) changedFiles.push(file);
  }
  return {
    unchanged: changedPaths.length === 0,
    changedPaths,
    changedFiles: [...new Set(changedFiles)].sort(),
    nodeModulesIntact: after.nodeModules.exists && after.nodeModules.topLevelEntries === before.nodeModules.topLevelEntries,
  };
}

/**
 * 变化文件的时间诊断(仅用于控制台,故允许含时间戳 —— 报告 JSON 仍保持确定性)。
 * 用途:区分「探针自己写脏了工作树」与「工作树正被别的会话并发修改」——后者会误报,
 * 两者都要让人一眼看出:外部改动的文件 mtime 会正好落在探针运行窗口内。
 * @param {string[]} changedFiles 变化文件(仓库相对)
 * @returns {string} 诊断行(无变化返回空串)
 */
export function describeChangedFiles(changedFiles) {
  if (changedFiles.length === 0) return "";
  const now = Date.now();
  const shown = changedFiles.slice(0, 8).map((file) => {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) return `${file}(已不存在)`;
    return `${file}(修改于 ${Math.round((now - fs.statSync(abs).mtimeMs) / 1000)}s 前)`;
  });
  const more = changedFiles.length > shown.length ? ` 等 ${changedFiles.length} 个文件` : "";
  return `变化文件:${shown.join(";")}${more} —— 若修改时间落在本次探针运行窗口内,多半是工作树被其它会话并发修改(本项会误报,请在无并发改动时重跑);否则说明探针写脏了真实工作树,须按沙箱纪律排查`;
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
    args: [path.join(root, "scripts", "copy-renderer.mjs")],
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
