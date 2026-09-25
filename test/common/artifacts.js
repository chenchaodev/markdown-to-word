// @ts-check
/**
 * 验收产物落盘:成功路径写 output/artifacts/(按主题命名,无编号,新增无冲突);
 * 失败段写 output/artifacts/failures/<段名>/(失败日志 + 该段 buffer 快照),
 * 与成功路径目录分离,失败轮次不覆盖既有成功产物。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR, repoRelative, segmentFailureDir } from "./paths.js";

/**
 * @typedef {object} ArtifactBuffers 产物 buffer 集合
 * @property {Buffer} [docx]
 * @property {Buffer} [pdf]
 */

/**
 * @typedef {object} ArtifactSnapshot 待快照产物(形状同 case 契约的 attach 入参)
 * @property {string} name 产物名(不含扩展名)
 * @property {ArtifactBuffers} buffers
 */

/**
 * 把一组 buffer 写入目录(成功路径与失败快照共用同一落盘能力)。
 * @param {string} dir 目标目录(不存在则创建)
 * @param {string} name 产物名(不含扩展名)
 * @param {ArtifactBuffers} buffers 各格式产物
 * @returns {Promise<{ file: string, bytes: number }[]>} 实际写入的文件与字节数
 */
async function writeBuffers(dir, name, buffers) {
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const [ext, buf] of Object.entries(buffers)) {
    const file = path.join(dir, `${name}.${ext}`);
    await fs.writeFile(file, buf);
    written.push({ file, bytes: buf.length });
  }
  return written;
}

/**
 * 保存产物(成功路径)。
 * @param {string} name 主题名(如 "footnotes" → footnotes.docx/pdf)
 * @param {ArtifactBuffers} buffers 各格式产物
 */
export async function saveArtifact(name, buffers) {
  for (const { file, bytes } of await writeBuffers(ARTIFACTS_DIR, name, buffers)) {
    console.log(`    产物: ${path.basename(file)} (${bytes} bytes)`);
  }
}

/**
 * 落盘失败段产物:失败日志 + 该段已登记的 buffer 快照。
 * 目录 = output/artifacts/failures/<段名>/(每次落盘前清空该段目录,防上一轮残留
 * 快照被误读为本轮证据);不写成功路径目录,故失败不影响既有产物。
 * @param {string} segmentName 段名(如 segments/utils.test.js)
 * @param {{ log: string, buffers?: ArtifactSnapshot[] }} payload 失败日志正文与快照产物
 * @returns {Promise<{ dir: string, files: string[] }>} 目录与文件清单
 */
export async function saveFailureArtifacts(segmentName, { log, buffers = [] }) {
  const dir = segmentFailureDir(segmentName);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, "failure.log");
  await fs.writeFile(logPath, log, "utf8");
  const files = [logPath];
  for (const { name, buffers: snapshot } of buffers) {
    files.push(...(await writeBuffers(dir, name, snapshot)).map((f) => f.file));
  }
  console.log(`    失败产物: ${repoRelative(dir)} (${files.length} 个文件)`);
  return { dir, files };
}
