/**
 * PDF 自定义样式 CSS 覆盖测试:
 * 用户导入的 CSS 持久化于 settings.pdfCss,渲染时追加到默认模板 CSS 之后
 * (同一 <style> 内后声明覆盖默认样式);docx 路线不消费 CSS(OOXML 无 CSS 概念)。
 * 断言(经 convert pdf 全链路,含 ConvertContext → renderPdfHtml 透传):
 * - 传 pdfCss → 输出 HTML 含用户 CSS,且位于默认 CSS 之后(后加载覆盖)、
 *   位于默认样式同一 <style> 内(非独立 style 块)
 * - 不传 pdfCss → 输出不含用户 CSS(回归,默认行为不变)
 * - 空串 pdfCss → 等价于不传(不注入)
 * - 恶意 CSS(含 </style> 提前闭合序列)→ 被剥离,不产生第二个 <style> 边界(注入防护)
 * - 输出 HTML 带 CSP meta(预览/打印窗口内容安全基线)
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";

const md = `# 标题

正文段落。
`;

const USER_CSS = "body { color: red; }";

export async function run() {
  // ---- 1. 传 pdfCss → 用户 CSS 注入且位于默认 CSS 之后(后加载覆盖) ----
  const withCss = await convert(md, "pdf", { baseDir: FIXTURES_DIR, pdfCss: USER_CSS });
  const userIdx = withCss.html.indexOf(USER_CSS);
  if (userIdx === -1) {
    throw new Error("pdfCss 断言失败:输出 HTML 应包含用户 CSS");
  }
  // 默认 CSS 的 body 规则(模板 CSS 首条 body 规则)须在用户 CSS 之前
  const defaultBodyIdx = withCss.html.indexOf("body {");
  if (defaultBodyIdx === -1 || userIdx <= defaultBodyIdx) {
    throw new Error("pdfCss 断言失败:用户 CSS 应位于默认 CSS 之后(后加载覆盖)");
  }
  // 用户 CSS 须位于默认样式同一 <style> 内(追加到默认 CSS 末尾,非独立 style 块)
  const styleEndIdx = withCss.html.indexOf("</style>");
  if (styleEndIdx === -1 || userIdx > styleEndIdx) {
    throw new Error("pdfCss 断言失败:用户 CSS 应位于默认样式同一 <style> 内");
  }
  console.log("[ok] pdfCss:用户 CSS 追加到默认 CSS 之后(同一 <style> 内后声明覆盖)");

  // ---- 2. 回归:不传 pdfCss → 输出不含用户 CSS(默认行为不变) ----
  const withoutCss = await convert(md, "pdf", { baseDir: FIXTURES_DIR });
  if (withoutCss.html.includes(USER_CSS)) {
    throw new Error("pdfCss 断言失败:不传 pdfCss 时输出不应包含用户 CSS(回归)");
  }
  console.log("[ok] pdfCss:不传 pdfCss 不注入(回归)");

  // ---- 3. 回归:空串 pdfCss → 等价于不传(不注入) ----
  const emptyCss = await convert(md, "pdf", { baseDir: FIXTURES_DIR, pdfCss: "" });
  if (emptyCss.html.includes(USER_CSS)) {
    throw new Error("pdfCss 断言失败:空串 pdfCss 不应注入用户 CSS(回归)");
  }
  console.log("[ok] pdfCss:空串 pdfCss 不注入(回归)");

  // ---- 4. 注入防护:含 </style> 的用户 CSS 被剥离,不提前闭合 <style> ----
  const malicious = 'body { color: red; } </style><img src=x onerror=alert(1)>';
  const sanitized = await convert(md, "pdf", { baseDir: FIXTURES_DIR, pdfCss: malicious });
  const firstStyleEnd = sanitized.html.indexOf("</style>");
  // 净化成功:注入标记作为文本留在 <style> 内部(位于合法 </style> 之前);
  // 若被提前闭合,注入标记会出现在第一个 </style> 之后成为真实元素
  const injectedImg = sanitized.html.indexOf("<img src=x");
  if (firstStyleEnd === -1 || injectedImg === -1 || injectedImg > firstStyleEnd) {
    throw new Error("pdfCss 断言失败:</style> 序列应被剥离,注入标记不得逃逸出 <style>");
  }
  console.log("[ok] pdfCss:</style> 注入序列被剥离(B1 sanitizeStyleCss)");

  // ---- 5. CSP meta:预览/打印 HTML 基线 ----
  if (!withCss.html.includes('http-equiv="Content-Security-Policy"')) {
    throw new Error("pdfCss 断言失败:输出 HTML 应包含 CSP meta(B1)");
  }
  console.log("[ok] pdfCss:CSP meta 存在(B1 预览/打印窗口安全基线)");
}