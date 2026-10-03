/**
 * 应用设置契约(core 侧单一来源):类型 + 默认值 + 校验范围常量。
 * 原三处平行定义(convert.ts 的 PageSetup / typography.ts 的 TypographySettings /
 * main settings.ts 与 renderer.ts 各一份 AppSettings/DEFAULT_SETTINGS/范围常量副本,
 * 注释互指「任一侧改动必须同步另一侧」)收敛于此,任一侧改动不再需平行同步。
 * 注意:本模块运行时只允许依赖零外部导入的纯模块(typography.js);
 * renderer 浏览器环境经此导入 DEFAULT_SETTINGS,不得经 convert.js 链拉入 node 依赖
 * (convert.ts 仅类型导入,编译期擦除)。
 */
import { DEFAULT_TYPOGRAPHY, type TypographySettings } from "./typography.js";
export { DEFAULT_TYPOGRAPHY, type TypographySettings } from "./typography.js";
// 仅类型导入(编译期擦除,不引入运行时依赖):Language 契约定义于 i18n.ts,
// 消费方从 i18n 导入(原 re-export 无消费者,清理移除)
import type { Language } from "../i18n.js";
// 格式版本参数单源于 settings-schema.ts(不升位,理由见该文件 CURRENT_SETTINGS_VERSION):
// AppSettings.version 与 DEFAULT_SETTINGS.version 都由它派生,值不可能与校验口径漂移。
import { CURRENT_SETTINGS_VERSION, type SettingsVersion } from "./settings-schema.js";
export { CURRENT_SETTINGS_VERSION } from "./settings-schema.js";

/** 转换格式 */
export type ConvertFormat = "docx" | "pdf";

/** 导出后行为 */
export type AfterConvertAction = "none" | "show-in-folder" | "open";

/**
  * 目录模式:docx 目录页生成方式。
 * - static(默认)= 免更新静态目录:打开即见、可点击跳转、无页码、不弹更新域提示(现状行为)
 * - field = Word 域目录:TOC 域 + 打开触发更新、注入真实页码(Word/WPS 打开弹一次更新提示)
 */
export type TocMode = "static" | "field";

/**
  * 外观主题偏好:
 * - system(默认)= 跟随系统:renderer 移除 data-theme 属性,CSS @media
 *   prefers-color-scheme 接管(视觉层契约,勿在 JS 侧解析系统主题)
 * - light / dark = 显式主题:renderer 设 document.documentElement.dataset.theme
 */
export type ThemePreference = "system" | "light" | "dark";

