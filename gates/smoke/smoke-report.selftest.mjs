// 机器可读冒烟报告族(gates/smoke/smoke-report/**,571 行 + 入口 smoke-report.mjs)
// 自身的负向夹具。
//
// 这一族的失效形态几乎全是**恒绿**,而且比 smoke-proc 那族更隐蔽:smoke-proc 判红时最坏
// 结果是「CI 报红」,而这一族判绿时最坏结果是**产出一份「看起来通过」的报告** ——
// 「冒烟正常」「产物已验证」被写进机器可读的 JSON 与退出码 0,发布侧据此放行。所以本档的
// 承重能力集中在两句话上:
//   1. **「没跑」必须与「通过」区分**(status not-run ≠ pass,exit 2 ≠ 0,executed=false,
//      markerContract=null)。这族全部 5 个可执行层都围着这句话转。
//   2. **报告产物必须与机器无关**(绝对路径不得漏进 JSON,耗时不得入产物)。
// 一旦这两句中的任一句被摘掉,门禁不会变红 —— 它会安静地开始说谎。
//
// 形态:**判定本体与 CLI 分离**(与 gates/smoke/check-build-fresh.selftest.mjs、
// gates/smoke/smoke-proc.selftest.mjs 同款):纯函数层直接 import 判定本体,CLI 层只调
// `main()` 的**不 spawn 进程**的那几条早退路径。**本档不起任何子进程、不起 Electron**。
//
// ⚠️ **切了哪几层、为什么**:
//   - contract.mjs  — 全常量 + 类型契约,零 IO。切:EXIT ↔ REPORT_STATUS 的三档对应关系与
//                     「未知状态必须回落到 notRun 而非 pass」是承重的,不是同义反复。
//   - markers.mjs   — 纯函数(文本包含判定 + 路径脱敏)。切:脱敏是「产物与机器无关」的唯一
//                     执行点,退化形态是**不脱敏**(绝对路径漏进 JSON)—— 那不会让任何测试变红。
//   - report.mjs    — 纯函数(不碰 fs、不起进程)。切:状态归一 / not-run 报告形状 / 键序固定
//                     (产物可复现)全在这一层。
//   - process.mjs   — **只切带注入点的那一半**(见下)。切:预检的 unpacked 分支、exe 定位、
//                     electron 定位、临时根清理 —— 这些的输入全是路径,能在 mkdtemp 上造。
//   - cli.mjs       — 只切**不 spawn 进程**的路径(--help / 参数非法 / 前置缺失)。
//
// ⚠️ **刻意不切的那几层(不切理由即不切的依据,写在这里以免留下「以为守住了」的窗口)**:
//   1. **`process.mjs` 的 `dev` 预检分支**(source==='dev' 那一支):它硬读
//      `projectRoot/node_modules/electron` 与 `projectRoot/dist/main/smoke.js` ——
//      **真实工作树的构建产物**,能否跑取决于本机有没有装 Electron、有没有 build 过。
//      夹具一碰它就变成「测本机环境」而非「测判定」,在干净 clone 上必然假红。
//      该分支的真实守护在别处(`npm run build` 的产物存在性与 smoke-proc 的入口契约)。
//   2. **`process.mjs` 的 `readProductName()`**:无注入点,读真实 `package.json` 的
//      `build.productName`,是纯转发 —— 断言它等于包里的值等于把包内容抄一遍,无判定含量。
//   3. **`process.mjs` 的「以 --smoke 真正启动并等它退出」那一段**:那不是本文件里的代码
//      (它在 smoke-proc.mjs 的 runSmokeProcess),且要真起 Electron 才能到达 —— 代价是
//      每次数十秒到数分钟、且需要已构建的 dist/ 与已安装的 electron,不能进一个纯 node 的
//      快速自检。**本档零 spawn**,故这一段不在覆盖内。
//   4. **入口 `gates/smoke/smoke-report.mjs` 本身**:它只有 re-export 与一个
//      `isMainModule` 守卫,没有可断言的判定。**刻意不 import 它** —— 若那个守卫失效,
//      import 就会执行 `main()`,而 main() 在具备前置条件时会**真的起 Electron**
//      (默认 180s 硬超时)。为了测 59 行 re-export 而承担一个不受控的 Electron 启动,
//      不划算;该守卫的真实验证是「有人跑这个脚本时它不该动」,由 dev/prod 入口用法保证。
//   5. **CLI 的「跑起来了」那一段**(exit 0/1 的产出与 .log 留痕):同第 3 条,必须真起进程。
//      本档只覆盖「跑不起来」那一侧 —— 而那一侧恰好是本族最容易恒绿的一侧(exit 2 被写成
//      0 就等于「本机没装 Electron」被读成「冒烟正常」)。
//
// ⚠️ **与 smoke-proc.selftest.mjs 的关系:不是重复,而是「同口径」这句注释的可执行化。**
// markers.mjs 的头注写着「只做文本包含判定(与 collectSmokeProblems 同口径)」——
// 「同口径」本身是一句**无人执行的承诺**:两个文件各自遍历 SMOKE_MARKERS 各自算 missing,
// 没有任何东西保证两份结果一致。漂移的后果是同一份输出在「门禁侧」判绿、在「报告侧」写进
// 一份 missing 非空的报告(或反过来),两者读起来都「自洽」。故本档有一档专门做
// **交叉一致性断言**(对多组合成输出,parseSmokeOutput().missing 必须与
// collectSmokeProblems 的点名段逐条相等)。判定本体(退出码族/超时族/spawnError 族/
// 分支互斥/措辞可归因)由 smoke-proc.selftest.mjs 负责,本档**不重写那部分**。
//
// ✅ 关于隔离:纯函数档**不写任何文件、不起任何进程、不改 process.env**;需要落盘的档
// (preflight / cli)全部把落点重定向到 `mkdtemp` 出来的系统临时目录,并在 finally 清理。
// **真实工作树只被读**(且只有 `projectRoot` 这一个常量被读,用于构造「仓库内路径」夹具
// 与验证脱敏),从不被写。
//
// ✅ 恒绿防护落在四处,少一格都会退化:
//   - 每条负向档都先断「`problems` 非空」再断「命中预期片段」(恒绿实现会在第一条被拦下,
//     报出的根因指向「判定不判红」而不是「措辞变了」);
//   - 正向锚点断言**具体形状**(`Array.isArray` + length 0 + status + 计数),不是
//     「没抛异常就算过」;
//   - 前提自检回读确认 `okOutput()` 真的含全部 token —— 否则「夹具没造出成功运行」
//     会让全绿变成假通过;
//   - 注入/撤销成对:同一份 result 只换退出码,判红必须跟着输入翻面。

