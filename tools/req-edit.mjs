// 工作项号台账(docs/REQ.md)的单一写入口:取号、查行、扫池、登记、改字段、搬行。
//
// 为什么要有这一层:台账的表是**硬形状**(每节「表头 → 分隔行 → 连续数据行」且中间不许夹空行),
// 而人手改表格最容易犯的两种错恰好都不报错 —— ①**列数错位**:多写一格少写一格都照样渲染成表,
// 门禁按列名取列,读到的「标题」其实是「状态」,而一切看起来完整;②**搬行插错位置**:锚在表头
// 之后 ⇒ 分隔行被顶到表中间、整节退化成正文。本工具只做「算好行 + 原子写回」,判据一步不让:
// 列数对不上就拒绝,多个候选表块就停下,超上限就报错而**不截断**。
//
// 依赖方向:只引 `shared/`(机制层)与 `node:` 内建 —— 门禁树 `gates/` 不可引
// (`check-import-boundary.mjs` 的 `tools-stay-in-tools`)。切格与定位全部经
// `shared/markdown-table.mjs`,本文件不复制那套逻辑。
//
// 唯二在本文件重写的是「围栏遮罩」与「`## ` 节归属」两个小扫描:上游把它们做成了**未导出的
// 私有函数**(它们服务于「只读」的 locateRegistry / rangeTable),而本工具要在**未遮罩的行序列**
// 上做插入 / 删除 / 替换,拿不到遮罩后的行。两份的围栏判定必须逐字一致(行首 ``` 或 ~~~,
// 可带缩进,嵌套不处理);改上游那两份时这里要同步。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../shared/cli.mjs";
import { hashBuffer, writeFileAtomic } from "../shared/fsx.mjs";
import {
  TITLE_LIMIT,
  WHY_LIMIT,
  WHY_LIMIT_DONE,
  isSeparatorRow,
  ledgerTextCols,
  locateRegistry,
  normalizeHeaderCell,
  normalizeLedgerCell,
  rangeTable,
  splitTableRow,
  tableBlocks,
} from "../shared/markdown-table.mjs";
import { ROOT } from "../shared/paths.js";

/** 台账默认路径(项目根单源经 `shared/paths.js` 取,不自算) */
const DEFAULT_LEDGER = path.join(ROOT, "docs", "REQ.md");

/** 四个节名;前两个是开工扫池面 */
const SECTION_PENDING = "待拍板";
const SECTION_DOING = "在办";
const SECTION_DONE = "已完成";
const SECTION_VOID = "已作废";
const POOL_SECTIONS = Object.freeze([SECTION_PENDING, SECTION_DOING]);

/** 状态取值域五个(取自全局配置目录 `REQ-RULES.md` 的状态取值域) */
const STATUS_DOMAIN = Object.freeze(["待拍板", "未开工", "在办", "已完成", "已作废"]);

/** 合法流转边七条;其余流转即错 */
const LEGAL_EDGES = Object.freeze({
  待拍板: Object.freeze(["未开工", "已作废"]),
  未开工: Object.freeze(["在办", "已完成", "已作废"]),
  在办: Object.freeze(["已完成", "已作废"]),
});

/** 状态 → 该状态所属的节;「待拍板」与「未开工」同处一节(由节名推不出唯一状态) */
const STATUS_SECTION = Object.freeze({
  待拍板: SECTION_PENDING,
  未开工: SECTION_PENDING,
  在办: SECTION_DOING,
  已完成: SECTION_DONE,
  已作废: SECTION_VOID,
});

/** 节名 → 该节唯一对应的状态;`待拍板` 节故意缺席(两个状态都合法) */
const SECTION_STATUS = Object.freeze({
  在办: "在办",
  已完成: "已完成",
  已作废: "已作废",
});

/** 三位号形态;三位上限 */
const REQ_ID_RE = /^REQ-\d{3}$/;
const REQ_ID_WIDE_RE = /^REQ-\d{4,}$/;
const MAX_THREE_DIGITS = 999;

/** `add` 可写的列(状态初值固定为 `待拍板`,故不接受 `状态` 键) */
const ADD_KEYS = Object.freeze(["标题", "为什么停在这", "什么条件下重看", "分析在哪"]);
/** `set` 可写的列;「号」永不变,故意不在其中 */
const SET_KEYS = Object.freeze(["标题", "状态", "为什么停在这", "什么条件下重看", "分析在哪"]);

/**
 * 键 → 该键在该表头下**可能**的写法。
 *
 * 键名取**模板的写法**(`templates/docs-init/REQ.md` 是列名的单一事实源,四节都是
 * 「为什么停在这」)。别名表里保留「为什么停在哪」是因为**别处的台账可能仍是旧写法** ——
 * 那是在办/已作废两节的表头曾经写错、被本仓订正前的形态。别名让那种台账仍可写,
 * 代价只是多一次查表;反过来,把键名定成旧写法会让**本仓这种正确台账**精确匹配失败
 * (实测症状:`不认识的列名「为什么停在这」`,而可改列表里列的是另一节的名字)。
 *
 * 解析顺序是「原样精确匹配优先,匹配不到再按别名表找」—— 两步都只认表头里的**实际列名**,
 * 没有猜测成分。
 */
