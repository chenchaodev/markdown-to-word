// SCA(依赖漏洞扫描):npmmirror audit 端点为主源、OSV 为可用替代源,exit 0/1。
//
// 扫描源与顺序:
//   1. npm audit,registry 取项目 .npmrc(本项目硬约束为国内 npmmirror)。生产树用
//      --omit=dev、含 dev 全树不带该开关,两棵树各跑一次、结果分别记录 —— 只跑全树
//      会把「仅开发依赖有洞」和「发布包有洞」混成同一个数字。
//   2. npmmirror 未实现 audit 端点(实测 POST /-/npm/v1/security/* 返回
//      NOT_IMPLEMENTED),故以 OSV.dev 的 batch 接口作为可用替代源。OSV 一次批量
//      查询全部组件,再按 lockfile 的 dev 标记把结果投影回两棵树,省掉双份请求。
//
// 关键契约(绝不可违反):
//   - 任何扫描源不可用(端点不支持/网络失败/响应不可解析)→ 该源 status="unavailable"
//     并记录原因诊断;**不得**输出「无漏洞」,**不得**以退出码 0 冒充通过。
//   - 全部源都不可用 → 整体 status="unavailable",非零退出,文案明确「未能判定」。
//   - 真实发现漏洞时按 production 优先判红:生产树命中 high/critical 阻断;
//     仅开发树的命中只记录并提示,不阻断(它们不进发布包)。
//
// 用法:
//   node scripts/supply/sca-audit.mjs [--lock <file>] [--registry <url>]
//       [--osv-endpoint <url>] [--no-osv] [--no-npm-audit] [--output <file>] [--print]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKING_SEVERITIES,
  SEVERITY_ORDER,
  SUPPLY_OUTPUT_DIR,
  compareSemver,
  cvss3BaseScore,
  errorMessage,
  isMainModule,
  lockComponents,
  npmInvocation,
  normalizeSeverity,
  parseSupplyArgs,
  readLockfile,
  resolveRegistry,
  runCommand,
  severityFromScore,
  toPosix,
  writeJson,
} from './supply-common.mjs';

// semver 比较是跨段共享原语(决策版本范围也要用),单源在 supply-common;此处转出
// 保持既有 import 路径可用。
export { compareSemver };

/** SCA 报告 schema 版本 */
export const SCA_SCHEMA = 'm2w/sca-report@1';

/** 整体/单源状态取值域 */
export const STATUS_OK = 'ok';
export const STATUS_UNAVAILABLE = 'unavailable';

/** 依赖树口径:生产树与含 dev 全树(报告里的 scope 键) */
export const TREE_PRODUCTION = 'production';
export const TREE_ALL = 'all';

/** npm audit 的两棵依赖树:生产树与含 dev 全树 */
export const TREES = Object.freeze([TREE_PRODUCTION, TREE_ALL]);

/**
 * 归一化后的漏洞条目(SBOM/许可证/报告共用同一形状)。
 * @typedef {object} ScaFinding
 * @property {string} name 包名
 * @property {string} severity 归一后的严重度
 * @property {string} severitySource 严重度来源(database_specific/cvss3/npm-audit/fallback/degraded)
 * @property {boolean} isDirect 是否直接依赖
 * @property {'production' | 'development'} [dependencyScope] 依赖范围(OSV 路径可得)
 * @property {{ title: string; severity: string; url: string | null; range: string | null }[]} advisories 公告
 * @property {string} fix 修复说明
 * @property {number | null} [cvssScore] CVSS 基础分(可算时)
 * @property {string} source 来源源 id
 */

/**
 * 单个扫描源的结论。
 * @typedef {object} ScaSource
 * @property {string} id 源 id(npm-audit / osv)
 * @property {string} endpoint 端点 URL
 * @property {string | null} registrySource 端点来源(仅 npm-audit 有意义)
 * @property {string} status ok / unavailable
 * @property {string | null} reason 不可用原因(可读诊断)
 * @property {Record<string, string> | null} trees 各树结论
 * @property {number} [advisoryCount] OSV 命中的公告数
 * @property {{ id: string; reason: string }[]} [detailFailures] 公告详情抓取失败项
 */

