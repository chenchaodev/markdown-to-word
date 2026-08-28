/**
 * pdf 题注/章节交叉引用规则:xref_recognize core 规则 + paragraph_open 渲染包装单源。
 * 单回调三段逻辑拆为三个具名函数(编排仍按原顺序):
 *   1. scanXrefDefinitions —— 第一遍顶层扫描(计数 + 剥离 + 登记);
 *   2. replaceXrefLinks   —— 第二遍链接引用替换(命中改写 / 悬空解包 + 警告);
 *   3. wrapParagraphOpenAnchor —— 渲染器包装(题注段落开头注入锚点)。
 * 文案/占位见 CROSS_REF_KINDS,勿散落硬编码。
 */
import type MarkdownIt from "markdown-it";
import {
  CROSS_REF_KINDS,
  CROSS_REF_HREF_RE,
  stripSecLabelSuffix,
  type CrossRefKind,
} from "../../markdown/cross-ref.js";
import {
  bumpHeadingCounter,
  chapterNumberFromCounters,
  createHeadingCounters,
} from "../../markdown/heading-numbering.js";
import type { ConvertWarning } from "../../i18n.js";
import { crossRefNotFoundWarning } from "../../i18n.js";
import { attrDel, createDepthTracker, forEachRefLink, stripTrailingLabel, type LinkScanToken } from "./shared.js";

/** 块级 token 的结构化最小签名(避免深导入 markdown-it/lib/token):在
 *  LinkScanToken 基础上补 tag / attrSet / hidden(xref 第一遍扫描所需字段)。 */
interface BlockScanToken extends LinkScanToken {
  tag: string;
  attrSet(name: string, value: string): void;
  hidden: boolean;
}

/** 第一遍扫描登记结果:xref 引用替换阶段的查表(label → 静态编号文本)。 */
interface XrefLabelTables {
  /** 图/表题注 label → kind + 编号文本(caption_recognize 已设 class 的题注段) */
  captionLabels: Map<string, { kind: "fig" | "tab"; numberText: string }>;
  /** 章节 label → 章节号文本(headingNumbering 开启且深度 ≤3 时登记) */
  headingLabels: Map<string, string>;
}

/**
 * 题注/章节交叉引用(与 docx 侧契约一致;文案/占位见
 * CROSS_REF_KINDS,勿散落硬编码):
 * - 引用语法:[图](#fig:label) / [表](#tab:label) / [章节](#sec:label),label 为
 *   [\w-]+;命中时文本(恰为默认文本)→ 静态编号(「图 3.1」「表 1」「3.2」),
 *   保留跳转;其他文本保持原样仍跳转;悬空 → 默认文本占位「图 (?)」/「(?)」,
 *   不带链接(目标锚点不存在,不生成死链;同 docx 侧),警告经 env.warnings
 *   提示(按「前缀:label」去重,仿 eq_numbering);
 * - 编号对象与登记(免更新路线,静态注入):
 *   - 图/表题注(caption_recognize 已设 fig-caption/tab-caption class):尾部
 *     {#fig:label}/{#tab:label} 剥离并登记;编号文本镜像模板 CSS ::before 显示
 *     (headingNumbering && hasH1 → 「图 <h1c>.<figc>」,否则纯序数「图 <figc>」,
 *     序数按 class 计数、h1 处重置仅当 hasH1,与 template.ts 两分支一一对应);
 *     锚点 <span id="fig:label"> 注入题注段落开头(经 paragraph_open 渲染包装);
 *   - 标题(顶层,与 docx 只遍历 ast.children 一致):尾部 {#sec:label} 无条件
 *     剥离(语法;不进标题文本/目录/slug),headingNumbering 开启且深度 ≤3 时
 *     登记章节号(计数与章节号文本走 heading-numbering.ts 共享纯函数,与 docx
 *     预扫同源;统一 Word 口径——无 h1 文档跳过前导零级,h2 引用
 *     显示「1」,CSS counter 分支同步,见 template.ts);锚点
 *     <span id="sec:label"> 注入标题开头(经 heading_open 渲染包装);
 * - 计数器语义镜像模板 CSS:headingNumbering 开时 h1 增 → h2/h3 清零,
 *   hasH1 时 fig/tab 清零(与 template.ts hasH1 分支一致);h2 增 → h3 清零;
 *   headingNumbering 关时不计数 → sec 引用按悬空处理(同 docx)。
 */
