/**
 * 验收测试入口(父进程/编排器):自动发现并顺序执行 segments/(core 渲染)、
 * main/(主进程层)与 renderer/(UI 层)下的 *.test.js。段 = 一个内容主题的断言;
 * 新增测试 = 按被测代码所在层新建 xxx.test.js 并导出 async function run(),零注册
 * (入口自动发现)。
 *
 * 目录组织标准(test 树镜像 src 三层 + 跨域例外,按序判断新测试归属):
 * 1. segments/ = src/core 渲染能力的一个内容主题一段;跨层契约/恒等守护段
 *    (无单一归属层,如 identity-guards、i18n-registry)亦住此处;
 * 2. main/ = 被测主体为 src/main 的主题段(含零 Electron API 的纯逻辑直测);
 * 3. renderer/ = 被测主体为 src/renderer 的主题段(纯函数/状态机/CSS 令牌恒等)。
 *
 * 执行模型(D-08 正式口径):**每段一个独立 Electron 子进程**(宿主 test/common/
 * segment-host.mjs,编排见 test/common/runner.js),段内崩溃/悬挂/超时只终结该段,
 * 父进程跑完全部段后汇总;每段独立 userData 目录,退出即清理(见 test/common/userdata.js)。
 * 设 M2W_ACCEPTANCE_INPROC=1 可切回旧的同进程顺序 + 看门狗模型(仅供二分定位)。
 *
 * 单段筛选(开发迭代提速):设环境变量 M2W_ONLY=子串[,子串...] 只跑段名
 * 含任一子串的段(大小写不敏感,如 M2W_ONLY=basic-render 或 M2W_ONLY=mermaid,pdf-meta);
 * 不设 = 全量运行,行为不变。筛选在父进程做,子进程只跑被选中的段。
 *
 * 报告两级:段级(下方 [ok]/[fail] 行 + 总览)对全部段;case 级(段内接入
 * test/common/case.js 的具名 case,run() 返回 { cases })额外打印「段名 › case 名:
 * 消息」明细与通过数,失败段的日志与产物快照见 output/artifacts/failures/<段名>/。
 *
 * 用法: npm run test(需已 build;等价 npx electron test/acceptance.mjs)
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatCaseReport, resolveIsolation, runAll, summarizeCases } from "./common/runner.js";
import { createTempUserData, redirectUserData, removeTempUserData } from "./common/userdata.js";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const segmentsDir = path.join(testRoot, "segments");
const mainDir = path.join(testRoot, "main");
const rendererDir = path.join(testRoot, "renderer");

// 父进程自身也隔离 userData(它不跑段代码,仅编排;同进程回退模型下段会用到):
// whenReady 前重定向到一次性临时目录,防止验收测试读写真实 %APPDATA% 下的用户数据。
const tempUserData = redirectUserData(app, createTempUserData("m2w-acceptance-"));

function printStats(results, totalStart) {
  const totalSeconds = ((Date.now() - totalStart) / 1000).toFixed(1);
  const slowest = [...results]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((r) => `${r.file} (${r.ms}ms)`)
    .join(", ");
  console.log(`[stats] 总耗时 ${totalSeconds}s | 最慢段: ${slowest}`);
}

/** 退出前冲干净 stdout/stderr:app.exit 立即终止进程,管道场景下未落盘输出会被截断 */
async function flushOutput() {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.writableLength > 0) await new Promise((resolve) => stream.write("", resolve));
  }
}

// 同进程回退模型下段会自持窗口(所有窗口关闭即退出,会在 printToPDF 窗口 destroy 后
// 中断后续写盘);显式挂空监听保持进程存活,由末尾 app.quit() 收尾。
// 隔离模型下本进程不跑段代码、不建窗口,此监听无副作用(回退路径仍依赖它)。
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  const totalStart = Date.now();
  if (!resolveIsolation()) {
    console.warn("[warn] M2W_ACCEPTANCE_INPROC 已启用:回退到同进程顺序 + 看门狗模型(不隔离,仅供二分定位)");
  }
  const { results, hung } = await runAll([segmentsDir, mainDir, rendererDir], {
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
  // case 级摘要(仅段内接入 case 契约的段有内容;无 case 契约的旧段输出完全不变)
  const caseReport = formatCaseReport(results);
  if (caseReport) {
    if (summarizeCases(results).failed > 0) {
      console.error(caseReport);
    } else {
      console.log(caseReport);
    }
  }
  printStats(results, totalStart);
  // hung 只可能出现在同进程回退模型(看门狗 race 后无法终止悬挂段);
  // 隔离模型下超时段已被父进程硬杀,走下方常规失败分支
  if (hung) {
    console.error("[fail] 存在超时段(该段记失败,后续段已照常执行);结果打印完毕,进程硬退出以释放悬挂资源");
    await flushOutput();
    removeTempUserData(tempUserData);
    app.exit(1);
    return;
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`[fail] ${failed.length}/${results.length} 段失败`);
    await flushOutput();
    removeTempUserData(tempUserData);
    app.exit(1);
    return;
  }
  console.log(`[ok] 全部 ${results.length} 段通过`);
  removeTempUserData(tempUserData);
  app.quit();
});
