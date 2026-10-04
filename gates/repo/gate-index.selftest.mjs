// 门禁索引(gates/repo/gate-index.mjs)自身的回归守护。
//
// ⚠ **本载体守的是「表」不是「判定面」**:L11 / L11b / L12 三条判据住在
// `check-test-layout.mjs` 里,它们的负向夹具在 `check-test-layout.selftest.mjs`。
// 本载体只钉「这张表自身是否成立」这一件事。
//
// ---- S4 删沙盒层:双跑对读那一臂已整条删除(不可逆) ----
// 本载体此前守四件事,第一件是**双跑一致性**:新旧两张表在共有字段上逐条相等、且 id 集合
// 完全一致。第二来源(旧表 `gates/probe/gate-probes/registry.mjs`)随 S4 整体消失 ⇒
// `auditDualRunConsistency` 及其 7 条夹具(含内联 judgment 例外口径那一条)**整条删除**。
//
// **为什么不把旧表内容冻结成字面基线继续比对**:那就是「复述表里的状态」——状态会变、
// 复述即漂移源,与 `ADR-062` 明写的「不复述表里的状态,状态会变、复述即漂移源」直接冲突;
// 且冻结的那份基线只会恒绿(旧表的真实内容此后无人改动 ⇒ 比对恒成立),它给的是**恒绿的
// 假对照**,比没有更坏。
//
// ⚠ **删掉之后不许留一个 report-only 的「无法对读」占位**:那同样是恒绿 ——
// 「对读不了」这件事在门禁上与「对过了且一致」不可区分。故判定面换成**本表自身成立性**的
// 三条(见下),每条都配能变红的负向夹具。
//
// ---- `gate-index.mjs` 的独立对读现在由谁做(点名,不留悬空) ----
// **由 `test/gates/repo/gate-index.test.js` 承担**(ADR-062 S5 新建)。三条已核实的性质:
//   ① 它**零 import** `gates/probe/**` 的任何东西 —— 那正是它「活过 S4」的前提,已实测确认;
//   ② 它**已在链上** —— 它是 `test/gates/` 树下一段普通验收段(入口自动发现,零登记),
//      随 `npm test` → `test:coverage` 在 `verify:ci` 里跑;
//   ③ 它的五格判据**各有能变红的变异实验自证**(格① 链上新增门禁未登记 · 格② 载体无主/脱链 ·
//      格③ judgment 谎报可 import · 格④ 调用面塌缩 · 格⑤ 链序约束),且每格都比对**诊断文案**
//      而非条数。
// ⇒ 「有人删了/改歪了 `gate-index.mjs` 的登记项」这件事仍然会红,只是判定面从「两表相等」
// 换成了「这张表与 package.json / 磁盘 / 链展开对读」。
//
// ---- 本载体现在的三条判定面(全部是表自身成立性) ----
//   ① **id 唯一性**(含表键 ≡ id):孤儿登记项与重复登记项在这一族;此前它们的判据是双跑对读的
//      id 集合双向差集,S4 后那一族**没有别的承接者** ⇒ 收进这里,不静默丢弃。
//   ② **`npmScripts` 形态**:字段在、且是数组、且每项是非空字符串。
//      ⚠ **不是「数组非空」**:`dual-matrix` 登记的 `npmScripts: []` 是**既有裁决**
//      (`gate-index.mjs` 该项头注:它不是 npm script 门禁,而是验收段内的一道门禁,
//      由 `M2W_ONLY` 单独跑;L12 对它取 `npmScripts[0]` 得到 undefined 那一档显式容忍)。
//      故表级恒绿防护落在「**全表至少一项带 script**」上,而不是逐项要求非空。
//   ③ **`judgment.module` / `judgment.export` 可解析**:真 `import()` 到、导出名真在。
//      这一族**刻意不重复** L12 的链归属语义(`check-test-layout.mjs` 判「在不在链上」),
//      只判「指针本身解不解得开」—— 两族语义不同源。
//
// ---- 为什么「审计」住在载体里、不住在表里 ----
// `gate-index.mjs` 是**零 import 的纯数据表**(它必须零 import:一旦它自己会 `import()` 别处,
// 「禁自指」这条规则要防的死锁就落在它头上了)。给它加一个会 `import()` 的审计函数 = 让数据表
// 做 IO,而那个 IO 恰好就是它必须避免的形态。
//
// ⚠ **不修改被测表、也不复制它**:夹具里出现的是**合成表**(纯对象字面量),真实表只被**读**。
// 与 `check-test-layout.selftest.mjs` 的合成根不同构 —— 真实表只被读一次,故本载体**零 IO、
// 零临时目录**。
//
// ⚠ **恒绿防护**:每条判据都**自己**调判定函数并比对**诊断文案**(而不是只看条数),否则
// 「判定函数恒返回空数组」这一种退化实现能让全部负向夹具通过 —— 那是最坏的失效形态。
// 另两处:① 每族都有**空表 / 零发现**那一档(零判定面上的全绿与「真查过了」不可区分);
// ② `enforcement` 那一族有**覆盖面自检**(整条删掉时零 problems 不该成立)。

