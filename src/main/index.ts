import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../core/parse.js";
import { renderDocx } from "../core/docx/render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");

export type ConvertFormat = "docx" | "pdf";

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
 * 转换实现:读取 md → 解析 → 渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于 smoke 自测与未来 CLI 复用;进度经 onProgress 上报。
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
  const ast = parseMarkdown(md);

  if (format === "pdf") {
    throw new Error("PDF 功能暂未支持(开发中)");
  }

  onProgress?.("render");
  const buffer = await renderDocx(ast, {
    imageResolver: async (src: string) => {
      if (/^https?:\/\//.test(src)) return null;
      const p = path.resolve(path.dirname(filePath), src);
      return fs.readFile(p).catch(() => null);
    },
  });
  const outputPath = filePath.replace(/\.(md|markdown)$/i, ".docx");
  await fs.writeFile(outputPath, buffer);
  onProgress?.("done");
  return { outputPath };
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
  createWindow();
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
    } catch (err) {
      console.error("[smoke] convert FAILED:", err);
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
