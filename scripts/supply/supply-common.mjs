// 供应链检查的共享原语单源:npm 镜像口径解析、lockfile 组件模型、依赖边解析、
// 许可证分类与随包许可证文件识别、严重度换算、CLI 参数与落盘约定。
//
// 为什么单独一层:SBOM、许可证清单、SCA 三者对「什么是组件 / 什么是生产依赖 /
// 哪些许可证需要人工复核 / 产物放哪」的判定必须完全一致。阈值、分类与路径一旦
// 各脚本复制一份,就会出现「SBOM 说 232 个生产组件、许可证清单说 231 个」这种
// 无法从产物反查的漂移,故集中在此,各脚本 import 消费。
//
// 复用既有单源:文件哈希/原子写/主模块判定取自 scripts/check-dist-manifest.mjs,
// 子进程执行取自 scripts/print-env-fingerprint.mjs(含超时与 Windows .cmd 处理),
// 不再另造一份。

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { hashBuffer, isMainModule, toPosix, writeFileAtomic } from '../check-dist-manifest.mjs';
import { runCommand } from '../print-env-fingerprint.mjs';

export { hashBuffer, isMainModule, runCommand, toPosix, writeFileAtomic };

/** 供应链产物目录(相对项目根;output/ 已被 gitignore,产物不入仓) */
export const SUPPLY_OUTPUT_DIR = path.join('output', 'artifacts', 'supply');

/**
 * 依赖树中的一个组件(lockfile 条目 → 供应链口径的组件)。
 * @typedef {object} SupplyComponent
 * @property {string} lockPath lock 条目路径(POSIX)
 * @property {string} name 包名
 * @property {string} version 锁定版本
 * @property {'production' | 'development'} dependencyScope 依赖范围
 * @property {boolean} optional 是否可选依赖
 * @property {boolean} direct 是否根包直接依赖
 * @property {string | null} license lockfile 里的 license 字段(无声明为 null)
 * @property {string} licenseSource 许可证来源(lockfile / none;本层只读 lockfile,随包文件回落由许可证清单层补)
 * @property {string[]} declaredDependencies 声明的 dependencies
 * @property {string[]} optionalDependencies 声明的 optionalDependencies
 * @property {string[]} peerDependencies 声明的 peerDependencies
 */

/**
 * 许可证分类结果。
 * @typedef {object} LicenseClassification
 * @property {string} group 分组(permissive/weakCopyleft/strongCopyleft/dualChoice/other/unknown)
 * @property {string} raw license 字段原文
 * @property {boolean} isCopyleft 是否含 copyleft 分支
 * @property {boolean} isDualChoice 是否含 OR 多选一分支
 * @property {boolean} needsReview 是否需人工复核
 */

/**
 * npm 子进程执行结果(与 scripts/print-env-fingerprint.mjs 的 runCommand 同一形状)。
 * @typedef {object} CommandResult
 * @property {boolean} ok
 * @property {number | null} exitCode
 * @property {string | null} [signal]
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {number} timeoutMs
 * @property {string | null} spawnError
 */

/** 依赖树范围:生产树与含 dev 的全树。两棵树分开记录,不可合并成一个数字 */
export const SCOPE_PRODUCTION = 'production';
export const SCOPE_DEVELOPMENT = 'development';

/** 严重度序(判定「按 production 优先」与汇总排序共用) */
export const SEVERITY_ORDER = Object.freeze(['none', 'info', 'low', 'moderate', 'high', 'critical']);

/** 会阻断发布(CI/Release 判红)的严重度下限 */
export const BLOCKING_SEVERITIES = Object.freeze(['high', 'critical']);

/** 许可证分组;group 决定 NOTICE 的分段与是否需人工复核 */
export const LICENSE_GROUPS = Object.freeze([
  'permissive',
  'weakCopyleft',
  'strongCopyleft',
  'dualChoice',
  'other',
  'unknown',
]);

