/**
 * docx 渲染共享契约:Ctx 渲染上下文与行内元素/样式类型单源。
 * 不变量:子模块统一从本模块取型,依赖方向单向(子模块 → ctx,不反向)。
 */
import type {
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  ExternalHyperlink,
  FootnoteReferenceRun,
  ImageRun,
  InternalHyperlink,
  Math as DocxMath,
  Paragraph,
  TextRun,
} from "docx";
import type { FootnoteDefinition } from "mdast";
import type { BlockContent } from "mdast";
import type { ConvertWarning, KeyedWarning } from "../i18n.js";
import type { TypographySettings } from "../settings/typography.js";
import type { MermaidResolver } from "../markdown/mermaid.js";
import type { ImageResolver } from "../image/image-resolver.js";
import type { TocMode } from "../settings/settings-defaults.js";
import type { CaptionLabelInfo } from "./handlers/captions.js";

/** 单次图片解析结果:data 为 null 表示失败,error 保留原始抛错(成功时 error 不存在) */
export interface ImageLoadResult {
  data: Buffer | null;
  error?: unknown;
}

/** mdast math 节点(display 公式;经 remark-math/mdast-util-math 扩充进 BlockContent)。
 *  单源别名:equations.ts 与 fallback.ts 原各持一份,统一取型于此。 */
export type MdMath = Extract<BlockContent, { type: "math" }>;

export interface Ctx {
  imageResolver?: ImageResolver;
  warnings?: ConvertWarning[];
  listLevel: number;
  /** 排版设置(已解析默认,渲染时以 typography 为准) */
  typography: TypographySettings;
  /** 一级标题前分页(已解析默认:关) */
  breakBeforeH1: boolean;
  /** 标题章节自动编号(h1-h3 挂 numbering;已解析默认:取 typography.headingNumbering) */
  headingNumbering: boolean;
  /** 图/表题注自动编号(已解析默认:取 typography.captionNumbering) */
  captionNumbering: boolean;
  /** 自动生成目录页(已解析默认:开) */
  toc: boolean;
  /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码;已解析默认 static) */
  tocMode: TocMode;
  /** 公式编号开关(已解析默认:开;关时公式原样渲染、label 段原样渲染、引用保持原文本) */
  equationNumbering: boolean;
  /** 脚注定义索引:identifier → definition 节点(renderDocx 预扫) */
  footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** 脚注收集器:引用渲染时写入,id 字符串从 "1" 起 */
  footnotes: Record<string, { children: Paragraph[] }>;
  /** 下一个脚注 id(可变对象,嵌套引用共用计数器) */
  footnoteNextId: { value: number };
  /** identifier → 已分配脚注 id(重复引用共享同一脚注,与 Word 语义一致) */
  footnoteIdByLabel: Map<string, number>;
  /** 已发出过的警告集合(悬空交叉引用等逐引用去重,防 GUI 警告列表刷屏)。
   *  注意:pdf 侧并非同模式——pdf 各规则自建 unknownLabels Set(equation.ts/xref.ts)
   *  按引用键去重,与本处「key + JSON(params)」机制并行,两套互不感知。 */
  warnedKeys: Set<string>;
  /** 公式 label → 编号查表(renderDocx 预扫后挂入;行内交叉引用渲染用) */
  equationLabels?: Map<string, number>;
  /** 题注 label → 编号文本(图/表交叉引用查表;buildCaptionContext 预扫时登记) */
  captionLabels: Map<string, CaptionLabelInfo>;
  /** 章节 label → 章节号文本 + 标题书签 slug(章节交叉引用查表;renderDocx 预扫登记) */
  headingLabels: Map<string, HeadingLabelInfo>;
  /** docx 书签 linkId 自增计数器(逐文档新建,保证文档内 bookmarkStart/End id 唯一) */
  bookmarkNextId: { value: number };
  /** 批注 id 自增计数器(逐文档新建,保证文档内 commentRangeStart/End/Reference id 唯一) */
  commentNextId: { value: number };
  /** 批注收集器:引用渲染时写入,id 字符串从 "1" 起(与脚注同模式) */
  comments: Record<string, { children: Paragraph[] }>;
  /** Mermaid 渲染回调(mermaid 围栏代码块 → 内嵌 PNG 图片;缺失时按普通代码块渲染) */
  mermaidResolver?: MermaidResolver;
  /** 正文内容区宽(px,96dpi;= 文本区 twips ÷ 15,renderDocx 构造时注入)。
   *  图片尺寸属性百分比(width/height=%)相对该宽度换算。 */
  contentWidthPx: number;
  /** 图片解析 memo(url → 在途/已成功结果 Promise)。ctx 生命周期 = 单次转换,
   *  不跨转换泄漏;以 Promise 缓存保证并发同 URL 共享同一请求。成功缓存、失败
   *  (null/抛错)不缓存——失败条目结算后删除,同一 URL 后续出现重试。 */
  imageMemo: Map<string, Promise<ImageLoadResult>>;
}

  /** 章节 label 登记信息(交叉引用查表) */
export interface HeadingLabelInfo {
  /** 静态章节号文本(「1」「3.2」「3.2.1」;无 h1 时从「1」起,见 chapterNumberFromCounters) */
  chapterText: string;
  /** 标题书签 slug(引用跳转 anchor = docxBookmarkId(slug)) */
  slug: string;
}

  /** 行内 run 样式(沿父子链累积传递;size 为 half-points,标题字号经此下发) */
export interface RunStyle {
  italics?: boolean;
  bold?: boolean;
  strike?: boolean;
  size?: number;
}

/** 段落内可出现的 docx 子元素:文本 run、行内图片、脚注引用、超链接、公式或
 *  批注范围标记(d.ts 实证:Math 与 CommentRangeStart/End/Reference 均属
 *  ParagraphChild,可与 TextRun 同段混排)。 */
export type InlineChild =
  | TextRun
  | ImageRun
  | FootnoteReferenceRun
  | InternalHyperlink
  | ExternalHyperlink
  | DocxMath
  | CommentRangeStart
  | CommentRangeEnd
  | CommentReference;

/**
 * 去重警告:同一文案只入 warnings 一次。悬空交叉引用被引 N 次此前产生
 * N 条重复警告,GUI 警告列表刷屏;pdf 侧 unknownLabels Set 早已去重,此处对齐
 * (机制两套并行:本函数按 key + JSON(params),pdf 按「前缀:label」引用键,见
 * ctx.warnedKeys 注释)。元素改为 KeyedWarning 对象后,去重键 = key + JSON(params)
 * (params 相同才视为同一警告;不同 TeX 源码/label 的公式降级各自保留一条)。
 */
export function warnDedup(ctx: Ctx, warning: KeyedWarning): void {
  const dedupKey = `${warning.key}:${JSON.stringify(warning.params ?? null)}`;
  if (ctx.warnedKeys.has(dedupKey)) return;
  ctx.warnedKeys.add(dedupKey);
  ctx.warnings?.push(warning);
}

/** 公式解析失败降级警告(display/inline 共用同一 key,params 带 TeX 源码) */
export function formulaParseFailedWarning(tex: string): KeyedWarning {
  return {
    key: "warn.formulaParseFailed",
    params: { tex },
    fallback: `公式解析失败,降级为 TeX 源码: ${tex}`,
  };
}
