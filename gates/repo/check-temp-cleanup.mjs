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
//   node gates/repo/check-temp-cleanup.mjs
//   node gates/repo/check-temp-cleanup.mjs --help
//
// ---- 扫描面(单一来源:shared/test-common-surface.js)----
//   test/core/**/*.test.js · test/main/**/*.test.js · test/renderer/**/*.test.js
//   test/gates/**/*.test.js · test/common/**/*.{js,mjs}
// 排除 test/fixtures(被测样例数据本身,不是清理动作)。
// **不扫 gates/ tools/**:那里是生产/门禁脚本,rmSync 是被测语义本身(gates/artifacts/
// clean-artifacts.mjs 的保护区、gate-probes/sandbox.mjs 的 junction 摘除),不是「临时目录清理」。
// gates/probe/gate-probes/sandbox.mjs 的 removeJunction 因此登记为按设计不在扫描面的条目。
// 清单与 walker(递归列目录)都从单源取,本文件不再自持一份:同一份清单写两遍的代价是
// 「新增测试子目录要改 N 处,漏改的那处扫不到且静默恒绿」。
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
// ---- 第二条规则:调用点的可选参数用法 ----
// 第一条规则守「删除动作的形态」(裸写 vs 走助手);本条守**助手自己**被怎么调用。
// 缺口:`removeTree` / `removeFile` 的第二实参是 `{ maxRetries, retryDelay }`,而调用点
// 传什么一直无人校验 —— 传错只在运行期以「段莫名判红」的形式暴露,且极难归因。
// 已实测的三类真实错误用法(Node v24.18.0,Windows):
//   1. **非对象**(`removeTree(dir, 5)` / `removeTree(dir, "x")`):`options.maxRetries` 取到
//      undefined,`??` 兜底成默认值 —— 调用点「以为」覆盖了重试,实则静默用默认,无任何报错。
//   2. **非法值**(`maxRetries: -1` / `NaN` / `Infinity`):Node 的 `validateRmOptionsSync`
//      抛 `ERR_OUT_OF_RANGE`(实测:非递归与递归两种形态都抛),段当场红但错误消息指向
//      助手内部,看不出是哪个调用点传错。
//   3. **未知键**(`{ maxRetries: 5, force: true }` / 拼错的 `maxRetry`):静默忽略,
//      与「没传」不可区分 —— 属于「以为生效实则没生效」,同第 1 类。
// 故本条判定:**凡出现第二实参,必须是对象字面量;其键只能是 maxRetries / retryDelay;
// 键的值必须是非负有限数字字面量。** 第二实参缺省(`removeTree(dir)`)是合法且推荐的写法。
//
// 为何不要求「不传非空对象」:`{ retryDelay: 200 }` 是全树既有且正当的用法(Windows 句柄
// 释放慢的段主动调大退避基数),判红会误伤 8 处真调用点。规则只卡**形状与取值**。
//
// 为何不查「传了 options 却被门禁白名单掩盖」:白名单按「文件 × 首参」放行**删除动作**,
// 与第二实参的取值正交 —— 一个被白名单放行的删除点仍会被本规则独立判红。两条规则不互相遮掩。
//
// ---- 正面锚点(防空门禁)----
// 规则写错会表现为「恒绿」,而恒绿是这类文本门禁最危险的失效形态(没人会去看一个
// 总是 exit 0 的脚本)。故本脚本内建 SELF_PROBE:把某个**已收口**的调用点在收口**之前**
// 的源码形态冻结在文件里,用同一套判定器跑一遍,断言它必须被命中;同时断言收口**之后**
// 的形态不再被命中。探针跑不通即 exit 1 —— 探针是规则本身的回归测试,不是装饰。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lexSource } from '../../shared/copy-closure.js';
import {
  checkSegmentMirrors,
  checkSurfaceEquality,
  formatMirrorMismatch,
  formatSurfaceMismatch,
  judgeScanFloor,
  listScanFiles,
} from '../../shared/test-common-surface.js';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE = '用法: node gates/repo/check-temp-cleanup.mjs [--help]';

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

