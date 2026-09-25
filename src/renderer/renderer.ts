/**
 * renderer 组合根:API 契约声明、事件接线与初始化编排。
 * 不变量:事件绑定先于设置回填(时序与模块化拆分前一致);设置回填与 UI 状态恢复
 * 汇合于启动屏障后统一揭示(揭示在 finally,任一路失败也必须显示界面);
 * 模块级副作用仅在加载期执行一次;跨进程边界不信任 IPC 对端(设置合并 renderer
 * 侧二次兜底);依赖方向单向(本文件 → dom/state/settings/convert/ui,不反向引用
 * 子模块私有符号)。
 */
import { state } from "./state/state.js";
import { updateActionButtons } from "./convert/file-list.js";
import { bindEvents } from "./convert/events/index.js";
import { bindSettingsEvents } from "./settings/settings-bindings.js";
import { bindSettingsDrawerEvents } from "./settings/settings-drawer.js";
import { aboutOpenBtn } from "./dom/refs.js";
import { loadSettings, initSettingsTabs } from "./settings/settings-panel.js";
import {
  bindRecentFilesEvents,
  initUiStateRestore,
  refreshRecentFiles,
} from "./ui/recent-files.js";
import { initFirstRunGuide } from "./ui/first-run-guide.js";
import { t } from "../core/i18n.js";

/**
 * window.api 类型由 preload 实现推导(PreloadApi = typeof api,单源
 * src/main/preload.cjs),不再手工镜像约 80 行 declare global——preload 改签名时
 * renderer 调用点编译期暴露;channel 名恒等测试(ipc-channels.test.js)保留。
 * NodeNext 下 .cjs 说明符解析到 .cts 源文件;import type 编译期擦除。
 */
import type { PreloadApi } from "../main/preload.cjs";

declare global {
  interface Window {
    api: PreloadApi;
  }
}

/* ---------- 启动屏障 ---------- */
/**
 * 首屏防闪:设置回填与 UI 状态恢复都是跨进程异步回填,若各自独立 await,
 * 浏览器会先按「默认设置 + 空会话」绘制一帧,用户看到白闪 + 设置跳变。
 * 手法:模块加载期同步隐藏根元素 → 两路初始化并行汇合 → 一次性揭示。
 * 选型说明(勿回退):
 * - 用 CSSOM 属性赋值(documentElement.style.visibility)而非 HTML 内联
 *   style 属性:后者受 CSP style-src 约束,且需要改 index.html/CSS;
 *   本仓 CSP 为 style-src 'self' 'unsafe-inline',CSSOM 赋值两种情况都放行,
 *   取不依赖 CSP 宽松度的一种;
 * - 不隐藏 window 本体而隐藏根元素:保留窗口尺寸/滚动条度量,几何门禁
 *   (check-geometry 量 getBoundingClientRect)不受影响;
 * - 揭示只在成功路径的做法会被任一路 reject 卡成永久白屏,故揭示放 finally。
 */
const rootEl = document.documentElement;
rootEl.style.visibility = "hidden";
// 兜底揭示:初始化阶段抛未捕获错误(事件绑定/装配失败)时不能停在隐藏态白屏,
// 错误事件到达即揭示(屏障正常走完后该赋值是空操作,故监听无需 once 摘除)。
window.addEventListener("error", () => {
  rootEl.style.visibility = "";
});

/** 屏障内单路失败隔离:留痕后按该路默认状态继续,不阻断另一路与揭示。 */
async function settleInit(label: string, task: Promise<unknown>): Promise<void> {
  try {
    await task;
  } catch (err) {
    console.error(`[init] ${label} 失败(该项保持默认状态)`, err);
  }
}

/**
 * 启动屏障:loadSettings(设置/语言/主题/控件回填)与 initUiStateRestore
 * (面板展开态 / 会话文件 / 最近记录)并行,汇合后统一重绘一次再揭示。
 * 两路本身各自内部已兜底失败(读失败静默回退默认),此处再兜一层 promise 拒绝,
 * 保证屏障必然 settle。
 */
async function runInitBarrier(): Promise<void> {
  try {
    await Promise.all([
      settleInit("loadSettings", loadSettings()),
      settleInit("initUiStateRestore", initUiStateRestore()),
    ]);
  } finally {
    // 读一次 offsetHeight 强制同步布局/样式刷新:两路 DOM 变更在同一帧生效,
    // 不会先揭示再跳变(read 触发 flush,代价一次 reflow,仅启动期一次)。
    void document.body.offsetHeight;
    rootEl.style.visibility = "";
  }
}

/* ---------- 初始化 ---------- */
// 事件绑定先于其余初始化(时序与拆分前一致:原绑定在模块加载期执行,
// 先于 updateActionButtons / 设置回填;bindEvents 内含进度订阅与菜单订阅)
bindEvents();
// 最近转换区块事件绑定迁入 bind*Events 范式(原为模块顶层监听)
bindRecentFilesEvents();
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled);
// footer 快捷键 hint 由 updateActionButtons 按模式维护
updateActionButtons();
// 设置面板:事件绑定先于回填(时序与拆分前一致:绑定在模块加载期,回填在 await 之后)
bindSettingsEvents();
// 设置抽屉 Tab 导航(6 组切换)初始化
initSettingsTabs();
// 设置抽屉开合事件(⚙/chip/遮罩/关闭按钮;Esc 走 dialogs-events 链末位)
bindSettingsDrawerEvents();
// 标题栏「关于」按钮 → 经 preload 打开关于窗口
aboutOpenBtn.addEventListener("click", () => {
  window.api.openAbout();
});
// 首启引导装配(接线跳过/步骤按钮 + 监听舞台状态;首屏呈现由 initUiStateRestore 触发)
initFirstRunGuide();
// 设置回填 + UI 状态恢复并行汇合于启动屏障,汇合后统一重绘一次(见屏障区块)
void runInitBarrier();
// 转换成功后刷新最近区块的回调接线(convert-flow 经 state 调用,
// 不再 import recent-files,打破 recent-files ↔ convert-flow 的 ESM 环)
state.recentRefreshHandler = refreshRecentFiles;
// 标题区版本号(失败静默,不阻塞界面);title 走字典(语言切换后
// 下次 getVersion 调用时更新;此处为启动一次性调用,与原行为一致)
void window.api.getVersion().then((version) => {
  const el = document.getElementById("appVersion");
  if (!el) return;
  el.textContent = `v${version}`;
  el.title = t("app.versionTitle", { version });
});
