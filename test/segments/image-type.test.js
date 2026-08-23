/**
 * image-type.ts 三函数单测(R8 收尾批 1 C1;R2 抽取、R4 修复核心的回归锚):
 * - sniffImageType:PNG/JPEG/GIF/WEBP 魔数判定;B3 起未知/数据不足 → null
 *   (不再伪装 png,由调用方跳过嵌入并警告);
 * - imageSizeFromBuffer:PNG(IHDR offset 16/20)/JPEG(SOF 扫描)像素尺寸,
 *   畸形/无 SOF/尺寸为 0 → null(docx 等比缩放数据源);
 * - mimeFromBuffer:data URL 用 MIME;B3 起未知 → null(调用方按失败降级)。
 * 全部断言基于可构造的最小文件头 bytes(静态构造,零 IO、零 fixture 文件)。
 */
import {
  imageSizeFromBuffer,
  mimeFromBuffer,
  sniffImageType,
} from "../../dist/core/image/image-type.js";

/** 构造最小 PNG 文件头(签名 + 长度 + IHDR 块;仅前 24 字节,尺寸位于 offset 16/20) */
function pngHeader(width, height) {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG 签名
  buf.writeUInt32BE(13, 8); // IHDR 块长(实际 13,函数不校验)
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * 构造最小 JPEG 文件头:SOI(FF D8)+ APP0 段 + SOF0 段。
 * SOF0 段:FF C0 | 段长 00 11(2+1+2+2+3*3) | 精度 08 | height | width | 3 分量×3。
 */
function jpegHeader(width, height) {
  const parts = [];
  parts.push(Buffer.from([0xff, 0xd8])); // SOI
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10])); // APP0 标记 + 段长 16
  parts.push(Buffer.from("JFIF\0".padEnd(14, "\0"), "ascii")); // 14 字节数据
  const sof = Buffer.alloc(2 + 17);
  sof[0] = 0xff;
  sof[1] = 0xc0; // SOF0
  sof.writeUInt16BE(17, 2); // 段长 17 = 2 长度 + 1 精度 + 2 高 + 2 宽 + 9 分量
  sof[4] = 8; // 精度
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);
  return Buffer.concat(parts);
}

/** 断言辅助:统一报错格式(与 slug 段同风格) */
function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} 断言失败: ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
  }
}

/** image-type.ts 三函数单测 */
export async function run() {
  // ---------- sniffImageType:魔数判定 + 未知/截断回退 ----------
  assertEq(sniffImageType(pngHeader(10, 10)), "png", "sniff PNG");
  assertEq(sniffImageType(jpegHeader(10, 10)), "jpg", "sniff JPEG");
  assertEq(
    sniffImageType(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    "gif",
    "sniff GIF",
  );
  assertEq(
    sniffImageType(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "ascii")),
    "webp",
    "sniff WEBP",
  );
  // B3:未知与数据不足 → null(不伪装 png,由调用方跳过嵌入 + 警告)
  assertEq(sniffImageType(Buffer.from("hello")), null, "sniff 未知 → null");
  assertEq(sniffImageType(Buffer.alloc(0)), null, "sniff 空数据 → null");
  assertEq(sniffImageType(Buffer.from([0x89, 0x50])), null, "sniff 截断魔数 → null");
  console.log("[ok] sniffImageType:PNG/JPEG/GIF/WEBP 判定 + 未知/截断 → null(B3)断言通过");

  // ---------- imageSizeFromBuffer:PNG(IHDR)/JPEG(SOF) 尺寸解析 ----------
  const pngSize = imageSizeFromBuffer(pngHeader(320, 240));
  assertEq(pngSize?.width, 320, "PNG width(IHDR offset 16)");
  assertEq(pngSize?.height, 240, "PNG height(IHDR offset 20)");

  const jpgSize = imageSizeFromBuffer(jpegHeader(640, 480));
  assertEq(jpgSize?.width, 640, "JPEG width(SOF 扫描)");
  assertEq(jpgSize?.height, 480, "JPEG height(SOF 扫描)");

  // 尺寸为 0 → null(宽度/高度均需 > 0)
  assertEq(imageSizeFromBuffer(pngHeader(0, 100)), null, "PNG width=0 → null");
  // 无 SOF(仅 SOI + EOI)→ null
  assertEq(imageSizeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null, "JPEG 无 SOF → null");
  // 非标记起始的畸形数据 → null
  assertEq(
    imageSizeFromBuffer(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00])),
    null,
    "JPEG 畸形数据 → null",
  );
  // 非 PNG/JPEG(如 GIF)→ null
  assertEq(
    imageSizeFromBuffer(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    null,
    "GIF 不支持尺寸解析 → null",
  );
  // 数据不足(不足 24 字节的 PNG 头)→ null
  assertEq(imageSizeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null, "PNG 数据不足 → null");
  console.log("[ok] imageSizeFromBuffer:PNG/JPEG 尺寸解析 + 零尺寸/无 SOF/畸形/类型不符 → null 断言通过");

  // ---------- mimeFromBuffer:data URL 用 MIME,B3 起未知 → null ----------
  assertEq(mimeFromBuffer(pngHeader(10, 10)), "image/png", "mime PNG");
  assertEq(mimeFromBuffer(jpegHeader(10, 10)), "image/jpeg", "mime JPEG");
  assertEq(
    mimeFromBuffer(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    "image/gif",
    "mime GIF",
  );
  assertEq(
    mimeFromBuffer(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "ascii")),
    "image/webp",
    "mime WEBP",
  );
  assertEq(mimeFromBuffer(Buffer.from("hello")), null, "mime 未知 → null");
  console.log("[ok] mimeFromBuffer:四类 MIME 判定 + 未知 → null(B3)断言通过");
}
