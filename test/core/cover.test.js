// @ts-check
/**
 * 封面页测试(双格式,新段):
 * docx:renderCoverPage(dist/core/docx/chrome.js)——frontmatter metadata.title 存在时
 * 置于文档最前:标题 44 half-points(=22pt,docx 库 size 单位为 half-points)居中加粗
 * (<w:sz w:val="44"/> + <w:b/> + <w:jc w:val="center"/>),单位/organization、author/date
 * 居中灰字(<w:sz w:val="22"/> + <w:color w:val="808080"/>),末尾 PageBreak 独占一页。
 * pdf:buildCoverHtml(dist/core/pdf/template.js)——class="cover" 容器 + cover-title
 * (CSS 精确值 font-size: 28pt; font-weight: 700)+ cover-meta(单位 · author · date 灰字,
 * font-size: 12pt; color: #888;),末尾 page-break div 复用分页样式。
 * 触发条件:仅 frontmatter(parseFrontmatter 的 metadata.title);context.title 不触发
 * (convert.js 对 docx/pdf 均只传 options.metadata)。无 frontmatter → 双格式无封面。
 */
import { unzipPart } from "../harness/docx-utils.js";
import { htmlToPdf } from "../harness/pdf-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,判据静态看不见本段的主体 —— 全链路经
 * `test/harness/convert-helpers.js` 的 `convertWithFs` 到达 core,段内零 core import。
 *
 * 主体依据(**头注明写**):头注逐条点名两个被调函数与其所在文件,故以头注为准 ——
 * `renderCoverPage(dist/core/docx/render.js)` 与 `buildCoverHtml(dist/core/pdf/template.js)`。
 * 核对磁盘后的落点:两个函数今日定义在 `docx/chrome.ts` 与 `pdf/template.ts`
 * (`docx/render.ts` 只 import 并调用它),故声明定义处而非头注写的调用处 ——
 * 元素要指向被测模块在磁盘上的真实位置(L6 第三条逐个对磁盘核对)。
 */
export const covers = [
  "src/core/docx/chrome.ts",
  "src/core/pdf/template.ts",
];

/**
 * 主样例:frontmatter 封面验收(gen-fixtures 落盘为 docs/cover.md)
 */
const coverMd = `---
title: 封面验收文档
author: 测试作者
date: 2026-08-10
---

# 正文标题

这是封面验收文档的正文内容。
`;

/**
 * 单位样例:**与主样例分开**。主样例的 `fixtures.main` 由 gen-fixtures 落盘为
 * `samples/docs/cover.md`,改它会让 `check:fixtures` 与磁盘夹具漂移 ⇒ 单位的取值
 * 只能另起一段样例(本体不导出,不进夹具)。
 */
const orgMd = `---
title: 单位封面验收文档
organization: 验收单位
author: 单位作者
date: 2026-08-11
---

# 正文标题

这是单位封面验收文档的正文内容。
`;
export const meta = { description: "封面页测试(双格式,新段):" };
export const fixtures = { main: coverMd };

