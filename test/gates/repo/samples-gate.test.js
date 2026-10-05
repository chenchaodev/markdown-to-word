// @ts-check
/**
 * `samples/` 准入门禁(`gates/repo/check-samples.mjs`)的验收段。
 *
 * ---- 这一段与 `.selftest.mjs` 的分工(为什么不重复实现)----
 * 门禁的**自身回归守护**(25 条夹具 + 2 组变异实验)在 `gates/repo/check-samples.selftest.mjs`
 * —— 它在 `verify:ci` 上以独立进程跑,是本仓既有的载体形态。本段**刻意不重复**那些夹具,
 * 只补它**结构上补不了**的那几格:
 *   ① **真实 samples/ 树当前零判红**(载体跑的是**自造的合成树**;真实树这一格只在载体的
 *      CLI 档里出现一次,段的定位是独立第二来源)。
 *   ② **CLI 的默认注入面在真实树上通**(载体那一条也覆盖,但它经子进程;这里在本段进程内
 *      直接 import 判定本体,证明「注入面默认值 = 真实 fs」这件事在段进程里同样成立)。
 *   ③ **判据的对象确实是 `samples/` 本身**:段在真实树上逐文件复核扩展名,与判定本体的
 *      `CODE_EXTS` 对读 —— 闭集若漏收某个扩展名,这一格与「真实树零代码文件」会同时矛盾。
 *   ④ **`samples/` 的实际构成**(扩展名分布 / 递归深度):这是判据边界的事实基础,
 *      写在结论行里而不是写死成断言数字(改代码会让它变,故只取指针不取数值断言)。
 *
 * ---- 依赖纪律:本段住在 `test/gates/`,被测主体是 `gates/` 树的门禁 ----
 * 这是 C3(`test-layer-gate-subject`)**刻意豁免**的层(见 `check-test-layout.mjs:1722`
 * 「`test/gates/**` 的段是门禁段本身」)⇒ 本段 import `gates/repo/check-samples.mjs` 是
 * 层归属正确的形态,不需要登记进门禁主体豁免表。
 *
 * ---- L4 自托管:本段 import 本层主体(`gates/repo/check-samples.mjs`)满足 ----
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import {
  CODE_EXTS,
  SAMPLES_REL,
  checkSamples,
  extOf,
  isCodeFile,
  makeSamplesCtx,
} from "../../../gates/repo/check-samples.mjs";
import { createCaseSuite, assert } from "../../harness/case.js";
import { ROOT } from "../../harness/paths.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
// 在真实 samples/ 树上的判定结论,产物是一组判定结果,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

/**
 * 列真实 `samples/` 树(递归,不限深度 —— 与判定本体同口径)。
 * @param {string} [root] 求值根
 * @returns {string[]} 仓相对 POSIX 路径
 */
