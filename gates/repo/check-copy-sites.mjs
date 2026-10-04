// 复制点白名单门禁(纯文本判定,零产物、幂等,exit 0/1)。
//
// ---- 它取代了什么、为什么换方向 ----
// 此前是「沙盒副本闭包」机制三层:shared/copy-closure.js 的词法层 + test/common/copy-closure-audit.js
// 的扫描审计层 + 守护段 test/gates/contract-single-source.test.js 的 (e) 节。
// 那套机制的判据方向是 fail-open 的,四种表现都被实测确认过:
//   ① 全局并集:auditCopySet 的副本集合是**所有复制点副本的并集**,任一 via 带了
//      shared/paths.js,其余沙盒全漏也判绿(ADR-040 背景一);
//   ② per-via 只查一个硬编码文件:auditViaCoverage 只认 ROOT_SOURCE_RELATIVE 一个,
//      除它之外的任何依赖漏带都看不见;
//   ③ 解析不出只登记不判红:resolveCopySource 对动态列表 / 多层别名 / 数组字面量 for-of
//      一律返回 null → 落进 unresolved 登记;而 gate-probes/gates/dist-manifest.mjs 那种
//      **数组字面量** for-of 连登记都没有(collectLoopEnv 只认标识符)⇒ 静默丢弃。
//      故「新增复制点会被自动纳入」这句话当时就不成立;
//   ④ 机制白名单只有三个原语,tree-mirror 永不判红,writeFileSync 造出来的副本完全不可见。
//
// 换方向的理由:落地后复制点只剩六处,清单就写在调用点旁几行内,漏带的表现是「脚本起不来」的
// 红、不是静默。唯一需要在门禁层面保留的语义是「复制点**无声增殖**」——
// 有人又加了一处把仓内文件复制进临时目录的沙盒,而清单靠自觉维护。
// ⇒ 按**文件**登记(不是按调用文本):后者会让 writeFileSync 与 tree-mirror 原地复现盲区 ④。
//
// ---- 三条断言,全部 fail-closed(缺一不可)----
//   A 反向等式(禁增殖):扫描面内出现复制原语的文件集合必须 ⊆ 白名单;多一个即判红并点名行号。
//   B 正向等式(禁空登记):白名单里每个 file 必须真的存在且真的含该原语。
//     只做 A 会退化成「文件在白名单里就行」——复制点删了登记留着,清单越养越宽。
//   C 清单一致性:每个登记项声明的 copies 与该文件里复制调用实参上出现的仓库相对路径字面量
//     **双向逐一相等**(取代 copy-closure 的死副本判定)。
//
// ---- 已知边界(明写,不隐藏)----
//   ① 允许人显式登记第 4 个复制点:治理的是无声增殖,不是复制本身。
//   ② 新复制机制不在下面的原语表内(见原语表处的说明)。
//   ③ **不替代闭包判定**:白名单里那两处沙盒若新增一条指向集合外的相对 import,本门禁不判红。
//      治法是在两处沙盒的构造处各有一条定向断言(副本 import 目标 ⊆ 该沙盒复制集),
//      约 6 行,比重建 auditCopySet 的数据模型便宜两个数量级。
//
// ---- 原语表:硬编码字面量,且门禁自检其内容不可派生 ----
// ⚠ 残留 fail-open(与已知边界 ② 同一条):新增复制机制必须改下面这两张表才看得见。绕开它们
// (手写 stream / 第三方复制库)本门禁一律看不见 —— 能做的只是让「漏改表」必须是一次显式的
// 代码改动(review 看得见),而不是靠扫描自动发现。这正是原语表不能被派生出来的原因。
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JS_SOURCE_RE, lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";

/** 直接复制类原语(逐文件 / 整树 / 目录联接) */
const COPY_CALL_NAMES = Object.freeze(["copyFileSync", "copyFile", "cpSync", "symlinkSync"]);
/**
 * 「写文件」类原语。
 *
 * `writeFileIn` 是本仓自建的写盘助手名(clean-artifacts-gate 段用它落沙盒副本),它必须与
 * `writeFileSync` 同表 —— 否则旧闭包门禁的头号盲区(用 write 造副本、扫描器看不见)会原样复现。
 */
