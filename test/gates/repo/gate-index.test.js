// @ts-check
/**
 * 门禁索引验收段(S4「删沙盒层」之后 `gates/repo/gate-index.mjs` **唯一的独立对读来源**)。
 *
 * ---- 为什么这一段必须活过 S4 ----
 * 旧的两份验收段把判据面**整个押在沙盒层**上:
 *   - `test/gates/gate-probes.test.js` 的 8 档断言的正是沙盒本身(「全程沙盒内完成」
 *     「真实工作树指纹未变」「报告已落盘且可跨机比对」「无 blocking 级登记项」)——
 *     S4 删掉沙盒层之后,这些断言的对象**已不存在**,照搬进来等于断言一件不存在的事 ⇒ **不迁移**;
 *   - `test/gates/gate-registry-gate.test.js` 的 24 档里 18 档已由 S3 建的
 *     `gates/repo/gate-index.selftest.mjs`(19 格,已上链、带变异实验)承接 ⇒ **不重复实现**。
 * 而 S3 那个载体守的是「表与表之间的双跑一致性 + `enforcement` 指针完整性」——
 * 它在 S4 之后会退化成**单侧自检**(旧表没了,「两表相等」变成「一张表自我确认」)。
 * 本段接住的就是那 5 格**没有承接者**的判据。
 *
 * ---- 本段刻意不实现的 18 档(逐条理由见收尾汇报) ----
 * 导出名不存在 ×2 · 判定模块不存在 · 实现文件不存在(已由 `check-test-layout` 的
 * `gate-module-present` 覆盖)· `access` 取值域两值化 · `enforcement` 指针禁自指与真 `import()`
 * · 两表 id 集合双向差集 · `npmScripts` 顺序 · 旧表内联 `judgment` 的例外口径 ——
 * 全部已在 `gate-index.selftest.mjs`;本段**刻意不重复实现**它们。
 *
 * ---- 五格判据与各自的负向夹具 ----
 *   ① 链上新出现的门禁／裸调路径无人登记   ← `auditInvocationRegistration`
 *   ② 自检载体没人认领／不在链上           ← `auditCarrierCoverage`
 *   ③ `judgment` 声明谎报可 `import()`      ← `auditJudgmentImportability`
 *   ④ 调用面非空(发现器退化成空扫描的恒绿防护) ← `auditInvocationSurface`
 *   ⑤ 契约门禁判定本体在注入根上求值        ← `checkContract` + 注入面
 *
 * ---- 依赖纪律:本段**零 import** 任何 `gates/probe/** 的东西 ----
 * 旧 registry 的 `discoverInvocations` / `topLevelSelfExecutions` / `PROBE_CARRIER_SCRIPTS`
 * 随 S4 整体消失,而本段的全部意义就是**活过 S4** ⇒ 在此 import 等于把新段建在被删的依赖上。
 * 故本段自带一份「从 `package.json` 与文件系统发现调用面」的实现(只依赖 `node:fs`/`node:path`
 * 与已迁到 `gates/repo/` 的 `chain-expand.mjs`),顶层自执行探测也自带一份。
 * **载体 script 表刻意从磁盘派生**(`gates/` 树下的 `*.selftest.mjs`)而不是抄一份常量 ——
 * 抄常量就等于把 `PROBE_CARRIER_SCRIPTS` 抄进测试树,而那张表正是 S4 要删的东西。
 *
 * ---- 恒绿防护 ----
 * 五格判据全部是「返回 problems 数组」的纯函数,注入面(表 / scripts / workflow 文本 / 读文本)
 * 全部可替换,因此每格都能在**合成输入**上造出判红。⚠ 判据本体若退化成「恒返回空数组」,
 * 全部负向夹具都会通过 —— 故每格的负向夹具都比对**诊断文案**(逐条点名),不比对条数。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CHAIN_ROOTS, walkChain } from "../../../gates/repo/chain-expand.mjs";
import { GATE_INDEX, GATE_INDEX_MODULE_REL } from "../../../gates/repo/gate-index.mjs";
import { checkContract } from "../../../gates/repo/check-ci-contract.mjs";
import { createCaseSuite } from "../../harness/case.js";
import { ROOT } from "../../harness/paths.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
// 索引自身的行为,产物是一组判定结论,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

/* ---------- 调用的仓内路径常量 ---------- */

/** workflow 目录(仓相对 POSIX)。与旧 registry 的 `WORKFLOWS_DIR` 同名同义,但本段自带一份。 */
const WORKFLOWS_DIR = ".github/workflows";

/** 门禁脚本树(仓相对 POSIX):负向自检载体从这里派生。 */
const GATES_DIR = "gates";

/** 负向自检载体的文件名后缀。 */
const CARRIER_SUFFIX = ".selftest.mjs";

/** 段内文件名后缀:被链上 script 正文当作「文件级调用点」捕获的那一类。 */
const SCRIPT_FILE_EXT = "(?:mjs|cjs|js|cts)";

/** script 正文里的裸调:`node <file>` / `electron <file>`(只认行首或空白之后)。 */
const SCRIPT_FILE_RE = new RegExp(String.raw`(?:^|\s)(?:node|electron)\s+([\w./'-]+\.${SCRIPT_FILE_EXT})`, "g");

/** workflow 里的裸调:行首/空白/`|` 之后,避免把 `node -p "…"` 与 shell 变量赋值算成调用点。 */
const WORKFLOW_FILE_RE = new RegExp(String.raw`(?:^|[\s|])(?:node|electron)\s+([\w./'-]+\.${SCRIPT_FILE_EXT})\b`, "gm");

