/**
 * docx(OOXML zip)解包与断言工具。
 * B10b:解包统一 jszip 内存解析,删除系统 tar 路径(tar 依赖系统二进制 + 临时目录
 * 往返,Windows 下慢且行为随环境漂移);unzipPart 因此为 async(返回 Promise<string>)。
 */
import JSZip from "jszip";

/** zip 是明文中央目录:部件名以明文可搜索,无需解压即可断言部件存在 */
export function zipContains(buffer, partName) {
  return buffer.includes(Buffer.from(partName, "utf8"));
}

/** 解包 docx 并读取指定部件文本(jszip 内存解析);部件缺失抛错,由测试段断言失败路径承接 */
export async function unzipPart(buffer, partName) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file(partName);
  if (!entry) throw new Error(`docx 缺少部件: ${partName}`);
  return entry.async("string");
}
