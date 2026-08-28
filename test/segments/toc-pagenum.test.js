/**
 * 目录页码(两遍法)测试:
 * - 纯逻辑:injectTocPageNumbers 将 slug→页码 注入 .toc 条目(<span class="toc-page">N</span>)
 * - 端到端:field 模式转换 → 第一遍打印 → 经 /Dests 解析标题页码(pageNumbersForNames)
 *   → 第二遍注入页码 span,且页码随文档顺序单调递增、在页范围内
 * 复用既有 /Dests 命名目标解析(与书签大纲同源),免 pdfjs 文本匹配。
 */
import { convert } from "../../dist/core/convert.js";
import { injectTocPageNumbers, extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { pageNumbersForNames } from "../../dist/core/pdf/bookmarks.js";
import { PDFDocument } from "pdf-lib";
import { htmlToPdf } from "../common/pdf-utils.js";
import { FIXTURES_DIR } from "../common/paths.js";

const md = `# 第一章

## 1.1 小节甲

正文段落。

# 第二章

## 2.1 小节乙

另一段正文。
`;
export const fixtures = { main: md };

export async function run() {
  // 纯逻辑:injectTocPageNumbers 注入页码 span,且仅替换 .toc 条目
  const tocHtml =
    '<div class="toc"><ul>' +
    '<li class="toc-l1"><a href="#a">第一章</a></li>' +
    '<li class="toc-l2"><a href="#b">1.1 小节</a></li>' +
    "</ul></div>";
  const injected = injectTocPageNumbers(tocHtml, { a: 2, b: 3 });
  if (!injected.includes('<span class="toc-page">2</span>')) {
    throw new Error("F7-② 断言失败:目录页码未注入(第一章)");
  }
  if (!injected.includes('<span class="toc-page">3</span>')) {
    throw new Error("F7-② 断言失败:目录页码未注入(小节)");
  }
  if (injected.includes('<li class="toc-l1"><a href="#a">第一章</a></li>')) {
    throw new Error("F7-② 断言失败:原 TOC 条目结构应被替换(含页码)");
  }
  console.log("[ok] injectTocPageNumbers:页码 span 注入 断言通过");

  // 端到端两遍法:field 模式转换 → 第一遍打印 → /Dests 解析页码 → 注入一致
  const art = await convert(md, "pdf", { baseDir: FIXTURES_DIR, title: "F7", warnings: [], tocMode: "field" });
  if (!art.html.includes('class="toc"')) throw new Error("F7-② 断言失败:field 模式应含目录");
  const pass1 = await htmlToPdf(art.html, art.footerTemplate);
  const doc = await PDFDocument.load(new Uint8Array(pass1));
  const headings = extractHeadings(art.html);
  if (headings.length === 0) throw new Error("F7-② 断言失败:未提取到标题");
  const pageNumbers = pageNumbersForNames(
    doc,
    headings.map((h) => h.id),
  );
  const pageCount = doc.getPageCount();
  for (const h of headings) {
    const p = pageNumbers[h.id];
    if (p == null) throw new Error(`F7-② 断言失败:标题 ${h.id} 未解析到页码`);
    if (p < 1 || p > pageCount) throw new Error(`F7-② 断言失败:页码越界 ${p}(共 ${pageCount} 页)`);
  }
  // 页码随文档顺序单调递增(后续标题页号不小于先前)
  for (let i = 1; i < headings.length; i++) {
    if (pageNumbers[headings[i].id] < pageNumbers[headings[i - 1].id]) {
      throw new Error("F7-② 断言失败:页码顺序不符文档顺序(应单调递增)");
    }
  }
  const html2 = injectTocPageNumbers(art.html, pageNumbers);
  if (!html2.includes('<span class="toc-page">')) {
    throw new Error("F7-② 断言失败:第二遍 HTML 应含页码 span");
  }
  console.log("[ok] PDF 两遍法:field 模式 /Dests 解析页码 + 注入一致 断言通过");
}
