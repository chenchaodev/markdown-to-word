/**
 * 脚注 + 页眉页脚验收(原 make-batch4-sample.mjs 段 2,补页眉/页脚内容断言):
 * 脚注 md → docx/pdf;断言 footnotes/footer/header 部件存在 + 页眉标题
 * (居中 7pt 灰 888888)/页脚页码域(PAGE/NUMPAGES)内容,PDF 侧断言脚注区
 * 结构与 setPdfMetadata 回读;PDF 走 printToPDF → setPdfMetadata 全链路。
 */
import { convert } from "../../dist/core/convert.js";
import { setPdfMetadata } from "../../dist/core/pdf/metadata.js";
import { PDFDocument } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { zipContains, unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 主样例:脚注 + 页眉页脚(frontmatter 触发页眉;重复引用 [^1] 两次 → 独立脚注 id;
 *  多段脚注定义),gen-fixtures 落盘为 acceptance/footnotes.md */
const footnoteMd = `---
title: 脚注与页眉页脚验收
author: 测试
date: 2026-08-05
---

# 脚注测试

正文第一句带脚注[^1],随后再次引用同一脚注[^1],并新增第二个脚注[^2]。

## 二级章节

脚注定义支持多段,详见脚注内容。

[^1]: 第一个脚注内容。

    脚注第一段后的续段(缩进续写)。

[^2]: 第二个脚注,中文内容。
`;
export const fixtures = { main: footnoteMd };

/** 脚注 + 页眉页脚验收(批次 4 第二/三项) */
export async function run() {
  const docxArtifact = await convert(footnoteMd, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
  });
  // docx 断言:footnotes.xml / footer1.xml 必须存在(metadata.title 存在 → header1.xml 也应存在)
  const docxOk = zipContains(docxArtifact.buffer, "word/footnotes.xml");
  const footerOk = zipContains(docxArtifact.buffer, "word/footer1.xml");
  const headerOk = zipContains(docxArtifact.buffer, "word/header1.xml");
  if (!docxOk || !footerOk || !headerOk) {
    throw new Error(
      `docx 部件断言失败: footnotes=${docxOk} footer=${footerOk} header=${headerOk}`,
    );
  }
  console.log("[ok] docx 脚注/页眉页脚:footnotes.xml、footer1.xml、header1.xml 均存在");

  // B3:重复引用共享同一脚注(样例 [^1] 引用两次 + [^2] 一次 = 3 个引用):
  // 正文恰 3 个 footnoteReference;footnotes.xml 恰 2 条内容脚注(id 1/2,无 id 3)
  const footnotesXml = await unzipPart(docxArtifact.buffer, "word/footnotes.xml");
  const refCount = ((await unzipPart(docxArtifact.buffer, "word/document.xml")).match(/<w:footnoteReference /g) || []).length;
  if (refCount !== 3) {
    throw new Error(`B3 脚注共享断言失败:正文应有 3 个脚注引用(1+1+1),实际 ${refCount}`);
  }
  if (!footnotesXml.includes('w:id="1"') || !footnotesXml.includes('w:id="2"')) {
    throw new Error("B3 脚注共享断言失败:应存在内容脚注 id 1/2");
  }
  if (footnotesXml.includes('w:id="3"')) {
    throw new Error("B3 脚注共享断言失败:重复引用不得产生第三条脚注(应共享 id)");
  }
  console.log("[ok] B3 脚注共享:[^1] 重复引用 → 正文 3 引用、脚注区仅 2 条内容脚注");

  // 页眉内容断言(renderHeader 实现事实:标题文本居中 + 7pt(14 half-points)灰 888888;
  // 标题取 metadata.title 优先,样例 frontmatter title=「脚注与页眉页脚验收」)
  const headerXml = await unzipPart(docxArtifact.buffer, "word/header1.xml");
  if (!headerXml.includes("脚注与页眉页脚验收")) {
    throw new Error("页眉断言失败:header1.xml 缺少标题文本");
  }
  if (!headerXml.includes('<w:jc w:val="center"/>')) {
    throw new Error("页眉断言失败:header1.xml 缺少居中对齐 w:jc center");
  }
  if (!headerXml.includes('<w:sz w:val="14"/>') || !headerXml.includes('<w:color w:val="888888"/>')) {
    throw new Error("页眉断言失败:header1.xml 缺少 7pt/灰 888888 字号颜色(14 half-points)");
  }
  console.log("[ok] 页眉:标题居中、7pt 灰(888888)渲染");

  // 页脚内容断言(renderFooter 实现事实:居中 + 「第 X 页 / 共 X 页」,
  // 页码为域结构 PAGE/NUMPAGES:fldChar begin + instrText + fldChar end)
  const footerXml = await unzipPart(docxArtifact.buffer, "word/footer1.xml");
  if (!footerXml.includes("第 ") || !footerXml.includes(" 页 / 共 ") || !footerXml.includes(" 页")) {
    throw new Error("页脚断言失败:footer1.xml 缺少「第 X 页 / 共 X 页」文案结构");
  }
  if (
    !footerXml.includes('<w:instrText xml:space="preserve">PAGE</w:instrText>') ||
    !footerXml.includes('<w:instrText xml:space="preserve">NUMPAGES</w:instrText>')
  ) {
    throw new Error("页脚断言失败:footer1.xml 缺少 PAGE/NUMPAGES 页码域指令");
  }
  if (!footerXml.includes('<w:jc w:val="center"/>')) {
    throw new Error("页脚断言失败:footer1.xml 缺少居中对齐 w:jc center");
  }
  console.log("[ok] 页脚:第 X 页 / 共 X 页(PAGE/NUMPAGES 域)居中渲染");

  const pdfArtifact = await convert(footnoteMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "脚注与页眉页脚验收",
    warnings: [],
  });
  // PDF 断言:脚注区结构(class="footnotes")与正文上标引用(footnote-ref)存在
  if (!pdfArtifact.html.includes('class="footnotes"') || !pdfArtifact.html.includes("footnote-ref")) {
    throw new Error("PDF 脚注结构断言失败:未找到 footnotes 区/上标引用");
  }
  console.log("[ok] PDF 脚注:footnotes 区与 footnote-ref 引用结构存在");
  const footnotePdf = await htmlToPdf(pdfArtifact.html, pdfArtifact.footerTemplate);
  // 批次 5c:与主进程 renderPdf 链路对齐(printToPDF → 书签 → 元数据注入)
  const footnotePdfMeta = await setPdfMetadata(new Uint8Array(footnotePdf), pdfArtifact.metadata);
  const pdfDoc = await PDFDocument.load(footnotePdfMeta);
  const pdfTitle = pdfDoc.getTitle();
  const pdfAuthor = pdfDoc.getAuthor();
  if (pdfTitle !== "脚注与页眉页脚验收" || pdfAuthor !== "测试") {
    throw new Error(`PDF 元数据断言失败: title=${pdfTitle} author=${pdfAuthor}`);
  }
  console.log(`[ok] PDF 元数据:title="${pdfTitle}" author="${pdfAuthor}" 读回一致`);
  await saveArtifact("footnotes", { docx: docxArtifact.buffer, pdf: footnotePdfMeta });
}
