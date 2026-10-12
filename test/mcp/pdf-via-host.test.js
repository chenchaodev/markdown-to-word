// @ts-check
/**
 * MCP 的 pdf 路径真实验收(位于 test/mcp/,镜像 `src/mcp/tools.ts` 的 pdf 分支与
 * `src/convert/pdf-host-launch.ts` 的拉起机制)。
 *
 * **为什么必须派生纯 node 子进程**:pdf 经打印宿主子进程执行,而本段跑在 Electron 宿主里
 * —— 在其中再拉起一个 Electron 会嵌套(同 `test/cli/pdf-launch.test.js` 头注记的坑:
 * 实测整段超时 180s 被硬终止)。`server.test.js` 那种「本进程直调」的做法因此**证明不了
 * pdf 路径**:它验的是 docx 那个零 Electron 的分支。
 *
 * **本段同时是「MCP 两帧握手」的真实验收**:派生 `node dist/mcp/index.js`,经 stdin 送进
 * 两帧(`initialize` + `tools/call`),从 stdout 收回两帧。之所以派子进程而不是 `pump()`
 * 注入内存流:握手那一面要验的正是「**真实 stdio 客户端**能不能把本工具调起来」,
 * 注入 PassThrough 绕过了进程边界(它证明不了 stdout 分帧在真实管道下成立)。
 *
 * 覆盖:
 * - 两帧握手:initialize 回协议版本与 tools 能力;tools/call 回结构化结果
 * - **pdf 真产出**:魔数 `%PDF-` + 非空 + 落盘路径逐字
 * - `degraded` 在 pdf 路径上的形态:**恒为空**(core 的 pdf 分支不产该事实,见
 *   `core/convert.ts` 的 `DocxArtifact.mermaidDegraded` ②),而人读文案必须把这件事
 *   对 agent 点名 —— 否则「degraded 为空」会被读成「没有 mermaid」
 * - 非法 format 在**协议层**同样走 tool 结果(isError)而非 JSON-RPC error
 */

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**mcp**,但**判据静态看不见本层主体** ——
 * 被测的 `dist/mcp/index.js` 与 `dist/convert/pdf-host-launch.js` 都由派生**纯 node
 * 子进程**经 `spawnSync` 以 stdio 协议驱动(入口路径 `path.join(ROOT, "dist", "mcp",
 * "index.js")` 逐段拼出,不在 import 语句位置),段内零 mcp import。故按 L4 的第三条
 * 正当出路:`covers` 声明它测的是本层。
 */
export const covers = [
  "src/mcp/index.ts",
  "src/mcp/tools.ts",
  "src/convert/pdf-host-launch.ts",
];

/** 本段自造最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头 */
export const fixtures = null;

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../harness/paths.js";
import { resolveNode } from "../harness/node-exec.js";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("mcp/pdf-via-host");

/**
 * 跑一次真实 MCP server:送入若干帧,收回帧数组。
 *
 * `ELECTRON_RUN_AS_NODE` 显式删掉:带着它连 electron.exe 都能当 node 用,那样就证明不了
 * 「不经 electron 直调 mcp 入口」。理由同 `test/cli/options.test.js` 同一处。
 *
 * @param {Record<string, unknown>[]} requests 按 JSON-RPC 逐行送入的帧
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function callServer(requests) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(resolveNode(), [path.join(ROOT, "dist", "mcp", "index.js")], {
    cwd: ROOT,
    input: `${requests.map((r) => JSON.stringify(r)).join("\n")}\n`,
    encoding: "utf8",
    windowsHide: true,
    env,
    // pdf 路径含一次 Electron 冷启动 + printToPDF(实测秒级),上限给足,
    // 免得「机器慢」被误报成「deadline 掐了」
    timeout: 180000,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** @param {string} raw @returns {any[]} */
