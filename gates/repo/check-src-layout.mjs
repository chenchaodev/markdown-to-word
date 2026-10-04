// src 布局门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 两族判据 ----
//   ① src-file-header:`src/**` 下 .ts/.cts/.js/.cjs 文件的**首行**必须是 `/**` 注释块的开头
//      (shebang 文件以 shebang 之后的第一行计)。判红点名 `相对路径:行号`。
//      为什么是「首行」而不是「有注释」:本仓的文件头注释不是装饰,是**声明**(为什么这样写、
//      不变量在哪、踩过什么坑)。它排在首行才与 import 区分离,读的人不必先翻代码才知道
//      这份文件为什么长这样;排在 import 之后则与代码交织,声明的作用归零。
//   ② src-no-duplicate-basename:同一**顶层目录**(`src/` 的直接子目录)内两个非 `index` 的
//      源文件 basename 相同 ⇒ 判红并点名**两个完整路径**。跨顶层目录同名不判红。
//      为什么只管「同顶层目录」:不同层同名是分层正常的表现(main/settings.ts 与
//      renderer/settings.ts 是两件事),而**同一层内**同名意味着读者要在两个目录之间猜
//      「我 import 的那个 render 到底是哪一个」—— 那正是双管线对位实现以外的真实歧义。
//      `index` 豁免:各子目录的 barrel 入口按约定就叫 index.ts,同名是约定本身。
//
// ---- 顶层目录清单为什么从磁盘派生而不是登记一张表 ----
// 「src/ 的直接子目录」这个集合随 ADR-060 之后的分层演进增减(core / renderer / main /
// convert / cli / mcp 是当前实测值)。登记一张表就得在每次新增或合并层时同步它,而漏同步的
// 表现是**恒绿**(新层完全不在判据视野内)—— 与 check-import-boundary 里 SRC_TOP_LAYERS
// 必须登记的理由不同:那一族的规则表是 deny-list,层不在表里就**不命中任何规则**,必须登记;
// 本门禁是「按实际目录判定」,磁盘就是它的单源,派生即真源,没有第二份可漂移的清单。
//
// ---- 白名单:双管线的对位实现(逐条写明为什么) ----
// 本仓是 docx / pdf 双管线,同一主题在两侧各有一份实现是**架构事实**而不是命名事故,两侧文件
// 头注互指(见每条 why)。它们逐条登记在 DUPLICATE_BASENAME_ALLOWLIST,并受三条 fail-closed
// 断言约束(缺一不可,否则白名单会退化成「同名一律放行」):
//   A 反向:白名单未登记的同名组一律判红;
//   B 正向:每个登记项声明的两个路径都必须真的存在、真的同 basename、真的落在同一顶层目录;
//   C 死登记:两个路径不再同名(或不再是那两个)即判红 —— 搬完文件忘了删登记,清单会越养越宽,
//     而白名单越宽,判红面越小。
//
// ---- ⚠️ 默认只报告,不判红;T2 转 fail-closed(ADR-064 的节奏) ----
// **这两族判据在 T0 建时当前即红**(src-file-header 判红面见下方结论行,src-no-duplicate-basename
// 白名单放行后为 0 组)。若一建就 fail-closed,它进不了 `verify:ci` —— 门禁进不了链就等于不存在,
// 而「链上少一道判据」没有任何机器会发现(这正是 gates/probe/gate-probes/registry.mjs 存在的
// 理由:它只对**链上/workflow 上**的调用点判红,本地手动的门禁对它是隐形的)。
// 故本脚本**默认退出码 0、只把两族计数与命中文件打进结论行**;`--enforce` 才把判红项转成非零。
//
// **切换点(ADR-064 T2)**:src/ 的目标布局落定、文件搬完之后,删掉本段与 `--enforce` 的默认关闭
// 语义,把 main() 里的 `enforce` 改为恒真(并把 script 从 `check:src-layout` 挪进 `verify:ci`)。
// 切换的前置条件是 `--enforce` 跑出来是绿的 —— 在它还红着的时候切,是把已知违例固化成基线。
// 取数命令(判据本体即取数命令,故这里只记命令不记数值):
//   node gates/repo/check-src-layout.mjs            # 报告模式:两族计数 + 命中文件
//   node gates/repo/check-src-layout.mjs --enforce  # 判红模式:非零退出,逐条点名
//
// ---- 形状:判定本体 = `checkSrcLayout(ctx)`(可注入、零 IO 副作用)----
// 与 check-ci-contract.mjs / check-copy-sites.mjs 同一范式(全仓门禁判定协议,见
// gates/probe/gate-probes/protocol.mjs):IO 全部经 ctx 注入(读文本 / 列目录 / 白名单 /
// 扫描面下限),`main()` 只做「打印 + 按结论出 0/1」。白名单是**形参**而不是模块常量,
// 这样自检脚本能在合成目录上先红后绿,而不需要「从命令行换一份白名单」的口子 ——
// 那本身就是一个 fail-open(能传白名单就能把自己摘出去)。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁注册表 import 当判定本体指针。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码);而注册表
// R4b 会逐项对账「judgment.load 声明」与「顶层是否自执行」的事实。守卫写法与
// check-changelog.mjs / check-ci-contract.mjs 同形(全仓先例)。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

