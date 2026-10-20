/**
 * docx 题注子系统:预扫期识别 + 渲染期题注段——buildCaptionContext(由 prescan.ts
 * 调用:识别「图:/表: 前缀段」,分配章节号/章节内序数,label 登记,并按文档顺序
 * 产出图表清单条目)与 renderCaptionParagraph(render.ts 题注段 case:居中题注段 +
 * 编号文本注入 + 书签包裹(有 label 或清单开启时),供交叉引用与图表清单跳转)。
 * 双管线对应:src/core/pdf/rules/caption.ts(caption_recognize 规则,其头注载明
 * 与本侧 buildCaptionContext 顶层预扫契约一致)。差异:本侧编号在渲染期静态注入
 * 文本(免更新路线),pdf 侧编号由 CSS counter 伪元素生成、不进文本节点。
 * 识别口径(前缀正则 CAPTION_PREFIX_RE 单源、仅顶层、图/表目标判定)修改
 * 任一侧须同步核对 src/core/pdf/rules/caption.ts。
 */
import type { Node, Root, Paragraph as MdParagraph } from "mdast";
import { AlignmentType, Paragraph, TextRun } from "docx";
import { collectPlainText } from "../../text/mdast-utils.js";
import { captionFontSizePt, ptToHalfPoints } from "../../settings/typography.js";
import { CAPTION_PREFIX_RE, captionLabelKey, kindLabelRegex } from "../../markdown/cross-ref.js";
import { docxBookmarkId } from "../../markdown/slug.js";
import { wrapBookmark } from "./bookmark.js";
import type { Ctx } from "../ctx.js";

/** 题注信息(8b):类型/章节号/序数/题注文本;免更新路线在渲染期静态注入编号文本 */
interface CaptionInfo {
  type: "figure" | "table";
  /** 章节号(最近 h1 计数,1 起;无 h1 或 headingNumbering 关闭时为 null → 纯「图 N」) */
  chapter: number | null;
  /** 章节内序数(1 起,按 h1 章节重置,与 Word SEQ \s 1 语义一致) */
  index: number;
  /** 题注文本(前缀「图: 」之后剩余,已剥离行内 label) */
  text: string;
  /** 行内 label:{#fig:label}/{#tab:label} 尾部后缀;label 不渲染,
   *  仅登记供交叉引用跳转;无 label 时 undefined) */
  label?: string;
  /** 该题注的书签名(已过 docxBookmarkId):有 label 时 fig-/tab-<label>(交叉引用
   *  的既有跳转目标,无条件生成);无 label 时合成 cap-<全局序数> —— 它唯一的
   *  消费方是图表清单,故只在目录开启(清单可能生成)时才占用,否则留 undefined
   *  以保持「目录关闭 ⇒ 产物与改动前逐字节一致」 */
  bookmark?: string;
}

