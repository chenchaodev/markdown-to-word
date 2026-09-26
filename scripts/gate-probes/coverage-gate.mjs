// coverage 门禁的基线守护(收紧面 + 可见面):
//
// 为什么要有这一层:`--all` 打开后,「不可达文件」与「结构性不可测文件」混进同一个
// 百分比 —— 前者(新增且从未被 import 的死代码)应当被抓,后者(Electron 入口、纯类型
// 模块)不该让所有代码一起降分。平均值同时掩盖两者,是本门禁最大的盲区。
//
// 本文件把「后者」变成**显式、带理由、可审计**的清单(基线文件),并对清单本身设防:
// 条目字段缺失/理由为空/文件已不存在/分类与实际产物形态不符/豁免已失效(文件其实被
// 覆盖了)/新增空模块未登记 —— 任一情况都判红。清单是收紧手段(让豁免可见),不是放宽
// 口子:清单之外的新 0% 文件由 auditZeroFiles 显式判红,而不是被平均值稀释。
//
// 两个审计面:
// - 静态面(auditStatic):不需要覆盖率数据,可在验收段里跑 —— 核对 package.json 的
//   test:coverage 参数向量(必须含 --all / --check-coverage / 四个阈值 / 豁免对应的
//   --exclude)、阈值与基线逐项一致、阈值落在 [floor, measured] 锚定区间、豁免条目
//   与真实编译产物/测试引用面一致;
// - 动态面(auditZeroFiles):读本次覆盖率运行的 coverage/coverage-summary.json
//   (reporter 先于阈值判定执行,即使门禁红也会落盘),逐文件核对 0% 集合 ⊆ 豁免清单。
//   必须紧跟 test:coverage 执行(见 --zero 用法),故不放在验收段里。

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./contract.mjs";
import { parseCoverageScript } from "./gates/coverage.mjs";

/** 覆盖率基线文件(仓库相对;阈值与豁免的唯一登记处) */
export const BASELINE_RELATIVE = "scripts/gate-probes/coverage-baseline.json";

/** c8 json-summary 产物(动态面唯一数据源) */
export const SUMMARY_RELATIVE = "coverage/coverage-summary.json";

/** 四个覆盖率指标(与 c8 的 --statements/--branches/--functions/--lines 一一对应) */
export const METRICS = Object.freeze(["statements", "branches", "functions", "lines"]);

/** 合法豁免分类:空模块(无可执行语句)/ 运行时入口(结构上不可单测) */
export const EXEMPTION_CATEGORIES = Object.freeze(["empty-module", "runtime-entry"]);

/** 理由最短字数:低于此值视为「没写理由」,判红(同 SEGMENT_EXEMPTIONS 的自检取向) */
const MIN_REASON_LENGTH = 20;

/**
 * 源码文件 → 编译产物相对路径(src/ 前缀换成 dist/,扩展名 .ts→.js / .cts→.cjs / .mts→.mjs)。
 * 纯函数:路径推导规则单源,豁免核对、空模块扫描、动态面核对共用。
 * @param {string} srcRelative 仓库相对的源码路径
 * @returns {string} 仓库相对的产物路径
 */
export function distArtifactOf(srcRelative) {
  const normalized = srcRelative.split(path.sep).join("/");
  const withDist = normalized.startsWith("src/") ? `dist/${normalized.slice("src/".length)}` : normalized;
  return withDist.replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.tsx?$/, ".js");
}

/**
 * 产物路径 → 源码相对路径(c8 的 json-summary 键是绝对路径;未开 source map 时是 dist 路径)。
 * @param {string} absoluteOrRelative 绝对或相对路径
 * @param {string} root 仓库根
 * @returns {string} 仓库相对 POSIX 路径
 */
