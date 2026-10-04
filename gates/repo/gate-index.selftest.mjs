// 门禁索引(gates/repo/gate-index.mjs)自身的回归守护。
//
// ⚠ **本载体守的是「表」不是「判定面」**:L11 / L11b / L12 三条判据住在
// `check-test-layout.mjs` 里,它们的负向夹具在 `check-test-layout.selftest.mjs`。
// 本载体只钉四件事(ADR-062 S3 的双跑并存期):
//   ① **双跑一致性**:新旧两张表在共有字段上逐条相等、且 id 集合完全一致;
//   ② **`enforcement` 指针真能 `import()` 到**且导出名存在;
//   ③ **禁自指**:没有一条 `enforcement` 指向本表自身;
//   ④ **`access` 取值域两值**:`gate-index.mjs` 里零个 S3 的旧取值。
//
// ---- 为什么「审计」住在载体里、不住在表里 ----
// `gate-index.mjs` 是**零 import 的纯数据表**(它必须零 import:一旦它自己会 `import()` 别处,
// 「禁自指」这条规则要防的死锁就落在它头上了)。给它加一个会 `import()` 的审计函数 = 让数据表
// 做 IO,而那个 IO 恰好就是它必须避免的形态。
//
// 而这个审计**不需要别的消费者**:ADR-062 P6 的判据面就是 L11 + L12 两条(S4 之后也是),
// 「索引自身的指针完整性」不在那两条的语义内。载体是它唯一的执行者,而载体在链上(R5c 强制),
// 所以「有人删了 `enforcement` 或把它指错」这件事仍然会红。
//
// ⚠ **不修改被测表、也不复制它**:夹具里出现的是**合成表**(纯对象字面量),真实表只被**读**。
// 与 `check-test-layout.selftest.mjs` 的合成根不同构 —— 这一族的面是「两个模块导出的两张表 +
// 若干条指针」,磁盘上什么都没有,故本载体**零 IO、零临时目录**。
//
// ⚠ **恒绿防护**:① 只断「两表相等」的话,一个恒返回「相等」的比较器能过 —— 故每条不一致
// 都**点名**是哪个字段、哪个 id 不一致(§④ 的夹具族逐条证明这一点);② 只断「指针能 import」
// 的话,把 `enforcement` 整条删掉(0 条指针)会全绿 —— 故 §④ 有一格断言**指针条数非零**且
// 逐条点名是哪几道门禁带的。

import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT } from "../../shared/paths.js";
import { GATE_INDEX, GATE_INDEX_MODULE_REL } from "./gate-index.mjs";
import { GATE_REGISTRY } from "../probe/gate-probes/registry.mjs";

const projectRoot = ROOT;

/* ---------- 审计函数(纯函数 + 可注入 loader,便于合成表夹具) ---------- */

/**
 * 取一张表的 `id → 条目` 映射(按 `id` 而非表键 —— 表键是人的选择,`id` 是被比对的语义)。
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @returns {Map<string, object>} id → 条目
 */
function byId(table) {
  return new Map(
    Object.values(table).map((entry) => [/** @type {string} */ (entry.id), entry]),
  );
}

/**
 * 双跑一致性审计:新旧两张表在共有字段上逐条相等,且 id 集合完全一致。
 *
 * **逐条点名而不是只回一个布尔**:「两表相等」这句话在实现退化成恒真时同样成立,而读者无从
 * 判断是哪个字段、哪个 id 出了事。所有 problems 都带 id 与字段名。
 *
 * ⚠ **`judgment` 的比较有一处刻意的例外**(旧表 `gate-probes` 那项的 `judgment` 是**函数字面量**,
 * 没有 `.module` 可比):那一条改比「新表的 `judgment.module` == 旧表的 `modulePath`」——
 * 依据是旧表自己在 `fallbackSelfEntry()` 里逐字写的那个兜底指针(它证明「内联判定体就住在
 * 这道门禁的 `modulePath` 所指模块里」)。这一例外**逐条点名**,不静默跳过。
 *
 * @param {Readonly<Record<string, object>>} newer 新表(`gate-index.mjs`)
 * @param {Readonly<Record<string, object>>} older 旧表(`registry.mjs`)
 * @returns {string[]} problems(空数组 = 一致)
 */
