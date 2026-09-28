// @ts-check
/**
 * 双管线差异矩阵(docx ↔ pdf):必须一致 / 允许不同的可执行断言表(25 行)。
 *
 * 做法:把散落各段的「双管线差异」注释收敛为一张表——每行一个语义维度,声明判定
 * 类别、双侧提取方式与来源锚点,并在同一次运行里真的跑出双侧产物做断言
 * (禁止只列元数据不验证);行结构本身也受守护(缺判定类别/双侧提取器/锚点/断言即报错)。
 *
 * 覆盖的 8 个双管线键:前 21 行只覆盖其中 4 个 —— 6-C2 补的 4 行把另外 4 个
 * 零覆盖键纳入契约(正文字体/字号/行距/缩进/对齐 · 一级标题前分页 · 页眉页脚 ·
 * 水印),其中页眉页脚与水印两行覆盖的正是 6-B2/6-B3 确认失效的两个键:
 * 那两处失效能长期静默,正因为它们落在矩阵零覆盖区,补行本身就是堵那个洞。
 *
 * 表格常量为什么放测试侧(而非 core 纯模块):
 * 1) 矩阵是**测试契约**(判定类别 + 提取器 + 锚点),提取器依赖测试夹具与产物
 *    解包工具;放 core 等于把测试关注点编译进发布产物;
 * 2) 矩阵行随两侧实现演进而增删,放 core 会让发布代码跟着测试节奏变;
 * 3) 真正需要两侧共享的东西(白名单 / 正则族 / 预算取值 / 计数器)在 core 已有
 *    单源模块,矩阵只断言「双侧消费同一单源」,不在此内联复制契约。
 * 故:MATRIX 留在本文件;共享契约一律 import core 单源。
 *
 * 拆岛后的职责边界(本段只剩「行定义与判定」):
 * - test/common/dual-extract.js:双侧产物提取器(docx XML / 书签 / 目录锚点 / 链接体、
 *   pdf 目录条目 / 标题锚点 / 出现次数)——通用单源,被本段与其他读同种产物的段共用;
 * - test/common/dual-samples.js:原 21 行的行输入样例(其中 5 个经本段 re-export 落盘为
 *   验收样例,契约仍只在段层声明);
 * - test/common/dual-sandbox.js:沙箱装配(真跑双侧 convert + 解包提取 → MatrixCtx)
 *   与计数守卫桩;
 *   依赖单向:本段 → 上述三岛 + core dist;三岛之间不反向依赖段。
 *
 * 6-C2 新增四行的产物(buildExtendedCtx)刻意留在段内未下沉:那四行各需**专门
 * 构造的上下文**(非默认排版取值、显式开关、三种页眉模式、指定角度与不透明度),
 * 与沙箱「一份 markdown 跑一次双侧」的通用形状不同,塞进去只会把沙箱参数
 * 膨胀成一堆按行命名的可选字段。
 *
 * 超 ~500 行的例外(仅指下方的 MATRIX 行定义表):25 行 × (维度 + 双侧提取方式 + 锚点
 * + verify 判定)天然是一张宽表,拆成两个文件会让「行数统计 / 形状守护 / 逐行实跑」三处
 * 逻辑分家,反而更难保证 25 行都实跑。其余职责(提取器 / 样例 / 装配)已全部下沉。
 *
 * 判定类别:
 * - mustMatch:双侧语义必须一致(载体可不同:docx 是 OOXML,PDF 是 HTML/CSS);
 * - allowedDiff:有意的实现差异,断言「差异确实存在且方向正确」(既防差异被
 *   意外抹平,也防差异扩大到契约之外)。
 *
 * 来源锚点格式 `文件:行号`,指向该维度在两侧的实现位置;行号随实现漂移,
 * 锚点失效时以该行断言的可执行事实为准重新定位(注释只是导航,不是断言)。
 *
 * 锚点的**存在性由本段真校验**(6-C3):逐条打开源文件、确认行号在范围内。
 * 此前只校验格式不校验存在,实测 66 条里 25.8% 指向空行或纯注释、1 条越界
 * —— 「有字段但零约束」比没有字段更误导。行号指向注释行本身不算失败(注释
 * 常常正是解释该决策的位置),指向越界/空行才判红。
 *
 * 矩阵**不接门禁**(用户 2026-09-29 裁决,另立 REQ-084):回归靠
 * `M2W_ONLY=dual-pipeline-matrix` 手动筛段或全量测试带,故本段不新增门禁探针。
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { formatWarning } from "../../dist/core/i18n.js";
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_KATEX_RESOURCE_LIMITS } from "../../dist/core/resource-limits.js";
import { ALLOWED_INLINE_TAGS } from "../../dist/core/markdown/html-whitelist.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_WATERMARK,
  watermarkDmlRotation,
} from "../../dist/core/settings/settings-defaults.js";
import { WATERMARK_GRAY } from "../../dist/core/style/colors.js";
import { docxBookmarks, docxLinkBody, docxTocAnchors, pdfHeadingIds, pdfLinkBody, pdfTocItems } from "../common/dual-extract.js";
import { buildMatrixCtx } from "../common/dual-sandbox.js";
import { captionBeforeH1Md, captionLabelMd, deepHeadingsMd, katexBoundaryMd, mainMd } from "../common/dual-samples.js";
import { asDocxArtifact, asPdfArtifact, HOST_FS } from "../common/convert-helpers.js";
import { FIXTURES_DIR, ROOT } from "../common/paths.js";
// 台账侧声明的矩阵行 id(本段在 assertMatrixShape 里反向断言行集合与之逐字相同,
// 见 dual-pipeline-decision-ledger.test.js 的机制说明)
import { MATRIX_ROW_IDS } from "./dual-pipeline-decision-ledger.test.js";

/**
 * 契约类型的只读引用(编译期擦除,不产生运行期依赖——本段断言仍打 dist 产物)。
 */