export function toRepoRelative(absoluteOrRelative, root) {
  const normalized = absoluteOrRelative.split(path.sep).join("/");
  if (!path.isAbsolute(absoluteOrRelative)) return normalized.replace(/^\.\//, "");
  // ROOT 带尾部分隔符(URL 目录解析的结果),比较前先归一,否则前缀剥离会失配
  const posixRoot = root.split(path.sep).join("/").replace(/\/+$/, "");
  return normalized.startsWith(`${posixRoot}/`) ? normalized.slice(posixRoot.length + 1) : normalized;
}

/**
 * 判断编译产物是否为「空模块」(只有 `export {};`,没有任何可执行语句)。
 *
 * 为什么需要它:纯类型模块对 istanbul 是 0/0 文件,c8 会给它合成 1 条未覆盖节点并记 0%
 * (实测 dist/core/ipc-contract.js 的 statements/functions/branches 各 1 条且全未覆盖),
 * 于是「无可执行语句」被记成「零覆盖」。这类文件不该进覆盖率分母,但也不能靠人记 —
 * 由本函数从产物形态判定,清单与实际形态不符即判红。
 * @param {string} artifactPath 产物绝对路径
 * @returns {boolean} true = 空模块
 */
export function isEmptyModuleArtifact(artifactPath) {
  if (!fs.existsSync(artifactPath)) return false;
  const code = fs
    .readFileSync(artifactPath, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[\s;]*$/, "")
    .trim();
  if (code === "") return true;
  // tsc 对「只有类型导出」的模块输出 `export {};`(可能带分号/空白差异)
  return /^export\s*\{\s*\}\s*;?$/.test(code);
}

/**
 * 读基线文件并做结构校验。
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

/**
 * 从 test:coverage 的参数向量里取某选项的值(`--statements=90` → 90;`--all` → true)。
 * @param {string[]} flags 参数向量
 * @param {string} name 选项名(不含 --)
 * @returns {string | true | null} 命中值;未命中返回 null
 */
export function flagValue(flags, name) {
  for (const flag of flags) {
    if (flag === `--${name}`) return true;
    if (flag.startsWith(`--${name}=`)) return flag.slice(name.length + 3);
  }
  return null;
}

/**
 * 收集 test/** 里对某产物的**真实 import**(用于核对 runtime-entry 豁免是否还成立)。
 *
 * 只认模块说明符位置(from "…" / import("…") / require("…")):测试里把产物路径当夹具
 * 字符串写出来(clean-artifacts-gate 的假 dist、release-artifact-gate 的 asar 期望条目
 * 清单)是常事,按子串找会把这些误判成「可被单测」,豁免就被错误地判失效了。
 * @param {string} root 仓库根
 * @param {string} artifactRelative 产物仓库相对路径
 * @returns {string[]} 命中的测试文件(仓库相对)
 */
function findTestImportsOf(root, artifactRelative) {
  /** @type {string[]} */
  const hits = [];
  const testDir = path.join(root, "test");
  const escaped = artifactRelative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = new RegExp(`(?:from|import\\s*\\(|require\\s*\\()\\s*["'][^"']*${escaped}["']`);
  /**
   * @param {string} dir 当前目录
   * @returns {void}
   */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !/\.(test\.js|mjs|cjs|js)$/.test(entry.name)) continue;
      if (specifier.test(fs.readFileSync(abs, "utf8"))) hits.push(toRepoRelative(abs, root));
    }
  };
  if (fs.existsSync(testDir)) walk(testDir);
  return hits;
}

/**
 * 静态审计:参数向量 / 阈值锚定 / 豁免条目与真实产物的自洽。不需要覆盖率数据。
 * @param {string} [root] 仓库根
 * @returns {{ problems: string[], detail: Record<string, unknown> }} 问题清单与诊断信息
 */
