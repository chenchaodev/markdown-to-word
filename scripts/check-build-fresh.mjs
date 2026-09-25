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
// 用法:node scripts/check-build-fresh.mjs [--src <dir>] [--dist <dir>]

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs } from './check-dist-manifest.mjs';

// 项目根(scripts/ 的上一级)
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * 递归收集 dir 下所有文件的最大 mtime(毫秒时间戳);无文件返回 null。
 * 无法 stat 的项(权限不足、遍历中被删除等)直接忽略,不中断收集。
 */
export function collectMaxMtime(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 目录不存在或不可读 → 视为无文件
  }
  let maxMtime = null;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue; // 忽略无法 stat 的项
    }
    if (stats.isDirectory()) {
      const subMax = collectMaxMtime(fullPath);
      if (subMax !== null && (maxMtime === null || subMax > maxMtime)) {
        maxMtime = subMax;
      }
    } else if (stats.isFile() && (maxMtime === null || stats.mtimeMs > maxMtime)) {
      maxMtime = stats.mtimeMs;
    }
  }
  return maxMtime;
}

/** 新鲜度判定(纯函数,路径注入便于直测):返回问题列表,空数组 = 产物新鲜 */
export function evaluateFreshness({ srcDir, distDir }) {
  const srcMaxMtime = collectMaxMtime(srcDir);
  const distMaxMtime = collectMaxMtime(distDir);

  // dist 无任何文件(dist 目录缺失或为空)→ 视为过期
  if (distMaxMtime === null) {
    return ['构建产物过期(dist 为空或不存在),请先运行 npm run build'];
  }
  // 存在晚于 dist 的 src 改动 → 过期,报错拦截
  if (srcMaxMtime !== null && srcMaxMtime > distMaxMtime) {
    return ['构建产物过期(存在晚于 dist 的 src 改动),请先运行 npm run build'];
  }
  return [];
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
    console.log('用法: node scripts/check-build-fresh.mjs [--src <dir>] [--dist <dir>]');
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
