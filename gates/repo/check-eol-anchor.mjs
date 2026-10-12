// 行尾敏感锚点门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 它守住什么 ----
// 检出态的行尾由各端 `core.autocrlf` 决定(`.gitattributes` 的 `* text=auto` + Windows runner
// 的 autocrlf=true ⇒ CI 上检出即 CRLF),而本仓的门禁与验收段大量**读文件文本**。
// 一旦读进来的是 CRLF 而判据用**字面量 LF** 做锚,失效形态是**静默**的:
// 判据一条都匹配不上 → 抽出空表/空集 → 以「与本次改动无关」的行数红,或干脆恒绿。
// REQ-202 记的那天 CI 连红四次,四次同族(检出为 CRLF × 判据用字面量 LF 锚点),就是这一族。
//
// **本门禁只做检测,不做归一原语的收口**:收口跨树(`shared/` 零跨树出边,承载不了
// `gates/` 的调用),是另一条工作线。本门禁的价值是让下一次写这种代码在**当场**红。
//
// ---- 判据式(四条同时成立才算命中)----
// A  **裸 LF 行锚**:出现 `X.split('\n')` / `X.split("\n")` —— 分隔符必须是**字面量 LF**。
//    `/\r?\n/`(已容错)、`'\r\n'`、模板 `` `\n` `` 三种形态**一律不算**。
// B  **内容级消费**:该 split 的结果被用于**内容相等**判定,只有四种形态:
//    B1 空行判定 —— 元素/数组变量/回调形参与 `''` / `""` 比 `===` / `!==`
//    B2 逐元素等值 —— 两个行数组同下标互比(`A[i] === B[i]`,即「哪一行不同」的漂移比对)
//    B3 整行定位 —— 行数组 `.indexOf(<字面量>)` / `.includes(<字面量>)`
//    B4 空行过滤 —— 行数组 `.filter((X) => X === '')` 那一支
// C  **读派生**:该 split 的接收者可在本文件内追到读文本原语
//    (`readFileSync` / `readFile` / `fsp.readFile` / `fs.promises.readFile` / `readFileSyncUtf8`)
//    或子进程 stdout/stderr。追不到 ⇒ 不判(合成字符串、内存拼接、markdown 正文都在这一档外)。
// D  **未归一**:该接收者的赋值链上没有 EOL 归一
//    (`replace(/\r\n/g, …)` / `replace(/\r?\n/g, …)` / `normalizeEol(`)。
//
// ---- 为什么「切窄」而不是「切宽」----
// 裸 LF 分隔符本身**不是雷**:CRLF 与 LF 下 `split('\n')` 产生的**行数完全相同**
// (`\r` 挂在上一行尾部,不是新行),故凡是用它**计数 / 定位行号**的写法
// (本仓大量存在,如 `text.slice(0, off).split('\n').length` 换算行号)在两种行尾下同解;
// 逐字符扫 `ch === '\n'` 数行号同理(CRLF 里 `\r` 不影响 `\n` 的计数)。
// 反过来 B1–B4 四种**内容相等**判定全都会被行尾改掉:`\r` 让空行判定恒假、
// 让两侧逐行比对恒不等、让整行定位恒不命中。**这才是真雷的充要形态**,
// 而把判据划在这条缝上正是「切窄了还够」的全部理由 —— REQ-202 记的那族红
// (检出为 CRLF × 判据用字面量 LF 锚点)机制上就是「内容级锚在 CRLF 下失配」这一种。
//
// 已知不覆盖(**登记,不隐藏**):
//   ① 正则以 `$` / `\z` 锚定单行(无 `m` 标志)时同样对行尾敏感,但「哪条正则带 `$`」不是
//     本门禁的判据面 —— 按正则逐条判会把它变成 lint 风格的全量规则集,且机械取不到
//     「该正则跑在裸 LF 切出的行上」。当前扫描面上这类用法经逐点核对均**无 `$` 锚**
//     (`check-import-boundary` 的 ROOT_COMPUTE_PATTERNS、`gate-index.test.js` 的顶层痕迹正则皆然)。
//   ② B 档查的是**同一个标识符**上的消费。多语句展开的 `forEach((line) => { if (line === '') … })`
//     不在 B1/B4 的形态里(只收单表达式回调),须靠 code review 与本门禁的诊断行一起看。
//   ③ C 档的数据流是**本文件内 + 一跳调用点**的近似,不是全程序分析:跨文件传参不会被追到。
//     本仓唯一跨文件传文本的那一处(`test/harness/eol.js` 的 `normalizeEol`)做的正是归一,
//     方向安全,漏追它不改变结论。已收的 C 档形态:赋值 / 链式读调用 / 形参 ← 同文件调用点 /
//     `function diskText(f) { return readFileSync(...) }` 的函数名 / 子进程 stdout·stderr。
//   ④ 扫描面含 `src/`,但 TS 侧读盘只有 `pipeline/precheck.ts` 的 exists 与
//     `pdf/katex-css.ts` 的 read 两处,均不做行锚判定;纳入扫描面是为了树边界变动时不被静默漏掉。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "../../shared/cli.mjs";
import { lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";

const USAGE = "用法: node gates/repo/check-eol-anchor.mjs [--help]";

/** 诊断片段上限(超长截断,避免刷屏) */
const SNIPPET_MAX = 96;

/**
 * 扫描面:仓相对 POSIX 顶层目录。
 *
 * 刻意**不登记文件清单**:清单会随新增文件静默过期,而过期方向是「少扫一个文件 ⇒ 少报一条雷」,
 * 与恒绿同族。目录级登记 + 递归遍历的失效方向是「多扫」,那只会多出一条待豁免,可被人看见。
 * @type {readonly string[]}
 */
export const SCAN_ROOTS = Object.freeze(["gates", "shared", "tools", "test", "src"]);

/** 扫描面内整棵跳过的目录名(生成物 / 安装树):它们的内容不由本仓源码决定。 */
export const SKIP_DIR_NAMES = Object.freeze(["node_modules", "dist", "output", "release", ".git"]);

/** 参与扫描的文件扩展名(闭合枚举:判据面之外的格式改不动本门禁的结论)。 */
export const CODE_EXTS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".cts", ".mts"]);

