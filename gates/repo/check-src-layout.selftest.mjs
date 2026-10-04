// src 布局门禁自身的回归守护(负向夹具)。
//
// check-src-layout.mjs 是纯文本门禁,失效形态全是**恒绿**:扫描面塌缩成零文件、或白名单写坏成
// 「同名一律放行」,它都会打印一份漂亮的计数然后 exit 0 —— 而 src/ 下首行没有文件头注释、
// 或同一层里躺着两个同名 render.ts 的事实照旧。此处逐条制造这些漂移,断言判据确实以非零码
// 拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 系统临时目录里的一棵合成 src/,而门禁**原位**从仓内
// 跑 —— 纯函数档直接 import 判定本体并注入 ctx(读文本/列目录/白名单/扫描面下限),
// 进程级档靠 cwd 指夹具根跑仓内真脚本。项目根单一来源是 shared/paths.js 的 process.cwd(),
// 而 ESM 静态 import 按**文件位置**解析、与 cwd 无关,所以真脚本的仓内依赖天然可达,
// 沙盒里不需要(也不应该)再放一份 shared/。真实仓库只被**读**(夹具零 IO 之外还有一条
// 「真实仓库当前判红面与白名单零死登记」的正向对照)。
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
 */
const BASE_ALLOWLIST_FILES = Object.freeze(
  Object.fromEntries(
    DUPLICATE_BASENAME_ALLOWLIST.flatMap((entry) => entry.paths.map((rel) => [rel.slice("src/".length), CLEAN])),
  ),
);

/**
 * 造一棵合成 src/。
 * @param {Readonly<Record<string, string>>} [extra] 相对 src/ 的路径 → 正文
 * @returns {string} 夹具根绝对路径
 */
function createFixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-src-layout-selftest-"));
  for (let i = 0; i < BASE_PAD; i += 1) {
    writeUnder(dir, `src/${BASE_TOPS[i % BASE_TOPS.length] ?? "core"}/pad-${i}.ts`, CLEAN);
  }
  for (const [rel, body] of Object.entries({ ...BASE_ALLOWLIST_FILES, ...extra })) writeUnder(dir, `src/${rel}`, body);
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
 * @param {Readonly<Record<string, string>>} extra 相对 src/ 的路径 → 正文
 * @param {object} [opts]
 * @param {number} [opts.minScannedFiles] 扫描面下限
 * @param {readonly object[]} [opts.whitelist] 白名单
 * @returns {{ problems: string[], stats: import("./check-src-layout.mjs").SrcLayoutStats }}
 */
