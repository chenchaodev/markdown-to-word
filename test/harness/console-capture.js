// @ts-check
/**
 * console 三件套捕获 —— **全仓单一来源**(把 9 处逐字复制收口成一处)。
 *
 * ## 收口前的 9 处复制(逐个点名,便于日后核对「还有没有漏改的」)
 * - A 族三件套(log/warn/error 全收,返回 `{ result, output }`):
 *   `test/gates/install-smoke.test.js` 的 `withCapturedOutput`
 * - A 族三件套(返回 `{ code, output }`):`test/gates/artifacts/pack-size.test.js` 与
 *   `test/gates/smoke/smoke-report.test.js` 的 `captureCli`
 * - B 族两件套(只收 log/error,不碰 warn):`test/gates/dist-manifest-gate.test.js` 与
 *   `test/gates/release-artifact-gate.test.js` 的 `runChecker`、
 *   `test/gates/import-boundary.test.js` 与 `test/gates/pinned-actions.test.js` 的 `runCli`
 * - C 族行内(只收 log):`test/main/mermaid-service.test.js`、`test/main/converter.test.js`
 *   各一处(写死 `console.log` 的 try/finally,无具名函数)
 *
 * ## 为什么用两个布尔参数化而不是「各自保留一份」
 * 三族的差别只有「额外收不收 warn / error」两个开关。收口前每改一次捕获口径
 * (例如 `args.join(" ")` 的分隔符、输出空串还是空数组)要同步 9 处,而它们分散在 4 棵
 * 段目录里,**漏一处没有任何东西变红** —— 捕不到输出的段只会以「输出为空」的形式假失败,
 * 或反过来把不该收的 warn/error 收进来,让「只捕 log」的段失去噪声隔离。
 * 两个布尔把三族压成同一份实现,缺省值取 9 处里 5 处的口径(三件套全收)。
 *
 * ## 为什么放在 `test/harness/`
 * harness 收测试框架自身与跨段共用助手,是本仓唯一的「非段共享代码」位置(段 import 段
 * 会被 `check-test-layout.mjs` 的 L4 判红:段是发现与隔离的单位)。
 * ⚠ 本文件名**不得**以 `.test.js` 结尾 —— 那会让 `test/harness/runner.js` 的
 * discoverSegments 把它自己当成一个段。
 */

/**
 * 一次捕获的结果。
 * @template T
 * @typedef {object} CaptureResult
 * @property {T} result 被测函数的返回值(原样透传:不包、不转、不改引用)
 * @property {string} output 合并后的 console 输出 —— 各次调用按发生序一行一条,
 *   以 `\n` 连接;一次调用都没有时是空串(与 9 处收口前的口径一致)
 */

/**
 * 捕获族的参数化开关(两个布尔对应「除 log 之外还收哪几类」)。
 * @typedef {object} CaptureConsoleOptions
 * @property {boolean} [warn] 是否连同 `console.warn` 一并捕获;false = 放过它,
 *   让被测代码的告警照常落到真实 console(默认 true)
 * @property {boolean} [error] 是否连同 `console.error` 一并捕获(默认 true)
 */

/**
 * 失败时附在被抛错误上的属性名(见下方 catch 分支的说明)。
 *
 * 之所以写死字符串而不导出常量:本模块按裁决只保留 `captureConsole` 一个导出,
 * 名字的唯一定义处就是这里;消费方(含自测段)按这个名字读。
 * @type {"capturedOutput"}
 */
const CAPTURED_OUTPUT_KEY = "capturedOutput";

/**
 * 在捕获 console 的前提下跑 fn。
 *
 * ## 三条不变量(自测段逐条钉住)
 * 1. **只收声明的那几类**:log 恒收;warn/error 由入参决定,未被声明的那一类完全不被
 *    触碰(仍是调用前那一刻的那个引用),故被测代码的告警/报错照常落到真实 console;
 * 2. **finally 恢复三件套**:无论成功、抛错、同步还是异步,退出时 `console.log` /
 *    `console.warn` / `console.error` 全部回到进入时的引用(对未被捕获的那两类而言
 *    这是幂等的原地恢复,不是漏写);
 * 3. **抛错不吞也不覆盖**:主体抛错时原错误对象原样继续抛(栈与消息一字不改),
 *    同时把**已捕获到的输出**以非枚举属性 `capturedOutput` 附在它上面 ——
 *    否则「抛错前的输出」对调用方不可观测,失败原因只剩一句消息,看不出模型跑到哪一步。
 *    附加失败(冻结/密封的错误对象)被吞掉:本函数的职责是捕获,不是改写错误。
 *
 * @template T
 * @param {() => T | Promise<T>} fn 被测函数(同步异步均可)
 * @param {CaptureConsoleOptions} [options] 捕获族;缺省 = 三件套全收(A 族)
 * @returns {Promise<{ result: T; output: string }>} fn 的返回值与合并输出
 */
export async function captureConsole(fn, { warn = true, error = true } = {}) {
  /** @type {string[]} */
  const lines = [];
  // 原引用在**进入时**取一份:还原的是「本次捕获之前」的那个实现,不是模块加载时的
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  if (warn) console.warn = (...args) => lines.push(args.join(" "));
  if (error) console.error = (...args) => lines.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      try {
        // 非枚举:不进 JSON.stringify / Object.keys,不改变错误的可观测形态
        Object.defineProperty(error, CAPTURED_OUTPUT_KEY, {
          value: lines.join("\n"),
          enumerable: false,
          configurable: true,
          writable: true,
        });
      } catch {
        // 冻结/密封的错误对象附不上:吞掉附加失败,绝不让它盖住原始错误
      }
    }
    throw error;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}
