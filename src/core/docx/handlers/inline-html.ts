/**
 * docx 行内 HTML 白名单子系统(自 render.ts 纯移动抽出,零行为改动)。
 * 契约:
 * - 白名单判定(isAllowedInlineHtml)与 PDF 侧共享单一实现(../html-whitelist.ts),
 *   渲染差异(本模块 normalizeInlineHtml 节点流合并 vs PDF 侧 pdf/rules/html.ts
 *   matchAllowedHtmlExpression 源码扫描)保留在各侧——两份扫描算法逐条对齐,
 *   修改任一侧须同步另一侧(html-whitelist.ts 与本处注释互为双向指针);
 * - 危险段丢弃/孤立闭标签丢弃为安全兜底契约(与"白名单外 html 跳过"语义一致,
 *   内容文本不残留)。
 * 依赖方向:render.ts 对本模块为运行时依赖;本模块对 render.ts 无依赖
 * (Ctx/InlineChild 类型取自 ctx.ts,编译期擦除,无运行时环;与 captions/
 * equations 先例一致)。
 */
import { AlignmentType, LineRuleType, Paragraph, TextRun } from "docx";
import type { PhrasingContent } from "mdast";
import { ALLOWED_INLINE_TAGS, isAllowedInlineHtml } from "../../markdown/html-whitelist.js";
import { CODE_FONT } from "../theme.js";
import type { Ctx, InlineChild } from "../ctx.js";

/** 正文段落(排版设置:两端对齐/行距/首行缩进)。
 *  普通正文段落与白名单 html 段落共用,保证白名单段落排版与正文一致。 */
export function renderBodyParagraph(children: InlineChild[], ctx: Ctx): Paragraph {
  return new Paragraph({
    alignment: ctx.typography.align === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    spacing: { line: Math.round(ctx.typography.lineSpacing * 240), lineRule: LineRuleType.AUTO },
    indent: ctx.typography.firstLineIndent ? { firstLineChars: 200 } : undefined,
    children,
  });
}

/** 白名单解析项:文本段(带累积样式标志)或换行;纯 core 结构,不依赖 docx 类型 */
interface InlineHtmlStyleFlags {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
  sub?: boolean;
  sup?: boolean;
  highlight?: boolean;
}
interface InlineHtmlText extends InlineHtmlStyleFlags {
  text: string;
}
type InlineHtmlItem = InlineHtmlText | { break: true };

/** 标签 → 样式增量(与白名单契约表一一对应;span 为透传空样式) */
const INLINE_TAG_STYLES: Record<string, InlineHtmlStyleFlags> = {
  strong: { bold: true },
  b: { bold: true },
  em: { italic: true },
  i: { italic: true },
  u: { underline: true },
  s: { strike: true },
  del: { strike: true },
  code: { mono: true },
  kbd: { mono: true },
  sub: { sub: true },
  sup: { sup: true },
  mark: { highlight: true },
  span: {},
};

/**
 * 白名单契约恒等断言:INLINE_TAG_STYLES 键集 + br(br 为空标签,
 * parseInlineHtml 特殊处理产出 break 项,不入样式表)必须与 ALLOWED_INLINE_TAGS
 * 完全一致。两处平行表(html-whitelist.ts 判定集 / 本模块样式表)任一侧增删标签
 * 而另一侧未同步时立即报错,防漂移(测试段 contract-single-source 运行期守护)。
 */
export function assertInlineTagStylesMatchWhitelist(): void {
  const styleTags = new Set(Object.keys(INLINE_TAG_STYLES));
  styleTags.add("br");
  const missing = [...ALLOWED_INLINE_TAGS].filter((tag) => !styleTags.has(tag));
  const extra = [...styleTags].filter((tag) => !ALLOWED_INLINE_TAGS.has(tag));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `白名单标签集漂移:相对 ALLOWED_INLINE_TAGS,INLINE_TAG_STYLES 缺 [${missing.join(", ")}] 多 [${extra.join(", ")}]`,
    );
  }
}

/**
 * 白名单表达式 → 解析项序列(调用方须先经 isAllowedInlineHtml 校验)。
 * 栈式扫描:开标签压入样式增量,闭标签弹出,文本段合并当前栈样式;<br> 产出 break 项。
 */
