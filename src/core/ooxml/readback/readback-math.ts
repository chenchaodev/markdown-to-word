/**
 * 段落特征侧信道:从**原始 document.xml** 取解析层没暴露的三样东西 ——
 * ① OMML 公式(`m:oMath`)的位置与纯文本;② 段落下边框(自家稿的分隔线形态);
 * ③ 段落底纹(自家稿的引用块形态)。
 *
 * 为什么要有这层侧信道(不是「第二份 XML 读取逻辑」):
 * 解析层(part-document.ts)只解析**内容结构**,`w:pBdr` / `w:shd` / `m:oMath` 三类
 * 不在它的属性形状里(properties.ts 的 ParagraphProperties 无这两项,run 侧也不含 OMML)。
 * 回读要还原「分隔线 / 引用块 / 公式」就必须读它们,而本仓禁止改解析层(只读消费)。
 * 故本文件**只**取这三样,仍走同目录的 xml.ts 原语(不另写 XML 扫描器),
 * 且**按段落序与解析层对齐**(见下)。
 *
 * 对齐口径与它的失效处置:
 * - 段落序 = 原始 XML 里 `w:p` 的文档序(深度优先);解析层的段落序 = 文档树遍历序
 *   (块序 → 表格行 → 单元格 → 块)。两者对自家稿**逐段同序**(自家稿不产生块级
 *   `w:ins`/`w:del` 这类解析层不展开的容器)。
 * - 调用方先用 `paragraphCount` 与解析层的段落数**对齐校验**:对不上就整条侧信道作废
 *   (公式/分隔线/引用块一律按「读不到」降级),绝不按猜测的位置硬塞 —— 错位会让公式
 *   落到别的段落里,那比丢一个公式严重得多。
 *
 * 公式的纯文本形态:**不是 LaTeX、也不保证可逆**。结构用 ASCII 记号表达
 * (`^` 上标 / `_` 下标 / `/` 分式 / `√` 根号),n 元运算符保留符号并把上下限放进圆括号。
 * 本仓不引 OMML→LaTeX 真解析器(那要另立依赖与判据),故公式只保证「不丢内容」。
 */
import { attrOf, childOf, findDescendants, parseXml, type XmlElement } from "../xml.js";

/** 段落内的一个公式槽位 */
export interface MathSlot {
  /**
   * 该公式**之前**、同一段落内已出现的可见文本长度(单位:字符)。
   *
   * 用途:把公式插回段落的正确位置 —— 解析层的条目序列里公式是缺席的,
   * 只能靠「公式前的文本有多长」反推它落在第几个条目之后。
   */
  beforeLength: number;
  /** 公式的纯文本形态(结构用 ASCII 记号,见文件头) */
  text: string;
}

/** 走段落子树时的累计状态 */
interface WalkState {
  /** 已累计的可见文本长度 */
  length: number;
  /** 收集到的公式槽位 */
  slots: MathSlot[];
  /** 段落里是否含分页符 */
  pageBreak: boolean;
}

/** 一个段落的特征 */
export interface ParagraphTraits {
  /** 段落内的公式槽位(文档序) */
  math: MathSlot[];
  /** 段落带下边框(自家稿的分隔线形态:`w:pBdr/w:bottom`) */
  bottomBorder: boolean;
  /** 段落含分页符(`w:br w:type="page"`;自家稿的分页符形态) */
  pageBreak: boolean;
  /** 段落底纹填充色(自家稿的引用块形态:`w:shd@fill`);无底纹则 undefined */
  shadingFill?: string;
}

/** 整篇文档的特征集合 */
export interface DocumentTraits {
  /** 段落序 → 段落特征(键 = 段落在文档中的序号,从 0 起) */
  paragraphs: Map<number, ParagraphTraits>;
  /** 公式元素总数(m:oMath;与位置无关,侧信道作废时仍可信) */
  mathElements: number;
  /** 脚注引用数(`w:footnoteReference`;脚注正文在 word/footnotes.xml,本层不解析) */
  footnoteReferences: number;
  /** 批注引用数(`w:commentReference`;批注正文在 word/comments.xml,本层不解析) */
  commentReferences: number;
  /** 文档里的段落总数(与解析层的段落数对齐校验用) */
  paragraphCount: number;
}

