/**
 * 最小 JSON-RPC 2.0 over stdio 传输(换行分隔 JSON,MCP 规范的 stdio 形态)。
 *
 * 为什么手写而不引官方 SDK:本项目只暴露**一个** tool,协议面窄到只有
 * `initialize` / `tools/list` / `tools/call` / `ping` 四个方法 + 一条
 * `notifications/initialized`。SDK 会带进 ajv / zod / express / hono / jose
 * 一整条 HTTP 中间件链(为将来可能的 HTTP/SSE 传输准备),而 stdio 传输用不到
 * 其中任何一项 —— 那是纯体积与升级面。协议细节少 ⇒ 自己持有反而更可控。
 *
 * 机制层不含任何本项目的领域概念(不知道 docx 是什么、不知道 mermaid)。
 * 工具目录与转换语义在 tools.ts,入口接线在 index.ts。
 *
 * 三条硬约定(均为踩过的坑,改前先读):
 * 1. **一行一个 JSON**。写入用 `process.stdout.write(line + "\n")` 单次调用,
 *    不分多次 write —— 分片写会被对端读到半行 JSON。
 * 2. **stdout 只进协议**。任何日志/诊断必须走 stderr:stdout 上多一个字节
 *    就是一帧解析失败。写入端不做缓冲 flush 时序控制,靠「单次 write + 行结束符」。
 * 3. **notification 不回响应**。MCP 的 `notifications/*` 没有 id,回了就是协议错。
 */

/** JSON-RPC 2.0 错误码(本项目用到的子集;官方码表见 JSON-RPC 2.0 spec §5.1)。 */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

/** 一条请求(有 id ⇒ 要回响应;无 id ⇒ notification,不回)。 */
export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** 工具目录项(与 MCP 的 Tool 形状同构,字段名刻意保持协议原样)。 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 工具调用的结果。`isError: true` 表示「业务失败」而非协议失败 —— 见 callTool 注释。 */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** 结构化结果(与 content 并存:给 agent 的是文本,给程序的是这个)。 */
  structuredContent?: unknown;
}

/** 处理器注册面:方法名 → 处理函数。返回 undefined 表示「这是 notification,不回响应」。 */
export type RpcHandlers = {
  [method: string]: (params: unknown) => Promise<unknown> | undefined;
};

/**
 * 把请求分派到处理器并产出**响应帧**(notification 返回 undefined)。
 *
 * 错误一律折成 JSON-RPC error 帧而非抛错:抛错会终止整个 server,
 * 而 MCP 客户端期望的是「这一条请求失败、其余继续」。
 */
export async function dispatch(
  request: RpcRequest,
  handlers: RpcHandlers,
): Promise<unknown | undefined> {
  const handler = handlers[request.method];
  if (handler === undefined) {
    // 方法不存在时**仍要回帧**(除非它是 notification):否则客户端会一直等这条 id
    if (request.id === undefined || request.id === null) return undefined;
    return errorFrame(request.id, RPC_METHOD_NOT_FOUND, `未知方法:${request.method}`);
  }
  try {
    const result = await handler(request.params);
    // notification(id 缺席):处理完不回任何东西
    if (request.id === undefined || request.id === null) return undefined;
    return { jsonrpc: "2.0", id: request.id, result: result ?? {} };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.id === undefined || request.id === null) return undefined;
    return errorFrame(request.id, RPC_INTERNAL_ERROR, message);
  }
}

function errorFrame(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** 校验一条解析结果是否像 JSON-RPC 请求;不像则给出协议层错误帧。 */
export function asRequest(parsed: unknown): RpcRequest | { error: [number, string] } {
  if (typeof parsed !== "object" || parsed === null) {
    return { error: [RPC_INVALID_REQUEST, "请求不是对象"] };
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string") {
    return { error: [RPC_INVALID_REQUEST, "缺 jsonrpc:\"2.0\" 或 method"] };
  }
  return candidate as unknown as RpcRequest;
}

/**
 * 起一个 stdio server:逐行读 stdin → 分派 → 逐行写 stdout。
 *
 * @param input 读端(默认 process.stdin)
 * @param output 写端(默认 process.stdout)
 * @param handlers 方法注册面
 * @returns 停止函数(正常情况下用不到:server 生命周期与进程同寿)
 */
export function serveStdio(
  handlers: RpcHandlers,
  // 形参用宽松的 NodeJS.*Stream 而非 Readable/Writable:默认值 process.stdin 的类型是
  // ReadStream & { fd: 0 },拿它当注解会让调用方无法注入 PassThrough(测试正是要注入)。
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): () => void {
  let pending: Promise<void> = Promise.resolve();
  let buffer = "";

  const write = (frame: unknown): void => {
    if (frame === undefined) return;
    output.write(`${JSON.stringify(frame)}\n`);
  };

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === "") return; // 空行是正常的分帧噪声(尤其经 Windows 管道时)
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      write(errorFrame(null, RPC_PARSE_ERROR, "JSON 解析失败"));
      return;
    }
    const request = asRequest(parsed);
    if ("error" in request) {
      write(errorFrame(null, request.error[0], request.error[1]));
      return;
    }
    // 串行化:同一时刻只有一条请求在飞。stdio 传输没有并发原语,而 MCP 的
    // tools/call 会真的做 IO —— 不串行化就会让两个转换交叉写 stdout 帧。
    pending = pending.then(async () => write(await dispatch(request, handlers)));
  };

  input.setEncoding("utf8");
  const onData = (chunk: string | Buffer): void => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newlineAt = buffer.indexOf("\n");
    while (newlineAt !== -1) {
      handleLine(buffer.slice(0, newlineAt));
      buffer = buffer.slice(newlineAt + 1);
      newlineAt = buffer.indexOf("\n");
    }
  };
  input.on("data", onData);
  return () => input.off("data", onData);
}
