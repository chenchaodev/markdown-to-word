import { fileURLToPath } from 'node:url';

/** 仓库根(报告与摘要只允许相对路径,故一切定位都从这里出发) */
export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

// 冒烟报告的契约常量层:schema 版本、状态与退出码、非致命降级标记清单、默认落点,
// 以及全模块共用的 JSDoc 类型契约(各层用 `@typedef {import('./contract.mjs').X} X` 引用,
// 类型引用运行期擦除,不产生运行期依赖)。
//
// 降级标记为何在此按字面登记(而不是 import src/main/smoke.ts 的常量):那个模块
// import electron,纯 node 进程链不到它的命名导出。漂移由 test/segments/observability.test.js
// 断言与 dist/main/smoke.js 的 SMOKE_MARKER.pdfDegraded 恒等来守。


/** 报告 schema 版本(消费端按此判形状;字段语义只增不改) */
export const SMOKE_REPORT_SCHEMA = 1;
/** 报告产物固定文件名(默认落点,gitignore 覆盖 output/) */
export const DEFAULT_REPORT_REL = 'output/artifacts/smoke-report.json';
/** 默认报告目录下的临时根(一次性 userData;结束即删) */
export const DEFAULT_SCRATCH_REL = 'output/smoke-report';
/** electron-builder 的 win 解包目录名(写死:改名会让本脚本与产物布局分叉) */
export const UNPACKED_DIR_NAME = 'win-unpacked';
/** 默认发布产物目录(与 check-unpacked-smoke.mjs 同口径;build.directories.output 变更需同改) */
export const DEFAULT_RELEASE_DIR = 'release';
/** 失败留痕的原始输出文件名(仅失败时写;不进报告 JSON,故不影响可复现性) */
export const LOG_SUFFIX = '.log';

/** 报告状态取值 */
export const REPORT_STATUS = Object.freeze({
  /** 跑过了:标记齐 + 退出码 0 */
  pass: 'pass',
  /** 跑过了但没过:缺标记 / 非零退出 / 超时 / 启动失败 */
  fail: 'fail',
  /** 没跑:前置缺失(无产物 / 无 Electron / 未构建),退出码与 fail 区分 */
  notRun: 'not-run',
});

/**
 * @typedef {object} SmokeMarkerHit 单条诊断标记的命中情况
 * @property {string} id 标记 id
 * @property {string} label 标记中文名(缺失清单按它点名)
 * @property {string} token 标记字面量
 * @property {boolean} present 是否命中
 */

/**
 * @typedef {object} SmokeDegradation 非致命降级留痕
 * @property {string} id 降级项 id
 * @property {string} label 降级项中文名
 * @property {string} token 降级行标记字面量
 * @property {number} count 出现次数
 */

/**
 * @typedef {object} SmokeReport 机器可读冒烟报告(本文件契约;键序固定 ⇒ 产物可复现)
 * @property {number} schema 报告 schema 版本
 * @property {string} kind 恒为 smoke-report
 * @property {string} source 来源(unpacked / dev)
 * @property {string} status pass | fail | not-run
 * @property {boolean} executed 是否真的跑过(未执行为 false,不得被读成通过)
 * @property {string} target 目标可读形态(仓库相对路径)
 * @property {number | null} exitCode 被测进程退出码(null = 无信号/未产出)
 * @property {string | null} signal 终止信号
 * @property {boolean} timedOut 是否由硬超时触发
 * @property {boolean} unterminated 硬杀后仍未退出(可能有残留进程)
 * @property {string | null} spawnError 启动失败原因(已脱敏,无则 null)
 * @property {{ expected: number, present: number, missing: number } | null} markerContract 标记契约计数(未执行为 null)
 * @property {SmokeMarkerHit[]} markers 逐条标记命中表
 * @property {string[]} missingMarkers 缺失标记的 label 清单
 * @property {SmokeDegradation[]} degradations 非致命降级项
 * @property {string[]} problems 问题列表(空数组 = 通过)
 * @property {string} [notRunReason] 未执行原因(仅 status=not-run 时存在)
 */

/**
 * 退出码语义(消费端必须按此区分「没跑」与「跑了没过」):
 * 0 = pass,1 = fail,2 = not-run(未执行)。
 */
export const EXIT = Object.freeze({ pass: 0, fail: 1, notRun: 2 });

/**
 * 非致命降级留痕行的标记契约。
 *
 * 出处是 src/main/smoke.ts 的 SMOKE_MARKER.pdfDegraded(唯一实现在 src/,dev 侧入口
 * 只转调),这里不能 import 它:该模块 import electron,纯 node 进程里链不到命名导出。
 * 故此处按字面登记 + 由 test/segments/observability.test.js 断言与
 * dist/main/smoke.js 的 SMOKE_MARKER.pdfDegraded 恒等(漂移即判红),口径与
 * test/segments/packaged-smoke.test.js 对 SMOKE_MARKERS 的恒等守护同款。
 */
export const DEGRADATION_TOKENS = Object.freeze([
  { id: 'pdf-degraded', label: 'pdf 降级(非致命)', token: '[smoke] pdf 降级(非致命):' },
]);