function listRealSampleFiles(root = ROOT) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} relDir 仓相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    for (const entry of readdirSync(path.join(root, ...relDir.split("/")), { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk(SAMPLES_REL);
  return files.sort();
}

export async function run() {
  const suite = createCaseSuite();

  await suite.describe("samples/ 准入门禁 · 真实树", async () => {
    await suite.case("锚点:真实 samples/ 树零判红(默认注入面,未注入任何替身)", () => {
      const { problems, stats } = checkSamples();
      assert(
        problems.length === 0,
        `真实 ${SAMPLES_REL}/ 树判红 ${problems.length} 项:\n${problems.join("\n")}`,
      );
      assert(stats.files > 0, `扫描到零个文件(${stats.files}):扫描面塌缩会让「零判红」失去意义`);
      assert(stats.dirs > 0, "samples/ 下没有任何子目录:判据的递归那一档在真实树上从未被走到");
      console.log(
        `  [samples-gate] 真实 ${SAMPLES_REL}/ 树:${stats.files} 文件 / ${stats.dirs} 子目录 / 代码文件 ${stats.codeFiles} 个;`
        + `结论行分布 ${Object.entries(stats.byExt).map(([e, n]) => `${e}×${n}`).join(" ")}`,
      );
    });

    await suite.case("逐文件复核:真实树每个文件的扩展名都在闭集之外(与判定本体的 CODE_EXTS 对读)", () => {
      // 这一格是「闭集与真实树互相对读」:判定本体判零代码文件,本段独立重算一遍。
      // 两边若不一致(闭集漏收某个真实存在的扩展名),这一格与上一格会同时矛盾 ⇒ 可归因。
      const offenders = listRealSampleFiles().filter((rel) => isCodeFile(rel.slice(rel.lastIndexOf("/") + 1)));
      assert(
        offenders.length === 0,
        `真实 ${SAMPLES_REL}/ 树里这些文件按 CODE_EXTS 判为代码文件:${offenders.join(", ")}`,
      );
      const byExt = new Map();
      for (const rel of listRealSampleFiles()) {
        const ext = extOf(rel.slice(rel.lastIndexOf("/") + 1));
        byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
      }
      console.log(
        `  [samples-gate] 独立重算:真实树扩展名分布 `
        + `${[...byExt].sort().map(([e, n]) => `${e === "" ? "(无扩展名)" : e}×${n}`).join(" ")}`,
      );
    });

    await suite.case("反向锚点:注入一棵带 .mjs 的合成树 ⇒ 判红并点名(证明判据不是恒绿)", () => {
      // **负向对照跑在段里**(合成树,不碰真实 samples/):上一格与这一格成对,任一恒绿
      // 都说明这一格验的不是「判定逻辑」而是「恰好没触发」。合成根经 ctx 注入,
      // 判定本体不落任何盘。
      //
      // ⚠ 合成树**显式列成一张「目录 → 条目」表**,不从文件路径前缀反推:反推那种写法
      // 里「哪些条目属于这一层」的条件一旦写错(实测踩过),合成树会静默长成空目录,
      // 门禁判「零代码文件」而这一格反倒绿 —— 即恒绿形态的镜像(恒红的守卫自己坏了)。
      /** @type {Record<string, {name: string, isDirectory: boolean}[]>} */
      const synthetic = {
        [`${SAMPLES_REL}`]: [{ name: "docs", isDirectory: true }],
        [`${SAMPLES_REL}/docs`]: [
          { name: "keep.md", isDirectory: false },
          { name: "build.mjs", isDirectory: false },
        ],
      };
      const problems = checkSamples(
        makeSamplesCtx({
          root: "/synthetic/samples-root",
          listDir: (relative) => synthetic[relative] ?? [],
        }),
      ).problems;
      assert(
        problems.some((line) => line.includes("samples/docs/build.mjs") && line.includes("samples-no-code-files")),
        `合成树上有 .mjs 却零判红(恒绿形态):${problems.length === 0 ? "(零判红)" : problems.join("\n")}`,
      );
    });

    await suite.case("反向锚点:注入一棵列不出来的树 ⇒ 判红(证明不是「按空树放过」)", () => {
      const problems = checkSamples(
        makeSamplesCtx({
          root: "/synthetic/samples-root",
          listDir: () => {
            throw new Error("ENOENT: no such file or directory, scandir 'samples'");
          },
        }),
      ).problems;
      assert(
        problems.some((line) => line.includes("samples-unreadable-subtree")),
        `列不出来的树却零判红(恒绿形态):${problems.length === 0 ? "(零判红)" : problems.join("\n")}`,
      );
    });

    await suite.case("闭集自身:CODE_EXTS 非空且每一项都带点、无重复(判据不能因表被清空而恒绿)", () => {
      assert(CODE_EXTS.length > 0, "CODE_EXTS 为空:判据一在零判定面上恒绿(空闭集是最坏的失效形态)");
      assert(new Set(CODE_EXTS).size === CODE_EXTS.length, `CODE_EXTS 有重复项:[${CODE_EXTS.join(", ")}]`);
      for (const ext of CODE_EXTS) {
        assert(ext.startsWith(".") && ext.length > 1, `CODE_EXTS 里的 ${JSON.stringify(ext)} 不是扩展名形态`);
        assert(ext === ext.toLowerCase(), `CODE_EXTS 里的 ${JSON.stringify(ext)} 不是小写(大小写不敏感文件系统上会绕过判据)`);
      }
    });

    await suite.case("判定面与注入面真在导出(段能 import 到它们本身就是这一格的前提)", () => {
      for (const [name, value] of Object.entries({ checkSamples, makeSamplesCtx, extOf, isCodeFile })) {
        assert(typeof value === "function", `${name} 不是函数(导出面变了,而段的其余各格会连带崩)`);
      }
    });
  });

  console.log(
    `[ok] samples-gate:${SAMPLES_REL}/ 准入判据在真实树零判红;`
    + "合成树的负向对照(代码文件 / 列不出来)证明判据不是恒绿;闭集与真实树互相对读",
  );
  return { cases: suite.results };
}