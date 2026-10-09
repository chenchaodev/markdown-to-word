// @ts-check
/**
 * docx 模板导入(浅导入 v1)测试:
 * - 用 jszip 构造最小 .docx(Normal/Heading1 样式 + 文档 sectPr),验证 importDocxTemplate
 *   提取字体/字号(标题样式优先)+ 页面尺寸/边距(纸张匹配 + 朝向判定)
 * - 复用既有单 convert 通路,此测试锁定提取映射不被回归
 */
import JSZip from "jszip";
import { importDocxTemplate } from "../../dist/core/docx/template-import.js";
import { createCaseSuite } from "../harness/case.js";


const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const stylesXml = `<?xml version="1.0"?>
<w:styles ${W}>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:eastAsia="黑体"/>
    </w:rPr>
  </w:style>
</w:styles>`;

/**
 * 造最小 document.xml(页面尺寸 + 四边边距)。
 * @param {number} pgSzW 页宽(twips)
 * @param {number} pgSzH 页高(twips)
 * @param {number} mar 四边边距(twips)
 * @returns {string} document.xml 文本
 */
function docXml(pgSzW, pgSzH, mar) {
  return `<?xml version="1.0"?>
<w:document ${W}>
  <w:body>
    <w:p><w:r><w:t>hello</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="${pgSzW}" w:h="${pgSzH}"/>
      <w:pgMar w:top="${mar}" w:bottom="${mar}" w:left="${mar}" w:right="${mar}"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

/**
 * 打包最小 .docx(styles.xml + document.xml)。
 * @param {string} styles styles.xml 文本
 * @param {string} doc document.xml 文本
 * @returns {Promise<Uint8Array>} docx 字节
 */
export async function buildDocx(styles, doc) {
  const zip = new JSZip();
  zip.file("word/styles.xml", styles);
  zip.file("word/document.xml", doc);
  return zip.generateAsync({ type: "uint8array" });
}

export const meta = { description: "docx 模板导入(浅导入 v1)测试:" };
export const fixtures = { main: stylesXml };

export async function run() {
  // 案例 1:纵向 A4(11906×16838 twips)+ 1440 twips(25.4mm)边距
  const suite = createCaseSuite();
  // 四边边距键序固定:边距 case 名逐键取自它
  const MARGIN_KEYS = /** @type {("marginTop" | "marginBottom" | "marginLeft" | "marginRight")[]} */ ([
    "marginTop",
    "marginBottom",
    "marginLeft",
    "marginRight",
  ]);

  // 案例 1:纵向 A4(11906×16838 twips)+ 1440 twips(25.4mm)边距
  const buf1 = await buildDocx(stylesXml, docXml(11906, 16838, 1440));
  const r1 = await importDocxTemplate(buf1);
  // 字体:标题样式(Heading1)优先 → Georgia / 黑体;字号取 Normal 24 half-pt → 12pt
  await suite.case("案例1 西文字体取 Heading1 的 Georgia", () => {
    if (r1.typography.fontAscii !== "Georgia") throw new Error(`模板导入(adr-008) 断言失败:字体应为 Georgia,实得 ${r1.typography.fontAscii}`);
  });
  await suite.case("案例1 中文字体取 Heading1 的 黑体", () => {
    if (r1.typography.fontEastAsia !== "黑体") throw new Error(`模板导入(adr-008) 断言失败:中文字体应为 黑体,实得 ${r1.typography.fontEastAsia}`);
  });
  await suite.case("案例1 正文字号取 Normal 的 12pt", () => {
    if (r1.typography.bodySizePt !== 12) throw new Error(`模板导入(adr-008) 断言失败:字号应为 12pt,实得 ${r1.typography.bodySizePt}`);
  });
  // 页面:A4 纵向 + 四边 25.4mm
  await suite.case("案例1 纸张识别为 A4", () => {
    if (r1.pageSetup.paper !== "A4") throw new Error(`模板导入(adr-008) 断言失败:纸张应为 A4,实得 ${r1.pageSetup.paper}`);
  });
  await suite.case("案例1 朝向判定为 portrait", () => {
    if (r1.pageSetup.orientation !== "portrait") throw new Error(`模板导入(adr-008) 断言失败:朝向应为 portrait`);
  });
  // 四边各自一个 case:某一边距读错不该掩盖另三边
  for (const k of MARGIN_KEYS) {
    await suite.case(`案例1 边距 ${k} 约 25.4mm`, () => {
      // 边距缺失时按 NaN 比较(与原实现一致,不因此处收窄改变判定)
      const v = /** @type {number} */ (r1.pageSetup[k]);
      if (Math.abs(v - 25.4) > 0.2) throw new Error(`模板导入(adr-008) 断言失败:边距 ${k} 应为 ~25.4mm,实得 ${v}`);
    });
  }
  console.log("[ok] 模板导入(adr-008) 浅导入:纵向 A4 + 字体/字号/边距提取 断言通过");

  // 案例 2:横向 Letter(交换 w/h:15840×12240)+ 720 twips(12.7mm)边距 → landscape
  const letterLandW = 15840; // 279.4mm
  const letterLandH = 12240; // 215.9mm
  const buf2 = await buildDocx(stylesXml, docXml(letterLandW, letterLandH, 720));
  const r2 = await importDocxTemplate(buf2);
  await suite.case("案例2 纸张识别为 Letter", () => {
    if (r2.pageSetup.paper !== "Letter") throw new Error(`模板导入(adr-008) 断言失败:纸张应为 Letter,实得 ${r2.pageSetup.paper}`);
  });
  await suite.case("案例2 朝向判定为 landscape", () => {
    if (r2.pageSetup.orientation !== "landscape") throw new Error(`模板导入(adr-008) 断言失败:朝向应为 landscape`);
  });
  for (const k of MARGIN_KEYS) {
    await suite.case(`案例2 边距 ${k} 约 12.7mm`, () => {
      // 边距缺失时按 NaN 比较(与原实现一致,不因此处收窄改变判定)
      const v = /** @type {number} */ (r2.pageSetup[k]);
      if (Math.abs(v - 12.7) > 0.2) throw new Error(`模板导入(adr-008) 断言失败:边距 ${k} 应为 ~12.7mm,实得 ${v}`);
    });
  }
  console.log("[ok] 模板导入(adr-008) 浅导入:横向 Letter + 朝向判定 + 边距提取 断言通过");
  return { cases: suite.results };
}
