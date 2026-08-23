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

/**
 * 解析 frontmatter。
 * 规则:首行必须为 `---`(可带前后空格);解析到下一个 `---` 行结束;
 * frontmatter 块之外的内容原样返回为 body。
 */
export function parseFrontmatter(md: string): { metadata: DocMetadata; body: string } {
  const match = /^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  if (!match) return { metadata: {}, body: md };

  const metadata: DocMetadata = {};
  for (const line of match[1]!.split(/\r?\n/)) { // 捕获组结构保证匹配成功则 [1] 必存在
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // 空行 / 注释跳过
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue; // 非 key: value 行忽略
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
  // B3 守卫:块内未命中任何已知 key → 不是 frontmatter(以 `---` 分隔线开头的
  // 普通文档)。此前无条件剥离,夹在两个 --- 之间的正文会静默丢失且 metadata 为空。
  if (Object.keys(metadata).length === 0) return { metadata: {}, body: md };
  return { metadata, body: md.slice(match[0].length) };
}
