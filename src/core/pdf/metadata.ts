/**
 * PDF Info 元数据注入(frontmatter → PDF 文档属性)。
 * 纯逻辑、零 Electron 依赖,便于单元测试;pdf-lib 负责解析/重存。
 */
import { PDFDocument } from "pdf-lib";
import type { DocMetadata } from "../pipeline/frontmatter.js";

/** 解析 frontmatter 日期字符串为 Date("YYYY-MM-DD" 或 ISO);失败返回 undefined */
function parseDate(text: string): Date | undefined {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * PDF Info 元数据注入(frontmatter → PDF 文档属性)。
 * 仅注入非空字段;title 缺失不注入。
 * B3:date 解析失败不再静默兜底当前时间(错误日期会误导归档/检索),
 * 保持不注入创建时间。无任何字段实际注入时原样返回,不做无谓重存。
 */
export async function setPdfMetadata(pdf: Uint8Array, metadata: DocMetadata | undefined): Promise<Uint8Array> {
  if (!metadata) return pdf;
  const doc = await PDFDocument.load(pdf);
  let touched = false;
  if (metadata.title) {
    doc.setTitle(metadata.title);
    touched = true;
  }
  if (metadata.author) {
    doc.setAuthor(metadata.author);
    touched = true;
  }
  if (metadata.date) {
    const created = parseDate(metadata.date);
    if (created) {
      doc.setCreationDate(created);
      doc.setModificationDate(new Date());
      touched = true;
    }
  }
  if (touched) return new Uint8Array(await doc.save());
  return pdf;
}
