// 门禁自测「变异生效自守」门禁(纯文本判定、无产物、幂等,exit 0/1)。
//
// ---- 它守住什么 ----
// 本仓的门禁自测里有一族做法:**把门禁源文件改掉再跑一遍**,以证明「改坏了就该红」。
// 那族做法有一种**致命失效形态:变异成了空操作**(什么都没改),而自测仍报「全绿」——
// 于是这道判据带着「我测过它」的假象长期存活,而它守的那族缺陷(判据退化成永远 exit 0)
// 从头到尾没人看见。
//
// 2026-10-15 发版时实测踩中的就是它:`gates/fixtures/check-image-digests.selftest.mjs` 的
// `mutateAndRun` 先把内容归一到 LF、在归一结果上校验锚点存在,**却先转回检出形态的 EOL
// 再拿按 LF 写就的锚点去替换** ⇒ Windows runner(`core.autocrlf=true` 检出转 CRLF)下
// 变异恒为空操作。**那次不是静默假绿**,是被它自己那道自守抓出来的(自守抛
// 「变异未改变文件内容:结论会是假的」),真因与修法都在那个文件里。
//
// ⚠ **但那 6 处自守是纯约定,没有任何机器判据要求「新建的文本变异型自测带上它」。**
// 实测:自测共 25 份(新增本门禁自测后为 26),其中做文本变异的 **6 份**
// (`check-image-digests` / `check-segment-contracts` / `check-eol-anchor` /
// `check-i18n-keys` / `check-output-unwritable-registry` / `check-samples`),
// **这 6 份都带**。真正的残余缺口是:将来第 7 份文本变异型自测若漏写自守,
// 行尾敏感就会静默变成假绿,而没人知道。本门禁只补这一条。
//
// ---- 判定式 ----
// 凡 `gates/**/*.selftest.mjs` 中被分类为**文本变异型**的,必须命中
// {@link MUTATION_GUARDS} 里 `required: true` 的自守标记,否则判红并点名该文件。
//
// ---- 「文本变异型」怎么判定(启发式,且它的覆盖面必须被读作有限)----
// 分类走两步,都不是全程序分析:
//   ① **仓库根派生变量**:形如 `const X = join(ROOT, …)` / `= projectRoot` 的标识符,
//      再做一次不动点传播(`const Y = <含派生标识符的表达式>` ⇒ Y 也派生)。
//   ② **写入点**:形如 `writeFileSync(A, …)` / `writeFileAtomic(A, …)` 的实参 A 若派生
//      ⇒ 该自测是文本变异型。A 是某函数的形参时,按「实参派生 ⇒ 形参派生」再走一轮不动点,
//      解析函数调用点的实参(跳一跳,不追跨文件)。
//
// ⚠⚠ **已知局限:本分类不完备,方向是假阴性(漏报),不是假阳性(误报)。**
//   ① **跨文件看不见**:变异助手若被抽进另一个模块(仓内 `gates/` 单向上游无环,故完全可���),
//      本自测文件里就一个 `writeFileSync` 都没有 ⇒ 分类为「非文本变异型」而实为是。
//   ② **写入原语表只有两个**(`writeFileSync` / `writeFileAtomic`)。
//      `fsp.writeFile` / `fs.promises.writeFile` / 手写 stream / `copyFileSync` 覆写回仓内
//      / `appendFileSync` 都不在表内。
//   ③ **只追一跳调用点**:形参 ← 调用实参追一跳,再往上是「局部赋值 ⇒ 不动点传播」那条链;
//      跨模块传参、返回对象里藏路径(`return { p: join(ROOT, …) }`)追不到。
//   ④ **根派生只认 `ROOT` / `projectRoot` / `repoRoot` 三个名字**,且必须出现在
//      `join(` / `resolve(` 的首参位。自算根(`process.cwd()` 拼接、`path.resolve(__dirname)`)
//      的写入点追不到。
//   ⑤ **自守标记是字面量匹配**,源码里别处出现同一句就算数(假阴性,见
//      {@link MUTATION_GUARDS} 的注释)。
// ⚠ **所以本门禁的读法是「这几份被看着」,不是「这类缺陷不存在」。** 分类口径变更时
// 真实仓上的分类结果会变,而**只有变多才有意义**(少一份 ⇒ 有一份退出判定面且症状是全绿),
// 这一点由 {@link MIN_MUTATING_SELFTESTS} 的恒绿防护与自测的「真实仓分类」那一档盯着。
//
// ---- 形状:判定本体 = `judgeSelftestMutationGuards(ctx)`(可注入、零 IO 副作用) ----
// 与 `gates/repo/check-ci-contract.mjs` 的 `checkContract(ctx)` 同形(全仓门禁判定协议),
// `main()` 只做「打印 + 按 problems.length 出 0/1」。为什么这道门禁需要那个形状:
// **自测不能用「改文件再跑」的形态验自己** —— 那正是本条自己要抓的形态(自测改真文件,
// 它的成败就依赖自己的变异是否生效)。注入合成根之后,自测只往临时目录里铺夹具,
// 真实仓库一个字节都不动。
//
// ctx 注入面(与 protocol.mjs 的 GateCtx 同形):
//   root                   求值根(默认 `shared/paths.js` 的项目根)
//   readText(rel)          读仓相对文本
//   listDir(rel)           列仓相对目录(条目带 name / isDirectory)
//   minMutatingSelftests   分类结果的零值下限(合成根上要能调小,默认常量)

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { lexSource } from "../../shared/copy-closure.js";
import { isMainModule } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

