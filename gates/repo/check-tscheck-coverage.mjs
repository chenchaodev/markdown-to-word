// 测试树 `@ts-check` 覆盖率门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 为什么它曾是段、T3 步 6 又搬回门禁 ----
//
// 它此前是 `test/core/tscheck-coverage.test.js`。它做的活与 `check-test-numbering.mjs` /
// `check-temp-cleanup.mjs` **同型**:扫测试树、对文件文本下契约、exit 0/1。同一类工作三种
// 摆放,而它之所以落在段里是**偶然** —— 它的三条断言要用段的 `run()` / `assert` /
// `fixtures` 约定才能被 runner 发现,而这三条约定纯属段机制,不带任何「被测主体」的含义。
//
// 段这个位置还带来一个实质代价:它的被测主体是「测试树的类型门禁口径」,**不属于任何
// 被测层**,于是 `check-test-layout.mjs` 的 L4 判它「零本层主体」—— 那条判红在段位置上
// **无法靠声明解决**(声明任何 `src/<层>/**` 都只能靠撒谎变绿)。搬成门禁后,主体就是
// 它自己,位置与主体对齐,L4 那格判红随之消失。
//
// ---- 守护的三条契约(见 tsconfig.test.json 头注)----
// 1) `test/` 下每个 js/mjs/cjs 源文件都必须带 `// @ts-check` 注释 —— 这是本项目唯一的
//    「测试代码受 typecheck 门禁」机制(`checkJs` 必须保持 false,否则被 import 的 dist
//    编译产物会被拉进检查范围,产生上千条无意义报错)。
// 2) 豁免目录清单(`EXEMPT_DIRS`)非空时,每个豁免目录必须真实存在且非空 —— 防止「显式
//    豁免」变成掩盖漂移的免罪符。清单为空是合法状态(2026-09-27 起无豁免目录)。
// 3) `tsconfig.test.json` 必须仍是 `checkJs: false` 且写明原因 —— 防止后续有人「顺手修正」
//    把 dist 编译产物拖进类型检查。
//
// ---- 防假通过三处 ----
//   - 判定逻辑(纯函数 `classifyHead`)先跑**合成样本**的正/负锚点,再用于真实文件树;
//   - 受检文件总数有**下限**:walker 失效(include 写错 / 目录改名)时不得静默「零文件全过」;
//   - 扫描面取自 `shared/test-common-surface.js` 的 `listScanFiles`(与两道兄弟门禁同一
//     单源),不在本文件自持一份清单 —— 同一份清单写两遍的代价是「新增测试子目录要改 N 处,
//     漏改的那处扫不到且静默恒绿」。
//
// ---- 它会不会扫到自己 ----
// 不会(这是搬成门禁后必须确认的一点):本文件在 `gates/repo/` 下,而扫描面是
// `shared/test-common-surface.js` 的 `listScanFiles`,它只扫 `test/**`。所以门禁本体
// **不需要**给自己加 `// @ts-check` 才能被自己看见 —— 但它仍按仓内 `gates/**` 的统一
// 口径带上了(见文件首行),那是 eslint/tsc 侧的纪律,与本门禁的扫描面无关。
//
// 用法:
//   node gates/repo/check-tscheck-coverage.mjs
//   node gates/repo/check-tscheck-coverage.mjs --help

import fs from "node:fs";
import path from "node:path";
import { listScanFiles } from "../../shared/test-common-surface.js";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

const USAGE = "用法: node gates/repo/check-tscheck-coverage.mjs [--help]";

/**
 * 不参与类型门禁的显式豁免目录(相对 test/)。
 * 2026-09-27:`test/pending/` 阶段 3 历史副本已删(其断言已由
 * `test/core/core-resources.test.js` 覆盖),豁免清单清空。
 * 留空数组是合法状态:此时唯一的防「静默零覆盖」下限断言是文件数下限,`EXEMPT_DIRS`
 * 非空时它才会被启用。
 * @type {readonly string[]}
 */
export const EXEMPT_DIRS = Object.freeze([]);

/**
 * 受检文件数下限:walker 静默失效(目录改名 / 权限 / 扫描面写错)会退化成「零文件全过」,
 * 那是纯文本门禁最坏的失效形态。实测受检文件数为三位数,下限取其约 3/4。
 */
