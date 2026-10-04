// 打包产物 smoke 冒烟门禁**判定本体**(gates/smoke/smoke-proc.mjs 的 collectSmokeProblems)
// 自身的负向夹具。
//
// 这道判定是整个 smoke 族的**判定面**,而它的失效形态不是「恒红」而是**恒绿**:
// `SMOKE_MARKERS`(:31-37)是「判定面」与实现面(src/main/smoke.ts 的 console.log 字面量)
// 之间的**唯一契约**,而 collectSmokeProblems 就是执行这份契约的那段代码。它一旦退化成
// 「不管输出是什么都返回空数组」(marker 过滤被摘掉 / 循环条件写反 / `includes` 写成
// `startsWith` 之外的宽松匹配 / 退出码分支被吞),三个消费端(check-unpacked-smoke /
// check-install-smoke / smoke-report)会同时拿到一份「通过」的报告 —— 发布侧据此认为
// 产物冒过烟,实际上一条 marker 都没打出来。故此处逐档注入故障,断言判据确实以**非空问题
// 列表**拒绝,并断言撤销后回到零问题。
//
// 形态:**只有纯函数档**(判定本体与 CLI 分离,与 gates/smoke/check-build-fresh.selftest.mjs
// 同款的「判定本体可注入」那一半)。直接 import 判定本体 —— 它已经是「结果进、问题数组出」
// 的形状,**无需为可注入而改动门禁本体**。
//
// ⚠ **刻意放弃的那一格:进程级 / 端到端档(真起 Electron 跑 `--smoke`)。** 理由有两条,
// 缺一条都会留下「以为守住了」的窗口:
//   1. **判定本体没有 CLI 可跑**:`smoke-proc.mjs` 无 `main()`、无 `process.argv[1]` 入口
//      守卫,是纯原语库(进程原语 + 纯函数)。build-fresh 的进程级档能成立是因为它自己是 CLI;
//      这里照抄那一档会得到一个「跑不起来」的档位,不是覆盖。
//   2. **端到端档的被测对象会散到本族之外**:`--smoke` 的参数解析住在 `src/main/index.ts:19`
//      (`process.argv.includes("--smoke")`)与 `src/main/smoke.ts`(真实窗口采样与转换),
//      **都不在 `gates/smoke/` 下**。把它写成夹具,守的就是 `src/` 那侧的分支可达性,与本族
//      「退出码 + 五条 marker 这条口径」的判据不同源;而 src 侧那层另有既有守护
//      (`test/behavior/packaged-smoke.test.js` 断言 marker 字面量在 dist/main/smoke.js 内
//      恒等、且 `--smoke` 分支不经任何 test/ 路径)。
// ⇒ 本档的边界就是**判定面本身**:退出码族、标记缺失族、spawnError 族、超时族的取舍与
//    措辞。实现面(真的打出那五条 marker)不归本档。
//
// ⚠ **不与既有段重复的那一半**:「五条标记 + 退出码 0 = 通过 / 非零 = 判红」这条口径在
// `test/behavior/packaged-smoke.test.js` 里有**一段**正例+两个负例(退出码 1、缺两条 marker)。
// 那一段是验收段、只在链内跑一次,且**只守纯函数契约这一小块**;本档把它展开成逐族的
// 边界矩阵(分支互斥 / 参数透传 / 措辞可归因 / 包含判定的精度),两处不重写、只做互补。
//
// ✅ 关于隔离:本档**不写任何文件、不起任何进程**,输入全是内存里的合成对象(退出码 / 输出
// 串 / spawnError),故不存在「读到真实工作树」的余地 —— 这比「跑在临时目录里」更强一档。
// 唯一的 IO 是 ESM 静态 import 读取被测模块自身(判定本体的仓内依赖 shared/userdata.js
// 只有函数定义、无顶层副作用)。
//
// ✅ 恒绿防护落在三处,少一格都会退化:
//   - 每条负向档都断言 `problems.length > 0` **且**命中预期片段(空数组 ⇒ 夹具报错);
//   - 每条负向档都带 `forbid`(断言诊断**没有**多说什么 —— 一个把所有 marker 与所有失败原因
//     串成一段话、或反过来什么都不说的退化实现,两头都要被拦);
//   - 合成输出由 `okOutput()` 统一生成,并在正向锚点档**回读确认它真的含全部 token** ——
//     否则「夹具因为没造出成功运行」而全绿,那正是本脚本要拦的假通过。

