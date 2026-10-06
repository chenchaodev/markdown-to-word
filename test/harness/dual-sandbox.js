// @ts-check
/**
 * 双管线沙箱:把行输入样例跑成 docx / pdf 双侧产物,组装成差异矩阵的断言上下文
 * (buildMatrixCtx)。
 *
 * 为何独立成岛:矩阵 21 行的产物构建是纯「装配」——每次运行都真跑一遍 convert,再解包 /
 * 提取成可断言的事实,不含任何判定;判定全在矩阵段的 MATRIX 行里。两者唯一的耦合点是
 * ctx 形状(MatrixCtx 契约单源在本文件),故装配可独立理解与复用,不必让矩阵段同时
 * 承担「跑双侧产物」与「判定语义维度」两件事。
 *
 * 桩脚手架(计数守卫)也落在本文件:它只服务于「取消检查点密度」这一维度的可执行度量,
 * 与行输入样例同属「造测量条件」,和判定无关。
 *
 * 依赖方向单向:本文件 → dual-samples(输入) + dual-extract(产物 → 事实)+ core dist
 * (真实 convert / render / postprocess);不反向依赖任何段。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n/index.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { renderPdfHtml } from "../../dist/core/pdf/render.js";
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";
import { injectTocPageNumbers } from "../../dist/core/pdf/postprocess.js";
import { unzipPart, zipContains } from "./docx-utils.js";
import { asDocxArtifact, asPdfArtifact, HOST_FS, prepareForConvert } from "./convert-helpers.js";
import { FIXTURES_DIR, KATEX_DIR } from "./paths.js";
import { countOf, docxXml } from "./dual-extract.js";
import {
  captionLabelMd,
  captionMd,
  captionBeforeH1Md,
  deepHeadingsMd,
  dupLabelMd,
  equationMd,
  externalImageMd,
  footnoteMd,
  headingLinkMd,
  hrMd,
  katexBoundaryMd,
  mainMd,
  mermaidMd,
  noH1CaptionMd,
  pageBreakMd,
  sameLabelMd,
  taskListMd,
  tocMd,
  whitelistMd,
} from "./dual-samples.js";

const B = FIXTURES_DIR;

/**
 * 契约类型的只读引用(编译期擦除,不产生运行期依赖——本文件打的是 dist 产物)。
 */
/** @typedef {import("../../dist/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../dist/core/i18n/index.js").ConvertWarning} Warning */

/**
 * 本文件 convertTyped 的上下文入参:core 转换上下文的全部字段,**外加必填的 `baseDir`**。
 *
 * ⚠ 与 convert-helpers 的同名约束同源同理由(单一类型定义在 convert-helpers.js,
 * 此处只转引):此前入参写 `Record<string, unknown>`,把 core 必填的 `baseDir`
 * 一并抹平,编译器便不再检查它。这是**纯类型**约束,运行期不注入任何字段 ——
 * 60+ 调用点无一省略 `baseDir`,凭空补默认值反而是改行为。
 *
 * @typedef {import("./convert-helpers.js").ConvertContextWithBaseDir} ConvertContextWithBaseDir
 */

