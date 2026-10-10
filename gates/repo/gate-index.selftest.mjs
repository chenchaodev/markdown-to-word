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
// ---- 本载体现在的判定面(全部是表自身成立性) ----
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
//   ④ **`access` 取值域**(`chain` / `offchain` 两值)+ **`enforcement` 指针**(禁自指 ·
//      `<模块>#<导出>` 形态 · 真解析)。禁自指那一档是**纯文本**判定,与 ③ 的真 `import()`
//      分开跑:合成根上去 import 本表只会得到「解析失败」,症状离根因隔着一层。
//   ⑤ **`modulePath` / `judgment.module` 必须指 git 跟踪的源文件**(REQ-187 C2,见下)。
//
// ---- ⑤ 的判据口径:「git 跟踪」怎么查(后来者必读,判据本体依赖 git 状态)----
// **命令**:`git ls-files -z`,`cwd` = `shared/paths.js` 的 `ROOT`,读 `.git/index`。
// **为什么这一条够用**:`ls-files` 枚举的是**索引**(已 `git add` 过的路径),不是工作树 ——
//   ① **天然离线**:它不碰网络、不碰远端,`git ls-files` 在无网环境与 `npm ci` 之前照样跑;
//   ② **与本机 build 过没有无关**:`dist/` 被 `.gitignore:3` 整棵排除 ⇒ 它的路径**永远**不在
//      跟踪集里,哪怕本机刚 build 过、`dist/main/smoke.js` 就在那儿 ⇒ 判据结果**可复现**
//      (这正是不用 `existsSync` 的理由:`existsSync("dist/main/smoke.js")` 随本机状态翻转,
//      同一个 commit 在两台机器上会给出相反结论)。
// **为什么用 `-z`**:NUL 分隔 ⇒ 路径**原样输出**,不吃 `core.quotePath` 的转义 ⇒ 含中文/空格的
//   路径不会被引号包起来而与索引里的真值对不上。
// **离线/异常一律判红(fail closed),不降级 report-only**:`git` 缺失、不在仓内、非零退出、
//   或拿到空集,一律进同一条「未经跟踪核对」诊断。理由与本文件头「删掉之后不许留一个
//   report-only 的『无法对读』占位」同源 —— 「查不到」在门禁上与「查过了且全是指向源文件」
//   **不可区分**,放过去就是恒绿。(「不在仓内」这一档真的会在归档包/`npm pack` 里出现,
//   但那时**整条链都跑不起来**,判红是正确结果而不是误伤。)
// **取不到集时整表判红而不是逐条**:失败是全局的(一次 `ls-files`),逐条点名只会把同一条
//   根因复制 N 遍并淹没真正的漂移。
//
// ---- ⑤ 只判「索引项的指针」,**不是**「仓里不许出现 dist 路径」 ----
// ⚠ `dist/**` 出现在**别的段的 import** 里是**正常的**(TS 源就得 import 编译产物,
// `gates/smoke/smoke-proc.mjs` 就 import `dist/main/smoke.js`)。本族判红的只有
// `modulePath` 与 `judgment.module` 这两个**位置**:它们指向「门禁本体 / 判定体」——
// 指向构建产物意味着**门禁的判定逻辑本身住在构建产物里**,构建一清就失效、它在不在取决于
// 本机 build 过没有。反向锚点见夹具「源在 src/** 的 .ts 与 test/** 的 .js ⇒ 不判红」:
// `src/main/smoke.ts` 与
// `test/core/dual-pipeline-matrix.test.js` 都是**源**,必须放行 —— 判据写成「必须是 .mjs」
// 或「必须在 gates/ 下」都会误伤它们。
//
// ⚠ **⑤ 与 L11b `gate-module-present` 是两族,语义不同源**:那一族判「索引说 X 而树里无 X」
// (存在性);本族判「X 是不是 git 跟踪的源文件」(可提交性)。两者的差集正是要抓的那一档:
// **文件在工作树里存在、但不被 git 跟踪** —— L11b 对它完全无感(`existsSync` 为真),
// 而它恰恰是最坏的一档(本机能跑、别人的 clone 里没有)。
//
// ⚠ **本族不覆盖 `enforcement` 指针的模块段**:REQ-187 C2 的裁决只点了 `modulePath` 与
// `judgment.module` 两处,`enforcement` 未纳入(它另有禁自指 / 形态 / 解析三档)。这一处
// 若日后要纳入,是**扩范围**的裁决,不在本族默认范围内。
//
// ---- 为什么「审计」住在载体里、不住在表里 ----
// `gate-index.mjs` 是**零 import 的纯数据表**(它必须零 import:一旦它自己会 `import()` 别处,
// 「禁自指」这条规则要防的死锁就落在它头上了)。给它加一个会 `import()` 的审计函数 = 让数据表
// 做 IO,而那个 IO 恰好就是它必须避免的形态。
//
// ⚠ **不修改被测表、也不复制它**:夹具里出现的是**合成表**(纯对象字面量),真实表只被**读**。
// 与 `check-test-layout.selftest.mjs` 的合成根不同构 —— 真实表只被读一次,故本载体
// **零临时目录、零写盘**。
// ⚠ **⚠ 但它现在有 IO(判据口径变了,这条约束跟着变)**:⑤ 族要查「git 跟踪」⇒ 会起
// `git ls-files -z` / `git check-ignore -q` 子进程(REQ-187 C2 新增)。**仍然不写盘**,
// **仍然零临时目录** —— 与「不落任何东西」的差别要说清,否则后来者按旧注记判断会以为
// 本载体可以在任意只读/沙箱环境跑(实测不行:不在 git 仓内时 ⑤ 族 fail closed 判红)。
//
// ⚠ **恒绿防护**:每条判据都**自己**调判定函数并比对**诊断文案**(而不是只看条数),否则
// 「判定函数恒返回空数组」这一种退化实现能让全部负向夹具通过 —— 那是最坏的失效形态。
// 另两处:① 每族都有**空表 / 零发现**那一档(零判定面上的全绿与「真查过了」不可区分);
// ② `enforcement` 与 ⑤ 族各有一处**覆盖面自检**(整条删掉时零 problems 不该成立)。
//
// ---- 形态:接 case 契约;**不接 harness**,**也不搬判定体**(ADR-074 决定一 + 两档结论)----
//
// 夹具表 41 条逐条收进 `await suite.case(档名, () => runCase(档))`,「档数」由此成为可机械计数的
// 单位(`gates-selftest-named-case` 判的就是它),迁移后分母由 `suite.results.length` 给出(= 41)。
// 门禁树接的是落在 `shared/` 的真实现:`gates-stay-in-gates` 的允许面只有 `gates` / `shared` /
// `test/fixtures`,`test/` 整棵树不在其中,故引不到 `test/harness/case.js`(ADR-074 决定一)。
//
// **不接 harness**:本载体的入参是**表对象**(`GATE_INDEX` 数据表 + 可注入 loader),既不是
// 「树型路径 → 正文」也不是「问题清单」,与 harness schema **入参与返回双侧不对型** ——
// 塞进去是假接入(ADR-068:bespoke 留在原处)。
//
// ⚠ **也不搬判定体**(与 ADR-074 背景二原写的那句相反 —— **该条前提已作废**):那六个
// `audit*` 带着 `spawnSync(git)` 等 IO,而 `gate-index.mjs` 是**零 import 的纯数据表**、且被别的
// 门禁消费,搬进去等于给数据表塞 IO,也与本文件头「为什么『审计』住在载体里、不住在表里」自相矛盾。
// 「进 harness」与「接契约」分属两档:本份入档的是「接契约」这一档,harness 那一档不适用。

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
import { GATE_INDEX, GATE_INDEX_MODULE_REL } from "./gate-index.mjs";

