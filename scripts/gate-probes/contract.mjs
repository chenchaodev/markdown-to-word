// 门禁探针的契约常量与类型单源(各 island 与消费方一律从此 import,勿各写一份):
// 报告 schema 与落盘路径、被保护路径清单、沙盒复制清单、门禁 id 与元信息,以及跨文件
// 传递的数据形状(JSDoc typedef)。本文件只出常量与类型:可直读。两处路径清单在导入时派生
// 一次(见下),除此之外本文件零逻辑。
//
// 那两处清单已改为**从实际顶层派生**(scripts/repo-manifest.mjs,ADR-037):此前它们是手写
// 枚举,新增一个顶层目录时漏改的那份只会「扫不到」而不报错(恒绿失效)。
import path from "node:path";
import { ROOT } from "../../shared/paths.js";
import { topLevel } from "../repo-manifest.mjs";

/** 顶层派生结果(本文件两处清单的唯一来源;求值在导入时发生一次) */
const MANIFEST = topLevel(ROOT);

/* ---------- 契约常量(单一来源;报告与摘要都从这里取) ---------- */

/** 项目根(单一来源在 shared/paths.js;此处转出是探针各 island 的既有取法) */
export { ROOT };

/** 报告 schema 版本:字段不兼容变更时递增 */
export const REPORT_SCHEMA = "m2w/gate-probes@1";

/** 报告落盘位置(仓库相对;同时是被保护指纹的豁免目录 —— 报告自身不算工作树改动) */
export const REPORT_RELATIVE = "output/artifacts/gate-probes/report.json";
export const REPORT_DIR_RELATIVE = path.posix.dirname(REPORT_RELATIVE);

/** 沙盒目录名前缀(系统临时目录,便于识别残留) */
export const SANDBOX_PREFIX = "m2w-gate-probes-";

/** 单进程硬超时默认值:node 侧门禁足够宽裕,smoke 另给更宽的值 */
export const NODE_TIMEOUT_MS = 120_000;
export const SMOKE_TIMEOUT_MS = 240_000;

/**
 * 工程副本需要复制的路径(段模块与门禁脚本按自身位置推导项目根,故须整树复制)。
 *
 * 派生口径(意图保留在此,清单本身在 scripts/repo-manifest.mjs 的 manifest.mirrorPaths):
 * **编译源码树、验收/门禁树、机制树、编译输出树按整树复制;顶层声明文件按文件粒度复制。**
 * 编译输出树也在内 —— 测试 import 的是产物而非源码,不带过去沙盒内的门禁就跑不起来。
 * 声明文件只带编译器配置与包清单(锁文件不带:依赖是目录联接挂入的,离线构建读不到)。
 *
 * `shared` 会在清单内:项目根单源是 `shared/paths.js`,而沙盒内执行的
 * `scripts/copy-renderer.mjs`(经 buildSandbox)与 `test/tools/gen-fixtures.mjs`
 * → `test/common/paths.js`(经 probeFixtures)都会 import 它。缺它 ⇒ 沙盒内构建
 * 以「资源拷贝 exit 1」失败,而该失败原先只降级成装饰性 advisory(见 report.mjs)。
 * 这条注释是历史教训的记录,不再是「记得手动加一条」的理由 —— 清单已派生,新增顶层树自动在内。
 */
export const TREE_MIRROR_PATHS = MANIFEST.mirrorPaths;

/**
 * 真实工作树的被保护路径(探针前后逐字节比对)。
 *
 * 派生口径:**沙盒会带过去执行的面 ∪ 验收产物根 ∪ 锁文件**。前者是子进程能写到的代码与配置,
 * 后两者不在镜像集里但确实会被子进程写(验收段落产物、npm 改锁文件)。
 * 验收产物根从路径单源 shared/paths.js 的常量反推,故 `shared` 这类新顶层目录自动被覆盖 ——
 * 漏掉它等于「真实工作树零注入」这条承诺不覆盖它(沙盒脚本若把根指回真实工作树并写进
 * shared/,指纹将看不出变化)。
 */
export const PROTECTED_PATHS = MANIFEST.protectedTreePaths;

/** 可选门禁 id(顺序即执行顺序) */
export const GATE_IDS = Object.freeze([
  "fixtures",
  "coverage",
  "dist-manifest",
  "dual-matrix",
  "build-fresh",
  "smoke",
]);

