/**
 * IPC 注册体:全部 ipcMain.handle 注册 + convert 系 handler 共用 ctx 注册表与样板。
 * 依赖方向单向(防循环):本模块 → 窗口/converter/persist/services/logic,窗口层不反向依赖本模块。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConvertFormat, ThemePreference } from "../../core/settings/settings-defaults.js";
import type { BatchProgressInfo, BatchResult, ConvertMode, PrecheckResult, UiState } from "../../core/ipc-contract.js";
import { t, setLanguage, type Language } from "../../core/i18n.js";
import { precheckMarkdown } from "../../core/markdown/precheck.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { prepareMarkdown } from "../converter/preprocess.js";
import {
  buildPresetsExportPayload,
  buildRecentFileEntries,
  compareVersions,
  errorMessage,
  importPresetsFromText,
  isConvertFormat,
  isPrecheckFailureOutcome,
  isString,
  isStringArray,
  normalizePrecheckOutcome,
  operationBusyResult,
  runConvertTask,
  type BusyResult,
} from "./logic.js";
import {
  loadSettings,
  updateSettings,
  MAX_PDF_CSS_BYTES,
  type AppSettings,
  type ExportPresetsResult,
  type ImportDocxTemplateResult,
  type ImportPdfCssResult,
  type ImportPresetsResult,
} from "../persist/settings.js";
import { loadUiState, saveUiState } from "../persist/ui-state.js";
import {
  batchConvertImpl,
  collectMarkdownPaths,
  convertImpl,
  createConvertContext,
  filterExistingPaths,
  mergeConvertImpl,
  type ConvertContext,
  type ConvertResult,
} from "../converter/index.js";
// 取消判定按错误码单源(ERR_CONVERSION_CANCELLED,core/cancel.ts):main 层的
// ConvertCanceledError 与 core 渲染期取消错误同码,只认类引用会漏判后者
import { isConversionCanceled } from "../../core/cancel.js";
import { getKatexDir } from "../services/resource-dirs.js";
import { importDocxTemplate } from "../../core/docx/template-import.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import { getMainWindow } from "../windows/main-window.js";
import { isThemePreference, syncTitleBarOverlay } from "../windows/title-bar-overlay.js";
import { buildAppMenu } from "../menu.js";
import { IPC_CHANNELS as CH } from "./channels.js";
import {
  clipboardTempDir,
  clipboardTempSources,
  clipboardTitle,
  writeTempMarkdown,
} from "../services/temp-html.js";
import type { ClipboardReadResult } from "./types.js";
import { openPreviewWindow, previews, requestPreviewRefresh } from "../windows/preview.js";
import {
  beginWebContentsOperation,
  cancelWebContentsOperation,
  finishWebContentsOperation,
  type WebContentsOperationKind,
} from "../windows/web-contents-registry.js";

/** GitHub 仓库 slug(owner/repo),集中一处;从 package.json repository 或现有 docs/index.html 链接取 */
const REPO_SLUG = "chenchaodev/markdown-to-word";

/**
 * convert 系 handler 共用样板:本函数只保留 Electron 触点(win 解析 + 按 webContents id 注册/注销 + 取消错误判定),
 * 纯逻辑下沉至 ipc-logic.runConvertTask。
 * 取消语义(历史 bug 领域)集中此处,不再分散在三个 handler:
 * - ctx 每次调用新建(「取消后复位」语义),按 webContents id 原子注册(多窗口隔离)
 * - 注册冲突立即返回 busy;finally 以 token compare-and-delete 释放
 * - 取消错误 → onCanceled()(调用方给出取消结果形态);其他错误归一 { ok:false, error }
 *   取消判定按错误码(ERR_CONVERSION_CANCELLED 单源于 core/cancel.ts):渲染期取消经
 *   signal 到达 core 时抛的是 core 侧错误类型,只认 main 类引用会把它误报为「转换失败」。
 */
