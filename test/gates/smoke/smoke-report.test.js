// @ts-check
/**
 * 冒烟报告守护段(门禁层,住 test/gates/smoke/):覆盖「机器可读冒烟报告」
 * (gates/smoke/smoke-report.mjs)这一项发布侧可观测能力,纯 Node 逻辑,
 * 不启 Electron、不碰真实产物:
 *
 * 1. 判定口径不许漂:报告的「通过/失败」必须与既有契约 collectSmokeProblems
 *    (发布侧检查同款)逐条一致,报告只是把结论结构化,不是另立一套标准;
 * 2. 负向必须点名:缺标记 → status=fail 且 missingMarkers 逐条列出 label,
 *    非零退出 / 启动失败 / 超时各自如实记账(不得一律笼统「失败」);
 * 3. 降级可见但不判红:[smoke] pdf 降级(非致命) 记进 degradations 且计数精确,
 *    仍判 pass(与 src/main/smoke.ts「降级只追加留痕行、失败才 throw」一致);
 * 4. 未执行不是通过:前置缺失 → status=not-run + executed=false + 退出码 2,
 *    「本机没装 Electron / 没有产物」不得被读成「冒烟正常」;
 * 5. 产物可复现:报告内不得出现绝对路径或时间戳,同输入两次构造字节相同;
 *    降级标记字面量与 src/main/smoke.ts 编译产物恒等(漂移即判红)。
 *
 * ⚠ **本段是原 `observability` 段的前 5 块**(另一半是打包体积门禁,已搬往
 *   `test/gates/artifacts/pack-size.test.js` —— 两半的判定对象不同,是两个主体:
 *   本段是 smoke-report 门禁,那半是 pack-size 门禁)。块正文与断言逐字节未改,
 *   `[ok] observability:N` 的标签也刻意沿用拆分前的编号(1a/2/3/4/5),
 *   使拆分前后的运行输出可逐行对照。
 *
 * ⚠ **`process.noAsar` 的快照/还原在本段仍然保留**(拆分前它覆盖整段):段跑在
 *   Electron 里,而 Electron 的 fs 补丁把任何 `*.asar` 路径都当包处理 —— 本段的
 *   块 5 会让 smoke-report 去探 `resources/app.asar`,那是一次真实的归档解析路径。
 *   保留它是为了让本段的运行期语义与拆分前逐字相同(不改行为),而不是它在这里必需。
 *   Reflect.set/get 读写是因为 process.noAsar 不在 @types/node 的声明里;
 *   快照声明放在 try 外,finally 才拿得到。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTree } from "../../harness/temp-resource.js";
import {
  buildSmokeReport,
  buildNotRunReport,
  DEGRADATION_TOKENS,
  EXIT as SMOKE_EXIT,
  exitCodeForStatus,
  main as smokeReportMain,
  parseSmokeOutput,
  redactPaths,
  renderSmokeSummary,
  REPORT_STATUS,
  SMOKE_REPORT_SCHEMA,
} from "../../../gates/smoke/smoke-report.mjs";
import { SMOKE_MARKERS, collectSmokeProblems } from "../../../gates/smoke/smoke-proc.mjs";
import { SMOKE_MARKER as IMPLEMENTED_SMOKE_MARKER } from "../../../dist/main/smoke.js";

const SANDBOX_PREFIX = "m2w-observability-";

/**
 * 断言辅助。
 * @param {unknown} cond 条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`observability 断言失败:${msg}`);
}

/**
 * 数组/对象结构相等断言(JSON 口径,失败时两侧都摆出来)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} label 用例标签
 * @returns {void}
 */
function assertDeepEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`observability 断言失败:${label}:实际 ${left},期望 ${right}`);
}

/**
 * 取数组第 i 项并断言存在(noUncheckedIndexedAccess 下避免非空断言)。
 * @template T
 * @param {T[]} items 数组
 * @param {number} i 下标
 * @param {string} label 标签
 * @returns {T} 该项
 */
function at(items, i, label) {
  const item = items[i];
  if (item === undefined) throw new Error(`observability 断言失败:${label}:第 ${i} 项缺失(长度 ${items.length})`);
  return item;
}

/**
 * 冒烟标记行(夹具用):每条标记后跟一段**绝对路径**形态的载荷,顺带验证报告
 * 不把这类内容带进产物(真实运行的输出就是这样:产物路径全在临时目录里)。
 * @param {object} [spec] 缺省哪些标记
 * @param {string[]} [spec.omit] 不输出的标记 token
 * @returns {string} 合并输出形态的文本
 */