export const MIN_GUARDED_FILES = 100;

/** 头注判定结果。 */
/** @typedef {"annotated"|"missing"|"empty"} HeadState */

/**
 * 判定单文件头部的 `@ts-check` 标注状态(纯函数,便于合成样本锚点)。
 * 规则:shebang 只能位于首行(位于后续行说明文件损坏 → 判缺失);首行是 shebang 时
 * 第二行必须是 `// @ts-check`;否则首行必须是 `// @ts-check`。
 * @param {string[]} lines 文件按行切分
 * @returns {HeadState} 标注状态
 */
export function classifyHead(lines) {
  const head = lines.filter((l) => l.trim() !== "");
  const first = head[0];
  if (first === undefined) return "empty";
  if (head.findIndex((l) => l.trimStart().startsWith("#!")) > 0) return "missing";
  if (first.trimStart().startsWith("#!")) {
    return head[1]?.trim() === "// @ts-check" ? "annotated" : "missing";
  }
  return first.trim() === "// @ts-check" ? "annotated" : "missing";
}

/**
 * 判定本体的注入面(IO 全部经它进来,判定本体自身不碰 fs —— 与 check-test-layout.mjs /
 * check-src-layout.mjs 同一范式)。
 *
 * @typedef {object} TsCheckCtx
 * @property {(relative: string) => string[]} listFiles 列「受检文件」的仓库相对 POSIX 路径
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {(relative: string) => boolean} dirExists 判仓库相对目录是否存在
 * @property {readonly string[]} exemptDirs 豁免目录清单(相对 test/)
 * @property {number} minGuardedFiles 受检文件数下限(0 = 关闭该判据,合成夹具用)
 */

/**
 * 默认注入面:扫描面取自 `listScanFiles`(与两道兄弟门禁同一单源)。
 * @param {Partial<TsCheckCtx>} [base]
 * @returns {TsCheckCtx}
 */
