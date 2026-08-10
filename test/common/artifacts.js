/**
 * 验收产物落盘:统一写入 output/test/artifacts/,按主题命名(无编号,新增无冲突)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "./paths.js";

/**
 * 保存产物。
 * @param {string} name 主题名(如 "footnotes" → footnotes.docx/pdf)
 * @param {{docx?: Buffer, pdf?: Buffer}} buffers 各格式产物
 */
export async function saveArtifact(name, buffers) {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  for (const [ext, buf] of Object.entries(buffers)) {
    const p = path.join(ARTIFACTS_DIR, `${name}.${ext}`);
    await fs.writeFile(p, buf);
    console.log(`    产物: ${path.basename(p)} (${buf.length} bytes)`);
  }
}
