/**
 * 图片解析回调契约单源:docx/pdf 渲染层与 main 侧实现
 * (image-downloader.ts createImageResolver)共用,消除三处平行类型定义。
 * 纯类型模块:零运行时代码,编译期擦除。
 */

/**
 * 单次图片解析请求的约束(渲染层 → resolver 注入):
 * 由 core/cancel.ts 的 createGuardedImageResolver 构造(每次请求一份,
 * 含独立 AbortController),实现方必须同时遵守三者:
 * - signal:取消或单请求时限到达即中止 IO(挂 abort 监听;已 aborted 时不再发起请求);
 * - maxBytes:单图字节上限,超过即中止读取/下载(不等响应体读完);
 * - timeoutMs:本次请求的时限(ms),供实现方为 DNS/连接等子步骤分摊时间。
 */
export interface ImageResolverRequest {
  /** 本次请求的取消/超时信号(恒存在) */
  signal: AbortSignal;
  /** 单图字节上限(正数) */
  maxBytes: number;
  /** 本次请求时限(ms,正数) */
  timeoutMs: number;
}

/** 图片解析回调:给定 src(URL/相对路径),返回图片 Buffer;返回 null 表示解析失败
 *  (缺失检查并入此失败路径,单次 IO)。request 为本次请求的约束(可选参数,
 *  便于测试注入单参实现;渲染层始终传入)。
 *  可选轻量存在性通道 exists:本地图片存在性判定免整读/下载(false = 不存在;
 *  非缺失类失败如权限问题应抛出,保留错误码细分文案)。缺省时调用方回退完整解析。 */
export type ImageResolver = (
  (src: string, request?: ImageResolverRequest) => Promise<Buffer | null>
) & {
  exists?: (src: string, request?: ImageResolverRequest) => Promise<boolean>;
};
