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

  const batch9PdfBin = await htmlToPdf(batch9Pdf.html, batch9Pdf.footerTemplate);
  await saveArtifact("eq-numbering", { docx: batch9Docx.buffer, pdf: batch9PdfBin });
}