const WRITE_CALL_NAMES = Object.freeze(["writeFileSync", "writeFile", "writeFileIn", "appendFileSync", "appendFile"]);
/**
 * 「这个路径是从仓库根派生的」的标记词。
 *
 * 它是**词法**判据而非求值:判据自己必须不需要求值器(旧机制那 200 余行表达式求值正是它
 * fail-open 的根源之一)。取不到标记词 ⇒ 该 read 不算「从仓库复制」⇒ 可能漏判。
 */
const ROOT_TOKENS = Object.freeze(["ROOT", "projectRoot", "repoRoot"]);
/** 参与扫描的顶层目录(白名单治理范围 = 这些树里的源文件) */
const SCAN_DIRS = Object.freeze(["gates", "shared", "test", "tools"]);
/** 扫描面文件数下限:walker 整体失效(零文件)时三条断言都会「全绿」,故兜一个下限 */
const MIN_SCAN_FILES = 150;
/** 可点名的仓库相对路径字面量的扩展名 */
const JS_EXT_RE = /\.(?:js|mjs|cjs)$/;

/**
 * @typedef {object} WhitelistEntry 白名单里的一行(按**文件**登记)
 * @property {string} file 仓库相对 POSIX 路径
 * @property {string[] | null} copies 该文件复制的仓库相对路径清单;
 *   `null` = 复制源是运行时算出来的列表(源码里没有可点名的路径字面量),此时 `why` 必须写明来源
 * @property {string} why 为什么这个复制点可以存在(人工复核的唯一依据,不得留空)
 */

/**
 * 复制点白名单:扫描面内**允许**含复制原语的文件全集。
 *
 * 新增条目是一次显式登记:必须同时写清 copies(能点名的)或 why(算出来的)——
 * A 断言挡住「没登记就加复制点」,B 断言挡住「复制点删了登记留着」,C 断言挡住「登记与实际清单脱节」。
 * @type {WhitelistEntry[]}
 */
export const COPY_SITE_WHITELIST = Object.freeze([
  {
    file: "gates/repo/check-temp-cleanup.selftest.mjs",
    copies: Object.freeze([
      "gates/repo/check-temp-cleanup.mjs",
      "shared/paths.js",
      "shared/copy-closure.js",
      "shared/test-common-surface.js",
    ]),
    why: "夹具要跑门禁本体,而其中一条负向用例必须改写门禁自己的源码(内建 SELF_PROBE 的 before/after 对调);"
      + "副本落在夹具的 gates/repo/ 下,故它的仓内 import 也必须逐字节带一份。",
  },
  {
    file: "test/core/clean-artifacts-gate.test.js",
    copies: Object.freeze([
      "gates/artifacts/clean-artifacts.mjs",
      "shared/paths.js",
      "gates/repo/repo-manifest.mjs",
    ]),
    why: "被测脚本要按 TARGET_DIRS 一行改写后再跑(删除守卫在 CLI 上不可触达),copyFileSync 做不到逐字节改行,"
      + "故用 writeFileSync 写副本。改造前本段对旧扫描器完全不可见 —— 那正是旧闭包门禁的头号盲区。",
  },
  {
    file: "gates/probe/gate-probes/gates/coverage.mjs",
    copies: null,
    why: "c8 配置清单由 package.json 的 test:coverage 参数向量解析而来(运行时列表,源码里没有路径字面量)。",
  },
  {
    file: "gates/probe/gate-probes/sandbox.mjs",
    copies: null,
    why: "createTreeSandbox:整树镜像 TREE_MIRROR_PATHS + node_modules 目录联接。"
      + "刻意**不给它判红** —— 它在沙盒里真跑门禁,缺文件当场就红,性质是「自带判据」而不是静默。",
  },
  {
    file: "tools/copy-renderer.mjs",
    copies: null,
    why: "构建产物复制(src 静态资源 → dist/renderer),不是沙盒副本;源是目录遍历结果,无路径字面量。",
  },
  {
    file: "gates/fixtures/gen-fixtures.mjs",
    copies: null,
    why: "验收样例的产物复制(段导出的图片 → samples/),源是运行期收集的清单,无路径字面量。",
  },
]);

