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

/**
  * 页眉页脚设置(文档外壳):
  * 内置 TEMPLATE_PRESETS 现可携带 headerFooter,作为「选预设即完整交付链」的一部分
  * (matchesPreset/PRESET_COMPARE_FIELDS 在 preset 定义时消费本对象);
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
 * 文字水印设置:与页眉页脚同组,文档外壳层装饰。
 * 内置 TEMPLATE_PRESETS 现可携带 watermark,作为「选预设即完整交付链」的一部分
 * (matchesPreset/PRESET_COMPARE_FIELDS 在 preset 定义时消费本对象);
 * 用户预设(CustomPreset)有意保持仅 typography+pageSetup 不变。
 * - text 空串 = 不启用(零渲染)
 * - angle 旋转角度(度,0–360),经典观感默认 45
 * - opacity 不透明度(0–1),浅色不干扰正文
 * - gray 浅灰经典观感(否则沿用正文字色)
 */
export interface WatermarkSettings {
  /** 水印文字(空串 = 不启用) */
  text: string;
  /** 旋转角度(度,0–360) */
  angle: number;
  /** 不透明度(0–1) */
  opacity: number;
  /** 浅灰经典观感(true)/正文同色(false) */
  gray: boolean;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  text: "",
  angle: 45,
  opacity: 0.15,
  gray: true,
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
  version: 1;
  format: ConvertFormat;
  pageSetup: PageSetup;
  typography: TypographySettings;
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
   /** AI 清理:转换前自动规整 AI 生成的 Markdown(智能引号/破折号/列表格式/空行) */
  aiCleanup: boolean;
  /** Obsidian 兼容(C1):将 [[双链]]、![[嵌入]] 转为标准 Markdown 链接 */
  obsidianCompat: boolean;
  /** Obsidian 附件子文件夹名(C1;用于解析 ![[图片]] 路径前缀) */
  obsidianAttachmentFolder: string;
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
  aiCleanup: false,
  obsidianCompat: false,
  obsidianAttachmentFolder: "Attachments",
};

/** 页面边距钳制范围(mm,与主进程 sanitizePageSetup 一致) */
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 1000;

/** 字号与行距的合法范围(与控件 min/max 一致,范围外回显当前值) */
export const BODY_SIZE_MIN = 8;
export const BODY_SIZE_MAX = 24;
export const LINE_SPACING_MIN = 1.0;
export const LINE_SPACING_MAX = 2.5;

/* ---------- 模板预设:排版 + 页面设置 + 完整交付链(页眉页脚/水印/编号)的快照 ---------- */
export interface TemplatePreset {
  id: string;
  /** 中文名,用户可见 */
  name: string;
  /** 简短说明,显示在模板选择行 */
  hint: string;
  /** i18n 键(硬编码预设本地化用;自定义预设留空,回退 name) */
  i18nKey?: string;
  typography: TypographySettings;
  pageSetup: PageSetup;
  /** 页眉页脚(完整交付链;仅内置预设携带,用户预设 CustomPreset 不存) */
  headerFooter?: HeaderFooterSettings;
  /** 文字水印(完整交付链;仅内置预设携带,用户预设 CustomPreset 不存) */
  watermark?: WatermarkSettings;
  /** 公式编号开关(完整交付链;仅内置预设携带) */
  equationNumbering?: boolean;
  /** H1 前分页(完整交付链;仅内置预设携带) */
  breakBeforeH1?: boolean;
}

