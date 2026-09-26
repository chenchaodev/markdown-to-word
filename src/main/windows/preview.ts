/**
 * 预览窗口子系统:
 * 读 md → convert("pdf") 复用 PDF 排版 HTML → 写临时文件 → 可见窗口 loadFile。
 * 允许并发多开;closed 清理注册与临时文件;focus 时按 mtime 对比源文件,
 * 变更则重渲染;设置变更经 preview:refresh 全量刷新。转换中不触碰预览。
 * 刷新一致性(并发入口:设置刷新 / focus 检测 / 手动重开):
 * - 每窗口一条串行队列:渲染、loadFile、临时文件回收不交错,旧页不会后到覆盖新页;
 * - 代号(generation)单调递增:只有最新一代的结果可落地,过期任务既不 loadFile
 *   也不动当前页的临时文件(不提前删除新页正在用的文件),失败也不覆盖新页的错误页;
 * - 窗口关闭即 closed 标记:在途刷新安全退出(不写注册表、不删他人文件)。
 */
import { BrowserWindow, screen } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../core/convert.js";
import { escapeHtml } from "../../core/util/utils.js";
import { formatWarning, t } from "../../core/i18n.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { createImageResolver } from "../services/image-downloader.js";
import { baseNameFromMdPath, errorMessage } from "../ipc/logic.js";
import { loadSettings } from "../persist/settings.js";
import { loadUiState, pickWindowBounds, saveUiState } from "../persist/ui-state.js";
import type { WindowBounds } from "../../core/ipc-contract.js";
import { writeTempHtml } from "../services/temp-html.js";
import { buildConvertContext } from "../converter/index.js";
import { prepareMarkdown } from "../converter/preprocess.js";
import { getKatexDir } from "../services/resource-dirs.js";
import { renderMermaid } from "../services/mermaid-service.js";
import { hardenWebContents } from "../services/web-hardening.js";

/** 预览窗默认尺寸(无有效记忆时使用)。 */
const PREVIEW_DEFAULT_WIDTH = 900;
const PREVIEW_DEFAULT_HEIGHT = 1100;

/** 预览窗口注册表条目(每窗口独立刷新状态:代号 + 串行队列)。 */
export interface PreviewEntry {
  win: BrowserWindow;
  mdPath: string;
  /** 打开/上次刷新时记录的源文件 mtime(focus 时对比,变了才重渲染)。 */
  mtimeMs: number;
  /** 当前展示页面对应的临时 HTML 清理函数(被新页取代或窗口关闭时释放;已释放为 null)。 */
  cleanup: (() => Promise<void>) | null;
  /** 刷新代号:每次请求刷新 +1;非最新代的任务结果一律作废。 */
  generation: number;
  /** 刷新串行队列(同窗口渲染/loadFile/清理不交错)。 */
  queue: Promise<void>;
  /** 窗口已关闭:在途刷新安全退出。 */
  closed: boolean;
}
export const previews = new Set<PreviewEntry>();

/** 预览渲染:读 md → convert("pdf") 复用 PDF 排版 HTML(打开与刷新共用同一路径)。 */
async function renderPreviewHtml(mdPath: string): Promise<string> {
  const settings = await loadSettings();
  const warnings: ConvertWarning[] = [];
  const prepared = await prepareMarkdown(mdPath, settings, warnings);
  // 预览没有转换结果 warning 回传通道;明确写入主进程 warning sink,避免编码
  // 提示静默丢失,也不把非致命编码提示升级为预览失败。
  for (const warning of warnings) {
    console.warn(`[preview] ${formatWarning(warning)}`);
  }
  const baseName = baseNameFromMdPath(mdPath);
  const artifact = await convert(
    prepared.markdown,
    "pdf",
    await buildConvertContext({
      baseDir: path.dirname(mdPath),
      title: baseName,
      settings,
      // 预览不经 getImageResolver 共享缓存:允许并发打开多个预览,各自独立解析器
      imageResolver: createImageResolver(path.dirname(mdPath)),
      katexDir: getKatexDir(),
      // 预览没有转换结果 warning 回传通道(见上),故用只降级的 renderMermaid:
      // 失败原因无处上屏,抛错只会让 core 生成一条随即被丢弃的警告
      mermaidResolver: renderMermaid,
    }),
  );
  if (artifact.kind !== "pdf") throw new Error("预览仅支持 pdf 渲染");
  return artifact.html;
}

