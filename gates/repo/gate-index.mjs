// 门禁索引(S3):**全部门禁的接入点与判定体指针一张表**,判据面是 L11(载体)＋ L12(链归属)。
//
// ---- 本表是什么、不是什么 ----
// 它是**数据表**,不是判定体:39 项登记项,每项 6 个键(其中 `enforcement` 可选)。
// 两条判据(check-test-layout.mjs 的 L11 / L12)从它读,别的什么都不读。
//
// ---- 为什么 `modulePath` 与 `judgment.module` 是两个字段(压成一个会丢信息)----
// 实测 `docs` 那条:`modulePath` 指 `gates/repo/check-docs.mjs`(门禁本体 = npm script 的执行入口,
// 它只做「转出 main + 入口守卫」),而 `judgment.module` 指 `gates/repo/check-pointers.mjs`
// (判定体所在处)。registry.mjs 的注释明写「指针必须指本体而不是转发层」—— 那说的是
// `judgment.module`;若把两者压成一个字段,转发层门禁的指针语义就被压缩掉了,而 L11 恰恰
// 要用 `modulePath` 去推导候选载体路径(同名 `.selftest.mjs`)⇒ 两者服务**两条不同的判据**。
//
// ---- `access` 的取值域是两值(ADR-062 L12)----
// `chain` = 真在 `verify:ci` / `verify:release` / `dist` 三条链之一上;`offchain` = 不在。
// 旧 `registry.mjs` 里的第三档 `workflow`(「在 CI workflow 上但不在任一条链上」)与二分不对齐,
// 使「门禁在不在链上」没有唯一答案 ⇒ 那两项(`env` / `supply`)在本表里是 `offchain`。
// ⚠ **旧 registry.mjs 的三值本步不改**:它的 R5b(`:1270`/`:1276`)按三值分支判定,改成两值会崩;
// 旧表随 S4 整体删除。**两套取值域在并存期并存,这是刻意的**,不是遗漏。
//
// ---- `enforcement` 是指针不是清单(同 registry.mjs:846 已写的那句理由)----
// 强制等级的状态会变、复述即漂移源(与 T5-a「强制等级留门禁源码」同源)。故这里只存
// `<模块相对路径>#<导出名>`,真有分级表的门禁才写这一条 —— 当前只有两道:
//   - `check-test-layout.mjs#CRITERIA`(11 族判据登记表)
//   - `check-import-boundary.mjs#LAYER_RULES`(18 条层向规则的 deny-list)
// 其余门禁**没有**这一条:白名单 / 豁免表(如 `check-temp-cleanup` 的 `ALLOWLIST`、
// `check-changelog` 的规则表)语义是「豁免」不是「强制等级」,给它们编一个指针会让读的人
// 以为那里也有一张分级表。
//
// ⚠ **禁自指**:解析指针要 `import()` 那个模块,而模块自身若卡在顶层 await 上会死锁
// (实测坑记在 registry.mjs:659-661:「驱动器解析指针时会 import 那个模块,而模块自身
// 正卡在自己的顶层 await 上」)。本表自身是纯数据表、无顶层 await,但**规则本身**仍成立:
// 一条指向本表的 `enforcement` 指针在 S4 之后会变成真自指,由 gate-index.selftest.mjs 判红。
//
// ---- 与旧 registry.mjs 的关系(并存期)----
// `gates/probe/gate-probes/registry.mjs` 仍在(S4 才删),它承载 R1–R5c 五组判据与三种驱动器。
// 本步**双跑**:`gate-index.selftest.mjs` 断言两表在共有字段上逐条相等、且 id 集合完全一致。
// ⚠ 本表**不**被旧 registry.mjs 引用(反向也不成立),两者之间唯一的机器对读在 selftest 里。
//
// ---- 本表被谁读 ----
// `gates/repo/check-test-layout.mjs` 静态 import 它(路径单源于该门禁的
// `GATE_INDEX_MODULE_REL`)。**不要**在这里 import 判定本体(判定侧已 import 本表,反向即成环)。
//
// ---- 为什么本模块零 import ----
// 它是**纯数据表**:不读盘、不取项目根(所有路径都是仓相对 POSIX 字面量,与 `shared/paths.js`
// 的 `ROOT` 无关 —— 判定侧按自己的 `ctx.root` 解析那些路径)。零 import 让它可以被任何
// 求值根复用(自检在合成根上求值时不需要换根),也让「import 它」这件事没有任何副作用。
//

