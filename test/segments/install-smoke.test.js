// @ts-check
/**
 * 打包产物启动/安装/卸载 smoke 段(位于 test/segments/ = 跨域守护段;被测为
 * scripts/check-unpacked-smoke.mjs 与 scripts/check-install-smoke.mjs 的**进程级
 * CLI 语义**与 scripts/smoke-proc.mjs 的判定面,纯 Node 子进程调用,不经 dist
 * 编译产物、不启 Electron GUI):
 *
 * 覆盖(对应验收清单):
 * 1. 解包产物正常路径:以 --smoke 启动解包目录下的可执行文件 → 退出码 0 + 五条诊断标记
 *    齐备 → 判定通过;并断言启动调用序(只启动一次、参数带 --smoke 与一次性
 *    --user-data-dir)、解包目录内产物零改动、临时目录退出即清;
 * 2. 可执行文件非零退出判红:退出码与「缺哪几条标记」都要指名道姓,不能只报「失败」;
 * 3. 超时判红:启动一个不自行退出的桩,验证硬超时生效、进程树被连带硬杀(桩与其派生
 *    的孙进程都不再存活)、判定脚本自身不被挂住;
 * 4. 预演(dry-run)零系统副作用:安装脚本默认只打印三步计划 —— 不创建安装目录、
 *    不创建一次性 userData、不打印真实执行警告、沙盒文件树逐字节不变;
 * 5. 产物缺失给可操作提示(先跑 dist 链)而不是裸报错;另覆盖 app.asar 内缺冒烟入口的
 *    能力缺口告警(先告警、再取证,不放水也不误判);
 * 6. 隔离与清理:两次运行各用一个新的一次性 userData,APPDATA/LOCALAPPDATA 与
 *    --user-data-dir 都落在该目录内,进程退出后目录被删除。
 *
 * 沙箱纪律(硬约束):被测脚本的项目根由脚本自身位置推导(读 package.json、按
 * build.directories.output 找 release),故把生产脚本**逐字节原样**复制到临时沙盒的
 * scripts/(连同 import 依赖 check-dist-manifest.mjs / check-release-artifacts.mjs /
 * smoke-proc.mjs 与 test/common/userdata.js)后再执行 —— 沙盒外不存在可达的真实项目根,
 * 沙盒内不存在被改写的实现。段首/段尾对真实 release/ 做指纹比对,确保真实产物零改动。
 *
 * 「可执行文件」怎么在沙盒里可执行:解包目录里的 .exe 只能是假字节(无法真跑),故用
 * --launcher + --launcher-runtime 把「启动目标」换成 Node 跑的桩脚本,参数与真启动
 * 完全一致;定位/预检/进程树硬杀/标记判定那段代码两者共用。
 *
 * 安装脚本的 --execute 真实路径在本段**不真跑**:它会写 Program Files / 注册表 / 开始
 * 菜单(改动用户系统,须用户授权)。该路径的判定逻辑由沙盒注入的替身执行器(记账 + 预置
 * 结果)覆盖:调用序、退出码判红、超时判红、残留比对、一次性 userData 清理都走真实分支,
 * 只是不碰系统。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInstallFlow } from "../../scripts/check-install-smoke.mjs";
import { SMOKE_MARKERS } from "../../scripts/smoke-proc.mjs";
import { ROOT } from "../common/paths.js";

/** 沙盒名前缀(临时目录,便于识别残留) */
const SANDBOX_PREFIX = "m2w-install-smoke-";
/** 夹具产品名/版本(与真实产物无关,只为让脚本按 build 口径解析出目标名) */
const FIXTURE_PRODUCT = "FixtureApp";
const FIXTURE_VERSION = "9.9.9";
/** 冒烟入口在 asar 内的相对路径(能力缺口预检的判定对象) */
const SMOKE_ENTRY = "dist/main/smoke.js";
/** 沙盒内逐字节复制的脚本(生产实现不得被改写) */
const SANDBOX_SCRIPTS = [
  "check-unpacked-smoke.mjs",
  "check-install-smoke.mjs",
  "smoke-proc.mjs",
  "check-dist-manifest.mjs",
  "check-release-artifacts.mjs",
];
/** 桩脚本:假可执行文件的替身,行为由 M2W_STUB_MODE 驱动 */
const STUB_SOURCE = `// 沙盒桩:扮演「被启动的应用」,行为由 M2W_STUB_MODE 决定。
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.M2W_STUB_MODE ?? "ok";
const tracePath = process.env.M2W_STUB_TRACE ?? "";
const pidFile = process.env.M2W_STUB_PID_FILE ?? "";
if (pidFile !== "") writeFileSync(pidFile, String(process.pid), "utf8");
// 孙进程存活信标:进程树若被连带硬杀,到点也不会留下该文件(win32 上 taskkill /T 才做得到)
const beacon = process.env.M2W_STUB_BEACON ?? "";
if (beacon !== "") {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "ignore" });
  setTimeout(() => {
    try {
      writeFileSync(beacon, "alive\\n", "utf8");
    } catch {
      // 沙盒清理竞态:忽略
    }
    child.kill();
  }, 3000);
}
if (tracePath !== "") {
  appendFileSync(
    tracePath,
    JSON.stringify({
      argv: process.argv.slice(2),
      pid: process.pid,
      appdata: process.env.APPDATA ?? "",
      localappdata: process.env.LOCALAPPDATA ?? "",
    }) + "\\n",
    "utf8",
  );
}
const markers = ${JSON.stringify(SMOKE_MARKERS.map((marker) => marker.token))};
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  // 非 ok 模式只打前两条标记:用于断言「缺哪几条」被指名道姓,而不是笼统报错
  for (const token of mode === "ok" ? markers : markers.slice(0, 2)) console.log(token + " fixture");
  process.exitCode = mode === "ok" ? 0 : 3;
}
`;

