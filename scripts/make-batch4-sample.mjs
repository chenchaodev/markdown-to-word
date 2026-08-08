/**
 * 生成二期批次 4「PDF 书签」验收样例:对批次 3 的 10 个 md 样例执行
 * 合并 → PDF(printToPDF)→ 书签注入,输出 output/批次4验收/01-简介-合并.pdf。
 * 链路与 GUI renderPdf 一致(convert → 临时 html → printToPDF → injectBookmarks)。
 * 另含批次 4 剩余两项验收:02-脚注测试(脚注 md → docx/pdf,断言 footnotes/footer 部件
 * 与 PDF 脚注 HTML 结构)、页眉页脚(metadata.title 存在时断言 header 部件)。
 * 批次 5b 验收:03-标题编号链接测试(docx 标题章节编号 + 内部/外部链接跳转,解包断言)。
 * 批次 5a 验收:05-排版设置测试(docx styles/正文段落 + pdf 模板 CSS 参数化断言)。
 * 批次 5 收尾验收:06-raw-html-白名单测试(双格式一致的白名单渲染 + 危险样例安全兜底)。
 * 批次 6 验收:07-公式测试(docx KaTeX MathML → Math 组件 m:oMath 序列化断言;
 * pdf KaTeX HTML 渲染 + katex.min.css 内联 @font-face 断言)。
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
import iconv from "iconv-lite";
import { decodeMarkdown } from "../dist/core/encoding.js";

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

    // ---------- 5) 排版设置(批次 5a) ----------
    // 双格式共用同一 typography 契约(renderer 侧平行定义,字段名/默认值须同步):
    // 字号 14pt、行距 1.5、首行缩进 2 字符、两端对齐、宋体、标题编号关闭
    const typoMd = `# 排版设置测试

第一段正文,验证字号/行距/缩进/对齐等排版设置生效。

第二段正文,继续验证排版参数化。
`;
    const typography = {
      fontAscii: "Calibri",
      fontEastAsia: "宋体",
      bodySizePt: 14,
      lineSpacing: 1.5,
      firstLineIndent: true,
      align: "justify",
      headingNumbering: false,
    };
    // docx:styles.default 字号(14pt×2=28 half-points)+ eastAsia 宋体;
    // 正文段落两端对齐;headingNumbering=false → 全文无编号引用
    // (md 无列表,故 w:numPr 全缺即可稳定断言标题编号已关闭)
    const typoDocx = await convert(typoMd, "docx", { baseDir: root, warnings: [], typography });
    const typoStyles = unzipPart(typoDocx.buffer, "word/styles.xml");
    const typoDocument = unzipPart(typoDocx.buffer, "word/document.xml");
    if (!typoStyles.includes('<w:sz w:val="28"/>')) {
      throw new Error('排版断言失败:styles.xml 缺少 w:sz w:val="28"(14pt×2 half-points)');
    }
    if (!typoStyles.includes("宋体")) {
      throw new Error("排版断言失败:styles.xml 缺少 eastAsia 字体 宋体");
    }
    if (!typoDocument.includes('w:jc w:val="both"')) {
      throw new Error('排版断言失败:document.xml 缺少 w:jc both(docx 库 JUSTIFIED 序列化值,正文两端对齐)');
    }
    if (typoDocument.includes("w:numPr")) {
      throw new Error("排版断言失败:headingNumbering=false 但 document.xml 仍有编号引用");
    }
    console.log("[ok] docx 排版设置:字号28/宋体/两端对齐/标题编号关闭 全部生效");
    await fs.writeFile(path.join(outDir, "05-排版设置测试.docx"), typoDocx.buffer);

    // pdf:模板 CSS 参数化断言(renderPdfHtml 产物字符串,不依赖 printToPDF)
    const typoPdf = await convert(typoMd, "pdf", { baseDir: root, warnings: [], typography });
    const typoChecks = [
      ["font-size: 14pt", "font-size 14pt"],
      ["text-indent: 2em", "首行缩进 text-indent"],
      ["text-align: justify", "两端对齐 text-align"],
      ["宋体", "font-family 宋体"],
    ];
    for (const [needle, label] of typoChecks) {
      if (!typoPdf.html.includes(needle)) throw new Error(`排版断言失败:PDF 模板缺少 ${label}`);
    }
    if (typoPdf.html.includes("counter(h1c)")) {
      throw new Error("排版断言失败:headingNumbering=false 但 PDF 模板仍有章节编号 CSS");
    }
    console.log("[ok] PDF 排版设置:14pt/2em 缩进/两端对齐/宋体/编号关闭 全部生效");
    const typoPdfBin = await htmlToPdf(typoPdf.html, typoPdf.footerTemplate);
    await fs.writeFile(path.join(outDir, "05-排版设置测试.pdf"), typoPdfBin);

    // ---------- 6) 内联格式白名单(批次 5 最后一项) ----------
    // 双格式一致:白名单无属性标签渲染为对应格式(pdf 原样输出 / docx 样式运行);
    // 危险样例(脚本/块级 div/带属性标签)安全兜底(pdf 转义 / docx 跳过)。
    // 序列化名已实证(docx 9.7.1 index.cjs):bold → <w:b/>(OnOffElement true 无 val)、
    // sub/sup → w:vertAlign w:val="subscript"/"superscript"、mark → w:highlight
    // w:val="yellow"、strike → <w:strike/>、underline → <w:u w:val="single"/>、
    // 换行 → <w:br/>(TextRun break: 1)。
    const htmlMd = `# 白名单测试

<strong>粗体</strong> 与 <em>斜体</em>、<code>code()</code>、x<sub>1</sub> 和 y<sup>2</sup>、<u>下划线</u>、<s>删除线</s>、<mark>高亮</mark>、<span>普通</span>、<strong>粗<em>斜</em></strong>。<br>换行后内容。

<script>alert(1)</script>、<div class="x">块级</div>、<strong class="y">带属性</strong>
`;
    const htmlDocx = await convert(htmlMd, "docx", { baseDir: root, warnings: [] });
    const htmlDocument = unzipPart(htmlDocx.buffer, "word/document.xml");
    const htmlDocxChecks = [
      ["粗体", "strong 文本"],
      ["斜体", "em 文本"],
      ["<w:b/>", "bold 序列化(w:b)"],
      ["w:vertAlign", "sub/sup 序列化(w:vertAlign)"],
      ['w:val="subscript"', "subScript 序列化值"],
      ['w:val="superscript"', "superScript 序列化值"],
      ["w:highlight", "mark 序列化(w:highlight)"],
      ["<w:strike/>", "strike 序列化"],
      ['<w:u w:val="single"/>', "underline 序列化"],
      ["Consolas", "code 等宽字体"],
    ];
    for (const [needle, label] of htmlDocxChecks) {
      if (!htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 缺少 ${label}(${needle})`);
    }
    // 危险样例 docx 侧整体跳过(块级 html 节点跳过 + 段落内危险段归一化丢弃,内容文本不残留)
    for (const [needle, label] of [
      ["alert", "script 内容"],
      ["块级", "div 内容"],
      ["带属性", "带属性标签内容"],
      ['class="', "属性标签"],
    ]) {
      if (htmlDocument.includes(needle)) throw new Error(`白名单断言失败:docx 不应含 ${label}`);
    }
    console.log("[ok] docx 白名单:白名单标签渲染 + 危险样例跳过 全部通过");
    await fs.writeFile(path.join(outDir, "06-raw-html-白名单测试.docx"), htmlDocx.buffer);

    // pdf:白名单整串原样输出(Chromium 渲染);危险样例转义。
    // 注:转义仅作用于标签字符(< > & "),标签内文本(如 alert(1)、块级)按转义语义
    // 保留为可见文本,故断言"标签被转义"(&lt;script&gt; / &lt;div)而非文本消失。
    const htmlPdf = await convert(htmlMd, "pdf", { baseDir: root, title: "白名单测试", warnings: [] });
    const htmlPdfChecks = [
      ["<strong>粗体</strong>", "strong 原样输出"],
      ["<em>斜体</em>", "em 原样输出"],
      ["<sub>1</sub>", "sub 原样输出"],
      ["<sup>2</sup>", "sup 原样输出"],
      ["<mark>高亮</mark>", "mark 原样输出"],
      ["<strong>粗<em>斜</em></strong>", "嵌套原样输出"],
      ["<br>", "br 原样输出"],
      ["&lt;script&gt;", "script 转义形式"],
      ["&lt;div", "div 转义形式"],
      ["&lt;strong class=", "带属性 strong 转义形式"],
    ];
    for (const [needle, label] of htmlPdfChecks) {
      if (!htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 缺少 ${label}(${needle})`);
    }
    for (const [needle, label] of [
      ["<script", "script 明文标签"],
      ['<div class="x"', "div 明文标签(用户输入特有,模板 div 为 page-break/cover 等,不受影响)"],
      ["<strong class=", "带属性 strong 明文标签"],
    ]) {
      if (htmlPdf.html.includes(needle)) throw new Error(`白名单断言失败:PDF 不应含 ${label}`);
    }
    console.log("[ok] PDF 白名单:白名单原样输出 + 危险样例转义 全部通过");
    const htmlPdfBin = await htmlToPdf(htmlPdf.html, htmlPdf.footerTemplate);
    await fs.writeFile(path.join(outDir, "06-raw-html-白名单测试.pdf"), htmlPdfBin);

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

    // ---------- 7) 公式测试(批次 6) ----------
    // docx:KaTeX(MathML)→ docx Math 组件;OOXML 序列化名已实证(docx 9.7.1
    // index.cjs):Math 容器 → <m:oMath>,MathRun → <m:r><m:t>,分式 → <m:f>,
    // 上下标 → <m:sSubSup>,开方 → <m:rad>。
    // pdf:KaTeX HTML 渲染 + katex.min.css 内联(file:// 字体绝对化 + @font-face)。
    // 注意:remark-math(mathFlow)仅支持 $$..$$ / $..$,不支持 ```math 围栏
    // (围栏是 @mdit/plugin-katex 侧特性,属双格式语法不对称,验收用 $$ 块)。
    // JS 模板字符串内 TeX 反斜杠须双写(\\frac)。
    const formulaMd = `# 公式测试

行内公式 $x^2$ 与分式 $\\frac{1}{2}$、上下标 $a_i^j$。

独立公式:
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

开方公式:
$$
\\sqrt{a^2 + b^2}
$$
`;
    const katexDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "katex", "dist",
    );
    const formulaDocx = await convert(formulaMd, "docx", { baseDir: root, warnings: [], katexDir });
    const formulaDocument = unzipPart(formulaDocx.buffer, "word/document.xml");
    if (!formulaDocument.includes("<m:oMath")) {
      throw new Error("公式断言失败:document.xml 缺少 <m:oMath(公式未生成)");
    }
    for (const [needle, label] of [
      ["<m:t>x</m:t>", "x 上标文本"],
      ["<m:f>", "分式 m:f"],
      ["<m:sSubSup>", "上下标 m:sSubSup"],
      ["<m:rad>", "开方 m:rad"],
    ]) {
      if (!formulaDocument.includes(needle)) throw new Error(`公式断言失败:document.xml 缺少 ${label}(${needle})`);
    }
    console.log("[ok] docx 公式:m:oMath 与 分式/上下标/开方 序列化齐全");
    await fs.writeFile(path.join(outDir, "07-公式测试.docx"), formulaDocx.buffer);

    const formulaPdf = await convert(formulaMd, "pdf", {
      baseDir: root, title: "公式测试", warnings: [], katexDir,
    });
    if (!formulaPdf.html.includes('class="katex"')) {
      throw new Error('公式断言失败:PDF 缺少 KaTeX 渲染结构(class="katex")');
    }
    if (!formulaPdf.html.includes("@font-face")) {
      throw new Error("公式断言失败:PDF 缺少 @font-face(KaTeX CSS 内联未生效)");
    }
    console.log("[ok] PDF 公式:KaTeX 结构 + CSS 字体内联生效");
    const formulaPdfBin = await htmlToPdf(formulaPdf.html, formulaPdf.footerTemplate);
    await fs.writeFile(path.join(outDir, "07-公式测试.pdf"), formulaPdfBin);

    // ---------- 8) 编码预检(批次 7) ----------
    // decodeMarkdown 规则:UTF-8 BOM / UTF-16LE BOM 剥离;无 BOM 严格 UTF-8 校验,
    // 失败按 GBK/GB18030 解码并标记 encoding="gbk"(调用方据此追加警告文案)。
    const utf8NoBom = decodeMarkdown(Buffer.from("中文正文 hello", "utf8"));
    if (utf8NoBom.encoding !== "utf-8" || !utf8NoBom.text.includes("中文正文")) {
      throw new Error("编码预检断言失败:无 BOM UTF-8 未正确解码/标记");
    }
    const utf8Bom = decodeMarkdown(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("中文正文", "utf8")]),
    );
    if (utf8Bom.encoding !== "utf-8" || utf8Bom.text.includes("\uFEFF")) {
      throw new Error("编码预检断言失败:UTF-8 BOM 未剥离");
    }
    const utf16Bom = decodeMarkdown(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文正文", "utf16le")]),
    );
    if (utf16Bom.encoding !== "utf-8" || !utf16Bom.text.includes("中文正文")) {
      throw new Error("编码预检断言失败:UTF-16LE BOM 未正确解码");
    }
    const gbkBuf = iconv.encode("GBK 中文正文 hello", "gbk");
    const gbk = decodeMarkdown(gbkBuf);
    if (gbk.encoding !== "gbk" || !gbk.text.includes("中文正文")) {
      throw new Error("编码预检断言失败:GBK 文件未按 gb18030 解码/标记");
    }
    console.log("[ok] 编码预检:UTF-8(无 BOM/带 BOM)/UTF-16LE/GBK 解码与标记全部正确");

    // ---------- 落盘 ----------
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "01-简介-合并.pdf"), bookmarked);
    console.log(`[ok] 验收产物已生成: ${outDir}`);
    console.log(`    01-简介-合并.pdf (${bookmarked.length} bytes,书签 ${headings.length} 条)`);
    console.log(`    02-脚注测试.pdf (${footnotePdf.length} bytes)`);
    console.log(`    02-脚注测试.docx (${docxArtifact.buffer.length} bytes)`);
    console.log(`    05-排版设置测试.pdf (${typoPdfBin.length} bytes)`);
    console.log(`    05-排版设置测试.docx (${typoDocx.buffer.length} bytes)`);
    console.log(`    06-raw-html-白名单测试.pdf (${htmlPdfBin.length} bytes)`);
    console.log(`    06-raw-html-白名单测试.docx (${htmlDocx.buffer.length} bytes)`);
    console.log(`    07-公式测试.pdf (${formulaPdfBin.length} bytes)`);
    console.log(`    07-公式测试.docx (${formulaDocx.buffer.length} bytes)`);
  } catch (err) {
    console.error("[fail]", err);
    app.exit(1);
    return;
  }
  app.quit();
});
