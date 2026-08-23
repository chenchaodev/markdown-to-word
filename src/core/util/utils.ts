/**
 * 通用文本工具(escape 集中,R8 批 4 L3):
 * escapeHtml/decodeEntities/escapeRegExp 原散落于 pdf/template.ts、pdf/postprocess.ts、
 * docx/handlers/math.ts(两份 decodeEntities 语义微差),统一收口于此,消除重复与漂移。
 * - decodeEntities 语义取 template 版(数值实体范围检查 + &nbsp; + &amp; 最后解防二次解码),
 *   覆盖 math 版全部输入(&#x27; 等由数值分支处理,非法码点返回原样不抛)。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML 实体解码(目录标题文本/公式文本用;markdown-it 输出的常见实体,零依赖手写)。
 *  命名实体先于 &amp; 解码,避免 "&amp;lt;" 二次解码为 "<"。 */
export function decodeEntities(text: string): string {
  const decodeNumeric = (match: string, digits: string, radix: number): string => {
    const cp = parseInt(digits, radix);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => decodeNumeric(m, hex, 16))
    .replace(/&#(\d+);/g, (m, dec: string) => decodeNumeric(m, dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 正则特殊字符转义(URL 字面匹配等场景) */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
