/**
 * PDF 章节编号 + 元数据验收(原 make-batch4-sample.mjs 段 4,独立化):
 * 自建小 md(frontmatter title/author 沿用原样例,正文仅需触发 h1 + 分页)→ pdf;
 * 断言章节编号 counter CSS;setPdfMetadata 后 PDFDocument 回读 title/author 一致。
 * 本段不落盘产物(与原段 4 一致)。
 */
import { convert } from "../../dist/core/convert.js";
import { setPdfMetadata } from "../../dist/core/pdf/metadata.js";
import { PDFDocument } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { htmlToPdf } from "../common/pdf-utils.js";

/** 主样例:frontmatter 元数据 + 章节编号 + 分页(gen-fixtures 落盘为 acceptance/pdf-meta.md) */
const pdfMetaMd = `---
title: 脚注与页眉页脚验收
author: 测试
date: 2026-08-05
---

# 章节编号测试

正文。

<!-- page-break -->

## 第二页小节
`;
export const fixtures = { main: pdfMetaMd };

/** PDF 章节编号 + 元数据验收(批次 5c) */
export async function run() {
  const pdfArtifact = await convert(pdfMetaMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "脚注与页眉页脚验收",
    warnings: [],
  });
  // 章节编号:CSS counter 规则(::before 伪元素,1/1.1/1.1.1)进入模板样式
  if (!pdfArtifact.html.includes("counter(h1c)") || !pdfArtifact.html.includes("h1::before")) {
    throw new Error("PDF 章节编号断言失败:缺少 counter 编号 CSS");
  }
  console.log("[ok] PDF 章节编号:counter CSS 存在(1/1.1/1.1.1)");
  // 元数据:frontmatter title/author/date → PDF Info(读回验证)
  const pdf = await htmlToPdf(pdfArtifact.html, pdfArtifact.footerTemplate);
  const pdfWithMeta = await setPdfMetadata(new Uint8Array(pdf), pdfArtifact.metadata);
  const pdfDoc = await PDFDocument.load(pdfWithMeta);
  const pdfTitle = pdfDoc.getTitle();
  const pdfAuthor = pdfDoc.getAuthor();
  if (pdfTitle !== "脚注与页眉页脚验收" || pdfAuthor !== "测试") {
    throw new Error(`PDF 元数据断言失败: title=${pdfTitle} author=${pdfAuthor}`);
  }
  console.log(`[ok] PDF 元数据:title="${pdfTitle}" author="${pdfAuthor}" 读回一致`);
}
