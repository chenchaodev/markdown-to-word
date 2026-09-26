// 按需收集生产依赖的许可证文件原文(不进每次 CI),产出 licenses-fulltext 目录 +
// licenses-fulltext.json 清单,exit 0/1。
//
// 为什么单独一条按需命令:
//   - 内联进 NOTICE.md 需要逐字校对,且会随依赖升级腐化(清单与真实授权文本脱节比
//     没有全文更危险);故 NOTICE 只列声明与义务摘要,全文按需现取。
//   - 全文收集结果与 lockfile 强相关,放进门禁只会多出一份需要同步维护的副本;
//     故只在发版 / 送审前手动跑一次,用完即弃(output/ 已被 gitignore)。
//
// 收集口径:
//   - 只收**生产依赖**(随包分发才有提供全文的义务;仅开发依赖不随包分发);
//   - 每个包目录内按既有识别层的同一份候选名规则(license/licence/copying/notice,
//     可带 .txt/.md/.rst,无扩展名)列出候选文件,按字节**逐字复制**到
//     `<输出目录>/licenses-fulltext/<包名>@<版本>/<原文件名>`,不改名、不改内容;
//   - 清单逐文件记录:来自哪个包、来源文件名、存储路径(相对输出目录)、sha256、字节数、
//     以及该文件的许可证识别结果(命中的标识 + 命中方式:SPDX 标签 / 正文特征 / 未识别);
//   - 取不到文件(包目录不存在 / 目录内没有许可证文件)必须显式记为 missing 并报出,
//     绝不静默跳过 —— 静默跳过会让「未随包提供全文」这件事在报告里消失。
//
// 确定性:不写时间戳,包按 name@version 排序、文件按既有候选排序,清单内只记相对路径;
// 同 lockfile + 同一已安装树必得逐字节相同的清单与副本。
//
// 退出码:
//   0 = 收集完成(缺失/未识别已在清单中显式记为 missing / copied-unrecognized 并报出)
//   1 = 收集过程失败(参数错、lockfile 读不了、写不了),或 --strict 下存在非 collected 的包
//
// 用法:
//   node scripts/supply/collect-license-fulltext.mjs [选项]
//       [--lock <file>] [--output-dir <dir>] [--decisions <file>]
//       [--strict] [--print] [--help]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LICENSE_FILE_EXTENSIONS,
  LICENSE_FILE_STEMS,
  LICENSE_FILE_STATUS,
  SCOPE_PRODUCTION,
  SUPPLY_OUTPUT_DIR,
  detectLicenseFromText,
  errorMessage,
  hashBuffer,
  isMainModule,
  listLicenseFiles,
  loadLicenseDecisions,
  lockComponents,
  parseSupplyArgs,
  readLockfile,
  resolveLicenseDecision,
  resolveObligationSummary,
  serializeJson,
  toPosix,
  writeJson,
} from './supply-common.mjs';
import { DEFAULT_DECISIONS_LABEL, DEFAULT_DECISIONS_PATH } from './gen-licenses.mjs';

/** 全文清单 schema 版本 */
export const FULLTEXT_SCHEMA = 'm2w/license-fulltext@1';

/** 产物文件名(落在 --output-dir 下) */
export const FULLTEXT_DIR_NAME = 'licenses-fulltext';
export const FULLTEXT_MANIFEST_FILE = 'licenses-fulltext.json';

/** 整体状态 */
export const FULLTEXT_STATUS_OK = 'ok';
/** 存在 missing / copied-unrecognized / 陈旧残留目录 */
export const FULLTEXT_STATUS_INCOMPLETE = 'incomplete';

/** 单包收集状态 */
export const PACKAGE_FULLTEXT_STATUS = Object.freeze({
  /** 复制到文件且每个文件都识别出了许可证 */
  collected: 'collected',
  /** 复制到文件,但至少一个文件的内容识别不出许可证(不猜,记 unrecognized) */
  copiedUnrecognized: 'copied-unrecognized',
  /** 取不到许可证文件(包目录不存在 / 目录内没有候选文件) */
  missing: 'missing',
});

/** 缺文件的原因码(与许可证识别层的取值对齐,便于对照排查) */
export const FULLTEXT_REASON = Object.freeze({
  noPackageDir: LICENSE_FILE_STATUS.noPackageDir,
  noLicenseFile: LICENSE_FILE_STATUS.noLicenseFile,
  unreadableFile: 'unreadable-file',
});