/** 被判定的子树(单一来源:扫描面只此一处登记) */
export const SRC_REL = "src";
/** 判据一参与扫描的扩展名 */
export const HEADER_EXTS = Object.freeze([".ts", ".cts", ".js", ".cjs"]);
/** 判据二参与扫描的扩展名(比判据一多一个 .mjs:同名判定与「有没有文件头」是两件事) */
export const BASENAME_EXTS = Object.freeze([".ts", ".cts", ".js", ".mjs", ".cjs"]);
/** basename 豁免:barrel 入口按约定就叫 index.<ext>,同名是约定本身 */
const INDEX_STEM = "index";
/**
 * 扫描面文件数下限:walker 整体失效(零文件)时两族判据都会「全绿」,而恒绿是纯文本门禁
 * 最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。取实测值的约 3/4,只在「塌缩」这一档
 * 报红,不随日常增删文件抖动。
 */
export const MIN_SCANNED_FILES = 120;
/** 诊断片段的最大长度(超长行截断,避免刷屏) */
const SNIPPET_MAX = 60;
const USAGE = "用法: node gates/repo/check-src-layout.mjs [--enforce] [--help]";

/**
 * @typedef {object} AllowEntry 白名单里的一行(双管线对位实现)
 * @property {string} id 条目 id(死登记诊断里点名用)
 * @property {string} top 顶层目录(`src/` 的直接子目录)
 * @property {string} base 同名 basename(含扩展名)
 * @property {string[]} paths 恰好两个完整仓库相对路径,必须同 basename 且同在 `src/<top>/` 下
 * @property {string} why 为什么这两个同名文件是对位实现而不是重名(人工复核的唯一依据,不得留空)
 */

/**
 * 双管线对位实现白名单:同一主题在 docx 与 pdf 各有一份的 basename。
 *
 * 逐条登记而非「放行 core/ 整层」:后者会让 core 里任何新增的同名对都静默通过 —— 而 core
 * 恰恰是最容易长出真重名的地方(它同时含两条管线的实现与共享契约)。逐条登记的代价是搬文件
 * 时要同步这张表,收益是「白名单只会越来越具体」,而 C 断言(死登记判红)保证它不会静默变宽。
 * @type {readonly AllowEntry[]}
 */
