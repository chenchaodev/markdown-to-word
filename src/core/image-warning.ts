/**
 * 图片加载失败统一警告文案(docx 与 pdf 共用,单一来源):
 * - src/core/docx/render.ts imageToDocx:本地缺失 / 外链下载失败(resolver 返回 null 或抛错)
 * - src/core/pdf/postprocess.ts checkLocalImages:本地图片存在性检查(resolver 失败路径)
 * - src/core/pdf/postprocess.ts embedExternalImages:外链下载失败
 * src 取 markdown 原文(相对路径 / URL / 绝对路径),与用户输入一致,便于定位。
 */

/** 生成统一警告文案:src 为图片在 markdown 中的原始引用 */
export function imageLoadFailedWarning(src: string): string {
  return `图片加载失败: ${src}`;
}

/**
 * 图片格式无法识别警告(B3):魔数判定失败的图片跳过嵌入(不再伪装 png),
 * docx/pdf 共用文案。src 为 markdown 原始引用。
 */
export function unrecognizedImageWarning(src: string): string {
  return `图片格式无法识别,已跳过: ${src}`;
}
