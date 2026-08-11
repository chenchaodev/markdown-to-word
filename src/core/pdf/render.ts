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
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../convert.js";
import type { DocMetadata } from "../frontmatter.js";
import type { TypographySettings } from "../typography.js";
import { DEFAULT_TYPOGRAPHY } from "../typography.js";
import { uniqueSlug } from "../slug.js";
import { ALLOWED_INLINE_TAGS, isAllowedInlineHtml } from "../html-whitelist.js";
import { buildCoverHtml, buildTemplate, buildTemplateCss, loadKatexCss } from "./template.js";
import { buildTocHtml, embedExternalImages } from "./postprocess.js";

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败 */
export type ImageResolver = (src: string) => Promise<Buffer | null>;

export interface RenderPdfHtmlOptions {
  /** markdown 文件所在目录,相对路径图片以此为基准 */
  baseDir: string;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页,标题优先级高于 options.title) */
  metadata?: DocMetadata;
  /** 警告收集(外链图片下载失败等,与缺失图片警告同构) */
  warnings?: string[];
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
  /** KaTeX 资源目录(绝对路径,含 katex.min.css 与 fonts/ 子目录,即
   *  node_modules/katex/dist;传入则 katex.min.css 内联进模板并改写字体
   *  为 file:// 绝对路径,公式字体样式生效;不传则公式渲染为 KaTeX HTML
   *  但无字体样式,公式仍显示(缺字形美观度)) */
  katexDir?: string;
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

function buildMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(str: string, lang?: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            `<pre class="hljs"><code class="language-${lang}">` +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            "</code></pre>"
          );
        } catch {
          /* 语言包异常时回退转义输出 */
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
  overrideEquationRule(md);
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
      const token = tokens[i];
      if (token.type === "blockquote_open") depth.blockquote++;
      else if (token.type === "blockquote_close") depth.blockquote--;
      else if (token.type === "list_item_open") depth.list_item++;
      else if (token.type === "list_item_close") depth.list_item--;
      else if (token.type === "table_cell_open") depth.table_cell++;
      else if (token.type === "table_cell_close") depth.table_cell--;
      else if (token.type === "paragraph_close" && depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0) {
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
        const first = inline.children[0];
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
        tokens[i - 2].attrSet("class", match[1] === "图" ? "fig-caption" : "tab-caption");
      }
    }
  });
}

/**
 * 公式编号 + 交叉引用(8d,与 docx 侧契约一致;免更新路线,编号静态注入文本):
 * - 编号对象:顶层(blockquote/list_item/table 单元格外)display 公式(math_block,
 *   由 @mdit/plugin-katex 产生),按文档顺序全文连续编号 1,2,3…
 * - label 语法:公式块之后紧跟独立段落 {#eq:label}(整段仅此一行,label 为 [\w-]+),
 *   该段标记 hidden 不渲染,label 登记给前一个 math_block(生成页内锚点)
 * - 引用语法:链接 [式](#eq:label) / [公式](#eq:label) 文本替换为「式 (N)」/「公式 (N)」
 *   并保留跳转;其他文本的 #eq:label 链接保持原文本;未知 label → 「式 (?)」
 *   (warnings 通道存在时追加提示,经 render 的 env.warnings 注入,见 renderPdfHtml)
 * - 编号渲染:math_block 包 <div class="eq-block">(内可选 <span id="eq:label"> 锚点 +
 *   KaTeX 输出 + <span class="eq-num">(N)</span>),CSS 使公式居中、编号右缘垂直居中
 */