/** 分组中文标题(NOTICE.md 分段用) */
export const LICENSE_GROUP_TITLES = Object.freeze({
  permissive: '宽松许可(MIT / ISC / BSD / Apache-2.0 等)',
  weakCopyleft: '弱 copyleft(LGPL / MPL / CDDL / EUPL 等,需人工复核)',
  strongCopyleft: '强 copyleft(GPL / AGPL,需人工复核)',
  dualChoice: '多选一许可(含 OR 分支,需人工选定并复核)',
  other: '其它声明(需人工复核)',
  unknown: '未知/缺失许可证(阻断项)',
});

/** 无声明许可证时的占位标识(SPDX NOASSERTION 口径) */
export const NOASSERTION = 'NOASSERTION';

/** 许可证来源:lockfile 的 license 字段 */
export const LICENSE_SOURCE_LOCKFILE = 'lockfile';
/** 许可证来源:字段缺失时取自已安装包目录内的许可证文件(附证据文件名) */
export const LICENSE_SOURCE_PACKAGE_FILE = 'package-file';
/** 许可证来源:字段与随包文件都没有拿到可用声明 */
export const LICENSE_SOURCE_NONE = 'none';

/* ---------- 许可证分类 ---------- */

// 边界不对称:左侧不含连字符(避免把 "Foo-GPL" 之类误判成 GPL),右侧允许连字符
// (SPDX 惯例就是 "GPL-3.0-or-later" 这种带连字符的版本后缀)。
const STRONG_COPYLEFT_RE = /(^|[^A-Za-z0-9+.-])(AGPL|GPL)(?![A-Za-z0-9+])/;
const WEAK_COPYLEFT_RE = /(^|[^A-Za-z0-9+.-])(LGPL|MPL|CDDL|EUPL|CPL|EPL|OSL|Artistic)(?![A-Za-z0-9+])/;

/**
 * SPDX 表达式按 AND 拆分(只按顶层连接词切分即可:分组只需要「是否出现某类
 * copyleft」,不要求完整的 SPDX 语法分析)。
 * @param {string} expression 原始 license 字段
 * @returns {string[]} 各分支(去空白)
 */
function splitConjunction(expression) {
  return expression.split(/\s+AND\s+/i);
}

/**
 * 许可证分类:纯函数,同一表达式必得同一结果(SBOM/许可证清单共用)。
 *
 * 分组优先级取「最严格的一支」:表达式里只要含强 copyleft 就归 strongCopyleft,
 * 否则含弱 copyleft 归 weakCopyleft,全是宽松许可才归 permissive。含 OR 的多选一
 * 表达式额外标 dualChoice —— 这类「可选 GPL」的包必须由人选定分支,自动化不得替其决定。
 *
 * @param {string | null | undefined} raw license 字段原文
 * @returns {LicenseClassification}
 */
export function classifyLicense(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { group: 'unknown', raw: text, isCopyleft: false, isDualChoice: false, needsReview: true };
  }
  const branches = splitConjunction(text);
  const isDualChoice = /\s+OR\s+/i.test(text);
  const hasStrong = branches.some((branch) => STRONG_COPYLEFT_RE.test(branch));
  const hasWeak = branches.some((branch) => WEAK_COPYLEFT_RE.test(branch));
  // 出现 OR 分支时不能替人选定许可(MIT OR GPL-3.0 若默认选 GPL 会改变分发义务),
  // 一律记 dualChoice 交人工复核;含 OR 且无 copyleft 的(如 MIT OR CC0)同样需人工确认。
  let group = 'permissive';
  if (isDualChoice) group = 'dualChoice';
  else if (hasStrong) group = 'strongCopyleft';
  else if (hasWeak) group = 'weakCopyleft';
  else if (!/^[\s()A-Za-z0-9.+-]+$/.test(text)) group = 'other';
  return {
    group,
    raw: text,
    isCopyleft: hasStrong || hasWeak,
    isDualChoice,
    // 宽松许可无需人工动作;其余(含 copyleft 与多选一)一律进人工复核清单
    needsReview: group !== 'permissive',
  };
}

/* ---------- 随包许可证文件识别 ---------- */