/**
 * 单棵依赖树的结论。
 * @typedef {object} ScaTreeResult
 * @property {string} status ok / unavailable
 * @property {string | null} source 给出结论的源 id
 * @property {string | null} reason 无结论时的原因
 * @property {number} vulnerabilityCount
 * @property {Record<string, number>} counts 各严重度计数
 * @property {ScaFinding[]} vulnerabilities 归一化条目
 */

/**
 * SCA 报告(sca-report.json 的文档形状)。
 * @typedef {object} ScaReport
 * @property {string} schema
 * @property {string} registry audit 端点
 * @property {string} registrySource 端点来源
 * @property {string | null} osvEndpoint
 * @property {string} lockfile 输入标识
 * @property {number} componentCount 参与扫描的组件数
 * @property {ScaSource[]} sources
 * @property {Record<string, ScaTreeResult>} scopes
 * @property {string} status ok / unavailable
 * @property {string[]} blocking 阻断项
 * @property {string[]} notes 提示项
 */

/** 树的可读标签 */
export const TREE_LABELS = Object.freeze({
  [TREE_PRODUCTION]: '生产树(--omit=dev,进发布包)',
  [TREE_ALL]: '含 dev 全树',
});

/** 默认 OSV 端点(可用替代源;可用环境变量 M2W_OSV_ENDPOINT 或 --osv-endpoint 覆盖) */
export const DEFAULT_OSV_ENDPOINT = 'https://api.osv.dev';

/** OSV 单次批量上限(超出会被端点拒绝) */
const OSV_BATCH_SIZE = 100;

/** 默认超时:audit 要下载 advisory 库,给得比普通探针宽 */
const DEFAULT_AUDIT_TIMEOUT_MS = 180_000;
const DEFAULT_OSV_TIMEOUT_MS = 30_000;

const USAGE = `用法: node scripts/supply/sca-audit.mjs [选项]
  --lock <file>            输入 lockfile(默认项目根的 package-lock.json)
  --registry <url>         audit 端点(默认取项目 .npmrc 的 registry)
  --osv-endpoint <url>     OSV 端点(默认 ${DEFAULT_OSV_ENDPOINT},或环境变量 M2W_OSV_ENDPOINT)
  --no-osv                 禁用 OSV 兜底,只用 npm audit
  --no-npm-audit           禁用 npm audit,只用 OSV
  --output <file>          报告落盘路径(默认 ${toPosix(path.join(SUPPLY_OUTPUT_DIR, 'sca-report.json'))})
  --print                  把报告正文打到 stdout
  --help                   显示本用法`;

/* ---------- npm audit ---------- */

/**
 * 两棵树的 audit 命令:生产树带 --omit=dev,全树不带。
 * @param {string} registry audit 端点
 * @returns {{ tree: string; args: string[] }[]}
 */
export function buildAuditPlan(registry) {
  return [
    { tree: TREE_PRODUCTION, args: ['audit', '--json', '--omit=dev', `--registry=${registry}`] },
    { tree: TREE_ALL, args: ['audit', '--json', `--registry=${registry}`] },
  ];
}

/**
 * 解析 `npm audit --json` 的输出。
 *
 * 判别「真实结果」而非「退出码」:npm 在端点报错时同样会把一段 JSON 打到 stdout
 * (形状是 {message, statusCode, body},没有 metadata/vulnerabilities),且退出码与
 * 「发现漏洞」都是 1。只看退出码会把「端点不可用」误判成「发现漏洞」或「无漏洞」。
 * @param {{ tree: string; registry: string; result: import('./supply-common.mjs').CommandResult }} input 输入
 * @returns {{ tree: string; source: string; status: string; reason: string | null; payload: any }}
 */