/** 取一个元素的纯文本(递归拼 `m:t`;其它容器递归拼子元素) */
function mathText(el: XmlElement): string {
  switch (el.localName) {
    case "t":
      return el.text;
    case "f": {
      // 分式:分子/分母
      const num = childOf(el, "num");
      const den = childOf(el, "den");
      return `${num === null ? "" : mathText(num)}/${den === null ? "" : mathText(den)}`;
    }
    case "sSup": {
      const base = childOf(el, "e");
      const sup = childOf(el, "sup");
      return `${base === null ? "" : mathText(base)}^${sup === null ? "" : mathText(sup)}`;
    }
    case "sSub": {
      const base = childOf(el, "e");
      const sub = childOf(el, "sub");
      return `${base === null ? "" : mathText(base)}_${sub === null ? "" : mathText(sub)}`;
    }
    case "sSubSup": {
      const base = childOf(el, "e");
      const sub = childOf(el, "sub");
      const sup = childOf(el, "sup");
      const baseText = base === null ? "" : mathText(base);
      const subText = sub === null ? "" : mathText(sub);
      const supText = sup === null ? "" : mathText(sup);
      return `${baseText}_${subText}^${supText}`;
    }
    case "rad": {
      // 根号:度数被 `m:degHide` 隐藏时不计;可见度数带在括号前
      const deg = childOf(el, "deg");
      const body = childOf(el, "e");
      const hidden = attrOf(childOf(childOf(el, "radPr"), "degHide"), "val");
      const degText = deg === null ? "" : mathText(deg);
      const degPart = degText === "" || hidden === "1" ? "" : degText;
      return `√${degPart}(${body === null ? "" : mathText(body)})`;
    }
    case "nary": {
      // n 元运算符(∑/∏…):符号 + 上下限(放进圆括号)+ 主体
      const chr = attrOf(childOf(childOf(el, "naryPr"), "chr"), "val") ?? "";
      const sub = childOf(el, "sub");
      const sup = childOf(el, "sup");
      const body = childOf(el, "e");
      const subText = sub === null ? "" : mathText(sub);
      const supText = sup === null ? "" : mathText(sup);
      const limits = subText === "" && supText === "" ? "" : `(${subText}..${supText})`;
      return `${chr}${limits}${body === null ? "" : mathText(body)}`;
    }
    case "d": {
      // 括号/分隔符:取其内容
      const body = childOf(el, "e");
      return `(${body === null ? "" : mathText(body)})`;
    }
    default:
      return el.children.map(mathText).join("");
  }
}

/**
 * 走一个段落的子树,累计可见文本长度并收集公式槽位。
 *
 * 累计口径:只数 `w:t` / `w:delText` 的文本(与解析层的 readRun 同口径:两者都进 run 文本),
 * 公式子树整体跳过(公式内部的 `m:t` 不是正文文本)。
 */
function collectMath(el: XmlElement, state: WalkState): void {
  for (const child of el.children) {
    if (child.localName === "oMath") {
      state.slots.push({ beforeLength: state.length, text: mathText(child) });
      continue; // 公式子树不再累计(其 m:t 不是正文文本)
    }
    // ⚠ `m:oMathPara`(显示公式的容器)不单独成槽 —— 它里面的 `m:oMath` 才是公式本体,
    //   故这里**继续下钻**,槽位数与 oMath 元素数恒等(计数与位置两处口径一致)。
    if (child.localName === "br" && attrOf(child, "type") === "page") {
      state.pageBreak = true;
    }
    if (child.localName === "t" || child.localName === "delText") {
      state.length += child.text.length;
      continue;
    }
    collectMath(child, state);
  }
}

/** 取一个段落的特征(公式槽位 / 下边框 / 分页符 / 底纹) */
function traitsOf(paragraph: XmlElement): ParagraphTraits {
  const state: WalkState = { length: 0, slots: [], pageBreak: false };
  collectMath(paragraph, state);
  const pPr = childOf(paragraph, "pPr");
  const bottomBorder = childOf(childOf(pPr, "pBdr"), "bottom") !== null;
  const fill = attrOf(childOf(pPr, "shd"), "fill");
  const traits: ParagraphTraits = {
    math: state.slots,
    bottomBorder,
    pageBreak: state.pageBreak,
  };
  if (fill !== undefined) traits.shadingFill = fill;
  return traits;
}

/**
 * 取整篇文档的特征集合。
 *
 * @param documentXml word/document.xml 文本(缺部件时传 null/空串 ⇒ 空集合)
 * @returns 文档特征(部件缺失/畸形 ⇒ 空集合,不抛)
 */
export function extractDocumentTraits(documentXml: string | null | undefined): DocumentTraits {
  const traits: DocumentTraits = {
    paragraphs: new Map(),
    mathElements: 0,
    footnoteReferences: 0,
    commentReferences: 0,
    paragraphCount: 0,
  };
  const root = parseXml(documentXml);
  if (!root) return traits;
  const paragraphs = findDescendants(root, "p");
  traits.paragraphCount = paragraphs.length;
  paragraphs.forEach((paragraph, index) => {
    traits.paragraphs.set(index, traitsOf(paragraph));
  });
  traits.mathElements = findDescendants(root, "oMath").length;
  traits.footnoteReferences = findDescendants(root, "footnoteReference").length;
  traits.commentReferences = findDescendants(root, "commentReference").length;
  return traits;
}

/** 供诊断用:某个段落的特征(不存在 ⇒ undefined) */
export function traitsAt(
  traits: DocumentTraits,
  paragraphIndex: number,
): ParagraphTraits | undefined {
  return traits.paragraphs.get(paragraphIndex);
}
