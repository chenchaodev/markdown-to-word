/**
 * 生成二期批次 4「PDF 书签」验收样例:对批次 3 的 10 个 md 样例执行
 * 合并 → PDF(printToPDF)→ 书签注入,输出 output/批次4验收/01-简介-合并.pdf。
 * 链路与 GUI renderPdf 一致(convert → 临时 html → printToPDF → injectBookmarks)。
 * 另含批次 4 剩余两项验收:02-脚注测试(脚注 md → docx/pdf,断言 footnotes/footer 部件
 * 与 PDF 脚注 HTML 结构)、页眉页脚(metadata.title 存在时断言 header 部件)。
 * 批次 5b 验收:03-标题编号链接测试(docx 标题章节编号 + 内部/外部链接跳转,解包断言)。
 * 用法: npx electron scripts/make-batch4-sample.mjs(需已 build)
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { convert } from "../dist/core/convert.js";
import { mergeMarkdowns } from "../dist/core/merge.js";
import { injectBookmarks, buildBookmarkTree } from "../dist/core/pdf/bookmarks.js";
import { setPdfMetadata } from "../dist/core/pdf/metadata.js";
import { extractHeadings } from "../dist/core/pdf/render.js";
import { PDFDocument } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output/批次3验收");
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output/批次4验收");

// 默认行为:所有窗口关闭即退出(在 printToPDF 窗口 destroy 后,后续写盘代码会中断);
// 显式挂空监听保持进程存活,由脚本末尾 app.quit() 收尾。
app.on("window-all-closed", () => {});

async function collectMarkdown(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(full)));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

/** zip 是明文中央目录:部件名以明文可搜索,无需解压即可断言部件存在 */
function zipContains(buffer, name) {
  return buffer.includes(Buffer.from(name, "utf8"));
}