import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT } from "../../shared/paths.js";
import { GATE_INDEX, GATE_INDEX_MODULE_REL } from "./gate-index.mjs";

const projectRoot = ROOT;

/* ---------- 判定函数(纯函数 + 可注入 loader,便于合成表夹具) ---------- */

/**
 * ① `id` 唯一性审计:两项断言 —— 表键必须等于 `entry.id`,且全表 `id` 不重复。
 *
 * ⚠ **表键 ≡ id 也在本族**:表在 JS 里是一个对象字面量,键是人写的、`id` 是字段。
 * 两处不一致时,消费方各有各的读法(L11 的门禁级豁免表按 `id` 查,诊断文案按表键点名)⇒
 * 「孤儿登记项」在这两种读法下指向不同的门禁。此前这一族由双跑对读的 id 集合双向差集接住,
 * S4 后那一族没有别的承接者 ⇒ 收在这里,不静默丢弃。
 *
 * **逐条点名而不是只回一个布尔**:「id 唯一」这句话在实现退化成恒真时同样成立,而读者无从
 * 判断是哪一项出了事。所有 problems 都带表键与 id。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @returns {string[]} problems(空数组 = 全部唯一且键 id 一致)
 */
export function auditIdUniqueness(table) {
  /** @type {string[]} */
  const problems = [];
  const keys = Object.keys(table);
  if (keys.length === 0) {
    problems.push("表为空:零项登记意味着「id 全表唯一」在零判定面上恒绿(恒绿形态)");
    return problems;
  }
  /** @type {Map<string, string>} id → 首次见到它的表键 */
  const seen = new Map();
  for (const key of keys) {
    const entry = table[key];
    const id = entry === undefined || entry === null ? undefined : entry.id;
    if (typeof id !== "string" || id === "") {
      problems.push(
        `${key}: 缺 id 或 id 不是非空字符串 —— 「id 全表唯一」无从核对,且它会静默离开 `
        + "L11/L12 两族的判定面(那两族按 id 认门禁)",
      );
      continue;
    }
    if (id !== key) {
      problems.push(
        `${key}:id 字段写的是「${id}」—— 表键与 id 不一致。消费方的两种读法会指向不同的门禁:`
        + "L11 的门禁级豁免表按 id 查,诊断文案按表键点名。改键或改 id,二者取一",
      );
    }
    const first = seen.get(id);
    if (first !== undefined) {
      problems.push(
        `${key} 与 ${first} 的 id 都是「${id}」:全表 id 不唯一 —— 按 id 认门禁的判据`
        + "(L11 的门禁级豁免表、L12 的链归属)对其中一项的归属将不确定",
      );
      continue;
    }
    seen.set(id, key);
  }
  return problems;
}

