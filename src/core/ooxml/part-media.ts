/**
 * 媒体部件(word/media/*)访问:列举媒体部件、按部件名读字节、把 rId 还原成媒体部件路径。
 * 为什么单独成文件:媒体是「二进制部件」这一类,与文本部件的读取口径不同(走 readBinary);
 * 且「rId → 媒体部件」这一步是回读(步 #03)落盘图片的入口,放在部件访问层可直测。
 * 不变量:
 * ① 本层不落盘:只给字节与部件路径,写盘在 core 之外(convert 层)。
 * ② rId 还原经关系表与包内存在性双重核对:引用指向的部件不在包里 ⇒ 返回 null(不猜路径)。
 * ③ 外部关系不是媒体(不落盘、不取字节),返回 null。
 * 互指:关系解析在 src/core/ooxml/part-rels.ts;包访问在 src/core/ooxml/parts.ts。
 */
import type { DocxPackage } from "./parts.js";
import { findRelationship, resolvePartPath, type RelationshipMap } from "./part-rels.js";

/** 媒体部件目录前缀(OOXML 相对路径) */
export const MEDIA_PART_PREFIX = "word/media/";

/** 关系部件的基准部件(媒体目标相对它解析) */
const RELS_BASE_PART = "word/document.xml";

/**
 * 列出包内全部媒体部件。
 * @param pkg 包访问器
 * @returns 媒体部件路径列表(升序)
 */
export function listMediaParts(pkg: DocxPackage): string[] {
  return pkg.listParts().filter((part) => part.startsWith(MEDIA_PART_PREFIX));
}

/**
 * 读一个媒体部件的字节。
 * @param pkg 包访问器
 * @param part 部件路径
 * @returns 字节;不存在或读失败 ⇒ null
 */
export function readMediaPart(pkg: DocxPackage, part: string): Promise<Uint8Array | null> {
  return pkg.readBinary(part);
}

/**
 * 把关系里的 rId 还原成包内的媒体部件路径。
 * @param pkg 包访问器
 * @param rels 关系表(可空)
 * @param relationshipId rId
 * @returns 媒体部件路径;非媒体/外部关系/包内无此部件 ⇒ null
 */
export function mediaPartForRelationship(
  pkg: DocxPackage,
  rels: RelationshipMap | undefined,
  relationshipId: string,
): string | null {
  const relationship = findRelationship(rels, relationshipId);
  if (!relationship || relationship.external) return null;
  const part = resolvePartPath(RELS_BASE_PART, relationship.target);
  if (!part.startsWith(MEDIA_PART_PREFIX)) return null;
  return pkg.has(part) ? part : null;
}
