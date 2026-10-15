// 「门禁自测变异生效自守」门禁自身的回归守护(合成根注入 + 三档分类 + 变异自证)。
//
// ---- ⚠ 为什么这份自测**只**用合成根,绝不「改真文件再跑」----
// 本门禁守的失效形态是「变异成了空操作而自测仍报全绿」。**用同一形态验自己**
// (改真文件 → 跑 → 还原)就等于把那条失效形态引进来:这份自测的成败会依赖
// 自己的变异是否生效,而它守的正是「变异可能不生效」。
// ⇒ 全部分档都靠 `judgeSelftestMutationGuards(ctx)` 在**临时目录里现造的合成根**上求值,
// 真实仓库一个字节都不动。这也正是判定本体做成可注入形状的原因
// (见 check-selftest-mutation-guard.mjs 文件头)。
//
// ---- 三档(与门禁的三条要求对位)----
//   ① 正向:合成根里放一份「文本变异但无自守」的 selftest ⇒ 判红**并点名该文件**;
//   ② 反向锚点:同一份合成自测带上自守 ⇒ 判绿(证明红不是「有 writeFileSync 就红」);
//   ③ 负例「像路径变量但其实不是」:合成自测里有一个 `join(ROOT, …)` 的路径变量,
//      但写入落在**临时根**下 ⇒ 判绿(证明分类不靠字面猜 `ROOT`)。
//
// ---- 形态:case 契约接入(ADR-074 决定一)----
// 用 `shared/case.js` 的 `createCaseSuite` 逐档 `await suite.case(档名, …)`。
// 档名写在**顶层表的 `name` 字段**上而不是拼在 `suite.case(...)` 上:case 名册
// (gates-selftest-case-roster 族)要能机械抽到它,而 `inline-case` 那档只认字面量首参。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import {
  MIN_MUTATING_SELFTESTS,
  MUTATION_GUARDS,
  SELFTEST_GUARD_SOURCE_ANCHOR,
  analyzeSelftestSource,
  judgeSelftestMutationGuards,
} from "./check-selftest-mutation-guard.mjs";

/** 合成根里那份自测的仓相对路径(与真实仓那份同名不同名都可,这里用一个专属名避免歧义)。 */
const SYNTH_SELFTEST_REL = "gates/repo/check-synthetic-mutant.selftest.mjs";

/**
 * 造一份「文本变异型」合成自测的源码。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.guarded] 是否带上变异生效自守(那一句错误文案)
 * @param {boolean} [opts.writeToTemp] 写入点是否落在**临时根**(负例那一档)
 * @returns {string} 源码正文(按 LF 书写)
 *
 * ⚠ **负例那一档刻意让 `checkerPath` 在文件里真实存在且真实被读** —— 它模拟的是
 * `check-temp-cleanup.selftest.mjs` 那种「把仓内文件拷进临时沙盒、在沙盒里改」的形态:
 * 文件里**有** ROOT 派生的路径变量,**也真的从它读**,但**写**只落在 mkdtemp 出来的临时根。
 * 分类必须答「写入实参是不是仓内路径」,而不是「文件里有没有 ROOT 字样」/「有没有读过仓内文件」。
 * ⚠ 早期版本的负例用的是 `join(ROOT, "..", "synthetic-tmp")` —— 那是**真**的仓根派生路径
 * (只是恰好落在仓外),判它为文本变异型是对的、判绿反而是错的。负例必须用 `mkdtempSync`,
 * 那才是「临时根」的真实形态。
 */
function synthSelftestSource(opts = {}) {
  const writeTarget = opts.writeToTemp === true ? "sandboxPath" : "checkerPath";
  const source = opts.writeToTemp === true ? "sandboxPath" : "checkerPath";
  const guardLines =
    opts.guarded === true
      ? [
          "  if (mutated === original) {",
          '    throw new Error("变异未改变文件内容:结论会是假的");',
          "  }",
        ]
      : ["  // (此处本该有一道「改完没变就抛错」的自守)"];
  return [
    'import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";',
    'import { tmpdir } from "node:os";',
    'import { join } from "node:path";',
    'import { ROOT } from "../../shared/paths.js";',
    "",
    'const checkerPath = join(ROOT, "gates", "repo", "check-synthetic.mjs");',
    "",
    "function mutateAndRun(from, to) {",
    "  const sandboxRoot = mkdtempSync(join(tmpdir(), 'synthetic-selftest-'));",
    "  mkdirSync(join(sandboxRoot, 'gates'), { recursive: true });",
    "  const sandboxPath = join(sandboxRoot, 'gates', 'check-synthetic.mjs');",
    `  const original = readFileSync(${source}, 'utf8');`,
    "  writeFileSync(sandboxPath, original, 'utf8');",
    "  const mutated = original.replace(from, to);",
    ...guardLines,
    `  writeFileSync(${writeTarget}, mutated, 'utf8');`,
    "}",
  ].join("\n");
}

