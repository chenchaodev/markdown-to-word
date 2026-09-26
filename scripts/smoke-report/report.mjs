// 报告组装层:把运行结果(进程层给的事实)与标记解析结果(标记层给的观测)组装成机器可读
// 报告,并渲染人类摘要。键序固定 ⇒ 同输入同字节(可复现);报告内不含时间戳与绝对路径,
// 耗时只打在摘要里(每次都变的字段会让「产物是否变化」失去可比性)。
//
// 依赖方向:contract.mjs(常量/类型)+ markers.mjs(脱敏)+ smoke-proc.mjs(问题列表单源);
// 不 import 进程层或 CLI 层。

import { collectSmokeProblems } from '../smoke-proc.mjs';
import { EXIT, projectRoot, REPORT_STATUS, SMOKE_REPORT_SCHEMA } from './contract.mjs';
import { parseSmokeOutput, redactPaths } from './markers.mjs';

/** @typedef {import('./contract.mjs').SmokeReport} SmokeReport */

/**
 * 报告状态由问题列表归一(问题列表单源在 collectSmokeProblems,故「什么算失败」
 * 只有一处定义):空 = pass,非空 = fail。
 * @param {string[]} problems 问题列表
 * @returns {string} 报告状态
 */
function statusFromProblems(problems) {
  return problems.length === 0 ? REPORT_STATUS.pass : REPORT_STATUS.fail;
}

/**
 * 状态 → 退出码。
 * @param {string} status 报告状态
 * @returns {number} 进程退出码
 */
export function exitCodeForStatus(status) {
  if (status === REPORT_STATUS.pass) return EXIT.pass;
  if (status === REPORT_STATUS.fail) return EXIT.fail;
  return EXIT.notRun;
}

/**
 * 把一次运行结果归一成报告(纯函数:不碰 fs、不起进程,可直测)。
 * @param {object} spec 入参
 * @param {import('./smoke-proc.mjs').ProcessRunResult} spec.result 运行结果
 * @param {string} spec.source 来源标签(unpacked / dev)
 * @param {string} [spec.target] 目标的可读形态(已相对化;仅作诊断留痕)
 * @returns {SmokeReport} 报告对象(字段顺序即 JSON 键序,保证产物可复现)
 */
export function buildSmokeReport({ result, source, target = '' }) {
  const { markers, missing, degradations } = parseSmokeOutput(result.output);
  const problems = collectSmokeProblems(result, { label: source }).map((problem) =>
    redactPaths(problem, projectRoot),
  );
  return {
    schema: SMOKE_REPORT_SCHEMA,
    kind: 'smoke-report',
    source,
    status: statusFromProblems(problems),
    executed: true,
    target,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    unterminated: result.unterminated === true,
    spawnError:
      result.spawnError === undefined ? null : redactPaths(result.spawnError.message, projectRoot),
    markerContract: {
      expected: markers.length,
      present: markers.filter((marker) => marker.present).length,
      missing: missing.length,
    },
    markers,
    missingMarkers: missing,
    degradations,
    problems,
  };
}

/**
 * 「未执行」报告:前置缺失时产出。**不是**通过,也**不是**失败 —— 单独一档,
 * 避免「本机没装 Electron」被读成「冒烟正常」。
 * @param {object} spec 入参
 * @param {string} spec.source 来源标签
 * @param {string} spec.reason 未执行原因(必须是相对路径形态,内部再净化一次)
 * @param {string} [spec.target] 目标可读形态
 * @returns {SmokeReport} 报告对象
 */
export function buildNotRunReport({ source, reason, target = '' }) {
  return {
    schema: SMOKE_REPORT_SCHEMA,
    kind: 'smoke-report',
    source,
    status: REPORT_STATUS.notRun,
    executed: false,
    target,
    exitCode: null,
    signal: null,
    timedOut: false,
    unterminated: false,
    spawnError: null,
    markerContract: null,
    markers: [],
    missingMarkers: [],
    degradations: [],
    problems: [redactPaths(`未执行:${reason}`, projectRoot)],
    notRunReason: redactPaths(reason, projectRoot),
  };
}

/**
 * 人类可读摘要(耗时只在这里出现:报告 JSON 要可复现,而每次运行都变的字段
 * 正是「产物变了没有」这件事的噪音源;故耗时入摘要、不入产物)。
 * @param {SmokeReport} report 报告对象
 * @param {object} [spec] 附加信息
 * @param {number | null} [spec.elapsedMs] 本次运行耗时(ms);null = 未计时
 * @returns {string} 多行摘要
 */
export function renderSmokeSummary(report, { elapsedMs = null } = {}) {
  const lines = [];
  const head =
    `[smoke-report] 来源 ${report.source} | 状态 ${report.status} | ` +
    `退出码 ${report.exitCode === null ? '(无)' : report.exitCode} | ` +
    `标记 ${report.markerContract === null ? '0/0' : `${report.markerContract.present}/${report.markerContract.expected}`} | ` +
    `降级 ${report.degradations.length} | 耗时 ${elapsedMs === null ? '(未计时)' : `${elapsedMs}ms`}`;
  lines.push(head);
  if (report.markerContract !== null) {
    for (const marker of report.markers) {
      lines.push(`  ${marker.present ? '[有]' : '[缺]'} ${marker.label}(${marker.id})`);
    }
  }
  for (const degradation of report.degradations) {
    lines.push(`  [降级] ${degradation.label} ×${degradation.count}(非致命,不影响判定)`);
  }
  for (const problem of report.problems) lines.push(`  [问题] ${problem}`);
  return lines.join('\n');
}
