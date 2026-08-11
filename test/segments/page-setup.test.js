/**
 * 页面设置验收(中优先级缺口:非 A4 纸张 + 边距值):
 * docx 断言 w:pgSz(纸张 twips + w:orient)与 w:pgMar(四边距 twips)精确值;
 * pdf 断言 @page size/margin 模板参数化;landscape + 非 A4 组合按实现断言。
 *
 * 实现事实(断言依据,勿臆测标准值):
 * - src/core/docx/render.ts PAPER_SIZES_MM(宽×高 mm):
 *   A4 210×297 / A3 297×420 / A5 148×210 / Letter 215.9×279.4 / Legal 215.9×355.6
 * - mmToTwips = Math.round(mm × 56.6929)(render.ts)
 * - docx 9.7.1 createPageSize:landscape 时自动交换 → w:w=高度 twips、w:h=宽度
 *   twips,并写 w:orient="landscape"(纵向亦写 w:orient="portrait");
 *   w:pgMar 属性顺序 top/right/bottom/left(createPageMargin)
 * - src/core/pdf/template.ts buildTemplateCss:
 *   @page { size: ${paper}${" landscape"}; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

const md = `页面设置验收:纸张与边距参数化。\n`;

// 纸张 → 纵向 twips(宽, 高)= round(mm × 56.6929),来源 PAPER_SIZES_MM
const PAPERS_TWIPS = {
  A4: [11906, 16838], // 210×297
  A3: [16838, 23811], // 297×420
  A5: [8391, 11906], // 148×210
  Letter: [12240, 15840], // 215.9×279.4
  Legal: [12240, 20160], // 215.9×355.6
};

// 边距组 1(四值互异,防属性错位):20/40/30/15 mm → 1134/2268/1701/850 twips
const M1 = { marginTop: 20, marginRight: 40, marginBottom: 30, marginLeft: 15 };
const M1_PGMAR = '<w:pgMar w:top="1134" w:right="2268" w:bottom="1701" w:left="850"';
const M1_PDF = "margin: 20mm 40mm 30mm 15mm;";

/** 页面设置验收 */
export async function run() {
  // 1. 五种纸张(纵向)+ 边距组 1:docx pgSz/pgMar 与 pdf @page 精确断言
  let lastDocx;
  let lastPdf;
  for (const [paper, [w, h]] of Object.entries(PAPERS_TWIPS)) {
    const pageSetup = { paper, orientation: "portrait", ...M1 };
    lastDocx = await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings: [], pageSetup });
    const xml = unzipPart(lastDocx.buffer, "word/document.xml");
    const pgSz = `<w:pgSz w:w="${w}" w:h="${h}" w:orient="portrait"`;
    if (!xml.includes(pgSz)) {
      throw new Error(`页面设置断言失败:${paper} 纵向缺少 ${pgSz}(PAPER_SIZES_MM × 56.6929 取整)`);
    }
    if (!xml.includes(M1_PGMAR)) {
      throw new Error(`页面设置断言失败:${paper} 缺少 ${M1_PGMAR}(边距 20/40/30/15 mm → twips)`);
    }
    lastPdf = await convert(md, "pdf", { baseDir: FIXTURES_DIR, warnings: [], pageSetup });
    const pageCss = `size: ${paper}; ${M1_PDF}`;
    if (!lastPdf.html.includes(pageCss)) {
      throw new Error(`页面设置断言失败:${paper} PDF 模板缺少 ${pageCss}`);
    }
    console.log(`[ok] 页面设置:${paper} 纵向 docx pgSz ${w}×${h}/pgMar + pdf @page 断言通过`);
  }

  // 2. 边距参数化(第二组 = Word 默认 25/25/32/32 mm → 1417/1814 twips,输出须不同)
  const pageSetup2 = { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 };
  const docx2 = await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings: [], pageSetup: pageSetup2 });
  const xml2 = unzipPart(docx2.buffer, "word/document.xml");
  const pgMar2 = '<w:pgMar w:top="1417" w:right="1814" w:bottom="1417" w:left="1814"';
  if (!xml2.includes(pgMar2)) {
    throw new Error(`页面设置断言失败:边距 25/32 mm 缺少 ${pgMar2}`);
  }
  const pdf2 = await convert(md, "pdf", { baseDir: FIXTURES_DIR, warnings: [], pageSetup: pageSetup2 });
  if (!pdf2.html.includes("margin: 25mm 32mm 25mm 32mm;")) {
    throw new Error("页面设置断言失败:PDF 模板缺少默认边距 margin: 25mm 32mm 25mm 32mm;");
  }
  console.log("[ok] 页面设置:边距参数化(20/40/30/15 vs 25/32)docx+pdf 输出不同,断言通过");

  // 3. landscape + 非 A4(docx 库自动交换:landscape 下 w:w=纸高、w:h=纸宽,勿手动交换)
  for (const [paper, [w, h]] of Object.entries({ Legal: PAPERS_TWIPS.Legal, A5: PAPERS_TWIPS.A5 })) {
    const pageSetup = { paper, orientation: "landscape", ...M1 };
    lastDocx = await convert(md, "docx", { baseDir: FIXTURES_DIR, warnings: [], pageSetup });
    const xml = unzipPart(lastDocx.buffer, "word/document.xml");
    const pgSz = `<w:pgSz w:w="${h}" w:h="${w}" w:orient="landscape"`;
    if (!xml.includes(pgSz)) {
      throw new Error(`页面设置断言失败:${paper} landscape 缺少 ${pgSz}(docx 库自动交换宽高)`);
    }
    if (!xml.includes(M1_PGMAR)) {
      throw new Error(`页面设置断言失败:${paper} landscape 缺少 ${M1_PGMAR}`);
    }
    lastPdf = await convert(md, "pdf", { baseDir: FIXTURES_DIR, warnings: [], pageSetup });
    const pageCss = `size: ${paper} landscape; ${M1_PDF}`;
    if (!lastPdf.html.includes(pageCss)) {
      throw new Error(`页面设置断言失败:${paper} landscape PDF 模板缺少 ${pageCss}`);
    }
    console.log(`[ok] 页面设置:${paper} landscape docx 宽高交换 + pdf size 断言通过`);
  }

  // 4. 分页符产物(pdf 侧中间 html,原 smoke 断言下沉 A1):
  //    <!-- page-break --> → <div class="page-break"></div>
  const pbMd = `# 分页符标题\n\n<!-- page-break -->\n\n第二页正文\n`;
  const pbArtifact = await convert(pbMd, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
  });
  if (!pbArtifact.html.includes('<div class="page-break"></div>')) {
    throw new Error("分页符断言失败:pdf 中间 html 缺少 page-break div");
  }
  console.log("[ok] 分页符:pdf 中间 html 含 page-break div 断言通过");

  const lastPdfBin = await htmlToPdf(lastPdf.html, lastPdf.footerTemplate);
  await saveArtifact("page-setup", { docx: lastDocx.buffer, pdf: lastPdfBin });
}