export const DUPLICATE_BASENAME_ALLOWLIST = Object.freeze([
  {
    id: "render-orchestrator",
    top: "core",
    base: "render.ts",
    paths: Object.freeze(["src/core/docx/render.ts", "src/core/pdf/render.ts"]),
    why: "双管线**各自的编排层**,同名表达的是同一主题而非同一份代码:docx 侧编排 "
      + "mdast AST(pipeline/parse.ts 预解析 + prescan.ts 全文预扫)→ docx Document → Buffer;"
      + "pdf 侧编排 markdown 源文 → markdown-it → HTML 模板(主进程 printToPDF)。"
      + "合并成一个 render.ts 只会把两条管线的选项契约(RenderOptions vs RenderPdfHtmlOptions)"
      + "与两套不同的结构信息获取方式(预扫 vs 渲染期即时识别)塞进同一模块,core 层随即长出"
      + "按格式分派的 if 分支 —— 那正是双实现必须各自成模块的原因。两文件头注互指"
      + "(「双管线对应(与 src/core/pdf/render.ts 成对)」),格式差异总览单源在 core/convert.ts 头注。",
  },
  {
    id: "mermaid-contract-vs-pdf-placeholder",
    top: "core",
    base: "mermaid.ts",
    paths: Object.freeze(["src/core/markdown/mermaid.ts", "src/core/pdf/mermaid.ts"]),
    why: "一个**契约**一个**实现**,同名表达同一主题:markdown/mermaid.ts 是 MermaidResolver "
      + "注入契约与返回形态(svg / png / 逻辑像素尺寸),不产任何 HTML、core 层不碰 Electron;"
      + "pdf/mermaid.ts 是 pdf 管线内的占位替换实现(扫 highlight 回调产出的 `<div class=\"mermaid\">` "
      + "→ 内联 SVG,失败降级为代码块)。它们不是两份重复实现,故不存在「合并成一份」的选项 —— "
      + "docx 侧的实现不在 core(mermaid 渲染跑在 main 的隐藏 BrowserWindow 里,经注入进来),"
      + "所以第三侧不会有同名文件,本条不会随 ADR-064 的搬动新增条目。",
  },
  {
    id: "table-mdast-vs-markdown-it",
    top: "core",
    base: "table.ts",
    paths: Object.freeze(["src/core/docx/handlers/table.ts", "src/core/pdf/rules/table.ts"]),
    why: "同一个 GFM 表格主题的两种落地,两侧的**输入模型不同**故实现不可合并:docx 侧是"
      + "mdast Table 节点 → docx Table 的块渲染器,列宽信号由解析期挂 `data.colWidthsPct`;"
      + "pdf 侧是 markdown-it token 规则,由 `table_open` / `th_open` 注入 "
      + "`table-layout:fixed` 与首行 `width:N%`(Chromium 打印稳定的注入方式)。"
      + "列宽解析本身单源在 core/markdown/table-width.ts,两文件头注互指并各自写明"
      + "「改列宽信号/对齐语义须同步核对另一侧」—— 那句互指正是本条该登记的依据。",
  },
]);

/**
 * @typedef {object} DirEntry 一个目录项(注入面用的最小形状)
 * @property {string} name
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} SrcLayoutCtx 注入面(IO 与策略全部经它进来,判定本体自身不碰 fs)
 * @property {string} root 求值根
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {(relative: string) => DirEntry[]} listDir 列仓库相对目录
 * @property {readonly AllowEntry[]} whitelist 判据二的同名白名单
 * @property {number} minScannedFiles 扫描面文件数下限(0 = 关闭该判据,合成夹具用)
 */

/**
 * @typedef {object} SrcLayoutStats 计数(结论行用)
 * @property {number} files 扫描到的全部文件数
 * @property {number} scanned 进入判据一的文件数
 * @property {number} headerViolations 判据一判红条数
 * @property {number} duplicateGroups 判据二的同名组数
 * @property {number} duplicateViolations 判据二判红条数
 * @property {number} allowHits 本次被白名单放行的同名组数
 * @property {number} allowStale 死登记条数
 * @property {number} looseFiles 直接落在 src/ 下(不在任何顶层目录内)的文件数
 */

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 *
 * 白名单与扫描面下限都是**可覆盖**的形参而不是模块常量:自检脚本要在合成目录上求值同一份
 * 判据(白名单那条要验死登记判红,下限那条要验扫描面塌缩判红),而它们都不能靠改模块常量做到。
 * @param {Partial<SrcLayoutCtx>} [base] 调用方给的注入面
 * @returns {SrcLayoutCtx} 完整注入面
 */
export function makeSrcLayoutCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    listDir:
      base.listDir
      ?? ((relative) => readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))),
    whitelist: base.whitelist ?? DUPLICATE_BASENAME_ALLOWLIST,
    minScannedFiles: base.minScannedFiles ?? MIN_SCANNED_FILES,
  };
}

