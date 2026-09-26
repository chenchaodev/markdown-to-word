// @ts-check
/**
 * coverage 门禁基线守护段(位于 test/segments/;被测为 package.json 的 test:coverage 参数
 * 向量与 scripts/gate-probes/coverage-baseline.json 的一致性,以及豁免清单与真实编译
 * 产物/测试引用面的自洽性 —— 不测任何业务能力)。
 *
 * 为什么要有这一段:`--all` 打开后,「不可达文件」(新增且从未被 import 的死代码,应当
 * 被抓)与「结构性不可测文件」(Electron 入口、纯类型模块,不该让全仓降分)混进同一个
 * 百分比。平均值同时掩盖两者 —— 这是本门禁最大的盲区。上一轮实测:开着 `--all` 时
 * statements 89.94%(不达标),而把 6 个「无可执行语句 / 运行时入口」文件按清单排除后
 * statements 92.71% —— 说明这些文件既不该算进分母,也不该被静默放过。
 *
 * 本段守「收紧面 + 可见面」,四道断言:
 * 1. 参数向量必须含 `--all` / `--check-coverage` / json-summary / include / exclude,
 *    且四个阈值与基线逐项相同(缺 --all = 盲区回归;阈值两处漂移 = 没人看守);
 * 2. 阈值锚定:floor ≤ thresholds ≤ measured,且 thresholds ≥ measured − headroomPp
 *    (measured 未登记时判红 —— 阈值没有锚点等于没人看守;「实测值待干净树登记」是预期状态);
 * 3. 豁免条目字段完整、分类合法,且**分类与真实编译产物形态自洽**:
 *    empty-module 的产物必须仍是空模块(有人给它加了可执行语句却仍挂着空模块豁免 → 判红);
 *    runtime-entry 的产物必须仍未被任何测试 import(它现在可被单测了 → 豁免失效 → 判红);
 * 4. 清单外的新空模块判红(不登记就会以「0/0 记 0%」的形式悄悄进报告拉低分母)。
 *
 * 「清单外的新 0% 文件」这一面(动态数据)由 `node scripts/gate-probes/coverage-gate.mjs
 * --zero` 承担,必须紧跟 test:coverage 执行(覆盖率数据是那一次运行的产物),故不放本段。
 *
 * 先红后绿:本段在主会话把新参数向量与干净树实测值登记进基线之前**应当是红的**,红的原因
 * 就是待办清单本身(缺 --all / measured 未登记 / 豁免未进 --exclude),不是误报。
 */
import { createCaseSuite } from "../common/case.js";
import { BASELINE_RELATIVE, METRICS, auditStatic, loadBaseline } from "../../scripts/gate-probes/coverage-gate.mjs";

/**
 * 判断一条问题属于哪类(按文本特征;未识别的归入「其它」,并在段末断言「无未识别分类」,
 * 这样新问题类型必须显式落到某个 case 上,不会被静默吞掉)。
 * @param {string} problem 问题文本
 * @returns {string} 分类键
 */
function classify(problem) {
  if (problem.includes("参数向量缺必需项")) return "flags";
  if (problem.includes("基线 thresholds.") || problem.includes("与基线 thresholds.")) return "thresholdsMatch";
  if (problem.includes("参数向量缺 --") && METRICS.some((m) => problem.includes(`--${m}`))) return "thresholdsMatch";
  if (problem.includes("未登记(阈值没有锚点") || problem.includes("measured.") || problem.includes("低于基线 floor") || problem.includes("高于干净树实测") || problem.includes("超过基线 headroomPp")) {
    return "anchors";
  }
  if (problem.includes("未登记进豁免清单")) return "unlistedEmpty";
  if (problem.includes("未出现在 test:coverage 的 --exclude")) return "excludesInFlag";
  if (problem.includes("豁免条目")) return "exemptionEntries";
  if (problem.includes("基线")) return "baselineShape";
  return "其它";
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头):本段断言的是门禁
// 配置与基线的一致性,产物是报告与基线文件,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const { baseline, problems: shapeProblems } = loadBaseline();
  const audit = auditStatic();
  const allProblems = [...shapeProblems, ...audit.problems];

  console.log(`[coverage-gate] 基线 ${BASELINE_RELATIVE};静态审计 ${allProblems.length} 项问题`);

  await suite.describe("参数向量", async () => {
    await suite.case("test:coverage 含全部必需 flag(--all / --check-coverage / json-summary / include / exclude)", () => {
      const own = allProblems.filter((p) => classify(p) === "flags");
      if (own.length > 0) throw new Error(own.join(";"));
    });
    await suite.case("四个阈值与基线逐项一致(阈值只能改基线,不能只改一处)", () => {
      const own = allProblems.filter((p) => classify(p) === "thresholdsMatch");
      if (own.length > 0) throw new Error(own.join(";"));
    });
    await suite.case("豁免文件都在 test:coverage 的 --exclude 里(否则照样拖低全仓)", () => {
      const own = allProblems.filter((p) => classify(p) === "excludesInFlag");
      if (own.length > 0) throw new Error(own.join(";"));
    });
  });

  await suite.describe("阈值锚定", async () => {
    await suite.case("阈值落在 [floor, measured] 且不低于 measured − headroomPp(防止为变绿而下调)", () => {
      const own = allProblems.filter((p) => classify(p) === "anchors");
      if (own.length > 0) throw new Error(own.join(";"));
    });
    await suite.case("干净树实测值已登记(measured 不是 null)", () => {
      const unrecorded = METRICS.filter((metric) => typeof baseline?.measured?.[metric] !== "number");
      if (unrecorded.length > 0) {
        throw new Error(
          `measured.${unrecorded.join("/")} 未登记 —— 阈值失去锚点等于没人看守。` +
            "登记方式:在**干净树**上跑 `npm run test:coverage`(接线后),从 stdout 的 All files 行" +
            "或 coverage/coverage-summary.json 的 total.*.pct 取四个数,填进基线后重跑本段",
        );
      }
    });
  });

  await suite.describe("豁免清单自洽", async () => {
    await suite.case("条目字段完整 / 分类合法 / 分类与真实编译产物形态一致 / 豁免未失效", () => {
      const own = allProblems.filter((p) => classify(p) === "exemptionEntries");
      if (own.length > 0) throw new Error(own.join(";"));
    });
    await suite.case("清单外没有未登记的空模块(不登记就会以 0% 混进分母)", () => {
      const own = allProblems.filter((p) => classify(p) === "unlistedEmpty");
      if (own.length > 0) throw new Error(own.join(";"));
    });
    await suite.case("基线文件结构完整(note / tolerancePp / floor / requireFlags / exemptions)", () => {
      const own = allProblems.filter((p) => classify(p) === "baselineShape");
      if (own.length > 0) throw new Error(own.join(";"));
    });
  });

  // 未识别分类不许静默:新问题类型必须显式落到某个 case 上
  await suite.case("所有问题都已归入上述分类(无未识别的新问题类型)", () => {
    const unknown = allProblems.filter((p) => classify(p) === "其它");
    if (unknown.length > 0) throw new Error(`以下问题未归类,须在 classify() 里补分类:${unknown.join(";")}`);
  });

  const failures = suite.failures;
  if (failures.length > 0) {
    throw new Error(`coverage 门禁基线自检未通过(${failures.length}/${suite.results.length} case 失败):${failures.map((c) => c.name).join(" / ")}`);
  }
  console.log(`[ok] coverage-gate:参数向量、阈值锚定与豁免清单自检通过(${METRICS.length} 指标 / ${baseline?.exemptions?.length ?? 0} 条豁免)`);
  return { cases: suite.results };
}
