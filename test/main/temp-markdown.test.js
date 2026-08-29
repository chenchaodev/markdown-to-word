/**
 * writeTempMarkdown 验收(主进程层;src/main/services/temp-html.ts 经
 * dist/main/services/temp-html.js):
 * - 写入指定文本 → 文件存在且内容一致;
 * - 扩展名为 .md;
 * - 临时文件留 os.tmpdir,本段验证后可清理(清理后文件消失)。
 * 样例放 os.tmpdir 独立文件,finally 清理,不污染 output/smoke。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writeTempMarkdown } from "../../dist/main/services/temp-html.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`temp-markdown 断言失败:${msg}`);
}

export async function run() {
  const sample = "# 标题\n\n正文内容 ${x} 与中文。\n";
  const { mdPath } = await writeTempMarkdown(sample);

  // ---- 1. 文件存在且扩展名为 .md ----
  assert(path.extname(mdPath) === ".md", `扩展名应为 .md,实际 ${path.extname(mdPath)}`);
  const stat = await fs.stat(mdPath);
  assert(stat.isFile(), "写入后文件不存在");

  // ---- 2. 内容一致(含中文与插值占位符,utf8 无损坏) ----
  const content = await fs.readFile(mdPath, "utf8");
  assert(content === sample, `内容不一致:实际 ${JSON.stringify(content)} 期望 ${JSON.stringify(sample)}`);
  console.log("[ok] temp-markdown:writeTempMarkdown 写入指定文本(存在/扩展名/内容一致)");

  // ---- 3. 清理后文件消失 ----
  await fs.rm(mdPath, { force: true });
  let gone = false;
  try {
    await fs.stat(mdPath);
  } catch {
    gone = true;
  }
  assert(gone, "清理后文件仍存在");
  console.log("[ok] temp-markdown:writeTempMarkdown 清理后文件消失");
}