// ---- 第二条规则的判定原语(助手调用点的可选参数用法)----

/** 助手名(removeTree = 目录 / removeFile = 单文件);两者共用同一套重试语义,故同规则 */
export const HELPER_NAMES = Object.freeze(['removeTree', 'removeFile']);

/**
 * 助手调用点:`<接收者>.`removeTree|removeFile(` + 配平的实参。
 * 与 DELETE_CALL_RE 同构(同样的 lookbehind 与 ARGS 配平),区别只在被匹配的标识符。
 */
export const HELPER_CALL_RE = new RegExp(
  String.raw`(?<![\w$.])(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:removeTree|removeFile)\s*\(` + ARGS + String.raw`\)`,
  'g',
);

/** 助手允许的选项键(与 temp-resource.js 的 RemoveOptions 单一来源一致) */
export const HELPER_OPTION_KEYS = Object.freeze(['maxRetries', 'retryDelay']);

/** 合法的取值形态:非负有限数字字面量(整数或小数均可,不含负号/NaN/Infinity/变量) */
const HELPER_OPTION_VALUE_RE = /^\d+(?:\.\d+)?$/;

/**
 * 按顶层逗号切分实参(实参可含嵌套的 ()/[]/{}),用于取「第二实参」。
 * @param {string} args 实参原文(不含外层括号)
 * @returns {string[]} 顶层实参
 */
function splitTopLevelArgs(args) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out;
}

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
    file: 'shared/userdata.js',
    match: (hit) => hit.callee === 'fs.rmSync' && hit.firstArg === 'dir',
    why: '**刻意的重复**:userdata.js 必须保持零内部依赖 —— install-smoke 段把它逐字节复制进'
      + '沙盒,由 gates/smoke/smoke-proc.mjs 按相对路径 import,若它 import 同目录的 temp-resource.js,'
      + '沙盒里那份副本就解析不到该模块、该段当场红。故它自持一份重试参数,不能收口。',
  },
  {
    id: 'install-smoke-electron-fs-bypass',
    file: 'test/gates/install-smoke.test.js',
    match: () => true,
    why: '本文件整体归另一条工作线管,且它的删除面是 Electron fs 层对「指向目录的链接」判定与'
      + 'node 不同的**刻意绕行**:L343 是段内沙盒删除、L349 是往沙盒注入的判定脚本源码里那行'
      + '`require("fs").rmSync(…)`(用纯 node 子进程删,绕开 asar 虚拟 fs)、L816 是沙盒里的'
      + 'release 目录。三者都不是「测试树的临时目录清理」,收口会改掉被绕行的语义。',
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
    file: 'test/core/clean-artifacts-gate.test.js',
    match: () => false,
    cold: true,
    why: 'L555-592 段**刻意**用 CWD 占用夹具复现「删不掉」:断言错误码属 EPERM/EBUSY/EACCES 族、'
      + '目标仍在、释放后可重试。该段自己不发任何删除调用(删除发生在子进程的被测脚本里),'
      + '故按设计零命中;登记它是为了挡住「顺手给这段也加重试/吞错」—— 那会直接改掉被测语义。',
  },
  {
    id: 'test-common-helpers-illegal-retry-params',
    file: 'test/core/test-common-helpers.test.js',
    match: () => false,
    cold: true,
    why: '`test-common-helpers.test.js` **刻意**给 removeTree 喂非法与极小重试参数'
      + '(maxRetries:-1 / maxRetries:1),以证明「失败如实上报」而不是吞掉。'
      + '本段是助手的行为断言,不是清理动作。'
      + '(按内容指认而非写行号:该段增删用例会整体下移,行号必然漂移。)',
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
    id: 'renderer-pure-error-code-literals',
    file: 'test/renderer/renderer-pure.test.js',
    match: () => false,
    cold: true,
    why: 'L183 的 EBUSY / L198 的 EPERM 是**错误码字面量**(渲染层纯函数 actionableError 的'
      + '失败分支断言),不是删除动作。段位随被测主体归属调整迁到 renderer/,'
      + '本条随之改路径 —— 白名单按文件内容匹配,路径写错会让条目静默失效。',
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
    file: 'gates/probe/gate-probes/sandbox.mjs',
    match: () => false,
    cold: true,
    why: 'removeJunction 是 **junction 的 Windows 绕行**:同一段代码在纯 node 下可用、在 Electron 里'
      + '会抛 `Path is a directory`,故按 unlinkSync → rmdirSync → 纯 node 子进程三级降级,'
      + '且三条都**非递归**(只摘链接,绝不碰真实 node_modules 目录)。gates/ tools/ 整体不在本门禁'
      + '扫描面内(那里 rmSync 是被测语义本身),登记为按设计零命中。',
  },
]);