export function auditDualRunConsistency(newer, older) {
  /** @type {string[]} */
  const problems = [];
  const a = byId(newer);
  const b = byId(older);
  const onlyNew = [...a.keys()].filter((id) => !b.has(id)).sort();
  const onlyOld = [...b.keys()].filter((id) => !a.has(id)).sort();
  if (onlyNew.length > 0) {
    problems.push(
      `新表多出 ${onlyNew.length} 项而旧表没有:${onlyNew.join(", ")}`
      + " —— 有人加了门禁没同步旧表(旧表 S4 才删,在那之前两表必须逐条对得上)",
    );
  }
  if (onlyOld.length > 0) {
    problems.push(`旧表有而新表缺 ${onlyOld.length} 项:${onlyOld.join(", ")} —— 索引里出现了孤儿登记项`);
  }
  for (const [id, entry] of a) {
    const other = b.get(id);
    if (other === undefined) continue;
    // `npmScripts` 逐元素比(含顺序):顺序即「接入点代表脚本在前」的语义,`judgeL12ChainMembership`
    // 取 `npmScripts[0]`。只比集合会让「谁在前面」这件事无人守。
    const mine = /** @type {readonly string[]} */ (entry.npmScripts);
    const theirs = /** @type {readonly string[]} */ (other.npmScripts);
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      problems.push(`${id}:npmScripts 不等 —— 新表 [${mine.join(", ")}] vs 旧表 [${theirs.join(", ")}]`);
    }
    if (entry.modulePath !== other.modulePath) {
      problems.push(`${id}:modulePath 不等 —— 新表 ${String(entry.modulePath)} vs 旧表 ${String(other.modulePath)}`);
    }
    const judgment = /** @type {{ module?: string }} */ (entry.judgment);
    const theirJudgment = other.judgment;
    if (typeof theirJudgment === "function") {
      // 内联判定体:没有 `.module`。比「新表指针 == 旧表 modulePath」,依据见本函数注释。
      if (judgment.module !== other.modulePath) {
        problems.push(
          `${id}:旧表这一项的 judgment 是内联函数(无 .module 可比),新表应指向它的 modulePath`
          + ` ${String(other.modulePath)},实际 ${String(judgment.module)}`,
        );
      }
      continue;
    }
    if (judgment.module !== theirJudgment.module) {
      problems.push(
        `${id}:judgment.module 不等 —— 新表 ${String(judgment.module)} vs 旧表 ${String(theirJudgment.module)}`,
      );
    }
  }
  return problems;
}

/**
 * `access` 取值域审计:只允许 `chain` / `offchain`,且至少要有一项(全空表是恒绿形态)。
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {readonly string[]} legacyValues S3 的旧取值(判红并点名)
 * @returns {string[]} problems(空数组 = 合法)
 */
export function auditAccessDomain(table, legacyValues) {
  /** @type {string[]} */
  const problems = [];
  const entries = Object.values(table);
  if (entries.length === 0) problems.push("表为空:零项登记意味着 L11/L12 两族在零判定面上全绿(恒绿形态)");
  for (const entry of entries) {
    const access = /** @type {string} */ (entry.access);
    if (access === "chain" || access === "offchain") continue;
    const legacy = legacyValues.includes(access);
    problems.push(
      `${String(entry.id)}:access 取值「${access}」不在两值域内`
      + `${legacy ? "(S3 的旧取值,gate-index.mjs 应收成 offchain)" : ""}`,
    );
  }
  return problems;
}

/**
 * `enforcement` 指针审计:① 禁自指;② 形态是 `<模块相对路径>#<导出名>`;③ 指针真能解析。
 *
 * ⚠ **自指检查与解析检查分成两档**:自指是**纯文本**判定(不需要 import),所以它在
 * `load === undefined` 的注入下仍能跑 —— 负向夹具正是靠这一点造出「一条自指指针」的合成表,
 * 而那个夹具若也去 `import()` 本表就会真的把自己 import 进来(在合成根上它会失败,而失败原因
 * 与「自指」无关,症状离根因隔着一层)。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {object} [options]
 * @param {(modulePath: string) => Promise<unknown>} [options.load] 指针解析器(注入面:
 *   负向夹具给一个恒「解析不到」的替身,不真的去 import)
 * @returns {Promise<string[]>} problems(空数组 = 全部指针合法)
 */
