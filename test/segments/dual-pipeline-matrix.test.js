/**
 * 双管线差异矩阵(docx ↔ pdf):必须一致 / 允许不同的可执行断言表(21 行,含双侧提取器与来源锚点)。
 *
 * 做法:把散落各段的「双管线差异」注释收敛为一张表——每行一个语义维度,声明判定
 * 类别、双侧提取方式与来源锚点,并在同一次运行里真的跑出双侧产物做断言
 * (禁止只列元数据不验证);行结构本身也受守护(缺判定类别/双侧提取器/锚点/断言即报错)。
 *
 * 表格常量为什么放测试侧(而非 core 纯模块):
 * 1) 矩阵是**测试契约**(判定类别 + 提取器 + 锚点),提取器依赖测试夹具与产物
 *    解包工具;放 core 等于把测试关注点编译进发布产物;
 * 2) 矩阵行随两侧实现演进而增删,放 core 会让发布代码跟着测试节奏变;
 * 3) 真正需要两侧共享的东西(白名单 / 正则族 / 预算取值 / 计数器)在 core 已有
 *    单源模块,矩阵只断言「双侧消费同一单源」,不在此内联复制契约。
 * 故:MATRIX 留在本文件;共享契约一律 import core 单源。
 *
 * 为何单文件不分岛(超 500 行的例外):矩阵各行共用同一套提取器与同一份
 * 「双侧产物 → ctx」的构建(run() 内按 1..21 分区注释);拆文件要么复制
 * 产物构建(两份漂移风险),要么把断言表挪出段层(段就只剩装配)。故维持单体 +
 * 区块注释,新增维度一律「加一行 MATRIX + 加一段产物构建」。
 *
 * 判定类别:
 * - mustMatch:双侧语义必须一致(载体可不同:docx 是 OOXML,PDF 是 HTML/CSS);
 * - allowedDiff:有意的实现差异,断言「差异确实存在且方向正确」(既防差异被
 *   意外抹平,也防差异扩大到契约之外)。
 *
 * 来源锚点格式 `文件:行号`,指向该维度在两侧的实现位置;行号随实现漂移,
 * 锚点失效时以该行断言的可执行事实为准重新定位(注释只是导航,不是断言)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { renderPdfHtml } from "../../dist/core/pdf/render.js";
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";
import { DEFAULT_KATEX_RESOURCE_LIMITS } from "../../dist/core/resource-limits.js";
import { ALLOWED_INLINE_TAGS } from "../../dist/core/markdown/html-whitelist.js";
import { injectTocPageNumbers } from "../../dist/core/pdf/postprocess.js";
import { unzipPart, zipContains } from "../common/docx-utils.js";
import { FIXTURES_DIR, KATEX_DIR } from "../common/paths.js";

const B = FIXTURES_DIR;

// ---------- 断言小工具(失败信息带矩阵行 id,便于定位到 case) ----------
function must(cond, rowId, msg) {
  if (!cond) throw new Error(`[dual-matrix:${rowId}] ${msg}`);
}
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------- 双侧提取器(行内 docxExtract/pdfExtract 与实现一致) ----------
/** docx 产物 → document.xml 文本 */
async function docxXml(buffer) {
  return unzipPart(buffer, "word/document.xml");
}
/** docx 目录条目锚点(静态 TOC 条目 = 指向标题 slug 的 w:hyperlink) */
function docxTocAnchors(xml) {
  return [...xml.matchAll(/<w:hyperlink w:history="1" w:anchor="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((a) => !/^(fig|tab|eq)-/.test(a));
}
/** docx 书签名(标题/题注/公式锚点) */
function docxBookmarks(xml) {
  return [...xml.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]+)"/g)].map((m) => m[1]);
}
/** pdf 目录条目(h1-h3 → toc-lN) */
function pdfTocItems(html) {
  return [...html.matchAll(/<li class="toc-l(\d)"><a href="#([^"]+)"/g)].map((m) => ({
    level: Number(m[1]),
    id: m[2],
  }));
}
/** pdf 正文标题层级与锚点 id */
function pdfHeadingIds(html) {
  return [...html.matchAll(/<h([1-6]) id="([^"]+)"/g)].map((m) => ({ level: Number(m[1]), id: m[2] }));
}

// ---------- 夹具 ----------
/** 主样例:一次覆盖 frontmatter / 白名单 / 分页 / 目录层级 / 题注编号 /
 *  label 剥离 / 交叉引用 / 公式编号 / 任务列表 / 脚注 / 代码高亮 */
const mainMd = `---
title: 矩阵样例文档
author: 测试作者
---

# 一级标题 {#sec:top}

正文首段,含行内 <strong>白名单粗体</strong> 与 <sub>下标</sub>;危险片段 <div class="x">块级标签</div> 与 <script>alert(1)</script>。

<!-- page-break -->

## 二级标题 {#sec:mid}

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

表: 样例表 {#tab:beta}

见 [图](#fig:alpha)、[表](#tab:beta)、[章节](#sec:mid)、[式](#eq:energy) 与悬空 [图](#fig:none)。

$$
E = mc^2
$$

{#eq:energy}

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

- [x] 已完成
- [ ] 待办

脚注引用[^note]。

[^note]: 脚注内容。

\`\`\`ts
const x = 1;
\`\`\`

# 第二章

![章二图](g1-tiny.png)

图: 章二图 {#fig:gamma}
`;

/** 深标题:h1-h6 全有 id,目录只收 h1-h3 */
const deepHeadingsMd = `# 一级

## 二级

### 三级

#### 四级

##### 五级

###### 六级

# 第二章
`;

/** 题注先于首个 h1(docx 章节号 null → 纯序数;pdf h1c 计数器仍为 0) */
const captionBeforeH1Md = `![章前图](g1-tiny.png)

图: 章前图

# 第一章

![章内图](g1-tiny.png)

图: 章内图
`;

/** 题注 label(captionNumbering 关闭时的 label 原样保留对照样例) */
const captionLabelMd = `# 甲

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

表: 样例表 {#tab:beta}

见 [图](#fig:alpha)。
`;

/** 公式边界样本:maxExpand 失控 / 解析失败 / 外部引用指令 / mstyle 未覆盖 */
const katexBoundaryMd = `# 公式边界

宏展开失控:

$$
\\def\\a{\\a}\\a
$$

解析失败:

$$
\\frac{1}{
$$

外部引用指令:

$$
\\includegraphics[width=1cm]{a.png}
$$

未覆盖结构:

$$
\\color{red}{x}
$$
`;

// 场景导出(gen-fixtures 落盘为 acceptance/dual-pipeline-matrix*.md)
export const fixtures = {
  main: mainMd,
  "deep-headings": deepHeadingsMd,
  "caption-before-h1": captionBeforeH1Md,
  "caption-label": captionLabelMd,
  "katex-boundary": katexBoundaryMd,
};

// ---------- 其余行内样例(与矩阵逐行对应) ----------
/** 白名单:合法行内标签 + 白名单外块级/脚本标签 */
const whitelistMd = `行内 <strong>粗</strong> 与 <sub>下标</sub>。

<div class="x">块级标签</div>

<script>alert(1)</script>
`;
/** 分页符(隔离样本:无 frontmatter、无目录,排除封面/目录页的分页) */
const pageBreakMd = "# 分页\n\n<!-- page-break -->\n\n第二页\n";
/** hr 语义对照:`---` 不产生分页 */
const hrMd = "第一段\n\n---\n\n第二段\n";
/** 题注编号(图/表独立计数 + h1 重置 + 引用编号) */
const captionMd = `# 第一章

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

表: 样例表 {#tab:beta}

见 [图](#fig:alpha) 与悬空 [图](#fig:none)。

# 第二章

![章二图](g1-tiny.png)

图: 章二图 {#fig:gamma}
`;
/** 公式编号(label + 引用) */
const equationMd = `# 公式编号

$$
E = mc^2
$$

{#eq:energy}

见 [式](#eq:energy)。
`;
/** fig/tab 同名 label 边界(查表按 label 单一命名空间) */
const sameLabelMd = `![图一](g1-tiny.png)

图: 图一 {#fig:same}

| A | B |
| --- | --- |
| 1 | 2 |

表: 表一 {#tab:same}

见 [图](#fig:same) 与 [表](#tab:same)。
`;
/** 脚注 */
const footnoteMd = "正文脚注[^a]。\n\n[^a]: 脚注内容。\n";
/** 任务列表 */
const taskListMd = "- [x] 已完成\n- [ ] 待办\n";
/** 标题 id 取源兜底:标题内含内联链接 */
const headingLinkMd = "## 见 [附录](#sec:tail)\n\n正文。\n";
/** 目录页码回填样本 */
const tocMd = `# 一级

正文一。

## 二级

正文二。
`;
/** mermaid 围栏 */
const mermaidMd = "```mermaid\ngraph TD;\nA-->B;\n```\n";
/** 外链图片(图片预算记账口径探针) */
const externalImageMd = "![外链图](https://example.com/a.png)\n";
/** 无 h1 的单题注文档 */
const noH1CaptionMd = "![图](g1-tiny.png)\n\n图: 无章节图\n";

