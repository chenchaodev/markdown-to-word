/**
 * 转换预检(转换前静态体检,单一来源):扫描 Markdown 源码层面的潜在排版问题,
 * 不触碰实际渲染管线。检查项:
 * - 越界/缺失的本地图片引用(只允许源文档目录或显式可信根目录内的相对路径);
 * - 悬空交叉引用(引用 #(eq|sec|fig|tab):label 但全文未定义对应 {#...:label});
 * - 未标注语言的代码块(``` 后无语言标识);
 * - AI 静默丢内容四类(见下方「静默丢内容」小节):本工具不认的写法会让内容**无声消失**,
 *   用户付印后才发现没了,故转换前逐条告知。它是体检不是改写,不受 AI 清理档位开关管辖
 *   (ADR-021);零 IO 纯字符串/AST 判定,不新增 node: 内建依赖(ADR-018)。
 * 本地图片边界策略由 core/image/image-path-policy.ts 的 createLocalImagePathPolicy
 * 统一提供(REF-025 #07 自本模块迁出):先做原始 src 与词法路径校验,再 realpath 后
 * 复核规范路径,symlink/junction 不得把读取目标带出可信根。策略模块自身不持有
 * node:fs 能力,realpathSync 由本层注入(见下方调用点)。
 * 无问题返回空数组(renderer 侧静默继续转换)。
 */
import { existsSync, realpathSync } from "node:fs";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "./parse.js";
import { createLocalImagePathPolicy } from "../image/image-path-policy.js";
import { ALLOWED_INLINE_TAGS } from "../markdown/html-whitelist.js";
import {
  createSourceRangeQuery,
  mergeSourceRanges,
  type SourceRange,
  type SourceRangeQuery,
} from "../markdown/source-ranges.js";
import type { ConvertWarning, KeyedWarning } from "../i18n.js";
import { crossRefNotFoundWarning, unlabeledCodeBlockWarning } from "../i18n.js";
import { imageNotFoundWarning } from "../image/image-warning.js";

/** 标签定义:{#(sec|eq|fig|tab):label}(label 含前导 #,见 core/markdown/cross-ref.ts) */
const DEF_RE = /\{\s*#(sec|eq|fig|tab):([\w-]+)\}/g;
/** 交叉引用:#(eq|sec|fig|tab):label(仅 markdown 链接节点视为引用) */
const REF_RE = /^#(eq|sec|fig|tab):([\w-]+)$/;
/** 远程/内嵌资源不检查存在性 */
const REMOTE_RE = /^(https?:|data:|blob:)/i;

/* ================= 静默丢内容四类检查的判据 =================
 * 共同的零误报前提:凡「本就会照原样排版」的位置一律不报 —— 掩码区间
 * (code/inlineCode/html/math/table,取 mdast 权威 position)内的字符不参与判定,
 * 故行内代码、围栏内、HTML 节点内、已正常解析的公式与表格天然免疫。
 * 四类之间的取舍统一为「宁可漏报也不要让正常文档弹确认框」:
 * 每条判据都要求成对/成形的信号,孤立的 \\( 或单个 $ 一律放过。 */

/** 行内代码/围栏/HTML/公式/表格节点:其覆盖的源码区间不参与静默丢内容判定 */
const MASKED_SOURCE_NODES = new Set(["code", "inlineCode", "html", "math", "inlineMath", "table"]);
/**
 * 围栏判定专用的「原文节点」集合:HTML 块与公式块里的 ``` 是块内容,不是围栏。
 * 刻意**不含** code/inlineCode —— remark 给未闭合围栏建的 code 节点恰好从围栏行
 * 开始,拿它当掩码会把要检的那一行自己挡掉。
 */
const RAW_TEXT_SOURCE_NODES = new Set(["html", "math", "inlineMath"]);

/**
 * ① 不被支持的公式定界符(AI 的 LaTeX 习惯形态):本工具只认 $…$ / $$…$$
 * (remark-math),`\(` `\[` 会被 Markdown 当转义序列,只按普通字符印出,公式不渲染。
 * 只认**成对形态的开侧**:孤立的 `\)` / `\]` 更常见于普通转义(如 Windows 路径
 * `C:\dir\`),要求配对把这一类误报挡在外面。
 */
const LATEX_DELIMITER_PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
]);
/** 公式体长度上限:超长即判非公式(长句子的 \( \) 形态不算公式) */
const MAX_MATH_BODY = 200;
/** 公式体内出现 CJK 即判非公式:中文括注/目录名与公式同形,而公式体几乎必为 ASCII */
const CJK_RE = /[⺀-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

/** ② HTML 标签名(开/闭/自闭合同形;属性不参与判定,只判标签名是否在行内白名单内) */
const HTML_TAG_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)/g;

