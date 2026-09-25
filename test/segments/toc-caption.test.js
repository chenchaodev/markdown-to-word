/**
 * TOC 静态目录 + 图/表题注编号测试:
 * 8a 免更新路线:docx TableOfContents beginDirty:false + cachedEntries
 * (静态条目,纯超链接跳书签、无页码)→ 打开即见、不弹「更新域」提示;
 * 8b 前缀行识别:「图: /表:」(半角/全角冒号)紧跟图/表段落之后 → 题注,
 * 静态注入编号「图 1.1」= 最近 h1 章节号 + 章节内序数(SEQ \s 1 语义),
 * 图/表独立计数、h1 处重置;孤立前缀行(前无图/表)按普通段落。
 * 注意:题注行与图/表之间须空行(图:无空行会并入图所在段落;表:无空行会被
 * GFM 表格规则吞成表格行)。
 * 显式项契约:captionNumbering / headingNumbering 走 ConvertContext 显式字段
 * (不再借 typography 绕道),显式值优先于 typography,两侧口径一致——四组合
 * 断言见本段末(双格式 × 显式开/关两个方向)。
 */
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { FIXTURES_DIR } from "../common/paths.js";

/** 主样例:TOC + 题注(含孤立题注/缺失图片),gen-fixtures 落盘为 acceptance/toc-caption.md */
const batch8Md = `# 第一章

图: 第一章的图(孤立题注,前无图 → 普通段落)

![示例图](missing-fig.png)

图: 总体架构示意图

表: 无前导对象的表题注(孤立,普通段落)

| 列A | 列B |
| --- | --- |
| 1 | 2 |

表: 参数说明表

## 1.1 小节

![小节图](missing-fig2.png)

图: 小节内的图

# 第二章

| X | Y |
| --- | --- |
| a | b |

表: 第二章的表

图: 第二章开头无图的孤立题注(普通段落)
`;
export const fixtures = { main: batch8Md };

