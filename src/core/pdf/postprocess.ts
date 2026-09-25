/**
 * PDF 渲染后处理:目录 HTML、目录页码注入、本地图片存在性检查与
 * 外链图片内嵌(有界并发 + 数量/单图/总字节/单请求时限预算,取值单源于
 * core/resource-limits.ts)及辅助函数。
 * 双管线对应:src/core/docx/prescan.ts 为 docx 侧对应阶段,但方向相反——docx
 * 在渲染前从 AST 预扫(上下文写入 ctx),本侧标题在渲染期由 pdf/rules/heading-id.ts
 * 即时产出结构化数据(pdf 无预扫)。重叠口径:目录条目两侧同取 h1-h3
 * (buildTocHtml 取结构化标题 ↔ prescan 第 5 轮 tocEntries,层级上限常量单源
 * rules/heading-id.ts PDF_TOC_MAX_LEVEL);外链图片内嵌在本侧执行,docx 侧为
 * 渲染期经 imageResolver 消费(docx/handlers/image-run.ts)。
 * 修改目录层级/标题提取/图片内嵌口径须同步核对 src/core/docx/prescan.ts。
 * 稳定口径:并发上限内完成全部检查后,警告按文档顺序统一入列(不按异步完成
 * 顺序),取消不降级为图片失败警告(经守卫上抛)。
 */
import { decodeEntities, escapeHtml, escapeRegExp } from "../util/utils.js";
import { PDF_TOC_MAX_LEVEL } from "./rules/heading-id.js";
import { mimeFromBuffer } from "../image/image-type.js";
import { imageLoadFailedWarning, imageLoadFailureWarning, imageNotFoundWarning, unrecognizedImageWarning } from "../image/image-warning.js";
import type { ConvertWarning } from "../i18n.js";
import type { PdfHeading } from "./bookmarks.js";
import type { ImageResolver } from "../image/image-resolver.js";
import { createCancellationGuard, createGuardedImageResolver, isConversionCanceled } from "../cancel.js";
import { ImageBudgetLedger, resolveImageBudget, type ImageResourceBudget } from "../resource-limits.js";

/**
 * 兼容层:从渲染后 HTML 反解析 h1-h3 标题(剥标签 + 实体解码)。
 * 仅供**没有结构化数据**的旧路径使用(产物未透传 headings,见
 * core/pdf/render.ts renderPdfDocument);正常主链路的标题由渲染期结构化产出
 * (rules/heading-id.ts),不经此正则。保留原因:外部/旧产物 HTML 与直测仍按
 * HTML 断言(见 test/segments/headings.test.js)。
 * 与 docx 侧目录层级口径同步:只取 h1-h3(同 PDF_TOC_MAX_LEVEL ↔ prescan 第 5 轮)。
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
 * 目录 HTML:由结构化标题(渲染期同一次管线产出,见 rules/heading-id.ts)生成
 * 无页码锚点链接列表(实测 printToPDF 保留页内锚点为可点击链接,含跨页)。
 * 层级只取 h1-h3(与 docx 侧 prescan 第 5 轮 tocEntries 同步,上限常量单源
 * PDF_TOC_MAX_LEVEL);空数组返回空串(不生成目录)。
 * 输出:<div class="toc">…<ul data-toc>…</ul></div> + 分页 div。
 * `data-toc` 是目录容器的结构标记:页码注入按此定位条目,与 toc-lN/toc 样式类
 * 解耦(样式类改名不破功能,勿删)。
 */
export function buildTocHtml(headings: readonly PdfHeading[]): string {
  const items = headings
    .filter(({ level }) => level <= PDF_TOC_MAX_LEVEL)
    .map(
      ({ level, id, text }) => `<li class="toc-l${level}"><a href="#${id}">${escapeHtml(text)}</a></li>`,
    );
  if (items.length === 0) return "";
  return (
    '<div class="toc">' +
    '<div class="toc-title">目录</div>' +
    `<ul data-toc>${items.join("")}</ul>` +
    "</div>" +
    '<div class="page-break"></div>'
  );
}

/** 目录条目内层形态:单个锚点(可带已注入的页码 span)——保证只动目录项、不碰正文 li */
const TOC_ITEM_RE = /^<a href="#([^"]+)">([\s\S]*?)<\/a>(?:<span class="toc-page">[^<]*<\/span>)?$/;

/**
 * 目录页码注入:将 slug→页码(1-based)映射注入已渲染 HTML 的目录条目,追加
 * `<span class="toc-page">页码</span>`(重复注入时替换旧页码,不叠加)。
 * 定位依据是**已知标题 id 集合**(headingIds,缺省取 pageNumbers 的键),不再解析
 * `<li class="toc-lN">` 的形态:目录项样式类改名不影响功能。
 * 作用域优先取 `<ul data-toc>` 容器;文档无该标记(外部/旧产物)时退化为全文按
 * id 集合定位。
 * 两遍法第二遍调用:第一遍打印后经 /Dests 解析出页码(pageNumbersForNames),
 * 再注入 HTML 并重印,正文分页因 TOC 后硬分页符不变、页码一致。
 */
