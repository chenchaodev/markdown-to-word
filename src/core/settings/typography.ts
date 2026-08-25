/**
 * 排版设置契约(core 侧定义;主进程 settings.ts 持久化,renderer 经
 * core/settings-defaults.ts 消费同一类型——B7 起无平行定义,单源即此处)。
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
  /** 图/表题注自动编号(8b:前缀行识别 + 静态编号),默认 true */
  captionNumbering: boolean;
  /** 标题字号缩放档位(F3;默认 "standard" = 升级前观感),见 HEADING_SCALE_FACTORS */
  headingScale: HeadingScale;
  /** 标题段前/段后间距档位(F3;默认 "standard"),见 HEADING_SPACING_BASE_PT */
  headingSpacing: HeadingSpacingTier;
}

/**
 * 标题字号缩放档位(F3):不做 h1-h6 逐级独立输入(控件爆炸),以基准档位
 * 映射到各级相对正文字号的缩放系数(见 HEADING_SCALE_FACTORS)。
 */
export type HeadingScale = "compact" | "standard" | "spacious";

/** 标题段前/段后间距档位(F3):对 HEADING_SPACING_BASE_PT 基准表整体乘系数。 */
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
