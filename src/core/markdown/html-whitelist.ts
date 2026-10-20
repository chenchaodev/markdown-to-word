/**
 * HTML 白名单:docx 与 pdf 双格式共享的单一实现。
 *
 * 职责分三层,都收在本模块,两侧只做渲染映射:
 * - 词法/语法:`tokenizeHtml` 容错切分,`parseStrictFragment` 按白名单组成节点树;
 * - 判定:`isAllowedInlineHtml`(行内表达式)· `parseAllowedContainer`(对齐容器);
 * - 降级:`stripUnsupportedHtml` 剥掉白名单外标签、保留其中文本;
 *   `inspectHtmlUsage` 给预检提供标签/属性两级事实。
 *
 * 能力边界(刻意收窄,勿在渲染侧顺手放宽):
 * - 行内标签一律无属性;块级只放行 div/p 的 align;
 * - 不做容器内 Markdown 解析,也不跨多个 Markdown 节点配对开闭标签;
 * - 序列化只由本模块产出,调用方不得把用户原文直接拼进 HTML。
 *
 * 双管线渲染差异(本模块不含渲染):
 * - docx:src/core/docx/handlers/inline-html.ts(节点流合并 + 样式 run)
 * - pdf:src/core/pdf/rules/html.ts(源码表达式匹配 + 重新序列化)
 */

/** 内联格式白名单标签(无属性才渲染;docx/pdf 双格式契约) */
export const ALLOWED_INLINE_TAGS = new Set([
  "strong", "b", "em", "i", "u", "s", "del", "code", "kbd", "sub", "sup", "mark", "br", "span",
]);

/** 块级容器白名单(内容限文本 + 行内白名单标签,不嵌套容器) */
export const ALLOWED_CONTAINER_TAGS = new Set(["div", "p"]);

/** 容器标签唯一允许的属性名 */
export const CONTAINER_ATTRIBUTES = new Set(["align"]);

/** align 取值域(序列化时写回 style,不依赖已废弃的 align 表现属性) */
export const ALIGN_VALUES = new Set(["left", "center", "right"]);

/** 内容整段丢弃的标签:其内部是脚本/样式/嵌入内容,保留文本只会把源码印进文档 */
const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "template"]);

/** HTML 空元素:不参与配对;白名单内只有 br,其余仅用于表达式边界扫描 */
const VOID_TAGS = new Set(["br", "img", "hr", "input", "meta", "link", "source", "wbr"]);

const TAG_NAME_RE = /^[a-z][a-z0-9]*$/;

export type HtmlAlign = "left" | "center" | "right";

export interface HtmlAttribute {
  readonly name: string;
  readonly value: string;
}

export interface HtmlText {
  readonly type: "text";
  readonly value: string;
}

export interface HtmlElement {
  readonly type: "element";
  readonly tag: string;
  readonly children: readonly HtmlNode[];
}

export type HtmlNode = HtmlText | HtmlElement;

export interface HtmlContainer {
  readonly tag: "div" | "p";
  readonly align?: HtmlAlign;
  readonly children: readonly HtmlNode[];
}

/** 预检用的事实:白名单外标签名 + 被忽略的属性(按 tag+attr 去重) */
export interface HtmlUsage {
  readonly unknownTags: ReadonlySet<string>;
  readonly ignoredAttributes: readonly { readonly tag: string; readonly attr: string }[];
}

/* ---------------- 词法 ---------------- */

type HtmlToken =
  | { readonly kind: "open"; readonly name: string; readonly attrs: readonly HtmlAttribute[]; readonly selfClosing: boolean; readonly malformed: boolean; readonly end: number }
  | { readonly kind: "close"; readonly name: string; readonly attrs: readonly HtmlAttribute[]; readonly malformed: boolean; readonly end: number }
  | { readonly kind: "comment"; readonly end: number; readonly malformed: boolean }
  | { readonly kind: "text"; readonly value: string };

