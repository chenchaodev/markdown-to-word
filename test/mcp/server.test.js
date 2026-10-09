// @ts-check
/**
 * MCP 交付面验收(位于 test/mcp/,镜像顶层树 src/mcp;ADR-060):
 *
 * 被测主体 = dist/mcp/jsonrpc.js(传输机制)+ dist/mcp/tools.js(tool 目录与转换)
 * + dist/mcp/index.js(方法面与入口接线)。
 *
 * 为什么本段**在本进程直调**而不是派生 `node dist/mcp/index.js` 子进程:
 * MCP 这一面**零 electron**(门禁 `faces-no-host`),因此本进程(electron.exe 宿主)
 * 直调与真 node 直调走的是同一条代码路径,不需要再起子进程来证明「脱离宿主」——
 * 那是步序 2 的 CLI 段才需要的证据(m4)。
 * 同理,stdio 的分帧/串行化语义用 `PassThrough` 注入读写端即可覆盖,
 * 比起真子进程更快也更易断言(能逐帧检查写出的内容)。
 *
 * 覆盖:
 * - 传输:一行一帧 / 半包拼接 / 空行噪声 / 非法 JSON / 非法请求 / 未知方法 /
 *   handler 抛错 / notification 不回帧(这七条各自都会静默把协议搞坏)。
 * - tools:真 docx 产出(魔数)、**降级声明**(含 mermaid 必声明、不含则不声明)、
 *   pinOutputPath 逐字落盘且禁避让、业务失败走 isError 而非 JSON-RPC error。
 * - index:协议版本、tools/list 只暴露一个 tool、未知 tool 报错。
 */

// 本段无验收样例(输入是本段自造的最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import {
  asRequest,
  dispatch,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  serveStdio,
} from "../../dist/mcp/jsonrpc.js";
import { callConvertMarkdown, TOOL_NAME } from "../../dist/mcp/tools.js";
import { buildHandlers } from "../../dist/mcp/index.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("mcp");

/**
/** docx 魔数:OOXML 是 ZIP 容器(PK\x03\x04) */
/** @param {string} filePath */
function isDocxMagic(filePath) {
  const head = fs.readFileSync(filePath).subarray(0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * 起一对内存读写端,喂入若干「chunk」后收集写出帧。
 *
 * **必须 await**:分派是异步的(串行化链 `pending = pending.then(...)`),写帧发生在
 * 微任务里。同步读完会拿到 0 帧 —— 那不是 bug 是读早了,故这里显式等一个宏任务。
 *
 * @param {string[]} chunks 按 chunk 边界切分的输入(用于制造半包/多包)
 * @param {Record<string, (params: unknown) => Promise<unknown> | undefined>} handlers
 * @returns {Promise<{ frames: any[], raw: string }>}
 */
async function pump(chunks, handlers) {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = "";
  output.on("data", (chunk) => {
    raw += chunk.toString("utf8");
  });
  // 转型理由:本段 typecheck 的是 **dist 的纯 JS**,tsc 从形参默认值 process.stdin 反推出
  // ReadStream & { fd: 0 },无法接受 PassThrough。src 侧签名已是 NodeJS.ReadableStream。
  serveStdio(handlers, /** @type {any} */ (input), /** @type {any} */ (output));
  for (const chunk of chunks) input.write(chunk);
  input.end();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    frames: raw
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line)),
    raw,
  };
}

/** 极简成功 handler(机制层断言够用即可,不牵扯领域)。 */
const okHandler = () => Promise.resolve({ pong: true });

