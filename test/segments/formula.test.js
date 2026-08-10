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
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";

export async function run() {
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

  const formulaPdfBin = await htmlToPdf(formulaPdf.html, formulaPdf.footerTemplate);
  await saveArtifact("formula", { docx: formulaDocx.buffer, pdf: formulaPdfBin });
}
