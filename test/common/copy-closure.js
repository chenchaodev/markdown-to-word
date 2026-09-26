// @ts-check
/**
 * 沙箱副本闭包判定(测试树共享的纯函数层,单一来源):
 * 从**源码文本**还原「哪些文件被逐字节复制进沙箱」,并审计这批副本的 import 闭包。
 *
 * 为何要有这一层(而不是留在守护段里):「被逐字节复制进沙箱」这件事本身在漂移 —— 今天只有
 * install-smoke 段复制,明天 check-* 系列的自检/探针也会复制。判定口径若埋在段里,每加一个
 * 复制点就得把判定重抄一遍(必然漂移),且无法被合成样本单测。故拆成零依赖纯函数层,
 * 由守护段(test/segments/contract-single-source.test.js 的 (e) 节)只做装配与断言。
 *
 * 依赖分层(刻意):本文件**零 import** —— 不碰 fs/path/任何 I/O。
 * 「遍历测试树与 scripts/、读文件」留在守护段(它已有 fs/path),本文件只吃「文本 → 结论」。
 *
 * 依赖方向单向:守护段 → 本文件;本文件不依赖任何段,也不依赖 dist 产物。
 *
 * ---- 已知覆盖边界(不是「已完全覆盖」,改判定前先读这段)----
 * 静态求值只认写在源码里的形状。以下三类复制源**解析不出**,只登记、不判红:
 * 1) 运行时拼装的列表(如从配置里解析出的 configFiles 之类的 for-of 目标);
 * 2) 多层别名链(一层 const 别名可解,两层以上保守放弃);
 * 3) 跨目录整树复制(cpSync 目录 + node_modules 联接,见 COPY_MECHANISMS 的 tree-mirror):
 *    整棵树都在沙盒里,相对依赖天然闭合,不适用本模块的逐文件闭包。
 * 后果:若将来有人用「运行时拼装列表」的方式复制一个 JS 模块,本守护**不会自动纳入**它。
 * 那时需人工扩 resolveCopySource 支持该形态,或给该复制机制新增一个 COPY_MECHANISMS scope;
 * 在此之前,这类复制点只出现在 scanCopySites().unresolved / treeMirrors 的登记里(段会打印)。
 *
 * ---- 行数例外(已接受,写明理由)----
 * 本文件约 730 行,超出全局 CODE-GUIDE 的 ~500 行参考线。刻意不拆的理由:
 * 1) 它是**一个内聚职责**(文本 → 副本集合 → 闭包结论),三段之间靠同一批 typedef 与
 *    COPY_MECHANISMS/SANDBOX_ENTRY_EVIDENCE 两张表串在一起,拆开只会得到两个必须成对 import 的模块;
 * 2) 篇幅主体是判定理由的 JSDoc(每条规则都记了「为什么这样判、踩过什么坑」),为凑行数删文档
 *    等于把本模块唯一的价值删掉;
 * 3) 若日后确需真拆,天然切口是「纯文本层」(blankComments/specifiers/相对解析/复制源求值)
 *    与「扫描+审计层」(scanCopySites/auditCopySet/auditEntryEvidence)两片 —— 那是一次
 *    纯搬迁,前提是允许新增第二个 test/common 文件。
 */

/** 复制机制与判定范围(本文件单源;新增复制形态时在此登记,勿散落在解析器里) */
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
 * 判定只认顶层 const —— 函数内 const/let 的局部绑定对「这个文件复制了谁」无影响。
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

/* ---------- 扫描与审计 ---------- */

/** 只把「会被当模块解析的源文件」纳入副本闭包(图片/清单等资源不在范围);遍历侧由守护段复用 */
export const JS_SOURCE_RE = /\.(?:js|mjs|cjs)$/;

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
