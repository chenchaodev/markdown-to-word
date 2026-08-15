/**
 * 公式测试(原 make-batch4-sample.mjs 段 7):
 * docx:KaTeX(MathML)→ docx Math 组件;OOXML 序列化名已实证(docx 9.7.1
 * index.cjs):Math 容器 → <m:oMath>,MathRun → <m:r><m:t>,分式 → <m:f>,
 * 上下标 → <m:sSubSup>,开方 → <m:rad>。
 * pdf:KaTeX HTML 渲染 + katex.min.css 内联(file:// 字体绝对化 + @font-face)。
 * 注意:remark-math(mathFlow)仅支持 $$..$$ / $..$,不支持 ```math 围栏
 * (围栏是 @mdit/plugin-katex 侧特性,属双格式语法不对称,验收用 $$ 块)。
 * JS 模板字符串内 TeX 反斜杠须双写(\\frac)。
 */
import { convert } from "../../dist/core/convert.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import path from "node:path";
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";

/** 主样例:行内/分式/上下标/开方公式(gen-fixtures 落盘为 acceptance/formula.md) */
const formulaMd = `# 公式测试

行内公式 $x^2$ 与分式 $\\frac{1}{2}$、上下标 $a_i^j$。

独立公式:
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

开方公式:
$$
\\sqrt{a^2 + b^2}
$$
`;
/** 降级场景:解析失败的公式 → TeX 源码等宽灰字 + 警告(落盘为 acceptance/formula-degrade.md) */
const degradeMd = `# 公式降级

行内公式 $\\frac{1}{$ 与独立公式:

$$ \\frac{1}{ $$
`;
export const fixtures = { main: formulaMd, degrade: degradeMd };