const projectRoot = ROOT;

/**
 * `.gitignore` 命中查询(只影响诊断文案点不点名「构建产物」那一档,**不参与判定结论** ——
 * 「不是跟踪路径」这一条已经判红了,这一档只是让读者不必自己去猜是哪一种)。
 *
 * ⚠ 用 `git check-ignore`(而不是自己解析 `.gitignore`):`.gitignore` 有否定规则、目录级
 * 规则、嵌套 `.gitignore`、以及 `core.excludesFile`,手写解析器必然漏其中一种,而漏掉的那
 * 一种会让文案少点一个名 —— **结论不变**,故这不是判定面。
 * @param {string} repoRelativePath 仓相对 POSIX 路径
 * @returns {boolean} 是否被 ignore
 */
export function realIsIgnored(repoRelativePath) {
  const result = spawnSync("git", ["check-ignore", "-q", "--", repoRelativePath], {
    cwd: projectRoot,
    windowsHide: true,
  });
  return result.status === 0;
}

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
 * 已实测确认**全表每一项**的 `judgment.module` **全部零顶层自执行**(顶层 `process.exit` /
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
 * 真跟踪集:一次 `git ls-files -z` 把索引里的全部路径读成一个 `Set`。
 *
 * ⚠ **口径与异常行为见文件头「⑤ 的判据口径」一节**(命令 · 为何用索引而非工作树 · 为何用
 * `-z` · 离线与异常一律 fail closed)。此处只补实现细节:
 *   - `cwd` 传 `ROOT`:**不在仓内时 `git ls-files` 自己会非零退出**,不需要我们判「是不是仓」。
 *   - `status !== 0` / `error` / `stdout` 不是字符串 / 解析出空集 ⇒ 一律返回 `null`,
 *     由 `auditSourceFilePointers` 转成那一条「未经跟踪核对」的判红(fail closed)。
 *   - **不缓存**:夹具逐条现取,缓存会让「同一进程内两次 git 状态不同」这类漂移看不出来;
 *     全表跑一次 `ls-files` 的代价可忽略。
 *
 * @param {string} [cwd] 仓根
 * @returns {Set<string> | null} 跟踪路径集(仓相对 POSIX);取不到即 null
 */
export function realTrackedSet(cwd = projectRoot) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  if (typeof result.stdout !== "string") return null;
  const paths = new Set();
  for (const chunk of result.stdout.split("\0")) {
    if (chunk !== "") paths.add(chunk);
  }
  return paths.size === 0 ? null : paths;
}

