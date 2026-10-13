// renderer HTML data-i18n 通道门禁自身的回归守护(合成根 + 真变异)。
//
// check-i18n-keys.mjs 是「HTML 里的 data-i18n* 值必须是字典键」这一族的唯一机器看守。
// 而这一族的失效形态**天然是静默的**:判据退化成「永远 exit 0」时,真实症状是某个属性写了
// 字典外的 key,界面静默显示裸 key(如 `foo.bar` 原文),没有任何门禁报红 —— 事实底账见
// `docs/evidence/20261006-173000-data-i18n属性通道无校验的事实底账.md`。
// 本脚本让每一处退化都判红。
//
// ---- 四层守护,互不替代 ----
// ① **基线档(内联)**:真实仓库零问题,且扫描面三项(HTML 份数 / 属性出现数 / 字典键数)均非零
//    —— 只断言「零问题」的话,把字典切空、把扫描根写错都能照样绿,那正是恒绿入口。
// ② **判定层档(KNOWN_SHAPES / SAFE_SHAPES 两张表)**:合成 HTML 正文 + 合成字典键集合,
//    直接调纯函数 judgeHtmlKeys。KNOWN = 必须判红(字典外 key / 空值 / 值域含空格 / 单段无点 /
//    首尾空白 / -title 形态);SAFE = 必须零命中(合法键 / 四种形态 / **剥注释不误伤** / 单引号)。
//    剥注释那一格是判据「先剥注释再扫」的牙齿:注释里的字典外 key 若被当属性就会判红。
// ③ **合成根 CLI 档(内联)**:临时目录里铺 `src/core/i18n/zh.ts` + `src/renderer/*.html`,
//    以 cwd 指合成根 spawn 仓内真脚本。验 exit 码 + 诊断前缀 + 塌缩两档(零 HTML / 某 HTML 零属性)。
// ④ **真变异档(MUTATIONS 表)**:① 往合成 HTML 注入一个字典外 key ⇒ 判红并点名 file:line: attr=值,
//    撤掉 ⇒ 复绿(变异对象是**被检主体**,复刻真实缺陷);② 把门禁本体的字典成员判据改成恒真 ⇒
//    合成根里的字典外 key 不再判红(证明判红确由该判据产生,不是恒红)。还原前**先比对**。
//
// ⚠ **变异窗口内不许并发改动被变异文件**:`finally` 还原之前若有第三方写入,还原会覆盖它。
// 故还原前**先比对**,发现文件已不是本档写进去的那份就**拒绝还原**并判红(见 mutateAndRun)。
//
// ⚠ **临时产物必须在 finally 清理**:中途断言失败抛异常时同样要删。
//
// ---- 形态:case 契约接入,不接 harness(ADR-074 决定一)----
// 用 `shared/case.js` 的 createCaseSuite,逐档 `await suite.case(档名, …)`。
// ⚠ **档名写成表字段 `name` / 内联字面量首参**,便于 `check-test-layout` 的⑯ 族按策略机械抽出对账。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
// 判定本体静态 import:合成根档与判定层档直接调它的纯函数;CLI 档走子进程 spawn 磁盘上的真脚本
// (变异档变异的是磁盘源码,已 import 的这份不受影响 —— 三条路径各验各的,互不替代)。
import { analyze, judgeHtmlKeys, SCAN_ROOT, DICT_REL } from "./check-i18n-keys.mjs";

const gatePath = join(ROOT, "gates", "repo", "check-i18n-keys.mjs");

/** 判定层合成字典(键集合)。刻意小:只覆盖夹具用到的合法键,越小时「字典外」的边界越锐利。 */
const SYNTH_DICT = Object.freeze([
  "segment.leaf",
  "common.ok",
  "settings.title",
  "about.title",
  "drop.ariaLabel",
  "preview.title",
  "file.clearList",
]);
const synthDict = () => new Set(SYNTH_DICT);

/** 合成根的 zh.ts 源文本(extractDictKeys 的切片锚:`const dict = {` … `} as const;`)。 */
function fixtureDictText() {
  const body = SYNTH_DICT.map((k) => `  ${JSON.stringify(k)}: "文案-${k}",`).join("\n");
  return `const dict = {\n${body}\n} as const;\nexport type Dict = keyof typeof dict;\nexport { dict };\n`;
}

