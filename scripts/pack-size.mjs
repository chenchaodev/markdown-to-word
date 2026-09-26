// 打包体积实测 + 体积回归门禁(把「这次打包有多大」变成可断言、可 review 的数字)。
//
// 存在理由(为什么值得做):打包体积回归是**沉默**的 —— 误把整个 node_modules 打进
// app.asar、或同一份 KaTeX 资源被打进两三份,CI 全绿、安装包悄悄涨几十 MB,没人在
// 看体积就永远发现不了。本脚本实测三类总量(安装包 / 解包目录 / app.asar)与四个
// 关键子项(KaTeX 资源、KaTeX 字体、Mermaid、node_modules 合计),产出 JSON 报告
// 与人类摘要,并按 scripts/pack-size.baseline.json 的基线判红。
//
// 三条硬纪律(决定了阈值与实现形态):
//
// 1. **阈值必须宽松到不误报**。门禁的红线只抓「病态膨胀」,正常依赖升级带来的
//    体积漂移不得变红灯,故判定用「相对 + 绝对」双闸取**较宽**者:
//        allowed = max(基线 × maxRelativeGrowth, minGrowthBytes)
//    只有实际增长 > allowed 才判红。基线文件里 maxRelativeGrowth=0.2、
//    minGrowthBytes=64MiB(单条目可覆盖):app.asar(~171MB 基线)要涨到 +64MiB
//    (≈+37%)才红,小条目(katex 4MB)则永远不会被体积阈值误伤(它的问题由重复
//    打包检测与包内条目断言负责)。宁可漏报,不可误报。
//
// 2. **重复打包按「包名 + 版本 + 谁要求哪个范围」判定,不受阈值约束**。同一路径形态
//    出现多份**不等于**误打包:npm 按 semver 正确并存两套版本范围时也会出现多份
//    (本仓实测:katex 0.18.1 由项目管线要求,0.16.47 由 mermaid 与
//    micromark-extension-math 的 ^0.16.x 要求 —— 强行统一反而会破坏它们的声明范围)。
//    故判红只认三类**可证明的缺陷**:
//      ①semver-violation:某副本的版本不满足其引用方声明的范围(强行统一版本的危害);
//      ②redundant-same-version:同包名同版本多副本,且祖先位置已有同版本(可提升位置的冗余);
//      ③unifyable-versions:整份副本可去掉 —— 它的全部引用方都被另一份同包名副本满足。
//    同包名**不同版本且声明范围互不重叠**(合法并存)只作信息项,写明各版本与声明来源。
//    字节记账严格分两栏:可回收只算「可避免的同包名同版本副本」;同版本却分处兄弟分支、
//    当前树形下无法提升位置的字节记为**不可回收**;跨版本同名同大小文件**两侧都不计入**
//    (0.16 与 0.18 之间那些文件同名同大小但内容不同,不是冗余)。
//    哪几个包名参与「判红」由基线里的 duplicateWatch 决定(数据而非代码常量);名单之外的
//    发现照样扫出来呈现在报告里,只是不门禁(便于复核后决定是否纳入)。
//
// 3. **没产物 ≠ 体积正常**。release/ 缺失或 app.asar 缺失 → 报
//    status=unmeasured / measured=false 并以**非 0**(EXIT.unmeasured=2)退出;
//    基线缺失/不合规 → status=fail、退出 1(门禁无法判定时不得报绿)。首次生成基线
//    **不与历史比较**,基线也**不做自动重生成**(与 scripts/pinned-actions.baseline.json
//    同纪律:自动重生成会让一次体积突变变成无人 review 的静默改动)。
//
// 字节口径(避免「子项加起来大于总量」这类自相矛盾):
//   - file/dir-total 类条目 = 磁盘实占字节(statSync);
//   - asar-tree 类条目 = 包内**逻辑内容**字节(递归求和,含 unpacked=true 的条目:
//     它们被解包到 app.asar.unpacked 随包分发,同样占安装体积),故与 app.asar 的
//     文件字节不相等,差额即 asar 头 + 解包条目;报告里 asar 段单列这三者。
//
// 产物可复现:报告只含仓库相对路径与字节数,无时间戳、无绝对路径。
//
// 用法:
//   node scripts/pack-size.mjs [选项]
//   node scripts/pack-size.mjs --print-measurements   # 只打印实测值(人工据此手改基线)

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs, toPosix } from './check-dist-manifest.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** 体积基线 schema 版本 */
export const BASELINE_SCHEMA = 1;
/** 体积报告 schema 版本 */
export const REPORT_SCHEMA = 1;
/** 基线文件默认落点(仓库内,随代码提交,人工维护) */
export const DEFAULT_BASELINE_REL = 'scripts/pack-size.baseline.json';
/** 体积报告默认落点(gitignore 覆盖 output/) */
export const DEFAULT_REPORT_REL = 'output/artifacts/pack-size-report.json';
/** 默认发布产物目录(与 build.directories.output 同口径) */
const DEFAULT_RELEASE_DIR = 'release';
/** electron-builder 的 win 解包目录名(写死:改名会让本脚本与产物布局分叉) */
const UNPACKED_DIR_NAME = 'win-unpacked';
/** 解包目录内 app.asar 的固定位置(electron-builder 布局) */
const ASAR_REL_IN_UNPACKED = 'resources/app.asar';

/** 报告状态取值 */
export const STATUS = Object.freeze({
  /** 测到了,且全部门禁通过 */
  pass: 'pass',
  /** 测到了,但有子项越界/缺失/重复打包/基线不合规 */
  fail: 'fail',
  /** 没测到(无产物):不等于「体积正常」 */
  unmeasured: 'unmeasured',
});

/**
 * 退出码语义:0 = 通过,1 = 门禁判红,2 = 未测量(无产物)。
 * CI 必须区分 2 与 0,不得把「没产物」读成「体积正常」。
 */
export const EXIT = Object.freeze({ pass: 0, fail: 1, unmeasured: 2 });

/** MiB 换算基数 */
const MIB = 1024 * 1024;

/**
 * 实测条目清单(测什么、怎么测的单源;报告与基线共用这份 id)。
 *
 * kind 语义:
 *   - `exe`:解包目录根下与 productName 同名的 .exe(缺则整轮 unmeasured);
 *   - `dir-total`:目录递归磁盘字节合计(解包目录整体);
 *   - `installer`:发布目录内体积最大的 `*Setup*.exe`(缺则告警不判红:便携/dir
 *     形态本来就没有安装包);
 *   - `asar-tree`:app.asar 目录树内某条目的递归逻辑字节。
 *
 * required=false 的条目缺失只告警;required=true 的条目缺失判红(基线登记的关键子项
 * 在产物里找不到 = 资源被漏收,如 KaTeX 字体整目录消失)。
 */
export const MEASURED_ITEMS = Object.freeze([
  { id: 'appAsar', label: 'app.asar', kind: 'asar-file', required: true },
  { id: 'unpackedExe', label: '解包 exe', kind: 'exe', required: true },
  { id: 'unpackedTotal', label: '解包目录合计', kind: 'dir-total', required: true },
  { id: 'installer', label: '安装包', kind: 'installer', required: false },
  { id: 'asarNodeModules', label: 'asar 内 node_modules', kind: 'asar-tree', locator: 'node_modules', required: true },
  { id: 'asarKatex', label: 'asar 内 KaTeX 资源', kind: 'asar-tree', locator: 'node_modules/katex', required: true },
  { id: 'asarKatexDist', label: 'asar 内 KaTeX dist', kind: 'asar-tree', locator: 'node_modules/katex/dist', required: true },
  { id: 'asarKatexFonts', label: 'asar 内 KaTeX 字体', kind: 'asar-tree', locator: 'node_modules/katex/dist/fonts', required: true },
  { id: 'asarMermaid', label: 'asar 内 Mermaid', kind: 'asar-tree', locator: 'node_modules/mermaid', required: true },
  { id: 'asarDist', label: 'asar 内 dist(自研代码)', kind: 'asar-tree', locator: 'dist', required: true },
]);

/** @types/katex 之类类型声明副本的排除(不随包运行,计入会每次误报) */
const TYPES_SCOPE = '@types';
/**
 * 「谁要求哪个范围」只看这两类依赖字段。
 *
 * 刻意**不含 peerDependencies**:peer 范围不驱动安装(不会因此产生嵌套副本),
 * 把它算进来会把「peer 未被满足」这一类完全不同的問題混进判重;那是 npm 自己的
 * 报告面(以及包内条目断言)该管的事。
 */
