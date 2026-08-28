/**
 * renderer 组合根:API 契约声明、事件接线与初始化编排。
 * 不变量:事件绑定先于设置回填(时序与模块化拆分前一致);模块级副作用仅在加载期执行一次;
 * 跨进程边界不信任 IPC 对端(设置合并 renderer 侧二次兜底);依赖方向单向
 * (本文件 → dom/state/settings/convert/ui,不反向引用子模块私有符号)。
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
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
// UI 状态恢复(面板展开态 / 会话文件 / 最近转换区块;失败静默保持默认)
void initUiStateRestore();
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
