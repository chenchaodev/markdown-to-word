// @ts-check
/**
 * 沙盒副本闭包 · 纯文本层(测试树共享,零 node: 依赖):
 * 把「一段源码文本」变成可断言的词法事实 —— 剥注释、抽 specifier、判 specifier 种类、
 * 解析相对路径、以及对「复制源表达式」做静态求值。
 *
 * 为何分两层(本层 / 扫描审计层):见同目录 copy-closure-audit.js 的文件头。两层合起来是
 * 一次完整守护,拆开是因为它们的变化驱动力不同 —— 本层随「源码文本长什么样」变(语言写法、
 * 表达式形态),上层随「仓库里有哪些复制点」变(哪个脚本被复制、沙盒怎么组装)。
 *
 * 依赖方向单向:守护段 → copy-closure-audit.js → 本文件。**本文件不 import 上层**,
 * 也不 import 任何 node: 内建模块(零 I/O:不读文件、不遍历目录,只吃字符串)。
 * 目录遍历与读文件留在守护段(它已有 fs/path)。
 *
 * 本层被上层与守护段共用的符号(JS_SOURCE_RE、SourceFile)刻意放在这里,避免出现第二份定义。
 *
 * ⚠ 已知覆盖边界与行数口径:见守护段 test/segments/contract-single-source.test.js 的文件头
 *   「沙盒副本闭包 · 已知覆盖边界」小节 —— 那里是唯一权威处,本文件不重复,避免两份说法漂移。
 */

/** 只把「会被当模块解析的源文件」纳入副本闭包(图片/清单等资源不在范围);遍历侧与扫描层都复用它 */
export const JS_SOURCE_RE = /\.(?:js|mjs|cjs)$/;

/** 解析上限:一个复制表达式展开出的候选路径数上限(防御正则/别名链失控) */
const MAX_RESOLVED_ALTS = 64;

/**
 * @typedef {object} SourceFile 待扫描的源文件
 * @property {string} path 仓库相对 POSIX 路径
 * @property {string} text 文件文本
 */

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
 * 词法层最底层的原语,上层(扫描审计层)的实参/环境解析也复用它 —— 故 export,避免两份定义漂移。
 * @param {string} text 源文本
 * @param {number} start 引号所在下标
 * @returns {number} 结束引号之后的下标
 */
export function skipQuoted(text, start) {
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
