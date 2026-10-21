// @ts-check
/**
 * 样式部件解析测试(src/core/ooxml/part-styles.ts):
 * - docDefaults 与 w:style 的读取(属性顺序无关)
 * - basedOn 多层继承求解:派生覆盖祖先,祖先覆盖 docDefaults
 * - 继承链成环 ⇒ 判为不可解析(cycle 标记 + 只并自身属性),不死循环
 * 纯函数段,无产物输出。
 */
import {
  defaultStyleId,
  getDocDefaults,
  parseStyles,
  resolveStyle,
  styleBasedOn,
  styleDisplayName,
  styleIds,
  styleOutlineLevel,
  styleType,
} from "../../../dist/core/ooxml/part-styles.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "样式部件解析测试:docDefaults/样式读取 + basedOn 多层继承求解 + 继承链成环降级",
};
export const fixtures = null;

const STYLES_XML = `<?xml version="1.0"?>
<w:styles xmlns:w="urn:w">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:styleId="Heading1" w:type="paragraph">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Georgia" w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:basedOn w:val="Heading1"/>
    <w:rPr><w:sz w:val="28"/></w:rPr>
  </w:style>
</w:styles>`;

export async function run() {
  const suite = createCaseSuite();
  const table = parseStyles(STYLES_XML);

  await suite.case("parseStyles:读出 docDefaults 与全部样式", () => {
    const defaults = getDocDefaults(table);
    assert(defaults.run.fonts?.ascii === "Calibri", `docDefaults 的 ascii 应为 Calibri,实际 ${defaults.run.fonts?.ascii}`);
    assert(defaults.run.sizeHalfPoints === 22, "docDefaults 的字号应为 22 半磅");
    assert(defaults.paragraph.spacing?.line === 360, "docDefaults 的行距应为 360");
    assert(styleIds(table).length === 3, `样式数应为 3,实际 ${styleIds(table).length}`);
    assert(styleType(table, "Heading1") === "paragraph", "Heading1 的类型应为 paragraph");
    assert(styleDisplayName(table, "Heading1") === "heading 1", "Heading1 的显示名应为 heading 1");
    assert(styleBasedOn(table, "Heading2") === "Heading1", "Heading2 的 basedOn 应为 Heading1");
    assert(defaultStyleId(table, "paragraph") === "Normal", "默认段落样式应为 Normal");
    assert(defaultStyleId(table, "character") === undefined, "没有默认字符样式时应为 undefined");
  });

  await suite.case("parseStyles:属性顺序无关(styleId 在 type 之后)", () => {
    const swapped = parseStyles(`<w:styles xmlns:w="urn:w"><w:style w:styleId="X" w:type="paragraph"/></w:styles>`);
    assert(styleIds(swapped).length === 1, "换序后仍应读到一个样式");
    assert(styleType(swapped, "X") === "paragraph", "换序后 type 仍应取到");
  });

  await suite.case("resolveStyle:多层继承 —— 派生覆盖祖先,祖先覆盖 docDefaults", () => {
    const h2 = resolveStyle(table, "Heading2");
    assert(h2 !== null, "Heading2 应解出");
    if (h2 === null) return;
    assert(h2.cycle === false, "Heading2 的继承链不成环");
    assert(h2.run.sizeHalfPoints === 28, `Heading2 的字号应为自身 28,实际 ${h2.run.sizeHalfPoints}`);
    assert(h2.run.fonts?.ascii === "Georgia", "Heading2 应继承 Heading1 的 ascii=Georgia");
    assert(h2.run.fonts?.eastAsia === "黑体", "Heading2 应继承 Heading1 的 eastAsia=黑体");
    assert(h2.run.bold === true, "Heading2 应继承 Heading1 的加粗");
    assert(h2.paragraph.outlineLevel === 0, "Heading2 应继承 Heading1 的大纲级别");
    assert(h2.paragraph.spacing?.line === 360, "Heading2 应继承 docDefaults 的行距");
    assert(h2.chain.length === 3, `继承链长度应为 3,实际 ${h2.chain.length}`);
    assert(h2.chain[0] === "Heading2" && h2.chain[2] === "Normal", `继承链应为 Heading2→Heading1→Normal,实际 ${h2.chain.join("→")}`);
  });

  await suite.case("resolveStyle:只覆盖一半字段时祖先的另一半保留", () => {
    const h1 = resolveStyle(table, "Heading1");
    assert(h1 !== null, "Heading1 应解出");
    if (h1 === null) return;
    assert(h1.run.fonts?.eastAsia === "黑体", "Heading1 自身的 eastAsia 应保留");
    assert(h1.run.fonts?.hAnsi === undefined, "Heading1 未写 hAnsi 时不应凭空出现");
    assert(h1.run.sizeHalfPoints === 32, "Heading1 自身的字号应为 32");
  });

  await suite.case("resolveStyle:继承链成环 ⇒ 判为不可解析,不死循环", () => {
    const cyclic = parseStyles(
      `<w:styles xmlns:w="urn:w">` +
        `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/><w:rPr><w:sz w:val="40"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/><w:rPr><w:b/></w:rPr></w:style>` +
        `</w:styles>`,
    );
    const a = resolveStyle(cyclic, "A");
    assert(a !== null, "成环样式仍应解出(降级而非抛错)");
    if (a === null) return;
    assert(a.cycle === true, "成环应打上 cycle 标记");
    assert(a.run.sizeHalfPoints === 40, "成环时应保留自身属性");
    assert(a.run.bold === undefined, "成环时不应合并出不可信的祖先属性");
  });

  await suite.case("resolveStyle:未知样式 id ⇒ null", () => {
    assert(resolveStyle(table, "NoSuchStyle") === null, "未知样式应返回 null");
    assert(styleOutlineLevel(table, "NoSuchStyle") === undefined, "未知样式的大纲级别应是 undefined");
  });

  await suite.case("styleOutlineLevel:自身写了就取自己的,没写则沿继承链取", () => {
    assert(styleOutlineLevel(table, "Heading1") === 0, "Heading1 的大纲级别应为 0");
    assert(styleOutlineLevel(table, "Heading2") === 0, "Heading2 应沿继承链取到 0");
  });

  await suite.case("parseStyles:畸形与空部件 ⇒ 空表(不抛)", () => {
    const empty = parseStyles("");
    assert(styleIds(empty).length === 0, "空部件应得到空样式表");
    const missing = parseStyles(null);
    assert(styleIds(missing).length === 0, "缺部件(null)应得到空样式表");
    const broken = parseStyles("<w:styles><w:style");
    assert(styleIds(broken).length === 0, "畸形部件应得到空样式表");
  });

  console.log("[ok] 样式部件解析:docDefaults/样式读取 + basedOn 继承求解 + 成环降级 断言通过");
  return { cases: suite.results };
}