/** 预览窗口内显示错误页(源文件缺失/渲染失败;保留窗口,恢复后 focus 会重新检查)。
 *  配色随设置主题(theme=dark 深色 / light 浅色 / system 跟随系统深色偏好),
 *  与主界面 base.css 的双作用域策略一致(显式 data-theme 优先,system 用媒体查询)。 */
function showPreviewError(win: BrowserWindow, message: string): void {
  if (win.isDestroyed()) return;
  const theme = loadSettings().theme;
  const themeAttr = theme === "system" ? "" : ` data-theme="${theme}"`;
  const html = `<!doctype html>
<html lang="zh-CN"${themeAttr}>
<head><meta charset="utf-8"><title>${t("preview.errorTitle")}</title>
<style>
  :root { --bg: #fafafa; --box-bg: #fff; --border: #e0e0e0; --fg: #333; --muted: #666; }
  @media (prefers-color-scheme: dark) {
    html:not([data-theme="light"]) { --bg: #212121; --box-bg: #2c2c2c; --border: #444; --fg: #e0e0e0; --muted: #a0a0a0; }
  }
  html[data-theme="dark"] { --bg: #212121; --box-bg: #2c2c2c; --border: #444; --fg: #e0e0e0; --muted: #a0a0a0; }
  body { font-family: "Microsoft YaHei", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: var(--bg); }
  .box { max-width: 480px; padding: 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--box-bg); color: var(--fg); }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 13px; color: var(--muted); margin: 0; word-break: break-all; }
</style></head>
<body><div class="box"><h1>${t("preview.errorTitle")}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
    /* 错误页加载失败(窗口恰被关闭等),静默即可,无进一步动作可做 */
  });
}

/** 刷新任务是否已过期(窗口关闭,或期间又发起了更新的刷新)。 */
function isStaleRefresh(entry: PreviewEntry, generation: number): boolean {
  return entry.closed || entry.generation !== generation;
}

/**
 * 单代刷新(在串行队列内执行):重读设置 + 源文件 → 渲染 → 写新临时文件 → loadFile
 * → 接管本页临时文件 → 回收旧页临时文件。
 * 临时文件所有权分三段:未接管(过期/失败/加载失败)即删;接管后由窗口关闭或
 * 下一次刷新负责,不在本函数提前删除(否则会删掉新页正在用的文件)。
 */
async function runPreviewRefresh(entry: PreviewEntry, generation: number): Promise<void> {
  if (isStaleRefresh(entry, generation)) return;
  // 待接管句柄:置 null 即表示所有权已移交注册表(catch 中不再删它)
  let pending: { htmlPath: string; cleanup: () => Promise<void> } | null = null;
  try {
    const html = await renderPreviewHtml(entry.mdPath);
    if (isStaleRefresh(entry, generation)) return;
    pending = await writeTempHtml(html);
    if (isStaleRefresh(entry, generation)) {
      await pending.cleanup(); // 已过期:不展示也不保留
      return;
    }
    // 渲染完成后再 stat:捕获渲染期间的最新 mtime,下次 focus 以新值对比
    const st = await fs.stat(entry.mdPath);
    await entry.win.loadFile(pending.htmlPath);
    if (isStaleRefresh(entry, generation)) {
      await pending.cleanup(); // 加载期间被取代/窗口已关:本页作废
      return;
    }
    const previous = entry.cleanup;
    entry.cleanup = pending.cleanup;
    pending = null; // 所有权移交注册表
    entry.mtimeMs = st.mtimeMs;
    await previous?.().catch(() => undefined); // 旧页临时文件:仅在新页加载完成后回收
  } catch (err) {
    await pending?.cleanup().catch(() => undefined);
    if (isStaleRefresh(entry, generation)) return; // 旧代失败不覆盖新页/已关闭窗口
    showPreviewError(entry.win, errorMessage(err));
  }
}

/**
 * 请求刷新单个预览窗口(并发入口统一走此):代号 +1 后挂到该窗口的串行队列。
 * 队列保证渲染与 loadFile 不交错,代号保证只有最新一代的结果落地;
 * 返回的 Promise 在该次刷新结算后 resolve(测试可 await)。
 */
export function requestPreviewRefresh(entry: PreviewEntry): Promise<void> {
  const generation = ++entry.generation;
  const task = entry.queue.then(
    () => runPreviewRefresh(entry, generation),
    () => runPreviewRefresh(entry, generation),
  );
  // 队列链吞掉失败:一次刷新出错不得让后续刷新永久排队
  entry.queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** focus 时检查源文件:缺失 → 错误页;mtime 变更 → 请求刷新。 */
async function checkPreviewSource(entry: PreviewEntry): Promise<void> {
  if (entry.closed || entry.win.isDestroyed()) return;
  let st;
  try {
    st = await fs.stat(entry.mdPath);
  } catch {
    showPreviewError(entry.win, t("preview.sourceMissing", { path: entry.mdPath }));
    return;
  }
  if (st.mtimeMs !== entry.mtimeMs) await requestPreviewRefresh(entry);
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
    // 预览窗尺寸记忆(与主窗同机制:pickWindowBounds 钳制 + ui-state 独立 key;
    // 无有效记忆回落默认尺寸)
    const savedBounds = pickWindowBounds(
      loadUiState().previewWindowBounds,
      screen.getAllDisplays().map((display) => display.workArea),
    );
    win = new BrowserWindow({
      width: PREVIEW_DEFAULT_WIDTH,
      height: PREVIEW_DEFAULT_HEIGHT,
      ...(savedBounds ?? {}),
      title: t("preview.windowTitle", { name: baseName }),
      autoHideMenuBar: true,
      // webPreferences 全显式(与 mermaid-service 对齐;默认值虽安全,显式防漂移)
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    hardenWebContents(win); // 预览 HTML 含用户 markdown 渲染的链接,导航收口
    // 关闭时记忆尺寸(独立 key previewWindowBounds;全屏不记录,与主窗一致;
    // 多预览并发时以最后关闭者为准)。写盘失败静默,不影响窗口关闭。
    win.on("close", (event) => {
      if (win!.isFullScreen()) return;
      event.preventDefault();
      const bounds: WindowBounds = win!.getBounds();
      void saveUiState({ previewWindowBounds: bounds })
        .catch(() => {
          /* 静默:UI 状态写失败不影响关闭 */
        })
        .finally(() => win!.destroy());
    });
    const entry: PreviewEntry = {
      win,
      mdPath,
      mtimeMs: st.mtimeMs,
      cleanup: tmp.cleanup,
      generation: 0,
      queue: Promise.resolve(),
      closed: false,
    };
    previews.add(entry);
    win.on("closed", () => {
      entry.closed = true;
      entry.generation += 1; // 在途刷新立即失效(不得再 loadFile/写注册表)
      previews.delete(entry);
      const cleanup = entry.cleanup;
      entry.cleanup = null;
      void cleanup?.().catch(() => undefined);
    });
    // 源文件变更(或恢复)时刷新;已是最新则不动作
    win.on("focus", () => void checkPreviewSource(entry));
    // 初次加载也进串行队列:打开后立刻发生的刷新(settings 变更/focus)排在初载之后,
    // 否则初载后到会用旧页覆盖刚刷新的页面(并删掉刷新页正在用的临时文件)
    const initialLoad = win.loadFile(tmp.htmlPath);
    entry.queue = initialLoad.then(
      () => undefined,
      () => undefined,
    );
    await initialLoad;
    return { ok: true };
  } catch (err) {
    win?.destroy();
    await cleanup?.();
    return { ok: false, error: errorMessage(err) };
  }
}
