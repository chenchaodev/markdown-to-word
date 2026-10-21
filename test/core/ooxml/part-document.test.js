// @ts-check
/**
 * 文档部件解析测试(src/core/ooxml/part-document.ts):
 * - 段落:pPr(样式/编号/对齐/缩进/行距)+ 游程(文本/换行/制表/字符属性)
 * - 段内有序条目:超链接(经关系表还原目标)、图片(尺寸与关系)、简单域与指令流域、
 *   批注标记、修订(插入/删除,删除文本取 w:delText)
 * - 表格:列宽表、行/单元格、跨列
 * - 节属性:页面尺寸/边距/朝向
 * - 畸形输入 ⇒ 空树,不抛
 * 纯函数段,无产物输出。
 */
import { parseDocument, paragraphsOf, tablesOf } from "../../../dist/core/ooxml/part-document.js";
import { parseRelationships } from "../../../dist/core/ooxml/part-rels.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "文档部件解析测试:段落/游程/超链接/图片/域/批注/修订/表格/节属性 + 畸形降级",
};
export const fixtures = null;

const DOCUMENT_XML = `<?xml version="1.0"?>
<w:document xmlns:w="urn:w" xmlns:r="urn:r" xmlns:a="urn:a" xmlns:wp="urn:wp">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading1"/>
        <w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr>
        <w:jc w:val="center"/>
        <w:ind w:left="420" w:firstLineChars="200"/>
        <w:spacing w:before="120" w:line="360" w:lineRule="auto"/>
      </w:pPr>
      <w:r><w:rPr><w:b/><w:rStyle w:val="Strong"/><w:rFonts w:ascii="Georgia"/></w:rPr><w:t xml:space="preserve">标题 </w:t></w:r>
      <w:r><w:br/><w:tab/><w:t>第二游程</w:t></w:r>
      <w:hyperlink r:id="rId3"><w:r><w:t>链接</w:t></w:r></w:hyperlink>
      <w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><a:graphic><a:blip r:embed="rId4"/></a:graphic></wp:inline></w:drawing></w:r>
      <w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>
      <w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r>
      <w:commentRangeStart w:id="3"/>
      <w:r><w:t>批注内</w:t></w:r>
      <w:commentRangeEnd w:id="3"/>
      <w:r><w:commentReference w:id="3"/></w:r>
      <w:ins w:id="5" w:author="甲" w:date="2026-10-21T00:00:00Z"><w:r><w:t>插入</w:t></w:r></w:ins>
      <w:del w:id="6" w:author="乙"><w:r><w:delText>删除</w:delText></w:r></w:del>
    </w:p>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>单元格</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:bottom="1440" w:left="1800" w:right="1800"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const RELS_XML = `<?xml version="1.0"?>
<Relationships xmlns="urn:rel">
  <Relationship Id="rId3" Type="urn:hyperlink" Target="https://example.com/a" TargetMode="External"/>
  <Relationship Id="rId4" Type="urn:image" Target="media/image1.png"/>
