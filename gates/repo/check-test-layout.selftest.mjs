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

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../shared/paths.js";
import {
  ACCESS_CHAIN,
  ACCESS_OFFCHAIN,
  checkTestLayout,
  CRITERIA,
  extractImports,
  GATE_EXEMPTIONS_REL,
  GATE_INDEX_MODULE_REL,
  loadGateExemptions,
  judgeL11Carrier,
  judgeL12ChainMembership,
  makeGateRegistryCtx,
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
 * (后者是本仓必需形态,见门禁文件头「值 import 与 type-only 引用必须分开」)。
 * @param {string} layer 层名
 * @returns {string}
 */
function wellFormedSegment(layer) {
  const distRoot = BASE_SRC_LAYERS.includes(layer) ? `../../dist/${layer}/subject.js` : `../../${layer}/subject.mjs`;
  return [
    "// @ts-check",
    "/** 夹具段:本层主体齐备。 */",
    `import { subject } from "${distRoot}";`,
    `/** @typedef {import("../../src/${layer}/types.js").Options} Options */`,
    "export const meta = { description: 'well-formed' };",
    "export async function run() { return subject; }",
    "",
  ].join("\n");
}

/**
 * 底板铺的段数:必须够到 MIN_SCANNED_FILES,否则进程级档会先被「扫描面塌缩」那条判据拦下
 * —— 那样「退出码不同」证明的是塌缩判据而不是五族判据。
 */
const BASE_PAD = MIN_SCANNED_FILES + 10;

/**
 * 造一棵合成仓根。
 * @param {Readonly<Record<string, string>>} [extra] 仓库相对 POSIX 路径 → 正文
 * @returns {string} 夹具根绝对路径
 */
function createFixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-test-layout-selftest-"));
  // ① src/ 的每一层都要有目录(纪律 ②)。放一个 .gitkeep 即可:判据只看目录名。
  for (const layer of BASE_SRC_LAYERS) writeUnder(dir, `src/${layer}/.gitkeep`, "");
  // ② test/ 的每个顶层目录都要在(纪律 ①)。behavior/ 与 harness/ 建空目录:T3 才建立内容。
  for (const top of BASE_TEST_TOPS) mkdirSync(join(dir, ...`${TEST_REL}/${top}`.split("/")), { recursive: true });
  // ③ 底板段:每层铺够 BASE_PAD 段,每段都 import 本层主体 ⇒ 基线零判红。
  // ③' L5 豁免表:合成根里也必须有一份(真实仓里有,判据从 `ctx.root` 读它)。
  // 缺了它,每条进程级夹具都会先被「豁免表读不到」判红 —— 症状离根因很远。
  // 底板给一份**空表**:各夹具要豁免什么就自己注入(ctx.l5Exemptions),不在这里预置。
  writeUnder(
    dir,
    "gates/repo/test-layout.cross-import-exemptions.json",
    `${JSON.stringify({ _comment: "夹具底板:空豁免表。", entries: [] }, null, 2)}\n`,
  );
  for (let i = 0; i < BASE_PAD; i += 1) {
    const layer = BASE_SRC_LAYERS[i % BASE_SRC_LAYERS.length] ?? "core";
    writeUnder(dir, `${TEST_REL}/${layer}/pad-${i}.test.js`, wellFormedSegment(layer));
  }
  for (const [rel, body] of Object.entries(extra)) writeUnder(dir, rel, body);
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
 * @param {number} [opts.minScannedFiles] 扫描面下限
 * @param {{segment: string, specifier: string, reason: string}[]} [opts.l5Exemptions] L5 豁免表(注入面)
 * @param {readonly Record<string, object>} [opts.gateRegistry] 门禁索引(注入面;缺省 = 空索引)
 * @param {{ id: string }[]} [opts.criteriaOverride] 判据登记表覆盖(⚠ 只允许删行,见下)
 * @returns {{ problems: string[], info: string[], stats: import("./check-test-layout.mjs").TestLayoutStats }}
 */
function judge(extra, opts = {}) {
  // missingRoot:求值根指向一个**不存在**的目录,逼 listDir 抛错(见 CASES 里那条夹具的注释)。
  // skipSrc:根与 test/ 都在,只缺 src/ ⇒ 镜像源派生不出来(另一侧输入缺失,判据点明它)。
  // 两种都仍要建夹具再删,是为了让 finally 的清理路径与其它夹具同形、不留第二套清理逻辑。
  const dir = createFixture(extra);
  try {
    if (opts.missingRoot === true) rmSync(dir, { recursive: true, force: true });
    if (opts.skipSrc === true) rmSync(join(dir, "src"), { recursive: true, force: true });
    return checkTestLayout({
      root: dir,
      minScannedFiles: opts.minScannedFiles ?? 0,
      // l5Exemptions 注入:走 base 的注入面,不读真实数据文件 ⇒ 夹具与真实仓库互不影响
      l5Exemptions: opts.l5Exemptions ?? [],
      // ⚠ **合成根必须把门禁清单也注入掉**,理由与上面那条同款但更硬:合成根里没有 `gates/`
      // 也没有 `package.json` 的 scripts 表,若让它读**真实注册表**,L11 会把 39 项门禁全判成
      // 「无载体」(合成根里当然没有载体)、L12 会因读不到 package.json 而判红 —— 于是
      // **每一条既有夹具都会先被 L11/L12 判红**,症状离根因隔着一整族判据。
      // 合成树里**没有登记任何门禁**是如实的(它就是一个 test/ 布局的合成根),
      // 故这里注入空清单;L11/L12 的正面与负向夹具各自在下面那一族里单独求值。
      gateRegistry: opts.gateRegistry ?? {},
      // 门禁级豁免表同理:合成根里没有那张数据文件,让它去读会命中「读不到 → 判红」那一档。
      gateExemptions: opts.gateExemptions ?? [],
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
function runChecker(extra, args = [], removeTopDir = undefined) {
  const dir = createFixture(extra);
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
    "export const meta = { description: 'cross-layer' };",
    "export async function run() { return [subject, other]; }",
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
  "/** 夹具段:唯一的本层引用是 type-only 的 src/ 类型引用(dist/ 不产 .d.ts,故合法且必需)。 */",
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
    // type-only 放行:本仓产物不产 .d.ts,类型引用只能指 src/。把它判红等于逼人删掉类型标注。
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
        + 'export async function run() {\n'
        + '  const other = await import("../../dist/renderer/settings/settings-logic.js");\n'
        + "  return [subject, other];\n}\n",
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
        + '/** @typedef {import("../../src/core/ipc-contract.js").RecentFile} RecentFile */\n'
        + 'export const meta = { description: "type-only-cross" };\n'
        + "/** @param {RecentFile} f @returns {unknown} */\nexport function run(f) { return [subject, f]; }\n",
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
        "export const meta = { description: 'granularity' };",
        "export async function run() { return [subject, one, other]; }",
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
];

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  try {
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
        failures.push(
          `${testCase.name}:变异未被拦截(${zombie ? "僵尸行" : "漏登记"})⇒ 本档的抽取器没有牙齿`,
        );
      }
      continue;
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
        failures.push(
          `${testCase.name}:源码发出但 CRITERIA 未登记的 id:${drift.sourceOnly.join(", ")}`
          + "(漏登记 ⇒ 那一族的强制等级无人负责;在 CRITERIA 里补一行,或确认该族已删、连 report 一起去)",
        );
        continue;
      }
      if (drift.tableOnly.length > 0) {
        failures.push(
          `${testCase.name}:CRITERIA 里有僵尸行(源码已不再发出):${drift.tableOnly.join(", ")}`
          + "(僵尸行让门禁文件头那条 grep 进度锚的命中数说谎 —— 那正是「还剩几族待转正」的唯一读数)",
        );
        continue;
      }
      if (noReason.length > 0) {
        failures.push(
          `${testCase.name}:pending: true 但 pendingReason 为空的族:${noReason.join(", ")}`
          + "(挂待办标记却说不出为什么,与说得清为什么在门禁上不可区分)",
        );
        continue;
      }
      console.log(
        `[ok] test-layout-selftest:${testCase.name}`
        + `(双向相等:${CRITERIA.length} 族 / report-only ${PENDING_ROWS} 族且每族都有 pendingReason)`,
      );
      continue;
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
        failures.push(
          `${testCase.name}:期望 ${wantSorted.length} 条 [${shape(wantSorted).join(" · ")}],`
          + `实际 ${actualSorted.length} 条 [${shape(actualSorted).join(" · ")}]`,
        );
      }
      continue;
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
          failures.push(
            `${testCase.name}:期望${testCase.expect === null ? "零读表诊断" : `匹配 ${testCase.expect}`},`
            + `实际 ${loaded.length} 条\n${joined || "(零诊断)"}`,
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      continue;
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
        failures.push(
          `${testCase.name}:判定本体发出的 id ${expectedId} 不在 CRITERIA 里 —— 它的强制等级无人负责`,
        );
        continue;
      }
      const joined = raw.join("\n");
      const statsText = `problems=${raw.length}`;
      if (testCase.expectAbsent !== undefined && testCase.expectAbsent.test(joined)) {
        failures.push(
          `${testCase.name}:期望**不**出现 ${testCase.expectAbsent},实际命中\n${joined}`,
        );
        continue;
      }
      if (testCase.expect === null) {
        // ⚠ 恒绿防护:`expect: null` 必须**真的**断「零命中」。它与「实现恒抛异常/恒返回空」
        // 只差一层 —— 故这里额外要求 problems 是数组且长度为 0,而不是「没有报错就算过」。
        if (Array.isArray(raw) && raw.length === 0) {
          console.log(`[ok] test-layout-selftest:${testCase.name}(零判红 / ${statsText})`);
        } else {
          failures.push(
            `${testCase.name}:期望零判红,实际 ${Array.isArray(raw) ? raw.length : "非数组"}\n${joined}`,
          );
        }
        continue;
      }
      if (testCase.expect.test(joined)) {
        if (testCase.expectAlso !== undefined && !testCase.expectAlso.test(joined)) {
          failures.push(`${testCase.name}:期望 problems 同时匹配 ${testCase.expectAlso},实际\n${joined}`);
          continue;
        }
        console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
      } else {
        failures.push(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
      }
      continue;
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
            failures.push(`${testCase.name}:期望点名缺目录 renderer,实际\n${joined.trim() || "(两通道皆空)"}`);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        continue;
      }
      const { problems, info, stats } = judge(testCase.extra ?? {}, {
        minScannedFiles: testCase.minScannedFiles,
        missingRoot: testCase.missingRoot,
        skipSrc: testCase.skipSrc,
        l5Exemptions: testCase.l5Exemptions,
        // L11b 一族要注入门禁索引(它判的是「判定面怎么圈」,圈法在 checkTestLayout 里)。
        // 缺省仍是空表 —— 合成树里没有 gates/,如实。
        gateRegistry: testCase.gateRegistry,
        criteriaOverride: testCase.criteriaOverride,
      });
      const joined = problems.join("\n");
      const infoJoined = info.join("\n");
      const statsText = `stats=${JSON.stringify(stats)}`;
      // info 通道的断言独立于 problems:两族语义不同(前者恒报告、后者参与退出码),
      // 合成一条 if 会让「info 判绿」与「problems 判红」两格互相掩盖。
      // expectAbsent 断「不该红的一处没红」:与 expect 断「该红的一处红了」互不替代 ——
      // 判据作用域写宽了(把不该管的目录也纳入)时,expect 那几格仍全绿,只有这一格翻脸。
      if (testCase.expectAbsent !== undefined && testCase.expectAbsent.test(joined)) {
        failures.push(
          `${testCase.name}:期望**不**出现 ${testCase.expectAbsent},实际命中\n${joined}`,
        );
        continue;
      }
      if (testCase.expectInfo !== undefined) {
        const ok = testCase.expectInfo === null ? info.length === 0 : testCase.expectInfo.test(infoJoined);
        if (!ok) {
          failures.push(
            `${testCase.name}:info 通道期望${testCase.expectInfo === null ? "零命中" : `匹配 ${testCase.expectInfo}`},`
            + `实际 ${info.length} 条\n${infoJoined || "(零命中)"}`,
          );
          continue;
        }
      }
      if (testCase.expect === null) {
        if (problems.length === 0) {
          console.log(`[ok] test-layout-selftest:${testCase.name}(零判红 / ${statsText})`);
        } else {
          failures.push(`${testCase.name}:期望零判红,实际 ${problems.length} 条\n${joined}`);
        }
        continue;
      }
      if (testCase.expect.test(joined)) {
        // expectAlso 是**第二条必须同时成立**的正向断言,与 expect 互不替代:
        // 「登记表里漏了一行」这一格只证「会记一条告警」,不证「原诊断还在」——
        // 实现若把查不到档那一族的诊断一并吞掉,expect 照样绿(告警照样记)。
        if (testCase.expectAlso !== undefined && !testCase.expectAlso.test(joined)) {
          failures.push(
            `${testCase.name}:期望 problems 同时匹配 ${testCase.expectAlso},实际\n${joined}`,
          );
          continue;
        }
        console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
      } else {
        failures.push(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
      }
      continue;
    }

    // 进程级档:真实仓库那两条只读,其余在合成目录里以 cwd 指夹具跑仓内真脚本
    const run = testCase.realRepo === true
      ? runAt(projectRoot, testCase.args ?? [])
      : runChecker(testCase.extra ?? {}, testCase.args ?? [], testCase.removeTopDir);
    // expectCount 独立于 expect:前者钉**计数器**(结论行那一档),后者钉**诊断文案**。
    // 合成一条 if 会让「文案对但计数错」与「计数对但文案错」互相掩盖 ——
    // 上面那条 L7 缺档夹具的变异实验正是这么躲过去的。
    if (testCase.expectCount !== undefined && !testCase.expectCount.test(run.output)) {
      failures.push(
        `${testCase.name}:期望结论行匹配 ${testCase.expectCount},实际 exit=${String(run.code)}\n${run.output}`,
      );
      continue;
    }
    if (run.code !== testCase.expectCode || !testCase.expect.test(run.output)) {
      failures.push(
        `${testCase.name}:期望 exit=${testCase.expectCode} 且输出匹配 ${testCase.expect},`
        + `实际 exit=${String(run.code)}\n${run.output}`,
      );
      continue;
    }
    console.log(
      `[ok] test-layout-selftest:${testCase.name}`
      + `(exit ${String(run.code)}${testCase.realRepo === true ? " / 只读真实仓库" : ""})`,
    );
  } catch (error) {
    // 一条夹具的构造/求值抛异常只登记,不让它打断整批(否则后面的夹具一条都跑不到,
    // 报告里也看不出是哪一条坏了)
    failures.push(
      `${testCase.name}:抛异常:${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[test-layout-selftest:fail] ${failure}`);
  console.error(`[test-layout-selftest:fail] test 布局门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] test-layout-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
