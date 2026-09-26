/**
 * 编排角色:按缩放档位串行起 worker 子进程(同一可执行文件 + 入口脚本,靠环境变量区分角色),
 * 收各档报告、算跨 DPI 像素基线与 diff、组装总报告,并给出总退出码。
 *
 * 防假绿第二道:worker 报告判绿但进程退出码非 0 时以退出码为准(判定与退出码不一致本身即脚本缺陷);
 * worker 没产出可读报告或超时被杀 → 该档「未测量」,绝不按通过处理。
 *
 * 退出码:0 全绿(每档都真测过且绿 + 跨 DPI 在容差内)/ 1 实测红灯 / 2 有档位未测量(未测量 ≠ 通过)。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONSTANT_GROUPS, SCENARIOS } from "../../test/tools/geometry/geometry-core.mjs";
import { EXIT_CODE_SEMANTICS, buildCrossDpiBaseline, decideGateOutcome, diffCrossDpi } from "./judge-cross-dpi.mjs";
import { scaleLabel, scaleRequestText } from "./judge-scale.mjs";
import { CROSS_DPI_NODES, config, entryScriptPath, reportPath, reportSpecs, root, writeReport } from "./driver.mjs";

/** @typedef {import("./judge-scale.mjs").ScaleRequest} ScaleRequest */

/* ══════════════ §8 编排角色:多档位串行 + 跨 DPI 基线 + 总报告 ═══════════════ */

/**
 * 起一个 worker 子进程并等它结束。
 * @param {object} input 输入
 * @param {ScaleRequest} input.request 档位请求
 * @param {string} input.label 档位标签
 * @param {string} input.reportPath worker 报告绝对路径
 * @param {string} input.shotDir worker 截图目录绝对路径
 * @returns {Promise<{ exitCode: number | null, signal: string | null, timedOut: boolean }>} 子进程结果
 */
