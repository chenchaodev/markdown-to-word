// GitHub Actions 引用固定门禁(action pin hygiene),无产物、可离线运行、exit 0/1。
//
// 为什么要有这道门禁 —— 它是对「action 固定 SHA」这一已知代价的补偿,不是重复劳动:
//   Dependabot 的**版本更新 PR**对「固定到 40 位 commit SHA」有效(SHA 变了它就能提 PR),
//   但**漏洞告警对 SHA 固定无效**:GitHub 官方文档明确说明,按 SHA 固定后 Dependabot
//   不再解析 action 的依赖图,被引用版本一旦出现已知漏洞,仓库不会收到任何告警。
//   也就是说,固定 SHA 换来了「上游无法重新指向我们的产物」,代价是「上游出漏洞时没人
//   叫你」。本门禁就是那个「叫你」的东西。它不假装自己是漏洞扫描器(那是 zizmor 的活,
//   且只作 CI 附加的非阻断审计,见 .github/workflows/ci.yml),只把两件人能做到、
//   机器能判定的事变成可执行断言:
//   1. 引用卫生:每处 `uses:` 必须是 40 位 commit SHA,且同行带 `# vX.Y.Z` 版本注释
//      —— 注释是「这个 SHA 到底是哪个版本」的唯一书面线索。缺了它,一次 Dependabot
//      升级之后没人说得清流水线在跑 action 的哪个版本,排查无从下手。
//   2. 版本基线:scripts/pinned-actions.baseline.json 登记每个 action 的期望 SHA 与
//      版本。SHA 或版本与基线不符即判红 —— 升级因此在 diff 里显式可见、可 review,
//      「悄悄换掉流水线里跑的 action」变成一件必须改基线、经人眼的事。
//   3. 同一 action 在不同 workflow 必须固定到同一个 SHA;同一个 SHA 不得被两个不同
//      action 复用(复制粘贴错的典型形态)。
//
// 判定输入是 workflow 文本(逐行正则),不联网、不引 YAML 解析器:门禁要在 npm ci
// 之前、在 tsc 之前跑,理由与做法同 check-import-boundary.mjs / check-ci-contract.mjs。
// 基线比对可用 --no-baseline 关闭(只保留引用卫生判定);默认开启,基线文件缺失判红
// ——「基线丢了」必须显式失败,否则这道补偿门禁会静默退化成半个门禁。
//
// 已知不覆盖(别误以为已覆盖):
//   - 上游 action 自身的漏洞与恶意变更:SHA 固定只能保证「跑的是审过的那份」,
//     审的动作版本是否安全靠版本基线 + 人工/zizmor 复核,本脚本不查漏洞库;
//   - 40 位 SHA 指向的 commit 真实性:脚本离线运行,校验不了该 SHA 是否真属于
//     声明的 tag,只能保证格式合法且与基线登记一致。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs } from './check-dist-manifest.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
  '用法: node scripts/check-pinned-actions.mjs [--workflows <dir>] [--baseline <file>] [--no-baseline]';

/** 默认基线文件(仓库相对路径) */
export const DEFAULT_BASELINE = 'scripts/pinned-actions.baseline.json';
/** 默认被扫描的 workflow 目录(仓库相对路径) */
export const DEFAULT_WORKFLOWS = '.github/workflows';
/** 基线文件 schema 版本(字段改名/语义变更时递增,不静默兼容旧形) */
export const BASELINE_SCHEMA = 1;

/**
 * `uses:` 事实的公共字段(与归类无关的部分)。
 * @typedef {object} UsesBase
 * @property {string} file 相对被扫描目录的 POSIX 路径
 * @property {number} line 1 基行号
 * @property {string} raw 原始行文本
 * @property {string} value uses 取值原文
 * @property {string} comment 行尾注释(已去空白)
 */

/**
 * @typedef {UsesBase & {kind: 'remote', repo: string, ref: string}} RemoteUse
 * @typedef {UsesBase & {kind: 'local', localPath: string}} LocalUse
 * @typedef {UsesBase & {kind: 'docker'}} DockerUse
 * @typedef {UsesBase & {kind: 'malformed'}} MalformedUse
 * @typedef {UsesBase & {kind: 'empty'}} EmptyUse
 */
/** @typedef {RemoteUse | LocalUse | DockerUse | MalformedUse | EmptyUse} UsesFact */

const WORKFLOW_EXTENSIONS = ['.yml', '.yaml'];

