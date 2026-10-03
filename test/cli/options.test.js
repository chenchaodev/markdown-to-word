// @ts-check
/**
 * CLI 交付面验收(位于 test/cli/,镜像顶层树 src/cli;ADR-060):
 *
 * 被测主体 = dist/cli/options.js(纯函数:argv → 设置契约)+ dist/cli/index.js(编排)。
 *
 * 为什么两半都跑:
 * - **options 直测**(同进程 import):退出码表、参数解析、预设映射是 CLI 的全部判定面,
 *   逐条起一次真转换才能验的东西太贵,且失败时定位不到是哪个分支。options 零 IO,
 *   在纯 node 下直测才有意义(见下)。
 * - **index 经真 node 子进程跑**:CLI 的核心契约是「纯 node 进程里能把 markdown 变成
 *   docx」。在 electron.exe 里断言这件事证明不了任何东西 —— 装配层的依赖链里哪怕混进
 *   一个 electron import,本进程照样绿。故本段派生**真 node** 子进程(不设
 *   ELECTRON_RUN_AS_NODE、不经 electron,解析口径同 test/convert/run-headless.test.js)
 *   执行 dist/cli/index.js,断言退出码、stdout 的数据流、产物魔数。
 *
 * 覆盖:
 * - 退出码表逐条:0 成功 / 1 用法错 / 2 输入读不到 / 3 转换失败(注入式)/ 4 输出写不了;
 * - stdout 只出数据、stderr 出诊断(`--json` 下 stdout 必须是可解析的单个 JSON 数组);
 * - 目录输入递归收集(经 collectMarkdownPaths,与 GUI 同源);
 * - `--output` 的 pinOutputPath 语义:逐字落盘 + **禁重名避让**(已存在即失败,拿不到
 *   「名 (2).docx」);
 * - `--template` 经 core 的 presetSettingsPatch 生效(字体/页边距等真落到产物上),
 *   且与 renderer 的 applyTemplatePreset 是同一个函数(不在本段重复证明,那是 preset 段的职责)。
 *
 * 刻意**不在本段跑 pdf**:pdf 走子进程重入 Electron,属宿主链路,由 test/main/ 与 smoke
 * 覆盖;这里要证明的是「CLI 不需要 Electron 也能用」。
 *
 * 样例与产物全部放一次性临时目录(createTempResource 分配、removeTree 退避重试清理)。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../common/paths.js";
import { createTempResource, removeTree } from "../common/temp-resource.js";
import {
  CliUsageError,
  expandFormats,
  parseCliArgs,
  resolveCliSettings,
  usageText,
} from "../../dist/cli/options.js";
import { exitCodes, readJob } from "../../dist/convert/cli-pdf-job.js";
import { TEMPLATE_PRESETS, presetSettingsPatch } from "../../dist/core/settings/presets.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`cli 断言失败:${msg}`);
}

/**
 * 解析**真 node** 可执行文件:验收入口跑在 Electron 里(process.execPath 是
 * electron.exe),故优先取 npm 注入的 node_execpath,再退回按名找 node。
 * 刻意不接受 electron.exe —— 用它就必须设 ELECTRON_RUN_AS_NODE,那就不是纯 node 了。
 * @returns {string}
 */
function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.execPath]) {
    if (candidate && /node(\.exe)?$/i.test(candidate)) return candidate;
  }
  return process.platform === "win32" ? "node.exe" : "node";
}

/**
 * 在纯 node 子进程里跑一次 dist/cli/index.js。
 * @param {string[]} args CLI 参数
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runCli(args) {
  // ELECTRON_RUN_AS_NODE 必须**不在** env 里:带着它连 electron.exe 都能当 node 用,
  // 那样就证明不了「不经 electron」。这里显式删掉,不依赖父进程环境恰好干净。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(resolveNode(), [path.join(ROOT, "dist", "cli", "index.js"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** 最小可转 markdown(含 frontmatter + 标题 + 表格,覆盖两条解析路径) */
const SAMPLE_MD = ["---", "title: CLI 验收", "---", "", "# 一级标题", "", "正文一段,含**粗体**。", "", "| 列 A | 列 B |", "| --- | --- |", "| 1 | 2 |", ""].join("\n");

