/**
 * AI 清理：转换前对 Markdown 做保守规整，修复 AI 生成文本常见格式问题。
 * 纯函数、零 IO、可 Node 直测；保留 frontmatter 原样；位置感知跳过代码区、
 * HTML code、escaped 文本与链接/图片的目标 URL。
 *
 * 设计原则：只做「几乎必然符合用户意图」的归一，绝不改变语义。
 * - 智能引号/破折号归一（代码区跳过，避免破坏代码）
 * - 列表标记后补空格（-item → - item；-3 等负数字面量不误判）
 * - 去行尾空白 + 折叠 3+ 连续空行为 1 个空行（代码区跳过）
 * - 清裸数字型引用标记（[1] / 【1,2】；脚注、链接、链接定义、作者-年份式不动）
 * - 去 emoji（整体消费 ZWJ 序列/肤色/旗帜/键帽；©®™ 等文本呈现符号不动）
 * - 标题层级重整（无 h1 整体上移一级 + 补齐跳级；setext 标题不在本步范围）
 */
import type { Node } from "mdast";
import { parseFrontmatter } from "../pipeline/frontmatter.js";
import { parseMarkdown } from "../pipeline/parse.js";

export interface AiCleanupOptions {
  /** 归一智能引号(''"" → ''"") 与 en dash(– → —)，默认开 */
  normalizeQuotes?: boolean;
  /** 列表标记后补空格，默认开 */
  fixListMarkers?: boolean;
  /** 去行尾空白 + 折叠多余空行，默认开 */
  trimBlankLines?: boolean;
  /** 清裸数字型引用标记（[1] / [1,2] / 【1,2】），脚注与链接不动，默认开 */
  stripCitationMarkers?: boolean;
  /** 去 emoji（含 ZWJ 序列与肤色/旗帜/键帽等附属成分），默认开 */
  stripEmoji?: boolean;
  /** 标题层级重整（无 h1 整体上移一级 + 补齐跳级），默认开 */
  fixHeadingLevels?: boolean;
}

interface SourceRange {
  start: number;
  end: number;
}

export function cleanupMarkdown(md: string, options: AiCleanupOptions = {}): string {
  const opts: Required<AiCleanupOptions> = {
    normalizeQuotes: true,
    fixListMarkers: true,
    trimBlankLines: true,
    stripCitationMarkers: true,
    stripEmoji: true,
    fixHeadingLevels: true,
    ...options,
  };
  // 规则全关时禁止改写输入；这是预处理开关关闭后的零改动契约。
  if (
    !opts.normalizeQuotes &&
    !opts.fixListMarkers &&
    !opts.trimBlankLines &&
    !opts.stripCitationMarkers &&
    !opts.stripEmoji &&
    !opts.fixHeadingLevels
  ) {
    return md;
  }

  // 与正式解析共用 frontmatter 边界：仅已确认的元数据块原样保留，普通
  // `---` thematic break 仍属于正文并接受常规清理。
  const { body } = parseFrontmatter(md);
  const frontmatter = md.slice(0, md.length - body.length);
  // 行内类规则先在原文上跑：它们按「裸标记」判定，混在掩码文本里看不出边界。
  const stripped = stripInlineArtifacts(body, opts);
  const masked = maskProtectedRanges(stripped, collectProtectedMarkdownRanges(stripped));
  const leveled = opts.fixHeadingLevels ? fixHeadingLevels(masked.text) : masked.text;
  return frontmatter + restoreProtectedRanges(cleanupBody(leveled, opts), masked.markers);
}

/**
 * 对代码围栏、inline code、HTML code 与 Markdown escaped 文本之外的源码片段
 * 执行替换。位置范围来自正式 remark AST，避免正则跨越不应改写的语法边界。
 */
export function replaceMarkdownOutsideProtectedRegions(
  md: string,
  replaceUnprotected: (source: string) => string,
): string {
  const ranges = collectProtectedMarkdownRanges(md);
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += replaceUnprotected(md.slice(cursor, range.start));
    result += md.slice(range.start, range.end);
    cursor = range.end;
  }
  return result + replaceUnprotected(md.slice(cursor));
}

/**
 * 裸数字型引用标记：`[1]` / `[1,2]` / `[1,3-5]` / `【1,2】`（容忍空格）。
 * - `(?<![!^\\])` 挡掉 `![…]`；`[^1]` 天然不匹配（`[` 后必须紧跟数字）。
 * - `(?![([:])` 挡掉 `[文本](url)` / `[文本][ref]` / `[1]: url` 定义行。
 * - 前置 `[ \t]*` 只在前面确有非空白字符时才吃：既避免 `见此 [1]。` 留下双空格，
 *   又不吃换行与行首缩进（缩进承载列表嵌套语义）。
 * - 反斜杠字面量无需额外处理：保护区把 `\` 与后一字符成对掩码，`\[1]` 里的
 *   `[` 落在保护区里，规则根本看不到它。
 * - 链接/图片的目标 URL 由保护区挡掉（见 pushLinkDestinationRange），所以
 *   `[下载](http://a.com/[1])` 不受影响；未处理边界：正文里手打的纯文本 URL
 *   （`见 http://a.com/[1] 报道`）没有 URL 语法可依，里面的 `[1]` 仍会被清。
 */
