// @ts-check
/**
 * runner 自测段(被测 = 测试框架自身:执行模型 + case 级报告 + 失败 artifact):
 * 在 output/tmp/ 下临时写出真实段文件跑 runAll(隔离模型七段/回退模型三段),覆盖两组契约。
 *
 * 一、逐段子进程隔离(默认模型,每段一个独立 Electron 子进程):
 * 1. case 级结果:段内 createCaseSuite 登记的 case(含 describe 分组、耗时、失败消息、
 *    附件引用)经子进程结构化回传后由 runner 聚合进段结果,并把整段判失败(错误聚合为一条);
 * 2. 失败产物:失败段在 output/artifacts/failures/<段名>/ 落下 failure.log(含段名、
 *    case 名、失败消息)与该段 attach 登记的 buffer 快照;成功段不产该目录;
 * 3. 报告正文:失败 case 行含「段名 › case 名: 消息」+ 通过数 + 合计,无 case 契约的
 *    段不产生 case 行(formatCaseReport 返回空串);
 * 4. 旧段兼容:未接入 case 契约的段抛错仍记段级失败(error.stack 原样、结果无 cases 键);
 * 5. 崩溃/悬挂隔离:硬崩段(未回传即退出)与悬挂段(永不 settle)只终结自身,
 *    其后的段照常执行,整轮不产出 hung(超时后父进程真杀进程树,无残留悬挂段);
 * 6. 超时前进度:悬挂段超时前进度已结算的 case 经回传保留在失败日志/段结果里;
 * 7. 段间状态隔离 + userData:每段独立 userData 目录(互不可见),且前一段目录在其
 *    子进程退出后即被删除;模块/全局状态不跨段;
 * 8. M2W_ONLY 生效:筛选在父进程完成,子进程只跑被选中的段;
 * 9. 回退开关:isolate:false(M2W_ACCEPTANCE_INPROC 同款)切回同进程模型,判定与产物不变。
 * 10. 选择面与发现面互不渗透(段内自跑的根因修复):顶层筛选词(M2W_ONLY)只决定
 *     「harness 这一轮跑哪些顶层段」;本段作为顶层段被 M2W_ONLY 单段筛选跑时(隔离
 *     模型下的常规调试姿势),段内自跑仍须发现并执行全部沙盒段 —— 即无论外层是否设过
 *     筛选词,`discoverSegments([SANDBOX], { only: null })` 都返回全部沙盒段、显式
 *     `only` 仍精确筛选、且段子进程 env 里不再带顶层筛选词。
 *
 * 模型自适应:同进程回退模型下不造崩溃/悬挂/状态隔离夹具(崩溃夹具的 process.exit 会
 * 带走整轮验收,悬挂夹具在同进程内无法被终止),只跑与模型无关的 case 契约/旧段/筛选断言。
 *
 * 沙盒纪律:临时段文件与本段造出的失败目录在 finally 整体删除,不残留;断言不依赖
 * test/common/case.js 的 assert(被测件自身出错时不能用被测件判红),一律直接 throw。
 */
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR, ROOT, repoRelative, segmentFailureDir } from "../common/paths.js";
import { discoverSegments, formatCaseReport, resolveIsolation, runAll, summarizeCases } from "../common/runner.js";

/** 临时段文件沙盒(仓库 output/ 下,gitignore 覆盖;不落 test/,免被 typecheck/lint 扫入) */
const SANDBOX = path.join(ROOT, "output", "tmp", "runner-report-selftest");

/** 沙盒段 → 仓库内 case 契约模块的相对路径(output/tmp/<沙盒>/ → test/common/) */
const CASE_MODULE = "../../../test/common/case.js";

const FAIL_SEG = "runner-report-selftest/cases-fail.test.js";
const PASS_SEG = "runner-report-selftest/cases-pass.test.js";
const CRASH_SEG = "runner-report-selftest/crash.test.js";
const HANG_SEG = "runner-report-selftest/hang.test.js";
const LEGACY_SEG = "runner-report-selftest/legacy-fail.test.js";
const STATE_A_SEG = "runner-report-selftest/state-a.test.js";
const STATE_B_SEG = "runner-report-selftest/state-b.test.js";
/** 目录内文件名排序 = 执行顺序(cases-pass 之后才是 crash/hang,其后才是 legacy 与 state-*) */
const ALL_SEGS = [FAIL_SEG, PASS_SEG, CRASH_SEG, HANG_SEG, LEGACY_SEG, STATE_A_SEG, STATE_B_SEG];
/** 同进程回退模型下只造的三段(无崩溃/悬挂/状态隔离夹具,见 setupSandbox) */
const BASE_SEGS = [FAIL_SEG, PASS_SEG, LEGACY_SEG];

