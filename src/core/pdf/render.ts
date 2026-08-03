/**
 * G4:markdown → PDF 渲染管线(markdown-it → HTML 模板 → 主进程 printToPDF)。
 * 调研结论见 docs/研究结论.md(G4 调研条目):
 * - markdown-it 核心内置表格/删除线;任务列表用 @mdit/plugin-tasklist
 * - highlight.js 走 lib/common ESM 子集;printToPDF 需 printBackground: true 才有代码底色
 * - 图片统一转 file:// URL(markdown-it 原样输出绝对路径会解析失败)
 * - 任务列表 checkbox 有 Chromium 打印 bug,渲染后用 ☐/☑ 字符替代(打印稳定)
 */
import MarkdownIt from "markdown-it";
import { tasklist } from "@mdit/plugin-tasklist";
import hljs from "highlight.js/lib/common";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../convert.js";
import type { DocMetadata } from "../frontmatter.js";
import { uniqueSlug } from "../slug.js";

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
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
}

/** 页码页脚模板(printToPDF footerTemplate 用;模板内必须内联样式,字体大小需显式设置)。 */
export const PDF_FOOTER_TEMPLATE =
  '<div style="font-size:9px;color:#888;width:100%;text-align:center;">' +
  '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>';

/** 任务列表 checkbox → 字符(markdown-it 渲染后替换,规避 Chromium 打印 checkbox bug)。 */
function replaceTaskCheckboxes(html: string): string {
  return html.replace(
    /<input class="task-list-item-checkbox" type="checkbox" disabled( checked)?>/g,
    (_match, checked?: string) => (checked ? "☑ " : "☐ "),
  );
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
  overrideHtmlRules(md);
  return md;
}

/** HTML 白名单:仅放行 trim 后精确等于 <!-- page-break --> 的裸 HTML(→ 分页 div),
 *  其余一律转义输出,维持"裸 HTML 不渲染"的安全行为。 */