/** 从 `<` 处读一个标签;不是标签起点(如 `<3`、`< div>`)返回 null。 */
function readTag(text: string, start: number): Exclude<HtmlToken, { kind: "text" }> | null {
  if (text[start] !== "<") return null;
  if (text.startsWith("<!--", start)) {
    const end = text.indexOf("-->", start + 4);
    return { kind: "comment", end: end === -1 ? text.length : end + 3, malformed: end === -1 };
  }
  // <!doctype>/<![CDATA[ 等声明按注释处理:不渲染、不报未知标签
  if (text[start + 1] === "!" || text[start + 1] === "?") {
    const end = text.indexOf(">", start + 2);
    return { kind: "comment", end: end === -1 ? text.length : end + 1, malformed: end === -1 };
  }

  let i = start + 1;
  const closing = text[i] === "/";
  if (closing) i += 1;
  const nameStart = i;
  while (i < text.length && /[A-Za-z0-9-]/.test(text[i]!)) i += 1;
  if (i === nameStart) return null;
  const name = text.slice(nameStart, i).toLowerCase();
  if (!/^[a-z]/.test(name)) return null;

  if (closing) {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    const malformed = text[i] !== ">";
    return { kind: "close", name, attrs: [], malformed, end: malformed ? text.length : i + 1 };
  }

  const attrs: HtmlAttribute[] = [];
  let selfClosing = false;
  let malformed = false;
  let closed = false;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (i >= text.length) break;
    if (text[i] === ">") {
      i += 1;
      closed = true;
      break;
    }
    if (text[i] === "/" && text[i + 1] === ">") {
      selfClosing = true;
      i += 2;
      closed = true;
      break;
    }
    const attrStart = i;
    while (i < text.length && !/[\s"'>/=]/.test(text[i]!)) i += 1;
    if (i === attrStart) {
      // 游离字符(如属性之间多余的 =):容错跳过,严格校验会拒绝
      malformed = true;
      i += 1;
      continue;
    }
    const attrName = text.slice(attrStart, i).toLowerCase();
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    let value = "";
    if (text[i] === "=") {
      i += 1;
      while (i < text.length && /\s/.test(text[i]!)) i += 1;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        const valueEnd = text.indexOf(quote, i);
        if (valueEnd === -1) {
          malformed = true;
          i = text.length;
          break;
        }
        value = text.slice(i, valueEnd);
        i = valueEnd + 1;
      } else {
        const valueStart = i;
        while (i < text.length && !/[\s>]/.test(text[i]!)) i += 1;
        value = text.slice(valueStart, i);
      }
    }
    attrs.push({ name: attrName, value });
  }
  if (!closed) malformed = true;
  return { kind: "open", name, attrs, selfClosing, malformed, end: i };
}

/** 容错词法:无法识别的 `<` 留在文本里,不抛错(预检与剥壳都要能走完) */
function tokenizeHtml(text: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number): void => {
    if (end > textStart) tokens.push({ kind: "text", value: text.slice(textStart, end) });
  };
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) break;
    const tag = readTag(text, open);
    if (tag === null) {
      i = open + 1;
      continue;
    }
    pushText(open);
    tokens.push(tag);
    i = tag.end;
    textStart = i;
  }
  pushText(text.length);
  return tokens;
}

/* ---------------- 严格解析 ---------------- */

function isAlignValue(value: string): boolean {
  return normalizeAlign(value) !== null;
}

/** align 取值大小写不敏感;返回归一化值,域外返回 null */
function normalizeAlign(value: string): HtmlAlign | null {
  const lower = value.trim().toLowerCase();
  return ALIGN_VALUES.has(lower) ? (lower as HtmlAlign) : null;
}

function attrsAllowed(tag: string, attrs: readonly HtmlAttribute[], allowContainer: boolean): boolean {
  if (attrs.length === 0) return true;
  if (!allowContainer || !ALLOWED_CONTAINER_TAGS.has(tag)) return false;
  return attrs.every((attr) => CONTAINER_ATTRIBUTES.has(attr.name) && isAlignValue(attr.value));
}

interface ParseSeqResult {
  readonly nodes: HtmlNode[];
  readonly next: number;
  readonly closeName: string | null;
}

/**
 * 严格解析一段 token:只放行白名单标签;容器只允许出现在最外层,
 * 嵌套容器、带属性行内标签、未闭合/错配/注释一律返回 null。
 */
