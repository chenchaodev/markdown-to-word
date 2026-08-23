/**
 * 编码预检段:UTF-8 无 BOM / UTF-8 BOM / UTF-16LE BOM / UTF-16BE BOM / GBK 解码与标记。
 * decodeMarkdown 规则:UTF-8 / UTF-16(LE+BE)BOM 剥离;无 BOM 严格 UTF-8 校验,
 * 失败按 GBK/GB18030 解码并标记 encoding="gbk"(调用方据此追加警告文案)。
 * B3:UTF-16 LE/BE 的 encoding 字段如实返回 "utf-16"(此前 LE 失真为 "utf-8");
 * BE 此前不识别,落 gb18030 分支产生乱码。
 */
import iconv from "iconv-lite";
import { decodeMarkdown } from "../../dist/core/encoding.js";

export async function run() {
  const utf8NoBom = decodeMarkdown(Buffer.from("中文正文 hello", "utf8"));
  if (utf8NoBom.encoding !== "utf-8" || !utf8NoBom.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:无 BOM UTF-8 未正确解码/标记");
  }
  const utf8Bom = decodeMarkdown(
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("中文正文", "utf8")]),
  );
  if (utf8Bom.encoding !== "utf-8" || utf8Bom.text.includes("\uFEFF")) {
    throw new Error("编码预检断言失败:UTF-8 BOM 未剥离");
  }
  const utf16leBom = decodeMarkdown(
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文正文", "utf16le")]),
  );
  if (utf16leBom.encoding !== "utf-16" || !utf16leBom.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:UTF-16LE BOM 未正确解码/标记(B3:utf-16)");
  }
  // B3:UTF-16 BE(FE FF)此前不识别 → gb18030 乱码;现按 utf16-be 解码
  // (iconv encode 可能自带 BOM,拼接后即便双 BOM 也只影响首字符前的 U+FEFF)
  const utf16beBom = decodeMarkdown(
    Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("中文正文", "utf16-be")]),
  );
  if (utf16beBom.encoding !== "utf-16" || !utf16beBom.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:UTF-16BE BOM 未正确解码/标记(B3 新增)");
  }
  const gbkBuf = iconv.encode("GBK 中文正文 hello", "gbk");
  const gbk = decodeMarkdown(gbkBuf);
  if (gbk.encoding !== "gbk" || !gbk.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:GBK 文件未按 gb18030 解码/标记");
  }
  console.log("[ok] 编码预检:UTF-8(无 BOM/带 BOM)/UTF-16LE/UTF-16BE/GBK 解码与标记全部正确");
}
