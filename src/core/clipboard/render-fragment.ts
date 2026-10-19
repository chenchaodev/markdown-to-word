/**
 * markdown → 可粘贴富文本 HTML 片段(Word / WPS 经 CF_HTML 粘贴)。
 *
 * 本文件是**独立于 pdf 管线**的渲染入口:只 import core 的共享模块,不 import
 * `core/pdf/**`。原因不是洁癖 —— pdf 侧产出完整文档外壳、依赖 Chromium/Katex CSS
 * 与 file:// 图片,而剪贴板要的是一个自包含片段(全内联 style、图片 data:、无
 * `<style>`/class 依赖),两者复用外壳只会把宿主形态带进片段。
 *
 * ## 保真形态(已由两轮 spike 实测,勿改)
 * - 代码块/引用块一律单格 `<table>` 承载:`<pre>` 底色/边框被 Word 丢弃,
 *   `<blockquote>` 边框同样被丢弃;`border-left` 只能挂 `<td>`(WPS 会对块级元素
 *   按行盒逐行画框)。
 * - 所有表格写固定 pt 宽(`contentWidthPt`),不用 `width:100%` —— 两端都溢出。
 * - 标题/题注编号写进文本节点,不依赖 CSS counter / `::before`。
 *
 * ## 已知降级(已登记,MVP 不实现)
 * - 公式:用 @mdit/plugin-katex 识别语法,但覆盖 `math_inline`/`math_block`,输出
 *   TeX 源码等宽文本;OMML/KaTeX DOM 后置。
 * - Mermaid:按普通代码块输出,不调 mermaidResolver。
 * - 交叉引用 `[x](#eq:label)` / `[x](#fig:label)` 等内部锚点:粘贴后必然失效,
 *   降级为纯文本(剥链接保文本),不输出 `<a href="#…">`。
 * - 脚注:引用与脚注区保留文本,不生成内部跳转锚点。
 *
 * ## 图片
 * 本地路径先按 `baseDir` + 注入的 `realpathSync` 做边界校验(越界=失败,不读),
 * 校验通过后与 http(s) 一样交给注入的 `imageResolver` 取字节,经 `mimeFromBuffer`
 * 转 data URI。失败时只留灰色占位文本,绝不回退 `file://` 或外链。
 */
import type MarkdownIt from "markdown-it";
import type { ConvertStage } from "../ipc-contract.js";
import type { SharedRenderOptions } from "../settings/render-options.js";
import { resolveRenderSwitches } from "../settings/render-options.js";
import { validatePageSetup } from "../settings/settings-defaults.js";
import type { TypographySettings } from "../settings/typography.js";
import { createBaseMarkdownIt } from "../markdown/markdown-it-factory.js";
import { replaceTaskCheckboxes } from "../markdown/task-list.js";
import {
  bumpHeadingCounter,
  chapterNumberFromCounters,
  createHeadingCounters,
} from "../markdown/heading-numbering.js";
import {
  bumpCaptionCounter,
  captionNumberText,
  createCaptionCounters,
  resetCaptionCounters,
} from "../markdown/caption-numbering.js";
import {
  CAPTION_PREFIX_RE,
  kindLabelRegex,
  stripSecLabelSuffix,
  type CaptionKind,
} from "../markdown/cross-ref.js";
import { tableColumnWidthsFromSource } from "../markdown/table-width.js";
import { createLocalImagePathPolicy } from "../image/image-path-policy.js";
import { mimeFromBuffer } from "../image/image-type.js";
import {
  imageLoadFailedWarning,
  imageLoadFailureWarning,
  unrecognizedImageWarning,
} from "../image/image-warning.js";
import { createCancellationGuard, isConversionCanceled } from "../cancel.js";
import { createGuardedImageResolver } from "../image/request-guard.js";
import { ImageBudgetLedger, resolveImageBudget } from "../resource-limits.js";
import { pushWarningOnce, type ConvertWarning } from "../i18n/index.js";
import { escapeHtml } from "../text/text-escape.js";
import {
  blockquoteClose,
  blockquoteOpen,
  codeBlockTable,
  resolveColumnWidths,
  tableClose,
  tableOpen,
  textAlignFromTokenStyle,
} from "./blocks.js";
import {
  bodyCellStyle,
  captionStyle,
  contentWidthPt,
  footnoteListStyle,
  footnoteRefStyle,
  formatPt,
  fragmentStyle,
  headerCellStyle,
  headingStyle,
  imageStyle,
  inlineCodeStyle,
  linkStyle,
  listItemStyle,
  listStyle,
  pageBreakHtml,
  paragraphStyle,
} from "./styles.js";
import { htmlToPlainText } from "./html-text.js";

