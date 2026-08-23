/**
 * G4:markdown → PDF 渲染管线(markdown-it → HTML 模板 → 主进程 printToPDF)。
 * 调研结论见 docs/研究结论.md(G4 调研条目):
 * - markdown-it 核心内置表格/删除线;任务列表用 @mdit/plugin-tasklist
 * - highlight.js 走 lib/common ESM 子集;printToPDF 需 printBackground: true 才有代码底色
 * - 图片统一转 file:// URL(markdown-it 原样输出绝对路径会解析失败)
 * - 任务列表 checkbox 有 Chromium 打印 bug,渲染后用 ☐/☑ 字符替代(打印稳定)
 */
import MarkdownIt from "markdown-it";
import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import { katex } from "@mdit/plugin-katex";
import hljs from "highlight.js/lib/common";
import path from "node:path";
import { pathToFileURL } from "node:url";
// 页面设置契约单源(settings-defaults;原经 convert.js 导入形成 convert⇄render 环,B7 解环)
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../settings-defaults.js";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import { DEFAULT_TYPOGRAPHY } from "../typography.js";
import { uniqueSlug } from "../slug.js";
import { ALLOWED_INLINE_TAGS, isAllowedInlineHtml } from "../html-whitelist.js";
import { decodeEntities, escapeHtml } from "../utils.js";
import type { ConvertWarning } from "../i18n.js";
import { crossRefNotFoundWarning, highlightFallbackWarning } from "../i18n.js";
import type { MermaidResolver } from "../mermaid.js";
import { buildCoverHtml, buildTemplate, buildTemplateCss, loadKatexCss } from "./template.js";
import { buildTocHtml, checkLocalImages, embedExternalImages } from "./postprocess.js";
// 契约单源(B7):ImageResolver 类型与交叉引用常量/正则族收敛 core 共享模块
import type { ImageResolver } from "../image-resolver.js";
export type { ImageResolver };
import { CROSS_REF_KINDS, kindLabelRegex, stripSecLabelSuffix, type CrossRefKind } from "../cross-ref.js";
export { CROSS_REF_KINDS };

export interface RenderPdfHtmlOptions {
  /** markdown 文件所在目录,相对路径图片以此为基准 */
  baseDir: string;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页,标题优先级高于 options.title) */
  metadata?: DocMetadata;
  /** 警告收集(图片加载失败统一文案 imageLoadFailedWarning;缺失本地图/外链下载失败同构;
   *  B6 起元素为 ConvertWarning,keyed 警告经显示层 formatWarning 按语言格式化) */
  warnings?: ConvertWarning[];
  /** 外链图片下载注入(主进程提供;失败返回 null) */
  imageResolver?: ImageResolver;
  /** 页面 <title>,缺省取文件名(不含扩展名) */
  title?: string;
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY):模板 CSS body 字体/字号/行距 + 缩进/对齐 */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节编号(1 / 1.1 / 1.1.1,与 docx 侧 decimal 编号语义一致;
   *  显式传值优先,否则取 typography.headingNumbering;默认开) */
  headingNumbering?: boolean;
  /** 图/表题注自动编号(默认开,取 typography.captionNumbering;显式传值优先) */
  captionNumbering?: boolean;
  /** 自动生成目录页(默认开;开时正文含标题则插入静态目录) */
  toc?: boolean;
  /** 公式编号开关(默认开;关时 eq_numbering 规则仍注册但只隐藏 label 段——
   *  公式不编号、label 不登记、引用保持原文本) */
  equationNumbering?: boolean;
  /** 用户自定义样式 CSS(批次 16:模板导入·CSS 覆盖 pdf 路线;追加到默认模板
   *  CSS 之后,同一 <style> 内后声明覆盖默认样式;缺省/空串不注入) */
  pdfCss?: string;
  /** KaTeX 资源目录(绝对路径,含 katex.min.css 与 fonts/ 子目录,即
   *  node_modules/katex/dist;传入则 katex.min.css 内联进模板并改写字体
   *  为 file:// 绝对路径,公式字体样式生效;不传则公式渲染为 KaTeX HTML
   *  但无字体样式,公式仍显示(缺字形美观度)) */
  katexDir?: string;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏保持
   *  原代码块渲染,行为不变) */
  mermaidResolver?: MermaidResolver;
}