export function parseAuditPayload({ tree, registry, result }) {
  const source = `npm audit --registry=${registry}${tree === TREE_PRODUCTION ? ' --omit=dev' : ''}`;
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  if (result.timedOut === true) {
    return { tree, source, status: STATUS_UNAVAILABLE, reason: `命令超时(退出码 ${String(result.exitCode)})`, payload: null };
  }
  let payload = null;
  if (stdout !== '') {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }
  const hasAuditShape =
    payload !== null &&
    typeof payload === 'object' &&
    typeof payload.metadata === 'object' &&
    payload.metadata !== null &&
    typeof payload.vulnerabilities === 'object' &&
    payload.vulnerabilities !== null;
  if (hasAuditShape) {
    return { tree, source, status: STATUS_OK, reason: null, payload };
  }
  const statusCode = typeof payload?.statusCode === 'number' ? payload.statusCode : null;
  const message = typeof payload?.message === 'string' && payload.message !== '' ? payload.message : null;
  const bodyError = typeof payload?.body?.error === 'string' && payload.body.error !== '' ? payload.body.error : null;
  const stderrHead = stderr.split(/\r?\n/).find((line) => line.trim() !== '') ?? null;
  const parts = [...new Set([statusCode === null ? null : `HTTP ${statusCode}`, message ?? bodyError, stderrHead].filter((part) => part !== null))];
  const reason = parts.length > 0 ? parts.join(' | ') : `npm audit 未返回可解析结果(退出码 ${String(result.exitCode)},stdout 为空)`;
  return { tree, source, status: STATUS_UNAVAILABLE, reason, payload: null };
}

/**
 * 归一化 audit 报告里的漏洞条目:补齐「包名 / 严重度 / 修复版本」三要素。
 * @param {any} payload audit --json 的解析结果(JSON.parse 结果,未做形状校验)
 * @returns {ScaFinding[]} 归一化条目(按 严重度 → 包名 排序)
 */
export function normalizeAuditVulnerabilities(payload) {
  const entries = [];
  for (const [name, value] of Object.entries(payload.vulnerabilities ?? {})) {
    if (value === null || typeof value !== 'object') continue;
    const advisories = (Array.isArray(value.via) ? value.via : [])
      .filter((item) => item !== null && typeof item === 'object' && typeof item.title === 'string')
      .map((item) => ({
        title: item.title,
        severity: normalizeSeverity(item.severity),
        url: typeof item.url === 'string' ? item.url : null,
        range: typeof item.range === 'string' ? item.range : null,
      }));
    entries.push({
      name,
      severity: normalizeSeverity(value.severity),
      isDirect: value.isDirect === true,
      range: typeof value.range === 'string' ? value.range : null,
      advisories,
      fix: describeFix(value.fixAvailable),
      severitySource: 'npm-audit',
      source: 'npm-audit',
    });
  }
  return sortFindings(entries);
}

/**
 * fixAvailable → 可读的修复口径。npm 只有 true / {name,version} / false 三种形态,
 * 统一成一句话,报告里直接可读,不必再翻文档。
 * @param {unknown} fixAvailable audit 报告的 fixAvailable 字段
 * @returns {string} 修复说明
 */
export function describeFix(fixAvailable) {
  if (fixAvailable === true) return '有修复(同主版本内,见 npm audit fix)';
  if (fixAvailable !== null && typeof fixAvailable === 'object') {
    const name = typeof fixAvailable.name === 'string' ? fixAvailable.name : '';
    const version = typeof fixAvailable.version === 'string' ? fixAvailable.version : '';
    if (name !== '' && version !== '') return `升级到 ${name}@${version}`;
  }
  if (fixAvailable === false) return '暂无修复版本';
  return '修复情况未知';
}

/* ---------- OSV(可用替代源)---------- */

/**
 * OSV 批量查询(第一阶段:只做「有没有」)。按 100 个一组切批,顺序与输入一致。
 *
 * 注意:querybatch 的每条结果只有 {id, modified} —— 严重度、修复版本、摘要都不在
 * 响应里,必须再按 id 取详情(第二阶段 loadOsvDetails)。把只有 id 的结果当结论用,
 * 会得到「每条都是 moderate 且都无修复版本」的错误画像。
 * @param {{ components: import('./supply-common.mjs').SupplyComponent[]; endpoint: string; fetchImpl: typeof fetch; timeoutMs: number }} input 输入
 * @returns {Promise<{ status: string; reason: string | null; idsByLockPath: Map<string, string[]> }>}
 */
