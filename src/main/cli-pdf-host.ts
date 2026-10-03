/**
 * CLI 的 pdf 宿主:被 `src/cli/index.ts` 以子进程方式拉起,提供 printToPDF 能力。
 *
 * 为什么要有这个壳:pdf 的打印能力是 **Electron 宿主能力**(ADR-060 后果 2 ——
 * `printToPDF` 是唯一打印宿主,装配层不自带、缺它即报错不降级)。而 CLI 本身是
 * **纯 node 进程**(零 electron import,见门禁 `faces-no-host`),两者不能同进程。
 * 故 CLI 对 pdf 走「壳自动重入 Electron」:本模块就是被重入的那一侧。
 *
 * 与 `electron-side.ts` 的关系:本模块**不重复实现**打印,只做三件事 ——
 * ① 读任务描述(契约见 convert/cli-pdf-job.ts,CLI 与本模块共用);
 * ② 调装配层(与 GUI 的 single.ts 同一入口 emitConvertedArtifact),注入 renderPdf;
 * ③ 把结构化结果写进**结果文件**并以约定退出码结束。
 * 换句话说:**它是 CLI 面对装配层的调用点**,能力注入与 GUI 完全同构。
 *
 * ⚠ katexDir 按**模块自身位置**定位(上溯两级),而不是 getKatexDir() 那条
 * `app.getAppPath()` —— 但理由不是「getKatexDir() 一律不可用」,而是**只有一种启动
 * 形态下两者会分叉**,那种形态恰是本文件原本的启动方式:
 *
 * - **源码检出**(以脚本路径启动:`electron dist/main/cli-pdf-host.js`):appPath 等于**脚本
 *   所在目录**(实测,脚本放系统临时区时 appPath 就是那个临时区),于是 getKatexDir() 指向
 *   `dist/main/node_modules/katex/dist` —— 不存在,公式路径必然读不到;而模块自身位置
 *   上溯两级 = 项目根,正确。
 * - **已安装形态**(经 `--pdf-host` flag 由应用自身主进程接管,见 main/index.ts):
 *   appPath 就是 `…/resources/app.asar`,**两条路径给出同一答案**(`app.asar` 下
 *   `node_modules/katex/dist`,node_modules 随 asar 内置)。此时 getKatexDir() 同样可用。
 *
 * ⇒ 选 moduleDir 相对定位是因为它**在两种形态下都对**,而非因为另一条处处坏。
 * 2026-10-03 实测(真实 win-unpacked 产物):安装版经 `--pdf-host` 转 pdf,带公式的产物
 * 53628 B、不带公式 42591 B(差 11 KB)且**不含字面 `$a^2`** ⇒ 公式确实被 KaTeX 渲染;
 * 另在同产物上跑 `--smoke`(它用 getKatexDir())exit 0、pdf 转换成功且**无
 * `warn.katexCssLoadFailed` 降级行** ⇒ 该形态下 getKatexDir() 亦可用。
 *
 * 早期版本此处的注释写作「katexDir 不能用 getKatexDir()」,那是把上表第一行的结论当成了
 * 普遍结论,会误导后来人以为另一条在打包态也坏 —— 2026-10-03 已按上述实测更正。
 */
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
import { preparePdfHostProfile } from "./services/pdf-host-profile.js";
import { resolveKatexDir } from "./services/resource-dirs.js";

/** 本模块的目录(编译产物在 <root>/dist/main/) */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 本宿主的 katex 资源目录 —— 纯路径解析(入参为宿主模块自身目录,可参数化直测)。
 *
 * 抽成导出函数是为了让**两种启动形态的判定可被断言**,而不必真起一个 Electron:
 * dev 形态的模块目录是 `<repo>/dist/main`,已安装形态是 `…/app.asar/dist/main`
 * (同一段编译产物被两种形态以不同前缀加载),传入即可验「两种形态都指向存在的
 * node_modules/katex/dist」。理由与两形态的差异见文件头那张对照表。
 *
 * @param hostModuleDir 宿主模块自身所在目录(编译产物恒在 `…/dist/main/`)
 * @returns katex 资源目录(该目录下应有 `katex.min.css` 与 `fonts/`)
 */
export function resolvePdfHostKatexDir(hostModuleDir: string): string {
  return resolveKatexDir(path.resolve(hostModuleDir, "..", ".."));
}

/** katex 资源目录(见文件头「katexDir 按模块自身位置定位」) */
function katexDir(): string {
  return resolvePdfHostKatexDir(moduleDir);
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
 * 以「宿主」角色跑完一次 pdf 任务:装宿主的两项全局设置 → app ready 后转换 → 结束进程。
 *
 * 为什么是函数而不是入口块里的语句:宿主有**两个**启动形态,两者必须共用同一段设置,
 * 否则那份设置只在一半的调用路径上生效(PLAN「步序 1 · 修复项复测 ②」)。
 * ① 源码检出:`electron dist/main/cli-pdf-host.js <job> <result>`(argv[2]/argv[3]);
 * ② 已安装:`<产品名>.exe --pdf-host <job> <result>`(flag 之后的两个值,见 main/index.ts)。
 * ② 尤其不能漏:那份设置在被 import 时**不会**执行(入口守卫不成立),只 import
 * convertPdfJob 就等于把下面两个坑重新引进来。
 *
 * **本函数不解析 argv**:两种形态的 argv 布局不同(脚本路径是否占位、flag 是否在前),
 * 解析逻辑留在各自入口,这里只收「已取好的 job/result 两个路径」。这样解析不会有两份。
 *
 * 两种形态共同的不变量:① `setPath("userData")` 早于 ready;② 装上 window-all-closed
 * 空处理器。这两条都由本函数承担 —— 漏掉任一条的症状都是**静默**的(见下)。
 *
 * @param jobPath 任务描述文件路径(缺省即用法错)
 * @param resultPath 结果文件路径(缺省即用法错)
 */
export function runPdfHost(jobPath: string | undefined, resultPath: string | undefined): void {
  // ready 之前的宿主设置(重定向 userData + 接管 window-all-closed)已搬进
  // services/pdf-host-profile.ts,本函数只调用它。搬走的理由是**时序**,不是职责:
  // 已安装形态要先 await import 本模块才会走到这里,那与「ready 之前完成重定向」冲突。
  // 该函数幂等,故已安装形态下 main/index.ts 在动态 import 之前先调过一次,这里是第二次。
  preparePdfHostProfile();

  if (jobPath === undefined || resultPath === undefined) {
    process.stderr.write("[cli-pdf] 用法:cli-pdf-host <job.json> <result.json>\n");
    app.exit(exitCodes.usage);
    return;
  }
  void app.whenReady().then(
    async () => {
      app.exit(await convertPdfJob(jobPath, resultPath));
    },
    (error: unknown) => {
      process.stderr.write(
        `[cli-pdf] Electron 启动失败:${error instanceof Error ? error.message : String(error)}\n`,
      );
      app.exit(exitCodes.convertFailed);
    },
  );
}

/**
 * 入口守卫:仅当本文件被当作 Electron 主进程启动时才接管生命周期。
 * 被 import(验收段直调 convertPdfJob;已安装形态被 main/index.ts 动态 import)时不碰
 * app 的任何全局状态 —— 宿主设置由调用方显式调 runPdfHost() 承担。
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return /cli-pdf-host\.(?:js|ts|cjs|mjs)$/.test(entry);
}

if (isEntryPoint()) {
  runPdfHost(process.argv[2], process.argv[3]);
}