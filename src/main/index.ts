import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert, type ConvertFormat } from "../core/convert.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    title: "Markdown 转换工具",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

/**
 * 转换实现:读取 md → core 注册表渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于 smoke 自测与未来 CLI 复用;进度经 onProgress 上报。
 * pdf 链路:core 产出 HTML → 写临时文件 → 隐藏窗口 loadFile → printToPDF。
 */
export async function convertImpl(
  filePath: string,
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
): Promise<{ outputPath: string }> {
  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new Error("仅支持 .md / .markdown 文件");
  }
  onProgress?.("read");
  const md = await fs.readFile(filePath, "utf8");

  onProgress?.("render");
  const artifact = await convert(md, format, {
    baseDir: path.dirname(filePath),
    title: path.basename(filePath).replace(/\.(md|markdown)$/i, ""),
    imageResolver: async (src: string) => {
      if (/^https?:\/\//.test(src)) return null;
      const p = path.resolve(path.dirname(filePath), src);
      return fs.readFile(p).catch(() => null);
    },
  });

  if (artifact.kind === "docx") {
    const outputPath = filePath.replace(/\.(md|markdown)$/i, ".docx");
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
    return { outputPath };
  }

  // pdf:临时 HTML → 隐藏窗口 printToPDF → 落盘
  const htmlPath = path.join(os.tmpdir(), `m2w-${process.pid}-${Date.now()}.html`);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    await fs.writeFile(htmlPath, artifact.html, "utf8");
    await printWin.loadFile(htmlPath);
    const data = await printWin.webContents.printToPDF({
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // 边距由 @page 控制(preferCSSPageSize)
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: artifact.footerTemplate,
    });
    const outputPath = filePath.replace(/\.(md|markdown)$/i, ".pdf");
    await fs.writeFile(outputPath, data);
    onProgress?.("done");
    return { outputPath };
  } finally {
    printWin.destroy();
    await fs.rm(htmlPath, { force: true });
  }
}

function registerIpc(): void {
  // 选择 markdown 文件
  ipcMain.handle("dialog:openMarkdown", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 Markdown 文件",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示
  ipcMain.handle("convert", async (event, filePath: string, format: ConvertFormat): Promise<ConvertResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (stage: string) => win?.webContents.send("convert:progress", { stage });
    try {
      const { outputPath } = await convertImpl(filePath, format, send);
      return { ok: true, outputPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

app.whenReady().then(async () => {
  registerIpc();
  const win = createWindow();
  // 渲染进程 console 错误转发到主进程输出(诊断用)
  win.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  if (SMOKE) {
    // 冒烟自测:构造样例 md → 走完整 convertImpl 链路 → 校验产物
    try {
      const outDir = path.join(__dirname, "..", "..", "output");
      const sampleMd = path.join(outDir, "g3-smoke.md");
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        sampleMd,
        "# 冒烟测试 中文标题\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n",
      );
      const { outputPath } = await convertImpl(sampleMd, "docx");
      const stat = await fs.stat(outputPath);
      console.log(`[smoke] convert ok: ${outputPath} (${stat.size} bytes)`);
      // G4:pdf 链路(中文/表格/代码块/任务列表/本地图片 → printToPDF)
      const pngPath = path.join(outDir, "g4-smoke.png");
      await fs.writeFile(
        pngPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      const pdfSampleMd = path.join(outDir, "g4-smoke.md");
      await fs.writeFile(
        pdfSampleMd,
        [
          "# G4 PDF 冒烟 中文标题",
          "",
          "| 列A | 列B |",
          "| --- | --- |",
          "| 你好 | world |",
          "",
          "```ts",
          "const x: number = 1;",
          "```",
          "",
          "- [x] 已完成项",
          "- [ ] 待办项",
          "",
          "~~删除线~~ 与 `行内代码`",
          "",
          "![本地图片](g4-smoke.png)",
          "",
        ].join("\n"),
      );
      const pdfResult = await convertImpl(pdfSampleMd, "pdf");
      const pdfStat = await fs.stat(pdfResult.outputPath);
      const pdfHead = (await fs.readFile(pdfResult.outputPath)).subarray(0, 5).toString("latin1");
      if (pdfHead !== "%PDF-") throw new Error(`PDF 魔数校验失败: ${pdfHead}`);
      console.log(`[smoke] pdf convert ok: ${pdfResult.outputPath} (${pdfStat.size} bytes)`);
    } catch (err) {
      console.error("[smoke] convert FAILED:", err);
      app.exit(1);
      return;
    }
    // renderer 侧诊断:window.api 是否注入、转换按钮是否可点、点击后状态区反馈
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 等页面加载
      const diag = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const report = { api: typeof window.api };
        const btn = document.getElementById("convertBtn");
        report.btnExists = !!btn;
        if (btn) {
          report.btnDisabledBefore = btn.disabled;
          btn.click();
          await sleep(50);
          const status = document.getElementById("status");
          report.statusAfterClick = status ? status.textContent : "";
          report.statusIsError = status ? status.classList.contains("status--error") : null;
        }
        // 防回归:完成弹窗启动时必须隐藏(曾因 CSS 特异性覆盖而失效)
        const dlg = document.getElementById("completeDialog");
        report.dialogExists = !!dlg;
        report.dialogHiddenAtStart = dlg ? dlg.classList.contains("hidden") : null;
        report.dialogVisibleAtStart = dlg ? getComputedStyle(dlg).display !== "none" : null;
        return report;
      })()`);
      console.log(`[smoke] renderer diag: ${JSON.stringify(diag)}`);
    } catch (err) {
      console.error("[smoke] renderer diag FAILED:", err);
      app.exit(1);
      return;
    }
    setTimeout(() => app.quit(), 500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
