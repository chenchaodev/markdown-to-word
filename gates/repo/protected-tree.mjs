// 真实工作树零注入的内容指纹:跑前一份快照、跑后一份快照,两者之差即「门禁有没有写坏工作树」。
//
// 守的是**唯一不可替代**的那一格判据(ADR-062 裁决):「让门禁挂在链上跑一次」顶不了它
// —— 跑过这件事没有可判定的机器事实(自指悖论),只有「跑前快照 → 跑后快照 → 取差」这三步
// 才把它变成一个退出码。L11a(存在性)/ L11b(载体不得自我屏蔽)守的是「门禁文件本身没被改坏」,
// 与本格正交。
//
// 落点定在 gates/repo/ 的三个理由:① 它必须**活过 S4**(S4 删的是 gates/probe/,判据不能跟着走)
// ② 它必须能被 gates/repo/check-temp-cleanup.mjs import ③ gates/repo/ 已是仓库级判定体的既有位置。
//
// 被保护路径**从 gates/repo/repo-manifest.mjs 派生**(`topLevel(root).protectedTreePaths`),
// 不在此手写枚举:手写那份漏改的后果是「恒绿失效」—— 新增顶层目录既扫不到也不报错
// (与 gates/probe/gate-probes/contract.mjs 原注释同一失效形态)。
//
// **刻意不设「报告目录豁免」**:沙盒层原先豁免 output/artifacts/gate-probes(探针自己的报告
// 落点),本判据在 check:temp-cleanup 语境下不产出该目录,留一条恒不触发的死分支只会让后来人
// 以为豁免面存在,真出现同名目录时反而没人知道它曾经被豁免。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../shared/paths.js";
import { topLevel } from "./repo-manifest.mjs";

/**
 * @typedef {object} ProtectedTreeState 真实工作树指纹快照
 * @property {Record<string, string>} fingerprints 路径 → 指纹串
 * @property {Map<string, string>} entries 逐文件条目(仓库相对 POSIX 路径 → 字节数:内容哈希前 16)
 * @property {{ exists: boolean, topLevelEntries: number }} nodeModules node_modules 哨兵
 */

/**
 * 收集被保护路径下的全部文件条目(仓库相对 POSIX 路径 → 「字节数:内容哈希前 16」)。
 * @param {string} root 仓库根
 * @returns {Map<string, string>} 条目表
 */
function collectProtectedEntries(root) {
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const relative of topLevel(root).protectedTreePaths) {
    const label = relative.split(path.sep).join("/");
    const absolute = path.join(root, relative);
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
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(child, `${prefix}/${entry.name}`);
          continue;
        }
        if (!entry.isFile()) continue;
        const bytes = fs.readFileSync(child);
        entries.set(`${prefix}/${entry.name}`, `${bytes.length}:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`);
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
 * @param {string} [root] 仓库根(默认 shared/paths.js 的项目根)
 * @returns {ProtectedTreeState} 快照
 */
export function snapshotProtectedTree(root = ROOT) {
  const entries = collectProtectedEntries(root);
  /** @type {Record<string, string>} */
  const fingerprints = {};
  for (const relative of topLevel(root).protectedTreePaths) {
    const label = relative.split(path.sep).join("/");
    fingerprints[label] = [...entries.entries()]
      .filter(([file]) => file === label || file.startsWith(`${label}/`))
      .map(([file, hash]) => `${file}:${hash}`)
      .sort()
      .join("|");
  }
  const nodeModules = path.join(root, "node_modules");
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
 * @param {ProtectedTreeState} before 跑前
 * @param {ProtectedTreeState} after 跑后
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
    // 「完好」= 存在性与顶层项数都未变。**刻意不写成 `after.exists && …`**:那一形态把
    // 「跑前压根没有 node_modules」(未装依赖的检出、临时夹具)恒判成不完好 —— 沙盒层当年
    // 只在真实仓库上求值、那里恒有 node_modules,这条耦合没人发现;本判据要挂到可注入根的
    // 门禁上(夹具按 cwd 指自己的根),耦合会立刻变成「每条夹具都红」的假红。
    nodeModulesIntact: after.nodeModules.exists === before.nodeModules.exists
      && after.nodeModules.topLevelEntries === before.nodeModules.topLevelEntries,
  };
}

/**
 * 变化文件的时间诊断(仅用于控制台,故允许含时间戳)。
 * 用途:区分「跑门禁的人自己写脏了工作树」与「工作树正被别的会话并发修改」——后者会误报,
 * 两者都要让人一眼看出:外部改动的文件 mtime 会正好落在本次运行窗口内。
 * @param {string[]} changedFiles 变化文件(仓库相对)
 * @param {string} [root] 仓库根(默认 shared/paths.js 的项目根)
 * @returns {string} 诊断行(无变化返回空串)
 */
export function describeChangedFiles(changedFiles, root = ROOT) {
  if (changedFiles.length === 0) return "";
  const now = Date.now();
  const shown = changedFiles.slice(0, 8).map((file) => {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) return `${file}(已不存在)`;
    return `${file}(修改于 ${Math.round((now - fs.statSync(abs).mtimeMs) / 1000)}s 前)`;
  });
  const more = changedFiles.length > shown.length ? ` 等 ${changedFiles.length} 个文件` : "";
  return `变化文件:${shown.join(";")}${more} —— 若修改时间落在本次运行窗口内,多半是工作树被其它会话并发修改(本项会误报,请在无并发改动时重跑);否则说明跑门禁的一方写脏了真实工作树,须按只读纪律排查`;
}