/** 40 位小写十六进制 commit SHA(大写 hex 不是 GitHub 认的 ref 写法,一并判红) */
export const SHA_RE = /^[0-9a-f]{40}$/;
/** 版本注释首 token:`vX.Y.Z` */
export const VERSION_RE = /^v\d+\.\d+\.\d+$/;

/**
 * 一行 `uses:`:`- uses: owner/repo@ref # vX.Y.Z`
 * 捕获组:1=引号 2=带引号的值 3=不带引号的值 4=行尾注释。
 * 要求 `uses` 位于行首(可带 `- ` 列表前缀),注释掉的示例行(`# - uses: ...`)不匹配。
 */
const USES_RE = /^[ \t]*(?:-[ \t]+)?uses[ \t]*:[ \t]*(?:(["'])(.*?)\1|([^\s#]+))[ \t]*(?:#[ \t]*(.*?))?[ \t]*$/;

/**
 * 抽出文本里全部 `uses:` 事实(纯文本,不引 YAML 解析器)。
 * @param {string} text workflow 源文本
 * @returns {{line: number, raw: string, value: string, comment: string}[]}
 */
export function parseUses(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = USES_RE.exec(lines[i]);
    if (m === null) continue;
    entries.push({
      line: i + 1,
      raw: lines[i],
      value: /** @type {string} */ (m[2] ?? m[3] ?? ''),
      comment: (m[4] ?? '').trim(),
    });
  }
  return entries;
}

/**
 * `uses:` 取值归类。
 * @param {string} value uses 取值原文
 * @returns {{kind: 'local'|'docker'|'remote'|'malformed'|'empty', repo?: string, ref?: string, localPath?: string}}
 */
export function classifyUse(value) {
  if (value === '') return { kind: 'empty' };
  if (value.startsWith('docker://')) return { kind: 'docker' };
  if (value.startsWith('./') || value.startsWith('../')) return { kind: 'local', localPath: value };
  const at = value.indexOf('@');
  // at <= 0 同时覆盖「没有 @」与「@ 前为空」两种畸形写法(如 `@v4`)
  if (at <= 0) return { kind: 'malformed' };
  return { kind: 'remote', repo: value.slice(0, at), ref: value.slice(at + 1) };
}

/**
 * 递归列出目录下的 workflow 文件(按 POSIX 相对路径排序,保证诊断顺序幂等)。
 * @param {string} dir 绝对目录
 * @returns {{abs: string, file: string}[]}
 */
export function listWorkflowFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (WORKFLOW_EXTENSIONS.includes(path.extname(entry.name))) {
        out.push({ abs, file: path.relative(dir, abs).split(path.sep).join('/') });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * 扫描目录,返回带归类结果的 `uses:` 事实列表(相对 dir 的 file 字段)。
 * @param {string} dir 绝对目录
 * @returns {UsesFact[]}
 */
export function collectUsages(dir) {
  /** @type {UsesFact[]} */
  const usages = [];
  for (const { abs, file } of listWorkflowFiles(dir)) {
    for (const entry of parseUses(readFileSync(abs, 'utf8'))) {
      usages.push(/** @type {UsesFact} */ ({ file, ...entry, ...classifyUse(entry.value) }));
    }
  }
  return usages;
}

/**
 * 解析并校验基线文件内容(纯函数,便于守护段直接喂合成内容)。
 * @param {unknown} raw JSON.parse 结果
 * @returns {{actions: Record<string, {sha: string, version: string}>, problems: string[]}}
 */
export function parseBaseline(raw) {
  const problems = [];
  /** @type {Record<string, {sha: string, version: string}>} */
  const actions = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { actions, problems: ['基线文件根节点必须是对象'] };
  }
  const doc = /** @type {Record<string, unknown>} */ (raw);
  if (doc.baselineSchema !== BASELINE_SCHEMA) {
    problems.push(`基线文件 baselineSchema 必须是 ${BASELINE_SCHEMA},实际 ${JSON.stringify(doc.baselineSchema)}`);
  }
  const table = doc.actions;
  if (typeof table !== 'object' || table === null || Array.isArray(table)) {
    problems.push('基线文件缺少 actions 对象(形状 { actions: { "owner/repo": { sha, version } } })');
    return { actions, problems };
  }
  for (const [repo, entry] of Object.entries(table)) {
    const where = `基线条目 ${repo}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${where} 必须是 { sha, version } 对象`);
      continue;
    }
    const { sha, version } = /** @type {Record<string, unknown>} */ (entry);
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
      problems.push(`${where} 的 sha 必须是 40 位小写十六进制,实际 ${JSON.stringify(sha)}`);
      continue;
    }
    if (typeof version !== 'string' || !VERSION_RE.test(version)) {
      problems.push(`${where} 的 version 必须是 vX.Y.Z 形式,实际 ${JSON.stringify(version)}`);
      continue;
    }
    actions[repo] = { sha, version };
  }
  return { actions, problems };
}

