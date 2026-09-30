// @ts-check
// 视觉自查工具 · preload:
// contextIsolation 关闭后与页面同世界,先于 renderer.js 注入 window.api 桩,
// 使界面可离线驱动到各舞台状态;window.__vc 暴露测试控制面(下一次对话框返回值等)。
"use strict";

/**
 * 仓库根目录(桩要读 package.json 的版本号、导入 dist 产物的默认设置)。
 * 用 node:path 的动态 import 而非 require:本文件不在 eslint 的 CJS 放行名单里
 * (放行的只有同为 CJS 的 visual-about-preload.cjs,见 eslint.config.js),
 * 写 require() 会被 no-require-imports 拦下。动态 import 在 CJS 里同样合法。
 * @type {Promise<{ join: (...parts: string[]) => string; resolve: (...parts: string[]) => string }>}
 */
const pathMod = import("node:path");

/**
 * 构造固定时间戳(epoch ms)。
 * 用本地时间分量而非写死数字:页面侧的 formatRecentTime 全程走 getHours/getDate 等本地取值,
 * 故「2024-03-15 14:30 本地」在任何时区都渲染成同一串字 —— 换台机器跑 ui:shots 也一致。
 * @param {number} year 年 @param {number} month 月(0 起) @param {number} day 日
 * @param {number} hour 时 @param {number} minute 分
 * @returns {number}
 */
const at = (year, month, day, hour, minute) =>
  new Date(year, month, day, hour, minute, 0, 0).getTime();

/**
 * 最近列表的三条记录(时间戳一律取 2024 年的固定值)。
 *
 * 为什么必须固定:ts 会被渲染成历史面板里逐行的时间文案,文案里的「分钟」直接来自 ts。
 * 早先这里写的是 `Date.now() - 偏移`,于是 4-history-open.png 里的分钟数字逐次运行都在变,
 * 同一份代码每隔一分钟就换一份哈希 —— 基线工具的产物不确定,目检结论也就无法跨轮比较。
 * 冻结时钟没选:桩与页面同世界,覆 Date 会连带影响 renderer 里所有读时钟的代码(污染面大),
 * 而固定 ts 只改这一个夹具输入。
 *
 * 为什么取「固定年」而不是「今天 14:30」这种相对写法:formatRecentTime 的四个分支里,
 * 「今天/昨天/M月D日」三支都由页面真实的 now(= Date.now(),页面传 undefined 走默认)参与判定,
 * 固定 ts 钉不住分支 —— 分支跟着**运行当天**走,26 小时前那条甚至会随运行时刻在
 * 「昨天 HH:mm」与「M月D日」之间来回跳。只有跨年分支「2024年3月15日」既不含 HH:mm
 * 也不看运行日,是唯一能被 ts 单独钉死的输出,故三条一律落 2024 年。
 *
 * 代价(已知取舍):基线里不再出现「今天/昨天」前缀,行内只剩一种定长日期文案。
 * 那两个分支的文案逻辑由单测覆盖(注入 now 断言,见 test/renderer/renderer-pure.test.js
 * 与 test/segments/identity-guards.test.js),视觉基线要的只是一个宽度量级相当的定长串。
 * 日后若要让基线重新拍到「今天/昨天」,必须连 now 一起钉(桩里把 Date.now 覆成常量),
 * 只固定 ts 做不到 —— 那是另一个取舍,不在本轮。
 */
const recentBase = () => [
  {
    path: "C:\\demo\\季度报告.md",
    name: "季度报告.md",
    format: "docx",
    ts: at(2024, 2, 15, 14, 30),
  },
  {
    path: "C:\\demo\\产品说明书.md",
    name: "产品说明书.md",
    format: "pdf",
    ts: at(2024, 2, 14, 9, 12),
  },
  {
    path: "C:\\demo\\会议纪要.md",
    name: "会议纪要.md",
    format: "docx",
    ts: at(2024, 2, 12, 18, 40),
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

/* ---------- 版本号与默认设置:取真实值而非桩值 ---------- */

/** 仓库根目录(懒解析一次):本文件同时服务主窗,取值只发生在截图开始后,不在注入关键路径上。 @type {Promise<string> | null} */
let rootPromise = null;

/**
 * 解析仓库根目录并缓存。
 * @returns {Promise<string>}
 */
function repoRoot() {
  if (rootPromise === null) {
    rootPromise = pathMod.then((p) => p.resolve(__dirname, "..", ".."));
  }
  return rootPromise;
}

/**
 * 版本号读仓库 package.json 的真实值,不写死字面量。
 * 为什么:这份桩的产物直接进 README / 官网当产品图。原先的 `0.0.0-visual` 有两处问题:
 * 一是那不是任何用户见得到的版本号;二是它比真实版本串长得多,about 窗 420px 的卡片
 * 装不下,版本芯片会被裁掉一截。读 package.json 则「发版改号 → 图上版本自动跟着变」。
 * @returns {Promise<string>}
 */
async function appVersion() {
  const root = await repoRoot();
  const [{ createRequire }, { pathToFileURL }] = await Promise.all([
    import("node:module"),
    import("node:url"),
  ]);
  // 基准传 package.json 自身:createRequire 以该文件为解析起点,避免再拼相对层级
  const req = createRequire(pathToFileURL(`${root}/package.json`).href);
  const pkg = req("./package.json");
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

/** 默认设置模块(编译产物)的 ESM 动态导入,只导入一次。 @type {Promise<{ cloneDefaultSettings: () => unknown }> | null} */
let defaultsModule = null;

/**
 * 取一份**全新的**默认设置对象。
 * 为什么用 cloneDefaultSettings() 而不是直接递 DEFAULT_SETTINGS:后者是模块级单例,
 * 而 renderer 在 settings 首次 load 到达前会就地改写分组块(见该工厂自身的注释),
 * 桩把单例递出去等于让截图过程污染这份全局默认,后续场景读到的将是脏值。
 * 为什么这样就不出红色告警条:页面侧 mergeSettingsWithDefaults 只在 pageSetup 结构非法时
 * 提示「检测到不合法的页面设置结构设置」,而旧桩返回 {} 恰好落进这个分支。本函数给出的形状
 * 与 main 侧 loadSettings()「无 settings.json 时返回默认值」一致,故走的是与线上一致的
 * 兜底路径,红条不再出现。
 * @returns {Promise<unknown>}
 */
async function defaultSettings() {
  const root = await repoRoot();
  if (defaultsModule === null) {
    const [{ pathToFileURL }, p] = await Promise.all([import("node:url"), pathMod]);
    // dist 是 ESM 产物,CJS 侧 require 不了,只能动态 import;
    // 且必须传 file URL —— Windows 上裸盘符路径不是合法 URL。
    defaultsModule = import(
      /* @vite-ignore */ pathToFileURL(
        p.join(root, "dist", "core", "settings", "settings-defaults.js"),
      ).href
    );
  }
  const mod = await defaultsModule;
  return mod.cloneDefaultSettings();
}

const api = new Proxy(
  {
    appVersion: appVersion,
    getVersion: appVersion,
    settingsGet: defaultSettings,
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
