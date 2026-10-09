// src 布局门禁自身的回归守护(负向夹具)。
//
// check-src-layout.mjs 是纯文本门禁,失效形态全是**恒绿**:扫描面塌缩成零文件、或白名单写坏成
// 「同名一律放行」,它都会打印一份漂亮的计数然后 exit 0 —— 而 src/ 下首行没有文件头注释、
// 或同一层里躺着两个同名 render.ts 的事实照旧。此处逐条制造这些漂移,断言判据确实以非零码
// 拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 系统临时目录里的一棵合成 src/,而门禁**原位**
// 从仓内跑 —— 纯函数档直接 import 判定本体并注入 ctx(读文本/列目录/白名单/扫描面下限),
// 进程级档靠 cwd 指夹具根跑仓内真脚本。项目根单一来源是 shared/paths.js 的 process.cwd(),
// 而 ESM 静态 import 按**文件位置**解析、与 cwd 无关,所以真脚本的仓内依赖天然可达,
// 沙盒里不需要(也不应该)再放一份 shared/。真实仓库只被**读**(夹具零 IO 之外还有一条
// 「真实仓库当前判红面与白名单零死登记」的正向对照)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统临时区
// 会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里,**不碰真实工作树**,
// 因此 check:temp-cleanup 扫不到、也不该扫到它(该门禁刻意不扫 gates/:那里 rmSync 是被测语义)。
//
// ---- 形态:一张合成根用例表 + 留在原处的 bespoke case(ADR-068 / ADR-074)----
//
// 判绿档与进程级档**不进表**,理由逐条写在各自的组注里(零问题那一格 harness 结构上表达不了;
// 退出码与 stdout 不是「问题清单」;真实仓库不是注入面)。表的行**只放纯数据**:仓库相对 POSIX
// 路径 → 正文,加期望问题清单正则。判定体需要的额外参数(改过的白名单 / 改过的扫描面下限)
// 由**调用方的 judge 闭包捕获**,harness 不接 options(ADR-068 后果节)。
//
// ⚠ **底板(BASE_FILES)是纯数据但不是字面量**:它由 BASE_PAD 个 pad 文件与白名单登记的六个
// 路径算出,故每行 `files` 都 spread 它。手抄 130 个条目不可能也不该做,而"把底板改成回调
// 传进表"就是 ADR-068 明文否决的那条路 —— 所以底板留在**本文件**里算好,表里只 spread 结果。
// 合成根里只有表里声明的东西这条(harness 头注⑤)仍然成立:本文件不预建任何目录。

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { runSyntheticRootCases, withSyntheticRoot } from "../../shared/gate-selftest-harness.mjs";
import { ROOT } from "../../shared/paths.js";
import {
  checkSrcLayout,
  DUPLICATE_BASENAME_ALLOWLIST,
  MIN_SCANNED_FILES,
} from "./check-src-layout.mjs";

const projectRoot = ROOT;
const checkerPath = join(projectRoot, "gates", "repo", "check-src-layout.mjs");

/** 合规底板:首行是斜杠星号星号开头的注释块(判据一认可的形态) */
const CLEAN = "/**\n * 夹具文件头。\n */\nexport const value = 'clean';\n";

/**
 * 夹具底板的扫描面规模:必须够到 MIN_SCANNED_FILES,否则进程级档会先被「扫描面塌缩」那条
 * 判据拦下 —— 那样「退出码不同」证明的是塌缩判据而不是两族判据。
 *
 * 文件名一律 `pad-<n>.ts`:**不得与白名单里的三个 basename(render / mermaid / table)撞名**,
 * 否则「白名单放行」那条夹具的对照组会被底板自己污染。
 */
const BASE_PAD = MIN_SCANNED_FILES + 10;

/** 底板铺在哪些顶层目录(真实仓里这几层都存在,夹具要复现「层」这个概念) */
const BASE_TOPS = Object.freeze(["core", "renderer", "main", "convert", "cli", "mcp"]);

/**
 * 底板**恒含**白名单登记的六个真实路径。
 *
 * 为什么必须恒含:死登记断言(B / C)会核对「登记的两个路径是否真的存在且真的同名」——
 * 底板若不含它们,每一夹具都会先被三条死登记判红,于是每条夹具验的都是死登记而不是它要验的
 * 那一格,而「基线零判红」这类反向锚点会永久失效。
 * 由此得到的性质正是本门禁要证的那一条:**白名单放行的是这三个具体的组,不是 core 整层。**
 *
 * 这里直接用登记的**完整仓库相对路径**(`entry.paths` 已是 `src/...` 形态),不再剥 `src/`
 * 前缀 —— 表的 `files` 键是仓库相对 POSIX 路径,与 harness 的约定一致。
 */
