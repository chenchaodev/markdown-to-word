/**
 * 标题块渲染:renderHeading + 行内 sec label 剥离。
 * {#sec:label} 的章节号登记在 prescan(xref.headingLabels),本模块只负责渲染期剥离
 * 与标题段落构造(书签包裹/编号挂载/h1 前分页)。
 * 双管线对应:src/core/pdf/rules/heading-id.ts(pdf 侧标题 id/锚点注入规则)。
 * 差异与同步点:id 去重单源 core/markdown/slug.ts uniqueSlug——本侧 id 在
 * pipeline/parse.ts 生成、渲染期经 docxBookmarkId 包书签(Word 命名限制);
 * pdf 侧在 heading-id.ts 渲染期生成 HTML id 并注入 sec 锚点 span。
 * {#sec:label} 剥离:本侧 slug 在 pipeline/parse.ts、渲染文本在本模块
 * (stripSecLabelSuffix 单源);pdf 侧统一在 xref_recognize 扫描期。修改
 * id/label 剥离/锚点语义须同步核对 src/core/pdf/rules/heading-id.ts。
 */
import { HeadingLevel, Paragraph } from "docx";
import type { Heading, PhrasingContent } from "mdast";
import { stripSecLabelSuffix } from "../../markdown/cross-ref.js";
import { docxBookmarkId } from "../../markdown/slug.js";
import { headingFontSizePt, headingSpacingTwips } from "../../settings/typography.js";
import { renderPhrasing } from "./content.js";
import { wrapBookmark } from "./bookmark.js";
import type { Ctx } from "../ctx.js";

export async function renderHeading(node: Heading, ctx: Ctx): Promise<Paragraph> {
  const levels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  // 标题排版粒度:字号/段前段后由 headingScale/headingSpacing 档位参数化
  // (纯函数单源 core/settings/typography.ts,pdf CSS 同源换算,双格式观感对齐);
  // 字号 half-points = pt × 2,经 RunStyle 下发到标题内文本 runs
  const { typography } = ctx.config;
  const sizeHalfPoints =
    headingFontSizePt(typography.bodySizePt, typography.headingScale, node.depth) * 2;
  const spacing = headingSpacingTwips(typography.headingSpacing, node.depth);
  // 行内 label:{#sec:label} 尾部后缀不渲染——渲染前从最后一个
  // 叶子文本节点剥离(递归副本,不改 AST;parse.ts 已从 slug 剥离,此处剥离
  // 渲染文本,label 不进标题文本;label 的章节号登记在 renderDocx 预扫完成)
  const secLabel = node.data?.secLabel;
  const children = secLabel !== undefined ? stripTrailingSecLabel(node.children) : node.children;
  const runs = await renderPhrasing(children, ctx, { size: sizeHalfPoints });
  // parse.ts 将标题 id 挂于 data.id(mdast Data 已声明合并,见 parse.ts)
  const id = node.data?.id;
  return new Paragraph({
    heading: levels[node.depth] ?? HeadingLevel.HEADING_6,
    spacing: { before: spacing.before, after: spacing.after },
    pageBreakBefore: node.depth === 1 && ctx.config.breakBeforeH1,
    numbering:
      node.depth <= 3 && ctx.config.headingNumbering
        ? { reference: "md-heading", level: node.depth - 1 }
        : undefined,
    // docx 9.x Paragraph 无 bookmarks 选项:书签以 BookmarkStart/End 包裹标题 runs
    // 实现(linkId 由 ctx.xref.bookmarkNextId 自增,避免组件级恒为 1 的书签 id 冲突)
    children:
      typeof id === "string" && id !== ""
        ? wrapBookmark(ctx.xref.bookmarkNextId, docxBookmarkId(id), runs)
        : runs,
  });
}

/** 递归剥离最后一个叶子文本节点尾部的 {#sec:label}(渲染文本不含 label;
 *  返回副本,不改 AST;label 位于强调/加粗等嵌套节点内也命中) */
function stripTrailingSecLabel(children: PhrasingContent[]): PhrasingContent[] {
  if (children.length === 0) return children;
  const result = children.slice();
  const last = result[result.length - 1]!; // 函数首行已守卫 children.length > 0
  if (last.type === "text") {
    result[result.length - 1] = { ...last, value: stripSecLabelSuffix(last.value) };
  } else if ("children" in last && Array.isArray(last.children) && last.children.length > 0) {
    // mdast children 联合类型收窄不完全,渲染场景恒为数组,显式断言后递归
    result[result.length - 1] = {
      ...last,
      children: stripTrailingSecLabel(last.children as PhrasingContent[]),
    } as PhrasingContent;
  }
  return result;
}