/** workflow 里的 `npm run <name>`(允许夹带 npm 开关)。 */
const WORKFLOW_NPM_RE = /npm run (?:-{1,2}[\w-]+ )*([\w:.-]+)/g;

/**
 * **不属于门禁索引判定面**的三类调用点(它们不是门禁,豁免理由逐条写清 ——
 * 理由缺失等于把一道真门禁悄悄挪进豁免,那正是本段要防的失效形态)。
 *
 * ⚠ 这三类是**逐条列出的封闭枚举**,不是「看起来像工具链就放过」:新增一类豁免必须在这里
 * 写清理由,否则它会整条落进格①的判红面。
 */
/** @type {[string, string][]} 三条链根的豁免条目(聚合入口:它们是链本身而非链上的一道门禁) */
const CHAIN_ROOT_EXEMPTIONS = CHAIN_ROOTS.map(
  (name) => /** @type {[string, string]} */ ([
    name,
    "聚合入口:它是链根本身,不是链上的一道门禁(链的成员单源仍是 package.json)",
  ]),
);

/** @type {Map<string, string>} 被豁免的 npm script → 为什么它不算缺口 */
const EXEMPT_SCRIPTS = new Map([
  ...CHAIN_ROOT_EXEMPTIONS,
  /** @type {[string, string]} */
  ["build", "第三方工具:判定体是 TypeScript 编译器 + tools/copy-renderer.mjs,本仓不持有判据"],
  /** @type {[string, string]} */
  ["typecheck", "第三方工具:判定体是 tsc 的两份配置(源码与测试树),本仓不持有判据"],
  /** @type {[string, string]} */
  ["lint", "第三方工具:判定体是 ESLint 的规则集,本仓不持有判据"],
]);

/** @type {Map<string, string>} 被豁免的仓内文件 → 为什么它不算缺口 */
const EXEMPT_FILES = new Map([
  /** @type {[string, string]} */
  ["tools/copy-renderer.mjs", "静态资源拷贝:无判据,只搬运 renderer 资产到 dist"],
  /** @type {[string, string]} */
  ["test/acceptance.mjs", "验收段入口:由各段自证,段内断言即判据(段本身不在门禁索引口径内)"],
]);

/* ---------- 调用面发现(自带一份:旧 registry 那份随 S4 消失) ---------- */

/**
 * @typedef {object} Invocation 一条被发现的调用点
 * @property {"npm" | "file"} kind npm script 名,还是仓内脚本文件路径
 * @property {string} name 名字
 * @property {Set<string>} sources 出现在哪些调用源(`chain:<路径>` / `workflow:<文件名>` / `script:<名>`)
 * @property {boolean} onChain 是否出现在三条链之一
 * @property {boolean} onWorkflow 是否出现在某条 workflow 里
 */

/**
 * 发现**两条调用路径**上的全部调用点(链 + workflow)。
 *
 * 为什么必须显式扫 workflow:两条 workflow 在 `npm ci` 之前各有一处 `node gates/repo/check-ci-contract.mjs`
 * **裸调 fail-fast**,那不是任何 npm script 的正文,只登记 npm script 会把这条路径整条漏掉。
 *
 * @param {Record<string, string>} scripts package.json 的 scripts 表
 * @param {[string, string][]} workflows `[仓相对文件名, 文本]` 列表
 * @returns {Map<string, Invocation>} `kind:name` → 调用点
 */
