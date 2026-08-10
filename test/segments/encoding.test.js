/**
 * 编码预检段:UTF-8 无 BOM / UTF-8 BOM / UTF-16LE BOM / GBK 解码与标记。
 * 来源:scripts/make-batch4-sample.mjs 第 401-425 行「段 8」断言原样复制(纯函数段,无产物)。
 * decodeMarkdown 规则:UTF-8 BOM / UTF-16LE BOM 剥离;无 BOM 严格 UTF-8 校验,
 * 失败按 GBK/GB18030 解码并标记 encoding="gbk"(调用方据此追加警告文案)。
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
  const utf16Bom = decodeMarkdown(
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文正文", "utf16le")]),
  );
  if (utf16Bom.encoding !== "utf-8" || !utf16Bom.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:UTF-16LE BOM 未正确解码");
  }
  const gbkBuf = iconv.encode("GBK 中文正文 hello", "gbk");
  const gbk = decodeMarkdown(gbkBuf);
  if (gbk.encoding !== "gbk" || !gbk.text.includes("中文正文")) {
    throw new Error("编码预检断言失败:GBK 文件未按 gb18030 解码/标记");
  }
  console.log("[ok] 编码预检:UTF-8(无 BOM/带 BOM)/UTF-16LE/GBK 解码与标记全部正确");
}
