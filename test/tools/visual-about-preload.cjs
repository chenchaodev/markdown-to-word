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

/** 版本号取桩值而非 app.getVersion():后者随仓库 package.json 变动,截图不可复现 */
const VERSION = "0.0.0-visual";

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
   * 更新检查桩:恒定「已是最新」。
   * 绝不发网络请求 —— 真查一次的结果随时间与网络状况变(有/无新版本两态),
   * 同一份代码在两台机器上会拍出两张不同的图,截图就失去回归价值。
   * @returns {Promise<{ status: "latest", current: string }>}
   */
  checkUpdate: async () => ({ status: "latest", current: VERSION }),
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