export async function queryOsv({ components, endpoint, fetchImpl, timeoutMs }) {
  /** @type {Map<string, string[]>} */
  const idsByLockPath = new Map();
  if (components.length === 0) return { status: STATUS_OK, reason: null, idsByLockPath };
  const base = endpoint.replace(/\/+$/, '');
  for (let start = 0; start < components.length; start += OSV_BATCH_SIZE) {
    const batch = components.slice(start, start + OSV_BATCH_SIZE);
    const body = {
      queries: batch.map((component) => ({ package: { name: component.name, ecosystem: 'npm' }, version: component.version })),
    };
    let response;
    try {
      response = await fetchImpl(`${base}/v1/querybatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { status: STATUS_UNAVAILABLE, reason: `批量查询请求失败:${errorMessage(error)}`, idsByLockPath };
    }
    if (response.ok !== true) {
      return { status: STATUS_UNAVAILABLE, reason: `批量查询 HTTP ${String(response.status)} ${String(response.statusText ?? '')}`.trim(), idsByLockPath };
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return { status: STATUS_UNAVAILABLE, reason: `批量查询响应不是合法 JSON:${errorMessage(error)}`, idsByLockPath };
    }
    const results = Array.isArray(payload?.results) ? payload.results : null;
    if (results === null) {
      return { status: STATUS_UNAVAILABLE, reason: '批量查询响应缺少 results 数组', idsByLockPath };
    }
    batch.forEach((component, index) => {
      const ids = (Array.isArray(results[index]?.vulns) ? results[index].vulns : [])
        .map((vuln) => (typeof vuln?.id === 'string' ? vuln.id : null))
        .filter((id) => id !== null);
      idsByLockPath.set(component.lockPath, ids);
    });
  }
  return { status: STATUS_OK, reason: null, idsByLockPath };
}

/** 详情抓取并发上限:对端是公共服务,串行太慢、无上限并发会被限流 */
const OSV_DETAIL_CONCURRENCY = 5;

/**
 * OSV 公告详情(第二阶段:按 id 取完整记录)。并发受限、逐个收集,结果按 id 归并,
 * 因此运行顺序不影响报告内容。
 * @param {{ ids: string[]; endpoint: string; fetchImpl: typeof fetch; timeoutMs: number; concurrency?: number }} input 输入
 * @returns {Promise<{ byId: Map<string, any>; failures: { id: string; reason: string }[] }>}
 */
export async function loadOsvDetails({ ids, endpoint, fetchImpl, timeoutMs, concurrency = OSV_DETAIL_CONCURRENCY }) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  /** @type {{ id: string; reason: string }[]} */
  const failures = [];
  const base = endpoint.replace(/\/+$/, '');
  const queue = [...ids];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const response = await fetchImpl(`${base}/v1/vulns/${encodeURIComponent(id)}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok !== true) {
          failures.push({ id, reason: `HTTP ${String(response.status)}` });
          continue;
        }
        byId.set(id, await response.json());
      } catch (error) {
        failures.push({ id, reason: errorMessage(error) });
      }
    }
  });
  await Promise.all(workers);
  return { byId, failures };
}

/**
 * OSV 公告 → 归一化条目(严重度与修复版本就地解析)。
 *
 * 严重度来源写进 severitySource:database_specific 是公告自评(最可信);cvss3 是本地
 * 按向量算的;fallback/degraded 表示公告没给可用评级或详情取不到 —— 一律显式标注,
 * 不让「猜出来的 moderate」看起来像「确认过的 moderate」。
 * @param {any} vuln OSV vuln 对象(详情;缺失时传 {id})
 * @param {import('./supply-common.mjs').SupplyComponent} component 所属组件
 * @returns {ScaFinding} 归一化条目
 */
