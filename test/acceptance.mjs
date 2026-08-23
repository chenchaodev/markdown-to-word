/**
 * 验收测试入口:自动发现并顺序执行 segments/(core 渲染)与 main/(主进程层)
 * 下的 *.test.js。段 = 一个内容主题的断言;新增测试 = 在 segments/ 或 main/
 * 新建 xxx.test.js 并导出 async function run(),零注册(入口自动发现)。
 * 用法: npm run test(需已 build;等价 npx electron test/acceptance.mjs)
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./common/runner.js";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const segmentsDir = path.join(testRoot, "segments");
const mainDir = path.join(testRoot, "main");

// userData 隔离:whenReady 前重定向到一次性临时目录,
// 防止验收测试读写真实 %APPDATA% 下的用户数据。
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-acceptance-"));
app.setPath("userData", tempUserData);

/** 打印总耗时与按耗时降序的最慢 5 段排行 */
function printStats(results, totalStart) {
  const totalSeconds = ((Date.now() - totalStart) / 1000).toFixed(1);
  const slowest = [...results]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((r) => `${r.file} (${r.ms}ms)`)
    .join(", ");
  console.log(`[stats] 总耗时 ${totalSeconds}s | 最慢段: ${slowest}`);
}

/** 收尾清理临时 userData 目录;清理失败静默忽略,不影响退出流程 */
function cleanupTempUserData() {
  try {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  } catch {
    /* 清理失败静默忽略 */
  }
}

// 默认行为:所有窗口关闭即退出(在 printToPDF 窗口 destroy 后,
// 后续写盘代码会中断);显式挂空监听保持进程存活,由末尾 app.quit() 收尾。
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  const totalStart = Date.now();
  const results = await runAll([segmentsDir, mainDir], {
    segmentTimeoutMs: Number(
      process.env.M2W_ACCEPTANCE_SEGMENT_TIMEOUT_MS ?? 180000,
    ),
  });
  for (const r of results) {
    if (r.ok) {
      console.log(`[ok] ${r.file} (${r.ms}ms)`);
    } else {
      console.error(`[fail] ${r.file}: ${r.error.stack ?? r.error}`);
    }
  }
  printStats(results, totalStart);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`[fail] ${failed.length}/${results.length} 段失败`);
    cleanupTempUserData();
    app.exit(1);
    return;
  }
  console.log(`[ok] 全部 ${results.length} 段通过`);
  cleanupTempUserData();
  app.quit();
});
