// 门禁注册表(单源):**每道门禁登记在册 + 每道门禁必带探针**,两条调用路径都在核对面内。
//
// 为什么要有这一层(REQ-110):此前同一道门禁有两种自检载体、两套写法 ——
//   ① 进程级 CLI(`node gates/**/check-xxx.mjs`),
//   ② 沙盒探针(`gate-probes/gates/*.mjs` + contract.mjs 的 GATE_IDS/GATE_META 登记),
//   ③ 验收测试段(`test/segments/*-gate.test.js` + `*.selftest.mjs`,直接 import 门禁模块),
// 而**没有任何一处登记「哪道门禁有探针、探针在哪」**。后果是双向的:
//   - 往门禁链里加一道新门禁,「它没有探针」这件事**不会**被任何人发现(所有门禁的正常路径
//     都是绿的,没人去看它们会不会红);
//   - 反过来,已经有探针的门禁(负向夹具散落在 selftest 与验收段里)也没留下「谁在守它」的
//     痕迹,探针被删掉同样无人察觉。
// 本注册表把这两件事变成**可判红的判据**:登记项缺探针 → 判红;调用路径上新出现而注册表不
// 认识的门禁 → 判红;登记项指向的探针载体不存在 → 判红。
//
// **判定本体收敛**(同 protocol.mjs):每道门禁登记一个 `judgment` —— 或内联一份可注入纯函数,
// 或指向门禁模块导出的判定函数。三种驱动器(CLI / 沙盒探针 / 验收段)消费的都是它。
//
// **两条调用路径都在核对面内**(实测结论,不是设计出来的):
//   ① npm script 链 —— `verify:ci` / `verify:release` / `dist` 三条链,递归展开 `npm run`;
//   ② workflow **裸调** —— `node gates/repo/check-ci-contract.mjs` 直接跑,在两条 workflow 里
//      各有一处,位置在 `npm ci` **之前**做 fail-fast。只登记 npm script 会把这条路径整条漏掉,
//      而它恰好是 Node 版本不符时最该被拦住的那一次执行。
//
// 分类口径(封闭枚举,全部在本文件内):新增调用点必须显式归到某一类,归不到即判红 ——
//   GATE_REGISTRY        仓内判定门禁(判定逻辑在本仓),每项必带 ≥1 道探针;
//   PROBE_CARRIER_SCRIPTS 负向自检载体(`*.selftest.mjs`):它们**不是**门禁,是某道门禁的探针;
//   AGGREGATOR_SCRIPTS   聚合入口(链本身,不是链上的一道门禁);
//   TOOLCHAIN_*          第三方工具步骤(tsc / eslint / 资源拷贝 / 验收段入口):判定体不在本仓。
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../../../shared/paths.js";
import { walkChain } from "../../repo/chain-expand.mjs";
import { GATE_IDS } from "./contract.mjs";
import { auditJudgmentRef, makeCtx, problem, runGateCli, topLevelSelfExecutions } from "./protocol.mjs";

/* ---------- 契约常量 ---------- */

/** npm script 链的根(展开面 = 这三条链的全部 `npm run` 子链) */
export const CHAIN_ROOTS = Object.freeze(["verify:ci", "verify:release", "dist"]);

/** workflow 目录(仓库相对)。版本控制 / CI 的固定约定,不是脚本布局的一部分,故按名取。 */
export const WORKFLOWS_DIR = ".github/workflows";

/** 聚合入口:它们是「链」本身而不是链上的一道门禁,故不要求探针 */
export const AGGREGATOR_SCRIPTS = Object.freeze(["verify:ci", "verify:release", "dist"]);

/**
 * 第三方工具步骤(判定体不在本仓,故不进 GATE_REGISTRY)。**每条都要写清理由** ——
 * 理由缺失等于把一道真门禁悄悄挪进豁免,而那正是本注册表要防的失效形态。
 */
export const TOOLCHAIN_SCRIPTS = Object.freeze({
  build: "tsc + 资源拷贝:判定体是 TypeScript 编译器与 build/copy-renderer.mjs,本仓不持有判据",
  typecheck: "tsc --noEmit 两份配置:判定体是编译器,本仓不持有判据",
  lint: "eslint:判定体是 ESLint 规则集,本仓不持有判据",
});

/** 第三方工具的文件级步骤(同上) */
export const TOOLCHAIN_FILES = Object.freeze({
  "build/copy-renderer.mjs": "静态资源拷贝:无判据,只搬运 renderer 资产",
  "test/acceptance.mjs": "验收段入口:由各段自证,段内断言即判据(段本身不在本注册表口径内)",
});

/**
 * 负向自检载体:链上的 `*:selftest` **不是门禁**,是被它们守的那道门禁的探针。
 * 登记 npm script → 载体文件,两头都要用:
 *   - 归类:链上新出现的 `*:selftest` 靠它落到「探针载体」这一类,而不是被当成无主门禁;
 *   - 反查:每个载体文件都必须被某道门禁登记为探针,否则它是一段没人认领的漂移风险代码。
 * @type {Readonly<Record<string, string>>}
 */
export const PROBE_CARRIER_SCRIPTS = Object.freeze({
  "check:contract:selftest": "gates/repo/check-ci-contract.selftest.mjs",
  "check:transform-dispatch:selftest": "gates/repo/check-transform-dispatch.selftest.mjs",
  "check:test-numbering:selftest": "gates/repo/check-test-numbering.selftest.mjs",
  "check:temp-cleanup:selftest": "gates/repo/check-temp-cleanup.selftest.mjs",
  "check:archive-index:selftest": "gates/repo/gen-archive-index.selftest.mjs",
  "check:coverage-zero:selftest": "gates/probe/check-coverage-zero.selftest.mjs",
  "check:docs:selftest": "gates/repo/check-docs.selftest.mjs",
  "check:changelog:selftest": "gates/repo/check-changelog.selftest.mjs",
});

/* ---------- 门禁注册表 ---------- */

/**
 * 全部门禁的登记项。`judgment` 与 `probes` 两个字段是本注册表的核心判据:
 * 缺 `judgment` → 门禁对三种驱动器无头(判红);`probes` 为空 → 没人能证明它被破坏时会红(判红)。
 * @type {Readonly<Record<string, import("./protocol.mjs").GateEntry>>}
 */