/** 页面设置(docx section / pdf @page 参数化;单位 mm)。 */
export interface PageSetup {
  paper: "A4" | "A3" | "A5" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** 页面设置自动修正原因(稳定结构,供 main 迁移与 renderer 警告共用)。 */
export type PageSetupCorrectionReason =
  | "invalid-page-setup"
  | "invalid-paper"
  | "invalid-orientation"
  | "invalid-margin"
  | "insufficient-content";

/** 页面设置纠正策略结果。message 为稳定的中文用户可见说明,reasons 供诊断。 */
export interface PageSetupCorrectionResult {
  pageSetup: PageSetup;
  corrected: boolean;
  reasons: PageSetupCorrectionReason[];
  message: string | null;
}

/**
 * loadSettings 的瞬时迁移契约:非法旧 pageSetup 纠正后随 settingsGet 返回,
 * 由 renderer 在 scheduled 阶段显示一次 warning。committed/failed 是 main 写入
 * 队列的最终状态;该字段只存在于 IPC 结果/内存,绝不写入 settings.json。
 */
export interface SettingsMigrationNotice {
  kind: "page-setup-correction";
  /** 稳定指纹:renderer 用于同一迁移只显示一次 warning。 */
  id: string;
  original: unknown;
  corrected: PageSetup;
  reasons: PageSetupCorrectionReason[];
  message: string;
  persistence: "scheduled" | "committed" | "failed";
}

/**
  * 页眉页脚设置(文档外壳):
  * 内置 TEMPLATE_PRESETS 现可携带 headerFooter,作为「选预设即完整交付链」的一部分
  * (预设目录与其比较逻辑见同目录 presets.ts,它在 preset 定义时消费本对象);
  * 用户预设(CustomPreset)有意保持仅 typography+pageSetup 不变。
  * - headerMode=default 为现状行为(文档标题居中 + 页码页脚),存量 settings.json
  *   缺本字段时双侧(main sanitize / renderer merge)兜底到默认即行为不变
  * - headerLogoPath 只存路径;文件读取在 main 层(core 零 IO),
  *   core 渲染层收已读好的图片数据(docx/chrome.ts HeaderLogoData)
  */
export interface HeaderFooterSettings {
  /** 页眉模式:default=文档标题居中(现状行为)/custom=自定义文字+logo/none=无页眉 */
  headerMode: "default" | "custom" | "none";
  /** 自定义页眉文字(headerMode=custom 且非空时生效) */
  headerText: string;
  /** 页眉 logo 图片绝对路径(空串=无 logo;仅 headerMode=custom 生效) */
  headerLogoPath: string;
  /** 页眉布局:center=居中 / leftRight=左右分栏(logo 左+文字右;无 logo 时文字靠左) */
  headerLayout: "center" | "leftRight";
  /** 页脚开关(默认 true=第 X/共 X 页;false=无页脚) */
  footerEnabled: boolean;
}

export const DEFAULT_HEADER_FOOTER: HeaderFooterSettings = {
  headerMode: "default",
  headerText: "",
  headerLogoPath: "",
  headerLayout: "center",
  footerEnabled: true,
};

/* ---------- 文字水印 ---------- */
/**
 * 水印旋转角度的符号约定与取值(单源,双管线共用)。
 *
 * ## 约定:settings 里的 angle 一律是 **CSS `rotate()` 语义**(正 = 顺时针)。
 * 这是本项目两侧载体里唯一可判定的那个(Chromium/CSS 规范恒定),故取它为口径;
 * docx 侧的 DML `a:xfrm/@rot` 由 {@link watermarkDmlRotation} 单点换算,
 * **两侧都不得在各自的渲染层再取负** —— 那正是本常量要消灭的形态。
 *
 * ## 取值:315 = 中文出版惯例的「左下 → 右上」(等价于逆时针 45°)。
 * pdf 侧 CSS 正值顺时针,故 315 让文字自左下升向右上;docx 侧同号经
 * {@link watermarkDmlRotation} 落到 `rot`,两侧同向。
 *
 * ## ⚠️ 未决(需人工渲染一次):docx 侧的实际视觉方向。
 * `docx` 库只把 `rotation` 原样写进 `rot`(ST_Angle,60000 度分之一,不取负),
 * 代码里查不到方向;旧注释曾写「正值 = 逆时针」,与代码不符,已删(adr-030 6-B1)。
 * 判据:导出 45° 的 docx,看文字往哪边倾。
 * **若确认 docx 侧方向相反,只改 {@link WATERMARK_DML_ROTATION_SIGN} 一个常量**
 * (两侧同向翻转,pdf 侧不受影响),不要在任一侧渲染层各写一份取负。
 */
export const WATERMARK_ANGLE_SIGN = "css-positive-clockwise" as const;

/** 水印默认角度(度):315 = 逆时针 45° = 左下 → 右上(中文出版惯例) */
export const DEFAULT_WATERMARK_ANGLE = 315;

/**
 * docx 侧 DML `a:xfrm/@rot` 相对 settings angle 的符号系数。
 *
 * 现状取 1(与 settings 同号),依据是**两侧同号**的裁决:docx 侧方向无法从代码
 * 断定,与其猜一个符号,不如让两侧在同一个符号下取同一个角度 —— 此时即便 docx
 * 侧视觉方向与预期相反,缺陷也只表现为「两侧都朝另一侧倾」,而不是「一侧对
 * 一侧错」那种更难察觉的分裂。
 *
 * 人工渲染确认 docx 侧反向时,把这里改成 -1 即完成修正(见
 * {@link WATERMARK_ANGLE_SIGN} 的未决说明);这是全链路唯一的翻转点。
 */
export const WATERMARK_DML_ROTATION_SIGN = 1;

/** DML `ST_Angle` 单位:60000 度分之一 */
const DML_ANGLE_UNITS_PER_DEGREE = 60_000;

/**
 * 水印角度 → docx 侧 DML `a:xfrm/@rot` 原始值(60000 度分之一)。
 *
 * 唯一允许做符号/单位换算的地方(见 {@link WATERMARK_ANGLE_SIGN}):docx 渲染层
 * 直接把返回值交给 docx 库,不再自行换算。
 *
 * @param angle settings 里的角度(度,CSS 语义:正 = 顺时针)
 * @returns DML rot 属性值
 */
export function watermarkDmlRotation(angle: number): number {
  return Math.round(angle * WATERMARK_DML_ROTATION_SIGN * DML_ANGLE_UNITS_PER_DEGREE);
}

/**
 * 文字水印设置:与页眉页脚同组,文档外壳层装饰。
 * 内置 TEMPLATE_PRESETS 现可携带 watermark,作为「选预设即完整交付链」的一部分
 * (预设目录与其比较逻辑见同目录 presets.ts,它在 preset 定义时消费本对象);
 * 用户预设(CustomPreset)有意保持仅 typography+pageSetup 不变。
 * - text 空串 = 不启用(零渲染)
 * - angle 旋转角度(度,0–360),口径与取值见 {@link WATERMARK_ANGLE_SIGN}
 * - opacity 不透明度(0–1),浅色不干扰正文;**双管线两侧均真消费**
 * - gray 浅灰经典观感(否则沿用正文字色)
 */
export interface WatermarkSettings {
  /** 水印文字(空串 = 不启用) */
  text: string;
  /** 旋转角度(度,0–360;正 = 顺时针,见 WATERMARK_ANGLE_SIGN) */
  angle: number;
  /** 不透明度(0–1) */
  opacity: number;
  /** 浅灰经典观感(true)/正文同色(false) */
  gray: boolean;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  text: "",
  angle: DEFAULT_WATERMARK_ANGLE,
  opacity: 0.15,
  gray: true,
};

/* ---------- 渲染前变换(分组,不参与预设) ---------- */
/**
 * AI 清理设置:转换前自动规整 AI 生成的 Markdown。
 * 三层门控各自独立(见 convert/preprocess.ts):enabled 是总开关,
 * tidy / rewrite 是它之下两个档位,档位只是分档不是旁路 —— 总开关关闭时
 * preprocessBody 整段跳过,本对象里的档位值不生效。
 */
export interface AiCleanupSettings {
  /** 总开关(默认关):关闭则 AI 清理整段跳过,产物与该能力引入前一致 */
  enabled: boolean;
  /**
   * 「保守规整」档(默认开,随总开关生效):引号破折号归一 / 列表标记补空格 /
   * 行尾空白与空行折叠——三条规则零语义损失。
   */
  tidy: boolean;
  /**
   * 「结构改写」档(默认开,随总开关生效):清裸数字引用标记 / 去 emoji /
   * 重整标题层级——其中两条删除正文内容、一条改写全文结构,故可单独关闭;
   * 关闭后转换产物与该档引入前一致。
   */
  rewrite: boolean;
}

export const DEFAULT_AI_CLEANUP: AiCleanupSettings = {
  enabled: false,
  tidy: true,
  rewrite: true,
};

/**
 * Obsidian 兼容设置:![[嵌入]] 的附件路径前缀依赖 compat 打开,
 * 分组后「单独设了目录名而兼容关着」这个死值关系由对象形状本身表达。
 */
export interface ObsidianSettings {
  /** 是否启用:将 [[双链]]、![[嵌入]] 转为标准 Markdown 链接 */
  compat: boolean;
  /** 附件子文件夹名(用于解析 ![[图片]] 路径前缀) */
  attachmentFolder: string;
}

export const DEFAULT_OBSIDIAN: ObsidianSettings = {
  compat: false,
  attachmentFolder: "Attachments",
};

/** 默认页面设置:近似 Word 默认(A4 纵向,上下 25mm 左右 32mm)。 */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: "A4",
  orientation: "portrait",
  marginTop: 25,
  marginBottom: 25,
  marginLeft: 32,
  marginRight: 32,
};

