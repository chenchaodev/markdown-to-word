/**
 * YAML frontmatter 手写解析(零依赖,不引 gray-matter)。
 * 仅支持最简子集:文档开头 `---` 块内的 `key: value` 行,
 * key 只取 title/author/date,其余忽略;value 支持单/双引号包裹;date 原样字符串。
 * 任何格式异常(首行非 --- / 缺结束 ---)→ 返回空 metadata + 原 md 为 body,
 * 不报错、不丢弃内容。
 */

export interface DocMetadata {
  title?: string;
  author?: string;
  date?: string;
}

/** 关注的 frontmatter key(其余 key 忽略,不参与封面) */
const FRONTMATTER_KEYS = new Set(["title", "author", "date"]);

interface SourceLine {
  text: string;
  /** 当前行内容结束位置(不含行尾) */
  end: number;
  /** 下一行起始位置(已消费 LF/CRLF/CR) */
  next: number;
}

/**
 * 读取从 start 开始的一行。显式识别 CRLF、LF、单独 CR，避免依赖只覆盖
 * `\r?\n` 的正则边界；调用方以 next 是否前进保证扫描终止。
 */
function readLine(md: string, start: number): SourceLine {
  let end = start;
  while (end < md.length && md[end] !== "\r" && md[end] !== "\n") end++;
  let next = end;
  if (md[end] === "\r") {
    next++;
    if (md[next] === "\n") next++;
  } else if (md[end] === "\n") {
    next++;
  }
  return { text: md.slice(start, end), end, next };
}

/** frontmatter 定界行只允许 `---` 前后水平空白，避免把相似正文当边界。 */
function isFrontmatterDelimiter(line: string): boolean {
  return /^[ \t]*---[ \t]*$/.test(line);
}

/**
 * 解析 frontmatter。
 * 规则:首行必须为 `---`(可带前后空格);解析到下一个 `---` 行结束;
 * frontmatter 块之外的内容原样返回为 body。
 */
export function parseFrontmatter(md: string): { metadata: DocMetadata; body: string } {
  const opening = readLine(md, 0);
  if (!isFrontmatterDelimiter(opening.text) || opening.next === md.length) {
    return { metadata: {}, body: md };
  }

  const contentStart = opening.next;
  let cursor = contentStart;
  while (cursor < md.length) {
    const line = readLine(md, cursor);
    if (isFrontmatterDelimiter(line.text)) {
      const metadata = parseMetadata(md.slice(contentStart, line.end));
      // 块内未命中任何已知 key → 不是 frontmatter(以 `---` 分隔线开头的
      // 普通文档)。此前无条件剥离会静默丢失中间正文。
      if (Object.keys(metadata).length === 0) return { metadata: {}, body: md };
      return { metadata, body: md.slice(line.next) };
    }
    if (line.next <= cursor) break;
    cursor = line.next;
  }
  return { metadata: {}, body: md };
}

/** 解析 frontmatter 内容行；不完整/未知行保守忽略。 */
function parseMetadata(content: string): DocMetadata {
  const metadata: DocMetadata = {};
  for (const line of content.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    if (!FRONTMATTER_KEYS.has(key)) continue;
    let value = trimmed.slice(colon + 1).trim();
    // 引号包裹(整值首尾成对单/双引号)则剥离
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (value === "") continue;
    (metadata as Record<string, string>)[key] = value;
  }
  return metadata;
}