/**
 * 去掉扩展名后的文件主名。`a/b/index.ts` 与 `a/b/index.js` 都得 `index`。
 * @param {string} basename 文件名(含扩展名)
 * @returns {string} 主名
 */
function stemOf(basename) {
  const dot = basename.lastIndexOf(".");
  return dot <= 0 ? basename : basename.slice(0, dot);
}

/**
 * 扩展名是否在给定集合内(含点、小写比较:仓内扩展名一律小写)。
 * @param {string} basename 文件名
 * @param {readonly string[]} exts 扩展名集合
 * @returns {boolean}
 */
function hasExt(basename, exts) {
  const dot = basename.lastIndexOf(".");
  return dot > 0 && exts.includes(basename.slice(dot));
}

/**
 * 压掉多余空白,超长截断(诊断里放首行原文,便于直接看出写成了什么)。
 * @param {string} line 首行原文
 * @returns {string}
 */
function snippet(line) {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 列出 src/ 下的全部文件(仓库相对 POSIX 路径,已排序)。
 *
 * ctx.listDir 抛错**不在此吞掉**:调用方要把「src/ 读不到」判红(路径写错时静默按空集通过,
 * 门禁从那一刻起什么也没查,而输出是 exit 0 —— 这是最坏的失效形态)。
 * @param {SrcLayoutCtx} ctx 注入面
 * @returns {string[]} 文件相对路径
 */
export function collectSrcFiles(ctx) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} relDir 仓库相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    for (const entry of ctx.listDir(relDir)) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) walk(rel);
      else files.push(rel);
    }
  };
  walk(SRC_REL);
  return files.sort();
}

/**
 * 判据一:首行必须以 `/**` 开头(shebang 之后的第一行计)。
 * @param {string} text 文件原文
 * @returns {{ line: number, first: string }} 判红的行号(1 起,0 = 通过)与那一行原文(诊断用)
 */
export function inspectFileHeader(text) {
  // BOM 不算内容:检出工具写出的 UTF-8 BOM 会让首行以 U+FEFF 开头,那不是「作者没写文件头」
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  // shebang 行不是「首行」:node 的可执行入口靠它起手,文件头在它之后
  const start = (lines[0] ?? "").startsWith("#!") ? 1 : 0;
  const first = (lines[start] ?? "").trimStart();
  return { line: first.startsWith("/**") ? 0 : start + 1, first };
}

/**
 * 白名单形态自检 + 死登记判定(B / C 两条断言;形态不合规即判红)。
 *
 * 为何与 A 断言(反向等式)分开:白名单表本身写错时,反向等式会「照常工作」而永远命中不到
 * 白名单 —— 表现是「白名单明明登记了却还是红」,症状离根因很远。这三格互不替代。
 * @param {readonly AllowEntry[]} whitelist 白名单
 * @param {Map<string, string[]>} groups 磁盘实测的同名组(键 = `<top>/<basename>`,值为路径列表)
 * @param {Set<string>} knownPaths 扫描面内的全部文件路径
 * @returns {{ stale: string[], hits: Set<string> }} 死登记诊断 + 实命中的白名单键
 */