const COLUMN_ALIASES = new Map([
  ["标题", ["标题"]],
  ["状态", ["状态"]],
  ["为什么停在这", ["为什么停在这", "为什么停在哪"]],
  ["什么条件下重看", ["什么条件下重看"]],
  ["分析在哪", ["分析在哪"]],
]);

const USAGE = [
  "用法: node tools/req-edit.mjs <命令> [参数] [--file <path>]",
  "",
  "  next                          只打印下一个可用号(不写任何文件)",
  "  show <号>                     一字段一行打印那一行",
  "  pool                          扫「待拍板」「在办」两节",
  "  add <标题> [键=值...]         在「待拍板」节末追加一行并同步号段两格",
  "                                 键:标题(必需) 为什么停在这 什么条件下重看 分析在哪",
  "  set <号> <键>=<值> [...]      改一至多列;给了「状态」且跨节时自动搬行",
  "  move <号> <目标节>            删源行 + 插目标表末尾 + 改状态列",
  "",
  "  --file <path>                 台账路径(默认 docs/REQ.md)",
].join("\n");

/** 失败一律带此前缀,与本仓其它门禁/工具的 `[<id>:fail]` 形态一致 */
const FAIL_PREFIX = "[req-edit:fail]";

/** 带用户可操作提示的失败(不是崩溃);`main` 统一捕获并落非零退出码 */
class ToolError extends Error {}

/**
 * 剥掉 markdown 装饰(反引号 / 粗体 / 删除线)后按**码点**数字数。
 *
 * 为什么本地重写:台账门禁的同一口径(C1 / C2)住在 `gates/`,而 `tools/` 引不到门禁树;
 * 上限常量本身则从 `shared/markdown-table.mjs` 取,那一处是唯一一份数值。
 * @param {string} cell 单元格原文
 * @returns {number} 字数(码点数)
 */
