/**
 * 图片解析器段(src/main/services/image-downloader.ts 纯逻辑层,不起 Electron 窗口):
 * - 本地读取:path.resolve(baseDir, src) 相对/绝对路径均读文件,缺失与 data: 等非 http → null
 * - http 下载:200 成功返回内容一致的 Buffer;404 / 连接拒绝 → null
 * - 同 URL 缓存:并发去重(在途 Promise 共享,仅成功结果缓存);失败(404/超时)不缓存,
 *   下次调用重新下载,实例间隔离
 * - 缺失检查并入 resolver 失败路径(convert 层 stat 预扫已移除),resolver
 *   返回 null → 转换 warnings 追加统一文案「图片加载失败: <src>」(本地缺失有警告,
 *   存在的本地图片无警告;文案三处统一见 core/image-warning.ts)
 * - exists 轻量存在性通道:本地存在 → true / 缺失 → false / data: 退回完整解析
 * - SSRF 加固:默认拦截私网/回环(127.0.0.1 目标在 fetch 前被拦,server 计数 0);
 *   本地 server 测试场景经第三参 opt-in({ allowPrivateAddresses: true })放行
 * 超时分支:createImageResolver 第二参 timeoutMs 注入(默认 10s 不变),慢响应 server +
 * timeoutMs=50 断言超时 → null;index.ts 模块私有 resolverCache(跨 baseDir 共享)
 * 无法低成本自动化,未覆盖原因见验收报告。
 * http server 生命周期 try/finally 保证清理(closeAllConnections 防 keep-alive 挂起)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createImageResolver } from "../../dist/main/services/image-downloader.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { saveArtifact } from "../common/artifacts.js";

const PNG_PATH = path.join(FIXTURES_DIR, "g1-tiny.png");

/** 测试用 http resolver:本地 server 场景显式放行私网(默认拦截 127.0.0.1)。 */
function localResolver(timeoutMs) {
  return createImageResolver("", timeoutMs, { allowPrivateAddresses: true });
}

/** 启动本地 http server:固定 status + body 响应(delayMs 可选,响应前延迟),getCount() 返回请求次数 */
function startServer(status, body, delayMs = 0) {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    setTimeout(() => {
      try {
        // 客户端可能已中止(如超时断开),此时不再写响应,避免写已销毁 socket
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
        res.end(body);
      } catch {
        // 连接已中止,忽略写响应错误
      }
    }, delayMs);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, getCount: () => count });
    });
  });
}