/** 预设值已定稿,勿改。 */
export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "default",
    i18nKey: "preset.default",
    name: "默认",
    hint: "常规文档:微软雅黑正文、两端对齐、行距 1.5",
    typography: { ...DEFAULT_TYPOGRAPHY },
    pageSetup: { ...DEFAULT_PAGE_SETUP },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: true,
    breakBeforeH1: false,
  },
  {
    id: "paper",
    i18nKey: "preset.paper",
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
      headingScale: "standard",
      headingSpacing: "standard",
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 25.4,
      marginBottom: 25.4,
      marginLeft: 31.7,
      marginRight: 31.7,
    },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: true,
    breakBeforeH1: true,
  },
  {
    id: "business",
    i18nKey: "preset.business",
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
      headingScale: "standard",
      headingSpacing: "standard",
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 19.1,
      marginBottom: 19.1,
      marginLeft: 25.4,
      marginRight: 25.4,
    },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: false,
    breakBeforeH1: false,
  },
  {
    id: "official-cn",
    i18nKey: "preset.officialCn",
    name: "中文公文",
    hint: "仿宋正文 + Times New Roman 西文、两端对齐、GB 标准页边距",
    typography: {
      fontAscii: "Times New Roman",
      fontEastAsia: "仿宋_GB2312",
      bodySizePt: 16,
      lineSpacing: 1.5,
      firstLineIndent: true,
      align: "justify",
      headingNumbering: true,
      captionNumbering: true,
      headingScale: "standard",
      headingSpacing: "standard",
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 37,
      marginBottom: 35,
      marginLeft: 28,
      marginRight: 26,
    },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: true,
    breakBeforeH1: true,
  },
  {
    id: "cn-reader",
    i18nKey: "preset.cnReader",
    name: "中文长文",
    hint: "宋体正文、1.75 倍行距、首行缩进，适合阅读型长文档",
    typography: {
      fontAscii: "Times New Roman",
      fontEastAsia: "宋体",
      bodySizePt: 12,
      lineSpacing: 1.75,
      firstLineIndent: true,
      align: "justify",
      headingNumbering: true,
      captionNumbering: true,
      headingScale: "standard",
      headingSpacing: "standard",
    },
    pageSetup: { ...DEFAULT_PAGE_SETUP },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: true,
    breakBeforeH1: false,
  },
  {
    id: "cn-minimal",
    i18nKey: "preset.cnMinimal",
    name: "中文极简",
    hint: "微软雅黑正文、左对齐、无首行缩进、紧凑行距，适合随手笔记",
    typography: {
      fontAscii: "Calibri",
      fontEastAsia: "微软雅黑",
      bodySizePt: 11,
      lineSpacing: 1.15,
      firstLineIndent: false,
      align: "left",
      headingNumbering: false,
      captionNumbering: false,
      headingScale: "standard",
      headingSpacing: "standard",
    },
    pageSetup: {
      paper: "A4",
      orientation: "portrait",
      marginTop: 19.1,
      marginBottom: 19.1,
      marginLeft: 25.4,
      marginRight: 25.4,
    },
    headerFooter: { ...DEFAULT_HEADER_FOOTER },
    watermark: { ...DEFAULT_WATERMARK },
    equationNumbering: false,
    breakBeforeH1: false,
  },
];

/**
 * matchesPreset 参与比较的字段清单(单一来源):排版 + 页面设置全字段,
 * 以及完整交付链(页眉页脚/水印/编号)——后者仅当 preset 定义时参与比较。
 * 新增 TypographySettings / PageSetup 字段时在此补一行,漏补会导致
 * 预设回填静默失准(新增字段不参与匹配);字段名受 keyof 约束,拼错编译期报错。
 */
const PRESET_COMPARE_FIELDS = {
  typography: [
    "fontAscii",
    "fontEastAsia",
    "bodySizePt",
    "lineSpacing",
    "firstLineIndent",
    "align",
    "headingNumbering",
    "captionNumbering",
    "headingScale",
    "headingSpacing",
  ],
  pageSetup: ["paper", "orientation", "marginTop", "marginBottom", "marginLeft", "marginRight"],
  headerFooter: ["headerMode", "headerText", "headerLogoPath", "headerLayout", "footerEnabled"],
  watermark: ["text", "angle", "opacity", "gray"],
} as const;

/** 当前排版与页面设置是否与某预设完全一致(renderer 回填时选中对应模板)。 */
export function matchesPreset(preset: TemplatePreset, settings: AppSettings): boolean {
  const typographyOk = PRESET_COMPARE_FIELDS.typography.every(
    (field) => preset.typography[field] === settings.typography[field],
  );
  const pageSetupOk = PRESET_COMPARE_FIELDS.pageSetup.every(
    (field) => preset.pageSetup[field] === settings.pageSetup[field],
  );
  const presetHeaderFooter = preset.headerFooter;
  const headerFooterOk =
    !presetHeaderFooter ||
    !settings.headerFooter ||
    PRESET_COMPARE_FIELDS.headerFooter.every(
      (field) => presetHeaderFooter[field] === settings.headerFooter[field],
    );
  const presetWatermark = preset.watermark;
  const watermarkOk =
    !presetWatermark ||
    !settings.watermark ||
    PRESET_COMPARE_FIELDS.watermark.every(
      (field) => presetWatermark[field] === settings.watermark[field],
    );
  const equationNumberingOk =
    preset.equationNumbering === undefined ||
    settings.equationNumbering === undefined ||
    preset.equationNumbering === settings.equationNumbering;
  const breakBeforeH1Ok =
    preset.breakBeforeH1 === undefined ||
    settings.breakBeforeH1 === undefined ||
    preset.breakBeforeH1 === settings.breakBeforeH1;
  return (
    typographyOk &&
    pageSetupOk &&
    headerFooterOk &&
    watermarkOk &&
    equationNumberingOk &&
    breakBeforeH1Ok
  );
}