function judge(extra, opts = {}) {
  const dir = createFixture(extra);
  try {
    return checkSrcLayout({
      root: dir,
      minScannedFiles: opts.minScannedFiles ?? 0,
      whitelist: opts.whitelist ?? DUPLICATE_BASENAME_ALLOWLIST,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 在合成目录上跑门禁 CLI(进程级档;cwd 指夹具根,argv[1] 指仓内本体 —— 两者恒不相等,
 * 故入口守卫成立)。返回退出码与合并输出。
 * @param {Readonly<Record<string, string>>} extra 相对 src/ 的路径 → 正文
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runChecker(extra, args = []) {
  const dir = createFixture(extra);
  try {
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

/** 未登记的第四组同名(用来证明白名单放行的是那三个具体的组,不是 core 整层) */
const UNREGISTERED_PAIR = Object.freeze({
  "core/markdown/theme.ts": CLEAN,
  "core/pdf/theme.ts": CLEAN,
});

const CASES = [
  {
    name: "夹具基线(首行全带注释头、三个对位实现组已登记、同名组只有登记过的那三组)→ 零判红",
    judgeOnly: true,
    extra: {},
    expect: null,
  },
  {
    // 反向锚点:判据一判绿的前提是「首行确实以斜杠星号星号开头」。若这一格判红,夹具里所有
    // 合法文件都会被点名,负向夹具的红也就失去意义。
    name: "src-file-header:首行是斜杠星号星号注释块 → 判绿",
    judgeOnly: true,
    extra: { "core/docx/theme.ts": "/**\n * 主题配置。\n */\nexport const theme = {};\n" },
    expect: null,
  },
  {
    name: "src-file-header:首行直接是 import → 判红并点名路径与行号",
    judgeOnly: true,
    extra: { "core/pipeline/parse.ts": 'import { remark } from "remark";\nexport const p = remark;\n' },
    expect: /src\/core\/pipeline\/parse\.ts:1 → src-file-header/,
  },
  {
    name: "src-file-header:shebang 文件以 shebang 之后的第一行计(带注释头 → 判绿)",
    judgeOnly: true,
    extra: { "cli/run.js": "#!/usr/bin/env node\n/**\n * 入口。\n */\nexport const run = () => undefined;\n" },
    expect: null,
  },
  {
    name: "src-file-header:shebang 之后那一行不是注释头 → 判红在第 2 行(不是第 1 行)",
    judgeOnly: true,
    extra: { "cli/run.js": "#!/usr/bin/env node\nexport const run = () => undefined;\n" },
    expect: /src\/cli\/run\.js:2 → src-file-header/,
  },
  {
    // 单星注释是「有注释」但不是「文件头」:这一格挡住的正是「把双星当单星写」的省事修法
    name: "src-file-header:首行是单星注释而不是双星 → 判红",
    judgeOnly: true,
    extra: { "core/text/merge.ts": "/* 临时说明,不是文件头。 */\nexport const merge = 1;\n" },
    expect: /src\/core\/util\/merge\.ts:1 → src-file-header/,
  },
  {
    name: "src-no-duplicate-basename:同层两个非 index 同名文件 → 判红并点名两个完整路径",
    judgeOnly: true,
    extra: { "core/docx/handlers/dup.ts": CLEAN, "core/pipeline/dup.ts": CLEAN },
    expect: /src\/core\/docx\/handlers\/dup\.ts \+ src\/core\/pipeline\/dup\.ts → src-no-duplicate-basename/,
  },
  {
    // 反向锚点:白名单放行的是那三个**具体**的组,不是 core 整层 —— 第四组同名仍判红。
    // 只做「三组绿」那一格不足以证明白名单是窄的:整层放行的实现在那一格同样全绿。
    name: "src-no-duplicate-basename:第四组未登记的同名仍判红(白名单不是 core 整层放行)",
    judgeOnly: true,
    extra: UNREGISTERED_PAIR,
    expect: /src\/core\/markdown\/theme\.ts \+ src\/core\/pdf\/theme\.ts → src-no-duplicate-basename/,
  },
  {
    // 判据二的扩展名集合比判据一多一个 .mjs,而 src/ 当前一个 .mjs 都没有 ⇒ 这条是那道
    // 「两族共用一个 continue ⇒ .mjs 整族跳过判据二」的漏法的唯一防线,不写它在真实仓库上看不出来。
    name: "src-no-duplicate-basename:.mjs 也在判据二的扫描面内(两个同名 .mjs 同层)→ 判红",
    judgeOnly: true,
    // 同一个顶层目录内的两个同名 .mjs(跨顶层目录同名不判红,那是另一条已覆盖的规则)
    extra: { "core/docx/tool.mjs": CLEAN, "core/pdf/tool.mjs": CLEAN },
    expect: /src\/core\/docx\/tool\.mjs \+ src\/core\/pdf\/tool\.mjs → src-no-duplicate-basename/,
  },
  {
    name: "src-no-duplicate-basename:index 不参与同名判定(两个 index.ts 同层)→ 判绿",
    judgeOnly: true,
    extra: { "core/markdown/index.ts": CLEAN, "core/pdf/index.ts": CLEAN },
    expect: null,
  },
  {
    name: "src-no-duplicate-basename:跨顶层目录同名不判红 → 判绿",
    judgeOnly: true,
    extra: { "main/settings.ts": CLEAN, "renderer/settings.ts": CLEAN },
    expect: null,
  },
  {
    name: "src-no-duplicate-basename:同组三个同名文件仍只报一条并点名全部路径",
    judgeOnly: true,
    extra: { "core/docx/handlers/dup.ts": CLEAN, "core/pipeline/dup.ts": CLEAN, "core/text/dup.ts": CLEAN },
    expect: /src\/core\/docx\/handlers\/dup\.ts \+ src\/core\/pipeline\/dup\.ts \+ src\/core\/util\/dup\.ts → src-no-duplicate-basename/,
  },
  {
    // 死登记:搬完文件忘了删白名单,清单会越养越宽而白名单越宽判红面越小 —— 这条断言是
    // 「白名单不是免死金牌」的机械保证(B 断言:登记的两个路径必须真的还在、真的同名)。
    name: "白名单死登记(登记的第二个路径搬走了)→ 判红",
    judgeOnly: true,
    extra: {},
    whitelistOverride: (real) =>
      real.map((entry) =>
        entry.id === "render-orchestrator" ? { ...entry, paths: ["src/core/docx/render.ts", "src/core/pdf/gone.ts"] } : entry,
      ),
    expect: /render-orchestrator → allowlist-(?:stale|malformed):登记的路径在 src\/ 下不存在:src\/core\/pdf\/gone\.ts/,
  },
  {
    name: "白名单缺 why → 判红(人工复核的唯一依据不得留空)",
    judgeOnly: true,
    extra: {},
    whitelistOverride: (real) => real.map((entry) => ({ ...entry, why: "  " })),
    expect: /allowlist-malformed:白名单项缺 why/,
  },
  {
    name: "白名单登记的路径 basename 与 base 不同名 → 判红",
    judgeOnly: true,
    // 第二个路径造出来(否则只会命中「路径不存在」那一格,验不到 basename 这一格)
    extra: { "core/pdf/orchestrator.ts": CLEAN },
    whitelistOverride: (real) =>
      real.map((entry) =>
        entry.id === "render-orchestrator" ? { ...entry, paths: ["src/core/docx/render.ts", "src/core/pdf/orchestrator.ts"] } : entry,
      ),
    expect: /render-orchestrator → allowlist-malformed:登记的 .* 的 basename 与 render\.ts 不同名/,
  },
  {
    // 防「扫不到东西所以恒绿」:walker 整体失效时两族判据都会「全绿」,而恒绿是纯文本门禁
    // 最坏的失效形态 —— 没人会去看一个总是 exit 0 的脚本。
    name: "扫描面塌缩(文件数掉到下限以下)→ 判红",
    judgeOnly: true,
    extra: {},
    minScannedFiles: BASE_PAD + 1000,
    expect: /scan-surface-collapsed:.*只扫到 \d+ 个参与首行判定的文件\(下限 \d+\)/,
  },
  {
    // 默认 vs --enforce 的退出码必须不同:这条是 ADR-064 的 T0 节奏本身的回归守护 ——
    // 有人把默认改成 fail-closed,门禁会当场进不了 verify:ci,而「进不了链」对注册表不可见。
    name: "默认模式判红时仍 exit 0(报告模式)",
    cli: true,
    extra: { "core/pipeline/parse.ts": 'import { remark } from "remark";\n' },
    expectCode: 0,
    expect: /\[report\] src 布局两族判据当前判红 1 项,未转成非零退出/,
  },
  {
    name: "--enforce 与默认模式退出码不同(同一棵有判红的树:0 vs 1)",
    cli: true,
    extra: { "core/pipeline/parse.ts": 'import { remark } from "remark";\n' },
    args: ["--enforce"],
    expectCode: 1,
    expect: /src\/core\/pipeline\/parse\.ts:1 → src-file-header/,
  },
  {
    name: "--enforce 在无判红时仍 exit 0(反向锚点:证明上一条的红来自判红而非开关本身)",
    cli: true,
    extra: {},
    args: ["--enforce"],
    expectCode: 0,
    expect: /\[ok\] src 布局两族判据通过\(--enforce\)/,
  },
  {
    name: "默认模式输出两族计数并点名判红文件(验收口径 ①)",
    cli: true,
    extra: { "core/pipeline/parse.ts": 'import { remark } from "remark";\n', ...UNREGISTERED_PAIR },
    expectCode: 0,
    expect: /src-file-header 判红 1 项.*src-no-duplicate-basename 同名组 4 组 → 判红 1 组.*点名文件:.*theme\.ts/s,
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
    // 正向对照:真实仓库只被读。判红面是**当前事实**,故断言写成「两族计数自洽且退出码 0」
    // 而不是写死条数 —— 写死会在 T2 搬完文件那天变成一条自己把自己判红的夹具。
    name: "真实仓库:默认模式 exit 0 且输出两族计数",
    realRepo: true,
    expectCode: 0,
    expect: /\[ok\] src 布局两族判据通过\(报告模式\)|\[report\] src 布局两族判据当前判红 \d+ 项/,
  },
];

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  try {
    if (testCase.judgeOnly === true) {
      const { problems, stats } = judge(testCase.extra ?? {}, {
        minScannedFiles: testCase.minScannedFiles,
        whitelist:
          testCase.whitelistOverride === undefined
            ? DUPLICATE_BASENAME_ALLOWLIST
            : testCase.whitelistOverride(DUPLICATE_BASENAME_ALLOWLIST),
      });
      const joined = problems.join("\n");
      const statsText = `stats=${JSON.stringify(stats)}`;
      if (testCase.expect === null) {
        if (problems.length === 0) {
          console.log(`[ok] src-layout-selftest:${testCase.name}(零判红 / ${statsText})`);
        } else {
          failures.push(`${testCase.name}:期望零判红,实际 ${problems.length} 条\n${joined}`);
        }
        continue;
      }
      if (testCase.expect.test(joined)) {
        console.log(`[ok] src-layout-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
      } else {
        failures.push(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
      }
      continue;
    }

    // 进程级档:真实仓库那条只读,其余在合成目录里以 cwd 指夹具跑仓内真脚本
    const run = testCase.realRepo === true
      ? runAt(projectRoot, [])
      : runChecker(testCase.extra ?? {}, testCase.args ?? []);
    if (run.code !== testCase.expectCode || !testCase.expect.test(run.output)) {
      failures.push(
        `${testCase.name}:期望 exit=${testCase.expectCode} 且输出匹配 ${testCase.expect},`
        + `实际 exit=${String(run.code)}\n${run.output}`,
      );
      continue;
    }
    console.log(
      `[ok] src-layout-selftest:${testCase.name}`
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
  for (const failure of failures) console.error(`[src-layout-selftest:fail] ${failure}`);
  console.error(`[src-layout-selftest:fail] src 布局门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] src-layout-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
