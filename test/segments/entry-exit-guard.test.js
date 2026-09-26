// @ts-check
/**
 * 入口失败路径守卫自测段(位于 test/segments/ = 跨域守护段;被测为 test/common/entry-guard.mjs,
 * 即几何门禁 / 视觉自查 / 验收父进程 / 段子进程宿主五个 Electron 入口共用的失败路径实现):
 *
 * 为什么必须有这一段:这些入口是**门禁**。入口失败时的两种坏表现都会让 CI 失去信号 ——
 * 挂死(报出来的是 job 级「超时」,真实原因被吞掉)与退出 0(门禁变成永远通过,比挂死更糟)。
 * 而这两种行为在旧实现里都真实发生过(见被测文件头的实测记录),且**不能靠「真的挂一次」验证**:
 * 挂死要等超时,退出 0 要真跑一遍完整门禁。因此把「失败 → 退出码 + 诊断」抽成纯函数
 * `decideEntryExit({ entry, phase, error, ... })`,壳层 `runEntry` 只做编排,依赖全部注入
 * (exit / write / flush / armWatchdog),本段即可确定性地断言全部失败形态。
 *
 * 三层断言:
 * 1. 纯函数(判定层):加载期/执行期/逃逸异常/看门狗四类失败各自非零 + 诊断可定位
 *    (含原始错误与堆栈、含阶段标签与排查方向);成功路径 exit 0 且不打噪声;
 *    失败关闭:阶段 ok 却带错误对象、阶段不在码表内、错误为 null/undefined 一律非零;
 * 2. 壳层(编排层,注入 exit/write/flush/armWatchdog,零真实进程):加载失败、ready 抛错、
 *    看门狗到期、非法退出码、门禁自有红灯码各自退出码正确;**work 忘 return 不得退出 0**;
 * 3. 真实进程(端到端,仅本段起一次子进程):生成一个走本守卫的临时入口脚本,分别注入
 *    「载荷加载失败」与「ready 回调内抛错」,断言子进程**真的以非零码退出**且诊断命中阶段标签。
 *    这一层是防"纯函数对、接线错"的锚点 —— 前两层都注入假 exit,接线断了它们不会红。
 *    临时脚本落在系统临时区并在段末删除(构造方式不入库)。
 *
 * 防假通过:每条判红都同时断言退出码与诊断内容(只断言码会让"因错误原因失败"蒙混过关);
 * 正向锚点证明守卫通路本身有效(否则负向用例可能只是"跑不起来")。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../common/paths.js";
import { createAsserter } from "../common/assert.js";
import { createCaseSuite } from "../common/case.js";
import {
  DEFAULT_LOAD_WATCHDOG_MS,
  ENTRY_EXIT,
  ENTRY_PHASE,
  LOAD_WATCHDOG_ENV,
  decideEntryExit,
  runEntry,
} from "../common/entry-guard.mjs";

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

const suite = createCaseSuite();

const { assert, assertEq, assertIncludes } = createAsserter("entry-exit-guard");

/** 被测模块的 file URL(临时入口脚本按绝对路径 import 它,故放系统临时区也能解析 electron) */
const GUARD_URL = pathToFileURL(path.join(ROOT, "test", "common", "entry-guard.mjs")).href;

/** 确定性诊断用的假环境(注入以便纯函数不读 process) */
const FAKE_ENV = { node: "0.0.0-probe", electron: "0.0.0-probe" };

/** 故意不存在的载荷模块说明符(走变量传参:字面量会被 tsc 当作待解析模块而报编译错) */
const MISSING_MODULE = "./definitely-missing-module-for-entry-guard-probe.mjs";

/**
 * 跑一次壳层并收集可断言的退出码/输出(全部依赖注入,不碰真实进程)。
 * @param {object} input 输入
 * @param {() => Promise<unknown>} [input.load] 载荷加载阶段
 * @param {() => number | Promise<number>} input.work 入口执行期(本段用例都不消费载荷)
 * @param {number} [input.loadWatchdogMs] 看门狗上限(测试里不必真等)
 * @returns {Promise<{ code: number, codes: number[], text: string, stream: string, flushes: number }>} 观测结果
 */
