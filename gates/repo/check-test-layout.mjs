// test 布局门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 判据一览(五族 + 扫描面两档)----
//   ① test-layer-self-hosted(L4):`test/<R>/**/<m>.test.js` 必须 import **至少一个**
//      解析后落在 `<R>/` 对应主体根内的模块。零命中即判红并点名该段。
//   ② test-layer-cross-import(L5):`test/<L>/**` 不得 import **别的层**的
//      `dist/<其它层>/` / `src/<其它层>/` / `<其它层>/`。命中判红,诊断直接给出
//      「搬去 `test/behavior/` 并写 `covers`」的处置指引。
//   ③ test-top-dirs-exact(L7):`test/` 顶层**目录**集合 == 镜像源派生集 ∪ {behavior, harness}。
//      多一个少一个都判红。
//   ④ test-harness-not-segment(L8):`test/harness/` 是**自指层**(主体根 = 它自己);
//      其下的段**必须**声明 `covers` 且至少一个元素指向 `test/harness/**`
//      (未声明 / 空声明 / 元素全指向别处,三者各自判红)。
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
