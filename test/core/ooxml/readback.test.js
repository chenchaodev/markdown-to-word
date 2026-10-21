// @ts-check
/**
 * docx 回读层测试(src/core/ooxml/readback/**):
 * - 还原形态:标题 / 段落(含粗体·斜体·行内代码)/ 有序·无序列表(层级与编号)/
 *   GFM 表格(首行表头)/ 链接(外链 + 内部锚点)/ 图片(可读名与字节)/ 公式(纯文本)/
 *   引用块 / 分隔线 / 分页符 / 代码块;
 * - 三类清单:会保真(恒定)、会丢弃(本次文档实际发生)、本仓恒不还原(能力边界);
 * - 计数:各类结构的条数与实际产物一致;
 * - 失败路径:非 docx 字节 ⇒ 失败态(不谎报成功);
 * - 侧信道:公式槽位 / 分页符 / 下边框 / 底纹 的抽取与段落序对齐校验。
 *
 * 夹具在段内用 jszip 现造(不依赖 output/artifacts —— 那些是别的段的产物,
 * 段间无先后保证);纯函数段,不产 docx/pdf 附件。
 */
import JSZip from "jszip";
import { createCaseSuite } from "../../harness/case.js";
import { createAsserter } from "../../harness/assert.js";
import { readbackDocx } from "../../../dist/core/ooxml/readback/readback.js";
import { buildReadbackTree, traitsAligned } from "../../../dist/core/ooxml/readback/readback-mdast.js";
import { extractDocumentTraits } from "../../../dist/core/ooxml/readback/readback-math.js";
import { renderReadbackMarkdown } from "../../../dist/core/ooxml/readback/readback-markdown.js";
import {
  READBACK_DROPPED_FIELDS,
  READBACK_NOT_MANAGED_FIELDS,
  READBACK_PRESERVED_FIELDS,
} from "../../../dist/core/ooxml/readback/readback-fields.js";
import { parseDocument } from "../../../dist/core/ooxml/part-document.js";
import { parseNumbering } from "../../../dist/core/ooxml/part-numbering.js";
import { parseStyles } from "../../../dist/core/ooxml/part-styles.js";

export const meta = {
  description: "docx 回读层测试:标题/列表/表格/链接/图片/公式/引用块/分隔线/分页符 + 三类清单 + 失败态",
};
export const fixtures = null;

const { assert, assertEq, assertIncludes } = createAsserter("ooxml-readback");

const DOCUMENT_XML = `<?xml version="1.0"?>
<w:document xmlns:w="urn:w" xmlns:r="urn:r" xmlns:a="urn:a" xmlns:wp="urn:wp" xmlns:m="urn:m">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>普通</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>粗</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t>行内代码</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>无序项</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>有序一</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>有序二</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>有序嵌套</w:t></w:r></w:p>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>列A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列B</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:hyperlink r:id="rId3"><w:r><w:t>外链</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="书签"><w:r><w:t>锚点</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:blip r:embed="rId4"/></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>公式 </w:t></w:r><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath><w:r><w:t> 结束</w:t></w:r></w:p>
    <w:p><w:pPr><w:shd w:fill="F2F2F2"/><w:ind w:left="720"/></w:pPr><w:r><w:t>引用</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t>code()</w:t></w:r></w:p>
    <w:p><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
  </w:body>
</w:document>`;

const STYLES_XML = `<?xml version="1.0"?>
<w:styles>
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING_XML = `<?xml version="1.0"?>
<w:numbering>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="●"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

const RELS_XML = `<?xml version="1.0"?>
<Relationships xmlns="urn:rel">
  <Relationship Id="rId3" Type="urn:hyperlink" Target="https://example.com/a" TargetMode="External"/>
  <Relationship Id="rId4" Type="urn:image" Target="media/x.png"/>
</Relationships>`;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

/**
 * 造一份最小可读的自家稿形态 .docx(内存里的 zip)。
 * @returns {Promise<Uint8Array>} .docx 字节
 */
async function buildFixtureDocx() {
  const zip = new JSZip();
  zip.file("word/document.xml", DOCUMENT_XML);
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/numbering.xml", NUMBERING_XML);
  zip.file("word/_rels/document.xml.rels", RELS_XML);
  zip.file("word/media/x.png", PNG_BYTES);
  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(buffer);
}