/** 剪贴板渲染选项:共有开关 + 本路径必需的宿主能力注入 */
export interface RenderClipboardOptions extends SharedRenderOptions {
  /** markdown 文件所在目录,相对路径图片以此为基准 */
  baseDir: string;
  /** 本地图片路径边界判定(adr-012);**必填** —— 缺省等于静默关闭符号链接逃逸防线 */
  realpathSync: (candidate: string) => string;
  /** 渲染子阶段上报(复用 ConvertStage 的 parse/inline 键) */
  onStage?: (stage: ConvertStage) => void;
}

/** 剪贴板片段:不是完整文档,顶层恰好一个 `<div>` */
export interface ClipboardFragment {
  /** 片段(顶层一个 `<div>`,内部全部内联 style) */
  html: string;
  /** 纯文本回退(text/plain),段落/列表项/代码行之间以换行分隔 */
  text: string;
}

/** 渲染期共享状态(经 markdown-it env 传入各渲染规则) */
interface ClipboardEnv {
  warnings: ConvertWarning[];
  warnedKeys: Set<string>;
  /** markdown 源码行(表格列宽信号与 pdf 侧同源解析) */
  lines: readonly string[];
  typography: TypographySettings;
  /** 内容区宽(pt):表格/代码块/引用块/图片上限的唯一宽度 */
  widthPt: number;
  /** 图片 src → data URI(失败项不在此表) */
  images: Map<string, string>;
  /** 当前 GFM 表格各列宽(pt;表头 th 消费) */
  tableWidths: number[];
  /** 当前行已消费到第几列 */
  tableColumn: number;
  /** 当前 list_item 嵌套深度(段落是否取消首行缩进) */
  listDepth: number;
  /** 链接开闭配对栈:true = 内部/非法协议,已降级为纯文本 */
  linkStack: boolean[];
  headingNumbering: boolean;
  captionNumbering: boolean;
}

/** 结构性 token 签名(避免深导入 markdown-it/lib/token) */
interface InlineChildLike {
  type: string;
  content: string;
  attrGet?: (name: string) => string | null;
  children?: InlineChildLike[] | null;
}

interface BlockTokenLike {
  type: string;
  tag?: string;
  children?: InlineChildLike[] | null;
}

/**
 * markdown → 剪贴板片段。
 *
 * 流程:markdown-it 解析(core 规则完成标题/题注字面编号)→ 收集图片 src →
 * 注入式解析/边界校验/转 data URI → 渲染器输出全内联 style 片段 → 纯文本回退。
 * 取消守卫在解析前后与图片阶段边界设检查点;图片失败降级为占位 + 既有 keyed 警告。
 */
