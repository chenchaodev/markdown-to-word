/**
 * 测试段执行框架(逐段子进程隔离,正式口径见 docs/OPTIMIZATION-PLAN.md D-08):
 * - 段文件 = test/segments/、test/main/ 或 test/renderer/ 下 *.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口按目录顺序自动发现)
 * - 单段筛选:设 M2W_ONLY=basic-render,mermaid 可只跑名称含任一子串的段
 *   (逗号分隔多个子串,大小写不敏感,匹配段名如 segments/basic-render.test.js;
 *   不设该变量时行为与全量运行完全一致)。筛选在**父进程**做,子进程只跑指定段。
 * - 执行模型(默认):父进程为每段派生**独立 Electron 子进程**(test/common/segment-host.mjs),
 *   段内崩溃/悬挂/超时只终结该段(超时由父进程真杀进程树,非 race 后放弃),其余段照常跑完;
 *   每段独立 userData 目录(见 test/common/userdata.js),退出即清理,故段间零状态串扰。
 * - 回退模型(仅供二分定位):设 M2W_ACCEPTANCE_INPROC=1 切回同进程顺序执行 +
 *   看门狗(race 后放弃,悬挂段无法终止,靠入口收尾硬退出释放);生产/CI 走默认隔离模型。
 * - case 级契约(可选):段内用 test/common/case.js 的 createCaseSuite 登记具名 case,
 *   run() 返回 `{ cases }` 即可;隔离模型下由子进程结构化回传(形状与同进程一致),
 *   runner 聚合后由入口打印 case 级报告。段内 case 失败同样把整段判失败
 *   (错误聚合为一条 Error),未接入的旧段行为不变(抛错即段失败)。
 * - 失败产物:失败段统一落盘 output/artifacts/failures/<段名>/(失败日志 + 该段登记的
 *   buffer 快照),见 artifacts.saveFailureArtifacts。隔离模型下 buffer 快照经
 *   base64 由子进程回传(仅失败段带),落盘仍只有父进程一处。
 */
