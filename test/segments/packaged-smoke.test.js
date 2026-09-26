// @ts-check
/**
 * 打包产物冒烟契约段(跨域守护,住 test/segments/):守护「解包/安装产物能以 --smoke
 * 自证健康」这条发布链路的**契约面**,不启动真实可执行文件(进程级判定由
 * test/segments/install-smoke.test.js 在沙盒里覆盖,真实产物由
 * scripts/check-unpacked-smoke.mjs / check-install-smoke.mjs 取证)。
 *
 * 为什么要有本段:冒烟入口一度是 dev-only 设施(源码在 test/tools/,build.files 只收
 * dist/**),打包产物收到 --smoke 必以退出码 1 结束,而源码与 dist 全绿 —— 只有把
 * 「入口随包 + 判定面一致 + 不夹带 dev 代码」写成断言,这类静默回归才拦得住。
 *
 * 覆盖:
 * 1. 诊断标记恒等:src/main/smoke.ts 的标记常量(SMOKE_MARKER)与发布侧判定清单
 *    (scripts/smoke-proc.mjs 的 SMOKE_MARKERS)逐条恒等,且标记字面量真的出现在编译
 *    产物里(常量没被改名/摇掉);并用真实判定函数 collectSmokeProblems 锁「退出码
 *    0 + 五条标记 = 通过 / 非零 = 判红」这条判定口径。
 * 2. 单一实现:冒烟逻辑只有 src/main/smoke.ts 一份 —— dev 侧入口
 *    (test/tools/smoke/smoke.mjs)只做转调(runSmoke 同一函数对象 + 无实现痕迹),
 *    主进程 --smoke 分支直连 dist/main/smoke.js(不再经 test/ 路径),单实例锁豁免仍在。
 * 3. 打包面纪律:编译产物内不得出现 test/ 路径引用与仓库相对定位(import.meta.url /
 *    上跳 import);package.json build.files 只收 dist/** 与 package.json,不得夹带 test/**;
 *    冒烟产物目录按 app 形态解析(dev → <应用根>/output/smoke,打包 → 系统临时目录一次性
 *    子目录),不写死仓库相对路径。
 * 4. 降级契约:缺 katex 资源(公式样式)属**非致命降级** —— 真实跑一次 pdf 转换
 *    (指向不存在的 katex 目录)断言:产物照出(%PDF- 魔数)、警告通道命中
 *    warn.katexCssLoadFailed、降级留痕行以 SMOKE_MARKER.pdfDegraded 打头且不被当成失败
 *    (失败路径是 throw,由主进程 app.exit(1));资源在位时同一输入不产生该警告
 *    (否则降级行会退化成噪声,失去「asap 漏 katex 资源」这类回归的可见性)。
 */
import { statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectSmokeProblems, SMOKE_MARKERS } from "../../scripts/smoke-proc.mjs";
import { convertImpl } from "../../dist/main/converter/index.js";
import {
  SMOKE_MARKER,
  describePdfDegradation,
  resolveSmokeOutDir,
  runSmoke,
} from "../../dist/main/smoke.js";
import * as devSmokeEntry from "../tools/smoke/smoke.mjs";
import { ROOT } from "../common/paths.js";

/** 编译产物路径(冒烟实现;build.files 收 dist/** → 天然随包) */
const SMOKE_JS = path.join(ROOT, "dist", "main", "smoke.js");
/** 源码路径 */
const SMOKE_TS = path.join(ROOT, "src", "main", "smoke.ts");
/** dev 侧薄封装入口 */
const DEV_ENTRY = path.join(ROOT, "test", "tools", "smoke", "smoke.mjs");
/** 降级断言专用的一次性目录名前缀(与段内业务临时目录 m2w-* 区分) */
const SANDBOX_PREFIX = "m2w-packaged-smoke-";
/** 公式样式缺失的警告键(pdf 渲染层上报,与 src/main/smoke.ts 的判定同源) */
const KATEX_WARNING_KEY = "warn.katexCssLoadFailed";

/**
 * 断言辅助(条件不成立即抛错,给后续行收窄用)。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond} 条件不成立即抛错
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`packaged-smoke 断言失败:${msg}`);
}

/**
 * 剥掉 JS 注释(块注释 + 行注释):断言「代码里没有某路径」时不能被注释里的
 * 「反例说明」误伤。行注释用 `[^:]` 前缀守卫,避免把字符串里的 `://`(如 file://)当注释。
 * @param {string} code 源码文本
 * @returns {string} 去掉注释后的文本
 */
function stripJsComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

/**
 * 抽取 import/export from 与动态 import() 的说明符(判定 import 边界用)。
 * @param {string} code 源码文本
 * @returns {string[]} 说明符列表
 */
