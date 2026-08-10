/**
 * PDF 侧工具:printToPDF 封装(与主进程 renderPdf 链路对齐)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow } from "electron";

/** printToPDF 工具:写临时 html → 隐藏窗口加载 → 打印 → 清理 */
export async function htmlToPdf(html, footerTemplate) {
  const htmlPath = path.join(os.tmpdir(), `m2w-accept-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  let output;
  try {
    await fs.writeFile(htmlPath, html, "utf8");
    await win.loadFile(htmlPath);
    output = await win.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate,
    });
  } finally {
    win.destroy();
    await fs.rm(htmlPath, { force: true });
  }
  return output;
}