/** @typedef {import("../common/dual-sandbox.js").MatrixCtx} MatrixCtx */
/** @typedef {import("../../src/core/i18n.js").ConvertWarning} Warning */
/** @typedef {import("../../src/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../src/core/settings/settings-defaults.js").HeaderFooterSettings} HeaderFooterSettings */
/** @typedef {import("../../src/core/settings/typography.js").TypographySettings} TypographySettings */
/** @typedef {import("../../src/core/settings/settings-defaults.js").WatermarkSettings} WatermarkSettings */

/**
 * 本段的完整断言上下文 = 沙箱 21 行的字段 + 6-C2 新增四行的字段。
 *
 * 单一声明而非把新增字段塞进 dual-sandbox 的 MatrixCtx:那 21 行的样例都是
 * 「同一份 markdown 跑一次双侧」,新增四行各自要专门构造的上下文(非默认排版、
 * 显式开关、三种页眉模式、指定角度与不透明度),塞进通用沙箱只会把它的参数
 * 膨胀成一堆按行命名的可选字段。边界理由见 buildExtendedCtx 的注释。
 *
 * @typedef {MatrixCtx & {
 *   typo: { docxXml: string, stylesXml: string, pdfHtml: string },
 *   typoDefault: { docxXml: string, stylesXml: string, pdfHtml: string },
 *   pageBreakH1: { on: { docxXml: string, pdfHtml: string }, off: { docxXml: string, pdfHtml: string } },
 *   chromeDocx: { default: string, custom: string, none: string, defaultFooter: string },
 *   chromePdf: {
 *     default: { header: string, footer: string },
 *     custom: { header: string, footer: string },
 *     none: { header: string, footer: string },
 *   },
 *   watermark: {
 *     settings: WatermarkSettings,
 *     docxHeaderXml: string,
 *     pdfHtml: string,
 *     docxNoText: string,
 *     pdfNoText: string,
 *   },
 * }} MatrixCtxExtended
 */

export const meta = { description: "双管线差异矩阵(docx ↔ pdf):必须一致 / 允许不同的可执行断言表(25 行,覆盖 8 个双管线键,含双侧提取器与经存在性校验的来源锚点)。" };
// 场景导出(gen-fixtures 落盘为 acceptance/dual-pipeline-matrix*.md):样例字面量在
// dual-samples.js,契约声明留在段层(生成器只认段文件的导出)。
export const fixtures = {
  main: mainMd,
  "deep-headings": deepHeadingsMd,
  "caption-before-h1": captionBeforeH1Md,
  "caption-label": captionLabelMd,
  "katex-boundary": katexBoundaryMd,
};

// ---------- 断言小工具(失败信息带矩阵行 id,便于定位到 case) ----------
/**
 * @param {unknown} cond 判定条件
 * @param {string} rowId 矩阵行 id(失败信息定位用)
 * @param {string} msg 失败说明
 * @returns {void}
 */
function must(cond, rowId, msg) {
  if (!cond) throw new Error(`[dual-matrix:${rowId}] ${msg}`);
}

/**
 * 差异矩阵表的一行。
 * @typedef {object} MatrixRow
 * @property {string} id 稳定标识
 * @property {"mustMatch" | "allowedDiff"} mode 判定类别
 * @property {string} dimension 语义维度(人读)
 * @property {string} docxExtract docx 侧提取方式
 * @property {string} pdfExtract pdf 侧提取方式
 * @property {string[]} anchors 来源锚点
 * @property {(ctx: MatrixCtxExtended) => Promise<void>} verify 执行断言
 */

/**
 * 差异矩阵表。行字段:
 * - id:稳定标识(失败信息按此定位到 case);
 * - mode:"mustMatch" | "allowedDiff";
 * - dimension:语义维度(人读);
 * - docxExtract / pdfExtract:双侧提取方式描述;
 * - anchors:来源锚点(src/<文件>.ts:<行号>);
 * - verify:执行断言(入参 ctx 含已渲染好的双侧产物与辅助提取结果)。
 */
