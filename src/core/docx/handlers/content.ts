/**
 * 行内/嵌套内容渲染簇(B8 拆分):renderPhrasing / pushRuns 与脚注定义、列表、
 * 引用块渲染同模块——五者相互递归(段落行内 → 脚注定义 → 列表/引用块 → 段落行内),
 * 必须同处一模块才能保持依赖单向(render.ts → content.ts,不反向)。
 * 链接与图片分支分别委托 link-xref.ts / image-run.ts。
 */
import {
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  FootnoteReferenceRun,
  Math as DocxMath,
  Paragraph,
  TextRun,
} from "docx";
import type { Blockquote, FootnoteDefinition, List, ListItem, PhrasingContent } from "mdast";
import { CODE_FONT, CODE_SIZE, MUTED_TEXT_GRAY, QUOTE_BG_GRAY, RULE_GRAY } from "../theme.js";
import { texToDocxMath } from "./math.js";
import { isAllowedInlineHtml } from "../../markdown/html-whitelist.js";
import { inlineHtmlItemsToRuns, normalizeInlineHtml, parseInlineHtml } from "./inline-html.js";
import { pushLinkRuns } from "./link-xref.js";
import { imageToDocx } from "./image-run.js";
import { imageAttrInvalidWarning } from "../../image/image-warning.js";
import { takeImageSizeAttrs } from "../../markdown/image-size.js";
import { renderCode } from "./code-block.js";
import { renderContainerFallback, unsupportedBlockWarning } from "./fallback.js";
import { formulaParseFailedWarning, warnDedup, type Ctx, type InlineChild, type RunStyle } from "../ctx.js";

/** 行内节点 → 元素数组;样式沿父子链累积传递。
 * 标题等场景同样经 pushRuns 渲染(标题内图片/脚注引用按常规渲染,占位与警告语义与正文一致)。
 * F1:图片后紧跟的完整 {width=…}/{height=…} 属性块文本经 takeImageSizeAttrs 消费
 * (解析结果注入 imageToDocx,属性文本不再作为可见文本渲染;非法值走 keyed 警告)。 */
export async function renderPhrasing(
  nodes: PhrasingContent[],
  ctx: Ctx,
  style: RunStyle = {},
): Promise<InlineChild[]> {
  const runs: InlineChild[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === "image") {
      const taken = takeImageSizeAttrs(nodes, i);
      for (const raw of taken.invalid) {
        warnDedup(ctx, imageAttrInvalidWarning(node.url, raw));
      }
      runs.push(await imageToDocx(node, ctx, style, taken.attrs));
      if (taken.consumed) i++; // 跳过已消费的属性文本节点
      continue;
    }
    await pushRuns(runs, node, ctx, style);
  }
  return runs;
}

async function pushRuns(runs: InlineChild[], node: PhrasingContent, ctx: Ctx, style: RunStyle): Promise<void> {
  switch (node.type) {
    case "text":
      runs.push(new TextRun({ text: node.value, ...style }));
      break;
    case "emphasis":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, italics: true });
      break;
    case "strong":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, bold: true });
      break;
    case "delete":
      for (const child of node.children) await pushRuns(runs, child, ctx, { ...style, strike: true });
      break;
    case "inlineCode":
      // F3:code 默认值写在 style 展开之后——标题场景 style.size 为标题字号,
      // 行内代码保持自身小号等宽(CODE_SIZE 权威),不随所在标题放大
      runs.push(new TextRun({ ...style, text: node.value, font: CODE_FONT, size: CODE_SIZE }));
      break;
    case "inlineMath": {
      // 行内公式:KaTeX MathML → docx Math 组件,随所在段落自然继承 5a 排版;
      // 降级(解析失败/未覆盖节点)→ TeX 源码等宽灰字 + 警告,内容不丢失
      const result = texToDocxMath(node.value);
      if (result.ok) {
        runs.push(new DocxMath({ children: result.children }));
      } else {
        runs.push(new TextRun({ text: result.text, font: CODE_FONT, color: MUTED_TEXT_GRAY }));
        ctx.warnings?.push(formulaParseFailedWarning(node.value));
      }
      break;
    }
    case "link":
      // 链接/交叉引用(#eq:/#fig:/#tab:/#sec:/#锚点/http 外链)→ link-xref 单模块
      pushLinkRuns(runs, node, ctx, style);
      break;
    case "image":
      runs.push(await imageToDocx(node, ctx, style));
      break;
    case "footnoteReference": {
      const def = ctx.footnoteDefinitions.get(node.identifier);
      if (def) {
        // B3:同一脚注多次引用共享同一 id(此前每次出现分配新 id + 重渲染定义,
        // 产生两条独立脚注,与 Word 共享编号语义不符)
        let id = ctx.footnoteIdByLabel.get(node.identifier);
        if (id === undefined) {
          id = ctx.footnoteNextId.value++;
          ctx.footnotes[String(id)] = { children: await renderFootnoteDefinition(def, ctx) };
          ctx.footnoteIdByLabel.set(node.identifier, id);
        }
        runs.push(new FootnoteReferenceRun(id));
      }
      break;
    }
    case "comment": {
      // 批注(批次 11):[锚定文本]{批注=内容} → commentRangeStart + 锚定文本
      // runs(递归渲染 anchor 行内,继承当前样式)+ commentRangeEnd +
      // commentReference(必须包在 TextRun 内);批注内容收集为独立段落
      // (author 固定 "markdown-to-word",date 缺省由库取当前时间;内容不继承
      // 锚定处样式,批注气泡独立排版)
      const id = ctx.commentNextId.value++;
      runs.push(new CommentRangeStart(id));
      for (const child of node.anchor) await pushRuns(runs, child, ctx, style);
      runs.push(new CommentRangeEnd(id));
      runs.push(new TextRun({ children: [new CommentReference(id)] }));
      ctx.comments[String(id)] = {
        children: [new Paragraph({ children: await renderPhrasing(node.content, ctx) })],
      };
      break;
    }
    case "html":
      // 白名单行内 html(经 normalizeInlineHtml 已合并为整串):渲染为样式运行;
      // 非白名单(理论不可达,防御):跳过
      if (isAllowedInlineHtml(node.value)) {
        runs.push(...inlineHtmlItemsToRuns(parseInlineHtml(node.value)));
      }
      break;
    default:
      break;
  }
}