/** 扫描面:门禁树(仓相对 POSIX)。自测载体只在这棵树下。 */
export const SELFTEST_SCAN_ROOT = "gates";

/** 自测载体的文件名后缀。 */
export const SELFTEST_SUFFIX = ".selftest.mjs";

/**
 * 自守标记的**闭合清单**(判「带没带自守」的唯一依据)。
 *
 * ⚠ **它是判定本体的常量、不是 CLI 可传项**(与 `check-test-layout.mjs` 的 `CRITERIA` /
 * `check-import-boundary.mjs` 的 `LAYER_RULES` 同层纪律):能传表就能把自己摘出去,那是
 * fail-open。
 *
 * ⚠ **新增一条要改哪里**:只改本表。加一条要么改既有标记的文案(先在
 * {@link SELFTEST_GUARD_SOURCE_ANCHOR} 找到该文件),要么在此追加一条 `entry`。
 * 追加时 `required` 决定它是不是**判红线**:
 *   - `required: true` = 「变异生效自守」本身(能抓住**变异成了空操作**那一族),
 *     文本变异型自测必须命中至少一条;
 *   - `required: false` = 定位类前置断言(能在 EOL 失配时提前报红,但**抓不到**
 *     「`replace` 落空而内容未变」那一族),识别它们只为让诊断说清「你写的那条属于哪一类」。
 *
 * ⚠ **标记匹配是字面量匹配,这是刻意选的封闭口径**:判据要的是「这道自测承认自己
 * 可能变异失败并因此报错」,而那在源码里就是一句错误文案。代价有两个,方向相反:
 *   - **假阳性**:语义正确但措辞不同的自守被判红 —— fail-closed(响),处置是二选一:
 *     改用本表里的措辞,或把新措辞按上一段登记成新条目。**不要为了绕开这条红去放宽匹配。**
 *   - **假阴性**:源码里**别处**出现过同一句标记就算数 —— 自测自己的夹具正文
 *     (`const BODY = ['… throw new Error("变异未改变文件内容…")']`)、或一段引用它的注释,
 *     都能冒充「带了自守」。已按「抹掉注释再找」消掉注释那一半,夹具正文那一半消不掉
 *     (要消掉就得做数据流分析,那正是本门禁判据面之外的另一道题)。**登记在案的已知局限。**
 *
 * @typedef {object} MutationGuard
 * @property {string} id 机器 id(诊断文案与自测断言引用它)
 * @property {string} marker 源码里逐字出现的标记
 * @property {boolean} required 是否判红线
 * @property {string} role 这一族自守抓的是哪一种失效
 */

/** @type {readonly MutationGuard[]} */
export const MUTATION_GUARDS = Object.freeze([
  Object.freeze({
    id: "mutation-effective",
    marker: "变异未改变文件内容",
    required: true,
    role: "变异成了空操作(什么都没改)而自测仍报全绿",
  }),
  Object.freeze({
    id: "mutation-anchor-locate",
    marker: "变异定位失败",
    required: false,
    role: "锚点定位失败(定位不到就抛,不给「替换落空」的机会)",
  }),
  Object.freeze({
    id: "mutation-pair-differs",
    marker: "变异是空操作",
    required: false,
    role: "from === to(变异表自己写错了,还没落到文件上)",
  }),
]);

