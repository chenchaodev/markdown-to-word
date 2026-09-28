// 测试树临时目录清理收敛门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// 守护的契约(test/common/temp-resource.js 的 removeTree 是测试树唯一的目录删除助手):
// 临时目录是**一次性沙盒**,Windows 上「进程刚退出、句柄未释放」会让裸 fs.rm 直接抛
// EBUSY/EPERM,把段判成失败;而吞错的写法又把删不掉的目录静默留在系统临时区,谁也
// 看不出。removeTree 两头都堵:EBUSY/EPERM 退避重试 + **删后复查是否真的消失**,
// 不抛错而是把结果交回调用方,由调用方决定「暴露还是忽略」。
//
// 本门禁守的是**收口面**:测试树里不得再出现裸写的目录删除(`fs.rm` / `fs.rmSync` /
// `rmdir` 配 `recursive`)。判定输入是**文件文本**而非测试执行结果:门禁要在
// 「有人新写了一行裸目录删除」的最早时刻就红,不必等 tsc 或跑段。正则 + 括号配平,
// 理由同 check-test-numbering.mjs / check-import-boundary.mjs(纯 Node、零新增依赖)。
//
// 用法:
//   node scripts/check-temp-cleanup.mjs
//   node scripts/check-temp-cleanup.mjs --help
//
// ---- 扫描面(显式清单,与测试发现面一致,不多也不少)----
//   test/segments/**/*.test.js · test/main/**/*.test.js · test/renderer/**/*.test.js
//   test/common/**/*.js · test/tools/**/*.{js,mjs}
// 排除 test/fixtures(被测样例数据本身,不是清理动作)。
// **不扫 scripts/**:那里是生产/门禁脚本,rmSync 是被测语义本身(clean-artifacts 的
// 保护区、gate-probes/sandbox.mjs 的 junction 摘除),不是「临时目录清理」。
// scripts/gate-probes/sandbox.mjs 的 removeJunction 因此登记为按设计不在扫描面的条目。
//
// ---- 匹配规则:调用形 + 选项形 ----
// 形如 `<可选接收者>.rm|rmSync|rmdir|rmdirSync(<实参>)` 且实参里出现 `recursive`。
// 三条设计约束(均为实测结论,改规则前先跑本脚本看命中面,别凭直觉放宽):
//   1. **只看 `recursive` 形态**:不带 recursive 的删除在本库是**单文件**删除
//      (产物、清单、日志、夹具文件)。单文件删除没有 ENOTEMPTY/EBUSY 的树删除问题,
//      套 removeTree 是错配(removeTree 内部走 `fs.rmSync(target, { recursive: true,
//      force: true, … })`,拿它删单个文件只是恰好可用,却让「这是目录清理」的语义
//      失真)。故按 `recursive` 划界,不是按 `rm` 这个词划界。
//   2. **文件维度不可用**:test/main/settings.test.js 里既有该收口的沙盒清理,也有
//      刻意保留的单目标删除(settings.json 在文件与目录之间互换),按文件放行会漏掉
//      真违规,按文件判红会误伤。只剩「文件 × 首参」这一条内容组合可用。
//   3. **不剥注释与字符串**:已知边界 —— 正则字面量、字符串里的 `rmSync(...)`
//      (install-smoke 段往沙盒注入的判定脚本源码)会被算作命中。这是有意的保守方向:
//      宁可多报一条让人看一眼,也不漏扫。install-smoke 那处已在 ALLOWLIST 登记。
//
// ---- 白名单会腐烂 ----
// 白名单按**内容**匹配(文件 × 首参形态 + 接收者形态),**不按行号**:测试树在并发改动,
// 行号会漂移,按行号登记的条目会静默变成「放行别的调用」。`cold` 条目按设计零命中
// (该形态在扫描面内不存在,登记它是为了把「为什么这里不能改」写进门禁,防止有人按
// 「看起来是重复」把它清掉),输出里与实命中分开计数。新增条目必须在 `why` 里写明
// 「为什么这不是沙盒目录清理」——没有依据的条目等于把门禁关掉。
//
// ---- 正面锚点(防空门禁)----
// 规则写错会表现为「恒绿」,而恒绿是这类文本门禁最危险的失效形态(没人会去看一个
// 总是 exit 0 的脚本)。故本脚本内建 SELF_PROBE:把某个**已收口**的调用点在收口**之前**
// 的源码形态冻结在文件里,用同一套判定器跑一遍,断言它必须被命中;同时断言收口**之后**
// 的形态不再被命中。探针跑不通即 exit 1 —— 探针是规则本身的回归测试,不是装饰。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const USAGE = '用法: node scripts/check-temp-cleanup.mjs [--help]';

