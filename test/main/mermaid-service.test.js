/**
 * Mermaid 渲染服务验收(main 进程层;经 dist/main/mermaid-service.js,electron 环境):
 * 本迭代 mermaid 链路 main 侧真实断言兜底(渲染在隐藏 BrowserWindow + mermaid 11.16.1):
 * - renderMermaid("graph TD; A-->B") → 非 null(渲染成功)
 * - png 为 PNG 魔数(89 50 4E 47),width/height > 0(逻辑 1x 尺寸)
 * - svg 为完整 SVG 字符串(含 <svg 标签)
 * - 语法错误 → null(降级路径:页面内 parse 预检失败)
 * - 渲染超时 → null(executeJavaScript 挂起 + 注入短超时;串行队列/窗口不被卡死)
 * - 畸形返回值防御校验 → null(svg 形状非法/PNG 空/尺寸非法)
 * - 渲染进程崩溃 → null 且下次调用自动重建窗口(forcefullyCrashRenderer 实测)
 * - 脚本加载失败(loadFile 抛错)→ null 且临时 HTML 清理、下次调用重建
 * 模拟手段:BrowserWindow.prototype.webContents getter 临时替换(converter.test.js 同款
 * 模式,descriptor 一律 try/finally 恢复;本段与其他段同进程串行,不能污染原型)。
 * 说明:窗口懒创建、单例复用;本段结束后窗口仍在,由 acceptance 末尾 app.quit()
 * 触发清理(closed → 临时 HTML 删除)。
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import { disposeMermaidService, renderMermaid } from "../../dist/main/mermaid-service.js";

const GOOD_CODE = "graph TD; A-->B";

function assert(cond, msg) {
  if (!cond) throw new Error(`mermaid-service 断言失败:${msg}`);
}

/** 临时替换 BrowserWindow.prototype.webContents getter(返回 fakeFactory(真实 wc));返回恢复函数 */
function patchWebContents(fakeFactory) {
  const descriptor = Object.getOwnPropertyDescriptor(BrowserWindow.prototype, "webContents");
  Object.defineProperty(BrowserWindow.prototype, "webContents", {
    configurable: true,
    get() {
      return fakeFactory(descriptor.get.call(this));
    },
  });
  return () => Object.defineProperty(BrowserWindow.prototype, "webContents", descriptor);
}

