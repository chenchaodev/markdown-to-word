// @ts-check
// 视觉自查工具 · preload:
// contextIsolation 关闭后与页面同世界,先于 renderer.js 注入 window.api 桩,
// 使界面可离线驱动到各舞台状态;window.__vc 暴露测试控制面(下一次对话框返回值等)。
"use strict";

const recentBase = () => [
  {
    path: "C:\\demo\\季度报告.md",
    name: "季度报告.md",
    format: "docx",
    ts: Date.now() - 1000 * 60 * 42,
  },
  {
    path: "C:\\demo\\产品说明书.md",
    name: "产品说明书.md",
    format: "pdf",
    ts: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    path: "C:\\demo\\会议纪要.md",
    name: "会议纪要.md",
    format: "docx",
    ts: Date.now() - 1000 * 60 * 60 * 24 * 3,
  },
];

const uiState = () => ({
  recentFiles: recentBase(),
  lastSessionFiles: [],
  panelOpen: { page: false },
  suppressCompleteDialog: false,
});

/** 「选择文件」对话框的下一次返回值(消费即清空);控制面 window.__vc.setNextOpen 写入 */
/** @type {string[]} */
let nextOpen = [];

const api = new Proxy(
  {
    appVersion: async () => "0.0.0-visual",
    getVersion: async () => "0.0.0-visual",
    settingsGet: async () => ({}),
    /** @param {unknown} patch 设置补丁 @returns {Promise<unknown>} */
    settingsSet: async (patch) => patch,
    uiStateGet: async () => uiState(),
    /** @param {Record<string, unknown>} patch 界面状态补丁 @returns {Promise<unknown>} */
    uiStateSet: async (patch) => ({ ...uiState(), ...patch }),
    /** @param {string[]} paths 路径列表 @returns {Promise<string[]>} */
    filterExistingPaths: async (paths) => paths,
    openMarkdowns: async () => nextOpen.splice(0),
    selectDir: async () => null,
    selectHeaderLogo: async () => null,
    revealInFolder: async () => ({ ok: true }),
    openPreview: async () => ({ ok: true }),
    previewRefresh: async () => undefined,
    importPresets: async () => ({ ok: true, canceled: true }),
    exportPresets: async () => ({ ok: true, canceled: true }),
    importPdfCss: async () => ({ ok: true, canceled: true }),
    convertSingle: async () => ({ ok: false, error: "visual-stub" }),
    convertMerge: async () => ({ ok: false, error: "visual-stub" }),
  },
  {
    /** 桩表未登记的通道一律回 undefined(不抛),页面侧按可选能力处理
     * @param {Record<string, unknown>} target 桩表
     * @param {string | symbol} prop 通道名
     * @returns {unknown}
     */
    get(target, prop) {
      const stub = /** @type {Record<string | symbol, unknown>} */ (target);
      if (prop in stub) return stub[prop];
      return async () => undefined;
    },
  },
);

// 页面侧控制面(contextIsolation 关闭,桩与 renderer 同世界;两个键为离线驱动专用,非 renderer 契约)
const vcGlobal = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
vcGlobal.api = api;
vcGlobal.__vc = {
  /** 设定下一次「选择文件」对话框返回的路径列表(消费即清空)。
   * @param {string[]} files 绝对路径列表
   * @returns {void}
   */
  setNextOpen(files) {
    nextOpen = files;
  },
};