async function runShell({ load, work, loadWatchdogMs = DEFAULT_LOAD_WATCHDOG_MS }) {
  /** @type {number[]} */
  const codes = [];
  /** @type {string[]} */
  const texts = [];
  /** @type {string[]} */
  const streams = [];
  let flushes = 0;
  const code = await runEntry({
    entry: "probe",
    load,
    work,
    loadWatchdogMs,
    env: FAKE_ENV,
    exit: (c) => codes.push(c),
    write: (stream, text) => {
      streams.push(stream);
      texts.push(text);
    },
    flush: async () => {
      flushes += 1;
    },
    armWatchdog: () => () => {},
    // 兜底监听在真实进程里由第三层端到端 case 证明;这里注入空实现,避免同进程内
    // 反复跑壳层把 process 监听器堆到 MaxListeners 警告(那不是被测行为)
    installBackstops: () => {},
  });
  return { code, codes, text: texts.join("\n"), stream: streams.join(","), flushes };
}

export async function run() {
  /* ================= 一、纯函数:退出决策(判定层) ================= */
  await suite.describe("decideEntryExit 纯函数", async () => {
    await suite.case("成功路径:阶段 ok 且无错误 → 退出 0 且不产诊断噪声", async () => {
      const decision = decideEntryExit({ entry: "probe", phase: ENTRY_PHASE.OK, env: FAKE_ENV });
      assertEq(decision.code, 0, "成功路径退出码应为 0");
      assertEq(decision.failed, false, "成功路径不应标记 failed");
      assertEq(decision.text, "", "成功路径不应产诊断文本(否则每次绿灯都刷噪声)");
    });

    await suite.case("加载期失败:非零 + 阶段标签 + 原始堆栈 + 排查方向", async () => {
      const error = new Error("载荷 import 失败:ERR_MODULE_NOT_FOUND");
      const decision = decideEntryExit({
        entry: "check-geometry",
        phase: ENTRY_PHASE.LOAD,
        error,
        env: FAKE_ENV,
      });
      assertEq(decision.code, ENTRY_EXIT.CRASH, "加载期失败必须用崩溃码");
      assert(decision.code !== 0, "加载期失败绝不允许退出 0(那等于门禁永远通过)");
      assertEq(decision.failed, true, "应标记 failed");
      assertIncludes(decision.text, "[entry:check-geometry]", "诊断须点名入口");
      assertIncludes(decision.text, "阶段:模块加载期(load)", "诊断须带阶段标签(排查方向与执行期不同)");
      assertIncludes(decision.text, "ERR_MODULE_NOT_FOUND", "诊断须含原始错误消息");
      assertIncludes(decision.text, "entry-guard.mjs", "诊断须含堆栈(定位到具体文件行)");
      assertIncludes(decision.text, "排查方向:看依赖解析与模块图", "诊断须给该阶段的排查方向");
      assertIncludes(decision.text, "node 0.0.0-probe / electron 0.0.0-probe", "诊断须带运行环境版本");
    });

    await suite.case("执行期失败:非零,且与加载期的排查方向文案不同(可区分)", async () => {
      const decision = decideEntryExit({
        entry: "acceptance",
        phase: ENTRY_PHASE.READY,
        error: new Error("runAll 抛出"),
        env: FAKE_ENV,
      });
      assertEq(decision.code, ENTRY_EXIT.CRASH, "执行期失败必须非零");
      assertIncludes(decision.text, "阶段:入口执行期(ready)", "执行期须有自己的阶段标签");
      const loadDecision = decideEntryExit({
        entry: "acceptance",
        phase: ENTRY_PHASE.LOAD,
        error: new Error("runAll 抛出"),
        env: FAKE_ENV,
      });
      assert(
        loadDecision.text !== decision.text,
        "加载期与执行期的诊断不得是同一段文本(否则排查方向不可区分)",
      );
      assertIncludes(decision.text, "运行环境", "执行期诊断同样带运行环境");
    });

    await suite.case("逃逸异常与看门狗:各自阶段标签 + 非零", async () => {
      for (const [phase, needle] of /** @type {[string, string][]} */ ([
        [ENTRY_PHASE.RUNTIME, "阶段:逃逸异常(runtime)"],
        [ENTRY_PHASE.WATCHDOG, "阶段:加载看门狗超时(watchdog)"],
      ])) {
        const decision = decideEntryExit({ entry: "probe", phase, error: new Error("x"), env: FAKE_ENV });
        assert(decision.code !== 0, `${phase} 阶段必须非零`);
        assertIncludes(decision.text, needle, `${phase} 阶段标签须可定位`);
      }
    });

    await suite.case("失败关闭:阶段 ok 却带错误对象 → 不得判绿", async () => {
      const decision = decideEntryExit({
        entry: "probe",
        phase: ENTRY_PHASE.OK,
        error: new Error("声称成功但有错误"),
        env: FAKE_ENV,
      });
      assert(decision.code !== 0, "带错误对象的「成功」必须判红");
      assertIncludes(decision.text, "附加问题:入口返回「成功」却仍带错误对象", "须点名这处自相矛盾");
    });

    await suite.case("失败关闭:阶段不在码表 / 错误为 null 或 undefined → 一律非零", async () => {
      for (const phase of ["unknown-phase", "", undefined]) {
        const decision = decideEntryExit({
          entry: "probe",
          phase: /** @type {string} */ (phase),
          error: new Error("阶段标注写错"),
          env: FAKE_ENV,
        });
        assert(decision.code !== 0, `阶段「${String(phase)}」必须按失败处理(状态不明不得判绿)`);
        assertIncludes(decision.text, "未知阶段", "未知阶段须在诊断里点名");
      }
      for (const error of [null, undefined]) {
        for (const phase of [ENTRY_PHASE.LOAD, ENTRY_PHASE.READY, ENTRY_PHASE.WATCHDOG]) {
          const decision = decideEntryExit({ entry: "probe", phase, error, env: FAKE_ENV });
          assert(decision.code !== 0, `阶段 ${phase} 缺错误对象时也必须非零`);
          assertIncludes(decision.text, "(无错误对象", "须说明抛出方未提供错误对象");
        }
      }
    });

    await suite.case("非 Error 抛出值归一化:字符串/对象/null 都有可打印文案", async () => {
      const text = decideEntryExit({
        entry: "probe",
        phase: ENTRY_PHASE.READY,
        error: "裸字符串失败",
        env: FAKE_ENV,
      }).text;
      assertIncludes(text, "裸字符串失败", "字符串抛出值应原样可读");
      const objText = decideEntryExit({
        entry: "probe",
        phase: ENTRY_PHASE.READY,
        error: { reason: "对象抛出值" },
        env: FAKE_ENV,
      }).text;
      assertIncludes(objText, "对象抛出值", "非 Error 对象应能被打印(不得抛 TypeError 覆盖原失败)");
      // 循环引用对象不得让归一化本身抛错(那会把原失败换成另一个失败)
      /** @type {{ self?: unknown }} */
      const cyclic = {};
      cyclic.self = cyclic;
      const cyclicDecision = decideEntryExit({ entry: "probe", phase: ENTRY_PHASE.READY, error: cyclic });
      assert(cyclicDecision.code !== 0, "循环引用对象仍应判红");
    });

    await suite.case("崩溃码可注入:各入口自有语义码(1 红 / 2 未测量)不被守卫覆盖", async () => {
      const decision = decideEntryExit({
        entry: "segment-host",
        phase: ENTRY_PHASE.READY,
        error: new Error("回传失败"),
        crashExitCode: 3,
        env: FAKE_ENV,
      });
      assertEq(decision.code, 3, "崩溃码应由调用方决定(不得硬编码覆盖各入口语义)");
      assertIncludes(decision.text, "退出码 3", "诊断首行须写出实际退出码");
    });
  });

  /* ================= 二、壳层:编排与退出(依赖全注入) ================= */
  await suite.describe("runEntry 壳层", async () => {
    await suite.case("成功路径:work 返回 0 → 退出 0,不打印任何诊断", async () => {
      const result = await runShell({ work: () => 0 });
      assertEq(result.codes.length, 1, "只应退出一次");
      assertEq(result.code, 0, "成功路径退出码应为 0");
      assertEq(result.text, "", "成功路径不得打印失败诊断");
      assertEq(result.stream, "", "成功路径不得写 stderr");
      assertEq(result.flushes, 1, "退出前应冲刷一次输出(app.exit 会截断未落盘输出)");
    });

    await suite.case("门禁自有红灯码:work 返回 1/2 → 原样退出,不被改成崩溃码", async () => {
      for (const gateCode of [1, 2]) {
        const result = await runShell({ work: () => gateCode });
        assertEq(result.code, gateCode, `门禁码 ${gateCode} 应原样退出(不得被守卫改写)`);
        assertEq(result.text, "", "门禁自己的红灯已由门禁打印诊断,守卫不重复刷屏");
      }
    });

    await suite.case("加载失败:动态 import 抛错 → 崩溃码 + 加载期诊断", async () => {
      const result = await runShell({
        load: () => import(MISSING_MODULE),
        work: () => {
          throw new Error("work 不该被调用(载荷都没加载成)");
        },
      });
      assertEq(result.code, ENTRY_EXIT.CRASH, "加载失败必须以崩溃码退出");
      assertIncludes(result.text, "阶段:模块加载期(load)", "诊断须标出加载期");
      assertIncludes(result.text, "definitely-missing-module-for-entry-guard-probe.mjs", "诊断须点名加载失败的模块");
      assertEq(result.stream, "stderr", "失败诊断必须走 stderr(CI 日志据此判定)");
    });

    await suite.case("执行期失败:work 抛错 → 崩溃码 + 执行期诊断,且带原始堆栈", async () => {
      const result = await runShell({
        work: () => {
          throw new Error("ready 回调内炸了");
        },
      });
      assertEq(result.code, ENTRY_EXIT.CRASH, "执行期抛错必须非零退出");
      assertIncludes(result.text, "阶段:入口执行期(ready)", "诊断须标出执行期");
      assertIncludes(result.text, "ready 回调内炸了", "诊断须含原始错误消息");
      assertIncludes(result.text, "entry-exit-guard.test.js", "诊断须含堆栈行(能定位到具体文件)");
    });

    await suite.case("非法退出码(work 忘 return)→ 判红,绝不静默退出 0", async () => {
      for (const bogus of [undefined, null, Number.NaN, 1.5, -1, "0"]) {
        // 刻意传非法码:类型上这违反 runShell 的签名,断言的正是"壳层不信任入口返回值"这条契约
        const result = await runShell({ work: /** @type {() => number} */ (() => bogus) });
        assert(result.code !== 0, `work 返回 ${String(bogus)} 时必须判红(忘 return 不得让门禁永远通过)`);
        assertIncludes(result.text, "非法退出码", "须点名退出码非法这一事实");
      }
    });

    await suite.case("加载看门狗:载荷一直不完成 → 到期以看门狗阶段非零退出", async () => {
      /** @type {number[]} */
      const codes = [];
      /** @type {string[]} */
      const texts = [];
      // 初始为空动作(而非 null):到期动作在 Promise 构造器里被异步赋值,
      // 用 null 初值会被 tsc 的控制流收窄成 never(赋值发生在回调里,分析器看不见)
      let fire = () => {};
      let watchdogMs = null;
      // 载荷永不完成:壳层会停在 await load() 上永不 settle,故这里不直接 await,
      // 而是自行捕获看门狗到期动作并触发(等价于真等到期,只是不必真等 60s)
      const pending = runEntry({
        entry: "probe",
        env: FAKE_ENV,
        load: () => new Promise(() => {}),
        work: () => 0,
        loadWatchdogMs: 12345,
        exit: (c) => codes.push(c),
        write: (_stream, text) => texts.push(text),
        flush: async () => {},
        armWatchdog: (fn, ms) => {
          fire = fn;
          watchdogMs = ms;
          return () => {};
        },
        installBackstops: () => {},
      });
      assertEq(watchdogMs, 12345, "看门狗上限应可注入(测试不必真等)");
      fire();
      const code = await pending;
      const text = texts.join("\n");
      assertEq(code, ENTRY_EXIT.CRASH, "看门狗到期必须非零退出(不得静默挂住)");
      assertEq(codes.length, 1, "只应退出一次");
      assertIncludes(text, "阶段:加载看门狗超时(watchdog)", "须以看门狗阶段标注(与抛错路径可区分)");
      assertIncludes(text, "12345ms", "须写出上限,便于调参排障");
    });

    await suite.case("幂等:看门狗先到、载荷随后报错 → 只打印一次、只退出一次", async () => {
      /** @type {number[]} */
      const codes = [];
      /** @type {string[]} */
      const texts = [];
      let rejectLoad = () => {};
      const pending = runEntry({
        entry: "probe",
        env: FAKE_ENV,
        load: () =>
          new Promise((_resolve, reject) => {
            rejectLoad = () => reject(new Error("载荷终于报错"));
          }),
        work: () => 0,
        loadWatchdogMs: 1,
        exit: (c) => codes.push(c),
        write: (_stream, text) => texts.push(text),
        flush: async () => {},
        // 装配即刻触发:模拟"看门狗先到",主流程随后仍会拿到自己的失败
        armWatchdog: (fn) => {
          fn();
          return () => {};
        },
        installBackstops: () => {},
      });
      rejectLoad();
      const code = await pending;
      const text = texts.join("\n");
      assertEq(codes.length, 1, "重复失败只应退出一次(否则退出码取决于竞态)");
      assertEq(code, ENTRY_EXIT.CRASH, "竞态下仍须以非零码退出");
      assertEq(texts.length, 1, "重复失败只应打印一次诊断(否则日志被竞态噪声淹没)");
      assertIncludes(text, "阶段:加载看门狗超时(watchdog)", "先到的那条(看门狗)胜出");
    });
  });

  /* ================= 三、真实进程:非零退出码(端到端) ================= */
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-entry-exit-"));
  try {
    /**
     * 起一个走本守卫的临时入口,注入指定失败形态,回报真实退出码与合并输出。
     * @param {string} name 脚本名
     * @param {string} body 脚本主体(已可 import 本守卫)
     * @returns {Promise<{ code: number | null, signal: string | null, timedOut: boolean, output: string }>} 子进程结果
     */
    async function runRealEntry(name, body) {
      const file = path.join(scratch, name);
      fs.writeFileSync(file, body, "utf8");
      return await new Promise((resolve) => {
        const child = spawn(process.execPath, [file], {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
        });
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (output += String(chunk)));
        child.stderr.on("data", (chunk) => (output += String(chunk)));
        // 硬超时:被测行为若退化回"挂死",这里必须杀掉并让断言红,而不是让整段挂到 job 超时
        const killer = setTimeout(() => {
          child.kill();
          resolve({ code: null, signal: "TIMEOUT", timedOut: true, output });
        }, 60_000);
        child.once("error", (error) => {
          clearTimeout(killer);
          resolve({ code: null, signal: null, timedOut: false, output: `${output}\nspawn error: ${error.message}` });
        });
        child.once("exit", (code, signal) => {
          clearTimeout(killer);
          resolve({ code, signal, timedOut: false, output });
        });
      });
    }

    await suite.case("端到端正向锚点:同一守卫下成功路径真的退出 0", async () => {
      const result = await runRealEntry(
        "ok-entry.mjs",
        [
          `import { runEntry } from ${JSON.stringify(GUARD_URL)};`,
          `void runEntry({ entry: "probe-ok", work: async () => { process.stdout.write("[probe] work done\\n"); return 0; } });`,
          "",
        ].join("\n"),
      );
      assertEq(result.timedOut, false, "成功路径不得挂死");
      assertEq(result.code, 0, `成功路径应退出 0(实际 ${String(result.code)};输出:${result.output})`);
      assertIncludes(result.output, "[probe] work done", "正向锚点须证明守卫通路真的跑起来了");
    });

    await suite.case("端到端:加载期抛错(动态 import 失败)→ 非零退出 + 加载期诊断", async () => {
      const result = await runRealEntry(
        "load-fail-entry.mjs",
        [
          `import { runEntry } from ${JSON.stringify(GUARD_URL)};`,
          `void runEntry({`,
          `  entry: "probe-load",`,
          `  load: () => import("./no-such-payload.mjs"),`,
          `  work: async () => 0,`,
          `});`,
          "",
        ].join("\n"),
      );
      assertEq(result.timedOut, false, "加载期失败绝不允许挂死(旧行为:只打一句 App threw an error during load 然后永不退出)");
      assert(
        result.code === ENTRY_EXIT.CRASH,
        `加载期失败应以崩溃码 ${ENTRY_EXIT.CRASH} 退出,实际 ${String(result.code)}(输出:${result.output})`,
      );
      assertIncludes(result.output, "[entry:probe-load] 入口失败", "须打印入口标识");
      assertIncludes(result.output, "阶段:模块加载期(load)", "须打印加载期阶段标签");
      assertIncludes(result.output, "no-such-payload.mjs", "须点名加载失败的模块");
    });

    await suite.case("端到端:ready 回调内抛错 → 非零退出 + 执行期诊断(旧行为是 unhandled rejection 挂死)", async () => {
      const result = await runRealEntry(
        "ready-fail-entry.mjs",
        [
          `import { app } from "electron";`,
          `import { runEntry } from ${JSON.stringify(GUARD_URL)};`,
          `void runEntry({`,
          `  entry: "probe-ready",`,
          `  work: () => app.whenReady().then(() => { throw new Error("PROBE_READY_BOOM"); }),`,
          `});`,
          "",
        ].join("\n"),
      );
      assertEq(result.timedOut, false, "执行期抛错绝不允许挂死(旧行为:UnhandledPromiseRejectionWarning + 进程不死)");
      assert(
        result.code === ENTRY_EXIT.CRASH,
        `执行期抛错应以崩溃码 ${ENTRY_EXIT.CRASH} 退出,实际 ${String(result.code)}(输出:${result.output})`,
      );
      assertIncludes(result.output, "阶段:入口执行期(ready)", "须打印执行期阶段标签");
      assertIncludes(result.output, "PROBE_READY_BOOM", "须含原始错误消息");
    });

    await suite.case("端到端:逃逸异常(work 悬挂 + 定时器里抛出)→ 兜底监听接住并非零退出", async () => {
      const result = await runRealEntry(
        "escape-entry.mjs",
        [
          `import { runEntry } from ${JSON.stringify(GUARD_URL)};`,
          `void runEntry({`,
          `  entry: "probe-escape",`,
          // work 永不 settle(模拟死锁),异常来自逃出壳层 try/catch 的定时器回调:
          // 没有进程级兜底监听时,这类失败没有任何归宿,进程会一直活着
          `  work: () => new Promise(() => { setTimeout(() => { throw new Error("PROBE_ESCAPE_BOOM"); }, 0); }),`,
          `});`,
          "",
        ].join("\n"),
      );
      assertEq(result.timedOut, false, "逃逸异常绝不允许挂死(没有兜底监听时就是挂到 job 超时)");
      assert(
        result.code === ENTRY_EXIT.CRASH,
        `逃逸异常应以崩溃码 ${ENTRY_EXIT.CRASH} 退出,实际 ${String(result.code)}(输出:${result.output})`,
      );
      assertIncludes(result.output, "阶段:逃逸异常(runtime)", "须以逃逸异常阶段标注(与入口自身失败可区分)");
      assertIncludes(result.output, "PROBE_ESCAPE_BOOM", "须含原始错误消息");
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  console.log(
    `[ok] entry-exit-guard:纯函数判定 + 壳层编排 + 真实进程非零退出(` +
      `${suite.results.length} case,看门狗默认 ${DEFAULT_LOAD_WATCHDOG_MS}ms,可用 ${LOAD_WATCHDOG_ENV} 覆盖)`,
  );

  return { cases: suite.results };
}
