// 第三方许可证/NOTICE 清单:扫描 lockfile 依赖树产出 licenses.json + NOTICE.md,exit 0/1。
//
// 许可证取值两级回落(每级都记录来源与证据,便于人工复核):
//   1. lockfile/package.json 的 license 字段(来源 lockfile);
//   2. 字段缺失时,到已安装包目录内大小写不敏感地找许可证文件(候选
//      license/licence/copying/notice,可带 .txt/.md/.rst,无扩展名),读文首做
//      标记匹配;命中则来源记 package-file 并附证据文件名。
// 依据只有文件内可验证的声明(SPDX 标签行或许可证特征标记):两处都没有可用依据时
// 仍判 unknown 并**判红** —— 「元数据缺失」不等于「许可证未知」,反过来「文件像
// 某个许可证」也不等于「就是那个许可证」,不得替上游伪造声明,也不得用 allowlist
// 静默放行。
//
// 判定口径(与 SBOM 共用 supply-common 的同一份分类):
//   - 宽松许可(MIT/ISC/BSD/Apache-2.0…)归 permissive,无需人工动作;
//   - 弱/强 copyleft(LGPL/MPL/CDDL/GPL/AGPL…)与多选一表达式(含 OR)一律进
//     needsReview 清单并在 NOTICE 中单列分组,供人工复核分发义务;
//   - 无声明/缺失许可证单列 unknownLicense 并**判红**:「没写许可证」不等于
//     「可以随便用」,静默当 OK 会把一个无授权的包直接带进 GPL 分发包里。
//
// 输出确定性:条目按 name@version 排序、对象键按固定顺序构造,同 lockfile + 同一已安装
// 树必得逐字节相同的 licenses.json 与 NOTICE.md(报告内只记相对路径与文件名,不记
// 绝对路径与时间戳)。
//
// 用法:
//   node scripts/supply/gen-licenses.mjs [--lock <file>] [--output-dir <dir>] [--print]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LICENSE_FILE_STATUS,
  LICENSE_GROUPS,
  LICENSE_GROUP_TITLES,
  LICENSE_SOURCE_LOCKFILE,
  LICENSE_SOURCE_NONE,
  LICENSE_SOURCE_PACKAGE_FILE,
  NOASSERTION,
  SCOPE_PRODUCTION,
  SUPPLY_OUTPUT_DIR,
  classifyLicense,
  detectPackageLicense,
  errorMessage,
  hashBuffer,
  isMainModule,
  lockComponents,
  parseSupplyArgs,
  readLockfile,
  serializeJson,
  toPosix,
  writeJson,
  writeFileAtomic,
} from './supply-common.mjs';

/** 许可证报告 schema 版本 */
export const LICENSES_SCHEMA = 'm2w/licenses@1';

/** 默认输出文件名(落在 --output-dir 下) */
export const DEFAULT_LICENSES_FILE = 'licenses.json';
export const DEFAULT_NOTICE_FILE = 'NOTICE.md';

/** 报告状态:ok=无阻断项;policy-violation=存在未知/缺失许可证(判红) */
export const STATUS_OK = 'ok';
export const STATUS_POLICY_VIOLATION = 'policy-violation';

/**
 * 许可证清单里的一条组件记录。
 * @typedef {object} LicenseEntry
 * @property {string} name 包名
 * @property {string} version 锁定版本
 * @property {string | null} license 许可证标识(两处都无可用依据时为 null)
 * @property {string} licenseSource 取值来源(lockfile / package-file / none)
 * @property {string} [licenseEvidence] 证据文件名(仅 package-file 来源有)
 * @property {string} licenseGroup 所属分组
 * @property {'production' | 'development'} dependencyScope 依赖范围
 * @property {boolean} isProductionDependency 是否生产依赖
 * @property {boolean} optional 是否可选依赖
 * @property {boolean} direct 是否直接依赖
 * @property {boolean} needsReview 是否需人工复核
 * @property {string} lockPath lock 条目路径
 */

