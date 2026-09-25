/**
 * 测试段执行框架:
 * - 段文件 = test/segments/、test/main/ 或 test/renderer/ 下 *.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口按目录顺序自动发现)
 * - 单段筛选:设 M2W_ONLY=basic-render,mermaid 可只跑名称含任一子串的段
 *   (逗号分隔多个子串,大小写不敏感,匹配段名如 segments/basic-render.test.js;
 *   不设该变量时行为与全量运行完全一致)
 * - case 级契约(可选):段内用 test/common/case.js 的 createCaseSuite 登记具名 case,
 *   run() 返回 `{ cases }` 即可;runner 聚合后由入口打印 case 级报告。段内 case 失败
 *   同样把整段判失败(错误聚合为一条 Error),未接入的旧段行为不变(抛错即段失败)。
 * - 失败产物:失败段统一落盘 output/artifacts/failures/<段名>/(失败日志 + 该段登记的
 *   buffer 快照),见 artifacts.saveFailureArtifacts。
 *
 * 已知局限(勿误读为已隔离):段与 runner 同进程(Electron 环境),看门狗只能标记超时段,
 * 无法安全终止悬挂段的 promise;超时段记失败后继续放行后续段(一次看全失败面),
 * 悬挂段及其持有的 BrowserWindow 等资源由入口在结果打印完毕后 `app.exit` 硬退出释放。
 * 逐段独立子进程 + 硬超时 + 资源回收尚未实现,不得据本注释认为隔离已完成;
 * 正式口径见 `docs/OPTIMIZATION-PLAN.md` D-08。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { saveFailureArtifacts } from "./artifacts.js";
import { drainSuites } from "./case.js";
import { repoRelative } from "./paths.js";

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

/**
 * 单段执行(可选看门狗):
 * - 超时 → 该段标记失败,继续放行后续段(一次看全失败面),置 timedOut 标志。
 * - 已知局限:悬挂段与 runner 同进程,无法终止其 promise;超时后悬挂段仍后台残留,
 *   由 runAll 跑完全部段、入口打印结果后硬退出统一释放其资源(见文件头注释)。
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
 * case 级失败聚合为一条 Error:段内 case 不抛,段级失败由这里归一(栈替换为 case 明细,
 * 避免报告里出现 runner 内部帧淹没真实失败点)。
 * @param {{name: string, ok: boolean, ms: number, group?: string, message?: string}[]} cases
 * @returns {Error}
 */
function caseFailureError(cases) {
  const failed = cases.filter((c) => !c.ok);
  const detail = failed
    .map((c) => `  - ${c.group ? `${c.group} › ` : ""}${c.name}: ${c.message ?? "未知失败"}`)
    .join("\n");
  const error = new Error(`${failed.length}/${cases.length} 个 case 失败:\n${detail}`);
  error.stack = error.message;
  return error;
}

/**
 * 失败日志正文:段名/耗时/超时标记 + case 明细(含失败消息、栈、附件引用)+ 段级错误。
 * @param {{file: string, ms: number, timedOut?: boolean, cases?: unknown[], error?: unknown}} r 段结果
 * @returns {string}
 */
function buildFailureLog(r) {
  const lines = [
    `段: ${r.file}`,
    `结果: 失败${r.timedOut ? "(看门狗超时,以下 case 为超时前已完成的进度)" : ""}`,
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
 * 顺序执行全部测试段(目录顺序 + 目录内文件名排序),返回逐段结果。
 * options.segmentTimeoutMs:单段看门狗超时(ms),由入口(acceptance.mjs)从环境变量
 * M2W_ACCEPTANCE_SEGMENT_TIMEOUT_MS 读入并传入;0 或 NaN 等无效值 = 不启用(默认行为不变)。
 * 某段看门狗超时 → 记为失败且**继续执行后续段**(一次看全失败面);
 * 返回值 hung=true 提示入口:存在未终止的悬挂段,结果打印完毕须硬退出释放资源
 * (悬挂段无法在同进程内被终止,详见文件头局限说明)。
 * 失败段额外:落盘失败产物(failureDir = output/artifacts/failures/<段名>/);
 * 落盘失败只告警不中断(降级留痕,失败面仍以段级报告为准)。
 * 返回 { results, hung };results 每项 = { file, ok, ms, error?, timedOut?,
 * cases?, failureDir? }。
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(options.segmentTimeoutMs ?? 0);
  const segments = await discoverSegments(dirs);
  const results = [];
  let hung = false;
  for (const s of segments) {
    const r = await runSegmentWithWatchdog(s, timeout);
    // 段 run() 回传的 case 结果优先;未回传则取本段登记的 suite(防漏回传被静默判过)
    const collected = drainSuites();
    const ret = /** @type {{ cases?: unknown[], artifacts?: unknown[] } | undefined} */ (r.ret);
    const cases = Array.isArray(ret?.cases) ? ret.cases : collected.flatMap((h) => h.cases);
    const artifacts = Array.isArray(ret?.artifacts)
      ? ret.artifacts
      : collected.flatMap((h) => h.snapshots);
    const caseFailed = cases.some((c) => !c.ok);
    const error = r.error ?? (caseFailed ? caseFailureError(cases) : undefined);
    const entry = {
      file: s.name,
      ok: !error,
      ms: r.ms,
      ...(error ? { error } : {}),
      ...(r.timedOut === undefined ? {} : { timedOut: r.timedOut }),
      ...(cases.length > 0 ? { cases } : {}),
    };
    if (!entry.ok) {
      try {
        const { dir } = await saveFailureArtifacts(s.name, {
          log: buildFailureLog({ ...entry, cases }),
          buffers: artifacts,
        });
        entry.failureDir = repoRelative(dir);
      } catch (err) {
        // 落盘失败不掩盖段级失败面:告警留痕,退出码仍由段结果决定
        console.warn(`[warn] 失败产物落盘失败(${s.name}): ${err instanceof Error ? err.message : err}`);
      }
      if (r.timedOut) hung = true;
    }
    results.push(entry);
  }
  return { results, hung };
}
