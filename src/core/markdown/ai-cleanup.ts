/**
 * AI 清理：转换前对 Markdown 做保守规整，修复 AI 生成文本常见格式问题。
 * 纯函数、零 IO、可 Node 直测；保留 frontmatter 原样；位置感知跳过代码区、
 * HTML code 与 escaped 文本。
 *
 * 设计原则：只做「几乎必然符合用户意图」的归一，绝不改变语义。
 * - 智能引号/破折号归一（代码区跳过，避免破坏代码）
 * - 列表标记后补空格（-item → - item；-3 等负数字面量不误判）
 * - 去行尾空白 + 折叠 3+ 连续空行为 1 个空行（代码区跳过）
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
    ...options,
  };
  // 规则全关时禁止仅因行尾归一而改写输入；这是预处理开关关闭后的零改动契约。
  if (!opts.normalizeQuotes && !opts.fixListMarkers && !opts.trimBlankLines) return md;

  // 与正式解析共用 frontmatter 边界：仅已确认的元数据块原样保留，普通
  // `---` thematic break 仍属于正文并接受常规清理。
  const { body } = parseFrontmatter(md);
  const frontmatter = md.slice(0, md.length - body.length);
  const masked = maskProtectedRanges(body, collectProtectedMarkdownRanges(body));
  return frontmatter + restoreProtectedRanges(cleanupBody(masked.text, opts), masked.markers);
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
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) visitProtectedNodes(child, md, ranges);
  }
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