/** 注释首 token 里的版本号(取不到返回 null,不猜) */
export function commentVersion(comment) {
  const token = comment.split(/\s+/).filter((part) => part !== '')[0] ?? '';
  return VERSION_RE.test(token) ? token : null;
}

/**
 * 判定规则集中处(纯函数:usages + baseline → problems/info,便于守护段逐条覆盖)。
 * @param {UsesFact[]} usages uses 事实
 * @param {{actions: Record<string, {sha: string, version: string}>}|null} baseline
 * @param {{root?: string}} [options] root=本地 action 存在性判定的基准目录
 * @returns {{problems: string[], info: string[], stats: {remote: number, local: number, docker: number, repos: number}}}
 */
export function analyze(usages, baseline, { root = projectRoot } = {}) {
  const problems = [];
  const info = [];
  /** action → 该 action 被固定到的 SHA 集合(跨文件一致性) */
  const pinsByRepo = new Map();
  /** SHA → 使用它的 action 集合(复制粘贴错检测) */
  const reposBySha = new Map();
  let local = 0;
  let docker = 0;

  for (const usage of usages) {
    const where = `${usage.file}:${usage.line}`;
    if (usage.kind === 'docker') {
      docker += 1;
      continue;
    }
    if (usage.kind === 'empty') {
      problems.push(`${where} uses: 取值为空(漏写 action 引用)`);
      continue;
    }
    if (usage.kind === 'malformed') {
      problems.push(`${where} uses: ${usage.value} —— 引用形态非法(应为 owner/repo@ref)`);
      continue;
    }
    if (usage.kind === 'local') {
      local += 1;
      const target = path.resolve(root, usage.localPath);
      if (!existsSync(target)) {
        problems.push(`${where} uses: ${usage.value} —— 本地 action 路径不存在(拼错路径的流水线只会在 GitHub 上报错)`);
      }
      continue;
    }

    const { repo, ref } = usage;
    if (!SHA_RE.test(ref)) {
      problems.push(
        `${where} uses: ${usage.value} —— 未固定到 40 位 commit SHA(当前 ref=${ref});`
          + '浮动 tag/branch 会让上游随时把这条引用重新指向任意产物',
      );
    }
    const version = commentVersion(usage.comment);
    if (version === null) {
      problems.push(
        `${where} uses: ${usage.value} —— 缺少「# vX.Y.Z」版本注释(当前注释「${usage.comment}」);`
          + '没有版本线索,一次 Dependabot 升级后无法从源码判断流水线在跑哪个版本的 action',
      );
    }

    if (SHA_RE.test(ref)) {
      if (!pinsByRepo.has(repo)) pinsByRepo.set(repo, new Map());
      const seen = /** @type {Map<string, string[]>} */ (pinsByRepo.get(repo));
      const sites = seen.get(ref) ?? [];
      sites.push(where);
      seen.set(ref, sites);
      if (!reposBySha.has(ref)) reposBySha.set(ref, new Set());
      /** @type {Set<string>} */ (reposBySha.get(ref)).add(repo);
    }
  }

  for (const [repo, seen] of pinsByRepo) {
    if (seen.size > 1) {
      const detail = [...seen.entries()].map(([sha, sites]) => `${sha.slice(0, 12)}…@${sites.join('/')}`).join(' vs ');
      problems.push(`action ${repo} 被固定到多个不同 SHA(${detail});同一 action 在不同 workflow 必须同版本,否则一次运行里混着两个版本`);
    }
  }
  for (const [sha, repos] of reposBySha) {
    if (repos.size > 1) {
      problems.push(`SHA ${sha} 被 ${[...repos].sort().join('、')} 共同使用 —— 一个 commit 不可能同时属于多个 action,这是复制粘贴错的典型形态`);
    }
  }

  if (baseline !== null) {
    const used = new Set();
    for (const usage of usages) {
      if (usage.kind !== 'remote') continue;
      const { repo } = usage;
      const expected = baseline.actions[repo];
      if (expected === undefined) {
        problems.push(`${usage.file}:${usage.line} 引用的 action ${repo} 未登记在版本基线内(须在 ${DEFAULT_BASELINE} 补条目并人工确认版本)`);
        continue;
      }
      used.add(repo);
      if (usage.ref !== expected.sha) {
        problems.push(
          `${usage.file}:${usage.line} ${repo} 的 SHA 与基线不符(当前 ${usage.ref},基线 ${expected.sha});`
            + '换 action 版本必须同 PR 改基线,让这次升级在 diff 里显式可见',
        );
      }
      const version = commentVersion(usage.comment);
      if (version !== null && version !== expected.version) {
        problems.push(
          `${usage.file}:${usage.line} ${repo} 的版本注释与基线不符(当前 ${version},基线 ${expected.version});`
            + '注释与基线不一致即等于版本线索不可信',
        );
      }
    }
    for (const repo of Object.keys(baseline.actions).sort()) {
      if (!used.has(repo)) {
        problems.push(`基线条目 ${repo} 已无任何 workflow 引用(引用删除后须同步删基线,否则基线会掩盖「这个 action 已经不用了」)`);
      }
    }
  } else {
    info.push('基线比对已关闭(--no-baseline):只做引用卫生判定,action 版本漂移无人拦截');
  }

  return {
    problems,
    info,
    stats: {
      remote: pinsByRepo.size,
      local,
      docker,
      repos: [...pinsByRepo.keys()].sort().length,
    },
  };
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help', 'no-baseline'], values: ['workflows', 'baseline'] });
  } catch (error) {
    console.error(`[pinned-actions:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const workflowsDir = path.resolve(projectRoot, options.workflows ?? DEFAULT_WORKFLOWS);
  if (!existsSync(workflowsDir)) {
    console.error(`[pinned-actions:fail] workflow 目录不存在:${workflowsDir}(门禁无事可判会报绿假象,判红)`);
    return 1;
  }

  let baseline = null;
  if (options['no-baseline'] !== true) {
    const baselinePath = path.resolve(projectRoot, options.baseline ?? DEFAULT_BASELINE);
    if (!existsSync(baselinePath)) {
      console.error(
        `[pinned-actions:fail] 版本基线文件不存在:${path.relative(projectRoot, baselinePath)}`
          + '(基线丢失必须显式失败;确需只做引用卫生判定请传 --no-baseline)',
      );
      return 1;
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(baselinePath, 'utf8'));
    } catch (error) {
      console.error(`[pinned-actions:fail] 版本基线文件不可解析:${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const parsed = parseBaseline(raw);
    if (parsed.problems.length > 0) {
      for (const problem of parsed.problems) console.error(`[pinned-actions:fail] ${problem}`);
      console.error(`[pinned-actions:fail] 版本基线文件不合规,共 ${parsed.problems.length} 项`);
      return 1;
    }
    baseline = { actions: parsed.actions };
  }

  let usages;
  try {
    usages = collectUsages(workflowsDir);
  } catch (error) {
    console.error(`[pinned-actions:fail] 扫描 workflow 失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  // 扫描不到任何 uses: 说明目录/正则失效,门禁会以「零违规」报绿 —— 判红防空过
  if (usages.length === 0) {
    console.error(`[pinned-actions:fail] 在 ${path.relative(projectRoot, workflowsDir) || '.'} 未扫到任何 uses: 引用(正则或目录失效,判红防空过)`);
    return 1;
  }

  const result = analyze(usages, baseline, { root: projectRoot });
  for (const line of result.info) console.log(`[info] pinned-actions:${line}`);
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[pinned-actions:fail] ${problem}`);
    console.error(`[pinned-actions:fail] action 引用固定自检失败,共 ${result.problems.length} 项`);
    return 1;
  }
  const baselineText = baseline === null
    ? '未比对版本基线(--no-baseline)'
    : `版本基线一致(${Object.keys(baseline.actions).sort().join('、')})`;
  console.log(
    `[ok] action 引用固定自检通过:${usages.length} 处 uses(远程 action ${result.stats.repos} 种,全部 40 位 commit SHA + 「# vX.Y.Z」版本注释;`
      + `本地 action ${result.stats.local} 处,容器引用 ${result.stats.docker} 处);${baselineText}`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