/**
 * A 档:裸 LF 分隔符的 split 形态。
 *
 * 捕获组 1 = 括号包裹的接收者(`(remainder + chunk).split('\n')` 那一族);
 * 捕获组 2 = 标识符 / 链式接收者;捕获组 3 = 引号。1 与 2 二选一才是 receiver。
 * ⚠ `/\r?\n/` 与 `'\r\n'` **刻意不进这张表** —— 那是已容错的形态,判红它只会逼人把
 * 正确的写法改回错的(见文件头「切窄」节)。
 * @type {RegExp}
 */
export const SPLIT_LF_RE =
  /(?:\(([^()]*)\)\s*)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*\([^()]*(?:\([^()]*\)[^()]*)*\))?)\s*\.\s*split\(\s*(['"])\\n\3\s*\)/g;

/** C 档:读文本原语。命中即「这个表达式带回的是盘上/子进程出来的文本」。 */
export const READ_TEXT_RE =
  /\b(?:readFileSync|readFile|readFileSyncUtf8)\s*\(|\bfsp\s*\.\s*readFile\s*\(|\bfs\s*\.\s*promises\s*\.\s*readFile\s*\(/;

/** C 档:子进程 stdout / stderr(与 readFile 同为「外部进来的文本」)。 */
export const STDOUT_TEXT_RE = /\.\s*(?:stdout|stderr)\b/;

/** D 档:EOL 归一原语的形态(含 `normalizeEol` 这个本仓已收口的归一函数名)。 */
export const NORMALIZE_RE = /normalizeEol|replace\(\s*\/\\r(?:\\n|\?\\n|)\/g/;

/** 赋值形态:`const|let|var` 可省(内层作用域的裸赋值也是赋值)。 */
const ASSIGN_RE = /\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;

/** return 形态:IO 壳最常见的写法是 `function diskText(f) { return readFileSync(...) }`。 */
const RETURN_RE = /\breturn\b([^;]*);/g;

/** for-of 形态:`for (const LINE of ARR)`。 */
const FOR_OF_RE = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+/g;

/** 函数签名两种形态:`function NAME(params)` 与 `NAME = (…) =>` / `NAME = function (…)`。 */
const FN_SIGNATURE_RES = Object.freeze([
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?\(([^()]*)\)/g,
]);

/**
 * @typedef {object} EolHit 一处行尾敏感锚点
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 裸 LF split 所在行号(1 起)
 * @property {string} receiver 接收者表达式原文
 * @property {string} consumption 命中的消费形态 id(`blank-line` / `elem-equal` / `line-locate` / `blank-filter`)
 * @property {number} consumeLine 消费点所在行号(1 起)
 * @property {string} consumeSource 消费点所在源码行
 * @property {string} splitSource split 所在源码行
 */

/**
 * 扫描面文件数下限(判据 1,防空门禁)。
 *
 * 只要求「足够大到不可能是塌缩」:walker 写坏 / 目录被搬走 / 扩展名枚举写错,都会让本族
 * 在零扫描面下「全绿」,而恒绿是纯文本门禁最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。
 * **刻意不取实测值**:那是随日常增删漂移的数,抄进来就多一处要人维护的常量。
 * @type {number}
 */
export const MIN_SCANNED_FILES = 200;

/**
 * 算每个 `{` 的配对 `}` 下标(一次线性扫描,不递归)。
 *
 * 为什么需要它:B/C 两档都限定「同一函数体内」,否则一个文件里任意两处同名的
 * `text` / `lines` 会被错配成一条数据流,而那种错配只会制造误报。**块字面量与控制流块
 * 也被算作作用域** —— 这是保守方向(区间更小 ⇒ 更容易判「不在同一作用域」⇒ 更少命中)。
 * @param {string} code 已抹注释的代码
 * @returns {Map<number, number>} `{` 下标 → 配对 `}` 下标
 */
export function bracePairs(code) {
  /** @type {Map<number, number>} */
  const pairs = new Map();
  /** @type {number[]} */
  const stack = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "{") stack.push(i);
    else if (code[i] === "}" && stack.length > 0) pairs.set(stack.pop() ?? 0, i);
  }
  return pairs;
}

/**
 * 取包含 `index` 的**最内层**作用域区间;`index` 不在任何块内则返回 null。
 * @param {Map<number, number>} pairs bracePairs 的产物
 * @param {number} index
 * @returns {{ start: number, end: number } | null}
 */
export function enclosingScope(pairs, index) {
  let best = null;
  for (const [open, close] of pairs) {
    if (open <= index && index <= close) {
      if (best === null || open > best.start) best = { start: open, end: close };
    }
  }
  return best;
}

/** 取表达式链上**最末**的标识符(`a.b.c` → `c`);带调用的返回 null(取值不可静态知)。 */
export function rootIdent(expression) {
  const trimmed = expression.trim();
  if (trimmed.includes("(")) return null;
  const parts = trimmed.split(".").map((part) => part.trim());
  const last = parts[parts.length - 1] ?? "";
  return /^[A-Za-z_$][\w$]*$/.test(last) ? last : null;
}

/**
 * 取表达式链上**最首**的标识符(`text.slice(0, off)` → `text`)。
 *
 * 与 {@link rootIdent} 互补:带调用的表达式链尾不是标识符(`off)`),但链首仍是,
 * 而 C 档追的正是「这个名字在本文件里是不是读来的文本」。
 * @param {string} expression
 * @returns {string | null}
 */
export function chainHeadIdent(expression) {
  const match = /^[A-Za-z_$][\w$]*|([A-Za-z_$][\w$]*)/.exec(expression.trim());
  const name = match?.[1] ?? match?.[0] ?? "";
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
}

/** 下标 → 行号(1 起)。`code` 与原文等长(lexSource 保证),故行号对得上原文。 */
export function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (code[i] === "\n") line += 1;
  return line;
}

/** 形参表拆分:`(a, { b }, c = 1)` → `['a', 'b', 'c']`。 */
function paramNames(source) {
  return source
    .split(",")
    .map((part) => part.trim().split(/[:=]/)[0]?.trim() ?? "")
    .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
}

/**
 * 本文件内定义的函数、其形参表与函数体区间。
 *
 * 体区间取「签名的 `)` 之后第一个 `{` 的配对 `}`」—— 这一格是 C 档**读原语形如 return**
 * 那一支的前提:没有体区间就分不清 `return readFileSync(...)` 属于哪个函数,
 * 而本仓的 IO 壳(`readHostFiles` / `diskText` / `analyze`)全是这个写法。
 * @param {string} code 已抹注释的代码
 * @param {Map<number, number>} [pairs] bracePairs 的产物(传了就据此定体区间)
 * @returns {{ name: string, params: string[], body: { start: number, end: number } | null }[]}
 */
export function functionSignatures(code, pairs = null) {
  const resolved = pairs ?? bracePairs(code);
  /** @type {{ name: string, params: string[], body: { start: number, end: number } | null }[]} */
  const out = [];
  for (const re of FN_SIGNATURE_RES) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) {
      const open = code.indexOf("{", (m.index ?? 0) + m[0].length);
      out.push({
        name: m[1] ?? "",
        params: paramNames(m[2] ?? ""),
        body: open === -1 ? null : { start: open, end: resolved.get(open) ?? open },
      });
    }
  }
  return out;
}

/**
 * C 档:某标识符在本文件内是否可追到读文本原语。
 *
 * 追链到不动点(`NAME = <含读原语的表达式>` 或 `NAME = <另一个已追到的标识符>`),
 * 故互相赋值的环也能收敛(先占位再递归)。**跨文件传参不追** —— 追了就得全程序分析,
 * 而本仓唯一跨文件传文本的那一处做的是归一,方向安全。
 * @param {string} code 已抹注释的代码
 * @param {string} name 待追的标识符
 * @param {Map<string, boolean>} cache 追链记忆(同一文件里同名标识符只有一份结论)
 * @returns {boolean}
 */
export function isReadDerived(code, name, cache, signatures = []) {
  const memo = cache.get(name);
  if (memo !== undefined) return memo;
  cache.set(name, false); // 占位:互相赋值时不无限递归
  let result = false;
  ASSIGN_RE.lastIndex = 0;
  for (const m of code.matchAll(ASSIGN_RE)) {
    if (m[1] !== name) continue;
    const rhs = m[2] ?? "";
    if (READ_TEXT_RE.test(rhs) || STDOUT_TEXT_RE.test(rhs)) {
      result = true;
      break;
    }
    for (const alias of rhs.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (alias !== name && isReadDerived(code, alias, cache, signatures)) {
        result = true;
        break;
      }
    }
    if (result) break;
  }
  // `function diskText(f) { return readFileSync(...) }` —— 函数名本身即读派生
  if (!result) {
    for (const signature of signatures) {
      if (signature.name !== name || signature.body === null) continue;
      const body = code.slice(signature.body.start, signature.body.end + 1);
      RETURN_RE.lastIndex = 0;
      for (const m of body.matchAll(RETURN_RE)) {
        const rhs = m[1] ?? "";
        if (READ_TEXT_RE.test(rhs) || STDOUT_TEXT_RE.test(rhs)) {
          result = true;
          break;
        }
        for (const alias of rhs.match(/[A-Za-z_$][\w$]*/g) ?? []) {
          if (alias !== name && isReadDerived(code, alias, cache, signatures)) {
            result = true;
            break;
          }
        }
        if (result) break;
      }
      if (result) break;
    }
  }
  cache.set(name, result);
  return result;
}

/**
 * C 档一跳:形参收到读文本。
 *
 * 命中的是「本文件定义、本文件调用」的函数 —— 形如 `function judge(text) { text.split('\n') }`
 * 配 `judge(readFileSync(p, 'utf8'))`,这正是本仓「判定本体与 IO 壳分离」的通用形态;
 * 不追它,`check-changelog.mjs` 的 `judgeChangelog(text)` 那处就看不见。
 * @param {string} code 已抹注释的代码
 * @param {string} name 形参名
 * @param {{ name: string, params: string[] }[]} signatures 本文件内的函数签名
 * @returns {boolean}
 */
export function isReadDerivedParam(code, name, signatures) {
  for (const signature of signatures) {
    if (!signature.params.includes(name)) continue;
    const callRe = new RegExp(
      String.raw`\b` + signature.name.replace(/\$/g, "\\$") + String.raw`\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)`,
      "g",
    );
    for (const call of code.matchAll(callRe)) {
      const args = call[1] ?? "";
      if (READ_TEXT_RE.test(args) || STDOUT_TEXT_RE.test(args)) return true;
    }
  }
  return false;
}

/**
 * D 档:该接收者(或其别名链)是否经过 EOL 归一。
 *
 * 只看**同名标识符**上的归一 —— 「文件别处有归一」不算数,那会把
 * 「一处归一了、另一处没归一」整个放过,而后者正是真雷。
 * @param {string} code 已抹注释的代码
 * @param {string} name 接收者标识符
 * @returns {boolean}
 */
export function isNormalized(code, name, seen = new Set()) {
  if (seen.has(name)) return false; // 互相赋值的环:第二次到达即停(与 isReadDerived 的占位同理)
  seen.add(name);
  ASSIGN_RE.lastIndex = 0;
  for (const m of code.matchAll(ASSIGN_RE)) {
    if (m[1] !== name) continue;
    const rhs = m[2] ?? "";
    if (NORMALIZE_RE.test(rhs)) return true;
    for (const alias of rhs.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (alias !== name && isNormalized(code, alias, seen)) return true;
    }
  }
  return false;
}

/**
 * B 档:在同一作用域内找该行数组的**内容级消费**。
 *
 * 查找一律限定在 split 所在的最内层块内(理由见 {@link enclosingScope})。
 * @param {string} code 已抹注释的代码
 * @param {{ start: number, end: number } | null} scope split 所在作用域
 * @param {string} arrayVar split 结果被赋到的变量名;null = 链式用法
 * @param {readonly string[]} elementVars 该行数组的**元素变量**别名集合(元素循环变量、
 *   `const line = lines[i]`、数组解构);null/空 = 无
 * @param {number} splitEnd split 表达式结束下标
 * @returns {{ id: string, index: number }[]} 命中的消费形态
 */
export function findContentConsumption(code, scope, arrayVar, elementVars, splitEnd) {
  /** @type {{ id: string, index: number }[]} */
  const hits = [];
  const bare = findContentConsumptionHere(code, scope, arrayVar, elementVars, splitEnd);
  hits.push(...bare);
  if (arrayVar === null) return hits;
  // B 档一跳:行数组被**本文件定义的函数**按形参接走(判定本体与 IO 壳分离的通行写法:
  // `judgeChangelog(text)` 里 `const lines = text.split('\n')`,真正的判定在
  // `scanLines(lines, startLine)` 里)。不追这一跳,本仓最通行的那种写法整族漏判。
  // 只追**本文件内定义且本文件内调用**的函数 —— 跨文件传参属 C 档已声明的近似边界。
  for (const signature of functionSignatures(code)) {
    if (!signature.params.includes(arrayVar)) continue;
    if (!new RegExp(String.raw`\b` + signature.name + String.raw`\s*\(`).test(code)) continue;
    const bodyStart = code.indexOf("{", code.indexOf(signature.name));
    if (bodyStart === -1) continue;
    const bodyEnd = enclosingScope(bracePairs(code), bodyStart)?.end ?? -1;
    if (bodyEnd === -1) continue;
    const inner = collectElementAliases(code, { start: bodyStart, end: bodyEnd }, arrayVar);
    hits.push(...findContentConsumptionHere(code, { start: bodyStart, end: bodyEnd }, arrayVar, inner, -1));
  }
  // 同一处 split 命中同一种消费形态多次时只留第一条(诊断噪声,不是新事实)
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.id}:${hit.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * B 档的**本作用域内**查找(不含一跳)。`findContentConsumption` 拆成本函数 + 一跳两层,
 * 是为了让「同作用域」与「一跳」两条路径复用同一批正则 —— 两条路径的正则若各写一份,
 * 漂移方向是「一跳那条悄悄漏判」,而那正是本门禁最实的一族。
 * @param {string} code
 * @param {{ start: number, end: number } | null} scope
 * @param {string} arrayVar
 * @param {readonly string[]} elementVars
 * @param {number} splitEnd
 * @returns {{ id: string, index: number }[]}
 */
export function findContentConsumptionHere(code, scope, arrayVar, elementVars, splitEnd) {
  /** @type {{ id: string, index: number }[]} */
  const hits = [];
  const elements = new Set(elementVars);
  const region = scope === null ? code : code.slice(scope.start, scope.end + 1);
  const shift = scope === null ? 0 : scope.start;
  const at = (/** @type {number} */ local) => shift + local;
  const isTracked = (/** @type {string} */ name) =>
    name === arrayVar || elements.has(name);

  // B1 空行判定:`X === ''` / `X !== ''`。X 可以是行数组变量、元素变量别名,
  // 或链式用法里紧跟 split 的那一个(判定点与 split 同行/近邻)。
  const blankRe = /\b([A-Za-z_$][\w$]*)(?:\s*\[[^\]]*\])?\s*(?:===|!==)\s*(?:''|"")/g;
  for (const m of region.matchAll(blankRe)) {
    const name = m[1] ?? "";
    const index = at(m.index ?? 0);
    if (isTracked(name)) hits.push({ id: "blank-line", index });
    else if (
      arrayVar === null
      && elements.size === 0
      && index >= splitEnd
      && index - splitEnd < SNIPPET_MAX
      && region.slice(0, m.index ?? 0).includes(".split(")
    ) {
      hits.push({ id: "blank-line", index });
    }
  }

  // B2 逐元素等值:`A[i] === B[i]` / `!==`。任一侧是本行数组即命中 ——
  // 「哪一行不同」的漂移比对正是这个形态,而它两侧**只可能有一侧**归一(实测
  // `gen-archive-index` / `gen-fixtures` 都是两侧都归一才对)。
  const elemEqRe = /\b([A-Za-z_$][\w$]*)\s*\[[^\]]*\]\s*(?:===|!==)\s*([A-Za-z_$][\w$]*)\s*\[[^\]]*\]/g;
  for (const m of region.matchAll(elemEqRe)) {
    if (isTracked(m[1] ?? "") || isTracked(m[2] ?? "")) {
      hits.push({ id: "elem-equal", index: at(m.index ?? 0) });
    }
  }

  // B3 整行定位:`ARR.indexOf(<字面量>)` / `ARR.includes(<字面量>)`,
  // 以及链式形态 `X.split('\n').indexOf('…')`(判定点紧跟 split)。
  const locateRe = /\b([A-Za-z_$][\w$]*)?\s*(?:\.split\(\s*(['"])\\n\2\s*\)\s*)?\.\s*(?:indexOf|includes)\(\s*(['"])[^'"\n]+?\3\s*\)/g;
  for (const m of region.matchAll(locateRe)) {
    const name = m[1] ?? "";
    const index = at(m.index ?? 0);
    if (arrayVar !== null && name === arrayVar) hits.push({ id: "line-locate", index });
    else if (m[2] !== undefined) hits.push({ id: "line-locate", index });
  }

  // B4 空行过滤:`ARR.filter((X) => X === '')` 那一支(单表达式回调)。
  const filterRe =
    /\b([A-Za-z_$][\w$]*)?\s*(?:\.split\(\s*(['"])\\n\2\s*\)\s*)?\.\s*(?:filter|find|some|every|map)\s*\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\3\s*(?:===|!==)\s*(?:''|"")/g;
  for (const m of region.matchAll(filterRe)) {
    const name = m[1] ?? "";
    if (arrayVar !== null && name === arrayVar) hits.push({ id: "blank-filter", index: at(m.index ?? 0) });
    else if (m[2] !== undefined) hits.push({ id: "blank-filter", index: at(m.index ?? 0) });
  }
  return hits;
}

/**
 * 收该行数组的**元素变量别名**:元素循环变量 · `const line = lines[i]` · 数组解构。
 *
 * 为什么必须收:本仓判定本体的通行写法是
 * `const lineSource = lines[i] ?? '';` 紧接 `if (lineSource === '') continue;`
 * —— 判定点那个标识符**不是**行数组本身。只认数组变量的话,这一族全部漏判,
 * 而它恰好是本门禁要抓的最实形态(空行判定在 CRLF 下恒假)。
 *
 * ⚠ **别名只认「纯下标取值」**:`const line = raw.trim()` 不算 —— `.trim()` 吃掉
 * 行尾的 `\r`,之后的 `line === ''` 是**成立**的判据(探针 `probe-trim-kills-cr-is-not-a-mine`
 * 钉住这条边界)。把它也当别名,repo-manifest 读 `.gitignore` 的那处会假红。
 * @param {string} code 已抹注释的代码
 * @param {{ start: number, end: number } | null} scope split 所在作用域
 * @param {string} arrayVar 行数组变量名
 * @returns {string[]} 别名集合
 */
export function collectElementAliases(code, scope, arrayVar) {
  if (arrayVar === null) return [];
  const region = scope === null ? code : code.slice(scope.start, scope.end + 1);
  /** @type {string[]} */
  const names = [];
  const patterns = [
    new RegExp(String.raw`\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+` + arrayVar + String.raw`\b`, "g"),
    new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*` + arrayVar + String.raw`\s*\[`, "g"),
    new RegExp(String.raw`\[\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*` + arrayVar + String.raw`\b`, "g"),
  ];
  for (const pattern of patterns) {
    for (const m of region.matchAll(pattern)) if (m[1] !== undefined) names.push(m[1]);
  }
  return names;
}

/**
 * 判定本体(纯函数:只吃源码文本,不做任何 IO)。
 *
 * 纯函数是 selftest 能对它做**真变异**的前提 —— 变异体与真实仓库走同一条判定路径;
 * 若它改跑 IO 壳,验的就不是真规则(与 check-changelog / check-samples 同一纪律)。
 * @param {string} text 源码文本
 * @param {string} rel 仅用于回填的仓库相对路径
 * @returns {EolHit[]}
 */
export function judgeText(text, rel = "<probe>") {
  const code = lexSource(text).code;
  const pairs = bracePairs(code);
  const signatures = functionSignatures(code, pairs);
  const derivedCache = new Map();
  const rawLines = text.split(/\r?\n/);
  /** @type {EolHit[]} */
  const hits = [];

  SPLIT_LF_RE.lastIndex = 0;
  for (const m of code.matchAll(SPLIT_LF_RE)) {
    // 捕获组 1 = 括号包裹的接收者(`(remainder + chunk).split('\n')` 那一族);
    // 捕获组 2 = 标识符/链式接收者;两者取其一作为 receiver。
    const receiver = (m[1] !== undefined ? m[1] : m[2] ?? "").trim();
    const splitIndex = m.index ?? 0;
    const splitEnd = splitIndex + m[0].length;
    // C 档要追的名字:优先链尾(`a.b.c` → `c`),链尾取不到(带调用)则退到链首
    // (`text.slice(0, off)` → `text`) —— 两种形态在本仓都真实存在。
    const root = rootIdent(receiver) ?? chainHeadIdent(receiver);

    // C 档:接收者必须能追到读文本。链上带调用的(`readFileSync(p, 'utf8')`)直接算来源。
    let derived = READ_TEXT_RE.test(receiver) || STDOUT_TEXT_RE.test(receiver);
    if (!derived && root !== null) {
      derived = isReadDerived(code, root, derivedCache, signatures)
        || isReadDerivedParam(code, root, signatures);
    }
    if (!derived) continue;

    // D 档:归一过的放过。两条判据缺一不可 ——
    //   ① 接收者表达式**本身**就是归一结果(`normalizeEol(x).split('\n')` / `x.replace(/\r\n/g,'\n').split('\n')`);
    //   ② 接收者是标识符,它的赋值链上有归一(`const text = normalizeEol(raw); … text.split('\n')`)。
    // 只留 ① 会把本仓最通行的归一写法整族漏判;只留 ② 会把归一**调用点**那一族漏判
    // (自检档 `probe-normalized-is-safe` 守的就是后者 —— 它在 ① 补上之前是靠
    // 「normalizeEol 不是读派生标识符」歪打正着通过的,那不是保护)。
    if (NORMALIZE_RE.test(receiver)) continue;
    if (root !== null && isNormalized(code, root)) continue;

    // 该 split 的结果被赋给了谁 / 它的元素被谁接住(都限定在同一作用域内)
    const scope = enclosingScope(pairs, splitIndex);
    const before = code.slice(scope === null ? 0 : scope.start, splitIndex);
    const arrayVar = /([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(before)?.[1] ?? null;
    /** @type {string[]} */
    const elementVars = [];
    FOR_OF_RE.lastIndex = 0;
    for (const forOf of before.matchAll(FOR_OF_RE)) elementVars.push(forOf[1] ?? "");
    elementVars.push(...collectElementAliases(code, scope, arrayVar));

    for (const consume of findContentConsumption(code, scope, arrayVar, elementVars, splitEnd)) {
      const splitLine = lineOf(code, splitIndex);
      const consumeLine = lineOf(code, consume.index);
      hits.push({
        file: rel,
        line: splitLine,
        receiver,
        consumption: consume.id,
        consumeLine,
        consumeSource: (rawLines[consumeLine - 1] ?? "").trim(),
        splitSource: (rawLines[splitLine - 1] ?? "").trim(),
      });
    }
  }
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.line}:${hit.receiver}:${hit.consumption}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 豁免登记表:**默认值是判红**,每一处「不是雷」都必须在此写明理由。
 *
 * 形态照 check-temp-cleanup / check-copy-sites:按**内容**匹配(文件 × 消费形态 × 片段),
 * **不按行号** —— 行号随他处增删漂移,按行号登记的条目会静默变成「放行别的东西」。
 * `cold: true` = 按设计零命中(登记它是为了把「为什么这里不能改」钉进门禁,防止有人
 * 按「看起来是重复」把它清掉),零命中时输出里与实命中分开计数。
 *
 * ⚠ **豁免不是「放过」而是「把已知的雷钉在册」**:真雷当前不判红,是因为收口它分属别的
 * 工作线;每条都写明「为什么现在不判红」与「它什么时候会变成真事故」。豁免表本身进 diff,
 * 被人看见 —— 与门禁输出里的 `[info] …本次零命中(可能已失效,请复核是否可删)` 配对:
 * 条目一旦不再命中,要么是雷被收了(该删),要么是判据漂了(该查),两个方向都有人管。
 * @typedef {object} EolExemption
 * @property {string} id 条目 id(失效提示里点名用)
 * @property {string} file 生效文件(仓相对 POSIX)
 * @property {string} consumption 命中的消费形态 id
 * @property {string} contains 片段:命中行的原文须含它(避免整文件放行)
 * @property {string} why 为什么这不是雷 / 为什么当前不判红
 * @property {boolean} [cold] true = 按设计零命中
 */

/** @type {readonly EolExemption[]} */
export const EXEMPTIONS = Object.freeze([
  Object.freeze({
    id: "changelog-blank-line-skip-dead-under-crlf",
    file: "gates/repo/check-changelog.mjs",
    consumption: "blank-line",
    contains: "if (lineSource === '') continue;",
    // ⚠ **这一条是真雷,不是误报**:CRLF 检出下 `text.split('\n')` 切出的每一行尾部挂 `\r`,
    // 于是该行的空行判定恒假 —— `scanLines` 不再跳过空行。这与 REQ-202 记的那族同源。
    //
    // **为什么当前不判红**(三条都是实测,不是推断):
    //   ① 条目区定位不受影响:`ANCHOR_RE` / `VERSION_HEADING_RE` 写成 `/^##[ \t]*\[/`,
    //      **无 `$` 锚**,CRLF 下照样命中(本机实测:同一份 CHANGELOG 分别喂 LF 与 CRLF,
    //      `judgeChangelog` 的 region 逐项相同 —— startLine / versionHeadings / nonEmpty 全等)。
    //   ② `nonEmpty` 统计走 `.trim()`(`:469`),`.trim()` 吃掉行尾的 `\r` ⇒ 数字正确。
    //   ③ 失效后多扫的那些「行」在 CRLF 下就是单个 `\r`,`RULES` 里没有任何词形能匹配它
    //      ⇒ problems 数不变(实测 LF / CRLF 均为 0 项)。
    //
    // **什么时候会变成真事故**(三条任一成立即失效):
    //   ① `RULES` 里任何一条正则加上 `$` 锚(无 `m` 标志)—— 那时 CRLF 下全部词形失配;
    //   ② CHANGELOG 里出现能被「空行形态」触发的词形;
    //   ③ 有人把 `:522` 的跳过当作性能或正确性前提(例如给 scanLines 加计数断言)。
    //
    // **为什么现在不收口**:正路是在 `analyze()` 的读入侧归一,而 EOL 归一原语的收口**跨树**
    // —— `shared/` 零跨树出边,承载不了 `gates/` 的调用,那是另一条工作线;本工作项只做检测。
    why:
      "真雷形态(CRLF 下空行判定恒假),当前不改判红是因为实测不影响判定结论:"
      + "region 定位的两条正则无 `$` 锚、nonEmpty 走 `.trim()`、多扫的空行在 CRLF 下是单个 `\\r` "
      + "不匹配任何词形。失效条件与收口路径见本条注释。",
  }),
]);

/**
 * 判据 0(防空门禁):内建正面锚点。
 *
 * 规则写错的表现是**恒绿** —— 没人会去看一个总是 exit 0 的脚本。故这里冻结几段
 * 「必须命中 / 必须零命中」的源码形态,用同一套判定器跑一遍:探针不过即 exit 1,
 * 因为探针坏了之后全部扫描结论都不可信。
 *
 * ⚠ **锚点是判据的一部分,不是它的装饰**:`receiver` 用 `fs.readFileSync(...)` 链式形态
 * (C 档一步命中),`text` 形参形态走 C 档的一跳回溯 —— 两档各有一条锚,少一条即等于
 * 那一档退化成恒不命中。
 * @type {readonly { id: string; expectHit: boolean; code: string }[]}
 */
export const SELF_PROBE = Object.freeze([
  {
    id: "probe-blank-line-on-read-text",
    expectHit: true,
    code: [
      "export function judge(text) {",
      "  const lines = text.split('\\n');",
      "  for (let i = 0; i < lines.length; i += 1) {",
      "    if (lines[i] === '') continue;",
      "  }",
      "}",
      "export function analyze() {",
      "  return judge(readFileSync('docs/CHANGELOG.md', 'utf8'));",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-elem-equal-drift",
    expectHit: true,
    code: [
      "export function diff(diskText, wantText) {",
      "  const a = diskText.split('\\n');",
      "  const b = wantText.split('\\n');",
      "  return a[0] !== b[0];",
      "}",
      "export function run(indexText, want) {",
      "  return diff(readFileSync(indexText, 'utf8'), want);",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-locate-whole-line",
    expectHit: true,
    code: [
      "export function at(text) {",
      "  const lines = text.split('\\n');",
      "  return lines.indexOf('| REQ-002 |');",
      "}",
      "export function locate(file) {",
      "  return at(readFileSync(file, 'utf8'));",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-chain-read-file-sync",
    expectHit: true,
    code: [
      "export function pick(file) {",
      "  const line = fs.readFileSync(file, 'utf8').split('\\n')[3];",
      "  return line === '';",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-anchored-to-param-call",
    expectHit: true,
    code: [
      "export function judgeChangelog(text) {",
      "  const lines = text.split('\\n');",
      "  return lines.indexOf('## [待发版]');",
      "}",
      "export function analyze() {",
      "  return judgeChangelog(readFileSync(CHANGELOG_REL, 'utf8'));",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-stdout-source",
    expectHit: true,
    code: [
      "export function firstLogLine(result) {",
      "  const lines = result.stdout.split('\\n');",
      "  return lines.indexOf('步骤 1/3');",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-blank-filter-callback",
    expectHit: true,
    code: [
      "export function blanks(file) {",
      "  const lines = readFileSync(file, 'utf8').split('\\n');",
      "  return lines.filter((line) => line === '').length;",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-count-only-is-safe",
    expectHit: false,
    // 计数 / 行号换算:CRLF 与 LF 下行数相同,不是雷。这条是判据窄度的反向锚点 ——
    // 删掉它则「计数类不判」这条边界无人守,判据会悄悄放宽成「见 split 就红」。
    code: [
      "export function lineNo(text, off) {",
      "  return text.slice(0, off).split('\\n').length;",
      "}",
      "export function scan(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  const lines = text.split('\\n');",
      "  for (let i = 0; i < lines.length; i += 1) record(i);",
      "  return lines.length;",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-char-scan-counting-is-safe",
    expectHit: false,
    // 逐字符扫 `ch === '\n'` 数行号:CRLF 里 `\r` 不影响 `\n` 的计数 ⇒ 同解,不是雷。
    // 这条同时钉住「A 档不收 `(===|!==) '\\n'`」这条边界。
    code: [
      "export function lineStarts(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  const starts = [0];",
      "  for (let k = 0; k < text.length; k += 1) {",
      "    if (text[k] === '\\n') starts.push(k + 1);",
      "  }",
      "  return starts;",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-tolerated-split-is-safe",
    expectHit: false,
    // `/\r?\n/` 与 `'\r\n'` 是已容错形态,判红它只会逼人把对的写法改回错的
    code: [
      "export function blankLines(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  const lines = text.split(/\\r?\\n/);",
      "  return lines.filter((line) => line === '').length;",
      "}",
      "export function crlf(file) {",
      "  return readFileSync(file, 'utf8').split('\\r\\n')[0];",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-normalized-is-safe",
    expectHit: false,
    // ⚠ 这一条必须**两半都在**:① 归一写在赋值上(D 档第二支:`const text = readFileSync(...).replace(/\r\n/g,'\n')`),
    //   ② 归一写在接收者表达式上(D 档第一支:`normalizeEol(x).split('\n')`)。
    //   少任何一半,本档在「归一恰好坏掉」时会靠另一条无关理由歪打正着通过 ——
    //   那样它守的就不是 D 档,而自检档一旦守错了档,它的存在反而会掩盖真正的退化。
    code: [
      "export function blankCount(file) {",
      "  const text = readFileSync(file, 'utf8').replace(/\\r\\n/g, '\\n');",
      "  const lines = text.split('\\n');",
      "  return lines.filter((line) => line === '').length;",
      "}",
      "export function drift(indexText, want) {",
      "  const a = normalizeEol(indexText).split('\\n');",
      "  const b = normalizeEol(want).split('\\n');",
      "  return a[0] !== b[0];",
      "}",
      "export function run(indexText, want) {",
      "  return drift(readFileSync(indexText, 'utf8'), want);",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-in-memory-string-is-not-read-derived",
    expectHit: false,
    // 合成字符串 / 内存拼接:不经盘,行尾不由 autocrlf 决定 ⇒ 不判
    code: [
      "export function synth(name) {",
      "  const lines = `| ${name} |`.split('\\n');",
      "  return lines[0] === '';",
      "}",
    ].join("\n"),
  },
  {
    id: "probe-trim-kills-cr-is-not-a-mine",
    expectHit: false,
    // `.trim()` 吃掉行尾的 `\r` ⇒ 空行判定成立。这条守住「消费点不被误认」:
    // 若判定退化成「见到 `=== ''` 就红」,repo-manifest 的 `.trim()` 写法会假红。
    code: [
      "export function ignores(file) {",
      "  const text = readFileSync(file, 'utf8');",
      "  for (const raw of text.split('\\n')) {",
      "    const line = raw.trim();",
      "    if (line === '') continue;",
      "  }",
      "}",
    ].join("\n"),
  },
]);

/**
 * 自检探针:断言每条锚点的期望方向成立。
 * @returns {{ id: string, ok: boolean, detail: string }[]}
 */
export function runSelfProbe() {
  return SELF_PROBE.map((probe) => {
    const hits = judgeText(probe.code, probe.id);
    const ok = probe.expectHit ? hits.length > 0 : hits.length === 0;
    return {
      id: probe.id,
      ok,
      detail:
        `期望${probe.expectHit ? "命中" : "零命中"},实得 ${hits.length} 处`
        + (hits.length > 0 ? `(${hits.map((hit) => hit.consumption).join(",")})` : ""),
    };
  });
}

/**
 * 递归列出扫描面内的代码文件(仓相对 POSIX,已排序)。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]}
 */
export function listScanFiles(root) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ rel) => {
    const abs = path.join(root, ...rel.split("/"));
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (SKIP_DIR_NAMES.includes(entry.name)) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else if (CODE_EXTS.includes(path.extname(entry.name))) files.push(childRel);
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(root, ...scanRoot.split("/"));
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(scanRoot);
  }
  return files.sort();
}

/**
 * 全树判定。`base.root` 只为夹具而存在(selftest 在临时目录里逐点调用本函数)。
 * @param {{ root?: string }} [base] 注入面(目前只有根)
 * @returns {{ problems: EolHit[], allowHits: number, allowCold: number,
 *   staleAllow: string[], files: number, splits: number }}
 */
export function analyze(base = {}) {
  const root = base.root ?? ROOT;
  const files = listScanFiles(root);
  /** @type {EolHit[]} */
  const problems = [];
  const allowUsed = new Set();
  let splits = 0;

  for (const rel of files) {
    const text = readFileSync(path.join(root, ...rel.split("/")), "utf8");
    // 计数走**抹注释后**的文本:注释里写的 `split('\n')` 是文档,不是代码。
    // 计数只进输出不参与判定,但它一旦把文档算进去,读者就会拿它当分母用。
    SPLIT_LF_RE.lastIndex = 0;
    splits += [...lexSource(text).code.matchAll(SPLIT_LF_RE)].length;
    for (const hit of judgeText(text, rel)) {
      const index = EXEMPTIONS.findIndex(
        (entry) =>
          entry.file === hit.file
          && entry.consumption === hit.consumption
          && hit.consumeSource.includes(entry.contains),
      );
      if (index !== -1) {
        allowUsed.add(index);
        continue;
      }
      problems.push(hit);
    }
  }

  return {
    problems,
    allowHits: allowUsed.size,
    allowCold: EXEMPTIONS.filter((entry) => entry.cold === true).length,
    staleAllow: EXEMPTIONS.filter(
      (entry, index) => entry.cold !== true && !allowUsed.has(index),
    ).map((entry) => entry.id),
    files: files.length,
    splits,
  };
}

/** 诊断片段:压掉多余空白,超长截断 */
function snippet(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 门禁入口。
 * @param {string[]} [argv]
 * @param {{ root?: string }} [base]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = [], base = {}) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => !arg.startsWith("--"));
  if (unknown.length > 0) {
    console.error(`[eol-anchor:fail] 无法识别的参数:${unknown.join(" ")}(${USAGE})`);
    return 1;
  }

  // 判据 0 的探针必须先跑:探针坏了,后面的扫描结论全部不可信
  const probe = runSelfProbe();
  for (const item of probe) {
    console.error(`[eol-anchor:self-probe:${item.ok ? "ok" : "fail"}] ${item.id}:${item.detail}`);
  }
  if (probe.some((item) => !item.ok)) {
    console.error("[eol-anchor:fail] 内建探针未通过:判定规则与声明的高危形态不符,此时的扫描结果不可信");
    return 1;
  }

  let result;
  try {
    result = analyze(base);
  } catch (error) {
    console.error(`[eol-anchor:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // 判据 1:扫描面塌缩下限
  if (result.files < MIN_SCANNED_FILES) {
    console.error(
      `[eol-anchor:fail] 扫描面塌缩:只扫到 ${result.files} 个文件,低于下限 ${MIN_SCANNED_FILES}`
        + "(目录被搬走或 SCAN_ROOTS/CODE_EXTS 写坏时会出现;此时本门禁恒绿,等于不存在)",
    );
    return 1;
  }

  for (const id of result.staleAllow) {
    console.log(`[info] eol-anchor:豁免条目本次零命中(可能已失效,请复核是否可删):${id}`);
  }

  if (result.problems.length > 0) {
    for (const hit of result.problems) {
      console.error(
        `[eol-anchor:fail] ${hit.file}:${hit.line} → ${hit.receiver}.split('\\n') 的结果被`
          + `${hit.consumption} 内容级消费(判定点 ${hit.file}:${hit.consumeLine}):`
          + snippet(hit.consumeSource),
      );
    }
    console.error(
      `[eol-anchor:fail] 行尾敏感锚点扫描失败,共 ${result.problems.length} 项`
        + `(扫描 ${result.files} 个文件 / ${result.splits} 处裸 LF split;`
        + `豁免 ${EXEMPTIONS.length} 条,本次命中 ${result.allowHits} 条,按设计零命中 ${result.allowCold} 条)`,
    );
    console.error(
      "[eol-anchor:fail] 检出态行尾由各端 autocrlf 决定(CI 的 Windows runner 检出即 CRLF),"
        + "而 `split('\\n')` 切出的每一行在 CRLF 下尾部挂一个 `\\r`:空行判定恒假、"
        + "两侧逐行比对恒不等、整行定位恒不命中。**修法不是把 `\\n` 改成 `\\r?\\n`** —— "
        + "那只改这一处判定,下一处读文本的地方照样中招;正路是**在读入侧归一**"
        + "(`.replace(/\\r\\n/g, '\\n')`,或复用已收口的 `test/harness/eol.js` 的 normalizeEol)。"
        + "确属已容错 / 合成字符串等非雷形态,在 gates/repo/check-eol-anchor.mjs 的 EXEMPTIONS "
        + "加条目并写明依据(按内容匹配,勿按行号登记 —— 行号会随他处改动漂移)。",
    );
    return 1;
  }

  console.log(
    `[ok] 行尾敏感锚点扫描通过:扫描 ${result.files} 个文件 / ${result.splits} 处裸 LF split,`
      + `无未归一的内容级消费;豁免 ${EXEMPTIONS.length} 条(本次命中 ${result.allowHits} 条,`
      + `按设计零命中 ${result.allowCold} 条);内建探针 ${probe.length} 条全过`,
  );
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}