export const GATE_REGISTRY = Object.freeze(
  /** @type {Record<string, import("./protocol.mjs").GateEntry>} */ ({
    /* ---------- verify:ci / verify:release / dist 链上 ---------- */
    contract: {
      id: "contract",
      title: "工程契约自检门禁",
      npmScripts: ["check:contract"],
      command: "node gates/repo/check-ci-contract.mjs",
      modulePath: "gates/repo/check-ci-contract.mjs",
      access: "chain",
      judgment: {
        module: "gates/repo/check-ci-contract.mjs",
        export: "checkContract",
        shaped: "string[]",
      },
      judgmentNote:
        "判定本体已抽成可注入纯函数(根 / 读文本 / 存在性 / 宿主 Node 版本全经 ctx)。"
        + "这是唯一一条**两条调用路径都跑**的门禁:verify:ci 链首步 + 两条 workflow 在 npm ci 之前的裸调 fail-fast。"
        + "链序约束的是驱动器不是机制,故探针在夹具仓上求值它即可,不必处在链首那个时刻。"
        + "REQ-118:本模块已改为 `process.argv[1]` 入口守卫(与 coverage-gate.mjs 同形),import 无副作用,"
        + "故指针走默认的真 import 档 —— 拿到的是函数对象,不再是静态文本里那个名字。",
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-ci-contract.selftest.mjs",
          why: "自检脚本在临时仓里逐条改坏 package.json / workflow / 锁文件 / 打包白名单并断言本门禁判红,未漂移时断言通过",
        },
      ],
    },
    boundary: {
      id: "boundary",
      title: "依赖声明与 import 层向边界门禁",
      npmScripts: ["check:boundary"],
      command: "node gates/repo/check-import-boundary.mjs",
      modulePath: "gates/repo/check-import-boundary.mjs",
      access: "chain",
      judgment: { module: "gates/repo/check-import-boundary.mjs", export: "analyze", shaped: "{ problems: string[] }" },
      judgmentNote: "该模块判定分三面:analyze(声明与层向)/ analyzeRootComputes(自算项目根)/ analyzeTreeBoundaries(跨树边界);指针取覆盖面最大的 analyze",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/import-boundary.test.js",
          why: "段内造沙盒负向夹具逐条制造漂移(裸包名未声明、反向层向、越层相对路径等),断言非零退出且命中对应诊断,并有正向锚点证明夹具通路有效",
        },
      ],
    },
    "transform-dispatch": {
      id: "transform-dispatch",
      title: "渲染前变换分派点门禁",
      npmScripts: ["check:transform-dispatch"],
      command: "node gates/repo/check-transform-dispatch.mjs",
      modulePath: "gates/repo/check-transform-dispatch.mjs",
      access: "chain",
      judgment: { module: "gates/repo/check-transform-dispatch.mjs", export: "analyze", shaped: "{ problems: string[], info: string[] }" },
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-transform-dispatch.selftest.mjs",
          why: "自检脚本在临时夹具 src 树上逐条注入漂移(渲染层枚举变换键、枚举点多到 3 处、枚举点挪出 core/markdown、扫描面塌缩、参数写错)并断言判红",
        },
      ],
    },
    "test-numbering": {
      id: "test-numbering",
      title: "测试段编号登记门禁",
      npmScripts: ["check:test-numbering"],
      command: "node gates/repo/check-test-numbering.mjs",
      modulePath: "gates/repo/check-test-numbering.mjs",
      access: "chain",
      judgment: { module: "gates/repo/check-test-numbering.mjs", export: "analyze", shaped: "{ problems, allowHits, allowCold, staleAllow }" },
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-test-numbering.selftest.mjs",
          why: "自检脚本把门禁原样拷进临时仓,注入未登记编号 / 白名单失效 / 扫描面塌缩等漂移并断言判红",
        },
      ],
    },
    "temp-cleanup": {
      id: "temp-cleanup",
      title: "删除动作收口门禁",
      npmScripts: ["check:temp-cleanup"],
      command: "node gates/repo/check-temp-cleanup.mjs",
      modulePath: "gates/repo/check-temp-cleanup.mjs",
      access: "chain",
      judgment: { module: "gates/repo/check-temp-cleanup.mjs", export: "analyze", shaped: "{ problems, optionProblems, staleAllow }" },
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-temp-cleanup.selftest.mjs",
          why: "自检脚本把门禁原样拷进临时仓,注入未收口的删除调用 / 助手可选参数用错等漂移并断言判红",
        },
        {
          kind: "external",
          ref: "runSelfProbe",
          why: "门禁自身在每次 CLI 执行前先跑一组 SELF_PROBE 夹具(收口前形态必须命中、收口后形态必须不命中),探针不过即 exit 1 —— 常驻的规则自检,不依赖自检脚本被记得运行",
        },
      ],
    },
    "check-changelog": {
      id: "check-changelog",
      title: "CHANGELOG 面向用户的口径门禁",
      npmScripts: ["check:changelog"],
      command: "node gates/repo/check-changelog.mjs",
      modulePath: "gates/repo/check-changelog.mjs",
      access: "chain",
      judgment: {
        module: "gates/repo/check-changelog.mjs",
        export: "analyze",
        shaped: "{ problems, allowHits, allowCold, staleAllow, region }",
      },
      judgmentNote:
        "判定本体是纯文本扫描:扫描面 = docs/CHANGELOG.md 的版本条目区(首个 `## [待发版]` 行起到文件末;"
        + "**头部不扫** —— 头部是要写反例的地方,连头部一起扫会逼着人把口径说明改成绕口令)。"
        + "三类判据(禁内部工程词 / 禁第二人称 / 禁内部编号)之外另有扫描面下界判据:"
        + "锚点缺失或条目区为空一律判红,防「扫不到任何东西所以恒绿」。"
        + "链序:排在 check:docs:selftest 之后、build 之前 —— 文档类判据集中在文档段内,且要在 tsc/测试之前红。"
        + "本模块已按 `process.argv[1]` 入口守卫(与 coverage-gate.mjs 同形),import 无副作用,故指针走默认的真 import 档。",
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-changelog.selftest.mjs",
          why: "自检脚本把门禁原样拷进临时仓并造夹具 CHANGELOG,逐条注入三类禁词(逐词覆盖枚举)、问候语假阳性、纯数字/纯字母 hash 假阳性、头部禁词(须判绿)、锚点改名 / 条目区清空 / 路径不存在(扫描面塌缩须判红),断言逐条判红判绿",
        },
      ],
    },
    "pinned-actions": {
      id: "pinned-actions",
      title: "action 引用固定门禁",
      npmScripts: ["check:pinned-actions"],
      command: "node gates/repo/check-pinned-actions.mjs",
      modulePath: "gates/repo/check-pinned-actions.mjs",
      access: "chain",
      judgment: { module: "gates/repo/check-pinned-actions.mjs", export: "analyze", shaped: "{ problems, info, stats }" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/pinned-actions.test.js",
          why: "段内沙盒负向夹具逐条制造漂移(浮动 tag / 缺版本注释 / 注释与基线不符 / SHA 非法 / 未登记 action / 陈旧基线条目 / 扫不到 uses:),断言非零退出且命中诊断,并有正向锚点",
        },
      ],
    },
    "archive-index": {
      id: "archive-index",
      title: "归档索引一致性门禁",
      npmScripts: ["check:archive-index", "gen:archive-index"],
      command: "node gates/repo/gen-archive-index.mjs --check",
      modulePath: "gates/repo/gen-archive-index.mjs",
      access: "chain",
      judgment: {
        module: "gates/repo/gen-archive-index.mjs",
        export: "main",
        shaped: "退出码(0 = 通过)",
      },
      judgmentNote:
        "判定体尚未抽成注入式纯函数,指针暂取 CLI 的 main(判定与呈现仍在同一函数内);探针走进程级调用,不依赖该指针。"
        + "REQ-118:本模块已改为 `process.argv[1]` 入口守卫,import 不再重写 docs/evidence/INDEX.md"
        + "(默认是**生成**模式,顶层自执行等于「import 即改工作树」)⇒ 指针走默认的真 import 档。",
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/gen-archive-index.selftest.mjs",
          why: "自检脚本把生成器原样拷进临时仓,注入文件名形态不合规 / 索引漂移 / 索引缺失并断言判红",
        },
      ],
    },
    "coverage-zero": {
      id: "coverage-zero",
      title: "coverage 零覆盖基线门禁",
      npmScripts: ["check:coverage-zero"],
      command: "node gates/probe/gate-probes/coverage-gate.mjs --zero",
      modulePath: "gates/probe/gate-probes/coverage-gate.mjs",
      access: "chain",
      judgment: { module: "gates/probe/gate-probes/coverage-gate.mjs", export: "auditZeroFiles", shaped: "{ problems, zeroFiles, total }" },
      judgmentNote: "本仓判定协议的样板:判定本体是可注入纯函数(root 进、problems 出),main() 只打印 + 出 0/1",
      probes: [
        {
          kind: "selftest",
          ref: "gates/probe/check-coverage-zero.selftest.mjs",
          why: "自检脚本造合成 coverage-summary.json 与基线,逐条注入「0% 文件未登记豁免 / 豁免已失效 / 基线文件缺失 / 基线可解析但结构损坏」并断言判红",
        },
        { kind: "segment", ref: "test/segments/coverage-gate.test.js", why: "验收段直接 import 判定本体,覆盖静态面(参数向量 / 阈值锚定 / 豁免自洽 / 结构诊断单一来源);动态面须紧跟 test:coverage 取覆盖率数据,故由 selftest 守护而非本段" },
      ],
    },
    coverage: {
      id: "coverage",
      title: "coverage 阈值门禁",
      npmScripts: ["test:coverage"],
      command: "c8 <参数向量取自 package.json 的 test:coverage> electron test/acceptance.mjs",
      modulePath: "gates/probe/gate-probes/coverage-gate.mjs",
      access: "chain",
      judgment: { module: "gates/probe/gate-probes/coverage-gate.mjs", export: "auditStatic", shaped: "{ problems, detail }" },
      judgmentNote:
        "阈值判定体是 c8 本身(第三方工具);本仓持有的判定面是 coverage-gate 的**静态面** —— "
        + "参数向量(须含 --all / --check-coverage / 四阈值 / 豁免对应的 --exclude)、阈值与基线锚定、豁免条目与真实产物的自洽。"
        + "两层职责不同,缺一不可。",
      probes: [
        {
          kind: "sandbox",
          ref: "coverage",
          why: "沙盒探针以 package.json 的**真实**参数向量跑一次人造低覆盖,断言阈值不达标时 exit 非 0 且报「不满足阈值」;锚点同时断言 --exclude 仍生效",
        },
      ],
    },
    fixtures: {
      id: "fixtures",
      title: "fixtures 漂移门禁",
      npmScripts: ["check:fixtures"],
      command: "node gates/fixtures/gen-fixtures.mjs --check",
      modulePath: "gates/fixtures/gen-fixtures.mjs",
      access: "chain",
      judgment: { module: "gates/fixtures/gen-fixtures.mjs", export: "main", shaped: "退出码(0 = 通过)" },
      judgmentNote: "判定体尚未抽成注入式纯函数;探针走沙盒内的进程级调用,不依赖该指针",
      probes: [
        {
          kind: "sandbox",
          ref: "fixtures",
          why: "沙盒探针在工程副本里改一个 fixture 的内容、再删掉它,断言门禁两次都判红且点名该 fixture",
        },
      ],
    },
    "build-fresh": {
      id: "build-fresh",
      title: "构建新鲜度门禁(test:smoke 前置)",
      npmScripts: ["test:smoke", "start"],
      command: "node gates/smoke/check-build-fresh.mjs",
      modulePath: "gates/smoke/check-build-fresh.mjs",
      access: "chain",
      judgment: { module: "gates/smoke/check-build-fresh.mjs", export: "evaluateFreshness", shaped: "{ fresh, reason }" },
      probes: [
        {
          kind: "sandbox",
          ref: "build-fresh",
          why: "沙盒探针把一个源码文件的 mtime 推到产物之后,断言门禁判红并给出「请先运行 npm run build」",
        },
        { kind: "segment", ref: "test/segments/dist-manifest-gate.test.js", why: "验收段对 evaluateFreshness 做纯函数直测,不依赖真实仓库时间" },
      ],
    },
    smoke: {
      id: "smoke",
      title: "打包前 smoke 冒烟门禁",
      npmScripts: ["test:smoke"],
      command: "electron . --smoke",
      modulePath: "src/main/smoke.ts",
      access: "chain",
      // 2026-10-01 修正:原指针取 SMOKE_MARKERS(清单常量)。常量不是判定本体,而驱动器协议要求
      // 「指针解析出的必须是可消费的判定」—— collectSmokeProblems 才是真正的判定函数
      // (「退出码 0 + 五条标记 = 通过 / 非零 = 判红」这条口径就住在它里面)。
      judgment: { module: "gates/smoke/smoke-proc.mjs", export: "collectSmokeProblems", shaped: "string[]" },
      judgmentNote:
        "判定本体有两层:真窗口采样与转换在 src/main/smoke.ts(编译进 dist 随包分发,离线核不到);"
        + "**可离线核对的判定面是 collectSmokeProblems** —— 「退出码 0 + 五条标记齐备 = 通过 / 非零 = 判红」"
        + "这条口径就住在它里面(check-unpacked-smoke / check-install-smoke / smoke-report 三个门禁都调它)。",
      probes: [
        {
          kind: "sandbox",
          ref: "smoke",
          why: "沙盒探针在副本里真启一次 Electron 冒烟:锚点断言 exit 0 且五条标记齐备,负向用 append 覆写桩掉转换核心,断言非 0 且缺 convert ok 标记",
        },
        { kind: "segment", ref: "test/segments/packaged-smoke.test.js", why: "验收段锁「退出码 0 + 五条标记 = 通过 / 非零 = 判红」这条判定口径与标记恒等" },
      ],
    },
    geometry: {
      id: "geometry",
      title: "窗口几何门禁",
      npmScripts: ["check:geometry"],
      command: "electron gates/geometry/check-geometry.mjs",
      modulePath: "gates/geometry/check-geometry.mjs",
      access: "chain",
      judgment: { module: "shared/geometry/geometry-core.mjs", export: "runGeometryGate", shaped: "{ findings: [] }" },
      judgmentNote: "采样面(真窗口)住在 gates/geometry/,判定层(结构不变式)是纯函数 runGeometryGate —— 指针取后者,故探针不必起窗口即可穷举注入故障",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/geometry-gate.test.js",
          why: "验收段按规格合成「应当全绿」的样本后,逐类注入二十余种故障(缺场景 / 不可见 / 视口不匹配 / 档位未生效 / 溢出 / 裁切 / 抽屉错组乱序门控反向 …),断言**失败的规则名与场景**都命中",
        },
      ],
    },
    clean: {
      id: "clean",
      title: "清理目标白名单门禁",
      npmScripts: ["clean:dist", "clean:release"],
      command: "node gates/artifacts/clean-artifacts.mjs --target dist|release",
      modulePath: "gates/artifacts/clean-artifacts.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/clean-artifacts.mjs", export: "main", shaped: "退出码(0 = 通过)" },
      judgmentNote: "判定体尚未抽成注入式纯函数;探针走进程级调用",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/clean-artifacts-gate.test.js",
          why: "验收段以进程级 CLI 语义逐条断言:合法目标预演/删除/幂等、连根 *.tsbuildinfo 只删同名普通文件、越界 target 与缺参一律非零且零删除、目标被占用时的错误码族,并用「只改 TARGET_DIRS 一行」的夹具触达 CLI 上不可触达的删除级守卫",
        },
      ],
    },
    "dist-manifest": {
      id: "dist-manifest",
      title: "dist 清单门禁",
      npmScripts: ["check:dist-manifest", "gen:dist-manifest"],
      command: "node gates/artifacts/check-dist-manifest.mjs --check",
      modulePath: "gates/artifacts/check-dist-manifest.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/check-dist-manifest.mjs", export: "diffManifests", shaped: "漂移数组" },
      probes: [
        {
          kind: "sandbox",
          ref: "dist-manifest",
          why: "沙盒探针在副本里制造 stale 残留 / 缺失 / 内容改写三类漂移,断言门禁逐类判红",
        },
        { kind: "segment", ref: "test/segments/dist-manifest-gate.test.js", why: "验收段在临时目录造正负夹具,断言退出码与失败原因,并用真实 dist 走一遍生成 → 校验" },
      ],
    },
    asar: {
      id: "asar",
      title: "app.asar 结构核对门禁",
      npmScripts: ["check:asar"],
      command: "node gates/artifacts/check-asar-manifest.mjs",
      modulePath: "gates/artifacts/check-asar-manifest.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/check-asar-manifest.mjs", export: "findForbiddenDistEntries", shaped: "违规条目数组" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/release-artifact-gate.test.js",
          why: "验收段用 @electron/asar 现打夹具包,逐条注入顶层白名单越界 / 必需条目缺失 / KaTeX 与 Mermaid 资源缺失 / 包内版本不一致,断言非零退出且命中对应诊断",
        },
      ],
    },
    release: {
      id: "release",
      title: "发布产物核对门禁",
      npmScripts: ["check:release"],
      command: "node gates/artifacts/check-release-artifacts.mjs",
      modulePath: "gates/artifacts/check-release-artifacts.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/check-release-artifacts.mjs", export: "findForeignArtifacts", shaped: "历史产物文件名数组" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/release-artifact-gate.test.js",
          why: "验收段用假字节安装包造夹具,逐条注入非当前版本产物 / latest.yml 的 version/path/size/sha512 漂移,断言非零退出且命中诊断",
        },
      ],
    },
    signature: {
      id: "signature",
      title: "安装包签名状态门禁",
      npmScripts: ["check:signature"],
      command: "node gates/artifacts/check-signature-status.mjs",
      modulePath: "gates/artifacts/check-signature-status.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/check-signature-status.mjs", export: "classifyAuthenticode", shaped: "'signed' | 'indeterminate' | 'not-signed'" },
      judgmentNote: "判定本体刻意不以二值表达:Authenticode 的 NotTrusted(有签名但证书链不受信)与 NotSigned 语义相反,一律映射到 indeterminate 并判红",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/signature-status.test.js",
          why: "验收段用合成输入做三态词汇的正负锚点(NotTrusted 不得被读成「未签名」),再用于真实打包配置与用户文档的一致性核对",
        },
      ],
    },
    "unpacked-smoke": {
      id: "unpacked-smoke",
      title: "解包产物冒烟自证门禁",
      npmScripts: ["check:unpacked-smoke"],
      command: "node gates/artifacts/check-unpacked-smoke.mjs",
      modulePath: "gates/artifacts/check-unpacked-smoke.mjs",
      access: "chain",
      judgment: { module: "gates/artifacts/check-unpacked-smoke.mjs", export: "main", shaped: "退出码(0 = 通过)" },
      judgmentNote: "判定体尚未抽成注入式纯函数(它要真跑解包产物);探针在沙盒里造解包树并以进程级调用判定",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/install-smoke.test.js",
          why: "验收段在沙盒里造解包树与安装包假字节,以进程级调用逐条注入缺失冒烟入口 / 冒烟判红 / 日志留痕等漂移并断言非零退出",
        },
      ],
    },

    /* ---------- 仅某条 workflow 的 job ---------- */
    env: {
      id: "env",
      title: "环境指纹门禁",
      npmScripts: ["check:env"],
      command: "node gates/repo/print-env-fingerprint.mjs",
      modulePath: "gates/repo/print-env-fingerprint.mjs",
      access: "workflow",
      judgment: { module: "gates/repo/print-env-fingerprint.mjs", export: "collectEnvironmentFingerprint", shaped: "指纹对象" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/env-fingerprint.test.js",
          why: "验收段以合成输入造出与本模块同形的探针结果,断言渲染层的降级/判红判定会抓错(命令探测失败不得被渲染成「一切正常」)",
        },
      ],
    },
    supply: {
      id: "supply",
      title: "供应链门禁(SCA / SBOM / 许可证)",
      npmScripts: ["check:supply"],
      command: "node gates/supply/supply/check-supply-chain.mjs",
      modulePath: "gates/supply/supply/check-supply-chain.mjs",
      access: "workflow",
      judgment: { module: "gates/supply/supply/check-supply-chain.mjs", export: "runSupplyChecks", shaped: "{ problems, reports }" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/supply-chain.test.js",
          why: "验收段在临时目录造沙盒 lockfile,注入假的 npm transport 与 OSV fetch,断言真实漏洞判红、扫描源不可用判 unavailable(绝不冒充「无漏洞」)、production/dev 区分正确",
        },
      ],
    },

    /* ---------- 仅本地手动 ---------- */
    "gate-probes": {
      id: "gate-probes",
      title: "门禁阴性探针编排门禁(含注册表自检)",
      npmScripts: ["check:gates"],
      command: "node gates/probe/check-gate-probes.mjs",
      modulePath: "gates/probe/gate-probes/registry.mjs",
      access: "local",
      // 刻意**内联**而不是写成指向本模块的指针:驱动器解析指针时会 `import()` 那个模块,
      // 而本模块此刻正卡在自己的顶层 await 上 —— 自指会死锁(实测:unsettled top-level await)。
      // 内联还顺带让这道门禁成为「内联判定本体」这条路线的活样板。
      judgment: (gateCtx) => checkGateRegistry(gateCtx),
      judgmentNote:
        "本门禁的判定本体就是「注册表自检」:核对两条调用路径的覆盖、每道门禁必带探针、"
        + "每个判定本体指针可解析、探针载体真实存在、接入点双向一致。"
        + "它同时是三种驱动器共用同一份判定的**活样板** —— 判定在 checkGateRegistry(可注入纯函数),"
        + "CLI 在 check-gate-probes.mjs,沙盒探针在 gates/registry.mjs,验收段在 gate-registry-gate 段。",
      probes: [
        {
          kind: "sandbox",
          ref: "registry",
          why: "探针对**合成的**注册表逐条注入故障(抽掉一道门禁的探针 / 让新出现的调用点无人登记 / 让判定本体指针指向不存在的导出 / 让探针指向不存在的载体 / 改错接入点),断言本门禁逐条判红 —— 即「注册表自己证明自己不是恒绿」",
        },
        { kind: "segment", ref: "test/segments/gate-registry-gate.test.js", why: "验收段直接 import 判定本体,对每条判据逐条做正负夹具" },
      ],
    },
    docs: {
      id: "docs",
      title: "文档指针门禁(薄包装,载体在全局配置目录)",
      npmScripts: ["check:docs"],
      command: "node gates/repo/check-docs.mjs",
      modulePath: "gates/repo/check-docs.mjs",
      access: "local",
      judgment: {
        module: "gates/repo/check-docs.mjs",
        export: "main",
        shaped: "退出码(0 = 通过 / 载体不可达而跳过)",
      },
      judgmentNote:
        "判定体在全局配置仓的 tools/check-pointers.mjs,本仓是薄包装(不持有第二份逻辑);载体不可达时打印「未判定」并 exit 0,故它刻意不在任何链上。"
        + "REQ-118:本模块已改为 `process.argv[1]` 入口守卫 —— 它此前是段硬超时的**唯一根因**(顶层自执行经 "
        + "`execFileSync(process.execPath, …)` 在 Electron 里起 electron.exe GUI 进程,永不退出)。"
        + "守卫之后 import 无副作用,指针走默认的真 import 档。",
      probes: [
        {
          kind: "selftest",
          ref: "gates/repo/check-docs.selftest.mjs",
          why: "自检脚本用夹具配置仓目录驱动本包装,断言参数透传、退出码原样传出、载体不可达时那行显眼痕迹确实打印",
        },
      ],
    },
    "install-smoke": {
      id: "install-smoke",
      title: "安装烟测门禁",
      npmScripts: ["check:install-smoke"],
      command: "node gates/artifacts/check-install-smoke.mjs",
      modulePath: "gates/artifacts/check-install-smoke.mjs",
      access: "local",
      judgment: { module: "gates/artifacts/check-install-smoke.mjs", export: "runInstallFlow", shaped: "流程结果" },
      judgmentNote: "默认预演模式零系统副作用;真实装卸须显式 --execute(进程级行为由验收段在沙盒里覆盖)",
      probes: [
        {
          kind: "segment",
          ref: "test/segments/install-smoke.test.js",
          why: "验收段在沙盒里覆盖进程级行为:预演零副作用、显式执行路径、卸载残留清理、失败不留半装状态",
        },
      ],
    },
    "pack-size": {
      id: "pack-size",
      title: "安装包体积门禁",
      npmScripts: ["check:pack-size"],
      command: "node gates/artifacts/pack-size.mjs",
      modulePath: "gates/artifacts/pack-size.mjs",
      access: "local",
      judgment: { module: "gates/artifacts/pack-size.mjs", export: "evaluate", shaped: "体积判定结果" },
      judgmentNote: "需真实安装包实测;判定逻辑由验收段在链内以沙盒覆盖",
      probes: [{ kind: "segment", ref: "test/segments/observability.test.js", why: "验收段以沙盒覆盖体积判定(含重复文件归类与跨版本同名文件判定)" }],
    },
    "smoke-report": {
      id: "smoke-report",
      title: "冒烟报告门禁",
      npmScripts: ["check:smoke-report"],
      command: "node gates/smoke/smoke-report.mjs",
      modulePath: "gates/smoke/smoke-report.mjs",
      access: "local",
      judgment: { module: "gates/smoke/smoke-report.mjs", export: "main", shaped: "退出码(0 = 通过)" },
      probes: [{ kind: "segment", ref: "test/segments/observability.test.js", why: "验收段以沙盒覆盖冒烟报告的解析与脱敏判定" }],
    },
    sbom: {
      id: "sbom",
      title: "SBOM 漂移门禁",
      npmScripts: ["check:sbom", "gen:sbom"],
      command: "node gates/supply/supply/gen-sbom.mjs --check",
      modulePath: "gates/supply/supply/gen-sbom.mjs",
      access: "local",
      judgment: { module: "gates/supply/supply/gen-sbom.mjs", export: "diffSbom", shaped: "漂移数组" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/supply-chain.test.js",
          why: "验收段断言 CycloneDX 1.6 SBOM 的离线确定性与 --check 漂移检测(同一 lockfile 两次生成逐字节相同,改动即漂移)",
        },
      ],
    },
    sca: {
      id: "sca",
      title: "SCA 漏洞审计门禁(独立 CLI 入口)",
      npmScripts: ["check:sca"],
      command: "node gates/supply/supply/sca-audit.mjs",
      modulePath: "gates/supply/supply/sca-audit.mjs",
      access: "local",
      judgment: { module: "gates/supply/supply/sca-audit.mjs", export: "normalizeAuditVulnerabilities", shaped: "漏洞条目数组" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/supply-chain.test.js",
          why: "验收段注入假的 npm audit 输出与 OSV 响应,断言漏洞条目归一、扫描源不可用判 unavailable 而非「无漏洞」",
        },
      ],
    },
    licenses: {
      id: "licenses",
      title: "许可证清单门禁",
      npmScripts: ["gen:licenses"],
      command: "node gates/supply/supply/gen-licenses.mjs",
      modulePath: "gates/supply/supply/gen-licenses.mjs",
      access: "local",
      judgment: { module: "gates/supply/supply/gen-licenses.mjs", export: "buildLicensesReport", shaped: "许可证报告" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/supply-chain.test.js",
          why: "验收段断言未知许可证判红、copyleft 单列、多选一分支只在生产依赖上生效",
        },
      ],
    },
    fulltext: {
      id: "fulltext",
      title: "许可证全文副本收集(按需)",
      npmScripts: ["collect:license-fulltext"],
      command: "node gates/supply/supply/collect-license-fulltext.mjs",
      modulePath: "gates/supply/supply/collect-license-fulltext.mjs",
      access: "local",
      judgment: { module: "gates/supply/supply/collect-license-fulltext.mjs", export: "collectLicenseFulltext", shaped: "收集结果" },
      probes: [
        {
          kind: "segment",
          ref: "test/segments/supply-chain.test.js",
          why: "验收段断言逐字复制生产依赖的许可证全文副本,缺项报出且状态记 incomplete(不冒充齐全)",
        },
      ],
    },
    "dual-matrix": {
      id: "dual-matrix",
      title: "双管线矩阵键覆盖登记门禁",
      npmScripts: [],
      command: "M2W_ONLY=dual-pipeline-matrix electron test/acceptance.mjs",
      modulePath: "test/segments/dual-pipeline-matrix.test.js",
      access: "local",
      judgment: { module: "test/segments/dual-pipeline-matrix.test.js", export: "run", shaped: "段结果(段内 assertMatrixShape 为判据面)" },
      judgmentNote:
        "不是 npm script,而是验收段内的一道门禁(由 M2W_ONLY 单独跑)。判据面是矩阵段自己的 assertMatrixShape"
        + "(含与台账 DUAL_PIPELINE_KEYS 的双向交叉核对),必须真跑 Electron 段 —— 该断言与 26 行 verify 同在段内 run() 里。",
      probes: [
        {
          kind: "sandbox",
          ref: "dual-matrix",
          why: "沙盒探针只改副本里矩阵段的那一行,断言形状守护判红(矩阵键漏写会被当场抓住)",
        },
      ],
    },
  }),
);

