/**
 * 由 `gates/repo/gate-ids-交接.json` 生成 P6 的「7 个 GATE_IDS 对账表」markdown，并判定两者是否漂移。
 *
 * 为什么要有这个脚本：那份对账表是 `ADR-062:246` 的**前置硬门**，而它的机器可核 companion 是
 * JSON。**两份若各写一遍必然漂移** —— 起草过程中已发生过一次（执行方翻了 JSON 的
 * `successorState` 却没清 `blocksP6`，md 仍写着旧值）。
 *
 * 用法：`node gates/repo/gen-gate-ids-table.mjs` 写盘；`--check` 只判定不写（接进 `verify:ci`）。
 */
import { readFileSync, writeFileSync } from "node:fs";

export const JSON_REL = "gates/repo/gate-ids-交接.json";
export const MD_REL = "docs/evidence/20261004-225514-gate-ids-对账表.md";
const STATE_LABEL = { exists: "**完全承接**", partial: "**部分承接**", "to-create": "⛔ **无承接**" };
const BLOCK_LABEL = { true: "⛔ 阻塞 P6", false: "不阻塞", verify: "⚠️ S1 需核实" };

export function renderTable(j) {
  const L = [];
  L.push(`# ${j._comment.split("（")[0].trim()}（markdown 版）`, "");
  L.push("> 结论去向：升 adr/ADR-062 ｜ 决策正文见 [`ADR-062-测试树位置即身份与门禁元框架瘦身`](../adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md)");
  L.push(">");
  L.push(`> **本文件是 \`ADR-062:246\` 那条「前置硬门」的产物：P6 删沙盒层之前，必须先把当前 7 个 \`GATE_IDS\` 逐个对账清楚。** 机器可核的 companion 是 [\`${JSON_REL}\`](../../${JSON_REL}) —— **本文件由 \`gates/repo/gen-gate-ids-table.mjs\` 从那份 JSON 单向生成**（\`npm run gen:gate-ids-table\`；\`npm run check:gate-ids-table\` 只判定）。**不要手改本表**，改 JSON 后重新生成。`, "");
  L.push("## 为什么这份表只在删除之前有价值", "");
  L.push("`ADR-062:281` 写「回滚 P6 前先确认对账表仍在且全绿」，`:285` 写「唯一不可 `git revert` 的是删除动作」。⇒ **S4 删掉沙盒层之后，本表就从「保险」退化成一份历史文档。**", "");
  L.push("## `successorState` 是**能力承接度**，不是「文件在不在」", "");
  for (const [k, v] of Object.entries(j._schema.stateMeaning)) L.push(`- \`${k}\` —— ${v}`);
  L.push("", `⚠️ ${j._schema.note.split("⚠️ ")[1]}`, "");
  L.push("## 逐族对账", "");
  L.push("| GATE_ID | 现有探针能力（实测行数） | P6 后承接者 | 承接度 | 能力是否丢失 | 负向夹具怎么改 | 严重度 | 阻塞 |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const f of j.families) {
    const pr = f.probeLines > 0 ? `（${f.probeLines} 行）` : "";
    L.push(`| \`${f.id}\` | ${f.capability}${pr} | \`${f.successor}\` | ${STATE_LABEL[f.successorState]} | ${f.lost} | ${f.fix} | ${f.severity} | ${BLOCK_LABEL[String(f.blocksP6)]} |`);
  }
  const by = {};
  j.families.forEach((f) => { by[f.successorState] = (by[f.successorState] || 0) + 1; });
  const blocking = j.families.filter((f) => f.blocksP6 === true);
  L.push("", "## 汇总", "");
  L.push(`- **承接度分布**：\`exists\` ${by.exists} ／ \`partial\` ${by.partial} ／ \`to-create\` ${by["to-create"] || 0}（共 ${j.families.length} 族）`);
  L.push(`- **⛔ 阻塞 P6 的 ${blocking.length} 项**：${blocking.length ? blocking.map((f) => `\`${f.id}\``).join("、") : "无"} —— 按 \`ADR-062:250\`「任何一道门禁若无载体，先补 \`.selftest.mjs\`，本阶段才允许开始」，**这些项补齐前不得进入 S4（删除步骤）**`);
  const verify = j.families.filter((f) => f.blocksP6 === "verify");
  if (verify.length) L.push(`- ⚠️ **待核实的 ${verify.length} 项**：${verify.map((f) => `\`${f.id}\``).join("、")}`);
  L.push("", "## 起草过程中被实测推翻的四处（留档，防后人重犯）", "");
  L.push("1. **「`build-fresh` 的诊断含具体文件名」—— 当初是假的。** 该门禁诊断恒为固定文案、不含文件名，而这是**主会话转述方案评审的未核实断言**。现已由 S1d 的**接口变更**落地（`collectStaleFiles` ＋ `STALE_FILE_LIST_LIMIT`），那一格不再是「不假装断言」。");
  L.push("2. **「`registry.mjs` 只许改 `PROBE_CARRIER_SCRIPTS`」—— 这条约束站不住。** R3 的反向检查要求每个 carrier **必须被某道门禁的 `probes[]` 认领**，否则判 `probe-carrier-orphan`；只登记 carrier 实测得 2 条 orphan。S1a 因此在 `GATE_REGISTRY.fixtures` 与 `GATE_REGISTRY[\"build-fresh\"]` 的 `probes[]` 各加一条认领项。");
  L.push("3. **`blocksP6` 与 `successorState` 可以自相矛盾。** S1a 执行方翻了 `successorState` 却没清 `blocksP6` ⇒「完全承接」与「阻塞删除」并存。`judgeDrift` 已把这一格做成判据。");
  L.push("4. **`ADR-062:78` 的 L8 定义与实装不符。** 那里写「`test/harness/*.test.js` 必须与同目录 `*.js`/`.mjs` 同名」，而实装的 `test-harness-not-segment` 是「**必须声明 `covers` 且至少一个元素指向本层**」（T5-a 改的）。按 ADR 字面查会得出「四个 harness 段的模块全不同名 ⇒ L8 全红」的**假结论** —— 实测四段的模块分别是 `runner.js`／`assert.js`+`temp-resource.js`+`case.js`／`dual-pipeline-registry.js`，**本就不该同名**。ADR 那一行待订正。", "");
  L.push("## 未跑 / 不在范围", "");
  L.push("- **未跑** `npm test` / `verify:ci` / 任何聚合门禁链（本表是数据与文档，不含断言）");
  L.push("- 本表所有行数与存在性均为**实测**，非转述评审", "");
  return L.join("\n");
}

