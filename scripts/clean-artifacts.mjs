#!/usr/bin/env node

/**
 * 生成目录清理(clean:dist / clean:release),校验通过才删除,exit 0/1。
 *
 * 用途:发布物必须从干净的 dist 与干净的 release 打出。tsc 与 electron-builder 都只
 * 增量写入 —— 源文件改名/删除后旧产物会留在 dist/ 并被打进 app.asar;release/ 更是
 * 累积目录,历史版本安装包与本次产物并存。dist 清单与 SHA-256 核对只能证明「一致」,
 * 证不了「没多带」,所以清理必须发生在构建之前,而不是核对失败之后再补救。
 *
 * 删除不可逆,因此安全边界写死在本脚本内,不依赖调用方自觉:
 *   - 目标只有 dist / release 两个关键字(可用 all 一次清两者),不接受任意路径参数;
 *   - 目标目录写死在此,并与 package.json 的打包配置对账(build.files 是否覆盖 dist、
 *     build.directories.output 是否为 release);配置迁移后不一致即拒绝,防止拿着
 *     过期常量删错树;
 *   - 目标必须是项目根内的相对子目录,任一路径段命中保护区(src/test/docs/node_modules/…)
 *     或含 `..` 即拒绝(例如 main 被误改成 src/ 时不会删到源码);
 *   - 目标不存在 → 幂等跳过;目标是符号链接/联接点、非目录,或 realpath 越出项目根
 *     → 拒绝删除并说明原因;
 *   - 删除失败(Windows 常见 EBUSY/EPERM:应用或预览窗口未退出、IDE 索引、杀毒扫描)
 *     不吞错,给出可操作提示并非零退出。
 *
 * dist 目标连带删除根目录的 tsc 增量构建信息(*.tsbuildinfo):tsconfig 的 incremental
 * 缓存写在项目根而非 outDir,只删 dist/ 会留下「产物已删、缓存仍在」的状态,tsc 随即
 * 判定全部最新而一个文件都不发出(实测 clean 后 build 只剩 8 个复制资源),空 dist 还会
 * 被清单当作合法基线。该文件是 tsc 生成的构建信息,按名字模式限定、不递归。
 *
 * 用法: node scripts/clean-artifacts.mjs --target <dist|release|all> [--dry-run]
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 清理目标常量(删除目标的单一来源)。与 package.json 打包配置的一致性由
 * assertMatchesBuildConfig 断言,配置迁移时不会拿着过期常量删错树。
 * dist 连带 *.tsbuildinfo:增量构建信息在项目根,留着会让 tsc 跳过 emit(见文件头注)。
 */
const TARGET_DIRS = Object.freeze({ dist: 'dist', release: 'release' });
const BUILD_INFO_RE = /^[A-Za-z0-9._-]+\.tsbuildinfo$/;

/** 受保护路径段:源码/测试/脚本/文档/依赖/工具链,绝不可能是构建输出,命中即拒绝删除 */
const PROTECTED_SEGMENTS = new Set([
  'src',
  'test',
  'tests',
  'scripts',
  'docs',
  'node_modules',
  '.git',
  '.github',
  'output',
  'public',
]);

const USAGE = `用法: node scripts/clean-artifacts.mjs --target <dist|release|all> [--dry-run]
  --target dist     清理 dist/(tsc 输出目录,package.json build.files 收的就是它)
  --target release  清理 release/(package.json build.directories.output)
  --target all      两者都清理
  --dry-run         只打印将要删除的路径,不执行
  --help            显示本用法`;

/**
 * 极简参数解析(不复用 check-dist-manifest 的 parseArgs:那处的错误文案会带出本脚本
 * 无关的用法说明)。未知选项/缺取值都显式失败 —— 清理脚本的参数写错时必须报错,
 * 不能被静默忽略后按默认目标删东西。
 */
function parseArgs(argv) {
  const options = { target: '', 'dry-run': false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      const value = argv[(i += 1)];
      if (value === undefined) throw new Error('--target 缺少取值');
      options.target = value;
    } else if (token.startsWith('--target=')) {
      options.target = token.slice('--target='.length);
    } else if (token === '--dry-run') {
      options['dry-run'] = true;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else {
      throw new Error(`无法识别的参数:${token}`);
    }
  }
  return options;
}

function readPackageJson() {
  const target = path.join(PROJECT_ROOT, 'package.json');
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(`package.json 不可读:${error.message}`);
  }
}

/**
 * 清理目标与打包配置对账:只允许清理「打包配置确实当作产物」的目录。
 * 不一致说明产物目录已迁移而本脚本常量未跟进,此时继续删就是在赌运气。
 */
function assertMatchesBuildConfig(pkg) {
  const files = Array.isArray(pkg.build?.files) ? pkg.build.files : [];
  const coversDist = files.some(
    (pattern) => typeof pattern === 'string' && (pattern === 'dist/**' || pattern.startsWith('dist/')),
  );
  if (!coversDist) {
    throw new Error(
      `package.json build.files 未覆盖 ${TARGET_DIRS.dist}/(实际 ${JSON.stringify(files)});` +
        `若产物目录已迁移,请先同步本脚本的 TARGET_DIRS`,
    );
  }
  const output = pkg.build?.directories?.output;
  if (output !== TARGET_DIRS.release) {
    throw new Error(
      `package.json build.directories.output(${String(output)})与清理目标 ${TARGET_DIRS.release} 不一致;` +
        `若发布目录已迁移,请先同步本脚本的 TARGET_DIRS`,
    );
  }
}