const USAGE = `用法: node scripts/supply/collect-license-fulltext.mjs [选项]
  --lock <file>        输入 lockfile(默认项目根的 package-lock.json)
  --output-dir <dir>   产物目录(默认 ${toPosix(SUPPLY_OUTPUT_DIR)})
  --decisions <file>   多选一分支决策清单(默认 ${DEFAULT_DECISIONS_LABEL};用于标注选定分支)
  --strict             存在非 collected 的生产依赖时判红(发版/送审前用)
  --print              把清单正文打到 stdout
  --help               显示本用法
产物:
  <output-dir>/${FULLTEXT_DIR_NAME}/<包名>@<版本>/<原文件名>   许可证文件原文(逐字复制)
  <output-dir>/${FULLTEXT_MANIFEST_FILE}                        逐文件来源、哈希与识别结果`;

/**
 * 全文清单里一个许可证文件的记录。
 * @typedef {object} FulltextFile
 * @property {string} sourceFile 源包目录内的文件名
 * @property {string} storedPath 副本路径(相对 --output-dir,POSIX)
 * @property {string} sha256 副本内容指纹
 * @property {number} bytes 字节数
 * @property {string | null} detectedLicense 识别出的许可证(认不出为 null)
 * @property {string | null} match 命中方式(SPDX-License-Identifier / text / null)
 * @property {boolean} recognized 是否识别成功
 */

/**
 * 全文清单里一个包的记录。
 * @typedef {object} FulltextPackage
 * @property {string} name 包名
 * @property {string} version 锁定版本
 * @property {string} lockPath lock 条目路径
 * @property {string | null} declaredLicense 上游原始声明(不因决策改写)
 * @property {string | null} effectiveLicense 决策选定的分支(无决策为 null)
 * @property {string | null} obligations 选定分支的义务摘要(无决策/未登记为 null)
 * @property {string} status PACKAGE_FULLTEXT_STATUS 取值
 * @property {string | null} reasonCode 缺文件原因码(状态非 missing 时为 null)
 * @property {string} reason 人读说明
 * @property {string[]} candidateFiles 包目录内找到的候选文件名(无则空数组)
 * @property {string[]} [unrecognizedNameFiles] 名字像许可证但扩展名不在候选内的文件(诊断用,无则省略)
 * @property {FulltextFile[]} files 逐文件记录
 */

/**
 * 全文清单文档(licenses-fulltext.json 的形状)。
 * @typedef {object} FulltextReport
 * @property {string} schema
 * @property {string} status ok / incomplete
 * @property {{ name: string; version: string; license: string | null }} project
 * @property {{ lockfile: string; lockfileSha256: string }} source
 * @property {{ scope: string; reason: string; decisions: string }} policy
 * @property {{ production: number; collected: number; copiedUnrecognized: number; missing: number; files: number; staleDirectories: number }} counts
 * @property {string[]} missing 缺许可证文件的生产依赖
 * @property {string[]} unrecognized 含未识别许可证文件的生产依赖
 * @property {string[]} stale 产物目录里已不在依赖树中的残留包目录
 * @property {FulltextPackage[]} packages 逐包明细
 */

/**
 * 包标识(与许可证清单/报告里其它地方一致:`name@version`)。
 * @param {string} name 包名
 * @param {string} version 版本
 * @returns {string} `name@version`
 */
function packageKey(name, version) {
  return `${name}@${version}`;
}

/**
 * 缺文件的人读说明。
 * @param {string} reasonCode 原因码
 * @param {string[]} candidates 包目录内找到的候选文件名
 * @returns {string} 说明
 */
function missingReasonText(reasonCode, candidates) {
  if (reasonCode === FULLTEXT_REASON.noPackageDir) return '已安装包目录不存在(未安装或被剪枝),取不到许可证文件原文';
  if (reasonCode === FULLTEXT_REASON.unreadableFile) {
    return `包目录内的许可证文件读不出来:${candidates.join('、')}`;
  }
  return '已安装包目录内没有许可证文件(候选名 license/licence/copying/notice,大小写不敏感,可带 .txt/.md/.rst)';
}

/**
 * 「像许可证但扩展名不在候选之列」的文件名(纯诊断用,不改候选名规则)。
 *
 * 为什么需要这一层:候选名规则只认无扩展名与 .txt/.md/.rst,而真实包存在
 * `LICENSE.markdown` 这类写法。这类文件在候选规则下等同「没有许可证文件」,
 * 只报 missing 会让人误判成「上游没随包发许可」,而真实情况是「发了但命名不在规则内」。
 * 刻意**只报不改**:放宽候选名会连带改变许可证识别层的判定口径(哪些包算「已声明」),
 * 那是另一件事,不该由本脚本顺手改掉。
 * @param {string} packageDir 源包目录
 * @returns {string[]} 文件名(升序)
 */