/** 隔离自测的单段超时:悬挂段要真被杀掉,其余段(仅导入+几行断言)须远快于此 */
const ISOLATED_TIMEOUT_MS = 8000;
/** 同进程回退模型的自测超时(只跑三段无悬挂的段;留余量防机器慢时误判) */
const INPROC_TIMEOUT_MS = 5000;

const SNAPSHOT_BYTES = "M2W-FAILURE-SNAPSHOT-BYTES";
/** 沙盒内记录各段 userData 目录的文件名(段间隔离证据,由段自己写) */
const A_USERDATA_FILE = "state-a-userdata.txt";
const B_USERDATA_FILE = "state-b-userdata.txt";

/**
 * 段结果项(runAll 汇总项的类型;契约单源在 test/common/runner.js,此处按签名派生)。
 * @typedef {Awaited<ReturnType<typeof runAll>>["results"][number]} SegmentResultEntry
 */

/**
 * 取段结果(缺失即失败:沙盒段清单与执行结果必须一一对应)。
 * @param {Map<string, SegmentResultEntry>} byFile 段结果索引
 * @param {string} name 段文件名
 * @returns {SegmentResultEntry} 该段结果
 */
function resultOf(byFile, name) {
  const entry = byFile.get(name);
  if (entry === undefined) fail(`未执行沙盒段 ${name}`);
  return entry;
}

/**
 * 取数组第 index 项(缺失即失败:用于 case 结果的下标访问收窄)。
 * @template T
 * @param {T[]} items 数组
 * @param {number} index 下标
 * @returns {T} 该项
 */
function at(items, index) {
  const item = items[index];
  if (item === undefined) fail(`缺少第 ${index} 项`);
  return item;
}

/**
 * 读段级错误的 stack(段错误声明为 unknown——回退模型下为段内抛出原值)。
 * @param {unknown} error 段级错误
 * @returns {string} stack 文本(无则空串)
 */
function errorStack(error) {
  return error !== null && typeof error === "object" && "stack" in error ? String(error.stack) : "";
}

/**
 * 读段级错误的 message(段错误声明为 unknown,按可读文本取用)。
 * @param {unknown} error 段级错误
 * @returns {string} message 文本(无则空串)
 */
function errorMessage(error) {
  return error !== null && typeof error === "object" && "message" in error ? String(error.message) : "";
}

/**
 * 写一个沙盒段文件。
 * @param {string} name 段文件名
 * @param {string} source 段源码
 * @returns {void}
 */
function writeSegment(name, source) {
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, name), source, "utf8");
}

/**
 * 删除一个沙盒文件。
 * @param {string} name 文件名
 * @returns {void}
 */
function removeSandboxFile(name) {
  fs.rmSync(path.join(SANDBOX, name), { force: true });
}

/**
 * 读产物目录条目(目录不存在 = 空)。
 * @param {string} dir 目录
 * @returns {string[]} 条目名
 */
function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 造沙盒段文件。isolating=false(同进程回退模型)时**不**造崩溃/悬挂/状态隔离三组夹具:
 * 那三组夹具靠"段跑在独立子进程"才安全(崩溃段的 process.exit 会带走整轮同进程验收,
 * 悬挂段在同进程内无法被终止),回退模型下跳过并说明,而不是让整轮被夹具带走。
 * @param {boolean} isolating 当前是否为逐段子进程隔离模型
 */
