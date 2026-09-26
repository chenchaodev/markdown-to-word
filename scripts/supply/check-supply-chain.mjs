// 供应链门禁总入口:SCA + SBOM + 许可证/NOTICE 三段汇总,exit 0/1。
//
// 为什么不并入本地 verify:ci:SCA 要联网查 advisory 库,npmmirror 的 audit 端点
// 不可用、OSV 的可达性也随网络环境波动。并进本地链会让「代码没问题」与「网络抖动」
// 两种失败混在同一个退出码里,本地验证因此变得不稳定且耗时。故 check:supply 是
// **独立**入口,只由 CI/Release 调用,失败即阻断发布。
//
// 三段的判定责任:
//   - SBOM:生成(默认)或 --sbom-check 漂移校验;漂移即失败。
//   - 许可证:未知/缺失许可证判红;copyleft 与多分支许可单列待人工复核(不阻断)。
//   - SCA:真实漏洞按 production 优先判红;扫描源不可用判红,且绝不表述为「无漏洞」。
//
// 用法:
//   node scripts/supply/check-supply-chain.mjs [选项]
//       [--registry <url>] [--osv-endpoint <url>] [--no-osv] [--no-npm-audit]
//       [--sbom-check] [--output-dir <dir>]

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPLY_OUTPUT_DIR,
  errorMessage,
  isMainModule,
  parseSupplyArgs,
  readJson,
  resolveRegistry,
  toPosix,
  writeFileAtomic,
  writeJson,
} from './supply-common.mjs';
import { diffSbom, generateSbom } from './gen-sbom.mjs';
import { DEFAULT_LICENSES_FILE, DEFAULT_NOTICE_FILE, STATUS_OK as LICENSES_OK, generateLicenses } from './gen-licenses.mjs';
import { STATUS_OK as SCA_OK, runScaScan } from './sca-audit.mjs';

/** 总报告 schema 版本 */
export const SUPPLY_REPORT_SCHEMA = 'm2w/supply-report@1';

/**
 * 三段检查的结论(总报告 sections)。
 * @typedef {object} SupplySections
 * @property {{ status: string; problem: string | null; [k: string]: any }} sbom
 * @property {{ status: string; problem: string | null; counts?: any; unknownLicense?: any[]; needsReview?: string[]; [k: string]: any }} licenses
 * @property {{ status: string; problem: string | null; scanStatus?: string; sources?: any[]; blocking?: string[]; notes?: string[]; [k: string]: any }} sca
 */

/**
 * 供应链总报告(supply-report.json 的文档形状)。
 * @typedef {object} SupplyReport
 * @property {string} schema
 * @property {string} lockfile 输入标识
 * @property {string} status ok / fail
 * @property {SupplySections} sections
 */

const USAGE = `用法: node scripts/supply/check-supply-chain.mjs [选项]
  --lock <file>          输入 lockfile(默认项目根的 package-lock.json)
  --registry <url>      audit 端点(默认取项目 .npmrc 的 registry)
  --osv-endpoint <url>  OSV 端点(默认 https://api.osv.dev,或环境变量 M2W_OSV_ENDPOINT)
  --no-osv              禁用 OSV 兜底,只用 npm audit
  --no-npm-audit        禁用 npm audit,只用 OSV
  --sbom-check          SBOM 走漂移校验(比对已生成产物)而非重新生成
  --output-dir <dir>    产物目录(默认 ${toPosix(SUPPLY_OUTPUT_DIR)})
  --help                显示本用法`;

/**
 * 跑三段检查并汇总(纯编排:不吞错,任一段阻断即整体失败)。
 * @param {object} options 选项
 * @returns {Promise<{ status: string; report: SupplyReport }>}
 */