export function parseInlineHtml(value: string): InlineHtmlItem[] {
  const items: InlineHtmlItem[] = [];
  const stack: InlineHtmlStyleFlags[] = [];
  let i = 0;
  let segStart = 0;
  const pushText = (text: string): void => {
    if (text === "") return;
    const merged = stack.reduce((acc, s) => Object.assign(acc, s), {} as InlineHtmlStyleFlags);
    items.push({ text, ...merged });
  };
  while (i < value.length) {
    const open = value.indexOf("<", i);
    if (open === -1) {
      pushText(value.slice(segStart));
      break;
    }
    pushText(value.slice(segStart, open));
    const close = value.indexOf(">", open + 1);
    if (close === -1) break; // 校验层保证可达,防御终止
    const inner = value.slice(open + 1, close);
    if (inner.startsWith("/")) {
      stack.pop();
    } else {
      // 自闭合 <br/>(校验层已放行)归一为 br,不得误判为空样式标签
      const raw = inner.trim();
      const name = (raw.endsWith("/") ? raw.slice(0, -1) : raw).trim().toLowerCase();
      if (name === "br") items.push({ break: true });
      else stack.push(INLINE_TAG_STYLES[name] ?? {});
    }
    i = close + 1;
    segStart = i;
  }
  return items;
}

/**
 * 段落行内 html 归一化。micromark 将 `<em>斜</em>` 拆为 html("<em>") + text("斜") +
 * html("</em>") 三个节点,白名单表达式须合并回整串才能通过 isAllowedInlineHtml 校验:
 * 1. 白名单合并:从 html 节点起累积后续 html/text 节点,累积串一旦构成完整白名单
 *    表达式即合并为单个 html 节点(渲染为样式运行);
 * 2. 危险段丢弃:无法构成白名单表达式的开标签(带属性/非白名单),连同其内容直到
 *    第一个闭标签 html 节点整体丢弃(与"白名单外 html 跳过"安全语义一致,内容文本
 *    不残留);找不到闭标签则丢弃到段落尾;
 * 3. 孤立闭标签丢弃。
 * 纯结构变换,不依赖 docx 类型,与 PDF 侧 html_whitelist 组合语义对齐。
 */
export function normalizeInlineHtml(nodes: PhrasingContent[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!; // while 条件已保证 i < nodes.length
    if (node.type !== "html") {
      result.push(node);
      i++;
      continue;
    }
    if (/^<\//.test(node.value.trim())) {
      i++; // 孤立闭标签(前无白名单开标签):丢弃
      continue;
    }
    // 白名单合并:累积后续 html/text 节点直到构成完整表达式
    let buf = node.value;
    let j = i + 1;
    let merged = false;
    while (j < nodes.length) {
      const next = nodes[j]!; // while 条件已保证 j < nodes.length
      if (next.type === "html" || next.type === "text") buf += next.value;
      else break;
      if (isAllowedInlineHtml(buf)) {
        merged = true;
        break;
      }
      j++;
    }
    if (merged) {
      result.push({ type: "html", value: buf });
      i = j + 1;
      continue;
    }
    // 危险段丢弃:开标签起,丢弃直到并包括第一个闭标签 html 节点
    i++;
    while (i < nodes.length) {
      const cur = nodes[i]!; // while 条件已保证 i < nodes.length
      if (cur.type === "html" && /^<\//.test(cur.value.trim())) {
        i++;
        break;
      }
      i++;
    }
  }
  return result;
}

/** 白名单解析项 → TextRun 序列(break 项 → 换行 run;选项名经 d.ts 实证:
 *  italics/strike/subScript/superScript/highlight,underline 传空对象) */
export function inlineHtmlItemsToRuns(items: InlineHtmlItem[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const item of items) {
    if ("break" in item) {
      runs.push(new TextRun({ text: "", break: 1 }));
    } else {
      runs.push(
        new TextRun({
          text: item.text,
          bold: item.bold,
          italics: item.italic,
          underline: item.underline ? {} : undefined,
          strike: item.strike,
          font: item.mono ? CODE_FONT : undefined,
          subScript: item.sub,
          superScript: item.sup,
          highlight: item.highlight ? "yellow" : undefined,
        }),
      );
    }
  }
  return runs;
}

/** 白名单 html 块节点 → 正文段落(复用 renderBodyParagraph,排版设置生效) */
export function renderInlineHtmlParagraph(value: string, ctx: Ctx): Paragraph {
  return renderBodyParagraph(inlineHtmlItemsToRuns(parseInlineHtml(value)), ctx);
}
