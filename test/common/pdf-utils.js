// @ts-check
/**
 * PDF 侧工具:printToPDF 封装(与主进程 renderPdf 链路对齐)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow } from "electron";
import { removeFile } from "./temp-resource.js";

/** printToPDF 工具:写临时 html → 隐藏窗口加载 → 打印 → 清理
 * @param {string} html 待打印的完整 HTML
 * @param {string} footerTemplate 页脚模板(printToPDF 原样注入)
 * @returns {Promise<Buffer>} PDF 字节
 */
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
    // 走 removeFile:窗口刚销毁、Windows 上 HTML 句柄可能尚未释放(EBUSY/EPERM),
    // 助手带退避重试 + 删后复查,删不掉即抛(不静默留在系统临时区)
    const outcome = removeFile(htmlPath);
    if (!outcome.ok) throw new Error(`临时 PDF HTML 清理失败:${htmlPath}:${outcome.error?.message ?? ""}`);
  }
  return output;
}
