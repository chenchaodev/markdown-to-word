// @ts-check
/**
 * PDF 章节编号 + 元数据验收:
 * 自建小 md(frontmatter title/author 沿用原样例,正文仅需触发 h1 + 分页)→ pdf;
 * 断言章节编号 counter CSS;setPdfMetadata 后 PDFDocument 回读 title/author/keywords 一致,
 * 且「书签 → 元数据」顺序下书签未丢。
 * 本段不落盘产物(与原段 4 一致)。
 */
import { setPdfMetadata } from "../../dist/core/pdf/metadata.js";
import { parseFrontmatter } from "../../dist/core/pipeline/frontmatter.js";
import { buildBookmarkTree, injectBookmarks } from "../../dist/core/pdf/bookmarks.js";
import { extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { FIXTURES_DIR } from "../harness/paths.js";
import { htmlToPdf } from "../harness/pdf-utils.js";
import { asPdfArtifact, convertWithFs } from "../harness/convert-helpers.js";
import { createCaseSuite } from "../harness/case.js";

/** 主样例:frontmatter 元数据 + 章节编号 + 分页(gen-fixtures 落盘为 docs/pdf-meta.md) */
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
export const meta = { description: "PDF 章节编号 + 元数据验收:" };
export const fixtures = { main: pdfMetaMd };

/** PDF 章节编号 + 元数据验收 */
export async function run() {
  const pdfArtifact = asPdfArtifact(
    await convertWithFs(pdfMetaMd, "pdf", {
      baseDir: FIXTURES_DIR,
      title: "脚注与页眉页脚验收",
      warnings: [],
    }),
  );
  const suite = createCaseSuite();
  // 章节编号:CSS counter 规则(::before 伪元素,1/1.1/1.1.1)进入模板样式
  await suite.case("PDF 章节编号 counter CSS 存在(1/1.1/1.1.1)", () => {
    if (!pdfArtifact.html.includes("counter(h1c)") || !pdfArtifact.html.includes("h1::before")) {
      throw new Error("PDF 章节编号断言失败:缺少 counter 编号 CSS");
    }
  });
  console.log("[ok] PDF 章节编号:counter CSS 存在(1/1.1/1.1.1)");

  // 元数据:frontmatter title/author/date → PDF Info(读回验证)
  const pdf = await htmlToPdf(pdfArtifact.html, pdfArtifact.footerTemplate);
  // 坏 date 那两条共用同一份回读文档,取数留在 case 之外:
  // 「title 有没有被注入」与「创建时间有没有被改」是同一处改动的两面
  const badDateWithTitle = await setPdfMetadata(pdf, { title: "坏日期文档", date: "2026/13/99" });
  const badDateDoc = await PDFDocument.load(badDateWithTitle);

  await suite.case("PDF Info 的 title/author 与 frontmatter 一致(读回验证)", async () => {
    const pdfWithMeta = await setPdfMetadata(new Uint8Array(pdf), pdfArtifact.metadata);
    const pdfDoc = await PDFDocument.load(pdfWithMeta);
    const pdfTitle = pdfDoc.getTitle();
    const pdfAuthor = pdfDoc.getAuthor();
    if (pdfTitle !== "脚注与页眉页脚验收" || pdfAuthor !== "测试") {
      throw new Error(`PDF 元数据断言失败: title=${pdfTitle} author=${pdfAuthor}`);
    }
  });
  // 打印逐字沿用原样(打印的是读回值,不是入参;取数在 case 内,故此处不重复回读)
  console.log('[ok] PDF 元数据:title="脚注与页眉页脚验收" author="测试" 读回一致');

  // 关键词:frontmatter 单值 → pdf-lib setKeywords([...]) → Info /Keywords 原样读回。
  // 不走 pdfMetaMd 夹具:夹具内容与 samples/docs/pdf-meta.md 绑定(改夹具要重生成样例),
  // 故此处以同一解析入口(frontmatter.ts)喂一份带 keywords 的最小源,断言解析值与读回一致。
  await suite.case("PDF Info 的 keywords 与 frontmatter 一致(读回验证)", async () => {
    const parsed = parseFrontmatter("---\ntitle: 关键词验收\nkeywords: 排版, 归档\n---\n正文");
    const pdfWithMeta = await setPdfMetadata(new Uint8Array(pdf), parsed.metadata);
    const pdfDoc = await PDFDocument.load(pdfWithMeta);
    const pdfKeywords = pdfDoc.getKeywords();
    if (!parsed.metadata.keywords || pdfKeywords !== parsed.metadata.keywords) {
      throw new Error(`PDF 元数据断言失败: keywords=${pdfKeywords}`);
    }
  });
  console.log('[ok] PDF 元数据:keywords="排版, 归档" 读回一致');

  // 回归:setPdfMetadata 经 pdf-lib 整体重存,调用方必须在其之前注入书签。
  // 本段按生产顺序(书签 → 元数据)走一遍,断言 Outlines 与首条 Dest 未丢。
  await suite.case("setPdfMetadata 重存后书签未丢(书签 → 元数据的生产顺序)", async () => {
    const headings = extractHeadings(pdfArtifact.html);
    if (headings.length === 0) throw new Error("PDF 元数据断言失败:未提取到标题,书签回归前提不成立");
    const bookmarked = await injectBookmarks(new Uint8Array(pdf), buildBookmarkTree(headings));
    const withMeta = await setPdfMetadata(bookmarked, pdfArtifact.metadata);
    const doc = await PDFDocument.load(withMeta);
    const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
    if (!outlinesRef) throw new Error("PDF 元数据断言失败:重存后 Outlines 大纲丢失");
    const outlinesDict = doc.context.lookup(outlinesRef, PDFDict);
    const firstRef = outlinesDict?.get(PDFName.of("First"));
    if (!firstRef) throw new Error("PDF 元数据断言失败:重存后大纲缺少 First 条目");
    const firstDict = doc.context.lookup(firstRef, PDFDict);
    const dest = firstDict?.get(PDFName.of("Dest"));
    if (!(dest instanceof PDFArray) || !(dest.asArray()[0] instanceof PDFRef)) {
      throw new Error(`PDF 元数据断言失败:重存后书签 Dest 异常: ${dest?.toString()}`);
    }
  });
  console.log("[ok] PDF 元数据:书签经 pdf-lib 重存后仍在(Outlines + Dest 页面引用)");

  // ---------- 无元数据原样返回(metadata.ts) ----------
  // 依据(dist/core/pdf/metadata.ts):metadata 缺省或空对象无 title/author/date
  // 均直接返回原 bytes(引用不变,不重存)。
  await suite.case("metadata 缺省时原样返回原 bytes(引用不变)", async () => {
    const passthroughUndef = await setPdfMetadata(pdf, undefined);
    if (passthroughUndef !== pdf) {
      throw new Error("PDF 元数据断言失败:metadata 缺省时应原样返回原 bytes(引用不变)");
    }
  });
  await suite.case("空 metadata(无 title/author/date)时原样返回原 bytes", async () => {
    const passthroughEmpty = await setPdfMetadata(pdf, {});
    if (passthroughEmpty !== pdf) {
      throw new Error("PDF 元数据断言失败:空 metadata(无 title/author/date)时应原样返回原 bytes");
    }
  });
  console.log("[ok] PDF 元数据:无元数据(缺省/空对象)原样返回,断言通过");

  // ---------- date 解析失败不再静默兜底当前时间 ----------
  // 仅不可解析 date(无 title/author)→ 不注入任何字段,原样返回(此前会以当前时间
  // 兜底创建/修改时间,误导归档检索);title + 坏 date → title 注入、日期保持原值。
  await suite.case("仅坏 date 时原样返回(不得以当前时间兜底)", async () => {
    const badDateOnly = await setPdfMetadata(pdf, { date: "不是日期" });
    if (badDateOnly !== pdf) {
      throw new Error("PDF 元数据断言失败:仅坏 date 应原样返回(不得以当前时间兜底)");
    }
  });
  await suite.case("title + 坏 date 时 title 照常注入", () => {
    if (badDateDoc.getTitle() !== "坏日期文档") {
      throw new Error("PDF 元数据断言失败:title + 坏 date 时 title 应正常注入");
    }
  });
  // 创建时间应与原始产物一致(Chromium 自带的 CreationDate 不被覆盖为新时间)
  await suite.case("坏 date 不改变创建时间", async () => {
    const origCreated = (await PDFDocument.load(pdf)).getCreationDate();
    const afterCreated = badDateDoc.getCreationDate();
    const same =
      (origCreated === undefined && afterCreated === undefined) ||
      (origCreated !== undefined &&
        afterCreated !== undefined &&
        origCreated.getTime() === afterCreated.getTime());
    if (!same) {
      throw new Error("PDF 元数据断言失败:坏 date 不应改变创建时间");
    }
  });
  console.log("[ok] PDF 元数据:date 解析失败不兜底当前时间,title 照常注入");
  return { cases: suite.results };
}