const DECLARATION_FIELDS = ['dependencies', 'optionalDependencies'];

/**
 * @typedef {object} PackSizeItemSpec 实测条目定义(MEASURED_ITEMS 的元素形状)
 * @property {string} id 条目 id(基线键)
 * @property {string} label 中文名(问题行按它点名)
 * @property {'exe' | 'dir-total' | 'installer' | 'asar-file' | 'asar-tree'} kind 测法
 * @property {string} [locator] asar 树内相对路径(asar-tree 必填)
 * @property {boolean} required 缺失是否判红
 */

/**
 * @typedef {object} PackSizeItemRow 单条目比对结果(报告 items 的元素)
 * @property {string} id 条目 id
 * @property {string} label 中文名
 * @property {number | null} bytes 实测字节(null = 缺失)
 * @property {boolean} present 是否测到
 * @property {boolean} required 是否必需条目
 * @property {number | null} baselineBytes 基线字节(null = 基线未登记)
 * @property {number | null} deltaBytes 实测 − 基线
 * @property {number | null} allowedGrowthBytes 容许增长 = max(基线×相对闸, 绝对闸)
 * @property {'ok' | 'over' | 'under' | 'missing' | 'new'} verdict 判定
 */

/**
 * @typedef {object} PackSizeCopy 某个包名的一份副本
 * @property {string} path 包根路径(包内相对路径)
 * @property {string} name 包名
 * @property {string} version 版本(取自包内 package.json)
 * @property {number} bytes 该副本的包内字节
 * @property {number} fileCount 该副本的文件数
 */

/**
 * @typedef {object} PackSizeDeclaration 一条「谁要求哪个范围」的事实
 * @property {string} requirer 引用方包根(项目自身记为 package.json)
 * @property {string} field 声明字段(dependencies / optionalDependencies)
 * @property {string} range 声明的范围字面量
 * @property {string | null} resolvedTo 按 Node 解析规则落到哪份副本(null = 没落到包内任何一份)
 */

/**
 * @typedef {object} PackSizeDuplicateFinding 某个包名的判重结论
 * @property {string} name 包名
 * @property {'semver-violation' | 'redundant-same-version' | 'unifyable-versions' | 'parallel-versions' | 'unavoidable-duplicate'} classification 分类
 * @property {boolean} red 是否属可证明的缺陷(是否进 problems 由门禁名单另判)
 * @property {PackSizeCopy[]} copies 各副本(路径升序)
 * @property {PackSizeDeclaration[]} declarations 该包名的全部声明与解析落点
 * @property {number} reclaimableBytes 可回收字节(仅「可避免的同包名同版本副本」)
 * @property {number} unavoidableBytes 不可回收字节(同版本却无可提升位置)
 * @property {{ count: number, bytes: number }} crossVersionIdenticalFiles 跨版本同名同大小文件(仅对照,两侧都不计入可回收)
 * @property {string[]} reasons 判红/可回收的具体理由(逐条)
 * @property {string[]} notes 复核用说明
 */

/**
 * @typedef {object} PackSizeDuplicateAnalysis 判重总账
 * @property {number} packagesAnalyzed 扫到的包根数(含项目自身)
 * @property {number} multiCopyNames 有多份副本的包名数
 * @property {string[]} excludedTypeOnly 被排除的类型声明包根
 * @property {number} reclaimableBytes 可回收字节合计
 * @property {number} unavoidableBytes 不可回收字节合计
 * @property {{ count: number, bytes: number }} crossVersionIdenticalFiles 跨版本同名同大小文件合计
 * @property {number} redCount 判红结论数(不分是否在门禁名单内)
 * @property {PackSizeDuplicateFinding[]} findings 逐包名结论
 */

/**
 * @typedef {object} PackSizeMeasurement 一次实测的原始事实(不含判定)
 * @property {{ releaseDir: string, unpackedDir: string, asar: string, installer: string | null }} release 产物位置(仓库相对)
 * @property {{ fileBytes: number, headerBytes: number, entryCount: number, unpackedEntryBytes: number }} asar 头部事实
 * @property {Record<string, { id: string, label: string, kind: string, locator: string | null, required: boolean, bytes: number | null, present: boolean, source: string | null }>} items 各条目字节
 * @property {PackSizeDuplicateAnalysis} duplicates 判重总账
 */

/**
 * @typedef {object} PackSizeReport 体积报告(本文件契约;键序固定 ⇒ 产物可复现)
 * @property {number} schema 报告 schema 版本
 * @property {string} kind 恒为 pack-size-report
 * @property {string} status pass | fail | unmeasured
 * @property {boolean} measured 是否测到(未测到 ≠ 体积正常)
 * @property {string | null} unmeasuredReason 未测量原因
 * @property {PackSizeMeasurement['release'] | null} release 产物位置
 * @property {PackSizeMeasurement['asar'] | null} asar 头部事实
 * @property {{ maxRelativeGrowth: number, maxShrinkRatio: number, minGrowthBytes: number, minGrowthBytesByItem: Record<string, number> } | null} thresholds 阈值视图
 * @property {string[] | null} duplicateWatch 判重门禁名单(来自基线;null = 未测量/无基线)
 * @property {PackSizeItemRow[]} items 逐条目比对结果
 * @property {PackSizeDuplicateAnalysis | null} duplicates 判重总账
 * @property {string[]} problems 问题列表
 * @property {string[]} warnings 告警列表
 * @property {string[]} info 信息项(合法并存等不判红但必须可见的结论)
 */

/**
 * @typedef {object} PackSizeBaseline 解析后的基线
 * @property {boolean} ok 自身是否合规
 * @property {{ maxRelativeGrowth: number, maxShrinkRatio: number, minGrowthBytes: number }} thresholds 三个标量阈值
 * @property {Record<string, number>} itemOverrides 单条目绝对闸覆盖
 * @property {string[]} duplicateWatch 参与「重复打包判红」的包名名单
 * @property {Record<string, number>} items 条目基线字节
 * @property {string[]} problems 基线自身的问题
 */

/**
 * @typedef {object} PackSizeVerdict 门禁判定结论
 * @property {string} status pass | fail
 * @property {PackSizeItemRow[]} rows 逐条目判定
 * @property {(PackSizeDuplicateFinding & { gated: boolean, problem: string | null })[]} duplicateFindings 判重结论 + 是否在门禁名单内 + 对应问题行
 * @property {string[]} problems 问题列表(空 = 通过)
 * @property {string[]} warnings 告警列表
 * @property {string[]} info 信息项
 */

const USAGE = `用法: node scripts/pack-size.mjs [选项]
  --release <dir>    发布产物根目录(默认 ${DEFAULT_RELEASE_DIR};解包目录取其下 ${UNPACKED_DIR_NAME})
  --unpacked <dir>   显式指定解包目录(覆盖 --release 推导)
  --baseline <file>  体积基线文件(默认 ${DEFAULT_BASELINE_REL};不提供 --write/--update,
                     基线只能人工改 —— 自动重生成会让体积突变变成无人 review 的静默改动)
  --out <file>       报告 JSON 落点(默认 ${DEFAULT_REPORT_REL})
  --watch <a,b>      覆盖本次运行的判重门禁名单(默认取基线里的 duplicateWatch;仅本次生效,
                     不写回基线 —— 名单变更须人工改基线)
  --print-measurements  只打印实测值(JSON 到 stdout),不比对基线、不写报告
  --help             显示本用法

退出码:0 = 通过;1 = 判红(子项越界/异常缩小/必需子项缺失/重复打包/基线不合规);
        2 = 未测量(无产物)。未测量不等于体积正常,CI 必须区分 2 与 0。`;

/**
 * 字节 → MiB 文本(摘要用,3 位小数;整数则不带小数尾巴)。
 * @param {number} bytes 字节数
 * @returns {string} 形如 "171.0 MiB"
 */
export function toMiB(bytes) {
  const value = bytes / MIB;
  const text = value.toFixed(3).replace(/\.?0+$/, '');
  return `${text} MiB`;
}

/**
 * 仓库相对 POSIX 路径(报告里禁止出现绝对路径)。
 * @param {string} target 绝对路径
 * @returns {string} 相对路径(在仓库外时给 basename)
 */