/**
 * 任务列表 checkbox → 字符(markdown-it 渲染后替换,规避 Chromium 打印 checkbox bug)。
 * 插件(@mdit/plugin-tasklist,label 默认开)实际输出形态(实证):
 *   <input type="checkbox" class="task-list-item-checkbox" id="task-item-N"
 *          checked="checked" disabled="disabled"><label class="task-list-item-label"
 *          for="task-item-N"> 文本</label>
 * - 属性顺序 type 在前、含 id、布尔属性序列化为 ="…" → 不能用「class 在前 + 裸布尔
 *   属性」正则,改为以 class 定位 input、\schecked 判断选中态;
 * - input 移除后 label 的 for 悬空(指向已删除的 id),属多余结构一并解包(保留文本);
 *   label 文本自带前导空格,故字符后不加空格,输出形如「☑ 已完成」。
 */
function replaceTaskCheckboxes(html: string): string {
  return html
    .replace(/<input[^>]*class="task-list-item-checkbox"[^>]*>/g, (tag) =>
      /\schecked/.test(tag) ? "☑" : "☐",
    )
    .replace(/<label[^>]*class="task-list-item-label"[^>]*>([\s\S]*?)<\/label>/g, "$1");
}

function buildMarkdownIt(
  hasMermaidResolver: boolean,
  headingNumbering: boolean,
  captionNumbering: boolean,
  equationNumbering: boolean,
  warnings: ConvertWarning[],
): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(str: string, lang?: string): string {
      // Mermaid 围栏(且有 resolver 注入时):不经过 hljs,输出占位 div——
      // 内容是 escapeHtml 后的代码文本(占位内不可能出现原生 </div>,替换正则
      // 非贪婪匹配安全);renderPdfHtml 渲染完后经 mermaidResolver 逐个替换为
      // 内联 SVG(mermaid-svg)/失败降级代码块(mermaid-fallback)。
      // 无 resolver 时不产占位,走原代码块渲染(行为不变)。
      if (lang === "mermaid" && hasMermaidResolver) {
        return `<div class="mermaid">${md.utils.escapeHtml(str)}</div>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            `<pre class="hljs"><code class="language-${lang}">` +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            "</code></pre>"
          );
        } catch {
          // B4:语言包异常时回退转义输出 + 上报降级警告(与 docx 侧同 key 同文案口径)
          warnings.push(highlightFallbackWarning(lang));
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });
  md.use(tasklist);
  md.use(footnote);
  // 批次 6:公式插件($..$ / $$..$$ / \(..\) / \[..\] / ```math 围栏;throwOnError=false,
  // 渲染失败输出 katex-error 标记,不抛)
  md.use(katex);
  overrideHtmlRules(md);
  overrideCaptionRule(md);
  // 公式编号开关关闭时 eq_numbering 规则仍注册(numbering=false):label 段照常
  // 隐藏(语法标记不显示),但公式不编号(无 eq-block/eq-num 包裹)、label 不登记、
  // [式](#eq:label) 引用保持原文本(与 docx 侧 numbering=false 语义一致)
  overrideEquationRule(md, equationNumbering);
  overrideXrefRule(md, { headingNumbering, captionNumbering });
  return md;
}

/**
 * 题注前缀行识别(8b,与 docx 侧 buildCaptionContext 顶层预扫契约一致):
 * 块 token 流中,顶层「含图片段落」或「表格」之后紧跟的、以「图:」/「表:」
 * (半角/全角冒号)开头的段落 → 标记为 fig-caption/tab-caption 并剥除前缀。
 * 编号由 CSS counter 伪元素渲染(不进文本节点,目录/书签不受影响)。
 * 容器深度限制(blockquote/list_item/table 单元格内不识别,与 docx 侧
 * 只遍历 ast.children 顶层一致);文档开头(首 h1 之前)的图题注在无 h1
 * 文档中按纯序数渲染,有 h1 文档中渲染为「图 0.N」(与 docx 侧「图 N」
 * 的差异为 CSS counter 无法条件输出的罕见边界,验收清单已标注)。
 */
function overrideCaptionRule(md: MarkdownIt): void {
  md.core.ruler.push("caption_recognize", (state) => {
    const tokens = state.tokens;
    const depth = { blockquote: 0, list_item: 0, table_cell: 0 };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      if (token.type === "blockquote_open") depth.blockquote++;
      else if (token.type === "blockquote_close") depth.blockquote--;
      else if (token.type === "list_item_open") depth.list_item++;
      else if (token.type === "list_item_close") depth.list_item--;
      else if (token.type === "table_cell_open") depth.table_cell++;
      else if (token.type === "table_cell_close") depth.table_cell--;
      else if (token.type === "paragraph_close" && depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0) {
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
        const first = inline.children[0]!; // 上方刚排除 children 为空
        if (first.type !== "text") continue;
        const match = /^(图|表)[:：]\s*/.exec(first.content);
        if (!match) continue;
        const prev = tokens[i - 3];
        if (!prev) continue;
        if (prev.type === "table_close") {
          // 表格后紧跟的题注段
        } else if (prev.type === "paragraph_close") {
          const prevInline = tokens[i - 4];
          const hasImage = prevInline?.type === "inline" && prevInline.children?.some((t) => t.type === "image");
          if (!hasImage) continue;
        } else {
          continue;
        }
        // 剥前缀(前缀完整落在首 text token:契约「图:/表:」紧贴且其后为行内内容)
        first.content = first.content.slice(match[0].length);
        tokens[i - 2]!.attrSet("class", match[1] === "图" ? "fig-caption" : "tab-caption"); // 契约:paragraph_close 前必有 paragraph_open
      }
    }
  });
}

