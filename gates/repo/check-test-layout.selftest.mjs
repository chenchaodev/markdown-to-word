// test 布局门禁自身的回归守护(负向夹具)。
//
// check-test-layout.mjs 是纯文本门禁,失效形态全是**恒绿**:walker 塌缩成零段、镜像源派生
// 退化成「什么都不检查」、type-only 放行豁免写成「凡引用都豁免」,它都会打印一份漂亮的
// 五族计数然后 exit 0 —— 而「段住在错的层里」「harness 下混进段」「顶层多一个杂物目录」
// 的事实照旧。此处逐条制造这些漂移,断言判据确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 系统临时目录里的一棵合成仓根(含 src/ 与 test/),
// 而门禁**原位**从仓内跑 —— 纯函数档直接 import 判定本体并注入 ctx(读文本 / 列目录 /
// 扫描面下限),进程级档靠 cwd 指夹具根跑仓内真脚本。项目根单一来源是 shared/paths.js 的
// process.cwd(),而 ESM 静态 import 按**文件位置**解析、与 cwd 无关,所以真脚本的仓内依赖
// 天然可达,沙盒里不需要(也不应该)再放一份 shared/。
//
// ⚠ 三条易踩的夹具纪律(各自都对应一条会「让负向夹具失去意义」的坑):
//   ① 底板必须**先满足 L7 的集合相等**(造齐派生集里的每一层 + behavior + harness),
//     否则每条夹具都先被 L7 判红,验的就不是它要验的那一格;
//   ② 底板必须**造齐 src/ 的每一个子目录** —— 镜像源集合是派生的,src/ 少一个子目录,
//      派生集就少一层,L7 的「多一个/缺一个」两档会跟着漂,夹具之间不再可比;
//   ③ 底板段数必须够到 MIN_SCANNED_FILES,否则进程级档会先被「扫描面塌缩」那条判据拦下。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统临时区
// 会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里,**不碰真实工作树**,
// 因此 check:temp-cleanup 扫不到、也不该扫到它(该门禁刻意不扫 gates/:那里 rmSync 是被测语义)。
//
// ---- 形态:接入具名 case 契约,但**不接合成根 harness** ----
//
// 夹具表 143 条逐条收成 `await suite.case(档名, () => runOne(档))`,suite 由
// `shared/case.js` 的 `createCaseSuite` 建一次(ADR-074 决定一:门禁树接的是落在 shared/ 的
// 真实现 —— `gates-stay-in-gates` 的允许面只有 `gates` / `shared` / `test/fixtures`,
// `test/` 整棵树不在其中,引不到 `test/harness/case.js`)。case 内失败即抛、由 case 级 catch
// 收成**该条**失败,不中断后续档 —— 一次跑完可见全部失败面。
//
// **为什么本档不进合成根 harness**(`shared/gate-selftest-harness.mjs`,ADR-068):
// 本档的判定面是**problems / info 双通道**加**退出码**,入参是 ctx 注入面(判据登记表 / 豁免表 /
// 两个扫描面下限)与夹具树,而 harness 的表只收「树型路径 → 正文 + 问题清单正则」且判定体须
// 回吐**问题清单** —— 入参与返回两侧都不对型,塞进去是假接入(bespoke 留在原处)。case 契约
// 解决的是另一件事:让「档数」成为可机械计数的单位(`gates-selftest-named-case` 判的就是它),
// 迁移后分母由 `suite.results.length` 给出。
//
// ⚠ 与旧实现的**唯一**行为差别(记账从 `failures[]` 换成 suite):旧实现把异常的 stack 拼进
// 失败消息里一并打印,新实现由 case 契约单独存 `CaseResult.stack`(失败消息仍是逐字沿用的
// 那条 message),栈不展开在逐条 fail 日志里;逐档成败、退出码与汇总口径都不变。
// 143 条档名逐字沿用搬迁前的 `name:` 值 —— 一条不改、不合并、不新增。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
import {
  ACCESS_CHAIN,
  ACCESS_OFFCHAIN,
  caseRosterRelFor,
  checkTestLayout,
  CRITERIA,
  extractGateCaseNames,
  extractImports,
  GATE_EXEMPTIONS_REL,
  GATE_INDEX_MODULE_REL,
  GATE_SELFTEST_CASE_SOURCES,
  GATE_SUBJECT_EXEMPTIONS_REL,
  GATES_CASE_MODULE_REL,
  GATES_SELFTEST_EXT,
  GATES_SELFTEST_ROOT,
  L5_EXEMPTIONS_REL,
  loadGateExemptions,
  loadGateSubjectExemptions,
  judgeL11Carrier,
  judgeL12ChainMembership,
  makeGateRegistryCtx,
  MIN_GATE_CASE_ROSTER,
  MIN_SCANNED_FILES,
  NON_MIRROR_TOP_DIRS,
  REASON_MIN_CHARS,
  TEST_REL,
} from "./check-test-layout.mjs";
// 链根从**单源**取(与判定本体同一处 import),不在夹具里手抄一份 ——
// 手抄的那份会在判定本体换链根时静默说谎,而那一格正是「判定面含哪几条链」的牙齿。
import { CHAIN_ROOTS } from "./chain-expand.mjs";

const projectRoot = ROOT;
const checkerPath = join(projectRoot, "gates", "repo", "check-test-layout.mjs");

/**
 * 底板造的 src/ 子目录:与镜像源派生结果的「src 那一半」同形。
 * 少一个 ⇒ L7 的期望集合少一层 ⇒ 所有夹具的 L7 断言漂(见文件头纪律 ②)。
 */
const BASE_SRC_LAYERS = Object.freeze(["cli", "convert", "core", "main", "mcp", "renderer"]);

/**
 * 底板造的 test/ 顶层目录 = BASE_SRC_LAYERS ＋ 顶层树(gates/shared/tools,取自仓内
 * TREE_DIRS 单源)＋ 两个非镜像位(behavior/harness)。
 * 取自被测模块的常量而不是手抄一份:手抄的那份会与 NON_MIRROR_TOP_DIRS 漂移,而漂移的表现
 * 是「夹具全绿但门禁在真实仓库上报红」—— 正是自检最该防的形态。
 */
const BASE_TEST_TOPS = Object.freeze([
  ...BASE_SRC_LAYERS,
  "gates",
  "shared",
  "tools",
  ...NON_MIRROR_TOP_DIRS,
]);

/**
 * 一段「本层主体齐备」的段:import 本层的 dist/ 产物 + 一处 type-only 的 src/ 类型引用
 * (后者是本仓必需形态,见门禁文件头「值 import 与 type-only 引用必须分开」),
 * **并已接入具名 case 契约**(REQ-220 #08 族二)。
 *
 * ⚠ **为什么底板段必须接 case 契约**:两族新判据都是 report-only ⇒ 命中走 `info` 通道,
 * 而多条既有夹具断言 `expectInfo: null`(info 必须为空)。底板段若不接契约,那些夹具会先被
 * 与本族无关的 info 命中顶住,验的就不再是它们本要验的那一格 —— 这与纪律 ①②③ 同源:
 * **底板必须先满足全部判据**,否则每条夹具都先被无关的红/报告盖住。
 * 同理族一:底板段**刻意不带**本地 `assert` 重写体(那一族要「零本地顶层断言实现」)。
 *
 * @param {string} layer 层名
 * @returns {string}
 */
function wellFormedSegment(layer) {
  const distRoot = BASE_SRC_LAYERS.includes(layer) ? `../../dist/${layer}/subject.js` : `../../${layer}/subject.mjs`;
  return [
    "// @ts-check",
    "/** 夹具段:本层主体齐备,且已接入具名 case 契约(见本函数注释「为什么底板段必须接 case」)。 */",
    `import { subject } from "${distRoot}";`,
    "import { assert as harnessAssert, createCaseSuite } from \"../harness/case.js\";",
    `/** @typedef {import("../../src/${layer}/types.js").Options} Options */`,
    "export const meta = { description: 'well-formed' };",
    "export async function run() {",
    "  const suite = createCaseSuite();",
    '  await suite.case("subject 可取到", () => { harnessAssert(subject !== undefined, "subject 必须已取到"); });',
    "  return { cases: suite.results };",
    "}",
    "",
  ].join("\n");
}

/**
 * 底板铺的段数:必须够到 MIN_SCANNED_FILES,否则进程级档会先被「扫描面塌缩」那条判据拦下
 * —— 那样「退出码不同」证明的是塌缩判据而不是五族判据。
 */
const BASE_PAD = MIN_SCANNED_FILES + 10;

/**
 * 从段所在目录到契约模块的相对说明符(仓库相对 POSIX 路径)。
 * @param {string} fromDir 段所在目录(仓库相对 POSIX)
 * @param {string} to 目标文件(仓库相对 POSIX)
 * @returns {string} 相对说明符;与 fromDir 同目录时返回 `./<basename>`
 */
function posixRelativeSpecifier(fromDir, to) {
  const from = fromDir.split("/");
  const parts = to.split("/");
  let common = 0;
  while (common < from.length && common < parts.length && from[common] === parts[common]) common += 1;
  const spec = [...Array.from({ length: from.length - common }, () => ".."), ...parts.slice(common)].join("/");
  return spec.startsWith(".") ? spec : `./${spec}`;
}

/**
 * 合成段的「接入具名 case 契约」凭证。族二只判两格 —— import 契约模块(按解析后路径)
 * 与至少一处 `.case(` 属性访问调用;它**不判 case 的语义**,故凭证里那个 case 体是空的。
 *
 * ⚠ 为什么默认给每份合成段补这段凭证:族二已 fail-closed,合成段若不带接入,那些
 * 「期望零判红」的夹具会先被族二判红,验到的变成两族判据的叠加(与底板段必须 import
 * 本层主体、否则 C1 先判红是同一处境)。
 * ⚠ 为什么自带 `case.js` 桩的夹具要跳过:那正是要验「未接入如实判红」的那几条族二夹具,
 * 它们必须保留未接入形态,判据才有牙齿。
 * @param {string} rel 段文件(仓库相对 POSIX 路径)
 * @returns {{ head: string, tail: string }} 追加到段正文首尾的两段文本
 */
function caseContractProbe(rel) {
  const segDir = rel.slice(0, rel.lastIndexOf("/"));
  const spec = posixRelativeSpecifier(segDir, `${TEST_REL}/harness/case.js`);
  return {
    // 说明符放在段正文**首部**:import 声明虽会被提升,但判定侧的 import 抽取器不该被
    // 依赖「提升」这件事 —— 夹具凭证按最朴素的可解析形态写。
    head: `import { createCaseSuite } from "${spec}";\n`,
    tail: [
      "",
      "/** 族二接入凭证:该族判「import 契约模块 + 至少一处 .case(」两格,不判 case 语义。 */",
      "async function caseContractProbe() {",
      "  const suite = createCaseSuite();",
      '  await suite.case("夹具段已接入具名 case 契约", () => {});',
      "  return { cases: suite.results };",
      "}",
      "",
    ].join("\n"),
  };
}

/**
 * 造一棵合成仓根。
 * @param {Readonly<Record<string, string>>} [extra] 仓库相对 POSIX 路径 → 正文
 * @param {{ keepSegmentsCaseBare?: boolean }} [opts] `keepSegmentsCaseBare`:本夹具的
 *   合成段**一律不补**接入凭证(验「未接入如实判红」的那几条族二夹具要用)
 * @returns {string} 夹具根绝对路径
 */
function createFixture(extra = {}, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-test-layout-selftest-"));
  // ① src/ 的每一层都要有目录(纪律 ②)。放一个 .gitkeep 即可:判据只看目录名。
  for (const layer of BASE_SRC_LAYERS) writeUnder(dir, `src/${layer}/.gitkeep`, "");
  // ①' C1 档一要「按构建产物路径反推镜像源」,而底板段 import 的产物是
  // `dist/<层>/subject.js` ⇒ 必须在 `src/<层>/subject.ts` 造出那个源文件,否则**每一条**
  // 既有夹具都会先被 C1 判红(症状离根因隔着一整族判据,最难归因)。
  // ⚠ 只造**源**、不造 `dist/`:C1 问的是「产物背后有没有源」,不是「产物在不在磁盘上」
  // (`dist/` 是 gitignored 的构建产物,它的存在性由构建新鲜度门禁管,不由这一族管)。
  for (const layer of BASE_SRC_LAYERS) writeUnder(dir, `src/${layer}/subject.ts`, "export const subject = 1;\n");
  // ①'' C1 档一要按**产物路径反推**源路径,`.mjs` 产物反推的是 `.mts` 源(NodeNext 的模块
  // 后缀配对)。L5 那一族的夹具用 `dist/main/other.mjs` / `one.mjs` 做跨层说明符,故这两个
  // 源也得在 —— 否则那几条夹具会先被 C1 判红,验的就变成两族判据的叠加。
  writeUnder(dir, "src/main/other.mts", "export const other = 1;\n");
  writeUnder(dir, "src/main/one.mts", "export const one = 1;\n");
  // 另一族跨层说明符用 `.js` 产物(反推 `.ts` 源)。
  writeUnder(dir, "src/renderer/settings/settings-logic.ts", "export const scale = 1;\n");
  writeUnder(dir, "src/main/persist/ui-state.ts", "export const state = 1;\n");
  // ② test/ 的每个顶层目录都要在(纪律 ①)。behavior/ 与 harness/ 建空目录:T3 才建立内容。
  for (const top of BASE_TEST_TOPS) mkdirSync(join(dir, ...`${TEST_REL}/${top}`.split("/")), { recursive: true });
  // ③ 底板段:每层铺够 BASE_PAD 段,每段都 import 本层主体 ⇒ 基线零判红。
  // ③' 豁免表:合成根里也必须有一份(真实仓里有,判据从 `ctx.root` 读它)。
  // 缺了它,每条进程级夹具都会先被「豁免表读不到」判红 —— 症状离根因很远。
  // 底板给一份**空表**:各夹具要豁免什么就自己注入(ctx.l5Exemptions),不在这里预置。
  //
  // ⚠ **两张表都要造**:C3 的表搬成数据文件后,进程级夹具走的是与 L5 同款的读盘路径
  // (`judge()` 那侧靠注入面绕开,进程级这侧没有注入面可用)。少造一张 ⇒ C3 先被
  // 「表读不到」判红,那是一条与夹具本意无关的红。
  for (const rel of [L5_EXEMPTIONS_REL, GATE_SUBJECT_EXEMPTIONS_REL]) {
    writeUnder(dir, rel, `${JSON.stringify({ _comment: "夹具底板:空豁免表。", entries: [] }, null, 2)}\n`);
  }
  for (let i = 0; i < BASE_PAD; i += 1) {
    const layer = BASE_SRC_LAYERS[i % BASE_SRC_LAYERS.length] ?? "core";
    writeUnder(dir, `${TEST_REL}/${layer}/pad-${i}.test.js`, wellFormedSegment(layer));
  }
  // 族二 fail-closed 后,合成段默认补上接入凭证(理由见 caseContractProbe 的注释);
  // 自带 case.js 桩的夹具跳过 —— 它们验的正是「未接入」。
  const fixtureSuppliesCaseModule = Object.keys(extra).some((k) => k.replace(/\\/g, "/").endsWith(`harness/case.js`));
  const keepBare = opts.keepSegmentsCaseBare === true;
  for (const [rel, body] of Object.entries(extra)) {
    const norm = rel.replace(/\\/g, "/");
    const isCaseModuleItself = norm.endsWith(`harness/case.js`);
    // 三条互不替代的跳过理由:夹具显式要裸段、要验的正是「自带桩但段没接入」、桩文件自身。
    const needsProbe =
      !keepBare && !fixtureSuppliesCaseModule && !isCaseModuleItself && norm.endsWith(".test.js");
    const probe = needsProbe ? caseContractProbe(norm) : { head: "", tail: "" };
    writeUnder(dir, norm, `${probe.head}${body}${probe.tail}`);
  }
  return dir;
}

/**
 * @param {string} root 夹具根
 * @param {string} rel 仓库相对 POSIX 路径
 * @param {string} body 正文
 * @returns {void}
 */
function writeUnder(root, rel, body) {
  const target = join(root, ...rel.split("/"));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, body, "utf8");
}

/**
 * 在合成目录上求值判定本体(纯函数档;不 spawn,故不碰真实工作树也不受塌缩下限影响 ——
 * 这里显式把下限关掉,让每条夹具只验它要验的那一格)。
 * @param {Readonly<Record<string, string>>} extra 仓库相对 POSIX 路径 → 正文
 * @param {object} [opts]
 * @param {number} [opts.minScannedFiles] 扫描面下限(段侧)
 * @param {number} [opts.minSelftestFiles] 扫描面下限(门禁自测侧)
 *   —— ⚠ **两个下限都要显式关掉**,缺一个就有一条与夹具本意无关的红等着:合成根里段数够
 *   BASE_PAD 而 `.selftest.mjs` 通常零份(只有铺了 `gates/` 的少数夹具有),带着真实下限
 *   时新族会在**每一条**夹具上先报「扫描面塌缩」—— 症状离根因隔着一整族判据。
 * @param {{segment: string, specifier: string, reason: string}[]} [opts.l5Exemptions] L5 豁免表(注入面)
 * @param {readonly Record<string, object>} [opts.gateRegistry] 门禁索引(注入面;缺省 = 空索引)
 * @param {{segment: string, specifier: string, reason: string}[]} [opts.gateSubjectExemptions]
 *   C3 的门禁主体豁免表(注入面;缺省 = 空表,理由见 `judge` 里那段注释)
 * @param {{ id: string }[]} [opts.criteriaOverride] 判据登记表覆盖(⚠ 只允许删行,见下)
 * @returns {{ problems: string[], info: string[], stats: import("./check-test-layout.mjs").TestLayoutStats }}
 */
