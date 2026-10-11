/**
 * renderer 组合根:API 契约声明、事件接线与初始化编排。
 * 不变量:事件绑定先于设置回填(时序与模块化拆分前一致);设置回填与 UI 状态恢复
 * 汇合于启动屏障后统一揭示(揭示在 finally,任一路失败也必须显示界面);
 * 模块级副作用仅在加载期执行一次;跨进程边界不信任 IPC 对端(设置合并 renderer
 * 侧二次兜底);依赖方向单向(本文件 → dom/state/settings/convert/ui,不反向引用
 * 子模块私有符号)。
 */
import { state } from "./state/state.js";
import { applySelection, updateActionButtons } from "./convert/file-list.js";
import { bindEvents, type ConvertEventsDeps } from "./convert/events/index.js";
import { bindSettingsEvents } from "./settings/settings-bindings.js";
import { bindSettingsDrawerEvents, applyDrawerOpenState } from "./settings/settings-drawer.js";
import { aboutOpenBtn, dropZone } from "./dom/refs.js";
import {
  importDocxTemplate,
  loadSettings,
  initSettingsTabs,
  setSuppressCompleteDialog,
  syncSuppressCompleteDialog,
} from "./settings/settings-panel.js";
import {
  isBackgroundCommandBlocked,
  isConvertCommandBlocked,
  runConvert,
  runMerge,
  withPrecheck,
  type ConvertFlowDeps,
} from "./convert/convert-flow.js";
import {
  allPresets,
  headerLogoDisplayName,
  outputDirDisplayText,
  parseMarginValue,
  presetDisplayName,
  validateNumberRange,
} from "./settings/settings-logic.js";
import { persistSettings } from "./settings/settings-save.js";
import { applyTemplatePreset } from "./settings/settings-bindings-preset.js";
import {
  closeSettingsDrawer,
  isSettingsDrawerOpen,
} from "./settings/settings-drawer.js";
import { renderSelection } from "./convert/file-list.js";
import {
  closeBookWizard,
  openBookWizard,
  type BookWizardDeps,
} from "./wizard/book-wizard.js";
import {
  bindRecentFilesEvents,
  initUiStateRestore,
  refreshRecentFiles,
  type RecentFilesDeps,
} from "./ui/recent-files.js";
import { initFirstRunGuide } from "./ui/first-run-guide.js";
import {
  afterModalClosed,
  bindPrecheckDialogEvents,
  closePrecheckDialog,
  hideBatchDialog,
  hideCompleteDialog,
  precheckFileLabels,
  showBatchDialog,
  showBatchDialogError,
  showCompleteDialog,
  showCopyFeedback,
  showDialogError,
  showPrecheckDialog,
  showSummary,
  type DialogsDeps,
} from "./ui/dialogs.js";
import {
  bindPresetSaveEvents,
  closePresetSaveDialog,
  type PresetActionsDeps,
} from "./settings/settings-preset-actions.js";
import { setError } from "./dom/dom-ops.js";
import { errorMessage } from "../core/text/error-message.js";
import { t } from "../core/i18n/index.js";

/**
 * ui/dialogs 的跨功能协作面在此组装(ADR-075 §四:组合根组装 · feature 侧接形参)。
 * `recomputeActionButtons` 是 convert 侧的解法(ui 不得反向依赖 convert),通知的
 * 语义仍留在 ui。**同步调用**,不得改成惰性(§二 禁令 4:Esc 链的末位语义)。
 */
const dialogsDeps: DialogsDeps = { recomputeActionButtons: updateActionButtons };

/** 遮罩显隐一变即重算动作按钮(零参闭包:ui 侧 deps 已绑好,各调用方不必知道形状)。 */
const notifyModalClosed = (): void => afterModalClosed(dialogsDeps);

/** settings 的「另存为预设」弹窗关闭面。 */
const presetActionsDeps: PresetActionsDeps = { afterModalClosed: notifyModalClosed };

/** Esc 链用的零参闭包(ADR-075 §四 交汇点:convert 拿到的是零参闭包,不是 deps 形状)。 */
const closePresetSave = (): void => closePresetSaveDialog(presetActionsDeps);

/** convert 自身的呈现面(ui/dialogs 的五个符号)。 */
const convertFlowDeps: ConvertFlowDeps = {
  precheckFileLabels,
  showBatchDialog,
  showCompleteDialog,
  showPrecheckDialog,
  showSummary,
};

/**
 * ui/recent-files 的跨功能协作面在此组装(ADR-075 阶段④:组合根组装 · feature 侧接形参)。
 * 四个功能根是平铺协作的 peer,任何 feature → 另一 feature 的静态 import 都判红
 * (`renderer-features-no-cross-import`,阶段⑥ 转正),故这些协作一律经本处注入。
 * 传函数本身而非模块命名空间;**不给默认值** —— 漏一项要在 typecheck 处编译不过。
 */