/** 图表清单条目(按文档顺序;docx 侧经 prescan 传至 render 层拼清单页) */
export interface CaptionListEntry {
  kind: "figure" | "table";
  /** 完整条目文本(编号 + 题注文本;题注文本为空时只出编号),与题注段落显示同源 */
  text: string;
  /** 目标书签名(清单条目 InternalHyperlink 的 anchor,无 # 前缀) */
  href: string;
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
 * - 同时按文档顺序产出图表清单条目(与 pdf 侧 rules/xref.ts 收集的条目同口径:
 *   全文题注序数 = 图/表共用一个计数器,不随 h1 重置);
 * - captionNumbering 关闭时返回空表 + 空条目(题注行按普通段落渲染,前缀文本原样保留)。
 */
function buildCaptionContext(
  ast: Root,
  ctx: Ctx,
): { captions: Map<MdParagraph, CaptionInfo>; entries: CaptionListEntry[] } {
  const captions = new Map<MdParagraph, CaptionInfo>();
  const entries: CaptionListEntry[] = [];
  if (!ctx.config.captionNumbering) return { captions, entries };
  let chapter = 0;
  let figIndex = 0;
  let tabIndex = 0;
  // 全文题注序数(图/表共用,不随 h1 重置):无 label 题注的合成书签 cap-<n> 用它,
  // 两侧必须算出同一序号,故口径单点在此(与 pdf 侧同名计数器一致)
  let captionSeq = 0;
  const children = ast.children;
  for (const [i, node] of children.entries()) {
    if (node.type === "heading" && node.depth === 1) {
      chapter++;
      // 仅章节编号开启时图/表序在 h1 处重置;关闭时全文档连续(实现曾无条件重置
      // 导致双格式分歧)
      if (ctx.config.headingNumbering) {
        figIndex = 0;
        tabIndex = 0;
      }
      continue;
    }
    if (node.type !== "paragraph") continue;
    const prev = children[i - 1];
    if (!prev || !isCaptionTarget(prev)) continue;
    const match = CAPTION_PREFIX_RE.exec(collectPlainText(node));
    if (!match) continue;
    const isFigure = match[1] === "图";
    const index = isFigure ? ++figIndex : ++tabIndex;
    const seq = ++captionSeq;
    const kind = isFigure ? "fig" : "tab";
    // 行内 label:题注文本尾部 {#fig:label}/{#tab:label} 剥离,
    // label 不渲染(不进题注文本);仅当前缀与题注类型一致时剥离并登记
    // (类型不一致视为普通文本原样保留,避免错误登记导致引用语义错乱——
    // kindLabelRegex 按当前类型构造,不匹配即无剥离,与原合并版正则行为等价)
    let text = collectPlainText(node).slice(match[0].length);
    let label: string | undefined;
    const labelMatch = kindLabelRegex(kind).exec(text);
    if (labelMatch) {
      text = text.slice(0, labelMatch.index);
      label = labelMatch[1];
    }
    const info: CaptionInfo = {
      type: isFigure ? "figure" : "table",
      chapter: ctx.config.headingNumbering && chapter > 0 ? chapter : null,
      index,
      text,
      label,
      // 有 label 沿用交叉引用既有的 fig-/tab-<label> 书签(无条件,引用目标不能随
      // 目录开关消失);无 label 的合成书签只服务图表清单 → 目录关闭时不生成
      bookmark:
        label !== undefined
          ? docxBookmarkId(`${kind}-${label}`)
          : ctx.config.toc
            ? docxBookmarkId(`cap-${seq}`)
            : undefined,
    };
    captions.set(node, info);
    // toc 关闭时 bookmark 为空:该条目不会被消费(清单另有 toc && captionNumbering 闸)
    entries.push({ kind: info.type, text: captionDisplayText(info), href: info.bookmark ?? "" });
    // label 登记(交叉引用查表,仿 equations labelIndex 模式):键 = kind + label
    // (captionLabelKey 单源,fig/tab 各占一个命名空间 → 同名 label 互不覆盖;
    // 同一 kind 内重名仍后写覆盖,先到先得语义不变)→ 编号显示文本
    if (label !== undefined) {
      ctx.xref.captionLabels.set(captionLabelKey(kind, label), captionNumberText(info));
    }
  }
  return { captions, entries };
}

/** 题注编号显示文本(「图 3.1」/「表 1」):renderCaptionParagraph 与交叉引用
 *  登记共用同一函数,避免显示与引用编号漂移 */
function captionNumberText(caption: CaptionInfo): string {
  const prefix = caption.type === "figure" ? "图 " : "表 ";
  const chapter = caption.chapter !== null ? `${caption.chapter}.` : "";
  return `${prefix}${chapter}${caption.index}`;
}

/** 题注完整显示文本(编号 + 题注文本;题注文本为空时只出编号):
 *  题注段落与图表清单条目共用,避免两处各拼一遍而出现条目与正文不一致 */
function captionDisplayText(caption: CaptionInfo): string {
  const number = captionNumberText(caption);
  return caption.text === "" ? number : `${number} ${caption.text}`;
}

/** 题注段落:居中、比正文小一号(≥8pt,推导单源 core/settings/typography.ts
 *  captionFontSizePt)、无首行缩进;文本 = 自动编号 + 题注文本 */
function renderCaptionParagraph(caption: CaptionInfo, ctx: Ctx): Paragraph {
  const size = ptToHalfPoints(captionFontSizePt(ctx.config.typography.bodySizePt));
  const textRun = new TextRun({ text: captionDisplayText(caption), size });
  // 有 label 的题注包书签(交叉引用目标,始终存在);无 label 时 bookmark 只在目录
  // 开启(清单要可点)时才有 -> 关闭态回到改动前的「无书签」形态。
  const children =
    caption.bookmark === undefined
      ? [textRun]
      : wrapBookmark(ctx.xref.bookmarkNextId, caption.bookmark, [textRun]);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 120 },
    children,
  });
}

export { buildCaptionContext, renderCaptionParagraph };
export type { CaptionInfo };
