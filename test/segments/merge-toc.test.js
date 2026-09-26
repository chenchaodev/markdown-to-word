// @ts-check
/**
 * 合并总目录增强(固化既有单 pass 合并通路行为,无需新增代码):
 * - 合并多文件后单次 convert 产出「总目录」覆盖所有源文件标题(docx + pdf 双格式断言)
 * - 结构化目录数据:同一次渲染管线产出的 headings 覆盖合并后全部标题、id 跨文件唯一
 *   (渐进替换:目录不再从 HTML 反解析,见 core/pdf/render.ts renderPdfDocument)
 * - 跨文件页码准确:field 模式两遍法对合并产物注入的页码随文档顺序单调,
 *   且后文件(经 page-break 起新页)标题页码严格大于前文件(PDF)
 * 复用 mergeMarkdowns → convert 一次;TOC 覆盖与页码由既有机制保障,本段防止回归。
 */
import { convert } from "../../dist/core/convert.js";
import { mergeMarkdowns } from "../../dist/core/pipeline/merge.js";
import { extractHeadings, injectTocPageNumbers } from "../../dist/core/pdf/postprocess.js";
import { renderPdfDocument } from "../../dist/core/pdf/render.js";
import { pageNumbersForNames } from "../../dist/core/pdf/bookmarks.js";
import { unzipPart } from "../common/docx-utils.js";
import { PDFDocument } from "pdf-lib";
import { htmlToPdf } from "../common/pdf-utils.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { asPdfArtifact, docxBufferOf } from "../common/convert-helpers.js";

const fileA = `# 第一章 A

## 1.1 A 小节一

正文段落。

# 第二章 A

## 2.1 A 小节二

另一段。
`;

const fileB = `# 第三章 B

## 3.1 B 小节一

正文段落。

# 第四章 B

## 4.1 B 小节二

另一段。
`;
export const meta = { description: "合并总目录增强(固化既有单 pass 合并通路行为,无需新增代码):" };
export const fixtures = { main: fileA + "\n\n" + fileB };

const A_TITLES = ["第一章 A", "1.1 A 小节一", "第二章 A", "2.1 A 小节二"];
const B_TITLES = ["第三章 B", "3.1 B 小节一", "第四章 B", "4.1 B 小节二"];

/**
 * 取标题对应页码(标题必在 ordered 中:上方已断言 8 条标题序列与 A/B 标题一致)。
 * @param {{ text: unknown, page: number | undefined }[]} ordered 文档顺序标题 → 页码
 * @param {string} text 标题文本
 * @returns {number} 页码
 */
function pageOf(ordered, text) {
  const found = ordered.find((o) => o.text === text);
  if (!found || found.page == null) {
    throw new Error(`合并总目录 断言失败:标题「${text}」未解析到页码`);
  }
  return found.page;
}
const ALL_TITLES = [...A_TITLES, ...B_TITLES];

