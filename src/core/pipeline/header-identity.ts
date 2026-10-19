/**
 * 页眉身份行:标题与单位的拼接单源(纯函数、零 IO)。
 *
 * 为什么在这里:docx 侧页眉(headers.ts 的 default 分支)与 pdf 侧页眉
 * (pdf/template.ts 的 buildPdfHeaderTemplate)必须出**同一串**文字 ——
 * adr-030 6-B3 要求双侧一致。若两侧各自拼「标题 + 单位」,必然漂移
 * (先后顺序、分隔符、空项处理任一不同即两副面孔),故收成一份纯函数。
 * 分隔符与 pdf 封面 metaLine 一致(" · ")。
 */
import type { DocMetadata } from "./frontmatter.js";

/**
 * 身份行 = 标题 · 单位:各自 trim 后丢弃空项,再以 " · " 连接。
 *
 * `metadata.title` 存在(哪怕空串)即不再取 `fallbackTitle` —— 保留既有来源语义,
 * 故用 `??` 而非 `||`。两者皆空时返回空串,由调用方决定「不装配页眉」;
 * 只有单位没有标题时也返回单位本身(页眉的定位是承载身份信息)。
 * @param metadata 已合并的文档元数据(frontmatter / 显式覆盖)
 * @param fallbackTitle 元数据无 title 时的兜底标题(如文件名)
 * @returns 身份行文本;两者皆空时为空串
 */
export function headerIdentityText(
  metadata: DocMetadata | undefined,
  fallbackTitle: string | undefined,
): string {
  const title = (metadata?.title ?? fallbackTitle)?.trim() ?? "";
  const organization = metadata?.organization?.trim() ?? "";
  return [title, organization].filter((part) => part !== "").join(" · ");
}