function setupSandbox(isolating) {
  // 失败段:分组内一个通过 case(登记 buffer 快照)+ 一个故意失败 case
  writeSegment(
    "cases-fail.test.js",
    [
      `import { assert, createCaseSuite } from "${CASE_MODULE}";`,
      "",
      "export async function run() {",
      "  const suite = createCaseSuite();",
      '  await suite.describe("自测分组", async () => {',
      '    await suite.case("第一个 case", () => {',
      '      assert(true, "通过 case 不应失败");',
      '      suite.attach("snapshot", { docx: Buffer.from("' + SNAPSHOT_BYTES + '") });',
      "    });",
      '    await suite.case("第二个 case", () => {',
      '      assert(1 === 2, "故意失败");',
      "    });",
      "  });",
      "  return { cases: suite.results };",
      "}",
      "",
    ].join("\n"),
  );
  // 成功段:全部 case 通过(attach 在 case 外,验证段级登记)
  writeSegment(
    "cases-pass.test.js",
    [
      `import { createCaseSuite } from "${CASE_MODULE}";`,
      "",
      "export async function run() {",
      "  const suite = createCaseSuite();",
      '  await suite.case("通过 case", () => {});',
      '  suite.attach("pass-snapshot", { docx: Buffer.from("PASS") });',
      "  return { cases: suite.results };",
      "}",
      "",
    ].join("\n"),
  );
  // 旧段:不接入 case 契约,直接抛错
  writeSegment(
    "legacy-fail.test.js",
    ["export async function run() {", '  throw new Error("legacy 段故意抛错");', "}", ""].join("\n"),
  );
  if (!isolating) return;
  // 崩溃段:不回传结果即硬退(模拟渲染进程崩溃/段内进程级异常,父进程无完整结果可采信)
  writeSegment(
    "crash.test.js",
    [
      "export async function run() {",
      '  console.log("[selftest] crash 段:硬退,模拟段崩溃");',
      "  process.exit(7);",
      "}",
      "",
    ].join("\n"),
  );
  // 悬挂段:先结算两个 case(验证超时前进度回传),再永不 settle
  writeSegment(
    "hang.test.js",
    [
      `import { createCaseSuite } from "${CASE_MODULE}";`,
      "",
      "export async function run() {",
      "  const suite = createCaseSuite();",
      '  await suite.case("超时前的 case 1", () => {});',
      '  await suite.case("超时前的 case 2", () => {});',
      '  console.log("[selftest] hang 段:进入永不 settle 的悬挂态");',
      "  await new Promise(() => {});",
      "}",
      "",
    ].join("\n"),
  );
  // 状态段 A:在 userData 与全局状态上留痕,供段 B 验证互不可见
  writeSegment(
    "state-a.test.js",
    [
      `import fs from "node:fs";`,
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { app } from "electron";`,
      "",
      "const sandbox = path.dirname(fileURLToPath(import.meta.url));",
      "export async function run() {",
      '  globalThis.__runnerSelftestMarker = "A";',
      '  const userData = app.getPath("userData");',
      '  fs.writeFileSync(path.join(sandbox, "' + A_USERDATA_FILE + '"), userData, "utf8");',
      '  fs.writeFileSync(path.join(userData, "a-marker.txt"), "A", "utf8");',
      "}",
      "",
    ].join("\n"),
  );
  // 状态段 B:断言前一段的痕迹一概不可见(全局状态 / 另一 userData 目录 / 未清理的目录)
  writeSegment(
    "state-b.test.js",
    [
      `import fs from "node:fs";`,
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { app } from "electron";`,
      "",
      "const sandbox = path.dirname(fileURLToPath(import.meta.url));",
      "export async function run() {",
      '  const userData = app.getPath("userData");',
      '  fs.writeFileSync(path.join(sandbox, "' + B_USERDATA_FILE + '"), userData, "utf8");',
      '  const fail = (m) => { throw new Error(m); };',
      '  if (globalThis.__runnerSelftestMarker !== undefined) fail("段间全局状态泄漏");',
      '  const aUserData = fs.readFileSync(path.join(sandbox, "' + A_USERDATA_FILE + '"), "utf8");',
      '  if (aUserData === userData) fail("两段共用同一 userData 目录");',
      '  if (fs.existsSync(aUserData)) fail("前一段 userData 目录未在其子进程退出后清理:" + aUserData);',
      '  if (fs.existsSync(path.join(userData, "a-marker.txt"))) fail("前一段 userData 内容串到本段");',
      "}",
      "",
    ].join("\n"),
  );
}

function cleanupSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  for (const name of ALL_SEGS) {
    fs.rmSync(segmentFailureDir(name), { recursive: true, force: true });
  }
}

