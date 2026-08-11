/**
 * 合并段:FIXTURES_DIR/manual 全部 .md(含 chapters/ 子目录)→ 合并 → PDF → 书签注入 + 元数据。
 * 来源:scripts/make-batch4-sample.mjs 第 92-110 行「段 1」行为等价复制
 * (collectMarkdown 递归收集;convert baseDir 用 manual 目录,10-附录.md 引用的
 * images/missing.png 故意缺失;extractHeadings 原仅 log,补 headings.length > 0 断言)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../dist/core/convert.js";
import { mergeMarkdowns } from "../../dist/core/merge.js";
import { injectBookmarks, buildBookmarkTree } from "../../dist/core/pdf/bookmarks.js";
import { setPdfMetadata } from "../../dist/core/pdf/metadata.js";
import { extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { PDFDocument } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 递归收集目录下全部 .md(含子目录) */
async function collectMarkdown(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(full)));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

export async function run() {
  const manualDir = path.join(FIXTURES_DIR, "manual");
  const mdFiles = (await collectMarkdown(manualDir)).sort((a, b) => a.localeCompare(b));
  const inputs = await Promise.all(
    mdFiles.map(async (f) => ({ content: await fs.readFile(f, "utf8"), baseDir: path.dirname(f) })),
  );
  const mergedMd = mergeMarkdowns(inputs);
  const mergedArtifact = await convert(mergedMd, "pdf", {
    baseDir: manualDir,
    title: "产品白皮书",
    warnings: [],
    pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
  });
  const mergedPdf = await htmlToPdf(mergedArtifact.html, mergedArtifact.footerTemplate);
  const headings = extractHeadings(mergedArtifact.html);
  if (headings.length === 0) {
    throw new Error("merge 断言失败:合并 PDF 未提取到任何标题(书签注入无内容)");
  }
  const bookmarked = await injectBookmarks(new Uint8Array(mergedPdf), buildBookmarkTree(headings));
  const finalPdf = await setPdfMetadata(bookmarked, mergedArtifact.metadata);
  console.log(`[ok] merge:合并 ${mdFiles.length} 文件,提取标题 ${headings.length} 条,书签注入完成`);
  await saveArtifact("merged-manual", { pdf: finalPdf });

  // 括号配对 URL(修复 M1):绝对 URL 含括号原样保留;相对路径含括号转绝对路径且括号保留
  const bracketMd = mergeMarkdowns([
    { content: "![a](https://example.com/a(b).png)\n\n![b](./my(1).png)", baseDir: FIXTURES_DIR },
  ]);
  if (!bracketMd.includes("https://example.com/a(b).png")) {
    throw new Error(`merge 断言失败:含括号的绝对 URL 应原样保留,实际输出:\n${bracketMd}`);
  }
  const expectAbs = path.resolve(FIXTURES_DIR, "my(1).png");
  if (!bracketMd.includes(expectAbs)) {
    throw new Error(`merge 断言失败:含括号的相对路径应转为绝对路径(期望包含 ${expectAbs}),实际输出:\n${bracketMd}`);
  }
  if (!path.isAbsolute(expectAbs)) {
    throw new Error("merge 断言失败:期望的绝对路径构造无效");
  }
  console.log("[ok] merge:括号配对 URL(绝对原样保留/相对转绝对)断言通过");
}
