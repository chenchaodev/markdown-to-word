// 文件系统机制单源:POSIX 路径归一 · 内容哈希 · 原子写。
//
// 为什么从 gates/artifacts/check-dist-manifest.mjs 独立出来:这三件事是**机制**不是断言 ——
// 产物核对、发布物核对、ASAR 核对、供应链 SBOM/许可证/SCA 三脚本都要用,寄居在一个
// 「检查 dist 清单」的门禁名下会让「谁在断言什么」与 import 图同时失真。
//
// 零跨树出边(ADR-043 精确为「零**跨树**出边」):本模块只 import node: 内建,不引任何仓内路径。

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 路径分隔符统一为 POSIX:清单要跨平台逐字节一致,Windows 上不得出现反斜杠 */
export function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** Buffer 哈希(hex);用于 asar 内条目等内存态内容 */
export function hashBuffer(buffer, algorithm = 'sha256') {
  return createHash(algorithm).update(buffer).digest('hex');
}

/**
 * 文件流式哈希:安装包上百 MB、dist 内条目也可能不小,
 * 整体读入内存不可取(见 release 检查对 app.asar/安装包的用法)。
 * outputEncoding:hex 用于清单/报告;base64 用于与 latest.yml 的 sha512 比对。
 * @param {string} filePath 待哈希文件
 * @param {string} [algorithm] 摘要算法
 * @param {BufferEncoding} [outputEncoding] 摘要编码
 * @returns {Promise<string>} 摘要
 */
export function hashFile(filePath, algorithm = 'sha256', outputEncoding = 'hex') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest(outputEncoding)));
  });
}

/** 原子写文件:先写临时文件再 rename,避免中断留下半截清单/报告被误当成有效产物 */
export function writeFileAtomic(targetPath, content) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, targetPath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // 临时文件不存在或已清理,不影响主流程
    }
    throw error;
  }
}