/**
 * 断言辅助(条件不成立即抛错,给后续行收窄用)。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond} 条件不成立即抛错
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`install-smoke 断言失败:${msg}`);
}

/**
 * 解析 node 可执行文件:段内跑在 Electron 里(process.execPath 是 electron.exe),
 * 桩必须由真正的 node 跑,否则 --launcher 拉起的是 Electron 而不是脚本。
 * @returns {string} node 可执行文件路径
 */
function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.env.NODE ?? "", process.execPath]) {
    if (candidate && /node(\.exe)?$/i.test(candidate)) return candidate;
  }
  return process.platform === "win32" ? "node.exe" : "node";
}

const NODE = resolveNode();

/**
 * 在沙盒根下写文件(自动建父目录)。
 *
 * `.asar` 路径必须绕开 Electron 的 fs:本段跑在 Electron 里,fs 层会把任何含 ".asar" 的
 * 路径交给 asar 虚拟文件系统接管,写入二进制头时直接抛 `Invalid package`(删除侧同样被
 * 接管,故 removeSandbox 已有纯 node 兜底)。这里对 `.asar` 一律走纯 node 子进程写入。
 *
 * @param {string} root 沙盒根
 * @param {string} relative POSIX 相对路径
 * @param {string | Buffer} content 文件内容(asar 夹具为二进制 Buffer)
 * @returns {string} 落盘绝对路径
 */
function writeFileIn(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (target.toLowerCase().endsWith(".asar")) {
    const b64 = bytes.toString("base64");
    const result = spawnSync(
      NODE,
      ["-e", `require("fs").writeFileSync(${JSON.stringify(target)}, Buffer.from(${JSON.stringify(b64)}, "base64"))`],
      { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
    );
    assert(result.status === 0, `写入假 asar 失败:${target} ${result.stderr ?? ""}`);
    return target;
  }
  fs.writeFileSync(target, bytes);
  return target;
}

/**
 * 新建沙盒:逐字节复制生产脚本 + 夹具 package.json + 假安装包/假解包目录 + 桩脚本。
 * @param {object} [options] 夹具选项
 * @param {boolean} [options.smokeEntryInAsar] app.asar 内是否含冒烟入口(默认含:正向路径)
 * @param {boolean} [options.installer] 是否生成假安装包(默认生成)
 * @returns {string} 沙盒根目录
 */
/**
 * 构造**符合 asar 二进制格式**的最小归档字节。
 *
 * 为什么不能用「直接写一段 JSON 文本」当假 asar:asar 头部是定长二进制前缀 + 嵌套目录树
 * ({"files":{"dist":{"files":{"main":{"files":{"smoke.js":{…}}}}}}),路径按目录分层存放、
 * 不以拼接字符串出现。scripts/smoke-proc.mjs 的 asarContainsEntry 按真实格式解析(拼接路径
 * 子串搜索必然假阴性),故夹具必须同构,否则测试验证的是一个不存在的格式。
 *
 * 实测头布局:[u32=4][u32=jsonLen+8][u32=jsonLen+4][u32=jsonLen][JSON…]
 *
 * @param {string | null} entryRelative 收录的条目相对路径;null 表示空归档
 * @returns {Buffer} asar 字节
 */
function makeAsarBytes(entryRelative) {
  const segments = entryRelative ? entryRelative.split("/") : [];
  /** @type {{ files?: Record<string, unknown> }} */
  let node = { files: { [segments[segments.length - 1] ?? ""]: { size: 1 } } };
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment !== undefined) node = { files: { [segment]: node } };
  }
  const json = Buffer.from(JSON.stringify({ files: segments.length > 0 ? node.files : {} }), "utf8");
  const header = Buffer.alloc(16);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(json.length + 8, 4);
  header.writeUInt32LE(json.length + 4, 8);
  header.writeUInt32LE(json.length, 12);
  return Buffer.concat([header, json]);
}