function smokeFixtureOutput({ omit = [] } = {}) {
  const payload = "C:\\Users\\tester\\AppData\\Local\\Temp\\m2w-smoke-abc123\\profile\\smoke-basic.docx";
  return SMOKE_MARKERS.filter((marker) => !omit.includes(marker.token))
    .map((marker) => `${marker.token} ${payload} (12345 bytes)`)
    .join("\n");
}

/**
 * 跑被测 CLI 并捕获输出。
 * @param {() => number | Promise<number>} task 任务
 * @returns {Promise<{ code: unknown, output: string }>} 退出码与合并输出
 */
async function captureCli(task) {
  /** @type {string[]} */
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const code = await task();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

/**
 * 报告产物里不得出现的东西:绝对路径(盘符 / POSIX)与日期时间戳。
 * @param {object} report 报告对象
 * @param {string} label 用例标签
 * @returns {void}
 */
function assertNoVolatileFields(report, label) {
  const text = JSON.stringify(report);
  assert(
    !/[A-Za-z]:[\\/]/.test(text),
    `${label}:报告不得含盘符绝对路径,命中 ${JSON.stringify(text.match(/.{0,30}[A-Za-z]:[\\/].{0,30}/)?.[0] ?? "")}`,
  );
  assert(
    !/(?:^|[^/])\/(?:home|Users|tmp|var|usr)\//.test(text),
    `${label}:报告不得含 POSIX 绝对路径,命中 ${JSON.stringify(text.match(/.{0,30}\/(?:home|Users|tmp)\/.{0,30}/)?.[0] ?? "")}`,
  );
  assert(
    !/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && !/"timestamp"|"generatedAt"|"finishedAt"/.test(text),
    `${label}:报告不得含时间戳字段或 ISO 时间`,
  );
  // 沙盒路径本身更不该泄漏(它是本机临时目录)
  assert(
    !text.includes("m2w-observability-"),
    `${label}:报告不得含沙盒目录名(绝对路径泄漏)`,
  );
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /** @type {string[]} */
  const sandboxes = [];
  const track = (/** @type {string} */ dir) => {
    sandboxes.push(dir);
    return dir;
  };
  // 段跑在 Electron 里,而 Electron 的 fs 补丁把任何 *.asar 路径都当包处理(连读都走
  // 归档解析)—— 本段的块 5 会让 smoke-report 去探 `resources/app.asar`,那正落在补丁
  // 覆盖面上。关掉 asar 支持以还原纯 node 的语义,段末 finally 还原。
  // Reflect.set/get 读写是因为 process.noAsar 不在 @types/node 的声明里。
  // 快照声明放在 try 外,finally 才拿得到。
  const previousNoAsar = Reflect.get(process, "noAsar");
  Reflect.set(process, "noAsar", true);

  try {
    // ================= 1. 冒烟报告:正向(判定口径与既有契约一致) =================
    {
      const output = smokeFixtureOutput();
      const report = buildSmokeReport({
        result: { code: 0, signal: null, timedOut: false, output },
        source: "unpacked",
        target: "release/win-unpacked/MarkdownToWord.exe",
      });
      assert(report.schema === SMOKE_REPORT_SCHEMA, `报告 schema 应为 ${SMOKE_REPORT_SCHEMA},实际 ${report.schema}`);
      assert(report.kind === "smoke-report", `报告 kind 应为 smoke-report,实际 ${report.kind}`);
      assert(report.status === REPORT_STATUS.pass, `五条标记 + 退出码 0 应判 pass,实际 ${report.status}`);
      assert(report.executed === true, "跑过了的报告 executed 应为 true");
      assert(report.exitCode === 0, `退出码应原样记账,实际 ${report.exitCode}`);
      assert(report.timedOut === false && report.unterminated === false, "未超时不得记成超时");
      assert(report.spawnError === null, "无启动错误时 spawnError 应为 null");
      assertDeepEqual(
        report.markerContract,
        { expected: 5, present: 5, missing: 0 },
        "标记契约计数",
      );
      assertDeepEqual(report.missingMarkers, [], "无缺失时 missingMarkers 应为空数组");
      assertDeepEqual(
        report.markers.map((marker) => marker.present),
        [true, true, true, true, true],
        "逐条标记 present",
      );
      assertDeepEqual(report.degradations, [], "无降级时 degradations 应为空数组");
      assertDeepEqual(report.problems, [], "通过时 problems 应为空数组");
      // 判定口径单源:同一份输出喂既有判定函数,结论必须一致(报告不是另立标准)
      const legacy = collectSmokeProblems(
        { code: 0, signal: null, timedOut: false, output },
        { label: "unpacked" },
      );
      assert(legacy.length === 0, `沙盒正向输出应同时让既有判定零问题,实际 ${legacy.join("; ")}`);
      console.log("[ok] observability:1a 冒烟报告正向(五条标记 + 退出码 0 → pass,计数/标记/降级/问题四组字段逐条相符)");
    }

    // ================= 2. 冒烟报告:负向(缺标记点名、非零退出、启动失败、超时) =================
    {
      const missingTokens = ["[smoke] renderer diag:", "[smoke] ipc diag:"];
      const output = smokeFixtureOutput({ omit: missingTokens });
      const report = buildSmokeReport({
        result: { code: 0, signal: null, timedOut: false, output },
        source: "unpacked",
      });
      assert(report.status === REPORT_STATUS.fail, "缺标记必须判 fail(不得因退出码 0 就放行)");
      assertDeepEqual(
        report.missingMarkers,
        ["renderer 诊断", "IPC 接线诊断"],
        "缺失标记必须逐条按 label 点名",
      );
      assertDeepEqual(
        report.markerContract,
        { expected: 5, present: 3, missing: 2 },
        "缺标记时的契约计数",
      );
      assert(
        report.markers.filter((marker) => marker.present).length === 3,
        "present 计数应与逐条标记一致",
      );
      const missingProblem = report.problems.find((problem) => problem.includes("输出缺少诊断标记"));
      assert(missingProblem !== undefined, `应产出点名缺失项的问题行,实际 ${JSON.stringify(report.problems)}`);
      assert(
        missingProblem.includes("renderer 诊断、IPC 接线诊断"),
        `问题行须逐条点名缺失 label,实际 ${missingProblem}`,
      );
      // 负向也走既有判定:同一份输出两处都判红
      const legacy = collectSmokeProblems(
        { code: 0, signal: null, timedOut: false, output },
        { label: "unpacked" },
      );
      assert(
        legacy.length > 0 && report.problems.length === legacy.length,
        `报告与既有判定的结论条数应一致,报告 ${report.problems.length} / 既有 ${legacy.length}`,
      );

      // 非零退出:标记齐也判红(退出面独立记账)
      const nonZero = buildSmokeReport({
        result: { code: 1, signal: null, timedOut: false, output: smokeFixtureOutput() },
        source: "unpacked",
      });
      assert(nonZero.status === REPORT_STATUS.fail, "退出码非零必须判 fail");
      assert(nonZero.exitCode === 1, `退出码应记账为 1,实际 ${nonZero.exitCode}`);
      assert(
        nonZero.problems.some((problem) => problem.includes("退出码为 1,期望 0")),
        `非零退出应点名退出码,实际 ${JSON.stringify(nonZero.problems)}`,
      );
      assertDeepEqual(nonZero.missingMarkers, [], "标记齐时不该误报缺失(避免红得没有原因)");

      // 启动失败:code 为 null,原因入库且脱敏
      const spawnFailed = buildSmokeReport({
        result: {
          code: null,
          signal: null,
          timedOut: false,
          output: "",
          spawnError: new Error("spawn C:\\secret\\path\\MarkdownToWord.exe ENOENT"),
        },
        source: "unpacked",
      });
      assert(spawnFailed.status === REPORT_STATUS.fail, "启动失败必须判 fail");
      assert(spawnFailed.exitCode === null, "启动失败时退出码应为 null(不是 0)");
      assert(spawnFailed.spawnError !== null && spawnFailed.spawnError.includes("<abs-path>"), `启动错误应脱敏后入库,实际 ${String(spawnFailed.spawnError)}`);
      assert(
        !String(spawnFailed.spawnError).includes("C:\\secret"),
        "启动错误不得残留绝对路径",
      );

      // 超时:独立字段 + 判红
      const timedOut = buildSmokeReport({
        result: { code: null, signal: "SIGKILL", timedOut: true, unterminated: true, output: smokeFixtureOutput() },
        source: "unpacked",
      });
      assert(timedOut.status === REPORT_STATUS.fail, "超时应判 fail");
      assert(timedOut.timedOut === true && timedOut.unterminated === true, "超时与硬杀后未退出都应记账");
      assert(
        timedOut.problems.some((problem) => problem.includes("超过硬超时未自行退出")),
        `超时应点名超时,实际 ${JSON.stringify(timedOut.problems)}`,
      );
      console.log("[ok] observability:2 冒烟报告负向(缺标记逐条点名 / 非零退出 / 启动失败脱敏 / 超时独立记账)");
    }

    // ================= 3. 降级项:可见、不判红、计数精确 =================
    {
      const token = DEGRADATION_TOKENS[0]?.token ?? "";
      assert(token !== "", "降级标记清单不得为空");
      const once = buildSmokeReport({
        result: {
          code: 0,
          signal: null,
          timedOut: false,
          output: `${smokeFixtureOutput()}\n${token} warn.katexCssLoadFailed ×1 —— 回退到基础公式排版`,
        },
        source: "dev",
      });
      assert(once.status === REPORT_STATUS.pass, `降级属非致命,不应把 pass 打成 fail,实际 ${once.status}`);
      assertDeepEqual(once.missingMarkers, [], "降级不改变标记命中面");
      assertDeepEqual(
        once.degradations,
        [{ id: "pdf-degraded", label: "pdf 降级(非致命)", token, count: 1 }],
        "降级项应带 id/label/token 与出现次数",
      );
      const twice = buildSmokeReport({
        result: {
          code: 0,
          signal: null,
          timedOut: false,
          output: `${smokeFixtureOutput()}\n${token} a\n${token} b`,
        },
        source: "dev",
      });
      assert(
        at(twice.degradations, 0, "降级项").count === 2,
        `两次降级应计 2,实际 ${JSON.stringify(twice.degradations)}`,
      );
      // 摘要里降级必须出现(不可静默),且不出现 [问题] 行
      const summary = renderSmokeSummary(twice, { elapsedMs: 1234 });
      assert(summary.includes("[降级] pdf 降级(非致命) ×2"), `摘要应显式列出降级,实际:\n${summary}`);
      assert(!summary.includes("[问题]"), `降级不判红,摘要不应有 [问题] 行,实际:\n${summary}`);
      assert(summary.includes("耗时 1234ms"), "耗时只打在摘要里(不进产物)");
      // 降级标记字面量与实现恒等(单源守护:实现加/改标记,这里必须跟着红)
      assert(
        IMPLEMENTED_SMOKE_MARKER.pdfDegraded === token,
        `降级标记应与 src/main/smoke.ts 实现恒等,实现 ${IMPLEMENTED_SMOKE_MARKER.pdfDegraded} / 报告 ${token}`,
      );
      console.log("[ok] observability:3 降级项(非致命仍判 pass / 次数精确 / 摘要可见 / 与实现标记恒等)");
    }

    // ================= 4. 未执行 ≠ 通过 =================
    {
      assert(exitCodeForStatus(REPORT_STATUS.pass) === SMOKE_EXIT.pass, "pass 应映射退出码 0");
      assert(exitCodeForStatus(REPORT_STATUS.fail) === SMOKE_EXIT.fail, "fail 应映射退出码 1");
      assert(exitCodeForStatus(REPORT_STATUS.notRun) === SMOKE_EXIT.notRun, "not-run 应映射退出码 2");
      assert(String(SMOKE_EXIT.notRun) !== "0", "未执行的退出码必须非 0(否则 CI 会读成通过)");
      const notRun = buildNotRunReport({
        source: "unpacked",
        reason: "解包目录不存在:release/win-unpacked(请先运行 npm run dist)",
      });
      assert(notRun.status === REPORT_STATUS.notRun, "前置缺失应报 not-run");
      assert(notRun.executed === false, "未执行时 executed 必须为 false");
      assert(notRun.exitCode === null && notRun.spawnError === null, "未执行时不得编造退出码/错误");
      assert(notRun.markerContract === null, "未执行时标记契约应为 null(不是 0/5 的假观测)");
      assertDeepEqual(notRun.markers, [], "未执行时不得输出标记命中表");
      const notRunReason = String(notRun.notRunReason ?? "");
      assert(
        notRunReason.includes("release/win-unpacked") && notRunReason.includes("npm run dist"),
        `未执行原因应给出可操作提示,实际 ${notRunReason}`,
      );
      assert(exitCodeForStatus(notRun.status) === 2, "未执行报告应给出退出码 2");
      // 脱敏单测:绝对路径形态的输入不得原样进报告
      assert(
        redactPaths("读不到 C:\\Users\\t\\AppData\\Local\\Temp\\x", "C:\\repo") === "读不到 <abs-path>",
        `脱敏应把盘符绝对路径换成占位符,实际 ${redactPaths("读不到 C:\\Users\\t\\AppData\\Local\\Temp\\x", "C:\\repo")}`,
      );
      assert(
        redactPaths("读不到 /home/t/x", "/repo") === "读不到 <abs-path>",
        "脱敏应处理 POSIX 绝对路径",
      );
      console.log("[ok] observability:4 未执行档(not-run / executed=false / 退出码 2 / 原因可操作 / 脱敏)");
    }

    // ================= 5. 冒烟报告可复现 + CLI 行为 =================
    {
      const result = { code: 0, signal: null, timedOut: false, output: smokeFixtureOutput() };
      const first = buildSmokeReport({ result, source: "unpacked" });
      const second = buildSmokeReport({ result, source: "unpacked" });
      assert(
        JSON.stringify(first) === JSON.stringify(second),
        "同输入两次构造的报告应字节相同(键序/内容都稳定)",
      );
      assertNoVolatileFields(first, "冒烟报告(夹具输出含绝对路径)");
      assert(
        !JSON.stringify(first).includes("C:\\Users\\tester"),
        "报告不得把输出里的绝对路径带进来",
      );
      // 纯判定原语:present/absent 与缺失清单口径
      const parsed = parseSmokeOutput(smokeFixtureOutput({ omit: ["[smoke] convert ok:"] }));
      assertDeepEqual(parsed.missing, ["docx 转换"], "parseSmokeOutput 的缺失清单");
      assert(parsed.markers.filter((marker) => marker.present).length === 4, "parseSmokeOutput 命中数");
      assertDeepEqual(parseSmokeOutput("").markers.map((marker) => marker.present), [false, false, false, false, false], "空输出全部缺失");

      // CLI:未知选项 / 非法 source → 1;--help → 0
      const help = await captureCli(() => smokeReportMain(["--help"]));
      assert(help.code === SMOKE_EXIT.pass, `--help 应零退出,实际 ${help.code}`);
      assert(help.output.includes("--source"), `--help 应列出 --source:${help.output}`);
      const unknown = await captureCli(() => smokeReportMain(["--nope", "1"]));
      assert(unknown.code === SMOKE_EXIT.fail, `未知选项应退出 1,实际 ${unknown.code}`);
      assert(unknown.output.includes("无法识别的选项"), `未知选项应给出可读诊断:${unknown.output}`);
      const badSource = await captureCli(() => smokeReportMain(["--source", "nope"]));
      assert(badSource.code === SMOKE_EXIT.fail, `非法 --source 应退出 1,实际 ${badSource.code}`);

      // CLI:沙盒无产物 → not-run + 退出码 2 + 写出如实报告(不得写成通过)
      const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const outFile = path.join(sb, "smoke-report.json");
      const emptyUnpacked = path.join(sb, "release", "win-unpacked");
      fs.mkdirSync(emptyUnpacked, { recursive: true });
      const blocked = await captureCli(() =>
        smokeReportMain([
          "--source",
          "unpacked",
          "--unpacked",
          emptyUnpacked,
          "--out",
          outFile,
          "--scratch",
          path.join(sb, "scratch"),
        ]),
      );
      assert(blocked.code === SMOKE_EXIT.notRun, `无产物应退出 ${SMOKE_EXIT.notRun},实际 ${blocked.code}`);
      const written = JSON.parse(fs.readFileSync(outFile, "utf8"));
      assert(written.status === REPORT_STATUS.notRun, `落盘报告状态应为 not-run,实际 ${written.status}`);
      assert(written.executed === false, "落盘报告 executed 必须为 false");
      assert(written.problems.length === 1, "未执行报告应有一条说明");
      assertNoVolatileFields(written, "冒烟报告(沙盒未执行)");
      assert(
        !fs.existsSync(path.join(sb, "scratch")),
        "预检未通过时不得创建一次性 userData 目录",
      );
      console.log("[ok] observability:5 冒烟报告可复现(同输入同字节/无绝对路径无时间戳)+ CLI 三类退出码");
    }
  } finally {
    Reflect.set(process, "noAsar", previousNoAsar);
    for (const dir of sandboxes) {
      // 走 removeTree(退避重试 + 删后复查):沙盒里刚跑过解包/打包子进程,Windows 上
      // 句柄释放有延迟;删不掉仍即抛,不得静默残留在系统临时区
      const outcome = removeTree(dir, { retryDelay: 200 });
      if (!outcome.ok) throw new Error(`沙盒清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
    }
  }
}