/**
 * 临时设 M2W_ONLY 并在 finally 复原:一处入口服务两种用途 —— 断言「环境变量筛选确实生效」
 * (第 2/3 项),以及模拟「外层 harness 设了顶层筛选词」以验证段内发现面不受其影响(第 4 项)。
 * @template T
 * @param {string} only M2W_ONLY 取值
 * @param {() => Promise<T> | T} body 夹具主体
 * @returns {Promise<T>} body 的返回值
 */
async function withOnly(only, body) {
  const previous = process.env.M2W_ONLY;
  process.env.M2W_ONLY = only;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.M2W_ONLY;
    else process.env.M2W_ONLY = previous;
  }
}

/**
 * 断言失败出口(不依赖被测件的 assert,见文件头沙盒纪律)。
 * @param {string} message 失败说明
 * @returns {never} 恒抛错
 */
function fail(message) {
  throw new Error(`runner 自测:${message}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const artifactsBefore = readDirSafe(ARTIFACTS_DIR);
  // 隔离自检(崩溃/悬挂/段间状态)只有逐段子进程模型能安全夹具;同进程回退模型下
  // 崩溃夹具的 process.exit 会带走整轮验收、悬挂夹具无法被终止,故按模型裁剪断言面
  const isolating = resolveIsolation();
  setupSandbox(isolating);
  try {
    /* ---------- 1. 隔离模型(默认):崩溃/悬挂只终结自身,其余段照常 ---------- */
    // only: null = 本段显式声明「段内自跑不筛选」:顶层筛选词(外层 harness 的 M2W_ONLY)
    // 属选择面,不得渗进本段的发见面,否则本段在 M2W_ONLY 单段调试下必然滤空沙盒段
    const { results, hung } = await runAll([SANDBOX], {
      segmentTimeoutMs: isolating ? ISOLATED_TIMEOUT_MS : INPROC_TIMEOUT_MS,
      only: null,
    });
    const byFile = new Map(results.map((r) => [r.file, r]));
    const expected = isolating ? ALL_SEGS : BASE_SEGS;
    const shouldFail = isolating ? [FAIL_SEG, CRASH_SEG, HANG_SEG, LEGACY_SEG] : [FAIL_SEG, LEGACY_SEG];
    const shouldPass = isolating ? [PASS_SEG, STATE_A_SEG, STATE_B_SEG] : [PASS_SEG];
    if (isolating && hung) {
      fail("隔离模型下超时段已被硬杀,不应报 hung(否则父进程仍需硬退出释放悬挂资源)");
    }
    if (results.length !== expected.length) {
      fail(`应执行 ${expected.length} 个沙盒段,实际 ${results.length}`);
    }
    for (const name of expected) {
      if (!byFile.has(name)) fail(`未执行沙盒段 ${name}`);
    }
    for (const name of shouldFail) {
      if (resultOf(byFile, name).ok) fail(`${name} 应失败但判通过`);
    }
    for (const name of shouldPass) {
      const passed = resultOf(byFile, name);
      if (!passed.ok) {
        fail(`${name} 应通过,实际 ${errorStack(passed.error) || String(passed.error)}`);
      }
    }

    // ---- 1.1 崩溃/悬挂段之后的段确实跑完了(隔离的核心收益) ----
    if (isolating) {
      if (!resultOf(byFile, STATE_B_SEG).ok) {
        fail("崩溃段与悬挂段之后的段未跑完(隔离失效)");
      }
      const crashResult = resultOf(byFile, CRASH_SEG);
      if (!/异常退出/.test(errorMessage(crashResult.error)) || !/退出码 7/.test(errorMessage(crashResult.error))) {
        fail(`崩溃段应记为异常退出(退出码 7),实际 ${errorMessage(crashResult.error)}`);
      }
      const crashLog = fs.readFileSync(path.join(segmentFailureDir(CRASH_SEG), "failure.log"), "utf8");
      if (!crashLog.includes("异常退出")) {
        fail("崩溃段失败日志应含段级错误(异常退出)");
      }
      const hangResult = resultOf(byFile, HANG_SEG);
      if (hangResult.timedOut !== true) {
        fail(`悬挂段应标 timedOut,实际 ${JSON.stringify(hangResult.timedOut)}`);
      }
      if (!/测试段超时/.test(errorMessage(hangResult.error))) {
        fail(`悬挂段应记超时失败,实际 ${errorMessage(hangResult.error)}`);
      }
      if (!Array.isArray(hangResult.cases) || hangResult.cases.length !== 2) {
        fail(`悬挂段应回传超时前已完成的 2 条 case,实际 ${JSON.stringify(hangResult.cases)}`);
      }
      const hangLog = fs.readFileSync(path.join(segmentFailureDir(HANG_SEG), "failure.log"), "utf8");
      for (const needle of ["超时终止", "超时前的 case 1", "超时前的 case 2"]) {
        if (!hangLog.includes(needle)) fail(`悬挂段失败日志缺少「${needle}」`);
      }
    } else {
      console.log("[selftest] 同进程回退模型:跳过崩溃/悬挂/段间隔离夹具(只有隔离模型能安全夹具崩溃与悬挂)");
    }

    // ---- 1.2 case 级结果跨进程回传(失败段) ----
    const failResult = resultOf(byFile, FAIL_SEG);
    if (!Array.isArray(failResult.cases) || failResult.cases.length !== 2) {
      fail(`失败段应回传 2 条 case 结果,实际 ${failResult.cases?.length}`);
    }
    const failCases = failResult.cases;
    const first = at(failCases, 0);
    const second = at(failCases, 1);
    if (first.ok !== true || second.ok !== false) {
      fail("case 通过/失败标记不符(第一个应通过、第二个应失败)");
    }
    if (second.group !== "自测分组" || first.group !== "自测分组") {
      fail("case 结果应带 describe 分组名");
    }
    if (typeof first.ms !== "number" || first.ms < 0 || typeof second.ms !== "number") {
      fail("case 结果应带耗时(ms)");
    }
    if (second.message !== "故意失败") {
      fail(`失败 case 消息应原样上送,实际 ${second.message}`);
    }
    if (errorStack(failResult.error).includes("1/2 个 case 失败") !== true) {
      fail(`case 失败应聚合为段级错误,实际 ${errorStack(failResult.error)}`);
    }

    // ---- 1.3 失败产物落盘(失败日志 + buffer 快照,经子进程回传的 buffer) ----
    const failDir = segmentFailureDir(FAIL_SEG);
    const expectedFailDir = repoRelative(failDir);
    if (failResult.failureDir !== expectedFailDir) {
      fail(`失败段产物目录应为 ${expectedFailDir},实际 ${failResult.failureDir}`);
    }
    if (!fs.existsSync(path.join(failDir, "failure.log"))) {
      fail("失败段未落下 failure.log");
    }
    const log = fs.readFileSync(path.join(failDir, "failure.log"), "utf8");
    for (const needle of [FAIL_SEG, "第二个 case", "故意失败", "snapshot.docx"]) {
      if (!log.includes(needle)) {
        fail(`failure.log 缺少「${needle}」`);
      }
    }
    const snapshotFile = path.join(failDir, "snapshot.docx");
    if (fs.readFileSync(snapshotFile, "utf8") !== SNAPSHOT_BYTES) {
      fail("失败段 buffer 快照内容与 attach 登记的不一致(跨进程 base64 回传须无损)");
    }
    if (!first.attachments.includes("snapshot.docx")) {
      fail(`case 结果应带附件引用,实际 ${first.attachments}`);
    }

    // ---- 1.4 成功段不产失败目录 ----
    const passResult = resultOf(byFile, PASS_SEG);
    const passCases = passResult.cases;
    if (!Array.isArray(passCases) || passCases.length !== 1 || at(passCases, 0).ok !== true) {
      fail("成功段应回传 1 条通过 case");
    }
    if (passResult.failureDir !== undefined) {
      fail("成功段不应带 failureDir");
    }
    if (fs.existsSync(segmentFailureDir(PASS_SEG))) {
      fail("成功段不应产失败产物目录");
    }

    // ---- 1.5 旧段兼容(无 case 契约,抛错即段失败) ----
    const legacyResult = resultOf(byFile, LEGACY_SEG);
    if ("cases" in legacyResult) {
      fail("未接入 case 契约的旧段结果不应带 cases 键");
    }
    if (!errorStack(legacyResult.error).includes("legacy 段故意抛错")) {
      fail(`旧段错误应原样上送,实际 ${errorStack(legacyResult.error)}`);
    }
    const legacyLog = fs.readFileSync(path.join(segmentFailureDir(LEGACY_SEG), "failure.log"), "utf8");
    if (!legacyLog.includes("legacy 段故意抛错")) {
      fail("旧段失败日志应含段级错误");
    }

    // ---- 1.6 段间状态隔离 + userData 目录独立且退出即清理 ----
    if (isolating) {
      const aUserData = fs.readFileSync(path.join(SANDBOX, A_USERDATA_FILE), "utf8");
      const bUserData = fs.readFileSync(path.join(SANDBOX, B_USERDATA_FILE), "utf8");
      if (aUserData === bUserData) {
        fail("两段应拿到不同的 userData 目录");
      }
      for (const dir of [aUserData, bUserData]) {
        if (fs.existsSync(dir)) {
          fail(`段退出后其 userData 目录应被清理,仍存在: ${dir}`);
        }
      }
    }

    // ---- 1.7 报告正文与汇总 ----
    const report = formatCaseReport(results);
    for (const needle of [FAIL_SEG, "自测分组 › 第二个 case", "故意失败", expectedFailDir, "通过 / 1 失败", "1 通过 / 1 失败"]) {
      if (!report.includes(needle)) {
        fail(`case 报告缺少「${needle}」\n实际报告:\n${report}`);
      }
    }
    if (report.includes(LEGACY_SEG)) {
      fail("无 case 契约的段不应出现在 case 报告里");
    }
    if (formatCaseReport([resultOf(byFile, LEGACY_SEG)]) !== "") {
      fail("全部为旧段时 case 报告应为空串(旧段输出不变)");
    }
    const summary = summarizeCases(results);
    // 失败段 2 case(1 成 1 败)+ 成功段 1 case;隔离模型另有悬挂段的 2 条超时前进度
    const expectedSummary = isolating
      ? { segments: 3, passed: 4, failed: 1 }
      : { segments: 2, passed: 2, failed: 1 };
    if (
      summary.segments !== expectedSummary.segments ||
      summary.passed !== expectedSummary.passed ||
      summary.failed !== expectedSummary.failed
    ) {
      fail(`汇总应为 ${JSON.stringify(expectedSummary)},实际 ${JSON.stringify(summary)}`);
    }

    // ---- 1.8 失败轮次不写成功路径产物目录 ----
    const added = readDirSafe(ARTIFACTS_DIR).filter((e) => !artifactsBefore.includes(e));
    if (added.some((e) => e !== "failures" && e.startsWith("runner-report-selftest"))) {
      fail(`失败轮次在成功路径产物目录写入了 ${added.join(", ")}`);
    }

    /* ---------- 2. M2W_ONLY 生效(筛选在父进程;隔离模型下子进程只跑选中的段) ---------- */
    const onlyNeedle = isolating ? "state-b" : "cases-pass";
    const onlyExpected = isolating ? STATE_B_SEG : PASS_SEG;
    const filtered = await withOnly(onlyNeedle, () =>
      runAll([SANDBOX], { segmentTimeoutMs: isolating ? ISOLATED_TIMEOUT_MS : INPROC_TIMEOUT_MS }),
    );
    if (filtered.results.length !== 1 || at(filtered.results, 0).file !== onlyExpected) {
      fail(
        `M2W_ONLY=${onlyNeedle} 应只跑 ${onlyExpected},实际 ${filtered.results.map((r) => r.file).join(", ")}`,
      );
    }
    const onlyResult = at(filtered.results, 0);
    if (!onlyResult.ok) {
      fail(`M2W_ONLY 选中的段应正常执行,实际 ${errorStack(onlyResult.error)}`);
    }

    /* ---------- 3. 回退开关:同进程模型判定与产物不变(仅二分定位用) ---------- */
    const inproc = await withOnly("cases-,legacy-", () =>
      runAll([SANDBOX], { segmentTimeoutMs: INPROC_TIMEOUT_MS, isolate: false }),
    );
    const inprocByFile = new Map(inproc.results.map((r) => [r.file, r]));
    if (inproc.results.length !== 3) {
      fail(`同进程回退模型应执行 3 个沙盒段,实际 ${inproc.results.length}`);
    }
    for (const name of [FAIL_SEG, PASS_SEG, LEGACY_SEG]) {
      if (!inprocByFile.has(name)) fail(`同进程回退模型未执行 ${name}`);
    }
    if (resultOf(inprocByFile, PASS_SEG).ok !== true) {
      fail(`同进程回退模型 ${PASS_SEG} 应通过,实际 ${errorStack(resultOf(inprocByFile, PASS_SEG).error)}`);
    }
    if (resultOf(inprocByFile, FAIL_SEG).ok !== false || resultOf(inprocByFile, FAIL_SEG).cases?.length !== 2) {
      fail("同进程回退模型下 case 失败聚合与回传结果应不变");
    }
    if (errorStack(resultOf(inprocByFile, LEGACY_SEG).error).includes("legacy 段故意抛错") !== true) {
      fail("同进程回退模型下旧段错误应原样上送");
    }

    /* ---------- 4. 选择面与发现面互不渗透(本段被 M2W_ONLY 单段筛选跑时仍能自跑) ---------- */
    // 外层真实会出现的筛选词:它命中零个沙盒段(段名前缀是 runner-report-selftest/),
    // 正是「本段在 M2W_ONLY=segments 下把沙盒段全滤空」那次的形态
    const outerNeedle = "segments";
    const baseline = await discoverSegments([SANDBOX], { only: null });
    if (baseline.length !== expected.length) {
      fail(`未设筛选词时发现面应含全部 ${expected.length} 个沙盒段,实际 ${baseline.length}`);
    }
    const underOuterFilter = await withOnly(outerNeedle, () => discoverSegments([SANDBOX], { only: null }));
    const underOuterNames = underOuterFilter.map((s) => s.name);
    if (underOuterNames.length !== expected.length || expected.some((name) => !underOuterNames.includes(name))) {
      fail(
        `外层设 M2W_ONLY=${outerNeedle} 时,段内显式 only:null 仍须发现全部 ${expected.length} 个沙盒段` +
          `(实际 ${underOuterNames.join(", ") || "无"}):顶层选择面不得渗进段内发现面`,
      );
    }
    // 反向:显式 only 仍须精确生效(不能因「不读环境变量」把筛选能力一并丢掉)
    const explicitNeedle = isolating ? "state-b" : "cases-pass";
    const explicitExpected = isolating ? STATE_B_SEG : PASS_SEG;
    const explicitNames = await withOnly(outerNeedle, () =>
      discoverSegments([SANDBOX], { only: explicitNeedle }),
    );
    if (explicitNames.length !== 1 || explicitNames[0]?.name !== explicitExpected) {
      fail(
        `段内显式 only=${explicitNeedle} 应只发现 ${explicitExpected},` +
          `实际 ${explicitNames.map((s) => s.name).join(", ") || "无"}`,
      );
    }
    // 执行面:外层有筛选词时,段内显式选择仍照常执行(只跑命中的那一段,不为覆盖面加时长)
    const scoped = await withOnly(outerNeedle, () =>
      runAll([SANDBOX], {
        segmentTimeoutMs: isolating ? ISOLATED_TIMEOUT_MS : INPROC_TIMEOUT_MS,
        only: explicitNeedle,
      }),
    );
    const scopedResult = scoped.results.length === 1 ? at(scoped.results, 0) : null;
    if (scopedResult === null || scopedResult.file !== explicitExpected || !scopedResult.ok) {
      fail(
        `段内显式 only=${explicitNeedle} 应正常执行 ${explicitExpected},实际 ` +
          `${scoped.results.map((r) => r.file).join(", ") || "无"}:` +
          `${scopedResult === null ? "未执行" : errorStack(scopedResult.error)}`,
      );
    }
    // 边界:隔离模型下本段跑在自己的子进程里,env 不得再带顶层筛选词(结构上防同类漏筛;
    // 同进程回退模型下本段与 harness 同进程,本就该看得到,故不判)
    if (isolating && process.env.M2W_ONLY !== undefined) {
      fail(
        `段子进程不应继承顶层筛选词(实际 ${String(process.env.M2W_ONLY)}):` +
          "顶层选择面只属顶层,否则段内自跑会被外层筛选词误伤",
      );
    }
  } finally {
    removeSandboxFile(A_USERDATA_FILE);
    removeSandboxFile(B_USERDATA_FILE);
    cleanupSandbox();
  }
}
