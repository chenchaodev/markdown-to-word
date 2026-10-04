// test 布局门禁自身的回归守护(负向夹具)。
//
// check-test-layout.mjs 是纯文本门禁,失效形态全是**恒绿**:walker 塌缩成零段、镜像源派生
// 退化成「什么都不检查」、type-only 放行豁免写成「凡引用都豁免」,它都会打印一份漂亮的
// 四族计数然后 exit 0 —— 而「段住在错的层里」「harness 下混进段」「顶层多一个杂物目录」
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
  checkTestLayout,
  CRITERIA,
  extractImports,
  MIN_SCANNED_FILES,
  NON_MIRROR_TOP_DIRS,
  TEST_REL,
} from "./check-test-layout.mjs";

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
 * —— 那样「退出码不同」证明的是塌缩判据而不是四族判据。
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
    // 防「扫不到东西所以恒绿」:walker 整体失效时四族判据都会「全绿」,而恒绿是纯文本门禁
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
      { segment: `${TEST_REL}/core/cross.test.js`, specifier: "dist/main/other.mjs", reason: "夹具:借常量当期望值" },
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
    // L4 的两格都归零(零本层主体 0 / 段 import 段 0)、L5 未登记/空 reason/stale 三档归零 ——
    // 后三档正是「L5 凭什么能转正」那个裁决的机械证据;L5 命中数不为零是合法的
    // (命中已登记在豁免表里且带非空 reason,豁免命中在判定本体里 continue、不产生 info 行)。
    // 退出码是 0,因为 L7「缺 test/tools/」是 report-only 档(空目录,已裁决不建)。
    expect: /L4 test-layer-self-hosted 判红 0 项\(零本层主体 0 \/ 段 import 段 0.*未登记判红 0 \/ 空 reason 判红 0 \/ stale 判红 0/s,
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
