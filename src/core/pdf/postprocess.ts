/**
 * PDF 渲染后处理:标题提取(extractHeadings,目录/书签共用)、目录 HTML(buildTocHtml)、
 * 外链图片内嵌(embedExternalImages,并发上限 EXTERNAL_IMAGE_CONCURRENCY)及辅助函数。
 * 自 pdf/render.ts 拆分(R3 行为等价重构,原注释与实现原样保留)。
 */
import { decodeEntities, escapeHtml } from "./template.js";
import { mimeFromBuffer } from "../image-type.js";
import { imageLoadFailedWarning } from "../image-warning.js";
import type { PdfHeading } from "./bookmarks.js";
import type { ImageResolver } from "./render.js";

/**
 * 从渲染后正文提取 h1-h3 标题(id 由 overrideHeadingIdRule 生成,与正文锚点
 * 一一对应)。目录 HTML 与 PDF 书签(批次 4)共用;标题文本剥行内标签 + 实体解码。
 */
export function extractHeadings(bodyHtml: string): PdfHeading[] {
  const headings: PdfHeading[] = [];
  for (const match of bodyHtml.matchAll(/<h([1-3])[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\1>/g)) {
    const [, level, id, raw] = match;
    const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));
    headings.push({ level: Number(level), id, text });
  }
  return headings;
}

/**
 * 目录 HTML:从渲染后正文提取 h1-h3(id 由 overrideHeadingIdRule 生成,与正文锚点
 * 一一对应),生成无页码锚点链接列表(实测 printToPDF 保留页内锚点为可点击链接,
 * 含跨页)。标题文本剥行内标签 + 实体解码;标题不足 1 个返回空串(不生成目录)。
 * 输出:<div class="toc">…<ul>…</ul></div> + 分页 div。
 */
export function buildTocHtml(bodyHtml: string): string {
  const items = extractHeadings(bodyHtml).map(
    ({ level, id, text }) => `<li class="toc-l${level}"><a href="#${id}">${escapeHtml(text)}</a></li>`,
  );
  if (items.length === 0) return "";
  return (
    '<div class="toc">' +
    '<div class="toc-title">目录</div>' +
    `<ul>${items.join("")}</ul>` +
    "</div>" +
    '<div class="page-break"></div>'
  );
}

/** 外链图片并发下载上限 */
const EXTERNAL_IMAGE_CONCURRENCY = 3;

/**
 * 本地图片存在性检查(M6:并入 imageResolver 失败路径,替代 convert 层 stat 预扫,单次 IO):
 * 对渲染期间收集的本地图片 src(render.ts overrideImageRule 提供,保持 markdown 原文),
 * 经 imageResolver 判定——返回 null 或抛错 = 缺失/不可读,追加统一文案警告
 * (imageLoadFailedWarning);成功不改变 HTML(file:// src 由 Chromium 渲染,不做二次 IO)。
 * 仅当注入 resolver 时执行(pdf 渲染本身不依赖 resolver)。
 */
export async function checkLocalImages(
  srcs: readonly string[],
  resolver: ImageResolver | undefined,
  warnings: string[],
): Promise<void> {
  if (!resolver) return;
  await Promise.all(
    [...new Set(srcs)].map(async (src) => {
      let ok = false;
      try {
        ok = (await resolver(src)) !== null;
      } catch {
        ok = false;
      }
      if (!ok) warnings.push(imageLoadFailedWarning(src));
    }),
  );
}

/**
 * 渲染后处理:收集 <img src="https?://..."> 的 URL,经 imageResolver 并行下载
 * (并发限制 3),成功内嵌为 data URL(Chromium 加载 data URL 无需网络,file://
 * HTML 下可用);失败保留原 URL 并追加警告(统一文案 imageLoadFailedWarning)。
 */
export async function embedExternalImages(
  html: string,
  resolver: ImageResolver | undefined,
  warnings: string[],
): Promise<string> {
  if (!resolver) return html;
  const urls = Array.from(
    new Set([...html.matchAll(/<img[^>]*\ssrc="(https?:\/\/[^"]+)"/gi)].map((m) => m[1])),
  );
  if (urls.length === 0) return html;

  const results = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const data = await resolver(url);
        if (data && data.length > 0) {
          results.set(url, `data:${mimeFromBuffer(data)};base64,${data.toString("base64")}`);
        } else {
          warnings.push(imageLoadFailedWarning(url));
        }
      } catch {
        warnings.push(imageLoadFailedWarning(url));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTERNAL_IMAGE_CONCURRENCY, urls.length) }, worker));

  let out = html;
  for (const [url, dataUrl] of results) {
    // 精确替换 src 属性,避免 URL 互为子串时误替换
    out = out.replace(new RegExp(`src="${escapeRegExp(url)}"`, "g"), `src="${dataUrl}"`);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