/** @type {MatrixRow[]} */
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
      "src/core/settings/settings-defaults.ts:428(validatePageSetup 几何门禁,两侧共用)",
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
      "src/core/docx/render.ts:328(trim 后精确匹配 → PageBreak)",
      "src/core/docx/handlers/fallback.ts:63(行内 html 路径同判定)",
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
      "src/core/docx/handlers/captions.ts:114(captionNumberText 单源)",
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
      "src/core/markdown/cross-ref.ts:95(kindLabelRegex 单源)",
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
      "src/core/markdown/cross-ref.ts:22(CROSS_REF_KINDS 文案/占位单源)",
      "src/core/docx/handlers/link-xref.ts:25(引用替换)",
      "src/core/pdf/rules/xref.ts:79(两遍替换 + 悬空解包)",
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
      "src/core/docx/handlers/equations.ts:57(buildEquationContext)",
      "src/core/pdf/rules/equation.ts:25(eq_numbering 规则)",
      "src/core/markdown/cross-ref.ts:109(EQ_LABEL_RE 单源)",
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
      /** @type {[string, string][]} */
      const offSamples = [
        ["docx", eqOffDocxXml],
        ["PDF", eqOffPdfHtml],
      ];
      for (const [name, text] of offSamples) {
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
      "src/core/resource-limits.ts:34(DEFAULT_KATEX_RESOURCE_LIMITS 单源)",
      "src/core/docx/handlers/math.ts:88(转发同一份边界)",
      "src/core/pdf/render.ts:169(插件转发同一份边界)",
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
      "src/core/pdf/render.ts:139(highlight 回调,抛错回退转义 + 同 key 警告)",
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
    dimension: "fig/tab 同名 label 判定(查表键按 kind 分命名空间,captionLabelKey 单源;同名互不覆盖、跨 kind 不命中)",
    docxExtract: "同名 fig/tab 各命中各的书签编号;跨 kind 引用 → 占位 + keyed 警告;同 kind 重名 → 后写覆盖",
    pdfExtract: "同名 fig/tab 各命中各的锚点编号;跨 kind 引用 → 占位无死链 + 同文案警告;同 kind 重名 → 后写覆盖",
    anchors: [
      "src/core/markdown/cross-ref.ts:33(captionLabelKey 键单源)",
      "src/core/docx/ctx.ts:69(captionLabels 键 = kind + label)",
      "src/core/docx/handlers/captions.ts:106(按 kind 登记)",
      "src/core/docx/handlers/link-xref.ts:90(按 kind 查找)",
      "src/core/pdf/rules/xref.ts:154(按 kind 登记)与 188(按 kind 查找)",
    ],
    verify: async ({ nsDocxXml, nsPdfHtml, nsDocxWarnings, nsPdfWarnings, dupDocxXml, dupPdfHtml, dupPdfWarnings }) => {
      // 查表键含 kind(fig:a / tab:a 为两个键)→ 同名 label 的 fig/tab 题注各登记
      // 各的、互不覆盖,两侧引用各命中各的编号;跨 kind 引用查不到 → 悬空占位 +
      // 警告(文案沿用既有 key「交叉引用未找到<类别> label: <kind>:<label>」)。
      const marks = docxBookmarks(nsDocxXml);
      must(
        marks.includes("fig-same") && marks.includes("tab-same"),
        "xref-label-namespace",
        "两侧题注都应生成书签",
      );
      must(
        docxLinkBody(nsDocxXml, "fig-same").includes("图 1"),
        "xref-label-namespace",
        "docx 同名 label 的图引用应命中自己(kind 分域)",
      );
      must(
        docxLinkBody(nsDocxXml, "tab-same").includes("表 1"),
        "xref-label-namespace",
        "docx 同名 label 的表引用应命中自己(不被图题注覆盖)",
      );
      must(
        pdfLinkBody(nsPdfHtml, "fig:same").includes("图 1"),
        "xref-label-namespace",
        "PDF 同名 label 的图引用应命中自己(kind 分域)",
      );
      must(
        pdfLinkBody(nsPdfHtml, "tab:same").includes("表 1"),
        "xref-label-namespace",
        "PDF 同名 label 的表引用应命中自己(不被图题注覆盖)",
      );
      // 跨 kind 引用:label 只存在于另一 kind 的命名空间 → 悬空
      must(
        !nsDocxWarnings.some((w) => formatWarning(w).includes("fig:same") || formatWarning(w).includes("tab:same")),
        "xref-label-namespace",
        "docx 同名 label 的引用不应产生悬空警告",
      );
      const crossWant = [
        "交叉引用未找到图 label: fig:onlytab",
        "交叉引用未找到表 label: tab:onlyfig",
      ];
      /** @type {[string, Warning[]][]} */
      const crossSides = [["docx", nsDocxWarnings], ["PDF", nsPdfWarnings]];
      for (const [name, warnings] of crossSides) {
        for (const want of crossWant) {
          must(
            warnings.filter((w) => formatWarning(w) === want).length === 1,
            "xref-label-namespace",
            `${name} 跨 kind 引用应判悬空且各警告一次(${want})`,
          );
        }
      }
      must(
        nsDocxXml.includes('<w:t xml:space="preserve">图 (?)</w:t>') &&
          nsDocxXml.includes('<w:t xml:space="preserve">表 (?)</w:t>'),
        "xref-label-namespace",
        "docx 跨 kind 引用应输出占位文本",
      );
      must(
        nsPdfHtml.includes("图 (?)") && nsPdfHtml.includes("表 (?)"),
        "xref-label-namespace",
        "PDF 跨 kind 引用应输出占位文本",
      );
      must(
        pdfLinkBody(nsPdfHtml, "fig:onlytab") === "" && pdfLinkBody(nsPdfHtml, "tab:onlyfig") === "",
        "xref-label-namespace",
        "PDF 跨 kind 悬空引用不应保留死链 href",
      );
      // 同一 kind 内重名:仍按既有规则后写覆盖(先到先得语义不随 kind 分域改变)
      must(
        docxLinkBody(dupDocxXml, "fig-dup").includes("图 2"),
        "xref-label-namespace",
        "docx 同 kind 重名应后写覆盖(命中后一个题注编号)",
      );
      must(
        pdfLinkBody(dupPdfHtml, "fig:dup").includes("图 2"),
        "xref-label-namespace",
        "PDF 同 kind 重名应后写覆盖(与 docx 同口径)",
      );
      must(
        dupPdfWarnings.length === 0,
        "xref-label-namespace",
        `PDF 同 kind 重名不应产生悬空警告(实际 ${dupPdfWarnings.length} 条)`,
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
      "src/core/docx/handlers/math.ts:83(信任闸门)与 99(未覆盖 → 整式降级)",
      "src/core/pdf/render.ts:170(guardUntrustedMath 预拦截)",
      "src/core/resource-limits.ts:86(UNTRUSTED_TEX_COMMAND_RE 单源)",
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
      "src/core/docx/handlers/code-block.ts:36(docx 内嵌 png)",
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
      "src/core/pdf/render.ts:164(@mdit/plugin-footnote)",
      "src/core/pdf/template-css.ts:150(脚注区样式;Chromium 无 float: footnote)",
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
      "src/core/resource-limits.ts:69(字节口径由调用方决定)",
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
      "src/core/docx/chrome.ts:122(tocMode → beginDirty)",
      "src/core/pdf/postprocess.ts:81(injectTocPageNumbers)",
      "src/main/converter/output-skeleton.ts:245(field 模式两遍打印回填)",
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
      "src/core/docx/render.ts:198(块级循环内逐块复查)与 265(打包前)",
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
      "src/core/docx/handlers/captions.ts:96(chapter>0 才给章节号)",
      "src/core/pdf/template-css.ts:197(hasH1 分支含 h1c)",
      "src/core/pdf/rules/caption.ts:30(该边界在规则头注声明为已接受差异)",
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
  {
    id: "body-typography",
    mode: "mustMatch",
    dimension:
      "正文字体/字号/行距/缩进/对齐(同一 typography 设置 → 同一组排版;docx 记 twips/half-points,pdf 记 pt/倍数)",
    docxExtract: "styles.xml docDefaults rFonts(ascii/eastAsia)+sz;正文段 w:jc + w:spacing/@w:line + w:ind/@w:firstLineChars",
    pdfExtract: "模板 CSS body font-family/font-size/line-height;`p { text-indent: 2em }` / `p { text-align: justify }`",
    anchors: [
      "src/core/settings/typography.ts:119(DEFAULT_TYPOGRAPHY 单源)",
      "src/core/docx/render.ts:223(排版注入 docDefaults run)",
      "src/core/docx/handlers/inline-html.ts:26(正文段 jc/spacing/indent)",
      "src/core/pdf/template-css.ts:70(body 字体/字号/行距)",
    ],
    verify: async ({ typo, typoDefault }) => {
      // 显式取值:两侧都读到设置值(而非恰好等于默认,故用非默认 typography)
      must(
        typo.stylesXml.includes('w:ascii="Consolas"') && typo.stylesXml.includes('w:eastAsia="宋体"'),
        "body-typography",
        "docx docDefaults 应写入 typography 的西文/中文字体",
      );
      must(typo.stylesXml.includes('<w:sz w:val="30"/>'), "body-typography", "docx 正文字号应为 15pt × 2 = 30 half-points");
      must(
        typo.docxXml.includes('<w:jc w:val="left"/>'),
        "body-typography",
        "docx align=left 应写 w:jc=left(而非默认的 both)",
      );
      must(
        typo.docxXml.includes('<w:spacing w:line="480" w:lineRule="auto"/>'),
        "body-typography",
        "docx lineSpacing=2.0 应写 w:line=480(AUTO 规则下 = 倍数 × 240)",
      );
      must(
        !typo.docxXml.includes("w:firstLineChars"),
        "body-typography",
        "docx firstLineIndent=false 不应产出 w:ind/@w:firstLineChars",
      );
      must(
        typo.pdfHtml.includes('font-family: "宋体", "Consolas", sans-serif;'),
        "body-typography",
        "PDF body 字体栈应含 typography 的中文字体与西文字体",
      );
      must(typo.pdfHtml.includes("font-size: 15pt; line-height: 2;"), "body-typography", "PDF 字号/行距应取 typography");
      must(
        !typo.pdfHtml.includes("p { text-indent: 2em; }"),
        "body-typography",
        "PDF firstLineIndent=false 不应产出 text-indent 规则",
      );
      must(
        !typo.pdfHtml.includes("p { text-align: justify; }"),
        "body-typography",
        "PDF align=left 不应产出 text-align: justify 规则",
      );
      // 缺省对照:落回 DEFAULT_TYPOGRAPHY(证明上一组不是「恰好同默认」)
      must(
        typoDefault.stylesXml.includes('<w:sz w:val="24"/>'),
        "body-typography",
        `docx 缺省字号应为 DEFAULT_TYPOGRAPHY 的 12pt × 2 = 24 half-points`,
      );
      must(typoDefault.docxXml.includes("w:firstLineChars=\"200\""), "body-typography", "docx 缺省首行缩进应为 2 字符");
      must(typoDefault.docxXml.includes('<w:jc w:val="both"/>'), "body-typography", "docx 缺省对齐应为两端对齐");
      must(typoDefault.pdfHtml.includes("p { text-indent: 2em; }"), "body-typography", "PDF 缺省首行缩进规则应产出");
      must(typoDefault.pdfHtml.includes("p { text-align: justify; }"), "body-typography", "PDF 缺省对齐规则应产出");
      must(typoDefault.pdfHtml.includes("font-size: 12pt; line-height: 1.5;"), "body-typography", "PDF 缺省字号/行距应取默认值");
    },
  },
  {
    id: "break-before-h1",
    mode: "mustMatch",
    dimension: "一级标题前分页(同一开关 → 两侧 h1 之前都换页;关闭时两侧都不换)",
    docxExtract: "HeadingLevel.HEADING_1 段落的 pPr 含 <w:pageBreakBefore/>",
    pdfExtract: "模板 CSS `h1 { break-before: page; }`(首个 h1 除外)",
    anchors: [
      "src/core/docx/handlers/heading.ts:49(pageBreakBefore 仅 depth===1)",
      "src/core/pdf/template-css.ts:163(h1 break-before + 首 h1 豁免)",
      "src/core/settings/render-options.ts:94(breakBeforeH1 默认值解析)",
    ],
    verify: async ({ pageBreakH1 }) => {
      must(
        pageBreakH1.on.docxXml.includes("<w:pageBreakBefore/>"),
        "break-before-h1",
        "docx 开启后 h1 段落应带 pageBreakBefore",
      );
      must(
        pageBreakH1.on.pdfHtml.includes("h1 { break-before: page; }"),
        "break-before-h1",
        "PDF 开启后应有 h1 break-before 规则",
      );
      must(
        !pageBreakH1.off.docxXml.includes("<w:pageBreakBefore/>"),
        "break-before-h1",
        "docx 关闭后不应有 pageBreakBefore",
      );
      must(
        !pageBreakH1.off.pdfHtml.includes("h1 { break-before: page; }"),
        "break-before-h1",
        "PDF 关闭后不应有 h1 break-before 规则",
      );
    },
  },
  {
    id: "header-footer-modes",
    mode: "mustMatch",
    dimension:
      "页眉页脚三模式(default=文档标题居中 / custom=自定义文字(+logo) / none=无页眉;页脚=第 X 页/共 X 页,受 footerEnabled 开关)",
    docxExtract: "word/header*.xml 的文字与 w:jc;word/footer*.xml 的页码域",
    pdfExtract: "headerTemplate 的文字与 text-align;footerTemplate 的页码占位",
    anchors: [
      "src/core/docx/headers.ts:25(三模式分流)",
      "src/core/pdf/template.ts:59(default 出文档标题居中页眉)",
      "src/core/convert.ts:267(页眉模板按配置构造)",
    ],
    verify: async ({ chromeDocx, chromePdf }) => {
      // default 模式:两侧同出「文档标题居中」(adr-030 6-B3 关闭的失效点)
      must(chromeDocx.default.includes("文档标题"), "header-footer-modes", "docx default 页眉应含文档标题");
      must(chromeDocx.default.includes('<w:jc w:val="center"/>'), "header-footer-modes", "docx default 页眉应居中");
      must(chromePdf.default.header.includes("文档标题"), "header-footer-modes", "PDF default 页眉应含文档标题(6-B3 已统一)");
      must(chromePdf.default.header.includes("text-align:center"), "header-footer-modes", "PDF default 页眉应居中");
      // custom 模式:两侧同出自定义文字
      must(chromeDocx.custom.includes("页眉文字"), "header-footer-modes", "docx custom 页眉应含自定义文字");
      must(chromePdf.custom.header.includes("页眉文字"), "header-footer-modes", "PDF custom 页眉应含自定义文字");
      // none 模式:两侧都无页眉
      must(chromeDocx.none === "", "header-footer-modes", "docx none 模式不应有任何页眉内容");
      must(chromePdf.none.header === "<span></span>", "header-footer-modes", "PDF none 模式应为空模板");
      // 页脚:两侧文案同构(docx 用 PageNumber 域,pdf 用 span 占位)
      must(chromeDocx.defaultFooter.includes("第 "), "header-footer-modes", "docx 页脚应含「第 X 页」文案");
      must(chromeDocx.defaultFooter.includes("共 "), "header-footer-modes", "docx 页脚应含「共 X 页」文案");
      must(chromePdf.default.footer.includes("pageNumber"), "header-footer-modes", "PDF 页脚应含页码占位");
      must(chromePdf.default.footer.includes("totalPages"), "header-footer-modes", "PDF 页脚应含总页数占位");
    },
  },
  {
    id: "watermark",
    mode: "mustMatch",
    dimension:
      "文字水印四要素(文字 / 配色 / 旋转角度 / 不透明度):两侧同口径;不透明度两侧均真消费(6-B2),角度同号(6-B1)",
    docxExtract: "header part 的 wps:wsp 文字 + w:color + a:xfrm/@rot + w14:textFill/w14:alpha",
    pdfExtract: ".wm 覆盖层的文字 + color + transform rotate() + opacity",
    anchors: [
      "src/core/settings/settings-defaults.ts:134(水印角度口径单点)",
      "src/core/docx/chrome.ts:331(rot 取自 watermarkDmlRotation)",
      "src/core/docx/chrome.ts:301(不透明度经 w14:textFill 真消费)",
      "src/core/pdf/template.ts:124(水印 CSS 的角度与不透明度)",
    ],
    verify: async ({ watermark: wm }) => {
      const angle = wm.settings.angle;
      // 角度:两侧同号同值(6-B1 —— 收敛到单一常量后两侧不再各写各的取负)
      must(
        wm.docxHeaderXml.includes(`<a:xfrm rot="${angle * 60_000}">`),
        "watermark",
        `docx 水印 rot 应等于 angle × 60000(= ${angle * 60_000})`,
      );
      must(
        wm.docxHeaderXml.includes(`rot="${watermarkDmlRotation(angle)}"`),
        "watermark",
        "docx 水印 rot 应等于 watermarkDmlRotation 的换算结果(单一来源)",
      );
      must(wm.pdfHtml.includes(`rotate(${angle}deg)`), "watermark", `PDF 水印应旋转 ${angle}deg(与 docx 同号)`);
      // 不透明度:两侧均真消费(6-B2 —— docx 侧此前零消费)
      must(
        wm.docxHeaderXml.includes("<w14:textFill>"),
        "watermark",
        "docx 水印应产出 w14:textFill(不透明度真消费,而非靠配色近似)",
      );
      must(
        wm.docxHeaderXml.includes(`<w14:alpha w14:val="${Math.round(wm.settings.opacity * 100_000)}"/>`),
        "watermark",
        `docx 水印 alpha 应为 opacity × 100000(= ${Math.round(wm.settings.opacity * 100_000)})`,
      );
      must(
        wm.pdfHtml.includes(`opacity: ${wm.settings.opacity}`),
        "watermark",
        "PDF 水印 opacity 应直接取 settings 值",
      );
      // 文字与配色:两侧同源单色常量
      must(wm.docxHeaderXml.includes(wm.settings.text), "watermark", "docx 水印应含水印文字");
      must(wm.pdfHtml.includes(`>${wm.settings.text}</div>`), "watermark", "PDF 水印应含水印文字");
      must(wm.docxHeaderXml.includes(WATERMARK_GRAY), "watermark", "docx gray=true 应取共享浅灰常量");
      must(wm.pdfHtml.includes(`color: #${WATERMARK_GRAY}`), "watermark", "PDF gray=true 应取同一共享常量");
      // text 空串:两侧都零渲染
      must(
        !wm.docxNoText.includes("wps:wsp"),
        "watermark",
        "docx 空 text 不应产出水印形状",
      );
      must(!wm.pdfNoText.includes('class="wm"'), "watermark", "PDF 空 text 不应产出水印覆盖层");
    },
  },
];

/** 矩阵行必填的描述字段(守护用;显式元组类型使 row[key] 保持可索引) */
/** @type {["dimension", "docxExtract", "pdfExtract"]} */
const ROW_TEXT_FIELDS = ["dimension", "docxExtract", "pdfExtract"];

/** 源文件行缓存:一次运行校验全部锚点,同一文件只读一次(纯读,无 Electron) */
const sourceLineCache = new Map();

/**
 * 取源文件行数组(按需读盘并缓存)。
 * @param {string} relPath 相对仓库根的源码路径
 * @returns {string[]} 行数组(读不到即抛错,由调用方转成锚点判红信息)
 */
function sourceLines(relPath) {
  const cached = sourceLineCache.get(relPath);
  if (cached) return cached;
  const lines = fs.readFileSync(path.join(ROOT, relPath), "utf8").split(/\r?\n/);
  sourceLineCache.set(relPath, lines);
  return lines;
}

/**
 * 断言矩阵自身结构:每行齐备(判定类别/维度/双侧提取器/锚点/可执行断言),行 id 唯一,
 * 且**每条锚点的行号在源文件里真实存在**(6-C3:此前只校验格式,实测 25.8% 指向
 * 空行或纯注释、1 条越界 —— 有字段但零约束比没有字段更误导)。
 * @returns {void}
 */
function assertMatrixShape() {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const row of MATRIX) {
    if (ids.has(row.id)) throw new Error(`[dual-matrix] 行 id 重复:${row.id}`);
    ids.add(row.id);
    if (row.mode !== "mustMatch" && row.mode !== "allowedDiff") {
      throw new Error(`[dual-matrix:${row.id}] mode 非法:${row.mode}`);
    }
    for (const key of ROW_TEXT_FIELDS) {
      if (typeof row[key] !== "string" || row[key].length < 4) {
        throw new Error(`[dual-matrix:${row.id}] 缺少 ${key} 描述`);
      }
    }
    if (!Array.isArray(row.anchors) || row.anchors.length === 0) {
      throw new Error(`[dual-matrix:${row.id}] 缺少来源锚点`);
    }
    for (const anchor of row.anchors) {
      const match = /^src\/([\w./-]+\.ts):(\d+)/.exec(anchor);
      if (!match) {
        throw new Error(`[dual-matrix:${row.id}] 锚点须为 src/<文件>.ts:<行号>,实际:${anchor}`);
      }
      const relPath = `src/${match[1]}`;
      const lineNo = Number(match[2]);
      let lines;
      try {
        lines = sourceLines(relPath);
      } catch {
        throw new Error(`[dual-matrix:${row.id}] 锚点指向的源文件不存在:${relPath}(锚点 ${anchor})`);
      }
      if (lineNo < 1 || lineNo > lines.length) {
        throw new Error(
          `[dual-matrix:${row.id}] 锚点行号越界:${anchor}(该文件共 ${lines.length} 行)`,
        );
      }
      if ((lines[lineNo - 1] ?? "").trim() === "") {
        throw new Error(`[dual-matrix:${row.id}] 锚点指向空行:${anchor}`);
      }
    }
    if (typeof row.verify !== "function") {
      throw new Error(`[dual-matrix:${row.id}] 缺少可执行断言(verify)`);
    }
  }
  // 反向守护:本段的行集合必须与台账登记的 MATRIX_ROW_IDS 逐字相同
  // (6-A 的「让下一次有人加键时有地方登记」机制:加了矩阵行却没在台账归类即判红;
  //  台账那一侧反向断另一方向,单侧失守不会静默)
  const declared = [...MATRIX_ROW_IDS].sort();
  const actualRowIds = [...ids].sort();
  if (declared.join(",") !== actualRowIds.join(",")) {
    const missing = actualRowIds.filter((k) => !declared.includes(k));
    const extra = declared.filter((k) => !actualRowIds.includes(k));
    throw new Error(
      `[dual-matrix] 矩阵行集合与台账 MATRIX_ROW_IDS 不一致`
      + `(未登记:${missing.join(",") || "无"};台账中多余:${extra.join(",") || "无"})`,
    );
  }
}

/* ---------- 6-C2 新增四行的产物装配(见文件头「为何在段内装配」) ---------- */

/** convert() 的类型化包装:注入宿主文件系统能力(与 dual-sandbox 同款,零渲染差异) */
const convertTyped =
  /** @type {(md: string, format: "docx" | "pdf", context: Record<string, unknown>) => Promise<ConvertArtifact>} */ (
    (md, format, context) => convert(md, format, { fs: HOST_FS, ...context })
  );

/**
 * 取 docx 内匹配前缀的部件文本(页眉/页脚/样式表)。
 * docx 的页眉页脚不在 document.xml 里,必须解包 header*.xml / footer*.xml。
 * @param {Buffer} buffer docx 产物字节
 * @param {"header" | "footer" | "styles"} kind 部件族
 * @returns {Promise<string>} 全部匹配部件的文本(按部件名排序,无则空串)
 */
async function docxParts(buffer, kind) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => n.startsWith(`word/${kind}`) && n.endsWith(".xml"))
    .sort();
  /** @type {string[]} */
  const texts = [];
  for (const name of names) {
    const entry = zip.file(name);
    // zip.file 对刚枚举出的名字恒存在;缺失即 zip 结构异常,显式抛错而非静默跳过
    if (!entry) throw new Error(`docx 部件缺失:${name}`);
    texts.push(await entry.async("string"));
  }
  return texts.join("\n");
}

