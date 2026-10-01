// @ts-check
/**
 * 段子进程宿主 · 纯 node 变体(与 test/common/segment-host.mjs 同契约,一次只跑一个段):
 *
 * 为什么存在:Electron 宿主每段启动约 2.1s,纯 node 约 90ms(同一段实测)。本文件是
 * 「把验收段的宿主从 Electron 换成纯 node」这条路的实验实现 —— 它**只换宿主**,
 * 段清单、结果回传载荷、退出码语义、case 进度钩子全部沿用 runner.js 的同一批函数,
 * 故两种宿主跑出来的段结果可以直接对照(可比的唯一前提)。
 *
 * 与 Electron 宿主的四处差异,都是「纯 node 下没有 electron」的直接后果:
 * 1. **不 import electron**:electron 包是 CJS(默认导出 exe 路径字符串),命名导入抛
 *    SyntaxError。改为先 register() 仓内 electron-mock-loader.mjs,把 "electron" 解析到
 *    electron-mock.mjs,再动态 import 段 —— 段模块依赖链(如 test/common/pdf-utils.js 的
 *    BrowserWindow)因此能照常解析。register 必须早于**任何** electron 相关 import,
 *    故本文件的静态导入面只含 node: 内建与不依赖 electron 的 test/common 模块
 *    (entry-guard 与段模块都走动态 import)。
 * 2. **不重定向 userData**:redirectUserData 走 app.setPath,纯 node 的 mock 没有路径
 *    注册表。改为让 mock 的 app.getPath("userData") 直接读 USER_DATA_ENV(见
 *    electron-mock.mjs 的注释),落点仍是父进程建好的一次性目录(mkdtemp 已存在)。
 *    **不 chdir** —— 段内产物路径由 paths.js 从仓库根解析,改 cwd 会让它们全部指向别处。
 * 3. **不用 app.exit 收尾**:mock 的 app.exit 是 no-op(纯 node 下没有 electron 的退出
 *    路径)。退出码经 runEntry 的 exit 注入点由 process.exit 兑现;结果回传失败走
 *    自身的 EXIT_REPORT。
 * 4. **不经 app.whenReady**:mock 的 whenReady 立即 resolve,直接进 work。
 * 5. **自持一个常驻句柄**(见 holdEventLoop):Electron 宿主背后有 Chromium 消息循环,
 *    进程在任何 await 悬着时都不会自己退出;纯 node 没有它,事件循环一空进程就以
 *    13(unsettled top-level await)退掉,「段还在跑」被误报成「段崩溃」。
 *
 * 未覆盖的能力(段若真去调就失败,属实验结论而非契约违约):printToPDF 的真实输出、
 * 真实 BrowserWindow 实例方法、BrowserWindow/Menu/screen/clipboard 的静态 API、
 * session.fromPartition 返真实 session。这些段的失败面由段自己回传,父进程照常记账。
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { setCaseProgressSink } from "./case.js";
import {
  SEGMENT_FILE_ENV,
  SEGMENT_RESULT_ENV,
  collectSegmentOutcome,
  encodeArtifactSnapshots,
  runSegment,
  segmentOutcomeError,
  writeSegmentResult,
} from "./runner.js";
import { createTempUserData, removeTempUserData } from "../../shared/userdata.js";

/** 缺环境变量(被误当普通段直接跑)时的退出码,与"段失败(1)"区分(同 segment-host.mjs) */
const EXIT_USAGE = 2;
/** 结果回传失败的退出码(同 segment-host.mjs) */
const EXIT_REPORT = 3;

/** 入口标识(诊断首行 `[entry:...]` 用) */
const ENTRY = "segment-host-node";

/**
 * 装一个常驻句柄把事件循环按住,让「段还在 await」不再等于「进程自己退了」。
 *
 * 为什么必须补这一条:Electron 宿主背后有 Chromium 消息循环,进程在任何 await 悬着时
 * 都不会自然退出 —— 这是被测代码能依赖的运行环境的一部分(超时降级、挂起、等待子进程
 * 回调都建立在它上面)。纯 node 没有等价物:最后一个句柄释放即退出,未 settle 的顶层
 * await 还会以 13 退出,于是父进程把「段还在跑」记成「段崩溃/异常退出」。
 *
 * 为什么不 unref:unref 过的计时器**不**持有事件循环,那正是要修的形态。
 * 为什么不手动清:退出由 process.exit 硬退(见 main 的 exit 注入点),句柄在场不会挂住进程。
 * @returns {() => void} 释放函数(仅供显式收尾路径备用,正常路径不调用)
 */
function holdEventLoop() {
  const handle = setInterval(() => {}, 60_000);
  return () => clearInterval(handle);
}

const segmentFile = process.env[SEGMENT_FILE_ENV];
const resultPath = process.env[SEGMENT_RESULT_ENV];
// 父进程没给目录(手工直跑本文件)时自建一个,退出时自己删:同样不碰真实 %APPDATA%
const ownUserData = segmentFile && resultPath ? null : createTempUserData();