export function charLen(cell) {
  return [...cell.replace(/`+/g, "").replace(/\*\*/g, "").replace(/~~/g, "").trim()].length;
}

/**
 * 逐行遮罩围栏代码块,行号与原文 1:1 对齐(空串占位)。
 * @param {string[]} lines 未遮罩的行序列
 * @returns {string[]} 遮罩后的行序列
 */
function maskFenceLines(lines) {
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push("");
      continue;
    }
    out.push(inFence ? "" : line);
  }
  return out;
}

/**
 * 行号 → 最近的祖先 `## ` 小节标题原文(取不到则空串)。
 * @param {string[]} lines 已遮罩的行序列
 * @returns {Map<number, string>} 行号(1 起)→ 小节名
 */
function sectionByLine(lines) {
  const map = new Map();
  let current = "";
  lines.forEach((line, idx) => {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m) current = m[1];
    map.set(idx + 1, current);
  });
  return map;
}

/**
 * 切行:**本文件唯一的切分入口**。切出的行不带行尾符,并同时报出该文件的行尾形态。
 *
 * 为什么必须成对返回:读侧的全部解析与判据都按**无 CR 的行**做(`row.text` 就是无 CR 的),
 * 写侧若另起一次 `split("\n")` 切,切出来的行会带回尾部 `\r` —— 于是
 * ①「与读到的原文不一致」这条 TOCTOU 自检恒不成立(CRLF 检出时 `set`/`move` 必报错退出),
 * ②`rewriteCell` 的「逐字重建」必然失败(`add` 在号段两格上报错退出)。
 * 两处口径必须来自同一次切分,不能各切各的。
 *
 * 行尾**不被归一化**:写盘按 `eol` 回接,CRLF 台账不会被整体改写成 LF(那会产生全文件 diff,
 * 比写不进去更坏)。行序列与 `shared/markdown-table.mjs` 的 `maskFencedLines` 用同一个
 * `/\r?\n/`,故本工具的行号与上游定位器给的行号 1:1 对齐。
 * @param {string} text 文件全文
 * @returns {{ lines: string[], eol: string }} 无 CR 的行序列 + 该文件的行尾(`"\r\n"` 或 `"\n"`)
 */
function splitLines(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

/**
 * 解析台账全文,取出全部「表头含号且含状态」的登记表块视图。
 *
 * 为什么不用 `locateRegistry` 的行集当唯一结构:它把各节合并成一个跨节行集(那是跨节判据要的
 * 形态),而本工具要**按节**做插入 / 删除 —— 需要「这一节的表块在哪一行、最后一个数据行在哪一行」。
 * 两者口径必须一致(同一谓词:表头同时含「号」与「状态」),故谓词共用 `normalizeHeaderCell`。
 * @param {string} text 台账全文
 * @returns {{ lines: string[], blocks: Array<object> }} 遮罩后的行序列 + 按节块视图
 */
export function parseLedger(text) {
  const { lines } = splitLines(text);
  const masked = maskFenceLines(lines);
  const sections = sectionByLine(masked);
  const blocks = [];
  for (const block of tableBlocks(masked)) {
    const headerCells = splitTableRow(block.header.text);
    const names = headerCells.map(normalizeHeaderCell);
    const idCol = names.findIndex((n) => n.includes("号"));
    const statusCol = names.findIndex((n) => n.includes("状态"));
    if (idCol === -1 || statusCol === -1) continue;
    const { titleCol, whyCol } = ledgerTextCols(headerCells);
    const separator = block.rows.find((r) => isSeparatorRow(r.cells));
    blocks.push({
      section: sections.get(block.header.lineNo) ?? "",
      headerLineNo: block.header.lineNo,
      separatorLineNo: separator ? separator.lineNo : null,
      headerCells,
      names,
      idCol,
      statusCol,
      titleCol,
      whyCol,
      rows: block.rows.filter((r) => !isSeparatorRow(r.cells)),
    });
  }
  return { lines, blocks };
}

/**
 * 读台账并记内容哈希(TOCTOU 比对用)。不存在即报错:**不新建** —— 静默新建会把打错的
 * `--file` 变成一份空台账,而空台账随后会被「写成功」覆盖真台账。
 *
 * 切行在这里做一次:`lines` 与 `eol` 一起交给写命令,免得写侧再切一遍切出口径分叉
 * (见 `splitLines` 的理由)。
 * @param {string} file 台账路径
 * @returns {{ path: string, text: string, hash: string, lines: string[], eol: string }} 全文 + 无 CR 行序列 + 行尾 + sha256
 */
function readLedger(file) {
  if (!existsSync(file)) {
    throw new ToolError(`台账文件不存在:${file}(本工具只改既有台账,不新建)`);
  }
  const buffer = readFileSync(file);
  const text = buffer.toString("utf8");
  const { lines, eol } = splitLines(text);
  return { path: file, text, hash: hashBuffer(buffer), lines, eol };
}

/**
 * 重排行数组:删行、按原行号替换、锚某行后插入。
 *
 * 按**原**行号做(不是增量下标),插入锚点若被删或不存在一律抛错 —— 插到错位置的后果
 * (分隔行被顶进表中间)不报错、只是让整节退化成正文,必须失败关闭。
 * @param {string[]} rawLines 原始行序列
 * @param {{ remove?: number[], replace?: Map<number, string>, inserts?: Array<{ after: number, lines: string[] }> }} ops 行操作
 * @returns {string[]} 新行序列
 */
function applyLineOps(rawLines, { remove = [], replace = new Map(), inserts = [] }) {
  const removeSet = new Set(remove);
  const present = new Set(rawLines.map((_, idx) => idx + 1));
  for (const op of inserts) {
    if (!present.has(op.after)) {
      throw new ToolError(`插入锚点第 ${String(op.after)} 行不存在或已被删 —— 停下,不做猜位`);
    }
  }
  const out = [];
  rawLines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (removeSet.has(lineNo)) return;
    const replacement = replace.get(lineNo);
    out.push(replacement === undefined ? line : replacement);
    for (const op of inserts) {
      if (op.after === lineNo) out.push(...op.lines);
    }
  });
  return out;
}

/**
 * 渲染一行表格(与台账现有写法同形:两端各一个 `| `)。
 * @param {string[]} cells 单元格数组
 * @returns {string} 整行文本
 */
function renderRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

/**
 * 改一行里某一格的值,前提是这一行能被逐字重建。
 *
 * 为什么要求「能逐字重建」:`splitTableRow` 会把 `\|` 还原成字面 `|`,重建时它就变回裸竖线,
 * 那会把一格切成两格。宁可停下报错,也不静默改坏表。
 * @param {string} rawLine 整行原文
 * @param {number} col 目标列下标
 * @param {string} value 新值
 * @param {string} label 诊断标签
 * @returns {string} 改后的整行
 */
function rewriteCell(rawLine, col, value, label) {
  const cells = splitTableRow(rawLine);
  if (cells.length !== 2 || col !== 1) {
    throw new ToolError(`${label}那一行不是「两格」形态,无法安全改写:${rawLine.trim()}`);
  }
  if (renderRow(cells) !== rawLine) {
    throw new ToolError(`${label}那一行的写法与本工具的重建口径不符,不做改写:${rawLine.trim()}`);
  }
  cells[col] = value;
  return renderRow(cells);
}

/**
 * 按名取列:先原样精确匹配表头,匹配不到再走别名表。两步都只认表头里实际存在的列名。
 * @param {string[]} names 已归一的表头列名
 * @param {string} key 键名
 * @returns {number} 列下标;找不到为 `-1`
 */
function resolveColumn(names, key) {
  const exact = names.indexOf(normalizeHeaderCell(key));
  if (exact !== -1) return exact;
  for (const alias of COLUMN_ALIASES.get(key) ?? []) {
    const idx = names.indexOf(normalizeHeaderCell(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * 取某节唯一的登记表块;零块或多块都停下报错。
 * @param {Array<object>} blocks 块视图
 * @param {string} section 节名
 * @returns {object} 该节唯一的块
 */
function pickBlock(blocks, section) {
  const candidates = blocks.filter((b) => b.section === section);
  if (candidates.length === 0) {
    const known = [...new Set(blocks.map((b) => b.section))].filter(Boolean).join(" / ");
    throw new ToolError(`没有「## ${section}」节的登记表块(表头须同时含「号」与「状态」);台账里的节:${known || "(无)"}`);
  }
  if (candidates.length > 1) {
    throw new ToolError(
      `「## ${section}」节里有 ${String(candidates.length)} 个「表头含号且含状态」的表块,判不出该锚哪一块 —— 停下,请人工裁决(合并或改表头)后重跑`,
    );
  }
  return candidates[0];
}

/**
 * 跨节合并行集里按号找行。
 * @param {ReturnType<typeof locateRegistry>} registry 登记表定位结果
 * @param {string} id 号
 * @returns {object | null} 命中的行;没有为 `null`
 */
function findRow(registry, id) {
  return registry.rows.find((r) => normalizeLedgerCell(r.cells[r.idCol] ?? "") === id) ?? null;
}

/**
 * 找到某一行所属的块(拿表头才能按名取列)。
 * @param {Array<object>} blocks 块视图
 * @param {number} lineNo 行号
 * @returns {object} 该块
 */
function blockOfRow(blocks, lineNo) {
  const block = blocks.find((b) => b.rows.some((r) => r.lineNo === lineNo));
  if (!block) throw new ToolError(`第 ${String(lineNo)} 行不属于任何登记表块(内部不一致)`);
  return block;
}

/**
 * 核心判据:列数与表头不符 ⇒ 该行的列映射不可信 ⇒ 拒绝。
 *
 * 这一条是本工具存在的理由之一:错位行照样渲染成表,门禁按列名取列读到的仍是「一个完整字段集」,
 * 只是**每一个字段都是错的**。返回半截字段比直接崩掉更坏 —— 它看起来是对的。
 * @param {{ cells: string[], headerCount: number, lineNo: number, section: string }} row 数据行
 * @returns {void} 抛错即失败
 */
function assertRowShape(row) {
  if (row.cells.length !== row.headerCount) {
    throw new ToolError(
      `第 ${String(row.lineNo)} 行(节「${row.section}」)列数与表头不符:实际 ${String(row.cells.length)} 格 / 表头 ${String(row.headerCount)} 列,解析不可信 —— 本工具拒绝按列名下标取字段,请先人工修好这一行`,
    );
  }
}

/**
 * 该列的字数上限;`null` 表示本仓没有对应常量(不判)。
 * @param {object} block 块视图
 * @param {number} col 列下标
 * @param {string} section 目标节名(转「已完成」要降档,故按**目标**节算)
 * @returns {number | null} 上限
 */
function limitForColumn(block, col, section) {
  if (block.titleCol !== -1 && col === block.titleCol) return TITLE_LIMIT;
  if (block.whyCol !== -1 && col === block.whyCol) {
    return section.includes(SECTION_DONE) ? WHY_LIMIT_DONE : WHY_LIMIT;
  }
  return null;
}

/**
 * 超上限即拒绝并指路,**绝不截断**。
 * @param {string} key 键名
 * @param {string} value 值
 * @param {number} limit 上限
 * @param {string} label 字段中文名
 * @returns {void} 合规则空
 */
function assertWithinLimit(key, value, limit, label) {
  const n = charLen(value);
  if (n <= limit) return;
  throw new ToolError(
    `${label}「${key}」${String(n)} 字 > 上限 ${String(limit)} 字。写不下不等于丢掉:` +
      `展开部分进 \`docs/evidence/\`(过程)或升 \`docs/adr/ADR-0NN-*.md\`(是决定),由「分析在哪」列指过去 —— 本工具不截断`,
  );
}

/**
 * 值里不许有竖线或换行(两者都会把表格切坏,且切坏之后不报错)。
 * @param {string} key 键名
 * @param {string} value 值
 * @returns {string} trim 后的值
 */
function assertCellValue(key, value) {
  const trimmed = value.trim();
  if (/[|\r\n]/.test(trimmed)) {
    throw new ToolError(`「${key}」的值里含竖线或换行,会把表格切坏 —— 请改成不含 \`|\` 的文字`);
  }
  return trimmed;
}

/**
 * 号的形态校验,并把「将超出三位」单独成句(那是需要用户裁决的形状变更,不是形态错)。
 * @param {string} value 值
 * @param {string} label 诊断标签
 * @returns {string} 原值(合法时)
 */
function assertReqId(value, label) {
  if (REQ_ID_RE.test(value)) return value;
  if (REQ_ID_WIDE_RE.test(value)) {
    throw new ToolError(
      `${label} = ${value} 已超出三位(三位最多到 REQ-999)。扩位是全表形状变更,本工具不自行扩位 —— 请先取得用户裁决`,
    );
  }
  throw new ToolError(`${label}的值 ${JSON.stringify(value)} 不合形态(须形如 REQ-003)`);
}

/**
 * 当前状态下的合法目标状态。
 * @param {string} status 当前状态
 * @returns {string[]} 合法目标;当前状态不在取值域内返回空数组
 */
function legalTargets(status) {
  return [...(LEGAL_EDGES[status] ?? [])];
}

/**
 * 校验状态流转边。
 * @param {string} from 当前状态
 * @param {string} to 目标状态
 * @returns {void} 合法则空
 */
function assertEdge(from, to) {
  if (!STATUS_DOMAIN.includes(from)) {
    throw new ToolError(`该行当前状态「${from}」不在状态取值域(${STATUS_DOMAIN.join(" / ")})内 —— 请先人工核对`);
  }
  const targets = legalTargets(from);
  if (!targets.includes(to)) {
    throw new ToolError(`非法流转边:「${from}」不能直接到「${to}」;合法目标是:${targets.join(" / ") || "(无,已是终态)"}`);
  }
}

/**
 * 提交新内容:零改动不动文件(不碰 mtime)、落盘前重读比对哈希(TOCTOU)。
 *
 * **为什么是「重读比对内容」而不是「文件有未提交改动就拒绝」**:台账在正常流程里几乎总是 dirty
 * —— 你刚编辑过它就正要加行。改成 dirty 就拒,工具立刻不可用。真正要挡的是「读-改-写之间
 * 别人改了同一个文件」,判据只能是内容:读时记哈希、落盘前重读,不一致就退让。
 * @param {{ path: string, text: string, hash: string }} ledger 读到的台账
 * @param {string} newText 新内容
 * @param {string} describe 成功时打印的一句话
 * @returns {number} 退出码
 */
function commit(ledger, newText, describe) {
  if (newText === ledger.text) {
    console.log(`无变化:${describe}`);
    return 0;
  }
  const current = hashBuffer(readFileSync(ledger.path));
  if (current !== ledger.hash) {
    throw new ToolError("文件在你读之后被改过,已放弃写入(请重跑一次,让改动与读取对齐)");
  }
  writeFileAtomic(ledger.path, newText);
  console.log(describe);
  return 0;
}

/**
 * 构造「删源行 + 插目标表末尾 + 必要时补一个空行」的行操作。
 *
 * 空行为什么是条件性的:搬空一节后形状必须是「表头 + 分隔行 + 空行 + 下一个 `## `」,而台账本来
 * 就长这样时不该多插一行。源节的最后一行被搬空时,分隔行下面若**紧跟**非空行(下一行就是下一个
 * `## `,即已被人为删掉过空行),补一个;已经是空行则不补 —— 补了就是「空行后面又空行」。
 *
 * @param {string[]} rawLines 原始行序列
 * @param {object} source 源块视图
 * @param {number} sourceRowLineNo 被删的行号
 * @param {number} anchor 目标插入锚点行号
 * @param {string} newLine 目标行文本
 * @returns {{ remove: number[], inserts: Array<{ after: number, lines: string[] }> }} 行操作
 */
function moveLineOps(rawLines, source, sourceRowLineNo, anchor, newLine) {
  /** @type {Array<{ after: number, lines: string[] }>} */
  const inserts = [{ after: anchor, lines: [newLine] }];
  const emptied = source.rows.every((r) => r.lineNo !== sourceRowLineNo);
  if (emptied && source.separatorLineNo !== null) {
    const afterNo = source.separatorLineNo + 1;
    const following = rawLines[afterNo - 1];
    if (following !== undefined && following.trim() !== "") {
      // 锚在分隔行而不是分隔行的下一行:后者正是被删掉的那一行,锚它等于不锚
      inserts.push({ after: afterNo === sourceRowLineNo ? source.separatorLineNo : afterNo, lines: [""] });
    }
  }
  return { remove: [sourceRowLineNo], inserts };
}

/**
 * 按行拆出 `键=值` 对。
 * @param {string[]} tokens 参数数组
 * @param {boolean} required 是否至少要一对
 * @returns {Map<string, string>} 键 → 值
 */
function parsePairs(tokens, required) {
  const pairs = new Map();
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      throw new ToolError(`无法识别的参数:${token}(列名与值须形如 键=值)`);
    }
    const key = token.slice(0, eq);
    if (pairs.has(key)) throw new ToolError(`列「${key}」给了两次`);
    pairs.set(key, token.slice(eq + 1));
  }
  if (required && pairs.size === 0) throw new ToolError("至少要给一个 键=值");
  return pairs;
}

/**
 * 拆 `add` 的参数:首个位置参数是标题,其余是 `键=值`;标题也可由 `标题=` 给。
 * @param {string[]} args 参数数组
 * @returns {{ title: string, fields: Map<string, string> }} 标题 + 其余字段
 */
function parseAddArgs(args) {
  /** @type {string | null} */
  let title = null;
  /** @type {Map<string, string>} */
  const fields = new Map();
  const rest = [];
  args.forEach((token, idx) => {
    const eq = token.indexOf("=");
    if (eq === -1) {
      if (idx === 0 && title === null) {
        title = token;
        return;
      }
      rest.push(token);
      return;
    }
    const key = token.slice(0, eq);
    if (fields.has(key)) throw new ToolError(`键「${key}」给了两次`);
    fields.set(key, token.slice(eq + 1));
  });
  if (rest.length > 0) {
    throw new ToolError(`无法识别的参数:${rest[0]}(键值对须形如 键=值)`);
  }
  if (fields.has("标题")) {
    if (title !== null && title !== fields.get("标题")) {
      throw new ToolError("标题给了两次且不一致(位置参数与 `标题=` 键)");
    }
    title = fields.get("标题");
  }
  fields.delete("标题");
  if (title === null || title.trim() === "") {
    throw new ToolError("缺少标题(首个位置参数,或 `标题=` 键,两者给其一)");
  }
  return { title, fields };
}

/**
 * 命令 `next`:只打印号段表里的「下一个可用号」。取号**只**认这一格。
 * @param {{ file: string }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdNext({ file }) {
  const ledger = readLedger(file);
  const range = rangeTable(ledger.text);
  if (!range) throw new ToolError("定位不到号段小表(表头首格「项」、次格「值」)");
  if (range.next === null) throw new ToolError("号段小表里没有「下一个可用号」那一行");
  const value = assertReqId(range.next, "下一个可用号");
  if (value === `REQ-${String(MAX_THREE_DIGITS).padStart(3, "0")}`) {
    console.error(`提示:号段已到三位上限(${value});发掉它之后下一个号需要扩位,届时须先取得用户裁决`);
  }
  console.log(value);
  return 0;
}

/**
 * 命令 `show`:一字段一行。列数与表头不符直接拒绝,绝不输出看似完整的字段集。
 * @param {{ file: string, args: string[] }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdShow({ file, args }) {
  const id = assertReqId(args[0] ?? "", "号");
  const ledger = readLedger(file);
  const registry = locateRegistry(ledger.text);
  if (!registry) throw new ToolError("定位不到登记表(表头须同时含「号」与「状态」)");
  const row = findRow(registry, id);
  if (!row) throw new ToolError(`台账里没有 ${id} 这一行`);
  assertRowShape(row);
  const block = blockOfRow(parseLedger(ledger.text).blocks, row.lineNo);
  const cell = (col) => (col === -1 ? "(该表无此列)" : row.cells[col] ?? "");
  console.log(`号: ${normalizeLedgerCell(row.cells[row.idCol] ?? "")}`);
  console.log(`标题: ${cell(block.titleCol)}`);
  console.log(`状态: ${normalizeLedgerCell(row.cells[row.statusCol] ?? "")}`);
  console.log(`为什么停在这: ${cell(block.whyCol)}`);
  console.log(`什么条件下重看: ${cell(resolveColumn(block.names, "什么条件下重看"))}`);
  console.log(`分析在哪: ${cell(resolveColumn(block.names, "分析在哪"))}`);
  return 0;
}

/**
 * 命令 `pool`:扫「待拍板」「在办」两节。列错位行必须出声,且不输出它的字段。
 * @param {{ file: string }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdPool({ file }) {
  const ledger = readLedger(file);
  const { blocks } = parseLedger(ledger.text);
  for (const block of blocks) {
    if (!POOL_SECTIONS.includes(block.section)) continue;
    for (const row of block.rows) {
      if (row.cells.length !== block.headerCells.length) {
        console.error(
          `列错位:节「${block.section}」第 ${String(row.lineNo)} 行 实际 ${String(row.cells.length)} 格 / 表头 ${String(block.headerCells.length)} 列` +
            `(表头:${block.headerCells.join(" | ")}) —— 该行不输出字段`,
        );
        continue;
      }
      const id = normalizeLedgerCell(row.cells[block.idCol] ?? "");
      const status = normalizeLedgerCell(row.cells[block.statusCol] ?? "");
      console.log(`- ${id} [${status}] ${block.titleCol === -1 ? "" : (row.cells[block.titleCol] ?? "")}`);
    }
  }
  return 0;
}

/**
 * 命令 `add`:在「待拍板」节最后一个数据行之后追加一行,并同步号段两格。
 * @param {{ file: string, args: string[] }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdAdd({ file, args }) {
  const { title, fields } = parseAddArgs(args);
  for (const key of fields.keys()) {
    if (key === "号") throw new ToolError("「号」由号段表分配,不能手写(号永不复用)");
    if (!ADD_KEYS.includes(key)) {
      throw new ToolError(`不认识的键「${key}」;可写的是:${ADD_KEYS.join(" / ")}(状态初值固定为「${SECTION_PENDING}」)`);
    }
  }
  const ledger = readLedger(file);
  const range = rangeTable(ledger.text);
  if (!range) throw new ToolError("定位不到号段小表(表头首格「项」、次格「值」)");
  if (range.next === null || range.nextLine === null || range.maxLine === null) {
    throw new ToolError("号段小表缺格:「已用最大号」与「下一个可用号」两行都要在,否则号段状态不明");
  }
  const newId = assertReqId(range.next, "下一个可用号");
  const nextNumber = Number(newId.slice(4));
  if (nextNumber >= MAX_THREE_DIGITS) {
    throw new ToolError(
      `发掉 ${newId} 之后下一个号将是 REQ-${String(nextNumber + 1)},会超出三位 —— 本工具不自行扩位,请先取得用户裁决`,
    );
  }
  const { blocks } = parseLedger(ledger.text);
  const target = pickBlock(blocks, SECTION_PENDING);
  if (target.idCol === -1 || target.statusCol === -1) {
    throw new ToolError(`「## ${SECTION_PENDING}」节表头须同时含「号」与「状态」,实际:${target.headerCells.join(" | ")}`);
  }
  const values = new Map();
  values.set("标题", assertCellValue("标题", title));
  for (const [key, value] of fields) values.set(key, assertCellValue(key, value));
  for (const key of values.keys()) {
    if (resolveColumn(target.names, key) === -1) {
      throw new ToolError(`「## ${SECTION_PENDING}」节表头没有可写的列「${key}」;该表头:${target.headerCells.join(" | ")}`);
    }
  }
  const registry = locateRegistry(ledger.text);
  if (registry && findRow(registry, newId)) {
    throw new ToolError(`${newId} 已经出现在台账里 —— 号段表与数据行不一致,请先修号段表再登记(号永不复用)`);
  }
  const cells = new Array(target.headerCells.length).fill("");
  for (const [key, value] of values) {
    const col = resolveColumn(target.names, key);
    assertWithinLimit(key, value, limitForColumn(target, col, target.section) ?? Number.MAX_SAFE_INTEGER, "列");
    cells[col] = value;
  }
  cells[target.idCol] = newId;
  cells[target.statusCol] = SECTION_PENDING;
  const anchor =
    target.rows.length > 0
      ? target.rows[target.rows.length - 1].lineNo
      : target.separatorLineNo;
  if (anchor === null) {
    throw new ToolError(`「## ${SECTION_PENDING}」节没有分隔行,表形状不合法,停下不写`);
  }
  const rawLines = ledger.lines;
  const newLine = renderRow(cells);
  const nextAfter = `REQ-${String(nextNumber + 1).padStart(3, "0")}`;
  const replace = new Map([
    [range.maxLine, rewriteCell(rawLines[range.maxLine - 1], 1, newId, "「已用最大号」")],
    [range.nextLine, rewriteCell(rawLines[range.nextLine - 1], 1, nextAfter, "「下一个可用号」")],
  ]);
  const out = applyLineOps(rawLines, { replace, inserts: [{ after: anchor, lines: [newLine] }] });
  return commit(ledger, out.join(ledger.eol), `已在「${SECTION_PENDING}」节追加 ${newId}(号段两格已同步,下一个可用号 ${nextAfter})`);
}

/**
 * 命令 `set`:改一至多列。给了跨节的 `状态` 就委派给同一条搬行路径(不设第二条路径)。
 * @param {{ file: string, args: string[] }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdSet({ file, args }) {
  const id = assertReqId(args[0] ?? "", "号");
  const pairs = parsePairs(args.slice(1), true);
  for (const key of pairs.keys()) {
    if (key === "号") throw new ToolError("「号」列不可改 —— 号在登记那一刻定下,此后不再更换");
    if (!SET_KEYS.includes(key)) {
      throw new ToolError(`不认识的列名「${key}」;可改的是:${SET_KEYS.join(" / ")}`);
    }
  }
  const ledger = readLedger(file);
  const registry = locateRegistry(ledger.text);
  if (!registry) throw new ToolError("定位不到登记表(表头须同时含「号」与「状态」)");
  const row = findRow(registry, id);
  if (!row) throw new ToolError(`台账里没有 ${id} 这一行`);
  assertRowShape(row);
  const block = blockOfRow(parseLedger(ledger.text).blocks, row.lineNo);
  const currentStatus = normalizeLedgerCell(row.cells[block.statusCol] ?? "");

  /** @type {Map<number, string>} */
  const updates = new Map();
  let targetStatus = null;
  for (const [key, value] of pairs) {
    const col = resolveColumn(block.names, key);
    if (col === -1) {
      throw new ToolError(`${id} 所在节的表头没有列「${key}」;该表头:${block.headerCells.join(" | ")}`);
    }
    if (key === "状态") {
      const normalized = normalizeLedgerCell(assertCellValue(key, value));
      if (normalized === "") throw new ToolError("「状态」不能为空");
      if (!STATUS_DOMAIN.includes(normalized)) {
        throw new ToolError(`「${normalized}」不在状态取值域内;取值域是:${STATUS_DOMAIN.join(" / ")}`);
      }
      targetStatus = normalized;
      continue;
    }
    updates.set(col, assertCellValue(key, value));
  }
  const crossSection = targetStatus !== null && STATUS_SECTION[targetStatus] !== row.section;
  const targetSection = crossSection ? STATUS_SECTION[targetStatus] : row.section;
  if (targetStatus !== null && targetStatus !== currentStatus) assertEdge(currentStatus, targetStatus);
  for (const [col, value] of updates) {
    const limit = limitForColumn(block, col, targetSection);
    if (limit !== null) assertWithinLimit(block.names[col] ?? "", value, limit, "列");
  }
  const rawLines = ledger.lines;
  if (rawLines[row.lineNo - 1] !== row.text) {
    throw new ToolError(`第 ${String(row.lineNo)} 行与读到的原文不一致(内部不一致),停下不写`);
  }
  const cells = [...row.cells];
  for (const [col, value] of updates) cells[col] = value;
  if (targetStatus !== null) cells[block.statusCol] = targetStatus;
  const newLine = renderRow(cells);
  if (!crossSection) {
    const changed = newLine !== rawLines[row.lineNo - 1];
    const out = applyLineOps(rawLines, changed ? { replace: new Map([[row.lineNo, newLine]]) } : {});
    const changedCols = [...updates.keys()].concat(targetStatus === null ? [] : [block.statusCol]).length;
    return commit(ledger, out.join(ledger.eol), `已改 ${id} 的 ${String(changedCols)} 列(第 ${String(row.lineNo)} 行)`);
  }
  const blocks = parseLedger(ledger.text).blocks;
  const targetBlock = pickBlock(blocks, targetSection);
  const anchor = targetBlock.rows.length > 0 ? targetBlock.rows[targetBlock.rows.length - 1].lineNo : targetBlock.separatorLineNo;
  if (anchor === null) throw new ToolError(`「## ${targetSection}」节没有分隔行,表形状不合法,停下不写`);
  const ops = moveLineOps(rawLines, block, row.lineNo, anchor, newLine);
  const out = applyLineOps(rawLines, ops);
  return commit(ledger, out.join(ledger.eol), `已改 ${id} 并从「${row.section}」节搬进「${targetSection}」节(状态 ${currentStatus} → ${String(targetStatus)})`);
}

/**
 * 命令 `move`:删源行 + 在目标表最后一个数据行之后插入 + 改状态列。状态**只**由目标节推导。
 * @param {{ file: string, args: string[] }} ctx 命令上下文
 * @returns {number} 退出码
 */
function cmdMove({ file, args }) {
  const id = assertReqId(args[0] ?? "", "号");
  const targetSectionName = args[1];
  if (targetSectionName === undefined) throw new ToolError("用法:req-edit move <号> <目标节>");
  const ledger = readLedger(file);
  const registry = locateRegistry(ledger.text);
  if (!registry) throw new ToolError("定位不到登记表(表头须同时含「号」与「状态」)");
  const row = findRow(registry, id);
  if (!row) throw new ToolError(`台账里没有 ${id} 这一行`);
  assertRowShape(row);
  const blocks = parseLedger(ledger.text).blocks;
  const block = blockOfRow(blocks, row.lineNo);
  const currentStatus = normalizeLedgerCell(row.cells[block.statusCol] ?? "");
  const derived = SECTION_STATUS[targetSectionName];
  if (derived === undefined) {
    const targets = legalTargets(currentStatus);
    if (targetSectionName === SECTION_PENDING) {
      throw new ToolError(
        `「${SECTION_PENDING}」节同时容纳状态「待拍板」与「未开工」,无法由节名唯一推导状态 —— 本工具不猜。` +
          `${id} 当前状态「${currentStatus}」,合法目标是:${targets.join(" / ")};` +
          `同节内换状态用 set ${id} 状态=待拍板`,
      );
    }
    throw new ToolError(
      `目标节「${targetSectionName}」不存在,或其状态无法由节名唯一推导;本工具只接受:${Object.keys(SECTION_STATUS).join(" / ")}`,
    );
  }
  if (derived !== currentStatus) assertEdge(currentStatus, derived);
  const cells = [...row.cells];
  cells[block.statusCol] = derived;
  const newLine = renderRow(cells);
  const rawLines = ledger.lines;
  if (rawLines[row.lineNo - 1] !== row.text) {
    throw new ToolError(`第 ${String(row.lineNo)} 行与读到的原文不一致(内部不一致),停下不写`);
  }
  if (targetSectionName === row.section) {
    const changed = newLine !== rawLines[row.lineNo - 1];
    const out = applyLineOps(rawLines, changed ? { replace: new Map([[row.lineNo, newLine]]) } : {});
    return commit(ledger, out.join(ledger.eol), `已改 ${id} 的状态列(同节内换,行未移动:${currentStatus} → ${derived})`);
  }
  const targetBlock = pickBlock(blocks, targetSectionName);
  const anchor = targetBlock.rows.length > 0 ? targetBlock.rows[targetBlock.rows.length - 1].lineNo : targetBlock.separatorLineNo;
  if (anchor === null) throw new ToolError(`「## ${targetSectionName}」节没有分隔行,表形状不合法,停下不写`);
  const ops = moveLineOps(rawLines, block, row.lineNo, anchor, newLine);
  const out = applyLineOps(rawLines, ops);
  return commit(ledger, out.join(ledger.eol), `已把 ${id} 从「${row.section}」节搬进「${targetSectionName}」节(状态 ${currentStatus} → ${derived})`);
}

/** 命令名 → 实现;新命令只加这一处 */
const COMMANDS = Object.freeze({
  next: cmdNext,
  show: cmdShow,
  pool: cmdPool,
  add: cmdAdd,
  set: cmdSet,
  move: cmdMove,
});

/**
 * 把 argv 拆成位置参数与选项 token(选项部分交 `parseArgs`,故 `--file` 的取值一并带上)。
 * @param {string[]} argv 进程参数
 * @returns {{ positionals: string[], options: Record<string, string | boolean> }} 拆分结果
 */
function splitArgs(argv) {
  const positionals = [];
  const optionTokens = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      optionTokens.push(token);
      if (token === "--file") {
        optionTokens.push(argv[i + 1] ?? "");
        i += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  return { positionals, options: parseArgs(optionTokens, { booleans: ["help"], values: ["file"], usage: "node tools/req-edit.mjs <命令> [参数] [--file <path>]" }) };
}

/**
 * 入口:解析参数 → 派发命令 → 失败统一落 stderr 与非零退出码。
 * @param {string[]} argv 进程参数
 * @returns {number} 退出码
 */
function main(argv) {
  /** @type {{ positionals: string[], options: Record<string, string | boolean> }} */
  let split;
  try {
    split = splitArgs(argv);
  } catch (error) {
    console.error(`${FAIL_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    return 2;
  }
  if (split.options.help) {
    console.log(USAGE);
    return 0;
  }
  const command = split.positionals[0];
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`${FAIL_PREFIX} 未知命令「${command}」;可用命令:${Object.keys(COMMANDS).join(" / ")}`);
    console.error(USAGE);
    return 2;
  }
  const file = split.options.file === undefined ? DEFAULT_LEDGER : path.resolve(String(split.options.file));
  try {
    return handler({ file, args: split.positionals.slice(1) });
  } catch (error) {
    console.error(`${FAIL_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}