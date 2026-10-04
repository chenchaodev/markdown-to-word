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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../shared/paths.js";
import {
  checkTestLayout,
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
    name: "L5:跨层 import → 命中 info 通道,且诊断含「搬去 test/behavior/ 并写 covers」指引",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    expectInfo: /test\/core\/heading-scale\.test\.js → test-layer-cross-import:core 层的段 import 了 renderer 层的主体[\s\S]*搬进 test\/behavior\/ 并在段内写 covers/,
    expect: null,
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
    expectInfo: /test\/core\/dynamic-cross\.test\.js → test-layer-cross-import:core 层的段 import 了 renderer 层的主体/,
    expect: null,
  },
  {
    // L5 恒报告的核心夹具:跨层命中**不进** problems/problems 为空 —— 它不是「轻判红」,
    // 而是结构上与退出码无关(门禁文件头「L5 为什么恒报告」)。
    name: "L5:跨层命中不进 problems(恒报告,连 --enforce 也不拦)",
    judgeOnly: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    expectInfo: /test-layer-cross-import/,
    expect: null,
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
  // ---- L7 ----
  {
    name: "L7:多一个杂物顶层目录 → 判红并点名",
    judgeOnly: true,
    extra: { [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT },
    expect: /test\/misc → test-top-dirs-exact:test\/ 顶层多出目录「misc\/」/,
  },
  {
    name: "L7:少一个镜像源层目录 → 判红并点名",
    judgeOnly: true,
    // 判据本体不删目录(夹具只经 writeUnder 加文件),故少的那一层用「base 里去掉」表达:
    // 这里改为断言「派生集里 src/ 少一层时,该层被判缺」—— 用只读派生函数验更直接。
    expect: /test-top-dirs-exact/,
    deriveMissing: true,
  },
  {
    name: "L7:恰好等于派生集∪{behavior,harness} → 判绿(反向锚点)",
    judgeOnly: true,
    extra: {},
    expect: null,
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
    expect: /test\/pipeline → test-top-dirs-exact:test\/ 顶层缺目录「pipeline\/」/,
  },
  {
    // 上一条的对侧:新层一旦建出自己的段目录,集合就平了。少这一格则「判缺」可能是因为
    // 别的理由(比如只数了目录没看层),而不是真的在核对集合。
    name: "L7:src/ 新增子目录且建出对应段目录 → 判绿(缺的那一档确实因建齐而消失)",
    judgeOnly: true,
    extra: {
      "src/pipeline/.gitkeep": "",
      [`${TEST_REL}/pipeline/parse.test.js`]: wellFormedSegment("core").replaceAll("../../dist/core/", "../../dist/pipeline/"),
    },
    expect: null,
  },
  {
    // 反向锚点:顶层目录集合相等只数**目录**。test/acceptance.mjs 是段入口(已登记在注册表
    // TOOLCHAIN_FILES),把它计入即恒红 —— 与 check-import-boundary 的 analyzeSrcTopLayers 同取舍。
    name: "L7:只数目录(顶层的 acceptance.mjs 不判红)",
    judgeOnly: true,
    extra: { [`${TEST_REL}/acceptance.mjs`]: "export const meta = {};\n" },
    expect: null,
  },
  {
    // 判据 id 自身也要钉住。**为什么单独一条**:上面那两条 L7 夹具的期望里写了
    // `test-top-dirs-exact`,但它们匹配的是**整行**,而把 id 改名的那次变异实测 0 条失败 ——
    // 因为 L7 夹具的正文靠「顶层多出/缺目录」那半截中文锚定,id 在同一行里被顺带带过,
    // 改成另一个词仍然匹配(前半截没变)。故此处只断言 id 本身。
    name: "L7 判据 id 逐字为 test-top-dirs-exact",
    judgeOnly: true,
    extra: { [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT },
    expect: /→ test-top-dirs-exact:/,
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
    // L5_PENDING 仍为 true ⇒ 未登记命中走 **info** 通道(info 断言与 problems 断言互不替代,
    // 见 runner 里那段注释)。转判红那一刻起它会改走 problems,届时这条夹具要改 expect。
    expect: null,
    expectInfo: /test\/core\/cross\.test\.js → test-layer-cross-import:.*未登记|test\/core\/cross\.test\.js → test-layer-cross-import:/,
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
    expect: null,
    expectInfo: /test\/core\/cross\.test\.js → test-layer-cross-import:.*\(dist\/main\/other\.mjs\)/,
  },
  {
    name: "L5 豁免表:键名写错(缺 specifier)→ 表本身判红(跳过它等于给静默失效开口子)",
    judgeOnly: true,
    extra: {},
    l5Exemptions: [{ segment: `${TEST_REL}/core/x.test.js`, reason: "没有 specifier 键" }],
    expect: /第 1 项缺 segment 或 specifier/,
  },
  // ---- 进程级档:默认 vs --enforce 的退出码 ----
  {
    name: "默认模式判红时仍 exit 0(报告模式)",
    cli: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    expectCode: 0,
    expect: /\[report\] test 布局四族判据当前判红 \d+ 项,未转成非零退出/,
  },
  {
    name: "--enforce 与默认模式退出码不同(同一棵有判红的树:0 vs 1)",
    cli: true,
    extra: { [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT },
    args: ["--enforce"],
    expectCode: 1,
    expect: /test\/core\/runner-report\.test\.js → test-layer-self-hosted/,
  },
  {
    name: "--enforce 在无判红时仍 exit 0(反向锚点:证明上一条的红来自判红而非开关本身)",
    cli: true,
    extra: {},
    args: ["--enforce"],
    expectCode: 0,
    expect: /\[ok\] test 布局四族判据通过\(--enforce\)/,
  },
  {
    // L5 恒报告的进程级证据:整棵树**只有** L5 命中,--enforce 仍必须 exit 0。
    // 少了这一格,「L5 不参与退出码」只是纯函数档的约定,CLI 档接线错了无人发现。
    // 段仍 import 本层主体(同 crossLayerSegment 的纪律),故这棵树真的只有 L5 一族红。
    name: "L5:只有跨层违例时 --enforce 仍 exit 0(info 通道逐条打印)",
    cli: true,
    extra: {
      [`${TEST_REL}/core/heading-scale.test.js`]: crossLayerSegment("core", "../../dist/renderer/settings/settings-logic.js"),
    },
    args: ["--enforce"],
    expectCode: 0,
    expect: /\[test-layout:pending\] test\/core\/heading-scale\.test\.js → test-layer-cross-import/,
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
    // 必须带 --enforce:默认档是报告模式,**有**判红也 exit 0(那是 ADR-064 的 T1 节奏本身)。
    // 少了这个开关,本条会以 exit=0 失败,而失败原因是「档位选错」不是「l7Missing 没被钉住」。
    args: ["--enforce"],
    expectCode: 1,
    // `expect` 必须是真 regex:判据档用 `expect === null` 表示「零判红」,而本条在进程级档
    // 里恰恰**有**一条判红(缺 shared/)。故这里钉它自己的那行诊断。
    expect: /test\/shared → test-top-dirs-exact:test\/ 顶层缺目录「shared\/」/,
    expectCount: /L7 test-top-dirs-exact 多 0 \/ 缺 1/,
    removeTopDir: "shared",
  },
  {
    name: "默认模式输出四族计数并点名判红文件(验收口径 ①②)",
    cli: true,
    extra: {
      [`${TEST_REL}/core/runner-report.test.js`]: NO_OWN_SUBJECT,
      [`${TEST_REL}/misc/junk.test.js`]: NO_OWN_SUBJECT,
    },
    expectCode: 0,
    expect: /L4 test-layer-self-hosted 判红 1 项.*L5 test-layer-cross-import 命中 \d+ 处.*L7 test-top-dirs-exact 多 1 \/ 缺 0.*L8 test-harness-not-segment 判红 0 项.*点名文件:.*runner-report/s,
  },
  {
    name: "--help 打印四族口径并 exit 0",
    cli: true,
    extra: {},
    args: ["--help"],
    expectCode: 0,
    expect: /L5\(test-layer-cross-import\)恒报告:即便 --enforce 也不参与退出码/,
  },
  {
    name: "未知参数(不得静默按报告模式跑一遍)",
    cli: true,
    extra: {},
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    // 正向对照:真实仓库只被读。判红面是**当前事实**(T1 不搬任何文件),故断言写成
    // 「四族计数自洽且退出码 0」而不是写死条数 —— 写死会在 T2/T3 搬完文件那天变成一条
    // 自己把自己判红的夹具。
    name: "真实仓库:默认模式 exit 0 且输出四族计数",
    realRepo: true,
    expectCode: 0,
    expect: /L4 test-layer-self-hosted 判红 \d+ 项.*L5 test-layer-cross-import 命中 \d+ 处.*L7 test-top-dirs-exact 多 \d+ \/ 缺 \d+.*L8 test-harness-not-segment 判红 \d+ 项/,
  },
  {
    name: "真实仓库:--enforce exit 非零且逐条点名三个零本层主体的段",
    realRepo: true,
    args: ["--enforce"],
    expectCode: 1,
    expect: /test\/core\/runner-report\.test\.js → test-layer-self-hosted/,
  },
];

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  try {
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
          const { problems } = checkTestLayout({ root: dir, minScannedFiles: 0 });
          const joined = problems.join("\n");
          if (/test\/renderer → test-top-dirs-exact:test\/ 顶层缺目录「renderer\/」/.test(joined)) {
            console.log(`[ok] test-layout-selftest:${testCase.name}(漂移被拦截)`);
          } else {
            failures.push(`${testCase.name}:期望点名缺目录 renderer,实际\n${joined || "(零判红)"}`);
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
