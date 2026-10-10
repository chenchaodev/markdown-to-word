// check-tscheck-coverage.mjs 的回归守护(负向夹具)。
//
// 本门禁是纯文本判定,失效形态全是**恒绿**:walker 塌成零文件、豁免清单写成「豁免一切」、
// 判据被改成「有标注才算有标注」,它都会打印一份漂亮的计数然后 exit 0。此处逐条制造这些
// 漂移,断言判据确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 系统临时目录里的一棵合成仓根,而门禁**原位**
// 从仓内跑 —— 纯函数档直接 import 判定本体并注入 ctx(列文件 / 读文本 / 判目录 / 下限),
// 进程级档靠 cwd 指夹具根跑仓内真脚本。门禁本体零仓内依赖(只用 node: 内建 +
// shared/cli.mjs、shared/paths.js、shared/test-common-surface.js),后三者在 ESM 静态
// import 下按**文件位置**解析、与 cwd 无关,故沙盒里不需要再放一份。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统
// 临时区会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里,**不碰真实工作树**。
//
// ---- 形态:case 契约接入,但**不接 harness**(ADR-074 决定一 / ADR-068 bespoke 留在原处)----
//
// CASES 表(16 元素)与 runner 的三型分派(`unit: true` 走 fn / `realRepo|cli` 走 spawn /
// 其余走 run)结构不动,for 循环体整块收进 `await suite.case(档名, () => runCase(档))`,
// `run()`/`fn` 的「返回 null = 过 / 字符串 = 失败消息」协议原样留在本地 `runCase` 里。
// 门禁树接的是**落在 shared/ 的真实现**:`gates-stay-in-gates` 的允许面只有 `gates` /
// `shared` / `test/fixtures`,`test/` 整棵树不在其中,引不到 `test/harness/case.js`。
// case 内	assert 失败即抛、由 case 级 catch 收成**该 case** 失败,不中断后续 case。
//
// **不用合成根 harness**:9 条 run() 档另需 tsconfig 正文 / exemptDirs / minGuardedFiles
// 三个注入面,而 harness 的表只收「树型路径 → 正文 + 问题清单正则」、不接 options;4 条 unit
// 档的入参连一棵树都不是(行数组 / 无参夹具);3 条进程级档含真实仓 spawn —— judge 契约
// (`(合成根) => string[]`)完全不对型,塞进去是假接入。接 case 契约解决的是另一件事:让
// 「档数」成为可机械计数的单位(`gates-selftest-named-case` 判的就是它),迁移后分母由
// `suite.results.length` 给出(= 16)。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
import {
  analyze,
  classifyHead,
  makeTsCheckCtx,
  MIN_GUARDED_FILES,
  selfCheckClassifier,
} from "./check-tscheck-coverage.mjs";

const checkerPath = join(ROOT, "gates", "repo", "check-tscheck-coverage.mjs");

/** 一份「全都合规」的 tsconfig.test.json 文本(判据 3 的正向锚点)。 */
const GOOD_TSCONFIG = `{
  // checkJs 必须保持 false:测试跑的是 dist 编译产物
  "compilerOptions": { "checkJs": false, "allowJs": true },
}
`;

/**
 * 造一棵合成仓根并注入判定本体。
 * @param {{ files?: Record<string, string>, tsconfig?: string, exemptDirs?: readonly string[], minGuardedFiles?: number, dirs?: readonly string[] }} [spec]
 * @returns {{ problems: string[], guarded: number, exempt: number, dir: string }}
 */