// ---- 词法小工具(本门禁刻意零仓内依赖,故不复用 copy-closure 的内部函数)----

/**
 * 跳过一段引号字符串(处理转义;模板不递归扫 `${}`)。
 * @param {string} text 源文本
 * @param {number} start 引号所在下标
 * @returns {number} 结束引号之后的下标
 */
function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && ch === "\n") return i; // 未闭合的字符串:不吞掉换行
    i += 1;
  }
  return i;
}

/**
 * 从 `(` 处读出调用的**全部**实参文本(括号/引号配平)。
 * 首个实参不含外层左括号本身 —— 否则取到的表达式会「少一个右括号」,配平失败。
 * @param {string} text 源文本
 * @param {number} open 左括号下标
 * @returns {string[]} 各实参(已 trim)
 */
function readCallArgs(text, open) {
  /** @type {string[]} */
  const args = [];
  let depth = 1;
  let i = open + 1;
  let current = "";
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipQuoted(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
    }
    if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  return [...args, current.trim()];
}

/**
 * 从 `start` 起读出**一条声明的 initializer 文本**(到深度 0 的 `;` 或换行为止)。
 * 不能借用 readCallArgs:那要求 `open` 处是左括号,而 initializer 的起点是等号右边的空白。
 * @param {string} text 源文本
 * @param {number} start initializer 起点
 * @returns {string} initializer 文本(已 trim)
 */
function readInitializer(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return text.slice(start, i).trim();
      depth -= 1;
    } else if ((ch === ";" || ch === "\n") && depth === 0) {
      return text.slice(start, i).trim();
    }
    i += 1;
  }
  return text.slice(start).trim();
}

/**
 * 一个「从仓库根派生的 readFileSync」:它的第一个实参文本里出现 ROOT_TOKENS 之一。
 * @param {string} args 待查文本(调用的全部实参,或一条 initializer)
 * @returns {string | null} 命中时返回该 read 的实参文本,否则 null
 */
