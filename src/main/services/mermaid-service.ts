/**
 * Mermaid 渲染服务(main 进程层):
 * 单例隐藏 BrowserWindow 加载 mermaid.min.js(IIFE 产物 3.5MB,file:// 直用,规避 v11
 * ESM 动态 import 的模块 CORS),executeJavaScript 调页面内 renderMermaid:
 * initialize → parse 预检 → mermaid.render 拿 SVG → 注入 #graphDiv → fonts.ready →
 * canvas 2x 光栅化 PNG。类型契约见 src/core/markdown/mermaid.ts(单一来源)。
 * 降级:任何异常(语法错误/15s 超时/窗口崩溃)→ 返回 null,core 层负责降级渲染。
 * 超时经 renderMermaid 第二参数可注入(默认 15s,测试用短超时,对外契约不变)。
 * 两个导出,同一队列同一实现,差别只在失败怎么表达:
 * - renderMermaid:失败 → null(core 记 warn.mermaidEmpty,不带原因);
 * - renderMermaidStrict(= 转换链路注入 core 的 mermaidResolver):失败 → 抛错并带真实原因,
 *   经 core 既有 warning 通道(warn.mermaidFailed + ${reason})呈现在 UI 上——
 *   原因不留在 console 里当唯一线索。降级渲染结果两者一致(仍为代码块)。
 * CSP(实测 2026-08-13):file:// 页面 CSP 生效,纯 `default-src 'none'` 会连 file://
 * 脚本与内联脚本一并拦截 → 必须显式 `script-src 'unsafe-inline' file:`;其余保持
 * default-src 'none'(断 connect/fetch/object)+ img-src data:(外部图片发不出去),
 * 离线隐私承诺不变。
 * 生命周期(懒创建复用 + 代号化):
 * - 窗口销毁(dispose/崩溃/超时)→ 会话丢弃,代号(epoch)+1;
 * - 代号前进后,在途任务不得把窗口扶正为单例、不得复活已 dispose 的窗口
 *   (否则「转换中放弃并关闭」会在退出路径留下常驻隐藏窗口,window-all-closed 永不触发);
 * - 提交任务时记下代号,启动时代号已变(期间发生 dispose)→ 直接放弃本次渲染,
 *   不新建窗口;
 * - 每个窗口各自持有其页面临时 HTML 的清理函数,会话丢弃即删(含被取代的旧会话)。
 * 渲染串行队列(promise 链),多文档并发转换不交错 executeJavaScript。
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MermaidResult } from "../../core/markdown/mermaid.js";
import { getMermaidDir } from "./resource-dirs.js";
import { hardenWebContents } from "./web-hardening.js";
import { writeTempHtml } from "./temp-html.js";

/** 单次渲染超时(含首次预热外的脚本解析;超时按渲染失败降级) */
const RENDER_TIMEOUT_MS = 15_000;

/** 隐藏窗口的一次「会话」:窗口 + 其页面临时 HTML 清理 + 创建时代号。 */
interface MermaidSession {
  win: BrowserWindow;
  /** 创建时的服务代号;代号前进后本会话结果一律作废。 */
  epoch: number;
  /** 本会话页面临时 HTML 清理(会话丢弃时执行,幂等)。 */
  cleanup: () => Promise<void>;
}

/** 当前单例会话(无窗口时为 null)。 */
let session: MermaidSession | null = null;
/** 在途创建(复用同一 Promise 避免并发重复建窗);loadEpoch 记录其所属代号。 */
let loadPromise: Promise<MermaidSession> | null = null;
let loadEpoch = -1;
/** 服务代号:任何会话丢弃(销毁/dispose/崩溃/超时)都 +1,使在途任务失效。 */
let epoch = 0;
/** 渲染串行队列:单例窗口的 executeJavaScript 不交错(多文档并发转换时排队) */
let queue: Promise<unknown> = Promise.resolve();

/** 会话已失效(dispose/崩溃后窗口被换代):本次渲染放弃,不是渲染失败。 */
class StaleEpochError extends Error {
  constructor() {
    super("mermaid 会话已失效");
    this.name = "StaleEpochError";
  }
}

function isStaleEpoch(err: unknown): boolean {
  return err instanceof StaleEpochError;
}

/** 销毁某会话的窗口(若仍存活)并回收其临时 HTML;会话已丢弃时为空操作。 */
function discardSession(target: MermaidSession): void {
  if (!target.win.isDestroyed()) target.win.destroy();
  void target.cleanup();
}