export function auditStatic(root = ROOT) {
  const { baseline, problems } = loadBaseline(root);
  if (baseline === null) return { problems, detail: {} };
  const parsed = parseCoverageScript();
  if (!parsed.ok) {
    problems.push(`无法从 package.json 解析 test:coverage 的 c8 参数向量:${parsed.reason ?? "解析失败"}`);
    return { problems, detail: { flags: parsed.flags } };
  }
  const flags = parsed.flags;

  // ① 必需 flag:缺任何一个都判红(--all 缺失 = 盲区回归;--check-coverage 缺失 = 门禁空过)
  for (const required of baseline.requireFlags ?? []) {
    const name = required.replace(/^--/, "").split("=")[0] ?? "";
    if (flagValue(flags, name) === null) {
      problems.push(`test:coverage 参数向量缺必需项 ${required}(基线 requireFlags 登记的收紧面;缺它等于门禁空过)`);
    }
  }
  // ② 四个阈值必须与基线逐项相同(单一来源,不许两处漂移)
  for (const metric of METRICS) {
    const expected = baseline.thresholds?.[metric];
    const actual = flagValue(flags, metric);
    if (typeof expected !== "number") {
      problems.push(`基线 thresholds.${metric} 未登记(阈值没有锚点 = 没人看守;请在干净树重测后填入)`);
      continue;
    }
    if (actual === null) {
      problems.push(`test:coverage 参数向量缺 --${metric}(基线登记阈值 ${expected})`);
      continue;
    }
    if (Number(actual) !== expected) {
      problems.push(`--${metric} 实为 ${actual},与基线 thresholds.${metric} = ${expected} 不一致(阈值只能改基线,不能只改一处)`);
    }
  }
  // ③ 阈值锚定:floor ≤ thresholds ≤ measured,且 thresholds ≥ measured − headroomPp
  //
  // 为什么是「不得低于 measured − headroomPp」而不是「不得低于 measured」:阈值本来
  // 就该低于实测值(否则门禁在干净树上也会红),两者之间允许一段显式登记的余量
  // (headroomPp)。这条规则拦的是「为了让它变绿而下调阈值」:实测值是上一次干净树
  // 独立测出来的,不会跟着阈值走,阈值一降,两者的差就超过登记的余量 → 判红。要合法
  // 下调,必须先重测并把 measured 一起改(于是「实测值掉了 5pp」本身变成 diff 里
  // 可见的回归),或者去改 floor(那更显眼)。
  const measured = baseline.measured ?? {};
  const floor = baseline.floor ?? {};
  const headroom = typeof baseline.headroomPp === "number" ? baseline.headroomPp : 0;
  for (const metric of METRICS) {
    const t = baseline.thresholds?.[metric];
    const m = measured[metric];
    const f = floor[metric];
    if (typeof t !== "number") continue;
    if (typeof m !== "number") {
      problems.push(`基线 measured.${metric} 未登记(需在**干净树**上跑重测命令拿到实测值;当前工作树有并行改动时测的值不可信)`);
      continue;
    }
    if (typeof f === "number" && t < f) {
      problems.push(`thresholds.${metric} = ${t} 低于基线 floor ${f}(阈值下调到失去意义,门禁靠 floor 兜底)`);
    }
    if (t > m) {
      problems.push(`thresholds.${metric} = ${t} 高于干净树实测 ${m}(门禁在干净树上也会红,阈值不可达)`);
    }
    if (m - t > headroom) {
      problems.push(
        `thresholds.${metric} = ${t} 比干净树实测 ${m} 低 ${(m - t).toFixed(2)}pp,超过基线 headroomPp = ${headroom}` +
          "(这是「为变绿而下调阈值」的特征;确需下调必须先在干净树重测并同步更新 measured," +
          "否则实测值与阈值一起下滑就成了一次无人看守的静默降级)",
      );
    }
  }
  // ④ 豁免条目:字段完整 + 分类与真实产物形态自洽 + 真的还没被测
  const exemptions = Array.isArray(baseline.exemptions) ? baseline.exemptions : [];
  const distDir = path.join(root, "dist");
  if (!fs.existsSync(distDir)) {
    problems.push("dist 不存在:无法核对豁免条目对应的编译产物形态(验收链应先执行 build)");
  }
  /** @type {Record<string, string>} */
  const artifactToSrc = {};
  for (const exemption of exemptions) {
    const file = exemption?.file;
    if (typeof file !== "string" || file === "") {
      problems.push("豁免条目缺 file 字段");
      continue;
    }
    if (typeof exemption.reason !== "string" || exemption.reason.trim().length < MIN_REASON_LENGTH) {
      problems.push(`豁免条目 ${file} 的理由缺失或过短(须写明为何无法单测,≥${MIN_REASON_LENGTH} 字)`);
    }
    const category = exemption.category;
    if (!EXEMPTION_CATEGORIES.includes(category)) {
      problems.push(
        `豁免条目 ${file} 的 category = ${JSON.stringify(category)} 非法(合法值:${EXEMPTION_CATEGORIES.join("/")};` +
          '用 "none" 表示「待核实」,待核实的条目不得留在清单里)',
      );
      continue;
    }
    const srcPath = path.join(root, file);
    if (!fs.existsSync(srcPath)) {
      problems.push(`豁免条目 ${file} 已不是现存源文件(改名/删除后残留,请删除该条目)`);
      continue;
    }
    const artifact = distArtifactOf(file);
    artifactToSrc[artifact] = file;
    if (!fs.existsSync(path.join(root, artifact))) {
      problems.push(`豁免条目 ${file} 的编译产物 ${artifact} 不存在(无法核对分类是否仍成立)`);
      continue;
    }
    if (category === "empty-module" && !isEmptyModuleArtifact(path.join(root, artifact))) {
      problems.push(
        `豁免条目 ${file} 登记为 empty-module,但 ${artifact} 现在有可执行语句` +
          "(空模块口径已不成立:要么补测试,要么把分类改成 runtime-entry 并写明理由)",
      );
    }
    if (category === "runtime-entry") {
      const importers = findTestImportsOf(root, artifact);
      if (importers.length > 0) {
        problems.push(
          `豁免条目 ${file} 登记为 runtime-entry,但测试已 import 它的产物 ${artifact}:${importers.join(",")}` +
            "(该文件现在可被单测覆盖,豁免已失效,应移出清单)",
        );
      }
    }
  }
  // ⑤ 清单外的新空模块:不登记就会以「0/0 记 0%」的形式悄悄进报告拉低分母
  // (listArtifacts 返回的是**仓库相对**路径,故拼 root 而不是 distDir)
  for (const artifact of listArtifacts(distDir)) {
    if (artifactToSrc[artifact] !== undefined) continue;
    if (!isEmptyModuleArtifact(path.join(root, artifact))) continue;
    problems.push(
      `新增空模块 ${artifact} 未登记进豁免清单(编译产物无可执行语句,c8 口径会记它 0% 拉低分母);` +
        "要么登记 category=empty-module 并写明理由,要么确认它确实有可执行语句",
    );
  }
  // ⑥ 豁免必须真的在 --exclude 里(否则它们会进报告,结构性不可测文件照样拖低全仓)
  if (baseline.requireExcludesInFlag === true) {
    const excludeValues = flags
      .filter((flag) => flag.startsWith("--exclude="))
      .map((flag) => flag.slice("--exclude=".length));
    for (const artifact of Object.keys(artifactToSrc)) {
      if (!excludeValues.includes(artifact)) {
        problems.push(`豁免条目 ${artifactToSrc[artifact]} 未出现在 test:coverage 的 --exclude 参数里(它会进报告并拖低全仓覆盖率)`);
      }
    }
  }
  return {
    problems,
    detail: { flags, exemptions: exemptions.map((e) => e?.file) },
  };
}