const BASE_ALLOWLIST_FILES = Object.freeze(
  Object.fromEntries(
    DUPLICATE_BASENAME_ALLOWLIST.flatMap((entry) => entry.paths.map((rel) => [rel, CLEAN])),
  ),
);

/**
 * 底板文件树:仓库相对 POSIX 路径 → 正文。表里每一行都 spread 它,故它是**唯一**的
 * 「夹具长什么样」的事实。pad 文件按 BASE_TOPS 轮转铺(复现「层」这个概念)。
 */
const BASE_FILES = Object.freeze({
  ...Object.fromEntries(
    Array.from({ length: BASE_PAD }, (_, i) => [
      `src/${BASE_TOPS[i % BASE_TOPS.length] ?? "core"}/pad-${i}.ts`,
      CLEAN,
    ]),
  ),
  ...BASE_ALLOWLIST_FILES,
});

/** 未登记的第四组同名(用来证明白名单放行的是那三个具体的组,不是 core 整层) */
const UNREGISTERED_PAIR = Object.freeze({
  "src/core/markdown/theme.ts": CLEAN,
  "src/core/pdf/theme.ts": CLEAN,
});

/** 判红档的默认 judge:纯函数档显式把扫描面下限关掉,让每条用例只验它要验的那一格 */
const judgeDefault = (root) =>
  checkSrcLayout({ root, minScannedFiles: 0, whitelist: DUPLICATE_BASENAME_ALLOWLIST }).problems;

/**
 * 进程级档:以指定 cwd 跑仓内门禁本体。**cwd 即求值根**(shared/paths.js 的 ROOT =
 * process.cwd()),所以这一句同时是「换根」与「不换脚本」—— 夹具里因此不需要、也不该放一份
 * 门禁副本。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给门禁的参数
 * @returns {{ code: number | null, output: string }} 退出码与合并输出
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
 * 在合成目录上跑门禁 CLI(进程级档;cwd 指夹具根,argv[1] 指仓内本体 —— 两者恒不相等,
 * 故入口守卫成立)。造树与清理由 harness 的 withSyntheticRoot 承担(清理在 finally)。
 * @param {Record<string, string>} extra 该用例自己的文件(仓库相对 POSIX 路径 → 正文)
 * @param {string[]} [args] 传给门禁的参数
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runChecker(extra, args = []) {
  return withSyntheticRoot({ ...BASE_FILES, ...extra }, (root) => runAt(root, args));
}

const suite = createCaseSuite();

// =====================================================================================
// 表一:两族判据的负向夹具(判据收注入的树、输出是问题清单 —— 这一族形态一致,进表)
// =====================================================================================

/** @type {import("../../shared/gate-selftest-harness.mjs").SyntheticRootCase[]} */
const JUDGE_CASES = [
  {
    name: "src-file-header:首行直接是 import → 判红并点名路径与行号",
    files: {
      ...BASE_FILES,
      "src/core/pipeline/parse.ts": 'import { remark } from "remark";\nexport const p = remark;\n',
    },
    expect: /src\/core\/pipeline\/parse\.ts:1 → src-file-header/,
  },
  {
    name: "src-file-header:shebang 之后那一行不是注释头 → 判红在第 2 行(不是第 1 行)",
    files: {
      ...BASE_FILES,
      "src/cli/run.js": "#!/usr/bin/env node\nexport const run = () => undefined;\n",
    },
    expect: /src\/cli\/run\.js:2 → src-file-header/,
  },
  {
    // 单星注释是「有注释」但不是「文件头」:这一格挡住的正是「把双星当单星写」的省事修法
    name: "src-file-header:首行是单星注释而不是双星 → 判红",
    files: {
      ...BASE_FILES,
      "src/core/text/merge.ts": "/* 临时说明,不是文件头。 */\nexport const merge = 1;\n",
    },
    expect: /src\/core\/text\/merge\.ts:1 → src-file-header/,
  },
  {
    name: "src-no-duplicate-basename:同层两个非 index 同名文件 → 判红并点名两个完整路径",
    files: {
      ...BASE_FILES,
      "src/core/docx/handlers/dup.ts": CLEAN,
      "src/core/pipeline/dup.ts": CLEAN,
    },
    expect: /src\/core\/docx\/handlers\/dup\.ts \+ src\/core\/pipeline\/dup\.ts → src-no-duplicate-basename/,
  },
  {
    // 反向锚点:白名单放行的是那三个**具体**的组,不是 core 整层 —— 第四组同名仍判红。
    // 只做「三组绿」那一格不足以证明白名单是窄的:整层放行的实现在那一格同样全绿。
    name: "src-no-duplicate-basename:第四组未登记的同名仍判红(白名单不是 core 整层放行)",
    files: { ...BASE_FILES, ...UNREGISTERED_PAIR },
    expect: /src\/core\/markdown\/theme\.ts \+ src\/core\/pdf\/theme\.ts → src-no-duplicate-basename/,
  },
  {
    // 判据二的扩展名集合比判据一多一个 .mjs,而 src/ 当前一个 .mjs 都没有 ⇒ 这条是那道
    // 「两族共用一个 continue ⇒ .mjs 整族跳过判据二」的漏法的唯一防线,不写它在真实仓库上看不出来。
    name: "src-no-duplicate-basename:.mjs 也在判据二的扫描面内(两个同名 .mjs 同层)→ 判红",
    // 同一个顶层目录内的两个同名 .mjs(跨顶层目录同名不判红,那是另一条已覆盖的规则)
    files: { ...BASE_FILES, "src/core/docx/tool.mjs": CLEAN, "src/core/pdf/tool.mjs": CLEAN },
    expect: /src\/core\/docx\/tool\.mjs \+ src\/core\/pdf\/tool\.mjs → src-no-duplicate-basename/,
  },
  {
    name: "src-no-duplicate-basename:同组三个同名文件仍只报一条并点名全部路径",
    files: {
      ...BASE_FILES,
      "src/core/docx/handlers/dup.ts": CLEAN,
      "src/core/pipeline/dup.ts": CLEAN,
      "src/core/text/dup.ts": CLEAN,
    },
    expect: /src\/core\/docx\/handlers\/dup\.ts \+ src\/core\/pipeline\/dup\.ts \+ src\/core\/text\/dup\.ts → src-no-duplicate-basename/,
  },
];

