/**
 * 关窗放弃流程测试(src/main/windows/main-window.ts 的 runCloseAbortFlow +
 * confirmCloseDuringConvert,配合 src/main/windows/web-contents-registry.ts;
 * 经 dist/ 直调,运行于 Electron 主进程):
 *
 * 关窗期是 single-flight 最容易出错的时序(确认弹窗、取消、任务 finally 释放、
 * 新任务抢占同一 webContents、超时兜底),故把判定从 Electron 壳里抽成
 * runCloseAbortFlow(依赖注入),此处两路断言:
 * - 纯流程层(假 deps,时间轴可压缩):确认/销毁/无活动/等待释放/超时强杀/
 *   「旧操作已释放但新任务又占用」的交错,逐条断言结局与副作用集合;
 * - 真实层(真窗口 + 真 dialog 桩 + 真注册表):keep 选择不取消不关窗且不残留
 *   close 放行标记;abort 选择取消真实飞行中的转换,待其 finally 释放后关窗。
 * 另含注册表级交错:旧 token 的 compare-and-delete 不得删除新任务 context。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  confirmCloseDuringConvert,
  runCloseAbortFlow,
} from "../../dist/main/windows/main-window.js";
import {
  beginWebContentsOperation,
  cancelWebContentsOperation,
  finishWebContentsOperation,
  getWebContentsOperation,
  hasWebContentsOperation,
} from "../../dist/main/windows/web-contents-registry.js";
import { registerIpc } from "../../dist/main/ipc/register.js";
import { IPC_CHANNELS as CH } from "../../dist/main/ipc/channels.js";
import { updateSettings } from "../../dist/main/persist/settings.js";
import { backupSettings } from "../common/settings.js";
import { FIXTURES_DIR } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`window-close-abort 断言失败:${msg}`);
}

const POLL = 100;

/**
 * 假流程依赖:状态机 + 调用记录。
 * active = 当前 webContents 上的活动操作数(关窗判定只看存在性);
 * delay 每次推进时钟 pollMs 并执行一步计划,用于压缩 30s 超时为毫秒级。
 */
function makeFlow(options = {}) {
  const state = {
    clock: 0,
    active: options.active ?? 1,
    destroyed: options.destroyed ?? false,
  };
  const calls = [];
  const delays = [];
  const plan = options.plan ?? [];
  let step = 0;
  const deps = {
    confirm: async () => {
      calls.push("confirm");
      const answer = typeof options.confirm === "function" ? options.confirm(state) : options.confirm !== false;
      return answer;
    },
    isDestroyed: () => {
      calls.push("isDestroyed");
      return state.destroyed;
    },
    hasOperation: () => {
      calls.push("hasOperation");
      return state.active > 0;
    },
    cancelOperation: () => {
      calls.push("cancel");
      if (options.releaseOnCancel) state.active = 0;
    },
    now: () => {
      calls.push("now");
      return state.clock;
    },
    delay: async (ms) => {
      delays.push(ms);
      state.clock += ms;
      const next = plan[step++];
      if (next) next(state, calls);
    },
    close: () => calls.push("close"),
    destroy: () => {
      state.destroyed = true;
      calls.push("destroy");
    },
  };
  return { deps, calls, delays, state };
}

const countCall = (calls, name) => calls.filter((c) => c === name).length;

