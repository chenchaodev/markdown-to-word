/**
 * 内置模板预设目录:排版 + 页面设置 + 完整交付链(页眉页脚/水印/编号)的快照。
 *
 * 从 settings-defaults.ts 拆出的理由:本块是**纯数据目录**(6 个预设的字面量)加一个
 * 纯比较函数,与「设置默认值 / 页面设置校验」不同质 —— 前者是用户可选的成品方案,
 * 后者是所有方案的公共底座与约束。此前 255 行(占该文件三分之一)混在默认值文件里,
 * 使「默认值」这一职责被目录数据淹没。
 *
 * 依赖方向单向:本模块 → settings-defaults(取 AppSettings 与各设置项类型)。
 * 值已定稿,勿改;新增预设须同步 i18n 三语字典的 hint 键(见 core/i18n/*.ts)。
 */
import { DEFAULT_TYPOGRAPHY, type TypographySettings } from "./typography.js";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_SETUP,
  DEFAULT_WATERMARK,
  type AppSettings,
  type HeaderFooterSettings,
  type PageSetup,
  type WatermarkSettings,
} from "./settings-defaults.js";

/* ---------- 模板预设:排版 + 页面设置 + 完整交付链(页眉页脚/水印/编号)的快照 ---------- */
export interface TemplatePreset {
  id: string;
  /** 中文名,用户可见 */
  name: string;
  /** 简短说明的中文原文,显示在模板选择行(字典缺键时的回退底,勿清空) */
  hint: string;
  /** i18n 键(硬编码预设本地化用;自定义预设留空,回退 name) */
  i18nKey?: string;
  /**
   * hint 的 i18n 键(预设说明三语化;内置 6 预设必填)。
   * 显示层一律经 presetHintText 取值:字典命中→当前语言说明,未配键或缺键→回退 hint 原文,
   * 因此中文 hint 字段不可删除(它是缺键时的兜底,勿清空/勿改写)。
   */
  hintI18nKey?: string;
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
    hintI18nKey: "preset.hintDefault",
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
    hintI18nKey: "preset.hintPaper",
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
    hintI18nKey: "preset.hintBusiness",
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
    hintI18nKey: "preset.hintOfficialCn",
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
    hintI18nKey: "preset.hintCnReader",
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
    hintI18nKey: "preset.hintCnMinimal",
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
 * 预设 → 设置 patch 的**唯一应用口径**(纯函数,零 DOM、零 IO)。
 *
 * 为什么下沉到 core:同一份「预设带哪些设置字段、可选字段何时才覆盖」的判定
 * 此前只存在于 renderer's applyTemplatePreset,CLI 交付面要用它就必须
 * 自己重写一份 —— 两份枚举必然漂移(预设新增可选字段时 CLI 静默不生效)。
 * 提取后 GUI 与 CLI 共用本函数,漂移面从 N 份降到 1 份。
 *
 * 字段集合与 applyTemplatePreset 的历史行为逐字一致:
 * typography / pageSetup 恒覆盖;headerFooter / watermark / equationNumbering /
 * breakBeforeH1 仅当预设**定义了**该字段时才覆盖(用户预设 CustomPreset 只携带
 * 排版 + 页面设置,不得因此把用户已有的页眉/水印/编号重置回默认)。
 */
export function presetSettingsPatch(preset: TemplatePreset): Partial<AppSettings> {
  return {
    typography: { ...preset.typography },
    pageSetup: { ...preset.pageSetup },
    ...(preset.headerFooter ? { headerFooter: { ...preset.headerFooter } } : {}),
    ...(preset.watermark ? { watermark: { ...preset.watermark } } : {}),
    ...(preset.equationNumbering !== undefined ? { equationNumbering: preset.equationNumbering } : {}),
    ...(preset.breakBeforeH1 !== undefined ? { breakBeforeH1: preset.breakBeforeH1 } : {}),
  };
}

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
