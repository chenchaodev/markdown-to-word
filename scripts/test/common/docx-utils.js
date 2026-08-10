/**
 * docx(OOXML zip)解包与断言工具,零依赖(tar 解包)。
 */
import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/** zip 是明文中央目录:部件名以明文可搜索,无需解压即可断言部件存在 */
export function zipContains(buffer, partName) {
  return buffer.includes(Buffer.from(partName, "utf8"));
}

/** 解包 docx 并读取指定部件文本(tar 支持 zip;解包到临时目录后读取) */
export function unzipPart(buffer, partName) {
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "m2w-docx-"));
  try {
    const zipPath = path.join(tmpDir, "doc.docx");
    fsSync.writeFileSync(zipPath, buffer);
    execFileSync("tar", ["-xf", zipPath, "-C", tmpDir], { stdio: "ignore" });
    return fsSync.readFileSync(path.join(tmpDir, partName), "utf8");
  } finally {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  }
}
