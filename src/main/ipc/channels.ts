/**
 * IPC channel 名单一来源:
 * - 全部 channel 统一「域:动作」命名(域在前,动宾序一致;历史混名的
 *   import:pdf-css → css:import、dialog:openMarkdowns → file:openDialog 等已归位);
 * - main/index.ts 的 handle/send 一律经本模块引用,禁止散落字符串字面量;
 * - preload.cts 因沙箱隔离(sandbox:true 下 preload.cjs 只能 require electron,
 *   无法在运行时加载本项目 ESM 模块)无法直接 import 本文件,侧内镜像同名常量,
 *   漂移由 test/segments/ipc-channels.test.js 对 dist 双侧提取恒等断言兜底。
 */

/** 转换模式标识(convert:progress payload.mode;批量走 convert:batchProgress 独立通道,mode 预留)。 */
export type ConvertMode = "single" | "batch" | "merge";

/** convert:progress 事件 payload(main → renderer 推送)。 */
export interface ConvertProgressPayload {
  /** 阶段键(read/render/done + pdf 细分 parse/inline/mermaid/katex/print) */
  stage: string;
  /** 发起本次转换的入口模式(renderer 直接消费,不再按调用上下文推断) */
  mode: ConvertMode;
}

export const IPC_CHANNELS = {
  /* ---- 文件域 ---- */
  /** 多选 markdown 文件对话框(取消返回 []) */
  fileOpenDialog: "file:openDialog",
  /** 读取单文件 frontmatter 元数据(向导封面预填用) */
  readFrontmatter: "file:readFrontmatter",
  /** 拖放路径收集:目录递归取 md,非 md 进 skipped */
  fileCollectMarkdown: "file:collectMarkdown",
  /** 保序过滤仍存在的路径(会话恢复) */
  fileFilterExisting: "file:filterExisting",
  /* ---- 目录域 ---- */
  /** 选择输出目录(取消返回 null) */
  dirSelect: "dir:select",
  /** 选择页眉 logo 图片(取消返回 null) */
  headerLogoSelect: "header-logo:select",
  /* ---- 转换域 ---- */
  /** 单文件转换 */
  convertSingle: "convert:single",
  /** 批量转换 */
  convertBatch: "convert:batch",
  /** 合并转换 */
  convertMerge: "convert:merge",
  /** 读取系统剪贴板:文本写临时 md 返回路径,或返回文件路径,或 empty */
  clipboardRead: "clipboard:read",
  /** 取消当前窗口的转换(单文件/批量/合并通用) */
  convertCancel: "convert:cancel",
  /** 单文件/合并转换进度推送(payload 见 ConvertProgressPayload) */
  convertProgress: "convert:progress",
  /** 批量转换进度推送({index,total,file,stage}) */
  convertBatchProgress: "convert:batchProgress",
  /** 转换前静态预检(读文件 + 解析 + 扫描,返回 ConvertWarning[]) */
  convertPrecheck: "convert:precheck",
  /* ---- 预设域 ---- */
  /** 导入模板预设 JSON */
  presetsImport: "presets:import",
  /** 导出全部自定义预设为 JSON */
  presetsExport: "presets:export",
  /* ---- CSS 域 ---- */
  /** 导入 CSS 文件作为 PDF 样式模板 */
  cssImport: "css:import",
  /* ---- docx 模板导入(浅导入 v1) ---- */
  /** 导入 Word 模板(.docx):解包提取样式/页面映射到当前设置 */
  templateImportDocx: "template:importDocx",
  /* ---- 设置域 ---- */
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  /* ---- 主题域 ---- */
  /** 标题栏 overlay 配色同步(renderer 主题变更后调用,传主题偏好
   *  system/light/dark;system 由 main 经 nativeTheme 解析实际生效主题) */
  themeSyncOverlay: "theme:syncOverlay",
  /* ---- UI 状态域 ---- */
  uiStateGet: "ui-state:get",
  uiStateSet: "ui-state:set",
  /* ---- 应用域 ---- */
  appVersion: "app:version",
  /** 打开「关于」窗口(标题栏按钮经 renderer → main 转发) */
  aboutOpen: "about:open",
  /* ---- Shell 域 ---- */
  /** 资源管理器中显示目标文件 */
  shellRevealInFolder: "shell:revealInFolder",
  /** 系统默认程序打开目标文件 */
  shellOpenPath: "shell:openPath",
  /* ---- 预览域 ---- */
  previewOpen: "preview:open",
  previewRefresh: "preview:refresh",
  /* ---- 菜单域 ---- */
  /** 应用菜单「打开文件…」转发 renderer */
  menuOpen: "menu:open",
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
