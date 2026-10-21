/**
 * 关系部件(word/_rels/document.xml.rels 等)解析:把 r:id 映射到目标(内部部件路径或外部 URL)。
 * 为什么单独成文件:关系表是「部件之间的引用边」,与部件内容无关;文档树解析与媒体落地都要用它
 * 把 rId 还原成实际目标,若各写一份解析逻辑,同一条边在两处的还原口径会漂。
 * 不变量:
 * ① 内部目标按「相对关系部件所在目录」解析成 OOXML 相对路径(word/document.xml + media/x.png
 *    ⇒ word/media/x.png);外部目标(TargetMode="External")原样保留 URL。
 * ② 关系部件本身不判存在性:缺 rId ⇒ 查不到 ⇒ 返回 null(消费方按「读不到就降级」处理)。
 * ③ 解析按本地名匹配(Relationship / Id / Type / Target),前缀不写死。
 * 互指:路径解析只用 POSIX 形态的字符串运算,本层不引 node:path(core 内建白名单不放行它)。
 */
import { attrOf, childrenOf, parseXml } from "./xml.js";

/** 一条关系 */
export interface Relationship {
  /** rId(如 rId4) */
  id: string;
  /** 关系类型 URI(如 …/hyperlink) */
  type: string;
  /** 目标(内部为相对路径,外部为 URL) */
  target: string;
  /** TargetMode 原值(内部件缺省,外部为 "External") */
  targetMode?: string;
  external: boolean;
}

/** 关系表:键 = rId */
export type RelationshipMap = ReadonlyMap<string, Relationship>;

/**
 * 解析关系部件。
 * @param xml .rels 文本(缺部件时传 null/空串 ⇒ 空表)
 * @returns 关系表(部件缺失/畸形 ⇒ 空表)
 */
export function parseRelationships(xml: string | null | undefined): RelationshipMap {
  const map = new Map<string, Relationship>();
  const root = parseXml(xml);
  if (!root) return map;
  for (const el of childrenOf(root, "Relationship")) {
    const id = attrOf(el, "Id");
    if (id === undefined || id === "") continue;
    const targetMode = attrOf(el, "TargetMode");
    map.set(id, {
      id,
      type: attrOf(el, "Type") ?? "",
      target: attrOf(el, "Target") ?? "",
      targetMode,
      external: (targetMode ?? "").toLowerCase() === "external",
    });
  }
  return map;
}

/**
 * 按 rId 查关系。
 * @param rels 关系表(可空)
 * @param id rId
 * @returns 关系或 null
 */
export function findRelationship(rels: RelationshipMap | undefined, id: string): Relationship | null {
  if (!rels) return null;
  return rels.get(id) ?? null;
}

/**
 * 把关系里的相对目标解析成 OOXML 部件路径(相对基准部件所在目录)。
 * @param basePart 基准部件路径(如 "word/document.xml")
 * @param target 关系里的目标(如 "media/image1.png" 或 "../customXml/item1.xml")
 * @returns 解析后的部件路径(绝对式目标去掉前导 "/")
 */
export function resolvePartPath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const slash = basePart.lastIndexOf("/");
  const baseDir = slash === -1 ? "" : basePart.slice(0, slash);
  const segments = (baseDir === "" ? [] : baseDir.split("/")).concat(target.split("/"));
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * 列出关系表里的全部 rId(诊断用)。
 * @param rels 关系表
 * @returns rId 列表
 */
export function relationshipIds(rels: RelationshipMap | undefined): string[] {
  if (!rels) return [];
  return [...rels.keys()];
}
