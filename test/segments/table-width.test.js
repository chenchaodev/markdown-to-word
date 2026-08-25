/**
 * 表格列宽控制段(F2):分隔行 dash 比例信号(Pandoc pipe-tables 行为)。
 * 覆盖四类断言(零注册):
 * (a) 解析纯函数直测(core/markdown/table-width.ts:分隔行词法/冒号不计/
 *     阈值判定/百分比取整守恒);
 * (b) docx 产物断言(tblGrid gridCol DXA 比例 + 固定布局 + 单元格 tcW 同步 +
 *     对齐样式共存);
 * (c) pdf 产物断言(table-layout:fixed + 首行 th width:N% 注入 + 对齐样式以
 *     「;」拼接保留);
 * (d) 阈值边界与回归(等宽 dash 完全不变:无固定布局/无 tcW/gridCol 保持库
 *     默认;多表各自独立取信号)。
 * 总宽契约:A4 纵向默认边距内容区宽(mm→twips 单源 settings-defaults,
 * contentWidthPx×15 回 twips),期望值经同一契约函数计算。
 */
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { convert } from "../../dist/core/convert.js";
import {
  parseDelimiterRow,
  delimiterWidthsPercent,
  tableColumnWidthsFromSource,
  TABLE_WIDTH_MIN_MAX_DASHES,
  TABLE_WIDTH_RATIO_THRESHOLD,
} from "../../dist/core/markdown/table-width.js";
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES_MM,
  mmToTwips,
  twipsToPx,
} from "../../dist/core/settings/settings-defaults.js";
import { unzipPart } from "../common/docx-utils.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`table-width 断言失败:${msg}`);
}

/** 内容区总宽(DXA/twips)契约值:A4 纵向默认边距(docx 渲染同链路换算) */
const CONTENT_WIDTH_MM =
  PAPER_SIZES_MM[DEFAULT_PAGE_SETUP.paper].width -
  DEFAULT_PAGE_SETUP.marginLeft -
  DEFAULT_PAGE_SETUP.marginRight; // 146mm
const TOTAL_DXA = Math.round(twipsToPx(mmToTwips(CONTENT_WIDTH_MM)) * 15); // 8277

