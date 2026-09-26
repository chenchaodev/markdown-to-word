// 探针编排与报告:建沙盒 → 逐门禁跑 → 汇总判定 → 人类可读摘要 + 机器可读报告。
//
// 报告的确定性是契约:同一棵工作树上重复运行应产出逐字节相同的 report.json,故只写
// 关键字/布尔/仓库相对路径,不写时间戳、耗时、绝对路径与随机目录名。
import fs from "node:fs";
import path from "node:path";
import { GATE_IDS, NODE_TIMEOUT_MS, REPORT_RELATIVE, REPORT_SCHEMA, ROOT, SMOKE_TIMEOUT_MS } from "./contract.mjs";
import { probeBuildFresh, probeSmoke } from "./gates/app.mjs";
import { probeCoverage } from "./gates/coverage.mjs";
import { probeDistManifest } from "./gates/dist-manifest.mjs";
import { probeFixtures } from "./gates/fixtures.mjs";
import { buildSandbox, createTreeSandbox, describeChangedFiles, diffProtectedTree, removeSandbox, snapshotProtectedTree } from "./sandbox.mjs";

/**
 * 跑选定门禁的探针,产出报告(不落盘;落盘由调用方决定)。
 * @param {object} [options] 选项
 * @param {string[]} [options.gates] 门禁 id(默认全部)
 * @param {number} [options.timeoutMs] 单进程硬超时覆盖
 * @param {boolean} [options.writeReport] 是否把报告写到 output/artifacts/gate-probes/report.json
 * @param {(line: string) => void} [options.log] 进度输出(默认 console.log)
 * @returns {Promise<GateProbeReport>} 报告
 */