/** 扫描目标:目录 + 该目录下的文件判定(见文件头「扫描面」) */
export const SCAN_TARGETS = Object.freeze([
  { dir: 'test/segments', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/main', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/renderer', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/common', accept: (name) => name.endsWith('.js') },
  { dir: 'test/tools', accept: (name) => /\.(js|mjs)$/.test(name) },
]);

/** 显式排除目录(仓库相对 POSIX 路径;前缀匹配)。理由见文件头「扫描面」。 */
export const EXCLUDED_DIRS = Object.freeze(['test/fixtures']);

/**
 * 扫描文件数下限:walker 静默失效(目录改名/权限)会退化成「零文件全过」,那是假通过。
 * 留一半余量。
 */
export const MIN_SCAN_FILES = 50;

/** 诊断片段的最大长度(超长截断,避免刷屏) */
const SNIPPET_MAX = 88;

// ---- 判定原语 ----

/** 实参里的括号深度:实参文本可含括号(对象字面量、函数实参),故按深度配平 */
const ARGS = String.raw`(?:[^()]|\((?:[^()]|\([^()]*\))*\))*`;

/**
 * 目录删除调用:可选接收者 + rm/rmSync/rmdir/rmdirSync + 配平的实参。
 * 前瞻断言排除 `rm2`/`rmdirExtra` 这类更长标识符;接收者可省(具名 import 的裸调用)。
 * 注:`removeTree(` 不会命中 —— `rm` 之后紧跟的是 `oveTree` 而非 `(`。
 */
export const DELETE_CALL_RE = new RegExp(
  String.raw`(?<![\w$.])(?:[A-Za-z_$][\w$]*\s*\.\s*)?rm(?:Sync)?\s*\(` + ARGS + String.raw`\)`,
  'g',
);
export const RMDIR_CALL_RE = new RegExp(
  String.raw`(?<![\w$.])(?:[A-Za-z_$][\w$]*\s*\.\s*)?rmdir(?:Sync)?\s*\(` + ARGS + String.raw`\)`,
  'g',
);

/** `recursive` 键:允许 `recursive: true` 与简写 `{ recursive }` 两种形态 */
const RECURSIVE_RE = /\brecursive\b/;

/** 首参形态:取实参里第一个顶层标识符(去掉可选的 `path.join(...)` 包裹后仍取其首段) */
const FIRST_ARG_RE = /^\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?([A-Za-z_$][\w$]*)/;

// ---- 白名单(逐条写明依据;按内容匹配,不按行号)----

/**
 * @typedef {object} DeleteHit 一处命中
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 行号(1 起)
 * @property {string} callee 命中的调用名(含接收者,如 `fs.rmSync`)
 * @property {string} args 实参原文
 * @property {string} firstArg 首参标识符
 * @property {string} lineSource 命中所在源码行
 */

/**
 * @typedef {object} AllowEntry 白名单条目
 * @property {string} id 条目 id(失效提示里点名用)
 * @property {string} file 生效文件;null = 不限文件
 * @property {(hit: DeleteHit) => boolean} match 内容判定
 * @property {string} why 依据:为什么这不是沙盒目录清理
 * @property {boolean} [cold] true = 按设计不在扫描面内,零命中是预期(输出里分开计数)
 */

/**
 * 首参落在给定名单里(空名单 = 不限)。
 * @param {string[]} names 允许的首参标识符
 * @returns {(hit: DeleteHit) => boolean}
 */
function firstArgIn(names) {
  if (names.length === 0) return () => true;
  return (hit) => names.includes(hit.firstArg);
}

/** @type {readonly AllowEntry[]} */
export const ALLOWLIST = Object.freeze([
  {
    id: 'temp-resource-removeTree-impl',
    file: 'test/common/temp-resource.js',
    match: (hit) => hit.callee === 'fs.rmSync' && hit.firstArg === 'target',
    why: '本门禁的收口终点本身:removeTree 是测试树唯一的目录删除助手,它实现里那行 '
      + '`fs.rmSync(target, { recursive: true, force: true, maxRetries, retryDelay })` '
      + '就是被收口到的形态。它是唯一允许的裸写目录删除。',
  },
  {
    id: 'userdata-deliberate-duplicate',
    file: 'test/common/userdata.js',
    match: (hit) => hit.callee === 'fs.rmSync' && hit.firstArg === 'dir',
    why: '**刻意的重复**:userdata.js 必须保持零内部依赖 —— install-smoke 段把它逐字节复制进'
      + '沙盒,由 scripts/smoke-proc.mjs 按相对路径 import,若它 import 同目录的 temp-resource.js,'
      + '沙盒里那份副本就解析不到该模块、该段当场红。故它自持一份重试参数,不能收口。',
  },
  {
    id: 'install-smoke-electron-fs-bypass',
    file: 'test/segments/install-smoke.test.js',
    match: () => true,
    why: '本文件整体归另一条工作线管,且它的删除面是 Electron fs 层对「指向目录的链接」判定与'
      + 'node 不同的**刻意绕行**:L343 是段内沙盒删除、L349 是往沙盒注入的判定脚本源码里那行'
      + '`require("fs").rmSync(…)`(用纯 node 子进程删,绕开 asar 虚拟 fs)、L816 是沙盒里的'
      + 'release 目录。三者都不是「测试树的临时目录清理」,收口会改掉被绕行的语义。',
  },
  {
    id: 'settings-single-target-swap',
    file: 'test/main/settings.test.js',
    match: firstArgIn(['settingsFile']),
    why: '单目标删除,不是目录树清理:settings.json 是**产物文件**,测试刻意把它在文件与目录'
      + '之间来回替换来触发 rename 失败(L920 先 mkdir 成目录),`recursive: true` 只是让'
      + '同一处调用在两种形态下都能工作。同段的沙盒目录(`dir`)已收口。',
  },
  {
    id: 'ui-state-single-target-swap',
    file: 'test/main/ui-state.test.js',
    match: firstArgIn(['uiFile']),
    why: '同 settings:ui-state.json 是产物文件,同样被刻意换成目录以触发写失败,'
      + '`recursive: true` 是防御性写法,不是目录树清理。',
  },
  {
    id: 'output-allowlist-single-target-swap',
    file: 'test/main/output-allowlist.test.js',
    match: firstArgIn(['artifact']),
    why: '单目标删除,不是目录树清理:`artifact` 是产物文件路径,测试刻意先删文件、再 mkdir 成'
      + '同名目录,以证明白名单的「同名目录被顶替」也拒 —— 那个目录只有一层,删它不需要'
      + '退避重试,套 removeTree 属错配。同段的沙盒目录(`dir`)已收口。',
  },
  {
    id: 'input-budget-selfloop-junction-async-only',
    file: 'test/main/input-budget.test.js',
    // 只放行**异步** fs.rm:同步 rmSync 形态仍判红,故这条不会退化成「整文件放行」
    match: (hit) => hit.callee === 'fs.rm' && hit.firstArg === 'dir',
    why: '**实测收敛会回归**(2026-09-29,本机):本段沙盒里造了 junction 环'
      + '(L64 `fs.symlink(root, root/sub/loop, "junction")`,自指)。Electron 的 fs 层删不掉含自指'
      + 'junction 的树 —— `fs.rmSync(dir, { recursive: true, force: true, … })` 抛 Unknown error 且'
      + '目录残留,而同一目录用**异步** `fs.rm`、或在纯 node 下,都能删干净(隔离实验:仅「自指环 + '
      + 'Electron + 同步 rmSync」三者同时成立才失败,指他处的 junction 两形态都正常)。'
      + '实测本段连跑 3 次:收口版每次残留整棵沙盒,原写法 0 残留。'
      + 'removeTree 的内核正是 fs.rmSync(其头注已记「不做 spawn 纯 node 子进程删除的兜底」),'
      + '故本段**不能**收口 —— 这是本门禁首次跑出的第 7 类刻意保留。',
  },
  {
    id: 'clean-artifacts-occupied-fixture',
    file: 'test/segments/clean-artifacts-gate.test.js',
    match: () => false,
    cold: true,
    why: 'L555-592 段**刻意**用 CWD 占用夹具复现「删不掉」:断言错误码属 EPERM/EBUSY/EACCES 族、'
      + '目标仍在、释放后可重试。该段自己不发任何删除调用(删除发生在子进程的被测脚本里),'
      + '故按设计零命中;登记它是为了挡住「顺手给这段也加重试/吞错」—— 那会直接改掉被测语义。',
  },
  {
    id: 'test-common-helpers-illegal-retry-params',
    file: 'test/segments/test-common-helpers.test.js',
    match: () => false,
    cold: true,
    why: 'L344/L369 **刻意**给 removeTree 喂非法与极小重试参数(maxRetries:-1 / maxRetries:1),'
      + '以证明「失败如实上报」而不是吞掉。本段是助手的行为断言,不是清理动作。',
  },
  {
    id: 'atomic-json-stubbed-epcodes',
    file: 'test/main/atomic-json.test.js',
    match: () => false,
    cold: true,
    why: 'L193/L219 注入的 EPERM/EBUSY 是**桩**(makeFlakyRename 造出的假 transport),不是真删。'
      + '被测的是写入器的退避策略,给桩加重试或吞错会改掉断言对象。本段的沙盒目录已收口。',
  },
  {
    id: 'atomic-json-durability-stubbed-epcodes',
    file: 'test/main/atomic-json-durability.test.js',
    match: () => false,
    cold: true,
    why: '同 atomic-json:注入的 EPERM/EBUSY 是桩,不是真删;断言的是 fsync 耐久性。'
      + '本段的沙盒目录已收口。',
  },
  {
    id: 'renderer-pure-error-code-literals',
    file: 'test/segments/renderer-pure.test.js',
    match: () => false,
    cold: true,
    why: 'L183 的 EPERM/EBUSY 是**错误码字面量**(渲染层纯函数的失败分支断言),不是删除动作。',
  },
  {
    id: 'artifact-commit-error-code-literals',
    file: 'test/main/artifact-commit.test.js',
    match: () => false,
    cold: true,
    why: 'L226-291 的 EPERM/EBUSY 是错误码字面量(硬链接原子提交失败分支的桩),不是删除动作。'
      + '本段的沙盒目录已收口。',
  },
  {
    id: 'gate-probes-junction-removal',
    file: 'scripts/gate-probes/sandbox.mjs',
    match: () => false,
    cold: true,
    why: 'removeJunction 是 **junction 的 Windows 绕行**:同一段代码在纯 node 下可用、在 Electron 里'
      + '会抛 `Path is a directory`,故按 unlinkSync → rmdirSync → 纯 node 子进程三级降级,'
      + '且三条都**非递归**(只摘链接,绝不碰真实 node_modules 目录)。scripts/ 整体不在本门禁'
      + '扫描面内(那里 rmSync 是被测语义本身),登记为按设计零命中。',
  },
]);

// ---- 正面锚点(防空门禁)----

/**
 * 自检探针:每个条目给「收口前的形态」与「收口后的形态」,断言同一套判定器对前者命中、
 * 对后者不命中。取自真实收口点(dist-manifest-gate 的 withTempDir、artifact-commit 的
 * 段末清理、test/main 的吞错批量形态),故探针本身也守着「收口面」的形状。
 * @type {readonly { id: string; before: string; after: string }[]}
 */
export const SELF_PROBE = Object.freeze([
  {
    id: 'bare-rmSync-in-finally',
    before: '  } finally {\n    fs.rmSync(dir, { recursive: true, force: true });\n  }',
    after: '  } finally {\n    const outcome = removeTree(dir);\n    if (!outcome.ok) throw new Error(outcome.error?.message);\n  }',
  },
  {
    id: 'swallow-catch-rm',
    before: '    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);',
    after: '    removeTree(dir);',
  },
  {
    id: 'retry-without-recheck',
    before: '    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });',
    after: '    const outcome = removeTree(dir, { retryDelay: 200 });\n    if (!outcome.ok) throw new Error("x");',
  },
  {
    id: 'single-file-delete-is-not-flagged',
    // 反向锚点:不带 recursive 的单文件删除**不得**被命中(见「匹配规则」第 1 条)
    before: '    await fs.rm(artifact, { force: true });',
    after: '    await fs.rm(artifact, { recursive: true, force: true });',
  },
]);

/**
 * 对一段源码文本跑判定(纯函数,供 analyze 与 SELF_PROBE 共用 —— 两者必须走同一条路径,
 * 否则探针验的就不是真规则)。
 * @param {string} text 源码文本
 * @param {string} file 仅用于回填的仓库相对路径
 * @returns {DeleteHit[]}
 */
export function scanText(text, file = '<probe>') {
  /** @type {DeleteHit[]} */
  const hits = [];
  for (const re of [DELETE_CALL_RE, RMDIR_CALL_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const args = m[0].slice(m[0].indexOf('(') + 1, m[0].lastIndexOf(')'));
      if (!RECURSIVE_RE.test(args)) continue;
      const offset = m.index ?? 0;
      hits.push({
        file,
        line: text.slice(0, offset).split('\n').length,
        callee: m[0].slice(0, m[0].indexOf('(')).trim().replace(/\s+/g, ''),
        args: args.replace(/\s+/g, ' ').trim(),
        firstArg: FIRST_ARG_RE.exec(args)?.[1] ?? '<复杂实参>',
        lineSource: text.split('\n')[text.slice(0, offset).split('\n').length - 1] ?? '',
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

// ---- 扫描与判定 ----

/** 排除前缀判定(带 / 边界,避免 test/fixturesX 误判) */
function isExcluded(rel) {
  return EXCLUDED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * 递归列出该目录下参与扫描的文件(仓库相对 POSIX 路径,已排序)。
 * @param {string} relDir 仓库相对目录
 * @returns {string[]} 文件相对路径
 */
function listScannableFiles(relDir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(projectRoot, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (!entry.name.startsWith('.')) out.push(child);
    }
  };
  walk(relDir);
  return out;
}

/** 收集参与扫描的文件清单(按 SCAN_TARGETS 判定扩展名) */
export function listScanFiles() {
  const files = [];
  for (const target of SCAN_TARGETS) {
    for (const rel of listScannableFiles(target.dir)) {
      if (target.accept(path.posix.basename(rel))) files.push(rel);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** 诊断片段:压掉换行与多余空白,超长截断 */
function snippet(args) {
  return args.length > SNIPPET_MAX ? `${args.slice(0, SNIPPET_MAX)}…` : args;
}

/**
 * 扫描单个文件,返回其中的命中。
 * @param {string} rel 仓库相对 POSIX 路径
 * @returns {DeleteHit[]}
 */
export function scanFile(rel) {
  return scanText(readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8'), rel);
}

/**
 * 全树判定。allowCold 是白名单统计(按设计零命中的条目数),只作输出,不参与 exit code。
 * @returns {{ problems: DeleteHit[], allowHits: number, allowCold: number, files: number, staleAllow: string[], deleteCalls: number }}
 */
export function analyze() {
  const files = listScanFiles();
  /** @type {DeleteHit[]} */
  const problems = [];
  const allowUsed = new Set();
  let deleteCalls = 0;

  for (const rel of files) {
    for (const hit of scanFile(rel)) {
      deleteCalls += 1;
      const index = ALLOWLIST.findIndex(
        (entry) => (entry.file === null || entry.file === hit.file) && entry.match(hit),
      );
      if (index !== -1) {
        allowUsed.add(index);
        continue;
      }
      problems.push(hit);
    }
  }

  return {
    problems,
    allowHits: allowUsed.size,
    allowCold: ALLOWLIST.filter((entry) => entry.cold === true).length,
    files: files.length,
    deleteCalls,
    staleAllow: ALLOWLIST.filter((entry, index) => !allowUsed.has(index) && entry.cold !== true).map((entry) => entry.id),
  };
}

/**
 * 自检探针:对每个条目断言「收口前形态被命中 / 收口后形态不被命中」。
 * 探针不过即 exit 1(规则本身坏了,后面所有判定都不可信)。
 * @returns {{ id: string, ok: boolean, detail: string }[]}
 */
export function runSelfProbe() {
  return SELF_PROBE.map((probe) => {
    const beforeHits = scanText(probe.before);
    const afterHits = scanText(probe.after);
    // 第 4 条是反向锚点:语义相反(期望 before 不命中 / after 命中)
    const inverted = probe.id === 'single-file-delete-is-not-flagged';
    const ok = inverted
      ? beforeHits.length === 0 && afterHits.length > 0
      : beforeHits.length > 0 && afterHits.length === 0;
    return {
      id: probe.id,
      ok,
      detail: `收口前形态命中 ${beforeHits.length} 处 / 收口后形态命中 ${afterHits.length} 处`
        + `${inverted ? '(反向锚点:期望前者 0、后者 >0)' : '(期望前者 >0、后者 0)'}`,
    };
  });
}

export async function main(argv = []) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => !arg.startsWith('--'));
  if (unknown.length > 0) {
    console.error(`[temp-cleanup:fail] 无法识别的参数:${unknown.join(' ')}(${USAGE})`);
    return 1;
  }

  const probe = runSelfProbe();
  for (const item of probe) {
    const tag = item.ok ? 'ok' : 'fail';
    console.error(`[temp-cleanup:self-probe:${tag}] ${item.id}:${item.detail}`);
  }
  if (probe.some((item) => !item.ok)) {
    console.error('[temp-cleanup:fail] 自检探针未通过:判定规则与声明的收口面不符,此时的扫描结果不可信');
    return 1;
  }

  let result;
  try {
    result = analyze();
  } catch (error) {
    console.error(`[temp-cleanup:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (result.files < MIN_SCAN_FILES) {
    console.error(
      `[temp-cleanup:fail] 只扫到 ${result.files} 个文件(下限 ${MIN_SCAN_FILES}):扫描面或 walker 失效,`
      + '此时「零命中」是假通过,须先修扫描面',
    );
    return 1;
  }

  for (const id of result.staleAllow) {
    console.log(`[info] temp-cleanup:白名单条目本次零命中(可能已失效,请复核是否可删):${id}`);
  }

  if (result.problems.length > 0) {
    for (const hit of result.problems) {
      console.error(`[temp-cleanup:fail] ${hit.file}:${hit.line} → ${hit.callee}(${snippet(hit.args)})`);
    }
    console.error(
      `[temp-cleanup:fail] 测试树裸写目录删除扫描失败,共 ${result.problems.length} 项`
      + `(扫描 ${result.files} 个文件 / ${result.deleteCalls} 处目录删除;白名单 ${ALLOWLIST.length} 条,`
      + `本次命中 ${result.allowHits} 条,按设计零命中 ${result.allowCold} 条)`,
    );
    console.error(
      '[temp-cleanup:fail] 临时目录删除一律走 test/common/temp-resource.js 的 removeTree'
      + '(EBUSY/EPERM 退避重试 + 删后复查):原「删不掉就抛」的调用点显式判 `outcome.ok` 后再抛,'
      + '原「吞错」的调用点仍吞错但走助手。若确属刻意保留,请在 scripts/check-temp-cleanup.mjs 的 '
      + 'ALLOWLIST 加条目并写明依据(按内容匹配,勿按行号登记 —— 行号会随他处改动漂移)。'
      + '注意:删单个产物文件**不属本门禁范围**(不配 recursive),也不该套 removeTree。',
    );
    return 1;
  }

  console.log(
    `[ok] 测试树临时目录清理扫描通过:扫描 ${result.files} 个文件 / ${result.deleteCalls} 处目录删除,`
    + `无裸写;白名单 ${ALLOWLIST.length} 条(本次命中 ${result.allowHits} 条,按设计零命中 ${result.allowCold} 条);`
    + `自检探针 ${probe.length} 条全过`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'scripts', 'check-temp-cleanup.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}