function listLicenseNamedFiles(packageDir) {
  let entries;
  try {
    entries = readdirSync(packageDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const stemSet = new Set(LICENSE_FILE_STEMS);
  return entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => {
      const dot = name.indexOf('.', 1);
      const stem = (dot === -1 ? name : name.slice(0, dot)).toLowerCase();
      if (!stemSet.has(stem)) return false;
      const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
      return !LICENSE_FILE_EXTENSIONS.includes(ext);
    })
    .sort();
}

/**
 * 收集单个包:按字节逐字复制候选许可证文件,并逐文件记录来源与识别结果。
 *
 * 写副本用 writeFileSync(原始字节):一旦经过字符串往返,BOM/换行/编码会被改写,
 * 副本就不再是上游原文 —— 那样的副本不能用来履行「附上许可全文」的义务。
 * @param {string} packageDir 源包目录
 * @param {string} outputDir 输出目录
 * @param {string} key 包标识(目录名)
 * @returns {{ status: string; reasonCode: string | null; reason: string; candidateFiles: string[]; unrecognizedNameFiles: string[]; files: FulltextFile[] }} 收集结果
 */
function collectPackageFiles(packageDir, outputDir, key) {
  if (!existsSync(packageDir)) {
    return {
      status: PACKAGE_FULLTEXT_STATUS.missing,
      reasonCode: FULLTEXT_REASON.noPackageDir,
      reason: missingReasonText(FULLTEXT_REASON.noPackageDir, []),
      candidateFiles: [],
      unrecognizedNameFiles: [],
      files: [],
    };
  }
  const candidateFiles = listLicenseFiles(packageDir);
  if (candidateFiles.length === 0) {
    return {
      status: PACKAGE_FULLTEXT_STATUS.missing,
      reasonCode: FULLTEXT_REASON.noLicenseFile,
      reason: missingReasonText(FULLTEXT_REASON.noLicenseFile, []),
      candidateFiles: [],
      unrecognizedNameFiles: listLicenseNamedFiles(packageDir),
      files: [],
    };
  }
  const targetDir = path.join(outputDir, FULLTEXT_DIR_NAME, key);
  /** @type {FulltextFile[]} */
  const files = [];
  /** @type {string[]} */
  const unreadable = [];
  for (const file of candidateFiles) {
    let buffer;
    try {
      buffer = readFileSync(path.join(packageDir, file));
    } catch {
      unreadable.push(file);
      continue;
    }
    const target = path.join(targetDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    const detected = detectLicenseFromText(buffer.toString('utf8'));
    files.push({
      sourceFile: file,
      storedPath: toPosix(path.relative(outputDir, target)),
      sha256: hashBuffer(buffer),
      bytes: buffer.byteLength,
      detectedLicense: detected.license,
      match: detected.license === null ? null : detected.match,
      recognized: detected.license !== null,
    });
  }
  if (files.length === 0) {
    return {
      status: PACKAGE_FULLTEXT_STATUS.missing,
      reasonCode: FULLTEXT_REASON.unreadableFile,
      reason: missingReasonText(FULLTEXT_REASON.unreadableFile, candidateFiles),
      candidateFiles,
      unrecognizedNameFiles: [],
      files: [],
    };
  }
  const allRecognized = files.every((file) => file.recognized);
  return {
    status: allRecognized ? PACKAGE_FULLTEXT_STATUS.collected : PACKAGE_FULLTEXT_STATUS.copiedUnrecognized,
    reasonCode: null,
    reason: allRecognized
      ? `已逐字复制 ${files.length} 个许可证文件,全部识别出许可证`
      : `已逐字复制 ${files.length} 个许可证文件,但有文件内容识别不出许可证(不猜测,需人工确认)`,
    candidateFiles,
    unrecognizedNameFiles: [],
    files,
  };
}

/**
 * 列出产物目录里已存在的包目录(用于报出陈旧残留)。
 *
 * 目录名直接用 `name@version`,所以 scoped 包(形如 `@scope/pkg@1.0.0`)天然多一层:
 * 只看顶层会把 `@scope` 容器目录误报成残留包目录。故按「以 @ 开头且其后不再含 @」
 * 判定 scope 容器并下探一层,其余目录即包目录。
 * @param {string} fulltextDir 产物目录
 * @returns {string[]} 包目录名(相对产物目录,POSIX,升序)
 */
function listStoredPackageDirs(fulltextDir) {
  if (!existsSync(fulltextDir)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(fulltextDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@') && !entry.name.slice(1).includes('@')) {
      for (const nested of listStoredPackageDirs(path.join(fulltextDir, entry.name))) found.push(`${entry.name}/${nested}`);
      continue;
    }
    found.push(entry.name);
  }
  return found.sort();
}

/**
 * 收集生产依赖的许可证全文并落盘(读已安装包目录 → 写副本 → 出清单)。
 * @param {{ lockPath: string; lockLabel: string; outputDir: string; decisionsPath?: string | null; decisions?: import('./supply-common.mjs').LicenseDecisionIndex | null; decisionsLabel?: string | null }} options 输入
 * @returns {FulltextReport} 全文清单
 */
export function collectLicenseFulltext({ lockPath, lockLabel, outputDir, decisionsPath, decisions, decisionsLabel = null }) {
  const lock = readLockfile(lockPath);
  const lockDigest = hashBuffer(readFileSync(lockPath));
  const packagesRoot = path.dirname(path.resolve(lockPath));
  const index =
    decisions !== undefined
      ? decisions
      : decisionsPath === null
        ? null
        : loadLicenseDecisions(decisionsPath ?? DEFAULT_DECISIONS_PATH, decisionsLabel ?? DEFAULT_DECISIONS_LABEL);
  const { root, components } = lockComponents(lock);

  const production = components
    .filter((component) => component.dependencyScope === SCOPE_PRODUCTION)
    .sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0) : a.name < b.name ? -1 : 1));

  const packages = production.map((component) => {
    const outcome = resolveLicenseDecision(
      {
        name: component.name,
        version: component.version,
        upstreamExpression: component.license,
        isProduction: component.dependencyScope === SCOPE_PRODUCTION,
      },
      index,
    );
    const key = packageKey(component.name, component.version);
    const collected = collectPackageFiles(path.resolve(packagesRoot, component.lockPath), outputDir, key);
    const obligations = outcome.selectedBranch === null ? null : resolveObligationSummary(outcome.selectedBranch);
    return {
      name: component.name,
      version: component.version,
      lockPath: component.lockPath,
      declaredLicense: component.license,
      effectiveLicense: outcome.selectedBranch,
      obligations,
      status: collected.status,
      reasonCode: collected.reasonCode,
      reason: collected.reason,
      candidateFiles: collected.candidateFiles,
      ...(collected.unrecognizedNameFiles.length === 0 ? {} : { unrecognizedNameFiles: collected.unrecognizedNameFiles }),
      files: collected.files,
    };
  });

  const stored = new Set(packages.map((item) => packageKey(item.name, item.version)));
  const stale = listStoredPackageDirs(path.join(outputDir, FULLTEXT_DIR_NAME)).filter((dir) => !stored.has(dir));
  const missing = packages.filter((item) => item.status === PACKAGE_FULLTEXT_STATUS.missing).map((item) => packageKey(item.name, item.version));
  const unrecognized = packages
    .filter((item) => item.status === PACKAGE_FULLTEXT_STATUS.copiedUnrecognized)
    .map((item) => packageKey(item.name, item.version));
  const collectedCount = packages.filter((item) => item.status === PACKAGE_FULLTEXT_STATUS.collected).length;
  const incomplete = missing.length > 0 || unrecognized.length > 0 || stale.length > 0;

  return {
    schema: FULLTEXT_SCHEMA,
    status: incomplete ? FULLTEXT_STATUS_INCOMPLETE : FULLTEXT_STATUS_OK,
    project: {
      name: typeof root.name === 'string' ? root.name : 'unknown',
      version: typeof root.version === 'string' ? root.version : '0.0.0',
      license: typeof root.license === 'string' ? root.license : null,
    },
    source: { lockfile: lockLabel, lockfileSha256: lockDigest },
    policy: {
      scope: SCOPE_PRODUCTION,
      reason: '只收生产依赖:仅开发依赖不随包分发,没有提供许可证全文的分发义务',
      decisions: index === null ? '(未提供决策清单)' : (index.source ?? DEFAULT_DECISIONS_LABEL),
    },
    counts: {
      production: packages.length,
      collected: collectedCount,
      copiedUnrecognized: unrecognized.length,
      missing: missing.length,
      files: packages.reduce((total, item) => total + item.files.length, 0),
      staleDirectories: stale.length,
    },
    missing,
    unrecognized,
    stale,
    packages,
  };
}

