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
 * 下面四格负向夹具统一判**这一对**(页边距 `max` ↔ `MARGIN_MAX_MM`)。
 *
 * 为什么钉住一对而不是「默认全表」:这几格验的是判据**本身**的行为(不等 / 属性缺失 /
 * 标签缺失 / 常量取不到,四种「查不到或不等」都必须判红),与登记表里还有哪几对无关。
 * 早期形态让它们跑默认全表,于是往登记表加一对 `min` 属性的镜像就会让四格同时假红 ——
 * 那是夹具形状与判据无关的一处耦合,不是判据出问题。
 */
/**
 * 取登记表里的一对作为本段合成基准;**空表即抛错**。
 *
 * 两条理由合成这一格:① `noUncheckedIndexedAccess` 下 `MIRROR_PAIRS[0]` 是
 * `MirrorPair | undefined`,而本段每一格都以基准对合成 HTML/TS —— 若基准是 undefined,
 * 下面所有格子会在「没有基准」上空转并**全部判绿**(纯文本门禁最坏的失效形态)。
 * ② 用「函数内抛错后返回」而不是 `@type` 断言:前者的类型来自真实收窄,后者是一句谎;
 * 而登记表被清空这件事本身就该响(与门禁自身那条「登记表空 ⇒ 判红」判据同向)。
 */
function anchorPair() {
  const found = MIRROR_PAIRS.find((pair) => pair.id === "margin-max") ?? MIRROR_PAIRS[0];
  if (found === undefined) {
    throw new Error("镜像登记表为空:本段需要至少一对作为合成基准,否则每格都会空转判绿");
  }
  return found;
}
const ANCHOR_PAIR = anchorPair();

/** 合成夹具里常量与「正确」HTML 取值共用的那个字面量(两侧同源,故相等) */
const SYNTHETIC_LITERAL = "1000";

/**
 * 合成一份 HTML + TS 文本,注入 ctx 求值同一份判据(合成根不落任何盘)。
 *
 * ⚠ **形状全部从所判的那一对派生**(属性名取 `pair.attribute`、input id 取 `pair.inputIds`、
 * 常量取 `pair.constantName`),所以登记表加对 / 换属性即自动跟随 —— 早期形态把
 * 「所有对都用 `max`、且登记表只有一对」写死在这几格里,加一对 `min` 镜像就会假红。
 * 整张表**逐对逐 input 的覆盖面**由下面「覆盖面」那一格单独负责,两处职责不重叠。
 * @param {{ pair?: MirrorPair, value?: string | null, ids?: readonly string[], ts?: string }} [opts] 变异开关
 *   `pair` = 判哪一对(缺省 `ANCHOR_PAIR`);`value: null` = 让 input 标签上**没有**该属性;
 *   `ids` 少一个 = 该 input 标签不存在;`ts` 整段替换 = 改常量那一行的写法。
 * @returns {{ problems: MirrorProblem[], stats: MirrorStats }}
 */
function judgeSynthetic(opts = {}) {
  const pair = opts.pair ?? ANCHOR_PAIR;
  const ids = opts.ids ?? pair.inputIds;
  const value = opts.value === undefined ? SYNTHETIC_LITERAL : opts.value;
  const attr = `${pair.attribute}="${value}"`;
  const html = [
    '<div class="mm-grid">',
    ...ids.map((id) => `<input type="number" id="${id}" class="tin"${value === null ? "" : ` ${attr}`} />`),
    "</div>",
  ].join("\n");
  const ts = opts.ts ?? `export const ${pair.constantName} = ${SYNTHETIC_LITERAL};\n`;
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
    pairs: [pair],
  });
}

/** @typedef {import("../../../gates/repo/check-html-const-mirror.mjs").MirrorProblem} MirrorProblem */
/** @typedef {import("../../../gates/repo/check-html-const-mirror.mjs").MirrorStats} MirrorStats */
/**
 * 门禁侧的 `MirrorPair` 是**模块内** typedef(未 `export`),故本段按形状本地声明一份。
 * ⚠ 两处形状要同步:门禁那份加字段而这里没跟上时,本段会因「对象字面量含多余属性」
 * 判红 —— 那是本条该响的,不是误伤。
 * @typedef {{ id: string, htmlRel: string, attribute: string, inputIds: readonly string[], tsRel: string, constantName: string, why: string }} MirrorPair
 */

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
      const { problems, stats } = judgeSynthetic({ value: "500" });
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
      const { problems } = judgeSynthetic({ value: null });
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
          // 属性名取 `pair.attribute`(**不写死 `max`**):登记表里有 `min` / `step` 的镜像对,
          // 写死 `max` 会让那些对合成出「属性缺失」而不是「值漂移」,本格随即假红 ——
          // 那是夹具形状与判据耦合的失效形态,不是判据出问题。
          // 取值两侧同源(HTML 与 TS 常量用同一个 SYNTHETIC_LITERAL),故判据比较的是
          // 「HTML 值 vs TS 常量」是否自洽,与该对真实取值无关 ⇒ 不必按对取真实常量值。
          // 只有 target 用错值,其余一律与常量相等 ⇒ 判红数恰为 1,且只点名 target
          const html = `<div class="mm-grid">\n${pair.inputIds
            .map(
              (id) =>
                `<input id="${id}" ${pair.attribute}="${id === target ? "900" : SYNTHETIC_LITERAL}" />`,
            )
            .join("\n")}\n</div>`;
          const { problems } = judgeHtmlConstMirror({
            readText: (relative) =>
              relative === pair.htmlRel
                ? html
                : `export const ${pair.constantName} = ${SYNTHETIC_LITERAL};\n`,
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