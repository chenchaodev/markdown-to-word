// @ts-check
/**
 * 可观测性守护段(跨域守护,住 test/segments/):覆盖两项「让 CI 能结构化消费 / 能
 * 定量拦住」的发布侧可观测能力,纯 Node 逻辑,不启 Electron、不碰真实产物:
 *
 * 1. 机器可读冒烟报告(scripts/smoke-report.mjs)
 *    - 判定口径不许漂:报告的「通过/失败」必须与既有契约 collectSmokeProblems
 *      (发布侧检查同款)逐条一致,报告只是把结论结构化,不是另立一套标准;
 *    - 负向必须点名:缺标记 → status=fail 且 missingMarkers 逐条列出 label,
 *      非零退出 / 启动失败 / 超时各自如实记账(不得一律笼统「失败」);
 *    - 降级可见但不判红:[smoke] pdf 降级(非致命) 记进 degradations 且计数精确,
 *      仍判 pass(与 src/main/smoke.ts「降级只追加留痕行、失败才 throw」一致);
 *    - 未执行不是通过:前置缺失 → status=not-run + executed=false + 退出码 2,
 *      「本机没装 Electron / 没有产物」不得被读成「冒烟正常」;
 *    - 产物可复现:报告内不得出现绝对路径或时间戳,同输入两次构造字节相同;
 *      降级标记字面量与 src/main/smoke.ts 编译产物恒等(漂移即判红)。
 *
 * 2. 打包体积实测与回归门禁(scripts/pack-size.mjs + scripts/pack-size.baseline.json)
 *    - 正向:沙盒 release 布局(合成 asar,按真实 asar 头部格式手写)实测出的字节与
 *      基线逐条相等 → pass,各字段数值精确;
 *    - 负向逐条命中:单项超阈值(点名是哪个子项 + 容许增长字节数)、异常缩小、
 *      必需子项缺失、包内多份 katex 副本(阈值无关,直接判红)、
 *      @types/katex 不得被当成运行期副本(否则每次误报);
 *    - 无产物 → unmeasured + 退出码 2(不得当成「体积正常」);基线缺失/不合规 → 判红;
 *    - 基线不做自动重生成(脚本不提供 --write/--update 入口,断言其被拒);
 *    - 产物可复现:同输入两次实测报告字节相同,且不含绝对路径/时间戳。
 *
 * 真实产物的复跑只做「能不能测到」的自检(不钉死体积数值,也不钉死副本数 ——
 * 副本数是待收敛的事实,钉死会让修复它的改动先红在本段)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../common/paths.js";
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
} from "../../scripts/smoke-report.mjs";
import {
  BASELINE_SCHEMA,
  buildReport as buildPackSizeReport,
  EXIT as PACK_EXIT,
  evaluate,
  findPackageCopies,
  main as packSizeMain,
  measure,
  MEASURED_ITEMS,
  parseBaseline,
  renderSummary as renderPackSizeSummary,
  readAsarTree,
  satisfiesRange,
  STATUS,
} from "../../scripts/pack-size.mjs";
import { SMOKE_MARKERS, collectSmokeProblems } from "../../scripts/smoke-proc.mjs";
import { SMOKE_MARKER as IMPLEMENTED_SMOKE_MARKER } from "../../dist/main/smoke.js";

/** 沙盒临时目录名前缀(与其它段的 m2w-* 区分,便于识别残留) */
const SANDBOX_PREFIX = "m2w-observability-";
/** 沙盒内合成的安装包文件名(命中 installer 匹配式) */
const SANDBOX_INSTALLER = "MarkdownToWord-Setup-9.9.9.exe";
/** 沙盒内合成的应用可执行文件名(与 package.json build.productName 同名) */
const SANDBOX_EXE = "MarkdownToWord.exe";
/** asar 头按 4 字节对齐(与 @electron/asar 写出口径一致,故合成包可被真实解析器读) */
const ASAR_ALIGN = 4;

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
 * 从「id → 字节」映射取值并断言存在(沙盒基线构造用,避免散落非空断言)。
 * @param {Record<string, number>} map 映射
 * @param {string} id 键
 * @param {string} label 标签
 * @returns {number} 该键的数值
 */
