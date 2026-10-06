// @ts-check
/**
 * TOC 静态目录 + 图/表题注编号测试:
 * 8a 免更新路线:docx TableOfContents beginDirty:false + cachedEntries
 * (静态条目,纯超链接跳书签、无页码)→ 打开即见、不弹「更新域」提示;
 * 8b 前缀行识别:「图: /表:」(半角/全角冒号)紧跟图/表段落之后 → 题注,
 * 静态注入编号「图 1.1」= 最近 h1 章节号 + 章节内序数(SEQ \s 1 语义),
 * 图/表独立计数、h1 处重置;孤立前缀行(前无图/表)按普通段落。
 * 注意:题注行与图/表之间须空行(图:无空行会并入图所在段落;表:无空行会被
 * GFM 表格规则吞成表格行)。
 * 显式项契约:captionNumbering / headingNumbering 走 convert() 的第 4 参
 * ConvertTestOverrides(生产零写入者,故不在生产 ConvertContext 里,见 src/core/convert.ts),
 * 显式值优先于 typography,两侧口径一致——四组合断言见本段末(双格式 × 显式开/关两个方向)。
 */
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../harness/docx-utils.js";
import { htmlToPdf } from "../harness/pdf-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { HOST_FS, asPdfArtifact, convertWithFs, docxBufferOf, pdfHtmlOf, prepareForConvert } from "../harness/convert-helpers.js";
import { docxTocAnchors } from "../harness/dual-extract.js";

/** @typedef {import("../../dist/core/convert.js").ConvertTestOverrides} ConvertTestOverrides */
/** @typedef {import("../../dist/core/convert.js").ConvertArtifact} Artifact */
/** @typedef {import("../../dist/core/settings/typography.js").TypographySettings} TypographySettings */
/**
 * 本包装 context 实参的类型:ConvertContext 去掉由包装注入的 `fs`(宿主文件系统能力)。
 * 此前标注 Record<string, unknown>,那把 convert() 真正要求的 `baseDir` 一并吞掉了。
 * @typedef {Omit<import("../../dist/core/convert.js").ConvertContext, "fs">} Ctx
 */

/**
 * convert() + 宿主文件系统能力 + 第 4 参显式项覆盖。
 * 与 convert-helpers 的 convertWithFs 同构,只多一个 overrides 实参 —— 本段要断言
 * 「显式项压过 typography」,而 headingNumbering / captionNumbering / imageBudget
 * 生产零写入者(不在生产 ConvertContext 里),只能走 convert 的第 4 参
 * ConvertTestOverrides(见 src/core/convert.ts)。
 *
 * 第 1 参仍是裸 markdown 字符串:frontmatter 隔离经 `prepareForConvert` 在包装内做
 * (core 的 convert 第 1 参是 `{ body, metadata }` 阶段产物,不再自己解析 frontmatter)。
 *
 * @param {string} md markdown 源
 * @param {"docx" | "pdf"} format 目标格式
 * @param {Ctx} context 转换上下文(baseDir 等由调用点给全;fs 由包装注入)
 * @param {ConvertTestOverrides} overrides 显式项覆盖(convert 第 4 参)
 * @returns {Promise<Artifact>} 产物
 */
const convertWithOverrides = /** @type {(md: string, format: "docx" | "pdf", context: Ctx, overrides: ConvertTestOverrides) => Promise<Artifact>} */ (
  (md, format, context, overrides) => convert(prepareForConvert(md), format, { fs: HOST_FS, ...context }, overrides)
);

