// @ts-check
/**
 * 门禁/测试入口的失败路径守卫(五个 Electron 入口共用**一份**实现,判定层纯函数 + 壳层薄):
 *   scripts/check-geometry.mjs(几何门禁,兼 worker 角色)、scripts/geometry/worker.mjs(角色体)、
 *   test/tools/visual-check.mjs(视觉自查)、test/acceptance.mjs(验收父进程)、
 *   test/common/segment-host.mjs(段子进程宿主)。
 *
 * 为什么需要它(Electron 43 + ESM 主入口,以下三条均为本机实测事实,非推断):
 * 1. **加载期抛错 = 静默挂死**:主模块求值抛错时 Electron 只打一句
 *    `App threw an error during load` + 原始错误与堆栈,然后**进程永不退出、无退出码**。
 *    门禁入口挂死的后果是 CI job 一直挂到 job 级超时,报出来的是「超时」而不是「门禁失败」——
 *    失败原因被超时吞掉,还白烧几分钟。
 * 2. **ready 回调内抛错 = 同样挂死**:`app.whenReady().then(cb)` 里 cb 抛错只产生
 *    `UnhandledPromiseRejectionWarning`(Electron 主进程把 Node 的 unhandled-rejections
 *    降级成 warn,不像纯 Node 那样终止进程),进程继续活着 → 同样挂到超时。
 * 3. **`app.quit()` + `process.exitCode = 1` 会退出 0**:quit 走自身退出路径,实测退出码是 0。
 *    「失败但退出 0」比挂死更糟(门禁变成永远通过),故成功/失败一律用 `app.exit(显式码)`。
 *
 * 结构性残余(ESM 语义决定,进程内无解,只能靠外层超时兜底):ESM 在**任何求值之前**先完成
 * 整张模块图的 linking,所以「某个静态 import 解析不到 / 缺导出」这类 link 期失败发生在他
 * 们自己的代码跑起来之前 —— 入口文件里的任何语句(含本守卫的 import)都还没执行,无处接管。
 * 缓解:入口刻意把静态导入面压到最小(node 内建 + electron + 本守卫 + 少量必须 ready 前
 * 就位的模块),真正的业务依赖一律走 `load` 阶段的动态 import,使其失败可被捕获并带阶段标签。
 * 另:某段若调用 `process.removeAllListeners("unhandledRejection")`(现存 session-persist-
 * feedback 段会),本守卫装的兜底监听会被摘掉,此后回到 Electron 默认的 warn+挂住 ——
 * 真实失败仍由壳层的 try/catch 覆盖,兜底监听只是纵深防御。
 *
 * 依赖方向:本模块属 test/common(测试与门禁的公共底座,受 typecheck 门禁),scripts/ 侧
 * 入口反向引用它 —— 与既有 `scripts/geometry/worker.mjs → test/tools/geometry/*` 同向。
 *
 * 用法(壳层永不 reject:任何失败都以非零退出码收场,不会退化成 unhandled rejection 黑洞):
 *   void runEntry({ entry: "check-geometry", load: () => import(...), work: async (deps) => code });
 * 载荷模块走 `load` 的动态 import(失败 = 阶段 load);`work` 返回入口自身的退出码
 * (0 绿 / 门禁自有语义码),返回非整数/负数一律按失败处理(不得因忘记 return 而退出 0)。
 */
import { app } from "electron";

/**
 * 入口失败阶段。分组依据是**排查方向**:load 期看依赖/模块图/构建产物,ready 期看运行时
 * 逻辑与窗口/环境,watchdog 期看"卡在哪一步"。
 * @readonly
 */
export const ENTRY_PHASE = {
  /** 载荷模块加载期(动态 import 失败) */
  LOAD: "load",
  /** 入口执行期:app ready 回调内及其后的全部逻辑 */
  READY: "ready",
  /** 逃逸异常:未被壳层 try/catch 捕获的未捕获异常 / 未处理 rejection */
  RUNTIME: "runtime",
  /** 加载看门狗超时:载荷一直没加载完(不抛错也不完成) */
  WATCHDOG: "watchdog",
  /** 入口声称成功 */
  OK: "ok",
};

/** 入口退出码。CRASH 与各入口自有语义码(0 绿/1 红灯/2 未测量/3 回传失败)不重叠。 */
export const ENTRY_EXIT = {
  /** 成功 */
  OK: 0,
  /** 入口自身崩溃(加载失败/执行期异常/看门狗/非法退出码):与判定结论无关 */
  CRASH: 4,
};

