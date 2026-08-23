/**
 * 图片解析器(convert context.imageResolver 的 main 侧实现):
 * - 本地相对路径:path.resolve(baseDir, src) 读文件(与批次 1 行为一致)
 * - http(s):下载 Buffer(默认 10s 超时,timeoutMs 可注入;仅接受 2xx),失败返回 null
 * - 其余(data: 等):返回 null
 * 同 URL 并发去重缓存:一个文档内同 URL 只下载一次;仅成功结果缓存,失败
 * (404/超时/网络错误 → null)不缓存——一次网络抖动不导致批量期间该 URL 永久失败,下次重试。
 * 纯 Node API(全局 fetch + AbortSignal.timeout),无新增依赖。
 * 警告不在此收集(core 渲染层负责),这里只返回 Buffer / null。
 */
import fs from "node:fs/promises";
import path from "node:path";

const HTTP_TIMEOUT_MS = 10_000;

/** 图片解析回调契约(与 core 侧 docx/pdf render.ts 同构,勿单侧漂移):
 * 给定 src 返回图片 Buffer,null 表示解析失败。
 * B5 可选轻量存在性通道 exists:本地图片存在性判定免整读(false = 不存在;
 * 非缺失类失败如权限问题抛出,保留 B4 错误码细分文案);缺省时调用方回退完整解析。 */
export type ImageResolver = ((src: string) => Promise<Buffer | null>) & {
  exists?: (src: string) => Promise<boolean>;
};

/** 创建绑定 baseDir 的 imageResolver;每次文档转换新建一个实例(缓存随文档生命周期)。
 * timeoutMs:http(s) 下载超时(默认 HTTP_TIMEOUT_MS = 10s,测试可注入缩短)。
 * 缓存语义:fetch 前 cache.set 保证并发去重(在途 Promise 共享);结算后失败(null)条目
 * 异步删除,成功结果保留——失败下次调用重新下载,成功不重复请求。
 * B5:附带 exists 轻量存在性通道——本地路径 fs.access 判定(免整读),ENOENT → false,
 * 其他错误(权限等)抛出保留错误码;非本地路径退回完整解析(pdf 侧 checkLocalImages
 * 仅收本地 src,此为防御兜底)。 */
export function createImageResolver(baseDir: string, timeoutMs: number = HTTP_TIMEOUT_MS): ImageResolver {
  const cache = new Map<string, Promise<Buffer | null>>();
  const resolve = (src: string): Promise<Buffer | null> => {
    if (/^https?:\/\//i.test(src)) {
      let pending = cache.get(src);
      if (!pending) {
        pending = downloadHttp(src, timeoutMs);
        cache.set(src, pending);
        // 失败不缓存:结算为 null(404/超时/网络错误)时删除条目,下次调用重新下载。
        // 并发调用已持有同一 pending(去重语义保留),仅影响后续调用。
        void pending.then((buf) => {
          if (buf === null) cache.delete(src);
        });
      }
      return pending;
    }
    return readLocal(path.resolve(baseDir, src));
  };
  const exists = async (src: string): Promise<boolean> => {
    if (/^https?:\/\//i.test(src)) return (await resolve(src)) !== null;
    try {
      await fs.access(path.resolve(baseDir, src));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw err; // 权限等其他错误抛出,checkLocalImages 按 B4 错误码细分文案
    }
  };
  return Object.assign(resolve, { exists });
}

/** 下载 http(s) 资源:默认 10s 超时(timeoutMs 由 createImageResolver 注入),仅接受 2xx;
 * 任何失败(超时/非 2xx/网络错误)→ null,不抛。 */
async function downloadHttp(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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