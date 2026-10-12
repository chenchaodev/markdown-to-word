// 落盘失败码登记完整性门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 它守住什么 ----
// CLI 判「输出写不了」读的是**错误码**(`src/cli/index.ts` 的 `itemExitCode`:命中码表 ⇒ 退出码 4,
// 否则兜底 3)。兜底方向本身是对的(不把不确定当确定),但它带来一个**无红光**的失效形态:
// 新增一个落盘失败点若忘了在 `OUTPUT_UNWRITABLE_CODES` 登记码,症状只是退出码从 4 静默变成 3,
// 没有任何门禁会红,而脚本化调用方读到的是「转换失败」而非「输出写不了」——
// 两者的处置动作不同(换输出目录 / 腾空间 vs 改 markdown、重跑)。
//
// ⚠ **这不是「将来可能忘」的风险,是当下的洞**:REQ-225 立项时实测 `artifact-writer.ts` 里有两处
// 真实且未登记的落盘失败点(临时文件独占创建失败 / 临时名重试用尽),命中时退出码静默从 4 变 3。
// 本门禁与那两处补码(见该文件 `OUTPUT_UNWRITABLE_CODES` 的 tempUnwritable / tempNameExhausted)
// 同批落地 ⇒ **补码是它有绿基的前提,两者不可拆批**。
//
// ---- 判据 A(登记表 ↔ 抛出点,**双向**对读)----
// A① 每个 `outputUnwritableError(` 的首个实参必须是登记表里的**键**(`OUTPUT_UNWRITABLE_CODES.x`)
//     或登记表里的**值**(字面量 `"OUTPUT_…"`)。其它形态(变量 / 模板串)判红 ——
//     静态不可核对的实参等于没有契约。
// A② 登记表里每个键在产物模块集合内**至少有一处抛出点**(反向:登记了却没人抛 ⇒ 死条目,
//     它让登记表看起来有覆盖面而实际没有)。
//
// 单用任一条都有盲区:A① 只看抛出点,新增一个码而没人用它照样绿;A② 只看登记表,
// 有人在抛出点传了一个表外实参照样绿。两条并用才有「两侧同步」的含义。
//
// ---- 判据 B(产物落盘链路的 catch-throw **三档归类**)----
// 产物模块内每个 `catch` 块里的每个 `throw` 分支必须命中三档之一:
//   ① **包码档**:throw 的是 `outputUnwritableError(…)`(其码由 A① 核)→ 合规。
//   ② **已知 errno 档**:throw 是**对捕获绑定的原样重抛**,且它词法上嵌在某个
//      `if (<errno 判定>)` 分支内(`errnoCode(…)` / `err.code` / `X_CODES.has(…)` 一族)
//      → 合规。含义:作者已**逐个 errno 显式决策**过,不是漏网。
//   ③ **登记档**:①② 都不命中时,必须逐条登记在 {@link NOT_OUTPUT_FAILURES} 里并写明
//      为什么它不是落盘失败 + 什么时候会失效。默认是判红 ——
//      登记是**把已知的例外钉在册**,不是「放过」。
//   ④ 既不属又不登记 ⇒ 判红。
//
// ⚠ **③ 的语义边界**:它按「throw 所在源码行含某片段」匹配,故一处登记只放行**那一行的形态**。
// 同一文件里第二个同形态的裸 `throw err` 不会被同一条登记吃掉(那一行不含片段)⇒ 判红。
// 这正是「登记是钉在册的例外、不是文件级豁免」的机械保证。
//
// ---- 为什么「切窄」而不是「切宽」----
// 判据面收在**产物落盘链路**(`src/convert/` 整棵目录 + 其中的 catch-throw),不收在
// 「全仓所有 throw」。理由是失效形态的方向:全仓口径下,渲染面 / 读盘面 / 用法错的 throw
// 全要逐条登记,登记表会迅速长到几十条并开始腐烂(每条都要在 diff 里被人看见才有意义);
// 而那些 throw **本来就不该**带落盘码 —— 魔数校验(提交前零副作用)、读盘失败、用法错,
// 归「转换失败」是正确分类。本门禁只对「**产物写不出去**」这一族提要求。
//
// ---- 扫描面(为什么是目录而不是文件清单)----
// 刻意**不登记文件清单**:清单会随新增文件静默过期,而过期方向是「少扫一个文件 ⇒ 少判一条雷」,
// 与恒绿同族。目录级登记 + 递归遍历的失效方向是「多扫」,那只会多出一条待登记,可被人看见。
//
// 已知不覆盖(**登记,不隐藏**):
//   ① **登记表本身不在本判定面内**:`cli/index.ts` 的 ReadonlySet 由
//     `Object.values(artifact-writer 的表)` 派生,故改登记表一处即两侧同步。
//     若将来那张表改为**手工列举**而非 `Object.values` 派生,本条即失效 —— 届时消费面
//     (src/cli/index.ts)也要纳入 A①,否则能派生出一个含已删码的集合而两侧仍对得上。
//   ② **catch 块内嵌套函数体里的 `throw` 一律归到外层 catch**。本仓产物链的 catch 内
//     无函数声明(逐点核对),故当前无影响;引入嵌套函数后那处 throw 会被要求登记或包码,
//     方向是「多要求」而非「漏放」,可接受。
//   ③ **A① 只认静态可核的实参形态**。`outputUnwritableError(someVar, …)` 判红;
//     若将来登记表改成运行时计算(按平台挑码),本门禁会持续判红,须同批改为按取值域核。
//   ④ **登记表声明的唯一性靠「扫描面内每个键恰好一处声明」保证**,不核「谁 import 了它」。
//     产物链若出现第二个声明点,本门禁判红(同键二次声明),处置是收口到单源。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "../../shared/cli.mjs";
import { lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";

const USAGE = "用法: node gates/repo/check-output-unwritable-registry.mjs [--help]";

/** 诊断片段上限(超长截断,避免刷屏) */
const SNIPPET_MAX = 96;

/**
 * 扫描面:产物落盘链路所在的仓相对 POSIX 顶层目录(目录级登记,理由见文件头)。
 * @type {readonly string[]}
 */
export const SCAN_ROOTS = Object.freeze(["src/convert"]);

/** 扫描面内整棵跳过的目录名(生成物 / 安装树):它们的内容不由本仓源码决定。 */
export const SKIP_DIR_NAMES = Object.freeze(["node_modules", "dist", "output", "release", ".git"]);

/** 参与扫描的文件扩展名(闭合枚举:判据面之外的格式改不动本门禁的结论)。 */
export const CODE_EXTS = Object.freeze([".ts", ".cts", ".mts"]);

/**
 * 登记表声明的锚:唯一的「键 → 值」映射必须长成这个形状。
 *
 * 刻意锚 `= Object.freeze(` 而不是锚标识符本身 —— 后者在 `paths.ts` 的 import、
 * `cli/index.ts` 的 ReadonlySet 构造、以及本文件自己的判据里都会命中,那是三个不同的东西。
 * @type {RegExp}
 */
export const REGISTRY_DECL_RE = /\bOUTPUT_UNWRITABLE_CODES\s*=\s*Object\s*\.\s*freeze\s*\(\s*\{/g;

/** 登记表里的一条登记:`key: "OUTPUT_…"`。值刻意要求 `OUTPUT_` 前缀(ASCII 标识符契约)。 */
export const REGISTRY_ENTRY_RE = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:\s*(['"])(OUTPUT_[A-Z0-9_]+)\2/g;

/** 错误码构造函数的调用点。 */
export const CALL_RE = /\boutputUnwritableError\s*\(/g;

/** 调用点首个实参的两种合规形态。 */
export const ARG_KEY_RE = /^OUTPUT_UNWRITABLE_CODES\s*\.\s*([A-Za-z_$][\w$]*)$/;
export const ARG_LITERAL_RE = /^(['"`])(OUTPUT_[A-Z0-9_]+)\1$/;

/**
 * `catch` **语句块**。
 *
 * ⚠ **真正把 `promise.catch(…)` 排除掉的是「绑定组 + `{` 之间必须先闭合一个 `)`」这一条**,
 * **不是**任何对 `catch` 记号本身的前后断言 —— 实测(2026-10-12)`.catch(() => { … })` 与
 * `.catch(onFail => { … })` 两种形态在任何前置断言下都收不到(括号里那个 `)` 配不上 `{`)。
 * 写一条看起来在防它、实则不起作用的断言比不写更坏:它让人以为这一格被守住了。
 * 绑定组容忍**一层嵌套括号**(`[^()]*(?:\([^()]*\)[^()]*)*`)是为了 `catch ((e) => …)` 那一族
 * 仍能被认出(它与 `.catch((e) => {` 的差别只在记号前驱,而前驱不参与判据)。
 * @type {RegExp}
 */
export const CATCH_RE = /catch\s*(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?\s*\{/g;

/** catch 块内的 `throw` 记号。 */
export const THROW_RE = /\bthrow\b/g;

/**
 * 档② 的 errno 守卫形态:**正向枚举**(逐个 errno 显式决策过)。
 *
 * ⚠ **刻意只收正向形态,排除 `errnoCode(err) !== "X"` 那类兜底守卫** —— 理由是判据要守的
 * 正是「补码被回退」:兜底守卫(把「除某个 errno 之外的全部」收进一支)在语义上是**没枚举**,
 * 而把补码回退成裸 `throw err` 的真实后果,恰好就是落进这样一个兜底守卫里并被本档放过。
 * 那会让本门禁对**本工作项自己的修复形态**失明,故正向 / 兜底必须分开判。
 *
 * 收的三种正向形态:`errnoCode(…) === "ENOENT"` / `err.code === "…"`` / `X_CODES.has(…)`。
 * @type {RegExp}
 */
export const ERRNO_GUARD_RE =
  /\berrnoCode\s*\([^)]*\)\s*===?\s*['"][A-Z][A-Z0-9_]*['"]|\.\s*code\s*===?\s*['"][A-Z][A-Z0-9_]*['"]|\w+_CODES\s*\.\s*(?:has|includes)\s*\(/;

/**
 * 档② 的**反向排除**:守卫条件里出现 `!==` / `!=` 即判为兜底守卫(未逐个枚举)。
 * 单列一个正则而不是把它塞进 ERRNO_GUARD_RE 的负向断言:两者判的是**不同的形态**
 * (「有没有枚举某个 errno」vs「有没有反向排除」),分开写才看得见各自的覆盖面。
 * @type {RegExp}
 */
export const CATCH_ALL_GUARD_RE = /!==?[^=]|!=[^=]/;

/** 档①:`throw` 的是错误码构造函数产物。 */
export const CODED_THROW_RE = /\boutputUnwritableError\s*\(/;

/**
 * 扫描面文件数下限(判据 1,防空门禁)。
 *
 * walker 写坏 / 目录被搬走 / 扩展名枚举写错,都会让本门禁在**零扫描面**下「全绿」,
 * 而恒绿是纯文本门禁最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。
 * 取值远低于棵内实测文件数:它只负责挡「塌缩到几乎没扫到东西」,不随日常增删抖动。
 * @type {number}
 */
export const MIN_SCANNED_FILES = 5;

/**
 * 登记表至少要有几条登记(判据 2,防空门禁的另一半)。
 *
 * 与 {@link MIN_SCANNED_FILES} 分立:文件数够多但登记表被清空(只剩一个空对象)时,
 * 文件数下限照样过,而 A①② 会在近乎零判定面上「全绿」—— 那正是本门禁最坏的一种假绿。
 * @type {number}
 */
export const MIN_REGISTRY_CODES = 3;

/**
 * @typedef {object} RegistryProblem 一条判定结果
 * @property {string} kind `call-unregistered-code` / `call-unresolvable-arg` / `registry-key-unused`
 *   / `registry-missing` / `registry-duplicated` / `throw-unclassified`
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 行号(1 起);无行号概念时为 0
 * @property {string} detail 诊断正文
 */

/**
 * @typedef {object} NotOutputFailure 一条「刻意不覆盖」登记(判据 B 的档③)
 * @property {string} id 条目 id(零命中提示里点名用)
 * @property {string} file 生效文件(仓相对 POSIX)
 * @property {string} contains 片段:该 throw 所在源码行须含它(避免整文件放行)
 * @property {string} why 为什么它不是落盘失败
 * @property {string} failsWhen 什么条件下本条失效(须改判红或重新裁决)
 */

/**
 * 「刻意不覆盖」登记表:**默认是判红**,每一处「不是落盘失败」都必须在此写明理由。
 *
 * 形态照 check-eol-anchor 的 EXEMPTIONS:按**内容**匹配(文件 × 片段),**不按行号** ——
 * 行号随他处增删漂移,按行号登记的条目会静默变成「放行别的东西」。
 *
 * ⚠ **登记不是「放过」而是「把已知的例外钉在册」**:每条都写明「为什么现在不判红」与
 * 「它什么时候会变成真事故」。零命中会进 `[info]` 输出并在自测里判红 ——
 * 条目不再命中时,要么雷被收了(该删),要么判据漂了(该查),两个方向都有人管。
 * @type {readonly NotOutputFailure[]}
 */
export const NOT_OUTPUT_FAILURES = Object.freeze([
  Object.freeze({
    id: "artifact-writer-link-real-fault-raw-rethrow",
    file: "src/convert/artifact-writer.ts",
    contains: "throw err; // 真实故障",
    why:
      "硬链接提交的**真实故障**(EIO 等)刻意原样上抛,不改写成「换输出目录」提示 —— 该模块文件头"
      + "的 LINK_UNSUPPORTED_CODES 注释明确要求「不得把真实故障改写成『换目录』提示」,"
      + "因为那会掩盖可修复的磁盘问题。errno 与 message 原样透传,调用方仍能按 errno 细分。",
    failsWhen:
      "① 硬链接提交链路新增了一条**可由换目录解决**的 errno(届时应改为包 linkUnsupported);"
      + "② LINK_UNSUPPORTED_CODES 之外的 errno 变得可操作(届时应单列一个码)。",
  }),
  Object.freeze({
    id: "run-render-canceled-normalized",
    file: "src/convert/run.ts",
    contains: "throw new ConvertCanceledError();",
    why:
      "渲染期的**取消**归一为本层错误类型:调用方(IPC 取消分支与批量汇总)只认本层类型。"
      + "取消不是「输出写不了」—— 处置是停止本次转换,不是换输出目录。",
    failsWhen:
      "取消语义被纳入退出码契约(要求脚本化调用方区分「取消」与「转换失败」)时需要一个取消专用码,"
      + "但它**仍然不是**落盘码。",
  }),
  Object.freeze({
    id: "run-render-failure-raw-rethrow",
    file: "src/convert/run.ts",
    contains: "throw err;",
    why:
      "渲染期的**普通失败**原样上抛:渲染面(渲染器 / KaTeX / Mermaid)的失败不是「产物写不出去」,"
      + "产物此刻尚未落盘。归转换失败是正确分类。",
    failsWhen:
      "渲染管线开始承担写盘职责(例如渲染器直接落盘),使这条 throw 可能发生在落盘阶段 —— "
      + "那时它必须改为落盘面的错误码。",
  }),
  Object.freeze({
    id: "image-downloader-access-raw-rethrow",
    file: "src/convert/image-downloader.ts",
    contains: "throw err;",
    why:
      "`fs.access` 探测**非 ENOENT** 的失败原样上抛:那是**读**探测(判定本地图片是否可用),"
      + "不是产物落盘。归「图片不可用 / 转换失败」是正确分类。",
    failsWhen:
      "该探测改为在产物输出目录里做(读面与写面合并),或调用方开始按「输出写不了」处置它。",
  }),
]);

/**
 * @typedef {object} SelfProbe 内建锚点
 * @property {string} id
 * @property {boolean} expectProblem true = 该形态必须被判红
 * @property {Readonly<Record<string, string>>} files 仓相对 POSIX 路径 → 源码正文(按 LF 书写)
 */

/** 探针里复用的登记表前缀(三行)。抽成常量是为了让每条探针只写「与基准的差异」。 */
const PROBE_REGISTRY_HEAD = [
  "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({",
  '  thrown: "OUTPUT_THROWN",',
  '  alsoThrown: "OUTPUT_ALSO_THROWN",',
  "} as const);",
  "export function outputUnwritableError(code, message) {",
  "  return Object.assign(new Error(message), { code });",
  "}",
];

/**
 * 判据 0(防空门禁):内建锚点。
 *
 * 规则写错的表现是**恒绿** —— 没人会去看一个总是 exit 0 的脚本。故这里冻结几段
 * 「必须判红 / 必须零命中」的源码形态,用同一套判定器跑一遍:探针不过即 exit 1,
 * 因为探针坏了之后全部扫描结论都不可信。
 * @type {readonly SelfProbe[]}
 */
export const SELF_PROBE = Object.freeze([
  {
    id: "probe-unregistered-code-literal",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "  throw outputUnwritableError('OUTPUT_MADE_UP', '码不在表里');",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-unknown-key-access",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.notARegisteredKey, '表里没这个键');",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-unresolvable-arg",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit(code) {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "  throw outputUnwritableError(code, '实参静态不可核');",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-key-without-throw-site",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({",
        '  thrown: "OUTPUT_THROWN",',
        '  alsoThrown: "OUTPUT_ALSO_THROWN",',
        '  never: "OUTPUT_NEVER",',
        "} as const);",
        "export function outputUnwritableError(code, message) {",
        "  return Object.assign(new Error(message), { code });",
        "}",
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-bare-rethrow-in-catch",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "  try {",
        "    fs.open('x', 'wx');",
        "  } catch (err) {",
        "    throw err;",
        "  }",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-second-registry-declaration",
    expectProblem: true,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "}",
      ].join("\n"),
      "src/convert/paths.ts": [
        "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({",
        '  thrown: "OUTPUT_THROWN",',
        "} as const);",
      ].join("\n"),
    },
  },
  {
    id: "probe-guarded-rethrow-is-clean",
    expectProblem: false,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "  try {",
        "    fs.open('x', 'wx');",
        "  } catch (err) {",
        "    if (errnoCode(err) === 'EEXIST') {",
        "      throw err;",
        "    }",
        "    throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  }",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-promise-catch-is-not-a-catch-block",
    expectProblem: false,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        // ⚠ 块-bodied 的 `.catch(…)`:`.catch(() => undefined)` 括号里没有 `{`,任何宽松写法
        // 都收不到它,拿它当锚等于这一格恒绿。这一格就是「方法不是块」的锚。
        "  return fs.open('x', 'wx').catch(() => {",
        "    throw new Error('回调里随便抛');",
        "  });",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-promise-catch-single-arg-block-is-clean",
    expectProblem: false,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        // ⚠ 单参箭头形态(本仓 `handle?.close().catch(…)` 等真实落盘清理写法的同族):
        // 它与 `catch (err) {` 在文本上只差记号前驱(`.` vs `}`)。本门禁靠
        // 「绑定组与 `{` 之间必须先闭合一个 `)`」把它排除,故这一格是**那条机制的反向锚**。
        "  return fs.open('x', 'wx').catch(onFail => {",
        "    throw new Error('回调里随便抛');",
        "  });",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "probe-registered-raw-rethrow-is-clean",
    expectProblem: false,
    files: {
      "src/convert/artifact-writer.ts": [
        ...PROBE_REGISTRY_HEAD,
        "export function commit() {",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.thrown, 'ok');",
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.alsoThrown, 'ok');",
        "  try {",
        "    fs.open('x', 'wx');",
        "  } catch (err) {",
        "    throw err; // 真实故障",
        "  }",
        "}",
      ].join("\n"),
    },
  },
]);

/**
 * 算每个 `{` 的配对 `}` 下标(一次线性扫描,不递归)。
 * @param {string} code 已抹注释的代码
 * @returns {Map<number, number>}
 */
export function bracePairs(code) {
  /** @type {Map<number, number>} */
  const pairs = new Map();
  /** @type {number[]} */
  const stack = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "{") stack.push(i);
    else if (code[i] === "}" && stack.length > 0) pairs.set(stack.pop() ?? 0, i);
  }
  return pairs;
}

/** 下标 → 行号(1 起)。`code` 与原文等长(lexSource 保证),故行号对得上原文。 */
export function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (code[i] === "\n") line += 1;
  return line;
}

/**
 * 取包含 `index` 的**最内层**块区间;不在任何块内则返回 null。
 *
 * 块字面量与控制流块一并算作作用域 —— 这是保守方向(区间更小 ⇒ 更容易判「不在守卫内」
 * ⇒ 更容易落档③或判红),与 check-eol-anchor 的同名函数同款取舍。
 * @param {Map<number, number>} pairs bracePairs 的产物
 * @param {number} index
 * @returns {{ start: number, end: number } | null}
 */
export function enclosingScope(pairs, index) {
  let best = null;
  for (const [open, close] of pairs) {
    if (open <= index && index <= close && (best === null || open > best.start)) {
      best = { start: open, end: close };
    }
  }
  return best;
}

/** 反查配对 `(` 的下标;`code[closeIndex]` 必须是 `)`。找不到返回 -1。 */
export function matchingOpenParen(code, closeIndex) {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i -= 1) {
    if (code[i] === ")") depth += 1;
    else if (code[i] === "(") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 跳过 `(` 与 `{` 之间的空白,返回 `{` 的下标;不是 `{` 返回 -1。 */
function braceAfter(code, from) {
  for (let i = from; i < code.length; i += 1) {
    if (/\s/.test(code[i] ?? "")) continue;
    return code[i] === "{" ? i : -1;
  }
  return -1;
}

/**
 * 该 `{` 是否是某个 `if (<条件>) {` 的分支体;是则回填条件文本,否则 null。
 *
 * 判据 B 的档② 完全依赖它:「原样重抛」只有在**逐个 errno 显式决策过**的分支里才算合规。
 * @param {string} code 已抹注释的代码
 * @param {number} braceIndex `{` 的下标
 * @returns {string | null}
 */
export function ifGuardCondition(code, braceIndex) {
  let i = braceIndex - 1;
  while (i >= 0 && /\s/.test(code[i] ?? "")) i -= 1;
  if (code[i] !== ")") return null;
  const open = matchingOpenParen(code, i);
  if (open === -1) return null;
  let j = open - 1;
  while (j >= 0 && /\s/.test(code[j] ?? "")) j -= 1;
  if (!code.slice(Math.max(0, j - 1), j + 1).endsWith("if")) return null;
  return code.slice(open + 1, i);
}

/**
 * 从 `(` 处读出**首个实参**(到同层的 `,` 或 `)` 为止)。
 * @param {string} code 已抹注释的代码
 * @param {number} openParenIndex `(` 的下标
 * @returns {string | null} 实参原文(去首尾空白);括号不配平时 null
 */
export function firstArgument(code, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(openParenIndex + 1, i).trim();
    } else if (ch === "," && depth === 1) {
      return code.slice(openParenIndex + 1, i).trim();
    }
  }
  return null;
}

/**
 * 从 `throw` 处取该 throw 语句的文本(到同层 `;` 或行尾为止)。
 *
 * 只用于「这个 throw 是不是 `outputUnwritableError(…)` / 是不是原样重抛」两问,
 * 不用于任何需要完整 AST 的判定。
 * @param {string} code 已抹注释的代码
 * @param {number} throwIndex `throw` 的下标
 * @returns {string}
 */
export function throwStatement(code, throwIndex) {
  let depth = 0;
  for (let i = throwIndex; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return code.slice(throwIndex, i).trim();
      depth -= 1;
    } else if ((ch === ";" || ch === "\n") && depth === 0) {
      return code.slice(throwIndex, i).trim();
    }
  }
  return code.slice(throwIndex).trim();
}

/** catch 绑定的标识符名(`catch (err: unknown)` 也取 `err`);无绑定(`catch {`)返回 null。 */
export function catchBindingName(param) {
  if (param === undefined) return null;
  const name = /^\s*([A-Za-z_$][\w$]*)/.exec(param);
  return name === null ? null : name[1];
}

/**
 * @typedef {object} CatchThrow 一处 catch 内的 throw
 * @property {string | null} binding catch 绑定的标识符名
 * @property {number} catchOpen catch 体 `{` 在抹注释后代码里的下标
 * @property {string} statement 该 throw 语句的原文(抹注释后)
 * @property {number} index 该 `throw` 在抹注释后代码里的下标
 * @property {number} line 该 throw 的行号(1 起)
 */

/**
 * 抽出产物模块内每个 `catch` 块里的每个 `throw`。
 *
 * `.catch(…)` 方法由 {@link CATCH_RE} 的负向断言排除(见该常量注释)。
 * @param {string} text 源码文本
 * @returns {CatchThrow[]}
 */
export function extractCatchThrows(text) {
  const code = lexSource(text).code;
  const pairs = bracePairs(code);
  /** @type {CatchThrow[]} */
  const out = [];
  CATCH_RE.lastIndex = 0;
  for (const m of code.matchAll(CATCH_RE)) {
    const catchOpen = braceAfter(code, (m.index ?? 0) + m[0].length - 1);
    if (catchOpen === -1) continue;
    const end = pairs.get(catchOpen);
    if (end === undefined) continue;
    const binding = catchBindingName(m[1]);
    const body = code.slice(catchOpen + 1, end);
    THROW_RE.lastIndex = 0;
    for (const hit of body.matchAll(THROW_RE)) {
      const index = catchOpen + 1 + (hit.index ?? 0);
      out.push({ binding, catchOpen, statement: throwStatement(code, index), index, line: lineOf(code, index) });
    }
  }
  return out;
}

/**
 * @typedef {object} CallSite 一处 `outputUnwritableError(` 调用点
 * @property {string | null} key 实参取 `OUTPUT_UNWRITABLE_CODES.<键>` 时的键
 * @property {string | null} literal 实参取 `"OUTPUT_…"` 字面量时的值
 * @property {number} line 行号(1 起)
 */

/**
 * 抽出一份模块的登记表声明 + 全部 `outputUnwritableError(` 调用点。
 *
 * 计数与定位一律走**抹注释后**的代码:注释里写的 `outputUnwritableError(…)` 是文档,不是代码。
 * @param {string} text 源码文本
 * @returns {{ decls: { key: string, value: string, line: number }[], calls: CallSite[] }}
 */
export function extractRegistry(text) {
  const code = lexSource(text).code;
  const pairs = bracePairs(code);
  /** @type {{ key: string, value: string, line: number }[]} */
  const decls = [];
  REGISTRY_DECL_RE.lastIndex = 0;
  for (const m of code.matchAll(REGISTRY_DECL_RE)) {
    const braceIndex = code.indexOf("{", (m.index ?? 0) + m[0].length - 1);
    if (braceIndex === -1) continue;
    const end = pairs.get(braceIndex) ?? code.length;
    REGISTRY_ENTRY_RE.lastIndex = 0;
    for (const entry of code.slice(braceIndex + 1, end).matchAll(REGISTRY_ENTRY_RE)) {
      decls.push({
        key: entry[1] ?? "",
        value: entry[3] ?? "",
        line: lineOf(code, braceIndex + 1 + (entry.index ?? 0)),
      });
    }
  }
  /** @type {CallSite[]} */
  const calls = [];
  CALL_RE.lastIndex = 0;
  for (const m of code.matchAll(CALL_RE)) {
    const at = m.index ?? 0;
    // 函数**声明**(`export function outputUnwritableError(`)不是调用点
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, at - 12), at))) continue;
    const paren = code.indexOf("(", at);
    const arg = paren === -1 ? null : firstArgument(code, paren);
    const keyMatch = arg === null ? null : ARG_KEY_RE.exec(arg);
    const literalMatch = arg === null ? null : ARG_LITERAL_RE.exec(arg);
    calls.push({
      key: keyMatch === null ? null : (keyMatch[1] ?? ""),
      literal: literalMatch === null ? null : (literalMatch[2] ?? ""),
      line: lineOf(code, at),
    });
  }
  return { decls, calls };
}

/**
 * 档②:对捕获绑定的**原样重抛**,且词法上嵌在某个 errno 判定的 `if` 分支内。
 * @param {string} code 已抹注释的代码
 * @param {Map<number, number>} pairs bracePairs 的产物
 * @param {CatchThrow} site extractCatchThrows 的产物
 * @returns {boolean}
 */
export function isGuardedRethrow(code, pairs, site) {
  if (site.binding === null) return false;
  const escaped = site.binding.replace(/[$]/g, String.raw`\$`);
  if (!new RegExp(String.raw`^throw\s+` + escaped + String.raw`\s*;?$`).test(site.statement)) return false;
  let scope = enclosingScope(pairs, site.index);
  while (scope !== null && scope.start > site.catchOpen) {
    const guard = ifGuardCondition(code, scope.start);
    if (guard !== null && ERRNO_GUARD_RE.test(guard) && !CATCH_ALL_GUARD_RE.test(guard)) return true;
    scope = enclosingScope(pairs, scope.start - 1);
  }
  return false;
}

/**
 * 判定本体(纯函数:只吃一组「路径 → 源码文本」,不做任何 IO)。
 *
 * 纯函数是 selftest 能对它做**真变异**与**合成根**的前提 —— 两者走的都是同一条判定路径。
 * 两遍:第一遍收齐登记表与全部调用点,第二遍才判双向对读与 catch-throw 三档
 * (单遍会在「调用点所在文件排在登记表所在文件之前」时误判 —— 本仓恰好是反过来的,
 * 但那属于**巧合**,不是判据)。
 * @param {readonly { rel: string, text: string }[]} modules 产物模块集合
 * @param {{ notOutputFailures?: readonly NotOutputFailure[] }} [options] 注入面(自测用)
 * @returns {{ problems: RegistryProblem[], files: number, calls: number, registryKeys: number,
 *   usedNotOutput: number, staleNotOutput: string[], tierCounts: Record<string, number> }}
 */
export function judge(modules, options = {}) {
  const notOutput = options.notOutputFailures ?? NOT_OUTPUT_FAILURES;
  /** @type {RegistryProblem[]} */
  const problems = [];
  /** @type {Map<string, { file: string, line: number }>} */
  const registry = new Map();
  /** @type {Set<string>} */
  const registryValues = new Set();
  /** @type {Set<string>} */
  const thrownKeys = new Set();
  /** @type {{ rel: string, call: CallSite }[]} */
  const allCalls = [];
  /** @type {Set<number>} */
  const usedNotOutput = new Set();
  /** @type {Record<string, number>} */
  const tierCounts = { coded: 0, guarded: 0, registered: 0 };
  let calls = 0;

  // ---- 第一遍:收齐登记表声明与调用点 ----
  for (const module of modules) {
    const { decls, calls: moduleCalls } = extractRegistry(module.text);
    for (const decl of decls) {
      const first = registry.get(decl.key);
      if (first !== undefined) {
        problems.push({
          kind: "registry-duplicated",
          file: module.rel,
          line: decl.line,
          detail:
            `登记表的键 ${decl.key} 有第二个声明点(首次声明在 ${first.file}:${first.line})——`
            + "登记表必须单源,否则消费方不知道读哪一份",
        });
        continue;
      }
      registry.set(decl.key, { file: module.rel, line: decl.line });
      registryValues.add(decl.value);
    }
    calls += moduleCalls.length;
    for (const call of moduleCalls) allCalls.push({ rel: module.rel, call });
  }
  const registryFile = [...registry.values()][0]?.file ?? "(未找到)";

  // ---- 判据 A①:实参必须在表内 ----
  for (const { rel, call } of allCalls) {
    if (call.key !== null && call.key !== "") {
      if (!registry.has(call.key)) {
        problems.push({
          kind: "call-unregistered-code",
          file: rel,
          line: call.line,
          detail:
            `输出失败码的实参 OUTPUT_UNWRITABLE_CODES.${call.key} 不在登记表里`
            + `(登记表在 ${registryFile};已登记 ${registry.size} 条)—— 未登记的码落回 CLI 兜底档,`
            + "退出码从 4 静默变 3,而没有任何门禁会红",
        });
      }
      thrownKeys.add(call.key);
      continue;
    }
    if (call.literal !== null) {
      if (!registryValues.has(call.literal)) {
        problems.push({
          kind: "call-unregistered-code",
          file: rel,
          line: call.line,
          detail: `输出失败码的实参 ${call.literal} 不在登记表的值域里(登记表在 ${registryFile})`,
        });
      }
      continue;
    }
    problems.push({
      kind: "call-unresolvable-arg",
      file: rel,
      line: call.line,
      detail:
        "输出失败码的首个实参既不是 OUTPUT_UNWRITABLE_CODES.<键> 也不是 OUTPUT_* 字面量"
        + " —— 静态不可核对的实参等于没有契约(A① 无法验证它是否已登记)",
    });
  }

  // ---- 判据 A②:登记的每个键至少有一处抛出点 ----
  for (const [key, site] of registry) {
    if (thrownKeys.has(key)) continue;
    problems.push({
      kind: "registry-key-unused",
      file: site.file,
      line: site.line,
      detail:
        `登记表里的键 ${key} 在产物模块集合内没有任何抛出点 —— 死条目:`
        + "它让登记表看起来有覆盖面而实际没有(新增码忘了用 / 用它的抛出点被删了)",
    });
  }
  if (registry.size === 0) {
    problems.push({
      kind: "registry-missing",
      file: modules[0]?.rel ?? "",
      line: 0,
      detail:
        "扫描面内找不到 OUTPUT_UNWRITABLE_CODES = Object.freeze({…}) 声明点 —— "
        + "登记表被改名 / 搬走 / 改形状时,A①② 会在零判定面上「全绿」,那是本门禁最坏的假绿",
    });
  }

  // ---- 判据 B:catch-throw 三档归类 ----
  for (const module of modules) {
    const code = lexSource(module.text).code;
    const pairs = bracePairs(code);
    const lines = module.text.split(/\r?\n/);
    for (const site of extractCatchThrows(module.text)) {
      if (CODED_THROW_RE.test(site.statement)) {
        tierCounts.coded += 1;
        continue;
      }
      if (isGuardedRethrow(code, pairs, site)) {
        tierCounts.guarded += 1;
        continue;
      }
      const source = (lines[site.line - 1] ?? "").trim();
      const index = notOutput.findIndex((entry) => entry.file === module.rel && source.includes(entry.contains));
      if (index !== -1) {
        usedNotOutput.add(index);
        tierCounts.registered += 1;
        continue;
      }
      problems.push({
        kind: "throw-unclassified",
        file: module.rel,
        line: site.line,
        detail:
          "产物落盘链路 catch 块内的 throw 既没包登记表里的码、也不是 errno 判定分支里的原样重抛、"
          + `也没登记在「刻意不覆盖」表里:${snippet(source)}`,
      });
    }
  }

  return {
    problems,
    files: modules.length,
    calls,
    registryKeys: registry.size,
    usedNotOutput: usedNotOutput.size,
    staleNotOutput: notOutput
      .map((entry, index) => ({ id: entry.id, index }))
      .filter(({ index }) => !usedNotOutput.has(index))
      .map(({ id }) => id),
    tierCounts,
  };
}

/** 诊断片段:压掉多余空白,超长截断 */
function snippet(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 递归列出扫描面内的代码文件(仓相对 POSIX,已排序)。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]}
 */
