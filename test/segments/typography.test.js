/**
 * 排版设置验收(原 make-batch4-sample.mjs 段 5):
 * 双格式共用同一 typography 契约;docx 断言字号/字体/对齐/标题编号关闭,
 * pdf 断言模板 CSS 参数化;双格式产物落盘。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 排版设置验收(批次 5a) */
export async function run() {
  // 双格式共用同一 typography 契约(renderer 侧平行定义,字段名/默认值须同步):
  // 字号 14pt、行距 1.5、首行缩进 2 字符、两端对齐、宋体、标题编号关闭
  const typoMd = `# 排版设置测试

第一段正文,验证字号/行距/缩进/对齐等排版设置生效。

第二段正文,继续验证排版参数化。
`;
  const typography = {
    fontAscii: "Calibri",
    fontEastAsia: "宋体",
    bodySizePt: 14,
    lineSpacing: 1.5,
    firstLineIndent: true,
    align: "justify",
    headingNumbering: false,
  };
  // docx:styles.default 字号(14pt×2=28 half-points)+ eastAsia 宋体;
  // 正文段落两端对齐;headingNumbering=false → 全文无编号引用
  // (md 无列表,故 w:numPr 全缺即可稳定断言标题编号已关闭)
  const typoDocx = await convert(typoMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], typography });
  const typoStyles = unzipPart(typoDocx.buffer, "word/styles.xml");
  const typoDocument = unzipPart(typoDocx.buffer, "word/document.xml");
  if (!typoStyles.includes('<w:sz w:val="28"/>')) {
    throw new Error('排版断言失败:styles.xml 缺少 w:sz w:val="28"(14pt×2 half-points)');
  }
  if (!typoStyles.includes("宋体")) {
    throw new Error("排版断言失败:styles.xml 缺少 eastAsia 字体 宋体");
  }
  if (!typoDocument.includes('w:jc w:val="both"')) {
    throw new Error('排版断言失败:document.xml 缺少 w:jc both(docx 库 JUSTIFIED 序列化值,正文两端对齐)');
  }
  if (typoDocument.includes("w:numPr")) {
    throw new Error("排版断言失败:headingNumbering=false 但 document.xml 仍有编号引用");
  }
  console.log("[ok] docx 排版设置:字号28/宋体/两端对齐/标题编号关闭 全部生效");

  // pdf:模板 CSS 参数化断言(renderPdfHtml 产物字符串,不依赖 printToPDF)
  const typoPdf = await convert(typoMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [], typography });
  const typoChecks = [
    ["font-size: 14pt", "font-size 14pt"],
    ["text-indent: 2em", "首行缩进 text-indent"],
    ["text-align: justify", "两端对齐 text-align"],
    ["宋体", "font-family 宋体"],
  ];
  for (const [needle, label] of typoChecks) {
    if (!typoPdf.html.includes(needle)) throw new Error(`排版断言失败:PDF 模板缺少 ${label}`);
  }
  if (typoPdf.html.includes("counter(h1c)")) {
    throw new Error("排版断言失败:headingNumbering=false 但 PDF 模板仍有章节编号 CSS");
  }
  console.log("[ok] PDF 排版设置:14pt/2em 缩进/两端对齐/宋体/编号关闭 全部生效");
  const typoPdfBin = await htmlToPdf(typoPdf.html, typoPdf.footerTemplate);
  await saveArtifact("typography", { docx: typoDocx.buffer, pdf: typoPdfBin });
}