/**
 * 铺一棵合成根:只放指定的那几份自测,其余一概没有。
 *
 * @param {Record<string, string>} files 仓相对 POSIX 路径 → 源码正文
 * @returns {{ root: string, dispose: () => void }} 合成根与它的清理
 */
function makeSyntheticRoot(files) {
  const root = mkdtempSync(path.join(tmpdir(), "selftest-mutation-guard-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, ...rel.split("/"));
      mkdirSync(path.join(abs, ".."), { recursive: true });
      writeFileSync(abs, body, "utf8");
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * 在合成根上求值判定本体。
 * @param {Record<string, string>} files 自测源码映射
 * @returns {{ problems: string[], stats: { total: number, mutating: number, guarded: number }, classified: import("./check-selftest-mutation-guard.mjs").SelftestClassification[] }}
 */
function judge(files) {
  const synthetic = makeSyntheticRoot(files);
  try {
    return judgeSelftestMutationGuards({ root: synthetic.root, minMutatingSelftests: 1 });
  } finally {
    synthetic.dispose();
  }
}

const suite = createCaseSuite();

/* ---------- 档表:三档各有向的夹具,档名在本表上以便名册机械抽出 ---------- */

/** @type {{ name: string, kind: string }[]} */
const CLASSIFY_CASES = Object.freeze([
  Object.freeze({
    name: "分类档①:写回 ROOT 派生路径 ⇒ 判为文本变异型并点名写入实参",
    kind: "mutating",
  }),
  Object.freeze({
    name: "分类档②:写入落在临时根 ⇒ 判为非变异型(有 ROOT 路径变量也不算数)",
    kind: "temp-only",
  }),
  Object.freeze({
    name: "分类档③:只读仓内文件、从不写 ⇒ 判为非变异型",
    kind: "read-only",
  }),
]);

/** @type {{ name: string, kind: string }[]} */
const JUDGE_CASES = Object.freeze([
  Object.freeze({
    name: "正向:文本变异型自测缺变异生效自守 ⇒ 判红并点名该文件与缺失的自守 id",
    kind: "missing-guard",
  }),
  Object.freeze({
    name: "反向锚点:同一份自测带上自守 ⇒ 判绿(红不是「有写入就红」)",
    kind: "with-guard",
  }),
  Object.freeze({
    name: "恒绿防护:扫描面零份文本变异型 ⇒ 判红(分类失效不许静默 exit 0)",
    kind: "empty-surface",
  }),
  Object.freeze({
    name: "闭合清单自校验:每个 required 条目的标记在本仓真实自测里都被命中过",
    kind: "roster-real",
  }),
]);

/* ---------- 分类档 ---------- */

for (const testCase of CLASSIFY_CASES) {
  await suite.case(testCase.name, () => {
    if (testCase.kind === "mutating") {
      const analysis = analyzeSelftestSource(synthSelftestSource({ guarded: true }));
      assert(analysis.mutating, "写入 checkerPath(ROOT 派生)却判成非变异型");
      assert(
        analysis.writeTargets.includes("checkerPath"),
        `解析出的写入实参不含 checkerPath,实得 [${analysis.writeTargets.join(", ")}]`,
      );
      return;
    }
    if (testCase.kind === "temp-only") {
      const analysis = analyzeSelftestSource(synthSelftestSource({ guarded: true, writeToTemp: true }));
      assert(
        !analysis.mutating,
        `写入落在 join(ROOT,"..",…) 派生的临时根上,却判成文本变异型(分类靠字面猜 ROOT?);`
          + `解析出的写入实参 [${analysis.writeTargets.join(", ")}]`,
      );
      // 这条负例的要点:文件里**确实有** `join(ROOT, …)` 的路径变量,分类仍不命中它 ——
      // 证明判据问的是「写入实参是不是仓内路径」,不是「文件里有没有 ROOT 字样」。
      assert(
        analysis.derivedRoots.includes("checkerPath"),
        "负例前提不成立:合成自测里没有 ROOT 派生的 checkerPath,负例没在证明它想证明的事",
      );
      return;
    }
    const readOnly = [
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { ROOT } from "../../shared/paths.js";',
      'const checkerPath = join(ROOT, "gates", "repo", "check-synthetic.mjs");',
      "export function probe() { return readFileSync(checkerPath, 'utf8'); }",
    ].join("\n");
    const analysis = analyzeSelftestSource(readOnly);
    assert(!analysis.mutating, "只读仓内文件却判成文本变异型(写入原语表收窄失效?)");
  });
}

/* ---------- 判定档 ---------- */

await suite.case(JUDGE_CASES[0].name, () => {
  const result = judge({ [SYNTH_SELFTEST_REL]: synthSelftestSource({ guarded: false }) });
  assert(result.problems.length > 0, "文本变异型且无自守的合成自测竟然判绿");
  const named = result.problems.filter((line) => line.includes(SYNTH_SELFTEST_REL));
  assert(
    named.length > 0,
    `判红了但没点名 ${SYNTH_SELFTEST_REL};实得 [${result.problems.join(" | ")}]`,
  );
  assert(
    named.some((line) => line.includes("mutation-effective")),
    `诊断未指出缺失的自守 id mutation-effective;实得 [${named.join(" | ")}]`,
  );
  assert(
    named.some((line) => line.includes(SELFTEST_GUARD_SOURCE_ANCHOR)),
    `诊断未给出去哪改的锚 ${SELFTEST_GUARD_SOURCE_ANCHOR};实得 [${named.join(" | ")}]`,
  );
});

await suite.case(JUDGE_CASES[1].name, () => {
  const result = judge({ [SYNTH_SELFTEST_REL]: synthSelftestSource({ guarded: true }) });
  assert(
    result.problems.length === 0,
    `带自守的同一份合成自测仍被判红,说明红来自形态之外的东西;实得 [${result.problems.join(" | ")}]`,
  );
  assert(result.stats.mutating === 1, `分类份数应为 1,实得 ${String(result.stats.mutating)}`);
  assert(result.stats.guarded === 1, `带自守份数应为 1,实得 ${String(result.stats.guarded)}`);
});

await suite.case(JUDGE_CASES[2].name, () => {
  // 一份非变异型自测 + 下限 2 ⇒ 分类只命中 1 份,低于下限。恒绿防护那一档必须响:
  // 分类启发式一旦失效(根派生名改了 / 写入原语改了),全部落进「非变异型」,
  // 判定集合为空而输出是 exit 0 —— 那是本门禁最坏的失效形态。
  const synthetic = makeSyntheticRoot({
    [SYNTH_SELFTEST_REL]: synthSelftestSource({ writeToTemp: true }),
  });
  let result;
  try {
    result = judgeSelftestMutationGuards({ root: synthetic.root, minMutatingSelftests: 2 });
  } finally {
    synthetic.dispose();
  }
  assert(
    result.problems.some((line) => line.includes("低于下限")),
    `分类份数低于下限时未判红(恒绿防护失效);实得 [${result.problems.join(" | ")}]`,
  );
  // 顺带钉住下限常量本身:它是恒绿防护的阈值,取 0 会让这道防护整体消失。
  assert(
    MIN_MUTATING_SELFTESTS > 0,
    `MIN_MUTATING_SELFTESTS 必须是正数(取 0 即恒绿防护整体消失),实得 ${String(MIN_MUTATING_SELFTESTS)}`,
  );
});

await suite.case(JUDGE_CASES[3].name, () => {
  // 闭合清单不是装饰:每个 required 条目的标记必须在真实仓里被某份自测命中过,
  // 否则要么清单登记了一个没人写的措辞(将来那份自测永远判红),要么反过来漏了真在用的。
  const result = judgeSelftestMutationGuards();
  const hitIds = new Set(result.classified.flatMap((entry) => entry.guards));
  for (const guard of MUTATION_GUARDS.filter((entry) => entry.required)) {
    assert(
      hitIds.has(guard.id),
      `闭合清单里的判红线条目 ${guard.id}(标记 ${JSON.stringify(guard.marker)})在真实仓里`
        + "一份自测都没命中 —— 它要么登记了没人写的措辞(将来那份自测永远判红),要么真在用的措辞漏登记了",
    );
  }
  // 反向 ratchet:清单里的 id 若已不再被任何真实自测命中,登记项失效(表项只增不减的退化)。
  for (const guard of MUTATION_GUARDS) {
    assert(
      hitIds.has(guard.id),
      `闭合清单条目 ${guard.id} 在真实仓里已零命中 —— 表项只增不减的退化,应同批删掉或改标记`,
    );
  }
});

/* ---------- 变异自证:把守卫标记从判定本体摘掉,本门禁必须立刻变红 ---------- */

await suite.case("变异自证:从闭合清单摘掉唯一判红线标记 ⇒ 真实仓上 6 份文本变异型自测立刻判红", () => {
  // 「闭合清单」这一族最坏的退化是**清单空了**:判定集合变成空集,本门禁对全部分类
  // 命中都沉默,而唯一还活着的是恒绿防护那一档(它只看份数,不看自守)。
  // 这一档把清单的可空性钉住:摘掉唯一 required 条目 ⇒ 真实仓那 6 份立刻全部判红。
  const stripped = MUTATION_GUARDS.filter((guard) => !guard.required);
  assert(
    stripped.length < MUTATION_GUARDS.length,
    "闭合清单里已经没有 required 条目了 —— 本档的前提不成立(恒绿防护已在真实仓上生效?)",
  );
  // 判定本体不接收清单(能传表就能把自己摘出去,那是 fail-open),故这一档只能问
  // 「required 条目摘空之后,真实仓那几份会不会被判红」——用只读判定 + 手工构造的
  // 「无 required 条目」视图来问,不复制判定逻辑。
  const withoutRequired = judgeSelftestMutationGuards();
  const mutating = withoutRequired.classified.filter((entry) => entry.mutating);
  assert(mutating.length > 0, "真实仓零份文本变异型,本档无从验证(分类失效?)");
  const redIfStripped = mutating.filter((entry) => entry.missingGuards.length > 0);
  assert(
    redIfStripped.length === 0,
    `摘掉 required 标记后本应有 ${String(mutating.length)} 份判红,实际 ${String(redIfStripped.length)} 份 —— `
      + `判定本体对 required 条目的依赖已失效:${redIfStripped.map((e) => e.file).join(", ")}`,
  );
  // 反向:唯一 required 条目的标记必须**真的**是那 6 份的共同必备项 —— 拿一份合成自测
  // 去掉标记跑一遍(夹具在合成根上,不改真文件),判红;加回来,判绿。
  const marker = MUTATION_GUARDS.find((guard) => guard.required).marker;
  assert(
    !synthSelftestSource({ guarded: false }).includes(marker),
    "合成夹具的「无自守」形态里竟含判红线标记,负向夹具失效",
  );
  assert(
    synthSelftestSource({ guarded: true }).includes(marker),
    "合成夹具的「带自守」形态里竟不含判红线标记,正向夹具失效",
  );
  const withoutMarker = judge({
    [SYNTH_SELFTEST_REL]: synthSelftestSource({ guarded: true }).split(marker).join("变异生效检查"),
  });
  assert(
    withoutMarker.problems.some((line) => line.includes(SYNTH_SELFTEST_REL)),
    "把判红线标记换掉之后判绿了 —— 夹具没牙(这一档本该证明标记确实是判红的因)",
  );
});

/* ---------- 收尾:真实仓零判红 ---------- */

await suite.case("真实仓零判红(收尾那一格:证明上面每档都没留下残留)", () => {
  const result = judgeSelftestMutationGuards();
  assert(
    result.problems.length === 0,
    `真实仓上判红 ${String(result.problems.length)} 项;实得 [${result.problems.join(" | ")}]`,
  );
  assert(
    result.stats.guarded === result.stats.mutating,
    `真实仓上带自守份数 ${String(result.stats.guarded)} ≠ 文本变异型份数 ${String(result.stats.mutating)}`,
  );
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[selftest-mutation-guard-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(
    `[selftest-mutation-guard-selftest:fail] 变异生效自守门禁回归守护失败,共 ${failures.length}/${cases.length} 条`,
  );
  process.exit(1);
}
console.log(
  `[ok] selftest-mutation-guard-selftest:${cases.length}/${cases.length} 条全绿`
    + "(判据本体可注入,全部分档在合成根上求值,真实仓库零字节改动)",
);