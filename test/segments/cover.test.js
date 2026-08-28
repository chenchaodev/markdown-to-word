/**
 * 封面页测试(双格式,新段):
 * docx:renderCoverPage(dist/core/docx/render.js)——frontmatter metadata.title 存在时
 * 置于文档最前:标题 44 half-points(=22pt,docx 库 size 单位为 half-points)居中加粗
 * (<w:sz w:val="44"/> + <w:b/> + <w:jc w:val="center"/>),author/date 居中灰字
 * (<w:sz w:val="22"/> + <w:color w:val="808080"/>),末尾 PageBreak 独占一页。
 * pdf:buildCoverHtml(dist/core/pdf/template.js)——class="cover" 容器 + cover-title
 * (CSS 精确值 font-size: 28pt; font-weight: 700)+ cover-meta(author · date 灰字,
 * font-size: 12pt; color: #888;),末尾 page-break div 复用分页样式。
 * 触发条件:仅 frontmatter(parseFrontmatter 的 metadata.title);context.title 不触发
 * (convert.js 对 docx/pdf 均只传 options.metadata)。无 frontmatter → 双格式无封面。
 */
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { FIXTURES_DIR } from "../common/paths.js";

/** 主样例:frontmatter 封面验收(gen-fixtures 落盘为 acceptance/cover.md) */
const coverMd = `---
title: 封面验收文档
author: 测试作者
date: 2026-08-10
---

# 正文标题

这是封面验收文档的正文内容。
`;
export const fixtures = { main: coverMd };

export async function run() {
  const coverDocx = await convert(coverMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const coverDocument = await unzipPart(coverDocx.buffer, "word/document.xml");
  // 断言 1:封面标题居中加粗 22pt(44 half-points,docx 库 size = pt × 2)
  for (const [needle, label] of [
    ['<w:sz w:val="44"/>', "标题字号 44(22pt)"],
    ["<w:b/>", "标题加粗"],
    ['<w:jc w:val="center"/>', "标题居中对齐"],
    ["封面验收文档", "标题文本"],
  ]) {
    if (!coverDocument.includes(needle)) throw new Error(`封面断言失败:document.xml 缺少 ${label}(${needle})`);
  }
  // 断言 2:author/date 居中灰字(22 half-points = 11pt,color 808080)
  for (const [needle, label] of [
    ['<w:color w:val="808080"/>', "author/date 灰色"],
    ['<w:sz w:val="22"/>', "author/date 字号 22(11pt)"],
    ["测试作者", "author 文本"],
    ["2026-08-10", "date 文本"],
  ]) {
    if (!coverDocument.includes(needle)) throw new Error(`封面断言失败:document.xml 缺少 ${label}(${needle})`);
  }
  // 断言 3:封面末尾显式分页(w:br w:type="page")独占一页
  if (!coverDocument.includes('w:type="page"')) {
    throw new Error("封面断言失败:document.xml 缺少封面后分页符(w:br w:type=page)");
  }
  console.log("[ok] docx 封面:标题 44/加粗/居中 + author/date 灰字 + 分页符 断言通过");

  const coverPdf = await convert(coverMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  // 断言 4:cover HTML 结构 + author/date 行(metaLine = [author, date].join(" · "))
  if (!coverPdf.html.includes('<div class="cover">')) {
    throw new Error('封面断言失败:PDF 缺少 class="cover" 容器');
  }
  if (!coverPdf.html.includes('<div class="cover-title">封面验收文档</div>')) {
    throw new Error("封面断言失败:PDF 缺少 cover-title 标题结构");
  }
  if (!coverPdf.html.includes('<div class="cover-meta">测试作者 · 2026-08-10</div>')) {
    throw new Error("封面断言失败:PDF 缺少 cover-meta(author · date)行");
  }
  // 断言 5:封面 CSS 精确值(28pt 标题 / 灰字 meta / 顶部留白)
  for (const [needle, label] of [
    [".cover-title { font-size: 28pt", "cover-title 28pt 字号"],
    [".cover-meta { font-size: 12pt; color: #888;", "cover-meta 12pt 灰字"],
    [".cover { text-align: center; padding-top: 80mm;", ".cover 居中 + 顶部留白"],
  ]) {
    if (!coverPdf.html.includes(needle)) throw new Error(`封面断言失败:PDF CSS 缺少 ${label}(${needle})`);
  }
  console.log("[ok] PDF 封面:cover/cover-title/cover-meta 结构 + CSS 精确值 断言通过");

  // 断言 6(反例):无 frontmatter 时双格式均不产出封面(context.title 不触发封面)。
  // 注意:封面标记用 author/date 灰字(808080)+ 作者文本——不可用 w:sz=44 判别,
  // 正文 h1(standard 档 22pt)同样产出 44 half-points 的标题 run
  const noCoverMd = "# 无封面标题\n\n正文内容。";
  const noCoverDocx = await convert(noCoverMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const noCoverDocument = await unzipPart(noCoverDocx.buffer, "word/document.xml");
  if (noCoverDocument.includes('<w:color w:val="808080"/>') || noCoverDocument.includes("测试作者")) {
    throw new Error("封面断言失败:无 frontmatter 时 docx 不应产出封面(作者灰字/作者文本)");
  }
  const noCoverPdf = await convert(noCoverMd, "pdf", { title: "无封面标题", baseDir: FIXTURES_DIR, warnings: [] });
  if (noCoverPdf.html.includes('class="cover"')) {
    throw new Error("封面断言失败:无 frontmatter 时 PDF 不应产出封面(class=cover)");
  }
  console.log("[ok] 封面反例:无 frontmatter 双格式均无封面(context.title 不触发)");

  const coverPdfBin = await htmlToPdf(coverPdf.html, coverPdf.footerTemplate);
  await saveArtifact("cover", { docx: coverDocx.buffer, pdf: coverPdfBin });
}