/** 计数守卫:统计取消检查点调用次数(密度差异的可执行度量) */
function countingGuard() {
  const counter = { checks: 0 };
  return {
    counter,
    guard: {
      signal: undefined,
      canceled: () => false,
      throwIfCanceled() {
        counter.checks += 1;
      },
      race: (p) => p,
      remainingMs: (fallback) => fallback,
      dispose() {},
    },
  };
}

/**
 * 差异矩阵表。行字段:
 * - id:稳定标识(失败信息按此定位到 case);
 * - mode:"mustMatch" | "allowedDiff";
 * - dimension:语义维度(人读);
 * - docxExtract / pdfExtract:双侧提取方式描述;
 * - anchors:来源锚点(src/<文件>.ts:<行号>);
 * - verify:执行断言(入参 ctx 含已渲染好的双侧产物与辅助提取结果)。
 */
const MATRIX = [
  // ================= 必须一致 =================
  {
    id: "frontmatter-strip",
    mode: "mustMatch",
    dimension: "frontmatter 剥离(共用 parseFrontmatter,渲染只作用于 body)",
    docxExtract: "document.xml 无 `title:`/`author:` 原文行;metadata.title 走封面",
    pdfExtract: "HTML 无 `title:`/`author:` 原文行;metadata.title 走封面",
    anchors: [
      "src/core/convert.ts:160(先剥离,渲染只吃 body)",
      "src/core/pipeline/frontmatter.ts:53",
      "src/core/docx/render.ts:215(封面页)",
      "src/core/pdf/template.ts:153(封面 + page-break)",
    ],
    verify: async ({ docxXmlText, pdfHtml }) => {
      must(!docxXmlText.includes("title: 矩阵样例文档"), "frontmatter-strip", "docx 正文泄漏 frontmatter 原文行");
      must(!docxXmlText.includes("author: 测试作者"), "frontmatter-strip", "docx 正文泄漏 frontmatter author 行");
      must(!pdfHtml.includes("title: 矩阵样例文档"), "frontmatter-strip", "PDF 正文泄漏 frontmatter 原文行");
      must(!pdfHtml.includes("author: 测试作者"), "frontmatter-strip", "PDF 正文泄漏 frontmatter author 行");
      must(docxXmlText.includes("矩阵样例文档"), "frontmatter-strip", "docx 封面应消费 metadata.title");
      must(pdfHtml.includes("矩阵样例文档"), "frontmatter-strip", "PDF 封面应消费 metadata.title");
      must(docxXmlText.includes("一级标题"), "frontmatter-strip", "docx 应保留 frontmatter 之后的正文标题");
      must(pdfHtml.includes("一级标题"), "frontmatter-strip", "PDF 应保留 frontmatter 之后的正文标题");
    },
  },
  {
    id: "page-geometry",
    mode: "mustMatch",
    dimension: "页面几何(同一 pageSetup → 同一纸张与四边距,docx 记 twips / pdf 记 mm)",
    docxExtract: "w:pgSz(w/h/orient) + w:pgMar(top/right/bottom/left)",
    pdfExtract: "模板 CSS `@page { size: …; margin: …mm …mm …mm …mm }`",
    anchors: [
      "src/core/docx/render.ts:231(纸张 twips + 四边距 twips)",
      "src/core/pdf/template-css.ts:59(@page size/margin)",
      "src/core/settings/settings-defaults.ts:274(validatePageSetup 几何门禁,两侧共用)",
    ],
    verify: async ({ geometry }) => {
      const [w, h] = geometry.paperTwips;
      must(geometry.docxXml.includes(`<w:pgSz w:w="${w}" w:h="${h}" w:orient="portrait"`), "page-geometry", `docx 缺少 A5 纸张 ${w}×${h} twips`);
      must(geometry.docxXml.includes(geometry.pgMar), "page-geometry", `docx 缺少 ${geometry.pgMar}`);
      must(geometry.pdfHtml.includes(geometry.pageCss), "page-geometry", `PDF 缺少 ${geometry.pageCss}`);
    },
  },
  {
    id: "html-whitelist",
    mode: "mustMatch",
    dimension: "内联 HTML 白名单集合(同一 ALLOWED_INLINE_TAGS;白名单外两侧都不渲染为富文本)",
    docxExtract: "白名单标签 → 对应 run 属性(bold / vertAlign);白名单外 → 整段丢弃",
    pdfExtract: "白名单标签 → 原样输出标签;白名单外 → 转义为文本",
    anchors: [
      "src/core/markdown/html-whitelist.ts:12(ALLOWED_INLINE_TAGS 单源)",
      "src/core/docx/handlers/inline-html.ts:48(标签→样式表,与白名单恒等)",
      "src/core/pdf/rules/html.ts:10(白名单外转义)",
    ],
    verify: async ({ whitelistDocxXml, whitelistPdfHtml }) => {
      must(ALLOWED_INLINE_TAGS.has("strong") && ALLOWED_INLINE_TAGS.has("sub"), "html-whitelist", "白名单缺少样本标签(契约漂移)");
      must(whitelistDocxXml.includes("<w:b/>"), "html-whitelist", "docx <strong> 未渲染为加粗 run");
      must(/<w:vertAlign w:val="subscript"/.test(whitelistDocxXml), "html-whitelist", "docx <sub> 未渲染为下标 run");
      must(whitelistPdfHtml.includes("<strong>粗</strong>"), "html-whitelist", "PDF <strong> 未原样输出");
      must(whitelistPdfHtml.includes("<sub>下标</sub>"), "html-whitelist", "PDF <sub> 未原样输出");
      must(!whitelistDocxXml.includes("块级标签"), "html-whitelist", "docx 白名单外块级标签内容不应残留");
      must(!whitelistDocxXml.includes("alert(1)"), "html-whitelist", "docx script 内容不应残留");
      must(whitelistPdfHtml.includes("&lt;div"), "html-whitelist", "PDF 白名单外块级标签应转义");
      must(whitelistPdfHtml.includes("&lt;script&gt;"), "html-whitelist", "PDF script 应转义");
    },
  },
  {
    id: "explicit-page-break",
    mode: "mustMatch",
    dimension: "显式分页符 `<!-- page-break -->`(独占语义,两侧各产生一个分页;`---` 保持 hr)",
    docxExtract: "count(<w:br w:type=\"page\"/>)",
    pdfExtract: "count(<div class=\"page-break\">) 与 <hr>",
    anchors: [
      "src/core/docx/render.ts:399(trim 后精确匹配 → PageBreak)",
      "src/core/docx/handlers/fallback.ts:52(行内 html 路径同判定)",
      "src/core/pdf/rules/html.ts:75(注释 → 分页 div)",
      "src/core/pdf/template-css.ts:60(break-before: page)",
    ],
    verify: async ({ pageBreak }) => {
      must(pageBreak.docxCount === 1, "explicit-page-break", `docx 分页符数量应为 1,实际 ${pageBreak.docxCount}`);
      must(pageBreak.pdfCount === 1, "explicit-page-break", `PDF 分页符数量应为 1,实际 ${pageBreak.pdfCount}`);
      must(!pageBreak.hrDocxHasBreak, "explicit-page-break", "docx:`---` 不应产生分页符");
      must(!pageBreak.hrPdfHasBreak, "explicit-page-break", "PDF:`---` 不应产生 .page-break");
      must(pageBreak.hrPdf.includes("<hr>"), "explicit-page-break", "PDF:`---` 应渲染为 <hr>");
    },
  },
  {
    id: "toc-levels",
    mode: "mustMatch",
    dimension: "目录层级 h1-h3(h4-h6 有 id 也不进目录;标题文本为空时两侧同回退为 section 锚点)",
    docxExtract: "TOC 静态条目 w:anchor(标题 slug) vs 标题书签 w:name",
    pdfExtract: "toc-l1..3 条目 <li class=\"toc-lN\"> vs <hN id=…>",
    anchors: [
      "src/core/docx/prescan.ts:79(depth<=3 且有 id)",
      "src/core/pdf/postprocess.ts:33(extractHeadings 只取 h1-h3)",
      "src/core/markdown/slug.ts:8(slugify 空结果回退 section)",
    ],
    verify: async ({ tocDocxXml, tocPdfHtml, emptyHeading }) => {
      const anchors = docxTocAnchors(tocDocxXml);
      const marks = docxBookmarks(tocDocxXml);
      for (const level of ["一级", "二级", "三级"]) {
        must(anchors.includes(level), "toc-levels", `docx 目录缺少 ${level}标题条目(实际:${anchors.join(",")})`);
      }
      for (const level of ["四级", "五级", "六级"]) {
        must(marks.includes(level), "toc-levels", `docx ${level}标题应有书签(供锚点跳转)`);
        must(!anchors.includes(level), "toc-levels", `docx ${level}标题不应进目录`);
      }
      const items = pdfTocItems(tocPdfHtml);
      must(
        items.map((i) => i.level).join(",") === "1,2,3,1",
        "toc-levels",
        `PDF 目录层级应为 1,2,3,1(实际 ${items.map((i) => i.level).join(",")})`,
      );
      const heads = pdfHeadingIds(tocPdfHtml);
      must(heads.length === 7, "toc-levels", `PDF 正文标题应为 7 个(h1-h6 + 第二章),实际 ${heads.length}`);
      must(
        heads.filter((h) => h.level > 3).length === 3,
        "toc-levels",
        "PDF h4-h6 应有锚点 id(与 docx 书签对应)",
      );
      // 「无 id」在纯文本标题上不可达(markdown 标题必有文本),可达形态是
      // 「文本被 label 剥空」:两侧都回退为 section 锚点,且仍按层级进目录
      must(docxBookmarks(emptyHeading.docxXml).includes("section"), "toc-levels", "docx 空文本标题应回退为 section 书签");
      must(docxTocAnchors(emptyHeading.docxXml).includes("section"), "toc-levels", "docx 空文本标题应按层级进目录");
      must(
        pdfHeadingIds(emptyHeading.pdfHtml).some((h) => h.level === 2 && h.id === "section"),
        "toc-levels",
        "PDF 空文本标题应回退为 id=section 的 h2",
      );
      must(
        pdfTocItems(emptyHeading.pdfHtml).some((i) => i.level === 2 && i.id === "section"),
        "toc-levels",
        "PDF 空文本标题应按层级进目录(与 docx 同口径)",
      );
    },
  },
  {
    id: "caption-numbering",
    mode: "mustMatch",
    dimension: "题注编号与 h1 重置(章节号 + 章内序数,图/表独立计数,h1 处重置)",
    docxExtract: "题注段静态编号文本「图 1.1 …」「图 2.1 …」",
    pdfExtract: "xref 替换出的编号文本 + 模板 CSS counter 规则(显示态编号走伪元素)",
    anchors: [
      "src/core/docx/handlers/captions.ts:74(章节号/序数分配)",
      "src/core/docx/handlers/captions.ts:120(captionNumberText 单源)",
      "src/core/pdf/template-css.ts:192(counter-increment)与 194(h1 重置)",
      "src/core/pdf/rules/xref.ts:144(编号文本与 CSS counter 同源)",
    ],
    verify: async ({ capDocxXml, capPdfHtml }) => {
      for (const needle of [
        '<w:t xml:space="preserve">图 1.1 样例图</w:t>',
        '<w:t xml:space="preserve">表 1.1 样例表</w:t>',
        '<w:t xml:space="preserve">图 2.1 章二图</w:t>',
      ]) {
        must(capDocxXml.includes(needle), "caption-numbering", `docx 题注编号缺失:${needle}`);
      }
      must(!capDocxXml.includes("表 1.2"), "caption-numbering", "docx 图/表计数应相互独立(表不占图序)");
      must(
        capPdfHtml.includes('.fig-caption::before { content: "图 " counter(h1c) "." counter(figc) " "; }'),
        "caption-numbering",
        "PDF 缺少「章节号 + 章内序数」counter 规则",
      );
      must(
        capPdfHtml.includes("h1 { counter-reset: h2c h3c figc tabc; }"),
        "caption-numbering",
        "PDF 缺少 h1 处题注重置规则",
      );
      must(
        capPdfHtml.includes('href="#fig:alpha">图 1.1<'),
        "caption-numbering",
        "PDF 题注编号语义(首图 图 1.1)应与 docx 一致",
      );
    },
  },
  {
    id: "caption-label-strip",
    mode: "mustMatch",
    dimension: "题注 label 剥离({#fig:label}/{#tab:label} 不渲染,只登记为跳转锚点;开关关闭时两侧同口径原样保留)",
    docxExtract: "书签 fig-<label>/tab-<label> + 文本无 `{#fig:` 残留;开关关闭 → 无书签、label 原样",
    pdfExtract: "锚点 <span id=\"fig:label\"> + 文本无 `{#fig:` 残留;开关关闭 → 无锚点、无编号 CSS",
    anchors: [
      "src/core/docx/handlers/captions.ts:97(剥离 + 登记)",
      "src/core/pdf/rules/xref.ts:140(stripTrailingLabel 剥离 + 登记)",
      "src/core/markdown/cross-ref.ts:29(kindLabelRegex 单源)",
    ],
    verify: async ({ capDocxXml, capPdfHtml, labelOff }) => {
      const marks = docxBookmarks(capDocxXml);
      must(marks.includes("fig-alpha"), "caption-label-strip", "docx 缺少题注书签 fig-alpha");
      must(marks.includes("tab-beta"), "caption-label-strip", "docx 缺少题注书签 tab-beta");
      must(!capDocxXml.includes("{#fig:"), "caption-label-strip", "docx label 泄漏到文本");
      must(capPdfHtml.includes('<span id="fig:alpha"></span>'), "caption-label-strip", "PDF 缺少题注锚点 fig:alpha");
      must(capPdfHtml.includes('<span id="tab:beta"></span>'), "caption-label-strip", "PDF 缺少题注锚点 tab:beta");
      must(!capPdfHtml.includes("{#fig:"), "caption-label-strip", "PDF label 泄漏到 HTML 文本");
      // captionNumbering:false:两侧同口径——label 原样保留、不登记锚点、不编号
      must(labelOff.docxXml.includes("图: 样例图 {#fig:alpha}"), "caption-label-strip", "docx 关开关后 label 应原样保留");
      must(!docxBookmarks(labelOff.docxXml).includes("fig-alpha"), "caption-label-strip", "docx 关开关后不应登记题注书签");
      must(!labelOff.docxXml.includes("图 1.1"), "caption-label-strip", "docx 关开关后不应注入编号");
      must(labelOff.pdfHtml.includes("{#fig:alpha}"), "caption-label-strip", "PDF 关开关后 label 应原样保留");
      must(!labelOff.pdfHtml.includes('<span id="fig:alpha">'), "caption-label-strip", "PDF 关开关后不应登记题注锚点");
      must(!labelOff.pdfHtml.includes("counter(figc)"), "caption-label-strip", "PDF 关开关后不应产出题注编号 CSS");
    },
  },
  {
    id: "crossref-text-dangling",
    mode: "mustMatch",
    dimension: "交叉引用文案与悬空降级(默认文本→编号;悬空→占位文案 + 同一条去重警告)",
    docxExtract: "hyperlink anchor + 编号文本;悬空 → 「图 (?)」纯文本 + 警告",
    pdfExtract: "href + 编号文本;悬空 → 占位纯文本(无死链 href)+ 警告",
    anchors: [
      "src/core/markdown/cross-ref.ts:14(CROSS_REF_KINDS 文案/占位单源)",
      "src/core/docx/handlers/link-xref.ts:25(引用替换)",
      "src/core/pdf/rules/xref.ts:166(两遍替换 + 悬空解包)",
    ],
    verify: async ({ capDocxXml, capPdfHtml, capDocxWarnings, capPdfWarnings }) => {
      must(capDocxXml.includes('<w:hyperlink w:history="1" w:anchor="fig-alpha">'), "crossref-text-dangling", "docx 图引用缺跳转");
      must(capPdfHtml.includes('href="#fig:alpha">图 1.1<'), "crossref-text-dangling", "PDF 图引用文本非「图 1.1」");
      must(capDocxXml.includes("图 (?)"), "crossref-text-dangling", "docx 悬空引用缺占位「图 (?)」");
      must(capPdfHtml.includes("图 (?)"), "crossref-text-dangling", "PDF 悬空引用缺占位「图 (?)」");
      must(!capPdfHtml.includes('href="#fig:none"'), "crossref-text-dangling", "PDF 悬空引用不应保留死链 href");
      const want = "交叉引用未找到图 label: fig:none";
      const docxHits = capDocxWarnings.filter((w) => formatWarning(w) === want).length;
      const pdfHits = capPdfWarnings.filter((w) => formatWarning(w) === want).length;
      must(docxHits === 1, "crossref-text-dangling", `docx 悬空警告应去重为 1 条(实际 ${docxHits})`);
      must(pdfHits === 1, "crossref-text-dangling", `PDF 悬空警告应去重为 1 条(实际 ${pdfHits})`);
    },
  },
  {
    id: "equation-label-switch",
    mode: "mustMatch",
    dimension: "公式 label 与编号开关(编号连续、label 登记为锚点、关开关后不编号且引用保持原文本)",
    docxExtract: "编号静态文本 (N) + 书签 eq-<label> + 引用「式 (1)」",
    pdfExtract: "class=\"eq-num\">(N) + 锚点 id=\"eq:<label>\" + 引用 href 文本",
    anchors: [
      "src/core/docx/handlers/equations.ts:55(buildEquationContext)",
      "src/core/pdf/rules/equation.ts:25(eq_numbering 规则)",
      "src/core/markdown/cross-ref.ts:43(EQ_LABEL_RE 单源)",
    ],
    verify: async ({ eqDocxXml, eqPdfHtml, eqOffDocxXml, eqOffPdfHtml }) => {
      must(eqDocxXml.includes("<m:oMath"), "equation-label-switch", "docx display 公式未生成 MathML");
      must(eqDocxXml.includes('<w:t xml:space="preserve">(1)</w:t>'), "equation-label-switch", "docx 公式编号 (1) 缺失");
      must(docxBookmarks(eqDocxXml).includes("eq-energy"), "equation-label-switch", "docx 公式书签 eq-energy 缺失");
      must(eqDocxXml.includes("式 (1)"), "equation-label-switch", "docx 公式引用未替换为「式 (1)」");
      must(!eqDocxXml.includes("{#eq:"), "equation-label-switch", "docx label 标记行不应渲染");
      must(eqPdfHtml.includes('class="eq-num">(1)'), "equation-label-switch", "PDF 公式编号结构缺失");
      must(eqPdfHtml.includes('<span id="eq:energy">'), "equation-label-switch", "PDF 公式锚点缺失");
      must(eqPdfHtml.includes('href="#eq:energy">式 (1)<'), "equation-label-switch", "PDF 公式引用未替换为「式 (1)」");
      must(!eqPdfHtml.includes("{#eq:"), "equation-label-switch", "PDF label 标记行不应渲染");
      for (const [name, text] of [
        ["docx", eqOffDocxXml],
        ["PDF", eqOffPdfHtml],
      ]) {
        must(!text.includes("式 (1)"), "equation-label-switch", `${name} 关开关后引用不应被编号替换`);
        must(!text.includes("式 (?)"), "equation-label-switch", `${name} 关开关后引用不应降级为占位`);
        must(!text.includes("{#eq:energy}"), "equation-label-switch", `${name} 关开关后 label 段不应渲染`);
      }
      must(!eqOffPdfHtml.includes('class="eq-num"'), "equation-label-switch", "PDF 关开关后不应有 eq-num 结构");
    },
  },
  {
    id: "katex-limits",
    mode: "mustMatch",
    dimension: "KaTeX 资源边界(同一份 maxExpand/maxSize/trust/throwOnError;超边界不放行、不中断转换)",
    docxExtract: "失控/未覆盖公式 → 整式降级(等宽灰字 + 警告,无 m:oMath)",
    pdfExtract: "失控公式 → katex-error;超 maxSize 的显式尺寸被钳到 10em",
    anchors: [
      "src/core/resource-limits.ts:33(DEFAULT_KATEX_RESOURCE_LIMITS 单源)",
      "src/core/docx/handlers/math.ts:76(转发同一份边界)",
      "src/core/pdf/render.ts:185(插件转发同一份边界)",
    ],
    verify: async ({ katex }) => {
      must(
        DEFAULT_KATEX_RESOURCE_LIMITS.maxExpand === 1000 &&
          DEFAULT_KATEX_RESOURCE_LIMITS.maxSize === 10 &&
          DEFAULT_KATEX_RESOURCE_LIMITS.trust === false &&
          DEFAULT_KATEX_RESOURCE_LIMITS.throwOnError === false,
        "katex-limits",
        `资源边界取值漂移:${JSON.stringify(DEFAULT_KATEX_RESOURCE_LIMITS)}`,
      );
      must(Object.isFrozen(DEFAULT_KATEX_RESOURCE_LIMITS), "katex-limits", "资源边界应冻结(防运行期被改写)");
      // maxSize:PDF 侧 500em 被钳到 10em,5em 原样放行(证明同一阈值在生效)
      must(katex.pdfBig.includes("border-right-width:10em"), "katex-limits", "PDF 未把 500em 钳到 maxSize=10em");
      must(katex.pdfSmall.includes("border-right-width:5em"), "katex-limits", "PDF 未放行 maxSize 内的 5em");
      // maxSize:docx 侧同一构造(MathML mpadded 未覆盖)整式降级,不放行超边界尺寸
      must(!katex.docxBig.includes("<m:oMath"), "katex-limits", "docx 不应放行超 maxSize 的显式尺寸构造");
      must(katex.docxBig.includes("公式解析失败,降级为 TeX 源码") || katex.docxBigWarnings.some((w) => formatWarning(w).includes("公式解析失败")), "katex-limits", "docx 应对超边界构造给出降级警告");
      // maxExpand 失控:两侧都只降级出源码,转换不中断
      must(!katex.docxExpand.includes("<m:oMath"), "katex-limits", "docx 宏展开失控公式不应产出 MathML");
      must(katex.docxExpand.includes("\\def"), "katex-limits", "docx 宏展开失控公式应降级为 TeX 源码");
      must(katex.pdfExpand.includes("katex-error"), "katex-limits", "PDF 宏展开失控公式应输出 katex-error 标记");
      // katexDir 边界:缺失只影响 PDF 字体样式(公式内容不丢);docx 走 MathML 与之无关
      must(katex.boundaryPdfNoDir.includes('class="katex"'), "katex-limits", "PDF 无 katexDir 时公式仍应渲染为 KaTeX HTML");
      must(!katex.boundaryPdfNoDir.includes("@font-face"), "katex-limits", "PDF 无 katexDir 时不应内联 @font-face");
      must(katex.boundaryPdfNoDirWarnings.length === 0, "katex-limits", `PDF 未传 katexDir 不应产生警告(实际 ${katex.boundaryPdfNoDirWarnings.length} 条)`);
      must(katex.boundaryPdfWithDir.includes("@font-face"), "katex-limits", "PDF 传 katexDir 时应内联 KaTeX 字体样式");
      must(
        katex.boundaryDocxWithDir === katex.boundaryDocxNoDir,
        "katex-limits",
        "docx 产物不应随 katexDir 变化(MathML 路线不消费该字段)",
      );
    },
  },
  {
    id: "code-highlight",
    mode: "mustMatch",
    dimension: "代码高亮与降级警告(同一 hljs 单例 + 同一色板;未知语言与抛错两侧都降级且警告同文案)",
    docxExtract: "已知语言 → <w:color …>;未知/失败 → 无 color + keyed 警告",
    pdfExtract: "已知语言 → pre.hljs + language-* class;未知/失败 → 无高亮 span + 同文案警告",
    anchors: [
      "src/core/docx/handlers/code-highlight.ts:46(highlightCodeRuns,失败走 onFallback)",
      "src/core/pdf/render.ts:155(highlight 回调,抛错回退转义 + 同 key 警告)",
      "src/core/style/hljs-palette.ts:22(色板单源)",
    ],
    verify: async ({ code }) => {
      must(code.docxKnown.includes('<w:color w:val="CF222E"/>'), "code-highlight", "docx 已知语言未着色(keyword)");
      must(
        code.pdfKnown.includes('<pre class="hljs"><code class="language-ts">'),
        "code-highlight",
        "PDF 已知语言未产出 language-ts 高亮结构",
      );
      must(!code.docxUnknown.includes("<w:color"), "code-highlight", "docx 未知语言不应着色");
      must(!code.pdfUnknown.includes('class="language-nolangxyz"'), "code-highlight", "PDF 未知语言不应带 language-* class");
      must(code.pdfUnknown.includes("const unknown = 1;"), "code-highlight", "PDF 未知语言代码文本应保留");
      const want = "代码高亮失败,已降级为纯文本: broken";
      must(
        code.docxBrokenWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "code-highlight",
        "docx 高亮抛错应产生同文案降级警告",
      );
      must(
        code.pdfBrokenWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "code-highlight",
        "PDF 高亮抛错应产生同文案降级警告",
      );
      must(!code.docxBroken.includes("<w:color"), "code-highlight", "docx 高亮抛错后不应残留着色");
      must(!code.pdfBroken.includes('<span class="hljs-keyword">'), "code-highlight", "PDF 高亮抛错后不应残留高亮 span");
    },
  },
  {
    id: "xref-label-namespace",
    mode: "mustMatch",
    dimension: "fig/tab 同名 label 判定(查表按 label 单一命名空间 + kind 防御校验,后写者覆盖)",
    docxExtract: "同名时后出现的表题注覆盖图题注 → [图] 引用悬空、[表] 命中",
    pdfExtract: "同名时同样口径:[图] 悬空(无死链)、[表] 命中",
    anchors: [
      "src/core/docx/ctx.ts:119(captionLabels 单一命名空间)",
      "src/core/docx/handlers/captions.ts:112(label → {kind, numberText})",
      "src/core/pdf/rules/xref.ts:148(同名后写覆盖)与 183(kind 防御校验)",
    ],
    verify: async ({ nsDocxXml, nsPdfHtml, nsDocxWarnings, nsPdfWarnings }) => {
      // 已知边界:captionLabels 以 label 为键(不分 fig:/tab: 前缀),后写覆盖,
      // 引用侧按 kind 防御校验 → 同名 label 时先出现者悬空。两侧口径必须一致。
      const marks = docxBookmarks(nsDocxXml);
      must(marks.includes("fig-same") && marks.includes("tab-same"), "xref-label-namespace", "两侧题注都应生成书签");
      must(nsDocxXml.includes('<w:hyperlink w:history="1" w:anchor="tab-same">'), "xref-label-namespace", "docx 表引用应命中(后写者)");
      must(nsDocxXml.includes("图 (?)"), "xref-label-namespace", "docx 图引用应判悬空(同名 label 被覆盖)");
      must(nsPdfHtml.includes('href="#tab:same">表 1<'), "xref-label-namespace", "PDF 表引用应命中(后写者)");
      must(nsPdfHtml.includes("图 (?)"), "xref-label-namespace", "PDF 图引用应判悬空(与 docx 同口径)");
      must(!nsPdfHtml.includes('href="#fig:same"'), "xref-label-namespace", "PDF 悬空引用不应保留死链 href");
      const want = "交叉引用未找到图 label: fig:same";
      must(
        nsDocxWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "xref-label-namespace",
        "docx 悬空图警告缺失",
      );
      must(
        nsPdfWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "xref-label-namespace",
        "PDF 悬空图警告缺失",
      );
    },
  },

  // ================= 允许不同 =================
  {
    id: "formula-degrade-trigger",
    mode: "allowedDiff",
    dimension: "公式降级触发条件(docx 靠 MathML 产物是否全覆盖 + 信任闸门;pdf 靠 hasUntrustedTexCommand 预拦截 + KaTeX 自身错误产物)",
    docxExtract: "不可信命令与未覆盖结构 → 等宽灰字 + 警告(无 katex-error 标记)",
    pdfExtract: "不可信命令 → katex-error(标题含「不受信任」);未覆盖结构 → 正常渲染",
    anchors: [
      "src/core/docx/handlers/math.ts:72(信任闸门)与 84(未覆盖 → 整式降级)",
      "src/core/pdf/render.ts:208(guardUntrustedMath 预拦截)",
      "src/core/resource-limits.ts:84(UNTRUSTED_TEX_COMMAND_RE 单源)",
    ],
    verify: async ({ degrade }) => {
      must(!degrade.docxUntrusted.includes("katex-error"), "formula-degrade-trigger", "docx 侧不应出现 katex-error 标记");
      must(degrade.docxUntrusted.includes('<w:color w:val="888888"/>'), "formula-degrade-trigger", "docx 降级应为等宽灰字");
      must(degrade.docxUntrusted.includes("includegraphics"), "formula-degrade-trigger", "docx 降级应保留 TeX 源码");
      must(
        degrade.pdfUntrusted.includes("公式含不受信任的外部引用指令"),
        "formula-degrade-trigger",
        "PDF 应由 hasUntrustedTexCommand 预拦截并给出 katex-error 说明",
      );
      must(!degrade.docxColor.includes("<m:oMath"), "formula-degrade-trigger", "docx \\color 应因 MathML 未覆盖(mstyle)而降级");
      must(degrade.pdfColor.includes('class="katex"'), "formula-degrade-trigger", "PDF \\color 应正常渲染(不触发 docx 侧降级条件)");
      must(!degrade.pdfColor.includes("katex-error"), "formula-degrade-trigger", "PDF \\color 不应误报 katex-error");
    },
  },
  {
    id: "mermaid-carrier",
    mode: "allowedDiff",
    dimension: "Mermaid 产物(docx 内嵌 PNG;pdf 内联 SVG 矢量;失败两侧都降级为代码块 + 同文案警告)",
    docxExtract: "word/media/ 部件;失败 → 等宽原文 + 警告",
    pdfExtract: "<div class=\"mermaid-svg\">…</div>;失败 → pre.mermaid-fallback + 警告",
    anchors: [
      "src/core/markdown/mermaid.ts:17(MermaidResult 契约:svg + png)",
      "src/core/docx/handlers/code-block.ts:19(docx 内嵌 png)",
      "src/core/pdf/mermaid.ts:46(内联 svg)与 49(失败降级)",
    ],
    verify: async ({ mermaid }) => {
      must(mermaid.docxHasMedia, "mermaid-carrier", "docx 未内嵌 mermaid PNG 部件");
      must(!mermaid.docxHasSvg, "mermaid-carrier", "docx 不应内联 SVG(矢量路线属 pdf)");
      must(mermaid.pdfHasSvg, "mermaid-carrier", "PDF 未内联 mermaid SVG");
      must(!mermaid.pdfHasBase64, "mermaid-carrier", "PDF 不应把 mermaid 转成位图(矢量路线)");
      const want = "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块";
      must(mermaid.docxFailed.includes("graph TD;"), "mermaid-carrier", "docx 降级后应保留围栏源码");
      must(mermaid.pdfFailed.includes('<pre class="mermaid-fallback">'), "mermaid-carrier", "PDF 降级应为 mermaid-fallback 代码块");
      must(
        mermaid.docxFailedWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "mermaid-carrier",
        "docx 降级警告文案应与 PDF 一致",
      );
      must(
        mermaid.pdfFailedWarnings.filter((w) => formatWarning(w) === want).length === 1,
        "mermaid-carrier",
        "PDF 降级警告文案应与 docx 一致",
      );
    },
  },
  {
    id: "footnote-implementation",
    mode: "allowedDiff",
    dimension: "脚注实现(docx 写 footnotes.xml 部件 + 引用标记;pdf 渲染为文档流末尾的 HTML 脚注区)",
    docxExtract: "word/footnotes.xml 部件 + w:footnoteReference",
    pdfExtract: "section.footnotes + li.footnote-item + 回链锚点",
    anchors: [
      "src/core/docx/render.ts:261(footnotes 部件,空则不生成)",
      "src/core/pdf/render.ts:180(@mdit/plugin-footnote)",
      "src/core/pdf/template-css.ts:148(脚注区样式;Chromium 无 float: footnote)",
    ],
    verify: async ({ footnote }) => {
      must(footnote.docxHasPart, "footnote-implementation", "docx 缺少 footnotes.xml 部件");
      must(footnote.docxHasReference, "footnote-implementation", "docx 正文缺少脚注引用标记");
      must(footnote.docxHasText, "footnote-implementation", "docx 脚注内容缺失");
      must(!footnote.pdfHasPart, "footnote-implementation", "PDF 路线不应出现 docx 部件(载体不同)");
      must(footnote.pdfHasSection, "footnote-implementation", "PDF 缺少脚注区 <section class=\"footnotes\">");
      must(footnote.pdfHasItem, "footnote-implementation", "PDF 缺少脚注条目 li.footnote-item");
      must(footnote.pdfHasBackref, "footnote-implementation", "PDF 缺少脚注回链锚点");
      must(footnote.pdfHasText, "footnote-implementation", "PDF 脚注内容缺失");
    },
  },
  {
    id: "tasklist-rendering",
    mode: "allowedDiff",
    dimension: "任务列表呈现(docx 剥除标记按普通项目符号;pdf 渲染 ☑/☐ 字符规避打印 bug)",
    docxExtract: "ListParagraph + w:numPr,无 checkbox 字形",
    pdfExtract: "li.task-list-item + ☑/☐ 字符,无 input/label 残留",
    anchors: [
      "src/core/pipeline/parse.ts:40(remark-gfm 剥除 [x]/[ ] 标记)",
      "src/core/pdf/render.ts:136(replaceTaskCheckboxes)",
    ],
    verify: async ({ task }) => {
      must(task.docxHasList, "tasklist-rendering", "docx 应按普通列表项渲染(ListParagraph)");
      must(!task.docxHasGlyph, "tasklist-rendering", "docx 不应出现 checkbox 字形");
      must(task.pdfHasChecked && task.pdfHasUnchecked, "tasklist-rendering", "PDF 应输出 ☑/☐ 字符");
      must(!task.pdfHasInput, "tasklist-rendering", "PDF 不应残留 checkbox input(printToPDF bug 源)");
      must(!task.pdfHasLabel, "tasklist-rendering", "PDF 不应残留 task-list-item-label");
    },
  },
  {
    id: "image-budget-accounting",
    mode: "allowedDiff",
    dimension: "图片预算记账口径(docx 计原始字节;pdf 外链计 base64 内联字节,含 4/3 膨胀)",
    docxExtract: "同一 maxDocumentBytes 下是否产出 word/media/ 部件",
    pdfExtract: "同一 maxDocumentBytes 下是否产出 data: URL",
    anchors: [
      "src/core/resource-limits.ts:97(字节口径由调用方决定)",
      "src/core/docx/render.ts:180(台账按原始字节)",
      "src/core/pdf/postprocess.ts:250(costOf = base64 长度)",
    ],
    verify: async ({ budget }) => {
      must(budget.docxEmbeds, "image-budget-accounting", "docx 在 raw+1 预算下应放行(记原始字节)");
      must(!budget.pdfEmbeds, "image-budget-accounting", "PDF 在 raw+1 预算下应拦截(base64 已超预算)");
      must(budget.pdfEmbedsWithBase64Budget, "image-budget-accounting", "PDF 在 base64+1 预算下应放行");
      must(budget.pdfWarned, "image-budget-accounting", "PDF 超预算应给出图片失败降级警告");
    },
  },
  {
    id: "heading-id-fallback",
    mode: "allowedDiff",
    dimension: "标题 id 取源兜底(docx 无兜底:collectPlainText 纯文本;pdf 兜底:heading_open 的下一个 inline token 原文)",
    docxExtract: "标题书签名(纯文本 slug)",
    pdfExtract: "hN 的 id(保留 markdown 标记中的字母数字,如链接目标)",
    anchors: [
      "src/core/pipeline/parse.ts:53(docx 侧 id 来自 collectPlainText)",
      "src/core/pdf/rules/heading-id.ts:52(token.content || tokens[idx+1].content 兜底)",
      "src/core/markdown/slug.ts:8(slugify 只剔除非字母/数字/下划线/连字符)",
    ],
    verify: async ({ heading }) => {
      must(docxBookmarks(heading.docxXml).includes("见-附录"), "heading-id-fallback", "docx 标题 id 应为纯文本 slug「见-附录」");
      must(
        pdfHeadingIds(heading.pdfHtml).some((h) => h.id === "见-附录sectail"),
        "heading-id-fallback",
        "PDF 标题 id 应含内联链接文本痕迹「见-附录sectail」(兜底取 inline 原文)",
      );
      must(
        pdfTocItems(heading.pdfHtml).some((i) => i.id === "见-附录sectail"),
        "heading-id-fallback",
        "PDF 目录条目应与正文锚点同源",
      );
      must(docxTocAnchors(heading.docxXml).includes("见-附录"), "heading-id-fallback", "docx 目录条目应与标题书签同源");
    },
  },
  {
    id: "toc-page-numbers",
    mode: "allowedDiff",
    dimension: "目录页码(docx static 无页码 / field 为 Word 域;pdf 两遍法在打印后回填 toc-page)",
    docxExtract: "TOC 域 w:dirty 属性(static=false / field=true)",
    pdfExtract: "core 产物无 toc-page;injectTocPageNumbers 回填后才有",
    anchors: [
      "src/core/docx/chrome.ts:105(tocMode → beginDirty)",
      "src/core/pdf/postprocess.ts:81(injectTocPageNumbers)",
      "src/main/converter/single.ts:214(field 模式两遍打印回填)",
    ],
    verify: async ({ tocPage }) => {
      must(tocPage.staticDirtyFalse && !tocPage.staticHasDirtyTrue, "toc-page-numbers", "docx static 目录应为 dirty=false(免更新、无页码)");
      must(tocPage.fieldDirtyTrue, "toc-page-numbers", "docx field 目录应为 dirty=true(触发 Word 更新域取真实页码)");
      must(!tocPage.pdfHasPageSpan, "toc-page-numbers", "PDF core 产物不应自带 toc-page 条目(打印前无页码;模板 CSS 中的 .toc-page 规则不计)");
      must(tocPage.pdfAfterInject.includes('<span class="toc-page">'), "toc-page-numbers", "PDF 两遍法回填后应出现 toc-page 页码");
      must(tocPage.pdfAfterInject.includes('<span class="toc-page">2</span>'), "toc-page-numbers", "PDF 回填页码值应取自传入映射");
    },
  },
  {
    id: "cancel-checkpoint-density",
    mode: "allowedDiff",
    dimension: "取消检查点密度(docx 逐块复查;pdf 只在 parse/inline/mermaid/katex 阶段边界复查)",
    docxExtract: "注入计数守卫统计 throwIfCanceled 次数(随块数增长)",
    pdfExtract: "同法统计(与文档规模无关的常数)",
    anchors: [
      "src/core/docx/render.ts:221(块级循环内逐块复查)与 277(打包前)",
      "src/core/pdf/render.ts:259(入口)与 279(阶段边界复查)",
    ],
    verify: async ({ cancel }) => {
      must(
        cancel.pdfSmall === cancel.pdfLarge,
        "cancel-checkpoint-density",
        `PDF 检查点数应与文档规模无关(小 ${cancel.pdfSmall} / 大 ${cancel.pdfLarge})`,
      );
      must(
        cancel.docxLarge > cancel.docxSmall * 2,
        "cancel-checkpoint-density",
        `docx 检查点数应随块数增长(小 ${cancel.docxSmall} / 大 ${cancel.docxLarge})`,
      );
      must(
        cancel.docxLarge > cancel.pdfLarge,
        "cancel-checkpoint-density",
        "同规模下 docx 检查点应比 pdf 密(逐块 vs 阶段边界)",
      );
    },
  },
  {
    id: "caption-before-first-h1",
    mode: "allowedDiff",
    dimension: "题注先于首个 h1(docx 章节号为 null → 纯序数「图 1」;pdf 含 h1 文档走 h1c 计数器,首 h1 前显示为「图 0.1」)",
    docxExtract: "题注静态文本(首图无章节前缀)",
    pdfExtract: "CSS counter 分支(含 h1c 的 ::before 规则,首 h1 前章节号按 0 计)",
    anchors: [
      "src/core/docx/handlers/captions.ts:104(chapter>0 才给章节号)",
      "src/core/pdf/template-css.ts:197(hasH1 分支含 h1c)",
      "src/core/pdf/rules/caption.ts:15(该边界在规则头注声明为已接受差异)",
    ],
    verify: async ({ beforeH1 }) => {
      must(
        beforeH1.docxXml.includes('<w:t xml:space="preserve">图 1 章前图</w:t>'),
        "caption-before-first-h1",
        "docx 首图应无章节前缀「图 1 章前图」",
      );
      must(
        beforeH1.docxXml.includes('<w:t xml:space="preserve">图 1.1 章内图</w:t>'),
        "caption-before-first-h1",
        "docx h1 之后应恢复章节号「图 1.1」",
      );
      must(
        beforeH1.pdfHtml.includes('.fig-caption::before { content: "图 " counter(h1c) "." counter(figc) " "; }'),
        "caption-before-first-h1",
        "PDF 含 h1 文档走含 h1c 的 counter 分支(首 h1 前章节号显示为 0)",
      );
      // 无 h1 文档:两侧都退化为纯序数(此处不存在差异)
      must(beforeH1.noH1Docx.includes("图 1 无章节图"), "caption-before-first-h1", "docx 无 h1 文档应为纯序数");
      must(
        beforeH1.noH1Pdf.includes('.fig-caption::before { content: "图 " counter(figc) " "; }'),
        "caption-before-first-h1",
        "PDF 无 h1 文档应为纯序数分支(与 docx 一致)",
      );
    },
  },
];