/**
 * ③ 行内公式开定界符 `$` 的合法后继:TeX 记号起点。数字、空白与中日韩字符
 * 刻意排除 —— 货币写法(`$5`、`$100`、`单价$USD`、`价格 $5 与 50$`)因此永不入列。
 */
const MATH_OPENER_FOLLOWER_RE = /[A-Za-z\\{^_]/;
/** 公式体的 TeX 信号:未配对的 `$` 之后须在窗口内出现其一,否则更可能是散文里的 `$` */
const TEX_SIGNAL_RE = /[\^_\\{}=+*]/;
const TEX_SIGNAL_WINDOW = 16;
/** 告警里回显的上下文半径(字符):够用户定位,又不至于把整段正文塞进对话框 */
const SNIPPET_RADIUS = 16;

/** ④ 形似表格行:一行内至少这么多个未掩码 `|`(围栏/行内代码内的不算) */
const TABLE_LIKE_MIN_PIPES = 2;
/** ④ 段内竖线数相同的连续子段至少这么长才算一段伪表格(单行、以及列数不齐的散文都不算) */
const TABLE_LIKE_MIN_LINES = 2;

/* ---- ③ 代码围栏未闭合(CommonMark 配对规则的行级扫描) ---- */

/** 围栏开启行:缩进 ≤3 空格,其后连续 3+ 个反引号或 3+ 个波浪号 */
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** 围栏闭合行:同种标记,其后只允许空白(有 info string 即不算闭合) */
const FENCE_CLOSE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;
/** 引用块标记:`>` 前至多 3 空格,其后至多 1 个空白;逐层剥离 */
const QUOTE_PREFIX_RE = /^ {0,3}>[ \t]?/;

/* ================= 静默丢内容告警构造(本模块自持,不进 i18n.ts 逻辑层) ================= */

/** ① 告警:不报定界符实例(全文一条),报出来也没法逐个改 —— 关键是让用户知道该改什么 */
function unsupportedMathDelimiterWarning(): KeyedWarning {
  return {
    key: "warn.unsupportedMathDelimiter",
    fallback: "`\\(` / `\\[` 不是本工具支持的公式定界符,会按普通文字印出而不渲染公式;请改用 `$…$`(行内)或 `$$…$$`(独立成行)",
  };
}

/** ② 告警:tag 为白名单外的标签名(报名字不报「有非法标签」,用户要照着改) */
function htmlTagNotAllowedWarning(tag: string): KeyedWarning {
  return {
    key: "warn.htmlTagNotAllowed",
    params: { tag },
    fallback: `HTML 标签 <${tag}> 不在支持范围内,其内容会被丢弃;请改用 Markdown 语法或纯文本`,
  };
}

/** ③ 告警:snippet 为未配对 `$` 附近的源码片段(沿用既有「推送期无法翻译的原文参数」口径) */
function unpairedMathDelimiterWarning(snippet: string): KeyedWarning {
  return {
    key: "warn.unpairedMathDelimiter",
    params: { snippet },
    fallback: `公式定界符 $ 未配对(疑似:${snippet});未配对的 $ 会按普通文字印出,请补齐闭合的 $`,
  };
}

/**
 * ③ 告警:lineNo 为未闭合围栏的**起始行号**(number,1-based,用户据此定位)。
 * 键名带类型语义(…No = 行号),与 ④ 的 lineText(行内容,string)不共用 `line` ——
 * 同一键在两条告警上异型会让渲染层按字符串/按数字使用时踩雷。
 * blocksMerge:五类里唯一会连带吞掉**别的文件**的一类(合并时跨越文件边界),
 * 故带该信号让合并流程阻断(字段语义见 core/i18n.ts 的 KeyedWarning)。
 * 措辞只说事实:内容照样显示,只是变成一个代码块 —— 早前写成「不显示」是错的,
 * 用户按那句理解会以为「该消失却还在」(GUI 实测 2026-09-27 反馈)。
 */
function unclosedCodeFenceWarning(lineNo: number): KeyedWarning {
  return {
    key: "warn.unclosedCodeFence",
    params: { lineNo },
    fallback: `代码围栏没有闭合(第 ${lineNo} 行开始):它之后的内容会被整段当作一个代码块显示 —— 标题、表格、公式都会变成代码文本。请补上收尾的围栏。`,
    blocksMerge: true,
  };
}

/** ④ 告警:lineText 为形似表格段落的**首行内容**(string,整段只报一次,不逐行刷屏) */
function tableLikeNotParsedWarning(lineText: string): KeyedWarning {
  return {
    key: "warn.tableLikeNotParsed",
    params: { lineText },
    fallback: `这段形似表格但未按表格排版(首行:${lineText});请在首行下补一行分隔行(如 | --- | --- |)`,
  };
}

export interface PrecheckDeps {
  /** 文件存在性判定(注入点:默认 node:fs.existsSync);仅在边界校验通过后调用。 */
  exists?: (p: string) => boolean;
  /** 显式可信根目录(默认可信范围仅 baseDir)。 */
  trustedRoots?: readonly string[];
  /** realpath 同步注入点,用于平台可移植的链接越界测试。 */
  realpathSync?: (candidate: string) => string;
}

/**
 * 预检 Markdown 源码。content 为文件文本,baseDir 为文件所在目录(用于解析
 * 相对图片路径)。解析异常时返回 [] 不阻断转换(转换管线有独立解析与报错)。
 */
export function precheckMarkdown(
  content: string,
  baseDir: string,
  deps: PrecheckDeps = {},
): ConvertWarning[] {
  const exists = deps.exists ?? existsSync;
  const localImagePolicy = createLocalImagePathPolicy({
    baseDir,
    trustedRoots: deps.trustedRoots,
    // 策略模块不持有 node:fs 能力(REF-025 #07),realpathSync 由本层注入。
    // deps 侧保持可选 + 默认 node:fs.realpathSync:预检段的 14 个调用点与
    // PrecheckDeps 公开形状因此零改动,而 deps 注入仍能替换它做可移植的越界测试。
    realpathSync: deps.realpathSync ?? realpathSync,
  });
  let ast: unknown;
  try {
    ast = parseMarkdown(content);
  } catch {
    return [];
  }

  const defined = new Set<string>();
  const refs: Array<{ kind: string; label: string }> = [];
  const warnings: ConvertWarning[] = [];
  // 静默丢内容四类的中间产物:掩码区间(源码偏移)/白名单外标签/未配对 $ 片段
  const ranges: SourceRange[] = [];
  // 围栏判定另用一份窄掩码(仅 HTML/公式块):见 RAW_TEXT_SOURCE_NODES 的理由
  const rawTextRanges: SourceRange[] = [];
  const disallowedTags = new Set<string>();
  const unpairedMath: string[] = [];
  const unpairedMathSeen = new Set<string>();

  // mdast 节点异构,字段按需访问;visit 的树参数与节点类型此处统一放宽
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(ast as any, (node: any): void => {
    if (!node || typeof node.type !== "string") return;
    // 掩码区间先于各分支登记:分支里的提前 return(如远程图片)不得让区间漏登记
    const range = nodeRange(node);
    if (range) {
      if (RAW_TEXT_SOURCE_NODES.has(node.type)) rawTextRanges.push(range);
      if (MASKED_SOURCE_NODES.has(node.type)) ranges.push(range);
    }
    if (node.type === "image") {
      const url: string = node.url ?? "";
      if (!url || REMOTE_RE.test(url)) return;
      const resolution = localImagePolicy.resolveSync(url);
      if (!resolution.filePath || !exists(resolution.filePath)) warnings.push(imageNotFoundWarning(url));
    } else if (node.type === "code") {
      const lang: string = node.lang ?? "";
      if (!lang.trim()) warnings.push(unlabeledCodeBlockWarning());
    } else if (node.type === "text") {
      const value: string = node.value ?? "";
      let m: RegExpExecArray | null;
      DEF_RE.lastIndex = 0;
      while ((m = DEF_RE.exec(value))) defined.add(`${m[1]!}:${m[2]!}`);
      // ③ 只在 text 节点上判定:行内代码 / 围栏 / 公式节点都不是 text,
      // 故「代码里的 $」「已正常解析的 $x^2$」天然不进入本判据
      const snippet = unpairedMathSnippet(value);
      if (snippet !== null && !unpairedMathSeen.has(snippet)) {
        unpairedMathSeen.add(snippet);
        unpairedMath.push(snippet);
      }
    } else if (node.type === "html") {
      const value: string = node.value ?? "";
      collectDisallowedHtmlTags(value, disallowedTags);
    } else if (node.type === "link") {
      const url: string = node.url ?? "";
      const m = REF_RE.exec(url);
      if (m) refs.push({ kind: m[1]!, label: m[2]! });
    }
  });

  for (const ref of refs) {
    if (!defined.has(`${ref.kind}:${ref.label}`)) {
      warnings.push(crossRefNotFoundWarning(ref.kind, `#${ref.kind}:${ref.label}`));
    }
  }

  // 静默丢内容检查:排在既有检查之后,顺序即告警在确认框里的顺序(①②③围栏③$④)
  // 围栏判定先跑:未闭合围栏会扩大掩码,故其前后各构建一次(前一次只用窄掩码)
  const lines = splitSourceLines(content);
  const fenceStarts = findUnclosedCodeFences(lines, buildMaskedRanges(rawTextRanges), ranges);
  const masked = buildMaskedRanges(ranges);
  if (hasUnsupportedMathDelimiter(content, masked)) warnings.push(unsupportedMathDelimiterWarning());
  for (const tag of [...disallowedTags].sort()) warnings.push(htmlTagNotAllowedWarning(tag));
  for (const start of fenceStarts) warnings.push(unclosedCodeFenceWarning(start + 1));
  for (const snippet of unpairedMath) warnings.push(unpairedMathDelimiterWarning(snippet));
  for (const lineText of findTableLikeNotParsed(lines, masked)) {
    warnings.push(tableLikeNotParsedWarning(lineText));
  }
  return warnings;
}

/* ================= 静默丢内容四类的判定实现(纯函数,零 IO) ================= */

/** mdast 节点的 position 形状(只取本模块用到的偏移字段) */
interface PositionedNode {
  position?: { start: { offset?: number | null }; end: { offset?: number | null } } | null;
}

/** 掩码区间查询:offset 是否落在任一「不参与判定」的区间内 */
type MaskedRanges = SourceRangeQuery;

/** 节点覆盖的源码区间;无 position 或非正向区间返回 null */
function nodeRange(node: PositionedNode): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return { start, end };
}