/**
 * convert() 的类型化别名 + 宿主能力注入点:运行期就是 dist 的 convert 加一次
 * `{ fs: HOST_FS, ...context }` 展开(零渲染行为差异),只把返回类型对齐到 src
 * 契约——dist 是 tsc 产物、无 .d.ts,直接 import 时联合成员的 kind 被拓宽为
 * string,判别式收窄(共享的 asDocxArtifact / asPdfArtifact)因而不可用。
 * 入参保持宽松(本文件按运行时事实传上下文,上下文契约由 core 自身类型守护)。
 *
 * 第 4 参是 core 的 `ConvertTestOverrides`(captionNumbering / imageBudget 这三项
 * 生产零写入者,故不在生产 ConvertContext 里,见 core/convert.ts)。矩阵里对
 * 「显式项压过 typography」与「图片预算」的断言只能从这里注入。
 *
 * 宿主文件系统能力(REF-025 #07)在此统一注入:core 的 pdf 渲染路径不 import
 * node:fs,每次调用都要显式带上。放在包装层而非 30+ 个调用点,是为了让「pdf 渲染
 * 必须注入能力」这条约束只有一个可漏的点,且新增调用点自动继承。展开顺序在后,
 * 故显式传 fs 的调用点仍可覆盖它。
 *
 * 第 1 参仍是裸 markdown 字符串:frontmatter 隔离经 `prepareForConvert` 在包装内做
 * (core 的 convert 第 1 参是 `{ body, metadata }` 阶段产物,不再自己解析 frontmatter),
 * 故下面 60+ 个调用点无一需要知道那个形状。
 */
const convertTyped = /** @type {(md: string, format: "docx" | "pdf", context: ConvertContextWithBaseDir, overrides?: Record<string, unknown>) => Promise<ConvertArtifact>} */ (
  (md, format, context, overrides) => convert(prepareForConvert(md), format, { fs: HOST_FS, ...context }, overrides)
);

/**
 * 计数守卫:统计取消检查点调用次数(密度差异的可执行度量)。
 * guard 只需实现渲染层实际调用的四个成员(race/remainingMs 原样转发即可,
 * 本文件只关心 throwIfCanceled 的调用密度)。
 * @returns {{counter: {checks: number}, guard: {
 *   signal: undefined,
 *   canceled: () => boolean,
 *   throwIfCanceled: () => void,
 *   race: (p: Promise<unknown>) => Promise<unknown>,
 *   remainingMs: (fallback: number) => number,
 *   dispose: () => void,
 * }}} 计数器与注入用 guard
 */
/** @typedef {import("../../dist/core/cancel.js").CancellationGuard} CancellationGuard */

