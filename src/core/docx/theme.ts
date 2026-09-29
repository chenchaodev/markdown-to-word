/**
 * docx 样式常量集中配置(硬约束:中文 eastAsia 字体统一在此,不散落硬编码)。
 * 正文默认字体/字号不在此处:以 typography 设置为准(settings-defaults →
 * renderDocx 逐文档注入),theme 只收与用户设置无关的固定样式常量。
 * 不变量:正文样式唯一来源是 typography 设置。
 */

/** 代码块 / 行内代码的等宽字体 */
export const CODE_FONT = "Consolas";

/** 注:代码字号不在此处 —— 行内(正文 ×0.9)与代码块(正文 ×0.79)是两个不同值,
 *  单个常量表达不了;且取值随用户正文字号变化,与本模块「只收与用户设置无关的
 *  固定样式常量」的定位相悖。故与正文一同由 core/settings/typography.ts 的
 *  inlineCodeFontSizePt / codeBlockFontSizePt 推导。 */

/** 链接蓝色 */
export const LINK_COLOR = "0563C1";

/** 弱化灰文字:页眉页脚小字、公式解析失败降级 TeX 源码、容器内降级文本 */
export const MUTED_TEXT_GRAY = "888888";

/** 次级灰文字:封面 author/date、图片加载失败占位文本 */
export const SECONDARY_TEXT_GRAY = "808080";

/** 引用块底纹(段落 shading fill) */
export const QUOTE_BG_GRAY = "F2F2F2";

/** 分隔线灰(thematicBreak 底边框) */
export const RULE_GRAY = "999999";

/** 表格边框黑(docx 表格 six-side borders;pdf 侧表格边框走模板 CSS #d0d7de,双管线观感既有差异,勿混改) */
export const TABLE_BORDER_BLACK = "000000";
