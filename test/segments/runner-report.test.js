/**
 * runner 自测段(被测 = 测试框架自身:case 级报告 + 失败产物 + 旧段兼容):
 * 在 output/tmp/ 下临时写出三份真实段文件跑 runAll,覆盖四条契约:
 * 1. case 级结果:段内 createCaseSuite 登记的 case(含 describe 分组、耗时、失败消息、
 *    附件引用)经 run() 回传后由 runner 聚合进段结果,并把整段判失败(错误聚合为一条);
 * 2. 失败产物:失败段在 output/artifacts/failures/<段名>/ 落下 failure.log(含段名、
 *    case 名、失败消息)与该段 attach 登记的 buffer 快照;成功段不产该目录;
 * 3. 报告正文:失败 case 行含「段名 › case 名: 消息」+ 通过数 + 合计,无 case 契约的
 *    段不产生 case 行(formatCaseReport 返回空串);
 * 4. 旧段兼容:未接入 case 契约的段抛错仍记段级失败(error.stack 原样、结果无 cases 键),
 *    且成功路径产物目录 output/artifacts/ 不被失败轮次写入(只新增 failures/)。
 *
 * 沙盒纪律:临时段文件与本段造出的失败目录在 finally 整体删除,不残留;断言不依赖
 * test/common/case.js 的 assert(被测件自身出错时不能用被测件判红),一律直接 throw。
 */
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR, ROOT, repoRelative, segmentFailureDir } from "../common/paths.js";
import { formatCaseReport, runAll, summarizeCases } from "../common/runner.js";

/** 临时段文件沙盒(仓库 output/ 下,gitignore 覆盖;不落 test/,免被 typecheck/lint 扫入) */
const SANDBOX = path.join(ROOT, "output", "tmp", "runner-report-selftest");
/** 沙盒段 → 仓库内 case 契约模块的相对路径(output/tmp/<沙盒>/ → test/common/) */
const CASE_MODULE = "../../../test/common/case.js";

const FAIL_SEG = "runner-report-selftest/cases-fail.test.js";
const PASS_SEG = "runner-report-selftest/cases-pass.test.js";
const LEGACY_SEG = "runner-report-selftest/legacy-fail.test.js";

const SNAPSHOT_BYTES = "M2W-FAILURE-SNAPSHOT-BYTES";

function writeSegment(name, source) {
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, name), source, "utf8");
}

/** 读产物目录条目(目录不存在 = 空) */
function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function setupSandbox() {
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
}

function cleanupSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  for (const name of [FAIL_SEG, PASS_SEG, LEGACY_SEG]) {
    fs.rmSync(segmentFailureDir(name), { recursive: true, force: true });
  }
}