/**
 * ⑤ `modulePath` / `judgment.module` 必须是 **git 跟踪的源文件**(REQ-187 C2)。
 *
 * ⚠ **为什么值得单独一族**:前几族判的都是「指针解不解得开」(真 `import()` 到、导出名在)
 * 与「形态对不对」。「`modulePath` 指向 `dist/**`」这一类**前几族全部无感** ——
 * `dist/main/smoke.js` 真能 `import()` 到(本机 build 过时)、形态也完全合法,于是它一路绿;
 * 而它意味着**门禁本体或判定本体住在构建产物里**:构建一清就失效、它在不在取决于本机
 * build 过没有 ⇒ 别人 clone 下来「这道门禁」与「本机这道门禁」不是同一道。
 * 存在性那一族(L11b `gate-module-present`)同样无感 —— 工作树里它在,`existsSync` 为真。
 *
 * ⚠ **判据只用「是不是 git 跟踪」这一个问句,不叠「必须是 .mjs」「必须在 gates/ 下」**:
 * `smoke` 那项的 `modulePath` 是 `src/main/smoke.ts`(TS 源)、`dual-matrix` 的是
 * `test/core/dual-pipeline-matrix.test.js` —— 都是**源**,叠扩展名/目录白名单会误伤它们
 * (反向锚点夹具钉住这一点)。「构建产物 / 被 ignore 的路径 / 仓外路径」三者在
 * 「不是跟踪路径」这一个问句下**同档**,诊断文案分别点名是哪一种。
 *
 * ⚠ **缺指针在这里也判红**:指针都没有时「是不是源文件」无从核对 —— 那正是「门禁本体搬走
 * 而指针忘了改」的形态。与 ③ 的「缺 module 指针」不是同一族(那一族判解不开,这一族判跟踪性),
 * 但两条都在场才是完整的:缺指针 ⇒ 解不开 + 无从核对跟踪性。
 *
 * @param {Readonly<Record<string, object>>} table 门禁表
 * @param {object} options
 * @param {ReadonlySet<string> | null} [options.tracked] git 跟踪路径集(注入面:`null`
 *   或缺省 = 取不到 ⇒ fail closed);真实运行传 `realTrackedSet()` 的返回值
 * @param {(p: string) => boolean} [options.isIgnored] `.gitignore` 命中查询(可选,只影响
 *   诊断文案里点不点名「构建产物」那一档);缺省即不点名,判定结论不变
 * @returns {string[]} problems(空数组 = 每条指针都指 git 跟踪的源文件)
 */