/** 加载看门狗默认上限 ms(载荷是一堆本地 ESM 文件,秒级;留足余量只为不吃紧启动慢的机器)。 */
export const DEFAULT_LOAD_WATCHDOG_MS = 60_000;
/** 加载看门狗的环境变量名(排障时可临时放大/收紧)。 */
export const LOAD_WATCHDOG_ENV = "M2W_ENTRY_LOAD_TIMEOUT_MS";
/** app.exit 之后的硬退兜底延时 ms(app.exit 若静默失效,到期强制 process.exit 同码)。 */
const HARD_EXIT_FALLBACK_MS = 2000;

/**
 * 阶段 → 诊断标签与排查方向。判定与文案同源,避免"码表与文案两处漂移"。
 * @type {Record<string, { label: string, hint: string }>}
 */
const PHASE_INFO = {
  [ENTRY_PHASE.LOAD]: {
    label: "模块加载期",
    hint: "看依赖解析与模块图:入口的静态 import 面(应为 node 内建/electron/本守卫)是否仍最小化,载荷模块是否存在且能独立加载;此阶段尚未起窗口、未跑任何判定",
  },
  [ENTRY_PHASE.READY]: {
    label: "入口执行期",
    hint: "载荷已加载成功,失败发生在 app ready 回调内或其后的采样/编排/落盘逻辑:看环境与产物(dist 构建、显示环境、注入参数)",
  },
  [ENTRY_PHASE.RUNTIME]: {
    label: "逃逸异常",
    hint: "未被入口 try/catch 捕获的未捕获异常或未处理 Promise 拒绝:多半是异步回调/事件处理器里抛的,按堆栈定位到具体回调",
  },
  [ENTRY_PHASE.WATCHDOG]: {
    label: "加载看门狗超时",
    hint: "载荷长时间既没加载完也没报错(死锁/顶层 await 挂起/同步阻塞);调大上限用环境变量排查,不要靠调大掩盖",
  },
  [ENTRY_PHASE.OK]: {
    label: "成功",
    hint: "入口未报告失败",
  },
};

/**
 * 错误归一化为可打印文案(Error → stack 优先,缺则 name+message;非 Error → String/JSON)。
 * @param {unknown} error 任意抛出值
 * @returns {string} 可打印文案
 */
function normalizeError(error) {
  if (error === null || error === undefined) return "(无错误对象:抛出方未提供)";
  if (error instanceof Error) {
    if (typeof error.stack === "string" && error.stack !== "") return error.stack;
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * 入口退出决策(**纯函数**:入参 = 阶段 + 原始错误(+ 可选运行环境),出参 = 退出码 + 诊断文本)。
 *
 * 口径(全部为"失败关闭",不存在"失败被判成成功"的分支):
 * - 阶段非 ok,或阶段是 ok 却带着错误对象 → 一律非零(ENTRY_EXIT.CRASH);
 * - 阶段为 ok 且无错误 → 0,诊断文本为空(成功路径不打噪声);
 * - 阶段不在码表内(标注缺失/写错)→ 仍非零,并在诊断里点名未知阶段。
 *
 * @param {object} input 入参
 * @param {string} input.entry 入口标识(出现在诊断首行,便于多入口日志里定位)
 * @param {string} input.phase 阶段(ENTRY_PHASE 之一;未知值按失败处理)
 * @param {unknown} [input.error] 原始错误/抛出值
 * @param {number} [input.crashExitCode] 崩溃退出码(默认 ENTRY_EXIT.CRASH)
 * @param {{ node: string, electron: string } | null} [input.env] 运行环境(注入以便本函数保持纯函数)
 * @returns {{ code: number, failed: boolean, text: string }} 退出码 + 是否失败 + 诊断文本
 */
export function decideEntryExit({ entry, phase, error, crashExitCode = ENTRY_EXIT.CRASH, env = null }) {
  const hasError = error !== null && error !== undefined;
  if (phase === ENTRY_PHASE.OK && !hasError) {
    return { code: ENTRY_EXIT.OK, failed: false, text: "" };
  }
  const info = PHASE_INFO[phase];
  const label = info?.label ?? `未知阶段(${String(phase)})`;
  const hint =
    info?.hint ??
    "阶段标注不在码表内:按失败处理(状态不明时门禁不得判绿),请同步 entry-guard 的 ENTRY_PHASE";
  const lines = [
    `[entry:${entry}] 入口失败 | 阶段:${label}(${String(phase)}) | 退出码 ${crashExitCode}`,
  ];
  if (phase === ENTRY_PHASE.OK) {
    lines.push("附加问题:入口返回「成功」却仍带错误对象 —— 按失败处理,不得判绿");
  }
  lines.push(`原始错误:${normalizeError(error)}`, `排查方向:${hint}`);
  if (env !== null) lines.push(`运行环境:node ${env.node} / electron ${env.electron}`);
  return { code: crashExitCode, failed: true, text: lines.join("\n") };
}

/**
 * 退出前把 stdout/stderr 冲干净:app.exit 立即终止进程,管道场景下未落盘输出会被截断
 * (门禁的逐条 finding 就在这些流里)。
 * @returns {Promise<void>} 冲刷完成
 */
export async function flushOutput() {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.writableLength > 0) await new Promise((resolve) => stream.write("", resolve));
  }
}