export async function run() {
  const mergedMd = mergeMarkdowns([
    { content: fileA, baseDir: FIXTURES_DIR },
    { content: fileB, baseDir: FIXTURES_DIR },
  ]);
  if (!mergedMd.includes("page-break")) {
    throw new Error("合并总目录 断言失败:合并未插入文件间分页符(跨文件页码断言前提)");
  }

  // docx:合并产物含总目录且覆盖两个文件全部标题
  const docx = await convert(mergedMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], toc: true });
  const docXml = await unzipPart(docxBufferOf(docx), "word/document.xml");
  if (!docXml.includes("TOC")) throw new Error("合并总目录 断言失败:合并 docx 缺少 TOC 指令");
  for (const t of ALL_TITLES) {
    if (!docXml.includes(t)) throw new Error(`合并总目录 断言失败:合并 docx 总目录/正文缺少标题「${t}」`);
  }
  console.log("[ok] 合并 docx 总目录覆盖全部源文件标题(A+B 共 8) 断言通过");

  // pdf:合并产物总目录(artifact.html)覆盖两个文件全部标题
  const pdfArt = asPdfArtifact(
    await convert(mergedMd, "pdf", {
      baseDir: FIXTURES_DIR,
      title: "合并样例",
      warnings: [],
      toc: true,
      tocMode: "field",
    }),
  );
  if (!pdfArt.html.includes('class="toc"')) throw new Error("合并总目录 断言失败:合并 pdf 缺少总目录");
  for (const t of ALL_TITLES) {
    if (!pdfArt.html.includes(t)) throw new Error(`合并总目录 断言失败:合并 pdf 总目录/正文缺少标题「${t}」`);
  }
  console.log("[ok] 合并 pdf 总目录覆盖全部源文件标题(A+B 共 8) 断言通过");

  // 跨文件页码准确:field 两遍法对合并产物注入页码随文档顺序单调,且 B 页码 > A 页码
  const headings = extractHeadings(pdfArt.html);
  const pass1 = await htmlToPdf(pdfArt.html, pdfArt.footerTemplate);
  const pdfDoc = await PDFDocument.load(new Uint8Array(pass1));
  const pageNumbers = /** @type {Record<string, number>} */ (
    pageNumbersForNames(
      pdfDoc,
      headings.map((h) => h.id),
    )
  );
  // 文档顺序标题 → 页码,校验单调非降
  const ordered = headings.map((h) => ({ text: h.text, page: pageNumbers[h.id] }));
  let prev = 0;
  for (const o of ordered) {
    if (o.page == null) throw new Error(`合并总目录 断言失败:合并标题「${o.text}」未解析到页码`);
    if (o.page < prev) throw new Error("合并总目录 断言失败:合并页码未随文档顺序单调非降");
    prev = o.page;
  }
  // 跨文件:B 文件首个标题页码应严格大于 A 文件末个标题页码(page-break 起新页)
  const aPages = A_TITLES.map((t) => pageOf(ordered, t));
  const bPages = B_TITLES.map((t) => pageOf(ordered, t));
  const maxA = Math.max(...aPages);
  const minB = Math.min(...bPages);
  if (!(minB > maxA)) {
    throw new Error(`合并总目录 断言失败:跨文件页码顺序错误(A 最大页 ${maxA} 应 < B 最小页 ${minB})`);
  }
  const injected = injectTocPageNumbers(pdfArt.html, pageNumbers);
  if (!injected.includes('<span class="toc-page">')) {
    throw new Error("合并总目录 断言失败:合并页码未注入 .toc-page");
  }
  console.log("[ok] 合并 PDF 跨文件页码准确(A<B)且已注入 断言通过");

  // 结构化目录数据:与合并后 HTML 同一次渲染产出,覆盖 A+B 全部 8 个标题、id 跨文件唯一
  {
    const { html: structuredHtml, headings } = await renderPdfDocument(mergedMd, {
      baseDir: FIXTURES_DIR,
      title: "合并样例",
      toc: true,
    });
    if (JSON.stringify(headings.map((h) => h.text)) !== JSON.stringify(ALL_TITLES)) {
      throw new Error(
        `合并总目录 断言失败:合并结构化标题序列异常,texts=${JSON.stringify(headings.map((h) => h.text))}`,
      );
    }
    const ids = headings.map((h) => h.id);
    if (new Set(ids).size !== ALL_TITLES.length) {
      throw new Error(`合并总目录 断言失败:合并结构化标题 id 应跨文件唯一,ids=${JSON.stringify(ids)}`);
    }
    // 与旧兼容层逐字一致(渐进替换不改行为)
    if (JSON.stringify(extractHeadings(structuredHtml)) !== JSON.stringify(headings)) {
      throw new Error("合并总目录 断言失败:合并结构化标题与兼容层提取不一致");
    }
    console.log("[ok] 合并 PDF 结构化目录数据(A+B 共 8 条、id 唯一、与兼容层一致)断言通过");
  }
}
