// @ts-check
/**
 * CLI 的 pdf 宿主验收(位于 test/cli/,镜像顶层树 src/cli;ADR-060):
 *
 * 被测主体 = dist/main/cli-pdf-host.js 的 `convertPdfJob` + dist/convert/cli-pdf-job.js
 * 的结果契约。
 *
 * 为什么在**本进程**(Electron 宿主)直调而不是再起一个 CLI 子进程:
 * pdf 能力是宿主能力,本段跑在 electron.exe 里,app 已 ready —— 直接调 convertPdfJob
 * 走的就是子进程里那条完全相同的代码路径(printPdf → pdf-lib 两遍法 → 提交器)。
 * 反过来在 CLI 子进程里验,c8 收不到子进程的覆盖率,新文件会以 0% 落在分母里,
 * 逼出「登记豁免」这种假覆盖;而且子进程里的失败只剩一个退出码,定位不到哪一步断的。
 * 故:转换逻辑本进程直测(可断言、可覆盖),**进程编排**(spawn / 退出码转发)由
 * options.test.js 的子进程段负责,两边互补不重叠。
 *
 * 覆盖:
 * - 真 pdf 产出:退出码 0 + 产物魔数 %PDF + 结果文件的字段形状(ok/outputPath/warnings/elapsedMs);
 * - pinOutputPath 形态:pdf 路径同样逐字落盘,且**禁避让**(已存在即失败,拿不到「名 (2).pdf」);
 * - 失败形态:输入文件不存在 → 退出码 3 + 结果文件带 error、ok 为假;
 * - 结果契约:writeJobResult/readJobResult 往返,以及结果文件缺失即抛(宿主没跑完)。
 */
import fs from "node:fs";
import path from "node:path";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import { ROOT } from "../harness/paths.js";
import { convertPdfJob, resolvePdfHostKatexDir } from "../../dist/main/cli-pdf-host.js";
import { exitCodes, readJobResult, writeJobResult } from "../../dist/convert/cli-pdf-job.js";
import { cloneDefaultSettings } from "../../dist/core/settings/settings-defaults.js";
import { createAsserter } from "../harness/assert.js";

/**
 * 本段横跨的层(ADR-062 L6 判据要求 behavior 段显式声明):判据只校验「非空 ＋ 每个元素
 * 在磁盘上真实存在」,元素是**仓库相对 POSIX 路径**。
 */
export const covers = [
  "src/main/cli-pdf-host.ts",
  "src/convert/cli-pdf-job.ts",
];