export function listScanFiles(root) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ rel) => {
    const abs = path.join(root, ...rel.split("/"));
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (SKIP_DIR_NAMES.includes(entry.name)) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else if (CODE_EXTS.includes(path.extname(entry.name))) files.push(childRel);
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(root, ...scanRoot.split("/"));
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(scanRoot);
  }
  return files.sort();
}

/**
 * 全树判定。`base.root` 只为夹具而存在(selftest 在临时目录里逐点调用本函数)。
 * @param {{ root?: string }} [base] 注入面(目前只有根)
 */
export function analyze(base = {}) {
  const root = base.root ?? ROOT;
  const modules = listScanFiles(root).map((rel) => ({
    rel,
    text: readFileSync(path.join(root, ...rel.split("/")), "utf8"),
  }));
  return judge(modules);
}

/**
 * 自检探针:断言每条锚点的期望方向成立。
 * @returns {{ id: string, ok: boolean, detail: string }[]}
 */
export function runSelfProbe() {
  return SELF_PROBE.map((probe) => {
    const result = judge(Object.entries(probe.files).map(([rel, text]) => ({ rel, text })));
    const ok = probe.expectProblem ? result.problems.length > 0 : result.problems.length === 0;
    return {
      id: probe.id,
      ok,
      detail:
        `期望${probe.expectProblem ? "判红" : "零命中"},实得 ${result.problems.length} 项`
        + (result.problems.length > 0 ? `(${result.problems.map((p) => p.kind).join(",")})` : ""),
    };
  });
}

