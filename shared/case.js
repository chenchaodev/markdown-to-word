// @ts-check
/**
 * case 级断言契约的**真实现**(ADR-074 决定一,从 `test/harness/case.js` 搬来)。
 *
 * 为什么落在 `shared/` 而不是留在测试树:门禁自测(`gates/` 下的 `.selftest.mjs`)要复用
 * 同一套 case 机制才能让「case 数」成为护栏的**唯一计数单位**,而
 * `gates-stay-in-gates` 的允许面只有 `gates` / `shared` / `test/fixtures`,
 * `test/` 整棵树不在其中。给 allow 加 `test/harness` 会在两棵树之间开出双向合法边
 * (否决理由见 ADR-074 备选方案一),故走「真实现落 shared、原路径留门面」。
 *
 * 原路径 `test/harness/case.js` 是 `export *` 门面,段侧的 `CASE_MODULE_REL`
 * (`check-test-layout.mjs` 白名单的是**一个精确路径**)因此逐字不动。
 *
 * ⚠ **搬迁的代价,读本注前先分清三条事实(2026-10-09 实测)**:
 * ① **`no-undef` 这一条搬迁前后都没有** —— `eslint.config.js:95` 那块的 `files`
 *    不含 `test/**`,故本文件原来在 `test/` 下就没有 `no-undef`。**不是收益。**
 * ② **但 lint 的其余部分是真的丢了** —— lint 串是 `eslint src/ test/ gates/ tools/`,
 *    **不含 `shared/`** ⇒ 本文件从「被扫」变成「完全不被扫」。改法已登记 REQ-237,
 *    不在本工作项写域;代偿是单独跑 `npx eslint shared/case.js`(与 `npm run lint`
 *    是两条不同路径,那个退出码才有信息量)。
 * ③ **唯一真收益是 `@ts-check` 从装饰变成真的** —— `tsconfig.test.json` 的 `include`
 *    只有 `test`,而门面 import 本实现 ⇒ 本实现必然进 program。**别把 ① 记成 ③。**
 *
 * 用法(段内):
 *   const suite = createCaseSuite();
 *   await suite.case("escapeRegExp 特殊字符全转义", () => { assert(cond, msg); });
 *   return { cases: suite.results };
 *
 * 约定:
 * - case 内抛错只记该 case 失败,不影响后续 case(段级成败由 runner 依 case 结果判定),
 *   这样单段内一次跑完可见全部失败面,不必反复重跑定位;
 * - suite.describe(title, fn) 只给其内 case 名加分组前缀,无额外语义;
 * - suite.attach(name, buffers) 登记该段已产生的产物 buffer(形状同
 *   artifacts.saveArtifact:{docx?, pdf?});**仅失败段**把快照写到
 *   output/artifacts/failures/<段名>/(见 artifacts.saveFailureArtifacts),
 *   成功段不写;引用串随 case 结果上送,便于报告与失败日志指向具体附件;
 * - 段 run() 以 `return { cases: suite.results }` 把结果交回 runner;漏回传时 runner
 *   兜底取本模块登记的 suite(见 drainSuites),避免「登记了却静默判过」;
 * - setCaseProgressSink:可选的 case 结算观察钩子,逐段子进程隔离下由宿主用于
 *   落盘"超时前已完成进度"(被硬终止的段仍留证据);同进程模型无消费者。
 *
 * 未接入本契约的旧段行为不变:抛错即段失败,runner 按段级处理(报告无 case 行)。
 */

/**
 * @typedef {object} ArtifactBuffers 产物 buffer 集合(形状与 artifacts.saveArtifact 一致)
 * @property {Buffer} [docx]
 * @property {Buffer} [pdf]
 */

/**
 * @typedef {object} ArtifactSnapshot 登记待快照的产物
 * @property {string} name 产物名(不含扩展名)
 * @property {ArtifactBuffers} buffers
 */

/**
 * @typedef {object} CaseResult 单个 case 的结果
 * @property {string} name case 名
 * @property {string} [group] describe 分组前缀(无分组则缺省)
 * @property {boolean} ok
 * @property {number} ms
 * @property {string} [message] 失败消息
 * @property {string} [stack] 失败栈
 * @property {string[]} attachments 附件引用(attach 登记的产物文件名)
 */

/**
 * 段执行期间登记的 suite 容器(case/snapshots 数组引用固定,便于外部事后读取)
 * @type {{ cases: CaseResult[], snapshots: ArtifactSnapshot[] }[]}
 */
const registered = [];

/**
 * case 结算观察钩子(可选,默认 null):每结算一个 case 回调一次(传入该 suite 的活数组)。
 * 逐段子进程隔离下由宿主用它把"超时前已完成进度"增量落盘(见 setCaseProgressSink),
 * 使被硬终止的段仍能留下已完成 case 的证据;同进程模型下无消费者,零开销。
 * @type {((cases: CaseResult[]) => void) | null}
 */