export function overrideXrefRule(
  md: MarkdownIt,
  opts: { headingNumbering: boolean; captionNumbering: boolean },
): void {
  md.core.ruler.push("xref_recognize", (state) => {
    const tokens = state.tokens;
    // hasH1 = 文档任意位置存在 h1(与模板 /<h1[\s>]/i 检查等价,决定 CSS 分支)
    const hasH1 = tokens.some((t) => t.type === "heading_open" && t.tag === "h1");
    // 第一遍:顶层遍历(容器深度跟踪同 caption_recognize/eq_numbering),计数 + 剥离 + 登记
    const { captionLabels, headingLabels } = scanXrefDefinitions(tokens, opts, hasH1);
    // 第二遍:链接引用替换(遍历所有 inline 的 children,含容器/脚注内)
    replaceXrefLinks(tokens, state, captionLabels, headingLabels);
  });
  wrapParagraphOpenAnchor(md);
}

/**
 * 第一段:顶层扫描(标题 sec label + 题注 fig/tab label),计数 + 剥离 + 登记。
 * 返回两张查表供第二段链接替换使用;counters 为局部状态(镜像模板 CSS 计数器)。
 */
function scanXrefDefinitions(
  tokens: BlockScanToken[],
  opts: { headingNumbering: boolean; captionNumbering: boolean },
  hasH1: boolean,
): XrefLabelTables {
  const headingCounters = createHeadingCounters();
  const captionCounters = { fig: 0, tab: 0 };
  const captionLabels = new Map<string, { kind: "fig" | "tab"; numberText: string }>();
  const headingLabels = new Map<string, string>(); // label → 章节号文本
  const depth = createDepthTracker();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!; // 循环边界刚检查
    depth.feed(token.type);
    if (
      token.type === "heading_open" &&
      depth.isTopLevel()
    ) {
      const isNumbered = opts.headingNumbering && (token.tag === "h1" || token.tag === "h2" || token.tag === "h3");
      if (isNumbered) {
        bumpHeadingCounter(headingCounters, Number(token.tag[1]));
        // 图/表序在 h1 处重置仅当 hasH1(镜像 template.ts 两分支)
        if (token.tag === "h1" && hasH1) {
          captionCounters.fig = 0;
          captionCounters.tab = 0;
        }
      }
      const inline = tokens[i + 1];
      if (!inline || inline.type !== "inline" || !inline.children) continue;
      const label = stripTrailingLabel(inline.children, "sec");
      if (label === undefined) continue;
      // label 同步剥离 inline.content(标题 id slug 的来源,避免 label 进 slug)
      inline.content = stripSecLabelSuffix(inline.content);
      if (isNumbered) {
        // 章节号文本走共享纯函数(与 docx 预扫同源;统一 Word 口径:
        // 无 h1 跳过前导零级,h2 引用显示「1」,CSS counter 分支同步见 template.ts)
        const chapterText = chapterNumberFromCounters(headingCounters, Number(token.tag[1]));
        if (chapterText !== null) {
          headingLabels.set(label, chapterText);
          token.attrSet("data-xref-anchor", `sec:${label}`);
        }
      }
    } else if (
      token.type === "paragraph_close" &&
      depth.isTopLevel()
    ) {
      const inline = tokens[i - 1];
      if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
      const pOpen = tokens[i - 2];
      const cls = pOpen?.attrGet("class");
      if (cls !== "fig-caption" && cls !== "tab-caption") continue;
      // captionNumbering 关:label 原样保留不剥离不登记(docx 契约;
      // 前缀剥除为 caption_recognize 的既有行为,不在此改)
      if (!opts.captionNumbering) continue;
      const kind = cls === "fig-caption" ? "fig" : "tab";
      if (kind === "fig") captionCounters.fig++;
      else captionCounters.tab++;
      const label = stripTrailingLabel(inline.children, kind);
      if (label === undefined) continue;
      // 编号文本镜像 CSS ::before 显示(两分支:章节号+序数 / 纯序数)
      const seq = kind === "fig" ? captionCounters.fig : captionCounters.tab;
      const numberText =
        opts.headingNumbering && hasH1
          ? `${kind === "fig" ? "图" : "表"} ${headingCounters.h1}.${seq}`
          : `${kind === "fig" ? "图" : "表"} ${seq}`;
      captionLabels.set(label, { kind, numberText });
      pOpen!.attrSet("data-xref-anchor", `${kind}:${label}`); // 契约:i-2 必为 paragraph_open(cls 命中亦证明其存在)
    }
  }
  return { captionLabels, headingLabels };
}

