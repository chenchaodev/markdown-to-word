/**
 * 题注/章节交叉引用测试(批次 10 功能 2,docx + pdf 双格式):
 * 断言依据为 src/core/docx/render.ts(CROSS_REF_KINDS / captions.ts)与
 * src/core/pdf/render.ts(overrideXrefRule)+ template.ts 的实际实现事实,
 * 勿臆测标准:
 *
 * docx 侧(2026-08-13 实测):
 * - 题注「图: 标题 {#fig:label}」:label 剥离(仅前缀与题注类型一致时;不匹配
 *   原样保留),书签 w:name="fig-a"(bookmarkNextId 唯一),显示「图 1.1 标题」;
 * - 标题「## 标题 {#sec:label}」:label 不进标题文本/slug/TOC;章节号静态计数
 *   (h1 增→h2/h3 清零,h2 增→h3 清零;无 h1 从「1」起,前导未出现级跳过);
 *   renderDocx 预扫登记(引用先于目标标题出现也能命中);
 * - 引用 [图](#fig:label):文本恰为「图/表/章节」→ 替换为静态编号 +
 *   InternalHyperlink 跳书签(docx 库输出 <w:hyperlink w:history="1"
 *   w:anchor="...">、文本 <w:t xml:space="preserve">);非默认文本保持原样仍跳转;
 *   悬空 → 默认文本占位「图 (?)」/「(?)」+ 警告「交叉引用未找到<图/表/章节>
 *   label: <prefix>:<label>」(B3 起按文案去重,pdf 侧本就如此);headingNumbering 关
 *   → sec 引用悬空;captionNumbering 关 → 题注行原样保留 label、无书签。
 *
 * pdf 侧(与 docx 同一契约,2026-08-13 实测):
 * - xref_recognize 一遍计数/剥离/登记,锚点 <span id="fig:label"> 注入题注段落
 *   开头、<span id="sec:label"> 注入标题开头;二遍链接替换:命中 → 默认文本
 *   替换为编号并保留 href,悬空 → 解包链接为纯文本占位(无 href 死链)+ 警告
 *   (按「前缀:label」去重);
 * - 编号镜像模板 CSS:headingNumbering && hasH1 → 「图 h1c.figc」;无 h1 时
 *   章节号「0.1」(前导零不跳过,与 CSS counter 显示一致,与 docx「1」的差异
 *   属实现声明,此处按 pdf 实际断言);
 * - template.ts 已补 .fig-caption/.tab-caption { counter-increment: figc/tabc; }
 *   (8b 修复:此前 PDF 题注序号恒 0);
 * - captionNumbering 关 → label 原样保留不剥离不登记;headingNumbering 关 →
 *   sec label 剥离但引用悬空「(?)」;eq 公式引用行为不变。
 */
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/typography.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

const B = FIXTURES_DIR;

/** 主样例:h1 章节 + 图/表题注 + 章节引用(引用先于目标标题出现,验证预扫)+
 *  公式混排(验证 #eq: 不回归)+ 悬空引用(图引用两次,验证 B3 警告按文案去重) */
export const fixtures = { main: `# 第一章 {#sec:c1}

见 [图](#fig:a)、[表](#tab:t)、[章节](#sec:c2)、[见图甲](#fig:a) 与 [式](#eq:e)。

## 第 2 节 {#sec:c2}

![图一](g1-tiny.png)

图: 图一 {#fig:a}

| A | B |
|---|---|
| 1 | 2 |

表: 表一 {#tab:t}

![图二](g1-tiny.png)

图: 图二 {#fig:b}

$$
x
$$

{#eq:e}

悬空 [图](#fig:x) 与 [图](#fig:x) 与 [章节](#sec:s1)。
` };