/**
 * 无声明许可证的诊断条目。
 * @typedef {object} UnknownLicenseEntry
 * @property {string} name 包名
 * @property {string} version 锁定版本
 * @property {'production' | 'development'} dependencyScope 依赖范围
 * @property {boolean} isProductionDependency 是否生产依赖
 * @property {string} reasonCode 机器可读的判定原因码
 * @property {string[]} licenseFiles 包目录内找到的许可证候选文件(无则空数组)
 * @property {string} reason 判定原因
 */

/**
 * 许可证报告(licenses.json 的文档形状)。
 * @typedef {object} LicensesReport
 * @property {string} schema
 * @property {string} status ok / policy-violation
 * @property {{ name: string; version: string; license: string | null }} project
 * @property {{ lockfile: string; lockfileSha256: string }} source
 * @property {{ total: number; production: number; development: number; needsReview: number; unknownLicense: number; fromPackageFile: number }} counts
 * @property {Record<string, string[]>} groups 分组 → `name@version` 列表
 * @property {string[]} needsReview 待人工复核项
 * @property {UnknownLicenseEntry[]} unknownLicense 无声明许可证项
 * @property {LicenseEntry[]} packages 逐组件明细
 */

const USAGE = `用法: node scripts/supply/gen-licenses.mjs [选项]
  --lock <file>        输入 lockfile(默认项目根的 package-lock.json)
  --output-dir <dir>   产物目录(默认 ${toPosix(SUPPLY_OUTPUT_DIR)})
  --print              把 licenses.json 正文打到 stdout
  --help               显示本用法`;

/** 未知许可证的原因码:无字段 + 包目录不存在 */
export const UNKNOWN_REASON_NO_PACKAGE_DIR = LICENSE_FILE_STATUS.noPackageDir;
/** 未知许可证的原因码:无字段 + 无许可证文件 */
export const UNKNOWN_REASON_NO_LICENSE_FILE = LICENSE_FILE_STATUS.noLicenseFile;
/** 未知许可证的原因码:无字段 + 有许可证文件但内容认不出 */
export const UNKNOWN_REASON_UNRECOGNIZED_FILE = LICENSE_FILE_STATUS.unrecognized;
/** 未知许可证的原因码:调用方未提供安装树(纯 lockfile 口径),根本没核对随包文件 */
export const UNKNOWN_REASON_NO_LOOKUP = 'no-lookup';

/** 判定原因文案:把「为什么判不出来」说清(含下一步动作),供报告与 CLI 直接展示 */
const UNKNOWN_REASON_TEXT = Object.freeze({
  [UNKNOWN_REASON_NO_LOOKUP]: 'lockfile 条目无 license 字段;本次未提供安装树,未核对随包分发的许可证文件',
  [UNKNOWN_REASON_NO_PACKAGE_DIR]:
    'lockfile 条目无 license 字段;已安装包目录不存在(未安装或被剪枝),无法核对随包分发的许可证文件',
  [UNKNOWN_REASON_NO_LICENSE_FILE]:
    'lockfile 条目无 license 字段;已安装包目录内没有许可证文件(候选名 license/licence/copying/notice,大小写不敏感,可带 .txt/.md/.rst)',
  [UNKNOWN_REASON_UNRECOGNIZED_FILE]:
    'lockfile 条目无 license 字段;已找到许可证文件但其内容无法匹配任何已知许可证标记(不做猜测),需人工确认上游许可证',
});

/**
 * 未知项的原因文案:unrecognized 一档要带上找到的文件名,便于人工直接去翻那个文件。
 * @param {string} reasonCode 原因码
 * @param {string[]} files 包目录内找到的候选文件
 * @returns {string} 原因文案
 */
function unknownReasonText(reasonCode, files) {
  const base = UNKNOWN_REASON_TEXT[reasonCode] ?? UNKNOWN_REASON_TEXT[UNKNOWN_REASON_NO_LICENSE_FILE];
  return files.length === 0 ? base : `${base};找到的文件:${files.join('、')}`;
}

