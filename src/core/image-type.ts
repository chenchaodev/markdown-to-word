/** 依据文件魔数判断图片类型(docx ImageRun 接受 png/jpg/gif/bmp/svg) */
export function sniffImageType(data: Buffer): "png" | "jpg" | "gif" {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
    return "jpg";
  }
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "gif";
  }
  return "png";
}