/**
 * 计数守卫:桩在运行期是恒等函数,只把「被检查了几次」记到 counter 上。
 *
 * ⚠ `@returns` 给的 `guard: CancellationGuard` 是**必需**的:没有上下文类型时,对象字面量
 * 按各成员各自推断,`race` 会被推成单态 `(p: Promise<unknown>) => Promise<unknown>`,
 * 而契约里它是**泛型方法** `race<T>(work: Promise<T>): Promise<T>` —— 单态箭头赋不进泛型签名,
 * 4 个调用点全判红(TS2322)。给足上下文类型后 TS 以泛型签名推断本箭头,不必手写第二份签名。
 *
 * @returns {{ counter: { checks: number }, guard: CancellationGuard }}
 */
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
 * 断言上下文:buildMatrixCtx() 组装的双侧产物与辅助提取结果(矩阵各行 verify 的入参)。
 * 字段与本文件内 ctx 对象逐项对应。
 * @typedef {object} MatrixCtx
 * @property {string} docxXmlText 主样例 document.xml 文本
 * @property {string} pdfHtml 主样例 pdf HTML
 * @property {{docxXml: string, pdfHtml: string, paperTwips: [number, number], pgMar: string, pageCss: string}} geometry 页面几何
 * @property {string} whitelistDocxXml 白名单样例 document.xml
 * @property {string} whitelistPdfHtml 白名单样例 HTML
 * @property {{docxCount: number, pdfCount: number, hrDocxHasBreak: boolean, hrPdfHasBreak: boolean, hrPdf: string}} pageBreak 分页符与 hr 对照
 * @property {string} tocDocxXml 深标题 document.xml
 * @property {string} tocPdfHtml 深标题 HTML
 * @property {{docxXml: string, pdfHtml: string}} emptyHeading 空文本标题样例
 * @property {string} capDocxXml 题注样例 document.xml
 * @property {string} capPdfHtml 题注样例 HTML
 * @property {Warning[]} capDocxWarnings 题注样例 docx 警告
 * @property {Warning[]} capPdfWarnings 题注样例 pdf 警告
 * @property {{docxXml: string, pdfHtml: string}} labelOff captionNumbering 关闭对照
 * @property {string} eqDocxXml 公式样例 document.xml
 * @property {string} eqPdfHtml 公式样例 HTML
 * @property {string} eqOffDocxXml equationNumbering 关闭对照 document.xml
 * @property {string} eqOffPdfHtml equationNumbering 关闭对照 HTML
 * @property {{docxBig: string, docxBigWarnings: Warning[], pdfBig: string, pdfSmall: string, docxExpand: string, pdfExpand: string, boundaryPdfNoDir: string, boundaryPdfNoDirWarnings: Warning[], boundaryPdfWithDir: string, boundaryDocxNoDir: string, boundaryDocxWithDir: string}} katex KaTeX 边界
 * @property {{docxKnown: string, pdfKnown: string, docxUnknown: string, pdfUnknown: string, docxBroken: string, pdfBroken: string, docxBrokenWarnings: Warning[], pdfBrokenWarnings: Warning[]}} code 代码高亮
 * @property {string} nsDocxXml 同名 label(kind 分域)document.xml
 * @property {string} nsPdfHtml 同名 label(kind 分域)HTML
 * @property {Warning[]} nsDocxWarnings 同名 label docx 警告
 * @property {Warning[]} nsPdfWarnings 同名 label pdf 警告
 * @property {string} dupDocxXml 同 kind 重名 label document.xml
 * @property {string} dupPdfHtml 同 kind 重名 label HTML
 * @property {Warning[]} dupPdfWarnings 同 kind 重名 label pdf 警告
 * @property {{docxUntrusted: string, pdfUntrusted: string, docxColor: string, pdfColor: string}} degrade 公式降级
 * @property {{docxHasMedia: boolean, docxHasSvg: boolean, pdfHasSvg: boolean, pdfHasBase64: boolean, docxFailed: string, pdfFailed: string, docxFailedWarnings: Warning[], pdfFailedWarnings: Warning[]}} mermaid mermaid 产物
 * @property {{docxHasPart: boolean, docxHasReference: boolean, docxHasText: boolean, pdfHasPart: boolean, pdfHasSection: boolean, pdfHasItem: boolean, pdfHasBackref: boolean, pdfHasText: boolean}} footnote 脚注
 * @property {{docxHasList: boolean, docxHasGlyph: boolean, pdfHasChecked: boolean, pdfHasUnchecked: boolean, pdfHasInput: boolean, pdfHasLabel: boolean}} task 任务列表
 * @property {{docxEmbeds: boolean, pdfEmbeds: boolean, pdfEmbedsWithBase64Budget: boolean, pdfWarned: boolean}} budget 图片预算
 * @property {{docxXml: string, pdfHtml: string}} heading 标题 id 取源
 * @property {{staticDirtyFalse: boolean, staticHasDirtyTrue: boolean, fieldDirtyTrue: boolean, pdfHasPageSpan: boolean, pdfAfterInject: string}} tocPage 目录页码
 * @property {{docxSmall: number, docxLarge: number, pdfSmall: number, pdfLarge: number}} cancel 取消检查点计数
 * @property {{docxXml: string, pdfHtml: string, noH1Docx: string, noH1Pdf: string}} beforeH1 题注先于首个 h1
 */
/**
 * 装配矩阵断言上下文:逐维度真跑 docx / pdf 双侧转换,解包并提取成可断言事实。
 * @returns {Promise<MatrixCtx>} 矩阵各行 verify 的入参(字段与 MatrixCtx 逐项对应)
 */