function discoverInvocations(scripts, workflows) {
  /** @type {Map<string, Invocation>} */
  const found = new Map();
  /**
   * @param {"npm" | "file"} kind 类别
   * @param {string} name 名字
   * @param {string} source 调用源标识
   * @param {boolean} onChain 是否在链上
   * @param {boolean} onWorkflow 是否在 workflow 里
   * @returns {void}
   */
  const note = (kind, name, source, onChain, onWorkflow) => {
    const key = `${kind}:${name}`;
    const hit = found.get(key);
    if (hit === undefined) {
      found.set(key, { kind, name, sources: new Set([source]), onChain, onWorkflow });
      return;
    }
    hit.sources.add(source);
    hit.onChain = hit.onChain || onChain;
    hit.onWorkflow = hit.onWorkflow || onWorkflow;
  };
  for (const root of CHAIN_ROOTS) {
    walkChain(scripts, root, {
      onEnter: (node) => {
        // 未定义的 script 不构成调用点(链解析器已另行回报 missing,判定面不在本函数)
        if (!node.defined) return;
        note("npm", node.name, `chain:${node.path.join(">")}`, true, false);
      },
      onLeaf: (leaf) => {
        for (const m of leaf.text.matchAll(SCRIPT_FILE_RE)) {
          note("file", String(m[1]).replaceAll("\\", "/"), `script:${leaf.script}`, true, false);
        }
      },
    });
  }
  for (const [file, rawText] of workflows) {
    const text = rawText.replace(/^\s*#.*$/gm, "");
    for (const m of text.matchAll(WORKFLOW_NPM_RE)) {
      note("npm", String(m[1]), `workflow:${file}`, false, true);
    }
    for (const m of text.matchAll(WORKFLOW_FILE_RE)) {
      note("file", String(m[1]).replaceAll("\\", "/"), `workflow:${file}`, false, true);
    }
  }
  return found;
}

/**
 * 一张表声明认领了什么:`npmScripts` 收 script 侧,`modulePath` 与 `judgment.module` 收文件侧。
 *
 * ⚠ **文件侧为什么收两个字段**:转发层门禁(`docs`)的 `modulePath` 指执行入口而 `judgment.module`
 * 指判定体所在处,两者是不同模块 —— 只收一个会让那道门禁的判定体文件在格①被判成「无主裸调」。
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @returns {{ scripts: Set<string>, files: Set<string> }}
 */
function claimedSurfaces(table) {
  /** @type {Set<string>} */
  const scripts = new Set();
  /** @type {Set<string>} */
  const files = new Set();
  for (const raw of Object.values(table)) {
    const entry = /** @type {{ npmScripts?: readonly string[], modulePath?: unknown, judgment?: unknown }} */ (raw);
    for (const script of entry.npmScripts ?? []) scripts.add(script);
    if (typeof entry.modulePath === "string") files.add(entry.modulePath);
    const judgment = /** @type {{ module?: unknown } | null | undefined} */ (entry.judgment);
    if (judgment !== null && judgment !== undefined && typeof judgment === "object"
      && typeof judgment.module === "string") {
      files.add(judgment.module);
    }
  }
  return { scripts, files };
}

/* ---------- 格①:链上新出现的门禁／裸调路径无人登记 ---------- */

/**
 * 「豁免」表的最低码点数。与 `check-test-layout.mjs` 的 `REASON_MIN_CHARS` 同值同理由:
 * 写不出「为什么这次豁免合法」的长度时,它与「没写」在门禁上不可区分 —— 而那正是要防的形态。
 * **码点**计数(`[...s].length`)而非 UTF-16 单元,理由同该文件。
 */
const EXEMPT_REASON_MIN_CHARS = 20;

/**
 * 格①判定本体:调用面上的每个调用点都必须有归属。
 *
 * ⚠ **载体不在本判据的判定面内(由格②接住)**:链上的 `*:selftest` script 与它跑的
 * `.selftest.mjs` 文件**不是门禁**,是被它们守的那道门禁的探针。旧 registry 用
 * `PROBE_CARRIER_SCRIPTS` 把它们整个豁免出 R1 —— 本段沿用同一口径,但那张表随 S4 消失,
 * 故豁免集**从磁盘派生**(凡是 `gates/` 树下的 `*.selftest.mjs` 与跑它的 script 都在其内)。
 * 派生而非抄常量还有一层好处:新增一个 `.selftest.mjs` 而忘了登记,豁免集自动跟着长 ——
 * 而它的「有没有人认领 / 在不在链上」由格②独立判红。
 *
 * ⚠ **`gen:*` / `start` 这类「同门禁的另一条入口」不在链上是合法的** —— 它们压根不会出现在
 * 调用面里(本判据只扫链上与 workflow 上的调用点),所以它们天然不构成缺口。旧 registry 的 R5a
 * 已明文裁决过这一点;「只对 `npmScripts[0]` 做链归属核对」是 L12 的职责,不在本段重复。
 *
 * @param {Map<string, Invocation>} found 调用面发现结果
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {{ exemptScripts?: ReadonlyMap<string, string>, exemptFiles?: ReadonlyMap<string, string>, carrierScripts?: ReadonlySet<string>, carrierFiles?: readonly string[] }} [options] 注入面(负向夹具用)
 * @returns {string[]} problems(空数组 = 每个调用点都有归属)
 */
function auditInvocationRegistration(found, table, options = {}) {
  /** @type {string[]} */
  const problems = [];
  const exemptScripts = options.exemptScripts ?? EXEMPT_SCRIPTS;
  const exemptFiles = options.exemptFiles ?? EXEMPT_FILES;
  const carrierScripts = options.carrierScripts ?? new Set();
  const carrierFiles = new Set(options.carrierFiles ?? []);
  // ---- 豁免表自身的 fail-closed:理由缺失/不足即判红,不静默生效 ----
  for (const [name, why] of [...exemptScripts, ...exemptFiles]) {
    const chars = [...String(why).trim()].length;
    if (chars >= EXEMPT_REASON_MIN_CHARS) continue;
    problems.push(
      `豁免表条目 ${name} 的理由只有 ${chars} 字,不足门槛 ${EXEMPT_REASON_MIN_CHARS} 字`
        + " —— 豁免的存在意义是「这一次为什么不算缺口」,理由不足时它与「没登记豁免」在门禁上不可区分。"
        + "补足理由,或把这一项从豁免表里删掉(那说明它不该被豁免)",
    );
  }
  const claimed = claimedSurfaces(table);
  for (const hit of found.values()) {
    const where = hit.onChain ? `链上${hit.onWorkflow ? "(与 workflow)" : ""}` : "workflow 裸调路径";
    const sources = [...hit.sources].join(",");
    if (hit.kind === "npm") {
      if (claimed.scripts.has(hit.name) || exemptScripts.has(hit.name) || carrierScripts.has(hit.name)) continue;
      problems.push(
        `check-1-unregistered-npm:调用点「npm run ${hit.name}」出现在${where}(${sources})但门禁索引的 `
          + `npmScripts 里没有它 —— 新加一道门禁忘了登记,它的载体与链归属都将无人核对`,
      );
      continue;
    }
    if (claimed.files.has(hit.name) || exemptFiles.has(hit.name) || carrierFiles.has(hit.name)) continue;
    problems.push(
      `check-1-unregistered-file:文件级调用点「${hit.name}」出现在${where}(${sources})但门禁索引的 `
        + "modulePath / judgment.module 里没有它 —— workflow 的裸调 fail-fast 步骤也是一条真实调用路径,"
        + "只登记 npm script 会整条漏掉",
    );
  }
  return problems;
}

/* ---------- 格②:自检载体没人认领／不在链上 ---------- */

/**
 * 递归列出门禁脚本树下的负向自检载体(仓相对 POSIX 路径,排序后返回)。
 *
 * **从磁盘派生而不是抄一张常量表**:旧的 `PROBE_CARRIER_SCRIPTS` 随 S4 消失,而「哪个文件是
 * 载体」这件事完全可以从文件名形状派生出来 ⇒ 抄常量等于把一张会被删的表抄进测试树。
 * @param {string} [rootDir] 求值根
 * @returns {string[]} 仓相对 POSIX 路径
 */
function discoverCarrierFiles(rootDir = ROOT) {
  /** @type {string[]} */
  const found = [];
  /**
   * @param {string} relDir 仓相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    const abs = path.join(rootDir, ...relDir.split("/"));
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (entry.name.endsWith(CARRIER_SUFFIX)) found.push(rel);
    }
  };
  walk(GATES_DIR);
  return found;
}

/**
 * 格②判定本体:每个磁盘上的载体都有一条真在链上的 script 跑它。
 *
 * ⚠ **判据形状在 S4 之后变了,变在这里**:旧 registry 的等价判据是
 * 「每个 `PROBE_CARRIER_SCRIPTS` 条目都被某门禁的 `probes[].kind === "selftest"` 认领」
 * ＋「每个 `PROBE_CARRIER_SCRIPTS` 的 script 真在链上」。S4 删掉那张表之后前者**没有对象**
 * —— 新表没有 `probes[]`,`npmScripts` 里一条 `*:selftest` 都没有(实测 39 项零命中)。
 * 故本段把两档改写成**可从磁盘与 package.json 双向对读**的等价形状:
 *   ① **没人认领** = 磁盘上存在这个 `.selftest.mjs`,却**没有任何 npm script 的正文跑它**
 *      ⇒ 它是一段没人执行的代码,改坏或删掉都不会有任何判红;
 *   ② **不在链上** = 有 script 跑它,但那条 script 不在三条链之一 ⇒ 链上因此少了一道负向夹具。
 * 两档合一是因为它们**在 S4 之后是同一条对读**:载体文件 ↔ package.json ↔ 链展开,三个输入
 * 缺一不可。
 *
 * @param {{ carrierFiles: readonly string[], scripts: Record<string, string>, onChainScripts: ReadonlySet<string> }} input 输入
 * @returns {string[]} problems(空数组 = 每个载体都有人认领且真在链上)
 */
function auditCarrierCoverage({ carrierFiles, scripts, onChainScripts }) {
  /** @type {string[]} */
  const problems = [];
  if (carrierFiles.length === 0) {
    problems.push(
      `门禁脚本树下零个 ${CARRIER_SUFFIX} 载体 —— 载体发现面退化为空扫描,而「每个载体都有人认领」`
        + "这一格在零载体下恒绿(恒绿是纯文本判据最坏的失效形态)",
    );
    return problems;
  }
  for (const carrier of carrierFiles) {
    /** @type {string[]} */
    const runners = Object.entries(scripts)
      .filter(([, body]) => new RegExp(String.raw`(?:^|\s)(?:node|electron)\s+${carrier}(?=\s|$)`).test(body))
      .map(([name]) => name)
      .sort();
    if (runners.length === 0) {
      problems.push(
        `check-2-carrier-unclaimed:没有任何 npm script 跑载体 ${carrier} —— 它是一段没人认领、没人执行的代码,`
          + "删掉或改坏都不会触发任何判红。给它加一条 `<name>:selftest` script 并挂上链",
      );
      continue;
    }
    for (const script of runners) {
      if (onChainScripts.has(script)) continue;
      problems.push(
        `check-2-carrier-offchain:跑载体 ${carrier} 的 npm run ${script} 不在 ${CHAIN_ROOTS.join(" / ")} 任一条链上`
          + " —— 载体有人认领只说明它有归属,在链才说明它还在跑;链上因此少了一道负向夹具",
      );
    }
  }
  return problems;
}

/* ---------- 格③:`judgment` 声明谎报可 `import()` ---------- */

/**
 * 模块文本里**顶层**(行首无缩进)的自执行痕迹。**自带一份** —— 旧 `protocol.mjs` 的那份随 S4 消失。
 *
 * 判据只认行首无缩进的语句(顶层作用域),故模块内部的函数体不受影响。
 * @param {string} text 模块文本
 * @returns {string[]} 命中的痕迹(空数组 = 可安全 import)
 */
function topLevelSelfExecutions(text) {
  /** @type {Set<string>} */
  const hits = new Set();
  for (const line of text.split("\n")) {
    if (/^process\.exitCode\s*=/.test(line)) hits.add("顶层 process.exitCode =");
    if (/^process\.exit\(/.test(line)) hits.add("顶层 process.exit(");
    if (/^(?:await\s+)?main[A-Za-z0-9_]*\(/.test(line)) hits.add("顶层 main() 调用");
  }
  return [...hits];
}

/**
 * 格③判定本体:每条 `judgment` 指针都真的可安全 `import()`。
 *
 * ⚠ **只有「谎报可 import」这一个方向**:新表的 `judgment` 结构里**没有 `load` 字段**
 * (5 个字段是 `npmScripts` / `access` / `modulePath` / `judgment` / `enforcement`),
 * 所以「声明 `load:"static"` 却其实可 import」这个反方向在表里**根本没有表达位** ——
 * 它不是已被别处覆盖,而是**已消亡**。本表的契约因此是单一的:凡是登记进来的指针都必须可安全
 * `import()`。顶层自执行的模块一旦登记进来,后果有三种(起 GUI 进程 / 重写文件 / 改宿主
 * `process.exitCode`),故必须在门禁层就拦住,而不是等某段去撞。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {(modulePath: string) => string} readText 读仓内模块文本的注入面
 * @returns {string[]} problems(空数组 = 每条指针都可安全 import)
 */
function auditJudgmentImportability(table, readText) {
  /** @type {string[]} */
  const problems = [];
  const entries = Object.values(table);
  if (entries.length === 0) {
    problems.push("表为空:零项登记意味着「每条 judgment 指针都可安全 import」在零判定面上恒绿");
    return problems;
  }
  for (const raw of entries) {
    const entry = /** @type {{ id?: unknown, judgment?: unknown }} */ (raw);
    const id = String(entry.id);
    const judgment = /** @type {{ module?: unknown } | null | undefined} */ (entry.judgment);
    const modulePath = judgment === null || judgment === undefined ? undefined : judgment.module;
    if (typeof modulePath !== "string") {
      problems.push(`check-3-judgment-nopointer:${id}:judgment 缺 module 指针 —— 「可否安全 import」无从核对`);
      continue;
    }
    let text;
    try {
      text = readText(modulePath);
    } catch (error) {
      problems.push(
        `check-3-judgment-unreadable:${id}:judgment 指向的模块读不到:${modulePath}`
          + `(${error instanceof Error ? error.message : String(error)})`
          + " —— 指针解析不了时「它可安全 import」这句话无人核对",
      );
      continue;
    }
    const selfExec = topLevelSelfExecutions(text);
    if (selfExec.length === 0) continue;
    problems.push(
      `check-3-judgment-self-exec:${id}:judgment 声明 ${modulePath} 可安全 import,`
        + `但它的顶层自执行事实是「${selfExec.join(" + ")}」`
        + " —— import 它等于把门禁真跑一遍(可能起 GUI 进程、重写文件或改掉宿主的 process.exitCode),"
        + "该指针不能登记在这张表里",
    );
  }
  return problems;
}

/* ---------- 格④:调用面非空(恒绿防护) ---------- */

/**
 * 格④判定本体:发现器不许退化成空扫描。
 *
 * 这一格存在的理由是**格①的失效形态**:格①只判「发现到的调用点有没有归属」,发现器若整体坏掉
 * (链根解析失效 / workflow 目录改名 / scripts 表读成空)就会发现零个调用点,格①随即在零判定面
 * 上全绿 —— 而门禁全绿里看不出与「真的查过了」的区别。
 * @param {Map<string, Invocation>} found 调用面发现结果
 * @returns {string[]} problems(空数组 = 调用面非空且两条路径都有命中)
 */
function auditInvocationSurface(found) {
  /** @type {string[]} */
  const problems = [];
  if (found.size === 0) {
    problems.push("check-4-surface-empty:调用路径发现结果为空:所有调用点都会「无主」,格① 形同虚设");
    return problems;
  }
  const onChain = [...found.values()].filter((hit) => hit.onChain).length;
  const onWorkflow = [...found.values()].filter((hit) => hit.onWorkflow).length;
  if (onChain === 0) {
    problems.push(
      `check-4-no-chain:没有发现任何链上的调用点(${CHAIN_ROOTS.join(" / ")} 全部展开失败 —— 链根解析面失效)`,
    );
  }
  if (onWorkflow === 0) {
    problems.push(
      `check-4-no-workflow:没有发现任何 workflow 上的调用点(${WORKFLOWS_DIR} 扫描失效 —— 那正是裸调 fail-fast 路径)`,
    );
  }
  return problems;
}

/* ---------- 真实仓输入 ---------- */

/** @returns {Record<string, string>} package.json 的 scripts 表 */
function realScripts() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};
}

/** @returns {[string, string][]} `[文件名, 文本]` 列表 */
function realWorkflows() {
  const dir = path.join(ROOT, ...WORKFLOWS_DIR.split("/"));
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => [name, readFileSync(path.join(dir, name), "utf8")]);
}

/**
 * 三条链上的 npm script 名(展开去重)。
 * @param {Record<string, string>} scripts scripts 表
 * @returns {Set<string>} script 名集合
 */
function onChainScriptsOf(scripts) {
  /** @type {Set<string>} */
  const out = new Set(CHAIN_ROOTS);
  for (const root of CHAIN_ROOTS) {
    walkChain(scripts, root, {
      onEnter: (node) => {
        if (node.defined) out.add(node.name);
      },
    });
  }
  return out;
}

/** @param {string} relative 仓相对 POSIX 路径 @returns {string} 文件内容 */
function realReadText(relative) {
  return readFileSync(path.join(ROOT, ...relative.split("/")), "utf8");
}

/**
 * 合成一份「改坏了」的表(浅拷贝 + 按 mutate 打故障);真实表一个字节都不碰。
 * @param {(table: Record<string, any>) => void} mutate 故障注入
 * @returns {Record<string, any>} 合成表
 */
function synth(mutate) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, entry] of Object.entries(GATE_INDEX)) {
    out[id] = { ...entry, npmScripts: [...entry.npmScripts] };
  }
  mutate(out);
  return out;
}

