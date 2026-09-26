/**
 * section 页眉装配:标题头 / 自定义头 / 页眉与水印的合并。
 *
 * 从 render.ts 拆出的原因:页眉分流与合并属「文档 chrome 装配」关注点,与正文块级
 * 分发(renderBlock)和 Document 装配(renderDocx)不同层,此前三者挤在一个文件里,
 * 使 render.ts 的 410 行里混着编排、分发、装配三种职责。
 *
 * 纯函数、零 IO:输入 headerFooter / title / headerLogo / 水印设置与版心宽度,
 * 产出 docx Header 配置;不装配时返回 undefined。组件本身仍由 chrome.ts 提供
 * (renderHeader / renderWatermarkParagraph),本模块只做「装不装、装什么」的决策与合并。
 *
 * 双管线对应:pdf 侧的同类决策在 src/core/pdf/template.ts 的页眉/水印模板,
 * 差异见 src/core/convert.ts 头注「双管线差异」;修改任一侧语义须同步核对。
 */
import { Header, type Paragraph } from "docx";
import { renderHeader, renderWatermarkParagraph, type HeaderLogoData } from "./chrome.js";
import type { HeaderFooterSettings, WatermarkSettings } from "../settings/settings-defaults.js";

/**
 * section 页眉装配分流:按 headerMode 产出 headers 配置或 undefined。
 * - default:现状行为——有标题才装配(标题居中)
 * - custom:文字(trim 后)与 logo 至少一项存在才装配(全空无内容可显示)
 * - none:不装配
 */
function buildHeaderForSection(
  headerFooter: HeaderFooterSettings,
  title: string | undefined,
  headerLogo: HeaderLogoData | undefined,
  contentWidthTwips: number,
): { default: ReturnType<typeof renderHeader> } | undefined {
  if (headerFooter.headerMode === "none") return undefined;
  if (headerFooter.headerMode === "custom") {
    const text = headerFooter.headerText.trim();
    if (!text && !headerLogo) return undefined;
    return {
      default: renderHeader({ kind: "custom", text, logo: headerLogo, layout: headerFooter.headerLayout }, contentWidthTwips),
    };
  }
  return title ? { default: renderHeader({ kind: "title", title }, contentWidthTwips) } : undefined;
}

/**
 * 页眉 + 水印合并装配:headerFooter 经 buildHeaderForSection 产出 title/
 * custom 页眉(可能无);水印(text 非空)作为置底段落并入同一 default 头——
 * docx 头类型仅 default/first/even,标题头与水印须共存于同一 default 头,
 * 故以「标题头段落 + 水印段落」重构一个 Header(标题头段落经其 options.children 取回)。
 * 水印关闭(text 空)或标题头无(default none 且无标题)时,仅水印自成 default 头。
 */
export function buildHeaders(
  headerFooter: HeaderFooterSettings,
  title: string | undefined,
  headerLogo: HeaderLogoData | undefined,
  contentWidthTwips: number,
  watermark: WatermarkSettings,
): { default: Header } | undefined {
  const base = buildHeaderForSection(headerFooter, title, headerLogo, contentWidthTwips);
  if (!watermark.text.trim()) return base;
  const wmPara = renderWatermarkParagraph(watermark);
  if (!base) return { default: new Header({ children: [wmPara] }) };
  return {
    default: new Header({ children: [...(base.default.options.children as readonly Paragraph[]), wmPara] }),
  };
}