// ---- 形态:case 契约接入,但**不接 harness**(ADR-074 决定一 / ADR-068 bespoke 留在原处)----
//
// 32 处 `await check('<档名>', body)` 调用点**一字不动**,只把本地 runner `check()` 接到
// `shared/case.js` 的具名 case 契约上:档名即 case 名,档内多条 `must`/`eq` 攒进局部
// `errors[]`、档末一次性 `assert`(与同族已迁的 smoke-proc.selftest.mjs 的 `wrong[]` + assert
// 同构)。门禁树接的是**落在 shared/ 的真实现**:`gates-stay-in-gates` 的允许面只有
// `gates` / `shared` / `test/fixtures`,`test/` 整棵树不在其中,引不到 `test/harness/case.js`。
// case 内 assert 失败即抛、由 case 级 catch 收成**该 case** 失败,不中断后续 case;「跑之前
// 自增 caseCount」(夹具抛异常的档也占一个 case 位)由 suite 的「先登记后执行」天然承袭。
//
// **不用合成根 harness**,两条理由缺一不可:
//   1. 合成根的表只收**纯数据** case(树型路径 → 正文 + 问题清单正则),不含函数;而本份
//      **每一档都是回调**(输入构造、判定调用、恒绿防护全写在闭包里)。
//   2. harness 的 judge 契约是 `(合成根) => string[]`,而本份的判定入参是 result 对象 /
//      输出字符串 / exe 路径,返回的是 report 对象或 marker 数组 —— 入参与返回两侧都不对型,
//      塞进去是假接入。
// 接 case 契约解决的是另一件事:让「档数」成为可机械计数的单位(`gates-selftest-named-case`
// 判的就是它),迁移后分母由 `suite.results.length` 给出(= 32)。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assert, createCaseSuite } from '../../shared/case.js';
import { SMOKE_MARKERS, collectSmokeProblems } from './smoke-proc.mjs';
import {
  DEGRADATION_TOKENS,
  EXIT,
  REPORT_STATUS,
  SMOKE_REPORT_SCHEMA,
  projectRoot,
} from './smoke-report/contract.mjs';
import { parseSmokeOutput, redactPaths } from './smoke-report/markers.mjs';
import {
  buildNotRunReport,
  buildSmokeReport,
  exitCodeForStatus,
  renderSmokeSummary,
} from './smoke-report/report.mjs';
import { findAppExe, preflight, removeScratch, repoRelative, resolveElectronBinary } from './smoke-report/process.mjs';
import { main } from './smoke-report/cli.mjs';

/** 夹具诊断前缀(消费端传的是 'unpacked' / 'dev' 这类来源标签) */
const LABEL = 'unpacked';

// case 契约:一条档位一条 case,档名即 case 名。搬迁前这里是一个 `failures[]` 累积器 +
// 手写自增的 `caseCount`(汇总处读它) —— 分母手写会与实际档位漂移,而漂移方向的误差是
// 「报得太满」;现在由 `suite.results.length` 自然给出(见收口段)。
const suite = createCaseSuite();

/**
 * 断言失败信息的格式化(区分 Error 与其它抛出)。
 * @param {unknown} error 捕获到的抛出
 * @returns {string} 消息
 */
function errText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 跑一档:收集该档的全部断言失败,任一失败即整档红。
 *
 * 为什么一档可以有多条断言(而不是第一条失败就抛):一个档位通常同时钉「判红」与「不牵连别的
 * 族」,分散成两档会让「同一形态下判定到底多说了什么」看不清;合成一档后失败信息是一整串,
 * 一次就能看出退化成了什么样。
 *
 * 形态:整档收进 `suite.case(档名, …)`,档内多条断言攒进局部 `errors[]`、档末一次性
 * `assert` —— 与同族已迁的 smoke-proc.selftest.mjs 的 `wrong[]` + assert 同构。`must`/`eq`
 * 保留「只 push 不抛」的语义,夹具执行抛异常仍收进同一个 `errors[]`;case 级 catch 把 assert
 * 的抛出收成「该档失败」,不中断后续档。搬迁前 `caseCount += 1` 在跑之前自增(夹具抛异常的
 * 档也占一个 case 位),这一格由 suite 的「先登记后执行」承袭。
 * @param {string} name 档名
 * @param {(api: {must: (ok: boolean, text: string) => void, eq: (actual: unknown, expected: unknown, label: string) => void}) => string | undefined | Promise<string | undefined>} body 档体;返回值为括号里显示的摘要
 */
async function check(name, body) {
  await suite.case(name, async () => {
    /**
     * @param {boolean} ok 断言是否成立
     * @param {string} text 失败时的说明
     */
    const must = (ok, text) => {
      if (!ok) errors.push(text);
    };
    /**
     * @param {unknown} actual 实际值
     * @param {unknown} expected 期望值
     * @param {string} label 字段标签
     */
    const eq = (actual, expected, label) => {
      const got = JSON.stringify(actual);
      const want = JSON.stringify(expected);
      if (got !== want) errors.push(`${label}:期望 ${want},实际 ${got}`);
    };
    /** @type {string[]} */
    const errors = [];
    let note = '';
    try {
      note = (await body({ must, eq })) ?? '';
    } catch (error) {
      errors.push(`夹具执行抛异常:${errText(error)}`);
    }
    // 判据全部核对完才结算(与搬迁前同一口径:档内全报,不撞第一条就抛)。
    assert(errors.length === 0, `${name}:${errors.join('; ')}`);
    console.log(`[ok] smoke-report-selftest:${name}${note === '' ? '' : `(${note})`}`);
  });
}

/**
 * 在 mkdtemp 出来的系统临时目录里跑一段夹具,结束(含中途抛错)必删。
 * @template T
 * @param {(root: string) => T} body 夹具体,入参是临时根
 * @returns {T} 夹具体返回值
 */
function withTmp(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'smoke-report-selftest-'));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * 在临时根下造一个文件(自动建父目录),返回绝对路径。
 * @param {string} root 临时根
 * @param {string} rel 相对路径(用 / 分隔)
 * @param {string} [content] 文件内容
 * @returns {string} 绝对路径
 */
function touch(root, rel, content = '') {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

/**
 * 捕获 console 输出(CLI 层会往 stderr 打用法/摘要/诊断)。
 *
 * 为什么必须捕获而不是让它直接打:本档的判定对象就是「CLI 说了什么」,不捕获就没法断言;
 * 而 CLI 的正常输出混进自检的 `[ok]` 流里,会让「哪一行是夹具的、哪一行是被测的」不可分。
 * @template T
 * @param {() => T | Promise<T>} body 夹具体
 * @returns {Promise<{ value: T, stdout: string, stderr: string }>} 捕获结果
 */
async function captureConsole(body) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const real = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...parts) => out.push(parts.map(String).join(' '));
  console.error = (...parts) => err.push(parts.map(String).join(' '));
  console.warn = (...parts) => err.push(parts.map(String).join(' '));
  try {
    const value = await body();
    return { value, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    console.log = real.log;
    console.error = real.error;
    console.warn = real.warn;
  }
}

/** 全部诊断标记都齐、且退出码为 0 的一份合成运行(正向锚点的输入) */
function okOutput() {
  return SMOKE_MARKERS.map((marker) => `${marker.token} fixture`).join('\n');
}

/**
 * 只含前 n 条标记的合成输出。
 * @param {number} n 保留前几条标记
 * @returns {string} 合成输出
 */
function outputWithFirst(n) {
  return SMOKE_MARKERS.slice(0, n).map((marker) => `${marker.token} fixture`).join('\n');
}

/**
 * 一份「跑过且通过」的合成 ProcessRunResult(正向锚点)。
 * @param {string} [output] 覆盖输出
 * @returns {import('./smoke-proc.mjs').ProcessRunResult} 运行结果
 */
function okResult(output = okOutput()) {
  return { code: 0, signal: null, timedOut: false, output };
}