function findRootDerivedRead(args) {
  for (const m of args.matchAll(/\breadFileSync\s*\(/g)) {
    const first = readCallArgs(args, (m.index ?? 0) + m[0].length - 1)[0] ?? "";
    for (const token of ROOT_TOKENS) {
      if (new RegExp(`\\b${token}\\b`).test(first)) return first;
    }
  }
  return null;
}

/**
 * 顶层 `const NAME = <initializer>` 的映射(只认顶层 —— 函数内的局部绑定与「谁复制了谁」无关)。
 *
 * 两处消费,别把它们混成一张表:
 *   ① initializer 含「仓库根派生 read」的**子集** = write 类原语的命中判据;
 *   ② **全表** = 复制源实参里一跳别名的字面量展开来源 —— 别名本身未必含 read
 *      (例如 `const checkerPath = join(ROOT, 'gates', 'repo', 'x.mjs')`)。
 * @param {string} code 已抹注释的等长文本
 * @returns {Map<string, string>} 名字 → initializer 文本
 */
function collectConstInits(code) {
  /** @type {Map<string, string>} */
  const inits = new Map();
  const decl = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
  for (const m of code.matchAll(decl)) {
    const name = m[1];
    if (name === undefined) continue;
    inits.set(name, readInitializer(code, (m.index ?? 0) + m[0].length));
  }
  return inits;
}

// ---- 扫描 ----

/**
 * @typedef {object} CopySite 一处复制点
 * @property {string} file 所在文件(仓库相对 POSIX 路径)
 * @property {number} line 行号(基于原文本)
 * @property {string} primitive 命中的原语名
 * @property {string[]} literals 复制源实参(及其一跳 const 别名)里出现的字符串字面量
 * @property {boolean} nameable literals 里是否有 `.js` / `.mjs` / `.cjs` 结尾的可点名路径
 */

/**
 * @typedef {object} CopyScan 扫描结果
 * @property {string[]} files 扫描到的全部源文件(仓库相对 POSIX 路径,已排序)
 * @property {CopySite[]} sites 全部复制点
 */

/**
 * 扫出「把仓内文件复制 / 写出到别处」的调用点。
 *
 * 抹掉注释再匹配(复用 shared/copy-closure.js 的 lexSource,等长故行号不变):文档串里为了说明
 * 历史写法而写的 `copyFileSync(...)` 不该被判成复制点。字符串**不**抹(那需要 inString 掩码,
 * 而本门禁只取 code)—— 故字符串字面量里写的复制调用会被算进来,属保守方向(多报不漏报)。
 *
 * @param {string} root 仓库根绝对路径
 * @returns {CopyScan}
 */
export function collectCopySites(root) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} absDir 绝对目录
   * @param {string} relDir 相对目录(POSIX)
   * @returns {void}
   */
  const walk = (absDir, relDir) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(join(absDir, entry.name), rel);
      else if (JS_SOURCE_RE.test(entry.name)) files.push(rel);
    }
  };
  for (const dir of SCAN_DIRS) walk(join(root, ...dir.split("/")), dir);

  /** @type {CopySite[]} */
  const sites = [];
  for (const rel of files) {
    const code = lexSource(readFileSync(join(root, ...rel.split("/")), "utf8")).code;
    const constInits = collectConstInits(code);
    const repoReadNames = new Set(
      [...constInits].filter(([, init]) => findRootDerivedRead(init) !== null).map(([name]) => name),
    );
    /**
     * 抽一段文本里的字符串字面量,并把其中的**一跳 const 别名**就地展开。
     *
     * `seen` 是必需的:别名的 initializer 里可能再次出现同一个名字(自引用/互引),
     * 不设 visited 就无限递归 —— 实测踩过一次(栈溢出)。
     * @param {string} text 待抽文本
     * @param {Set<string>} [seen] 本轮已展开过的名字
     * @returns {string[]} 字面量(已去引号)
     */
    const literalsOf = (text, seen = new Set()) => {
      /** @type {string[]} */
      const out = [];
      for (const m of text.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
        if (m[2] !== undefined) out.push(m[2]);
      }
      for (const id of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const name = id[0];
        if (name === undefined || seen.has(name)) continue;
        const init = constInits.get(name);
        if (init === undefined) continue;
        seen.add(name);
        for (const lit of literalsOf(init, seen)) out.push(lit);
      }
      return out;
    };
    /**
     * @param {number} index 命中位置
     * @param {string} primitive 记进判红的原语名
     * @param {string} source 复制源实参文本(write 类传命中的 read 或全部实参)
     * @returns {void}
     */
    const push = (index, primitive, source) => {
      const literals = literalsOf(source);
      sites.push({
        file: rel,
        line: code.slice(0, index).split("\n").length,
        primitive,
        literals,
        nameable: literals.some((lit) => JS_EXT_RE.test(lit)),
      });
    };
    // 只挡「更长标识符」(. 前缀要放行:fs.copyFileSync 才是本仓的常态写法)
    for (const name of [...COPY_CALL_NAMES, ...WRITE_CALL_NAMES]) {
      const re = new RegExp(`(?<![\\w$])${name}\\s*\\(`, "g");
      for (const m of code.matchAll(re)) {
        const index = m.index ?? 0;
        const argsText = readCallArgs(code, index + m[0].length - 1).join(", ");
        if (COPY_CALL_NAMES.includes(name)) {
          push(index, name, readCallArgs(code, index + m[0].length - 1)[0] ?? "");
          continue;
        }
        // write 类:内容来源二选一 —— 实参里内联着仓库派生的 read,或实参引用了这样一个 const
        const inline = findRootDerivedRead(argsText);
        if (inline === null && ![...repoReadNames].some((b) => new RegExp(`\\b${b}\\b`).test(argsText))) continue;
        push(index, `${name}<仓库派生 read>`, inline ?? argsText);
      }
    }
  }
  return { files, sites };
}

// ---- 判定 ----

/**
 * @typedef {object} CopyProblem 一条判红项
 * @property {"unregistered" | "entry-missing-file" | "entry-has-no-site" | "entry-missing-why"
 *   | "copy-not-declared" | "declared-not-copied" | "unnamed-copy-declared-null"} kind 判红种类
 * @property {string} file 涉及文件
 * @property {number} [line] 行号(有则给)
 * @property {string} detail 人可读说明(必须含文件与行号/路径,否则等于「只知道有问题」)
 */