export async function renderClipboardFragment(
  mdSource: string,
  options: RenderClipboardOptions,
): Promise<ClipboardFragment> {
  const guard = options.guard ?? createCancellationGuard();
  guard.throwIfCanceled();

  // 开关与页面几何:与 pdf 侧同一套解析/校验入口(landscape 已按视觉方向交换)
  const switches = resolveRenderSwitches(options);
  const { pageSetup, typography, headingNumbering, captionNumbering } = switches;
  validatePageSetup(pageSetup); // 错误契约与 pdf/docx 一致(非法页面设置直接抛)
  const widthPt = contentWidthPt(pageSetup);

  const warnings: ConvertWarning[] = options.warnings ?? [];
  const warnedKeys = new Set<string>();
  const md = createBaseMarkdownIt({ katex: true });
  registerClipboardRules(md, { headingNumbering, captionNumbering });

  const env: ClipboardEnv = {
    warnings,
    warnedKeys,
    lines: mdSource.split(/\r\n|\n|\r/),
    typography,
    widthPt,
    images: new Map<string, string>(),
    tableWidths: [],
    tableColumn: 0,
    listDepth: 0,
    linkStack: [],
    headingNumbering,
    captionNumbering,
  };

  options.onStage?.("parse");
  guard.throwIfCanceled();
  const tokens = md.parse(mdSource, env);

  guard.throwIfCanceled();
  options.onStage?.("inline");
  const sources = collectImageSources(tokens);
  env.images = await resolveImages(sources, options, warnings, warnedKeys, guard);
  guard.throwIfCanceled();

  const body = md.renderer.render(tokens, md.options, env);
  const html = `<div style="${fragmentStyle(typography)}">${replaceTaskCheckboxes(body)}</div>`;
  return { html, text: htmlToPlainText(html) };
}

/**
 * 注册剪贴板专用的 core 规则与渲染规则。
 *
 * core 规则只做一件事:按文档顺序给标题/题注**写死字面编号**(标题编号进标题文本,
 * 题注编号进题注文本),并在同一次遍历里维护 h1 章节号与 fig/tab 序数 —— 三处
 * 编号(pdf 交叉引用、pdf CSS、剪贴板)共用 heading-numbering / caption-numbering
 * 两个纯函数模块。渲染规则把每个元素改写成带内联 style 的形态。
 */
function registerClipboardRules(
  md: MarkdownIt,
  config: { headingNumbering: boolean; captionNumbering: boolean },
): void {
  registerNumberingRule(md, config);
  registerRendererRules(md);
}

/** core 规则:标题编号 + 题注识别/编号/前缀与 label 剥离 */
function registerNumberingRule(
  md: MarkdownIt,
  config: { headingNumbering: boolean; captionNumbering: boolean },
): void {
  md.core.ruler.push("clipboard_numbering", (state) => {
    const tokens = state.tokens;
    // 与 pdf xref 同口径:文档任意位置存在 h1 才输出「图 <h1>.<seq>」章节号
    const hasH1 = tokens.some((token) => token.type === "heading_open" && token.tag === "h1");
    const headingCounters = createHeadingCounters();
    const captionCounters = createCaptionCounters();
    const depth = createDepthTracker();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      depth.feed(token.type);

      if (token.type === "heading_open" && depth.isTopLevel()) {
        const inline = tokens[i + 1];
        if (!inline || inline.type !== "inline" || !inline.children) continue;
        // 尾部 {#sec:label} 是元数据:剥离(不生成页内锚点,粘贴后锚点必失效)
        const secLabel = stripTrailingLabel(inline.children, "sec");
        if (secLabel !== undefined) inline.content = stripSecLabelSuffix(inline.content);

        const isNumbered =
          config.headingNumbering &&
          (token.tag === "h1" || token.tag === "h2" || token.tag === "h3");
        if (!isNumbered) continue;
        bumpHeadingCounter(headingCounters, Number(token.tag[1]));
        // 图/表序在 h1 处重置仅当 hasH1(与 pdf xref/template CSS 两分支一致)
        if (token.tag === "h1" && hasH1) resetCaptionCounters(captionCounters);
        const chapterText = chapterNumberFromCounters(headingCounters, Number(token.tag[1]));
        if (chapterText === null) continue;
        const prefix = new state.Token("text", "", 0);
        prefix.content = `${chapterText} `;
        inline.children.unshift(prefix);
        continue;
      }

      if (token.type !== "paragraph_close" || !depth.isTopLevel()) continue;
      // captionNumbering 关闭时整段按普通段落渲染(前缀原样保留,与 docx 侧一致)
      if (!config.captionNumbering) continue;
      const inline = tokens[i - 1];
      if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) {
        continue;
      }
      const first = inline.children[0]!; // 上方刚排除空 children
      if (first.type !== "text") continue;
      const match = CAPTION_PREFIX_RE.exec(first.content);
      if (!match) continue;

      const kind = captionKindAfterTarget(tokens, i, match[1] === "图" ? "fig" : "tab");
      if (!kind) continue;
      first.content = first.content.slice(match[0].length);
      stripTrailingLabel(inline.children, kind);
      const seq = bumpCaptionCounter(captionCounters, kind);
      const numberText = captionNumberText(kind, seq, {
        headingNumbering: config.headingNumbering,
        hasH1,
        chapterNumber: headingCounters.h1,
      });
      const prefix = new state.Token("text", "", 0);
      prefix.content = `${numberText} `;
      inline.children.unshift(prefix);
      // 标记题注段落(渲染规则据此套题注样式);attr 只用于本渲染器,不输出
      tokens[i - 2]!.attrSet("data-clipboard-caption", kind);
    }
  });
}

