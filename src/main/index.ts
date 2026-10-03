/**
 * 主进程入口:应用生命周期编排。
 * 本文件只留:app 生命周期(whenReady / activate / window-all-closed)、
 * 单实例锁、进程级兜底、两个替代 GUI 启动流程的入口分支:
 * SMOKE(--smoke,动态 import ./smoke.js,在 GUI 启动**之后**跑)与
 * PDF_HOST(--pdf-host,动态 import ./cli-pdf-host.js,**取代**整个 GUI 启动流程)。
 * 子模块:windows/main-window(主窗口)、windows/preview(预览)、ipc/register(IPC 注册)、menu(菜单)、
 * smoke(--smoke 冒烟实现;落在 src 编译面 → dist/main/smoke.js 随包分发,解包产物也能跑冒烟)。
 * cli-pdf-host(CLI 的 pdf 宿主本体与宿主设置在其文件内,本文件只负责接管启动)。
 */
import { app, BrowserWindow, session } from "electron";
import { exitCodes, PDF_HOST_FLAG } from "../convert/cli-pdf-job.js";
import { loadSettings, whenSettingsIdle } from "./persist/settings.js";
import { createWindow, getMainWindow } from "./windows/main-window.js";
import { applyStartupSettingsRuntime, registerIpc } from "./ipc/register.js";
import { applyDefaultDenyPermissions } from "./services/session-permissions.js";
import { preparePdfHostProfile } from "./services/pdf-host-profile.js";

const SMOKE = process.argv.includes("--smoke");

/**
 * `--pdf-host` 形态:CLI 以**已安装的应用自身**为 pdf 宿主(见 cli/host-launch.ts 的
 * 判定:已安装形态不能用脚本路径形态拉起宿主 —— dist/main/cli-pdf-host.js 落在 app.asar
 * 内,Electron 不能把 asar 内的文件当应用路径启动)。
 *
 * 与 SMOKE 的关键差异:这条分支**取代整个 GUI 启动流程**,不是插在它的 whenReady() 里
 * (SMOKE 是在 GUI 启动之后跑的,见下方 createWindow() 之后那处)。理由有三,都是
 * 「漏一条就静默出错」那一类:
 * 1. **必须豁免单实例锁**:用户开着图形界面时也要能起宿主。否则 requestSingleInstanceLock()
 *    失败 → app.quit() → 宿主立刻退出,而症状正是那个最难的:退出码 0、无任何 stderr、
 *    结果文件不存在(用户看到的只是一次「什么都没发生」的转换)。
 * 2. **不能建窗口、不能注册 IPC、不能跑 applyStartupSettingsRuntime**:pdf 宿主只需要
 *    一个隐藏的打印窗口,而那个窗口由 renderPdf 自己按需创建;主窗口与 IPC 都属于
 *    GUI 启动流程,在宿主形态下建它们毫无意义(还会拖起 i18n / 权限收口等一整套副作用)。
 * 3. **不能走到模块末尾那个 window-all-closed 处理器**(见文件末尾注释):它会 app.quit(),
 *    与 cli-pdf-host 装的空处理器并存 —— Electron 依次调用**全部**监听器,空处理器压不住
 *    它,于是打印窗口销毁那一下仍会把进程同步结束,症状同上。
 *
 * 参数解析**位置稳健**:flag 之后的两个值才是 job 与 result 路径,不能硬编码 argv[2]/argv[3] ——
 * 这种启动形态下 argv 的布局与「脚本路径 + 两个参数」形态不同(打包态 argv[1] 不是脚本路径)。
 */
const PDF_HOST_INDEX = process.argv.indexOf(PDF_HOST_FLAG);
const PDF_HOST = PDF_HOST_INDEX >= 0;

/* ---------- 进程级兜底(此前 rejection/异常静默进黑洞,排障无据) ---------- */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  // 桌面工具韧性优先:记录留痕不主动退出(状态不可续时用户可手动重启)
  console.error("[uncaughtException]", err);
});

