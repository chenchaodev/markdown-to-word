/**
 * PDF 章节编号 + 元数据验收:
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

/** PDF 章节编号 + 元数据验收 */
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

  // ---------- 无元数据原样返回(metadata.ts) ----------
  // 依据(dist/core/pdf/metadata.ts):metadata 缺省或空对象无 title/author/date
  // 均直接返回原 bytes(引用不变,不重存)。
  const passthroughUndef = await setPdfMetadata(pdf, undefined);
  if (passthroughUndef !== pdf) {
    throw new Error("PDF 元数据断言失败:metadata 缺省时应原样返回原 bytes(引用不变)");
  }
  const passthroughEmpty = await setPdfMetadata(pdf, {});
  if (passthroughEmpty !== pdf) {
    throw new Error("PDF 元数据断言失败:空 metadata(无 title/author/date)时应原样返回原 bytes");
  }
  console.log("[ok] PDF 元数据:无元数据(缺省/空对象)原样返回,断言通过");

  // ---------- date 解析失败不再静默兜底当前时间 ----------
  // 仅不可解析 date(无 title/author)→ 不注入任何字段,原样返回(此前会以当前时间
  // 兜底创建/修改时间,误导归档检索);title + 坏 date → title 注入、日期保持原值。
  const badDateOnly = await setPdfMetadata(pdf, { date: "不是日期" });
  if (badDateOnly !== pdf) {
    throw new Error("PDF 元数据断言失败:仅坏 date 应原样返回(不得以当前时间兜底)");
  }
  const badDateWithTitle = await setPdfMetadata(pdf, { title: "坏日期文档", date: "2026/13/99" });
  const badDateDoc = await PDFDocument.load(badDateWithTitle);
  if (badDateDoc.getTitle() !== "坏日期文档") {
    throw new Error("PDF 元数据断言失败:title + 坏 date 时 title 应正常注入");
  }
  // 创建时间应与原始产物一致(Chromium 自带的 CreationDate 不被覆盖为新时间)
  const origCreated = (await PDFDocument.load(pdf)).getCreationDate();
  const afterCreated = badDateDoc.getCreationDate();
  const same =
    (origCreated === undefined && afterCreated === undefined) ||
    (origCreated !== undefined &&
      afterCreated !== undefined &&
      origCreated.getTime() === afterCreated.getTime());
  if (!same) {
    throw new Error("PDF 元数据断言失败:坏 date 不应改变创建时间(B3)");
  }
  console.log("[ok] PDF 元数据:date 解析失败不兜底当前时间(B3),title 照常注入");
}
