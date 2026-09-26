// @ts-check
/**
 * 活动操作 single-flight 直测(真实异步 IPC handler 并发;
 * src/main/ipc/register.ts + src/main/windows/web-contents-registry.ts,
 * 经 dist/ 直调,运行于 Electron 主进程):
 *
 * 与 ipc-register.test.js 的区别(勿互相替代):那段用手工预占注册表验证 busy
 * 形状,本段**真实并发调用 handler**——同一 webContents 上一次 tick 内连发多个
 * 转换/预检/批量/合并请求,断言首个占用成功、其余全部明确 busy,且飞行期间
 * 注册表内始终只有一个 context(最大活动操作数 = 1)。
 * 事件源为真实 BrowserWindow 的 webContents(而非桩对象),故 handler 内的
 * BrowserWindow.fromWebContents 解析与 progress 推送均走真实路径。
 *
 * 断言面:
 * - 真实并发突发:1 个 convertSingle 飞行中 + 5 个混合请求 → 恰 1 个非 busy,
 *   busy 结果形状稳定(三键 / 批量并接计数字段),飞行采样中 context 恒定;
 * - 取消:飞行中 convert:cancel 指向当前操作 → { ok:false, canceled:true },
 *   注册表释放,后续请求不被悬挂注册阻塞;
 * - 预检异常:缺文件/目录不再静默返回空数组,而是单条可观察失败警告
 *   (key=warn.precheckFailed)且主进程留痕;合法文件的正常警告仍原样返回。
 *
 * 生命周期:本段跑在逐段独立的 Electron 子进程内(见 test/common/runner.js),自建
 * BrowserWindow 作事件源并在 finally 销毁,注册表占用与产物目录均段内自持,
 * 不依赖入口退出兜底,也不假设任何跨段状态。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { registerIpc } from "../../dist/main/ipc/register.js";
import { IPC_CHANNELS as CH } from "../../dist/main/ipc/channels.js";
import {
  getWebContentsOperation,
  hasWebContentsOperation,
} from "../../dist/main/windows/web-contents-registry.js";
import { updateSettings } from "../../dist/main/persist/settings.js";
import { backupSettings } from "../common/settings.js";
import { FIXTURES_DIR } from "../common/paths.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`operation-single-flight 断言失败:${msg}`);
}

/** busy 键集合精确断言(形状稳定:多键/缺键均属契约漂移) */
const BUSY_KEYS = ["busy", "error", "ok"].sort().join(",");
const BATCH_BUSY_KEYS = ["busy", "canceledCount", "error", "failCount", "items", "ok", "okCount"]
  .sort()
  .join(",");

/**
 * busy 键集合精确断言(形状稳定:多键/缺键均属契约漂移)
 * @param {{ ok?: unknown, busy?: unknown, error?: unknown } | null} result busy 结果
 * @param {string} msg 场景标签(消息用)
 * @param {string} [expectedKeys] 期望的键集合(排序后逗号串)
 * @returns {void}
 */
function assertBusy(result, msg, expectedKeys = BUSY_KEYS) {
  assert(
    result !== null && typeof result === "object" && !Array.isArray(result),
    `${msg}:busy 结果应为对象(实际 ${JSON.stringify(result)})`,
  );
  assert(result.ok === false && result.busy === true, `${msg}:应含 ok:false + busy:true`);
  assert(typeof result.error === "string" && result.error.length > 0, `${msg}:应含可读 error 文案`);
  assert(
    Object.keys(result).sort().join(",") === expectedKeys,
    `${msg}:busy 键集合应稳定为 [${expectedKeys}](实际 [${Object.keys(result).sort().join(",")}])`,
  );
}

/**
 * 捕获 handler 表:临时把 ipcMain.handle 换成只记录不注册,
 * 既拿到与生产完全相同的 handler 引用,又不重复注册触发 Electron 报错
 * (registerIpc 全文只有 handle 注册,无其他副作用)。
 */
function captureHandlers() {
  const handlers = new Map();
  const originalHandle = ipcMain.handle;
  ipcMain.handle = (channel, fn) => {
    handlers.set(channel, fn);
  };
  try {
    registerIpc();
  } finally {
    ipcMain.handle = originalHandle;
  }
  return handlers;
}

