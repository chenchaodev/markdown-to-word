/**
 * PDF Info 元数据注入(frontmatter → PDF 文档属性)。
 * 纯逻辑、零 Electron 依赖,便于单元测试;pdf-lib 负责解析/重存。
 */
import { PDFDocument } from "pdf-lib";
import type { DocMetadata } from "../frontmatter.js";

/** 解析 frontmatter 日期字符串为 Date("YYYY-MM-DD" 或 ISO);失败返回 undefined */
function parseDate(text: string): Date | undefined {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * PDF Info 元数据注入(frontmatter → PDF 文档属性)。
 * 仅注入非空字段;date 解析失败用当前时间兜底;title 缺失不注入。
 * 返回新 Buffer(Uint8Array),不修改入参。
 */
export async function setPdfMetadata(pdf: Uint8Array, metadata: DocMetadata | undefined): Promise<Uint8Array> {
  if (!metadata) return pdf;
  const doc = await PDFDocument.load(pdf);
  if (metadata.title) doc.setTitle(metadata.title);
  if (metadata.author) doc.setAuthor(metadata.author);
  if (metadata.date) {
    doc.setCreationDate(parseDate(metadata.date) ?? new Date());
    doc.setModificationDate(new Date());
  }
  if (metadata.title || metadata.author || metadata.date) {
    return new Uint8Array(await doc.save());
  }
  return pdf;
}