/**
 * 丢弃当前会话:代号前进(在途任务作废)+ 销毁窗口 + 删除其临时 HTML。
 * 幂等,可重复调用;也是 dispose 与窗口自身消失(崩溃/超时销毁)的唯一收口。
 */
function dropSession(): void {
  epoch += 1;
  const current = session;
  session = null;
  loadPromise = null;
  loadEpoch = -1;
  if (current !== null) discardSession(current);
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

/**
 * 新建一个会话(隐藏窗口 + 页面临时 HTML + 加载)。
 * 每步 await 之后复查代号:期间若发生 dispose/崩溃/换代,立即销毁本窗口并放弃,
 * 绝不让过期任务把窗口扶正为单例(复活窗口 = 退出路径上的孤儿隐藏窗口)。
 */
async function createSession(): Promise<MermaidSession> {
  const createdEpoch = epoch;
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
  let cleanup: (() => Promise<void>) | null = null;
  const releasePage = async (): Promise<void> => {
    await cleanup?.();
  };
  const assertFresh = (): void => {
    if (createdEpoch === epoch && !w.isDestroyed()) return;
    if (!w.isDestroyed()) w.destroy();
    throw new StaleEpochError();
  };
  // 构造后任一步失败(加固/临时 HTML/loadFile)统一销毁再抛——中途抛错会泄漏
  // 半初始化窗口(非 destroyed 僵尸,干扰 getAllWindows 计数与 will-quit 退出兜底)
  try {
    w.on("closed", () => {
      if (session?.win === w) {
        dropSession(); // 单例窗口消失(崩溃/超时销毁)→ 复位并换代
        return;
      }
      void releasePage(); // 已被换代取代的旧会话窗口:各自回收自己的临时 HTML
    });
    // 四类窗口统一导航收口(页面无链接,纯防御性;executeJavaScript 不受影响)
    hardenWebContents(w);
    // 渲染进程崩溃:销毁窗口并复位,下次调用重建(本次渲染经 executeJavaScript reject 降级 null)
    w.webContents.on("render-process-gone", () => {
      if (!w.isDestroyed()) w.destroy();
    });
    const tmp = await writeTempHtml(buildPageHtml(getMermaidDir()));
    cleanup = tmp.cleanup;
    assertFresh();
    await w.loadFile(tmp.htmlPath);
    assertFresh();
  } catch (err) {
    const pending = cleanup;
    cleanup = null; // 已摘除:closed 处理器不再重复回收
    if (!w.isDestroyed()) w.destroy();
    await pending?.(); // 构造失败:本页临时 HTML 由本次调用自己回收
    throw err;
  }
  return { win: w, epoch: createdEpoch, cleanup: releasePage };
}

/** 取当前会话,按需创建(同代号内并发只建一次);预热失败下次调用重建(3.5MB 脚本解析首次约数百 ms)。 */
async function ensureSession(): Promise<MermaidSession> {
  if (session !== null && !session.win.isDestroyed()) return session;
  if (loadPromise === null || loadEpoch !== epoch) {
    loadEpoch = epoch;
    loadPromise = createSession().then(
      (created) => {
        // 落地前最后闸门:代号已前进的旧任务不得成为单例
        if (created.epoch !== epoch) {
          discardSession(created);
          throw new StaleEpochError();
        }
        session = created;
        return created;
      },
      (err) => {
        loadPromise = null; // 预热失败复位,下次调用重建
        throw err;
      },
    );
  }
  return loadPromise;
}

/** 超时错误文案(withTimeout 抛出与 doRender 识别共用单一来源) */
const MERMAID_TIMEOUT_MESSAGE = "mermaid 渲染超时";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(MERMAID_TIMEOUT_MESSAGE)), ms);
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

/** 单次渲染的结局:成功带结果;失败带原因(供 UI warning 通道呈现);
 *  skipped = 会话换代期间主动放弃(非失败,不上报警告)。 */
type RenderOutcome =
  | { ok: true; result: MermaidResult }
  | { ok: false; skipped: true; reason: null }
  | { ok: false; skipped: false; reason: string };