export function auditSourceFilePointers(table, options = {}) {
  /** @type {string[]} */
  const problems = [];
  const keys = Object.keys(table);
  if (keys.length === 0) {
    problems.push("表为空:零项登记意味着「每条指针都指 git 跟踪的源文件」在零判定面上恒绿(恒绿形态)");
    return problems;
  }
  const tracked = options.tracked;
  if (tracked === undefined || tracked === null || typeof tracked.has !== "function") {
    problems.push(
      "全表指针未经跟踪核对(`git ls-files -z` 取不到跟踪集:不在仓内 / git 缺失 / 非零退出)"
      + " —— 判红不放行:「查不到」在门禁上与「查过了且全是指向源文件」不可区分,放过去就是恒绿",
    );
    return problems;
  }
  for (const key of keys) {
    const entry = table[key];
    const id = entry === undefined || entry === null ? String(entry?.id ?? key) : String(entry.id ?? key);
    const judgment = entry === undefined || entry === null ? undefined : entry.judgment;
    /** @type {readonly (readonly [string, unknown])[]} 两个受审字段与它们的值 */
    const fields = /** @type {const} */ ([
      ["modulePath", entry === undefined || entry === null ? undefined : entry.modulePath],
      ["judgment.module", judgment === undefined || judgment === null ? undefined : judgment.module],
    ]);
    for (const [field, value] of fields) {
      if (typeof value !== "string" || value === "") {
        problems.push(
          `${id}:${field} 缺指针 —— 「它是不是 git 跟踪的源文件」无从核对,`
          + "而「门禁本体/判定体搬走、指针忘了改」正是这一档",
        );
        continue;
      }
      if (tracked.has(value)) continue;
      const ignored = typeof options.isIgnored === "function" && options.isIgnored(value);
      problems.push(
        `${id}:${field} 指向的 ${value} 不是 git 跟踪的源文件`
        + `${ignored ? "(落在 .gitignore 内 —— 构建产物)" : ""}`
        + " —— 门禁本体/判定体住在构建产物或仓外路径上:构建一清就失效,"
        + "它在不在取决于本机 build 过没有,别人的 clone 里这道门禁就不是同一道",
      );
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
  // ---- ⑦ modulePath / judgment.module 必须是 git 跟踪的源文件(REQ-187 C2)----
  {
    // **正向锚点**:真实表**每一项**的两条指针(`modulePath` 与 `judgment.module`,即项数 x2)
    // 全部是 git 跟踪的路径。这一格缺了的话,
    // 下面几条负向可能只是「恒红」—— 而恒红的守卫与恒绿的守卫一样没用。
    name: "源文件指针:真实表每条 modulePath / judgment.module 都是 git 跟踪的源文件(锚点)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(realTable, { tracked: realTrackedSet(), isIgnored: realIsIgnored }),
    expect: null,
  },
  {
    // **反向锚点(本族存在的理由的一半)**:门禁本体住在 `src/**` 的 TS 源里是既有裁决
    // (`smoke` 那项,注释明写「本体是 TypeScript,编译进 dist 随包分发,离线核不到」)。
    // 判据若写成「必须是 .mjs」或「必须在 gates/ 下」就会误伤它 ⇒ 必须显式钉住不判红。
    // 这一格也钉住另一条既有事实:合成表里指向 `test/**` 的判定体(dual-matrix)同样是源。
    name: "源文件指针反向锚点:源在 src/** 的 .ts 与 test/** 的 .js ⇒ 不判红(不得按扩展名/目录误伤)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(
      {
        ts: {
          id: "ts",
          access: "chain",
          npmScripts: ["test:smoke"],
          modulePath: "src/main/smoke.ts",
          judgment: { module: "gates/smoke/smoke-proc.mjs", export: "collectSmokeProblems" },
        },
        inTest: {
          id: "inTest",
          access: "offchain",
          npmScripts: [],
          modulePath: "test/core/dual-pipeline-matrix.test.js",
          judgment: { module: "test/core/dual-pipeline-matrix.test.js", export: "run" },
        },
      },
      { tracked: realTrackedSet(), isIgnored: realIsIgnored },
    ),
    expect: null,
  },
  {
    // **负向夹具(本族存在的理由的另一半)**:`modulePath` 指向构建产物 ⇒ 必须判红。
    // ⚠ **变异是真的改变行为**:`smoke` 是合成表的浅拷贝改写,**没有** `if (false)` 之类空操作 ——
    // 去掉这一行变异,本夹具立刻变成零判红并失败(正向锚点那一格就是对照)。
    // ⚠ **判据落在跟踪集而不是 `existsSync`**:`dist/main/smoke.js` 在本机 build 过时**确实存在**,
    // 用存在性判据这一格会绿 —— 那正是要消灭的误判(结果随本机状态翻转)。
    name: "源文件指针负向:modulePath 指 dist/** 构建产物 ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(
      { ...realTable, smoke: { ...realTable.smoke, modulePath: "dist/main/smoke.js" } },
      { tracked: realTrackedSet(), isIgnored: realIsIgnored },
    ),
    expect: /smoke:modulePath 指向的 dist\/main\/smoke\.js 不是 git 跟踪的源文件\(落在 \.gitignore 内 —— 构建产物\)/,
  },
  {
    // 同一个洞的另一个位置:`judgment.module`(判定体)指构建产物。`modulePath` 保持合法
    // (指向真源)⇒ 这一格验的是「判定体那一侧也被审」,而不是「上面那一格重复一遍」。
    name: "源文件指针负向:judgment.module 指 dist/** 构建产物 ⇒ 判红并点名",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(
      {
        bad: {
          ...SYNTHETIC("bad"),
          modulePath: "gates/repo/check-test-layout.mjs",
          judgment: { module: "dist/main/index.js", export: "main" },
        },
      },
      { tracked: realTrackedSet(), isIgnored: realIsIgnored },
    ),
    expect: /bad:judgment\.module 指向的 dist\/main\/index\.js 不是 git 跟踪的源文件/,
  },
  {
    // **仓外/绝对路径**那一档:不在跟踪集里,但 `existsSync` 为真(本机确实有那个文件)。
    // 与上一格同属「不是跟踪路径」,但点名方式不同 ⇒ 证明诊断文案把两种形态分开。
    // 用 `C:\\` 字面量而非真去查:本条只验「不是跟踪路径 ⇒ 判红」,查不查得到那台机器上的文件
    // 与判定无关(不在索引里就是不在索引里)。
    name: "源文件指针负向:指针是仓外绝对路径 ⇒ 判红(存在性判据对它完全无感)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(
      { bad: { ...SYNTHETIC("bad"), modulePath: "C:/elsewhere/check-x.mjs" } },
      { tracked: realTrackedSet(), isIgnored: realIsIgnored },
    ),
    expect: /bad:modulePath 指向的 C:\/elsewhere\/check-x\.mjs 不是 git 跟踪的源文件/,
  },
  {
    // **缺指针**那一档:指针都没有时「是不是源文件」无从核对。刻意与 judgment 解析族的
    // 「缺 module 指针」分开:那一格会在 `SYNTHETIC("bad")`(它带 modulePath)上误触发吗?不会
    // —— 合成表的 `SYNTHETIC` 不带 `judgment`,两族各判各的字段。
    name: "源文件指针负向:缺 modulePath / judgment.module ⇒ 判红(本体搬走而指针没改)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(
      { nameless: { id: "nameless", access: "offchain", npmScripts: [] } },
      { tracked: realTrackedSet(), isIgnored: realIsIgnored },
    ),
    expect: /nameless:modulePath 缺指针 —— 「它是不是 git 跟踪的源文件」无从核对/,
  },
  {
    // **fail closed**:跟踪集取不到(`null` —— 不在仓内 / git 缺失 / 非零退出)⇒ 整表判红,
    // **不许**静默放过。突变是真的:去掉这个变异(传真跟踪集)本夹具立即零判红。
    name: "源文件指针负向:跟踪集取不到(null)⇒ 整表判红(fail closed,不许当恒绿放过)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(realTable, { tracked: null }),
    expect: /全表指针未经跟踪核对\(`git ls-files -z` 取不到跟踪集:不在仓内 \/ git 缺失 \/ 非零退出\)/,
  },
  {
    // 注入面缺省(`options.tracked` 未传)与传 `null` 同档 —— 前者是调用方忘了注入,
    // 后者是 git 真取不到。两条分开钉,否则「忘了注入」这一种最可能的退化实现没有夹具。
    name: "源文件指针负向:审计注入面缺 tracked ⇒ 整表判红(忘了注入 = 这一格等于没查)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers(realTable),
    expect: /全表指针未经跟踪核对/,
  },
  {
    name: "源文件指针:空表判红(零判定面恒绿)",
    /** @returns {string[]} */
    check: () => auditSourceFilePointers({}, { tracked: realTrackedSet() }),
    expect: /表为空:零项登记意味着「每条指针都指 git 跟踪的源文件」在零判定面上恒绿/,
  },
  {
    // **覆盖面自检(与 `enforcement` 那一族同形,但靠真变异而不是靠复述)**:把真实表里
    // **每一项的 `modulePath` 整条删掉**(合成副本,不动真实表)⇒ 审计必须逐项点名。
    // 「恒返回空数组」与「只审 `judgment.module` 一个字段」这两种退化实现在这一格下都失败
    // (后者会把**每一项**的 `modulePath` 全跳过 ⇒ 零 problems)。若有人把 `fields` 那个元组删窄,
    // 或删空表那一档,这一格立刻红。
    name: "源文件指针覆盖面:整条删掉全表 modulePath ⇒ 逐项点名(只审一个字段的退化实现会失败)",
    /** @returns {string[]} */
    check: () => {
      const stripped = Object.fromEntries(
        Object.entries(realTable).map(([key, entry]) => {
          const rest = { ...entry };
          delete rest.modulePath;
          return [key, rest];
        }),
      );
      const problems = auditSourceFilePointers(stripped, { tracked: realTrackedSet(), isIgnored: realIsIgnored });
      const named = problems.filter((line) => /:modulePath 缺指针/.test(line)).length;
      if (problems.length === 0 || named === 0) {
        return [
          `整条删光 modulePath 后零 problems 或零点名(实得 ${problems.length} 条 / 点名 ${named} 条)`
          + " —— 「两个字段都被审」这一格没有守住",
        ];
      }
      return problems.map((line) => `${line}(覆盖面自检:modulePath 缺指针被点名 ${named} 条)`);
    },
    expect: /:modulePath 缺指针 —— 「它是不是 git 跟踪的源文件」无从核对/,
  },
];

