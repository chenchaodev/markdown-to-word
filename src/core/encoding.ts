/**
 * markdown 文件文本解码(批次 7「体验优化」;纯函数、无 IO、无 Electron,可单测)。
 * 规则:
 * - BOM 嗅探:UTF-8 BOM / UTF-16 LE BOM 剥离后按对应编码解码(Windows 记事本另存场景)
 * - 无 BOM:严格 UTF-8 校验(TextDecoder fatal),失败按 GBK/GB18030 解码
 *   (iconv-lite 的 gb18030 是 GBK 超集,GBK 文件按 gb18030 解码无损)
 * 调用方按返回的 encoding 决定是否追加「已按 GBK 编码读取」警告。
 */
import iconv from "iconv-lite";

export interface DecodeResult {
  text: string;
  /** "utf-8" = 标准 UTF-8(含 BOM 剥离);"gbk" = 按 GBK/GB18030 解码 */
  encoding: "utf-8" | "gbk";
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function decodeMarkdown(buf: Buffer): DecodeResult {
  // UTF-8 BOM(EF BB BF)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8" };
  }
  // UTF-16 LE BOM(FF FE)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString("utf16le"), encoding: "utf-8" };
  }
  try {
    return { text: STRICT_UTF8.decode(buf), encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(buf, "gb18030"), encoding: "gbk" };
  }
}