/**
 * 装配 6-C2 新增四行所需的产物(排版 / h1 分页 / 页眉页脚三模式 / 水印)。
 *
 * 与 dual-sandbox 的分工:那 21 行的样例都是「同一份 markdown 跑一次双侧」,
 * 断言落在同一批产物上;新增四行各自需要**专门构造的上下文**(非默认排版取值、
 * 显式开关、三种页眉模式、指定角度与不透明度),塞进通用沙箱只会让它的参数从
 * 21 个维度膨胀成一堆按行命名的可选字段。故就地装配,并在此显式说明边界。
 *
 * @returns {Promise<Record<string, unknown>>} 供新增四行 verify 消费的字段组
 */
async function buildExtendedCtx() {
  const B = FIXTURES_DIR;
  // ---- 正文字体/字号/行距/缩进/对齐:非默认取值,否则「读了设置」与「落回默认」不可区分 ----
  const typoMd = "正文一段。\n\n第二段。\n";
  const typography = {
    ...DEFAULT_TYPOGRAPHY,
    fontAscii: "Consolas",
    fontEastAsia: "宋体",
    bodySizePt: 15,
    lineSpacing: 2.0,
    firstLineIndent: false,
    align: "left",
  };
  const typoDocx = asDocxArtifact(await convertTyped(typoMd, "docx", { baseDir: B, warnings: [], toc: false, typography }));
  const typoPdf = asPdfArtifact(await convertTyped(typoMd, "pdf", { baseDir: B, title: "t", warnings: [], typography }));
  const typoDefaultDocx = asDocxArtifact(await convertTyped(typoMd, "docx", { baseDir: B, warnings: [], toc: false }));
  const typoDefaultPdf = asPdfArtifact(await convertTyped(typoMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  // 对照侧的 styles.xml 也要取:默认字号 12pt 与默认字体同样要从样式表读
  const typoDefaultStyles = await docxParts(typoDefaultDocx.buffer, "styles");

  // ---- 一级标题前分页:开关开/关对照 ----
  const brkMd = "# 第一章\n\n正文。\n\n## 小节\n\n正文。\n";
  const brkOnDocx = asDocxArtifact(await convertTyped(brkMd, "docx", { baseDir: B, warnings: [], breakBeforeH1: true }));
  const brkOnPdf = asPdfArtifact(await convertTyped(brkMd, "pdf", { baseDir: B, title: "t", warnings: [], breakBeforeH1: true }));
  const brkOffDocx = asDocxArtifact(await convertTyped(brkMd, "docx", { baseDir: B, warnings: [] }));
  const brkOffPdf = asPdfArtifact(await convertTyped(brkMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---- 页眉页脚三模式 ----
  const chromeMd = "# 页眉页脚样例\n\n正文一段。\n";
  // 类型来源取 src 契约:DEFAULT_HEADER_FOOTER 来自 dist(无 .d.ts),字面量成员会被
  // 拓宽成 string,故显式标注数组元素类型而非依赖推断
  /** @type {["default" | "custom" | "none", HeaderFooterSettings][]} */
  const chromeModes = [
    ["default", /** @type {HeaderFooterSettings} */ (DEFAULT_HEADER_FOOTER)],
    [
      "custom",
      /** @type {HeaderFooterSettings} */ ({
        ...DEFAULT_HEADER_FOOTER,
        headerMode: "custom",
        headerText: "页眉文字",
      }),
    ],
    ["none", /** @type {HeaderFooterSettings} */ ({ ...DEFAULT_HEADER_FOOTER, headerMode: "none" })],
  ];
  /** @type {{ default: string, custom: string, none: string, defaultFooter: string }} */
  const chromeDocx = { default: "", custom: "", none: "", defaultFooter: "" };
  /** @type {{ default: { header: string, footer: string }, custom: { header: string, footer: string }, none: { header: string, footer: string } }} */
  const chromePdf = {
    default: { header: "", footer: "" },
    custom: { header: "", footer: "" },
    none: { header: "", footer: "" },
  };
  for (const [label, headerFooter] of chromeModes) {
    const art = asDocxArtifact(
      await convertTyped(chromeMd, "docx", { baseDir: B, warnings: [], title: "文档标题", headerFooter }),
    );
    chromeDocx[label] = await docxParts(art.buffer, "header");
    const footer = await docxParts(art.buffer, "footer");
    if (label === "default") chromeDocx.defaultFooter = footer;
    const pdfArt = asPdfArtifact(
      await convertTyped(chromeMd, "pdf", { baseDir: B, title: "文档标题", warnings: [], headerFooter }),
    );
    chromePdf[label] = { header: pdfArt.headerTemplate, footer: pdfArt.footerTemplate };
  }

  // ---- 水印:显式角度/不透明度/配色,以及空 text 的零渲染对照 ----
  const wmMd = "# 水印样例\n\n正文一段。\n";
  const wmSettings = { ...DEFAULT_WATERMARK, text: "机密", angle: 30, opacity: 0.4, gray: true };
  const wmDocx = asDocxArtifact(await convertTyped(wmMd, "docx", { baseDir: B, warnings: [], watermark: wmSettings }));
  const wmPdf = asPdfArtifact(await convertTyped(wmMd, "pdf", { baseDir: B, title: "t", warnings: [], watermark: wmSettings }));
  const wmNoTextDocx = asDocxArtifact(
    await convertTyped(wmMd, "docx", { baseDir: B, warnings: [], watermark: { ...wmSettings, text: "" } }),
  );
  const wmNoTextPdf = asPdfArtifact(
    await convertTyped(wmMd, "pdf", { baseDir: B, title: "t", warnings: [], watermark: { ...wmSettings, text: "" } }),
  );

  return {
    typo: {
      docxXml: await docxXmlOf(typoDocx.buffer),
      stylesXml: await docxParts(typoDocx.buffer, "styles"),
      pdfHtml: typoPdf.html,
    },
    typoDefault: {
      docxXml: await docxXmlOf(typoDefaultDocx.buffer),
      stylesXml: typoDefaultStyles,
      pdfHtml: typoDefaultPdf.html,
    },
    pageBreakH1: {
      on: { docxXml: await docxXmlOf(brkOnDocx.buffer), pdfHtml: brkOnPdf.html },
      off: { docxXml: await docxXmlOf(brkOffDocx.buffer), pdfHtml: brkOffPdf.html },
    },
    chromeDocx,
    chromePdf,
    watermark: {
      settings: wmSettings,
      docxHeaderXml: await docxParts(wmDocx.buffer, "header"),
      pdfHtml: wmPdf.html,
      docxNoText: await docxParts(wmNoTextDocx.buffer, "header"),
      pdfNoText: wmNoTextPdf.html,
    },
  };
}

/**
 * document.xml 文本(局部薄封装:新增四行只用到这一个部件,不必引整包提取器)。
 * @param {Buffer} buffer docx 产物字节
 * @returns {Promise<string>} document.xml 文本
 */
async function docxXmlOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("docx 缺少 word/document.xml");
  return entry.async("string");
}

export async function run() {
  assertMatrixShape();
  // 双侧产物由沙箱装配(见 test/common/dual-sandbox.js):逐维度真跑一次 convert,
  // 解包 / 提取后作为各行 verify 的入参 —— 禁止只列元数据不验证。
  const ctx = await buildMatrixCtx();
  // 6-C2 新增四行的产物(排版 / h1 分页 / 页眉页脚 / 水印)在此并入同一 ctx,
  // 使 25 行走同一条「逐行实跑」通路,不另开一条只跑新行的旁路。
  const full = /** @type {MatrixCtxExtended} */ (Object.assign(ctx, await buildExtendedCtx()));
  for (const row of MATRIX) {
    await row.verify(full);
    console.log(`[ok] dual-matrix:${row.id} (${row.mode}) ${row.dimension}`);
  }
  const mustCount = MATRIX.filter((r) => r.mode === "mustMatch").length;
  const diffCount = MATRIX.length - mustCount;
  console.log(
    `[ok] dual-pipeline-matrix:${MATRIX.length} 行全部实跑通过(必须一致 ${mustCount} / 允许不同 ${diffCount})`,
  );
}
