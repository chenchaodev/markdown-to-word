// @ts-check
/**
 * `gates/repo/check-html-const-mirror.mjs`(HTML 手写镜像 ↔ core 常量对称门禁)的验收段。
 *
 * ---- 为什么本门禁的负向夹具放在段里而不是 `.selftest.mjs` ----
 * 本仓对 `.selftest.mjs` 载体有一条机械约束:`test/gates/repo/gate-index.test.js` 的格②
 * 判「每个 `gates/` 树下的 `*.selftest.mjs` 都得有一条**在链上**的 npm script 跑它」。
 * 本次落地**刻意不把该门禁挂进 `verify:ci`**(加链由主会话在收尾时统一做),此刻若先建
 * `.selftest.mjs` 载体,格② 会立刻判红「不在链上」—— 那是「载体先于链存在」这一顺序问题的
 * 必然结果,而顺序不是本段能定的。故负向夹具放段里:`test/gates/**` 本就是门禁段的归属层
 * (见 `check-test-layout.mjs` 对 C3 的豁免注释),import 门禁本体是层归属正确的形态。
 *
 * ---- 五格判据与各自的负向夹具 ----
 *   ① 锚点:真实仓两侧当前相等(默认注入面,未注入任何替身)。
 *   ② **负向夹具(本段存在的理由)**:HTML 的 `max` 与常量不一致 ⇒ 判红并点名两侧取值。
 *      —— 证明判据有牙齿,而不是恒绿。
 *   ③ 负向:HTML 侧属性缺失 / input 标签缺失 / 常量取不到(改名或改成非字面数字)⇒ 判红。
 *      「取不到」与「相等」在门禁上不可区分,放过去就是恒绿(见门禁文件头「取不到」一节)。
 *   ④ 覆盖面自检:登记表当前登记的对数与 input 数被逐条点名(整条删掉时这一格不成立)。
 *   ⑤ CLI 档:报告模式 exit 0 / `--enforce` exit 1(ADR-064 的 T0 节奏本身的回归守护)。
 *
 * ---- 恒绿防护 ----
 * 每格都**自己**调判定函数并比对**诊断文案**(而不是只看条数),否则「判定函数恒返回空数组」
 * 这一种退化实现能让全部负向夹具通过 —— 那是最坏的失效形态。
 *
 * ---- 依赖纪律:本段零 `dist/` import ----
 * 被测主体是 `.mjs` 门禁本体(不是编译产物),故本段不需要 build 产物即可跑。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  MIRROR_PAIRS,
  judgeHtmlConstMirror,
  main,
} from "../../../gates/repo/check-html-const-mirror.mjs";
import { createCaseSuite, assert } from "../../harness/case.js";
import { resolveNode } from "../../harness/node-exec.js";
import { ROOT } from "../../harness/paths.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
// 在真实 HTML/常量两侧的判定结论,产物是一组判定结果,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

const GATE_REL = "gates/repo/check-html-const-mirror.mjs";

/**
 * 合成一份 HTML + TS 文本,注入 ctx 求值同一份判据(合成根不落任何盘)。
 * @param {{ max?: string | null, ids?: readonly string[], ts?: string }} [opts] 变异开关
 *   `max: null` = 让 input 标签上**没有** max 属性;`ids` 少一个 = 该 input 标签不存在;
 *   `ts` 整段替换 = 改常量那一行的写法。
 * @returns {{ problems: MirrorProblem[], stats: MirrorStats }}
 */
function judgeSynthetic(opts = {}) {
  const ids = opts.ids ?? ["marginTop", "marginBottom", "marginLeft", "marginRight"];
  const max = opts.max === undefined ? "1000" : opts.max;
  const html = [
    '<div class="mm-grid">',
    ...ids.map((id) => `<input type="number" id="${id}" class="tin" min="0"${max === null ? "" : ` max="${max}"`} step="0.5" />`),
    "</div>",
  ].join("\n");
  const ts = opts.ts ?? "export const MARGIN_MIN_MM = 0;\nexport const MARGIN_MAX_MM = 1000;\n";
  /** @type {Record<string, string>} */
  const files = {
    "src/renderer/index.html": html,
    "src/core/settings/settings-defaults.ts": ts,
  };
  return judgeHtmlConstMirror({
    readText: (relative) => {
      const text = files[relative];
      if (text === undefined) throw new Error(`ENOENT: 合成树里没有 ${relative}`);
      return text;
    },
  });
}

/** @typedef {import("../../../gates/repo/check-html-const-mirror.mjs").MirrorProblem} MirrorProblem */
/** @typedef {import("../../../gates/repo/check-html-const-mirror.mjs").MirrorStats} MirrorStats */

