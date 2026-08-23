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
 * B8:事件绑定抽 src/renderer/events.ts(bindEvents 集中),本文件只留
 * window.api 契约声明与初始化编排;设置控件绑定抽 settings-bindings.ts
 * (settings-panel 留加载/回填/持久化/预设弹窗交互)。
 */
import { type AppSettings } from "../core/settings-defaults.js";
import type { UiState } from "../main/ui-state.js";
import { state } from "./state.js";
import type { BatchProgressInfo, BatchResult } from "./state.js";
import { updateActionButtons } from "./file-list.js";
import { bindEvents } from "./events.js";
import { bindSettingsEvents } from "./settings-bindings.js";
import { loadSettings } from "./settings-panel.js";
import { initUiStateRestore, refreshRecentFiles } from "./recent-files.js";
import { t } from "../core/i18n.js";
import type { ConvertWarning } from "../core/i18n.js";

declare global {
  interface Window {
    api: {
      /** 拖放文件 → 真实路径(File.path 已被 Electron 32+ 移除,须经主进程 webUtils 解析)。 */
      getPathForFile: (file: File) => string;
      /** 多选文件对话框,返回所选文件路径数组;空数组 = 用户取消。 */
      openMarkdowns: () => Promise<string[]>;
      /** 展开拖入路径(文件 + 文件夹递归),过滤出 Markdown 文件;skipped 为被跳过的项。 */
      collectMarkdowns: (
        paths: string[],
      ) => Promise<{ files: string[]; skipped: string[] }>;
      convert: (
        filePath: string,
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: ConvertWarning[]; canceled?: boolean }>;
      /** 批量转换:每文件独立输出;始终 ok:true,成败看 items 逐条。 */
      convertBatch: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<BatchResult>;
      /** 合并转换:所有文件合成一个文档。 */
      convertMerge: (
        files: string[],
        format: "docx" | "pdf",
      ) => Promise<{ ok: boolean; outputPath?: string; error?: string; warnings?: ConvertWarning[]; canceled?: boolean }>;
      /** 请求取消当前转换(单文件 / 批量 / 合并通用;批量在文件间检查)。 */
      convertCancel: () => Promise<void>;
      /** 选择输出目录对话框(批次 7);用户取消返回 null。 */
      selectDir: () => Promise<string | null>;
      /** 订阅转换进度(B9 起阶段键:read/render/done + pdf 细分 parse/inline/
       *  mermaid/katex/print;未知键 renderer 原样兜底,向后兼容),返回取消订阅函数。 */
      onConvertProgress: (cb: (stage: string) => void) => () => void;
      /** 订阅批量转换进度(第 i 个文件 / 阶段文案),返回取消订阅函数。 */
      onBatchProgress: (cb: (info: BatchProgressInfo) => void) => () => void;
      /** 读取持久化设置(启动时回填控件)。 */
      settingsGet: () => Promise<AppSettings>;
      /** 局部更新设置并持久化,返回合并后的完整设置。 */
      settingsSet: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      /** 应用版本号(标题区显示,与「关于」对话框同源)。 */
      getVersion: () => Promise<string>;
      /** 读取 UI 状态(最近文件/会话文件/记忆目录/窗口位置/面板展开态)。 */
      uiStateGet: () => Promise<UiState>;
      /** 局部更新 UI 状态并持久化,返回合并后的完整状态。 */
      uiStateSet: (patch: Partial<UiState>) => Promise<UiState>;
      /** 保序过滤仍存在的路径(会话文件逐项校验,缺失剔除)。 */
      filterExistingPaths: (paths: string[]) => Promise<string[]>;
      /** 在资源管理器中显示目标文件。 */
      revealInFolder: (filePath: string) => Promise<void>;
      /** 用系统默认程序打开目标文件;失败返回 { ok: false, error }。 */
      openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 在主进程独立窗口预览转换排版(与 PDF 同排版);失败返回 { ok: false, error }。 */
      openPreview: (mdPath: string) => Promise<{ ok: boolean; error?: string }>;
      /** 批次 11 迭代 3:刷新所有预览窗口(设置变更后调用;无预览窗口时为空操作)。 */
      previewRefresh: () => Promise<void>;
      /** 批次 13:从 JSON 文件导入自定义预设(main 内选文件,与现有合并:同名覆盖,上限 10);
       *  canceled=true 为用户取消。 */
      importPresets: () => Promise<
        | { ok: true; canceled: true }
        | { ok: true; canceled: false; imported: number; overridden: number }
        | { ok: false; error: string }
      >;
      /** 批次 13:导出全部自定义预设为 JSON 文件;canceled=true 为用户取消。 */
      exportPresets: () => Promise<
        | { ok: true; canceled: true }
        | { ok: true; canceled: false; count: number }
        | { ok: false; error: string }
      >;
      /** 批次 16:导入 CSS 文件作为 PDF 样式模板(main 内选文件 + 读内容 + 大小上限校验);
       *  canceled=true 为用户取消;成功返回 css 内容与文件名。 */
      importPdfCss: () => Promise<
        | { ok: true; canceled: true }
        | { ok: true; canceled: false; css: string; name: string }
        | { ok: false; error: string }
      >;
      /** 批次 11 迭代 4:应用菜单「文件 → 打开文件…」触发,复用现有选择对话框链路。 */
      onMenuOpen: (cb: () => void) => () => void;
    };
  }
}

/* ---------- 初始化 ---------- */
// 事件绑定先于其余初始化(时序与拆分前一致:原绑定在模块加载期执行,
// 先于 updateActionButtons / 设置回填;bindEvents 内含进度订阅与菜单订阅)
bindEvents();
// 初始无选中:按钮按当前状态置灰(HTML 中 convertBtn 已写死 disabled);
// footer 快捷键 hint 由 updateActionButtons 按模式维护(批次 12:C4)
updateActionButtons();
// 设置面板:事件绑定先于回填(时序与拆分前一致:绑定在模块加载期,回填在 await 之后)
bindSettingsEvents();
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