export async function run() {
  // ---------- 1. 纯流程层:确认与销毁分支 ----------
  {
    const { deps, calls } = makeFlow({ destroyed: true });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "destroyed",
      "窗口已销毁时应直接结束,不弹确认");
    assert(countCall(calls, "confirm") === 0 && countCall(calls, "close") === 0,
      "已销毁分支不应弹确认也不应关窗");
  }
  {
    const { deps, calls } = makeFlow({ confirm: false });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "keep",
      "用户选择继续转换应返回 keep");
    assert(countCall(calls, "cancel") === 0 && countCall(calls, "close") === 0 && countCall(calls, "destroy") === 0,
      "keep 分支不得取消/关窗/强杀(转换继续)");
  }
  {
    // 弹窗期间窗口被外部关闭:不动作,不得再 cancel/close
    const { deps, calls } = makeFlow({ confirm: (state) => (state.destroyed = true) });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "destroyed",
      "确认后窗口已销毁应返回 destroyed");
    assert(countCall(calls, "cancel") === 0 && countCall(calls, "close") === 0 && countCall(calls, "destroy") === 0,
      "确认后已销毁分支不应再动窗口");
  }
  console.log("[ok] close-abort:已销毁/keep/确认后销毁 三分支判定与副作用集合 断言通过");

  // ---------- 2. 无活动操作:直接关闭,不 cancel 不等待 ----------
  {
    const { deps, calls, delays } = makeFlow({ active: 0 });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "idle",
      "放弃时无活动操作应返回 idle");
    assert(countCall(calls, "cancel") === 0 && delays.length === 0, "idle 分支不应 cancel/轮询");
    assert(countCall(calls, "close") === 1 && countCall(calls, "destroy") === 0, "idle 分支应恰好 close 一次");
  }
  // ---------- 3. 等待释放:轮询到 ctx 释放后正常关闭 ----------
  {
    const { deps, calls, delays } = makeFlow({
      plan: [null, (state) => { state.active = 0; }],
      releaseOnCancel: false,
    });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "closed",
      "活动操作释放后应正常关闭");
    assert(countCall(calls, "cancel") === 1, "放弃转换应恰好 cancel 一次");
    assert(delays.length === 2 && delays.every((ms) => ms === POLL), `应按 pollMs 轮询两次(实际 ${delays})`);
    assert(countCall(calls, "close") === 1 && countCall(calls, "destroy") === 0, "释放后走 close 而非 destroy");
  }
  // ---------- 4. 超时兜底:未释放则强杀 ----------
  {
    const { deps, calls, delays } = makeFlow({ releaseOnCancel: false });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 300 })) === "forced",
      "超时未释放应强杀窗口");
    assert(delays.length === 3, `300ms/100ms 轮询应恰好 3 次(实际 ${delays.length})`);
    assert(countCall(calls, "destroy") === 1 && countCall(calls, "close") === 0, "超时分支应 destroy 且不 close");
  }
  // ---------- 5. 交错:旧操作释放后新任务占用 → 继续等待,不半路关窗 ----------
  {
    const freshCall = [];
    const { deps, calls } = makeFlow({
      releaseOnCancel: false,
      plan: [
        (state) => {
          state.active = 0; // 旧操作 finally 释放
          state.active = 1; // 同一 webContents 立刻被新任务占用
          freshCall.push(...calls);
        },
        null,
        (state) => { state.active = 0; },
      ],
    });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 500 })) === "closed",
      "新任务结束后才应关闭");
    assert(!freshCall.includes("close"), "新任务占用期间不得关窗(避免半路销毁)");
    assert(countCall(calls, "close") === 1, "新任务释放后恰好关闭一次");
  }
  // ---------- 6. 轮询期间窗口被销毁:停止等待且不再动窗口 ----------
  {
    const { deps, calls, delays } = makeFlow({
      releaseOnCancel: false,
      plan: [(state) => { state.active = 0; state.destroyed = true; }],
    });
    assert((await runCloseAbortFlow(deps, { pollMs: POLL, timeoutMs: 500 })) === "destroyed",
      "轮询期间窗口销毁应停止流程");
    assert(delays.length === 1, "销毁后应立即停止轮询");
    assert(countCall(calls, "close") === 0 && countCall(calls, "destroy") === 0, "已销毁后不得再关/杀");
  }
  console.log("[ok] close-abort:无活动/等待释放/超时强杀/新任务交错/轮询中销毁 判定 断言通过");

  // ---------- 7. 注册表级交错:取消 → 释放 → 新任务 → 旧 token 不得误删 ----------
  {
    const id = 9101;
    const ctxA = { canceled: 0, cancel() { this.canceled++; } };
    const tokenA = beginWebContentsOperation(id, "single", ctxA);
    assert(tokenA !== null && hasWebContentsOperation(id), "首个操作应占用成功");
    assert(cancelWebContentsOperation(id) === true && ctxA.canceled === 1, "放弃转换应取消当前操作一次");
    assert(cancelWebContentsOperation(id) === true && ctxA.canceled === 2, "注册仍在时重复取消仍指向当前操作");
    assert(finishWebContentsOperation(id, tokenA) === true, "旧任务 finally 应释放自身 token");
    const ctxB = { canceled: 0, cancel() { this.canceled++; } };
    const tokenB = beginWebContentsOperation(id, "precheck", ctxB);
    assert(tokenB !== null, "旧操作释放后同 id 应可被新任务占用");
    assert(finishWebContentsOperation(id, tokenA) === false, "旧 token 的 compare-and-delete 应被拒绝");
    assert(getWebContentsOperation(id)?.context === ctxB, "新任务 context 不得被旧 token 删除");
    assert(finishWebContentsOperation(id, tokenB) === true && !hasWebContentsOperation(id), "新任务释放后注册表为空");
    console.log("[ok] registry 交错:取消指向当前操作/旧 token 不误删新 context 断言通过");
  }

  // ---------- 8. 真实层:确认选择 → 取消真实飞行中的转换 → 关窗 ----------
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-closeabort-"));
  const restoreSettings = await backupSettings();
  /** @type {BrowserWindow | null} */
  let win = null;
  const realShowMessageBox = dialog.showMessageBox;
  const dialogCalls = [];
  try {
    const sample = await fs.readFile(path.join(FIXTURES_DIR, "main", "converter-sample.md"), "utf8");
    const md = path.join(dir, "close-abort.md");
    await fs.writeFile(md, sample, "utf8");
    await updateSettings({ outputDir: "", afterConvert: "none" });

    // 捕获 handler(只记录不注册,避免与既有注册冲突)
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

    win = new BrowserWindow({ show: false, width: 320, height: 240 });
    await win.loadURL("data:text/html,<title>close-abort</title>");
    const senderId = win.webContents.id;
    const event = { sender: win.webContents };

    // 8.1 keep 选择:不取消、不关窗、不残留 close 放行标记(下次仍弹确认)
    const keepCtx = { canceled: 0, cancel() { this.canceled++; } };
    const keepToken = beginWebContentsOperation(senderId, "single", keepCtx);
    dialog.showMessageBox = async () => {
      dialogCalls.push("keep");
      return { response: 0 };
    };
    try {
      await confirmCloseDuringConvert(win);
      assert(keepCtx.canceled === 0, "keep 选择不应取消进行中的转换");
      assert(!win.isDestroyed(), "keep 选择不应关窗");
      await confirmCloseDuringConvert(win);
      assert(dialogCalls.length === 2, "keep 分支不得残留 close 放行标记(第二次关闭仍应弹确认)");
      assert(!win.isDestroyed() && keepCtx.canceled === 0, "重复确认后仍不应动转换与窗口");
    } finally {
      finishWebContentsOperation(senderId, keepToken);
    }

    // 8.2 abort 选择:取消真实飞行中的转换,待 finally 释放后关窗
    dialog.showMessageBox = async () => {
      dialogCalls.push("abort");
      return { response: 1 };
    };
    const pending = handlers.get(CH.convertSingle)(event, md, "docx");
    assert(hasWebContentsOperation(senderId), "真实转换应已占用注册表");
    await confirmCloseDuringConvert(win);
    const result = await pending;
    assert(result.ok === false && result.canceled === true, `放弃并关闭应使转换返回 canceled(实际 ${JSON.stringify(result)})`);
    assert(!hasWebContentsOperation(senderId), "转换结束后注册表应释放");
    const deadline = Date.now() + 5000;
    while (!win.isDestroyed() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(win.isDestroyed(), "活动操作释放后窗口应被关闭");
    console.log("[ok] close-abort 真实层:keep 不动转换/两次仍弹确认;abort 取消真实转换后关窗 断言通过");
  } finally {
    dialog.showMessageBox = realShowMessageBox;
    if (win && !win.isDestroyed()) win.destroy();
    await restoreSettings.restore();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