/**
 * 门禁「接入点归属」的取值域(ADR-062 L12:两值)。
 *
 * 定义搬到这里而不是留在判定本体里:取值域是**本表的字段契约**,判定侧是消费方。
 * 放在判定本体会让消费方反过来定义被消费方的取值域;而 `check-test-layout.mjs` 从本模块
 * 转出同名的两个常量(selftest 与外部调用点仍从那里取),故全仓只有这一份定义。
 * @type {string}
 */
export const ACCESS_CHAIN = "chain";
/** @type {string} */
export const ACCESS_OFFCHAIN = "offchain";

/**
 * @typedef {object} GateIndexEntry 一项门禁登记(6 个键,`enforcement` 可选)
 * @property {string} id 门禁 id(全表唯一;与旧 registry.mjs 的 id 集合逐条相等)
 * @property {readonly string[]} npmScripts 驱动这道门禁的 npm script,判定侧在前
 *   (`gen:*` / 开发侧入口不是接入点的定义,见 check-test-layout.mjs 判定本体头注)
 * @property {string} access `chain` / `offchain`(两值,见文件头)
 * @property {string} modulePath 门禁本体(判定逻辑所在处或转发层;L11 用它推导候选载体路径)
 * @property {{ module: string, export: string, shaped?: string }} judgment 判定体指针:
 *   `module` 指**判定体所在模块**(不得指转发层),`export` 是它的导出名,`shaped` 是归一前的
 *   返回形状(供阅读者对号入座;判定不读它)
 * @property {string} [enforcement] 强制等级表的指针 `<模块相对路径>#<导出名>`;
 *   **只有真有分级表的门禁才写**(见文件头)
 */

/**
 * 全部门禁的登记项。
 *
 * ⚠ **为什么它与「有哪些门禁」是耦合的**:新加一道门禁必须同时在这里登记一行,否则 L11
 * 不看它(它没有载体时无人判红)、L12 不看它(它挂没挂链上无人核对)。两表并存期内,
 * 「加了门禁没同步索引」由 `gate-index.selftest.mjs` 的 id 集合双向相等判红。
 * @type {Readonly<Record<string, GateIndexEntry>>}
 */