/**
 * 汇总诊断。
 * @param {CopyProblem[]} problems 判红项
 * @returns {string}
 */
export function formatCopyProblems(problems) {
  return problems
    .map((p) => `${p.file}${p.line === undefined ? "" : `:${p.line}`} → ${p.kind}:${p.detail}`)
    .join("; ");
}

/**
 * 判定:三条断言(反向等式 / 正向等式 / 清单一致性)。
 *
 * 纯函数 —— 判据必须能在合成树上先红后绿,所以白名单是**形参**而不是模块常量;
 * CLI 那一路传的就是本文件的常量。这样自测不需要「从命令行换一份白名单」的口子
 * (那本身就是一个 fail-open:能传白名单就能把自己摘出去)。
 * @param {WhitelistEntry[]} whitelist 白名单
 * @param {CopyScan} scan 扫描结果
 * @returns {CopyProblem[]} 判红项(空数组 = 三条断言全过)
 */
export function judgeCopySites(whitelist, scan) {
  /** @type {CopyProblem[]} */
  const problems = [];
  const fileSet = new Set(scan.files);
  /** @type {Map<string, CopySite[]>} */
  const byFile = new Map();
  for (const site of scan.sites) {
    const group = byFile.get(site.file);
    if (group === undefined) byFile.set(site.file, [site]);
    else group.push(site);
  }
  const allowed = new Set(whitelist.map((entry) => entry.file));

  // A 反向等式:有复制原语却不在白名单 ⇒ 判红(点名文件与行号)
  for (const site of scan.sites) {
    if (allowed.has(site.file)) continue;
    problems.push({
      kind: "unregistered",
      file: site.file,
      line: site.line,
      detail: `${site.primitive} 是复制点但 ${site.file} 未登记进 COPY_SITE_WHITELIST`
        + "(无声增殖正是本门禁要拦的:要么删掉该复制点,要么显式登记一行并写清 copies 与 why)",
    });
  }

  // B 正向等式 + C 清单一致性
  for (const entry of whitelist) {
    const sites = byFile.get(entry.file) ?? [];
    if (!fileSet.has(entry.file)) {
      problems.push({
        kind: "entry-missing-file",
        file: entry.file,
        detail: `白名单登记的文件在扫描面里不存在(${entry.file}):请删掉这行登记`,
      });
      continue;
    }
    if (sites.length === 0) {
      problems.push({
        kind: "entry-has-no-site",
        file: entry.file,
        detail: `白名单登记了 ${entry.file},但它已不含任何复制原语(复制点被删而登记没删):请删掉这行登记`,
      });
      continue;
    }
    if (entry.why.trim() === "") {
      problems.push({
        kind: "entry-missing-why",
        file: entry.file,
        detail: `白名单项 ${entry.file} 缺 why(人工复核的唯一依据,不得留空)`,
      });
    }
    const named = sites.filter((site) => site.nameable);
    if (entry.copies === null) {
      if (named.length > 0) {
        problems.push({
          kind: "unnamed-copy-declared-null",
          file: entry.file,
          line: named[0]?.line,
          detail: `${entry.file} 声明 copies: null(复制源算不出来),但它的复制点里出现了可点名的路径字面量:`
            + named.map((s) => s.literals.filter((l) => JS_EXT_RE.test(l)).join("/")).join(" | "),
        });
      }
      continue;
    }
    const declared = [...entry.copies];
    const basenames = new Set(declared.map((rel) => rel.slice(rel.lastIndexOf("/") + 1)));
    // C 正向:声明的每个副本都必须真的出现在某个复制调用的源实参里(否则是死登记)
    const seen = new Set();
    for (const site of sites) {
      for (const lit of site.literals) if (JS_EXT_RE.test(lit)) seen.add(lit);
    }
    for (const rel of declared) {
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      if (seen.has(base)) continue;
      problems.push({
        kind: "declared-not-copied",
        file: entry.file,
        detail: `登记的副本 ${rel} 在 ${entry.file} 的任何复制调用里都找不到对应字面量(死登记):请删掉它`,
      });
    }
    // C 反向:每个可点名的复制点都必须被声明覆盖
    for (const site of named) {
      const base = site.literals.filter((lit) => JS_EXT_RE.test(lit)).at(-1) ?? "";
      if (basenames.has(base)) continue;
      problems.push({
        kind: "copy-not-declared",
        file: entry.file,
        line: site.line,
        detail: `${site.primitive} 的复制源 ${base || "(无可点名字面量)"} 未登记进该文件的 copies`
          + `(登记: ${declared.join(", ") || "(空)"};可点名的复制源必须逐个登记)`,
      });
    }
  }
  return problems;
}

