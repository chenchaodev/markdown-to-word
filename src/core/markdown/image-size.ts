/**
 * 图片尺寸属性解析(纯模块零运行时导入):
 * Pandoc 风格尾随属性 `![alt](src){width=50%}` / `{width=300}` / `{height=200}` /
 * `{width=50% height=30%}` 的词法解析与校验单源,docx(mdast)/pdf(markdown-it)
 * 两侧共用同一实现,保证双管线语义对齐。
 *
 * 语义(与消费方约定):
 * - 百分比 = 相对正文内容宽度(docx 内容区宽 = 页面宽 − 左右边距;pdf 同理);
 *   height 百分比亦以内容宽度为基准(两侧同口径——打印场景 CSS height 百分比
 *   相对容器高、容器高度不定,pdf 侧注入前已按内容宽换算为 px);
 * - 纯数字 = 像素(96dpi 基准);
 * - 只给一维 → 另一维按原图宽高等比缩放;两维都给 → 按给定值(不保持比例,
 *   与 Pandoc 一致);
 * - 非法值(负数/非数值/超范围)→ 忽略该属性并走 keyed 警告通道
 *   (warn.imageAttrInvalid),图片回退默认尺寸行为(scaleToFit),不中断转换。
 *
 * 识别边界:
 * - 属性块必须是「紧跟图片的 text 节点/文本 token 的全部内容」(trim 后恰为
 *   {…});`{width=50%} 后续文字` 不识别(整段保持字面输出);
 * - 仅当块内出现 width/height 键(合法或非法)才视为尺寸属性块并剥除;
 *   `{}` / `{foo=bar}` 等无尺寸键的花括号文本原样保留(不吞用户字面文本);
 * - 未知键(Pandoc 属性集远大于本工具子集,如 #id /.class)静默忽略不告警;
 * - 独立成段图片(figure)判定 isFigureParagraph:段落唯一内容是图片
 *   (+ 尾随尺寸属性块),docx/pdf 两侧居中渲染共用同一契约。
 */

/** 单个维度:px 或 % */
export interface ImageDim {
  unit: "px" | "%";
  value: number;
}

/** 解析后的尺寸属性(仅含通过校验的维度) */
export interface ImageSizeAttrs {
  width?: ImageDim;
  height?: ImageDim;
}

/** 属性块整体匹配:{ … }(内部不允许嵌套花括号;前后空白容忍) */
const ATTR_BLOCK_RE = /^\{\s*([^{}]*)\s*\}$/;
/** 键值对扫描:key=value(value 非空且不含空白/花括号;= 两侧空白容忍) */
const PAIR_SCAN_RE = /([A-Za-z_][\w-]*)\s*=\s*([^\s{}]+)/g;
/** 数值维度词法:`300` / `12.5` / `50%`(十进制;不带负号——负数直接判非法) */
const DIM_RE = /^(\d+(?:\.\d+)?)(%?)$/;

/** 合法范围上限:像素 ≤ 10000(防手滑撑爆版面);百分比 ≤ 100(超出无意义) */
export const IMAGE_SIZE_PX_MAX = 10000;
export const IMAGE_SIZE_PERCENT_MAX = 100;

/**
 * 单个维度值解析与校验。非法(null):非数值、负数、0、超范围
 * (px > IMAGE_SIZE_PX_MAX / % > IMAGE_SIZE_PERCENT_MAX)。
 */