/** docx 魔数:OOXML 是 ZIP 容器(PK\x03\x04) */
/** @param {string} filePath */
function isDocxMagic(filePath) {
  const head = fs.readFileSync(filePath).subarray(0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

// 本段无验收样例(输入是本段自造的最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ============ 一、options 纯函数直测(同进程;零 IO 才可能逐分支验)============
  {
    // 1a. 参数解析:位置参数 + 各 flag
    const parsed = parseCliArgs(["a.md", "b.md", "--format", "pdf", "--json", "--template", "paper"]);
    assert(parsed.inputs.length === 2 && parsed.inputs[0] === "a.md", "位置参数应原样保留");
    assert(parsed.format === "pdf", `--format 应解析为 pdf,实际 ${parsed.format}`);
    assert(parsed.json === true, "--json 应被识别为开关");
    assert(parsed.templateId === "paper", "--template 应取到值");
    assert(parsed.help === false, "无 --help 时 help 为假");

    // 1b. --key=value 与 --key value 两种形态等价;短选项 -o 与 --output 等价
    const eqForm = parseCliArgs(["a.md", "--format=both"]);
    assert(eqForm.format === "both", "--format=both 的等号形态应生效");
    const defForm = parseCliArgs(["a.md"]);
    assert(defForm.format === "docx", `--format 缺省应为 docx,实际 ${defForm.format}`);
    assert(parseCliArgs(["a.md", "-o", "x.docx"]).outputPath === "x.docx", "-o 应等价于 --output");

    // 1c. --help 是早退出口:允许不带任何输入路径
    const help = parseCliArgs(["--help"]);
    assert(help.help === true, "--help 应被识别");

    // 1d. 用法错逐条:未知 flag / 缺取值 / 非法 format / 未知预设 / 无输入 / --output 配多输入
    /** @type {[string[], string][]} */
    const usageCases = [
      [["a.md", "--nope"], "未知选项"],
      [["a.md", "-x"], "未知短选项(不得当成输入路径)"],
      [["a.md", "--format"], "缺少取值"],
      [["a.md", "--format", "--json"], "缺取值时不得把下一个 flag 当值"],
      [["a.md", "--format", "epub"], "取值非法"],
      [["a.md", "--template", "no-such-preset"], "未知预设"],
      [[], "无输入路径"],
      [["a.md", "b.md", "--output", "out.docx"], "--output 配多输入"],
      [["a.md", "--format", "both", "--output", "out.docx"], "--output 配 both"],
    ];
    for (const [argv, label] of usageCases) {
      let thrown = /** @type {unknown} */ (undefined);
      try {
        parseCliArgs(argv);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof CliUsageError, `${label}(${JSON.stringify(argv)})应抛 CliUsageError`);
    }

    // 1e. 展开格式:both → 两个;其余单元素
    assert(expandFormats("both").join(",") === "docx,pdf", "--format both 应展开为两个格式");
    assert(expandFormats("pdf").join(",") === "pdf", "--format pdf 应展开为单元素");

    // 1f. 设置构造:默认路径 + 预设路径
    const plain = resolveCliSettings(parseCliArgs(["a.md"]));
    assert(plain.outputDir === "", "CLI 的 outputDir 恒为空串(输出到源文件旁)");
    assert(plain.afterConvert === "none", "CLI 不触发导出后行为(afterConvert 恒 none)");
    const preset = resolveCliSettings(parseCliArgs(["a.md", "--template", "paper"]));
    const paper = TEMPLATE_PRESETS.find((p) => p.id === "paper");
    assert(paper !== undefined, "内置预设 paper 应存在");
    const expected = presetSettingsPatch(/** @type {NonNullable<typeof paper>} */ (paper));
    assert(
      preset.typography.fontEastAsia === expected.typography?.fontEastAsia &&
        preset.pageSetup.marginLeft === expected.pageSetup?.marginLeft &&
        preset.equationNumbering === expected.equationNumbering,
      "--template 的设置应与 core 的 presetSettingsPatch 逐字一致(共用同一个函数,不是各写一份映射)",
    );

    // 1g. 退出码表单源:CLI options 与 pdf 宿主任务契约用的是同一张表
    assert(exitCodes.ok === 0 && exitCodes.usage === 1, "退出码表前两档应为 0/1");
    assert(exitCodes.inputUnreadable === 2 && exitCodes.convertFailed === 3, "退出码表中间两档应为 2/3");
    assert(exitCodes.outputUnwritable === 4, "输出写不了应为 4");

    // 1h. pdf 任务描述契约:必填字段缺失即抛(不返回半成品)
    // 用 createTempResource/removeTree 而非裸 mkdtemp/rmSync(门禁 check-temp-cleanup:
    // 目录删除一律走助手 —— 裸 rmSync 在 Windows 上「进程刚退出、句柄未释放」时会
    // 直接抛 EBUSY/EPERM,把段判成失败)
    const { path: jobDir } = createTempResource({ label: "cli-job" });
    try {
      const goodJob = path.join(jobDir, "good.json");
      fs.writeFileSync(goodJob, JSON.stringify({ input: "a.md", baseDir: "/tmp", settings: { format: "pdf" } }), "utf8");
      assert(readJob(goodJob).input === "a.md", "完整任务描述应被读出");
      for (const [payload, label] of [
        [{ baseDir: "/tmp", settings: {} }, "缺 input"],
        [{ input: "a.md", settings: {} }, "缺 baseDir"],
        [{ input: "a.md", baseDir: "/tmp" }, "缺 settings"],
        [{ input: "a.md", baseDir: "/tmp", settings: {}, outputPath: 42 }, "outputPath 非字符串"],
      ]) {
        const badJob = path.join(jobDir, "bad.json");
        fs.writeFileSync(badJob, JSON.stringify(payload), "utf8");
        let thrown = /** @type {unknown} */ (undefined);
        try {
          readJob(badJob);
        } catch (error) {
          thrown = error;
        }
        assert(thrown instanceof Error, `任务描述${label}应抛错`);
      }
    } finally {
      removeTree(jobDir);
    }

    // 1i. --help 文案列出全部内置预设(消费方按名取,不靠猜)
    const helpText = usageText();
    for (const preset of TEMPLATE_PRESETS) {
      assert(helpText.includes(preset.id), `--help 应列出预设 ${preset.id}`);
    }
    assert(helpText.includes("--format") && helpText.includes("--json"), "--help 应列出选项清单");
    console.log("[ok] cli:options 纯函数直测通过(参数解析 7 种形态含 -o 短选项 / 9 条用法错 / 设置构造与 core presetSettingsPatch 同源 / 退出码表与 pdf 任务契约单源)");
  }

  // ============ 二、index 经真 node 子进程跑(证明「不需要 Electron」)============
  const { path: dir } = createTempResource({ label: "cli-run" });
  try {
    const src = path.join(dir, "输入.md");
    fs.writeFileSync(src, SAMPLE_MD, "utf8");

    // 2a. 单文件 docx:退出码 0 + 产物真落盘(魔数断言,不只 exists)
    const ok = runCli([src]);
    assert(ok.code === exitCodes.ok, `单文件 docx 应退出 0,实际 ${ok.code}:${ok.stderr}`);
    const produced = ok.stdout.trim().split(/\r?\n/).filter(Boolean);
    assert(produced.length === 1, `非 json 模式 stdout 应一行一个产物路径,实际 ${JSON.stringify(produced)}`);
    const outPath = produced[0] ?? "";
    assert(fs.existsSync(outPath), `产物应落盘:${outPath}`);
    assert(path.basename(outPath) === "输入.docx", `产物名应为源文件同名换扩展名,实际 ${path.basename(outPath)}`);
    assert(isDocxMagic(outPath), "产物魔数应为 ZIP/OOXML(PK\\x03\\x04)");

    // 2b. --json:stdout 是单个可解析数组(诊断在 stderr),且带产物路径/警告 kind/耗时
    const jsonRun = runCli([src, "--json"]);
    assert(jsonRun.code === exitCodes.ok, `--json 成功应退出 0,实际 ${jsonRun.code}`);
    const parsed = JSON.parse(jsonRun.stdout);
    assert(Array.isArray(parsed) && parsed.length === 1, "--json 的 stdout 应是单元素结果数组");
    const item = parsed[0];
    assert(item.ok === true && typeof item.outputPath === "string", "结果项应含 ok 与 outputPath");
    assert(Array.isArray(item.warnings), "结果项应含 warnings 数组(警告 kind)");
    assert(typeof item.elapsedMs === "number", "结果项应含耗时 elapsedMs");
    assert(item.format === "docx", `结果项应记录格式,实际 ${item.format}`);

    // 2c. 退出码 1:用法错(未知 flag),且不产生任何产物
    const usageFail = runCli([src, "--bogus"]);
    assert(usageFail.code === exitCodes.usage, `未知 flag 应退出 1,实际 ${usageFail.code}`);
    assert(usageFail.stderr.includes("[cli]"), "用法错的人读诊断应走 stderr");

    // 2d. 退出码 2:输入读不到(路径不存在)
    const inputFail = runCli([path.join(dir, "不存在.md")]);
    assert(inputFail.code === exitCodes.inputUnreadable, `输入不存在应退出 2,实际 ${inputFail.code}`);

    // 2e. 目录输入递归收集(GUI 同源:collectMarkdownPaths)
    const subDir = path.join(dir, "文稿");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "甲.md"), "# 甲\n\n正文\n", "utf8");
    fs.writeFileSync(path.join(subDir, "乙.markdown"), "# 乙\n\n正文\n", "utf8");
    const dirRun = runCli([subDir, "--json"]);
    assert(dirRun.code === exitCodes.ok, `目录输入应退出 0,实际 ${dirRun.code}:${dirRun.stderr}`);
    const dirItems = JSON.parse(dirRun.stdout);
    assert(dirItems.length === 2, `目录内两个 markdown 应各产一个结果,实际 ${dirItems.length}`);
    for (const entry of dirItems) assert(isDocxMagic(String(entry.outputPath)), "目录展开的产物魔数应正确");

    // 2f. pinOutputPath:显式 --output 逐字落盘
    const pinned = path.join(dir, "指定名.docx");
    const pinRun = runCli([src, "--output", pinned, "--json"]);
    assert(pinRun.code === exitCodes.ok, `--output 应退出 0,实际 ${pinRun.code}:${pinRun.stderr}`);
    assert(fs.existsSync(pinned), `--output 应逐字落盘到指定路径:${pinned}`);
    assert(JSON.parse(pinRun.stdout)[0].outputPath === pinned, "结果项应回报指定的产物路径");

    // 2g. pinOutputPath 的**禁避让**:同一路径再跑一次必须失败(拿不到「指定名 (2).docx」)
    const pinAgain = runCli([src, "--output", pinned, "--json"]);
    assert(pinAgain.code === exitCodes.outputUnwritable, `产物路径已存在应退出 4,实际 ${pinAgain.code}`);
    assert(
      !fs.existsSync(path.join(dir, "指定名 (2).docx")),
      "禁避让语义下不得产出「指定名 (2).docx」(CLI 用户写了名字却拿到另一个文件)",
    );
    assert(fs.statSync(pinned).size > 0, "禁避让失败时既有文件必须原样保留,不得被覆盖或截断");

    // 2h. 退出码 3:转换失败(源文件体积超上限 —— 读前 stat 闸门拦下,真实且确定)
    // 用 truncate 造稀疏文件:stat 读到的是 33MB,磁盘上不占实际空间
    const oversize = path.join(dir, "超大.md");
    fs.writeFileSync(oversize, "# 标题\n", "utf8");
    fs.truncateSync(oversize, 33 * 1024 * 1024);
    const tooBig = runCli([oversize, "--json"]);
    assert(tooBig.code === exitCodes.convertFailed, `体积超上限应退出 3,实际 ${tooBig.code}`);
    const tooBigItems = JSON.parse(tooBig.stdout);
    assert(tooBigItems[0].ok === false && typeof tooBigItems[0].error === "string", "失败项应带错误文案");
    assert(!fs.existsSync(path.join(dir, "超大.docx")), "转换失败时不得留下半成品");

    // 2i. 退出码 4 的第二个形态:输出目录建不出来(--output 指向一个「被文件占住」的路径)
    const blocker = path.join(dir, "占用者");
    fs.writeFileSync(blocker, "我是个文件,不是目录\n", "utf8");
    const blocked = runCli([src, "--output", path.join(blocker, "x.docx"), "--json"]);
    assert(blocked.code === exitCodes.outputUnwritable, `输出目录建不出来应退出 4,实际 ${blocked.code}`);
    assert(
      JSON.parse(blocked.stdout)[0].error.includes("无法创建输出目录"),
      "该失败应给出可操作的错误文案,而不是裸的 fs 错误码",
    );

    console.log("[ok] cli:真 node 子进程跑通(单文件 docx 魔数 / --json 结构化流 / 目录递归收集 / --output 逐字落盘 + 禁避让判 4;退出码 0·1·2·3·4 逐条有夹具)");
  } finally {
    removeTree(dir);
  }
}