/**
 * ② `npmScripts` 形态审计:字段在、且是数组、且每项是非空字符串。
 *
 * ⚠ **不要求逐项非空**:`dual-matrix` 登记 `npmScripts: []` 是既有裁决(它不是 npm script
 * 门禁,而是验收段内的一道门禁,由 `M2W_ONLY` 单独跑;L12 那一档显式容忍
 * `npmScripts[0]` 为 undefined)。逐项要求非空会把这条既有裁决判成违规 —— 那不是本载体
 * 的判定面。表级恒绿防护因此落在「**全表至少一项带 script**」上。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @returns {string[]} problems(空数组 = 形态全合法且全表至少一项带接入点)
 */
export function auditNpmScripts(table) {
  /** @type {string[]} */
  const problems = [];
  const keys = Object.keys(table);
  if (keys.length === 0) {
    problems.push("表为空:零项登记意味着「npmScripts 形态成立」在零判定面上恒绿(恒绿形态)");
    return problems;
  }
  let withScript = 0;
  for (const key of keys) {
    const entry = table[key];
    const id = entry === undefined || entry === null ? String(entry?.id ?? key) : String(entry.id ?? key);
    const scripts = entry === undefined || entry === null ? undefined : entry.npmScripts;
    if (!Array.isArray(scripts)) {
      problems.push(
        `${id}: npmScripts ${scripts === undefined ? "字段缺失" : `不是数组(是 ${typeof scripts})`}`
        + " —— 它的接入点无从核对,而 L12 的链归属正是拿这一项与链展开对账",
      );
      continue;
    }
    for (const name of scripts) {
      if (typeof name === "string" && name.trim() !== "") continue;
      problems.push(
        `${id}: npmScripts 里有空位(${JSON.stringify(name)})—— 链归属取 npmScripts[0] 与链展开对账,`
        + "空位会让「这道门禁在不在链上」这个问题没有答案",
      );
    }
    if (scripts.length > 0) withScript += 1;
  }
  if (withScript === 0) {
    problems.push(
      "全表零项带 npm script:每一项都声明不出接入点 —— 整张表在「谁跑这道门禁」这个问题上恒绿"
      + "(恒绿形态;逐项非空不由本载体判,理由见本函数注释)",
    );
  }
  return problems;
}

/**
 * ③ `judgment` 指针审计:每条 `judgment.module` 真能 `import()` 到、且 `judgment.export` 真在。
 *
 * ⚠ **只判「指针解不解得开」,不判「它在不在链上」** —— 后者是 L12
 * (`check-test-layout.mjs`)的判定面。两族语义不同源,在本载体里重复一遍只会多一处会漂移的副本。
 *
 * ⚠ **为什么值得真 `import()` 而不是只查文件存在**:表里的指针有一类失效形态是「文件在、
 * 但导出名改了」—— 只查存在性对它完全无感,而那正是「改对外接口无人发现」那类漂移。
 * 已实测确认 39 项的 `judgment.module` **全部零顶层自执行**(顶层 `process.exit` /
 * `process.exitCode =` / 顶层 `main()` 调用一条都没有)⇒ 真 import 是安全的。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {object} [options]
 * @param {(modulePath: string) => Promise<unknown>} [options.load] 指针解析器(注入面:
 *   负向夹具给一个恒「解析不到」的替身,不真的去 import)
 * @returns {Promise<string[]>} problems(空数组 = 每条指针都解得开)
 */