import { SMOKE_MARKERS, collectSmokeProblems } from './smoke-proc.mjs';

/** 全部诊断标记都齐、且退出码为 0 的一份合成运行(正向锚点的输入) */
function okOutput() {
  return SMOKE_MARKERS.map((marker) => `${marker.token} fixture`).join('\n');
}

/**
 * 只含前 n 条标记的合成输出(缺标记那一档的输入)。
 * @param {number} n 保留前几条标记
 * @returns {string} 合成输出
 */
function outputWithFirst(n) {
  return SMOKE_MARKERS.slice(0, n).map((marker) => `${marker.token} fixture`).join('\n');
}

/** 断言用的标签(诊断前缀;两处消费端传的是「unpacked smoke」/「<tag>安装后 smoke」这类) */
const LABEL = '夹具';

/**
 * 从诊断正文里取出「点名了哪些 marker」那一段(「输出缺少诊断标记:」之后、「(期望全部命中」之前)。
 *
 * 为什么需要单独取段:`forbid` 断的是「诊断**没有**多点名别的 marker」,而诊断末尾那句
 * 「期望全部命中:」**故意**列了全部 token —— token 与 label 是两个串,有些 label 本身就是
 * token 的子串(如 label「pdf 书签」⊂ token「[smoke] pdf 书签 ok:」)。拿整段正文做 forbid
 * 匹配会把「附带的期望清单」误报成「多点名了一条」⇒ 夹具自身假红。
 * @param {string} joined 诊断正文
 * @returns {string} 点名段(没有缺失诊断时为空串)
 */
