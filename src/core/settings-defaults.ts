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

/** 转换格式 */
export type ConvertFormat = "docx" | "pdf";

/** 导出后行为 */
export type AfterConvertAction = "none" | "show-in-folder" | "open";

/** 页面设置(批次 1:docx section / pdf @page 参数化;单位 mm)。 */
export interface PageSetup {
  paper: "A4" | "A3" | "A5" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** 默认页面设置:近似 Word 默认(A4 纵向,上下 25mm 左右 32mm)。 */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: "A4",
  orientation: "portrait",
  marginTop: 25,
  marginBottom: 25,
  marginLeft: 32,
  marginRight: 32,
};

/**
 * 应用设置(AppSettings 全字段契约):
 * - 持久化:main/settings.ts(userData/settings.json,手写校验 + 原子写)
 * - 消费:main converter 读取渲染参数;renderer 表单/回显/预设
 * - typography 字段类型定义于 typography.ts(convert 上下文契约)
 */
export interface AppSettings {
  version: 1;
  format: ConvertFormat;
  pageSetup: PageSetup;
  typography: TypographySettings;
  /** H1 前分页(默认关) */
  breakBeforeH1: boolean;
  /** 自动生成目录页(默认开;docx 静态目录 / PDF 目录同开关) */
  toc: boolean;
  /** 导出后行为(默认不自动执行) */
  afterConvert: AfterConvertAction;
  /** 输出目录:空串 = 输出到源文件同目录(默认);非空 = 固定输出目录(须绝对路径) */
  outputDir: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  format: "docx",
  pageSetup: { ...DEFAULT_PAGE_SETUP },
  typography: { ...DEFAULT_TYPOGRAPHY },
  breakBeforeH1: false,
  toc: true,
  afterConvert: "none",
  outputDir: "",
};

/** 页面边距钳制范围(mm,与主进程 sanitizePageSetup 一致) */
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 1000;

/** 字号与行距的合法范围(与控件 min/max 一致,范围外回显当前值) */
export const BODY_SIZE_MIN = 8;
export const BODY_SIZE_MAX = 24;
export const LINE_SPACING_MIN = 1.0;
export const LINE_SPACING_MAX = 2.5;
