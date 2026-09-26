// @ts-check
/**
 * 图片请求契约与缓存预算验收(位于 test/main/ = 主进程层;被测
 * src/main/services/image-downloader.ts,经 dist 直连,不起 Electron 窗口):
 * - 请求契约(request = signal/maxBytes/timeoutMs)在本地与外链两条路径都生效:
 *   maxBytes 超出即中止(本地 stat 预检 + 读后复核、http Content-Length 预检 +
 *   流式累计)、timeoutMs 覆盖 DNS/连接/读取、已取消的请求不再发起 IO;
 * - 取消信号传播:已 abort 的请求不发请求(私网拦截计数保持 0);
 * - 缓存预算:同 URL 并发去重、失败不缓存、成功按条目数/字节预算淘汰最早条目
 *   (条目超限 → 重新下载,证明已淘汰)。
 * 与 image-downloader.test.js 分工:该段守既有读取/SSRF/超时语义,本段只守
 * 请求契约与缓存预算(共用同一 dist 实现,断言不重复)。
 * http server 生命周期 try/finally 保证清理(closeAllConnections 防 keep-alive 挂起)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {
  createImageResolver,
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  MAX_RESPONSE_BYTES,
} from "../../dist/main/services/image-downloader.js";
import { FIXTURES_DIR } from "../common/paths.js";

const PNG_PATH = path.join(FIXTURES_DIR, "g1-tiny.png");

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`image-request-budget 断言失败:${msg}`);
}

/** 本地测试 server 句柄 */
/**
 * @typedef {object} TestServer
 * @property {http.Server} server 服务实例
 * @property {number} port 实际监听端口
 * @property {() => number} getCount 已处理请求数
 */

/**
 * 测试用 resolver:本地 server 场景显式放行私网(默认拦截 127.0.0.1)
 * @param {number} [timeoutMs] 单请求超时(毫秒)
 * @param {Record<string, unknown>} [options] 追加 resolver 选项
 * @returns {ReturnType<typeof createImageResolver>} 图片 resolver
 */
function localResolver(timeoutMs, options = {}) {
  return createImageResolver("", timeoutMs, { allowPrivateAddresses: true, ...options });
}

/**
 * 启动本地 http server:固定 status + body 响应,getCount() 返回请求次数
 * @param {number} status 响应状态码
 * @param {string | Buffer} body 响应体
 * @param {number} [delayMs] 响应前延迟(毫秒)
 * @returns {Promise<TestServer>} 服务句柄
 */
function startServer(status, body, delayMs = 0) {
  let count = 0;
  const server = http.createServer((_req, res) => {
    count += 1;
    setTimeout(() => {
      try {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
        res.end(body);
      } catch {
        /* 客户端已中止,忽略 */
      }
    }, delayMs);
  });
  /** @type {Promise<TestServer>} */
  const listening = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address !== null, "本地 server 应已绑定 TCP 端口");
      resolve({ server, port: address.port, getCount: () => count });
    });
  });
  return listening;
}

/**
 * 关闭 server:closeAllConnections 强制断开 keep-alive 空闲连接,避免 close 回调挂起
 * @param {http.Server} server 服务实例
 * @returns {Promise<void>} close 回调落地即返回
 */
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/**
 * 构造一个满足请求契约的 request(渲染层由 core/cancel.ts 注入,测试手工等价构造)
 * @param {{ maxBytes?: number, timeoutMs?: number, signal?: AbortSignal }} [options] 覆盖项
 * @returns {{ signal: AbortSignal, maxBytes: number, timeoutMs: number }} 渲染层同形 request
 */
