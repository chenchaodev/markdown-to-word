/**
 * 行内图片渲染:resolver 加载、memo 缓存、尺寸缩放与占位降级。
 * scaleToFit 同时供 mermaid PNG(renderCode)复用。
 * 图片控制增强:尾随 {width=…}/{height=…} 属性解析结果经 sizeAttrs 注入,
 * 显式尺寸绕过 scaleToFit 上限(用户意图优先);独立成段图片(figure)由
 * render.ts 判定后走 renderFigureParagraph 居中渲染。
 * 双管线对应:src/core/pdf/rules/image.ts(路径 file:// 改写 / 尺寸属性注入 /
 * figure 识别);尺寸属性解析与 figure 判定单源 core/markdown/image-size.ts
 * (pdf 侧头注指向本侧 isFigureParagraph 契约)。差异:本侧 resolver 加载字节经
 * ImageRun 内嵌、超宽经 scaleToFit 等比缩到上限;pdf 侧本地图保持 file:// 由
 * Chromium 渲染、height 百分比按内容区宽换算为 px。修改尺寸属性/figure 判定
 * 语义须同步核对 src/core/pdf/rules/image.ts。
 */
import { ImageRun, TextRun } from "docx";
import type { Image } from "mdast";
import { SECONDARY_TEXT_GRAY } from "../theme.js";
import { sniffImageType, imageSizeFromBuffer } from "../../image/image-type.js";
// 取消不得被降级通道吞掉:resolver 失败一律转警告,但取消必须上抛,
// 否则转换会带着缺图产物继续跑完并报成功(见 core/cancel.ts 口径)。
import { isConversionCanceled } from "../../cancel.js";
import {
  imageLoadFailureWarning,
  unrecognizedImageWarning,
  webpSkippedWarning,
} from "../../image/image-warning.js";
import type { ImageSizeAttrs } from "../../markdown/image-size.js";
import { resolveImageDisplaySize } from "../../markdown/image-size.js";
import type { Ctx, ImageLoadResult, InlineChild, RunStyle } from "../ctx.js";

/** 图片显示宽度上限(px):宽超过则等比缩到该宽度(不放大),行内图片与 mermaid PNG 共用 */
export const IMAGE_MAX_WIDTH = 400;
/** 图片尺寸不可解析时的兜底尺寸(px) */
const IMAGE_FALLBACK_WIDTH = 400;
const IMAGE_FALLBACK_HEIGHT = 300;

/** 图片尺寸缩放(行内图片与 mermaid PNG 共用):宽 ≤ IMAGE_MAX_WIDTH 原尺寸(不放大),
 *  宽超过则等比缩到上限宽度(高度按同比例取整)。 */
export function scaleToFit(width: number, height: number): { width: number; height: number } {
  if (width > IMAGE_MAX_WIDTH) {
    const scale = IMAGE_MAX_WIDTH / width;
    return { width: IMAGE_MAX_WIDTH, height: Math.round(height * scale) };
  }
  return { width, height };
}

/**
 * 经 ctx.image.memo 缓存的图片解析。同一 URL 在文档多处出现时只走一次
 * resolver(下载/读盘),后续命中复用同一 Promise(并发同 URL 也共享在途请求)。
 * 失败(null/抛错)不缓存:结算后删除条目,该 URL 后续出现重新解析
 * (已持有旧 Promise 的并发等待者仍共享本次结果,不受删除影响)。
 * 取消错误上抛不转警告(降级线只覆盖普通失败)。
 * 前置条件:ctx.image.resolver 已注入(imageToDocx 调用前已判空);
 * 该 resolver 已由 docx/render.ts 包上请求守卫(信号/时限/预算)。
 */
async function resolveImageCached(ctx: Ctx, url: string): Promise<ImageLoadResult> {
  const memo = ctx.image.memo;
  let pending = memo.get(url);
  if (!pending) {
    const resolver = ctx.image.resolver!;
    pending = (async (): Promise<ImageLoadResult> => {
      try {
        return { data: await resolver(url) };
      } catch (err) {
        if (isConversionCanceled(err)) throw err;
        return { data: null, error: err };
      }
    })();
    memo.set(url, pending);
    void pending.then(
      (r) => {
        if (!r.data) memo.delete(url);
      },
      // 取消导致该条目被拒:同步删除,避免取消态 Promise 留在 memo 里
      () => memo.delete(url),
    );
  }
  return pending;
}

/** 行内图片:经 resolver 加载为 ImageRun;失败或 webp 时占位文本。
 *  尺寸规则:能解析出 PNG/JPEG 尺寸时按 scaleToFit(上限 IMAGE_MAX_WIDTH,不放大);
 *  无法解析尺寸(其他格式/畸形数据)→ IMAGE_FALLBACK_WIDTH×IMAGE_FALLBACK_HEIGHT 兜底。
 *  sizeAttrs(尾随 {width=…}/{height=…} 解析结果,见 core/markdown/image-size.ts)
 *  存在且非空时改走 resolveImageDisplaySize——百分比相对 ctx.config.contentWidthPx、
 *  只给一维按原图宽高等比缩放、两维都给按给定值;显式尺寸绕过 scaleToFit 上限
 *  (用户意图优先)。原图尺寸不可解析时以兜底尺寸作为等比基准。
 *  本地缺失与外链下载失败统一经 resolver 失败路径告警(单次 IO);
 *  失败原因按 fs 错误码细分文案(imageLoadFailureWarning,见 core/image-warning.ts)。
 *  解析经 resolveImageCached memo 化——同 URL 多处出现只解析一次。 */
export async function imageToDocx(
  node: Image,
  ctx: Ctx,
  style: RunStyle,
  sizeAttrs?: ImageSizeAttrs,
): Promise<InlineChild> {
  const fallback = () => new TextRun({ text: `[图片: ${node.alt || node.url}]`, color: SECONDARY_TEXT_GRAY, ...style });
    if (!ctx.image.resolver) {
    ctx.warning.list?.push(imageLoadFailureWarning(node.url));
    return fallback();
  }
  const { data, error } = await resolveImageCached(ctx, node.url);
  if (!data) {
    // 此处 resolver 必已注入(上方判空返回),失败一律告警
    ctx.warning.list?.push(imageLoadFailureWarning(node.url, error));
    return fallback();
  }
  const type = sniffImageType(data);
  if (type === "webp") {
    ctx.warning.list?.push(webpSkippedWarning(node.url));
    return fallback();
  }
    // 未知魔数不再伪装 png(错误标签靠 Word 自行嗅探兜底,行为不可预期)→ 跳过+警告
  if (type === null) {
    ctx.warning.list?.push(unrecognizedImageWarning(node.url));
    return fallback();
  }
  const size = imageSizeFromBuffer(data);
    // 显式尺寸属性优先(绕过 scaleToFit 上限);无属性走原 scaleToFit 行为(回归保障)
  const hasExplicitSize =
    sizeAttrs !== undefined && (sizeAttrs.width !== undefined || sizeAttrs.height !== undefined);
  const natural = size ?? { width: IMAGE_FALLBACK_WIDTH, height: IMAGE_FALLBACK_HEIGHT };
  const { width, height } = hasExplicitSize
    ? resolveImageDisplaySize(natural, sizeAttrs, ctx.config.contentWidthPx)
    : scaleToFit(natural.width, natural.height);
  return new ImageRun({ type, data, transformation: { width, height } });
}
