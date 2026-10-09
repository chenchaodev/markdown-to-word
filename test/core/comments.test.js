// @ts-check
/**
 * 批注验收:行内 `[锚定文本]{批注=内容}` → docx 批注。
 * 断言 comments.xml 部件存在、commentRangeStart/End/Reference 结构、锚定文本
 * 保留、批注内容(含 rich 加粗/链接)存在、多批注 id 唯一、author 固定;
 * 表格单元格内批注生效;链接与 {#eq:label} 语法不受影响;pdf 路线原样输出。
 */
import { FIXTURES_DIR } from "../harness/paths.js";
import { zipContains, unzipPart } from "../harness/docx-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,判据静态看不见本段的主体 —— 全链路经
 * `test/harness/convert-helpers.js` 的 `convertWithFs` 到达 core,段内零 core import。
 *
 * 主体依据(头注 + import 图):头注写「批注验收:行内 `[锚定文本]{批注=内容}` → docx 批注」,
 * 断言全部落在 comments.xml / document.xml 的批注结构上。两处主体:
 * - `markdown/comment.ts` 是该语法的解析实现(头注描述的语法即其文件头的契约);
 * - `docx/handlers/content.ts` 的 `case "comment"` 是产出 commentRangeStart/End/Reference
 *   与批注容器收集的那一处(断言 1/2/3 逐条对它的输出下判)。
 *
 * 元素是仓库相对 POSIX 路径(判据直接对磁盘核对,且不引入段文件相对的位置耦合)。
 */
export const covers = [
  "src/core/markdown/comment.ts",
  "src/core/docx/handlers/content.ts",
];

/** 主样例:正文/表格单元格批注 + rich 内容 + 既有语法回归(链接、{#eq:label}) */
const commentMd = `# 批注测试

正文段落包含[锚定文本]{批注=这是批注内容}与后续文字。

第二个批注[加粗锚定]{批注=内容含**加粗**与[链接](https://example.com)}。

| 列一 | 列二 |
| --- | --- |
| 单元格[批注]{批注=单元格批注} | 普通 |

[普通链接](https://example.com)与[文本]{#eq:label}不受影响。
`;
export const meta = { description: "批注验收:行内 `[锚定文本]{批注=内容}` → docx 批注。" };
export const fixtures = { main: commentMd };

