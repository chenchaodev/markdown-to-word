/**
 * 预览窗口主进程段(src/main/windows/preview.ts,经 dist,electron 环境):
 * 断言面:
 * - 打开:GBK 准备 warning 进入主进程 warning sink,且不把打开流程变成未处理异常;
 * - 并发刷新:两次请求排队执行,只有最新一代落地 —— 旧代临时文件被回收、
 *   展示页即最新代(旧页不会后到覆盖新页),窗口当前临时文件不被提前删除;
 * - 窗口关闭后刷新安全退出:关闭前的在途刷新不 loadFile、不写注册表、临时文件不残留;
 * - loadFile 未 settle 时关闭:该次刷新结算后不留孤儿窗口与临时文件。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import iconv from "iconv-lite";
import { openPreviewWindow, previews, requestPreviewRefresh } from "../../dist/main/windows/preview.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`preview 断言失败:${msg}`);
}

/** 等待条件成立(轮询上限兜底,避免死等掩盖断言失败)。 */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`preview 断言失败:等待超时(${label})`);
}

/** 本进程全部临时 HTML(writeTempHtml 命名 m2w-{pid}-*)。 */
async function tempHtmlFiles() {
  const names = await fs.readdir(os.tmpdir());
  return names.filter((n) => n.startsWith(`m2w-${process.pid}-`) && n.endsWith(".html"));
}

/**
 * 本段新增的临时 HTML(排除其他段遗留:如 mermaid 服务的常驻会话页,
 * 按设计由 acceptance 末尾 app.quit() 回收,不归本段断言)。
 */
async function previewTempFiles(baseline) {
  return (await tempHtmlFiles()).filter((n) => !baseline.has(n));
}

