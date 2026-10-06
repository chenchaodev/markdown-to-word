// coverage 门禁的**两个只读输入面**:c8 参数向量(取自 package.json 的 test:coverage)与
// 基线表(阈值 / 豁免的单一登记处)。判定本体 `check-coverage-zero.mjs` 与沙盒探针
// `gates/probe/gate-probes/gates/coverage.mjs` **两侧都只从这里取**,故那两侧之间不需要
// 互相 import —— 这是它能从 `gates/probe/` 里迁出来的唯一原因。
//
// 为什么必须有这个切割层(迁移动机,勿当整洁问题看待):
// 迁前判定本体住在 `gates/probe/gate-probes/coverage-gate.mjs`,它为拿项目根与参数向量
// 直接 import 了两个沙盒模块,而 `gates/probe/gate-probes/contract.mjs:13` 在**顶层**执行
// `topLevel(ROOT)` ⇒ `import` 它即产生 IO(实测拖进 6 个沙盒模块)。而 S4 要删整个
// `gates/probe/` ⇒ 判定本体的依赖方向必须先掉头。「只读输入」这一层不依赖任何沙盒模块,
// 故先把它落在这里,判定本体与探针各自单向依赖它。
//
// **零顶层 IO**:`fs` 的每一次调用都在函数体内(全部经 `root` 形参注入),模块求值只产出
// 常量与函数声明 ⇒ `import` 它不读盘、不写盘、不改工作树。这条性质是「探针可以在任意
// 求值根上 import 它」的前提,改这个文件时不要在顶层加任何 fs 调用。
//
// 项目根一律取 `shared/paths.js`(ADR-040 的单一来源),**不**从沙盒的 contract.mjs 转出
// —— 那正是本切割层要断开的那条边。

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../shared/paths.js";
import { walkChain } from "./chain-expand.mjs";

/** 四个覆盖率指标(与 c8 的 --statements/--branches/--functions/--lines 一一对应) */
export const METRICS = Object.freeze(["statements", "branches", "functions", "lines"]);

/**
 * 覆盖率基线文件(仓库相对;阈值与豁免的唯一登记处)
 *
 * ⚠ 静态面与动态面都以本表为**比对基准**,故它是双处登记的一「侧」:另一侧是 package.json
 * 的 c8 参数向量。两侧不得互相推导(推导即恒真断言,漂移永远抓不到),只能同时改。
 */
export const BASELINE_RELATIVE = "gates/repo/coverage-baseline.json";

/**
 * shell 风格分词:双引号内为字面量(含 = 与通配符),其余按空白切。
 * c8 参数向量里有带引号的 `--include`(取值是 dist 下的 glob,内含 `*` 连写),按空白裸切会连引号
 * 一起切下来导致 glob 失效。
 * @param {string} input 命令行
 * @returns {string[]} 参数序列
 */