/** 让出事件循环一拍(采样飞行中的注册表状态) */
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-singleflight-"));
  const restoreSettings = await backupSettings();
  /** @type {BrowserWindow | null} */
  let win = null;
  try {
    const sample = await fs.readFile(path.join(FIXTURES_DIR, "main", "converter-sample.md"), "utf8");
    const md = path.join(dir, "single-flight.md");
    const precheckMd = path.join(dir, "precheck.md");
    await fs.writeFile(md, sample, "utf8");
    // 未标注语言的代码块 → 预检正常警告(断言成功路径不被失败契约影响)
    await fs.writeFile(precheckMd, "# 预检\n\n```\n无语言代码块\n```\n", "utf8");
    // 产物写回源目录 + 不触发 afterConvert(测试环境零外部副作用)
    await updateSettings({ outputDir: "", afterConvert: "none" });

    win = new BrowserWindow({ show: false, width: 320, height: 240 });
    await win.loadURL("data:text/html,<title>single-flight</title>");
    const senderId = win.webContents.id;
    const event = { sender: win.webContents };
    const handlers = captureHandlers();

    // ---------- 1. 真实并发突发:飞行中最大活动操作数为 1 ----------
    const pending = handlers.get(CH.convertSingle)(event, md, "docx");
    // 占用在调用栈内同步完成(注册前无 await):首个请求返回时已在飞行
    const firstOp = getWebContentsOperation(senderId);
    assert(firstOp !== undefined, "首个 convertSingle 应在返回前完成注册表占用");
    assert(firstOp.kind === "single", `首个操作类型应为 single(实际 ${firstOp.kind})`);

    // 同一 tick 内连发其余请求(不 await 首个):双击/Ctrl+Enter/预检中再转换的并发面
    const others = [
      handlers.get(CH.convertSingle)(event, md, "pdf"),
      handlers.get(CH.convertPrecheck)(event, md),
      handlers.get(CH.convertBatch)(event, [md], "docx"),
      handlers.get(CH.convertMerge)(event, [md], "docx"),
      handlers.get(CH.convertPrecheck)(event, precheckMd),
    ];
    // 飞行采样:注册表内始终是同一个 context(后继请求既不新增也不替换)
    const samples = /** @type {(object | null)[]} */ ([]);
    let settled = false;
    const sampler = (async () => {
      while (!settled) {
        samples.push(getWebContentsOperation(senderId)?.context ?? null);
        await nextTick();
      }
    })();
    const [first, ...rest] = await Promise.all([pending, ...others]);
    settled = true;
    await sampler;

    const observed = samples.filter((ctx) => ctx !== null);
    assert(observed.length > 0, "飞行期间应至少采样到一次活动操作");
    assert(
      observed.every((ctx) => ctx === firstOp.context),
      "飞行期间活动 context 恒定(后继请求不得替换已占用 context)",
    );
    assert(first.ok === true && typeof first.outputPath === "string" && first.busy === undefined,
      `首个请求应正常完成转换(实际 ${JSON.stringify(first)})`);
    assert(!hasWebContentsOperation(senderId), "全部请求结束后注册表应为空");
    assertBusy(rest[0], "并发 convertSingle");
    assertBusy(rest[1], "并发 convertPrecheck");
    assertBusy(rest[2], "并发 convertBatch", BATCH_BUSY_KEYS);
    assertBusy(rest[3], "并发 convertMerge");
    assertBusy(rest[4], "并发 convertPrecheck(第二次)");
    console.log(
      `[ok] single-flight:真实并发 ${others.length + 1} 请求 → 1 执行 + ${others.length} busy(飞行采样 context 恒定)`,
    );

    // ---------- 2. 取消指向当前操作,结束后不复位为悬挂占用 ----------
    const canceling = handlers.get(CH.convertSingle)(event, md, "docx");
    assert(hasWebContentsOperation(senderId), "取消前应存在活动操作");
    const canceled = handlers.get(CH.convertCancel)(event); // 同步置位当前 ctx
    assert(canceled === undefined, "convert:cancel 无返回值(void)");
    const cancelResult = await canceling;
    assert(
      cancelResult.ok === false && cancelResult.canceled === true && cancelResult.busy === undefined,
      `飞行中取消应返回 { ok:false, canceled:true }(实际 ${JSON.stringify(cancelResult)})`,
    );
    assert(!hasWebContentsOperation(senderId), "取消完成后注册表应释放(不悬挂阻塞后续)");
    // 复位验证:取消后再次请求正常执行
    const afterCancel = await handlers.get(CH.convertPrecheck)(event, precheckMd);
    assert(Array.isArray(afterCancel) && afterCancel.length > 0,
      `取消后再次预检应正常返回警告(实际 ${JSON.stringify(afterCancel)})`);
    console.log("[ok] single-flight:飞行中取消 → canceled 结果 + 注册表释放 + 后续请求可执行");

    // ---------- 3. 预检异常可观察(不再静默空数组),正常警告语义不变 ----------
    const logged = /** @type {string[]} */ ([]);
    const originalError = console.error;
    console.error = (...args) => logged.push(args.map((a) => String(a)).join(" "));
    let missingResult;
    try {
      missingResult = await handlers.get(CH.convertPrecheck)(event, path.join(dir, "missing.md"));
    } finally {
      console.error = originalError;
    }
    assert(Array.isArray(missingResult) && missingResult.length === 1,
      `缺文件预检应返回单条失败警告而非空数组(实际 ${JSON.stringify(missingResult)})`);
    const failure = missingResult[0];
    assert(
      typeof failure === "object" && failure.key === "warn.precheckFailed" &&
        typeof failure.fallback === "string" && failure.fallback.includes("预检失败"),
      `失败警告应携带可展示文案(实际 ${JSON.stringify(failure)})`,
    );
    assert(
      logged.some((line) => line.includes("convert:precheck 失败") && line.includes("missing.md")),
      `主进程应留痕预检失败(实际日志 ${JSON.stringify(logged)})`,
    );
    const dirResult = await handlers.get(CH.convertPrecheck)(event, dir);
    assert(Array.isArray(dirResult) && dirResult.length === 1 && dirResult[0].key === "warn.precheckFailed",
      `目录入参预检失败同样应可观察(实际 ${JSON.stringify(dirResult)})`);
    const normalKeys = afterCancel.map((w) => (typeof w === "string" ? w : w.key));
    assert(
      normalKeys.every((k) => k !== "warn.precheckFailed"),
      "合法文件的正常警告不应被失败警告污染",
    );
    console.log("[ok] precheck 契约:失败单条可观察警告 + 主进程留痕;正常警告语义不变");
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await restoreSettings.restore();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