function parseStrictSeq(tokens: readonly HtmlToken[], start: number, allowContainer: boolean): ParseSeqResult | null {
  const nodes: HtmlNode[] = [];
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === "text") {
      if (token.value.includes("<")) return null; // 无法识别的 `<` 不是合法白名单内容
      nodes.push({ type: "text", value: token.value });
      i += 1;
      continue;
    }
    if (token.kind === "comment") return null;
    if (token.kind === "close") {
      if (token.malformed || token.attrs.length > 0 || !TAG_NAME_RE.test(token.name)) return null;
      return { nodes, next: i + 1, closeName: token.name };
    }
    if (token.malformed) return null;
    if (token.name === "br") {
      if (token.attrs.length > 0) return null;
      nodes.push({ type: "element", tag: "br", children: [] });
      i += 1;
      continue;
    }
    const isContainer = ALLOWED_CONTAINER_TAGS.has(token.name);
    if (isContainer && !allowContainer) return null;
    if (!isContainer && !ALLOWED_INLINE_TAGS.has(token.name)) return null;
    if (token.attrs.length > 0 && !attrsAllowed(token.name, token.attrs, allowContainer)) return null;
    if (token.selfClosing) return null; // 非空标签的自闭合形式不放行(保守)
    const inner = parseStrictSeq(tokens, i + 1, false);
    if (inner === null || inner.closeName !== token.name) return null;
    nodes.push({ type: "element", tag: token.name, children: inner.nodes });
    i = inner.next;
  }
  return { nodes, next: i, closeName: null };
}

function parseStrictRoot(text: string, allowContainer: boolean): HtmlNode[] | null {
  const tokens = tokenizeHtml(text);
  const parsed = parseStrictSeq(tokens, 0, allowContainer);
  if (parsed === null || parsed.closeName !== null || parsed.next !== tokens.length) return null;
  return [...parsed.nodes];
}

/* ---------------- 判定与解析 ---------------- */

/**
 * 内联 HTML 白名单判定:整串须完全由「白名单无属性标签 + 文本」构成才合法。
 * 开标签仅允许纯标签名(可带尾随空白);带属性一律非法;闭标签须与栈顶匹配;
 * br 为空标签不入栈;自闭合 `<br/>` / `<br />` 合法(非空标签自闭合仍非法);
 * 文本段不允许出现 `<`;注释与未闭合/错配/非白名单一律 false。
 * 调用方按安全兜底处理:先 stripUnsupportedHtml 再按纯文本输出。
 */
export function isAllowedInlineHtml(content: string): boolean {
  const nodes = parseStrictRoot(content.trim(), false);
  if (nodes === null) return false;
  return nodes.every((node) => node.type !== "element" || !ALLOWED_CONTAINER_TAGS.has(node.tag));
}

/**
 * 解析对齐容器:整串必须恰好是一个 div/p,align 可选且取值在域内,
 * 内容只允许文本与行内白名单标签(不嵌套容器、不解析 Markdown)。
 */
export function parseAllowedContainer(content: string): HtmlContainer | null {
  const root = parseStrictRoot(content.trim(), true);
  if (root === null || root.length !== 1) return null;
  const element = root[0]!;
  if (element.type !== "element" || !ALLOWED_CONTAINER_TAGS.has(element.tag)) return null;
  const raw = content.trim();
  const tokens = tokenizeHtml(raw);
  const open = tokens[0];
  if (open === undefined || open.kind !== "open") return null;
  const alignAttr = open.attrs.find((attr) => attr.name === "align");
  const align = alignAttr === undefined ? null : normalizeAlign(alignAttr.value);
  const tag = element.tag === "p" ? "p" : "div";
  return align === null ? { tag, children: element.children } : { tag, align, children: element.children };
}

/* ---------------- 序列化 ---------------- */

function serializeNodes(nodes: readonly HtmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
    } else if (node.tag === "br") {
      out += "<br>";
    } else {
      out += `<${node.tag}>${serializeNodes(node.children)}</${node.tag}>`;
    }
  }
  return out;
}

/** 容器 → 安全 HTML:style 由本模块按 align 枚举生成,用户原文不直接进输出 */
export function serializeAllowedContainer(container: HtmlContainer): string {
  const style = container.align === undefined ? "" : ` style="text-align:${container.align}"`;
  return `<${container.tag}${style}>${serializeNodes(container.children)}</${container.tag}>`;
}