/**
 * 渲染人读日志(missing / 未识别 / 残留必须逐条报出,不静默跳过)。
 * @param {FulltextReport} report collectLicenseFulltext 的结果
 * @returns {string[]} 日志行
 */
export function formatFulltextLog(report) {
  const lines = [];
  lines.push(
    `[ok] 许可证全文已收集:${toPosix(path.join(SUPPLY_OUTPUT_DIR, FULLTEXT_DIR_NAME))} + ` +
      `${toPosix(path.join(SUPPLY_OUTPUT_DIR, FULLTEXT_MANIFEST_FILE))}(生产依赖 ${report.counts.production}:` +
      `已收齐 ${report.counts.collected};已复制但未识别 ${report.counts.copiedUnrecognized};` +
      `缺许可证文件 ${report.counts.missing};共 ${report.counts.files} 个文件)`,
  );
  for (const item of report.packages) {
    if (item.status !== PACKAGE_FULLTEXT_STATUS.missing) continue;
    const detail = item.files.length === 0 ? item.reason : `${item.reason};找到的文件:${item.candidateFiles.join('、')}`;
    lines.push(`[fulltext:missing] ${item.name}@${item.version} — ${item.reasonCode}:${detail}`);
    // 名字像许可证但扩展名不在候选内的文件:报出来以免被误读成「上游没随包发许可」
    if (item.unrecognizedNameFiles !== undefined && item.unrecognizedNameFiles.length > 0) {
      lines.push(
        `[fulltext:warn] ${item.name}@${item.version} 包目录内存在名字像许可证但扩展名不在候选内的文件:` +
          `${item.unrecognizedNameFiles.join('、')}(候选名规则未放宽,需人工取该文件原文)`,
      );
    }
  }
  for (const key of report.unrecognized) {
    lines.push(`[fulltext:warn] 许可证文件已复制但内容识别不出许可证(不猜测,需人工确认):${key}`);
  }
  for (const dir of report.stale) {
    lines.push(`[fulltext:warn] 产物目录里存在已不在依赖树中的残留包目录(依赖下线后不会自动清理,需人工删除):${dir}`);
  }
  lines.push(
    report.status === FULLTEXT_STATUS_OK
      ? '[ok] 全部生产依赖的许可证文件原文均已收齐并识别'
      : `[fulltext:warn] 全文收集不完整(缺 ${report.counts.missing} / 未识别 ${report.counts.copiedUnrecognized} / 残留 ${report.counts.staleDirectories});` +
        '未随包提供全文的组件同样构成分发不合规,发版前需逐项处理',
  );
  return lines;
}