export async function run() {
  const suite = createCaseSuite();

  await suite.case("回读自家稿:形态还原与计数", async () => {
    const bytes = await buildFixtureDocx();
    const result = await readbackDocx(bytes);
    assertEq(result.status, "ok", "回读状态");
    assertEq(result.counts.headings, 1, "标题数");
    assertEq(result.counts.tables, 1, "表格数");
    assertEq(result.counts.images, 1, "图片数");
    assertEq(result.counts.links, 2, "链接数(外链 + 内部锚点)");
    assertEq(result.counts.formulas, 1, "公式数");
    assertEq(result.counts.footnotes, 0, "脚注数");
    assertEq(result.counts.listItems, 4, "列表项数(无序 1 + 有序 3)");
  });

  await suite.case("回读自家稿:Markdown 文本形态", async () => {
    const bytes = await buildFixtureDocx();
    const result = await readbackDocx(bytes);
    const markdown = await renderReadbackMarkdown(result.root, {
      mediaUrl: (fileName) => `报告_media/${fileName}`,
    });
    assertIncludes(markdown, "# 标题", "标题还原");
    assertIncludes(markdown, "**粗**", "粗体还原");
    assertIncludes(markdown, "*斜*", "斜体还原");
    assertIncludes(markdown, "`行内代码`", "行内代码还原");
    assertIncludes(markdown, "无序项", "无序列表项还原");
    assertIncludes(markdown, "1. 有序一", "有序列表首项编号");
    // remark-stringify 的有序列表标记:首项用 "."、同列表后续项用 ")"(序列化器的既定行为)
    assertIncludes(markdown, "2) 有序二", "有序列表次项编号");
    assertIncludes(markdown, "| **列A**", "GFM 表格首行为表头");
    assertIncludes(markdown, "[外链](https://example.com/a)", "外链还原");
    assertIncludes(markdown, "[锚点](#书签)", "内部锚点还原为 md 锚点链接");
    assertIncludes(markdown, "![](报告_media/image1.png)", "图片按相对路径引用");
    assertIncludes(markdown, "公式 x^2 结束", "公式以纯文本保留(非 LaTeX)");
    assertIncludes(markdown, "> 引用", "引用块还原");
    assertIncludes(markdown, "```\ncode()\n```", "代码块还原为围栏代码块");
    assertIncludes(markdown, "***", "分隔线还原");
    assertIncludes(markdown, "<!-- page-break -->", "分页符按本仓 markdown 约定还原");
  });

  await suite.case("回读自家稿:图片清单(可读名 + 字节)", async () => {
    const bytes = await buildFixtureDocx();
    const result = await readbackDocx(bytes);
    assertEq(result.images.length, 1, "图片数");
    const image = result.images[0];
    assertEq(image?.fileName, "image1.png", "图片可读名(按文档序)");
    assertEq(image?.partName, "word/media/x.png", "图片源部件名(经 rels 解析)");
    assertEq(image?.data.length, PNG_BYTES.length, "图片字节长度");
  });

  await suite.case("三类清单:会保真 / 会丢弃 / 本仓恒不还原", async () => {
    const bytes = await buildFixtureDocx();
    const result = await readbackDocx(bytes);
    assertEq(result.preserved.length, READBACK_PRESERVED_FIELDS.length, "会保真清单长度");
    assertEq(result.notManaged.length, READBACK_NOT_MANAGED_FIELDS.length, "不接管清单长度");
    // 本稿有公式 ⇒ 「会丢弃」出「formula」;无批注/脚注 ⇒ 不出
    assert(result.dropped.includes("formula"), "有公式时应列入会丢弃清单");
    assert(!result.dropped.includes("comments"), "无批注时不应列入会丢弃清单");
    assert(!result.dropped.includes("footnotes"), "无脚注时不应列入会丢弃清单");
    for (const field of result.dropped) {
      assert(
        READBACK_DROPPED_FIELDS.some((known) => known === field),
        `会丢弃清单出现未登记标识:${field}`,
      );
    }
  });

  await suite.case("失败路径:非 docx 字节 ⇒ 失败态(不谎报成功)", async () => {
    const result = await readbackDocx(new Uint8Array([1, 2, 3, 4, 5]));
    assertEq(result.status, "unreadable", "非 docx 字节应判失败态");
    assertEq(result.counts.headings, 0, "失败态不带计数");
  });

  await suite.case("侧信道:公式槽位 / 分页符 / 下边框 / 底纹", () => {
    const traits = extractDocumentTraits(DOCUMENT_XML);
    assertEq(traits.paragraphCount, 18, "段落总数(侧信道口径;含表格单元格内的 4 段)");
    // 公式段:公式前有「公式 」三个字
    const mathTraits = [...traits.paragraphs.values()].find((item) => item.math.length > 0);
    assert(mathTraits !== undefined, "应抽到公式槽位");
    assertEq(mathTraits?.math[0]?.beforeLength, 3, "公式前的文本长度(用于插回位置)");
    assertEq(mathTraits?.math[0]?.text, "x^2", "公式纯文本形态");
    // 引用段:底纹 F2F2F2
    const quoteTraits = [...traits.paragraphs.values()].find(
      (item) => item.shadingFill !== undefined,
    );
    assertEq(quoteTraits?.shadingFill, "F2F2F2", "引用块底纹");
    // 分隔线段:下边框
    assert(
      [...traits.paragraphs.values()].some((item) => item.bottomBorder),
      "应抽到下边框(分隔线)",
    );
    // 分页符段
    assert(
      [...traits.paragraphs.values()].some((item) => item.pageBreak),
      "应抽到分页符",
    );
  });

  await suite.case("侧信道对齐校验:段落数对不上 ⇒ 判为不对齐", () => {
    const tree = parseDocument(DOCUMENT_XML);
    const traits = extractDocumentTraits(DOCUMENT_XML);
    assert(traitsAligned(tree, traits), "自家稿形态下侧信道应与解析层对齐");
    const empty = extractDocumentTraits(null);
    assert(!traitsAligned(tree, empty), "空侧信道应判为不对齐");
  });

  await suite.case("mdast 构造:列表有序性与表格行结构", () => {
    const tree = parseDocument(DOCUMENT_XML);
    const built = buildReadbackTree({
      tree,
      numbering: parseNumbering(NUMBERING_XML),
      styles: parseStyles(STYLES_XML),
      traits: extractDocumentTraits(DOCUMENT_XML),
    });
    const lists = built.root.children.filter((node) => node.type === "list");
    assert(lists.length >= 2, `应至少有两个列表(无序 + 有序),实际 ${lists.length}`);
    const ordered = lists.find((node) => node.type === "list" && node.ordered === true);
    assert(ordered !== undefined, "应有有序列表(numFmt=decimal)");
    const unordered = lists.find((node) => node.type === "list" && node.ordered === false);
    assert(unordered !== undefined, "应有无序列表(numFmt=bullet)");
    const table = built.root.children.find((node) => node.type === "table");
    assert(table !== undefined, "应有表格节点");
    assertEq(table?.type === "table" ? table.children.length : 0, 2, "表格行数");
  });

  return { cases: suite.results };
}