function repoRelative(target) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(target);
  }
  return toPosix(relative);
}

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

/**
 * 包内副本检测:找出所有 `node_modules/<pkg>`(含嵌套)形态的包根,按包名归组。
 *
 * 副本根是从**文件路径**反推的:asar 目录树里目录本身不落条目(只有文件有 size),
 * 故不能按「路径等于包根」筛,得扫出每个 `…/node_modules/<pkg>/…` 前缀。
 * @types/* 是类型声明、不随包运行,归入 excluded(否则每次都误报)。
 *
 * 注意:本函数只回答「哪些位置上有这个包名」,**不判断是否算缺陷** —— 那要连版本与
 * 声明范围一起看(见 analyzeDuplicates),故本函数对任意包名都成立,不是某包的特判。
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} entries asar 展平条目表
 * @param {string} pkgName 包名(不含 @scope)
 * @returns {{ copies: { path: string, bytes: number, fileCount: number }[], excluded: string[] }} 副本与被排除项
 */
export function findPackageCopies(entries, pkgName) {
  const pattern = new RegExp(`(?:^|/)node_modules/(?:@[^/]+/)?${escapeRegExp(pkgName)}/`, 'g');
  /** @type {Set<string>} */
  const roots = new Set();
  /** @type {Set<string>} */
  const excluded = new Set();
  for (const rel of entries.keys()) {
    pattern.lastIndex = 0;
    let match = pattern.exec(rel);
    while (match !== null) {
      const root = rel.slice(0, match.index + match[0].length - 1);
      if (root.split('/').includes(TYPES_SCOPE)) excluded.add(root);
      else roots.add(root);
      match = pattern.exec(rel);
    }
  }
  const copies = [...roots].sort().map((root) => {
    const prefix = `${root}/`;
    let bytes = 0;
    let fileCount = 0;
    for (const [rel, entry] of entries) {
      if (!rel.startsWith(prefix)) continue;
      fileCount += 1;
      bytes += entry.size;
    }
    return { path: root, bytes, fileCount };
  });
  return { copies, excluded: [...excluded].sort() };
}

/**
 * 最小 semver 判定器:只覆盖依赖声明里实际出现的形态(`^` `~` `>=` `>` `<=` `<` `=`
 * 裸版本、缺省段 `N`/`N.N`、连字符范围 `A - B`、空格并列(AND)、`||` 并列(OR)、`*`)。
 *
 * 覆盖不到的形态(预发布/构建元数据/URL/别名/workspace: 等)返回 null = **判不了**,
 * 调用方据此走「不可判定 → 只报信息、不判红」:宁可漏报,也不要把正常依赖搞成红灯。
 * 不引 semver 包:那不是本仓声明的依赖。
 *
 * @param {string} version 具体版本
 * @param {string} range 范围字面量
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
export function satisfiesRange(version, range) {
  const target = parseSemver(version);
  if (target === null || typeof range !== 'string') return null;
  const text = range.trim();
  if (text === '') return true;
  const alternatives = text.split('||');
  /** @type {boolean[]} */
  const results = [];
  for (const alternative of alternatives) {
    const verdict = satisfiesAlternative(target, alternative.trim());
    if (verdict === null) return null;
    results.push(verdict);
  }
  return results.some(Boolean);
}

/**
 * 解析完整版本号(带预发布/构建元数据的一律判不了,交由调用方走不可判定路径)。
 * @param {string} text 版本文本
 * @returns {{ major: number, minor: number, patch: number, pre: string | null } | null} 版本
 */