/** 关闭 server:closeAllConnections 强制断开 undici keep-alive 空闲连接,避免 close 回调挂起 */
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function run() {
  const fixtureBytes = await fs.readFile(PNG_PATH);

  // ---- 断言 1:本地相对路径 path.resolve(baseDir, src) ----
  const local = createImageResolver(FIXTURES_DIR);
  const rel = await local("./g1-tiny.png");
  if (!rel || !rel.equals(fixtureBytes)) {
    throw new Error("image-downloader 断言失败:本地相对路径未读到与 fixture 一致的 Buffer");
  }

  // ---- 断言 2:本地绝对路径(path.resolve 遇绝对路径原样返回) ----
  const abs = await local(PNG_PATH);
  if (!abs || !abs.equals(fixtureBytes)) {
    throw new Error("image-downloader 断言失败:本地绝对路径未读到与 fixture 一致的 Buffer");
  }

  // ---- 断言 3:本地缺失文件 → null ----
  if ((await local("./missing-xxx.png")) !== null) {
    throw new Error("image-downloader 断言失败:缺失本地文件应返回 null");
  }

  // ---- 断言 4:data: 等非 http 前缀 → 走 readLocal 失败分支 → null ----
  if ((await local("data:image/png;base64,AAAA")) !== null) {
    throw new Error("image-downloader 断言失败:data: URI 应返回 null");
  }

  // ---- 断言 4b:exists 轻量存在性通道(本地 fs.access,免整读) ----
  // 存在 → true;缺失(ENOENT)→ false;data: 等非本地路径退回完整解析(null → false)。
  if ((await local.exists("./g1-tiny.png")) !== true) {
    throw new Error("image-downloader 断言失败:exists 对存在的本地图片应返回 true");
  }
  if ((await local.exists(PNG_PATH)) !== true) {
    throw new Error("image-downloader 断言失败:exists 对存在的绝对路径应返回 true");
  }
  if ((await local.exists("./missing-xxx.png")) !== false) {
    throw new Error("image-downloader 断言失败:exists 对缺失本地文件应返回 false");
  }
  if ((await local.exists("data:image/png;base64,AAAA")) !== false) {
    throw new Error("image-downloader 断言失败:exists 对 data: URI 应退回完整解析得 false");
  }

  // ---- http server 生命周期:try/finally 保证清理 ----
  let srv200 = null;
  let srv404 = null;
  let srvSlow = null;
  let port = 0;
  try {
    srv200 = await startServer(200, fixtureBytes);
    port = srv200.port;
    srv404 = await startServer(404, Buffer.from("NOPE"));
    const resolver = localResolver();
    const url = `http://127.0.0.1:${port}/img.png`;

    // ---- 断言 5a:默认拦截私网——未 opt-in 时 127.0.0.1 目标在 fetch 前被拦 ----
    // 字面量回环 IP 直接判定私网 → 返回 null 且请求不发出(server 计数保持 0);
    // 显式 allowPrivateAddresses:false 与默认行为一致(策略缺省收紧)。
    if ((await createImageResolver("")(url)) !== null) {
      throw new Error("image-downloader 断言失败:默认配置应拦截私网/回环地址(127.0.0.1)返回 null");
    }
    if (srv200.getCount() !== 0) {
      throw new Error(`image-downloader 断言失败:私网拦截应发生在请求前(计数 0),实际 ${srv200.getCount()}`);
    }
    if ((await createImageResolver("", undefined, { allowPrivateAddresses: false })(url)) !== null) {
      throw new Error("image-downloader 断言失败:显式 allowPrivateAddresses:false 应同样拦截");
    }

    // ---- 断言 5:http 200 下载成功,内容一致(opt-in 后本地 server 可达) ----
    const buf = await resolver(url);
    if (!buf || !buf.equals(fixtureBytes)) {
      throw new Error("image-downloader 断言失败:200 下载内容与 fixture 不一致");
    }
    if (srv200.getCount() !== 1) {
      throw new Error(`image-downloader 断言失败:200 下载应请求 1 次,实际 ${srv200.getCount()}`);
    }

    // ---- 断言 6:同 URL 并发去重(两次调用同一 Promise,结果同一引用) ----
    const [a, b] = await Promise.all([resolver(url), resolver(url)]);
    if (a !== b || !a.equals(b)) {
      throw new Error("image-downloader 断言失败:并发同 URL 应命中同一缓存 Promise");
    }
    if (srv200.getCount() !== 1) {
      throw new Error(`image-downloader 断言失败:并发去重后应仍只请求 1 次,实际 ${srv200.getCount()}`);
    }

    // ---- 断言 7:非 2xx(404)→ null,且失败结果不缓存(第二次重新请求,计数 2,仍 null) ----
    // 仅成功缓存——失败不缓存,一次网络抖动不导致批量期间该 URL 永久失败。
    const url404 = `http://127.0.0.1:${srv404.port}/missing.png`;
    if ((await resolver(url404)) !== null) {
      throw new Error("image-downloader 断言失败:404 应返回 null");
    }
    if ((await resolver(url404)) !== null) {
      throw new Error("image-downloader 断言失败:失败不缓存后再次调用仍应返回 null");
    }
    if (srv404.getCount() !== 2) {
      throw new Error(`image-downloader 断言失败:失败不缓存,第二次调用应重新请求(计数 2),实际 ${srv404.getCount()}`);
    }

    // ---- 断言 7b:超时注入点——慢响应(200ms) + timeoutMs=50 → null(AbortSignal.timeout 生效) ----
    // 默认参数行为(10s)由断言 5/6 覆盖,此处只验证注入的短超时确实中止慢响应。
    srvSlow = await startServer(200, fixtureBytes, 200);
    const slowUrl = `http://127.0.0.1:${srvSlow.port}/slow.png`;
    if ((await localResolver(50)(slowUrl)) !== null) {
      throw new Error("image-downloader 断言失败:慢响应应被 50ms 超时中止并返回 null");
    }
    if (srvSlow.getCount() !== 1) {
      throw new Error(`image-downloader 断言失败:超时场景应请求 1 次,实际 ${srvSlow.getCount()}`);
    }

    // ---- 断言 8:缓存随实例隔离(每文档新建实例 → 同 URL 重新下载) ----
    const other = localResolver();
    const o = await other(url);
    if (!o || !o.equals(fixtureBytes)) {
      throw new Error("image-downloader 断言失败:新实例同 URL 应重新下载成功");
    }
    // srv200 至此累计 2 次:首次下载 1 次 + 新实例重新下载 1 次(同实例内去重未新增)
    if (srv200.getCount() !== 2) {
      throw new Error(`image-downloader 断言失败:新实例应新增 1 次请求,实际 ${srv200.getCount()}`);
    }
  } finally {
    if (srv200) await closeServer(srv200.server);
    if (srv404) await closeServer(srv404.server);
    if (srvSlow) await closeServer(srvSlow.server);
  }

  // ---- 断言 9:连接拒绝(server 已关闭)→ null(opt-in 放行私网,排除拦截干扰,
  //   确保失败原因确为连接拒绝而非私网过滤) ----
  const refused = await localResolver()(`http://127.0.0.1:${port}/x.png`);
  if (refused !== null) {
    throw new Error("image-downloader 断言失败:连接拒绝应返回 null");
  }

  // ---- 断言 10:缺失检查并入 resolver 失败路径(单次 IO),统一警告文案 ----
  // convert 层 stat 预扫已移除:docx 侧经 imageToDocx 失败路径、pdf 侧经
  // checkLocalImages,均走本 resolver 返回 null → 警告统一为「图片加载失败: <src>」。
  const { convert } = await import("../../dist/core/convert.js");
  const wMissing = [];
  await convert("![缺图](missing-xxx.png)", "docx", {
    baseDir: FIXTURES_DIR,
    imageResolver: createImageResolver(FIXTURES_DIR),
    warnings: wMissing,
  });
  if (!wMissing.some((w) => formatWarning(w).includes("图片加载失败:") && formatWarning(w).includes("missing-xxx.png"))) {
    throw new Error("image-downloader 断言失败:缺失本地图片应产生统一「图片加载失败:」警告");
  }
  const wOk = [];
  await convert("![有图](./g1-tiny.png)", "docx", {
    baseDir: FIXTURES_DIR,
    imageResolver: createImageResolver(FIXTURES_DIR),
    warnings: wOk,
  });
  if (wOk.length !== 0) {
    throw new Error(`image-downloader 断言失败:存在的本地图片不应产生警告,实际 ${wOk.join(";")}`);
  }

  console.log("[ok] image-downloader:本地/远程读取、失败兜底、并发去重、失败不缓存(重试)、超时注入与 MR-3 私网默认拦截断言通过");
  await saveArtifact("image-downloader", { png: fixtureBytes });
}
