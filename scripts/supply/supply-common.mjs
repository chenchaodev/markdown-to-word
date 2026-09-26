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

/* ---------- semver 比较(决策版本范围与 SCA 修复版本共用单源) ---------- */

/**
 * 简化 semver 比较(仅 major.minor.patch,缺位按 0,非数字段按 0):
 * 避免一个畸形版本字符串把整个扫描或范围判定打断。
 * @param {string} a 左值
 * @param {string} b 右值
 * @returns {number} 比较结果(-1 / 0 / 1)
 */
export function compareSemver(a, b) {
  const parse = (value) => String(value).split('-')[0].split('.').map((part) => (Number.isFinite(Number(part)) ? Number(part) : 0));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/* ---------- 多选一许可的分支选定决策 ---------- */

// 为什么单列一层:「上游给的是 A OR B,本项目选哪一支」是人的决定,推导不出来,
// 自动化替人选就等于替用户改了分发义务。故决定以机器可读清单落盘(可审计、可 diff、
// 依赖升级后不会无声失效),分类层只负责校验清单与上游现状是否仍然对得上 ——
// 对不上(包只在 dev 树 / 版本超出决策范围 / 上游表达式变了)一律**不生效**,
// 回到未决策态(并列双分支 + needsReview),绝不静默默认选一个。
// 决策只作用于生产依赖:仅开发依赖不随包分发,没有分发义务需要人拍板。

/** 决策清单文件名(与本模块同目录) */
export const LICENSE_DECISIONS_FILE = 'license-decisions.json';

/** 决策清单 schema 版本 */
export const LICENSE_DECISIONS_SCHEMA = 'm2w/license-decisions@1';

/** 决策生效状态取值域(除 applied 外均表示「决策未生效」) */
export const DECISION_STATUS = Object.freeze({
  /** 决策与上游现状一致,已按选定分支归类 */
  applied: 'applied',
  /** 清单里没有这个包 → 未决策 */
  noDecision: 'no-decision',
  /** 有决策但该包只在开发树 → 决策不适用于 dev-only 依赖 */
  scopeExcluded: 'scope-excluded',
  /** 有决策但当前版本超出决策声明的版本范围 */
  outOfRange: 'out-of-range',
  /** 有决策但上游原始声明已变(表达式与决策记录不一致) */
  expressionMismatch: 'expression-mismatch',
  /** 清单里的包已不在依赖树中(陈旧决策记录,应删除或随新依赖重新拍板) */
  notInTree: 'not-in-tree',
});

/**
 * 决策清单里的一条决策。
 * @typedef {object} LicenseDecision
 * @property {string} name 包名
 * @property {string} versionRange 适用版本范围(比较子句,空格或逗号分隔;空串 = 任意版本)
 * @property {string} upstreamExpression 决策当时的上游原始多分支声明
 * @property {string} selectedBranch 本项目选定的分支
 * @property {string} rationale 选定理由
 * @property {string} decidedOn 决策日期(YYYY-MM-DD)
 * @property {string} decidedBy 决策人
 */

/**
 * 决策生效的判定结果。
 * @typedef {object} DecisionOutcome
 * @property {string} status DECISION_STATUS 取值
 * @property {LicenseDecision | null} decision 命中的决策(未命中为 null)
 * @property {string | null} selectedBranch 选定分支(仅 applied 有)
 * @property {string} note 人读说明
 */

/** 版本范围里允许的比较子句;不接受 ^ / ~ / 空格交集以外的语法(语法含糊不如显式失败) */
const RANGE_TERM_RE = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*)$/;

/**
 * 解析版本范围:逐个比较子句 → 判定式。空串 = 任意版本(决策对该包的任意版本生效)。
 * 语法不认得就抛错(强制决策记录写成无歧义的形式),不猜。
 * @param {string} range 版本范围
 * @returns {Array<{ op: string; version: string }>} 比较子句
 */
export function parseVersionRange(range) {
  const text = typeof range === 'string' ? range.trim() : '';
  if (text === '' || text === '*') return [];
  return text
    .split(/[\s,]+/)
    .filter((term) => term !== '')
    .map((term) => {
      const match = RANGE_TERM_RE.exec(term);
      if (match === null) throw new Error(`版本范围语法不认得:${term}(只支持 >= > <= < = 与纯版本号,例:">=3.0.0 <4.0.0")`);
      return { op: match[1] ?? '=', version: match[2] ?? '' };
    });
}

