/**
 * 批注验收(批次 11):行内 `[锚定文本]{批注=内容}` → docx 批注。
 * 断言 comments.xml 部件存在、commentRangeStart/End/Reference 结构、锚定文本
 * 保留、批注内容(含 rich 加粗/链接)存在、多批注 id 唯一、author 固定;
 * 表格单元格内批注生效;链接与 {#eq:label} 语法不受影响;pdf 路线原样输出。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { zipContains, unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 主样例:正文/表格单元格批注 + rich 内容 + 既有语法回归(链接、{#eq:label}) */
const commentMd = `# 批注测试

正文段落包含[锚定文本]{批注=这是批注内容}与后续文字。

第二个批注[加粗锚定]{批注=内容含**加粗**与[链接](https://example.com)}。

| 列一 | 列二 |
| --- | --- |
| 单元格[批注]{批注=单元格批注} | 普通 |

[普通链接](https://example.com)与[文本]{#eq:label}不受影响。
`;
export const fixtures = { main: commentMd };

/** 批注验收(批次 11) */
export async function run() {
  const docxArtifact = await convert(commentMd, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
  });
  // docx 断言:comments.xml 部件必须存在(库对空容器也生成,有批注时必有内容)
  const commentsOk = zipContains(docxArtifact.buffer, "word/comments.xml");
  if (!commentsOk) {
    throw new Error("docx 部件断言失败: comments.xml 不存在");
  }
  console.log("[ok] docx 批注:comments.xml 部件存在");

  // 批注内容断言(comments.xml):文本 / rich 加粗 / 链接 / author 固定
  const commentsXml = await unzipPart(docxArtifact.buffer, "word/comments.xml");
  if (!commentsXml.includes("这是批注内容")) {
    throw new Error("批注内容断言失败: comments.xml 缺少批注内容文本");
  }
  if (!commentsXml.includes("单元格批注")) {
    throw new Error("批注内容断言失败: comments.xml 缺少表格单元格批注内容");
  }
  if (!commentsXml.includes("<w:b/>")) {
    throw new Error("批注 rich 断言失败: comments.xml 缺少加粗 run(w:b)");
  }
  // 链接:comments.xml 内为超链接 run(文本),目标 URL 在 comments.xml.rels
  if (!commentsXml.includes("<w:hyperlink")) {
    throw new Error("批注 rich 断言失败: comments.xml 缺少超链接 run");
  }
  const commentsRels = await unzipPart(docxArtifact.buffer, "word/_rels/comments.xml.rels");
  if (!commentsRels.includes('Target="https://example.com"')) {
    throw new Error("批注 rich 断言失败: comments.xml.rels 缺少链接目标");
  }
  if (!commentsXml.includes('w:author="markdown-to-word"')) {
    throw new Error("批注 author 断言失败: comments.xml 缺少固定 author");
  }
  console.log("[ok] 批注内容:文本/加粗/链接/固定 author 存在");

  // 批注结构断言(document.xml):commentRangeStart/End/Reference + 锚定文本保留
  const documentXml = await unzipPart(docxArtifact.buffer, "word/document.xml");
  if (!documentXml.includes("<w:commentRangeStart")) {
    throw new Error("批注结构断言失败: document.xml 缺少 commentRangeStart");
  }
  if (!documentXml.includes("<w:commentRangeEnd")) {
    throw new Error("批注结构断言失败: document.xml 缺少 commentRangeEnd");
  }
  if (!documentXml.includes("<w:commentReference")) {
    throw new Error("批注结构断言失败: document.xml 缺少 commentReference");
  }
  if (!documentXml.includes("锚定文本")) {
    throw new Error("锚定文本断言失败: document.xml 缺少锚定文本");
  }
  // 多批注 id 唯一(正文 2 + 表格 1 = 3 个 commentRangeStart)
  const ids = [...documentXml.matchAll(/<w:commentRangeStart w:id="(\d+)"/g)].map((m) => m[1]);
  if (ids.length < 3) {
    throw new Error(`批注数量断言失败: 期望 3 个批注,实际 ${ids.length}`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("批注 id 唯一性断言失败: commentRangeStart id 重复");
  }
  // 既有语法回归:普通链接仍为超链接(文本保留),{#eq:label} 行内原样文本
  if (!documentXml.includes("普通链接")) {
    throw new Error("回归断言失败: 普通链接文本丢失");
  }
  if (!documentXml.includes("[文本]{#eq:label}")) {
    throw new Error("回归断言失败: {#eq:label} 行内语法被批注解析误伤");
  }
  console.log(`[ok] 批注结构:${ids.length} 个批注 id 唯一,锚定文本保留,链接/{#eq:label} 回归通过`);

  // pdf 路线:markdown-it 不解析批注语法,原样输出
  const pdfArtifact = await convert(commentMd, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
  });
  if (!pdfArtifact.html.includes("[锚定文本]{批注=这是批注内容}")) {
    throw new Error("pdf 原样断言失败: 批注语法被解析或丢失");
  }
  console.log("[ok] pdf 路线:批注语法原样输出(不解析)");

  await saveArtifact("comments", { docx: docxArtifact.buffer });
}