/* ---------- 页面几何换算(PageSetup 领域单点化) ---------- */

/** 纸张 mm 尺寸表(宽 × 高,纵向值;landscape 由消费方/docx 库处理交换,勿在此交换) */
export const PAPER_SIZES_MM: Record<PageSetup["paper"], { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** mm → twips(docx 长度单位;1mm = 56.6929 twips,四舍五入) */
export function mmToTwips(mm: number): number {
  return Math.round(mm * 56.6929);
}

/** twips → px(96dpi 基准;1px = 1440/96 = 15 twips)。图片尺寸属性百分比换算用。 */
export function twipsToPx(twips: number): number {
  return twips / 15;
}

/** mm → px(96dpi 基准;1in = 25.4mm = 96px)。pdf 侧图片尺寸属性百分比换算用。 */
export function mmToPx(mm: number): number {
  return (mm / 25.4) * 96;
}

/**
 * 应用设置(AppSettings 全字段契约):
 * - 持久化:main/settings.ts(userData/settings.json,手写校验 + 原子写)
 * - 消费:main converter 读取渲染参数;renderer 表单/回显/预设
 * - typography 字段类型定义于 typography.ts(convert 上下文契约)
 */
export interface AppSettings {
  version: SettingsVersion;
  format: ConvertFormat;
  pageSetup: PageSetup;
  typography: TypographySettings;
  /** main load 迁移瞬时提示;不参与 settings.json 持久化,renderer 消费后丢弃。 */
  migration?: SettingsMigrationNotice;
  /** H1 前分页(默认关) */
  breakBeforeH1: boolean;
  /** 自动生成目录页(默认开;docx 静态目录 / PDF 目录同开关) */
  toc: boolean;
   /** 目录模式(static=免更新静态目录 / field=Word 域目录带真实页码;docx 生效,PDF 见) */
  tocMode: TocMode;
  /** 公式编号开关(默认开;关时公式不编号、label 段原样渲染、引用保持原文本,docx/pdf 一致) */
  equationNumbering: boolean;
  /** 导出后行为(默认不自动执行) */
  afterConvert: AfterConvertAction;
  /** 输出目录:空串 = 输出到源文件同目录(默认);非空 = 固定输出目录(须绝对路径) */
  outputDir: string;
  /** 自定义模板预设(上限 MAX_CUSTOM_PRESETS,名称非空去重) */
  customPresets: CustomPreset[];
  /** PDF 自定义样式 CSS(用户导入,追加到默认样式后覆盖;默认空) */
  pdfCss: string;
  /** 界面语言(默认 zh;renderer 启动与切换时经 i18n.setLanguage 生效) */
  language: Language;
  /** 外观主题(默认 system;renderer 经 data-theme 属性应用,见 ThemePreference) */
  theme: ThemePreference;
  /** 页眉页脚(默认 = 现状行为:标题页眉 + 页码页脚;见 HeaderFooterSettings) */
  headerFooter: HeaderFooterSettings;
   /** 文字水印(与页眉页脚同组「不入预设」;空 text = 不启用) */
  watermark: WatermarkSettings;
   /** AI 清理(不入预设):总开关 + 两个档位,见 AiCleanupSettings */
  aiCleanup: AiCleanupSettings;
  /** Obsidian 兼容(不入预设):双链归一开关 + 附件目录名,见 ObsidianSettings */
  obsidian: ObsidianSettings;
}

/** 自定义模板预设:名称 + 排版/页面设置快照(套用逻辑与硬编码预设一致)。 */
export interface CustomPreset {
  name: string;
  typography: TypographySettings;
  pageSetup: PageSetup;
}

/** 自定义预设数量上限(超出截断,保留先保存的条目)。 */
// 刻意非用户可配:环境/资源类硬边界,进设置面板即成「调坏即出事」的旋钮。
export const MAX_CUSTOM_PRESETS = 10;

export const DEFAULT_SETTINGS: AppSettings = {
  version: CURRENT_SETTINGS_VERSION,
  format: "docx",
  pageSetup: { ...DEFAULT_PAGE_SETUP },
  typography: { ...DEFAULT_TYPOGRAPHY },
  breakBeforeH1: false,
  toc: true,
  tocMode: "static",
  equationNumbering: true,
  afterConvert: "none",
  outputDir: "",
  customPresets: [],
  pdfCss: "",
  language: "zh",
  theme: "system",
  headerFooter: { ...DEFAULT_HEADER_FOOTER },
  watermark: { ...DEFAULT_WATERMARK },
  aiCleanup: { ...DEFAULT_AI_CLEANUP },
  obsidian: { ...DEFAULT_OBSIDIAN },
};

/**
 * 默认设置的深拷贝工厂:6 个分组块全部是新对象,改返回值不动 {@link DEFAULT_SETTINGS}。
 *
 * 为什么需要:`...DEFAULT_SETTINGS` 只换掉顶层键,分组块仍与单例共用引用。
 * renderer 初始 state 复用默认值的那段窗口(settings 首次 load 到达前,
 * 向导预览 / 控件回填会就地改写分组块)里,任何一次就地赋值都会污染全局单例,
 * 之后所有拿 DEFAULT_SETTINGS 兜底的路径都读到脏值。load 之后的
 * mergeSettingsWithDefaults 已逐字段新造对象,不受此影响 —— 这里补的是加载前那一段。
 *
 * customPresets 一并换新数组(默认恒为空数组,但数组引用同属单例面);数组元素是
 * 预设快照,按引用带出即可,深拷元素不在本工厂职责内。
 */
export function cloneDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
    typography: { ...DEFAULT_SETTINGS.typography },
    headerFooter: { ...DEFAULT_SETTINGS.headerFooter },
    watermark: { ...DEFAULT_SETTINGS.watermark },
    aiCleanup: { ...DEFAULT_SETTINGS.aiCleanup },
    obsidian: { ...DEFAULT_SETTINGS.obsidian },
    customPresets: [...DEFAULT_SETTINGS.customPresets],
  };
}

