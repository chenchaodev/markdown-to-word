/**
 * pdf 宿主的「ready 之前」设置 —— 单独成模块的**唯一理由是时序**,不是职责。
 *
 * 两个入口形态都要在 `app.whenReady()` 之前做完这两件事:
 * ① `setPath("userData", 一次性临时目录)`;② 装上 `window-all-closed` 空处理器。
 * 单独成模块是为了让 `main/index.ts` 能**静态**导入它、并在动态 import 重模块
 * **之前**同步调用 —— 那两件事各自只依赖 electron 与 node 内置模块,静态导入零成本;
 * 而重的部分(装配层、pdf-lib)仍留在 `cli-pdf-host.ts` 由动态 import 拉起。
 *
 * ⚠ 若把这两行留在重模块里、只在 `cli-pdf-host.ts` 的 `runPdfHost` 里做,`--pdf-host`
 * 形态就变成「先 await import 重模块、再设 profile」。2026-10-03 实测那次成立(真实
 * `%APPDATA%` 未被创建),但**那次成立不等于结构上安全**:Electron 只保证 `ready` 排在
 * 主脚本同步求值之后,冷缓存或慢盘上那次 import 完全可能输掉竞争。一旦输掉,
 * Chromium 已在真实路径建好 profile,而宿主还在往别处重定向 —— 代价是往用户真实
 * profile 里写数据,**静默且难查**。所以把顺序从「碰巧成立」改成「结构上确定」。
 *
 * 为什么必须重定向 userData:pdf 打印会拉起隐藏 BrowserWindow,Electron 默认把
 * profile 写到真实 `%APPDATA%` —— CLI 是脚本面,不该在用户真实 profile 里留痕。
 * 建在 `os.tmpdir()` 下而非项目 `output/`:本宿主可能以打包产物形态被拉起,
 * 那时项目 `output/` 写不进去。
 *
 * 为什么必须接管 window-all-closed:空处理器 = 不让窗口生命周期决定进程何时结束。
 * Electron 的默认行为是「最后一个窗口关闭即退出」。本宿主**没有常驻窗口** ——
 * `printPdf` 会建一个隐藏打印窗口并在 finally 里 destroy 它,那一下恰好构成
 * 「最后一个窗口关闭」,默认处理器随即结束进程:pdf-lib 的书签/元数据注入、产物提交、
 * 结果文件写入全部来不及执行。
 * 症状极难自查(2026-10-03 实测):子进程退出码 0、**无任何 stderr**、结果文件不存在,
 * 看起来像「任务根本没跑」;调试脚本里更怪 —— 挂着的 setInterval 一次都没触发,
 * 说明不是异常也不是超时,而是进程被**同步**结束、事件循环直接排空。
 *
 * ⚠ 装本处理器**之前**必须确认调用方没有另行注册自己的 window-all-closed 处理器:
 * Electron 会**依次调用全部**监听器,空处理器压不住另一个会 `app.quit()` 的处理器,
 * 症状退回成上面那条静默失败。已安装形态由 `main/index.ts` 承担这个前提(它对
 * `--pdf-host` 刻意不注册自己的那个),见该文件同处注释。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/**
 * 已执行标记 —— 让本函数**可重复调用**。
 *
 * 为什么需要:两种入口形态都会调它(重模块的 `runPdfHost` 兜底 + `main/index.ts` 在
 * 动态 import 之前先调一次),而 `mkdtempSync` 每次都建一个新目录。不加这个标记,
 * 重复调用会建出两个临时 profile 并只用第二个,第一个白留在 tmpdir 里。
 * 模块级状态在单进程内是同一份实例(`main/index.ts` 静态导入、`cli-pdf-host.ts`
 * 也导入同一个解析路径),故该标记在两条路径上共享,能达到幂等。
 */
let prepared = false;

/**
 * 在 app ready 之前完成宿主设置(幂等)。
 *
 * 必须在任何 `app.whenReady()` / `app.ready` 之前同步调用 —— 重定向晚了就无效。
 */
export function preparePdfHostProfile(): void {
  if (prepared) return;
  prepared = true;
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "m2w-cli-pdf-")));
  app.on("window-all-closed", () => {});
}