export async function main(argv = []) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  let options;
  try {
    options = parseSupplyArgs(argv, {
      booleans: ['strict', 'print', 'help'],
      values: ['lock', 'output-dir', 'decisions'],
      usage: USAGE,
    });
  } catch (error) {
    console.error(`[fulltext:fail] ${errorMessage(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }

  const lockPath = path.resolve(projectRoot, typeof options.lock === 'string' ? options.lock : 'package-lock.json');
  const outputDir = path.resolve(projectRoot, typeof options['output-dir'] === 'string' ? options['output-dir'] : SUPPLY_OUTPUT_DIR);
  const lockLabel = toPosix(path.relative(projectRoot, lockPath)) || 'package-lock.json';
  const decisionsPath = typeof options.decisions === 'string' ? path.resolve(projectRoot, options.decisions) : DEFAULT_DECISIONS_PATH;
  // 产物里只记相对标识:绝对路径会随机器不同而变,破坏「同输入逐字节一致」
  const decisionsLabel = typeof options.decisions === 'string' ? toPosix(options.decisions) : DEFAULT_DECISIONS_LABEL;

  let report;
  try {
    report = collectLicenseFulltext({ lockPath, lockLabel, outputDir, decisionsPath, decisionsLabel });
  } catch (error) {
    console.error(`[fulltext:fail] 许可证全文收集未完成:${errorMessage(error)}`);
    return 1;
  }

  writeJson(path.join(outputDir, FULLTEXT_MANIFEST_FILE), report);
  if (options.print === true) process.stdout.write(serializeJson(report));
  for (const line of formatFulltextLog(report)) console.log(line);

  if (options.strict === true && report.status !== FULLTEXT_STATUS_OK) {
    console.error(
      `[fulltext:fail] --strict:存在 ${report.counts.missing} 个缺许可证文件、${report.counts.copiedUnrecognized} 个内容未识别的生产依赖` +
        `${report.counts.staleDirectories > 0 ? `,以及 ${report.counts.staleDirectories} 个残留包目录` : ''};判红`,
    );
    return 1;
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
