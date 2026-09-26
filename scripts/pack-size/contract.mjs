// 体积门禁的契约常量层:schema 版本、报告/退出码状态、MiB 基数、默认落点、实测条目表,
// 以及全模块共用的 JSDoc 类型契约(各层用 `@typedef {import('./contract.mjs').X} X` 引用,
// 类型引用在运行期擦除,故不产生运行期依赖)。
//
// 「已接受例外」:MEASURED_ITEMS 是一张 10 行的条目表(每行一个待测项 + 测法 + 是否必需),
// 它是「测什么」的唯一来源,拆散反而会让条目与口径走散;本文件因此集中放常量与该表,
// 不与任何判定逻辑混放 —— 判定在 baseline.mjs、测量在 measure.mjs。

/** @typedef {import('./contract.mjs').PackSizeItemSpec} PackSizeItemSpec */

/** 体积基线 schema 版本 */
export const BASELINE_SCHEMA = 1;
/** 体积报告 schema 版本 */
export const REPORT_SCHEMA = 1;
/** 基线文件默认落点(仓库内,随代码提交,人工维护) */
export const DEFAULT_BASELINE_REL = 'scripts/pack-size.baseline.json';
/** 体积报告默认落点(gitignore 覆盖 output/) */
export const DEFAULT_REPORT_REL = 'output/artifacts/pack-size-report.json';
/** 默认发布产物目录(与 build.directories.output 同口径) */
export const DEFAULT_RELEASE_DIR = 'release';
/** electron-builder 的 win 解包目录名(写死:改名会让本脚本与产物布局分叉) */
export const UNPACKED_DIR_NAME = 'win-unpacked';
/** 解包目录内 app.asar 的固定位置(electron-builder 布局) */
export const ASAR_REL_IN_UNPACKED = 'resources/app.asar';

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
export const MIB = 1024 * 1024;

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
