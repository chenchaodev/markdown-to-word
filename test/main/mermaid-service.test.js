/**
 * Mermaid 渲染服务验收(main 进程层;经 dist/main/services/mermaid-service.js,electron 环境):
 * 断言面:真实渲染成功(PNG 魔数/逻辑尺寸/SVG 完整)、语法错误/超时/畸形返回值/崩溃/
 * 脚本加载失败均降级 null 且窗口自动重建、dispose 在途(会话创建未 settle)与 dispose
 * 后排队任务均不复活窗口且临时 HTML 回收、will-quit 退出兜底销毁窗口且可重建。
 * 模拟手段:BrowserWindow.prototype.webContents getter 临时替换(converter.test.js 同款
 * 模式,descriptor 一律 try/finally 恢复;每段跑在独立子进程里,污染不外溢,
 * try/finally 仍是段内卫生,兼防本段后续断言读到被污染的原型)。
 * 生命周期:本段跑在逐段独立的 Electron 子进程内(见 test/common/runner.js),窗口懒创建、
 * 单例复用;段末由本段自己 disposeMermaidService() 收尾并等临时 HTML 回收干净,
 * **不再依赖入口的 app.quit()**(入口已不持有任何段窗口)。
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import { disposeMermaidService, renderMermaid } from "../../dist/main/services/mermaid-service.js";

const GOOD_CODE = "graph TD; A-->B";

function assert(cond, msg) {
  if (!cond) throw new Error(`mermaid-service 断言失败:${msg}`);
}

/** 等待条件成立(轮询上限兜底,避免时序假设导致假阴性)。 */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`mermaid-service 断言失败:等待超时(${label})`);
}

/**
 * 本段新增的临时 HTML 残留(空数组 = 已回收干净)。排除段起点就存在的文件:
 * 其他段(如预览)遗留的文件不归本段断言,否则依赖段序。
 */
async function tempHtmlLeft(baseline) {
  const names = await fs.readdir(os.tmpdir());
  return names.filter((n) => n.startsWith(`m2w-${process.pid}-`) && !baseline.has(n));
}

/** 等待本段新增的临时 HTML 全部回收(窗口 destroy → closed → 删除是异步链路,需轮询落定) */
async function waitNoTempHtml(baseline, label) {
  const deadline = Date.now() + 3000;
  let left = await tempHtmlLeft(baseline);
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    left = await tempHtmlLeft(baseline);
  }
  assert(left.length === 0, `${label}:临时 HTML 残留 ${left.join(", ")}`);
}

/**
 * 临时替换 BrowserWindow.prototype.webContents getter(返回 fakeFactory(真实 wc));返回恢复函数。
 * 窗口可能在补丁激活期间被重建(超时后销毁→下次渲染重建):fake 用 Proxy 把
 * 未覆盖成员转发到真实 webContents——否则构造器内部与 hardenWebContents 访问
 * setWindowOpenHandler/on 等方法会抛错,产生半初始化僵尸窗口。
 * descriptor 一律 try/finally 恢复;本段与其他段同进程串行,不能污染原型。
 */
