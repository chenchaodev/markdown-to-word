// @ts-check
import { readFileSync, realpathSync } from "node:fs";
import { convert } from "../../dist/core/convert.js";
import { parseFrontmatter } from "../../dist/core/pipeline/frontmatter.js";
/**
 * 产物收窄 helper(测试树共享)。
 *
 * 存在原因:`core/convert.ts` 的 `convert()` 返回判别式联合
 * `ConvertArtifact = DocxArtifact | PdfArtifact`,而测试几乎总是以字面量
 * `"pdf"` / `"docx"` 调用后直接取 `.html` / `.buffer`。在未标注
 * `@ts-check` 的年代这靠运行时事实成立;全量启用类型门禁后会集体报
 * `TS18048: 'x.html' is possibly 'undefined'`(实测占全树错误的大头)。
 *
 * 类型来源是 **dist 契约**(ADR-069):此前这组 typedef 指向 `src/`,理由写的是「dist 是
 * tsc 产物、无 `.d.ts`,指向它会 TS2694」—— 那条前提已随 `declaration` 打开而失效。
 * 指向 src 才是 ADR-069 要拆的那个错配:**跑的是产物、类型却查的是源码**,两者不同一个东西。
 *
 * 入参取 `unknown` 的理由:下面两个收窄函数按判别字段(`kind`)收窄,而 `ConvertArtifact`
 * 的判别联合现在由**产物声明**提供,不必再手写第二份。调用方传什么都先落 `unknown`,
 * 运行期校验判别式,再一次性 cast 回精确类型 —— **只放宽入参、不放宽返回值**。
 *
 * 收窄手法:原生 `if + 判别式检查`,不依赖断言函数 —— 断言函数只收窄「传入的引用」,
 * 对 `artifact.kind === "pdf"` 这种布尔表达式无效。
 *
 * 契约:本文件只做**类型收窄 + 显式失败**,不改任何渲染/转换行为;
 * 失败信息必须指明实际拿到的 kind,便于段内定位。
 */

/** @typedef {import("../../dist/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../dist/core/convert.js").PreprocessedMarkdown} PreprocessedMarkdown */
/** @typedef {import("../../dist/core/convert.js").DocxArtifact} DocxArtifact */
/** @typedef {import("../../dist/core/convert.js").PdfArtifact} PdfArtifact */
/** @typedef {import("../../dist/core/pdf/render.js").PdfFsCapabilities} PdfFsCapabilities */
/** @typedef {import("../../dist/core/convert.js").ConvertContext} ConvertContext */

/**
 * 本包装的上下文入参:core 转换上下文的全部字段,**外加必填的 `baseDir`**。
 *
 * 为什么不直接用 `ConvertContext`:它其余字段都是可选的,而 core 的 `baseDir`
 * 是必填项;用 `Record<string, unknown>` 写则把它一并抹平(此前的写法),编译器
 * 便不再检查这个必填项。交叉 `Pick<ConvertContext, "baseDir">` 让**必填性**留在
 * 类型面上,同时不重复 core 的字段清单(字段增删仍以 core 声明为单一来源)。
 *
 * ⚠ 这是**纯类型**约束,运行期不注入任何字段(理由见 `convertWithFs` 的说明)。
 *
 * @typedef {Record<string, unknown> & Pick<ConvertContext, "baseDir">} ConvertContextWithBaseDir
 */

/**
 * 测试侧的宿主文件系统能力(REF-025 #07 注入点)。
 *
 * core 的 pdf 渲染路径不 import node:fs —— 其两次读(图片路径边界的 realpathSync、
 * KaTeX CSS 读取)必须由调用方注入。生产侧由 convert/context.ts 从 node:fs
 * 构造;测试侧用真磁盘实现,这样夹具里的真实文件与符号链接行为与生产一致
 * (测试夹具本就是磁盘上的真文件,用假的 realpath 反而不测真东西)。
 *
 * 单源放本文件而非各段自建:能力契约与 src 的 PdfFsCapabilities 同源,改一处即全树生效。
 */
export const HOST_FS = /** @type {PdfFsCapabilities} */ ({
  realpathSync: (candidate) => realpathSync(candidate),
  readTextFile: (file) => readFileSync(file, "utf8"),
});

/**
 * 读取判别字段(仅取字符串形态,供错误信息使用)。
 * @param {unknown} value 待读值
 * @returns {string} kind 文本或占位描述
 */
function kindOf(value) {
  if (typeof value !== "object" || value === null) return typeof value;
  const kind = /** @type {{ kind?: unknown }} */ (value).kind;
  return typeof kind === "string" ? kind : "(缺失)";
}

/**
 * 判断产物的判别字段是否为期望值。
 * @param {unknown} value 待判产物
 * @param {string} kind 期望的 kind
 * @returns {boolean} 是否匹配
 */
function hasKind(value, kind) {
  return (
    typeof value === "object" &&
    value !== null &&
    /** @type {{ kind?: unknown }} */ (value).kind === kind
  );
}

/**
 * 收窄为 PDF 产物(判别式收窄)。入参取 `unknown` 的理由见文件头。
 * @param {unknown} artifact convert() 返回值(dist 推断或 src 类型均可)
 * @returns {PdfArtifact} PDF 产物
 */