export async function run() {
  // ---- 1. 真实渲染成功:PNG 魔数/逻辑尺寸/SVG 完整 ----
  const result = await renderMermaid(GOOD_CODE);
  assert(result, "renderMermaid 返回 null(渲染失败)");
  assert(
    result.png.length > 8 &&
      result.png[0] === 0x89 &&
      result.png[1] === 0x50 &&
      result.png[2] === 0x4e &&
      result.png[3] === 0x47,
    `png 魔数错误: ${result.png.subarray(0, 4).toString("hex")}`,
  );
  assert(result.width > 0 && result.height > 0, `尺寸异常: ${result.width}x${result.height}`);
  assert(result.svg.includes("<svg"), "svg 缺少 <svg 标签");

  // ---- 2. 降级路径:语法错误 → 页面内 parse 预检失败 → null;catch 日志留痕(170 行) ----
  const origLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  let bad;
  try {
    bad = await renderMermaid("graph TD;\nA[unclosed");
  } finally {
    console.log = origLog;
  }
  assert(bad === null, "语法错误应返回 null(降级)");
  assert(
    logs.some((l) => l.includes("[mermaid-service] render failed") && l.includes("mermaid parse failed")),
    `catch 日志应含「[mermaid-service] render failed: mermaid parse failed」,实际 ${JSON.stringify(logs)}`,
  );

  // ---- 3. 渲染超时 + 畸形返回值防御校验(挂起/垃圾返回值,均 → null) ----
  let restoreWc = null;
  try {
    restoreWc = patchWebContents(() => ({
      executeJavaScript: async (script) => {
        if (script.includes("TIMEOUT_SENTINEL")) return new Promise(() => {}); // 永不 settle → 超时
        if (script.includes("BADSHAPE_SENTINEL")) return { svg: 123 }; // 形状非法
        if (script.includes("EMPTYPNG_SENTINEL"))
          return { svg: "<svg>", pngDataUrl: "data:image/png;base64,", width: 10, height: 10 }; // PNG 空
        if (script.includes("NOCOMMA_PNG_SENTINEL"))
          return { svg: "<svg>", pngDataUrl: "data:image/png;base64", width: 10, height: 10 }; // 无逗号 → split[1] undefined → ?? "" → 空 PNG
        if (script.includes("ZEROSIZE_SENTINEL"))
          return { svg: "<svg>", pngDataUrl: "data:image/png;base64,AAAA", width: 0, height: 10 }; // 尺寸非法
        throw new Error("unexpected script");
      },
    }));
    const t0 = Date.now();
    const timeoutResult = await renderMermaid("TIMEOUT_SENTINEL", 200);
    assert(timeoutResult === null, "超时应返回 null(降级)");
    assert(Date.now() - t0 < 5000, "注入超时未生效(耗时接近默认 15s)");
    assert((await renderMermaid("BADSHAPE_SENTINEL")) === null, "畸形 svg 形状应返回 null");
    assert((await renderMermaid("EMPTYPNG_SENTINEL")) === null, "空 PNG 应返回 null");
    assert((await renderMermaid("NOCOMMA_PNG_SENTINEL")) === null, "无逗号空 PNG 应返回 null(?? 兜底)");
    assert((await renderMermaid("ZEROSIZE_SENTINEL")) === null, "非法尺寸应返回 null");
  } finally {
    if (restoreWc) restoreWc();
  }
  // 超时/畸形路径后:串行队列未卡死、真实窗口仍可用
  const afterTimeout = await renderMermaid(GOOD_CODE);
  assert(afterTimeout, "超时后队列/窗口应仍可用(恢复渲染)");

  // ---- 4. 渲染进程崩溃:forcefullyCrashRenderer → render-process-gone → 窗口销毁 → null;下次调用重建 ----
  const mermaidWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  assert(
    mermaidWin && typeof mermaidWin.webContents.forcefullyCrashRenderer === "function",
    "forcefullyCrashRenderer 不可用(崩溃路径无法实测)",
  );
  restoreWc = null;
  try {
    restoreWc = patchWebContents((realWc) => {
      const origExecute = realWc.executeJavaScript;
      realWc.executeJavaScript = async (...args) => {
        realWc.forcefullyCrashRenderer(); // 真实崩溃:原 promise reject 或挂起,由注入超时兜底
        return origExecute.apply(realWc, args);
      };
      return realWc;
    });
    const crashResult = await renderMermaid("CRASH_SENTINEL", 3000);
    assert(crashResult === null, "渲染进程崩溃应返回 null(降级)");
  } finally {
    if (restoreWc) restoreWc();
  }
  const afterCrash = await renderMermaid(GOOD_CODE);
  assert(afterCrash, "崩溃后窗口应自动重建并恢复渲染");

  // ---- 5. 脚本加载失败(loadFile 抛错)→ null + 临时 HTML 清理 + 下次调用重建 ----
  disposeMermaidService(); // 销毁复用窗口,让 ensureWindow 走新建路径
  const origLoadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = async () => {
    throw new Error("mock loadFile 失败");
  };
  try {
    const loadFailResult = await renderMermaid(GOOD_CODE);
    assert(loadFailResult === null, "loadFile 失败应返回 null(降级)");
  } finally {
    BrowserWindow.prototype.loadFile = origLoadFile;
  }
  await new Promise((r) => setTimeout(r, 100)); // 等 closed → cleanup 删除临时 HTML
  const tmpHtmlLeft = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith(`m2w-${process.pid}-`));
  assert(tmpHtmlLeft.length === 0, `loadFile 失败:临时 HTML 残留 ${tmpHtmlLeft.join(", ")}`);
  const afterLoadFail = await renderMermaid(GOOD_CODE);
  assert(afterLoadFail, "loadFile 失败后窗口应重建并恢复渲染");

  // ---- 6. 退出兜底(will-quit 监听,200 行):销毁常驻窗口;再次渲染自动重建 ----
  const quitWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  assert(quitWin, "will-quit 测试前置:未找到 mermaid 常驻窗口");
  app.emit("will-quit"); // 手动触发事件仅运行监听器,不真正退出应用
  assert(quitWin.isDestroyed(), "will-quit 应销毁常驻窗口(退出兜底)");
  const afterQuit = await renderMermaid(GOOD_CODE);
  assert(afterQuit, "will-quit 销毁后应自动重建窗口并恢复渲染");

  console.log(
    `[ok] mermaid-service:真实渲染 ${result.width}x${result.height}(2x PNG ${result.png.length} bytes,svg ${result.svg.length} chars);` +
      "语法错误(含 catch 日志文案)/超时/畸形返回值(含无逗号空 PNG)/崩溃/loadFile 失败均降级 null," +
      "崩溃与加载失败后自动重建;will-quit 退出兜底销毁窗口且可重建",
  );
}