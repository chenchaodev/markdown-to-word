/**
 * `gen-gate-ids-table` 的负向夹具：把「对账表 ↔ JSON 漂移」这条判据钉在合成数据上。
 *
 * ⚠️ **全部夹具都在临时目录里跑**，不读也不写真实工作树 —— 否则这条判据自己就退化成
 * 「只测真实文件」的恒绿判据（真实文件永远一致 ⇒ 永远绿）。
 * ⚠️ 形态：**夹具自身失败必须报错而不是静默绿**（每档都断言 `problems` 非空且含预期片段）。
 *
 * 用例登记走 `shared/case.js` 的 case 契约（ADR-074 决定一）：`createCaseSuite` 建 suite、
 * 逐条 `suite.case(...)` 登记，**case 内抛错只记该 case 失败、不中断后续 case** ——
 * 一次跑完可见全部失败面，不必反复重跑定位。case 名是名册对账的键，故逐字沿用搬迁前的
 * `fixture()` 用例名。**为什么门禁侧接的是 `shared/case.js` 而不是 `test/harness/case.js`**：
 * `gates-stay-in-gates` 的允许面只有 `gates` / `shared` / `test/fixtures`，`test/` 整棵树不在其中。
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { judgeDrift, renderTable } from "./gen-gate-ids-table.mjs";

/**
 * 恒绿防护（顺序不可换）：**先断 `problems` 非空，再断命中预期片段。**
 * 反过来写，判据一旦退化成「零问题时直接判绿」，零扫描面下就整条恒绿。
 * @param {string} label 该档的短标签（进失败消息）
 * @param {unknown} got `judgeDrift(...).problems`
 * @param {string[]} mustContain 必须在 problems 里命中的片段（逐条断）
 * @returns {void}
 */
function expectProblems(label, got, mustContain) {
  assert(
    Array.isArray(got) && got.length > 0,
    `${label}：期望有 problems，实际为空（恒绿防护：这条判据在该情形下没有生效）`,
  );
  assert(Array.isArray(got), `${label}：judgeDrift 未返回数组`);
  for (const frag of mustContain) {
    assert(
      got.some((p) => p.includes(frag)),
      `${label}：problems 里找不到「${frag}」；实得 ${JSON.stringify(got)}`,
    );
  }
}

/**
 * 判绿档的断言：`judgeDrift` 必须返回数组，且长度为零。
 * @param {string} label 该档的短标签（进失败消息）
 * @param {unknown} got `judgeDrift(...).problems`
 * @returns {void}
 */
function expectClean(label, got) {
  assert(Array.isArray(got), `${label}：judgeDrift 未返回数组`);
  assert(!Array.isArray(got) || got.length === 0, `${label}：期望零 problems，实得 ${JSON.stringify(got)}`);
}

const BASE = {
  _comment: "夹具用对账表（（说明））",
  _schema: { stateMeaning: { exists: "完全承接", partial: "部分承接", "to-create": "无承接" }, note: "⚠️ 夹具" },
  families: [
    { id: "fixtures", probeLines: 119, capability: "c", successor: "a.js", successorState: "exists", lost: "不丢", fix: "f", severity: "中", blocksP6: false },
    { id: "coverage", probeLines: 271, capability: "c", successor: "b.js", successorState: "partial", lost: "丢一格", fix: "f", severity: "低", blocksP6: false },
    { id: "dist-manifest", probeLines: 99, capability: "c", successor: "c.js", successorState: "exists", lost: "不丢", fix: "f", severity: "低", blocksP6: false },
    { id: "dual-matrix", probeLines: 194, capability: "c", successor: "d.js", successorState: "partial", lost: "丢一格", fix: "f", severity: "中高", blocksP6: false },
    { id: "build-fresh", probeLines: 0, capability: "c", successor: "e.js", successorState: "exists", lost: "不丢", fix: "f", severity: "中高", blocksP6: false },
    { id: "smoke", probeLines: 196, capability: "c", successor: "f.js", successorState: "partial", lost: "丢一格", fix: "f", severity: "高", blocksP6: true },
    { id: "registry", probeLines: 452, capability: "c", successor: "g.js", successorState: "exists", lost: "不丢", fix: "f", severity: "低", blocksP6: false },
  ],
};

function sandbox(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-ids-selftest-"));
  const jsonPath = path.join(dir, "handoff.json");
  const mdPath = path.join(dir, "table.md");
  const data = structuredClone(BASE);
  const changed = mutate ? mutate(data) : null;
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");
  writeFileSync(mdPath, changed === null ? renderTable(data) : changed, "utf8");
  return { dir, jsonPath, mdPath };
}

