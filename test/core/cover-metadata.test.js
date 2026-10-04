// @ts-check
/**
 * 封面元数据覆盖测试:convert 的 context.metadata 优先于 frontmatter 解析出的
 * metadata。向导「封面」步即经此通道传入显式元数据,覆盖首文件 frontmatter。
 * - 给定 frontmatter title 与 context.metadata.title 不同 → 产物封面用 metadata.title;
 * - 不传 metadata → 回落 frontmatter(既有行为不变)。
 */
import { unzipPart } from "../harness/docx-utils.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,判据静态看不见本段的主体 —— 全链路经
 * `test/harness/convert-helpers.js` 的 `convertWithFs` 到达 core,段内零 core import。
 *
 * 主体依据(头注):头注写「convert 的 context.metadata 优先于 frontmatter 解析出的
 * metadata」—— 被守护的**那一个决定**是 core 的覆盖语义实现:`core/convert.ts` 里的
 * `const metadata = context.metadata ?? md.metadata`(其 ConvertContext.metadata 字段
 * 注释写「显式文档元数据(封面用);优先于阶段产物已解析出的 frontmatter metadata」)。
 * 封面渲染那两侧(`docx/chrome.ts` / `pdf/template.ts`)是本段的断言落点而非被测决定,
 * 覆盖它们的是 cover.test.js,故此处不重复声明。
 */
export const covers = ["src/core/convert.ts"];

const md = `---
title: frontmatter标题
author: frontmatter作者
date: 2026-01-01
---

# 正文标题

正文内容。
`;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // 断言 1:context.metadata 覆盖 frontmatter(docx)
  const docx = await convertWithFs(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    metadata: { title: "向导标题", author: "向导作者", date: "2026-09-09" },
  });
  const document = await unzipPart(docxBufferOf(docx), "word/document.xml");
  if (!document.includes("向导标题")) throw new Error("docx 封面应显示 metadata.title=向导标题");
  if (!document.includes("向导作者")) throw new Error("docx 封面应显示 metadata.author=向导作者");
  if (document.includes("frontmatter标题")) {
    throw new Error("docx 封面不应显示 frontmatter title(被 metadata 覆盖)");
  }
  console.log("[ok] docx:context.metadata 覆盖 frontmatter 封面");

  // 断言 2:context.metadata 覆盖 frontmatter(pdf)
  const pdf = asPdfArtifact(
    await convertWithFs(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      metadata: { title: "向导标题", author: "向导作者", date: "2026-09-09" },
    }),
  );
  if (!pdf.html.includes('<div class="cover-title">向导标题</div>')) {
    throw new Error("PDF 封面应显示 metadata.title=向导标题");
  }
  if (pdf.html.includes("frontmatter标题")) {
    throw new Error("PDF 封面不应显示 frontmatter title(被 metadata 覆盖)");
  }
  console.log("[ok] PDF:context.metadata 覆盖 frontmatter 封面");

  // 断言 3(回归):不传 metadata → 回落 frontmatter
  const docxFb = await convertWithFs(md, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const docFb = await unzipPart(docxBufferOf(docxFb), "word/document.xml");
  if (!docFb.includes("frontmatter标题")) {
    throw new Error("不传 metadata 时应回落 frontmatter title");
  }
  console.log("[ok] 回归:不传 metadata 时回落 frontmatter");
}