export function auditBasenameAllowlist(whitelist, groups, knownPaths) {
  /** @type {string[]} */
  const stale = [];
  /** @type {Set<string>} */
  const hits = new Set();
  /** @type {Set<string>} */
  const seenIds = new Set();
  /** @type {Set<string>} */
  const seenKeys = new Set();

  for (const entry of whitelist) {
    if (entry.id === "" || seenIds.has(entry.id)) {
      stale.push(`${entry.id || "(空 id)"} → allowlist-malformed:白名单 id 重复或为空`);
    }
    seenIds.add(entry.id);
    const key = `${entry.top}/${entry.base}`;
    if (seenKeys.has(key)) stale.push(`${entry.id} → allowlist-malformed:白名单里 ${key} 登记了两次`);
    seenKeys.add(key);

    if (entry.why.trim() === "") {
      stale.push(`${entry.id} → allowlist-malformed:白名单项缺 why(人工复核的唯一依据,不得留空)`);
    }
    if (entry.paths.length !== 2) {
      stale.push(
        `${entry.id} → allowlist-malformed:对位实现恰好两个文件,声明了 ${entry.paths.length} 个 —— `
        + "白名单必须逐对登记,不许写成一串路径",
      );
      continue;
    }
    for (const p of entry.paths) {
      const prefix = `${SRC_REL}/${entry.top}/`;
      if (!knownPaths.has(p)) {
        stale.push(`${entry.id} → allowlist-stale:登记的路径在 src/ 下不存在:${p}(搬走了/改名了)`);
      } else if (!p.startsWith(prefix)) {
        stale.push(
          `${entry.id} → allowlist-malformed:登记的 ${p} 不在 src/${entry.top}/ 下 —— `
          + "同名判定只管同一顶层目录,跨层同名本就不判红,登记它没有意义",
        );
      } else if (stemOf(p.slice(p.lastIndexOf("/") + 1)) !== stemOf(entry.base)) {
        stale.push(
          `${entry.id} → allowlist-malformed:登记的 ${p} 的 basename 与 ${entry.base} 不同名 —— `
          + "白名单按同名组放行,不对位的两个文件登记进来等于凭空放行第三个",
        );
      }
    }
    const actual = groups.get(key) ?? [];
    if ([...actual].sort().join(",") !== [...entry.paths].sort().join(",")) {
      stale.push(
        `${entry.id} → allowlist-stale:${key} 实测同名组是 [${actual.join(", ") || "(无)"}],`
        + `登记的是 [${entry.paths.join(", ")}] —— 请改登记或删掉它(白名单越宽,判红面越小)`,
      );
      continue;
    }
    hits.add(key);
  }
  return { stale, hits };
}

/**
 * 判定本体(可注入纯函数):两族判据 + 白名单三条断言 + 扫描面下界。
 * @param {Partial<SrcLayoutCtx>} [base] 注入面(见 makeSrcLayoutCtx)
 * @returns {{ problems: string[], stats: SrcLayoutStats }}
 */