function overrideEquationRule(md: MarkdownIt): void {
  md.core.ruler.push("eq_numbering", (state) => {
    const tokens = state.tokens;
    // 第一遍:顶层遍历(容器深度跟踪同 caption_recognize),编号 + label 段识别
    const depth = { blockquote: 0, list_item: 0, table_cell: 0 };
    let eqIndex = 0;
    let lastMathToken: (typeof tokens)[number] | null = null;
    const labelIndex = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
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
        eqIndex++;
        token.attrSet("data-eq-index", String(eqIndex));
        lastMathToken = token;
      } else if (
        token.type === "paragraph_close" &&
        depth.blockquote === 0 && depth.list_item === 0 && depth.table_cell === 0
      ) {
        // label 段:paragraph_open + inline(唯一 text child)+ paragraph_close
        const inline = tokens[i - 1];
        if (!inline || inline.type !== "inline" || !inline.children || inline.children.length !== 1) continue;
        const first = inline.children[0];
        if (first.type !== "text") continue;
        const match = /^\{#eq:([\w-]+)\}$/.exec(first.content);
        if (!match) continue;
        if (!lastMathToken) continue; // 无前置公式 → 保持原样(按普通段落渲染)
        const label = match[1];
        lastMathToken.attrSet("data-eq-label", label);
        labelIndex.set(label, eqIndex);
        // 三 token 置 hidden 不渲染。注意:markdown-it 主渲染循环对 inline token
        // 直接 renderInline(children),不检查 inline 自身 hidden(仅 renderToken 检查,
        // text 等走独立规则的 children 亦然)→ 必须同时清空 children 才能彻底不输出
        tokens[i - 2].hidden = true;
        inline.hidden = true;
        inline.children = [];
        token.hidden = true;
      }
    }
    // 第二遍:链接引用替换(遍历所有 inline 的 children,含容器/脚注内)
    const unknownLabels = new Set<string>();
    for (const token of tokens) {
      if (token.type !== "inline" || !token.children) continue;
      const children = token.children;
      for (let i = 0; i < children.length; i++) {
        const linkOpen = children[i];
        if (linkOpen.type !== "link_open") continue;
        const href = linkOpen.attrGet("href");
        if (!href) continue;
        const match = /^#eq:([\w-]+)$/.exec(href);
        if (!match) continue;
        const label = match[1];
        const num = labelIndex.get(label);
        if (num === undefined && !unknownLabels.has(label)) {
          unknownLabels.add(label); // 同标签只提示一次,避免重复刷屏
          state.env.warnings?.push(`引用未定义的公式标签: eq:${label}`);
        }
        // 链接内第一个 text token(可能嵌套格式如 **式**,取首个文本节点替换)
        for (let j = i + 1; j < children.length; j++) {
          const child = children[j];
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
    const token = tokens[idx];
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
      if (!/^[a-z][a-z0-9]*\s*$/i.test(inner)) return -1;
      const name = inner.trim().toLowerCase();
      if (!ALLOWED_INLINE_TAGS.has(name)) return -1;
      if (name === "br") {
        if (stack.length === 0) return close + 1 - pos; // 独立 <br>
        // 嵌套内的 br:继续扫描
      } else {
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
  md.renderer.rules.html_block = (tokens, idx) => renderHtml(tokens[idx]);
  md.renderer.rules.html_inline = (tokens, idx) => renderHtml(tokens[idx]);
}

/** 图片规则:相对/绝对路径统一转 file:// URL,http(s) 保留原样。 */
function overrideImageRule(md: MarkdownIt, baseDir: string): void {
    const defaultRule = md.renderer.rules.image;
    if (!defaultRule) return; // markdown-it 内置 image 规则,理论不可达
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet("src") ?? "";
      if (src && !/^(https?:|data:)/i.test(src)) {
        const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
        token.attrSet("src", pathToFileURL(abs).href);
      }
      return defaultRule(tokens, idx, options, env, self);
    };
}

/** 标题 id(批次 2 锚点目录/内部跳转底座):seen 在渲染闭包内维护,按文档顺序去重。
 *  注意:markdown-it 14.3 的 heading_open token 不带 content(初始为 "" 且不填充,
 *  标题纯文本落在下一个 inline token 上),故用 || 兜底取 tokens[idx + 1].content;
 *  若契约声明的 token.content 非空则优先使用。 */
function overrideHeadingIdRule(md: MarkdownIt, seen: Map<string, number>): void {
  const defaultRule = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const text = token.content || tokens[idx + 1]?.content || "";
    token.attrSet("id", uniqueSlug(text, seen));
    return defaultRule
      ? defaultRule(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}

/**
 * markdown → 完整 HTML 文档(供 loadFile 后 printToPDF)。
 * 返回 Promise 仅为与 docx 渲染签名保持一致,当前实现为同步。
 */
export async function renderPdfHtml(
  mdSource: string,
  options: RenderPdfHtmlOptions,
): Promise<string> {
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  const md = buildMarkdownIt();
  overrideImageRule(md, options.baseDir);
  // seen 生命周期 = 本次渲染闭包,渲染顺序即文档顺序,保证标题 id 文档内唯一
  overrideHeadingIdRule(md, new Map<string, number>());
  // 标题优先级:frontmatter metadata.title > options.title
  const title = options.metadata?.title ?? options.title ?? "文档";
  const warnings = options.warnings ?? [];
  // warnings 经 env 注入 core 规则(eq_numbering 未知公式标签提示用;脚注插件
  // 对 env.footnotes 惰性初始化,传入额外键无副作用)
  const bodyHtml = replaceTaskCheckboxes(md.render(mdSource, { warnings }));
  const captionNumbering = options.captionNumbering ?? typography.captionNumbering;
  // 封面 + 目录 + 正文:buildCoverHtml/buildTocHtml 各自以 page-break 结尾,
  // 无封面或无目录时返回空串,拼接自然退化为 cover+body / toc+body / body。
  // toc 开关(默认开):关闭时不生成目录页(docx 侧同开关,双格式一致)
  const tocHtml = (options.toc ?? true) ? buildTocHtml(bodyHtml) : "";
  const fullBody = buildCoverHtml(options.metadata) + tocHtml + bodyHtml;
  const processedBody = await embedExternalImages(fullBody, options.imageResolver, warnings);
  // headingNumbering 优先级:显式选项 > typography 设置(默认 true,与 docx 侧一致)
  return buildTemplate(
    processedBody,
    title,
    buildTemplateCss(
      pageSetup,
      options.breakBeforeH1 ?? false,
      typography,
      options.headingNumbering ?? typography.headingNumbering,
      captionNumbering,
      /<h1[\s>]/i.test(bodyHtml),
    ),
    options.katexDir ? loadKatexCss(options.katexDir) : "",
  );
}