/**
 * 源码锚:闭合清单在本文件里的位置(只出现在诊断文案里)。
 *
 * ⚠ 它是本文件自身的路径 + 导出名,不是另一个文件(登记表是判定本体的常量)。
 * 单列成常量而不是在文案里各写一遍:那句文案出现两次以上就是一处会与导出名漂移的副本,
 * 而漂移的后果是「诊断点名一个不存在的锚」。
 * @type {string}
 */
export const SELFTEST_GUARD_SOURCE_ANCHOR =
  "gates/repo/check-selftest-mutation-guard.mjs#MUTATION_GUARDS";

/**
 * 分类结果的零值下限:扫完全部自测后,被判为文本变异型的份数低于它即判红。
 *
 * 为什么需要这一档:本门禁的失效方向是**恒绿** —— 分类启发式一旦失效(根派生名改了、
 * 写入原语改了、walker 路径写错),25 份全部落进「非文本变异型」,判定集合为空,
 * 输出是 exit 0,而它一道判据都没查。**恒绿防护的顺序因此是「先断非空,再断差集命中」**
 * (与 `check-test-layout.mjs` 的名册族同款取舍)。取 1 而不是「等于当前份数」:
 * 条数随自测增删变,写死当前值会在下一份自测进来时误报。
 * @type {number}
 */
export const MIN_MUTATING_SELFTESTS = 1;

/**
 * 写入原语表(闭合枚举)。
 *
 * ⚠ **只有「把整份内容写回一个既有文件」的两个原语在表内**:`copyFileSync` / `appendFileSync`
 * 不在 —— 前者在本仓的用法是「仓内 → 临时沙盒」(只读源、写临时,不是变异),
 * 后者按定义总会改变内容(不构成「变异落空」这一族失效)。
 * ⚠ `fsp.writeFile` / `fs.promises.writeFile` 不在表内,是**登记在案的已知局限**
 * (见文件头「已知局限 ②」),不是遗漏。
 * @type {readonly string[]}
 */
export const WRITE_PRIMITIVES = Object.freeze(["writeFileSync", "writeFileAtomic"]);

/**
 * 仓库根的名字(派生分析的原点)。
 *
 * ⚠ **只认这三个名字**,且必须出现在 `join(` / `resolve(` 的首参位(见文件头已知局限 ④)。
 * 自算根(由 `process.cwd()` 或 `import.meta.url` 拼出来的)追不到 —— 那也是真变异,
 * 但追它要一份跨进程/跨模块的数据流分析,代价与本题不成比例。
 * @type {readonly string[]}
 */
export const ROOT_ALIASES = Object.freeze(["ROOT", "projectRoot", "repoRoot"]);

/**
 * @typedef {object} MutationGuardCtx 注入面
 * @property {string} root 求值根(仓根绝对路径)
 * @property {(relative: string) => string} readText 读仓相对文本
 * @property {(relative: string) => { name: string, isDirectory: boolean }[]} listDir 列仓相对目录
 * @property {number} minMutatingSelftests 分类结果的零值下限
 */

/**
 * 构造注入面(与 `check-test-layout.mjs` 的 `makeTestLayoutCtx` 同形)。
 * @param {Partial<MutationGuardCtx>} [base]
 * @returns {MutationGuardCtx}
 */
export function makeMutationGuardCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText:
      base.readText
      ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    listDir:
      base.listDir
      ?? ((relative) =>
        readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }))),
    minMutatingSelftests: base.minMutatingSelftests ?? MIN_MUTATING_SELFTESTS,
  };
}

/**
 * 把字符串字面量的内部抹成空格,只留引号与换行。
 *
 * 为什么必须做这一步:`lexSource` 的 `code` 字段**保留**字符串内容(它给的是 `inString`
 * 掩码让调用方自己决定),而本门禁要判的恰恰是「源码里某句错误文案」——
 * 那是**字符串**。但**反向**的那一刀同样必要:夹具正文常以字符串形态内联
 * (`const COPY_BODY = '… copyFileSync(join(ROOT, "a.mjs")) …'`),不抹掉它就会把
 * 「一段被当作数据写出去的示例代码」当成真代码,分类随之误报。
 * @param {string} code `lexSource(text).code`
 * @param {Uint8Array} inString `lexSource(text).inString`
 * @returns {string} 字符串内部已抹成空格的等长文本
 */