export function asPdfArtifact(artifact) {
  if (!hasKind(artifact, "pdf")) {
    throw new Error(`convert-helpers:期望 pdf 产物,实际 kind=${kindOf(artifact)}`);
  }
  // 放宽理由:判别式已按运行期值校验,kind 相同即 src 契约保证同一形状
  return /** @type {PdfArtifact} */ (artifact);
}

/**
 * 收窄为 DOCX 产物(判别式收窄)。入参取 `unknown` 的理由见文件头。
 * @param {unknown} artifact convert() 返回值(dist 推断或 src 类型均可)
 * @returns {DocxArtifact} DOCX 产物
 */
export function asDocxArtifact(artifact) {
  if (!hasKind(artifact, "docx")) {
    throw new Error(`convert-helpers:期望 docx 产物,实际 kind=${kindOf(artifact)}`);
  }
  // 放宽理由:同上,判别式已按运行期值校验
  return /** @type {DocxArtifact} */ (artifact);
}

/**
 * 取 PDF 产物的 HTML 字符串(收窄 + 取值的便捷组合)。
 * @param {unknown} artifact convert() 返回值(dist 推断或 src 类型均可)
 * @returns {string} HTML 文本
 */
export function pdfHtmlOf(artifact) {
  return asPdfArtifact(artifact).html;
}

/**
 * 取 DOCX 产物的 buffer(收窄 + 取值的便捷组合)。
 * @param {unknown} artifact convert() 返回值(dist 推断或 src 类型均可)
 * @returns {Buffer} 文件内容
 */
export function docxBufferOf(artifact) {
  return asDocxArtifact(artifact).buffer;
}

/**
 * convert() + 宿主文件系统能力注入(REF-025 #07)。
 *
 * 为什么需要:core 的 pdf 渲染路径不 import node:fs,其两次读(图片路径边界的
 * realpathSync、KaTeX CSS 读取)必须由调用方经 `ConvertContext.fs` 注入,
 * 否则 convert 在 pdf 分支**抛错**(刻意不静默降级 —— 那会让 adr-012 的符号链接
 * 逃逸防线变成可静默关闭的开关)。
 *
 * 为什么是共享包装而不是各段自己传:全树有 20+ 个段直接调 convert 渲染 pdf,
 * 逐个调用点加 `fs:` 字段既重复又易漏。集中在此后,新增调用点只要用了本函数
 * 就自动合规。展开顺序在后,显式传 fs 的调用点仍可覆盖。
 *
 * 第 1 参仍是**裸 markdown 字符串**而非阶段产物:frontmatter 隔离在包装内做
 * (`prepareForConvert`),调用点无一处需要知道 core 的入参形状。
 *
 * ⚠ `context` 的类型**在类型面上要求 `baseDir`**(见 `ConvertContextWithBaseDir`),
 * 运行期一字不改:此前 60+ 调用点只传 `{baseDir, warnings, …}`,其余字段靠
 * 「无声明即 any」才没炸 —— 那是产物无 `.d.ts` 时期的假象(ADR-069)。声明补齐后
 * core 的必填项要显式化,而**不给它兜一个运行期默认值**:core 只在 pdf 分支把
 * `baseDir` 交给图片边界判定(经 `path.resolve`),`undefined` 与 `""` 在那里
 * 行为并不等价,凭空补默认值等于改行为。实测 60+ 调用点**无一省略** `baseDir`
 * (唯一三处「省略」是注释里的散文提及),故此处只需把既有事实写进类型。
 *
 * @param {string} md markdown 源
 * @param {"docx" | "pdf"} format 目标格式
 * @param {ConvertContextWithBaseDir} context 转换上下文(必填 `baseDir`)
 * @returns {Promise<ConvertArtifact>} 产物(判别式收窄请用 asDocxArtifact / asPdfArtifact)
 */
export const convertWithFs =
  /** @type {(md: string, format: "docx" | "pdf", context: ConvertContextWithBaseDir) => Promise<ConvertArtifact>} */ (
    (md, format, context) => convert(prepareForConvert(md), format, { fs: HOST_FS, ...context })
  );

/**
 * 裸 markdown → core `PreprocessedMarkdown` 阶段产物(frontmatter 隔离 + 解析)。
 *
 * 为什么需要:core 的 `convert` 第 1 参不是裸字符串,而是 `{ body, metadata }` ——
 * frontmatter 的隔离与解析在**上游准备阶段**完成一次即交下来,core 不再自己解析
 * (同一次转换只解析一次,判据见 `test/core/frontmatter-once.test.js`)。
 * 测试侧按裸字符串写样例,就得在调用点前补这一步。
 *
 * 用 core 的 `parseFrontmatter`(单源)而非测试自写拆分:与生产
 * `convert/preprocess.ts` 的 `splitFrontmatter` 走同一实现,
 * 「测试断言的 frontmatter 语义」与「生产渲染链的」不会各走一套。
 *
 * @param {string} md 裸 markdown 源(可带 frontmatter)
 * @returns {PreprocessedMarkdown} convert() 第 1 参
 */
export function prepareForConvert(md) {
  const { metadata, body } = parseFrontmatter(md);
  return { body, metadata };
}
