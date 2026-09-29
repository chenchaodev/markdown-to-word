/**
 * 排版设置契约(core 侧定义;主进程 settings.ts 持久化,renderer 经
 * core/settings-defaults.ts 消费同一类型——无平行定义,单源即此处)。
 * 应用范围:docx styles.default 与普通正文段落、PDF 模板 CSS(body/正文段落)。
 */

export interface TypographySettings {
  /** 西文字体,默认 "Calibri" */
  fontAscii: string;
  /** 中文字体,默认 "微软雅黑" */
  fontEastAsia: string;
  /** 正文字号 pt,默认 12 */
  bodySizePt: number;
  /** 行距倍数,默认 1.5 */
  lineSpacing: number;
  /** 首行缩进 2 字符,默认 true */
  firstLineIndent: boolean;
  /** 正文对齐,默认 "justify" */
  align: "left" | "justify";
  /** 章节自动编号,默认 true */
  headingNumbering: boolean;
  /** 图/表题注自动编号(前缀行识别 + 静态编号),默认 true */
  captionNumbering: boolean;
  /** 标题字号缩放档位(默认 "standard" = 升级前观感),见 HEADING_SCALE_FACTORS */
  headingScale: HeadingScale;
  /** 标题段前/段后间距档位(默认 "standard"),见 HEADING_SPACING_BASE_PT */
  headingSpacing: HeadingSpacingTier;
}

/**
  * 标题字号缩放档位:不做 h1-h6 逐级独立输入(控件爆炸),以基准档位
 * 映射到各级相对正文字号的缩放系数(见 HEADING_SCALE_FACTORS)。
 */
export type HeadingScale = "compact" | "standard" | "spacious";

/** 标题段前/段后间距档位:对 HEADING_SPACING_BASE_PT 基准表整体乘系数。 */
export type HeadingSpacingTier = "compact" | "standard" | "spacious";

/** 档位枚举表(sanitize 白名单单源;main persist 与 GUI 下拉共用) */
export const HEADING_SCALE_TIERS = ["compact", "standard", "spacious"] as const;
export const HEADING_SPACING_TIERS = ["compact", "standard", "spacious"] as const;

/**
 * 标题字号缩放系数表(档位 → h1-h6 相对正文字号 bodySizePt 的倍数):
 * - standard 按升级前 PDF 模板绝对字号(22/17/14/12/11/11pt)反推(÷12pt 基准),
 *   默认档位观感与升级前一致(回归保障);4 位小数在 8-24pt 正文范围内舍入稳定。
 * - compact/spacious 以 standard 为基准整体收放,保持层级对比度。
 * 字号 pt = Math.round(bodySizePt × 系数)(@12pt:紧凑 18/15/13/12/11/11,
 * 标准 22/17/14/12/11/11,舒展 26/20/16/13/12/12)。
 */
export const HEADING_SCALE_FACTORS: Record<HeadingScale, readonly number[]> = {
  compact: [1.5, 1.25, 1.1, 1.0, 0.95, 0.95],
  standard: [1.8333, 1.4167, 1.1667, 1.0, 0.9167, 0.9167],
  spacious: [2.1667, 1.6667, 1.3333, 1.0833, 1.0, 1.0],
};

/**
 * 标题间距基准表(pt,[段前, 段后],h1-h6):取升级前 PDF 模板 margin(px)按
 * 96dpi 换算(16px=12pt 等),standard 档双格式同源;docx 侧 twips = pt×20。
 */
export const HEADING_SPACING_BASE_PT: readonly (readonly [number, number])[] = [
  [0, 12],
  [18, 9],
  [15, 7.5],
  [12, 6],
  [10.5, 6],
  [10.5, 6],
];

/** 间距档位系数(对 HEADING_SPACING_BASE_PT 整体乘):紧凑 0.6 / 标准 1.0 / 舒展 1.5 */
export const HEADING_SPACING_MULTIPLIERS: Record<HeadingSpacingTier, number> = {
  compact: 0.6,
  standard: 1.0,
  spacious: 1.5,
};

/** 标题段前/段后间距值(单位由消费方定:docx 用 twips,pdf CSS 用 pt) */
export interface HeadingSpacingValues {
  before: number;
  after: number;
}

/**
 * 标题字号(pt):bodySizePt × 档位系数,四舍五入取整。
 * scale 缺省容忍 undefined(旧 settings.json / 直调 convert 的旧调用方缺字段)
 * → 回落 standard(行为与升级前一致,回归保障)。depth 钳制 1-6。
 */
