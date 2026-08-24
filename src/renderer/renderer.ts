/**
 * G3 阶段:renderer 接入转换逻辑(含转换完成弹窗)。
 * 二期批次 1:页面设置面板(纸张/方向/边距/H1 分页/导出后行为)与持久化,
 * 完成弹窗新增「打开所在文件夹 / 打开文件」按钮。
 * 二期批次 2:预览功能经主进程打开独立预览窗口(与 PDF 同排版),预览使用源 md 路径。
 * 迭代 4:预览入口迁移到转换前——选中文件后即可预览(单文件态操作行「预览」按钮 +
 * 多文件态每行「预览」按钮),完成弹窗移除「预览」按钮(打开文件夹/打开文件保留)。
 * 二期批次 3:多文件选择与「批量转换 / 合并转换」。
 *   - 选择:对话框多选(openMarkdowns)+ 拖放多文件/文件夹(collectMarkdowns 展开)。
 *   - 状态:1 个文件保持单文件态;≥2 个文件显示数量 + 可滚动名称列表。
 *   - 批量:convertBatch + onBatchProgress 实时进度,完成弹汇总弹窗逐条展示;
 *   - 合并:convertMerge 合成一个文档,复用现有完成弹窗。
 * 二期批次 4:多文件列表排序(序号 + 上移/下移按钮 + 拖拽排序),直接重排
 * selectedFiles 数组,批量 / 合并按新顺序执行(合并顺序即文档章节顺序)。
 * 导出后行为的自动执行由主进程在转换完成后按设置触发(runAfterConvert),
 * renderer 只负责持久化与弹窗内手动操作,避免重复执行。
 * 二期批次 5a:排版设置面板(西文/中文字体、字号、行距、首行缩进、两端对齐、章节编号)。
 * renderer 侧类型、默认值与控件接线先行就位;主进程 settings.ts 的 typography 字段由
 * 下一批次补充,因此加载设置时对缺失的 typography 按默认值兜底(防御性合并)。
 * 主进程 API 经 preload 以 window.api 暴露(contextIsolation),契约见下方类型声明。
 * R8:renderer 模块化拆分——DOM 映射收敛 dom.ts、共享状态与 IPC 契约收敛 state.ts、
 * 通用工具 utils.ts、选择与列表 file-list.ts、结果展示 dialogs.ts、转换编排
 * convert-flow.ts;本文件为组合根:API 契约、事件接线与初始化。
 * R10-5:设置面板(加载/回填/校验/钳制/预设套用/persist 三件套 + 全部设置控件
 * 事件绑定)抽 src/renderer/settings-panel.ts;组合根 init 处
 * bindSettingsEvents() 后再 loadSettings()(时序与拆分前一致)。
 * B8:事件绑定抽 events.ts(bindEvents 集中),本文件只留
 * window.api 契约声明与初始化编排;设置控件绑定抽 settings-bindings.ts
 * (settings-panel 留加载/回填/持久化/预设弹窗交互)。
 * 批③目录重组:renderer 按功能域归组——dom/(refs)、state/(state/pure/utils)、
 * settings/(panel/logic/bindings)、convert/(flow/file-list/events 四域拆分)、
 * ui/(dialogs/recent-files)、style/(base/drop/settings/dialogs 四 css);
 * 本文件仍为组合根,import 路径随目录更新,行为零变化。
 */
import { state } from "./state/state.js";
import { updateActionButtons } from "./convert/file-list.js";
import { bindEvents } from "./convert/events/index.js";
import { bindSettingsEvents } from "./settings/settings-bindings.js";
import { bindSettingsDrawerEvents } from "./settings/settings-drawer.js";
import { loadSettings } from "./settings/settings-panel.js";
import {
  bindRecentFilesEvents,
  initUiStateRestore,
  refreshRecentFiles,
} from "./ui/recent-files.js";
import { t } from "../core/i18n.js";

/**
 * MR-5:window.api 类型由 preload 实现推导(PreloadApi = typeof api,单源
 * src/main/preload.cts),不再手工镜像约 80 行 declare global——preload 改签名时
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
// 最近转换区块事件绑定迁入 bind*Events 范式(MR-10;原为模块顶层监听)
bindRecentFilesEvents();
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled);
// footer 快捷键 hint 由 updateActionButtons 按模式维护(批次 12:C4)
updateActionButtons();
// 设置面板:事件绑定先于回填(时序与拆分前一致:绑定在模块加载期,回填在 await 之后)
bindSettingsEvents();
// P0-3:设置抽屉开合事件(⚙/chip/遮罩/关闭按钮;Esc 走 dialogs-events 链末位)
bindSettingsDrawerEvents();
// 读取持久化设置并回填控件(失败静默回退默认值)
void loadSettings();
// 批次 11:UI 状态恢复(面板展开态 / 会话文件 / 最近转换区块;失败静默保持默认)
void initUiStateRestore();
// 批次 15(R5):转换成功后刷新最近区块的回调接线(convert-flow 经 state 调用,
// 不再 import recent-files,打破 recent-files ↔ convert-flow 的 ESM 环)
state.recentRefreshHandler = refreshRecentFiles;
// 发版 1.0.0:标题区版本号(失败静默,不阻塞界面);B6:title 走字典(语言切换后
// 下次 getVersion 调用时更新;此处为启动一次性调用,与原行为一致)
void window.api.getVersion().then((version) => {
  const el = document.getElementById("appVersion");
  if (!el) return;
  el.textContent = `v${version}`;
  el.title = t("app.versionTitle", { version });
});
