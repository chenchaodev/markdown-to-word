/**
 * 测试段执行框架:
 * - 段文件 = test/segments/ 或 test/main/ 下 *.test.js,须导出 async function run()
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
 * - 超时 → 该段标记失败并置 aborted 标志,由 runAll 停止后续段、入口打印结果后硬退出。
 * - 已知局限(务实取舍):段与 runner 同进程(Electron 环境),无法安全终止单个悬挂段
 *   的 promise;不做每段子进程隔离——段依赖 Electron 运行时,逐段拉起 electron 进程
 *   成本高且引入 IPC/生命周期脆弱机制。因此超时后放弃「放行下一段」语义,改为快速失败 +
 *   全局硬退出(app.exit),由进程退出确定性释放悬挂段持有的 BrowserWindow 等资源。
 * 返回 { ok, ms, error? },不含 file(由 runAll 补齐)
 */
async function runSegmentWithWatchdog(s, timeout) {
  const start = Date.now();
  const segmentPromise = runSegment(pathToFileURL(path.join(s.dir, s.file)).href);
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`测试段超时(${timeout}ms): ${s.name}(已中止后续段,进程将硬退出以释放悬挂资源)`)),
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
 * 某段看门狗超时 → 记为失败并停止后续段;返回值 aborted=true 提示入口须硬退出
 * (悬挂段无法在同进程内被终止,详见 runSegmentWithWatchdog 注释)。
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(options.segmentTimeoutMs ?? 0);
  const watchdogEnabled = timeout > 0 && Number.isFinite(timeout);
  const segments = await discoverSegments(dirs);
  const results = [];
  let aborted = false;
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
        // 超时段可能仍持有窗口/句柄且继续后台跑 → 不放行下一段,交入口硬退出
        aborted = true;
        break;
      }
    }
  }
  return { results, aborted };
}
