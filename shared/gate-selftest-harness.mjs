// @ts-check
/**
 * 门禁自测的**合成根 harness**:入参是纯数据(假仓库树「路径 → 正文」+ 期望问题清单正则),
 * harness 自己把树落进系统临时目录、跑判定体、比对问题清单、把结果汇成 `createCaseSuite` 的 case。
 *
 * 依据 ADR-068(门禁自测走一个共享的合成根 harness)与 ADR-074(契约模块落点与表格化的真实边界)。
 * 六条边界,每条都有理由,**不要就地放宽**:
 *
 * ① **入参只能是纯数据。** 假仓库树是对象字面量、期望清单是正则数组,harness 自己落盘。
 *    一旦入参允许传函数或回调(「帮我造个目录」「跑完再断言一下」),harness 就退回成一个通用
 *    测试框架 —— 那正是 ADR-068 明文否决的终点。某个自测确实需要回调才能表达时,那是
 *    **「该用例不进表」**的判据,不是「harness 要支持回调」的判据(留在原处写 bespoke case)。
 *
 * ② **恒绿防护的顺序不可换:先断非空,再断命中。** 期望清单为空时 `expect.some(...)` 恒为
 *    false 判红,但若实现写成「零问题时直接判绿」,零扫描面下就恒绿。两种失效(「该情形下
 *    判据没有生效」与「措辞变了」)混着判会漏掉后者,故顺序照 `gates/smoke/smoke-proc.selftest.mjs`
 *    的既有形态抄。
 *
 * ③ **期望清单是「正则数组」而不是整串相等。** 问题清单的措辞会漂,逐条正则匹配是唯一既能
 *    容忍措辞漂移、又不放松判据的形态;也正因为期望**在表里**,「删一条断言 / 放宽一个期望值」
 *    才会在名册对账上留痕(这一层只能守 case 粒度,case 内部的削减机器看不见 —— 半齿性质见
 *    ADR-074 后果节,不要在汇报里说成「机器保证了断言一条未删」)。
 *
 * ④ **落盘在系统临时目录(`tmpdir()`),清理在 `finally`。** 落在仓内会变成一条该红的死指针
 *    (临时树会留在工作区、被扫描面扫到)。清理失败不吞,但也不能盖掉真正的断言失败。
 *
 * ⑤ **合成根里只有表里声明的东西。** 本模块**不预建** `gates/` `shared/` `test/` `tools/`
 *    这类空目录(既有 selftest 里的 `makeTree` 会预建,是因为那些判据遍历固定目录、缺一个就抛)。
 *    预建等于替判定体伪造输入结构:判据因此可能在**树里根本没有它要看的位置**时依然报出问题,
 *    恒绿防护第①条也就失去了诊断力。「判定体在合成根上抛错」不是 harness 的缺陷,是表里
 *    少铺了位置 —— 那要让 case 红着报出来。
 *
 * ⑥ **零出边 + 零依赖。** `shared/` 是零出边树(`gates/repo/check-import-boundary.mjs` 的
 *    `shared-no-out-edge`),故本模块只 import `node:` 内建与 `./case.js`,不引 `gates/`
 *    `test/` `tools/` `src/` 中的任何一个;不引第三方依赖(门禁要能在任意检出上零安装跑起来)。
 *    也不自算仓库根(判据 `no-self-computed-root`,根语义单源在 `shared/paths.js`)。
 *
 * 用法(判定体入参是临时根,返回问题清单字符串数组):
 *
 *   const { cases } = await runSyntheticRootCases({
 *     group: 'check-pointers',
 *     judge: (root) => collectPointerProblems(root),
 *     cases: [
 *       { name: '登记表缺行判红', files: { 'docs/REQ.md': BODY }, expect: [/载体缺失/] },
 *     ],
 *   });
 *   return { cases };
 */

/**
 * @typedef {object} SyntheticRootCase 表里的一行(**纯数据**,不许出现函数或回调)
 * @property {string} name case 名(名册与对账的计数单位;必填,同一张表内唯一)
 * @property {Record<string, string>} files 假仓库树:仓库相对 **POSIX** 路径 → 文件正文
 *   (必填。一条不铺 ⇒ 判定体可能在空扫描面上恒绿,见文件头第②条)
 * @property {RegExp | RegExp[]} expect 期望问题清单(必填,非空):每一条都要在问题清单里命中,
 *   不得带 `g` / `y` 标志(带 `lastIndex` 的正则在重复 `test` 时结果依赖调用次数)
 * @property {number} [expectCount] 期望恰好 N 条问题(可选,**只加严不放宽**)
 */