import { spawn, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { saveFailureArtifacts } from "./artifacts.js";
import { drainSuites } from "./case.js";
import { repoRelative } from "./paths.js";
import { createTempUserData, removeTempUserData, USER_DATA_ENV } from "./userdata.js";

/** 段子进程宿主入口(父进程与宿主共用同一 Electron 可执行文件,一次只跑一个段) */
const SEGMENT_HOST = fileURLToPath(new URL("./segment-host.mjs", import.meta.url));
/** 父进程 → 子进程:待跑段文件绝对路径 */
export const SEGMENT_FILE_ENV = "M2W_SEGMENT_FILE";
/** 父进程 → 子进程:结果回传文件绝对路径(宿主原子写,父进程读) */
export const SEGMENT_RESULT_ENV = "M2W_SEGMENT_RESULT";
/** 回退开关:设 1/true 切回同进程模型(仅二分定位用,默认隔离) */
export const INPROC_ENV = "M2W_ACCEPTANCE_INPROC";
/** 每段 userData 目录名前缀(与段内业务临时目录 m2w-* 区分,便于识别残留) */
const SEGMENT_USERDATA_PREFIX = "m2w-segment-";
/** 结果回传文件名(落在该段 userData 目录内,随目录一起清理) */
const RESULT_FILE = "segment-result.json";
/** 硬杀进程树后等待 exit 事件的上限(超过则按"已终止"记账并继续,留痕告警) */
const KILL_GRACE_MS = 10000;

/**
 * 按传入目录顺序发现全部测试段文件(目录内按文件名排序);
 * 返回 { dir, file, name },name 带目录前缀(如 segments/basic-render.test.js),
 * 避免跨目录重名混淆,也便于阅读。
 * 设 M2W_ONLY 时按逗号分隔子串筛选(对完整段名做大小写不敏感的包含匹配),
 * 任一子串命中即保留;未设/空串 = 不过滤(默认全量)。
 */
export async function discoverSegments(dirs) {
  const found = [];
  for (const dir of dirs) {
    const prefix = path.basename(dir);
    const entries = await fs.readdir(dir);
    for (const f of entries.filter((f) => f.endsWith(".test.js")).sort()) {
      found.push({ dir, file: f, name: `${prefix}/${f}` });
    }
  }
  const only = process.env.M2W_ONLY?.trim();
  if (!only) return found;
  const needles = only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return found;
  return found.filter((s) => needles.some((n) => s.name.toLowerCase().includes(n)));
}

/**
 * 加载并执行单个测试段(段内断言失败应 throw,由调用方汇总)。
 * 返回段 run() 的返回值(case 契约的 `{ cases, artifacts }` 即由此上送)。
 * @param {string} fileUrl 段文件 URL
 * @returns {Promise<unknown>} 段 run() 返回值
 */
export async function runSegment(fileUrl) {
  const mod = await import(fileUrl);
  if (typeof mod.run !== "function") {
    throw new Error("测试段缺少 run() 导出");
  }
  return await mod.run();
}

/* ---------- case 契约聚合(同进程与子进程两条路径共用,单一来源) ---------- */

/**
 * case 级失败聚合为一条 Error:段内 case 不抛,段级失败由这里归一(栈替换为 case 明细,
 * 避免报告里出现 runner 内部帧淹没真实失败点)。
 * @param {{name: string, ok: boolean, ms: number, group?: string, message?: string}[]} cases
 * @returns {Error}
 */
export function caseFailureError(cases) {
  const failed = cases.filter((c) => !c.ok);
  const detail = failed
    .map((c) => `  - ${c.group ? `${c.group} › ` : ""}${c.name}: ${c.message ?? "未知失败"}`)
    .join("\n");
  const error = new Error(`${failed.length}/${cases.length} 个 case 失败:\n${detail}`);
  error.stack = error.message;
  return error;
}

/**
 * 收集一段的 case 结果与产物快照(同进程与子进程宿主共用的同一判定):
 * 段 run() 回传优先;未回传则取本进程登记的 suite(防漏回传被静默判过)。
 * @param {unknown} ret 段 run() 返回值
 * @returns {{ cases: object[], artifacts: {name: string, buffers: Record<string, Buffer>}[] }}
 */
export function collectSegmentOutcome(ret) {
  const collected = drainSuites();
  /** @type {{ cases?: object[], artifacts?: {name: string, buffers: Record<string, Buffer>}[] }} */
  const payload = /** @type {any} */ (ret) ?? {};
  return {
    cases: Array.isArray(payload.cases) ? payload.cases : collected.flatMap((h) => h.cases),
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : collected.flatMap((h) => h.snapshots),
  };
}

/**
 * 判定一段的成败:段级抛错优先,否则有失败 case 即判失败(错误聚合为一条)。
 * @param {{cases: object[]}} outcome collectSegmentOutcome 的结果
 * @param {unknown} [error] 段级错误(无则按 case 结果判定)
 * @returns {Error | undefined} 段级错误(通过则 undefined)
 */
export function segmentOutcomeError(outcome, error) {
  if (error) return /** @type {Error} */ (error);
  return outcome.cases.some((c) => !c.ok) ? caseFailureError(outcome.cases) : undefined;
}

/* ---------- 子进程结果回传载荷(父子契约,宿主写 / 父进程读) ---------- */

/**
 * @typedef {object} SegmentResultPayload 子进程 → 父进程的结果载荷
 * @property {boolean} complete run() 是否已跑完(false = 段被硬终止,只有超时前进度)
 * @property {boolean} ok 段是否通过
 * @property {{message: string, stack?: string} | null} error 段级错误(已归一为可序列化形状)
 * @property {object[]} cases case 结果(形状与同进程一致,见 case.js CaseResult)
 * @property {{name: string, buffers: Record<string, string>}[]} artifacts 产物快照(base64;仅失败段带)
 */

/**
 * 产物快照编码为 JSON 形状(buffer → base64):仅失败段回传,成功段不付序列化成本。
 * @param {{name: string, buffers: Record<string, Buffer>}[]} snapshots
 * @returns {{name: string, buffers: Record<string, string>}[]}
 */
export function encodeArtifactSnapshots(snapshots) {
  return snapshots.map(({ name, buffers }) => ({
    name,
    buffers: Object.fromEntries(
      Object.entries(buffers).map(([ext, buf]) => [ext, Buffer.from(buf).toString("base64")]),
    ),
  }));
}

/**
 * 产物快照解码回 Buffer 集合(父进程落盘失败快照用)。
 * @param {{name: string, buffers: Record<string, string>}[]} snapshots
 * @returns {{name: string, buffers: Record<string, Buffer>}[]}
 */
export function decodeArtifactSnapshots(snapshots) {
  return snapshots.map(({ name, buffers }) => ({
    name,
    buffers: Object.fromEntries(
      Object.entries(buffers).map(([ext, b64]) => [ext, Buffer.from(b64, "base64")]),
    ),
  }));
}

/**
 * 原子写结果回传文件(先写 .tmp 再 rename,避免父进程读到半截 JSON)。
 * @param {string} resultPath 结果文件路径
 * @param {SegmentResultPayload} payload 结果载荷
 */
export function writeSegmentResult(resultPath, payload) {
  const tmp = `${resultPath}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fsSync.renameSync(tmp, resultPath);
}

/**
 * 读回结果载荷;文件不存在/JSON 损坏(如宿主被硬杀在写盘中途)→ null,由父进程按
 * 崩溃/超时归一。
 * @param {string} resultPath 结果文件路径
 * @returns {Promise<SegmentResultPayload | null>}
 */
export async function readSegmentResult(resultPath) {
  let text;
  try {
    text = await fs.readFile(resultPath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 把回传载荷的段级错误还原为 Error 对象(报告按 error.stack 打印,形状与同进程一致)。
 * @param {SegmentResultPayload} payload
 * @returns {Error | undefined}
 */
export function reviveSegmentError(payload) {
  if (!payload.error) return undefined;
  const error = new Error(payload.error.message);
  if (payload.error.stack) error.stack = payload.error.stack;
  return error;
}

/* ---------- 隔离执行:父进程派生一个段一个子进程 ---------- */

/**
 * 硬杀子进程及其派生进程:Windows 无进程组,`taskkill /T` 才能连带终止 Electron
 * 拉起的渲染/GPU 进程(否则渲染进程会变孤儿,句柄不释放 → 临时目录删不掉);
 * 其它平台用 SIGKILL。
 * @param {{pid?: number, kill(signal?: string): boolean}} child 子进程句柄
 */
function killProcessTree(child) {
  if (typeof child.pid !== "number") return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGKILL");
}

/**
 * 隔离模型下跑单段:派生独立 Electron 子进程,硬超时真杀进程树,读回结构化结果。
 * - 段内抛错 → 子进程回传 error,本段失败(其余段不受影响);
 * - 段崩溃(渲染进程崩溃/未捕获异常/硬 exit)→ 无回传或 complete=false,按崩溃归一;
 * - 超时 → 杀掉进程树,该段记 timeout 失败;回传文件里若有超时前已完成的 case
 *   (宿主经 case 进度钩子增量落盘),一并作为失败面证据。
 * @param {{dir: string, file: string, name: string}} s 段描述
 * @param {number} timeout 硬超时(ms);0/NaN 等无效值 = 不启用(等段自然结束)
 * @returns {Promise<{ ok: boolean, ms: number, ret?: unknown, error?: unknown, timedOut?: boolean }>}
 */
async function runSegmentIsolated(s, timeout) {
  const start = Date.now();
  const userDataDir = createTempUserData(SEGMENT_USERDATA_PREFIX);
  const resultPath = path.join(userDataDir, RESULT_FILE);
  // 段内 stdout/stderr 直接继承父进程:段内日志原样出现在总输出里,不经管道转码
  // (Windows 管道重编码会破坏中文与制表符),格式与同进程模型完全一致
  const child = spawn(process.execPath, [SEGMENT_HOST], {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
    env: {
      ...process.env,
      [SEGMENT_FILE_ENV]: path.join(s.dir, s.file),
      [SEGMENT_RESULT_ENV]: resultPath,
      // 覆盖(而非透传)外层的同名变量:嵌套编排(如 runner 自测段内再跑子进程段)
      // 时每段仍拿自己的新目录
      [USER_DATA_ENV]: userDataDir,
    },
  });

  const timeoutEnabled = timeout > 0 && Number.isFinite(timeout);
  const exit = await new Promise((resolve) => {
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {NodeJS.Timeout | undefined} */
    let graceTimer;
    let timedOut = false;
    const settle = (value) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(value);
    };
    if (timeoutEnabled) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
        // 兜底:极端情况下(句柄被占用等)进程没被终结,不再无限等 exit,继续记账
        graceTimer = setTimeout(() => settle({ code: null, signal: "SIGKILL", timedOut, unterminated: true }), KILL_GRACE_MS);
      }, timeout);
    }
    child.once("error", (error) => settle({ code: null, signal: null, timedOut, spawnError: error }));
    child.once("exit", (code, signal) => settle({ code, signal, timedOut }));
  });

  const payload = await readSegmentResult(resultPath);
  removeTempUserData(userDataDir);
  const ms = Date.now() - start;
  const timedOut = Boolean(exit.timedOut);

  // 段已跑完 run() 并回传(退出慢/被杀只是收尾问题)→ 采信其结果
  if (payload?.complete) {
    if (timedOut) {
      console.warn(`[warn] ${s.name}:已回传完整结果但未在 ${timeout}ms 内退出,已终止子进程(段结果采信回传)`);
    }
    // 段级错误必须一并回传:只采信 ok 标志会把"段内抛错/case 失败"误判成通过
    const error = reviveSegmentError(payload);
    return {
      ok: payload.ok && !error,
      ms,
      ret: {
        cases: Array.isArray(payload.cases) ? payload.cases : [],
        artifacts: decodeArtifactSnapshots(Array.isArray(payload.artifacts) ? payload.artifacts : []),
      },
      ...(error ? { error } : {}),
    };
  }

  const partialCases = Array.isArray(payload?.cases) ? payload.cases : [];
  if (timedOut) {
    return {
      ok: false,
      ms,
      ret: { cases: partialCases, artifacts: [] },
      error: new Error(
        `测试段超时(${timeout}ms): ${s.name}(已硬终止该段子进程,后续段继续执行;以下 case 为超时前已完成的进度)`,
      ),
      timedOut: true,
    };
  }
  if (exit.unterminated) {
    console.warn(`[warn] ${s.name}:硬杀后子进程仍未退出(${KILL_GRACE_MS}ms),继续后续段(可能残留句柄)`);
    return {
      ok: false,
      ms,
      ret: { cases: partialCases, artifacts: [] },
      error: new Error(`测试段子进程未在硬杀后退出(${KILL_GRACE_MS}ms): ${s.name}`),
    };
  }
  if (exit.spawnError) {
    return { ok: false, ms, error: new Error(`测试段子进程启动失败: ${s.name}: ${exit.spawnError.message}`) };
  }
  return {
    ok: false,
    ms,
    ret: { cases: partialCases, artifacts: [] },
    error: new Error(
      `测试段子进程异常退出(退出码 ${exit.code ?? "无"},无完整结果回传): ${s.name}(段崩溃;后续段继续执行)`,
    ),
  };
}

/**
 * 同进程回退模型下的单段执行(仅二分定位用,见文件头「回退模型」):
 * - 超时 → 该段标记失败,继续放行后续段(一次看全失败面),置 timedOut 标志。
 * - 已知局限:悬挂段与 runner 同进程,无法终止其 promise;超时后悬挂段仍后台残留,
 *   由 runAll 跑完全部段、入口打印结果后硬退出统一释放其资源。
 * - 段 promise 统一收敛为 `{ ret }`(正常)或 `{ error }`(段内抛错),故只有看门狗
 *   超时会走 reject 分支,`timedOut` 不再靠错误文案嗅探。
 * @param {{dir: string, file: string, name: string}} s 段描述
 * @param {number} timeout 看门狗超时(ms);0/NaN 等无效值 = 不启用
 * @returns {Promise<{ ok: boolean, ms: number, ret?: unknown, error?: unknown, timedOut?: boolean }>}
 */
async function runSegmentWithWatchdog(s, timeout) {
  const start = Date.now();
  const segmentPromise = runSegment(pathToFileURL(path.join(s.dir, s.file)).href).then(
    (ret) => ({ ret }),
    (error) => ({ error }),
  );
  const watchdogEnabled = timeout > 0 && Number.isFinite(timeout);
  let timer;
  /** @type {Promise<never> | undefined} */
  let watchdog;
  if (watchdogEnabled) {
    watchdog = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`测试段超时(${timeout}ms): ${s.name}(该段记失败,后续段继续执行,进程收尾硬退出释放悬挂资源)`)),
        timeout,
      );
    });
  }
  try {
    const settled = await (watchdog ? Promise.race([segmentPromise, watchdog]) : segmentPromise);
    if (settled.error) {
      return { ok: false, ms: Date.now() - start, error: settled.error, timedOut: watchdogEnabled ? false : undefined };
    }
    return { ok: true, ms: Date.now() - start, ret: settled.ret, timedOut: watchdogEnabled ? false : undefined };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err, timedOut: true };
  } finally {
    clearTimeout(timer);
    // 输家 promise 挂空 catch,防迟到的 unhandledRejection(悬挂段随进程硬退出终结)
    segmentPromise.catch(() => {});
    watchdog?.catch(() => {});
  }
}

/**
 * 失败日志正文:段名/耗时/超时标记 + case 明细(含失败消息、栈、附件引用)+ 段级错误。
 * @param {{file: string, ms: number, timedOut?: boolean, cases?: unknown[], error?: unknown}} r 段结果
 * @returns {string}
 */
function buildFailureLog(r) {
  const lines = [
    `段: ${r.file}`,
    `结果: 失败${r.timedOut ? "(超时终止,以下 case 为超时前已完成的进度)" : ""}`,
    `耗时: ${r.ms}ms`,
    "",
  ];
  if (Array.isArray(r.cases) && r.cases.length > 0) {
    lines.push("case 明细:");
    for (const c of r.cases) {
      const title = c.group ? `${c.group} › ${c.name}` : c.name;
      lines.push(`  - [${c.ok ? "通过" : "失败"}] ${title} (${c.ms}ms)`);
      // 附件对通过 case 同样登记(快照取该段已产出的产物),故两种状态都列
      if (Array.isArray(c.attachments) && c.attachments.length > 0) {
        lines.push(`      附件: ${c.attachments.join(", ")}`);
      }
      if (!c.ok) {
        lines.push(`      消息: ${c.message ?? "未知失败"}`);
        // 栈首行通常是 "Error: <消息>",与上面的消息行重复,去掉只留调用帧
        const frames = typeof c.stack === "string" ? c.stack.split("\n") : [];
        if (frames.length > 0 && c.message && frames[0].includes(c.message)) frames.shift();
        if (frames.length > 0) {
          lines.push(...frames.map((line) => `      ${line}`));
        }
      }
    }
    lines.push("");
  }
  lines.push("段级错误:", r.error instanceof Error ? (r.error.stack ?? r.error.message) : String(r.error));
  return `${lines.join("\n")}\n`;
}

/**
 * case 汇总(仅统计接入 case 契约的段)。
 * @param {{cases?: unknown[]}[]} results 段结果
 * @returns {{ segments: number, passed: number, failed: number, total: number }}
 */
export function summarizeCases(results) {
  let segments = 0;
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (!Array.isArray(r.cases) || r.cases.length === 0) continue;
    segments += 1;
    for (const c of r.cases) {
      if (c.ok) passed += 1;
      else failed += 1;
    }
  }
  return { segments, passed, failed, total: passed + failed };
}

/**
 * case 级报告正文(入口打印):失败 case 显示「段名 › case 名: 消息」+ 附件/失败产物
 * 路径;每段显示通过数;末尾一行合计。无 case 契约的段 = 返回空串(旧段输出不变)。
 * @param {Awaited<ReturnType<typeof runAll>>["results"]} results 段结果
 * @returns {string} 多行报告;无 case 结果时为空串
 */
export function formatCaseReport(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length > 0);
  if (withCases.length === 0) return "";
  const lines = [];
  for (const r of withCases) {
    const failed = r.cases.filter((c) => !c.ok).length;
    lines.push(`[cases] ${r.file}: ${r.cases.length - failed} 通过 / ${failed} 失败`);
    for (const c of r.cases) {
      if (c.ok) continue;
      const title = c.group ? `${c.group} › ${c.name}` : c.name;
      lines.push(`  [case-fail] ${r.file} › ${title}: ${c.message ?? "未知失败"}`);
      if (Array.isArray(c.attachments) && c.attachments.length > 0) {
        lines.push(`    附件: ${c.attachments.join(", ")}`);
      }
    }
    if (r.failureDir) {
      lines.push(`    失败产物: ${r.failureDir}`);
    }
  }
  const { segments, passed, failed, total } = summarizeCases(results);
  lines.push(`[cases] 合计: ${total} case(${segments} 段接入 case 契约): ${passed} 通过 / ${failed} 失败`);
  return lines.join("\n");
}

/**
 * 执行模型判定:默认逐段子进程隔离;显式传 isolate 优先,其次看回退开关
 * M2W_ACCEPTANCE_INPROC(设 1/true/yes/on 切回同进程顺序 + 看门狗,仅供二分定位)。
 * @param {{ isolate?: boolean }} [options] runAll 的 options
 * @returns {boolean} true = 逐段独立子进程
 */
export function resolveIsolation(options = {}) {
  if (typeof options.isolate === "boolean") return options.isolate;
  const raw = process.env[INPROC_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return !["1", "true", "yes", "on"].includes(raw);
}

/**
 * 顺序执行全部测试段(目录顺序 + 目录内文件名排序),返回逐段结果。
 * options.segmentTimeoutMs:单段硬超时(ms),由入口(acceptance.mjs)从环境变量
 * M2W_ACCEPTANCE_SEGMENT_TIMEOUT_MS 读入并传入;0 或 NaN 等无效值 = 不启用(等段自然结束)。
 * options.isolate:执行模型,默认取 resolveIsolation(子进程隔离;M2W_ACCEPTANCE_INPROC 可回退)。
 * 某段失败/超时/崩溃 → 只终结该段(隔离模型下父进程真杀其进程树),**继续执行后续段**
 * (一次看全失败面);同进程回退模型下看门狗超时无法终止悬挂段,返回值 hung=true
 * 提示入口须硬退出释放资源。
 * 失败段额外:落盘失败产物(failureDir = output/artifacts/failures/<段名>/);
 * 落盘失败只告警不中断(降级留痕,失败面仍以段级报告为准)。
 * 返回 { results, hung };results 每项 = { file, ok, ms, error?, timedOut?,
 * cases?, failureDir? }。
 * @param {string[]} dirs 段目录(按此顺序发现)
 * @param {{ segmentTimeoutMs?: number, isolate?: boolean }} [options]
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(options.segmentTimeoutMs ?? 0);
  const isolate = resolveIsolation(options);
  const execute = isolate
    ? (/** @type {{dir: string, file: string, name: string}} */ s) => runSegmentIsolated(s, timeout)
    : runSegmentWithWatchdog;
  const segments = await discoverSegments(dirs);
  const results = [];
  let hung = false;
  for (const s of segments) {
    const r = await execute(s);
    // 段 run() 回传的 case 结果优先;未回传则取本段登记的 suite(防漏回传被静默判过;
    // 隔离模型下宿主已在子进程内做完同一收集,此处 drain 只在同进程回退模型生效)
    const outcome = collectSegmentOutcome(r.ret);
    const error = r.error ?? segmentOutcomeError(outcome);
    const entry = {
      file: s.name,
      ok: !error,
      ms: r.ms,
      ...(error ? { error } : {}),
      ...(r.timedOut === undefined ? {} : { timedOut: r.timedOut }),
      ...(outcome.cases.length > 0 ? { cases: outcome.cases } : {}),
    };
    if (!entry.ok) {
      try {
        const { dir } = await saveFailureArtifacts(s.name, {
          log: buildFailureLog({ ...entry, cases: outcome.cases }),
          buffers: outcome.artifacts,
        });
        entry.failureDir = repoRelative(dir);
      } catch (err) {
        // 落盘失败不掩盖段级失败面:告警留痕,退出码仍由段结果决定
        console.warn(`[warn] 失败产物落盘失败(${s.name}): ${err instanceof Error ? err.message : err}`);
      }
      // hung 只在同进程回退模型成立:隔离模型下超时段已被父进程硬杀,无残留悬挂段
      if (r.timedOut && !isolate) hung = true;
    }
    results.push(entry);
  }
  return { results, hung };
}
