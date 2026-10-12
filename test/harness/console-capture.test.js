// @ts-check
/**
 * console 捕获助手自测段(位于 test/harness/ = 与被测件同层;纯 Node,不依赖 dist):
 * 被测件是 test/harness/console-capture.js。
 *
 * 为何值得有这一段:捕获助手一旦静默失真,受害的不是它自己而是**收口进来的那 8 个段** ——
 * 捕不到 warn/error 的段会以「输出为空」的形式假失败(断言引用了根本不存在的输出),
 * 反过来多收一类的段会失去噪声隔离(本该打到真 console 的告警被吞进断言文本)。
 * 两种都不是助手自身报错,而是别的段在别处红,归因距离很远。
 *
 * 故本段做**正负双断言**:
 * - 正:三族参数化各自真的只收声明的 console 方法(未被声明的那一类由段内替身「外记录仪」
 *   收到,同时 output 里没有它 —— 两侧都断言,少一边都只是恒真)、返回值原样透传、
 *   finally 还原三件套(含未被捕获的那两类);
 * - 负:主体抛错时输出仍可观测、原始错误对象与消息不被覆盖;外加**恒绿防护** ——
 *   一个「漏收 warn/error」的反面替身跑**同一组**期望必须判红,否则「output 必须含
 *   三行」这类断言本身是否恒真,没有任何东西能证明。
 *
 * 防假通过的着力点:所有正期望都写进一个**被测实现可注入**的公共函数
 * (`expectFullCapture`),恒绿防护那条只需把反面替身传进去。期望与替身不共享代码
 * (共享代码会让替身跟着被测件一起对),共享的是判据。
 */
import { captureAssertionFailure, createAsserter } from "./assert.js";
import { createCaseSuite } from "./case.js";
import { captureConsole } from "./console-capture.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**harness** —— 自指层,主体根就是
 * `test/harness/` 自己。被测件是测试框架自身的助手(L8 要求 covers 至少一个元素
 * 指向 harness)。
 */
export const covers = ["test/harness/console-capture.js"];

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

const suite = createCaseSuite();

const { assert, assertEq, assertIncludes, assertSameItems } = createAsserter("console-capture");

/**
 * 被测体:一次写全三类的 console 调用,并返回一个可被透传断言的标量。
 *
 * 三类各写不同的载荷:断言「output 里有哪一行」时才能区分是**哪一类**被收/漏收,
 * 用同一个字符串的三份副本判不出这件事。
 * @returns {number} 固定 42(透传断言的锚点值)
 */
function chattyBody() {
  console.log("L-line");
  console.warn("W-line");
  console.error("E-line");
  return 42;
}

/**
 * 在助手之外给 console 三件套装一圈「外记录仪」。
 *
 * 为什么需要它:断言「某类没被助手收走」只有两条路 —— 看 output 里没有它(可那一跳
 * 也可能是助手根本没收到那次调用),或者看它落到了别处。两条都断言才证明「调用真的
 * 发生了、且走的不是助手那条路」;只断言 output 不含该行是恒绿的(把整个调用删掉也绿)。
 * @returns {{ seen: string[]; restore(): void }} 外记录仪的命中清单与还原句柄
 */
