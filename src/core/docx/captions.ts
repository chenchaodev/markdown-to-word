import type { Node, Root, Paragraph as MdParagraph } from "mdast";
import { AlignmentType, Paragraph, TextRun } from "docx";
import type { ParagraphChild } from "docx";
import { collectPlainText } from "../mdast-utils.js";
import { docxBookmarkId } from "../slug.js";
import { wrapBookmark } from "./bookmark.js";
import type { Ctx } from "./ctx.js";

/** 题注信息(8b):类型/章节号/序数/题注文本;免更新路线在渲染期静态注入编号文本 */
interface CaptionInfo {
  type: "figure" | "table";
  /** 章节号(最近 h1 计数,1 起;无 h1 或 headingNumbering 关闭时为 null → 纯「图 N」) */
  chapter: number | null;
  /** 章节内序数(1 起,按 h1 章节重置,与 Word SEQ \s 1 语义一致) */
  index: number;
  /** 题注文本(前缀「图: 」之后剩余,已剥离行内 label) */
  text: string;
  /** 行内 label(批次 10 功能 2:{#fig:label}/{#tab:label} 尾部后缀;label 不渲染,
   *  仅登记供交叉引用跳转;无 label 时 undefined) */
  label?: string;
}

/** 题注 label 登记信息(批次 10 功能 2:交叉引用查表) */
export interface CaptionLabelInfo {
  /** 题注类型(fig/tab,与引用前缀一致) */
  kind: "fig" | "tab";
  /** 与题注显示一致的编号文本(「图 3.1」/「表 1」) */
  numberText: string;
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
  for (const [i, node] of children.entries()) {
    if (node.type === "heading" && node.depth === 1) {
      chapter++;
      // B3:仅章节编号开启时图/表序在 h1 处重置;关闭时全文档连续(与 pdf 侧
      // 行为本文件头注释本就如此宣称,实现曾无条件重置导致双格式分歧)
      if (ctx.headingNumbering) {
        figIndex = 0;
        tabIndex = 0;
      }
      continue;
    }
    if (node.type !== "paragraph") continue;
    const prev = children[i - 1];
    if (!prev || !isCaptionTarget(prev)) continue;
    const match = /^(图|表)[:：]\s*(.*)$/s.exec(collectPlainText(node));
    if (!match) continue;
    const isFigure = match[1] === "图";
    const index = isFigure ? ++figIndex : ++tabIndex;
    // 行内 label(批次 10 功能 2):题注文本尾部 {#fig:label}/{#tab:label} 剥离,
    // label 不渲染(不进题注文本);仅当前缀与题注类型一致时剥离并登记
    // (类型不一致视为普通文本原样保留,避免错误登记导致引用语义错乱)
    let text = match[2]!; // 正则第二捕获组(.*)恒参与匹配,组必存在
    let label: string | undefined;
    const labelMatch = /\s*\{#(fig|tab):([\w-]+)\}$/.exec(text);
    if (labelMatch && labelMatch[1] === (isFigure ? "fig" : "tab")) {
      text = text.slice(0, labelMatch.index);
      label = labelMatch[2];
    }
    const info: CaptionInfo = {
      type: isFigure ? "figure" : "table",
      chapter: ctx.headingNumbering && chapter > 0 ? chapter : null,
      index,
      text,
      label,
    };
    captions.set(node, info);
    // label 登记(交叉引用查表,仿 equations labelIndex 模式):label → 类型 + 编号显示文本
    if (label !== undefined) {
      ctx.captionLabels.set(label, { kind: isFigure ? "fig" : "tab", numberText: captionNumberText(info) });
    }
  }
  return captions;
}

/** 题注编号显示文本(「图 3.1」/「表 1」):renderCaptionParagraph 与交叉引用
 *  登记共用同一函数,避免显示与引用编号漂移 */
function captionNumberText(caption: CaptionInfo): string {
  const prefix = caption.type === "figure" ? "图 " : "表 ";
  const chapter = caption.chapter !== null ? `${caption.chapter}.` : "";
  return `${prefix}${chapter}${caption.index}`;
}

/** 题注段落:居中、比正文小一号(≥8pt)、无首行缩进;文本 = 自动编号 + 题注文本 */
function renderCaptionParagraph(caption: CaptionInfo, ctx: Ctx): Paragraph {
  const label = captionNumberText(caption);
  const size = Math.max(8, ctx.typography.bodySizePt - 1);
  const textRun = new TextRun({ text: caption.text === "" ? label : `${label} ${caption.text}`, size: size * 2 });
  let children: ParagraphChild[] = [textRun];
  // label 书签(批次 10 功能 2):题注带 {#fig:label}/{#tab:label} 时包
  // fig-<label>/tab-<label> 书签,供交叉引用 InternalHyperlink 跳转;
  // id 由 ctx.bookmarkNextId 自增保证文档内唯一(B7 起与 render.ts 共用
  // bookmark.ts wrapBookmark,原内联实现为避免运行时循环已收敛至该无环模块)
  if (caption.label !== undefined) {
    const name = docxBookmarkId(`${caption.type === "figure" ? "fig" : "tab"}-${caption.label}`);
    children = wrapBookmark(ctx.bookmarkNextId, name, children);
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 120 },
    children,
  });
}

export { buildCaptionContext, renderCaptionParagraph };
export type { CaptionInfo };
