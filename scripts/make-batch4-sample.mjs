/**
 * 生成二期批次 4「PDF 书签」验收样例:对批次 3 的 10 个 md 样例执行
 * 合并 → PDF(printToPDF)→ 书签注入,输出 output/批次4验收/01-简介-合并.pdf。
 * 链路与 GUI renderPdf 一致(convert → 临时 html → printToPDF → injectBookmarks)。
 * 用法: npx electron scripts/_tmp-batch4-accept.mjs(需已 build)
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "../dist/core/convert.js";
import { mergeMarkdowns } from "../dist/core/merge.js";
import { injectBookmarks, buildBookmarkTree } from "../dist/core/pdf/bookmarks.js";
import { extractHeadings } from "../dist/core/pdf/render.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output/批次3验收");
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output/批次4验收");

// 默认行为:所有窗口关闭即退出(在 printToPDF 窗口 destroy 后,后续写盘代码会中断);
// 显式挂空监听保持进程存活,由脚本末尾 app.quit() 收尾。
app.on("window-all-closed", () => {});

async function collectMarkdown(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(full)));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

app.whenReady().then(async () => {
  try {
    const mdFiles = (await collectMarkdown(root)).sort((a, b) => a.localeCompare(b));
    const inputs = await Promise.all(
      mdFiles.map(async (f) => ({ content: await fs.readFile(f, "utf8"), baseDir: path.dirname(f) })),
    );
    const mergedMd = mergeMarkdowns(inputs);
    const artifact = await convert(mergedMd, "pdf", {
      baseDir: root,
      title: "产品白皮书",
      warnings: [],
      pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
    });

    const htmlPath = path.join(os.tmpdir(), `m2w-accept-${process.pid}-${Date.now()}.html`);
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    let output;
    try {
      await fs.writeFile(htmlPath, artifact.html, "utf8");
      await win.loadFile(htmlPath);
      const data = await win.webContents.printToPDF({
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: artifact.footerTemplate,
      });
      const headings = extractHeadings(artifact.html);
      output = headings.length > 0 ? await injectBookmarks(new Uint8Array(data), buildBookmarkTree(headings)) : new Uint8Array(data);
      console.log(`[ok] 提取标题 ${headings.length} 条`);
    } finally {
      win.destroy();
      await fs.rm(htmlPath, { force: true });
    }
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, "01-简介-合并.pdf");
    await fs.writeFile(outPath, output);
    console.log(`[ok] 验收产物已生成: ${outPath} (${output.length} bytes)`);
  } catch (err) {
    console.error("[fail]", err);
    app.exit(1);
    return;
  }
  app.quit();
});