/**
 * 默认退出实现:先写 process.exitCode 再 app.exit(显式码),并在 2s 后仍存活时强制 process.exit。
 * 硬退兜底是"绝不静默挂住"的最后一道:app.exit 若在某平台静默失效,到期按同一码退出
 * (码由决策层给出,兜底不会把失败改成 0)。
 * @param {number} code 退出码
 * @returns {void}
 */
function defaultElectronExit(code) {
  process.exitCode = code;
  try {
    app.exit(code);
  } catch (err) {
    console.error(`[entry] app.exit(${code}) 失效,直接 process.exit:${normalizeError(err)}`);
    process.exit(code);
    return;
  }
  const timer = setTimeout(() => {
    console.error(`[entry] app.exit(${code}) 后进程仍存活,强制 process.exit(${code})`);
    process.exit(code);
  }, HARD_EXIT_FALLBACK_MS);
  timer.unref?.();
}

/**
 * 默认看门狗装配:定时器不阻止进程自然退出(unref),但 Electron 主进程的消息循环会让它照常触发。
 * @param {() => void} fn 到期动作
 * @param {number} ms 延时
 * @returns {() => void} 撤销函数
 */
function defaultArmWatchdog(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * 读运行环境版本(诊断用;注入本函数使 decideEntryExit 保持纯函数)。
 * @returns {{ node: string, electron: string }} 版本号文本
 */
function runtimeEnv() {
  return {
    node: process.versions.node,
    electron: process.versions.electron ?? "(非 Electron 宿主)",
  };
}

/**
 * 默认纵深兜底:装未捕获异常 / 未处理拒绝两个进程级监听,任一触发即按给定阶段失败收尾。
 * 之所以要装:Electron 主进程把 Node 的 unhandled-rejections 降级为 warn(实测只打
 * UnhandledPromiseRejectionWarning 且进程不死),逃出壳层 try/catch 的异步失败没有任何
 * 默认归宿,只能挂到 job 超时。
 * @param {(phase: string, error: unknown) => void} onEscape 逃逸失败回调(阶段 + 原始错误)
 * @returns {void}
 */
function defaultInstallBackstops(onEscape) {
  process.on("uncaughtException", (error) => {
    onEscape(ENTRY_PHASE.RUNTIME, error);
  });
  process.on("unhandledRejection", (reason) => {
    onEscape(ENTRY_PHASE.RUNTIME, reason);
  });
}

/**
 * @template T 载荷类型(load 阶段的产物;缺省 load 时为 unknown)
 * @typedef {object} RunEntryOptions
 * @property {string} entry 入口标识
 * @property {() => Promise<T>} [load] 载荷加载阶段(动态 import);失败记阶段 load
 * @property {(deps: T) => number | Promise<number>} work 入口执行期,返回入口自身退出码
 * @property {number} [crashExitCode] 崩溃退出码
 * @property {number} [loadWatchdogMs] 加载看门狗上限 ms
 * @property {(code: number) => void} [exit] 退出实现(注入以便断言)
 * @property {(stream: "stdout" | "stderr", text: string) => void} [write] 输出实现
 * @property {() => Promise<void>} [flush] 退出前冲刷
 * @property {(fn: () => void, ms: number) => () => void} [armWatchdog] 看门狗装配
 * @property {(onEscape: (phase: string, error: unknown) => void) => void} [installBackstops] 兜底监听装配
 * @property {{ node: string, electron: string } | null} [env] 诊断用运行环境
 */

/**
 * 入口壳层:装好兜底监听 → 跑加载阶段(带看门狗)→ 跑执行阶段 → 按决策退出。
 *
 * 契约:
 * - **永不 reject**:返回的 promise 一定 resolve 成退出码。门禁入口最怕的就是把失败
 *   变成 unhandled rejection(那正是本模块要修的挂死形态)。
 * - **失败关闭**:work 返回非整数/负数/NaN 一律按失败处理(忘记 return 不得退出 0);
 *   阶段 ok 但带错误对象同样非零(见 decideEntryExit)。
 * - **幂等**:看门狗与主流程同时失败时只打印一次、只退出一次。
 *
 * @template T 载荷类型
 * @param {RunEntryOptions<T>} options 入口配置
 * @returns {Promise<number>} 最终退出码
 */
export async function runEntry(options) {
  const {
    entry,
    load,
    work,
    crashExitCode = ENTRY_EXIT.CRASH,
    loadWatchdogMs = Number(process.env[LOAD_WATCHDOG_ENV] ?? DEFAULT_LOAD_WATCHDOG_MS),
    exit = defaultElectronExit,
    write = (stream, text) => (stream === "stderr" ? console.error(text) : console.log(text)),
    flush = flushOutput,
    armWatchdog = defaultArmWatchdog,
    installBackstops = defaultInstallBackstops,
    env = runtimeEnv(),
  } = options;

  let settled = false;
  /**
   * 打印诊断(可选)→ 冲刷 → 退出;重复调用只生效第一次。
   * @param {number} code 退出码
   * @param {string} text 诊断文本(空串 = 成功路径不打噪声)
   * @returns {Promise<number>} 退出码
   */
  const finish = async (code, text) => {
    if (settled) return code;
    settled = true;
    if (text !== "") {
      try {
        write("stderr", text);
      } catch {
        // 诊断打印失败不得改写退出码(否则失败会被吞成 0)
      }
    }
    try {
      await flush();
    } catch {
      // 冲刷失败同样不得改写退出码
    }
    try {
      exit(code);
    } catch (err) {
      try {
        process.exitCode = code;
        process.exit(code);
      } catch {
        console.error(`[entry:${entry}] 连 process.exit(${code}) 都失败:${normalizeError(err)}`);
      }
    }
    return code;
  };

  /**
   * 失败收尾:决策 → 诊断 → 非零退出。
   * @param {string} phase 失败阶段
   * @param {unknown} error 原始错误
   * @returns {Promise<number>} 退出码
   */
  const fail = (phase, error) => {
    const decision = decideEntryExit({ entry, phase, error, crashExitCode, env });
    return finish(decision.code, decision.text);
  };

  // 纵深兜底:逃出壳层 try/catch 的异步失败(定时器/事件处理器/第三方回调里抛出)。
  // 可注入:同一进程内多次跑壳层(测试)时不必叠加监听器(默认实现每次加 2 个)。
  installBackstops((phase, error) => {
    void fail(phase, error);
  });

  try {
    /** @type {unknown} */
    let deps = {};
    if (load !== undefined) {
      // 看门狗与载荷赛跑:载荷永不完成时由看门狗赢,壳层据此收尾并 settle。
      // 不能只靠"看门狗直接 fail":那样主流程仍停在 await load() 上,壳层返回的 promise
      // 永不 settle(实测会把段拖到硬超时),与"壳层一定 resolve"的契约冲突。
      const timeoutToken = Symbol("entry-load-watchdog");
      let timedOut = false;
      let fireTimeout = () => {};
      const onTimeout = new Promise((resolve) => {
        fireTimeout = () => {
          timedOut = true;
          resolve(timeoutToken);
        };
      });
      const release = armWatchdog(fireTimeout, loadWatchdogMs);
      try {
        const raced = await Promise.race([load(), onTimeout]);
        if (raced !== timeoutToken) deps = raced;
      } catch (error) {
        release();
        return fail(ENTRY_PHASE.LOAD, error);
      }
      release();
      if (timedOut) {
        return fail(
          ENTRY_PHASE.WATCHDOG,
          new Error(`载荷加载超过 ${String(loadWatchdogMs)}ms 仍未完成(既没加载完也没报错)`),
        );
      }
    }
    if (settled) return crashExitCode;

    /** @type {number | Promise<number>} */
    let code;
    try {
      code = await work(/** @type {T} */ (deps));
    } catch (error) {
      // 执行期(含 app ready 回调内)抛错:这是最常见的入口失败面,单独归阶段
      return fail(ENTRY_PHASE.READY, error);
    }
    if (settled) return crashExitCode;
    if (typeof code !== "number" || !Number.isInteger(code) || code < 0) {
      return fail(
        ENTRY_PHASE.READY,
        new Error(
          `入口执行期返回了非法退出码(${String(code)}):必须是 0 或正整数;` +
            `忘 return 会让门禁变成永远通过,按失败处理`,
        ),
      );
    }
    return finish(code, "");
  } catch (error) {
    // 壳层自身意外(非入口逻辑):标为逃逸异常,便于与入口失败区分
    return fail(ENTRY_PHASE.RUNTIME, error);
  }
}