async function doRender(code: string, timeoutMs: number): Promise<RenderOutcome> {
  /** 本次渲染实际使用的会话(超时销毁针对它,不用可能已换代的全局单例)。 */
  let active: MermaidSession | null = null;
  try {
    active = await ensureSession();
    const result = await withTimeout(
      active.win.webContents.executeJavaScript(`window.renderMermaid(${JSON.stringify(code)})`),
      timeoutMs,
    );
    if (!result || typeof result.svg !== "string" || typeof result.pngDataUrl !== "string") {
      return { ok: false, skipped: false, reason: "渲染服务返回了非法结果" };
    }
    const width = Number(result.width);
    const height = Number(result.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { ok: false, skipped: false, reason: `渲染结果尺寸非法(${width}x${height})` };
    }
    const png = Buffer.from(result.pngDataUrl.split(",")[1] ?? "", "base64");
    if (png.length === 0) {
      return { ok: false, skipped: false, reason: "渲染结果 PNG 为空" };
    }
    return { ok: true, result: { svg: result.svg, png, width, height } };
  } catch (err) {
    if (isStaleEpoch(err)) {
      // 换代/dispose 期间放弃本次渲染(非失败):不建窗、不复活窗口
      console.log("[mermaid-service] render skipped: 会话已失效");
      return { ok: false, skipped: true, reason: null };
    }
    // 降级路径:语法错误/超时/窗口崩溃/脚本加载失败,core 层负责降级渲染;
    // 原因既留日志便于诊断,又随 reason 交给调用方经既有 warning 通道上屏
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`[mermaid-service] render failed: ${reason}`);
    // 超时意味着页面内 executeJavaScript 可能仍挂起——队列已放行下一任务,
    // 同窗口两次渲染存在交错风险(极小但非零)。销毁窗口(closed → dropSession)强制
    // 下一次渲染走全新页面,消除挂起残留。
    if (err instanceof Error && err.message === MERMAID_TIMEOUT_MESSAGE && active !== null) {
      discardSession(active);
    }
    return { ok: false, skipped: false, reason };
  }
}

/**
 * 渲染 mermaid 代码块,失败返回 null(core 层负责降级)。
 * 调用方并发安全:内部 promise 链串行,无需外部加锁。
 * 提交时记下服务代号:轮到本任务时若期间发生过 dispose(窗口换代),直接放弃本次
 * 渲染而不新建窗口——避免「主窗口已关/转换已放弃」后仍在退出路径上拉起隐藏窗口。
 * @param timeoutMs 单次渲染超时(默认 RENDER_TIMEOUT_MS;测试可注入短超时,对外契约不变)
 */
export function renderMermaid(code: string, timeoutMs: number = RENDER_TIMEOUT_MS): Promise<MermaidResult | null> {
  return submit(code, timeoutMs).then((outcome) => (outcome.ok ? outcome.result : null));
}

/** 渲染失败抛出的错误(reason 供 core 生成 warn.mermaidFailed 警告的 params) */
export class MermaidRenderError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "MermaidRenderError";
    this.reason = reason;
  }
}

/**
 * 严格模式渲染(= 转换链路注入 core 的 mermaidResolver):失败**抛错并带上真实原因**,
 * 由 core 既有 warning 通道(warn.mermaidFailed + ${reason})呈现在 UI 上;
 * 降级语义与 renderMermaid 完全一致(内容不丢、不中断转换,仍渲染为代码块)。
 * 会话换代导致的主动放弃不算失败,仍返回 null(不制造假警告)。
 * @param timeoutMs 单次渲染超时(默认 RENDER_TIMEOUT_MS)
 */
export function renderMermaidStrict(
  code: string,
  timeoutMs: number = RENDER_TIMEOUT_MS,
): Promise<MermaidResult | null> {
  return submit(code, timeoutMs).then((outcome) => {
    if (outcome.ok) return outcome.result;
    if (outcome.skipped) return null;
    throw new MermaidRenderError(outcome.reason);
  });
}

/** 提交一次渲染到串行队列(两个导出共用同一队列与代号闸门,故并发安全) */
function submit(code: string, timeoutMs: number): Promise<RenderOutcome> {
  const submittedEpoch = epoch;
  const task = queue.then(() =>
    submittedEpoch === epoch
      ? doRender(code, timeoutMs)
      : Promise.resolve<RenderOutcome>({ ok: false, skipped: true, reason: null }),
  );
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/**
 * 销毁常驻隐藏窗口(index.ts 主窗口 closed 时调用):
 * 否则该窗口使 window-all-closed 永不触发,应用无法退出。幂等,可重复调用;
 * 同时删除该会话的临时 HTML 并使在途任务代号失效(旧任务不得复活窗口)。
 */
export function disposeMermaidService(): void {
  dropSession();
}

// 应用退出兜底(will-quit 时窗口已关闭,此处为显式保障,见文件头注释)
app.on("will-quit", () => {
  dropSession();
});
