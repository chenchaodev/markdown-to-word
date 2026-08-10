/**
 * 测试段执行框架:
 * - 段文件 = test/segments/*.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口自动发现)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 发现并排序 segments 目录下全部测试段文件 */
export async function discoverSegments(dir) {
  const entries = await fs.readdir(dir);
  return entries.filter((f) => f.endsWith(".test.js")).sort();
}

/** 加载并执行单个测试段(段内断言失败应 throw,由调用方汇总) */
export async function runSegment(fileUrl) {
  const mod = await import(fileUrl);
  if (typeof mod.run !== "function") {
    throw new Error("测试段缺少 run() 导出");
  }
  await mod.run();
}

/** 顺序执行全部测试段,返回逐段结果 */
export async function runAll(segmentsDir) {
  const files = await discoverSegments(segmentsDir);
  const results = [];
  for (const f of files) {
    const start = Date.now();
    try {
      await runSegment(pathToFileURL(path.join(segmentsDir, f)).href);
      results.push({ file: f, ok: true, ms: Date.now() - start });
    } catch (err) {
      results.push({ file: f, ok: false, ms: Date.now() - start, error: err });
    }
  }
  return results;
}