/**
 * 判定本体。**IO 全经入参**（`jsonPath` / `mdPath`），故 selftest 能在临时目录上跑，
 * 不必碰真实工作树 —— 否则这条漂移判据自己就成了「只测真实文件」的恒绿判据。
 * @returns {{problems: string[], families: number}}
 */
export function judgeDrift({ jsonPath, mdPath, checkMd = true }) {
  const problems = [];
  let j;
  try {
    j = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (error) {
    problems.push(`判据读不到 ${JSON_REL} 或不是合法 JSON：${error.message}`);
    return { problems, families: 0 };
  }
  if (!j || !Array.isArray(j.families)) {
    problems.push(`${JSON_REL} 缺 families 数组`);
    return { problems, families: 0 };
  }
  if (j.families.length !== 7) problems.push(`对账表必须恰好 7 族，实际 ${j.families.length}`);
  for (const fam of j.families) {
    if (!fam.successor) { problems.push(`${fam.id} 缺 successor 字段`); continue; }
    if (!STATE_LABEL[fam.successorState]) {
      problems.push(`${fam.id} 的 successorState 非法：${String(fam.successorState)}（合法域 ${Object.keys(STATE_LABEL).join(" / ")}）`);
      continue;
    }
    if (fam.successorState === "exists" && fam.blocksP6 === true) {
      problems.push(`${fam.id} 自相矛盾：successorState=exists 却 blocksP6=true`);
    }
  }
  if (!checkMd) return { problems, families: j.families.length };
  let expected = "";
  try {
    expected = renderTable(j);
  } catch (error) {
    problems.push(`由 JSON 渲染表格失败：${error.message}`);
    return { problems, families: j.families.length };
  }
  let cur = "";
  try {
    cur = readFileSync(mdPath, "utf8");
  } catch (error) {
    problems.push(`读不到 ${MD_REL}：${error.message}`);
    return { problems, families: j.families.length };
  }
  if (cur !== expected) problems.push("对账表与 JSON 不一致，跑 `npm run gen:gate-ids-table` 重生成（勿手改）");
  return { problems, families: j.families.length };
}

export function main(argv = []) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("用法: node gates/repo/gen-gate-ids-table.mjs [--check] [--help]");
    console.log("  默认写盘生成对账表；--check 只判定不写（接进 verify:ci）");
    return 0;
  }
  const check = argv.includes("--check");
  const { problems, families } = judgeDrift({ jsonPath: JSON_REL, mdPath: MD_REL, checkMd: check });
  for (const p of problems) console.error(`[gen-gate-ids-table:fail] ${p}`);
  if (problems.length > 0) {
    console.error(`[gen-gate-ids-table:fail] 判定未通过，共 ${problems.length} 项`);
    return 1;
  }
  if (check) {
    console.log(`[ok] 对账表与 ${JSON_REL} 一致：${families} 族`);
    return 0;
  }
  const j = JSON.parse(readFileSync(JSON_REL, "utf8"));
  writeFileSync(MD_REL, renderTable(j), "utf8");
  const blocking = j.families.filter((f) => f.blocksP6 === true).map((f) => f.id);
  console.log(`[ok] 已生成 ${MD_REL}：${families} 族（⛔ 阻塞 P6: ${blocking.join(", ") || "无"}）`);
  return 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("gen-gate-ids-table.mjs");
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
