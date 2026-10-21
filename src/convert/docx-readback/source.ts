/**
 * 回读源文件的读取:体积闸门 + 读字节。
 *
 * 为什么单独成文件(而不是在 cli 与 mcp 各写一份读盘):**闸门与读取是同一件事**,写两份
 * 就是两份阈值会漂 —— 而阈值漂移的后果是「某个交付面拦住了、另一个没拦住」,用户在
 * CLI 上传得进去、在 MCP 上传不进去,且两边都不报错。ADR-060 定了 cli 与 mcp 零依赖,
 * 共同依赖只能落在两层之下 ⇒ 本模块在 `src/convert/`(装配层)。
 *
 * 体积闸门复用 markdown 源文件那道(`MAX_SOURCE_FILE_BYTES`,32MB):理由同款 ——
 * 整篇进内存做解析,超过此量级单文件即可拖垮会话(MCP 侧是长驻 server,一次卡死
 * 会让后续所有 tool 排队)。32MB 远超正常文档。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_SOURCE_FILE_BYTES } from "../preprocess.js";

/**
 * 读一份待回读的 .docx 源文件(读前 stat 与读后长度双检,任一超限即拒绝)。
 *
 * @param filePath 源文件路径
 * @returns 文件字节
 * @throws 体积超限(带可读文案)或读不到(原样上抛,保留 errno 供调用方细分)
 */
export async function readDocxSource(filePath: string): Promise<Uint8Array> {
  let size: number | null = null;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    size = null; // 缺失/不可访问:交由 readFile 抛出原始错误码(错误文案依赖它)
  }
  if (size !== null && size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件体积超过上限(${(MAX_SOURCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB):${path.basename(filePath)}`,
    );
  }
  const data = await fs.readFile(filePath);
  if (data.length > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件体积超过上限(${(MAX_SOURCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB):${path.basename(filePath)}`,
    );
  }
  return new Uint8Array(data);
}