/**
 * 版本是否落在给定范围内。版本号本身缺失(lockfile 条目无 version)时一律判 false ——
 * 无法确认范围的包不该被一条「看起来匹配」的决策放行。
 * @param {string} version 实际版本
 * @param {string} range 版本范围
 * @returns {boolean} 是否满足全部比较子句
 */
export function versionSatisfies(version, range) {
  const terms = parseVersionRange(range);
  if (terms.length === 0) return true;
  if (typeof version !== 'string' || version.trim() === '') return false;
  return terms.every((term) => {
    const result = compareSemver(version, term.version);
    if (term.op === '>=') return result >= 0;
    if (term.op === '>') return result > 0;
    if (term.op === '<=') return result <= 0;
    if (term.op === '<') return result < 0;
    return result === 0;
  });
}

/**
 * 找首个左括号对应的右括号下标;不是成对包裹整式时返回 -1。
 * @param {string} text 已确认以 `(` 开头
 * @returns {number} 匹配右括号下标
 */
function closingParenIndex(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * SPDX 表达式归一:压缩空白 + 去掉包裹整式的冗余外层括号 + 去掉括号旁空白。
 * 只做书写差异的归一,不改动分支本身 —— 决策记录与上游声明的等值判定必须
 * 对「同一声明的不同写法」成立,对「换了分支」不成立。
 * @param {string | null | undefined} expression 原始表达式
 * @returns {string} 归一后的表达式
 */
export function normalizeSpdxExpression(expression) {
  let text = typeof expression === 'string' ? expression.trim().replace(/\s+/g, ' ') : '';
  for (;;) {
    if (!text.startsWith('(') || !text.endsWith(')')) break;
    if (closingParenIndex(text) !== text.length - 1) break;
    text = text.slice(1, -1).trim();
  }
  return text.replace(/ *([()]) */g, '$1');
}

/**
 * 表达式是否含某个分支(按归一后的整词比对,避免 MIT 命中 MIT-0.9 这类前缀误配)。
 * @param {string} expression 原始表达式
 * @param {string} branch 待查分支
 * @returns {boolean} 是否含该分支
 */
export function expressionIncludesBranch(expression, branch) {
  const wanted = normalizeSpdxExpression(branch).toLowerCase();
  if (wanted === '') return false;
  return normalizeSpdxExpression(expression)
    .split(/[()]|\s+(?:OR|AND|WITH)\s+/i)
    .some((token) => token.trim().toLowerCase() === wanted);
}

/**
 * 许可证义务摘要单源(NOTICE 展示用):选中该分支就要按摘要履行分发义务。
 * 认不出的标识符返回 null,由调用方显式标注「未登记」,不得编造义务。
 * @type {Readonly<Record<string, string>>}
 */
export const LICENSE_OBLIGATION_SUMMARIES = Object.freeze({
  MIT: '保留版权与许可声明并随分发附上许可全文;不得对软件本身施加附加限制',
  'Apache-2.0': '保留版权与许可声明、标注对原文件的修改、随分发附上许可全文与上游 NOTICE(如有);含专利授权,专利诉讼可终止授权',
  'MPL-2.0': '文件级 copyleft:对 MPL 覆盖的文件本身的修改须继续以 MPL 提供;分发二进制时须以可获取方式提供这些文件',
  ISC: '保留版权与许可声明并随分发附上许可全文',
  'BSD-2-Clause': '保留版权与许可声明并随分发附上许可全文',
  'BSD-3-Clause': '保留版权与许可声明、随分发附上许可全文,不得用其名义为产品背书',
  '0BSD': '可无条件使用与再分发;建议仍随包附上上游许可声明',
  Unlicense: '公有领域奉献,可无附加条件使用',
  'GPL-3.0': '强 copyleft:分发(含二进制)须以 GPL-3.0 提供完整对应源码',
  'GPL-2.0': '强 copyleft:分发(含二进制)须以 GPL-2.0 提供完整对应源码',
  'LGPL-3.0': '弱 copyleft:允许链接使用;对库本身的修改与再分发须以 LGPL-3.0 提供源码',
  'LGPL-2.1': '弱 copyleft:允许链接使用;对库本身的修改与再分发须以 LGPL-2.1 提供源码',
  'AGPL-3.0': '强 copyleft,且经网络提供服务亦触发源码提供义务',
  'CDDL-1.0': '文件级 copyleft:以文件为粒度,未修改文件可保持原许可继续分发',
});

/**
 * 取某个许可证标识的义务摘要:先精确匹配,再去掉 -or-later / -only / + 后缀按基名匹配。
 * @param {string | null | undefined} license 许可证标识
 * @returns {string | null} 义务摘要(未登记为 null)
 */
export function resolveObligationSummary(license) {
  const text = typeof license === 'string' ? license.trim() : '';
  if (text === '') return null;
  const exact = LICENSE_OBLIGATION_SUMMARIES[text];
  if (exact !== undefined) return exact;
  const base = text.replace(/-(?:or-later|only)$/, '').replace(/\+$/, '');
  return LICENSE_OBLIGATION_SUMMARIES[base] ?? null;
}

/**
 * 决策清单(读文件 + 校验 + 索引 + 内容指纹;source/sha256 在内存构造时可为 null)。
 * @typedef {object} LicenseDecisionIndex
 * @property {string} schema
 * @property {string | null} source 清单路径(记入报告,便于反查;内存构造时为 null)
 * @property {string | null} sha256 清单内容指纹(内容不变则报告确定)
 * @property {Map<string, LicenseDecision>} byName 包名 → 决策
 * @property {LicenseDecision[]} entries 按包名排序的决策
 */

/**
 * 校验并索引决策清单。字段缺失、schema 不符、选定分支不在上游声明里,一律抛错 ——
 * 决策数据错了必须在生成报告前就炸掉,不能带着错数据出报告。
 * @param {unknown} decisions 决策数组
 * @param {{ source?: string | null; sha256?: string | null }} [meta] 来源与指纹(读文件时传入)
 * @returns {LicenseDecisionIndex} 决策索引
 */
export function createDecisionIndex(decisions, { source = null, sha256 = null } = {}) {
  if (!Array.isArray(decisions)) throw new Error('决策清单的 decisions 字段必须是数组');
  /** @type {Map<string, LicenseDecision>} */
  const byName = new Map();
  for (const [index, raw] of decisions.entries()) {
    const at = `decisions[${index}]`;
    if (raw === null || typeof raw !== 'object') throw new Error(`${at} 必须是对象`);
    const record = /** @type {Record<string, unknown>} */ (raw);
    for (const field of ['name', 'versionRange', 'upstreamExpression', 'selectedBranch', 'rationale', 'decidedOn', 'decidedBy']) {
      if (typeof record[field] !== 'string' || String(record[field]).trim() === '') {
        throw new Error(`${at}.${field} 缺失或为空(决策必须逐条可审计:包名/版本范围/上游原始声明/选定分支/理由/日期/决策人)`);
      }
    }
    const name = String(record.name).trim();
    if (byName.has(name)) throw new Error(`决策清单里 ${name} 出现多条决策(同一包只能有一条,否则无法判定该采哪条)`);
    const upstreamExpression = String(record.upstreamExpression).trim();
    const selectedBranch = String(record.selectedBranch).trim();
    if (!/\s+OR\s+/i.test(normalizeSpdxExpression(upstreamExpression))) {
      throw new Error(`${at}(${name})的 upstreamExpression 不含 OR 分支:多选一决策只用于「上游给了 A OR B」的情形`);
    }
    if (!expressionIncludesBranch(upstreamExpression, selectedBranch)) {
      throw new Error(`${at}(${name})的 selectedBranch「${selectedBranch}」不在 upstreamExpression「${upstreamExpression}」的分支里`);
    }
    byName.set(name, {
      name,
      versionRange: String(record.versionRange).trim(),
      upstreamExpression,
      selectedBranch,
      rationale: String(record.rationale).trim(),
      decidedOn: String(record.decidedOn).trim(),
      decidedBy: String(record.decidedBy).trim(),
    });
  }
  const entries = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { schema: LICENSE_DECISIONS_SCHEMA, source, sha256, byName, entries };
}

/**
 * 读决策清单文件。文件缺失 / schema 不符 / 记录非法都显式抛错(不静默按「无决策」处理:
 * 决策清单在而读不出来,等于悄悄丢掉了人的决定)。
 *
 * label 是记进产物的来源标识:必须由调用方给**相对路径**,否则产物里会留下本机绝对
 * 路径,同输入在不同机器上就不可能逐字节一致。
 * @param {string} filePath 决策清单绝对路径
 * @param {string | null} [label] 产物里记录的来源标识(默认取该绝对路径)
 * @returns {LicenseDecisionIndex} 决策索引
 */
export function loadLicenseDecisions(filePath, label = null) {
  const parsed = readJson(filePath);
  if (parsed === null || typeof parsed !== 'object' || /** @type {Record<string, unknown>} */ (parsed).schema !== LICENSE_DECISIONS_SCHEMA) {
    throw new Error(`决策清单 schema 不符(期望 ${LICENSE_DECISIONS_SCHEMA}):${toPosix(filePath)}`);
  }
  return createDecisionIndex(/** @type {Record<string, unknown>} */ (parsed).decisions, {
    source: label ?? toPosix(filePath),
    sha256: hashBuffer(readFileSync(filePath)),
  });
}

/** 决策未生效时的人读说明(报告与 CLI 共用同一口径) */
function decisionNote(status, decision, version) {
  if (status === DECISION_STATUS.applied) return `已按决策选用 ${/** @type {LicenseDecision} */ (decision).selectedBranch}`;
  if (status === DECISION_STATUS.noDecision) return '决策清单中没有该包 → 保持上游并列声明并继续需人工复核';
  if (status === DECISION_STATUS.scopeExcluded) return '决策只适用于生产依赖;该包仅在开发树,不随包分发,决策不生效';
  if (status === DECISION_STATUS.outOfRange) {
    return `当前版本 ${version} 超出决策声明的版本范围 ${/** @type {LicenseDecision} */ (decision).versionRange} → 决策不生效,需重新拍板`;
  }
  return `上游原始声明已变为「${/** @type {LicenseDecision} */ (decision).upstreamExpression}」之外的内容,与决策记录不一致 → 决策不生效,需重新拍板`;
}

/**
 * 判定一条决策是否生效(纯函数:同样输入必得同样结论)。
 *
 * 顺序固定为「有没有决策 → 是否生产依赖 → 版本是否在范围内 → 上游声明是否仍一致」,
 * 任一不满足即不生效,绝不默认选一个分支。
 * @param {{ name: string; version: string; upstreamExpression: string | null; isProduction: boolean }} input 被判定的组件
 * @param {LicenseDecisionIndex | null} decisions 决策索引(null = 未提供决策)
 * @returns {DecisionOutcome} 生效结果
 */
export function resolveLicenseDecision({ name, version, upstreamExpression, isProduction }, decisions) {
  const decision = decisions?.byName.get(name) ?? null;
  if (decision === null) {
    return { status: DECISION_STATUS.noDecision, decision: null, selectedBranch: null, note: decisionNote(DECISION_STATUS.noDecision, null, version) };
  }
  if (!isProduction) {
    return { status: DECISION_STATUS.scopeExcluded, decision, selectedBranch: null, note: decisionNote(DECISION_STATUS.scopeExcluded, decision, version) };
  }
  if (!versionSatisfies(version, decision.versionRange)) {
    return { status: DECISION_STATUS.outOfRange, decision, selectedBranch: null, note: decisionNote(DECISION_STATUS.outOfRange, decision, version) };
  }
  if (normalizeSpdxExpression(upstreamExpression) !== normalizeSpdxExpression(decision.upstreamExpression)) {
    return { status: DECISION_STATUS.expressionMismatch, decision, selectedBranch: null, note: decisionNote(DECISION_STATUS.expressionMismatch, decision, version) };
  }
  return { status: DECISION_STATUS.applied, decision, selectedBranch: decision.selectedBranch, note: decisionNote(DECISION_STATUS.applied, decision, version) };
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