/** 相对路径 → 项目内绝对路径,并逐段做安全校验 */
function resolveTarget(label, relative) {
  const posix = relative.replaceAll('\\', '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
    throw new Error(`${label} 目标必须是相对路径,拒绝:${relative}`);
  }
  for (const segment of posix.split('/')) {
    if (segment === '' || segment === '.') throw new Error(`${label} 目标含空路径段:${relative}`);
    if (segment === '..') throw new Error(`${label} 目标含上跳段(..),拒绝:${relative}`);
    if (PROTECTED_SEGMENTS.has(segment)) {
      throw new Error(`${label} 目标落在受保护目录(源码/测试/文档/依赖),拒绝删除:${relative}`);
    }
  }
  const target = path.resolve(PROJECT_ROOT, relative);
  const inside = path.relative(PROJECT_ROOT, target);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${label} 目标越出项目根,拒绝:${relative}`);
  }
  return target;
}

/**
 * 删除前的存在性与性质校验。返回 false 表示「无需清理」(目标不存在,幂等跳过)。
 * 符号链接/联接点与非目录都拒绝:递归删除跟随链接会波及项目外的真实目录。
 */
function inspectTarget(target, label) {
  if (!existsSync(target)) return false;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} 目标是符号链接/联接点,拒绝递归删除(实际指向可能在本项目之外):${target}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} 目标不是目录,拒绝删除:${target}`);
  }
  const realRoot = realpathSync(PROJECT_ROOT);
  const realTarget = realpathSync(target);
  const inside = path.relative(realRoot, realTarget);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${label} 目标 realpath 越出项目根,拒绝删除:${realTarget}`);
  }
  return true;
}

function displayPath(target) {
  const relative = path.relative(PROJECT_ROOT, target);
  return relative === '' ? target : relative.split(path.sep).join('/');
}

/** 递归删除单个目录;失败信息带可操作提示,由调用方直接抛出 */
function removeDirectory(target, label) {
  try {
    // maxRetries/retryDelay 吸收 Windows 上短暂的 EBUSY/EPERM(索引器、杀软扫描);
    // 仍失败则走 catch 输出可操作提示,不静默吞错。
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN';
    throw new Error(
      `删除 ${displayPath(target)} 失败(${code} ${error instanceof Error ? error.message : String(error)});` +
        `Windows 上多为文件占用:退出正在运行的 MarkdownToWord/预览窗口与 Electron 进程、` +
        `暂停 IDE 索引或杀毒扫描后重试`,
    );
  }
  console.log(`[ok] clean:${label} 已删除:${displayPath(target)}`);
}

/** 删除单个构建信息文件;守卫拒绝删目录,故这里只走文件删除 */
function removeFile(target, label, name) {
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`clean:${label} 的增量构建信息不是普通文件,拒绝删除:${name}`);
  }
  unlinkSync(target);
  console.log(`[ok] clean:${label} 已删除增量构建信息:${name}`);
}

/**
 * 连带清理 tsc 增量构建信息(项目根、非递归、名字模式限定)。
 * 只在 dist 目标下处理:release 目录与增量缓存无关。
 */
function cleanBuildInfo(label, dryRun) {
  for (const entry of readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !BUILD_INFO_RE.test(entry.name)) continue;
    const target = path.join(PROJECT_ROOT, entry.name);
    if (dryRun) {
      console.log(`[dry-run] clean:${label} 将删除增量构建信息:${entry.name}`);
      continue;
    }
    removeFile(target, label, entry.name);
  }
}

/** 清理单个目标;抛错由 main 统一归一化为可读诊断与非零退出 */
function cleanOne(label, relative, dryRun) {
  const target = resolveTarget(label, relative);
  if (!inspectTarget(target, label)) {
    console.log(`[ok] clean:${label} 目标不存在,无需清理:${displayPath(target)}`);
  } else if (dryRun) {
    console.log(`[dry-run] clean:${label} 将递归删除:${displayPath(target)}`);
  } else {
    removeDirectory(target, label);
  }
  if (label === 'dist') cleanBuildInfo(label, dryRun);
}

export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[clean:fail] ${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.target === '') {
    console.error(`[clean:fail] 缺少 --target(只接受 dist/release/all),不做任何删除\n${USAGE}`);
    return 1;
  }
  if (!['dist', 'release', 'all'].includes(options.target)) {
    console.error(`[clean:fail] --target 只接受 dist/release/all,实际 ${options.target}(不做任何删除)`);
    return 1;
  }
  try {
    assertMatchesBuildConfig(readPackageJson());
    const labels = options.target === 'all' ? ['dist', 'release'] : [options.target];
    for (const label of labels) cleanOne(label, TARGET_DIRS[label], options['dry-run']);
  } catch (error) {
    console.error(`[clean:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
