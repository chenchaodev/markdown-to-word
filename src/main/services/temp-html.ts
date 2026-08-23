/**
 * 临时 HTML 文件生命周期(预览/打印共用,R8 批 3 L6):
 * 原内联逻辑在 converter.ts renderPdf 与 index.ts openPreviewWindow 各自一份,
 * 提炼为写文件 + 清理 一对操作。清理失败(如仍被 Chromium 占用)仅记录,不阻断。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 写入临时 HTML(os.tmpdir,命名 m2w-{pid}-{time}-{rand}.html),返回路径与清理函数。
 * 注意:调用方须在窗口 closed/销毁路径上调用 cleanup,避免残留。
 */
export async function writeTempHtml(
  html: string,
): Promise<{ htmlPath: string; cleanup: () => Promise<void> }> {
  const htmlPath = path.join(
    os.tmpdir(),
    `m2w-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`,
  );
  await fs.writeFile(htmlPath, html, "utf8");
  return {
    htmlPath,
    cleanup: async () => {
      await fs.rm(htmlPath, { force: true }).catch(() => undefined);
    },
  };
}