/**
 * 跑完一个段:执行 → 收集 case/快照 → 原子回传 → 给出退出码
 * (冲刷与退出由壳层统一收口,本函数只给判定语义码)。
 * @returns {Promise<number>} 退出码(0 段通过 / 1 段失败 / 3 结果回传失败)
 */
async function runHostedSegment() {
  // 超时前进度:每个 case 结算即把当前结果落盘(complete=false),段被硬杀也不丢证据
  setCaseProgressSink((cases) => {
    try {
      writeSegmentResult(/** @type {string} */ (resultPath), {
        complete: false,
        ok: false,
        error: null,
        cases: cases.map((c) => ({ ...c })),
        artifacts: [],
      });
    } catch (err) {
      // 进度落盘失败不掩盖段级失败面(最终结果仍会尝试回传)
      console.error(`[warn] case 进度落盘失败: ${err instanceof Error ? err.message : err}`);
    }
  });
  /** @type {unknown} */
  let ret;
  /** @type {unknown} */
  let error;
  try {
    ret = await runSegment(pathToFileURL(/** @type {string} */ (segmentFile)).href);
  } catch (err) {
    error = err;
  }
  setCaseProgressSink(null); // 注销在最终回传之前,防迟到的结算覆盖已完成结果
  const outcome = collectSegmentOutcome(ret);
  const segmentError = segmentOutcomeError(outcome, error);
  const payload = {
    complete: true,
    ok: !segmentError,
    error: segmentError
      ? { message: segmentError.message, ...(segmentError.stack ? { stack: segmentError.stack } : {}) }
      : null,
    cases: outcome.cases.map((c) => ({ ...c })),
    // 产物快照只随失败段回传(成功段不付 base64 序列化成本)
    artifacts: segmentError ? encodeArtifactSnapshots(outcome.artifacts) : [],
  };
  try {
    writeSegmentResult(/** @type {string} */ (resultPath), payload);
  } catch (err) {
    console.error(`[fail] 结果回传失败: ${err instanceof Error ? err.message : err}`);
    if (ownUserData) removeTempUserData(ownUserData);
    return EXIT_REPORT;
  }
  if (ownUserData) removeTempUserData(ownUserData);
  return payload.ok ? 0 : 1;
}

/**
 * 按契约跑一段:装 electron 解析拦截 → 动态 import 段 → 走壳层收尾。
 * 缺环境变量 / loader 装不上 → 按用法错误(EXIT_USAGE)退出,不进壳层。
 */
async function main() {
  if (!segmentFile || !resultPath) {
    console.error(
      `[fail] 段子进程宿主缺少环境变量(${SEGMENT_FILE_ENV}/${SEGMENT_RESULT_ENV}):应由 test/common/runner.js 派发,勿直接运行`,
    );
    // 不用 app.exit(mock 的实现是 no-op):设退出码后进程自然退出即可 —— 此时尚未 import
    // 段,不存在需要强制终止的悬挂句柄。
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (typeof register !== "function") {
    console.error("[fail] 当前 Node 不支持 module.register,无法在纯 node 下解析 electron(装不上 mock loader)");
    process.exitCode = EXIT_USAGE;
    return;
  }
  try {
    register("./electron-mock-loader.mjs", import.meta.url);
  } catch (err) {
    console.error(`[fail] electron mock loader 注册失败: ${err instanceof Error ? err.message : err}`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  // 本进程已以纯 node 模式启动,该变量只对「启动那一刻」有意义。段内若自己 spawn
  // process.execPath(段自测、门禁探针、entry-guard 端到端锚点都是这个形态),继承到
  // ELECTRON_RUN_AS_NODE=1 会让那些子进程**也**退化成纯 node —— 它们要的是真 Electron,
  // 于是「段内夹具起不来」被误报成「段本身不可迁移」。故启动后立刻摘掉:让段内 spawn
  // 回到 Electron 语义,宿主层的变化不外溢到段内夹具。
  delete process.env.ELECTRON_RUN_AS_NODE;
  const releaseEventLoop = holdEventLoop();
  const { runEntry } = await import("../../shared/entry-guard.mjs");
  void runEntry({
    entry: ENTRY,
    work: () => runHostedSegment(),
    // 退出码由 runEntry 兑现:显式写 exitCode 再 process.exit,让父进程拿到确定的语义码
    // (纯 node 下没有 app.exit 可用,见文件头第 3 条差异)。句柄在退出前不必手工清,
    // 进程是被 process.exit 硬退的,不会挂住 —— 清它反而多一条「忘了清导致段永不退出」
    // 的新失败面。
    exit: (code) => {
      void releaseEventLoop;
      process.exitCode = code;
      process.exit(code);
    },
  });
}

await main();
