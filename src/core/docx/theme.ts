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

/**
 * 目录条目缩进阶梯(单位:twips;下标 0 = 第 1 级,依此类推)。
 *
 * 取 **Word 内置值** `0 / 220 / 440`:Word 自己的 TOC1/TOC2/TOC3 用的就是这三档,
 * 故 field 模式(Word 域目录)下用户按 F9 更新域后,目录缩进**不跳变**。
 * ⚠ **与 PDF 侧的 em 阶梯(1.5em/3em)有意分歧**:对齐 PDF 侧会让 field 模式更新域后
 * 缩进跳变一次(缓存目录用的是本仓阶梯,更新后换成 Word 内置阶梯)⇒ 取内置值更稳。
 * 缩进是样式常量(与字体/颜色同级),故集中在此,不散落硬编码。
 */
export const TOC_INDENT_LADDER_TWIPS: readonly number[] = [0, 220, 440];