// 为什么需要这一层:lockfile 的 license 字段只是「上游是否写了 package.json 声明」,
// 缺失不等于许可证未知(例:khroma@2.1.0 未写 license 字段,但 tarball 内随包分发了
// license 文件)。只信元数据会把「元数据缺失」误判成「许可证未知」,白判红;反过来
// 若不去核对文件就把这类包放行,又是一次无依据的放行。故此处做两级回落并记录来源。

/** 许可证文件候选名主干(小写;实际比对大小写不敏感) */
export const LICENSE_FILE_STEMS = Object.freeze(['license', 'licence', 'copying', 'notice']);

/** 许可证文件可接受的扩展名(空串 = 无扩展名) */
export const LICENSE_FILE_EXTENSIONS = Object.freeze(['', '.txt', '.md', '.rst']);

/** 候选文件名判定(大小写不敏感;只按 basename 匹配,不跨目录) */
const LICENSE_FILE_NAME_RE = new RegExp(`^(?:${LICENSE_FILE_STEMS.join('|')})(?:\\.(?:txt|md|rst))?$`, 'i');

/** 许可证文件识别只看开头这么多字节:许可证标题/版本/授权句都在文首,不必读全文 */
export const LICENSE_FILE_HEAD_BYTES = 16384;

/**
 * 许可证正文标记表:顺序即优先级,先匹配到的先赢。
 *
 * 只认「不同许可证之间不会共有的特征」,或「必须成对出现才成立的组合」,单凭
 * "Permission is hereby granted" 这类各许可证通行的授权句绝不作为判定依据。
 * 0BSD 与 ISC 的正文几乎逐字相同、只有标题行不同,故两者都只认标题行;标题不认
 * 就不匹配,交由调用方判 unknown —— 宁可判红也不猜。
 * @type {ReadonlyArray<{ spdx: string; re: RegExp }>}
 */
export const LICENSE_TEXT_MARKERS = Object.freeze([
  { spdx: 'AGPL-3.0', re: /GNU AFFERO GENERAL PUBLIC LICENSE/i },
  { spdx: 'LGPL-2.1', re: /GNU (?:LIBRARY|LESSER) GENERAL PUBLIC LICENSE\s+Version 2\b/i },
  { spdx: 'LGPL-3.0', re: /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3\b/i },
  { spdx: 'GPL-2.0', re: /GNU GENERAL PUBLIC LICENSE\s+Version 2\b/i },
  { spdx: 'GPL-3.0', re: /GNU GENERAL PUBLIC LICENSE\s+Version 3\b/i },
  { spdx: 'MPL-2.0', re: /Mozilla Public License\s+Version 2\.0/i },
  { spdx: 'CDDL-1.0', re: /COMMON DEVELOPMENT AND DISTRIBUTION LICENSE[\s\S]{0,80}?Version 1\.0/i },
  // Apache:标题行 + 版本行/官方 URL 成对出现才算(单见 "Apache" 可能只是正文提及)
  { spdx: 'Apache-2.0', re: /(?=[\s\S]*Apache License)(?=[\s\S]*(?:Version 2\.0, January 2004|apache\.org\/licenses\/LICENSE-2\.0))/i },
  // BSD 三条款有"Neither the name of"条款,二条款没有;仅凭共有段落无法区分
  { spdx: 'BSD-3-Clause', re: /(?=[\s\S]*Redistribution and use in source and binary forms)(?=[\s\S]*Neither the name of)/i },
  { spdx: 'BSD-2-Clause', re: /(?=[\s\S]*Redistribution and use in source and binary forms)(?![\s\S]*Neither the name of)/i },
  { spdx: '0BSD', re: /Zero-Clause BSD|\b0BSD\b/i },
  { spdx: 'ISC', re: /ISC[- ]Licen[cs]e/i },
  { spdx: 'MIT', re: /The MIT Licen[cs]e|Permission is hereby granted, free of charge/i },
  { spdx: 'Unlicense', re: /free and unencumbered software released into the public domain/i },
]);

