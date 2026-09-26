/**
 * 段子进程宿主(逐段隔离执行模型的子进程入口,一次只跑一个段):
 * 父进程 test/common/runner.js 用同一 Electron 可执行文件派生本文件,注入三件东西:
 * - M2W_SEGMENT_FILE:待跑段文件绝对路径(段清单与 M2W_ONLY 筛选都在父进程做,子进程只跑指定段);
 * - M2W_SEGMENT_RESULT:结果回传文件绝对路径;
 * - M2W_SEGMENT_USER_DATA:本段专属 userData 目录(父进程创建,退出后由父进程删除)。
 * 契约(与 runner.js 配对,勿单边改):
 * - userData 必须在 whenReady **之前**重定向(段内 settings/ui-state 直读真实路径);
 * - 段结果、case 结果、失败段的 buffer 快照经 writeSegmentResult 原子回传
 *   (complete=false 表示 run() 未跑完,只有超时前进度);
 * - case 进度钩子(case.js setCaseProgressSink)让被硬终止的段也留下"已完成 case"证据;
 * - 段内自持的 BrowserWindow **不**作为退出条件:段末 flush 后 app.exit 强退,
 *   故窗口与临时 HTML 的清理由各段自己负责(段末 destroy/dispose),
 *   不再依赖入口的 app.quit()(逐段独立进程后入口无窗口可关)。
 */
import { app } from "electron";
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
import { createTempUserData, redirectUserData, removeTempUserData, USER_DATA_ENV } from "./userdata.js";

/** 缺环境变量(被误当普通段直接跑)时的退出码,与"段失败(1)"区分 */
const EXIT_USAGE = 2;
/** 结果回传失败的退出码 */
const EXIT_REPORT = 3;

const segmentFile = process.env[SEGMENT_FILE_ENV];
const resultPath = process.env[SEGMENT_RESULT_ENV];
// 父进程没给目录(手工直跑本文件)时自建一个,退出时自己删:同样不碰真实 %APPDATA%
const ownUserData = segmentFile && resultPath ? null : createTempUserData();
const userDataDir = process.env[USER_DATA_ENV] ?? ownUserData;
if (userDataDir) redirectUserData(app, userDataDir);
// 段内窗口自持:窗口全关不触发退出(段末由 app.exit 收尾)
app.on("window-all-closed", () => {});

/**
 * 退出前把 stdout/stderr 冲干净:app.exit 立即终止进程,管道场景下未落盘的
 * 段内日志会被截断(空写回调 = 之前的写入已 flush)。
 */
async function flushOutput() {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.writableLength > 0) await new Promise((resolve) => stream.write("", resolve));
  }
}

/** 跑完一个段:执行 → 收集 case/快照 → 原子回传 → 按结果退出 */
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
    await flushOutput();
    if (ownUserData) removeTempUserData(ownUserData);
    app.exit(EXIT_REPORT);
    return;
  }
  await flushOutput();
  if (ownUserData) removeTempUserData(ownUserData);
  app.exit(payload.ok ? 0 : 1);
}

if (!segmentFile || !resultPath) {
  console.error(
    `[fail] 段子进程宿主缺少环境变量(${SEGMENT_FILE_ENV}/${SEGMENT_RESULT_ENV}):应由 test/common/runner.js 派发,勿直接运行`,
  );
  app.exit(EXIT_USAGE);
} else {
  void app.whenReady().then(runHostedSegment);
}
