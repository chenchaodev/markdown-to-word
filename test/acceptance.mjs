// @ts-check
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
 * 执行模型(ADR-015 正式口径):**每段一个独立 Electron 子进程**(宿主 test/common/
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
 *
 * 失败路径:走 test/common/entry-guard.mjs 的统一守卫 —— 编排阶段抛错时打印阶段标签 +
 * 原始堆栈并以非零码退出。旧实现是 `app.whenReady().then(async () => {...})` 且回调不带
 * catch:回调内抛错只产生 UnhandledPromiseRejectionWarning(Electron 主进程把未处理拒绝
 * 降级为 warn),进程继续活着 → 挂到 CI job 级超时,报出来的是「超时」而不是「验收失败」。
 * userData 重定向必须在 app ready **之前**完成,故它留在模块顶层(静态导入 userdata.js);
 * runner.js 走 load 阶段的动态 import,其加载失败可被捕获并带阶段标签。
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEntry } from "./common/entry-guard.mjs";
import { createTempUserData, redirectUserData, removeTempUserData } from "./common/userdata.js";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const segmentsDir = path.join(testRoot, "segments");
const mainDir = path.join(testRoot, "main");
const rendererDir = path.join(testRoot, "renderer");

/** 入口标识(诊断首行 `[entry:...]` 用) */
const ENTRY = "acceptance";

// 父进程自身也隔离 userData(它不跑段代码,仅编排;同进程回退模型下段会用到):
// whenReady 前重定向到一次性临时目录,防止验收测试读写真实 %APPDATA% 下的用户数据。
const tempUserData = redirectUserData(app, createTempUserData("m2w-acceptance-"));

/**
 * 打印总耗时与最慢的 5 段(段结果形状单一来源在 test/common/runner.js)。
 * @param {import("./common/runner.js").SegmentResultEntry[]} results 段结果
 * @param {number} totalStart 全量开始的 Date.now() 时刻
 */
function printStats(results, totalStart) {
  const totalSeconds = ((Date.now() - totalStart) / 1000).toFixed(1);
  const slowest = [...results]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((r) => `${r.file} (${r.ms}ms)`)
    .join(", ");
  console.log(`[stats] 总耗时 ${totalSeconds}s | 最慢段: ${slowest}`);
}

// 同进程回退模型下段会自持窗口(所有窗口关闭即退出,会在 printToPDF 窗口 destroy 后
// 中断后续写盘);显式挂空监听保持进程存活,由壳层的显式 app.exit(退出码)收尾。
// 隔离模型下本进程不跑段代码、不建窗口,此监听无副作用(回退路径仍依赖它)。
app.on("window-all-closed", () => {});

/**
 * 载荷加载阶段:编排器(runner.js)走动态 import,加载失败带「模块加载期」标签非零退出。
 * @returns {Promise<typeof import("./common/runner.js")>} runner 模块命名空间
 */
async function loadPayload() {
  return import("./common/runner.js");
}

/**
 * 入口执行期(app ready 回调体):跑完全部段 → 打印段级/case 级报告 → 给出退出码。
 * 退出码与冲刷由壳层统一收口,本函数只负责判定与收尾清理。
 * @param {typeof import("./common/runner.js")} runner runner 模块
 * @returns {Promise<number>} 退出码(0 全绿 / 1 有段失败或超时段)
 */
async function work(runner) {
  const { formatCaseReport, resolveIsolation, runAll, summarizeCases } = runner;
  await app.whenReady();
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
      // 段级错误按「Error → stack(缺则 toString)/非 Error → String」归一为可打印文案
      const err = r.error;
      const detail = err instanceof Error ? (err.stack ?? String(err)) : String(err);
      console.error(`[fail] ${r.file}: ${detail}`);
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
    removeTempUserData(tempUserData);
    return 1;
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`[fail] ${failed.length}/${results.length} 段失败`);
    removeTempUserData(tempUserData);
    return 1;
  }
  console.log(`[ok] 全部 ${results.length} 段通过`);
  removeTempUserData(tempUserData);
  return 0;
}

void runEntry({ entry: ENTRY, load: loadPayload, work });
