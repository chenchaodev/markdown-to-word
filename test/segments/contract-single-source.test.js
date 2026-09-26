// @ts-check
/**
 * 契约单源恒等性断言:
 * - CROSS_REF_KINDS:docx/pdf 两侧渲染模块 re-export 的常量与 core/cross-ref.ts
 *   单源为同一对象引用(ESM live binding,两侧 import 同源即恒等);
 * - 章节 label 正则族(SEC_LABEL_RE / kindLabelRegex / stripSecLabelSuffix):
 *   行为断言(label 提取、剥离、fig/tab/sec 构造);
 * - 白名单标签集恒等:INLINE_TAG_STYLES + br ↔ ALLOWED_INLINE_TAGS
 *   键集一致,防两处平行表漂移;
 * - 跨进程类型单源(源码文本判定:类型编译期擦除、产物无痕迹):
 *   ConvertResult 只在 core/ipc-contract.ts 声明,preload / ipc logic / renderer /
 *   converter 侧均不重复声明;preload 的类型依赖只来自 core 契约。
 * - 沙盒副本闭包(源码文本判定,见文件末 (e) 节与其上的纯函数):
 *   被**逐字节复制**进沙箱并在沙盒内解析的模块,其 import 必须闭合 —— 只允许 `node:`
 *   内建,相对 specifier 的目标必须同在副本集合内。原因:复制点只复制被点名的那几个文件,
 *   不会连带复制它的同目录依赖;一旦给 test/common/userdata.js 加一句
 *   `import … from "./temp-resource.js"`,install-smoke 段的沙盒里那份副本就解析不到该模块,
 *   且报错发生在沙盒子进程内,极难定位。
 *   另一面同样要守:不得出现「复制了却没人用」的死副本 —— 复制点与引用一旦脱节
 *   (典型:使用方的相对 import 被删或改成绝对路径),该副本承载的清理/校验语义会静默消失。
 *   沙盒入口(复制进来就是为了被执行、没有上游 import 的脚本)凭 SANDBOX_ENTRY_EVIDENCE 登记,
 *   登记项受机械抽查(必须在复制行之外被真实提及),不能靠登记把死副本洗白。
 * 纯断言段,无产物输出。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROSS_REF_KINDS,
  SEC_LABEL_RE,
  kindLabelRegex,
  stripSecLabelSuffix,
} from "../../dist/core/markdown/cross-ref.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");
/** @param {string} rel 相对 src 的 POSIX 路径 */
const readSrc = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");

/**
 * 断言辅助(本段 (e) 节用;前缀与本段既有内联 throw 保持一致)。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`contract 断言失败:${msg}`);
}

/**
 * 相等断言(附实际/期望,避免「不等」三个字无处可查)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} what 断言项名
 * @returns {void}
 */