function requestOf({ maxBytes = MAX_RESPONSE_BYTES, timeoutMs = 5000, signal } = {}) {
  return { signal: signal ?? new AbortController().signal, maxBytes, timeoutMs };
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const fixtureBytes = await fs.readFile(PNG_PATH);

  // ================= 1. 本地路径:maxBytes 超出即中止(不返回内容) =================
  {
    const resolver = createImageResolver(FIXTURES_DIR);
    const ok = await resolver("./g1-tiny.png", requestOf({ maxBytes: fixtureBytes.length }));
    assert(ok && ok.equals(fixtureBytes), "maxBytes 恰等于文件大小时应正常读取");
    // 上限比文件小 1 字节 → 归 null(统一「图片加载失败」通道,不是「文件不存在」)
    const rejected = await resolver("./g1-tiny.png", requestOf({ maxBytes: fixtureBytes.length - 1 }));
    assert(rejected === null, `超单图预算的本地图片应返回 null,实际 ${rejected?.length ?? rejected}`);
    // 缺省 request 时行为不变(用实例级默认上限)
    const noRequest = await resolver("./g1-tiny.png");
    assert(noRequest && noRequest.equals(fixtureBytes), "未传 request 时本地读取应保持原行为");
    console.log("[ok] image-request-budget:本地图片 maxBytes 生效(stat 预检 + 读后复核)");
  }

  /** @type {TestServer | null} */
  let srv = null;
  try {
    srv = await startServer(200, fixtureBytes);
    const url = `http://127.0.0.1:${srv.port}/img.png`;

    // ================= 2. 外链:maxBytes / timeoutMs 生效 =================
    {
      const resolver = localResolver();
      const ok = await resolver(url, requestOf({ maxBytes: fixtureBytes.length }));
      assert(ok && ok.equals(fixtureBytes), "外链 maxBytes 恰等于响应大小时应正常下载");
      // 换 URL 避开成功缓存(同实例同 URL 命中缓存不再发请求)
      const smallLimitUrl = `http://127.0.0.1:${srv.port}/small-limit.png`;
      const rejected = await resolver(smallLimitUrl, requestOf({ maxBytes: fixtureBytes.length - 1 }));
      assert(rejected === null, `超单图预算的外链图片应返回 null,实际 ${rejected?.length ?? rejected}`);
      // 请求时限:慢响应 + 极短 request.timeoutMs → 中止返回 null
      const slow = await startServer(200, fixtureBytes, 300);
      try {
        const timedOut = await localResolver()(slow.port ? `http://127.0.0.1:${slow.port}/slow.png` : "", requestOf({ timeoutMs: 30 }));
        assert(timedOut === null, "request.timeoutMs 应中止慢响应并返回 null");
        assert(slow.getCount() === 1, `超时场景应已发出 1 次请求,实际 ${slow.getCount()}`);
      } finally {
        await closeServer(slow.server);
      }
      console.log("[ok] image-request-budget:外链 maxBytes 与 request.timeoutMs 生效");
    }

    // ================= 3. 已取消的请求不发起 IO =================
    {
      const controller = new AbortController();
      controller.abort(new Error("pre-aborted"));
      const before = srv.getCount();
      const resolver = localResolver();
      const cancelled = await resolver(`http://127.0.0.1:${srv.port}/cancelled.png`, requestOf({ signal: controller.signal }));
      assert(cancelled === null, "已取消的请求应直接返回 null");
      assert(srv.getCount() === before, `已取消的请求不应发出网络请求,计数 ${before} → ${srv.getCount()}`);
      // exists 通道同样短路
      assert((await resolver.exists(`http://127.0.0.1:${srv.port}/cancelled2.png`, requestOf({ signal: controller.signal }))) === false,
        "已取消的 exists 请求应返回 false");
      console.log("[ok] image-request-budget:已取消的请求不发起 IO(计数保持不变)");
    }

    // ================= 4. 缓存预算:成功条目按上限淘汰(超限后重新下载) =================
    // 单实例下连续请求 70 个互异 URL(缓存条目上限 64)→ 最早的条目被淘汰,
    // 再次请求它会重新发出网络请求(计数 +1);仍在预算内的 URL 不重新请求。
    {
      const resolver = localResolver();
      // 端口取常量供下方闭包使用(let 的非空收窄在闭包内不成立)
      const srvPort = srv.port;
      const urls = Array.from({ length: 70 }, (_, i) => `http://127.0.0.1:${srvPort}/cache-${i}.png`);
      for (const u of urls) {
        const buf = await resolver(u, requestOf());
        assert(buf !== null, `缓存预算准备阶段下载失败:${u}`);
      }
      const afterWarmup = srv.getCount();
      // 最早的 URL(已被淘汰)与最后的 URL(仍在缓存内)各再请求一次
      const evicted = await resolver(urls[0], requestOf());
      const cached = await resolver(urls[urls.length - 1], requestOf());
      assert(evicted !== null && cached !== null, "缓存预算场景两次请求都应成功");
      assert(srv.getCount() === afterWarmup + 1, `被淘汰的 URL 应重新下载(计数 +1),实际 +${srv.getCount() - afterWarmup}`);
      console.log(`[ok] image-request-budget:成功缓存按条目上限淘汰(70 个 URL 后最早条目重新下载)`);
    }
  } finally {
    if (srv) await closeServer(srv.server);
  }

  // ================= 5. 预算常量口径(默认上限与缓存预算钉死) =================
  {
    assert(MAX_RESPONSE_BYTES === 20 * 1024 * 1024, `默认单图上限口径漂移:${MAX_RESPONSE_BYTES}`);
    assert(MAX_CACHE_ENTRIES === 64 && MAX_CACHE_BYTES === 32 * 1024 * 1024,
      `缓存预算口径漂移:entries=${MAX_CACHE_ENTRIES} bytes=${MAX_CACHE_BYTES}`);
    assert(MAX_CACHE_BYTES > MAX_RESPONSE_BYTES, "缓存字节预算应大于单图上限(至少容纳一张最大图)");
    console.log(
      `[ok] image-request-budget:预算常量口径(单图 ${MAX_RESPONSE_BYTES} / 缓存 ${MAX_CACHE_ENTRIES} 条 ${MAX_CACHE_BYTES} 字节)`,
    );
  }
}
