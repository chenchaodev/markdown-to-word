/**
 * PDF 书签端到端(R8 批 4 A2;smoke 书签断言的独立化 + buildBookmarkTree 层级直测):
 * convert("pdf") 中间 html → htmlToPdf(printToPDF 链路,与主进程 renderPdf 对齐)
 * → extractHeadings + buildBookmarkTree → injectBookmarks → PDFDocument 回读:
 * Outlines 存在、中文标题(PDFHexString 解码)、Dest[0] 为页面 PDFRef(防「全部回退首页」回归)。
 */
import { convert } from "../../dist/core/convert.js";
import { buildBookmarkTree, injectBookmarks } from "../../dist/core/pdf/bookmarks.js";
import { extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { htmlToPdf } from "../common/pdf-utils.js";

/** 断言 PDF 大纲首条目:Title(中文)与 Dest[0] 页面 PDFRef(与 smoke assertOutline 同款) */
async function assertOutline(pdfBytes, expectedTitle, label) {
  const doc = await PDFDocument.load(pdfBytes);
  const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!outlinesRef) throw new Error(`${label} 缺少 Outlines 大纲`);
  const outlinesDict = doc.context.lookup(outlinesRef, PDFDict);
  if (!outlinesDict) throw new Error(`${label} Outlines 字典解析失败`);
  const firstRef = outlinesDict.get(PDFName.of("First"));
  if (!firstRef) throw new Error(`${label} 大纲缺少 First 条目`);
  const firstDict = doc.context.lookup(firstRef, PDFDict);
  const title = firstDict?.get(PDFName.of("Title"));
  if (!(title instanceof PDFHexString) || title.decodeText() !== expectedTitle) {
    throw new Error(`${label} 书签标题异常: ${title?.toString()}`);
  }
  // 回归:书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转,见批次 4 修复)
  const destArr = firstDict?.get(PDFName.of("Dest"));
  if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
    throw new Error(`${label} 书签 Dest 异常: ${destArr?.toString()}`);
  }
}

/** PDF 书签端到端验收 */
export async function run() {
  const md = `# 书签一级标题

正文一。

## 书签二级标题

正文二。

### 三级子节

正文三。

<!-- page-break -->

## 第二页小节

跨页小节。
`;
  const artifact = await convert(md, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "书签验收",
    warnings: [],
  });

  // 1. 提取 + 建树:三级标题 → 扁平列表 → 嵌套树(h1 顶层,h2/h3 挂最近上级)
  const headings = extractHeadings(artifact.html);
  if (headings.length !== 4) throw new Error(`extractHeadings 数量异常: ${headings.length}`);
  const tree = buildBookmarkTree(headings);
  if (tree.length !== 1 || tree[0].title !== "书签一级标题") throw new Error("书签树:h1 未作顶层");
  const second = tree[0].children?.[0];
  if (!second || second.title !== "书签二级标题") throw new Error("书签树:h2 未挂 h1 下");
  if (!second.children || second.children[0].title !== "三级子节") throw new Error("书签树:h3 未挂 h2 下");
  // 第二页小节与 h1 同级(层级回退),非 h2 的子树
  if (tree.length !== 1 || tree[0].children?.length !== 2) throw new Error("书签树:跨级后 h2 未回挂顶层");
  console.log("[ok] 书签树:多级标题嵌套 + 跨级回挂结构正确");

  // 2. 端到端:printToPDF 产物 → 注入 → 回读(中文标题 + Dest 页面引用)
  const pdf = await htmlToPdf(artifact.html, artifact.footerTemplate);
  const withBookmarks = await injectBookmarks(new Uint8Array(pdf), tree);
  await assertOutline(withBookmarks, "书签一级标题", "书签端到端");
  console.log("[ok] 书签端到端:Outlines 注入,中文标题 + Dest 页面引用正确");
}