function createSandbox({ smokeEntryInAsar = true, installer = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  for (const name of SANDBOX_SCRIPTS) {
    const target = path.join(root, "scripts", name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "scripts", name), target);
  }
  // smoke-proc.mjs 复用 test/common/userdata.js 的清理语义,沙盒内也放一份逐字节副本
  const userDataModule = path.join(root, "test", "common", "userdata.js");
  fs.mkdirSync(path.dirname(userDataModule), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "test", "common", "userdata.js"), userDataModule);

  writeFileIn(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "fixture-app",
        version: FIXTURE_VERSION,
        build: {
          appId: "com.fixture.app",
          productName: FIXTURE_PRODUCT,
          directories: { output: "release" },
          nsis: { artifactName: "${productName}-Setup-${version}.${ext}" },
        },
      },
      null,
      2,
    )}\n`,
  );
  if (installer) writeFileIn(root, `release/${FIXTURE_PRODUCT}-Setup-${FIXTURE_VERSION}.exe`, "FAKE-INSTALLER\n");
  writeFileIn(root, `release/win-unpacked/${FIXTURE_PRODUCT}.exe`, "FAKE-EXE-BYTES\n");
  writeFileIn(
    root,
    "release/win-unpacked/resources/app.asar",
    makeAsarBytes(smokeEntryInAsar ? SMOKE_ENTRY : null),
  );
  writeFileIn(root, "stub.mjs", STUB_SOURCE);
  return root;
}

/**
 * 在沙盒内执行检查脚本。
 * @param {string} root 沙盒根
 * @param {string} scriptName scripts/ 下的脚本名
 * @param {string[]} args CLI 参数
 * @param {Record<string, string>} [env] 子进程环境覆盖
 * @returns {{ code: number | null; output: string; ms: number }} 退出码/合并输出/耗时
 */
function runScript(root, scriptName, args, env = {}) {
  const started = Date.now();
  const result = spawnSync(NODE, [path.join(root, "scripts", scriptName), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  assert(result.error === undefined, `沙盒脚本启动失败:${result.error?.message ?? "未知错误"}`);
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, ms: Date.now() - started };
}

/**
 * 读桩的调用留痕(每次启动一行 JSON)。
 * @param {string} tracePath 留痕文件
 * @returns {{ argv: string[]; pid: number; appdata: string; localappdata: string }[]} 调用记录
 */
function readTrace(tracePath) {
  if (!fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/**
 * 目录树指纹(相对路径 + 字节数),用于「零副作用/零改动」断言。
 * 含 `.asar` 的条目只记名字不取字节数:本段跑在 Electron 里,fs 层会把任何含 ".asar"
 * 的路径交给 asar 虚拟文件系统接管(假 app.asar 解析失败即抛),与 release-artifact-gate
 * 段踩的是同一个坑。
 * @param {string} dir 目录
 * @returns {string} 指纹串(目录不存在记 "<absent>")
 */
function treeFingerprint(dir) {
  if (!fs.existsSync(dir)) return "<absent>";
  /** @type {string[]} */
  const rows = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.toLowerCase().endsWith(".asar")) rows.push(`${path.relative(dir, abs).split(path.sep).join("/")}:<asar>`);
      else rows.push(`${path.relative(dir, abs).split(path.sep).join("/")}:${fs.statSync(abs).size}`);
    }
  };
  walk(dir);
  return rows.join("|");
}

/**
 * 删除沙盒目录。Electron 的 fs 层同样管着删除(假 app.asar 不可删),故兜底交给纯
 * node 子进程;两条路都失败才判红 —— 沙盒清理失败必须显式暴露,不能静默留在系统临时区。
 * @param {string} root 沙盒根目录
 * @returns {void}
 */
function removeSandbox(root) {
  if (!fs.existsSync(root)) return;
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    spawnSync(
      NODE,
      [
        "-e",
        `require("fs").rmSync(${JSON.stringify(root)}, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })`,
      ],
      { stdio: "ignore" },
    );
  }
  assert(!fs.existsSync(root), `沙盒清理失败:${root}`);
}

/**
 * 进程是否仍存活(用于「不留孤儿进程」断言)。
 * @param {number} pid 进程号
 * @returns {boolean} true = 仍存活
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 轮询等待某路径消失。
 * @param {string} target 目标路径
 * @param {number} timeoutMs 等待上限
 * @returns {Promise<boolean>} true = 已消失
 */
async function waitAbsent(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(target) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !fs.existsSync(target);
}

/**
 * 成功输出(桩打印)——五个标记各一段,形态贴近真实 smoke 输出。
 * @returns {string} 输出正文
 */
function stubSuccessOutput() {
  return `${SMOKE_MARKERS.map((marker) => `${marker.token} fixture`).join("\n")}\n`;
}

/**
 * 临时根下不应残留一次性 userData 目录(只剩失败时留痕的日志不算)。
 * @param {string} scratchDir 临时根
 * @returns {boolean} true = 无残留
 */
function scratchIsClean(scratchDir) {
  if (!fs.existsSync(scratchDir)) return true;
  return fs.readdirSync(scratchDir).every((name) => !name.startsWith("m2w-smoke-"));
}

/**
 * 在捕获控制台输出的前提下跑 fn(execute 路径的诊断文案断言需要拿到输出)。
 * @template T
 * @param {() => Promise<T>} fn 被测函数
 * @returns {Promise<{ result: T; output: string }>} fn 返回值与合并输出
 */
async function withCapturedOutput(fn) {
  /** @type {string[]} */
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

/**
 * execute 路径的替身结果(默认「退出码 0 + 空输出」)。
 * @param {string} [output] 输出正文
 * @returns {import("../../scripts/smoke-proc.mjs").ProcessRunResult} 结果
 */
function okResult(output = "") {
  return { code: 0, signal: null, timedOut: false, output };
}

/**
 * 用替身执行器跑安装脚本的 --execute 路径(沙盒注入,零系统副作用)。
 * @param {object} spec 参数
 * @param {string} spec.installDir 假安装目录
 * @param {string} spec.scratchRoot 临时根
 * @param {import("../../scripts/smoke-proc.mjs").ProcessRunResult} [spec.launchResult] 启动步骤预置结果
 * @param {import("../../scripts/smoke-proc.mjs").ProcessRunResult} [spec.installResult] 安装步骤预置结果
 * @param {import("../../scripts/smoke-proc.mjs").ProcessRunResult} [spec.uninstallResult] 卸载步骤预置结果
 * @param {string[]} [spec.registryAfter] 卸载后仍存在的注册表键(默认空 = 已清理干净)
 * @returns {Promise<{ code: number; calls: string[]; launchCalls: { userDataDir: string; existedDuring: boolean }[] }>} 结果
 */
async function runInstallExecuteWithStubs({
  installDir,
  scratchRoot,
  launchResult,
  installResult,
  uninstallResult,
  registryAfter = [],
}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {{ userDataDir: string; existedDuring: boolean }[]} */
  const launchCalls = [];
  // 安装前不存在 → 安装后存在(含目录内的应用与卸载器)→ 卸载后消失(状态机式替身,不真碰文件系统)
  let installed = false;
  const exePath = path.join(installDir, `${FIXTURE_PRODUCT}.exe`);
  const uninstallerPath = path.join(installDir, `Uninstall ${FIXTURE_PRODUCT}.exe`);
  const exists = (/** @type {string} */ target) => {
    if (target === installDir) return installed;
    return installed && (target === exePath || target === uninstallerPath);
  };
  const listDir = () => [`${FIXTURE_PRODUCT}.exe`, `Uninstall ${FIXTURE_PRODUCT}.exe`];
  let registryStage = 0;
  const queryRegistry = async () => {
    registryStage += 1;
    // 第 1 次 = 安装前快照(空),第 2 次 = 卸载后快照(按参数给残留项)
    return registryStage === 1 ? [] : registryAfter;
  };
  const code = await runInstallFlow({
    installer: path.join(scratchRoot, "fake-installer.exe"),
    installDir,
    facts: { productName: FIXTURE_PRODUCT, version: FIXTURE_VERSION, artifactTemplate: "", releaseDir: "release" },
    timeoutMs: 1000,
    scratchRoot,
    run: async (spec) => {
      calls.push(`${path.basename(spec.command)} ${spec.args.join(" ")}`.trim());
      if (spec.command.endsWith("fake-installer.exe")) {
        const result = installResult ?? okResult("[fixture] installed\n");
        installed = result.code === 0;
        return result;
      }
      const result = uninstallResult ?? okResult("[fixture] uninstalled\n");
      installed = false;
      return result;
    },
    launchSmoke: async (spec) => {
      launchCalls.push({ userDataDir: spec.userDataDir, existedDuring: fs.existsSync(spec.userDataDir) });
      return launchResult ?? okResult(stubSuccessOutput());
    },
    exists,
    listDir,
    queryRegistry,
  });
  return { code, calls, launchCalls };
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const realReleaseBefore = treeFingerprint(path.join(ROOT, "release"));
  /** @type {string[]} */
  const sandboxes = [];
  /** @type {Error | null} */
  let failure = null;
  try {
    // ---------- 0. 沙箱纪律:脚本逐字节一致 + 契约常量非空 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      for (const name of SANDBOX_SCRIPTS) {
        const copy = path.join(root, "scripts", name);
        const original = path.join(ROOT, "scripts", name);
        assert(
          fs.readFileSync(copy).equals(fs.readFileSync(original)),
          `沙盒副本应与生产脚本逐字节一致(否则测的不是被测实现):${name}`,
        );
      }
      // 标记清单自检:非空且全部取自 smoke 输出的 [smoke] 前缀,否则「缺哪几条」断言失去意义
      assert(SMOKE_MARKERS.length === 5, `诊断标记应为 5 条,实际 ${SMOKE_MARKERS.length}`);
      assert(
        SMOKE_MARKERS.every((marker) => marker.token.startsWith("[smoke] ")),
        "诊断标记应全部取自 smoke 输出的 [smoke] 前缀",
      );
      removeSandbox(root);
    }

    // ---------- 1. 解包产物正常路径:调用序 + 隔离 + 清理 + 零改动 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const scratch = path.join(root, "scratch");
      const tracePath = path.join(root, "trace.jsonl");
      const unpackedBefore = treeFingerprint(path.join(root, "release", "win-unpacked"));
      const result = runScript(
        root,
        "check-unpacked-smoke.mjs",
        ["--scratch", scratch, "--launcher", path.join(root, "stub.mjs"), "--launcher-runtime", NODE],
        { M2W_STUB_MODE: "ok", M2W_STUB_TRACE: tracePath },
      );
      assert(result.code === 0, `解包 smoke 正常路径应通过,实际 ${result.code}\n${result.output}`);
      assert(/解包产物 smoke 通过/.test(result.output), `应报告通过文案;实际:${result.output}`);

      const trace = readTrace(tracePath);
      assert(trace.length === 1, `桩应只被启动一次,实际 ${trace.length} 次`);
      const call = trace[0];
      assert(call !== undefined, "桩未留下调用记录");
      assert(call.argv.includes("--smoke"), `启动参数应含 --smoke,实际 ${JSON.stringify(call.argv)}`);
      const userDataArg = /** @type {string} */ (call.argv.find((arg) => arg.startsWith("--user-data-dir=")));
      assert(userDataArg !== "", `启动参数应含 --user-data-dir,实际 ${JSON.stringify(call.argv)}`);
      assert(userDataArg.includes(scratch), `--user-data-dir 应落在临时根内,实际 ${userDataArg}`);
      assert(
        call.argv.indexOf("--smoke") < call.argv.indexOf(userDataArg),
        `参数序应为 --smoke 在前、--user-data-dir 在后,实际 ${JSON.stringify(call.argv)}`,
      );
      assert(
        call.appdata.includes(scratch) && call.localappdata.includes(scratch),
        `APPDATA/LOCALAPPDATA 应被重定向进临时根(实际 ${call.appdata} / ${call.localappdata})`,
      );
      assert(scratchIsClean(scratch), `通过后不应残留一次性 userData:${safeList(scratch)}`);
      assert(!fs.existsSync(path.join(scratch, "unpacked-smoke.log")), "通过路径不应留痕日志");
      assert(
        treeFingerprint(path.join(root, "release", "win-unpacked")) === unpackedBefore,
        "解包目录内产物不得被改动",
      );
      console.log("[ok] install-smoke:解包 smoke 正常路径通过(退出码 0 + 五条标记齐备),启动调用序与清理正确");
    }

    // ---------- 2. 非零退出判红:退出码与缺失标记都指名道姓 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const scratch = path.join(root, "scratch");
      const result = runScript(
        root,
        "check-unpacked-smoke.mjs",
        ["--scratch", scratch, "--launcher", path.join(root, "stub.mjs"), "--launcher-runtime", NODE],
        { M2W_STUB_MODE: "fail" },
      );
      assert(result.code === 1, `非零退出应判红,实际 ${result.code}\n${result.output}`);
      assert(/退出码为 3,期望 0/.test(result.output), `应报出实际退出码;实际:${result.output}`);
      const missing = SMOKE_MARKERS.slice(2).map((marker) => marker.label);
      assert(
        result.output.includes(`输出缺少诊断标记:${missing.join("、")}`),
        `应逐条报出缺失的标记(${missing.join("、")});实际:${result.output}`,
      );
      assert(/完整输出已留痕/.test(result.output), `失败应留痕完整输出;实际:${result.output}`);
      assert(
        fs.existsSync(path.join(scratch, "unpacked-smoke.log")),
        "失败应在临时根内留痕日志(不写仓库其它位置)",
      );
      assert(scratchIsClean(scratch), "失败路径同样不得残留一次性 userData");
      console.log("[ok] install-smoke:非零退出判红,退出码与缺失标记逐条可读,失败留痕且 userData 已清");
    }

    // ---------- 3. 超时判红:硬超时生效 + 进程树连带硬杀 + 不留孤儿 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const scratch = path.join(root, "scratch");
      const pidFile = path.join(root, "stub.pid");
      const beacon = path.join(root, "grandchild-beacon.txt");
      const result = runScript(
        root,
        "check-unpacked-smoke.mjs",
        [
          "--scratch",
          scratch,
          "--launcher",
          path.join(root, "stub.mjs"),
          "--launcher-runtime",
          NODE,
          "--timeout",
          "1500",
        ],
        { M2W_STUB_MODE: "hang", M2W_STUB_PID_FILE: pidFile, M2W_STUB_BEACON: beacon },
      );
      assert(result.code === 1, `超时应判红,实际 ${result.code}\n${result.output}`);
      assert(/超过硬超时未自行退出,已硬杀进程树/.test(result.output), `应报出硬超时与硬杀;实际:${result.output}`);
      assert(result.ms < 60_000, `判定脚本自身不得被挂住(实际耗时 ${result.ms}ms)`);
      assert(fs.existsSync(pidFile), "桩应已启动过(否则超时断言测的不是真启动)");
      const stubPid = Number(fs.readFileSync(pidFile, "utf8"));
      assert(!isAlive(stubPid), `桩进程应已被硬杀(仍存活:${stubPid})`);
      assert(scratchIsClean(scratch), "超时路径同样不得残留一次性 userData");
      if (process.platform === "win32") {
        // 孙进程存活信标:Windows 无进程组,只有 taskkill /T 才连它一起收掉
        assert(await waitAbsent(beacon, 8000), "超时后孙进程仍在跑(进程树未连带硬杀,会留孤儿)");
        console.log("[ok] install-smoke:超时判红,桩与其派生的孙进程均被连带硬杀(无孤儿进程)");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        assert(fs.existsSync(beacon), "非 win32 平台 SIGKILL 不含后代进程,孙进程存活属预期");
        fs.rmSync(beacon, { force: true });
        console.log("[skip] install-smoke:进程树连带硬杀断言仅在 win32 覆盖(本平台 SIGKILL 不含后代进程)");
      }
      console.log("[ok] install-smoke:超时判红(硬超时生效、不留孤儿进程、userData 已清)");
    }

    // ---------- 4. 预演模式零系统副作用 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const installDir = path.join(root, "installed", FIXTURE_PRODUCT);
      const scratch = path.join(root, "scratch");
      const before = treeFingerprint(root);
      const result = runScript(root, "check-install-smoke.mjs", ["--install-dir", installDir, "--scratch", scratch]);
      assert(result.code === 0, `预演模式应零退出,实际 ${result.code}\n${result.output}`);
      assert(/预演模式/.test(result.output), `应声明处于预演模式;实际:${result.output}`);
      assert(
        result.output.includes(`${FIXTURE_PRODUCT}-Setup-${FIXTURE_VERSION}.exe /S`) &&
          result.output.includes(`/D=${installDir}`),
        `应预告静默安装命令(含 /S 与 /D=);实际:${result.output}`,
      );
      assert(/启动并跑 smoke/.test(result.output), `应预告启动 smoke 步骤;实际:${result.output}`);
      assert(
        result.output.includes(`Uninstall ${FIXTURE_PRODUCT}.exe`) && /\/S/.test(result.output),
        `应预告静默卸载命令;实际:${result.output}`,
      );
      assert(/退出码为 0/.test(result.output), `应预告启动判定项(退出码);实际:${result.output}`);
      assert(/诊断标记/.test(result.output), `应预告启动判定项(诊断标记);实际:${result.output}`);
      assert(/安装目录已消失/.test(result.output), `应预告卸载后的安装目录校验项;实际:${result.output}`);
      assert(/开始菜单痕迹已清理/.test(result.output), `应预告开始菜单残留校验项;实际:${result.output}`);
      assert(/卸载注册表无新增项/.test(result.output), `应预告注册表残留校验项;实际:${result.output}`);
      assert(!/即将真实执行安装/.test(result.output), "预演模式不得打印真实执行警告(那是 --execute 的门禁标记)");
      assert(!fs.existsSync(installDir), "预演模式不得创建安装目录(未执行安装命令)");
      assert(!fs.existsSync(scratch), "预演模式不得创建一次性 userData 目录");
      assert(treeFingerprint(root) === before, "预演模式不得改动任何文件(含沙盒内的 release 产物)");
      console.log("[ok] install-smoke:预演模式只打印三步计划,零系统副作用(未执行安装命令/未建任何目录)");
    }

    // ---------- 5. 产物缺失:可操作提示(先跑 dist 链) ----------
    {
      const root = createSandbox({ installer: false });
      sandboxes.push(root);
      fs.mkdirSync(path.join(root, "release"), { recursive: true });
      const noInstaller = runScript(root, "check-install-smoke.mjs", ["--install-dir", path.join(root, "installed")]);
      assert(noInstaller.code === 1, `缺安装包应判红,实际 ${noInstaller.code}\n${noInstaller.output}`);
      assert(
        noInstaller.output.includes("安装包缺失或为空") && noInstaller.output.includes("请先运行 npm run dist"),
        `缺安装包应给出「先跑 dist 链」的可操作提示;实际:${noInstaller.output}`,
      );
      fs.rmSync(path.join(root, "release"), { recursive: true, force: true });
      const noRelease = runScript(root, "check-install-smoke.mjs", ["--install-dir", path.join(root, "installed")]);
      assert(noRelease.code === 1, `缺发布目录应判红,实际 ${noRelease.code}\n${noRelease.output}`);
      assert(
        noRelease.output.includes("发布目录不存在") && noRelease.output.includes("npm run dist"),
        `缺发布目录应给出可操作提示;实际:${noRelease.output}`,
      );
      fs.mkdirSync(path.join(root, "release"), { recursive: true });
      const noUnpacked = runScript(root, "check-unpacked-smoke.mjs", ["--scratch", path.join(root, "scratch")]);
      assert(noUnpacked.code === 1, `缺解包目录应判红,实际 ${noUnpacked.code}\n${noUnpacked.output}`);
      assert(
        noUnpacked.output.includes("解包目录不存在") && noUnpacked.output.includes("npm run dist"),
        `缺解包目录应给出可操作提示;实际:${noUnpacked.output}`,
      );
      assert(/未启动任何进程/.test(noUnpacked.output), `预检未通过时应声明未启动任何进程;实际:${noUnpacked.output}`);
      console.log("[ok] install-smoke:产物缺失(发布目录/安装包/解包目录)均判红并给出「先跑 npm run dist」的可操作提示");
    }

    // ---------- 6. 能力缺口告警:asar 内缺冒烟入口 ----------
    {
      const root = createSandbox({ smokeEntryInAsar: false });
      sandboxes.push(root);
      const result = runScript(
        root,
        "check-unpacked-smoke.mjs",
        ["--scratch", path.join(root, "scratch"), "--launcher", path.join(root, "stub.mjs"), "--launcher-runtime", NODE],
        { M2W_STUB_MODE: "ok" },
      );
      assert(result.code === 0, `桩跑通时判定应通过(能力缺口只告警);实际 ${result.code}\n${result.output}`);
      assert(
        result.output.includes("app.asar 内未找到冒烟入口") && result.output.includes(SMOKE_ENTRY),
        `包内缺冒烟入口应告警并点名路径;实际:${result.output}`,
      );
      console.log("[ok] install-smoke:app.asar 内缺冒烟入口时先以可操作告警点出能力缺口(不吞也不误判)");
    }

    // ---------- 7. 隔离契约:两次运行目录不同,退出即清 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const tracePath = path.join(root, "trace.jsonl");
      const scratch = path.join(root, "scratch");
      for (let i = 0; i < 2; i += 1) {
        const result = runScript(
          root,
          "check-unpacked-smoke.mjs",
          ["--scratch", scratch, "--launcher", path.join(root, "stub.mjs"), "--launcher-runtime", NODE],
          { M2W_STUB_MODE: "ok", M2W_STUB_TRACE: tracePath },
        );
        assert(result.code === 0, `第 ${i + 1} 次运行应通过,实际 ${result.code}\n${result.output}`);
      }
      const trace = readTrace(tracePath);
      assert(trace.length === 2, `两次运行应各启动一次桩,实际 ${trace.length} 次`);
      const switches = trace.map((entry) => /** @type {string} */ (entry.argv.find((arg) => arg.startsWith("--user-data-dir="))));
      assert(switches[0] !== switches[1], `两次运行应使用不同的一次性 userData(实际 ${switches.join(" / ")})`);
      assert(scratchIsClean(scratch), `两次运行后不应残留任何一次性 userData:${safeList(scratch)}`);
      console.log("[ok] install-smoke:每次运行独立 userData、退出即清理(两次运行目录不同且无残留)");
    }

    // ---------- 8. --execute 路径(沙盒替身执行器):调用序 + 警告 + 清理 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const installDir = path.join(root, "installed", FIXTURE_PRODUCT);
      const scratch = path.join(root, "scratch");
      const { result: flow, output } = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({ installDir, scratchRoot: scratch }),
      );
      assert(flow.code === 0, `沙盒 execute 路径应通过,实际 ${flow.code}\n${output}`);
      assert(
        flow.calls.length === 2 &&
          flow.calls[0] === `fake-installer.exe /S /D=${installDir}` &&
          flow.calls[1] === `Uninstall ${FIXTURE_PRODUCT}.exe /S`,
        `调用序应为 安装(/S /D=) → 卸载(/S),实际 ${JSON.stringify(flow.calls)}`,
      );
      assert(flow.launchCalls.length === 1, `启动 smoke 应恰好一次,实际 ${flow.launchCalls.length} 次`);
      const launch = flow.launchCalls[0];
      assert(launch !== undefined, "启动调用未被记录");
      assert(launch.userDataDir.includes(scratch), `启动应使用临时根内的 userData,实际 ${launch.userDataDir}`);
      assert(launch.existedDuring, "启动期间一次性 userData 目录应已就绪");
      assert(!fs.existsSync(launch.userDataDir), "退出后一次性 userData 必须被清理");
      assert(/即将真实执行安装/.test(output), `execute 路径必须先打印醒目警告;实际:${output}`);
      assert(output.includes(installDir), `警告应点名安装目录;实际:${output}`);
      assert(/管理员权限/.test(output), `警告应提示管理员权限(UAC);实际:${output}`);
      assert(
        output.indexOf("步骤 1/3") < output.indexOf("步骤 2/3") && output.indexOf("步骤 2/3") < output.indexOf("步骤 3/3"),
        `三步顺序应为 安装 → 启动 → 卸载;实际:${output}`,
      );
      console.log("[ok] install-smoke:--execute 路径(替身执行器)按 安装→启动→卸载 执行,先打印警告,userData 退出即清");
    }

    // ---------- 9. --execute 路径的判红:启动非零 / 超时 / 卸载残留 / 安装失败 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const installDir = path.join(root, "installed", FIXTURE_PRODUCT);
      const scratch = path.join(root, "scratch");

      const nonZero = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir,
          scratchRoot: scratch,
          launchResult: { code: 9, signal: null, timedOut: false, output: `${SMOKE_MARKERS[0]?.token ?? ""} fixture\n` },
        }),
      );
      assert(nonZero.result.code === 1, `安装后 smoke 非零退出应判红,实际 ${nonZero.result.code}\n${nonZero.output}`);
      assert(
        /安装后 smoke 退出码为 9,期望 0/.test(nonZero.output),
        `应报出退出码;实际:${nonZero.output}`,
      );
      assert(/输出缺少诊断标记/.test(nonZero.output), `应报出缺失标记;实际:${nonZero.output}`);
      const launchCall = nonZero.result.launchCalls[0];
      assert(launchCall !== undefined && !fs.existsSync(launchCall.userDataDir), "判红路径同样不得残留一次性 userData");

      const timedOut = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir,
          scratchRoot: scratch,
          launchResult: { code: null, signal: "SIGKILL", timedOut: true, output: "" },
        }),
      );
      assert(timedOut.result.code === 1, `启动超时应判红,实际 ${timedOut.result.code}\n${timedOut.output}`);
      assert(
        /安装后 smoke 超过硬超时未自行退出,已硬杀进程树/.test(timedOut.output),
        `应报出硬超时;实际:${timedOut.output}`,
      );
      // 超时也要走完卸载(不留安装痕迹),调用序仍是 安装 → 启动 → 卸载
      assert(timedOut.result.calls.length === 2, `超时应仍执行卸载,实际 ${JSON.stringify(timedOut.result.calls)}`);

      const residue = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir,
          scratchRoot: scratch,
          registryAfter: ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{fixture}_is1"],
        }),
      );
      assert(residue.result.code === 1, `卸载后注册表残留应判红,实际 ${residue.result.code}\n${residue.output}`);
      assert(/静默卸载后仍存在卸载注册表项/.test(residue.output), `应报出注册表残留;实际:${residue.output}`);

      const installFail = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir,
          scratchRoot: scratch,
          installResult: { code: 1603, signal: null, timedOut: false, output: "[fixture] fatal\n" },
        }),
      );
      assert(installFail.result.code === 1, `安装失败应判红,实际 ${installFail.result.code}\n${installFail.output}`);
      assert(
        /静默安装 退出码为 1603/.test(installFail.output),
        `应报出安装失败退出码;实际:${installFail.output}`,
      );
      assert(
        installFail.result.calls.length === 1,
        `安装失败(未落文件)不应继续启动 smoke 或卸载,实际 ${JSON.stringify(installFail.result.calls)}`,
      );
      assert(
        installFail.result.launchCalls.length === 0,
        `安装失败不应启动 smoke,实际启动 ${installFail.result.launchCalls.length} 次`,
      );
      assert(/跳过静默卸载/.test(installFail.output), `无卸载器时应留痕跳过;实际:${installFail.output}`);
      console.log("[ok] install-smoke:--execute 路径对 启动非零/超时/注册表残留/安装失败 均判红且原因可读");
    }

    // ---------- 10. 参数面:未知选项与 --help ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const help = runScript(root, "check-install-smoke.mjs", ["--help"]);
      assert(help.code === 0 && /--execute/.test(help.output), `--help 应零退出并说明 --execute;实际:${help.output}`);
      const bad = runScript(root, "check-install-smoke.mjs", ["--exeecute"]);
      assert(bad.code === 1 && /无法识别的选项/.test(bad.output), `未知选项应显式失败;实际:${bad.output}`);
      const badTimeout = runScript(root, "check-install-smoke.mjs", ["--timeout", "0"]);
      assert(
        badTimeout.code === 1 && /--timeout 须为正毫秒数/.test(badTimeout.output),
        `--timeout 0 应拒绝(会退化成「永不超时」);实际:${badTimeout.output}`,
      );
      const unpackedHelp = runScript(root, "check-unpacked-smoke.mjs", ["--help"]);
      assert(
        unpackedHelp.code === 0 && /--launcher/.test(unpackedHelp.output),
        `解包检查 --help 应说明启动器选项;实际:${unpackedHelp.output}`,
      );
      console.log("[ok] install-smoke:--help/未知选项/非法超时均按预期处理(不给「假通过」的口子)");
    }
  } catch (error) {
    failure = /** @type {Error} */ (error);
  } finally {
    for (const root of sandboxes) {
      removeSandbox(root);
    }
    // 安全网:本段绝不允许改动真实 release/ 产物
    try {
      assert(
        treeFingerprint(path.join(ROOT, "release")) === realReleaseBefore,
        "真实 release/ 被本段改动(检查脚本只应在沙盒内执行)",
      );
    } catch (error) {
      const mainFailure = failure;
      const snapshotFailure = /** @type {Error} */ (error);
      failure = mainFailure === null ? snapshotFailure : new Error(`${mainFailure.message}\n[附加]${snapshotFailure.message}`);
    }
  }
  if (failure !== null) throw failure;
}

/**
 * 列目录(诊断用;目录不存在返回占位)。
 * @param {string} dir 目录
 * @returns {string} 目录项名串
 */
function safeList(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).join(",") : "(不存在)";
}
