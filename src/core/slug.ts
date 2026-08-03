/**
 * 标题 slug/id 生成(二期公共底座:TOC / 书签 / 内部锚点链接三者的公共依赖)。
 * 规则:保留中文字符/字母/数字/下划线/连字符,空白转连字符,其余符号删除;
 * 重复标题追加 -2/-3 序号。docx 书签另有 Word 命名限制,提供独立 sanitize。
 */

/** 标题文本 → slug(HTML id / URL fragment 用,保留中文)。空结果回退 "section"。 */
export function slugify(text: string): string {
  const cleaned = text
    .replace(/[\s]+/g, "-") // 空白(含中文全角空格)→ 连字符
    .replace(/[^\p{L}\p{N}_-]/gu, "") // 仅保留字母(含中文)/数字/下划线/连字符
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "section";
}

/** 生成文档内唯一 id:seen 记录已用基数,重复追加 -2/-3 序号。 */
export function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugify(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

/**
 * docx 书签名(Word 命名限制:不能以数字开头、不能含空格、≤40 字符;中文允许)。
 * 传入的 slug 已无空格,此处兜底前缀与截断。
 */
export function docxBookmarkId(slug: string): string {
  let id = slug.replace(/\s+/g, "-");
  if (/^\d/.test(id)) id = `h-${id}`;
  return id.slice(0, 40);
}
