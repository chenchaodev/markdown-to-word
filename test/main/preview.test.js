// @ts-check
/**
 * 预览窗口主进程段(src/main/windows/preview.ts,经 dist,electron 环境):
 * 断言面:
 * - 打开:GBK 准备 warning 进入主进程 warning sink,且不把打开流程变成未处理异常;
 * - 并发刷新:两次请求排队执行,只有最新一代落地 —— 旧代临时文件被回收、
 *   展示页即最新代(旧页不会后到覆盖新页),窗口当前临时文件不被提前删除;
 *   比对展示页前等导航真正提交(loadFile 结算 ≠ getURL 已更新,慢机上会读到上一代);
 * - 窗口关闭后刷新安全退出:关闭前的在途刷新不 loadFile、不写注册表、临时文件不残留;
 * - loadFile 未 settle 时关闭:该次刷新结算后不留孤儿窗口与临时文件。
 * 生命周期:本段跑在逐段独立的 Electron 子进程内(见 test/common/runner.js),窗口与
 * 临时 HTML 全程自持,finally 里逐个 destroy 并等回收落定,不依赖入口退出兜底。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import { openPreviewWindow, previews, requestPreviewRefresh } from "../../dist/main/windows/preview.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`preview 断言失败:${msg}`);
}

/**
 * 登记表当前大小(经函数取值:前一次 `assert(size === N)` 会把 size 收窄成字面量,
 * 而两次断言之间实现会增删登记项——直接再比较会误报「无交集」)。
 * @param {{ size: number }} registry 登记表(previews)
 * @returns {number} 当前大小
 */
const registrySize = (registry) => registry.size;

/**
 * 等待条件成立(轮询上限兜底,避免死等掩盖断言失败)。
 * @param {() => boolean | Promise<boolean>} predicate 判定函数
 * @param {string} label 等待目标(超时消息用)
 * @param {number} [timeoutMs] 超时上限
 * @returns {Promise<void>} 条件成立即返回
 */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`preview 断言失败:等待超时(${label})`);
}

/** 导航提交等待上限:CI 上渲染 + 磁盘 IO 明显慢于本机,给足余量;到点仍未提交即判红 */
const NAV_COMMIT_TIMEOUT_MS = 20_000;

/**
 * 窗口当前展示的文件路径;非 file: URL(如 data: 错误页顶上来)记 null。
 * 判定按「文件路径」而非 URL 字符串比:pathToFileURL 会把 8.3 短路径里的 ~ 编码成
 * %7E,而 Chromium 的 getURL() 原样保留 ~ —— 两侧字符串在 Windows runner(TEMP 是
 * C:\Users\RUNNER~1\...) 上必然不等,那是编码策略差异而非展示错了页面。
 * @param {string} url webContents.getURL()
 * @returns {string | null} 文件路径(非 file: URL 记 null)
 */
function shownFilePath(url) {
  if (!url.startsWith("file:")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null; // 非法 file URL:同样按「不是目标文件」处理
  }
}

/**
 * 等到窗口真正提交了 expectedFile 那一次导航(仍是旧页就继续等),再交调用方断言。
 * 为什么要等:刷新队列结算(loadFile 的 Promise resolve)与 webContents 提交导航之间
 * 存在时序差 —— getURL() 在本机几乎无差,慢机/CI 上仍停在上一代页面,立即读会把
 * 「旧代已回收」误判成「展示页不是最新一代」。固定 sleep 在 CI 上同样会抖,故有界轮询。
 * 超时即抛错(绝不静默通过),消息带期望文件、实际 URL/文件、已等待时长与窗口存活状态。
 * @param {{ webContents: { getURL: () => string }; isDestroyed: () => boolean }} win 目标窗口
 * @param {string} expectedFile 期望展示的临时文件绝对路径
 * @param {string} label 场景标签(消息用)
 * @returns {Promise<string>} 提交时的 URL(交调用方断言)
 */
async function waitForShownFile(win, expectedFile, label) {
  const startedAt = Date.now();
  let url = win.webContents.getURL();
  while (shownFilePath(url) !== expectedFile && Date.now() - startedAt < NAV_COMMIT_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 25));
    url = win.webContents.getURL();
  }
  if (shownFilePath(url) !== expectedFile) {
    throw new Error(
      `preview 断言失败:${label}:展示页未在 ${NAV_COMMIT_TIMEOUT_MS}ms 内提交为当前代临时文件(超时)\n` +
        `  期望文件:${expectedFile}\n  实际 URL:${url}\n` +
        `  实际文件:${shownFilePath(url) ?? "(非 file: URL)"}\n` +
        `  已等待:${Date.now() - startedAt}ms\n  窗口已销毁:${win.isDestroyed()}`,
    );
  }
  return url;
}