/**
 * @typedef {object} SyntheticRootRunOptions 一张表的运行参数
 * @property {(root: string) => string[] | Promise<string[]>} judge 判定体(必填):入参是合成根
 *   绝对路径,返回问题清单。需要额外参数的判定体由调用方闭包捕获,本模块不接 options。
 * @property {SyntheticRootCase[]} cases 用例表(必填)
 * @property {string} [group] case 名分组前缀(转达 `suite.describe`,便于报告按主题聚类)
 * @property {ReturnType<typeof createCaseSuite>} [suite] 复用调用方已有的 suite
 *   (段里同时还有 bespoke case 时用;不传则自建一个)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCaseSuite } from './case.js';

/** 临时根前缀:系统临时目录里一眼认出是本 harness 的产物,便于手工排查残留 */
const TMP_PREFIX = 'm2w-gate-selftest-';

/**
 * 异常归一(CODE-GUIDE:Error / 字符串 / 未知统一转可读文案)。
 * @param {unknown} error 捕获到的任意值
 * @returns {string} 可读文案
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 校验一个假仓库树路径。判红的是**形态**而不是内容 —— 路径形态错了,写出去的文件不在判定体
 * 看的那个位置上,而症状是「恒绿」或「一条莫名其妙的问题」,两者都极难往回追。
 *
 * 四条:`/` 分隔(Windows 上写反斜杠会在跨平台检出上指向另一个文件)· 非绝对路径 · 无 `..`
 * (否则 `mkdtemp` 的隔离被穿透) · 无空段(尾斜杠的「目录条目」不是文件条目)。
 * @param {string} rel 表里写的仓库相对路径
 * @returns {void}
 */
function assertTreePath(rel) {
  const fail = (why) => {
    throw new Error(`假仓库树条目路径不合法(${why}):${JSON.stringify(rel)}`);
  };
  if (rel === '') fail('空路径');
  if (rel.includes('\\')) fail('必须用 POSIX 分隔符 /');
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) fail('必须是仓库相对路径,不能是绝对路径');
  for (const segment of rel.split('/')) {
    if (segment === '') fail('有空段(尾斜杠的目录条目不是文件条目)');
    if (segment === '..') fail('不得含 ..');
  }
}

/**
 * 把假仓库树铺到合成根上(自动建父目录)。
 * @param {string} root 合成根绝对路径
 * @param {Record<string, string>} files 仓库相对 POSIX 路径 → 正文
 * @returns {void}
 */
function materialize(root, files) {
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(`files 必须是「路径 → 正文」的对象字面量,实际 ${describeValue(files)}`);
  }
  for (const [rel, body] of Object.entries(files)) {
    assertTreePath(rel);
    if (typeof body !== 'string') {
      throw new Error(`假仓库树条目 ${rel} 的正文必须是字符串,实际 ${describeValue(body)} —— 夹具内容进表必须是数据`);
    }
    const target = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    try {
      writeFileSync(target, body, 'utf8');
    } catch (error) {
      // 裸 fs 错误不带是哪个条目(典型:一条 `a/b` 与一条 `a/b/c` 相撞)
      throw new Error(`假仓库树条目 ${rel} 落盘失败:${describeError(error)}`);
    }
  }
}

/**
 * 值类型的可读描述(只用于报错文案)。
 * @param {unknown} value 待描述的值
 * @returns {string}
 */
