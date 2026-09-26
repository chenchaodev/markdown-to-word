// 测试树规划编号扫描门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// 守护的契约(AGENTS.md「规划编号不进交付物」):候选区编号 B1–B11 是规划内部用语,
// 晋升为描述性功能名(如「成书向导」)之前不得进入交付物。测试树是交付物的一部分,而
// 规划编号最先泄漏的地方恰恰是测试:`throw new Error("B3 断言失败:…")` 这类断言消息
// 既好写又不会被用户看见,于是编号在测试树里长驻,后来者在测试里读到的就是「B3」而
// 不知道它对应哪个功能。本门禁在提交之前把这类字面量挡下。
//
// 判定输入是**文件文本**而非测试执行结果:门禁要在 tsc/测试之前跑,且要在「有人新写了
// 一条带编号的断言消息」的最早时刻就红。正则 + 手写词法状态机,理由同
// check-import-boundary.mjs / check-ci-contract.mjs(纯 Node、零新增依赖)。
//
// 用法:
//   node scripts/check-test-numbering.mjs
//   node scripts/check-test-numbering.mjs --help
//
// ---- 扫描面(与测试发现面一致,不多不少)----
//   test/segments/**/*.test.js · test/main/**/*.test.js · test/renderer/**/*.test.js
//   test/common/**/*.js · test/tools/**/*.{js,mjs}
// 排除 test/pending(阶段 3 历史副本区,故意不参与测试发现,见
// test/segments/tscheck-coverage.test.js:24 的 EXEMPT_DIRS)与 test/fixtures(被测样例
// 数据本身,不是断言)。排除写成显式清单:将来有人把扫描面扩到整个 test/ 时,这两个
// 目录必须仍然在外,而不是靠「它们恰好不在目标里」蒙对。
//
// ---- 匹配规则:只在字符串字面量内部命中 ----
// 字母表:\b(?:B1[0-3]|B[1-9]|F[1-9]|C[1-4]|D-\d{2}|OPT-\d+(?:\.\d+)?|D[1-5])\b
// 三条设计约束(均为实测结论,改字母表前先重跑 `node scripts/check-test-numbering.mjs`
// 看误报面,别凭直觉放宽):
//   1. **故意不含 A 族**:A3/A4/A5/A6 是纸张规格、A1/A8 是预设名/纸张规格,全库 76 处
//      误报全靠这一条天然排除。字母表一旦「为省事」加上 A 族,误报面立刻翻十几倍。
//   2. **文件维度不可用**:test/main/settings.test.js 同时含 4 处 `B5`(纸型)与 7 处
//      真编号,按文件放行会漏掉真编号,按文件判红会误伤纸型。
//   3. **位置规则不可用**:58 处编号出现在 `throw` 消息里且没有冒号前缀(如
//      `"B3 断言失败:…"`),按「冒号前缀/消息模板」定位会漏掉它们。故只剩
//      「字母表 + 白名单」这一条路。
// 词法判定只需「是否在字符串字面量内」这一条:注释里的场景标签本就不该报
// (cross-ref.test.js 的 `B1`–`B5` 场景标签在注释里,见 ALLOWLIST 条目)。
// 已知边界:正则字面量按「前一个 token 决定是除号还是正则」的启发式识别,误判为正则
// 会漏扫其后的一批字符串(漏报方向安全,不会凭空多报)。
//
// ---- 白名单会腐烂 ----
// 白名单按**内容**匹配(文件 × 字面量内容),**不按行号**:测试树在并发改动,行号会漂移,
// 按行号登记的条目会静默变成「放行别的字符串」。新增条目必须在 `why` 里写明「为什么
// 这不是规划编号」——没有依据的条目等于把门禁关掉。输出会打印本次白名单命中数与零
// 命中条目,便于发现已失效的条目。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const USAGE = '用法: node scripts/check-test-numbering.mjs [--help]';

/**
 * 规划编号字母表(单一来源;诊断文案与判定同处,避免两处漂移)。
 * 不含 A 族,理由见文件头「匹配规则」第 1 条。
 * 带 g 标志供 matchAll 取全部命中;只用 matchAll 消费它(它会克隆正则,不改本对象的
 * lastIndex),别改成 .test() 复用同一实例。
 */
export const PLANNING_TOKEN_RE = /\b(?:B1[0-3]|B[1-9]|F[1-9]|C[1-4]|D-\d{2}|OPT-\d+(?:\.\d+)?|D[1-5])\b/g;

/** 扫描目标:目录 + 该目录下的文件判定(见文件头「扫描面」) */
export const SCAN_TARGETS = Object.freeze([
  { dir: 'test/segments', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/main', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/renderer', accept: (name) => name.endsWith('.test.js') },
  { dir: 'test/common', accept: (name) => name.endsWith('.js') },
  { dir: 'test/tools', accept: (name) => /\.(js|mjs)$/.test(name) },
]);