/**
 * 本进程全部临时 HTML(writeTempHtml 命名 m2w-{pid}-*)。
 * @returns {Promise<string[]>} 文件名列表
 */
async function tempHtmlFiles() {
  const names = await fs.readdir(os.tmpdir());
  return names.filter((n) => n.startsWith(`m2w-${process.pid}-`) && n.endsWith(".html"));
}

/**
 * 本段新增的临时 HTML(排除段起点就存在的文件)。
 * 逐段子进程隔离后本进程只有本段的临时文件(临时文件按 m2w-{pid}- 命名),基线集
 * 实际为空;仍按基线取差集,是为了断言只针对本段产物,不把"进程里别人的文件"算进失败面。
 * @param {Set<string>} baseline 段起点已有的临时文件名
 * @returns {Promise<string[]>} 本段新增的临时文件名
 */
async function previewTempFiles(baseline) {
  return (await tempHtmlFiles()).filter((n) => !baseline.has(n));
}

/**
 * 等待本段新增的临时 HTML 全部回收(窗口关闭路径的删除是 fire-and-forget,需轮询落定)。
 * @param {Set<string>} baseline 段起点已有的临时文件名
 * @param {string} label 场景标签(消息用)
 * @returns {Promise<void>} 全部回收即返回
 */
async function waitNoTempHtml(baseline, label) {
  const deadline = Date.now() + 3000;
  let left = await previewTempFiles(baseline);
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    left = await previewTempFiles(baseline);
  }
  assert(left.length === 0, `${label}:临时 HTML 应全部回收,实际 ${left.join(",")}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-preview-"));
  const baseline = new Set(await tempHtmlFiles());
  const originalWarn = console.warn;
  const warnings = /** @type {string[]} */ ([]);
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
    const [currentHtml] = afterRefresh;
    assert(currentHtml !== undefined, "两次刷新后应恰好剩一个当前页临时 HTML");
    // 等导航真正提交再比对(而非刷新 Promise 结算即读):慢机上 getURL 可能仍停在
    // 上一代,那会把「旧代已回收」误判成「展示页不是最新一代」
    const expectedFile = path.join(os.tmpdir(), currentHtml);
    const shownUrl = await waitForShownFile(entry.win, expectedFile, "并发刷新后");
    assert(
      shownFilePath(shownUrl) === expectedFile,
      `展示页应为最新一代临时文件(${expectedFile}),实际 ${shownUrl}`,
    );
    // 旧页不得后到覆盖新页:代号只前进不回退,当前页句柄与展示文件一致
    assert(
      (await fs.readFile(path.join(os.tmpdir(), currentHtml), "utf8")).includes("你好世界"),
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
    assert(registrySize(previews) === 0, `窗口关闭后应从 previews 注销,实际 ${previews.size}`);
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
    /** @type {(() => void) | undefined} */
    let releaseLoad;
    Object.getPrototypeOf(entry2.win).loadFile = function patched(
      /** @type {string} */ file,
      /** @type {unknown} */ options,
    ) {
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
      assert(releaseLoad !== undefined, "loadFile 应已进入挂起态并交出释放句柄");
      entry2.win.destroy(); // loadFile 未 settle 即关闭
      releaseLoad(); // 释放挂起:随后必须走「窗口已关」分支而非复活
      await hanging;
      assert(entry2.closed && registrySize(previews) === 0, "关闭后应注销且不复活窗口");
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
    proto.loadFile = function patched(
      /** @type {string} */ file,
      /** @type {unknown} */ options,
    ) {
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
      const [raceHtml] = left;
      assert(raceHtml !== undefined, "竞态刷新后应恰好剩一个刷新页临时 HTML");
      // 同上:等刷新页的导航真正提交再比对,否则慢机上读到的是初载页
      const raceExpectedFile = path.join(os.tmpdir(), raceHtml);
      const raceShownUrl = await waitForShownFile(entry3.win, raceExpectedFile, "竞态刷新后");
      assert(
        shownFilePath(raceShownUrl) === raceExpectedFile,
        `展示页应为刷新后的页面(初载不得后到覆盖),实际 ${raceShownUrl}`,
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
