// dist 产物规范化清单(manifest)生成与校验(exit 0/1)。
//
// 用途:clean rebuild 之后,用「相对路径 + 字节数 + SHA-256」把 dist/** 规范化成
// 确定性清单,作为 ASAR 交叉核对与发布留痕的基线。相比 mtime 新鲜度判断
// (check-build-fresh),内容寻址能发现 mtime 看不见的三类漂移:
//   - stale:clean build 后仍残留的旧文件(改名/删除后未清理的产物)
//   - 缺失:本次构建没有产出应有的文件
//   - 篡改:文件内容被改写而大小/哈希对不上(手工改动、拷贝损坏、缓存串味)
// 清单刻意不含 mtime 与绝对路径:前者随构建时间抖动,后者随机器变化,二者都会
// 破坏可重复性(同一次 clean build 在任何机器上应产出逐字节相同的清单)。
//
// 用法(两种模式,接口稳定,供 npm 脚本与 CI 调用):
//   node gates/artifacts/check-dist-manifest.mjs [--dist <dir>] [--output <file>] [--print]
//       生成模式(默认):把当前 dist 规范化清单写入 --output
//   node gates/artifacts/check-dist-manifest.mjs --check [--dist <dir>] [--output <file>]
//       校验模式:与 --output 处既有清单逐项比对,不写盘
//
// 本文件**不再**是共享原语的单源:CLI 参数解析与主模块判定在 shared/cli.mjs,
// 文件哈希/原子写/POSIX 路径归一在 shared/fsx.mjs(ADR-049)。这 6 个符号在此**继续 re-export**,
// 是为了让既有调用方的 import 路径不必一次性改完;新增代码一律直接引 shared/ 那两个模块。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { hashFile, toPosix, writeFileAtomic } from '../../shared/fsx.mjs';
import { ROOT } from '../../shared/paths.js';

// 过渡期 re-export:本文件曾是这 6 个符号的唯一定义处,仓内既有调用方全从这里取。
// 保留转发而非要求全部改 import,是为了把「机制下沉」与「调用方迁移」拆成可独立回退的两步。
export { isMainModule, parseArgs } from '../../shared/cli.mjs';
export { hashBuffer, hashFile, toPosix, writeFileAtomic } from '../../shared/fsx.mjs';

/** 清单 schema 版本:格式不兼容变更时递增,校验模式遇到不匹配即拒绝(不静默重生成) */
export const MANIFEST_SCHEMA = 'm2w/dist-manifest@1';

/** 默认输入/输出路径(相对项目根) */
export const DEFAULT_DIST_DIR = path.join('dist');
export const DEFAULT_MANIFEST_PATH = path.join('output', 'artifacts', 'dist-manifest.json');

/** 单次报告的明细上限:超出只报计数,避免脏 dist 刷屏淹没根因 */
const MAX_REPORTED = 10;

/**
 * 本门禁自己的用法文案。
 *
 * 为什么归本文件而不留在 shared/cli.mjs(ADR-049 下沉时的收尾):用法文案描述的是**某一个
 * 脚本的参数表**,机制层写死它等于让所有复用方在参数写错时看到一段与自身无关的说明 ——
 * 这正是下沉前本文件私有 `USAGE` 造成的既有缺陷(`clean-artifacts.mjs` 曾为此另写一份
 * parseArgs)。故 `shared/cli.mjs` 的 `parseArgs` 收 `usage` 可选入参,由调用方各传各的。
 */
const USAGE = `用法: node gates/artifacts/check-dist-manifest.mjs [选项]
  --dist <dir>     待检查的构建产物目录(默认 dist)
  --output <file>  清单落盘路径(默认 output/artifacts/dist-manifest.json)
  --check          校验模式:与既有清单比对,不写盘(清单缺失/损坏即失败)
  --print          生成模式下把清单正文打到 stdout
  --help           显示本用法`;

/* ---------- dist 清单 ---------- */

/** 递归收集 distDir 下全部文件的相对路径(POSIX,字典序) */
export function collectFiles(distDir) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`dist 目录不存在或不是目录:${distDir}`);
  }
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(toPosix(path.relative(distDir, full)));
    }
  };
  walk(distDir);
  return found.sort();
}

/**
 * 构建当前 dist 的规范化清单。distLabel 只是记录用的标识(项目内为 "dist",
 * 夹具/外部目录为绝对路径),不参与文件级比对。
 */
export async function buildManifest({ distDir, distLabel }) {
  const files = collectFiles(distDir);
  if (files.length === 0) {
    throw new Error(`dist 目录为空:${distDir}(clean build 未产出任何文件)`);
  }
  const entries = [];
  let totalSize = 0;
  for (const relative of files) {
    const absolute = path.join(distDir, ...relative.split('/'));
    const stat = statSync(absolute);
    entries.push({ path: relative, size: stat.size, sha256: await hashFile(absolute) });
    totalSize += stat.size;
  }
  return { schema: MANIFEST_SCHEMA, distRoot: distLabel, fileCount: entries.length, totalSize, files: entries };
}

