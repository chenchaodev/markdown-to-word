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

/** 主样例:括号 URL 合并输出(mergeMarkdowns 运行值;真实合并验收样例为 manual/ 目录
 *  多文件,见段头注释),gen-fixtures 落盘为 acceptance/merge.md */
const bracketMd = mergeMarkdowns([
  { content: "![a](https://example.com/a(b).png)\n\n![b](./my(1).png)", baseDir: FIXTURES_DIR },
]);
export const fixtures = { main: bracketMd };

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
  // 图片 file:// 改写守卫(P0 反斜杠修复 392fca1 的纯逻辑层防线):
  // overrideImageRule(pdf/render.ts)渲染期将本地图片统一改写为 file:// 绝对路径
  // (pathToFileURL 输出正斜杠;http(s)/data: 保留原样;改写发生在渲染期、与文件
  // 存在性无关,故 missing.png 故意缺失不影响 src 形态)。win32 下反斜杠路径若被
  // markdown-it 链接规范化编码为 %5C,Chromium 无法加载 → 断言 file:// src 无 %5C
  // 且均以 file:/// 开头。
  const fileImageSrcs = [...mergedArtifact.html.matchAll(/src="file:\/\/\/[^"]*"/g)].map((m) => m[0]);
  if (fileImageSrcs.length === 0) {
    throw new Error("merge 断言失败:合并 PDF 中间 HTML 无 file:// 图片 src");
  }
  for (const src of fileImageSrcs) {
    if (!src.startsWith('src="file:///')) {
      throw new Error(`merge 断言失败:file:// 图片 src 应以 file:/// 开头:${src}`);
    }
    if (src.includes("%5C")) {
      throw new Error(`merge 断言失败:file:// 图片 src 含 %5C(反斜杠编码 bug 形态):${src}`);
    }
  }
  console.log(`[ok] merge:file:// 图片 src 全部 file:/// 开头且无 %5C(共 ${fileImageSrcs.length} 处)`);
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
  if (!bracketMd.includes("https://example.com/a(b).png")) {
    throw new Error(`merge 断言失败:含括号的绝对 URL 应原样保留,实际输出:\n${bracketMd}`);
  }
  // 修复(P0):win32 反斜杠绝对路径会被 markdown-it 链接规范化编码(%5C)导致图片不显示,
  // absolutizeImages 统一输出正斜杠绝对路径 → 期望值同步转正斜杠
  const expectAbs = path.resolve(FIXTURES_DIR, "my(1).png").replace(/\\/g, "/");
  if (!bracketMd.includes(expectAbs)) {
    throw new Error(`merge 断言失败:含括号的相对路径应转为正斜杠绝对路径(期望包含 ${expectAbs}),实际输出:\n${bracketMd}`);
  }
  if (!path.isAbsolute(expectAbs)) {
    throw new Error("merge 断言失败:期望的绝对路径构造无效");
  }
  console.log("[ok] merge:括号配对 URL(绝对原样保留/相对转绝对)断言通过");

  // ---------- G8 补齐:空文件跳过(merge.ts:39) ----------
  // 依据(dist/core/merge.ts):text.trim() 后为空 → return 跳过,不产生空段;
  // 空文件夹在中间不产生多余分页符;全空输入 → 空串。
  const mergedWithEmpty = mergeMarkdowns([
    { content: "# 甲", baseDir: FIXTURES_DIR },
    { content: "   \n\n  ", baseDir: FIXTURES_DIR },
    { content: "# 乙", baseDir: FIXTURES_DIR },
  ]);
  if (mergedWithEmpty !== "# 甲\n\n<!-- page-break -->\n\n# 乙") {
    throw new Error(`merge 断言失败:空文件应跳过不产生空段,实际输出:\n${JSON.stringify(mergedWithEmpty)}`);
  }
  if (mergeMarkdowns([{ content: "  \n", baseDir: FIXTURES_DIR }, { content: "", baseDir: FIXTURES_DIR }]) !== "") {
    throw new Error("merge 断言失败:全空输入应返回空串");
  }
  console.log("[ok] merge:空文件跳过(不产生空段/多余分页符,全空 → 空串)断言通过");
}
