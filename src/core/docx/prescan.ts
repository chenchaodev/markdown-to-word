/**
 * renderDocx 预扫(B8 拆分):正文渲染前的五轮全文扫描,收敛为单次
 * prescanDocument 调用。原内联于 renderDocx 开头;预扫会就地写入 ctx
 * (footnoteDefinitions / headingLabels / equationLabels),并返回结构化结果。
 * 各轮顺序保持与拆分前一致(题注上下文 → 章节 label → 公式上下文 → 目录条目)。
 */
import type { Root, Paragraph as MdParagraph } from "mdast";
import { buildCaptionContext, type CaptionInfo } from "./handlers/captions.js";
import { buildEquationContext, type EquationContext } from "./handlers/equations.js";
import { collectPlainText } from "../util/mdast-utils.js";
import { stripSecLabelSuffix } from "../markdown/cross-ref.js";
import { docxBookmarkId } from "../markdown/slug.js";
import type { Ctx } from "./ctx.js";
import type { TocEntry } from "./chrome.js";

/** 预扫结构化结果:目录条目 + 题注上下文 + 公式编号上下文(renderBlock 渲染期消费) */
export interface DocumentPrescan {
  /** 静态目录条目(ctx.toc 开启时收集;标题书签 href,见 chrome.renderTocPage) */
  tocEntries: TocEntry[];
  /** 题注段识别表(段落节点 → CaptionInfo;renderBlock paragraph case 查表) */
  captions: Map<MdParagraph, CaptionInfo>;
  /** 公式编号上下文(display 编号/label 段跳过集;renderBlock math case 查表) */
  equations: EquationContext;
}

/**
 * 五轮预扫:
 * 1. 脚注定义索引(identifier → definition 节点,写入 ctx.footnoteDefinitions);
 * 2. 题注上下文(buildCaptionContext:图/表识别 + captionLabels 登记);
 * 3. 章节 label(headingLabels 登记,引用可能出现在目标标题之前,渲染期登记会漏;
 *    与 captions/equations 预扫模式一致。计数镜像 Word numbering 引擎逐段计数,
 *    headingNumbering 关闭时不计数 → 引用侧按悬空处理);
 * 4. 公式编号上下文(buildEquationContext,labelIndex 写入 ctx.equationLabels);
 * 5. 目录条目(ctx.toc 开启时,h1-h3 且有 id 的标题)。
 */
export function prescanDocument(ast: Root, ctx: Ctx): DocumentPrescan {
  // 预扫脚注定义:identifier → definition 节点(正文循环跳过,引用渲染时取内容)
  for (const node of ast.children) {
    if (node.type === "footnoteDefinition") {
      ctx.footnoteDefinitions.set(node.identifier, node);
    }
  }
  // 预扫目录条目 + 题注上下文(题注编号:章节号 = 最近 h1 计数,图/表序按 h1 章节重置,
  // 与 Word SEQ \s 1 语义一致;headingNumbering 关闭时无章节号、全文档连续)
  const tocEntries: TocEntry[] = [];
  const captions = buildCaptionContext(ast, ctx);
  // 预扫章节 label(批次 10 功能 2):渲染前按文档顺序遍历标题,静态章节号计数 +
  // {#sec:label} 登记。(depth 4-6 不计数,与 numbering 只挂 h1-h3 一致)
  const headingCounters = { h1: 0, h2: 0, h3: 0 };
  for (const node of ast.children) {
    if (node.type !== "heading" || ctx.headingNumbering !== true || node.depth > 3) continue;
    if (node.depth === 1) {
      headingCounters.h1 += 1;
      headingCounters.h2 = 0;
      headingCounters.h3 = 0;
    } else if (node.depth === 2) {
      headingCounters.h2 += 1;
      headingCounters.h3 = 0;
    } else {
      headingCounters.h3 += 1;
    }
    const chapterText = chapterNumberFromCounters(headingCounters, node.depth);
    const secLabel = node.data?.secLabel;
    const id = node.data?.id;
    if (chapterText !== null && secLabel !== undefined && typeof id === "string" && id !== "") {
      ctx.headingLabels.set(secLabel, { chapterText, slug: id });
    }
  }
  // 预扫公式编号上下文(9d:display 公式全文连续编号 + {#eq:label} 标签登记 + 交叉引用查表)。
  // 公式编号开关关闭时仍调用 buildEquationContext(numbering=false):label 段照常识别并
  // 跳过渲染(语法标记不显示),但公式不编号、label 不登记、无孤立 label 警告;引用查表
  // 为空 → 行内引用保持原文本(见 pushRuns 的 equationNumbering 门控)
  const equations: EquationContext = buildEquationContext(ast, ctx, ctx.equationNumbering !== false);
  // label 查表挂到 ctx(行内链接渲染处 pushRuns 经 ctx 访问)
  ctx.equationLabels = equations.labelIndex;
  if (ctx.toc) {
    for (const node of ast.children) {
      if (node.type === "heading" && node.depth <= 3) {
        const id = node.data?.id;
        if (typeof id === "string" && id !== "") {
          // 目录条目文本同标题渲染:尾部 {#sec:label} 不显示(与 renderHeading 一致)
          tocEntries.push({
            title: stripSecLabelSuffix(collectPlainText(node)),
            level: node.depth,
            href: docxBookmarkId(id),
          });
        }
      }
    }
  }
  return { tocEntries, captions, equations };
}

/**
 * 静态章节号(批次 10 功能 2,镜像 Word numbering 引擎逐级计数):
 * 编号文本 = 深度 1..depth 当前计数拼接;前导未出现的级(计数 0)跳过
 * (无 h1 时 h2 从「1」起,与题注章节语义一致),中间未出现的级保留 0
 * (h1 后直接 h3 →「1.0.1」,与 Word 引擎显示一致)。
 * 仅镜像:headingNumberingOptions 模板或 numbering 配置变更会漂移(免更新路线已声明)。
 */
function chapterNumberFromCounters(
  counters: { h1: number; h2: number; h3: number },
  depth: number,
): string | null {
  const parts: number[] = [];
  let started = false;
  for (let i = 1; i <= depth; i++) {
    const v = counters[(`h${i}`) as keyof typeof counters];
    if (!started && v === 0) continue;
    started = true;
    parts.push(v);
  }
  return parts.length > 0 ? parts.join(".") : null;
}
