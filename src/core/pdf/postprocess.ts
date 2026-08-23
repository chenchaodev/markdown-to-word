/**
 * PDF 渲染后处理:标题提取(extractHeadings,目录/书签共用)、目录 HTML(buildTocHtml)、
 * 外链图片内嵌(embedExternalImages,并发上限 EXTERNAL_IMAGE_CONCURRENCY)及辅助函数。
 * 自 pdf/render.ts 拆分(R3 行为等价重构,原注释与实现原样保留)。
 */
import { decodeEntities, escapeHtml, escapeRegExp } from "../utils.js";
import { mimeFromBuffer } from "../image-type.js";
import { imageLoadFailedWarning, imageLoadFailureWarning, imageNotFoundWarning, unrecognizedImageWarning } from "../image-warning.js";
import type { ConvertWarning } from "../i18n.js";
import type { PdfHeading } from "./bookmarks.js";
import type { ImageResolver } from "../image-resolver.js";

/**
 * 从渲染后正文提取 h1-h3 标题(id 由 overrideHeadingIdRule 生成,与正文锚点
 * 一一对应)。目录 HTML 与 PDF 书签(批次 4)共用;标题文本剥行内标签 + 实体解码。
 */
export function extractHeadings(bodyHtml: string): PdfHeading[] {
  const headings: PdfHeading[] = [];
  for (const match of bodyHtml.matchAll(/<h([1-3])[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\1>/g)) {
    const [, level, id, raw] = match; // 正则捕获组结构保证各分组存在
    const text = decodeEntities(raw!.replace(/<[^>]+>/g, ""));
    headings.push({ level: Number(level), id: id!, text });
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
 * 经 imageResolver 判定——返回 null 或抛错 = 缺失/不可读,追加警告
 * (B4:抛错按 fs 错误码细分 ENOENT/EACCES|EPERM,其余与 null 走统一兜底文案,
 * 见 core/image-warning.ts imageLoadFailureWarning);成功不改变 HTML
 * (file:// src 由 Chromium 渲染,不做二次 IO)。仅当注入 resolver 时执行。
 * B5:resolver 附带 exists 轻量通道时优先走它(本地路径免整读/下载;
 * false = 不存在 → 「图片文件不存在」文案,非缺失错误由实现抛出保留细分)。
 */
export async function checkLocalImages(
  srcs: readonly string[],
  resolver: ImageResolver | undefined,
  warnings: ConvertWarning[],
): Promise<void> {
  if (!resolver) return;
  await Promise.all(
    [...new Set(srcs)].map(async (src) => {
      let ok = false;
      let lastError: unknown;
      let notFound = false; // B5:exists 通道返回 false → 直接按「文件不存在」文案
      try {
        if (resolver.exists) {
          // B5:轻量存在性通道(本地路径免整读/下载)。契约:false = 不存在;
          // 非缺失类失败(权限等)由实现抛出,走下方 catch 保留 B4 错误码细分。
          // 缺省 exists 时回退完整解析(行为不变)。
          ok = await resolver.exists(src);
          notFound = !ok;
        } else {
          ok = (await resolver(src)) !== null;
        }
      } catch (err) {
        ok = false;
        lastError = err;
      }
      if (!ok) warnings.push(notFound ? imageNotFoundWarning(src) : imageLoadFailureWarning(src, lastError));
    }),
  );
}

/**
 * 渲染后处理:收集 <img src="https?://..."> 的 URL,经 imageResolver 并行下载
 * (并发限制 3),成功内嵌为 data URL(Chromium 加载 data URL 无需网络,file://
 * HTML 下可用);失败保留原 URL 并追加警告(统一文案 imageLoadFailedWarning)。
 * B5:替换改单遍 cursor 分段(仿 replaceMermaidPlaceholders)——一次遍历按出现
 * 顺序处理全部外链 img 标签后拼接,不再逐 URL 全文扫描替换。
 */
export async function embedExternalImages(
  html: string,
  resolver: ImageResolver | undefined,
  warnings: ConvertWarning[],
): Promise<string> {
  if (!resolver) return html;
  // 单遍收集全部外链 img(按出现顺序;同一 URL 多处出现各记一条 match)
  const imgRe = /<img[^>]*\ssrc="(https?:\/\/[^"]+)"/gi;
  const matches: { index: number; full: string; url: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    matches.push({ index: m.index, full: m[0], url: m[1]! }); // 捕获组结构保证
  }
  if (matches.length === 0) return html;

  const urls = Array.from(new Set(matches.map((x) => x.url)));
  const results = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++]!; // while 条件刚检查 next < urls.length
      try {
        const data = await resolver(url);
        if (data && data.length > 0) {
          const mime = mimeFromBuffer(data);
          // B3:未知魔数不再伪装 image/png(Chromium 渲染错误 MIME 行为不可预期),
          // 按失败降级——保留原 URL + 统一警告
          if (!mime) warnings.push(unrecognizedImageWarning(url));
          else results.set(url, `data:${mime};base64,${data.toString("base64")}`);
        } else {
          warnings.push(imageLoadFailedWarning(url));
        }
      } catch {
        warnings.push(imageLoadFailedWarning(url));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTERNAL_IMAGE_CONCURRENCY, urls.length) }, worker));

  // cursor 单遍拼接:命中的 match 精确替换其 src 属性(escapeRegExp 防子串误替换),
  // 失败/未命中原样保留(cursor 不动);末尾补齐剩余原文
  let out = "";
  let cursor = 0;
  for (const mt of matches) {
    const dataUrl = results.get(mt.url);
    if (!dataUrl) continue;
    out += html.slice(cursor, mt.index);
    out += mt.full.replace(new RegExp(`src="${escapeRegExp(mt.url)}"`), `src="${dataUrl}"`);
    cursor = mt.index + mt.full.length;
  }
  out += html.slice(cursor);
  return out;
}