export function parseImageDim(raw: string): ImageDim | null {
  const m = DIM_RE.exec(raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (m[2]) return value <= IMAGE_SIZE_PERCENT_MAX ? { unit: "%", value } : null;
  return value <= IMAGE_SIZE_PX_MAX ? { unit: "px", value } : null;
}

export interface ParsedImageSizeAttrs {
  /** 通过校验的尺寸维度 */
  attrs: ImageSizeAttrs;
  /** 校验失败的 width/height 原始键值对(如 "width=-3"),供警告上报 */
  invalid: string[];
  /** 是否出现 width/height 键(合法或非法)——区分「尺寸属性块」与普通 {…} 文本 */
  hasSizeKeys: boolean;
}

/**
 * 属性块文本解析入口。text 为紧跟图片的文本内容(trim 后须恰为 {…} 形态)。
 * 非属性块 / 无尺寸键 → hasSizeKeys=false(attrs 与 invalid 均空,调用方原样保留文本)。
 */
export function parseImageSizeAttrs(text: string): ParsedImageSizeAttrs {
  const result: ParsedImageSizeAttrs = { attrs: {}, invalid: [], hasSizeKeys: false };
  const m = ATTR_BLOCK_RE.exec(text.trim());
  if (!m) return result;
  const inner = m[1]!;
  PAIR_SCAN_RE.lastIndex = 0; // 全局正则模块级单例,防 lastIndex 残留(无 /g 状态污染)
  let pm: RegExpExecArray | null;
  while ((pm = PAIR_SCAN_RE.exec(inner)) !== null) {
    const key = pm[1]!.toLowerCase();
    if (key !== "width" && key !== "height") continue; // 未知键静默忽略
    result.hasSizeKeys = true;
    const dim = parseImageDim(pm[2]!);
    // invalid 记录归一化键值对(去空白),供警告定位
    if (dim) result.attrs[key] = dim;
    else result.invalid.push(`${key}=${pm[2]}`);
  }
  return result;
}

/** 维度 → px:百分比相对 contentWidthPx;px 原值。四舍五入且 ≥1px。 */
function dimToPx(d: ImageDim, contentWidthPx: number): number {
  const px = d.unit === "%" ? (d.value / 100) * contentWidthPx : d.value;
  return Math.max(1, Math.round(px));
}

/**
 * 显式尺寸 → 显示尺寸(px,F1;docx/pdf 共用同一换算契约):
 * - 百分比维度相对 contentWidthPx(正文内容区宽);
 * - 只给一维 → 另一维按原图(natural)宽高等比缩放;
 * - 两维都给 → 按给定值(不保持比例,与 Pandoc 一致);
 * - 结果四舍五入且 ≥1px。
 * 边界:原图尺寸不可解析时由调用方以兜底尺寸(400×300)作为 natural
 * (等比缩放基于兜底宽高比,与默认尺寸行为同源)。
 */
export function resolveImageDisplaySize(
  natural: { width: number; height: number },
  attrs: ImageSizeAttrs,
  contentWidthPx: number,
): { width: number; height: number } {
  const w = attrs.width ? dimToPx(attrs.width, contentWidthPx) : undefined;
  const h = attrs.height ? dimToPx(attrs.height, contentWidthPx) : undefined;
  if (w !== undefined && h !== undefined) return { width: w, height: h };
  if (w !== undefined) {
    return { width: w, height: Math.max(1, Math.round((w * natural.height) / natural.width)) };
  }
  if (h !== undefined) {
    return { width: Math.max(1, Math.round((h * natural.width) / natural.height)), height: h };
  }
  return { ...natural };
}

/**
 * 行内节点流中消费图片的尾随尺寸属性(nodes[index] 为 image 时):
 * 紧随的 text 节点恰为尺寸属性块(hasSizeKeys)→ 返回解析结果且 consumed=true
 * (调用方跳过该文本节点,不再作为可见文本渲染);否则原样返回空结果。
 * docx 侧 renderPhrasing 专用(pdf 侧在 renderer 规则里对 sibling token 同构判断)。
 */
export function takeImageSizeAttrs(
  nodes: readonly { type: string; value?: string }[],
  index: number,
): { attrs: ImageSizeAttrs; invalid: string[]; consumed: boolean } {
  const next = nodes[index + 1];
  if (!next || next.type !== "text") return { attrs: {}, invalid: [], consumed: false };
  const parsed = parseImageSizeAttrs(next.value ?? "");
  if (!parsed.hasSizeKeys) return { attrs: {}, invalid: [], consumed: false };
  return { attrs: parsed.attrs, invalid: parsed.invalid, consumed: true };
}

/**
 * 独立成段图片(figure)判定:段落唯一内容是图片(+ 尾随尺寸属性块)。
 * 尾随纯空白 text 叶子不计入内容(remark 对「图片 + 空格」可能产出空白叶子);
 * 图片前有其他行内内容 / 段内多张图 / 尾随普通文本 → 非 figure。
 * docx render.ts 与 pdf figure_recognize 共用同一契约(pdf 侧为同构镜像实现)。
 */
export function isFigureParagraph(
  children: readonly { type: string; value?: string }[],
): boolean {
  const last = children[children.length - 1];
  const end =
    children.length > 1 && last?.type === "text" && (last.value ?? "").trim() === ""
      ? children.length - 1
      : children.length;
  if (end === 0 || end > 2) return false;
  if (children[0]?.type !== "image") return false;
  if (end === 1) return true;
  const tail = children[1]!;
  return tail.type === "text" && parseImageSizeAttrs(tail.value ?? "").hasSizeKeys;
}