/**
 * 列出 dist 下全部产物文件(**仓库相对** POSIX 路径,带 dist/ 前缀)。
 * 路径形态与 distArtifactOf 的输出对齐,豁免集合可直接比对。
 * @param {string} distDir dist 绝对路径
 * @returns {string[]} 产物相对路径(字典序)
 */
function listArtifacts(distDir) {
  /** @type {string[]} */
  const found = [];
  /**
   * @param {string} dir 当前目录
   * @param {string} prefix 当前目录的仓库相对前缀
   * @returns {void}
   */
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
        continue;
      }
      if (entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name)) found.push(relative);
    }
  };
  if (fs.existsSync(distDir)) walk(distDir, "dist");
  return found.sort();
}

/**
 * 动态审计:读本次覆盖率运行的 json-summary,逐文件核对 0% 集合 ⊆ 豁免清单。
 *
 * 为什么必须有这一面:全局百分比会把「清单外的新 0% 文件」按体量摊薄(一个 20 行的
 * 新死代码在 ~7000 条语句里只值 0.3pp),正是主会话要求堵掉的稀释。c8 的 --per-file
 * 不可用(实测 19%~28% 的文件低于当前阈值,逐文件判定会要求先补齐几十个文件),故用
 * 显式的 0% 集合核对来替代。
 *
 * 必须在 test:coverage 之后立即执行:c8 的 reporter 先于阈值判定执行,即使门禁红,
 * coverage/coverage-summary.json 也会落盘。
 * @param {string} [root] 仓库根
 * @returns {{ problems: string[], zeroFiles: string[], total: Record<string, number> }} 审计结果
 */