function judge(extra, opts = {}) {
  // missingRoot:求值根指向一个**不存在**的目录,逼 listDir 抛错(见 CASES 里那条夹具的注释)。
  // skipSrc:根与 test/ 都在,只缺 src/ ⇒ 镜像源派生不出来(另一侧输入缺失,判据点明它)。
  // 两种都仍要建夹具再删,是为了让 finally 的清理路径与其它夹具同形、不留第二套清理逻辑。
  const dir = createFixture(extra, opts);
  try {
    if (opts.missingRoot === true) rmSync(dir, { recursive: true, force: true });
    if (opts.skipSrc === true) rmSync(join(dir, "src"), { recursive: true, force: true });
    return checkTestLayout({
      root: dir,
      minScannedFiles: opts.minScannedFiles ?? 0,
      // ⚠ 门禁自测侧的扫描面下限**同样要显式关掉**,理由见本函数 JSDoc 里那两个下限的注释。
      minSelftestFiles: opts.minSelftestFiles ?? 0,
      // l5Exemptions 注入:走 base 的注入面,不读真实数据文件 ⇒ 夹具与真实仓库互不影响
      l5Exemptions: opts.l5Exemptions ?? [],
      // ⚠ **合成根必须把门禁清单也注入掉**,理由与上面那条同款但更硬:合成根里没有 `gates/`
      // 也没有 `package.json` 的 scripts 表,若让它读**真实注册表**,L11 会把索引里**每一项**门禁全判成
      // 「无载体」(合成根里当然没有载体)、L12 会因读不到 package.json 而判红 —— 于是
      // **每一条既有夹具都会先被 L11/L12 判红**,症状离根因隔着一整族判据。
      // 合成树里**没有登记任何门禁**是如实的(它就是一个 test/ 布局的合成根),
      // 故这里注入空清单;L11/L12 的正面与负向夹具各自在下面那一族里单独求值。
      gateRegistry: opts.gateRegistry ?? {},
      // 门禁级豁免表同理:合成根里没有那张数据文件,让它去读会命中「读不到 → 判红」那一档。
      gateExemptions: opts.gateExemptions ?? [],
      // C3 的门禁主体豁免表**必须显式注入空表**:合成根里没有那张数据文件,不注入就会命中
      // 「表读不到 → 判红」那一档(见 check-test-layout.mjs 里 loadGateSubjectExemptions 的
      // 注释:那一档**刻意判红**,不静默当空表)⇒ 每条夹具都会多出一条与本夹具无关的红,
      // 症状离根因隔着一整族判据。底板(`createFixture`)也造了一份空表给**进程级**夹具用,
      // 那一条路径没有注入面可走。
      gateSubjectExemptions: opts.gateSubjectExemptions ?? [],
      // ⚠ 删行口是自检专用,且**只允许删行**。它必须永远是「拿掉一行让漏斗查不到」这一个方向 ——
      // 一旦它能新增表项或加 `pending: true`,注入口就成了「可配置即假话」的后门:
      // 自检夹具能调档 ⇒ 生产调用点也能调档 ⇒ fail-open。另两个方向由门禁的
      // `resolveCriteria` 抛错挡住 —— 那是硬检查,不是这里的约定。
      ...(opts.criteriaOverride === undefined ? {} : { criteriaOverride: opts.criteriaOverride }),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 在合成目录上跑门禁 CLI(进程级档;cwd 指夹具根,argv[1] 指仓内本体 —— 两者恒不相等,
 * 故入口守卫成立)。返回退出码与合并输出。
 * @param {Readonly<Record<string, string>>} extra 仓库相对 POSIX 路径 → 正文
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runChecker(extra, args = [], removeTopDir = undefined, opts = {}) {
  const dir = createFixture(extra, opts);
  try {
    // 删一整个顶层目录是「L7 缺一档」唯一能造出的形态:判据只加文件,而「少一层」这件事
    // 只能靠删目录表达(见 CASES 里 deriveMissing 那条的同款理由)。
    if (removeTopDir !== undefined) {
      rmSync(join(dir, ...`${TEST_REL}/${removeTopDir}`.split("/")), { recursive: true, force: true });
    }
    return runAt(dir, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 以指定 cwd 跑仓内门禁本体。**cwd 即求值根**(shared/paths.js 的 ROOT = process.cwd()),
 * 所以这一句同时是「换根」与「不换脚本」—— 夹具里因此不需要、也不该放一份门禁副本。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runAt(cwd, args) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * `sourceAudit` 一档的判据:**读门禁本体源码**(不是夹具副本)抽出全部机器 id,与 `CRITERIA`
 * 双向对账。
 *
 * ⚠ **这一格与门禁本体的行锚形态刻意耦合**,下一个人看到它红时**不要去「修」它**:
 * 它靠「诊断行里出现 `→ <id>:`」这一个约定把源码里的判据族抽出来。改文案形状(把 id 挪走、
 * 或 id 前不再有 ` → `)会让本档红 —— 那正是它的牙齿。真要改形状,就把本档与门禁一起改成
 * 抽 `report("…")` 的第一个实参(两者等价,后者更不依赖文案),**不要两边各改一半**。
 * 连带约束:门禁文件头提到某个 id 时不要写成 ` → <id>:` 的形状(会被当源码里的 id 抽出来)。
 *
 * 双向对账:第一向(源码有、表里没有)= 漏登记;第二向(表里有、源码已删)= **僵尸行** ——
 * 后者会让门禁文件头那条 grep 进度锚的命中数说谎,而那正是「还剩几族待转正」的唯一读数。
 * @returns {{ sourceOnly: string[], tableOnly: string[] }} 两向差集(都为空即平)
 */
function auditSourceCriteria(sourceOverride = undefined, tableOverride = undefined) {
  const source = sourceOverride ?? readFileSync(checkerPath, "utf8");
  const ids = new Set([...source.matchAll(/→\s*([a-z][a-z0-9-]*):/g)].map((m) => m[1] ?? ""));
  const table = new Set((tableOverride ?? CRITERIA).map((entry) => entry.id));
  return {
    sourceOnly: [...ids].filter((id) => !table.has(id)).sort(),
    tableOnly: [...table].filter((id) => !ids.has(id)).sort(),
  };
}

/**
 * report-only 族数:**由 `CRITERIA` 派生**,不写死。
 *
 * 写死的数字在加一族 / 删一族 / 转正一族那天会静默说谎,而「还剩几族待转正」
 * 正是唯一进度读数(门禁文件头那条 grep 锚的命中数)。自检里凡是要断言这个数的地方
 * 一律现算,让「数字不是手写的」这件事本身被钉住。
 */
const PENDING_ROWS = CRITERIA.filter((entry) => entry.pending === true).length;

/**
 * 一个**本层主体齐备但另有一处跨层引用**的段。
 *
 * ⚠ 跨层夹具**必须**同时 import 本层主体,否则它先被 L4 判红(「没有 import 任何本层
 * 主体」),验的就变成 L4 而不是 L5。少了这一句,L5 的三条夹具全部会被 L4 的红盖住 ——
 * 而两族的处置完全不同(L4 判「搬去真正被测的那层」,L5 判「搬去 behavior 并写 covers」)。
 * @param {string} layer 本层
 * @param {string} spec 跨层说明符(相对段所在目录)
 * @returns {string}
 */
function crossLayerSegment(layer, spec) {
  const ownRoot = BASE_SRC_LAYERS.includes(layer) ? `../../dist/${layer}/subject.js` : `../../${layer}/subject.mjs`;
  return [
    "// @ts-check",
    "/** 夹具段:本层主体齐备,另有一处跨层引用(只为验 L5)。 */",
    `import { subject } from "${ownRoot}";`,
    `import { other } from "${spec}";`,
    "import { createCaseSuite } from \"../harness/case.js\";",
    "export const meta = { description: 'cross-layer' };",
    "export async function run() {",
    "  const suite = createCaseSuite();",
    '  await suite.case("两处引用都取到", () => { if (subject === undefined || other === undefined) throw new Error("缺引用"); });',
    "  return { cases: suite.results };",
    "}",
    "",
  ].join("\n");
}

/** 一个零本层主体的段:只 import node: 内建与 test/ 内部的非段助手 */
const NO_OWN_SUBJECT = [
  "// @ts-check",
  "/** 夹具段:不 import 任何本层主体(被测的其实是测试框架自身)。 */",
  'import { ROOT } from "../common/paths.js";',
  "export const meta = { description: 'no-own-subject' };",
  "export async function run() { return ROOT; }",
  "",
].join("\n");

/** 一个 type-only 引用指 src/ 的段:除该类型引用外不 import 任何本层主体 */
const TYPE_ONLY_SRC_REF = [
  "// @ts-check",
  "/** 夹具段:唯一的本层引用是 type-only 的类型引用(该形态一律放行)。 */",
  "/** @typedef {import(\"../../src/core/i18n.js\").ConvertWarning} Warning */",
  "export const meta = { description: 'type-only-src-ref' };",
  "/** @param {Warning} w @returns {Warning} */",
  "export function run(w) { return w; }",
  "",
].join("\n");

/**
 * 一个 behavior 夹具段:`covers` 声明形态可配。
 *
 * 行为段**不 import 任何层主体**(它的定义就是横跨多层),所以 L4 天然不适用它 ——
 * 这条夹具只验 L6。`covers` 传 `null` 表示整条声明缺席。
 * @param {string[] | null} covers 声明元素;null = 不写声明
 * @returns {string}
 */
function behaviorSegment(covers) {
  return [
    "// @ts-check",
    "/** 夹具段:behavior 段(横跨多层,不 import 任何层主体)。 */",
    ...(covers === null
      ? []
      : ["/** 本段横跨的层:仓库相对 POSIX 路径。 */", `export const covers = [${covers.map((c) => JSON.stringify(c)).join(", ")}];`]),
    "export const meta = { description: 'behavior' };",
    "export async function run() { return 1; }",
    "",
  ].join("\n");
}

/**
 * C3 那一族夹具的**树身份占位**:在合成根里放一份索引模块文件。
 *
 * C3 整段(判定 + stale)受「本求值根是不是索引描述的那棵树」这条边界约束(理由见门禁本体里
 * `indexInRoot` 的注释):豁免表描述的是真实仓库,而 `ctx.fileExists` 以求值根为准 ——
 * 合成根上「stale」不是事实而是范畴错误。少了这份占位,本族每一条夹具都会零命中,
 * 而症状是「C3 全绿」—— 看不出是作用域没开。
 * @type {Readonly<Record<string, string>>}
 */
const C3_TREE_IDENTITY = { [GATE_INDEX_MODULE_REL]: "export const GATE_INDEX = {};\n" };

/**
 * L11/L12 判定本体的注入夹具(纯函数档,不 spawn、不碰真实工作树)。
 *
 * **为什么这两族不走 `judge()` 而直调判定本体**:它们的面是**门禁清单 + scripts 表**,
 * 与 test/ 树无关。走 `judge()` 得在合成根里造一整棵 test/ 树,却一行都用不上 ——
 * 而更糟的是它会让「L11/L12 的命中」与「L4–L8 的命中」混进同一个 `problems`,症状出了
 * 无法归因。故这两族有独立的注入面与独立的档位断言。
 *
 * @param {object} opts
 * @param {readonly Record<string, object>} opts.gates 注入的门禁清单
 * @param {Record<string, string>} [opts.scripts] 注入的 scripts 表(缺省取 package.json 真实表)
 * @param {string[]} [opts.existingFiles] 声明「存在」的文件(替 fileExists)
 * @param {Record<string, string>} [opts.segmentBodies] 段路径 → 正文(替「验收段引用」那一档)
 * @param {{gate: string, reason: string}[]} [opts.exemptions] 门禁级豁免表
 * @param {"l11" | "l12"} opts.family 跑哪一族
 * @returns {{ problems: string[], stats: Record<string, number> }}
 */
function judgeGate(  { gates, scripts, existingFiles = [], segmentBodies = {}, exemptions = [], family }) {
  const resolved = scripts ?? JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).scripts;
  const { gates: normalized } = makeGateRegistryCtx(gates);
  if (family === "l11") {
    const present = new Set(existingFiles);
    return judgeL11Carrier({
      deps: { fileExists: (rel) => present.has(rel), segmentBodies: new Map(Object.entries(segmentBodies)) },
      gates: normalized,
      exemptions,
    });
  }
  return judgeL12ChainMembership({ gates: normalized, scripts: resolved });
}

/* ---------- ⑯ 族(case 名 ⟷ 登记名册)的合成夹具 ---------- */

/**
 * 从真实取名策略登记表里**按策略签名**取一行(夹具用的在册自测路径)。
 *
 * ⚠ **为什么不自造路径**:判定面收窄在「这一棵树与登记表有交集」之后
 * (理由见门禁本体那段注释)。自造路径 ⇒ 交集恒空 ⇒ 本族整段不适用 ⇒
 * **每一档名册夹具都会「零命中」而恒绿**。
 * ⚠ **为什么按签名找而不是写死行号**:行号会随登记表增删漂(某份自测被搬走或换策略),
 * 漂了之后夹具会**静默改验另一份自测的策略** —— 症状是某档夹具某天开始「验的东西不对了」。
 * 按签名找则「找不到」是硬失败(夹具直接抛,不退化成恒绿)。
 * @param {(entry: { strategies: readonly {kind: string, field?: string}[] }) => boolean} predicate 行判定
 * @returns {string} 登记表里那一行的自测路径
 */
function registeredDemoFor(predicate) {
  const hit = GATE_SELFTEST_CASE_SOURCES.find((entry) => predicate(entry));
  if (hit === undefined) {
    throw new Error(
      "取名策略登记表里没有满足该策略签名的行 —— 名册族夹具铺的是**在册路径**,"
      + "找不到就是登记表改了策略形状,夹具必须同批跟上",
    );
  }
  return hit.file;
}

/** 在册 · 纯内联字面量档(取名策略①)。 */
const INLINE_DEMO = registeredDemoFor((e) => e.strategies.length === 1 && e.strategies[0].kind === "inline-case");
/** 在册 · 纯用例表 `name:` 字段档(取名策略②)。 */
const TABLE_NAME_DEMO = registeredDemoFor(
  (e) => e.strategies.length === 1 && e.strategies[0].kind === "table-field" && e.strategies[0].field === "name",
);
/** 在册 · 本地 wrapper 首参档(取名策略③)。 */
const WRAPPER_DEMO = registeredDemoFor((e) => e.strategies.length === 1 && e.strategies[0].kind === "wrapper-first-arg");
/** 在册 · 变异实验 `id:` 字段档(取名策略④)—— 取「两套字段名(name + id)那一行」。 */
const MUTATION_ID_DEMO = registeredDemoFor(
  (e) => e.strategies.some((s) => s.field === "name") && e.strategies.some((s) => s.field === "id"),
);
/** 在册 · 内联 `cases:` 档(取名策略⑤)—— 取「有 `call-cases-field` 那一行」。 */
const INLINE_CASES_DEMO = registeredDemoFor((e) => e.strategies.some((s) => s.kind === "call-cases-field"));

/**
 * 名册族夹具用的**未在册自测路径**(验「登记表缺行判红」那一档)。
 * ⚠ 它由一份**在册**路径派生(同目录同后缀形态)—— 否则那一条「少一行」的诊断会被别的
 * 形态差异(目录 / 扩展名)掩盖,而读者会以为验的是缺行那一档。
 */
const UNREGISTERED_DEMO = `${TABLE_NAME_DEMO.slice(0, -GATES_SELFTEST_EXT.length)}-unregistered${GATES_SELFTEST_EXT}`;

/**
 * 合成自测的名册 sidecar 路径(**取自被测实现**,不手抄后缀映射 ——
 * 理由同 `posixRelativeSpecifier` 那条:手抄的那份会与派生规则漂移)。
 * @param {string} selftestRel 自测路径
 * @returns {string}
 */
const ROSTER_OF = (selftestRel) => /** @type {string} */ (caseRosterRelFor(selftestRel));

/**
 * 一份名册 sidecar 的正文(`cases` 数组)。
 * @param {string[]} cases 登记的 case 名
 * @returns {string}
 */
const roster = (cases) => `${JSON.stringify({
  _comment: "夹具名册:登记这一份自测的 case 名(两向差集的册侧)。",
  cases,
}, null, 2)}\n`;

/**
 * 某份合成自测的契约 import 说明符(按**它自己的目录**算 —— 夹具铺在四棵子树下,
 * 拿一个写死的目录算会让跨目录那几份的相对说明符算错,而「说明符解析不到」在本族
 * 是不响的:它只影响 `gates-selftest-named-case` 那一族,症状离本族隔着一族判据)。
 * @param {string} selftestRel 自测路径
 * @returns {string}
 */
function contractSpecifierFor(selftestRel) {
  return posixRelativeSpecifier(selftestRel.slice(0, selftestRel.lastIndexOf("/")), GATES_CASE_MODULE_REL);
}

/** 取名策略①:全部用内联 `await suite.case('…')` 字面量(零用例表)。 */
const INLINE_CASE_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(INLINE_DEMO)}";`,
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  await suite.case('甲档', () => {});",
  "  await suite.case('乙档', () => {});",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/** 取名策略②:全部走用例表 `CASES` 的 `name:` 字段(与该在册行的登记策略逐字同形)。 */
const TABLE_NAME_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(TABLE_NAME_DEMO)}";`,
  "const CASES = Object.freeze([",
  "  {",
  "    name: '表内一',",
  "    files: {},",
  "  },",
  "  {",
  "    name: '表内二',",
  "    files: {},",
  "  },",
  "]);",
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  for (const testCase of CASES) {",
  "    await suite.case(testCase.name, () => {});",
  "  }",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/**
 * 取名策略③:本地 wrapper 首参(零处内联 `.case(` 字面量 —— `smoke-report` 那一类形态)。
 * ⚠ wrapper 名取 `check`,与登记表里那一行登记的 `wrapper:"check"` 逐字一致 ——
 * 改一处必须同批改另一处,否则这一档会退化成「抽出 0 条」那一档(而那一档也判红,
 * **症状相同、真因不同**:诊断指向「case 被删了」,而真因是策略名写错了)。
 */
const WRAPPER_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(WRAPPER_DEMO)}";`,
  "/** 本地 wrapper:首参即档名(登记表按 wrapper-first-arg 取名)。 */",
  "async function check(name, body) {",
  "  await suite.case(name, body);",
  "}",
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  await check('w1', () => {});",
  "  await check('w2', () => {});",
  "  await check('w3', () => {});",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/** 取名策略④:基线取 `CASES.name`、变异实验取 `MUTATIONS.id`(与该在册行的登记策略同形)。 */
const MUTATION_ID_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(MUTATION_ID_DEMO)}";`,
  "const CASES = Object.freeze([",
  "  { name: '基线一', files: {} },",
  "  { name: '基线二', files: {} },",
  "]);",
  "const MUTATIONS = Object.freeze([",
  "  { id: 'mut-1', from: 'a' },",
  "  { id: 'mut-2', from: 'b' },",
  "]);",
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  for (const testCase of CASES) {",
  "    await suite.case(testCase.name, () => {});",
  "  }",
  "  for (const mutation of MUTATIONS) {",
  "    await suite.case(mutation.id, () => {});",
  "  }",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/**
 * 合成自测:**只建 suite、一次不调 `.case(`** —— 让「源侧」真的空。
 *
 * ⚠ 它只用来验**恒绿防护**:名册空 + 源侧空 ⇒ 两向差集恒空 ⇒ 本族本该「全绿」。
 * 少这一档,「空册判红」那条夹具验的就只是「空册被读到」,验不到真失效形态。
 * ⚠ 它必然同时命中 `gates-selftest-named-case` 那一族(import 了却不调 `.case(`),
 *   那是**预期**的:那一族的 info 与本族的 info 并存、互不掩盖,断言落在 `expectInfo` 上。
 */
const EMPTY_CASE_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(TABLE_NAME_DEMO)}";`,
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  void suite;",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/**
 * 取名策略⑤:用例表**就地内联**在 harness 调用的实参对象里(`cases: [...]`),
 * 而不是 `const X = [...]` 顶层表 —— `check-src-layout.selftest.mjs` 的形态。
 * ⚠ **合成正文必须与那一行登记的策略逐字同形**:该行除 `call-cases-field` 外还登记了
 * 三张顶层表,而本夹具**刻意不铺**它们(那三档抽出 0 条是合法的:表不存在 ⇒ 该档无产出)。
 * 多铺一张不在登记表里的表反而会让名册对不上(源有册无)。
 * ⚠ 下面那句 `await suite.case(...)` 是**夹具纪律①**要求的(不接契约就先被
 * `gates-selftest-named-case` 命中,两条 info 混在一起分不清红的是哪一族);
 * 该行**未登记** `inline-case` 策略 ⇒ 它不产任何源侧 case 名,名册不受影响。
 */
const INLINE_CASES_SELFTEST = [
  "// @ts-check",
  `import { createCaseSuite } from "${contractSpecifierFor(INLINE_CASES_DEMO)}";`,
  "export async function run() {",
  "  const suite = createCaseSuite();",
  "  await suite.case('契约接通用的真档', () => {});",
  "  await runSyntheticRootCases({",
  "    group: '内联组',",
  "    judge: () => [],",
  "    cases: [",
  "      { name: '内联一', files: {} },",
  "      { name: '内联二', files: {} },",
  "    ],",
  "    suite,",
  "  });",
  "  return { cases: suite.results };",
  "}",
  "",
].join("\n");

/** L11/L12 夹具的最小门禁清单项(只填判定要用的字段,其余由 makeGateRegistryCtx 补判红)。 */
const GATE = (id, extra = {}) => ({
  id,
  access: ACCESS_CHAIN,
  npmScripts: [`check:${id}`],
  modulePath: `gates/repo/check-${id}.mjs`,
  ...extra,
});

const CASES = [
  {
    name: "夹具基线(每层段都 import 本层主体、顶层目录集合恰好等于派生集∪{behavior,harness})→ 零判红",
    judgeOnly: true,
    extra: {},
    expect: null,
  },
  // ---- L4 ----
  {
    // L4 的核心夹具(缺了它整族判据就没有存在意义):一个本层主体都没 import 的段必须判红。
    // 「只检查不许 import 别层」的上界规则在这个段上会全绿 —— 它一条别层都没 import。
    name: "L4:段不 import 任何本层主体 → 判红并点名该段",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    expect: /test\/core\/runner-report\.test\.js → test-layer-self-hosted:.*没有 import 任何 core 层的主体/,
  },
  {
    // 反向锚点:判红的前提是「本层主体确实没被 import」。放行的那一格若判红,夹具里所有
    // 合法段都会被点名,负向夹具的红也就失去意义。
    name: "L4:段 import 本层的 dist/ 产物 → 判绿",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/ok.test.js`]: wellFormedSegment("core") },
    expect: null,
  },
  {
    // type-only 放行:类型引用不判红,否则等于逼人删掉类型标注。⚠ 该理由原文写的是
    // 「本仓产物不产 .d.ts,类型引用只能指 src/」—— 该前提已随 ADR-069 失效(现在类型也指
    // `dist/`),但**放行口径不变**:本条与「指 src/ 还是 dist/」无关。
    name: "L4:唯一的本层引用是 type-only 的 src/ 类型引用 → 判绿(不得判红)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/render-defaults.test.js`]: TYPE_ONLY_SRC_REF },
    expect: null,
  },
  {
    // 同上但换一层:证明 type-only 放行不是 core 整层放行。
    name: "L4:type-only 放行不是整层放行(另一个层的 type-only 引用仍不足以满足 L4)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/renderer/type-only.test.js`]: TYPE_ONLY_SRC_REF },
    expect: /test\/renderer\/type-only\.test\.js → test-layer-self-hosted:.*没有 import 任何 renderer 层的主体/,
  },
  {
    // 段 import 段:段是发现与隔离的单位,段间 import 让失败不可归因且让被 import 的段双跑。
    name: "L4:段 import 段 → 判红并点名被 import 的段",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/cli/pdf-launch.test.js`]:
        `import { resolveNode } from "./options.test.js";\n${wellFormedSegment("cli")}`,
    },
    expect: /test\/cli\/pdf-launch\.test\.js → test-layer-self-hosted:段 import 段\(test\/cli\/options\.test\.js\)/,
  },
  {
    // 非镜像目录下的段不参与 L4:behavior 段的定义就是横跨多层,current common/ 也不是层。
    // L4 若对它们生效,behavior 段一建立就恒红 —— 判据反了。
    // **两格都要断**:expect 钉 harness 下的段确实被 L8 抓到;expectAbsent 钉 behavior 下的段
    // **一条判红都没有**。只写 expect 的话,「L4 也把它判红了」这一格无人发现 ——
    // 变异实验实测:把作用域放宽到含 NON_MIRROR_TOP_DIRS 后,本夹具原本仍全绿。
    name: "L4:behavior/ 与 harness/ 下的段不参与 L4(判据只管镜像层目录)",
    judgeOnly: true,
    extra: {
      // behavior 下这个段**必须带合法 covers**:本夹具的断言是「L4/L5 不参与 behavior」,
      // 而 L6(T3 步 4c 建)对 behavior 段是生效的 —— 不给它 covers,L6 会判红,而那正是
      // 本夹具**不该**断的那一格。故这里给它一份齐备声明,把 L6 的影响从本夹具里摘干净。
      [`src/core/real.ts`]: "export const real = 1;\n",
      [`${TEST_REL}/behavior/cross.test.js`]: behaviorSegment(["src/core/real.ts"]),
      [`${TEST_REL}/harness/helper.test.js`]: NO_OWN_SUBJECT,
    },
    // harness 下有段是 L8 的判红(不是 L4),behavior 下的段两族都不管
    expect: /test\/harness\/helper\.test\.js → test-harness-not-segment/,
    expectAbsent: /test\/behavior\/cross\.test\.js/,
  },
  {
    // ---- L8 窄口子(T3 步 6):harness 是自指层,段必须声明且指向本层 ----
    //
    // 旧形态是「harness 下不得有 *.test.js」。下面四条把它换成「声明 + 指向本层」:
    // 三条 fail-closed 各一夹具 + 一条反向锚点。**每条断一个方向** —— 缺了「声明指向
    // 别处判红」那一格,声明通道就退化成万能后门(声明 `src/core/whatever.ts` 即可绕过 L4)。
    // ⚠ 底板必须同时造出 `test/harness/runner.js`(主体候选),否则「元素必须真实存在」
    //   那条判据会以「文件不存在」的形式误伤本组夹具。
    name: "L8:自指层的段未 export const covers → 判红并点名",
    judgeOnly: true,
    extra: {
      [`test/harness/runner.js`]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/decl-missing.test.js`]: [
        "// @ts-check",
        "/** 夹具段:自指层里未声明 covers。 */",
        "export const meta = { description: 'harness-decl-missing' };",
        "export async function run() { return 1; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(`${TEST_REL}/harness/decl-missing\\.test\\.js → test-harness-not-segment:.*未 export const covers`),
  },
  {
    name: "L8:自指层的段 covers 是空数组 → 判红(空声明与缺声明等效)",
    judgeOnly: true,
    extra: {
      [`test/harness/runner.js`]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/decl-empty.test.js`]: [
        "// @ts-check",
        "/** 夹具段:自指层里写了空 covers。 */",
        "export const covers = [];",
        "export const meta = { description: 'harness-decl-empty' };",
        "export async function run() { return 1; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(`${TEST_REL}/harness/decl-empty\\.test\\.js → test-harness-not-segment:.*covers 是空数组`),
  },
  {
    // 这条是窄口子的**牙齿**:声明了,但元素全指向别处 ⇒ 仍判红。
    // 少了它,「随便声明一个别的层」就成了绕过 L4 的后门,窄化等于没做。
    name: "L8:自指层的段 covers 指向本层之外 → 判红(声明通道不是万能后门)",
    judgeOnly: true,
    extra: {
      ["src/core/real.ts"]: "export const real = 1;\n",
      [`test/harness/runner.js`]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/decl-foreign.test.js`]: [
        "// @ts-check",
        "/** 夹具段:自指层里声明的元素全指向别处。 */",
        'export const covers = ["src/core/real.ts"];',
        "export const meta = { description: 'harness-decl-foreign' };",
        "export async function run() { return 1; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(`${TEST_REL}/harness/decl-foreign\\.test\\.js → test-harness-not-segment:.*没有元素指向本层`),
  },
  {
    // 反向锚点:声明齐备且确有元素指向本层 ⇒ L8 与 L4 双绿。
    // 缺它的话,上面三条可能只是「恒红」—— 没人能证明合法形态真的能过。
    // 它同时钉住 L4 的「harness 主体根」:元素落在 `test/harness/**` 下时 L4 必须认它
    // 为本层主体(主体根 = `test/harness/`,而不是顶层树 `harness/`)。
    name: "L8/L4:自指层的段声明指向 test/harness/** → 两族皆绿(harness 主体根生效)",
    judgeOnly: true,
    extra: {
      [`test/harness/runner.js`]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/decl-ok.test.js`]: [
        "// @ts-check",
        "/** 夹具段:自指层里声明指向本层主体。 */",
        'export const covers = ["test/harness/runner.js"];',
        "export const meta = { description: 'harness-decl-ok' };",
        "export async function run() { return 1; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: new RegExp(`${TEST_REL}/harness/decl-ok\\.test\\.js → (test-harness-not-segment|test-layer-self-hosted)`),
  },
  {
    // L4 主体根的**同名不同根**反向锚点:自指层的段若声明的是顶层树 `gates/`,L4 必须判红 ——
    // 证明 rootsOf 的 harness 分支指向 `test/harness/` 而非 `harness/`。
    // 去掉那个分支时这一条会全绿(元素 `gates/...` 恰好落在默认分支算出的根下)。
    name: "L4:自指层的段声明指向顶层 gates/ 树(同名不同根)→ 判红",
    judgeOnly: true,
    extra: {
      ["gates/repo/real.mjs"]: "export const real = 1;\n",
      [`test/harness/runner.js`]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/decl-toptree.test.js`]: [
        "// @ts-check",
        "/** 夹具段:自指层里声明指向同名顶层树。 */",
        'export const covers = ["gates/repo/real.mjs"];',
        "export const meta = { description: 'harness-decl-toptree' };",
        "export async function run() { return 1; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(`${TEST_REL}/harness/decl-toptree\\.test\\.js → (test-harness-not-segment|test-layer-self-hosted)`),
  },
  // ---- 抽取层:extractImports 逐形态直测 ----
  // 为什么需要这一档(而上面各族的行为夹具不够):`import("…")` 的两种形态靠「在抹注释后的
  // code 里那个下标是否仍以 import( 开头」区分,而**两半各自都可能被另一条路径兜住** ——
  // 实测:把「注释里那个下标跳过」这条守卫去掉,运行期动态 import 仍会被 code 那半抓到,
  // 于是 15 条行为夹具**全部照旧全绿**(变异实验实测 0 条失败)。守卫去掉的后果不是漏判,
  // 而是同一条 import 被收两遍(值 + type-only 各一),表现为 l5Hits 计数翻倍。故直接对
  // 抽取结果断言条数与 typeOnly 标记,把这条守卫钉住。
  {
    name: "extractImports:注释里的 import(\"…\") 恰好收一条且为 type-only",
    unit: true,
    text: '/** @typedef {import("../../src/core/i18n.js").ConvertWarning} Warning */\n'
      + '/** @param {Warning} w @returns {Warning} */\nexport function run(w) { return w; }\n',
    file: "test/core/render-defaults.test.js",
    expectRefs: [{ spec: "../../src/core/i18n.js", typeOnly: true, resolved: "src/core/i18n.js" }],
  },
  {
    // 与上一条成对:同一种字面形态在**代码**里是运行期动态 import,恰好收一条且为值。
    // 两格缺一,「按字面形态判定」的实现(不做注释/代码区分)就有一边无人发现。
    name: "extractImports:代码里的 import(\"…\") 恰好收一条且为值引用",
    unit: true,
    text: 'export async function run() {\n  return import("../../dist/renderer/state/pure.js");\n}\n',
    file: "test/core/dynamic.test.js",
    expectRefs: [{ spec: "../../dist/renderer/state/pure.js", typeOnly: false, resolved: "dist/renderer/state/pure.js" }],
  },
  {
    // 一次出现两种形态 ⇒ 两条、各自形态正确(不因其中一条是注释就放过另一条)。
    name: "extractImports:同文件内注释与代码各一处 import(\"…\") ⇒ 两条且标记不同",
    unit: true,
    text: '/** @typedef {import("../../src/core/i18n.js").ConvertWarning} Warning */\n'
      + 'export async function run() { return import("../../dist/core/subject.js"); }\n',
    file: "test/core/both.test.js",
    expectRefs: [
      { spec: "../../dist/core/subject.js", typeOnly: false, resolved: "dist/core/subject.js" },
      { spec: "../../src/core/i18n.js", typeOnly: true, resolved: "src/core/i18n.js" },
    ],
  },
  {
    // 反向锚点:裸包名不解析成仓库相对路径(resolved 为 null),L4/L5 只按解析结果判,
    // 故裸包名既不满足 L4 也不构成跨层 —— 这条把它钉住。
    name: "extractImports:裸包名与 node: 内建不产生 resolved(不参与 L4/L5)",
    unit: true,
    text: 'import fs from "node:fs";\nimport hljs from "highlight.js";\nexport const x = [fs, hljs];\n',
    file: "test/core/bare.test.js",
    expectRefs: [
      { spec: "node:fs", typeOnly: false },
      { spec: "highlight.js", typeOnly: false },
    ],
  },
  {
    // 副作用导入 `import 'spec'`(无 from 子句)。它是一等引用:只看 `from` 形态的实现会
    // 漏掉它,而漏掉的形态恰好是「加载一段带副作用的模块」—— 段里靠它把 dist 模块的
    // 单例副作用装上。去掉 SIDE_EFFECT_RE 这一行后本夹具立刻翻脸。
    name: "extractImports:副作用导入 import \"…\" 也被收(不只 from 形态)",
    unit: true,
    text: 'import "../../dist/core/subject.js";\nexport const x = 1;\n',
    file: "test/core/side-effect.test.js",
    expectRefs: [{ spec: "../../dist/core/subject.js", typeOnly: false, resolved: "dist/core/subject.js" }],
  },
  {
    // 文档串里的 import 形状不算引用:inString 守卫去掉后本夹具立刻翻脸(多收一条)。
    // 这条守卫的必要性同 check-import-boundary 的 insideString —— 段里常有「示范这段该怎么
    // import」的文档串,不遮罩就会把示例当真实依赖。
    //
    // ⚠ 串的引号选**单引号**、内部用双引号(写成 `"…import(\\"…\\")…"` 就废了):双引号串里
    // 那个形状带反斜杠转义,而抽取用的 `\bimport\(\s*['"]` 在 `import(\` 处就匹配不上 ——
    // 夹具会「因为压根没被匹配」而判绿,看上去通过而实际上没验到 inString 守卫(变异实验
    // 实测:去掉守卫后本夹具仍 0 条失败)。反向的转义由同族的 FROM_RE 形态覆盖,不在此重复。
    name: "extractImports:字符串字面量里的 import(\"…\") 形状不算引用",
    unit: true,
    text: "const howTo = '写成 import(\"../../dist/core/x.js\") 即可';\nexport const y = howTo;\n",
    file: "test/core/doc-string.test.js",
    expectRefs: [],
  },
  {
    // 与上一条同款,但走 **from 形态**:段里常写「本段 import X from \"…\" 即可」这类说明串。
    // 三条 matchAll 各自的 inString 守卫是**三份独立代码**(变异实验实测:去掉 from 那一条
    // 的守卫,另两条夹具仍全绿),故三份各需一条夹具钉住,不能只测其中一份。
    //
    // ⚠ 串必须是**模板串**(反引号)且**跨行**:两个条件缺一,这条夹具就变成「因为压根没被
    // 匹配」而判绿,看上去通过而实际没验到守卫(变异实验实测:去掉守卫后仍 0 条失败)。
    //   ① FROM_RE 以 `(^|\n)[ \t]*` 作**行首锚**,单行串里那个 `import` 不在行首 ⇒ 不匹配;
    //   ② 不能用跨行的单/双引号串 —— JS 语法禁止,而 `lexSource` 的 `skipQuoted` 也**刻意**
    //      在引号串里遇到换行就收手(shared/copy-closure.js:「未闭合的字符串:不吞掉换行,
    //      免得后面全被抹掉」),于是那一行之后的 inString 掩码全部失效,守卫反而看不见它。
    //   模板串两条件都满足:可跨行,且 `skipQuoted` 对它不因换行收手 ⇒ inString 掩码覆盖全串。
    name: "extractImports:模板串里的 from 形态不算引用(跨行 + inString 掩码)",
    unit: true,
    text: "const howTo = `写法是\nimport { convert } from \"../../dist/core/convert.js\"\n这样`;\nexport const z = howTo;\n",
    file: "test/core/doc-from.test.js",
    expectRefs: [],
  },
  {
    // `import type … from` / 行内 `type` 说明符:isTypeOnlyClause 的两个入口。
    // 变异实验实测:把它换成恒 false 后,只测 JSDoc 形态的夹具**全部照旧全绿** ——
    // 因为 JSDoc 的 `import("…")` 走的是另一条路(注释分支自带 typeOnly=true),不经过它。
    name: "extractImports:import type … from 判为 type-only",
    unit: true,
    text: 'import type { Options } from "../../src/core/types.js";\nexport const q = 1;\n',
    file: "test/core/type-import.test.js",
    expectRefs: [{ spec: "../../src/core/types.js", typeOnly: true, resolved: "src/core/types.js" }],
  },
  {
    // 行内 `type` 说明符(`import { type A, b } from`):含值绑定即整体为运行时,
    // 与 isTypeOnlyClause 的保守判红同款(判据对象是运行期依赖图)。
    name: "extractImports:行内 type 说明符与值绑定混用时整体为值引用",
    unit: true,
    text: 'import { type A, b } from "../../src/core/mixed.js";\nexport const r = b;\n',
    file: "test/core/mixed-type.test.js",
    expectRefs: [{ spec: "../../src/core/mixed.js", typeOnly: false, resolved: "src/core/mixed.js" }],
  },
  // ---- 扫描面塌缩的两个极端档:目录读不到 ----
  {
    // 「读不到 test/ 就按空集通过」是最坏的失效形态(门禁什么也没查而输出是 exit 0)。
    // 本夹具用一个**不存在的根**:listDir 必抛,而判据必须把它报成 scan-surface-missing
    // 而不是静默收零段。若把 collectTestFiles 的调用包上 try/catch 回落空数组,本条立刻变绿
    // —— 变异实验实测这就是那种缝。
    name: "扫描面读不到(根不存在)→ 判红 scan-surface-missing,不得静默按空集通过",
    judgeOnly: true,
    extra: {},
    missingRoot: true,
    expect: /scan-surface-missing:读不到 test\/ 子树/,
  },
  {
    // 另一侧输入缺失:根存在且有 test/,但**没有 src/** ⇒ 镜像源派生不出来。
    // 此时若静默回落空层集,L7 会把 test/ 下**每个**顶层目录都判成「多一个」——
    // 恒红且零信息量(读者看不出是「src/ 没了」还是「真多了六个目录」)。故判红并点明输入缺失。
    name: "src/ 缺失(镜像源派生不出来)→ 判红 scan-surface-missing,不得静默回落空层集",
    judgeOnly: true,
    extra: {},
    skipSrc: true,
    expect: /scan-surface-missing:读不到 src\/ 子树/,
  },
  // ---- L5 ----
  {
    name: "L5:同层 import → 不命中(同层自由)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/same-layer.test.js`]: wellFormedSegment("core") },
    expectInfo: null,
    expect: null,
  },
  {
    name: "L5:跨层 import → 命中且进 problems(转 fail-closed),诊断含「搬去 test/behavior/ 并写 covers」指引",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    // expectInfo: null —— **与 expect 互不替代**:本族已转 fail-closed,诊断只该出现在 problems;
    // 若实现仍走 info,expect 会红而这一格是第二道(反之亦然)。两格都在才证明「只进 problems」。
    expect: /test\/core\/heading-scale\.test\.js → test-layer-cross-import:core 层的段 import 了 renderer 层的主体[\s\S]*搬进 test\/behavior\/ 并在段内写 covers/,
    expectInfo: null,
  },
  {
    // 「代码里的 import("x") 是**运行期**动态 import,注释里的才是类型引用」这格的反向锚点。
    // 缺了它,把两者混为一谈(例如对原文一律再收一遍 type-only)无人发现:那种实现会让
    // 运行期跨层 import 同时拿到一条 typeOnly 记录,而 L5 恰好跳过 type-only ⇒ 跨层漏判。
    // 本条的跨层引用**只有**这一处运行期动态 import,故它必须命中。
    name: "L5:运行期动态 import(\"…\")的跨层引用必须命中(不得被当成注释里的类型引用)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/dynamic-cross.test.js`]:
        'import { subject } from "../../dist/core/subject.js";\n'
        + 'export const meta = { description: "dynamic-cross" };\n'
        + 'import { createCaseSuite } from "../harness/case.js";\n'
        + "export async function run() {\n"
        + "  const suite = createCaseSuite();\n"
        + '  await suite.case("dynamic cross", () => {});\n'
        + '  const other = await import("../../dist/renderer/settings/settings-logic.js");\n'
        + "  return { cases: suite.results, subject, other };\n}\n",
    },
    expect: /test\/core\/dynamic-cross\.test\.js → test-layer-cross-import:core 层的段 import 了 renderer 层的主体/,
    expectInfo: null,
  },
  {
    // L5 转 fail-closed 的核心夹具:跨层命中**进 problems**,info 通道一条都没有。
    // 它与上面两条合起来才是完整的「转正」证明:那两条钉诊断文案,这条钉**通道归属**。
    // **原地由「恒报告」那一条反转而来**(不是删掉换一条新的):被反转的那一格一旦丢了,
    // 「命中到底进哪一档」就只剩文案在钉 —— 而文案两个通道都会带着走,那种实现照样全绿。
    name: "L5:跨层命中进 problems 且不进 info(转判红)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    expect: /test-layer-cross-import/,
    expectInfo: null,
  },
  {
    // type-only 的跨层引用不算跨层:编译期擦除,与 check-import-boundary 的 allowTypeOnly 同款取舍。
    // 段本身仍 import 本层主体(否则先被 L4 判红,见 crossLayerSegment 的注释),跨层那一处
    // **只有** type-only 形态 —— 去掉 isTypeOnlyClause 的豁免后本夹具立刻翻脸。
    name: "L5:type-only 的跨层引用不算跨层(不得命中)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/main/temp-markdown.test.js`]:
        'import { subject } from "../../dist/main/persist/ui-state.js";\n'
        + 'import { createCaseSuite } from "../harness/case.js";\n'
        + '/** @typedef {import("../../src/core/ipc-contract.js").RecentFile} RecentFile */\n'
        + 'export const meta = { description: "type-only-cross" };\n'
        + "export async function run(f) { const suite = createCaseSuite();"
        + ' await suite.case("type-only cross", () => {}); return { cases: suite.results, subject, f }; }\n',
    },
    expectInfo: null,
    expect: null,
  },
  // ---- L7(report-only 档:命中进 info,结构上不计退出码)----
  // ⚠ 下面这一整族改的是**断言读哪条通道**:L7 在 CRITERIA 里带 `pending: true`,故命中走 info。
  // 每条都同时钉「info 里有」与「problems 里没有」(`expect: null`),
  // 只钉一侧的话「两通道都有」或「两通道都空」的实现能混过去。
  {
    name: "L7:多一个杂物顶层目录 → 报告并点名(info 通道,不计退出码)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT },
    expectInfo: /test\/misc → test-top-dirs-exact:test\/ 顶层多出目录「misc\/」/,
    expect: null,
  },
  {
    name: "L7:少一个镜像源层目录 → 报告并点名(info 通道)",
    judgeOnly: true,
    // 判据本体不删目录(夹具只经 writeUnder 加文件),故少的那一层用「base 里去掉」表达:
    // 这里改为断言「派生集里 src/ 少一层时,该层被判缺」—— 用只读派生函数验更直接。
    expectInfo: /test-top-dirs-exact/,
    deriveMissing: true,
  },
  {
    name: "L7:恰好等于派生集∪{behavior,harness} → 两通道皆空(反向锚点)",
    judgeOnly: true,
    extra: {},
    expect: null,
    // ⚠ 本条转 report-only 后**必须补这一格**:否则 `expect: null` 会「因为错误的原因绿」——
    // problems 为空不再是因为集合相等,而是因为 L7 的命中根本不进 problems。
    expectInfo: null,
  },
  {
    // 「是派生不是登记」的唯一机械证据:src/ 多一个子目录 ⇒ 期望集合跟着多一层。
    // 若实现改成读一张写死的表,这一条立刻判红(表里没有新层)。
    name: "L7:src/ 新增子目录后,顶层集合要求跟着变(证明是派生不是登记)",
    judgeOnly: true,
    extra: {
      "src/pipeline/.gitkeep": "",
      [`${TEST_REL}/core/pad-new.test.js`]: wellFormedSegment("core"),
    },
    expectInfo: /test\/pipeline → test-top-dirs-exact:test\/ 顶层缺目录「pipeline\/」/,
    expect: null,
  },
  {
    // 上一条的对侧:新层一旦建出自己的段目录,集合就平了。少这一格则「判缺」可能是因为
    // 别的理由(比如只数了目录没看层),而不是真的在核对集合。
    name: "L7:src/ 新增子目录且建出对应段目录 → 两通道皆空(缺的那一档确实因建齐而消失)",
    judgeOnly: true,
    extra: {
      "src/pipeline/.gitkeep": "",
      [`${TEST_REL}/pipeline/parse.test.js`]: wellFormedSegment("core").replaceAll("../../dist/core/", "../../dist/pipeline/"),
      // ⚠ C1 档一:这一段 import 的产物是 `dist/pipeline/subject.js`,其镜像源
      // `src/pipeline/subject.ts` **必须在** —— 少了它本夹具会先被 C1 判红,而它要验的是 L7。
      ["src/pipeline/subject.ts"]: "export const subject = 1;\n",
    },
    expect: null,
    // ⚠ 同上:转 report-only 后必须补,否则这条会因「命中不进 problems」而继续绿。
    expectInfo: null,
  },
  {
    // 反向锚点:顶层目录集合相等只数**目录**。test/acceptance.mjs 是段入口(已登记在注册表
    // TOOLCHAIN_FILES),把它计入即恒红 —— 与 check-import-boundary 的 analyzeSrcTopLayers 同取舍。
    name: "L7:只数目录(顶层的 acceptance.mjs 两通道都不出)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/acceptance.mjs`]: "export const meta = {};\n" },
    expect: null,
    // ⚠ 同上:这一格原本是「expect: null」的三条之一,转 report-only 后不补就会失去牙齿。
    expectInfo: null,
  },
  {
    // 判据 id 自身也要钉住。**为什么单独一条**:上面那两条 L7 夹具的期望里写了
    // `test-top-dirs-exact`,但它们匹配的是**整行**,而把 id 改名的那次变异实测 0 条失败 ——
    // 因为 L7 夹具的正文靠「顶层多出/缺目录」那半截中文锚定,id 在同一行里被顺带带过,
    // 改成另一个词仍然匹配(前半截没变)。故此处只断言 id 本身。
    name: "L7 判据 id 逐字为 test-top-dirs-exact",
    judgeOnly: true,
    extra: { [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT },
    expectInfo: /→ test-top-dirs-exact:/,
    expect: null,
  },
  // ---- L8 ----
  {
    // 同上:L8 的判据 id。L8 只有一条行为夹具,而那条期望里 id 与中文锚定在一起,
    // 改名后中文部分仍匹配 ⇒ id 无牙。这里单独断 id。
    name: "L8 判据 id 逐字为 test-harness-not-segment",
    judgeOnly: true,
    extra: { [`${TEST_REL}/harness/helper.test.js`]: NO_OWN_SUBJECT },
    expect: /→ test-harness-not-segment:/,
  },
  {
    name: "L8:test/harness/ 下出现 *.test.js → 判红并点名",
    judgeOnly: true,
    extra: { [`${TEST_REL}/harness/helper.test.js`]: NO_OWN_SUBJECT },
    expect: /test\/harness\/helper\.test\.js → test-harness-not-segment/,
  },
  {
    name: "L8:test/harness/ 下只有非段文件 → 判绿",
    judgeOnly: true,
    extra: { [`${TEST_REL}/harness/paths.js`]: "export const ROOT = '/x';\n" },
    expect: null,
  },
  {
    // 防「扫不到东西所以恒绿」:walker 整体失效时五族判据都会「全绿」,而恒绿是纯文本门禁
    // 最坏的失效形态 —— 没人会去看一个总是 exit 0 的脚本。
    name: "扫描面塌缩(段数掉到下限以下)→ 判红",
    judgeOnly: true,
    extra: {},
    minScannedFiles: BASE_PAD + 1000,
    expect: /scan-surface-collapsed:.*只扫到 \d+ 个段文件\(下限 \d+\)/,
  },
  // ---- L6:behavior 段的 covers 声明 ----
  // 三条 fail-closed 各有夹具。**第三条(元素必须真实存在)是这条判据唯一挡得住
  // 「随便写个字符串就过」的判据** —— 只钉前两条的话,判据退化成「看你写没写」,
  // 而「写了」几乎不携带信息(ADR-062:76 的原话:这是关键)。
  {
    name: "L6:behavior 段未 export const covers → 判红并点名",
    judgeOnly: true,
    extra: { [`${TEST_REL}/behavior/decl.test.js`]: behaviorSegment(null) },
    expect: /test\/behavior\/decl\.test\.js → behavior-covers-declared:behavior 段未 export const covers/,
  },
  {
    name: "L6:covers 是空数组 → 判红(空声明与缺声明等效,不能只判后者)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/behavior/empty.test.js`]: behaviorSegment([]) },
    expect: /test\/behavior\/empty\.test\.js → behavior-covers-declared:covers 是空数组/,
  },
  {
    // 有牙齿的那一条:元素指向磁盘上不存在的文件。
    name: "L6:covers 元素在磁盘上不存在 → 判红(否则「随便写个字符串」就能过)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/behavior/ghost.test.js`]: behaviorSegment(["src/core/nope.ts"]) },
    expect: /test\/behavior\/ghost\.test\.js → behavior-covers-declared:covers 元素「src\/core\/nope\.ts」在磁盘上不存在/,
  },
  {
    name: "L6:covers 元素逐个核对(多个里有一个不存在 → 点名那一个)",
    judgeOnly: true,
    extra: {
      [`src/core/real.ts`]: "export const real = 1;\n",
      [`${TEST_REL}/behavior/partial.test.js`]: behaviorSegment(["src/core/real.ts", "src/core/ghost.ts"]),
    },
    expect: /covers 元素「src\/core\/ghost\.ts」在磁盘上不存在/,
  },
  {
    // 判绿方向:声明齐备且元素真实存在 → 零判红。缺它的话,前三条可能只是「恒红」。
    name: "L6:behavior 段 covers 非空且元素都存在 → 判绿",
    judgeOnly: true,
    extra: {
      [`src/core/real.ts`]: "export const real = 1;\n",
      // covers 元素不限定在 src/(见判据文件头理由 ③):非 src 的主体也是合法覆盖面,
      // 故这里刻意用一个 shared/ 下的元素,顺带证明「不限目录前缀」这条不是写在注释里的空话。
      [`shared/paths.js`]: "export const ROOT = '/x';\n",
      [`${TEST_REL}/behavior/ok.test.js`]: behaviorSegment(["src/core/real.ts", "shared/paths.js"]),
    },
    expect: null,
  },
  {
    // covers 扩展到正常段目录后的那一格:段没有本层 import,但声明自己测本层
    // ⇒ L4 的声明通道生效、判绿。**这格是 ADR-062:86 那条「不改 L4 判据、改给声明通道」
    // 的存在证明** —— 去掉它就等于把机制建了却不验证它真能解决那 29 个段的问题。
    name: "covers 扩展:零本层 import 的段声明自己测本层 → L4 判绿(声明通道)",
    judgeOnly: true,
    extra: {
      [`src/core/real.ts`]: "export const real = 1;\n",
      [`${TEST_REL}/core/declared.test.js`]: behaviorSegment(["src/core/real.ts"]),
    },
    expect: null,
    expectAbsent: /test\/core\/declared\.test\.js → test-layer-self-hosted/,
  },
  {
    // 声明通道的边界:声明的是**别层**就不算本层主体 —— 否则「随便声明一个别的层」
    // 就成了绕过 L4 的后门,那与不建通道无异。
    name: "covers 扩展:声明的元素不落在本层主体根 → L4 仍判红(不是万能后门)",
    judgeOnly: true,
    extra: {
      [`src/main/real.ts`]: "export const real = 1;\n",
      [`${TEST_REL}/core/other-layer.test.js`]: behaviorSegment(["src/main/real.ts"]),
    },
    expect: /test\/core\/other-layer\.test\.js → test-layer-self-hosted/,
  },
  {
    // 正常段目录写了 covers 也要受约束:写了空数组 / 指向不存在,都判红。
    // 不钉这一格的话,「正常段目录的 covers 是可选的」会被读成「随便写」。
    name: "L6 扩展:正常段目录写了空 covers → 判红(声明通道不接受空声明)",
    judgeOnly: true,
    extra: {
      [`src/core/real.ts`]: "export const real = 1;\n",
      [`${TEST_REL}/core/empty-decl.test.js`]: behaviorSegment([]),
    },
    expect: /test\/core\/empty-decl\.test\.js → behavior-covers-declared:covers 是空数组/,
  },
  // ---- REQ-187 C1:TS 段口径两档(每档:负向夹具 + 反向锚点 + 口径钉住)----
  //
  // ⚠ **底板已按纪律 ⑤ 加了一格**:`src/<层>/subject.ts` 必须存在,否则底板段 import 的
  // `dist/<层>/subject.js` 会被 C1 档一判红,每条夹具都先被它盖住。
  {
    // 档一负向:产物 `dist/core/orphan.js` 的镜像源三个候选全不存在 ⇒ 判红。
    // 这条抓的是「段 import 了一个 src 已删 / 从未存在的产物」——`dist/` 是 gitignored 的,
    // 所以判据**按构建产物路径反推源路径**再问源在不在磁盘上,而**不是**问产物在不在版本控制里
    // (那对任何构建产物恒为否 ⇒ 判据恒红)。
    name: "C1 档一:被测 import 落在 dist/** 而镜像源全部不存在 → 判红(按产物路径反推源,不看 git 跟踪)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/orphan.test.js`]: [
        "// @ts-check",
        "/** 夹具段:import 了一个镜像源不存在的编译产物。 */",
        'import { subject } from "../../dist/core/orphan.js";',
        "export const meta = { description: 'c1-orphan' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: /test\/core\/orphan\.test\.js → test-dist-artifact-source-mirror:被测 import 落在编译产物 dist\/core\/orphan\.js,但它的镜像源文件全部不存在\(src\/core\/orphan\.ts 或 src\/core\/orphan\.tsx 或 src\/core\/orphan\.js\)/,
  },
  {
    // 档一反向锚点:同样的段,但镜像源造齐 ⇒ 零判红。缺它的话上一条可能只是「恒红」。
    name: "C1 档一:镜像源真实存在 → 判绿(反向锚点:证明上一条的红来自缺源本身)",
    judgeOnly: true,
    extra: {
      ["src/core/present.ts"]: "export const subject = 1;\n",
      [`${TEST_REL}/core/present.test.js`]: [
        "// @ts-check",
        "/** 夹具段:import 的产物有真实镜像源。 */",
        'import { subject } from "../../dist/core/present.js";',
        "export const meta = { description: 'c1-present' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: /test-dist-artifact-source-mirror/,
  },
  {
    // `.js` 源那一档:`allowJs` 形态(src/renderer/lang-bootstrap.js 是仓内先例)。
    // 只认 `.ts` 的实现会把这种合法产物判红 ⇒ 少了它,「镜像源候选是一组」这个决定无人守。
    name: "C1 档一:产物来自 .js 源(allowJs 形态)也算有源,不得判红",
    judgeOnly: true,
    extra: {
      ["src/core/from-js-source.js"]: "export const subject = 1;\n",
      [`${TEST_REL}/core/from-js-source.test.js`]: [
        "// @ts-check",
        "/** 夹具段:产物镜像的是 .js 源而非 .ts 源。 */",
        'import { subject } from "../../dist/core/from-js-source.js";',
        "export const meta = { description: 'c1-from-js' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: null,
  },
  {
    // 口径钉住(反向):**只有 `dist/**` 的值引用算被测 import**。
    // `test/harness/**`(测试框架自身)、裸包名、`node:` 内建、`src/**` 的值引用
    // 都不算 —— 把它们算进分母,C1 会退化成「谁引用助手最多 / 类型标注写对没有」的检查。
    // 这条同时钉住「type-only 的 `dist/**` 引用**也不算**」(编译期擦除,不是取得手段)。
    name: "C1 口径:只有 dist/** 的值引用算被测 import(harness / 裸包名 / node: / src 值引用 / type-only 都不算)",
    judgeOnly: true,
    extra: {
      // 这四条若被误算成被测 import,它们背后都没有 src/** 源 ⇒ C1 档一会判红
      ["test/harness/no-source-helper.js"]: "export const helper = 1;\n",
      [`${TEST_REL}/core/subject.test.js`]: [
        "// @ts-check",
        "/** 夹具段:除本层产物外,只引用助手 / 裸包名 / node: / src 值引用 / dist 的 type-only 引用。 */",
        'import { helper } from "../harness/no-source-helper.js";',
        'import jszip from "jszip";',
        'import fs from "node:fs";',
        'import { subject } from "../../dist/core/subject.js";',
        '/** @typedef {import("../../dist/core/typeonly-absent.js").T} T */',
        "export const meta = { description: 'c1-scope' };",
        "/** @param {T} v @returns {unknown} */",
        "export function run(v) { return [subject, helper, jszip, fs, v]; }",
        "",
      ].join("\n"),
    },
    // `dist/core/typeonly-absent.js` 的镜像源**刻意不存在** —— 若 type-only 被算成被测 import,
    // 这一条立刻红。它是「type-only 不算」这个口径的唯一机械证据。
    expect: null,
    expectAbsent: /test-dist-artifact-source-mirror/,
  },
  {
    // 档二负向:段路径镜像了真实存在的源文件,却没 import 同名产物 ⇒ 判红。
    // 这一族抓的是「段自称在测 X、实际测的是 Y」——段名与被测对象脱钩。
    name: "C1 档二:段路径镜像真实源文件却未落在同名编译产物上 → 判红(段名与被测对象脱钩)",
    judgeOnly: true,
    extra: {
      ["src/core/decoupled.ts"]: "export const decoupled = 1;\n",
      // 段 import 的是本层的**另一个**产物(有源 ⇒ 档一不红),唯独不碰同名产物。
      [`${TEST_REL}/core/decoupled.test.js`]: [
        "// @ts-check",
        "/** 夹具段:镜像 src/core/decoupled.ts,却只 import 别的产物。 */",
        'import { subject } from "../../dist/core/subject.js";',
        "export const meta = { description: 'c1-decoupled' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: /test\/core\/decoupled\.test\.js → test-segment-mirror-same-name:段路径镜像了真实存在的源文件 src\/core\/decoupled\.ts,但它没有任何被测 import 落在同名编译产物 dist\/core\/decoupled\.js 上/,
  },
  {
    // 档二反向锚点:镜像 + 落在同名产物 ⇒ 零判红。
    name: "C1 档二:镜像段 import 了同名编译产物 → 判绿(反向锚点:证明上一条的红来自脱钩本身)",
    judgeOnly: true,
    extra: {
      ["src/core/coupled.ts"]: "export const coupled = 1;\n",
      [`${TEST_REL}/core/coupled.test.js`]: [
        "// @ts-check",
        "/** 夹具段:镜像 src/core/coupled.ts 且 import 它的同名产物。 */",
        'import { coupled } from "../../dist/core/coupled.js";',
        "export const meta = { description: 'c1-coupled' };",
        "export async function run() { return coupled; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: /test-segment-mirror-same-name/,
  },
  {
    // 档二的分母**不是**「住在 src 层目录」,而是「段路径逐段对得上真实源文件」。
    // 底板 136 段里只有个位数镜像源 —— 若实现把分母放宽成「住在 src 层目录」,
    // 这一条(段住在 `core/` 但段名不对应任何源文件)会**跟着红**,而它本该绿。
    // 变异实验实测:把 `mirroredSourceOf` 换成恒返回对象时,本夹具立刻红。
    name: "C1 档二分母:段住在 src 层目录但段名不对应任何源文件 → 不参与档二(分母是真镜像,不是层归属)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/name-unrelated.test.js`]: wellFormedSegment("core") },
    expect: null,
    expectAbsent: /test-segment-mirror-same-name/,
  },
  {
    // 档二的镜像是**相对路径逐段对应**,不是 basename 匹配。这一条钉住跨层巧合同名:
    // `test/core/preprocess.test.js` 与 `src/convert/preprocess.ts` 同 basename 但不同层目录,
    // basename 口径会把它认成镜像 → 要求它 import `dist/core/preprocess.js`。
    name: "C1 档二:同名但跨层的源文件不算镜像(逐段对应,不是 basename 匹配)",
    judgeOnly: true,
    extra: {
      ["src/convert/preprocess.ts"]: "export const pre = 1;\n",
      // 段住在 test/core/ 而同名源在 src/convert/ ⇒ 不构成镜像 ⇒ 档二不适用。
      [`${TEST_REL}/core/preprocess.test.js`]: [
        "// @ts-check",
        "/** 夹具段:与 src/convert/preprocess.ts 同 basename 但不同层目录。 */",
        'import { subject } from "../../dist/core/subject.js";',
        "export const meta = { description: 'c1-crosslayer-same-name' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: /test-segment-mirror-same-name/,
  },
  // ---- REQ-187 C3:L4 第三档(段住在非门禁层却 import 门禁树)----
  //
  // ⚠ 作用域与 L4/L5 差一档:**`test/gates/**` 的段不参与 C3**(门禁段 import 门禁树是
  // L11 档 1b 的载体形态)。漏掉这一档的实测后果是 C3 在真实仓库上判红 31 项。
  //
  // ⚠ **C3 整段还受 `indexInRoot` 约束**(见门禁本体里同名注释:豁免表描述真实仓库,而
  // `ctx` 以求值根为准 ⇒ 合成根上「stale」是范畴错误)。故本族每一条夹具的 `extra` 都
  // 铺上 `C3_TREE_IDENTITY`(定义见 `behaviorSegment` 之后)—— 那是「本根就是这张表描述的
  // 那棵树」的判据,与 L11b 那几格同款。缺了它,本族每一条夹具都会**零命中**
  // (症状是「C3 全绿」,看不出是作用域没开)。
  {
    // C3 负向:段住在 test/shared/ 却 import gates/ 树 ⇒ 判红。
    // 它是本族存在的**全部意义**:L4 的两档(零本层主体 / 段 import 段)都不覆盖这一形态 ——
    // 这段 import 了同层的 geometry-core,过「零本层主体」;它 import 的又不是段,过「段 import 段」。
    name: "C3:段住在非门禁层却 import 门禁树 → 判红(L4 两档都不覆盖这一形态)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      // 本层主体齐备 ⇒ L4 第一档不红;被 import 的不是段 ⇒ L4 第二档不红。
      ["shared/subject.mjs"]: "export const subject = 1;\n",
      ["gates/geometry/geometry/driver.mjs"]: "export const LIVENESS_PATHS = [];\n",
      [`${TEST_REL}/shared/borrowed.test.js`]: [
        "// @ts-check",
        "/** 夹具段:住在 shared/ 却 import 门禁树的模块。 */",
        'import { subject } from "../../shared/subject.mjs";',
        'import { LIVENESS_PATHS } from "../../gates/geometry/geometry/driver.mjs";',
        "export const meta = { description: 'c3-borrowed' };",
        "export async function run() { return [subject, LIVENESS_PATHS]; }",
        "",
      ].join("\n"),
    },
    expect: /test\/shared\/borrowed\.test\.js → test-layer-gate-subject:shared 层的段 import 了门禁树的模块\(gates\/geometry\/geometry\/driver\.mjs\)/,
  },
  {
    // C3 的**核心命题**:L5 豁免表**不能**豁免 C3。这一条同时断两族判红 ——
    // 段既过了 L5(已按「只提供规格」登记)仍被 C3 判红。
    // 少了它,并表的实现(把 C3 也挂到 L5 那张表上)会全绿,而那一族在真实仓库上
    // 就恒为零命中 —— 与「没建这一族」不可区分。
    name: "C3:L5 豁免表已登记该边 **不能** 豁免 C3(两族问的不是同一个问题)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["shared/subject.mjs"]: "export const subject = 1;\n",
      ["gates/geometry/geometry/driver.mjs"]: "export const LIVENESS_PATHS = [];\n",
      [`${TEST_REL}/shared/borrowed.test.js`]: [
        "// @ts-check",
        "/** 夹具段:住在 shared/ 却 import 门禁树的模块(L5 已按「只提供规格」登记)。 */",
        'import { subject } from "../../shared/subject.mjs";',
        'import { LIVENESS_PATHS } from "../../gates/geometry/geometry/driver.mjs";',
        "export const meta = { description: 'c3-l5-registered' };",
        "export async function run() { return [subject, LIVENESS_PATHS]; }",
        "",
      ].join("\n"),
    },
    l5Exemptions: [
      {
        segment: `${TEST_REL}/shared/borrowed.test.js`,
        specifier: "gates/geometry/geometry/driver.mjs",
        reason: "夹具:driver 在本段里只提供输入规格 LIVENESS_PATHS,本段断言的是 shared/subject 的判定结果",
      },
    ],
    // L5 那一族零命中(豁免生效)——只断 expect 的话,并表的实现照样绿。
    expect: /test\/shared\/borrowed\.test\.js → test-layer-gate-subject/,
    expectAbsent: /test-layer-cross-import:shared 层的段 import 了/,
  },
  {
    // C3 豁免表登记 + reason 达标 → 判绿(这一格是本族「显式登记是合法形态」的存在证明)。
    name: "C3:命中已在门禁主体豁免表登记且 reason 达标 → 判绿(显式登记是合法形态)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["shared/subject.mjs"]: "export const subject = 1;\n",
      ["gates/geometry/geometry/driver.mjs"]: "export const LIVENESS_PATHS = [];\n",
      [`${TEST_REL}/shared/borrowed.test.js`]: [
        "// @ts-check",
        "/** 夹具段:住在 shared/ 却 import 门禁树的模块(已登记豁免)。 */",
        'import { subject } from "../../shared/subject.mjs";',
        'import { LIVENESS_PATHS } from "../../gates/geometry/geometry/driver.mjs";',
        "export const meta = { description: 'c3-exempted' };",
        "export async function run() { return [subject, LIVENESS_PATHS]; }",
        "",
      ].join("\n"),
    },
    // ⚠ **L5 也要登记**:一条真实的「非门禁层 import 门禁树」在真实仓里是**两张表都登记**
    // (L5 那张按「只提供规格」、C3 那张按「层归属对」)。只登记 C3 表的话 L5 仍会判红,
    // 本夹具就变成「验两族判据的叠加」—— 症状出了分不清是哪一族。
    l5Exemptions: [
      {
        segment: `${TEST_REL}/shared/borrowed.test.js`,
        specifier: "gates/geometry/geometry/driver.mjs",
        reason: "夹具:driver 在本段里只提供输入规格 LIVENESS_PATHS,本段断言的是 shared/subject 的判定结果",
      },
    ],
    gateSubjectExemptions: [
      {
        segment: `${TEST_REL}/shared/borrowed.test.js`,
        specifier: "gates/geometry/geometry/driver.mjs",
        reason: "本段的断言对象是同层的 shared/subject.mjs,门禁主体在本段里只当被测输入规格用,段的层归属无需变更",
      },
    ],
    expect: null,
    expectAbsent: /test-layer-gate-subject/,
  },
  {
    // 豁免表 reason 不达门槛 ⇒ 判红。与 L5 同判准:写不出「为什么段的层归属是对的」
    // 时,该做的是搬段,而不是把它塞进表里。
    name: "C3:已登记但 reason 不足 20 字 → 判红(挂表项却说不出为什么段的层归属对)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["shared/subject.mjs"]: "export const subject = 1;\n",
      ["gates/geometry/geometry/driver.mjs"]: "export const LIVENESS_PATHS = [];\n",
      [`${TEST_REL}/shared/borrowed.test.js`]: [
        "// @ts-check",
        "/** 夹具段:住在 shared/ 却 import 门禁树的模块(豁免 reason 太短)。 */",
        'import { subject } from "../../shared/subject.mjs";',
        'import { LIVENESS_PATHS } from "../../gates/geometry/geometry/driver.mjs";',
        "export const meta = { description: 'c3-short-reason' };",
        "export async function run() { return [subject, LIVENESS_PATHS]; }",
        "",
      ].join("\n"),
    },
    gateSubjectExemptions: [
      { segment: `${TEST_REL}/shared/borrowed.test.js`, specifier: "gates/geometry/geometry/driver.mjs", reason: "见谅" },
    ],
    expect: new RegExp(
      `test/shared/borrowed\\.test\\.js → test-layer-gate-subject:命中已在门禁主体豁免表登记\\(gates/geometry/geometry/driver\\.mjs\\),`
      + `但 reason 只有 2 字,不足门槛 ${REASON_MIN_CHARS} 字`,
    ),
  },
  {
    // stale(ratchet):登记了却当前不再命中(段被搬走 / 那条 import 删了)。
    // 没有这一条,表只会单调增长、失效项永远留着,而门禁对它们一声不吭。
    name: "C3 豁免表:登记项当前不再命中(stale)→ 判红(ratchet)",
    judgeOnly: true,
    extra: { ...C3_TREE_IDENTITY },
    gateSubjectExemptions: [
      {
        segment: `${TEST_REL}/shared/gone.test.js`,
        specifier: "gates/geometry/geometry/vanished.mjs",
        reason: "曾经合法,段后来被搬到 test/gates/ 下,这条表项本该在同一次改动里删掉",
      },
    ],
    expect: /test\/shared\/gone\.test\.js → test-layer-gate-subject:门禁主体豁免表登记了 \(gates\/geometry\/geometry\/vanished\.mjs\),但本次扫描没有命中它/,
  },
  {
    // 键名写错 ⇒ 表项本身判红。跳过它等于给「写错键名」开了一个静默放行的口:
    // 它拿到的键永远命中不上,于是那条边一直落档未登记,而没人知道表里其实有一条。
    name: "C3 豁免表:表项缺 specifier 键 → 判红(键名写错会让豁免静默失效)",
    judgeOnly: true,
    extra: {},
    gateSubjectExemptions: [{ segment: `${TEST_REL}/shared/x.test.js`, reason: "没有 specifier 键" }],
    expect: /门禁主体豁免表 → test-layer-gate-subject:第 1 项缺 segment 或 specifier/,
  },
  {
    // 作用域反向锚点:`test/gates/**` 的段 import 门禁树是**定义的**(L11 档 1b 的载体形态),
    // 不该被 C3 判红。少了它,C3 在真实仓库上会判红 31 项(实测)。
    name: "C3 作用域:test/gates/** 的段 import 门禁树 → 判绿(门禁段 import 门禁是载体形态)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      // gates 层段 import gates 层本体 + shared 层 ⇒ L4/L5 两族都不红,只剩 C3 可能红。
      ["gates/repo/check-alpha.mjs"]: "export const alpha = 1;\n",
      ["gates/fixtures/gen-fixtures.mjs"]: "export const gen = 1;\n",
      [`${TEST_REL}/gates/alpha.test.js`]: [
        "// @ts-check",
        "/** 夹具段:门禁段 import 门禁本体(L11 档 1b 的载体形态)。 */",
        'import { alpha } from "../../gates/repo/check-alpha.mjs";',
        'import { gen } from "../../gates/fixtures/gen-fixtures.mjs";',
        "export const meta = { description: 'c3-gate-segment' };",
        "export async function run() { return [alpha, gen]; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: /test-layer-gate-subject/,
  },
  {
    // type-only 的门禁树引用不算 C3 命中(编译期擦除,与 L4/L5 同款取舍)。
    name: "C3 口径:type-only 的门禁树引用不算命中(编译期擦除)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["shared/subject.mjs"]: "export const subject = 1;\n",
      ["gates/geometry/geometry/driver.mjs"]: "export const config = 1;\n",
      [`${TEST_REL}/shared/typeonly.test.js`]: [
        "// @ts-check",
        "/** 夹具段:只有一处 type-only 的门禁树引用。 */",
        'import { subject } from "../../shared/subject.mjs";',
        '/** @typedef {import("../../gates/geometry/geometry/driver.mjs").config} C */',
        "export const meta = { description: 'c3-typeonly' };",
        "/** @param {C} c @returns {unknown} */",
        "export function run(c) { return [subject, c]; }",
        "",
      ].join("\n"),
    },
    expect: null,
    expectAbsent: /test-layer-gate-subject/,
  },
  // ---- L5 豁免表:三条 fail-closed + 表项粒度 ----
  // 注入面是 ctx.l5Exemptions(与 readText / listDir / fileExists 同一形态):合成目录上
  // 求值同一批判据,不 spawn、不碰真实工作树。
  {
    name: "L5 豁免表:未登记的跨层 import 判红(默认形态,不因「看起来顺带」而放过)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [],
    // L5 已转 fail-closed ⇒ 未登记命中进 **problems**。expectInfo: null 是第二道:
    // 只断 problems 的话,「两通道都进」的实现照样绿。
    expect: /test\/core\/cross\.test\.js → test-layer-cross-import:core 层的段 import 了 main 层的主体 \(dist\/main\/other\.mjs\)/,
    expectInfo: null,
  },
  {
    name: "L5 豁免表:登记且带 reason → 判绿(本层主体齐备的段 + 已登记的跨层)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [
      { segment: `${TEST_REL}/core/cross.test.js`, specifier: "dist/main/other.mjs", reason: "夹具:借 convert 的常量当期望值,不执行其实现" },
    ],
    expect: null,
  },
  {
    name: "L5 豁免表:reason 为空 → 判红(空理由等于没登记理由,表会退化成「见谅」)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [{ segment: `${TEST_REL}/core/cross.test.js`, specifier: "dist/main/other.mjs", reason: "" }],
    expect: /命中已在豁免表登记\(dist\/main\/other\.mjs\),但 reason 是空的/,
  },
  {
    name: "L5 豁免表:reason 只有空白 → 同样判红(不得按 trim 后非空放过)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [{ segment: `${TEST_REL}/core/cross.test.js`, specifier: "dist/main/other.mjs", reason: "   " }],
    expect: /reason 是空的/,
  },
  {
    // 「写了但没写够」这一档(ADR-062:72 的 ≥20 字)。与上面「空」分开,因为病因不同:
    // 空 = 忘了写,不足 = 写了但一句「见谅」—— 后者若不判红,表就退化成一列橡皮图章。
    //
    // ⚠ **这格顺带钉住「字是码点不是 UTF-16 单元」**:夹具串取 `REASON_MIN_CHARS - 10` 个
    // 非 BMP 汉字(𠮷,1 个码点 = 2 个 UTF-16 单元)⇒ 码点数 10 < 20 判红,
    // 而按 `.length` 数会得到 20 ⇒ 放行。口径写错时这格立刻红(实现侧的 `.length` 退化)。
    // 用真实汉字而非 emoji:emoji 在本仓 UI 规范里是被点名禁的形态,夹具也不该顺手带一个。
    name: "L5 豁免表:reason 少于 20 字 → 判红,且诊断与「空」那一档可区分(码点口径,非 UTF-16 单元)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [
      {
        segment: `${TEST_REL}/core/cross.test.js`,
        specifier: "dist/main/other.mjs",
        reason: "𠮷".repeat(REASON_MIN_CHARS - 10),
      },
    ],
    expect: new RegExp(
      `命中已在豁免表登记\\(dist/main/other\\.mjs\\),但 reason 只有 ${REASON_MIN_CHARS - 10} 字,`
      + `不足门槛 ${REASON_MIN_CHARS} 字`,
    ),
    // 「两种病因在诊断上可区分」的反向断言:只断 expect 的话,实现把两档合成同一句
    // 「reason 不合格」也照样绿 —— 而那正是本项要求分开报的根据(空 = 没写,不足 = 写得不够)。
    expectAbsent: /reason 是空的/,
  },
  {
    // **恰好等于门槛那一格**(最容易写坏的一格:`>=` 与 `>` 的差别就翻脸)。
    // 夹具串由 `REASON_MIN_CHARS` 个码点构成,且**故意含一个非 BMP 汉字** ⇒
    // `[...s].length === 20` 而 `s.length === 21`。两点保证「与被测实现同口径」:
    //   ① 串长由常量现算(常量一改这格自动跟着走,不会变成陈旧断言);
    //   ② 非 BMP 那一位让 `.length` 口径算出的数与码点口径不同 ⇒ 若实现用 `.length`,
    //      上面那格(不足)会先红,这格则证明绿不是因为「两边恰好相等」蒙对。
    name: "L5 豁免表:reason 恰好等于 20 字 → 判绿(阈值边界:正好达标不得判红)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/cross.test.js`]: crossLayerSegment("core", "../../dist/main/other.mjs") },
    l5Exemptions: [
      {
        segment: `${TEST_REL}/core/cross.test.js`,
        specifier: "dist/main/other.mjs",
        reason: `${"字".repeat(REASON_MIN_CHARS - 1)}𠮷`,
      },
    ],
    expect: null,
  },
  {
    // stale(ratchet):登记了却当前不再命中 —— 代码删了/改名了,豁免必须同批删掉。
    // 没有这一条,表只会单调增长、失效项永远留着,而门禁对它们一声不吭。
    name: "L5 豁免表:登记项当前不再命中(stale)→ 判红(ratchet)",
    judgeOnly: true,
    extra: {},
    l5Exemptions: [
      { segment: `${TEST_REL}/core/gone.test.js`, specifier: "dist/main/vanished.mjs", reason: "曾经合法,代码已删" },
    ],
    expect: /test\/core\/gone\.test\.js → l5-exemption-stale/,
  },
  {
    // 表项粒度:一张 (段, 说明符) 表项**不得**掩盖该段将来新增的另一条跨层 import。
    // 这条是「粒度收到说明符一级」的全部意义 —— 段级全放行会让一张表项变成万能后门。
    name: "L5 豁免表:粒度不足以掩盖新增命中(同段另一条跨层仍判红)",
    judgeOnly: true,
    extra: {
      // 段 import **两条**跨层(main/one + main/other),表里只登记 one ⇒ other 未登记判红、
      // one 命中(故不 stale)。这正是「粒度收到说明符一级」:一张表项只覆盖它那一条。
      // (只 import other 而登记 one 也能证同一件事,但那样 one 会变成 stale ——
      //  那是 ratchet 的另一条判据,会把这格变成「同时断两件事」,症状出了也不好归因。)
      [`${TEST_REL}/core/cross.test.js`]: [
        "// @ts-check",
        "/** 夹具段:本层主体齐备,另有两处跨层引用(只为验豁免表的粒度)。 */",
        'import { subject } from "../../dist/core/subject.js";',
        'import { one } from "../../dist/main/one.mjs";',
        'import { other } from "../../dist/main/other.mjs";',
        'import { createCaseSuite } from "../harness/case.js";',
        "export const meta = { description: 'granularity' };",
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.case("两处跨层都取到", () => { if (one === undefined || other === undefined) throw new Error("缺引用"); });',
        "  return { cases: suite.results, subject };",
        "}",
        "",
      ].join("\n"),
    },
    l5Exemptions: [
      { segment: `${TEST_REL}/core/cross.test.js`, specifier: "dist/main/one.mjs", reason: "夹具:one 的合法豁免" },
    ],
    expect: /test\/core\/cross\.test\.js → test-layer-cross-import:.*\(dist\/main\/other\.mjs\)/,
    expectInfo: null,
  },
  {
    name: "L5 豁免表:键名写错(缺 specifier)→ 表本身判红(跳过它等于给静默失效开口子)",
    judgeOnly: true,
    extra: {},
    l5Exemptions: [{ segment: `${TEST_REL}/core/x.test.js`, reason: "没有 specifier 键" }],
    expect: /第 1 项缺 segment 或 specifier/,
  },
  // ---- REQ-220 #08 族一:段内零本地顶层断言实现 ----
  //
  // ⚠ 本族**当前是 report-only 档**(`CRITERIA` 那行带 `pending: true`)⇒ 命中走 info 通道。
  // 每条负向夹具都同时钉「info 里有」与「problems 里没有」(`expect: null`),只钉一侧的话
  // 「两通道都进」或「两通道都空」的实现能混过去。
  //
  // ⚠ **判定面必须是「段」而不是 `test/**` 全体**:`test/harness/` 下的断言助手自己就有**真的**
  // 顶层 `export function assert` 且自带 `throw`(它们是断言实现本体)。若实现扫全 `test/**`,
  // 它会去红它自己要收敛的那个源。少了下面那条反向锚点,这个收窄无人守。
  {
    name: "#08 族一:段内顶层 assert 函数体自带 throw → 判红(fail-closed;该族已于 2026-10-07 转正,命中进 problems 通道、不计 info)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/local-assert.test.js`]: [
        "// @ts-check",
        "/** 夹具段:段内自实现了一份断言逻辑(带 throw 的重写体)。 */",
        'import { subject } from "../../dist/core/subject.js";',
        'import { createCaseSuite } from "../harness/case.js";',
        "function assert(cond, msg) {",
        "  if (!cond) throw new Error(`local-assert 断言失败:${msg}`);",
        "}",
        "export const meta = { description: 'local-assert' };",
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.case("assert 收窄生效", () => { assert(subject !== undefined, "subject 必须已取到"); });',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
    },
    // 转正前这条是 expectInfo + expect: null(只钉「info 里有、problems 里没有」);
    // 转正后命中进 problems 通道 ⇒ 改钉 expect(problems 里有),expectInfo 置 null(单向钉)。
    // 判据的判定逻辑一行未改,变的只是它落在哪个通道。
    expect: new RegExp(`${TEST_REL}/core/local-assert\\.test\\.js:\\d+ → test-segment-local-assert-impl:.*自带 throw`),
    expectInfo: null,
  },
  {
    // **反向锚点(仓内实例数为 0,本夹具现造)**:ADR-071 明确合规形态是 `@returns {asserts cond}`
    // 的**委派型窄化壳** —— 函数体只调 harness 断言、不含自己的 `throw`。少了这一格,上面那条
    // 可能只是「恒红」:实现若按名字判(段内出现 `assert` 就红),而这条壳完全合规,没人能发现。
    // 这也是 ADR-071 决定一的全部意义所在:判据禁的是**第二份实现**,不是这个函数名。
    name: "#08 族一:段内委派型窄化壳(只调 harness、体内无 throw)→ 零报告(反向锚点,ADR-071 合规形态)",
    judgeOnly: true,
    extra: {
      ["test/harness/case.js"]: "export const assert = () => {};\nexport const createCaseSuite = () => ({});\n",
      [`${TEST_REL}/core/delegating-shell.test.js`]: [
        "// @ts-check",
        "/** 夹具段:段内的 assert 是委派型窄化壳(ADR-071 判它合规)。 */",
        'import { subject } from "../../dist/core/subject.js";',
        'import { assert as harnessAssert, createCaseSuite } from "../harness/case.js";',
        "/**",
        " * @param {unknown} cond",
        " * @param {string} msg",
        " * @returns {asserts cond}",
        " */",
        "function assert(cond, msg) {",
        "  harnessAssert(cond, `delegating-shell 断言失败:${msg}`);",
        "}",
        "export const meta = { description: 'delegating-shell' };",
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.case("壳把断言委派给 harness", () => { assert(subject !== undefined, "subject 必须已取到"); });',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // **判定面的收窄(反向锚点)**:harness 下的助手自己有自带 `throw` 的顶层 `export function
    // assert`(它们是断言实现本体,不是段)。若实现扫全 `test/**`(而不是 `segments`),它会去红
    // **它自己要收敛的那个源** —— 那一族会恒红,而症状看不出是哪一处判据错了。
    // 少了这一格,「判定面 = 段」这件事无人守:实现改成扫全树,上面两条仍然全绿。
    name: "#08 族一:判定面是段而非 test/** 全体(非段助手里的顶层 assert 不判红)",
    judgeOnly: true,
    extra: {
      // 刻意放在 test/harness/ 下且**不是段**(文件名不以 .test.js 结尾)⇒ 它不在 `segments` 里。
      ["test/harness/assert.js"]: [
        "// @ts-check",
        "/** 夹具:harness 助手里的断言实现本体(非段,不在族的判定面上)。 */",
        "export function assert(cond, msg) {",
        "  if (!cond) throw new Error(msg);",
        "}",
        "",
      ].join("\n"),
      [`${TEST_REL}/core/plain.test.js`]: wellFormedSegment("core"),
    },
    expectInfo: null,
    expect: null,
  },
  // ---- REQ-220 #08 族二:每段接入具名 case ----
  //
  // ⚠ **判据必须按「有无 import … case.js」判,不能按「文件里有没有 createCaseSuite 这三个字」判**:
  // 下面那条「只在夹具串里合成别的段」的夹具就是这条的牙齿 —— 按字面判它会过关(它文件里确实
  // 写着 `createCaseSuite`),而它自己并不接 case 契约。
  {
    name: "#08 族二:段未 import case 契约模块 → 判红(fail-closed;该族已转正,命中进 problems 通道)",
    judgeOnly: true,
    // 本条验的正是「段没接入 ⇒ 判红」,合成段必须保持裸形态。
    // 它也是唯一一条**不自带** case.js 桩的族二夹具(另三条自带桩,桩的存在即判据前提),
    // 所以「自带桩就跳过注入」这条推断对它不成立 —— 必须显式声明,不能靠推断蒙混。
    keepSegmentsCaseBare: true,
    extra: {
      [`${TEST_REL}/core/no-case-import.test.js`]: [
        "// @ts-check",
        "/** 夹具段:本层主体齐备,但没有接入具名 case 契约。 */",
        'import { subject } from "../../dist/core/subject.js";',
        "export const meta = { description: 'no-case-import' };",
        "export async function run() { return subject; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(
      `${TEST_REL}/core/no-case-import\\.test\\.js → test-segment-named-case:该段没有 import case 契约模块`,
    ),
    expectInfo: null,
  },
  {
    // **「机器能判的先判红」那一档的牙齿**:import 了契约模块、却一次没调 `.case(`(建了 suite
    // 只用 `describe`)。只按 import 判的实现会放过它 —— 而它正是裁决要求如实报出的那一段。
    name: "#08 族二:import 了契约模块却一次没调 .case( → 判红(建了 suite 只用 describe 不算接入)",
    judgeOnly: true,
    extra: {
      ["test/harness/case.js"]: "export const createCaseSuite = () => ({});\n",
      [`${TEST_REL}/core/suite-only.test.js`]: [
        "// @ts-check",
        "/** 夹具段:import 了契约、建了 suite,却只调 describe 从不调 case。 */",
        'import { subject } from "../../dist/core/subject.js";',
        'import { createCaseSuite } from "../harness/case.js";',
        "export const meta = { description: 'suite-only' };",
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.describe("分组", async () => subject);',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
    },
    expect: new RegExp(
      `${TEST_REL}/core/suite-only\\.test\\.js → test-segment-named-case:该段 import 了 case 契约模块 .*但正文里没有任何`,
    ),
    expectInfo: null,
  },
  {
    // **按 import 判而不按字面判的牙齿**:这一段在**夹具字符串**里合成别的段(把别的段的
    // import 行拼出来送进沙盒),文件正文里确实写着 `createCaseSuite` 与 `suite.case(` ——
    // 按「有没有这几个字」判它会过关,而它自己并不接 case 契约。`extractImports` 的 inString
    // 守卫把夹具串里的 import 行排除掉了,故它如实判红。
    name: "#08 族二:只在夹具串里合成别的段的段不算接入(按 import 判,不按 createCaseSuite 这几个字)",
    judgeOnly: true,
    extra: {
      ["test/harness/case.js"]: "export const createCaseSuite = () => ({});\n",
      // harness 段必须声明 covers 且指向本层,否则它会先被 L8 判红(那是与本族无关的一档)。
      ["test/harness/runner.js"]: "export const runAll = 1;\n",
      [`${TEST_REL}/harness/synth.test.js`]: [
        "// @ts-check",
        '/** 夹具段:harness 段,但只在夹具串里合成别的段(自己并不接 case 契约)。 */',
        'export const covers = ["test/harness/runner.js"];',
        'const CASE_MODULE = "../../../test/harness/case.js";',
        "export const synthesized = [",
        '  `import { createCaseSuite } from "${CASE_MODULE}";`,',
        "];",
        "export const meta = { description: 'synth-only' };",
        "export async function run() { return synthesized; }",
        "",
      ].join("\n"),
    },
    expect: new RegExp(
      `${TEST_REL}/harness/synth\\.test\\.js → test-segment-named-case:该段没有 import case 契约模块`,
    ),
    expectInfo: null,
  },
  {
    // **反向锚点**:import 了契约 + 至少一处 `.case(` ⇒ 零报告。缺它的话,本族可能只是「恒红」——
    // 而「恒红」与「建了族」在退出码上不可区分 —— 本族转正后它已 fail-closed,恒红会改退出码,
    // 所以上面那三条正夹具(钉 expect)与这条反向锚点(钉双 null)成对才够。
    name: "#08 族二:已 import 契约模块且至少调一次 .case( → 零报告(反向锚点)",
    judgeOnly: true,
    extra: {
      ["test/harness/case.js"]: "export const assert = () => {};\nexport const createCaseSuite = () => ({});\n",
      [`${TEST_REL}/core/cased.test.js`]: [
        "// @ts-check",
        "/** 夹具段:接入了具名 case 契约。 */",
        'import { subject } from "../../dist/core/subject.js";',
        'import { assert as harnessAssert, createCaseSuite } from "../harness/case.js";',
        "export const meta = { description: 'cased' };",
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.case("subject 可取到", () => { harnessAssert(subject !== undefined, "subject 必须已取到"); });',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
    },
    expectInfo: null,
    expect: null,
  },
  // ---- REQ-221(#09)门禁树侧:每份自测接入具名 case(与段侧同名形态那一族**不同 id**)----
  //
  // ⚠ **本族每一条夹具都必须铺 `C3_TREE_IDENTITY`**:门禁树侧整段受 `indexInRoot` 约束
  // (与 C3 / L11b 同款范畴边界,理由见判定本体里 `indexInRoot` 的注释)—— 合成根里没有
  // `gates/` 子树,那是「这棵树不是门禁索引描述的那棵树」,不是「门禁自测一份都没有」。
  // 缺了它,本族每一条夹具都**零命中**(症状是「全绿」,看不出是作用域没开)。
  //
  // ⚠ **本族当前是 report-only**(CRITERIA 里 `pending: true`),故命中走 `info` 通道 ——
  // 断言必须落在 `expectInfo` 上,落在 `expect`(problems)上会因「期望零判红」而恒绿。
  {
    // 档 1:没 import 契约模块 ⇒ 命中(第一格)。这一格是本族的**全部意义**:门禁自测今天
    // 实测零接入(ADR-074 背景一),不判它就等于「判据面扩了但一个数都没报」。
    name: "#09 门禁树侧:自测没 import case 契约模块 → 命中(第一格,门禁树引的是 shared/ 真实现)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["gates/repo/check-demo.selftest.mjs"]: [
        "// @ts-check",
        "/** 夹具门禁自测:裸断言,没接 case 契约。 */",
        'import { demo } from "./check-demo.mjs";',
        "export async function run() {",
        '  if (demo !== 1) throw new Error("demo 漂移");',
        "}",
        "",
      ].join("\n"),
      ["gates/repo/check-demo.mjs"]: "export const demo = 1;\n",
    },
    expectInfo: new RegExp(
      `gates/repo/check-demo\\.selftest\\.mjs → gates-selftest-named-case:该门禁自测没有 import `
      + `case 契约模块 ${GATES_CASE_MODULE_REL.replace(/\//g, "\\/")}`,
    ),
    // ⚠ `expect: null` 与 `expectInfo` **互不替代**:前者钉「report-only 命中不进 problems」
    // (即本族当前**不改退出码**,这是它挂 pending 的直接后果),后者钉「它真的被报出来了」。
    // 只断前者则本族恒绿(任何实现都过),只断后者则「命中被吞进 problems」无人发现。
    expect: null,
  },
  {
    // 档 2:import 了契约却一次没调 `.case(` ⇒ 命中(第二格)。两个条件缺一不可,与段侧同款:
    // 只断 import 会让「建了 suite 却只用 describe」的自测过关(裁决:机器能判的先判红)。
    name: "#09 门禁树侧:import 了契约却一次没调 .case( → 命中(第二格,只断 import 会漏这一档)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["gates/repo/check-demo.selftest.mjs"]: [
        "// @ts-check",
        "/** 夹具门禁自测:import 了契约、建了 suite,却只调 describe 从不调 case。 */",
        `import { createCaseSuite } from "${posixRelativeSpecifier("gates/repo", GATES_CASE_MODULE_REL)}";`,
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.describe("分组", async () => {});',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
      [GATES_CASE_MODULE_REL]: "export const createCaseSuite = () => ({});\n",
    },
    expectInfo: new RegExp(
      `gates/repo/check-demo\\.selftest\\.mjs → gates-selftest-named-case:该门禁自测 import 了 `
      + `case 契约模块 .*但正文里没有任何`,
    ),
    expect: null,
  },
  {
    // **反向锚点**:import 了契约 + 至少一处 `.case(` ⇒ 本族零命中。
    // 缺它的话,上面那两条可能只是「恒红」—— 而恒红与「这一族根本没生效」在读数上不可区分。
    // ⚠ 它同时钉住「契约模块路径是 `shared/case.js` 而不是 `test/harness/case.js`」:
    // 后者若被误当成门禁树侧的合法契约路径,本族在真实仓上会**恒绿**(实测 20 份零导入
    // `shared/case.js`,而它们也都没引门面 —— 但门禁树根本引不到门面,那条路径是伪口径)。
    name: "#09 门禁树侧:已 import shared/ 契约且至少调一次 .case( → 零命中(反向锚点)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["gates/repo/check-demo.selftest.mjs"]: [
        "// @ts-check",
        "/** 夹具门禁自测:已接入具名 case 契约(引 shared/ 真实现)。 */",
        `import { createCaseSuite } from "${posixRelativeSpecifier("gates/repo", GATES_CASE_MODULE_REL)}";`,
        "export async function run() {",
        "  const suite = createCaseSuite();",
        '  await suite.case("demo 取到", () => {});',
        "  return { cases: suite.results };",
        "}",
        "",
      ].join("\n"),
      [GATES_CASE_MODULE_REL]: "export const createCaseSuite = () => ({});\n",
    },
    expectInfo: null,
    expect: null,
  },
  {
    // **跨族隔离的反向锚点**:门禁自测的接入状态**不计入**段侧的 `segments`。
    // 少这一格的话,把自测数塞进 `stats.segments` 的实现(复用段侧分母最省事的一种写法)
    // 会让本族与 `scan-surface-collapsed` / `test-top-dirs-exact` 三族**零连带**这条性质
    // 无人核对 —— 那三族的结论行数字会随自测增删漂,而它们各自的夹具都察觉不到。
    name: "#09 门禁树侧:自测份数不进段侧分母(与既有三族零连带)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["gates/repo/check-demo.selftest.mjs"]: "export const covered = 1;\n",
    },
    // 段侧两族零命中 + 本族命中数**只数自测那一份**:两族分母都没被自测撑大。
    expectAbsent: /scan-surface-collapsed|test-top-dirs-exact:test\/ 顶层多出目录/,
    expectInfo: /gates-selftest-named-case/,
    expect: null,
  },
  {
    // 扫描面塌缩(另立 id 那一档):`.selftest.mjs` 份数掉到下限以下 ⇒ 判红。
    // ⚠ 走的是**新 id**而不是段侧那一档:处置不同(发现规则写错 / 门禁树被搬走 vs walker 失效),
    // 复用会让两者的强制等级读数无法分别归因。
    name: "#09 门禁自测扫描面塌缩(份数掉到下限以下)→ 判红 gates-selftest-surface-collapsed",
    judgeOnly: true,
    extra: { ...C3_TREE_IDENTITY },
    minSelftestFiles: 1000,
    expect: new RegExp(
      `gates-selftest-surface-collapsed:${GATES_SELFTEST_ROOT}/ 下只扫到 \\d+ 份 `
      + `${GATES_SELFTEST_EXT.replace(/\./g, "\\.")} 自测\\(下限 1000\\)`,
    ),
  },
  {
    // **范畴边界的反向锚点**(与 L11b 那格成对):索引模块不在本求值根里 ⇒ 门禁树侧整段
    // 不适用。少了这一格,新族会在每一条没铺 `gates/` 的合成夹具上抛「读不到 gates/ 子树」
    // 或恒判塌缩,而恒红是纯文本门禁最坏的失效形态。
    name: "#09 门禁树侧:索引模块不在本求值根里(合成根)→ 整段不适用,不报塌缩也不报未接入",
    judgeOnly: true,
    extra: {},
    expectAbsent: /gates-selftest-surface-collapsed|gates-selftest-named-case|读不到 gates\/ 子树/,
    expect: null,
  },
  // ---- REQ-221(#09)族二 gates-selftest-case-roster:case 名 ⟷ 登记名册两向差集 ----
  //
  // ⚠ **本族每一档都必须铺「在册路径」而不是自造的 `check-demo.selftest.mjs`** ——
  // 判定面收窄在「这一棵树与取名策略登记表有交集」之后(理由见门禁本体那段注释:
  // 登记表描述的是**真实仓库**那 20 份自测,而合成根里铺的自测与它零重合 ⇒
  // 那不是「少登记了一行」而是「这张表描述的不是这棵树」)。
  // ⇒ 夹具一律造 `INLINE_DEMO` / `TABLE_NAME_DEMO` / … 那几行**真在册**的路径 + 合成正文,
  // 交集非空 ⇒ 本族正常生效。在册路径**按策略签名从登记表取**(见 `registeredDemoFor`),
  // 不写死行号 —— 行号漂了会让夹具静默改验另一份自测的策略。
  //
  // ⚠ **合成正文必须与那一行登记的策略逐字同形**(如 wrapper 档的 wrapper 名就是
  // 登记表里那个 `wrapper` 值):不同形会落进「抽出 0 条」那一档,而那一档**也判红** ——
  // 症状相同、真因不同(诊断指向「case 被删」,而真因是夹具写错了策略)。
  //
  // ⚠ **两条夹具纪律**(各自都对应一条会让夹具失去意义的坑):
  //   ① 合成自测**必须自带 case 契约 import + 至少一处 `.case(`** —— 否则
  //      `gates-selftest-named-case` 那一族先命中。⚠ **本族转正后两者已分属不同通道**
  //      (本族进 problems、⑭ 仍在 info),纪律**仍然要守**:两条并存时,读 `expectInfo`
  //      的那几档会被 ⑭ 的 info 顶成非空,而落在 `expect`(problems)上的本族诊断
  //      反而看不见 —— 症状离根因隔着一族判据。
  //   ② 名册与自测**必须成对铺**:只铺自测不铺名册会命中「名册读不到」那一档,
  //      它会 `continue` 掉差集判定 ⇒ 后面几档验的就不是差集而是读表档。
  //
  // ⚠ **转正后本族夹具一律改钉 `expect`(problems)通道**,`expectInfo` 只在
  // 「反向锚点」(info 必须为空)那几档保留 —— 与 #08 族一转正时的做法同款。
  {
    // 档 1(取名策略①内联字面量):全部 `await suite.case('…')`,名册逐条对齐 ⇒ 零命中。
    // **反向锚点**:没有它,下面那几条可能只是「恒红」—— 而恒红与「这一族根本没生效」
    // 在读数上不可区分。
    name: "#09 名册族·取名策略①内联字面量:源码与名册逐条相等 → 零命中(反向锚点)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: roster(["甲档", "乙档"]),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // 档 2(取名策略②用例表 `name:` 字段):证明判据不是只认内联形态 ——
    // 只认内联的话它在真实仓上 10 份纯表驱动的自测会全部落进「抽出 0 条」。
    name: "#09 名册族·取名策略②用例表 name: 字段:源码与名册逐条相等 → 零命中",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [TABLE_NAME_DEMO]: TABLE_NAME_SELFTEST,
      [ROSTER_OF(TABLE_NAME_DEMO)]: roster(["表内一", "表内二"]),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // 档 3(取名策略③本地 wrapper 首参):`smoke-report` 那一类(零处内联 `.case(`)。
    name: "#09 名册族·取名策略③本地 wrapper 首参:源码与名册逐条相等 → 零命中",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [WRAPPER_DEMO]: WRAPPER_SELFTEST,
      [ROSTER_OF(WRAPPER_DEMO)]: roster(["w1", "w2", "w3"]),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // 档 4(取名策略④变异实验 `id:` 字段):`check-samples` 那一类(两套字段名并存)。
    name: "#09 名册族·取名策略④变异实验 id: 字段(与 name: 并存):源码与名册逐条相等 → 零命中",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [MUTATION_ID_DEMO]: MUTATION_ID_SELFTEST,
      [ROSTER_OF(MUTATION_ID_DEMO)]: roster(["基线一", "基线二", "mut-1", "mut-2"]),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // 档 5(取名策略⑤内联 `cases:` 数组):证明判据认「表在 harness 实参里」这一形态 ——
    // 只认顶层表的话,`check-src-layout.selftest.mjs` 那 4 处在册自测会静默少抽 4 条,
    // 而症状是「名册条数对不上」而不是判红(差集两向都不响)。
    // ⚠ 名册按登记的**策略序**写(该行四档策略里只有 `call-cases-field` 有产出)。
    name: "#09 名册族·取名策略⑤内联 cases: 数组(表在 harness 实参里):源码与名册逐条相等 → 零命中",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_CASES_DEMO]: INLINE_CASES_SELFTEST,
      [ROSTER_OF(INLINE_CASES_DEMO)]: roster(["内联一", "内联二"]),
    },
    expectInfo: null,
    expect: null,
  },
  {
    // 差集方向一「册有源无」:名册多一条源码里没有的 ⇒ 判红(那条 case 被删了而册没删)。
    // ⚠ 这正是本族存在的理由:那一档在 `gates-selftest-named-case` 眼里**完全不可见**
    // (import 还在、`.case(` 仍 ≥1 处),删掉一整个 case 不改变任何可数的东西。
    name: "#09 名册族·差集方向一册有源无(名册那条 case 已从源码删掉)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: roster(["甲档", "乙档", "已删的丙档"]),
    },
    expectInfo: null,
    // ⚠ 转正后本族进 **problems**:断言从 `expectInfo` 改钉 `expect`,单向(不再要求 info 里没有)。
    expect: /已删的丙档.*已被删除\(或改了档名\)而名册没同批删/s,
  },
  {
    // 差集方向二「源有册无」:源码新增一条而名册没跟 ⇒ 判红。
    name: "#09 名册族·差集方向二源有册无(源码新增的 case 没进名册)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: roster(["甲档"]),
    },
    expectInfo: null,
    expect: /乙档.*没登记它/s,
  },
  {
    // 登记表缺行判红:树里有份自测而登记表里**没有它** ⇒ 它静默退出判定面(症状是全绿)。
    // ⚠ 夹具做法:在册那一份 + **一份不在册**的兄弟路径(交集非空,判定面才开)。
    name: "#09 名册族·登记表缺行(树里有自测而表里没登记)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: roster(["甲档", "乙档"]),
      [UNREGISTERED_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(UNREGISTERED_DEMO)]: roster(["甲档", "乙档"]),
    },
    expectInfo: null,
    expect: new RegExp(
      `${UNREGISTERED_DEMO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} → `
      + "gates-selftest-case-roster:.*没有登记行",
      "s",
    ),
  },
  {
    // 名册非空下限(恒绿防护第一道):名册 `cases` 为空 ⇒ 判红。
    // ⚠ **这一档是恒绿防护,不是「顺手加的」**:两侧同时为空时两向差集恒空 ⇒ 本族「全绿」。
    // 缺了它,一份空名册会让本族看起来「一切正常」,而它什么也没核对。
    // ⚠ 源侧**也**零 case(`EMPTY_CASE_SELFTEST`)—— 否则验的就只是「空册判红」,
    // 验不到「空册 + 空源 ⇒ 差集恒空」那个真失效形态。
    // ⚠ **本档刻意不钉 `expectInfo`**:那份合成正文只建 suite、一次不调 `.case(` ⇒
    // 它**必然**同时命中 ⑭ `gates-selftest-named-case`(info 通道),而那是**预期**的
    // (理由见 `EMPTY_CASE_SELFTEST` 的注释)。转正后本族进 problems,两者分属不同通道。
    name: "#09 名册族·恒绿防护:名册 cases 为空(两侧同时为空时差集恒空)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [TABLE_NAME_DEMO]: EMPTY_CASE_SELFTEST,
      [ROSTER_OF(TABLE_NAME_DEMO)]: roster([]),
    },
    expect: new RegExp(
      `只有 0 条\\(下限 ${MIN_GATE_CASE_ROSTER}\\).*两侧同时为空时两向差集恒空`,
      "s",
    ),
  },
  {
    // 名册读不到(第一档 fail-closed):路径在、自测在,就是没那份 sidecar ⇒ 判红。
    name: "#09 名册族·名册读不到(不得静默当空册:两侧同时空会让本族恒绿)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
    },
    expectInfo: null,
    expect: /case 登记名册读不到或不是合法 JSON.*本族会「全绿」/s,
  },
  {
    // 名册缺 `cases` 键(第二档 fail-closed)⇒ 判红,且**点名名册路径**。
    name: "#09 名册族·名册缺 cases 数组 → 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: `${JSON.stringify({ _comment: "缺 cases 键", names: ["甲档"] }, null, 2)}\n`,
    },
    expectInfo: null,
    expect: /case 登记名册缺 cases 数组/,
  },
  {
    // 恒绿防护第二道 + 「策略与源码脱节」:策略指向的表在源码里不存在 ⇒ 抽出 0 条
    // ⇒ **单列**判红,而不是让它掉进「册有源无」报满屏(那一档的真因会被埋在派生症状里)。
    name: "#09 名册族·策略与源码脱节(抽出 0 条)→ 判红并点明策略(不落进册有源无)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      // 正文是**纯内联**的,而这一行登记的策略是「用例表 name: 字段」⇒ 该表不存在 ⇒ 抽出 0 条。
      [TABLE_NAME_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(TABLE_NAME_DEMO)]: roster(["表内一"]),
    },
    // ⚠ 断言「**不**出现册有源无那一档」:它证明实现把「抽出 0 条」单列了,
    // 而没有拿一个空源侧去比非空名册、报出一堆「表内一已被删除」这种误导诊断。
    // ⚠ 转正后本族诊断进 **problems** ⇒ 这一格从 `expectInfoAbsent` 改钉 `expectAbsent`:
    // 留在 info 通道上它恒成立(info 里没有本族任何东西),断言就此退化成恒绿。
    // `expectInfo: null` 是第二道(⑭ 那族在 info 通道,这里顺带钉它没命中)。
    expectInfo: null,
    expect: /按登记的取名策略抽出 \*\*0 条\*\* case 名.*策略与源码脱节/s,
    expectAbsent: /已被删除\(或改了档名\)而名册没同批删/,
  },
  {
    // stale 行判红:登记表登记了某份自测而树里没有它 ⇒ 判红(ratchet)。
    // ⚠ 夹具做法:把扫描面下限压到 1(树里 1 份 ≥ 下限 ⇒ 不是塌缩),
    // 于是本族照常判而那一行被报成 stale。
    name: "#09 名册族·登记表 stale 行(登记了而树里已无该自测)→ 判红",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      [INLINE_DEMO]: INLINE_CASE_SELFTEST,
      [ROSTER_OF(INLINE_DEMO)]: roster(["甲档", "乙档"]),
    },
    minSelftestFiles: 1,
    expectInfo: null,
    expect: new RegExp(
      `登记表登记了 ${TABLE_NAME_DEMO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},.*本次扫描的树里不存在`,
      "s",
    ),
    // ⚠ **反向锚点**:在册且真在树里的那一行**不得**被报成 stale。
    // 少这一格,「把所有在册行都报一遍」的实现也能过上面那条断言。
    // ⚠ 转正后本族诊断进 **problems** ⇒ 这一格随之从 info 通道改钉 problems 通道。
    expectAbsent: new RegExp(
      `登记表登记了 ${INLINE_DEMO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`,
    ),
  },
  {
    // 取名层直测 · 四类策略**并在一段源码里**:证明四类都真被抽到、各抽各的,
    // 且**顺序**稳定(先按策略登记序,策略内按出现序 —— 诊断逐条点名时靠它对号入座)。
    name: "#09 名册族·取名层直测:四类策略并在一段源码里各抽各的(顺序稳定)",
    caseExtract: true,
    text: [
      "const CASES = Object.freeze([",
      "  { name: '表一', files: {} },",
      "  { name: '表二', files: {} },",
      "]);",
      "const MUTATIONS = Object.freeze([",
      "  { id: 'mut-1' },",
      "  { id: 'mut-2' },",
      "]);",
      "async function check(name, body) {}",
      "async function run() {",
      "  await check('w1', () => {});",
      "  await suite.case('内联一', () => {});",
      "}",
    ].join("\n"),
    strategies: [
      { kind: "table-field", table: "CASES", field: "name" },
      { kind: "table-field", table: "MUTATIONS", field: "id" },
      { kind: "wrapper-first-arg", wrapper: "check" },
      { kind: "inline-case" },
    ],
    expectNames: ["表一", "表二", "mut-1", "mut-2", "w1", "内联一"],
  },
  {
    // 取名层直测 · **`inString` 掩码**:夹具源码字符串内部的 `suite.case(…)` **不是**本自测
    // 自己的 case —— 它是「被判据读的字面量」。不过掩码就会把它们收进来,
    // 在真实仓上表现为满屏假的「源有册无」(check-test-layout.selftest.mjs 实测有 11 处)。
    // ⚠ 这是本族唯一一处「掩码错了症状是假红而不是恒绿」的环节,故单列一档钉住。
    name: "#09 名册族·取名层直测:夹具源码字符串内部的 suite.case( 不得被算成源侧 case",
    caseExtract: true,
    text: [
      "const SEG = [",
      // 下面两行是**被拼进夹具的源码字符串**:里面的 `suite.case(…)` / `check(…)`
      // 是「被判据读的字面量」,不是这份自测自己的 case。
      '  "  await suite.case(\'字符串里的假档\', () => {});",',
      '  "  await check(\'字符串里的假 wrapper\', () => {});",',
      '].join("\\n");',
      "async function run() {",
      "  await suite.case('真档', () => {});",
      "}",
    ].join("\n"),
    strategies: [
      { kind: "inline-case" },
      { kind: "wrapper-first-arg", wrapper: "check" },
    ],
    expectNames: ["真档"],
  },
  {
    // 取名层直测 · **括���配平过 inString 掩码**:档名里含 `[` / `]`(真实形态:
    // `check-changelog` 的档名含 `## [待发版]`)。不掩码就配平不到末尾 ⇒ 抽出 0 条,
    // 而「抽出 0 条」在整族档上**也判红** —— 症状相同、真因不同(诊断指向「策略与源码脱节」)。
    name: "#09 名册族·取名层直测:档名里的方括号(## [待发版] 形态)不破坏表区间配平",
    caseExtract: true,
    text: [
      "const CLI_CASES = Object.freeze([",
      "  { name: '防空过:锚点 ## [待发版] 被改名 → 判红', files: {} },",
      "  { name: '防空过:条目区无任何版本条目 → 判红', files: {} },",
      "]);",
    ].join("\n"),
    strategies: [{ kind: "table-field", table: "CLI_CASES", field: "name" }],
    expectNames: ["防空过:锚点 ## [待发版] 被改名 → 判红", "防空过:条目区无任何版本条目 → 判红"],
  },
  {
    // 取名层直测 · **内联 `cases:` 与顶层表各抽各的**:两类共用「在区间里收 `name:`」,
    // 只差区间怎么来。这条钉住它们**不互相吞**:顶层表那份与 harness 实参里那份
    // 都要收到,且不重复收(实测曾因「用方括号去配平花括号」把同一条收两遍)。
    name: "#09 名册族·取名层直测:内联 cases: 数组与顶层表各抽各的(不互相吞、不重复收)",
    caseExtract: true,
    text: [
      "const CASES = Object.freeze([",
      "  { name: '顶层一', files: {} },",
      "]);",
      "await runHarness({",
      "  group: '内联组',",
      "  cases: [",
      "    { name: '内联一', files: {} },",
      "    { name: '内联二', files: {} },",
      "  ],",
      "  suite,",
      "});",
    ].join("\n"),
    strategies: [
      { kind: "table-field", table: "CASES", field: "name" },
      { kind: "call-cases-field", call: "runHarness", field: "name" },
    ],
    expectNames: ["顶层一", "内联一", "内联二"],
  },
  {
    // 取名层直测 · **内联档的负向锚点:调用点必须过 `inString` 掩码**。
    // 那段 `runHarness({ cases: [...] })` 在夹具源码字符串内部 —— 它是被判据读的
    // 字面量,不是这份自测自己的用例表。少了它,夹具里那份会被收成源侧 case 名,
    // 在真实仓上表现为满屏假的「源有册无」。
    name: "#09 名册族·取名层直测:夹具源码字符串内部的 runHarness({ cases: }) 不得被抽成源侧",
    caseExtract: true,
    text: [
      "const SEG = [",
      '  "  await runHarness({ cases: [ { name: \'字符串里的假档\' } ] });",',
      '].join("\\n");',
      "await runHarness({",
      "  cases: [",
      "    { name: '真档' },",
      "  ],",
      "});",
    ].join("\n"),
    strategies: [{ kind: "call-cases-field", call: "runHarness", field: "name" }],
    expectNames: ["真档"],
  },
  {
    // 取名层直测 · **顶层表定位也过 `inString` 掩码**(缺陷一那条):
    // 下面第一行是**被拼进夹具的源码字符串**里的 `const CASES = Object.freeze([`,
    // 它排在真表**之前**。定位不过掩码就会抽到它、只穿透拿到零星几条
    // (实测 2 条 / 应 3 条),而症状是「条数不对」—— 任何一条判据都不响。
    name: "#09 名册族·取名层直测:顶层表定位跳过夹具源码字符串内部那份同名声明",
    caseExtract: true,
    text: [
      "const SEG = [",
      '  "const CASES = Object.freeze([",',
      '  "  { name: \'字符串里的假档\', files: {} },",',
      '  "]);",',
      '].join("\\n");',
      "const CASES = Object.freeze([",
      "  { name: '真一', files: {} },",
      "  { name: '真二', files: {} },",
      "  { name: '真三', files: {} },",
      "]);",
    ].join("\n"),
    strategies: [{ kind: "table-field", table: "CASES", field: "name" }],
    expectNames: ["真一", "真二", "真三"],
  },
  {
    // 取名层直测 · **正则字面量里的转义方括号不破坏表区间配平**(缺陷二那条):
    // `lexSource` 掩字符串与注释但**不掩正则**,故 `expect: /…\[…/` 里的 `\[`
    // 会以「一个真的左方括号」进配平。真实形态:`check-changelog.selftest.mjs` 的
    // `expect: /在锚点之后没有任何 \`## \[\` 版本条目/`。
    // ⚠ 与上面那条「档名里的方括号」**互不替代**:那条验的是字符串内的真方括号
    // (`## [待发版]`,它是配对的),这条验的是正则内**不成对**的转义方括号。
    name: "#09 名册族·取名层直测:正则字面量里的 \\[ 不破坏表区间配平(lexSource 不掩正则)",
    caseExtract: true,
    text: [
      "const CLI_CASES = Object.freeze([",
      "  {",
      "    name: '防空过:条目区无任何版本条目 → 判红',",
      "    expect: /在锚点之后没有任何 `## \\[` 版本条目/,",
      "  },",
      "  {",
      "    name: '防空过:CHANGELOG 路径不存在 → 判红',",
      "    expect: /扫描失败/,",
      "  },",
      "]);",
    ].join("\n"),
    strategies: [{ kind: "table-field", table: "CLI_CASES", field: "name" }],
    expectNames: ["防空过:条目区无任何版本条目 → 判红", "防空过:CHANGELOG 路径不存在 → 判红"],
  },
  {
    // 取名层直测 · **wrapper 不误收属性访问与标识符内嵌**:
    // `obj.check(…)` 与 `recheck(…)` 都不是 wrapper 调用(前者是别人的方法)。
    // 少了这条守卫,凡是有个 `.check(` 的自测都会多收一批假档名。
    name: "#09 名册族·取名层直测:wrapper 不误收属性访问(helper.check( ) 与 recheck( ) )",
    caseExtract: true,
    text: [
      "async function check(name, body) {}",
      "async function run() {",
      "  await check('真档', () => {});",
      "  await helper.check('属性访问不是 wrapper', () => {});",
      "  await recheck('标识符内嵌不是 wrapper', () => {});",
      "}",
    ].join("\n"),
    strategies: [{ kind: "wrapper-first-arg", wrapper: "check" }],
    expectNames: ["真档"],
  },
  {
    // 范畴边界反向锚点:合成根上铺的自测**全部不在登记表里**(交集为空)⇒ 本族整段不适用。
    // ⚠ 少这一格,收窄那一条会被「删掉它实现照跑」的误改悄悄放过 ——
    // 而它在真实仓上的正确读数是「20 行全在 ⇒ 照常判」,合成根上的正确读数是「不适用」。
    name: "#09 名册族·合成根自测与登记表零重合 → 整段不适用(不报缺行也不报 stale)",
    judgeOnly: true,
    extra: {
      ...C3_TREE_IDENTITY,
      ["gates/repo/check-demo.selftest.mjs"]: INLINE_CASE_SELFTEST,
      ["gates/repo/check-demo.case-roster.json"]: roster(["甲档", "乙档"]),
    },
    expectAbsent: /gates-selftest-case-roster/,
    expectInfo: null,
    expect: null,
  },
  // ---- 判据登记表 CRITERIA:三道「没有一族漏登记」的机械判红 ----
  //
  // ① 结构层:漏斗查不到 id ⇒ 追加 `criteria-unregistered:<id>` 判红(下面两条夹具);
  // ② 静态层:源码 id 集合 ⟷ CRITERIA 双向相等(下面 sourceAudit 一档);
  // ③ 语义层:`pending: true` 必须带非空 `pendingReason`(下面那条)。
  // 三者缺一:去掉①则漏登记一族只能靠②事后发现;去掉②则①只在运行到那一族时才生效;
  // 去掉③则「挂个待办标记但说不出为什么」与「说得出为什么」在门禁上不可区分。
  {
    // ① 结构层:从登记表里摘掉 L4 那一行,再跑一棵 L4 红树 ⇒ 必须出现 criteria-unregistered。
    //
    // ⚠ 关于「exit 1」:本条是 judgeOnly 档(不 spawn),而漏斗删行口**刻意不进 CLI** ——
    // 能从命令行换档就是 fail-open,那正是本次要拆掉的东西。所以 exit 1 不在这里断言,
    // 而是**合成**出来的:`report` 把 unregistered 的诊断推进 `problems`,而
    // `main()` 的退出码就是 `problems.length === 0 ? 0 : 1`(链路上由下面
    // 「判红 ⇒ exit 1」那条 CLI 夹具钉住)。此处断言的是那个前提本身 —— 诊断进了 problems。
    //
    // 少这一格的话,「漏登记一族只能静默丢弃」无人发现:一族命中凭空消失,在门禁上表现为
    // **更绿**而不是更红 —— 纯文本门禁最坏的失效形态。
    name: "CRITERIA 漏登记:摘掉 L4 那行 ⇒ 该族命中既进 problems 也追加 criteria-unregistered",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    // ⚠ 这个覆盖**只允许删行**。删行口是自检专用的单向口:若它能新增表项或加 `pending: true`,
    // 注入口就成了「可配置即假话」的后门(自检能调档 ⇒ 生产也能调档 ⇒ fail-open)。
    // 另两个方向由门禁的 `resolveCriteria` 抛错挡住,见那处注释。
    criteriaOverride: CRITERIA.filter((entry) => entry.id !== "test-layer-self-hosted"),
    expect: /criteria-unregistered:test-layer-self-hosted/,
    // ⚠ 与 expect 互不替代:漏斗不能因为「查不到档」就把**原诊断**也吞了 ——
    // 那才是真的让一族静默消失(只记一条登记表告警、命中本身不见)。
    expectAlso: /runner-report\.test\.js → test-layer-self-hosted:该段解析后/,
  },
  {
    // ① 的对侧:摘掉**没有任何命中**的那一行(L8)⇒ 不产生 criteria-unregistered。
    // 少这一格的话,「漏斗查不到即判红」就变成了「查不到即恒红」——
    // 那会逼人给登记表塞满永不命中的行,机制反而被绕过。
    name: "CRITERIA 漏登记:摘掉没有任何命中的那行 ⇒ 不产生 criteria-unregistered",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    criteriaOverride: CRITERIA.filter((entry) => entry.id !== "test-harness-not-segment"),
    expect: /runner-report\.test\.js → test-layer-self-hosted:该段解析后/,
    expectAbsent: /criteria-unregistered:/,
  },
  {
    // ⚠ 「缺标记即 fail-closed」的反锚点:不写 pending 的一律判红。
    // 少这一格时,「查表失败 ⇒ 进 problems」这一半没人证明 —— 实现若把查不到直接 return,
    // 上面两条也照样绿(它们只证「会记一条 criteria-unregistered」)。
    // 本条用的就是**默认表**(没有 criteriaOverride),跑一棵树证明 L4 红在 problems 里。
    name: "CRITERIA 默认 fail-closed:表里不带 pending 的一律判红",
    judgeOnly: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    expect: /runner-report\.test\.js → test-layer-self-hosted:该段解析后/,
    // 反向:report-only 那一族在同一棵树上真的没进 problems ⇒ 两个方向都在,才算「按表分流」。
    expectAbsent: /test-top-dirs-exact/,
  },
  {
    // ③ 语义层:`pending: true` 缺 `pendingReason` ⇒ 红(变异实验:删掉 L7 的 reason 即红)。
    // 静态档直接读**导出的 CRITERIA**,不重跑判定 —— 这条断言的是「表本身」而非「某次运行」。
    // ⚠ 只断「非空」不校验内容:理由是给人读的判断,门禁能机械判的只有「有没有写」。
    name: "CRITERIA 语义:每个 pending: true 都带非空 pendingReason",
    sourceAudit: true,
  },
  {
    // ② 静态层的**变异证明**:往源码里塞一条**未登记**的判据族 ⇒ 本档立刻红。
    // 本条不 spawn、不改真实文件:它在内存里把一份「源码副本」喂给同一个抽取器,
    // 断言该副本被判为「源码有、表里没有」。缺这一格的话,「双向相等」可能只是
    // 抽取器的正则写错了(抽不出任何 id ⇒ 两边都空 ⇒ 平)——那种实现下本体登记全错也不红。
    name: "CRITERIA 静态层变异:源码多出一族未登记 ⇒ sourceAudit 判红(变异实验)",
    sourceAuditMutation: true,
  },
  {
    // ② 的第二向变异:表里多一行**源码已不再发出**的僵尸行 ⇒ 本档立刻红。
    // 它守的是「进度 grep 锚的命中数不说谎」—— 僵尸行会让那行数虚高,
    // 于是「还剩几族待转正」这个唯一读数开始骗人,而没人会去核对它。
    name: "CRITERIA 静态层变异:表里多一行僵尸行 ⇒ sourceAudit 判红(变异实验)",
    sourceAuditMutation: "zombie",
  },
  // ---- L11 gate-has-carrier:三档各一 + 豁免表三档 fail-closed + stale ----
  // L11 的核心命题:**每道门禁都要有「有人能证明它坏掉时会红」的载体**。
  // 三档逐条钉:档 1(有载体)/ 档 2(无载体但在豁免表)/ 档 3(两者皆无 → 红)。
  //
  // ⚠ **每档都断言 `problems` 非空或为空的具体形状**,且负向档用 `expectAlso` 钉住诊断正文 ——
  // 只断 `problems.length > 0` 的话,「判红的原因与本档无关」也能过(例如因为别的门禁缺载体),
  // 而那种夹具在实现改坏时仍然全绿。
  {
    // 档 1a:同名 selftest 载体存在 → 零判红。**这格缺了的话,下面那两条负向档可能只是「恒红」**。
    name: "L11 档1:门禁有同名 selftest 载体 → 判绿",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    existingFiles: ["gates/repo/check-alpha.selftest.mjs"],
    expect: null,
  },
  {
    // 档 1a 的前缀变体:实测 `check-release-notes.mjs` 的载体叫 `release-notes.selftest.mjs`
    // (去掉了 `check-` 前缀)。只认带前缀的那一种会把这种合法命名判红 ⇒ 逼人改文件名。
    name: "L11 档1:载体名去掉 check- 前缀也算命中(实测 check-release-notes 的真实形态)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    existingFiles: ["gates/repo/alpha.selftest.mjs"],
    expect: null,
  },
  {
    // 档 1b:没有同名 selftest,但某个验收段的正文引用了该门禁的**无扩展名仓库相对路径**。
    // 这一档是 ADR-062 原判据改不掉的那一半:实测**多道门禁共用一个验收段**是本仓既有事实
    // (`test/gates/supply-chain.test.js` 同时是 sbom/sca/licenses/fulltext 四项的载体),
    // 纯路径派生对「共用段」结构性无解 ⇒ 没有这一档,那 23 项会当场判红。
    name: "L11 档1:无同名 selftest,但有验收段引用该门禁的仓库相对路径 → 判绿(共用段形态)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    segmentBodies: { "test/gates/shared.test.js": 'import x from "../../gates/repo/check-alpha.mjs";\n' },
    expect: null,
  },
  {
    // 档 2:无载体但已登记豁免且 reason 达标 → 判绿。
    name: "L11 档2:无载体但在门禁级豁免表登记且 reason 达标 → 判绿",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    exemptions: [{ gate: "alpha", reason: "该门禁的判定面由链上验收段一并覆盖,已逐条审过,补载体会重复跑同一批负向夹具" }],
    expect: null,
  },
  {
    // 档 3:两者皆无 → 判红。**这格是 L11 存在的全部意义**:它抓的是「无人能证明这道门禁坏掉时会红」。
    name: "L11 档3:既无同名载体也无验收段引用且不在豁免表 → 判红并点名该门禁",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    expect: /alpha → gate-has-carrier:该门禁\(gates\/repo\/check-alpha\.mjs\)既没有同名 selftest 载体[\s\S]*没有任何验收段引用它/,
    // 反向断言:诊断必须点名**两条正当出路**。只断「判红」的话,一条只会说「缺载体」的
    // 诊断同样能过,而那等于逼人猜该怎么办。
    expectAlso: /补一份负向载体[\s\S]*登记进 .*并写明理由/,
  },
  {
    // 档 3 的**可归因性**:两门禁里只有一个缺载体,诊断必须只点名那一个。
    // 少了 expectAbsent,「逐条点名」这件事无人证明 —— 实现若每条都点名全表也照样绿。
    name: "L11 档3:两门禁中只有一个缺载体 → 只点名缺的那个",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha"), beta: GATE("beta") },
    existingFiles: ["gates/repo/check-beta.selftest.mjs"],
    expect: /alpha → gate-has-carrier/,
    expectAbsent: /beta → gate-has-carrier/,
  },
  {
    // 档 1b 的**收窄口径**:basename 口径会把「正文里偶然出现过这个词」当成载体(假绿)。
    // 实测放宽到 basename 时 `smoke` 会匹配到 14 个段。收窄后这一格必须判红。
    name: "L11 档1b 的口径是「无扩展名的完整仓库相对路径」,不是 basename(否则正文偶然出现即算载体)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    // 只出现 basename,不出现完整路径 ⇒ 不算载体。
    segmentBodies: { "test/gates/misc.test.js": '// 这里只是提到了 check-alpha 这个名字\nexport const x = 1;\n' },
    expect: /alpha → gate-has-carrier/,
  },
  {
    // 豁免表三档 fail-closed ①:**读表本身**失败 → 判红。走 `loadGateExemptions` 的真实读盘
    // 路径(不是注入面):注入面按构造永远「读得到」,那一档就无人验证了。
    // 静默当空表会让表里那些合法表项一并失效,而门禁只是变红 —— 没人知道红的原因是表坏了。
    name: "L11 豁免表:读不到 → 判红(不得静默当空表,须走真实读盘路径)",
    gateExemptionLoad: "missing",
    expect: /门禁级豁免表读不到或不是合法 JSON/,
  },
  {
    // ① 的第二形态:文件在,但**不是合法 JSON**(比如被一次坏合并截断)。
    // 缺它的话,「不是合法 JSON」这一半无人发现 —— 而它与「文件不在」的处置是同一条分支,
    // 两者的失效形态相同(表静默消失)。
    name: "L11 豁免表:文件在但不是合法 JSON → 判红(坏合并会让整张表静默消失)",
    gateExemptionLoad: "corrupt",
    expect: /门禁级豁免表读不到或不是合法 JSON/,
  },
  {
    // ②:缺 entries 数组 → 判红。**这是最隐蔽的一档**:JSON 合法、文件在,但没有 `entries` 键
    // ⇒ `Array.isArray(undefined)` 为 false。若实现写成 `raw.entries ?? []`,这张表会被
    // 永久当成空表,而门禁只会一直落档 3,没人知道表本身坏了。
    name: "L11 豁免表:合法 JSON 但缺 entries 数组 → 判红(不得按 ?? [] 当空表)",
    gateExemptionLoad: "no-entries",
    expect: /门禁级豁免表缺 entries 数组/,
  },
  {
    // ① 的正向对照:表真的读得到(哪怕是空的)才不报上面那三档。
    // 缺它的话,「读不到」那一档可能是因为「永远读不到」而恒红 —— 那不是 fail-closed,是恒红。
    name: "L11 豁免表:表读得到(空表) → 三档皆不报",
    gateExemptionLoad: "empty",
    expect: null,
  },
  {
    // C3 豁免表三档 fail-closed ①:**读表本身**失败 → 判红。走 `loadGateSubjectExemptions`
    // 的真实读盘路径(不是注入面):注入面按构造永远「读得到」,那一档就无人验证了。
    //
    // ⚠ 这一档是**搬成数据文件新引入**的(落在模块常量形态时它不存在 —— 表与本体同体,
    // 读不到就是编译不过)。静默当空表的后果在 C3 上比另两张表更隐蔽:空表让每一条门禁边
    // 落进「未登记」,**症状看起来仍然正确**(确实判红了),但归因指向的是「段的层归属可疑」
    // 而不是「表不见了」—— 处置会把人领去搬段,搬完表还是红的,而表仍然没人找。
    name: "C3 豁免表:读不到 → 判红(不得静默当空表,须走真实读盘路径)",
    gateSubjectExemptionLoad: "missing",
    expect: /门禁主体豁免表读不到或不是合法 JSON/,
  },
  {
    // ① 的第二形态:文件在,但**不是合法 JSON**(比如被一次坏合并截断)。
    name: "C3 豁免表:文件在但不是合法 JSON → 判红(坏合并会让整张表静默消失)",
    gateSubjectExemptionLoad: "corrupt",
    expect: /门禁主体豁免表读不到或不是合法 JSON/,
  },
  {
    // ②:缺 entries 数组 → 判红。**这是最隐蔽的一档**:JSON 合法、文件在,但没有 `entries` 键
    // ⇒ `Array.isArray(undefined)` 为 false。若实现写成 `raw.entries ?? []`,这张表会被
    // 永久当成空表,而门禁只会一直报「未登记」,没人知道表本身坏了。
    name: "C3 豁免表:合法 JSON 但缺 entries 数组 → 判红(不得按 ?? [] 当空表)",
    gateSubjectExemptionLoad: "no-entries",
    expect: /门禁主体豁免表缺 entries 数组/,
  },
  {
    // ① 的正向对照:表真的读得到(哪怕是空的)才不报上面那三档。
    // 缺它的话,「读不到」那一档可能是因为「永远读不到」而恒红 —— 那不是 fail-closed,是恒红。
    name: "C3 豁免表:表读得到(空表) → 三档皆不报",
    gateSubjectExemptionLoad: "empty",
    expect: null,
  },
  {
    // 豁免表 ②:键名写错(缺 gate)→ 判红。跳过它等于给「写错键名」开了一个静默放行的口:
    // 它拿到的键永远命中不上,于是那道门禁一直落档 3,而没人知道表里其实有一条。
    name: "L11 豁免表:表项缺 gate 键 → 判红(键名写错会让豁免静默失效)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    exemptions: [{ reason: "没有 gate 键,这条豁免拿到的键永远命中不上" }],
    expect: /第 1 项缺 gate/,
  },
  {
    // 档 2 的 reason 门槛:与 L5 同判准(≥REASON_MIN_CHARS 字,按码点)。
    // 写不出「为什么这道门禁可以没有载体」时,该做的是补载体而不是塞进表里。
    name: "L11 豁免表:登记了但 reason 不足门槛 → 判红(空/见谅式理由挡不住下次先豁免后补)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    exemptions: [{ gate: "alpha", reason: "见谅" }],
    expect: new RegExp(
      `alpha → gate-has-carrier:该门禁无载体、已在门禁级豁免表登记.*但 reason 只有 2 字,不足门槛 ${REASON_MIN_CHARS} 字`,
      "s",
    ),
  },
  {
    // stale(ratchet):登记了却当前**已有**载体 ⇒ 表项必须同批删掉。
    // 没有这一条,表只会单调增长、失效项永远占着位子,而门禁对它们一声不吭。
    name: "L11 豁免表:表项当前不再需要(门禁已补上载体)→ 判红(ratchet)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    existingFiles: ["gates/repo/check-alpha.selftest.mjs"],
    exemptions: [{ gate: "alpha", reason: "曾经合法,载体后来补上了,这条表项应当同批删掉才符合 ratchet 的要求" }],
    expect: /alpha → gate-has-carrier:门禁级豁免表登记了 alpha,但它现在已有载体/,
  },
  {
    // stale 的第二种形态:门禁已从清单里消失。载体判据不看它,但表项仍在 ⇒ 同样判红。
    name: "L11 豁免表:表项的门禁已不在清单里 → 判红(门禁已删,豁免必须同批删掉)",
    gateFamily: "l11",
    gates: { alpha: GATE("alpha") },
    existingFiles: ["gates/repo/check-alpha.selftest.mjs"],
    exemptions: [{ gate: "gone-gate", reason: "这道门禁已经不存在了,表项本该在同一次改动里被删掉" }],
    expect: /gone-gate → gate-has-carrier:门禁级豁免表登记了 gone-gate,但门禁清单里没有这一项/,
  },
  {
    // 门禁清单缺字段 ⇒ 判红**而不是跳过**:跳过等于让那道门禁从 L11/L12 两族里凭空消失,
    // 而消失形态是「门禁变绿」而不是「变红」—— 纯文本门禁最坏的失效形态。
    name: "L11 门禁索引:缺 modulePath → 判红(不得跳过,跳过会让这道门禁凭空消失)",
    gateFamily: "l11",
    registryProblems: true,
    gates: { alpha: { id: "alpha", access: ACCESS_CHAIN, npmScripts: ["check:alpha"] } },
    expect: /门禁索引 alpha 缺 modulePath/,
  },
  // ---- L11b gate-module-present:清单在册而树里无(S3 补的那一档)----
  //
  // **为什么这一族在 S2 缺、到 S3 才补**:S2 把 L11 的判定面收窄到「本求值根里真实存在的门禁」,
  // 门禁本体被**删除**时它会静默离开判定面。那天靠旧 registry.mjs 的 R4(`judgment.module` 指针
  // 解析不到)与 check-import-boundary 兜着 —— 但 **R1–R5c 全部随 S4 消失**,届时无人守。
  //
  // **为什么这一族不走 `judgeGate`(直调判定本体)**:它判的是「判定面**怎么圈**」,而圈法在
  // `checkTestLayout` 里(判据本体拿不到 ctx.fileExists 之外的求值根身份)。故这三格走 `judge()`
  // 在合成根上求值 —— 合成根必须**先放一份索引模块占位**(那是「本根就是索引描述的那棵树」的
  // 判据),否则整段与本轮无关。
  {
    name: "L11b:索引在册而门禁本体不在树里(本体被删/改名)→ 判红并点名该门禁与它的 modulePath",
    judgeOnly: true,
    extra: {
      // 索引模块在场 ⇒ 本求值根就是索引描述的那棵树(L11b 的范畴边界,见判定本体里的注释)。
      [GATE_INDEX_MODULE_REL]: "export const GATE_INDEX = {};\n",
      // scripts 表:L12 的输入。`check:beta` 真在 verify:ci 链上(它只判 beta,那一格与本族无关)。
      "package.json": `${JSON.stringify({
        scripts: {
          "verify:ci": "npm run check:beta",
          "verify:release": "npm run verify:ci && npm run dist",
          dist: "npm run clean:dist",
          "clean:dist": "node tools/clean.mjs",
          "check:beta": "node gates/repo/check-beta.mjs",
        },
      })}\n`,
      "gates/repo/check-beta.mjs": "export const beta = 1;\n",
      "gates/repo/check-beta.selftest.mjs": "export const covered = 1;\n",
      // `gates/repo/check-gone.mjs` **刻意不造**:它就是被删掉的那一道门禁。
    },
    gateRegistry: {
      beta: { id: "beta", access: ACCESS_CHAIN, npmScripts: ["check:beta"], modulePath: "gates/repo/check-beta.mjs" },
      gone: { id: "gone", access: ACCESS_CHAIN, npmScripts: ["check:gone"], modulePath: "gates/repo/check-gone.mjs" },
    },
    expect: /→ gate-module-present:gone 在索引里在册,但门禁本体 gates\/repo\/check-gone\.mjs 在本求值根里不存在/,
  },
  {
    // **反向锚点**:索引在册的每一项都在树里 ⇒ 本族零判红。缺它的话,上一格可能只是「恒红」——
    // 而 L11b 的正确形态恰恰是「平时全绿,删掉一个模块才红」。
    name: "L11b:索引在册而每一项都在树里 → 零判红(反向锚点:证明上一格的红来自缺件本身)",
    judgeOnly: true,
    extra: {
      [GATE_INDEX_MODULE_REL]: "export const GATE_INDEX = {};\n",
      "package.json": `${JSON.stringify({
        scripts: {
          "verify:ci": "npm run check:beta",
          "verify:release": "npm run verify:ci && npm run dist",
          dist: "npm run clean:dist",
          "clean:dist": "node tools/clean.mjs",
          "check:beta": "node gates/repo/check-beta.mjs",
        },
      })}\n`,
      "gates/repo/check-beta.mjs": "export const beta = 1;\n",
      "gates/repo/check-beta.selftest.mjs": "export const covered = 1;\n",
    },
    gateRegistry: {
      beta: { id: "beta", access: ACCESS_CHAIN, npmScripts: ["check:beta"], modulePath: "gates/repo/check-beta.mjs" },
    },
    expect: null,
  },
  {
    // **范畴边界的反向锚点(与前两格成对)**:索引模块**不在**本求值根里 ⇒ 这一棵树不是索引描述的
    // 那棵树(合成根就是这样:它只造 test/ 布局,根本没有 gates/),此时「在册而树里无」是**事实**
    // 而不是违例。少了这一格,L11b 会恒红,而恒红是纯文本门禁最坏的失效形态。
    name: "L11b:索引模块不在本求值根里(合成根)→ 本族与 L11/L12 整段不适用,零判红",
    judgeOnly: true,
    extra: {},
    gateRegistry: {
      gone: { id: "gone", access: ACCESS_CHAIN, npmScripts: ["check:gone"], modulePath: "gates/repo/check-gone.mjs" },
    },
    expectAbsent: /gate-module-present/,
    expect: null,
  },
  // ---- L12 / L12c gate-chain-membership:两向 + 取值域 + pendingChain ----
  {
    // L12 的**正向锚点**:声明 chain 且接入点真在链上 → 零判红。
    // 缺它的话,下面两条负向夹具可能只是「恒红」—— 没人能证明合法形态真的能过。
    name: "L12 正向锚点:access=chain 且接入点真在链上 → 零判红",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { npmScripts: ["check:contract"] }) },
    expect: null,
  },
  {
    // 两向之一:chain 的**必须**真在链上。声明在链上而实际不在 =「没人跑它」的最短路径。
    name: "L12 方向一:access=chain 但接入点不在任何链上 → 判红",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { npmScripts: ["check:never-on-any-chain"] }) },
    expect: /alpha → gate-chain-membership:access 声明 chain,但 `check:never-on-any-chain` 不在 verify:ci \/ verify:release \/ dist 任一条链上/,
  },
  {
    // 两向之二:offchain 的**不得**在链上。声明与事实相反同样是无声的漂移。
    name: "L12 方向二:access=offchain 但接入点真在链上 → 判红(声明与事实相反)",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { access: ACCESS_OFFCHAIN, npmScripts: ["check:contract"] }) },
    expect: /alpha → gate-chain-membership:access 声明 offchain,但 `check:contract` 真在 verify:ci \/ verify:release \/ dist 上/,
  },
  {
    // 反向锚点:offchain 且确实不在链上 → 零判红。
    name: "L12 反向锚点:access=offchain 且接入点确实不在链上 → 零判红",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { access: ACCESS_OFFCHAIN, npmScripts: ["check:never-on-any-chain"] }) },
    expect: null,
  },
  {
    // 取值域:旧表的三值(`local`/`workflow`)不在两值域内。**S3 迁移完成后本档在真实仓库上恒为零
    // 命中**,它留着的理由是「旧 registry.mjs 的三值若被原样搬进新表,判据要指名道姓地说出来」。
    name: "L12 取值域:access=local(S3 的旧取值)→ 判红并点名它是旧值",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { access: "local", npmScripts: ["check:never-on-any-chain"] }) },
    expect: /alpha → gate-chain-membership:access 取值「local」不在取值域内\(只允许 chain \/ offchain\) —— 它是 ADR-062 S3 的旧取值\(gate-index\.mjs 已把它收成 offchain\)/,
  },
  {
    // workflow 那一档与二分不对齐(在 CI 上但不在三条链上),这是两值化的直接理由。
    // 它也是 `gate-index.mjs` 里 `env` / `supply` 两项的真实迁移路径(降格为 offchain)。
    name: "L12 取值域:access=workflow 同样判红(该档与二分不对齐,已收成 offchain)",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { access: "workflow", npmScripts: ["check:never-on-any-chain"] }) },
    expect: /access 取值「workflow」不在取值域内/,
  },
  {
    // L12c:offchain 带 pendingChain 且理由达标 → 零判红(这一格是 L12c 存在的正向证明)。
    name: "L12c:offchain 带 pendingChain 且理由达标 → 零判红(显式登记是合法形态)",
    gateFamily: "l12",
    gates: {
      alpha: GATE("alpha", {
        access: ACCESS_OFFCHAIN,
        npmScripts: ["check:never-on-any-chain"],
        pendingChain: "本应进链,但它当前判红项数与链上验收段重复,待 S3 一并迁移",
      }),
    },
    expect: null,
  },
  {
    // L12c 的负档:声明了却写不出理由 ⇒ 与「没声明」在门禁上不可区分,而那正是它要消灭的失效形态。
    name: "L12c:offchain 带 pendingChain 但理由不足门槛 → 判红(挂着标记却说不出为什么)",
    gateFamily: "l12",
    gates: {
      alpha: GATE("alpha", {
        access: ACCESS_OFFCHAIN,
        npmScripts: ["check:never-on-any-chain"],
        pendingChain: "见谅",
      }),
    },
    expect: new RegExp(
      `alpha → gate-chain-membership:声明了 pendingChain,但理由只有 2 字,不足门槛 ${REASON_MIN_CHARS} 字`,
    ),
  },
  {
    // pendingChain **只对 offchain 有意义**:access=chain 却带它,声明本身自相矛盾
    // (它已在链上,「本应进链」无从谈起)。判红而不是放过。
    name: "L12c:access=chain 却带 pendingChain → 判红(声明自相矛盾)",
    gateFamily: "l12",
    gates: {
      alpha: GATE("alpha", {
        npmScripts: ["check:contract"],
        pendingChain: "本应进链",
      }),
    },
    expect: /alpha → gate-chain-membership/,
  },
  {
    // **递归展开**的牙齿:门禁挂在子脚本上、而子脚本被链根引用 ⇒ 必须在链上。
    // 判据若退化成扁平 `split('&&')`,这一格立刻判红 —— 那正是 chain-expand.mjs 单源化的理由
    // (「门禁在链上」被静默降级成「不在链上」而没有任何东西报红)。
    name: "L12:门禁挂在子脚本上、子脚本被链根引用 → 零判红(证明走的是递归展开而非扁平 split)",
    gateFamily: "l12",
    scripts: {
      "verify:ci": "npm run ci:static && npm run check:alpha",
      "ci:static": "npm run check:static",
      "check:static": "node gates/repo/check-static.mjs",
      "check:alpha": "node gates/repo/check-alpha.mjs",
      "verify:release": "npm run verify:ci && npm run dist",
      dist: "npm run clean:dist",
      "clean:dist": "node tools/clean.mjs",
    },
    gates: { alpha: GATE("alpha", { npmScripts: ["check:alpha"] }) },
    expect: null,
  },
  {
    // 与上一条成对:子脚本**没有**被链根引用时,扁平实现会**判绿**(看不见内层),
    // 递归实现才判红。少了它,上一格可能只是「碰巧对」。
    name: "L12:门禁挂在子脚本上但子脚本不在链上 → 判红(递归展开看得见内层,扁平 split 看不见)",
    gateFamily: "l12",
    scripts: {
      "verify:ci": "npm run check:static",
      "check:static": "node gates/repo/check-static.mjs",
      "check:alpha": "node gates/repo/check-alpha.mjs",
      "verify:release": "npm run verify:ci && npm run dist",
      dist: "npm run clean:dist",
      "clean:dist": "node tools/clean.mjs",
    },
    gates: { alpha: GATE("alpha", { npmScripts: ["check:alpha"] }) },
    expect: /alpha → gate-chain-membership:access 声明 chain/,
  },
  {
    // **CHAIN_ROOTS 派生**的牙齿:门禁的接入点**只被一条非链根 script 引用**时判红,
    // 而诊断必须**逐字列出全部三条链根**。若实现把链根写死成两条(漏了 dist)、
    // 或诊断只列其中一部分,这一格就会翻脸。
    // ⚠ `dev:loop` 是第四条 script,**没有任何链根引用它** ⇒ `check:alpha` 不可达。
    // (⚠ 别把它挂在 `dist` 下面:`dist` 本身就是链根,挂上去就可达了 —— 那正是下一格。)
    // ⚠ 断言从 `CHAIN_ROOTS` **现算**该串(不手抄):手抄的那份会在链根变更时静默说谎,
    // 而「判定面含哪几条链」正是本条要钉的东西。
    name: "L12:门禁只被非链根 script 引用 → 判红,且诊断逐字列出全部 CHAIN_ROOTS",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { npmScripts: ["check:alpha"] }) },
    scripts: {
      "verify:ci": "npm run check:contract",
      "verify:release": "npm run verify:ci && npm run dist",
      dist: "npm run clean:dist",
      "clean:dist": "node tools/clean.mjs",
      "dev:loop": "npm run check:alpha",
      "check:alpha": "node gates/repo/check-alpha.mjs",
      "check:contract": "node gates/repo/check-ci-contract.mjs",
    },
    expect: new RegExp(
      `不在 ${CHAIN_ROOTS.map((root) => root.replace(/:/g, "\\:")).join(" \\/ ")} 任一条链上`,
    ),
  },
  {
    // 与上一条成对:同一条 script,在**它自己就是链根的子命令**的形态下必须在链上。
    // 缺它的话,上一格可能只是「因为判据恒红」—— 这一格证明判定面**认得出**在链上的形态。
    name: "L12:门禁挂在 dist 链根自身的 script 上 → 零判红(与上一条成对,证明不是恒红)",
    gateFamily: "l12",
    gates: { alpha: GATE("alpha", { npmScripts: ["dist-only:check"] }) },
    scripts: {
      "verify:ci": "npm run check:contract",
      "verify:release": "npm run verify:ci && npm run dist",
      dist: "npm run dist-only:check",
      "dist-only:check": "node gates/artifacts/check-dist-only.mjs",
      "check:contract": "node gates/repo/check-ci-contract.mjs",
    },
    expect: null,
  },
  {
    // 门禁清单缺 access ⇒ 判红(取值域判据无从核对),不得跳过。
    name: "L12 门禁索引:缺 access → 判红(取值域判据无从核对)",
    gateFamily: "l12",
    registryProblems: true,
    gates: { alpha: { id: "alpha", npmScripts: ["check:alpha"], modulePath: "gates/repo/check-alpha.mjs" } },
    expect: /门禁索引 alpha 缺 access/,
  },
  // ---- 进程级档:退出码与两通道的接线 ----
  // ⚠ 这一族原先成对存在「默认档 exit 0 / --enforce exit 1」。`--enforce` 已删(不留兼容):
  // 该开关一旦存在,「哪些族进哪档」的知识就同时存在于 CRITERIA 与命令行两处。
  // 下面几条改为钉「判红即 exit 1」＋「report-only 族不改退出码」这一对新事实。
  {
    name: "判红 ⇒ exit 1(无开关:命令行不能改变任何一族的强制等级)",
    cli: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    expectCode: 1,
    expect: /test\/core\/runner-report\.test\.js → test-layer-self-hosted/,
  },
  {
    name: "零判红 ⇒ exit 0(反向锚点:证明上一条的红来自判红本身)",
    cli: true,
    extra: {},
    expectCode: 0,
    expect: /\[ok\] test 布局判据通过/,
  },
  {
    // ⚠ 本条与下一条**必须成对存在**:一条钉「report-only 族不改退出码」,一条钉
    // 「fail-closed 族改退出码」。少了任一条,「L7 到底有没有真的只报告」就无人证明 ——
    // 只断 exit 1 的话,「恒 exit 0」的旧实现也能全绿。
    // 树里只有 L7 一族红(段在已登记的层内且本层主体齐备,故 L4/L5/L6/L8 都不命中)。
    name: "report-only 族:整棵树只有 L7 命中 ⇒ exit 0,且诊断逐条打在 info 行上",
    cli: true,
    extra: { [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT },
    expectCode: 0,
    expect: /\[test-layout:pending\] test\/misc → test-top-dirs-exact:test\/ 顶层多出目录「misc\/」/,
  },
  {
    // 与上一条成对的 fail-closed 侧:同样只有一族红,但那一族已转判红 ⇒ exit 1。
    name: "fail-closed 族:整棵树只有 L5 跨层命中 ⇒ exit 1(转判红的进程级证据)",
    cli: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    expectCode: 1,
    expect: /\[test-layout:fail\] test\/core\/heading-scale\.test\.js → test-layer-cross-import/,
  },
  {
    // 计数器的夹具:上面两条只钉住「缺目录」那条**诊断文案**,钉不住 `stats.l7Missing` 这个
    // 计数器 —— 把 `l7Missing += 1` 改成 `+= 0` 时那两条仍全绿(实测:变异后 0 条失败),
    // 而结论行会少报一档。因此这里从 CLI 侧钉死计数:造一棵**只缺、不多**的树,
    // 断言 `多 0 / 缺 1`。多/缺两档各自独立可归因,一档塌了另一档不会把它盖住。
    name: "L7:只缺一档时计数为「多 0 / 缺 1」(钉住 l7Missing 计数器本身)",
    cli: true,
    // 删掉空的 `shared/` 而不是 `renderer/`:前者**一个段都没有**(基板只往六个 src 层
    // 铺段),故删它不动扫描面,不会顺带引出「扫描面塌缩」那条无关判红 —— 那样这条夹具
    // 验的就变成两族判据的叠加,`l7Missing` 塌了也被别的原因顶住出口码。
    extra: {},
    // ⚠ L7 是 report-only ⇒ 这一格的退出码是 **0**:它验的是**计数与诊断**,不是退出码
    // (退出码由上面那对成对夹具负责)。此前这里带 `--enforce` 拿 exit 1,开关删掉后必须改。
    expectCode: 0,
    // `expect` 必须是真 regex:判据档用 `expect === null` 表示「零判红」,而本条在进程级档
    // 里恰恰**有**一条诊断(缺 shared/,打在 info 行上)。
    expect: /test\/shared → test-top-dirs-exact:test\/ 顶层缺目录「shared\/」/,
    expectCount: /L7 test-top-dirs-exact 多 0 \/ 缺 1/,
    removeTopDir: "shared",
  },
  {
    name: "输出五族计数并点名判红文件(验收口径 ①②)",
    cli: true,
    extra: {
      [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT,
      [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT,
    },
    // 树里 L4 与 L7 各一条:L4 已转 fail-closed ⇒ 整场 exit 1(L7 的那条只影响 info 通道)。
    expectCode: 1,
    expect: /L4 test-layer-self-hosted 判红 1 项.*L5 test-layer-cross-import 命中 \d+ 处.*L7 test-top-dirs-exact 多 1 \/ 缺 0.*L8 test-harness-not-segment 判红 0 项.*点名文件:.*runner-report/s,
  },
  {
    name: "--help 打印由登记表派生的强制等级计数并 exit 0",
    cli: true,
    extra: {},
    args: ["--help"],
    expectCode: 0,
    // 两个数都由 CRITERIA 现算,**不写死条数**:加一族/删一族那天写死的数字会静默说谎,
    // 而「还剩几族 report-only」正是待转正进度唯一的读数。
    expect: new RegExp(
      `强制等级\\(由本文件 CRITERIA 派生\\):${CRITERIA.length - PENDING_ROWS} 族 fail-closed`
      + `.*${PENDING_ROWS} 族 report-only`,
      "s",
    ),
  },
  {
    name: "--enforce 已不存在(不得静默忽略未知参数)",
    cli: true,
    extra: {},
    args: ["--enforce"],
    expectCode: 1,
    expect: /无法识别的选项:--enforce/,
  },
  {
    name: "未知参数(不得静默按默认跑一遍)",
    cli: true,
    extra: {},
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    // 正向对照:真实仓库只被读。断言写成「计数自洽且退出码 0」而不是写死条数 ——
    // 写死会在判据集合变动那天变成一条自己把自己判红的夹具。
    name: "真实仓库:exit 0 且输出五族计数(L7 缺 1 走 info 通道,不计退出码)",
    realRepo: true,
    expectCode: 0,
    expect: /L4 test-layer-self-hosted 判红 \d+ 项.*L5 test-layer-cross-import 命中 \d+ 处.*L7 test-top-dirs-exact 多 \d+ \/ 缺 \d+.*L8 test-harness-not-segment 判红 \d+ 项/,
  },
  {
    name: "真实仓库:L4/L5/L6/L8 判红数自洽(自指层 + 声明通道 + 豁免表三件事任何一件回退都翻脸)",
    realRepo: true,
    expectCode: 0,
    // L4 的两格都归零(零本层主体 0 / 段 import 段 0)、L5 未登记/空 reason/不足门槛/stale 四档归零 ——
    // 后四档正是「L5 凭什么能转正」那个裁决的机械证据;L5 命中数不为零是合法的
    // (命中已登记在豁免表里且 reason 达标,豁免命中在判定本体里 continue、不产生 info 行)。
    // ⚠ 其中「不足 N 字判红 0」这一档同时是**「真实豁免表现有数据全部达标」的机器证据**:
    //   加门槛最坏的失效形态是「把现有 24 条全判红」,而这一档归零就是它的反证。
    //   它必须由判定本体**在真实仓库上**跑出来(不是读数据文件自己数字符)——
    //   否则就绕开了「walk 到那 24 条命中」这一步,证明不了门禁本身不误伤。
    // 退出码是 0,因为 L7「缺 test/tools/」是 report-only 档(空目录,已裁决不建)。
    expect: new RegExp(
      `L4 test-layer-self-hosted 判红 0 项\\(零本层主体 0 \\/ 段 import 段 0.*`
      + `未登记判红 0 \\/ 空 reason 判红 0 \\/ 不足 ${REASON_MIN_CHARS} 字判红 0 \\/ stale 判红 0`,
      "s",
    ),
  },
  {
    // 「加了门槛却把现有数据全判红」的**反证**,且刻意与上面那条分开:
    // 上面那条断言的是四档计数全零(退出码层面),这条额外钉住**豁免表本身非空**
    // (`豁免 [1-9]\d* 条`)—— 少了那半句,「不足 N 字判红 0」在表被清空时也会照样成立,
    // 而那恰恰是这道门槛最该防的失效形态(表空了 ⇒ 门槛一次也没被真正验证过 ⇒ 恒绿)。
    // ⚠ 计数由判定本体在**真实仓库**上跑出来,不是读数据文件自己数字符 ——
    //   后者绕开了「walk 到那些命中」这一步,证明不了门禁本体不误伤。
    name: "真实仓库:豁免表非空且 0 条因 reason 长度判红(门槛不误伤现有数据,且非空真被验证过)",
    realRepo: true,
    expectCode: 0,
    expect: new RegExp(
      `豁免 [1-9]\\d* 条 \\/ 未登记判红 0 \\/ 空 reason 判红 0 \\/ 不足 ${REASON_MIN_CHARS} 字判红 0`,
    ),
  },
  {
    // **C1 两档在真实仓库上零判红的机器证据**,且两个分母都由判定本体在**真实仓库**上跑出来
    // (不是读数据文件自己数)—— 后者绕开了「walk 到那 170 处被测 import」这一步,
    // 证明不了门禁本体不误伤。
    // ⚠ 分母**必须**同时断:「判红 0」在分母为 0 时也成立,那正是「这一族什么也没查」。
    // 实测分母:被测 import 落在 dist/** 的 170 处 / 段路径镜像了真实源文件的 4 段。
    name: "真实仓库:C1 两档判红 0 项且两个分母都非零(不误伤,且证明真被验证过)",
    realRepo: true,
    expectCode: 0,
    expect: new RegExp(
      `C1 test-dist-artifact-source-mirror 判红 0 项\\(被测 import 落在 dist/\\*\\* 共 [1-9]\\d* 处,`
      + `按构建产物路径反推的镜像源全部不存在者判红\\);`
      + `C1 test-segment-mirror-same-name 判红 0 项\\(段路径镜像了真实源文件的段共 [1-9]\\d* 段,`
      + `未落在同名编译产物上者判红\\)`,
    ),
  },
  {
    // **C3 在真实仓库上的四档归零 + 豁免表非空且真被命中**。
    // ⚠ 两侧都要断:只断「未登记判红 0」的话,表被清空时它照样成立,而那正是这道豁免最该防的
    // 失效形态(表空了 ⇒ 表项与 stale 一次也没被验证过 ⇒ 恒绿)。「命中 [1-9]\d* 处」证明
    // 表项**当前真的命中**(否则它会被 stale 判红,与「stale 判红 0」同义但方向相反)。
    name: "真实仓库:C3 命中已被登记且四档归零(豁免表非空、reason 达标、stale 为零)",
    realRepo: true,
    expectCode: 0,
    expect: new RegExp(
      `C3 test-layer-gate-subject 命中 [1-9]\\d* 处\\(豁免 [1-9]\\d* 条 \\/ 未登记判红 0`
      + ` \\/ 不足 ${REASON_MIN_CHARS} 字判红 0 \\/ stale 判红 0\\)`,
    ),
  },
  {
    // **门禁树侧那族的分母在真实仓库上非零**(= 它真的被验证过,不是恒绿)。
    //
    // ⚠ 分母**必须**断:「未接入 0 份」在分母为 0 时也成立,而那正是这一族最坏的失效形态
    // (`.selftest.mjs` 的发现规则写错 / 扫描根常量漂了 ⇒ 一份都扫不到 ⇒ 零命中 ⇒ 全绿)。
    // 合成根那几条反向锚点证明不了这一格:合成根里本来就常常零份自测。
    //
    // ⚠ **命中数写死是不允许的**:这一族随 #09 的搬迁逐份归零,写死会在搬迁那天变成一条
    // 自己把自己判红的夹具。故只断「分母非零」+「未接入数 ≤ 分母」(后者的正则天然成立,
    // 它的作用是把分母与命中数**写进同一条断言**,让读数时不必回头找另一条)。
    name: "真实仓库:门禁自测那族的分母非零(证明真被扫到,不是零扫描面下的恒绿)",
    realRepo: true,
    expectCode: 0,
    expect: new RegExp(
      `gates-selftest-named-case 未接入 \\d+ 份\\(未 import 契约模块 \\d+ \\/ `
      + `import 了却一次没调 \\.case\\( \\d+;分母是 ${GATES_SELFTEST_ROOT}/\\*\\* 下全部 `
      + `[1-9]\\d* 份 \\.selftest\\.mjs\\)`,
    ),
  },
];

const suite = createCaseSuite();

/**
 * 跑一档夹具(收进 `suite.case` 的断言体;抛错只记该档失败,不中断后续档)。
 *
 * 搬迁口径:原 `failures.push(消息)` 逐条改成 `throw new Error(消息)` —— **消息逐字沿用**;
 * 原「按分支 continue 到下一档」改成 `return`(push 后紧跟 continue 的成对形态,continue 随
 * push 一并消失);原循环外那条兜底 catch(它把异常 stack 拼进失败消息)整条删除,异常由
 * case 级 catch 收成这一档失败。
 * @param {object} testCase 夹具表里的一档
 */
function runOne(testCase) {
  if (testCase.sourceAuditMutation !== undefined) {
    // 变异档:给同一个抽取器喂一份**改过的**源码/表,断言它**判红**。
    // 为什么不 spawn 也不写文件:变异要证明的是「抽取器 + 对账逻辑有牙齿」,
    // 而牙齿在逻辑上;真去改本体文件反而让自检变成一个会写工作树的脚本。
    // 反过来说:如果这份变异**没有**判红,那本体上的那条正向断言就毫无意义 ——
    // 「两向都空即平」的抽取器能让任意错登记全绿(见这条夹具的注释)。
    const source = readFileSync(checkerPath, "utf8");
    const zombie = testCase.sourceAuditMutation === "zombie";
    const drift = zombie
      ? auditSourceCriteria(source, [...CRITERIA, { id: "test-family-deleted-long-ago" }])
      : auditSourceCriteria(
        `${source}\n// 变异:多出一族未登记的判据\nconst _x = "y → test-new-family:某段命中";\n`,
      );
    const caught = zombie ? drift.tableOnly.length > 0 : drift.sourceOnly.length > 0;
    if (caught) {
      console.log(`[ok] test-layout-selftest:${testCase.name}(变异被拦截:${zombie ? "僵尸行" : "漏登记"})`);
    } else {
      throw new Error(
        `${testCase.name}:变异未被拦截(${zombie ? "僵尸行" : "漏登记"})⇒ 本档的抽取器没有牙齿`,
      );
    }
    return;
  }
  if (testCase.sourceAudit === true) {
    // 静态档:读**门禁本体源码**,不 spawn、不碰夹具。它断两件事,各自独立可归因:
    //   ① 源码 id 集合 ⟷ CRITERIA **双向**相等(第一向=漏登记,第二向=僵尸行);
    //   ② 每个 `pending: true` 带非空 `pendingReason`(语义层)。
    // ⚠ ① 与本体行锚形态**刻意耦合**(见 auditSourceCriteria 的注释),不要去「修」它。
    // ⚠ ② 之所以只断「非空」而不校验理由内容:理由是给人读的判断,门禁能机械判的只有
    // 「有没有写」—— 试图校验内容就变成门禁替人下结论,而那正是判据不该做的事。
    const drift = auditSourceCriteria();
    const noReason = CRITERIA
      .filter((entry) => entry.pending === true && (entry.pendingReason ?? "").trim() === "")
      .map((entry) => entry.id);
    if (drift.sourceOnly.length > 0) {
      throw new Error(
        `${testCase.name}:源码发出但 CRITERIA 未登记的 id:${drift.sourceOnly.join(", ")}`
        + "(漏登记 ⇒ 那一族的强制等级无人负责;在 CRITERIA 里补一行,或确认该族已删、连 report 一起去)",
      );
    }
    if (drift.tableOnly.length > 0) {
      throw new Error(
        `${testCase.name}:CRITERIA 里有僵尸行(源码已不再发出):${drift.tableOnly.join(", ")}`
        + "(僵尸行让门禁文件头那条 grep 进度锚的命中数说谎 —— 那正是「还剩几族待转正」的唯一读数)",
      );
    }
    if (noReason.length > 0) {
      throw new Error(
        `${testCase.name}:pending: true 但 pendingReason 为空的族:${noReason.join(", ")}`
        + "(挂待办标记却说不出为什么,与说得清为什么在门禁上不可区分)",
      );
    }
    console.log(
      `[ok] test-layout-selftest:${testCase.name}`
      + `(双向相等:${CRITERIA.length} 族 / report-only ${PENDING_ROWS} 族且每族都有 pendingReason)`,
    );
    return;
  }
  if (testCase.unit === true) {
    // 抽取层直测:断言条数与逐条 (spec, typeOnly, resolved),顺序按「值在前、注释型在后」
    // (实现里两半的收集顺序)。断条数是这一档的重点:多收一条(同一条被收两遍)在逐条比对里
    // 也看得见,但断条数能让失败消息直接指出「多了/少了几条」。
    const refs = extractImports(testCase.text, testCase.file);
    const actual = refs.map((r) => ({ spec: r.spec, typeOnly: r.typeOnly, resolved: r.resolved }));
    const want = testCase.expectRefs;
    const shape = (/** @type {{ spec: string, typeOnly: boolean, resolved?: string | null }[]} */ list) =>
      list.map((r) => `${r.spec}|typeOnly=${String(r.typeOnly)}|resolved=${String(r.resolved ?? null)}`);
    const actualSorted = [...actual].sort((a, b) => a.spec.localeCompare(b.spec));
    const wantSorted = [...want].sort((a, b) => a.spec.localeCompare(b.spec));
    const same = actualSorted.length === wantSorted.length
      && actualSorted.every((r, i) => {
        const w = wantSorted[i];
        return w !== undefined && r.spec === w.spec && r.typeOnly === w.typeOnly
          && (r.resolved ?? null) === (w.resolved ?? null);
      });
    if (same) {
      console.log(`[ok] test-layout-selftest:${testCase.name}(${actual.length} 条 / ${shape(actual).join(" · ")})`);
    } else {
      throw new Error(
        `${testCase.name}:期望 ${wantSorted.length} 条 [${shape(wantSorted).join(" · ")}],`
        + `实际 ${actualSorted.length} 条 [${shape(actualSorted).join(" · ")}]`,
      );
    }
    return;
  }
  if (testCase.caseExtract === true) {
    // ⑯ 族取名层的直测:合成一段源码,按给定策略抽 case 名,逐条与期望比对。
    // ⚠ **这一档与「整族」那几档互不替代**:整族档验的是「两向差集会不会报」,
    // 这一档验的是「抽出来的是不是**那几条**」—— 抽错名字(多收/少收/收成别的字段)
    // 在整族档上表现为「名册与源码恰好也相等」而**恒绿**。
    const got = extractGateCaseNames(testCase.text, testCase.strategies);
    const want = [...testCase.expectNames];
    if (got.length === want.length && got.every((name, i) => name === want[i])) {
      console.log(`[ok] test-layout-selftest:${testCase.name}(${got.length} 条 / ${got.join(" · ") || "(零条)"})`);
    } else {
      throw new Error(
        `${testCase.name}:期望 ${want.length} 条 [${want.join(" · ")}],`
        + `实际 ${got.length} 条 [${got.join(" · ")}]`,
      );
    }
    return;
  }
  if (testCase.gateExemptionLoad !== undefined) {
    // 读表档:走 `loadGateExemptions` 的**真实读盘路径**(临时合成根),
    // 而不是注入面 —— 注入面按构造永远「读得到」,那一档就无人验证了。
    // 四种形态各一:文件不在 / 文件在但 JSON 坏了 / JSON 合法但缺 entries / 表读得到。
    const dir = mkdtempSync(join(tmpdir(), "m2w-gate-exempt-selftest-"));
    try {
      if (testCase.gateExemptionLoad === "corrupt") {
        writeUnder(dir, GATE_EXEMPTIONS_REL, "{ this is not json ");
      } else if (testCase.gateExemptionLoad === "no-entries") {
        writeUnder(dir, GATE_EXEMPTIONS_REL, `${JSON.stringify({ _comment: "缺 entries 键" }, null, 2)}\n`);
      } else if (testCase.gateExemptionLoad === "empty") {
        writeUnder(dir, GATE_EXEMPTIONS_REL, `${JSON.stringify({ entries: [] }, null, 2)}\n`);
      }
      const { problems: loaded } = loadGateExemptions(dir);
      const joined = loaded.join("\n");
      if (testCase.expect === null ? loaded.length === 0 : testCase.expect.test(joined)) {
        console.log(`[ok] test-layout-selftest:${testCase.name}(${loaded.length} 条读表诊断)`);
      } else {
        throw new Error(
          `${testCase.name}:期望${testCase.expect === null ? "零读表诊断" : `匹配 ${testCase.expect}`},`
          + `实际 ${loaded.length} 条\n${joined || "(零诊断)"}`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  if (testCase.gateSubjectExemptionLoad !== undefined) {
    // C3 读表档:走 `loadGateSubjectExemptions` 的**真实读盘路径**(临时合成根),
    // 理由与上面 L11 那条逐字同款 —— 注入面按构造永远「读得到」,那一档就无人验证。
    // 四种形态各一:文件不在 / 文件在但 JSON 坏了 / JSON 合法但缺 entries / 表读得到。
    const dir = mkdtempSync(join(tmpdir(), "m2w-gate-subject-exempt-selftest-"));
    try {
      if (testCase.gateSubjectExemptionLoad === "corrupt") {
        writeUnder(dir, GATE_SUBJECT_EXEMPTIONS_REL, "{ this is not json ");
      } else if (testCase.gateSubjectExemptionLoad === "no-entries") {
        writeUnder(dir, GATE_SUBJECT_EXEMPTIONS_REL, `${JSON.stringify({ _comment: "缺 entries 键" }, null, 2)}\n`);
      } else if (testCase.gateSubjectExemptionLoad === "empty") {
        writeUnder(dir, GATE_SUBJECT_EXEMPTIONS_REL, `${JSON.stringify({ entries: [] }, null, 2)}\n`);
      }
      const { problems: loaded } = loadGateSubjectExemptions(dir);
      const joined = loaded.join("\n");
      if (testCase.expect === null ? loaded.length === 0 : testCase.expect.test(joined)) {
        console.log(`[ok] test-layout-selftest:${testCase.name}(${loaded.length} 条读表诊断)`);
      } else {
        throw new Error(
          `${testCase.name}:期望${testCase.expect === null ? "零读表诊断" : `匹配 ${testCase.expect}`},`
          + `实际 ${loaded.length} 条\n${joined || "(零诊断)"}`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  if (testCase.gateFamily !== undefined) {
    // L11/L12 档:直调判定本体。**不 spawn、不建合成 test/ 树** —— 这两族的面是
    // 「门禁清单 + scripts 表」,与 test/ 树无关(理由见 judgeGate 的注释)。
    //
    // ⚠ `registryProblems: true` 那一格读的是**清单归一阶段**的 problems,不是判定本体的:
    // 「缺字段 → 判红」发生在 makeGateRegistryCtx 里,而 makeGateRegistryCtx 同时也是
    // 判定本体的入参准备 —— 那道门在归一阶段,不在 judgeL11/judgeL12 里。
    const raw = testCase.registryProblems === true
      ? makeGateRegistryCtx(testCase.gates).problems
      : judgeGate({
        family: testCase.gateFamily,
        gates: testCase.gates,
        scripts: testCase.scripts,
        existingFiles: testCase.existingFiles ?? [],
        segmentBodies: testCase.segmentBodies ?? {},
        exemptions: testCase.exemptions ?? [],
      }).problems;
    // ⚠ 恒绿防护:判据表若有 id 未登记,那些命中会被 `report` 额外追一条
    // `criteria-unregistered:`;而本档直调判定本体、**不经漏斗**,故此处显式核对
    // 「发出的 id 全在 CRITERIA 里」—— 让「判定本体与登记表脱节」这一格有牙齿。
    const declared = new Set(CRITERIA.map((entry) => entry.id));
    const expectedId = testCase.gateFamily === "l11" ? "gate-has-carrier" : "gate-chain-membership";
    if (!declared.has(expectedId)) {
      throw new Error(
        `${testCase.name}:判定本体发出的 id ${expectedId} 不在 CRITERIA 里 —— 它的强制等级无人负责`,
      );
    }
    const joined = raw.join("\n");
    const statsText = `problems=${raw.length}`;
    if (testCase.expectAbsent !== undefined && testCase.expectAbsent.test(joined)) {
      throw new Error(
        `${testCase.name}:期望**不**出现 ${testCase.expectAbsent},实际命中\n${joined}`,
      );
    }
    if (testCase.expect === null) {
      // ⚠ 恒绿防护:`expect: null` 必须**真的**断「零命中」。它与「实现恒抛异常/恒返回空」
      // 只差一层 —— 故这里额外要求 problems 是数组且长度为 0,而不是「没有报错就算过」。
      if (Array.isArray(raw) && raw.length === 0) {
        console.log(`[ok] test-layout-selftest:${testCase.name}(零判红 / ${statsText})`);
      } else {
        throw new Error(
          `${testCase.name}:期望零判红,实际 ${Array.isArray(raw) ? raw.length : "非数组"}\n${joined}`,
        );
      }
      return;
    }
    if (testCase.expect.test(joined)) {
      if (testCase.expectAlso !== undefined && !testCase.expectAlso.test(joined)) {
        throw new Error(`${testCase.name}:期望 problems 同时匹配 ${testCase.expectAlso},实际\n${joined}`);
      }
      console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
    } else {
      throw new Error(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
    }
    return;
  }
  if (testCase.judgeOnly === true) {
    // 「少一个镜像源层目录」那一档无法只经 writeUnder 表达(判据只加文件、不删目录),
    // 故单独走一条:在合成根里删掉一层的段目录后再判定。
    if (testCase.deriveMissing === true) {
      const dir = createFixture({});
      try {
        rmSync(join(dir, ...`${TEST_REL}/renderer`.split("/")), { recursive: true, force: true });
        const { problems, info } = checkTestLayout({ root: dir, minScannedFiles: 0 });
        // L7 是 report-only 档 ⇒ 命中在 info 通道。读错通道的话这条会以「零判红」绿,
        // 而它验的恰恰是「判缺那一档还在」—— 症状与根因隔着一个通道,最难归因。
        const joined = `${problems.join("\n")}\n${info.join("\n")}`;
        if (/test\/renderer → test-top-dirs-exact:test\/ 顶层缺目录「renderer\/」/.test(joined)) {
          console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截)`);
        } else {
          throw new Error(`${testCase.name}:期望点名缺目录 renderer,实际\n${joined.trim() || "(两通道皆空)"}`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return;
    }
    const { problems, info, stats } = judge(testCase.extra ?? {}, {
      minScannedFiles: testCase.minScannedFiles,
      minSelftestFiles: testCase.minSelftestFiles,
      missingRoot: testCase.missingRoot,
      skipSrc: testCase.skipSrc,
      l5Exemptions: testCase.l5Exemptions,
      // L11b 一族要注入门禁索引(它判的是「判定面怎么圈」,圈法在 checkTestLayout 里)。
      // 缺省仍是空表 —— 合成树里没有 gates/,如实。
      gateRegistry: testCase.gateRegistry,
      gateSubjectExemptions: testCase.gateSubjectExemptions,
      criteriaOverride: testCase.criteriaOverride,
      // 本族这一条要验的正是「段没接入 ⇒ 判红」,故它的合成段必须保持裸形态 ——
      // 它是唯一一条**不自带** case.js 桩的族二夹具(自带桩就会被桩的存在带过)。
      keepSegmentsCaseBare: testCase.keepSegmentsCaseBare,
    });
    const joined = problems.join("\n");
    const infoJoined = info.join("\n");
    const statsText = `stats=${JSON.stringify(stats)}`;
    // info 通道的断言独立于 problems:两族语义不同(前者恒报告、后者参与退出码),
    // 合成一条 if 会让「info 判绿」与「problems 判红」两格互相掩盖。
    // expectAbsent 断「不该红的一处没红」:与 expect 断「该红的一处红了」互不替代 ——
    // 判据作用域写宽了(把不该管的目录也纳入)时,expect 那几格仍全绿,只有这一格翻脸。
    if (testCase.expectAbsent !== undefined && testCase.expectAbsent.test(joined)) {
      throw new Error(
        `${testCase.name}:期望**不**出现 ${testCase.expectAbsent},实际命中\n${joined}`,
      );
    }
    if (testCase.expectInfoAbsent !== undefined && testCase.expectInfoAbsent.test(infoJoined)) {
      // 与 expectInfo / expectInfoAbsent 互不替代:这一格断的是「不该红的一处没红」
      // (如「抽出 0 条」那一档**不落进**「册有源无」—— 否则真因被埋在一堆派生症状里)。
      throw new Error(
        `${testCase.name}:info 通道期望**不**出现 ${testCase.expectInfoAbsent},实际命中\n${infoJoined}`,
      );
    }
    if (testCase.expectInfo !== undefined) {
      const ok = testCase.expectInfo === null ? info.length === 0 : testCase.expectInfo.test(infoJoined);
      if (!ok) {
        throw new Error(
          `${testCase.name}:info 通道期望${testCase.expectInfo === null ? "零命中" : `匹配 ${testCase.expectInfo}`},`
          + `实际 ${info.length} 条\n${infoJoined || "(零命中)"}`,
        );
      }
    }
    if (testCase.expect === null) {
      if (problems.length === 0) {
        console.log(`[ok] test-layout-selftest:${testCase.name}(零判红 / ${statsText})`);
      } else {
        throw new Error(`${testCase.name}:期望零判红,实际 ${problems.length} 条\n${joined}`);
      }
      return;
    }
    if (testCase.expect.test(joined)) {
      // expectAlso 是**第二条必须同时成立**的正向断言,与 expect 互不替代:
      // 「登记表里漏了一行」这一格只证「会记一条告警」,不证「原诊断还在」——
      // 实现若把查不到档那一族的诊断一并吞掉,expect 照样绿(告警照样记)。
      if (testCase.expectAlso !== undefined && !testCase.expectAlso.test(joined)) {
        throw new Error(
          `${testCase.name}:期望 problems 同时匹配 ${testCase.expectAlso},实际\n${joined}`,
        );
      }
      console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
    } else {
      throw new Error(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
    }
    return;
  }

  // 进程级档:真实仓库那两条只读,其余在合成目录里以 cwd 指夹具跑仓内真脚本
  const run = testCase.realRepo === true
    ? runAt(projectRoot, testCase.args ?? [])
    : runChecker(
        testCase.extra ?? {},
        testCase.args ?? [],
        testCase.removeTopDir,
        { keepSegmentsCaseBare: testCase.keepSegmentsCaseBare },
      );
  // expectCount 独立于 expect:前者钉**计数器**(结论行那一档),后者钉**诊断文案**。
  // 合成一条 if 会让「文案对但计数错」与「计数对但文案错」互相掩盖 ——
  // 上面那条 L7 缺档夹具的变异实验正是这么躲过去的。
  if (testCase.expectCount !== undefined && !testCase.expectCount.test(run.output)) {
    throw new Error(
      `${testCase.name}:期望结论行匹配 ${testCase.expectCount},实际 exit=${String(run.code)}\n${run.output}`,
    );
  }
  if (run.code !== testCase.expectCode || !testCase.expect.test(run.output)) {
    throw new Error(
      `${testCase.name}:期望 exit=${testCase.expectCode} 且输出匹配 ${testCase.expect},`
      + `实际 exit=${String(run.code)}\n${run.output}`,
    );
  }
  console.log(
    `[ok] test-layout-selftest:${testCase.name}`
    + `(exit ${String(run.code)}${testCase.realRepo === true ? " / 只读真实仓库" : ""})`,
  );
}

// 夹具表逐档收进 case:**档名即 case 名**(逐字沿用搬迁前 failures.push 记账用的 testCase.name)。
for (const testCase of CASES) {
  await suite.case(testCase.name, () => runOne(testCase));
}

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 与搬迁前 failures[] 判定等价(任一档失败即非零退出)。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) console.error(`[test-layout-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  console.error(`[test-layout-selftest:fail] test 布局门禁回归守护失败,共 ${failedCases.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] test-layout-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