</Relationships>`;

export async function run() {
  const suite = createCaseSuite();
  const rels = parseRelationships(RELS_XML);
  const tree = parseDocument(DOCUMENT_XML, rels);

  await suite.case("段落属性:pStyle/编号/对齐/缩进/行距", () => {
    assert(tree.blocks.length === 2, `块数应为 2(段落+表格),实际 ${tree.blocks.length}`);
    const block = tree.blocks[0];
    assert(block?.kind === "paragraph", "首个块应是段落");
    if (block?.kind !== "paragraph") return;
    assert(block.style === "Heading1", `段落样式应为 Heading1,实际 ${block.style}`);
    assert(block.numbering?.numId === "7", `编号 id 应为 7,实际 ${block.numbering?.numId}`);
    assert(block.numbering?.level === 1, "编号级别应为 1");
    assert(block.align === "center", "对齐应为 center");
    assert(block.indent?.left === 420, "左缩进应为 420");
    assert(block.indent?.firstLineChars === 200, "首行字符数应为 200");
    assert(block.spacing?.line === 360, "行距应为 360");
    assert(block.spacing?.lineRule === "auto", "行距规则应为 auto");
  });

  await suite.case("游程:文本/换行/制表/字符属性", () => {
    const block = tree.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const first = block.items[0];
    assert(first?.kind === "run", "首个条目应是游程");
    if (first?.kind !== "run") return;
    assert(first.run.text === "标题 ", `首个游程文本应为「标题 」,实际 ${first.run.text}`);
    assert(first.run.properties.bold === true, "首个游程应加粗");
    assert(first.run.properties.runStyle === "Strong", `字符样式应为 Strong,实际 ${first.run.properties.runStyle}`);
    assert(first.run.properties.fonts?.ascii === "Georgia", "游程字体应为 Georgia");
    const second = block.items[1];
    assert(second?.kind === "run", "第二个条目应是游程");
    if (second?.kind !== "run") return;
    assert(second.run.breaks === 1, `换行数应为 1,实际 ${second.run.breaks}`);
    assert(second.run.tabs === 1, `制表符数应为 1,实际 ${second.run.tabs}`);
    assert(second.run.text === "第二游程", "第二个游程文本应为 第二游程");
  });

  await suite.case("超链接:经关系表还原外部目标与游程", () => {
    const block = tree.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const link = block.items.find((item) => item.kind === "hyperlink");
    assert(link !== undefined, "应取到超链接条目");
    if (link?.kind !== "hyperlink") return;
    assert(link.relationshipId === "rId3", `关系 id 应为 rId3,实际 ${link.relationshipId}`);
    assert(link.external === true, "外部链接应标为 external");
    assert(link.target === "https://example.com/a", `目标应为 https://example.com/a,实际 ${link.target}`);
    assert(link.items.length === 1, "超链接内应有一个游程");
  });

  await suite.case("图片:关系 id、尺寸(EMU)与目标", () => {
    const block = tree.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const drawing = block.items.find((item) => item.kind === "drawing");
    assert(drawing !== undefined, "应取到图片条目");
    if (drawing?.kind !== "drawing") return;
    assert(drawing.relationshipId === "rId4", `图片关系 id 应为 rId4,实际 ${drawing.relationshipId}`);
    assert(drawing.target === "media/image1.png", `图片目标应为 media/image1.png,实际 ${drawing.target}`);
    assert(drawing.widthEmu === 914400, `宽应为 914400 EMU,实际 ${drawing.widthEmu}`);
    assert(drawing.heightEmu === 457200, `高应为 457200 EMU,实际 ${drawing.heightEmu}`);
  });

  await suite.case("域:简单域与指令流域两种形态", () => {
    const block = tree.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const fields = block.items.filter((item) => item.kind === "field");
    assert(fields.length === 2, `应取到 2 个域,实际 ${fields.length}`);
    const simple = fields[0];
    assert(simple?.kind === "field" && simple.form === "simple", "首个域应是简单域");
    assert(simple?.kind === "field" && simple.instruction.trim() === "PAGE", `简单域指令应为 PAGE,实际 ${simple?.kind === "field" ? simple.instruction : ""}`);
    const complex = fields[1];
    assert(complex?.kind === "field" && complex.form === "instrText", "第二个域应是指令流域");
    assert(complex?.kind === "field" && complex.instruction.includes("TOC"), "指令流应含 TOC");
  });

  await suite.case("批注与修订标记", () => {
    const block = tree.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const start = block.items.find((item) => item.kind === "commentStart");
    const end = block.items.find((item) => item.kind === "commentEnd");
    const reference = block.items.find((item) => item.kind === "commentReference");
    assert(start?.kind === "commentStart" && start.commentId === "3", "应有批注起始标记(id=3)");
    assert(end?.kind === "commentEnd" && end.commentId === "3", "应有批注结束标记(id=3)");
    assert(reference?.kind === "commentReference" && reference.commentId === "3", "应有批注引用标记(id=3)");
    const insertion = block.items.find((item) => item.kind === "revision" && item.form === "insertion");
    assert(insertion?.kind === "revision" && insertion.author === "甲", "应有插入修订(作者甲)");
    const deletion = block.items.find((item) => item.kind === "revision" && item.form === "deletion");
    assert(deletion?.kind === "revision" && deletion.author === "乙", "应有删除修订(作者乙)");
    assert(deletion?.kind === "revision" && deletion.items[0]?.kind === "run", "删除修订内应有游程");
    const deletedRun = deletion?.kind === "revision" ? deletion.items[0] : undefined;
    assert(deletedRun?.kind === "run" && deletedRun.run.text === "删除", "删除文本应取自 w:delText");
  });

  await suite.case("表格:列宽表、行与单元格、跨列", () => {
    const table = tree.blocks[1];
    assert(table?.kind === "table", "第二个块应是表格");
    if (table?.kind !== "table") return;
    assert(table.gridWidthsTwips.length === 2, `列宽应有 2 项,实际 ${table.gridWidthsTwips.length}`);
    assert(table.gridWidthsTwips[0] === 2000 && table.gridWidthsTwips[1] === 3000, "列宽应为 2000/3000");
    assert(table.rows.length === 1, `行数应为 1,实际 ${table.rows.length}`);
    const cells = table.rows[0]?.cells ?? [];
    assert(cells.length === 2, `单元格数应为 2,实际 ${cells.length}`);
    assert(cells[0]?.widthTwips === 2000, "首格宽应为 2000");
    assert(cells[1]?.gridSpan === 2, "次格应跨 2 列");
    assert(cells[0]?.blocks[0]?.kind === "paragraph", "单元格内应是段落");
    const cellParagraph = cells[0]?.blocks[0];
    assert(cellParagraph?.kind === "paragraph" && cellParagraph.items[0]?.kind === "run", "单元格段落应有游程");
  });

  await suite.case("节属性:页面尺寸/边距/朝向", () => {
    assert(tree.sections.length === 1, `节数应为 1,实际 ${tree.sections.length}`);
    const section = tree.sections[0];
    assert(section?.pageWidthTwips === 11906, `页宽应为 11906,实际 ${section?.pageWidthTwips}`);
    assert(section?.pageHeightTwips === 16838, `页高应为 16838,实际 ${section?.pageHeightTwips}`);
    assert(section?.orientation === "portrait", "朝向应为 portrait");
    assert(section?.marginTopTwips === 1440, "上边距应为 1440");
    assert(section?.marginLeftTwips === 1800, "左边距应为 1800");
    assert(section?.marginRightTwips === 1800, "右边距应为 1800");
  });

  await suite.case("取段与取表:表格单元格内的段落也算段落", () => {
    const paragraphs = paragraphsOf(tree);
    // 1 个正文段落 + 2 个单元格段落(第二格是空段落,也算一段)
    assert(paragraphs.length === 3, `段落数应为 3(含两个单元格),实际 ${paragraphs.length}`);
    assert(tablesOf(tree).length === 1, "表格数应为 1");
  });

  await suite.case("无关系表时超链接与图片降级为无目标(不抛)", () => {
    const bare = parseDocument(DOCUMENT_XML);
    const block = bare.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("首个块不是段落");
    const link = block.items.find((item) => item.kind === "hyperlink");
    assert(link?.kind === "hyperlink" && link.target === undefined, "无关系表时链接目标应是 undefined");
    const drawing = block.items.find((item) => item.kind === "drawing");
    assert(drawing?.kind === "drawing" && drawing.target === undefined, "无关系表时图片目标应是 undefined");
    assert(drawing?.kind === "drawing" && drawing.widthEmu === 914400, "尺寸不依赖关系表,仍应读出");
  });

  await suite.case("块级内容控件(w:sdt)展开为块(目录控件形态)", () => {
    const withSdt = parseDocument(
      `<w:document xmlns:w="urn:w"><w:body>` +
        `<w:sdt><w:sdtPr><w:alias w:val="目录"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>目录项</w:t></w:r></w:p>` +
        `</w:sdtContent></w:sdt>` +
        `<w:p><w:r><w:t>正文</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    assert(withSdt.blocks.length === 2, `sdt 内的段落应被展开,块数应为 2,实际 ${withSdt.blocks.length}`);
    const first = withSdt.blocks[0];
    assert(first?.kind === "paragraph" && first.style === "TOC1", "展开后的首块应是 TOC1 段落");
    assert(paragraphsOf(withSdt).length === 2, "sdt 内的段落也应计入段落总数");
  });

  await suite.case("畸形 / 缺部件 ⇒ 空树,不抛", () => {
    const empty = parseDocument("");
    assert(empty.blocks.length === 0, "空部件应得到空树");
    assert(empty.sections.length === 0, "空部件应无节属性");
    const missing = parseDocument(null);
    assert(missing.blocks.length === 0, "缺部件(null)应得到空树");
    const broken = parseDocument("<w:document><w:body><w:p>");
    assert(broken.blocks.length <= 1, "畸形部件应尽力解析且不抛");
  });

  console.log("[ok] 文档部件解析:段落/条目/表格/节属性 + 畸形降级 断言通过");
  return { cases: suite.results };
}
