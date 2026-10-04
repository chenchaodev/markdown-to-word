/**
 * PDF 模板集:页眉页脚 chrome 模板、完整 HTML 组装、封面 HTML、样式注入防护。
 * 职责三分:文档模板 CSS 在 template-css.ts、KaTeX CSS 加载在 katex-css.ts,
 * 本文件只管模板结构与安全(TEMPLATE_CSP / sanitizeStyleCss);
 * escapeHtml/decodeEntities 已集中 src/core/text/text-escape.ts,消费者直连该模块。
 * 双管线对应:src/core/docx/chrome.ts 为 docx 侧对应文件(封面/页眉页脚/水印
 * 组件;HeaderLogoData 类型单源于彼导入)。差异:目录页不在本文件——pdf 目录经
 * postprocess.ts buildTocHtml 从渲染后正文提取,docx 侧对应 chrome.ts
 * renderTocPage(条目由 docx/prescan.ts 预扫)。修改封面/页眉页脚/水印的样式
 * 或开关须同步核对 src/core/docx/chrome.ts。
 * 水印与页眉的默认模式两侧已对齐(adr-030 6-B1/6-B2/6-B3):角度口径单源在
 * settings-defaults 的 WATERMARK_ANGLE_SIGN;不透明度两侧均真消费;页眉
 * default 模式两侧同出「文档标题居中」。
 */
import type { DocMetadata } from "../pipeline/frontmatter.js";
import type { HeaderFooterSettings, WatermarkSettings } from "../settings/settings-defaults.js";
import { escapeHtml } from "../text/text-escape.js";
import { WATERMARK_GRAY, WATERMARK_INK } from "../style/colors.js";
import { mimeFromBuffer } from "../image/image-type.js";
import type { HeaderLogoData } from "../docx/chrome.js";

/** 页码页脚模板(printToPDF footerTemplate 用;模板内必须内联样式,字体大小需显式设置)。 */
export const PDF_FOOTER_TEMPLATE =
  '<div style="font-size:9px;color:#888;width:100%;text-align:center;">' +
  '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>';

/**
  * 空 chrome 模板:displayHeaderFooter 常开(页脚机制依赖),无页眉/无页脚时
  * 以空 span 占位——与既有 headerTemplate:"<span></span>" 同构,不破坏现有
  * margins=0 + @page 边距机制(技术事实层实测口径)。
  */
export const PDF_EMPTY_CHROME_TEMPLATE = "<span></span>";

/** 页眉 logo 显示高度(px,与 docx 侧 HEADER_LOGO_MAX_HEIGHT_PX 视觉对齐) */
const PDF_HEADER_LOGO_HEIGHT_PX = 20;

/** 页眉基础样式:7pt / #888888,与 docx 侧 HEADER_FOOTER_SIZE + MUTED_TEXT_GRAY 对齐 */
const PDF_HEADER_BASE_STYLE =
  "font-size:7pt;color:#888888;font-family:sans-serif;width:100%;overflow:hidden;";

/**
  * 页眉模板(printToPDF headerTemplate 用):
  * - custom:自定义文字(+ 可选 logo);default:文档标题居中;none:空模板
  * - Chromium header/footer 模板限制:内联样式 + 显式 font-size,禁止外部资源——
  *   logo 经 base64 data URI 内嵌(mimeFromBuffer 魔数判定,不可识别则省略 logo)
  * - 字号/灰度与 docx 侧对齐(7pt / #888888 = theme.MUTED_TEXT_GRAY)
  * - leftRight 布局用 float(模板渲染上下文对 flex 支持不稳,float 为保守选择):
  *   logo 左 + 文字右;无 logo 时文字靠左
  *
  * default 出「文档标题居中」而非空模板是 adr-030 6-B3 的裁决:此前本函数对
  * default 返回空模板(标题只进页面 title),与 docx 侧的标题页眉不一致 ——
  * 页眉的定位是承载身份信息,在 pdf 侧那样等于整个功能静默失效。取 docx 侧为准。
  *
  * @param headerFooter 页眉页脚设置
  * @param title 文档标题(metadata.title ?? options.title);为空时 default 模式退回
  *   空模板,与 docx 侧「无标题不装配页眉」同口径
  * @param headerLogo 页眉 logo 已读数据
  */