const recentFilesDeps: RecentFilesDeps = {
  // 零参闭包:组合根已把 convert 自己的呈现面绑好,故 recent-files 拿到的是
  // `(filePath, format) => Promise<void>` 原形态(零参化只对 deps 形状而言)
  applySelection,
  runConvert: (filePath, format) => runConvert(convertFlowDeps, filePath, format),
  syncSuppressCompleteDialog,
  applyDrawerOpenState,
};

/**
 * wizard 的跨功能协作面在此组装(ADR-075 §四:组合根组装 · feature 侧接形参)。
 *
 * 它比 recent-files 那份大得多(17 项),因为 wizard 是四个功能根里**唯一同时向
 * settings、convert、ui 协作**的:向导的「选源文件 / 合并 / 预检 / 字段校验 /
 * 输出目录 / 应用模板预设 / 遮罩关闭重算」全在 settings、convert、ui 侧。仍然
 * **不给默认值** —— 漏一项要在 typecheck 处编译不过。
 *
 * ⚠ 这份 deps 在本文件被**绑成零参闭包后**分发给多处(`openWizard` / `closeWizard`),
 * 这样调用方(initFirstRunGuide / convert 的 selection 域 / dialogs-events 的 Esc 链)
 * 都不必知道 wizard 的 deps 形状;若让它们各自 import `BookWizardDeps` 类型,会各造出
 * 一条 type-only 跨 feature 边 —— 正是 ADR-075 后果节点名的两侧分叉口(src 侧数得到、
 * 产物侧被编译期擦除,两侧读数对不上)。
 */
const bookWizardDeps: BookWizardDeps = {
  isBackgroundCommandBlocked,
  isConvertCommandBlocked,
  // 同样绑成零参(对 deps 形状而言)的闭包:向导不必知道 convert 呈现面的形状
  runMerge: (opts) => runMerge(convertFlowDeps, opts),
  withPrecheck: (filePaths, action) => withPrecheck(convertFlowDeps, filePaths, action),
  renderSelection,
  closeSettingsDrawer,
  isSettingsDrawerOpen,
  afterModalClosed: notifyModalClosed,
  allPresets,
  headerLogoDisplayName,
  outputDirDisplayText,
  parseMarginValue,
  presetDisplayName,
  validateNumberRange,
  persistSettings,
  applyTemplatePreset,
  importDocxTemplate,
};

/** 已绑好 wizard deps 的零参开向导闭包(见上)。 */
const openWizard = () => openBookWizard(bookWizardDeps);

/** 已绑好 wizard deps 的零参关向导闭包(ADR-075 §二 禁令 4:供 Esc 链同步调用)。 */
const closeWizard = () => closeBookWizard(bookWizardDeps);

/** convert 事件域的端口接线(组合根组装 · convert 侧接形参 · 类型由 convert 自报)。 */
const convertEventsDeps: ConvertEventsDeps = {
  ...convertFlowDeps,
  openWizard,
  // ui/dialogs:三条关闭路径绑成零参闭包(closePrecheckDialog 保留 ok 实参)
  hideCompleteDialog: () => hideCompleteDialog(dialogsDeps),
  hideBatchDialog: () => hideBatchDialog(dialogsDeps),
  closePrecheckDialog: (ok) => closePrecheckDialog(ok, dialogsDeps),
  showDialogError,
  showBatchDialogError,
  showCopyFeedback,
  isSettingsDrawerOpen,
  closeSettingsDrawer,
  setSuppressCompleteDialog,
  closePresetSave,
  closeWizard,
};

/**
 * window.api 类型单源在 core(PreloadApi,src/core/preload-api.ts),preload 以它标注
 * 实现对象、renderer 从它取用,两侧同源——不再手工镜像约 80 行 declare global,
 * 也不再反向 type-only import main/preload.cjs(那曾是全库唯一一条 renderer→main
 * 依赖,靠门禁的 REVERSE_TYPE_ALLOWLIST 放行了近一年)。preload 改签名时 renderer
 * 调用点编译期暴露;channel 名恒等测试(ipc-channels.test.js)保留。
 */
import type { PreloadApi } from "../core/preload-api.js";

declare global {
  interface Window {
    api: PreloadApi;
  }
}

