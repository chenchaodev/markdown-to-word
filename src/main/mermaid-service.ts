/**
 * Mermaid 渲染服务(批次 10 功能 1,main 进程层):
 * 单例隐藏 BrowserWindow 加载 mermaid.min.js(IIFE 产物 3.5MB,file:// 直用,规避 v11
 * ESM 动态 import 的模块 CORS),executeJavaScript 调页面内 renderMermaid:
 * initialize → parse 预检 → mermaid.render 拿 SVG → 注入 #graphDiv → fonts.ready →
 * canvas 2x 光栅化 PNG。类型契约见 src/core/mermaid.ts(单一来源)。
 * 降级:任何异常(语法错误/15s 超时/窗口崩溃)→ 返回 null,core 层负责降级渲染。
 * 超时经 renderMermaid 第二参数可注入(默认 15s,测试用短超时,对外契约不变)。
 * CSP(实测 2026-08-13):file:// 页面 CSP 生效,纯 `default-src 'none'` 会连 file://
 * 脚本与内联脚本一并拦截 → 必须显式 `script-src 'unsafe-inline' file:`;其余保持
 * default-src 'none'(断 connect/fetch/object)+ img-src data:(外部图片发不出去),
 * 离线隐私承诺不变。
 * 生命周期:懒创建复用窗口;主窗口关闭(见 index.ts disposeMermaidService)或应用
 * 退出时销毁;渲染串行队列(promise 链),多文档并发转换不交错 executeJavaScript。
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MermaidResult } from "../core/mermaid.js";
import { getMermaidDir } from "./mermaid-dir.js";
import { hardenWebContents } from "./web-hardening.js";
import { writeTempHtml } from "./temp-html.js";

/** 单次渲染超时(含首次预热外的脚本解析;超时按渲染失败降级) */
const RENDER_TIMEOUT_MS = 15_000;

let win: BrowserWindow | null = null;
let loadPromise: Promise<BrowserWindow> | null = null;
let cleanupHtml: (() => Promise<void>) | null = null;
/** 渲染串行队列:单例窗口的 executeJavaScript 不交错(多文档并发转换时排队) */
let queue: Promise<unknown> = Promise.resolve();

function reset(): void {
  win = null;
  loadPromise = null;
  const cleanup = cleanupHtml;
  cleanupHtml = null;
  if (cleanup) void cleanup();
}

function buildPageHtml(mermaidDir: string): string {
  const scriptUrl = pathToFileURL(path.join(mermaidDir, "mermaid.min.js")).href;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' file:; img-src data:; style-src 'unsafe-inline'">
<title>mermaid renderer</title>
</head>
<body>
<div id="graphDiv"></div>
<script src="${scriptUrl}"></script>
<script>
(() => {
  let seq = 0;
  window.renderMermaid = async (code) => {
    await mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
      fontFamily: '"Microsoft YaHei",sans-serif',
    });
    // 语法错误预检:parse 失败直接抛 → main 侧返回 null(比 render reject 更早、更明确)
    const ok = await mermaid.parse(code, { suppressErrors: true });
    if (!ok) throw new Error("mermaid parse failed");
    const { svg } = await mermaid.render("mermaid-" + (++seq), code);
    const graphDiv = document.getElementById("graphDiv");
    graphDiv.innerHTML = svg;
    await document.fonts.ready;
    const svgEl = graphDiv.querySelector("svg");
    if (!svgEl) throw new Error("no svg element");
    const rect = svgEl.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) throw new Error("empty svg size");
    // 显式 width/height 属性:保证 SVG 有内在尺寸(canvas 绘制与 pdf 内联均需要)
    svgEl.setAttribute("width", String(width));
    svgEl.setAttribute("height", String(height));
    const xml = new XMLSerializer().serializeToString(svgEl);
    // 2x 光栅化:canvas 像素 2x、逻辑尺寸 1x(docx transformation 直接用 1x)
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    // createImageBitmap 不支持 SVG(Chromium 限制,InvalidStateError,实测 2026-08-13)
    // → 用 Image + data: URL(CSP img-src data: 允许;blob: 会被 img-src data: 拦截)
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await img.decode();
    ctx.drawImage(img, 0, 0, width, height);
    return { svg: xml, pngDataUrl: canvas.toDataURL("image/png"), width, height };
  };
})();
</script>
</body>
</html>`;
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win;
  if (!loadPromise) {
    const p = (async () => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // 隐藏窗口默认节流 → 布局/字体拿未完成帧;必须关掉才能可靠光栅化
          backgroundThrottling: false,
        },
      });
      w.on("closed", reset);
      // B1:四类窗口统一导航收口(页面无链接,纯防御性;executeJavaScript 不受影响)
      hardenWebContents(w);
      // 渲染进程崩溃:销毁窗口并复位,下次调用重建(本次渲染经 executeJavaScript reject 降级 null)
      w.webContents.on("render-process-gone", () => {
        if (!w.isDestroyed()) w.destroy();
      });
      const { htmlPath, cleanup } = await writeTempHtml(buildPageHtml(getMermaidDir()));
      cleanupHtml = cleanup;
      try {
        await w.loadFile(htmlPath);
      } catch (err) {
        w.destroy();
        throw err;
      }
      win = w;
      return w;
    })();
    // 预热失败复位,下次调用重建(3.5MB 脚本解析首次约数百 ms,之后复用)
    loadPromise = p.catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mermaid 渲染超时")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function doRender(code: string, timeoutMs: number): Promise<MermaidResult | null> {
  try {
    const w = await ensureWindow();
    const result = await withTimeout(
      w.webContents.executeJavaScript(`window.renderMermaid(${JSON.stringify(code)})`),
      timeoutMs,
    );
    if (!result || typeof result.svg !== "string" || typeof result.pngDataUrl !== "string") return null;
    const width = Number(result.width);
    const height = Number(result.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const png = Buffer.from(result.pngDataUrl.split(",")[1] ?? "", "base64");
    if (png.length === 0) return null;
    return { svg: result.svg, png, width, height };
  } catch (err) {
    // 降级路径:语法错误/超时/窗口崩溃/脚本加载失败,core 层负责降级渲染;日志留痕便于诊断
    console.log(`[mermaid-service] render failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 渲染 mermaid 代码块,失败返回 null(core 层负责降级)。
 * 调用方并发安全:内部 promise 链串行,无需外部加锁。
 * @param timeoutMs 单次渲染超时(默认 RENDER_TIMEOUT_MS;测试可注入短超时,对外契约不变)
 */
export function renderMermaid(code: string, timeoutMs: number = RENDER_TIMEOUT_MS): Promise<MermaidResult | null> {
  const task = queue.then(() => doRender(code, timeoutMs));
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/**
 * 销毁常驻隐藏窗口(index.ts 主窗口 closed 时调用):
 * 否则该窗口使 window-all-closed 永不触发,应用无法退出。幂等,可重复调用。
 */
export function disposeMermaidService(): void {
  if (win && !win.isDestroyed()) win.destroy();
  reset();
}

// 应用退出兜底(will-quit 时窗口已关闭,此处为显式保障,见文件头注释)
app.on("will-quit", () => {
  if (win && !win.isDestroyed()) win.destroy();
});