/** 显式排除目录(仓库相对 POSIX 路径;前缀匹配)。理由见文件头「扫描面」。 */
export const EXCLUDED_DIRS = Object.freeze(['test/pending', 'test/fixtures']);

/**
 * 扫描文件数下限:walker 静默失效(目录改名/权限)会退化成「零文件全过」,那是假通过。
 * 当前实际 142 个文件,下限只留一半余量。
 */
export const MIN_SCAN_FILES = 50;

/** 诊断片段的最大长度(超长字面量截断,避免刷屏) */
const SNIPPET_MAX = 72;

// ---- 白名单(逐条写明依据;按内容匹配,不按行号)----

/**
 * @typedef {object} NumberHit 一处命中
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 行号(1 起)
 * @property {number} column 列号(1 起,指向编号本身)
 * @property {string} token 命中的编号
 * @property {string} literal 所在字面量原文(含引号)
 * @property {string} lineSource 命中所在源码行
 * @property {string} lineHead 命中所在源码行里、所在字面量起始引号之前的部分
 */

/**
 * @typedef {object} AllowEntry 白名单条目
 * @property {string} id 条目 id(失效提示里点名用)
 * @property {string} file 生效文件;null = 不限文件
 * @property {(hit: NumberHit) => boolean} match 内容判定
 * @property {string} why 依据:为什么这不是规划编号
 * @property {boolean} [cold] true = 按设计不在扫描面内,零命中是预期(输出里分开计数)
 */

/** 命中所在源码行里,字面量起始引号之前的那一段(`title` 键名到值之间的空白) */
function isTitleKeyedValue(hit) {
  return /\btitle\s*:\s*$/.test(hit.lineHead);
}

/** @type {readonly AllowEntry[]} */
export const ALLOWLIST = Object.freeze([
  {
    id: 'jis-paper-size-B5',
    file: null,
    match: (hit) => hit.token === 'B5' && /(?:paper|枚举外值)/.test(`${hit.lineSource} ${hit.literal}`),
    why: 'B5 与 JIS 纸型同形:此处的 B5 是 pageSetup 的纸型取值(`paper: "B5"` 输入值、'
      + '「paper 枚举外值(B5)应回退默认」这类断言消息),不是规划编号。实测该形态跨文件出现'
      + '(test/main/settings.test.js 与 test/segments/page-setup.test.js 各若干处),故按内容'
      + '特征(所在行/字面量含 paper 或「枚举外值」+ 编号恰为 B5)放行而不按文件登记;同一文件里'
      + '不带 paper 语义的 B5/B13 仍照报。',
  },
  {
    id: 'input-value-under-title-key',
    file: null,
    match: (hit) => isTitleKeyedValue(hit) && new RegExp(`^\\s*${hit.token}\\b`).test(hit.literal),
    why: '被测数据值而非编号引用:`title: "F7"` / `title: "F8 合并"` 这类值是转换输入的'
      + '标题字面量,编号只是恰好长得像规划编号。按「title 键 + 值以编号开头」的内容'
      + '组合放行;待这批输入值改成中性名后本条自然零命中,留着无害。',
  },
  {
    id: 'cross-ref-scenario-labels-in-comments',
    file: 'test/segments/cross-ref.test.js',
    // 注释不在扫描面内,故本条永不命中;登记它是为了把「这些 B* 是该文件自述用的场景
    // 序号,不是规划编号」写进门禁,防止有人按「看起来是编号」把它们清掉而破坏文件自述。
    match: () => false,
    cold: true,
    why: 'cross-ref.test.js 的 `场景 A/B` 段落里的 `A1`–`A8` / `B1`–`B5` 是该文件内部的'
      + '场景序号(注释行内),删掉会破坏文件自述;本门禁只扫字符串字面量,注释天然不报,'
      + '故显式登记为「按设计不参与扫描面」的条目。',
  },
  {
    id: 'presets-import-preset-names',
    file: 'test/main/presets-import.test.js',
    match: (hit) => /^A[18]\b/.test(hit.literal.trim()),
    cold: true,
    why: '预设名称字面量(`preset("A1",…)` / `name === "A1"` / `name === "A8"`)是测试'
      + '数据,不是规划编号;A 族本就不在字母表内(见文件头第 1 条),显式登记以防将来'
      + '字母表变更时误伤。',
  },
]);

// ---- 词法:抽出文件里的字符串字面量 ----

/**
 * @typedef {object} StringLiteral
 * @property {number} start 起始引号位置(含引号)
 * @property {number} end 结束引号之后的位置
 * @property {number} line 起始行号(1 起)
 * @property {string} quote 引号字符
 * @property {string} content 引号之间的原文
 */