export async function run() {
  const artifactsBefore = readDirSafe(ARTIFACTS_DIR);
  setupSandbox();
  try {
    const { results, hung } = await runAll([SANDBOX], { segmentTimeoutMs: 0 });
    const byFile = new Map(results.map((r) => [r.file, r]));
    if (hung) throw new Error("runner 自测:未启用看门狗却报 hung");
    if (results.length !== 3) {
      throw new Error(`runner 自测:应执行 3 个沙盒段,实际 ${results.length}`);
    }
    for (const name of [FAIL_SEG, PASS_SEG, LEGACY_SEG]) {
      if (!byFile.has(name)) throw new Error(`runner 自测:未执行沙盒段 ${name}`);
    }
    for (const name of [FAIL_SEG, LEGACY_SEG]) {
      if (byFile.get(name).ok) throw new Error(`runner 自测:${name} 应失败但判通过`);
    }
    if (!byFile.get(PASS_SEG).ok) {
      throw new Error(`runner 自测:${PASS_SEG} 应通过,实际 ${byFile.get(PASS_SEG).error?.stack}`);
    }

    // ---- 1. case 级结果聚合(失败段) ----
    const failResult = byFile.get(FAIL_SEG);
    if (!Array.isArray(failResult.cases) || failResult.cases.length !== 2) {
      throw new Error(`runner 自测:失败段应回传 2 条 case 结果,实际 ${failResult.cases?.length}`);
    }
    const [first, second] = failResult.cases;
    if (first.ok !== true || second.ok !== false) {
      throw new Error("runner 自测:case 通过/失败标记不符(第一个应通过、第二个应失败)");
    }
    if (second.group !== "自测分组" || first.group !== "自测分组") {
      throw new Error("runner 自测:case 结果应带 describe 分组名");
    }
    if (typeof first.ms !== "number" || first.ms < 0 || typeof second.ms !== "number") {
      throw new Error("runner 自测:case 结果应带耗时(ms)");
    }
    if (second.message !== "故意失败") {
      throw new Error(`runner 自测:失败 case 消息应原样上送,实际 ${second.message}`);
    }
    if (failResult.error?.stack?.includes("1/2 个 case 失败") !== true) {
      throw new Error(`runner 自测:case 失败应聚合为段级错误,实际 ${failResult.error?.stack}`);
    }

    // ---- 2. 失败产物落盘(失败日志 + buffer 快照) ----
    const failDir = segmentFailureDir(FAIL_SEG);
    const expectedFailDir = repoRelative(failDir);
    if (failResult.failureDir !== expectedFailDir) {
      throw new Error(`runner 自测:失败段产物目录应为 ${expectedFailDir},实际 ${failResult.failureDir}`);
    }
    if (!fs.existsSync(path.join(failDir, "failure.log"))) {
      throw new Error("runner 自测:失败段未落下 failure.log");
    }
    const log = fs.readFileSync(path.join(failDir, "failure.log"), "utf8");
    for (const needle of [FAIL_SEG, "第二个 case", "故意失败", "snapshot.docx"]) {
      if (!log.includes(needle)) {
        throw new Error(`runner 自测:failure.log 缺少「${needle}」`);
      }
    }
    const snapshotFile = path.join(failDir, "snapshot.docx");
    if (fs.readFileSync(snapshotFile, "utf8") !== SNAPSHOT_BYTES) {
      throw new Error("runner 自测:失败段 buffer 快照内容与 attach 登记的不一致");
    }
    if (!first.attachments.includes("snapshot.docx")) {
      throw new Error(`runner 自测:case 结果应带附件引用,实际 ${first.attachments}`);
    }

    // ---- 3. 成功段不产失败目录 ----
    const passResult = byFile.get(PASS_SEG);
    if (passResult.cases?.length !== 1 || passResult.cases[0].ok !== true) {
      throw new Error("runner 自测:成功段应回传 1 条通过 case");
    }
    if (passResult.failureDir !== undefined) {
      throw new Error("runner 自测:成功段不应带 failureDir");
    }
    if (fs.existsSync(segmentFailureDir(PASS_SEG))) {
      throw new Error("runner 自测:成功段不应产失败产物目录");
    }

    // ---- 4. 旧段兼容(无 case 契约,抛错即段失败) ----
    const legacyResult = byFile.get(LEGACY_SEG);
    if ("cases" in legacyResult) {
      throw new Error("runner 自测:未接入 case 契约的旧段结果不应带 cases 键");
    }
    if (!legacyResult.error?.stack?.includes("legacy 段故意抛错")) {
      throw new Error(`runner 自测:旧段错误应原样上送,实际 ${legacyResult.error?.stack}`);
    }
    const legacyLog = fs.readFileSync(path.join(segmentFailureDir(LEGACY_SEG), "failure.log"), "utf8");
    if (!legacyLog.includes("legacy 段故意抛错")) {
      throw new Error("runner 自测:旧段失败日志应含段级错误");
    }

    // ---- 5. 报告正文与汇总 ----
    const report = formatCaseReport(results);
    for (const needle of [FAIL_SEG, "自测分组 › 第二个 case", "故意失败", expectedFailDir, "通过 / 1 失败", "1 通过 / 1 失败"]) {
      if (!report.includes(needle)) {
        throw new Error(`runner 自测:case 报告缺少「${needle}」\n实际报告:\n${report}`);
      }
    }
    if (report.includes(LEGACY_SEG)) {
      throw new Error("runner 自测:无 case 契约的段不应出现在 case 报告里");
    }
    if (formatCaseReport([legacyResult]) !== "") {
      throw new Error("runner 自测:全部为旧段时 case 报告应为空串(旧段输出不变)");
    }
    const summary = summarizeCases(results);
    if (summary.segments !== 2 || summary.passed !== 2 || summary.failed !== 1) {
      throw new Error(
        `runner 自测:汇总应为 2 段/2 通过/1 失败,实际 ${JSON.stringify(summary)}`,
      );
    }

    // ---- 6. 失败轮次不写成功路径产物目录 ----
    const added = readDirSafe(ARTIFACTS_DIR).filter((e) => !artifactsBefore.includes(e));
    if (added.some((e) => e !== "failures" && e.startsWith("runner-report-selftest"))) {
      throw new Error(`runner 自测:失败轮次在成功路径产物目录写入了 ${added.join(", ")}`);
    }
  } finally {
    cleanupSandbox();
  }
}
