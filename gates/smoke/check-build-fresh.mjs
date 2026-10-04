// 构建新鲜度守卫脚本
//
// 用途:test:smoke 直接运行 dist/ 下的构建产物。若 src 近期有改动但未重新 build,
// 无此守卫时 smoke 测试会用旧产物得出误导性结果。本脚本递归对比 src/** 与 dist/**
// 全部文件的最大修改时间(mtime),src 晚于 dist 即判定产物过期并报错退出,
// 由 package.json 脚本链(如 test:smoke 前置调用)拦截。
//
// 边界(为何只有 mtime):mtime 便宜、无需读取全部产物内容,适合作为日常
// 「改了源码记得重建」的第一道拦截。它看不见的是「内容对不对」——被打包的
// 产物是否完整、是否残留旧文件、是否被打包阶段替换过;这类内容级断言由
// check-dist-manifest.mjs(clean build 清单 + 哈希)与 check-asar-manifest.mjs
// (包内结构 + 入口 + 资源)承担,两者不互相替代。
//
// **诊断必须点名具体文件**(否则「产物过期」只是一句需要自己去 git status 的话):
// 判定本体 evaluateFreshness 返回的每条问题是**一条含具体 src 相对路径的字符串**
// ——元素类型刻意保持 string 而不是富结构对象,理由见下方「返回形状」注释。
// 多文件同时晚于 dist 时的写法(点名全部、按新到旧、超过上限只列前几个且**必给总数**)
// 写在 describeStaleFiles 的注释里,判红形态由 gates/smoke/check-build-fresh.selftest.mjs
// 逐字钉住。
//
// 用法:node gates/smoke/check-build-fresh.mjs [--src <dir>] [--dist <dir>]

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { ROOT } from '../../shared/paths.js';

// 项目根(gates/smoke/ 的上一级)
const projectRoot = ROOT;

/**
 * 递归遍历 dir 下的全部文件,对每个文件调用一次 visit(相对 dir 的 POSIX 路径, mtimeMs)。
 *
 * 唯一的遍历实现:collectMaxMtime 与 collectStaleFiles 都由它派生 —— 两处各写一遍递归
 * 就是两处会漂移的遍历口径(漏一层子目录只在一处发生的话,「递归」这条判据会被单侧摘掉)。
 *
 * 容错口径(与历史实现一致):目录读不到(不存在/无权限)与 stat 失败的项**静默跳过**,
 * 不中断收集 —— 收集失败的表现是「少看到文件」,不是「崩掉整道门禁」。
 * @param {string} dir 求值目录
 * @param {(rel: string, mtimeMs: number) => void} visit 每个文件的回调
 * @param {string} [relBase] 相对路径前缀(递归时传递)
 * @returns {number} 访问到的文件数(0 = 目录不存在、为空或全部读不到)
 */
function walkFiles(dir, visit, relBase = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // 目录不存在或不可读 → 视为无文件
  }
  let count = 0;
  for (const entry of entries) {
    const rel = relBase === "" ? entry.name : `${relBase}/${entry.name}`;
    const fullPath = path.join(dir, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue; // 忽略无法 stat 的项
    }
    if (stats.isDirectory()) {
      count += walkFiles(fullPath, visit, rel);
      continue;
    }
    if (!stats.isFile()) continue;
    visit(rel, stats.mtimeMs);
    count += 1;
  }
  return count;
}

/**
 * 递归收集 dir 下所有文件的最大 mtime(毫秒时间戳);无文件返回 null。
 * 无法 stat 的项(权限不足、遍历中被删除等)直接忽略,不中断收集。
 * @param {string} dir 求值目录
 * @returns {number | null} 最大 mtime;无文件返回 null
 */
export function collectMaxMtime(dir) {
  let maxMtime = null;
  walkFiles(dir, (_rel, mtimeMs) => {
    if (maxMtime === null || mtimeMs > maxMtime) maxMtime = mtimeMs;
  });
  return maxMtime;
}

/**
 * 收集 dir 下 mtime **严格晚于** threshold 的文件(过期候选),按 mtime 降序、同刻按路径升序。
 *
 * 排序的第二键不是装饰:文件系统时间戳精度随卷而异(有些卷只到秒),多个文件同一刻被改时
 * 若只按 mtime 排,返回顺序会随目录枚举顺序漂移 —— 诊断文案随之不可逐字比对,夹具变 flaky。
 * @param {string} dir 求值目录
 * @param {number} threshold 阈值(毫秒时间戳);严格大于才计入
 * @returns {{ rel: string; mtimeMs: number }[]} 过期候选(新到旧)
 */