function namedSegment(joined) {
  const matched = /输出缺少诊断标记:(.*?)(?:\(期望全部命中|$)/s.exec(joined);
  return matched === null ? '' : /** @type {RegExpExecArray} */ (matched)[1];
}

/** @type {string[]} */
const failures = [];

/**
 * 跑一档并按声明核对结果。三种声明互斥:`expectClean`(要求零问题)、`expect`(要求非空且
 * 命中)、以及可叠加的 `forbid` / `expectCount`。
 * @param {object} testCase 用例
 */
function run(testCase) {
  try {
    const problems = collectSmokeProblems(testCase.result, { label: testCase.label ?? LABEL, markers: testCase.markers });
    const joined = problems.join('\n');
    /** @type {string[]} */
    const wrong = [];
    if (testCase.expectClean === true) {
      if (problems.length !== 0) wrong.push(`期望零问题,实际 ${problems.length} 条:${joined}`);
    } else {
      // 恒绿防护:先断「非空」,再断「命中」。顺序重要 —— 一个恒绿实现会在这里被第一条拦下,
      // 报出的根因指向「判定不判红」而不是「措辞变了」。
      if (problems.length === 0) {
        wrong.push('期望判红,实际零问题 —— 判定在该形态上恒绿了(夹具故障没注入成功,或判据本身退化了)');
      } else if (!testCase.expect.test(joined)) {
        wrong.push(`期望问题清单匹配 ${testCase.expect},实际:${joined}`);
      }
    }
    if (testCase.expectCount !== undefined && problems.length !== testCase.expectCount) {
      wrong.push(`期望恰好 ${String(testCase.expectCount)} 条问题,实际 ${problems.length} 条:${joined}`);
    }
    const forbiddenHits = (testCase.forbid ?? []).filter((needle) => joined.includes(needle));
    if (forbiddenHits.length > 0) {
      wrong.push(`诊断里出现了不该出现的片段:${forbiddenHits.join(' / ')} —— 该族判定必须只说自己那一族的事`);
    }
    // forbidNamed 单独对着「点名段」判:诊断末尾那句「期望全部命中」会列出全部 token,而部分
    // label 本身就是 token 的子串(label「pdf 书签」⊂ token「[smoke] pdf 书签 ok:」)——
    // 拿整段正文匹配会把「附带的期望清单」误报成「多点名了一条」。
    const named = namedSegment(joined);
    const namedHits = (testCase.forbidNamed ?? []).filter((needle) => named.includes(needle));
    if (namedHits.length > 0) {
      wrong.push(`点名段里出现了不该出现的 marker:${namedHits.join(' / ')} —— 点名必须只点缺的那几条(实际点名段:${named})`);
    }
    if (wrong.length > 0) {
      failures.push(`${testCase.name}:${wrong.join('; ')}`);
    } else {
      const shown = testCase.expectClean === true ? '零问题' : `${problems.length} 条问题`;
      console.log(`[ok] smoke-proc-selftest:${testCase.name}(${shown})`);
    }
  } catch (error) {
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ---------- 夹具表 ---------- */

const CASES = [
  /* ===== 退出码族 ===== */
  {
    // 正向锚点:这一档必须绿且 problems 为空 —— 它同时是「恒绿防护」的基准线。
    // 若判定退化成「怎么都判红」,下面所有负向档照样会全过(它们只断非空),只有这一档拦得住。
    name: '正向锚点:五条标记齐 + 退出码 0 → 零问题',
    result: { code: 0, signal: null, timedOut: false, output: okOutput() },
    expectClean: true,
    expectCount: 0,
  },
  {
    // 本族存在的头号理由:冒烟进程非零退出。
    // forbid「缺少诊断标记」证明两族是**各自独立**的:输出明明带齐五条标记,却仍因退出码判红。
    // 少了这一条 forbid,一个「只查标记、不看退出码」的实现能通过本格 —— 那正是恒绿的一种形态。
    name: '退出码非 0(输出带齐标记)→ 只因退出码判红,不牵连标记族',
    result: { code: 1, signal: null, timedOut: false, output: okOutput() },
    expect: /夹具 退出码为 1,期望 0/,
    expectCount: 1,
    forbid: ['缺少诊断标记', '启动失败', '硬超时'],
  },
  {
    // 措辞可归因:诊断必须写出**实际那个**退出码。写成固定文案「退出码非 0」的实现能通过
    // 「判红」这一半,但发布侧拿到报告后不知道该去看哪个码 —— 与 build-fresh 那族
    // 「诊断必须点名具体文件」是同一条纪律,故本格逐字断言。
    name: '退出码非 0 → 诊断逐字写出实际退出码(不写成固定文案)',
    result: { code: 42, signal: null, timedOut: false, output: okOutput() },
    expect: /夹具 退出码为 42,期望 0/,
  },
  {
    // 被信号终止的形态:code 为 null。此时走的是「退出码 ≠ 0」那一族(判据写的是 `code !== 0`,
    // null 同样不等于 0)。
    //
    // ⚠ 刻意**只**钉「判红且提到退出码为 null」,**不 forbid 诊断提到信号名** —— 当前措辞不提
    // 信号,那是现状不是契约;将来若把信号名补进诊断(诊断性更好),本格不该因此报红。反过来,
    // 「信号终止却判绿」是**实打实的恒绿**,必须被拦 —— 这才是本格存在的意义。
    name: 'signal 非空(被信号终止,code 为 null)→ 判红(信号终止不得判绿)',
    result: { code: null, signal: 'SIGTERM', timedOut: false, output: okOutput() },
    expect: /夹具 退出码为 null,期望 0/,
    expectCount: 1,
  },

  /* ===== 标记缺失族 ===== */
  {
    // 缺**一条**:点名那一条,且只点名它(forbid 挡的是「把所有 marker 名都列一遍」的退化写法)。
    name: '缺一条标记 → 点名那一条、且不牵连其它标记',
    result: { code: 0, signal: null, timedOut: false, output: outputWithFirst(4) },
    expect: /夹具 输出缺少诊断标记:IPC 接线诊断/,
    expectCount: 1,
    forbidNamed: ['docx 转换', 'pdf 转换', 'pdf 书签', 'renderer 诊断'],
  },
  {
    // 缺**多条**:逐条点名且顺序与 SMOKE_MARKERS 一致。
    // 「逐条点名」是这一族的承重能力:消费者(smoke-report 的缺失清单)直接把这段文案拆成条目,
    // 只笼统说「缺少标记」的话,发布侧得自己回去比对才知道缺了哪几条。
    name: '缺三条标记 → 三条全点名、顺序与清单一致',
    result: { code: 0, signal: null, timedOut: false, output: outputWithFirst(2) },
    expect: /夹具 输出缺少诊断标记:pdf 书签、renderer 诊断、IPC 接线诊断/,
    expectCount: 1,
    forbidNamed: ['docx 转换', 'pdf 转换'],
  },
  {
    // 「期望全部命中」那半句是消费者定位用的(让人知道该期待什么)。它是**附带的**,
    // 不是承重的;本格只断它在、不逐字断格式(格式是措辞不是语义,钉死会让文案微调都红)。
    name: '缺标记时附带「期望全部命中」清单(便于定位该期待什么)',
    result: { code: 0, signal: null, timedOut: false, output: '' },
    expect: /期望全部命中:.*\[smoke\] convert ok:.*\/.*\[smoke\] ipc diag:/,
    expectCount: 1,
  },
  {
    // 空输出:全部五条都缺。这是「真的什么都没打出来」那一档 —— 冒烟启动即崩的典型形态。
    name: '输出为空 → 五条标记全被点名',
    result: { code: 0, signal: null, timedOut: false, output: '' },
    expect: /输出缺少诊断标记:docx 转换、pdf 转换、pdf 书签、renderer 诊断、IPC 接线诊断/,
  },
  {
    // 退出码与标记**同时**坏:两族并存。少了这一格,一个写成 `if/else if` 链的实现
    // (第二族被第一族吃掉)能通过前面所有档 —— 那个实现在真实故障里会**漏报**。
    name: '退出码非 0 且缺标记 → 两族并存(不是 if/else 链)',
    result: { code: 3, signal: null, timedOut: false, output: outputWithFirst(4) },
    expect: /夹具 退出码为 3,期望 0.*缺少诊断标记/s,
    expectCount: 2,
  },

  /* ===== 标记包含判定的精度(恒绿的主要藏身处) ===== */
  {
    // 近似的 token:缺尾冒号(`[smoke] convert ok`)。判定用的是精确子串 `includes`,
    // 少一个字符就**不算命中**。这一格防的是「把 token 收尾符号去掉 / 改成 trim 后比较」
    // 这类让契约变松的改动 —— 松了就等于「实现面少打一个字也照样绿」。
    name: 'token 差一个尾字符(缺冒号)→ 判红(包含判定不许变松)',
    result: {
      code: 0,
      signal: null,
      timedOut: false,
      output: SMOKE_MARKERS.map((m) => `${m.token} fixture`).join('\n').replace('[smoke] convert ok:', '[smoke] convert ok '),
    },
    expect: /输出缺少诊断标记:docx 转换/,
    expectCount: 1,
  },
  {
    // 刻意钉住的既有语义:**纯子串包含,不看位置、不看顺序、不要求独占一行**。
    //
    // 为什么钉它而不是放过:这不是「缺陷」,是**已声明的口径** —— smoke-report/markers.mjs
    // 的头注写着「只做「文本包含」判定(与 collectSmokeProblems 同口径)」。两份判定层必须
    // 同口径,否则同一份输出在「报告」与「门禁」两侧会给出不同的通过/失败结论。若将来要
    // 收紧成行首锚定,那是一次**口径变更**,必须显式改这份夹具并同步 markers.mjs ——
    // 静默收紧才是真正的风险。
    name: '标记出现在非预期位置(顺序颠倒 / 嵌在噪声行内)→ 判绿(口径是纯子串包含)',
    result: {
      code: 0,
      signal: null,
      timedOut: false,
      output: `[smoke] ipc diag:   ok\nsome noise\n  [smoke] renderer diag: ok\n${SMOKE_MARKERS.slice(0, 3).map((m) => `${m.token} x`).join('\r\n')}\n[smoke] convert ok: done`,
    },
    expectClean: true,
    expectCount: 0,
  },

  /* ===== spawnError 族 ===== */
  {
    // 启动失败(exe 不存在是最常见的一态)。点名的是 error.message,发布侧据此能区分
    // 「产物启动不了」与「产物启动后判定没过」。
    name: 'spawnError 存在 → 判红并点名 error.message',
    result: { code: null, signal: null, timedOut: false, output: '', spawnError: new Error('spawn ENOENT') },
    expect: /夹具 启动失败:spawn ENOENT/,
    forbid: ['硬超时'],
  },
  {
    // spawnError 与退出码族是**互斥**的:实现里写的是 `else if (spawnError === undefined && code !== 0)`
    // —— 启动失败时 `code` 是 null,若不互斥就会同时报「启动失败」与「退出码为 null」两条,
    // 同一件事说两遍、且第二条会把根因（ENOENT）挤下去。
    name: 'spawnError 存在 → 不重复报「退出码为 null」(两族互斥)',
    result: { code: null, signal: null, timedOut: false, output: '', spawnError: new Error('spawn EACCES') },
    expect: /启动失败:spawn EACCES/,
    forbid: ['退出码为 null'],
  },

  /* ===== 超时族 ===== */
  {
    // 硬超时:进程没自行退出,已被硬杀进程树。
    name: 'timedOut → 判红并说明已硬杀进程树',
    result: { code: null, signal: null, timedOut: true, output: okOutput() },
    expect: /夹具 超过硬超时未自行退出,已硬杀进程树/,
    expectCount: 1,
    forbid: ['硬杀后仍未退出'],
  },
  {
    // 超时与退出码互斥:实现在超时那一支用 `else if`,故 code 非 0 也不重复报退出码。
    name: 'timedOut 且 code 非 0 → 只报超时(两族互斥,不重复)',
    result: { code: 1, signal: null, timedOut: true, output: okOutput() },
    expect: /超过硬超时未自行退出/,
    expectCount: 1,
    forbid: ['退出码为'],
  },
  {
    // unterminated 是超时族内部的一档:硬杀之后**仍未退出** ⇒ 可能残留进程,
    // 那是要人去任务管理器收尸的形态,必须与「已终止」区分开。
    name: 'timedOut 且 unterminated → 追加「可能残留进程」告警',
    result: { code: null, signal: 'SIGKILL', timedOut: true, unterminated: true, output: okOutput() },
    expect: /超过硬超时未自行退出,已硬杀进程树\(硬杀后仍未退出,可能残留进程,请用任务管理器确认\)/,
  },
  {
    // 反向:unterminated 不是 true 时**不得**带那句告警(否则每次超时都在喊残留进程,
    // 喊多了就等于没喊)。
    name: 'unterminated 未置位 → 不带「可能残留进程」告警',
    result: { code: null, signal: null, timedOut: true, output: okOutput() },
    expect: /超过硬超时未自行退出/,
    forbid: ['可能残留进程'],
  },
  {
    // spawnError 与超时是**两个并列 if**(不是互斥):runProcess 在 spawn 抛错的路径上
    // 记 `timedOut:false`,但契约上二者可以同时为真(硬杀到点的同时句柄报错),此时两族都要报。
    // 这一格钉的是「并列」而非「互斥」—— 少一格的话,把其中一个改成 else if 也能过前面所有档。
    name: 'spawnError 与 timedOut 同时成立 → 两族都报(并列 if,不是互斥)',
    result: { code: null, signal: null, timedOut: true, output: okOutput(), spawnError: new Error('kill EPERM') },
    expect: /启动失败:kill EPERM.*超过硬超时/s,
    expectCount: 2,
  },

  /* ===== 参数透传 ===== */
  {
    // label 逐字透传:消费端靠它区分是解包目录那次还是安装目录那次。两处都传同名字符串时,
    // 报告里就分不出是哪一次冒烟了。
    name: 'label 逐字出现在每条诊断里(消费端靠它区分来源)',
    result: { code: 7, signal: null, timedOut: false, output: '' },
    label: 'unpacked smoke',
    expect: /unpacked smoke 退出码为 7,期望 0/,
  },
  {
    // markers 覆盖入参生效:传一条自定义标记,输出只含它 → 零问题。
    // 若实现把 `markers = SMOKE_MARKERS` 这个默认参数写死成直接引用 SMOKE_MARKERS,
    // 本格会因「另外四条缺了」而判红 ⇒ 覆盖入参这一格就被钉住了。
    name: 'markers 覆盖入参生效(只按传入的那一条判)',
    result: { code: 0, signal: null, timedOut: false, output: 'custom ok: fixture' },
    markers: [{ id: 'custom', label: '自定义标记', token: 'custom ok:' }],
    expectClean: true,
    expectCount: 0,
  },
  {
    // 覆盖入参的**反向**:传入的标记不在输出里 → 按传入的那一条判红,
    // 且不牵连默认清单(forbid 默认清单里那条的名字,证明没同时按 SMOKE_MARKERS 判)。
    name: 'markers 覆盖入参生效(传入的那条缺失 → 点名它,不牵连默认清单)',
    result: { code: 0, signal: null, timedOut: false, output: 'nothing here' },
    markers: [{ id: 'custom', label: '自定义标记', token: 'custom ok:' }],
    expect: /输出缺少诊断标记:自定义标记/,
    expectCount: 1,
    forbidNamed: ['docx 转换', 'IPC 接线诊断'],
  },
  {
    // 空 markers 列表:缺失族**不产出**任何问题(空集 filter 出空数组 ⇒ missing 为空)。
    // 这一格防的是「missing.length === 0 时也拼一句『缺少诊断标记:』」—— 那种诊断里会出现
    // 一个空的点名列表,发布侧看到的是「缺了这些标记:」后面什么都没有。
    name: 'markers 为空列表 → 不产出「缺少诊断标记」诊断(不出现空点名)',
    result: { code: 0, signal: null, timedOut: false, output: '' },
    markers: [],
    expectClean: true,
    expectCount: 0,
  },
];

/* ---------- 前提自检:夹具自身可信(恒绿防护的最内层) ---------- */
{
  const problems = [];
  if (SMOKE_MARKERS.length === 0) problems.push('SMOKE_MARKERS 为空 —— 全部夹具都会因「没有标记可缺」而失去意义');
  const tokens = SMOKE_MARKERS.map((m) => m.token);
  if (new Set(tokens).size !== tokens.length) {
    problems.push(`SMOKE_MARKERS 里有重复 token(${JSON.stringify(tokens)}) —— 「缺哪条」的点名会自相矛盾`);
  }
  const ok = okOutput();
  const notHit = tokens.filter((token) => !ok.includes(token));
  if (notHit.length > 0) {
    problems.push(`正向锚点的合成输出没含全这些 token:${notHit.join(' / ')} —— okOutput() 不可信,全绿是假通过`);
  }
  if (problems.length > 0) {
    failures.push(`前提自检:${problems.join('; ')}`);
  } else {
    console.log(`[ok] smoke-proc-selftest:前提自检(${String(SMOKE_MARKERS.length)} 条标记、token 互异、正向合成输出含全部 token)`);
  }
}

for (const testCase of CASES) run(testCase);

/* ---------- 注入 / 撤销成对(防「怎么都判红」的退化实现) ---------- */
// 只做「注入 ⇒ 红」时,一个 `return ["boom"]` 的退化实现能让上面全部负向档通过(它们只断非空,
// 只有 forbid 与 expect 会拦 —— 但那些都是逐档的,漏写一档就漏一处)。这一组把「同一份输出,
// 换掉退出码就翻面」做成显式断言:判红必须**跟着输入走**。
{
  const base = { code: 0, signal: null, timedOut: false, output: okOutput() };
  const green = collectSmokeProblems(base, { label: LABEL });
  const red = collectSmokeProblems({ ...base, code: 5 }, { label: LABEL });
  const problems = [];
  if (green.length !== 0) problems.push(`同一份输出 + 退出码 0 应判绿,实际:${green.join(' | ')}`);
  if (red.length === 0) problems.push('同一份输出 + 退出码 5 应判红,实际零问题 —— 判定不跟着输入走');
  if (green.length === 0 && red.length > 0 && red.join('\n') === green.join('\n')) {
    problems.push('判红与判绿的诊断正文完全相同 —— 诊断没有跟着判定结论走');
  }
  if (problems.length > 0) {
    failures.push(`注入/撤销成对:${problems.join('; ')}`);
  } else {
    console.log('[ok] smoke-proc-selftest:注入非零退出码判红、撤销后判绿(判定跟着输入走)');
  }
}

const total = CASES.length + 2;
if (failures.length > 0) {
  for (const failure of failures) console.error(`[smoke-proc-selftest:fail] ${failure}`);
  console.error(`[smoke-proc-selftest:fail] smoke 判定本体回归守护失败,共 ${failures.length}/${total} 条`);
  process.exit(1);
}
console.log(`[ok] smoke-proc-selftest:${total} 条夹具全部符合预期(全绿通过 / 逐族判红)`);