/** 等待本段新增的临时 HTML 全部回收(窗口关闭路径的删除是 fire-and-forget,需轮询落定)。 */
async function waitNoTempHtml(baseline, label) {
  const deadline = Date.now() + 3000;
  let left = await previewTempFiles(baseline);
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    left = await previewTempFiles(baseline);
  }
  assert(left.length === 0, `${label}:临时 HTML 应全部回收,实际 ${left.join(",")}`);
}

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-preview-"));
  const baseline = new Set(await tempHtmlFiles());
  const originalWarn = console.warn;
  const warnings = [];
  try {
    // ---- 1. 打开:GBK 编码 warning 必须进入主进程 warning sink ----
    const mdPath = path.join(dir, "gbk-preview.md");
    await fs.writeFile(mdPath, iconv.encode("# 你好世界\n\n正文\n", "gbk"));
    console.warn = (...args) => warnings.push(args.join(" "));
    const result = await openPreviewWindow(mdPath);
    console.warn = originalWarn;
    assert(result.ok, `GBK 预览打开失败:${result.error ?? ""}`);
    assert(
      warnings.some((message) => message.includes("[preview]") && message.includes("GBK")),
      `预览编码 warning 未进入主进程 warning sink:${JSON.stringify(warnings)}`,
    );
    const entry = [...previews].find((e) => e.mdPath === mdPath);
    assert(entry, "预览窗口应已登记到 previews");
    assert(previews.size === 1, `本段同一时刻只应有一个预览窗口,实际 ${previews.size}`);
    const openedHtml = await previewTempFiles(baseline);
    assert(openedHtml.length === 1, `打开后应恰好一个临时 HTML,实际 ${openedHtml.join(",")}`);

    // ---- 2. 并发刷新:两次请求只留最新一代(旧代回收、当前页不被删) ----
    const first = requestPreviewRefresh(entry);
    const second = requestPreviewRefresh(entry);
    await Promise.all([first, second]);
    assert(entry.generation === 2, `两次请求后代号应为 2,实际 ${entry.generation}`);
    const afterRefresh = await previewTempFiles(baseline);
    assert(
      afterRefresh.length === 1,
      `两次刷新后应只剩当前页一个临时 HTML(旧代须回收),实际 ${afterRefresh.join(",")}`,
    );
    const shownUrl = entry.win.webContents.getURL();
    assert(
      shownUrl === pathToFileURL(path.join(os.tmpdir(), afterRefresh[0])).href,
      `展示页应为最新一代临时文件,实际 ${shownUrl}`,
    );
    // 旧页不得后到覆盖新页:代号只前进不回退,当前页句柄与展示文件一致
    assert(
      (await fs.readFile(path.join(os.tmpdir(), afterRefresh[0]), "utf8")).includes("你好世界"),
      "当前页内容应来自最新一次渲染",
    );
    console.log("[ok] preview:并发刷新仅最新一代落地(旧代回收 + 展示页为最新)");

    // ---- 3. 失败刷新不影响既有页面(错误页不吞掉当前临时文件) ----
    await fs.rm(mdPath);
    await requestPreviewRefresh(entry);
    assert(
      (await previewTempFiles(baseline)).length === 1,
      "源文件缺失刷新失败后,当前页临时文件仍应由注册表持有",
    );
    assert(entry.cleanup !== null, "刷新失败不应清空当前页的清理句柄");
    await fs.writeFile(mdPath, "# 恢复\n", "utf8");
    await requestPreviewRefresh(entry);
    assert((await previewTempFiles(baseline)).length === 1, "恢复后刷新应仍只保留一个临时 HTML");
    console.log("[ok] preview:刷新失败保留当前页句柄/恢复后可继续刷新");

    // ---- 4. 窗口关闭后在途刷新安全退出(不 loadFile/不写注册表/不留文件) ----
    const closingEntry = entry;
    const generationBeforeClose = closingEntry.generation;
    const pending = requestPreviewRefresh(closingEntry); // 刷新在途(渲染尚未完成)
    assert(
      closingEntry.generation === generationBeforeClose + 1,
      "刷新请求应同步推进代号(旧代立即失效)",
    );
    closingEntry.win.destroy();
    await pending; // 关闭后本次刷新必须安全结算(不抛、不复活)
    assert(closingEntry.closed, "窗口关闭后 entry 应标记 closed");
    assert(closingEntry.cleanup === null, "窗口关闭应释放并清空当前页清理句柄");
    assert(previews.size === 0, `窗口关闭后应从 previews 注销,实际 ${previews.size}`);
    await waitNoTempHtml(baseline, "窗口关闭后");
    // 关闭后再请求刷新:立即安全返回,不新建窗口/临时文件
    await requestPreviewRefresh(closingEntry);
    assert((await previewTempFiles(baseline)).length === 0, "已关闭窗口的刷新请求不得产生临时文件");
    console.log("[ok] preview:窗口关闭后刷新安全退出(不 loadFile/不写注册表/无残留)");

    // ---- 5. loadFile 未 settle 时关闭窗口:该次刷新结算后无孤儿窗口与残留 ----
    const md2 = path.join(dir, "hang.md");
    await fs.writeFile(md2, "# 挂起\n", "utf8");
    const second2 = await openPreviewWindow(md2);
    assert(second2.ok, `第二次预览打开失败:${second2.error ?? ""}`);
    const entry2 = [...previews].find((e) => e.mdPath === md2);
    assert(entry2, "第二个预览窗口应已登记");
    const origLoadFile = Object.getPrototypeOf(entry2.win).loadFile;
    let releaseLoad;
    Object.getPrototypeOf(entry2.win).loadFile = function patched(file, options) {
      if (String(file).includes(`m2w-${process.pid}-`)) {
        return new Promise((resolve, reject) => {
          releaseLoad = () => {
            if (this.isDestroyed()) reject(new Error("window destroyed"));
            else resolve(origLoadFile.call(this, file, options));
          };
        });
      }
      return origLoadFile.call(this, file, options);
    };
    try {
      const hanging = requestPreviewRefresh(entry2);
      await waitFor(() => Promise.resolve(releaseLoad !== undefined), "loadFile 进入挂起态");
      entry2.win.destroy(); // loadFile 未 settle 即关闭
      releaseLoad(); // 释放挂起:随后必须走「窗口已关」分支而非复活
      await hanging;
      assert(entry2.closed && previews.size === 0, "关闭后应注销且不复活窗口");
      await waitNoTempHtml(baseline, "挂起刷新收尾后");
    } finally {
      Object.getPrototypeOf(entry2.win).loadFile = origLoadFile;
      if (!entry2.win.isDestroyed()) entry2.win.destroy();
    }
    await waitNoTempHtml(baseline, "本段结束");
    console.log("[ok] preview:loadFile 未 settle 即关闭窗口,刷新安全收尾无残留");

    // ---- 6. 打开后立刻刷新:初载后到不得覆盖刷新页(初次加载同样入串行队列) ----
    const md3 = path.join(dir, "race.md");
    await fs.writeFile(md3, "# 竞态\n", "utf8");
    const proto = Object.getPrototypeOf(entry2.win);
    const origLoad = proto.loadFile;
    let calls = 0;
    proto.loadFile = function patched(file, options) {
      calls += 1;
      if (calls !== 1) return origLoad.call(this, file, options);
      // 首次(打开时)加载延迟 400ms:让并发刷新有机会先完成,复现「初载后到」竞态
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (this.isDestroyed()) reject(new Error("window destroyed"));
          else resolve(origLoad.call(this, file, options));
        }, 400);
      });
    };
    try {
      const opening = openPreviewWindow(md3);
      await waitFor(() => Promise.resolve(calls === 1), "初次 loadFile 进入延迟");
      const entry3 = [...previews].find((e) => e.mdPath === md3);
      assert(entry3, "打开中的预览应已登记(刷新可排队到初载之后)");
      const refreshing = requestPreviewRefresh(entry3);
      await opening;
      await refreshing;
      const left = await previewTempFiles(baseline);
      assert(left.length === 1, `竞态刷新后应只剩刷新页一个临时 HTML,实际 ${left.join(",")}`);
      assert(
        entry3.win.webContents.getURL() === pathToFileURL(path.join(os.tmpdir(), left[0])).href,
        `展示页应为刷新后的页面(初载不得后到覆盖),实际 ${entry3.win.webContents.getURL()}`,
      );
      entry3.win.destroy();
      await waitNoTempHtml(baseline, "竞态刷新后");
    } finally {
      proto.loadFile = origLoad;
      for (const e of [...previews]) if (!e.win.isDestroyed()) e.win.destroy();
    }
    console.log("[ok] preview:打开后立刻刷新,初载后到不覆盖刷新页");
  } finally {
    console.warn = originalWarn;
    for (const e of [...previews]) e.win.destroy();
    await waitNoTempHtml(baseline, "段末");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