function parseFrames(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** pdf 魔数:PDF 文件以 `%PDF-` 开头 */
const PDF_MAGIC = "%PDF-";

export async function run() {
  const suite = createCaseSuite();
  const { path: dir } = createTempResource({ label: "mcp-pdf" });
  // 清理留在 run() 顶层:进了 case 的话,case 失败会先抛、finally 不执行,临时目录泄漏
  try {
    const withMermaid = path.join(dir, "含图.md");
    fs.writeFileSync(
      withMermaid,
      ["# 含图", "", "正文一段。", "", "```mermaid", "graph TD; A-->B;", "```", ""].join("\n"),
      "utf8",
    );

    // 一、两帧握手:initialize + tools/call(format=pdf)
    const out = path.join(dir, "握手.pdf");
    const handshake = callServer([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "convert_markdown", arguments: { input: withMermaid, outputPath: out, format: "pdf" } } },
    ]);
    const frames = parseFrames(handshake.stdout);
    const init = frames.find((f) => f.id === 1);
    const call = frames.find((f) => f.id === 2);
    const structured = call?.result?.structuredContent;

    await suite.case("两帧握手:initialize 回协议与能力,tools/call 回结构化结果", () => {
      assert(handshake.code === 0, `server 应正常退出,实际退出码 ${handshake.code};stderr=${handshake.stderr.slice(-300)}`);
      // 断言落在**帧数**上:多一帧就说明 stdout 上混进了非协议字节(诊断误写 stdout)
      assert(frames.length === 2, `应恰好回两帧,实际 ${frames.length}(stdout 上多一个字节就是一帧解析失败)`);
      assert(init?.result?.protocolVersion === "2025-06-18", "initialize 应回声明的协议版本");
      assert(init?.result?.capabilities?.tools !== undefined, "initialize 应声明 tools 能力");
      assert(call?.result?.isError !== true, `pdf 转换不应报错:${JSON.stringify(call?.result?.content)}`);
      assert(structured?.artifacts?.length === 1, `pdf 应产出一个产物,实际 ${structured?.artifacts?.length}`);
    });

    await suite.case("pdf 真产出:魔数 %PDF-、非空、逐字落到 outputPath", () => {
      const artifact = structured.artifacts[0];
      assert(artifact.format === "pdf", `产物应回报 format=pdf,实际 ${artifact.format}`);
      assert(artifact.outputPath === out, `应逐字落盘到 outputPath,实际 ${artifact.outputPath}`);
      assert(fs.existsSync(out), `产物应存在,实际不存在:${out}`);
      const bytes = fs.statSync(out).size;
      assert(bytes > 1000, `产物不应是空壳(实际 ${bytes} 字节)`);
      const head = fs.readFileSync(out).subarray(0, PDF_MAGIC.length).toString("latin1");
      assert(head === PDF_MAGIC, `pdf 魔数应为 ${PDF_MAGIC},实际 ${JSON.stringify(head)}`);
    });

    // 降级契约在 pdf 路径下的形态:结构化字段恒空(事实不存在),但**人读文案必须点名**
    await suite.case("pdf 的 degraded 恒为空,且人读文案点名这一事实", () => {
      const artifact = structured.artifacts[0];
      assert(
        artifact.degraded.length === 0 && structured.degraded.length === 0,
        `pdf 路径的 degraded 应恒为空,实际 ${JSON.stringify(structured.degraded)}`,
      );
      const text = call.result.content[0].text;
      assert(
        text.includes("mermaid"),
        `pdf 的人读文案须点明「mermaid 按代码块渲染、degraded 不报告」,否则 agent 会把 degraded 为空读成「没有 mermaid」。实际:${text}`,
      );
    });

    // 非法 format 在协议层同样走 tool 结果 —— 逐字核对它**不是** JSON-RPC error
    const bad = callServer([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "convert_markdown", arguments: { input: withMermaid, format: "epub" } } },
    ]);
    const badCall = parseFrames(bad.stdout).find((f) => f.id === 2);
    await suite.case("非法 format 经协议层回 isError(不是 JSON-RPC error)", () => {
      assert(badCall?.error === undefined, `业务失败不该走 JSON-RPC error,实际 ${JSON.stringify(badCall?.error)}`);
      assert(badCall?.result?.isError === true, "非法 format 应回 isError 的 tool 结果");
      const text = badCall.result.content[0].text;
      assert(text.includes("docx") && text.includes("pdf"), `报错须列出可用取值,实际:${text}`);
    });

    console.log(
      "[ok] mcp/pdf-via-host:MCP 两帧握手 + pdf 真产出通过(%PDF- 魔数 / 逐字落盘 / "
      + "pdf 的 degraded 恒为空且人读文案点名 / 非法 format 走 isError)",
    );
  } finally {
    removeTree(dir);
  }
  return { cases: suite.results };
}