/**
 * 组件的许可证取值:lockfile 字段优先,缺失时回落已安装包目录内的许可证文件。
 *
 * 只在传了 packagesRoot 时才读文件系统(不传即纯 lockfile 口径),这样同一函数既能
 * 做纯函数测试,也能在真实安装树上做第二级回落。
 * @param {object} component lockComponents 的组件
 * @param {string | null} packagesRoot node_modules 所在目录(null = 不读文件系统)
 * @param {(packageDir: string) => ReturnType<typeof detectPackageLicense>} detectLicense 识别器(便于注入)
 * @returns {{ license: string | null; source: string; evidence: string | null; reasonCode: string | null; files: string[] }}
 */
function resolveComponentLicense(component, packagesRoot, detectLicense) {
  if (component.license !== null) {
    return { license: component.license, source: LICENSE_SOURCE_LOCKFILE, evidence: null, reasonCode: null, files: [] };
  }
  if (packagesRoot === null) {
    return { license: null, source: LICENSE_SOURCE_NONE, evidence: null, reasonCode: UNKNOWN_REASON_NO_LOOKUP, files: [] };
  }
  const detected = detectLicense(path.resolve(packagesRoot, component.lockPath));
  if (detected.status === LICENSE_FILE_STATUS.detected && detected.license !== null) {
    return { license: detected.license, source: LICENSE_SOURCE_PACKAGE_FILE, evidence: detected.evidence, reasonCode: null, files: detected.files };
  }
  return { license: null, source: LICENSE_SOURCE_NONE, evidence: null, reasonCode: detected.status, files: detected.files };
}

/**
 * 构建许可证报告(packagesRoot 为空时是纯函数:只读 lockfile 字段)。
 * @param {{ lock: object; lockDigest: string; lockLabel: string; packagesRoot?: string | null; detectLicense?: (packageDir: string) => ReturnType<typeof detectPackageLicense> }} input 输入
 * @returns {LicensesReport}
 */
export function buildLicensesReport({ lock, lockDigest, lockLabel, packagesRoot = null, detectLicense = detectPackageLicense }) {
  const { root, components } = lockComponents(lock);
  /** @type {Map<string, ReturnType<typeof resolveComponentLicense>>} */
  const resolutions = new Map();
  const packages = components
    .map((component) => {
      const resolved = resolveComponentLicense(component, packagesRoot, detectLicense);
      resolutions.set(component.lockPath, resolved);
      const classified = classifyLicense(resolved.license);
      const entry = {
        name: component.name,
        version: component.version,
        license: resolved.license,
        licenseSource: resolved.source,
        ...(resolved.evidence === null ? {} : { licenseEvidence: resolved.evidence }),
        licenseGroup: classified.group,
        dependencyScope: component.dependencyScope,
        isProductionDependency: component.dependencyScope === SCOPE_PRODUCTION,
        optional: component.optional,
        direct: component.direct,
        needsReview: classified.needsReview,
        lockPath: component.lockPath,
      };
      return entry;
    })
    .sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0) : a.name < b.name ? -1 : 1));

  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const group of LICENSE_GROUPS) groups[group] = [];
  for (const entry of packages) groups[entry.licenseGroup].push(`${entry.name}@${entry.version}`);

  const needsReview = packages
    .filter((entry) => entry.needsReview && entry.licenseGroup !== 'unknown')
    .map((entry) => `${entry.name}@${entry.version} (${entry.license},${LICENSE_GROUP_TITLES[entry.licenseGroup]})`);
  const unknownLicense = packages
    .filter((entry) => entry.licenseGroup === 'unknown')
    .map((entry) => {
      const resolved = resolutions.get(entry.lockPath) ?? { reasonCode: null, files: [] };
      const reasonCode = resolved.reasonCode ?? UNKNOWN_REASON_NO_LICENSE_FILE;
      return {
        name: entry.name,
        version: entry.version,
        dependencyScope: entry.dependencyScope,
        isProductionDependency: entry.isProductionDependency,
        reasonCode,
        licenseFiles: resolved.files,
        reason: unknownReasonText(reasonCode, resolved.files),
      };
    });

  const production = packages.filter((entry) => entry.isProductionDependency);
  return {
    schema: LICENSES_SCHEMA,
    status: unknownLicense.length > 0 ? STATUS_POLICY_VIOLATION : STATUS_OK,
    project: {
      name: typeof root.name === 'string' ? root.name : 'unknown',
      version: typeof root.version === 'string' ? root.version : '0.0.0',
      license: typeof root.license === 'string' ? root.license : null,
    },
    source: { lockfile: lockLabel, lockfileSha256: lockDigest },
    counts: {
      total: packages.length,
      production: production.length,
      development: packages.length - production.length,
      needsReview: needsReview.length,
      unknownLicense: unknownLicense.length,
      fromPackageFile: packages.filter((entry) => entry.licenseSource === LICENSE_SOURCE_PACKAGE_FILE).length,
    },
    groups,
    needsReview,
    unknownLicense,
    packages,
  };
}

