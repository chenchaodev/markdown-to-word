/**
 * 冒烟自测(--smoke 模式的唯一实现,主进程 index.ts 动态 import 本模块):
 * 只保留必须依赖 Electron 的端到端断言。
 * - convertImpl docx 全链路落盘(基础链路 + 产物存在,端到端性质)
 * - pdf 链路:printToPDF 产物魔数 + 书签注入(Outlines 中文标题 + Dest 页面引用)+ 合并书签
 * - renderer 诊断(executeJavaScript:window.api 注入/按钮可点/状态区反馈/弹窗隐藏)
 * - IPC 接线端到端:经 window.api 真实 invoke convert:single/convert:merge/
 *   app:version 全链路(channel 改名后接线正确性;成功项会写最近文件,结束前还原)
 * 纯逻辑断言(重名保护/批量汇总/merge docx/取消链路/设置注入/分页符产物)由
 * test/segments|main 承担,本模块不触碰设置注入与取消语义。
 *
 * 为什么落在 src/(而非 test/tools/):本模块要在**打包产物**里也能跑起来
 * —— 发布侧检查以 --smoke 启动真实可执行文件并断言诊断标记,入口必须随包分发。
 * build.files 只收 dist/** 与 package.json,故实现必须进 src 编译面(编译产物
 * dist/main/smoke.js 天然在包内);反向约束见本文件末「打包面纪律」。
 *
 * 输出隔离:smoke 不依赖用户持久化设置——outputDir 强制 ""(产物落冒烟目录源文件旁,
 * 自清理可覆盖;否则会污染用户设置的输出目录如 Downloads,且 (N) 序号变体越积越多)、
 * afterConvert 强制 "none"(不自动打开产物弹窗);结束前恢复原设置(崩溃残留风险与
 * converter.test.js 同款 save/restore)。ui-state 同样隔离——备份内存态并清空
 * lastSessionFiles/recentFiles(必须经 saveUiState 同步磁盘与模块缓存,直改文件不生效:
 * createWindow 已把真实状态读入缓存,renderer 走缓存);否则用户残留会话让 convertBtn
 * 非禁用,「未选文件点击守卫」误报。结束恢复(含失败路径),原文件不存在则删除临时写入的文件。
 *
 * 失败:抛错由 index.ts 统一 catch → app.exit(1);renderer diag 失败打印专属消息后重抛。
 *
 * 打包面纪律(改动本文件必读,否则会静默回归「解包产物跑不了 --smoke」):
 * 1. 不得引用仓库相对路径或任何 test/ 路径 —— 打包产物在仓库之外运行,这些路径不存在;
 *    冒烟目录一律经 resolveSmokeOutDir 按 app.getAppPath()/app.getPath("temp") 解析。
 * 2. 需要的资源(katex 字体目录等)走 resource-dirs 解析,不得硬编码路径。
 * 3. 不得把 dev-only 代码引入本模块的依赖图(test/ 不可 import,test 侧只做薄转调)。
 */