/** 题注/章节交叉引用(docx + pdf) */
export async function run() {
  const MD = fixtures.main; // 主样例来自命名导出(gen-fixtures 落盘为 acceptance/cross-ref.md)
  // ============ 场景 A:主样例(h1 + 图/表/章节/公式 + 悬空) ============
  const warnings = [];
  const docx = await convert(MD, "docx", { baseDir: B, warnings });
  const xml = unzipPart(docx.buffer, "word/document.xml");
  const has = (s) => xml.includes(s);

  // A1(R1/R2) docx 题注:书签 + 静态编号文本;图/表独立计数;label 不渲染
  if (!has('<w:bookmarkStart w:name="fig-a"')) throw new Error("docx 缺少题注书签 fig-a");
  if (!has('<w:bookmarkStart w:name="tab-t"')) throw new Error("docx 缺少题注书签 tab-t");
  if (!has('<w:t xml:space="preserve">图 1.1 图一</w:t>')) throw new Error('docx 图题注显示文本非「图 1.1 图一」');
  if (!has('<w:t xml:space="preserve">图 1.2 图二</w:t>')) throw new Error('docx 第二图题注非「图 1.2 图二」(图/表独立计数)');
  if (!has('<w:t xml:space="preserve">表 1.1 表一</w:t>')) throw new Error('docx 表题注显示文本非「表 1.1 表一」');
  if (xml.includes("{#fig:") || xml.includes("{#tab:") || xml.includes("{#sec:")) {
    throw new Error("docx label 泄漏到文档文本({#fig:/{#tab:/{#sec: 不应出现)");
  }

  // A2(R1) docx 引用替换:默认文本 → 编号 + 跳转书签
  if (!has('<w:hyperlink w:history="1" w:anchor="fig-a">')) throw new Error('docx 图引用缺少 hyperlink anchor="fig-a"');
  if (!has('<w:t xml:space="preserve">图 1.1</w:t>')) throw new Error('docx 图引用文本非「图 1.1」');
  if (!has('<w:hyperlink w:history="1" w:anchor="tab-t">')) throw new Error('docx 表引用缺少 hyperlink anchor="tab-t"');
  if (!has('<w:t xml:space="preserve">表 1.1</w:t>')) throw new Error('docx 表引用文本非「表 1.1」');

  // A3(R3) docx 章节引用:引用先于目标标题出现也命中(预扫);label 不进标题文本/slug
  if (!has('<w:hyperlink w:history="1" w:anchor="第-2-节">')) throw new Error('docx 章节引用缺少 hyperlink anchor 标题 slug(第-2-节)');
  if (!has('<w:t xml:space="preserve">1.1</w:t>')) throw new Error('docx 章节引用文本非「1.1」');
  if (!has('<w:bookmarkStart w:name="第-2-节"')) throw new Error("docx 标题书签 slug 异常(含 label)");
  if (xml.includes("第 2 节 {#sec:c2}")) throw new Error("docx 标题文本泄漏 label");

  // A4(B3) docx 悬空:占位文本 + 警告去重(fig:x 出现 2 次 → 警告仅 1 条,对齐 pdf 侧)
  if (!has('<w:t xml:space="preserve">图 (?)</w:t>')) throw new Error('docx 悬空图引用无占位「图 (?)」');
  if (!has('<w:t xml:space="preserve">(?)</w:t>')) throw new Error('docx 悬空章节引用无占位「(?)」');
  const figXCount = warnings.filter((w) => w === "交叉引用未找到图 label: fig:x").length;
  if (figXCount !== 1) throw new Error(`docx 悬空图警告应去重为 1 条(实际 ${figXCount},B3 契约)`);
  if (!warnings.includes("交叉引用未找到章节 label: sec:s1")) {
    throw new Error("docx 缺少悬空章节警告 sec:s1");
  }

  // A5(R5) docx 非默认文本:保持原样仍跳转
  if (!has('<w:hyperlink w:history="1" w:anchor="fig-a">') || !has("见图甲")) {
    throw new Error('docx 非默认引用文本「见图甲」应保持并跳转 fig-a');
  }

  // A8(R12) docx 公式不回归:#eq: 分支未动
  if (!has('<w:hyperlink w:history="1" w:anchor="eq-e">')) throw new Error('docx 公式引用缺少 hyperlink anchor="eq-e"');
  if (!has('<w:t xml:space="preserve">式 (1)</w:t>')) throw new Error('docx 公式引用文本非「式 (1)」');

  // ============ 场景 B:pdf 主样例 ============
  const warningsP = [];
  const pdf = await convert(MD, "pdf", { baseDir: B, warnings: warningsP, title: "t" });
  const html = pdf.html;

  // B1(R7) pdf 锚点:题注 fig:/tab:、标题 sec:
  if (!html.includes('<span id="fig:a"></span>')) throw new Error('pdf 缺少题注锚点 <span id="fig:a">');
  if (!html.includes('<span id="tab:t"></span>')) throw new Error('pdf 缺少题注锚点 <span id="tab:t">');
  if (!html.includes('<span id="sec:c2"></span>')) throw new Error('pdf 缺少标题锚点 <span id="sec:c2">');

  // B2(R7) pdf 引用替换:默认文本 → 编号,保留 href 跳转
  if (!html.includes('href="#fig:a"')) throw new Error('pdf 图引用缺少 href="#fig:a"');
  if (!html.includes(">图 1.1</a>")) throw new Error('pdf 图引用文本非「图 1.1」');
  if (!html.includes(">表 1.1</a>")) throw new Error('pdf 表引用文本非「表 1.1」');
  if (!html.includes(">1.1</a>")) throw new Error('pdf 章节引用文本非「1.1」');
  if (!html.includes(">见图甲</a>")) throw new Error('pdf 非默认引用文本「见图甲」应保持并跳转');

  // B3(R8) pdf 悬空:解包为纯文本占位,无 href 死链;警告去重(每前缀:label 一次)
  if (!html.includes("图 (?)")) throw new Error('pdf 悬空图引用无占位「图 (?)」');
  if (html.includes('href="#fig:x"')) throw new Error('pdf 悬空引用不应保留 href 死链');
  const pdfFigX = warningsP.filter((w) => w === "交叉引用未找到图 label: fig:x").length;
  if (pdfFigX !== 1) throw new Error(`pdf 悬空图警告应按「前缀:label」去重(实际 ${pdfFigX} 次)`);
  if (!warningsP.includes("交叉引用未找到章节 label: sec:s1")) {
    throw new Error("pdf 缺少悬空章节警告 sec:s1");
  }

  // B4(R10) 8b 修复:template 内联 CSS 含 counter-increment
  if (!html.includes("counter-increment: figc") || !html.includes("counter-increment: tabc")) {
    throw new Error('pdf 模板缺少 .fig-caption/.tab-caption 的 counter-increment(8b 题注序号修复)');
  }

  // B5(R1/R3) pdf label 不渲染
  if (html.includes("{#fig:") || html.includes("{#tab:") || html.includes("{#sec:")) {
    throw new Error("pdf label 泄漏到 HTML 文本");
  }

  await saveArtifact("cross-ref", { docx: docx.buffer });

  // ============ 场景 C(R11):题注交换顺序 → 引用编号跟随 ============
  const mdOrder1 = `# 甲

![A](g1-tiny.png)

图: 图甲 {#fig:a}

![B](g1-tiny.png)

图: 图乙 {#fig:b}

见 [图](#fig:a) 与 [图](#fig:b)。
`;
  const mdOrder2 = `# 甲

![B](g1-tiny.png)

图: 图乙 {#fig:b}

![A](g1-tiny.png)

图: 图甲 {#fig:a}

见 [图](#fig:a) 与 [图](#fig:b)。
`;
  const o1 = await convert(mdOrder1, "docx", { baseDir: B, warnings: [] });
  const o2 = await convert(mdOrder2, "docx", { baseDir: B, warnings: [] });
  const x1 = unzipPart(o1.buffer, "word/document.xml");
  const x2 = unzipPart(o2.buffer, "word/document.xml");
  if (!x1.includes('<w:t xml:space="preserve">图 1.1</w:t>') || !x1.includes('<w:t xml:space="preserve">图 1.2</w:t>')) {
    throw new Error("docx 顺序 1:引用编号非图 1.1/图 1.2");
  }
  if (!x2.includes('<w:t xml:space="preserve">图 1.2</w:t>')) {
    throw new Error("docx 顺序 2:交换题注顺序后 [图](#fig:a) 引用编号未跟随(应图 1.2)");
  }
  const pOrder2 = await convert(mdOrder2, "pdf", { baseDir: B, warnings: [], title: "t" });
  if (!pOrder2.html.includes(">图 1.2</a>")) {
    throw new Error("pdf 顺序 2:交换题注顺序后引用编号未跟随(应图 1.2)");
  }

  // ============ 场景 D(R3):无 h1 → 章节号从「1」起(docx)/「0.1」(pdf 镜像 CSS) ============
  const mdNoH1 = `## 甲 {#sec:s1}
## 乙 {#sec:s2}
## 第 3 节 {#sec:s3}

见 [章节](#sec:s3)。
`;
  const dW = [];
  const dD = await convert(mdNoH1, "docx", { baseDir: B, warnings: dW });
  const dX = unzipPart(dD.buffer, "word/document.xml");
  if (!dX.includes('<w:t xml:space="preserve">3</w:t>')) throw new Error('docx 无 h1 场景 [章节](#sec:s3) 非「3」(前导未出现级跳过)');
  const dP = await convert(mdNoH1, "pdf", { baseDir: B, warnings: [], title: "t" });
  if (!dP.html.includes(">0.3</a>")) {
    throw new Error('pdf 无 h1 场景 [章节](#sec:s3) 非「0.3」(镜像 CSS counter,前导零保留)');
  }

  // ============ 场景 E(R6/R9):captionNumbering 关 → label 原样保留不登记 ============
  const mdCapOff = `![图一](g1-tiny.png)

图: 图一 {#fig:a}
`;
  const capOffW = [];
  const capOffD = await convert(mdCapOff, "docx", {
    baseDir: B,
    warnings: capOffW,
    typography: { ...DEFAULT_TYPOGRAPHY, captionNumbering: false },
  });
  const capOffX = unzipPart(capOffD.buffer, "word/document.xml");
  if (!capOffX.includes('<w:t xml:space="preserve">图: 图一 {#fig:a}</w:t>')) {
    throw new Error("docx captionNumbering 关:题注行应原样保留 label");
  }
  if (capOffX.includes('<w:bookmarkStart w:name="fig-a"')) {
    throw new Error("docx captionNumbering 关:不应生成 fig-a 书签");
  }
  const capOffP = await convert(mdCapOff, "pdf", {
    baseDir: B,
    warnings: [],
    title: "t",
    typography: { ...DEFAULT_TYPOGRAPHY, captionNumbering: false },
  });
  if (!capOffP.html.includes("{#fig:a}")) {
    throw new Error("pdf captionNumbering 关:label 应原样保留不剥离");
  }

  // ============ 场景 F(R6/R9):headingNumbering 关 → sec 引用悬空 ============
  const mdHnOff = `# 甲 {#sec:s1}

见 [章节](#sec:s1)。
`;
  const hnOffW = [];
  const hnOffD = await convert(mdHnOff, "docx", {
    baseDir: B,
    warnings: hnOffW,
    typography: { ...DEFAULT_TYPOGRAPHY, headingNumbering: false },
  });
  const hnOffX = unzipPart(hnOffD.buffer, "word/document.xml");
  if (!hnOffX.includes('<w:t xml:space="preserve">(?)</w:t>')) {
    throw new Error("docx headingNumbering 关:[章节] 引用应显示「(?)」");
  }
  if (!hnOffW.includes("交叉引用未找到章节 label: sec:s1")) {
    throw new Error("docx headingNumbering 关:缺少悬空章节警告");
  }
  const hnOffP = await convert(mdHnOff, "pdf", {
    baseDir: B,
    warnings: [],
    title: "t",
    typography: { ...DEFAULT_TYPOGRAPHY, headingNumbering: false },
  });
  if (!hnOffP.html.includes("(?)")) throw new Error("pdf headingNumbering 关:[章节] 引用应显示「(?)」");

  // ============ 场景 G(G8 补齐):chapter null(captions.ts:87)与题注空文本(captions.ts:113) ============
  // 依据(src/core/docx/captions.ts):chapter = headingNumbering && chapter>0 ? chapter : null;
  // 无 h1 时 chapter 恒 0 → null → 编号无章节前缀「图 1」;题注文本剥离 label 后为空 →
  // renderCaptionParagraph 仅渲染编号文本(无尾随空格)。
  const mdNoH1Cap = `![图一](g1-tiny.png)

图: 图甲
`;
  const gNoH1 = await convert(mdNoH1Cap, "docx", { baseDir: B, warnings: [] });
  const gNoH1X = unzipPart(gNoH1.buffer, "word/document.xml");
  if (!gNoH1X.includes('<w:t xml:space="preserve">图 1 图甲</w:t>')) {
    throw new Error('docx 无 h1 题注应无章节前缀「图 1 图甲」(chapter null)');
  }
  const mdEmptyCap = `# 章

![图一](g1-tiny.png)

图: {#fig:a}
`;
  const gEmpty = await convert(mdEmptyCap, "docx", { baseDir: B, warnings: [] });
  const gEmptyX = unzipPart(gEmpty.buffer, "word/document.xml");
  if (!gEmptyX.includes('<w:t xml:space="preserve">图 1.1</w:t>')) {
    throw new Error('docx 空题注文本应仅渲染编号「图 1.1」(无尾随空格)');
  }
  if (gEmptyX.includes("{#fig:a}")) {
    throw new Error("docx 空题注场景 label 不应泄漏到文档文本");
  }
  console.log("[ok] cross-ref:题注 chapter null(无 h1 → 图 1)与空题注文本(仅编号)断言通过");

  // ============ 场景 H(B3):headingNumbering 关 → 图/表编号全文档连续(双格式一致) ============
  // 已拍板契约:headingNumbering=false 时 docx 不再在 h1 处重置 figIndex/tabIndex,
  // 与 pdf 侧(仅 isNumbered 时重置)及 captions.ts 注释本意对齐。
  const mdCapContinuous = `# 第一章

![图一](g1-tiny.png)

图: 甲图

# 第二章

![图二](g1-tiny.png)

图: 乙图
`;
  const hnOffCapD = await convert(mdCapContinuous, "docx", {
    baseDir: B,
    warnings: [],
    typography: { ...DEFAULT_TYPOGRAPHY, headingNumbering: false },
  });
  const hnOffCapX = unzipPart(hnOffCapD.buffer, "word/document.xml");
  if (!hnOffCapX.includes('<w:t xml:space="preserve">图 1 甲图</w:t>')) {
    throw new Error("B3 断言失败:headingNumbering 关时首图应为「图 1」");
  }
  if (!hnOffCapX.includes('<w:t xml:space="preserve">图 2 乙图</w:t>')) {
    throw new Error("B3 断言失败:headingNumbering 关时次章图应连续编号「图 2」(不得按章重置为「图 1」)");
  }
  const hnOffCapP = await convert(mdCapContinuous, "pdf", {
    baseDir: B,
    warnings: [],
    title: "t",
    typography: { ...DEFAULT_TYPOGRAPHY, headingNumbering: false },
  });
  // pdf 编号经 CSS counter 在打印期生成,HTML 源码无「图 N」字面文本;
  // 断言连续性语义:走全局重置分支(body 重置一次),且无 h1 级重置规则
  if (!hnOffCapP.html.includes("body { counter-reset: figc tabc; }")) {
    throw new Error("B3 断言失败:pdf headingNumbering 关时应使用全局题注计数器(连续编号)");
  }
  if (/h1 \{ counter-reset:[^}]*figc/.test(hnOffCapP.html)) {
    throw new Error("B3 断言失败:pdf headingNumbering 关时不得存在 h1 级题注重置规则");
  }

  console.log("[ok] cross-ref:docx+pdf 题注/章节/公式交叉引用、悬空降级、开关与 8b 修复断言通过(12 条验收点)");
}