/**
 * 公式编号 + 交叉引用(8d,与 docx 侧契约一致;免更新路线,编号静态注入文本):
 * - 编号对象:顶层(blockquote/list_item/table 单元格外)display 公式(math_block,
 *   由 @mdit/plugin-katex 产生),按文档顺序全文连续编号 1,2,3…
 * - label 语法:公式块之后紧跟独立段落 {#eq:label}(整段纯文本串接恰为该标记,
 *   B3 起粗斜体包裹亦命中以对齐 docx 口径,label 为 [\w-]+),
 *   该段标记 hidden 不渲染,label 登记给前一个 math_block(生成页内锚点)
 * - 引用语法:链接 [式](#eq:label) / [公式](#eq:label) 文本替换为「式 (N)」/「公式 (N)」
 *   并保留跳转;其他文本的 #eq:label 链接保持原文本;未知 label → 「式 (?)」
 *   (warnings 通道存在时追加提示,经 render 的 env.warnings 注入,见 renderPdfHtml)
 * - 编号渲染:math_block 包 <div class="eq-block">(内可选 <span id="eq:label"> 锚点 +
 *   KaTeX 输出 + <span class="eq-num">(N)</span>),CSS 使公式居中、编号右缘垂直居中
 * - numbering=false(公式编号开关关闭):规则仍注册,但只做 label 段隐藏(三 token
 *   hidden + children 清空,语法标记不显示);不做 math_block 编号(data-eq-index
 *   不设置)、labelIndex 登记、第二遍引用替换(引用保持原文本)
 */