/**
 * 原语表自检:两张表必须是**冻结的标识符字面量数组**。
 *
 * 为何不把它们「派生」出来(例如从文件里 grep 出所有 fs.* 调用):派生会让表随代码走,
 * 新复制机制一出现就自动进表 ⇒ 门禁对它恒绿,而「新增复制机制必须被 review 看见」正是
 * 本门禁唯一承认自己做不到的那条边界的前提。这条断言能守的只有「不许把表改成运行时计算」,
 * 守不住「不许把某个原语名删掉」—— 后者靠表与白名单两处都会留下 diff。
 * @returns {string[]} 判红项(空数组 = 原语表形态合法)
 */
export function checkPrimitiveTables() {
  /** @type {string[]} */
  const problems = [];
  for (const [label, table] of [["COPY_CALL_NAMES", COPY_CALL_NAMES], ["WRITE_CALL_NAMES", WRITE_CALL_NAMES]]) {
    if (!Object.isFrozen(table)) problems.push(`${label} 未冻结`);
    for (const name of table) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) problems.push(`${label} 的表项 ${JSON.stringify(name)} 不是标识符字面量`);
    }
  }
  if (!Object.isFrozen(ROOT_TOKENS) || !Object.isFrozen(SCAN_DIRS) || !Object.isFrozen(COPY_SITE_WHITELIST)) {
    problems.push("ROOT_TOKENS / SCAN_DIRS / COPY_SITE_WHITELIST 必须冻结");
  }
  if (COPY_SITE_WHITELIST.some((entry) => entry.file === "" || entry.why.trim() === "")) {
    problems.push("白名单存在缺 file 或缺 why 的行");
  }
  const seen = new Set();
  for (const entry of COPY_SITE_WHITELIST) {
    if (seen.has(entry.file)) problems.push(`白名单里 ${entry.file} 登记了两次`);
    seen.add(entry.file);
  }
  return problems;
}

/**
 * @returns {void}
 */
function main() {
  /** @type {string[]} */
  const failures = [];
  for (const problem of checkPrimitiveTables()) failures.push(`原语表:${problem}`);
  const scan = collectCopySites(ROOT);
  // 下限:walker 整体失效(零文件)时三条断言都会「全绿」——那是最坏的假通过形态
  if (scan.files.length < MIN_SCAN_FILES) {
    failures.push(`扫描面塌缩:只扫到 ${scan.files.length} 个文件(下限 ${MIN_SCAN_FILES}),walker 可能已失效`);
  }
  if (scan.sites.length === 0) {
    failures.push(`未扫出任何复制点(原语表可能已失效):扫描面 ${scan.files.length} 个文件里一个都没有`);
  }
  for (const problem of judgeCopySites(COPY_SITE_WHITELIST, scan)) failures.push(formatCopyProblems([problem]));
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[copy-sites:fail] ${failure}`);
    console.error(
      `[copy-sites:fail] 复制点白名单门禁不成立,共 ${failures.length} 项`
      + `(白名单 ${COPY_SITE_WHITELIST.length} 项 / 扫描 ${scan.files.length} 文件 / 复制点 ${scan.sites.length} 处)`,
    );
    process.exit(1);
  }
  console.log(
    `[ok] 复制点白名单成立:扫描 ${scan.files.length} 个源文件 / ${scan.sites.length} 处复制原语命中`
    + ` / 白名单 ${COPY_SITE_WHITELIST.length} 项(${COPY_SITE_WHITELIST.map((e) => e.file).join(", ")})`
    + ";三条断言:反向等式(禁增殖)· 正向等式(禁空登记)· 清单一致性(禁死登记)",
  );
}

// 入口守卫:用代码位置自比(不用根反推自身路径),故 cwd 指向合成仓时守卫恒成立
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();