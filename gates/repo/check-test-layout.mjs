// test 布局门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- `covers` 是什么、不是什么(2026-10-05 实测后写死)----
// **`covers` 是「被测主体清单」,不是「import 清单」。** 这不是约定而是 L4「声明通道」的
// 存在理由:段可以直接 import 本层主体,也可以**声明**自己测的是本层(判据静态看不见
// 那条路径时用)。⚠️ **因此不要提议「covers 与 import 对读」这一族判据** ——
// 实测两条方向都会大量误伤:「声明了却没 import」88 项 / 26 段(主体靠 `fs.readFileSync`
// 的**字符串路径**到达,`.css`/`.html` 天然不可 import,25 段零 import 命中);
// 「import 了却没声明」15 项,且「真漏声明」与「已审过的故意不声明」在 import 图上**完全同形**
// ——区分它需要判断「这段到底在断言什么」,而那已实测无法机器判(见 REQ-185/REQ-189)。
// 另注:同一族判据换个口径,实测结果能差 6.6 倍 ⇒ 选错口径就会产出一批无法归因的红。
//
// ---- 判据一览(八族 + 扫描面两档)----
//   ① test-layer-self-hosted(L4):`test/<R>/**/<m>.test.js` 必须 import **至少一个**
//      解析后落在 `<R>/` 对应主体根内的模块。零命中即判红并点名该段。
//   ② test-layer-cross-import(L5):`test/<L>/**` 不得 import **别的层**的
//      `dist/<其它层>/` / `src/<其它层>/` / `<其它层>/`。命中判红,诊断直接给出
//      「搬去 `test/behavior/` 并写 `covers`」的处置指引。
//   ③ test-top-dirs-exact(L7):`test/` 顶层**目录**集合 == 镜像源派生集 ∪ {behavior, harness}。
//      多一个少一个都判红。
//   ⑤ gate-has-carrier(L11):每道门禁都要有**可被证明的载体**。三档缺一即红 ——
//      同名 selftest 载体 或 某个验收段引用它 → pass;都不存在 → 查门禁级豁免表;
//      都没有 → 判红。载体存在的全部意义是「有人能证明它坏掉时门禁会红」。
//   ⑥ gate-chain-membership(L12 / L12c):门禁的**接入点归属**。取值域两值
//      (`chain` / `offchain`),两向核对:`chain` 的真在链上、`offchain` 的不得在链上;
//      `offchain` 可带 `pendingChain` 显式登记「本应进链、因 <理由> 未转正」(L12c)。
//      **已转 fail-closed**(2026-10-05,ADR-062 S3):取值域迁移完成 —— 清单侧
//      `gates/repo/gate-index.mjs` 已两值化,迁移后清掉取值域那一档的剩余命中数为零。
//   ⑦ test-harness-not-segment(L8):`test/harness/` 是**自指层**(主体根 = 它自己);
//      其下的段**必须**声明 `covers` 且至少一个元素指向 `test/harness/**`
//      (未声明 / 空声明 / 元素全指向别处,三者各自判红)。
//   ⑧ gate-module-present(L11b):**清单在册而树里无** —— 门禁本体被删除 / 改名时判红。
//      这一档与 `gate-has-carrier` 的处置不同(补载体 vs 恢复本体或删登记项),故单列一个 id。
//   ⑨ test-dist-artifact-source-mirror(C1 档一):段的**被测 import**落在 `dist/**` 时,
//      该产物的镜像源文件(按 tsc 的 emit 规则反推扩展名)必须在 `src/**` 下**真实存在**。
//   ⑩ test-segment-mirror-same-name(C1 档二):段路径镜像某个真实存在的 `src/**` 源文件时,
//      它的被测 import **必须**落在那同一个源文件的**同名**编译产物上。
//   ⑪ test-layer-gate-subject(C3 / L4 第三档):段住在**非门禁层**却 import `gates/` 树
//      ⇒ 判红,除非在**门禁主体豁免表**登记并给出达标理由(判准与 L5 那张表不同,见下)。
//
// ---- L4 为什么必须判「零命中」而不是只判「import 落在别处」 ----
// 一条只检查「不许 import 别层」的规则,在**一个本层主体都没 import** 的段上会全绿 ——
// 而那正是最该被抓的形态:`test/core/runner-report.test.js`(797 行)import 的是
// `test/harness/runner.js`(测试框架自身),`test/shared/entry-exit-guard.test.js` 测的是
// `shared/entry-guard.mjs`,`test/behavior/contract-single-source.test.js` 零 `gates/` import。
// 「至少一个」这条下界(而非「不许越界」那条上界)才是 L4 的全部内容。
//
// ---- L4 的「本层主体根」是什么 ----
// 主体根按层分两种形态,与镜像源集合的两种来源同构:
//   - `src/` 的直接子目录 R → `src/R/` **与** `dist/R/`(源与产物都算本层主体);
//   - 仓顶层树 R(gates/shared/tools)→ 只有 `R/`。
// 为什么 `src/R/` 与 `dist/R/` 都算:本仓的验收段跑**产物**(`dist/` 是 tsc 输出,
// 覆盖率与 `test:smoke` 的新鲜度门禁都以它为准),而类型引用只能指 `src/`
// (见下节)。只认其一会把另一半合法形态判红。
//
// ---- 值 import 与 type-only 引用必须分开(否则合法形态被误判) ----
// 本仓的 `dist/` **不产 `.d.ts`**(tsconfig.test.json 的 checkJs 关闭、产物只发 JS),
// 所以测试段里有一批**类型引用只能指 `src/`**:实测形如
// `test/core/render-defaults.test.js:36` 的
// `@typedef {import("../../src/core/i18n.js").ConvertWarning} Warning`。
// 这些引用合法且必需(改成指 `dist/` 会因缺声明文件而失去类型),**不得判红**。
// 判据因此复用 `check-import-boundary.mjs` 导出的 `isTypeOnlyClause`(词法层已区分
// `import type` 与行内 `type` 说明符),并对 JSDoc 里的 `import("…")` 形态单列一条:
// `import("…")` 出现在**代码**里是运行期动态 import,出现在**注释**里才是类型引用 ——
// 两者字面同形,靠 `lexSource` 的「抹注释」结果区分(代码里那个下标在 code 中仍是
// `import(`,注释里那个已被抹成空格)。
//
// ---- C1 的口径:什么算「被测 import」(C1 两档共用,单一定义) ----
//
// 段的 import 一共五类,只有一类进 C1 两档。**逐类给出排除依据**,不写「显然不是被测的」:
//   ① `node:` 内建 / 第三方包(`electron`／`jszip`／`pdf-lib`／`highlight.js`／`iconv-lite`)
//      —— 裸包名,`extractImports` 的 `add()` 只对 `spec.startsWith(".")` 产出 `resolved`,
//      故它们**天然** `resolved === null`。它们不是被测对象,也不是仓内产物。
//   ② `test/harness/**`(测试助手层)—— **测试框架自身**,L4 已把 `harness` 登记为自指层
//      (主体根 = `test/harness/` 自己)。助手不是被测源;实测 140 段对它有 289 处引用,
//      把它算进「被测」会让分母失真、判据退化成「谁引用助手最多」。
//   ③ 其它段(`test/**/<x>.test.js`)—— L4 的「段 import 段」那一档已经判红;C1 再判一次
//      是同一事实报两遍,只会在归因时让人分不清是哪一档的处置。
//   ④ **type-only 引用** —— 编译期擦除。它不是「段取得被测对象的手段」,而是一句类型标注。
//      ⚠ 仓内确有 73 处 `src/**` 的 type-only 引用与 1 处 `dist/**` 的
//      (`test/main/settings.test.js:104` 的 `typeof import("../../dist/main/persist/settings.js")`),
//      **把它们算进分母会把 C1 变成「类型标注写对没有」的检查** —— 那不是这一族要拦的东西。
//      与 L4/L5 排除 type-only 同款取舍(同一个 `isTypeOnlyClause`,不另立口径)。
//   ⑤ **`src/**` 的值引用** —— C1 两档的**判据对象都是 `dist/**`**,源侧只用来做存在性核对
//      (C1 档二还要用它算「同名产物」)。源侧的值引用本身不构成一档:实测 140 段对 `src/**`
//      的值引用**恒为 0**(tsc 不产 `.d.ts`,故类型只能指 `src/`、值只能指 `dist/`)。
//
// ⇒ 收敂成一句:**被测 import = 解析后落在 `dist/**` 的值引用**。C1 两档都只认这一类。
//
// ---- C1 两档的分工(为什么不是一个判据) ----
//   档一(`test-dist-artifact-source-mirror`)问的是**产物侧**:这个 `dist/**` 产物背后
//   有没有真源文件。它抓的是「段 import 了一个 src 已删 / 从未存在的产物」——
//   `dist/` 是 gitignored 的(`.gitignore:3`),所以**判据不能问「产物在不在版本控制里」**
//   (那对构建产物恒为否),只能**按构建产物路径反推源路径**再问源文件在不在磁盘上。
//   档二(`test-segment-mirror-same-name`)问的是**段侧**:段路径既然镜像了某个 `src/**`
//   源文件,它的被测 import 就**必须**落在那同一个源文件的同名产物上。它抓的是
//   「段自称在测 X、实际测的是 Y」—— 段名与被测对象脱钩。
//   ⚠ 两档的**处置不同**(补源文件 / 补 import 或改段名),故各占一个 id 而不是合成一档。
//
// ---- C3 与 L5 的分工(为什么不是同一族的第二档) ----
// L5 与 C3 都在同一批边上判,但**问的问题不同**,处置也不同:
//   - L5 问「这次跨层 import 在本段里**是不是只提供数据/常量/规格**」⇒ 处置是搬去
//     `test/behavior/` 并写 `covers`,或登记进 L5 豁免表。
//   - C3 问「这个段**住在这一层**对不对」—— 它伸手进了 `gates/` 树,而 `gates/` 是仓里
//     放门禁判定本体的树。一个段住在 `test/shared/` 却 import 门禁判定本体,**即使那次
//     import 真的只提供数据**,段的位置也已经可疑了(它到底在测 shared 还是在测门禁?)。
// ⇒ **L5 表里已登记的边不豁免 C3**:实测 `test/shared/geometry-gate.test.js →
//   gates/geometry/geometry/driver.mjs` 正是这种形态(L5 表里那条 reason 156 字、
//   已按「只提供规格」合法通过 L5),而 C3 仍判红。C3 的处置是**换层**(搬去 `test/gates/`)
//   或**登记门禁主体豁免表**并说明为什么段住在这一层是对的。
//
// ---- 镜像源集合为什么从磁盘派生(两层来源) ----
//   - `src/` 的直接子目录:**从磁盘列**。这是本门禁派生的一半,新增/合并层自动跟随。
//   - 仓顶层树:**取 `check-import-boundary.mjs` 的 `TREE_DIRS` 去掉 `test` 自身**
//     (`gates` / `shared` / `tools`)。不另列一张表 —— 那正是 ADR 判据反复批过的
//     「两份可漂移的副本」;顶层树集合在仓内已有单源(`TREE_DIRS` 是 ADR-038/043 的
//     树边界登记),本门禁读它而不是重抄一遍。
// ⚠ 这与 `SEGMENT_DIRS`(当前硬编码在 `shared/test-common-surface.js:47`)无关:
// 那张表**将在 T2/P2 被删除**,故本门禁**不得**依赖它 —— 段的发现机制是
// `test/harness/runner.js` 逐目录 `readdir` 过滤 `.endsWith(".test.js")`,**纯 glob、
// 无注册表**,本门禁照此发现,不读任何段目录清单。
//
// ---- 强制等级:判据登记表 `CRITERIA` + 唯一分流漏斗 `report(id, line)` ----
//
// 每一族判据发出形如 `<对象> → <机器 id>:<诊断>` 的一行。**这行进 problems 还是 info,
// 不由任何调用点决定,只由本文件的 `CRITERIA` 表决定** —— 全门禁只有一个分流出口:
//
//   report(id, line)  →  查 CRITERIA  →  `pending === true` ? info : problems
//
// 判定本体里不再有第二处 push 到 problems / info 的代码路径(要加一族判据只能经 report),
// 而 CLI 上**没有任何开关能改变这一档**:命令行一档来自表,不是来自 argv。
//
// **缺标记即 fail-closed**:表里查不到 = 进 problems。漏登记的那一族按 fail-closed 处理,
// 但那正是要防的失效形态 —— 登记表的全部意义是「谁该判红」有一个声明处,漏登记等于那一族
// 的强制等级无人负责。故漏斗查不到时**额外**追加一条 `criteria-unregistered:<id>` 判红:
// 不抛异常(那会把一族的漏登记变成整场崩溃,掩盖其余判红)、不静默归 problems(那样从输出里
// 看不出它漏了)、也不丢弃(那等于让这一族静默消失)。
//
// `pending: true` 是**唯一**的 report-only 标记,且必须同时给非空 `pendingReason`。
// 它**不是形参、不是 CLI 开关**:能传参就能把自己摘出去,那本身是 fail-open ——
// report-only 是一个**声明**,声明只改源码。当前待转正的族数:
//
//   grep -nE '^\s*pending: true,$' gates/repo/check-test-layout.mjs
//
// **切换点 = 删掉那一行的 `pending: true`**(连带它的 `pendingReason`)。
// ⚠ 登记表与源码发出的 id 集合**双向相等**由 selftest 的 `sourceAudit` 一档独立钉住:
// 它读本文件源码(不是夹具副本)抽出全部 `→ <机器 id>:` 的 id,与 `CRITERIA` 两个方向都比 ——
// 漏登记(源码有、表里没有)与僵尸行(表里有、源码已删)各红一次:后者会让上面那条 grep 的
// 命中数说谎,而那正是「还剩几族待转正」的唯一读数。
//
// ---- L5 曾恒报告:为什么曾那样,以及它凭什么能转正 ----
// L5 在 T1 建时**当前即红**,且**已知会误伤合理跨层**:实测
// `test/behavior/heading-scale.test.js` import `dist/renderer/settings/settings-logic.js`
// 做 token 对照,`test/shared/geometry-gate.test.js` import `shared/geometry/*`
// (几何 core 本就归 shared),这类跨层是**有意的**。把这种误伤做成 fail-closed,
// 会逼人去删正确的测试或塞豁免表 —— 那比判红本身更坏。故它当时拿的是 report-only 一档。
//
// **转正的前置条件是「未登记命中归零」,不是字面的「命中数 == 0」**:已登记、reason 达标、
// 且当前仍真的命中(stale 检查通过)的豁免项是**合法现状**,不是待办。所以「命中总数不为零」
// 本身不构成阻塞;构成阻塞的是三条 fail-closed 里任一条为红 —— 未登记命中非零 / reason 不合格
// (空**或**不足 `REASON_MIN_CHARS` 字)/ stale 非零。在那个条件下 L5 已转 fail-closed,即
// `CRITERIA` 里 `test-layer-cross-import`
// 那行**不带** `pending: true`。豁免命中在判定本体里 `continue` 掉、根本到不了分流点,
// 因此豁免表在真仓库上实测不产生任何 info 行 —— 那是设计:表项是「已审过的合法现状」,
// 不是待办噪声。
//
// ---- 形状:判定本体 = `checkTestLayout(ctx)`(可注入、零 IO 副作用) ----
// 与 check-src-layout.mjs / check-copy-sites.mjs 同一范式(全仓门禁判定协议,见
// gates/probe/gate-probes/protocol.mjs):IO 全部经 ctx 注入(读文本 / 列目录 /
// 扫描面下限),`main()` 只做「打印 + 按结论出 0/1」。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁注册表 import 当判定本体指针。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码);而注册表
// R4b 会逐项对账「judgment.load 声明」与「顶层是否自执行」的事实。守卫写法与
// check-src-layout.mjs / check-import-boundary.mjs / check-changelog.mjs 同形。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";
import { isTypeOnlyClause, TREE_DIRS } from "./check-import-boundary.mjs";
// 链展开(递归展开 / 顶层视图)与链根都是**全仓单源**:本门禁不自带一份链解析,
// 也不自带一份链根表(见 chain-expand.mjs 文件头「为什么必须收敛到一处」)。
import { CHAIN_ROOTS, expandChainScriptNames } from "./chain-expand.mjs";
// 门禁索引(L11 载体 / L12 链归属的判定面)。**静态 import,不走 ctx** —— 它是代码里的常量
// 表而非磁盘数据,与 readText/listDir 那套 IO 注入面不同性质。替身由 base.gateRegistry
// 注入(见 makeGateRegistryCtx 的注释),理由同 `l5Exemptions`:自检要在合成根上求值。
//
// 本门禁对索引的**结构**依赖刻意收窄到四项 —— `id` / `access` / `npmScripts` / `modulePath` ——
// (`judgment` / `enforcement` 两个字段本门禁一个都不读:前者是驱动器协议的事,后者是「强制等级
// 表在哪」的指针,与 L11/L12 两条判据无关)。`probes[]` 与 `judgmentNote` 在旧 `registry.mjs` 里
// 就有而本门禁一个都不读:读 `probes[].ref` 会让 L11 退化成「注册表自己声明的载体存在吗」,那
// 正是注册表 R3 的既有职责,两处各判一次同一件事 = 一处可漂移的副本。
//
// ⚠ **S3 已改这一处**(2026-10-05):清单从 `gates/probe/gate-probes/registry.mjs` 换成
// `gates/repo/gate-index.mjs`(ADR-062 的 P6)。**两表并存**:旧表随 S4 整体删除,它承载的
// R1–R5c 与三种驱动器在本步一条不动。双跑一致性由 `gate-index.selftest.mjs` 断言。
import { ACCESS_CHAIN, ACCESS_OFFCHAIN, GATE_INDEX, GATE_INDEX_MODULE_REL as GATE_INDEX_SELF_REL } from "./gate-index.mjs";

