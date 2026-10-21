/**
 * docx 回读层的**对外稳定契约**:「会保真 / 会丢弃 / 本仓不接管」三类标识清单 + 摘要计数的形状。
 *
 * 为什么三类要分开(与模板导入的「未映射两类」同口径,ADR-086 实施约束四):
 * - **会保真**:本层完整还原的结构(标题层级 / 列表 / 表格 / 图片 / 链接 …)—— 让用户知道
 *   拿回去的东西是完整的,不是「尽力而为的残骸」。
 * - **会丢弃**:**本次文档实际发生**的丢失(有公式 / 有批注 / 有脚注才出现)—— 一次性诊断。
 * - **不接管**:**恒定**的能力边界(段落级排版 / 字符级外观 / 页面设置 …)—— 与本次文档无关,
 *   折叠成一句固定说明;混进「会丢弃」会把一次性诊断读成常驻能力清单,真正可操作的那几条被淹没。
 *
 * 标识是**稳定标识不是文案**(文案在 core/i18n,键末段与标识同名);本文件零依赖,
 * renderer 直接引用它渲染标签(不经回读主模块,免得把解包依赖拖进 renderer 产物)。
 *
 * 互指:本层的实现见同目录 readback.ts / readback-mdast.ts / readback-markdown.ts / readback-math.ts。
 */

/** 会完整还原的结构(恒定清单) */
export const READBACK_PRESERVED_FIELDS = [
  "headings",
  "lists",
  "tables",
  "images",
  "links",
  "paragraphs",
] as const;

/** 会完整还原的结构标识 */
export type ReadbackPreservedField = (typeof READBACK_PRESERVED_FIELDS)[number];

/** 本次文档实际发生的丢失(条件产出:计数为 0 的不出现) */
export const READBACK_DROPPED_FIELDS = ["formula", "comments", "footnotes"] as const;

/** 本次文档实际发生的丢失标识 */
export type ReadbackDroppedField = (typeof READBACK_DROPPED_FIELDS)[number];

/**
 * 本仓恒不还原的类别(能力边界,与本次文档无关)。
 *
 * 逐条写明「不还原什么」而非「本仓不支持什么」:回读的承诺边界只覆盖**自家稿**,
 * 这几类是自家稿里存在但本层不还原的信息。
 */
export const READBACK_NOT_MANAGED_FIELDS = [
  "revisions",
  "headingNumber",
  "paragraphLayout",
  "runAppearance",
  "pageSetup",
  "tableWidth",
  "imageSize",
  "codeHighlight",
] as const;

/** 本仓恒不还原的类别标识 */
export type ReadbackNotManagedField = (typeof READBACK_NOT_MANAGED_FIELDS)[number];

/** 回读结果的计数(各结构的条数;公式/批注/脚注的计数决定「会丢弃」清单出不出) */
export interface ReadbackCounts {
  /** 标题段落数 */
  headings: number;
  /** 段落数(含列表项内段落与单元格内段落) */
  paragraphs: number;
  /** 列表项数 */
  listItems: number;
  /** 表格数 */
  tables: number;
  /** 图片数 */
  images: number;
  /** 链接数(外链 + 内部锚点) */
  links: number;
  /** 脚注引用数(脚注正文不回读) */
  footnotes: number;
  /** 公式数(以纯文本保留) */
  formulas: number;
  /** 批注数(批注正文不回读) */
  comments: number;
}

/** 回读产物里的一张图片(字节 + 落地用的可读名) */
export interface ReadbackImage {
  /** 源 docx 里的媒体部件名(如 word/media/<sha1>.png) */
  partName: string;
  /** 落地用的可读文件名(如 image1.png);md 里按它引用 */
  fileName: string;
  /** 图片字节 */
  data: Uint8Array;
}