function overrideHtmlRules(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml;
  const renderHtml = (token: { content: string }): string => {
    const content = token.content.trim();
    return content === "<!-- page-break -->"
      ? '<div class="page-break"></div>'
      : escapeHtml(token.content);
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

/** 转换矩阵与 docx 路线对齐的文档模板样式(分页、中文字体、代码高亮、表格、跨页避让)。
 *  @page 尺寸/边距由 pageSetup 生成(margin 顺序 top right bottom left);
 *  breakBeforeH1 为 true 时追加一级标题前分页规则。 */
function buildTemplateCss(pageSetup: PageSetup, breakBeforeH1: boolean): string {
  const size = pageSetup.paper + (pageSetup.orientation === "landscape" ? " landscape" : "");
  const { marginTop, marginRight, marginBottom, marginLeft } = pageSetup;
  return `
  @page { size: ${size}; margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm; }
  .page-break { break-before: page; height: 0; }
  /* 分页符后紧跟的 h1 不再强制分页:breakBeforeH1 下两个相邻 break-before 叠加,
     Chromium printToPDF 会产生 1 个空白页(实测确认,相邻分页符不合并);
     breakBeforeH1 关闭时 h1 无 break-before,本规则无副作用,故无条件加 */
  .page-break + h1 { break-before: auto; }
  * { box-sizing: border-box; }

  /* 基础排版:1.65 行高兼顾中英混排;orphans/widows 保证跨页段落不零碎 */
  body {
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    font-size: 11pt; line-height: 1.65; color: #1f2328; margin: 0;
    orphans: 2; widows: 2;
  }

  /* 标题节奏:h1/h2 带下边线锚定章节,3-6 级靠字号与间距区分;
     标题行高收紧,且不与后续内容分离(break-after: avoid,避免孤立标题) */
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; break-after: avoid; }
  body > :first-child { margin-top: 0; } /* 文档首元素不产生多余顶距 */

  /* 封面页:居中大标题 + 灰色作者/日期,顶部留白视觉居中 */
  .cover { text-align: center; padding-top: 80mm; }
  .cover-title { font-size: 28pt; font-weight: 700; margin: 0 0 20px; }
  .cover-meta { font-size: 12pt; color: #888; }

  /* 目录页:无页码,条目为页内锚点链接(printToPDF 保留为可点击链接);
     层级靠左缩进区分,链接沿用正文颜色(继承而非蓝色) */
  .toc-title { font-size: 18pt; font-weight: 700; margin-bottom: 16px; }
  .toc ul { list-style: none; padding: 0; margin: 0; }
  .toc-l1 { margin: 6px 0; }
  .toc-l2 { margin-left: 1.5em; }
  .toc-l3 { margin-left: 3em; }
  .toc a { color: inherit; text-decoration: none; }
  h1 { font-size: 22pt; border-bottom: 2px solid #d0d7de; padding-bottom: 8px; margin: 0 0 16px; }
  h2 { font-size: 17pt; border-bottom: 1px solid #d0d7de; padding-bottom: 6px; margin: 24px 0 12px; }
  h3 { font-size: 14pt; margin: 20px 0 10px; }
  h4 { font-size: 12pt; margin: 16px 0 8px; }
  h5, h6 { font-size: 11pt; margin: 14px 0 8px; color: #57606a; }

  p { margin: 0 0 10px; }
  a { color: #0969da; text-decoration: none; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 18px 0; }

  /* 行内代码与代码块 */
  code {
    font-family: Consolas, "Cascadia Mono", monospace;
    font-size: 0.9em; background: #f6f8fa; padding: 2px 5px; border-radius: 4px;
    overflow-wrap: break-word; /* 长行内代码换行而非溢出页边 */
  }
  pre.hljs {
    background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px;
    padding: 12px 14px; overflow: hidden; break-inside: avoid;
  }
  pre.hljs code {
    background: none; padding: 0; font-size: 9.5pt; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; /* 长代码行折行,避免打印裁切 */
  }

  /* 引用块:末段收敛间距;整块避免跨页 */
  blockquote {
    margin: 0 0 10px; padding: 2px 14px; color: #57606a;
    border-left: 4px solid #d0d7de; break-inside: avoid;
  }
  blockquote > :last-child { margin-bottom: 0; }

  /* 表格:表头底色 + 斑马纹;行内不跨页,长表格按行断开 */
  table {
    border-collapse: collapse; width: 100%; margin: 0 0 12px;
    font-size: 10pt; break-inside: avoid;
  }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f0f3f6; font-weight: 600; }
  tr:nth-child(even) td { background: #f8f9fa; }
  tr { break-inside: avoid; }

  img { max-width: 100%; break-inside: avoid; }
  ul, ol { margin: 0 0 10px; padding-left: 26px; }
  li { margin: 2px 0; }
  li > p { margin: 0 0 4px; } /* 宽松列表项内的段落收紧,避免空洞 */
  li > p:last-child { margin-bottom: 0; }
  li.task-list-item { list-style: none; margin-left: -18px; }
  li.task-list-item::before { content: ""; }
  del { color: #8c959f; }

  /* 代码高亮(GitHub Light 色板;printBackground 打印背景) */
  .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #cf222e; }
  .hljs-string, .hljs-regexp { color: #0a3069; }
  .hljs-number { color: #0550ae; }
  .hljs-comment { color: #6e7781; font-style: italic; }
  .hljs-title, .hljs-function { color: #8250df; }
  .hljs-attr, .hljs-attribute { color: #953800; }
  .hljs-variable, .hljs-template-variable { color: #953800; }
  .hljs-built_in { color: #0550ae; }
  .hljs-meta { color: #57606a; }
  .hljs-symbol, .hljs-bullet { color: #0550ae; }
  /* 补充常见 token 类(沿用同色板,补上 highlight.js 各语言的高频输出) */
  .hljs-type, .hljs-selector-class, .hljs-name, .hljs-tag { color: #116329; }
  .hljs-property { color: #0550ae; }
  .hljs-operator { color: #cf222e; }
  .hljs-link { color: #0a3069; }
  .hljs-quote, .hljs-doctag { color: #6e7781; }
  .hljs-section { color: #8250df; }
  .hljs-deletion { color: #cf222e; background: #ffebe9; }
  .hljs-addition { color: #116329; background: #dafbe1; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }
${breakBeforeH1 ? `
  /* 一级标题前分页(breakBeforeH1);文档首元素为 h1 时避免空白首页 */
  h1 { break-before: page; }
  body > h1:first-child { break-before: auto; }` : ""}
`;
}

function buildTemplate(bodyHtml: string, title: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** HTML 转义(标题等插值内容用,避免文件名含 &/< 破坏模板)。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 封面 HTML:metadata.title 存在时生成。居中大标题(28pt)+ 作者/日期灰色小字,
 * 末尾 <div class="page-break"></div> 复用现有分页样式,封面独占一页。
 */
function buildCoverHtml(metadata: DocMetadata | undefined): string {
  if (!metadata?.title) return "";
  const metaLine = [metadata.author, metadata.date].filter(Boolean).join(" · ");
  return (
    '<div class="cover">' +
    `<div class="cover-title">${escapeHtml(metadata.title)}</div>` +
    (metaLine ? `<div class="cover-meta">${escapeHtml(metaLine)}</div>` : "") +
    "</div>" +
    '<div class="page-break"></div>'
  );
}

/** HTML 实体解码(目录标题文本用;markdown-it 输出的常见实体,零依赖手写)。
 *  命名实体先于 &amp; 解码,避免 "&amp;lt;" 二次解码为 "<"。 */
function decodeEntities(text: string): string {
  const decodeNumeric = (match: string, digits: string, radix: number): string => {
    const cp = parseInt(digits, radix);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => decodeNumeric(m, hex, 16))
    .replace(/&#(\d+);/g, (m, dec: string) => decodeNumeric(m, dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * 目录 HTML:从渲染后正文提取 h1-h3(id 由 overrideHeadingIdRule 生成,与正文锚点
 * 一一对应),生成无页码锚点链接列表(实测 printToPDF 保留页内锚点为可点击链接,
 * 含跨页)。标题文本剥行内标签 + 实体解码;标题不足 1 个返回空串(不生成目录)。
 * 输出:<div class="toc">…<ul>…</ul></div> + 分页 div。
 */
function buildTocHtml(bodyHtml: string): string {
  const items: string[] = [];
  for (const match of bodyHtml.matchAll(/<h([1-3])[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\1>/g)) {
    const [, level, id, raw] = match;
    const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));
    items.push(`<li class="toc-l${level}"><a href="#${id}">${escapeHtml(text)}</a></li>`);
  }
  if (items.length === 0) return "";
  return (
    '<div class="toc">' +
    '<div class="toc-title">目录</div>' +
    `<ul>${items.join("")}</ul>` +
    "</div>" +
    '<div class="page-break"></div>'
  );
}

/** 外链图片并发下载上限 */
const EXTERNAL_IMAGE_CONCURRENCY = 3;

/**
 * 渲染后处理:收集 <img src="https?://..."> 的 URL,经 imageResolver 并行下载
 * (并发限制 3),成功内嵌为 data URL(Chromium 加载 data URL 无需网络,file://
 * HTML 下可用);失败保留原 URL 并追加警告。
 */
async function embedExternalImages(
  html: string,
  resolver: ImageResolver | undefined,
  warnings: string[],
): Promise<string> {
  if (!resolver) return html;
  const urls = Array.from(
    new Set([...html.matchAll(/<img[^>]*\ssrc="(https?:\/\/[^"]+)"/gi)].map((m) => m[1])),
  );
  if (urls.length === 0) return html;

  const results = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const data = await resolver(url);
        if (data && data.length > 0) {
          results.set(url, `data:${mimeFromBuffer(data)};base64,${data.toString("base64")}`);
        } else {
          warnings.push(`外链图片下载失败: ${url}`);
        }
      } catch {
        warnings.push(`外链图片下载失败: ${url}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTERNAL_IMAGE_CONCURRENCY, urls.length) }, worker));

  let out = html;
  for (const [url, dataUrl] of results) {
    // 精确替换 src 属性,避免 URL 互为子串时误替换
    out = out.replace(new RegExp(`src="${escapeRegExp(url)}"`, "g"), `src="${dataUrl}"`);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 魔数判断图片 MIME(data URL 用;png/jpeg/gif/webp,未知回退 png) */
function mimeFromBuffer(data: Buffer): string {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
    return "image/jpeg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/png";
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
  const md = buildMarkdownIt();
  overrideImageRule(md, options.baseDir);
  // seen 生命周期 = 本次渲染闭包,渲染顺序即文档顺序,保证标题 id 文档内唯一
  overrideHeadingIdRule(md, new Map<string, number>());
  // 标题优先级:frontmatter metadata.title > options.title
  const title = options.metadata?.title ?? options.title ?? "文档";
  const warnings = options.warnings ?? [];
  const bodyHtml = replaceTaskCheckboxes(md.render(mdSource));
  // 封面 + 目录 + 正文:buildCoverHtml/buildTocHtml 各自以 page-break 结尾,
  // 无封面或无目录时返回空串,拼接自然退化为 cover+body / toc+body / body。
  const fullBody = buildCoverHtml(options.metadata) + buildTocHtml(bodyHtml) + bodyHtml;
  const processedBody = await embedExternalImages(fullBody, options.imageResolver, warnings);
  return buildTemplate(
    processedBody,
    title,
    buildTemplateCss(pageSetup, options.breakBeforeH1 ?? false),
  );
}