/**
 * 渲染 NOTICE.md:按许可证分组列出三方组件与义务提示,人工复核项单列成节。
 *
 * 只列声明与义务摘要,不内联各许可证全文 —— 内联全文需要逐字校对且会随依赖升级
 * 腐化;正式分发所需的许可证全文副本由发版流程另行收集(见文末提示)。
 * @param {LicensesReport} report buildLicensesReport 的结果
 * @returns {string} NOTICE.md 正文
 */
export function renderNotice(report) {
  const byKey = new Map(report.packages.map((entry) => [`${entry.name}@${entry.version}`, entry]));
  const lines = [];
  lines.push('# 第三方组件声明(NOTICE)');
  lines.push('');
  lines.push(`- 本文件由 \`scripts/supply/gen-licenses.mjs\` 依据 \`${report.source.lockfile}\` 自动生成,请勿手工编辑;`);
  lines.push('  依赖变更后重新生成并随同提交。');
  lines.push(`- 项目本体许可证:${report.project.license ?? '未声明'};随包分发的第三方组件共 ${report.counts.total} 个`);
  lines.push(`  (生产依赖 ${report.counts.production} / 仅开发依赖 ${report.counts.development})。`);
  lines.push('- 「生产依赖」= 会进入发布包的运行时依赖;「仅开发依赖」= 只在构建与测试链路使用,不随包分发。');
  lines.push('- 「许可证」取值两级回落:先取 lockfile 的 license 字段;上游未写该字段时,取已安装包目录内');
  lines.push('  随包分发的许可证文件(此时条目后标注证据文件名,便于人工复核原文);两处都没有可用依据才记未知。');
  lines.push('');
  for (const group of LICENSE_GROUPS) {
    const entries = report.groups[group];
    if (entries.length === 0) continue;
    lines.push(`## ${LICENSE_GROUP_TITLES[group]}(${entries.length})`);
    lines.push('');
    if (group === 'unknown') {
      lines.push('下列组件既无 lockfile 的 license 字段、也无可识别的随包许可证文件(或文件内容无法识别),分发性未获授权,');
      lines.push('需人工确认上游许可证后处理;在确认之前不得随发布包分发。');
      lines.push('');
    }
    for (const key of entries) {
      const entry = byKey.get(key);
      const license = entry.license ?? `未声明(${NOASSERTION})`;
      const scope = entry.isProductionDependency ? '生产依赖' : '仅开发依赖';
      const optional = entry.optional ? ',可选依赖' : '';
      const direct = entry.direct ? ',直接依赖' : ',传递依赖';
      const evidence = entry.licenseSource === LICENSE_SOURCE_PACKAGE_FILE ? `,许可证取自包内文件 ${entry.licenseEvidence}` : '';
      lines.push(`- **${key}** — 许可证:${license};${scope}${optional}${direct}${evidence}`);
    }
    lines.push('');
  }
  if (report.needsReview.length > 0) {
    lines.push(`## 需人工复核的许可证(${report.needsReview.length})`);
    lines.push('');
    lines.push('以下组件的许可证带有附加义务(copyleft 或多分支可选),分发前需人工确认合规方式:');
    lines.push('');
    for (const item of report.needsReview) lines.push(`- ${item}`);
    lines.push('');
  }
  lines.push('## 许可证全文');
  lines.push('');
  lines.push('本清单只列声明与义务摘要,不内联各许可证全文。正式分发所需的许可证全文副本需在发版时');
  lines.push('按上表逐项收集并随安装包提供 —— 未随包提供全文的 copyleft 组件同样构成不合规。');
  lines.push('');
  return `${lines.join('\n')}`;
}