export async function auditEnforcementPointers(table, options = {}) {
  /** @type {string[]} */
  const problems = [];
  const entries = Object.values(table);
  for (const entry of entries) {
    const id = /** @type {string} */ (entry.id);
    const pointer = /** @type {string | undefined} */ (entry.enforcement);
    if (pointer === undefined) continue;
    // ---- ① 禁自指(纯文本档)----
    if (pointer.startsWith(`${GATE_INDEX_MODULE_REL}#`)) {
      problems.push(
        `${id}:enforcement 指向本表自身(${pointer})—— 解析它要 import 本表,而本表是数据表;`
        + "自指还会让「表与表之间不得成环」这条性质在 S4 之后变成真依赖环",
      );
      continue;
    }
    // ---- ② 形态 ----
    const hash = pointer.indexOf("#");
    if (hash <= 0 || hash === pointer.length - 1) {
      problems.push(`${id}:enforcement 指针「${pointer}」不是 \`<模块相对路径>#<导出名>\` 形态`);
      continue;
    }
    const modulePath = pointer.slice(0, hash);
    const exportName = pointer.slice(hash + 1);
    // ---- ③ 解析 ----
    if (options.load !== undefined) {
      const loaded = await options.load(modulePath);
      if (loaded === undefined || loaded === null) {
        problems.push(`${id}:enforcement 指向的模块解析不到:${modulePath}`);
        continue;
      }
      if (typeof loaded !== "object" || !(exportName in loaded)) {
        problems.push(`${id}:enforcement 指向的 ${modulePath} 没有导出 ${exportName}`);
      }
      continue;
    }
    problems.push(
      `${id}:enforcement 指针未经解析核对(${pointer})—— 审计注入面缺 load,这一格等于没查`,
    );
  }
  return problems;
}

/**
 * 真解析器:把仓相对模块路径 `import()` 起来。失败返回 `null`(不抛)——
 * 「解析不到」是判红的一档,不是载体自己崩掉的理由。
 * @param {string} modulePath 仓相对 POSIX 路径
 * @returns {Promise<unknown>} 模块命名空间;解析失败即 null
 */
async function realLoad(modulePath) {
  try {
    return await import(pathToFileURL(path.join(projectRoot, ...modulePath.split("/"))).href);
  } catch {
    return null;
  }
}

/** 恒解析不到的替身(负向夹具用) */
const NEVER_LOADS = () => Promise.resolve(null);

/**
 * 合成表里的一条 `enforcement` 指针(夹具用)。**对象字面量**,不改真实表。
 * @param {string} id 门禁 id
 * @param {string} [pointer] 指针(缺省即一条自指)
 * @returns {{ id: string, access: string, npmScripts: string[], modulePath: string, enforcement?: string }}
 */
function SYNTHETIC(id, pointer = `${GATE_INDEX_MODULE_REL}#GATE_INDEX`) {
  const entry = {
    id,
    access: "offchain",
    npmScripts: [`check:${id}`],
    modulePath: `gates/repo/check-${id}.mjs`,
  };
  return pointer === null ? entry : { ...entry, enforcement: pointer };
}

/* ---------- 夹具 ---------- */

const newTable = /** @type {Readonly<Record<string, object>>} */ (GATE_INDEX);
const oldTable = /** @type {Readonly<Record<string, object>>} */ (GATE_REGISTRY);
const LEGACY = Object.freeze(["local", "workflow"]);

/**
 * 判据族。`check` 返回 problems 数组,期望由 `expect` 描述。
 * ⚠ 每条都**自己**调审计函数并比对**诊断文案**(而不是只看条数),否则「审计恒返回空数组」
 * 这一种退化实现能让全部负向夹具通过 —— 那正是 §④ 的恒绿防护要消灭的形态。
 */
