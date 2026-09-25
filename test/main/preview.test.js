/**
 * 预览入口主进程回归：GBK 准备 warning 必须进入明确的主进程 warning sink，
 * 且不把预览打开流程变成未处理异常。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { openPreviewWindow, previews } from "../../dist/main/windows/preview.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`preview 断言失败:${msg}`);
}

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-preview-"));
  const originalWarn = console.warn;
  const warnings = [];
  try {
    const mdPath = path.join(dir, "gbk-preview.md");
    await fs.writeFile(mdPath, iconv.encode("# 你好世界\n\n正文\n", "gbk"));
    console.warn = (...args) => warnings.push(args.join(" "));
    const result = await openPreviewWindow(mdPath);
    assert(result.ok, `GBK 预览打开失败:${result.error ?? ""}`);
    assert(
      warnings.some((message) => message.includes("[preview]") && message.includes("GBK")),
      `预览编码 warning 未进入主进程 warning sink:${JSON.stringify(warnings)}`,
    );
  } finally {
    console.warn = originalWarn;
    for (const entry of [...previews]) entry.win.destroy();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
