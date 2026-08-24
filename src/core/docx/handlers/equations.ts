import type { Root, Paragraph as MdParagraph } from "mdast";
import {
  AlignmentType,
  Math as DocxMath,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";
import type { ParagraphChild } from "docx";
import { collectPlainText } from "../../util/mdast-utils.js";
import { EQ_LABEL_RE } from "../../markdown/cross-ref.js";
import { docxBookmarkId } from "../../markdown/slug.js";
import { CODE_FONT, MUTED_TEXT_GRAY } from "../theme.js";
import { texToDocxMath } from "./math.js";
import { wrapBookmark } from "./bookmark.js";
import { formulaParseFailedWarning, type Ctx, type MdMath } from "../ctx.js";

/** 公式编号信息(9d):index = 全文连续编号(1 起,与渲染成败无关,降级公式也占号);
 *  label = 公式块后 `{#eq:label}` 段登记的标签(可选) */
export interface EquationInfo {
  index: number;
  label?: string;
}

/** 公式编号上下文(9d,免更新路线:编号静态注入文本,无域) */
interface EquationContext {
  /** math 节点 → 编号信息(全文每个 display 公式必登记) */
  indexByNode: Map<MdMath, EquationInfo>;
  /** label → 编号(交叉引用查表) */
  labelIndex: Map<string, number>;
  /** `{#eq:label}` 独立段(渲染时跳过) */
  skipSet: Set<MdParagraph>;
}

/**
 * 公式编号上下文预扫(9d,免更新路线):顺序遍历顶层块,display 公式(math 节点)
 * 按文档顺序全文连续编号 1,2,3…;公式块后紧跟的独立段 `{#eq:label}`(整段仅此
 * 一行,label 为 [\w-]+)→ label 登记给前一公式并跳过渲染;前无公式的 label 段
 * 追加警告并同样跳过。
 * numbering=false(公式编号开关关闭):公式不编号(index 不递增、indexByNode 不
 * 登记);label 段仍识别并加入 skipSet(语法标记不显示),但不登记 labelIndex、
 * 不追加「公式 label 前无公式」警告。
 */
function buildEquationContext(ast: Root, ctx: Ctx, numbering: boolean = true): EquationContext {
  const indexByNode = new Map<MdMath, EquationInfo>();
  const labelIndex = new Map<string, number>();
  const skipSet = new Set<MdParagraph>();
  let index = 0;
  let lastInfo: EquationInfo | null = null;
  for (const node of ast.children) {
    if (node.type === "math") {
      if (!numbering) continue; // 关开关:不编号、不登记
      index++;
      // 同一对象同时入 Map 与 lastInfo:后续 label 段直接改 lastInfo 即同步 Map 项
      lastInfo = { index };
      indexByNode.set(node, lastInfo);
    } else if (node.type === "paragraph") {
      const match = EQ_LABEL_RE.exec(collectPlainText(node));
      if (!match) continue;
      const label = match[1]!; // 正则 ^$ 锚定且捕获组必参与匹配,exec 成功则组 1 必存在
      if (numbering) {
        if (lastInfo) {
          // 补 label 到前一公式;同公式多个 label 段时后者覆盖
          lastInfo.label = label;
          labelIndex.set(label, lastInfo.index);
        } else {
          ctx.warnings?.push({
            key: "warn.eqLabelOrphan",
            params: { label },
            fallback: `公式 label 前无公式,已忽略: {#eq:${label}}`,
          });
        }
      }
      // 关开关时 lastInfo 恒为 null,label 段仍跳过渲染(语法标记不显示)
      skipSet.add(node);
    }
  }
  return { indexByNode, labelIndex, skipSet };
}

/**
 * display 公式渲染(CORE-5 自 render.ts math case 拆出;eq 为 undefined 表示
 * 无编号信息——equationNumbering=false 时 buildEquationContext 不登记任何节点,
 * 每个公式都走此路径,并非不可达):
 * - 有编号:按「公式居中 + 编号右对齐」排版——center tab(50% 文本区宽)+
 *   right tab(100% 文本区宽),children = [Tab(), 公式, Tab(), "(N)"];label 存在时
 *   外包书签 eq-label 供交叉引用跳转(编号静态注入,免更新域);
 * - 无编号:原居中逻辑;
 * - 降级(解析失败/未覆盖节点):TeX 源码等宽灰字 + 警告,内容不丢失
 *   (降级公式同样占编号)。不应用 5a 排版(无首行缩进/两端对齐,与 pdf 侧
 *   .katex-display 居中语义对齐)。
 */
export function renderDisplayMath(
  node: MdMath,
  ctx: Ctx,
  eq: EquationInfo | undefined,
  textWidthTwips: number,
): Paragraph[] {
  const result = texToDocxMath(node.value);
  if (!eq) {
    if (result.ok) {
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new DocxMath({ children: result.children })],
        }),
      ];
    }
    ctx.warnings?.push(formulaParseFailedWarning(node.value));
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: result.text, font: CODE_FONT, color: MUTED_TEXT_GRAY })],
      }),
    ];
  }
  if (!result.ok) {
    ctx.warnings?.push(formulaParseFailedWarning(node.value));
  }
  // 公式主体:解析成功 → docx Math;失败 → TeX 源码等宽灰字
  const mathChild: DocxMath | TextRun = result.ok
    ? new DocxMath({ children: result.children })
    : new TextRun({ text: result.text, font: CODE_FONT, color: MUTED_TEXT_GRAY });
  // 制表位跳格:Tab 必须包在 TextRun 内(裸 <w:tab/> 是非法段落级元素,
  // WPS 实测会把公式段降级显示;TextRun({ children: [Tab] }) 输出
  // <w:r><w:tab/></w:r> 合法结构)。包后全部为 ParagraphChild,无需断言
  const equationRuns: ParagraphChild[] = [
    new TextRun({ children: [new Tab()] }),
    mathChild,
    new TextRun({ children: [new Tab()] }),
    new TextRun({ text: `(${eq.index})` }),
  ];
  const paragraph = new Paragraph({
    // 制表位:center tab 于文本区正中(公式居中),right tab 于文本区右缘(编号右对齐)
    tabStops: [
      { type: TabStopType.CENTER, position: Math.floor(textWidthTwips / 2) },
      { type: TabStopType.RIGHT, position: textWidthTwips },
    ],
    children:
      eq.label !== undefined
        ? wrapBookmark(ctx.bookmarkNextId, docxBookmarkId(`eq-${eq.label}`), equationRuns)
        : equationRuns,
  });
  return [paragraph];
}

export { buildEquationContext };
export type { EquationContext };