/** 容器子节点 → 行内表达式字符串(供 docx 侧复用既有 parseInlineHtml) */
export function serializeInlineNodes(nodes: readonly HtmlNode[]): string {
  return serializeNodes(nodes);
}

/**
 * 单个 html 片段是否属于「整段丢弃」标签(供 docx 节点流合并判断要不要跳过其内容)。
 * 只认恰好一个标签的片段;混有文本时返回 null,交由剥壳路径处理。
 */
export function droppedTagTokenKind(value: string): "open" | "close" | null {
  const tokens = tokenizeHtml(value.trim());
  if (tokens.length !== 1) return null;
  const token = tokens[0]!;
  if ((token.kind === "open" || token.kind === "close") && DROPPED_TAGS.has(token.name)) {
    return token.kind;
  }
  return null;
}

/* ---------------- 降级 ---------------- */

/**
 * 剥掉白名单外标签、保留其中文本。
 * - 注释与声明整段丢弃;
 * - DROPPED_TAGS 的整棵子树丢弃(脚本/样式/嵌入内容);
 * - 其余标签只删标签本身,内部文本按原顺序保留(换行保留,由渲染侧决定是否转 br)。
 */
export function stripUnsupportedHtml(content: string): string {
  const tokens = tokenizeHtml(content);
  const dropStack: string[] = [];
  let out = "";
  for (const token of tokens) {
    if (token.kind === "text") {
      if (dropStack.length === 0) out += token.value;
      continue;
    }
    if (token.kind === "comment") continue;
    if (token.kind === "open") {
      if (DROPPED_TAGS.has(token.name) && !token.selfClosing) {
        dropStack.push(token.name);
      } else if (token.name === "br" && dropStack.length === 0) {
        out += "\n";
      }
      continue;
    }
    // close
    if (DROPPED_TAGS.has(token.name) && dropStack.length > 0) {
      dropStack.pop();
    }
  }
  return out;
}

/** 表达式边界扫描:从 pos 处的开标签起,返回配平结束位置的长度;不成对返回 -1。 */
export function htmlExpressionLength(source: string, pos: number): number {
  if (source[pos] !== "<") return -1;
  const first = readTag(source, pos);
  if (first === null || first.kind !== "open" || first.malformed) return -1;
  if (VOID_TAGS.has(first.name)) return first.end - pos;

  let depth = 1;
  let i = first.end;
  while (i < source.length) {
    const next = source.indexOf("<", i);
    if (next === -1) return -1;
    const tag = readTag(source, next);
    if (tag === null) {
      i = next + 1;
      continue;
    }
    if (tag.kind === "open" && !VOID_TAGS.has(tag.name) && !tag.selfClosing) depth += 1;
    if (tag.kind === "close") depth -= 1;
    if (depth === 0) return tag.end - pos;
    i = tag.end;
  }
  return -1;
}

/* ---------------- 预检事实 ---------------- */

/** 收集白名单外标签与被忽略的属性:预检据此报两级告警,不参与渲染判定。 */
export function inspectHtmlUsage(content: string): HtmlUsage {
  const tokens = tokenizeHtml(content);
  const unknownTags = new Set<string>();
  const ignored: { tag: string; attr: string }[] = [];
  const seen = new Set<string>();
  const noteAttr = (tag: string, attr: string): void => {
    const key = `${tag}\u0000${attr}`;
    if (seen.has(key)) return;
    seen.add(key);
    ignored.push({ tag, attr });
  };
  for (const token of tokens) {
    if (token.kind === "text" || token.kind === "comment") continue;
    const known = ALLOWED_INLINE_TAGS.has(token.name) || ALLOWED_CONTAINER_TAGS.has(token.name);
    if (!known) {
      unknownTags.add(token.name);
      continue;
    }
    const allowed = ALLOWED_CONTAINER_TAGS.has(token.name) ? CONTAINER_ATTRIBUTES : new Set<string>();
    for (const attr of token.attrs) {
      if (!allowed.has(attr.name)) {
        noteAttr(token.name, attr.name);
      } else if (attr.name === "align" && !isAlignValue(attr.value)) {
        noteAttr(token.name, attr.name);
      }
    }
  }
  return { unknownTags, ignoredAttributes: ignored };
}