const { assert: harnessAssert } = createAsserter("cli-pdf-host");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游依赖收窄 ⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/** pdf 魔数:%PDF */
/** @param {string} filePath */
function isPdfMagic(filePath) {
  const head = fs.readFileSync(filePath).subarray(0, 4);
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

/** 最小可转 markdown(标题 + 公式,公式触发 katex CSS 读取 —— 顺带证明 katexDir 定位对) */
const SAMPLE_MD = [
  "# PDF 宿主验收",
  "",
  "正文一段,含**粗体**。",
  "",
  "行内公式 $E = mc^2$ 与块级公式:",
  "",
  "$$a^2 + b^2 = c^2$$",
  "",
].join("\n");

/**
 * 造一份任务描述文件。
 * @param {string} dir 临时目录
 * @param {Record<string, unknown>} overrides 覆盖字段
 * @returns {string} 任务描述文件路径
 */
function writeJob(dir, overrides) {
  const settings = cloneDefaultSettings();
  settings.format = "pdf";
  settings.outputDir = "";
  settings.afterConvert = "none";
  const jobPath = path.join(dir, `job-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jobPath, JSON.stringify({ settings, ...overrides }), "utf8");
  return jobPath;
}

// 本段无验收样例(输入是本段自造的最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const { path: dir } = createTempResource({ label: "cli-pdf-host" });
  try {
    // ---------- 一、真 pdf 产出 ----------
    const src = path.join(dir, "样例.md");
    fs.writeFileSync(src, SAMPLE_MD, "utf8");
    const jobPath = writeJob(dir, { input: src, baseDir: dir });
    const resultPath = path.join(dir, "result-ok.json");

    const code = await convertPdfJob(jobPath, resultPath);
    assert(code === exitCodes.ok, `pdf 转换应退出 0,实际 ${code}`);
    const ok = readJobResult(resultPath);
    assert(ok.ok === true, "结果文件 ok 应为真");
    assert(typeof ok.outputPath === "string" && fs.existsSync(ok.outputPath), `结果应给出已落盘的产物路径:${String(ok.outputPath)}`);
    assert(isPdfMagic(ok.outputPath), "产物魔数应为 %PDF");
    assert(Array.isArray(ok.warnings), "结果应带 warnings 数组");
    assert(typeof ok.elapsedMs === "number" && ok.elapsedMs >= 0, "结果应带耗时 elapsedMs");

    // ---------- 二、pinOutputPath:逐字落盘 + 禁避让 ----------
    const pinned = path.join(dir, "钉住.pdf");
    const pinResult = path.join(dir, "result-pin.json");
    const pinCode = await convertPdfJob(writeJob(dir, { input: src, baseDir: dir, outputPath: pinned }), pinResult);
    assert(pinCode === exitCodes.ok, `pdf 钉死路径应成功,实际 ${pinCode}`);
    assert(readJobResult(pinResult).outputPath === pinned, "pdf 路径应逐字落盘到指定路径");
    assert(fs.existsSync(pinned), "钉死的 pdf 应真实存在");

    // 再跑一次同一路径:必须失败,且不得产出「钉住 (2).pdf」
    const pinAgain = path.join(dir, "result-pin2.json");
    const pinCode2 = await convertPdfJob(writeJob(dir, { input: src, baseDir: dir, outputPath: pinned }), pinAgain);
    assert(pinCode2 === exitCodes.convertFailed, `产物路径已存在应判失败,实际 ${pinCode2}`);
    const failed = readJobResult(pinAgain);
    assert(failed.ok === false && typeof failed.error === "string", "失败结果应带 error 文案");
    assert(
      !fs.existsSync(path.join(dir, "钉住 (2).pdf")),
      "禁避让语义下不得产出「钉住 (2).pdf」(pdf 路径同样受 pinOutputPath 约束)",
    );

    // ---------- 三、失败形态:输入不存在 ----------
    const badResult = path.join(dir, "result-bad.json");
    const badCode = await convertPdfJob(
      writeJob(dir, { input: path.join(dir, "不存在.md"), baseDir: dir }),
      badResult,
    );
    assert(badCode === exitCodes.convertFailed, `输入不存在应判失败,实际 ${badCode}`);
    assert(readJobResult(badResult).ok === false, "失败结果 ok 应为假");

    // ---------- 四、结果契约自身 ----------
    // 往返:write → read 逐字段一致
    const roundTrip = path.join(dir, "result-rt.json");
    writeJobResult(roundTrip, { ok: true, outputPath: "x.pdf", warnings: ["warn.a"], elapsedMs: 7 });
    const readBack = readJobResult(roundTrip);
    assert(readBack.outputPath === "x.pdf" && readBack.elapsedMs === 7, "结果契约往返应逐字段一致");
    // 宿主没跑完(文件不存在)→ 抛错,不返回「成功的空结果」
    let thrown = /** @type {unknown} */ (undefined);
    try {
      readJobResult(path.join(dir, "根本没有这个文件.json"));
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error, "结果文件缺失应抛错(否则会被当成成功的空结果)");

    // ---------- katex 资源定位:两种启动形态各断言一次 ----------
    // 抽出 resolvePdfHostKatexDir 就是为了这条:两种形态加载的是**同一段编译产物**,只是前缀
    // 不同(dev 是 <repo>/dist/main,安装版是 …/app.asar/dist/main),而 app.getAppPath()
    // 那条候选路径只在 dev 的脚本路径启动形态下才分叉(见宿主文件头那张对照表)。
    {
      const devDir = resolvePdfHostKatexDir(path.join(ROOT, "dist", "main"));
      assert(
        devDir === path.join(ROOT, "node_modules", "katex", "dist"),
        `dev 形态应解析到项目根的 node_modules/katex/dist,实际 ${devDir}`,
      );
      assert(
        fs.existsSync(path.join(devDir, "katex.min.css")),
        "dev 形态解出的目录下应有 katex.min.css(否则公式样式静默不加载)",
      );
      // 安装形态:上溯两级落在 app.asar **根**,故另一条候选路径(dev 那条会落到
      // app.asar/dist/main/node_modules —— 不存在)在这里本就不成立,两条同答案。
      const asarRoot = path.join(
        "C:", "Users", "u", "AppData", "Local", "Programs", "MarkdownToWord", "resources", "app.asar",
      );
      const packagedDir = resolvePdfHostKatexDir(path.join(asarRoot, "dist", "main"));
      assert(
        packagedDir === path.join(asarRoot, "node_modules", "katex", "dist"),
        `安装形态应解析到 app.asar 根下的 node_modules/katex/dist,实际 ${packagedDir}`,
      );
      assert(
        !packagedDir.includes(path.join("dist", "main")),
        "安装形态不得停在 dist/main 下(那是只有脚本路径启动才会出现的错位)",
      );
    }

    console.log("[ok] cli-pdf-host:pdf 宿主直测通过(真 pdf 魔数 + 结果契约字段 / pinOutputPath 逐字落盘且禁避让 / 失败形态带 error / 结果契约往返与缺失即抛 / katex 资源定位的两种启动形态各断言一次(dev 解出的目录真实存在,安装形态不落在 dist/main 下))");
  } finally {
    removeTree(dir);
  }
}