/**
 * renderer 共享可变状态(单一来源)与 IPC 契约类型(R8 自 renderer.ts 抽出):
 * - 全部模块级可变状态收敛于此,feature 模块(utils/file-list/dialogs/convert-flow)
 *   与组合根 renderer.ts 只经本模块读写状态,不各自持有副本
 * - 字段语义保持与拆分前逐一对应(逐字段核对):
 *   mode:当前转换模式(转换中标志 + 进度事件归属判定合一,B8 卫生项——原
 *   converting 布尔与 mode 恒同置同清,属平行状态字段,收敛为 mode 单源;
 *   「是否转换中」= mode !== null);run* 开头置位,finally 复位
 *   hydratingSettings:回填控件期间置位,change 处理器据此跳过写回
 *   dialogOutputPath / summaryOutputPath:弹窗与汇总条的输出路径缓存
 * - IPC 契约类型(BatchProgressInfo/BatchItem/BatchResult)同时被 dialogs/
 *   convert-flow/组合根引用,经本模块 re-export(MR-4:类型单源 main/converter/batch.ts)
 */
import { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";
// MR-4:批量契约类型单源 main/converter/batch.ts(本模块 import 后 re-export,
// 保持 renderer 各模块经 state.js 取用的既有导入路径)
import type { BatchItem, BatchProgressInfo, BatchResult } from "../../main/converter/batch.js";
import type { ConvertProgressPayload } from "../../main/ipc/channels.js";

/* ---------- 批量 / 合并契约类型 ---------- */
/** convert:progress 事件 payload(B12 起带 mode 标识;类型单源 main/ipc-channels.ts)。 */
export type { ConvertProgressPayload };

/**
 * 批量契约类型单源(MR-4):BatchProgressInfo/BatchItem/BatchResult 收敛
 * main/converter/batch.ts(主进程实现侧),本模块 re-export 保持既有导入路径
 * (renderer 各模块仍从 state.js 取用,编译期擦除无运行时依赖);
 * preload.cts 同样从 batch.ts import type——三份内联镜像清零。
 */
export type { BatchItem, BatchProgressInfo, BatchResult };

/* ---------- 共享可变状态(单一来源,各模块经 state.xxx 读写) ---------- */
export const state = {
  /** 当前选中的 Markdown 文件列表(1 个或 N 个)。 */
  selectedFiles: [] as string[],
  selectedFormat: "docx" as "docx" | "pdf",
  /**
   * 当前转换模式 = 转换中标志 + 模式合一(B8 卫生项:原 converting 布尔字段与
   * 本字段恒同置同清,收敛为单源;「是否转换中」即 mode !== null):
   * 控制进度事件归属(忽略迟到事件)+ 各入口的转换中守卫。
   */
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
  /** 最近一次批量使用的格式(批次 11 迭代 2:重试失败项按原格式重转)。 */
  lastBatchFormat: undefined as "docx" | "pdf" | undefined,
  /** 转换完成弹窗「不再提示」(ui-state 字段的内存镜像;批次 11 迭代 2)。 */
  suppressCompleteDialog: false,
  /** 转换成功后刷新最近区块的回调(批次 15 R5:recent-files 注册、convert-flow 调用,
   *  打破 recent-files ↔ convert-flow 的 ESM 循环依赖;组合根 renderer.ts 接线)。
   *  允许返回 Promise(注册方 refreshRecentFiles 为 async,内部已自吞错误)。 */
  recentRefreshHandler: null as (() => void | Promise<void>) | null,
};