export function normalizeOsvVulnerability(vuln, component) {
  const id = typeof vuln.id === 'string' ? vuln.id : 'UNKNOWN';
  const hasDetail = Array.isArray(vuln.affected) || typeof vuln.summary === 'string' || Array.isArray(vuln.severity);
  const dbSeverity = typeof vuln.database_specific?.severity === 'string' ? vuln.database_specific.severity : null;
  const severities = Array.isArray(vuln.severity) ? vuln.severity : [];
  const cvss = severities.map((item) => cvss3BaseScore(item?.score)).find((score) => score !== null) ?? null;
  let severity;
  let severitySource;
  if (dbSeverity !== null) {
    severity = normalizeSeverity(dbSeverity);
    severitySource = 'database_specific';
  } else if (cvss !== null) {
    severity = severityFromScore(cvss);
    severitySource = 'cvss3';
  } else {
    severity = 'moderate';
    severitySource = hasDetail ? 'fallback' : 'degraded';
  }
  return {
    name: component.name,
    severity,
    severitySource,
    dependencyScope: component.dependencyScope,
    isDirect: component.direct,
    advisories: [
      {
        title: typeof vuln.summary === 'string' && vuln.summary !== '' ? vuln.summary : id,
        severity,
        url: id.startsWith('GHSA-') ? `https://github.com/advisories/${id}` : null,
        range: null,
      },
    ],
    fix: hasDetail ? describeOsvFix(vuln, component.version) : '未知(公告详情不可用)',
    cvssScore: cvss,
    source: 'osv',
  };
}

/**
 * 从 OSV 公告 affected[].ranges[].events 里找「高于当前版本的最小修复版本」。
 * @param {any} vuln OSV vuln 对象
 * @param {string} currentVersion 当前锁定版本
 * @returns {string} 修复说明
 */
export function describeOsvFix(vuln, currentVersion) {
  const candidates = [];
  for (const affected of Array.isArray(vuln.affected) ? vuln.affected : []) {
    for (const range of Array.isArray(affected?.ranges) ? affected.ranges : []) {
      for (const event of Array.isArray(range?.events) ? range.events : []) {
        if (typeof event?.fixed === 'string') candidates.push(event.fixed);
      }
    }
  }
  if (candidates.length === 0) return '暂无修复版本';
  const higher = candidates.filter((candidate) => compareSemver(candidate, currentVersion) > 0).sort(compareSemver);
  if (higher.length === 0) return '暂无高于当前版本的修复版本';
  return `升级到 ${higher[0]}`;
}

/* ---------- 汇总与判定 ---------- */

/**
 * 排序:严重度降序,同级按包名升序(报告可读、两次运行行序稳定)。
 * @param {ScaFinding[]} findings 归一化条目
 * @returns {ScaFinding[]} 新数组(不改入参)
 */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const diff = SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
    return diff !== 0 ? diff : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/**
 * 按严重度统计。
 * @param {ScaFinding[]} findings 归一化条目
 * @returns {Record<string, number>} 各严重度计数
 */
export function countBySeverity(findings) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const severity of SEVERITY_ORDER) counts[severity] = 0;
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  return counts;
}

/**
 * 漏洞指纹:同一条漏洞在两棵树里指向同一个包时用它去重,避免把生产树的洞报两遍。
 * @param {ScaFinding} finding 归一化条目
 * @returns {string} 漏洞指纹
 */
function findingKey(finding) {
  return `${finding.name}|${(finding.advisories ?? []).map((item) => item.title).join('~')}`;
}

/**
 * 判定:产出阻断项与可读诊断。
 *
 * 阻断条件两类,互不替代:
 *   1. 扫描源不可用 → 阻断(「未能判定」永远不能当通过);
 *   2. 生产树命中 high/critical → 阻断;仅开发树命中只记录提示(不进发布包)。
 * @param {{ sources: ScaSource[]; scopes: Record<string, ScaTreeResult> }} scan runScaScan 中 sources/scopes 两段
 * @returns {{ status: string; blocking: string[]; notes: string[] }}
 */