function collectSpecifiers(code) {
  /** @type {string[]} */
  const found = [];
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g)) {
    if (m[1] !== undefined) found.push(m[1]);
  }
  return found;
}

/**
 * 临时目录清理(Electron fs 层同样管着 os.tmpdir 下的文件,失败即判红:残留不该静默)。
 * @param {string} dir 目录绝对路径
 * @returns {Promise<void>} 清理完成
 */
async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    throw new Error(`临时目录清理失败:${dir}(${err instanceof Error ? err.message : String(err)})`);
  }
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ================= 1. 诊断标记恒等 + 判定口径(退出码 0/1) =================
  {
    assert(SMOKE_MARKERS.length === 5, `发布侧判定清单应为 5 条,实际 ${SMOKE_MARKERS.length}`);
    // Object.freeze 让 TS 把取值推成字面量联合,显式放宽为 string[] 以便与外部清单比对
    const implemented = /** @type {string[]} */ (Object.values(SMOKE_MARKER));
    for (const marker of SMOKE_MARKERS) {
      assert(
        implemented.includes(marker.token),
        `src/main/smoke.ts 未实现发布侧断言的标记「${marker.token}」(id=${marker.id}, label=${marker.label});` +
          `当前实现标记: ${implemented.join(" / ")}`,
      );
    }
    // 标记字面量必须真的在编译产物里:常量被改名/摇掉时,判定面会静默失配
    const compiled = await fs.readFile(SMOKE_JS, "utf8");
    for (const marker of SMOKE_MARKERS) {
      assert(
        compiled.includes(marker.token),
        `编译产物 dist/main/smoke.js 内应含标记字面量「${marker.token}」(发布侧按此串判定产物输出)`,
      );
    }
    // 判定口径:五条标记 + 退出码 0 = 通过;任一缺失或非零退出 = 判红
    const okOutput = SMOKE_MARKERS.map((marker) => `${marker.token} fixture`).join("\n");
    const passed = collectSmokeProblems({ code: 0, signal: null, timedOut: false, output: okOutput }, { label: "契约" });
    assert(
      passed.length === 0,
      `「五条标记 + 退出码 0」应判通过,实际判红:${passed.join("; ")}`,
    );
    const failed = collectSmokeProblems(
      { code: 1, signal: null, timedOut: false, output: okOutput },
      { label: "契约" },
    );
    assert(
      failed.some((problem) => problem.includes("退出码为 1,期望 0")),
      `冒烟失败路径应以退出码 1 判红,实际:${failed.join("; ")}`,
    );
    // 反向:漏一条标记必须被指名道姓(不是笼统「失败」)
    const partial = collectSmokeProblems(
      { code: 0, signal: null, timedOut: false, output: SMOKE_MARKERS.slice(0, 3).map((m) => `${m.token} x`).join("\n") },
      { label: "契约" },
    );
    const missingLabels = SMOKE_MARKERS.slice(3).map((marker) => marker.label);
    assert(
      partial.some((problem) => problem.includes(`输出缺少诊断标记:${missingLabels.join("、")}`)),
      `缺标记时应逐条点名(${missingLabels.join("、")}),实际:${partial.join("; ")}`,
    );
    console.log(
      `[ok] packaged-smoke:1 诊断标记 5 条与发布侧清单逐条恒等(判定口径:标记齐 + 退出码 0 通过,非零/缺标记判红)`,
    );
  }

  // ================= 2. 单一实现(dev 侧薄封装 + 主进程直连) =================
  {
    assert(
      devSmokeEntry.runSmoke === runSmoke,
      "dev 侧入口 test/tools/smoke/smoke.mjs 应直接转调 dist/main/smoke.js 的同一 runSmoke(不得各留一份实现)",
    );
    assert(
      Object.keys(devSmokeEntry).length === 1,
      `dev 侧入口只应转调 runSmoke 一个出口,实际:${Object.keys(devSmokeEntry).join(", ")}`,
    );
    const entryCode = stripJsComments(await fs.readFile(DEV_ENTRY, "utf8"));
    // 薄封装结构断言:只 import/转调,不含任何冒烟实现痕迹
    for (const forbidden of ["console.log", "convertImpl", "executeJavaScript", "PDFDocument", "updateSettings"]) {
      assert(
        !entryCode.includes(forbidden),
        `dev 侧入口只应转调实现,不应含「${forbidden}」等实现痕迹(否则逻辑两份,必然漂移)`,
      );
    }
    const entrySpecs = collectSpecifiers(entryCode);
    assert(
      entrySpecs.length === 1 && /dist\/main\/smoke\.js$/.test(entrySpecs[0] ?? ""),
      `dev 侧入口只应 import dist/main/smoke.js 一个模块,实际:${JSON.stringify(entrySpecs)}`,
    );
    // 主进程 --smoke 分支:直连 dist/main/smoke.js,不再经 test/ 路径(dev-only 路径进不了包)
    const indexCode = stripJsComments(await fs.readFile(path.join(ROOT, "src", "main", "index.ts"), "utf8"));
    assert(
      indexCode.includes('import("./smoke.js")'),
      "src/main/index.ts 的 --smoke 分支应动态 import ./smoke.js(编译产物恒在包内)",
    );
    assert(
      !indexCode.includes("test/tools/smoke"),
      "src/main/index.ts 不得再引用 test/tools/smoke 路径(打包产物内不存在该路径)",
    );
    assert(
      /!SMOKE\s*&&\s*!app\.requestSingleInstanceLock\(\)/.test(indexCode),
      "smoke 模式跳过单实例锁的既有行为须保持(冒烟需与开发实例并存)",
    );
    assert(
      indexCode.includes("app.exit(1)"),
      "冒烟失败路径须以 app.exit(1) 结束(确定性退出码)",
    );
    // 单一实现的另一面:src 侧不得残留第二份实现(旧实现文件已退化为薄封装)
    const smokeSource = await fs.readFile(SMOKE_TS, "utf8");
    assert(
      smokeSource.includes("export async function runSmoke"),
      "冒烟实现的唯一出处应为 src/main/smoke.ts 的 runSmoke",
    );
    console.log("[ok] packaged-smoke:2 冒烟实现单一(dev 入口薄转调同一 runSmoke,主进程直连 dist/main/smoke.js)");
  }

  // ================= 3. 打包面纪律(产物不含 test/ 路径与仓库相对定位) =================
  {
    const compiled = await fs.readFile(SMOKE_JS, "utf8");
    const code = stripJsComments(compiled);
    assert(
      !/test\//.test(code),
      `编译产物内不得出现 test/ 路径引用(dev-only 代码进不了包,引用即运行期 ERR_MODULE_NOT_FOUND);` +
        `命中:${JSON.stringify(code.match(/.{0,40}test\/.{0,40}/)?.[0] ?? "")}`,
    );
    assert(
      !code.includes("import.meta.url"),
      "编译产物不得用 import.meta.url 定位资源(编译产物在 app.asar 内,位置与仓库无关)",
    );
    // 相对 import 只能落在 dist 内(dist/main ↔ dist/core 是合法层间引用),
    // 一旦解析到 dist 之外(asar 内不存在),运行期即 ERR_MODULE_NOT_FOUND
    const relativeSpecs = collectSpecifiers(code).filter((spec) => spec.startsWith("."));
    const escaped = relativeSpecs.filter((spec) => {
      const resolved = path.posix.normalize(path.posix.join("dist/main", spec));
      return !resolved.startsWith("dist/") || resolved.includes("/test/");
    });
    assert(
      escaped.length === 0,
      `编译产物的相对 import 不得解析到 dist 之外(包内不存在该路径),越界项:${JSON.stringify(escaped)}`,
    );
    console.log(
      `[ok] packaged-smoke:3a 编译产物 ${relativeSpecs.length} 条相对 import 全部落在 dist 内(${relativeSpecs.join(" ")})`,
    );
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
    const files = Array.isArray(pkg.build?.files) ? pkg.build.files : [];
    assert(
      files.includes("dist/**"),
      `package.json build.files 应含 dist/**(编译产物随包分发),实际:${JSON.stringify(files)}`,
    );
    const devFiles = files.filter((/** @type {string} */ entry) => /(^|\/)test\//.test(entry));
    assert(
      devFiles.length === 0,
      `package.json build.files 不得夹带 test/**(绝不给用户塞 dev-only 代码),实际:${JSON.stringify(devFiles)}`,
    );
    // 产物目录按应用形态解析:dev 落应用根 output/smoke,打包落系统临时目录一次性子目录
    const devDir = resolveSmokeOutDir({ isPackaged: false, appPath: "C:\\repo", tempDir: "C:\\tmp" });
    assert(
      devDir.dir === path.join("C:\\repo", "output", "smoke") && devDir.ephemeral === false,
      `dev 形态产物目录应为 <应用根>/output/smoke 且非一次性,实际:${JSON.stringify(devDir)}`,
    );
    const packagedDir = resolveSmokeOutDir({ isPackaged: true, appPath: "C:\\Program Files\\app\\resources", tempDir: "C:\\tmp" });
    assert(
      packagedDir.ephemeral === true && path.dirname(packagedDir.dir) === "C:\\tmp",
      `打包形态产物目录应落系统临时目录的一次性子目录(退出前删除),实际:${JSON.stringify(packagedDir)}`,
    );
    // 打包形态的目录不得依赖 appPath:否则会写进安装/解包目录(发布产物被污染,asar 内也不可写)
    const packagedAlt = resolveSmokeOutDir({
      isPackaged: true,
      appPath: "C:\\另一个安装目录\\resources\\app.asar",
      tempDir: "C:\\tmp",
    });
    assert(
      packagedAlt.dir === packagedDir.dir,
      `打包形态产物目录不得依赖 appPath(不得写进安装/解包目录),appPath 变化后得:${packagedAlt.dir}`,
    );
    console.log("[ok] packaged-smoke:3 打包面纪律成立(产物无 test/ 路径与仓库相对定位,build.files 不夹带 test/**,产物目录按形态解析)");
  }

  // ================= 4. 降级契约:缺 katex 资源 = 非致命降级(产物仍出、留痕、退出码语义不变) =================
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), SANDBOX_PREFIX));
    try {
      const sampleMd = path.join(dir, "packaged-smoke.md");
      await fs.writeFile(sampleMd, "# 降级冒烟\n\n正文一段。\n", "utf8");
      const missingKatexDir = path.join(dir, "no-such-katex-dist");
      // 场景 A:公式样式资源缺失(打包漏收 katex 资源时的真实形态)
      const degraded = await convertImpl(sampleMd, "pdf", undefined, undefined, missingKatexDir);
      const degradedBytes = await fs.readFile(degraded.outputPath);
      assert(
        degradedBytes.subarray(0, 5).toString("latin1") === "%PDF-",
        `缺 katex 资源时 pdf 产物仍应落盘且魔数正确,实际:${degradedBytes.subarray(0, 8).toString("latin1")}`,
      );
      const katexWarnings = (degraded.warnings ?? []).filter(
        (w) => typeof w !== "string" && /** @type {{ key?: string }} */ (w).key === KATEX_WARNING_KEY,
      );
      assert(
        katexWarnings.length === 1,
        `缺 katex 资源应恰好上报 1 条 ${KATEX_WARNING_KEY} 警告(非致命),实际:${JSON.stringify(degraded.warnings)}`,
      );
      const degradationLine = describePdfDegradation(degraded.warnings);
      assert(
        degradationLine.startsWith(SMOKE_MARKER.pdfDegraded) && degradationLine.includes(KATEX_WARNING_KEY),
        `降级留痕行应以「${SMOKE_MARKER.pdfDegraded}」打头并点名警告键,实际:${degradationLine}`,
      );
      assert(
        !degradationLine.includes("[smoke] convert FAILED") && !/[Tt]hrow/.test(degradationLine),
        "降级留痕行不得表现为失败(失败路径是 throw → 主进程 app.exit(1))",
      );
      assert(
        describePdfDegradation(undefined) === "" && describePdfDegradation([]) === "",
        "无警告通道时不应打降级行(否则正常运行的输出恒多一行噪声)",
      );
      // 场景 B:资源在位 → 同一输入不产生该警告(证明 A 的告警确实由缺资源触发)
      const okKatexDir = path.join(ROOT, "node_modules", "katex", "dist");
      assert(
        existsDir(okKatexDir),
        `KaTeX 资源目录缺失(依赖未安装?),无法验证「资源在位」侧:${okKatexDir}`,
      );
      const healthy = await convertImpl(sampleMd, "pdf", undefined, undefined, okKatexDir);
      const healthyKatexWarnings = (healthy.warnings ?? []).filter(
        (w) => typeof w !== "string" && /** @type {{ key?: string }} */ (w).key === KATEX_WARNING_KEY,
      );
      assert(
        healthyKatexWarnings.length === 0,
        `资源在位时不应上报 ${KATEX_WARNING_KEY}(否则降级行退化为噪声,失去回归可见性),实际:${JSON.stringify(healthy.warnings)}`,
      );
      assert(
        describePdfDegradation(healthy.warnings) === "",
        "资源在位时不应打降级留痕行",
      );
      console.log(
        `[ok] packaged-smoke:4 降级契约成立(缺 katex 资源:产物仍出 + ${KATEX_WARNING_KEY} 警告 + 降级留痕行,非致命;资源在位无警告无留痕)`,
      );
    } finally {
      await removeDir(dir);
    }
  }
}

/**
 * 目录是否存在(依赖安装前置断言,不存在即让「资源在位」侧无意义)。
 * @param {string} dir 目录绝对路径
 * @returns {boolean} 是否为目录
 */
function existsDir(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