/**
 * 合并区间并给出二分查询(合并与 offset 查询本身已归位到 markdown/source-ranges.ts)。
 * 节点→区间的收集与 masking 仍在本模块自持,且**刻意不复用** ai-cleanup.ts 的那份:
 * 那边的保护区把「反斜杠 + 下一字符」整段当不可改写(转义是**保护对象**),
 * 而本模块的 \( 检测恰恰要看转义形态 —— 共用会把要检的信号一起掩掉。
 * 决定与完整理由见 docs/adr/adr-025-区间判据不合并.md。
 */
function buildMaskedRanges(ranges: readonly SourceRange[]): MaskedRanges {
  return createSourceRangeQuery(mergeSourceRanges(ranges));
}

/** 从 index 起连续反斜杠的右端(不含) */
function backslashRunEnd(source: string, index: number): number {
  let end = index;
  while (source[end] === "\\") end += 1;
  return end;
}

/**
 * ① 全文是否出现成对的不被支持定界符(`\(…\)` / `\[…\]`)。
 * 判据三连:① 反斜杠连续个数为奇数(偶数个 = 已转义的反斜杠本身,`\\(` 不算);
 * ② 必须找到**同行**的配对闭侧(公式不跨行);③ 公式体非空、不超长、不含 CJK。
 * 掩码(code/inlineCode/html/math)内的定界符不参与,故围栏与行内代码免疫。
 */