/** 页面边距钳制范围(mm,与主进程 sanitizePageSetup 一致) */
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 1000;

/** 页面内容区宽/高的最小值(mm)；用于阻断零宽、负宽等不可渲染配置。 */
export const MIN_PAGE_CONTENT_MM = 1;

/** validatePageSetup 返回的视觉页面尺寸与内容区尺寸(mm)。 */
export interface PageGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
}

const PAGE_SETUP_MARGINS = ["marginTop", "marginBottom", "marginLeft", "marginRight"] as const;

/**
 * 页面设置唯一核心 validator：校验纸张、方向、四边距及最小内容区，并按视觉
 * 方向返回页面/内容宽高。调用层可据此统一迁移、拒绝或渲染；docx 的纸张尺寸
 * 仍按契约传纵向原值，由 docx 库处理 landscape 交换。
 */
export function validatePageSetup(pageSetup: PageSetup): PageGeometry {
  if (!Object.prototype.hasOwnProperty.call(PAPER_SIZES_MM, pageSetup.paper)) {
    throw new RangeError(`不支持的纸张尺寸:${String(pageSetup.paper)}`);
  }
  if (pageSetup.orientation !== "portrait" && pageSetup.orientation !== "landscape") {
    throw new RangeError(`不支持的页面方向:${String(pageSetup.orientation)}`);
  }
  for (const field of PAGE_SETUP_MARGINS) {
    const value = pageSetup[field];
    if (
      !Number.isFinite(value) ||
      value < MARGIN_MIN_MM ||
      value > MARGIN_MAX_MM
    ) {
      throw new RangeError(`${field} 必须在 ${MARGIN_MIN_MM}-${MARGIN_MAX_MM} mm 之间`);
    }
  }

  const portrait = PAPER_SIZES_MM[pageSetup.paper];
  const pageWidthMm = pageSetup.orientation === "landscape" ? portrait.height : portrait.width;
  const pageHeightMm = pageSetup.orientation === "landscape" ? portrait.width : portrait.height;
  const contentWidthMm = pageWidthMm - pageSetup.marginLeft - pageSetup.marginRight;
  const contentHeightMm = pageHeightMm - pageSetup.marginTop - pageSetup.marginBottom;
  if (contentWidthMm < MIN_PAGE_CONTENT_MM || contentHeightMm < MIN_PAGE_CONTENT_MM) {
    throw new RangeError(
      `页面内容区必须至少为 ${MIN_PAGE_CONTENT_MM}×${MIN_PAGE_CONTENT_MM} mm`,
    );
  }
  return { pageWidthMm, pageHeightMm, contentWidthMm, contentHeightMm };
}

