/**
 * 图片解析器(convert context.imageResolver 的 main 侧实现):
 * - 本地相对路径:path.resolve(baseDir, src) 读文件
 * - http(s):下载 Buffer(默认 10s 超时,timeoutMs 可注入;仅接受 2xx),失败返回 null
 * - 其余(data: 等):返回 null
 * 同 URL 并发去重缓存:一个文档内同 URL 只下载一次;仅成功结果缓存,失败
 * (404/超时/网络错误 → null)不缓存——一次网络抖动不导致批量期间该 URL 永久失败,下次重试。
 * 纯 Node API(全局 fetch + AbortSignal.timeout),无新增依赖。
 * 警告不在此收集(core 渲染层负责),这里只返回 Buffer / null。
 * SSRF 加固(安全收紧,正常路径不受影响):
 * - 响应体大小上限 MAX_RESPONSE_BYTES(Content-Length 预检 + 流式累计双保险,
 *   超限中止读取返回 null → core 层走既有「图片加载失败」警告通道);
 * - 私网/回环/链路本地地址拦截:每跳重定向目标均先解析 DNS 并校验 IP,防借主进程
 *   网络位置做内网探测;策略经 ALLOW_PRIVATE_ADDRESSES 常量与 per-resolver 选项
 *   可放宽(测试本地 server 场景显式传入 allowPrivateAddresses:true)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
// 契约单源:ImageResolver 类型收敛 core/image-resolver.ts,此处仅实现
import type { ImageResolver } from "../../core/image/image-resolver.js";

const HTTP_TIMEOUT_MS = 10_000;

/** 响应体大小上限:20MB,远超正常文档图片需求,防恶意大响应耗尽内存。 */
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/** 重定向跟随上限:防重定向循环拖住转换。 */
const MAX_REDIRECTS = 5;

/**
 * 私网/回环拦截总开关:false = 拦截(默认,安全收紧);
 * 未来若有「本地图片服务」类合法场景需要放宽,改此常量或经 per-resolver 选项覆盖。
 */
export const ALLOW_PRIVATE_ADDRESSES = false;

/** image-downloader 可注入选项(均缺省走上方模块级默认)。 */
export interface ImageDownloaderOptions {
  /** 允许私网/回环地址(测试本地 server 等场景;生产默认 false)。 */
  allowPrivateAddresses?: boolean;
}

/* ---------- IP 分类与主机校验 ---------- */

/** IPv4 私网/回环/链路本地/CGNAT 判定(非法地址按私网处理,宁可错拦)。 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number];
  if (a === 0 || a === 10 || a === 127) return true; // 本网络 / 私网 / 回环
  if (a === 169 && b === 254) return true; // 链路本地 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 私网 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/** IPv6 回环/未指定/链路本地(fe80::/10)/唯一本地(fc00::/7)/v4-mapped 判定。 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]!); // ::ffff:x.x.x.x 取嵌入 IPv4 判定
  if (lower === "::" || lower === "::1") return true; // 未指定 / 回环
  const first = lower.split(":")[0] ?? "";
  if (/^fe[89ab]$/.test(first)) return true; // 链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}$/.test(first)) return true; // 唯一本地 fc00::/7
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return net.isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** 主机是否允许直连:字面量 IP 直接判定;域名解析后全部地址均须非私网(任一命中即拒,
 *  防 DNS rebinding 双答案绕过);解析失败按不允许处理(下载本会失败,提前拦截)。 */
async function isHostAllowed(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** 创建绑定 baseDir 的 imageResolver;每次文档转换新建一个实例(缓存随文档生命周期)。
 * timeoutMs:http(s) 下载超时(默认 HTTP_TIMEOUT_MS = 10s,测试可注入缩短)。
 * options:SSRF 策略选项(allowPrivateAddresses,默认随模块常量收紧)。
 * 缓存语义:fetch 前 cache.set 保证并发去重(在途 Promise 共享);结算后失败(null)条目
 * 异步删除,成功结果保留——失败下次调用重新下载,成功不重复请求。
 * 附带 exists 轻量存在性通道——本地路径 fs.access 判定(免整读),ENOENT → false,
 * 其他错误(权限等)抛出保留错误码;非本地路径退回完整解析(pdf 侧 checkLocalImages
 * 仅收本地 src,此为防御兜底)。 */
export function createImageResolver(
  baseDir: string,
  timeoutMs: number = HTTP_TIMEOUT_MS,
  options: ImageDownloaderOptions = {},
): ImageResolver {
  const allowPrivateAddresses = options.allowPrivateAddresses ?? ALLOW_PRIVATE_ADDRESSES;
  const cache = new Map<string, Promise<Buffer | null>>();
  const resolve = (src: string): Promise<Buffer | null> => {
    if (/^https?:\/\//i.test(src)) {
      let pending = cache.get(src);
      if (!pending) {
        pending = downloadHttp(src, timeoutMs, allowPrivateAddresses);
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
      throw err; // 权限等其他错误抛出,checkLocalImages 按错误码细分文案
    }
  };
  return Object.assign(resolve, { exists });
}

/** 下载 http(s) 资源:默认 10s 超时(timeoutMs 由 createImageResolver 注入),仅接受 2xx;
 * 任何失败(超时/非 2xx/网络错误/私网拦截/体积超限/重定向超限)→ null,不抛。
 * 手动跟随重定向(redirect:"manual"),每一跳目标都过私网校验后再请求。 */
async function downloadHttp(url: string, timeoutMs: number, allowPrivateAddresses: boolean): Promise<Buffer | null> {
  try {
    let current = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (!allowPrivateAddresses && !(await isHostAllowed(new URL(current).hostname))) return null;
      const res = await fetch(current, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).href; // 相对 Location 以当前 URL 为基准
        continue;
      }
      if (!res.ok) return null;
      return await readBodyCapped(res);
    }
    return null; // 重定向次数超限
  } catch {
    return null;
  }
}

/** 读响应体:Content-Length 预检 + 流式累计双保险,超过 MAX_RESPONSE_BYTES
 *  中止读取(取消流释放连接)返回 null → core 层走既有「图片加载失败」警告通道。 */
async function readBodyCapped(res: Response): Promise<Buffer | null> {
  const contentLength = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) return null;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer()); // 无流的兜底路径(罕见)
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined); // 超限中止,尽早释放连接
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function readLocal(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