/**
 * 题注目标判定(与 pdf caption_recognize / docx buildCaptionContext 同口径):
 * 仅顶层「表格之后」或「含图片段落之后」的「图:/表:」前缀段才算题注。
 */
function captionKindAfterTarget(
  tokens: readonly BlockTokenLike[],
  paragraphCloseIndex: number,
  kind: CaptionKind,
): CaptionKind | null {
  const prev = tokens[paragraphCloseIndex - 3];
  if (!prev) return null;
  if (prev.type === "table_close") return kind;
  if (prev.type !== "paragraph_close") return null;
  const prevInline = tokens[paragraphCloseIndex - 4];
  if (prevInline?.type !== "inline" || !prevInline.children) return null;
  return prevInline.children.some((child) => child.type === "image") ? kind : null;
}

/** 本地容器深度跟踪(与 pdf/rules/shared.createDepthTracker 同语义,避免跨管线 import) */
function createDepthTracker(): { feed(type: string): void; isTopLevel(): boolean } {
  const depth = { blockquote: 0, listItem: 0, tableCell: 0 };
  return {
    feed(type) {
      if (type === "blockquote_open") depth.blockquote++;
      else if (type === "blockquote_close") depth.blockquote--;
      else if (type === "list_item_open") depth.listItem++;
      else if (type === "list_item_close") depth.listItem--;
      else if (type === "table_cell_open") depth.tableCell++;
      else if (type === "table_cell_close") depth.tableCell--;
    },
    isTopLevel() {
      return depth.blockquote === 0 && depth.listItem === 0 && depth.tableCell === 0;
    },
  };
}