/** 解包 docx 并读取指定部件文本(tar 支持 zip;解包到临时目录后读取)。 */
function unzipPart(buffer, partName) {
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "m2w-docx-"));
  try {
    const zipPath = path.join(tmpDir, "doc.docx");
    fsSync.writeFileSync(zipPath, buffer);
    execFileSync("tar", ["-xf", zipPath, "-C", tmpDir], { stdio: "ignore" });
    return fsSync.readFileSync(path.join(tmpDir, partName), "utf8");
  } finally {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** printToPDF 工具:写临时 html → 隐藏窗口加载 → 打印 → 清理 */
async function htmlToPdf(html, footerTemplate) {
  const htmlPath = path.join(os.tmpdir(), `m2w-accept-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  let output;
  try {
    await fs.writeFile(htmlPath, html, "utf8");
    await win.loadFile(htmlPath);
    output = await win.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate,
    });
  } finally {
    win.destroy();
    await fs.rm(htmlPath, { force: true });
  }
  return output;
}

app.whenReady().then(async () => {
  try {
    // ---------- 1) 合并 10 文件 → PDF 书签注入(批次 4 第一项) ----------
    const mdFiles = (await collectMarkdown(root)).sort((a, b) => a.localeCompare(b));
    const inputs = await Promise.all(
      mdFiles.map(async (f) => ({ content: await fs.readFile(f, "utf8"), baseDir: path.dirname(f) })),
    );
    const mergedMd = mergeMarkdowns(inputs);
    const mergedArtifact = await convert(mergedMd, "pdf", {
      baseDir: root,
      title: "产品白皮书",
      warnings: [],
      pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
    });
    const mergedPdf = await htmlToPdf(mergedArtifact.html, mergedArtifact.footerTemplate);
    const headings = extractHeadings(mergedArtifact.html);
    const bookmarked =
      headings.length > 0
        ? await injectBookmarks(new Uint8Array(mergedPdf), buildBookmarkTree(headings))
        : new Uint8Array(mergedPdf);
    console.log(`[ok] 合并 PDF:提取标题 ${headings.length} 条`);

    // ---------- 2) 脚注 + 页眉页脚(批次 4 第二/三项) ----------
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
      baseDir: root,
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
    await fs.writeFile(path.join(outDir, "02-脚注测试.docx"), docxArtifact.buffer);

    const pdfArtifact = await convert(footnoteMd, "pdf", {
      baseDir: root,
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
    await fs.writeFile(path.join(outDir, "02-脚注测试.pdf"), footnotePdfMeta);

    // ---------- 4) PDF 章节编号 + 元数据(批次 5c) ----------
    // 章节编号:CSS counter 规则(::before 伪元素,1/1.1/1.1.1)进入模板样式
    if (!pdfArtifact.html.includes("counter(h1c)") || !pdfArtifact.html.includes("h1::before")) {
      throw new Error("PDF 章节编号断言失败:缺少 counter 编号 CSS");
    }
    // 元数据:frontmatter title/author/date → PDF Info(读回验证)
    const pdfDoc = await PDFDocument.load(footnotePdfMeta);
    const pdfTitle = pdfDoc.getTitle();
    const pdfAuthor = pdfDoc.getAuthor();
    if (pdfTitle !== "脚注与页眉页脚验收" || pdfAuthor !== "测试") {
      throw new Error(`PDF 元数据断言失败: title=${pdfTitle} author=${pdfAuthor}`);
    }
    console.log("[ok] PDF 章节编号:counter CSS 存在(1/1.1/1.1.1)");
    console.log(`[ok] PDF 元数据:title="${pdfTitle}" author="${pdfAuthor}" 读回一致`);

    // ---------- 3) 标题编号 + 内部/外部链接(批次 5b) ----------
    // 内部锚点 [x](#二级标题) → InternalHyperlink(anchor=docxBookmarkId);外链 → ExternalHyperlink
    const linkMd = `---
title: 标题编号与链接测试
---

# 第一章

正文,链接到[二级标题](#二级标题),以及外链[示例站](https://example.com)。

## 二级标题

三级子节见下。

### 三级子节

- 项目一
- 项目二
`;
    const linkDocx = await convert(linkMd, "docx", { baseDir: root, warnings: [] });
    const numberingXml = unzipPart(linkDocx.buffer, "word/numbering.xml");
    const documentXml = unzipPart(linkDocx.buffer, "word/document.xml");
    // 标题编号:numbering.xml 含多级 text 模板 %1 / %1.%2 / %1.%2.%3
    // (reference 名 "md-heading" 是库内部标识,不写进 XML,断言 text 模板即可)
    if (!numberingXml.includes('w:lvlText w:val="%1"/>') || !numberingXml.includes('w:lvlText w:val="%1.%2"/>')) {
      throw new Error("标题编号断言失败:numbering.xml 缺少多级 text 模板");
    }
    // 内部链接:document.xml 含 w:hyperlink w:anchor 指向标题书签
    if (!documentXml.includes('w:hyperlink') || !documentXml.includes('w:anchor="二级标题"')) {
      throw new Error("内部链接断言失败:document.xml 缺少 w:hyperlink w:anchor");
    }
    // 标题书签仍在(编号不破坏 Bookmark)
    if (!documentXml.includes('w:bookmarkStart w:name="二级标题"')) {
      throw new Error("标题书签断言失败:编号后 Bookmark 丢失");
    }
    console.log("[ok] docx 标题编号/内部链接:numbering md-heading + hyperlink anchor + 书签齐全");
    await fs.writeFile(path.join(outDir, "03-标题编号链接测试.docx"), linkDocx.buffer);

    // ---------- 落盘 ----------
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "01-简介-合并.pdf"), bookmarked);
    console.log(`[ok] 验收产物已生成: ${outDir}`);
    console.log(`    01-简介-合并.pdf (${bookmarked.length} bytes,书签 ${headings.length} 条)`);
    console.log(`    02-脚注测试.pdf (${footnotePdf.length} bytes)`);
    console.log(`    02-脚注测试.docx (${docxArtifact.buffer.length} bytes)`);
  } catch (err) {
    console.error("[fail]", err);
    app.exit(1);
    return;
  }
  app.quit();
});