export function injectTocPageNumbers(
  html: string,
  pageNumbers: Record<string, number>,
  headingIds?: readonly string[],
): string {
  const ids = new Set(headingIds ?? Object.keys(pageNumbers));
  if (ids.size === 0) return html;
  const injectItems = (region: string): string =>
    region.replace(/<li\b([^>]*)>([\s\S]*?)<\/li>/g, (item, attrs: string, inner: string) => {
      const entry = TOC_ITEM_RE.exec(inner.trim());
      const id = entry?.[1];
      if (!id || !ids.has(id)) return item;
      const page = pageNumbers[id];
      const pageSpan = page != null ? `<span class="toc-page">${page}</span>` : "";
      return `<li${attrs}><a href="#${id}">${entry[2]}</a>${pageSpan}</li>`;
    });
  const marked = /(<ul\b[^>]*\bdata-toc\b[^>]*>)([\s\S]*?)(<\/ul>)/.exec(html);
  if (!marked) return injectItems(html); // 兼容:无结构标记的旧/外部产物
  const full = marked[0]!; // 整段(含标记与 </ul>)
  const open = marked[1]!; // <ul … data-toc …>
  const inner = marked[2]!; // 目录条目区
  const close = marked[3]!; // </ul>
  const start = marked.index;
  return html.slice(0, start) + open + injectItems(inner) + close + html.slice(start + full.length);
}

/** 图片处理可选参数:取消信号 + 预算覆盖(缺省字段取 core/resource-limits.ts 默认值) */
export type ImageStageOptions = Partial<ImageResourceBudget> & {
  /** 外部取消信号(render 层传入守卫信号;取消上抛,不降级为图片失败) */
  signal?: AbortSignal;
};

/** 预算覆盖合并:逐键取正值,未覆盖项走单源默认值 */
function stageBudget(options: ImageStageOptions): ImageResourceBudget {
  return resolveImageBudget({
    requestTimeoutMs: options.requestTimeoutMs,
    maxImageBytes: options.maxImageBytes,
    maxDocumentBytes: options.maxDocumentBytes,
    maxImages: options.maxImages,
    concurrency: options.concurrency,
  });
}

/**
 * 有界并发执行(worker 池):按索引取任务,返回与入参等长的结果数组(保序)。
 * 用于图片检查/下载——文档内图片数量无界,Promise.all 全开会同时打满磁盘/网络。
 * 单个任务抛错立即上抛(取消等),已在途任务继续跑完但其结果被忽略。
 */
async function mapWithConcurrency<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      results[index] = await task(index);
    }
  };
  const width = Math.max(1, Math.min(Math.floor(concurrency), count));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** 单张图片的检查/加载结果(ok=false 时 warning 由调用方按文档顺序入列) */
interface ImageCheckResult {
  ok: boolean;
  /** exists 通道返回 false → 「图片文件不存在」文案(与抛错细分区分) */
  notFound: boolean;
  error?: unknown;
}

/**
 * 本地图片存在性检查(并入 imageResolver 失败路径,替代 convert 层 stat 预扫,单次 IO):
 * 对渲染期间收集的本地图片 src(render.ts overrideImageRule 提供,保持 markdown 原文),
 * 经 imageResolver 判定——返回 null 或抛错 = 缺失/不可读,追加警告
 * (抛错按 fs 错误码细分 ENOENT/EACCES|EPERM,其余与 null 走统一兜底文案,
 * 见 core/image-warning.ts imageLoadFailureWarning);成功不改变 HTML
 * (file:// src 由 Chromium 渲染,不做二次 IO)。仅当注入 resolver 时执行。
 * resolver 附带 exists 轻量通道时优先走它(本地路径免整读/下载;
 * false = 不存在 → 「图片文件不存在」文案,非缺失错误由实现抛出保留细分)。
 * 资源口径:有界并发(预算 concurrency)+ 单请求时限与字节上限(经守卫注入 request),
 * 不计入文档图片数量/字节预算(存在性检查不产出嵌入字节);警告按文档顺序入列。
 */