export function buildPdfHeaderTemplate(
  headerFooter: HeaderFooterSettings,
  title: string | undefined,
  headerLogo?: HeaderLogoData,
): string {
  if (headerFooter.headerMode === "none") return PDF_EMPTY_CHROME_TEMPLATE;
  if (headerFooter.headerMode === "default") {
    const text = (title ?? "").trim();
    if (!text) return PDF_EMPTY_CHROME_TEMPLATE;
    return `<div style="${PDF_HEADER_BASE_STYLE}text-align:center;">${escapeHtml(text)}</div>`;
  }
  const text = headerFooter.headerText.trim();
  const mime = headerLogo ? mimeFromBuffer(Buffer.from(headerLogo.data)) : null;
  const logoHtml =
    headerLogo && mime
      ? `<img src="data:${mime};base64,${Buffer.from(headerLogo.data).toString("base64")}" ` +
        `style="height:${PDF_HEADER_LOGO_HEIGHT_PX}px;vertical-align:middle;border:none;" />`
      : "";
  const base = PDF_HEADER_BASE_STYLE;
  if (headerFooter.headerLayout === "leftRight") {
    // 无 logo 时文字靠左(契约);logo 与文字并存才左右分栏
    if (!logoHtml) {
      return `<div style="${base}text-align:left;">${escapeHtml(text)}</div>`;
    }
    return (
      `<div style="${base}">` +
      `<span style="float:left;">${logoHtml}</span>` +
      (text ? `<span style="float:right;">${escapeHtml(text)}</span>` : "") +
      "</div>"
    );
  }
  return (
    `<div style="${base}text-align:center;">` +
    logoHtml +
    (text ? `${logoHtml ? " " : ""}${escapeHtml(text)}` : "") +
    "</div>"
  );
}

/**
  * 预览/打印 HTML 的 CSP(安全审计):该 HTML 由用户 markdown 渲染而来,
  * 经 loadFile(file://) 加载进预览/打印窗口,须收紧资源来源——
  * 样式全部内联(<style>),图片为 file://(本地)与 data:(外链内嵌),
  * KaTeX 字体为 CSS 内 file:// 引用;脚本零需求 → default-src 'none' 兜底拦截。
  */
export const TEMPLATE_CSP =
  "default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src file:";

/**
 * CSS 注入防护:剥离可提前闭合 <style> 元素的序列。用户 pdfCss 与 KaTeX CSS
 * 均内联进 <style>,若内容含 `</style>` 可闭合标签注入任意标记(配合窗口
 * CSP 收紧前是真实注入面);正常 CSS 不含该序列,替换为空不影响合法样式。
 */
export function sanitizeStyleCss(css: string): string {
  return css.replace(/<\/style/gi, "");
}

/**
  * 文字水印 CSS + 覆盖层:固定定位居中、旋转、半透明,置于正文之下
  * (z-index:-1,正文无背景故水印隐于文字之后);printToPDF 下 fixed 元素在每页
  * 重复渲染,实现整本文档水印。text 空串 → 返回空串(零渲染)。
  *
  * 角度与不透明度直接取 settings 值:口径(正 = 顺时针)与 docx 侧同源单点,
  * 见 settings-defaults 的 WATERMARK_ANGLE_SIGN —— 本文件不做任何取负。
  */
function buildWatermarkCss(watermark: WatermarkSettings | undefined): string {
  if (!watermark || !watermark.text.trim()) return "";
  const color = `#${watermark.gray ? WATERMARK_GRAY : WATERMARK_INK}`;
  const angle = watermark.angle;
  const opacity = watermark.opacity;
  return `
  /* 文字水印:固定居中 + 旋转 + 半透明,置于正文之下 */
  .wm {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(${angle}deg);
    font-size: 72pt;
    font-weight: 700;
    color: ${color};
    opacity: ${opacity};
    z-index: -1;
    pointer-events: none;
    white-space: nowrap;
    user-select: none;
  }`;
}

export function buildTemplate(
  bodyHtml: string,
  title: string,
  css: string,
  katexCss: string,
  watermark?: WatermarkSettings,
): string {
  const watermarkCss = buildWatermarkCss(watermark);
  const watermarkEl = watermark && watermark.text.trim()
    ? `<div class="wm" aria-hidden="true">${escapeHtml(watermark.text)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${TEMPLATE_CSP}">
<title>${escapeHtml(title)}</title>
<style>${sanitizeStyleCss(css)}${watermarkCss}</style>
${katexCss ? `<style>${sanitizeStyleCss(katexCss)}</style>` : ""}
</head>
<body>
${watermarkEl}
${bodyHtml}
</body>
</html>`;
}

/**
 * 封面 HTML:metadata.title 存在时生成。居中大标题(28pt)+ 作者/日期灰色小字,
 * 末尾 <div class="page-break"></div> 复用现有分页样式,封面独占一页。
 */
export function buildCoverHtml(metadata: DocMetadata | undefined): string {
  if (!metadata?.title) return "";
  const metaLine = [metadata.author, metadata.date].filter(Boolean).join(" · ");
  return (
    '<div class="cover">' +
    `<div class="cover-title">${escapeHtml(metadata.title)}</div>` +
    (metaLine ? `<div class="cover-meta">${escapeHtml(metaLine)}</div>` : "") +
    "</div>" +
    '<div class="page-break"></div>'
  );
}