export function evaluateSca(scan) {
  const blocking = [];
  const notes = [];
  for (const source of scan.sources) {
    if (source.status === STATUS_UNAVAILABLE) {
      notes.push(`扫描源不可用:${source.id} — ${source.reason ?? '未提供原因'}`);
    }
  }
  if (scan.sources.every((source) => source.status !== STATUS_OK)) {
    blocking.push(
      `全部扫描源不可用(已尝试 ${scan.sources.map((source) => source.id).join('、') || '无'}),` +
        '本次未判定依赖漏洞状态 —— 这不等于「无漏洞」,不得据此放行',
    );
    return { status: STATUS_UNAVAILABLE, blocking, notes };
  }
  const productionKeys = new Set((scan.scopes[TREE_PRODUCTION].vulnerabilities ?? []).map(findingKey));
  for (const tree of TREES) {
    const result = scan.scopes[tree];
    if (result.status !== STATUS_OK || !Array.isArray(result.vulnerabilities)) continue;
    for (const finding of result.vulnerabilities) {
      // 严重度是「猜出来的」时必须留痕,否则报告里那条 moderate 会被当成确认过的结论
      if (finding.severitySource === 'degraded') {
        notes.push(`公告详情不可用,严重度按缺省记录(待人工确认):${finding.name} — ${finding.advisories.map((item) => item.title).join('; ')}`);
      } else if (finding.severitySource === 'fallback') {
        notes.push(`公告未给出可用严重度评级,按 moderate 记录(待人工确认):${finding.name}`);
      }
      if (!BLOCKING_SEVERITIES.includes(finding.severity)) continue;
      const titles = finding.advisories.map((item) => item.title).join('; ') || '无公告标题';
      if (tree === TREE_PRODUCTION) {
        blocking.push(`生产树漏洞:${finding.name}(${finding.severity.toUpperCase()}) ${finding.fix} — ${titles}`);
      } else if (!productionKeys.has(findingKey(finding))) {
        notes.push(`仅开发依赖命中(不阻断,不进发布包):${finding.name}(${finding.severity}) ${finding.fix}`);
      }
    }
  }
  return { status: STATUS_OK, blocking, notes };
}

/* ---------- 扫描编排 ---------- */

/**
 * 跑完整 SCA:两棵树的 npm audit + OSV 兜底,汇总成一份报告。
 *
 * 依赖注入(transport / fetchImpl)是为了让「端点不可用 / 真实漏洞」两类判定能在
 * 离线测试里被确定性复现,同时真实运行路径仍只有一条。
 * @param {object} options 选项
 * @returns {Promise<ScaReport>} 报告(含 status/blocking/notes)
 */
