/**
 * 转换预检(转换前静态体检,单一来源):扫描 Markdown 源码层面的潜在排版问题,
 * 不触碰实际渲染管线。检查项:
 * - 越界/缺失的本地图片引用(只允许源文档目录或显式可信根目录内的相对路径);
 * - 悬空交叉引用(引用 #(eq|sec|fig|tab):label 但全文未定义对应 {#...:label});
 * - 未标注语言的代码块(``` 后无语言标识);
 * - AI 静默丢内容四类(见下方「静默丢内容」小节):本工具不认的写法会让内容**无声消失**,
 *   用户付印后才发现没了,故转换前逐条告知。它是体检不是改写,不受 AI 清理档位开关管辖
 *   (ADR-021);零 IO 纯字符串/AST 判定,不新增 node: 内建依赖(ADR-018)。
 * 本地图片边界策略由 core/markdown/image-path-policy.ts 的 createLocalImagePathPolicy
 * 统一提供(REF-025 #07 自本模块迁出):先做原始 src 与词法路径校验,再 realpath 后
 * 复核规范路径,symlink/junction 不得把读取目标带出可信根。策略模块自身不持有
 * node:fs 能力,realpathSync 由本层注入(见下方调用点)。
 * 无问题返回空数组(renderer 侧静默继续转换)。
 */
import { existsSync, realpathSync } from "node:fs";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "./parse.js";
import { createLocalImagePathPolicy } from "../markdown/image-path-policy.js";
import { ALLOWED_INLINE_TAGS } from "../markdown/html-whitelist.js";
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

/** ④ 告警:line 为形似表格段落的**首行**(整段只报一次,不逐行刷屏) */
function tableLikeNotParsedWarning(line: string): KeyedWarning {
  return {
    key: "warn.tableLikeNotParsed",
    params: { line },
    fallback: `这段形似表格但未按表格排版(首行:${line});请在首行下补一行分隔行(如 | --- | --- |)`,
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
  const disallowedTags = new Set<string>();
  const unpairedMath: string[] = [];
  const unpairedMathSeen = new Set<string>();

  // mdast 节点异构,字段按需访问;visit 的树参数与节点类型此处统一放宽
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(ast as any, (node: any): void => {
    if (!node || typeof node.type !== "string") return;
    // 掩码区间先于各分支登记:分支里的提前 return(如远程图片)不得让区间漏登记
    const range = nodeRange(node);
    if (range && MASKED_SOURCE_NODES.has(node.type)) ranges.push(range);
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

  // 静默丢内容四类:排在既有检查之后,顺序 ①②③④ 即告警在确认框里的顺序
  const masked = buildMaskedRanges(ranges);
  if (hasUnsupportedMathDelimiter(content, masked)) warnings.push(unsupportedMathDelimiterWarning());
  for (const tag of [...disallowedTags].sort()) warnings.push(htmlTagNotAllowedWarning(tag));
  for (const snippet of unpairedMath) warnings.push(unpairedMathDelimiterWarning(snippet));
  for (const line of findTableLikeNotParsed(splitSourceLines(content), masked)) {
    warnings.push(tableLikeNotParsedWarning(line));
  }
  return warnings;
}

/* ================= 静默丢内容四类的判定实现(纯函数,零 IO) ================= */

/** 源码字节区间(半开),取自 mdast 节点的权威 position */
interface SourceRange {
  start: number;
  end: number;
}

/** mdast 节点的 position 形状(只取本模块用到的偏移字段) */
interface PositionedNode {
  position?: { start: { offset?: number | null }; end: { offset?: number | null } } | null;
}

/** 掩码区间查询:offset 是否落在任一「不参与判定」的区间内 */
interface MaskedRanges {
  contains: (offset: number) => boolean;
}

/** 节点覆盖的源码区间;无 position 或非正向区间返回 null */
function nodeRange(node: PositionedNode): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return { start, end };
}

/**
 * 合并区间并给出二分查询。合并逻辑在此另写一份而非复用 markdown/ai-cleanup.ts:
 * 那边的保护区把「反斜杠 + 下一字符」整段当不可改写(转义是**保护对象**),
 * 而本模块的 \( 检测恰恰要看转义形态 —— 共用一份会把要检的信号一起掩掉。
 */
function buildMaskedRanges(ranges: readonly SourceRange[]): MaskedRanges {
  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return {
    contains(offset: number): boolean {
      let low = 0;
      let high = merged.length - 1;
      let hit = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (merged[mid]!.start <= offset) {
          hit = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const range = hit < 0 ? undefined : merged[hit];
      return range !== undefined && offset < range.end;
    },
  };
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
