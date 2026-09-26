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
 * - src/core/pdf/template-css.ts buildTemplateCss:
 *   @page { size: ${paper}${" landscape"}; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import {
  DEFAULT_PAGE_SETUP,
  MARGIN_MAX_MM,
  MIN_PAGE_CONTENT_MM,
  correctPageSetup,
  validatePageSetup,
} from "../../dist/core/settings/settings-defaults.js";

const md = `页面设置验收:纸张与边距参数化。\n`;

/** 分页符样例(<!-- page-break --> 显式分页,落盘为 acceptance/page-setup-pagebreak.md) */
const pbMd = `# 分页符标题\n\n<!-- page-break -->\n\n第二页正文\n`;

export const meta = { description: "页面设置验收(中优先级缺口:非 A4 纸张 + 边距值):" };
// 场景导出:main = 页面设置验收正文;pagebreak = 显式分页符语法
export const fixtures = {
  main: md,
  pagebreak: pbMd,
};

// 纸张 → 纵向 twips(宽, 高)= round(mm × 56.6929),来源 PAPER_SIZES_MM
const PAPERS_TWIPS = {
  A4: [11906, 16838], // 210×297
  A3: [16838, 23811], // 297×420
  A5: [8391, 11906], // 148×210
  Letter: [12240, 15840], // 215.9×279.4
  Legal: [12240, 20160], // 215.9×355.6
};

const PAPERS_MM = {
  A4: [210, 297],
  A3: [297, 420],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
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
    const xml = await unzipPart(lastDocx.buffer, "word/document.xml");
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
  const xml2 = await unzipPart(docx2.buffer, "word/document.xml");
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
    const xml = await unzipPart(lastDocx.buffer, "word/document.xml");
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

  // 3.1 核心 validator:五种纸张 × 两种方向均按视觉尺寸计算内容区
  for (const [paper, [portraitWidth, portraitHeight]] of Object.entries(PAPERS_MM)) {
    for (const orientation of ["portrait", "landscape"]) {
      const pageSetup = { paper, orientation, ...M1 };
      const geometry = validatePageSetup(pageSetup);
      const expectedWidth = orientation === "landscape" ? portraitHeight : portraitWidth;
      const expectedHeight = orientation === "landscape" ? portraitWidth : portraitHeight;
      const expectedContentWidth = expectedWidth - M1.marginLeft - M1.marginRight;
      const expectedContentHeight = expectedHeight - M1.marginTop - M1.marginBottom;
      if (
        geometry.pageWidthMm !== expectedWidth ||
        geometry.pageHeightMm !== expectedHeight ||
        geometry.contentWidthMm !== expectedContentWidth ||
        geometry.contentHeightMm !== expectedContentHeight
      ) {
        throw new Error(`页面几何 validator 失败:${paper} ${orientation}`);
      }
    }
  }
  const zeroMargin = validatePageSetup({
    paper: "A4",
    orientation: "portrait",
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  });
  if (zeroMargin.contentWidthMm !== 210 || zeroMargin.contentHeightMm !== 297) {
    throw new Error("页面几何 validator:0 边距应是合法边界且内容区等于纸张尺寸");
  }
  console.log("[ok] 页面几何 validator:五纸张×两方向/0 边距/内容宽高计算断言通过");

  // 3.1.1 core 单一纠正策略:合法值原样、双边超限按固定最小修正规则确定性收敛。
  const legalCorrection = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 20, marginBottom: 30, marginLeft: 15, marginRight: 40,
  });
  if (legalCorrection.corrected || JSON.stringify(legalCorrection.pageSetup) !== JSON.stringify({
    paper: "A4", orientation: "portrait", marginTop: 20, marginBottom: 30, marginLeft: 15, marginRight: 40,
  })) {
    throw new Error("合法页面设置应原样通过 core 纠正策略");
  }
  const bothVertical = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 200, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  if (
    bothVertical.pageSetup.marginTop !== 96 ||
    bothVertical.pageSetup.marginBottom !== 200 ||
    !bothVertical.reasons.includes("insufficient-content")
  ) {
    throw new Error(`双边纵向超限应仅削减溢出总量,保留 top=96/bottom=200:${JSON.stringify(bothVertical)}`);
  }
  const bothHorizontal = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 10, marginBottom: 10, marginLeft: 200, marginRight: 200,
  });
  if (
    bothHorizontal.pageSetup.marginLeft !== 9 ||
    bothHorizontal.pageSetup.marginRight !== 200
  ) {
    throw new Error(`双边横向超限应仅削减溢出总量,保留 left=9/right=200:${JSON.stringify(bothHorizontal)}`);
  }
  const firstOverCapacity = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 400, marginBottom: 400, marginLeft: 0, marginRight: 0,
  });
  if (
    firstOverCapacity.pageSetup.marginTop !== 0 ||
    firstOverCapacity.pageSetup.marginBottom !== 296
  ) {
    throw new Error("第一边不足以独自吸收溢出时应归零并从第二边扣除剩余量");
  }
  const minimalOverflow = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 150, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  if (minimalOverflow.pageSetup.marginTop !== 96 || minimalOverflow.pageSetup.marginBottom !== 200) {
    throw new Error(`150/200 双边超限应仅削减 54mm，不应无谓清零:${JSON.stringify(minimalOverflow)}`);
  }
  const invalidEnums = correctPageSetup({
    paper: "B5", orientation: "sideways", marginTop: "bad", marginBottom: -1, marginLeft: 0, marginRight: 0,
  });
  if (
    invalidEnums.pageSetup.paper !== "A4" ||
    invalidEnums.pageSetup.orientation !== "portrait" ||
    invalidEnums.pageSetup.marginTop !== 25 ||
    invalidEnums.pageSetup.marginBottom !== 0 ||
    !invalidEnums.reasons.includes("invalid-paper") ||
    !invalidEnums.reasons.includes("invalid-orientation") ||
    !invalidEnums.reasons.includes("invalid-margin")
  ) {
    throw new Error(`非法枚举/边距应逐字段回退并报告原因:${JSON.stringify(invalidEnums)}`);
  }
  console.log("[ok] core 页面纠正策略:合法原样/双边超限确定性最小修正/非法字段原因断言通过");

  // 3.2 最小内容区:恰好达到下限通过，略低、零/负内容区与越界边距拒绝
  const atMinimum = validatePageSetup({
    paper: "A5",
    orientation: "portrait",
    marginTop: 0,
    marginBottom: 0,
    marginLeft: (148 - MIN_PAGE_CONTENT_MM) / 2,
    marginRight: (148 - MIN_PAGE_CONTENT_MM) / 2,
  });
  if (atMinimum.contentWidthMm !== MIN_PAGE_CONTENT_MM) {
    throw new Error("页面几何 validator:内容区恰好等于最小值应通过");
  }
  const invalidPageSetups = [
    {
      name: "未知纸张",
      value: {
        paper: "A6",
        orientation: "portrait",
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
    },
    {
      name: "未知方向",
      value: {
        paper: "A4",
        orientation: "sideways",
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
    },
    {
      name: "内容区略低于最小值",
      value: {
        paper: "A5",
        orientation: "portrait",
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 73.6,
        marginRight: 73.6,
      },
    },
    {
      name: "内容区为零",
      value: {
        paper: "A5",
        orientation: "portrait",
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 74,
        marginRight: 74,
      },
    },
    {
      name: "内容区为负",
      value: {
        paper: "A4",
        orientation: "portrait",
        marginTop: 200,
        marginBottom: 200,
        marginLeft: 0,
        marginRight: 0,
      },
    },
    {
      name: "边距达到 1000",
      value: {
        paper: "A4",
        orientation: "portrait",
        marginTop: MARGIN_MAX_MM,
        marginBottom: MARGIN_MAX_MM,
        marginLeft: MARGIN_MAX_MM,
        marginRight: MARGIN_MAX_MM,
      },
    },
    {
      name: "边距超过 1000",
      value: {
        paper: "A4",
        orientation: "portrait",
        marginTop: MARGIN_MAX_MM + 0.1,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
    },
  ];
  for (const { name, value } of invalidPageSetups) {
    let rejected = false;
    try {
      validatePageSetup(value);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    if (!rejected) throw new Error(`页面几何 validator 应拒绝:${name}`);
  }
  console.log("[ok] 页面几何 validator:最小内容区/0·负值/1000·越界边距拒绝断言通过");

  // 3.3 docx/pdf 两条独立渲染边界均重复执行同一 validator
  const invalidRenderSetup = invalidPageSetups.find(({ name }) => name === "内容区为零").value;
  for (const format of ["docx", "pdf"]) {
    let rejected = false;
    try {
      await convert(md, format, {
        baseDir: FIXTURES_DIR,
        warnings: [],
        pageSetup: invalidRenderSetup,
      });
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    if (!rejected) throw new Error(`${format} core 渲染边界应拒绝零内容区页面设置`);
  }
  console.log("[ok] 页面几何 validator:docx/pdf 独立渲染边界一致拒绝断言通过");

  const invalidPaperErrors = [];
  for (const format of ["docx", "pdf"]) {
    try {
      await convert(md, format, {
        baseDir: FIXTURES_DIR,
        warnings: [],
        pageSetup: { ...DEFAULT_PAGE_SETUP, paper: "A6" },
      });
    } catch (error) {
      invalidPaperErrors.push(error);
    }
  }
  if (
    invalidPaperErrors.length !== 2 ||
    !(invalidPaperErrors[0] instanceof RangeError) ||
    !(invalidPaperErrors[1] instanceof RangeError) ||
    invalidPaperErrors[0].message !== invalidPaperErrors[1].message
  ) {
    throw new Error(`PDF 必须在纸张尺寸计算前复用 DOCX validator 错误契约:${JSON.stringify(invalidPaperErrors.map((error) => String(error)))}`);
  }
  console.log("[ok] PDF 渲染边界:validatePageSetup 先于纸张计算且 DOCX/PDF 错误契约一致");

  // 4. 分页符产物(pdf 侧中间 html):
  //    <!-- page-break --> → <div class="page-break"></div>
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