async function runWithCtx<T>(
  event: Electron.IpcMainInvokeEvent,
  kind: WebContentsOperationKind,
  fn: (ctx: ConvertContext, win: BrowserWindow | null) => Promise<T>,
  onCanceled: () => T | { ok: false; error: string },
  onBusy: () => T | BusyResult,
): Promise<T | BusyResult | { ok: false; error: string }> {
  const senderId = event.sender.id;
  let token: symbol | null = null;
  return runConvertTask(
    {
      createContext: createConvertContext,
      registerCtx: (ctx) => {
        token = beginWebContentsOperation(senderId, kind, ctx);
        return token !== null;
      },
      unregisterCtx: () => {
        if (token !== null) finishWebContentsOperation(senderId, token);
      },
      isCanceledError: isConversionCanceled,
    },
    (ctx) => fn(ctx, BrowserWindow.fromWebContents(event.sender)),
    onCanceled,
    onBusy,
  );
}

/**
 * 转换成功钩子:记录最近文件条目 {path,name,format,ts}。
 * saveUiState 内部按 path 去重(保留 ts 最大)+ 截断 10,重复转换自然置顶;写入失败静默,不影响转换结果。
 * 剪贴板临时源不入账:它是一次性中间物(收尾即删除),记进去只会留下点不开的
 * %TEMP% 条目。判定走会话级注册表(含已释放的路径),不依赖登记顺序。
 */
async function recordRecentFiles(filePaths: string[], format: ConvertFormat): Promise<void> {
  const durable = filePaths.filter((p) => !clipboardTempSources.isTempSource(p));
  const entries = buildRecentFileEntries(durable, format, Date.now());
  if (entries.length === 0) return;
  try {
    await saveUiState({ recentFiles: entries });
  } catch {
    /* 静默:UI 状态写入失败不影响转换 */
  }
}