function patchWebContents(fakeFactory) {
  const descriptor = Object.getOwnPropertyDescriptor(BrowserWindow.prototype, "webContents");
  Object.defineProperty(BrowserWindow.prototype, "webContents", {
    configurable: true,
    get() {
      const real = descriptor.get.call(this);
      const fake = fakeFactory(real);
      return new Proxy(fake, {
        get(target, prop) {
          if (prop in target) return target[prop];
          const value = Reflect.get(real, prop);
          return typeof value === "function" ? value.bind(real) : value;
        },
      });
    },
  });
  return () => Object.defineProperty(BrowserWindow.prototype, "webContents", descriptor);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const baseline = new Set(
    (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith(`m2w-${process.pid}-`)),
  );
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

  // ---- 6. dispose 在途(会话创建未 settle):旧代任务不得复活窗口,临时 HTML 需回收 ----
  disposeMermaidService();
  await new Promise((r) => setTimeout(r, 100));
  const baselineInflight = BrowserWindow.getAllWindows().length;
  const slowLoadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function patched(file, options) {
    // 会话页加载延迟 250ms:让 dispose 落在「窗口已建、页面未加载」的创建在途窗口
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.isDestroyed()) {
          reject(new Error("window destroyed"));
          return;
        }
        slowLoadFile.call(this, file, options).then(resolve, reject);
      }, 250);
    });
  };
  let inflight;
  try {
    inflight = renderMermaid("DISPOSE_INFLIGHT", 5000);
    await waitFor(
      () => BrowserWindow.getAllWindows().length > baselineInflight,
      "会话创建进入在途窗口",
    );
    disposeMermaidService(); // 创建在途时释放服务(等价主窗口关闭/放弃转换)
    assert((await inflight) === null, "dispose 在途的渲染应放弃(返回 null 而非失败日志)");
  } finally {
    BrowserWindow.prototype.loadFile = slowLoadFile;
  }
  assert(
    BrowserWindow.getAllWindows().length === baselineInflight,
    "dispose 在途的旧代任务不得复活窗口(否则退出路径留下孤儿隐藏窗口)",
  );
  await new Promise((r) => setTimeout(r, 150)); // 等 closed → 临时 HTML 删除
  const inflightLeft = await tempHtmlLeft(baseline);
  assert(inflightLeft.length === 0, `dispose 在途:临时 HTML 残留 ${inflightLeft.join(", ")}`);
  assert(await renderMermaid(GOOD_CODE), "dispose 在途后应能重建会话并恢复渲染");
  console.log("[ok] mermaid-service:dispose 在途(创建未 settle)不复活窗口 + 临时 HTML 回收");

  // ---- 7. dispose 后已排队任务:不得新建窗口(代号失效即放弃本次渲染) ----
  disposeMermaidService();
  const baselineQueued = BrowserWindow.getAllWindows().length;
  let releaseFirst;
  let execCalls = 0;
  restoreWc = null;
  try {
    restoreWc = patchWebContents(() => ({
      executeJavaScript: () => {
        execCalls += 1;
        return new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ svg: "<svg/>", pngDataUrl: "data:image/png;base64,AAAA", width: 4, height: 4 });
        });
      },
    }));
    const firstTask = renderMermaid("QUEUED_FIRST", 5000);
    await waitFor(() => releaseFirst !== undefined, "首个渲染进入 executeJavaScript(队列被占)");
    const queuedTask = renderMermaid("QUEUED_SECOND", 5000); // 排队中,尚未开始
    disposeMermaidService(); // 换代:排队任务提交时的代号失效
    releaseFirst();
    assert((await firstTask) !== null, "首个渲染(fake 返回合法结果)应正常完成");
    const queuedStart = Date.now();
    assert((await queuedTask) === null, "dispose 后排队的任务应放弃,不新建窗口");
    assert(
      Date.now() - queuedStart < 1000,
      "放弃的排队任务应立即结算(不得走 5s 超时才降级,那说明它仍建了窗口)",
    );
    assert(execCalls === 1, `dispose 后排队任务不得再触达页面(executeJavaScript 应仅 1 次),实际 ${execCalls}`);
  } finally {
    if (restoreWc) restoreWc();
  }
  assert(
    BrowserWindow.getAllWindows().length === baselineQueued,
    "dispose 后排队任务不得留下窗口",
  );
  console.log("[ok] mermaid-service:dispose 后排队任务放弃渲染,不复活窗口");

  // ---- 8. 退出兜底(will-quit 监听):销毁常驻窗口;再次渲染自动重建 ----
  assert(await renderMermaid(GOOD_CODE), "will-quit 测试前置:先重建常驻窗口");
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

  // ---- 9. 段末 teardown:常驻会话窗口与临时 HTML 在段内收干净 ----
  // 逐段子进程隔离后,入口不再持有段窗口(也无 app.quit() 兜底),残留若靠宿主退出时
  // 顺带关闭窗口,就是"依赖入口生命周期"的跨段假设;本段显式 dispose 并等回收落定。
  disposeMermaidService();
  await waitNoTempHtml(baseline, "段末 teardown");
  assert(
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length === 0,
    "段末 teardown:不应留下未销毁的常驻窗口",
  );
  console.log("[ok] mermaid-service:段末 teardown(常驻窗口销毁 + 临时 HTML 回收,不依赖入口退出)");
}