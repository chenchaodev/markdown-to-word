/**
 * 预览窗口子系统(自 main/index.ts 抽取,行为零变化):
 * 读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发多开;closed 清理注册与临时文件;focus 时按 mtime 对比源文件,
 * 变更则重渲染;设置变更经 preview:refresh 全量刷新。转换中不触碰预览。
 */
import { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../core/convert.js";
import { decodeMarkdown } from "../../core/util/encoding.js";
import { escapeHtml } from "../../core/util/utils.js";
import { t } from "../../core/i18n.js";
import { createImageResolver } from "../services/image-downloader.js";
import { baseNameFromMdPath, errorMessage } from "../ipc/logic.js";
import { loadSettings } from "../persist/settings.js";
import { writeTempHtml } from "../services/temp-html.js";
import { buildConvertContext } from "../converter/index.js";
import { getKatexDir } from "../services/resource-dirs.js";
import { renderMermaid } from "../services/mermaid-service.js";
import { hardenWebContents } from "../services/web-hardening.js";

/**
 * 预览窗口注册表(批次 11 迭代 3「E 预览跟随刷新」)。
 */
interface PreviewEntry {
  win: BrowserWindow;
  mdPath: string;
  /** 打开/上次刷新时记录的源文件 mtime(focus 时对比,变了才重渲染)。 */
  mtimeMs: number;
  /** 当前展示的临时 HTML 清理函数(每次刷新替换为新临时文件的清理)。 */
  cleanup: () => Promise<void>;
}
export const previews = new Set<PreviewEntry>();

/** 预览渲染:读 md → convert("pdf") 复用 PDF 排版 HTML(打开与刷新共用同一路径)。 */
async function renderPreviewHtml(mdPath: string): Promise<string> {
  const settings = await loadSettings();
  const { text: md } = decodeMarkdown(await fs.readFile(mdPath));
  const baseName = baseNameFromMdPath(mdPath);
  const artifact = await convert(
    md,
    "pdf",
    buildConvertContext({
      baseDir: path.dirname(mdPath),
      title: baseName,
      settings,
      // 预览不经 getImageResolver 共享缓存:允许并发打开多个预览,各自独立解析器
      imageResolver: createImageResolver(path.dirname(mdPath)),
      katexDir: getKatexDir(),
      mermaidResolver: renderMermaid,
    }),
  );
  if (artifact.kind !== "pdf") throw new Error("预览仅支持 pdf 渲染");
  return artifact.html;
}

/** 预览窗口内显示错误页(源文件缺失/渲染失败;保留窗口,恢复后 focus 会重新检查)。 */
function showPreviewError(win: BrowserWindow, message: string): void {
  if (win.isDestroyed()) return;
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${t("preview.errorTitle")}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa; }
  .box { max-width: 480px; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; color: #333; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 13px; color: #666; margin: 0; word-break: break-all; }
</style></head>
<body><div class="box"><h1>${t("preview.errorTitle")}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
    /* B2:错误页加载失败(窗口恰被关闭等),静默即可,无进一步动作可做 */
  });
}

/**
 * 重渲染单个预览窗口:重读设置 + 源文件 → 渲染 → 写新临时文件 → loadFile。
 * 刷新成功后替换注册表清理函数(旧临时文件在新页面加载完成后清理)并更新 mtime;
 * 任何失败(含源文件缺失)→ 窗口内错误页。
 */
export async function refreshPreviewWindow(entry: PreviewEntry): Promise<void> {
  if (entry.win.isDestroyed()) return;
  // B2:新临时文件清理函数提升到 try 外——失败路径(stat/loadFile 中断)也能回收,
  // 此前失败时新 tmp 引用丢失,临时 HTML 残留至进程退出
  let newCleanup: (() => Promise<void>) | null = null;
  try {
    const html = await renderPreviewHtml(entry.mdPath);
    const tmp = await writeTempHtml(html);
    newCleanup = tmp.cleanup;
    const oldCleanup = entry.cleanup;
    entry.cleanup = tmp.cleanup;
    // 渲染完成后再 stat:捕获渲染期间的最新 mtime,下次 focus 以新值对比
    const st = await fs.stat(entry.mdPath);
    entry.mtimeMs = st.mtimeMs;
    await entry.win.loadFile(tmp.htmlPath);
    await oldCleanup(); // 旧临时文件已不再被引用
  } catch (err) {
    await newCleanup?.().catch(() => undefined);
    showPreviewError(entry.win, errorMessage(err));
  }
}

/** focus 时检查源文件:缺失 → 错误页;mtime 变更 → 重渲染。 */
async function checkPreviewSource(entry: PreviewEntry): Promise<void> {
  if (entry.win.isDestroyed()) return;
  let st;
  try {
    st = await fs.stat(entry.mdPath);
  } catch {
    showPreviewError(entry.win, t("preview.sourceMissing", { path: entry.mdPath }));
    return;
  }
  if (st.mtimeMs !== entry.mtimeMs) await refreshPreviewWindow(entry);
}

/**
 * 预览窗口:读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发打开多个预览(各自独立临时文件);closed 事件里清理注册与临时文件。
 * 任何失败:销毁窗口(如已创建)+ 删除临时文件,返回 { ok: false, error }。
 */
export async function openPreviewWindow(mdPath: string): Promise<{ ok: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    // 打开时记录源文件 mtime(focus 对比基准;缺失在 readFile 处抛错走失败路径)
    const st = await fs.stat(mdPath);
    const html = await renderPreviewHtml(mdPath);
    const tmp = await writeTempHtml(html);
    cleanup = tmp.cleanup;
    const baseName = baseNameFromMdPath(mdPath);
    win = new BrowserWindow({
      width: 900,
      height: 1100,
      title: t("preview.windowTitle", { name: baseName }),
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    hardenWebContents(win); // B1:预览 HTML 含用户 markdown 渲染的链接,导航收口
    const entry: PreviewEntry = {
      win,
      mdPath,
      mtimeMs: st.mtimeMs,
      cleanup: tmp.cleanup,
    };
    previews.add(entry);
    win.on("closed", () => {
      previews.delete(entry);
      void entry.cleanup().catch(() => undefined);
    });
    // 批次 11 迭代 3:源文件变更(或恢复)时刷新;已是最新则不动作
    win.on("focus", () => void checkPreviewSource(entry));
    await win.loadFile(tmp.htmlPath);
    return { ok: true };
  } catch (err) {
    win?.destroy();
    await cleanup?.();
    return { ok: false, error: errorMessage(err) };
  }
}
