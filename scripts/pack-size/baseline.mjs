// 基线与门禁判定层:解析基线文档(基线自身不合规即判红,门禁无法判定时不得报绿)、逐条目
// 比对体积阈值、并把判重结论按「是否在门禁名单内」分流成 problems / info。
//
// 阈值口径(勿改):容许增长 = max(基线 × maxRelativeGrowth, minGrowthBytes[该项]),越界才红;
// 缩小超过 maxShrinkRatio 也红(多半是资源没进包)。宁可漏报也不要把正常依赖升级搞成红灯。
// 判重结论不受这些阈值约束,但**只对基线 duplicateWatch 名单内的包名**判红。
//
// 依赖方向:仅 contract.mjs(条目表/常量/类型);不 import measure/report/cli。

import { BASELINE_SCHEMA, MEASURED_ITEMS, MIB, STATUS } from './contract.mjs';

/** @typedef {import('./contract.mjs').PackSizeBaseline} PackSizeBaseline */
/** @typedef {import('./contract.mjs').PackSizeItemRow} PackSizeItemRow */
/** @typedef {import('./contract.mjs').PackSizeMeasurement} PackSizeMeasurement */
/** @typedef {import('./contract.mjs').PackSizeVerdict} PackSizeVerdict */
/** @typedef {import('./contract.mjs').PackSizeDuplicateFinding} PackSizeDuplicateFinding */

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