const BARE_CITATION_RE =
  /(?<![!^\\])(?:(?<=[^\s])[ \t]*)?\[\d+(?:[ \t]*[-,][ \t]*\d+)*\](?![([:])/g;
/** 【1,2】 版中文括号；该括号不参与 Markdown 链接语法，无需排除 `(`/`[`/`:` 形态。 */
const BARE_CITATION_CJK_RE =
  /(?<![!^\\])(?:(?<=[^\s])[ \t]*)?【\d+(?:[ \t]*[-,][ \t]*\d+)*】/g;

/**
 * emoji 簇。基底取 `\p{Emoji_Presentation}`（自带 emoji 外观的字符），外加
 * 「文本默认字符 + 变体选择符」这一支（如 `❤️`、`1️⃣`）—— 不能用
 * `\p{Extended_Pictographic}` 裸扫：它把 ©®™‼⁉ℹ〰〽㊗㊙ 等纯文本呈现符号
 * 也算成 emoji，会连正文符号一起删掉。
 * 重复段负责整体消费附属成分（不留残渣）：肤色修饰符、变体选择符、键帽
 * U+20E3、以及 ZWJ 序列的后续分量。肤色修饰符逐个枚举而非写区间：字符类内的
 * \u 转义被内联成字面字符的坑记在本文件引号归一处的注记里，逐个枚举可免疫它。
 */
const EMOJI_CLUSTER_RE =
  /(?:\p{Emoji_Presentation}|\p{Emoji}[\uFE0E\uFE0F])(?:[\u{1F3FB}\u{1F3FC}\u{1F3FD}\u{1F3FE}\u{1F3FF}]|[\uFE0E\uFE0F]|\u20E3|\u200D(?:\p{Emoji_Presentation}|\p{Emoji})[\uFE0E\uFE0F]?)*/gu;

/**
 * 行内类规则（引用标记 + emoji）合走一次保护区迭代：两者都只在正式解析划出的
 * 保护区之外替换，合并可避免按规则数重复整篇解析。
 */
function stripInlineArtifacts(body: string, opts: Required<AiCleanupOptions>): string {
  if (!opts.stripCitationMarkers && !opts.stripEmoji) return body;
  return replaceMarkdownOutsideProtectedRegions(body, (source) => {
    let stripped = source;
    if (opts.stripCitationMarkers) {
      stripped = stripped.replace(BARE_CITATION_RE, "").replace(BARE_CITATION_CJK_RE, "");
    }
    // 删完不补空格：双空格与行首尾空格的归整是 trimBlankLines 的职责，规则互不越界。
    if (opts.stripEmoji) stripped = stripped.replace(EMOJI_CLUSTER_RE, "");
    return stripped;
  });
}

/** ATX 标题行：`#`~`######` 后须为空格/制表/行尾，最多 3 空格缩进（CommonMark 口径）。 */
const ATX_HEADING_RE = /^( {0,3})(#{1,6})(?:[ \t]|$)/;

interface AtxHeading {
  /** 井号起始偏移，用于只替换井号、其余源码逐字节保留 */
  hashStart: number;
  level: number;
}

function matchAtxHeading(line: string): AtxHeading | null {
  const match = ATX_HEADING_RE.exec(line);
  if (!match) return null;
  const indent = match[1] ?? "";
  const hashes = match[2] ?? "";
  return { hashStart: indent.length, level: hashes.length };
}

/**
 * 标题层级重整：全文无 h1 时整体上移一级，再把跳级补成 +1。
 * 判定要看全文（先确认有无 h1，再逐行比前一级），故先收集候选再改写；
 * `previous` 记的始终是已定稿的上一标题级别，一趟 map 等价于「先上移再补跳级」两趟。
 * 输入已掩码保护区，代码围栏内的 `# 注释` 不会进候选。
 * 边界：setext（下划线式）标题不处理——它没有 `#` 可改，判定要跨行配对，
 * 收益低于误伤风险；ATX 前缀之外的源码（`{#sec:…}` 锚点、`[[双链]]`、正文）原样保留。
 */
function fixHeadingLevels(body: string): string {
  const lines = body.split("\n");
  const headings = lines.map(matchAtxHeading);
  if (!headings.some((heading) => heading !== null)) return body;
  const shift = headings.some((heading) => heading?.level === 1) ? 0 : -1;
  let previous = 0;
  return lines
    .map((line, index) => {
      const heading = headings[index];
      if (!heading) return line;
      // Math.max 兜住 h1 上限：无 h1 才上移，h1 自身不受影响。
      const shifted = Math.max(1, heading.level + shift);
      const level = previous > 0 && shifted > previous + 1 ? previous + 1 : shifted;
      previous = level;
      return (
        line.slice(0, heading.hashStart) +
        "#".repeat(level) +
        line.slice(heading.hashStart + heading.level)
      );
    })
    .join("\n");
}

function cleanupBody(body: string, opts: Required<AiCleanupOptions>): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out = lines.map((line) => {
    let cleaned = line;
    if (opts.normalizeQuotes) {
      // 用 split/join + \u 转义(字符串字面量,非正则),避免 tsc 将 \u 内联为字面字符后
      // 在正则字符类中形成 [‘-’] 范围导致解析失败
      cleaned = cleaned
        .split("\u2018").join("'")
        .split("\u2019").join("'")
        .split("\u201C").join('"')
        .split("\u201D").join('"')
        .split("\u2013").join("\u2014");
    }
    if (opts.fixListMarkers && !/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(cleaned)) {
      const listMarker = cleaned.match(/^(\s*)([-*+](?!\d)|\d+\.)(\S)/);
      if (listMarker) cleaned = cleaned.replace(/^(\s*)([-*+](?!\d)|\d+\.)(\S)/, "$1$2 $3");
    }
    if (opts.trimBlankLines) cleaned = cleaned.replace(/\s+$/, "");
    return cleaned;
  });
  const result = out.join("\n");
  return opts.trimBlankLines ? result.replace(/\n{3,}/g, "\n\n") : result;
}

/** 收集正式解析器识别出的不可改写源码范围，并合并重叠区间。 */
function collectProtectedMarkdownRanges(md: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const ast = parseMarkdown(md);
  visitProtectedNodes(ast, md, ranges);
  // mdast 将反斜杠转义还原进 text 值；按源码位置保护「反斜杠 + 下一字符」，
  // 避免后续规则把字面量当作列表、引号或 Obsidian 双链。
  for (let index = 0; index < md.length; index++) {
    if (md[index] === "\\") ranges.push({ start: index, end: Math.min(index + 2, md.length) });
  }
  return mergeRanges(ranges);
}

function visitProtectedNodes(node: Node, md: string, ranges: SourceRange[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    start !== undefined &&
    end !== undefined &&
    (node.type === "code" || node.type === "inlineCode" || node.type === "html")
  ) {
    ranges.push({ start, end });
    extendHtmlCodeRange(md, { start, end }, ranges);
  }
  if (start !== undefined && end !== undefined && (node.type === "link" || node.type === "image")) {
    pushLinkDestinationRange(md, { start, end }, ranges);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) visitProtectedNodes(child, md, ranges);
  }
}

/**
 * link / image 节点区间内的 destination（目标 URL）源码：标签闭合 `]` 之后的
 * `](` 到节点末尾 `)` 之间，一并含 `<...>` 包裹与可选 title——它们都不是渲染文本，
 * 规则不该看见里面的字面量（否则 `[下载](http://a.com/[1])` 的 URL 会被改坏）。
 * 取「最后一个 `](`」：链接文本内允许出现成对方括号（`[见 [x](y)](z)` 的标签按括号
 * 配对结束），标签自身的 `](` 一定排在真正的 destination 之前。
 * 引用式形态（`[text][ref]` / `![alt][ref]`）没有内联 destination，目标在
 * definition 节点里，此处找不到 `](` 即自然跳过。
 */
function pushLinkDestinationRange(md: string, range: SourceRange, ranges: SourceRange[]): void {
  const source = md.slice(range.start, range.end);
  if (!source.endsWith(")")) return;
  const open = source.lastIndexOf("](");
  if (open < 0) return;
  ranges.push({ start: range.start + open + 2, end: range.end });
}

/**
 * inline `<code>`/`<pre>` 在 AST 中通常只把开始/结束标签记为 html；补齐到
 * 闭合标签，确保标签中间的源码文本同样不可改写。
 */
function extendHtmlCodeRange(md: string, range: SourceRange, ranges: SourceRange[]): void {
  const source = md.slice(range.start, range.end);
  const opening = source.match(/^<(code|pre)\b[^>]*>/i);
  if (!opening) return;
  const closingPattern = `</${opening[1]}\\s*>`;
  if (new RegExp(closingPattern, "i").test(source)) return;
  const closing = new RegExp(closingPattern, "gi");
  closing.lastIndex = range.end;
  const match = closing.exec(md);
  if (match) ranges.push({ start: range.start, end: match.index + match[0].length });
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function maskProtectedRanges(
  source: string,
  ranges: readonly SourceRange[],
): { text: string; markers: { token: string; value: string }[] } {
  if (ranges.length === 0) return { text: source, markers: [] };
  const tokenPrefix = "\uE000m2w-protected-";
  let nonce = "";
  while (source.includes(`${tokenPrefix}${nonce}`)) nonce += "x";
  const markers = ranges.map((range, index) => ({
    token: `${tokenPrefix}${nonce}-${index}\uE001`,
    value: source.slice(range.start, range.end),
  }));
  let masked = "";
  let cursor = 0;
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]!;
    masked += source.slice(cursor, range.start) + markers[index]!.token;
    cursor = range.end;
  }
  masked += source.slice(cursor);
  return { text: masked, markers };
}

function restoreProtectedRanges(
  source: string,
  markers: readonly { token: string; value: string }[],
): string {
  let restored = source;
  for (const marker of markers) restored = restored.split(marker.token).join(marker.value);
  return restored;
}
