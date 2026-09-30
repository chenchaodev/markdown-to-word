// 报告层:把实测 + 判定组装成机器可读报告(键序固定 ⇒ 同输入同字节,可复现),并渲染人类摘要。
// 报告产物内不得出现时间戳与绝对路径 —— 体积数字是唯一内容,摘要里的相对路径才带位置信息。
//
// 依赖方向:仅 contract.mjs(常量/类型);不 import measure/baseline/cli。

import { EXIT, MIB, REPORT_SCHEMA, STATUS } from './contract.mjs';

/** @typedef {import('./contract.mjs').PackSizeBaseline} PackSizeBaseline */
/** @typedef {import('./contract.mjs').PackSizeMeasurement} PackSizeMeasurement */
/** @typedef {import('./contract.mjs').PackSizeReport} PackSizeReport */
/** @typedef {import('./contract.mjs').PackSizeVerdict} PackSizeVerdict */

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