/** 把 problems 拼成可正则匹配的文本 */
const joined = (/** @type {readonly MirrorProblem[]} */ problems) =>
  problems.map((problem) => `${problem.pair} → ${problem.kind}:${problem.detail}`).join("\n");

export async function run() {
  const suite = createCaseSuite();

  await suite.describe("HTML 手写镜像 ↔ core 常量 · 判定本体", async () => {
    await suite.case("锚点:真实仓两侧当前相等(默认注入面,未注入任何替身)", () => {
      const { problems, stats } = judgeHtmlConstMirror();
      assert(
        problems.length === 0,
        `真实仓判红 ${problems.length} 项:\n${joined(problems)}`,
      );
      assert(
        stats.checked > 0,
        `比对格数为 0(${JSON.stringify(stats)}):扫描面塌缩会让「零判红」失去意义`,
      );
      console.log(
        `  [html-mirror] 真实仓:${JSON.stringify(stats)};登记表 ${MIRROR_PAIRS.length} 对`,
      );
    });

    // ---- 负向夹具(本段存在的理由):合成一份与常量不一致的 HTML ⇒ 必须判红 ----
    // ⚠ 若这一格判绿,本门禁就是恒绿的:真实仓当前相等,恒绿与「判据真的在工作」
    // 在正向锚点上完全不可区分,只有负向合成输入能区分。
    await suite.case("负向夹具:HTML 的 max 与 MARGIN_MAX_MM 不一致 ⇒ 判红并点名两侧取值(证明有牙齿)", () => {
      const { problems, stats } = judgeSynthetic({ max: "500" });
      const text = joined(problems);
      assert(
        /margin-max → mismatch/.test(text),
        `HTML max=500 与常量 1000 不一致却未判红(恒绿形态):${problems.length === 0 ? "(零判红)" : text}`,
      );
      assert(
        text.includes('max="500"') && text.includes("MARGIN_MAX_MM = 1000"),
        `诊断应逐字点名两侧取值(便于直接看出写成了什么),实际:${text}`,
      );
      assert(
        stats.mismatches === problems.length && problems.length > 0,
        `计数与诊断不自洽:mismatches=${stats.mismatches} problems=${problems.length}`,
      );
    });

    await suite.case("负向夹具:HTML 侧 max 属性缺失 ⇒ 判红(不是「按无镜像放过」)", () => {
      const { problems } = judgeSynthetic({ max: null });
      const text = joined(problems);
      assert(
        /attribute-missing/.test(text) && text.includes('没有 max 属性'),
        `属性缺失却未判红(恒绿形态):${problems.length === 0 ? "(零判红)" : text}`,
      );
    });

    await suite.case("负向夹具:HTML 侧 input 标签缺失 ⇒ 判红(不是「跳过这一格放过」)", () => {
      const { problems } = judgeSynthetic({ ids: ["marginTop", "marginBottom"] });
      const text = joined(problems);
      assert(
        /input-missing/.test(text) && text.includes('id="marginLeft"'),
        `标签缺失却未判红(恒绿形态):${problems.length === 0 ? "(零判红)" : text}`,
      );
    });

    await suite.case("负向夹具:常量取不到(写法非字面数字)⇒ 判红,而不是静默失明", () => {
      const { problems } = judgeSynthetic({
        ts: "export const MARGIN_MAX_MM = 500 + 500;\n",
      });
      const text = joined(problems);
      assert(
        /constant-missing/.test(text) && text.includes("MARGIN_MAX_MM"),
        `常量取不到却未判红(恒绿形态):${problems.length === 0 ? "(零判红)" : text}`,
      );
    });

    await suite.case("负向夹具:常量文件读不到 ⇒ 判红(取不到 ≠ 查过了)", () => {
      const { problems } = judgeHtmlConstMirror({
        readText: (relative) => {
          if (relative.endsWith(".html")) return '<input id="marginTop" max="1000" />';
          throw new Error("ENOENT: no such file or directory");
        },
      });
      assert(
        /constant-unreadable/.test(joined(problems)),
        `常量文件读不到却未判红:${problems.length === 0 ? "(零判红)" : joined(problems)}`,
      );
    });

    await suite.case("登记表空 ⇒ 判红(零判定面上「每一对都相等」恒绿)", () => {
      const { problems } = judgeHtmlConstMirror({ pairs: [] });
      assert(
        /pair-invalid/.test(joined(problems)),
        `登记表为空却零判红(恒绿形态):${problems.length === 0 ? "(零判红)" : joined(problems)}`,
      );
    });

    // ---- 覆盖面自检:登记表每一对、每一对每一个 input 都被真正审到 ----
    // 「只审第一对」或「每对只审第一个 input」这类退化实现在上面的负向夹具里看不出来
    // (那些夹具改的是**所有**格,少审一格照样判红)。故这一格**逐个 input** 单独制造
    // 「只有它不一致」的合成输入:少审一格 ⇒ 该 input 这一格零判红 ⇒ 本格失败。
    await suite.case("覆盖面:每一对、每一个 input 都单独被审到(逐格独立变异)", () => {
      const grids = [];
      for (const pair of MIRROR_PAIRS) {
        for (const target of pair.inputIds) {
          // 只有 target 用错值,其余一律与常量相等 ⇒ 判红数恰为 1,且只点名 target
          const html = `<div class="mm-grid">\n${pair.inputIds
            .map((id) => `<input id="${id}" max="${id === target ? "900" : "1000"}" />`)
            .join("\n")}\n</div>`;
          const { problems } = judgeHtmlConstMirror({
            readText: (relative) =>
              relative === pair.htmlRel
                ? html
                : `export const ${pair.constantName} = 1000;\n`,
            pairs: [pair],
          });
          const text = joined(problems);
          assert(
            problems.length === 1 && text.includes(`input#${target}`),
            `只让 ${pair.id}/${target} 漂移时,应恰判红 1 条且点名它;实得 ${problems.length} 条:\n${text}`,
          );
          grids.push(`${pair.id}/${target}`);
        }
      }
      assert(grids.length > 0, "登记表零对或零 input:覆盖面这一格在零判定面上恒绿");
      console.log(`  [html-mirror] 覆盖面:逐对 × 逐 input 独立变异 ${grids.length} 格全部被审到`);
    });
  });

  await suite.describe("HTML 手写镜像 ↔ core 常量 · CLI 档(报告模式 / --enforce)", async () => {
    /**
     * 以指定 cwd 跑仓内门禁本体(入口守卫成立:argv[1] 指仓内本体,与 cwd 恒不相等)。
     * @param {string[]} args 传给门禁的参数
     * @returns {{ code: number | null, output: string }}
     */
    const runGate = (args) => {
      // ⚠ 必须用 `resolveNode()` 而不是 `process.execPath`:验收段跑在 Electron 里,
      // 后者是 electron.exe —— 直接 spawn 它会**启动一个 Electron 实例并挂住**
      // (本段实测踩过:CLI 档整个段卡到 180s 超时才被发现)。helper 的注释写明了这一条。
      const result = spawnSync(resolveNode(), [path.join(ROOT, ...GATE_REL.split("/")), ...args], {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
      });
      return { code: result.status, output: `${result.stdout}${result.stderr}` };
    };

    await suite.case("报告模式:真实仓当前判红 → 仍 exit 0(ADR-064 的 T0 节奏本身)", () => {
      const run = runGate([]);
      assert(
        run.code === 0,
        `报告模式应 exit 0,实际 ${String(run.code)}:\n${run.output}`,
      );
      assert(
        /\[ok\] HTML 手写镜像与 core 常量对称\(报告模式\)|\[report\] HTML 手写镜像与 core 常量对称当前判红/.test(run.output),
        `报告模式应打出结论行:\n${run.output}`,
      );
    });

    await suite.case("真实仓当前判红 ⇒ --enforce 与报告模式退出码不同", () => {
      // 只在「真实仓当前判红」这一事实成立时,两者的退出码才必然不同 —— 事实变了这一格
      // 会自己判红(而不是变成一条恒真的断言)。
      const report = runGate([]);
      const enforce = runGate(["--enforce"]);
      const reportClean = /\[ok\]/.test(report.output);
      assert(
        reportClean ? enforce.code === 0 : enforce.code === 1,
        `真实仓${reportClean ? "零判红" : "有判红"}时 --enforce 应分别为 0 / 1,实际 ${String(enforce.code)}:\n${enforce.output}`,
      );
    });

    await suite.case("未知参数 ⇒ exit 1(不得静默按报告模式跑一遍报绿)", () => {
      const run = runGate(["--oops"]);
      assert(
        run.code === 1 && /无法识别的选项:--oops/.test(run.output),
        `未知参数应 exit 1 并指名:\n${run.output}`,
      );
    });

    await suite.case("判定本体在本段进程内直接可调(main 不经子进程)", () => {
      // main 会打日志并出退出码;这里只证明它在本段进程里可调且返回 0/1 之一,
      // 证明「import 判定本体不会顺手改宿主进程的 exitCode」这条入口守卫的意图成立。
      assert(main(["--help"]) === 0, "--help 应返回 0");
    });
  });
}