function hasUnsupportedMathDelimiter(source: string, masked: MaskedRanges): boolean {
  let index = 0;
  while (index < source.length) {
    if (source[index] !== "\\") {
      index += 1;
      continue;
    }
    const runEnd = backslashRunEnd(source, index);
    const delimiter = source[runEnd];
    const backslash = index;
    index = runEnd + 1;
    if ((runEnd - backslash) % 2 === 0) continue; // 偶数个反斜杠:后随字符是普通字符
    const closer = delimiter === undefined ? undefined : LATEX_DELIMITER_PAIRS.get(delimiter);
    if (closer === undefined) continue; // 只认成对形态的开侧
    if (masked.contains(backslash) || masked.contains(runEnd)) continue;
    if (hasMathBody(source, runEnd + 1, closer, masked)) return true;
  }
  return false;
}

/** 从 bodyStart 起找配对闭侧并校验公式体;找到即返回判定结果,同行内找不到闭侧返回 false */
function hasMathBody(
  source: string,
  bodyStart: number,
  closer: string,
  masked: MaskedRanges,
): boolean {
  let index = bodyStart;
  while (index < source.length) {
    const char = source[index];
    if (char === "\n" || char === "\r") return false;
    if (char !== "\\") {
      index += 1;
      continue;
    }
    const runEnd = backslashRunEnd(source, index);
    const backslash = index;
    index = runEnd + 1;
    if ((runEnd - backslash) % 2 === 0) continue;
    if (source[runEnd] !== closer) continue;
    if (masked.contains(backslash) || masked.contains(runEnd)) continue;
    const body = source.slice(bodyStart, backslash);
    return body.length > 0 && body.length <= MAX_MATH_BODY && !CJK_RE.test(body);
  }
  return false;
}