/** 判定命中来源:SPDX 标签行(机器可读声明,优先于正文特征) */
export const LICENSE_MATCH_SPDX_TAG = 'SPDX-License-Identifier';
/** 判定命中来源:正文特征标记 */
export const LICENSE_MATCH_TEXT = 'text';

/**
 * 许可证文件识别的四种结局(reasonCode 直接写进报告,便于区分「没找」与「认不出」)。
 * - detected:识别成功
 * - no-package-dir:包目录不存在(未安装/被剪枝)
 * - no-license-file:目录里没有候选文件
 * - unrecognized:候选文件存在但内容匹配不到任何标记(绝不猜测)
 */
export const LICENSE_FILE_STATUS = Object.freeze({
  detected: 'detected',
  noPackageDir: 'no-package-dir',
  noLicenseFile: 'no-license-file',
  unrecognized: 'unrecognized',
});

/**
 * SPDX 标签行的标识符是否属于已知集合:只有全部标识符都认得才采信该标签,
 * 免得 LicenseRef-xxx 这类自定义标签被当成宽松许可放过去。
 * @param {string} expression SPDX 表达式(已按 AND/OR 拆分)
 * @returns {boolean} 是否全部为已知标识符
 */
function isKnownSpdxExpression(expression) {
  const tokens = expression
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '' && token !== 'AND' && token !== 'OR' && token !== 'WITH');
  if (tokens.length === 0) return false;
  return tokens.every((token) =>
    LICENSE_TEXT_MARKERS.some(
      (marker) => token === marker.spdx || token === `${marker.spdx}-only` || token === `${marker.spdx}-or-later` || token === `${marker.spdx}+`,
    ),
  );
}

/**
 * 从文件开头文本里读 SPDX-License-Identifier 标签(上游在文件内自述的机器可读声明)。
 * @param {string} text 文件开头文本
 * @returns {string | null} 归一后的表达式(无标签或标签不可信时 null)
 */
export function parseSpdxLicenseTag(text) {
  const match = /SPDX-License-Identifier:\s*([^\n]*)/.exec(text);
  if (match === null) return null;
  const expression = (match[1] ?? '').replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').trim();
  if (expression === '' || !/^[\s()A-Za-z0-9.+-]+$/.test(expression)) return null;
  return isKnownSpdxExpression(expression) ? expression : null;
}

/**
 * 许可证文件正文 → 许可证标识:先看 SPDX 标签,再用标记表匹配正文。
 * 匹配不到一律返回 null(调用方判 unknown),不做任何推断。
 * @param {string} text 文件开头文本
 * @returns {{ license: string | null; match: string | null }} 许可证标识与命中方式
 */
export function detectLicenseFromText(text) {
  const tagged = parseSpdxLicenseTag(text);
  if (tagged !== null) return { license: tagged, match: LICENSE_MATCH_SPDX_TAG };
  for (const marker of LICENSE_TEXT_MARKERS) {
    if (marker.re.test(text)) return { license: marker.spdx, match: LICENSE_MATCH_TEXT };
  }
  return { license: null, match: null };
}

/**
 * 列出包目录内的许可证候选文件(大小写不敏感,只取 basename)。
 * 排序固定为「主干优先级 → 扩展名优先级 → 文件名」,保证同目录同内容必得同序,
 * 识别结果因此可复现。
 * @param {string} packageDir 包目录绝对路径
 * @returns {string[]} 文件名(升序)
 */
