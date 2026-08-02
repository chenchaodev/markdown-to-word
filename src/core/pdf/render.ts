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

export interface RenderPdfHtmlOptions {
  /** markdown 文件所在目录,相对路径图片以此为基准 */
  baseDir: string;
  /** 页面 <title>,缺省取文件名(不含扩展名) */
  title?: string;
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
    html: false,
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
  return md;
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

/** 转换矩阵与 docx 路线对齐的文档模板样式(分页、中文字体、代码高亮、表格、跨页避让)。 */
const TEMPLATE_CSS = `
  @page { size: A4; margin: 18mm 16mm 22mm; }
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
`;

function buildTemplate(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${TEMPLATE_CSS}</style>
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
 * markdown → 完整 HTML 文档(供 loadFile 后 printToPDF)。
 * 返回 Promise 仅为与 docx 渲染签名保持一致,当前实现为同步。
 */
export async function renderPdfHtml(
  mdSource: string,
  options: RenderPdfHtmlOptions,
): Promise<string> {
  const md = buildMarkdownIt();
  overrideImageRule(md, options.baseDir);
  const title = options.title ?? "文档";
  const bodyHtml = replaceTaskCheckboxes(md.render(mdSource));
  return buildTemplate(bodyHtml, title);
}