/* ---------- 跑:夹具表逐档收进 case ---------- */

const suite = createCaseSuite();

/**
 * 跑一档:调该档的 `check()` 拿 problems,按 `expect` 结算,**最后用一条 `assert` 抛**。
 *
 * 搬迁口径:原 `failures.push(...)` 的每一处逐字改成给 `problem` 赋值(消息一字不改),原来那条
 * 「夹具抛异常」的 catch 分支改成赋同一条消息,末尾一条 `assert` 抛出、由 case 级 catch 收成
 * **该档**失败 —— 一样不打断后续档(旧实现是 push 后 `continue`)。
 * 「非数组一律判失败」那一档恒绿防护原样保留(它防的是「判定函数没回吐 problems」这种退化实现)。
 * @param {{ name: string, check: () => string[] | Promise<string[]>, expect: RegExp | null }} testCase
 *   夹具表里的一档(`name` 逐字沿用 `CASES` 元素的 `name` 字段)
 * @returns {Promise<void>}
 */
async function runCase(testCase) {
  /** @type {string | null} */
  let problem = null;
  try {
    const raw = await testCase.check();
    if (!Array.isArray(raw)) {
      problem = `${testCase.name}:判定函数返回的不是数组(恒绿防护:非数组一律判失败)`;
    } else {
      const joined = raw.join("\n");
      if (testCase.expect === null) {
        if (raw.length === 0) {
          console.log(`[ok] gate-index-selftest:${testCase.name}(零判红)`);
        } else {
          problem = `${testCase.name}:期望零判红,实际 ${raw.length} 条\n${joined}`;
        }
      } else if (testCase.expect.test(joined)) {
        console.log(`[ok] gate-index-selftest:${testCase.name}(漂移被拦截 / ${raw.length} 条)`);
      } else {
        problem = `${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`;
      }
    }
  } catch (error) {
    // 一条夹具的构造/求值抛异常只登记,不让它打断整批(否则后面的夹具一条都跑不到)
    problem = `${testCase.name}:抛异常:${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  }
  assert(problem === null, problem ?? "(无失败消息)");
}

// 档名即 case 名(逐字沿用搬迁前 `failures.push` 记账用的 `testCase.name`)。
for (const testCase of CASES) {
  await suite.case(testCase.name, () => runCase(testCase));
}

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 与搬迁前 `failures[]` 判定等价(任一档失败即非零退出),**分母也是同一个**:搬迁前写
// `CASES.length`,搬迁后由 `suite.results.length` 自然给出。两侧一旦不等,说明有档没接进 case
// —— 那正是 `gates-selftest-named-case` 要抓的形态。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) {
    console.error(`[gate-index-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(`[gate-index-selftest:fail] 门禁索引回归守护失败,共 ${failedCases.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] gate-index-selftest:${cases.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);