export async function checkLocalImages(
  srcs: readonly string[],
  resolver: ImageResolver | undefined,
  warnings: ConvertWarning[],
  options: ImageStageOptions = {},
): Promise<void> {
  if (!resolver) return;
  const budget = stageBudget(options);
  const guard = createCancellationGuard({ signal: options.signal });
  // 存在性检查不记账:不传 ledger(记账口径面向「嵌入文档的字节」)
  const guarded = createGuardedImageResolver({ resolver, guard, budget });
  if (!guarded) return;
  const unique = [...new Set(srcs)];
  const checks = await mapWithConcurrency(unique.length, budget.concurrency, async (index): Promise<ImageCheckResult> => {
    const src = unique[index]!; // index < unique.length 已守卫
    let notFound = false;
    try {
      if (guarded.exists) {
        // 轻量存在性通道(本地路径免整读/下载)。契约:false = 不存在;
        // 非缺失类失败(权限等)由实现抛出,走下方 catch 保留错误码细分。
        // 缺省 exists 时回退完整解析(行为不变)。
        const ok = await guarded.exists(src);
        notFound = !ok;
        return { ok, notFound };
      }
      return { ok: (await guarded(src)) !== null, notFound };
    } catch (err) {
      // 取消不降级(守卫抛出的取消错误直接上抛);普通失败按错误码细分文案
      if (isConversionCanceled(err)) throw err;
      return { ok: false, notFound, error: err };
    }
  });
  // 全部检查完成后按文档顺序入列警告(并发完成顺序不参与,保证稳定可测)
  for (const [index, src] of unique.entries()) {
    const check = checks[index]!; // mapWithConcurrency 保序返回等长数组
    if (check.ok) continue;
    warnings.push(check.notFound ? imageNotFoundWarning(src) : imageLoadFailureWarning(src, check.error));
  }
}

/** 单个外链 URL 的内嵌结果(成功为 data URL,失败保留原 URL + 按文档顺序入列警告) */
interface ExternalImageResult {
  dataUrl?: string;
  warning?: ConvertWarning;
}

/**
 * 渲染后处理:收集 <img src="https?://..."> 的 URL,经 imageResolver 有界并发下载,
 * 成功内嵌为 data URL(Chromium 加载 data URL 无需网络,file:// HTML 下可用);
 * 失败保留原 URL 并追加警告(统一文案 imageLoadFailedWarning)。
 * 预算(取值单源 core/resource-limits.ts,可按 options 覆盖):
 * 数量(超限不起请求)、单图字节、单文档总字节(记账口径 = 内联 data URL 长度,
 * 即真正进入 HTML 文档的字节数,含 base64 膨胀)、单请求时限、并发。
 * 替换改单遍 cursor 分段(仿 replaceMermaidPlaceholders)——一次遍历按出现
 * 顺序处理全部外链 img 标签后拼接,不再逐 URL 全文扫描替换;
 * 警告在替换遍历中按文档顺序入列(同 URL 多处出现只入列一次)。
 */
export async function embedExternalImages(
  html: string,
  resolver: ImageResolver | undefined,
  warnings: ConvertWarning[],
  options: ImageStageOptions = {},
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

  const budget = stageBudget(options);
  const guard = createCancellationGuard({ signal: options.signal });
  const ledger = new ImageBudgetLedger(budget);
  // 记账口径:内联后真正进入文档的字节数(base64 长度,含 4/3 膨胀)
  const guarded = createGuardedImageResolver({
    resolver,
    guard,
    budget,
    ledger,
    costOf: (data) => Math.ceil(data.length / 3) * 4,
  });
  if (!guarded) return html;

  const urls = [...new Set(matches.map((x) => x.url))];
  const results = await mapWithConcurrency(urls.length, budget.concurrency, async (index): Promise<ExternalImageResult> => {
    const url = urls[index]!; // index < urls.length 已守卫
    try {
      const data = await guarded(url);
      if (!data || data.length === 0) return { warning: imageLoadFailedWarning(url) };
      const mime = mimeFromBuffer(data);
      // 未知魔数不再伪装 image/png(Chromium 渲染错误 MIME 行为不可预期),
      // 按失败降级——保留原 URL + 统一警告
      if (!mime) return { warning: unrecognizedImageWarning(url) };
      return { dataUrl: `data:${mime};base64,${data.toString("base64")}` };
    } catch (err) {
      // 取消与单请求超时的上抛口径:取消上抛;超时已由守卫归为 null 走失败降级
      if (isConversionCanceled(err)) throw err;
      return { warning: imageLoadFailedWarning(url) };
    }
  });
  const byUrl = new Map<string, ExternalImageResult>();
  urls.forEach((url, index) => byUrl.set(url, results[index]!)); // mapWithConcurrency 保序

  // cursor 单遍拼接:命中的 match 精确替换其 src 属性(escapeRegExp 防子串误替换),
  // 失败/未命中原样保留(cursor 不动);末尾补齐剩余原文;
  // 警告同步按文档顺序入列(同 URL 只在首次出现处入列一次)
  let out = "";
  let cursor = 0;
  const warned = new Set<string>();
  for (const mt of matches) {
    const result = byUrl.get(mt.url);
    if (!result) continue;
    if (result.warning) {
      if (!warned.has(mt.url)) {
        warned.add(mt.url);
        warnings.push(result.warning);
      }
      continue;
    }
    out += html.slice(cursor, mt.index);
    out += mt.full.replace(new RegExp(`src="${escapeRegExp(mt.url)}"`), `src="${result.dataUrl}"`);
    cursor = mt.index + mt.full.length;
  }
  out += html.slice(cursor);
  return out;
}