/* ---------- 调用路径发现 ---------- */

/**
 * 一条被发现的调用点。
 * @typedef {object} Invocation
 * @property {"npm" | "file"} kind npm script 名,还是仓内脚本文件路径
 * @property {string} name 名字
 * @property {Set<string>} sources 出现在哪些调用源(链路径 / workflow 文件名)
 * @property {boolean} onChain 是否出现在 npm script 链上
 * @property {boolean} onWorkflow 是否出现在某条 workflow 里
 */

/**
 * 发现**两条调用路径**上的全部调用点。
 *
 * 为什么要显式扫 workflow 而不只是 package.json:`node gates/repo/check-ci-contract.mjs`
 * 在 ci.yml 与 release.yml 里各有一处**裸调**,位置在 `npm ci` 之前做 fail-fast。
 * 那不是任何 npm script 的正文,只登记 npm script 会把这条路径整条漏掉 ——
 * 而它恰好是 Node 版本不符时最该被拦住的那一次执行。
 * @param {import("./protocol.mjs").GateCtx} ctx 注入面(经 makeCtx 补齐后的)
 * @returns {Map<string, Invocation>} `kind:name` → 调用点
 */
export function discoverInvocations(ctx) {
  const pkg = JSON.parse(ctx.readText("package.json"));
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});
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

  // ① npm script 链:递归展开 CHAIN_ROOTS 的 `npm run`,顺带记下正文里裸调的仓内脚本文件。
  // 展开与切段由 gates/repo/chain-expand.mjs 独家提供(全仓单源,见该文件头注:此前本文件
  // 与 check-ci-contract.mjs 各写一份递归实现、另有两份扁平 split('&&'),链一旦拆出子脚本
  // 扁平那几份就看不见内层调用点)。此处只保留本门禁特有的两件事:调用点归类与来源标注。
  for (const root of CHAIN_ROOTS) {
    walkChain(scripts, root, {
      onEnter: (node) => {
        // 未定义的 script 不构成调用点(链解析器已另行回报 missing,判定面不在本函数)
        if (!node.defined) return;
        note("npm", node.name, `chain:${node.path.join(">")}`, true, false);
      },
      onLeaf: (leaf) => {
        for (const m of leaf.text.matchAll(/(?:^|\s)(?:node|electron)\s+([\w./'-]+\.(?:mjs|cjs|js|cts))/g)) {
          note("file", /** @type {string} */ (m[1]).replaceAll("\\", "/"), `script:${leaf.script}`, true, false);
        }
      },
    });
  }

  // ② workflow:`npm run` 与裸调的 `node <file>` 都算调用点
  const workflowDir = path.join(ctx.root, ...WORKFLOWS_DIR.split("/"));
  const workflowFiles = isDirectory(workflowDir) ? readdirSync(workflowDir).filter((n) => n.endsWith(".yml")).sort() : [];
  for (const file of workflowFiles) {
    const text = ctx.readText(`${WORKFLOWS_DIR}/${file}`).replace(/^\s*#.*$/gm, "");
    for (const m of text.matchAll(/npm run (?:-{1,2}[\w-]+ )*([\w:.-]+)/g)) {
      note("npm", /** @type {string} */ (m[1]), `workflow:${file}`, false, true);
    }
    // 裸调:只认跟在行首/空白/`|` 后的 node|electron,避免把 `node -p "…"` 这类内联表达式
    // 与 shell 变量赋值里的字样算成调用点
    for (const m of text.matchAll(/(?:^|[\s|])(?:node|electron)\s+([\w./'-]+\.(?:mjs|cjs|js|cts))\b/gm)) {
      note("file", /** @type {string} */ (m[1]).replaceAll("\\", "/"), `workflow:${file}`, false, true);
    }
  }
  return found;
}

/**
 * 目录是否存在(薄封装:探针面里其它地方一律经 ctx.exists,只有这里需要一个「目录」判断)。
 * @param {string} target 绝对路径
 * @returns {boolean} 是否是存在的目录
 */
function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/* ---------- 判定本体:注册表自检 ---------- */

/**
 * 注册表自检(判定本体,可注入纯函数 —— 三种驱动器消费的就是它)。
 *
 * 五组判据:
 *   R1 链上的每个门禁调用点都被登记(在链上却不在册 = 新增门禁忘了登记探针);
 *   R2 workflow 上的每个调用点都被登记(裸调路径专用 —— 只登记 npm script 会漏掉它);
 *   R3 **每道门禁必带 ≥1 道探针**,每道探针都写清「为什么它能证明会被判红」,且载体真实存在;
 *   R4 每道门禁都登记了判定本体,指针可解析(模块存在 + 确实导出该名字);
 *   R5 接入点与实际调用位置**双向**一致(声明在链上的必须在链上;声明仅本地的不得出现在链上
 *      或 workflow 上 —— 后者是「本地检查被悄悄挪进链」的反向漂移)。
 * 外加一条反查:每个登记在册的自检载体都必须被某道门禁认领为探针。
 *
 * @param {import("./protocol.mjs").GateCtx} [ctx] 注入面。`deps.registry` 与 `deps.invocations`
 *   可覆盖 —— 探针据此对**合成的**注册表注入故障,证明本门禁不是恒绿。
 * @returns {import("./protocol.mjs").Problem[]} 判定结论(空数组 = 通过)
 */
export function checkGateRegistry(ctx = {}) {
  const full = makeCtx(ctx);
  const registry = /** @type {Readonly<Record<string, import("./protocol.mjs").GateEntry>>} */ (
    /** @type {unknown} */ (full.deps?.registry ?? GATE_REGISTRY)
  );
  /** @type {import("./protocol.mjs").Problem[]} */
  const problems = [];
  /** @param {string} code @param {string} message @returns {void} */
  const fail = (code, message) => problems.push(problem(code, message));
  const entries = Object.values(registry);

  /** @type {Set<string>} */
  const claimedScripts = new Set();
  /** @type {Set<string>} */
  const claimedFiles = new Set();

  for (const entry of entries) {
    for (const script of entry.npmScripts) claimedScripts.add(script);
    claimedFiles.add(entry.modulePath);
    const label = entry.npmScripts[0] ?? "无 npm script";

    // R3:探针必填
    if (!Array.isArray(entry.probes) || entry.probes.length === 0) {
      fail(
        "probe-missing",
        `门禁 ${entry.id}(${label})没有登记任何探针 —— 没人能证明它被破坏时会红。请补一道负向探针;` +
          "若确有「判定面无法被夹具覆盖」的门禁,把理由写进白名单条目交人裁决,不要留空",
      );
    } else {
      for (const probe of entry.probes) {
        if (typeof probe.why !== "string" || probe.why.trim().length < 10) {
          fail(
            "probe-reason-missing",
            `门禁 ${entry.id} 的探针 ${String(probe.kind)}:${String(probe.ref)} 缺理由(无理由的探针登记等于没登记:读者无从判断它到底证明了什么)`,
          );
        }
        if (probe.kind === "sandbox") {
          if (!GATE_IDS.includes(probe.ref)) {
            fail(
              "probe-missing",
              `门禁 ${entry.id} 的沙盒探针 id「${probe.ref}」不在 GATE_IDS 里(contract.mjs 登记的可跑探针集合),该探针不会被执行`,
            );
          }
        } else if (probe.kind === "selftest" || probe.kind === "segment") {
          if (!full.exists(probe.ref)) {
            fail(
              "probe-missing",
              `门禁 ${entry.id} 的${probe.kind === "selftest" ? "自检脚本" : "验收段"}探针指向的文件不存在:${String(probe.ref)}(探针被删/改名,而这件事此前无人会发现)`,
            );
          }
        }
      }
    }

    // R4:判定本体
    if (entry.judgment === undefined) {
      fail(
        "judgment-missing",
        `门禁 ${entry.id} 没登记判定本体 —— 三种驱动器(CLI / 沙盒探针 / 验收段)消费的是同一份判定,没有它这道门禁对驱动器而言是无头的`,
      );
      continue;
    }
    if (!full.exists(entry.modulePath)) {
      fail("module-missing", `门禁 ${entry.id} 的实现文件不存在:${entry.modulePath}`);
    }
    if (typeof entry.judgment !== "function") {
      const ref = entry.judgment;
      if (!full.exists(ref.module)) {
        fail("judgment-module-missing", `门禁 ${entry.id} 的判定本体模块不存在:${String(ref.module)}`);
        continue;
      }
      // R4b:load 声明与「顶层是否自执行」必须一致。不一致的后果是段内要么挂死(声明 import
      // 但实际自执行 ⇒ import 起 Electron GUI 进程 / 重写文件),要么声明 static 却其实可安全
      // import(白丢一次真 import 证据)。故这一格由门禁自己对账,而不是等段去撞。
      const selfExec = topLevelSelfExecutions(full.readText(ref.module));
      const declaredStatic = ref.load === "static";
      if (declaredStatic !== (selfExec.length > 0)) {
        fail(
          "judgment-load-mismatch",
          `门禁 ${entry.id} 的判定本体 ${ref.module} 声明 load:${declaredStatic ? '"static"' : '"import"(默认)"'},`
            + `但顶层自执行事实是「${selfExec.length > 0 ? selfExec.join(" + ") : "无自执行"}」—— `
            + (declaredStatic
              ? "声明为 static 却其实可安全 import,请去掉 load 字段以恢复真 import 证据"
              : "声明为 import 却会在 import 时执行真门禁(可能挂死或写盘),必须补 load:\"static\" 并注明理由"),
        );
      }
      const audit = auditJudgmentRef(full, ref, declaredStatic ? { strict: true } : {});
      if (audit !== null) fail("judgment-ref-broken", `门禁 ${entry.id}:${audit}`);
    }
  }

  // R1 / R2:发现面 —— 发现的每个调用点都必须有归属
  const invocations = /** @type {Map<string, Invocation>} */ (
    /** @type {unknown} */ (full.deps?.invocations ?? discoverInvocations(full))
  );
  /** @param {string} script @returns {boolean} */
  const claimedScript = (script) =>
    claimedScripts.has(script) || script in PROBE_CARRIER_SCRIPTS || script in TOOLCHAIN_SCRIPTS || AGGREGATOR_SCRIPTS.includes(script);
  // 自检载体文件本身也会作为「文件级调用点」被扫到(它的 npm script 正文就是 `node <该文件>`),
  // 故载体文件同样是已归类的调用点 —— 它们归到「某道门禁的探针」这一类,而不是无主门禁。
  const claimedFilesWithCarriers = new Set([...claimedFiles, ...Object.values(PROBE_CARRIER_SCRIPTS)]);

  for (const hit of invocations.values()) {
    const where = hit.onChain ? `npm script 链(${hit.onWorkflow ? "与 workflow" : ""})` : "workflow 裸调路径";
    if (hit.kind === "npm") {
      if (!claimedScript(hit.name)) {
        fail(
          "invocation-unregistered",
          `调用点「npm run ${hit.name}」出现在${where}:${[...hit.sources].join(",")},但门禁注册表里没有它 —— ` +
            "新加一道门禁必须同时登记它的判定本体与探针,否则「有没有探针」这件事永远没人会发现",
        );
      }
      continue;
    }
    if (!claimedFilesWithCarriers.has(hit.name) && !(hit.name in TOOLCHAIN_FILES)) {
      fail(
        "invocation-unregistered",
        `调用点「${hit.name}」直接出现在${where}:${[...hit.sources].join(",")},但门禁注册表里没有它 —— ` +
          "workflow 的裸调 fail-fast 步骤也是一条真实调用路径,只登记 npm script 会整条漏掉",
      );
    }
  }

  // 反查:每个登记在册的自检载体都必须被某道门禁认领为探针
  /** @type {Set<string>} */
  const claimedCarriers = new Set();
  for (const entry of entries) {
    for (const probe of entry.probes ?? []) {
      if (probe.kind === "selftest") claimedCarriers.add(probe.ref);
    }
  }
  for (const [script, carrierFile] of Object.entries(PROBE_CARRIER_SCRIPTS)) {
    if (claimedCarriers.has(carrierFile)) continue;
    fail(
      "probe-carrier-orphan",
      `${script} 登记的负向自检载体 ${carrierFile} 没有被任何门禁认领为探针 —— 它是一段没人认领的代码,删改它不会触发任何判红`,
    );
  }

  // R5:接入点双向一致。逐个**声明者**核对(不是只查第一个认领该 script 的登记项 ——
  // 一道 script 被两道门禁登记时,只查第一个会漏掉第二道门的谎报)
  /** @type {Map<string, Invocation>} */
  const discovered = invocations;
  for (const entry of entries) {
    // R5a:声明为「在链上 / 在 workflow 上」的门禁,它声明的每个 script 都必须真的被发现在那条路上。
    // 这条单独判,是因为「声明可达但其实没人调」的漂移在下面的迭代里根本不会出现 ——
    // 没被发现的调用点压根不会进 R1/R2 的循环。
    if (entry.access === "chain" || entry.access === "workflow") {
      // 只核**接入点代表脚本**(npmScripts[0]):generate/check 成对时 `gen:*` 一侧与开发侧的
      // `start` 都不在链上,它们是这道门禁的另一条入口,不是接入点的定义。拿全部 script 去核
      // 会把「同门禁的多入口」误判成「声明与实际不符」。
      const accessScript = entry.npmScripts[0];
      if (accessScript === undefined) {
        fail(
          "access-mismatch",
          `门禁 ${entry.id} 声明接入点为「${entry.access}」,却一个 npm script 都没登记 —— 接入点无从核对`,
        );
        continue;
      }
      const hit = discovered.get(`npm:${accessScript}`);
      if (hit === undefined) {
        fail(
          "access-mismatch",
          `门禁 ${entry.id} 声明接入点为「${entry.access === "chain" ? "门禁链" : "仅 workflow"}」,但 npm run ${accessScript} 在该路径上根本不存在(门禁链:${CHAIN_ROOTS.join("/")} · workflow:${WORKFLOWS_DIR}) —— 声明与实际调用位置对不上`,
        );
        continue;
      }
      const onPath = entry.access === "chain" ? hit.onChain : hit.onWorkflow;
      if (!onPath) {
        fail(
          "access-mismatch",
          `门禁 ${entry.id} 声明接入点为「${entry.access === "chain" ? "门禁链" : "仅 workflow"}」,但 npm run ${accessScript} 的实际位置是 onChain=${String(hit.onChain)} onWorkflow=${String(hit.onWorkflow)}(${[...hit.sources].join(",")})`,
        );
      }
    }
  }
  for (const hit of discovered.values()) {
    if (hit.kind !== "npm") continue;
    const sources = [...hit.sources].join(",");
    for (const entry of entries.filter((item) => item.npmScripts.includes(hit.name))) {
      if (entry.access === "chain" && !hit.onChain) {
        fail("access-mismatch", `门禁 ${entry.id} 声明接入点为「门禁链」,但 npm run ${hit.name} 不在任何链上(实际只在 ${sources})`);
      }
      if (entry.access === "workflow" && (hit.onChain || !hit.onWorkflow)) {
        fail(
          "access-mismatch",
          `门禁 ${entry.id} 声明接入点为「仅 workflow」,但 npm run ${hit.name} 的实际位置是 onChain=${String(hit.onChain)} onWorkflow=${String(hit.onWorkflow)}(${sources})`,
        );
      }
      if (entry.access === "local" && (hit.onChain || hit.onWorkflow)) {
        fail("access-mismatch", `门禁 ${entry.id} 声明接入点为「仅本地手动」,但 npm run ${hit.name} 出现在 ${sources} —— 本地检查被挪进链/workflow 要走裁决,不能顺手改`);
      }
    }
  }

  return problems;
}

/* ---------- CLI 驱动器 ---------- */

/**
 * 注册表自检的 CLI 载体(判定在 checkGateRegistry,本函数只打印 + 出 0/1)。
 * @param {string[]} [argv] 参数数组(未识别即失败,不允许静默按默认值跑出「假通过」)
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = []) {
  const unknown = argv.filter((arg) => !["--help"].includes(arg));
  if (unknown.length > 0) {
    console.error(`[registry:fail] 无法识别的参数:${unknown.join(" ")}(可用 --help)`);
    return 1;
  }
  if (argv.includes("--help")) {
    console.log(
      [
        "用法: node gates/probe/gate-probes/registry.mjs [--help]",
        "  门禁注册表自检:核对两条调用路径的覆盖、每道门禁必带探针、判定本体指针可解析、探针载体存在、接入点双向一致。",
      ].join("\n"),
    );
    return 0;
  }
  return runGateCli(GATE_REGISTRY["gate-probes"] ?? fallbackSelfEntry(), {});
}

/**
 * 自指兜底:本门禁的登记项被抽掉时仍要能跑出自检(否则门禁会因「自己没登记」而无法启动)。
 * @returns {import("./protocol.mjs").GateEntry} 兜底登记项
 */
function fallbackSelfEntry() {
  return {
    id: "gate-probes",
    title: "门禁注册表自检",
    npmScripts: ["check:gates"],
    command: "node gates/probe/check-gate-probes.mjs",
    modulePath: "gates/probe/gate-probes/registry.mjs",
    access: "local",
    probes: [{ kind: "sandbox", ref: "registry", why: "自指兜底登记项:见 GATE_REGISTRY['gate-probes']" }],
    judgment: { module: "gates/probe/gate-probes/registry.mjs", export: "checkGateRegistry", shaped: "Problem[]" },
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(ROOT, "gates", "probe", "gate-probes", "registry.mjs")) {
  process.exitCode = await main(process.argv.slice(2));
}