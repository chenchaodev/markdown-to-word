/**
 * docx 回读入口:自家稿(.docx 字节)→ mdast + 图片字节 + 计数 + 三类清单。
 *
 * 承诺边界(ADR-086 决定 6):**只承诺读回本仓自己导出的 docx**,不承诺通用 Word 保真。
 * 本文件是这条链路的唯一入口,分层如下(各层职责不重叠):
 * - `src/core/ooxml/**`(只读消费):部件解包与结构化(段落 / 表格 / 关系 / 编号 / 样式);
 * - 本目录:文档树 → mdast 的**内容**映射(不含设置字段 —— 那是深导入的事,两者不混);
 * - `src/convert/docx-readback/**`:落盘(.md + 图片目录),core 侧零 IO。
 *
 * 不变量:
 * ① 零 IO、零 node: 内建 import:只吃内存里的字节,读盘与写盘都在 core 之外。
 * ② **整包解不开**(非 zip / 损坏)与「解开了但没有主文档部件」都判**失败态**
 *    (`status: "unreadable"`),绝不返回「成功但什么都没有」—— 与模板深导入同一口径
 *    (ADR-086 实施约束四:失败路径不得谎报成功)。
 * ③ 侧信道(段落特征)与解析层的段落数对不齐时**逐段特征整条作废**(按「读不到」降级),
 *    公式 / 分隔线 / 引用块 / 分页符这些依赖它的结构一律不还原,绝不猜位置;
 *    但全文计数(脚注/批注/公式的条数)保留 —— 计数说 0 而文档里明明有,是撒谎。
 * ④ 图片按文档内出现顺序编号,md 与落盘文件名一一对应。
 */
import { openDocxPackage } from "../parts.js";
import { parseRelationships } from "../part-rels.js";
import { parseDocument } from "../part-document.js";
import { parseNumbering } from "../part-numbering.js";
import { parseStyles } from "../part-styles.js";
import { extractDocumentTraits } from "./readback-math.js";
import { buildReadbackTree, traitsAligned } from "./readback-mdast.js";
import {
  READBACK_NOT_MANAGED_FIELDS,
  READBACK_PRESERVED_FIELDS,
  type ReadbackCounts,
  type ReadbackDroppedField,
  type ReadbackImage,
  type ReadbackNotManagedField,
  type ReadbackPreservedField,
} from "./readback-fields.js";
import type { Content, Root } from "mdast";

/** 回读结果 */
export interface ReadbackResult {
  /** ok = 解开了并产出了内容;unreadable = 不是可读的 docx */
  status: "ok" | "unreadable";
  /** mdast 树(图片 url 为落地用的可读文件名,如 image1.png) */
  root: Root;
  /** 图片字节与落地名(文档序) */
  images: ReadbackImage[];
  /** 各类结构的计数 */
  counts: ReadbackCounts;
  /** 本次文档实际发生的丢失(条件产出;稳定标识) */
  dropped: ReadbackDroppedField[];
  /** 本仓恒不还原的类别(能力边界;与本次文档无关) */
  notManaged: ReadbackNotManagedField[];
  /** 完整还原的结构 */
  preserved: ReadbackPreservedField[];
}

/** 空的结果(失败态) */
function unreadable(): ReadbackResult {
  return {
    status: "unreadable",
    root: { type: "root", children: [] },
    images: [],
    counts: {
      headings: 0,
      paragraphs: 0,
      listItems: 0,
      tables: 0,
      images: 0,
      links: 0,
      footnotes: 0,
      formulas: 0,
      comments: 0,
    },
    dropped: [],
    notManaged: [...READBACK_NOT_MANAGED_FIELDS],
    preserved: [...READBACK_PRESERVED_FIELDS],
  };
}

/** 从树里删掉指定 url 的图片节点(媒体部件缺失时用:md 不许指向不存在的文件) */
function pruneImageNodes(root: Root, urls: ReadonlySet<string>): void {
  const walk = (nodes: Content[]): Content[] => {
    const out: Content[] = [];
    for (const node of nodes) {
      if (node.type === "image" && urls.has(node.url)) continue;
      if ("children" in node && Array.isArray(node.children)) {
        const children = walk(node.children as Content[]);
        (node as { children: Content[] }).children = children;
      }
      out.push(node);
    }
    return out;
  };
  root.children = walk(root.children);
}

/**
 * 回读一份自家稿:.docx 字节 → mdast + 图片 + 计数 + 三类清单。
 *
 * @param buffer .docx 字节
 * @returns 回读结果(解不开 ⇒ status "unreadable")
 */
export async function readbackDocx(buffer: Uint8Array): Promise<ReadbackResult> {
  const pkg = await openDocxPackage(buffer);
  if (pkg === null) return unreadable();
  const [documentXml, stylesXml, numberingXml, relsXml] = await Promise.all([
    pkg.readText("word/document.xml"),
    pkg.readText("word/styles.xml"),
    pkg.readText("word/numbering.xml"),
    pkg.readText("word/_rels/document.xml.rels"),
  ]);
  // 解开了但没有主文档部件 ⇒ 不是 Word 文档(改了扩展名的 zip / odt / epub):同样判失败态
  if (documentXml === null) return unreadable();

  const tree = parseDocument(documentXml, parseRelationships(relsXml));
  const styles = parseStyles(stylesXml);
  const numbering = parseNumbering(numberingXml);
  // 侧信道与解析层的段落数对不齐 ⇒ **逐段特征**整条作废(按「读不到」降级,见文件头不变量 ③);
  // 但**全文计数**(脚注/批注/公式的条数)与位置无关,仍要保留 —— 计数说 0 而文档里有是撒谎。
  const rawTraits = extractDocumentTraits(documentXml);
  const traits = traitsAligned(tree, rawTraits)
    ? rawTraits
    : { ...rawTraits, paragraphs: new Map() };

  const built = buildReadbackTree({ tree, numbering, styles, traits });

  // 图片字节:媒体部件读不到(损坏件)⇒ 该图片从 md 里去掉,不让 md 指向不存在的文件
  const images: ReadbackImage[] = [];
  const missing = new Set<string>();
  for (const image of built.images) {
    const data = await pkg.readBinary(image.partName);
    if (data === null) {
      missing.add(image.fileName);
      continue;
    }
    images.push({ partName: image.partName, fileName: image.fileName, data });
  }
  if (missing.size > 0) {
    pruneImageNodes(built.root, missing);
    built.counts.images -= missing.size;
  }

  const dropped: ReadbackDroppedField[] = [];
  if (built.counts.formulas > 0) dropped.push("formula");
  if (built.counts.comments > 0) dropped.push("comments");
  if (built.counts.footnotes > 0) dropped.push("footnotes");

  return {
    status: "ok",
    root: built.root,
    images,
    counts: built.counts,
    dropped,
    notManaged: [...READBACK_NOT_MANAGED_FIELDS],
    preserved: [...READBACK_PRESERVED_FIELDS],
  };
}
