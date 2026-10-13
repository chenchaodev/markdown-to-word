// 测试段 fixture 契约门禁自身的回归守护(负向夹具 + 真变异 + 防空门禁)。
//
// ---- 为什么必须有这份 selftest ----
// 「每个段必须显式声明自己的验收样例契约」这条规则,守的是全仓那批 `fixtures = null`
// 字面量的**合法性**(取值:`git grep -l "export const fixtures = null" -- test | wc -l`)。
// 这族失效的症状是**静默**的:判据一旦退化(例如「不导出 fixtures」也被当成合法终态),
// 那批空声明仍照常合法,而**漏声明**的段走「无 fixtures → 跳过」分支 ——
// 产物缺失,没人看到任何东西变红,只有等某天手写样例与段导出对不上时才发现。
// 本脚本让每一处退化都判红。
//
// ---- 三层守护,互不替代 ----
// ① **合成段档**(CASES 表,合成段树上跑 CLI):反向锚点 + 八档注入。合成段必须写成
//    **带真实 export 的 .js 模块**,因为门禁是**动态 import** 段文件读显式契约的,桩件骗不过 import。
// ② **判定层档**(内联):三种正向锚点(纯函数,合成模块对象,不造文件)+ 塌缩下限的正性。
// ③ **真变异档**(MUTATIONS 表):真改门禁本体的契约判定,跑 CLI,再逐字还原。
//    合成树档验的是「判定逻辑」,本档验的是「它真的接在 CLI 上」(退出码、诊断前缀、诊断族)。
//
// ⚠ **变异窗口内不许并发改动被变异文件**:`finally` 还原之前若有第三方写入,还原会覆盖它。
// 故还原前**先比对**,发现文件已不是本档写进去的那份就**拒绝还原**并判红 ——
// 宁可让本档红着,也不许静默吃掉别人的改动(与 tools/req-edit.mjs 的 TOCTOU 防线同一条理由)。
// 被变异的 `check-segment-contracts.mjs` 同时是 `gen-fixtures.mjs` 的 import 源与本门禁的
// 修复面,这是有意的:本门禁判红时的修法就是改它。
//
// ⚠ **临时产物必须在 finally 清理**:中途断言失败抛异常时同样要删。
//
// ---- 形态:case 契约接入,不接 harness(ADR-074 决定一)----
// 用 `shared/case.js` 的 `createCaseSuite`,逐档 `await suite.case(档名, …)`。
// 入参是「合成段树路径」与「门禁 CLI 的退出码 + 诊断」,不是 harness 那张
// 「树型路径 → 正文 + 问题清单正则」的表 —— 塞进去是假接入,故 bespoke 留在原处。
//
// ⚠ **不复制门禁本体**:门禁**原位**从仓内跑、只靠 cwd 指合成树(项目根单一来源是
// shared/paths.js 的 process.cwd();ESM 静态 import 按文件位置解析、与 cwd 无关,
// 故真脚本的仓内依赖天然可达)。复制一份进来会把「规则的演进」冻在夹具里。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
import { SEGMENT_DIRS } from "../../shared/test-common-surface.js";
// 判定本体静态 import:判定层档直接调它的纯函数;合成树档与变异档走 CLI 子进程
// (变异的是磁盘上的源码,已 import 的这份不受影响 —— 两条路径各验各的,互不替代)。
import {
  MIN_SEGMENTS,
  listCandidateSegments,
  validateSegmentContract,
} from "./check-segment-contracts.mjs";

const gatePath = join(ROOT, "gates", "fixtures", "check-segment-contracts.mjs");

/**
 * 合成段树里的段数。
 *
 * 必须**高于** {@link MIN_SEGMENTS},否则正向锚点在 CLI 上因「扫描面塌缩」恒红 ——
// 那会让上面每一条负向档的「判红」都失去来源(它们的红可能只是塌缩那一族)。
 * 取下限 + 留余量,而不是正好等于下限:正好等于会让锚点骑在下限上,日后调下限时
 * 这条锚点会因为一个与判定逻辑无关的理由变红,把人引向错误的方向。
 * @type {number}
 */
const SEED_SEGMENTS = MIN_SEGMENTS + 4;

/**
 * 段目录里放合成段的目录(段目录集合由 SEGMENT_DIRS 决定,这里只挑位置)。
 * @type {string}
 */
