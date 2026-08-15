/**
 * 验收测试入口:自动发现并顺序执行 segments/(core 渲染)与 main/(主进程层)
 * 下的 *.test.js。段 = 一个内容主题的断言;新增测试 = 在 segments/ 或 main/
 * 新建 xxx.test.js 并导出 async function run(),零注册(入口自动发现)。
 * 用法: npm run test(需已 build;等价 npx electron test/acceptance.mjs)
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./common/runner.js";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const segmentsDir = path.join(testRoot, "segments");
const mainDir = path.join(testRoot, "main");

// 默认行为:所有窗口关闭即退出(在 printToPDF 窗口 destroy 后,
// 后续写盘代码会中断);显式挂空监听保持进程存活,由末尾 app.quit() 收尾。
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  const results = await runAll([segmentsDir, mainDir]);
  for (const r of results) {
    if (r.ok) {
      console.log(`[ok] ${r.file} (${r.ms}ms)`);
    } else {
      console.error(`[fail] ${r.file}: ${r.error.stack ?? r.error}`);
    }
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`[fail] ${failed.length}/${results.length} 段失败`);
    app.exit(1);
    return;
  }
  console.log(`[ok] 全部 ${results.length} 段通过`);
  app.quit();
});