/**
 * 从 collectSmokeProblems 的问题列表里取出「点名了哪些 marker」。
 *
 * 与 smoke-proc.selftest.mjs 同款注意:诊断末尾那句「期望全部命中」会列出全部 token,而部分
 * label 本身就是 token 的子串(label「pdf 书签」⊂ token「[smoke] pdf 书签 ok:」)—— 拿整段
 * 正文做比较会把「附带的期望清单」误算进点名集。
 * @param {string[]} problems 问题列表
 * @returns {string[] | null} 点名的 label 清单;没有缺失诊断时为 null
 */
function namedFromProblems(problems) {
  const matched = /输出缺少诊断标记:(.*?)(?:\(期望全部命中|$)/s.exec(problems.join('\n'));
  if (matched === null) return null;
  return /** @type {RegExpExecArray} */ (matched)[1].split('、');
}

/* ---------- 前提自检:夹具自身可信(恒绿防护的最内层) ---------- */
await check('前提自检:标记清单非空、token 互异、正向合成输出含全部 token、降级 token 不与标记 token 相撞', ({ must, eq }) => {
  must(SMOKE_MARKERS.length > 0, 'SMOKE_MARKERS 为空 —— 「缺哪条」这一族全部夹具失去意义');
  const tokens = SMOKE_MARKERS.map((marker) => marker.token);
  eq(new Set(tokens).size, tokens.length, '标记 token 去重后长度');
  const notHit = tokens.filter((token) => !okOutput().includes(token));
  must(notHit.length === 0, `正向合成输出没含全这些 token:${notHit.join(' / ')} —— okOutput() 不可信,全绿是假通过`);
  // 降级 token 若与标记 token 相撞,降级计数会把标记命中抬高,两份判据互相污染 ⇒ 必须互斥。
  for (const degradation of DEGRADATION_TOKENS) {
    const collided = tokens.filter((token) => token.includes(degradation.token) || degradation.token.includes(token));
    must(collided.length === 0, `降级 token ${degradation.token} 与标记 token 相撞:${collided.join(' / ')}`);
  }
  must(typeof projectRoot === 'string' && path.isAbsolute(projectRoot), `projectRoot 应为绝对路径,实际 ${String(projectRoot)}`);
  return `${String(SMOKE_MARKERS.length)} 条标记、token 互异且与降级清单不相撞`;
});

/* ---------- contract 层:三档语义与退出码对应 ---------- */
await check('契约:EXIT 与 REPORT_STATUS 三档一一对应、退出码互异,且 notRun ≠ pass', ({ must, eq }) => {
  eq(Object.keys(EXIT).sort(), ['fail', 'notRun', 'pass'], 'EXIT 键集合');
  eq(Object.keys(REPORT_STATUS).sort(), ['fail', 'notRun', 'pass'], 'REPORT_STATUS 键集合');
  eq(Object.values(EXIT).sort(), [0, 1, 2], 'EXIT 取值集合');
  for (const [key, status] of Object.entries(REPORT_STATUS)) {
    eq(exitCodeForStatus(status), EXIT[key], `状态 ${status} → 退出码`);
  }
  // 「没跑」被读成「通过」是本族头号事故,故这两个值必须逐字不同 —— 这一格不钉住,
  // 有人把 notRun 改成 0(「反正没跑也不算失败」)不会有任何测试变红。
  must(EXIT.notRun !== EXIT.pass, `notRun(${String(EXIT.notRun)}) 不得等于 pass(${String(EXIT.pass)}) —— 「没跑」被读成「通过」正是本族头号事故`);
  return 'pass/fail/notRun → 0/1/2,三者互异';
});

await check('契约:未知状态必须回落到 notRun(2),不得回落成 pass(0)', ({ must }) => {
  // 为什么单独一格:exitCodeForStatus 的实现是「两个 if + 兜底」。把兜底写成
  // `return EXIT.pass` 或写成先判 pass 的表驱动,任何「状态名写错/多一档」的退化都恒绿。
  for (const bogus of ['', 'PASS', 'notrun', 'passed', 'skipped', 'unknown', undefined, null, 0, 1]) {
    const got = exitCodeForStatus(/** @type {string} */ (bogus));
    must(got === EXIT.notRun, `未知状态 ${JSON.stringify(bogus) ?? 'undefined'} 应回落到 notRun(${String(EXIT.notRun)}),实际 ${String(got)}`);
  }
  // 防止反向的「一律 notRun」退化。
  must(exitCodeForStatus('pass') === EXIT.pass, `已知 pass 状态应给 ${String(EXIT.pass)},实际 ${String(exitCodeForStatus('pass'))}`);
  must(exitCodeForStatus('fail') === EXIT.fail, `已知 fail 状态应给 ${String(EXIT.fail)},实际 ${String(exitCodeForStatus('fail'))}`);
});

await check('契约:schema 版本为正整数、降级清单非空且条目形状完整(非空 id/label/token)', ({ must }) => {
  must(Number.isInteger(SMOKE_REPORT_SCHEMA) && SMOKE_REPORT_SCHEMA > 0, `schema 版本应为正整数,实际 ${String(SMOKE_REPORT_SCHEMA)}`);
  must(Array.isArray(DEGRADATION_TOKENS), 'DEGRADATION_TOKENS 应为数组');
  must(DEGRADATION_TOKENS.length > 0, 'DEGRADATION_TOKENS 为空 —— 「非致命降级留痕」这一族在报告里将完全不可见');
  for (const entry of DEGRADATION_TOKENS) {
    for (const key of ['id', 'label', 'token']) {
      must(typeof entry[key] === 'string' && entry[key] !== '', `降级条目 ${entry.id} 的 ${key} 应为非空字符串,实际 ${JSON.stringify(entry[key])}`);
    }
  }
  const ids = DEGRADATION_TOKENS.map((entry) => entry.id);
  must(new Set(ids).size === ids.length, `降级 id 重复:${ids.join(' / ')} —— 报告会点名两次同一项`);
  return `schema ${String(SMOKE_REPORT_SCHEMA)}、降级 ${String(DEGRADATION_TOKENS.length)} 项`;
});

/* ---------- markers 层:标记解析与路径脱敏 ---------- */
await check('markers 正向锚点:标记齐 → 逐条命中、缺失清单为空、降级清单为空(断言具体形状)', ({ must, eq }) => {
  const parsed = parseSmokeOutput(okOutput());
  eq(parsed.markers.length, SMOKE_MARKERS.length, '标记表长度');
  eq(parsed.markers.map((marker) => marker.id), SMOKE_MARKERS.map((marker) => marker.id), '标记 id 顺序');
  must(parsed.markers.every((marker) => marker.present === true), '正向合成输出里仍有标记未被判为命中 —— okOutput() 或包含判定退化了');
  must(Array.isArray(parsed.missing), 'missing 应为数组');
  eq(parsed.missing, [], '缺失清单');
  eq(parsed.degradations, [], '降级清单(未出现降级 token 时应为空数组,不是含 count:0 的条目)');
  return `${String(parsed.markers.length)}/${String(parsed.markers.length)} 命中、缺失 0、降级 0`;
});

await check('markers:缺三条 → 只点那三条、顺序与 SMOKE_MARKERS 一致', ({ must, eq }) => {
  const parsed = parseSmokeOutput(outputWithFirst(2));
  eq(parsed.missing, SMOKE_MARKERS.slice(2).map((marker) => marker.label), '缺失清单');
  must(parsed.missing.length === 3, `缺失应为 3 条,实际 ${String(parsed.missing.length)}:${parsed.missing.join(' / ')}`);
  for (const present of SMOKE_MARKERS.slice(0, 2)) {
    must(!parsed.missing.includes(present.label), `已命中的标记 ${present.label} 不该出现在缺失清单里`);
  }
  return `缺失 ${String(parsed.missing.length)} 条`;
});

await check('markers:输出为空 → 全部标记被点名(冒烟启动即崩的典型形态)', ({ must, eq }) => {
  const parsed = parseSmokeOutput('');
  eq(parsed.missing, SMOKE_MARKERS.map((marker) => marker.label), '缺失清单');
  must(parsed.markers.every((marker) => marker.present === false), '空输出下不应有任何标记被判为命中');
});

await check('markers:非字符串输入按空串处理(不抛、且全部判缺)', ({ must }) => {
  for (const bad of [undefined, null, 0, 42, {}, ['x']]) {
    const parsed = parseSmokeOutput(/** @type {string} */ (bad));
    must(Array.isArray(parsed.missing) && parsed.missing.length === SMOKE_MARKERS.length, `输入 ${JSON.stringify(bad) ?? 'undefined'} 应按空串处理并全判缺,实际缺失 ${String(parsed.missing.length)} 条`);
  }
  return 'undefined/null/数字/对象/数组 均按空串处理';
});

await check('markers:降级 token 出现 3 次 → count=3;未出现 → 不进清单(不留 count:0 的空条目)', ({ must, eq }) => {
  const token = /** @type {string} */ (DEGRADATION_TOKENS[0]).token;
  const noisy = `${token} 字体缺失\n噪声行\n${token} 字体缺失\n${token} 字体缺失`;
  const parsed = parseSmokeOutput(okOutput());
  // 降级是**非致命**的:它出现在一份「全标记齐 + 退出码 0」的运行里,missing 仍须为空 ——
  // 少这一格,一个把降级混进 missing 的实现会把「非致命」升级成「致命」。
  eq(parsed.missing, [], '带降级噪声时的缺失清单(降级不得牵连标记族)');
  const withNoise = parseSmokeOutput(`${okOutput()}\n${noisy}`);
  eq(withNoise.degradations.length, 1, '降级清单长度');
  must(withNoise.degradations[0].count === 3, `降级次数应为 3,实际 ${String(withNoise.degradations[0].count)} —— 计数循环的游标推进写错会让相邻重复漏计`);
  return `count=${String(withNoise.degradations[0].count)} 且不牵连缺失清单`;
});

/* ---------- markers ↔ smoke-proc 交叉一致性(把「同口径」这句注释变成可执行断言) ---------- */
await check('交叉:parseSmokeOutput 的缺失清单必须与 collectSmokeProblems 的点名段逐条一致', ({ must, eq }) => {
  // 这一档是本档与 smoke-proc.selftest.mjs 不重复、而是**互补**的那一格:那份守「什么算失败」,
  // 这份守「两份判定层对同一份输出不得给出不同的通过/失败结论」。两个文件各自遍历
  // SMOKE_MARKERS,没有第三个东西比对它们 —— 漂移时两侧各自自洽,没人发现。
  const samples = [
    { name: '标记齐', output: okOutput() },
    { name: '缺一条', output: outputWithFirst(4) },
    { name: '缺三条', output: outputWithFirst(2) },
    { name: '全缺', output: '' },
    { name: 'token 差尾字符', output: okOutput().replace('[smoke] convert ok:', '[smoke] convert ok ') },
    { name: '标记顺序颠倒仍算齐(纯子串包含口径)', output: SMOKE_MARKERS.map((m) => `${m.token} x`).reverse().join('\n') },
    {
      name: '混入降级噪声',
      output: `${okOutput()}\n${String(DEGRADATION_TOKENS[0].token)} 字体缺失`,
    },
  ];
  for (const sample of samples) {
    const problems = collectSmokeProblems(okResult(sample.output), { label: LABEL });
    const named = namedFromProblems(problems);
    const parsed = parseSmokeOutput(sample.output);
    eq(parsed.missing, named ?? [], `「${sample.name}」两份判定层的缺失清单`);
    // 反向:缺失清单非空 ⇒ 必须真的产出一条缺失诊断(否则报告写着缺 N 条、门禁却说没问题)。
    if (parsed.missing.length > 0) {
      must(problems.length > 0, `「${sample.name}」报告侧点名 ${String(parsed.missing.length)} 条,门禁侧却零问题 —— 两侧口径已漂移`);
      must(named !== null, `「${sample.name}」报告侧点名 ${String(parsed.missing.length)} 条,门禁侧却没有缺失诊断`);
    }
  }
  return `${String(samples.length)} 份合成输出两侧一致`;
});

/* ---------- report 层:状态归一、报告形状、可复现 ---------- */
await check('report 正向锚点:标记齐 + 退出码 0 → problems 为空数组、status=pass(断言具体形状)', ({ must, eq }) => {
  const report = buildSmokeReport({ result: okResult(), source: LABEL, target: 'release/win-unpacked/x.exe' });
  must(Array.isArray(report.problems), 'problems 应为数组');
  eq(report.problems.length, 0, '正向锚点的 problems 长度(恒绿实现的基准线)');
  must(report.status === REPORT_STATUS.pass, `status 应为 pass,实际 ${report.status}`);
  eq(exitCodeForStatus(report.status), EXIT.pass, 'pass 状态映射的退出码');
  eq(report.executed, true, 'executed');
  eq(report.kind, 'smoke-report', 'kind');
  eq(report.exitCode, 0, 'exitCode');
  eq(report.markerContract, { expected: SMOKE_MARKERS.length, present: SMOKE_MARKERS.length, missing: 0 }, 'markerContract');
  eq(report.missingMarkers, [], 'missingMarkers');
  eq(report.degradations, [], 'degradations');
  must(!('notRunReason' in report), 'pass 报告不得带 notRunReason 字段(消费端以字段存在性判未执行)');
  return `零问题、status=${report.status}、标记 ${String(report.markerContract.present)}/${String(report.markerContract.expected)}`;
});

await check('report:缺标记 → problems 非空且点名那一条、status=fail、markerContract.missing 同步', ({ must, eq }) => {
  const missing = SMOKE_MARKERS[SMOKE_MARKERS.length - 1];
  const report = buildSmokeReport({ result: okResult(outputWithFirst(SMOKE_MARKERS.length - 1)), source: LABEL });
  must(Array.isArray(report.problems) && report.problems.length > 0, '期望判红,实际零问题 —— 判定在该形态上恒绿了');
  must(report.problems[0].includes(missing.label), `诊断应点名缺失的那一条(${missing.label}),实际:${report.problems.join(' | ')}`);
  must(report.status === REPORT_STATUS.fail, `status 应为 fail,实际 ${report.status}`);
  eq(report.missingMarkers, [missing.label], 'missingMarkers');
  eq(report.markerContract, { expected: SMOKE_MARKERS.length, present: SMOKE_MARKERS.length - 1, missing: 1 }, 'markerContract');
  eq(exitCodeForStatus(report.status), EXIT.fail, 'fail 状态映射的退出码');
  return `${String(report.problems.length)} 条问题、missing=${String(report.markerContract.missing)}`;
});

await check('report:退出码非 0(标记全齐) → 只因退出码判红,不牵连标记族', ({ must, eq }) => {
  const report = buildSmokeReport({ result: { code: 42, signal: null, timedOut: false, output: okOutput() }, source: LABEL });
  must(report.problems.length > 0, '期望判红,实际零问题');
  must(report.problems[0].includes('42'), `诊断应写出实际退出码 42,实际:${report.problems.join(' | ')}`);
  must(!report.problems.join('\n').includes('缺少诊断标记'), '标记全齐时不得报缺失诊断(两族必须独立)');
  eq(report.missingMarkers, [], 'missingMarkers(标记全齐)');
  eq(report.markerContract.missing, 0, 'markerContract.missing');
});

await check('report:not-run 报告 → executed=false / markerContract=null / exitCode=null / problems 非空 / 退出码 2', ({ must, eq }) => {
  // 本族最重要的一格。「没跑」这份报告的每一处形态都在说「这不是通过」;任何一处被改成
  // 「跑过了的样子」,消费端就再也分不出「冒烟正常」与「本机没装 Electron」。
  const reason = '解包目录不存在:release/win-unpacked(请先运行 npm run dist)';
  const report = buildNotRunReport({ source: LABEL, reason });
  eq(report.status, REPORT_STATUS.notRun, 'status');
  eq(report.executed, false, 'executed(未执行不得被读成通过)');
  eq(report.markerContract, null, 'markerContract(未执行为 null,不是 0/0/0 —— 消费端以它判「跑没跑」)');
  eq(report.exitCode, null, 'exitCode');
  eq(report.signal, null, 'signal');
  eq(report.timedOut, false, 'timedOut');
  eq(report.unterminated, false, 'unterminated');
  eq(report.spawnError, null, 'spawnError');
  eq(report.markers, [], 'markers');
  eq(report.missingMarkers, [], 'missingMarkers');
  eq(report.degradations, [], 'degradations');
  // problems 非空是承重的:status 虽然由 notRun 硬编码,但一份 problems 为空的 not-run 报告
  // 在任何「按 problems 判成败」的消费端都会被读成「零问题 = 通过」。
  must(Array.isArray(report.problems), 'problems 应为数组');
  must(report.problems.length > 0, 'not-run 报告的 problems 不得为空 —— 空数组在按 problems 判成败的消费端会被读成通过');
  must(report.problems[0].includes('未执行'), `not-run 的 problems 应带「未执行」前缀,实际:${report.problems.join(' | ')}`);
  must(report.problems[0].includes(reason), 'not-run 的 problems 应含未执行原因');
  eq(report.notRunReason, reason, 'notRunReason');
  // 头号事故格:not-run 的退出码绝不能是 0。
  eq(exitCodeForStatus(report.status), EXIT.notRun, 'not-run 状态映射的退出码');
  must(exitCodeForStatus(report.status) !== EXIT.pass, 'not-run 的退出码不得是 0(CI 会把「没跑」读成「冒烟正常」)');
  // 「跑过了」的那份报告带 executed=true + 有计数;两者必须可区分。
  const ran = buildSmokeReport({ result: okResult(), source: LABEL });
  must(ran.executed !== report.executed, 'executed 必须能区分「跑过」与「没跑」');
  must(ran.markerContract !== report.markerContract, 'markerContract 必须能区分「跑过」与「没跑」');
  return `status=${report.status}、exit ${String(exitCodeForStatus(report.status))}`;
});

await check('report:not-run 的原因含绝对路径 → 报告与摘要里不得残留该路径(产物与机器无关)', ({ must }) => {
  const leaky = `解包目录不存在:${path.join(projectRoot, 'release', 'win-unpacked')}(请先运行 npm run dist)`;
  const report = buildNotRunReport({ source: LABEL, reason: leaky });
  const json = JSON.stringify(report);
  must(!json.includes(projectRoot), `报告 JSON 里残留了仓库根绝对路径 ${projectRoot} —— 脱敏被摘掉了`);
  must(report.problems[0].includes('<repo>'), `净化后应保留仓库相对信息(<repo>),实际:${report.problems[0]}`);
  must(!renderSmokeSummary(report).includes(projectRoot), '摘要里残留了仓库根绝对路径');
});

await check('report:spawnError 走脱敏(undefined → null),且启动失败判红', ({ must, eq }) => {
  const leaky = new Error(`spawn ${path.join(projectRoot, 'release', 'win-unpacked', 'x.exe')} ENOENT`);
  const report = buildSmokeReport({ result: { ...okResult(''), spawnError: leaky }, source: LABEL });
  eq(typeof report.spawnError, 'string', 'spawnError 的类型(有 Error 时应是脱敏后的字符串)');
  must(!String(report.spawnError).includes(projectRoot), 'spawnError 里残留了仓库根绝对路径');
  must(String(report.spawnError).includes('ENOENT'), `spawnError 应保留根因(ENOENT),实际:${String(report.spawnError)}`);
  must(report.problems.length > 0, '启动失败应判红');
  must(report.problems.join('\n').includes('ENOENT'), '诊断应点名启动失败的根因');
  must(!JSON.stringify(report.problems).includes(projectRoot), 'problems 里残留了仓库根绝对路径');
  // undefined 归一为 null(而不是 undefined):JSON.stringify 会直接丢掉 undefined 字段,
  // 于是「无 spawnError」与「字段不存在」在消费端不可区分。
  eq(buildSmokeReport({ result: okResult(), source: LABEL }).spawnError, null, '无 spawnError 时应归一为 null');
  return 'ENOENT 可归因、路径已脱敏';
});

// redactPaths 是「产物与机器无关」的**唯一执行点**:report.mjs 组装 problems / spawnError /
// notRunReason 时都过它一遍。摘掉它(退化成恒等函数)不会让任何现有测试变红,但同一份报告
// 在两台机器上就会带进两个不同的绝对路径 ⇒ 跨机器 diff 永久有噪音,且泄露用户目录布局。
// 故直接切它本身,而不是只靠 report 层间接覆盖。
await check('markers:redactPaths 覆盖盘符与 POSIX 两类绝对路径,仓内路径保留为 <repo>', ({ must, eq }) => {
  const root = String(projectRoot);
  // 仓内绝对路径 ⇒ <repo>(保留相对信息:发布侧要能看出是哪个文件)。
  const inside = `${root}\\release\\win-unpacked\\应用.exe`;
  const cleanedInside = redactPaths(inside, root);
  must(cleanedInside.includes('<repo>'), `仓内绝对路径应替换为 <repo>,实际:${cleanedInside}`);
  must(!cleanedInside.includes(root), `净化后仍残留仓库根 ${root},实际:${cleanedInside}`);
  // 仓外盘符绝对路径 ⇒ <abs-path>。这正是「用户目录布局」泄露的那一类。
  const winOutsider = 'C:\\Users\\someone\\AppData\\Local\\Temp\\m2w-smoke-xyz\\user-data.json';
  const cleanedWin = redactPaths(winOutsider, root);
  must(!cleanedWin.includes('someone'), `仓外盘符路径未被脱敏,实际:${cleanedWin}`);
  must(cleanedWin.includes('<abs-path>'), `仓外盘符路径应替换为 <abs-path>,实际:${cleanedWin}`);
  // POSIX 绝对路径 ⇒ 同样 <abs-path>(Windows 上正则靠 lookbehind 覆盖这一形态,极易漏)。
  const posixOutsider = '/home/someone/.config/m2w/user-data.json';
  const cleanedPosix = redactPaths(posixOutsider, root);
  must(!cleanedPosix.includes('someone'), `POSIX 绝对路径未被脱敏,实际:${cleanedPosix}`);
  must(cleanedPosix.includes('<abs-path>'), `POSIX 绝对路径应替换为 <abs-path>,实际:${cleanedPosix}`);
  // 相对路径不动:报告里到处都是仓库相对路径,若被一并吃掉,诊断就失去可读性。
  const relative = '解包目录不存在:release/win-unpacked(请先运行 npm run dist)';
  eq(redactPaths(relative, root), relative, '仓库相对路径应原样保留');
  // 非字符串 / 空串 ⇒ 空串(不得抛:调用点传的是 spawnError.message 之类,类型不受报告层控制)。
  for (const bad of [undefined, null, 0, {}, ['x']]) {
    eq(redactPaths(/** @type {string} */ (bad), root), '', `非字符串输入 ${JSON.stringify(bad) ?? 'undefined'} 应净化为 ''`);
  }
  // 幂等:已脱敏的文本再过一次不得被二次改写(否则 <repo> 之类会被当成待替换片段)。
  eq(redactPaths(cleanedWin, root), cleanedWin, '脱敏的幂等性');
  return '盘符 / POSIX / <repo> / 相对路径保留 / 幂等';
});

await check('report:unterminated 归一为布尔(未给时不得是 undefined)', ({ eq }) => {
  eq(buildSmokeReport({ result: okResult(), source: LABEL }).unterminated, false, '未给 unterminated 时');
  eq(buildSmokeReport({ result: { ...okResult(), timedOut: true, unterminated: true }, source: LABEL }).unterminated, true, '给了 unterminated:true 时');
});

await check('report:键序固定 + 同输入两次产出逐字节相同(产物可复现)', ({ must, eq }) => {
  // 「键序固定 ⇒ 同输入同字节」是这份产物可被 diff 的前提(发布侧靠它判断「产物变了没有」)。
  // 一个「顺手加了字段插在中间」的重构不会让任何测试变红,但会让两次运行的产物 diff 出现噪音。
  const spec = { result: okResult(), source: LABEL, target: 'release/win-unpacked/x.exe' };
  eq(Object.keys(buildSmokeReport(spec)), Object.keys(buildSmokeReport(spec)), '两次构建的键序');
  eq(Object.keys(buildNotRunReport({ source: LABEL, reason: 'r' })), Object.keys(buildNotRunReport({ source: LABEL, reason: 'r' })), 'not-run 两次构建的键序');
  const a = JSON.stringify(buildSmokeReport(spec), null, 2);
  const b = JSON.stringify(buildSmokeReport({ ...spec, result: { ...spec.result } }), null, 2);
  must(a === b, '同输入两次产出不一致 —— 报告里有每次都变的字段(时间戳/耗时/绝对路径)');
  return '键序稳定、两次产出逐字节相同';
});

/* ---------- report 层:摘要渲染 ---------- */
await check('摘要:pass 报告逐条列 [有]、不出现 [缺]/[问题]', ({ must }) => {
  const summary = renderSmokeSummary(buildSmokeReport({ result: okResult(), source: LABEL }));
  for (const marker of SMOKE_MARKERS) {
    must(summary.includes(`[有] ${marker.label}(${marker.id})`), `摘要应逐条列出已命中的标记 ${marker.label}`);
  }
  must(!summary.includes('[缺]'), 'pass 摘要不应出现 [缺]');
  must(!summary.includes('[问题]'), 'pass 摘要不应出现 [问题]');
  must(summary.includes(`标记 ${String(SMOKE_MARKERS.length)}/${String(SMOKE_MARKERS.length)}`), '摘要头应给出标记计数');
  return `${String(SMOKE_MARKERS.length)} 行标记`;
});

await check('摘要:fail 报告列 [缺] 与 [问题],并带降级行 ×N', ({ must }) => {
  const token = String(DEGRADATION_TOKENS[0].token);
  const output = `${outputWithFirst(SMOKE_MARKERS.length - 1)}\n${token} 字体缺失\n${token} 字体缺失`;
  const report = buildSmokeReport({ result: okResult(output), source: LABEL });
  const summary = renderSmokeSummary(report);
  must(summary.includes('[缺]'), 'fail 摘要应出现 [缺]');
  must(report.problems.length > 0 && summary.includes('[问题]'), 'fail 摘要应逐条列出问题');
  must(summary.includes('[降级]'), '降级应单独成行');
  must(summary.includes('×2'), `降级次数应写进摘要,实际摘要:\n${summary}`);
  must(summary.includes('(非致命,不影响判定)'), '降级行必须写明非致命 —— 否则发布侧会当成第二个失败');
});

await check('摘要:not-run 报告头部标记列 0/0、不逐条列标记、问题行带未执行原因', ({ must, eq }) => {
  const report = buildNotRunReport({ source: LABEL, reason: '解包目录不存在:release/win-unpacked' });
  const summary = renderSmokeSummary(report);
  must(summary.includes('标记 0/0'), `not-run 摘要头的标记列应为 0/0,实际:\n${summary}`);
  must(!summary.includes('[有]') && !summary.includes('[缺]'), 'not-run 摘要不得逐条列标记(没跑过就没什么可列的)');
  must(summary.includes('退出码 (无)'), `not-run 摘要的退出码列应为 (无),实际:\n${summary}`);
  must(summary.includes('[问题] 未执行:'), 'not-run 摘要应有一条 [问题] 未执行:');
  eq(report.status, REPORT_STATUS.notRun, 'status');
  return '0/0 + (无) + 未执行';
});

await check('摘要:耗时只进摘要、不入报告 JSON(产物不得含每次都变的字段)', ({ must }) => {
  const spec = { result: okResult(), source: LABEL };
  const report = buildSmokeReport(spec);
  const withElapsed = renderSmokeSummary(report, { elapsedMs: 12345 });
  must(withElapsed.includes('12345ms'), '摘要应带耗时');
  must(renderSmokeSummary(report).includes('(未计时)'), '未计时时应显示占位');
  must(!JSON.stringify(report).includes('12345'), '报告 JSON 里出现了耗时 —— 每次都变的字段会让「产物是否变化」失去可比性');
  must(!('elapsedMs' in report), '报告对象不应有 elapsedMs 字段');
  // 两次不同耗时下的产物必须逐字节相同(这是「耗时不入产物」的最终形态)。
  const a = JSON.stringify(buildSmokeReport(spec));
  renderSmokeSummary(report, { elapsedMs: 1 });
  const b = JSON.stringify(buildSmokeReport(spec));
  must(a === b, '不同耗时下产物不一致');
  return '耗时只在摘要';
});

/* ---------- process 层:带注入点的那一半(全部落在 mkdtemp 临时树上) ---------- */
await check('process:resolveElectronBinary 按 path.txt 定位;空/失效 path.txt 回退到 dist 探测;全缺返回 null', ({ eq }) => {
  withTmp((root) => {
    // 形态一:path.txt 给出相对路径(electron 包的真实布局)。
    touch(root, 'node_modules/electron/path.txt', 'electron.exe\n');
    const hit = touch(root, 'node_modules/electron/dist/electron.exe', 'binary');
    eq(resolveElectronBinary(root), hit, '按 path.txt 定位的结果');
    // 形态二:path.txt 为空(装包中断/被截断)⇒ 回退到按名探测,而不是直接放弃。
    writeFileSync(path.join(root, 'node_modules/electron/path.txt'), '   \n', 'utf8');
    eq(resolveElectronBinary(root), hit, '空 path.txt 时的回退定位');
    // 形态三:path.txt 指向不存在的文件 ⇒ 同样回退。
    writeFileSync(path.join(root, 'node_modules/electron/path.txt'), 'electron-missing.exe', 'utf8');
    eq(resolveElectronBinary(root), hit, 'path.txt 指向缺失文件时的回退定位');
    // 形态四:整个 electron 都不在 ⇒ null。**必须是 null 而不是猜一个路径** ——
    // 猜出来的路径会让 dev 预检以为「能跑」,然后在 spawn 阶段炸出一条与根因无关的诊断。
    rmSync(path.join(root, 'node_modules', 'electron', 'dist'), { recursive: true, force: true });
    eq(resolveElectronBinary(root), null, 'electron 缺失时的返回值(不得猜路径)');
  });
  return 'path.txt / 回退 / 缺失四态';
});

await check('process:findAppExe 优先按 productName 同名命中(大小写不敏感),否则仅在候选唯一时兜底', ({ eq }) => {
  withTmp((root) => {
    // 候选多个:必须按名命中,不能挑第一个。
    touch(root, 'aaa.exe');
    touch(root, '应用.exe');
    eq(findAppExe(root, '应用'), path.join(root, '应用.exe'), '多个候选时的按名命中');
    eq(findAppExe(root, '应 用'), null, '大小写/空格不同的名字不应被宽松命中');
    eq(findAppExe(root, '应用'.toUpperCase()), path.join(root, '应用.exe'), '大小写不敏感的按名命中');
    // 候选唯一:productName 没命中也该兜底(否则要求用户每次都传 --exe)。
    rmSync(path.join(root, 'aaa.exe'));
    eq(findAppExe(root, '别的名字'), path.join(root, '应用.exe'), '唯一候选的兜底');
    // 候选多个且无同名 ⇒ null,交由调用方报「指名 --exe」。**在多个候选里猜一个是错的**:
    // 猜中与否与真实产物布局无关,发布侧拿到的是一份不可复现的结论。
    touch(root, 'zzz.exe');
    eq(findAppExe(root, '别的名字'), null, '多候选且无同名时不得猜');
    // 目录不存在 ⇒ null。
    eq(findAppExe(path.join(root, 'no-such-dir'), '应用'), null, '目录不存在时的返回值');
    return '按名优先 / 唯一兜底 / 不猜';
  });
});

await check('process:repoRelative 仓内给 posix 相对路径、仓外与等于根给 basename', ({ must, eq }) => {
  eq(repoRelative(path.join(projectRoot, 'release', 'win-unpacked', 'x.exe')), 'release/win-unpacked/x.exe', '仓内路径');
  must(!repoRelative(path.join(projectRoot, 'release', 'x.exe')).includes('\\'), '相对路径必须是 posix(反斜杠会让跨平台 diff 出现噪音)');
  const outside = path.resolve(projectRoot, '..', '..', 'elsewhere', 'x.exe');
  eq(repoRelative(outside), 'x.exe', '仓外路径应退化为 basename');
  eq(repoRelative(projectRoot), path.basename(projectRoot), '等于仓库根时的返回值');
  must(!repoRelative(path.join(projectRoot, 'release')).includes(projectRoot), '相对化结果里不得残留仓库根绝对路径');
});

await check('process:preflight(unpacked) 逐档点名前置缺失,齐备时返回 null(可跑)', ({ must, eq }) => {
  withTmp((root) => {
    const productName = '应用';
    // 档一:解包目录不存在。
    const missingDir = path.join(root, 'win-unpacked');
    const r1 = preflight({ source: 'unpacked', unpackedDir: missingDir, exeOption: undefined, productName });
    must(typeof r1 === 'string' && r1.includes('解包目录不存在'), `解包目录不存在时应给出该原因,实际:${String(r1)}`);
    must(/** @type {string} */ (r1).includes(path.basename(missingDir)), `原因应点名实际目录(${path.basename(missingDir)}),实际:${String(r1)}`);
    // 档二:目录在但 app.asar 缺(打包中断)。
    mkdirSync(missingDir, { recursive: true });
    const r2 = preflight({ source: 'unpacked', unpackedDir: missingDir, exeOption: undefined, productName });
    must(typeof r2 === 'string' && r2.includes('应用归档缺失'), `缺 app.asar 时应给出该原因,实际:${String(r2)}`);
    // 档三:归档在但 exe 无法确定 ⇒ 原因里必须**摆出实际候选**,否则用户无从判断该 --exe 什么。
    //
    // ⚠️ 这里必须造**两个**不同名的 exe:只有一个时 findAppExe 的「候选唯一兜底」会合法地
    // 解析出它、preflight 返回 null —— 那是对的(逼用户每次都传 --exe 是错的)。「无法确定」
    // 这一档的真实语义是「候选不唯一且按名命中不了」。
    touch(root, 'win-unpacked/resources/app.asar', 'archive');
    touch(root, 'win-unpacked/aaa.exe');
    touch(root, 'win-unpacked/bbb.exe');
    const r3 = preflight({ source: 'unpacked', unpackedDir: missingDir, exeOption: undefined, productName });
    must(typeof r3 === 'string' && r3.includes('无法确定应用可执行文件'), `exe 无法确定时应给出该原因,实际:${String(r3)}`);
    must(/** @type {string} */ (r3).includes('aaa.exe'), `原因应列出实际候选(aaa.exe),实际:${String(r3)}`);
    must(/** @type {string} */ (r3).includes('bbb.exe'), `原因应列出全部候选(bbb.exe),实际:${String(r3)}`);
    // 档四:齐备 ⇒ null。**必须是 null**:返回空串或 undefined 会让
    // `blocked !== null` 的守卫失效,于是「跑不了」被当成「能跑」。
    touch(root, 'win-unpacked/应用.exe');
    eq(preflight({ source: 'unpacked', unpackedDir: missingDir, exeOption: undefined, productName }), null, '齐备时的预检结果');
    // 档五:候选不唯一但显式 --exe ⇒ 可跑(--exe 就是为这个场景准备的)。
    touch(root, 'win-unpacked/zzz.exe');
    eq(preflight({ source: 'unpacked', unpackedDir: missingDir, exeOption: path.join(missingDir, 'zzz.exe'), productName }), null, '显式 --exe 时的预检结果');
    return '四档缺失原因 + 两档可跑';
  });
});

await check('process:removeScratch 清掉整棵树,且对不存在的路径幂等(不抛)', ({ must }) => {
  withTmp((root) => {
    const scratch = path.join(root, 'scratch');
    mkdirSync(path.join(scratch, 'm2w-smoke-abc', 'nested'), { recursive: true });
    touch(root, 'scratch/m2w-smoke-abc/user-data.json', '{}');
    removeScratch(scratch);
    must(!existsSync(scratch), 'removeScratch 后目录应不存在');
    // 幂等:清理失败只告警不抛(残留只是 output/ 下的空壳,不该把清理噪声变成冒烟失败)。
    // 一个改成 rmSync 不带 force 的实现会在第二次调用时抛 ENOENT —— 而 CLI 是在 finally
    // 之外调它的,抛出去就等于把「冒烟结果」换成了「清理异常」。
    removeScratch(scratch);
    removeScratch(path.join(root, 'never-existed'));
    return '清空 + 幂等';
  });
});

/* ---------- cli 层:只切不 spawn 进程的路径 ---------- */
await check('cli:--help → exit 0、打印用法、且不落任何盘', async ({ must, eq }) => {
  const { value, stdout } = await captureConsole(() => main(['--help']));
  eq(value, EXIT.pass, '--help 的退出码');
  must(stdout.includes('用法'), '应打印用法');
  must(stdout.includes('退出码'), '用法里必须写明退出码语义(尤其 2 与 0 的区分)');
  must(stdout.includes('未执行'), '用法里应说明「未执行」这一档');
  // --help 必须**只**打印用法:任何一次落盘都是副作用,会让「看个帮助」在真实工作树里留产物。
  must(!stdout.includes('报告已写出'), '--help 不该写出报告');
  return `exit ${String(value)}`;
});

await check('cli:无法识别的参数/非法 --source/非法 --timeout → exit 1(参数写错必须显式失败)', async ({ must, eq }) => {
  // parseArgs 对未知选项是抛错的:main 捕获后返回 fail。**绝不能**静默按默认值跑 ——
  // 「--soruce unpacked」被忽略掉就会跑一次 unpacked 冒烟,产出一份「看起来通过」的报告。
  const unknown = await captureConsole(() => main(['--soruce', 'unpacked']));
  eq(unknown.value, EXIT.fail, '未知选项的退出码');
  must(unknown.stderr.includes('无法识别的选项'), `应点名无法识别的选项,实际:${unknown.stderr}`);
  const badSource = await captureConsole(() => main(['--source', 'bogus']));
  eq(badSource.value, EXIT.fail, '非法 --source 的退出码');
  must(badSource.stderr.includes('--source 只接受 dev|unpacked'), `应说明合法取值,实际:${badSource.stderr}`);
  for (const timeout of ['abc', '-1', 'NaN']) {
    const bad = await captureConsole(() => main(['--timeout', timeout]));
    eq(bad.value, EXIT.fail, `--timeout ${timeout} 的退出码`);
    must(bad.stderr.includes('--timeout 须为非负毫秒数'), `--timeout ${timeout} 应给出该诊断,实际:${bad.stderr}`);
  }
  return '未知选项 / 非法 source / 非法 timeout 三族';
});

await check('cli:前置缺失 → exit 2 + 如实写出 not-run 报告,且不打印「启动」行(证明没 spawn)', async ({ must, eq }) => {
  // 这一档是本族「没跑 ≠ 通过」在**装配层**的落点,且全程零 spawn:main 在 preflight 拦下后
  // 直接 return EXIT.notRun,根本走不到 runSmokeProcess。落点重定向到系统临时目录,
  // 真实工作树不被写。
  await withTmpAsync(async (root) => {
    const outPath = path.join(root, 'artifacts', 'smoke-report.json');
    const { value, stdout, stderr } = await captureConsole(() =>
      main(['--source', 'unpacked', '--unpacked', path.join(root, 'no-such-unpacked'), '--out', outPath]),
    );
    eq(value, EXIT.notRun, '前置缺失的退出码(必须是 2,不能是 0)');
    must(!stdout.includes('启动'), `前置缺失时不得打印「启动」行(说明它没走到 spawn),实际 stdout:\n${stdout}`);
    must(stderr.includes('冒烟未执行'), '应明确报告「未执行」');
    must(stderr.includes(`exit ${String(EXIT.notRun)}`), '诊断里应写明退出码');

    const raw = readFileSync(outPath, 'utf8');
    const report = JSON.parse(raw);
    eq(report.status, REPORT_STATUS.notRun, '落盘报告的 status');
    eq(report.executed, false, '落盘报告的 executed');
    eq(report.markerContract, null, '落盘报告的 markerContract');
    must(Array.isArray(report.problems) && report.problems.length > 0, '落盘报告的 problems 不得为空');
    must(report.problems[0].startsWith('未执行:'), `problems 首条应以「未执行:」开头,实际:${String(report.problems[0])}`);
    must(!raw.includes(root), `落盘报告里残留了临时目录绝对路径 ${root} —— 脱敏被摘掉了`);
    // 未执行时不得留下 .log:留痕只发生在「跑了但没过」之后。
    must(!existsSync(`${outPath}.log`), '未执行时不应写出 .log 留痕(那是「跑了没过」的产物)');
    return `exit ${String(value)}、报告 status=${report.status}`;
  });
});

/* ---------- 注入 / 撤销成对 ---------- */
await check('注入/撤销:同一份 result 只换退出码,problems 必须跟着翻面(判定跟着输入走)', ({ must }) => {
  const base = okResult();
  const green = buildSmokeReport({ result: base, source: LABEL });
  const red = buildSmokeReport({ result: { ...base, code: 5 }, source: LABEL });
  must(Array.isArray(green.problems) && green.problems.length === 0, `同一份输出 + 退出码 0 应零问题,实际:${green.problems.join(' | ')}`);
  must(red.problems.length > 0, '同一份输出 + 退出码 5 应判红,实际零问题 —— 判定不跟着输入走');
  must(red.problems.join('\n') !== green.problems.join('\n'), '判红与判绿的诊断正文完全相同 —— 诊断没有跟着结论走');
  must(red.status === REPORT_STATUS.fail && green.status === REPORT_STATUS.pass, '状态必须跟着 problems 归一');
  return '注入判红、撤销判绿';
});

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 记账单位的变化:搬迁前同一档内的多条 push 各自累积成多条 `failures` 项(只 push 不抛),
// 分母是手写自增的 `caseCount`;搬迁后一档一 case,分母恒为 `suite.results.length`
// (= 32),成败读 `suite.failures`(任一条 case 红即非零退出)。档内全报的口径没变(见
// `check()` 里的 `errors[]`):一条 case 红时,它档内所有对不上的断言仍在同一条失败消息里。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) console.error(`[smoke-report-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  console.error(`[smoke-report-selftest:fail] 冒烟报告族回归守护失败,共 ${failedCases.length}/${String(cases.length)} 条`);
  process.exit(1);
}
console.log(`[ok] smoke-report-selftest:${String(cases.length)} 条夹具全部符合预期(全绿通过 / 逐族判红 / 零 spawn)`);

/**
 * 在 mkdtemp 临时目录里跑一段**异步**夹具(CLI 档需要 await),结束必删。
 * @template T
 * @param {(root: string) => Promise<T>} body 夹具体
 * @returns {Promise<T>} 夹具体返回值
 */
async function withTmpAsync(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'smoke-report-selftest-'));
  try {
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}