export async function run() {
  const suite = createCaseSuite();
  // ================= 一、传输层(纯机制) =================
  {
    // 1a. 一行一帧:两帧进、两个响应出
    await suite.case("一行一帧:两帧进两个响应出且不串行错序", async () => {
      const { frames } = await pump(
        [
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "m" })}\n`,
          `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "m" })}\n`,
        ],
        { m: okHandler },
      );
      assert(frames.length === 2, `两帧应回两个响应,实际 ${frames.length}`);
      assert(frames[0].id === 1 && frames[0].result.pong === true, "首个响应应带 id=1 与 result");
      assert(frames[1].id === 2, "第二个响应应带 id=2(串行化不得错序)");
    });

    // 1b. 半包:一帧被拆成三个 chunk 送入,仍应拼回一帧
    await suite.case("跨 chunk 的半包拼成完整一帧", async () => {
      const line = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "m" });
      const { frames } = await pump([line.slice(0, 5), line.slice(5, 11), `${line.slice(11)}\n`], { m: okHandler });
      assert(frames.length === 1 && frames[0].id === 7, "跨 chunk 的半包应拼成完整一帧");
    });

    // 1c. 空行噪声(Windows 管道常见)不得产生帧
    await suite.case("空行噪声不产生响应帧", async () => {
      const line = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "m" });
      const { frames } = await pump([`\r\n\n${line}\n\n`], { m: okHandler });
      assert(frames.length === 1, `空行不得产生响应帧,实际 ${frames.length}`);
    });

    // 1d. 非法 JSON → parse error(id 为 null,客户端无法归属)
    await suite.case("非法 JSON 回 parse error 且 id 为 null", async () => {
      const { frames } = await pump(["{不是 json}\n"], { m: okHandler });
      assert(frames.length === 1 && frames[0].error.code === RPC_PARSE_ERROR, "非法 JSON 应回 parse error");
      assert(frames[0].id === null, "无法归属的解析失败,id 应为 null");
    });

    // 1e. 合法 JSON 但不是 JSON-RPC 请求 → invalid request
    await suite.case("非请求对象回 invalid request", async () => {
      const { frames } = await pump([`${JSON.stringify({ hello: "world" })}\n`], { m: okHandler });
      assert(frames.length === 1 && frames[0].error.code === RPC_INVALID_REQUEST, "非请求对象应回 invalid request");
    });

    // 1f. 未知方法 → method not found;有 id 才回帧
    await suite.case("未知方法:有 id 才回 method not found 帧", async () => {
      const { frames } = await pump(
        [
          `${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "no/such" })}\n`,
          `${JSON.stringify({ jsonrpc: "2.0", method: "no/such" })}\n`,
        ],
        { m: okHandler },
      );
      assert(frames.length === 1, `未知方法两条输入只应回一帧(第二条是 notification),实际 ${frames.length}`);
      assert(frames[0].error.code === RPC_METHOD_NOT_FOUND, "有 id 的未知方法应回 method not found");
    });

    // 1g. handler 抛错 → internal error 帧,**不终止 server**(后续帧仍要能处理)
    await suite.case("handler 抛错:信息透传且不终止 server", async () => {
      const { frames } = await pump(
        [
          `${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "boom" })}\n`,
          `${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "m" })}\n`,
        ],
        {
          boom: () => Promise.reject(new Error("炸了")),
          m: okHandler,
        },
      );
      assert(frames.length === 2, "handler 抛错后 server 仍应处理后续帧");
      assert(frames[0].error.message.includes("炸了"), "抛错信息应透传到 error.message");
      assert(frames[1].result.pong === true, "出错之后的请求应正常返回");
    });

    // 1h. notification 一律不回帧(回了就是协议错)
    await suite.case("notification 不回任何帧", async () => {
      const { frames } = await pump(
        [
          `${JSON.stringify({ jsonrpc: "2.0", method: "m" })}\n`,
          `${JSON.stringify({ jsonrpc: "2.0", method: "m", params: { x: 1 } })}\n`,
        ],
        { m: okHandler },
      );
      assert(frames.length === 0, `notification 不得回任何帧,实际 ${JSON.stringify(frames)}`);
    });

    // 1i. asRequest 的形状判据(负向锚点:别让脏输入绕过校验)
    // 四条负向各自独立(一种判红不该掩盖其余三条),故与正向分列
    await suite.case("asRequest 负向:null / 数组 / 版本错 / 缺 method 皆非请求", () => {
      assert("error" in asRequest(null), "null 不是请求");
      assert("error" in asRequest([1, 2]), "数组不是请求");
      assert("error" in asRequest({ jsonrpc: "1.0", method: "m" }), "jsonrpc 版本错不是请求");
      assert("error" in asRequest({ jsonrpc: "2.0", id: 1 }), "缺 method 不是请求");
    });
    await suite.case("asRequest 正向:合规请求通过校验", () => {
      assert(!("error" in asRequest({ jsonrpc: "2.0", id: 1, method: "m" })), "正常请求应通过校验");
    });

    // 1j. 输出侧:每帧一次 write 且以换行收尾(分片写会被对端读到半行 JSON)
    await suite.case("输出侧:一帧一行且以换行收尾", async () => {
      const { raw } = await pump([`${JSON.stringify({ jsonrpc: "2.0", id: 8, method: "m" })}\n`], { m: okHandler });
      assert(raw.endsWith("\n"), "写出的帧必须以换行收尾");
      assert(raw.indexOf("\n") === raw.length - 1, "一帧只应占一行(不得分片写)");
    });

    console.log("[ok] mcp:传输层直测通过(一帧一行 / 跨 chunk 半包 / 空行噪声 / 非法 JSON / 非法请求 / 未知方法 / handler 抛错不终止 server / notification 不回帧 / 请求形状校验)");
  }

  // ================= 二、入口方法面 =================
  {
    const handlers = buildHandlers();
    // 三次 dispatch 的结果供下列 case 共用
    const init = /** @type {any} */ (await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize" }, handlers));
    const list = /** @type {any} */ (await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" }, handlers));
    // 未知 tool → JSON-RPC 层错误(不是业务失败:业务失败走 isError,见 tools.ts 错误形态)
    const unknown = /** @type {any} */ (
      await dispatch({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "no_such_tool" } }, handlers)
    );
    await suite.case("initialize 声明协议版本、tools 能力与 serverInfo", () => {
      assert(typeof init.result.protocolVersion === "string" && init.result.protocolVersion.length > 0, "initialize 应声明协议版本");
      assert(init.result.capabilities.tools !== undefined, "initialize 应声明 tools 能力");
      assert(typeof init.result.serverInfo.name === "string", "initialize 应给出 serverInfo");
    });
    await suite.case("tools/list 只暴露一个 tool 且 inputSchema 必填 input", () => {
      assert(list.result.tools.length === 1, `本 server 只暴露一个 tool,实际 ${list.result.tools.length}`);
      assert(list.result.tools[0].name === TOOL_NAME, `tool 名应为 ${TOOL_NAME}`);
      assert(list.result.tools[0].inputSchema.required.includes("input"), "inputSchema 应把 input 列为必填");
    });
    await suite.case("未知 tool 回 JSON-RPC error", () => {
      assert(unknown.error !== undefined, "未知 tool 应回 JSON-RPC error");
    });
  }

  // ================= 三、tool 真实转换 =================
  const { path: dir } = createTempResource({ label: "mcp" });
  // 清理留在 run() 顶层:进了 case 的话,case 失败会先抛、finally 不执行,临时目录泄漏
  try {
    const withMermaid = path.join(dir, "含图.md");
    const plain = path.join(dir, "无图.md");
    fs.writeFileSync(
      withMermaid,
      ["# 含图", "", "正文。", "", "```mermaid", "graph TD; A-->B;", "```", ""].join("\n"),
      "utf8",
    );
    fs.writeFileSync(plain, ["# 无图", "", "纯文字。", ""].join("\n"), "utf8");

    // 3a. 正常转换:魔数 + 结构化字段
    // 转换结果供下列 case 引用(每次转换代价高,不逐 case 重跑)
    const ok = await callConvertMarkdown({ input: withMermaid });
    const structured = /** @type {any} */ (ok.structuredContent);
    await suite.case("正常转换:不报错、产出一个真 docx、带耗时与人读文本", () => {
      assert(ok.isError !== true, `正常转换不应报错:${JSON.stringify(ok.content)}`);
      assert(structured.artifacts.length === 1, `应产出一个产物,实际 ${structured.artifacts.length}`);
      assert(isDocxMagic(structured.artifacts[0].outputPath), "产物魔数应为 ZIP/OOXML");
      assert(typeof structured.elapsedMs === "number", "应带耗时");
      assert(Array.isArray(ok.content) && /** @type {any} */ (ok.content[0]).type === "text", "应同时给人读文本");
    });

    // 3b. **降级必须可见**:含 mermaid 必声明,不含则不声明
    await suite.case("降级可见:含 mermaid 必声明(结构化 / 逐产物 / 人读文案)", () => {
      assert(structured.degraded.includes("mermaid"), "含 mermaid 的文档必须在 degraded 里点名 mermaid");
      assert(structured.artifacts[0].degraded.includes("mermaid"), "降级也应逐产物点名");
      assert(/** @type {any} */ (ok.content[0]).text.includes("mermaid"), "人读文案也须点名降级,不能只在结构化字段里");
    });
    await suite.case("降级不误报:不含 mermaid 的文档不声明降级", async () => {
      const plainResult = await callConvertMarkdown({ input: plain });
      const plainStructured = /** @type {any} */ (plainResult.structuredContent);
      assert(
        plainStructured.degraded.length === 0,
        `不含 mermaid 的文档不该声明降级,实际 ${JSON.stringify(plainStructured.degraded)}`,
      );
    });

    // 3c. pinOutputPath:逐字落盘 + 禁避让(不得产出「名 (2).docx」)
    await suite.case("pinOutputPath 逐字落盘且禁避让", async () => {
      const pinned = path.join(dir, "钉住.docx");
      const pinOk = await callConvertMarkdown({ input: plain, outputPath: pinned });
      assert(pinOk.isError !== true, `钉死路径转换不应报错:${JSON.stringify(pinOk.content)}`);
      const pinStructured = /** @type {any} */ (pinOk.structuredContent);
      assert(pinStructured.artifacts[0].outputPath === pinned, "应逐字落盘到指定路径");
      const pinAgain = await callConvertMarkdown({ input: plain, outputPath: pinned });
      assert(pinAgain.isError === true, "路径已存在必须报错而不是改名");
      assert(
        !fs.existsSync(path.join(dir, "钉住 (2).docx")),
        "禁避让语义下不得产出「钉住 (2).docx」",
      );
    });

    // 3d. 目录输入:递归收集,降级取并集
    await suite.case("目录输入:两个 md 各产一个产物、降级取并集", async () => {
      const dirResult = await callConvertMarkdown({ input: dir });
      const dirStructured = /** @type {any} */ (dirResult.structuredContent);
      assert(dirStructured.artifacts.length === 2, `目录内两个 md 应各产一个,实际 ${dirStructured.artifacts.length}`);
      assert(dirStructured.degraded.includes("mermaid"), "目录输入的降级应取并集");
    });

    // 3e. 业务失败一律 isError(不是 JSON-RPC error):模型要看得见才能改参数重试
    // 七类入参各自独立(一种判红不该掩盖其余六种),故逐类一个 case
    for (const [args, label] of [
      [{ input: "C:/绝对不存在的路径.md" }, "路径不存在"],
      [{ input: plain, outputPath: path.join(dir, "钉住.docx"), template: "no-such-preset" }, "未知预设"],
      [{ input: dir, outputPath: path.join(dir, "x.docx") }, "多输入配 outputPath"],
      [{ input: "相对路径.md" }, "非绝对路径"],
      [{}, "缺 input"],
      [{ input: 42 }, "input 非字符串"],
      [[1, 2], "入参不是对象"],
    ]) {
      await suite.case(`业务失败走 isError 且带人读文案:${label}`, async () => {
        const failed = await callConvertMarkdown(args);
        assert(failed.isError === true, `${label}应走 isError 结果`);
        assert(/** @type {any} */ (failed.content[0]).text !== "", `${label}的 isError 结果须带人读文案`);
      });
    }

    // 3f. 未知预设的报错要带可选清单(否则 agent 无法自我纠正)
    await suite.case("未知预设的报错列出可用预设 id", async () => {
      const badTemplate = await callConvertMarkdown({ input: plain, template: "no-such-preset" });
      assert(/** @type {any} */ (badTemplate.content[0]).text.includes("paper"), "未知预设的报错应列出可用预设 id");
    });

    console.log("[ok] mcp:tool 真实转换通过(真 docx 魔数 / 降级声明含与不含两种形态 / pinOutputPath 逐字落盘且禁避让 / 目录输入降级取并集 / 7 类业务失败一律 isError)");
  } finally {
    removeTree(dir);
  }
  return { cases: suite.results };
}