export async function run() {
  const batch8Docx = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const b8Document = await unzipPart(batch8Docx.buffer, "word/document.xml");
  // 8a-1:TOC 域指令仍在(w:sdt > w:instrText TOC \o "1-3" \h)
  if (!b8Document.includes("TOC")) throw new Error("批次8断言失败:document.xml 缺少 TOC 域指令");
  // 8a-2:beginDirty:false → w:dirty="false"(显式关,Word 打开不提示更新域)
  if (!b8Document.includes('w:dirty="false"') || b8Document.includes('w:dirty="true"')) {
    throw new Error("批次8断言失败:静态目录 dirty 属性应为 false(免更新路线)");
  }
  // 8a-3:cachedEntries 静态条目 → 目录内超链接指向标题书签(w:hyperlink 带 w:history 属性)
  if (!b8Document.includes('w:anchor="第一章"')) {
    throw new Error("批次8断言失败:静态目录条目缺少指向标题书签的超链接");
  }
  // field 模式 → beginDirty:true(Word/WPS 打开弹更新提示并注入真实页码),条目仍指向书签
  const batch8FieldToc = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [], tocMode: "field" });
  const fieldDoc = await unzipPart(batch8FieldToc.buffer, "word/document.xml");
  if (!fieldDoc.includes('w:dirty="true"')) {
    throw new Error("F7-①断言失败:field 模式目录 dirty 属性应为 true(触发 Word 更新域)");
  }
  if (!fieldDoc.includes('w:anchor="第一章"')) {
    throw new Error("F7-①断言失败:field 模式目录条目仍应指向标题书签");
  }
  // 8b-1:静态编号注入(章节号 + 章节内序数,图/表独立、h1 重置)
  for (const needle of ["图 1.1 总体架构示意图", "表 1.1 参数说明表", "图 1.2 小节内的图", "表 2.1 第二章的表"]) {
    if (!b8Document.includes(needle)) throw new Error(`批次8断言失败:题注编号缺失(${needle})`);
  }
  // 8b-2:孤立前缀行按普通段落(原文保留,不编号)
  if (!b8Document.includes("图: 第一章的图(孤立题注,前无图 → 普通段落)")) {
    throw new Error("批次8断言失败:孤立「图:」行应按普通段落保留原文");
  }
  // 8a-4:toc 关闭 → docx 无 TOC 指令
  const batch8NoToc = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [], toc: false });
  if ((await unzipPart(batch8NoToc.buffer, "word/document.xml")).includes("TOC")) {
    throw new Error("批次8断言失败:toc:false 时 document.xml 不应含 TOC 指令");
  }
  // 8b-3:captionNumbering 显式关闭(不再借 typography 绕道)→ 题注行按普通段落(原文保留)
  const batch8NoCaption = await convert(batch8Md, "docx", {
    baseDir: FIXTURES_DIR, warnings: [],
    typography: { ...DEFAULT_TYPOGRAPHY, captionNumbering: true },
    captionNumbering: false,
  });
  if (!(await unzipPart(batch8NoCaption.buffer, "word/document.xml")).includes("图: 总体架构示意图")) {
    throw new Error("批次8断言失败:captionNumbering:false 时题注行应保留前缀原文");
  }
  console.log("[ok] docx 静态目录 + 题注编号:TOC 免更新/条目超链接/编号注入/孤立行/开关 断言通过");

  const batch8Pdf = await convert(batch8Md, "pdf", { baseDir: FIXTURES_DIR, title: "批次8验收", warnings: [] });
  // 8b-4:PDF 题注 class + 前缀剥除(编号走 CSS counter 伪元素,不进文本节点)
  if (!batch8Pdf.html.includes('<p class="fig-caption">总体架构示意图</p>')) {
    throw new Error("批次8断言失败:PDF 缺少 fig-caption 题注(class/前缀剥除)");
  }
  if (!batch8Pdf.html.includes('<p class="tab-caption">参数说明表</p>')) {
    throw new Error("批次8断言失败:PDF 缺少 tab-caption 题注");
  }
  // 8b-5:题注 CSS counter(章节号 + 序数,h1 重置语义)
  if (!batch8Pdf.html.includes(".fig-caption::before") || !batch8Pdf.html.includes('content: "图 " counter(h1c) "." counter(figc)')) {
    throw new Error("批次8断言失败:PDF 缺少题注编号 CSS counter 规则");
  }
  // 8b-6:孤立前缀行不标记为题注(前无图/表)
  if (batch8Pdf.html.includes('class="fig-caption">图:')) {
    throw new Error("批次8断言失败:孤立「图:」行不应标记为 fig-caption");
  }
  // 8a-5:toc 关闭 → PDF 无目录
  const batch8PdfNoToc = await convert(batch8Md, "pdf", { baseDir: FIXTURES_DIR, title: "批次8验收", warnings: [], toc: false });
  if (batch8PdfNoToc.html.includes('class="toc"')) {
    throw new Error("批次8断言失败:toc:false 时 PDF 不应含目录");
  }
  console.log("[ok] PDF 题注 + 目录开关:fig/tab-caption、CSS counter、孤立行、toc 开关 断言通过");

  // ---------- 显式项契约:headingNumbering / captionNumbering 覆盖 typography ----------
  // 契约(见 src/core/convert.ts 两字段 JSDoc):显式项 > typography > render 构造默认。
  // 此前 convert() 未透传这两个显式项,调用方只能借 typography 表达意图(且与
  // 「typography 是排版设置」的语义混淆);现显式项在 docx/pdf 双管线同时生效。
  // 四组合 = {captionNumbering, headingNumbering} 两个显式项 × 两个方向
  // (显式关压过 typography 开 / 显式开压过 typography 关),每组都在 docx 与 pdf
  // 两侧各断言一次(共 8 条断言)。
  const explicitMd = `# 甲 {#sec:s1}

![样例图](g1-tiny.png)

图: 样例图 {#fig:v}

见 [图](#fig:v) 与 [章节](#sec:s1)。
`;
  const typo = (headingNumbering, captionNumbering) => ({
    ...DEFAULT_TYPOGRAPHY,
    headingNumbering,
    captionNumbering,
  });
  const bothFormats = async (context) => ({
    docx: await unzipPart((await convert(explicitMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], ...context })).buffer, "word/document.xml"),
    pdf: (await convert(explicitMd, "pdf", { baseDir: FIXTURES_DIR, title: "显式项契约", warnings: [], ...context })).html,
  });

  // 组合 1:captionNumbering 显式关(typography 开)→ 两侧都不编号、label 原样保留
  const capOff = await bothFormats({ typography: typo(true, true), captionNumbering: false });
  if (!capOff.docx.includes("图: 样例图 {#fig:v}")) {
    throw new Error("显式项断言失败:docx captionNumbering:false 应压过 typography(题注行保留前缀与 label)");
  }
  if (capOff.docx.includes("图 1.1 样例图")) {
    throw new Error("显式项断言失败:docx captionNumbering:false 不应注入编号");
  }
  if (!capOff.pdf.includes("{#fig:v}") || capOff.pdf.includes("counter(figc)")) {
    throw new Error("显式项断言失败:PDF captionNumbering:false 应压过 typography(无编号 CSS、label 原样保留)");
  }
  console.log("[ok] 组合1 captionNumbering 显式关压过 typography(docx + pdf)");

  // 组合 2:captionNumbering 显式开(typography 关)→ 两侧都编号
  // 注:typography 的 headingNumbering 同为 false,故 docx 章节号为 null(题注无
  // 章节前缀「图 1」);本组合只验证题注编号被显式打开,不涉及章节号口径。
  const capOn = await bothFormats({ typography: typo(false, false), captionNumbering: true });
  if (!capOn.docx.includes('<w:t xml:space="preserve">图 1 样例图</w:t>')) {
    throw new Error("显式项断言失败:docx captionNumbering:true 应压过 typography(注入「图 1」编号)");
  }
  if (!capOn.pdf.includes(".fig-caption::before") || capOn.pdf.includes("counter(h1c)")) {
    throw new Error("显式项断言失败:PDF captionNumbering:true 应压过 typography(产出纯序数题注 counter 规则)");
  }
  if (!capOn.pdf.includes('<span id="fig:v">')) {
    throw new Error("显式项断言失败:PDF captionNumbering:true 应登记题注锚点");
  }
  console.log("[ok] 组合2 captionNumbering 显式开压过 typography(docx + pdf)");

  // 组合 3:headingNumbering 显式关(typography 开)→ 章节引用双侧均悬空「(?)」
  const hnOff = await bothFormats({ typography: typo(true, true), headingNumbering: false });
  if (!hnOff.docx.includes('<w:t xml:space="preserve">(?)</w:t>')) {
    throw new Error("显式项断言失败:docx headingNumbering:false 应压过 typography(章节引用悬空)");
  }
  if (!hnOff.pdf.includes("(?)") || hnOff.pdf.includes("counter(h1c)")) {
    throw new Error("显式项断言失败:PDF headingNumbering:false 应压过 typography(悬空且无章节编号 CSS)");
  }
  console.log("[ok] 组合3 headingNumbering 显式关压过 typography(docx + pdf)");

  // 组合 4:headingNumbering 显式开(typography 关)→ 章节引用双侧均命中编号
  const hnOn = await bothFormats({ typography: typo(false, false), headingNumbering: true });
  if (!hnOn.docx.includes('<w:hyperlink w:history="1" w:anchor="甲">')) {
    throw new Error("显式项断言失败:docx headingNumbering:true 应压过 typography(章节引用跳标题书签)");
  }
  if (!hnOn.pdf.includes("counter(h1c)") || !hnOn.pdf.includes(">1</a>")) {
    throw new Error("显式项断言失败:PDF headingNumbering:true 应压过 typography(章节编号 CSS + 引用编号 1)");
  }
  console.log("[ok] 组合4 headingNumbering 显式开压过 typography(docx + pdf)");

  const batch8PdfBin = await htmlToPdf(batch8Pdf.html, batch8Pdf.footerTemplate);
  await saveArtifact("toc-caption", { docx: batch8Docx.buffer, pdf: batch8PdfBin });
}