/**
 * 从 lockfile 生成报告与 NOTICE(供 CLI 与测试复用)。
 *
 * 安装树根目录取 lockfile 所在目录:node_modules 与 lockfile 同级,故 lock 条目路径
 * (`node_modules/a/node_modules/b`)直接拼在它下面就是包目录。
 * @param {string} lockPath lockfile 路径
 * @param {string} lockLabel 报告里记录的输入标识
 * @param {{ detectLicense?: (packageDir: string) => ReturnType<typeof detectPackageLicense> }} [options] 可注入识别器
 * @returns {{ report: LicensesReport; notice: string }}
 */
export function generateLicenses(lockPath, lockLabel, options = {}) {
  // 先 readLockfile:它对「文件不存在」给的是带修复建议的文案,直接 readFileSync 只会抛裸 ENOENT
  const lock = readLockfile(lockPath);
  const text = readFileSync(lockPath, 'utf8');
  const report = buildLicensesReport({
    lock,
    lockDigest: hashBuffer(Buffer.from(text, 'utf8')),
    lockLabel,
    packagesRoot: path.dirname(path.resolve(lockPath)),
    ...(options.detectLicense === undefined ? {} : { detectLicense: options.detectLicense }),
  });
  return { report, notice: renderNotice(report) };
}

export async function main(argv = []) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  let options;
  try {
    options = parseSupplyArgs(argv, { booleans: ['print', 'help'], values: ['lock', 'output-dir'], usage: USAGE });
  } catch (error) {
    console.error(`[licenses:fail] ${errorMessage(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }

  const lockPath = path.resolve(projectRoot, typeof options.lock === 'string' ? options.lock : 'package-lock.json');
  const outputDir = path.resolve(projectRoot, typeof options['output-dir'] === 'string' ? options['output-dir'] : SUPPLY_OUTPUT_DIR);
  const lockLabel = toPosix(path.relative(projectRoot, lockPath)) || 'package-lock.json';

  let report;
  let notice;
  try {
    ({ report, notice } = generateLicenses(lockPath, lockLabel));
  } catch (error) {
    console.error(`[licenses:fail] 无法读取 lockfile:${errorMessage(error)}`);
    return 1;
  }

  const licensesPath = path.join(outputDir, DEFAULT_LICENSES_FILE);
  const noticePath = path.join(outputDir, DEFAULT_NOTICE_FILE);
  writeJson(licensesPath, report);
  writeFileAtomic(noticePath, notice);
  if (options.print === true) process.stdout.write(serializeJson(report));
  console.log(
    `[ok] 许可证清单已生成:${toPosix(path.relative(projectRoot, licensesPath))} + ` +
      `${toPosix(path.relative(projectRoot, noticePath))}(${report.counts.total} 个组件:` +
      `生产 ${report.counts.production} / 开发 ${report.counts.development};` +
      `需人工复核 ${report.counts.needsReview};取自包内许可证文件 ${report.counts.fromPackageFile};` +
      `未知/缺失 ${report.counts.unknownLicense})`,
  );

  if (report.status !== STATUS_OK) {
    for (const entry of report.unknownLicense) {
      console.error(
        `[licenses:fail] 许可证缺失:${entry.name}@${entry.version}(${entry.dependencyScope === SCOPE_PRODUCTION ? '生产依赖' : '仅开发依赖'})` +
          ` — ${entry.reason};需人工确认上游许可证,不得当作无许可风险放行`,
      );
    }
    console.error(
      `[licenses:fail] 存在 ${report.counts.unknownLicense} 个无许可证声明的三方组件,判红;` +
        '确认上游许可证后,在上游声明或本仓库允许清单中给出依据再放行',
    );
    return 1;
  }
  if (report.needsReview.length > 0) {
    console.log(
      `[warn] ${report.needsReview.length} 个组件带 copyleft/多分支许可,已单列待人工复核:` +
        `${report.needsReview.slice(0, 5).join(';')}${report.needsReview.length > 5 ? ' …' : ''}`,
    );
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