/** 被判定的子树(单一来源:扫描面只此一处登记) */
export const TEST_REL = "test";
/** 段的扩展名(发现机制与 `test/harness/runner.js` 的 readdir 过滤逐字一致) */
export const SEGMENT_EXT = ".test.js";
/**
 * 允许存在但**不是镜像源**的两个顶层目录。
 *
 * `behavior` 收跨层测试(一个段横跨多层是它的**定义**,不是错位 —— 故它既不在 L4 的
 * 作用域内,L5 也不对它生效);`harness` 收测试框架自身(runner / assert / 夹具助手),
 * 它不是任何被测层的主体。
 *
 * 为什么这两个名字**必须**登记而不能纯派生:L7 的判据形状是「集合相等」,而这两个目录
 * 在仓内**没有对应的镜像源**(它们对应的是「测试的组织方式」而不是「被测的层」)。
 * 纯派生出的集合里没有它们,不给登记位就恒红。注意这与「登记一份镜像源清单」是相反
 * 性质的常量:镜像源那一半从磁盘派生,这里登记的是**派生之外的豁免位**,两者不会互相漂移。
 */
export const NON_MIRROR_TOP_DIRS = Object.freeze(["behavior", "harness"]);
/**
 * **自指层**的段目录名(L4 主体根 + L8 窄口子的作用域标记)。
 *
 * 「自指」= 它的被测主体就是它自己:测「测试框架自身」的段(`runner-report` /
 * `test-common-helpers` / `dual-pipeline-decision-ledger`)主体全在 `test/harness/**`。
 * 它与 `behavior` 的区别要分清:behavior 是**横跨多层**(被测主体在别处,位置不表达被测层),
 * harness 是**主体在本目录内**(被测代码与测试框架同处一树)。
 *
 * 单列成常量(与 `BEHAVIOR_DIR` 同款理由):L4 的 `rootsOf` 分支与 L8 的窄口子都按它判定,
 * 与 `NON_MIRROR_TOP_DIRS` 里那一项指的是同一个目录 —— 两处各写一份字面量就是一处可漂移
 * 的副本,漂移后果是 harness 段静默失去 L8 约束(无人声明也无人报错)。
 */
export const HARNESS_DIR = "harness";
/**
 * **自指层主体根**的前缀(仓相对 POSIX)。L4 的「本层主体根」与 L8 的「元素须指向本层」
 * 用的是同一个前缀常量 —— 写成两处字面量就会出现「L4 认它、L8 不认它」的裂缝。
 */
export const HARNESS_ROOT = `${TEST_REL}/${HARNESS_DIR}/`;
/**
 * 跨层段的段目录名(L6 的作用域标记)。
 *
 * 单列成常量而不是在 L6 里写字面量 `"behavior"`:判据本体与 `NON_MIRROR_TOP_DIRS` 里那一项
 * 指的是同一个目录,两处各写一份字面量就是一处可漂移的副本 —— 而漂移的后果是 L6 静默
 * 失去作用域(behavior 段不再被要求声明,而没人会注意到)。
 */
export const BEHAVIOR_DIR = "behavior";

/**
 * **门禁层**的段目录名(C3 的作用域排除项 —— `test/gates/**` 的段不参与 C3)。
 *
 * 单列成常量而不是在 C3 里写字面量 `"gates"`:段目录名与 `GATES_TREE` 的树前缀是同一个
 * 名字在两处出现,各写一份字面量时改名只改一半的后果是「C3 突然把门禁段全判红」
 * (实测 31 项)—— 而那正是判据最容易归因失败的一类红。
 *
 * ⚠ 它与 {@link GATES_TREE} 是**两个不同的字面量**(`"gates"` vs `"gates/"`):前者是
 * `test/` 下的**段目录名**,后者是仓根下的**树前缀**。写成同一个常量会让「段目录」
 * 与「树」这两个不同层级的概念共用一个值。
 */
export const GATES_DIR = "gates";
/**
 * 扫描面(段)文件数下限:walker 整体失效(零段)时五族判据会「全绿」,而恒绿是纯文本门禁
 * 最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。取实测值的约 3/4
 * (实测 134 段 → 下限 100),只在「塌缩」这一档报红,不随日常增删段抖动。
 */
export const MIN_SCANNED_FILES = 100;
/**
 * L5 跨层 import 的**豁免表**(数据文件路径,与门禁本体分离 —— 本体里那份会是可漂移的副本)。
 *
 * 形态是 `(段路径, 说明符)` **二元组**,不是段级全放行:一张段级表项就能掩盖该段将来
 * 所有新增的跨层 import,而那正是这张表要拦的东西。粒度收到说明符一级,「同段新增一条
 * 跨层 import」就仍然判红。
 *
 * 表项的合法性由三条 fail-closed 撑着(判据见 judgeL5Exemptions 的注释):未登记判红、
 * reason 不合格判红(空**或**不足 `REASON_MIN_CHARS` 字)、**stale 判红**(登记了却当前不再命中
 * —— ratchet 的全部意义:否则删掉
 * 代码而豁免永远留着,表只会单调增长)。
 *
 * 豁免的判准写在数据文件的 `exemptionCriterion` 字段里(单一来源,改判准只改那一处)。
 */
export const L5_EXEMPTIONS_REL = "gates/repo/test-layout.cross-import-exemptions.json";

/**
 * 门禁索引的模块路径(仓相对 POSIX)。**S3 已把它从 `gates/probe/gate-probes/registry.mjs`
 * 改成 `gates/repo/gate-index.mjs`**;旧表在 S4 整体删除。
 *
 * 单独成为常量而不是在 import 语句与诊断文案里各写一遍:该路径出现在诊断文案里(判红时
 * 点名「哪张表错了」),两处各写一份就是一处会与 import 语句漂移的副本 —— 而漂移的后果是
 * **诊断点名一张表、判据实际读的是另一张**。
 *
 * ⚠ 值从 `gate-index.mjs` **转出**而不是在本文件重写:那张表是自身路径的单一事实源,
 * 两处各写一份则「禁自指」规则(指针不得指向本表)会在 S4 后指向一个错的文件。
 * @type {string}
 */
export const GATE_INDEX_MODULE_REL = GATE_INDEX_SELF_REL;

/**
 * L11 门禁级豁免表(数据文件路径,与门禁本体分离 —— 本体里那份会是可漂移的副本)。
 *
 * 形态是**门禁 id 一元组**(不是 npm script、不是段路径):L11 的判定对象是「一道门禁有没有
 * 载体」,载体挂在门禁上,故键只能是门禁 id。
 *
 * ⚠ **本表是空表**:实测(L11 三档跑在真实仓库上)当前**零命中** —— 在册门禁里一部分有同名
 * selftest 载体、其余被某个验收段引用(见 judgeL11Carrier 的注释),无一落到档 3。表按
 * ADR-062 的形态先建成骨架(键名校验 / 读表 / stale 三档 fail-**closed** 全部就位),
 * 而不是等第一次命中再建 —— 那正是「第一次命中」时最需要它的时刻。
 *
 * ⚠ **它不可从本文件现有的任何常量派生**,故必须新建而不是复用:
 *   - `SEGMENT_DIRS`(段目录名表,与门禁无关,且本文件已明写「不读 SEGMENT_DIRS」);
 *   - `SCAN_TARGETS`(扫描面,与门禁无关);
 *   - `L5_EXEMPTIONS_REL` 那张表(形状是 `(段, 说明符)`、语义是跨层 import,与门禁无交集)。
 * @type {string}
 */
export const GATE_EXEMPTIONS_REL = "gates/repo/test-layout.gate-exemptions.json";

/**
 * C3(`test-layer-gate-subject`)的门禁主体豁免表 —— **一张新表,不复用 L5 那张**。
 *
 * 形态是 `(段路径, 说明符)` **二元组**,与 L5 同款粒度:一张段级表项会让该段将来新增的
 * 任何一条 `gates/` 跨层边都被放行,而那正是这张表要拦的东西。
 *
 * ⚠ **为什么必须新建而不是复用 `L5_EXEMPTIONS_REL`**(理由见文件头「C3 与 L5 的分工」):
 * 两张表**问的不是同一个问题** —— L5 问「这次 import 是不是只提供数据」,C3 问
 * 「这个段住在这一层对不对」。若并表,`test/shared/geometry-gate.test.js` 那条已按
 * 「只提供规格」合法登记的边会**连 C3 一起豁免掉** ⇒ C3 在真实仓库上恒为零命中,
 * 即「建了机制但没有任何一处真的判过红」。那与没有这一族不可区分。
 *
 * ⚠ **本表当前只有一条表项**,是实测判红的现存一处(见数据文件里该表项的 reason)。
 * 后续新增命中时,`--write-l5-exemptions` 那样的生成入口**刻意不提供**:
 * 本表的表项**不是「先豁免后补理由」的正当形态** —— 它登记的是「这个段的层归属是对的,
 * 而门禁主体在这里是被测输入」,写不出这句话就说明该搬段而不是该登记。
 *
 * 表项合法性由三条 fail-closed 撑着:键名写错判红 / reason 不达标判红(空**或**不足
 * `REASON_MIN_CHARS` 字)/ **stale 判红**(登记了却当前不再命中 —— ratchet 的全部意义)。
 *
 * ⚠ **数据文件与本体分离**(与另两张豁免表同款):本体里那份常量会是可漂移的副本,而
 * 本仓反复批过那种副本。表项的演进(段被搬走 / import 被删)因此**表现为对数据文件的
 * 编辑**,而判据本体一行不动 —— 这与「改判据语义」在 diff 上彻底分开。
 *
 * 豁免的判准写在数据文件的 `exemptionCriterion` 字段里(单一来源,改判准只改那一处)。
 * @type {string}
 */
export const GATE_SUBJECT_EXEMPTIONS_REL = "gates/repo/test-layout.gate-subject-exemptions.json";

/**
 * `dist/**` 产物扩展名 → 其镜像 `src/**` 源文件的**候选**扩展名(按 `tsconfig.json` 的
 * `outDir: dist` + `module: NodeNext` 的 emit 规则反推,**不是**一份登记的镜像源清单)。
 *
 * ⚠ **为什么候选是「一组」而不是一个**:`.js` 产物可能来自 `.ts`(常规)、`.tsx`(JSX)或
 * **`.js` 本身**(`allowJs` 形态)。实测仓内 `src/renderer/lang-bootstrap.js` 就是后者 ——
 * 它是 git 跟踪的源文件,而 tsc 把它原样复制到 `dist/renderer/lang-bootstrap.js`
 * (实测两文件字节数相同)。**只认 `.ts` 会把这类合法产物判红**,而 `.js` 的判红才是
 * 本族要抓的「src 已删 / 从未有」形态。`.mjs` ← `.mts`、`.cjs` ← `.cts` 是 NodeNext 的
 * 模块后缀配对。
 *
 * ⚠ **判据据此推的是「源侧」的存在性,不是「产物侧」的在版本控制里**:见头注「C1 档一」。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ARTIFACT_SOURCE_EXTS = Object.freeze({
  ".js": Object.freeze([".ts", ".tsx", ".js"]),
  ".mjs": Object.freeze([".mts"]),
  ".cjs": Object.freeze([".cts"]),
});

/**
 * `src/**` 源文件扩展名 → 它编译出的 `dist/**` 产物扩展名(C1 档二算「同名产物」用)。
 *
 * 与 {@link ARTIFACT_SOURCE_EXTS} 是**互逆关系**(那份「产物 → 哪些源可能产出它」,
 * 这份「源 → 它产出哪个产物」)。两份方向不同、用途不同,故各写一份;⚠ 若 tsc 的
 * emit 规则变了(新增后缀配对),**两份必须同批改** —— 档一靠前者抓「源不存在」,
 * 档二靠后者算「同名产物」,任一份单独漂移的后果是同一族的两档给出互相矛盾的结论
 * (一份说「产物无源」、另一份说「段没落在同名产物上」)。
 *
 * `.ts` / `.tsx` → `.js`、`.mts` → `.mjs`、`.cts` → `.cjs`、`.js` → `.js`。
 * @type {Readonly<Record<string, string>>}
 */
export const SOURCE_ARTIFACT_EXTS = Object.freeze({
  ".ts": ".js",
  ".tsx": ".js",
  ".mts": ".mjs",
  ".cts": ".cjs",
  ".js": ".js",
});

/** 编译产物树与源树的仓相对前缀(各写一份的代价:两处字面量各改一半 ⇒ 判据静默恒红/恒绿) */
export const DIST_TREE = "dist/";
export const SRC_TREE = "src/";

/**
 * **门禁树**的仓相对前缀(C3 的判据面)。
 *
 * ⚠ **为什么是常量而不是从 `TREE_DIRS` 派生**:`TREE_DIRS` 的四个值是 `gates` / `shared` /
 * `tools` / `test`,「哪一个是门禁树」**不是**那棵树的结构属性、而是它的**角色** ——
 * 判据要问的是「段有没有把手伸进门禁判定的本体」,而 `gates/` 是仓里放门禁本体的位置。
 * 从 `TREE_DIRS` 里挑一个(`topTrees[0]` 之类)会得到一个**随表序漂移**的答案:
 * 表里换一行顺序,C3 的判据面就静默变成 `shared/` —— 而那正是「判据指向了另一棵树」
 * 这一类最难归因的红。写成字面量并在此单列,是刻意的。
 *
 * 另注:**它与 L5 的豁免表覆盖面不同**。L5 判「跨层 import」不限哪棵树;C3 只问 `gates/`。
 * `rootsOf("gates")` 同样是 `["gates/"]`,与本常量一致(两处若漂移,C3 与 L4 的主体根
 * 会对同一段给出不同结论 —— 判据面必须单源)。
 */
export const GATES_TREE = "gates/";

/**
 * 门禁「接入点归属」的取值域(ADR-062 L12:两值)。`chain` 的真在链上,`offchain` 的不得在。
 *
 * ⚠ **从 `gate-index.mjs` 转出而不是在这里重写**:取值域是**那张表的字段契约**(它写
 * `access: "chain"` / `"offchain"`),定义权在表那一侧。两处各写一份字面量,表改了取值名
 * 而判定侧没跟上时,判据会把**表里全部登记项**报成「取值域非法」—— 而那正是本门禁最难归因的
 * 一类红(诊断指向每一项,而真因是常量漂移)。登记项数随新增门禁变,要重新取它跑
 * `node -e "import('./gates/repo/gate-index.mjs').then(m=>console.log(Object.keys(m.GATE_INDEX).length))"`。
 */
export { ACCESS_CHAIN, ACCESS_OFFCHAIN };

/**
 * **未转正的旧取值**(`local` / `workflow`)。
 *
 * 单列成常量而不是在判定本体里写字面量:它们是「取值域不合法的证据」,而取值域一旦合法
 * 就该整体消失 —— 让判据能**指名道姓**地说出「哪个旧值还剩几项」,比只报「取值域非法」可归因。
 *
 * ⚠ **`gate-index.mjs` 已无这两个取值**(S3 的迁移完成),本常量当前**只**在两处发挥作用:
 * ① 诊断文案点名旧值;② 并存期的旧 `registry.mjs` 若被谁原样搬进新表,判据会指名道姓地说出
 * 「它是 S3 尚未迁移的旧值」。**不删** —— 删掉它就只剩「取值域非法」一句,读者无从判断
 * 该改字面名还是该改语义。
 * @type {readonly string[]}
 */
export const LEGACY_ACCESS_VALUES = Object.freeze(["local", "workflow"]);

/**
 * L5 豁免表 `reason` 的**最低码点数**。声明出处:`ADR-062` 的 L2「每条豁免须有
 * `reason`(≥20 字)」—— 在此之前这道门槛**只写在 ADR 里、门禁上没有任何机器判据**
 * (判定本体只判 `trim()` 后为空),故「≥20 字」长期是一句无人执行的散文。
 *
 * 单列成常量而不是在判定本体里写裸字面量 `20`:ADR-062:72 是它的声明出处,而门禁里
 * `L5_EXEMPTIONS_REL` / `PENDING_PREFIX` 这类可 grep 的锚是同款做法 —— 判据得追得到它的出处。
 *
 * ⚠ **数字符,不是数字节,也不是数字符宽度**;且数的是**码点**:
 *   - 先 `trim()` 再数 —— 首尾空白不该计入理由的篇幅(缩进排版不是理由)。
 *   - 数码点(`[...s].length`)而非 `String.prototype.length`:后者数的是 UTF-16 **单元**,
 *     一条用非 BMP 字符(emoji / 汉字扩展区)写的理由在 `.length` 下会被算成两倍 ——
 *     门槛就成了可绕过的。本表现有 `reason` 全是 BMP 中文,两者当前相等,但那是数据事实,
 *     不是判据保证。自检里有一格专门拿非 BMP 字符钉住这个口径。
 *
 * @type {number}
 */