/** ② 收集 html 节点里白名单外的标签名(只判标签名,故带属性的白名单标签同样不报) */
function collectDisallowedHtmlTags(value: string, into: Set<string>): void {
  HTML_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_TAG_RE.exec(value))) {
    const tag = match[1]!.toLowerCase();
    if (!ALLOWED_INLINE_TAGS.has(tag)) into.add(tag);
  }
}

/**
 * ③ 该 text 节点是否含未配对的 `$`,是则回显定界符附近的源码片段。
 * 候选口径:未被转义 + 后继非空白非 `$` + 后继是 TeX 记号起点(数字/中文一律排除,
 * 故 `价格 $5 与 50$` 这类写法根本不成候选)。候选数为奇数即视为末尾那个未配对;
 * 再要求其后紧邻窗口内出现 TeX 信号记号,滤掉 `单价$USD` 这类散文货币写法。
 * 转义说明:mdast 已把 `\$` 还原成字面 `$`,故只能按值内反斜杠形态判转义
 * (值里残留的反斜杠只会来自源码的 `\\`)。
 */
function unpairedMathSnippet(value: string): string | null {
  let openers = 0;
  let lastOpener = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$") continue;
    if (isEscapedIn(value, index)) continue;
    const next = value[index + 1];
    if (next === undefined || next === "$" || /\s/.test(next)) continue;
    if (!MATH_OPENER_FOLLOWER_RE.test(next)) continue;
    openers += 1;
    lastOpener = index;
  }
  if (openers % 2 === 0 || lastOpener < 0) return null;
  const body = value.slice(lastOpener + 2, lastOpener + 2 + TEX_SIGNAL_WINDOW);
  if (!TEX_SIGNAL_RE.test(body)) return null;
  return value
    .slice(Math.max(0, lastOpener - SNIPPET_RADIUS), lastOpener + SNIPPET_RADIUS + 1)
    .replace(/\s+/g, " ")
    .trim();
}

