/**
 * 图片类型与尺寸判定(魔数读取,无 IO):
 * - sniffImageType:docx ImageRun 用类型(png/jpg/gif/webp);未知字节头返回
 *   null(不再伪装 png——错误标签靠下游软件自行嗅探兜底,行为不可预期),
 *   由调用方跳过嵌入并警告;webp 由调用方降级
 * - imageSizeFromBuffer:PNG/JPEG 像素尺寸解析(docx 缩放用,其他/畸形数据返回 null)
 * - mimeFromBuffer:data URL 用 MIME(png/jpeg/gif/webp);未知返回 null,
 *   由调用方按失败降级(保留原链接 + 统一警告)
 */

/** 依据文件魔数判断图片类型;无法识别 → null(调用方跳过+警告,不伪装 png) */
export function sniffImageType(data: Buffer): "png" | "jpg" | "gif" | "webp" | null {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
    return "jpg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "gif";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * 从图片文件头解析像素尺寸(仅 PNG/JPEG;其他类型返回 null)。
 * PNG:IHDR 的 width(offset 16)/height(offset 20),均 > 0 才返回。
 * JPEG:从 offset 2 起扫描段找 SOF 标记(C0-C3/C5-C7/C9-CB/CD-CF);0x01(TEM)与
 * 0xD0-0xD7(RST)无长度字段直接继续;循环上限 128 次防畸形数据死循环,数据不足/无 SOF → null。
 * pos 语义:标记 FF 字节所在偏移(段长 = pos+2,SOF 的 height = pos+5,width = pos+7;
 * 循环内跳过 FF 填充后以段长字段为基准读取,偏移相对关系不变)。
 */
export function imageSizeFromBuffer(data: Buffer): { width: number; height: number } | null {
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let pos = 2;
    for (let i = 0; i < 128; i++) {
      if (pos + 4 > data.length) return null; // 至少需 FF + 标记 + 段长
      if (data[pos] !== 0xff) return null; // 非标记起始(畸形数据)
      while (pos < data.length && data[pos] === 0xff) pos++; // 跳过连续 FF 填充
      if (pos >= data.length) return null;
      const marker = data[pos++]!; // 上行 pos >= data.length 守卫保证取值在界内
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // TEM/RST 无长度字段
      if (pos + 2 > data.length) return null;
      const segLen = data.readUInt16BE(pos);
      if (segLen < 2) return null; // 段长含长度字段本身,至少 2 字节
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        if (pos + 7 > data.length) return null;
        const height = data.readUInt16BE(pos + 3);
        const width = data.readUInt16BE(pos + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      pos += segLen; // 跳过当前段(含 EOI 等):segLen 已含长度字段本身,此步落到下一标记 FF
    }
    return null; // 超出循环上限仍未找到 SOF
  }
  return null;
}

/** 魔数判断图片 MIME(data URL 用);无法识别 → null(调用方按失败降级) */
export function mimeFromBuffer(data: Buffer): string | null {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
    return "image/jpeg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