function num(map, id, label) {
  const value = map[id];
  if (typeof value !== "number") throw new Error(`observability 断言失败:${label}:映射缺 ${id}`);
  return value;
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
 * 合成一个真实格式的 app.asar(头部 pickle + 目录树 JSON + 载荷),字节口径与
 * electron-builder 产物一致:文件字节 = 16 + JSON(4 字节对齐)+ 载荷。
 * 沙盒用它当「产物」,门禁读的是真解析路径,不是桩函数。
 *
 * 文件内容两种写法:数字 = 该字节数的填充载荷(只关心体积的条目);
 * 字符串 = 逐字节真实内容(package.json 必须这样,判重要读它的 name/version/依赖声明)。
 * @param {string} target 落点绝对路径
 * @param {Record<string, number | string>} flatFiles 相对路径 → 字节数或内容
 * @returns {{ path: string, fileBytes: number, payloadBytes: number, headerBytes: number }} 合成结果
 */
function writeSyntheticAsar(target, flatFiles) {
  /** @type {Record<string, unknown>} */
  const root = { files: {} };
  /** @type {Buffer[]} */
  const payloadParts = [];
  let payloadBytes = 0;
  for (const rel of Object.keys(flatFiles).sort()) {
    const value = flatFiles[rel];
    const content = typeof value === "number" ? null : Buffer.from(/** @type {string} */ (value), "utf8");
    const size = content === null ? /** @type {number} */ (value) : content.length;
    const segments = rel.split("/");
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = /** @type {string} */ (segments[i]);
      const files = /** @type {{ files: Record<string, unknown> }} */ (node).files;
      if (files[key] === undefined) files[key] = { files: {} };
      node = /** @type {{ files: Record<string, unknown> }} */ (files[key]);
    }
    const leaf = /** @type {string} */ (segments[segments.length - 1]);
    /** @type {{ files: Record<string, unknown> }} */ (node).files[leaf] = {
      size,
      offset: String(payloadBytes),
    };
    payloadBytes += size;
    payloadParts.push(content ?? Buffer.alloc(size, 0x61));
  }
  const json = JSON.stringify(root);
  const padded = json + " ".repeat((ASAR_ALIGN - (json.length % ASAR_ALIGN)) % ASAR_ALIGN);
  // 头部两层 pickle(与 @electron/asar 写出口径一致):
  // [外层载荷=4][内层 pickle 长度][内层载荷=内层长度-4][JSON 长度][JSON…]
  const headerPickleSize = 8 + padded.length;
  const header = Buffer.alloc(16 + padded.length);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(headerPickleSize, 4);
  header.writeUInt32LE(headerPickleSize - 4, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write(padded, 16, "utf8");
  const fileBytes = 16 + padded.length + payloadBytes;
  const buffer = Buffer.concat([header, ...payloadParts]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return { path: target, fileBytes, payloadBytes, headerBytes: 16 + padded.length };
}

/**
 * 沙盒 release 布局:解包目录 + 应用 exe + 一个 pak(让「解包目录合计」不止 exe+asar)
 * + 安装包。asar 内容由 asarFiles 决定。
 * @param {object} spec 沙盒规格
 * @param {string} spec.root 沙盒根(本函数在其下建 release/)
 * @param {Record<string, number | string>} spec.asarFiles asar 内文件 → 字节数或内容
 * @returns {{ releaseDir: string, unpackedDir: string, asarPath: string, exePath: string, installerPath: string, exeBytes: number, installerBytes: number, pakBytes: number, asar: { fileBytes: number, payloadBytes: number, headerBytes: number } }} 路径与字节
 */
function createReleaseSandbox({ root, asarFiles }) {
  const releaseDir = path.join(root, "release");
  const unpackedDir = path.join(releaseDir, "win-unpacked");
  const exeBytes = 2 * 1024 * 1024;
  const installerBytes = 3 * 1024 * 1024;
  const pakBytes = 700 * 1024;
  fs.mkdirSync(unpackedDir, { recursive: true });
  const exePath = path.join(unpackedDir, SANDBOX_EXE);
  const installerPath = path.join(releaseDir, SANDBOX_INSTALLER);
  fs.writeFileSync(exePath, Buffer.alloc(exeBytes, 0x65));
  fs.writeFileSync(installerPath, Buffer.alloc(installerBytes, 0x73));
  fs.writeFileSync(path.join(unpackedDir, "zh-CN.pak"), Buffer.alloc(pakBytes, 0x70));
  const asar = writeSyntheticAsar(path.join(unpackedDir, "resources", "app.asar"), asarFiles);
  return {
    releaseDir,
    unpackedDir,
    asarPath: asar.path,
    exePath,
    installerPath,
    exeBytes,
    installerBytes,
    pakBytes,
    asar,
  };
}

/**
 * 沙盒用的 package.json 内容(判重规则要读 name/version/依赖声明,故必须逐字节真实)。
 * @param {string} name 包名
 * @param {string} version 版本
 * @param {Record<string, string>} [deps] dependencies 声明
 * @returns {string} JSON 文本
 */
function manifest(name, version, deps = {}) {
  return JSON.stringify({ name, version, dependencies: deps });
}

/** 真实版本号(与本仓依赖实测一致:项目用 0.18.x,mermaid/micromark-extension-math 用 0.16.x) */
const KATEX_PROJECT_VERSION = "0.18.1";
const KATEX_MERMAID_VERSION = "0.16.47";

/**
 * 一份 katex 副本的文件集(prefix 为其包根,如 node_modules/mermaid/node_modules/katex)。
 * 非 package.json 的条目刻意**跨版本同大小**:0.16 与 0.18 之间这些文件同名同大小但
 * 内容不同,正是「不可回收」记账的考据(上一轮误按同名同大小记成 3.46 MiB 冗余)。
 * @param {string} prefix 包根前缀
 * @param {string} version 版本
 * @returns {Record<string, number | string>} 文件集
 */
function katexCopyFiles(prefix, version) {
  return {
    [`${prefix}/package.json`]: manifest("katex", version, { commander: "^8.3.0" }),
    [`${prefix}/dist/katex.min.css`]: 22_000,
    [`${prefix}/dist/katex.min.js`]: 260_000,
    [`${prefix}/dist/fonts/KaTeX_Main-Regular.woff2`]: 16_000,
    [`${prefix}/dist/fonts/KaTeX_Math-Italic.woff2`]: 12_000,
  };
}

/** 沙盒 asar 内容:一份自研 dist + 一份 KaTeX(含字体)+ Mermaid + 若干 node_modules(单副本基线) */
function sandboxAsarFiles() {
  return {
    "package.json": manifest("markdown-to-word", "9.9.9", { katex: `^${KATEX_PROJECT_VERSION}` }),
    "dist/main/index.js": 200_000,
    "dist/core/render.js": 300_000,
    "dist/renderer/index.html": 40_000,
    "node_modules/docx/index.js": 900_000,
    ...katexCopyFiles("node_modules/katex", KATEX_PROJECT_VERSION),
    "node_modules/mermaid/package.json": manifest("mermaid", "11.16.1"),
    "node_modules/mermaid/dist/mermaid.min.mjs": 1_800_000,
  };
}

/**
 * 沙盒基线文档:以实测值为基线(除刻意改写的条目)。
 * @param {Record<string, number>} measured 实测字节
 * @param {Record<string, number>} [overrides] 覆盖某些条目的基线值
 * @param {object} [thresholds] 阈值覆盖
 * @returns {object} 基线文档
 */
function baselineDoc(measured, overrides = {}, thresholds = {}) {
  /** @type {Record<string, number>} */
  const items = {};
  for (const spec of MEASURED_ITEMS) {
    const value = measured[spec.id];
    if (typeof value === "number") items[spec.id] = value;
  }
  Object.assign(items, overrides);
  return {
    baselineSchema: BASELINE_SCHEMA,
    // 判重门禁名单是数据不是代码常量(与体积数字同处基线,便于人工 review 与扩充)
    duplicateWatch: ["katex"],
    thresholds: {
      maxRelativeGrowth: 0.2,
      maxShrinkRatio: 0.5,
      minGrowthBytes: 64 * 1024 * 1024,
      ...thresholds,
    },
    items,
  };
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

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /** @type {string[]} */
  const sandboxes = [];
  const track = (/** @type {string} */ dir) => {
    sandboxes.push(dir);
    return dir;
  };
  // 下面所有体积沙盒都要读写名为 `app.asar` 的文件,而段跑在 Electron 里:Electron 的
  // fs 补丁把任何 *.asar 路径都当包处理(实测 writeFileSync / openSync+writeSync /
  // rename / copyFile 四种写法一律抛 Invalid package,连读也走归档解析),故体积部分
  // 期间临时关掉 asar 支持以还原纯 node 的字节语义(被测脚本本来就是 node 脚本,node 下
  // 没有这层补丁),段末 finally 还原。Reflect.set/get 读写是因为 process.noAsar 不在
  // @types/node 的声明里。快照声明放在 try 外,finally 才拿得到。
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

    // ================= 6. 体积实测:正向沙盒(字段与数值精确) =================
    {
      const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const box = createReleaseSandbox({ root: sb, asarFiles: sandboxAsarFiles() });
      const measured = measure({ unpackedDir: box.unpackedDir, releaseDir: box.releaseDir });
      assert(measured.ok, `沙盒产物应可实测:${measured.ok ? "" : measured.reason}`);
      const items = measured.measurement.items;
      // 逐项核对数值来源:app.asar = 文件字节,解包 exe = 2MiB,合计 = exe+asar+pak
      assert(items.appAsar?.bytes === box.asar.fileBytes, `app.asar 应为文件字节 ${box.asar.fileBytes},实际 ${String(items.appAsar?.bytes)}`);
      assert(items.unpackedExe?.bytes === box.exeBytes, `解包 exe 应为 ${box.exeBytes},实际 ${String(items.unpackedExe?.bytes)}`);
      assert(items.installer?.bytes === box.installerBytes, `安装包应为 ${box.installerBytes},实际 ${String(items.installer?.bytes)}`);
      assert(
        items.unpackedTotal?.bytes === box.exeBytes + box.pakBytes + box.asar.fileBytes,
        `解包目录合计应为 exe+pak+asar,实际 ${String(items.unpackedTotal?.bytes)}`,
      );
      // package.json 现在是真实内容(判重要读它),故按内容长度核算,不用魔法数
      const katexManifestBytes = Buffer.byteLength(
        manifest("katex", KATEX_PROJECT_VERSION, { commander: "^8.3.0" }),
        "utf8",
      );
      assert(items.asarKatexFonts?.bytes === 28_000, `KaTeX 字体应为 16000+12000,实际 ${String(items.asarKatexFonts?.bytes)}`);
      assert(
        items.asarKatex?.bytes === katexManifestBytes + 22_000 + 260_000 + 28_000,
        `KaTeX 资源应为 pkg(${katexManifestBytes})+css+js+字体,实际 ${String(items.asarKatex?.bytes)}`,
      );
      const mermaidManifestBytes = Buffer.byteLength(manifest("mermaid", "11.16.1"), "utf8");
      assert(
        items.asarMermaid?.bytes === mermaidManifestBytes + 1_800_000,
        `Mermaid 应为 pkg(${mermaidManifestBytes})+dist,实际 ${String(items.asarMermaid?.bytes)}`,
      );
      assert(
        /** @type {{ headerBytes: number, entryCount: number, unpackedEntryBytes: number }} */ (
          /** @type {unknown} */ (measured.measurement.asar)
        ).headerBytes === box.asar.headerBytes,
        "asar 头字节应与合成包一致",
      );
      // asar 头部真解析(不是桩):包内条目能按路径取到
      const tree = readAsarTree(box.asarPath);
      assert(tree.ok, "合成 asar 应能被真实头部解析器读出");
      assert(
        tree.entries.has("node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2"),
        "asar 目录树应能按路径下探到字体文件",
      );
      assert(
        tree.entries.get("node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2")?.size === 16_000,
        "条目 size 应原样读出",
      );

      // 基线 = 实测值 → 全项 ok、pass
      /** @type {Record<string, number>} */
      const measuredMap = {};
      for (const spec of MEASURED_ITEMS) {
        const value = items[spec.id]?.bytes;
        if (typeof value === "number") measuredMap[spec.id] = value;
      }
      const verdict = evaluate(measured.measurement, parseBaseline(baselineDoc(measuredMap)));
      assert(verdict.status === STATUS.pass, `基线等于实测时应通过,实际 ${verdict.status}:${verdict.problems.join("; ")}`);
      assert(
        verdict.rows.every((row) => row.verdict === "ok"),
        `全项应为 ok,实际 ${JSON.stringify(verdict.rows.map((row) => [row.id, row.verdict]))}`,
      );
      const appAsarRow = verdict.rows.find((row) => row.id === "appAsar");
      assert(appAsarRow?.deltaBytes === 0, `等值基线差值应为 0,实际 ${String(appAsarRow?.deltaBytes)}`);
      assert(
        appAsarRow?.allowedGrowthBytes === Math.max(Math.floor(0.2 * box.asar.fileBytes), 64 * 1024 * 1024),
        "容许增长应为 max(基线×20%, 64MiB)",
      );
      assert(
        measured.measurement.asar.headerBytes === box.asar.headerBytes,
        "asar 头字节应与合成包一致",
      );
      const baseline = parseBaseline(baselineDoc(measuredMap));
      const report = buildPackSizeReport({
        measurement: measured.measurement,
        unmeasuredReason: null,
        verdict,
        baseline,
      });
      assert(report.status === STATUS.pass && report.measured === true, "报告应记 pass/measured=true");
      assertNoVolatileFields(report, "体积报告(沙盒正向)");
      const summary = renderPackSizeSummary(report);
      assert(summary.includes("[pack-size] 状态 pass"), `摘要应给出通过结论:${summary}`);
      assert(summary.includes("app.asar(appAsar)"), "摘要应逐项列出(含 id)");
      assert(report.duplicates?.findings.length === 0, "沙盒正向只有一份 katex 副本,不应产生判重结论");
      // 沙盒里只有三个真实 manifest(项目自身 / katex / mermaid;docx 只放了一个 index.js,
      // 故意不给 manifest,顺带证明「没有 package.json 的目录不被当成包根」)
      assert(report.duplicates?.packagesAnalyzed === 3, `应统计到 3 个包根,实际 ${String(report.duplicates?.packagesAnalyzed)}`);
      // 判重原语:最小 semver 范围判定(覆盖依赖声明里实际出现的形态)
      assert(satisfiesRange("0.16.47", "^0.16.45") === true, "0.16.47 应满足 ^0.16.45");
      assert(satisfiesRange("0.18.1", "^0.16.45") === false, "0.18.1 不应满足 ^0.16.45");
      assert(satisfiesRange("0.18.1", "^0.18.1") === true, "0.18.1 应满足 ^0.18.1");
      assert(satisfiesRange("2.12.1", "1 - 2") === true, "2.12.1 应满足连字符范围 1 - 2");
      assert(satisfiesRange("3.2.4", "1 - 2") === false, "3.2.4 不应满足 1 - 2");
      assert(satisfiesRange("8.3.0", ">=8.0.0 <9.0.0") === true, "空格并列范围应按 AND 判定");
      assert(satisfiesRange("9.0.0", ">=8.0.0 <9.0.0") === false, "空格并列范围上界应生效");
      assert(satisfiesRange("1.2.3", "^1.0.0 || ^2.0.0") === true, "|| 应按 OR 判定");
      assert(satisfiesRange("0.6.3", "0.6") === true, "缺省段 0.6 应覆盖 0.6.x");
      assert(satisfiesRange("0.7.3", "0.6") === false, "缺省段 0.6 不应覆盖 0.7.x");
      assert(satisfiesRange("1.0.0-rc.1", "^1.0.0") === null, "预发布版本应判不了(null)而非猜");
      assert(satisfiesRange("1.0.0", "workspace:*") === null, "非 semver 范围应判不了(null)而非抛错");
      console.log("[ok] observability:6a 体积实测正向(10 项字节逐项核对 + asar 头真解析 + 基线等值 → pass;单副本不产生判重结论)");
    }

    // ================= 7. 体积门禁负向:超阈值 / 异常缩小 / 必需子项缺失 =================
    {
      const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const box = createReleaseSandbox({ root: sb, asarFiles: sandboxAsarFiles() });
      const measured = measure({ unpackedDir: box.unpackedDir, releaseDir: box.releaseDir });
      assert(measured.ok, "沙盒产物应可实测");
      /** @type {Record<string, number>} */
      const measuredMap = {};
      for (const spec of MEASURED_ITEMS) {
        const value = measured.measurement.items[spec.id]?.bytes;
        if (typeof value === "number") measuredMap[spec.id] = value;
      }

      // 7a 超阈值:点名是哪个子项 + 容许增长字节数取 max(相对, 绝对)
      const tiny = parseBaseline(
        baselineDoc(measuredMap, { asarNodeModules: 1000 }, { minGrowthBytes: 1, maxRelativeGrowth: 0.2 }),
      );
      const overVerdict = evaluate(measured.measurement, tiny);
      assert(overVerdict.status === STATUS.fail, "子项超阈值应判红");
      const overRow = overVerdict.rows.find((row) => row.id === "asarNodeModules");
      assert(overRow?.verdict === "over", `asarNodeModules 应判 over,实际 ${overRow?.verdict}`);
      assert(overRow?.allowedGrowthBytes === 200, `容许增长应为 1000×0.2=200,实际 ${String(overRow?.allowedGrowthBytes)}`);
      const overProblem = overVerdict.problems.find((problem) => problem.includes("asarNodeModules"));
      assert(overProblem !== undefined, "超阈值问题行应点名条目 id");
      assert(
        overProblem.includes("asar 内 node_modules(asarNodeModules)体积超阈值:1000 →"),
        `问题行应含条目名与基线→实测,实际 ${overProblem}`,
      );
      // 未越界的条目不得被连坐
      assert(
        overVerdict.rows.filter((row) => row.verdict === "over").length === 1,
        `只应有 1 项越界,实际 ${JSON.stringify(overVerdict.rows.filter((row) => row.verdict === "over").map((row) => row.id))}`,
      );

      // 7b 刚好在容许范围内(取 max 闸的宽者:绝对闸比相对闸宽时不判红)
      const withinAbsolute = parseBaseline(
        baselineDoc(measuredMap, { appAsar: Math.floor(num(measuredMap, "appAsar", "7b") / 1.2) }),
      );
      const withinVerdict = evaluate(measured.measurement, withinAbsolute);
      const withinRow = withinVerdict.rows.find((row) => row.id === "appAsar");
      assert(
        withinRow?.verdict === "ok",
        `增长 20% 但未越过 64MiB 绝对闸时不得判红(宁可漏报),实际 ${withinRow?.verdict}(+${String(withinRow?.deltaBytes)} 字节,容许 ${String(withinRow?.allowedGrowthBytes)})`,
      );

      // 7c 异常缩小(多半是资源没进包)
      const shrink = parseBaseline(
        baselineDoc(measuredMap, { asarKatexFonts: 10 * num(measuredMap, "asarKatexFonts", "7c") }),
      );
      const shrinkVerdict = evaluate(measured.measurement, shrink);
      const shrinkRow = shrinkVerdict.rows.find((row) => row.id === "asarKatexFonts");
      assert(shrinkRow?.verdict === "under", `缩到基线 10% 应判 under,实际 ${shrinkRow?.verdict}`);
      assert(
        shrinkVerdict.problems.some((problem) => problem.includes("体积异常缩小") && problem.includes("asarKatexFonts")),
        `缩小问题行应点名条目,实际 ${JSON.stringify(shrinkVerdict.problems)}`,
      );

      // 7d 必需子项缺失(资源没进包)判红;非必需条目(安装包)缺失只告警
      const sb2 = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const full = sandboxAsarFiles();
      const asarFiles = { ...full };
      // 删掉整个 KaTeX 字体目录(两个字体文件),模拟「资源没进包」
      Reflect.deleteProperty(asarFiles, "node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2");
      Reflect.deleteProperty(asarFiles, "node_modules/katex/dist/fonts/KaTeX_Math-Italic.woff2");
      const box2 = createReleaseSandbox({ root: sb2, asarFiles });
      fs.rmSync(box2.installerPath);
      const measured2 = measure({ unpackedDir: box2.unpackedDir, releaseDir: box2.releaseDir });
      assert(measured2.ok, "无安装包的沙盒仍应可实测(便携形态)");
      /** @type {Record<string, number>} */
      const map2 = {};
      for (const spec of MEASURED_ITEMS) {
        const value = measured2.measurement.items[spec.id]?.bytes;
        if (typeof value === "number") map2[spec.id] = value;
      }
      const missingVerdict = evaluate(measured2.measurement, parseBaseline(baselineDoc(map2)));
      const fontRow = missingVerdict.rows.find((row) => row.id === "asarKatexFonts");
      assert(fontRow?.verdict === "missing", `必需子项缺失应判 missing,实际 ${fontRow?.verdict}`);
      assert(fontRow?.present === false && fontRow?.bytes === null, "缺失条目的字节应为 null(不填 0 冒充实测)");
      const installerRow = missingVerdict.rows.find((row) => row.id === "installer");
      assert(
        installerRow?.verdict === "missing" && missingVerdict.warnings.some((w) => w.includes("installer")),
        `非必需条目缺失只告警,实际 verdict=${installerRow?.verdict} warnings=${JSON.stringify(missingVerdict.warnings)}`,
      );
      assert(
        missingVerdict.problems.some((problem) => problem.includes("asarKatexFonts") && problem.includes("在产物中不存在")),
        `必需子项缺失应判红并点名,实际 ${JSON.stringify(missingVerdict.problems)}`,
      );

      // 7e 基线未登记的条目只告警(不误红)
      const partial = parseBaseline({
        baselineSchema: BASELINE_SCHEMA,
        duplicateWatch: ["katex"],
        thresholds: {},
        items: { appAsar: num(measuredMap, "appAsar", "7e") },
      });
      const partialVerdict = evaluate(measured.measurement, partial);
      assert(
        partialVerdict.status === STATUS.pass,
        `基线只登记 1 项时其余项不应判红,实际 ${partialVerdict.status}:${partialVerdict.problems.join("; ")}`,
      );
      assert(
        partialVerdict.warnings.some((warning) => warning.includes("基线未登记")),
        `未登记条目应告警,实际 ${JSON.stringify(partialVerdict.warnings)}`,
      );
      console.log("[ok] observability:7 体积门禁负向(超阈值点名/绝对闸宽者不误报/异常缩小/必需子项缺失/非必需仅告警/未登记仅告警)");
    }

    // ================= 8. 判重规则:按「包名 + 版本 + 声明来源」而非按路径 =================
    //
    // 上一轮把「同一路径形态出现多份 katex」一律判红是错的:npm 按 semver 正确并存两套
    // 版本范围时也会出现多份,那是合法并存而非误打包。规则改为:
    //   真缺陷(红,不受体积阈值约束)= ①某副本版本不满足其引用方声明的范围(semver 违规)
    //     ②同包名同版本且祖先位置已有同版本(可提升位置的冗余嵌套)
    //     ③整份副本可去��:它的全部引用方都被另一份同包名副本满足(本可统一版本)
    //   合法并存(信息)= 同包名不同版本且各引用方声明范围互不重叠;
    //     同版本但分处兄弟分支、当前树形下无法提升位置 → 也只报信息。
    // 字节记账:可回收只算「可避免的同包名同版本副本」;跨版本同名同大小文件**不计入**
    // 任何可回收口径(0.16 与 0.18 之间那些文件同名同大小但内容不同,不是冗余)。
    {
      /** @type {(asarFiles: Record<string, number | string>) => { sb: string, box: ReturnType<typeof createReleaseSandbox>, measurement: import("../../scripts/pack-size.mjs").PackSizeMeasurement, verdict: import("../../scripts/pack-size.mjs").PackSizeVerdict, report: import("../../scripts/pack-size.mjs").PackSizeReport }} */
      const gate = (asarFiles) => {
        const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
        const box = createReleaseSandbox({ root: sb, asarFiles });
        const measured = measure({ unpackedDir: box.unpackedDir, releaseDir: box.releaseDir });
        assert(measured.ok, "判重沙盒应可实测");
        /** @type {Record<string, number>} */
        const measuredMap = {};
        for (const spec of MEASURED_ITEMS) {
          const value = measured.measurement.items[spec.id]?.bytes;
          if (typeof value === "number") measuredMap[spec.id] = value;
        }
        const baseline = parseBaseline(baselineDoc(measuredMap));
        const verdict = evaluate(measured.measurement, baseline);
        const report = buildPackSizeReport({
          measurement: measured.measurement,
          unmeasuredReason: null,
          verdict,
          baseline,
        });
        return { sb, box, measurement: measured.measurement, verdict, report };
      };
      /**
       * 取某个包名的判重结论。
       * @param {import("../../scripts/pack-size.mjs").PackSizeReport} report 报告
       * @param {string} name 包名
       * @returns {import("../../scripts/pack-size.mjs").PackSizeDuplicateFinding} 该包名的结论
       */
      const findingOf = (report, name) => {
        const finding = report.duplicates?.findings.find((item) => item.name === name);
        if (finding === undefined) {
          throw new Error(
            `observability 断言失败:报告里应有 ${name} 的判重结论,实际 ${JSON.stringify(report.duplicates?.findings.map((item) => item.name))}`,
          );
        }
        return finding;
      };

      // 8a 真缺陷之一:同包名**同版本**两处,且祖先位置已有同版本 → 判红 + 冗余字节按该版本计
      //     (顶层 0.18.1 + mermaid 嵌套 0.18.1;mermaid 声明 ^0.18.0,被满足 ⇒ 嵌套那份纯属冗余)
      {
        const result = gate({
          ...sandboxAsarFiles(),
          "node_modules/mermaid/package.json": manifest("mermaid", "11.16.1", { katex: "^0.18.0" }),
          ...katexCopyFiles("node_modules/mermaid/node_modules/katex", KATEX_PROJECT_VERSION),
        });
        const finding = findingOf(result.report, "katex");
        assert(finding.classification === "redundant-same-version", `同版本冗余嵌套应判 redundant-same-version,实际 ${finding.classification}`);
        assert(finding.red === true, "同包名同版本多副本是真缺陷,必须判红");
        assert(
          result.verdict.status === STATUS.fail && result.report.status === STATUS.fail,
          `同版本冗余必须让门禁判红,实际 ${result.verdict.status}`,
        );
        assert(
          result.verdict.rows.every((row) => row.verdict === "ok"),
          `体积项应全 ok(证明红因不是体积阈值),实际 ${JSON.stringify(result.verdict.rows.map((row) => [row.id, row.verdict]))}`,
        );
        const nested = finding.copies.find((copy) => copy.path === "node_modules/mermaid/node_modules/katex");
        const top = finding.copies.find((copy) => copy.path === "node_modules/katex");
        assert(nested !== undefined && top !== undefined, "两份副本都应在结论里");
        assert(
          finding.reclaimableBytes === nested.bytes,
          `可回收字节应等于那份多余副本的字节 ${nested.bytes},实际 ${finding.reclaimableBytes}`,
        );
        assert(finding.unavoidableBytes === 0, `同版本冗余属可回收,不应记进不可回收,实际 ${finding.unavoidableBytes}`);
        const problem = result.verdict.problems.find((line) => line.includes("katex"));
        assert(problem !== undefined, "应产出点名 katex 的问题行");
        assert(
          problem.includes("不受体积阈值约束") &&
            problem.includes("node_modules/mermaid/node_modules/katex") &&
            problem.includes(`0.18.1`),
          `问题行应说明阈值无关、点名冗余副本路径与版本,实际 ${problem}`,
        );
        console.log("[ok] observability:8a 同包名同版本两处 → 判红(可回收字节 = 多余那份的字节,体积项全 ok)");
      }

      // 8b 合法并存:本仓库真实 katex 场景(真实版本号与真实声明来源)→ 不判红
      {
        const result = gate({
          ...sandboxAsarFiles(),
          "node_modules/@mdit/plugin-katex/package.json": manifest("@mdit/plugin-katex", "1.0.2", {
            katex: `^${KATEX_PROJECT_VERSION}`,
          }),
          "node_modules/mermaid/package.json": manifest("mermaid", "11.16.1", { katex: "^0.16.45" }),
          "node_modules/micromark-extension-math/package.json": manifest("micromark-extension-math", "3.1.0", {
            katex: "^0.16.0",
          }),
          ...katexCopyFiles("node_modules/mermaid/node_modules/katex", KATEX_MERMAID_VERSION),
          ...katexCopyFiles("node_modules/micromark-extension-math/node_modules/katex", KATEX_MERMAID_VERSION),
        });
        const finding = findingOf(result.report, "katex");
        assert(
          finding.classification === "parallel-versions",
          `semver 强制并存的场景应判 parallel-versions,实际 ${finding.classification}`,
        );
        assert(finding.red === false, "同包名不同版本且声明范围互不重叠 = 合法并存,不得判红");
        assert(
          result.verdict.status === STATUS.pass && result.report.status === STATUS.pass,
          `合法并存不得让门禁判红,实际 ${result.verdict.status}:${result.verdict.problems.join("; ")}`,
        );
        assert(
          finding.reclaimableBytes === 0,
          `版本互斥的并存没有可回收字节,实际 ${finding.reclaimableBytes}`,
        );
        // 版本与「谁要求哪个范围」都要摆出来,复核者一眼能看出是 semver 要求的并存
        assertDeepEqual(
          finding.copies.map((copy) => `${copy.path}@${copy.version}`),
          [
            `node_modules/katex@${KATEX_PROJECT_VERSION}`,
            `node_modules/mermaid/node_modules/katex@${KATEX_MERMAID_VERSION}`,
            `node_modules/micromark-extension-math/node_modules/katex@${KATEX_MERMAID_VERSION}`,
          ],
          "三份副本的路径与版本",
        );
        const declared = finding.declarations
          .map((decl) => `${decl.requirer}[${decl.field}]=${decl.range}→${String(decl.resolvedTo)}`)
          .sort();
        assertDeepEqual(
          declared,
          [
            `node_modules/@mdit/plugin-katex[dependencies]=^${KATEX_PROJECT_VERSION}→node_modules/katex`,
            `node_modules/mermaid[dependencies]=^0.16.45→node_modules/mermaid/node_modules/katex`,
            `node_modules/micromark-extension-math[dependencies]=^0.16.0→node_modules/micromark-extension-math/node_modules/katex`,
            `package.json[dependencies]=^${KATEX_PROJECT_VERSION}→node_modules/katex`,
          ],
          "声明来源与解析落点",
        );
        // 两份 0.16.47 分处兄弟分支、根被 0.18.1 占位 ⇒ 当前树形下无法提升位置,字节不可回收
        const sameVersion = finding.copies.filter((copy) => copy.version === KATEX_MERMAID_VERSION);
        assert(sameVersion.length === 2, `应有两份 ${KATEX_MERMAID_VERSION} 副本,实际 ${sameVersion.length}`);
        const oneCopyBytes = at(sameVersion, 0, "同版本副本").bytes;
        assert(
          finding.unavoidableBytes === oneCopyBytes,
          `不可回收字节应为同版本兄弟副本中多出来的那份 ${oneCopyBytes},实际 ${finding.unavoidableBytes}`,
        );
        assert(
          finding.notes.some((note) => note.includes("不可回收")),
          `同版本兄弟副本应注明字节不可回收,实际 ${JSON.stringify(finding.notes)}`,
        );
        // ④ 跨版本同名同大小文件不计入可回收
        assert(
          finding.crossVersionIdenticalFiles.count === 4,
          `跨版本同名同大小文件应为 4(css/js/2 字体),实际 ${finding.crossVersionIdenticalFiles.count}`,
        );
        assert(
          finding.crossVersionIdenticalFiles.bytes === 22_000 + 260_000 + 16_000 + 12_000,
          `跨版本同名文件字节仅作对照,实际 ${finding.crossVersionIdenticalFiles.bytes}`,
        );
        assert(
          finding.reclaimableBytes === 0 && result.report.duplicates?.reclaimableBytes === 0,
          "跨版本同名文件不得进入可回收口径",
        );
        const summary = renderPackSizeSummary(result.report);
        assert(summary.includes("可回收"), "摘要须单列可回收字节");
        assert(summary.includes("不可回收"), "摘要须单列不可回收字节");
        assert(summary.includes("mermaid"), "摘要须给出声明来源,便于复核");
        console.log(
          `[ok] observability:8b 合法并存(0.18.1 vs 两份 0.16.47,声明 ^0.18.1/^0.16.45/^0.16.0 互斥 → 不判红;可回收 0,不可回收 ${finding.unavoidableBytes})`,
        );
      }

      // 8c 真缺陷之二:同包名不同版本但**声明范围其实重叠**(整份副本可去掉)→ 判红
      //     (项目 ^0.16.0 拿到 0.16.47;mermaid 只要 >=0.16.0,那份嵌套 0.18.1 纯属多余)
      {
        const result = gate({
          "package.json": manifest("markdown-to-word", "9.9.9", { katex: "^0.16.0" }),
          "dist/main/index.js": 200_000,
          "node_modules/mermaid/package.json": manifest("mermaid", "11.16.1", { katex: ">=0.16.0" }),
          ...katexCopyFiles("node_modules/katex", KATEX_MERMAID_VERSION),
          ...katexCopyFiles("node_modules/mermaid/node_modules/katex", "0.18.1"),
        });
        const finding = findingOf(result.report, "katex");
        assert(
          finding.classification === "unifyable-versions",
          `本可统一到同一版本的场景应判 unifyable-versions,实际 ${finding.classification}`,
        );
        assert(finding.red === true, "声明范围重叠 = 真问题,必须判红");
        assert(result.report.status === STATUS.fail, `应判红,实际 ${result.report.status}`);
        const nested = finding.copies.find((copy) => copy.path === "node_modules/mermaid/node_modules/katex");
        assert(
          finding.reclaimableBytes === nested?.bytes,
          `可回收字节应等于可去掉的那份 ${String(nested?.bytes)},实际 ${finding.reclaimableBytes}`,
        );
        assert(
          finding.reasons.some((reason) => reason.includes(KATEX_MERMAID_VERSION) && reason.includes("抽掉后其全部引用方")),
          "应说明可统一到哪个版本(理由里点名落点版本与引用方),实际 " + JSON.stringify(finding.reasons),
        );
        console.log("[ok] observability:8c 声明范围重叠(>=0.16.0 被 0.16.47 满足 → 多余的 0.18.1 可回收 → 判红)");
      }

      // 8d 真缺陷之三:副本版本不满足其引用方声明的范围(semver 违规)→ 判红
      //     (这就是「强行排除嵌套副本/统一版本」会造成的实际损害,规则须能发现)
      {
        const result = gate({
          "package.json": manifest("markdown-to-word", "9.9.9", { katex: `^${KATEX_PROJECT_VERSION}` }),
          "dist/main/index.js": 200_000,
          "node_modules/mermaid/package.json": manifest("mermaid", "11.16.1", { katex: "^0.16.45" }),
          ...katexCopyFiles("node_modules/katex", KATEX_PROJECT_VERSION),
          ...katexCopyFiles("node_modules/mermaid/node_modules/katex", "0.19.0"),
        });
        const finding = findingOf(result.report, "katex");
        assert(
          finding.classification === "semver-violation",
          `引用方拿到不满足其声明范围的版本应判 semver-violation,实际 ${finding.classification}`,
        );
        assert(finding.red === true, "semver 违规必须判红");
        assert(
          finding.reclaimableBytes === 0,
          "semver 违规不是「省下来的字节」(副本还得在,只是版本该换),可回收应为 0",
        );
        const problem = result.verdict.problems.find((line) => line.includes("katex"));
        assert(
          problem !== undefined && problem.includes("^0.16.45") && problem.includes("0.19.0"),
          `问题行应摆出声明范围与实际版本,实际 ${String(problem)}`,
        );
        console.log("[ok] observability:8d semver 违规(引用方要 ^0.16.45 却拿到 0.19.0 → 判红,可回收字节 0)");
      }

      // 8e ⑤ @types/* 仍排除:类型声明不随包运行,计入会每次误报
      {
        const result = gate({
          ...sandboxAsarFiles(),
          "node_modules/@types/katex/package.json": manifest("@types/katex", "0.16.7"),
          "node_modules/@types/katex/index.d.ts": 900,
        });
        assertDeepEqual(
          result.measurement.duplicates.excludedTypeOnly,
          ["node_modules/@types/katex"],
          "@types/katex 须归入排除项",
        );
        assert(
          result.measurement.duplicates.findings.every((finding) => finding.copies.every((copy) => !copy.path.includes("@types/"))),
          "@types/katex 不得作为副本参与判重",
        );
        assert(result.report.status === STATUS.pass, "仅有一个 @types/katex 不该判红");
        // 原语级:副本根发现本身就把 @types/* 分到排除项(不参与任何判定)
        const tree = readAsarTree(result.box.asarPath);
        assert(tree.ok, "含 @types 的 asar 应可解析");
        const found = findPackageCopies(tree.entries, "katex");
        assertDeepEqual(
          found.copies.map((copy) => copy.path),
          ["node_modules/katex"],
          "运行期副本应只有顶层那份",
        );
        assertDeepEqual(found.excluded, ["node_modules/@types/katex"], "@types/katex 归入排除项");
        console.log("[ok] observability:8e @types/katex 仍排除(不进副本、不参与判重、不判红)");
      }

      // 8f 原语级:判重引擎按包名通用(不是 katex 特判)+ 门禁名单是数据
      {
        const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
        // commander 同样同版本两处:证明规则对任意包名成立(不在门禁名单内故只报信息)
        const box = createReleaseSandbox({
          root: sb,
          asarFiles: {
            ...sandboxAsarFiles(),
            "node_modules/d3-dsv/package.json": manifest("d3-dsv", "3.0.1", { commander: "^8.3.0" }),
            "node_modules/commander/package.json": manifest("commander", "8.3.0"),
            "node_modules/commander/index.js": 60_000,
            "node_modules/d3-dsv/node_modules/commander/package.json": manifest("commander", "8.3.0"),
            "node_modules/d3-dsv/node_modules/commander/index.js": 60_000,
          },
        });
        const measured = measure({ unpackedDir: box.unpackedDir, releaseDir: box.releaseDir });
        assert(measured.ok, "commander 沙盒应可实测");
        const duplicates = measured.measurement.duplicates;
        const commander = duplicates.findings.find((item) => item.name === "commander");
        assert(commander !== undefined, "commander 的同版本副本也该被扫出来(规则与包名无关)");
        assert(
          commander.red === true && commander.classification === "redundant-same-version",
          `同版本两处应判缺陷,实际 red=${String(commander.red)}/${commander.classification}`,
        );
        const baseline = parseBaseline(baselineDoc({}));
        assertDeepEqual(baseline.duplicateWatch, ["katex"], "门禁名单来自基线数据");
        // 名单外的真缺陷不进 problems(可见但不门禁),但必须出现在报告/摘要里(不静默)
        const verdict = evaluate(measured.measurement, baseline);
        const gatedCommander = verdict.duplicateFindings.find((item) => item.name === "commander");
        assert(
          gatedCommander?.gated === false,
          `名单外的包名 gated 应为 false,实际 ${String(gatedCommander?.gated)}`,
        );
        assert(
          !verdict.problems.some((line) => line.includes("commander")),
          "名单外的包名不得进 problems",
        );
        const report = buildPackSizeReport({
          measurement: measured.measurement,
          unmeasuredReason: null,
          verdict,
          baseline,
        });
        assertDeepEqual(report.duplicateWatch, ["katex"], "报告须带上本次生效的门禁名单");
        assert(
          renderPackSizeSummary(report).includes("commander"),
          "名单外的发现仍须呈现在摘要里(可见但不门禁)",
        );
        console.log("[ok] observability:8f 判重引擎按包名通用(commander 同版本两处同样识别;门禁名单来自基线数据,名单外只报信息)");
      }
    }

    // ================= 9. 未测量 / 基线不合规 / 无自动重生成 =================
    {
      // 9a 无产物 → unmeasured + 退出码 2
      const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const outFile = path.join(sb, "pack-size-report.json");
      const baselineFile = path.join(sb, "baseline.json");
      const emptyRelease = path.join(sb, "release");
      fs.mkdirSync(emptyRelease, { recursive: true });
      const result = await captureCli(() =>
        packSizeMain(["--release", emptyRelease, "--baseline", baselineFile, "--out", outFile]),
      );
      assert(result.code === PACK_EXIT.unmeasured, `无产物应退出 ${PACK_EXIT.unmeasured},实际 ${result.code}`);
      assert(String(PACK_EXIT.unmeasured) !== "0", "未测量的退出码必须非 0(不得被读成体积正常)");
      const written = JSON.parse(fs.readFileSync(outFile, "utf8"));
      assert(written.status === STATUS.unmeasured, `落盘状态应为 unmeasured,实际 ${written.status}`);
      assert(written.measured === false, "未测量时 measured 必须为 false");
      assert(written.items.length === 0 && written.duplicates === null, "未测量时不得给出条目/副本数字");
      assert(
        typeof written.unmeasuredReason === "string" && written.unmeasuredReason.includes("解包目录不存在"),
        `未测量原因应可操作,实际 ${String(written.unmeasuredReason)}`,
      );
      assertNoVolatileFields(written, "体积报告(未测量)");
      assert(result.output.includes("未测量 ≠ 体积正常"), "摘要须明说未测量不等于体积正常");

      // 9b 基线缺失 / 不合规 → 判红(门禁无法判定时不得报绿)
      const box = createReleaseSandbox({ root: sb, asarFiles: sandboxAsarFiles() });
      const missingBaseline = await captureCli(() =>
        packSizeMain([
          "--release",
          box.releaseDir,
          "--baseline",
          path.join(sb, "no-such-baseline.json"),
          "--out",
          outFile,
        ]),
      );
      assert(missingBaseline.code === PACK_EXIT.fail, `基线缺失应退出 1,实际 ${missingBaseline.code}`);
      assert(
        missingBaseline.output.includes("体积基线文件不存在"),
        `基线缺失应给出可读诊断:${missingBaseline.output}`,
      );
      const badSchema = path.join(sb, "bad-baseline.json");
      fs.writeFileSync(badSchema, JSON.stringify({ baselineSchema: 99, items: { appAsar: "big" } }), "utf8");
      const badResult = await captureCli(() =>
        packSizeMain(["--release", box.releaseDir, "--baseline", badSchema, "--out", outFile]),
      );
      assert(badResult.code === PACK_EXIT.fail, `基线不合规应退出 1,实际 ${badResult.code}`);
      assert(
        badResult.output.includes("baselineSchema 必须是") && badResult.output.includes("必须是非负整数字节"),
        `基线不合规应逐项点名,实际 ${badResult.output}`,
      );

      // 9c 基线不做自动重生成:脚本不提供写入基线的入口
      for (const forbidden of ["--write", "--update", "--update-baseline", "--set-baseline"]) {
        const rejected = await captureCli(() =>
          packSizeMain([
            "--release",
            box.releaseDir,
            "--baseline",
            path.join(sb, "no-such-baseline.json"),
            "--out",
            outFile,
            forbidden,
          ]),
        );
        assert(
          rejected.code === PACK_EXIT.fail && rejected.output.includes("无法识别的选项"),
          `${forbidden} 必须被拒(基线只能人工改),实际 code=${rejected.code} 输出:${rejected.output}`,
        );
      }
      // 真实基线文件在仓库里、且当前产物实测通过「无体积问题」这一层判定
      const repoBaseline = parseBaseline(
        JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "pack-size.baseline.json"), "utf8")),
      );
      assert(repoBaseline.problems.length === 0, `仓库基线自身应合规:${repoBaseline.problems.join(" | ")}`);
      assert(
        repoBaseline.thresholds.maxRelativeGrowth <= 0.25 && repoBaseline.thresholds.minGrowthBytes >= 32 * 1024 * 1024,
        `仓库基线阈值须宽松(相对 ≤25% 且绝对闸 ≥32MiB),实际 ${JSON.stringify(repoBaseline.thresholds)}`,
      );
      for (const spec of MEASURED_ITEMS) {
        assert(
          repoBaseline.items[spec.id] !== undefined,
          `仓库基线应登记全部实测条目,缺 ${spec.id}(新增条目须同 PR 补基线)`,
        );
      }
      // 判重门禁名单是基线数据(不是代码里写死的包名);名单必须登记 katex:
      // 它是体积大头(单份 ~3.8 MiB,含 ~1 MiB 字体),重复即掉安装包体积
      assert(
        Array.isArray(repoBaseline.duplicateWatch) && repoBaseline.duplicateWatch.length > 0,
        `仓库基线应登记判重门禁名单 duplicateWatch,实际 ${JSON.stringify(repoBaseline.duplicateWatch)}`,
      );
      assert(
        repoBaseline.duplicateWatch.includes("katex"),
        `门禁名单应含 katex,实际 ${JSON.stringify(repoBaseline.duplicateWatch)}`,
      );
      console.log("[ok] observability:9 未测量/基线不合规/无自动重生成(退出码 2 与 1 分离,写入类选项被拒,仓库基线合规且宽松)");
    }

    // ================= 10. 体积报告可复现 + 真实产物自检 =================
    {
      const sb = track(fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX)));
      const box = createReleaseSandbox({ root: sb, asarFiles: sandboxAsarFiles() });
      const outA = path.join(sb, "a.json");
      const outB = path.join(sb, "b.json");
      const baselineFile = path.join(sb, "baseline.json");
      const first = measure({ unpackedDir: box.unpackedDir, releaseDir: box.releaseDir });
      assert(first.ok, "沙盒产物应可实测");
      /** @type {Record<string, number>} */
      const measuredMap = {};
      for (const spec of MEASURED_ITEMS) {
        const value = first.measurement.items[spec.id]?.bytes;
        if (typeof value === "number") measuredMap[spec.id] = value;
      }
      fs.writeFileSync(baselineFile, JSON.stringify(baselineDoc(measuredMap), null, 2), "utf8");
      const runA = await captureCli(() =>
        packSizeMain(["--release", box.releaseDir, "--baseline", baselineFile, "--out", outA]),
      );
      const runB = await captureCli(() =>
        packSizeMain(["--release", box.releaseDir, "--baseline", baselineFile, "--out", outB]),
      );
      assert(runA.code === PACK_EXIT.pass && runB.code === PACK_EXIT.pass, "基线等值时两次都应通过");
      assert(
        fs.readFileSync(outA, "utf8") === fs.readFileSync(outB, "utf8"),
        "同输入两次报告应字节相同(体积报告必须可复现)",
      );
      assertNoVolatileFields(JSON.parse(fs.readFileSync(outA, "utf8")), "体积报告(可复现)");
      // --print-measurements:只打印实测值、不写报告、不比对基线
      const printed = await captureCli(() =>
        packSizeMain(["--release", box.releaseDir, "--print-measurements", "--out", outB]),
      );
      assert(printed.code === PACK_EXIT.pass, `--print-measurements 应零退出,实际 ${printed.code}`);
      const measurementJson = JSON.parse(printed.output);
      assert(
        measurementJson.items.appAsar.bytes === box.asar.fileBytes,
        "--print-measurements 应打印实测 app.asar 字节",
      );

      // 真实产物自检:能测到就要能测出关键子项;没有产物则如实 unmeasured
      const realRelease = path.join(ROOT, "release");
      const realMeasured = measure({ unpackedDir: path.join(realRelease, "win-unpacked"), releaseDir: realRelease });
      if (realMeasured.ok) {
        const realItems = realMeasured.measurement.items;
        const realDuplicates = realMeasured.measurement.duplicates;
        assert(
          (realItems.asarKatexFonts?.bytes ?? 0) > 0,
          "真实产物里 KaTeX 字体字节应为正(否则子项口径坏了)",
        );
        assert(
          (realItems.asarNodeModules?.bytes ?? 0) > 0 && (realItems.appAsar?.bytes ?? 0) > 0,
          "真实产物的 asar / node_modules 字节应为正",
        );
        // 本仓真实 katex 场景:0.18.1(项目)与两份 0.16.47(mermaid / micromark-extension-math)
        // 是 semver 强制并存,必须判 parallel-versions 且不判红、可回收字节为 0
        const realKatex = realDuplicates.findings.find((item) => item.name === "katex");
        assert(realKatex !== undefined, "真实产物应扫出 katex 的判重结论");
        assert(
          realKatex.classification === "parallel-versions" && realKatex.red === false,
          `真实 katex 应判合法并存且不判红,实际 ${realKatex.classification}/red=${String(realKatex.red)}:${JSON.stringify(realKatex.notes)}`,
        );
        assert(
          realKatex.reclaimableBytes === 0,
          `真实产物没有可避免的同版本副本,可回收应为 0,实际 ${realKatex.reclaimableBytes}`,
        );
        assert(
          realKatex.copies.length === 3 && new Set(realKatex.copies.map((copy) => copy.version)).size === 2,
          `真实产物 katex 应为 3 份/2 个版本,实际 ${JSON.stringify(realKatex.copies.map((copy) => `${copy.path}@${copy.version}`))}`,
        );
        console.log(
          `[ok] observability:10b 真实产物自检(asar ${String(realItems.appAsar?.bytes)} 字节 / KaTeX 字体 ${String(realItems.asarKatexFonts?.bytes)} 字节 / katex 3 份 2 版本 = 合法并存不判红;可回收 ${realKatex.reclaimableBytes},不可回收 ${realKatex.unavoidableBytes})`,
        );
      } else {
        const reason = realMeasured.reason;
        assert(
          reason.includes("解包目录不存在") || reason.includes("应用归档缺失"),
          `真实产物不可测时原因应是产物缺失,实际 ${reason}`,
        );
        console.log(`[info] observability:10b 本机无真实产物,如实报未测量(${reason})`);
      }
      console.log("[ok] observability:10a 体积报告可复现(同输入同字节/无绝对路径无时间戳/--print-measurements 不写报告)");
    }
  } finally {
    Reflect.set(process, "noAsar", previousNoAsar);
    for (const dir of sandboxes) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
