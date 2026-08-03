/**
 * 图片解析器(convert context.imageResolver 的 main 侧实现):
 * - 本地相对路径:path.resolve(baseDir, src) 读文件(与批次 1 行为一致)
 * - http(s):下载 Buffer(10s 超时,仅接受 2xx),失败返回 null
 * - 其余(data: 等):返回 null
 * 同 URL 并发去重缓存:一个文档内同 URL 只下载一次(含失败结果,避免重复超时)。
 * 纯 Node API(全局 fetch + AbortSignal.timeout),无新增依赖。
 * 警告不在此收集(core 渲染层负责),这里只返回 Buffer / null。
 */
import fs from "node:fs/promises";
import path from "node:path";

const HTTP_TIMEOUT_MS = 10_000;

export type ImageResolver = (src: string) => Promise<Buffer | null>;

/** 创建绑定 baseDir 的 imageResolver;每次文档转换新建一个实例(缓存随文档生命周期)。 */
export function createImageResolver(baseDir: string): ImageResolver {
  const cache = new Map<string, Promise<Buffer | null>>();
  return (src: string): Promise<Buffer | null> => {
    if (/^https?:\/\//i.test(src)) {
      let pending = cache.get(src);
      if (!pending) {
        pending = downloadHttp(src);
        cache.set(src, pending);
      }
      return pending;
    }
    return readLocal(path.resolve(baseDir, src));
  };
}

/** 下载 http(s) 资源:10s 超时,仅接受 2xx;任何失败(超时/非 2xx/网络错误)→ null,不抛。 */
async function downloadHttp(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function readLocal(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}