export async function auditJudgmentPointers(table, options = {}) {
  /** @type {string[]} */
  const problems = [];
  const keys = Object.keys(table);
  if (keys.length === 0) {
    problems.push("表为空:零项登记意味着「每条 judgment 指针可解析」在零判定面上恒绿(恒绿形态)");
    return problems;
  }
  for (const key of keys) {
    const entry = table[key];
    const id = entry === undefined || entry === null ? String(entry?.id ?? key) : String(entry.id ?? key);
    const judgment = entry === undefined || entry === null ? undefined : entry.judgment;
    const modulePath = judgment === undefined || judgment === null ? undefined : judgment.module;
    const exportName = judgment === undefined || judgment === null ? undefined : judgment.export;
    if (typeof modulePath !== "string" || modulePath === "") {
      problems.push(
        `${id}: judgment 缺 module 指针 —— 「判定体住在哪个模块」无从核对,`
        + "改判定体所在文件而忘了改指针时它会静默留在表里",
      );
      continue;
    }
    if (typeof exportName !== "string" || exportName === "") {
      problems.push(
        `${id}: judgment 缺 export 名 —— 「判定体是它的哪个导出」无从核对,`
        + "而改名是最常见的接口漂移形态",
      );
      continue;
    }
    if (options.load === undefined) {
      problems.push(
        `${id}:judgment 指针未经解析核对(${modulePath}#${exportName})—— 审计注入面缺 load,这一格等于没查`,
      );
      continue;
    }
    const loaded = await options.load(modulePath);
    if (loaded === undefined || loaded === null) {
      problems.push(`${id}:judgment 指向的模块解析不到:${modulePath}`);
      continue;
    }
    if (typeof loaded !== "object" || !(exportName in loaded)) {
      problems.push(`${id}:judgment 指向的 ${modulePath} 没有导出 ${exportName}(改名无人发现)`);
    }
  }
  return problems;
}

/**
 * `access` 取值域审计:只允许 `chain` / `offchain`,且至少要有一项(全空表是恒绿形态)。
 *
 * ⚠ **`legacyValues` 是本判据自己的取值域定义,不是从任何表复述来的状态** —— 与文件头
 * 「不复述表里的状态」不冲突:它登记的是「被拒绝的旧取值有哪些」,这条判据自身就是它的单源。
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

const realTable = /** @type {Readonly<Record<string, object>>} */ (GATE_INDEX);
const LEGACY = Object.freeze(["local", "workflow"]);

/**
 * 判据族。`check` 返回 problems 数组,期望由 `expect` 描述。
 * ⚠ 每条都**自己**调判定函数并比对**诊断文案**(而不是只看条数),否则「判定函数恒返回空数组」
 * 这一种退化实现能让全部负向夹具通过 —— 那正是恒绿防护要消灭的形态。
 */