const suite = createCaseSuite();

await suite.case("夹具自身可用：临时目录建成且两文件可读", () => {
  const s = sandbox();
  try { expectClean("基线", judgeDrift(s).problems); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("md 被改一行 ⇒ 判红并指向「不一致 / 勿手改」", () => {
  const s = sandbox((d) => renderTable(d) + "\n<!-- 手写的一行 -->\n");
  try { expectProblems("漂移", judgeDrift(s).problems, ["不一致", "勿手改"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("md 整体被换成另一份 ⇒ 判红（防「只比对首行」的实现）", () => {
  const s = sandbox(() => "# 另一份表\n\n完全无关的内容\n");
  try { expectProblems("整体替换", judgeDrift(s).problems, ["不一致"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("successorState 取值非法 ⇒ 判红并给出合法域", () => {
  const s = sandbox((d) => { d.families[0].successorState = "随手记"; return null; });
  try { expectProblems("非法取值", judgeDrift(s).problems, ["successorState 非法", "随手记", "合法域"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("successorState=exists 却 blocksP6=true ⇒ 判红「自相矛盾」", () => {
  const s = sandbox((d) => { d.families[0].blocksP6 = true; return null; });
  try { expectProblems("自相矛盾", judgeDrift(s).problems, ["自相矛盾", "blocksP6=true"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("族数 ≠ 7 ⇒ 判红「恰好 7 族」（防增删族漏同步对账表）", () => {
  const s = sandbox((d) => { d.families.pop(); return null; });
  try { expectProblems("族数", judgeDrift(s).problems, ["恰好 7 族"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("缺 successor 字段 ⇒ 判红（防「无承接者」悄悄混过去）", () => {
  const s = sandbox((d) => { delete d.families[2].successor; return null; });
  try { expectProblems("缺 successor", judgeDrift(s).problems, ["缺 successor"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("JSON 读不到 ⇒ 判红（不得静默按「无漂移」处理）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-ids-selftest-"));
  try {
    expectProblems("JSON 缺失", judgeDrift({ jsonPath: path.join(dir, "nope.json"), mdPath: path.join(dir, "nope.md") }).problems, ["判据读不到"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await suite.case("JSON 不是合法 JSON ⇒ 判红", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-ids-selftest-"));
  try {
    writeFileSync(path.join(dir, "handoff.json"), "{ 这不是 json", "utf8");
    writeFileSync(path.join(dir, "table.md"), "x", "utf8");
    expectProblems("非法 JSON", judgeDrift({ jsonPath: path.join(dir, "handoff.json"), mdPath: path.join(dir, "table.md") }).problems, ["判据读不到"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await suite.case("md 读不到 ⇒ 判红（不得静默跳过比对）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-ids-selftest-"));
  try {
    writeFileSync(path.join(dir, "handoff.json"), JSON.stringify(BASE), "utf8");
    expectProblems("md 缺失", judgeDrift({ jsonPath: path.join(dir, "handoff.json"), mdPath: path.join(dir, "nope.md") }).problems, ["读不到"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await suite.case("checkMd:false ⇒ 只做结构校验、不比对 md（写盘模式不得被漂移死锁）", () => {
  const s = sandbox(() => "# 完全不同的表\n");
  try { expectClean("写盘模式", judgeDrift({ jsonPath: s.jsonPath, mdPath: s.mdPath, checkMd: false }).problems); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

await suite.case("checkMd:false 下结构问题仍要判红（写盘模式不是免检通道）", () => {
  const s = sandbox((d) => { d.families[0].successorState = "随手记"; return null; });
  try { expectProblems("写盘模式结构", judgeDrift({ jsonPath: s.jsonPath, mdPath: s.mdPath, checkMd: false }).problems, ["非法"]); } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

// -------------------------------------------------------------------------------------
// 汇总:段级成败按 case 结果判(等价于搬迁前的 `failures[]` 判定:任一 case 失败即非零退出)。
// -------------------------------------------------------------------------------------

const cases = suite.results;
const failed = suite.failures;
if (failed.length > 0) {
  for (const failure of failed) console.error(`  · ${failure.name}：${failure.message ?? "(无失败消息)"}`);
  console.error(`[gen-gate-ids-table.selftest:fail] ${failed.length}/${cases.length} 条夹具不符合预期`);
  process.exit(1);
}
console.log(`[ok] gen-gate-ids-table-selftest:${cases.length} 条夹具全部符合预期`);