// =====================================================================================
// 表二至表五:白名单三条断言与扫描面下界(**每张表一个 judge**,因为它们要改判定体入参)
// =====================================================================================

/**
 * 死登记:搬完文件忘了删白名单,清单会越养越宽而白名单越宽判红面越小 —— 这条断言是
 * 「白名单不是免死金牌」的机械保证(B 断言:登记的两个路径必须真的还在、真的同名)。
 * 判据的入参(白名单)要改,而 harness 的 judge 由调用方闭包捕获 ⇒ 单行一张表。
 */
const STALE_RENDER_WHITELIST = DUPLICATE_BASENAME_ALLOWLIST.map((entry) =>
  entry.id === "render-orchestrator"
    ? { ...entry, paths: ["src/core/docx/render.ts", "src/core/pdf/gone.ts"] }
    : entry,
);

const WHY_BLANK_WHITELIST = DUPLICATE_BASENAME_ALLOWLIST.map((entry) => ({ ...entry, why: "  " }));

const BASENAME_MISMATCH_WHITELIST = DUPLICATE_BASENAME_ALLOWLIST.map((entry) =>
  entry.id === "render-orchestrator"
    ? { ...entry, paths: ["src/core/docx/render.ts", "src/core/pdf/orchestrator.ts"] }
    : entry,
);

// =====================================================================================
// bespoke case:留在原处的那些(不进表),理由逐组写在组注里
// =====================================================================================

/**
 * 组一 · 判绿档(**不进表**):断言的是**零问题**,而 harness 的表结构表达不了这一格 ——
 * `expect` 必须非空(空表行恒绿、判红信息为零),且恒绿防护把「零问题」判成失败。
 * 这正是 harness 头注里写明的「要断『零问题』请写 bespoke case」。
 * 五条反向锚点全在这一组:判绿档若整体失效,下面那一整组负向夹具的「红」就失去意义。
 */