/** 合成模块源码:顶层**自执行**(谎报可 import 的被测主体)。仓内不存在该文件。 */
const SELF_EXECUTING_REL = "gates/repo/synthetic-self-executing-judgment.mjs";
const SELF_EXECUTING_TEXT = ["export function main() {", "  return 0;", "}", "process.exitCode = main();", ""].join("\n");

/** 合成模块源码:顶层**干净**(反向锚点,证明格③不是「凡指针即红」)。 */
const CLEAN_MODULE_REL = "gates/repo/synthetic-clean-judgment.mjs";
const CLEAN_MODULE_TEXT = ["export function main() {", "  return 0;", "}", ""].join("\n");

/**
 * 格⑤的注入面工厂:只把 `package.json` 换成合成文本,其余一律走真实根。
 *
 * ⚠ **只换 package.json**:契约门禁的判定还会读 lockfile / 两条 workflow / 磁盘顶层,
 * 那些若也换成合成文本,判红会来自一堆无关断言,离根因隔着一层。换成合成 package.json 时
 * 判红**只可能**来自「链形态 / 链序 / 接入点」这一族 —— 那正是格⑤要验的东西。
 * @param {(scripts: Record<string, string>) => void} mutate scripts 表改写
 * @returns {Parameters<typeof checkContract>[0]} 判定注入面
 */
