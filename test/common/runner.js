/**
 * 测试段执行框架:
 * - 段文件 = test/segments/ 或 test/main/ 下 *.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口按目录顺序自动发现)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 按传入目录顺序发现全部测试段文件(目录内按文件名排序);
 * 返回 { dir, file, name },name 带目录前缀(如 segments/basic-render.test.js),
 * 避免跨目录重名混淆,也便于阅读
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
  return found;
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
 * - 看门狗只把超时段标记为失败以放行下一段,不终止悬挂段
 *   (段 promise 继续在后台运行,迟到的 rejection 由空 catch 吸收)
 * 返回 { ok, ms, error? },不含 file(由 runAll 补齐)
 */
async function runSegmentWithWatchdog(s, timeout) {
  const start = Date.now();
  const segmentPromise = runSegment(pathToFileURL(path.join(s.dir, s.file)).href);
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`测试段超时(${timeout}ms): ${s.name}`)),
      timeout,
    );
  });
  try {
    await Promise.race([segmentPromise, watchdog]);
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err };
  } finally {
    clearTimeout(timer);
    // 输家 promise 挂空 catch,防迟到的 unhandledRejection
    segmentPromise.catch(() => {});
    watchdog.catch(() => {});
  }
}

/**
 * 顺序执行全部测试段(目录顺序 + 目录内文件名排序),返回逐段结果。
 * options.segmentTimeoutMs:单段看门狗超时(ms),缺省回退环境变量
 * M2W_SEGMENT_TIMEOUT_MS;0 或 NaN 等无效值 = 不启用(默认行为不变)。
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(
    options.segmentTimeoutMs ?? process.env.M2W_SEGMENT_TIMEOUT_MS ?? 0,
  );
  const watchdogEnabled = timeout > 0 && Number.isFinite(timeout);
  const segments = await discoverSegments(dirs);
  const results = [];
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
      results.push({ file: s.name, ...(await runSegmentWithWatchdog(s, timeout)) });
    }
  }
  return results;
}