/** core 规则的 state 形态(结构化最小签名,避免深导入 markdown-it/lib/state_core;
 *  真实 StateCore 的 env 为 any,结构兼容)。 */
interface CoreRuleState {
  env: { warnings?: ConvertWarning[] };
}

/**
 * 第二段:链接引用替换。命中登记表 → 默认文本改写为静态编号并保留 href 跳转
 * (目标锚点由第一遍注入);悬空 → 默认文本占位「(?)」并解包链接结构(不带链接,
 * 不生成死链)+ 警告(按「前缀:label」去重)。
 */
function replaceXrefLinks(
  tokens: readonly LinkScanToken[],
  state: CoreRuleState,
  captionLabels: XrefLabelTables["captionLabels"],
  headingLabels: XrefLabelTables["headingLabels"],
): void {
  const unknownLabels = new Set<string>();
  forEachRefLink(tokens, CROSS_REF_HREF_RE, ({ labels, textToken }) => {
    const kind = labels[0] as CrossRefKind;
    const label = labels[1]!; // 捕获组结构保证
    const def = CROSS_REF_KINDS[kind];
    let numberText: string | undefined;
    if (kind === "sec") {
      numberText = headingLabels.get(label);
    } else {
      const info = captionLabels.get(label);
      // 登记时已限定 kind 与前缀一致(见上),此处防御性校验
      if (info && info.kind === kind) numberText = info.numberText;
    }
    if (numberText !== undefined) {
      if (textToken && textToken.content === def.defaultText) textToken.content = numberText;
      return false; // 命中:保留 href 跳转(目标锚点由第一遍注入)
    }
    if (!unknownLabels.has(`${kind}:${label}`)) {
      unknownLabels.add(`${kind}:${label}`); // 同引用只提示一次
      state.env.warnings?.push(crossRefNotFoundWarning(def.kindName, `${kind}:${label}`));
    }
    if (textToken && textToken.content === def.defaultText) textToken.content = def.danglingText;
    // 悬空不带链接(docx 契约:目标锚点不存在,不生成死链)——解包链接
    // 结构(仅移除 link_open/link_close,保留内部文本与嵌套格式,按普通
    // 文本渲染;模板 a 色样式不作用于无链接文本)
    return true;
  });
}

/**
 * 第三段:包装 paragraph_open 渲染规则——带 data-xref-anchor 的题注段落开头
 * 注入 <span id="..."> 锚点(引用跳转目标;属性注入后即删,不进输出 HTML)。
 */
function wrapParagraphOpenAnchor(md: MarkdownIt): void {
  const defaultParaRule = md.renderer.rules.paragraph_open;
  md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const anchor = token.attrGet("data-xref-anchor");
    if (anchor) attrDel(token, "data-xref-anchor");
    const html = defaultParaRule
      ? defaultParaRule(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (!anchor) return html;
    return html.replace(">", `><span id="${anchor}"></span>`);
  };
}
