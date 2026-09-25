/**
 * 测试段执行框架:
 * - 段文件 = test/segments/、test/main/ 或 test/renderer/ 下 *.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口按目录顺序自动发现)
 * - 单段筛选:设 M2W_ONLY=basic-render,mermaid 可只跑名称含任一子串的段
 *   (逗号分隔多个子串,大小写不敏感,匹配段名如 segments/basic-render.test.js;
 *   不设该变量时行为与全量运行完全一致)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/** 加载并执行单个测试段(段内断言失败应 throw,由调用方汇总) */
export async function runSegment(fileUrl) {
  const mod = await import(fileUrl);
  if (typeof mod.run !== "function") {
    throw new Error("测试段缺少 run() 导出");
  }
  await mod.run();
}

/**
 * 单段执行 + 看门狗竞速(仅在看门狗启用时调用):
 * - 超时 → 该段标记失败,继续放行后续段(一次看全失败面,E3 试点),置 hung 标志。
 * - 已知局限(临时取舍,非终态):段与 runner 同进程(Electron 环境),无法安全终止单个
 *   悬挂段的 promise。故超时后悬挂段仍后台残留,由 runAll 跑完全部段、入口打印结果后
 *   硬退出(app.exit)统一释放其持有的 BrowserWindow 等资源;残留段与后续段的隔离
 *   亦不做。
 *   ⚠️ 口径变更(2026-09-25,`docs/OPTIMIZATION-PLAN.md` D-08「测试段逐子进程隔离」):
 *   正式口径 = 每段独立子进程 + 硬超时 + 资源回收 + case 级报告 + 失败 artifact,
 *   **排优化计划阶段 5,当前尚未实现**;本文件仍为同进程 + 看门狗,不得据本注释认为
 *   隔离已完成。原「不做每段子进程隔离」的结论已被该裁决 supersede,历史留痕见
 *   `docs/BACKLOG.md`「看门狗悬挂段隔离」行(处置 = 已被裁决取代)与「维持人工·已知限制」。
 * 返回 { ok, ms, error?, timedOut? },不含 file(由 runAll 补齐)
 */
async function runSegmentWithWatchdog(s, timeout) {
  const start = Date.now();
  const segmentPromise = runSegment(pathToFileURL(path.join(s.dir, s.file)).href);
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`测试段超时(${timeout}ms): ${s.name}(该段记失败,后续段继续执行,进程收尾硬退出释放悬挂资源)`)),
      timeout,
    );
  });
  try {
    await Promise.race([segmentPromise, watchdog]);
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err, timedOut: err.message.includes("测试段超时") };
  } finally {
    clearTimeout(timer);
    // 输家 promise 挂空 catch,防迟到的 unhandledRejection(悬挂段随进程硬退出终结)
    segmentPromise.catch(() => {});
    watchdog.catch(() => {});
  }
}

/**
 * 顺序执行全部测试段(目录顺序 + 目录内文件名排序),返回逐段结果。
 * options.segmentTimeoutMs:单段看门狗超时(ms),由入口(acceptance.mjs)从环境变量
 * M2W_ACCEPTANCE_SEGMENT_TIMEOUT_MS 读入并传入;0 或 NaN 等无效值 = 不启用(默认行为不变)。
 * 某段看门狗超时 → 记为失败且**继续执行后续段**(一次看全失败面,E3 试点);
 * 返回值 hung=true 提示入口:存在未终止的悬挂段,结果打印完毕须硬退出释放资源
 * (悬挂段无法在同进程内被终止,详见 runSegmentWithWatchdog 注释)。
 * 逐段子进程隔离为 D-08 正式口径但**阶段 5 待实现**,本文件现状 = 同进程 + 看门狗。
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(options.segmentTimeoutMs ?? 0);
  const watchdogEnabled = timeout > 0 && Number.isFinite(timeout);
  const segments = await discoverSegments(dirs);
  const results = [];
  let hung = false;
  for (const s of segments) {
    if (!watchdogEnabled) {
      const start = Date.now();
      try {
        await runSegment(pathToFileURL(path.join(s.dir, s.file)).href);
        results.push({ file: s.name, ok: true, ms: Date.now() - start });
      } catch (err) {
        results.push({ file: s.name, ok: false, ms: Date.now() - start, error: err });
      }
    } else {
      const r = await runSegmentWithWatchdog(s, timeout);
      results.push({ file: s.name, ...r });
      if (r.timedOut) {
        // 超时段未终止仍后台残留 → 记录失败后照常放行后续段(E3 试点「不中止后续」),
        // 悬挂资源由入口在结果打印完毕后硬退出统一释放
        hung = true;
      }
    }
  }
  return { results, hung };
}
