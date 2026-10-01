// @ts-check
// 视觉自查工具 · 关于窗 preload 桩:
// 与主窗的 visual-preload.cjs 分开是口径决定的 —— about 窗的 webPreferences 是
// contextIsolation:true + sandbox:true(见 src/main/menu.ts showAboutDialog),
// 契约面也完全不同(只 aboutApi.openExternal / aboutApi.checkUpdate 两个方法)。
// 复用主窗桩会把两个窗口的隔离口径拍成同款,反而掩盖了真实差异。
"use strict";

// 预加载脚本是 CJS(sandbox 下没有 ESM 加载器),只能 require("electron") 取
// contextBridge。仓里同类放行集中在 eslint.config.js 的 files 块里登记(与
// src/renderer/about-preload.cjs 同一条),不在本文件就地 disable。
const { contextBridge } = require("electron");

/* ---------- 版本号与更新状态:取真实值 / 造「有更新」态 ---------- */

/**
 * 版本号由驱动侧 visual-check.mjs 经 webPreferences.additionalArguments 递进来。
 * 为什么不能在本桩里自己读 package.json:about 窗是 sandbox:true + about.html 带
 * `script-src 'self'` 的 CSP —— 实测该环境下 require("node:path") 与
 * import("node:path") 双双失败(CSP 拦掉动态 import,sandbox 不提供 node 内建)。
 * 故版本号的**唯一读取点**留在驱动侧(它是普通 Node ESM,读 package.json 无碍),
 * 本桩只接收结果,避免同一份 package.json 出现第二种读法。
 * @type {string}
 */
const VERSION_ARG = "--m2w-version=";

/** @type {string} */
const VERSION =
  (typeof process !== "undefined" && Array.isArray(process.argv)
    ? process.argv.find((a) => a.startsWith(VERSION_ARG))
    : undefined
  )?.slice(VERSION_ARG.length) || "0.0.0";

/**
 * 桩造「有可用更新」态而非「已是最新」。
 * 为什么:about 截图要展示更新提示 —— 它是产品卖点之一(docs/index.html 该图的 alt
 * 写的就是 "About window with update notification"),而「已是最新」态不渲染下载按钮,
 * 图文不符。latest 取比 current 高一位的补丁号,读起来像一次真实的小版本升级。
 * 字段名照 main 侧 aboutCheckUpdate 的返回契约与 about.ts 实际读取的字段
 * ({status,current,latest,url},见 src/main/ipc/register.ts),不新造结构。
 * @returns {Promise<{ status: "available"; current: string; latest: string; url: string }>}
 */
async function availableUpdate() {
  const parts = VERSION.split(".");
  const patch = Number(parts[2]);
  const latest = Number.isFinite(patch) ? `${parts[0]}.${parts[1]}.${patch + 1}` : VERSION;
  return {
    status: "available",
    current: VERSION,
    latest,
    // 与 main 侧同一下载落点(该仓 releases 页),不指向桩自身
    url: "https://github.com/chenchaodev/markdown-to-word/releases/latest",
  };
}

/**
 * 外链点击记账(截图期间绝不许真开浏览器)。
 * 桩只记账不发:真发出去就是拿人正在用的机器去开浏览器,且窗口一弹焦点就跳,
 * 后续 capturePage 拿到的是被遮挡/失焦的画面。
 * @type {string[]}
 */
const opened = [];

contextBridge.exposeInMainWorld("aboutApi", {
  /**
   * 外链桩:不落到 shell.openExternal,只记 url。
   * @param {string} url 目标地址
   * @returns {void}
   */
  openExternal: (url) => {
    opened.push(String(url));
  },
  /**
   * 更新检查桩:恒定「有可用更新」(理由见 availableUpdate 的注释)。
   * 绝不发网络请求 —— 真查一次的结果随时间与网络状况变(有/无新版本两态),
   * 同一份代码在两台机器上会拍出两张不同的图,截图就失去回归价值。
   * @returns {Promise<{ status: "available"; current: string; latest: string; url: string }>}
   */
  checkUpdate: availableUpdate,
});

// 控制面(离线驱动专用,非 about 契约):驱动侧据此断言外链确实被桩拦下,
// 而不是真被 shell.openExternal 放行。
contextBridge.exposeInMainWorld("__vcAbout", {
  /**
   * 取被桩拦下的外链列表。
   * @returns {string[]}
   */
  openedUrls: () => opened.slice(),
});