function maskStringBodies(code, inString) {
  const chars = code.split("");
  for (let i = 0; i < inString.length; i += 1) {
    if (inString[i] === 1 && chars[i] !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

/** 顶层(可能跨行的)声明 `const|let|var NAME = <到分号为止>;` */
const DECL_RE = /(?:^|[;{}\s])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;

/** 函数形参表:`function F(a, b)` 与 `const F = (a, b) =>` 两种形态。 */
const FN_SIGNATURE_RES = Object.freeze([
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?\(([^()]*)\)/g,
]);

/**
 * 按下标切开实参列表(顶层逗号,括号/方括号/花括号内不切)。
 * @param {string} text 全文
 * @param {number} openParen 左括号下标
 * @returns {string[]} 实参表达式列表(已 trim)
 */
function splitArgsAt(text, openParen) {
  /** @type {string[]} */
  const args = [];
  let depth = 0;
  let start = openParen + 1;
  for (let i = openParen; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const last = text.slice(start, i).trim();
        if (last !== "") args.push(last);
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

/** 提取表达式里出现的全部标识符(属性名那一侧的 `obj.prop` 的 `prop` 也算数,收窄由调用方负责)。 */
function identifiersIn(expr) {
  const out = new Set();
  for (const m of expr.matchAll(/([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return [...out];
}

/** 路径形状的原语白名单:右端只许调这些,才算「在造一条路径」。 */
const PATH_PRIMITIVES = Object.freeze([
  "join",
  "resolve",
  "split",
  "replace",
  "replaceAll",
  "normalize",
  "concat",
  "slice",
  "dirname",
  "basename",
  "format",
]);

/**
 * 判定一个赋值右端是否「在造一条路径」。
 *
 * 收窄口径:出现 `await`,或调了白名单之外的函数 ⇒ 不是。
 * ⚠ **不排除 `=`**:三目 `mutation.target === "checker" ? checkerPath : subjectPath`
 * 是本仓现成的真形态(check-eol-anchor / check-output-unwritable-registry 两份都这么取
 * 变异目标),把 `=` 一起排掉会让这两份退化成非变异型 —— 那是**假阴性**,正是不能要的方向。
 * ⚠ 白名单之外的**任何**调用都排除,故 `spawnSync(…)` / `runGate(…)` / `JSON.parse(…)`
 * 这类一律不传播 —— 代价与已知局限同向(记为分类变窄,那是可读的方向)。
 * @param {string} rhs 赋值右端(字符串字面量已抹成空格)
 * @returns {boolean}
 */
function isPathShaped(rhs) {
  if (/\bawait\b/.test(rhs)) return false;
  for (const m of rhs.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (name === undefined || !PATH_PRIMITIVES.includes(name)) return false;
  }
  return true;
}

/**
 * 判定一个实参表达式是否「就是这个仓内路径」(裸标识符或属性链)。
 * @param {string} arg 实参表达式
 * @returns {boolean}
 */
function isBareDerivedRef(arg) {
  return /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(arg);
}

/**
 * 解析一棵函数表:函数名 → 形参名列表。
 * @param {string} code 抹掉字符串与注释后的代码
 * @returns {Map<string, string[]>}
 */
function parseFunctionTable(code) {
  /** @type {Map<string, string[]>} */
  const table = new Map();
  for (const re of FN_SIGNATURE_RES) {
    for (const m of code.matchAll(re)) {
      const name = m[1];
      if (name === undefined) continue;
      const params = (m[2] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
      if (params.length === 0) continue;
      const existing = table.get(name);
      // 同一函数名出现多次(重载/多形态)时取形参最多的那份:调用点按位取值,
      // 取窄的那份会让实参与形参错位,从而把一个真写入点判成非派生。
      if (existing === undefined || params.length > existing.length) table.set(name, params);
    }
  }
  return table;
}

/**
 * 一份自测源码的派生分析(写入点是否落在**真实仓库文件**上)。
 *
 * 纯函数、零 IO:吃源码文本,吐判定所需的一切。
 * @param {string} rawText 自测源文件正文
 * @returns {{ mutating: boolean, writeTargets: string[], derivedRoots: string[] }}
 */
export function analyzeSelftestSource(rawText) {
  const lexed = lexSource(rawText);
  const code = maskStringBodies(lexed.code, lexed.inString);

  // ① 种子:声明右端直接出现 `join(ROOT,…)` / `= projectRoot` 的标识符。
  /** @type {Set<string>} */
  const derived = new Set();
  const joinRootRe = new RegExp(
    `(?:join|resolve)\\s*\\(\\s*(?:${ROOT_ALIASES.join("|")})\\b`,
  );
  for (const m of code.matchAll(DECL_RE)) {
    const name = m[1];
    const rhs = m[2] ?? "";
    if (name === undefined) continue;
    if (joinRootRe.test(rhs) || ROOT_ALIASES.some((alias) => new RegExp(`^\\s*${alias}\\s*$`).test(rhs))) {
      derived.add(name);
    }
  }

  // ② 不动点传播:局部赋值里含派生标识符 ⇒ 左值也派生(吃掉 `const p = a ? A : B`、
  //    `const p = join(ROOT, …, rel)`、`const p = checkerPath` 这一族)。
  //
  // ⚠ **必须带 `isPathShaped` 这道收窄,否则传播会退化成「文件里任何提到派生变量的赋值
  //    都算派生」** —— `const result = spawnSync(execPath, [checkerPath, …])` 会让 `result`
  //    变成派生名,而 `result` 是个退出码对象。这类**过宽派生制造的是假阳性**(把只写临时
  //    夹具的自测误判成文本变异型 ⇒ 无辜者被判红),方向比假阴性更吵但同样是错。
  //    收窄口径:右端只许出现路径形状的原语调用(`join` / `split` / `replace` 那一族),
  //    出现任何别的函数调用(`spawnSync` / `runGate` / …)或 `await` 即**不传播**。
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const m of code.matchAll(DECL_RE)) {
      const name = m[1];
      const rhs = m[2] ?? "";
      if (name === undefined || derived.has(name)) continue;
      if (!isPathShaped(rhs)) continue;
      if (identifiersIn(rhs).some((id) => derived.has(id))) {
        derived.add(name);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ③ 形参 ← 调用实参:实参派生 ⇒ 形参派生(吃掉 `mutateAndRun(checkerPath, …)` 这一族)。
  //
  // ⚠ 实参只认**裸标识符**(可带属性链)或路径形状的 `join(…)` 表达式,不认「实参里恰好提到
  //    某个派生名」的表达式 —— 那会让 `runGate(checkerPath, cwd)` 的第二参 `cwd` 也变派生,
  //    而 `cwd` 传的是临时根;派生面收窄到「这个形参**就是**那个仓内路径」才够判。
  const fnTable = parseFunctionTable(code);
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const [fnName, params] of fnTable) {
      const callRe = new RegExp(`\\b${fnName}\\s*\\(`, "g");
      for (const call of code.matchAll(callRe)) {
        const openParen = (call.index ?? 0) + call[0].length - 1;
        const args = splitArgsAt(code, openParen);
        for (let i = 0; i < params.length && i < args.length; i += 1) {
          const param = params[i];
          const arg = args[i];
          if (param === undefined || arg === undefined || derived.has(param)) continue;
          if (!isBareDerivedRef(arg)) continue;
          // ⚠ **必须排除「实参就是形参本身」**:那是**零信息的自调用**
          // (`function existsFile(target) { … existsFile(target) … }`),
          // 不排除它就会把一个从未被派生的形参**从无到有**地bootstrap 成派生名 ——
          // 实测那一族(`const target = join(root, …)` 里的 `root` 是临时根)会让
          // 纯夹具型自测被误判成文本变异型,即**假阳性**。
          if (arg.replace(/\s*\.\s*/g, ".") === param) continue;
          derived.add(param);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // ④ 写入点:原语实参派生 ⇒ 该文件在改真实仓库文件。
  /** @type {string[]} */
  const writeTargets = [];
  for (const primitive of WRITE_PRIMITIVES) {
    const re = new RegExp(`\\b${primitive}\\s*\\(`, "g");
    for (const call of code.matchAll(re)) {
      const openParen = (call.index ?? 0) + call[0].length - 1;
      const [target] = splitArgsAt(code, openParen);
      if (target === undefined) continue;
      // 实参整体必须**就是**一个派生名(可带属性链)。不认「实参里提到了派生名」:
      // `writeFileSync(join(root, checkerPath), …)` 里 `root` 是临时根,那种写法
      // 写的是夹具不是仓内源文件,认了就是假阳性。
      if (isBareDerivedRef(target) && identifiersIn(target).every((id) => derived.has(id))) {
        writeTargets.push(target);
      }
    }
  }

  return { mutating: writeTargets.length > 0, writeTargets, derivedRoots: [...derived] };
}

/**
 * 列出扫描面下的全部自测载体(仓相对 POSIX,已排序)。
 *
 * ⚠ **`ctx.listDir` 抛错不在此吞掉**:调用方要把「子树读不到」判红(路径写错时静默按
 * 空集通过,门禁从那一刻起什么也没查,而输出是 exit 0 —— 这是最坏的失效形态)。
 * 与 `check-test-layout.mjs` 的 `collectFilesUnder` 同款取舍。
 * @param {MutationGuardCtx} ctx
 * @returns {string[]}
 */
export function collectSelftests(ctx) {
  /** @type {string[]} */
  const files = [];
  const walk = (relDir) => {
    for (const entry of ctx.listDir(relDir)) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) walk(rel);
      else if (entry.name.endsWith(SELFTEST_SUFFIX)) files.push(rel);
    }
  };
  walk(SELFTEST_SCAN_ROOT);
  return files.sort();
}

/**
 * @typedef {object} SelftestClassification 一份自测的分类结果
 * @property {string} file 仓相对 POSIX 路径
 * @property {boolean} mutating 是否被判为文本变异型
 * @property {string[]} writeTargets 命中的写入实参(去重后)
 * @property {string[]} guards 命中的自守条目 id
 * @property {string[]} missingGuards 缺的自守条目 id
 */

/**
 * @typedef {object} MutationGuardStats 覆盖度读数
 * @property {number} total 扫描到的自测份数
 * @property {number} mutating 被分类为文本变异型的份数
 * @property {number} guarded 其中带自守的份数
 */

/**
 * 判定本体:跑完全部判据,返回问题清单与覆盖度(判定通过 ⇔ problems 为空)。
 *
 * 纯判定、零副作用:只经 ctx 读盘,不写任何文件、不改进程退出码。全部判据跑完才返回,
 * 避免首个失败掩盖其余漂移。
 * @param {Partial<MutationGuardCtx>} [base] 注入面
 * @returns {{ problems: string[], stats: MutationGuardStats, classified: SelftestClassification[] }}
 */
export function judgeSelftestMutationGuards(base = {}) {
  const ctx = makeMutationGuardCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {SelftestClassification[]} */
  const classified = [];

  const files = collectSelftests(ctx);
  for (const file of files) {
    const source = ctx.readText(file);
    const analysis = analyzeSelftestSource(source);
    const guards = [];
    const missingGuards = [];
    for (const guard of MUTATION_GUARDS) {
      // 标记只在**抹掉注释之后**的文本上找:否则一份「只在注释里提到这句话」的源码
      // 会冒充自守(注释里恰好也有一句解释这道自守的注释,是最容易发生的假阳性)。
      const hit = stripComments(source).includes(guard.marker);
      if (hit) guards.push(guard.id);
      else if (guard.required) missingGuards.push(guard.id);
    }
    const writeTargets = [...new Set(analysis.writeTargets)];
    classified.push({
      file,
      mutating: analysis.mutating,
      writeTargets,
      guards,
      missingGuards,
    });
    if (analysis.mutating && missingGuards.length > 0) {
      const want = MUTATION_GUARDS.filter((guard) => guard.required).map((guard) => guard.id);
      problems.push(
        `${file} → selftest-mutation-guard:该自测属文本变异型(写回真实仓库文件的调用点:`
          + `${writeTargets.join(" / ") || "(未解析出实参)"}),但缺变异生效自守:`
          + `未命中 ${missingGuards.join("、")}(判红线要求命中 ${want.join(" 或 ")})。`
          + "为什么这是判红线:变异一旦成了空操作(什么都没改),自测仍会报「全绿」,"
          + "于是一道判据带着「我测过它」的假象长期存活,而它守的那族缺陷从头到尾没人看见。"
          + `处置:在该自测的变异助手里比对改前改后并在内容未变时抛错(措辞见 ${SELFTEST_GUARD_SOURCE_ANCHOR}`
          + ` 的 ${MUTATION_GUARDS.filter((guard) => guard.required).map((guard) => guard.id).join(" / ")} 一条);`
          + "新增自守措辞则同批在该表里追加一条 entry",
      );
    }
  }

  const mutating = classified.filter((entry) => entry.mutating);
  if (mutating.length < ctx.minMutatingSelftests) {
    problems.push(
      `扫描到的自测里被判为文本变异型的只有 ${mutating.length} 份,低于下限 ${ctx.minMutatingSelftests} `
        + "—— 分类启发式很可能已经失效(根派生名 / 写入原语表 / 扫描面路径三者之一变了),"
        + "而本门禁一道判据都没查却仍会 exit 0。这是本门禁最坏的失效形态(恒绿),"
        + "故先断非空再断差集命中。处置:核对 classifySelftestSource 的派生原点与 "
        + `WRITE_PRIMITIVES / ROOT_ALIASES 两张表(本文件 ${SELFTEST_GUARD_SOURCE_ANCHOR} 同文件内)`,
    );
  }

  return {
    problems,
    stats: {
      total: files.length,
      mutating: mutating.length,
      guarded: mutating.filter((entry) => entry.missingGuards.length === 0).length,
    },
    classified,
  };
}

/**
 * 抹掉注释、保留字符串内容(与 `maskStringBodies` 恰好相反的一刀)。
 *
 * 为什么需要它:自守标记是**字符串**(一句错误文案),抹字符串会把它一起抹掉;
 * 而只按原文找,一份「把这句话写进注释解释自己」的源码会冒充带了自守。
 * @param {string} text 源码全文
 * @returns {string} 注释已抹成空格的等长文本
 */
function stripComments(text) {
  const out = text.split("");
  let i = 0;
  let prev = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipQuotedLite(text, i);
      i = end;
      prev = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let k = i; k < stop; k += 1) if (text[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    if (ch === "/" && (prev === "" || /[({[,;:=!&|?+\-*%~^<>]/.test(prev))) {
      i = skipRegexLite(text, i);
      prev = "/";
      continue;
    }
    if (ch !== undefined && !/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out.join("");
}

/**
 * 跳过一段引号字符串/模板(处理转义)。
 * @param {string} text
 * @param {number} start 引号下标
 * @returns {number} 结束引号之后的下标
 */
function skipQuotedLite(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && ch === "\n") return i;
    i += 1;
  }
  return i;
}

/**
 * 跳过一个正则字面量(含字符类与转义)。
 * @param {string} text
 * @param {number} start 斜杠下标
 * @returns {number} 字面量之后的下标
 */
function skipRegexLite(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i + 1;
    else if (ch === "\n") return i;
    i += 1;
  }
  return i;
}

/**
 * CLI 主体:调用判定本体 → 打印 → 按结论出 0/1(判定逻辑全在 judgeSelftestMutationGuards 里)。
 * @param {Partial<MutationGuardCtx>} [base] 注入面
 * @returns {number} 退出码
 */
export function main(base = {}) {
  const result = judgeSelftestMutationGuards(base);
  if (result.problems.length > 0) {
    for (const item of result.problems) console.error(`[selftest-mutation-guard:fail] ${item}`);
    console.error(
      `[selftest-mutation-guard:fail] 门禁自测「变异生效自守」判定失败,共 ${result.problems.length} 项`,
    );
    return 1;
  }
  const { stats } = result;
  // 分类结果逐条打印:本门禁的读法是「这几份被看着」,不是「这类缺陷不存在」
  // (分类启发式不完备,方向是假阴性,见文件头「已知局限」)。读数不印出来,
  // 分类一旦悄悄变窄就没有人看得见。
  for (const entry of result.classified) {
    console.log(
      `[ok] ${entry.mutating ? "文本变异型" : "非变异型  "} ${entry.file}`
        + (entry.mutating
          ? ` 写入实参 [${entry.writeTargets.join(", ")}] · 自守 [${entry.guards.join(", ") || "无"}]`
          : ""),
    );
  }
  console.log(
    `[ok] 门禁自测变异生效自守判定通过:自测 ${stats.total} 份,分类为文本变异型 ${stats.mutating} 份,`
      + `其中带自守 ${stats.guarded} 份。⚠ 分类启发式不完备(已知局限见本文件头),`
      + "本门禁的结论读作「这几份被看着」,不是「这类缺陷不存在」",
  );
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main();