export const GATE_INDEX = Object.freeze(
  /** @type {Record<string, GateIndexEntry>} */ ({
    /* ---------- verify:ci / verify:release / dist 链上 ---------- */
    contract: {
      id: "contract",
      npmScripts: ["check:contract"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-ci-contract.mjs",
      // ⚠ 两条调用路径都跑:verify:ci 链首步 + 两条 workflow 在 `npm ci` 之前的裸调 fail-fast。
      judgment: { module: "gates/repo/check-ci-contract.mjs", export: "checkContract", shaped: "string[]" },
    },
    boundary: {
      id: "boundary",
      npmScripts: ["check:boundary", "check:boundary:dist"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-import-boundary.mjs",
      judgment: { module: "gates/repo/check-import-boundary.mjs", export: "analyze", shaped: "{ problems: string[] }" },
      // `check:boundary:dist` 是同一门禁的**产物面**调用点(--flavor dist,判 dist 树):
      // src 面判源码文本,产物面额外判「编译后真的成立」(type-only import 在 dist 里被擦除、
      // cjs require 形态只在产物面可见)。两面的判定函数同为 analyze(flavor 参数不同)。
      enforcement: "gates/repo/check-import-boundary.mjs#LAYER_RULES",
    },
    "copy-sites": {
      id: "copy-sites",
      npmScripts: ["check:copy-sites"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-copy-sites.mjs",
      judgment: { module: "gates/repo/check-copy-sites.mjs", export: "judgeCopySites", shaped: "CopyProblem[]" },
    },
    "transform-dispatch": {
      id: "transform-dispatch",
      npmScripts: ["check:transform-dispatch"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-transform-dispatch.mjs",
      judgment: { module: "gates/repo/check-transform-dispatch.mjs", export: "analyze", shaped: "{ problems: string[], info: string[] }" },
    },
    "test-numbering": {
      id: "test-numbering",
      npmScripts: ["check:test-numbering"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-test-numbering.mjs",
      judgment: { module: "gates/repo/check-test-numbering.mjs", export: "analyze", shaped: "{ problems, allowHits, allowCold, staleAllow }" },
    },
    "tscheck-coverage": {
      id: "tscheck-coverage",
      npmScripts: ["check:tscheck-coverage"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-tscheck-coverage.mjs",
      judgment: { module: "gates/repo/check-tscheck-coverage.mjs", export: "analyze", shaped: "{ problems, guarded, exempt }" },
    },
    "temp-cleanup": {
      id: "temp-cleanup",
      npmScripts: ["check:temp-cleanup"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-temp-cleanup.mjs",
      judgment: { module: "gates/repo/check-temp-cleanup.mjs", export: "analyze", shaped: "{ problems, optionProblems, staleAllow }" },
    },
    "check-changelog": {
      id: "check-changelog",
      npmScripts: ["check:changelog"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-changelog.mjs",
      judgment: { module: "gates/repo/check-changelog.mjs", export: "analyze", shaped: "{ problems, allowHits, allowCold, staleAllow, region }" },
    },
    "release-notes": {
      id: "release-notes",
      npmScripts: ["check:release-notes"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-release-notes.mjs",
      judgment: { module: "gates/repo/check-release-notes.mjs", export: "checkReleaseNotesContract", shaped: "string[]" },
    },
    "pinned-actions": {
      id: "pinned-actions",
      npmScripts: ["check:pinned-actions"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-pinned-actions.mjs",
      judgment: { module: "gates/repo/check-pinned-actions.mjs", export: "analyze", shaped: "{ problems, info, stats }" },
    },
    "archive-index": {
      id: "archive-index",
      npmScripts: ["check:archive-index", "gen:archive-index"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/gen-archive-index.mjs",
      // ⚠ 判定体尚未抽成注入式纯函数,指针暂取 CLI 的 main(判定与呈现仍在同一函数内)。
      judgment: { module: "gates/repo/gen-archive-index.mjs", export: "main", shaped: "退出码(0 = 通过)" },
    },
    "gate-ids-table": {
      id: "gate-ids-table",
      npmScripts: ["check:gate-ids-table", "gen:gate-ids-table"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/gen-gate-ids-table.mjs",
      judgment: { module: "gates/repo/gen-gate-ids-table.mjs", export: "judgeDrift", shaped: "{ problems: string[], families: number }" },
    },
    "coverage-zero": {
      id: "coverage-zero",
      npmScripts: ["check:coverage-zero"],
      access: ACCESS_CHAIN,
      modulePath: "gates/probe/gate-probes/coverage-gate.mjs",
      judgment: { module: "gates/probe/gate-probes/coverage-gate.mjs", export: "auditZeroFiles", shaped: "{ problems, zeroFiles, total }" },
    },
    coverage: {
      id: "coverage",
      npmScripts: ["test:coverage"],
      access: ACCESS_CHAIN,
      modulePath: "gates/probe/gate-probes/coverage-gate.mjs",
      // 阈值判定体是 c8 本身(第三方工具);本仓持有的判定面是 coverage-gate 的**静态面**。
      judgment: { module: "gates/probe/gate-probes/coverage-gate.mjs", export: "auditStatic", shaped: "{ problems, detail }" },
    },
    fixtures: {
      id: "fixtures",
      npmScripts: ["check:fixtures"],
      access: ACCESS_CHAIN,
      modulePath: "gates/fixtures/gen-fixtures.mjs",
      judgment: { module: "gates/fixtures/gen-fixtures.mjs", export: "main", shaped: "退出码(0 = 通过)" },
    },
    "build-fresh": {
      id: "build-fresh",
      npmScripts: ["test:smoke", "start"],
      access: ACCESS_CHAIN,
      modulePath: "gates/smoke/check-build-fresh.mjs",
      judgment: { module: "gates/smoke/check-build-fresh.mjs", export: "evaluateFreshness", shaped: "string[](每条问题点名具体 src 相对路径)" },
    },
    smoke: {
      id: "smoke",
      npmScripts: ["test:smoke"],
      access: ACCESS_CHAIN,
      // ⚠ 本体是 TypeScript(编译进 dist 随包分发,离线核不到);可离线核对的判定面在
      // `judgment.module` 指的 smoke-proc.mjs 里 —— 这正是两个字段不能合一的实证之一。
      modulePath: "src/main/smoke.ts",
      judgment: { module: "gates/smoke/smoke-proc.mjs", export: "collectSmokeProblems", shaped: "string[]" },
    },
    geometry: {
      id: "geometry",
      npmScripts: ["check:geometry"],
      access: ACCESS_CHAIN,
      modulePath: "gates/geometry/check-geometry.mjs",
      // 采样面(真窗口)住在 gates/geometry/,判定层(结构不变式)是纯函数。
      judgment: { module: "shared/geometry/geometry-core.mjs", export: "runGeometryGate", shaped: "{ findings: [] }" },
    },
    clean: {
      id: "clean",
      npmScripts: ["clean:dist", "clean:release"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/clean-artifacts.mjs",
      judgment: { module: "gates/artifacts/clean-artifacts.mjs", export: "main", shaped: "退出码(0 = 通过)" },
    },
    "dist-manifest": {
      id: "dist-manifest",
      npmScripts: ["check:dist-manifest", "gen:dist-manifest"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/check-dist-manifest.mjs",
      judgment: { module: "gates/artifacts/check-dist-manifest.mjs", export: "diffManifests", shaped: "漂移数组" },
    },
    asar: {
      id: "asar",
      npmScripts: ["check:asar"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/check-asar-manifest.mjs",
      judgment: { module: "gates/artifacts/check-asar-manifest.mjs", export: "findForbiddenDistEntries", shaped: "违规条目数组" },
    },
    release: {
      id: "release",
      npmScripts: ["check:release"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/check-release-artifacts.mjs",
      judgment: { module: "gates/artifacts/check-release-artifacts.mjs", export: "findForeignArtifacts", shaped: "历史产物文件名数组" },
    },
    signature: {
      id: "signature",
      npmScripts: ["check:signature"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/check-signature-status.mjs",
      // 判定本体刻意不以二值表达:Authenticode 的 NotTrusted(有签名但证书链不受信)与
      // NotSigned 语义相反,一律映射到 indeterminate 并判红。
      judgment: { module: "gates/artifacts/check-signature-status.mjs", export: "classifyAuthenticode", shaped: "'signed' | 'indeterminate' | 'not-signed'" },
    },
    "unpacked-smoke": {
      id: "unpacked-smoke",
      npmScripts: ["check:unpacked-smoke"],
      access: ACCESS_CHAIN,
      modulePath: "gates/artifacts/check-unpacked-smoke.mjs",
      judgment: { module: "gates/artifacts/check-unpacked-smoke.mjs", export: "main", shaped: "退出码(0 = 通过)" },
    },
    docs: {
      id: "docs",
      npmScripts: ["check:docs"],
      access: ACCESS_CHAIN,
      // ⚠ 转发层门禁的实证:`modulePath` 是执行入口(check-docs.mjs 只做「转出 main + 入口守卫」),
      // 判定体在 check-pointers.mjs。压成一个字段就会丢掉这条区别(见文件头)。
      modulePath: "gates/repo/check-docs.mjs",
      judgment: { module: "gates/repo/check-pointers.mjs", export: "main", shaped: "退出码(0 = 通过 / 1 = 有错)" },
    },
    "test-layout": {
      id: "test-layout",
      npmScripts: ["check:test-layout"],
      access: ACCESS_CHAIN,
      modulePath: "gates/repo/check-test-layout.mjs",
      judgment: { module: "gates/repo/check-test-layout.mjs", export: "checkTestLayout", shaped: "{ problems: string[], info: string[], stats }" },
      // 本表**唯一的自指风险面**已避开:指针指向判定本体自己,而判定本体 import 本表 ⇒
      // 解析它不会成环(判定本体的顶层没有 await),且它要读的正是本表。禁的是指向本表自身。
      enforcement: "gates/repo/check-test-layout.mjs#CRITERIA",
    },

    /* ---------- 仅某条 workflow 的 job(在 CI 上,但不在三条链上)---------- */
    // ADR-062 L12 两值化的直接对象:旧表的 `workflow` 档与二分不对齐。`check:env` 与
    // `check:supply` 在 ci.yml / release.yml 里有裸调步骤,但都不在 `verify:ci` /
    // `verify:release` / `dist` 任一条链上 ⇒ 本表记 `offchain`。DEV-GUIDE 的「门禁接入点」
    // 表已按「仅某个 CI workflow job」登记这两项,两处口径一致(链的成员单源仍是 package.json)。
    env: {
      id: "env",
      npmScripts: ["check:env"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/repo/print-env-fingerprint.mjs",
      judgment: { module: "gates/repo/print-env-fingerprint.mjs", export: "collectEnvironmentFingerprint", shaped: "指纹对象" },
    },
    supply: {
      id: "supply",
      npmScripts: ["check:supply"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/supply/supply/check-supply-chain.mjs",
      judgment: { module: "gates/supply/supply/check-supply-chain.mjs", export: "runSupplyChecks", shaped: "{ problems, reports }" },
    },

    /* ---------- 仅本地手动(旧表的 local 档,逐条改为 offchain)---------- */
    // ⚠ 下面 11 项在旧 registry.mjs 里是 `access: "local"`。改成两值域里的 `offchain`
    // **不是降格**:旧表 R5b 的三值分支(registry.mjs:1270/:1276)要求 local 与 workflow
    // 分开判,而 L12 判的是「在不在三条链上」—— 这 11 项的接入点确实一条链都不在。
    "plan-in-progress": {
      id: "plan-in-progress",
      npmScripts: ["check:plan-in-progress"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/repo/check-plan-in-progress.mjs",
      judgment: { module: "gates/repo/check-plan-in-progress.mjs", export: "checkPlanInProgress", shaped: "{ problems: string[], stats }" },
    },
    "gate-probes": {
      id: "gate-probes",
      npmScripts: ["check:gates"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/probe/gate-probes/registry.mjs",
      // ⚠ 旧表这一项是**内联判定本体**(函数字面量,注释明写是为避免 import 时自指卡死)。
      // 本表是数据表,存不了函数 ⇒ 改记指针,而指针指向的正是旧表自己声明的兜底形态
      // (registry.mjs 的 `fallbackSelfEntry` 逐字写着这个 module + export 组合)。
      // ⚠ S4 删掉 registry.mjs 时这一行必须同批改(它今天就是 S4 前唯一一处「判定体指针
      // 指向另一张表」的登记项)。
      judgment: { module: "gates/probe/gate-probes/registry.mjs", export: "checkGateRegistry", shaped: "Problem[]" },
    },
    "install-smoke": {
      id: "install-smoke",
      npmScripts: ["check:install-smoke"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/artifacts/check-install-smoke.mjs",
      judgment: { module: "gates/artifacts/check-install-smoke.mjs", export: "runInstallFlow", shaped: "流程结果" },
    },
    "pack-size": {
      id: "pack-size",
      npmScripts: ["check:pack-size"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/artifacts/pack-size.mjs",
      judgment: { module: "gates/artifacts/pack-size.mjs", export: "evaluate", shaped: "体积判定结果" },
    },
    "smoke-report": {
      id: "smoke-report",
      npmScripts: ["check:smoke-report"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/smoke/smoke-report.mjs",
      judgment: { module: "gates/smoke/smoke-report.mjs", export: "main", shaped: "退出码(0 = 通过)" },
    },
    sbom: {
      id: "sbom",
      npmScripts: ["check:sbom", "gen:sbom"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/supply/supply/gen-sbom.mjs",
      judgment: { module: "gates/supply/supply/gen-sbom.mjs", export: "diffSbom", shaped: "漂移数组" },
    },
    sca: {
      id: "sca",
      npmScripts: ["check:sca"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/supply/supply/sca-audit.mjs",
      judgment: { module: "gates/supply/supply/sca-audit.mjs", export: "normalizeAuditVulnerabilities", shaped: "漏洞条目数组" },
    },
    licenses: {
      id: "licenses",
      npmScripts: ["gen:licenses"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/supply/supply/gen-licenses.mjs",
      judgment: { module: "gates/supply/supply/gen-licenses.mjs", export: "buildLicensesReport", shaped: "许可证报告" },
    },
    fulltext: {
      id: "fulltext",
      npmScripts: ["collect:license-fulltext"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/supply/supply/collect-license-fulltext.mjs",
      judgment: { module: "gates/supply/supply/collect-license-fulltext.mjs", export: "collectLicenseFulltext", shaped: "收集结果" },
    },
    "src-layout": {
      id: "src-layout",
      npmScripts: ["check:src-layout"],
      access: ACCESS_OFFCHAIN,
      modulePath: "gates/repo/check-src-layout.mjs",
      judgment: { module: "gates/repo/check-src-layout.mjs", export: "checkSrcLayout", shaped: "{ problems: string[], stats }" },
    },
    "dual-matrix": {
      id: "dual-matrix",
      // ⚠ 零 npm script:不是 npm script 门禁,而是验收段内的一道门禁(由 M2W_ONLY 单独跑)。
      // L12 对它取 `npmScripts[0]` 时得到 undefined,判定本体那一档显式容忍
      // 「一个 script 都没登记」的 offchain 项(判红的是 chain 项缺接入点)。
      npmScripts: [],
      access: ACCESS_OFFCHAIN,
      modulePath: "test/core/dual-pipeline-matrix.test.js",
      judgment: { module: "test/core/dual-pipeline-matrix.test.js", export: "run", shaped: "段结果(段内 assertMatrixShape 为判据面)" },
    },
  }),
);

/**
 * 本表自身的仓相对 POSIX 路径。**禁自指的判据与 selftest 都取这一份**,
 * 不在两处各写一个字面量(那正是「自指规则会不会被漏改」的裂缝)。
 * @type {string}
 */
export const GATE_INDEX_MODULE_REL = "gates/repo/gate-index.mjs";