/** 合规的合成 index.html:用了全部合法键 + 一段含「文档示例 data-i18n」的注释。 */
function validIndexHtml() {
  return [
    "<!doctype html>",
    '<html><head><title data-i18n="settings.title">设置</title></head>',
    "<body>",
    '  <!-- 文档注释:此处举例 data-i18n="not.a.real.key" 是说明,不是属性 -->',
    '  <h1 data-i18n="segment.leaf">叶</h1>',
    '  <button data-i18n-title="preview.title" title="预览">预览</button>',
    '  <input data-i18n-placeholder="drop.ariaLabel" placeholder="拖放" />',
    '  <button data-i18n-aria-label="drop.ariaLabel" aria-label="拖放">x</button>',
    '  <span data-i18n="common.ok">确定</span>',
    "</body></html>",
  ].join("\n");
}

/** 合规的合成 about.html。 */
function validAboutHtml() {
  return '<html><body><section data-i18n="about.title"></section></body></html>\n';
}

/**
 * 铺一个合成根:写入 dict 源 + 可选 HTML。`html` 为 `仓相对 POSIX → 正文` 映射;
 * `emptyRenderer` = 只建空的 `src/renderer/`(塌缩档用)。
 * @param {{ html?: Record<string, string>, emptyRenderer?: boolean }} [opts]
 * @returns {string} 合成根绝对路径
 */
function makeFixtureRoot(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "m2w-i18n-keys-selftest-"));
  try {
    writeUnder(root, DICT_REL, fixtureDictText());
    if (opts.emptyRenderer) mkdirSync(join(root, ...SCAN_ROOT.split("/")), { recursive: true });
    for (const [rel, text] of Object.entries(opts.html ?? {})) writeUnder(root, rel, text);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** 在合成根下写一个仓相对文件(自动建父目录)。 */
function writeUnder(root, rel, text) {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text, "utf8");
}

/**
 * 以某一层 cwd 跑仓内门禁本体(cwd 决定 ROOT,即被检树所在处)。
 * @param {string} cwd 工作目录
 * @param {string[]} [args]
 * @returns {{ code: number | null, stdout: string, stderr: string }}
 */