function runWorkerProcess({ request, label, reportPath: workerReportPath, shotDir }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entryScriptPath], {
      env: {
        ...process.env,
        M2W_GEOMETRY_ROLE: "worker",
        M2W_GEOMETRY_SCALE_FACTOR: scaleRequestText(request),
        M2W_GEOMETRY_REPORT: workerReportPath,
        M2W_GEOMETRY_SHOT_DIR: shotDir,
        M2W_GEOMETRY_TOL_PX: String(config.tolPx),
        M2W_GEOMETRY_SCROLL_PX: String(config.scrollBudgetPx),
        M2W_GEOMETRY_SETTLE_MS: String(config.settleMs),
        M2W_GEOMETRY_STABLE_RESIZE_MS: String(config.stableAfterResizeMs),
        M2W_GEOMETRY_STABLE_STEP_MS: String(config.stableAfterStepMs),
        M2W_GEOMETRY_MAX_WAIT_MS: String(config.maxWaitMs),
        M2W_GEOMETRY_VIEWPORT_SETTLE_MS: String(config.viewportSettleMs),
        M2W_GEOMETRY_VIEWPORT_COMPENSATIONS: String(config.viewportCompensations),
        M2W_GEOMETRY_EXPECT_DPR: config.expectDpr === null ? "" : String(config.expectDpr),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    // 实时转发子进程输出并加档位前缀:长跑(每档 12 场景)无输出会让人以为卡死
    forward(child.stdout, label, false);
    forward(child.stderr, label, true);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[geo] 档位 ${label} 超过硬超时 ${config.runTimeoutMs}ms,终止 worker(该档记「未测量」)`);
      child.kill();
    }, config.runTimeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`[geo ${label}] worker 启动失败:${error instanceof Error ? error.message : String(error)}`);
      resolve({ exitCode: null, signal: null, timedOut });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut });
    });
  });
}

/**
 * 把子进程输出按行转发(带档位前缀)。
 * @param {NodeJS.ReadableStream | null} stream 输出流
 * @param {string} label 档位标签
 * @param {boolean} isErr 是否走 stderr
 * @returns {void}
 */
function forward(stream, label, isErr) {
  if (stream === null) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(label, line, isErr);
  });
  stream.on("end", () => {
    if (buffer !== "") emit(label, buffer, isErr);
  });
}

/**
 * 单行转发。
 * @param {string} label 档位标签
 * @param {string} line 文本
 * @param {boolean} isErr 是否走 stderr
 * @returns {void}
 */
function emit(label, line, isErr) {
  const text = `[geo ${label}] ${line}`;
  if (isErr) console.error(text);
  else console.log(text);
}

/**
 * 读 worker 报告;读不到一律当作「没有测到」,不返回半成品。
 * @param {string} file 报告绝对路径
 * @returns {object | null} 报告或 null
 */
function readWorkerReport(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`[geo] worker 报告无法解析(${path.basename(file)}):${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 由 worker 退出码 + 报告组装该档运行记录。
 *
 * 防假绿:报告说「measured/绿」但进程退出码非 0 时,以退出码为准记 failed ——
 * 判定与退出码不一致本身就是脚本缺陷,不能按绿放行。
 * @param {object} input 输入
 * @param {ScaleRequest} input.request 档位请求
 * @param {string} input.label 档位标签
 * @param {number | null} input.exitCode worker 退出码
 * @param {boolean} input.timedOut 是否超时被杀
 * @param {object | null} input.parsed worker 报告
 * @param {string} input.reportRelative 报告相对路径(写入总报告)
 * @param {string} shotDir 截图目录绝对路径
 * @returns {object} 运行记录
 */
function toRunRecord({ request, label, exitCode, timedOut, parsed, reportRelative, shotDir }) {
  const base = {
    label,
    requested: scaleRequestText(request),
    mode: request.mode,
    workerExitCode: exitCode,
    workerTimedOut: timedOut,
    report: reportRelative,
    shots: path.relative(root, shotDir).replaceAll("\\", "/"),
  };
  if (parsed === null) {
    return {
      ...base,
      status: /** @type {const} */ ("unmeasured"),
      reason: `worker 未产出可读报告(退出码 ${String(exitCode)}${timedOut ? ",已超时终止" : ""});该档未测量,不得记通过`,
      devicePixelRatio: { expected: null, measured: [], displayScaleFactor: null },
      viewport: null,
      geometry: null,
      samples: null,
    };
  }
  const scaleFactor = parsed.scaleFactor ?? {};
  const reportedStatus = parsed.status ?? "unmeasured";
  const inconsistent = reportedStatus === "measured" && exitCode !== 0;
  return {
    ...base,
    status: inconsistent ? /** @type {const} */ ("failed") : reportedStatus,
    reason:
      (inconsistent ? `worker 报告判绿但退出码为 ${String(exitCode)}(判定与退出码不一致,以退出码为准);` : "") +
      (parsed.reason ?? null),
    devicePixelRatio: {
      expected: scaleFactor.expectedDevicePixelRatio ?? null,
      measured: Array.isArray(scaleFactor.measuredDevicePixelRatios) ? scaleFactor.measuredDevicePixelRatios : [],
      displayScaleFactor: scaleFactor.displayScaleFactor ?? null,
    },
    viewport: parsed.viewport ?? null,
    geometry: parsed.geometry ?? null,
    samples: Array.isArray(parsed.samples) ? parsed.samples : null,
  };
}

/**
 * 编排入口:逐档跑 worker → 收报告 → 跨 DPI 基线与 diff → 落总报告 → 给退出码。
 * @param {ScaleRequest[]} scales 档位请求列表
 * @returns {Promise<number>} 退出码
 */
export async function runOrchestrator(scales) {
  const baseDir = path.dirname(reportPath);
  /** @type {object[]} */
  const runs = [];
  for (const request of scales) {
    const label = scaleLabel(request);
    const shotDir = path.join(baseDir, `scale-${label}`);
    const workerReportPath = path.join(shotDir, "report.json");
    fs.mkdirSync(shotDir, { recursive: true });
    console.log(
      `[geo] 档位 ${label}(${request.mode === "native" ? "系统当前缩放" : `强制 ${String(request.value)}`})开始:` +
        `${SCENARIOS.length} 场景 × ${CONSTANT_GROUPS.length} 恒定组`,
    );
    const { exitCode, timedOut } = await runWorkerProcess({ request, label, reportPath: workerReportPath, shotDir });
    const record = toRunRecord({
      request,
      label,
      exitCode,
      timedOut,
      parsed: readWorkerReport(workerReportPath),
      reportRelative: path.relative(root, workerReportPath).replaceAll("\\", "/"),
      shotDir,
    });
    runs.push(record);
    const dprText = record.devicePixelRatio.measured.length > 0 ? record.devicePixelRatio.measured.join("/") : "(未读到)";
    if (record.status === "measured") {
      console.log(
        `[geo] 档位 ${label}:devicePixelRatio=${dprText}(期望 ${String(record.devicePixelRatio.expected)})→ ` +
          `${record.geometry?.stats?.scenarios ?? 0} 场景 / ${record.geometry?.stats?.groups ?? 0} 恒定组 绿`,
      );
    } else {
      console.error(`[geo:warn] 档位 ${label} ${record.status}:${record.reason ?? "(无原因)"}`);
    }
  }

  const diffable = runs
    .filter((run) => run.status === "measured" && run.samples !== null)
    .map((run) => ({
      label: run.label,
      request: scales.find((s) => scaleLabel(s) === run.label) ?? { mode: /** @type {const} */ ("native") },
      status: /** @type {const} */ ("measured"),
      reason: null,
      measuredDevicePixelRatios: run.devicePixelRatio.measured,
      displayScaleFactor: run.devicePixelRatio.displayScaleFactor,
      findings: [],
      samples: run.samples,
    }));
  const baseline = buildCrossDpiBaseline({ runs: diffable, nodes: CROSS_DPI_NODES });
  const crossDpi = diffCrossDpi({ baseline, tolPx: config.crossTolPx });
  const outcome = decideGateOutcome({ runs, crossDpi });

  const baselineRun = runs.find((run) => run.label === "native") ?? runs.find((run) => run.status === "measured") ?? null;
  const stats = runs.find((run) => run.geometry !== null)?.geometry?.stats;
  writeReport(reportPath, {
    tool: "check-geometry",
    schema: 2,
    ok: outcome.ok,
    status: outcome.status,
    exitCode: outcome.code,
    exitCodeSemantics: EXIT_CODE_SEMANTICS,
    options: {
      tolPx: config.tolPx,
      scrollBudgetPx: config.scrollBudgetPx,
      settleMs: config.settleMs,
      stableAfterResizeMs: config.stableAfterResizeMs,
      stableAfterStepMs: config.stableAfterStepMs,
      maxWaitMs: config.maxWaitMs,
      viewportSettleMs: config.viewportSettleMs,
      viewportCompensations: config.viewportCompensations,
      crossDpiTolPx: config.crossTolPx,
      runTimeoutMs: config.runTimeoutMs,
      expectDevicePixelRatio: config.expectDpr,
      scales: scales.map((request) => ({
        label: scaleLabel(request),
        requested: scaleRequestText(request),
        mode: request.mode,
      })),
    },
    stats: {
      scenarios: stats?.scenarios ?? SCENARIOS.length,
      groups: stats?.groups ?? CONSTANT_GROUPS.length,
      scalesRequested: runs.length,
      scalesMeasured: outcome.measured.length,
      scalesUnmeasured: outcome.unmeasured.length,
      scalesFailed: outcome.failed.length,
      crossDpiNodes: CROSS_DPI_NODES.length,
      crossDpiCells: crossDpi.compared,
      crossDpiStatus: crossDpi.status,
    },
    specs: reportSpecs(),
    scales: runs.map((run) => {
      const entry = { ...run };
      // 各档采样明细留在各自报告里,总报告不重复内联多份(基线档除外)
      delete entry.samples;
      return entry;
    }),
    crossDpi: {
      status: crossDpi.status,
      tolPx: crossDpi.tolPx,
      maxDeltaPx: crossDpi.maxDeltaPx,
      compared: crossDpi.compared,
      factors: baseline.factors,
      nodes: baseline.nodes,
      cells: baseline.cells,
      findings: crossDpi.findings,
      skipped: crossDpi.skipped,
    },
    findings: runs.flatMap((run) => (run.geometry?.findings ?? []).map((finding) => ({ scale: run.label, ...finding }))),
    // 基线档(系统当前缩放,缺失时取首个实测档)的完整采样明细内联在此;
    // 各档明细在各自报告里(总报告不重复内联多份 12 场景采样)
    baseline:
      baselineRun === null
        ? null
        : {
            label: baselineRun.label,
            devicePixelRatio: baselineRun.devicePixelRatio,
            report: baselineRun.report,
            samples: baselineRun.samples,
          },
  });

  for (const finding of crossDpi.findings) {
    console.error(`[geo:fail] ${finding.rule} | ${finding.scenario} | ${finding.node} | ${finding.message}`);
  }
  for (const run of runs) {
    for (const finding of run.geometry?.findings ?? []) {
      console.error(`[geo:fail] [${run.label}] ${finding.rule} | ${finding.scenario} | ${finding.node ?? "-"} | ${finding.message}`);
    }
  }
  printSummary({ runs, crossDpi, outcome, stats });
  return outcome.code;
}

/**
 * 打印总摘要(成功 / 红灯 / 未测量三种语义分别成句,不让「跑完了」看起来像「通过了」)。
 * @param {object} input 输入
 * @param {object[]} input.runs 各档运行记录
 * @param {ReturnType<typeof diffCrossDpi>} input.crossDpi 跨 DPI diff 结果
 * @param {ReturnType<typeof decideGateOutcome>} input.outcome 总判定
 * @param {object | undefined} input.stats 判定层统计(取首个有值的档位)
 * @returns {void}
 */
function printSummary({ runs, crossDpi, outcome, stats }) {
  const measuredText = runs
    .filter((run) => run.status === "measured")
    .map((run) => `${run.label}(dpr=${run.devicePixelRatio.measured.join("/")})`)
    .join("、");
  const reportRel = path.relative(root, reportPath);
  if (outcome.code === 0) {
    console.log(
      `[geo:ok] 几何门禁通过:实测 ${measuredText};${stats?.scenarios ?? SCENARIOS.length} 场景 / ` +
        `${stats?.groups ?? CONSTANT_GROUPS.length} 恒定组 / 容差 ${config.tolPx}px / ` +
        `紧凑滚动预算 ${config.scrollBudgetPx}px;跨 DPI 基线 ${crossDpi.compared} 单元` +
        `(最大偏差 ${crossDpi.maxDeltaPx}px ≤ 容差 ${crossDpi.tolPx}px,状态 ${crossDpi.status});报告 ${reportRel}`,
    );
    return;
  }
  if (outcome.code === 1) {
    console.error(
      `[geo:fail] 几何门禁失败:档位 ${outcome.failed.join("、") || "(无)"} 判红` +
        `${crossDpi.status === "over-tolerance" ? `,跨 DPI 基线超容差 ${config.crossTolPx}px` : ""}` +
        `(实测 ${measuredText};报告 ${reportRel},截图目录见报告 scales[].shots)`,
    );
    return;
  }
  console.error(
    `[geo:partial] 几何门禁部分完成:未测量档位 ${outcome.unmeasured.join("、")};` +
      `已测档位 ${outcome.measured.join("、") || "(无)"} 全绿,跨 DPI 状态 ${crossDpi.status}。` +
      `未测量 ≠ 通过,退出码 2;详见报告 ${reportRel} 的 scales[].reason`,
  );
}