/** 分隔线(thematicBreak):底边框灰线。纯叶子渲染,脚注定义与正文共用 */
export function renderThematicBreak(): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_GRAY } },
  });
}

/** 脚注定义内容 → Paragraph[](复用现有块渲染;table 等罕见块跳过) */
async function renderFootnoteDefinition(def: FootnoteDefinition, ctx: Ctx): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  for (const child of def.children) {
    switch (child.type) {
      case "paragraph":
        paragraphs.push(new Paragraph({ children: await renderPhrasing(normalizeInlineHtml(child.children), ctx) }));
        break;
      case "list":
        paragraphs.push(...(await renderList(child, ctx)));
        break;
      case "code":
        paragraphs.push(await renderCode(child, ctx));
        break;
      case "blockquote":
        paragraphs.push(...(await renderBlockquote(child, ctx)));
        break;
      case "thematicBreak":
        paragraphs.push(renderThematicBreak());
        break;
      default:
        break; // table 等:跳过
    }
  }
  return paragraphs;
}

/** 列表:listItem 内第一个块挂编号,嵌套列表递归加深 level */
export async function renderList(node: List, ctx: Ctx): Promise<Paragraph[]> {
  const reference = node.ordered ? "md-list-number" : "md-list-bullet";
  const result: Paragraph[] = [];
  for (const item of node.children as ListItem[]) {
    for (const child of item.children) {
      if (child.type === "list") {
        // ctx 浅拷贝前提(CORE-11 显式化):Ctx 全部可变状态均为引用类型
        // (Map/Set/对象计数器),浅拷贝共享同一实例即共享可变状态;
        // 未来若新增标量可变字段,此处逐层克隆会静默失效,须改显式传递。
        result.push(...(await renderList(child, { ...ctx, listLevel: ctx.listLevel + 1 })));
      } else if (child.type === "paragraph") {
        result.push(
          new Paragraph({
            numbering: { reference, level: Math.min(ctx.listLevel, 3) },
            children: await renderPhrasing(normalizeInlineHtml(child.children), ctx),
          }),
        );
      }
      // 其他块(代码/引用等)在列表项内:G1 按普通段落降级渲染
      else if (child.type === "code") {
        result.push(await renderCode(child, ctx));
      } else if (child.type === "blockquote") {
        result.push(...(await renderBlockquote(child, ctx)));
      }
      // B4:列表项内 display 公式/html/表格此前静默丢弃 → 降级渲染 + 警告
      else if (child.type === "math" || child.type === "html" || child.type === "table") {
        result.push(...(await renderContainerFallback(child, ctx, "列表")));
      }
    }
  }
  return result;
}

export async function renderBlockquote(node: Blockquote, ctx: Ctx): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          children: await renderPhrasing(normalizeInlineHtml(child.children), ctx),
          shading: { type: "clear", fill: QUOTE_BG_GRAY },
        }),
      );
    } else if (child.type === "blockquote") {
      paragraphs.push(...(await renderBlockquote(child, ctx)));
    }
    // B4:引用块内代码块此前静默丢弃 → 按代码块渲染(renderCode 既有路径)+ 警告
    else if (child.type === "code") {
      warnDedup(ctx, unsupportedBlockWarning("代码块", "引用块"));
      paragraphs.push(await renderCode(child, ctx));
    }
    // B4:引用块内 display 公式/html/表格此前静默丢弃 → 降级渲染 + 警告
    else if (child.type === "math" || child.type === "html" || child.type === "table") {
      paragraphs.push(...(await renderContainerFallback(child, ctx, "引用块")));
    }
  }
  return paragraphs;
}