export const REASON_MIN_CHARS = 20;

/**
 * `reason` 的有效字数:**先 trim,再数码点**。判定本体与「恰好等于门槛」那格自检的同口径来源
 * (自检经诊断里回显的字数断言,不直接调本函数 —— 用被测实现造夹具会让那一格自证)。
 * @param {string} text 待量的 `reason` 原文
 * @returns {number} trim 后的码点数
 */
const reasonChars = (text) => [...text.trim()].length;

/**
 * ⚠ **判据登记表(强制等级的唯一声明处)**。
 *
 * 一行 = 一个机器 id。**键必须是源码里实际发出的那个 id**(即诊断行里 `→ <id>:` 那一段),
 * 而不是 L4–L8 的编号:按编号建表会漏掉三族不带编号的判据
 * (`scan-surface-missing` / `scan-surface-collapsed` / `l5-exemption-stale` / 豁免表本身
 * 的读表与键名两档),而漏登记的后果就是那一族的强制等级无人负责。
 *
 * 字段:
 *   - `id` —— 漏斗 `report(id, line)` 的查表键,与源码发出的机器 id 逐字相等;
 *   - `title` —— 人读的一行判据名(诊断与自检报告用);
 *   - `pending` —— **缺省即 fail-closed**。`true` = report-only(命中进 info、结构上不参与退出码),
 *     且**必须**同时给非空 `pendingReason`(写不出理由就不该挂待办标记);
 *   - `pendingReason` —— 为什么这一族还不能转判红;也是转正时要先核掉的那条。
 *
 * **不可注入**(与 `LAYER_RULES` 同层):能传参就能把自己摘出去,那本身是 fail-open。
 * 唯一例外是自检用的 `criteriaOverride`,它**只允许删行、不允许加 `pending`** ——
 * 见 `resolveCriteria` 的注释与 selftest 里那两条夹具的说明。
 *
 * ⚠ **它与「哪些族存在」是耦合的**:改判据集合必须同改这张表,反向亦然。漏了任一边,
 * selftest 的 `sourceAudit` 那一档立刻红(它对两个方向都断言)。
 */
export const CRITERIA = Object.freeze([
  Object.freeze({
    id: "scan-surface-missing",
    title: "扫描面读不到(test/ 或 src/ 子树):门禁什么也没查而输出是 exit 0,判红",
  }),
  Object.freeze({
    id: "scan-surface-collapsed",
    title: "扫描面塌缩(段数掉到下限以下):五族判据在零扫描面下会全绿,判红",
  }),
  Object.freeze({
    id: "test-layer-self-hosted",
    title: "L4 段必须自托管(至少一个引用落在本层主体根内,且不得段 import 段)",
  }),
  Object.freeze({
    id: "test-layer-cross-import",
    title: "L5 跨层 import:未登记判红 / 已登记但 reason 为空或不足 20 字判红(走豁免表)",
  }),
  Object.freeze({
    id: "l5-exemption-table",
    title: "L5 豁免表自身失效(读不到 / 缺 entries 数组 / 表项键名写错):整张表静默失效,判红",
  }),
  Object.freeze({
    id: "l5-exemption-stale",
    title: "L5 豁免表项当前不再命中(stale,ratchet):否则表只增不减、失效项永远占位",
  }),
  Object.freeze({
    id: "behavior-covers-declared",
    title: "L6 covers 声明:behavior 段必须声明且非空,每个元素必须在磁盘上真实存在",
  }),
  Object.freeze({
    id: "test-harness-not-segment",
    title: "L8 自指层(harness)下的段必须声明 covers 且至少一个元素指向本层",
  }),
  Object.freeze({
    id: "test-top-dirs-exact",
    title: "L7 test/ 顶层目录集合必须恰好等于镜像源派生集 ∪ {behavior, harness}:多一个缺一个都判红",
    pending: true,
    pendingReason:
      "L7 已知多 0 / **缺 1**(`test/tools/` 空目录已裁决不建)。缺的那一档不是「还没做」而是"
      + "「期望状态里就没有它」—— 把它做成 report-only 是为了让 L7 不挡住其余各族转判红,"
      + "而不是承认 L7 已成立。转正前必须处置缺的那一档(把它移出派生集,或建出真实内容),"
      + "而不是给判据加豁免。",
  }),
  // ---- ADR-062 的 L11 / L12(S2 新增两族,S3 补第三族并给 L12 转正)----
  Object.freeze({
    // ⚠ **L11 的四档共用这一个 id**(载体缺失 / 豁免表读不到 / 表项键名错 / 表项已失效)。
    // 与 L5 拆成 `l5-exemption-table` + `l5-exemption-stale` 两行的取舍相反,理由:
    // L5 那两行要**不同档** —— stale 表项要判红但它是「表项该删」而非「门禁缺载体」;
    // 而 L11 这四档的**结论与处置完全同一件**(这道门禁没有可被证明的载体,补载体或登记豁免),
    // 拆成多行只会让 `--help` 的计数虚增、并在转正时要同批删多行。
    id: "gate-has-carrier",
    title:
      "L11 门禁必有载体:同名 selftest 载体或引用该门禁的验收段,二者皆无且不在门禁级豁免表 → 判红;"
      + "豁免表读不到 / 缺 entries / 表项键名错 / 表项已不再需要(stale)也归本行判红",
  }),
  Object.freeze({
    // ⚠ **单列一族而不是并进上面的 `gate-has-carrier`**:那一族的四档处置**完全同一件**
    // (「这道门禁没有载体」→ 补载体或登记豁免);本档的处置是另一件 —— **恢复门禁本体,
    // 或把登记项删掉**(两者都不是「补载体」)。并进去的话,读者拿到「缺载体,补一份
    // `.selftest.mjs`」的指引去做的事根本解不开这一档(补多少个载体都没用:树里没有那个模块)。
    //
    // **为什么必须有这一档**(S2 明确留下的缺口):判定面曾收窄到「本求值根里真实存在的门禁」
    // (见下方 checkTestLayout 里那段注释),门禁本体被**删除**时它会静默离开判定面。那天靠
    // 旧注册表 R4(`judgment.module` 指针解析不到)与 check-import-boundary 兜着,
    // **但 R1–R5c 全部随 S4 消失**,届时这道缺口无人守。
    id: "gate-module-present",
    title:
      "L11b 清单在册而树里无:索引登记的门禁其 modulePath 在求值根里不存在 → 判红"
      + "(门禁本体被删/改名会让它静默离开 L11 的判定面,而它的载体、链归属同时无人核对)",
  }),
  Object.freeze({
    // L12 与 L12c **共用这一个 id**:L12c 是 L12 的取值域为两值之后才生效的**附加档**
    // (offchain 可带 pendingChain 声明「本应进链、因 <理由> 未转正」),两者的前置与转正时机
    // 完全相同(都要等 S3 的取值域迁移)。拆两行会让「还剩几族待转正」这个唯一进度读数虚增。
    //
    // ✅ **已转 fail-closed(2026-10-05,S3)**:转正的前置是「一次取值域迁移 + 剩余命中为零」,
    // 两条都兑现了 —— 清单侧 `gate-index.mjs` 已把旧表的 `local` / `workflow` 逐条收成
    // `offchain`,迁移后本族清掉取值域那一档的剩余命中数为零(取数命令见 `main()` 的结论行)。
    // 转正只删 `pending: true` 与 `pendingReason`,判定本体一行未改。
    id: "gate-chain-membership",
    title: "L12 链归属:access 取值域只 chain/offchain,chain 的真在链上、offchain 的不得在链上",
  }),
  // ---- REQ-187 的 C1(TS 段口径)与 C3(L4 第三档),2026-10-05 用户裁决 ----
  Object.freeze({
    // ⚠ 档一与档二**各占一个 id**:处置不同(补源文件 vs 补 import / 改段名)——
    // 与 L11 拆 `gate-has-carrier` / `gate-module-present` 同款取舍(见那两行的注释)。
    // 合并会让「补错了东西」在诊断里看不出是哪一档的处置。
    id: "test-dist-artifact-source-mirror",
    title:
      "C1 档一(产物侧):段的被测 import 落在 dist/** 时,该产物的镜像 src/** 源文件必须真实存在"
      + "(按构建产物路径反推,不看 git 跟踪状态 —— dist/ 是 gitignored 的)",
  }),
  Object.freeze({
    id: "test-segment-mirror-same-name",
    title:
      "C1 档二(段侧):段路径镜像某个真实存在的 src/** 源文件时,它的被测 import 必须落在"
      + "那同一个源文件的同名编译产物上(段名与被测对象不得脱钩)",
  }),
  Object.freeze({
    id: "test-layer-gate-subject",
    title:
      "C3(L4 第三档):段住在非门禁层却 import gates/ 树的模块 ⇒ 判红,除非在门禁主体豁免表"
      + "登记并给出达标理由(与 L5 豁免表**分表**:L5 问「是否只提供数据」,C3 问「层归属对不对」)",
  }),
  ]);

/**
 * 按 id 查**本轮生效的**登记表(不是模块常量 —— 删行覆盖下两者不同)。
 * 查不到即**判红**(fail-closed),并额外追加一条 `criteria-unregistered:<id>`:
 * 不抛异常(会把一族的漏登记变成整场崩溃,盖住其余判红)、不静默归 problems(那样从输出里
 * 看不出它漏了)、也不丢弃(那等于让这一族的命中静默消失)。
 *
 * ⚠ 那条告警的文案**刻意不写成 ` → <id>:` 形状**:它是「漏斗对自己的告警」而不是一族判据。
 * 若写成那个形状,selftest 的 sourceAudit 会把它当成一个待登记的族抽出来,
 * 而登记它又等于让「漏登记」本身变成一件可配置的事 —— 机制给自己开了个后门。
 * @param {string} id 源码发出的机器 id
 * @param {readonly { id: string }[]} criteria 本轮生效的登记表
 * @param {string[]} sink 判红通道
 * @returns {boolean} 该族是否在登记表里
 */
function isRegistered(id, criteria, sink) {
  if (criteria.some((entry) => entry.id === id)) return true;
  sink.push(
    `判据登记表 → 强制等级漏登记:criteria-unregistered:${id}:源码发出了一族未登记在 CRITERIA 里的判据`
    + ` —— 它的强制等级因此无人负责(缺标记本会按 fail-closed 处理,但那不等于「有人决定过」)。`
    + `在 CRITERIA 里补一行(id 与本处逐字相同,缺 pending 即 fail-closed),`
    + `或确认该族已被删除、连它的 report 调用一起去掉`,
  );
  return false;
}

const USAGE = "用法: node gates/repo/check-test-layout.mjs [--write-l5-exemptions] [--help]";

/**
 * @typedef {object} DirEntry 一个目录项(注入面用的最小形状)
 * @property {string} name
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} TestLayoutCtx 注入面(IO 与策略全部经它进来,判定本体自身不碰 fs)
 * @property {string} root 求值根
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {(relative: string) => DirEntry[]} listDir 列仓库相对目录
 * @property {(relative: string) => boolean} fileExists 判仓库相对路径是否存在(L6 核 covers 元素用)
 * @property {number} minScannedFiles 扫描面段数下限(0 = 关闭该判据,合成夹具用)
 */

/**
 * @typedef {object} TestLayoutStats 计数(结论行用)
 * @property {number} files 扫描到的全部文件数
 * @property {number} segments 段文件数(进入 L4 / L5 / L8 的面)
 * @property {number} layerSegments 落在镜像源层目录内的段数(L4 / L5 的作用域)
 * @property {number} l4Violations L4 判红条数(零本层主体 + 段 import 段)
 * @property {number} l4NoOwnSubject 零本层主体的段数
 * @property {number} l4SegmentImports 段 import 段的条数
 * @property {number} l5Hits L5 跨层命中数(进哪个通道由 CRITERIA 决定)
 * @property {number} l7Extra 多出的顶层目录数
 * @property {number} l7Missing 缺失的顶层目录数
 * @property {number} l8Violations L8 判红条数
 * @property {number} l11MissingModule L11b「清单在册而树里无」判红条数
 * @property {number} c1Artifacts C1 判据对象(落在 dist/** 的值引用)总数 —— 分母,读数用
 * @property {number} c1MirrorMissing C1 档一判红条数(产物无镜像源)
 * @property {number} c1MirroredSegments C1 档二的判据对象(段路径镜像了某个 src 源文件的段数)
 * @property {number} c1SameNameMissing C1 档二判红条数(镜像段未落在同名产物上)
 * @property {number} c3Hits C3 命中数(非门禁层的段 import 了 gates/ 树的模块)
 * @property {number} c3Unregistered C3 未登记判红条数
 * @property {number} c3ShortReason C3 已登记但 reason 不达标判红条数
 * @property {number} c3Exemptions 门禁主体豁免表项数
 * @property {number} c3Stale 门禁主体豁免表 stale 判红条数
 */

/**
 * `import/export … from 'spec'`(含 `import type` 与行内 `type` 说明符)。
 * 跨度 `[^'"]*?` 而非无界:有效 ES 模块语法在 `import` 与 `from` 之间不含引号,
 * 该约束不漏任何真实 import、仍支持跨行,同时避免「`import '副作用'` 之后的另一条
 * import 的 from 被接上」与「文档串里的伪 import 被当真实 import」(同
 * check-import-boundary.mjs 的 FROM_RE,理由见那里的注释)。
 */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
/** 副作用导入 `import 'spec'` */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;
/** 动态导入 `import('spec')` —— 运行期形态 */
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<TestLayoutCtx>} [base] 调用方给的注入面
 * @returns {TestLayoutCtx} 完整注入面
 */
export function makeTestLayoutCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    listDir:
      base.listDir
      ?? ((relative) => readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))),
    fileExists: base.fileExists ?? ((relative) => existsSync(path.join(root, ...relative.split("/")))),
    minScannedFiles: base.minScannedFiles ?? MIN_SCANNED_FILES,
  };
}

/**
 * 列出 `test/` 下的全部文件(仓库相对 POSIX 路径,已排序)。
 *
 * ctx.listDir 抛错**不在此吞掉**:调用方要把「test/ 读不到」判红(路径写错时静默按空集
 * 通过,门禁从那一刻起什么也没查,而输出是 exit 0 —— 这是最坏的失效形态)。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {string[]} 文件相对路径
 */
export function collectTestFiles(ctx) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} relDir 仓库相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    for (const entry of ctx.listDir(relDir)) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) walk(rel);
      else files.push(rel);
    }
  };
  walk(TEST_REL);
  return files.sort();
}

/**
 * 镜像源派生:层集合 + 每层的「主体根」前缀。
 *
 * 一半从磁盘列(`src/` 的直接子目录),一半取仓内已有的顶层树单源
 * (`TREE_DIRS` 去掉 `test` 自身)。**不读 `SEGMENT_DIRS`**(它将在 T2/P2 被删除,
 * 依赖它等于让本门禁活到那时就断)。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }}
 */
export function deriveMirrorLayers(ctx) {
  const srcLayers = ctx.listDir("src")
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();
  const topTrees = Object.values(TREE_DIRS).filter((name) => name !== TEST_REL).sort();
  const layers = [...srcLayers, ...topTrees];
  const srcSet = new Set(srcLayers);
  return {
    srcLayers,
    topTrees,
    layers,
    /** @param {string} layer @returns {string[]} */
    rootsOf: (layer) => {
      // `harness` 是**自指层**(T3 步 6):它的被测主体就是它自己 —— 测「测试框架自身」的段
      // (runner-report / test-common-helpers / dual-pipeline-decision-ledger)主体全在
      // `test/harness/**`。它的主体根因此**不是** `harness/`(仓顶层树,收的是门禁脚本)而是
      // `test/harness/`。走的是与 src 镜像层同形的判定路径:一个层一个主体根前缀。
      //
      // 为什么必须单列而不能靠段自己声明:`harness` 同时出现在 `topTrees` 里(它是
      // TREE_DIRS 的四棵顶层树之一),若沿用 `rootsOf` 的默认分支,主体根会算成 `harness/`,
      // 于是 `covers: ["test/harness/runner.js"]` 落在根外 → L4 恒判红。这正是本分支
      // 存在的理由:层名相同不代表主体根相同,主体根必须指向**被测代码所在处**。
      if (layer === HARNESS_DIR) return [HARNESS_ROOT];
      return srcSet.has(layer) ? [`src/${layer}/`, `dist/${layer}/`] : [`${layer}/`];
    },
  };
}