export function checkSrcLayout(base = {}) {
  const ctx = makeSrcLayoutCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {SrcLayoutStats} */
  const stats = {
    files: 0,
    scanned: 0,
    headerViolations: 0,
    duplicateGroups: 0,
    duplicateViolations: 0,
    allowHits: 0,
    allowStale: 0,
    looseFiles: 0,
  };

  /** @type {string[]} */
  let files;
  try {
    files = collectSrcFiles(ctx);
  } catch (error) {
    problems.push(
      `${SRC_REL}/ → scan-surface-missing:读不到 ${SRC_REL}/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 扫描面为空是最坏的失效形态`
      + "(门禁从这一刻起什么也没查而输出是 exit 0),故判红",
    );
    return { problems, stats };
  }
  stats.files = files.length;

  // ---- 判据一:首行注释头 ----
  // 两族判据的扩展名集合**刻意不同**(判据二多一个 .mjs),故它们各自独立判入扫描面 ——
  // 共用一个 `continue` 会让 .mjs 文件整条跳过判据二(判据一不含它),那正是「同名判定漏掉一整族
  // 扩展名而恒绿」的形态,而 src/ 当前一个 .mjs 都没有,漏法在真实仓库上完全看不出来。
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const relative of files) {
    const basename = relative.slice(relative.lastIndexOf("/") + 1);

    if (hasExt(basename, HEADER_EXTS)) {
      stats.scanned += 1;
      const header = inspectFileHeader(ctx.readText(relative));
      if (header.line !== 0) {
        stats.headerViolations += 1;
        problems.push(
          `${relative}:${header.line} → src-file-header:首行不是 /** 注释块的开头`
          + `(实际是「${snippet(header.first)}」)`
          + " —— 文件头声明的是「为什么这样写 / 不变量在哪」,排在首行才与 import 区分离",
        );
      }
    }

    // ---- 判据二:同一顶层目录内的非 index 同名文件(顺路建组,只走一次列表) ----
    if (!hasExt(basename, BASENAME_EXTS)) continue;
    if (stemOf(basename) === INDEX_STEM) continue;
    const segments = relative.split("/");
    if (segments.length < 3) {
      // 直接落在 src/ 下、不属于任何顶层目录 ⇒ 不参与同名判定(判据的作用域是「层内」)
      stats.looseFiles += 1;
      continue;
    }
    const top = /** @type {string} */ (segments[1]);
    const key = `${top}/${basename}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [relative]);
    else group.push(relative);
  }

  if (stats.scanned < ctx.minScannedFiles) {
    problems.push(
      `scan-surface-collapsed:${SRC_REL}/ 下只扫到 ${stats.scanned} 个参与首行判定的文件`
      + `(下限 ${ctx.minScannedFiles})—— walker 可能已失效,而两族判据在零扫描面下会「全绿」`,
    );
  }

  // ---- 白名单三条断言(B / C 在此,A 在下面的同名组循环里) ----
  const knownPaths = new Set(files);
  const audit = auditBasenameAllowlist(ctx.whitelist, groups, knownPaths);
  stats.allowHits = audit.hits.size;
  stats.allowStale = audit.stale.length;
  problems.push(...audit.stale);

  for (const [key, paths] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (paths.length < 2) continue;
    stats.duplicateGroups += 1;
    if (audit.hits.has(key)) continue; // 对位实现:白名单已登记并逐条写明 why
    stats.duplicateViolations += 1;
    problems.push(
      `${paths.join(" + ")} → src-no-duplicate-basename:${key} 在 src/ 的同一个顶层目录内有 `
      + `${paths.length} 个非 index 的同名文件 —— 读者要在两个目录之间猜 import 的到底是哪一个。`
      + "若确属双管线对位实现,请在 DUPLICATE_BASENAME_ALLOWLIST 逐对登记并写明 why",
    );
  }

  return { problems, stats };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按 `--enforce` 出 0/1(判定逻辑全在 checkSrcLayout 里)。
 * @param {string[]} [argv] 参数数组
 * @returns {number} 退出码
 */
export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["enforce", "help"], usage: USAGE });
  } catch (error) {
    // 未知参数一律失败:静默按默认跑一遍报绿就是「假通过」
    console.error(`[src-layout:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(
      [
        USAGE,
        "  --enforce  把两族判据的判红项转成非零退出(默认只报告:ADR-064 的 T0 阶段这两族判据",
        "            当前即红,一建就 fail-closed 会让它进不了 verify:ci;切换点见文件头)。",
      ].join("\n"),
    );
    return 0;
  }
  const enforce = options.enforce === true;
  const { problems, stats } = checkSrcLayout();

  const counts = [
    `src-file-header 判红 ${stats.headerViolations} 项(扫描面 ${stats.scanned} 个文件 / src/ 共 ${stats.files} 个)`,
    `src-no-duplicate-basename 同名组 ${stats.duplicateGroups} 组 → 判红 ${stats.duplicateViolations} 组`
    + `(白名单放行 ${stats.allowHits} 组 / 死登记 ${stats.allowStale} 条)`,
  ].join(";");
  const named = problems.map((problem) => problem.split(" → ")[0] ?? problem);

  if (problems.length === 0) {
    console.log(`[ok] src 布局两族判据通过${enforce ? "(--enforce)" : "(报告模式)"}:${counts}`);
    return 0;
  }

  const stream = enforce ? console.error : console.log;
  const tag = enforce ? "fail" : "report";
  for (const problem of problems) stream(`[src-layout:${tag}] ${problem}`);
  if (!enforce) {
    console.log(
      `[report] src 布局两族判据当前判红 ${problems.length} 项,未转成非零退出(报告模式):${counts}。`
      + `点名文件:${named.join(", ")}。加 --enforce 即 fail-closed(ADR-064 的 T0 节奏:` +
      "T0 只报告,T2 搬完文件后才把 --enforce 固化进 verify:ci)",
    );
    return 0;
  }
  console.error(`[src-layout:fail] src 布局两族判据不成立,共 ${problems.length} 项:${counts}`);
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