function parseSemver(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/**
 * 版本比较(只处理无预发布的两端)。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} a 左
 * @param {{major: number, minor: number, patch: number, pre: string | null}} b 右
 * @returns {number} -1 / 0 / 1
 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * 缺省段版本下界(把 `1` / `1.2` 补成 `1.0.0` / `1.2.0`)。
 * @param {{major: number, minor: number | null, patch: number | null}} partial 缺省段版本
 * @returns {{major: number, minor: number, patch: number, pre: null}} 补全后的版本
 */
function lowerBound(partial) {
  return { major: partial.major, minor: partial.minor ?? 0, patch: partial.patch ?? 0, pre: null };
}

/**
 * 缺省段版本上界(开区间上界):`1` → 2.0.0,`1.2` → 1.3.0,`1.2.3` → 无上界(返回 null)。
 * @param {{major: number, minor: number | null, patch: number | null}} partial 缺省段版本
 * @returns {{major: number, minor: number, patch: number, pre: null} | null} 上界
 */
function partialUpperBound(partial) {
  if (partial.minor === null) return { major: partial.major + 1, minor: 0, patch: 0, pre: null };
  if (partial.patch === null) return { major: partial.major, minor: partial.minor + 1, patch: 0, pre: null };
  return null;
}

/**
 * 解析缺省段版本字面量(`1` / `1.2` / `1.2.3` / `1.x` / `*`)。
 * @param {string} text 文本
 * @returns {{major: number, minor: number | null, patch: number | null} | null} 解析结果
 */
function parsePartialVersion(text) {
  const wildcard = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(text.trim());
  if (wildcard === null) return null;
  const minor = wildcard[2];
  const patch = wildcard[3];
  return {
    major: Number(wildcard[1]),
    minor: minor === undefined || /[xX*]/.test(minor) ? null : Number(minor),
    patch: patch === undefined || /[xX*]/.test(patch) ? null : Number(patch),
  };
}

/**
 * 判定单个并列项(AND 串,可含连字符范围)。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} target 目标版本
 * @param {string} alternative 并列项
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
function satisfiesAlternative(target, alternative) {
  if (target.pre !== null) return null;
  const hyphen = /^(.+?)\s+-\s+(.+)$/.exec(alternative);
  if (hyphen !== null) {
    const low = parsePartialVersion(String(hyphen[1]));
    const high = parsePartialVersion(String(hyphen[2]));
    if (low === null || high === null) return null;
    const upper = partialUpperBound(high) ?? lowerBound(high);
    return compareSemver(target, lowerBound(low)) >= 0 && compareSemver(target, upper) < 0;
  }
  const tokens = alternative.split(/\s+/).filter((token) => token !== '');
  for (const token of tokens) {
    const verdict = satisfiesComparator(target, token);
    if (verdict === null) return null;
    if (!verdict) return false;
  }
  return true;
}

/**
 * 判定单个比较项。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} target 目标版本
 * @param {string} token 比较项
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
function satisfiesComparator(target, token) {
  const operatorMatch = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(token);
  if (operatorMatch === null) return null;
  const operator = operatorMatch[1] ?? '=';
  const rest = String(operatorMatch[2]).trim();
  if (rest === '' || rest === '*' || rest === 'x' || rest === 'X') return true;
  const partial = parsePartialVersion(rest);
  if (partial === null) return null;
  const low = lowerBound(partial);
  const upper = partialUpperBound(partial);
  if (operator === '^') {
    // caret 语义(与 npm 一致):0.0.x 锁补丁、0.x.y 锁次版本、其余锁主版本
    /** @type {{major: number, minor: number, patch: number, pre: null}} */
    let bound;
    if (partial.minor === null) bound = { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    else if (partial.major !== 0) bound = { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    else if (partial.patch === null) bound = { major: 0, minor: partial.minor + 1, patch: 0, pre: null };
    else if (partial.minor === 0) bound = { major: 0, minor: 0, patch: partial.patch + 1, pre: null };
    else bound = { major: 0, minor: partial.minor + 1, patch: 0, pre: null };
    return compareSemver(target, low) >= 0 && compareSemver(target, bound) < 0;
  }
  if (operator === '~') {
    const bound = upper ?? { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    return compareSemver(target, low) >= 0 && compareSemver(target, bound) < 0;
  }
  if (operator === '>=') return compareSemver(target, low) >= 0;
  if (operator === '>') return upper === null ? compareSemver(target, low) > 0 : compareSemver(target, upper) >= 0;
  if (operator === '<=') {
    return upper === null ? compareSemver(target, low) <= 0 : compareSemver(target, upper) < 0;
  }
  if (operator === '<') return upper === null ? compareSemver(target, low) < 0 : compareSemver(target, upper) < 0;
  // `=` / 裸版本:缺省段给出闭区间
  if (upper === null) return compareSemver(target, low) === 0;
  return compareSemver(target, low) >= 0 && compareSemver(target, upper) < 0;
}

/**
 * 枚举包内所有包根(含项目自身),读出各自的 name/version/依赖声明。
 * @param {object} spec 入参
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @param {string} spec.asarPath app.asar 路径
 * @param {number} spec.dataStart 载荷起点
 * @returns {{ packages: { root: string, name: string, version: string, declarations: { field: string, range: string }[] }[], excludedTypeOnly: string[] }} 包清单
 */
function enumeratePackages({ entries, asarPath, dataStart }) {
  /** @type {{ root: string, name: string, version: string, declarations: { field: string, range: string }[] }[]} */
  const packages = [];
  /** @type {string[]} */
  const excludedTypeOnly = [];
  /** @type {string[]} */
  const manifests = [];
  for (const rel of entries.keys()) {
    if (rel === 'package.json') {
      manifests.push('');
      continue;
    }
    if (!rel.endsWith('/package.json') || !/(?:^|\/)node_modules\//.test(rel)) continue;
    // 包根 = 去掉末尾 /package.json;包名 = 包根里最后一个 node_modules/ 之后那段
    const root = rel.slice(0, rel.length - '/package.json'.length);
    const nameFromPath = root.slice(root.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (nameFromPath === '' || nameFromPath.endsWith('/')) continue;
    if (nameFromPath.startsWith(`${TYPES_SCOPE}/`)) {
      excludedTypeOnly.push(root);
      continue;
    }
    manifests.push(`${root}\t${nameFromPath}`);
  }
  for (const record of manifests.sort()) {
    const [root, nameFromPath = ''] = record.split('\t');
    const manifestRel = root === '' ? 'package.json' : `${root}/package.json`;
    const text = readAsarText(asarPath, entries, dataStart, manifestRel);
    if (text === null) continue;
    /** @type {{ name?: unknown, version?: unknown, dependencies?: unknown, optionalDependencies?: unknown } | null} */
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed === null) continue;
    const name = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : nameFromPath;
    if (name === '' || name === undefined) continue;
    /** @type {{ field: string, range: string }[]} */
    const declarations = [];
    for (const field of DECLARATION_FIELDS) {
      const bag = /** @type {Record<string, unknown> | undefined} */ (parsed[field]);
      if (bag === null || bag === undefined || typeof bag !== 'object') continue;
      for (const dep of Object.keys(bag).sort()) {
        const range = bag[dep];
        if (typeof range === 'string') declarations.push({ field, range, name: dep });
      }
    }
    packages.push({
      root,
      name,
      version: typeof parsed.version === 'string' ? parsed.version : '',
      declarations: /** @type {{ field: string, range: string }[]} */ (declarations),
      /** 依赖名 → 范围的旁路表(下面按名取用) */
      byName: Object.fromEntries(declarations.map((decl) => [decl.name, decl])),
    });
  }
  return { packages, excludedTypeOnly: [...new Set(excludedTypeOnly)].sort() };
}

/**
 * Node 解析:某引用方所在包会落到哪一份副本(自包目录逐级上溯找 node_modules/<name>)。
 * @param {string} requirerRoot 引用方包根('' = 项目自身)
 * @param {string} name 包名
 * @param {Set<string>} copyRoots 包内该包名的全部副本根
 * @returns {string | null} 命中的副本根;没落到包内任何一份返回 null
 */
function resolveCopy(requirerRoot, name, copyRoots) {
  const segments = requirerRoot === '' ? [] : requirerRoot.split('/');
  for (let i = segments.length; i >= 0; i -= 1) {
    const candidate = [...segments.slice(0, i), 'node_modules', name].join('/');
    if (copyRoots.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Node 解析(排除某一份副本):用来判「把这份副本抽掉,引用方会落到哪」——
 * 兄弟分支里的副本对彼此不可见,所以只能沿解析链向上找。
 * @param {string} requirerRoot 引用方包根('' = 项目自身)
 * @param {string} name 包名
 * @param {Set<string>} copyRoots 包内该包名的全部副本根
 * @param {string} exclude 要排除的副本根
 * @returns {string | null} 抽掉 exclude 后命中的副本根;抽掉后无处可落返回 null
 */
function resolveCopyExcept(requirerRoot, name, copyRoots, exclude) {
  const segments = requirerRoot === '' ? [] : requirerRoot.split('/');
  for (let i = segments.length; i >= 0; i -= 1) {
    const candidate = [...segments.slice(0, i), 'node_modules', name].join('/');
    if (candidate !== exclude && copyRoots.has(candidate)) return candidate;
  }
  return null;
}

/**
 * 跨版本同名同大小文件(仅作对照,**不计入任何可回收口径**):同一个相对文件名在两份
 * 不同版本副本里都存在且大小一致。0.16 与 0.18 之间这类文件很多,它们内容不同、各自
 * 需要,把字节记成「省下来的」是错误记账。
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} entries asar 展平条目表
 * @param {PackSizeCopy[]} copies 该包名的各副本
 * @returns {{ count: number, bytes: number }} 对照数字
 */
function crossVersionIdenticalFiles(entries, copies) {
  /** @type {Map<string, Map<string, number>>} */
  const perCopy = new Map();
  for (const copy of copies) {
    /** @type {Map<string, number>} */
    const sizes = new Map();
    const prefix = `${copy.path}/`;
    for (const [rel, entry] of entries) {
      if (rel.startsWith(prefix)) sizes.set(rel.slice(prefix.length), entry.size);
    }
    perCopy.set(copy.path, sizes);
  }
  /** @type {Map<string, number>} */
  const matched = new Map();
  for (let i = 0; i < copies.length; i += 1) {
    for (let j = i + 1; j < copies.length; j += 1) {
      const left = copies[i];
      const right = copies[j];
      if (left === undefined || right === undefined || left.version === right.version) continue;
      const leftSizes = perCopy.get(left.path);
      const rightSizes = perCopy.get(right.path);
      if (leftSizes === undefined || rightSizes === undefined) continue;
      for (const [file, size] of leftSizes) {
        if (rightSizes.get(file) === size) matched.set(file, size);
      }
    }
  }
  let bytes = 0;
  for (const size of matched.values()) bytes += size;
  return { count: matched.size, bytes };
}

/**
 * 判重主逻辑:按「包名 + 版本 + 声明范围」给每个多副本包名定性,并把字节分成
 * 可回收 / 不可回收两栏(跨版本同名同大小文件两侧都不计入)。
 * @param {object} spec 入参
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @param {string} spec.asarPath app.asar 路径
 * @param {number} spec.dataStart 载荷起点
 * @returns {PackSizeDuplicateAnalysis} 判重总账
 */
export function analyzeDuplicates({ entries, asarPath, dataStart }) {
  const { packages, excludedTypeOnly } = enumeratePackages({ entries, asarPath, dataStart });
  /** @type {Map<string, PackSizeCopy[]>} */
  const byName = new Map();
  for (const pkg of packages) {
    const found = findPackageCopies(entries, pkg.name);
    const copy = found.copies.find((item) => item.path === pkg.root);
    if (copy === undefined) continue;
    const list = byName.get(pkg.name) ?? [];
    list.push({ path: pkg.root, name: pkg.name, version: pkg.version, bytes: copy.bytes, fileCount: copy.fileCount });
    byName.set(pkg.name, list);
  }
  /** @type {PackSizeDuplicateFinding[]} */
  const findings = [];
  for (const name of [...byName.keys()].sort()) {
    const copies = (byName.get(name) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    if (copies.length < 2) continue;
    const copyRoots = new Set(copies.map((copy) => copy.path));
    /** @type {PackSizeDeclaration[]} */
    const declarations = [];
    for (const pkg of packages) {
      const decl = pkg.byName[name];
      if (decl === undefined) continue;
      declarations.push({
        requirer: pkg.root === '' ? 'package.json' : pkg.root,
        field: decl.field,
        range: decl.range,
        resolvedTo: resolveCopy(pkg.root, name, copyRoots),
      });
    }
    findings.push(classifyName({ name, copies, declarations, entries }));
  }
  let reclaimableBytes = 0;
  let unavoidableBytes = 0;
  let crossCount = 0;
  let crossBytes = 0;
  for (const finding of findings) {
    reclaimableBytes += finding.reclaimableBytes;
    unavoidableBytes += finding.unavoidableBytes;
    crossCount += finding.crossVersionIdenticalFiles.count;
    crossBytes += finding.crossVersionIdenticalFiles.bytes;
  }
  return {
    packagesAnalyzed: packages.length,
    multiCopyNames: findings.length,
    excludedTypeOnly,
    reclaimableBytes,
    unavoidableBytes,
    crossVersionIdenticalFiles: { count: crossCount, bytes: crossBytes },
    redCount: findings.filter((finding) => finding.red).length,
    findings,
  };
}

/**
 * 给单个包名定性(判红三类 + 合法并存 + 不可提升位置的同版本并存)。
 * @param {object} spec 入参
 * @param {string} spec.name 包名
 * @param {PackSizeCopy[]} spec.copies 各副本
 * @param {PackSizeDeclaration[]} spec.declarations 该包名的声明与解析落点
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @returns {PackSizeDuplicateFinding} 结论
 */
function classifyName({ name, copies, declarations, entries }) {
  const copyRoots = new Set(copies.map((copy) => copy.path));
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const removable = new Set();
  /** @type {PackSizeDuplicateFinding['classification'][]} */
  const detected = [];
  let undecidable = 0;

  // ① semver 违规:引用方声明的范围不被实际解析到的版本满足(强行统一版本的危害)
  for (const decl of declarations) {
    if (decl.resolvedTo === null) {
      undecidable += 1;
      continue;
    }
    const copy = copies.find((item) => item.path === decl.resolvedTo);
    if (copy === undefined) continue;
    const satisfied = satisfiesRange(copy.version, decl.range);
    if (satisfied === null) undecidable += 1;
    else if (satisfied === false) {
      if (!detected.includes('semver-violation')) detected.push('semver-violation');
      problems.push(
        `${decl.requirer}[${decl.field}] 声明 ${name}@${decl.range},实际解析到 ${copy.path}@${copy.version}(不满足其声明范围)`,
      );
    }
  }
  // ② 同包名同版本多副本,且祖先位置已有同版本 → 多出来的那份是冗余嵌套
  /** @type {Map<string, PackSizeCopy[]>} */
  const byVersion = new Map();
  for (const copy of copies) {
    const list = byVersion.get(copy.version) ?? [];
    list.push(copy);
    byVersion.set(copy.version, list);
  }
  for (const [version, group] of byVersion) {
    if (group.length < 2) continue;
    for (const copy of group) {
      // 「祖先位置」按 Node 解析算,不是路径前缀(顶层 node_modules/x 之于
      // node_modules/m/node_modules/x 也是可达的祖先位置)
      const resolvers = declarations.filter((decl) => decl.resolvedTo === copy.path);
      if (resolvers.length === 0) continue;
      const targets = resolvers.map((decl) =>
        resolveCopyExcept(decl.requirer === 'package.json' ? '' : decl.requirer, name, copyRoots, copy.path),
      );
      const first = targets[0];
      if (first === null || first === undefined || targets.some((item) => item !== first)) continue;
      const target = group.find((other) => other.path === first);
      if (target === undefined) continue;
      removable.add(copy.path);
      if (!detected.includes('redundant-same-version')) detected.push('redundant-same-version');
      problems.push(
        `同包名同版本多副本且上方已有同版本(${target.path}@${version}):` +
          `${copy.path}@${version}(${copy.bytes} 字节,可回收);` +
          `抽掉后其引用方(${resolvers.map((decl) => `${decl.requirer} 的 ${decl.range}`).join('、')})` +
          `仍落到 ${target.path}@${target.version}`,
      );
    }
  }
  // ③ 整份副本可去掉:把它抽掉后,它的全部引用方仍会落到**同一份**同包名副本上,
  //    且那份的版本满足它们声明的范围 ⇒ 本可统一到同一版本(声明范围其实重叠)。
  //    同样按真实解析走:兄弟分支里的副本对彼此不可见(mermaid 与
  //    micromark-extension-math 各自目录下的 katex 互不可见,不能算「统一」)。
  for (const copy of copies) {
    if (removable.has(copy.path)) continue;
    const own = declarations.filter((decl) => decl.resolvedTo === copy.path);
    if (own.length === 0) continue;
    const after = own.map((decl) => ({
      decl,
      target: resolveCopyExcept(decl.requirer === 'package.json' ? '' : decl.requirer, name, copyRoots, copy.path),
    }));
    if (after.some((item) => item.target === null)) {
      if (after.some((item) => satisfiesRange(copy.version, item.decl.range) === null)) undecidable += 1;
      continue;
    }
    const target = after[0]?.target ?? null;
    if (target === null || after.some((item) => item.target !== target)) continue;
    const targetCopy = copies.find((item) => item.path === target);
    if (targetCopy === undefined || targetCopy.version === copy.version) continue;
    // 落点是同一份还不够:那份的版本必须**满足每个引用方声明的范围**,否则抽掉就是 semver 违规
    if (!own.every((decl) => satisfiesRange(targetCopy.version, decl.range) === true)) {
      if (own.some((decl) => satisfiesRange(targetCopy.version, decl.range) === null)) undecidable += 1;
      continue;
    }
    removable.add(copy.path);
    if (!detected.includes('unifyable-versions')) detected.push('unifyable-versions');
    problems.push(
      `同包名不同版本但声明范围重叠(本可统一):${copy.path}@${copy.version}(${copy.bytes} 字节,可回收)` +
        `抽掉后其全部引用方(${own.map((decl) => `${decl.requirer} 的 ${decl.range}`).join('、')})` +
        `都会落到 ${targetCopy.path}@${targetCopy.version}`,
    );
  }

  // 字节分栏:可回收 = 可避免的副本;不可回收 = 同版本却无可提升位置的并存
  let reclaimableBytes = 0;
  for (const copy of copies) if (removable.has(copy.path)) reclaimableBytes += copy.bytes;
  let unavoidableBytes = 0;
  if (reclaimableBytes === 0) {
    for (const [version, group] of byVersion) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => b.bytes - a.bytes);
      const droppable = sorted.slice(1);
      const bytes = droppable.reduce((sum, copy) => sum + copy.bytes, 0);
      unavoidableBytes += bytes;
      const otherVersions = [...new Set(copies.filter((copy) => copy.version !== version).map((copy) => copy.version))];
      notes.push(
        `同版本 ${version} 分处兄弟分支(${group.map((copy) => copy.path).join('、')}),` +
          `${otherVersions.length === 0 ? '无可提升的祖先位置' : `根/祖先位置被 ${otherVersions.join('/')} 占据`},` +
          `当前树形下无法合并,${bytes} 字节不可回收`,
      );
    }
  } else {
    const sameVersionElsewhere = copies.some(
      (copy) => !removable.has(copy.path) && copies.some((other) => other.version === copy.version && other.path !== copy.path),
    );
    if (sameVersionElsewhere) {
      notes.push('同包名同版本仍有并存副本,未计入不可回收(避免同一批字节被记两次)');
    }
  }
  if (problems.length === 0) {
    notes.push(
      `各版本互斥(${copies.map((copy) => `${copy.version}@${copy.path}`).join('、')}),` +
        '由各自引用方声明的范围强制并存,不是误打包',
    );
  }
  if (undecidable > 0) {
    notes.push(`${undecidable} 条声明范围无法用最小 semver 判定器解析(含预发布/URL/别名),未据此判红,需人工复核`);
  }
  const crossVersion = crossVersionIdenticalFiles(entries, copies);
  if (crossVersion.count > 0) {
    notes.push(
      `跨版本同名同大小文件 ${crossVersion.count} 个 / ${crossVersion.bytes} 字节仅作对照:` +
        '不同版本内容不同、各自需要,不是冗余,不计入可回收',
    );
  }

  // 分类取「最严重的那个」:判定顺序 ① → ② → ③ 即优先级;都不成立时,多版本 = 合法并存,
  // 单版本多副本 = 同版本却无可提升位置(两者都不判红)
  /** @type {PackSizeDuplicateFinding['classification']} */
  const classification =
    detected[0] ?? (byVersion.size > 1 ? 'parallel-versions' : 'unavoidable-duplicate');
  return {
    name,
    classification,
    red: problems.length > 0,
    copies,
    declarations,
    reclaimableBytes,
    unavoidableBytes,
    crossVersionIdenticalFiles: crossVersion,
    reasons: problems,
    notes,
  };
}

/**
 * 读 package.json 的 productName(解包 exe 定位口径;读不到按空串处理)。
 * @returns {string} productName
 */
function readProductName() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  } catch {
    return '';
  }
}

/**
 * 在目录里找体积最大的匹配文件(确定性:同体积按名序)。
 * @param {string} dir 目录
 * @param {RegExp} pattern 文件名匹配
 * @returns {{ path: string, bytes: number } | null} 命中项
 */
function largestMatch(dir, pattern) {
  if (!existsSync(dir)) return null;
  let best = null;
  for (const name of readdirSync(dir).sort()) {
    if (!pattern.test(name)) continue;
    const candidate = path.join(dir, name);
    if (!statSync(candidate).isFile()) continue;
    const bytes = statSync(candidate).size;
    if (best === null || bytes > best.bytes) best = { path: candidate, bytes };
  }
  return best;
}

/**
 * 实测一次:所有条目字节 + asar 头信息 + 重复打包事实(纯读,不改任何产物)。
 * @param {object} spec 入参
 * @param {string} spec.unpackedDir 解包目录
 * @param {string} spec.releaseDir 发布产物根目录
 * @param {string} [spec.productName] 应用可执行文件名
 * @returns {{ ok: true, measurement: PackSizeMeasurement } | { ok: false, reason: string }} 实测结果
 */
export function measure({ unpackedDir, releaseDir, productName = readProductName() }) {
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    return { ok: false, reason: `解包目录不存在:${repoRelative(unpackedDir)}(请先运行 npm run dist)` };
  }
  const asarPath = path.join(unpackedDir, ...ASAR_REL_IN_UNPACKED.split('/'));
  if (!existsSync(asarPath)) {
    return {
      ok: false,
      reason: `应用归档缺失:${repoRelative(asarPath)}(解包目录不完整,打包可能中断;请重跑 npm run dist)`,
    };
  }
  const tree = readAsarTree(asarPath);
  if (!tree.ok) {
    return { ok: false, reason: `app.asar 无法解析:${tree.reason}(无法实测包内子项,请重跑 npm run dist)` };
  }
  const asarFileBytes = statSync(asarPath).size;
  const exe =
    productName === ''
      ? largestMatch(unpackedDir, /\.exe$/i)
      : largestMatch(unpackedDir, new RegExp(`^${escapeRegExp(productName)}\\.exe$`, 'i'));
  const installer = largestMatch(releaseDir, /setup.*\.exe$/i);

  /** @type {Record<string, { id: string, label: string, kind: string, locator: string | null, required: boolean, bytes: number | null, present: boolean, source: string | null }>} */
  const items = {};
  for (const spec of MEASURED_ITEMS) {
    let bytes = null;
    let present = false;
    let source = null;
    if (spec.kind === 'asar-file') {
      bytes = asarFileBytes;
      present = true;
      source = repoRelative(asarPath);
    } else if (spec.kind === 'exe') {
      bytes = exe === null ? null : exe.bytes;
      present = exe !== null;
      source = exe === null ? null : repoRelative(exe.path);
    } else if (spec.kind === 'dir-total') {
      bytes = dirBytes(unpackedDir);
      present = true;
      source = `${repoRelative(unpackedDir)}/**`;
    } else if (spec.kind === 'installer') {
      bytes = installer === null ? null : installer.bytes;
      present = installer !== null;
      source = installer === null ? null : repoRelative(installer.path);
    } else {
      const located = asarTreeBytes(tree.entries, /** @type {string} */ (spec.locator));
      bytes = located;
      present = located !== null;
      source = located === null ? null : `app.asar:${spec.locator}`;
    }
    items[spec.id] = {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      locator: 'locator' in spec ? /** @type {string} */ (spec.locator) : null,
      required: spec.required,
      bytes,
      present,
      source,
    };
  }
  if (exe === null) {
    return {
      ok: false,
      reason:
        `解包目录内找不到应用可执行文件:${repoRelative(unpackedDir)}` +
        `(期望与 productName 同名的 ${productName}.exe;.exe 候选:${readdirSync(unpackedDir)
          .filter((name) => name.toLowerCase().endsWith('.exe'))
          .sort()
          .join(', ') || '(无)'})`,
    };
  }
  const duplicates = analyzeDuplicates({ entries: tree.entries, asarPath, dataStart: tree.dataStart });
  let unpackedEntryBytes = 0;
  for (const entry of tree.entries.values()) if (entry.unpacked) unpackedEntryBytes += entry.size;
  return {
    ok: true,
    measurement: {
      release: {
        releaseDir: repoRelative(releaseDir),
        unpackedDir: repoRelative(unpackedDir),
        asar: repoRelative(asarPath),
        installer: installer === null ? null : repoRelative(installer.path),
      },
      asar: {
        fileBytes: asarFileBytes,
        headerBytes: tree.headerBytes,
        entryCount: tree.entryCount,
        unpackedEntryBytes,
      },
      items,
      duplicates,
    },
  };
}

/**
 * RegExp 元字符转义(把 productName 拼进匹配式用)。
 * @param {string} text 原文
 * @returns {string} 转义后
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析基线文档(自身合规性也要判:不合规的基线不能给出「通过」)。
 * @param {unknown} doc 基线 JSON
 * @returns {PackSizeBaseline} 解析结果
 */
export function parseBaseline(doc) {
  const problems = [];
  const thresholds = { maxRelativeGrowth: 0.2, maxShrinkRatio: 0.5, minGrowthBytes: 64 * MIB };
  const itemOverrides = /** @type {Record<string, number>} */ ({});
  const duplicateWatch = [];
  /** @type {Record<string, number>} */
  const items = {};
  const value = /** @type {Record<string, unknown> | null} */ (doc);
  if (value === null || typeof value !== 'object') {
    return { ok: false, thresholds, itemOverrides, duplicateWatch, items, problems: ['基线文档不是 JSON 对象'] };
  }
  if (value.baselineSchema !== BASELINE_SCHEMA) {
    problems.push(`基线 baselineSchema 必须是 ${BASELINE_SCHEMA},实际 ${JSON.stringify(value.baselineSchema)}`);
  }
  // 判重门禁名单是**数据**:哪几个包名参与「重复打包判红」写在基线里,便于人工 review 与扩充;
  // 引擎本身对任意包名通用(见 analyzeDuplicates),不在代码里写死任何包名
  if (!Array.isArray(value.duplicateWatch) || value.duplicateWatch.length === 0) {
    problems.push('基线缺 duplicateWatch(判重门禁名单:非空字符串数组;缺它则判红规则无从取舍)');
  } else {
    for (const entry of value.duplicateWatch) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        problems.push(`基线 duplicateWatch 含非法条目:${JSON.stringify(entry)}`);
        continue;
      }
      duplicateWatch.push(entry.trim());
    }
  }
  const rawThresholds = value.thresholds;
  if (rawThresholds !== null && typeof rawThresholds === 'object') {
    for (const key of /** @type {const} */ (['maxRelativeGrowth', 'maxShrinkRatio', 'minGrowthBytes'])) {
      const raw = /** @type {Record<string, unknown>} */ (rawThresholds)[key];
      if (raw === undefined) continue;
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        problems.push(`基线阈值 ${key} 必须是正有限数,实际 ${JSON.stringify(raw)}`);
        continue;
      }
      thresholds[key] = raw;
    }
    const byItem = /** @type {Record<string, unknown>} */ (rawThresholds).minGrowthBytesByItem;
    if (byItem !== null && typeof byItem === 'object') {
      for (const [id, raw] of Object.entries(byItem)) {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
          problems.push(`基线阈值 minGrowthBytesByItem.${id} 必须是正有限数,实际 ${JSON.stringify(raw)}`);
          continue;
        }
        itemOverrides[id] = raw;
      }
    }
  }
  const rawItems = value.items;
  if (rawItems === null || typeof rawItems !== 'object') {
    problems.push('基线缺 items 对象(没有基线就无法比对体积)');
  } else {
    for (const [id, raw] of Object.entries(/** @type {Record<string, unknown>} */ (rawItems))) {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        problems.push(`基线条目 ${id} 必须是非负整数字节,实际 ${JSON.stringify(raw)}`);
        continue;
      }
      items[id] = raw;
    }
    const known = new Set(MEASURED_ITEMS.map((item) => item.id));
    for (const id of Object.keys(items)) {
      if (!known.has(id)) problems.push(`基线条目 ${id} 不在实测清单里(条目清单单源在 scripts/pack-size.mjs 的 MEASURED_ITEMS)`);
    }
  }
  return { ok: problems.length === 0, thresholds, itemOverrides, duplicateWatch, items, problems };
}

