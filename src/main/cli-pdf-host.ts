/**
 * CLI 的 pdf 宿主:被 `src/cli/index.ts` 以子进程方式拉起,提供 printToPDF 能力。
 *
 * 为什么要有这个壳:pdf 的打印能力是 **Electron 宿主能力**(ADR-060 后果 2 ——
 * `printToPDF` 是唯一打印宿主,装配层不自带、缺它即报错不降级)。而 CLI 本身是
 * **纯 node 进程**(零 electron import,见门禁 `cli-no-host`),两者不能同进程。
 * 故 CLI 对 pdf 走「壳自动重入 Electron」:本模块就是被重入的那一侧。
 *
 * 与 `electron-side.ts` 的关系:本模块**不重复实现**打印,只做三件事 ——
 * ① 读任务描述(契约见 convert/cli-pdf-job.ts,CLI 与本模块共用);
 * ② 调装配层(与 GUI 的 single.ts 同一入口 emitConvertedArtifact),注入 renderPdf;
 * ③ 把结构化结果写进**结果文件**并以约定退出码结束。
 * 换句话说:**它是 CLI 面对装配层的调用点**,能力注入与 GUI 完全同构。
 *
 * ⚠ katexDir 不能用 getKatexDir():那一支以 `app.getAppPath()` 为基准,而本文件是
 * **以脚本路径**启动的(`electron dist/main/cli-pdf-host.js`),此时 appPath 等于脚本所在
 * 目录(实测:脚本放在系统临时区时 appPath 就是那个临时区),getKatexDir() 会指向
 * `dist/main/node_modules/katex/dist` —— 不存在,公式路径必然读不到。
 * 故按 resource-dirs 里 Mermaid 的既有做法,改用**模块自身位置**定位
 * (编译产物恒在 <root>/dist/main/ → 上溯两级即 <root>,打包态即 app.asar)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createConvertContext } from "../convert/context.js";
import { exitCodes, readJob, writeJobResult } from "../convert/cli-pdf-job.js";
import { prepareMarkdown } from "../convert/preprocess.js";
import { emitConvertedArtifact } from "../convert/run.js";
import type { ConvertWarning } from "../core/i18n.js";
import type { AppSettings } from "../core/settings/settings-defaults.js";
import { renderPdf } from "./converter/electron-side.js";
import { resolveKatexDir } from "./services/resource-dirs.js";

/** 本模块的目录(编译产物在 <root>/dist/main/) */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** katex 资源目录(见文件头「katexDir 不能用 getKatexDir()」) */
function katexDir(): string {
  return resolveKatexDir(path.resolve(moduleDir, "..", ".."));
}

/**
 * 执行一次 pdf 转换任务:读任务描述 → 调装配层 → 写结果文件 → **返回退出码**。
 *
 * 不调 app.exit —— 结束进程是这个 Electron **入口**的职责,不是转换的职责。
 * 两者分开是为了可测:验收段(test/cli/pdf-host.test.js)在 Electron 宿主里直接调本函数
 * 跑真转换,既拿到覆盖率,又不必让整段宿主跟着退出(退出就没法再断言别的了)。
 *
 * @param jobPath 任务描述文件路径
 * @param resultPath 结果文件路径(与任务描述同目录,由 CLI 侧分配并统一回收)
 * @returns exitCodes 之一(与 CLI 主进程共用单源)
 */