/* ---------- 启动屏障 ---------- */
/**
 * 版本号取不到时徽标的可见文案。
 *
 * 为什么是字面量而不是字典键:成功路径的 `v${version}` 前缀同样是字面量(`v` 是
 * 「版本」这一记号而非语言相关的词),失败态沿用同一记号族即 `v?` —— 问号是
 * 「未知」的通用写法,故无需按语言分译,也就不必给三份字典各加一个键。
 * **刻意不用 `v0.0.0` / `vunknown` 之类的假版本号**:那会把「取不到」伪装成
 * 「取到了」,比空白更难排查(用户会拿一个错版本号去报 bug)。
 */
const VERSION_UNAVAILABLE = "v?";

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
      settleInit("initUiStateRestore", initUiStateRestore(recentFilesDeps)),
    ]);
  } finally {
    // 读一次 offsetHeight 强制同步布局/样式刷新:两路 DOM 变更在同一帧生效,
    // 不会先揭示再跳变(read 触发 flush,代价一次 reflow,仅启动期一次)。
    void document.body.offsetHeight;
    rootEl.style.visibility = "";
    focusStageEntry();
  }
}

/**
 * 首屏焦点落点:舞台容器(#dropZone,role=region + tabindex=0)。
 * 不落焦的代价:键盘用户的起点是 body,Tab 要先穿过标题栏与整条动作栏才到文稿台,
 * 而文稿台才是这个应用的主入口(投放/选择文件)。落在舞台上时,后续 Tab 顺序
 * 与视觉顺序一致(舞台 → 队列行 → 动作栏)。
 * 舞台有 tabindex 但 .stage-wrap:focus-visible 显式去掉了描边(纸面不该有
 * 焦点框),故聚焦不产生视觉跳动;此处只做程序性聚焦,不用 focus-visible。
 * 揭示之后再落焦:屏障期间根元素不可见,提前聚焦没有意义。
 */
function focusStageEntry(): void {
  dropZone.focus();
}

/* ---------- 初始化 ---------- */
// 事件绑定先于其余初始化(时序与拆分前一致:原绑定在模块加载期执行,
// 先于 updateActionButtons / 设置回填;bindEvents 内含进度订阅与菜单订阅)
bindEvents(convertEventsDeps);
// ui/dialogs 的预检弹窗按钮/遮罩接线:原先在模块加载期登记(彼时 ui 拿不到
// convert 的重算端口),现由组合根带 deps 绑定;位置仍在其余 bind 之前。
bindPrecheckDialogEvents(dialogsDeps);
// settings 侧「另存为预设」弹窗的五个控件接线(同上:要经 preset-actions 拿端口)
bindPresetSaveEvents(presetActionsDeps);
// 最近转换区块事件绑定迁入 bind*Events 范式(原为模块顶层监听)
bindRecentFilesEvents(recentFilesDeps);
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
initFirstRunGuide({ openBookWizard: openWizard });
// 设置回填 + UI 状态恢复并行汇合于启动屏障,汇合后统一重绘一次(见屏障区块)
void runInitBarrier();
// 转换成功后刷新最近区块的回调接线(convert-flow 经 state 调用,
// 不再 import recent-files,打破 recent-files ↔ convert-flow 的 ESM 环)。
// refreshRecentFiles 本身不接 deps(纯 DOM 刷新,渲染链上无跨功能协作点),
// 故仍可直接指向它 —— 这条槽合法的前提是那个时刻没有任何调用栈能连到 ui。
state.recentRefreshHandler = refreshRecentFiles;
// 标题区版本号。不阻塞界面,但**失败不许静默**:取不到版本号时徽标恒空、只留一条
// unhandled rejection,不报任何错 —— 这正是上一轮把一处断链放大成「门禁等 5s 无解释」
// 的原因(几何门禁的 `init ready` 用 && 串了版本号,这一路静默失败即让门禁超时)。
// 故 reject 分支:① 徽标写入 `v?` —— 与成功路径同族的语言中立记号(成功路径的 `v` 前缀
// 本就是字面量),**不回填假版本号**(假版本号会把「取不到」伪装成「取到了」,比空白更难
// 排查);② 错误经本仓既有通道 setError 上报(状态行 role=alert,与其他 renderer 失败路径
// 同一入口,不新造一套);③ 徽标 title 带上原因,悬停即可定位。
// 文案用既有键 common.unknownError(新增专用键要动 src/core/i18n 三份字典,不在本次范围)。
void window.api.getVersion().then(
  (version) => {
    const el = document.getElementById("appVersion");
    if (!el) return;
    el.textContent = `v${version}`;
    el.title = t("app.versionTitle", { version });
  },
  (err: unknown) => {
    const reason = errorMessage(err);
    const el = document.getElementById("appVersion");
    if (el) {
      el.textContent = VERSION_UNAVAILABLE;
      el.title = `${t("common.unknownError")}:${reason}`;
    }
    setError(`${t("common.unknownError")}:${reason}`);
  },
);