/** 行内 children 尾部 `{#kind:label}` 剥离(题注 label 是元数据,不显示) */
function stripTrailingLabel(
  children: Array<{ type: string; content: string }>,
  kind: CaptionKind | "sec",
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

/** 111 渲染规则:所有视觉属性写进元素 style,不依赖 class/`<style>` */
function registerRendererRules(md: MarkdownIt): void {
  // ---- 段落 ----
  md.renderer.rules.paragraph_open = (tokens, idx, _options, env) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    if (token.hidden) return ""; // tight list 的隐式段落
    const state = env as ClipboardEnv;
    if (token.attrGet("data-clipboard-caption")) {
      return `<p style="${captionStyle(state.typography)}">`;
    }
    return `<p style="${paragraphStyle(state.typography, state.listDepth > 0)}">`;
  };
  md.renderer.rules.paragraph_close = (tokens, idx) =>
    tokens[idx]!.hidden ? "" : "</p>";

  // ---- 标题(编号文本已由 core 规则写进 inline children) ----
  md.renderer.rules.heading_open = (tokens, idx, _options, env) => {
    const token = tokens[idx]!;
    const depth = Number(token.tag[1]);
    return `<${token.tag} style="${headingStyle((env as ClipboardEnv).typography, depth)}">`;
  };
  md.renderer.rules.heading_close = (tokens, idx) => `</${tokens[idx]!.tag}>`;

  // ---- 列表 ----
  md.renderer.rules.bullet_list_open = (_tokens, _idx, _options, env) =>
    `<ul style="${listStyle((env as ClipboardEnv).typography)}">`;
  md.renderer.rules.bullet_list_close = () => "</ul>";
  md.renderer.rules.ordered_list_open = (tokens, idx, _options, env) => {
    const start = tokens[idx]!.attrGet("start");
    return `<ol${start ? ` start="${escapeHtml(start)}"` : ""} style="${listStyle((env as ClipboardEnv).typography)}">`;
  };
  md.renderer.rules.ordered_list_close = () => "</ol>";
  md.renderer.rules.list_item_open = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    state.listDepth += 1;
    return `<li style="${listItemStyle(state.typography)}">`;
  };
  md.renderer.rules.list_item_close = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    state.listDepth = Math.max(0, state.listDepth - 1);
    return "</li>";
  };

  // ---- 引用块:单格表格承载(边框只挂 td) ----
  md.renderer.rules.blockquote_open = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    return blockquoteOpen(state.widthPt, state.typography);
  };
  md.renderer.rules.blockquote_close = () => blockquoteClose();

  // ---- 代码 ----
  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    // Mermaid 围栏也走这里:MVP 按普通代码块输出(不调 resolver)
    return codeBlockTable(tokens[idx]!.content, state.widthPt, state.typography);
  };
  md.renderer.rules.code_block = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    return codeBlockTable(tokens[idx]!.content, state.widthPt, state.typography);
  };
  md.renderer.rules.code_inline = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    return `<code style="${inlineCodeStyle(state.typography)}">${escapeHtml(tokens[idx]!.content)}</code>`;
  };

  // ---- 公式:已登记的 MVP 降级 —— 输出 TeX 源码,不输出 KaTeX class 树 ----
  md.renderer.rules.math_inline = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    return `<code style="${inlineCodeStyle(state.typography)}">$${escapeHtml(tokens[idx]!.content)}$</code>`;
  };
  md.renderer.rules.math_block = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    return codeBlockTable(tokens[idx]!.content, state.widthPt, state.typography);
  };

  // ---- GFM 表格 ----
  md.renderer.rules.table_open = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    const token = tokens[idx]!;
    // 首行 th 数 = 列数(直到第一个 tr_close)
    let columns = 0;
    for (let i = idx + 1; i < tokens.length; i++) {
      const next = tokens[i]!;
      if (next.type === "th_open") columns++;
      else if (next.type === "tr_close") break;
    }
    const sourceWidths = token.map
      ? tableColumnWidthsFromSource(state.lines, token.map[0])
      : null;
    state.tableWidths = resolveColumnWidths(columns, sourceWidths, state.widthPt);
    state.tableColumn = 0;
    return tableOpen(state.widthPt);
  };
  md.renderer.rules.table_close = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    state.tableWidths = [];
    state.tableColumn = 0;
    return tableClose();
  };
  md.renderer.rules.thead_open = () => "<thead>";
  md.renderer.rules.thead_close = () => "</thead>";
  md.renderer.rules.tbody_open = () => "<tbody>";
  md.renderer.rules.tbody_close = () => "</tbody>";
  md.renderer.rules.tr_open = (_tokens, _idx, _options, env) => {
    (env as ClipboardEnv).tableColumn = 0;
    return "<tr>";
  };
  md.renderer.rules.tr_close = () => "</tr>";
  md.renderer.rules.th_open = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    const token = tokens[idx]!;
    const width = state.tableWidths[state.tableColumn] ?? 0;
    state.tableColumn += 1;
    return `<th style="${headerCellStyle(
      width,
      state.typography,
      textAlignFromTokenStyle(token.attrGet("style")),
    )}">`;
  };
  md.renderer.rules.th_close = () => "</th>";
  md.renderer.rules.td_open = (tokens, idx, _options, env) => {
    const token = tokens[idx]!;
    return `<td style="${bodyCellStyle(
      (env as ClipboardEnv).typography,
      textAlignFromTokenStyle(token.attrGet("style")),
    )}">`;
  };
  md.renderer.rules.td_close = () => "</td>";

  // ---- 行内强调 ----
  md.renderer.rules.strong_open = () => '<strong style="font-weight:bold;">';
  md.renderer.rules.strong_close = () => "</strong>";
  md.renderer.rules.em_open = () => '<em style="font-style:italic;">';
  md.renderer.rules.em_close = () => "</em>";
  md.renderer.rules.s_open = () => '<s style="text-decoration:line-through;">';
  md.renderer.rules.s_close = () => "</s>";

  // ---- 链接:内部锚点/非 http(s) 协议降级为纯文本(粘贴后锚点必失效) ----
  md.renderer.rules.link_open = (tokens, idx, _options, env) => {
    const href = tokens[idx]!.attrGet("href") ?? "";
    const state = env as ClipboardEnv;
    const degraded = href.startsWith("#") || !/^(?:https?:|mailto:)/i.test(href);
    state.linkStack.push(degraded);
    if (degraded) return "";
    return `<a href="${escapeHtml(href)}" style="${linkStyle()}">`;
  };
  md.renderer.rules.link_close = (_tokens, _idx, _options, env) => {
    const degraded = (env as ClipboardEnv).linkStack.pop() ?? false;
    return degraded ? "" : "</a>";
  };

  // ---- 图片:data URI 或灰色占位 ----
  md.renderer.rules.image = (tokens, idx, _options, env) => {
    const token = tokens[idx]!;
    const state = env as ClipboardEnv;
    const src = token.attrGet("src") ?? "";
    const alt = token.content;
    const dataUrl = state.images.get(src);
    if (!dataUrl) {
      return `<span style="color:#999;">${escapeHtml(missingImageText(alt))}</span>`;
    }
    return `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(alt)}" style="${imageStyle(state.widthPt)}">`;
  };

  // ---- 分隔线/换行 ----
  md.renderer.rules.hr = () =>
    '<hr style="border:none;border-top:1pt solid #d0d7de;margin:12pt 0;">';
  md.renderer.rules.hardbreak = () => "<br>";
  md.renderer.rules.softbreak = () => "\n";

  // ---- 裸 HTML:除 page-break 外一律转义(保证无 `<style>`/class 依赖/外链) ----
  const renderRawHtml = (content: string): string => {
    if (content.trim() === "<!-- page-break -->") return pageBreakHtml();
    return escapeHtml(content);
  };
  md.renderer.rules.html_block = (tokens, idx) => renderRawHtml(tokens[idx]!.content);
  md.renderer.rules.html_inline = (tokens, idx) => renderRawHtml(tokens[idx]!.content);

  // ---- 脚注:保留文本,不生成内部跳转锚点;样式仍走内联 ----
  md.renderer.rules.footnote_ref = (tokens, idx, _options, env) => {
    const state = env as ClipboardEnv;
    const meta = (tokens[idx] as { meta?: { id?: number; subId?: number } }).meta;
    const id = (meta?.id ?? 0) + 1;
    const sub = meta?.subId && meta.subId > 0 ? `:${meta.subId}` : "";
    return `<sup style="${footnoteRefStyle(state.typography)}">[${id}${sub}]</sup>`;
  };
  md.renderer.rules.footnote_block_open = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    return (
      '<hr style="border:none;border-top:1pt solid #d0d7de;margin:12pt 0;">' +
      `<ol style="${footnoteListStyle(state.typography)}">`
    );
  };
  md.renderer.rules.footnote_block_close = () => "</ol>";
  md.renderer.rules.footnote_open = (_tokens, _idx, _options, env) => {
    const state = env as ClipboardEnv;
    return `<li style="margin:2pt 0;font-family:inherit;font-size:${formatPt(
      state.typography.bodySizePt,
    )}pt;">`;
  };
  md.renderer.rules.footnote_close = () => "</li>";
  md.renderer.rules.footnote_anchor = () => "";
}