function judge(spec = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-tscheck-selftest-"));
  try {
    const files = spec.files ?? { "test/core/a.test.js": "// @ts-check\nexport const a = 1;\n" };
    for (const [rel, body] of Object.entries(files)) {
      const target = join(dir, ...rel.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, body, "utf8");
    }
    if (spec.tsconfig !== null) {
      const target = join(dir, "tsconfig.test.json");
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, spec.tsconfig ?? GOOD_TSCONFIG, "utf8");
    }
    for (const d of spec.dirs ?? []) mkdirSync(join(dir, ...d.split("/")), { recursive: true });
    const result = analyze({
      root: dir,
      listFiles: () => Object.keys(files).sort(),
      readText: (relative) => readFileSync(join(dir, ...relative.split("/")), "utf8"),
      dirExists: (relative) => existsSync(join(dir, ...relative.split("/"))),
      exemptDirs: spec.exemptDirs ?? [],
      minGuardedFiles: spec.minGuardedFiles ?? 0,
    });
    return { ...result, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 以指定 cwd 跑仓内门禁本体(进程级档)。 */
function runAt(cwd, args = []) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const CASES = [
  {
    name: "夹具基线(单文件合规 + checkJs:false 且头注写明 dist)→ 零判红",
    run: () => {
      const { problems } = judge();
      return problems.length === 0 ? null : `期望零判红,实际 ${problems.length} 条:${problems.join(";")}`;
    },
  },
  {
    // 判据 1 的牙齿:一个缺标注的源文件必须被抓出来。
    name: "判据 1:某源文件缺 // @ts-check → 判红并点名该文件",
    run: () => {
      const { problems } = judge({
        files: {
          "test/core/a.test.js": "// @ts-check\nexport const a = 1;\n",
          "test/core/b.test.js": "export const b = 1;\n",
        },
      });
      return /以下源文件缺少 \/\/ @ts-check 标注:.*b\.test\.js/.test(problems.join("\n"))
        ? null
        : `期望点名 b.test.js,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    name: "判据 1:空文件单列(不得当作已标注)",
    run: () => {
      const { problems } = judge({ files: { "test/core/a.test.js": "   \n" } });
      return /a\.test\.js\(空文件\)/.test(problems.join("\n"))
        ? null
        : `期望把空文件单列,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    // 防恒绿:walker 扫不到文件时必须判红,而不是「零文件全过」。
    name: "防恒绿:受检文件数掉到下限以下 → 判红(walker 失效)",
    run: () => {
      const { problems } = judge({
        files: { "test/core/a.test.js": "// @ts-check\nexport const a = 1;\n" },
        minGuardedFiles: MIN_GUARDED_FILES,
      });
      return new RegExp(`受门禁文件数应 ≥${MIN_GUARDED_FILES},实际 1`).test(problems.join("\n"))
        ? null
        : `期望下限判红,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    // 判据 2 的牙齿:豁免清单非空时,目录不存在必须判红(防「免罪符」掩盖漂移)。
    name: "判据 2:豁免目录已不存在 → 判红并点名",
    run: () => {
      const { problems } = judge({ exemptDirs: ["pending"] });
      return /豁免目录 test\/pending 已不存在/.test(problems.join("\n"))
        ? null
        : `期望点名豁免目录缺失,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    name: "判据 2:豁免目录真实存在但一个文件都没有 → 判红(豁免白拿)",
    run: () => {
      // 豁免目录 `test/pending` 真实存在(否则会走上一条「目录已不存在」),但扫描面里
      // 一个属于它的文件都没有 ⇒ 豁免白拿。
      const { problems } = judge({
        files: { "test/core/a.test.js": "// @ts-check\nexport const a = 1;\n" },
        exemptDirs: ["pending"],
        dirs: ["test/pending"],
      });
      return problems.some((p) => /豁免目录应至少含 1 个历史副本文件/.test(p))
        ? null
        : `期望判「豁免白拿」,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    name: "判据 2:豁免清单为空是合法状态(不判红)",
    run: () => {
      const { problems } = judge({ exemptDirs: [] });
      return problems.length === 0 ? null : `期望零判红,实际:${problems.join(";")}`;
    },
  },
  {
    // 判据 3 的牙齿:checkJs 被「顺手修正」成 true 必须判红。
    name: "判据 3:checkJs 被改成 true → 判红(dist 会被拉进类型检查)",
    run: () => {
      const { problems } = judge({
        tsconfig: '{\n  // 测试跑 dist\n  "compilerOptions": { "checkJs": true }\n}\n',
      });
      return problems.some((p) => /checkJs 必须保持 false/.test(p))
        ? null
        : `期望判 checkJs 判红,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    // 反向锚点:checkJs 仍是 false 但头注删掉了 dist 原因 → 也要判红(它是两条独立判据)。
    name: "判据 3:checkJs 保持 false 但头注删掉 dist 原因 → 判红",
    run: () => {
      const { problems } = judge({
        tsconfig: '{\n  // 随手写的注释\n  "compilerOptions": { "checkJs": false }\n}\n',
      });
      return problems.some((p) => /头注必须写明 checkJs 保持 false 的原因/.test(p))
        ? null
        : `期望判头注判红,实际:${problems.join(";") || "(零判红)"}`;
    },
  },
  {
    // 抽取层直测:classifyHead 的 shebang 顺序那一格。
    // 少这一格的话,把 `findIndex(...) > 0` 改成 `>= 0` 无人发现(那会让首行 shebang 的
    // 合法次行标注被判成缺失)。
    name: "classifyHead:首行 shebang + 次行标注判 annotated(变异 `> 0` → `>= 0` 会翻脸)",
    unit: true,
    fn: () => (classifyHead(["#!/usr/bin/env node", "// @ts-check", "x"]) === "annotated" ? null : "首行 shebang + 次行标注应判 annotated"),
  },
  {
    name: "classifyHead:标注压在 shebang 之前判 missing(shebang 只能在首行)",
    unit: true,
    fn: () => (classifyHead(["// @ts-check", "#!/usr/bin/env node"]) === "missing" ? null : "应判 missing"),
  },
  {
    name: "selfCheckClassifier:内建锚点全过(判定逻辑自身的正/负锚点)",
    unit: true,
    fn: () => {
      const bad = selfCheckClassifier();
      return bad.length === 0 ? null : `锚点未过:${bad.join(";")}`;
    },
  },
  {
    name: "默认注入面可构造(不抛错)",
    unit: true,
    fn: () => {
      const ctx = makeTsCheckCtx();
      return typeof ctx.listFiles === "function" && Array.isArray(ctx.listFiles("test"))
        ? null
        : "makeTsCheckCtx 应给出可用的默认注入面";
    },
  },
  // ---- 进程级档:退出码 ----
  {
    name: "真实仓库:默认模式 exit 0 且打印结论",
    realRepo: true,
    expectCode: 0,
    expect: /\[ok\] tscheck-coverage:受检 \d+ 个测试源文件全部带 @ts-check 标注/,
  },
  {
    name: "--help 打印用法并 exit 0",
    cli: true,
    args: ["--help"],
    expectCode: 0,
    expect: /用法: node gates\/repo\/check-tscheck-coverage\.mjs/,
  },
  {
    // 未知参数必须失败:静默按默认跑一遍报绿就是「假通过」。
    name: "未知参数(不得静默按默认跑一遍报绿)",
    cli: true,
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
];

const suite = createCaseSuite();

/**
 * 跑一档夹具并按该档声明的期望核对结果(收进 `suite.case` 的断言体,抛错只记该档失败、
 * 不中断后续档)。
 *
 * 三型分派的结构与搬迁前一致:`unit: true` 走 `fn`、`realRepo|cli` 走 spawn、其余走
 * `run()` —— **`run()`/`fn` 的「返回 null = 过 / 字符串 = 失败消息」协议原样保留在这里**,
 * 不改成 throw-only(那一协议同时被表内 13 条 run/fn 档使用,改它等于改夹具表)。
 *
 * 搬迁口径:原 `failures.push(...)` 逐条改成 `assert(条件, 消息)` —— **消息逐字沿用**,原
 * `[ok]` 打印保留。原来那条「夹具抛错」的 catch 分支改成重新抛出**同一条消息**,由 case
 * 级 catch 收成「该档失败」—— 一样不打断后续档,消息也一字不改。
 * @param {object} testCase 夹具表里的一档
 */
function runCase(testCase) {
  try {
    if (testCase.unit === true) {
      const bad = testCase.fn();
      if (bad === null) console.log(`[ok] tscheck-coverage-selftest:${testCase.name}`);
      else assert(bad === null, `${testCase.name}:${bad}`);
      return;
    }
    if (testCase.realRepo === true || testCase.cli === true) {
      const cwd = testCase.realRepo === true ? ROOT : mkdtempSync(join(tmpdir(), "m2w-tscheck-cli-"));
      try {
        const { code, output } = runAt(cwd, testCase.args ?? []);
        if (code !== testCase.expectCode) {
          assert(false, `${testCase.name}:期望 exit ${testCase.expectCode},实际 ${code}\n${output}`);
        } else if (!testCase.expect.test(output)) {
          assert(false, `${testCase.name}:期望输出匹配 ${testCase.expect},实际\n${output}`);
        } else {
          console.log(`[ok] tscheck-coverage-selftest:${testCase.name}(exit ${code})`);
        }
      } finally {
        if (testCase.realRepo !== true) rmSync(cwd, { recursive: true, force: true });
      }
      return;
    }
    const bad = testCase.run();
    if (bad === null) console.log(`[ok] tscheck-coverage-selftest:${testCase.name}`);
    else assert(bad === null, `${testCase.name}:${bad}`);
  } catch (error) {
    throw new Error(`${testCase.name}:夹具抛错 ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 夹具表逐档收进 case:**档名即 case 名**(逐字沿用搬迁前 `failures.push` 记账用的 `testCase.name`)。
for (const testCase of CASES) {
  await suite.case(testCase.name, () => runCase(testCase));
}

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 与搬迁前 `failures[]` 判定等价(任一档失败即非零退出),**分母也是同一个**:搬迁前写
// `CASES.length`(= 16),搬迁后由 `suite.results.length` 自然给出。两侧一旦不等,说明有档没接进
// case —— 那正是 `gates-selftest-named-case` 要抓的形态。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) console.error(`[fail] tscheck-coverage-selftest:${failure.name}:${failure.message ?? '(无失败消息)'}`);
  console.error(`[tscheck-coverage-selftest] ${failedCases.length}/${cases.length} 条夹具未通过`);
  process.exitCode = 1;
} else {
  console.log(`[ok] tscheck-coverage-selftest:${cases.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
}