export async function runScaScan(options = {}) {
  const {
    lockPath,
    lockLabel = 'package-lock.json',
    registry,
    registrySource = '调用方指定',
    projectDir = path.dirname(lockPath),
    osvEndpoint = process.env.M2W_OSV_ENDPOINT ?? DEFAULT_OSV_ENDPOINT,
    allowNpmAudit = true,
    allowOsv = true,
    transport = runCommand,
    fetchImpl = globalThis.fetch,
    auditTimeoutMs = DEFAULT_AUDIT_TIMEOUT_MS,
    osvTimeoutMs = DEFAULT_OSV_TIMEOUT_MS,
    env = process.env,
  } = options;

  if (typeof registry !== 'string' || registry.trim() === '') {
    throw new Error(`audit 端点为空:registry 必须是有效 URL(未指定时由调用方从 .npmrc 解析)`);
  }
  const lock = readLockfile(lockPath);
  const { components } = lockComponents(lock);

  /** @type {object[]} */
  const sources = [];
  /** @type {Record<string, object>} */
  const scopes = {};
  for (const tree of TREES) {
    scopes[tree] = {
      status: STATUS_UNAVAILABLE,
      source: null,
      reason: allowOsv ? '尚无可用扫描源给出结论' : 'npm audit 未给出结论',
      vulnerabilityCount: 0,
      counts: countBySeverity([]),
      vulnerabilities: [],
    };
  }

  // ---- 源 1:npm audit(项目 .npmrc 指定的 npmmirror 端点)----
  if (allowNpmAudit) {
    /** @type {Map<string, object>} */
    const parsedByTree = new Map();
    for (const plan of buildAuditPlan(registry)) {
      const { command, args } = npmInvocation(plan.args);
      const result = await transport(command, args, { env, cwd: projectDir, timeoutMs: auditTimeoutMs });
      parsedByTree.set(plan.tree, parseAuditPayload({ tree: plan.tree, registry, result }));
    }
    const parsedList = TREES.map((tree) => parsedByTree.get(tree));
    const allOk = parsedList.every((parsed) => parsed?.status === STATUS_OK);
    sources.push({
      id: 'npm-audit',
      endpoint: registry,
      registrySource,
      status: allOk ? STATUS_OK : STATUS_UNAVAILABLE,
      reason: allOk
        ? null
        : [
            ...new Set(parsedList.map((parsed) => (parsed === undefined ? '未执行' : (parsed.reason ?? '未知原因')))),
          ].join(' / '),
      trees: {
        [TREE_PRODUCTION]: parsedByTree.get(TREE_PRODUCTION)?.status ?? STATUS_UNAVAILABLE,
        [TREE_ALL]: parsedByTree.get(TREE_ALL)?.status ?? STATUS_UNAVAILABLE,
      },
    });
    if (allOk) {
      for (const tree of TREES) {
        const findings = normalizeAuditVulnerabilities(parsedByTree.get(tree).payload);
        scopes[tree] = {
          status: STATUS_OK,
          source: 'npm-audit',
          reason: null,
          vulnerabilityCount: findings.length,
          counts: countBySeverity(findings),
          vulnerabilities: findings,
        };
      }
    }
  }

  // ---- 源 2:OSV 批量查询(可用替代源)----
  if (allowOsv) {
    if (typeof fetchImpl !== 'function') {
      sources.push({
        id: 'osv',
        endpoint: osvEndpoint,
        registrySource: null,
        status: STATUS_UNAVAILABLE,
        reason: '当前运行时没有 fetch 实现,无法访问 OSV',
        trees: null,
      });
    } else {
      const osv = await queryOsv({ components, endpoint: osvEndpoint, fetchImpl, timeoutMs: osvTimeoutMs });
      if (osv.status === STATUS_OK) {
        // 第二阶段:批量响应只给 id,严重度/修复版本要按 id 取详情(只对命中的公告取)
        const hitIds = new Set();
        for (const ids of osv.idsByLockPath.values()) for (const id of ids) hitIds.add(id);
        const { byId, failures } = await loadOsvDetails({
          ids: [...hitIds].sort(),
          endpoint: osvEndpoint,
          fetchImpl,
          timeoutMs: osvTimeoutMs,
        });
        /** @type {Record<string, object[]>} */
        const perTree = { [TREE_PRODUCTION]: [], [TREE_ALL]: [] };
        for (const component of components) {
          for (const id of osv.idsByLockPath.get(component.lockPath) ?? []) {
            const finding = normalizeOsvVulnerability(byId.get(id) ?? { id }, component);
            perTree[TREE_ALL].push(finding);
            if (component.dependencyScope === 'production') perTree[TREE_PRODUCTION].push(finding);
          }
        }
        sources.push({
          id: 'osv',
          endpoint: osvEndpoint,
          registrySource: null,
          status: STATUS_OK,
          reason: null,
          trees: { [TREE_PRODUCTION]: STATUS_OK, [TREE_ALL]: STATUS_OK },
          advisoryCount: hitIds.size,
          detailFailures: failures,
        });
        for (const tree of TREES) {
          if (scopes[tree].status === STATUS_OK) continue;
          const sorted = sortFindings(perTree[tree]);
          scopes[tree] = {
            status: STATUS_OK,
            source: 'osv',
            reason: null,
            vulnerabilityCount: sorted.length,
            counts: countBySeverity(sorted),
            vulnerabilities: sorted,
          };
        }
      } else {
        sources.push({
          id: 'osv',
          endpoint: osvEndpoint,
          registrySource: null,
          status: STATUS_UNAVAILABLE,
          reason: osv.reason,
          trees: null,
        });
      }
    }
  }

  const scan = {
    schema: SCA_SCHEMA,
    registry,
    registrySource,
    osvEndpoint: allowOsv ? osvEndpoint : null,
    lockfile: lockLabel,
    componentCount: components.length,
    sources,
    scopes,
  };
  const verdict = evaluateSca(scan);
  return { ...scan, status: verdict.status, blocking: verdict.blocking, notes: verdict.notes };
}

