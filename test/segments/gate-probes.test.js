// @ts-check
/**
 * 门禁故意失败探针段(位于 test/segments/ = 跨域守护段;被测为 scripts/check-gate-probes.mjs
 * 所探测的各道门禁本身,而非任何业务能力):
 *
 * 为什么要有这一段:仓库的 coverage 阈值、fixtures 漂移、构建新鲜度、dist 清单、smoke
 * 冒烟都是「正常路径绿、坏路径红」的门禁。此前没有任何东西验证过它们**坏的时候真的会红**
 * —— 若某道门禁因脚本失效、正则写错、配置项丢失而空过,测试链不会发现(所有门禁的正常
 * 路径本来就都是绿的,没人去看它们会不会红)。本段把每道门禁的「正向锚点 + 负向故障」结果
 * 登记为具名 case:门禁空过、诊断指不到具体内容、或沙箱纪律被破坏,都会在本段判红。
 *
 * 判定纪律(勿放宽):
 * - 每道门禁必须有 exit 0 的正向锚点(防「脚本没跑起来也报绿」),以及 exit 非 0 且命中
 *   具体诊断关键字的负向探针(只看退出码会让「因错误原因失败」蒙混过关);
 * - 锚点不绿 = 沙盒不可信,负向结论不成立 → 判红并写明不可信原因;
 * - 真实工作树零注入:探针只在系统临时目录的工程副本里注入故障,并断言真实
 *   src/test/dist/scripts/output/package*.json 指纹未变、node_modules 哨兵完好。
 *
 * 本段刻意不实现第二套判定逻辑(避免两套口径漂移):判定、报告与摘要全部由
 * scripts/check-gate-probes.mjs 单源产出,本段只做 case 化呈现与门禁级断言。
 *
 * 筛选(与探针脚本同一条口径,便于开发迭代提速):M2W_GATE_PROBES_ONLY=fixtures,dist-manifest
 * 只跑指定门禁;M2W_GATE_PROBES_SKIP=smoke 跳过冒烟(它会在沙盒里真启一次 Electron)。
 * 全量耗时以几十秒计(一次工程副本复制 + 一次沙盒内构建 + 两次冒烟启动 + 若干 c8 运行),
 * 在段默认硬超时内,无需额外调参。
 * 多 agent 并发写同一工作区时,工作树指纹项会因外部改动误判红;此时可显式设
 * M2W_GATE_PROBES_ALLOW_CONCURRENT=1 把该项降级为 advisory(变化文件照实登记,
 * 门禁判定不受影响)。默认不设 = 严格判红。
 */
import fs from "node:fs";
import path from "node:path";
import { REPORT_RELATIVE, formatSummary, isReportPassing, resolveGateSelection, runGateProbes } from "../../scripts/check-gate-probes.mjs";
import { createCaseSuite } from "../common/case.js";
import { ROOT } from "../common/paths.js";

/**
 * 门禁 id → case 名前缀(报告与 case 名对齐,失败时一眼定位)。
 * @type {Record<string, string>}
 */
const GATE_LABELS = {
  fixtures: "fixtures 漂移",
  coverage: "coverage 阈值",
  "dist-manifest": "dist 清单",
  "build-fresh": "构建新鲜度",
  smoke: "smoke 冒烟",
};

/**
 * 探针类别 → case 名里的中文标签。
 * @type {Record<string, string>}
 */