const CASES = [
  // ---- ① id 唯一性(含表键 ≡ id)----
  {
    name: "id 唯一性:真实表里表键 === id 且全表零重复(锚点)",
    /** @returns {string[]} */
    check: () => auditIdUniqueness(realTable),
    expect: null,
  },
  {
    // **变异证明**:把某一项的 `id` 改成另一项已占用的值,判据必须**点名**重复的两个表键。
    // 少了这一格,「id 唯一」可能只是「恒返回空数组」—— 而那种实现下整表重复也照样绿。
    name: "id 唯一性变异:两项共用同一个 id ⇒ 判红并点名两个表键",
    /** @returns {string[]} */
    check: () => auditIdUniqueness({ ...realTable, docs: { ...realTable.docs, id: "contract" } }),
    expect: /docs 与 contract 的 id 都是「contract」:全表 id 不唯一/,
  },
  {
    name: "id 唯一性变异:表键与 id 字段不一致 ⇒ 判红并点名(孤儿登记项方向)",
    /** @returns {string[]} */
    check: () => auditIdUniqueness({ ...realTable, "stale-key": { ...realTable.docs, id: "docs" } }),
    expect: /stale-key:id 字段写的是「docs」—— 表键与 id 不一致/,
  },
  {
    name: "id 唯一性:缺 id 的项 ⇒ 判红(不许静默离开 L11\/L12 的判定面)",
    /** @returns {string[]} */
    check: () => auditIdUniqueness({ nameless: { access: "offchain", npmScripts: [], modulePath: "x.mjs" } }),
    expect: /nameless: 缺 id 或 id 不是非空字符串/,
  },
  {
    name: "id 唯一性:空表判红(零项登记 ⇒ 唯一性在零判定面上恒绿)",
    /** @returns {string[]} */
    check: () => auditIdUniqueness({}),
    expect: /表为空:零项登记意味着「id 全表唯一」在零判定面上恒绿/,
  },
  // ---- ② npmScripts 形态 ----
  {
    name: "npmScripts 形态:真实表每一项都是数组、零空位、全表至少一项带 script(锚点)",
    /** @returns {string[]} */
    check: () => auditNpmScripts(realTable),
    expect: null,
  },
  {
    // **反向锚点**:`dual-matrix` 登记 `npmScripts: []` 是既有裁决(非 npm script 门禁,
    // 由 M2W_ONLY 单独跑)—— 判据必须**不**把它判红,否则本族与 L12 的既有容忍自相矛盾。
    // 表级那条「全表至少一项带 script」不误伤它:同表里另有一项带接入点。
    name: "npmScripts 形态反向锚点:表内某一项零 script ⇒ 不判红(逐项非空不由本载体判)",
    /** @returns {string[]} */
    check: () => auditNpmScripts({
      zero: { id: "zero", npmScripts: [], access: "offchain" },
      alpha: { id: "alpha", npmScripts: ["check:alpha"], access: "offchain" },
    }),
    expect: null,
  },
  {
    name: "npmScripts 形态变异:字段缺失 ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditNpmScripts({ alpha: { id: "alpha", access: "offchain", modulePath: "x.mjs" } }),
    expect: /alpha: npmScripts 字段缺失 —— 它的接入点无从核对/,
  },
  {
    name: "npmScripts 形态变异:写成字符串而不是数组 ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditNpmScripts({ alpha: { id: "alpha", access: "offchain", npmScripts: "check:alpha" } }),
    expect: /alpha: npmScripts 不是数组\(是 string\)/,
  },
  {
    name: "npmScripts 形态变异:数组里有空位 ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditNpmScripts({ alpha: { id: "alpha", access: "offchain", npmScripts: ["check:alpha", ""] } }),
    expect: /alpha: npmScripts 里有空位\(""\)/,
  },
  {
    name: "npmScripts 形态:全表零项带 script ⇒ 判红(整表恒绿形态)",
    /** @returns {string[]} */
    check: () => auditNpmScripts({
      alpha: { id: "alpha", access: "offchain", npmScripts: [] },
      beta: { id: "beta", access: "offchain", npmScripts: [] },
    }),
    expect: /全表零项带 npm script:每一项都声明不出接入点/,
  },
  {
    name: "npmScripts 形态:空表判红(零判定面恒绿)",
    /** @returns {string[]} */
    check: () => auditNpmScripts({}),
    expect: /表为空:零项登记意味着「npmScripts 形态成立」在零判定面上恒绿/,
  },
  // ---- ③ judgment 指针真解析 ----
  {
    // **正向锚点**:每条真实指针都真能 `import()` 到、导出名真在。这一格缺了的话,
    // 下面几条负向可能只是「恒红」。
    name: "judgment 解析:真实表每条指针真能 import() 到且导出名存在(锚点)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers(realTable, { load: realLoad }),
    expect: null,
  },
  {
    name: "judgment 解析负向:指针指向解析不到的模块 ⇒ 判红并点名",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers(
      { bad: { ...SYNTHETIC("bad"), judgment: { module: "gates/repo/no-such-judgment.mjs", export: "main" } } },
      { load: NEVER_LOADS },
    ),
    expect: /bad:judgment 指向的模块解析不到:gates\/repo\/no-such-judgment\.mjs/,
  },
  {
    name: "judgment 解析负向:模块在但导出名不存在 ⇒ 判红并点名(改名无人发现)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers(
      { bad: { ...SYNTHETIC("bad"), judgment: { module: "gates/repo/check-test-layout.mjs", export: "CRITERIA_RENAMED" } } },
      { load: realLoad },
    ),
    expect: /bad:judgment 指向的 gates\/repo\/check-test-layout\.mjs 没有导出 CRITERIA_RENAMED/,
  },
  {
    name: "judgment 解析负向:缺 module 指针 ⇒ 判红(判定体搬走而指针没改)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers({ bad: { ...SYNTHETIC("bad"), judgment: { export: "main" } } }, { load: realLoad }),
    expect: /bad: judgment 缺 module 指针 —— 「判定体住在哪个模块」无从核对/,
  },
  {
    name: "judgment 解析负向:缺 export 名 ⇒ 判红(改名是最常见的接口漂移形态)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers(
      { bad: { ...SYNTHETIC("bad"), judgment: { module: "gates/repo/check-test-layout.mjs" } } },
      { load: realLoad },
    ),
    expect: /bad: judgment 缺 export 名 —— 「判定体是它的哪个导出」无从核对/,
  },
  {
    name: "judgment 解析负向:审计注入面缺 load ⇒ 判红(这一格等于没查,不许静默放过)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers(
      { bad: { ...SYNTHETIC("bad"), judgment: { module: "gates/repo/check-test-layout.mjs", export: "CRITERIA" } } },
    ),
    expect: /bad:judgment 指针未经解析核对\(gates\/repo\/check-test-layout\.mjs#CRITERIA\)/,
  },
  {
    name: "judgment 解析:空表判红(零判定面恒绿)",
    /** @returns {Promise<string[]>} */
    check: () => auditJudgmentPointers({}, { load: realLoad }),
    expect: /表为空:零项登记意味着「每条 judgment 指针可解析」在零判定面上恒绿/,
  },
  // ---- ④ access 取值域 ----
  {
    name: "access 取值域:新表只 chain/offchain,零个 S3 旧取值",
    /** @returns {string[]} */
    check: () => auditAccessDomain(realTable, LEGACY),
    expect: null,
  },
  {
    name: "access 取值域变异:某一项退回旧取值 workflow ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditAccessDomain(
      { ...realTable, env: { ...realTable.env, access: "workflow" } },
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
  // ---- ⑤ enforcement 指针:禁自指(纯文本档)----
  {
    name: "enforcement 禁自指:真实表里零条指针指向 gate-index.mjs 自身",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(realTable, { load: realLoad }),
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
  // ---- ⑥ enforcement 指针:真解析 ----
  {
    name: "enforcement 解析:每条真实指针真能 import() 到且导出名存在",
    /** @returns {Promise<string[]>} */
    check: () => auditEnforcementPointers(realTable, { load: realLoad }),
    expect: null,
  },
  {
    // 指针条数非零 + 逐条点名:把 `enforcement` 整条删掉(0 条)时,「零 problems」不该成立。
    // 判据是「逐条点名带 enforcement 的门禁」而不是「条数 >= 1」—— 后者写死一个数字,
    // 而全局 AGENTS.md 三.4 要求可运行数字不进断言。
    name: "enforcement 覆盖面:带指针的门禁被逐条点名(整条删掉时这一格不成立)",
    /** @returns {Promise<string[]>} */
    check: async () => {
      const named = Object.values(realTable)
        .filter((entry) => entry.enforcement !== undefined)
        .map((entry) => /** @type {string} */ (entry.id))
        .sort();
      if (named.length === 0) return ["没有任何门禁带 enforcement 指针:分级表指针被整条删掉了,且无人判红"];
      const problems = await auditEnforcementPointers(realTable, { load: realLoad });
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
      failures.push(`${testCase.name}:判定函数返回的不是数组(恒绿防护:非数组一律判失败)`);
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