// @ts-check
/**
 * 沙盒副本闭包 · 扫描 + 审计层(测试树共享):
 * 从一批源码文本里定位「谁把谁逐字节复制进了沙盒」(scanCopySites),并审计这批副本的
 * import 闭包与存活情况(auditCopySet / auditEntryEvidence / findEntryExecutionLines)。
 *
 * 为何分两层:词法事实(剥注释、抽 specifier、相对路径解析、表达式求值)在 copy-closure.js;
 * 本层只做「集合级」的提取与判定。两层的分工标准是**变化驱动力**:下层随源码写法变,
 * 上层随仓库里复制点的分布变(哪个脚本被复制、沙盒怎么组装、谁是入口)。
 *
 * 依赖方向单向:本层 import 下层 copy-closure.js;**下层不 import 本层**。只 import 同目录
 * 下层,不 import 任何 node: 内建模块(零 I/O:不读文件、不遍历目录,只吃字符串)。
 * 目录遍历与读文件留在守护段(它已有 fs/path)。
 *
 * ⚠ 已知覆盖边界与行数口径:见守护段 test/segments/contract-single-source.test.js 的文件头
 *   「沙盒副本闭包 · 已知覆盖边界」小节 —— 那里是唯一权威处(动态列表 / 多层别名 / 整树复制
 *   三类复制源只登记不判红),本文件不重复,避免两份说法漂移。
 */
import {
  JS_SOURCE_RE,
  blankComments,
  classifySpecifier,
  collectSpecifiers,
  resolveCopySource,
  resolveRelativeSpecifier,
  skipQuoted,
} from "./copy-closure.js";

/** 复制机制与判定范围(本层单源;新增复制形态时在此登记,勿散落在解析器里) */
export const COPY_MECHANISMS = [
  { call: "copyFileSync", scope: "per-file" },
  { call: "copyFile", scope: "per-file" },
  // 整树镜像(cpSync 目录 + node_modules 联接):整棵树都在沙盒里,相对依赖天然闭合,
  // 且 node_modules 被联接 → 裸包名也能解析。这类复制点只登记不判红(见 scanCopySites)
  { call: "cpSync", scope: "tree-mirror" },
];

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
 * 扫出「被逐字节复制进沙箱」的仓库文件(事实源 = 代码里的复制调用,不硬编码任何文件名)。
 * 解析不出的复制点只登记:静态求值不可能覆盖所有写法(运行时拼装的列表、多层别名),
 * 把它们判红会让守护变成「必须改解析器」的负担;但必须登记并打印,否则等于没看见。
 * @param {import("./copy-closure.js").SourceFile[]} files 待扫描源文件(调用方给全 test/ 与 scripts/)
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
