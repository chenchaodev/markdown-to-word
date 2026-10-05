/**
 * MCP server 入口(进程外交付面,ADR-060):`node dist/mcp/index.js`。
 *
 * 本文件只做接线,不含判定逻辑:
 * - 方法面在 jsonrpc.ts(传输机制)、tool 目录与转换在 tools.ts(领域语义)。
 *
 * 为什么跑**纯 node** 而不上 Electron:MCP 只暴露 docx,而 docx 走纯 node 已实测可行
 * (CLI 整个 docx 面就是纯 node)。上 Electron 要付两笔账 —— ① 协议通道就是 stdio,
 * 而 Electron 子进程的 stdout 接到管道时会在帧前多吐一个 `\r\n`(Chromium 噪声);
 * ② `electron` 是 devDependency 不在 PATH,客户端配置里写 `electron <path>` 只在开发
 * 检出里成立。将来 MCP 要 pdf 时也不必改这一点:pdf 是**能力**不是进程形态,复用
 * CLI 已建成的机制(纯 node 侧写任务文件 → spawn `dist/main/cli-pdf-host.js` → 读结果
 * 文件)即可。详见 `docs/evidence/20261004-000218-多层交付面总规划原文.md`「修复项复测 · 2026-10-03 · 步序 3 开工前」。
 */
import { serveStdio, type RpcHandlers, type RpcRequest } from "./jsonrpc.js";
import { callConvertMarkdown, TOOL_NAME, TOOL_SPEC } from "./tools.js";

/**
 * MCP 协议版本:跟随当前规范(2025-06-18 引入 tool annotations,本工具不用 annotations,
 * 但版本号要与 `initialize` 声明一致,否则部分客户端会拒绝握手)。
 */
const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "markdown-to-word", version: "1.0.0" };

/** 方法注册面。键即 MCP 方法名。 */
export function buildHandlers(): RpcHandlers {
  return {
    // 同步返回即可:RpcHandlers 允许返回值或 Promise,这里没有需要等待的 IO。
    initialize: () =>
      Promise.resolve({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      }),
    // notification:无 id ⇒ dispatch 不回帧(见 jsonrpc.ts 硬约定 3)
    "notifications/initialized": () => undefined,
    ping: () => Promise.resolve({}),
    "tools/list": () => Promise.resolve({ tools: [TOOL_SPEC] }),
    "tools/call": (params: unknown) => callTool(params),
  };
}

async function callTool(params: unknown): Promise<unknown> {
  const args = (params ?? {}) as Record<string, unknown>;
  const name = args.name;
  if (name !== TOOL_NAME) {
    throw new Error(`未知 tool:${String(name)}(本 server 只提供 ${TOOL_NAME})`);
  }
  return callConvertMarkdown(args.arguments);
}

/** 起 server 并挂上 stdio。返回停止函数(正常用不到:server 与进程同寿)。 */
export function startServer(): () => void {
  const stop = serveStdio(buildHandlers());
  // 诊断一律走 stderr:stdout 上多一个字节就是一帧解析失败(见 jsonrpc.ts 硬约定 2)。
  process.stderr.write(`[mcp] markdown-to-word server 已启动(stdio,只提供 ${TOOL_NAME})\n`);
  return stop;
}

/**
 * 入口守卫:被 import(测试直调 buildHandlers / startServer)时不接管进程生命周期。
 *
 * 判据取 basename —— 编译产物与源文件同名不同扩展(.ts / .js),两种形态都要能直接执行。
 */
const entryArg = (process.argv[1] ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
if (entryArg === "index.js" || entryArg === "index.ts") {
  startServer();
}

/** 供测试断言协议常量与 server 信息(避免常量散落在断言里)。 */
export const __internals = { PROTOCOL_VERSION, SERVER_INFO } satisfies {
  PROTOCOL_VERSION: string;
  SERVER_INFO: { name: string; version: string };
};

export type { RpcRequest };