export async function runSupplyChecks(options = {}) {
  const {
    projectRoot,
    lockPath = path.join(projectRoot, 'package-lock.json'),
    outputDir = path.join(projectRoot, SUPPLY_OUTPUT_DIR),
    registry,
    registrySource = '.npmrc',
    osvEndpoint,
    allowOsv = true,
    allowNpmAudit = true,
    sbomCheck = false,
    transport,
    fetchImpl,
  } = options;

  const lockLabel = toPosix(path.relative(projectRoot, lockPath)) || 'package-lock.json';
  const problems = [];
  const sections = {};

  // ---- 1. SBOM:离线确定性产物,或与既有产物比对漂移 ----
  const sbomPath = path.join(outputDir, 'sbom.cdx.json');
  try {
    const built = generateSbom(lockPath, lockLabel);
    if (sbomCheck) {
      if (!existsSync(sbomPath)) {
        sections.sbom = { status: 'fail', problem: `校验模式缺少已生成的 SBOM:${toPosix(sbomPath)}` };
        problems.push(`SBOM 校验失败:缺少已生成的 ${toPosix(sbomPath)}`);
      } else {
        const existing = readJson(sbomPath);
        const drift = diffSbom(existing, built.document);
        if (drift.length > 0) {
          sections.sbom = { status: 'fail', problem: drift.join('; '), drift };
          problems.push(`SBOM 与 lockfile 漂移(${drift.length} 项):${drift[0]}`);
        } else {
          sections.sbom = { status: 'ok', problem: null, componentCount: built.stats.componentCount };
        }
      }
    } else {
      writeJson(sbomPath, built.document);
      sections.sbom = {
        status: 'ok',
        problem: null,
        path: toPosix(path.relative(projectRoot, sbomPath)),
        componentCount: built.stats.componentCount,
        productionCount: built.stats.productionCount,
        developmentCount: built.stats.developmentCount,
        missingLicenseCount: built.stats.missingLicenseCount,
        serialNumber: built.document.serialNumber,
      };
    }
  } catch (error) {
    sections.sbom = { status: 'fail', problem: `SBOM 生成失败:${errorMessage(error)}` };
    problems.push(`SBOM 生成失败:${errorMessage(error)}`);
  }

  // ---- 2. 许可证/NOTICE:未知/缺失许可证判红 ----
  try {
    const { report, notice } = generateLicenses(lockPath, lockLabel);
    const licensesPath = path.join(outputDir, DEFAULT_LICENSES_FILE);
    const noticePath = path.join(outputDir, DEFAULT_NOTICE_FILE);
    writeJson(licensesPath, report);
    writeFileAtomic(noticePath, notice);
    sections.licenses = {
      status: report.status === LICENSES_OK ? 'ok' : 'fail',
      problem: null,
      path: toPosix(path.relative(projectRoot, licensesPath)),
      noticePath: toPosix(path.relative(projectRoot, noticePath)),
      counts: report.counts,
      unknownLicense: report.unknownLicense,
      needsReview: report.needsReview,
    };
    if (report.status !== LICENSES_OK) {
      for (const entry of report.unknownLicense) {
        const problem = `许可证缺失:${entry.name}@${entry.version}(${entry.isProductionDependency ? '生产依赖' : '仅开发依赖'}) — ${entry.reason}`;
        problems.push(problem);
      }
    }
  } catch (error) {
    sections.licenses = { status: 'fail', problem: `许可证清单生成失败:${errorMessage(error)}` };
    problems.push(`许可证清单生成失败:${errorMessage(error)}`);
  }

  // ---- 3. SCA:production 优先判红;扫描源不可用判红 ----
  try {
    const scan = await runScaScan({
      lockPath,
      lockLabel,
      registry,
      registrySource,
      allowOsv,
      allowNpmAudit,
      ...(osvEndpoint === undefined ? {} : { osvEndpoint }),
      ...(transport === undefined ? {} : { transport }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    sections.sca = {
      status: scan.status === SCA_OK && scan.blocking.length === 0 ? 'ok' : 'fail',
      problem: null,
      reportPath: toPosix(path.relative(projectRoot, path.join(outputDir, 'sca-report.json'))),
      scanStatus: scan.status,
      sources: scan.sources,
      blocking: scan.blocking,
      notes: scan.notes,
    };
    writeJson(path.join(outputDir, 'sca-report.json'), scan);
    problems.push(...scan.blocking);
  } catch (error) {
    sections.sca = { status: 'fail', problem: `SCA 扫描未完成:${errorMessage(error)}` };
    problems.push(`SCA 扫描未完成:${errorMessage(error)}`);
  }

  const report = {
    schema: SUPPLY_REPORT_SCHEMA,
    lockfile: lockLabel,
    status: problems.length === 0 ? 'ok' : 'fail',
    sections,
  };
  writeJson(path.join(outputDir, 'supply-report.json'), report);
  return { status: report.status, report };
}

/**
 * 渲染人读日志。
 * @param {SupplyReport} report runSupplyChecks 的 report
 * @returns {string[]} 日志行
 */
export function formatSupplyLog(report) {
  const lines = [];
  const sbom = report.sections.sbom;
  if (sbom.status === 'ok') {
    lines.push(
      `[supply:ok] SBOM:${sbom.path ?? '已校验'}(${sbom.componentCount} 个组件` +
        `${sbom.productionCount === undefined ? '' : `:生产 ${sbom.productionCount} / 开发 ${sbom.developmentCount}`};` +
        `无声明许可证 ${sbom.missingLicenseCount ?? 0})`,
    );
  } else {
    lines.push(`[supply:fail] SBOM:${sbom.problem ?? '未产出结论'}`);
  }
  const licenses = report.sections.licenses;
  if (licenses.status === 'ok') {
    lines.push(
      `[supply:ok] 许可证:${licenses.path} + ${licenses.noticePath}` +
        `(共 ${licenses.counts.total}:生产 ${licenses.counts.production} / 开发 ${licenses.counts.development};` +
        `需人工复核 ${licenses.counts.needsReview})`,
    );
    for (const item of licenses.needsReview ?? []) lines.push(`[supply:warn] 需人工复核的许可证:${item}`);
  } else {
    for (const entry of licenses.unknownLicense ?? []) {
      lines.push(
        `[supply:fail] 许可证缺失:${entry.name}@${entry.version}(${entry.isProductionDependency ? '生产依赖' : '仅开发依赖'}) — ${entry.reason}`,
      );
    }
    if (licenses.problem !== null && licenses.problem !== undefined) lines.push(`[supply:fail] 许可证:${licenses.problem}`);
  }
  const sca = report.sections.sca;
  for (const source of sca.sources ?? []) {
    if (source.status !== 'ok') lines.push(`[supply:warn] 扫描源 ${source.id}(${source.endpoint})不可用:${source.reason ?? '未提供原因'}`);
  }
  for (const problem of sca.problem === null ? [] : [sca.problem]) lines.push(`[supply:fail] SCA:${problem}`);
  for (const blocking of sca.blocking ?? []) lines.push(`[supply:fail] ${blocking}`);
  for (const note of sca.notes ?? []) {
    if (note.startsWith('扫描源不可用:')) continue;
    lines.push(`[supply:warn] ${note}`);
  }
  if (sca.scanStatus === 'unavailable') {
    lines.push('[supply:fail] 依赖漏洞状态未能判定(扫描源全部不可用);这不等于「无漏洞」,发布被阻断');
  }
  lines.push(
    report.status === 'ok'
      ? `[supply:ok] 供应链检查通过(SBOM / 许可证 / SCA 三段),产物目录 ${toPosix(SUPPLY_OUTPUT_DIR)}`
      : `[supply:fail] 供应链检查失败,共 ${countProblems(report)} 项阻断`,
  );
  return lines;
}

/**
 * 统计阻断项数量(三段之和)。
 * @param {SupplyReport} report runSupplyChecks 的 report
 * @returns {number} 阻断项数
 */
export function countProblems(report) {
  let total = 0;
  if (report.sections.sbom.status !== 'ok') total += 1;
  if (report.sections.licenses.status !== 'ok') total += 1 + (report.sections.licenses.unknownLicense ?? []).length;
  if (report.sections.sca.status !== 'ok') total += 1 + (report.sections.sca.blocking ?? []).length;
  return total;
}

export async function main(argv = []) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  let options;
  try {
    options = parseSupplyArgs(argv, {
      booleans: ['no-osv', 'no-npm-audit', 'sbom-check', 'help'],
      values: ['lock', 'registry', 'osv-endpoint', 'output-dir'],
      usage: USAGE,
    });
  } catch (error) {
    console.error(`[supply:fail] ${errorMessage(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }
  const outputDir = path.resolve(projectRoot, typeof options['output-dir'] === 'string' ? options['output-dir'] : SUPPLY_OUTPUT_DIR);
  const resolved = resolveRegistry(projectRoot, process.env);

  let outcome;
  try {
    outcome = await runSupplyChecks({
      projectRoot,
      lockPath: path.resolve(projectRoot, typeof options.lock === 'string' ? options.lock : 'package-lock.json'),
      outputDir,
      registry: typeof options.registry === 'string' ? options.registry : resolved.registry,
      registrySource: typeof options.registry === 'string' ? '--registry 参数' : resolved.source,
      osvEndpoint: typeof options['osv-endpoint'] === 'string' ? options['osv-endpoint'] : undefined,
      allowOsv: options['no-osv'] !== true,
      allowNpmAudit: options['no-npm-audit'] !== true,
      sbomCheck: options['sbom-check'] === true,
    });
  } catch (error) {
    console.error(`[supply:fail] 供应链检查未完成:${errorMessage(error)}`);
    return 1;
  }
  for (const line of formatSupplyLog(outcome.report)) console.log(line);
  return outcome.status === 'ok' ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
