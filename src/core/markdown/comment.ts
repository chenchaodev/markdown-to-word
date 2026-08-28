/**
 * 批注语法:行内 `[锚定文本]{批注=内容}`。
 *
 * 解析:micromark text 扩展将整段识别为单一 token(commentText),from-markdown
 * 扩展转为 mdast comment 节点(anchor/content 为行内 PhrasingContent[],经同一
 * 扩展集重新解析 → 支持加粗/斜体/链接等 rich 行内)。
 *
 * 语法限制(v1,与用户确认):
 * - 锚定文本与批注内容均单行(不跨段落;含行尾即放弃,回退普通文本);
 * - 批注内容不含 `}`(首个 `}` 即内容结束);
 * - 与链接 `[..](..)`(关键字不匹配回退)、公式 label `{#eq:label}`(独立行块级)、
 *   标题 label `{#sec:label}` 不冲突。
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { codes } from "micromark-util-symbol";
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type { CompileContext, Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { Node, PhrasingContent } from "mdast";
import type { Processor } from "unified";

/** 批注关键字(内容前缀):`{批注=` */
const COMMENT_KEYWORD = "批注=";

/** mdast comment 节点(行内):anchor = 锚定文本行内节点,content = 批注内容行内节点 */
export interface CommentNode extends Node {
  type: "comment";
  anchor: PhrasingContent[];
  content: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    comment: CommentNode;
  }
  interface RootContentMap {
    comment: CommentNode;
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    commentText: "commentText";
  }
}

/** remark 插件:注册 micromark text 扩展 + from-markdown 扩展(parse.ts 挂载) */
export function remarkComment(this: Processor): void {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions as Extension[] | undefined) ?? [];
  const fromMarkdownExtensions = (data.fromMarkdownExtensions as FromMarkdownExtension[] | undefined) ?? [];
  micromarkExtensions.push(commentSyntax());
  fromMarkdownExtensions.push(commentFromMarkdown());
  data.micromarkExtensions = micromarkExtensions;
  data.fromMarkdownExtensions = fromMarkdownExtensions;
}

/** micromark 语法扩展:text 层 `[` → commentText 构造(与 math 一致仅 text,链接 label 内不解析) */
function commentSyntax(): Extension {
  return {
    text: { [codes.leftSquareBracket]: commentText() },
  };
}

/** commentText 构造:tokenize + 名称(供 previous/调试) */
function commentText(): Construct {
  return {
    tokenize: tokenizeComment,
    name: "commentText",
  };
}

/**
 * tokenize:`[` 起扫描首个 `]{批注=`(锚定文本可含嵌套 `[`/`]`/转义),关键字
 * 逐字符比对,内容至首个 `}` 结束;锚定文本/内容含行尾或 EOF 即放弃(单段落
 * 限制),关键字不匹配放弃(回退链接等既有解析)。
 */
function tokenizeComment(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let keywordIndex = 0;
  return start;

  function start(code: Code) {
    effects.enter("commentText");
    effects.consume(code);
    return scanAnchor;
  }

  function scanAnchor(code: Code) {
    if (code === codes.eof) return nok(code);
    if (code === codes.backslash) {
      effects.consume(code);
      return scanAnchorEscaped;
    }
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      return afterAnchorBracket;
    }
    if (code === codes.lineFeed || code === codes.carriageReturn) return nok(code);
    effects.consume(code);
    return scanAnchor;
  }

  function scanAnchorEscaped(code: Code) {
    if (code === codes.eof) return nok(code);
    effects.consume(code);
    return scanAnchor;
  }

  function afterAnchorBracket(code: Code) {
    if (code === codes.leftCurlyBrace) {
      effects.consume(code);
      return scanKeyword;
    }
    return nok(code);
  }

  function scanKeyword(code: Code) {
    if (code === COMMENT_KEYWORD.codePointAt(keywordIndex)) {
      effects.consume(code);
      keywordIndex++;
      if (keywordIndex === COMMENT_KEYWORD.length) return scanContent;
      return scanKeyword;
    }
    return nok(code);
  }

  function scanContent(code: Code) {
    if (code === codes.eof) return nok(code);
    if (code === codes.rightCurlyBrace) {
      effects.consume(code);
      effects.exit("commentText");
      return ok;
    }
    if (code === codes.lineFeed || code === codes.carriageReturn) return nok(code);
    effects.consume(code);
    return scanContent;
  }
}

/** from-markdown 扩展:commentText token → comment 节点(anchor/content 重新解析) */
function commentFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { commentText: enterComment },
    exit: { commentText: exitComment },
  };
}

function enterComment(this: CompileContext, token: Token): void {
  this.enter({ type: "comment", anchor: [], content: [] }, token);
}

function exitComment(this: CompileContext, token: Token): void {
  const raw = this.sliceSerialize(token);
  const node = this.stack[this.stack.length - 1]!; // enter 已压栈,from-markdown 契约保证 exit 时栈顶为本节点
  this.exit(token);
  if (node.type !== "comment") return; // 防御:tokenizer 保证可达
  const sep = raw.indexOf(`]{${COMMENT_KEYWORD}`);
  if (sep === -1) return; // 防御:同上
  node.anchor = parseInlinePhrasing(raw.slice(1, sep));
  node.content = parseInlinePhrasing(raw.slice(sep + 2 + COMMENT_KEYWORD.length, -1));
}

/** 行内片段重新解析(锚定文本/批注内容;同一扩展集,支持 rich 行内) */
function parseInlinePhrasing(text: string): PhrasingContent[] {
  const root = fromMarkdown(text, {
    extensions: [gfm(), math(), commentSyntax()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown(), commentFromMarkdown()],
  });
  const first = root.children[0];
  return first?.type === "paragraph" ? (first.children as PhrasingContent[]) : [];
}