function overrideEquationRule(md: MarkdownIt, numbering: boolean = true): void {
  md.core.ruler.push("eq_numbering", (state) => {
    const tokens = state.tokens;
    // 第一遍:顶层遍历(容器深度跟踪同 caption_recognize),编号 + label 段识别
    const depth = { blockquote: 0, list_item: 0, table_cell: 0 };
    let eqIndex = 0;
    let lastMathToken: (typeof tokens)[number] | null = null;
    const labelIndex = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      if (token.type === "blockquote_open") depth.blockquote++;
      else if (token.type === "blockquote_close") depth.blockquote--;
      else if (token.type === "list_item_open") depth.list_item++;
      else if (token.type === "list_item_close") depth.list_item--;
      else if (token.type === "table_cell_open") depth.table_cell++;
      else if (token.type === "table_cell_close") depth.table_cell--;
      else if (
        token.type === "math_block" &&
        depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0
      ) {
        // 仅顶层公式编号(容器内公式与 docx 侧一致:不计数不编号,原样渲染)
        if (!numbering) continue; // 关开关:不编号(不设 data-eq-index)
        eqIndex++;
        token.attrSet("data-eq-index", String(eqIndex));
        lastMathToken = token;
      } else if (
        token.type === "paragraph_close" &&
        depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0
      ) {
        // label 段:paragraph_open + inline + paragraph_close。
        // B3 口径对齐 docx:整段「纯文本串接」恰为 {#eq:label} 即命中——此前要求
        // 唯一 text child,粗斜体包裹的 label(如 **{#eq:a}**)双格式登记结果不同
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children) continue;
        let plain = "";
        for (const child of inline.children) {
          if (child.type === "text") plain += child.content;
        }
        const match = /^\{#eq:([\w-]+)\}$/.exec(plain);
        if (!match) continue;
        if (numbering) {
          if (!lastMathToken) continue; // 无前置公式 → 保持原样(按普通段落渲染)
          const label = match[1]!; // 捕获组结构保证
          lastMathToken.attrSet("data-eq-label", label);
          labelIndex.set(label, eqIndex);
        }
        // 三 token 置 hidden 不渲染。注意:markdown-it 主渲染循环对 inline token
        // 直接 renderInline(children),不检查 inline 自身 hidden(仅 renderToken 检查,
        // text 等走独立规则的 children 亦然)→ 必须同时清空 children 才能彻底不输出
        tokens[i - 2]!.hidden = true; // 契约:paragraph_close 前必有 paragraph_open
        inline.hidden = true;
        inline.children = [];
        token.hidden = true;
      }
    }
    if (!numbering) return; // 关开关:不做引用替换(引用保持原文本)
    // 第二遍:链接引用替换(遍历所有 inline 的 children,含容器/脚注内)
    const unknownLabels = new Set<string>();
    for (const token of tokens) {
      if (token.type !== "inline" || !token.children) continue;
      const children = token.children;
      for (let i = 0; i < children.length; i++) {
        const linkOpen = children[i]!; // 循环边界刚检查
        if (linkOpen.type !== "link_open") continue;
        const href = linkOpen.attrGet("href");
        if (!href) continue;
        const match = /^#eq:([\w-]+)$/.exec(href);
        if (!match) continue;
        const label = match[1]!; // 捕获组结构保证
        const num = labelIndex.get(label);
        if (num === undefined && !unknownLabels.has(label)) {
          unknownLabels.add(label); // 同标签只提示一次,避免重复刷屏
          // 与 docx 侧同场景文案不同(历史差异,勿单侧改):docx 为
          // 「交叉引用未找到公式 label: <label>」(warn.crossRefNotFound)
          state.env.warnings?.push({
            key: "warn.eqLabelUndefined",
            params: { label },
            fallback: `引用未定义的公式标签: eq:${label}`,
          });
        }
        // 链接内第一个 text token(可能嵌套格式如 **式**,取首个文本节点替换)
        for (let j = i + 1; j < children.length; j++) {
          const child = children[j]!; // 循环边界刚检查
          if (child.type === "link_close") break;
          if (child.type === "text") {
            if (child.content === "式" || child.content === "公式") {
              child.content = `${child.content} (${num ?? "?"})`;
            }
            break;
          }
        }
      }
    }
  });
  // 包装 math_block 渲染规则(原规则由 @mdit/plugin-katex 提供,保存后包装)
  const defaultRule = md.renderer.rules.math_block;
  md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const html = defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : md.utils.escapeHtml(token.content);
    const eqIndex = token.attrGet("data-eq-index");
    if (!eqIndex) return html; // 未被编号的公式(如容器内),原样输出
    const label = token.attrGet("data-eq-label");
    const anchor = label ? `<span id="eq:${label}"></span>` : "";
    return `<div class="eq-block">${anchor}${html}<span class="eq-num">(${eqIndex})</span></div>`;
  };
}

// 交叉引用类型常量(CROSS_REF_KINDS)与章节 label 正则族:契约单源于
// core/cross-ref.ts(B7),docx/pdf 两侧共用,语义注释见该模块。

/**
 * 从 inline children 尾部剥离 {#<kind>:<label>}(批次 10 功能 2):从最后一个
 * 文本叶子节点匹配(从尾向前跳过 close/html 等非文本节点,兼容 **格式** {#label}
 * 与 强调整串内带 label 的嵌套;与 docx 侧 stripTrailingSecLabel 语义一致);
 * 命中则改写该 text 节点内容并返回 label,无匹配返回 undefined 且不改动。
 */