/** 收集全文 image token 的原始 src(文档顺序、去重) */
function collectImageSources(tokens: readonly BlockTokenLike[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    for (const child of token.children) {
      if (child.type !== "image") continue;
      const src = child.attrGet?.("src") ?? "";
      if (src === "" || seen.has(src)) continue;
      seen.add(src);
      sources.push(src);
    }
  }
  return sources;
}

/**
 * 图片解析:边界校验 → resolver 取字节 → data URI。
 *
 * 与 pdf 侧 checkLocalImages/embedExternalImages 同口径的失败分类:
 * resolver 返回 null → imageLoadFailed;抛错 → 按 fs 错误码细分;未知魔数 →
 * unrecognizedImage。所有警告经 pushWarningOnce 去重,并按文档顺序入列。
 */
async function resolveImages(
  sources: readonly string[],
  options: RenderClipboardOptions,
  warnings: ConvertWarning[],
  warnedKeys: Set<string>,
  guard: ReturnType<typeof createCancellationGuard>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (sources.length === 0) return result;

  const budget = resolveImageBudget(options.imageBudget);
  const ledger = new ImageBudgetLedger(budget);
  const guarded = options.imageResolver
    ? createGuardedImageResolver({
        resolver: options.imageResolver,
        guard,
        budget,
        ledger,
        // 记账口径与 pdf 外链内嵌一致:真正进入片段的 base64 长度(含 4/3 膨胀)
        costOf: (data) => Math.ceil(data.length / 3) * 4,
      })
    : undefined;
  // 本地路径策略只在 core 内做字符串 + 注入的 realpath 判定,不碰 fs
  const localPolicy = createLocalImagePathPolicy({
    baseDir: options.baseDir,
    realpathSync: options.realpathSync,
  });

  const outcomes = await mapWithConcurrency(
    sources.length,
    budget.concurrency,
    (index) => loadImage(sources[index]!, guarded, localPolicy, options.imageResolver),
  );

  for (const [index, src] of sources.entries()) {
    const outcome = outcomes[index]!; // mapWithConcurrency 保序返回等长数组
    if (outcome.dataUrl) {
      result.set(src, outcome.dataUrl);
      continue;
    }
    pushWarningOnce(warnedKeys, warnings, outcome.warning ?? imageLoadFailedWarning(src));
  }
  return result;
}