import { app, Menu } from "electron";
import type { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { t } from "../core/i18n.js";
import type { ConvertWarning, KeyedWarning } from "../core/i18n.js";
import { convertImpl, mergeConvertImpl } from "./converter/index.js";
import { getKatexDir } from "./services/resource-dirs.js";
import { loadSettings, updateSettings } from "./persist/settings.js";
import { loadUiState, saveUiState } from "./persist/ui-state.js";

/**
 * 诊断标记契约:发布侧检查(scripts/smoke-proc.mjs 的 SMOKE_MARKERS)按这些字符串
 * 断言产物输出,故逐字稳定;新增标记须同步该清单,漂移由
 * test/segments/packaged-smoke.test.js 断言恒等。
 */
export const SMOKE_MARKER = Object.freeze({
  convertOk: "[smoke] convert ok:",
  pdfConvertOk: "[smoke] pdf convert ok:",
  pdfBookmarkOk: "[smoke] pdf 书签 ok:",
  mergePdfBookmarkOk: "[smoke] merge pdf 书签 ok:",
  rendererDiag: "[smoke] renderer diag:",
  ipcDiag: "[smoke] ipc diag:",
  /** 降级留痕(非失败):产物仍出、五条主标记照打,仅此行额外说明降级了什么 */
  pdfDegraded: "[smoke] pdf 降级(非致命):",
});

/** 公式样式资源缺失的警告键(pdf 渲染层 KaTeX CSS 加载失败时上报) */
const KATEX_DEGRADATION_KEY = "warn.katexCssLoadFailed";

/** 一次性冒烟目录名(打包形态下建在系统临时目录,退出前删除) */
const EPHEMERAL_DIR_NAME = "markdown-to-word-smoke";

/** 冒烟产物目录解析入参(electron API 三态注入,便于纯逻辑直测) */
export interface SmokeOutDirSpec {
  /** app.isPackaged:打包形态无仓库可写,不能落回项目 output/ */
  isPackaged: boolean;
  /** app.getAppPath():dev = 项目根;打包 = app.asar 所在目录 */
  appPath: string;
  /** app.getPath("temp") */
  tempDir: string;
}

/** 冒烟产物目录解析结果 */
export interface SmokeOutDir {
  /** 产物目录绝对路径 */
  dir: string;
  /** true = 一次性目录(退出前整体删除);false = 保留产物供人工排查 */
  ephemeral: boolean;
}

/**
 * 冒烟产物目录解析(纯函数):
 * - dev:`electron .` → <项目根>/output/smoke(gitignore 覆盖,每次运行自清理 smoke-* 前缀,
 *   产物保留供失败后人工打开排查);
 * - 打包:app.asar 内不存在可写的仓库目录,改落系统临时目录的一次性子目录,退出前整体删除
 *   —— 否则会在用户机器上留下垃圾目录,或(更糟)写到解包目录里污染发布产物。
 * @param spec 三态入参
 * @returns 目录与是否一次性
 */
export function resolveSmokeOutDir({ isPackaged, appPath, tempDir }: SmokeOutDirSpec): SmokeOutDir {
  if (isPackaged) return { dir: path.join(tempDir, EPHEMERAL_DIR_NAME), ephemeral: true };
  return { dir: path.join(appPath, "output", "smoke"), ephemeral: false };
}

/**
 * pdf 转换的降级描述(纯函数,便于直测):公式样式资源缺失属**非致命降级** ——
 * 产物照出、pdf 转换与书签主标记照打,仅在此追加一行留痕;无降级返回空串(不打该行)。
 * 缺 katex 资源本身由 scripts/check-asar-manifest.mjs 的包内条目断言兜底,此处只保证
 * 降级可见、不静默。
 * @param warnings pdf 转换返回的警告通道
 * @returns 降级行(无降级为空串)
 */
export function describePdfDegradation(warnings: readonly ConvertWarning[] | undefined): string {
  const degraded = (warnings ?? []).filter(
    (w): w is KeyedWarning => typeof w !== "string" && w.key === KATEX_DEGRADATION_KEY,
  );
  if (degraded.length === 0) return "";
  const detail = degraded.map((w) => w.fallback).join("; ");
  return `${SMOKE_MARKER.pdfDegraded} ${KATEX_DEGRADATION_KEY} ×${degraded.length} —— ${detail}`;
}

/** renderer 侧诊断报告形状(页面内脚本产出的字段,此处显式声明便于类型收窄) */
export interface SmokeRendererDiag {
  api: string;
  btnExists: boolean;
  btnDisabledBefore: boolean;
  statusAfterClick: string;
  statusIsError: boolean;
  dialogExists: boolean;
  dialogHiddenAtStart: boolean;
  dialogVisibleAtStart: boolean;
  previewBtnExists: boolean;
  previewBtnDisabledAtStart: boolean;
  dialogPreviewRemoved: boolean;
  suppressInputExists: boolean;
  completeDialogPromptRemoved: boolean;
  retryBtnExists: boolean;
  copyAllBtnExists: boolean;
  presetSaveBtnExists: boolean;
  presetDeleteBtnExists: boolean;
  presetSaveDialogExists: boolean;
  previewRefreshApi: string;
  dropSkippedExists: boolean;
  dropSkippedHiddenAtStart: boolean;
  noDataThemeAtStart: boolean;
  themeRadioCount: number;
  settingsDrawerExists: boolean;
  settingsDrawerHiddenAtStart: boolean;
  drawerOpenBtnExists: boolean;
  drawerCloseBtnExists: boolean;
  drawerSubtitleExists: boolean;
  paperSegCount: number;
  orientationSegCount: number;
  headingScaleSegCount: number;
  headingSpacingSegCount: number;
  headerModeSegCount: number;
  headerLayoutSegCount: number;
  languageSelectExists: boolean;
  languageOptionCount: number;
  formatSegmentCount: number;
  historyBarExists: boolean;
  historyBarHiddenAtStart: boolean;
  recentChipsRemoved: boolean;
  recentSectionRemoved: boolean;
  docScrollOk: boolean;
  scrollHeight: number;
}

/** IPC 接线端到端诊断形状(经 preload window.api 真实 invoke 的结果) */
export interface SmokeIpcDiag {
  singleOk: boolean;
  mergeOk: boolean;
  versionIsString: boolean;
}

/**
 * 带重试的一次性写(Windows 文件占用 EBUSY 多为瞬时,重试 3 次×150ms 再放弃)。
 * @param task 写操作
 * @param label 失败报错文案(区分「隔离写入」与「恢复」)
 */
async function writeWithRetry(task: () => unknown | Promise<unknown>, label: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await task();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(
    `[smoke] ${label}失败(可能应用正在运行): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * 断言 PDF 大纲:首条目 Title(中文)与 Dest[0] 页面 PDFRef(单文件/合并书签共用)。
 * @param filePath 产物路径
 * @param expectedTitle 期望的书签标题
 * @param label 报错定位标签
 */
async function assertOutline(filePath: string, expectedTitle: string, label: string): Promise<void> {
  const doc = await PDFDocument.load(await fs.readFile(filePath));
  const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!outlinesRef) throw new Error(`${label} 缺少 Outlines 大纲`);
  const outlinesDict = doc.context.lookup(outlinesRef, PDFDict);
  if (!outlinesDict) throw new Error(`${label} Outlines 字典解析失败`);
  const firstRef = outlinesDict.get(PDFName.of("First"));
  if (!firstRef) throw new Error(`${label} 大纲缺少 First 条目`);
  const firstDict = doc.context.lookup(firstRef, PDFDict);
  const title = firstDict?.get(PDFName.of("Title"));
  if (!(title instanceof PDFHexString) || title.decodeText() !== expectedTitle) {
    throw new Error(`${label} 书签标题异常: ${title?.toString()}`);
  }
  // 回归:书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转)
  const destArr = firstDict?.get(PDFName.of("Dest"));
  if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
    throw new Error(`${label} 书签 Dest 异常: ${destArr?.toString()}`);
  }
}

/** 删除一次性冒烟目录(EBUSY 重试;失败仅告警,不把清理噪声变成冒烟失败) */
async function removeEphemeralDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.error(
      `[smoke] 一次性目录清理失败(可手工删除 ${dir}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 页面内诊断脚本:window.api 注入/控件存在性/初始态守卫。防回归项集中在此,
 * 断言在调用方(拿到结构化报告后逐条判定),故本函数只采集不判定。
 * 计数类期望(paper 10 / orientation 4 等)注释见调用方对应断言。
 */
const RENDERER_DIAG_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { api: typeof window.api };
  const btn = document.getElementById("convertBtn");
  report.btnExists = !!btn;
  if (btn) {
    report.btnDisabledBefore = btn.disabled;
    // disabled 按钮的 .click() 不触发监听 → 先解除禁用再点击,
    // 断言「未选文件」守卫路径(曾因恒空而零覆盖)
    btn.disabled = false;
    btn.click();
    const status = document.getElementById("status");
    // 条件等待状态区更新(替代固定 50ms;同步更新首轮即过,最长 2s 后以现值断言)
    for (let i = 0; i < 100 && !(status && status.textContent); i++) await sleep(20);
    report.statusAfterClick = status ? status.textContent : "";
    report.statusIsError = status ? status.classList.contains("status--error") : null;
  }
  // 防回归:完成弹窗启动时必须隐藏(曾因 CSS 特异性覆盖而失效)
  const dlg = document.getElementById("completeDialog");
  report.dialogExists = !!dlg;
  report.dialogHiddenAtStart = dlg ? dlg.classList.contains("hidden") : null;
  report.dialogVisibleAtStart = dlg ? getComputedStyle(dlg).display !== "none" : null;
  // 预览入口迁移:单文件态「预览」按钮存在且初始禁用(未选文件);
  // 完成弹窗内「预览」按钮必须已移除
  const previewBtn = document.getElementById("previewBtn");
  report.previewBtnExists = !!previewBtn;
  report.previewBtnDisabledAtStart = previewBtn ? previewBtn.disabled : null;
  report.dialogPreviewRemoved = !document.getElementById("completeDialogPreview");
  // 完成弹窗「不再提示」/ 批量弹窗「重试失败项 / 复制全部路径」存在性。
  // 设置面板侧「转换完成弹窗提示」控件已按 settings-ia.md 迁移映射表
  // 移除(场景被 afterConvert 覆盖,仅保留弹窗内入口)——此处改为断言其确已移除
  report.suppressInputExists = !!document.getElementById("completeDialogSuppress");
  report.completeDialogPromptRemoved = !document.getElementById("completeDialogPrompt");
  report.retryBtnExists = !!document.getElementById("batchDialogRetry");
  report.copyAllBtnExists = !!document.getElementById("batchDialogCopyAll");
  // 自定义预设控件存在性 + previewRefresh API 注入
  report.presetSaveBtnExists = !!document.getElementById("presetSaveBtn");
  report.presetDeleteBtnExists = !!document.getElementById("presetDeleteBtn");
  report.presetSaveDialogExists = !!document.getElementById("presetSaveDialog");
  report.previewRefreshApi = typeof window.api.previewRefresh === "function";
  // 拖放反馈细化:被跳过文件名折叠列表存在且初始隐藏
  const dropSkipped = document.getElementById("dropSkipped");
  report.dropSkippedExists = !!dropSkipped;
  report.dropSkippedHiddenAtStart = dropSkipped ? dropSkipped.classList.contains("hidden") : null;
  // 外观主题:默认 system 时 data-theme 属性必须不存在(CSS @media 接管)+
  // 设置面板三个 theme radio 就位
  report.noDataThemeAtStart = !document.documentElement.hasAttribute("data-theme");
  report.themeRadioCount = document.querySelectorAll('input[name="theme"]').length;
  // 设置抽屉:容器存在且启动时隐藏(旧主页面 details 面板已移除);
  // 顶栏入口(齿轮)与方向/语言 select、抽屉副标题就位
  const settingsDrawer = document.getElementById("settingsDrawer");
  report.settingsDrawerExists = !!settingsDrawer;
  report.settingsDrawerHiddenAtStart = settingsDrawer ? settingsDrawer.classList.contains("hidden") : null;
  report.drawerOpenBtnExists = !!document.getElementById("settingsOpenBtn");
  report.drawerCloseBtnExists = !!document.getElementById("drawerCloseBtn");
  report.drawerSubtitleExists = !!document.getElementById("drawerSubtitle");
  // 枚举 ≤5 → seg 分段(guidelines §3.1);六组 radio 计数就位
  // (纸张 5 / 方向 2 / 标题字号档位 3 / 标题间距档位 3 / 页眉模式 3 / 页眉布局 2)
  report.paperSegCount = document.querySelectorAll('input[name="paper"]').length;
  report.orientationSegCount = document.querySelectorAll('input[name="orientation"]').length;
  report.headingScaleSegCount = document.querySelectorAll('input[name="headingScale"]').length;
  report.headingSpacingSegCount = document.querySelectorAll('input[name="headingSpacing"]').length;
  report.headerModeSegCount = document.querySelectorAll('input[name="headerMode"]').length;
  report.headerLayoutSegCount = document.querySelectorAll('input[name="headerLayout"]').length;
  report.languageSelectExists = !!document.getElementById("languageSelect");
  // 语言裁撤回归守卫:下拉选项由 LANGUAGES 注册表动态生成,应恰为 zh/en/ja 三项
  report.languageOptionCount = document.querySelectorAll("#languageSelect option").length;
  report.formatSegmentCount = document.querySelectorAll(".header-actions input[name='format']").length;
  // 最近转换自「空态 chips」改造为
  // 「主舞台与消息区之间的常驻折叠条」——historyBar 存在且启动隐藏
  // (隔离环境无最近记录,无记录整块不渲染);旧 recentChips/recentSection 必须已移除
  const historyBar = document.getElementById("historyBar");
  report.historyBarExists = !!historyBar;
  report.historyBarHiddenAtStart = historyBar ? historyBar.classList.contains("hidden") : null;
  report.recentChipsRemoved = !document.getElementById("recentChips");
  report.recentSectionRemoved = !document.getElementById("recentSection");
  // 回归守卫:文档级零滚动(html/body overflow:hidden + .app 外边距
  // 算术闭合;scrollHeight 超出视口即说明边距塌陷/内容溢出回归)
  report.docScrollOk =
    document.documentElement.scrollHeight <= window.innerHeight &&
    document.body.scrollHeight <= window.innerHeight;
  report.scrollHeight = document.documentElement.scrollHeight;
  return report;
})()`;

/**
 * IPC 端到端脚本:经 preload(window.api)真实 invoke → main handler → convertImpl 全链路
 * (直接调 convertImpl 的上方断言不经过 IPC,覆盖不到 handle 注册)。路径经 JSON.stringify
 * 注入,防 Windows 反斜杠转义破坏脚本字面量。
 */
function ipcDiagScript(sampleMd: string, mergeA: string, mergeB: string): string {
  return `(async () => {
    const single = await window.api.convert(${JSON.stringify(sampleMd)}, "docx");
    const merge = await window.api.convertMerge(${JSON.stringify([mergeA, mergeB])}, "docx");
    const version = await window.api.getVersion();
    return {
      singleOk: single.ok === true && typeof single.outputPath === "string",
      mergeOk: merge.ok === true && typeof merge.outputPath === "string",
      versionIsString: typeof version === "string" && version.length > 0,
    };
  })()`;
}

/**
 * 运行冒烟断言;任何失败抛错,由 index.ts 捕获后 app.exit(1)。
 * 生命周期:隔离设置与 ui-state → 逐项断言 → finally 还原(失败路径同样还原);
 * 打包形态下额外删除一次性产物目录,不留垃圾目录、不写解包目录。
 * @param win 主窗口
 */
export async function runSmoke(win: BrowserWindow): Promise<void> {
  const { dir: outDir, ephemeral } = resolveSmokeOutDir({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    tempDir: app.getPath("temp"),
  });
  // ui-state 隔离(先于一切,尽早完成,缩小与 renderer 启动恢复的竞态窗口)。
  // 备份内存态(createWindow 已把用户真实状态读入模块缓存)→ 清空 lastSessionFiles;
  // 结束时恢复,原文件不存在则删除临时写入的文件。
  const uiStatePath = path.join(app.getPath("userData"), "ui-state.json");
  const hadUiStateFile = await fs.access(uiStatePath).then(
    () => true,
    () => false,
  );
  const origUi = loadUiState();
  // recentFiles 一并清空——下方主进程转换会经 recordRecentFiles 写入最近记录,
  // 渲染进程启动时 chips 将据此渲染;先清空保证「启动隐藏」断言确定(结束前恢复原值)
  await writeWithRetry(
    () => saveUiState({ lastSessionFiles: [], recentFiles: [] }),
    "ui-state 隔离写入",
  );
  try {
    // 应用菜单守卫(autoHideMenuBar 下 Alt 唤出,缺失即回归)。
    // 文案经 t() 取值(与 buildAppMenu 同源),语言设置为 en 时不再误报。
    // 「关于」入口经标题栏信息图标(about:open IPC),帮助菜单有意移除,
    // 守卫只断言文件菜单存在(确保 buildAppMenu 已执行)
    const appMenu = Menu.getApplicationMenu();
    const menuLabels = appMenu?.items.map((item) => item.label) ?? [];
    if (!appMenu || !menuLabels.includes(t("menu.file"))) {
      throw new Error(`应用菜单缺失: ${JSON.stringify(menuLabels)}(期望 ${t("menu.file")})`);
    }
    const sampleMd = path.join(outDir, "smoke-basic.md");
    await fs.mkdir(outDir, { recursive: true });
    // 重名保护:同名产物不再覆盖 → smoke 自清理本次会生成的产物(含 (2) 序号变体),
    // 保证断言确定性;output/ 下的验收样例等其他文件不受影响。
    // Windows 下被阅读器占用的文件删除会 EBUSY,容错跳过(残留由重名序号机制规避)。
    for (const name of await fs.readdir(outDir)) {
      const base = name.replace(/\.(md|docx|pdf|png)$/i, "").replace(/\s\(\d+\)$/, "");
      if (base.startsWith("smoke-")) {
        try {
          await fs.rm(path.join(outDir, name), { force: true });
        } catch {
          // 被外部程序占用:跳过,不阻塞 smoke
        }
      }
    }
    // 输出隔离:强制 outputDir "" + afterConvert "none"(见文件头注释),结束前恢复原设置;
    // theme 强制 "system"——renderer diag 的 data-theme 初始态守卫依赖默认主题
    const orig = loadSettings();
    await updateSettings({ outputDir: "", afterConvert: "none", theme: "system" });
    try {
      await fs.writeFile(
        sampleMd,
        "# 冒烟测试 中文标题\n\n<!-- page-break -->\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n",
      );
      const { outputPath } = await convertImpl(sampleMd, "docx");
      const stat = await fs.stat(outputPath);
      console.log(`${SMOKE_MARKER.convertOk} ${outputPath} (${stat.size} bytes)`);
      // PDF 链路:中文/表格/代码块/任务列表/本地图片 → printToPDF
      // 排查结论:1px 图人工不可辨认(且 printToPDF 极小图易被忽略),样例换 100x80 红底白点图
      const pngPath = path.join(outDir, "smoke-pdf.png");
      await fs.writeFile(
        pngPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAA0UlEQVR4nO3ZwQ2DQAxEUSqh/6LohdxzAZLFY0tv9Auw3nF328zMhu7Yd30FCxaseLBgwYoHCxaseLBgwYoHCxaseLBgwYoHCxaseB2xzqvBusWUJWuE9Ugq4tUC6wemCFke60+pSi9Yc7CWSJV5JbEWStV4wZqAtVyqwAsWLFiwYMGCBQsWLFiwQl5vHwxrCJb3rIxXzamwRmH53SkiK76wEZYf6VfIUod1xGobLFiw4sGCBSseLFiw4sGCBSseLFiw4sGCBSseLFjFWGZmzfcBLmd3baCxCRQAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const pdfSampleMd = path.join(outDir, "smoke-pdf.md");
      await fs.writeFile(
        pdfSampleMd,
        [
          "# PDF 冒烟 中文标题",
          "",
          "| 列A | 列B |",
          "| --- | --- |",
          "| 你好 | world |",
          "",
          "<!-- page-break -->",
          "",
          "```ts",
          "const x: number = 1;",
          "```",
          "",
          "- [x] 已完成项",
          "- [ ] 待办项",
          "",
          "~~删除线~~ 与 `行内代码`",
          "",
          "![本地图片](smoke-pdf.png)",
          "",
        ].join("\n"),
      );
      // katexDir 经 resource-dirs 解析(打包形态指向 app.asar 内 node_modules);
      // 资源缺失属非致命降级,只追加留痕行,不改变本冒烟的成败判定
      const katexDir = getKatexDir();
      const pdfResult = await convertImpl(pdfSampleMd, "pdf", undefined, undefined, katexDir);
      const pdfStat = await fs.stat(pdfResult.outputPath);
      const pdfHead = (await fs.readFile(pdfResult.outputPath)).subarray(0, 5).toString("latin1");
      if (pdfHead !== "%PDF-") throw new Error(`PDF 魔数校验失败: ${pdfHead}`);
      console.log(`${SMOKE_MARKER.pdfConvertOk} ${pdfResult.outputPath} (${pdfStat.size} bytes)`);
      const degradation = describePdfDegradation(pdfResult.warnings);
      if (degradation !== "") console.warn(degradation);
      // 书签注入断言(读回 /Outlines,标题中文正确;覆盖用户实测「侧边栏书签为空」问题)
      await assertOutline(pdfResult.outputPath, "PDF 冒烟 中文标题", "PDF");
      console.log(`${SMOKE_MARKER.pdfBookmarkOk} Outlines 注入,中文标题 + Dest 页面引用正确`);
      // 合并 PDF 书签断言(用户实测「合并 PDF 侧边栏书签为空」的直接回归场景)
      const mergeA = path.join(outDir, "smoke-merge-1.md");
      const mergeB = path.join(outDir, "smoke-merge-2.md");
      await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](smoke-pdf.png)\n`);
      await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
      const mergePdfResult = await mergeConvertImpl([mergeA, mergeB], "pdf", undefined, undefined, katexDir);
      // 重名序号变体兼容:输出目录可配置后产物可能为「smoke-merge-1-合并 (2).pdf」,
      // 断言剥离 (N) 序号后缀后须以 -合并.pdf 结尾(与 batch 断言同源修复)
      const mergePdfBase = mergePdfResult.outputPath?.replace(/\s\(\d+\)(?=\.pdf$)/, "");
      if (!mergePdfResult.ok || !mergePdfResult.outputPath || !mergePdfBase?.endsWith("-合并.pdf")) {
        throw new Error(`合并 PDF 输出异常: ${mergePdfResult.error ?? mergePdfResult.outputPath}`);
      }
      await assertOutline(mergePdfResult.outputPath, "合并第一章", "合并 PDF");
      console.log(`${SMOKE_MARKER.mergePdfBookmarkOk} 合并产物 Outlines 注入,中文标题 + Dest 页面引用正确`);
      // renderer 侧诊断:window.api 是否注入、转换按钮是否可点、点击后状态区反馈
      try {
        // 条件等待页面就绪(替代固定 1500ms;就绪即过、超时显式失败,不再盲跑诊断)
        let pageReady = false;
        for (let waited = 0; waited <= 10000 && !pageReady; waited += 100) {
          if (waited > 0) await new Promise((resolve) => setTimeout(resolve, 100));
          pageReady = await win.webContents
            .executeJavaScript(`document.readyState === "complete" && !!document.getElementById("convertBtn")`)
            .catch(() => false);
        }
        if (!pageReady) throw new Error("页面就绪等待超时(readyState/convertBtn)");
        const diag = (await win.webContents.executeJavaScript(RENDERER_DIAG_SCRIPT)) as SmokeRendererDiag;
        console.log(`${SMOKE_MARKER.rendererDiag} ${JSON.stringify(diag)}`);
        // 守卫断言:无文件时点击转换按钮 → 状态区错误文案 + 红字(交互语义)。
        // btnDisabledBefore 必须为 true——lastSessionFiles 未隔离(用户残留会话恢复)
        // 时按钮非禁用,该断言即失败,隔离失效可被立即发现
        if (
          diag.btnDisabledBefore !== true ||
          diag.statusAfterClick !== t("file.selectFirst") ||
          diag.statusIsError !== true
        ) {
          throw new Error(
            `renderer diag FAILED: 点击守卫断言 btnDisabledBefore=${diag.btnDisabledBefore}, statusAfterClick=${JSON.stringify(diag.statusAfterClick)}(期望 ${t("file.selectFirst")}), statusIsError=${diag.statusIsError}(lastSessionFiles 未隔离或回归)`,
          );
        }
        // 新增控件存在性守卫(缺失即回归;设置面板侧弹窗提示控件
        // 已按 IA 迁移映射表移除,残留即回归)
        if (
          !diag.suppressInputExists ||
          diag.completeDialogPromptRemoved !== true ||
          !diag.retryBtnExists ||
          !diag.copyAllBtnExists
        ) {
          throw new Error(
            `renderer diag FAILED: 批次弹窗控件缺失 ${JSON.stringify({
              suppressInputExists: diag.suppressInputExists,
              completeDialogPromptRemoved: diag.completeDialogPromptRemoved,
              retryBtnExists: diag.retryBtnExists,
              copyAllBtnExists: diag.copyAllBtnExists,
            })}`,
          );
        }
        // 自定义预设控件 + previewRefresh API 守卫(缺失即回归)
        if (
          !diag.presetSaveBtnExists ||
          !diag.presetDeleteBtnExists ||
          !diag.presetSaveDialogExists ||
          !diag.previewRefreshApi
        ) {
          throw new Error(
            `renderer diag FAILED: 自定义预设控件/API 缺失 ${JSON.stringify({
              presetSaveBtnExists: diag.presetSaveBtnExists,
              presetDeleteBtnExists: diag.presetDeleteBtnExists,
              presetSaveDialogExists: diag.presetSaveDialogExists,
              previewRefreshApi: diag.previewRefreshApi,
            })}`,
          );
        }
        // 拖放跳过列表控件守卫(存在且初始隐藏,缺失即回归)
        if (diag.dropSkippedExists !== true || diag.dropSkippedHiddenAtStart !== true) {
          throw new Error(
            `renderer diag FAILED: dropSkipped 控件异常 ${JSON.stringify({
              dropSkippedExists: diag.dropSkippedExists,
              dropSkippedHiddenAtStart: diag.dropSkippedHiddenAtStart,
            })}`,
          );
        }
        // 外观主题守卫——默认 system 时 data-theme 属性不存在 + 三个 theme radio 就位
        // (theme 已在隔离段强制 "system",用户残留设置不会误报)
        if (diag.noDataThemeAtStart !== true || diag.themeRadioCount !== 3) {
          throw new Error(
            `renderer diag FAILED: 外观主题异常 ${JSON.stringify({
              noDataThemeAtStart: diag.noDataThemeAtStart,
              themeRadioCount: diag.themeRadioCount,
            })}`,
          );
        }
        // 设置抽屉守卫——容器存在且启动隐藏,顶栏入口、
        // 语言 select、格式分段(2 项)与六组 seg 分段(纸 5/向 2/字号档 3/间距档 3/
        // 页眉模式 3/页眉布局 2)就位;缺失即回归。
        // paper/orientation 为全文档同名 radio 组——快速参数条镜像一份
        // (纸 5+5=10 / 向 2+2=4),其余四组仍仅抽屉一处
        if (
          diag.settingsDrawerExists !== true ||
          diag.settingsDrawerHiddenAtStart !== true ||
          !diag.drawerOpenBtnExists ||
          !diag.drawerCloseBtnExists ||
          !diag.drawerSubtitleExists ||
          diag.paperSegCount !== 10 ||
          diag.orientationSegCount !== 4 ||
          diag.headingScaleSegCount !== 3 ||
          diag.headingSpacingSegCount !== 3 ||
          diag.headerModeSegCount !== 3 ||
          diag.headerLayoutSegCount !== 2 ||
          !diag.languageSelectExists ||
          diag.languageOptionCount !== 3 ||
          diag.formatSegmentCount !== 2
        ) {
          throw new Error(
            `renderer diag FAILED: 设置抽屉/顶栏控件异常 ${JSON.stringify({
              settingsDrawerExists: diag.settingsDrawerExists,
              settingsDrawerHiddenAtStart: diag.settingsDrawerHiddenAtStart,
              drawerOpenBtnExists: diag.drawerOpenBtnExists,
              drawerCloseBtnExists: diag.drawerCloseBtnExists,
              drawerSubtitleExists: diag.drawerSubtitleExists,
              paperSegCount: diag.paperSegCount,
              orientationSegCount: diag.orientationSegCount,
              headingScaleSegCount: diag.headingScaleSegCount,
              headingSpacingSegCount: diag.headingSpacingSegCount,
              headerModeSegCount: diag.headerModeSegCount,
              headerLayoutSegCount: diag.headerLayoutSegCount,
              languageSelectExists: diag.languageSelectExists,
              languageOptionCount: diag.languageOptionCount,
              formatSegmentCount: diag.formatSegmentCount,
            })}`,
          );
        }
        // 最近转换常驻折叠条守卫——historyBar 存在且启动隐藏
        // (隔离环境无记录,无记录整块不渲染),旧 chips/独立区块已移除;缺失/残留即回归
        if (
          diag.historyBarExists !== true ||
          diag.historyBarHiddenAtStart !== true ||
          diag.recentChipsRemoved !== true ||
          diag.recentSectionRemoved !== true
        ) {
          throw new Error(
            `renderer diag FAILED: 最近转换折叠条异常 ${JSON.stringify({
              historyBarExists: diag.historyBarExists,
              historyBarHiddenAtStart: diag.historyBarHiddenAtStart,
              recentChipsRemoved: diag.recentChipsRemoved,
              recentSectionRemoved: diag.recentSectionRemoved,
            })}`,
          );
        }
        // 文档级零滚动守卫(scrollHeight 超出视口即边距塌陷/内容溢出回归)
        if (diag.docScrollOk !== true) {
          throw new Error(
            `renderer diag FAILED: 文档级出现滚动(scrollHeight 超出视口) ${JSON.stringify({
              docScrollOk: diag.docScrollOk,
              scrollHeight: diag.scrollHeight,
            })}`,
          );
        }
        const ipcDiag = (await win.webContents.executeJavaScript(
          ipcDiagScript(sampleMd, mergeA, mergeB),
        )) as SmokeIpcDiag;
        console.log(`${SMOKE_MARKER.ipcDiag} ${JSON.stringify(ipcDiag)}`);
        if (!ipcDiag.singleOk || !ipcDiag.mergeOk || !ipcDiag.versionIsString) {
          throw new Error(
            `ipc diag FAILED: IPC 链路异常 ${JSON.stringify(ipcDiag)}(convert:single/convert:merge/app:version 接线回归)`,
          );
        }
        // IPC 转换成功会经 recordRecentFiles 写入 ui-state.recentFiles(合并写语义,
        // finally 的整体还原冲不掉新增项)→ 此处显式还原为隔离前快照
        await writeWithRetry(() => saveUiState({ recentFiles: origUi.recentFiles }), "recentFiles 还原");
      } catch (err) {
        console.error("[smoke] renderer diag FAILED:", err);
        throw err; // 由 index.ts 统一 catch → app.exit(1)
      }
    } finally {
      // 恢复用户设置(文件 + 模块级缓存);崩溃时残留风险与 converter.test.js 一致
      await updateSettings(orig);
    }
  } finally {
    // 恢复 ui-state(含失败路径)——原文件存在则整体还原(磁盘 + 缓存),
    // 不存在则删除临时写入的文件;失败仅告警不阻塞(EBUSY 容错,与产物清理同先例)
    try {
      await writeWithRetry(
        () => (hadUiStateFile ? saveUiState(origUi) : fs.rm(uiStatePath, { force: true })),
        "ui-state 恢复",
      );
    } catch (err) {
      console.error("[smoke] ui-state 恢复失败(用户会话记忆可能丢失):", err);
    }
    // 打包形态的一次性目录:退出前删净,不在用户机器上留垃圾、也不写解包目录
    if (ephemeral) await removeEphemeralDir(outDir);
  }
}
