// app.asar 读取层(体积门禁的「字节事实」来源):头部解析、整树求和、成员读取、目录求和。
//
// 为什么自己解析而不用 @electron/asar:那只是 electron-builder 的传递依赖,不是本仓
// 声明的依赖,发布门禁脚本不该靠未声明的包跑。头部布局(与 scripts/smoke-proc.mjs 的
// asarContainsEntry 同一实测口径):
// uint32(头 pickle 载荷) + 头长度 + 内层 uint32 + JSON 长度 + JSON,文件树按目录分层嵌套。
//
// 本模块是叶子层(只依赖 node:fs/path),不 import 任何判定层或装配层。
//
// 头尾两处「已接受例外」说明:
//   - readAsarTree 里有一段刻意重复的偏移算术(两次 readUInt32LE 之间隔着 8 字节缓冲),
//     它来自 @electron/asar 的实测头部布局,拆开反而看不懂,故保持一处写清;
//   - walkAsar 的递归保持单函数(目录树本身没有可复用的第二层职责)。
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 解析 app.asar 头部并展平目录树。
 *
 * 为什么自己解析而不用 @electron/asar:那只是 electron-builder 的传递依赖,不是本仓
 * 声明的依赖,发布门禁脚本不该靠未声明的包跑。头部布局(与
 * scripts/smoke-proc.mjs 的 asarContainsEntry 同一实测口径):
 * uint32(头 pickle 载荷) + 头长度 + 内层 uint32 + JSON 长度 + JSON,文件树按目录分层
 * 嵌套。体积只需要每个条目的 size,故不必把 payload 读出来(171MB 的包读一遍纯属浪费)。
 *
 * 注意:本函数与 smoke-proc.mjs 的 asarContainsEntry **刻意不合并** —— 后者只回答
 * 「某个条目在不在」,本函数要展平整棵树求和;共用一个函数就得把两种返回形状揉在一起,
 * 反而各自都不再直白。
 *
 * @param {string} asarPath app.asar 路径
 * @returns {{ ok: true, entries: Map<string, { size: number, offset: number, unpacked: boolean }>, headerBytes: number, dataStart: number, entryCount: number } | { ok: false, reason: string }} 解析结果
 */
export function readAsarTree(asarPath) {
  const fileSize = statSync(asarPath).size;
  const fd = openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    readExact(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    if (headerPickleSize < 8 || 8 + headerPickleSize > fileSize) {
      return { ok: false, reason: `asar 头 pickle 长度异常(${headerPickleSize})` };
    }
    const headerBuf = Buffer.alloc(headerPickleSize);
    readExact(fd, headerBuf, 0, headerPickleSize, 8);
    const jsonLength = headerBuf.readUInt32LE(4);
    if (jsonLength <= 0 || 16 + jsonLength > fileSize) {
      return { ok: false, reason: `asar 头 JSON 长度异常(${jsonLength})` };
    }
    const jsonBuf = Buffer.alloc(jsonLength);
    readExact(fd, jsonBuf, 0, jsonLength, 16);
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(jsonBuf.toString('utf8'));
    } catch (error) {
      return {
        ok: false,
        reason: `asar 头 JSON 解析失败:${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const files = /** @type {{ files?: Record<string, unknown> } | null} */ (parsed)?.files;
    if (files === null || files === undefined || typeof files !== 'object') {
      return { ok: false, reason: 'asar 头缺 files 字段(不是有效的 app.asar)' };
    }
    /** @type {Map<string, { size: number, offset: number, unpacked: boolean }>} */
    const entries = new Map();
    walkAsar(files, '', entries);
    return {
      ok: true,
      entries,
      headerBytes: 8 + headerPickleSize,
      dataStart: 8 + headerPickleSize,
      entryCount: entries.size,
    };
  } finally {
    closeSync(fd);
  }
}

/**
 * 递归展平 asar 目录树(目录不落条目,只落文件)。
 * @param {Record<string, unknown>} files 当前层
 * @param {string} prefix 路径前缀
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} out 输出表
 * @returns {void}
 */
function walkAsar(files, prefix, out) {
  for (const name of Object.keys(files).sort()) {
    const node = /** @type {{ files?: Record<string, unknown>, size?: number, offset?: string, unpacked?: boolean }} */ (
      files[name]
    );
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (node.files !== undefined && node.files !== null) {
      walkAsar(node.files, rel, out);
      continue;
    }
    out.set(rel, {
      size: typeof node.size === 'number' ? node.size : 0,
      offset: Number(node.offset ?? '0'),
      unpacked: node.unpacked === true,
    });
  }
}

/**
 * 读出 asar 内某个成员的内容(只读包内 package.json 这类小文件,不做全量解包:
 * 171MB 的包整读一遍只为拿依赖声明纯属浪费)。
 * @param {string} asarPath app.asar 路径
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} entries 展平条目表
 * @param {number} dataStart 载荷起点(= 头部长度)
 * @param {string} relPath 成员相对路径
 * @returns {string | null} utf8 内容;条目不存在返回 null
 */
export function readAsarText(asarPath, entries, dataStart, relPath) {
  const entry = entries.get(relPath);
  if (entry === undefined || entry.unpacked) return null;
  const fd = openSync(asarPath, 'r');
  try {
    const buffer = Buffer.alloc(entry.size);
    readExact(fd, buffer, 0, entry.size, dataStart + entry.offset);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * 读满指定字节(短读即抛,避免用半截头部算出荒谬体积)。
 * @param {number} fd 文件描述符
 * @param {Buffer} buffer 目标缓冲
 * @param {number} offset 缓冲内偏移
 * @param {number} length 长度
 * @param {number} position 文件内位置
 * @returns {void}
 */
function readExact(fd, buffer, offset, length, position) {
  let read = 0;
  while (read < length) {
    const n = readSync(fd, buffer, offset + read, length - read, position + read);
    if (n <= 0) throw new Error(`asar 头读取不完整(期望 ${length} 字节,实得 ${offset + read + n})`);
    read += n;
  }
}

/**
 * 目录递归字节合计(磁盘实占)。
 * @param {string} dir 目录绝对路径
 * @returns {number} 字节合计
 */
export function dirBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirBytes(child);
    } else if (entry.isFile()) {
      total += statSync(child).size;
    }
  }
  return total;
}

/**
 * asar 目录树内某条目的递归字节(含 unpacked 条目:它们随包分发,同样占安装体积)。
 * @param {Map<string, { size: number, unpacked: boolean }>} entries 展平条目表
 * @param {string} locator 相对路径(用 `/` 分隔)
 * @returns {number | null} 字节;条目不存在返回 null
 */
export function asarTreeBytes(entries, locator) {
  const prefix = `${locator.replace(/\/+$/, '')}/`;
  let total = 0;
  let found = false;
  for (const [rel, entry] of entries) {
    if (!rel.startsWith(prefix)) continue;
    found = true;
    total += entry.size;
  }
  if (!found) return null;
  // 条目自身可能就是一个文件(极小树的情形)
  const self = entries.get(locator.replace(/\/+$/, ''));
  return self === undefined ? total : total + self.size;
}