export async function run() {
  // ================= (a) 解析纯函数直测 =================
  // 分隔行词法:对齐冒号不计入 dash 数;首尾管道可省略;空白容忍
  assert(JSON.stringify(parseDelimiterRow("|---|:-----------:|")) === "[3,11]", "冒号不计入(:-----------: 按 11 计)");
  assert(JSON.stringify(parseDelimiterRow(":---:|---")) === "[3,3]", "首尾管道可省略");
  assert(JSON.stringify(parseDelimiterRow("| :-- | --: | :-: |")) === "[2,2,1]", "空白与混合对齐容忍(逐列计数)");
  assert(parseDelimiterRow("| a | b |") === null, "内容行不是分隔行");
  assert(parseDelimiterRow("---") === null, "hr 语法不是分隔行(不含管道)");
  assert(parseDelimiterRow("| --- | x |") === null, "含非 dash 单元格整体判非法");
  assert(parseDelimiterRow("| ||") === null, "空单元格非法");
  // 阈值判定:max ≥ 5 且 max/min ≥ 3 才触发
  assert(TABLE_WIDTH_MIN_MAX_DASHES === 5 && TABLE_WIDTH_RATIO_THRESHOLD === 3, "阈值常量契约(5 与 3)");
  assert(delimiterWidthsPercent([4, 4]) === null, "等宽 dash 不触发(维持现状)");
  assert(delimiterWidthsPercent([1, 1, 1]) === null, "全 1 dash 不触发(都很少)");
  assert(delimiterWidthsPercent([2, 5]) === null, "max 达 5 但比例 <3 不触发(边界)");
  assert(delimiterWidthsPercent([3, 12]) !== null, "max ≥5 且比例 ≥3 触发");
  assert(delimiterWidthsPercent([1, 10]) !== null, "悬殊比例触发");
  assert(delimiterWidthsPercent([]) === null, "空数组不触发");
  // 百分比换算:前 n-1 列四舍五入、末列吸收余数(和恒为 100)
  assert(JSON.stringify(delimiterWidthsPercent([3, 11])) === "[21,79]", "[3,11] → [21,79](末列吸收余数)");
  assert(JSON.stringify(delimiterWidthsPercent([1, 10])) === "[9,91]", "[1,10] → [9,91](末列吸收余数)");
  const triple = delimiterWidthsPercent([1, 1, 10]);
  assert(triple[0] + triple[1] + triple[2] === 100 && triple[2] === 84, "三列取整后总和守恒为 100");
  // 源码行入口:表头行号(0-based)+ 下一行分隔行;越界安全
  const lines = ["text", "| A | B |", "|---|:-----------:|", "| 1 | 2 |"];
  assert(JSON.stringify(tableColumnWidthsFromSource(lines, 1)) === "[21,79]", "源码行入口按表头行号解析");
  assert(tableColumnWidthsFromSource(lines, 99) === null, "越界行号按无信号处理(null)");
  console.log("[ok] table-width:(a) 解析纯函数直测(分隔行词法/冒号不计/阈值判定/取整守恒)断言通过");

  // ================= (b) docx 产物断言 =================
  // 样例一:两列 [3,12] → 21%/79%;样例二:等宽三列(回归对照,同文档互不干扰)
  const docxMd = [
    "| A | B |",
    "|---|:-----------:|",
    "| 1 | 2 |",
    "",
    "| X | Y | Z |",
    "|---|---|---|",
    "| 1 | 2 | 3 |",
    "",
  ].join("\n");
  const buffer = await renderDocx(parseMarkdown(docxMd), {});
  const xml = await unzipPart(buffer, "word/document.xml");
  // tblGrid:21% → round(8277×0.21)=1738;末列吸收余量 = 8277−1738=6539
  assert(
    xml.includes(`<w:tblGrid><w:gridCol w:w="1738"/><w:gridCol w:w="6539"/></w:tblGrid>`),
    `比例表应生成 tblGrid(1738/6539,总宽 ${TOTAL_DXA} DXA)`,
  );
  assert(xml.includes('<w:tblLayout w:type="fixed"/>'), "比例表应为固定布局(tblLayout fixed)");
  assert(xml.includes('<w:tcW w:type="dxa" w:w="1738"/>') && xml.includes('<w:tcW w:type="dxa" w:w="6539"/>'), "单元格 tcW 应与 gridCol 同步(dxa)");
  // 对齐样式与列宽共存:B 列居中(:-----------:)仍映射 w:jc center(B3 行为不变)
  const jcCenterInCell = /<w:tcW w:type="dxa" w:w="6539"\/>[\s\S]*?<w:jc w:val="center"\/>[\s\S]*?<\/w:tc>/.test(xml);
  assert(jcCenterInCell, "B 列(79%)居中对齐应与列宽共存(w:jc center)");
  console.log("[ok] table-width:(b) docx tblGrid 比例宽度 + 固定布局 + tcW 同步 + 对齐共存 断言通过");

  // ================= (c) pdf 产物断言 =================
  const pdfWarnings = [];
  const pdf = await convert(docxMd, "pdf", { baseDir: ".", warnings: pdfWarnings });
  const tables = pdf.html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  assert(tables.length === 2, "两个表格均应渲染");
  assert(tables[0].startsWith('<table style="table-layout:fixed">'), "比例表应注入 table-layout:fixed");
  assert(tables[0].includes('<th style="width:21%">'), "比例表首列 th 应注入 width:21%");
  assert(tables[0].includes('<th style="text-align:center;width:79%">'), "比例表次列对齐样式应以「;」拼接保留(width 追加)");
  // 等宽表完全不受影响(回归)
  assert(tables[1].startsWith("<table>"), "等宽表不应注入任何样式(回归)");
  assert(!tables[1].includes("table-layout"), "等宽表无固定布局(回归)");
  console.log("[ok] table-width:(c) pdf table-layout:fixed + th width% 注入 + 对齐拼接保留 断言通过");

  // ================= (d) 阈值边界与多表独立 =================
  // 边界一:[3,5] 比例 5/3 <3 不触发;边界二:[2,10] 比例 5 ≥3 触发
  const edgeMd = [
    "| 边界一 | 不触发 |",
    "|---|-----|",
    "| a | b |",
    "",
    "| 边界二 | 触发 |",
    "|--|----------|",
    "| a | b |",
    "",
  ].join("\n");
  const edgePdf = await convert(edgeMd, "pdf", { baseDir: ".", warnings: [] });
  const edgeTables = edgePdf.html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  assert(edgeTables.length === 2, "边界用例两个表格均应渲染");
  assert(!edgeTables[0].includes("table-layout"), "[3,5] 比例不足不触发(阈值下界)");
  assert(edgeTables[1].includes("table-layout:fixed"), "[2,10] 比例达标触发(阈值上界)");
  // 多表独立:同一文档内各表按各自分隔行取信号(前文 b/c 已覆盖两表场景,此处
  // 断言 docx 侧第二个表无 tcW——信号只作用于触发表)
  const edgeAst = parseMarkdown(edgeMd);
  assert(edgeAst.children[0]?.type === "table" && edgeAst.children[0].data?.colWidthsPct === undefined, "边界一解析期即无信号(data 缺省)");
  assert(JSON.stringify(edgeAst.children[1]?.data?.colWidthsPct) === "[17,83]", "边界二解析期挂 colWidthsPct([2,10] → [17,83])");
  const edgeBuffer = await renderDocx(edgeAst, {});
  const edgeXml = await unzipPart(edgeBuffer, "word/document.xml");
  assert((edgeXml.match(/<w:tblLayout w:type="fixed"\/>/g) ?? []).length === 1, "仅触发表的固定布局(逐表独立)");
  assert((edgeXml.match(/<w:tcW /g) ?? []).length === 4, "仅触发表写单元格 tcW(2 行 × 2 列;未触发表回归不写)");
  console.log("[ok] table-width:(d) 阈值边界([3,5]/[2,10])+ 多表独立取信号 断言通过");

  // ================= (e) 等宽回归:docx 序列化逐字节不变 =================
  // basic-render 全要素样例的等宽表(| ---- | ---- | ---- |):无固定布局、无 tcW、
  // gridCol 保持 docx 库缺省占位(w=100),与 F2 之前序列化完全一致
  const plainMd = "| 功能 | 状态 |\n| ---- | ---- |\n| 标题渲染 | 完成 |\n";
  const plainBuffer = await renderDocx(parseMarkdown(plainMd), {});
  const plainXml = await unzipPart(plainBuffer, "word/document.xml");
  assert(!plainXml.includes("<w:tblLayout"), "等宽表无 tblLayout(序列化不变)");
  assert(!plainXml.includes("<w:tcW"), "等宽表无 tcW(序列化不变)");
  assert(plainXml.includes('<w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid>'), "等宽表 gridCol 保持库缺省占位(序列化不变)");
  console.log("[ok] table-width:(e) 等宽 dash 表 docx 序列化逐项不变(回归)断言通过");
}