/** 批注验收 */
export async function run() {
  const suite = createCaseSuite();
  // docx 与 pdf 两份产物都在 case 之外备好:下面 13 条断言彼此独立,
  // 搬进 case 会让「哪份产物先转失败」也变成失败传播的载体
  const docxBuffer = docxBufferOf(
    await convertWithFs(commentMd, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: [],
    }),
  );
  const commentsXml = await unzipPart(docxBuffer, "word/comments.xml");
  const commentsRels = await unzipPart(docxBuffer, "word/_rels/comments.xml.rels");
  const documentXml = await unzipPart(docxBuffer, "word/document.xml");
  const pdfArtifact = asPdfArtifact(
    await convertWithFs(commentMd, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
    }),
  );

  // docx 断言:comments.xml 部件必须存在(库对空容器也生成,有批注时必有内容)
  await suite.case("docx 存在 comments.xml 部件", () => {
    if (!zipContains(docxBuffer, "word/comments.xml")) {
      throw new Error("docx 部件断言失败: comments.xml 不存在");
    }
  });
  console.log("[ok] docx 批注:comments.xml 部件存在");

  // 批注内容断言(comments.xml):文本 / rich 加粗 / 链接 / author 固定
  await suite.case("comments.xml 含批注内容文本", () => {
    if (!commentsXml.includes("这是批注内容")) {
      throw new Error("批注内容断言失败: comments.xml 缺少批注内容文本");
    }
  });
  await suite.case("comments.xml 含表格单元格批注内容", () => {
    if (!commentsXml.includes("单元格批注")) {
      throw new Error("批注内容断言失败: comments.xml 缺少表格单元格批注内容");
    }
  });
  await suite.case("comments.xml rich 含加粗 run(w:b)", () => {
    if (!commentsXml.includes("<w:b/>")) {
      throw new Error("批注 rich 断言失败: comments.xml 缺少加粗 run(w:b)");
    }
  });
  // 链接:comments.xml 内为超链接 run(文本),目标 URL 在 comments.xml.rels
  await suite.case("comments.xml rich 含超链接 run", () => {
    if (!commentsXml.includes("<w:hyperlink")) {
      throw new Error("批注 rich 断言失败: comments.xml 缺少超链接 run");
    }
  });
  await suite.case("comments.xml.rels 含链接目标", () => {
    if (!commentsRels.includes('Target="https://example.com"')) {
      throw new Error("批注 rich 断言失败: comments.xml.rels 缺少链接目标");
    }
  });
  await suite.case("comments.xml 含固定 author", () => {
    if (!commentsXml.includes('w:author="markdown-to-word"')) {
      throw new Error("批注 author 断言失败: comments.xml 缺少固定 author");
    }
  });
  console.log("[ok] 批注内容:文本/加粗/链接/固定 author 存在");

  // 批注结构断言(document.xml):commentRangeStart/End/Reference + 锚定文本保留
  await suite.case("document.xml 含 commentRangeStart", () => {
    if (!documentXml.includes("<w:commentRangeStart")) {
      throw new Error("批注结构断言失败: document.xml 缺少 commentRangeStart");
    }
  });
  await suite.case("document.xml 含 commentRangeEnd", () => {
    if (!documentXml.includes("<w:commentRangeEnd")) {
      throw new Error("批注结构断言失败: document.xml 缺少 commentRangeEnd");
    }
  });
  await suite.case("document.xml 含 commentReference", () => {
    if (!documentXml.includes("<w:commentReference")) {
      throw new Error("批注结构断言失败: document.xml 缺少 commentReference");
    }
  });
  await suite.case("document.xml 保留锚定文本", () => {
    if (!documentXml.includes("锚定文本")) {
      throw new Error("锚定文本断言失败: document.xml 缺少锚定文本");
    }
  });
  // 多批注 id 唯一(正文 2 + 表格 1 = 3 个 commentRangeStart)
  // id 序列取数留在 case 之外:两条判定(数量、唯一性)读的是同一份 matchAll 结果
  const ids = [...documentXml.matchAll(/<w:commentRangeStart w:id="(\d+)"/g)].map((m) => m[1]);
  await suite.case("批注数量达标(正文 2 + 表格 1)", () => {
    if (ids.length < 3) {
      throw new Error(`批注数量断言失败: 期望 3 个批注,实际 ${ids.length}`);
    }
  });
  await suite.case("commentRangeStart id 唯一", () => {
    if (new Set(ids).size !== ids.length) {
      throw new Error("批注 id 唯一性断言失败: commentRangeStart id 重复");
    }
  });
  // 既有语法回归:普通链接仍为超链接(文本保留),{#eq:label} 行内原样文本
  await suite.case("回归:普通链接文本未丢失", () => {
    if (!documentXml.includes("普通链接")) {
      throw new Error("回归断言失败: 普通链接文本丢失");
    }
  });
  await suite.case("回归:{#eq:label} 行内语法未被批注解析误伤", () => {
    if (!documentXml.includes("[文本]{#eq:label}")) {
      throw new Error("回归断言失败: {#eq:label} 行内语法被批注解析误伤");
    }
  });
  console.log(`[ok] 批注结构:${ids.length} 个批注 id 唯一,锚定文本保留,链接/{#eq:label} 回归通过`);

  // pdf 路线:markdown-it 不解析批注语法,原样输出
  await suite.case("pdf 路线原样输出批注语法(不解析)", () => {
    if (!pdfArtifact.html.includes("[锚定文本]{批注=这是批注内容}")) {
      throw new Error("pdf 原样断言失败: 批注语法被解析或丢失");
    }
  });
  console.log("[ok] pdf 路线:批注语法原样输出(不解析)");

  await saveArtifact("comments", { docx: docxBuffer });
  return { cases: suite.results };
}