/** 断言矩阵自身结构:每行齐备(判定类别/维度/双侧提取器/锚点/可执行断言),行 id 唯一 */
function assertMatrixShape() {
  const ids = new Set();
  for (const row of MATRIX) {
    if (ids.has(row.id)) throw new Error(`[dual-matrix] 行 id 重复:${row.id}`);
    ids.add(row.id);
    if (row.mode !== "mustMatch" && row.mode !== "allowedDiff") {
      throw new Error(`[dual-matrix:${row.id}] mode 非法:${row.mode}`);
    }
    for (const key of ["dimension", "docxExtract", "pdfExtract"]) {
      if (typeof row[key] !== "string" || row[key].length < 4) {
        throw new Error(`[dual-matrix:${row.id}] 缺少 ${key} 描述`);
      }
    }
    if (!Array.isArray(row.anchors) || row.anchors.length === 0) {
      throw new Error(`[dual-matrix:${row.id}] 缺少来源锚点`);
    }
    for (const anchor of row.anchors) {
      if (!/^src\/[\w./-]+\.ts:\d+/.test(anchor)) {
        throw new Error(`[dual-matrix:${row.id}] 锚点须为 src/<文件>.ts:<行号>,实际:${anchor}`);
      }
    }
    if (typeof row.verify !== "function") {
      throw new Error(`[dual-matrix:${row.id}] 缺少可执行断言(verify)`);
    }
  }
}