export function listLicenseFiles(packageDir) {
  let entries;
  try {
    entries = readdirSync(packageDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!LICENSE_FILE_NAME_RE.test(entry.name)) continue;
    const dot = entry.name.indexOf('.', 1);
    const stem = (dot === -1 ? entry.name : entry.name.slice(0, dot)).toLowerCase();
    const ext = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
    candidates.push({
      name: entry.name,
      stemRank: LICENSE_FILE_STEMS.indexOf(stem),
      extRank: LICENSE_FILE_EXTENSIONS.indexOf(ext),
    });
  }
  candidates.sort((a, b) => a.stemRank - b.stemRank || a.extRank - b.extRank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return candidates.map((item) => item.name);
}

/**
 * 读文件开头若干字节(许可证识别只需文首,避免把大文件整份读进内存)。
 * @param {string} filePath 文件绝对路径
 * @returns {string} 开头文本(读取失败返回空串,由调用方按"未识别"处理)
 */
function readFileHead(filePath) {
  let handle = -1;
  try {
    handle = openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(LICENSE_FILE_HEAD_BYTES);
    const read = readSync(handle, buffer, 0, LICENSE_FILE_HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (handle !== -1) closeSync(handle);
  }
}

/**
 * 识别已安装包目录内的许可证文件(lockfile 无 license 字段时的第二级回落)。
 *
 * 绝不猜测:候选文件里没有任何一个能匹配已知标记就返回 unrecognized,由调用方判红。
 * @param {string} packageDir 包目录绝对路径
 * @returns {{ status: string; license: string | null; evidence: string | null; match: string | null; files: string[]; unreadable: number }}
 */
export function detectPackageLicense(packageDir) {
  /** @type {ReturnType<typeof detectPackageLicense>} */
  const none = { status: LICENSE_FILE_STATUS.noPackageDir, license: null, evidence: null, match: null, files: [], unreadable: 0 };
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) return none;
  const files = listLicenseFiles(packageDir);
  if (files.length === 0) return { ...none, status: LICENSE_FILE_STATUS.noLicenseFile };
  let unreadable = 0;
  for (const file of files) {
    const text = readFileHead(path.join(packageDir, file));
    if (text.trim() === '') {
      unreadable += 1;
      continue;
    }
    const detected = detectLicenseFromText(text);
    if (detected.license !== null) {
      return { status: LICENSE_FILE_STATUS.detected, license: detected.license, evidence: file, match: detected.match, files, unreadable };
    }
  }
  return { status: LICENSE_FILE_STATUS.unrecognized, license: null, evidence: null, match: null, files, unreadable };
}

/* ---------- 严重度 ---------- */

/**
 * 严重度归一:把不同数据源的写法收敛到 SEVERITY_ORDER 的取值域。
 * 未识别的严重度一律记为 'moderate' 并保留原值线索(不静默当成低危)。
 * @param {string | null | undefined} raw 原始严重度字符串
 * @returns {string} 归一后的严重度
 */
export function normalizeSeverity(raw) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (text === '') return 'moderate';
  if (text === 'medium') return 'moderate';
  if (text === 'important') return 'high';
  return SEVERITY_ORDER.includes(text) ? text : 'moderate';
}

/** CVSS v3.x 各指标权重(规范表,勿凭记忆改动) */
const CVSS_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
};

/**
 * CVSS v3.x 向量串 → 基础分(0.0–10.0,向上取整到一位小数)。
 *
 * 为什么自己算:OSV 的部分公告只给 CVSS_V3 向量而不给基础分,没有基础分就无法
 * 与 npm audit 的 high/critical 同口径比较(要么全当致命、要么全当低危)。
 * 解析失败返回 null,由调用方降级到 moderate 并在报告里标注来源不完整。
 * @param {string} vector 形如 CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
 * @returns {number | null} 基础分,无法解析时 null
 */
export function cvss3BaseScore(vector) {
  if (typeof vector !== 'string' || vector.trim() === '') return null;
  const metrics = {};
  for (const part of vector.trim().split('/')) {
    const [key, value] = part.split(':');
    if (key === undefined || value === undefined) continue;
    if (key === 'CVSS') continue;
    metrics[key] = value;
  }
  const { AV, AC, PR, UI, S, C, I, A } = metrics;
  if (!AV || !AC || !PR || !UI || !S || !C || !I || !A) return null;
  const scope = S === 'C' ? 'C' : 'U';
  const prWeight = CVSS_WEIGHTS[scope === 'C' ? 'PR_C' : 'PR_U'][PR];
  const av = CVSS_WEIGHTS.AV[AV];
  const ac = CVSS_WEIGHTS.AC[AC];
  const ui = CVSS_WEIGHTS.UI[UI];
  const c = CVSS_WEIGHTS.C[C];
  const i = CVSS_WEIGHTS.I[I];
  const a = CVSS_WEIGHTS.A[A];
  if (prWeight === undefined || av === undefined || ac === undefined || ui === undefined) return null;
  if (c === undefined || i === undefined || a === undefined) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * prWeight * ui;
  const raw = scope === 'U' ? impact + exploitability : 1.08 * (impact + exploitability);
  return Math.ceil(Math.min(raw, 10) * 10) / 10;
}