/**
 * 门禁判定:逐条目比对基线 + 重复打包检查(阈值之外的独立判红项)。
 * @param {PackSizeMeasurement} measurement 实测结果
 * @param {PackSizeBaseline} baseline 基线
 * @returns {PackSizeVerdict} 判定结论
 */
export function evaluate(measurement, baseline) {
  const problems = [...baseline.problems];
  const warnings = [];
  /** @type {PackSizeItemRow[]} */
  const rows = [];
  for (const spec of MEASURED_ITEMS) {
    const measured = measurement.items[spec.id];
    const baselineBytes = baseline.items[spec.id];
    const allowed =
      baselineBytes === undefined
        ? null
        : Math.max(
            baselineBytes * baseline.thresholds.maxRelativeGrowth,
            baseline.itemOverrides[spec.id] ?? baseline.thresholds.minGrowthBytes,
          );
    /** @type {string} */
    let verdict;
    if (measured === undefined || !measured.present) {
      verdict = 'missing';
      if (spec.required) {
        problems.push(
          `${spec.label}(${spec.id})在产物中不存在(基线${baselineBytes === undefined ? '未登记' : `${baselineBytes} 字节`};` +
            '资源被漏收,须重跑 npm run dist 并核对 build.files)',
        );
      } else {
        warnings.push(`${spec.label}(${spec.id})在产物中不存在(该条目非必需,如便携形态无安装包)`);
      }
    } else if (baselineBytes === undefined) {
      verdict = 'new';
      warnings.push(
        `${spec.label}(${spec.id})基线未登记(当前 ${measured.bytes} 字节);` +
          '如需纳入门禁请人工把该值补进基线(基线不做自动重生成)',
      );
    } else {
      const growth = measured.bytes - baselineBytes;
      const shrinkAllowance = baselineBytes * baseline.thresholds.maxShrinkRatio;
      if (growth > /** @type {number} */ (allowed)) {
        verdict = 'over';
        problems.push(
          `${spec.label}(${spec.id})体积超阈值:${baselineBytes} → ${measured.bytes} 字节` +
            `(+${growth},${(growth / MIB).toFixed(1)} MiB;容许 +${Math.round(/** @type {number} */ (allowed))} 字节 = ` +
            `max(基线×${baseline.thresholds.maxRelativeGrowth}, ${baseline.itemOverrides[spec.id] ?? baseline.thresholds.minGrowthBytes} 字节))`,
        );
      } else if (-growth > shrinkAllowance) {
        verdict = 'under';
        problems.push(
          `${spec.label}(${spec.id})体积异常缩小:${baselineBytes} → ${measured.bytes} 字节` +
            `(-${-growth};超过基线的 ${(baseline.thresholds.maxShrinkRatio * 100).toFixed(0)}%);` +
            '多半是资源没进包,须核对 build.files',
        );
      } else {
        verdict = 'ok';
      }
    }
    rows.push({
      id: spec.id,
      label: spec.label,
      bytes: measured === undefined ? null : measured.bytes,
      present: measured !== undefined && measured.present,
      required: spec.required,
      baselineBytes: baselineBytes ?? null,
      deltaBytes: measured === undefined || !measured.present || baselineBytes === undefined ? null : measured.bytes - baselineBytes,
      allowedGrowthBytes: allowed,
      verdict,
    });
  }
  // 判重:只对「可证明的缺陷」且「在门禁名单内」的包名判红;不受任何体积阈值约束。
  // 名单之外的发现照样进报告与信息项(可见但不门禁),合法并存永远不判红。
  const info = [];
  const watch = new Set(baseline.duplicateWatch);
  const duplicateFindings = measurement.duplicates.findings.map((finding) => {
    const gated = watch.has(finding.name);
    const problem = finding.red
      ? `包 ${finding.name} 判重判红(${finding.classification},不受体积阈值约束):${findingDetail(finding)}`
      : null;
    if (problem !== null && gated) problems.push(problem);
    if (!gated) {
      info.push(
        `包 ${finding.name}(不在门禁名单 ${[...watch].join('、') || '(空)'} 内)${finding.red ? '被判定为缺陷但未纳入门禁' : '判定为非缺陷'}:${finding.classification}`,
      );
    } else if (problem === null) {
      info.push(`包 ${finding.name}:合法并存(${finding.classification}),各版本由各自声明范围强制并存,未判红`);
    }
    return { ...finding, gated, problem };
  });
  for (const finding of measurement.duplicates.findings) {
    if (!finding.notes.some((note) => note.includes('不可回收')) && !finding.notes.some((note) => note.includes('仅作对照'))) {
      continue;
    }
    if (watch.has(finding.name) || finding.red) {
      info.push(`包 ${finding.name}:${finding.notes.filter((note) => note.includes('不可回收') || note.includes('仅作对照')).join(';')}`);
    }
  }
  if (measurement.duplicates.excludedTypeOnly.length > 0) {
    const shown = measurement.duplicates.excludedTypeOnly.slice(0, 6);
    info.push(
      `类型声明副本已排除(不随包运行):共 ${measurement.duplicates.excludedTypeOnly.length} 个,例如 ${shown.join('、')}`,
    );
  }
  return {
    status: problems.length === 0 ? STATUS.pass : STATUS.fail,
    rows,
    duplicateFindings,
    problems,
    warnings,
    info,
  };
}