/** 单张图片解析结果:成功 dataUrl / 失败 warning(取消直接上抛) */
interface ImageOutcome {
  dataUrl?: string;
  warning?: ReturnType<typeof imageLoadFailedWarning>;
}

/** 单张图片:data: 直通;本地先边界校验;远端/本地都经注入 resolver */
async function loadImage(
  src: string,
  guarded: ReturnType<typeof createGuardedImageResolver>,
  localPolicy: ReturnType<typeof createLocalImagePathPolicy>,
  resolver: RenderClipboardOptions["imageResolver"],
): Promise<ImageOutcome> {
  // 已经是 data URI:无需再读,直接进入片段(仍满足「src 必须是 data:」)
  if (/^data:image\//i.test(src)) return { dataUrl: src };

  if (!resolver || !guarded) return { warning: imageLoadFailedWarning(src) };

  const isRemote = /^https?:\/\//i.test(src);
  if (!isRemote) {
    // 本地路径:先做 baseDir + realpath 边界校验,越界/非法绝对路径直接失败(不读)
    const resolution = localPolicy.resolveSync(src);
    if (!resolution.filePath) {
      return {
        warning: resolution.error
          ? imageLoadFailureWarning(src, resolution.error)
          : imageLoadFailedWarning(src),
      };
    }
  }

  try {
    const data = await guarded(src);
    if (!data || data.length === 0) return { warning: imageLoadFailedWarning(src) };
    const mime = mimeFromBuffer(data);
    if (!mime) return { warning: unrecognizedImageWarning(src) };
    return { dataUrl: `data:${mime};base64,${data.toString("base64")}` };
  } catch (error) {
    // 取消不得被降级通道吞掉(与 pdf/docx 图片路径同口径)
    if (isConversionCanceled(error)) throw error;
    return { warning: imageLoadFailureWarning(src, error) };
  }
}

/** 有界并发(worker 池):保序返回与入参等长的结果数组 */
async function mapWithConcurrency<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      results[index] = await task(index);
    }
  };
  const width = Math.max(1, Math.min(Math.floor(concurrency), count));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** 图片失败占位文本(alt 为空时不留悬空冒号) */
function missingImageText(alt: string): string {
  return alt === "" ? "[图片缺失]" : `[图片缺失: ${alt}]`;
}