const SEED_DIR = "core";

/**
 * 合成段的仓相对 POSIX 路径。
 * @param {number} index 序号
 * @returns {string}
 */
function seedRel(index) {
  return `test/${SEED_DIR}/selftest-seed-${String(index).padStart(2, "0")}.test.js`;
}

/**
 * 段文件源文本(整段替换进去,不拼行)。
 * @param {string} fixtures `fixtures` 的字面量文本(整段替换进去);传 `undefined` 表示**不导出该键**
 * @param {string | undefined} description `meta.description` 文案;传 `undefined` 表示不导出 `meta`
 * @returns {string}
 */
function segmentSource(fixtures, description) {
  const fixturesLine = fixtures === undefined ? "" : `export const fixtures = ${fixtures};\n`;
  const metaLine = description === undefined ? "" : `export const meta = { description: ${JSON.stringify(description)} };\n`;
  return `${fixturesLine}${metaLine}export function run() {}\n`;
}

/** 合规的合成段(单场景 main):正向锚点树的默认内容 */
const SEED_SEGMENT = segmentSource('{ main: "# 合成段\\n" }', "合成段的样例");

/**
 * 造一棵合成段树:全部段目录都建出来(少建一个门禁就因错误原因失败而不是判红),
 * 再铺 {@link SEED_SEGMENTS} 个合规段。
 * @param {(dir: string) => void} [mutate] 铺完之后施加的注入
 * @returns {string} 合成树根绝对路径
 */