export async function run() {
  const katexDir = KATEX_DIR;
  const formulaDocx = await convert(formulaMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], katexDir });
  const formulaDocument = unzipPart(formulaDocx.buffer, "word/document.xml");
  if (!formulaDocument.includes("<m:oMath")) {
    throw new Error("公式断言失败:document.xml 缺少 <m:oMath(公式未生成)");
  }
  for (const [needle, label] of [
    ["<m:t>x</m:t>", "x 上标文本"],
    ["<m:f>", "分式 m:f"],
    ["<m:sSubSup>", "上下标 m:sSubSup"],
    ["<m:rad>", "开方 m:rad"],
  ]) {
    if (!formulaDocument.includes(needle)) throw new Error(`公式断言失败:document.xml 缺少 ${label}(${needle})`);
  }
  console.log("[ok] docx 公式:m:oMath 与 分式/上下标/开方 序列化齐全");

  const formulaPdf = await convert(formulaMd, "pdf", {
    baseDir: FIXTURES_DIR, title: "公式测试", warnings: [], katexDir,
  });
  if (!formulaPdf.html.includes('class="katex"')) {
    throw new Error('公式断言失败:PDF 缺少 KaTeX 渲染结构(class="katex")');
  }
  if (!formulaPdf.html.includes("@font-face")) {
    throw new Error("公式断言失败:PDF 缺少 @font-face(KaTeX CSS 内联未生效)");
  }
  console.log("[ok] PDF 公式:KaTeX 结构 + CSS 字体内联生效");

  // ---------- G8 补齐:loadKatexCss 读取失败返回空串(template.ts:214-215) ----------
  // 依据(dist/core/pdf/template.ts):katexDir 无效时 readFileSync 抛错 → catch 返回 ""。
  // renderPdfHtml 不抛错;公式仍渲染为 KaTeX HTML(仅缺字体样式)。
  const badKatexPdf = await convert(formulaMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "公式测试",
    warnings: [],
    katexDir: path.join(FIXTURES_DIR, "no-such-katex"),
  });
  if (badKatexPdf.html.includes("@font-face")) {
    throw new Error("公式断言失败:无效 katexDir 不应内联 @font-face(loadKatexCss 应返回空串)");
  }
  if (!badKatexPdf.html.includes('class="katex"')) {
    throw new Error("公式断言失败:无效 katexDir 时公式仍应渲染为 KaTeX HTML");
  }
  console.log("[ok] PDF 公式:loadKatexCss 读取失败(无效 katexDir)返回空串,公式仍渲染,断言通过");

  // ---------- 降级分支:解析失败的公式 → TeX 源码等宽灰字 + 警告 ----------
  // 依据(dist/core/docx/math.ts texToDocxMath):katex throwOnError:false 下解析失败
  // 产物含 class="katex-error" → 返回 { ok: false, text: tex };调用方(render.ts
  // renderBlock case "math" / pushRuns case "inlineMath")渲染为 TextRun 等宽灰字
  // (CODE_FONT=Consolas,color 888888)并追加警告「公式解析失败,降级为 TeX 源码: …」,
  // 不产出 m:oMath(整式降级,不混排)。失败样例:未闭合分组 \frac{1}{。
  const degradeWarnings = [];
  const degradeDocx = await convert(degradeMd, "docx", { baseDir: FIXTURES_DIR, warnings: degradeWarnings });
  const degradeDocument = unzipPart(degradeDocx.buffer, "word/document.xml");
  // 断言:降级 TeX 源码以等宽灰字出现在 document.xml(样式 needle 已实证:color 888888)
  if (!degradeDocument.includes("\\frac{1}{")) {
    throw new Error("公式断言失败:降级公式 TeX 源码未出现在 document.xml");
  }
  if (!degradeDocument.includes('<w:color w:val="888888"/>')) {
    throw new Error("公式断言失败:降级公式缺少灰色(等宽灰字,w:color 888888)");
  }
  if (!degradeDocument.includes("Consolas")) {
    throw new Error("公式断言失败:降级公式缺少等宽字体(CODE_FONT=Consolas)");
  }
  // 断言:整式降级 → 不产出 m:oMath(不混排)
  if (degradeDocument.includes("<m:oMath")) {
    throw new Error("公式断言失败:降级公式不应产出 m:oMath(整式降级不混排)");
  }
  // 断言:convert 返回 warnings 含降级警告文案(含公式源码)
  const degradeWarnOk = degradeWarnings.some(
    (w) => w.includes("公式解析失败,降级为 TeX 源码") && w.includes("\\frac{1}{"),
  );
  if (!degradeWarnOk) {
    throw new Error("公式断言失败:warnings 缺少公式降级警告文案(公式解析失败,降级为 TeX 源码)");
  }
  console.log("[ok] docx 公式降级:TeX 源码等宽灰字 + 无 oMath + warnings 警告 断言通过");

  // ---------- G1 补齐:munderover 非 ∑ 回落(munderoverToNary 252-264 / moText 267-274) ----------
  // 依据(dist/core/docx/math.ts):display 模式 \prod / \bigcup 的 KaTeX MathML 产物为
  // <munderover><mo>∏/⋃</mo>…</munderover>(仅 ∑ 走 MathSum);首子 mo 文本非 ∑ →
  // MathSubSuperScript 回落(base = mo 文本 run,sub/sup 为兄弟节点),不产出 <m:nary>。
  // 实证序列化(2026-08-15):<m:sSubSup><m:e><m:r><m:t>∏</m:t></m:r></m:e><m:sub>…</m:sub><m:sup>…</m:sup>。
  const fallbackMd = `# 非求和上下限

$$
\\prod_{i=1}^{n} i
$$

$$
\\bigcup_{i=1}^{n} A_i
$$
`;
  const fallbackDocx = await convert(fallbackMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const fallbackDocument = unzipPart(fallbackDocx.buffer, "word/document.xml");
  // 回落结构:MathSubSuperScript 而非 MathSum(无 m:nary)
  if (!fallbackDocument.includes("<m:sSubSup>")) {
    throw new Error("公式断言失败:非 ∑ munderover 未回落 MathSubSuperScript(<m:sSubSup>)");
  }
  if (fallbackDocument.includes("<m:nary")) {
    throw new Error("公式断言失败:非 ∑ munderover 不应产出 MathSum(<m:nary)");
  }
  // mo 文本化(moText):∏ / ⋃ 以 MathRun 文本进 base,sub/sup 兄弟节点文本齐全
  for (const [needle, label] of [
    ["<m:t>∏</m:t>", "∏ 基文本"],
    ["<m:t>⋃</m:t>", "⋃ 基文本"],
    ["<m:t>i</m:t>", "下标 i"],
    ["<m:t>n</m:t>", "上标 n"],
  ]) {
    if (!fallbackDocument.includes(needle)) throw new Error(`公式断言失败:非 ∑ 回落缺少 ${label}(${needle})`);
  }
  console.log("[ok] docx 公式:munderover 非 ∑ 回落(MathSubSuperScript + mo 文本,无 m:nary)断言通过");

  const formulaPdfBin = await htmlToPdf(formulaPdf.html, formulaPdf.footerTemplate);
  await saveArtifact("formula", { docx: formulaDocx.buffer, pdf: formulaPdfBin });
}
