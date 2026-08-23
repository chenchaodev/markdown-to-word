/**
 * pdf 渲染规则共享契约(B8 拆分自 render.ts,行为零变化):
 * markdown-it core 规则族(caption_recognize / eq_numbering / xref_recognize)与
 * 渲染器包装(heading_open / paragraph_open 锚点注入)共用的底层工具单源。
 * 依赖方向单向:各规则模块 → 本模块 → core 共享模块(cross-ref),不反向。
 */
import { kindLabelRegex } from "../../markdown/cross-ref.js";

/**
 * 容器深度跟踪器(B7 收敛 caption_recognize / eq_numbering / xref_recognize 三处
 * 同构的嵌套层级判断):跟踪 blockquote/list_item/table_cell 开闭 token 维护深度,
 * isTopLevel() 判定当前是否处于文档顶层(三处规则均只对顶层内容生效,与 docx 侧
 * 只遍历 ast.children 顶层的契约一致)。feed 对非容器 token 无操作;调用方先 feed
 * 再判定——容器开闭 token 与内容 token(paragraph_close/math_block/heading_open)
 * 类型互斥,与原「else-if 链内联深度更新」行为等价。
 */
export function createDepthTracker(): {
  /** 按 token 类型更新容器深度(open ++ / close --) */
  feed(tokenType: string): void;
  /** 当前是否处于全部三类容器的顶层(深度均为 0) */
  isTopLevel(): boolean;
} {
  const depth = { blockquote: 0, list_item: 0, table_cell: 0 };
  return {
    feed(tokenType) {
      if (tokenType === "blockquote_open") depth.blockquote++;
      else if (tokenType === "blockquote_close") depth.blockquote--;
      else if (tokenType === "list_item_open") depth.list_item++;
      else if (tokenType === "list_item_close") depth.list_item--;
      else if (tokenType === "table_cell_open") depth.table_cell++;
      else if (tokenType === "table_cell_close") depth.table_cell--;
    },
    isTopLevel() {
      return depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0;
    },
  };
}

/** 第二遍链接扫描的结构化 token 签名(避免深导入 markdown-it/lib/token,与
 *  attrDel 同一口径):真实 Token 结构兼容(type/content/attrGet/children)。 */
export interface LinkScanToken {
  type: string;
  content: string;
  attrGet(name: string): string | null;
  children: LinkScanToken[] | null;
}

/**
 * eq_numbering / xref_recognize 第二遍「链接引用替换」共享骨架(B7 收敛两处同构
 * 循环,消除重复扫描):遍历所有 inline token 的 children(含容器/脚注内),对每个
 * href 匹配 hrefRe 的 link_open 定位「链接内(link_close 前)首个 text token」后回调
 * visit;labels 为 href 正则捕获组序列(eq 单组 label;xref 两组 kind+label)。
 * visit 返回 true → 解包该链接(悬空契约:目标锚点不存在不生成死链,仅移除
 * link_open/link_close、保留内部文本与嵌套格式),由本函数统一 splice 并回退外层
 * 下标续扫;返回 false 保持链接结构不变。
 */
export function forEachRefLink(
  tokens: readonly LinkScanToken[],
  hrefRe: RegExp,
  visit: (link: { labels: string[]; textToken: LinkScanToken | undefined }) => boolean,
): void {
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    const children = token.children;
    for (let i = 0; i < children.length; i++) {
      const linkOpen = children[i]!; // 循环边界刚检查
      if (linkOpen.type !== "link_open") continue;
      const href = linkOpen.attrGet("href");
      if (!href) continue;
      const match = hrefRe.exec(href);
      if (!match) continue;
      // 链接内第一个 text token(可能嵌套格式如 **式**,取首个文本节点替换)
      let textToken: LinkScanToken | undefined;
      for (let j = i + 1; j < children.length; j++) {
        const child = children[j]!; // 循环边界刚检查
        if (child.type === "link_close") break;
        if (child.type === "text") {
          textToken = child;
          break;
        }
      }
      if (!visit({ labels: match.slice(1), textToken })) continue;
      let closeIdx = -1;
      for (let j = i + 1; j < children.length; j++) {
        if (children[j]!.type === "link_close") { // 循环边界刚检查
          closeIdx = j;
          break;
        }
      }
      if (closeIdx > 0) {
        children.splice(closeIdx, 1);
        children.splice(i, 1);
        i--; // 回退,i++ 后从解包位置续扫
      }
    }
  }
}

/**
 * 从 inline children 尾部剥离 {#<kind>:<label>}(批次 10 功能 2):从最后一个
 * 文本叶子节点匹配(从尾向前跳过 close/html 等非文本节点,兼容 **格式** {#label}
 * 与 强调整串内带 label 的嵌套;与 docx 侧 stripTrailingSecLabel 语义一致);
 * 命中则改写该 text 节点内容并返回 label,无匹配返回 undefined 且不改动。
 */
export function stripTrailingLabel(
  children: readonly { type: string; content: string }[],
  kind: "fig" | "tab" | "sec",
): string | undefined {
  const re = kindLabelRegex(kind);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!; // 循环边界刚检查
    if (child.type !== "text") continue;
    const match = re.exec(child.content);
    if (!match) return undefined;
    child.content = child.content.slice(0, match.index);
    return match[1];
  }
  return undefined;
}

/** 删除 token 属性(markdown-it Token 无 attrDel,attrIndex + splice 实现;
 *  结构类型签名避免深导入 markdown-it/lib/token) */
export function attrDel(
  token: { attrIndex(name: string): number; attrs: Array<[string, string]> | null },
  name: string,
): void {
  const idx = token.attrIndex(name);
  if (idx >= 0 && token.attrs) token.attrs.splice(idx, 1);
}
