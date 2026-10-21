// @ts-check
/**
 * OOXML 属性词汇测试(src/core/ooxml/properties.ts):
 * - run 侧:rFonts(显式字体名 + 主题引用分列)、sz 半磅、b/i 的 on-off 形态、color、u、vertAlign
 * - 段落侧:pStyle、jc、ind(字符单位与缇单位分列)、spacing、numPr、pageBreakBefore、outlineLvl
 * - 合并规则:子字段粒度(派生样式只写 eastAsia 不抹掉祖先的 ascii)
 * 纯函数段,无产物输出。
 */
import {
  mergeParagraphProperties,
  mergeRunProperties,
  readParagraphProperties,
  readRunProperties,
} from "../../../dist/core/ooxml/properties.js";
import { childOf, parseXml } from "../../../dist/core/ooxml/xml.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "OOXML 属性词汇测试:run/段落属性抽取 + 缺失与显式零的区分 + 子字段粒度合并",
};
export const fixtures = null;

/**
 * 解析一段 XML 并取某个元素(测试内的取数helper:根元素自身或它的某个子元素)。
 * @param {string} xml XML 文本
 * @param {string} localName 元素本地名
 * @returns {import("../../../dist/core/ooxml/xml.js").XmlElement | null} 元素
 */
function pick(xml, localName) {
  const root = parseXml(xml);
  if (root === null) return null;
  if (root.localName === localName) return root;
  return childOf(root, localName);
}

export async function run() {
  const suite = createCaseSuite();

  await suite.case("readRunProperties:字体名与主题引用分列留场", () => {
    const rPr = pick(
      `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="黑体" w:asciiTheme="majorHAnsi" w:eastAsiaTheme="minorEastAsia"/></w:rPr>`,
      "rPr",
    );
    const props = readRunProperties(rPr);
    assert(props.fonts !== undefined, "应读出字体集合");
    assert(props.fonts?.ascii === "Georgia", "ascii 应为 Georgia");
    assert(props.fonts?.hAnsi === "Georgia", "hAnsi 应为 Georgia");
    assert(props.fonts?.eastAsia === "黑体", "eastAsia 应为 黑体");
    assert(props.fonts?.asciiTheme === "majorHAnsi", "asciiTheme 应原样保留");
    assert(props.fonts?.eastAsiaTheme === "minorEastAsia", "eastAsiaTheme 应原样保留");
  });

  await suite.case("readRunProperties:字号半磅与 on-off 布尔", () => {
    const rPr = pick(
      `<w:rPr><w:rStyle w:val="Strong"/><w:sz w:val="24"/><w:szCs w:val="26"/><w:b/><w:i w:val="0"/><w:u w:val="single"/><w:color w:val="FF0000"/><w:vertAlign w:val="superscript"/></w:rPr>`,
      "rPr",
    );
    const props = readRunProperties(rPr);
    assert(props.runStyle === "Strong", `字符样式应为 Strong,实际 ${props.runStyle}`);
    assert(props.sizeHalfPoints === 24, "字号应为 24 半磅");
    assert(props.sizeCsHalfPoints === 26, "复杂文种字号应为 26 半磅");
    assert(props.bold === true, "无 val 的 w:b 应读出 true");
    assert(props.italic === false, "w:val=0 的 w:i 应读出 false");
    assert(props.underline === "single", "下划线形态应为 single");
    assert(props.color === "FF0000", "颜色应为 FF0000");
    assert(props.vertAlign === "superscript", "vertAlign 应为 superscript");
  });

  await suite.case("readRunProperties:元素缺失 ⇒ 空属性集(缺失不等于显式零)", () => {
    const props = readRunProperties(null);
    assert(props.bold === undefined, "缺失元素的属性应是 undefined(不是 false)");
    assert(props.sizeHalfPoints === undefined, "缺失字号应是 undefined");
    assert(Object.keys(props).length === 0, "缺失元素应得到空属性集");
  });

  await suite.case("readParagraphProperties:对齐/缩进/行距/编号/分页/大纲级别", () => {
    const pPr = pick(
      `<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr><w:jc w:val="center"/>` +
        `<w:ind w:left="420" w:right="120" w:firstLineChars="200" w:hanging="60"/>` +
        `<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>` +
        `<w:pageBreakBefore w:val="1"/><w:outlineLvl w:val="1"/></w:pPr>`,
      "pPr",
    );
    const props = readParagraphProperties(pPr);
    assert(props.style === "Heading1", "段落样式应为 Heading1");
    assert(props.align === "center", "对齐应为 center");
    assert(props.numbering?.numId === "7", "编号 id 应为 7");
    assert(props.numbering?.level === 1, "编号级别应为 1");
    assert(props.indent?.left === 420, "左缩进应为 420");
    assert(props.indent?.right === 120, "右缩进应为 120");
    assert(props.indent?.firstLineChars === 200, "首行字符数应为 200");
    assert(props.indent?.hanging === 60, "悬挂缩进应为 60");
    assert(props.spacing?.before === 120, "段前应为 120");
    assert(props.spacing?.after === 240, "段后应为 240");
    assert(props.spacing?.line === 360, "行距应为 360");
    assert(props.spacing?.lineRule === "auto", "行距规则应为 auto");
    assert(props.pageBreakBefore === true, "段前分页应为 true");
    assert(props.outlineLevel === 1, "大纲级别应为 1");
  });

  await suite.case("readParagraphProperties:缺 ilvl 时编号级别记 0", () => {
    const pPr = pick(`<w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr>`, "pPr");
    const props = readParagraphProperties(pPr);
    assert(props.numbering?.numId === "3", "编号 id 应为 3");
    assert(props.numbering?.level === 0, "缺 ilvl 时级别应为 0");
  });

  await suite.case("mergeRunProperties:子字段粒度合并,派生只写 eastAsia 不抹祖先 ascii", () => {
    const base = readRunProperties(pick(`<w:rPr><w:rFonts w:ascii="Georgia" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr>`, "rPr"));
    const over = readRunProperties(pick(`<w:rPr><w:rFonts w:eastAsia="黑体"/></w:rPr>`, "rPr"));
    const merged = mergeRunProperties(base, over);
    assert(merged.fonts?.ascii === "Georgia", "祖先的 ascii 不应被抹掉");
    assert(merged.fonts?.eastAsia === "黑体", "派生的 eastAsia 应覆盖祖先");
    assert(merged.sizeHalfPoints === 24, "祖先的字号应保留");
    const bold = mergeRunProperties(base, { bold: false });
    assert(bold.bold === false, "显式 false 应覆盖祖先的 true");
    assert(bold.fonts?.ascii === "Georgia", "覆盖布尔不应动字体");
  });

  await suite.case("mergeParagraphProperties:缩进与间距逐字段合并", () => {
    const base = readParagraphProperties(pick(`<w:pPr><w:jc w:val="left"/><w:ind w:left="420" w:hanging="60"/><w:spacing w:before="120"/></w:pPr>`, "pPr"));
    const over = readParagraphProperties(pick(`<w:pPr><w:jc w:val="right"/><w:ind w:left="720"/></w:pPr>`, "pPr"));
    const merged = mergeParagraphProperties(base, over);
    assert(merged.align === "right", "对齐应由派生覆盖");
    assert(merged.indent?.left === 720, "左缩进应由派生覆盖");
    assert(merged.indent?.hanging === 60, "悬挂缩进应保留祖先值");
    assert(merged.spacing?.before === 120, "段前应保留祖先值");
  });

  console.log("[ok] OOXML 属性词汇:run/段落属性抽取 + 合并规则 断言通过");
  return { cases: suite.results };
}