/**
 * 第二条规则(助手调用点选项用法)的白名单。与 ALLOWLIST 分开而非合并:
 * 两条规则的命中对象形状不同(删除动作 vs 选项用法),合并会逼出「match 同时判两种形状」的
 * 耦合判定,反而更难读。**豁免必须写明「为什么这个调用点就是要传错参数」**。
 * @typedef {object} OptionAllowEntry
 * @property {string} id 条目 id
 * @property {string} file 生效文件;null = 不限文件
 * @property {(hit: OptionHit) => boolean} match 内容判定
 * @property {string} why 依据
 * @property {boolean} [cold] true = 按设计零命中
 */

/** @type {readonly OptionAllowEntry[]} */
export const OPTION_ALLOWLIST = Object.freeze([
  {
    id: 'test-common-helpers-illegal-retry-probe',
    file: 'test/core/test-common-helpers.test.js',
    // 刻意给 removeTree 喂非法与极小重试参数:证明「失败如实上报」而非吞掉
    match: (hit) => hit.args.includes('maxRetries: -1'),
    // ⚠️ 这里**刻意不写行号** —— 上一版写的是 `L344`/`L369`,而那条锚点所在的段每次
    // 增删用例都会整体下移(2026-09-30 实测移到 L394/L419),注释就指向了别的行。
    // 本仓反复吃亏于「按行号写的指针」,而本规则的 `match` **本来就按内容匹配**,
    // 故 `why` 也该按内容指认,而不是抄一个必然漂移的行号。
    why: '`test-common-helpers.test.js` 里那条 `maxRetries: -1` 调用**刻意**传非法值:'
      + '`fs.rmSync` 的 validateRmOptionsSync 必抛 ERR_OUT_OF_RANGE(本机实测),'
      + '该段据此确定性证明 removeTree 把失败上报而非当成功。'
      + '这正是本规则要卡的那类取值 —— 但**被测对象是助手的行为**,不是调用点的正确写法,'
      + '故豁免。同段那条 `{ maxRetries: 1, retryDelay: 10 }` 形态合法,本就不需要豁免。',
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
 * 第二条规则(助手调用点选项用法)的自检探针,形态与 SELF_PROBE 同构:
 * `before` 是**错误用法**(必须被判红),`after` 是**正确用法**(必须判绿)。
 * 四条各覆盖一类真实错法(见文件头「第二条规则」),其中「未提供第二实参」那条是反向锚点:
 * 缺省是最推荐、也是全树最常见的写法,若被判红则规则过宽。
 * @type {readonly { id: string; before: string; after: string }[]}
 */
export const OPTION_PROBE = Object.freeze([
  {
    id: 'option-non-object-second-arg',
    before: '    removeTree(dir, 5);',
    after: '    removeTree(dir, { maxRetries: 5 });',
  },
  {
    id: 'option-illegal-retry-value',
    before: '    removeTree(dir, { maxRetries: -1 });',
    after: '    removeTree(dir, { maxRetries: 1, retryDelay: 10 });',
  },
  {
    id: 'option-unknown-key',
    before: '    removeTree(dir, { maxRetries: 5, force: true });',
    after: '    removeFile(artifact, { maxRetries: 5, retryDelay: 200 });',
  },
  {
    id: 'option-omitted-second-arg-is-legal',
    before: '    removeFile(artifact, "x");',
    after: '    removeTree(dir);\n    removeFile(artifact);',
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

/**
 * @typedef {object} OptionHit 一处助手调用点的选项用法问题
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 行号(1 起)
 * @property {string} callee 助手名(removeTree / removeFile)
 * @property {string} args 第二实参原文
 * @property {string} reason 违规原因(人可读,直接进失败输出)
 * @property {string} lineSource 命中所在源码行
 */

/** 助手自身的定义形态(`export function removeTree(target, options = {})`):
 *  第二实参是**形参默认值**,不是调用点传值 —— 判红等于要求助手不能用默认参数。 */
const HELPER_DEF_RE = new RegExp(
  String.raw`\bfunction\s+(?:removeTree|removeFile)\s*\(`,
);

/**
 * 对一段源码文本跑「助手调用点选项用法」判定(纯函数,供 analyze 与 SELF_PROBE 共用)。
 * 只看**第二实参**:缺省即合法(用助手默认重试参数),传了就必须是形状与取值都合法的对象。
 *
 * 与第一条规则的两点刻意不同(都不是随手写的):
 * 1. **抹注释**(复用 test/common/copy-closure.js 的 lexSource(text).code,等长故行号不变):
 *    第一条规则的「不剥注释」是为保守多报 —— 误报能被人一眼看见;而本条若不抹注释,任何
 *    JSDoc 里写一句 `removeTree(dir, { retryDelay: 200 })` 的说明都会被判红,那是**真误报**
 *    (注释不是调用点),且会逼着人把文档改丑来讨好门禁。
 * 2. **跳过助手自身的定义**:形参默认值 `options = {}` 不是调用点传值。
 * 字符串仍不抹(与第一条规则一致):往沙盒注入的脚本源码里若藏着违规调用,宁可多报。
 * @param {string} text 源码文本
 * @param {string} file 仅用于回填的仓库相对路径
 * @returns {OptionHit[]}
 */
export function scanOptionText(text, file = '<probe>') {
  /** @type {OptionHit[]} */
  const hits = [];
  const code = lexSource(text).code;
  const lines = code.split('\n');
  HELPER_CALL_RE.lastIndex = 0;
  for (const m of code.matchAll(HELPER_CALL_RE)) {
    const offset = m.index ?? 0;
    // 定义处跳过:`function removeTree(` 之后紧跟的 `(` 才是本正则锚定的那个
    if (HELPER_DEF_RE.test(code.slice(Math.max(0, offset - 40), offset + 12))) continue;
    const inner = m[0].slice(m[0].indexOf('(') + 1, m[0].lastIndexOf(')'));
    const params = splitTopLevelArgs(inner);
    if (params.length < 2) continue; // 只传目标路径 = 用默认参数,合法
    const raw = params[1].trim();
    const line = code.slice(0, offset).split('\n').length;
    /** @type {(reason: string) => OptionHit} */
    const makeHit = (reason) => ({
      file,
      line,
      callee: m[0].slice(0, m[0].indexOf('(')).trim().replace(/\s+/g, ''),
      args: raw.replace(/\s+/g, ' ').trim(),
      reason,
      lineSource: lines[line - 1] ?? '',
    });

    // 规则 1:第二实参必须是对象字面量(变量/数字/字符串/展开一律判红 —— 见文件头三类错误用法)
    if (!raw.startsWith('{')) {
      hits.push(makeHit(`第二实参必须是对象字面量 { maxRetries?, retryDelay? },实际是 ${raw}`));
      continue;
    }
    // 规则 2/3:逐键校验键名与取值(顶层逗号已切开,剩余的逗号都在嵌套里)
    for (const rawProp of splitTopLevelArgs(raw.slice(1, raw.lastIndexOf('}')))) {
      const prop = rawProp.trim();
      if (prop === '') continue;
      const colon = prop.indexOf(':');
      if (colon === -1) {
        hits.push(makeHit(`选项键必须写成「键: 值」形式,实际是 ${prop}(省略值 = 恒为 undefined)`));
        continue;
      }
      const key = prop.slice(0, colon).trim();
      const value = prop.slice(colon + 1).trim();
      if (!HELPER_OPTION_KEYS.includes(key)) {
        hits.push(makeHit(`未知选项键 ${key}(助手只接受 ${HELPER_OPTION_KEYS.join(' / ')};未知键被静默忽略)`));
        continue;
      }
      if (!HELPER_OPTION_VALUE_RE.test(value)) {
        hits.push(makeHit(`${key} 的取值必须是非负有限数字字面量,实际是 ${value}(负数/NaN 会让 Node 抛 ERR_OUT_OF_RANGE)`));
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

// ---- 扫描与判定 ----

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
 * @returns {{ problems: DeleteHit[], optionProblems: OptionHit[], allowHits: number, allowCold: number, files: number, staleAllow: string[], deleteCalls: number, helperCalls: number }}
 */
export function analyze() {
  const files = listScanFiles(projectRoot);
  /** @type {DeleteHit[]} */
  const problems = [];
  /** @type {OptionHit[]} */
  const optionProblems = [];
  const allowUsed = new Set();
  let deleteCalls = 0;
  let helperCalls = 0;

  for (const rel of files) {
    const text = readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8');
    for (const hit of scanText(text, rel)) {
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
    // 第二条规则:助手调用点的可选参数用法。白名单只放行删除动作,不豁免本条 ——
    // 「被白名单放行的删除点仍须传对助手的参数」正是本条存在的意义。
    for (const hit of scanOptionText(text, rel)) {
      helperCalls += 1;
      const allowed = OPTION_ALLOWLIST.some(
        (entry) => (entry.file === null || entry.file === hit.file) && entry.match(hit),
      );
      if (!allowed) optionProblems.push(hit);
    }
  }

  return {
    problems,
    optionProblems,
    allowHits: allowUsed.size,
    allowCold: ALLOWLIST.filter((entry) => entry.cold === true).length,
    files: files.length,
    deleteCalls,
    helperCalls,
    staleAllow: ALLOWLIST.filter((entry, index) => !allowUsed.has(index) && entry.cold !== true).map((entry) => entry.id),
  };
}

/**
 * 自检探针:对每个条目断言「收口前形态被命中 / 收口后形态不被命中」。
 * 探针不过即 exit 1(规则本身坏了,后面所有判定都不可信)。
 * OPTION_PROBE 走第二条规则的判定器(否则探针验的就不是真规则)。
 * @returns {{ id: string, ok: boolean, detail: string }[]}
 */
export function runSelfProbe() {
  const deleteProbes = SELF_PROBE.map((probe) => {
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
  const optionProbes = OPTION_PROBE.map((probe) => {
    const beforeHits = scanOptionText(probe.before);
    const afterHits = scanOptionText(probe.after);
    const ok = beforeHits.length > 0 && afterHits.length === 0;
    return {
      id: probe.id,
      ok,
      detail: `错误用法形态命中 ${beforeHits.length} 处 / 正确用法形态命中 ${afterHits.length} 处`
        + `${ok ? '' : `(期望前者 >0、后者 0)${beforeHits.length === 0 ? ' —— 规则漏判' : ''}${afterHits.length > 0 ? ' —— 规则误判' : ''}`}`,
    };
  });
  return [...deleteProbes, ...optionProbes];
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

  // 判据 1:扫描面**等式**(声明目录集合 == 磁盘上真实存在的测试子目录)。先于 analyze 跑 ——
  // 漏登记的目录会让 analyze 抛 ENOENT,那时只剩一句「扫描失败」,看不出是哪个目录漏了。
  const surface = checkSurfaceEquality(projectRoot);
  if (!surface.ok) {
    console.error(
      `[temp-cleanup:fail] 扫描面等式不成立:${formatSurfaceMismatch(surface)}`
      + '(声明数必须等于实测数:新增测试子目录须登记进 shared/test-common-surface.js 的 '
      + 'SCAN_TARGETS,或按「它不是测试代码」的理由登记进 EXCLUDED_DIRS;下界判据管不到漏目录)',
    );
    return 1;
  }

  // 段目录**镜像一棵被断言的树**(与 check-test-numbering.mjs 同判据同文案单源):
  // 等式管「声明与磁盘一致」,这条管「声明本身合法」—— 枚举里混进一个不镜像任何树的
  // 目录(如暂存区)时,等式与下限都会照样判绿,只有这条拦得住。
  const mirror = checkSegmentMirrors(projectRoot);
  if (!mirror.ok) {
    console.error(
      `[temp-cleanup:fail] 段目录镜像判据不成立:${formatMirrorMismatch(mirror)}`
      + '(段目录须与顶层一棵被断言的树同名;新增被断言的树配同名段目录,勿另开暂存区)',
    );
    return 1;
  }

  let result;
  try {
    result = analyze();
  } catch (error) {
    console.error(`[temp-cleanup:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // 判据 2:扫描文件数**下限**(walker 整体失效的兜底,与上面的等式分工见单源文件头)
  const floor = judgeScanFloor(result.files);
  if (!floor.ok) {
    console.error(`[temp-cleanup:fail] ${floor.text}`);
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
      + '原「吞错」的调用点仍吞错但走助手。若确属刻意保留,请在 gates/repo/check-temp-cleanup.mjs 的 '
      + 'ALLOWLIST 加条目并写明依据(按内容匹配,勿按行号登记 —— 行号会随他处改动漂移)。'
      + '注意:删单个产物文件**不属本门禁范围**(不配 recursive),也不该套 removeTree。',
    );
    return 1;
  }

  if (result.optionProblems.length > 0) {
    for (const hit of result.optionProblems) {
      console.error(`[temp-cleanup:fail] ${hit.file}:${hit.line} → ${hit.callee} 的选项用法:${hit.reason}`);
    }
    console.error(
      `[temp-cleanup:fail] 助手调用点的可选参数用法不合规,共 ${result.optionProblems.length} 项`
      + `(扫描 ${result.helperCalls} 处带选项的助手调用)`,
    );
    console.error(
      '[temp-cleanup:fail] removeTree / removeFile 的第二实参:要么**省略**(用默认重试参数,'
      + '推荐),要么写成只含 `maxRetries` / `retryDelay` 的对象字面量且取非负有限数字字面量。'
      + '非对象、未知键(被静默忽略)、负数/NaN(Node 抛 ERR_OUT_OF_RANGE)三类都是「以为生效实则没生效」,'
      + '只能在这里判红。按内容匹配,勿按行号豁免。',
    );
    return 1;
  }

  console.log(
    `[ok] 测试树临时目录清理扫描通过:扫描 ${result.files} 个文件 / ${result.deleteCalls} 处目录删除,`
    + `无裸写;白名单 ${ALLOWLIST.length} 条(本次命中 ${result.allowHits} 条,按设计零命中 ${result.allowCold} 条);`
    + `助手调用点选项用法 ${result.helperCalls} 处全合规;自检探针 ${probe.length} 条全过`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'gates', 'repo', 'check-temp-cleanup.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}