/** 上次对话框目录:仅当仍存在且为目录时使用(记忆失效自动回落默认)。 */
async function lastOpenDirIfValid(): Promise<string | undefined> {
  const dir = loadUiState().lastOpenDir;
  if (!dir) return undefined;
  try {
    const st = await fs.stat(dir);
    return st.isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 打开选择对话框 + 记忆所选目录(四处 handler 共用样板,收口「开对话框 → 默认
 * 目录回落 → 记忆所选」三连重复):defaultPath 取上次记忆目录;选择成功 → 记忆
 * 首项所在目录(目录选择本身即目录,文件选择取 dirname;下次默认打开位置),
 * 写入失败静默不影响返回;取消或空选 → null。
 */
async function selectAndRememberDir(options: {
  title: string;
  properties: NonNullable<Electron.OpenDialogOptions["properties"]>;
  filters?: Electron.OpenDialogOptions["filters"];
}): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    title: options.title,
    defaultPath: await lastOpenDirIfValid(),
    filters: options.filters,
    properties: options.properties,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const first = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
  const selectedDir = options.properties.includes("openDirectory");
  await saveUiState({ lastOpenDir: selectedDir ? first : path.dirname(first) }).catch(() => undefined);
  return result.filePaths;
}

/**
 * 导入类 handler 共用模板:打开对话框(取消 → { ok:true, canceled:true })→ readFile → process 校验/持久化
 * → 成功后记忆所选目录 → catch 归一为可读文案。process 返回 ok:false 时跳过目录记忆。
 */
async function importFileViaDialog<T extends ImportPresetsResult | ImportPdfCssResult>(options: {
  title: string;
  filters: { name: string; extensions: string[] }[];
  process: (text: string, filePath: string) => Promise<T>;
}): Promise<T> {
  const result = await dialog.showOpenDialog({
    title: options.title,
    defaultPath: await lastOpenDirIfValid(),
    filters: options.filters,
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    // 两个结果联合类型均含 { ok:true, canceled:true } 分支,此处收窄安全
    return { ok: true, canceled: true } as T;
  }
  try {
    const filePath = result.filePaths[0]!; // 上方已拦截取消与空列表,首项必存在
    const text = await fs.readFile(filePath, "utf8");
    const out = await options.process(text, filePath);
    if (out.ok) {
      // 与其它打开对话框一致:成功后记忆所选目录(下次默认打开位置)
      await saveUiState({ lastOpenDir: path.dirname(filePath) }).catch(() => undefined);
    }
    return out;
  } catch (err) {
    return { ok: false, error: t("preset.readFailed", { error: errorMessage(err) }) } as T;
  }
}

/* ---------- 安全边界:shell.openPath/showItemInFolder 白名单 ----------
 * 仅放行本会话成功转换产物的输出路径(各转换 handler 成功时登记)。被攻破的
 * renderer 原本可借主进程打开任意文件;白名单外路径拒绝并返回错误,renderer
 * 走既有错误提示通道展示。会话级集合即可覆盖全部合法入口(弹窗/汇总条的
 * 路径均来自当次转换结果);应用重启后 renderer 侧缓存同样清零,无合法场景受损。 */
const allowedOutputPaths = new Set<string>();

function allowOutputPath(outputPath: string): void {
  allowedOutputPaths.add(outputPath);
}

function isAllowedOutputPath(p: string): boolean {
  return allowedOutputPaths.has(p);
}

/** convertMerge 第 3 参类型守卫:含可选 metadata 字段 */
function isMetadataOptions(v: unknown): v is { metadata?: DocMetadata } {
  return typeof v === "object" && v !== null && ("metadata" in v);
}

/** 已挂「销毁即释放」监听的 webContents(每窗口只挂一次,防多次粘贴堆叠监听)。 */
const clipboardTempOwnersWatched = new Set<number>();

/**
 * 发起窗口销毁时释放其名下未消费的剪贴板临时源(未走完转换的粘贴不残留)。
 * 监听挂在 WebContents 自身上,随窗口回收,无需解绑;主窗口正常关闭路径另有
 * windows/main-window.ts 的显式 dispose 接线(覆盖「转换进行中关闭」等先销毁场景)。
 */
function watchClipboardTempOwner(sender: Electron.WebContents, ownerId: string): void {
  if (clipboardTempOwnersWatched.has(sender.id)) return;
  clipboardTempOwnersWatched.add(sender.id);
  sender.once("destroyed", () => {
    clipboardTempOwnersWatched.delete(sender.id);
    void clipboardTempSources.releaseOwner(ownerId);
  });
}

// 退出兜底:窗口 closed 之外的退出路径(如转换放弃后强制退出)同样回收未消费临时源。
app.on("will-quit", () => {
  void clipboardTempSources.releaseAll();
});

/* ---------- 设置落盘后的 main 侧运行时副作用(单源) ---------- */
/**
 * 设置里 language/theme 两项的 main 侧表现此前只在启动时初始化一次
 * (index.ts 的 setLanguage + buildAppMenu),运行期改设置后菜单仍是旧语言、
 * 标题栏 overlay 仍是旧配色——renderer 单独改了它管得到的部分。
 * 此处收口「设置值 → main 侧表现」的唯一判定与执行,启动与 settings:set 共用。
 */

/** 副作用判定结果(字段为 null/false = 该项无变化,不动作)。 */
export interface SettingsRuntimePlan {
  /** 需切换到的界面语言(null = 语言未变) */
  language: Language | null;
  /** 是否重建应用菜单(菜单文案经 t() 查表,语言变了必须重建才生效) */
  menu: boolean;
  /** 需同步的标题栏 overlay 主题(null = 主题未变) */
  overlay: ThemePreference | null;
}

/** 副作用执行触点(依赖注入:判定是纯函数,Electron 触点经此注入便于直测)。 */
export interface SettingsRuntimeDeps {
  setLanguage(lang: Language): void;
  buildMenu(): void;
  /** 按主题偏好同步标题栏 overlay(win 由 resolveMainWindow 解析,可为 null) */
  syncOverlay(pref: ThemePreference, win: BrowserWindow | null): void;
  resolveMainWindow(): BrowserWindow | null;
}

/** 生产接线(setLanguage/菜单构建/overlay 同步/主窗口解析各自单源,勿在此复制实现)。 */
const defaultRuntimeDeps: SettingsRuntimeDeps = {
  setLanguage,
  buildMenu: buildAppMenu,
  syncOverlay: (pref, win) => syncTitleBarOverlay(win, pref),
  resolveMainWindow: getMainWindow,
};

/**
 * 副作用判定(纯函数,单源):语言变 → 切语言 + 重建菜单;主题变 → 同步标题栏 overlay。
 * before 传 null = 无基线(启动路径,此时 main 侧一切都是初值)→ 全量应用一次。
 * 无变化一律不动作:settings:set 频繁触发,重建菜单/重设 overlay 无视觉收益。
 */
export function planSettingsRuntimeSync(
  before: Pick<AppSettings, "language" | "theme"> | null,
  after: Pick<AppSettings, "language" | "theme">,
): SettingsRuntimePlan {
  const languageChanged = before === null || before.language !== after.language;
  const themeChanged = before === null || before.theme !== after.theme;
  return {
    language: languageChanged ? after.language : null,
    menu: languageChanged,
    overlay: themeChanged ? after.theme : null,
  };
}

/** 执行判定结果(返回 plan 供调用方留痕与直测)。 */
export function applySettingsRuntimeSync(
  before: Pick<AppSettings, "language" | "theme"> | null,
  after: Pick<AppSettings, "language" | "theme">,
  deps: SettingsRuntimeDeps = defaultRuntimeDeps,
): SettingsRuntimePlan {
  const plan = planSettingsRuntimeSync(before, after);
  if (plan.language !== null) {
    deps.setLanguage(plan.language);
    if (plan.menu) deps.buildMenu();
  }
  if (plan.overlay !== null) {
    deps.syncOverlay(plan.overlay, deps.resolveMainWindow());
  }
  return plan;
}

/**
 * 启动路径入口(无基线):按持久化设置全量应用一次 main 侧副作用。
 * 此刻主窗口尚未创建 → overlay 同步为空操作(createWindow 内按持久化主题同步
 * overlay,单源仍在 windows/title-bar-overlay.ts),调用它只为与运行期共用同一编排。
 */
export function applyStartupSettingsRuntime(
  settings: Pick<AppSettings, "language" | "theme">,
  deps: SettingsRuntimeDeps = defaultRuntimeDeps,
): SettingsRuntimePlan {
  return applySettingsRuntimeSync(null, settings, deps);
}

export function registerIpc(): void {
  ipcMain.handle(CH.fileOpenDialog, async () => {
    const paths = await selectAndRememberDir({
      title: t("dialog.openMarkdowns"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    return paths ?? [];
  });

  // 执行转换:错误不外抛,统一返回 { ok, error } 让 renderer 展示;用户取消返回 { ok:false, canceled:true }
  // 入参类型守卫:format 非 docx/pdf 时此前静默落 pdf 分支,现显式失败
  // 剪贴板临时源:本 handler 是其唯一消费点,故 finally 一处覆盖成功/失败/取消/
  // busy 四种结局(转换已 settle,此刻删源不影响产物);非剪贴板路径为空操作。
  ipcMain.handle(CH.convertSingle, async (event, filePath: unknown, format: unknown): Promise<ConvertResult | BusyResult> => {
    if (!isString(filePath) || !isConvertFormat(format)) {
      return { ok: false, error: t("common.invalidParams") };
    }
    try {
      return await runWithCtx(
        event,
        "single",
        async (ctx, win) => {
          // progress payload 带 mode 标识,renderer 直接消费归属(不再按调用上下文推断)
          const send = (stage: string): void =>
            win?.webContents.send(CH.convertProgress, { stage, mode: "single" satisfies ConvertMode });
          const { outputPath, warnings } = await convertImpl(filePath, format, send, ctx, getKatexDir());
          allowOutputPath(outputPath); // 产物路径入 shell 白名单
          await recordRecentFiles([filePath], format);
          return { ok: true, outputPath, warnings };
        },
        () => ({ ok: false, canceled: true, error: t("common.canceled") }),
        () => operationBusyResult(t("convert.stage.converting")),
      );
    } finally {
      if (clipboardTempSources.isTempSource(filePath)) {
        void clipboardTempSources.releaseByPath(filePath);
      }
    }
  });

  ipcMain.handle(CH.convertCancel, (event): void => {
    cancelWebContentsOperation(event.sender.id);
  });

  // 转换前静态预检:仅读取与解析,不触发实际渲染;与转换共享同一活动操作注册表
  // (转换进行中返回明确 busy,单窗口同一时刻至多一个预检/转换)。
  // 预检自身失败(文件缺失/解码失败/读取异常)不静默折叠为空数组:归一为一条
  // 失败警告随既有 PrecheckResult 通道返回,用户可见且仍可选择继续转换。
  ipcMain.handle(
    CH.convertPrecheck,
    async (event, filePath: unknown): Promise<PrecheckResult> => {
      if (!isString(filePath)) return [];
      const outcome = await runWithCtx(
        event,
        "precheck",
        async () => {
          const warnings: ConvertWarning[] = [];
          const prepared = await prepareMarkdown(filePath, loadSettings(), warnings);
          return [
            ...warnings,
            ...precheckMarkdown(prepared.body, path.dirname(filePath)),
          ];
        },
        () => [],
        () => operationBusyResult(t("convert.stage.converting")),
      );
      // 失败在主进程留痕(用户可见警告之外的可追溯记录),再归一为 PrecheckResult
      if (isPrecheckFailureOutcome(outcome)) {
        console.error(`[main] convert:precheck 失败(${filePath}):`, outcome.error);
      }
      return normalizePrecheckOutcome(outcome);
    },
  );

  ipcMain.handle(CH.dirSelect, async (): Promise<string | null> => {
    const paths = await selectAndRememberDir({
      title: t("dialog.selectDir"),
      properties: ["openDirectory", "createDirectory"],
    });
    return paths?.[0] ?? null;
  });

  ipcMain.handle(CH.headerLogoSelect, async (): Promise<string | null> => {
    const paths = await selectAndRememberDir({
      title: t("dialog.selectHeaderLogo"),
      properties: ["openFile"],
      filters: [
        { name: t("dialog.imageFiles"), extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
      ],
    });
    return paths?.[0] ?? null;
  });

  // 元素级校验:此前只 guard Array.isArray,非字符串元素会让 path.resolve 抛 TypeError
  // 扫描预算警告(深度/条目数触顶)随结果返回,不静默截断:既有 files/skipped 语义
  // 不变,warnings 为附加字段(仅解构 files/skipped 的消费方不受影响)。
  ipcMain.handle(
    CH.fileCollectMarkdown,
    async (
      _event,
      paths: unknown,
    ): Promise<{ files: string[]; skipped: string[]; warnings: ConvertWarning[] }> => {
      const warnings: ConvertWarning[] = [];
      const result = await collectMarkdownPaths(isStringArray(paths) ? paths : [], warnings);
      return { ...result, warnings };
    },
  );

  // 批量转换:并发 2,失败不中断,进度走 convert:batchProgress;取消由 batchConvertImpl 内部收集 canceledCount,
  // 不抛 ConvertCanceledError(onCanceled 分支为防御兜底,与 catch-all 归一一致)
  ipcMain.handle(
    CH.convertBatch,
    async (event, files: unknown, format: unknown): Promise<BatchResult | { ok: false; error: string } | BusyResult> => {
      if (!isStringArray(files) || !isConvertFormat(format)) {
        return { ok: false, error: t("common.invalidParams") };
      }
      return runWithCtx(
        event,
        "batch",
        async (ctx, win) => {
          const send = (info: BatchProgressInfo): void =>
            win?.webContents.send(CH.convertBatchProgress, info);
          const result = await batchConvertImpl(files, format, send, ctx, getKatexDir());
          // 成功项产物路径入 shell 白名单
          for (const item of result.items) {
            if (item.ok && item.outputPath) allowOutputPath(item.outputPath);
          }
          await recordRecentFiles(
            result.items.filter((item) => item.ok && item.file).map((item) => item.file),
            format,
          );
          return result;
        },
        () => ({ ok: false, error: t("common.canceled") }),
        // busy 基形与其它 handler 同源(逻辑.operationBusyResult),此处并接批量计数字段
        () => ({
          ...operationBusyResult(t("convert.stage.converting")),
          items: [],
          okCount: 0,
          failCount: 0,
          canceledCount: 0,
        }),
      );
    },
  );

  // 合并转换:多文件 → mergeMarkdowns → 单次 convert,输出 {首文件名}-合并.{ext}
  // 第 3 参 options.metadata:向导封面显式元数据,优先于首文件 frontmatter
  ipcMain.handle(
    CH.convertMerge,
    async (event, files: unknown, format: unknown, options: unknown): Promise<ConvertResult | BusyResult> => {
      if (!isStringArray(files) || !isConvertFormat(format)) {
        return { ok: false, error: t("common.invalidParams") };
      }
      const metadata = isMetadataOptions(options) ? options.metadata : undefined;
      return runWithCtx(
        event,
        "merge",
        async (ctx, win) => {
          // 与单文件同通道,payload.mode = "merge" 区分归属
          const send = (stage: string): void =>
            win?.webContents.send(CH.convertProgress, { stage, mode: "merge" satisfies ConvertMode });
          const result = await mergeConvertImpl(files, format, send, ctx, getKatexDir(), metadata);
          if (result.ok) {
            if (result.outputPath) allowOutputPath(result.outputPath); // 产物路径入 shell 白名单
            await recordRecentFiles(files, format);
          }
          return result;
        },
        () => ({ ok: false, canceled: true, error: t("common.canceled") }),
        () => operationBusyResult(t("convert.stage.converting")),
      );
    },
  );

  // 读取单文件 frontmatter 元数据(向导封面预填用):走统一文件准备链,
  // 覆盖 GBK/UTF-16 解码与 frontmatter 隔离;读取失败仍沿用空 metadata 降级。
  ipcMain.handle(CH.readFrontmatter, async (_event, filePath: unknown): Promise<DocMetadata> => {
    if (!isString(filePath)) return {};
    try {
      const prepared = await prepareMarkdown(filePath, loadSettings());
      return prepared.metadata;
    } catch {
      return {};
    }
  });

  // 读取系统剪贴板:优先文件路径(Windows 剪贴板 FileNameW 格式:UTF-16LE、
  // \u0000 分隔、末尾空字符)→ 文本写临时 md → 空/非文本非文件返回 empty。
  // 文本分支的临时源是**一次性句柄**:登记到发起方 webContents 名下,五条出口
  // 都会删除(转换成功/失败/取消收尾、发起窗口关闭、进程退出),再次粘贴先释放
  // 上一份;未消费的残留由后两者兜底,不留 %TEMP% 垃圾。
  ipcMain.handle(CH.clipboardRead, async (event): Promise<ClipboardReadResult> => {
    // 1) 先试文件路径(Windows 剪贴板 FileNameW 格式:UTF-16LE、\u0000 分隔、末尾空字符)
    const buf = clipboard.readBuffer("FileNameW");
    if (buf && buf.length > 2) {
      const s = buf.toString("utf16le");
      const paths = s
        .split("\u0000")
        .map((x) => x.trim())
        .filter((x) => x.length > 0 && !x.endsWith(":"));
      if (paths.length) return { type: "files", paths };
    }
    // 2) 文本 → 临时 md(文件基名取自内容标题,产物名与文档标题均可读)
    const text = clipboard.readText();
    if (text && text.trim().length > 0) {
      const ownerId = String(event.sender.id);
      const source = await writeTempMarkdown(text, {
        title: clipboardTitle(text, t("b3.label")),
        dir: clipboardTempDir(),
      });
      await clipboardTempSources.add(ownerId, source);
      watchClipboardTempOwner(event.sender, ownerId);
      return { type: "text", mdPath: source.mdPath };
    }
    return { type: "empty" };
  });

  ipcMain.handle(CH.settingsGet, (): AppSettings => loadSettings());
  // 界面版本信息:与「关于」对话框同源 app.getVersion
  ipcMain.handle(CH.appVersion, (): string => app.getVersion());

  // 关于页更新检查:main 进程查 GitHub Releases latest,避开 renderer CORS/UA 限制
  ipcMain.handle(CH.aboutCheckUpdate, async (): Promise<{
    status: "latest" | "available" | "error";
    current: string;
    latest?: string;
    url?: string;
  }> => {
    const current = app.getVersion();
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO_SLUG}/releases/latest`,
        { headers: { "User-Agent": "markdown-to-word" } },
      );
      if (!res.ok) return { status: "error", current };
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = String(data.tag_name ?? "").replace(/^v/i, "");
      const url = data.html_url ?? `https://github.com/${REPO_SLUG}/releases/latest`;
      if (!latest) return { status: "error", current };
      const status = compareVersions(current, latest) < 0 ? "available" : "latest";
      return { status, current, latest, url };
    } catch {
      return { status: "error", current };
    }
  });

  // 设置落盘 → main 侧运行时副作用即时生效(语言/菜单/标题栏 overlay,单源见上方
  // 运行时副作用区块):改语言后菜单文案与对话框标题立刻跟上,改主题后原生标题栏
  // 按钮区配色立刻跟上(不依赖 renderer 另发 theme:syncOverlay)。
  // before 取落盘前的权威值(缓存对象,updateSettings 产出新对象不污染它)→ 判定差异。
  ipcMain.handle(
    CH.settingsSet,
    async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
      const before = loadSettings();
      const next = await updateSettings(patch);
      applySettingsRuntimeSync(before, next);
      return next;
    },
  );

  // 标题栏 overlay 配色同步:renderer 主题变更后调用(切换当拍即生效,早于落盘),
  // 主题主动方是 renderer,main 只负责原生 overlay 绘制;settings:set 落盘后另有
  // 一次权威同步(上方副作用区块),两者幂等重设,不是双源。
  // 入参守卫:非法值警告留痕不静默(配色失同步可感知但不致命,不值得走错误弹窗打断主题切换)。
  ipcMain.handle(CH.themeSyncOverlay, (_event, theme: unknown): void => {
    if (!isThemePreference(theme)) {
      console.warn("[main] theme:syncOverlay 收到非法主题值:", theme);
      return;
    }
    syncTitleBarOverlay(getMainWindow(), theme);
  });

  // 导入模板预设 JSON:选文件 → 解析校验 → 同名覆盖合并 → 上限 10 → 持久化;
  // 取消 → { ok:true, canceled:true },解析/读取异常 → { ok:false, error }(可读文案)。
  ipcMain.handle(CH.presetsImport, (): Promise<ImportPresetsResult> =>
    importFileViaDialog({
      title: t("dialog.importPresets"),
      filters: [{ name: "JSON", extensions: ["json"] }],
      process: async (text) => {
        const merged = importPresetsFromText(text, loadSettings().customPresets);
        if (!merged.ok) return { ok: false, error: merged.error };
        await updateSettings({ customPresets: merged.presets });
        return {
          ok: true,
          canceled: false,
          imported: merged.imported,
          overridden: merged.overridden,
        };
      },
    }),
  );

  // 导出全部自定义预设为 JSON:保存对话框,schemaVersion:1 包装 + 2 空格缩进;
  // 空预设 main 侧前置拦截(renderer 侧可同样提示,两处一致);取消 → { ok:true, canceled:true }。
  ipcMain.handle(CH.presetsExport, async (): Promise<ExportPresetsResult> => {
    const presets = loadSettings().customPresets;
    if (presets.length === 0) return { ok: false, error: t("preset.noneToExport") };
    const result = await dialog.showSaveDialog({
      title: t("dialog.exportPresets"),
      defaultPath: path.join(app.getPath("documents"), "presets.json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    try {
      const payload = buildPresetsExportPayload(presets);
      await fs.writeFile(result.filePath, payload, "utf8");
      return { ok: true, canceled: false, count: presets.length };
    } catch (err) {
      return { ok: false, error: t("preset.writeFailed", { error: errorMessage(err) }) };
    }
  });

  // 导入 CSS 文件作为 PDF 样式模板:选文件 → 读内容 → 大小上限校验 → 返回内容+文件名;
  // 内容由 renderer 经 settings:set 持久化到 settings.pdfCss(pdf 渲染时追加到默认样式后覆盖);
  // 取消 → { ok:true, canceled:true },读取异常/超限 → { ok:false, error }(可读文案)。
  ipcMain.handle(CH.cssImport, (): Promise<ImportPdfCssResult> =>
    importFileViaDialog({
      title: t("dialog.importPdfCss"),
      filters: [{ name: "CSS", extensions: ["css"] }],
      process: async (css, cssPath) => {
        if (Buffer.byteLength(css, "utf8") > MAX_PDF_CSS_BYTES) {
          return { ok: false, error: t("settings.cssTooLarge", { kb: MAX_PDF_CSS_BYTES / 1024 }) };
        }
        return { ok: true, canceled: false, css, name: path.basename(cssPath) };
      },
    }),
  );

  // 导入 Word 模板(.docx,浅导入 v1):选文件 → 读字节 → 解包提取样式/页面
  // → 与现有设置合并(typography/pageSetup 各自深合并)→ 持久化 → 返回合并后完整对象;
  // 取消 → { ok:true, canceled:true },读取/解析异常 → { ok:false, error }(可读文案)。
  ipcMain.handle(CH.templateImportDocx, async (): Promise<ImportDocxTemplateResult> => {
    const paths = await selectAndRememberDir({
      title: t("dialog.importDocxTemplate"),
      properties: ["openFile"],
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (!paths) {
      return { ok: true, canceled: true };
    }
    try {
      const filePath = paths[0]!; // 上方已拦截取消与空列表,首项必存在
      const buf = await fs.readFile(filePath);
      const partial = await importDocxTemplate(new Uint8Array(buf));
      const settings = loadSettings();
      const merged = {
        typography: { ...settings.typography, ...partial.typography },
        pageSetup: { ...settings.pageSetup, ...partial.pageSetup },
      };
      await updateSettings({ typography: merged.typography, pageSetup: merged.pageSetup });
      return { ok: true, canceled: false, typography: merged.typography, pageSetup: merged.pageSetup };
    } catch (err) {
      return { ok: false, error: t("template.readFailed", { error: errorMessage(err) }) };
    }
  });

  // UI 状态读写(最近文件/会话文件/记忆目录/窗口位置/面板展开态;独立于 settings)
  ipcMain.handle(CH.uiStateGet, (): UiState => loadUiState());
  ipcMain.handle(CH.uiStateSet, (_event, patch: Partial<UiState>): Promise<UiState> => {
    return saveUiState(patch);
  });

  // 会话恢复用:保序过滤仍存在的路径(缺失剔除,不打乱用户排列顺序)
  ipcMain.handle(CH.fileFilterExisting, (_event, paths: unknown): Promise<string[]> => {
    return filterExistingPaths(isStringArray(paths) ? paths : []);
  });

  // 导出后行为:资源管理器中显示 / 默认程序打开(入参类型守卫)。
  // 安全边界:仅放行本会话转换产物白名单内的路径;拒绝时返回 { ok:false, error }
  // (revealInFolder 签名由 void 改为结果对象,renderer 据此走既有错误提示通道)。
  ipcMain.handle(CH.shellRevealInFolder, (_event, filePath: unknown): { ok: boolean; error?: string } => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    if (!isAllowedOutputPath(filePath)) return { ok: false, error: t("shell.notAllowed") };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle(CH.shellOpenPath, async (_event, filePath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(filePath)) return { ok: false, error: t("common.invalidParams") };
    if (!isAllowedOutputPath(filePath)) return { ok: false, error: t("shell.notAllowed") }; // 白名单校验
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });

  // 预览:独立可见窗口展示与 PDF 同排版的 HTML(复用 renderPdfHtml),多窗口并发安全
  ipcMain.handle(CH.previewOpen, (_event, mdPath: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!isString(mdPath)) return Promise.resolve({ ok: false, error: t("common.invalidParams") });
    return openPreviewWindow(mdPath);
  });

  // 设置变更后刷新所有预览窗口:renderer 在 settingsSet 成功后调用;
  // 无预览窗口时为空操作;刷新走每窗口串行队列 + 代号(旧代不覆盖新页);
  // 刷新失败在窗口内显示错误页,不影响主窗口
  ipcMain.handle(CH.previewRefresh, (): void => {
    for (const entry of previews) void requestPreviewRefresh(entry);
  });
}
