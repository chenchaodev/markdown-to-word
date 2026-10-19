/**
 * 剪贴板片段的纯文本回退(text/plain 通道)。
 *
 * 不引入 HTML 解析依赖:片段由本渲染器自己产出,结构可控,正则足以把块级边界
 * 转成换行、单元格转成制表符、实体反转义。块级边界口径按需求钉死:
 * `p` / `li` / `h1-h6` / `tr` / `br` / 表格末尾 → 换行;`td`/`th` → 制表符
 * (表格行内的列分隔,便于粘贴到纯文本编辑器后仍可读)。
 *
 * 注意:代码块内容里的 `<br>` 也是行分隔,故这里不能按「块边界」区分,统一转
 * 换行即可;连续 3 个以上换行压成 2 个,避免块闭合与 br 叠加产生大片空行。
 */
import { decodeEntities } from "../text/text-escape.js";

/** 片段 HTML → 纯文本(段落/列表项/代码行之间以换行分隔) */
export function htmlToPlainText(html: string): string {
  const text = html
    // 内联 style 里不会有 style/script 元素,这里是防御性剥离
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|tr|table|div|ul|ol|blockquote|section)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    // 图片在纯文本里退化为 alt(与渲染器的「图片缺失」占位不是同一件事:
    // 成功嵌入的图片也应让 text/plain 能看到替代文字)
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, "$1")
    .replace(/<hr\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
