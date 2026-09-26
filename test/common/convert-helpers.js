// @ts-check
/**
 * 产物收窄 helper(测试树共享)。
 *
 * 存在原因:`core/convert.ts` 的 `convert()` 返回判别式联合
 * `ConvertArtifact = DocxArtifact | PdfArtifact`,而测试几乎总是以字面量
 * `"pdf"` / `"docx"` 调用后直接取 `.html` / `.buffer`。在未标注
 * `@ts-check` 的年代这靠运行时事实成立;全量启用类型门禁后会集体报
 * `TS18048: 'x.html' is possibly 'undefined'`(实测占全树错误的大头)。
 *
 * 类型来源必须是 **src 契约单源**而非 dist:dist 是 tsc 产物、无 `.d.ts`,
 * `import("../../dist/core/convert.js").ConvertArtifact` 解析不到导出 → TS2694 →
 * 收窄函数返回类型静默退化为 `any`,整棵测试树的类型门禁随之失效(2026-09-26 实测)。
 *
 * 入参取 `unknown` 的理由:测试运行期消费的是 dist 产物,而 dist 无 `.d.ts`,
 * TS 只能从 .js 推断出 `kind: string`,与 src 契约的 `kind: "pdf" | "docx"` 不兼容
 * → 若把 src 联合写进入参,每个调用点都得先 cast 一次,纯属重复。因此这里:
 * 入参 `unknown` → 运行期校验判别式 → 一次性 cast 回精确类型。
 * 对 dist 推断与 src 类型两种调用方都成立,且**只放宽入参、不放宽返回值**。
 *
 * 收窄手法:原生 `if + 判别式检查`,不依赖断言函数 —— 断言函数只收窄「传入的引用」,
 * 对 `artifact.kind === "pdf"` 这种布尔表达式无效。
 *
 * 契约:本文件只做**类型收窄 + 显式失败**,不改任何渲染/转换行为;
 * 失败信息必须指明实际拿到的 kind,便于段内定位。
 */

/** @typedef {import("../../src/core/convert.js").ConvertArtifact} ConvertArtifact */
/** @typedef {import("../../src/core/convert.js").DocxArtifact} DocxArtifact */
/** @typedef {import("../../src/core/convert.js").PdfArtifact} PdfArtifact */

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
