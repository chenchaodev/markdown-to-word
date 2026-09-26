// @ts-check
/**
 * 公式测试:
 * docx:KaTeX(MathML)→ docx Math 组件;OOXML 序列化名已实证(docx 9.7.1
 * index.cjs):Math 容器 → <m:oMath>,MathRun → <m:r><m:t>,分式 → <m:f>,
 * 行内上下标 → <m:sSubSup>,开方 → <m:rad>,display 大运算符上下限(∑ 走
 * MathSum)→ <m:nary>。display/行内由 mdast 节点类型(math / inlineMath)
 * 决定并经 texToDocxMath 的 displayMode 入参传入,详见 segments/math-structures.test.js。
 * pdf:KaTeX HTML 渲染 + katex.min.css 内联(file:// 字体绝对化 + @font-face)。
 * 注意:remark-math(mathFlow)仅支持 $$..$$ / $..$,不支持 ```math 围栏
 * (围栏是 @mdit/plugin-katex 侧特性,属双格式语法不对称,验收用 $$ 块)。
 * JS 模板字符串内 TeX 反斜杠须双写(\\frac)。
 */
import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { loadKatexCss } from "../../dist/core/pdf/katex-css.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import path from "node:path";
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";
import { asPdfArtifact, docxBufferOf, pdfHtmlOf } from "../common/convert-helpers.js";

/** 产物契约类型取自 src 单源:dist 是 tsc 产物、无类型标注,其 convert() 返回值里
 *  kind 被拓宽为 string,不能直接作为收窄 helper 的入参。 */
 /** @typedef {import("../../src/core/convert.js").ConvertArtifact} ConvertArtifact */

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
export const meta = { description: "公式测试:" };
export const fixtures = { main: formulaMd, degrade: degradeMd };