function installOuterRecorders() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  /** @type {string[]} */
  const seen = [];
  /**
   * @param {string} tag 命中来自哪一类 console 方法
   * @returns {(...args: any[]) => void} 记录用替身
   */
  const record = (tag) => {
    return (...args) => {
      seen.push(`${tag}:${args.join(" ")}`);
    };
  };
  console.log = record("log");
  console.warn = record("warn");
  console.error = record("error");
  return {
    seen,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

/**
 * 「文本不含某一行」的行级不包含断言。
 *
 * 不用 assertNotIncludes:它按**子串**判,待判行恰好是别的载荷的子串时会误判;这里判的是
 * 「整行都不在」,与 installOuterRecorders 逐行记录的口径对齐。
 * @param {string} haystack 被检文本
 * @param {string} line 不得出现的整行
 * @returns {void}
 */
function assertNoLine(haystack, line) {
  assert(
    !haystack.split("\n").includes(line),
    `输出不得含整行 ${JSON.stringify(line)};实际 ${JSON.stringify(haystack)}`,
  );
}

/** 进入时 console 三件套的引用快照(断言 finally 还原用) */
function snapshotConsole() {
  return { log: console.log, warn: console.warn, error: console.error };
}

/**
 * @param {{ log: unknown; warn: unknown; error: unknown }} snapshot 进入时快照
 * @param {string} label 断言项名前缀
 * @returns {void}
 */
function assertConsoleRestored(snapshot, label) {
  assertEq(console.log, snapshot.log, `${label}:console.log 必须还原`);
  assertEq(console.warn, snapshot.warn, `${label}:console.warn 必须还原`);
  assertEq(console.error, snapshot.error, `${label}:console.error 必须还原`);
}

/**
 * 一次 **A 族(默认三件套)**捕获的公共期望。
 *
 * **被测实现由调用方注入**:恒绿防护那条把「漏收 warn/error」的反面替身传进来,同一组
 * 断言必须判红。期望与替身不共享代码,共享的是判据。
 * @param {() => Promise<{ result: number; output: string }>} capture 一次捕获调用
 * @returns {Promise<void>}
 */
async function expectFullCapture(capture) {
  const outer = installOuterRecorders();
  try {
    const { result, output } = await capture();
    assertEq(result, 42, "A 族:被测函数的返回值应原样透传");
    assertIncludes(output, "L-line", "A 族:console.log 必须进 output");
    assertIncludes(output, "W-line", "A 族:console.warn 必须进 output");
    assertIncludes(output, "E-line", "A 族:console.error 必须进 output");
    assertSameItems(output.split("\n"), ["L-line", "W-line", "E-line"], "A 族:输出按调用序一行一条");
    assertSameItems(outer.seen, [], "A 族:三件套都被捕获时,外记录仪不该收到任何调用");
  } finally {
    outer.restore();
  }
}

/**
 * **反面夹具**(刻意保留的一份「坏实现」,不是第二份实现候选):只收 console.log,
 * 把 warn/error 漏在外面 —— 正是本段要防的那类回归。
 *
 * 它必须自带 try/finally 还原:断言失败时若把 console.log 留在被替换状态,后续 case
 * 全部污染(与 expectFullCapture 里外记录仪的还原同一个理由)。
 * @template T
 * @param {() => T | Promise<T>} fn 被测函数
 * @returns {Promise<{ result: T; output: string }>}
 */
async function captureLogOnly(fn) {
  /** @type {string[]} */
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

export async function run() {
  /* ================= 一、参数化各族(正向) ================= */
  await suite.describe("参数化各族", async () => {
    await suite.case("A 族默认三件套:log/warn/error 全收,返回值透传,输出按调用序", async () => {
      await expectFullCapture(() => captureConsole(chattyBody));
      console.log("[ok] console-capture:A 族默认三件套(三类全收/透传/调用序/外记录仪零命中)");
    });

    await suite.case("同步体与空输出:同步 fn 直接返回值,无 console 调用时 output 为空串", async () => {
      const outer = installOuterRecorders();
      try {
        const sync = await captureConsole(() => 7);
        assertEq(sync.result, 7, "同步体的返回值应原样透传");
        assertEq(sync.output, "", "一次 console 调用都没有时 output 应为空串");
        assertSameItems(outer.seen, [], "空输出不该有任何调用落到外层 console");

        const async = await captureConsole(async () => {
          await Promise.resolve();
          return "after-tick";
        });
        assertEq(async.result, "after-tick", "跨 await 的异步体同样透传");
        assertEq(async.output, "", "异步体未写 console 时 output 仍为空串");
      } finally {
        outer.restore();
      }
      console.log("[ok] console-capture:同步体/异步体透传 + 空输出口径");
    });

    await suite.case("B 族 { warn: false }:只收 log/error,warn 原样走外层 console", async () => {
      const outer = installOuterRecorders();
      try {
        const { result, output } = await captureConsole(chattyBody, { warn: false });
        assertEq(result, 42, "B 族:返回值应原样透传");
        assertSameItems(output.split("\n"), ["L-line", "E-line"], "B 族:只收 log/error 且保持调用序");
        assertNoLine(output, "W-line");
        assertSameItems(outer.seen, ["warn:W-line"], "B 族:未被捕获的 warn 必须落到外层 console");
      } finally {
        outer.restore();
      }
      console.log("[ok] console-capture:B 族(warn 不收,log/error 收,warn 落到外层)");
    });

    await suite.case("C 族 { warn: false, error: false }:只收 log,warn/error 原样走外层 console", async () => {
      const outer = installOuterRecorders();
      try {
        const { result, output } = await captureConsole(chattyBody, { warn: false, error: false });
        assertEq(result, 42, "C 族:返回值应原样透传");
        assertEq(output, "L-line", "C 族:只收 console.log,且只有一行");
        assertSameItems(
          outer.seen,
          ["warn:W-line", "error:E-line"],
          "C 族:未被捕获的 warn/error 必须落到外层 console(且保持调用序)",
        );
      } finally {
        outer.restore();
      }
      console.log("[ok] console-capture:C 族(只收 log,warn/error 落到外层且有序)");
    });

    await suite.case("finally 还原:三族参数化跑完后三件套都回到原引用(含未被捕获的那两类)", async () => {
      // 外记录仪先装:本case 要跑 warn/error 不被捕获的两族,不装就会往真 console 打噪声
      const outer = installOuterRecorders();
      // 快照取**装上外记录仪之后**的引用:还原的判据是「captureConsole 进入时那一份」
      const snapshot = snapshotConsole();
      try {
        /** @type {{ warn?: boolean; error?: boolean }[]} */
        const families = [{}, { warn: false }, { warn: false, error: false }];
        for (const options of families) {
          await captureConsole(chattyBody, options);
          assertConsoleRestored(snapshot, `参数 ${JSON.stringify(options)} 跑完后`);
        }
      } finally {
        outer.restore();
      }
      console.log("[ok] console-capture:finally 还原(三族参数化 × log/warn/error)");
    });
  });

  /* ================= 二、失败路径与恒绿防护(负向) ================= */
  await suite.describe("失败路径与恒绿防护", async () => {
    await suite.case("主体抛错:输出仍可观测,原始错误不被覆盖,三件套照样还原", async () => {
      const snapshot = snapshotConsole();
      const failure = await captureAssertionFailure(() =>
        captureConsole(async () => {
          console.log("before-throw");
          await Promise.resolve();
          throw new Error("主体失败:预期断言点");
        }),
      );
      assert(failure.threw, "主体抛错必须原样透传(不得被吞成一次成功捕获)");
      assert(failure.error instanceof Error, "失败事实应带 Error 对象(供读附带属性)");
      const error = /** @type {Error} */ (failure.error);
      assertEq(error.constructor, Error, "抛出的必须是原错误对象,不得包一层");
      assertIncludes(error.message, "主体失败:预期断言点", "原始错误消息不得被捕获辅助信息覆盖");

      // 抛错时附在错误对象上的已捕获输出(属性名与理由见 test/harness/console-capture.js)
      const captured = Reflect.get(error, "capturedOutput");
      assertEq(typeof captured, "string", "抛错时应把已捕获到的输出附在错误对象上");
      assertIncludes(/** @type {string} */ (captured), "before-throw", "抛出前产生的输出仍要可观测");
      // 非枚举:不进 JSON.stringify / Object.keys,错误对象的既有可观测形态不被它改变
      assertSameItems(Object.keys(error), [], "附带属性必须非枚举(否则序列化错误对象时多出一个键)");
      assertConsoleRestored(snapshot, "主体抛错后");
      console.log("[ok] console-capture:失败路径(错误原样透传 + 输出可观测 + 三件套还原)");
    });

    await suite.case("恒绿防护:漏收 warn/error 的捕获必须被公共期望判红", async () => {
      // 这条守的是上面几条正向断言的**牙齿**:若 expectFullCapture 退化成恒真(比如只剩
      // assertIncludes(output, "") 这类永远成立的判据),这里不会红。
      const outcome = await captureAssertionFailure(() =>
        expectFullCapture(() => captureLogOnly(chattyBody)),
      );
      assert(outcome.threw, "反面替身必须判红(否则上面的正期望是恒真断言)");
      assertIncludes(
        outcome.message,
        "console.warn",
        "判红消息须点名漏收的是哪一族(只说「不相等」指不出要修哪里)",
      );
      console.log("[ok] console-capture:恒绿防护(漏收一族的替身 → 判红且点名 console.warn)");
    });
  });

  return { cases: suite.results };
}
