/**
 * preload 暴露面类型单源(跨进程契约层)。
 *
 * 背景:`window.api` 的类型此前由 `src/main/preload.cts` 内的 `typeof api` 推导,
 * renderer 只能 `import type { PreloadApi } from "../main/preload.cjs"` 取用 ——
 * 那是全库唯一一条 renderer→main 的反向依赖,靠 `gates/repo/check-import-boundary.mjs`
 * 的 `REVERSE_TYPE_ALLOWLIST` 放行(该条目自 2026-09-25 挂了近一年)。
 * 收口办法:把形状显式声明在此处(core 侧无 Electron 依赖),preload 用它标注
 * `const api: PreloadApi`,renderer 也从 core 取 —— 两侧同源,反向依赖消失。
 *
 * 漂移防护:preload 的 `api` 对象以本类型标注,故**多一个方法或少一个签名都会被
 * tsc 判红**(对象字面量的多余属性检查 + 实现签名不符)。另有一处本类型相对
 * `typeof api` 推导会丢的保护,在 preload.cts 里用**双向键集断言**补回 ——
 * 推导类型构造上不可能漂移,手写类型会,故两个方向都要显式锁。
 *
 * 约定:只放「跨进程暴露的 API 形状」(零 Electron/fs 实现依赖,可被任意一侧
 * import);实现侧 import 本文件类型,须满足本契约。
 */
import type { DocMetadata } from "./pipeline/frontmatter.js";
import type { AppSettings } from "./settings/settings-defaults.js";
import type {
  BatchOperationBusyResult,
  BatchProgressInfo,
  BatchResult,
  ClipboardReadResult,
  ConvertProgressPayload,
  ConvertResult,
  ExportPresetsResult,
  ImportDocxTemplateResult,
  ImportPdfCssResult,
  ImportPresetsResult,
  OperationBusyResult,
  PrecheckResult,
  UiState,
} from "./ipc-contract.js";

/** preload 经 contextBridge 暴露给 renderer 的受控 API 形状。 */
export type PreloadApi = {
  /** 拖放取路径:File.path 已随 Electron 32+ 移除,须经 webUtils 解析(勿回退) */
  getPathForFile: (file: File) => string;
  /** 多选文件对话框,返回所选文件路径数组;空数组 = 用户取消。 */
  openMarkdowns: () => Promise<string[]>;
  /** 取消返回 null */
  selectDir: () => Promise<string | null>;
  /** 限图片扩展名;取消返回 null */
  selectHeaderLogo: () => Promise<string | null>;
  /** 单文件/批量/合并通用 */
  convertCancel: () => Promise<void>;
  /** 展开拖入路径(文件 + 文件夹递归),过滤出 Markdown 文件;skipped 为被跳过的项。 */
  collectMarkdowns: (paths: string[]) => Promise<{ files: string[]; skipped: string[] }>;
  convert: (filePath: string, format: "docx" | "pdf") => Promise<ConvertResult | OperationBusyResult>;
  convertBatch: (
    files: string[],
    format: "docx" | "pdf",
  ) => Promise<BatchResult | BatchOperationBusyResult>;
  convertMerge: (
    files: string[],
    format: "docx" | "pdf",
    options?: { metadata?: DocMetadata },
  ) => Promise<ConvertResult | OperationBusyResult>;
  /** 读取单文件 frontmatter 元数据(向导封面预填用) */
  readFrontmatter: (filePath: string) => Promise<DocMetadata>;
  /** 读取系统剪贴板:文本写临时 md 返回路径,或返回文件路径,或 empty */
  clipboardRead: () => Promise<ClipboardReadResult>;
  /** 转换前静态预检:main 读文件 + 解析 + 扫描,返回 ConvertWarning[] */
  precheck: (filePath: string) => Promise<PrecheckResult>;
  /** 订阅转换进度;payload 带 mode 标识(single/batch/merge);返回退订函数 */
  onConvertProgress: (cb: (info: ConvertProgressPayload) => void) => () => void;
  /** 订阅批量进度;返回退订函数 */
  onBatchProgress: (cb: (info: BatchProgressInfo) => void) => () => void;
  settingsGet: () => Promise<AppSettings>;
  settingsSet: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  /** 主题变更后通知 main 同步 Windows 标题栏 overlay 配色
   *  (传主题偏好;system 由 main 经 nativeTheme 解析实际生效主题)。 */
  syncTitleBarOverlay: (theme: "system" | "light" | "dark") => Promise<void>;
  /** 应用版本号(header 显示,与「关于」对话框同源)。 */
  getVersion: () => Promise<string>;
  /** 取消 → { ok:true, canceled:true } */
  importPresets: () => Promise<ImportPresetsResult>;
  /** 无预设 → { ok:false, error } */
  exportPresets: () => Promise<ExportPresetsResult>;
  /** 取消 → { ok:true, canceled:true };超限/读取失败 → { ok:false, error } */
  importPdfCss: () => Promise<ImportPdfCssResult>;
  /** 取消 → { ok:true, canceled:true };解析/读取失败 → { ok:false, error } */
  importDocxTemplate: () => Promise<ImportDocxTemplateResult>;
  uiStateGet: () => Promise<UiState>;
  uiStateSet: (patch: Partial<UiState>) => Promise<UiState>;
  /** 逐项校验,缺失剔除(保序)。 */
  filterExistingPaths: (paths: string[]) => Promise<string[]>;
  /** 安全边界:仅放行本会话转换产物,防被攻破的 renderer 打开任意文件;
   *  白名单外/失败返回 { ok:false, error },renderer 走既有错误提示通道。 */
  revealInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  /** 安全边界:仅放行本会话转换产物,防被攻破的 renderer 打开任意文件;失败返回 { ok: false, error }。 */
  openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  openPreview: (mdPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** 无预览窗口时为空操作。 */
  previewRefresh: () => Promise<void>;
  /** 订阅菜单打开事件;返回退订函数 */
  onMenuOpen: (cb: () => void) => () => void;
  /** 标题栏「关于」按钮 → 打开关于窗口(无返回值,fire-and-forget) */
  openAbout: () => void;
};
