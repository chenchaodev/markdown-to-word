/**
 * 双管线共享渲染色值单源(docx 与 pdf 观感对齐的语义色)。
 * 不变量:两侧渲染模块只从本模块取值,勿在 docx/pdf 内重复硬编码同一语义色。
 * 形态:6 位大写 hex、无 # 前缀(docx OOXML 直接消费;pdf CSS 侧拼 `#` 前缀,
 * hex 大小写在 CSS 中等价)。与用户设置无关的固定观感色才入本模块。
 */

/** 水印浅灰经典观感(WatermarkSettings.gray=true;与 docx/theme.ts RULE_GRAY 同值但语义独立——分隔线灰改色不应牵动水印,勿合并) */
export const WATERMARK_GRAY = "999999";

/** 水印正文同色观感(WatermarkSettings.gray=false,取正文字色) */
export const WATERMARK_INK = "1F2328";
