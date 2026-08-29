/**
 * 封面元数据覆盖测试:convert 的 context.metadata 优先于 frontmatter 解析出的
 * metadata。向导「封面」步即经此通道传入显式元数据,覆盖首文件 frontmatter。
 * - 给定 frontmatter title 与 context.metadata.title 不同 → 产物封面用 metadata.title;
 * - 不传 metadata → 回落 frontmatter(既有行为不变)。
 */
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../common/docx-utils.js";
import { FIXTURES_DIR } from "../common/paths.js";

const md = `---
title: frontmatter标题
author: frontmatter作者
date: 2026-01-01
---

# 正文标题

正文内容。
`;

export async function run() {
  // 断言 1:context.metadata 覆盖 frontmatter(docx)
  const docx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    metadata: { title: "向导标题", author: "向导作者", date: "2026-09-09" },
  });
  const document = await unzipPart(docx.buffer, "word/document.xml");
  if (!document.includes("向导标题")) throw new Error("docx 封面应显示 metadata.title=向导标题");
  if (!document.includes("向导作者")) throw new Error("docx 封面应显示 metadata.author=向导作者");
  if (document.includes("frontmatter标题")) {
    throw new Error("docx 封面不应显示 frontmatter title(被 metadata 覆盖)");
  }
  console.log("[ok] docx:context.metadata 覆盖 frontmatter 封面");

  // 断言 2:context.metadata 覆盖 frontmatter(pdf)
  const pdf = await convert(md, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    metadata: { title: "向导标题", author: "向导作者", date: "2026-09-09" },
  });
  if (!pdf.html.includes('<div class="cover-title">向导标题</div>')) {
    throw new Error("PDF 封面应显示 metadata.title=向导标题");
  }
  if (pdf.html.includes("frontmatter标题")) {
    throw new Error("PDF 封面不应显示 frontmatter title(被 metadata 覆盖)");
  }
  console.log("[ok] PDF:context.metadata 覆盖 frontmatter 封面");

  // 断言 3(回归):不传 metadata → 回落 frontmatter
  const docxFb = await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const docFb = await unzipPart(docxFb.buffer, "word/document.xml");
  if (!docFb.includes("frontmatter标题")) {
    throw new Error("不传 metadata 时应回落 frontmatter title");
  }
  console.log("[ok] 回归:不传 metadata 时回落 frontmatter");
}
