// 门禁探针的契约常量与类型单源(各 island 与消费方一律从此 import,勿各写一份):
// 报告 schema 与落盘路径、被保护路径清单、沙盒复制清单、门禁 id 与元信息,以及跨文件
// 传递的数据形状(JSDoc typedef)。本文件只出常量与类型:零逻辑、零 IO、可直读。
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- 契约常量(单一来源;报告与摘要都从这里取) ---------- */

/** 项目根(scripts/ 的上一级) */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

/** 工程副本需要复制的路径(段模块与门禁脚本按自身位置推导项目根,故须整树复制) */
export const TREE_MIRROR_PATHS = [
  "src",
  "test",
  "dist",
  "scripts",
  "package.json",
  "tsconfig.json",
  "tsconfig.test.json",
];

/** 真实工作树的被保护路径(探针前后逐字节比对) */
export const PROTECTED_PATHS = [
  "src",
  "test",
  "dist",
  "scripts",
  "output",
  "package.json",
  "package-lock.json",
];

/** 可选门禁 id(顺序即执行顺序) */
export const GATE_IDS = Object.freeze(["fixtures", "coverage", "dist-manifest", "build-fresh", "smoke"]);

/** 门禁 id → 元信息(npm 脚本名与真实命令行,报告里照实登记) */
export const GATE_META = Object.freeze({
  fixtures: {
    title: "fixtures 漂移门禁",
    npmScript: "check:fixtures",
    command: "node test/tools/gen-fixtures.mjs --check",
  },
  coverage: {
    title: "coverage 阈值门禁",
    npmScript: "test:coverage",
    command: "c8 --check-coverage --statements=90 --branches=85 --functions=90 --lines=90 <program>",
  },
  "dist-manifest": {
    title: "dist 清单门禁",
    npmScript: "check:dist-manifest",
    command: "node scripts/check-dist-manifest.mjs --check",
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