export function makeTsCheckCtx(base = {}) {
  const root = ROOT;
  return {
    listFiles: base.listFiles ?? ((relative) => listScanFiles(root).filter((f) => f.startsWith(`${relative}/`))),
    readText: base.readText ?? ((relative) => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    dirExists: base.dirExists ?? ((relative) => fs.existsSync(path.join(root, ...relative.split("/")))),
    exemptDirs: base.exemptDirs ?? EXEMPT_DIRS,
    minGuardedFiles: base.minGuardedFiles ?? MIN_GUARDED_FILES,
  };
}

/**
 * 判定本体(可注入纯函数):返回问题清单与计数,IO 全部经 ctx。
 *
 * 三条判据各自独立报红,不合并 —— 「某文件缺标注」与「tsconfig 被顺手改成 checkJs:true」
 * 是两件不同的事,合成一条消息会让修的人以为改一个就够。
 *
 * @param {Partial<TsCheckCtx>} [base] 注入面
 * @returns {{ problems: string[], guarded: number, exempt: number }}
 */
export function analyze(base = {}) {
  const ctx = makeTsCheckCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const missing = [];
  let guarded = 0;
  let exempt = 0;

  // ---- 判据 1:非豁免目录下每个源文件都必须带标注 ----
  for (const rel of ctx.listFiles(TEST_DIR_POSIX)) {
    const inTest = rel.slice(TEST_DIR_POSIX.length + 1);
    if (ctx.exemptDirs.some((d) => inTest === d || inTest.startsWith(`${d}/`))) {
      exempt += 1;
      continue;
    }
    const state = classifyHead(ctx.readText(rel).split(/\r?\n/));
    if (state === "missing") missing.push(inTest);
    else if (state === "empty") missing.push(`${inTest}(空文件)`);
    else guarded += 1;
  }
  if (missing.length > 0) {
    problems.push(
      `以下源文件缺少 // @ts-check 标注:${missing.join(", ")}`
      + " —— 这是本项目唯一的「测试代码受 typecheck 门禁」机制(checkJs 必须保持 false)",
    );
  }
  // 下限判据:walker 失效时不得静默零文件通过(它会让上面那条恒绿)
  if (ctx.minGuardedFiles > 0 && guarded < ctx.minGuardedFiles) {
    problems.push(
      `受门禁文件数应 ≥${ctx.minGuardedFiles},实际 ${guarded}(walker 可能失效:`
      + "扫描面写错 / 目录改名 / 扩展名谓词失配)",
    );
  }

  // ---- 判据 2:豁免目录必须真实存在(显式豁免不得变成掩盖漂移的免罪符)----
  if (ctx.exemptDirs.length > 0) {
    for (const d of ctx.exemptDirs) {
      if (!ctx.dirExists(`${TEST_DIR_POSIX}/${d}`)) {
        problems.push(
          `豁免目录 ${TEST_DIR_POSIX}/${d} 已不存在,请同步更新 EXEMPT_DIRS 与 tsconfig.test.json 头注`,
        );
      }
    }
    if (exempt === 0) problems.push("豁免目录应至少含 1 个历史副本文件(否则豁免白拿)");
  }

  // ---- 判据 3:checkJs 必须保持 false,且头注写明 dist 原因 ----
  const tsconfigTest = ctx.readText(TSCONFIG_REL);
  if (!/"checkJs"\s*:\s*false/.test(tsconfigTest)) {
    problems.push(`${TSCONFIG_REL} 的 checkJs 必须保持 false(否则 dist 编译产物会被拉进类型检查)`);
  }
  if (!/checkJs 必须保持 false[\s\S]*dist/.test(tsconfigTest)) {
    problems.push(`${TSCONFIG_REL} 头注必须写明 checkJs 保持 false 的原因(测试跑 dist 编译产物)`);
  }

  return { problems, guarded, exempt };
}

/** 受检子树(仓相对 POSIX)。 */
const TEST_DIR_POSIX = "test";
/** 判据 3 的判定对象(仓相对 POSIX)。 */
const TSCONFIG_REL = "tsconfig.test.json";

/**
 * 判定逻辑的正/负锚点:先证明 checker 会抓缺失,再用于真实文件树。
 * 放在 `analyze` 之外单列,是让它可被 selftest 直接复用(合成夹具不必造整棵树)。
 * @returns {string[]} 失败消息;空数组 = 锚点全过
 */
export function selfCheckClassifier() {
  /** @type {string[]} */
  const bad = [];
  const cases = [
    { lines: ["// @ts-check", "export const a = 1;"], want: "annotated", why: "首行标注应判为已标注" },
    { lines: ["", "  // @ts-check  ", "x"], want: "annotated", why: "空行与缩进应被容忍" },
    { lines: ["#!/usr/bin/env node", "// @ts-check", "x"], want: "annotated", why: "shebang 在前 + 次行标注应判为已标注" },
    { lines: ["// @ts-check", "#!/usr/bin/env node"], want: "missing", why: "标注压在 shebang 之前必须判红(shebang 只能位于首行)" },
    { lines: ["import fs from 'node:fs';"], want: "missing", why: "无标注应判为缺失" },
    { lines: ["   "], want: "empty", why: "空文件应单列" },
  ];
  for (const c of cases) {
    const got = classifyHead(c.lines);
    if (got !== c.want) bad.push(`${c.why}(期望 ${c.want},实际 ${got})`);
  }
  return bad;
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按结论出 0/1。
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["help"], usage: USAGE });
  } catch (error) {
    console.error(`[tscheck-coverage:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }
  const anchorBad = selfCheckClassifier();
  if (anchorBad.length > 0) {
    console.error(`[tscheck-coverage:fail] 判定逻辑自身的正/负锚点未通过:${anchorBad.join(";")}`);
    return 1;
  }
  const { problems, guarded, exempt } = analyze();
  if (problems.length === 0) {
    console.log(
      `[ok] tscheck-coverage:受检 ${guarded} 个测试源文件全部带 @ts-check 标注`
      + `(豁免 ${exempt} / 清单${EXEMPT_DIRS.length === 0 ? "为空" : `=${EXEMPT_DIRS.join(",")}`})`
      + `;${TSCONFIG_REL} 保持 checkJs:false 且头注记录 dist 原因`,
    );
    return 0;
  }
  console.error(`[tscheck-coverage:fail] ${problems.length} 项:`);
  for (const problem of problems) console.error(`  · ${problem}`);
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI(理由同 check-test-layout.mjs)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}