function stripTrailingLabel(
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
function attrDel(
  token: { attrIndex(name: string): number; attrs: Array<[string, string]> | null },
  name: string,
): void {
  const idx = token.attrIndex(name);
  if (idx >= 0 && token.attrs) token.attrs.splice(idx, 1);
}

/**
 * 题注/章节交叉引用(批次 10 功能 2,与 docx 侧契约一致;文案/占位见
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
 *     登记章节号(深度 1..d 计数器拼接,镜像 CSS 显示、不做 docx 侧前导零跳过
 *     ——无 h1 文档「0.1」与 CSS 显示一致,差异在报告注明);锚点
 *     <span id="sec:label"> 注入标题开头(经 heading_open 渲染包装);
 * - 计数器语义镜像模板 CSS:headingNumbering 开时 h1 增 → h2/h3 清零,
 *   hasH1 时 fig/tab 清零(与 template.ts hasH1 分支一致);h2 增 → h3 清零;
 *   headingNumbering 关时不计数 → sec 引用按悬空处理(同 docx)。
 */
function overrideXrefRule(
  md: MarkdownIt,
  opts: { headingNumbering: boolean; captionNumbering: boolean },
): void {
  md.core.ruler.push("xref_recognize", (state) => {
    const tokens = state.tokens;
    // hasH1 = 文档任意位置存在 h1(与模板 /<h1[\s>]/i 检查等价,决定 CSS 分支)
    const hasH1 = tokens.some((t) => t.type === "heading_open" && t.tag === "h1");
    const counters = { h1: 0, h2: 0, h3: 0, fig: 0, tab: 0 };
    const captionLabels = new Map<string, { kind: "fig" | "tab"; numberText: string }>();
    const headingLabels = new Map<string, string>(); // label → 章节号文本
    // 第一遍:顶层遍历(容器深度跟踪同 caption_recognize/eq_numbering),计数 + 剥离 + 登记
    const depth = { blockquote: 0, list_item: 0, table_cell: 0 };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; // 循环边界刚检查
      if (token.type === "blockquote_open") depth.blockquote++;
      else if (token.type === "blockquote_close") depth.blockquote--;
      else if (token.type === "list_item_open") depth.list_item++;
      else if (token.type === "list_item_close") depth.list_item--;
      else if (token.type === "table_cell_open") depth.table_cell++;
      else if (token.type === "table_cell_close") depth.table_cell--;
      else if (
        token.type === "heading_open" &&
        depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0
      ) {
        const isNumbered = opts.headingNumbering && (token.tag === "h1" || token.tag === "h2" || token.tag === "h3");
        if (isNumbered) {
          if (token.tag === "h1") {
            counters.h1++;
            counters.h2 = 0;
            counters.h3 = 0;
            // 图/表序在 h1 处重置仅当 hasH1(镜像 template.ts 两分支)
            if (hasH1) {
              counters.fig = 0;
              counters.tab = 0;
            }
          } else if (token.tag === "h2") {
            counters.h2++;
            counters.h3 = 0;
          } else {
            counters.h3++;
          }
        }
        const inline = tokens[i + 1];
        if (!inline || inline.type !== "inline" || !inline.children) continue;
        const label = stripTrailingLabel(inline.children, "sec");
        if (label === undefined) continue;
        // label 同步剥离 inline.content(标题 id slug 的来源,避免 label 进 slug)
        inline.content = stripSecLabelSuffix(inline.content);
        if (isNumbered) {
          // 章节号镜像 CSS 显示:深度 1..d 计数器拼接(前导零不跳过;
          // 无 h1 文档为「0.1」,与 CSS counter 显示一致,与 docx「1」的差异在报告注明)
          const depthNum = Number(token.tag[1]);
          const parts: number[] = [];
          for (let d = 1; d <= depthNum; d++) {
            parts.push(counters[(`h${d}`) as "h1" | "h2" | "h3"]);
          }
          headingLabels.set(label, parts.join("."));
          token.attrSet("data-xref-anchor", `sec:${label}`);
        }
      } else if (
        token.type === "paragraph_close" &&
        depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0
      ) {
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
        const pOpen = tokens[i - 2];
        const cls = pOpen?.attrGet("class");
        if (cls !== "fig-caption" && cls !== "tab-caption") continue;
        // captionNumbering 关:label 原样保留不剥离不登记(docx 契约;
        // 前缀剥除为 caption_recognize 的 8b 既有行为,不在此改)
        if (!opts.captionNumbering) continue;
        const kind = cls === "fig-caption" ? "fig" : "tab";
        if (kind === "fig") counters.fig++;
        else counters.tab++;
        const label = stripTrailingLabel(inline.children, kind);
        if (label === undefined) continue;
        // 编号文本镜像 CSS ::before 显示(两分支:章节号+序数 / 纯序数)
        const seq = kind === "fig" ? counters.fig : counters.tab;
        const numberText =
          opts.headingNumbering && hasH1
            ? `${kind === "fig" ? "图" : "表"} ${counters.h1}.${seq}`
            : `${kind === "fig" ? "图" : "表"} ${seq}`;
        captionLabels.set(label, { kind, numberText });
        pOpen!.attrSet("data-xref-anchor", `${kind}:${label}`); // 契约:i-2 必为 paragraph_open(cls 命中亦证明其存在)
      }
    }
    // 第二遍:链接引用替换(遍历所有 inline 的 children,含容器/脚注内)
    const unknownLabels = new Set<string>();
    for (const token of tokens) {
      if (token.type !== "inline" || !token.children) continue;
      const children = token.children;
      for (let i = 0; i < children.length; i++) {
        const linkOpen = children[i]!; // 循环边界刚检查
        if (linkOpen.type !== "link_open") continue;
        const href = linkOpen.attrGet("href");
        if (!href) continue;
        const match = /^#(fig|tab|sec):([\w-]+)$/.exec(href);
        if (!match) continue;
        const kind = match[1] as CrossRefKind;
        const label = match[2]!; // 捕获组结构保证
        const def = CROSS_REF_KINDS[kind];
        let numberText: string | undefined;
        if (kind === "sec") {
          numberText = headingLabels.get(label);
        } else {
          const info = captionLabels.get(label);
          // 登记时已限定 kind 与前缀一致(见上),此处防御性校验
          if (info && info.kind === kind) numberText = info.numberText;
        }
        // 链接内第一个 text token(可能嵌套格式如 **图**,取首个文本节点替换;
        // 与 eq_numbering 同构)
        let textToken: (typeof children)[number] | undefined;
        for (let j = i + 1; j < children.length; j++) {
          const child = children[j]!; // 循环边界刚检查
          if (child.type === "link_close") break;
          if (child.type === "text") {
            textToken = child;
            break;
          }
        }
        if (numberText !== undefined) {
          if (textToken && textToken.content === def.defaultText) textToken.content = numberText;
          // 命中:保留 href 跳转(目标锚点由第一遍注入)
        } else {
          if (!unknownLabels.has(`${kind}:${label}`)) {
            unknownLabels.add(`${kind}:${label}`); // 同引用只提示一次
            state.env.warnings?.push(crossRefNotFoundWarning(def.kindName, `${kind}:${label}`));
          }
          if (textToken && textToken.content === def.defaultText) textToken.content = def.danglingText;
          // 悬空不带链接(docx 契约:目标锚点不存在,不生成死链)——解包链接
          // 结构(仅移除 link_open/link_close,保留内部文本与嵌套格式,按普通
          // 文本渲染;模板 a 色样式不作用于无链接文本)
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
  });
  // 包装 paragraph_open 渲染规则:带 data-xref-anchor 的题注段落开头注入锚点
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

/**
 * 从 src 的 pos(`<` 处)起匹配一个完整白名单表达式(标签对可嵌套,br 可单独,
 * 文本段不含 `<`);返回表达式长度;无法匹配(非白名单/带属性/未闭合)→ -1。
 * 供 html_inline 解析层组合 token 使用:markdown-it 14.3 的默认 html_inline
 * 只匹配单个标签(HTML_TAG_RE 无嵌套),白名单整串须在此提前组合。
 */
function matchAllowedHtmlExpression(src: string, pos: number): number {
  const stack: string[] = [];
  let i = pos;
  while (i < src.length) {
    const open = src.indexOf("<", i);
    if (open === -1) return -1; // 残留文本,表达式不完整
    const close = src.indexOf(">", open + 1);
    if (close === -1) return -1; // 未闭合
    const inner = src.slice(open + 1, close);
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return -1;
      if (name === "br" || !ALLOWED_INLINE_TAGS.has(name)) return -1;
      if (stack.length === 0 || stack[stack.length - 1] !== name) return -1;
      stack.pop();
      if (stack.length === 0) return close + 1 - pos; // 完整表达式
    } else {
      // B3:自闭合 <br/> / <br /> 此前整串判非法转义;仅空标签 br 放行自闭合
      const raw = inner.trim();
      const selfClosed = raw.endsWith("/");
      const name = (selfClosed ? raw.slice(0, -1) : raw).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return -1;
      if (!ALLOWED_INLINE_TAGS.has(name)) return -1;
      if (name === "br") {
        if (stack.length === 0) return close + 1 - pos; // 独立 <br>(含自闭合)
        // 嵌套内的 br:继续扫描
      } else {
        if (selfClosed) return -1; // 非空标签自闭合不放行(与 isAllowedInlineHtml 一致)
        stack.push(name);
      }
    }
    i = close + 1;
  }
  return -1;
}

/** HTML 白名单:page-break 注释 → 分页 div;白名单整串(无属性行内标签对)→ 原样输出
 *  (Chromium 渲染,与 docx 侧一致);其余裸 HTML 一律转义输出,维持"裸 HTML 不渲染"的安全行为。
 *  注意:html_block 也放行白名单整串——markdown-it 会把行首的 <strong>粗体</strong>
 *  归为 html_block 而非 html_inline,不放行则行首白名单在 pdf 侧被转义,双格式不一致;
 *  div/table/script 等块级标签不在白名单集内,依旧转义。 */
function overrideHtmlRules(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml;
  // 解析层:html_inline 之前组合白名单表达式(默认规则只产出单标签 token)
  md.inline.ruler.before("html_inline", "html_whitelist", (state, silent) => {
    if (!state.md.options.html || state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const len = matchAllowedHtmlExpression(state.src, state.pos);
    if (len < 0) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = state.src.slice(state.pos, state.pos + len);
    }
    state.pos += len;
    return true;
  });
  const renderHtml = (token: { content: string }): string => {
    const content = token.content.trim();
    if (content === "<!-- page-break -->") return '<div class="page-break"></div>';
    if (isAllowedInlineHtml(content)) return token.content;
    return escapeHtml(token.content);
  };
  // 渲染器契约:idx 必为有效下标
  md.renderer.rules.html_block = (tokens, idx) => renderHtml(tokens[idx]!);
  md.renderer.rules.html_inline = (tokens, idx) => renderHtml(tokens[idx]!);
}

/** 图片规则:相对/绝对路径统一转 file:// URL,http(s) 保留原样。
 *  本地 src(保持 markdown 原文)收集到 localSrcs,供 checkLocalImages
 *  经 resolver 做存在性检查(M6:单次 IO,替代 convert 层 stat 预扫)。 */
function overrideImageRule(md: MarkdownIt, baseDir: string, localSrcs: string[]): void {
    const defaultRule = md.renderer.rules.image;
    if (!defaultRule) return; // markdown-it 内置 image 规则,理论不可达
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
      const src = token.attrGet("src") ?? "";
      if (src && !/^(https?:|data:)/i.test(src)) {
        localSrcs.push(src);
        const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
        token.attrSet("src", pathToFileURL(abs).href);
      }
      return defaultRule(tokens, idx, options, env, self);
    };
}

/** 标题 id(批次 2 锚点目录/内部跳转底座):seen 在渲染闭包内维护,按文档顺序去重。
 *  注意:markdown-it 14.3 的 heading_open token 不带 content(初始为 "" 且不填充,
 *  标题纯文本落在下一个 inline token 上),故用 || 兜底取 tokens[idx + 1].content;
 *  若契约声明的 token.content 非空则优先使用。
 *  批次 10 功能 2:heading_open 带 data-xref-anchor(sec:<label>)时,开标签后注入
 *  <span id="sec:<label>"> 锚点(引用 [章节](#sec:label) 跳转目标;label 已在
 *  xref_recognize 从 inline.content 剥离,slug 不含 label)。 */
function overrideHeadingIdRule(md: MarkdownIt, seen: Map<string, number>): void {
  const defaultRule = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
    const text = token.content || tokens[idx + 1]?.content || "";
    token.attrSet("id", uniqueSlug(text, seen));
    const anchor = token.attrGet("data-xref-anchor");
    if (anchor) attrDel(token, "data-xref-anchor");
    const html = defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    if (!anchor) return html;
    return html.replace(">", `><span id="${anchor}"></span>`);
  };
}

/**
 * Mermaid 占位替换(8c):扫描 highlight 回调产出的 <div class="mermaid">…</div>
 * (内容为 escapeHtml 后的代码文本,占位内无原生 </div>,正则非贪婪匹配安全),
 * decodeEntities 还原原码后逐个 await mermaidResolver 渲染 → 成功替换为内联
 * SVG 容器;失败(null/抛错)→ 降级为 mermaid-fallback 等宽代码块 + 警告
 * (与 docx 侧降级语义一致,内容不丢失、不中断转换)。异步串行执行保持文档
 * 顺序;无占位(含未注入 resolver 时 highlight 不产占位)原样返回。
 */
async function replaceMermaidPlaceholders(
  html: string,
  resolver: MermaidResolver | undefined,
  warnings: ConvertWarning[],
): Promise<string> {
  const placeholderRe = /<div class="mermaid">([\s\S]*?)<\/div>/g;
  const matches: { index: number; full: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = placeholderRe.exec(html)) !== null) {
    matches.push({ index: m.index, full: m[0], body: m[1]! }); // 捕获组结构保证
  }
  if (matches.length === 0) return html;
  const fallback = (code: string): string =>
    `<pre class="mermaid-fallback"><code>${escapeHtml(code)}</code></pre>`;
  let out = "";
  let cursor = 0;
  for (const p of matches) {
    out += html.slice(cursor, p.index);
    const code = decodeEntities(p.body);
    try {
      const result = await resolver?.(code);
      if (result) {
        out += `<div class="mermaid-svg">${result.svg}</div>`;
      } else {
        warnings.push({
          key: "warn.mermaidEmpty",
          fallback: "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块",
        });
        out += fallback(code);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push({
        key: "warn.mermaidFailed",
        params: { reason },
        fallback: `Mermaid 渲染失败: ${reason},已降级为代码块`,
      });
      out += fallback(code);
    }
    cursor = p.index + p.full.length;
  }
  out += html.slice(cursor);
  return out;
}

/**
 * markdown → 完整 HTML 文档(供 loadFile 后 printToPDF)。
 * 返回 Promise:本地图片存在性检查与外链内嵌经 imageResolver 异步执行。
 */
export async function renderPdfHtml(
  mdSource: string,
  options: RenderPdfHtmlOptions,
): Promise<string> {
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  // 两个编号开关提前计算:core 规则(xref_recognize)与模板 CSS 共用同一取值
  const headingNumbering = options.headingNumbering ?? typography.headingNumbering;
  const captionNumbering = options.captionNumbering ?? typography.captionNumbering;
  const equationNumbering = options.equationNumbering ?? true;
  // B4:warnings 提前创建——buildMarkdownIt 的 highlight 回调需经此上报高亮降级警告
  const warnings: ConvertWarning[] = options.warnings ?? [];
  const md = buildMarkdownIt(
    options.mermaidResolver !== undefined,
    headingNumbering,
    captionNumbering,
    equationNumbering,
    warnings,
  );
  const localImageSrcs: string[] = [];
  overrideImageRule(md, options.baseDir, localImageSrcs);
  // seen 生命周期 = 本次渲染闭包,渲染顺序即文档顺序,保证标题 id 文档内唯一
  overrideHeadingIdRule(md, new Map<string, number>());
  // 标题优先级:frontmatter metadata.title > options.title
  const title = options.metadata?.title ?? options.title ?? "文档";
  // warnings 经 env 注入 core 规则(eq_numbering 未知公式标签提示用;脚注插件
  // 对 env.footnotes 惰性初始化,传入额外键无副作用)
  const bodyHtml = replaceTaskCheckboxes(md.render(mdSource, { warnings }));
  // M6:本地图片存在性检查并入 resolver 失败路径(单次 IO;HTML 保持 file:// 由 Chromium 渲染)
  await checkLocalImages(localImageSrcs, options.imageResolver, warnings);
  // Mermaid 占位 → 内联 SVG / 失败降级代码块(异步串行,须在返回 html 前完成)
  const bodyWithMermaid = await replaceMermaidPlaceholders(bodyHtml, options.mermaidResolver, warnings);
  // 封面 + 目录 + 正文:buildCoverHtml/buildTocHtml 各自以 page-break 结尾,
  // 无封面或无目录时返回空串,拼接自然退化为 cover+body / toc+body / body。
  // toc 开关(默认开):关闭时不生成目录页(docx 侧同开关,双格式一致)
  const tocHtml = (options.toc ?? true) ? buildTocHtml(bodyWithMermaid) : "";
  const fullBody = buildCoverHtml(options.metadata) + tocHtml + bodyWithMermaid;
  const processedBody = await embedExternalImages(fullBody, options.imageResolver, warnings);
  return buildTemplate(
    processedBody,
    title,
    // 批次 16:用户 CSS 追加到默认 CSS 末尾(同一 <style> 内后声明覆盖默认样式)
    buildTemplateCss(
      pageSetup,
      options.breakBeforeH1 ?? false,
      typography,
      headingNumbering,
      captionNumbering,
      /<h1[\s>]/i.test(bodyHtml),
    ) + (options.pdfCss ? `\n${options.pdfCss}` : ""),
    options.katexDir ? loadKatexCss(options.katexDir, warnings) : "",
  );
}
