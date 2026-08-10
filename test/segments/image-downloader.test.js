/**
 * 图片解析器段(src/main/image-downloader.ts 纯逻辑层,不起 Electron 窗口):
 * - 本地读取:path.resolve(baseDir, src) 相对/绝对路径均读文件,缺失与 data: 等非 http → null
 * - http 下载:200 成功返回内容一致的 Buffer;404 / 连接拒绝 → null
 * - 同 URL 缓存:实例内成功与失败均缓存去重(并发只请求一次),实例间隔离
 * 超时分支(10s 硬编码 AbortSignal.timeout,无注入点)与 index.ts 模块私有
 * resolverCache(跨 baseDir 共享)无法低成本自动化,未覆盖原因见验收报告。
 * http server 生命周期 try/finally 保证清理(closeAllConnections 防 keep-alive 挂起)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createImageResolver } from "../../dist/main/image-downloader.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { saveArtifact } from "../common/artifacts.js";

const PNG_PATH = path.join(FIXTURES_DIR, "g1-tiny.png");

/** 启动本地 http server:固定 status + body 响应,getCount() 返回请求次数 */
function startServer(status, body) {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    res.writeHead(status, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
    res.end(body);
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

  // ---- http server 生命周期:try/finally 保证清理 ----
  let srv200 = null;
  let srv404 = null;
  let port = 0;
  try {
    srv200 = await startServer(200, fixtureBytes);
    port = srv200.port;
    srv404 = await startServer(404, Buffer.from("NOPE"));
    const resolver = createImageResolver("");
    const url = `http://127.0.0.1:${port}/img.png`;

    // ---- 断言 5:http 200 下载成功,内容一致 ----
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

    // ---- 断言 7:非 2xx(404)→ null,且失败结果也缓存(第二次不重试) ----
    const url404 = `http://127.0.0.1:${srv404.port}/missing.png`;
    if ((await resolver(url404)) !== null) {
      throw new Error("image-downloader 断言失败:404 应返回 null");
    }
    if ((await resolver(url404)) !== null) {
      throw new Error("image-downloader 断言失败:404 缓存后再次调用仍应返回 null");
    }
    if (srv404.getCount() !== 1) {
      throw new Error(`image-downloader 断言失败:404 缓存后应仍只请求 1 次,实际 ${srv404.getCount()}`);
    }

    // ---- 断言 8:缓存随实例隔离(每文档新建实例 → 同 URL 重新下载) ----
    const other = createImageResolver("");
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
  }

  // ---- 断言 9:连接拒绝(server 已关闭)→ null ----
  const refused = await createImageResolver("")(`http://127.0.0.1:${port}/x.png`);
  if (refused !== null) {
    throw new Error("image-downloader 断言失败:连接拒绝应返回 null");
  }

  console.log("[ok] image-downloader:本地/远程读取、失败兜底、并发去重与失败缓存断言通过");
  await saveArtifact("image-downloader", { png: fixtureBytes });
}
