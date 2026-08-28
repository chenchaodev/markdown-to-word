/**
 * 图片加载失败统一警告(docx 与 pdf 共用,单一来源):
 * - src/core/docx/handlers/image-run.ts imageToDocx:本地缺失 / 外链下载失败(resolver 返回 null 或抛错)
 * - src/core/pdf/postprocess.ts checkLocalImages:本地图片存在性检查(resolver 失败路径)
 * - src/core/pdf/postprocess.ts embedExternalImages:外链下载失败
 * src 取 markdown 原文(相对路径 / URL / 绝对路径),与用户输入一致,便于定位。
 * 返回 KeyedWarning(keyed 警告),fallback = 中文原文逐字保留(zh 行为等价)。
 */
import type { KeyedWarning } from "../i18n.js";

/** src 为图片在 markdown 中的原始引用 */
export function imageLoadFailedWarning(src: string): KeyedWarning {
  return {
    key: "warn.imageLoadFailed",
    params: { src },
    fallback: `图片加载失败: ${src}`,
  };
}

/**
 * 图片格式无法识别警告:魔数判定失败的图片跳过嵌入(不再伪装 png),
 * docx/pdf 共用文案。src 为 markdown 原始引用。
 */
export function unrecognizedImageWarning(src: string): KeyedWarning {
  return {
    key: "warn.imageUnrecognized",
    params: { src },
    fallback: `图片格式无法识别,已跳过: ${src}`,
  };
}

/** 图片文件不存在(ENOENT)细分警告 */
export function imageNotFoundWarning(src: string): KeyedWarning {
  return {
    key: "warn.imageNotFound",
    params: { src },
    fallback: `图片文件不存在: ${src}`,
  };
}

/** 图片文件无访问权限(EACCES/EPERM)细分警告 */
export function imageAccessDeniedWarning(src: string): KeyedWarning {
  return {
    key: "warn.imageAccessDenied",
    params: { src },
    fallback: `图片文件无访问权限: ${src}`,
  };
}

/**
 * 图片读取失败原因细分(docx/pdf 共用单一来源):
 * 按 fs 错误码分类——ENOENT → 文件不存在;EACCES/EPERM → 无权限
 * (EPERM 为 Windows 常见拒绝码,与 EACCES 同口径);其他错误/无错误对象
 * (resolver 返回 null)→ 统一「图片加载失败」兜底。
 */
export function imageLoadFailureWarning(src: string, err?: unknown): KeyedWarning {
  const code = typeof err === "object" && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
  if (code === "ENOENT") return imageNotFoundWarning(src);
  if (code === "EACCES" || code === "EPERM") return imageAccessDeniedWarning(src);
  return imageLoadFailedWarning(src);
}

/**
 * webp 不支持 docx 内嵌警告(docx 路线专属——pdf 走 Chromium
 * 渲染原生支持 webp,无此降级路径):webp 图片跳过嵌入,占位文本替代。
 */
export function webpSkippedWarning(src: string): KeyedWarning {
  return {
    key: "warn.webpSkipped",
    params: { src },
    fallback: `webp 图片不支持 docx 内嵌,已跳过: ${src}`,
  };
}

/**
 * 页眉 logo 读取失败警告(main 层 resolveHeaderLogo 读
 * settings.headerLogoPath 失败时):降级为无 logo 继续转换,不中断。
 * src 为设置的 logo 绝对路径(与用户配置一致,便于定位)。
 */
export function headerLogoLoadFailedWarning(src: string): KeyedWarning {
  return {
    key: "warn.headerLogoLoadFailed",
    params: { src },
    fallback: `页眉 logo 加载失败,已忽略: ${src}`,
  };
}

/**
 * 图片尺寸属性非法警告(docx/pdf 共用单一来源):
 * {width=…}/{height=…} 值为负数/非数值/超范围时忽略该属性并告警
 * (图片回退默认尺寸行为,不中断转换)。src 为图片在 markdown 中的原始引用,
 * attr 为原始键值对(如 "width=-3"),便于定位。
 */
export function imageAttrInvalidWarning(src: string, attr: string): KeyedWarning {
  return {
    key: "warn.imageAttrInvalid",
    params: { src, attr },
    fallback: `图片尺寸属性无效,已忽略: ${attr}(${src})`,
  };
}
