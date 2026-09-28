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
  // 「不再提示」置开:否则转换一成功就叠一层模态完成弹窗,把常驻汇总条整个盖住,
  // 而汇总条(outputPath + 可折叠警告)正是完成态唯一值得看的画面
  suppressCompleteDialog: true,
});

/** 「选择文件」对话框的下一次返回值(消费即清空);控制面 window.__vc.setNextOpen 写入 */
/** @type {string[]} */
let nextOpen = [];

/** 转换桩的缺省返回值:确定的失败结果,页面走真实失败路径而非静默停在转换中 */
const CONVERT_STUB_DEFAULT = { ok: false, error: "visual-stub" };

/** 下一次单文件转换(convert)的返回值(消费即清空);控制面 window.__vc.setNextConvert 写入 */
/** @type {Record<string, unknown>} */
let nextConvert = CONVERT_STUB_DEFAULT;

/**
 * 取一次转换桩值并复位(与 openMarkdowns 的 nextOpen 消费口径一致):
 * 消费即清空,后续转换回到缺省失败值,不会把上一次的成功结果带进下一张截图。
 * @returns {Promise<Record<string, unknown>>}
 */
async function takeConvert() {
  const value = nextConvert;
  nextConvert = CONVERT_STUB_DEFAULT;
  return value;
}

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
    // 预检恒返回空警告数组:走真实预检链(无告警则静默放行),完成态才走的是
    // 与线上一致的代码路径,而不是被内联 try/catch 吞掉的意外
    precheck: async () => [],
    // 键名对齐 preload.cts 暴露的 convert / convertBatch / convertMerge:
    // 页面侧(convert/convert-flow.ts)只认这三个名字,写成 convertSingle 会被
    // 下面的 Proxy 兜底吃掉、返回 undefined,桩值根本到不了页面
    convert: takeConvert,
    convertMerge: takeConvert,
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
  /**
   * 设定下一次单文件转换的返回值(消费即清空)。
   * 形状按 src/core/ipc-contract.ts 的 ConvertResult 契约({ok, outputPath, warnings});
   * 页面的完成态整条链(状态行 / 汇总条 / 警告折叠区)都由这份返回值驱动,
   * 不另造假 DOM。
   * @param {Record<string, unknown>} result ConvertResult 形状的返回值
   * @returns {void}
   */
  setNextConvert(result) {
    nextConvert = result;
  },
};
