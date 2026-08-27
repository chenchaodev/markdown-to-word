/**
 * F9 docx 模板导入(浅导入 v1)测试:
 * - 用 jszip 构造最小 .docx(Normal/Heading1 样式 + 文档 sectPr),验证 importDocxTemplate
 *   提取字体/字号(标题样式优先)+ 页面尺寸/边距(纸张匹配 + 朝向判定)
 * - 复用既有单 convert 通路,此测试锁定提取映射不被回归
 */
import JSZip from "jszip";
import { importDocxTemplate } from "../../dist/core/docx/template-import.js";

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

export async function buildDocx(styles, doc) {
  const zip = new JSZip();
  zip.file("word/styles.xml", styles);
  zip.file("word/document.xml", doc);
  return zip.generateAsync({ type: "uint8array" });
}

export const fixtures = { main: stylesXml };

export async function run() {
  // 案例 1:纵向 A4(11906×16838 twips)+ 1440 twips(25.4mm)边距
  const buf1 = await buildDocx(stylesXml, docXml(11906, 16838, 1440));
  const r1 = await importDocxTemplate(buf1);
  // 字体:标题样式(Heading1)优先 → Georgia / 黑体;字号取 Normal 24 half-pt → 12pt
  if (r1.typography.fontAscii !== "Georgia") throw new Error(`F9 断言失败:字体应为 Georgia,实得 ${r1.typography.fontAscii}`);
  if (r1.typography.fontEastAsia !== "黑体") throw new Error(`F9 断言失败:中文字体应为 黑体,实得 ${r1.typography.fontEastAsia}`);
  if (r1.typography.bodySizePt !== 12) throw new Error(`F9 断言失败:字号应为 12pt,实得 ${r1.typography.bodySizePt}`);
  // 页面:A4 纵向 + 四边 25.4mm
  if (r1.pageSetup.paper !== "A4") throw new Error(`F9 断言失败:纸张应为 A4,实得 ${r1.pageSetup.paper}`);
  if (r1.pageSetup.orientation !== "portrait") throw new Error(`F9 断言失败:朝向应为 portrait`);
  for (const k of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
    const v = r1.pageSetup[k];
    if (Math.abs(v - 25.4) > 0.2) throw new Error(`F9 断言失败:边距 ${k} 应为 ~25.4mm,实得 ${v}`);
  }
  console.log("[ok] F9 浅导入:纵向 A4 + 字体/字号/边距提取 断言通过");

  // 案例 2:横向 Letter(交换 w/h:15840×12240)+ 720 twips(12.7mm)边距 → landscape
  const letterLandW = 15840; // 279.4mm
  const letterLandH = 12240; // 215.9mm
  const buf2 = await buildDocx(stylesXml, docXml(letterLandW, letterLandH, 720));
  const r2 = await importDocxTemplate(buf2);
  if (r2.pageSetup.paper !== "Letter") throw new Error(`F9 断言失败:纸张应为 Letter,实得 ${r2.pageSetup.paper}`);
  if (r2.pageSetup.orientation !== "landscape") throw new Error(`F9 断言失败:朝向应为 landscape`);
  for (const k of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
    const v = r2.pageSetup[k];
    if (Math.abs(v - 12.7) > 0.2) throw new Error(`F9 断言失败:边距 ${k} 应为 ~12.7mm,实得 ${v}`);
  }
  console.log("[ok] F9 浅导入:横向 Letter + 朝向判定 + 边距提取 断言通过");
}