export async function runGateProbes(options = {}) {
  const selected = (options.gates ?? GATE_IDS).filter((id) => GATE_IDS.includes(id));
  const timeoutMs = Number(options.timeoutMs ?? NODE_TIMEOUT_MS);
  const log = options.log ?? ((line) => console.log(line));
  const before = snapshotProtectedTree();

  const ctx = {
    sandbox: "",
    timeoutMs,
    smokeTimeoutMs: options.timeoutMs === undefined ? SMOKE_TIMEOUT_MS : Math.max(options.timeoutMs, SMOKE_TIMEOUT_MS),
  };
  /** @type {GateProbeResult[]} */
  const gates = [];
  /** @type {ProbeFinding[]} */
  const findings = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string | undefined} */
  let buildNote;

  const needsTreeSandbox =
    selected.includes("fixtures") || selected.includes("build-fresh") || selected.includes("smoke");
  if (needsTreeSandbox) {
    ctx.sandbox = createTreeSandbox();
    try {
      const build = await buildSandbox(ctx.sandbox, timeoutMs);
      buildNote = `沙盒内构建:编译器 exit ${String(build.compilerExitCode)}、资源拷贝 exit ${String(build.rendererExitCode)}${
        build.clean ? "(干净)" : `(存在类型错误文件:${build.errorFiles.join(",") || "未取到文件名"})`
      }`;
      if (build.caveat !== undefined) findings.push({ id: "sandbox-build-caveat", severity: "advisory", summary: build.caveat, evidence: "沙盒内构建未走 npm run build 的批处理垫片,改为直接调用同一编译器入口" });
      log(`[gate-probes] 沙盒已就绪(${buildNote})`);
    } catch (error) {
      findings.push({
        id: "sandbox-build-failed",
        severity: "blocking",
        summary: "沙盒内构建抛错,依赖 dist 形态的门禁结论不可信",
        evidence: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    for (const id of selected) {
      /** @type {GateProbeResult} */
      let gate;
      if (id === "fixtures") gate = await probeFixtures(ctx);
      else if (id === "coverage") gate = await probeCoverage(ctx);
      else if (id === "dist-manifest") gate = await probeDistManifest(ctx);
      else if (id === "build-fresh") gate = await probeBuildFresh(ctx);
      else gate = await probeSmoke(ctx);
      gates.push(gate);
      for (const finding of gate.findings) findings.push(finding);
      log(`[gate-probes] ${gate.verdict === "pass" ? "[pass]" : "[FAIL]"} ${id} ${gate.title} (${gate.cases.length} 项探针)`);
    }
  } finally {
    if (ctx.sandbox !== "") warnings.push(...removeSandbox(ctx.sandbox));
  }

  const after = snapshotProtectedTree();
  const tree = diffProtectedTree(before, after);
  tree.tolerance = "strict";
  const allCases = gates.flatMap((gate) => gate.cases);
  const decisive = allCases.filter((c) => c.informational !== true);
  if (buildNote !== undefined) {
    // 沙盒构建形态是结论的证据之一,登记在全局(不含绝对路径,确定性)
    findings.push({
      id: "sandbox-build",
      severity: "advisory",
      summary: buildNote,
      evidence: "在临时沙盒内执行编译器入口 + copy-renderer,不触碰真实 dist",
    });
  }
  if (!tree.unchanged) {
    const diagnosis = describeChangedFiles(tree.changedFiles);
    if (diagnosis !== "") console.error(`[gate-probes] ${diagnosis}`);
    // 并发容忍模式只把「工作树被外部改动」这一项降级,且必须显式开启、必须照实列出变化
    // 文件:面向多会话并发写同一工作树的场景(如另一个 agent 正在跑验收/改源码)。默认
    // 严格,不设该变量时本项一律 blocking —— 不给「静默放过」留口子。
    const concurrentTolerance = /^(1|true|yes|on)$/i.test((process.env.M2W_GATE_PROBES_ALLOW_CONCURRENT ?? "").trim());
    findings.push({
      id: concurrentTolerance ? "protected-tree-changed-concurrent" : "protected-tree-mutated",
      severity: concurrentTolerance ? "advisory" : "blocking",
      summary: concurrentTolerance
        ? "并发容忍模式:探针期间真实工作树被外部改动(未逐项归因,变化文件已列出)"
        : "探针期间真实工作树发生变化(沙箱纪律被破坏,或工作树正被其它会话并发修改)",
      evidence: `变化路径:${tree.changedPaths.join(",")};变化文件(前 8):${tree.changedFiles.slice(0, 8).join(",") || "无"}`,
    });
    tree.tolerance = concurrentTolerance ? "concurrent" : "strict";
  }
  if (!tree.nodeModulesIntact) {
    findings.push({
      id: "node-modules-mutated",
      severity: "blocking",
      summary: "探针期间 node_modules 哨兵变化(疑似误删真实依赖)",
      evidence: "顶层条目数或存在性发生变化",
    });
  }
  if (warnings.length > 0) {
    findings.push({
      id: "sandbox-cleanup",
      severity: "advisory",
      summary: "沙盒清理有残留",
      evidence: warnings.join(" / "),
    });
  }
  /** @type {GateProbeReport} */
  const report = {
    schema: REPORT_SCHEMA,
    gates,
    findings,
    protectedTree: tree,
    summary: {
      gates: gates.length,
      gatesPassed: gates.filter((gate) => gate.verdict === "pass").length,
      gatesFailed: gates.filter((gate) => gate.verdict === "fail").length,
      cases: decisive.length,
      casesPassed: decisive.filter((c) => c.ok).length,
      casesFailed: decisive.filter((c) => !c.ok).length,
      informational: allCases.filter((c) => c.informational === true).length,
    },
  };

  if (options.writeReport === true) {
    fs.mkdirSync(path.dirname(path.join(ROOT, REPORT_RELATIVE)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, REPORT_RELATIVE), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

/**
 * 报告是否整体通过:门禁全绿 + 无 blocking 级登记项(含真实工作树未被改动)。
 * advisory 级登记项(盲区/边界/并发容忍)不改变退出码,但会在摘要里显式列出,不静默吞掉。
 * @param {GateProbeReport} report 报告
 * @returns {boolean} true = 通过
 */
export function isReportPassing(report) {
  return (
    report.summary.gatesFailed === 0 &&
    report.summary.casesFailed === 0 &&
    report.protectedTree.nodeModulesIntact &&
    (report.protectedTree.unchanged || report.protectedTree.tolerance === "concurrent") &&
    report.findings.every((finding) => finding.severity !== "blocking")
  );
}

/**
 * 人类可读摘要(确定性:不含时间戳/耗时/绝对路径/随机目录名)。
 * @param {GateProbeReport} report 报告
 * @returns {string} 摘要正文
 */
export function formatSummary(report) {
  const lines = ["[gate-probes] 门禁故意失败探针(阴性自检)"];
  for (const gate of report.gates) {
    const anchor = gate.cases.find((c) => c.kind === "anchor");
    const faults = gate.cases.filter((c) => c.kind === "fault");
    const blind = gate.cases.filter((c) => c.kind === "blindspot");
    const anchorText =
      anchor === undefined
        ? "无锚点"
        : `锚点 exit ${String(anchor.exitCode)}${anchor.ok ? "" : "(不符合期望)"}`;
    const faultText =
      faults.length === 0
        ? "无负向探针"
        : `负向 ${faults.filter((c) => c.ok).length}/${faults.length} 变红${
            faults.every((c) => c.ok) ? "" : "(不符合期望)"
          }`;
    lines.push(
      `  [${gate.verdict === "pass" ? "pass" : "FAIL"}] ${gate.id.padEnd(13)} ${gate.npmScript.padEnd(18)} ${anchorText} | ${faultText}` +
        `${blind.length > 0 ? ` | 盲区观测 ${blind.length}` : ""} | 沙盒内:${gate.sandboxed ? "是" : "否"}`,
    );
    for (const probeCase of gate.cases) {
      if (probeCase.ok) continue;
      lines.push(
        `      ↳ ${probeCase.id}: exit ${String(probeCase.exitCode)}` +
          `${probeCase.missingKeywords.length > 0 ? ` 缺关键字[${probeCase.missingKeywords.join("|")}]` : ""}` +
          `${probeCase.forbiddenHits.length > 0 ? ` 意外关键字[${probeCase.forbiddenHits.join("|")}]` : ""}` +
          `${probeCase.timedOut ? " (硬超时)" : ""}` +
          `${probeCase.note === undefined ? "" : ` ${probeCase.note}`}`,
      );
    }
  }
  lines.push(
    `  探针 ${report.summary.cases} 项:通过 ${report.summary.casesPassed} / 失败 ${report.summary.casesFailed}` +
      `${report.summary.informational > 0 ? `(另有 ${report.summary.informational} 项盲区观测)` : ""}`,
  );
  lines.push(
    `  真实工作树指纹:${report.protectedTree.unchanged ? "未变" : `已变(${report.protectedTree.changedPaths.join(",")},共 ${report.protectedTree.changedFiles.length} 个文件;容忍模式:${report.protectedTree.tolerance})`}` +
      ` · node_modules 哨兵:${report.protectedTree.nodeModulesIntact ? "完好" : "异常"}`,
  );
  for (const finding of report.findings) {
    lines.push(`  [${finding.severity === "blocking" ? "block" : "warn"}] ${finding.id}: ${finding.summary}`);
    if (finding.severity !== "blocking") lines.push(`      证据: ${finding.evidence}`);
  }
  lines.push(`  报告: ${REPORT_RELATIVE}`);
  return lines.join("\n");
}

/**
 * 门禁选择(CLI 与测试段共用同一条口径,避免两处筛选逻辑漂移):
 * 优先级 = 显式入参 > M2W_GATE_PROBES_ONLY > 全量,再减去 M2W_GATE_PROBES_SKIP。
 * @param {{ gates?: string[] }} [cli] CLI 解析出的显式选择
 * @returns {string[]} 门禁 id 列表
 */
export function resolveGateSelection(cli = {}) {
  const only = process.env.M2W_GATE_PROBES_ONLY?.trim();
  const skip = process.env.M2W_GATE_PROBES_SKIP?.trim();
  /** @type {string[]} */
  let gates = cli.gates ?? [...GATE_IDS];
  if (cli.gates === undefined && only !== undefined && only !== "") {
    gates = only.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (skip !== undefined && skip !== "") {
    const dropped = skip.split(",").map((item) => item.trim()).filter(Boolean);
    gates = gates.filter((id) => !dropped.includes(id));
  }
  const unknown = gates.filter((id) => !GATE_IDS.includes(id));
  if (unknown.length > 0) {
    throw new Error(`未知门禁 id:${unknown.join(",")}(可选:${GATE_IDS.join(",")})`);
  }
  return gates;
}