/**
 * 判红结论的问题行正文(把「哪份副本、为什么、可回收多少字节」摊开)。
 * @param {PackSizeDuplicateFinding & { problem: string | null }} finding 结论
 * @returns {string} 正文
 */
function findingDetail(finding) {
  const copies = finding.copies.map((copy) => `${copy.path}@${copy.version}(${copy.bytes} 字节)`).join('、');
  const bytes =
    finding.reclaimableBytes > 0
      ? `可回收 ${finding.reclaimableBytes} 字节`
      : finding.unavoidableBytes > 0
        ? `不可回收 ${finding.unavoidableBytes} 字节(当前树形下无法合并)`
        : '无可回收字节';
  return `副本 ${copies};${bytes};理由:${finding.reasons.join(';')}`;
}

/**
 * 报告里的阈值视图:三个标量 + 单条目绝对闸覆盖(消费方可据此复算每行的
 * allowedGrowthBytes,不必再读基线文件)。
 * @param {PackSizeBaseline | null} baseline 基线
 * @returns {PackSizeReport['thresholds']} 阈值视图
 */
function thresholdView(baseline) {
  if (baseline === null) return null;
  return {
    maxRelativeGrowth: baseline.thresholds.maxRelativeGrowth,
    maxShrinkRatio: baseline.thresholds.maxShrinkRatio,
    minGrowthBytes: baseline.thresholds.minGrowthBytes,
    minGrowthBytesByItem: baseline.itemOverrides,
  };
}