export async function buildMatrixCtx() {
  const png = await fs.readFile(path.join(B, "input", "g1-tiny.png"));
  const img = { imageResolver: async () => png };
  const nullMermaid = { mermaidResolver: async () => null };

  // ---------- 1. frontmatter 剥离 ----------
  const fmDocx = asDocxArtifact(await convertTyped(mainMd, "docx", { baseDir: B, warnings: [], ...img }));
  const fmPdf = asPdfArtifact(await convertTyped(mainMd, "pdf", { baseDir: B, title: "矩阵", warnings: [], ...img }));

  // ---------- 2. 页面几何(A5 + 四边互异,防属性错位) ----------
  const pageSetup = { paper: "A5", orientation: "portrait", marginTop: 18, marginRight: 12, marginBottom: 22, marginLeft: 16 };
  const geoDocx = asDocxArtifact(await convertTyped("页面几何样本。\n", "docx", { baseDir: B, warnings: [], pageSetup }));
  const geoPdf = asPdfArtifact(await convertTyped("页面几何样本。\n", "pdf", { baseDir: B, title: "t", warnings: [], pageSetup }));

  // ---------- 3. HTML 白名单 ----------
  const wlDocx = asDocxArtifact(await convertTyped(whitelistMd, "docx", { baseDir: B, warnings: [] }));
  const wlPdf = asPdfArtifact(await convertTyped(whitelistMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 4. 显式分页符 / hr 对照 ----------
  const pbDocx = asDocxArtifact(await convertTyped(pageBreakMd, "docx", { baseDir: B, warnings: [], toc: false }));
  const pbPdf = asPdfArtifact(await convertTyped(pageBreakMd, "pdf", { baseDir: B, title: "t", warnings: [], toc: false }));
  const hrDocx = asDocxArtifact(await convertTyped(hrMd, "docx", { baseDir: B, warnings: [], toc: false }));
  const hrPdf = asPdfArtifact(await convertTyped(hrMd, "pdf", { baseDir: B, title: "t", warnings: [], toc: false }));

  // ---------- 5. 目录层级 ----------
  const tocDocx = asDocxArtifact(await convertTyped(deepHeadingsMd, "docx", { baseDir: B, warnings: [] }));
  const tocPdf = asPdfArtifact(await convertTyped(deepHeadingsMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  // 标题文本被 label 剥空 → 两侧都回退为 section 锚点
  const emptyHeadingDocx = asDocxArtifact(await convertTyped("# 一级\n\n## {#sec:only}\n\n正文。\n", "docx", { baseDir: B, warnings: [] }));
  const emptyHeadingPdf = asPdfArtifact(await convertTyped("# 一级\n\n## {#sec:only}\n\n正文。\n", "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 6-8. 题注编号 / label 剥离 / 交叉引用 ----------
  /** @type {Warning[]} */
  const capDocxW = [];
  /** @type {Warning[]} */
  const capPdfW = [];
  const capDocx = asDocxArtifact(await convertTyped(captionMd, "docx", { baseDir: B, warnings: capDocxW, ...img }));
  const capPdf = asPdfArtifact(await convertTyped(captionMd, "pdf", { baseDir: B, title: "t", warnings: capPdfW, ...img }));
  // captionNumbering 显式关闭:label 原样保留的对照(显式项契约见 toc-caption 段;
  // 该项生产零注入,只能经 convert 的第 4 参 ConvertTestOverrides 传入)
  const labelOffDocx = asDocxArtifact(await convertTyped(captionLabelMd, "docx", { baseDir: B, warnings: [], ...img }, { captionNumbering: false }));
  const labelOffPdf = asPdfArtifact(await convertTyped(captionLabelMd, "pdf", { baseDir: B, title: "t", warnings: [], ...img }, { captionNumbering: false }));

  // ---------- 9. 公式 label 与编号开关 ----------
  const eqDocx = asDocxArtifact(await convertTyped(equationMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR }));
  const eqPdf = asPdfArtifact(await convertTyped(equationMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR }));
  const eqOffDocx = asDocxArtifact(await convertTyped(equationMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR, equationNumbering: false }));
  const eqOffPdf = asPdfArtifact(await convertTyped(equationMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR, equationNumbering: false }));

  // ---------- 10. KaTeX 资源边界 ----------
  const bigRuleMd = "$$\\rule{500em}{1em}$$\n";
  const smallRuleMd = "$$\\rule{5em}{1em}$$\n";
  const expandMd = "$$\\def\\a{\\a}\\a$$\n";
  /** @type {Warning[]} */
  const bigRuleW = [];
  const bigRuleDocx = asDocxArtifact(await convertTyped(bigRuleMd, "docx", { baseDir: B, warnings: bigRuleW }));
  const bigRulePdf = asPdfArtifact(await convertTyped(bigRuleMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  const smallRulePdf = asPdfArtifact(await convertTyped(smallRuleMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  const expandDocx = asDocxArtifact(await convertTyped(expandMd, "docx", { baseDir: B, warnings: [] }));
  const expandPdf = asPdfArtifact(await convertTyped(expandMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  // katexDir 边界:同一份含多类公式的样例,加/不加 katexDir 各跑一次
  /** @type {Warning[]} */
  const boundaryPdfNoDirW = [];
  const boundaryPdfNoDir = asPdfArtifact(await convertTyped(katexBoundaryMd, "pdf", { baseDir: B, title: "t", warnings: boundaryPdfNoDirW }));
  const boundaryPdfWithDir = asPdfArtifact(await convertTyped(katexBoundaryMd, "pdf", { baseDir: B, title: "t", warnings: [], katexDir: KATEX_DIR }));
  const boundaryDocxNoDir = await docxXml(asDocxArtifact(await convertTyped(katexBoundaryMd, "docx", { baseDir: B, warnings: [] })).buffer);
  const boundaryDocxWithDir = await docxXml(asDocxArtifact(await convertTyped(katexBoundaryMd, "docx", { baseDir: B, warnings: [], katexDir: KATEX_DIR })).buffer);

  // ---------- 11. 代码高亮与降级警告 ----------
  const knownMd = "```ts\nconst x = 1; // note\n```\n";
  const unknownMd = "```nolangxyz\nconst unknown = 1;\n```\n";
  const knownDocx = asDocxArtifact(await convertTyped(knownMd, "docx", { baseDir: B, warnings: [] }));
  const knownPdf = asPdfArtifact(await convertTyped(knownMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  const unknownDocx = asDocxArtifact(await convertTyped(unknownMd, "docx", { baseDir: B, warnings: [] }));
  const unknownPdf = asPdfArtifact(await convertTyped(unknownMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  // 注册编译期即抛错的坏语言 → 触发「语言已知但高亮失败」降级(两侧同一句警告)
  const hljs = (await import("highlight.js/lib/common")).default;
  const brokenMd = "```broken\nif (a < b) {}\n```\n";
  /** @type {Warning[]} */
  const brokenDocxW = [];
  /** @type {Warning[]} */
  const brokenPdfW = [];
  let brokenDocxXml = "";
  let brokenPdfHtml = "";
  // 放宽理由:故意注册结构不完整的假语言,触发「语言已知但高亮编译抛错」降级路径;
  // hljs 的 LanguageFn 类型要求完整语法定义,而本段要的正是它不合法(经 unknown 中转,
  // 避免误标为类型相容的正常注册)。
  const brokenLanguage = /** @type {ReturnType<Parameters<typeof hljs.registerLanguage>[1]>} */ (
    /** @type {unknown} */ ({ match: "x", begin: /y/ })
  );
  hljs.registerLanguage("broken", () => brokenLanguage);
  try {
    brokenDocxXml = await docxXml(asDocxArtifact(await convertTyped(brokenMd, "docx", { baseDir: B, warnings: brokenDocxW })).buffer);
    brokenPdfHtml = asPdfArtifact(await convertTyped(brokenMd, "pdf", { baseDir: B, title: "t", warnings: brokenPdfW })).html;
  } finally {
    hljs.unregisterLanguage("broken");
  }

  // ---------- 12. fig/tab 同名 label(kind 分命名空间)+ 同 kind 重名 ----------
  /** @type {Warning[]} */
  const nsDocxW = [];
  /** @type {Warning[]} */
  const nsPdfW = [];
  const nsDocx = asDocxArtifact(await convertTyped(sameLabelMd, "docx", { baseDir: B, warnings: nsDocxW, ...img }));
  const nsPdf = asPdfArtifact(await convertTyped(sameLabelMd, "pdf", { baseDir: B, title: "t", warnings: nsPdfW, ...img }));
  /** @type {Warning[]} */
  const dupPdfW = [];
  const dupDocx = asDocxArtifact(await convertTyped(dupLabelMd, "docx", { baseDir: B, warnings: [], ...img }));
  const dupPdf = asPdfArtifact(await convertTyped(dupLabelMd, "pdf", { baseDir: B, title: "t", warnings: dupPdfW, ...img }));

  // ---------- 13. 公式降级触发条件 ----------
  const untrustedMd = "$$\\includegraphics[width=1cm]{a.png}$$\n";
  const colorMd = "$$\\color{red}{x}$$\n";
  const untrustedDocx = asDocxArtifact(await convertTyped(untrustedMd, "docx", { baseDir: B, warnings: [] }));
  const untrustedPdf = asPdfArtifact(await convertTyped(untrustedMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  const colorDocx = asDocxArtifact(await convertTyped(colorMd, "docx", { baseDir: B, warnings: [] }));
  const colorPdf = asPdfArtifact(await convertTyped(colorMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 14. Mermaid ----------
  const mermaidOk = async () => ({ svg: '<svg data-mermaid="1"></svg>', png, width: 120, height: 60 });
  const mermaidDocx = asDocxArtifact(await convertTyped(mermaidMd, "docx", { baseDir: B, warnings: [], mermaidResolver: mermaidOk }));
  const mermaidPdf = asPdfArtifact(await convertTyped(mermaidMd, "pdf", { baseDir: B, title: "t", warnings: [], mermaidResolver: mermaidOk }));
  /** @type {Warning[]} */
  const mermaidFailDocxW = [];
  /** @type {Warning[]} */
  const mermaidFailPdfW = [];
  const mermaidFailDocx = asDocxArtifact(await convertTyped(mermaidMd, "docx", { baseDir: B, warnings: mermaidFailDocxW, ...nullMermaid }));
  const mermaidFailPdf = asPdfArtifact(await convertTyped(mermaidMd, "pdf", { baseDir: B, title: "t", warnings: mermaidFailPdfW, ...nullMermaid }));

  // ---------- 15. 脚注 ----------
  const fnDocx = asDocxArtifact(await convertTyped(footnoteMd, "docx", { baseDir: B, warnings: [] }));
  const fnPdf = asPdfArtifact(await convertTyped(footnoteMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 16. 任务列表 ----------
  const taskDocx = asDocxArtifact(await convertTyped(taskListMd, "docx", { baseDir: B, warnings: [] }));
  const taskPdf = asPdfArtifact(await convertTyped(taskListMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 17. 图片预算记账口径(预算覆盖生产零注入,经第 4 参注入) ----------
  const rawPlusOne = { maxDocumentBytes: png.length + 1 };
  const base64PlusOne = { maxDocumentBytes: Math.ceil(png.length / 3) * 4 + 1 };
  const budgetDocx = asDocxArtifact(await convertTyped(externalImageMd, "docx", { baseDir: B, warnings: [], imageResolver: async () => png }, { imageBudget: rawPlusOne }));
  /** @type {Warning[]} */
  const budgetPdfW = [];
  const budgetPdf = asPdfArtifact(await convertTyped(externalImageMd, "pdf", { baseDir: B, title: "t", warnings: budgetPdfW, imageResolver: async () => png }, { imageBudget: rawPlusOne }));
  const budgetPdfOk = asPdfArtifact(await convertTyped(externalImageMd, "pdf", { baseDir: B, title: "t", warnings: [], imageResolver: async () => png }, { imageBudget: base64PlusOne }));

  // ---------- 18. 标题 id 取源兜底 ----------
  const headingDocx = asDocxArtifact(await convertTyped(headingLinkMd, "docx", { baseDir: B, warnings: [] }));
  const headingPdf = asPdfArtifact(await convertTyped(headingLinkMd, "pdf", { baseDir: B, title: "t", warnings: [] }));

  // ---------- 19. 目录页码 ----------
  const tocStaticDocx = asDocxArtifact(await convertTyped(tocMd, "docx", { baseDir: B, warnings: [] }));
  const tocFieldDocx = asDocxArtifact(await convertTyped(tocMd, "docx", { baseDir: B, warnings: [], tocMode: "field" }));
  const tocPagePdf = asPdfArtifact(await convertTyped(tocMd, "pdf", { baseDir: B, title: "t", warnings: [] }));
  // ---------- 20. 取消检查点密度 ----------
  const smallMd = "# 小文档\n\n一段。\n";
  const largeMd = Array.from({ length: 12 }, (_, i) => `## 标题 ${i + 1}\n\n段落 ${i + 1}。\n`).join("\n");
  const docxSmall = countingGuard();
  const docxLarge = countingGuard();
  const pdfSmall = countingGuard();
  const pdfLarge = countingGuard();
  await renderDocx(parseMarkdown(smallMd), { guard: docxSmall.guard, toc: false });
  await renderDocx(parseMarkdown(largeMd), { guard: docxLarge.guard, toc: false });
  await renderPdfHtml(smallMd, { baseDir: B, guard: pdfSmall.guard, toc: false, fs: HOST_FS });
  await renderPdfHtml(largeMd, { baseDir: B, guard: pdfLarge.guard, toc: false, fs: HOST_FS });

  // ---------- 21. 题注先于首个 h1 ----------
  const beforeH1Docx = asDocxArtifact(await convertTyped(captionBeforeH1Md, "docx", { baseDir: B, warnings: [], ...img }));
  const beforeH1Pdf = asPdfArtifact(await convertTyped(captionBeforeH1Md, "pdf", { baseDir: B, title: "t", warnings: [], ...img }));
  const noH1Docx = asDocxArtifact(await convertTyped(noH1CaptionMd, "docx", { baseDir: B, warnings: [], ...img }));
  const noH1Pdf = asPdfArtifact(await convertTyped(noH1CaptionMd, "pdf", { baseDir: B, title: "t", warnings: [], ...img }));

  // 目录页码:两条 docx 路线需解包 zip + 调用纯函数,先取出再组装 ctx
  const tocStaticXml = await docxXml(tocStaticDocx.buffer);
  const tocFieldXml = await docxXml(tocFieldDocx.buffer);

  // ---------- 组装断言上下文(全部为已渲染好的双侧产物) ----------
  /** @type {MatrixCtx} */
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
    dupDocxXml: await docxXml(dupDocx.buffer),
    dupPdfHtml: dupPdf.html,
    dupPdfWarnings: dupPdfW,
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
    tocPage: {
      staticDirtyFalse: tocStaticXml.includes('w:dirty="false"'),
      staticHasDirtyTrue: tocStaticXml.includes('w:dirty="true"'),
      fieldDirtyTrue: tocFieldXml.includes('w:dirty="true"'),
      pdfHasPageSpan: tocPagePdf.html.includes('<span class="toc-page">'),
      pdfAfterInject: injectTocPageNumbers(tocPagePdf.html, { 一级: 2 }),
    },
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
  return ctx;
}
