/**
 * 图片解析回调契约单源(B7 第 1 波):docx/pdf 渲染层与 main 侧实现
 * (image-downloader.ts createImageResolver)共用,消除三处平行类型定义。
 * 纯类型模块:零运行时代码,编译期擦除。
 */

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败。
 *  B5 可选轻量存在性通道 exists:本地图片存在性判定免整读/下载(false = 不存在;
 *  非缺失类失败如权限问题应抛出,保留 B4 错误码细分文案)。缺省时调用方回退完整解析。 */
export type ImageResolver = ((src: string) => Promise<Buffer | null>) & {
  exists?: (src: string) => Promise<boolean>;
};