/** 该位置前紧邻的反斜杠个数是否为奇数(奇数 = 该字符被转义) */
function isEscapedIn(value: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

/** 源码行与其起始偏移(换行口径与 pipeline/parse.ts 一致:\r\n / \n / \r) */
interface SourceLine {
  text: string;
  start: number;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const breaks = /\r\n|\n|\r/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = breaks.exec(source))) {
    lines.push({ text: source.slice(cursor, match.index), start: cursor });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: source.slice(cursor), start: cursor });
  return lines;
}

/**
 * ③ 代码围栏未闭合:按 CommonMark 的围栏配对规则做**行级扫描**,不从 mdast 反推 ——
 * 未闭合围栏被 remark 吞成 code 节点到文末,从 AST 看不出「本该有闭合」。
 * 围栏内的一切行只用于找闭合行,不参与围栏开启判定(否则内容里的 ``` 会被误当新围栏);
 * 报出的未闭合围栏整段并入掩码,故其内的 |、<table>、$、\( 不进其它三类检查。
 * 落在掩码区内的行(HTML 块等)不参与判定 —— 块内的 ``` 是块内容,不是围栏。
 * @returns 未闭合围栏的起始行下标(0-based);至多一个(未闭合即吞到文末)
 */
function findUnclosedCodeFences(
  lines: readonly SourceLine[],
  masked: MaskedRanges,
  ranges: SourceRange[],
): number[] {
  const unclosed: number[] = [];
  let open: FenceOpen | null = null;
  let openStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (masked.contains(line.start)) continue;
    const marker = stripQuoteMarkers(line.text);
    if (open !== null) {
      if (fenceCloses(marker.text, open)) {
        open = null;
        openStart = -1;
      } else if (marker.text.trim() !== "" && leavesFenceBlock(marker, open)) {
        // 容器块(引用/列表项)先于文末结束:围栏只吞掉了自己那一块,后文照常排版,
        // 不属「整段消失」,故放过(零误报优先;代价见 findTableLikeNotParsed 同款取舍)
        open = null;
        openStart = -1;
      }
      continue;
    }
    const candidate = fenceOpenOf(marker);
    if (candidate === null) continue;
    open = candidate;
    openStart = index;
  }
  if (open !== null && openStart >= 0) {
    unclosed.push(openStart);
    const last = lines[lines.length - 1]!;
    ranges.push({ start: lines[openStart]!.start, end: last.start + last.text.length });
  }
  return unclosed;
}

/** 围栏开启行的标记特征 + 它所在块的上下文 */
interface FenceOpen {
  /** 标记字符(反引号或波浪号);不同字符互不闭合 */
  char: string;
  /** 标记长度;闭合行不得短于开启行 */
  length: number;
  /** 开启行的引用块层级 */
  depth: number;
  /** 开启行去掉引用前缀后的缩进列数(列表项内的围栏为 >0) */
  indent: number;
}

/** 去掉逐层引用块标记后的行:内容 / 缩进列数 / 引用层级(非引用行原样) */
function stripQuoteMarkers(line: string): LineMarker {
  let rest = line;
  let depth = 0;
  for (let match = QUOTE_PREFIX_RE.exec(rest); match; match = QUOTE_PREFIX_RE.exec(rest)) {
    rest = rest.slice(match[0].length);
    depth += 1;
  }
  return { text: rest, indent: rest.length - rest.trimStart().length, depth };
}

/** 该行是否已离开围栏所在的块(引用层级变浅,或缩进退回块外) */
function leavesFenceBlock(marker: LineMarker, open: FenceOpen): boolean {
  return marker.depth < open.depth || marker.indent < open.indent;
}