/**
 * 基础分 → 严重度带(CVSS v3.1 定级;四舍五入到一位后再比阈值)。
 * @param {number} score CVSS 基础分
 * @returns {string} 严重度
 */
export function severityFromScore(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'moderate';
  return 'low';
}

/* ---------- npm 镜像口径 ---------- */

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/**
 * 解析生效的 registry:项目 .npmrc 优先(本项目按硬约束走国内镜像),其次环境变量
 * npm_config_registry,最后才回落到官方源。刻意不读用户级 .npmrc —— 门禁结果必须
 * 只由仓库内配置决定,否则本机差异会让 CI 与本地结论分叉。
 * @param {string} projectRoot 项目根目录
 * @param {NodeJS.ProcessEnv} [env] 环境变量(便于注入)
 * @returns {{ registry: string; source: string }}
 */
export function resolveRegistry(projectRoot, env = process.env) {
  const npmrcPath = path.join(projectRoot, '.npmrc');
  if (existsSync(npmrcPath)) {
    for (const line of readFileSync(npmrcPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*registry\s*=\s*(.+?)\s*$/.exec(line);
      if (match !== null && match[1] !== '') {
        return { registry: match[1].replace(/^["']|["']$/g, ''), source: '.npmrc' };
      }
    }
  }
  const fromEnv = env.npm_config_registry;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { registry: fromEnv.trim(), source: 'npm_config_registry' };
  }
  return { registry: DEFAULT_REGISTRY, source: '默认值(无 .npmrc registry)' };
}

/* ---------- lockfile 组件模型 ---------- */

/**
 * 读取并校验 lockfile。缺文件/非法 JSON/lockfile 版本过低都是可操作报错 ——
 * SBOM、许可证、SCA 三者都以此为输入,输入不可用时必须显式失败而不是产出空报告。
 * @param {string} lockPath lockfile 绝对路径
 * @returns {object} lockfile 解析结果
 */
export function readLockfile(lockPath) {
  if (!existsSync(lockPath)) {
    throw new Error(
      `lockfile 不存在:${toPosix(lockPath)};先执行 npm install 生成 package-lock.json(供应链报告以 lockfile 为唯一输入)`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new Error(`lockfile 不是合法 JSON:${toPosix(lockPath)}(${error instanceof Error ? error.message : String(error)})`);
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.packages !== 'object' || parsed.packages === null) {
    throw new Error(`lockfile 缺少 packages 字段:${toPosix(lockPath)}(lockfileVersion 过低或非 npm 生成的 lockfile)`);
  }
  const version = Number(parsed.lockfileVersion ?? 0);
  if (version < 2) {
    throw new Error(`lockfileVersion ${parsed.lockfileVersion} 过低(需 >= 2 才能区分 dev/production 树):${toPosix(lockPath)}`);
  }
  return parsed;
}

/**
 * 从 lock 条目的路径反推包名:`node_modules/a/node_modules/@scope/b` → `@scope/b`。
 * @param {string} lockPath lock 条目路径
 * @returns {string} 包名
 */
export function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split('node_modules/');
  return parts[parts.length - 1];
}

/**
 * 组件模型:SBOM / 许可证清单 / OSV 查询共用同一份「谁是组件、属于哪棵树」。
 *
 * dev 判定用 lockfile 的 npm 内建标记:`dev: true` = 仅开发树;`devOptional: true` =
 * dev 与 optional 皆有,归开发树并标 optional;无标记 = 生产树。这样区分依据来自
 * 依赖解析器本身,而不是我们重跑一遍解析(后者会与 lockfile 漂移)。
 * @param {object} lock readLockfile 的结果
 * @returns {{ root: any; components: SupplyComponent[]; directNames: Set<string> }}
 */
export function lockComponents(lock) {
  const root = lock.packages[''] ?? {};
  const rootDirect = new Set([
    ...Object.keys(root.dependencies ?? {}),
    ...Object.keys(root.devDependencies ?? {}),
    ...Object.keys(root.optionalDependencies ?? {}),
  ]);
  const components = [];
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (lockPath === '' || entry === null || typeof entry !== 'object') continue;
    const name = packageNameFromLockPath(lockPath);
    if (name === '') continue;
    const isDevelopment = entry.dev === true || entry.devOptional === true;
    components.push({
      lockPath: toPosix(lockPath),
      name,
      version: typeof entry.version === 'string' ? entry.version : '',
      dependencyScope: isDevelopment ? SCOPE_DEVELOPMENT : SCOPE_PRODUCTION,
      optional: entry.optional === true || entry.devOptional === true,
      direct: lockPath === `node_modules/${name}` && rootDirect.has(name),
      license: typeof entry.license === 'string' && entry.license.trim() !== '' ? entry.license.trim() : null,
      licenseSource: typeof entry.license === 'string' && entry.license.trim() !== '' ? LICENSE_SOURCE_LOCKFILE : LICENSE_SOURCE_NONE,
      declaredDependencies: Object.keys(entry.dependencies ?? {}).sort(),
      optionalDependencies: Object.keys(entry.optionalDependencies ?? {}).sort(),
      peerDependencies: Object.keys(entry.peerDependencies ?? {}).sort(),
    });
  }
  components.sort((a, b) => (a.lockPath < b.lockPath ? -1 : a.lockPath > b.lockPath ? 1 : 0));
  return { root, components, directNames: rootDirect };
}

/**
 * node_modules 逐级上溯解析:给定「引入方 lock 路径 + 包名」,返回该依赖在本树中
 * 实际落到哪个 lock 条目。缺失(未安装/被剪枝)返回 null,由调用方记为 unresolved ——
 * 不得静默当成「无该依赖」,否则 SBOM 的依赖图会凭空少边。
 * @param {object} lock readLockfile 的结果
 * @param {string} fromPath 引入方 lock 路径('' 表示根包)
 * @param {string} name 依赖名
 * @returns {string | null} 命中的 lock 路径
 */
export function resolveDepPath(lock, fromPath, name) {
  let base = fromPath === '' ? [] : fromPath.split('/');
  for (;;) {
    const candidate = [...base, 'node_modules', ...name.split('/')].join('/');
    if (lock.packages[candidate] !== undefined) return candidate;
    const lastIndex = base.lastIndexOf('node_modules');
    if (lastIndex === -1) {
      if (base.length === 0) return null;
      base = [];
      continue;
    }
    base = base.slice(0, lastIndex);
  }
}

/**
 * 依赖边:每个组件 → 它实际解析到的子组件 lock 路径(去重 + 排序)。
 * optionalDependencies 覆盖同名 dependencies 条目,故先并入再去重。
 * @param {object} lock readLockfile 的结果
 * @param {SupplyComponent[]} components lockComponents 的 components
 * @returns {{ edges: Map<string, string[]>; unresolved: Map<string, string[]> }} 依赖边 + 未解析依赖名
 */
export function componentEdges(lock, components) {
  const byPath = new Map(components.map((component) => [component.lockPath, component]));
  const edges = new Map();
  const unresolved = new Map();
  const rootNames = [
    ...Object.keys(lock.packages['']?.dependencies ?? {}),
    ...Object.keys(lock.packages['']?.optionalDependencies ?? {}),
  ].sort();
  const rootEdges = [];
  for (const name of rootNames) {
    const resolved = resolveDepPath(lock, '', name);
    if (resolved !== null) rootEdges.push(resolved);
  }
  edges.set('', [...new Set(rootEdges)].sort());
  for (const component of components) {
    const declared = [...new Set([...component.declaredDependencies, ...component.optionalDependencies, ...component.peerDependencies])].sort();
    const resolvedTargets = [];
    const missing = [];
    for (const name of declared) {
      const target = resolveDepPath(lock, component.lockPath, name);
      if (target !== null && byPath.has(target)) resolvedTargets.push(target);
      else missing.push(name);
    }
    edges.set(component.lockPath, [...new Set(resolvedTargets)].sort());
    if (missing.length > 0) unresolved.set(component.lockPath, missing);
  }
  return { edges, unresolved };
}

/* ---------- 序列化与 CLI ---------- */

/**
 * 确定性 JSON 序列化:2 空格缩进 + 末尾换行。对象键序由构造顺序决定(各生成器
 * 按固定顺序建键),故同输入必得逐字节相同的输出,--check 才能做漂移比对。
 * @param {unknown} value 待序列化值
 * @returns {string} JSON 文本
 */
export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 写 JSON 产物(原子写)。
 * @param {string} filePath 目标路径
 * @param {unknown} value 待序列化值
 * @returns {void}
 */
export function writeJson(filePath, value) {
  writeFileAtomic(filePath, serializeJson(value));
}

/**
 * 读 JSON 产物,失败转可读报错。
 * @param {string} filePath 源路径
 * @returns {unknown} 解析结果
 */
export function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`文件不存在:${toPosix(filePath)}`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`文件不是合法 JSON:${toPosix(filePath)}(${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * 供应链脚本专用 CLI 解析:与 check-dist-manifest 的 parseArgs 行为一致
 * (未知选项显式失败,开关不接受取值),但 usage 文案由调用方按脚本自身传入 ——
 * 共享原语里的 USAGE 是写死的 dist 清单文案,复用到别的脚本会给出错误指引。
 * @param {string[]} argv 进程参数
 * @param {{ booleans?: string[]; values?: string[]; usage: string }} spec 选项声明与用法
 * @returns {Record<string, string | boolean>} 解析结果
 */
export function parseSupplyArgs(argv, { booleans = [], values = [], usage = '' } = {}) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (const name of booleans) options[name] = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数:${token}${usage === '' ? '' : `(${usage})`}`);
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (booleans.includes(name)) {
      if (eq !== -1) throw new Error(`--${name} 是开关,不接受取值`);
      options[name] = true;
      continue;
    }
    if (!values.includes(name)) throw new Error(`无法识别的选项:--${name}${usage === '' ? '' : `(${usage})`}`);
    const value = eq === -1 ? argv[(i += 1)] : token.slice(eq + 1);
    if (value === undefined) throw new Error(`选项 --${name} 缺少取值`);
    options[name] = value;
  }
  return options;
}

/** 统一错误文案归一(Error/字符串/未知 → 单行可读文本) */
export function errorMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Windows 下 spawn .cmd 必须走 shell(Node 对 .cmd/.bat 的直 spawn 已被加固拦截),
 * 这里沿用仓库既有做法(见 print-env-fingerprint):用 ComSpec 承载命令串,并对
 * 含空白的参数补引号 —— 否则含空格的路径会被 cmd 拆成两个参数。
 * @param {string[]} args npm 参数
 * @returns {{ command: string; args: string[] }} 可直接 spawn 的命令与参数
 */
export function npmInvocation(args) {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const comspec = process.env.ComSpec ?? 'cmd.exe';
  const commandLine = ['npm.cmd', ...args].map(quoteForCmd).join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', commandLine] };
}

/**
 * cmd 参数引号处理:仅在必要时加引号,并对内部引号做 cmd 转义。
 * @param {string} value 原始参数
 * @returns {string} 可安全传给 cmd 的参数
 */
export function quoteForCmd(value) {
  if (value === '') return '""';
  if (!/[\s"^&|<>()%!,;=]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}