/** 清单序列化:2 空格缩进 + 末尾换行,保证可 diff、可复现 */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 解析并校验清单结构;损坏/含非法路径一律抛可读错误(由调用方转成非零退出) */
export function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`清单不是合法 JSON:${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('清单根节点不是对象');
  if (parsed.schema !== MANIFEST_SCHEMA) {
    throw new Error(`清单 schema 不匹配(期望 ${MANIFEST_SCHEMA},实际 ${String(parsed.schema)});请重新生成清单`);
  }
  if (!Array.isArray(parsed.files)) throw new Error('清单缺少 files 数组');
  for (const entry of parsed.files) {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') {
      throw new Error('清单 files 条目缺少 path 字段');
    }
    // 清单路径会参与后续 asar 查找与报告输出,含上跳段即为可疑输入,直接拒绝
    if (entry.path === '' || entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
      throw new Error(`清单含非法路径:${entry.path}`);
    }
    if (!Number.isInteger(entry.size) || typeof entry.sha256 !== 'string') {
      throw new Error(`清单条目缺少数值字段:${entry.path}`);
    }
  }
  return parsed;
}

/**
 * 比对期望清单与实际清单,返回可读问题列表(空数组 = 一致)。
 * 三类漂移分别措辞:stale(多出)/缺失/内容篡改,便于按类定位。
 */
export function diffManifests(expected, actual) {
  const problems = [];
  const expectedByPath = new Map(expected.files.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.files.map((entry) => [entry.path, entry]));

  const missing = [];
  for (const [filePath, entry] of expectedByPath) {
    const found = actualByPath.get(filePath);
    if (found === undefined) {
      missing.push(filePath);
      continue;
    }
    if (found.size !== entry.size || found.sha256 !== entry.sha256) {
      problems.push(
        `产物内容与清单不一致(疑似被改写):${filePath}` +
          `(清单 size=${entry.size} sha256=${entry.sha256.slice(0, 12)}…;` +
          `实际 size=${found.size} sha256=${found.sha256.slice(0, 12)}…)`,
      );
    }
  }

  const stale = [];
  for (const filePath of actualByPath.keys()) {
    if (!expectedByPath.has(filePath)) stale.push(filePath);
  }

  for (const [label, items, hint] of [
    ['缺失', missing, '本次构建未产出该文件(构建中断或 tsc 未覆盖该源文件)'],
    ['陈旧(stale)', stale, 'clean build 后不应存在的残留(改名/删除后 dist 未清理)'],
  ]) {
    if (items.length === 0) continue;
    for (const filePath of items.slice(0, MAX_REPORTED)) {
      problems.push(`产物${label}:${filePath}(${hint})`);
    }
    if (items.length > MAX_REPORTED) problems.push(`产物${label}另有 ${items.length - MAX_REPORTED} 项未逐一列出`);
  }
  return problems;
}

/** 清单在清单文件里的可读标识(项目内相对路径优先,夹具等外部目录用绝对路径) */
export function describeRoot(distDir, projectRoot) {
  const relative = path.relative(projectRoot, distDir);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) return toPosix(relative);
  return toPosix(path.resolve(distDir));
}

/* ---------- CLI ---------- */

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['check', 'print', 'help'], values: ['dist', 'output'], usage: USAGE });
  } catch (error) {
    console.error(`[dist-manifest:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const projectRoot = ROOT;
  const distDir = path.resolve(projectRoot, options.dist ?? DEFAULT_DIST_DIR);
  const manifestPath = path.resolve(projectRoot, options.output ?? DEFAULT_MANIFEST_PATH);

  let actual;
  try {
    actual = await buildManifest({ distDir, distLabel: describeRoot(distDir, projectRoot) });
  } catch (error) {
    console.error(`[dist-manifest:fail] 无法生成清单:${error.message}`);
    return 1;
  }

  if (!options.check) {
    writeFileAtomic(manifestPath, serializeManifest(actual));
    if (options.print) process.stdout.write(serializeManifest(actual));
    console.log(
      `[ok] dist 清单已生成:${toPosix(path.relative(projectRoot, manifestPath))}` +
        `(${actual.fileCount} 个文件,${actual.totalSize} 字节)`,
    );
    return 0;
  }

  if (!existsSync(manifestPath)) {
    console.error(
      `[dist-manifest:fail] 校验模式缺少清单:${toPosix(path.relative(projectRoot, manifestPath))};` +
        '请先以生成模式运行本脚本(clean build 之后、ASAR 核对之前)',
    );
    return 1;
  }

  let expected;
  try {
    expected = parseManifest(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`[dist-manifest:fail] 清单不可用:${error.message}`);
    return 1;
  }

  const problems = diffManifests(expected, actual);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[dist-manifest:fail] ${problem}`);
    console.error(`[dist-manifest:fail] dist 校验失败,共 ${problems.length} 项`);
    return 1;
  }
  console.log(
    `[ok] dist 与清单一致(${actual.fileCount} 个文件,${actual.totalSize} 字节;清单 ` +
      `${toPosix(path.relative(projectRoot, manifestPath))})`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