const PAPER_VALUES = Object.keys(PAPER_SIZES_MM) as PageSetup["paper"][];
const ORIENTATION_VALUES: PageSetup["orientation"][] = ["portrait", "landscape"];

function pageSetupCorrectionMessage(reasons: readonly PageSetupCorrectionReason[]): string {
  const details: string[] = [];
  if (reasons.includes("invalid-page-setup")) details.push("页面设置结构");
  if (reasons.includes("invalid-paper")) details.push("纸张");
  if (reasons.includes("invalid-orientation")) details.push("方向");
  if (reasons.includes("invalid-margin")) details.push("边距");
  if (reasons.includes("insufficient-content")) details.push("页面内容区");
  return `检测到不合法的${details.join("、")}设置，已自动修正为可渲染配置。`;
}

/**
 * 双边边距同时超出可用空间时的确定性最小溢出修正:
 * 只削减恰好等于 overflow 的总量，优先从第一边扣除，避免无谓把第二边清零；
 * 第一边不足以吸收 overflow 时才归零第一边并从第二边扣除剩余量。
 * 纵向按 top→bottom、横向按 left→right 执行；该顺序是迁移契约，不得改成比例分摊。
 */
function shrinkMarginsToCapacity(
  first: number,
  second: number,
  capacity: number,
): [number, number] {
  if (first + second <= capacity) return [first, second];
  const overflow = first + second - capacity;
  const fromFirst = Math.min(first, overflow);
  return [first - fromFirst, Math.max(0, second - (overflow - fromFirst))];
}