export async function run() {
  assertMatrixShape();
  const png = await fs.readFile(path.join(B, "g1-tiny.png"));
  const img = { imageResolver: async () => png };
  const nullMermaid = { mermaidResolver: async () => null };

  // ---------- 1. frontmatter 剥离 ----------
  const fmDocx = await convert(mainMd, "docx", { baseDir: B, warnings: [], ...img });
  const fmPdf = await convert(mainMd, "pdf", { baseDir: B, title: "矩阵", warnings: [], ...img });

  // ---------- 2. 页面几何(A5 + 四边互异,防属性错位) ----------
  const pageSetup = { paper: "A5", orientation: "portrait", marginTop: 18, marginRight: 12, marginBottom: 22, marginLeft: 16 };
  const geoDocx = await convert("页面几何样本。\n", "docx", { baseDir: B, warnings: [], pageSetup });
  const geoPdf = await convert("页面几何样本。\n", "pdf", { baseDir: B, title: "t", warnings: [], pageSetup });

  // ---------- 3. HTML 白名单 ----------
  const wlDocx = await convert(whitelistMd, "docx", { baseDir: B, warnings: [] });
  const wlPdf = await convert(whitelistMd, "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 4. 显式分页符 / hr 对照 ----------
  const pbDocx = await convert(pageBreakMd, "docx", { baseDir: B, warnings: [], toc: false });
  const pbPdf = await convert(pageBreakMd, "pdf", { baseDir: B, title: "t", warnings: [], toc: false });
  const hrDocx = await convert(hrMd, "docx", { baseDir: B, warnings: [], toc: false });
  const hrPdf = await convert(hrMd, "pdf", { baseDir: B, title: "t", warnings: [], toc: false });

  // ---------- 5. 目录层级 ----------
  const tocDocx = await convert(deepHeadingsMd, "docx", { baseDir: B, warnings: [] });
  const tocPdf = await convert(deepHeadingsMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  // 标题文本被 label 剥空 → 两侧都回退为 section 锚点
  const emptyHeadingDocx = await convert("# 一级\n\n## {#sec:only}\n\n正文。\n", "docx", { baseDir: B, warnings: [] });
  const emptyHeadingPdf = await convert("# 一级\n\n## {#sec:only}\n\n正文。\n", "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 6-8. 题注编号 / label 剥离 / 交叉引用 ----------
  const capDocxW = [];
  const capPdfW = [];
  const capDocx = await convert(captionMd, "docx", { baseDir: B, warnings: capDocxW, ...img });
  const capPdf = await convert(captionMd, "pdf", { baseDir: B, title: "t", warnings: capPdfW, ...img });
  // captionNumbering 显式关闭:label 原样保留的对照(显式项契约见 toc-caption 段)
  const labelOffDocx = await convert(captionLabelMd, "docx", { baseDir: B, warnings: [], captionNumbering: false, ...img });
  const labelOffPdf = await convert(captionLabelMd, "pdf", { baseDir: B, title: "t", warnings: [], captionNumbering: false, ...img });

  // ---------- 9. 公式 label 与编号开关 ----------
  const eqDocx = await convert(equationMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR });
  const eqPdf = await convert(equationMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR });
  const eqOffDocx = await convert(equationMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR, equationNumbering: false });
  const eqOffPdf = await convert(equationMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR, equationNumbering: false });

  // ---------- 10. KaTeX 资源边界 ----------
  const bigRuleMd = "$$\\rule{500em}{1em}$$\n";
  const smallRuleMd = "$$\\rule{5em}{1em}$$\n";
  const expandMd = "$$\\def\\a{\\a}\\a$$\n";
  const bigRuleW = [];
  const bigRuleDocx = await convert(bigRuleMd, "docx", { baseDir: B, warnings: bigRuleW });
  const bigRulePdf = await convert(bigRuleMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  const smallRulePdf = await convert(smallRuleMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  const expandDocx = await convert(expandMd, "docx", { baseDir: B, warnings: [] });
  const expandPdf = await convert(expandMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  // katexDir 边界:同一份含多类公式的样例,加/不加 katexDir 各跑一次
  const boundaryPdfNoDirW = [];
  const boundaryPdfNoDir = await convert(katexBoundaryMd, "pdf", { baseDir: B, title: "t", warnings: boundaryPdfNoDirW });
  const boundaryPdfWithDir = await convert(katexBoundaryMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR });
  const boundaryDocxNoDir = await docxXml((await convert(katexBoundaryMd, "docx", { baseDir: B, warnings: [] })).buffer);
  const boundaryDocxWithDir = await docxXml((await convert(katexBoundaryMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR })).buffer);

  // ---------- 11. 代码高亮与降级警告 ----------
  const knownMd = "```ts\nconst x = 1; // note\n```\n";
  const unknownMd = "```nolangxyz\nconst unknown = 1;\n```\n";
  const knownDocx = await convert(knownMd, "docx", { baseDir: B, warnings: [] });
  const knownPdf = await convert(knownMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  const unknownDocx = await convert(unknownMd, "docx", { baseDir: B, warnings: [] });
  const unknownPdf = await convert(unknownMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  // 注册编译期即抛错的坏语言 → 触发「语言已知但高亮失败」降级(两侧同一句警告)
  const hljs = (await import("highlight.js/lib/common")).default;
  const brokenMd = "```broken\nif (a < b) {}\n```\n";
  const brokenDocxW = [];
  const brokenPdfW = [];
  let brokenDocxXml = "";
  let brokenPdfHtml = "";
  hljs.registerLanguage("broken", () => ({ match: "x", begin: /y/ }));
  try {
    brokenDocxXml = await docxXml((await convert(brokenMd, "docx", { baseDir: B, warnings: brokenDocxW })).buffer);
    brokenPdfHtml = (await convert(brokenMd, "pdf", { baseDir: B, title: "t", warnings: brokenPdfW })).html;
  } finally {
    hljs.unregisterLanguage("broken");
  }

  // ---------- 12. fig/tab 同名 label 边界 ----------
  const nsDocxW = [];
  const nsPdfW = [];
  const nsDocx = await convert(sameLabelMd, "docx", { baseDir: B, warnings: nsDocxW, ...img });
  const nsPdf = await convert(sameLabelMd, "pdf", { baseDir: B, title: "t", warnings: nsPdfW, ...img });

  // ---------- 13. 公式降级触发条件 ----------
  const untrustedMd = "$$\\includegraphics[width=1cm]{a.png}$$\n";
  const colorMd = "$$\\color{red}{x}$$\n";
  const untrustedDocx = await convert(untrustedMd, "docx", { baseDir: B, warnings: [] });
  const untrustedPdf = await convert(untrustedMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  const colorDocx = await convert(colorMd, "docx", { baseDir: B, warnings: [] });
  const colorPdf = await convert(colorMd, "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 14. Mermaid ----------
  const mermaidOk = async () => ({ svg: '<svg data-mermaid="1"></svg>', png, width: 120, height: 60 });
  const mermaidDocx = await convert(mermaidMd, "docx", { baseDir: B, warnings: [], mermaidResolver: mermaidOk });
  const mermaidPdf = await convert(mermaidMd, "pdf", { baseDir: B, title: "t", warnings: [], mermaidResolver: mermaidOk });
  const mermaidFailDocxW = [];
  const mermaidFailPdfW = [];
  const mermaidFailDocx = await convert(mermaidMd, "docx", { baseDir: B, warnings: mermaidFailDocxW, ...nullMermaid });
  const mermaidFailPdf = await convert(mermaidMd, "pdf", { baseDir: B, title: "t", warnings: mermaidFailPdfW, ...nullMermaid });

  // ---------- 15. 脚注 ----------
  const fnDocx = await convert(footnoteMd, "docx", { baseDir: B, warnings: [] });
  const fnPdf = await convert(footnoteMd, "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 16. 任务列表 ----------
  const taskDocx = await convert(taskListMd, "docx", { baseDir: B, warnings: [] });
  const taskPdf = await convert(taskListMd, "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 17. 图片预算记账口径 ----------
  const rawPlusOne = { maxDocumentBytes: png.length + 1 };
  const base64PlusOne = { maxDocumentBytes: Math.ceil(png.length / 3) * 4 + 1 };
  const budgetDocx = await convert(externalImageMd, "docx", { baseDir: B, warnings: [], imageResolver: async () => png, imageBudget: rawPlusOne });
  const budgetPdfW = [];
  const budgetPdf = await convert(externalImageMd, "pdf", { baseDir: B, title: "t", warnings: budgetPdfW, imageResolver: async () => png, imageBudget: rawPlusOne });
  const budgetPdfOk = await convert(externalImageMd, "pdf", { baseDir: B, title: "t", warnings: [], imageResolver: async () => png, imageBudget: base64PlusOne });

  // ---------- 18. 标题 id 取源兜底 ----------
  const headingDocx = await convert(headingLinkMd, "docx", { baseDir: B, warnings: [] });
  const headingPdf = await convert(headingLinkMd, "pdf", { baseDir: B, title: "t", warnings: [] });

  // ---------- 19. 目录页码 ----------
  const tocStaticDocx = await convert(tocMd, "docx", { baseDir: B, warnings: [] });
  const tocFieldDocx = await convert(tocMd, "docx", { baseDir: B, warnings: [], tocMode: "field" });
  const tocPagePdf = await convert(tocMd, "pdf", { baseDir: B, title: "t", warnings: [] });
  // ---------- 20. 取消检查点密度 ----------
  const smallMd = "# 小文档\n\n一段。\n";
  const largeMd = Array.from({ length: 12 }, (_, i) => `## 标题 ${i + 1}\n\n段落 ${i + 1}。\n`).join("\n");
  const docxSmall = countingGuard();
  const docxLarge = countingGuard();
  const pdfSmall = countingGuard();
  const pdfLarge = countingGuard();
  await renderDocx(parseMarkdown(smallMd), { guard: docxSmall.guard, toc: false });
  await renderDocx(parseMarkdown(largeMd), { guard: docxLarge.guard, toc: false });
  await renderPdfHtml(smallMd, { baseDir: B, guard: pdfSmall.guard, toc: false });
  await renderPdfHtml(largeMd, { baseDir: B, guard: pdfLarge.guard, toc: false });

  // ---------- 21. 题注先于首个 h1 ----------
  const beforeH1Docx = await convert(captionBeforeH1Md, "docx", { baseDir: B, warnings: [], ...img });
  const beforeH1Pdf = await convert(captionBeforeH1Md, "pdf", { baseDir: B, title: "t", warnings: [], ...img });
  const noH1Docx = await convert(noH1CaptionMd, "docx", { baseDir: B, warnings: [], ...img });
  const noH1Pdf = await convert(noH1CaptionMd, "pdf", { baseDir: B, title: "t", warnings: [], ...img });

  // ---------- 组装断言上下文(全部为已渲染好的双侧产物) ----------
  const ctx = {
    docxXmlText: await docxXml(fmDocx.buffer),
    pdfHtml: fmPdf.html,
    geometry: {
      docxXml: await docxXml(geoDocx.buffer),
      pdfHtml: geoPdf.html,
      // A5 = 148×210 mm → round(mm × 56.6929);四边距 18/12/22/16 mm 同口径换算
      paperTwips: [8391, 11906],
      pgMar: '<w:pgMar w:top="1020" w:right="680" w:bottom="1247" w:left="907"',
      pageCss: "size: A5; margin: 18mm 12mm 22mm 16mm;",
    },
    whitelistDocxXml: await docxXml(wlDocx.buffer),
    whitelistPdfHtml: wlPdf.html,
    pageBreak: {
      docxCount: countOf(await docxXml(pbDocx.buffer), '<w:br w:type="page"/>'),
      pdfCount: countOf(pbPdf.html, '<div class="page-break">'),
      hrDocxHasBreak: (await docxXml(hrDocx.buffer)).includes('<w:br w:type="page"/>'),
      hrPdfHasBreak: hrPdf.html.includes('<div class="page-break">'),
      hrPdf: hrPdf.html,
    },
    tocDocxXml: await docxXml(tocDocx.buffer),
    tocPdfHtml: tocPdf.html,
    emptyHeading: {
      docxXml: await docxXml(emptyHeadingDocx.buffer),
      pdfHtml: emptyHeadingPdf.html,
    },
    capDocxXml: await docxXml(capDocx.buffer),
    capPdfHtml: capPdf.html,
    capDocxWarnings: capDocxW,
    capPdfWarnings: capPdfW,
    labelOff: {
      docxXml: await docxXml(labelOffDocx.buffer),
      pdfHtml: labelOffPdf.html,
    },
    eqDocxXml: await docxXml(eqDocx.buffer),
    eqPdfHtml: eqPdf.html,
    eqOffDocxXml: await docxXml(eqOffDocx.buffer),
    eqOffPdfHtml: eqOffPdf.html,
    katex: {
      docxBig: await docxXml(bigRuleDocx.buffer),
      docxBigWarnings: bigRuleW,
      pdfBig: bigRulePdf.html,
      pdfSmall: smallRulePdf.html,
      docxExpand: await docxXml(expandDocx.buffer),
      pdfExpand: expandPdf.html,
      boundaryPdfNoDir: boundaryPdfNoDir.html,
      boundaryPdfNoDirWarnings: boundaryPdfNoDirW,
      boundaryPdfWithDir: boundaryPdfWithDir.html,
      boundaryDocxNoDir,
      boundaryDocxWithDir,
    },
    code: {
      docxKnown: await docxXml(knownDocx.buffer),
      pdfKnown: knownPdf.html,
      docxUnknown: await docxXml(unknownDocx.buffer),
      pdfUnknown: unknownPdf.html,
      docxBroken: brokenDocxXml,
      pdfBroken: brokenPdfHtml,
      docxBrokenWarnings: brokenDocxW,
      pdfBrokenWarnings: brokenPdfW,
    },
    nsDocxXml: await docxXml(nsDocx.buffer),
    nsPdfHtml: nsPdf.html,
    nsDocxWarnings: nsDocxW,
    nsPdfWarnings: nsPdfW,
    degrade: {
      docxUntrusted: await docxXml(untrustedDocx.buffer),
      pdfUntrusted: untrustedPdf.html,
      docxColor: await docxXml(colorDocx.buffer),
      pdfColor: colorPdf.html,
    },
    mermaid: {
      docxHasMedia: zipContains(mermaidDocx.buffer, "word/media/"),
      docxHasSvg: (await docxXml(mermaidDocx.buffer)).includes("<svg"),
      pdfHasSvg: mermaidPdf.html.includes('<div class="mermaid-svg"><svg data-mermaid="1">'),
      pdfHasBase64: mermaidPdf.html.includes("data:image/png;base64,"),
      docxFailed: await docxXml(mermaidFailDocx.buffer),
      pdfFailed: mermaidFailPdf.html,
      docxFailedWarnings: mermaidFailDocxW,
      pdfFailedWarnings: mermaidFailPdfW,
    },
    footnote: {
      docxHasPart: zipContains(fnDocx.buffer, "word/footnotes.xml"),
      docxHasReference: (await docxXml(fnDocx.buffer)).includes("w:footnoteReference"),
      docxHasText: (await unzipPart(fnDocx.buffer, "word/footnotes.xml")).includes("脚注内容"),
      pdfHasPart: fnPdf.html.includes("word/footnotes.xml"),
      pdfHasSection: fnPdf.html.includes('<section class="footnotes">'),
      pdfHasItem: fnPdf.html.includes('class="footnote-item"'),
      pdfHasBackref: fnPdf.html.includes('class="footnote-backref"'),
      pdfHasText: fnPdf.html.includes("脚注内容"),
    },
    task: {
      docxHasList: (await docxXml(taskDocx.buffer)).includes("ListParagraph"),
      docxHasGlyph: (await docxXml(taskDocx.buffer)).includes("☑") || (await docxXml(taskDocx.buffer)).includes("☐"),
      pdfHasChecked: taskPdf.html.includes("☑ 已完成"),
      pdfHasUnchecked: taskPdf.html.includes("☐ 待办"),
      pdfHasInput: taskPdf.html.includes("task-list-item-checkbox"),
      pdfHasLabel: taskPdf.html.includes("task-list-item-label"),
    },
    budget: {
      docxEmbeds: zipContains(budgetDocx.buffer, "word/media/"),
      pdfEmbeds: budgetPdf.html.includes("data:image/png;base64,"),
      pdfEmbedsWithBase64Budget: budgetPdfOk.html.includes("data:image/png;base64,"),
      pdfWarned: budgetPdfW.some((w) => formatWarning(w).includes("图片加载失败")),
    },
    heading: { docxXml: await docxXml(headingDocx.buffer), pdfHtml: headingPdf.html },
    // tocPage 需要解包 zip + 调用纯函数,在 ctx 组装后补齐(见下方)
    tocPage: null,
    cancel: {
      docxSmall: docxSmall.counter.checks,
      docxLarge: docxLarge.counter.checks,
      pdfSmall: pdfSmall.counter.checks,
      pdfLarge: pdfLarge.counter.checks,
    },
    beforeH1: {
      docxXml: await docxXml(beforeH1Docx.buffer),
      pdfHtml: beforeH1Pdf.html,
      noH1Docx: await docxXml(noH1Docx.buffer),
      noH1Pdf: noH1Pdf.html,
    },
  };

  // 目录页码:两条 docx 路线 + PDF 两遍回填(需解包 zip,故在 ctx 组装后补齐)
  const tocStaticXml = await docxXml(tocStaticDocx.buffer);
  const tocFieldXml = await docxXml(tocFieldDocx.buffer);
  ctx.tocPage = {
    staticDirtyFalse: tocStaticXml.includes('w:dirty="false"'),
    staticHasDirtyTrue: tocStaticXml.includes('w:dirty="true"'),
    fieldDirtyTrue: tocFieldXml.includes('w:dirty="true"'),
    pdfHasPageSpan: tocPagePdf.html.includes('<span class="toc-page">'),
    pdfAfterInject: injectTocPageNumbers(tocPagePdf.html, { 一级: 2 }),
  };

  for (const row of MATRIX) {
    await row.verify(ctx);
    console.log(`[ok] dual-matrix:${row.id} (${row.mode}) ${row.dimension}`);
  }
  const mustCount = MATRIX.filter((r) => r.mode === "mustMatch").length;
  const diffCount = MATRIX.length - mustCount;
  console.log(
    `[ok] dual-pipeline-matrix:${MATRIX.length} 行全部实跑通过(必须一致 ${mustCount} / 允许不同 ${diffCount})`,
  );
}