// 单实例锁:双开实例各自持有 settings/uiState 内存缓存与独立写队列,后写覆盖前写,用户感知为「预设和最近文件莫名其妙丢失」且无法归因。SMOKE 豁免:冒烟需与开发实例并存运行。
//
// PDF_HOST **必须**排在单实例锁这条判定之前(而不是只把 SMOKE 那样并进豁免条件):
// 豁免条件成立时仍会走进 else 分支、即整个 GUI 启动流程,那会把主窗口、IPC、设置运行时
// 一并拉起来。宿主要的是「取代」而非「并行」—— 见 PDF_HOST 注释的第 2 条。
if (PDF_HOST) {
  // ready 之前的宿主设置**必须同步完成**,不能等下面的动态 import 解析完:那次 import
  // 要拉装配层与 pdf-lib,而 Electron 只保证 `ready` 排在主脚本同步求值之后 —— 冷缓存
  // 或慢盘上它完全可能输给 ready,那时 Chromium 已在真实 %APPDATA% 建好 profile。
  // 2026-10-03 那次实测是「恰好成立」,本行把顺序改成结构上确定。详见
  // services/pdf-host-profile.ts 文件头。该函数幂等,runPdfHost 里还会再调一次。
  preparePdfHostProfile();
  // 动态 import(而非静态)只为不在正常启动路径上加载宿主模块:该模块 import 装配层与
  // pdf-lib,GUI 启动不该为它付费。说明符是字面量相对路径,编译产物里恒解析到同目录
  // (dev 与 app.asar 内均成立),与 --smoke 分支同一理由。
  void import("./cli-pdf-host.js").then(
    ({ runPdfHost }) => {
      // flag 之后的两个值:argv[PDF_HOST_INDEX+1] 是 job,[+2] 是 result。
      // 都可能越界(undefined)——那是用法错,由 runPdfHost 写用法并以 usage 码退出。
      runPdfHost(process.argv[PDF_HOST_INDEX + 1], process.argv[PDF_HOST_INDEX + 2]);
    },
    (error: unknown) => {
      console.error("[pdf-host] 宿主模块加载失败:", error);
      app.exit(exitCodes.convertFailed);
    },
  );
} else if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 已有实例时再次启动 → 聚焦既有主窗口(无则重建,darwin 关窗驻留场景)
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    // i18n + 应用菜单:主进程语言来源 = 持久化设置(菜单/对话框标题/预览错误页按此
    // 语言);启动与运行期设置变更共用同一副作用编排(单源,见 ipc/register 的运行时
    // 副作用区块),避免两处各写一份初始化。菜单先于窗口创建,窗口创建即带应用菜单
    // (autoHideMenuBar 下 Alt 唤出);此刻无主窗口,标题栏 overlay 同步为空操作
    // (createWindow 内按持久化主题同步)。
    applyStartupSettingsRuntime(loadSettings());
    // 权限三通道显式全拒(request/check/device):应用无相机/麦克风/定位/通知/硬件直连需求,
    // 默认拒绝之上显式声明,防未来新增窗口/webview/partition 类型时遗漏收口。
    // 威胁模型与「勿改为允许」的论证见 services/session-permissions.ts 文件头。
    applyDefaultDenyPermissions(session.defaultSession);
    registerIpc();
    // activate 先于首次 createWindow 注册(macOS 极早期 dock 点击不丢失)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    const win = createWindow();
    // 渲染进程 console 错误转发到主进程输出(诊断用)
    win.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    if (SMOKE) {
      try {
        // 冒烟入口(单一实现,编译进 dist/main/smoke.js):dev 与打包产物同一条代码路径
        // ——发布侧检查正是以 --smoke 启动真实可执行文件并断言诊断标记,入口必须随包分发。
        // 动态 import(而非静态)只为不在正常启动路径上加载冒烟模块;说明符是字面量相对
        // 路径,编译产物里恒解析到同目录 smoke.js(dev 与 app.asar 内均成立)。
        const { runSmoke } = await import("./smoke.js");
        await runSmoke(win);
      } catch (err) {
        console.error("[smoke] convert FAILED:", err);
        app.exit(1);
        return;
      }
      // 成功路径:留一拍让渲染进程把 console 转发落盘,再以退出码 0 结束
      setTimeout(() => app.quit(), 500);
    }
  });
}

// 退出前排空设置写队列 + 退出:仅 GUI 形态。
//
// ⚠ PDF_HOST 形态**必须跳过**本处理器:它是模块顶层,宿主进程也会注册它;而
// cli-pdf-host 装的 window-all-closed 空处理器压不住它 —— Electron 对同一事件依次调用
// **全部**监听器,空处理器只挡默认行为,不挡另一个显式 app.quit()。宿主没有常驻窗口,
// renderPdf 销毁隐藏打印窗口那一下即触发本处理器,进程被同步结束:pdf-lib 元数据注入、
// 产物提交、结果文件写入全来不及,症状是退出码 0、无 stderr、结果文件不存在。
//
// 跳过的另一面:宿主形态不排空设置写队列。那是对的 —— 宿主不 loadSettings、不写设置,
// 没有队列可排空。
if (!PDF_HOST) {
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return;
    // 退出前排空设置写队列:loadSettings 的迁移写是 fire-and-forget(不等它落盘就返回),
    // 不排空则队列里未落盘的迁移结果随进程一起丢掉。排空失败不阻止退出 —— 此时
    // 旧值仍在盘上,比起「退不出去」更可取。
    void whenSettingsIdle()
      .catch((error: unknown) => {
        console.error("[main] 退出前排空设置写队列失败(继续退出):", error);
      })
      .then(() => app.quit());
  });
}