const KIND_LABELS = { anchor: "锚点", fault: "负向", blindspot: "盲区观测" };

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头):本段断言的是门禁
// 自身的行为,产物是机器可读报告,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const gates = resolveGateSelection();
  const report = await runGateProbes({
    gates,
    writeReport: true,
    log: (line) => console.log(line),
  });

  console.log(formatSummary(report));

  await suite.describe("门禁探针", async () => {
    for (const gate of report.gates) {
      const label = GATE_LABELS[gate.id] ?? gate.id;
      await suite.case(`${label}:全程沙盒内完成(真实工作树零注入)`, () => {
        if (!gate.sandboxed) throw new Error(`${gate.id} 未在沙盒内完成,门禁探针不得在真实工作树上注入故障`);
      });
      for (const probeCase of gate.cases) {
        const kindLabel = KIND_LABELS[probeCase.kind] ?? probeCase.kind;
        await suite.case(`${label}:${kindLabel} ${probeCase.id}`, () => {
          if (probeCase.informational === true) {
            // 盲区观测不参与门禁判定,但观测结论必须留痕(不得静默吞掉)
            if (probeCase.note === undefined || probeCase.note === "") {
              throw new Error(`${gate.id}/${probeCase.id} 是盲区观测,必须留下观测结论(不能只跑不留痕)`);
            }
            console.log(`  [blindspot] ${gate.id}/${probeCase.id}: ${probeCase.note}`);
            return;
          }
          /** @type {string[]} */
          const problems = [];
          if (!probeCase.ok) {
            const expected = probeCase.expect === "zero" ? "exit 0" : "exit 非 0";
            problems.push(`退出码 ${String(probeCase.exitCode)}(期望 ${expected}${probeCase.timedOut ? ";由硬超时触发" : ""})`);
          }
          if (probeCase.missingKeywords.length > 0) {
            problems.push(`诊断未命中关键字:${probeCase.missingKeywords.join(" / ")}`);
          }
          if (probeCase.forbiddenHits.length > 0) {
            problems.push(`诊断出现了不该出现的关键字:${probeCase.forbiddenHits.join(" / ")}`);
          }
          if (problems.length > 0) {
            throw new Error(
              `${gate.id}/${probeCase.id}(${probeCase.description})未达预期:${problems.join(";")}` +
                `${probeCase.note === undefined || probeCase.note === "" ? "" : ` | ${probeCase.note}`}`,
            );
          }
        });
      }
      await suite.case(`${label}:门禁判定为 pass`, () => {
        if (gate.verdict === "pass") return;
        const failed = gate.cases.filter((c) => c.informational !== true && !c.ok).map((c) => c.id);
        throw new Error(
          `${gate.id}(${gate.npmScript})探针未通过:${failed.join(",")}` +
            " —— 门禁在被破坏时没变红,或正向锚点不绿导致负向结论不成立(不得改探针掩盖空过)",
        );
      });
    }

    await suite.case("真实工作树指纹未变(沙箱纪律)", () => {
      // node_modules 哨兵任何模式下都必须完好:那是探针自身最危险的动作(摘联接)的后果面
      if (!report.protectedTree.nodeModulesIntact) {
        throw new Error("node_modules 哨兵变化(疑似误删真实依赖)");
      }
      if (report.protectedTree.unchanged) return;
      if (report.protectedTree.tolerance !== "concurrent") {
        throw new Error(`探针期间真实工作树被改动:${report.protectedTree.changedPaths.join(",")}`);
      }
      // 并发容忍模式:不要求未变,但变化必须在报告里留痕(不得静默放过)
      const noted = report.findings.some((finding) => finding.id === "protected-tree-changed-concurrent");
      if (!noted) throw new Error("并发容忍模式下工作树有变化,报告里却没有对应登记项");
      console.log(
        `  [concurrent] 工作树被外部改动(已在报告登记 ${report.protectedTree.changedFiles.length} 个文件):` +
          `${report.protectedTree.changedFiles.slice(0, 5).join(",")}`,
      );
    });

    await suite.case("无 blocking 级登记项", () => {
      const blocking = report.findings.filter((finding) => finding.severity === "blocking");
      if (blocking.length > 0) {
        throw new Error(blocking.map((finding) => `${finding.id}:${finding.summary}`).join(";"));
      }
    });

    await suite.case("报告已落盘且可跨机比对(无时间戳/绝对路径)", () => {
      const reportPath = path.join(ROOT, REPORT_RELATIVE);
      if (!fs.existsSync(reportPath)) throw new Error(`报告未落盘:${REPORT_RELATIVE}`);
      const text = fs.readFileSync(reportPath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed.schema !== "m2w/gate-probes@1") throw new Error(`报告 schema 不符:${String(parsed.schema)}`);
      if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) throw new Error("报告含时间戳,不可复现");
      if (/[A-Za-z]:[\\/]/.test(text)) throw new Error("报告含绝对路径,不可跨机比对");
      if (!Array.isArray(parsed.gates) || parsed.gates.length !== report.gates.length) {
        throw new Error("报告里的门禁条目数与本次运行不一致");
      }
    });
  });

  // advisory 级登记项(盲区/边界)不参与判定,但必须显式留痕,不得静默吞掉
  for (const finding of report.findings) {
    if (finding.severity === "blocking") continue;
    console.log(`  [warn] ${finding.id}: ${finding.summary} —— ${finding.evidence}`);
  }

  if (!isReportPassing(report)) {
    throw new Error(`门禁探针报告整体判定未通过(详见摘要与报告:${REPORT_RELATIVE})`);
  }
  console.log(
    `[ok] gate-probes:${report.summary.gates} 道门禁 / ${report.summary.cases} 项探针全部符合预期` +
      `(advisory 登记 ${report.findings.length} 项;报告:${REPORT_RELATIVE})`,
  );
  return { cases: suite.results };
}