function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组(长度 ${value.length})`;
  return typeof value;
}

/**
 * 归一期望清单:收成正则数组,并在**入表期**就把三种「表本身写错了」的形态拒掉。
 *
 * 为什么在这里拒而不是让断言去发现:空数组 / 非正则 / 带 `g` 的正则,失败症状分别是恒绿、
 * 「问题清单匹配 undefined」、以及「同一条 case 跑第二遍就绿」—— 全都不是表作者会往
 * 「判据坏了」上想的症状,当场拒掉省一轮往返。
 * @param {RegExp | RegExp[]} expect 表里写的期望清单
 * @returns {RegExp[]} 归一后的正则数组(非空)
 */
function normalizeExpect(expect) {
  /** @type {RegExp[]} */
  const list = Array.isArray(expect) ? expect : [expect];
  if (list.length === 0) {
    throw new Error('expect 不得为空数组 —— 期望清单为空的行恒绿、判红信息为零,这类行不进表(要断「零问题」请写 bespoke case)');
  }
  for (const pattern of list) {
    if (!(pattern instanceof RegExp)) {
      throw new Error(`expect 的元素必须是正则(问题措辞会漂,整串相等不是可维护的形态),实际 ${describeValue(pattern)}`);
    }
    if (pattern.global || pattern.sticky) {
      throw new Error(`expect 的正则不得带 g / y 标志:${String(pattern)} —— 带 lastIndex 的正则在重复 test 时结果依赖调用次数`);
    }
  }
  return list;
}

/**
 * 在系统临时目录里造一棵合成仓库树,跑一段夹具,结束(含中途抛错)必删。
 *
 * 清理失败**不吞**,但也不许盖掉真正的断言失败:body 已抛错时把两处并进一条 `AggregateError`
 * (断言消息仍在其中),body 未抛错时清理失败本身就是本次要报的错。
 * @template T
 * @param {Record<string, string>} files 假仓库树:仓库相对 POSIX 路径 → 正文
 * @param {(root: string) => T | Promise<T>} body 夹具体,入参是合成根绝对路径
 * @returns {Promise<Awaited<T>>} 夹具体返回值
 */
export async function withSyntheticRoot(files, body) {
  const root = mkdtempSync(path.join(tmpdir(), TMP_PREFIX));
  /** @type {unknown} */
  let failure;
  let failed = false;
  try {
    materialize(root, files);
    return await body(root);
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (cleanupError) {
      const detail = `清理合成根 ${root} 失败:${describeError(cleanupError)}`;
      if (!failed) throw new Error(detail, { cause: cleanupError });
      throw new AggregateError(
        [/** @type {Error} */ (failure), /** @type {Error} */ (cleanupError)],
        `${detail}(本次还有一处夹具失败,断言消息见本条的 errors)`,
      );
    }
  }
}

/**
 * 跑一行用例(建树 → 判定 → 恒绿防护 → 比对),失败即抛(由 suite 归户成 case 结果)。
 * @param {SyntheticRootCase} testCase 表里的一行
 * @param {(root: string) => string[] | Promise<string[]>} judge 判定体
 * @returns {Promise<void>}
 */
async function runSyntheticRootCase(testCase, judge) {
  // 入表期校验先做:表本身写错时不该先建树(白跑一次 IO,还留一个临时目录)
  const expectations = normalizeExpect(testCase.expect);
  const problems = await withSyntheticRoot(testCase.files, (root) => judge(root));
  if (!Array.isArray(problems)) {
    throw new Error(`判定体必须返回字符串数组(问题清单),实际 ${describeValue(problems)} —— harness 不代判定体断言,汇总与比对都在这里`);
  }
  const joined = problems.join('\n');
  /** @type {string[]} */
  const wrong = [];
  // 恒绿防护,顺序不可换:先断「非空」,再断「命中」。反过来写,零扫描面下 `expect.test('')`
  // 判 false 会判红一次,但实现一旦改成「零问题直接判绿」就整条恒绿,而第①条正是拦这个的。
  if (problems.length === 0) {
    wrong.push('期望判红,实际零问题 —— 判定在该形态上恒绿了(合成树没铺到判据看的那个位置,或判据本身退化了)');
  } else {
    const missed = expectations.filter((pattern) => !pattern.test(joined));
    if (missed.length > 0) {
      wrong.push(`期望问题清单命中 ${missed.map(String).join(' / ')},实际:${joined}`);
    }
  }
  if (testCase.expectCount !== undefined && problems.length !== testCase.expectCount) {
    wrong.push(`期望恰好 ${String(testCase.expectCount)} 条问题,实际 ${problems.length} 条:${joined}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
}

/**
 * 把一张用例表跑完,汇成 case。
 *
 * 返回值形状与段侧约定一致(`return { cases: suite.results }`),传了 `suite` 时它就是调用方那个
 * suite 的快照 —— 段里同时有 bespoke case 时,两种来源的 case 进同一份报告。
 * @param {SyntheticRootRunOptions} options 运行参数(判定体 + 用例表 + 可选分组/复用 suite)
 * @returns {Promise<{ cases: import('./case.js').CaseResult[] }>} case 结果
 */
export async function runSyntheticRootCases(options) {
  const suite = options.suite ?? createCaseSuite();
  /**
   * 逐行登记(一行一个 case;失败不抛,只记该 case 失败 —— 一次跑完可见全部失败面)。
   * @returns {Promise<void>}
   */
  const register = async () => {
    for (const testCase of options.cases) {
      await suite.case(testCase.name, () => runSyntheticRootCase(testCase, options.judge));
    }
  };
  if (options.group === undefined) await register();
  else await suite.describe(options.group, register);
  return { cases: suite.results };
}