function buildTree(mutate) {
  const root = mkdtempSync(join(tmpdir(), "m2w-segment-contracts-selftest-"));
  try {
    // 段模块按 ESM 解析的依据。缺它 → import 抛 SyntaxError → 门禁因错误原因失败。
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n', "utf8");
    // 门禁遍历 SEGMENT_DIRS 每一个目录:少建一个就 readdirSync 抛错(不是判红)
    for (const relDir of SEGMENT_DIRS) mkdirSync(join(root, "test", ...relDir.split("/")), { recursive: true });
    for (let i = 0; i < SEED_SEGMENTS; i += 1) {
      const target = join(root, ...seedRel(i).split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, SEED_SEGMENT, "utf8");
    }
    // `mutate` 用「非函数」判空而不是 `!== undefined`:夹具表里「无注入」那条写的是
    // `mutate: null`,若按 undefined 判空会把 null 当函数调用 → TypeError 崩在夹具里。
    if (typeof mutate === "function") mutate(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 以某一层 cwd 跑仓内门禁本体(cwd 决定 ROOT,即段树所在处)。
 * @param {string} cwd 工作目录
 * @returns {{ code: number | null, stdout: string, stderr: string }}
 */
function runGate(cwd) {
  const result = spawnSync(process.execPath, [gatePath], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 抽取「诊断里点了谁」这一格。
 *
 * 为什么不直接 `expect: /某段名/` 就完事:那会让「因为别的原因红、顺带提到了这个名字」
 * 也算通过。只认 `[segment-contracts:fail] <名字>:` 这一种前缀,落进集合后逐个比对 ——
 * 于是「点名了别的段」与「点名了这个段」是可区分的。
 * @param {string} stderr 门禁 stderr
 * @returns {string[]} 被点名的段名(或塌缩那一族的名字)
 */
function parseNamed(stderr) {
  return [...stderr.matchAll(/^\[segment-contracts:fail\]\s+(\S+?):/gm)].map((m) => m[1] ?? "");
}

/**
 * 真变异:改门禁本体里契约判定的一行,跑一遍门禁 CLI,再逐字还原。
 *
 * ⚠ **还原前先比对**:文件若已不是本档写进去的那份,说明有第三方在变异窗口内写过它,
 * 还原会覆盖对方的改动 —— 那种情况下宁可判红,也不许静默吃掉。
 * @param {string} cwd 跑 CLI 的工作目录(合成段树根)
 * @param {string} from 原字面量(单行,按 LF 书写)
 * @param {string} to 替换字面量(单行,按 LF 书写)
 * @returns {{ code: number | null, stdout: string, stderr: string, restored: boolean }}
 */
function mutateAndRun(cwd, from, to) {
  const original = readFileSync(gatePath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const probe = original.replace(/\r\n/g, "\n");
  if (!probe.includes(from)) {
    throw new Error(`变异定位失败:${gatePath} 里找不到 ${JSON.stringify(from)}`);
  }
  if (from === to) throw new Error("变异是空操作:结论会是假的");
  const mutated = (eol === "\n" ? probe : probe.replace(/\n/g, eol)).replace(from, to);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(gatePath, mutated, "utf8");
  /** @type {{ code: number | null, stdout: string, stderr: string, restored: boolean }} */
  let run;
  try {
    run = { ...runGate(cwd), restored: false };
  } finally {
    const now = readFileSync(gatePath, "utf8");
    if (now === mutated) {
      writeFileSync(gatePath, original, "utf8");
      run.restored = true;
    }
  }
  return run;
}

/**
 * 逐条核对一次 CLI 运行:退出码 + 点名集合 + 诊断文案。
 * 逐项攒齐才结算 —— 一档只报第一条问题会让定位多跑一轮。
 * @param {{name: string, expectCode: number, expectNamed: string[], expect: RegExp, expectAbsent?: RegExp}} spec 期望
 * @param {{ code: number | null, stdout: string, stderr: string }} run 实测
 * @returns {string[]} problems(空数组 = 全部符合)
 */
function judgeRun(spec, run) {
  const problems = [];
  if (run.code !== spec.expectCode) {
    problems.push(`期望 exit=${String(spec.expectCode)},实际 exit=${String(run.code)}`);
  }
  // 点名集合必须**逐条相同**:既不许漏点,也不许多点(多点的诊断没有归因价值)。
  const want = [...spec.expectNamed].sort();
  const named = [...parseNamed(run.stderr)].sort();
  if (named.join(",") !== want.join(",")) {
    problems.push(`期望点名的集合为 [${want.join(", ")}],实际 [${named.join(", ")}](stderr:\n${run.stderr})`);
  }
  const output = `${run.stdout}${run.stderr}`;
  if (!spec.expect.test(output)) problems.push(`诊断不含 ${spec.expect},实际:\n${output}`);
  if (spec.expectAbsent !== undefined && spec.expectAbsent.test(output)) {
    problems.push(`诊断含本不该出现的一族 ${spec.expectAbsent},实际:\n${output}`);
  }
  return problems;
}

/* ---------- ① 合成段档:合成段树上跑 CLI ---------- */

/** @type {{name: string, mutate: ((dir: string) => void) | null, expectCode: number, expectNamed: string[], expect: RegExp, expectAbsent?: RegExp}[]} */
const CASES = [
  {
    // 反向锚点:下面每条负向的红都必须来自注入的故障,不是「门禁本来就红」。
    name: "反向锚点:全段契约齐备的合成树 → exit 0 且零 [segment-contracts:fail] 诊断",
    mutate: null,
    expectCode: 0,
    expectNamed: [],
    expect: /测试段 fixture 契约判定通过/,
    expectAbsent: /\[segment-contracts:fail\]/,
  },
  {
    // ★ 本文件存在的首要理由:一个**没声明**契约的段必须判红**并点名该段**。
    // 这一格是「fixtures = null 那批字面量是契约声明」这件事的机器锁:放行它,
    // 漏声明的段就静默跳过、产物缺失无人知晓。
    name: "注入:某段不导出 fixtures(缺声明档)→ exit 非 0 且诊断点名该段与「未显式声明」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(0).split("/")), segmentSource(undefined, "没声明契约的段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-00.test.js`],
    expect: /未显式声明 fixture 契约/,
  },
  {
    name: "注入:某段写 fixtures = {} → exit 非 0 且点名该段与「为空对象」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(1).split("/")), segmentSource("{}", "空对象段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-01.test.js`],
    expect: /fixtures 为空对象/,
  },
  {
    name: "注入:某段写 fixtures = [] → exit 非 0 且点名该段与「必须是场景映射对象」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(2).split("/")), segmentSource("[]", "数组段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-02.test.js`],
    expect: /fixtures 必须是场景映射对象或 null,实际 数组/,
  },
  {
    name: "注入:某段写 fixtures = 非空字符串 → exit 非 0 且点名该段与「必须是场景映射对象」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(3).split("/")), segmentSource('"x"', "字符串段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-03.test.js`],
    expect: /fixtures 必须是场景映射对象或 null,实际 string/,
  },
  {
    name: "注入:某段场景值写成非字符串 → exit 非 0 且点名该段与「必须是 md 字符串」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(4).split("/")), segmentSource("{ main: 1 }", "值非字符串段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-04.test.js`],
    expect: /fixtures 场景值必须是 md 字符串/,
  },
  {
    name: "注入:某段键名含非法字符 → exit 非 0 且点名该段与「键名只允许」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(5).split("/")), segmentSource('{ "a b": "x" }', "非法键名段"), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-05.test.js`],
    expect: /fixtures 键名只允许 \[A-Za-z0-9_-\]/,
  },
  {
    name: "注入:某段缺 meta.description → exit 非 0 且点名该段与「缺 meta.description」",
    mutate: (dir) => {
      writeFileSync(join(dir, ...seedRel(6).split("/")), segmentSource('{ main: "x" }', undefined), "utf8");
    },
    expectCode: 1,
    expectNamed: [`${SEED_DIR}/selftest-seed-06.test.js`],
    expect: /缺 meta\.description/,
  },
  {
    // 防空门禁那一档在 CLI 上的机械验证:**先断非空、再断差集命中**的顺序是这一格的全部意义。
    // 若塌缩检查被挪到逐段判定之后,这里仍会红,但**每一条缺声明**都会跟着报出来 ——
    // 诊断会把人引向「又漏声明了一堆段」,而真因是段树被搬空了。
    name: "注入:段树被搬空(零段)→ exit 非 0 且以「扫描面塌缩」判红(且不报成缺声明)",
    mutate: (dir) => {
      for (let i = 0; i < SEED_SEGMENTS; i += 1) rmSync(join(dir, ...seedRel(i).split("/")), { force: true });
    },
    expectCode: 1,
    expectNamed: ["扫描面塌缩"],
    expect: /扫描面塌缩/,
    expectAbsent: /未显式声明 fixture 契约/,
  },
];

/* ---------- ③ 真变异档:退化必须被抓住 ---------- */

/** 变异档的靶段名(落在最后一个种子位;两个变异档用同一个名字,故可逐字共用)。 */
const TARGET_NAME = `${SEED_DIR}/selftest-seed-${String(SEED_SEGMENTS - 1).padStart(2, "0")}.test.js`;

/** @type {{name: string, cwdSeed: {fixtures: string | undefined, description: string | undefined}, from: string, to: string, expect: RegExp, expectAbsent?: RegExp, expectNamed: string[]}[]} */
const MUTATIONS = [
  Object.freeze({
    // 真实缺陷形态:`absent` 那一档的判据被改坏(此处是**打错一个字**这个最常见的形态)。
    // 它不会让门禁变绿,而是让诊断**换人**:漏声明的段落到下一档去,报成「fixtures 必须是
    // 场景映射对象」。那一族一换,人就被指向「你的 fixtures 写错类型了」而不是「你没声明」——
    // 而本档钉住的正是「判红的那一族必须仍是缺声明档」这一条。
    name: "变异① absent 档判据被改坏 ⇒ 同一棵树仍判红,但诊断族已不是「未显式声明」",
    cwdSeed: { fixtures: undefined, description: "没声明契约的段" },
    from: 'if (declaration === "absent") {',
    to: 'if (declaration === "absen") {',
    expect: /fixtures 必须是场景映射对象或 null,实际 undefined/,
    expectAbsent: /未显式声明 fixture 契约/,
    expectNamed: [TARGET_NAME],
  }),
  Object.freeze({
    // 真实缺陷形态:有人把「`fixtures = null` 是合法终态」这条当成缺陷去收紧
    // (最可能的动机是「这么多段都写着 null,一定是没用的残留」)。
    // 合成树里**只有一段**写 null、未变异时是绿的 ⇒ 变异后只有它变红,
    // 于是「那一族空声明仍被判绿」这件事被证明真的接在 CLI 上,而不是只活在纯函数里。
    name: "变异② null-terminal 不再算合法终态 ⇒ 含一段空声明的树判红并点名那一段",
    cwdSeed: { fixtures: "null", description: "显式声明无样例的段" },
    from: '  if (declaration === "null-terminal") return problems; // 显式声明「本段无样例」:合法终态',
    to: '  if (declaration === "null-terminal") return [`${name}:空声明不再被当作合法终态`]; // 显式声明「本段无样例」:合法终态',
    expect: /空声明不再被当作合法终态/,
    expectNamed: [TARGET_NAME],
  }),
];

/** 变异档用的合成树:合规段 + 一段按 `cwdSeed` 写的靶段。 */
function buildSeedTree(seed) {
  return buildTree((dir) => {
    writeFileSync(join(dir, ...seedRel(SEED_SEGMENTS - 1).split("/")), segmentSource(seed.fixtures, seed.description), "utf8");
  });
}

const suite = createCaseSuite();

// 合成段档逐档收进 case:**档名即 case 名**。
for (const testCase of CASES) {
  await suite.case(testCase.name, () => {
    /** @type {string | undefined} */
    let root;
    // 造夹具单独一段:它抛异常 = 夹具不可信(buildTree 自己已在抛异常前清掉半棵合成树),
    // 由 case 级 catch 收成「该 case 失败」—— 不中断后续 case,失败面仍全部可见。
    try {
      root = buildTree(testCase.mutate ?? undefined);
    } catch (error) {
      throw new Error(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const run = runGate(root);
      const problems = judgeRun(testCase, run);
      assert(problems.length === 0, `${testCase.name}:${problems.join("; ")}`);
      console.log(`[ok] segment-contracts-selftest:${testCase.name}(exit ${String(run.code)})`);
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });
}

/* ---------- ② 判定层档:判定本体与已知不覆盖 ---------- */

// 正向锚点(纯函数层,不造文件):三种形态各判一次。任一形态误判红,另一种仍合法也判不出问题,
// 故三种合成一个 case。
await suite.case("判定层正向锚点:null 终态 / 完整契约 / 完整契约带 run 三形态均零问题", () => {
  const shapes = [
    ["显式声明无样例", { fixtures: null }],
    ["完整契约", { fixtures: { main: "x" }, meta: { description: "d" } }],
    ["完整契约带 run", { fixtures: { main: "x" }, meta: { description: "d" }, run() {} }],
  ];
  for (const [label, mod] of shapes) {
    const problems = validateSegmentContract("segments/probe.test.js", mod);
    assert(problems.length === 0, `${label}:不应判红,实际 ${problems.join(" | ")}`);
  }
});

// 防空门禁下限的正性:零段树「全绿」是恒绿形态,下限必须高于它;同时下限必须**低于**真实段数,
// 否则这条下限会在真实仓上恒红(那不是防空,是把门禁锁死)。
await suite.case("扫描面塌缩下限高于零、且低于真实段数(防空门禁那一档不是摆设也不是死闸)", () => {
  assert(MIN_SEGMENTS > 0, `扫描面塌缩下限必须是正数,实得 ${MIN_SEGMENTS}`);
  const real = listCandidateSegments().length;
  assert(
    real > MIN_SEGMENTS,
    `扫描面塌缩下限 ${MIN_SEGMENTS} 不低于真实段数(${real})—— 该下限在本门禁上恒红,不是防空`,
  );
});

// 真变异档:退化必须被抓住。变异的是**门禁本体的一行判据**,跑的是 CLI。
for (const mutation of MUTATIONS) {
  await suite.case(mutation.name, () => {
    const root = buildSeedTree(mutation.cwdSeed);
    try {
      const run = mutateAndRun(root, mutation.from, mutation.to);
      assert(run.restored, `变异窗口内 ${gatePath} 被第三方改过,本档拒绝还原(否则会吃掉别人的改动)`);
      const problems = judgeRun(
        {
          name: mutation.name,
          expectCode: 1,
          expectNamed: mutation.expectNamed,
          expect: mutation.expect,
          expectAbsent: mutation.expectAbsent,
        },
        run,
      );
      assert(problems.length === 0, `${mutation.name}:${problems.join("; ")}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

await suite.case("变异全部还原后 CLI 复绿(收尾那一格:证明前面每一档都没留下残留)", () => {
  const result = spawnSync(process.execPath, [gatePath], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert(result.status === 0, `还原后仍应 exit 0,实得 ${String(result.status)};stderr:\n${result.stderr}`);
  console.log(`[ok] segment-contracts-selftest:真实仓库契约判定复绿(${(result.stdout ?? "").trim()})`);
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) console.error(`[segment-contracts-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  console.error(`[segment-contracts-selftest:fail] 测试段契约门禁回归守护失败,共 ${failures.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] segment-contracts-selftest:${cases.length}/${cases.length} 条全绿`);