export function headingFontSizePt(
  bodySizePt: number,
  scale: HeadingScale | undefined,
  depth: number,
): number {
  const level = Math.min(6, Math.max(1, Math.round(depth)));
  // level 已钳制 1-6,索引必命中(noUncheckedIndexedAccess 下显式断言)
  const factor = HEADING_SCALE_FACTORS[scale ?? "standard"][level - 1]!;
  return Math.round(bodySizePt * factor);
}

/** 标题间距(pt):基准表 × 档位系数(tier 缺省回落 standard,同上) */
export function headingSpacingPt(
  tier: HeadingSpacingTier | undefined,
  depth: number,
): HeadingSpacingValues {
  const level = Math.min(6, Math.max(1, Math.round(depth)));
  const [before, after] = HEADING_SPACING_BASE_PT[level - 1]!; // 钳制后索引必命中
  const mult = HEADING_SPACING_MULTIPLIERS[tier ?? "standard"];
  return { before: before * mult, after: after * mult };
}

/** 标题间距(twips,docx 用):pt × 20 四舍五入(与 headingSpacingPt 同源换算) */
export function headingSpacingTwips(
  tier: HeadingSpacingTier | undefined,
  depth: number,
): HeadingSpacingValues {
  const pt = headingSpacingPt(tier, depth);
  return { before: Math.round(pt.before * 20), after: Math.round(pt.after * 20) };
}

/** 题注比正文小的级差(pt) */
export const CAPTION_SIZE_OFFSET_PT = 1;

/** 题注字号下限(pt):正文再小也要看得清,不再逐级缩小 */
export const CAPTION_MIN_SIZE_PT = 8;

/**
 * 题注字号(pt):正文小一级、下限 8pt。
 * 推导单源 —— 原先 docx 侧内联 `Math.max(8, bodySizePt-1)` 而 pdf 侧模板固定
 * 10pt(不随正文),同输入不同输出;两侧现同读本函数,比例调整只在此一处。
 */
export function captionFontSizePt(bodySizePt: number): number {
  return Math.max(CAPTION_MIN_SIZE_PT, bodySizePt - CAPTION_SIZE_OFFSET_PT);
}

/**
 * 代码字号相对正文的缩放系数(取自 pdf 模板既有观感的比值,勿就近取整):
 * - 行内代码 0.9 = 原模板 `0.9em` 相对正文的比;
 * - 代码块 0.79 ≈ 原模板固定 9.5pt ÷ 12pt 基准。
 * **两者刻意不同** —— 行内代码嵌在正文行里、代码块整块独立排布,同号会糊成一片;
 * 这是观感裁决,不是待收口的重复,勿并成一个系数。
 */
export const INLINE_CODE_SCALE = 0.9;
export const CODE_BLOCK_SCALE = 0.79;

/**
 * 比例推导结果取 1 位小数:让默认 12pt 档精确复现 pdf 侧既有字面量
 * (0.9×12 = 10.8 → 10.8pt;0.79×12 = 9.48 → 9.5pt),避免「统一推导」本身
 * 制造出两侧各取整的可见差;docx 侧随后经 ptToHalfPoints 取整,该精度下
 * 不引入额外漂移(9.48 与 9.5 同取整到 19 half-points)。
 */
function derivedSizePt(raw: number): number {
  return Math.round(raw * 10) / 10;
}

/**
 * 行内代码字号(pt):正文 × INLINE_CODE_SCALE。
 * 刻意**不随所在标题字号缩放**(取正文而非 em 上下文),与 docx 侧「标题里的行内
 * 代码保持自身小号」旧观感一致;标题内行内代码因此不再被标题字号放大。
 */
export function inlineCodeFontSizePt(bodySizePt: number): number {
  return derivedSizePt(bodySizePt * INLINE_CODE_SCALE);
}

/** 代码块字号(pt):正文 × CODE_BLOCK_SCALE */
export function codeBlockFontSizePt(bodySizePt: number): number {
  return derivedSizePt(bodySizePt * CODE_BLOCK_SCALE);
}

/**
 * pt → docx half-points(OOXML w:sz / w:szCs 的单位)。
 * 单位换算归本模块,与 headingSpacingTwips 同惯例 —— 推导(pt)与载体单位
 * (half-points / twips)分层,渲染层只做取整不做推导。
 */
export function ptToHalfPoints(sizePt: number): number {
  return Math.round(sizePt * 2);
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontAscii: "Calibri",
  fontEastAsia: "微软雅黑",
  bodySizePt: 12,
  lineSpacing: 1.5,
  firstLineIndent: true,
  align: "justify",
  headingNumbering: true,
  captionNumbering: true,
  headingScale: "standard",
  headingSpacing: "standard",
};