const JUDGE_GREEN_CASES = Object.freeze([
  {
    name: "夹具基线(首行全带注释头、三个对位实现组已登记、同名组只有登记过的那三组)→ 零判红",
    extra: {},
  },
  {
    // 反向锚点:判据一判绿的前提是「首行确实以斜杠星号星号开头」。若这一格判红,夹具里所有
    // 合法文件都会被点名,负向夹具的红也就失去意义。
    name: "src-file-header:首行是斜杠星号星号注释块 → 判绿",
    extra: { "src/core/docx/theme.ts": "/**\n * 主题配置。\n */\nexport const theme = {};\n" },
  },
  {
    name: "src-file-header:shebang 文件以 shebang 之后的第一行计(带注释头 → 判绿)",
    extra: {
      "src/cli/run.js": "#!/usr/bin/env node\n/**\n * 入口。\n */\nexport const run = () => undefined;\n",
    },
  },
  {
    name: "src-no-duplicate-basename:index 不参与同名判定(两个 index.ts 同层)→ 判绿",
    extra: { "src/core/markdown/index.ts": CLEAN, "src/core/pdf/index.ts": CLEAN },
  },
  {
    name: "src-no-duplicate-basename:跨顶层目录同名不判红 → 判绿",
    extra: { "src/main/settings.ts": CLEAN, "src/renderer/settings.ts": CLEAN },
  },
]);

/**
 * 组二 · 进程级档(**不进表**):断言的是**退出码 + 合并输出**,不是「问题清单」——
 * harness 的 judge 契约是 `(合成根) => string[]`,把退出码塞进返回数组就是把「问题清单」
 * 那一格撑成通用返回通道(ADR-074 后果节的半齿纪律:期望必须在表里,才谈得上「删一条会留痕」;
 * 这一族一旦改成表,退出码的期望就会离开表)。其余六条形态一致,故仍走一张 bespoke 表驱动。
 */
const CLI_CASES = Object.freeze([
  {
    // 默认 vs --enforce 的退出码必须不同:这条是 ADR-064 的 T0 节奏本身的回归守护 ——
    // 有人把默认改成 fail-closed,门禁会当场进不了 verify:ci,而「进不了链」对注册表不可见。
    name: "默认模式判红时仍 exit 0(报告模式)",
    extra: { "src/core/pipeline/parse.ts": 'import { remark } from "remark";\n' },
    expectCode: 0,
    expect: /\[report\] src 布局两族判据当前判红 1 项,未转成非零退出/,
  },
  {
    name: "--enforce 与默认模式退出码不同(同一棵有判红的树:0 vs 1)",
    extra: { "src/core/pipeline/parse.ts": 'import { remark } from "remark";\n' },
    args: ["--enforce"],
    expectCode: 1,
    expect: /src\/core\/pipeline\/parse\.ts:1 → src-file-header/,
  },
  {
    name: "--enforce 在无判红时仍 exit 0(反向锚点:证明上一条的红来自判红而非开关本身)",
    extra: {},
    args: ["--enforce"],
    expectCode: 0,
    expect: /\[ok\] src 布局两族判据通过\(--enforce\)/,
  },
  {
    name: "默认模式输出两族计数并点名判红文件(验收口径 ①)",
    extra: { "src/core/pipeline/parse.ts": 'import { remark } from "remark";\n', ...UNREGISTERED_PAIR },
    expectCode: 0,
    expect: /src-file-header 判红 1 项.*src-no-duplicate-basename 同名组 4 组 → 判红 1 组.*点名文件:.*theme\.ts/s,
  },
  {
    name: "未知参数(不得静默按报告模式跑一遍)",
    extra: {},
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    // 正向对照:真实仓库只被读。判红面是**当前事实**,故断言写成「两族计数自洽且退出码 0」
    // 而不是写死条数 —— 写死会在 T2 搬完文件那天变成一条自己把自己判红的夹具。
    // **不进表**:读的是真实仓而不是注入面,harness 的 judge 只拿得到合成根。
    name: "真实仓库:默认模式 exit 0 且输出两族计数",
    realRepo: true,
    expectCode: 0,
    expect: /\[ok\] src 布局两族判据通过\(报告模式\)|\[report\] src 布局两族判据当前判红 \d+ 项/,
  },
]);

// -------------------------------------------------------------------------------------
// 跑:表内用例走 harness(它自己建树、跑判定、比对、汇成 case),bespoke 逐条 suite.case。
// -------------------------------------------------------------------------------------

await runSyntheticRootCases({
  group: "两族判据(合成根 · 判红档)",
  judge: judgeDefault,
  cases: JUDGE_CASES,
  suite,
});

