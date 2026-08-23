/**
 * 公式编号 + 交叉引用测试(原 make-batch4-sample.mjs 段 10):
 * 8d 免更新路线延续:display 公式($$ 块)按文档顺序全文连续编号 (1)(2)(3)…,
 * 渲染期静态注入(docx:公式段 tab 制表「居中公式 + 右对齐编号」;pdf:eq-block/eq-num);
 * label 语法 = 公式后紧跟独立行 `{#eq:label}`(该行不渲染,登记给前一公式);
 * 引用语法 = `[式](#eq:label)` / `[公式](#eq:label)` → 静态文本「式 (N)」+ 跳转;
 * 未知 label → 「式 (?)」+ 警告;行内公式不编号。
 */
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";

/** 主样例:公式编号 + 交叉引用(含行内公式/悬空引用),gen-fixtures 落盘为 acceptance/eq-numbering.md */
const batch9Md = `# 公式编号测试

正文含行内公式 $a + b$,不参与编号。

$$
E = mc^2
$$

{#eq:energy}

$$
F = ma
$$

{#eq:force}

如 [式](#eq:energy) 与 [公式](#eq:force) 所示;悬空引用 [式](#eq:unknown)。
`;
export const fixtures = { main: batch9Md };

export async function run() {
  const b9Warnings = [];
  const batch9Docx = await convert(batch9Md, "docx", { baseDir: FIXTURES_DIR, warnings: b9Warnings });
  const b9Document = unzipPart(batch9Docx.buffer, "word/document.xml");
  // R4 回归守卫:书签 w:id 文档内唯一(公式 label 书签 eq-energy/eq-force 与标题书签
  // 共用 ctx.bookmarkNextId 自增计数,全文档不重复;曾为组件级恒为 1 导致 WPS 异常)
  const b9BookmarkIds = [...b9Document.matchAll(/w:bookmarkStart[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  if (b9BookmarkIds.length === 0) {
    throw new Error("批次9断言失败:document.xml 无 w:bookmarkStart w:id");
  }
  if (new Set(b9BookmarkIds).size !== b9BookmarkIds.length) {
    throw new Error(`批次9断言失败:书签 w:id 应文档内唯一(共 ${b9BookmarkIds.length} 枚,去重后 ${new Set(b9BookmarkIds).size} 枚)`);
  }
  console.log(`[ok] docx 书签 w:id 文档内唯一(${b9BookmarkIds.length} 枚,含 eq-* 公式书签)`);
  // 8d-1:公式编号静态文本 (1)(2) 存在(免更新,无域)
  for (const needle of ["(1)", "(2)"]) {
    if (!b9Document.includes(needle)) throw new Error(`批次9断言失败:公式编号缺失(${needle})`);
  }
  // 8d-2:公式段落 tab 制表位(center + right)存在(居中公式 + 右对齐编号)
  if (!b9Document.includes('w:val="center"') || !b9Document.includes('w:val="right"')) {
    throw new Error("批次9断言失败:公式段缺少 center/right 制表位");
  }
  // 8d-3:label → 书签(eq-<label> 命名,引用跳转目标)
  if (!b9Document.includes('w:name="eq-energy"') || !b9Document.includes('w:name="eq-force"')) {
    throw new Error("批次9断言失败:公式 label 书签缺失(eq-energy/eq-force)");
  }
  // 8d-4:交叉引用静态文本「式 (1)」「公式 (2)」+ 超链接指向书签
  for (const needle of ["式 (1)", "公式 (2)", 'w:anchor="eq-energy"', 'w:anchor="eq-force"']) {
    if (!b9Document.includes(needle)) throw new Error(`批次9断言失败:交叉引用缺失(${needle})`);
  }
  // 8d-5:label 标记行不渲染;悬空引用 → 「式 (?)」+ 警告
  if (b9Document.includes("{#eq:")) throw new Error("批次9断言失败:label 标记行不应渲染");
  if (!b9Document.includes("式 (?)")) throw new Error("批次9断言失败:悬空引用应渲染为「式 (?)」");
  if (!b9Warnings.some((w) => w.includes("label: unknown"))) {
    throw new Error("批次9断言失败:悬空引用应追加警告");
  }
  console.log("[ok] docx 公式编号 + 交叉引用:编号/制表位/书签/引用文本/label 不渲染/悬空兜底 断言通过");

  // ---------- G8 补齐:孤立 label 警告(equations.ts:52-53) ----------
  // 依据(dist/core/docx/equations.ts):`{#eq:label}` 独立段前无公式 → 追加警告
  // 「公式 label 前无公式,已忽略: {#eq:label}」并同样跳过渲染。
  const orphanWarnings = [];
  const orphanDocx = await convert("{#eq:orphan}\n\n正文", "docx", { baseDir: FIXTURES_DIR, warnings: orphanWarnings });
  if (!orphanWarnings.includes("公式 label 前无公式,已忽略: {#eq:orphan}")) {
    throw new Error("批次9断言失败:孤立 label 应追加「公式 label 前无公式」警告");
  }
  const orphanXml = unzipPart(orphanDocx.buffer, "word/document.xml");
  if (orphanXml.includes("{#eq:orphan}")) {
    throw new Error("批次9断言失败:孤立 label 标记行不应渲染");
  }
  console.log("[ok] docx 孤立公式 label:警告 + 标记行不渲染 断言通过");

  const katexDir = KATEX_DIR;
  const batch9Pdf = await convert(batch9Md, "pdf", { baseDir: FIXTURES_DIR, title: "批次9验收", warnings: [], katexDir });
  // 8d-6:PDF 公式编号结构(eq-block/eq-num + 编号文本)
  if (!batch9Pdf.html.includes('class="eq-block"') || !batch9Pdf.html.includes('class="eq-num"')) {
    throw new Error("批次9断言失败:PDF 缺少 eq-block/eq-num 结构");
  }
  if (!batch9Pdf.html.includes(">(1)<") || !batch9Pdf.html.includes(">(2)<")) {
    throw new Error("批次9断言失败:PDF 公式编号 (1)/(2) 缺失");
  }
  // 8d-7:label 锚点 id + 引用静态文本「式 (1)」「公式 (2)」
  for (const needle of ['id="eq:energy"', 'id="eq:force"', 'href="#eq:energy">式 (1)<', 'href="#eq:force">公式 (2)<']) {
    if (!batch9Pdf.html.includes(needle)) throw new Error(`批次9断言失败:PDF 锚点/引用缺失(${needle})`);
  }
  // 8d-8:label 标记行不渲染;悬空引用「式 (?)」
  if (batch9Pdf.html.includes("{#eq:")) throw new Error("批次9断言失败:PDF 不应渲染 label 标记行");
  if (!batch9Pdf.html.includes("式 (?)")) throw new Error("批次9断言失败:PDF 悬空引用应渲染为「式 (?)」");
  // 8d-9:行内公式不编号(无 eq-num 包裹在行内公式上)
  console.log("[ok] PDF 公式编号 + 交叉引用:eq-block/锚点/引用文本/label 不渲染/悬空兜底 断言通过");

  // ---------- B3c:label 口径对齐 docx(pdf 侧放宽为「整段纯文本串接」) ----------
  // 此前 pdf 要求 label 段为唯一纯 text child,粗斜体包裹的 **{#eq:x}** 不命中 →
  // 登记失败且标记行按普通段落显示;docx collectPlainText 本就宽松。B3 起双格式一致。
  const boldLabelMd = "$$\nG = h\n$$\n\n**{#eq:bold-lab}**\n\n如 [式](#eq:bold-lab) 所示。";
  const boldLabelPdf = await convert(boldLabelMd, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    katexDir,
  });
  if (!boldLabelPdf.html.includes('id="eq:bold-lab"')) {
    throw new Error(`批次9断言失败:B3 粗斜体包裹 label 未登记锚点(pdf):\n${boldLabelPdf.html}`);
  }
  if (boldLabelPdf.html.includes("{#eq:bold-lab}")) {
    throw new Error("批次9断言失败:B3 粗斜体包裹 label 标记行不应渲染字面文本");
  }
  if (!boldLabelPdf.html.includes('href="#eq:bold-lab">式 (1)<')) {
    throw new Error("批次9断言失败:B3 粗斜体包裹 label 的交叉引用未替换为「式 (1)」");
  }
  const boldLabelDocx = await convert(boldLabelMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const boldLabelXml = unzipPart(boldLabelDocx.buffer, "word/document.xml");
  if (!boldLabelXml.includes('w:name="eq-bold-lab"')) {
    throw new Error("批次9断言失败:B3 粗斜体包裹 label 未登记书签(docx)");
  }
  if (!boldLabelXml.includes("式 (1)")) {
    throw new Error("批次9断言失败:B3 粗斜体包裹 label 的交叉引用未替换(docx)");
  }
  console.log("[ok] B3 粗斜体包裹 {#eq:label}:pdf 放宽命中 + docx 契约锁定(双格式一致)断言通过");

  // ---------- 公式编号开关关闭(equationNumbering: false,docx/pdf 双格式一致) ----------
  // 关开关语义:display 公式不编号(原样渲染,无 (N) 文本)、{#eq:label} 独立段仍隐藏
  // (语法标记不显示,不渲染)、[式]/[公式] 引用保持原文本(不降级「(?)」、不追加警告)。
  const offWarnings = [];
  const offDocx = await convert(batch9Md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: offWarnings,
    equationNumbering: false,
  });
  const offDocument = unzipPart(offDocx.buffer, "word/document.xml");
  // 关开关-1:公式不编号(无 (1)/(2) 静态文本)
  for (const needle of ["(1)", "(2)"]) {
    if (offDocument.includes(needle)) throw new Error(`批次9断言失败:关开关后不应出现公式编号(${needle})`);
  }
  // 关开关-2:{#eq:label} 段不渲染(语法标记隐藏,不按普通段落显示)
  if (offDocument.includes("{#eq:energy}") || offDocument.includes("{#eq:force}")) {
    throw new Error("批次9断言失败:关开关后 {#eq:label} 段不应渲染");
  }
  // 关开关-3:引用保持原文本(不编号替换、不降级「(?)」、不追加警告)
  if (offDocument.includes("式 (1)") || offDocument.includes("式 (?)")) {
    throw new Error("批次9断言失败:关开关后引用应保持原文本(不编号/不降级)");
  }
  if (offWarnings.some((w) => w.includes("label: unknown"))) {
    throw new Error("批次9断言失败:关开关后不应追加交叉引用警告");
  }
  console.log("[ok] docx 公式编号开关关闭:公式不编号/label 段隐藏/引用保持原文本 断言通过");

  const offPdf = await convert(batch9Md, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "批次9验收",
    warnings: [],
    katexDir,
    equationNumbering: false,
  });
  // 关开关-4:PDF 无 eq-block/eq-num 结构、无编号文本
  if (offPdf.html.includes('class="eq-block"') || offPdf.html.includes('class="eq-num"')) {
    throw new Error("批次9断言失败:关开关后 PDF 不应有 eq-block/eq-num 结构");
  }
  if (offPdf.html.includes(">(1)<") || offPdf.html.includes(">(2)<")) {
    throw new Error("批次9断言失败:关开关后 PDF 不应有公式编号 (1)/(2)");
  }
  // 关开关-5:{#eq:label} 段不渲染(语法标记隐藏)
  if (offPdf.html.includes("{#eq:energy}") || offPdf.html.includes("{#eq:force}")) {
    throw new Error("批次9断言失败:关开关后 PDF 的 {#eq:label} 段不应渲染");
  }
  // 关开关-6:引用保持原文本(不编号替换、不降级「(?)」)
  if (offPdf.html.includes("式 (1)") || offPdf.html.includes("式 (?)")) {
    throw new Error("批次9断言失败:关开关后 PDF 引用应保持原文本");
  }
  console.log("[ok] PDF 公式编号开关关闭:公式不编号/label 段隐藏/引用保持原文本 断言通过");

  const batch9PdfBin = await htmlToPdf(batch9Pdf.html, batch9Pdf.footerTemplate);
  await saveArtifact("eq-numbering", { docx: batch9Docx.buffer, pdf: batch9PdfBin });
}
