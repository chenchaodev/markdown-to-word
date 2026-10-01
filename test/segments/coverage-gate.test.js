// @ts-check
/**
 * coverage 门禁基线守护段(位于 test/segments/;被测为 package.json 的 test:coverage 参数
 * 向量与 gates/probe/gate-probes/coverage-baseline.json 的一致性,以及豁免清单与真实编译
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
 * 「清单外的新 0% 文件」这一面(动态数据)由 `node gates/probe/gate-probes/coverage-gate.mjs
 * --zero` 承担,必须紧跟 test:coverage 执行(覆盖率数据是那一次运行的产物),故不放本段。
 * 该面同时**回传基线的结构诊断**(基线能解析但字段被改时判红并点名是哪个字段不对,
 * 因为它是唯一挂在 npm script 上的判定面,结构诊断只挂在静态面等于没有);它的回归守护
 * 是 `npm run check:coverage-zero:selftest`(合成基线 + 合成 coverage JSON 的负向夹具),
 * 本段不复制那套夹具,只在真实基线上确认结构诊断仍只有一处实现。
 *
 * 第五组断言是 **`--all` 面的聚合计数**(REQ-123):两个面读的是同一份 `loadBaseline`,
 * 基线结构损坏时同一条病因会被两面各报一次(`X` 与 `基线结构损坏:X`)⇒ 呈现两行都保留
 * (删一行会让人以为只有一个面在报,而那正是这道结构诊断当初的盲区),但 `共 N 项` 只计一次。
 * 判据面是 coverage-gate.mjs 导出的 `aggregateProblems`(纯函数),夹具用**合成基线**造出
 * 结构损坏,并逐条核对「静态面原文 X 在动态面确有 `基线结构损坏:X`」——先证明重复真实存在,
 * 再证明计数把它收了。
 *
 * 先红后绿:本段在主会话把新参数向量与干净树实测值登记进基线之前**应当是红的**,红的原因
 * 就是待办清单本身(缺 --all / measured 未登记 / 豁免未进 --exclude),不是误报。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCaseSuite } from "../common/case.js";
import { withTempResource } from "../common/temp-resource.js";
import {
  BASELINE_RELATIVE,
  BASELINE_SHAPE_PREFIX,
  METRICS,
  SUMMARY_RELATIVE,
  aggregateProblems,
  auditStatic,
  auditZeroFiles,
  loadBaseline,
} from "../../gates/probe/gate-probes/coverage-gate.mjs";

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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
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

  // 结构诊断只此一处实现:动态面 auditZeroFiles 直接复用 loadBaseline 的 problems(不另造
  // 第二套结构校验,见 gates/probe/check-coverage-zero.selftest.mjs 的负向夹具)。若有人在
  // auditStatic 里另写一份结构校验,这里会红 —— 同一条不变量有两个权威判定时,改一处忘
  // 另一处必然漂移,而漂移的方向通常是「少判一条」。
  await suite.case("静态面的基线结构问题逐条来自 loadBaseline(结构诊断只有一处实现)", () => {
    const stray = allProblems.filter((p) => classify(p) === "baselineShape" && !shapeProblems.includes(p));
    if (stray.length > 0) {
      throw new Error(`以下结构诊断不在 loadBaseline() 的输出里(疑似第二套结构校验;结构诊断须只有一处实现):${stray.join(";")}`);
    }
  });

  await suite.describe("--all 面的聚合计数(同一病因只计一次)", async () => {
    // 夹具用合成基线,不碰真实基线文件(段内只读真实仓是本段的既有纪律;覆盖写不得发生)。
    // 形态照 loadBaseline 的最小合法集填(除被注入的那一处),让「结构诊断」是唯一病因。
    const SYNTHETIC_BASELINE = {
      baselineSchema: 1,
      note: ["合成基线:仅供本段 --all 聚合计数夹具使用,不对应真实仓库的任何阈值或豁免。"],
      headroomPp: 4,
      floor: { statements: 85, branches: 80, functions: 85, lines: 85 },
      measured: { statements: 93, branches: 88, functions: 93, lines: 93 },
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      requireFlags: ["--all", "--check-coverage"],
      requireExcludesInFlag: false,
      exemptions: [],
    };
    /**
     * 在一次性夹具根上跑一次审计并把结果交给 `assert` 判定。夹具根的生命周期完全由
     * withTempResource 管(建 → 判定 → 清理,抛错也清),故 `assert` 必须在回调内同步抛,
     * 不能把路径带出来再用 —— 出来时目录已经被删了。
     * @param {(baseline: Record<string, unknown>) => void} mutate 基线注入(结构损坏)
     * @param {(root: string) => void} assert 在夹具根上的判定(抛错即该 case 失败)
     * @returns {Promise<void>}
     */
    async function onFixture(mutate, assert) {
      await withTempResource({ prefix: "m2w-covgate-all-", label: "coverage-gate --all 聚合计数夹具" }, (resource) => {
        const baseline = structuredClone(SYNTHETIC_BASELINE);
        mutate(baseline);
        const baselinePath = path.join(resource.path, ...BASELINE_RELATIVE.split("/"));
        mkdirSync(path.dirname(baselinePath), { recursive: true });
        writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
        // 动态面必须有摘要才走得完(否则它会在结构诊断之前就短路成「未找到 coverage-summary」)
        const summaryPath = path.join(resource.path, ...SUMMARY_RELATIVE.split("/"));
        mkdirSync(path.dirname(summaryPath), { recursive: true });
        writeFileSync(summaryPath, `${JSON.stringify({ total: {} }, null, 2)}\n`, "utf8");
        assert(resource.path);
        return resource;
      });
    }

    await suite.case("结构损坏时 --all 的计数不含重复(呈现两行都保留)", async () => {
      await onFixture(
        (b) => {
          b.headroomPp = "4";
        },
        (root) => {
          const staticProblems = loadBaseline(root).problems;
          if (staticProblems.length === 0) {
            throw new Error("夹具未造出结构诊断(headroomPp 改成字符串后 loadBaseline 仍零问题),本夹具测不到任何东西");
          }
          const zeroProblems = auditZeroFiles(root).problems;
          // 先证明「重复」真实存在:静态面每条原文在动态面都有一条带前缀的同名条目。
          // 若这条红了,说明结构诊断没被动态面回传,聚合去重就无从谈起(那是另一条判据的事)。
          const prefixed = zeroProblems
            .filter((p) => p.startsWith(BASELINE_SHAPE_PREFIX))
            .map((p) => p.slice(BASELINE_SHAPE_PREFIX.length));
          const missing = staticProblems.filter((p) => !prefixed.includes(p));
          if (missing.length > 0) {
            throw new Error(`动态面未回传这些结构诊断(去重键的另一半不存在):${missing.join(";")}`);
          }
          const aggregated = aggregateProblems(staticProblems, zeroProblems);
          // 呈现两行都保留(一行无前缀 + 一行带前缀),这是刻意不删的
          const expectedLines = staticProblems.length + zeroProblems.length;
          if (aggregated.lines.length !== expectedLines) {
            throw new Error(`呈现行数被改动:应为 ${expectedLines} 行(静态 ${staticProblems.length} + 动态 ${zeroProblems.length}),实际 ${aggregated.lines.length}`);
          }
          // 计数:动态面那批带前缀的条目与静态面同源,不该被计第二次
          const expectedCount = staticProblems.length + (zeroProblems.length - prefixed.length);
          if (aggregated.distinctCount !== expectedCount) {
            throw new Error(`共 N 项 的计数应把同一病因只算一次:期望 ${expectedCount},实际 ${aggregated.distinctCount}(呈现 ${aggregated.lines.length} 行)`);
          }
          if (aggregated.distinctCount >= aggregated.lines.length) {
            throw new Error(`计数没有收掉任何重复(${aggregated.distinctCount} >= ${aggregated.lines.length}),去重形同恒等`);
          }
        },
      );
    });

    await suite.case("反向锚点:健康基线与单一面时计数逐条不变(去重不得误伤正常条目)", async () => {
      await onFixture(
        () => {
          /* 不注入任何结构损坏 */
        },
        (root) => {
          const staticProblems = loadBaseline(root).problems;
          if (staticProblems.length > 0) throw new Error(`夹具意外带结构诊断:${staticProblems.join(";")}`);
          // 动态面此时不会报任何结构问题(夹具里的摘要为空对象,0% 集合与空豁免清单一致)
          const zeroProblems = auditZeroFiles(root).problems;
          const both = aggregateProblems(staticProblems, zeroProblems);
          if (both.distinctCount !== both.lines.length) {
            throw new Error(`无结构诊断时不该去重:呈现 ${both.lines.length} 行,计数 ${both.distinctCount}`);
          }
          // 单一面(--zero / --static 各自单跑):聚合必须逐字透传该面的清单
          const onlyZero = aggregateProblems(undefined, zeroProblems);
          if (onlyZero.lines.join("\n") !== zeroProblems.join("\n") || onlyZero.distinctCount !== zeroProblems.length) {
            throw new Error("单一面聚合改变了动态面清单(缺省面必须原样透传)");
          }
          const onlyStatic = aggregateProblems(staticProblems, undefined);
          if (onlyStatic.lines.join("\n") !== staticProblems.join("\n") || onlyStatic.distinctCount !== staticProblems.length) {
            throw new Error("单一面聚合改变了静态面清单(缺省面必须原样透传)");
          }
        },
      );
      // 两面各自独有的诊断不被误合(去重键是「剥前缀后的全文」,不是子串包含)
      const mixed = aggregateProblems(["阈值锚定:branches 未登记"], [`${BASELINE_SHAPE_PREFIX}headroomPp 必须是 ≥0 的数值`]);
      if (mixed.distinctCount !== 2) {
        throw new Error(`两面各自独有的诊断被误合为一条:期望 2,实际 ${mixed.distinctCount}`);
      }
      // 真实工作树:基线结构健康 ⇒ 两面聚合不得发生任何去重
      const realStatic = loadBaseline().problems;
      if (realStatic.length > 0) {
        throw new Error(`真实基线当前带结构诊断(${realStatic.join(";")}),本锚点在真实面上不可判定`);
      }
      const realBoth = aggregateProblems(auditStatic().problems, auditZeroFiles().problems);
      if (realBoth.distinctCount !== realBoth.lines.length) {
        throw new Error(`真实工作树上无结构诊断却发生了去重:${realBoth.distinctCount} != ${realBoth.lines.length}`);
      }
    });
  });

  const failures = suite.failures;
  if (failures.length > 0) {
    throw new Error(`coverage 门禁基线自检未通过(${failures.length}/${suite.results.length} case 失败):${failures.map((c) => c.name).join(" / ")}`);
  }
  console.log(`[ok] coverage-gate:参数向量、阈值锚定与豁免清单自检通过(${METRICS.length} 指标 / ${baseline?.exemptions?.length ?? 0} 条豁免)`);
  return { cases: suite.results };
}
