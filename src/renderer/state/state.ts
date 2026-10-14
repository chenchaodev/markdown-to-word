/**
 * renderer 共享可变状态(单一来源)与 IPC 契约类型。
 * 不变量:**模块级可变状态以本模块为唯一共享落点** —— feature 模块可持有**文件内私有**
 * 的可变绑定(单文件闭环,不跨模块共享,逐处登记在 ADR-065 的三档表),但**跨模块
 * 共享**的那一份只经本模块读写,不得在 feature 各自持有副本;且本模块之外一律
 * 不得以可变绑定(`let` / `var`)形态导出,门禁 `renderer-no-export-let`)。
 * 批量契约类型(BatchItem/BatchProgressInfo/BatchResult)单源 core/ipc-contract.ts,
 * 本模块 re-export 保持既有导入路径(编译期擦除,无运行时依赖)。
 */
import { cloneDefaultSettings } from "../../core/settings/settings-defaults.js";
import type { BatchItem, BatchProgressInfo, BatchResult, ConvertProgressPayload } from "../../core/ipc-contract.js";
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import type { SettingsMergePatch } from "../../core/settings/merge-patch.js";

/* ---------- 批量 / 合并契约类型 ---------- */
/** convert:progress 事件 payload(类型单源 core/ipc-contract.ts)。 */
export type { ConvertProgressPayload };

/**
 * 批量契约类型单源:BatchProgressInfo/BatchItem/BatchResult 收敛
 * core/ipc-contract.ts(跨进程契约层),本模块 re-export 保持既有导入路径
 * (renderer 各模块仍从 state.js 取用,编译期擦除无运行时依赖);
 * preload.cts 同样从 core import type——renderer→main 反向依赖**只剩 1 条已登记项**:
 * `src/renderer/renderer.ts` 的 `import type { PreloadApi }`,放行见
 * `gates/repo/check-import-boundary.mjs` 的 `REVERSE_TYPE_ALLOWLIST`;收口见 campaign REF-025 计划项 #03。
 */
export type { BatchItem, BatchProgressInfo, BatchResult };

/* ---------- 设置保存流水线的 DOM 触点类型(由 state.settingsSave.hooks 持有) ---------- */

/**
 * 设置抽屉交给保存流水线的 DOM 触点(由 `settings/settings-save.ts` 的
 * `registerSettingsSaveHooks` 注册,组合根在加载面板时完成)。
 *
 * **为什么类型声明在本模块**而非 settings-save:store 持有这个槽(见
 * `state.settingsSave.hooks`),槽的类型必须与槽同处声明 —— 反过来让 state/ 去
 * import 一个 feature 模块的 type,就撞上 `renderer-foundation-no-feature-dep`
 * (基础层不得反向依赖功能目录)。这与 `recentRefreshHandler` 同一形态:回调类型
 * 声明在 store 侧,实现方在 feature 侧。
 */
export interface SettingsSaveHooks {
  /** 页面设置被规范化后回填全部控件。 */
  applyControls(): void;
  /** main 权威值落到 renderer state 与语言/主题副作用。 */
  applyAuthoritative(settings: AppSettings): void;
  /** 状态区写错误文案。 */
  setError(message: string): void;
  /** 状态区当前文案是否仍等于本模块写入的失败原文(用于精确复位,不误清其它流程提示)。 */
  isStatusMine(text: string): boolean;
  /** 清空状态区。 */
  clearStatus(): void;
  /** 刷新抽屉副标题等 chrome。 */
  refreshDrawerMeta(): void;
}

/* ---------- 共享可变状态(单一来源,各模块经 state.xxx 读写) ---------- */
export const state = {
  /** 当前选中的 Markdown 文件列表(1 个或 N 个)。 */
  selectedFiles: [] as string[],
  selectedFormat: "docx" as "docx" | "pdf",
  /**
   * 当前转换模式 = 转换中标志 + 模式合一:原 converting 布尔字段与本字段恒同置同清,
   * 收敛为单源;「是否转换中」即 mode !== null。
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
  /**
   * 当前设置的内存态(乐观更新,持久化走 settingsSet)。
   * 初值走 core 的 cloneDefaultSettings() 工厂而非展开 DEFAULT_SETTINGS:
   * 展开只换顶层键,6 个分组块仍与单例共用引用,首次 load 到达前那段窗口里的
   * 就地改写会污染全局单例(工厂口径与理由见 core/settings/settings-defaults.ts)。
   */
  settings: cloneDefaultSettings(),
  /** 回填控件期间置位,避免回填触发 change 事件写回 */
  hydratingSettings: false,
  /** 弹窗对应输出文件路径(供「打开所在文件夹 / 打开文件」按钮使用) */
  dialogOutputPath: "",
  /** 最近一次汇总条展示的输出路径(供「打开所在文件夹 / 打开文件」按钮使用)。 */
  summaryOutputPath: "",
  /** 最近一次批量使用的格式(重试失败项按原格式重转)。 */
  lastBatchFormat: undefined as "docx" | "pdf" | undefined,
  /** 转换完成弹窗「不再提示」(ui-state 字段的内存镜像)。 */
  suppressCompleteDialog: false,
  /** 首启引导标志(ui-state 字段的内存镜像):true = 尚未引导过,引导跳过/关闭后置 false。 */
  firstRun: false,
  /** 转换成功后刷新最近区块的回调(recent-files 注册、convert-flow 调用,
   *  打破 recent-files ↔ convert-flow 的 ESM 循环依赖;组合根 renderer.ts 接线)。
   *  允许返回 Promise(注册方 refreshRecentFiles 为 async,内部已自吞错误)。 */
  recentRefreshHandler: null as (() => void | Promise<void>) | null,
  /**
   * 设置保存流水线的**跨模块共享失败重试台账**(ADR-065 §决定 ③:四处模块级
   * 可变状态从 `settings/settings-save.ts` 收敛于此)。
   *
   * 为什么必须整组搬进 store 而不是留在 settings-save:抽屉与向导写的是
   * **同一份草稿** —— `pendingPatch` 在跨模块交替写入时若各维护一份,失败过的
   * 字段会静默丢失(只存在于另一份的内存里),而这类丢失没有任何可见症状。
   * `hooks` 与台账同批搬:它是 DOM 反馈触点,而「失败要不要落可见提示」的判定
   * 就在台账的 revision / failureText 上,拆成两处会让两者各说各话。
   */
  settingsSave: {
    /** 保存修订号:并发保存时只有最后一次的结果被采纳,旧的不得回填控件。 */
    revision: 0,
    /** 保存失败后待重试的草稿 patch(形状 = core 单源 `SettingsMergePatch`;
     *  失败不丢编辑内容:下一次保存与新 patch 合并后一并提交,成功即清空)。 */
    pendingPatch: {} as SettingsMergePatch,
    /** 最近一次失败反馈写入状态区的原文:成功保存后据此精确复位
     *  (不误清其它流程刚写入的提示)。 */
    failureText: null as string | null,
    /** 设置抽屉的 DOM 触点(由 `registerSettingsSaveHooks` 注册;
     *  未注册 = 面板未加载,写盘照常、只跳过 UI 反馈,刻意不抛错)。 */
    hooks: null as SettingsSaveHooks | null,
  },
};