export async function run() {
  const suite = createCaseSuite();
  // 有封面与无封面两组产物都在 case 之外备好:反例那组是独立转换,
  // 与正例判红与否无关
  const coverDocx = await convertWithFs(coverMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const coverDocument = await unzipPart(docxBufferOf(coverDocx), "word/document.xml");
  const coverPdf = asPdfArtifact(
    await convertWithFs(coverMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [] }),
  );
  // 单位样例的产物(断言 4b):与主样例同一条转换通道,只换输入源
  const orgDocx = await convertWithFs(orgMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const orgDocument = await unzipPart(docxBufferOf(orgDocx), "word/document.xml");
  const orgPdf = asPdfArtifact(
    await convertWithFs(orgMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [] }),
  );
  // 断言 6(反例):无 frontmatter 时双格式均不产出封面(context.title 不触发封面)。
  // 注意:封面标记用 author/date 灰字(808080)+ 作者文本——不可用 w:sz=44 判别,
  // 正文 h1(standard 档 22pt)同样产出 44 half-points 的标题 run
  const noCoverMd = "# 无封面标题\n\n正文内容。";
  const noCoverDocx = await convertWithFs(noCoverMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const noCoverDocument = await unzipPart(docxBufferOf(noCoverDocx), "word/document.xml");
  const noCoverPdf = asPdfArtifact(
    await convertWithFs(noCoverMd, "pdf", { title: "无封面标题", baseDir: FIXTURES_DIR, warnings: [] }),
  );

  // 断言 1:封面标题居中加粗 22pt(44 half-points,docx 库 size = pt × 2)
  // 断言表逐项一个 case:label 是该 XML 片段的稳定标识
  /** @type {[string, string][]} 断言表 [XML 片段, 中文标签] */
  const titleChecks = [
    ['<w:sz w:val="44"/>', "标题字号 44(22pt)"],
    ["<w:b/>", "标题加粗"],
    ['<w:jc w:val="center"/>', "标题居中对齐"],
    ["封面验收文档", "标题文本"],
  ];
  for (const [needle, label] of titleChecks) {
    await suite.case(`docx 封面标题:${label}`, () => {
      if (!coverDocument.includes(needle)) throw new Error(`封面断言失败:document.xml 缺少 ${label}(${needle})`);
    });
  }
  // 断言 2:author/date 居中灰字(22 half-points = 11pt,color 808080)
  /** @type {[string, string][]} 断言表 [XML 片段, 中文标签] */
  const metaChecks = [
    ['<w:color w:val="808080"/>', "author/date 灰色"],
    ['<w:sz w:val="22"/>', "author/date 字号 22(11pt)"],
    ["测试作者", "author 文本"],
    ["2026-08-10", "date 文本"],
  ];
  for (const [needle, label] of metaChecks) {
    await suite.case(`docx 封面 ${label}`, () => {
      if (!coverDocument.includes(needle)) throw new Error(`封面断言失败:document.xml 缺少 ${label}(${needle})`);
    });
  }
  // 断言 3:封面末尾显式分页(w:br w:type="page")独占一页
  await suite.case("docx 封面末尾有显式分页符独占一页", () => {
    if (!coverDocument.includes('w:type="page"')) {
      throw new Error("封面断言失败:document.xml 缺少封面后分页符(w:br w:type=page)");
    }
  });
  // 断言 2b:单位(organization)进 docx 封面 —— 与 author/date 同款居中灰字(零新增样式)
  await suite.case("docx 封面显示 frontmatter organization(单位)", () => {
    if (!orgDocument.includes("验收单位")) {
      throw new Error("封面断言失败:document.xml 缺少单位文本(organization 未接线到封面)");
    }
    // 复用既有 meta 样式(evidence: 两侧零新增样式):单位所在段落须带 author/date 同款
    // 灰字 808080 + 22 half-points。按 `</w:p>` 切段后在该段内查,避免命中的是别处的样式
    const orgParagraph = orgDocument.split("</w:p>").find((chunk) => chunk.includes("验收单位"));
    if (
      !orgParagraph
      || !orgParagraph.includes('<w:color w:val="808080"/>')
      || !orgParagraph.includes('<w:sz w:val="22"/>')
    ) {
      throw new Error("封面断言失败:单位段应复用 author/date 的居中灰字小字样式(808080 + sz 22)");
    }
  });
  // 单位与作者的先后:与 pdf 侧 metaLine 的项序同源(单位 · 作者 · 日期),
  // 两侧只差分段方式(docx 一段一段 / pdf 合成一行),不是两套语义
  await suite.case("docx 封面单位段在作者段之前(与 pdf metaLine 项序一致)", () => {
    const orgAt = orgDocument.indexOf("验收单位");
    const authorAt = orgDocument.indexOf("单位作者");
    if (orgAt < 0 || authorAt < 0 || orgAt > authorAt) {
      throw new Error(`封面断言失败:单位应排在作者之前(单位@${orgAt}, 作者@${authorAt})`);
    }
  });
  console.log("[ok] docx 封面:标题 44/加粗/居中 + author/date 灰字 + 分页符 断言通过");

  // 断言 4:cover HTML 结构 + 单位/author/date 行(metaLine = [organization, author, date].join(" · "))
  await suite.case("PDF 含 class=cover 容器", () => {
    if (!coverPdf.html.includes('<div class="cover">')) {
      throw new Error('封面断言失败:PDF 缺少 class="cover" 容器');
    }
  });
  await suite.case("PDF 含 cover-title 标题结构", () => {
    if (!coverPdf.html.includes('<div class="cover-title">封面验收文档</div>')) {
      throw new Error("封面断言失败:PDF 缺少 cover-title 标题结构");
    }
  });
  await suite.case("PDF 含 cover-meta(author · date)行", () => {
    if (!coverPdf.html.includes('<div class="cover-meta">测试作者 · 2026-08-10</div>')) {
      throw new Error("封面断言失败:PDF 缺少 cover-meta(author · date)行");
    }
  });
  // 断言 4b:单位(organization)进 pdf cover-meta,且项序与 docx 封面段落序一致
  await suite.case("PDF 含 cover-meta(单位 · author · date)行", () => {
    const expected = '<div class="cover-meta">验收单位 · 单位作者 · 2026-08-11</div>';
    if (!orgPdf.html.includes(expected)) {
      throw new Error(`封面断言失败:PDF 缺少 cover-meta 单位行(期望 ${expected})`);
    }
  });
  // 断言 5:封面 CSS 精确值(28pt 标题 / 灰字 meta / 顶部留白)
  /** @type {[string, string][]} 断言表 [CSS 片段, 中文标签] */
  const cssChecks = [
    [".cover-title { font-size: 28pt", "cover-title 28pt 字号"],
    [".cover-meta { font-size: 12pt; color: #888;", "cover-meta 12pt 灰字"],
    [".cover { text-align: center; padding-top: 80mm;", ".cover 居中 + 顶部留白"],
  ];
  for (const [needle, label] of cssChecks) {
    await suite.case(`PDF 封面 CSS:${label}`, () => {
      if (!coverPdf.html.includes(needle)) throw new Error(`封面断言失败:PDF CSS 缺少 ${label}(${needle})`);
    });
  }
  console.log("[ok] PDF 封面:cover/cover-title/cover-meta 结构 + CSS 精确值 断言通过");

  await suite.case("反例:无 frontmatter 时 docx 不产出封面", () => {
    if (noCoverDocument.includes('<w:color w:val="808080"/>') || noCoverDocument.includes("测试作者")) {
      throw new Error("封面断言失败:无 frontmatter 时 docx 不应产出封面(作者灰字/作者文本)");
    }
  });
  await suite.case("反例:无 frontmatter 时 PDF 不产出封面", () => {
    if (noCoverPdf.html.includes('class="cover"')) {
      throw new Error("封面断言失败:无 frontmatter 时 PDF 不应产出封面(class=cover)");
    }
  });
  console.log("[ok] 封面反例:无 frontmatter 双格式均无封面(context.title 不触发)");

  const coverPdfBin = await htmlToPdf(coverPdf.html, coverPdf.footerTemplate);
  await saveArtifact("cover", { docx: docxBufferOf(coverDocx), pdf: coverPdfBin });
  return { cases: suite.results };
}
