// 构建新鲜度守卫脚本
//
// 用途:test:smoke 直接运行 dist/ 下的构建产物。若 src 近期有改动但未重新 build,
// 无此守卫时 smoke 测试会用旧产物得出误导性结果。本脚本递归对比 src/** 与 dist/**
// 全部文件的最大修改时间(mtime),src 晚于 dist 即判定产物过期并报错退出,
// 由 package.json 脚本链(如 test:smoke 前置调用)拦截。

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 项目根(scripts/ 的上一级)
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// 递归收集 dir 下所有文件的最大 mtime(毫秒时间戳);无文件返回 null。
// 无法 stat 的项(权限不足、遍历中被删除等)直接忽略,不中断收集。
function collectMaxMtime(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 目录不存在或不可读 → 视为无文件
  }
  let maxMtime = null;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
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

const srcMaxMtime = collectMaxMtime(join(projectRoot, 'src'));
const distMaxMtime = collectMaxMtime(join(projectRoot, 'dist'));

// dist 无任何文件(dist 目录缺失或为空)→ 视为过期
if (distMaxMtime === null) {
  console.error('构建产物过期(dist 为空或不存在),请先运行 npm run build');
  process.exit(1);
}

// 存在晚于 dist 的 src 改动 → 过期,报错拦截
if (srcMaxMtime !== null && srcMaxMtime > distMaxMtime) {
  console.error('构建产物过期(存在晚于 dist 的 src 改动),请先运行 npm run build');
  process.exit(1);
}

// 产物新鲜:静默通过
process.exit(0);