function contractCtxWith(mutate) {
  const pkg = JSON.parse(realReadText("package.json"));
  mutate(/** @type {Record<string, string>} */ (pkg.scripts));
  const patched = JSON.stringify(pkg);
  return {
    root: ROOT,
    readText: (/** @type {string} */ relative) => (relative === "package.json" ? patched : realReadText(relative)),
  };
}

/**
 * 断言 problems 里逐条点名地出现了某段文案(不比对条数 —— 判据退化成恒返回空数组时条数也是 0)。
 * @param {string[]} problems 判定结论
 * @param {RegExp} expected 期望命中的诊断片段
 * @param {string} what 夹具名(失败消息里点明是哪一条夹具)
 * @returns {void}
 */
function expectRed(problems, expected, what) {
  const joined = problems.join("\n");
  if (expected.test(joined)) return;
  throw new Error(
    `[${what}] 期望判红并匹配 ${expected},实际:${problems.length === 0 ? "零问题(恒绿!)" : `\n${joined}`}`,
  );
}

/**
 * 断言 problems 为空(锚点:正向不成立时,下面那些负向结论一律不成立)。
 * @param {string[]} problems 判定结论
 * @param {string} what 锚点名
 * @returns {void}
 */
function expectGreen(problems, what) {
  if (problems.length === 0) return;
  throw new Error(`[${what}] 期望零判红,实际 ${problems.length} 条\n${problems.join("\n")}`);
}