/**
 * 组装报告对象(键序固定 ⇒ 同输入同字节)。
 * @param {object} spec 入参
 * @param {PackSizeMeasurement | null} spec.measurement 实测结果(null = 未测量)
 * @param {string | null} spec.unmeasuredReason 未测量原因
 * @param {PackSizeVerdict | null} spec.verdict 判定结论
 * @param {PackSizeBaseline | null} spec.baseline 基线
 * @returns {PackSizeReport} 报告对象
 */
export function buildReport({ measurement, unmeasuredReason, verdict, baseline }) {
  if (measurement === null || verdict === null) {
    return {
      schema: REPORT_SCHEMA,
      kind: 'pack-size-report',
      status: STATUS.unmeasured,
      measured: false,
      unmeasuredReason,
      release: null,
      asar: null,
      thresholds: thresholdView(baseline),
      duplicateWatch: baseline === null ? null : baseline.duplicateWatch,
      items: [],
      duplicates: null,
      problems: [unmeasuredReason ?? '未测量'],
      warnings: [],
      info: [],
    };
  }
  return {
    schema: REPORT_SCHEMA,
    kind: 'pack-size-report',
    status: verdict.status,
    measured: true,
    unmeasuredReason: null,
    release: measurement.release,
    asar: measurement.asar,
    thresholds: thresholdView(baseline),
    duplicateWatch: baseline === null ? null : baseline.duplicateWatch,
    items: verdict.rows,
    duplicates: measurement.duplicates,
    problems: verdict.problems,
    warnings: verdict.warnings,
    info: verdict.info,
  };
}

