// @ts-check
/**
 * 测试用本地 http server 的「fetch 可拨端口」助手(单一来源)。
 *
 * 为何需要它:`listen(0)` 让 OS 随机分配端口,而本机实测该分配会落到 6491..7095
 * 这类低位窗口(不只在高端区),窗口里含 `fetch` **在拨号之前**就拒绝的 WHATWG bad port
 * 名单端口(实测 600 次采样命中 8 次,约 1.3%)。一旦命中,`fetch` 连一个包都不发 →
 * 真实 HTTP 客户端(`src/convert/image-downloader.ts` 的全局 fetch、
 * `gates/supply/supply/sca-audit.mjs` 的 `fetchImpl` 默认取全局 fetch)按契约归失败 →
 * 被测侧的「server 收到过请求」类断言恒为 0 而偶发红,且**不缩短任何等待也无重试可加**
 * (请求根本没出去,谈不上超时)。故凡是要让真实客户端连进来的测试 server,
 * 都得先避开这份名单。
 *
 * 只服务「端口会被真实 fetch 消费」的段。纯本进程自取自用的 server(只回显、
 * 只作计数、不建连)不受 bad port 影响,不必走这里 —— 见 `FETCH_BLOCKED_PORTS` 注释。
 *
 * 名单为本机实测扫描 1..65535 得出(逐端口 `fetch` 判定 cause 是否为 `bad port`,
 * 非名单端口落到 ECONNREFUSED)。换运行时若名单变了,重扫即可 —— 名单多一项只多
 * 一次重 listen(0),不会误判红;反过来名单漏了一项则表现为偶发红(正是本助手要挡的)。
 */

/**
 * `fetch` 在**拨号之前**就拒绝的端口(WHATWG Fetch 的 bad port 名单;Node 的全局 fetch
 * 据此拒连,抛 `TypeError: fetch failed`,cause 为 `bad port`)。
 */
export const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** 命中 blocked 名单时的重 listen(0) 次数上限:OS 连发不可 fetch 的端口属异常,超限即判红(不静默放过) */
export const MAX_PORT_ATTEMPTS = 16;

/**
 * 把 server 绑到 127.0.0.1 的随机端口,命中 blocked 名单就关掉重 listen(0),
 * 直到拿到 `fetch` 真会拨过去的端口。
 *
 * 重试复用同一个 `http.Server` 实例(实测 `close` 后可重新 `listen`,且 handler 仍
 * 挂在该实例上),故调用方的请求计数闭包不会因重试而丢失。
 * @param {import("node:http").Server} server 待监听的 server 实例(须已 createServer)
 * @param {string} label 调用段前缀(用于失败消息定位,不参与判定)
 * @returns {Promise<number>} 实际监听端口
 */
export function listenFetchablePort(server, label) {
  return new Promise((resolve, reject) => {
    // 监听器只挂一次:重试复用同一实例,每次 attempt 各挂一个会累积到 MaxListeners 警告
    server.once("error", reject);
    /** @param {number} attempt 已重试次数(0 = 首次 listen) */
    const listen = (attempt) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          reject(new Error(`${label}:本地 server 应已绑定 TCP 端口`));
          return;
        }
        if (FETCH_BLOCKED_PORTS.has(address.port)) {
          server.close((closeErr) => {
            if (closeErr) {
              reject(closeErr);
              return;
            }
            if (attempt + 1 >= MAX_PORT_ATTEMPTS) {
              reject(new Error(`${label}:连续 ${MAX_PORT_ATTEMPTS} 次随机端口都落在 fetch 拒连名单内`));
              return;
            }
            listen(attempt + 1);
          });
          return;
        }
        resolve(address.port);
      });
    };
    listen(0);
  });
}

/**
 * 关闭 server:closeAllConnections 强制断开 undici keep-alive 空闲连接,避免 close 回调挂起
 * @param {import("node:http").Server} server 服务实例
 * @returns {Promise<void>} close 回调落地即返回
 */
export function closeTestServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}