function runGate(cwd, args = []) {
  const result = spawnSync(process.execPath, [gatePath, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 真变异:改一份文件的正文,跑一遍门禁 CLI,再逐字还原。
 *
 * ⚠ **还原前先比对**:文件若已不是本档写进去的那份,说明有第三方在变异窗口内写过它,
 * 还原会覆盖对方的改动 —— 那种情况下宁可判红,也不许静默吃掉。
 * @param {string} targetPath 被变异文件绝对路径
 * @param {string} cwd 跑 CLI 的工作目录(合成根)
 * @param {string} from 原字面量(单行或原样)
 * @param {string} to 替换字面量
 * @returns {{ code: number | null, stdout: string, stderr: string, restored: boolean }}
 */
function mutateAndRun(targetPath, cwd, from, to) {
  const original = readFileSync(targetPath, "utf8");
  if (!original.includes(from)) {
    throw new Error(`变异定位失败:${targetPath} 里找不到 ${JSON.stringify(from)}`);
  }
  if (from === to) throw new Error("变异是空操作:结论会是假的");
  const mutated = original.replace(from, to);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(targetPath, mutated, "utf8");
  /** @type {{ code: number | null, stdout: string, stderr: string, restored: boolean }} */
  let run;
  try {
    run = { ...runGate(cwd), restored: false };
  } finally {
    const now = readFileSync(targetPath, "utf8");
    if (now === mutated) {
      writeFileSync(targetPath, original, "utf8");
      run.restored = true;
    }
  }
  return run;
}

const suite = createCaseSuite();

/* ---------- 判定层:KNOWN_SHAPES(必须判红)---------- */

/** @type {{name: string, text: string, expect: string}[]} */
const KNOWN_SHAPES = Object.freeze([
  {
    name: "判红:字典外 key(字面量形态,值域合法但 Dict 无此键)",
    text: '<b data-i18n="dictionary.absent.key"></b>',
    expect: "data-i18n=dictionary.absent.key → 字典外 key",
  },
  {
    name: '判红:空值 data-i18n="" —— tByKey("") 静默清空文案',
    text: '<b data-i18n=""></b>',
    expect: "data-i18n= → 值域不合法",
  },
  {
    name: "判红:值域含空格",
    text: '<b data-i18n="has space"></b>',
    expect: "data-i18n=has space → 值域不合法",
  },
  {
    name: "判红:值域单段无点",
    text: '<b data-i18n="nodot"></b>',
    expect: "值域不合法",
  },
  {
    name: "判红:值域首尾空白",
    text: '<b data-i18n=" segment.leaf "></b>',
    expect: "值域不合法",
  },
  {
    name: "判红:data-i18n-title 形态字典外 key",
    text: '<button data-i18n-title="absent.title"></button>',
    expect: "data-i18n-title=absent.title → 字典外 key",
  },
]);

for (const shape of KNOWN_SHAPES) {
  await suite.case(shape.name, () => {
    const problems = judgeHtmlKeys([{ rel: "probe.html", text: shape.text }], synthDict());
    assert(
      problems.some((p) => p.includes(shape.expect)),
      `${shape.name}:期望诊断含 ${JSON.stringify(shape.expect)},实得 ${problems.join(" | ") || "(零)"}`,
    );
    // 反证不是「连合法键也报」:同一份合成字典下,替换成合法键必须零问题。
    const clean = judgeHtmlKeys([{ rel: "probe.html", text: '<b data-i18n="segment.leaf"></b>' }], synthDict());
    assert(clean.length === 0, `同一文件换成合法键应零问题,实得:${clean.join(" | ")}`);
  });
}

/* ---------- 判定层:SAFE_SHAPES(必须零命中,判据窄度的护栏)---------- */

/** @type {{name: string, text: string}[]} */
const SAFE_SHAPES = Object.freeze([
  { name: "判绿:合法键 base 形态", text: '<b data-i18n="segment.leaf"></b>' },
  {
    name: "判绿:四种属性形态各异(base/title/aria-label/placeholder)",
    text:
      '<b data-i18n="common.ok"></b><i data-i18n-title="preview.title" title="x"></i>'
      + '<u data-i18n-placeholder="file.clearList"></u><s data-i18n-aria-label="drop.ariaLabel"></s>',
  },
  {
    name: "判绿:剥注释不误伤 —— 注释文本里的字典外 key 不算属性",
    text: '<!-- 文档示例:data-i18n="not.a.real.key" 不应被当属性 -->\n<b data-i18n="segment.leaf"></b>',
  },
  { name: "判绿:单引号属性合法", text: "<b data-i18n='common.ok'></b>" },
]);

for (const shape of SAFE_SHAPES) {
  await suite.case(shape.name, () => {
    const problems = judgeHtmlKeys([{ rel: "probe.html", text: shape.text }], synthDict());
    assert(
      problems.length === 0,
      `${shape.name}:不该命中却命中了:${problems.join(" | ")}`,
    );
  });
}

/* ---------- 真变异档:退化必须被抓住 ---------- */

/** @type {{name: string, run: () => Promise<void> | void}[]} */
const MUTATIONS = Object.freeze([
  {
    // 真实缺陷形态:HTML 里写了一个字典没有的 key。变异注入它 ⇒ 门禁必须判红**并点名**
    // 文件:行号: 属性名=值(行号那一半由「剥注释保留换行」保证);撤掉 ⇒ 复绿。这是 acceptance #5
    // 的「变异自证两份输出」。
    name: "变异① 往合成 HTML 注入一个字典外 key ⇒ 判红并点名 文件:行号: 属性名=值;撤掉 ⇒ 复绿",
    run: () => {
      const root = makeFixtureRoot({
        html: { "src/renderer/index.html": validIndexHtml(), "src/renderer/about.html": validAboutHtml() },
      });
      const target = join(root, ..."src/renderer/index.html".split("/"));
      try {
        const anchor = '  <span data-i18n="common.ok">确定</span>';
        const injected = `${anchor}\n  <span data-i18n="bogus.missing.key"></span>`;
        const red = mutateAndRun(target, root, anchor, injected);
        assert(red.restored, `变异①还原窗口内 ${target} 被第三方改过,本档拒绝还原`);
        assert(red.code === 1, `注入字典外 key 应 exit 1,实得 ${String(red.code)};stderr:\n${red.stderr}`);
        assert(
          red.stderr.includes("src/renderer/index.html:") && red.stderr.includes("data-i18n=bogus.missing.key"),
          `注入后诊断未点名 文件:行号: 属性名=值;stderr:\n${red.stderr}`,
        );
        // 撤掉(mutateAndRun 的 finally 已还原)⇒ 复绿
        const green = runGate(root);
        assert(green.code === 0, `撤掉后应 exit 0,实得 ${String(green.code)};stderr:\n${green.stderr}`);
        console.log(`[ok] i18n-keys-selftest:变异① 注入判红 / 撤掉复绿`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 判据自身的牙齿:把门禁本体的「字典成员」判据改成恒真 ⇒ 合成根里的字典外 key 不再判红。
    // 证明「字典外 key 判红」这一族确由该判据产生,而不是恒红(换成合法键也报)。还原后复判红。
    name: "变异② 关掉判据本体的字典成员检查 ⇒ 字典外 key 不再判红(证明判红由该判据产生,不是恒红)",
    run: () => {
      const root = makeFixtureRoot({
        html: { "src/renderer/index.html": '<b data-i18n="bogus.missing.key"></b>' },
      });
      try {
        const before = runGate(root);
        assert(before.code === 1, `未变异时字典外 key 应判红,实得 ${String(before.code)}`);
        const from = "} else if (!dict.has(value)) {";
        const to = "} else if (!dict.has(value) && false) {";
        const mutated = mutateAndRun(gatePath, root, from, to);
        assert(mutated.restored, `变异②还原窗口内 ${gatePath} 被第三方改过,本档拒绝还原`);
        assert(
          mutated.code === 0,
          `关掉字典成员判据后,合成根的字典外 key 应转绿(证明判红由该判据产生),实得 exit ${String(mutated.code)};stderr:\n${mutated.stderr}`,
        );
        // 还原后再跑一次:应重新判红(证明还原真的恢复了判据,不是留下了关闭态)。
        const after = runGate(root);
        assert(after.code === 1, `还原后字典外 key 应重新判红,实得 ${String(after.code)}(还原未生效?)`);
        console.log(`[ok] i18n-keys-selftest:变异② 关闭判据转绿 / 还原复红`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  },
]);

/* ---------- ① 基线档:真实仓库 ---------- */

await suite.case("真实仓库零缺口:每个 data-i18n* 值都命中值域且在字典内(analyze 零问题)", () => {
  const result = analyze();
  assert(
    result.problems.length === 0,
    `真实仓库有 ${result.problems.length} 项:${result.problems.join(" | ")}`,
  );
});

await suite.case("真实仓库扫描面三项均非零:HTML 份数、属性出现数、字典键数都为正(防空门禁那档不是摆设)", () => {
  const result = analyze();
  assert(result.files > 0, `HTML 份数应为正,实得 ${result.files}(扫描根被搬空 ⇒ 恒绿)`);
  assert(result.occurrences > 0, `属性出现数应为正,实得 ${result.occurrences}(正则失配 ⇒ 恒绿)`);
  assert(result.dictKeys > 0, `字典键数应为正,实得 ${result.dictKeys}(切片锚失配 ⇒ 全量误判红)`);
});

await suite.case("判定层塌缩:某 HTML 文件零 data-i18n 属性 ⇒ judgeHtmlKeys 判红并点名该文件", () => {
  const problems = judgeHtmlKeys([{ rel: "empty.html", text: "<div>no i18n here</div>\n" }], synthDict());
  assert(
    problems.some((p) => p.includes("empty.html") && p.includes("零 data-i18n* 属性")),
    `零属性文件应被点名,实得:${problems.join(" | ") || "(零)"}`,
  );
});

await suite.case("判定层:空文件清单 ⇒ judgeHtmlKeys 零问题(空清单的塌缩由 CLI 的 files===0 档拦,分层同 check-segment-contracts)", () => {
  const problems = judgeHtmlKeys([], synthDict());
  assert(problems.length === 0, `空文件清单应零问题(逐条判据无对象),实得:${problems.join(" | ")}`);
});

await suite.case("行号定位:data-i18n 前的多行注释块不会让行号偏移(点名第 N 行的前提)", () => {
  const text = '<!--\nmulti-line\ncomment\n-->\n<div data-i18n="dictionary.gone.key"></div>';
  const problems = judgeHtmlKeys([{ rel: "x.html", text }], new Set());
  assert(problems.length === 1, `应恰一条,实得 ${problems.length}:${problems.join(" | ")}`);
  assert(problems[0]?.startsWith("x.html:5:"), `行号应钉在第 5 行(注释占 1-4 行),实得:${problems[0]}`);
});

/* ---------- ③ 合成根 CLI 档 ---------- */

await suite.case("CLI 合成根:全部键合法 ⇒ exit 0 且打 [ok] 行", () => {
  const root = makeFixtureRoot({
    html: { "src/renderer/index.html": validIndexHtml(), "src/renderer/about.html": validAboutHtml() },
  });
  try {
    const run = runGate(root);
    assert(run.code === 0, `期望 exit 0,实得 ${String(run.code)};stderr:\n${run.stderr}`);
    assert(run.stdout.includes("[ok] renderer HTML data-i18n 通道校验通过"), `未见 [ok] 行;stdout:\n${run.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("CLI 合成根塌缩:renderer 零 HTML ⇒ exit 1 且报「扫描面塌缩」", () => {
  const root = makeFixtureRoot({ emptyRenderer: true });
  try {
    const run = runGate(root);
    assert(run.code === 1, `期望 exit 1,实得 ${String(run.code)};stdout:\n${run.stdout}`);
    assert(run.stderr.includes("扫描面塌缩"), `未见「扫描面塌缩」诊断;stderr:\n${run.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("CLI 合成根:某 HTML 零 data-i18n ⇒ exit 1 且点名该文件", () => {
  const root = makeFixtureRoot({
    html: { "src/renderer/index.html": "<div>nothing i18n here</div>\n", "src/renderer/about.html": validAboutHtml() },
  });
  try {
    const run = runGate(root);
    assert(run.code === 1, `期望 exit 1,实得 ${String(run.code)}`);
    assert(
      run.stderr.includes("src/renderer/index.html") && run.stderr.includes("零 data-i18n* 属性"),
      `未点名零属性文件;stderr:\n${run.stderr}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case('CLI:--help ⇒ exit 0 且打用法', () => {
  const run = runGate(ROOT, ["--help"]);
  assert(run.code === 0, `期望 exit 0,实得 ${String(run.code)}`);
  assert(run.stdout.includes("check-i18n-keys.mjs"), `未见用法;stdout:\n${run.stdout}`);
});

await suite.case("CLI:无法识别的参数 ⇒ exit 1 且报 fail(不为拼错的旗标静默跑一遍判定)", () => {
  const run = runGate(ROOT, ["--bogus"]);
  assert(run.code === 1, `期望 exit 1,实得 ${String(run.code)}`);
  assert(run.stderr.includes("[check-i18n-keys:fail]"), `未见 fail 前缀;stderr:\n${run.stderr}`);
});

for (const mutation of MUTATIONS) {
  await suite.case(mutation.name, async () => {
    await mutation.run();
  });
}

await suite.case("真实仓库门禁本体未被改动且 exit 0(收尾:证明本 selftest 全程只动合成根/变异可还原,没留下残留)", () => {
  const result = spawnSync(process.execPath, [gatePath], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert(result.status === 0, `还原后仍应 exit 0,实得 ${String(result.status)};stderr:\n${result.stderr}`);
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[i18n-keys-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(`[i18n-keys-selftest:fail] data-i18n 通道门禁回归守护失败,共 ${failures.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] i18n-keys-selftest:${cases.length}/${cases.length} 条全绿`);