export async function run() {
  const katexDir = KATEX_DIR;
  const formulaDocx = /** @type {ConvertArtifact} */ (
    await convert(formulaMd, "docx", { baseDir: FIXTURES_DIR, warnings: [], katexDir })
  );
  const formulaDocument = await unzipPart(docxBufferOf(formulaDocx), "word/document.xml");
  if (!formulaDocument.includes("<m:oMath")) {
    throw new Error("公式断言失败:document.xml 缺少 <m:oMath(公式未生成)");
  }
  for (const [needle, label] of /** @type {[string, string][]} */ ([
    ["<m:t>x</m:t>", "x 上标文本"],
    ["<m:f>", "分式 m:f"],
    // <m:sSubSup> 只可能来自行内 $a_i^j$ / $x^2$ 的普通上下标:display 侧的
    // \sum_{i=1}^{n} 走 <m:nary>(见下一条断言),两者在同一文档内共存
    ["<m:sSubSup>", "行内上下标 m:sSubSup"],
    ["<m:rad>", "开方 m:rad"],
    // display 公式 \sum_{i=1}^{n}:上下限排在上下方(m:nary + m:limLoc undOvr)
    ["<m:nary>", "display 求和 m:nary"],
    ['<m:chr m:val="∑"/>', "display 求和 ∑ 字符(m:naryPr)"],
  ])) {
    if (!formulaDocument.includes(needle)) throw new Error(`公式断言失败:document.xml 缺少 ${label}(${needle})`);
  }
  console.log("[ok] docx 公式:m:oMath 与 分式/行内上下标/开方/display 求和 序列化齐全");

  const formulaPdf = /** @type {ConvertArtifact} */ (await convert(formulaMd, "pdf", {
    baseDir: FIXTURES_DIR, title: "公式测试", warnings: [], katexDir,
  }));
  const formulaHtml = pdfHtmlOf(formulaPdf);
  if (!formulaHtml.includes('class="katex"')) {
    throw new Error('公式断言失败:PDF 缺少 KaTeX 渲染结构(class="katex")');
  }
  if (!formulaHtml.includes("@font-face")) {
    throw new Error("公式断言失败:PDF 缺少 @font-face(KaTeX CSS 内联未生效)");
  }
  console.log("[ok] PDF 公式:KaTeX 结构 + CSS 字体内联生效");

  // ---------- 容器内(列表项 / 引用块内)公式在 PDF 侧无降级 ----------
  // 双管线对照:docx 侧容器内公式由 equations.ts renderContainerMath 渲染为
  // Office MathML;pdf 侧走 markdown-it 的 math_block 规则,容器内公式天然经
  // 同一 KaTeX 渲染路径(无「容器支不支持」分支)。此处钉住该差异不是回归:
  // 列表项/引用块内的 $$..$$ 必须产出 katex-display + mfrac,且不产
  // katex-error、不报降级警告。
  // 注:产物 HTML 里恒有 <annotation encoding="application/x-tex">\frac{1}{2}
  // (KaTeX 无障碍注解,非可见文本),故不可用「不含 \frac{1}{2}」作断言。
  const containerMd =
    "- 列表项公式\n\n  $$\n  \\frac{1}{2}\n  $$\n\n> $$\n> \\frac{1}{2}\n> $$\n";
  /** @type {unknown[]} */
  const containerWarnings = [];
  const containerPdf = /** @type {ConvertArtifact} */ (
    await convert(containerMd, "pdf", {
      baseDir: FIXTURES_DIR,
      title: "容器内公式",
      warnings: containerWarnings,
      katexDir,
    })
  );
  const containerHtml = pdfHtmlOf(containerPdf);
  for (const [needle, label] of /** @type {[string, string][]} */ ([
    ["<li>", "列表项结构"],
    ["<blockquote>", "引用块结构"],
    ['<span class="katex-display">', "display 公式结构"],
    ["<mfrac><mn>1</mn><mn>2</mn></mfrac>", "分式 MathML"],
  ])) {
    if (!containerHtml.includes(needle)) {
      throw new Error(`公式断言失败:PDF 容器内公式缺少 ${label}(${needle})`);
    }
  }
  if (containerHtml.includes("katex-error")) {
    throw new Error("公式断言失败:PDF 容器内公式不应出现 katex-error(公式应正常渲染)");
  }
  if (containerWarnings.length > 0) {
    throw new Error(
      `公式断言失败:PDF 容器内公式正常渲染不应产生警告,实际 ${JSON.stringify(containerWarnings.map((w) => formatWarning(w)))}`,
    );
  }
  console.log("[ok] PDF 容器内公式(列表项/引用块内)→ katex-display + mfrac 正常渲染,无 katex-error、零警告");

  // ---------- loadKatexCss 读取失败返回空串 + warnings 上报 ----------
  // 依据(dist/core/pdf/katex-css.ts):katexDir 无效时 readFileSync 抛错 → catch 返回 ""
  // 并经 warnings 通道上报 warn.katexCssLoadFailed(失败可见性,此前静默)。
  // renderPdfHtml 不抛错;公式仍渲染为 KaTeX HTML(仅缺字体样式)。
  /** @type {unknown[]} */
  const badKatexWarnings = [];
  const badKatexPdf = /** @type {ConvertArtifact} */ (await convert(formulaMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "公式测试",
    warnings: badKatexWarnings,
    katexDir: path.join(FIXTURES_DIR, "no-such-katex"),
  }));
  const badKatexHtml = pdfHtmlOf(badKatexPdf);
  if (badKatexHtml.includes("@font-face")) {
    throw new Error("公式断言失败:无效 katexDir 不应内联 @font-face(loadKatexCss 应返回空串)");
  }
  if (!badKatexHtml.includes('class="katex"')) {
    throw new Error("公式断言失败:无效 katexDir 时公式仍应渲染为 KaTeX HTML");
  }
  if (!badKatexWarnings.some((w) => formatWarning(w).includes("KaTeX 样式加载失败"))) {
    throw new Error(`公式断言失败:无效 katexDir 未产生 KaTeX CSS 加载失败警告,warnings=${JSON.stringify(badKatexWarnings)}`);
  }
  console.log("[ok] PDF 公式:loadKatexCss 读取失败返回空串 + warnings 上报(KaTeX 样式加载失败),断言通过");

  // ---------- loadKatexCss 依赖注入(read 默认 node:fs,注入后不落盘) ----------
  // 依据(src/core/pdf/katex-css.ts):读取经 deps.read 注入,默认 readFileSync;
  // 注入自定义 read 时即使 katexDir 不存在也产出注入内容(证明未触碰真实文件系统)。
  const injectedCss = loadKatexCss(path.join(FIXTURES_DIR, "no-such-katex"), [], {
    read: () => "/*injected*/.katex { color: red; }",
  });
  if (!injectedCss.includes("/*injected*/")) {
    throw new Error("公式断言失败:loadKatexCss 未走注入 read(无效 katexDir 应产出注入内容而非空串)");
  }
  // 注入 read 自身失败 → 与 fs 失败同通道:空串 + warn.katexCssLoadFailed(不回落真实 fs)
  /** @type {unknown[]} */
  const injectWarnings = [];
  const injectFailed = loadKatexCss(KATEX_DIR, injectWarnings, {
    read: () => {
      throw new Error("injected read failure");
    },
  });
  if (injectFailed !== "") {
    throw new Error("公式断言失败:注入 read 抛错时 loadKatexCss 应返回空串(不应静默回落 readFileSync)");
  }
  if (!injectWarnings.some((w) => formatWarning(w).includes("KaTeX 样式加载失败"))) {
    throw new Error(`公式断言失败:注入 read 抛错未走 keyed 警告通道,warnings=${JSON.stringify(injectWarnings)}`);
  }
  console.log("[ok] PDF 公式:loadKatexCss read 依赖注入生效(不落盘 + 注入失败同警告通道),断言通过");

  // ---------- 降级分支:解析失败的公式 → TeX 源码等宽灰字 + 警告 ----------
  // 依据(dist/core/docx/handlers/math.ts texToDocxMath):katex throwOnError:false 下解析失败
  // 产物含 class="katex-error" → 返回 { ok: false, text: tex };调用方(render.ts
  // renderBlock case "math" / pushRuns case "inlineMath")渲染为 TextRun 等宽灰字
  // (CODE_FONT=Consolas,color 888888)并追加警告「公式解析失败,降级为 TeX 源码: …」,
  // 不产出 m:oMath(整式降级,不混排)。失败样例:未闭合分组 \frac{1}{。
  /** @type {unknown[]} */
  const degradeWarnings = [];
  const degradeDocx = /** @type {ConvertArtifact} */ (
    await convert(degradeMd, "docx", { baseDir: FIXTURES_DIR, warnings: degradeWarnings })
  );
  const degradeDocument = await unzipPart(docxBufferOf(degradeDocx), "word/document.xml");
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
  // 断言:convert 返回 warnings 含降级警告文案(含公式源码)。
  // 警告为 KeyedWarning 对象,断言经 formatWarning 格式化后的最终文案。
  const degradeWarnOk = degradeWarnings.some((w) => {
    const text = typeof w === "string" ? w : formatWarning(w);
    return text.includes("公式解析失败,降级为 TeX 源码") && text.includes("\\frac{1}{");
  });
  if (!degradeWarnOk) {
    throw new Error("公式断言失败:warnings 缺少公式降级警告文案(公式解析失败,降级为 TeX 源码)");
  }
  console.log("[ok] docx 公式降级:TeX 源码等宽灰字 + 无 oMath + warnings 警告 断言通过");

  // ---------- munderover 非 ∑ 回落(munderoverToNary / moText) ----------
  // 依据(dist/core/docx/handlers/math.ts):display 模式(displayMode=true,经
  // texToDocxMath 入参传入)\prod / \bigcup 的 KaTeX MathML 产物为
  // <munderover><mo>∏/⋃</mo>…</munderover>(仅 ∑ 走 MathSum);首子 mo 文本非 ∑ →
  // MathSubSuperScript 回落(base = mo 文本 run,sub/sup 为兄弟节点),不产出 <m:nary>。
  // 实证序列化:<m:sSubSup><m:e><m:r><m:t>∏</m:t></m:r></m:e><m:sub>…</m:sub><m:sup>…</m:sup>。
  // (行内同 TeX 不产 munderover,走 msubsup → 同一 MathSubSuperScript 组件。)
  const fallbackMd = `# 非求和上下限

$$
\\prod_{i=1}^{n} i
$$

$$
\\bigcup_{i=1}^{n} A_i
$$
`;
  const fallbackDocx = /** @type {ConvertArtifact} */ (
    await convert(fallbackMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] })
  );
  const fallbackDocument = await unzipPart(docxBufferOf(fallbackDocx), "word/document.xml");
  // 回落结构:MathSubSuperScript 而非 MathSum(无 m:nary)
  if (!fallbackDocument.includes("<m:sSubSup>")) {
    throw new Error("公式断言失败:非 ∑ munderover 未回落 MathSubSuperScript(<m:sSubSup>)");
  }
  if (fallbackDocument.includes("<m:nary")) {
    throw new Error("公式断言失败:非 ∑ munderover 不应产出 MathSum(<m:nary)");
  }
  // mo 文本化(moText):∏ / ⋃ 以 MathRun 文本进 base,sub/sup 兄弟节点文本齐全
  for (const [needle, label] of /** @type {[string, string][]} */ ([
    ["<m:t>∏</m:t>", "∏ 基文本"],
    ["<m:t>⋃</m:t>", "⋃ 基文本"],
    ["<m:t>i</m:t>", "下标 i"],
    ["<m:t>n</m:t>", "上标 n"],
  ])) {
    if (!fallbackDocument.includes(needle)) throw new Error(`公式断言失败:非 ∑ 回落缺少 ${label}(${needle})`);
  }
  console.log("[ok] docx 公式:munderover 非 ∑ 回落(MathSubSuperScript + mo 文本,无 m:nary)断言通过");

  const formulaPdfBin = await htmlToPdf(formulaHtml, asPdfArtifact(formulaPdf).footerTemplate);
  await saveArtifact("formula", { docx: docxBufferOf(formulaDocx), pdf: formulaPdfBin });
}