/* ---------- CLI ---------- */

/**
 * 把报告渲染成人读日志(顺序固定:不可用诊断 → 阻断项 → 备注 → 逐树结论 → 汇总)。
 * @param {ScaReport} report runScaScan 的结果
 * @returns {string[]} 日志行
 */
export function formatScaLog(report) {
  const lines = [];
  for (const source of report.sources) {
    if (source.status === STATUS_UNAVAILABLE) {
      lines.push(`[sca:unavailable] 扫描源 ${source.id}(${source.endpoint})不可用:${source.reason ?? '未提供原因'}`);
    }
  }
  for (const note of report.notes) {
    if (note.startsWith('扫描源不可用:')) continue;
    lines.push(`[sca:warn] ${note}`);
  }
  for (const problem of report.blocking) {
    lines.push(`[sca:fail] ${problem}`);
  }
  if (report.status === STATUS_UNAVAILABLE) {
    lines.push('[sca:fail] SCA 未能判定依赖漏洞状态(全部扫描源不可用);这不等于「无漏洞」,拒绝以「通过」放行');
    return lines;
  }
  for (const tree of TREES) {
    const result = report.scopes[tree];
    if (result.status !== STATUS_OK) {
      lines.push(`[sca:unavailable] ${TREE_LABELS[tree]}无扫描源给出结论:${result.reason ?? '未提供原因'}`);
      continue;
    }
    if (result.vulnerabilityCount === 0) {
      lines.push(`[sca:ok] ${TREE_LABELS[tree]}(源 ${result.source})扫描 ${report.componentCount} 个组件,未发现漏洞`);
    } else {
      lines.push(`[sca:warn] ${TREE_LABELS[tree]}(源 ${result.source})命中 ${result.vulnerabilityCount} 条:`);
      for (const finding of result.vulnerabilities) {
        const origin = finding.severitySource === undefined || finding.severitySource === 'database_specific' || finding.severitySource === 'npm-audit' ? '' : ` [严重度来源:${finding.severitySource}]`;
        lines.push(`  - ${finding.name} ${finding.severity.toUpperCase()}${origin} — ${finding.fix};${finding.advisories.map((item) => item.title).join('; ') || '无公告标题'}`);
      }
    }
  }
  return lines;
}

export async function main(argv = []) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  let options;
  try {
    options = parseSupplyArgs(argv, {
      booleans: ['no-osv', 'no-npm-audit', 'print', 'help'],
      values: ['lock', 'registry', 'osv-endpoint', 'output'],
      usage: USAGE,
    });
  } catch (error) {
    console.error(`[sca:fail] ${errorMessage(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }
  const lockPath = path.resolve(projectRoot, typeof options.lock === 'string' ? options.lock : 'package-lock.json');
  const outputPath = path.resolve(projectRoot, typeof options.output === 'string' ? options.output : path.join(SUPPLY_OUTPUT_DIR, 'sca-report.json'));
  const lockLabel = toPosix(path.relative(projectRoot, lockPath)) || 'package-lock.json';
  const resolved = resolveRegistry(projectRoot, process.env);

  let report;
  try {
    report = await runScaScan({
      lockPath,
      lockLabel,
      registry: typeof options.registry === 'string' ? options.registry : resolved.registry,
      registrySource: typeof options.registry === 'string' ? '--registry 参数' : resolved.source,
      osvEndpoint: typeof options['osv-endpoint'] === 'string' ? options['osv-endpoint'] : undefined,
      allowOsv: options['no-osv'] !== true,
      allowNpmAudit: options['no-npm-audit'] !== true,
    });
  } catch (error) {
    console.error(`[sca:fail] 扫描未完成:${errorMessage(error)}`);
    return 1;
  }

  writeJson(outputPath, report);
  if (options.print === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  for (const line of formatScaLog(report)) console.log(line);
  console.log(`[sca] 报告已写入:${toPosix(path.relative(projectRoot, outputPath))}(lockfile ${lockLabel})`);
  return report.blocking.length > 0 ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
