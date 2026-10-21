// @ts-check
/**
 * 编号部件解析测试(src/core/ooxml/part-numbering.ts):
 * - w:abstractNum 的各级定义(按 w:ilvl 索引,缺级不塌陷)
 * - w:num → w:abstractNumId 的引用解
 * - w:lvlOverride 的 startOverride 与自带 w:lvl 覆盖
 * - 引用链断掉 ⇒ null(降级不抛)
 * 纯函数段,无产物输出。
 */
import { parseNumbering, resolveNumberingLevel } from "../../../dist/core/ooxml/part-numbering.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "编号部件解析测试:abstractNum 级别表 + numId 引用解 + lvlOverride 覆盖 + 断链降级",
};
export const fixtures = null;

const NUMBERING_XML = `<?xml version="1.0"?>
<w:numbering xmlns:w="urn:w">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="2">
      <w:start w:val="3"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="%1)"/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2">
    <w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride>
  </w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="99"/></w:num>
</w:numbering>`;

export async function run() {
  const suite = createCaseSuite();
  const table = parseNumbering(NUMBERING_XML);

  await suite.case("parseNumbering:读出抽象编号与级别表(按 ilvl 索引)", () => {
    assert(table.abstracts.size === 2, `抽象编号数应为 2,实际 ${table.abstracts.size}`);
    assert(table.nums.size === 3, `编号实例数应为 3,实际 ${table.nums.size}`);
    const abstract = table.abstracts.get("0");
    assert(abstract !== undefined, "应读到 abstractNum 0");
    assert(abstract?.levels.size === 2, `abstractNum 0 应有 2 个级别,实际 ${abstract?.levels.size}`);
    assert(abstract?.levels.get(0)?.numFmt === "decimal", "0 级格式应为 decimal");
    assert(abstract?.levels.get(2)?.numFmt === "bullet", "2 级格式应为 bullet");
    assert(abstract?.levels.get(1) === undefined, "缺级不应被补成 1 级");
  });

  await suite.case("resolveNumberingLevel:取该级的格式与起始值", () => {
    const level = resolveNumberingLevel(table, "1", 0);
    assert(level !== null, "numId=1 ilvl=0 应解出");
    assert(level?.numFmt === "decimal", `格式应为 decimal,实际 ${level?.numFmt}`);
    assert(level?.lvlText === "%1.", `级别文本应为 %1.,实际 ${level?.lvlText}`);
    assert(level?.start === 1, `起始值应为 1,实际 ${level?.start}`);
    assert(level?.indent?.left === 420, "级别缩进应为 420");
    assert(level?.indent?.hanging === 420, "级别悬挂缩进应为 420");
    const bullet = resolveNumberingLevel(table, "1", 2);
    assert(bullet?.numFmt === "bullet", "2 级应是 bullet");
    assert(bullet?.start === 3, "2 级起始值应为 3");
  });

  await suite.case("resolveNumberingLevel:startOverride 覆盖起始值", () => {
    const level = resolveNumberingLevel(table, "2", 0);
    assert(level?.numFmt === "lowerLetter", "格式应取自抽象编号");
    assert(level?.start === 5, `startOverride 后起始值应为 5,实际 ${level?.start}`);
  });

  await suite.case("resolveNumberingLevel:引用断链或级别缺失 ⇒ null", () => {
    assert(resolveNumberingLevel(table, "3", 0) === null, "指向不存在的抽象编号应返回 null");
    assert(resolveNumberingLevel(table, "404", 0) === null, "不存在的 numId 应返回 null");
    assert(resolveNumberingLevel(table, "1", 1) === null, "该级不存在应返回 null");
  });

  await suite.case("parseNumbering:缺部件 / 畸形 ⇒ 空表(不抛)", () => {
    const empty = parseNumbering("");
    assert(empty.nums.size === 0, "空部件应得到空编号表");
    const missing = parseNumbering(null);
    assert(missing.nums.size === 0, "缺部件(null)应得到空编号表");
    const broken = parseNumbering("<w:numbering><w:num");
    assert(broken.abstracts.size === 0, "畸形部件应得到空编号表");
  });

  console.log("[ok] 编号部件解析:级别表 + 引用解 + 覆盖 + 断链降级 断言通过");
  return { cases: suite.results };
}
