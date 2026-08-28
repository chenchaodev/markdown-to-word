/**
 * 合并总目录增强(固化既有单 pass 合并通路行为,无需新增代码):
 * - 合并多文件后单次 convert 产出「总目录」覆盖所有源文件标题(docx + pdf 双格式断言)
 * - 跨文件页码准确:field 模式两遍法对合并产物注入的页码随文档顺序单调,
 *   且后文件(经 page-break 起新页)标题页码严格大于前文件(PDF)
 * 复用 mergeMarkdowns → convert 一次;TOC 覆盖与页码由既有机制保障,本段防止回归。
 */
import { convert } from "../../dist/core/convert.js";
import { mergeMarkdowns } from "../../dist/core/pipeline/merge.js";
import { extractHeadings, injectTocPageNumbers } from "../../dist/core/pdf/postprocess.js";
import { pageNumbersForNames } from "../../dist/core/pdf/bookmarks.js";
import { unzipPart } from "../common/docx-utils.js";
import { PDFDocument } from "pdf-lib";
import { htmlToPdf } from "../common/pdf-utils.js";
import { FIXTURES_DIR } from "../common/paths.js";

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
export const fixtures = { main: fileA + "\n\n" + fileB };

const A_TITLES = ["第一章 A", "1.1 A 小节一", "第二章 A", "2.1 A 小节二"];
const B_TITLES = ["第三章 B", "3.1 B 小节一", "第四章 B", "4.1 B 小节二"];
const ALL_TITLES = [...A_TITLES, ...B_TITLES];

export async function run() {
  const mergedMd = mergeMarkdowns([
    { content: fileA, baseDir: FIXTURES_DIR },
    { content: fileB, baseDir: FIXTURES_DIR },
  ]);
  if (!mergedMd.includes("page-break")) {
    throw new Error("F8 断言失败:合并未插入文件间分页符(跨文件页码断言前提)");
  }

  // docx:合并产物含总目录且覆盖两个文件全部标题
  const docx = await convert(mergedMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], toc: true });
  const docXml = await unzipPart(docx.buffer, "word/document.xml");
  if (!docXml.includes("TOC")) throw new Error("F8 断言失败:合并 docx 缺少 TOC 指令");
  for (const t of ALL_TITLES) {
    if (!docXml.includes(t)) throw new Error(`F8 断言失败:合并 docx 总目录/正文缺少标题「${t}」`);
  }
  console.log("[ok] 合并 docx 总目录覆盖全部源文件标题(A+B 共 8) 断言通过");

  // pdf:合并产物总目录(artifact.html)覆盖两个文件全部标题
  const pdfArt = await convert(mergedMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "F8 合并",
    warnings: [],
    toc: true,
    tocMode: "field",
  });
  if (!pdfArt.html.includes('class="toc"')) throw new Error("F8 断言失败:合并 pdf 缺少总目录");
  for (const t of ALL_TITLES) {
    if (!pdfArt.html.includes(t)) throw new Error(`F8 断言失败:合并 pdf 总目录/正文缺少标题「${t}」`);
  }
  console.log("[ok] 合并 pdf 总目录覆盖全部源文件标题(A+B 共 8) 断言通过");

  // 跨文件页码准确:field 两遍法对合并产物注入页码随文档顺序单调,且 B 页码 > A 页码
  const headings = extractHeadings(pdfArt.html);
  const pass1 = await htmlToPdf(pdfArt.html, pdfArt.footerTemplate);
  const pdfDoc = await PDFDocument.load(new Uint8Array(pass1));
  const pageNumbers = pageNumbersForNames(
    pdfDoc,
    headings.map((h) => h.id),
  );
  // 文档顺序标题 → 页码,校验单调非降
  const ordered = headings.map((h) => ({ text: h.text, page: pageNumbers[h.id] }));
  let prev = 0;
  for (const o of ordered) {
    if (o.page == null) throw new Error(`F8 断言失败:合并标题「${o.text}」未解析到页码`);
    if (o.page < prev) throw new Error("F8 断言失败:合并页码未随文档顺序单调非降");
    prev = o.page;
  }
  // 跨文件:B 文件首个标题页码应严格大于 A 文件末个标题页码(page-break 起新页)
  const aPages = A_TITLES.map((t) => ordered.find((o) => o.text === t).page);
  const bPages = B_TITLES.map((t) => ordered.find((o) => o.text === t).page);
  const maxA = Math.max(...aPages);
  const minB = Math.min(...bPages);
  if (!(minB > maxA)) {
    throw new Error(`F8 断言失败:跨文件页码顺序错误(A 最大页 ${maxA} 应 < B 最小页 ${minB})`);
  }
  const injected = injectTocPageNumbers(pdfArt.html, pageNumbers);
  if (!injected.includes('<span class="toc-page">')) {
    throw new Error("F8 断言失败:合并页码未注入 .toc-page");
  }
  console.log("[ok] 合并 PDF 跨文件页码准确(A<B)且已注入 断言通过");
}