/**
 * 门禁入口。
 * @param {string[]} [argv]
 * @param {{ root?: string }} [base]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = [], base = {}) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => !arg.startsWith("--"));
  if (unknown.length > 0) {
    console.error(`[output-unwritable-registry:fail] 无法识别的参数:${unknown.join(" ")}(${USAGE})`);
    return 1;
  }

  // 判据 0 的探针必须先跑:探针坏了,后面的扫描结论全部不可信
  const probe = runSelfProbe();
  for (const item of probe) {
    console.error(
      `[output-unwritable-registry:self-probe:${item.ok ? "ok" : "fail"}] ${item.id}:${item.detail}`,
    );
  }
  if (probe.some((item) => !item.ok)) {
    console.error(
      "[output-unwritable-registry:fail] 内建探针未通过:判定规则与声明的高危形态不符,此时的扫描结果不可信",
    );
    return 1;
  }

  let result;
  try {
    result = analyze(base);
  } catch (error) {
    console.error(
      `[output-unwritable-registry:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  // 判据 1:扫描面塌缩下限
  if (result.files < MIN_SCANNED_FILES) {
    console.error(
      `[output-unwritable-registry:fail] 扫描面塌缩:只扫到 ${result.files} 个文件,低于下限 ${MIN_SCANNED_FILES}`
        + "(目录被搬走或 SCAN_ROOTS/CODE_EXTS 写坏时会出现;此时本门禁恒绿,等于不存在)",
    );
    return 1;
  }
  // 判据 2:登记表塌缩下限
  if (result.registryKeys < MIN_REGISTRY_CODES) {
    console.error(
      `[output-unwritable-registry:fail] 登记表塌缩:只认出 ${result.registryKeys} 条码,低于下限 ${MIN_REGISTRY_CODES}`
        + "(登记表被清空 / 改形状时会出现;此时 A①② 在近乎零判定面上「全绿」)",
    );
    return 1;
  }

  for (const id of result.staleNotOutput) {
    console.log(
      `[info] output-unwritable-registry:不覆盖登记本次零命中(可能已失效,请复核是否可删):${id}`,
    );
  }

  if (result.problems.length > 0) {
    for (const problem of result.problems) {
      const where = problem.line === 0 ? problem.file : `${problem.file}:${problem.line}`;
      console.error(`[output-unwritable-registry:fail] ${where} → ${problem.detail}`);
    }
    console.error(
      `[output-unwritable-registry:fail] 落盘失败码登记完整性判定失败,共 ${result.problems.length} 项`
        + `(扫描 ${result.files} 个文件 / ${result.calls} 处错误码构造 / 登记表 ${result.registryKeys} 条码双向对读;`
        + `catch-throw 三档命中 包码 ${result.tierCounts.coded} · errno 守卫重抛 ${result.tierCounts.guarded} · `
        + `登记豁免 ${result.tierCounts.registered};不覆盖登记 ${NOT_OUTPUT_FAILURES.length} 条,本次命中 `
        + `${result.usedNotOutput} 条)`,
    );
    console.error(
      "[output-unwritable-registry:fail] 漏登记的症状是**静默**的:CLI 判「输出写不了」读的是错误码"
        + "(src/cli/index.ts 的 itemExitCode,命中 OUTPUT_UNWRITABLE_CODES ⇒ 退出码 4,否则兜底 3),"
        + "漏登记一个新落盘失败点不会让任何门禁变红,只会让脚本化调用方把「输出写不了」读成「转换失败」。"
        + "两种正当出路:① 把该失败点改为 outputUnwritableError(OUTPUT_UNWRITABLE_CODES.<已登记键>, …);"
        + "② 它确实不是落盘失败,则在本门禁的 NOT_OUTPUT_FAILURES 里按**内容**(勿按行号)登记一条并写明"
        + "为什么与失效条件。",
    );
    return 1;
  }

  console.log(
    `[ok] 落盘失败码登记完整性判定通过:扫描 ${result.files} 个文件 / ${result.calls} 处错误码构造 / `
      + `登记表 ${result.registryKeys} 条码双向对读齐;catch-throw 三档命中 包码 ${result.tierCounts.coded} · `
      + `errno 守卫重抛 ${result.tierCounts.guarded} · 登记豁免 ${result.tierCounts.registered};`
      + `不覆盖登记 ${NOT_OUTPUT_FAILURES.length} 条(本次命中 ${result.usedNotOutput} 条);内建探针 ${probe.length} 条全过`,
  );
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