function assertEq(actual, expected, what) {
  assert(actual === expected, `${what}:实际 ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
}

/**
 * 违规清单的可读渲染(行号必须出现在里面,否则等于「只知道有问题」)。
 * @param {{ rel: string; line: number; spec: string; detail: string }[]} violations 违规清单
 * @returns {string}
 */
const renderViolations = (violations) =>
  violations.map((v) => `${v.rel}:${v.line} 「${v.spec}」→ ${v.detail}`).join("; ");


// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

/* ---------- (e) 沙箱副本闭包:判定原语(纯函数,可被其它守护段复用) ----------

为何是纯函数而不是段内一次性脚本:「哪些文件被逐字节复制进沙箱」这件事本身就在漂移
(今天只有 install-smoke 段复制,明天 check-* 系列自检/探针也会复制),所以判定要能被单测,
也要能被将来的守护段直接 import —— 口径只允许有一处。 */

/** 复制机制与判定范围(段内单源;新增复制形态时在此登记,勿散落在解析器里) */
export const COPY_MECHANISMS = [
  { call: "copyFileSync", scope: "per-file" },
  { call: "copyFile", scope: "per-file" },
  // 整树镜像(cpSync 目录 + node_modules 联接):整棵树都在沙盒里,相对依赖天然闭合,
  // 且 node_modules 被联接 → 裸包名也能解析。这类复制点只登记不判红(见 scanCopySites)
  { call: "cpSync", scope: "tree-mirror" },
];

/** 解析上限:一个复制表达式展开出的候选路径数上限(防御正则/别名链失控) */
const MAX_RESOLVED_ALTS = 64;

/**
 * 沙盒入口副本登记:复制进来就是为了**被执行**、因而在副本集合内没有上游 import 的脚本。
 *
 * 为何要人工登记而不是自动推断:「被当入口执行」在源码里只有语义(某次 spawn/runScript 传了
 * 这个文件名),纯文本上与「拼一个沙盒内路径」「段自身 import 了它」不可区分 —— 实测按
 * 「复制行之外被提及」自动推断,会把复制点上方那行 `path.join(root, "test/common/userdata.js")`
 * 也当成入口证据,于是「删掉使用方的相对 import」这种真实风险反而判不出来。故改为
 * 显式登记 + 机械抽查:登记项必须(a)确实在副本集合里、(b)复制点位置对得上、
 * (c)复制行之外存在一行「提及该文件且带执行类调用」的代码。
 * 新增/删除复制点时本表必须同步;漏登记 → 该副本判红(而不是静默放过)。
 * @type {{ rel: string; via: string; how: string }[]}
 */
export const SANDBOX_ENTRY_EVIDENCE = [
  {
    rel: "scripts/check-unpacked-smoke.mjs",
    via: "test/segments/install-smoke.test.js",
    how: "runScript(root, \"check-unpacked-smoke.mjs\", …) 在沙盒内执行",
  },
  {
    rel: "scripts/check-install-smoke.mjs",
    via: "test/segments/install-smoke.test.js",
    how: "runScript(root, \"check-install-smoke.mjs\", …) 在沙盒内执行",
  },
  {
    rel: "scripts/check-ci-contract.mjs",
    via: "scripts/check-ci-contract.selftest.mjs",
    how: "spawnSync(process.execPath, ['scripts/check-ci-contract.mjs']) 在夹具内执行",
  },
];

/**
 * 「这一行在执行某个东西」的特征词(入口登记的机械抽查用)。
 * 收紧它的理由:光看「复制行之外提到了这个文件名」会被两种无关提及满足 ——
 * 复制点上方拼沙盒路径的那一行、以及段自身对该脚本的 import。带上执行类调用才算数。
 * 新增沙盒执行封装(如 runScript / runCli)时在此登记,否则相关入口登记会开始报错。
 */
export const ENTRY_EXECUTION_TOKENS = ["spawnSync", "spawn(", "execFile", "execSync", "exec(", "fork(", "runScript", "runCli", "runGate"];

/**
 * 把注释抹成空格(等长:行号列号都保持),字符串与模板原样保留。
 *
 * 为何要状态机而不是正则:正则分不清 `//` 是注释还是字符串里的 `https://`,抹错一处就会
 * 让后面的引号配对错位,凭空造出「看起来像 import」的假阳性。本实现覆盖行注释 / 块注释 /
 * 三种字符串;模板按整串跳过(不递归扫 `${}` 内的表达式)—— 对「找 import specifier」这个
 * 用途足够,边界写在这里备查。
 * @param {string} text 源文本
 * @returns {string} 等长的「只剩代码」文本
 */
export function blankComments(text) {
  // 按 UTF-16 码元切分(不是码点):后面的跳过逻辑都按 text 的下标走,两者必须同坐标系,
  // 否则源码里一个 emoji 就会让「抹注释」错位
  const out = text.split("");
  let prev = ""; // 上一个有意义的代码字符(用于区分正则字面量与除号)
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(text, i);
      prev = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) {
        if (text[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    // 正则字面量:仅在「除号不可能出现」的位置按正则处理;标识符/右括号之后一律当除号
    // (那种位置上的正则若含未转义 `//` 本就不是合法字面量,残留字符不会造出 import 假阳性)
    if (ch === "/" && (prev === "" || /[({[,;:=!&|?+\-*%~^<>]/.test(prev))) {
      i = skipRegex(text, i);
      prev = "/";
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out.join("");
}

/**
 * 跳过一段引号字符串/模板(处理转义;模板不递归扫 `${}`)。
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
    if (quote !== "`" && ch === "\n") return i; // 未闭合的字符串:不吞掉换行,免得后面全被抹掉
    i += 1;
  }
  return i;
}

/**
 * 跳过一个正则字面量(含字符类与转义)。
 * @param {string} text 源文本
 * @param {number} start 斜杠所在下标
 * @returns {number} 字面量之后的下标
 */
function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i; // 未闭合:停在本行末
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i] ?? "")) i += 1;
      return i;
    }
    i += 1;
  }
  return i;
}

/**
 * specifier 抽取的四类写法(ESM 静态 / 副作用导入 / 动态 import / CJS require)。
 * `from "x"` 覆盖 import 与 export 两侧(declaration 与 re-export 同形)。
 */
const SPECIFIER_PATTERNS = [
  { kind: "static", re: /\bfrom\s*(["'])([^"'\n]+)\1/g },
  { kind: "side-effect", re: /\bimport\s*(["'])([^"'\n]+)\1/g },
  { kind: "dynamic", re: /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g },
  { kind: "require", re: /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g },
];

/**
 * 抽取一段代码里的全部模块 specifier 及其行号(行号基于**原文本**,故先 blankComments)。
 * @param {string} code blankComments 之后的等长文本
 * @returns {{ line: number; kind: string; spec: string }[]} specifier 列表
 */
export function collectSpecifiers(code) {
  /** @type {{ line: number; kind: string; spec: string }[]} */
  const found = [];
  const seen = new Set();
  for (const { kind, re } of SPECIFIER_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const spec = m[2];
      const index = m.index;
      if (spec === undefined || index === undefined) continue;
      const line = code.slice(0, index).split("\n").length;
      const key = `${line} ${spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ line, kind, spec });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * specifier 分类:node 内建 / 相对路径 / 裸包名。
 * @param {string} spec 模块 specifier
 * @returns {"node" | "relative" | "bare"} 分类
 */
export function classifySpecifier(spec) {
  if (spec.startsWith("node:")) return "node";
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) return "relative";
  return "bare";
}

/**
 * 相对 specifier 解析为仓库相对 POSIX 路径(纯函数,不碰 fs)。
 * @param {string} fromRel 引用方仓库相对 POSIX 路径
 * @param {string} spec 相对 specifier
 * @returns {string} 目标仓库相对 POSIX 路径(可越过仓库根,此时保留 `../` 前缀)
 */
export function resolveRelativeSpecifier(fromRel, spec) {
  const slash = fromRel.lastIndexOf("/");
  const dir = slash < 0 ? "" : fromRel.slice(0, slash);
  const segments = `${dir}/${spec}`.split("/");
  /** @type {string[]} */
  const stack = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      else stack.push("..");
      continue;
    }
    stack.push(seg);
  }
  return stack.join("/");
}

/**
 * 从 `(` 处读出调用实参(括号/引号配对;用于取复制调用的源路径表达式)。
 * 首个实参不含外层左括号本身 —— 否则取到的表达式会「少一个右括号」,配平失败。
 * @param {string} text 源文本
 * @param {number} open 左括号下标
 * @returns {string[]} 各实参的原始文本
 */
function readCallArgs(text, open) {
  /** @type {string[]} */
  const args = [];
  let depth = 1; // 外层左括号已消费
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
 * 收集中途常量环境:顶层 `const NAME = <initializer>`(initializer 支持跨行数组字面量)。
 * 判定只认顶层 const —— 段内 const/let 的局部绑定对「这个文件复制了谁」无影响。
 * @param {string} text 源文本
 * @returns {Map<string, string>} 名字 → initializer 文本
 */
function collectConstEnv(text) {
  /** @type {Map<string, string>} */
  const env = new Map();
  const decl = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
  for (const m of text.matchAll(decl)) {
    const name = m[1];
    const start = (m.index ?? 0) + m[0].length;
    if (name === undefined) continue;
    let init = "";
    if (text[start] === "[") {
      let depth = 0;
      let i = start;
      for (; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '"' || ch === "'" || ch === "`") {
          i = skipQuoted(text, i) - 1;
          continue;
        }
        if (ch === "[") depth += 1;
        else if (ch === "]") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
      }
      init = text.slice(start, i);
    } else {
      const end = text.indexOf("\n", start);
      init = text.slice(start, end < 0 ? text.length : end).replace(/;\s*$/, "").trim();
    }
    env.set(name, init);
  }
  return env;
}

/**
 * 收集 for-of 循环环境:`for (const X of LIST)` → X 的取值来自 LIST 常量数组。
 * 文件级(不判作用域):复制点与循环头常隔几行,按作用域收紧只会漏。
 * @param {string} text 源文本
 * @returns {Map<string, string>} 循环变量 → 数组常量名
 */
function collectLoopEnv(text) {
  /** @type {Map<string, string>} */
  const env = new Map();
  const re = /for\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined && m[2] !== undefined) env.set(m[1], m[2]);
  }
  return env;
}

/**
 * 求值一条「复制源」表达式,产出候选仓库相对 POSIX 路径。
 *
 * 支持的形态(与仓库现存复制点一一对应,新增形态时在此扩展,不要在调用点写特例):
 * - 字符串字面量:`"test/common/userdata.js"`
 * - `path.join(<root>, "a", "b")` / `join(<root>, 'a', 'b')`:首段为「仓库根别名」时按仓库相对解析
 * - 仓库根别名:`fileURLToPath(new URL('..', import.meta.url))`,或首段的未知标识符(ROOT 约定)
 * - 一层 const 别名:`const checkerPath = join(projectRoot, 'scripts', 'x.mjs')`
 * - for-of 数组展开:`for (const name of LIST) copyFileSync(path.join(ROOT, "scripts", name))`
 * 解析不出(动态列表、os.tmpdir()、多层别名链等)→ 返回 null,由调用方登记为「未静态解析」。
 * @param {string} expr 表达式文本
 * @param {Map<string, string>} constEnv 常量环境
 * @param {Map<string, string>} loopEnv for-of 环境
 * @returns {string[] | null} 候选仓库相对 POSIX 路径(空数组 = 解析到仓库外,不在范围)
 */
export function resolveCopySource(expr, constEnv, loopEnv) {
  /**
   * @param {string} raw 表达式文本
   * @param {number} depth 递归深度(别名链上限)
   * @returns {{ segments: string[]; rooted: boolean }[] | null} 候选路径段组合
   */
  const step = (raw, depth) => {
    const text = raw.trim().replace(/^fs\./, "").trim();
    if (text === "" || depth > 6) return null;
    // 整体被一对括号包住时才剥外层:用「剥掉尾括号」的正则会顺手吃掉 join(...) 的收尾括号,
    // 表达式随即配平失败(踩过一次:整棵复制扫描静默返回 0 个副本)
    if (text.startsWith("(")) {
      let parenDepth = 0;
      let end = -1;
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (c === "(") parenDepth += 1;
        else if (c === ")") {
          parenDepth -= 1;
          if (parenDepth === 0) {
            end = i;
            break;
          }
        }
      }
      return end === text.length - 1 ? step(text.slice(1, -1), depth + 1) : null;
    }
    const quoted = /^(['"])([^'"]*)\1$/.exec(text);
    if (quoted) {
      const value = quoted[2];
      if (value === undefined || value === "") return null;
      // 字面量路径按仓库相对处理:复制调用里的字面量几乎必然是仓库内路径(仓库外路径会带盘符/绝对前缀)
      return [{ segments: [value], rooted: true }];
    }
    // 仓库根别名:fileURLToPath(new URL('..', import.meta.url)) 一类
    if (/new URL\(/.test(text) && /import\.meta\.url/.test(text)) return [{ segments: [], rooted: true }];
    const call = /^(?:path\.)?join\(([\s\S]*)\)$/.exec(text);
    if (call && call[1] !== undefined) {
      /** @type {{ segments: string[]; rooted: boolean }[]} */
      let acc = [{ segments: [], rooted: false }];
      for (const arg of splitTopLevelArgs(call[1])) {
        const sub = step(arg, depth + 1);
        if (sub === null) return null;
        /** @type {{ segments: string[]; rooted: boolean }[]} */
        const next = [];
        for (const base of acc) {
          for (const s of sub) {
            const merged = [...base.segments, ...s.segments];
            if (merged.length > 12) return null;
            next.push({ segments: merged, rooted: base.rooted || s.rooted });
          }
        }
        if (next.length > MAX_RESOLVED_ALTS) return null;
        acc = next;
      }
      return acc;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
      if (constEnv.has(text)) return step(/** @type {string} */ (constEnv.get(text)), depth + 1);
      const listName = loopEnv.get(text);
      if (listName !== undefined) {
        const listInit = constEnv.get(listName);
        if (listInit === undefined || !listInit.trimStart().startsWith("[")) return null;
        /** @type {{ segments: string[]; rooted: boolean }[]} */
        const out = [];
        for (const member of splitTopLevelArgs(listInit.trim().slice(1, -1))) {
          const sub = step(member, 0);
          if (sub === null) return null;
          out.push(...sub);
          if (out.length > MAX_RESOLVED_ALTS) return null;
        }
        return out;
      }
      // 首段(或唯一段)的未知标识符按「仓库根」约定处理(ROOT / projectRoot / repoRoot…)
      return [{ segments: [], rooted: true }];
    }
    return null;
  };
  const resolved = step(expr, 0);
  if (resolved === null) return null;
  const rels = resolved
    .filter((a) => a.rooted && a.segments.length > 0)
    .map((a) => a.segments.join("/"));
  return [...new Set(rels)];
}

/**
 * 按顶层逗号切分实参文本(忽略括号/引号内的逗号)。
 * @param {string} text 实参列表文本(不含外层括号)
 * @returns {string[]} 各实参(已 trim)
 */
function splitTopLevelArgs(text) {
  /** @type {string[]} */
  const args = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipQuoted(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

/* ---------- (e) 沙箱副本闭包:扫描与审计 ---------- */

/** 只把「会被当模块解析的源文件」纳入副本闭包(图片/清单等资源不在范围) */
const JS_SOURCE_RE = /\.(?:js|mjs|cjs)$/;

/**
 * @typedef {object} SourceFile 待扫描的源文件
 * @property {string} path 仓库相对 POSIX 路径
 * @property {string} text 文件文本
 */

/**
 * @typedef {object} CopySite 一个被逐字节复制进沙箱的仓库文件
 * @property {string} rel 被复制文件的仓库相对 POSIX 路径
 * @property {string} via 复制点所在文件的仓库相对 POSIX 路径
 * @property {number} line 复制调用所在行号
 */

/**
 * @typedef {object} UnresolvedSite 登记但不判红的复制点
 * @property {string} file 所在文件
 * @property {number} line 行号
 * @property {string} expr 源路径表达式原文
 * @property {string} reason 不判红的原因
 */

/**
 * @typedef {object} ScanResult 扫描结果
 * @property {CopySite[]} copies 静态可解析的逐文件副本
 * @property {UnresolvedSite[]} unresolved 解析不出仓库文件的复制点(登记,不判红)
 * @property {UnresolvedSite[]} treeMirrors 整树镜像式复制点(登记,不判红)
 */

/**
 * 扫出「被逐字节复制进沙箱」的仓库文件(事实源 = 代码里的复制调用,不硬编码任何文件名)。
 * 解析不出的复制点只登记:静态求值不可能覆盖所有写法(运行时拼装的列表、多层别名),
 * 把它们判红会让守护变成「必须改解析器」的负担;但必须登记并打印,否则等于没看见。
 * @param {SourceFile[]} files 待扫描源文件(调用方给全 test/ 与 scripts/)
 * @returns {ScanResult}
 */
export function scanCopySites(files) {
  /** @type {CopySite[]} */
  const copies = [];
  /** @type {UnresolvedSite[]} */
  const unresolved = [];
  /** @type {UnresolvedSite[]} */
  const treeMirrors = [];
  for (const file of files) {
    const code = blankComments(file.text);
    const constEnv = collectConstEnv(file.text);
    const loopEnv = collectLoopEnv(file.text);
    for (const mechanism of COPY_MECHANISMS) {
      const callRe = new RegExp(`\\b${mechanism.call}\\s*\\(`, "g");
      for (const m of code.matchAll(callRe)) {
        const index = m.index ?? 0;
        const line = code.slice(0, index).split("\n").length;
        const expr = readCallArgs(code, index + m[0].length - 1)[0] ?? "";
        if (mechanism.scope === "tree-mirror") {
          treeMirrors.push({ file: file.path, line, expr, reason: "整树镜像(目录 + node_modules 联接),相对依赖天然闭合" });
          continue;
        }
        const rels = resolveCopySource(expr, constEnv, loopEnv);
        if (rels === null || rels.length === 0) {
          unresolved.push({
            file: file.path,
            line,
            expr,
            reason: rels === null ? "源表达式无法静态解析(动态列表 / 非仓库路径 / 多层别名)" : "解析结果不是仓库内文件",
          });
          continue;
        }
        for (const rel of rels) {
          if (!JS_SOURCE_RE.test(rel)) continue;
          copies.push({ rel, via: file.path, line });
        }
      }
    }
  }
  return { copies, unresolved, treeMirrors };
}

/**
 * @typedef {object} ClosureViolation 闭包违规
 * @property {string} rel 副本的仓库相对 POSIX 路径
 * @property {number} line 违规行号(基于原文本)
 * @property {string} spec 违规的 specifier
 * @property {string} kind 违规种类
 * @property {string} detail 人可读说明
 */

/**
 * @typedef {object} OrphanCopy 死副本
 * @property {string} rel 副本的仓库相对 POSIX 路径
 * @property {string} via 复制点所在文件
 * @property {string} reason 判红理由
 */

/**
 * 审计副本集合的 import 闭包:
 * 1) 只允许 `node:` 内建 —— 逐文件复制的沙盒里没有 node_modules,裸包名必然解析失败;
 * 2) 相对 specifier 的目标必须同在副本集合内 —— 复制点只复制被点名的文件;
 * 3) 不得有死副本 —— 复制进来却没人用(既无同集合内的相对 import 入边,也不在
 *    SANDBOX_ENTRY_EVIDENCE 里登记为沙盒入口),说明复制与引用其中之一已失效,
 *    该副本承载的语义(清理/校验)会静默丢失。
 * 纯函数:只吃副本清单与文本,便于用合成样本先红后绿。
 * @param {CopySite[]} copies 副本清单(含复制点文件与行号)
 * @param {Map<string, string>} texts 仓库相对路径 → 文本(含副本与复制点文件)
 * @param {{ rel: string; via: string; how?: string }[]} [entryEvidence] 沙盒入口登记(默认无)
 * @returns {{ violations: ClosureViolation[]; orphans: OrphanCopy[]; edges: { from: string; to: string; line: number; spec: string }[] }}
 */
export function auditCopySet(copies, texts, entryEvidence = []) {
  const relSet = new Set(copies.map((c) => c.rel));
  /** @type {ClosureViolation[]} */
  const violations = [];
  /** @type {{ from: string; to: string; line: number; spec: string }[]} */
  const edges = [];
  /** @type {Map<string, Set<string>>} */
  const incoming = new Map();
  for (const copy of copies) {
    const text = texts.get(copy.rel);
    if (text === undefined) {
      violations.push({
        rel: copy.rel,
        line: copy.line,
        spec: "",
        kind: "source-unreadable",
        detail: "副本源文件不可读(扫描结果与磁盘不一致,复制点可能已失效)",
      });
      continue;
    }
    for (const { line, spec } of collectSpecifiers(blankComments(text))) {
      const cls = classifySpecifier(spec);
      if (cls === "node") continue;
      if (cls === "bare") {
        violations.push({
          rel: copy.rel,
          line,
          spec,
          kind: "bare-specifier",
          detail: "裸包名 specifier:逐文件复制的沙盒内无 node_modules,该 import 必然解析失败",
        });
        continue;
      }
      const resolved = resolveRelativeSpecifier(copy.rel, spec);
      edges.push({ from: copy.rel, to: resolved, line, spec });
      if (relSet.has(resolved)) {
        if (!incoming.has(resolved)) incoming.set(resolved, new Set());
        incoming.get(resolved)?.add(copy.rel);
        continue;
      }
      violations.push({
        rel: copy.rel,
        line,
        spec,
        kind: "relative-outside-copy-set",
        detail: `相对 import 目标 ${resolved} 不在逐字节复制集合内(复制点只复制被点名的文件,不会连带复制同目录依赖)`,
      });
    }
  }
  /** @type {OrphanCopy[]} */
  const orphans = [];
  const entryRels = new Set(entryEvidence.map((e) => e.rel));
  const seen = new Set();
  for (const copy of copies) {
    if (seen.has(copy.rel)) continue;
    seen.add(copy.rel);
    if ((incoming.get(copy.rel)?.size ?? 0) > 0) continue; // 同集合内确有入边:它真的在被用
    if (entryRels.has(copy.rel)) continue; // 已登记为沙盒入口(登记本身受 auditEntryEvidence 抽查)
    orphans.push({
      rel: copy.rel,
      via: copy.via,
      reason:
        "死副本:同集合内无相对 import 入边,也未登记为沙盒入口 —— 复制与引用已对不上,该副本承载的语义会静默丢失",
    });
  }
  return { violations, orphans, edges };
}

/**
 * 沙盒入口登记的机械抽查:登记项必须仍在副本集合里、复制点对得上、且复制行之外存在
 * 「提及该文件 + 带执行类调用」的代码行。第三条是关键:没有它,登记就能把任意死副本洗白,
 * 而那正是本条守护要防的事。
 * @param {CopySite[]} copies 副本清单
 * @param {Map<string, string>} texts 仓库相对路径 → 文本
 * @param {{ rel: string; via: string; how: string }[]} entryEvidence 登记项
 * @returns {string[]} 问题清单(空数组 = 登记全部有效)
 */
export function auditEntryEvidence(copies, texts, entryEvidence) {
  /** @type {string[]} */
  const problems = [];
  for (const entry of entryEvidence) {
    const site = copies.find((c) => c.rel === entry.rel);
    if (site === undefined) {
      problems.push(`登记项 ${entry.rel} 已不在副本集合内(复制点被删或改了复制范围,请同步本表)`);
      continue;
    }
    if (site.via !== entry.via) {
      problems.push(`登记项 ${entry.rel} 的复制点已迁移:${entry.via} → ${site.via}(请同步本表)`);
      continue;
    }
    const viaText = texts.get(entry.via);
    const execLines = viaText === undefined ? [] : findEntryExecutionLines(viaText, site);
    if (execLines.length === 0) {
      problems.push(
        `登记项 ${entry.rel} 在 ${entry.via} 的复制行(${site.line})之外已无「提及它且带执行类调用」的行 —— 它多半不再被当入口执行(原登记理由:${entry.how}),请删除该登记并复核复制点`,
      );
      continue;
    }
    if (entry.how.trim() === "") {
      problems.push(`登记项 ${entry.rel} 缺 how 说明(人工复核的依据,不得留空)`);
    }
  }
  return problems;
}

/**
 * 找出「复制行之外、既提到该副本文件又带执行类调用」的行号(入口登记的机械证据)。
 * @param {string} viaText 复制点所在文件文本
 * @param {CopySite} copy 副本记录
 * @returns {number[]} 行号(升序)
 */
export function findEntryExecutionLines(viaText, copy) {
  const base = copy.rel.slice(copy.rel.lastIndexOf("/") + 1);
  /** @type {number[]} */
  const lines = [];
  blankComments(viaText)
    .split("\n")
    .forEach((line, i) => {
      const row = i + 1;
      if (row === copy.line) return;
      if (!line.includes(base)) return;
      if (ENTRY_EXECUTION_TOKENS.some((token) => line.includes(token))) lines.push(row);
    });
  return lines;
}

/**
 * 递归列出目录下的 JS/MJS/CJS 源文件(仓库相对 POSIX 路径,按路径排序保证幂序)。
 * @param {string} root 仓库根绝对路径
 * @param {string[]} relDirs 相对目录数组
 * @returns {SourceFile[]}
 */
export function listJsSources(root, relDirs) {
  /** @type {SourceFile[]} */
  const files = [];
  /**
   * @param {string} absDir 绝对目录
   * @param {string} relDir 相对目录(POSIX)
   * @returns {void}
   */
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
      else if (JS_SOURCE_RE.test(entry.name)) {
        files.push({ path: rel, text: fs.readFileSync(path.join(absDir, entry.name), "utf8") });
      }
    }
  };
  for (const relDir of relDirs) walk(path.join(root, ...relDir.split("/")), relDir);
  return files;
}


export async function run() {
  // ---- 恒等性:docx/pdf 两侧导入同源(同一对象引用) ----
  const { CROSS_REF_KINDS: docxKinds } = await import("../../dist/core/docx/render.js");
  const { CROSS_REF_KINDS: pdfKinds } = await import("../../dist/core/pdf/render.js");
  if (docxKinds !== CROSS_REF_KINDS || pdfKinds !== CROSS_REF_KINDS) {
    throw new Error("contract 断言失败:docx/pdf 侧 CROSS_REF_KINDS 应与 core/cross-ref.ts 单源为同一对象");
  }
  console.log("[ok] contract:CROSS_REF_KINDS docx/pdf 两侧与单源同一对象 断言通过");

  // ---- 契约形状:fig/tab/sec 三类,文案与占位 ----
  for (const [kind, def] of Object.entries(CROSS_REF_KINDS)) {
    if (typeof def.defaultText !== "string" || typeof def.danglingText !== "string" || typeof def.kindName !== "string") {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 缺 defaultText/danglingText/kindName`);
    }
  }
  if (Object.keys(CROSS_REF_KINDS).sort().join(",") !== "fig,sec,tab") {
    throw new Error("contract 断言失败:CROSS_REF_KINDS 应恰为 fig/sec/tab 三类");
  }
  console.log("[ok] contract:CROSS_REF_KINDS 形状(fig/tab/sec + 文案字段) 断言通过");

  // ---- SEC_LABEL_RE:label 提取(parse.ts 场景)与尾部匹配 ----
  const m = SEC_LABEL_RE.exec("第三章 结果 {#sec:results}");
  if (m === null || m[1] !== "results" || m.index !== "第三章 结果".length) {
    throw new Error(`contract 断言失败:SEC_LABEL_RE 应提取 label=results 且锚定尾部,实际 ${m?.[1]}`);
  }
  if (SEC_LABEL_RE.exec("普通标题") !== null) {
    throw new Error("contract 断言失败:无 label 标题不应命中 SEC_LABEL_RE");
  }
  console.log("[ok] contract:SEC_LABEL_RE 尾部 label 提取 断言通过");

  // ---- stripSecLabelSuffix:纯文本剥离(docx 目录条目 / pdf inline.content 场景) ----
  if (stripSecLabelSuffix("引言 {#sec:intro}") !== "引言") {
    throw new Error("contract 断言失败:stripSecLabelSuffix 应剥离尾部 label 后缀");
  }
  if (stripSecLabelSuffix("**加粗** {#sec:bold}") !== "**加粗**") {
    throw new Error("contract 断言失败:stripSecLabelSuffix 不应改动 label 前文本");
  }
  console.log("[ok] contract:stripSecLabelSuffix 纯文本剥离 断言通过");

  // ---- kindLabelRegex:fig/tab/sec 按 kind 构造(每次新建实例) ----
  for (const kind of ["fig", "tab", "sec"]) {
    const re = kindLabelRegex(kind);
    const hit = re.exec(`x {#${kind}:a-1}`);
    if (hit === null || hit[1] !== "a-1") {
      throw new Error(`contract 断言失败:kindLabelRegex(${kind}) 应命中并捕获 a-1`);
    }
    const other = kind === "fig" ? "tab" : "fig";
    if (re.exec(`x {#${other}:a}`) !== null) {
      throw new Error(`contract 断言失败:kindLabelRegex(${kind}) 不应命中 #${other}: 前缀`);
    }
  }
  console.log("[ok] contract:kindLabelRegex 按 kind 构造与隔离 断言通过");

  // ---- 白名单标签集恒等:ALLOWED_INLINE_TAGS ↔ INLINE_TAG_STYLES(+br) ----
  const { assertInlineTagStylesMatchWhitelist } = await import("../../dist/core/docx/handlers/inline-html.js");
  assertInlineTagStylesMatchWhitelist();
  console.log("[ok] contract:白名单标签集恒等(ALLOWED_INLINE_TAGS ↔ INLINE_TAG_STYLES+br) 断言通过");

  // ---- 跨进程类型单源:ConvertResult 只在 core/ipc-contract.ts 声明 ----
  // 类型声明编译期擦除,产物无痕迹,故按源码文本判定(re-export/import 不算声明)。
  const declRe = /\b(?:interface|type)\s+ConvertResult\b/;
  const contractSrc = readSrc("core/ipc-contract.ts");
  if (!declRe.test(contractSrc)) {
    throw new Error("contract 断言失败:ConvertResult 应在 core/ipc-contract.ts 单源声明");
  }
  const noRedeclare = [
    "main/preload.cts",
    "main/ipc/logic.ts",
    "main/ipc/types.ts",
    "main/converter/merge.ts",
    "main/converter/index.ts",
    "main/persist/settings.ts",
    "main/persist/preset-file.ts",
    "renderer/renderer.ts",
  ];
  for (const file of noRedeclare) {
    if (declRe.test(readSrc(file))) {
      throw new Error(`contract 断言失败:${file} 重复声明 ConvertResult(应经 core/ipc-contract.ts 取用)`);
    }
  }
  console.log(`[ok] contract:ConvertResult 仅 core/ipc-contract.ts 声明(${noRedeclare.length} 个消费方无重复声明) 断言通过`);

  // ---- preload 类型依赖只来自 core 契约(不 type-only 反向引用 main 实现路径) ----
  const preloadSrc = readSrc("main/preload.cts");
  for (const m of preloadSrc.matchAll(/from\s*["']([^"']+)["']/g)) {
    const spec = m[1] ?? "";
    // 相对路径写法(./ 或 ../main/)即指向 main 侧模块;core 走 ../core/,裸包名不算
    if (spec.startsWith("../main/") || spec.startsWith("./")) {
      throw new Error(`contract 断言失败:preload 仍引用 main 侧路径「${spec}」(契约类型应取自 core)`);
    }
  }
  if (!/import type \{[^}]*\bConvertResult\b[^}]*\} from "\.\.\/core\/ipc-contract\.js"/.test(preloadSrc)) {
    throw new Error("contract 断言失败:preload 应自 core/ipc-contract.ts type-only 取用 ConvertResult");
  }
  console.log("[ok] contract:preload 类型依赖仅来自 core 契约(ConvertResult 自 core/ipc-contract 取用) 断言通过");

  // ================= (e) 沙箱副本闭包:逐字节复制的模块,其 import 必须闭合 =================
  // 0. 判定原语的正/负锚点:先证明这套判定真会抓违规(否则真实文件树上的「全绿」无意义)
  const synthetic = [
    "// import x from './commented-out.js'", // 1 注释里的 import 不该被抽到
    "const url = 'https://example.com/a'; // import y from './in-url-comment.js'", // 2 字符串里的 // 不是注释起点
    "import fs from 'node:fs';", // 3 内建
    "import { rmSync } from './sibling.mjs';", // 4 相对
    "const lazy = await import('../shared/util.mjs');", // 5 动态相对
    "const legacy = require(\"./legacy.cjs\");", // 6 CJS 相对
    "import 'side-effect-only.mjs';", // 7 副作用导入
  ].join("\n");
  const syntheticSpecs = collectSpecifiers(blankComments(synthetic));
  assertEq(
    syntheticSpecs.map((s) => `${s.line}:${classifySpecifier(s.spec)}`).join(","),
    "3:node,4:relative,5:relative,6:relative,7:bare",
    "specifier 抽取/分类锚点(注释行不算、字符串里的 // 不误判、行号对齐原文本)",
  );
  assertEq(
    resolveRelativeSpecifier("scripts/smoke-proc.mjs", "../test/common/userdata.js"),
    "test/common/userdata.js",
    "相对解析锚点:上跳一级",
  );
  assertEq(
    resolveRelativeSpecifier("test/common/userdata.js", "./temp-resource.js"),
    "test/common/temp-resource.js",
    "相对解析锚点:同目录",
  );
  assertEq(resolveRelativeSpecifier("a.mjs", "../outside.mjs"), "../outside.mjs", "相对解析锚点:越出仓库根须保留上行前缀");
  console.log("[ok] contract:副本闭包判定原语锚点(specifier 抽取/分类/相对解析) 断言通过");

  // 1. 扫出被逐字节复制进沙箱的文件:事实源 = 代码里的复制调用(不硬编码任何文件名)
  const sources = listJsSources(repoRoot, ["test", "scripts"]);
  const scan = scanCopySites(sources);
  /** 仓库相对 POSIX 路径 → 文本 */
  const texts = new Map(sources.map((f) => [f.path, f.text]));
  const copiedRels = [...new Set(scan.copies.map((c) => c.rel))].sort();
  assert(copiedRels.length >= 1, `未扫出任何逐字节复制的模块(复制机制=${COPY_MECHANISMS.map((m) => m.call).join("/")},walker 可能失效)`);
  for (const rel of copiedRels) {
    assert(fs.existsSync(path.join(repoRoot, ...rel.split("/"))), `扫出的副本在磁盘上不存在:${rel}(解析器与事实脱节)`);
  }
  assert(
    scan.unresolved.length + scan.treeMirrors.length > 0,
    "登记类复制点应为非空(若解析器退化成「什么都不报」,这段断言会先红,提示覆盖面被悄悄缩小)",
  );
  // 说明:复制点扫描跑在「抹注释、留字符串」的文本上,所以字符串里出现的 `copyFileSync(`
  // (含本段下面自测夹具用的那行)也会被登记 —— 后果只是多一条「未静态解析」登记项,不会误判红。
  console.log(
    `[ok] contract:沙箱副本清单(${copiedRels.length} 个:${copiedRels.join(", ")};登记不判红:未静态解析 ${scan.unresolved.length} 处 / 整树镜像 ${scan.treeMirrors.length} 处)`,
  );

  // 2. 负向锚点:给某个「当前零依赖」的副本注入一句相对 import,同一套判定必须判红并点名行号
  //    (夹具对象由扫描结果挑,不写死文件名 —— 守护对象将来会变,判定不能跟着变)
  const dependencyFree = scan.copies.find((c) =>
    collectSpecifiers(blankComments(texts.get(c.rel) ?? "")).every((s) => classifySpecifier(s.spec) === "node"),
  );
  assert(dependencyFree !== undefined, `负向夹具缺失:应至少有一个「只依赖 node: 内建」的副本(实际副本 ${copiedRels.length} 个)`);
  const fixture = /** @type {CopySite} */ (dependencyFree);
  const baseText = /** @type {string} */ (texts.get(fixture.rel));
  const relativeInjection = `${baseText}\nimport { TEMP_PREFIX } from "./temp-resource.js";\n`;
  /** @type {Map<string, string>} */
  const injectedTexts = new Map(texts);
  injectedTexts.set(fixture.rel, relativeInjection);
  const relativeRed = auditCopySet([fixture], injectedTexts);
  assertEq(relativeRed.violations.length, 1, `注入相对 import 后应恰好判出一条违规(实际 ${renderViolations(relativeRed.violations)})`);
  assertEq(relativeRed.violations[0]?.rel, fixture.rel, "违规须点名副本文件");
  assertEq(relativeRed.violations[0]?.line, relativeInjection.split("\n").length - 1, "违规须命中注入那一行");
  assertEq(
    relativeRed.violations[0]?.kind,
    "relative-outside-copy-set",
    "违规种类:相对目标不在副本集合内",
  );
  const bareInjection = `${baseText}\nimport { something } from "some-bare-package";\n`;
  /** @type {Map<string, string>} */
  const bareTexts = new Map(texts);
  bareTexts.set(fixture.rel, bareInjection);
  const bareRed = auditCopySet([fixture], bareTexts);
  assertEq(bareRed.violations.length, 1, `注入裸包名后应恰好判出一条违规(实际 ${renderViolations(bareRed.violations)})`);
  assertEq(bareRed.violations[0]?.kind, "bare-specifier", "违规种类:裸包名(沙盒内无 node_modules)");
  assertEq(bareRed.violations[0]?.line, bareInjection.split("\n").length - 1, "裸包名违规须命中注入那一行");
  // 死副本负向:入边与入口登记都没了 → 必须判红(对应「使用方的相对 import 被删 / 改成绝对路径」)
  const copyCallLine = `fs.copyFileSync(path.join(ROOT, ${JSON.stringify(fixture.rel)}), target);`;
  const orphanRed = auditCopySet(
    [{ rel: fixture.rel, via: fixture.via, line: 1 }],
    new Map([[fixture.rel, baseText], [fixture.via, copyCallLine]]),
  );
  assertEq(orphanRed.orphans.length, 1, "无入边且无入口登记时必须判为死副本");
  assertEq(orphanRed.orphans[0]?.rel, fixture.rel, "死副本须点名副本文件");
  // 死副本的正向对照:登记为沙盒入口后不再判红(否则「复制 + 执行」的正常脚本会被误杀)
  const entryOk = auditCopySet(
    [{ rel: fixture.rel, via: fixture.via, line: 1 }],
    new Map([[fixture.rel, baseText], [fixture.via, copyCallLine]]),
    [{ rel: fixture.rel, via: fixture.via, how: "自测夹具:沙盒内执行" }],
  );
  assertEq(entryOk.orphans.length, 0, "登记为沙盒入口后不应判为死副本");
  // 登记本身的负向锚点:登记项若已不在副本集合里(复制点被删/复制范围变了)必须报失效,
  // 否则登记会变成「过期也继续生效」的免罪符
  const staleEntry = auditEntryEvidence(
    [fixture],
    injectedTexts,
    [{ rel: "test/common/not-copied-anymore.mjs", via: fixture.via, how: "自测夹具:构造一条过期登记" }],
  );
  assertEq(staleEntry.length, 1, "登记项不在副本集合内时必须报失效");
  // 入口证据的负向锚点:只有「提及」没有「执行」的复制点文件不算数
  // (否则复制点上方拼路径的那一行、或段自身对它的 import,都能把死副本洗白)
  const mentionOnly = auditEntryEvidence(
    [fixture],
    new Map([
      [fixture.rel, baseText],
      [fixture.via, `${copyCallLine}\nconst p = path.join(ROOT, ${JSON.stringify(fixture.rel)});\nimport x from ${JSON.stringify(fixture.rel)};`],
    ]),
    [{ rel: fixture.rel, via: fixture.via, how: "自测夹具:只有提及没有执行" }],
  );
  assertEq(mentionOnly.length, 1, "复制行之外只有「提及」而无执行类调用时,入口登记必须报失效");
  console.log("[ok] contract:副本闭包负向锚点(相对越界/裸包名/死副本判红,入口登记对照不误杀/过期登记与无执行证据判失效) 断言通过");

  // 3. 真实文件树:副本集合必须闭合,且入口登记必须仍然有效
  const audit = auditCopySet(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(audit.violations.length, 0, `沙箱副本 import 闭包违规:${renderViolations(audit.violations)}`);
  assertEq(
    audit.orphans.length,
    0,
    `沙箱副本存在死副本:${audit.orphans.map((o) => `${o.rel}(复制于 ${o.via})`).join("; ")}`,
  );
  const entryProblems = auditEntryEvidence(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(entryProblems.length, 0, `沙盒入口登记失效:${entryProblems.join("; ")}`);
  // 入边必须真实存在(否则「闭合」可能是空集自洽):既要求总体有边,也要求测试树内的副本确有入边
  assert(audit.edges.length >= 1, "副本之间应存在相对 import 入边(全 0 说明提取或判定失效)");
  assert(
    audit.edges.some((e) => e.to.startsWith("test/")),
    `应有指向 test/ 下副本的相对入边(实测边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ") || "无"})`,
  );
  console.log(
    `[ok] contract:沙箱副本闭包(${copiedRels.length} 个副本 / ${audit.edges.length} 条相对入边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ")} / 沙盒入口登记 ${SANDBOX_ENTRY_EVIDENCE.length} 项:${SANDBOX_ENTRY_EVIDENCE.map((e) => `${e.rel}[${e.how}]`).join(" | ")}) 断言通过`,
  );
}