/**
 * 抽一个文件里的全部 import 事实(相对说明符解析到仓库相对 POSIX 路径)。
 *
 * type-only 判定复用 `isTypeOnlyClause`,另加 JSDoc 形态:`import("…")` 出现在**注释**
 * 里是类型引用(编译期擦除),出现在**代码**里是运行期动态 import。两者字面同形,
 * 靠 `lexSource` 的抹注释结果区分:代码里那个下标在 `code` 中仍以 `import(` 开头,
 * 注释里那个已被抹成空格。
 *
 * ⚠ 三处 matchAll 都要过 `inString` 过滤(不止注释那一处):`lexSource` 只抹注释、
 * **保留字符串内容**,故文档串里的 `import("…")` 形状在 code 里与真动态 import 同形,
 * 只有 inString 能分(见 extractImports 内的注释)。
 *
 * @param {string} text 文件原文
 * @param {string} file 文件的仓库相对 POSIX 路径(解析相对说明符的基准)
 * @returns {{ spec: string, typeOnly: boolean, resolved: string | null }[]}
 */
/**
 * 抽一个段声明的 `covers`(ADR-062 L6)。
 *
 * 认的是**字面量数组**:只接受 `export const covers = ["…", …]` 与
 * `export const covers = [...]` 里全是字符串字面量的形态。刻意不解析变量引用
 * (`covers = SOME_LIST`):那会让 L6 的第三条(元素必须真实存在)退化成「追一个值再判」,
 * 而追值就得引入求值器 —— 一旦判据自己开始算,「声明与代码不同步」这类漂移就查不出来了。
 * 判据看不懂的写法按「未声明」处理(behavior 段即判红),不按「声明了但内容未知」放过。
 *
 * 走 `lexSource` 抹注释(与 extractImports 同款取舍):说明文字里写
 * `export const covers = [...]` 不构成声明。
 *
 * @param {string} text 段文件文本
 * @returns {string[] | null} 声明的元素;`null` = 未声明
 */
export function extractCovers(text) {
  const lexed = lexSource(text);
  const DECL_RE = /\bexport\s+const\s+covers\s*=\s*\[([\s\S]*?)\]/g;
  /** @type {string[] | null} */
  let found = null;
  for (const m of lexed.code.matchAll(DECL_RE)) {
    const at = m.index ?? 0;
    if (lexed.inString[at] === 1) continue;
    // 括号里的每个元素都必须是字符串字面量;出现任何非字面量内容(标识符 / 数字 / 嵌套调用)
    // 就判定据看不懂该写法 —— 按「未声明」处理,不在这里猜。
    const inner = m[1] ?? "";
    const stripped = inner.replace(/\/\/[^\n]*/g, "").trim();
    if (stripped === "") {
      found = found ?? [];
      continue;
    }
    const elements = [...stripped.matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)];
    const consumed = elements.reduce((sum, el) => sum + el[0].length, 0);
    const punctuation = stripped.replace(/\s+/g, "").replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, "").replace(/,/g, "");
    if (punctuation !== "" || consumed === 0) return null;
    found = elements.map((el) => el[2] ?? "");
  }
  return found;
}

export function extractImports(text, file) {
  const lexed = lexSource(text);
  /** @type {{ spec: string, typeOnly: boolean, resolved: string | null }[]} */
  const out = [];
  const dir = path.posix.dirname(file);
  /**
   * @param {string} spec 说明符
   * @param {boolean} typeOnly
   * @returns {void}
   */
  const add = (spec, typeOnly) => {
    out.push({
      spec,
      typeOnly,
      resolved: spec.startsWith(".") ? path.posix.normalize(path.posix.join(dir, spec)) : null,
    });
  };
  // ⚠ 三处 matchAll 的结果**都要过 inString 过滤**,不只是注释那一处。理由:`lexSource`
  // 只把注释放成空格、**字符串内容原样保留**(那是真 import 的 specifier 本身),所以文档串里
  // 写的 `import("../../dist/core/x.js")` 形状在 `code` 里与真动态 import **完全同形**,
  // 靠 code 区分不出来 —— 只有 inString 能分(串内部的引号是字面量内容,不是词法记号)。
  // 少这一处过滤的后果:段里「示范该怎么 import」的说明串会被当成真实依赖,
  // 既能让 L4 假性通过,也能让 L5 假性命中(同 check-import-boundary 的 insideString 守卫)。
  for (const m of lexed.code.matchAll(FROM_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[4], isTypeOnlyClause(m[2], m[3]));
  }
  for (const m of lexed.code.matchAll(SIDE_EFFECT_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[2], false);
  }
  for (const m of lexed.code.matchAll(DYNAMIC_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], false);
  }
  // JSDoc/注释里的类型引用:在**原文**上匹配,但只收那些在抹注释后消失的下标
  for (const m of text.matchAll(DYNAMIC_RE)) {
    if (lexed.code.startsWith("import(", m.index)) continue;
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], true);
  }
  return out;
}

/**
 * 这个解析后的路径落在**哪一层**(不是本层时)。判据对象是「解析结果的首段目录名」,
 * 与 check-import-boundary 的 `resolveLayer` 同一形状,但这里要认得 `src/<层>/` 与
 * `dist/<层>/` 两种带前缀的形态(本仓的段 import 的是产物)。
 * @param {string} resolved 仓库相对 POSIX 路径
 * @param {{ layers: readonly string[] }} mirror 镜像源派生结果
 * @returns {string | null} 层名;不落在任何层内(如 test/ 内部、node_modules)时 null
 */
export function foreignLayerOf(resolved, mirror) {
  for (const layer of mirror.layers) {
    if (resolved.startsWith(`src/${layer}/`) || resolved.startsWith(`dist/${layer}/`)) return layer;
    if (resolved.startsWith(`${layer}/`)) return layer;
  }
  return null;
}

/**
 * C1 的「被测 import」单一定义(两档共用;五类排除的逐条依据见文件头同名小节)。
 *
 * 收敂成一句:**解析后落在 `dist/**` 的值引用**。裸包名 / `node:` 内建 / 第三方包
 * `resolved === null`;`test/harness/**`(测试框架自身)与其它段(段 import 段已由 L4
 * 判红)不在 `dist/` 下;type-only 引用是编译期擦除的类型标注、不是取得被测对象的手段。
 *
 * ⚠ **这一条不得改成「解析成功即算」**:那会把 289 处 harness 引用与 73 处 `src/**`
 * type-only 引用算进分母,C1 于是退化成「谁引用助手最多 / 类型标注写对没有」的检查。
 * @param {{ resolved: string | null, typeOnly: boolean }} entry `extractImports` 的一条
 * @returns {boolean} 是否是 C1 两档的判据对象
 */
export function isSubjectImport(entry) {
  return entry.resolved !== null && !entry.typeOnly && entry.resolved.startsWith(DIST_TREE);
}

/**
 * 一个 `dist/**` 产物的镜像源文件候选路径(仓相对 POSIX,按声明顺序)。
 *
 * ⚠ 返回的是**一组**候选而不是单个路径:`.js` 产物可能来自 `.ts` / `.tsx` / `.js` 三种源
 * (见 `ARTIFACT_SOURCE_EXTS` 的注释,`src/renderer/lang-bootstrap.js` 是仓内既有的第三种先例)。
 * 调用方逐个问 `fileExists`,**任一命中即算有源** —— 判红只发生在**全都不命中**时。
 * @param {string} artifact 仓相对产物路径(以 `dist/` 开头)
 * @returns {string[]} 镜像源候选路径(产物路径未知后缀时为空数组)
 */
export function mirrorSourceCandidates(artifact) {
  const dot = artifact.lastIndexOf(".");
  if (dot < 0) return [];
  const candidates = ARTIFACT_SOURCE_EXTS[artifact.slice(dot)];
  if (candidates === undefined) return [];
  const stem = artifact.slice(0, dot);
  if (!stem.startsWith(DIST_TREE)) return [];
  return candidates.map((ext) => `${SRC_TREE}${stem.slice(DIST_TREE.length)}${ext}`);
}

/**
 * 一个段的路径镜像了哪个真实存在的 `src/**` 源文件(C1 档二的判据对象)。
 *
 * 形态是 `test/<X>/<rest>.test.js` ⇔ `src/<X>/<rest>.<srcExt>` —— **相对路径逐段对应**,
 * 不是 basename 匹配。后者会把 `test/core/preprocess.test.js` 认成镜像
 * `src/convert/preprocess.ts`(实测仓内确有 `test/convert/preprocess.test.js` 与
 * `src/convert/preprocess.ts`,但它们不在同一层目录下),那是**跨层的巧合同名**。
 *
 * 段深度**不限**:S5-0 的递归化之后段名是完整相对路径(如
 * `gates/supply/supply/gen-sbom.test.js`),逐段对应天然覆盖嵌套形态。
 * @param {string} segment 段路径(仓相对 POSIX,以 `.test.js` 结尾)
 * @param {(relative: string) => boolean} [fileExists] **仓相对**路径的存在性判据
 *   (缺省走真实磁盘 —— 合成根上的自检必须注入 `ctx.fileExists`,见 `makeTestLayoutCtx`)
 * @returns {{ source: string, artifact: string } | null} 镜像到的源文件与它的同名产物;未镜像时 null
 */
export function mirroredSourceOf(segment, fileExists = (relative) => existsSync(path.join(ROOT, ...relative.split("/")))) {
  if (!segment.startsWith(`${TEST_REL}/`) || !segment.endsWith(SEGMENT_EXT)) return null;
  const stem = segment.slice(`${TEST_REL}/`.length, -SEGMENT_EXT.length);
  for (const [sourceExt, artifactExt] of Object.entries(SOURCE_ARTIFACT_EXTS)) {
    const source = `${SRC_TREE}${stem}${sourceExt}`;
    if (!fileExists(source)) continue;
    return { source, artifact: `${DIST_TREE}${stem}${artifactExt}` };
  }
  return null;
}

/**
 * 判定本体(可注入纯函数):五族判据 + 扫描面下界。
 *
 * 全部诊断经唯一出口 `report(id, line)`,进 `problems` 还是 `info` 由 `CRITERIA` 决定
 * (见文件头「强制等级」一节)。判定本体的 IO 注入面**不含**登记表:那是不可注入的模块常量。
 * @param {Partial<TestLayoutCtx> & { criteriaOverride?: readonly { id: string, pending?: boolean }[] }} [base] 注入面(见 makeTestLayoutCtx)
 * @returns {{ problems: string[], info: string[], stats: TestLayoutStats, l5ExemptionCount: number }}
 */
/**
 * 读 L5 豁免表。**只认二元组**,缺字段的表项直接判红而不是被跳过 ——
 * 跳过等于给「写错键名」开了一个静默放行的口。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { segment: string, specifier: string, reason: string }[], problems: string[] }}
 */