/** 去掉引用标记后的行内容及其位置特征 */
interface LineMarker {
  text: string;
  indent: number;
  depth: number;
}

/** 该行是否为围栏开启行;反引号围栏的 info string 含反引号时只是普通文本,不算围栏 */
function fenceOpenOf(marker: LineMarker): FenceOpen | null {
  const match = FENCE_OPEN_RE.exec(marker.text);
  if (!match) return null;
  const fence = match[2]!;
  const char = fence.charAt(0);
  if (char === "`" && match[3]!.includes("`")) return null;
  return { char, length: fence.length, depth: marker.depth, indent: marker.indent };
}

/** 该行是否闭合给定围栏(同种标记 + 长度不短于开启行 + 其后无 info string) */
function fenceCloses(text: string, open: FenceOpen): boolean {
  const match = FENCE_CLOSE_RE.exec(text);
  if (!match) return false;
  const fence = match[2]!;
  return fence.charAt(0) === open.char && fence.length >= open.length;
}

/**
 * ④ 形似表格却没被 gfm 解析成表的段落。判据 = 竖线数量 + **边框紧邻**两条收紧:
 * ① 每行(去缩进后)行首或行尾必须紧邻 `|` —— 真伪表格拿竖线当边框(`| 列1 | 列2 |`),
 *    散文并列比较句(`本章讨论 A | B | C 三者`)两端落在词上,故两端都不挨竖线的行会截断段;
 * ② 段内竖线数须有 ≥TABLE_LIKE_MIN_LINES 行的连续同值子段(真表格列数固定)——
 *    列数不齐的散文(`A | B | C` 与 `D | E`)凑不满即放过。
 * 竖线数不等长时**不回退整段**(那会漏掉「部分正常部分缺分隔行」的混排),
 * 只按同值子段判定成立与否,回显的仍是整段首行 —— 用户照着补分隔行才有用。
 * 已解析成 table 节点的行在掩码内,故正常表格免疫;整段只回显首行,不逐行刷屏。
 */
function findTableLikeNotParsed(lines: readonly SourceLine[], masked: MaskedRanges): string[] {
  const hits: string[] = [];
  let run: number[] = [];
  let counts: number[] = [];
  // 末位多跑一轮(index === lines.length)用于收尾:把贴着文末的连续段结掉
  for (let index = 0; index <= lines.length; index += 1) {
    const stat = index < lines.length ? tableLikeLine(lines[index]!, masked) : null;
    if (stat !== null && stat.edge) {
      run.push(index);
      counts.push(stat.count);
      continue;
    }
    if (longestEqualRun(counts) >= TABLE_LIKE_MIN_LINES) hits.push(lines[run[0]!]!.text.trim());
    run = [];
    counts = [];
  }
  return hits;
}

/** 一行的竖线统计:未掩码竖线数 + 是否行首/行尾紧邻竖线 */
interface PipeStat {
  count: number;
  edge: boolean;
}

/** 该行的竖线统计;空行或竖线不足阈值返回 null(不成候选行) */
function tableLikeLine(line: SourceLine, masked: MaskedRanges): PipeStat | null {
  if (line.text.trim() === "") return null;
  let first = -1;
  let last = -1;
  let count = 0;
  for (let index = 0; index < line.text.length; index += 1) {
    if (line.text[index] !== "|" || masked.contains(line.start + index)) continue;
    if (first < 0) first = index;
    last = index;
    count += 1;
  }
  if (count < TABLE_LIKE_MIN_PIPES) return null;
  // 行首/行尾的判据取「首个/末个非空白字符」:缩进与行尾空白都不算边框
  const head = line.text.search(/\S/);
  const tail = line.text.trimEnd().length - 1;
  return { count, edge: first === head || last === tail };
}

/** 段内竖线数相同的连续子段的最长长度(列数不齐即凑不满阈值) */
function longestEqualRun(counts: readonly number[]): number {
  let longest = 0;
  let current = 0;
  let previous = -1;
  for (const count of counts) {
    current = count === previous ? current + 1 : 1;
    previous = count;
    if (current > longest) longest = current;
  }
  return longest;
}
