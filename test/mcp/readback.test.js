// @ts-check
/**
 * MCP 的 readback tool 验收(位于 test/mcp/,镜像顶层树 src/mcp;ADR-060):
 *
 * 被测主体 = dist/mcp/tools.js(第二个 tool 的规格与调用)+ dist/mcp/index.js
 * (tools/list 暴露面与按名分派)。
 *
 * 覆盖:
 * - **tools/list 列出两个 tool**,且既有 `convert_markdown` 的**名与形状逐字未变**
 *   (改名会打断已配置客户端 —— 那是本段要守住的契约);
 * - **readback_docx 真跑一次**:自家稿 .docx → 产出 .md、结构化结果带计数与三类清单、
 *   人读文本同样点名三类清单(只给结构化字段而人读文本不点名,agent 读文本时就看不到);
 * - **失败走 isError 而非 JSON-RPC error**:非 docx 字节 / 路径不存在 / 相对路径。
 *
 * 夹具在段内用 jszip 现造(不依赖 output/artifacts —— 那些是别的段的产物,段间无先后
 * 保证);本段跑在 Electron 宿主里直调(MCP 面零 electron,见 server.test.js 头注的同款理由)。
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildHandlers } from "../../dist/mcp/index.js";
import {
  callReadbackDocx,
  READBACK_TOOL_NAME,
  READBACK_TOOL_SPEC,
  TOOL_NAME,
} from "../../dist/mcp/tools.js";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

export const covers = ["src/mcp/tools.ts", "src/mcp/index.ts"];

export const meta = {
  description:
    "MCP readback tool:两个 tool 的暴露面(既有 tool 名与形状未变)+ readback_docx 真跑(结构化/文本/失败态)",
};

// 本段无验收样例(夹具在段内用 jszip 现造 .docx,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

const { assert } = createAsserter("mcp/readback");

/**
 * 自家稿形态的最小 .docx(标题 + 段落 + 粗体)。
 * @returns {Promise<Uint8Array>}
 */
async function buildDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="urn:w">` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>` +
      `</w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="urn:w" xmlns:r="urn:r"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>回读标题</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>正文段落</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** MCP readback tool 验收 */
export async function run() {
  const suite = createCaseSuite();

  // ---------- 一、暴露面 ----------
  await suite.case("tools/list 列出两个 tool,且既有 tool 的名与形状未变", async () => {
    const handlers = buildHandlers();
    const names = /** @type {any} */ (handlers["tools/list"]);
    const list = /** @type {{ tools: { name: string; inputSchema: { required?: string[] } }[] }} */ (
      await names()
    );
    const toolNames = list.tools.map((tool) => tool.name);
    assert(toolNames.includes(TOOL_NAME), `tools/list 应含既有 tool ${TOOL_NAME},实际 ${toolNames.join(",")}`);
    assert(toolNames.includes(READBACK_TOOL_NAME), `tools/list 应含 ${READBACK_TOOL_NAME},实际 ${toolNames.join(",")}`);
    assert(toolNames.length === 2, `本 server 应暴露两个 tool,实际 ${toolNames.length}`);
    const legacy = list.tools.find((tool) => tool.name === TOOL_NAME);
    assert(
      legacy !== undefined && (legacy.inputSchema.required ?? []).includes("input"),
      "既有 tool 的 inputSchema 必填项未变",
    );
  });
  await suite.case("readback tool 的规格据实写明能力与边界", () => {
    const spec = READBACK_TOOL_SPEC;
    assert(spec.name === READBACK_TOOL_NAME, "规格的 name 应与 tool 名一致");
    const description = spec.description;
    assert(description.includes("Markdown"), "描述应说明产物形态");
    assert(description.includes("批注"), "描述应点名不还原的类别(否则 agent 撞一次才发现)");
    assert(description.includes("公式"), "描述应点明公式的处理方式");
    assert((spec.inputSchema.required ?? []).includes("input"), "input 应是必填");
  });

  // ---------- 二、真跑一次 ----------
  const { path: dir } = createTempResource({ label: "mcp-readback" });
  try {
    const docxPath = path.join(dir, "样稿.docx");
    fs.writeFileSync(docxPath, await buildDocx());

    await suite.case("readback_docx 真跑:产出 .md、结构化结果带计数与三类清单", async () => {
      const result = await callReadbackDocx({ input: docxPath });
      assert(result.isError !== true, `正常回读不应报错:${JSON.stringify(result.content)}`);
      const structured = /** @type {any} */ (result.structuredContent);
      assert(typeof structured.markdownPath === "string", "结构化结果应给 .md 路径");
      assert(fs.existsSync(structured.markdownPath), "产出的 .md 应落盘");
      assert(structured.counts.headings === 1, `标题计数应为 1,实际 ${structured.counts.headings}`);
      assert(Array.isArray(structured.preserved) && structured.preserved.length > 0, "应带「会保真」清单");
      assert(Array.isArray(structured.notManaged) && structured.notManaged.length > 0, "应带「不接管」清单");
    });
    await suite.case("人读文本也点名三类清单(不只在结构化字段里)", async () => {
      const result = await callReadbackDocx({ input: docxPath });
      const text = /** @type {any} */ (result.content[0]).text;
      assert(text.includes("完整还原"), "人读文本应点名「完整还原」");
      assert(text.includes("不还原"), "人读文本应点名「不还原」的类别");
    });
    await suite.case("失败走 isError:非 docx 字节 / 路径不存在 / 相对路径", async () => {
      const broken = path.join(dir, "坏稿.docx");
      fs.writeFileSync(broken, Buffer.from([1, 2, 3]));
      for (const args of [
        { input: broken },
        { input: path.join(dir, "不存在.docx") },
        { input: "相对路径.docx" },
      ]) {
        const result = await callReadbackDocx(args);
        assert(result.isError === true, `失败形态应走 isError,实际 ${JSON.stringify(result)}`);
      }
    });
  } finally {
    await removeTree(dir);
  }

  console.log("[ok] mcp/readback:两个 tool 的暴露面 + readback_docx 真跑(结构化/文本/失败态)");
  return { cases: suite.results };
}