export function auditZeroFiles(root = ROOT) {
  /** @type {string[]} */
  const problems = [];
  const { baseline, problems: baselineProblems } = loadBaseline(root);
  if (baseline === null) return { problems: baselineProblems, zeroFiles: [], total: {} };
  const summaryPath = path.join(root, SUMMARY_RELATIVE);
  if (!fs.existsSync(summaryPath)) {
    return {
      problems: [`未找到 ${SUMMARY_RELATIVE}(本检查必须紧跟 test:coverage 执行:c8 的 reporter 先于阈值判定落盘,门禁红时也会有)`],
      zeroFiles: [],
      total: {},
    };
  }
  /** @type {any} */
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch (error) {
    return { problems: [`${SUMMARY_RELATIVE} 不是合法 JSON:${error instanceof Error ? error.message : String(error)}`], zeroFiles: [], total: {} };
  }
  const exemptions = new Set((Array.isArray(baseline.exemptions) ? baseline.exemptions : []).map((e) => e?.file));
  /** @type {string[]} */
  const zeroFiles = [];
  /** @type {Record<string, number>} */
  const total = {};
  for (const [key, metrics] of Object.entries(summary)) {
    if (key === "total") {
      for (const metric of METRICS) total[metric] = metrics[metric]?.pct ?? 0;
      continue;
    }
    // 0% 判定只看「有可执行节点却全未命中」:0/0 的空模块由静态面的清单管
    const hasStatements = (metrics.statements?.total ?? 0) > 0;
    const hasFunctions = (metrics.functions?.total ?? 0) > 0;
    const zeroStatements = hasStatements && metrics.statements?.covered === 0;
    const zeroFunctions = hasFunctions && metrics.functions?.covered === 0;
    if (!zeroStatements && !zeroFunctions) continue;
    const relative = toRepoRelative(key, root);
    zeroFiles.push(relative);
    if (!exemptions.has(relative)) {
      problems.push(
        `0% 覆盖文件未登记豁免:${relative}(statements ${metrics.statements?.covered}/${metrics.statements?.total},` +
          ` functions ${metrics.functions?.covered}/${metrics.functions?.total})——` +
          "要么它是新增死代码(必须补测试或删掉),要么把理由写进基线豁免清单",
      );
    }
  }
  // 豁免失效方向也要判红:文件其实已被覆盖却仍留在清单里 = 永久盲区(同 SEGMENT_EXEMPTIONS 自检)
  const reported = new Set(zeroFiles);
  for (const file of exemptions) {
    if (typeof file !== "string") continue;
    const artifact = distArtifactOf(file);
    const inReport = Object.keys(summary).some((key) => toRepoRelative(key, root) === file || toRepoRelative(key, root) === artifact);
    if (inReport && !reported.has(file) && !reported.has(artifact)) {
      problems.push(`豁免条目 ${file} 本次已被覆盖却仍留在清单里(豁免已失效,请移出清单,免得变成永久盲区)`);
    }
  }
  return { problems, zeroFiles: zeroFiles.sort(), total };
}

/* ---------- CLI(动态面给「紧跟 test:coverage」的那一步用) ---------- */

/**
 * CLI 主体。
 * @param {string[]} [argv] 参数数组(--static 只跑静态面 / --zero 只跑动态面 / --all 都跑)
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = []) {
  const runStatic = argv.includes("--all") || !argv.includes("--zero");
  const runZero = argv.includes("--all") || argv.includes("--zero");
  /** @type {string[]} */
  const problems = [];
  if (runStatic) {
    const staticAudit = auditStatic(ROOT);
    problems.push(...staticAudit.problems);
    console.log(`[coverage-gate] 静态面:${staticAudit.problems.length === 0 ? "通过" : `${staticAudit.problems.length} 项问题`}`);
  }
  if (runZero) {
    const zeroAudit = auditZeroFiles(ROOT);
    problems.push(...zeroAudit.problems);
    console.log(
      `[coverage-gate] 动态面:0% 文件 ${zeroAudit.zeroFiles.length} 个${zeroAudit.zeroFiles.length > 0 ? `(${zeroAudit.zeroFiles.join(", ")})` : ""}` +
        `${Object.keys(zeroAudit.total).length > 0 ? `;实测 ${METRICS.map((m) => `${m} ${zeroAudit.total[m]}%`).join(" ")}` : ""}`,
    );
  }
  for (const problem of problems) console.error(`[coverage-gate:fail] ${problem}`);
  if (problems.length > 0) {
    console.error(`[coverage-gate:fail] 共 ${problems.length} 项(基线:${BASELINE_RELATIVE})`);
    return 1;
  }
  console.log("[coverage-gate] 覆盖率门禁基线自检通过");
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(ROOT, "scripts", "gate-probes", "coverage-gate.mjs")) {
  process.exitCode = await main(process.argv.slice(2));
}