/**
 * 人类可读摘要。
 * @param {PackSizeReport} report 报告对象
 * @returns {string} 多行摘要
 */
export function renderSummary(report) {
  const lines = [];
  if (!report.measured) {
    lines.push(`[pack-size] 状态 ${report.status}(未测量,退出码 ${EXIT.unmeasured}):${report.unmeasuredReason}`);
    lines.push('[pack-size] 未测量 ≠ 体积正常:先跑 npm run dist 再执行本门禁');
    return lines.join('\n');
  }
  const thresholds = report.thresholds ?? { maxRelativeGrowth: 0, minGrowthBytes: 0 };
  const asar = report.asar ?? { fileBytes: 0, headerBytes: 0, unpackedEntryBytes: 0, entryCount: 0 };
  const duplicates = report.duplicates;
  const watch = report.duplicateWatch ?? [];
  lines.push(
    `[pack-size] 状态 ${report.status} | 容许增长 max(基线×${thresholds.maxRelativeGrowth}, ` +
      `${thresholds.minGrowthBytes} 字节) | 判重门禁名单 ${watch.length === 0 ? '(空)' : watch.join('、')}`,
  );
  for (const row of report.items) {
    const base = row.baselineBytes === null ? '(基线未登记)' : `${row.bytes - row.baselineBytes >= 0 ? '+' : ''}${row.bytes - row.baselineBytes}`;
    lines.push(
      `  [${row.verdict}] ${row.label}(${row.id}):${row.bytes === null ? '(缺失)' : toMiB(row.bytes)}` +
        ` 基线 ${row.baselineBytes === null ? '-' : toMiB(row.baselineBytes)} 差 ${base} 字节`,
    );
  }
  lines.push(
    `  asar:文件 ${toMiB(asar.fileBytes)}(头 ${toMiB(asar.headerBytes)} + 解包条目 ` +
      `${toMiB(asar.unpackedEntryBytes)},条目数 ${asar.entryCount})`,
  );
  if (duplicates !== null && (duplicates.findings.length > 0 || duplicates.excludedTypeOnly.length > 0)) {
    lines.push(
      `  [判重] 扫描包根 ${duplicates.packagesAnalyzed} 个,${duplicates.multiCopyNames} 个包名有多份副本;` +
        `可回收 ${duplicates.reclaimableBytes} 字节 / 不可回收 ${duplicates.unavoidableBytes} 字节;` +
        `跨版本同名同大小文件 ${duplicates.crossVersionIdenticalFiles.count} 个 / ` +
        `${duplicates.crossVersionIdenticalFiles.bytes} 字节(仅作对照,不计入可回收)`,
    );
    for (const finding of duplicates.findings) {
      const gated = watch.includes(finding.name);
      lines.push(
        `    - ${finding.name}(${gated ? '门禁内' : '名单外,仅信息'}) ${finding.classification}` +
          `${finding.red ? ' [缺陷]' : ''}:${finding.copies.length} 份 / ` +
          `${new Set(finding.copies.map((copy) => copy.version)).size} 个版本 | ` +
          `可回收 ${finding.reclaimableBytes} 字节 | 不可回收 ${finding.unavoidableBytes} 字节`,
      );
      for (const copy of finding.copies) {
        lines.push(`        副本 ${copy.path}@${copy.version}:${toMiB(copy.bytes)}(${copy.fileCount} 个文件)`);
      }
      for (const decl of finding.declarations) {
        lines.push(
          `        声明 ${decl.requirer}[${decl.field}] ${finding.name}@${decl.range} → ${decl.resolvedTo ?? '(未落到包内任何一份)'}`,
        );
      }
      for (const reason of finding.reasons) lines.push(`        理由 ${reason}`);
      for (const note of finding.notes) lines.push(`        说明 ${note}`);
    }
    if (duplicates.excludedTypeOnly.length > 0) {
      // @types/* 有几十个,摘要只列前几个 + 总数(完整清单在报告 JSON 里)
      const shown = duplicates.excludedTypeOnly.slice(0, 6);
      lines.push(
        `    (类型声明副本已排除,不随包运行:共 ${duplicates.excludedTypeOnly.length} 个,例如 ${shown.join('、')})`,
      );
    }
  }
  for (const warning of report.warnings) lines.push(`  [告警] ${warning}`);
  for (const note of report.info) lines.push(`  [信息] ${note}`);
  for (const problem of report.problems) lines.push(`  [问题] ${problem}`);
  return lines.join('\n');
}

/**
 * 读基线文件(不存在/不可解析都归一到 problems,不抛)。
 * @param {string} baselinePath 基线路径
 * @returns {{ doc: unknown, exists: boolean, problems: string[] }} 读取结果
 */
function readBaselineFile(baselinePath) {
  if (!existsSync(baselinePath)) {
    return { doc: null, exists: false, problems: [`体积基线文件不存在:${repoRelative(baselinePath)}`] };
  }
  try {
    return { doc: JSON.parse(readFileSync(baselinePath, 'utf8')), exists: true, problems: [] };
  } catch (error) {
    return {
      doc: null,
      exists: true,
      problems: [
        `体积基线文件不可解析:${repoRelative(baselinePath)}:` +
          `${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * 写报告产物。
 * @param {string} outPath 落点
 * @param {object} report 报告
 * @returns {string} 落点绝对路径
 */
function writeReport(outPath, report) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outPath;
}

/**
 * CLI 主体。
 * @param {string[]} [argv] 参数
 * @returns {number} 进程退出码
 */
export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, {
      booleans: ['help', 'print-measurements'],
      values: ['release', 'unpacked', 'baseline', 'out', 'watch'],
    });
  } catch (error) {
    console.error(`[pack-size:fail] ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.fail;
  }
  if (options.help) {
    console.log(USAGE);
    return EXIT.pass;
  }
  const releaseDir = path.resolve(projectRoot, options.release ?? DEFAULT_RELEASE_DIR);
  const unpackedDir = path.resolve(projectRoot, options.unpacked ?? path.join(releaseDir, UNPACKED_DIR_NAME));
  const baselinePath = path.resolve(projectRoot, options.baseline ?? DEFAULT_BASELINE_REL);
  const outPath = path.resolve(projectRoot, options.out ?? DEFAULT_REPORT_REL);

  const measured = measure({ unpackedDir, releaseDir });
  if (!measured.ok) {
    const report = buildReport({ measurement: null, unmeasuredReason: measured.reason, verdict: null, baseline: null });
    if (options['print-measurements']) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      writeReport(outPath, report);
      console.error(renderSummary(report));
      console.error(`[pack-size:fail] 未测量(退出码 ${EXIT.unmeasured});已写出如实报告:${repoRelative(outPath)}`);
    }
    return EXIT.unmeasured;
  }

  if (options['print-measurements']) {
    // 只打印实测值:人工据此手改基线文件(基线刻意不支持 --write/--update 自动重生成)
    console.log(JSON.stringify(measured.measurement, null, 2));
    return EXIT.pass;
  }

  const read = readBaselineFile(baselinePath);
  const baseline = parseBaseline(read.doc);
  // --watch 只覆盖本次运行的门禁名单(便于临时把某个包名拉进门禁复核),不写回基线
  if (options.watch !== undefined) {
    const override = options.watch
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (override.length === 0) {
      baseline.problems.push('--watch 给了空名单(逗号分隔的包名列表不能为空)');
    } else {
      baseline.duplicateWatch = override;
    }
  }
  const baselineProblems = [...read.problems, ...baseline.problems];
  const verdict = evaluate(measured.measurement, {
    ok: baselineProblems.length === 0,
    thresholds: baseline.thresholds,
    itemOverrides: baseline.itemOverrides,
    duplicateWatch: baseline.duplicateWatch,
    items: baseline.items,
    problems: baselineProblems,
  });
  const report = buildReport({
    measurement: measured.measurement,
    unmeasuredReason: null,
    verdict,
    baseline,
  });
  writeReport(outPath, report);
  if (report.status === STATUS.fail) {
    console.error(renderSummary(report));
    console.error(`[pack-size:fail] 体积门禁判红(退出码 ${EXIT.fail});报告:${repoRelative(outPath)}`);
    return EXIT.fail;
  }
  console.log(renderSummary(report));
  console.log(`[pack-size] 报告已写出:${repoRelative(outPath)}`);
  return EXIT.pass;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