export function collectStaleFiles(dir, threshold) {
  /** @type {{ rel: string; mtimeMs: number }[]} */
  const stale = [];
  walkFiles(dir, (rel, mtimeMs) => {
    if (mtimeMs > threshold) stale.push({ rel, mtimeMs });
  });
  stale.sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel));
  return stale;
}

/**
 * 诊断里点名文件的**条数上限**。
 *
 * 为什么要有上限:久未构建时过期文件可能有几十个,把路径全列一遍会把真正的信息淹掉。
 * 为什么上限不构成「隐瞒」:总个数**永远**出现在诊断里(见 describeStaleFiles),截断只影响
 * 列举、不影响计数 —— 即「列前 3 个、共 41 个」,读的人知道还有 38 个没列。
 */
export const STALE_FILE_LIST_LIMIT = 3;

/**
 * 把过期候选渲染成诊断里的一段文字(单条问题的核心部分)。
 *
 * **多文件时的写法(裁决,不悬置)**:点名**全部**过期文件、按新到旧排;超过
 * {@link STALE_FILE_LIST_LIMIT} 个时只列前几个并附「共 N 个,只列前 M 个」。
 * 不选「只点名最早的那个」——那会让人修完一个文件再跑一次又冒出一个,来回几次;
 * 不选「只点名最新的那个」——那会漏掉「你上上次改的那些也一起丢了」。
 * @param {{ rel: string; mtimeMs: number }[]} stale 过期候选(非空,新到旧)
 * @returns {string} 诊断正文片段
 */
function describeStaleFiles(stale) {
  const shown = stale.slice(0, STALE_FILE_LIST_LIMIT).map((file) => file.rel).join("、");
  if (stale.length === 1) return shown;
  if (stale.length > STALE_FILE_LIST_LIMIT) {
    return `${shown}(共 ${String(stale.length)} 个,只列前 ${String(STALE_FILE_LIST_LIMIT)} 个)`;
  }
  return `${shown}(共 ${String(stale.length)} 个)`;
}

/**
 * 新鲜度判定(纯函数,路径注入便于直测):返回问题列表,空数组 = 产物新鲜。
 *
 * ## 返回形状(接口契约,改动前先读)
 *
 * `string[]`,且**每条问题的正文里带着具体的 src 相对路径**(POSIX 分隔符,相对 `--src` 目录)。
 * 元素类型刻意保持字符串而不是 `{ code, message, files }` 这样的富结构:判定返回值要经
 * `gates/probe/gate-probes/protocol.mjs` 的 `toProblems()` 归一,而那一层只保留
 * `code` + `message`/`text`/`summary` **一个**字段,其余字段(哪怕叫 `files`)会被整段丢掉
 * —— 真把文件清单放进结构体字段,到了 CLI 与沙盒探针那一侧就只剩一句空话。放进正文里
 * 则三条驱动路径逐字一致。
 *
 * 「哪些文件过期」同时也是判定本身:判定等价于「存在 mtime 严格晚于 dist 侧最新的那个 src
 * 文件」,故直接由 collectStaleFiles 的结果驱动分支,不再单独取 srcMax(两处口径必须同源)。
 * @param {{ srcDir: string; distDir: string }} dirs 两侧目录(注入面)
 * @returns {string[]} 问题列表;空数组 = 产物新鲜
 */
export function evaluateFreshness({ srcDir, distDir }) {
  const distMaxMtime = collectMaxMtime(distDir);

  // dist 无任何文件(dist 目录缺失或为空)→ 视为过期(无可点名:产物那边压根没有文件)
  if (distMaxMtime === null) {
    return ['构建产物过期(dist 为空或不存在),请先运行 npm run build'];
  }
  // 存在晚于 dist 的 src 改动 → 过期,报错拦截;诊断点名这些文件
  const stale = collectStaleFiles(srcDir, distMaxMtime);
  if (stale.length === 0) return [];
  return [
    `构建产物过期(存在晚于 dist 的 src 改动):源码侧 ${describeStaleFiles(stale)},请先运行 npm run build`,
  ];
}

export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'], values: ['src', 'dist'] });
  } catch (error) {
    console.error(`[build-fresh:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log('用法: node gates/smoke/check-build-fresh.mjs [--src <dir>] [--dist <dir>]');
    return 0;
  }
  const srcDir = path.resolve(projectRoot, options.src ?? 'src');
  const distDir = path.resolve(projectRoot, options.dist ?? 'dist');
  if (!existsSync(srcDir)) {
    console.error(`[build-fresh:fail] 源码目录不存在:${path.relative(projectRoot, srcDir)}`);
    return 1;
  }
  const problems = evaluateFreshness({ srcDir, distDir });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[build-fresh:fail] ${problem}`);
    return 1;
  }
  // 产物新鲜:静默通过(沿用既有约定,调用方只需退出码)
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