export async function convertPdfJob(jobPath: string, resultPath: string): Promise<number> {
  try {
    const job = readJob(jobPath);
    const started = Date.now();
    const warnings: ConvertWarning[] = [];
    const settings = job.settings as unknown as AppSettings;
    const prepared = await prepareMarkdown(job.input, settings, warnings, "warn.gbkEncoding");
    const result = await emitConvertedArtifact(
      {
        markdown: { body: prepared.body, metadata: prepared.metadata },
        sourcePath: job.input,
        baseDir: job.baseDir,
        ...(job.outputPath !== undefined ? { pinOutputPath: job.outputPath } : {}),
      },
      {
        format: "pdf",
        settings,
        ctx: createConvertContext(),
        warnings,
        katexDir: katexDir(),
        printPdf: renderPdf,
        // mermaidResolver 刻意不注入:CLI 面的契约是「宿主不提供能力 → 按普通代码块
        // 渲染」(ADR-060 后果 2 的缺省语义)。此处虽已在 Electron 内,但注入会让
        // 「同一份输入,CLI 的 docx 面与 pdf 面产出不同」—— 那是比降级更坏的分叉。
        // CLI 的 mermaid 支持属后续步序,届时两个格式同批注入。
      },
    );
    writeJobResult(resultPath, {
      ok: true,
      outputPath: result.outputPath,
      warnings: result.warnings.map(warningKeyOf),
      elapsedMs: Date.now() - started,
    });
    return exitCodes.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 取消不算失败:它由调用方主动发起,退出码上必须与失败可分
    const code =
      error instanceof Error && error.name === "ConvertCanceledError"
        ? exitCodes.ok
        : exitCodes.convertFailed;
    try {
      writeJobResult(resultPath, { ok: false, warnings: [], elapsedMs: 0, error: message });
    } catch {
      // 结果文件本身写不了(磁盘满 / 权限):退出码已足够让 CLI 判定,不叠加第二个错误
    }
    process.stderr.write(`[cli-pdf] ${message}\n`);
    return code;
  }
}

/** 警告的 key(结果契约只传 key;人读文案由 CLI 侧按需格式化) */
function warningKeyOf(warning: ConvertWarning): string {
  if (typeof warning === "string") return warning;
  const key = (warning as { key?: unknown }).key;
  return typeof key === "string" ? key : "warning";
}

/**
 * 入口守卫:仅当本文件被当作 Electron 主进程启动时才接管生命周期。
 * 被 import(验收段直调 convertPdfJob)时不碰 app 的任何全局状态。
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return /cli-pdf-host\.(?:js|ts|cjs|mjs)$/.test(entry);
}

if (isEntryPoint()) {
  // 一次性 userData:pdf 打印会拉起隐藏 BrowserWindow,Electron 默认把 profile 写到
  // 真实 %APPDATA% —— CLI 是脚本面,不该在用户真实 profile 里留痕。建在 os.tmpdir() 下
  // 而非项目 output/:本宿主可能以打包产物形态被拉起,那时项目 output/ 写不进去。
  // **重定向必须在 app ready 之前**完成(Chromium 在 ready 时已按该路径建好 profile)。
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "m2w-cli-pdf-")));

  // 接管 window-all-closed:空处理器 = 不让窗口生命周期决定进程何时结束。
  // Electron 的默认行为是「最后一个窗口关闭即退出」。本宿主**没有常驻窗口** ——
  // printPdf 会建一个隐藏打印窗口并在 finally 里 destroy 它,那一下恰好构成
  // 「最后一个窗口关闭」,默认处理器随即结束进程:pdf-lib 的书签/元数据注入、产物提交、
  // 结果文件写入全部来不及执行。
  // 症状极难自查(2026-10-03 实测):子进程退出码 0、**无任何 stderr**、结果文件不存在,
  // 看起来像「任务根本没跑」;调试脚本里更怪 —— 挂着的 setInterval 一次都没触发,
  // 说明不是异常也不是超时,而是进程被**同步**结束、事件循环直接排空。
  app.on("window-all-closed", () => {});

  const jobArg = process.argv[2];
  const resultArg = process.argv[3];
  if (jobArg === undefined || resultArg === undefined) {
    process.stderr.write("[cli-pdf] 用法:cli-pdf-host <job.json> <result.json>\n");
    app.exit(exitCodes.usage);
  } else {
    void app.whenReady().then(
      async () => {
        app.exit(await convertPdfJob(jobArg, resultArg));
      },
      (error: unknown) => {
        process.stderr.write(
          `[cli-pdf] Electron 启动失败:${error instanceof Error ? error.message : String(error)}\n`,
        );
        app.exit(exitCodes.convertFailed);
      },
    );
  }
}