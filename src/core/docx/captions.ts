import type { Node, Root, Paragraph as MdParagraph } from "mdast";
import { AlignmentType, Paragraph, TextRun } from "docx";
import { collectPlainText } from "../mdast-utils.js";
import type { Ctx } from "./render.js";

/** 题注信息(8b):类型/章节号/序数/题注文本;免更新路线在渲染期静态注入编号文本 */
interface CaptionInfo {
  type: "figure" | "table";
  /** 章节号(最近 h1 计数,1 起;无 h1 或 headingNumbering 关闭时为 null → 纯「图 N」) */
  chapter: number | null;
  /** 章节内序数(1 起,按 h1 章节重置,与 Word SEQ \s 1 语义一致) */
  index: number;
  /** 题注文本(前缀「图: 」之后剩余) */
  text: string;
}

/** 节点子树是否含图片(链接内嵌图片 [![alt](u)](l) 也命中,递归) */
function containsImage(node: Node): boolean {
  if (node.type === "image") return true;
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as Node[]).some(containsImage);
  }
  return false;
}

/** 题注识别对象:表格块,或含图片的段落(图题注插入对象) */
function isCaptionTarget(node: Node): boolean {
  return node.type === "table" || (node.type === "paragraph" && containsImage(node));
}

/**
 * 题注上下文预扫(8b,免更新路线):顺序遍历顶层块,识别「图/表对象后紧跟的
 * 「图: 标题」/「表: 标题」前缀段」为题注,分配 { 类型, 章节号, 章节内序数 }。
 * - 前缀识别:段落整段纯文本以 `图:` / `表:`(半角/全角冒号)开头;
 * - 序数仅在有题注时递增(无题注的图/表不占号,与 Word SEQ 行为一致);
 * - 章节号 = 最近 h1 计数,图/表序在 h1 处重置(headingNumbering 关闭时不重置、
 *   无章节号,全文档连续);
 * - captionNumbering 关闭时返回空表(题注行按普通段落渲染,前缀文本原样保留)。
 */
function buildCaptionContext(ast: Root, ctx: Ctx): Map<MdParagraph, CaptionInfo> {
  const captions = new Map<MdParagraph, CaptionInfo>();
  if (!ctx.captionNumbering) return captions;
  let chapter = 0;
  let figIndex = 0;
  let tabIndex = 0;
  const children = ast.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === "heading" && node.depth === 1) {
      chapter++;
      figIndex = 0;
      tabIndex = 0;
      continue;
    }
    if (node.type !== "paragraph") continue;
    const prev = children[i - 1];
    if (!prev || !isCaptionTarget(prev)) continue;
    const match = /^(图|表)[:：]\s*(.*)$/s.exec(collectPlainText(node));
    if (!match) continue;
    const isFigure = match[1] === "图";
    const index = isFigure ? ++figIndex : ++tabIndex;
    captions.set(node, {
      type: isFigure ? "figure" : "table",
      chapter: ctx.headingNumbering && chapter > 0 ? chapter : null,
      index,
      text: match[2],
    });
  }
  return captions;
}

/** 题注段落:居中、比正文小一号(≥8pt)、无首行缩进;文本 = 自动编号 + 题注文本 */
function renderCaptionParagraph(caption: CaptionInfo, ctx: Ctx): Paragraph {
  const prefix = caption.type === "figure" ? "图 " : "表 ";
  const chapter = caption.chapter !== null ? `${caption.chapter}.` : "";
  const label = `${prefix}${chapter}${caption.index}`;
  const size = Math.max(8, ctx.typography.bodySizePt - 1);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 120 },
    children: [
      new TextRun({ text: caption.text === "" ? label : `${label} ${caption.text}`, size: size * 2 }),
    ],
  });
}

export { buildCaptionContext, renderCaptionParagraph };
export type { CaptionInfo };