/**
 * 页面设置唯一纯纠正策略:main load/update 与 renderer normalize/merge 共用。
 * - 显式非法 paper/orientation/margin 回退 fallback 对应字段；缺字段沿用 fallback；
 * - margin 先钳制到单边范围，再按上述双边最小修正规则保证内容区不小于下限；
 * - 返回纠正原因与稳定用户提示，调用层不得另写第二套修正算法。
 */
export function correctPageSetup(
  value: unknown,
  fallback: PageSetup = DEFAULT_PAGE_SETUP,
): PageSetupCorrectionResult {
  const reasons: PageSetupCorrectionReason[] = [];
  const addReason = (reason: PageSetupCorrectionReason): void => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const source =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!source) addReason("invalid-page-setup");

  const src = source ?? {};
  const out: PageSetup = { ...fallback };
  if (Object.prototype.hasOwnProperty.call(src, "paper")) {
    if (PAPER_VALUES.includes(src.paper as PageSetup["paper"])) {
      out.paper = src.paper as PageSetup["paper"];
    } else {
      addReason("invalid-paper");
    }
  }
  if (Object.prototype.hasOwnProperty.call(src, "orientation")) {
    if (ORIENTATION_VALUES.includes(src.orientation as PageSetup["orientation"])) {
      out.orientation = src.orientation as PageSetup["orientation"];
    } else {
      addReason("invalid-orientation");
    }
  }

  for (const field of PAGE_SETUP_MARGINS) {
    if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
    const margin = src[field];
    if (typeof margin !== "number" || !Number.isFinite(margin)) {
      addReason("invalid-margin");
      continue;
    }
    const clamped = Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, margin));
    out[field] = clamped;
    if (clamped !== margin) addReason("invalid-margin");
  }

  try {
    validatePageSetup(out);
  } catch {
    const geometry = validatePageSetup({
      ...out,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    [out.marginTop, out.marginBottom] = shrinkMarginsToCapacity(
      out.marginTop,
      out.marginBottom,
      geometry.pageHeightMm - MIN_PAGE_CONTENT_MM,
    );
    [out.marginLeft, out.marginRight] = shrinkMarginsToCapacity(
      out.marginLeft,
      out.marginRight,
      geometry.pageWidthMm - MIN_PAGE_CONTENT_MM,
    );
    addReason("insufficient-content");
  }

  validatePageSetup(out);
  const corrected = reasons.length > 0;
  return {
    pageSetup: out,
    corrected,
    reasons,
    message: corrected ? pageSetupCorrectionMessage(reasons) : null,
  };
}

/** 字号与行距的合法范围(与控件 min/max 一致,范围外回显当前值) */
export const BODY_SIZE_MIN = 8;
export const BODY_SIZE_MAX = 24;
export const LINE_SPACING_MIN = 1.0;
export const LINE_SPACING_MAX = 2.5;

