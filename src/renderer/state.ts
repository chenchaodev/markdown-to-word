/**
 * renderer 共享可变状态(单一来源)与 IPC 契约类型(R8 自 renderer.ts 抽出):
 * - 全部模块级可变状态收敛于此,feature 模块(utils/file-list/dialogs/convert-flow)
 *   与组合根 renderer.ts 只经本模块读写状态,不各自持有副本
 * - 字段语义保持与拆分前逐一对应(逐字段核对):
 *   mode:当前转换模式,进度事件归属判定(忽略迟到事件);run* 开头置位,finally 复位
 *   hydratingSettings:回填控件期间置位,change 处理器据此跳过写回
 *   dialogOutputPath / summaryOutputPath:弹窗与汇总条的输出路径缓存
 * - IPC 契约类型(BatchProgressInfo/BatchItem/BatchResult)同时被 dialogs/
 *   convert-flow/组合根引用,一并收敛于此
 */
import { DEFAULT_SETTINGS, type AppSettings } from "../core/settings-defaults.js";
import type { ConvertWarning } from "../core/i18n.js";
import type { RecentFile } from "../main/ui-state.js";

/* ---------- 批量 / 合并契约类型 ---------- */
export interface BatchProgressInfo {
  index: number;
  total: number;
  file: string;
  stage: string;
}

export interface BatchItem {
  file: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** B6:keyed 警告,显示层经 formatWarning 按当前语言格式化。 */
  warnings?: ConvertWarning[];
  /** 用户取消导致未执行转换的项。 */
  canceled?: boolean;
}

export interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
  /** 用户取消未执行的项数。 */
  canceledCount: number;
}

/* ---------- 共享可变状态(单一来源,各模块经 state.xxx 读写) ---------- */
export const state = {
  /** 当前选中的 Markdown 文件列表(1 个或 N 个)。 */
  selectedFiles: [] as string[],
  selectedFormat: "docx" as "docx" | "pdf",
  converting: false,
  /** 当前转换模式:控制进度事件归属(忽略迟到事件)。 */
  mode: null as "single" | "batch" | "merge" | null,
  errorFlashTimer: undefined as number | undefined,
  unsubscribeProgress: undefined as (() => void) | undefined,
  unsubscribeBatchProgress: undefined as (() => void) | undefined,
  /** 最近一次批量结果(供弹窗「打开所在文件夹」定位成功项 + 汇总条「失败详情」重开弹窗)。 */
  lastBatchResult: null as BatchResult | null,
  /** 拖拽排序状态:源项下标 / 是否插到悬停项之后(-1 表示未在拖拽中)。 */
  dragIndex: -1,
  dragDropAfter: false,
  /** 当前设置的内存态(乐观更新,持久化走 settingsSet) */
  settings: {
    ...DEFAULT_SETTINGS,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
    typography: { ...DEFAULT_SETTINGS.typography },
  } as AppSettings,
  /** 回填控件期间置位,避免回填触发 change 事件写回 */
  hydratingSettings: false,
  /** 弹窗对应输出文件路径(供「打开所在文件夹 / 打开文件」按钮使用) */
  dialogOutputPath: "",
  /** 最近一次汇总条展示的输出路径(供「打开所在文件夹 / 打开文件」按钮使用)。 */
  summaryOutputPath: "",
  /** 最近成功转换的文件列表(批次 11;供最近区块显隐判断,渲染在 recent-files.ts)。 */
  recentFiles: [] as RecentFile[],
  /** 最近一次批量使用的格式(批次 11 迭代 2:重试失败项按原格式重转)。 */
  lastBatchFormat: undefined as "docx" | "pdf" | undefined,
  /** 转换完成弹窗「不再提示」(ui-state 字段的内存镜像;批次 11 迭代 2)。 */
  suppressCompleteDialog: false,
  /** 转换成功后刷新最近区块的回调(批次 15 R5:recent-files 注册、convert-flow 调用,
   *  打破 recent-files ↔ convert-flow 的 ESM 循环依赖;组合根 renderer.ts 接线)。
   *  允许返回 Promise(注册方 refreshRecentFiles 为 async,内部已自吞错误)。 */
  recentRefreshHandler: null as (() => void | Promise<void>) | null,
};
