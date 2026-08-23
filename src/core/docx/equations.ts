import type { BlockContent, Root, Paragraph as MdParagraph } from "mdast";
import { collectPlainText } from "../mdast-utils.js";
import type { Ctx } from "./ctx.js";

/** mdast math 节点(display 公式;经 remark-math/mdast-util-math 扩充进 BlockContent) */
type MdMath = Extract<BlockContent, { type: "math" }>;

/** 公式编号信息(9d):index = 全文连续编号(1 起,与渲染成败无关,降级公式也占号);
 *  label = 公式块后 `{#eq:label}` 段登记的标签(可选) */
interface EquationInfo {
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
      const match = /^\{#eq:([\w-]+)\}$/.exec(collectPlainText(node));
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

export { buildEquationContext };
export type { EquationContext };