/** 前一个 token 允许紧跟正则的关键字(其后的 `/` 是正则起点而非除号) */
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * 位置 i 处的 `/` 是正则起点还是除号(启发式:往前跳过空白看前一个 token)。
 * 标识符/数字结尾 → 除号(除非是上表关键字);`) ] }` 结尾 → 除号;其余 → 正则。
 * @param {string} text 全文
 * @param {number} i `/` 的位置
 * @returns {boolean} true 表示按正则字面量处理
 */
function isRegexStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j] ?? '')) j -= 1;
  if (j < 0) return true;
  const ch = text[j] ?? '';
  if (!/[A-Za-z0-9_$]/.test(ch)) return !')]}'.includes(ch);
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k] ?? '')) k -= 1;
  return REGEX_AFTER_KEYWORD.has(text.slice(k + 1, j + 1));
}

/**
 * 抽出全部字符串字面量('...' / "..." / `...`,模板串按静态片段与 `${}` 内的嵌套字面量
 * 分别登记)。注释与正则字面量内容不参与 —— 这正是本门禁要的边界。
 * @param {string} text 源码文本
 * @returns {StringLiteral[]} 字面量列表(按起始位置升序)
 */
export function collectStringLiterals(text) {
  /** @type {StringLiteral[]} */
  const out = [];
  /** @type {{ kind: 'code'|'line'|'block'|'regex'|'str', quote?: string, line?: number, start?: number, brace?: number, template?: boolean, cls?: boolean }[]} */
  const stack = [{ kind: 'code', brace: 0, template: false }];
  const top = () => stack[stack.length - 1];
  let line = 1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\n') {
      line += 1;
      if (top().kind === 'line') stack.pop();
      i += 1;
      continue;
    }
    const frame = top();
    if (frame.kind === 'code') {
      if (ch === '/' && text[i + 1] === '/') {
        stack.push({ kind: 'line' });
        i += 2;
        continue;
      }
      if (ch === '/' && text[i + 1] === '*') {
        stack.push({ kind: 'block' });
        i += 2;
        continue;
      }
      if (ch === '/' && isRegexStart(text, i)) {
        stack.push({ kind: 'regex' });
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        stack.push({ kind: 'str', quote: ch, line, start: i });
        i += 1;
        continue;
      }
      if (ch === '{') frame.brace = (frame.brace ?? 0) + 1;
      else if (ch === '}') {
        if ((frame.brace ?? 0) === 0 && frame.template === true) {
          stack.pop();
          i += 1;
          continue;
        }
        frame.brace = (frame.brace ?? 0) - 1;
      }
      i += 1;
      continue;
    }
    if (frame.kind === 'line') {
      i += 1;
      continue;
    }
    if (frame.kind === 'block') {
      if (ch === '*' && text[i + 1] === '/') {
        stack.pop();
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (frame.kind === 'regex') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[') frame.cls = true;
      else if (ch === ']') frame.cls = false;
      else if (ch === '/' && frame.cls !== true) {
        stack.pop();
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    // 字符串帧:转义整体跳过,模板串的 ${ 进入代码帧
    if (ch === '\\') {
      if (text[i + 1] === '\n') line += 1;
      i += 2;
      continue;
    }
    if (ch === frame.quote) {
      const start = frame.start ?? i;
      out.push({ start, end: i + 1, line: frame.line ?? line, quote: frame.quote ?? '"', content: text.slice(start + 1, i) });
      stack.pop();
      i += 1;
      continue;
    }
    if (frame.quote === '`' && ch === '$' && text[i + 1] === '{') {
      stack.push({ kind: 'code', brace: 0, template: true });
      i += 2;
      continue;
    }
    i += 1;
  }
  return out;
}

// ---- 扫描与判定 ----

/** 排除前缀判定(带 / 边界,避免 test/pendingX 误判) */
function isExcluded(rel) {
  return EXCLUDED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * 递归列出该目录下参与扫描的文件(仓库相对 POSIX 路径,已排序)。
 * @param {string} relDir 仓库相对目录
 * @returns {string[]} 文件相对路径
 */
function listScannableFiles(relDir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(projectRoot, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (!entry.name.startsWith('.')) out.push(child);
    }
  };
  walk(relDir);
  return out;
}

/** 收集参与扫描的文件清单(按 SCAN_TARGETS 判定扩展名) */
export function listScanFiles() {
  const files = [];
  for (const target of SCAN_TARGETS) {
    for (const rel of listScannableFiles(target.dir)) {
      const name = path.posix.basename(rel);
      if (target.accept(name)) files.push(rel);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** 诊断片段:压掉换行与多余空白,超长截断 */
function snippet(literal) {
  const flat = literal.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 扫描单个文件,返回其中的编号命中。
 * @param {string} rel 仓库相对 POSIX 路径
 * @returns {{ hits: NumberHit[], literalCount: number }}
 */
export function scanFile(rel) {
  const text = readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8');
  const lines = text.split('\n');
  /** 每行起始偏移(列号换算用) */
  const lineStarts = [0];
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] === '\n') lineStarts.push(k + 1);
  }
  const literals = collectStringLiterals(text);
  /** @type {NumberHit[]} */
  const hits = [];
  for (const literal of literals) {
    for (const m of literal.content.matchAll(PLANNING_TOKEN_RE)) {
      const offset = m.index ?? 0;
      const line = literal.line + literal.content.slice(0, offset).split('\n').length - 1;
      const lineStart = lineStarts[line - 1] ?? 0;
      const column = literal.start + 1 + offset - lineStart + 1;
      const lineSource = lines[line - 1] ?? '';
      hits.push({
        file: rel,
        line,
        column,
        token: m[0],
        literal: `${literal.quote}${literal.content}${literal.quote}`,
        lineSource,
        // 字面量起始引号之前的部分:用来判「这个编号是某个键的值」(如 `title: "F7"`)
        lineHead: lineSource.slice(0, literal.start - lineStart),
      });
    }
  }
  return { hits, literalCount: literals.length };
}

/**
 * 全树判定。返回 { problems, allowHits, allowCold, files, literals };allowHits/allowCold
 * 是白名单统计(命中条数 / 按设计不在扫描面内的条数),只作输出,不参与 exit code。
 * @returns {{ problems: NumberHit[], allowHits: number, allowCold: number, files: number, literals: number, staleAllow: string[] }}
 */
export function analyze() {
  const files = listScanFiles();
  /** @type {NumberHit[]} */
  const problems = [];
  const allowUsed = new Set();
  let literals = 0;

  for (const rel of files) {
    const scanned = scanFile(rel);
    literals += scanned.literalCount;
    const seen = new Set();
    for (const hit of scanned.hits) {
      const index = ALLOWLIST.findIndex(
        (entry) => (entry.file === null || entry.file === hit.file) && entry.match(hit),
      );
      if (index !== -1) {
        allowUsed.add(index);
        continue;
      }
      // 同一行同一编号只报一次:同一字面量里重复出现同一 token 不构成两条可行动作
      const key = `${hit.line}:${hit.token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(hit);
    }
  }

  return {
    problems,
    allowHits: allowUsed.size,
    allowCold: ALLOWLIST.filter((entry) => entry.cold === true).length,
    files: files.length,
    literals,
    staleAllow: ALLOWLIST.filter((entry, index) => !allowUsed.has(index) && entry.cold !== true).map((entry) => entry.id),
  };
}

export async function main(argv = []) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => !arg.startsWith('--'));
  if (unknown.length > 0) {
    console.error(`[numbering:fail] 无法识别的参数:${unknown.join(' ')}(${USAGE})`);
    return 1;
  }

  let result;
  try {
    result = analyze();
  } catch (error) {
    console.error(`[numbering:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (result.files < MIN_SCAN_FILES) {
    console.error(
      `[numbering:fail] 只扫到 ${result.files} 个文件(下限 ${MIN_SCAN_FILES}):扫描面或 walker 失效,`
      + '此时「零命中」是假通过,须先修扫描面',
    );
    return 1;
  }

  for (const id of result.staleAllow) {
    console.log(`[info] numbering:白名单条目本次零命中(可能已失效,请复核是否可删):${id}`);
  }

  if (result.problems.length > 0) {
    for (const hit of result.problems) {
      console.error(`[numbering:fail] ${hit.file}:${hit.line} → ${hit.token} → 「${snippet(hit.literal)}」`);
    }
    console.error(
      `[numbering:fail] 测试树规划编号扫描失败,共 ${result.problems.length} 项`
      + `(扫描 ${result.files} 个文件 / ${result.literals} 个字符串字面量;白名单 ${ALLOWLIST.length} 条,本次命中 ${result.allowHits} 条)`,
    );
    console.error(
      '[numbering:fail] 这可能是规划编号泄漏;若是误报请在 scripts/check-test-numbering.mjs 的 '
      + 'ALLOWLIST 加白名单条目并写明依据(按内容匹配,勿按行号登记 —— 行号会随他处改动漂移)',
    );
    return 1;
  }

  console.log(
    `[ok] 测试树规划编号扫描通过:扫描 ${result.files} 个文件 / ${result.literals} 个字符串字面量,无规划编号字面量;`
    + `白名单 ${ALLOWLIST.length} 条(本次命中 ${result.allowHits} 条,按设计不参与扫描面 ${result.allowCold} 条)`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'scripts', 'check-test-numbering.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}