/** 白名单三条断言各自的 judge(入参是改过的白名单,闭包捕获) */
const whitelistJudge = (whitelist) => (root) =>
  checkSrcLayout({ root, minScannedFiles: 0, whitelist }).problems;

await runSyntheticRootCases({
  group: "白名单死登记(登记的第二个路径搬走了)",
  judge: whitelistJudge(STALE_RENDER_WHITELIST),
  cases: [
    {
      name: "白名单死登记(登记的第二个路径搬走了)→ 判红",
      files: { ...BASE_FILES },
      expect: /render-orchestrator → allowlist-(?:stale|malformed):登记的路径在 src\/ 下不存在:src\/core\/pdf\/gone\.ts/,
    },
  ],
  suite,
});

await runSyntheticRootCases({
  group: "白名单缺 why(人工复核的唯一依据不得留空)",
  judge: whitelistJudge(WHY_BLANK_WHITELIST),
  cases: [
    {
      name: "白名单缺 why → 判红(人工复核的唯一依据不得留空)",
      files: { ...BASE_FILES },
      expect: /allowlist-malformed:白名单项缺 why/,
    },
  ],
  suite,
});

await runSyntheticRootCases({
  group: "白名单登记的路径 basename 与 base 不同名",
  judge: whitelistJudge(BASENAME_MISMATCH_WHITELIST),
  cases: [
    {
      // 第二个路径造出来(否则只会命中「路径不存在」那一格,验不到 basename 这一格)
      name: "白名单登记的路径 basename 与 base 不同名 → 判红",
      files: { ...BASE_FILES, "src/core/pdf/orchestrator.ts": CLEAN },
      expect: /render-orchestrator → allowlist-malformed:登记的 .* 的 basename 与 render\.ts 不同名/,
    },
  ],
  suite,
});

await runSyntheticRootCases({
  group: "扫描面塌缩(文件数掉到下限以下)",
  // 防「扫不到东西所以恒绿」:walker 整体失效时两族判据都会「全绿」,而恒绿是纯文本门禁
  // 最坏的失效形态 —— 没人会去看一个总是 exit 0 的脚本。下限高于底板规模,故必然判红。
  judge: (root) =>
    checkSrcLayout({
      root,
      minScannedFiles: BASE_PAD + 1000,
      whitelist: DUPLICATE_BASENAME_ALLOWLIST,
    }).problems,
  cases: [
    {
      name: "扫描面塌缩(文件数掉到下限以下)→ 判红",
      files: { ...BASE_FILES },
      expect: /scan-surface-collapsed:.*只扫到 \d+ 个参与首行判定的文件\(下限 \d+\)/,
    },
  ],
  suite,
});

// ---- bespoke:判绿档(零问题,harness 的表结构表达不了这一格) ----
await suite.describe("判绿档(bespoke · 零问题)", async () => {
  for (const testCase of JUDGE_GREEN_CASES) {
    await suite.case(testCase.name, async () => {
      const { problems, stats } = await withSyntheticRoot({ ...BASE_FILES, ...testCase.extra }, (root) =>
        checkSrcLayout({ root, minScannedFiles: 0, whitelist: DUPLICATE_BASENAME_ALLOWLIST }),
      );
      assert(
        problems.length === 0,
        `期望零判红,实际 ${String(problems.length)} 条:${problems.join("\n")}`
          + `(stats=${JSON.stringify(stats)})`,
      );
    });
  }
});

// ---- bespoke:进程级档(退出码 + 合并输出,不是「问题清单」) ----
await suite.describe("进程级档(bespoke · 退出码与输出)", async () => {
  for (const testCase of CLI_CASES) {
    await suite.case(testCase.name, async () => {
      const run = testCase.realRepo === true
        ? runAt(projectRoot, [])
        : await runChecker(testCase.extra, testCase.args ?? []);
      assert(
        run.code === testCase.expectCode,
        `期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}\n${run.output}`,
      );
      assert(
        testCase.expect.test(run.output),
        `期望输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`,
      );
    });
  }
});

// -------------------------------------------------------------------------------------
// 汇总:段级成败按 case 结果判(与旧实现的 failures[] 判定等价:任一 case 失败即非零退出)。
// -------------------------------------------------------------------------------------

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[src-layout-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(
    `[src-layout-selftest:fail] src 布局门禁回归守护失败,共 ${String(failures.length)}/${String(cases.length)} 条`,
  );
  process.exit(1);
}
console.log(`[ok] src-layout-selftest:${String(cases.length)} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);