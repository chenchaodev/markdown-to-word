/**
 * 脚注 + 页眉页脚验收(原 make-batch4-sample.mjs 段 2):
 * 脚注 md → docx/pdf;断言 footnotes/footer/header 部件与 PDF 脚注区结构;
 * PDF 侧走 printToPDF → setPdfMetadata 全链路(与主进程 renderPdf 对齐)。
 */
import { convert } from "../../../dist/core/convert.js";
import { setPdfMetadata } from "../../../dist/core/pdf/metadata.js";
import { PDFDocument } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { zipContains } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 脚注 + 页眉页脚验收(批次 4 第二/三项) */
export async function run() {
  // 重复引用 [^1] 两次:docx 侧应生成两个独立脚注 id(与 markdown-it 编号语义对齐)
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