/** 主样例:TOC + 题注(含孤立题注/缺失图片),gen-fixtures 落盘为 docs/toc-caption.md */
const mainMd = `# 第一章

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
export const meta = { description: "TOC 静态目录 + 图/表题注编号测试:" };
export const fixtures = { main: mainMd };

export async function run() {
  const mainDocx = (
    await convertWithFs(mainMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] })
  );
  const docxXml = await unzipPart(docxBufferOf(mainDocx), "word/document.xml");
  // 8a-1:TOC 域指令仍在(w:sdt > w:instrText TOC \o "1-3" \h)
  if (!docxXml.includes("TOC")) throw new Error("断言失败:document.xml 缺少 TOC 域指令");
  // 8a-2:beginDirty:false → w:dirty="false"(显式关,Word 打开不提示更新域)
  if (!docxXml.includes('w:dirty="false"') || docxXml.includes('w:dirty="true"')) {
    throw new Error("断言失败:静态目录 dirty 属性应为 false(免更新路线)");
  }
  // 8a-3:cachedEntries 静态条目 → 目录内超链接指向标题书签(w:hyperlink 带 w:history 属性,
  // 提取口径见 test/harness/dual-extract.js 的 docxTocAnchors:目录条目 = 内部锚点
  // <w:hyperlink w:history="1" w:anchor="…">,并排除 fig/tab/eq- 题注锚点)
  const mainTocAnchors = docxTocAnchors(docxXml);
  if (!mainTocAnchors.includes("第一章")) {
    throw new Error(`断言失败:静态目录条目缺少指向标题书签的超链接(实得:${mainTocAnchors.join(",")})`);
  }
  // field 模式 → beginDirty:true(Word/WPS 打开弹更新提示并注入真实页码),条目仍指向书签
  const fieldToc = (
    await convertWithFs(mainMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], tocMode: "field" })
  );
  const fieldDoc = await unzipPart(docxBufferOf(fieldToc), "word/document.xml");
  if (!fieldDoc.includes('w:dirty="true"')) {
    throw new Error("目录带页码(adr-007)断言失败:field 模式目录 dirty 属性应为 true(触发 Word 更新域)");
  }
  if (!docxTocAnchors(fieldDoc).includes("第一章")) {
    throw new Error("目录带页码(adr-007)断言失败:field 模式目录条目仍应指向标题书签");
  }
  // 8b-1:静态编号注入(章节号 + 章节内序数,图/表独立、h1 重置)
  for (const needle of ["图 1.1 总体架构示意图", "表 1.1 参数说明表", "图 1.2 小节内的图", "表 2.1 第二章的表"]) {
    if (!docxXml.includes(needle)) throw new Error(`断言失败:题注编号缺失(${needle})`);
  }
  // 8b-2:孤立前缀行按普通段落(原文保留,不编号)
  if (!docxXml.includes("图: 第一章的图(孤立题注,前无图 → 普通段落)")) {
    throw new Error("断言失败:孤立「图:」行应按普通段落保留原文");
  }
  // 8a-4:toc 关闭 → docx 无 TOC 指令
  const noToc = (
    await convertWithFs(mainMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], toc: false })
  );
  if ((await unzipPart(docxBufferOf(noToc), "word/document.xml")).includes("TOC")) {
    throw new Error("断言失败:toc:false 时 document.xml 不应含 TOC 指令");
  }
  // 8b-3:captionNumbering 显式关闭(不再借 typography 绕道)→ 题注行按普通段落(原文保留)
  const noCaption = (await convertWithOverrides(mainMd, "docx", {
    baseDir: FIXTURES_DIR, warnings: [],
    typography: { ...DEFAULT_TYPOGRAPHY, captionNumbering: true },
  }, { captionNumbering: false }));
  if (!(await unzipPart(docxBufferOf(noCaption), "word/document.xml")).includes("图: 总体架构示意图")) {
    throw new Error("断言失败:captionNumbering:false 时题注行应保留前缀原文");
  }
  console.log("[ok] docx 静态目录 + 题注编号:TOC 免更新/条目超链接/编号注入/孤立行/开关 断言通过");

  const mainPdf = (
    await convertWithFs(mainMd, "pdf", { baseDir: FIXTURES_DIR, title: "题注与目录验收", warnings: [] })
  );
  const mainHtml = pdfHtmlOf(mainPdf);
  // 8b-4:PDF 题注 class + 前缀剥除(编号走 CSS counter 伪元素,不进文本节点)
  if (!mainHtml.includes('<p class="fig-caption">总体架构示意图</p>')) {
    throw new Error("断言失败:PDF 缺少 fig-caption 题注(class/前缀剥除)");
  }
  if (!mainHtml.includes('<p class="tab-caption">参数说明表</p>')) {
    throw new Error("断言失败:PDF 缺少 tab-caption 题注");
  }
  // 8b-5:题注 CSS counter(章节号 + 序数,h1 重置语义)
  if (!mainHtml.includes(".fig-caption::before") || !mainHtml.includes('content: "图 " counter(h1c) "." counter(figc)')) {
    throw new Error("断言失败:PDF 缺少题注编号 CSS counter 规则");
  }
  // 8b-6:孤立前缀行不标记为题注(前无图/表)
  if (mainHtml.includes('class="fig-caption">图:')) {
    throw new Error("断言失败:孤立「图:」行不应标记为 fig-caption");
  }
  // 8a-5:toc 关闭 → PDF 无目录
  const pdfNoToc = (
    await convertWithFs(mainMd, "pdf", { baseDir: FIXTURES_DIR, title: "题注与目录验收", warnings: [], toc: false })
  );
  if (pdfHtmlOf(pdfNoToc).includes('class="toc"')) {
    throw new Error("断言失败:toc:false 时 PDF 不应含目录");
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

![样例图](input/g1-tiny.png)

图: 样例图 {#fig:v}

见 [图](#fig:v) 与 [章节](#sec:s1)。
`;
  /** @type {(headingNumbering: boolean, captionNumbering: boolean) => TypographySettings} */
  const typo = (headingNumbering, captionNumbering) => ({
    ...DEFAULT_TYPOGRAPHY,
    headingNumbering,
    captionNumbering,
  });
  /**
   * 同一设置上下文 + 同一显式项覆盖下取双格式产物(docx 解包 XML + pdf HTML)。
   * `overrides` 是 convert() 的第 4 参 ConvertTestOverrides,与上下文分开传 ——
   * 生产 ConvertContext 不含这三个字段,借它传会在类型层就被判红。
   * @param {Partial<Ctx>} context 追加到 ConvertContext 的设置(baseDir/warnings 由本层补全)
   * @param {ConvertTestOverrides} overrides 显式项覆盖(headingNumbering / captionNumbering)
   * @returns {Promise<{ docx: string; pdf: string }>} 双格式断言面
   */
  const bothFormats = async (context, overrides) => {
    const docxArtifact = (
      await convertWithOverrides(explicitMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], ...context }, overrides)
    );
    const pdfArtifact = (
      await convertWithOverrides(explicitMd, "pdf", { baseDir: FIXTURES_DIR, title: "显式项契约", warnings: [], ...context }, overrides)
    );
    return {
      docx: await unzipPart(docxBufferOf(docxArtifact), "word/document.xml"),
      pdf: pdfHtmlOf(pdfArtifact),
    };
  };

  // 组合 1:captionNumbering 显式关(typography 开)→ 两侧都不编号、label 原样保留
  const capOff = await bothFormats({ typography: typo(true, true) }, { captionNumbering: false });
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
  const capOn = await bothFormats({ typography: typo(false, false) }, { captionNumbering: true });
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
  const hnOff = await bothFormats({ typography: typo(true, true) }, { headingNumbering: false });
  if (!hnOff.docx.includes('<w:t xml:space="preserve">(?)</w:t>')) {
    throw new Error("显式项断言失败:docx headingNumbering:false 应压过 typography(章节引用悬空)");
  }
  if (!hnOff.pdf.includes("(?)") || hnOff.pdf.includes("counter(h1c)")) {
    throw new Error("显式项断言失败:PDF headingNumbering:false 应压过 typography(悬空且无章节编号 CSS)");
  }
  console.log("[ok] 组合3 headingNumbering 显式关压过 typography(docx + pdf)");

  // 组合 4:headingNumbering 显式开(typography 关)→ 章节引用双侧均命中编号
  const hnOn = await bothFormats({ typography: typo(false, false) }, { headingNumbering: true });
  if (!hnOn.docx.includes('<w:hyperlink w:history="1" w:anchor="甲">')) {
    throw new Error("显式项断言失败:docx headingNumbering:true 应压过 typography(章节引用跳标题书签)");
  }
  if (!hnOn.pdf.includes("counter(h1c)") || !hnOn.pdf.includes(">1</a>")) {
    throw new Error("显式项断言失败:PDF headingNumbering:true 应压过 typography(章节编号 CSS + 引用编号 1)");
  }
  console.log("[ok] 组合4 headingNumbering 显式开压过 typography(docx + pdf)");

  const mainPdfBin = await htmlToPdf(mainHtml, asPdfArtifact(mainPdf).footerTemplate);
  await saveArtifact("toc-caption", { docx: docxBufferOf(mainDocx), pdf: mainPdfBin });
}
