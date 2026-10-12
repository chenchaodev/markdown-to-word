// 行尾敏感锚点门禁自身的回归守护(负向夹具 + 真变异)。
//
// check-eol-anchor.mjs 是**读文本判行尾**这一族的唯一机器看守。若它的判定被改坏
// (分隔符从裸 LF 改成容错的 `\r?\n`、C 档读源认不出来、D 档不再认归一、
// B 档空行判定被删),它会**静默地**从「报告真雷」退化成「永远 exit 0」——
// 而这类退化的症状恰好是没人会去看的一个总是绿的脚本。本脚本让每一处退化都判红。
//
// ---- 三层守护,互不替代 ----
// ① **基线档**:真实仓库零未登记命中,且唯一那条豁免**确实命中**(allowHits 对得上)。
//    只断言「零问题」的话,把豁免表的匹配条件改坏也能照样绿 —— 那正是恒绿的一个入口。
// ② **合成根档**:在临时目录里造一棵最小树,把四个已知点的形态逐条写成源码文件,
//    断言门禁逐条报出来;并造「已归一 / 已容错 / 计数 / trim / 合成字符串」的对照,
//    断言它们**零命中**。这一层验的是「判据的窄度」——放宽了判据,对照格先红。
// ③ **真变异档**:真改源文件,跑一遍,再逐字还原,断言每种退化都被抓住。
//    合成根档验的是判定本体的**逻辑**,本档验的是**它真的接在 CLI 上**(出口码、诊断前缀)。
//
// ⚠ **变异窗口内不许并发改动被变异文件**:`finally` 还原之前若有第三方写入,还原会覆盖它。
// 故还原前**先比对**,发现文件已不是本档写进去的那份就**拒绝还原**并判红 ——
// 宁可让本档红着,也不许静默吃掉别人的改动(与 tools/req-edit.mjs 的 TOCTOU 防线同一条理由)。
//
// ⚠ **临时产物必须在 finally 清理**:中途断言失败抛异常时同样要删。
//
// ---- 形态:case 契约接入,不接 harness(ADR-074 决定一)----
// 用 `shared/case.js` 的 `createCaseSuite`,逐档 `await suite.case(档名, …)`。
// 入参是「源码文本 + 仓内相对路径」与「临时树路径」,不是 harness 那张
// 「树型路径 → 正文 + 问题清单正则」的表 —— 塞进去是假接入,故 bespoke 留在原处。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
// 判定本体静态 import:本载体要**逐条调它的纯函数**(合成根档),变异档则走 CLI 子进程
// (变异的是磁盘上的源码,已 import 的这份不受影响 —— 两条路径各验各的,互不替代)。
import {
  analyze,
  judgeText,
  runSelfProbe,
  EXEMPTIONS,
} from "./check-eol-anchor.mjs";

const projectRoot = ROOT;
const checkerRel = "gates/repo/check-eol-anchor.mjs";
const checkerPath = join(projectRoot, ...checkerRel.split("/"));
/** 被变异档改写的真实仓库文件(已知的最实那处形态) */
const subjectRel = "gates/repo/check-changelog.mjs";
const subjectPath = join(projectRoot, ...subjectRel.split("/"));

/**
 * 把折行统一成 LF;再按目标文件**自身**的折行放回去。
 *
 * ⚠ 锚点为什么必须行尾无关:判定本体的检出形态由各端 autocrlf 决定
 * (`* text=auto` + Windows runner 的 `core.autocrlf=true` ⇒ 检出即 CRLF)。
 * 拿 LF 锚点直接去 `includes` 一份 CRLF 源码,恒不命中 —— 而失败形态是「找不到锚点」,
 * 看着像锚点写错了,实则是行尾,于是本地(LF)绿、CI(CRLF)恒红。
 * 手法照 check-samples.selftest.mjs 的同名函数(那处是本仓现成先例)。
 * @param {string} lfText 折行已归一为 LF 的文本
 * @param {string} eol 原文件实际使用的折行
 * @returns {string} 按 `eol` 折行的文本
 */
function withFileEol(lfText, eol) {
  return eol === "\n" ? lfText : lfText.replace(/\n/g, eol);
}

/**
 * 真变异:改一份源文件的正文,跑一遍门禁 CLI,再逐字还原。
 *
 * ⚠ **必须是真改变行为**:断言 `from !== to` 只是最弱的一道闸,真正保证「变异有效」的是
 * 随后的那一格 —— 若改的那段不在判定路径上,门禁会与基线同色,而那一格正是各档断言的内容。
 * @param {string} targetPath 被变异文件绝对路径
 * @param {string} from 原字面量(按 LF 书写)
 * @param {string} to 替换字面量(按 LF 书写)
 * @returns {{ status: number | null, stdout: string, stderr: string, restored: boolean }}
 */
