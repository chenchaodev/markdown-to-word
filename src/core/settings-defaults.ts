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
// 仅类型导入(编译期擦除,不引入运行时依赖):Language 契约定义于 i18n.ts
import type { Language } from "./i18n.js";
export type { Language } from "./i18n.js";

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
  /** 公式编号开关(默认开;关时公式不编号、label 段原样渲染、引用保持原文本,docx/pdf 一致) */
  equationNumbering: boolean;
  /** 导出后行为(默认不自动执行) */
  afterConvert: AfterConvertAction;
  /** 输出目录:空串 = 输出到源文件同目录(默认);非空 = 固定输出目录(须绝对路径) */
  outputDir: string;
  /** 自定义模板预设(批次 11 迭代 3;上限 MAX_CUSTOM_PRESETS,名称非空去重) */
  customPresets: CustomPreset[];
  /** PDF 自定义样式 CSS(用户导入,追加到默认样式后覆盖;默认空) */
  pdfCss: string;
  /** 界面语言(默认 zh;renderer 启动与切换时经 i18n.setLanguage 生效) */
  language: Language;
}

/** 自定义模板预设:名称 + 排版/页面设置快照(套用逻辑与硬编码预设一致)。 */
export interface CustomPreset {
  name: string;
  typography: TypographySettings;
  pageSetup: PageSetup;
}

/** 自定义预设数量上限(超出截断,保留先保存的条目)。 */
export const MAX_CUSTOM_PRESETS = 10;

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  format: "docx",
  pageSetup: { ...DEFAULT_PAGE_SETUP },
  typography: { ...DEFAULT_TYPOGRAPHY },
  breakBeforeH1: false,
  toc: true,
  equationNumbering: true,
  afterConvert: "none",
  outputDir: "",
  customPresets: [],
  pdfCss: "",
  language: "zh",
};

/** 页面边距钳制范围(mm,与主进程 sanitizePageSetup 一致) */
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 1000;

/** 字号与行距的合法范围(与控件 min/max 一致,范围外回显当前值) */
export const BODY_SIZE_MIN = 8;
export const BODY_SIZE_MAX = 24;
export const LINE_SPACING_MIN = 1.0;
export const LINE_SPACING_MAX = 2.5;

/* ---------- 模板预设:排版 + 页面设置的快照(套用后仍可微调,不写死模板 id) ---------- */
export interface TemplatePreset {
  id: string;
  /** 中文名,用户可见 */
  name: string;
  /** 简短说明,显示在模板选择行 */
  hint: string;
  typography: TypographySettings;
  pageSetup: PageSetup;
}

/** 预设值已定稿,勿改(与批次 6 规划一致)。 */
export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "default",
    name: "默认",
    hint: "常规文档:微软雅黑正文、两端对齐、行距 1.5",
    typography: { ...DEFAULT_TYPOGRAPHY },
    pageSetup: { ...DEFAULT_PAGE_SETUP },
  },
  {
    id: "paper",
    name: "学术论文",
    hint: "论文常用:宋体正文 + Times New Roman 西文、两端对齐、标准页边距",
    typography: {
      fontAscii: "Times New Roman",
      fontEastAsia: "宋体",
      bodySizePt: 12,
      lineSpacing: 1.5,
      firstLineIndent: true,
      align: "justify",
      headingNumbering: true,
      captionNumbering: true,
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 25.4,
      marginBottom: 25.4,
      marginLeft: 31.7,
      marginRight: 31.7,
    },
  },
  {
    id: "business",
    name: "商务简报",
    hint: "简报常用:微软雅黑正文、左对齐、行距 1.15、页边距更紧凑",
    typography: {
      fontAscii: "Calibri",
      fontEastAsia: "微软雅黑",
      bodySizePt: 11,
      lineSpacing: 1.15,
      firstLineIndent: false,
      align: "left",
      headingNumbering: false,
      captionNumbering: false,
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 19.1,
      marginBottom: 19.1,
      marginLeft: 25.4,
      marginRight: 25.4,
    },
  },
];

/** 当前排版与页面设置是否与某预设完全一致(renderer 回填时选中对应模板)。 */
export function matchesPreset(preset: TemplatePreset, settings: AppSettings): boolean {
  const { typography: t, pageSetup: p } = preset;
  const { typography: st, pageSetup: sp } = settings;
  return (
    t.fontAscii === st.fontAscii &&
    t.fontEastAsia === st.fontEastAsia &&
    t.bodySizePt === st.bodySizePt &&
    t.lineSpacing === st.lineSpacing &&
    t.firstLineIndent === st.firstLineIndent &&
    t.align === st.align &&
    t.headingNumbering === st.headingNumbering &&
    t.captionNumbering === st.captionNumbering &&
    p.paper === sp.paper &&
    p.orientation === sp.orientation &&
    p.marginTop === sp.marginTop &&
    p.marginBottom === sp.marginBottom &&
    p.marginLeft === sp.marginLeft &&
    p.marginRight === sp.marginRight
  );
}
