// 视觉自查工具 · preload(UI 改版 v4r1 配套):
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

let nextOpen = [];

const api = new Proxy(
  {
    appVersion: async () => "0.0.0-visual",
    getVersion: async () => "0.0.0-visual",
    settingsGet: async () => ({}),
    settingsSet: async (patch) => patch,
    uiStateGet: async () => uiState(),
    uiStateSet: async (patch) => ({ ...uiState(), ...patch }),
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
    get(target, prop) {
      if (prop in target) return target[prop];
      return async () => undefined;
    },
  },
);

window.api = api;
window.__vc = {
  /** 设定下一次「选择文件」对话框返回的路径列表(消费即清空)。 */
  setNextOpen(files) {
    nextOpen = files;
  },
};