function mutateAndRun(targetPath, from, to) {
  const original = readFileSync(targetPath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const probe = original.replace(/\r\n/g, "\n");
  const anchor = from.replace(/\r\n/g, "\n");
  const replacement = to.replace(/\r\n/g, "\n");
  if (!probe.includes(anchor)) {
    throw new Error(`变异定位失败:${targetPath} 里找不到 ${JSON.stringify(anchor)}`);
  }
  if (from === to) throw new Error("变异是空操作:结论会是假的");
  const mutated = withFileEol(probe.replace(anchor, replacement), eol);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(targetPath, mutated, "utf8");
  /** @type {{ status: number | null, stdout: string, stderr: string, restored: boolean }} */
  let run;
  let restored = false;
  try {
    const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
    run = { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", restored: false };
  } finally {
    // 还原前先比对:文件若已不是本档写进去的那份,说明有第三方在变异窗口内写过它,
    // 还原会覆盖对方的改动 —— 那种情况下宁可判红,也不许静默吃掉。
    const now = readFileSync(targetPath, "utf8");
    if (now === mutated) {
      writeFileSync(targetPath, original, "utf8");
      restored = true;
    }
    run.restored = restored;
  }
  return run;
}

/**
 * 合成根:在临时目录里造一棵最小扫描面。
 * @param {Record<string, string>} files 仓相对 POSIX 路径 → 源码正文(按 LF 书写)
 * @param {"\n" | "\r\n"} [eol] 落盘折行(默认 LF;CRLF 那一档用来复刻真实检出形态)
 * @returns {string} 临时根绝对路径
 */
function makeSyntheticRoot(files, eol = "\n") {
  const root = mkdtempSync(join(tmpdir(), "eol-anchor-selftest-"));
  for (const [rel, source] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, withFileEol(source, eol), "utf8");
  }
  return root;
}

const suite = createCaseSuite();

/* ---------- 档表 ---------- */

/**
 * 已知点的合成形态:每个文件复原真实仓库里那一处的**判定形态**(不必逐字相同,
 * 复现的是「读派生 × 裸 LF × 内容级消费 × 未归一」这四条同时成立的结构)。
 * 形态取自真实命中面(见本脚本头注),不是凭空编的形态。
 *
 * ⚠ **档名(`name`)写在表里而不是拼在 `suite.case(...)` 上**:档名册要能机械抽到它,
 * 而 `inline-case` 那档只认**字面量**首参 —— 写成 `` `已知点判红:${shape.id}` `` 抽出来的
 * 是那段模板原文(含 `${…}`),名册上就成了一条与运行时的档名对不上的假记录。
 * 故 `name` 是字面量,登记表的取名策略相应地是 `table-field: KNOWN_SHAPES.name`。
 */
const KNOWN_SHAPES = Object.freeze([
  {
    name: "已知点判红:空白行判定(CRLF 下恒假;取自 check-changelog)",
    rel: "gates/repo/synthetic-blank-line.mjs",
    consumption: "blank-line",
    source: [
      "export function judge(text) {",
      "  const lines = text.split('\\n');",
      "  const out = [];",
      "  for (let i = 0; i < lines.length; i += 1) {",
      "    if (lines[i] === '') continue;",
      "    out.push(lines[i]);",
      "  }",
      "  return out;",
      "}",
      "export function analyze() {",
      "  return judge(readFileSync('docs/CHANGELOG.md', 'utf8'));",
      "}",
    ].join("\n"),
  },
  {
    name: "已知点判红:逐行漂移比对(两侧只归一了一侧;取自 archive-index/fixtures 的同族)",
    rel: "gates/repo/synthetic-drift.mjs",
    consumption: "elem-equal",
    source: [
      "export function diff(diskText, wantText) {",
      "  const a = diskText.split('\\n');",
      "  const b = wantText.split('\\n');",
      "  return a[0] !== b[0];",
      "}",
      "export function run(indexText, want) {",
      "  return diff(readFileSync(indexText, 'utf8'), want);",
      "}",
    ].join("\n"),
  },
  {
    name: "已知点判红:整行定位(indexOf 一整行;CRLF 下恒不命中)",
    rel: "gates/repo/synthetic-locate.mjs",
    consumption: "line-locate",
    source: [
      "export function at(text) {",
      "  const lines = text.split('\\n');",
      "  return lines.indexOf('| REQ-002 |');",
      "}",
      "export function locate(file) {",
      "  return at(readFileSync(file, 'utf8'));",
      "}",
    ].join("\n"),
  },
  {
    name: "已知点判红:子进程 stdout 逐行定位(与读文件同族的外部文本源)",
    rel: "gates/repo/synthetic-stdout.mjs",
    consumption: "line-locate",
    source: [
      "export function firstStep(result) {",
      "  const lines = result.stdout.split('\\n');",
      "  return lines.indexOf('步骤 1/3');",
      "}",
    ].join("\n"),
  },
  {
    name: "已知点判红:空行过滤回调(.filter((line) => line === ''))",
    rel: "gates/repo/synthetic-filter.mjs",
    consumption: "blank-filter",
    source: [
      "export function blanks(file) {",
      "  const lines = readFileSync(file, 'utf8').split('\\n');",
      "  return lines.filter((line) => line === '').length;",
      "}",
    ].join("\n"),
  },
]);

/** 对照形态:与已知点同族但**不是雷**,断言它们零命中(这一组是判据窄度的护栏)。 */
const SAFE_SHAPES = Object.freeze([
  {
    name: "反向锚点判绿:计数 / 行号换算(CRLF 与 LF 同解)",
    rel: "gates/repo/safe-count.mjs",
    source: [
      "export function lineNo(text, off) {",
      "  return text.slice(0, off).split('\\n').length;",
      "}",
      "export function scan(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  const lines = text.split('\\n');",
      "  for (let i = 0; i < lines.length; i += 1) record(i);",
      "  return lines.length;",
      "}",
    ].join("\n"),
  },
  {
    name: "反向锚点判绿:已容错的分隔符(容错的 CRLF/LF 写法那一族)",
    rel: "gates/repo/safe-tolerated.mjs",
    source: [
      "export function blankLines(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  const lines = text.split(/\\r?\\n/);",
      "  return lines.filter((line) => line === '').length;",
      "}",
      "export function crlf(file) {",
      "  return readFileSync(file, 'utf8').split('\\r\\n')[0];",
      "}",
    ].join("\n"),
  },
  {
    name: "反向锚点判绿:读入侧已归一(D 档两支各一处:赋值上归一 + 接收者表达式上归一)",
    rel: "gates/repo/safe-normalized.mjs",
    source: [
      "export function blankCount(file) {",
      "  const text = readFileSync(file, 'utf8').replace(/\\r\\n/g, '\\n');",
      "  const lines = text.split('\\n');",
      "  return lines.filter((line) => line === '').length;",
      "}",
      "export function drift(indexText, want) {",
      "  const a = normalizeEol(indexText).split('\\n');",
      "  const b = normalizeEol(want).split('\\n');",
      "  return a[0] !== b[0];",
      "}",
      "export function run(indexText, want) {",
      "  return drift(readFileSync(indexText, 'utf8'), want);",
      "}",
    ].join("\n"),
  },
  {
    name: "反向锚点判绿:trim 吃掉行尾 CR 之后的空行判定(取自 repo-manifest 读 .gitignore 那一族)",
    rel: "gates/repo/safe-trim.mjs",
    source: [
      "export function ignores(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  for (const raw of text.split('\\n')) {",
      "    const line = raw.trim();",
      "    if (line === '') continue;",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    name: "反向锚点判绿:合成字符串不经盘(行尾不由 autocrlf 决定)",
    rel: "gates/repo/safe-synthetic.mjs",
    source: [
      "export function synth(name) {",
      "  const lines = `| ${name} |`.split('\\n');",
      "  return lines[0] === '';",
      "}",
    ].join("\n"),
  },
]);

/* ---------- ① 基线档:真实仓库 ---------- */

const baseline = analyze();
console.log(
  `[eol-anchor-selftest] 基线:真实仓库 ${baseline.files} 个文件 / ${baseline.splits} 处裸 LF split`,
);

await suite.case("真实仓库零未登记命中(豁免表扣完之后)", () => {
  assert(
    baseline.problems.length === 0,
    `真实仓库有 ${baseline.problems.length} 项未登记命中:`
      + baseline.problems.map((hit) => `${hit.file}:${hit.line}/${hit.consumption}`).join(" "),
  );
});

await suite.case("豁免条目确实命中(否则「零问题」只是豁免匹配坏掉的假绿)", () => {
  assert(
    baseline.allowHits > 0,
    "豁免表一条都没命中 —— 要么豁免条件写坏(恒绿入口),要么真实命中被静默放过,两个方向都要查",
  );
  assert(
    baseline.allowHits === EXEMPTIONS.length,
    `豁免 ${EXEMPTIONS.length} 条本次命中 ${baseline.allowHits} 条,须逐条相等`,
  );
});

await suite.case("豁免表零失效条目(失效条目要么雷被收了、要么判据漂了)", () => {
  assert(
    baseline.staleAllow.length === 0,
    `零命中的豁免条目:${baseline.staleAllow.join(" ")}(该删或该查,不许留着装样子)`,
  );
});

await suite.case("内建探针全过(探针是判据本身的回归测试,不是装饰)", () => {
  const failed = runSelfProbe().filter((item) => !item.ok);
  assert(failed.length === 0, `探针未过:${failed.map((item) => `${item.id}(${item.detail})`).join(" ")}`);
});

await suite.case("CLI 在未变异的真实仓库上 exit 0 且打 [ok] 行", () => {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
  assert(result.status === 0, `期望 exit 0,实得 ${result.status};stderr:${result.stderr}`);
  assert(
    (result.stdout ?? "").includes("[ok] 行尾敏感锚点扫描通过"),
    `未见 [ok] 行;stdout:${result.stdout}`,
  );
});

/* ---------- ② 合成根档:判据的窄度 ---------- */

for (const shape of KNOWN_SHAPES) {
  await suite.case(shape.name, () => {
    const hits = judgeText(shape.source, shape.rel);
    assert(hits.length > 0, `形态未被判红:${shape.name}(${shape.rel})`);
    assert(
      hits.some((hit) => hit.consumption === shape.consumption),
      `命中了但消费形态不对:期望 ${shape.consumption},实得 ${hits.map((hit) => hit.consumption).join(",")}`,
    );
  });
}

for (const shape of SAFE_SHAPES) {
  await suite.case(shape.name, () => {
    const hits = judgeText(shape.source, shape.rel);
    assert(hits.length === 0, `不该命中却命中了:${shape.name} → ${hits.map((h) => `${h.line}/${h.consumption}`).join(" ")}`);
  });
}

await suite.case("合成根逐条报齐(判定本体 + 豁免表 + CLI 输出这一整条链)", () => {
  const files = {};
  for (const shape of KNOWN_SHAPES) files[shape.rel] = shape.source;
  const root = makeSyntheticRoot(files);
  try {
    const result = analyze({ root });
    // 断言按**文件**核对而不是按条数:一个形态可能命中两处(split 的接收者两侧都是裸 LF 时,
    // 「哪一行不同」的逐行比对会把两侧各报一条 —— 那是两条真事实,不是重复)。
    for (const shape of KNOWN_SHAPES) {
      assert(
        result.problems.some((hit) => hit.file === shape.rel && hit.consumption === shape.consumption),
        `合成根未报出已知点:${shape.rel} 期望 ${shape.consumption},`
          + `实得 ${result.problems.filter((hit) => hit.file === shape.rel).map((hit) => hit.consumption).join(",") || "(零)"}`,
      );
    }
    assert(
      result.problems.length >= KNOWN_SHAPES.length,
      `合成根应至少报 ${KNOWN_SHAPES.length} 项,实得 ${result.problems.length}`,
    );
    assert(
      result.files === KNOWN_SHAPES.length,
      `扫描面应恰为 ${KNOWN_SHAPES.length} 个文件,实得 ${result.files}(walker 的失效方向是「少扫」)`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("合成根以 CRLF 落盘(复刻 Windows runner 的检出形态)结论不变", () => {
  // 判据读的是**源码文本**,与该源码自身的折行无关 —— 这一格钉住的是变异窗口内的锚点定位
  // 必须行尾无关(见 withFileEol):否则本地(LF)绿、CI(CRLF)恒红,而失败形态是
  // 「找不到锚点」,看着像锚点写错了。
  const files = {};
  for (const shape of KNOWN_SHAPES) files[shape.rel] = shape.source;
  const root = makeSyntheticRoot(files, "\r\n");
  try {
    const result = analyze({ root });
    for (const shape of KNOWN_SHAPES) {
      assert(
        result.problems.some((hit) => hit.file === shape.rel && hit.consumption === shape.consumption),
        `CRLF 落盘后未报出已知点:${shape.rel}`,
      );
    }
    assert(
      result.problems.length >= KNOWN_SHAPES.length,
      `CRLF 落盘后应至少报 ${KNOWN_SHAPES.length} 项,实得 ${result.problems.length}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("对照形态落进合成根也零命中(窄度是走整条链验的,不是只验判定本体)", () => {
  const files = {};
  for (const shape of SAFE_SHAPES) files[shape.rel] = shape.source;
  const root = makeSyntheticRoot(files);
  try {
    const result = analyze({ root });
    assert(
      result.problems.length === 0,
      `对照形态被判红:${result.problems.map((hit) => `${hit.file}:${hit.line}/${hit.consumption}`).join(" ")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------- ③ 真变异档:退化必须被抓住 ---------- */

const MUTATIONS = [
  {
    name: "变异① 往真实文件里注入一处未登记的裸 LF 内容锚 ⇒ 必须判红",
    target: "subject",
    from: "  const lines = text.split('\\n');",
    to: "  const lines = text.split('\\n');\n  if (lines.indexOf('## [待发版]') === -1) return null;",
    expect: "red",
  },
  {
    name: "变异② 已知点改成已容错的 CRLF/LF 分隔符 ⇒ 必须判绿(证明判据只对裸 LF 敏感)",
    target: "subject",
    from: "  const lines = text.split('\\n');",
    to: "  const lines = text.split(/\\r?\\n/);",
    expect: "green",
  },
  {
    name: "变异③ 已知点改成迁就检出的 CRLF 分隔符 ⇒ 必须判绿",
    target: "subject",
    from: "  const lines = text.split('\\n');",
    to: "  const lines = text.split('\\r\\n');",
    expect: "green",
  },
  {
    name: "变异④ 真修法:已知点的判定点改走 trim ⇒ 必须判绿(证明正路修法能过门禁)",
    target: "subject",
    from: "    if (lineSource === '') continue;",
    to: "    if (lineSource.trim() === '') continue;",
    expect: "green",
  },
  {
    name: "变异⑤ D 档失效:归一原语不再被认出 ⇒ 探针先判红(归一是真在起作用的)",
    target: "checker",
    from: "export const NORMALIZE_RE = /normalizeEol|replace\\(\\s*\\/\\\\r(?:\\\\n|\\?\\\\n|)\\/g/;",
    to: "export const NORMALIZE_RE = /(?:)/;",
    expect: "red-probe",
  },
  {
    name: "变异⑥ C 档失效:读文本原语认不出来 ⇒ 探针先判红(证明它不是「见 split 就红」)",
    target: "checker",
    from: "\\b(?:readFileSync|readFile|readFileSyncUtf8)\\s*\\(",
    to: "\\b(?:__never__readFileSync|readFile|readFileSyncUtf8)\\s*\\(",
    expect: "red-probe",
  },
  {
    name: "变异⑦ A 档失效:分隔符改成容错的 CRLF 写法 ⇒ 探针先判红(防空门禁的那道闸真在)",
    target: "checker",
    from: "\\s*\\.\\s*split\\(\\s*(['\"])\\\\n\\3\\s*\\)",
    to: "\\s*\\.\\s*split\\(\\s*(['\"])\\\\r\\\\n\\3\\s*\\)",
    expect: "red-probe",
  },
];

for (const mutation of MUTATIONS) {
  await suite.case(mutation.name, () => {
    const targetPath = mutation.target === "checker" ? checkerPath : subjectPath;
    const run = mutateAndRun(targetPath, mutation.from, mutation.to);
    assert(run.restored, `变异窗口内 ${targetPath} 被第三方改过,本档拒绝还原(否则会吃掉别人的改动)`);
    if (mutation.expect === "green") {
      assert(run.status === 0, `期望判绿,实得 exit ${run.status};stderr:${run.stderr}`);
      return;
    }
    assert(run.status === 1, `期望 exit 1,实得 ${run.status};stderr:${run.stderr}`);
    if (mutation.expect === "red-probe") {
      assert(
        run.stderr.includes("self-probe:fail"),
        `期望失败点在自检探针上(判据本体坏了),实得:\n${run.stderr}`,
      );
    } else {
      assert(
        run.stderr.includes("[eol-anchor:fail]"),
        `未见诊断前缀 [eol-anchor:fail];stderr:\n${run.stderr}`,
      );
      assert(
        !run.stderr.includes("self-probe:fail"),
        `注入的是真实命中,不该由探针先拦;stderr:\n${run.stderr}`,
      );
    }
  });
}

await suite.case("变异全部还原后 CLI 复绿(收尾那一格:证明前面每一档都没留下残留)", () => {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
  assert(result.status === 0, `还原后仍应 exit 0,实得 ${result.status};stderr:${result.stderr}`);
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (suite.hasFailures) {
  for (const failure of failures) {
    console.error(`[eol-anchor-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(`[eol-anchor-selftest:fail] ${failures.length}/${cases.length} 条不通过`);
  process.exit(1);
}
console.log(`[ok] eol-anchor-selftest:${cases.length}/${cases.length} 条全绿`);