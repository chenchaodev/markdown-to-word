/**
 * 跨进程契约类型单源(main ↔ renderer 经 IPC 交换的数据形状)。
 *
 * 依赖方向:renderer 只能依赖 core(单向 core←main←renderer),此前这些类型
 * 寄居 main(channels/persist/converter),renderer 被迫 type-only 反向 import main;
 * 收敛此处后两侧一律从 core 取契约——type-only import 编译期擦除,无运行时依赖,
 * 不因沙箱(sandbox/preload 无法加载 ESM)受影响。
 *
 * 约定:只放「纯数据形状」(零 Electron/fs 依赖,可被任意一侧 import);
 * channel 名常量留 main/ipc/channels.ts,持久化 IO 留 main/persist/ui-state.ts,
 * 批量执行实现留 main/converter/batch.ts——实现侧 import 本文件类型,须满足本契约。
 */
import type { ConvertWarning } from "./i18n.js";
import type { PageSetup } from "./settings/settings-defaults.js";
import type { TypographySettings } from "./settings/typography.js";

/** 同一 webContents 已有转换/预检时的统一 IPC 结果。 */
export interface OperationBusyResult {
  ok: false;
  busy: true;
  error: string;
}

/** 预检成功返回警告数组;busy 返回统一活动操作冲突。 */
export type PrecheckResult = ConvertWarning[] | OperationBusyResult;

/** 批量 busy 保留 BatchResult 计数字段,旧 renderer 不会因缺字段崩溃。 */
export type BatchOperationBusyResult = OperationBusyResult & {
  items: BatchItem[];
  okCount: 0;
  failCount: 0;
  canceledCount: 0;
};

/* ---------- 转换进度(convert:progress 推送 payload) ---------- */

/** 转换模式标识(convert:progress payload.mode;批量走 convert:batchProgress 独立通道,mode 预留)。 */
export type ConvertMode = "single" | "batch" | "merge";

/** convert:progress 事件 payload(main → renderer 推送)。 */
export interface ConvertProgressPayload {
  /** 阶段键(read/render/done + pdf 细分 parse/inline/mermaid/katex/print) */
  stage: string;
  /** 发起本次转换的入口模式(renderer 直接消费,不再按调用上下文推断) */
  mode: ConvertMode;
}

/* ---------- 批量转换(convert:batchProgress 推送 / convert:batch 返回) ---------- */

/** 批量进度推送(main → renderer,逐文件阶段)。 */
export interface BatchProgressInfo {
  index: number;
  total: number;
  file: string;
  stage: string;
}

/** 批量单文件结果(BatchResult.items 元素)。 */
export interface BatchItem {
  file: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
  warnings?: ConvertWarning[];
  /** 用户主动取消(未开始即跳过) */
  canceled?: boolean;
}

/** 批量转换返回(convert:batch 的 invoke 结果)。 */
export interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
  /** 用户主动取消的未开始项数量 */
  canceledCount: number;
}

/* ---------- 单文件/合并转换(convert:single / convert:merge 的 invoke 结果) ---------- */

/**
 * 单文件与合并转换共用的返回契约(形状单源,勿在 main/preload/renderer 侧重声明):
 * 取消经 canceled 表达(非错误),警告可在成功时携带。
 */
export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带;元素为 ConvertWarning(keyed) */
  warnings?: ConvertWarning[];
  /** 用户主动取消(非错误) */
  canceled?: boolean;
}

/* ---------- 导入/导出类 handler 返回(presetsImport/presetsExport/cssImport/templateImportDocx) ---------- */

/** 预设导入结果:取消 → { ok:true, canceled:true };成功 → 合并后的 imported/overridden 计数。 */
export type ImportPresetsResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; imported: number; overridden: number }
  | { ok: false; error: string };

/** 预设导出结果:取消 → { ok:true, canceled:true };成功 → 导出的条数;无预设 → { ok:false, error }。 */
export type ExportPresetsResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; count: number }
  | { ok: false; error: string };

/** PDF 自定义 CSS 导入结果:成功 → css 文本 + 文件名(供 renderer 回填)。 */
export type ImportPdfCssResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; css: string; name: string }
  | { ok: false; error: string };

/**
 * docx 模板导入结果(浅导入 v1):成功返回合并后的完整 typography/pageSetup
 * (供 renderer 回填);取消 → { ok:true, canceled:true };解析/读取异常 → { ok:false, error }。
 */
export type ImportDocxTemplateResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; typography: TypographySettings; pageSetup: PageSetup }
  | { ok: false; error: string };

/* ---------- 剪贴板读取(clipboard:read 的 invoke 结果) ---------- */

/** 剪贴板读取结果:文本写临时 md 返回路径,或返回文件路径,或 empty。 */
export type ClipboardReadResult =
  | { type: "text"; mdPath: string }
  | { type: "files"; paths: string[] }
  | { type: "empty" };

/* ---------- UI 状态(uiStateGet/uiStateSet 往返 + userData/ui-state.json 持久化形状) ---------- */

/** 最近成功转换的文件条目(≤10,按 ts 降序,path 去重)。 */
export interface RecentFile {
  path: string;
  name: string;
  format: "docx" | "pdf";
  ts: number;
}

/** 设置面板 details 展开态(默认折叠以突出主流程)。 */
export interface PanelOpen {
  page: boolean;
  typography: boolean;
}

/** 窗口位置尺寸(恢复时钳制到显示器工作区)。 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * UI 状态整体形状(辅助记忆,损坏只丢字段回默认,不影响 settings.json 契约):
 * - recentFiles: 最近成功转换条目 {path,name,format,ts} ≤10,按 ts 降序,path 去重
 * - lastSessionFiles: 上次会话的文件列表(renderer 恢复时逐项校验存在性)
 * - lastOpenDir: 对话框记忆目录(目录存在才作为 defaultPath 使用)
 * - windowBounds / previewWindowBounds: 主窗/预览窗位置(独立恢复,预览以后关闭者为准)
 * - isMaximized: 关闭时是否最大化(恢复时 maximize())
 * - panelOpen: 设置面板展开态(默认折叠)
 * - suppressCompleteDialog: 转换完成弹窗「不再提示」(默认 true = 不弹)
 * - firstRun: 首启引导标志(仅文件不存在的纯净首次启动默认 true)
 */
export interface UiState {
  recentFiles: RecentFile[];
  lastSessionFiles: string[];
  lastOpenDir: string;
  windowBounds: WindowBounds | null;
  /** 预览窗口位置(独立 key,恢复时经 pickWindowBounds 钳制)。 */
  previewWindowBounds: WindowBounds | null;
  /** 关闭时窗口是否最大化(恢复时 maximize();windowBounds 存 getNormalBounds() 还原态尺寸)。 */
  isMaximized: boolean;
  panelOpen: PanelOpen;
  /** 转换完成弹窗「不再提示」(true = 跳过弹窗,汇总条照常)。
   *  默认翻转为 true(不弹)——内联反馈已完备,模态打断流;
   *  已持久化的布尔值(用户显式选过弹窗=false)原样尊重,仅缺省/非法时落默认。 */
  suppressCompleteDialog: boolean;
  /** 首启引导标志:true = 尚未引导过(纯净首次启动),引导跳过/关闭后置 false。
   *  与设置偏好分离,不污染 settings.json;持久化落 ui-state.json。
   *  迁移语义见 main/persist/ui-state.ts loadUiState:已存在 ui-state.json 的老用户
   *  (文件存在但无本字段)视为已用过,不再弹首启引导;仅"文件不存在"才默认 true。 */
  firstRun: boolean;
}
