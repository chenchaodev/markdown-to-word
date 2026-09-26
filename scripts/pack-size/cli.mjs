// CLI 装配层:参数解析、路径推导、基线读取、跑测量 → 判定 → 写报告 → 打摘要,并把结论映射成
// 退出码(0 通过 / 1 判红 / 2 未测量)。**不判定**:判定全在 baseline.mjs,这里只负责编排与 I/O。
//
// 基线不做自动重生成:没有 --write/--update 入口,基线只能人工改(与
// scripts/pinned-actions.baseline.json 同纪律)。--watch 只覆盖本次运行,不写回基线。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../check-dist-manifest.mjs';
import { measure } from './measure.mjs';
import { evaluate, parseBaseline } from './baseline.mjs';
import { buildReport, renderSummary } from './report.mjs';
import {
  DEFAULT_BASELINE_REL,
  DEFAULT_RELEASE_DIR,
  DEFAULT_REPORT_REL,
  EXIT,
  STATUS,
  UNPACKED_DIR_NAME,
} from './contract.mjs';
import { projectRoot, repoRelative } from './util.mjs';

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