/** 门禁 id → 元信息(npm 脚本名与命令登记,报告里照实登记) */
export const GATE_META = Object.freeze({
  fixtures: {
    title: "fixtures 漂移门禁",
    npmScript: "check:fixtures",
    command: "node test/tools/gen-fixtures.mjs --check",
  },
  coverage: {
    title: "coverage 阈值门禁",
    npmScript: "test:coverage",
    // 刻意不抄 c8 参数向量(含四个阈值):本字段的唯一去向是报告展示 —— judge.mjs 原样
    // 抄进 report.json,无任何判定读它。抄一份就多一处会静默过期、且过期后无人判红的
    // 文本(实测:阈值调到 1 时本字段仍显示 90,而门禁判红来自别处)。真实向量由
    // gates/coverage.mjs 的 parseCoverageScript() 在运行时从 package.json 读出,
    // 并写进该门禁的 note 与 findings.evidence,故信息并未丢失。
    command: "c8 <参数向量取自 package.json 的 test:coverage,见本门禁 note> <program>",
  },
  "dist-manifest": {
    title: "dist 清单门禁",
    npmScript: "check:dist-manifest",
    command: "node scripts/check-dist-manifest.mjs --check",
  },
  "dual-matrix": {
    title: "双管线矩阵键覆盖登记门禁",
    npmScript: "M2W_ONLY=dual-pipeline-matrix(验收段内)",
    command: "M2W_ONLY=dual-pipeline-matrix electron test/acceptance.mjs",
  },
  "build-fresh": {
    title: "构建新鲜度门禁(test:smoke 前置)",
    npmScript: "test:smoke(前置)",
    command: "node scripts/check-build-fresh.mjs",
  },
  smoke: {
    title: "打包前 smoke 冒烟门禁",
    npmScript: "test:smoke",
    command: "electron . --smoke",
  },
});

/* ---------- 本文件契约类型(单一来源,消费方 import type 用) ---------- */

/**
 * @typedef {"zero"|"nonzero"} ExitExpectation 退出码期望
 * @typedef {"anchor"|"fault"|"blindspot"} ProbeKind 探针类别
 */

/**
 * @typedef {object} ProbeCase 单条探针结果(锚点 / 负向 / 盲区观测)
 * @property {string} id 探针 id(门禁内唯一)
 * @property {ProbeKind} kind 类别
 * @property {string} description 做了什么(中文,可读)
 * @property {string} [fault] 注入的故障(锚点无)
 * @property {ExitExpectation} expect 退出码期望
 * @property {boolean} ok 是否符合期望(退出码 + 关键字双判定)
 * @property {boolean} [informational] true = 只观测记录,不参与门禁判定(盲区登记用)
 * @property {number | null} exitCode 实际退出码(null = 信号终止/启动失败)
 * @property {boolean} timedOut 是否由硬超时触发(已杀进程树)
 * @property {string[]} diagnosticHits 命中的诊断关键字
 * @property {string[]} missingKeywords 期望命中但未命中的关键字
 * @property {string[]} forbiddenHits 命中了「不该出现」的关键字(应为空)
 * @property {string} [note] 补充说明(诊断正文摘录、不可信原因等)
 */

/**
 * @typedef {object} ProbeFinding 探针过程中的如实登记项(盲区 / 边界)
 * @property {string} id
 * @property {"advisory"|"blocking"} severity
 * @property {string} summary 结论
 * @property {string} evidence 证据(确定性描述,不含绝对路径)
 */

/**
 * @typedef {object} GateProbeResult 单道门禁的探针结果
 * @property {string} id
 * @property {string} title
 * @property {string} npmScript
 * @property {string} command
 * @property {boolean} sandboxed 是否全程在沙盒内完成(真实工作树零注入)
 * @property {string[]} sandboxInputs 沙盒内容(相对路径;node_modules 以联接挂入)
 * @property {"pass"|"fail"} verdict
 * @property {ProbeCase[]} cases
 * @property {ProbeFinding[]} findings
 * @property {string} [note]
 */

/**
 * @typedef {object} ProtectedTreeState 真实工作树指纹快照
 * @property {Record<string, string>} fingerprints 路径 → 指纹串
 * @property {Map<string, string>} entries 逐文件条目(仓库相对路径 → 字节数:内容哈希前 16)
 * @property {{ exists: boolean, topLevelEntries: number }} nodeModules
 */

/**
 * @typedef {object} GateProbeReport 探针总报告(report.json 的形状)
 * @property {string} schema
 * @property {GateProbeResult[]} gates
 * @property {ProbeFinding[]} findings 全局登记项
 * @property {{ unchanged: boolean, changedPaths: string[], changedFiles: string[], nodeModulesIntact: boolean, tolerance: "strict"|"concurrent" }} protectedTree
 * @property {{ gates: number, gatesPassed: number, gatesFailed: number, cases: number, casesPassed: number, casesFailed: number, informational: number }} summary
 */