let progressSink = null;

/**
 * 登记/注销 case 结算观察钩子(段执行期由宿主注册,写完最终结果后注销,
 * 避免迟到的结算再覆盖已完成的回传文件)。
 * @param {((cases: CaseResult[]) => void) | null} sink 钩子;传 null 注销
 */
export function setCaseProgressSink(sink) {
  progressSink = sink;
}

/**
 * 断言辅助:条件不成立即抛错(message 即失败消息,进入 case 结果与失败日志)。
 * @param {unknown} condition 判定条件
 * @param {string} message 失败消息(写可验证事实,勿写"断言失败"这类空话)
 */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * 创建 case 收集器(测试段入口处创建一次,段末把 results 交回 runner)。
 */
export function createCaseSuite() {
  /** @type {CaseResult[]} */
  const cases = [];
  /** @type {ArtifactSnapshot[]} */
  const snapshots = [];
  const snapshotNames = new Set();
  /** @type {CaseResult | undefined} 当前执行中的 case(attach 归户用) */
  let active;
  let group = "";

  /**
   * 登记一个产物快照;同名产物先到先得(保留最早状态,便于复现首个出错点)。
   * @param {string} name 产物名(不含扩展名)
   * @param {ArtifactBuffers} buffers 产物 buffer
   * @returns {string[]} 附件引用(文件名),同时挂到当前 case 的 attachments
   */
  function attach(name, buffers) {
    if (!snapshotNames.has(name)) {
      snapshotNames.add(name);
      snapshots.push({ name, buffers });
    }
    const refs = Object.keys(buffers).map((ext) => `${name}.${ext}`);
    if (active) active.attachments.push(...refs);
    return refs;
  }

  /**
   * 登记并执行一个 case(失败不抛,只记结果)。
   * @param {string} name case 名
   * @param {() => unknown | Promise<unknown>} fn case 主体(抛错即该 case 失败)
   * @returns {Promise<CaseResult>}
   */
  async function runCase(name, fn) {
    const start = Date.now();
    /** @type {CaseResult} */
    const result = { name, ok: true, ms: 0, attachments: [] };
    if (group) result.group = group;
    cases.push(result);
    active = result;
    try {
      await fn();
    } catch (err) {
      result.ok = false;
      result.message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && typeof err.stack === "string") result.stack = err.stack;
    } finally {
      result.ms = Date.now() - start;
      active = undefined;
      // 进度留痕:订阅方(子进程宿主)据此把"已完成部分"落盘,段被硬终止也不丢证据;
      // 必须在 finally 内(通过路径不走 try 之后的语句)
      progressSink?.(cases);
    }
    return result;
  }

  /**
   * 分组:其内 case 名带分组前缀,便于报告按主题聚类。
   * @param {string} title 分组名
   * @param {(suite: ReturnType<typeof createCaseSuite>) => Promise<void>} body 分组主体
   */
  async function describe(title, body) {
    const previous = group;
    group = title;
    try {
      await body(api);
    } catch (err) {
      // 分组主体自身抛错(如读 dist 产物失败)归不进具体 case,记为一条占位 case 留痕
      await runCase("分组主体执行失败", () => {
        throw err;
      });
    } finally {
      group = previous;
    }
  }

  const api = {
    // case 是保留字,不能作绑定标识符(声明用 runCase,对外键名仍为 case)
    case: runCase,
    describe,
    attach,
    /** case 结果(浅拷贝,调用方拿到的是快照而非活数组) */
    get results() {
      return [...cases];
    },
    /** 失败 case 子集 */
    get failures() {
      return cases.filter((c) => !c.ok);
    },
    /** 登记待快照的产物(交给失败产物落盘) */
    get artifacts() {
      return [...snapshots];
    },
    get hasFailures() {
      return cases.some((c) => !c.ok);
    },
  };

  registered.push({ cases, snapshots });
  return api;
}

/**
 * 取走并清空已登记的 suite 容器:runner 在每段执行结束后调用,作为段 run()
 * 未回传 case 结果时的兜底(同时防止残留串到下一段)。
 * 逐段子进程隔离下,每段进程内至多一个 suite 串到本段结果,跨段串扰已消除
 * (同进程回退模型下,看门狗超时的悬挂段无法终止,它**之后**新建的 suite 仍会
 * 被下一段取走——这是回退模型的固有局限,切回默认隔离模型即消失)。
 * @returns {{ cases: CaseResult[], snapshots: ArtifactSnapshot[] }[]}
 */
export function drainSuites() {
  return registered.splice(0, registered.length);
}
