// 跨层共用的小工具(仓库根解析、仓库相对路径、正则元字符转义)。
// 刻意不含任何判定语义:叶子层,判定层与装配层都可依赖它,反向不成立。

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toPosix } from '../check-dist-manifest.mjs';

/** 仓库根(报告与摘要只允许出现相对路径,故一切定位都从这里出发) */
export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * 仓库相对 POSIX 路径(报告里禁止出现绝对路径)。
 * @param {string} target 绝对路径
 * @returns {string} 相对路径(在仓库外时给 basename)
 */
export function repoRelative(target) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(target);
  }
  return toPosix(relative);
}

/**
 * RegExp 元字符转义(把 productName 拼进匹配式用)。
 * @param {string} text 原文
 * @returns {string} 转义后
 */
export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