/**
 * 跑某个载体的 npm script 名集合(从 package.json 反查,与格②的「认领」口径同源)。
 *
 * 存在的理由:格①要把载体整个豁免出判定面(它不是门禁),而豁免集必须**从磁盘派生**
 * —— 旧的 `PROBE_CARRIER_SCRIPTS` 随 S4 消失,抄进测试树就等于把一张会被删的表钉在测试侧。
 * @param {Record<string, string>} scripts scripts 表
 * @param {readonly string[]} carrierFiles 仓相对载体路径
 * @returns {Set<string>} script 名集合
 */
function carrierScriptsOf(scripts, carrierFiles) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const carrier of carrierFiles) {
    const re = new RegExp(String.raw`(?:^|\s)(?:node|electron)\s+${carrier}(?=\s|$)`);
    for (const [name, body] of Object.entries(scripts)) {
      if (re.test(body)) out.add(name);
    }
  }
  return out;
}

export async function run() {
  const suite = createCaseSuite();
  const scripts = realScripts();
  const workflows = realWorkflows();
  const found = discoverInvocations(scripts, workflows);
  const onChainScripts = onChainScriptsOf(scripts);
  const carrierFiles = discoverCarrierFiles();
  const carrierScripts = carrierScriptsOf(scripts, carrierFiles);

  /* ---------- 格④:调用面非空(先跑:它是格①的前置锚点) ---------- */
  await suite.describe("格④ · 调用面非空(发现器退化成空扫描的恒绿防护)", async () => {
    await suite.case("真实仓:调用面非空且链与 workflow 两条路径都有命中", () => {
      expectGreen(auditInvocationSurface(found), "锚点");
      const onChain = [...found.values()].filter((hit) => hit.onChain).length;
      const onWorkflow = [...found.values()].filter((hit) => hit.onWorkflow).length;
      console.log(
        `  [gate-index] 调用点 ${found.size} 个(链上 ${onChain} · workflow ${onWorkflow});`
        + `链根 ${CHAIN_ROOTS.join("/")};载体 ${carrierFiles.length} 个`,
      );
    });

    await suite.case("负向夹具·空 scripts 表 ⇒ 零调用点 ⇒ 判红", () => {
      expectRed(
        auditInvocationSurface(discoverInvocations({}, [])),
        /调用路径发现结果为空:所有调用点都会「无主」,格① 形同虚设/,
        "调用面-空扫描",
      );
    });

    await suite.case("负向夹具·只扫链不扫 workflow ⇒ 裸调路径整条丢失 ⇒ 判红", () => {
      expectRed(
        auditInvocationSurface(discoverInvocations(scripts, [])),
        /没有发现任何 workflow 上的调用点/,
        "调用面-无 workflow",
      );
    });

    await suite.case("负向夹具·三条链全不在 scripts 表里 ⇒ 链上零命中 ⇒ 判红", () => {
      /** @type {Record<string, string>} */
      const stripped = {};
      for (const [name, body] of Object.entries(scripts)) {
        if (CHAIN_ROOTS.includes(name)) continue;
        stripped[name] = body;
      }
      expectRed(
        auditInvocationSurface(discoverInvocations(stripped, workflows)),
        new RegExp(`没有发现任何链上的调用点\\(${CHAIN_ROOTS.join(" / ")} 全部展开失败`),
        "调用面-无链",
      );
    });
  });

  /* ---------- 格①:链上新出现的门禁／裸调路径无人登记 ---------- */
  await suite.describe("格① · 链上新出现的门禁／裸调路径无人登记", async () => {
    await suite.case("真实仓:每个调用点都有归属(锚点)", () => {
      expectGreen(
        auditInvocationRegistration(found, GATE_INDEX, { carrierScripts, carrierFiles }),
        "锚点",
      );
    });

    await suite.case("负向夹具·链上新出现一道门禁但索引里没登记 ⇒ 判红并点名", () => {
      // 挂上链:把它塞进 verify:ci 正文让发现面真看见它(只改内存里的 scripts 表,
      // package.json 磁盘文件一个字节都不碰)。
      const polluted = discoverInvocations(
        { ...scripts, "check:brand-new": "node gates/repo/check-brand-new.mjs",
          "verify:ci": `npm run check:brand-new && ${String(scripts["verify:ci"])}` },
        workflows,
      );
      if (!polluted.get("npm:check:brand-new")?.onChain) {
        throw new Error("合成 scripts 里 check:brand-new 未被链展开发现为链上调用点,夹具前提不成立");
      }
      expectRed(
        auditInvocationRegistration(polluted, GATE_INDEX, { carrierScripts, carrierFiles }),
        /check-1-unregistered-npm:调用点「npm run check:brand-new」出现在链上/,
        "链上新门禁未登记",
      );
    });

    await suite.case("负向夹具·workflow 裸调一条无人登记的门禁本体 ⇒ 判红并点名", () => {
      const polluted = discoverInvocations(scripts, [
        ...workflows,
        ["synthetic.yml", "      - run: node gates/repo/check-not-registered.mjs\n"],
      ]);
      expectRed(
        auditInvocationRegistration(polluted, GATE_INDEX, { carrierScripts, carrierFiles }),
        /check-1-unregistered-file:文件级调用点「gates\/repo\/check-not-registered\.mjs」出现在workflow 裸调路径/,
        "裸调路径无主",
      );
    });

    await suite.case("反向锚点·`gen:*` / `start` 这类同门禁另一条入口不在链上不判红", () => {
      // 把两道门禁的 gen 侧 / 开发侧入口从表里整条摘掉(它们不在链上 ⇒ 不是缺口),
      // 判据必须仍然判绿 —— 这正是旧 registry R5a 的裁决,别把它当缺口。
      const green = synth((table) => {
        table["archive-index"].npmScripts = ["check:archive-index"];
        table["build-fresh"].npmScripts = ["test:smoke"];
      });
      expectGreen(
        auditInvocationRegistration(found, green, { carrierScripts, carrierFiles }),
        "gen/start 另一条入口",
      );
    });

    await suite.case("反向锚点·载体 script 不在格①判定面内(它是格②的判据对象)", () => {
      // 载体既不是门禁也不该被要求登记进 npmScripts;豁免集从磁盘派生 ⇒ 必须判绿。
      const withoutCarrierExemption = auditInvocationRegistration(found, GATE_INDEX, {
        exemptScripts: new Map([...EXEMPT_SCRIPTS]),
        exemptFiles: new Map([...EXEMPT_FILES]),
      });
      expectRed(
        withoutCarrierExemption,
        /check-1-unregistered-npm:调用点「npm run check:gate-index:selftest」/,
        "载体豁免的必要性(反向证明:不豁免就会误伤)",
      );
      expectGreen(
        auditInvocationRegistration(found, GATE_INDEX, { carrierScripts, carrierFiles }),
        "载体豁免锚点",
      );
    });

    await suite.case("负向夹具·豁免表里理由不足的条目不许静默生效 ⇒ 判红并点名", () => {
      // 豁免没有(足够)理由 = 「把一道真门禁悄悄挪进豁免」,与不豁免同判准。
      const exemptions = new Map(EXEMPT_SCRIPTS);
      exemptions.set("check:contract", "太短");
      expectRed(
        auditInvocationRegistration(found, GATE_INDEX, { exemptScripts: exemptions, carrierScripts, carrierFiles }),
        /豁免表条目 check:contract 的理由只有 2 字,不足门槛 20 字/,
        "豁免理由不足",
      );
    });
  });

  /* ---------- 格②:自检载体没人认领／不在链上 ---------- */
  await suite.describe("格② · 自检载体没人认领／不在链上", async () => {
    await suite.case("真实仓:每个载体都有人认领且真在链上(锚点)", () => {
      expectGreen(
        auditCarrierCoverage({ carrierFiles, scripts, onChainScripts }),
        "锚点",
      );
    });

    await suite.case("负向夹具·磁盘上多出一个没人跑的载体 ⇒ 判红并点名", () => {
      const orphan = `${GATES_DIR}/repo/check-brand-new.selftest.mjs`;
      expectRed(
        auditCarrierCoverage({ carrierFiles: [...carrierFiles, orphan], scripts, onChainScripts }),
        new RegExp(`check-2-carrier-unclaimed:没有任何 npm script 跑载体 ${orphan.replace(/[/.]/g, (c) => `\\${c}`)}`),
        "载体无主",
      );
    });

    await suite.case("负向夹具·把一条载体 script 从链上摘掉 ⇒ 判红并点名(认领≠在跑)", () => {
      const carrier = `${GATES_DIR}/repo/check-ci-contract.selftest.mjs`;
      const runner = "check:contract:selftest";
      const thinned = new Set([...onChainScripts].filter((name) => name !== runner));
      const problems = auditCarrierCoverage({ carrierFiles, scripts, onChainScripts: thinned });
      expectRed(
        problems,
        new RegExp(`check-2-carrier-offchain:跑载体 ${carrier.replace(/[/.]/g, (c) => `\\${c}`)} 的 npm run ${runner} 不在 `),
        "载体脱链",
      );
      // 判红必须**只**来自这一格:反向锚点证明注入面干净
      const noise = problems.filter((line) => !line.includes(`npm run ${runner} 不在 `));
      if (noise.length > 0) throw new Error(`脱链注入之外还冒出了别的判红(夹具注入面不干净):\n${noise.join("\n")}`);
    });

    await suite.case("负向夹具·零载体(发现面退化为空扫描)⇒ 判红(不静默恒绿)", () => {
      expectRed(
        auditCarrierCoverage({ carrierFiles: [], scripts, onChainScripts }),
        /零个 \.selftest\.mjs 载体/,
        "载体面塌缩",
      );
    });
  });

  /* ---------- 格③:`judgment` 声明谎报可 import() ---------- */
  await suite.describe("格③ · judgment 声明谎报可 import()", async () => {
    await suite.case("真实仓:每条 judgment 指针都真可安全 import(锚点)", () => {
      // 锚点的前置:本段 import 的那张表必须真在 `GATE_INDEX_MODULE_REL` 声明的位置上 ——
      // 表被改名/搬走而本段没跟上时,「每条指针可安全 import」会在**另一张表**上判绿。
      expectGreen(auditJudgmentImportability(GATE_INDEX, realReadText), "锚点");
      const declared = realReadText(GATE_INDEX_MODULE_REL);
      if (!/export\s+const\s+GATE_INDEX\b/.test(declared)) {
        throw new Error(
          `${GATE_INDEX_MODULE_REL} 不导出 GATE_INDEX —— 本段判的不是那张表,锚点无意义`,
        );
      }
    });

    await suite.case("负向夹具·指针指向顶层自执行的合成模块 ⇒ 判红并点名", () => {
      const readText = (/** @type {string} */ rel) =>
        (rel === SELF_EXECUTING_REL ? SELF_EXECUTING_TEXT : realReadText(rel));
      const table = synth((t) => {
        t["docs"].judgment = { module: SELF_EXECUTING_REL, export: "main", shaped: "退出码" };
      });
      expectRed(
        auditJudgmentImportability(table, readText),
        /check-3-judgment-self-exec:docs:judgment 声明 .* 可安全 import,但它的顶层自执行事实是「顶层 process\.exitCode =」/,
        "谎报可 import",
      );
    });

    await suite.case("负向夹具·指针指向读不到的模块 ⇒ 判红(解析不了不许静默放过)", () => {
      const table = synth((t) => {
        t["docs"].judgment = { module: `${GATES_DIR}/repo/no-such-judgment.mjs`, export: "main" };
      });
      expectRed(
        auditJudgmentImportability(table, realReadText),
        /check-3-judgment-unreadable:docs:judgment 指向的模块读不到:gates\/repo\/no-such-judgment\.mjs/,
        "指针悬空",
      );
    });

    await suite.case("反向锚点·顶层干净的合成模块 ⇒ 不判红(证明不是「凡指针即红」)", () => {
      const readText = (/** @type {string} */ rel) => (rel === CLEAN_MODULE_REL ? CLEAN_MODULE_TEXT : realReadText(rel));
      const table = synth((t) => {
        t["docs"].judgment = { module: CLEAN_MODULE_REL, export: "main", shaped: "退出码" };
      });
      expectGreen(auditJudgmentImportability(table, readText), "顶层干净锚点");
    });

    await suite.case("反向锚点·空表 ⇒ 判红(零项登记是恒绿形态)", () => {
      expectRed(auditJudgmentImportability({}, realReadText), /表为空/, "空表");
    });
  });

  /* ---------- 格⑤:契约门禁判定本体在注入根上求值 ---------- */
  await suite.describe("格⑤ · 契约门禁判定本体在注入根上求值(链序约束不误伤机制)", async () => {
    await suite.case("真实根上零问题(锚点:证明下面的负向对照有意义)", () => {
      expectGreen(checkContract(), "锚点");
    });

    await suite.case("负向夹具·注入根上从 verify:ci 摘掉一道门禁 ⇒ 判定立刻判红并点名", () => {
      const problems = checkContract(
        contractCtxWith((s) => {
          // check:geometry 是链尾一步(后面没有 `&&`),故按 `&& npm run X` 形态摘。
          const before = String(s["verify:ci"]);
          const after = before.replace("&& npm run check:geometry", "");
          if (after === before) throw new Error("verify:ci 里没找到 `&& npm run check:geometry`,夹具前提不成立(链形态变了)");
          s["verify:ci"] = after;
        }),
      );
      expectRed(problems, /verify:ci 缺少门禁步骤 check:geometry/, "链上缺步骤");
    });

    await suite.case("负向夹具·注入根上把 check:boundary 挪到 build 之后 ⇒ 链序约束判红", () => {
      const problems = checkContract(
        contractCtxWith((s) => {
          s["verify:ci"] = String(s["verify:ci"])
            .replace("npm run check:boundary && ", "")
            .replace("npm run build && ", "npm run build && npm run check:boundary && ");
        }),
      );
      expectRed(problems, /verify:ci 须先 check:boundary 再 build/, "链序乱序");
    });

    await suite.case("负向夹具·注入根上 verify:release 自行拼第二份清单 ⇒ 形态断言判红", () => {
      const problems = checkContract(
        contractCtxWith((s) => {
          s["verify:release"] = "npm run verify:ci && npm run dist && npm run check:boundary";
        }),
      );
      expectRed(problems, /verify:release 须恰为 verify:ci \+ dist/, "release 形态");
    });

    await suite.case("撤回注入后复绿(三步验法第三步:否则这几格是恒红判据)", () => {
      // 只换 scripts 表的键序、内容逐字不变 ⇒ 必须回到零问题。
      const untouched = checkContract(contractCtxWith(() => {}));
      expectGreen(untouched, "撤回注入");
    });
  });

  console.log(
    `[ok] gate-index:索引 ${Object.keys(GATE_INDEX).length} 项 / 调用点 ${found.size} 个 / 载体 ${carrierFiles.length} 个;`
      + "五格判据各有能变红的负向夹具,撤回注入后逐格复绿",
  );
  return { cases: suite.results };
}