const CASES = [
  // ---- ① 双跑一致性 ----
  {
    name: "双跑一致性:新旧两表 id 集合完全一致(多一条=有人加了门禁没同步,少一条=索引有孤儿)",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(newTable, oldTable),
    expect: null,
  },
  {
    name: "双跑一致性:共有字段逐条相等(npmScripts 含顺序 / modulePath / judgment.module)",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(newTable, oldTable),
    expect: null,
  },
  {
    // **变异证明**:把某一项的 `npmScripts` 换成一个不同的次序,审计必须**点名**它。
    // 少了这一格,「逐条相等」可能只是「恒返回空数组」—— 而那种实现下两表完全对不上也照样绿。
    name: "双跑一致性变异:某一项 npmScripts 顺序被换 ⇒ 判红并点名该 id 与两个数组",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(
      { ...newTable, contract: { ...newTable.contract, npmScripts: ["check:contract:selftest", "check:contract"] } },
      oldTable,
    ),
    expect: /contract:npmScripts 不等 —— 新表 \[check:contract:selftest, check:contract\] vs 旧表 \[check:contract\]/,
  },
  {
    // 第二向:`modulePath` 漂移(转发层门禁那两个字段语义不同,压成一个就会在这里露出来)。
    name: "双跑一致性变异:docs 的 modulePath 被压成 judgment.module ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(
      {
        ...newTable,
        docs: { ...newTable.docs, modulePath: /** @type {{ module: string }} */ (newTable.docs.judgment).module },
      },
      oldTable,
    ),
    expect: /docs:modulePath 不等 —— 新表 gates\/repo\/check-pointers\.mjs vs 旧表 gates\/repo\/check-docs\.mjs/,
  },
  {
    name: "双跑一致性变异:新表多出一道旧表没有的门禁 ⇒ 判红并点名(孤儿登记项方向)",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(
      { ...newTable, "brand-new-gate": SYNTHETIC("brand-new-gate", null) },
      oldTable,
    ),
    expect: /新表多出 1 项而旧表没有:brand-new-gate/,
  },
  {
    name: "双跑一致性变异:旧表有的一道门禁从新表里删掉 ⇒ 判红并点名(缺登记方向)",
    /** @returns {string[]} */
    check: () => {
      const trimmed = { ...newTable };
      delete trimmed.contract;
      return auditDualRunConsistency(trimmed, oldTable);
    },
    expect: /旧表有而新表缺 1 项:contract —— 索引里出现了孤儿登记项/,
  },
  {
    // 内联 judgment 那一条的例外口径:合成一张「旧表该项是函数」的新表,要求新表指针等于
    // 旧表 modulePath。这条同时钉住「例外是**逐条点名**的」而不是静默跳过。
    name: "双跑一致性:旧表 judgment 是内联函数时,改比「新表指针 == 旧表 modulePath」",
    /** @returns {string[]} */
    check: () => auditDualRunConsistency(
      {
        ...newTable,
        "gate-probes": {
          ...newTable["gate-probes"],
          // 指向别的模块 ⇒ 必须被判红,证明这一格不是恒绿。
          judgment: { module: "gates/repo/check-pointers.mjs", export: "main" },
        },
      },
      oldTable,
    ),
    expect: /gate-probes:旧表这一项的 judgment 是内联函数\(无 \.module 可比\),新表应指向它的 modulePath/,
  },
  // ---- ② access 取值域 ----
  {
    name: "access 取值域:新表只 chain/offchain,零个 S3 旧取值",
    /** @returns {string[]} */
    check: () => auditAccessDomain(newTable, LEGACY),
    expect: null,
  },
  {
    name: "access 取值域变异:某一项退回旧取值 workflow ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditAccessDomain(
      { ...newTable, env: { ...newTable.env, access: "workflow" } },
      LEGACY,
    ),
    expect: /env:access 取值「workflow」不在两值域内\(S3 的旧取值,gate-index\.mjs 应收成 offchain\)/,
  },
  {
    // 恒绿防护(反向):空表会让「零个旧取值」这一格照样成立 —— 必须能被抓住。
    name: "access 取值域:空表判红(零项登记 ⇒ L11/L12 在零判定面上全绿)",
    /** @returns {string[]} */
    check: () => auditAccessDomain({}, LEGACY),
    expect: /表为空:零项登记意味着 L11\/L12 两族在零判定面上全绿/,
  },
  // ---- ③ enforcement 指针:禁自指(纯文本档)----
  {
    name: "enforcement 禁自指:真实表里零条指针指向 gate-index.mjs 自身",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(newTable, { load: realLoad }),
    expect: null,
  },
  {
    // **负向夹具(本族存在的理由)**:合成表里放一条指向本表自己的指针 ⇒ 必须判红。
    // 用 NEVER_LOADS 作 loader:这一格验的是「自指」,不是「能不能 import」——
    // 真去 import 本表会把症状换成「解析失败」,离根因隔了一层。
    name: "enforcement 禁自指负向:合成表里一条指针指向 gate-index.mjs 自身 ⇒ 判红并点名",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers({ bad: SYNTHETIC("bad") }, { load: NEVER_LOADS }),
    expect: /bad:enforcement 指向本表自身\(gates\/repo\/gate-index\.mjs#GATE_INDEX\)/,
  },
  {
    name: "enforcement 禁自指负向:指针指本表的另一个导出也算自指 ⇒ 判红",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(
      { bad: SYNTHETIC("bad", `${GATE_INDEX_MODULE_REL}#ACCESS_CHAIN`) },
      { load: NEVER_LOADS },
    ),
    expect: /bad:enforcement 指向本表自身/,
  },
  {
    name: "enforcement 形态:缺 `#` 或缺导出名的指针 ⇒ 判红(不静默放过)",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(
      { a: SYNTHETIC("a", "gates/repo/check-test-layout.mjs"), b: SYNTHETIC("b", "gates/repo/x.mjs#") },
      { load: NEVER_LOADS },
    ),
    expect: /a:enforcement 指针「gates\/repo\/check-test-layout\.mjs」不是 `<模块相对路径>#<导出名>` 形态/,
  },
  // ---- ④ enforcement 指针:真解析 ----
  {
    // **正向锚点**:每条真实指针都真能 `import()` 到、导出名真在。这一格缺了的话,
    // 下面两条负向可能只是「恒红」。
    name: "enforcement 解析:每条真实指针真能 import() 到且导出名存在",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(newTable, { load: realLoad }),
    expect: null,
  },
  {
    // 指针条数非零 + 逐条点名:把 `enforcement` 整条删掉(0 条)时,「零 problems」不该成立。
    // 判据是「逐条点名带 enforcement 的门禁」而不是「条数 >= 1」—— 后者写死一个数字,
    // 而全局 AGENTS.md 三.4 要求可运行数字不进断言。
    name: "enforcement 覆盖面:带指针的门禁被逐条点名(整条删掉时这一格不成立)",
    /** @returns {Promise<string[]>} */
    check: async () => {
      const named = Object.values(newTable)
        .filter((entry) => entry.enforcement !== undefined)
        .map((entry) => /** @type {string} */ (entry.id))
        .sort();
      if (named.length === 0) return ["没有任何门禁带 enforcement 指针:分级表指针被整条删掉了,且无人判红"];
      const problems = await auditEnforcementPointers(newTable, { load: realLoad });
      return problems.map((line) => `${line}(覆盖面自检:带指针的是 ${named.join(", ")})`);
    },
    expect: null,
  },
  {
    name: "enforcement 解析负向:指针指向解析不到的模块 ⇒ 判红并点名",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers({ bad: SYNTHETIC("bad", "gates/repo/no-such-module.mjs#X") }, { load: NEVER_LOADS }),
    expect: /bad:enforcement 指向的模块解析不到:gates\/repo\/no-such-module\.mjs/,
  },
  {
    name: "enforcement 解析负向:模块在但导出名不存在 ⇒ 判红并点名(名字改了无人发现)",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(
      { bad: SYNTHETIC("bad", "gates/repo/check-test-layout.mjs#CRITERIA_RENAMED") },
      { load: realLoad },
    ),
    expect: /bad:enforcement 指向的 gates\/repo\/check-test-layout\.mjs 没有导出 CRITERIA_RENAMED/,
  },
  {
    name: "enforcement 解析负向:审计注入面缺 load ⇒ 判红(这一格等于没查,不许静默放过)",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers({ bad: SYNTHETIC("bad", "gates/repo/check-test-layout.mjs#CRITERIA") }),
    expect: /bad:enforcement 指针未经解析核对\(gates\/repo\/check-test-layout\.mjs#CRITERIA\)/,
  },
];

/* ---------- 跑 ---------- */

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  try {
    const raw = await testCase.check();
    if (!Array.isArray(raw)) {
      failures.push(`${testCase.name}:审计函数返回的不是数组(恒绿防护:非数组一律判失败)`);
      continue;
    }
    const joined = raw.join("\n");
    if (testCase.expect === null) {
      if (raw.length === 0) {
        console.log(`[ok] gate-index-selftest:${testCase.name}(零判红)`);
      } else {
        failures.push(`${testCase.name}:期望零判红,实际 ${raw.length} 条\n${joined}`);
      }
      continue;
    }
    if (testCase.expect.test(joined)) {
      console.log(`[ok] gate-index-selftest:${testCase.name}(漂移被拦截 / ${raw.length} 条)`);
    } else {
      failures.push(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
    }
  } catch (error) {
    // 一条夹具的构造/求值抛异常只登记,不让它打断整批(否则后面的夹具一条都跑不到)
    failures.push(
      `${testCase.name}:抛异常:${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[gate-index-selftest:fail] ${failure}`);
  console.error(`[gate-index-selftest:fail] 门禁索引回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] gate-index-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);