export function loadL5Exemptions(root = ROOT) {
  const file = path.join(root, ...L5_EXEMPTIONS_REL.split("/"));
  /** @type {{ segment: string, specifier: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { entries, problems: [`豁免表读不到或不是合法 JSON:${L5_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`] };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`豁免表缺 entries 数组:${L5_EXEMPTIONS_REL}`] };
  }
  // 条目本身**不**在这里校验键名:那件事由判定本体统一做(它同时要管注入面)。
  // 这里只负责把原样条目交出去 —— 判定本体对「非对象项」也判红,不静默跳过。
  entries = list;
  return { entries, problems };
}

/** 豁免表的键(段路径 + 说明符) */
const l5ExemptionKey = (segment, specifier) => `${segment}\u0000${specifier}`;

/**
 * 生成 L5 豁免表基线(ADR-062:92 的做法:「生成 → 逐条人工补 reason → 转判红」的第一步)。
 *
 * ⚠ **刻意不填 reason**:填占位符等于让「忘了写理由」与「写了理由」在门禁上不可区分 ——
 * 而 reason 不合格正是这张表唯一能机械判红的东西之一。生成出来的表必然因 reason 为空而红,
 * 那是**设计**:逼使用者逐条看过再填。空 reason 是「不足门槛」那一档的**特例**(0 < 20),
 * 故本入口的产物天然红 —— 它是生成入口,不是判据,永远 exit 0。
 * @param {{segment: string, specifier: string}[]} hits 当前命中的 (段, 说明符) 对,已去重
 * @returns {string} 可写入数据文件的 JSON 文本
 */
export function renderL5ExemptionsBaseline(hits) {
  const entries = [...hits]
    .sort((a, b) => (a.segment === b.segment ? a.specifier.localeCompare(b.specifier) : a.segment.localeCompare(b.segment)))
    .map((hit) => ({ segment: hit.segment, specifier: hit.specifier, reason: "" }));
  return `${JSON.stringify(
    {
      _comment: "L5 豁免表 —— 由 `node gates/repo/check-test-layout.mjs --write-l5-exemptions` 生成。"
        + `**每条 reason 必须人工补**:空 reason 会判红(这是刻意的,见门禁本体同名函数注释);`
        + `补的内容还须 ≥${REASON_MIN_CHARS} 字(按码点计)。`,
      _schema: {
        key: "entries[].segment + entries[].specifier",
        granularity: "一个表项只覆盖这一条说明符;同段将来新增的跨层 import 仍判红。",
        reason: `必填、且 trim 后 ≥${REASON_MIN_CHARS} **字**(按码点计)。`
          + "写不出合法理由的命中应改 import 或把该段归 test/behavior/,不得进表。",
        ratchet: "表项必须当前仍真的命中,否则判红(stale)。",
      },
      entries,
    },
    null,
    2,
  )}\n`;
}

/* ---------- ADR-062 的 L11 / L12:门禁清单相关的四个面 ---------- */

/**
 * 读 L11 门禁级豁免表。**三档 fail-closed**,与 `loadL5Exemptions` 同形:
 * ① 读不到 / 不是合法 JSON → 判红;② 缺 `entries` 数组 → 判红;③ 表项键名错 → 判红。
 *
 * ⚠ **静默当空表不可接受**:L11 的档 2 是「无载体但在豁免表」,表读不到时全部落档 3 判红 ——
 * 那是「红」的方向,尚属 fail-closed 的正确侧;真正不可接受的是把**非法表**当成空表后
 * 表里那些**合法表项也一起失效**(整张表静默消失,而门禁只是变红,没人知道红的原因是表坏了)。
 * 故这三档各自点明表路径。
 *
 * 条目**不**在这里校验键名(与 L5 同款取舍):校验由判定本体统一做,那样注入面
 * (`base.gateExemptions`)也过同一道校验 —— 否则一条键名写错的注入表项会拿到一个永不命中的键、
 * 被静默跳过。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { gate: string, reason: string }[], problems: string[] }}
 */
export function loadGateExemptions(root = ROOT) {
  const file = path.join(root, ...GATE_EXEMPTIONS_REL.split("/"));
  /** @type {{ gate: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      entries,
      problems: [`门禁级豁免表读不到或不是合法 JSON:${GATE_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`],
    };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`门禁级豁免表缺 entries 数组:${GATE_EXEMPTIONS_REL}`] };
  }
  entries = list;
  return { entries, problems };
}

/**
 * 读 C3 的门禁主体豁免表。**三档 fail-closed**,与 `loadL5Exemptions` /
 * `loadGateExemptions` 同形:① 读不到 / 不是合法 JSON → 判红;② 缺 `entries` 数组 →
 * 判红;③ 表项键名错 → 判红(由判定本体统一做,那样注入面也过同一道校验)。
 *
 * ⚠ **为什么「表读不到」这一档判红而不是当空表**(这是搬成数据文件**新引入**的一档 ——
 * 落在模块常量形态时它根本不存在,因为表与本体同体、读不到就是编译不过):
 *
 *   - **静默当空表 = fail-open。** 空表会让每一条门禁边落进「未登记」,于是**症状看起来
 *     仍然正确**(判红),但**归因彻底错位**:输出点名的是某一段的层归属有问题,而真因是
 *     豁免表不见了。那正是本仓反复批过的「诊断指向 A、真因是 B」—— 处置指引会把人
 *     领去搬段,搬完表还是红的,而表仍然没人找。
 *   - **「读不到」与「查过了、全无豁免」在门禁上不可区分**:两者都产出「零条表项」。
 *     区别只存在于**门禁没跑的那一次** —— 而门禁恰恰不能靠「它跑过了」来担保,因为
 *     恒绿与恒红一样都是没人看的结果。
 *   - **判红的那一侧至少可归因**:三条读表诊断各自点明表路径与失败原因,读者立刻知道
 *     该去修表;而当空表放过去,门禁只会说「某段 import 了门禁树」。
 *
 * ⚠ 代价是「表被删 ⇒ 整仓红」—— 但那**就是**正确方向:一条已审过的豁免凭空消失时,
 * 门禁必须让人重新看见它,而不是安静地按「没人豁免过」处理。与另两张表同判准。
 *
 * 条目**不**在这里校验键名(与另两张同款取舍):校验由判定本体统一做,否则一条键名写错的
 * 注入表项会拿到一个永不命中的键、被静默跳过。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { segment: string, specifier: string, reason: string }[], problems: string[] }}
 */
export function loadGateSubjectExemptions(root = ROOT) {
  const file = path.join(root, ...GATE_SUBJECT_EXEMPTIONS_REL.split("/"));
  /** @type {{ segment: string, specifier: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      entries,
      problems: [`门禁主体豁免表读不到或不是合法 JSON:${GATE_SUBJECT_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`
        + " —— 表读不到时若按空表处理,每一条门禁边都会落进「未登记」而症状看起来仍然正确,"
        + "但归因指向的是段的层归属而不是表不见了(处置会把人领去搬段,搬完表还是红的)。故判红"],
    };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`门禁主体豁免表缺 entries 数组:${GATE_SUBJECT_EXEMPTIONS_REL}`] };
  }
  entries = list;
  return { entries, problems };
}

/**
 * 门禁索引的注入面归一(真实索引 → 判定本体要的最小形状)。
 *
 * **为什么注入的是「表的内容」而不是「模块路径」**:模块路径是本文件的静态 import(见文件头),
 * 注入路径就得动态 import,而判定本体是**同步**纯函数 —— 动态 import 会把它变成 async,
 * 那会让 CLI 的 `main()` 与链上每个调用点的形态都变。可注入的是**表的内容**,
 * 与 `l5Exemptions` 同一形态:自检在合成根上求值同一批判据,不 spawn、不碰真实工作树。
 *
 * 只取四项(`id` / `access` / `npmScripts` / `modulePath`)的理由见文件头 import 处那段注释
 * —— `judgment` / `enforcement` / `probes[]` 一个都不读。
 *
 * 缺字段**判红而不是跳过**:跳过等于让那道门禁从 L11/L12 两族里凭空消失,而消失形态是
 * 「门禁变绿」而不是「变红」——纯文本门禁最坏的失效形态。
 * @param {readonly Record<string, {id?: string, access?: string, npmScripts?: readonly string[], modulePath?: string}>} | undefined} [source] 注入的索引(缺省即真实 `gate-index.mjs`)
 * @returns {{ gates: readonly { id: string, access: string, npmScripts: readonly string[], modulePath: string, pendingChain?: unknown }[], problems: string[] }}
 */
export function makeGateRegistryCtx(source = undefined) {
  /** @type {{ id: string, access: string, npmScripts: readonly string[], modulePath: string, pendingChain?: unknown }[]} */
  const gates = [];
  /** @type {string[]} */
  const problems = [];
  const table = source ?? GATE_INDEX;
  for (const [key, entry] of Object.entries(table)) {
    if (typeof entry?.id !== "string" || entry.id === "") {
      problems.push(`门禁索引第 ${key} 项缺 id —— 键名写错会让这道门禁在 L11/L12 两族里凭空消失`);
      continue;
    }
    if (typeof entry.access !== "string" || entry.access === "") {
      problems.push(`门禁索引 ${entry.id} 缺 access —— 取值域判据无从核对`);
      continue;
    }
    if (!Array.isArray(entry.npmScripts)) {
      problems.push(`门禁索引 ${entry.id} 缺 npmScripts 数组 —— 链归属判据要拿它与链展开对账`);
      continue;
    }
    if (typeof entry.modulePath !== "string" || entry.modulePath === "") {
      problems.push(`门禁索引 ${entry.id} 缺 modulePath —— 载体判据要拿它推导候选载体路径`);
      continue;
    }
    gates.push({
      id: entry.id,
      access: entry.access,
      npmScripts: entry.npmScripts.filter((name) => typeof name === "string"),
      modulePath: entry.modulePath,
      pendingChain: entry.pendingChain,
    });
  }
  return { gates, problems };
}

/**
 * L11 判定本体(纯函数):三档缺一即红。
 *
 * **两个候选载体,按「存在 / 引用」两形态派生**(不是 ADR-062 原写的「两路径存在性」——
 * 那是 2026-10-04 实测订正掉的形态,理由见该 ADR 的 L11 行):
 *   - 档 1a **同名 selftest 载体**:`<modulePath 同目录>/<stem>.selftest.mjs`,另接受去掉
 *     `check-` 前缀的变体(实测 `check-release-notes.mjs` 的载体叫 `release-notes.selftest.mjs`)。
 *   - 档 1b **引用该门禁的验收段**:`test/**` 下任一段的正文出现该门禁 `modulePath` 的
 *     **无扩展名仓库相对路径**字面子串。
 *   - 档 2 **门禁级豁免表**:`${GATE_EXEMPTIONS_REL}` 里登记了该 `id`。
 *   - 档 3 前两者皆无 → 判红。
 *
 * ⚠ **为什么档 1b 必须是「引用」而不是「路径同形」**:实测纯路径派生只覆盖 16/39,剩 23 项
 * 判红 —— 因为**多道门禁共用一个验收段**是本仓既有事实(`test/gates/supply-chain.test.js`
 * 同时是 `sbom`/`sca`/`licenses`/`fulltext` 四项的载体,`test/gates/observability.test.js`
 * 同时是 `pack-size`/`smoke-report` 两项的载体)。路径派生对「共用段」这一形态**结构性地无解**
 * ⇒ 那正是 ADR-062 原判据会「当场判红 29 项」的机制。引用派生把那 23 项接住,实测零判红。
 *
 * ⚠ **档 1b 的子串口径刻意收窄到「无扩展名的完整仓库相对路径」**(不是 basename、也不是
 * npm script 名):实测三种口径接住的是**同样那 23 项**,但 basename 口径会把 `smoke` 匹配到
 * 14 个段、`gate-probes` 匹配到 9 个(靠的是正文里偶然出现的词)—— 那是**假绿**:
 * 「门禁有载体」与「某段正文里出现过它的名字」不是一回事。收窄后实测段引用命中 30 处
 * (23 项门禁),与注册表 `probes[]` 登记的 segment 类载体对得上。
 *
 * @param {object} input 判定输入
 * @param {{ fileExists: (relative: string) => boolean, segmentBodies?: ReadonlyMap<string, string> }} input.deps 载体存在的两个依据(文件存在性 / 段正文)
 * @param {readonly { id: string, modulePath: string }[]} input.gates 门禁清单(只需 id 与 modulePath)
 * @param {readonly { gate: string, reason: string }[]} [input.exemptions] 门禁级豁免表(注入面)
 * @returns {{ problems: string[], stats: { withCarrier: number, exempted: number, missing: number, stale: number, shortReason: number } }}
 */
export function judgeL11Carrier({ deps, gates, exemptions = [] }) {
  /** @type {string[]} */
  const problems = [];
  const stats = { withCarrier: 0, exempted: 0, missing: 0, stale: 0, shortReason: 0 };
  /** @type {Map<string, { gate: string, reason: string }>} */
  const byGate = new Map();
  for (const [index, entry] of exemptions.entries()) {
    if (typeof entry?.gate !== "string" || entry.gate === "") {
      problems.push(
        `${GATE_EXEMPTIONS_REL} → gate-has-carrier:第 ${index + 1} 项缺 gate`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上,而门禁因此一直落档 3)",
      );
      continue;
    }
    byGate.set(entry.gate, {
      gate: entry.gate,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /**
   * @param {string} modulePath
   * @returns {{ noExt: string, carriers: string[] }}
   */
  const derive = (modulePath) => {
    const noExt = modulePath.replace(/\.(mjs|js|ts)$/, "");
    const stem = noExt.split("/").pop() ?? "";
    const dir = noExt.split("/").slice(0, -1).join("/");
    return {
      noExt,
      carriers: [`${dir}/${stem}.selftest.mjs`, `${dir}/${stem.replace(/^check-/, "")}.selftest.mjs`],
    };
  };
  /**
   * @param {string} modulePath
   * @returns {{ selftest: string | null, segments: string[] }}
   */
  const carriersOf = (modulePath) => {
    const { noExt, carriers } = derive(modulePath);
    const bodies = deps.segmentBodies;
    return {
      selftest: carriers.find((candidate) => deps.fileExists(candidate)) ?? null,
      segments: bodies === undefined
        ? []
        : [...bodies.entries()].filter(([, body]) => body.includes(noExt)).map(([file]) => file),
    };
  };
  for (const gate of gates) {
    const { selftest, segments } = carriersOf(gate.modulePath);
    if (selftest !== null || segments.length > 0) {
      stats.withCarrier += 1;
      continue;
    }
    const exemption = byGate.get(gate.id);
    if (exemption !== undefined) {
      stats.exempted += 1;
      const chars = reasonChars(exemption.reason);
      if (chars < REASON_MIN_CHARS) {
        stats.shortReason += 1;
        problems.push(
          `${gate.id} → gate-has-carrier:该门禁无载体、已在门禁级豁免表登记(${GATE_EXEMPTIONS_REL}),`
          + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字`
          + " —— 门禁级豁免与 L5 豁免同判准:写不出「为什么这道门禁可以没有载体」时,"
          + "该做的是补载体(一份 `.selftest.mjs`),而不是把它塞进表里",
        );
      }
      continue;
    }
    stats.missing += 1;
    problems.push(
      `${gate.id} → gate-has-carrier:该门禁(${gate.modulePath})既没有同名 selftest 载体`
      + `(${derive(gate.modulePath).carriers.join(" 或 ")})、也没有任何验收段引用它`
      + " —— 无人能证明它被破坏时会红。两条正当出路:① 补一份负向载体(同目录同名 "
      + "`.selftest.mjs`,逐条注入漂移并断言非零退出);② 确有正当理由(该门禁的判定面"
      + `由别的机制覆盖且已审过)则按门禁 id 登记进 ${GATE_EXEMPTIONS_REL} 并写明理由`,
    );
  }
  // ---- stale(ratchet):表项当前不再需要 ----
  // 「不再需要」= 该门禁现在**已经有**载体。留着它,表只会单调增长、失效项永远占位。
  for (const entry of byGate.values()) {
    const gate = gates.find((candidate) => candidate.id === entry.gate);
    if (gate === undefined) {
      stats.stale += 1;
      problems.push(
        `${entry.gate} → gate-has-carrier:门禁级豁免表登记了 ${entry.gate},但门禁清单里没有这一项`
        + " —— 门禁已删,豁免必须同批删掉",
      );
      continue;
    }
    const { selftest, segments } = carriersOf(gate.modulePath);
    if (selftest !== null || segments.length > 0) {
      stats.stale += 1;
      problems.push(
        `${entry.gate} → gate-has-carrier:门禁级豁免表登记了 ${entry.gate},但它现在已有载体`
        + `(${selftest ?? segments.join("、")})—— 表项必须同批删掉`
        + "(载体已补齐,豁免不再是它唯一的依据)",
      );
    }
  }
  return { problems, stats };
}

/**
 * L12 / L12c 判定本体(纯函数):两值取值域 + 链归属两向 + `pendingChain` 显式登记。
 *
 * **链展开复用 `chain-expand.mjs` 的全仓单源**(`expandChainScriptNames`),不重写一份:
 * 扁平 `split('&&')` 只认单层,一旦有人把链上某几步包进子脚本,「门禁在链上」会被静默降级成
 * 「不在链上」而没有任何东西判红(那份重复实现的失效机制,见 chain-expand.mjs 文件头)。
 *
 * 三档:
 *   ① **取值域**:`access` 必须是 `chain` / `offchain`;`local` / `workflow` 是 **S3 的旧取值**
 *      (判红并点名)。⚠ `gate-index.mjs` 已迁移完毕,本档在真实仓库上**恒为零命中** ——
 *      它留着的理由是「旧 `registry.mjs` 的三值若被谁原样搬进新表,判据要指名道姓地说出来」。
 *   ② **链归属两向**:`chain` 的每个 `npmScripts` 都真在 `CHAIN_ROOTS` 的某条链上;
 *      `offchain` 的**一个都不在**。
 *   ③ **L12c**:`offchain` 可带 `pendingChain` 显式登记「本应进链、因 <理由> 未转正」;
 *      带了就要求理由非空且达标(≥`REASON_MIN_CHARS` 字)。
 *
 * ⚠ **`pendingChain` 是 S2 新造的字段**(`gate-index.mjs` 里当前零先例,命名与语义由本判据定义,
 * 不是照抄)。造它的理由:像 `check:src-layout`(判红 + 刻意链外 + 零机器看守)那种状态,
 * 目前只写在注释里,与「有人忘了挂上链」在门禁上不可区分。`pendingChain` 让前者可登记。
 *
 * ⚠ **只核 `npmScripts[0]`(接入点代表脚本),不是全部 script** —— 这是**沿用注册表 R5a 的既有
 * 口径**,不是本判据自选的:`registry.mjs:1235-1237` 已写明「generate/check 成对时 `gen:*` 一侧
 * 与开发侧的 `start` 都不在链上,它们是这道门禁的**另一条入口**,不是接入点的定义;拿全部 script
 * 去核会把『同门禁的多入口』误判成『声明与实际不符』」。实测照「全部 script」核对会多报 3 项
 * (`gen:archive-index` / `gen:gate-ids-table` / `start`),而那三项按仓库既有裁决**本就不该在链上**
 * —— 判据若与注册表 R5a 分歧,两边会给出互相矛盾的结论,而没有一处会告诉你该信谁。
 * (R5b 那个方向看起来是逐 script 的,但它遍历的是**实际被发现的调用点**,`gen:*` 根本不在其中。)
 *
 * @param {object} input 判定输入
 * @param {readonly { id: string, access: string, npmScripts: readonly string[], pendingChain?: unknown }[]} input.gates 门禁清单
 * @param {Record<string, string>} input.scripts package.json 的 scripts 表
 * @returns {{ problems: string[], stats: { onChain: number, offChain: number, legacy: number, badDomain: number, chainNotOnChain: number, offChainOnChain: number, declaredPending: number, shortPendingReason: number } }}
 */
export function judgeL12ChainMembership({ gates, scripts }) {
  /** @type {string[]} */
  const problems = [];
  const stats = {
    onChain: 0,
    offChain: 0,
    legacy: 0,
    badDomain: 0,
    chainNotOnChain: 0,
    offChainOnChain: 0,
    declaredPending: 0,
    shortPendingReason: 0,
  };
  // 链展开:每条链根递归展开一次,取并集。这里问的是「在不在链上」,故重复项去重。
  /** @type {Set<string>} */
  const onChainScripts = new Set(CHAIN_ROOTS);
  for (const root of CHAIN_ROOTS) {
    for (const name of expandChainScriptNames(scripts, root)) onChainScripts.add(name);
  }
  for (const gate of gates) {
    if (gate.access !== ACCESS_CHAIN && gate.access !== ACCESS_OFFCHAIN) {
      stats.badDomain += 1;
      const legacy = LEGACY_ACCESS_VALUES.includes(gate.access);
      if (legacy) stats.legacy += 1;
      problems.push(
        `${gate.id} → gate-chain-membership:access 取值「${gate.access}」不在取值域内`
        + `(只允许 ${ACCESS_CHAIN} / ${ACCESS_OFFCHAIN})`
        + `${legacy ? ` —— 它是 ADR-062 S3 的旧取值(gate-index.mjs 已把它收成 ${ACCESS_OFFCHAIN})` : ""}`
        + "。两值化的理由:三值里 `workflow` 那档(在 CI 上但不在 verify:ci 链上)与二分不对齐,"
        + `使「门禁在不在链上」这个问题没有唯一答案。改法:改 ${GATE_INDEX_MODULE_REL} 里那一项的 access`
        + "(旧 `registry.mjs` 的三值是 S4 前的并存态,它随 S4 整体删除,**不要**改那里)",
      );
      continue;
    }
    if (gate.pendingChain !== undefined) {
      // ⚠ `pendingChain` 只对 `offchain` 有意义:`chain` 意味着它**已经在链上**,
      // 而该字段登记的是「本应进链、因 <理由> 未转正」—— 已进链的门禁再声明「本应进链」
      // 是自相矛盾的声明,判红而不是放过(放过的话,字段就成了任何门禁都能挂的装饰)。
      if (gate.access === ACCESS_CHAIN) {
        problems.push(
          `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_CHAIN} 却带 pendingChain`
          + " —— 该字段登记的是「本应进链、因 <理由> 未转正」,而声明为 chain 意味着它已经在链上。"
          + "删掉 pendingChain,或把 access 改回 offchain",
        );
        continue;
      }
      stats.declaredPending += 1;
      const reason = typeof gate.pendingChain === "string" ? gate.pendingChain : "";
      const chars = reasonChars(reason);
      if (chars < REASON_MIN_CHARS) {
        stats.shortPendingReason += 1;
        problems.push(
          `${gate.id} → gate-chain-membership:声明了 pendingChain,但理由只有 ${chars} 字,`
          + `不足门槛 ${REASON_MIN_CHARS} 字 —— pendingChain 是「本应进链、因 <理由> 未转正」的`
          + "显式登记位;写不出理由时它与「没写」在门禁上不可区分,而那正是它要消灭的失效形态",
        );
      }
    }
    // 接入点 = `npmScripts[0]`(沿用注册表 R5a 的口径,理由见函数头注)
    const accessScript = gate.npmScripts[0];
    if (gate.access === ACCESS_CHAIN) {
      stats.onChain += 1;
      const missing = accessScript === undefined || !onChainScripts.has(accessScript);
      if (missing) {
        stats.chainNotOnChain += 1;
        problems.push(
          `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_CHAIN},但 `
          + `${accessScript === undefined ? "它一个 npm script 都没登记" : `\`${accessScript}\``} `
          + `不在 ${CHAIN_ROOTS.join(" / ")} 任一条链上`
          + " —— 声明在链上而实际不在,是「没人跑它」的最短路径。挂上链,或改声明",
        );
      }
      continue;
    }
    stats.offChain += 1;
    if (accessScript !== undefined && onChainScripts.has(accessScript)) {
      stats.offChainOnChain += 1;
      problems.push(
        `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_OFFCHAIN},但 \`${accessScript}\` `
        + `真在 ${CHAIN_ROOTS.join(" / ")} 上`
        + " —— 声明与事实相反。要么改声明为 chain,要么把它从链上摘下来",
      );
    }
  }
  return { problems, stats };
}

/**
 * 取本轮生效的判据登记表。
 *
 * **默认是模块常量 `CRITERIA`,刻意不可注入**(能传参就能把自己摘出去,那本身是 fail-open)。
 * 唯一例外是自检用的 `criteriaOverride`,且它**只允许删行**:
 * 新增一行或加 `pending: true` 一律抛错 ——
 * 注入口一旦能「加待办标记」,就成了「可配置即假话」的后门,自检夹具就会退化成
 * 「让门禁按我想要的方式过」。这里的判据形状是**子集**而不是任意表。
 *
 * @param {{ criteriaOverride?: readonly { id: string, title?: string, pending?: boolean, pendingReason?: string }[] }} [base]
 * @returns {readonly { id: string, title?: string, pending?: boolean, pendingReason?: string }[]}
 */
function resolveCriteria(base) {
  const override = base.criteriaOverride;
  if (override === undefined) return CRITERIA;
  if (!Array.isArray(override)) throw new Error("criteriaOverride 必须是数组");
  const known = new Map(CRITERIA.map((entry) => [entry.id, entry]));
  const allow = new Set();
  for (const row of override) {
    const original = known.get(row?.id);
    if (original === undefined) {
      throw new Error(`criteriaOverride 只允许删行,不得新增:${String(row?.id)}`);
    }
    // 逐字段对读:允许的是「同一行的一个子集」,不是「重新描述这一行」。
    if ((row.pending ?? false) !== (original.pending ?? false)) {
      throw new Error(`criteriaOverride 只允许删行,不得改 pending:${row.id}`);
    }
    allow.add(row.id);
  }
  return CRITERIA.filter((entry) => allow.has(entry.id));
}

export function checkTestLayout(base = {}) {
  const ctx = makeTestLayoutCtx(base);
  const criteria = resolveCriteria(base);
  /** 机器 id → 该族的强制等级 */
  const channelOf = new Map(criteria.map((entry) => [entry.id, entry.pending === true ? "info" : "problems"]));
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const info = [];
  /**
   * **唯一分流出口**:每条诊断都必须经它进 `problems` 或 `info`,进哪一档由 `CRITERIA` 决定。
   *
   * 查不到该 id ⇒ 按 fail-closed 进 problems **并**额外记一条 `criteria-unregistered:<id>`:
   * 三种「看似合理」的处理都不行 —— 抛异常会把一族的漏登记变成整场崩溃、盖住其余判红;
   * 静默归 problems 则从输出里看不出它漏了;丢弃则那一族的命中静默消失。
   * @param {string} id 源码发出的机器 id
   * @param {string} line 完整诊断行
   * @returns {void}
   */
  const report = (id, line) => {
    const channel = channelOf.get(id);
    if (channel === undefined) {
      // 未登记 ⇒ 诊断本身按 fail-closed 进 problems,并**额外**追一条 criteria-unregistered。
      problems.push(line);
      isRegistered(id, criteria, problems);
      return;
    }
    (channel === "info" ? info : problems).push(line);
  };
  /** @type {TestLayoutStats} */
  const stats = {
    files: 0,
    segments: 0,
    layerSegments: 0,
    l4Violations: 0,
    l4NoOwnSubject: 0,
    l4SegmentImports: 0,
    l5Hits: 0,
    l7Extra: 0,
    l7Missing: 0,
    l8Violations: 0,
    l6Violations: 0,
    l5Unregistered: 0,
    l5ExemptionsEmptyReason: 0,
    l5ExemptionsShortReason: 0,
    l5StaleExemptions: 0,
    l11WithCarrier: 0,
    l11Exempted: 0,
    l11Missing: 0,
    l11MissingModule: 0,
    l11Stale: 0,
    l11ShortReason: 0,
    l11TableProblems: 0,
    l11BadEntries: 0,
    l12OnChain: 0,
    l12OffChain: 0,
    l12BadDomain: 0,
    l12ChainNotOnChain: 0,
    l12OffChainOnChain: 0,
    l12DeclaredPending: 0,
    l12ShortPendingReason: 0,
    c1Artifacts: 0,
    c1MirrorMissing: 0,
    c1MirroredSegments: 0,
    c1SameNameMissing: 0,
    c3Hits: 0,
    c3Unregistered: 0,
    c3ShortReason: 0,
    c3Exemptions: 0,
    c3Stale: 0,
  };

  /** @type {string[]} */
  let files;
  try {
    files = collectTestFiles(ctx);
  } catch (error) {
    report(
      "scan-surface-missing",
      `${TEST_REL}/ → scan-surface-missing:读不到 ${TEST_REL}/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 扫描面为空是最坏的失效形态`
      + "(门禁从这一刻起什么也没查而输出是 exit 0),故判红",
    );
    return { problems, info, stats };
  }
  stats.files = files.length;

  /** @type {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }} */
  let mirror;
  try {
    mirror = deriveMirrorLayers(ctx);
  } catch (error) {
    report(
      "scan-surface-missing",
      `src/ → scan-surface-missing:读不到 src/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 镜像源集合派生的输入缺失时,`
      + "L7 只能按空集比对并把全部顶层目录判成「多一个」(恒红且无信息量),故判红",
    );
    return { problems, info, stats };
  }

  const segments = files.filter((file) => file.endsWith(SEGMENT_EXT));
  stats.segments = segments.length;

  // ---- 判据一 L4 + 判据二 L5:逐段判定(两族共用一次读取) ----
  // L4/L5 的作用域层集合 = 镜像源派生集 ∪ {harness}(T3 步 6 的自指层)。
  //
  // ⚠ `harness` **刻意不进 `mirror.layers`**:那个数组的成员要参与 L7 的顶层目录集合
  // 等式(派生集 ∪ NON_MIRROR_TOP_DIRS),把 harness 塞进去会让它同时出现在等式两侧 ——
  // 集合相等判据虽然会去重、结果不变,但 `topTrees` 会多出一项,L7 诊断文案的
  // 「顶层树」清单随之失真(它列的是仓根四棵树,不是 test/ 下的段目录)。
  // 故只在**这里**(L4/L5 的作用域)补一项,派生集本身不动。
  const layerSet = new Set([...mirror.layers, HARNESS_DIR]);
  // L5 豁免表:先读表,再逐条判。表本身的读错/键名错先判红(它们会让整张表静默失效)。
  const { entries: l5Exemptions, problems: l5ExemptionProblems } = base.l5Exemptions
    ? { entries: base.l5Exemptions, problems: [] }
    : loadL5Exemptions(ctx.root);
  for (const problem of l5ExemptionProblems) {
    report("l5-exemption-table", `${L5_EXEMPTIONS_REL} → l5-exemption-table:${problem}`);
  }
  /** 豁免表键 → 表项 */
  const l5ByKey = new Map();
  // 键名校验放在**这里**而不是 loadL5Exemptions 里:注入面(ctx.l5Exemptions)也必须过同一道
  // 校验 —— 否则一条键名写错的注入表项会得到一个永不命中的键、被静默跳过。
  for (const [index, entry] of l5Exemptions.entries()) {
    if (typeof entry?.segment !== "string" || typeof entry?.specifier !== "string") {
      report(
        "l5-exemption-table",
        `${L5_EXEMPTIONS_REL} → l5-exemption-table:第 ${index + 1} 项缺 segment 或 specifier`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上)",
      );
      continue;
    }
    l5ByKey.set(l5ExemptionKey(entry.segment, entry.specifier), {
      segment: entry.segment,
      specifier: entry.specifier,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /** 本轮真的命中过的豁免表键(用于 stale 检测) */
  const l5HitKeys = new Set();
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    // 非镜像层目录下的段(behavior / harness / 当前的 common、fixtures)**不参与 L4/L5**:
    // behavior 段的定义就是横跨多层(对它判「不得跨层」是判据反了),harness 不是被测层;
    // 而 common / fixtures 这类非镜像目录由 L7 点名(「多一个顶层目录」),不必再叠一条
    // 无信息量的 L4 判红。
    if (!layerSet.has(layer)) continue;
    stats.layerSegments += 1;
    const own = mirror.rootsOf(layer);
    const source = ctx.readText(file);
    const imports = extractImports(source, file);
    // L4 的**声明通道**(ADR-062:86):段可以直接 import 本层主体,也可以用 covers 声明
    // 自己测的是本层。ADR-062 已否决「改成传递闭包」—— 那会让 `test/core/comments.test.js`
    // 这类段恒绿(它经 harness 助手间接到达 core,闭包一算就是 core 主体,而它其实只是
    // 「借」了 core 的模块)。声明通道与闭包的区别在于:闭包是判据替段推断,声明是段自己
    // 写明,且写错会被 L6 的第三条判红(元素必须在磁盘上真实存在)。
    const covers = extractCovers(source);
    const coversOwn = covers !== null && covers.some((element) => own.some((p) => element.startsWith(p)));

    // L4 上界:至少一个解析后落在本层主体根内的引用。
    // type-only 引用**计入**「至少一个」—— 形如 `@typedef {import("../../src/core/i18n.js")…}`
    // 的类型引用是本仓的必需形态(产物不产 .d.ts,见文件头),把它判红等于逼人删掉类型标注。
    const ownHits = imports.filter((entry) => entry.resolved !== null && own.some((p) => entry.resolved.startsWith(p)));
    if (ownHits.length === 0 && !coversOwn) {
      stats.l4NoOwnSubject += 1;
      stats.l4Violations += 1;
      report(
        "test-layer-self-hosted",
        `${file} → test-layer-self-hosted:该段解析后**没有 import 任何 ${layer} 层的主体**`
        + `(本层主体根 ${own.join(" 或 ")})—— 「不许 import 别层」这类上界规则在它身上会全绿,`
        + `而它恰恰是最该被抓的形态。三条正当出路:搬进真正被测的那一层;`
        + `它测的其实是测试框架/门禁自身 → 归 test/behavior/ 并在 covers 里写明被测对象;`
        + `它经 harness 助手/子进程间接到达本层(判据静态看不见)→ 留在原处并 export const covers `
        + `声明它测的是本层(声明里至少一个元素要落在本层主体根 ${own.join(" 或 ")} 下)`,
      );
    }

    // L4 另一格:段 import 段。段是**发现与隔离的单位**(runner 逐段起子进程),
    // 段之间互相 import 让「一段失败」不再是可归因的最小单位,且被 import 的那段会
    // 在自己的进程里再跑一遍(双跑 + 顺序耦合)。
    const segmentImports = imports.filter(
      (entry) => entry.resolved !== null && entry.resolved.startsWith(`${TEST_REL}/`) && entry.resolved.endsWith(SEGMENT_EXT),
    );
    if (segmentImports.length > 0) {
      stats.l4SegmentImports += 1;
      stats.l4Violations += 1;
      report(
        "test-layer-self-hosted",
        `${file} → test-layer-self-hosted:段 import 段(${[...new Set(segmentImports.map((e) => e.resolved))].join(", ")})`
        + " —— 段是发现与隔离的单位,段间 import 让失败不可归因且让被 import 的段双跑。"
        + "共用部分抽进非段助手(当前在 test/harness/(T3 步 1 已迁),harness/)",
      );
    }

    // L5:跨层。type-only 引用**不算**跨层(编译期擦除,与 check-import-boundary 的
    // allowTypeOnly 钩子同款取舍)。
    //
    // 三条 fail-closed(ADR-062 的 L5 豁免表形态,判据与豁免判准的单一来源都在
    // L5_EXEMPTIONS_REL 那份数据文件里):
    //   ① 未登记的跨层 import 判红 —— 默认形态,不因为「它看起来像顺带的」就放过;
    //   ② reason 不合格判红 —— **分两档**:空(没写)与不足 `REASON_MIN_CHARS` 字(写了但太短)。
    //      两档分开报而不合并成一档:病因不同(忘了写 vs 写得不够),而「见谅」式的一句话
    //      与空白在门禁上原本不可区分 —— 合并就等于让「短理由」继续合法;
    //   ③ stale 判红 —— 登记了却当前不再命中(代码删了/改名了),必须从表里删掉。
    //      这一条是 ratchet 的全部意义:没有它,表只会单调增长,失效项永远留着。
    for (const entry of imports) {
      if (entry.resolved === null || entry.typeOnly) continue;
      if (own.some((p) => entry.resolved.startsWith(p))) continue;
      const target = foreignLayerOf(entry.resolved, mirror);
      if (target === null) continue;
      stats.l5Hits += 1;
      const key = l5ExemptionKey(file, entry.resolved);
      const exemption = l5ByKey.get(key);
      if (exemption !== undefined) {
        l5HitKeys.add(key);
        const chars = reasonChars(exemption.reason);
        if (chars === 0) {
          stats.l5ExemptionsEmptyReason += 1;
          report(
            "test-layer-cross-import",
            `${file} → test-layer-cross-import:命中已在豁免表登记(${entry.resolved}),但 reason 是空的`
            + ` —— 豁免表的存在意义就是「这一次跨层为什么合法」,空理由让表退化成「见谅」。`
            + `补上理由,或把它从表里删掉(那说明它不该被豁免)`,
          );
        } else if (chars < REASON_MIN_CHARS) {
          stats.l5ExemptionsShortReason += 1;
          report(
            "test-layer-cross-import",
            `${file} → test-layer-cross-import:命中已在豁免表登记(${entry.resolved}),`
            + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字`
            + ` —— 与「空」分开判:这一档是**写了但没写够**。不到门槛的理由挡不住下一次「先豁免、`
            + `回头再补」,表就退化成一句「见谅」。补到说得出「为什么这次跨层合法」的长度,`
            + `或把它从表里删掉(那说明它不该被豁免)`,
          );
        }
        continue;
      }
      stats.l5Unregistered += 1;
      report(
        "test-layer-cross-import",
        `${file} → test-layer-cross-import:${layer} 层的段 import 了 ${target} 层的主体 `
        + `(${entry.resolved})—— 三条正当出路:① 它只是夹具输入/常量/规格/格式化函数(换个值段仍成立)`
        + ` → 按 (段, 说明符) 登记进 ${L5_EXEMPTIONS_REL} 并写明理由;`
        + `② 本段真的执行别层实现并对它的行为下断言 → 那是被测对象的一部分,`
        + `把该段搬进 test/behavior/ 并在段内写 covers(声明它横跨哪几层);`
        + `③ 主体判错了层 → 搬进真正被测的那一层`,
      );
    }
  }

  // ---- L5 豁免表的 stale 检测(ratchet)----
  // 在段循环**之外**:它要问的是「表里有没有当前不再命中的项」,与哪一段无关。
  for (const [key, entry] of l5ByKey) {
    if (l5HitKeys.has(key)) continue;
    stats.l5StaleExemptions += 1;
    report(
      "l5-exemption-stale",
      `${entry.segment} → l5-exemption-stale:豁免表登记了 (${entry.specifier}),但本次扫描没有命中它`
      + " —— 代码删了或改名了,豁免必须同批删掉。留着它,表只会单调增长、"
      + "失效项永远占着位子(这正是 ratchet 要防的)",
    );
  }

  // ---- C3 的门禁主体豁免表:读表 + 键名校验(stale 检测在段循环之外)----
  //
  // ⚠ **表本体是数据文件**(与判定本体分离,理由见 GATE_SUBJECT_EXEMPTIONS_REL 的注释);
  // 注入面 `base.gateSubjectExemptions` 让自检在合成根上求值同一批判据 ——
  // 与 `l5Exemptions` / `gateExemptions` 两处注入面同款,且**刻意保留**:注入面是判据
  // 在合成根上求值的唯一途径(自检不能 spawn、也不该读真实工作树)。
  const { entries: c3Entries, problems: c3ExemptionProblems } = base.gateSubjectExemptions
    ? { entries: base.gateSubjectExemptions, problems: [] }
    : loadGateSubjectExemptions(ctx.root);
  for (const problem of c3ExemptionProblems) {
    report("test-layer-gate-subject", `${GATE_SUBJECT_EXEMPTIONS_REL} → test-layer-gate-subject:${problem}`);
  }
  stats.c3Exemptions = c3Entries.length;
  /** @type {Map<string, { segment: string, specifier: string, reason: string }>} */
  const c3ByKey = new Map();
  for (const [index, entry] of c3Entries.entries()) {
    if (typeof entry?.segment !== "string" || typeof entry?.specifier !== "string") {
      report(
        "test-layer-gate-subject",
        `门禁主体豁免表 → test-layer-gate-subject:第 ${index + 1} 项缺 segment 或 specifier`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上)",
      );
      continue;
    }
    c3ByKey.set(l5ExemptionKey(entry.segment, entry.specifier), {
      segment: entry.segment,
      specifier: entry.specifier,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /** 本轮真的命中过的门禁主体豁免表键(用于 stale 检测) */
  const c3HitKeys = new Set();

  // ⚠ **「本求值根是不是索引描述的那棵树」这条边界**在此**求值一次**、下面 L11/L12 整段复用
  // 同一个值(那边不再重算 —— 两处各算一次的话,将来有人给其中一处加上/去掉别的条件,
  // 就会出现「L11 认为在这棵树上、C3 认为不在」而没有任何东西报红)。
  //
  // ⚠ **C3 的判定与 stale 都受这条边界约束**,理由与 L11 那条**同款、只是换了对象**:
  // 这张表描述的是**真实仓库**,而 `ctx.fileExists` 以**求值根**为准。在一棵只造 `test/`
  // 布局的合成树上,表里那条表项必然 stale(那段不在这儿),于是**每一条合成夹具**都会
  // 多出一条与它无关的 stale 红 —— 症状离根因隔着一整族判据。「它现在 stale」在合成根上
  // **不是事实,是范畴错误**(那棵树根本不是这张表描述的那棵仓)。
  const indexInRoot = ctx.fileExists(GATE_INDEX_MODULE_REL);

  // ---- REQ-187 C1:TS 段口径两档(被测 import 的定义见文件头同名小节)----
  //
  // ⚠ **这一段与上面的 L4/L5 逐段循环刻意分开**,而不是塞进那个循环里:
  // C1 的判据对象是「段 → dist/** 产物」的**边**,L4/L5 的作用域是 `layerSet` 内的段
  // (behavior / harness 不参与)。两者口径不同 —— `test/behavior/**` 段的定义就是横跨多层,
  // 它 import `dist/**` 完全正常,把它算进 C1 的分母会让这一族恒红。
  // 故这里**另起一个只扫 `layerSet` 段的循环**,并复用已读好的段正文?—— 不能复用:
  // 那个循环的 `source` / `imports` 是块内局部变量,而 C1 要在**同一批段**上再走一遍
  // (判据不同 ⇒ 处置不同 ⇒ 两处独立的诊断)。重读一次段正文是刻意的:它让 C1 的每一格
  // 夹具只可能因 C1 判红,不会与 L4/L5 的修复耦合在一起。
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    if (!layerSet.has(layer)) continue;
    const imports = extractImports(ctx.readText(file), file);

    // ---- C1 档一(产物侧):产物背后必须有真源文件 ----
    for (const entry of imports.filter((e) => isSubjectImport(e))) {
      stats.c1Artifacts += 1;
      const candidates = mirrorSourceCandidates(entry.resolved ?? "");
      if (candidates.some((candidate) => ctx.fileExists(candidate))) continue;
      stats.c1MirrorMissing += 1;
      report(
        "test-dist-artifact-source-mirror",
        `${file} → test-dist-artifact-source-mirror:被测 import 落在编译产物 ${entry.resolved},`
        + `但它的镜像源文件全部不存在(${candidates.join(" 或 ")})—— 段的身份是**源文件**、`
        + "编译产物只是取得手段(TS 段的必然形态),产物没有源就是「源已删 / 从未存在 / 路径写错」。"
        + `处置:① 源确实存在但路径不同 → 改 import 到正确的产物路径;`
        + "② 源已删或从未存在 ⇒ 这个段没有可测对象,搬走或随源一起删",
      );
    }

    // ---- C1 档二(段侧):段路径镜像了 src 源文件 ⇒ 被测 import 必须落在同名产物上 ----
    //
    // ⚠ **判据对象是「段路径镜像了某个真实存在的源文件」这件事**,不是「段住在 src 层目录」
    // —— 后者的分母是 103 段而其中 99 段**刻意不按 basename 镜像源**(实测:103 段里只有 4 段
    // 的路径逐段对得上真实源文件)。拿 103 当分母会把 99 段判红,而那 99 段判红的处置
    // 是「改段名」—— 那是**改名纪律**,不属于这一族。分母收窄到「真镜像」的那几段,
    // 这一族问的才是它该问的:「你既然自称镜像 X,那你的被测 import 就得是 X 的产物」。
    //
    // ⚠ **写成 `if (...) { … }` 而不是 `if (未镜像) continue`**:档二的「未镜像」必须**只**
    // 跳过档二自己,不能连带跳掉下面的 C3 —— 用 `continue` 时那一格会让 C3 在所有
    // 非镜像段(实测 140 段里有 136 段)上**静默消失**,而症状是「C3 命中 0 处」这种
    // 看不出根因的读数。两族在同一趟循环里就必须各自用块级门。
    const mirrors = mirroredSourceOf(file, ctx.fileExists);
    if (mirrors !== null) {
      stats.c1MirroredSegments += 1;
      if (!imports.some((entry) => entry.resolved === mirrors.artifact && !entry.typeOnly)) {
        stats.c1SameNameMissing += 1;
        report(
          "test-segment-mirror-same-name",
          `${file} → test-segment-mirror-same-name:段路径镜像了真实存在的源文件 ${mirrors.source},`
          + `但它没有任何被测 import 落在同名编译产物 ${mirrors.artifact} 上`
          + " —— 段名与被测对象脱钩(自称在测 X、实际测的是 Y)。处置:① 段确实在测 X ⇒ 补上对该产物的"
          + "import;② 段在测的是别的东西 ⇒ 把段搬到它真正被测的那一层(段名不必镜像)",
        );
      }
    }

    // ---- C3(L4 第三档):非门禁层的段 import 门禁树 ⇒ 判红,除非已登记 ----
    //
    // ⚠ **`test/gates/**` 的段是门禁段本身**,它们 import 门禁树是**定义的**而非可疑的
    // (L11 的档 1b「验收段引用该门禁」正建立在这一点上:`test/gates/*.test.js` import
    // `gates/repo/check-*.mjs` 是门禁的**载体形态**)。故作用域是「`layerSet` 段 **且**
    // 层名 ≠ `gates`」—— 这与 L4/L5 的作用域(`layerSet` 全体)差一档,差在这一档上,
    // 漏掉它会让 C3 在真实仓库上判红 31 项(实测),而那 31 项全是门禁段在测门禁。
    if (layer === GATES_DIR || !indexInRoot) continue;
    //
    // ⚠ **与 L5 那段循环的 `continue` 无关**:L5 对已登记的边 `continue` 掉了,而 C3 要对
    // **同一条边**独立判一次(`test/shared/geometry-gate.test.js → driver.mjs` 正是这种形态:
    // 它在 L5 表里合法存在,而 C3 仍判红)。两族的处置不同,不能共用一次判定。
    for (const entry of imports) {
      if (entry.resolved === null || entry.typeOnly) continue;
      if (!entry.resolved.startsWith(GATES_TREE)) continue;
      stats.c3Hits += 1;
      const exemption = c3ByKey.get(l5ExemptionKey(file, entry.resolved));
      if (exemption !== undefined) {
        c3HitKeys.add(l5ExemptionKey(file, entry.resolved));
        const chars = reasonChars(exemption.reason);
        if (chars < REASON_MIN_CHARS) {
          stats.c3ShortReason += 1;
          report(
            "test-layer-gate-subject",
            `${file} → test-layer-gate-subject:命中已在门禁主体豁免表登记(${entry.resolved}),`
            + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字 —— 与 L5 豁免同判准:`
            + "本表登记的是「这个段的层归属是对的、门禁主体在这里是被测输入」,"
            + "写不出这句话就说明该搬段而不是该登记",
          );
        }
        continue;
      }
      stats.c3Unregistered += 1;
      report(
        "test-layer-gate-subject",
        `${file} → test-layer-gate-subject:${layer} 层的段 import 了门禁树的模块(${entry.resolved})`
        + ` —— 它住在 ${layer}/ 却在测 gates/ 树里的东西,段的位置已经可疑(它到底在测 ${layer} 还是在测门禁?)。`
        + "⚠ **L5 豁免表不能豁免这一族**:L5 问「这次 import 是不是只提供数据」,本族问「段住在这一层对不对」。"
        + `处置:① 段的主体其实在 gates/ ⇒ 搬到 test/gates/ 对应路径;`
        + `② 段的主体确实在 ${layer}/、门禁主体在这里只当被测输入 ⇒ 按 (段, 说明符) 登记进门禁主体豁免表并写明理由`,
      );
    }
  }

  // ---- C3 豁免表的 stale 检测(ratchet):登记了却当前不再命中 ----
  // 与 L5 的 stale 同款:**表项当前仍真的命中才是合法现状**。段被搬走 / import 被删之后,
  // 表项必须同批删掉 —— 否则表只增不减、失效项永远占位,而门禁对它们一声不吭。
  // ⚠ 受 `indexInRoot` 约束(理由见上面 `indexInRoot` 的注释):合成根上「stale」是范畴错误。
  for (const [key, entry] of (indexInRoot ? c3ByKey : [])) {
    if (c3HitKeys.has(key)) continue;
    stats.c3Stale += 1;
    report(
      "test-layer-gate-subject",
      `${entry.segment} → test-layer-gate-subject:门禁主体豁免表登记了 (${entry.specifier}),`
      + "但本次扫描没有命中它 —— 段被搬走或那条 import 删了,豁免必须同批删掉",
    );
  }

  if (stats.segments < ctx.minScannedFiles) {
    report(
      "scan-surface-collapsed",
      `${TEST_REL}/ → scan-surface-collapsed:${TEST_REL}/ 下只扫到 ${stats.segments} 个段文件`
      + `(下限 ${ctx.minScannedFiles})—— walker 可能已失效,而五族判据在零扫描面下会「全绿」`,
    );
  }

  // ---- 判据三 L7:顶层目录集合相等 ----
  // 只数**目录**:`test/acceptance.mjs`(段入口,已登记在注册表 TOOLCHAIN_FILES)不是一层,
  // 计入即恒红 —— 与 check-import-boundary 的 analyzeSrcTopLayers 同一取舍。
  const actualDirs = ctx.listDir(TEST_REL).filter((entry) => entry.isDirectory).map((entry) => entry.name).sort();
  const expectedDirs = [...new Set([...mirror.layers, ...NON_MIRROR_TOP_DIRS])].sort();
  const actualSet = new Set(actualDirs);
  const expectedSet = new Set(expectedDirs);
  for (const name of actualDirs) {
    if (expectedSet.has(name)) continue;
    stats.l7Extra += 1;
    report(
      "test-top-dirs-exact",
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层多出目录「${name}/」`
      + ` —— 顶层目录集合必须恰好等于镜像源派生集(${mirror.srcLayers.join("/")} + 顶层树 `
      + `${mirror.topTrees.join("/")})∪{${NON_MIRROR_TOP_DIRS.join(", ")}}。`
      + "非镜像目录要么迁进对应层,要么内容整体搬进 test/behavior/(跨层)或 test/harness/(测试框架自身)",
    );
  }
  for (const name of expectedDirs) {
    if (actualSet.has(name)) continue;
    stats.l7Missing += 1;
    report(
      "test-top-dirs-exact",
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层缺目录「${name}/」`
      + ` —— 少一个与多一个同样是集合不等的两档:派生集里有的层必须有自己的段目录,`
      + "否则该层的段会散在别处,而「一段对应一层」的不变量无从核对",
    );
  }

  // ---- 判据五 L6:行为段的 covers 声明(ADR-062:76)----
  //
  // **`covers` 元素是什么、为什么是那个形态**(ADR-062 只给了语义,形态由本判据定):
  // 元素是**仓库相对 POSIX 路径**,指向被测模块在磁盘上的真实位置(如
  // `src/core/cancel.ts`、`test/harness/electron-mock.mjs`、`gates/smoke/smoke-proc.mjs`)。
  // 三条理由:
  //   ① **可解析且能真验** —— L6 的第三条(指向不存在的模块即判红)要求判据手里有一个
  //      权威的「这个路径存不存在」口径;仓库相对路径直接对磁盘判,不需要任何猜测。
  //   ② **不引入位置耦合** —— 若用段文件相对的 `../../src/…`,段一换目录声明就得跟着改。
  //      本仓刚在 T3 步 3/4a 搬了 15 个段,那种写法会产生 15 处纯机械的声明漂移,
  //      而 `shared/paths.js` 存在的全部理由就是消灭这一类耦合(见其文件头)。
  //   ③ **不限定在 src/** —— 跨层段的主体未必是 src 模块:`electron-mock-coverage`
  //      守的是 `test/harness/electron-mock.mjs` 的导出集,`packaged-smoke` 还守
  //      `gates/smoke/smoke-proc.mjs`。故只要求「在磁盘上存在」,不加目录前缀限制 ——
  //      加了就得为「主体不是 src」单开例外,而那正是本条要覆盖的一半场景。
  // 判绿条件:behavior 段**必须**声明且非空、每个元素都存在;正常段目录**不强制**声明,
  // 但一旦声明就同样受「非空 + 元素存在」约束(否则声明通道本身就能撒谎)。
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    const isBehavior = layer === BEHAVIOR_DIR;
    const declared = extractCovers(ctx.readText(file));
    if (declared === null) {
      // 只有 behavior 段缺声明才判红:正常段目录的 covers 是**可选的声明通道**
      // (给「零层 import、经 harness/子进程间接到达本层」那批段用的,ADR-062:86),
      // 强制所有段写声明会把「没写」与「写了但撒谎」混成同一档,反而降低判据的分辨率。
      if (!isBehavior) continue;
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:behavior 段未 export const covers`
        + " —— 它的定义就是横跨多层(位置不表达被测层),被测对象只能靠声明自证。"
        + "缺声明时「它到底测什么」无从核对,L6 与 L4 都失去抓手",
      );
      continue;
    }
    if (declared.length === 0) {
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:covers 是空数组`
        + " —— 空声明与缺声明在判据上等效:两者都没说清被测对象,却只有一种能判红",
      );
      continue;
    }
    for (const element of declared) {
      if (ctx.fileExists(element)) continue;
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:covers 元素「${element}」在磁盘上不存在`
        + " —— 元素是仓库相对 POSIX 路径,判据直接对磁盘核对。"
        + "这是本条唯一挡得住「随便写个字符串就过」的判据:声明里混进不存在的路径,"
        + "要么是写错,要么是把还没打算实现的东西算成已覆盖",
      );
    }
  }

  // ---- 判据四 L8:自指层(harness)下的段必须声明 covers 且指向本层 ----
  //
  // ---- 为什么从「一律禁止」窄化成「声明 + 指向本层」(T3 步 6)----
  //
  // 旧形态是「`test/harness/` 下不得出现 `*.test.js`」,理由是「harness 收的是测试框架
  // 自身,而它在 harness/ 下没有任何被测层可归属」。**后半句今天不成立了**:`harness` 已
  // 登记为**自指层**(段目录,主体根 = `test/harness/` 自己),测「测试框架自身」的段
  // (`runner-report` / `test-common-helpers` / `dual-pipeline-decision-ledger`)主体就在
  // 它下面。旧形态与新事实直接冲突:那三个段要么被禁(则测试框架自身无人测,断言集恒真
  // 就没人发现),要么违规(则门禁逼人把它们挪去一个主体并不在那里的目录 —— 回到挂错层)。
  //
  // 窄化后的三条 fail-closed(每条都有 selftest 夹具):
  //   ① **未声明 covers → 判红**:不许「段悄悄住在 harness 里」。声明是 harness 段存在的
  //      前提,不是可选注释 —— 否则「它测的到底是什么」无从核对。
  //   ② **covers 为空 → 判红**:与 L6 对 behavior 段同款(空声明与缺声明等效)。
  //   ③ **covers 没有任何元素指向本层(`test/harness/`)→ 判红**:这是开口子的**牙齿**。
  //      只写「有个声明」就能过关的话,`covers: ["src/core/whatever.ts"]` 会把 harness 段
  //      变成绕过 L4 的后门 —— 那与不窄化没有区别。必须至少一个元素真的落在
  //      `test/harness/**`,即「它确实在测测试框架自身」。
  //
  // ⚠ 判红文案里**不再**有「没有任何被测层可归属」—— 那句话描述的是被本步推翻的旧事实。
  for (const file of segments) {
    if (!file.startsWith(HARNESS_ROOT)) continue;
    const declared = extractCovers(ctx.readText(file));
    if (declared === null) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段未 export const covers`
          + ` —— ${HARNESS_DIR} 是**自指层**:测「测试框架自身」的段主体就在它下面`
          + `(如 \`${HARNESS_ROOT}runner.js\`),位置即被测层。不声明就没有任何东西能核对`
          + "「这一段到底在测什么」—— 旧形态之所以禁掉 harness 下的段,正是因为「测测试框架"
          + "自身的段无处安放」,而那个前提已随自指层的登记失效。补声明,并让至少一个元素落在"
          + ` \`${HARNESS_ROOT}\` 下`,
      );
      continue;
    }
    if (declared.length === 0) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段 covers 是空数组`
          + " —— 空声明与缺声明在判据上等效:两者都没说清被测对象,却只有一种能判红",
      );
      continue;
    }
    if (!declared.some((element) => element.startsWith(HARNESS_ROOT))) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段 covers 没有元素指向本层`
          + `(要求至少一个元素以 \`${HARNESS_ROOT}\` 开头,实际 ${declared.join(", ")})`
          + " —— 自指层的段必须真的在测测试框架自身;声明别处的主体会让本条开口子变成"
          + "绕过 L4 的后门(那与当初一律禁止没有区别)",
      );
    }
  }

  // ---- ADR-062 L11 / L11b / L12:门禁必有载体 + 清单在册而树里无 + 链归属 ----
  //
  // 三族的判定面都在**门禁索引**上,而索引的注入面刻意只取四项字段(理由见文件头)。
  // 段的正文在这里**只读一次**:L11 的档 1b 要拿它判「有无验收段引用该门禁」,而段列表
  // 上面已经算出来了 —— 重读一遍会让同一批文件在一次判定里被读两次(IO 翻倍,且两次读到
  // 的内容理论上可以不同,那种不一致会让「档 1b 是否命中」变得不可复现)。
  const { gates: allGates, problems: gateRegistryProblems } = base.gateRegistry === undefined
    ? makeGateRegistryCtx()
    : makeGateRegistryCtx(base.gateRegistry);
  stats.l11BadEntries += gateRegistryProblems.length;
  for (const problem of gateRegistryProblems) {
    report("gate-has-carrier", `${GATE_INDEX_MODULE_REL} → gate-has-carrier:${problem}`);
  }
  // ---- 判定面收窄到「本求值根里真实存在的门禁」+ 反向一档 L11b ----
  //
  // ⚠ **收窄不是省事的过滤,是一条范畴边界**:门禁索引是模块常量(描述**真实仓库**),而
  // `ctx.fileExists` / `ctx.readText` 都以**求值根**为准。拿真实索引去问一棵合成根
  // (自检在临时目录里造的那棵)会让 L11 把每一项门禁全判成「无载体」—— 那不是真违例,
  // 是**跨树比对**(合成根里本来就没有 `gates/`,它是一棵只造 `test/` 布局的合成树)。
  // 载体与门禁本体必须在**同一棵树**里,「这道门禁坏掉时有人会红吗」这个问题才有意义。
  //
  // ⚠ **但收窄本身会开一个洞:门禁本体被删除时它静默离开判定面。** S2 把这个洞记为
  // 「残余缺口」,理由是「今天有旧注册表 R4 兜着」—— 而 **R1–R5c 全部随 S4 消失**,
  // 届时无人守。故 L11b 补上反向一档:索引在册而树里无 → 判红。
  //
  // ⚠ **L11b 自身也必须收窄,否则它会恒红**:合成根上「索引在册的每一项都不在树里」是
  // **事实**而不是违例(那棵树里根本没有 `gates/`,它不是门禁索引描述的那棵仓)。
  // 分界线取「**索引模块自己在不在本求值根里**」:它在了,才说明这棵树是索引描述的那棵树,
  // 那一档的「缺」才是真缺;它不在,整段(判定面 + L11b + L11 + L12)与本轮无关 ——
  // 这与下面「判定面非空才读豁免表与 package.json」是同一条边界,只是这里要判的是
  // 「树的身份」而不是「门禁的数量」。
  //
  // ⚠ `indexInRoot` **在 C3 那节就已经求值过一次**(见那里同名注释:两处各算一次的话,
  // 将来有人只给其中一处加条件,就会出现「L11 认为在这棵树上、C3 认为不在」而无红)。
  const gates = indexInRoot ? allGates.filter((gate) => ctx.fileExists(gate.modulePath)) : [];
  if (indexInRoot) {
    for (const gate of allGates) {
      if (ctx.fileExists(gate.modulePath)) continue;
      stats.l11MissingModule += 1;
      report(
        "gate-module-present",
        `${GATE_INDEX_MODULE_REL} → gate-module-present:${gate.id} 在索引里在册,但门禁本体 `
        + `${gate.modulePath} 在本求值根里不存在 —— 它已静默离开 L11/L12 的判定面:`
        + "它的载体无人核对、它挂没挂链上也无人核对。两条正当出路:① 把 ${gate.modulePath} 恢复回来"
        + "(改名了就同批把索引里的 modulePath 改成新名字);② 这道门禁确实已删 ⇒ 把这一项从索引里删掉,"
        + "别让索引留着一个指向空处的登记项",
      );
    }
  }

  // L11 的门禁级豁免表:三档 fail-closed(读不到 / 缺 entries / 表项键名错 / stale)。
  //
  // ⚠ **整段(读表 + 判定 + L12)只在判定面非空时跑**,与上面那条范畴边界同源:没有门禁就没有
  // 「这道门禁有没有载体」这件事,于是那张表与 package.json 都与本轮无关 —— 而在合成根上
  // 去读它们会命中「读不到 → 判红」那一档,凭空让每条既有夹具先被 L11 判红。
  if (gates.length > 0) {
    const { entries: gateExemptions, problems: gateExemptionProblems } = base.gateExemptions
      ? { entries: base.gateExemptions, problems: [] }
      : loadGateExemptions(ctx.root);
    for (const problem of gateExemptionProblems) {
      stats.l11TableProblems += 1;
      report("gate-has-carrier", `${GATE_EXEMPTIONS_REL} → gate-has-carrier:${problem}`);
    }
    /** @type {Map<string, string>} 段相对路径 → 段正文 */
    const segmentBodies = new Map(segments.map((file) => [file, ctx.readText(file)]));
    const l11 = judgeL11Carrier({ deps: { fileExists: ctx.fileExists, segmentBodies }, gates, exemptions: gateExemptions });
    stats.l11WithCarrier = l11.stats.withCarrier;
    stats.l11Exempted = l11.stats.exempted;
    stats.l11Missing = l11.stats.missing;
    stats.l11Stale = l11.stats.stale;
    stats.l11ShortReason = l11.stats.shortReason;
    for (const problem of l11.problems) report("gate-has-carrier", problem);

    // L12 / L12c:链归属。scripts 表经 `ctx.readText` 读 package.json(零新增 ctx 字段)。
    let scripts = {};
    try {
      scripts = JSON.parse(ctx.readText("package.json")).scripts ?? {};
    } catch (error) {
      stats.l12BadDomain += 1;
      report(
        "gate-chain-membership",
        `package.json → gate-chain-membership:读不到或不是合法 JSON(${error instanceof Error ? error.message : String(error)})`
        + " —— 链展开的输入缺失时,「门禁在不在链上」只能按空表判定并把**全部**门禁判成不在链上,"
        + "恒红且零信息量,故判红",
      );
    }
    const l12 = judgeL12ChainMembership({ gates, scripts });
    stats.l12OnChain = l12.stats.onChain;
    stats.l12OffChain = l12.stats.offChain;
    stats.l12BadDomain += l12.stats.badDomain;
    stats.l12ChainNotOnChain = l12.stats.chainNotOnChain;
    stats.l12OffChainOnChain = l12.stats.offChainOnChain;
    stats.l12DeclaredPending = l12.stats.declaredPending;
    stats.l12ShortPendingReason = l12.stats.shortPendingReason;
    for (const problem of l12.problems) report("gate-chain-membership", problem);
  }

  return { problems, info, stats, l5ExemptionCount: l5ByKey.size };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按 `problems` 出 0/1(判定逻辑全在 checkTestLayout 里)。
 *
 * ⚠ **没有 `--enforce`,也没有任何「只报告不拦」的开关**。该开关一旦存在,
 * 「哪些族进哪档」的知识就同时存在于登记表与命令行两处 —— 又一处可漂移的副本,
 * 而命令行那一处还是运行期可变的那一处。强制等级只由 `CRITERIA` 声明。
 * @param {string[]} [argv] 参数数组
 * @returns {number} 退出码
 */
/**
 * `--write-l5-exemptions`:把当前命中的 (段, 说明符) 对去重后写成豁免表基线。
 *
 * **只写不判**:它读真实仓库、覆盖数据文件、exit 0。刻意**不**预先填 reason ——
 * 填占位符会让「忘了写理由」与「写了理由」在门禁上不可区分。生成出来的表因 reason 为空
 * 必然判红(空是「不足 20 字」那一档的特例),那是设计:逼使用者逐条看过、补上理由
 * 或把那条从表里删掉。**该产物在门禁上红是预期结果,不是本入口的缺陷** —— 它 exit 0。
 *
 * ⚠ 它是**生成入口**,不是判据:任何人都能跑它把表洗成当前形状 ⇒ 它绝不能进 verify:ci
 *   (package.json 的链里没有它,别加)。
 * @returns {number} 退出码
 */
function writeL5ExemptionsBaseline() {
  const { info, stats } = checkTestLayout();
  /** @type {Map<string, {segment: string, specifier: string}>} */
  const hits = new Map();
  // 未登记的跨层命中进哪一档由 CRITERIA 决定。两个通道都扫,否则一旦该族在登记表里
  // 换了档,这个生成入口就生成不出东西 —— 而那正是它最需要工作的那一天。
  for (const line of [...info, ...checkTestLayout().problems]) {
    const m = /^(\S+) → test-layer-cross-import:.*层的主体 \(([^)]+)\)/.exec(line);
    if (m === null) continue;
    hits.set(l5ExemptionKey(m[1], m[2]), { segment: m[1], specifier: m[2] });
  }
  const target = path.join(ROOT, ...L5_EXEMPTIONS_REL.split("/"));
  writeFileSync(target, renderL5ExemptionsBaseline([...hits.values()]), "utf8");
  console.log(
    `[test-layout:baseline] 已写入 ${L5_EXEMPTIONS_REL}:${hits.size} 条未登记的跨层 import`
    + `(本次 L5 命中 ${stats.l5Hits} 处;已登记的 ${stats.l5Hits - hits.size} 处不在其中)`
    + `\n  ⚠ reason 一律留空 —— 请逐条人工补(补的内容须 ≥${REASON_MIN_CHARS} 字);`
    + `补不出来的那些说明**不该被豁免**,把它们从表里删掉。`
    + `\n  ⚠ 本入口 exit 0,但它写出的表在门禁上必然判红(空 reason)—— 那是刻意的,见本函数注释。`,
  );
  return 0;
}

export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["help", "write-l5-exemptions"], usage: USAGE });
  } catch (error) {
    // 未知参数一律失败:静默按默认跑一遍报绿就是「假通过」
    console.error(`[test-layout:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options["write-l5-exemptions"] === true) {
    return writeL5ExemptionsBaseline();
  }
  if (options.help === true) {
    // ⚠ 两个计数**由 CRITERIA 派生**,不写死:写死的数字在加一族/删一族那天会静默说谎,
    // 而「还剩几族 report-only」正是待转正进度唯一的读数。
    const failClosed = CRITERIA.length - CRITERIA.filter((entry) => entry.pending === true).length;
    const reportOnly = CRITERIA.length - failClosed;
    console.log(
      [
        USAGE,
        "  --write-l5-exemptions  把当前未登记的跨层 import 写成豁免表基线(reason 留空待人工补,",
        `                        人工补的内容须 ≥${REASON_MIN_CHARS} 字)。只写不判,绝不进 verify:ci。`,
        `  强制等级(由本文件 CRITERIA 派生):${failClosed} 族 fail-closed(命中即非零退出) /`
        + ` ${reportOnly} 族 report-only(命中只报告,结构上不计退出码)。`,
        // ⚠ report-only 的族**逐个点名**:只给一个计数的话,「哪几族待转正」这件事就得回到源码里
        // 逐条翻 —— 而那个 grep 锚数的是**行数**,不告诉你**是哪几族**。计数与名单都由表派生。
        ...(reportOnly === 0
          ? []
          : [`    report-only 族(逐个点名,同样由 CRITERIA 派生):`
            + CRITERIA.filter((entry) => entry.pending === true).map((entry) => entry.id).join(" · ")]),
        "  ⚠ 没有 --enforce:命令行不能改变任何一族的强制等级,那是 fail-open 的口子。",
        "    待转正的族数 = `grep -nE '^\\s*pending: true,$' gates/repo/check-test-layout.mjs` 的命中行数。",
      ].join("\n"),
    );
    return 0;
  }
  const { problems, info, stats, l5ExemptionCount } = checkTestLayout();

  const counts = [
    `L4 test-layer-self-hosted 判红 ${stats.l4Violations} 项`
    + `(零本层主体 ${stats.l4NoOwnSubject} / 段 import 段 ${stats.l4SegmentImports};`
    + `层内段 ${stats.layerSegments} / 共 ${stats.segments} 段)`,
    `L5 test-layer-cross-import 命中 ${stats.l5Hits} 处`
      + `(豁免 ${l5ExemptionCount} 条 / 未登记判红 ${stats.l5Unregistered} / 空 reason 判红 ${stats.l5ExemptionsEmptyReason}`
      + ` / 不足 ${REASON_MIN_CHARS} 字判红 ${stats.l5ExemptionsShortReason}`
      + ` / stale 判红 ${stats.l5StaleExemptions})`,
    `L7 test-top-dirs-exact 多 ${stats.l7Extra} / 缺 ${stats.l7Missing}`
      + "(report-only:命中只报告,不计退出码)",
    `L6 behavior-covers-declared 判红 ${stats.l6Violations} 项`
      + `(behavior 段缺 covers / covers 为空 / covers 元素在磁盘上不存在;`
      + `covers 同时是正常段目录「零层 import」时的 L4 声明通道)`,
    `L8 test-harness-not-segment 判红 ${stats.l8Violations} 项`,
    `L11 gate-has-carrier 判红 ${stats.l11Missing + stats.l11Stale + stats.l11ShortReason + stats.l11TableProblems + stats.l11BadEntries} 项`
      + `(有载体 ${stats.l11WithCarrier} / 豁免 ${stats.l11Exempted} / 无载体判红 ${stats.l11Missing}`
      + ` / 豁免表失效 ${stats.l11TableProblems} / 表项键名错 ${stats.l11BadEntries}`
      + ` / reason 不足 ${REASON_MIN_CHARS} 字判红 ${stats.l11ShortReason} / stale 判红 ${stats.l11Stale})`
      + `;L11b gate-module-present 判红 ${stats.l11MissingModule} 项(索引在册而树里无:门禁本体被删/改名)`
      + "(判定面 = 本求值根里索引模块在场的那些门禁;合成根上索引模块不在场 ⇒ L11/L11b/L12 整段不适用)",
    `L12 gate-chain-membership 判红 ${stats.l12BadDomain + stats.l12ChainNotOnChain + stats.l12OffChainOnChain} 项`
      + `(chain ${stats.l12OnChain} / offchain ${stats.l12OffChain}`
      + ` / 取值域外判红 ${stats.l12BadDomain}`
      + ` / chain 却不在链判红 ${stats.l12ChainNotOnChain} / offchain 却在链判红 ${stats.l12OffChainOnChain}`
      + ` / pendingChain 声明 ${stats.l12DeclaredPending}、其中理由不足 ${stats.l12ShortPendingReason})`,
    `C1 test-dist-artifact-source-mirror 判红 ${stats.c1MirrorMissing} 项`
      + `(被测 import 落在 dist/** 共 ${stats.c1Artifacts} 处,按构建产物路径反推的镜像源全部不存在者判红)`,
    `C1 test-segment-mirror-same-name 判红 ${stats.c1SameNameMissing} 项`
      + `(段路径镜像了真实源文件的段共 ${stats.c1MirroredSegments} 段,未落在同名编译产物上者判红)`,
    `C3 test-layer-gate-subject 命中 ${stats.c3Hits} 处`
      + `(豁免 ${stats.c3Exemptions} 条 / 未登记判红 ${stats.c3Unregistered}`
      + ` / 不足 ${REASON_MIN_CHARS} 字判红 ${stats.c3ShortReason} / stale 判红 ${stats.c3Stale})`,
  ].join(";");
  const named = problems.map((problem) => problem.split(" → ")[0] ?? problem);

  for (const line of info) console.log(`[test-layout:pending] ${line}`);

  if (problems.length === 0) {
    console.log(`[ok] test 布局判据通过:${counts}`);
    return 0;
  }

  for (const problem of problems) console.error(`[test-layout:fail] ${problem}`);
  console.error(
    `[test-layout:fail] test 布局判据不成立,共 ${problems.length} 项:${counts}。`
    + `点名文件:${named.join(", ")}。`,
  );
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