export function tokenizeCommand(input) {
  /** @type {string[]} */
  const tokens = [];
  let current = "";
  let inQuote = false;
  let started = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
      started = true;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * 解析 package.json 的 `test:coverage`,取出 c8 参数向量与被测程序。
 *
 * 消费者用**真实参数向量**(只把被测程序换成沙盒里的极小 harness 或夹具 harness),这样
 * 「阈值被人调低 / `--check-coverage` 被删」这类配置漂移会被当场抓住,而不是被调用方自己
 * 的参数掩盖。参见 `gates/probe/gate-probes/gates/coverage.mjs` 的文件头注:本函数是阈值
 * 向量的**唯一读取点**,故本仓不存在第二份阈值来源。
 *
 * ⚠ 本仓特有的坑(ADR-048「覆盖率产物并入 output 单源」):下面 flag 的收集是「**连续以 `--`
 * 开头的 token,遇首个非 `--` 即停**」。故带值的选项**必须写成等号形态**
 * (`--reports-dir=output/coverage`)。写成空格分隔会让收集在第二个 token 处中断,其后的
 * `--check-coverage` 与四个阈值全部丢失,而静态面的 ① requireFlags 与 ② 阈值比对会**同时**
 * 判红且都不提真正的病因(少了一个 flag)—— 排查会被引向阈值。该 ADR 已点名这条。
 *
 * @param {string} [root] 读 package.json 与探测 c8 配置文件用的根目录(缺省为真实仓库根)。
 *   **可注入是为了让静态面那条新判据能被负向夹具测到**:`check-coverage-zero.mjs` 的
 *   auditStatic(root) 要核「`--reports-dir` 取值 == SUMMARY_RELATIVE 的目录部分」,而取值
 *   只存在于 package.json 里 —— root 写死真仓库时,夹具根造出的「取值不符」根本读不到,
 *   这条判据会退化成恒绿断言(夹具测不出红)。configFiles 的探测同样走这个 root,否则夹具
 *   根会去读真仓库里不存在的 c8 配置文件。
 * @returns {{ flags: string[], program: string[], ok: boolean, reason?: string, configFiles: string[] }} 解析结果
 */
export function parseCoverageScript(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});
  // 切段与递归展开由 gates/repo/chain-expand.mjs 独家提供(全仓单源)。此前这里是裸
  // `split("&&")`:只认单层,一旦 `test:coverage` 把 c8 半段包进子脚本就找不到它,而
  // 找不到时本函数返回 ok:false —— 那一档的失败文案会指向「配置漂移」,把人引向错误的排查方向。
  // 改用叶子命令序列(深度优先 = 真实执行序)后,内层半段照样被取到。
  /** @type {string[]} */
  const leaves = [];
  walkChain(scripts, "test:coverage", { onLeaf: (leaf) => leaves.push(leaf.text) });
  const c8Part = leaves.find((part) => /^c8\b/.test(part));
  if (c8Part === undefined) {
    return { flags: [], program: [], ok: false, reason: "package.json 的 test:coverage 里找不到 c8 调用", configFiles: [] };
  }
  const tokens = tokenizeCommand(c8Part);
  /** @type {string[]} */
  const flags = [];
  let index = 1;
  while (index < tokens.length && (tokens[index] ?? "").startsWith("--")) {
    flags.push(tokens[index] ?? "");
    index += 1;
  }
  const program = tokens.slice(index);
  /** @type {string[]} */
  const configFiles = [".c8rc", ".c8rc.json", ".c8rc.yml", ".c8rc.yaml", ".nycrc", ".nycrc.json"].filter((name) =>
    fs.existsSync(path.join(root, name)),
  );
  if (typeof pkg.c8 === "object" || typeof pkg.nyc === "object") configFiles.push("package.json#c8");
  if (program.length === 0) {
    return { flags, program, ok: false, reason: "c8 调用里找不到被测程序(参数向量解析异常)", configFiles };
  }
  return { flags, program, ok: true, configFiles };
}

/**
 * 读基线文件并做结构校验。
 *
 * 本函数的 `problems` 是基线**结构**诊断的唯一来源(逐条指名是哪个字段/哪条不变量不对),
 * 静态面与动态面都直接并入它们自己的清单 —— 不在别处复制第二套结构校验。
 * @param {string} [root] 仓库根
 * @returns {{ baseline: Record<string, any> | null, problems: string[] }} 基线与结构问题
 */
export function loadBaseline(root = ROOT) {
  /** @type {string[]} */
  const problems = [];
  const baselinePath = path.join(root, BASELINE_RELATIVE);
  if (!fs.existsSync(baselinePath)) {
    return { baseline: null, problems: [`基线文件不存在:${BASELINE_RELATIVE}`] };
  }
  /** @type {any} */
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (error) {
    return { baseline: null, problems: [`基线文件不是合法 JSON:${error instanceof Error ? error.message : String(error)}`] };
  }
  if (baseline.baselineSchema !== 1) problems.push(`baselineSchema 应为 1,实际 ${JSON.stringify(baseline.baselineSchema)}`);
  if (!Array.isArray(baseline.note) || baseline.note.length === 0) problems.push("基线缺 note(必须写明本表的存在理由与维护方式)");
  if (typeof baseline.headroomPp !== "number" || baseline.headroomPp < 0) problems.push("headroomPp 必须是 ≥0 的数值(阈值允许比实测值低多少的显式余量)");
  for (const key of ["floor", "measured", "thresholds"]) {
    if (typeof baseline[key] !== "object" || baseline[key] === null) {
      problems.push(`基线缺 ${key} 段`);
      continue;
    }
    for (const metric of METRICS) {
      if (typeof baseline[key][metric] !== "number") problems.push(`${key}.${metric} 必须是数值(当前 ${JSON.stringify(baseline[key][metric])})`);
    }
  }
  if (!Array.isArray(baseline.requireFlags) || baseline.requireFlags.length === 0) problems.push("基线缺 requireFlags");
  if (!Array.isArray(baseline.exemptions)) problems.push("基线缺 exemptions 数组");
  return { baseline, problems };
}