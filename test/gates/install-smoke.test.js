// @ts-check
/**
 * 打包产物启动/安装/卸载 smoke 段(位于 test/core/ = 跨域守护段;被测为
 * gates/artifacts/check-unpacked-smoke.mjs 与 gates/artifacts/check-install-smoke.mjs 的**进程级
 * CLI 语义**与 gates/smoke/smoke-proc.mjs 的判定面,纯 Node 子进程调用,不经 dist
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
 *    --user-data-dir 都落在该目录内,进程退出后目录被删除;
 * 7. 默认安装目录按构建口径推导(build.nsis.perMachine:true → %ProgramFiles%,
 *    否则 → %LOCALAPPDATA%\Programs\),--install-dir 可覆盖;两种口径的 --execute
 *    警告各自准确(按用户安装不得出现提权/UAC 字样,那是事实错误的引导);
 * 8. 安装部分完成(注册表项 + 开始菜单快捷方式已写、文件未落)时失败:输出点名残留的
 *    具体键与快捷方式路径,并在未提权前提下尽力自愈;安装前就存在的同名键/文件
 *    绝不删除;自愈不改变判定(仍为红);
 * 13. 转发器(build.extraFiles 随包分发的命令行入口)落位是 fail-closed 存在性钉:
 *    声明有而产物缺、声明整个被删,都判红并点名期望路径与解包目录里实际看到的东西;
 *    通过路径的结论行必须带落位计数(证明断言真的跑了,而不是「无输出即通过」)。
 * 15. 残留检查面含**安装账本键**,且判的是它指向的路径(两个方向:键留着 / 键没了目录留着),
 *    既有安装与他人的键不误伤;
 * 16. 卸载后的残留快照等「卸载器收尾」(残留集合清空)再拍:卸载器滞后清理不判红(无假阳性),
 *    而永久残留仍判红(证明等待没有把前一条的判红吃掉)。
 *
 * 沙箱纪律(硬约束):被测脚本的项目根由 `process.cwd()` 决定(单一来源 shared/paths.js),
 * 故把生产脚本**原位**执行、只把 cwd 指到临时沙盒 —— 沙盒外不存在被测脚本能触达的真实项目根,
 * 沙盒内不存在被改写的实现。被测脚本的仓内 import 由 ESM 按**真实文件位置**解析
 * (静态 import 与 cwd 无关),所以沙盒里不需要、也不应该再造一份 shared/ 与 gates/ 的副本。
 * 段首/段尾对真实 release/ 做指纹比对,确保真实产物零改动。
 *
 * 「可执行文件」怎么在沙盒里可执行:解包目录里的 .exe 只能是假字节(无法真跑),故用
 * --launcher + --launcher-runtime 把「启动目标」换成 Node 跑的桩脚本,参数与真启动
 * 完全一致;定位/预检/进程树硬杀/标记判定那段代码两者共用。
 *
 * 安装脚本的 --execute 真实路径在本段**不真跑**:它会写安装目录 / 注册表 / 开始菜单
 * (改动用户系统,须用户授权)。该路径的判定逻辑由沙盒注入的替身执行器(记账 + 预置
 * 结果)覆盖:调用序、退出码判红、超时判红、残留比对、一次性 userData 清理都走真实分支,
 * 只是不碰系统;残留自愈由「假系统」替身(内存里的注册表键/开始菜单痕迹 + 记账删除器)
 * 驱动,能验证「删哪些/不删哪些」,同样不碰系统。
 *
 * node 可执行文件解析**刻意不收口**到 test/harness/node-exec.js:本段候选链多一项
 * `process.env.NODE`(尊重显式 `NODE=` 覆盖),canonical 不含该项。抹平会改动本段
 * --launcher 桩实际被哪个 node 拉起的行为,属本段自己的口径,故保留私有实现。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultInstallDir,
  diffPathEntries,
  runInstallFlow,
  runInstallFlowBothLoops,
  samePathEntries,
  startMenuTraces,
} from "../../gates/artifacts/check-install-smoke.mjs";
import { SMOKE_MARKERS } from "../../gates/smoke/smoke-proc.mjs";
import { ROOT } from "../harness/paths.js";
import { removeFile } from "../harness/temp-resource.js";

/** 沙盒名前缀(临时目录,便于识别残留) */
const SANDBOX_PREFIX = "m2w-install-smoke-";
/** 夹具产品名/版本(与真实产物无关,只为让脚本按 build 口径解析出目标名) */
const FIXTURE_PRODUCT = "FixtureApp";
const FIXTURE_VERSION = "9.9.9";
/** 冒烟入口在 asar 内的相对路径(能力缺口预检的判定对象) */
const SMOKE_ENTRY = "dist/main/smoke.js";
/**
 * 「装机时是否存在把安装目录加入 PATH 的选择能力」这一事实,从**真实**
 * package.json 的 build.nsis.include 派生 —— 与被测脚本 readBuildFacts() 同一口径。
 *
 * 为什么不在夹具里编一个字符串:该字段的唯一用途是让 PATH 断言按配置推导期望值,
 * 夹具凭空填一个值就等于让测试自说自话,配置改了测试不跟变,断言随即退化成
 * 恒绿。所以两处 facts 构造共用这一个常量(单一来源),不各写一份。
 *
 * 归一规则与被测脚本一致:非字符串/空串 → ""，语义即「本仓没有这个能力」。
 * 这个兜底方向是**收紧**而非放松:期望值随之退化为「PATH 一条都不许变」。
 */
const PATH_OPT_IN_SCRIPT = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const include = pkg.build?.nsis?.include;
    return typeof include === "string" && include !== "" ? include : "";
  } catch {
    return "";
  }
})();
/**
 * 桩的「存活信标」延迟(ms):桩在自己启动后延迟这么久才把信标文件写出来。
 *
 * 它必须**晚于**桩收到的硬超时(第 3 段传 --timeout 1500),这样「信标出现」才等价于
 * 「桩与它派生的孙进程都活过了硬超时」—— 即进程树没被连带硬杀。判定侧的观察窗口由它
 * 推导(见 BEACON_WATCH_MARGIN_MS),不另写一个对不上的魔数。
 */
const STUB_BEACON_DELAY_MS = 3000;
/**
 * 存活信标观察窗口相对 STUB_BEACON_DELAY_MS 的余量(ms):覆盖「桩的解释器冷启动」。
 *
 * 桩由 runScript 内部 spawn,故桩的启动不早于 runScript 的起点,信标最晚出现在
 * 「起点 + STUB_BEACON_DELAY_MS」;桩自己还要先起一遍 node 才能跑到那行 setTimeout,
 * 故再留一段余量。实测本机起一个同构桩(写 pid 文件 + 派生一个 node -e 孙进程)的耗时
 * p50≈80ms、max≈170ms(30 次采样),CI 上按 3~4 倍放大仍远小于该余量。
 * 余量只影响「观察得全不全」,不影响判定:通过路径的耗时上界 = 起点 + 窗口,
 * 判红路径一旦看见信标立即返回(不烧满预算)。
 */
const BEACON_WATCH_MARGIN_MS = 600;
/** 本段起进程的被测脚本一律在 artifacts 树(smoke 树只被 import,不由本段 spawn) */
const SANDBOX_ARTIFACTS_DIR = "gates/artifacts";
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
  }, ${STUB_BEACON_DELAY_MS});
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
 * 新建沙盒:夹具 package.json + 假安装包/假解包目录 + 桩脚本。
 *
 * 被测脚本**不复制**:它从仓内原位跑,只靠 cwd 指沙盒(见文件头「沙箱纪律」)。
 * @param {object} [options] 夹具选项
 * @param {boolean} [options.smokeEntryInAsar] app.asar 内是否含冒烟入口(默认含:正向路径)
 * @param {boolean} [options.installer] 是否生成假安装包(默认生成)
 * @param {boolean} [options.perMachine] 夹具 build.nsis.perMachine(默认不设 = 按用户安装)
 * @param {boolean} [options.forwarderInUnpacked] 解包目录内是否含转发器(默认含:正向路径;
 *   置 false 造「声明有、产物缺」的漂移,验证转发器落位断言判红)
 * @param {boolean} [options.declareExtraFiles] 夹具 package.json 是否声明 build.extraFiles
 *   (默认声明;置 false 造「声明被删」,验证断言不会因「没有期望」而静默放过)
 * @returns {string} 沙盒根目录
 */
/**
 * 构造**符合 asar 二进制格式**的最小归档字节。
 *
 * 为什么不能用「直接写一段 JSON 文本」当假 asar:asar 头部是定长二进制前缀 + 嵌套目录树
 * ({"files":{"dist":{"files":{"main":{"files":{"smoke.js":{…}}}}}}),路径按目录分层存放、
 * 不以拼接字符串出现。gates/smoke/smoke-proc.mjs 的 asarContainsEntry 按真实格式解析(拼接路径
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

function createSandbox({
  smokeEntryInAsar = true,
  installer = true,
  perMachine = false,
  forwarderInUnpacked = true,
  declareExtraFiles = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  // ⚠ 这里曾逐字节复制 8 份仓内文件(gates/artifacts 与 gates/smoke 的 4 份脚本 +
  //   shared/ 的 paths.js · userdata.js · cli.mjs · fsx.mjs)。全删:真脚本原位跑,
  //   它的仓内 import 按文件位置解析,沙盒里放副本只会有「副本与真脚本分叉」这个新风险。
  //   连带结论:shared/userdata.js 的「零内部依赖」约束**连同它的兜底一起消失** —— 当年
  //   靠的是「沙盒里那份副本解析不到新依赖 ⇒ ERR_MODULE_NOT_FOUND」这个运行时红。
  //   现在沙盒里根本没有副本,新依赖由 Node 按真实位置解析,故那条约束不再有判红形态;
  //   本段也不再需要为它补断言(没有沙盒可断)。真要恢复约束,该加在 userdata.js 的
  //   层向判据上,不是这里。
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
          // 转发器落位的声明(与真实构建同形):从 build-assets 落到解包/安装根目录。
          // 判定侧从这份声明取期望清单,故「声明被删」也必须判红(见 forwarderInUnpacked
          // / declareExtraFiles 两个夹具开关注入的漂移)。
          ...(declareExtraFiles ? { extraFiles: [{ from: "build-assets/m2w.cmd", to: "m2w.cmd" }] } : {}),
          nsis: {
            artifactName: "${productName}-Setup-${version}.${ext}",
            // 只在显式为 true 时写入:对齐「perMachine 不设 = 按用户安装」的真实构建口径
            ...(perMachine ? { perMachine: true } : {}),
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  if (installer) writeFileIn(root, `release/${FIXTURE_PRODUCT}-Setup-${FIXTURE_VERSION}.exe`, "FAKE-INSTALLER\n");
  writeFileIn(root, `release/win-unpacked/${FIXTURE_PRODUCT}.exe`, "FAKE-EXE-BYTES\n");
  // 转发器落位(与 exe 同级 = 安装根目录):真实构建经 build.extraFiles 落在这里,
  // 断言侧只断它「在解包目录里存在」,不读内容也不执行。
  if (forwarderInUnpacked) writeFileIn(root, "release/win-unpacked/m2w.cmd", "@echo off\r\nrem fixture forwarder\r\n");
  writeFileIn(
    root,
    "release/win-unpacked/resources/app.asar",
    makeAsarBytes(smokeEntryInAsar ? SMOKE_ENTRY : null),
  );
  writeFileIn(root, "stub.mjs", STUB_SOURCE);
  return root;
}

/**
 * 合并子进程环境覆盖:覆盖项的键名与继承项**大小写不敏感**去重后再写入。
 *
 * 两层理由(均为实测):
 *   1. Windows 环境变量名不区分大小写,而 process.env 展开后可能带全大写旧键
 *      (LOCALAPPDATA/PROGRAMFILES 都是全大写)—— 直接 `{...process.env, ...env}` 会让
 *      父进程旧值以「先出现者胜」压过覆盖值,测试就悄悄验到真实系统路径,假绿比红更糟;
 *   2. ProgramFiles 一类**根本覆盖不了**:即便键名完全一致地改写,子进程仍读到系统真值
 *      (该变量由 Windows 按 Known Folder 重新派生,实测 node/cmd 两条路都如此)。
 *      故按机器口径的落点只能在纯函数层注入断言,CLI 层只断言「不落 LOCALAPPDATA」。
 * @param {Record<string, string>} overrides 覆盖项
 * @returns {Record<string, string>} 合并后的环境
 */
function mergeChildEnv(overrides) {
  /** @type {Map<string, string>} */
  const merged = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    for (const existing of merged.keys()) {
      if (existing.toLowerCase() === key.toLowerCase()) merged.delete(existing);
    }
    merged.set(key, value);
  }
  return Object.fromEntries(merged);
}

/**
 * 在沙盒里执行检查脚本(仓内真脚本 + cwd 指沙盒)。
 * @param {string} root 沙盒根
 * @param {string} scriptName 脚本文件名(须是 SANDBOX_ARTIFACTS_DIR 下的文件)
 * @param {string[]} args CLI 参数
 * @param {Record<string, string>} [env] 子进程环境覆盖
 * @returns {{ code: number | null; output: string; ms: number }} 退出码/合并输出/耗时
 */
function runScript(root, scriptName, args, env = {}) {
  const started = Date.now();
  const result = spawnSync(NODE, [path.join(ROOT, SANDBOX_ARTIFACTS_DIR, scriptName), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: mergeChildEnv(env),
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
 * 观察「存活信标」在整段窗口内始终不存在(一旦出现立即返回 false)。
 *
 * 为什么不能「轮询等它消失」(旧实现如此):信标是**只写一次**的存活证据 —— 桩写出后再
 * 没有任何人删它。于是「等消失」必然在第一次探测就成立(文件此刻本来就不存在),预算一次
 * 都不会被消耗,观察窗口实际只剩「判定脚本返回的那一瞬间」。实测(2026-09-29,本机 5 次):
 * 该等待恒 0~1ms 返回,而检查时点约 2.07s,比信标最晚可能出现的时点(≈3.1s)**早约 1s**,
 * 也就是进程树没被连带硬杀、孙进程照样会跑到点写信标,这条断言仍会绿 —— 预算从哪来无关,
 * 观察窗口压根没覆盖到。
 *
 * 正确口径:窗口必须覆盖信标最晚可能出现的时点,期间一旦出现即判红。上界从
 * STUB_BEACON_DELAY_MS + BEACON_WATCH_MARGIN_MS 推导(见两处常量注),不是猜的数;
 * 轮询 200ms 与 fs.existsSync 的开销可忽略,故窗口内每 200ms 就看一眼。
 *
 * @param {string} beacon 信标路径
 * @param {number} launchedAt 桩被启动那一刻(Date.now())
 * @returns {Promise<{ absent: boolean; elapsedMs: number }>} absent = 窗口结束时信标始终不存在
 */
async function watchBeaconAbsent(beacon, launchedAt) {
  const windowEnd = launchedAt + STUB_BEACON_DELAY_MS + BEACON_WATCH_MARGIN_MS;
  while (Date.now() < windowEnd) {
    if (fs.existsSync(beacon)) return { absent: false, elapsedMs: Date.now() - launchedAt };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { absent: !fs.existsSync(beacon), elapsedMs: Date.now() - launchedAt };
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
 * @returns {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} 结果
 */
function okResult(output = "") {
  return { code: 0, signal: null, timedOut: false, output };
}

/**
 * 用替身执行器跑安装脚本的 --execute 路径(沙盒注入,零系统副作用)。
 * @param {object} spec 参数
 * @param {string} spec.installDir 假安装目录
 * @param {string} spec.scratchRoot 临时根
 * @param {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} [spec.launchResult] 启动步骤预置结果
 * @param {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} [spec.installResult] 安装步骤预置结果
 * @param {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} [spec.uninstallResult] 卸载步骤预置结果
 * @param {string[]} [spec.registryAfter] 卸载后仍存在的注册表键(默认空 = 已清理干净)
 * @param {boolean} [spec.perMachine] 构建口径(默认 false = 按用户安装)
 * @returns {Promise<{ code: number; calls: string[]; launchCalls: { userDataDir: string; existedDuring: boolean }[]; deletedKeys: string[]; removedPaths: string[] }>} 结果
 */
async function runInstallExecuteWithStubs({
  installDir,
  scratchRoot,
  launchResult,
  installResult,
  uninstallResult,
  registryAfter = [],
  perMachine = false,
}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {{ userDataDir: string; existedDuring: boolean }[]} */
  const launchCalls = [];
  /** @type {string[]} */
  const deletedKeys = [];
  /** @type {string[]} */
  const removedPaths = [];
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
    facts: {
      productName: FIXTURE_PRODUCT,
      version: FIXTURE_VERSION,
      artifactTemplate: "",
      releaseDir: "release",
      perMachine,
      pathOptInScript: PATH_OPT_IN_SCRIPT,
    },
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
    // 沙盒纪律:账本键检索换成恒空替身 —— 真的那个会 reg query 整棵 HKCU\Software
    // (实测 ~1.4s,且读的是用户真实注册表)。本段不覆盖账本键,那由第 15 段专门驱动。
    queryLedger: async () => [],
    // 沙盒纪律:自愈的删除类副作用一律换成记账替身,绝不落到真实注册表/文件系统
    deleteRegistryKey: async (key) => {
      deletedKeys.push(key);
      return true;
    },
    removePath: (target) => {
      removedPaths.push(target);
      return true;
    },
  });
  return { code, calls, launchCalls, deletedKeys, removedPaths };
}

/** 假系统里「本次安装新建」的卸载注册表键(键名带 GUID 变体,故不硬编码到脚本内) */
const FIXTURE_NEW_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9f8b6a11-0c3d-4a2e-9f10-5b7c2d4e1a60}_is1";
/** 假系统里「安装前就存在」的同产品卸载键(既有安装,自愈绝不能删) */
const FIXTURE_PRE_EXISTING_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{3b1d77aa-52c9-4e6b-8c31-1f0d9a4b2e55}_is1";

/**
 * 用「假系统」跑安装脚本的 --execute 路径:把安装器/卸载器该做的系统改动与脚本自愈该做
 * 的删除全部收进一个内存状态,删除类副作用(deleteRegistryKey / removePath)换成记账替身。
 *
 * 这样「哪些该删、哪些绝不删」在**状态层**被真跑(能断言删除清单逐项),但不碰真实注册表
 * 与开始菜单 —— 自愈逻辑最危险的地方正是删错对象,验证必须能给出负向断言。
 *
 * @param {object} spec 场景
 * @param {string} spec.installDir 假安装目录
 * @param {string} spec.scratchRoot 临时根
 * @param {string[]} [spec.registryBefore] 安装前就存在的卸载注册表键
 * @param {string[]} [spec.startMenuBefore] 安装前就存在的开始菜单痕迹路径
 * @param {boolean} [spec.perMachine] 构建口径(默认 false = 按用户安装)
 * @param {boolean} [spec.writesFiles] 安装命令是否真的落文件(默认 true;false = 装到一半)
 * @param {boolean} [spec.writesResidue] 安装命令是否写注册表项 + 开始菜单快捷方式(默认 false)
 * @param {boolean} [spec.uninstallLeavesResidue] 卸载命令是否把注册表/快捷方式留下(默认 false)
 * @param {boolean} [spec.canDelete] 删除类操作是否成功(默认 true;false = 模拟删不掉)
 * @param {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} [spec.installResult] 安装结果
 * @param {import("../../gates/smoke/smoke-proc.mjs").ProcessRunResult} [spec.launchResult] 启动结果
 * @returns {Promise<{ code: number; registry: Set<string>; traces: Set<string>; deletedKeys: string[]; removedPaths: string[]; launchCalls: number }>} 运行后状态
 */
async function runInstallExecuteWithFakeSystem({
  installDir,
  scratchRoot,
  registryBefore = [],
  startMenuBefore = [],
  perMachine = false,
  writesFiles = true,
  writesResidue = false,
  uninstallLeavesResidue = false,
  canDelete = true,
  installResult,
  launchResult,
}) {
  const registry = new Set(registryBefore);
  const traces = new Set(startMenuBefore);
  /** @type {string[]} */
  const deletedKeys = [];
  /** @type {string[]} */
  const removedPaths = [];
  let installed = false;
  let launched = 0;
  const exePath = path.join(installDir, `${FIXTURE_PRODUCT}.exe`);
  const uninstallerPath = path.join(installDir, `Uninstall ${FIXTURE_PRODUCT}.exe`);
  const newShortcut = startMenuTraces(FIXTURE_PRODUCT).find((trace) => trace.kind === "shortcut");
  assert(newShortcut !== undefined, "开始菜单痕迹清单应含 .lnk 快捷方式形态");
  const shortcutPath = newShortcut.path;
  const exists = (/** @type {string} */ target) => {
    if (target === installDir) return installed;
    if (target === exePath || target === uninstallerPath) return installed;
    return traces.has(target);
  };
  const code = await runInstallFlow({
    installer: path.join(scratchRoot, "fake-installer.exe"),
    installDir,
    facts: {
      productName: FIXTURE_PRODUCT,
      version: FIXTURE_VERSION,
      artifactTemplate: "",
      releaseDir: "release",
      perMachine,
      pathOptInScript: PATH_OPT_IN_SCRIPT,
    },
    timeoutMs: 1000,
    scratchRoot,
    run: async (spec) => {
      if (spec.command.endsWith("fake-installer.exe")) {
        const result = installResult ?? okResult("[fixture] installed\n");
        if (result.code === 0) {
          installed = writesFiles;
          if (writesResidue) {
            registry.add(FIXTURE_NEW_KEY);
            traces.add(shortcutPath);
          }
        }
        return result;
      }
      const result = okResult("[fixture] uninstalled\n");
      installed = false;
      if (!uninstallLeavesResidue) {
        registry.delete(FIXTURE_NEW_KEY);
        traces.delete(shortcutPath);
      }
      return result;
    },
    launchSmoke: async () => {
      launched += 1;
      return launchResult ?? okResult(stubSuccessOutput());
    },
    exists,
    listDir: () => [`${FIXTURE_PRODUCT}.exe`, `Uninstall ${FIXTURE_PRODUCT}.exe`],
    queryRegistry: async () => [...registry],
    // 沙盒纪律:账本键检索换成恒空替身(见 runInstallExecuteWithStubs 里的同一条注)。
    queryLedger: async () => [],
    deleteRegistryKey: async (key) => {
      deletedKeys.push(key);
      if (!canDelete) return false;
      registry.delete(key);
      return true;
    },
    removePath: (target) => {
      removedPaths.push(target);
      if (!canDelete) return false;
      traces.delete(target);
      if (target === installDir) installed = false;
      return true;
    },
  });
  return { code, registry, traces, deletedKeys, removedPaths, launchCalls: launched };
}

/** 沙盒里的「安装前」用户 PATH(两条,便于肉眼核对增删) */
const FAKE_PATH_BEFORE = `C:\\tools\\alpha;C:\\tools\\beta`;
/**
 * PATH opt-in 开关字面量。
 *
 * 必须与 gates/artifacts/check-install-smoke.mjs 的同名常量、以及
 * build-assets/installer.nsh 的 !define M2W_OPT_IN_SWITCH 三处一致。
 * 故意不解析 .nsh 去取:解析 NSIS 源码会把测试绑死在脚本语法上,而开关名写错时
 * 三处一起错反而判定恒绿 —— 那比"改一处漏一处"更危险(ADR-062 有记)。
 */
const OPT_IN_SWITCH = "/M2W_ADD_PATH=1";

/**
 * 装一个会改用户 PATH 的假系统:按 opt-in 开关决定装完加不加安装目录,卸载时还原。
 *
 * 它照抄 build-assets/installer.nsh 的**可观测行为**(追加而非覆盖、卸完全部摘掉),
 * 于是「门禁的两轮判定」能在不碰真实注册表的前提下被真跑一遍。
 *
 * @param {object} spec 场景
 * @param {string} spec.installDir 假安装目录
 * @param {string} spec.scratchRoot 临时根
 * @param {boolean} [spec.honorsSwitch] 假安装器是否认 opt-in 开关(默认 true)
 * @param {boolean} [spec.restoreOnUninstall] 卸载时是否还原 PATH(默认 true)
 * @param {boolean} [spec.restoreReorders] 还原时是否把条目顺序打乱(默认 false)
 * @param {string} [spec.optInSwitch] 要传给安装器的 PATH opt-in 开关
 * @returns {Promise<{ code: number, calls: string[], pathReads: string[], finalPath: string }>} 运行结果
 */
async function runInstallWithFakePath({
  installDir,
  scratchRoot,
  honorsSwitch = true,
  restoreOnUninstall = true,
  restoreReorders = false,
  optInSwitch = "",
}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const pathReads = [];
  let pathValue = FAKE_PATH_BEFORE;
  let installed = false;
  let consented = false;
  const exePath = path.join(installDir, `${FIXTURE_PRODUCT}.exe`);
  const uninstallerPath = path.join(installDir, `Uninstall ${FIXTURE_PRODUCT}.exe`);
  const exists = (/** @type {string} */ target) => {
    if (target === installDir || target === exePath || target === uninstallerPath) return installed;
    return false;
  };
  const code = await runInstallFlow({
    installer: path.join(scratchRoot, "fake-installer.exe"),
    installDir,
    facts: {
      productName: FIXTURE_PRODUCT,
      version: FIXTURE_VERSION,
      artifactTemplate: "",
      releaseDir: "release",
      perMachine: false,
      pathOptInScript: PATH_OPT_IN_SCRIPT,
    },
    timeoutMs: 1000,
    scratchRoot,
    optInSwitch,
    run: async (spec) => {
      calls.push(`${path.basename(spec.command)} ${spec.args.join(" ")}`.trim());
      if (spec.command.endsWith("fake-installer.exe")) {
        installed = true;
        // 认不认开关由 honorsSwitch 决定:置 false 就模拟「传了开关也没反应」——
        // 那正是「勾了却没生效」这个失败面,门禁必须能抓它。
        consented = honorsSwitch && spec.args.some((arg) => arg.startsWith("/M2W_ADD_PATH"));
        if (consented) pathValue = `${FAKE_PATH_BEFORE};${installDir}`;
        return okResult("[fixture] installed\n");
      }
      installed = false;
      if (restoreOnUninstall) {
        // 还原成原值。打乱顺序用来验证「逐条同序」那道断言(集合口径下它完全隐形)。
        pathValue = restoreReorders ? [...FAKE_PATH_BEFORE.split(";")].reverse().join(";") : FAKE_PATH_BEFORE;
      }
      return okResult("[fixture] uninstalled\n");
    },
    launchSmoke: async () => okResult(stubSuccessOutput()),
    exists,
    listDir: () => [`${FIXTURE_PRODUCT}.exe`, `Uninstall ${FIXTURE_PRODUCT}.exe`],
    queryRegistry: async () => [],
    // 沙盒纪律:账本键检索换成恒空替身(见 runInstallExecuteWithStubs 里的同一条注)。
    queryLedger: async () => [],
    deleteRegistryKey: async () => true,
    removePath: () => true,
    readRegValue: async () => {
      pathReads.push(pathValue);
      return pathValue;
    },
  });
  return { code, calls, pathReads, finalPath: pathValue };
}

/**
 * 假系统里「安装账本键」的键名(键名本身不带产品名 —— 真机上它是 `{APP_GUID}`,
 * 由 electron-builder 从 appId 派生;被测脚本不硬编码它,按 `InstallLocation` 值检索+归属)。
 */
const FIXTURE_LEDGER_KEY = "HKCU\\Software\\{fixture-app-guid}";
/** 假系统里「别人家」的账本键(同机器上别的 Electron 应用也各有一个,不得算成本次残留) */
const FIXTURE_OTHER_LEDGER_KEY = "HKCU\\Software\\{someone-elses-guid}";
/** 别人家那个键的 InstallLocation —— 同样含本产品名字样以外的内容,归属判据据此把它排除 */
const FIXTURE_OTHER_LEDGER_VALUE = "C:\\Users\\someone\\AppData\\Local\\Programs\\SomeoneElse";

/**
 * 用「假系统」跑安装脚本的 --execute 路径,驱动**残留检查面**的两处缺口。
 *
 * 假系统把卸载器该做的系统改动收进内存状态:账本键(带 `InstallLocation`)、
 * 卸载注册表项、开始菜单快捷方式、以及它们指向的目录。删除类副作用(自愈)仍走记账替身,
 * 绝不落到真实注册表/文件系统。
 *
 * 两个正交的调节钮 —— 这是本段最要紧的设计:两处缺口必须能**分别**变红,而「等卸载器收尾」
 * 那处(等残留集合清空)天然会把另一处的判红一起等掉,若不拆开就分不清是哪处在起作用:
 *   - `ledgerOutcome`:账本键在卸载后的归宿(决定缺口①判红);
 *   - `latePolls`:卸载器派生临时副本的滞后(注册表/快捷方式/账本键在第几次残留采样之后才
 *     真正消失),决定缺口② —— 滞后存在时必须**等干净**(绿),不等就抢跑(红)。
 *
 * @param {object} spec 场景
 * @param {string} spec.installDir 假安装目录
 * @param {string} spec.scratchRoot 临时根
 * @param {boolean} [spec.perMachine] 构建口径(默认 false = 按用户安装)
 * @param {'clean' | 'keyLeft' | 'pathLeft'} [spec.ledgerOutcome] 卸载后账本键的归宿:
 *   `clean` = 键与目录都清干净;`keyLeft` = 键留着(指向的目录已消失);
 *   `pathLeft` = 键删了但它装完时指向的目录留着(需靠「装完那一刻记下的 InstallLocation」才判得到)
 * @param {string} [spec.pollutedSuffix] 装完时写进 InstallLocation 的污染后缀(复现 `/D=` 吞参数那次)
 * @param {number} [spec.latePolls] 卸载器滞后:前 N 次残留采样仍脏,第 N+1 次才干净
 * @param {number} [spec.timeoutMs] 单步超时(同时是「等收尾」的预算上限)
 * @param {boolean} [spec.preExistingLedger] 安装前是否已存在一个账本键(既有安装不该被判本次残留)
 * @param {boolean} [spec.installDirExistedBefore] 安装目录在安装前就已存在(那一轮判不了「留痕」,不该白等收尾)
 * @param {boolean} [spec.otherAppLedger] 安装前是否存在「别人家」的账本键(不得算成本次残留)
 * @param {boolean} [spec.leaveRegistry] 卸载后是否留下卸载注册表项与快捷方式(缺口②的滞后面)
 * @returns {Promise<{ code: number, ledgerKeys: Set<string>, deletedKeys: string[], removedPaths: string[], ledgerProbes: number, registryProbes: number }>} 运行后状态
 */
async function runInstallWithFakeResidue({
  installDir,
  scratchRoot,
  perMachine = false,
  ledgerOutcome = "clean",
  pollutedSuffix = "",
  latePolls = 0,
  timeoutMs = 1000,
  preExistingLedger = false,
  otherAppLedger = false,
  leaveRegistry = false,
  installDirExistedBefore = false,
}) {
  /** 卸载器滞后计数:卸载完成后,前 latePolls 次残留采样仍返回「未清干净」 */
  let cleanupsPending = 0;
  let uninstalled = false;
  let installed = false;
  let ledgerPresent = preExistingLedger;
  let registryPresent = false;
  let tracePresent = false;
  const exePath = path.join(installDir, `${FIXTURE_PRODUCT}.exe`);
  const uninstallerPath = path.join(installDir, `Uninstall ${FIXTURE_PRODUCT}.exe`);
  const shortcut = startMenuTraces(FIXTURE_PRODUCT).find((trace) => trace.kind === "shortcut");
  assert(shortcut !== undefined, "开始菜单痕迹清单应含 .lnk 快捷方式形态");
  const shortcutPath = shortcut.path;
  // 装完时账本键里写的那个 InstallLocation 值(污染后缀复现 `/D=` 把开关吞进目录名那次)。
  const ledgerLocation = `${installDir}${pollutedSuffix}`;

  /**
   * 当前假系统里的账本键清单(被测脚本按这个形状收账本键的检索结果)。
   * @returns {{ key: string, installLocation: string }[]} 账本键与其 InstallLocation 值
   */
  const ledgerEntries = () => {
    /** @type {{ key: string, installLocation: string }[]} */
    const entries = [];
    if (otherAppLedger) entries.push({ key: FIXTURE_OTHER_LEDGER_KEY, installLocation: FIXTURE_OTHER_LEDGER_VALUE });
    if (ledgerPresent) {
      entries.push({ key: FIXTURE_LEDGER_KEY, installLocation: preExistingLedger ? `${installDir}-旧安装` : ledgerLocation });
    }
    return entries;
  };

  /**
   * 推进「卸载器临时副本的清理进度」一格 —— 每次残留采样调一次。
   *
   * 滞后期内注册表项/快捷方式/账本键都还在(文件与安装目录此刻已经没了,这正是真机上
   * 那个窗口);滞后耗尽后按场景的真实归宿落地(clean = 清干净,keyLeft = 键留着)。
   * `latePolls: 0` 时第一次采样就落地,等价于「卸载器同步清完了」。
   */
  const advanceCleanup = () => {
    if (cleanupsPending > 0) {
      cleanupsPending -= 1;
      return;
    }
    ledgerPresent = ledgerOutcome === "keyLeft";
    registryPresent = leaveRegistry;
    tracePresent = leaveRegistry;
  };

  const exists = (/** @type {string} */ target) => {
    if (target === installDir) return installDirExistedBefore || installed;
    if (target === exePath || target === uninstallerPath) return installed;
    if (target === shortcutPath) return tracePresent;
    // 账本键装完时指向的那个目录:默认**不存在**(复现 `/D=` 吞参数那次 —— 污染值指向的
    // 目录压根没被创建,残留的是键本身);`pathLeft` 场景下它真的被留下了。
    if (target === ledgerLocation) return ledgerOutcome === "pathLeft";
    return false;
  };

  let ledgerProbes = 0;
  let registryProbes = 0;
  /** @type {string[]} */
  const deletedKeys = [];
  /** @type {string[]} */
  const removedPaths = [];
  const code = await runInstallFlow({
    installer: path.join(scratchRoot, "fake-installer.exe"),
    installDir,
    facts: {
      productName: FIXTURE_PRODUCT,
      version: FIXTURE_VERSION,
      artifactTemplate: "",
      releaseDir: "release",
      perMachine,
      pathOptInScript: PATH_OPT_IN_SCRIPT,
    },
    timeoutMs,
    scratchRoot,
    run: async (spec) => {
      if (spec.command.endsWith("fake-installer.exe")) {
        installed = true;
        ledgerPresent = true;
        registryPresent = true;
        tracePresent = true;
        return okResult("[fixture] installed\n");
      }
      installed = false;
      // 卸载器派生临时副本:文件先没,注册表/快捷方式/账本键随后才没。滞后期数在**卸载之后**
      // 才计数 —— 「安装前」与「装完」那两次采样不能消耗它,否则模拟的窗口根本不在卸载段里。
      uninstalled = true;
      cleanupsPending = latePolls;
      return okResult("[fixture] uninstalled\n");
    },
    launchSmoke: async () => okResult(stubSuccessOutput()),
    exists,
    listDir: () => [`${FIXTURE_PRODUCT}.exe`, `Uninstall ${FIXTURE_PRODUCT}.exe`],
    queryRegistry: async () => {
      registryProbes += 1;
      // 每次残留采样恰好调它一次,且是那一次的第一个探针 ⇒ 用它当「本次采样」的唯一计时点。
      if (uninstalled) advanceCleanup();
      return registryPresent ? [FIXTURE_NEW_KEY] : [];
    },
    queryLedger: async () => {
      ledgerProbes += 1;
      return ledgerEntries();
    },
    deleteRegistryKey: async (key) => {
      deletedKeys.push(key);
      if (key === FIXTURE_NEW_KEY) registryPresent = false;
      if (key === FIXTURE_LEDGER_KEY) ledgerPresent = false;
      return true;
    },
    removePath: (target) => {
      removedPaths.push(target);
      if (target === shortcutPath) tracePresent = false;
      return true;
    },
    readRegValue: async () => FAKE_PATH_BEFORE,
  });
  return {
    code,
    ledgerKeys: new Set(ledgerPresent ? [FIXTURE_LEDGER_KEY] : []),
    deletedKeys,
    removedPaths,
    ledgerProbes,
    registryProbes,
  };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const realReleaseBefore = treeFingerprint(path.join(ROOT, "release"));
  /** @type {string[]} */
  const sandboxes = [];
  /** @type {Error | null} */
  let failure = null;
  try {
    // ---------- 0. 沙箱纪律:脚本原位执行 + 契约常量非空 ----------
    {
      // ⚠ 这里曾有一条「沙盒副本与生产脚本逐字节一致」的断言,随副本机制一并删除:
      //   它是**自指**的(复制是为了断言复制品等于原件),而真脚本原位执行后该断言
      //   恒成立且无信息量。防「测的不是被测实现」现在由构造方式本身保证:
      //   spawn 的目标是 path.join(ROOT, …) 那一份,沙盒里没有任何脚本副本。
      const root = createSandbox();
      sandboxes.push(root);
      assert(
        !fs.existsSync(path.join(root, "gates", "artifacts", "check-unpacked-smoke.mjs")),
        "沙盒内不应存在被测脚本副本(它从仓内原位跑)",
      );
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
      // 「断言跑了」的可分辨判据:通过也必须报落位计数,否则「跑了且通过」与「压根没跑」同形
      assert(
        /转发器落位已核对 1\/1\(m2w\.cmd/.test(result.output),
        `通过结论行应带转发器落位计数(证明断言真的跑了);实际:${result.output}`,
      );

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
      // 观察窗口的起点取「桩被启动」这一刻(= 判定脚本被 spawn 的时刻,桩只会更晚启动)
      const launchedAt = Date.now();
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
        const watch = await watchBeaconAbsent(beacon, launchedAt);
        assert(
          watch.absent,
          `超时后孙进程仍在跑(进程树未连带硬杀,会留孤儿):存活信标在启动后 ${watch.elapsedMs}ms 出现:${beacon}`,
        );
        console.log("[ok] install-smoke:超时判红,桩与其派生的孙进程均被连带硬杀(无孤儿进程)");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        assert(fs.existsSync(beacon), "非 win32 平台 SIGKILL 不含后代进程,孙进程存活属预期");
        removeFile(beacon); // 活下来的一次性信标文件:走 removeFile(退避重试 + 删后复查)
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

      const leftoverKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{fixture}_is1";
      const residue = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir,
          scratchRoot: scratch,
          registryAfter: [leftoverKey],
        }),
      );
      assert(residue.result.code === 1, `卸载后注册表残留应判红,实际 ${residue.result.code}\n${residue.output}`);
      assert(
        residue.output.includes("本次运行新增了安装残留") && residue.output.includes(leftoverKey),
        `应报出新增残留并点名具体键名;实际:${residue.output}`,
      );
      assert(
        residue.result.deletedKeys.join("|") === leftoverKey,
        `残留的卸载注册表项应被自愈清掉(沙盒记账替身);实际 ${JSON.stringify(residue.result.deletedKeys)}`,
      );

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

    // ---------- 11. 默认安装目录按构建口径推导 + 警告文案按口径生成 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const fakeLocalAppData = path.join(root, "fake-localappdata");
      const fakeProgramFiles = path.join(root, "fake-programfiles");
      const env = { LOCALAPPDATA: fakeLocalAppData, ProgramFiles: fakeProgramFiles };

      // 纯函数层:两种口径各自的落点(环境注入,不读真实系统变量)
      assert(
        defaultInstallDir({ productName: FIXTURE_PRODUCT, perMachine: false }, env) ===
          path.join(fakeLocalAppData, "Programs", FIXTURE_PRODUCT),
        "按用户安装应落在 %LOCALAPPDATA%\\Programs\\<productName>",
      );
      assert(
        defaultInstallDir({ productName: FIXTURE_PRODUCT, perMachine: true }, env) ===
          path.join(fakeProgramFiles, FIXTURE_PRODUCT),
        "按机器安装应落在 %ProgramFiles%\\<productName>",
      );

      // CLI 层:默认 package.json(perMachine 未设)→ 按用户路径
      const perUser = runScript(root, "check-install-smoke.mjs", [], env);
      assert(perUser.code === 0, `预演应零退出,实际 ${perUser.code}\n${perUser.output}`);
      assert(
        perUser.output.includes(`/D=${path.join(fakeLocalAppData, "Programs", FIXTURE_PRODUCT)}`),
        `未设 perMachine 时应按用户路径预演;实际:${perUser.output}`,
      );
      assert(
        perUser.output.includes("仅当前用户(无需管理员权限)"),
        `预演应声明安装范围为按用户;实际:${perUser.output}`,
      );
      const perUserHelp = runScript(root, "check-install-smoke.mjs", ["--help"]);
      assert(
        perUserHelp.output.includes("%LOCALAPPDATA%\\Programs\\<productName>"),
        `--help 应给出按用户口径的默认安装目录;实际:${perUserHelp.output}`,
      );

      // CLI 层:perMachine: true → Program Files 路径(ProgramFiles 无法被子进程覆盖,
      // 故按测试进程里的真值断言「落在 Program Files 下、且不是按用户路径」)
      const machineRoot = createSandbox({ perMachine: true });
      sandboxes.push(machineRoot);
      const realProgramFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES ?? "C:\\Program Files";
      const perMachine = runScript(machineRoot, "check-install-smoke.mjs", []);
      assert(perMachine.code === 0, `预演应零退出,实际 ${perMachine.code}\n${perMachine.output}`);
      assert(
        perMachine.output.includes(`/D=${path.join(realProgramFiles, FIXTURE_PRODUCT)}`),
        `perMachine: true 时应按 Program Files 路径预演;实际:${perMachine.output}`,
      );
      assert(
        !perMachine.output.includes(path.join(fakeLocalAppData, "Programs", FIXTURE_PRODUCT)),
        "perMachine: true 时不得落回按用户路径",
      );
      assert(
        perMachine.output.includes("所有用户(需管理员权限)"),
        `预演应声明安装范围为所有用户;实际:${perMachine.output}`,
      );
      const machineHelp = runScript(machineRoot, "check-install-smoke.mjs", ["--help"]);
      assert(
        machineHelp.output.includes("%ProgramFiles%\\<productName>"),
        `--help 应给出按机器口径的默认安装目录;实际:${machineHelp.output}`,
      );

      // 显式覆盖优先于推导
      const custom = path.join(root, "custom-target");
      const overridden = runScript(root, "check-install-smoke.mjs", ["--install-dir", custom]);
      assert(
        overridden.output.includes(`/D=${custom}`) && !overridden.output.includes(fakeLocalAppData),
        `--install-dir 应覆盖推导出的默认目录;实际:${overridden.output}`,
      );
      assert(
        !fs.existsSync(custom),
        "预演模式即使指定了安装目录也不得创建它(覆盖参数不改变零副作用契约)",
      );

      // --execute 警告文案:按用户不出现提权/UAC 字样(按用户安装根本不需要提权,
      // 无条件喊 UAC 会误导人去开管理员终端);按机器则必须点名 UAC
      const userWarn = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({ installDir: path.join(root, "installed", FIXTURE_PRODUCT), scratchRoot: path.join(root, "scratch") }),
      );
      assert(/即将真实执行安装/.test(userWarn.output), `按用户路径应打印 execute 警告;实际:${userWarn.output}`);
      assert(
        userWarn.output.includes("不需要管理员权限"),
        `按用户安装的警告应说明无需提权;实际:${userWarn.output}`,
      );
      assert(
        !/UAC/.test(userWarn.output),
        `按用户安装的警告不得出现 UAC 字样(与事实矛盾);实际:${userWarn.output}`,
      );
      const machineWarn = await withCapturedOutput(() =>
        runInstallExecuteWithStubs({
          installDir: path.join(root, "installed-machine", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-machine"),
          perMachine: true,
        }),
      );
      assert(
        /需要管理员权限/.test(machineWarn.output) && /UAC/.test(machineWarn.output),
        `按机器安装的警告应点名提权与 UAC;实际:${machineWarn.output}`,
      );
      console.log("[ok] install-smoke:默认安装目录按 perMachine 推导(按用户/按机器各就各位,--install-dir 可覆盖),警告文案随口径生成");
    }

    // ---------- 12. 安装部分完成:点名残留 + 尽力自愈 + 不误删 + 判定仍红 ----------
    {
      const root = createSandbox();
      sandboxes.push(root);
      const scratch = path.join(root, "scratch");
      const installDir = path.join(root, "installed", FIXTURE_PRODUCT);
      const shortcut = startMenuTraces(FIXTURE_PRODUCT).find((trace) => trace.kind === "shortcut");
      assert(shortcut !== undefined, "开始菜单痕迹清单应含 .lnk 快捷方式形态(实测安装器写的就是它)");
      const shortcutPath = shortcut.path;

      // 场景 A:装到一半 —— 卸载注册表项与开始菜单快捷方式已写、安装文件未落
      const partial = await withCapturedOutput(() =>
        runInstallExecuteWithFakeSystem({ installDir, scratchRoot: scratch, writesFiles: false, writesResidue: true }),
      );
      assert(partial.result.code === 1, `装到一半应判红,实际 ${partial.result.code}\n${partial.output}`);
      assert(
        partial.output.includes(FIXTURE_NEW_KEY),
        `失败输出应点名残留的卸载注册表项(完整键名);实际:${partial.output}`,
      );
      assert(
        partial.output.includes(shortcutPath),
        `失败输出应点名残留的开始菜单快捷方式完整路径;实际:${partial.output}`,
      );
      assert(
        /静默安装后安装目录不存在/.test(partial.output) && /跳过静默卸载/.test(partial.output),
        `应同时报出「文件没落」与「跳过卸载」两条根因;实际:${partial.output}`,
      );
      assert(/已自动清理/.test(partial.output), `能安全删的本次残留应主动清掉并如实报告;实际:${partial.output}`);
      assert(
        partial.result.registry.has(FIXTURE_NEW_KEY) === false,
        "本次新增的卸载注册表项应已被自愈清掉",
      );
      assert(partial.result.traces.has(shortcutPath) === false, "本次新增的开始菜单快捷方式应已被自愈清掉");
      assert(
        partial.result.deletedKeys.join("|") === FIXTURE_NEW_KEY,
        `注册表删除清单应只有本次新增的那一个;实际 ${JSON.stringify(partial.result.deletedKeys)}`,
      );
      assert(
        partial.result.removedPaths.join("|") === shortcutPath,
        `文件删除清单应只有本次新增的快捷方式;实际 ${JSON.stringify(partial.result.removedPaths)}`,
      );
      assert(partial.result.launchCalls === 0, "文件没落时不应启动 smoke(卸载器也不存在)");

      // 场景 B:既有安装(安装前就存在的同产品键与快捷方式)绝不删除
      const keep = await withCapturedOutput(() =>
        runInstallExecuteWithFakeSystem({
          installDir,
          scratchRoot: path.join(root, "scratch-keep"),
          registryBefore: [FIXTURE_PRE_EXISTING_KEY],
          startMenuBefore: [shortcutPath],
          writesResidue: true,
          uninstallLeavesResidue: true,
        }),
      );
      assert(keep.result.code === 1, `卸载留下注册表残留应判红,实际 ${keep.result.code}\n${keep.output}`);
      assert(
        !keep.output.includes(FIXTURE_PRE_EXISTING_KEY),
        `安装前就存在的键不属本次残留,不应出现在残留/清理报告里;实际:${keep.output}`,
      );
      assert(
        keep.result.deletedKeys.join("|") === FIXTURE_NEW_KEY,
        `只准删本次新增的键;实际 ${JSON.stringify(keep.result.deletedKeys)}`,
      );
      assert(
        keep.result.removedPaths.length === 0,
        `安装前就存在的快捷方式不得删除;实际 ${JSON.stringify(keep.result.removedPaths)}`,
      );
      assert(
        keep.result.registry.has(FIXTURE_PRE_EXISTING_KEY) && keep.result.traces.has(shortcutPath),
        "既有安装的键与快捷方式必须原样保留",
      );

      // 场景 C:删不掉时点名并给出可照抄的人工清理命令
      const locked = await withCapturedOutput(() =>
        runInstallExecuteWithFakeSystem({
          installDir,
          scratchRoot: path.join(root, "scratch-locked"),
          writesFiles: false,
          writesResidue: true,
          canDelete: false,
        }),
      );
      assert(locked.result.code === 1, `自愈失败仍应判红,实际 ${locked.result.code}\n${locked.output}`);
      assert(
        locked.output.includes(`reg delete "${FIXTURE_NEW_KEY}" /f`),
        `注册表删不掉时应给出人工清理命令原文;实际:${locked.output}`,
      );
      assert(
        locked.output.includes(`del /f /q "${shortcutPath}"`),
        `快捷方式删不掉时应给出人工清理命令原文;实际:${locked.output}`,
      );
      assert(
        locked.result.registry.has(FIXTURE_NEW_KEY) && locked.result.traces.has(shortcutPath),
        "自愈失败时不得谎报已清理",
      );

      // 场景 D:自愈不得把判定洗成绿 —— 残留即使被清干净,主判定仍为红
      assert(
        partial.result.code === 1 && partial.output.includes("本次运行新增了安装残留"),
        "自愈之后仍须报出「新增残留」这条根因(判红不能被自愈掩盖)",
      );
      console.log("[ok] install-smoke:装到一半时点名残留键与快捷方式路径、主动自愈、既有安装不误删、自愈不改判定");
    }

    // ---------- 13. 转发器落位:存在性钉必须 fail-closed(两个漂移方向都判红) ----------
    //
    // 为什么这两条是本段最要紧的负向:其余门禁对转发器都是「漂移校验」(拿它与 clean dist
    // 清单逐字节比对,清单里没有它 ⇒ extraFiles 被删时 gen 与 check 一起空、全链仍绿)。
    // 这里要证的是反向的失败也红:声明空了、声明有而产物缺,都必须点名判红。
    {
      // 场景 A:声明有、产物缺(extraFiles 的 to 写错落点 / dist 链没把转发器打进去)
      const missing = createSandbox({ forwarderInUnpacked: false });
      sandboxes.push(missing);
      const missingResult = runScript(
        missing,
        "check-unpacked-smoke.mjs",
        ["--scratch", path.join(missing, "scratch"), "--launcher", path.join(missing, "stub.mjs"), "--launcher-runtime", NODE],
        { M2W_STUB_MODE: "ok" },
      );
      assert(
        missingResult.code === 1,
        `转发器未落位应判红,实际 ${missingResult.code}\n${missingResult.output}`,
      );
      assert(
        missingResult.output.includes("随包分发的转发器未落位") &&
          missingResult.output.includes("m2w.cmd") &&
          missingResult.output.includes("to=m2w.cmd"),
        `应点名期望路径与声明来源;实际:${missingResult.output}`,
      );
      assert(
        missingResult.output.includes("解包目录内实际见到的 .cmd/.bat:(无)"),
        `应把「解包目录里实际看到了什么」摆出来(夹具里没有任何 .cmd/.bat);实际:${missingResult.output}`,
      );
      assert(/预检未通过,未启动任何进程/.test(missingResult.output), `预检未过不应启动进程;实际:${missingResult.output}`);

      // 场景 B:声明整个被删(extraFiles 键消失)—— 「没有期望」不得等于「没有问题」
      const undeclared = createSandbox({ declareExtraFiles: false, forwarderInUnpacked: false });
      sandboxes.push(undeclared);
      const undeclaredResult = runScript(
        undeclared,
        "check-unpacked-smoke.mjs",
        ["--scratch", path.join(undeclared, "scratch"), "--launcher", path.join(undeclared, "stub.mjs"), "--launcher-runtime", NODE],
        { M2W_STUB_MODE: "ok" },
      );
      assert(
        undeclaredResult.code === 1,
        `extraFiles 声明为空必须判红(不能因无期望而静默放过),实际 ${undeclaredResult.code}\n${undeclaredResult.output}`,
      );
      assert(
        undeclaredResult.output.includes("build.extraFiles 未声明任何条目"),
        `应点名「声明被删」这条根因;实际:${undeclaredResult.output}`,
      );
      console.log(
        "[ok] install-smoke:转发器落位为 fail-closed 存在性钉(声明有而产物缺 / 声明被删 均判红并点名期望与实际)",
      );
    }

    // ---------- 14. PATH 两轮(默认支 + 勾选支):两段逻辑都被真跑 ----------
    //
    // 这一段存在的理由:此前勾选支一次都没被执行过 —— /S 下勾选页不跑,写入与
    // 还原只在注释与推理层面成立。这里用假 PATH 走**真实**判定分支(不碰注册表),
    // 把两轮各自该绿/该红的面都钉住。
    {
      // 纯函数层先钉住语义(比较器是判定的地基,塌了就什么都不用验了)
      const unchangedCase = diffPathEntries({ before: FAKE_PATH_BEFORE, after: FAKE_PATH_BEFORE, phase: "after-install" });
      assert(unchangedCase.unchanged === true, "PATH 无增删时 unchanged 应为真");
      assert(unchangedCase.consented === false, "PATH 无增删时 consented 应为假(它要求恰好多出安装目录)");
      assert(unchangedCase.ok === true, "after-install 阶段 unchanged 应放行");

      const consentedCase = diffPathEntries({
        before: FAKE_PATH_BEFORE,
        after: `${FAKE_PATH_BEFORE};C:\\Program Files\\X`,
        installDir: "C:\\Program Files\\X",
        phase: "after-install",
      });
      assert(consentedCase.consented === true, "恰好多出安装目录这一项时应为 consented");
      assert(consentedCase.unchanged === false, "多出一项时 unchanged 应为假");

      // 「多出两条」不是 consented —— 只加一条、且加的正是安装目录才算
      const twoAdded = diffPathEntries({
        before: FAKE_PATH_BEFORE,
        after: `${FAKE_PATH_BEFORE};C:\\X;C:\\Y`,
        installDir: "C:\\X",
        phase: "after-install",
      });
      assert(twoAdded.consented === false, "多出两条时不得判 consented(否则「只准加一条」形同虚设)");
      // 「加的不是安装目录」也不是 consented
      const wrongDir = diffPathEntries({
        before: FAKE_PATH_BEFORE,
        after: `${FAKE_PATH_BEFORE};C:\\SomewhereElse`,
        installDir: "C:\\X",
        phase: "after-install",
      });
      assert(wrongDir.consented === false, "多出的不是安装目录时不得判 consented");
      // after-uninstall 阶段即便多出安装目录也必须判红(卸载摘不掉)
      const leftover = diffPathEntries({
        before: FAKE_PATH_BEFORE,
        after: `${FAKE_PATH_BEFORE};C:\\X`,
        installDir: "C:\\X",
        phase: "after-uninstall",
      });
      assert(leftover.ok === false, "卸载后仍多出安装目录必须判红(那正是卸载摘不掉的残留)");

      // samePathEntries:集合相等但顺序变了 —— 集合口径放过它,逐条同序不放过
      const reordered = samePathEntries("C:\\a;C:\\b;C:\\c", "C:\\c;C:\\b;C:\\a");
      assert(reordered.same === false, "条目集合相同但顺序不同时,逐条同序必须判为不一致");
      assert(reordered.beforeEntries.length === reordered.afterEntries.length, "两侧条目数应相同");
      assert(samePathEntries("C:\\a;C:\\b", "C:\\a;C:\\b").same === true, "完全同序应判为一致");

      const root = createSandbox();
      sandboxes.push(root);

      // 默认支:不带开关 → 装完一条都不变,卸完逐条同序回到基线
      const plain = await withCapturedOutput(() =>
        runInstallWithFakePath({
          installDir: path.join(root, "installed", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-plain"),
        }),
      );
      assert(plain.result.code === 0, `默认支应通过,实际 ${plain.result.code}\n${plain.output}`);
      assert(
        plain.result.calls[0]?.includes("/M2W_ADD_PATH") === false,
        `默认支不传 opt-in 开关,实际 ${JSON.stringify(plain.result.calls[0])}`,
      );
      // 装完那一刻的 PATH 必须是**基线本身**(证明「装完」取的是步骤 1 的快照,
      // 而不是卸载完又读了一次 —— 那处早先写错了,两个数字会恒等)
      assert(
        plain.result.pathReads[1] === FAKE_PATH_BEFORE,
        `默认支装完 PATH 应与基线逐字节相同,实际 ${JSON.stringify(plain.result.pathReads[1])}`,
      );
      assert(
        /安装前 2 → 装完 2 → 卸完 2/.test(plain.output),
        `默认支结论行应报三个阶段的条目数;实际:${plain.output}`,
      );

      // 勾选支:带开关 → 装完恰好多出安装目录这一项,卸完逐条同序回到基线
      const consentedDir = path.join(root, "installed2", FIXTURE_PRODUCT);
      const consented = await withCapturedOutput(() =>
        runInstallWithFakePath({
          installDir: consentedDir,
          scratchRoot: path.join(root, "scratch-consent"),
          optInSwitch: OPT_IN_SWITCH,
        }),
      );
      assert(consented.result.code === 0, `勾选支应通过,实际 ${consented.result.code}\n${consented.output}`);
      assert(
        consented.result.calls[0]?.includes("/M2W_ADD_PATH=1") === true,
        `勾选支必须把 opt-in 开关传给安装器,实际 ${JSON.stringify(consented.result.calls[0])}`,
      );
      assert(
        (consented.result.calls[0]?.indexOf(OPT_IN_SWITCH) ?? -1) <
          (consented.result.calls[0]?.indexOf("/D=") ?? -1),
        `开关必须排在 /D= 之前(NSIS 把 /D= 到行尾当安装目录),实际 ${JSON.stringify(consented.result.calls[0])}`,
      );
      assert(
        consented.result.pathReads[1] === `${FAKE_PATH_BEFORE};${consentedDir}`,
        `勾选支装完 PATH 应恰好多出安装目录这一项,实际 ${JSON.stringify(consented.result.pathReads[1])}`,
      );
      assert(
        /安装前 2 → 装完 3 → 卸完 2/.test(consented.output),
        `勾选支结论行应报 2 → 3 → 2;实际:${consented.output}`,
      );
      assert(
        consented.result.finalPath === FAKE_PATH_BEFORE,
        `勾选支卸完后应逐字节回到基线,实际 ${JSON.stringify(consented.result.finalPath)}`,
      );

      // 负向 A:传了开关但安装器没反应(勾了却没生效)—— 必须判红。
      // 这正是断「具名结论」而非断 ok 的意义:ok 在这里会放行。
      const ignored = await withCapturedOutput(() =>
        runInstallWithFakePath({
          installDir: path.join(root, "installed3", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-ignored"),
          optInSwitch: OPT_IN_SWITCH,
          honorsSwitch: false,
        }),
      );
      assert(ignored.result.code === 1, `传了开关却没写入 PATH 应判红,实际 ${ignored.result.code}\n${ignored.output}`);
      assert(
        /静默安装后用户 PATH 不符合本轮期望/.test(ignored.output),
        `应点名「装完 PATH 不符合本轮期望」;实际:${ignored.output}`,
      );
      assert(
        /期望:恰好多出安装目录这一项/.test(ignored.output),
        `应说清本轮期望是什么;实际:${ignored.output}`,
      );

      // 负向 B:卸载没还原 —— 必须判红(残留)
      const notRestored = await withCapturedOutput(() =>
        runInstallWithFakePath({
          installDir: path.join(root, "installed4", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-notrestored"),
          optInSwitch: OPT_IN_SWITCH,
          restoreOnUninstall: false,
        }),
      );
      assert(
        notRestored.result.code === 1,
        `卸载未还原 PATH 应判红,实际 ${notRestored.result.code}\n${notRestored.output}`,
      );
      assert(
        /卸载后用户 PATH 未回到「安装前」/.test(notRestored.output),
        `应报出「卸载后未回到安装前」;实际:${notRestored.output}`,
      );

      // 负向 C:还原了但顺序被打乱 —— 集合口径看不见,逐条同序能抓住
      const reorderedBack = await withCapturedOutput(() =>
        runInstallWithFakePath({
          installDir: path.join(root, "installed5", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-reordered"),
          optInSwitch: OPT_IN_SWITCH,
          restoreReorders: true,
        }),
      );
      assert(
        reorderedBack.result.code === 1,
        `卸载只还原集合但打乱顺序应判红,实际 ${reorderedBack.result.code}\n${reorderedBack.output}`,
      );
      assert(
        /逐条同序.*没回到基线/.test(reorderedBack.output),
        `应报出「集合没变但逐条同序没回到基线」;实际:${reorderedBack.output}`,
      );

      // 两轮驱动:两轮都跑完才汇总,且带轮次标签。
      // 这里只关心「驱动是否真的发起了两轮、且第二轮带上了开关」,故把文件存在性
      // 判据搭成最简(装完存在、卸完消失),不去模拟 PATH —— PATH 的语义由上面
      // 四个场景各自验。这里若把 exists 恒置 false,第一轮就会因「安装目录不存在」
      // 判红,测到的就不是驱动而是文件存在性了。
      /** @type {string[]} */
      const driverCalls = [];
      let driverInstalled = false;
      // 假 PATH 也得跟着开关动:否则第二轮会因「传了开关却没多出安装目录」判红 ——
      // 那是门禁**正确**地抓到了不一致,不是驱动有 bug。
      let driverPath = FAKE_PATH_BEFORE;
      const driverDir = path.join(root, "installed6", FIXTURE_PRODUCT);
      const driverExe = path.join(driverDir, `${FIXTURE_PRODUCT}.exe`);
      const driverUninstaller = path.join(driverDir, `Uninstall ${FIXTURE_PRODUCT}.exe`);
      const bothLoops = await withCapturedOutput(() =>
        runInstallFlowBothLoops({
          installer: path.join(root, "fake-installer.exe"),
          installDir: driverDir,
          facts: {
            productName: FIXTURE_PRODUCT,
            version: FIXTURE_VERSION,
            artifactTemplate: "",
            releaseDir: "release",
            perMachine: false,
            pathOptInScript: PATH_OPT_IN_SCRIPT,
          },
          timeoutMs: 1000,
          scratchRoot: path.join(root, "scratch-both"),
          run: async (spec) => {
            driverCalls.push(spec.args.join(" "));
            if (spec.command.endsWith("fake-installer.exe")) {
              driverInstalled = true;
              if (spec.args.some((arg) => arg.startsWith("/M2W_ADD_PATH"))) driverPath = `${FAKE_PATH_BEFORE};${driverDir}`;
              return okResult("[fixture] installed\n");
            }
            driverInstalled = false;
            driverPath = FAKE_PATH_BEFORE;
            return okResult("[fixture] uninstalled\n");
          },
          launchSmoke: async () => okResult(stubSuccessOutput()),
          exists: (target) =>
            target === driverDir || target === driverExe || target === driverUninstaller ? driverInstalled : false,
          listDir: () => [`${FIXTURE_PRODUCT}.exe`, `Uninstall ${FIXTURE_PRODUCT}.exe`],
          queryRegistry: async () => [],
          // 沙盒纪律:账本键检索换成恒空替身(见 runInstallExecuteWithStubs 里的同一条注)。
          queryLedger: async () => [],
          deleteRegistryKey: async () => true,
          removePath: () => true,
          readRegValue: async () => driverPath,
        }),
      );
      assert(bothLoops.result === 0, `两轮驱动应通过,实际 ${bothLoops.result}\n${bothLoops.output}`);
      assert(/默认支/.test(bothLoops.output), `两轮驱动应跑默认支;实际:${bothLoops.output}`);
      assert(/勾选支/.test(bothLoops.output), `两轮驱动应跑勾选支;实际:${bothLoops.output}`);
      // 驱动真的把开关传下去了(第一轮不带、第二轮带)—— 否则两轮跑的是同一件事。
      // driverCalls 混着安装与卸载两类调用(每轮各两条),故按"含 /S /D="筛出安装轮次。
      const driverInstalls = driverCalls.filter((line) => line.includes("/D="));
      assert(driverInstalls.length === 2, `驱动应发起两次安装,实际 ${driverInstalls.length} 次:${JSON.stringify(driverCalls)}`);
      assert(
        driverInstalls[0]?.includes(OPT_IN_SWITCH) === false,
        `驱动第一轮不应带开关,实际 ${JSON.stringify(driverInstalls[0])}`,
      );
      assert(
        driverInstalls[1]?.includes(OPT_IN_SWITCH) === true,
        `驱动第二轮应带开关 ${OPT_IN_SWITCH},实际 ${JSON.stringify(driverInstalls[1])}`,
      );
      // ⚠ 次序本身也是断言:NSIS 的 /D= 会把「从 /D= 到行尾」整段当安装目录。
      // 开关排在 /D= 之后时,真安装器把 InstallLocation 写成
      // "...\MarkdownToWord M2W_ADD_PATH=1",装到不存在的目录、报错完全指不到
      // 真正原因(实测踩过)。所以「开关必须在 /D= 之前」要钉住,不能靠人记得。
      const switchArg = driverInstalls[1]?.indexOf(OPT_IN_SWITCH) ?? -1;
      const dirArg = driverInstalls[1]?.indexOf("/D=") ?? -1;
      assert(
        switchArg !== -1 && dirArg !== -1 && switchArg < dirArg,
        `开关必须排在 /D= 之前(NSIS 把 /D= 到行尾当目录),实际 ${JSON.stringify(driverInstalls[1])}`,
      );
      console.log(
        "[ok] install-smoke:PATH 两轮(默认支一条不变 + 勾选支恰好多一条)判定正确,负向面(没写入/没还原/顺序乱)均判红",
      );
    }

    // ---------- 15. 残留检查面缺口①:安装账本键,且判的是它指向的路径 ----------
    //
    // 为什么这一段最要紧:真跑事故里被污染的 `InstallLocation` 就落在那个键上,而门禁当时
    // 是绿的(靠人工清掉)。旧检查面只认 Uninstall 注册表根 + 开始菜单 + 安装目录三处。
    //
    // 判法刻意**不是**「这个键还在不在」—— 键里存的是路径,所以两个方向都要判:
    //   A. 键留着(指向的目录已消失)= 注册表残留(键本身就是「装过」的证据,留着它下次装
    //      到同一目录会被 multiUser.nsh:26 当成既有安装);
    //   B. 键没了、但它装完时指向的目录留着 = 目录残留(靠「装完那一刻记下 InstallLocation」
    //      才判得到 —— 卸载后键已删,再读就无从知道它指向哪)。
    {
      const root = createSandbox();
      sandboxes.push(root);
      const shortcut = startMenuTraces(FIXTURE_PRODUCT).find((trace) => trace.kind === "shortcut");
      assert(shortcut !== undefined, "开始菜单痕迹清单应含 .lnk 快捷方式形态");
      const shortcutPath = shortcut.path;

      // A1 负向:卸载后账本键留着 —— 必须判红、点名键、并被自愈清掉。
      //    注意账本残留是**永久**的(不随卸载收尾消失),故它不会被「等收尾」等掉 ——
      //    这正是两处缺口不互相掩盖的原因之一。
      const keyLeft = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-keyleft"),
          ledgerOutcome: "keyLeft",
        }),
      );
      assert(keyLeft.result.code === 1, `账本键残留应判红,实际 ${keyLeft.result.code}\n${keyLeft.output}`);
      assert(
        keyLeft.output.includes(FIXTURE_LEDGER_KEY),
        `失败输出应点名残留的账本键完整键名;实际:${keyLeft.output}`,
      );
      assert(
        keyLeft.output.includes("本次运行新增了安装残留"),
        `应报出「新增残留」这条根因;实际:${keyLeft.output}`,
      );
      assert(
        keyLeft.result.deletedKeys.join("|") === FIXTURE_LEDGER_KEY,
        `账本键应被自愈清掉(沙盒记账替身);实际 ${JSON.stringify(keyLeft.result.deletedKeys)}`,
      );
      // ⚠ 这一格刻意是**永久**残留(不随卸载收尾消失),而门禁此刻正在跑「等卸载器收尾」那个
      // 预算 —— 若那个等待把它等掉了,本格就再也判不红,门禁对账本键重新失明(回到出事那天
      // 的状态)。故本段三条负向夹具在结构上就是「熬过等待仍判红」的证据。
      // 「等满预算」这个事实本身由第 16 段在缺口②自己的检查面上断言(放在这里会让两段
      // 共用一张票,变异实验就分不出是哪处在起作用)。

      // A2 负向:键删了,但它装完时指向的目录留着 —— 方向 B。
      //    InstallLocation 带上污染后缀,复现 `/D=` 吞掉 PATH 开关那次写出来的值。
      const pollutedSuffix = " M2W_ADD_PATH=1";
      const pathLeft = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed2", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-pathleft"),
          ledgerOutcome: "pathLeft",
          pollutedSuffix,
        }),
      );
      assert(pathLeft.result.code === 1, `账本指向的目录残留应判红,实际 ${pathLeft.result.code}\n${pathLeft.output}`);
      assert(
        pathLeft.output.includes(`${path.join(root, "installed2", FIXTURE_PRODUCT)}${pollutedSuffix}`),
        `应点名账本键装完时指向的那个目录(含污染后缀,原样可核对);实际:${pathLeft.output}`,
      );

      // A3 负向:「污染值」这一条不能靠「精确等于安装目录」判 —— `/D=` 吞参数那次写出来的
      //    InstallLocation 正是多了后缀的值,精确相等会把它整个漏掉。
      const pollutedKeyLeft = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed3", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-polluted"),
          ledgerOutcome: "keyLeft",
          pollutedSuffix,
        }),
      );
      assert(
        pollutedKeyLeft.result.code === 1,
        `InstallLocation 被污染时账本键仍应判红(不得因「不等于安装目录」而漏掉),实际 ${pollutedKeyLeft.result.code}\n${pollutedKeyLeft.output}`,
      );
      assert(
        pollutedKeyLeft.output.includes(FIXTURE_LEDGER_KEY),
        `污染场景下也应点名账本键;实际:${pollutedKeyLeft.output}`,
      );

      // A4 反向(防误伤):安装前就存在的账本键 = 既有安装,删它就是误删用户的东西。
      const preExisting = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed4", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-preexisting"),
          preExistingLedger: true,
        }),
      );
      assert(
        preExisting.result.code === 0,
        `既有安装的账本键不属本次残留,不该判红;实际 ${preExisting.result.code}\n${preExisting.output}`,
      );
      assert(
        preExisting.result.deletedKeys.length === 0,
        `安装前就存在的账本键绝不删除;实际 ${JSON.stringify(preExisting.result.deletedKeys)}`,
      );

      // A5 反向(防误伤):同机器上别的 Electron 应用也各有一个带 InstallLocation 的键 ——
      //    归属判据(该值含本产品名)必须把它排除,否则门禁会去删别人的安装键。
      const otherApp = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed5", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-otherapp"),
          otherAppLedger: true,
        }),
      );
      assert(
        otherApp.result.code === 0,
        `别人的账本键不得算成本次残留;实际 ${otherApp.result.code}\n${otherApp.output}`,
      );
      assert(
        !otherApp.output.includes(FIXTURE_OTHER_LEDGER_KEY),
        `别人的键不该出现在残留/清理报告里;实际:${otherApp.output}`,
      );
      assert(
        otherApp.result.deletedKeys.length === 0 && otherApp.result.removedPaths.length === 0,
        `别人的账本键与快捷方式都不得动;实际 ${JSON.stringify(otherApp.result.deletedKeys)} / ${JSON.stringify(otherApp.result.removedPaths)}`,
      );

      // A6 正向:干净卸载 → 绿,且账本键确实被查过(不是「压根没查所以没红」)。
      const clean = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed6", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-clean"),
        }),
      );
      assert(clean.result.code === 0, `干净卸载应通过,实际 ${clean.result.code}\n${clean.output}`);
      assert(
        clean.result.ledgerProbes >= 2,
        `账本键必须真被查过(安装前 + 卸载后各至少一次),实际查了 ${clean.result.ledgerProbes} 次`,
      );
      assert(
        /安装目录\/开始菜单\/卸载注册表\/安装账本键/.test(clean.output),
        `通过结论行应报出四处检查面;实际:${clean.output}`,
      );
      assert(!clean.result.removedPaths.includes(shortcutPath), "干净路径不应有删除动作");
      console.log(
        "[ok] install-smoke:账本键纳入残留检查面(键留着/键没了目录留着 两个方向均判红并被自愈),既有安装与他人键不误伤",
      );
    }

    // ---------- 16. 残留检查面缺口②:拍快照前要等卸载器收尾,而不是只等安装目录 ----------
    //
    // 这一段要证的是**没有假阳性**:卸载器派生临时副本自行完成删除,父进程退出时它可能
    // 才刚开始删注册表。旧口径只等 installDir 消失就拍快照 ⇒ 第一轮被判出残留并要求人工
    // `reg delete`,而独立复核时那两条早已消失(同一个卸载器二进制第二轮零残留)。
    // 假阳性比没有检查更坏:它会训练人忽略这条判红。
    //
    // 收尾判据是**状态**:等本次新增的残留集合真的清空。固定 sleep 做不到这一点 ——
    // 阈值猜短了照样假阳性,猜长了白等,机器一慢就重新欠账。
    {
      const root = createSandbox();
      sandboxes.push(root);
      const shortcut = startMenuTraces(FIXTURE_PRODUCT).find((trace) => trace.kind === "shortcut");
      assert(shortcut !== undefined, "开始菜单痕迹清单应含 .lnk 快捷方式形态");
      const shortcutPath = shortcut.path;

      // 负向夹具:卸载注册表项与快捷方式在头两次残留采样里仍在(临时副本还没删完),
      // 第三次才消失 —— 模拟真机上那个「目录早没了、键还没删」的窗口。
      // `leaveRegistry: false` = 滞后结束后它们真的被清掉(即这是**假阳性**那一侧:
      // 独立复核时它们早已消失,门禁判红就是错的)。
      const late = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-late"),
          latePolls: 2,
          timeoutMs: 8000,
        }),
      );
      assert(
        late.result.code === 0,
        `卸载器滞后清理不得判红(等收尾就是为消除这类假阳性),实际 ${late.result.code}\n${late.output}`,
      );
      assert(
        !late.output.includes("本次运行新增了安装残留"),
        `滞后清理收敛后不应报残留;实际:${late.output}`,
      );
      assert(
        late.result.registryProbes >= 3,
        `必须真的轮询等到收敛(至少 3 次采样),实际 ${late.result.registryProbes} 次 —— `
          + `若只有 1 次,说明没等就拍了快照,这条断言就成了一张空票`,
      );
      assert(
        late.result.deletedKeys.length === 0 && late.result.removedPaths.length === 0,
        `最终收敛 ⇒ 无需自愈(实际删了 ${JSON.stringify(late.result.deletedKeys)} / ${JSON.stringify(late.result.removedPaths)})`,
      );

      // 同一次滞后的另一面:账本键也滞后。正向仍须是绿 —— 判据是状态,不是某个面的特例。
      const lateLedger = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed2", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-lateledger"),
          ledgerOutcome: "clean",
          latePolls: 2,
          timeoutMs: 8000,
        }),
      );
      assert(
        lateLedger.result.code === 0,
        `账本键滞后清理同样应等到收敛,实际 ${lateLedger.result.code}\n${lateLedger.output}`,
      );
      assert(
        lateLedger.result.ledgerProbes >= 3,
        `账本键也必须被轮询等到(至少 3 次采样),实际 ${lateLedger.result.ledgerProbes} 次`,
      );

      // 反向:真残留(永久存在)不能被「等收尾」等掉 —— 烧完预算后必须照实判红。
      // 残留刻意放在**卸载注册表项 + 快捷方式**上(账本键留干净):账本键那面归第 15 段,
      // 这里用它当证据就变成两条缺口共用一张票,变异实验就分不出是哪处在起作用了。
      const permanent = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed3", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-permanent"),
          ledgerOutcome: "clean",
          leaveRegistry: true,
          timeoutMs: 1000,
        }),
      );
      assert(
        permanent.result.code === 1,
        `永久残留必须判红(等收尾不得把真残留等掉),实际 ${permanent.result.code}\n${permanent.output}`,
      );
      assert(
        permanent.output.includes(FIXTURE_NEW_KEY) && permanent.output.includes(shortcutPath),
        `应逐项点名卸载注册表项与快捷方式;实际:${permanent.output}`,
      );
      assert(
        /等待卸载器收尾 \d+ms\(上限 \d+ms\)后本次新增残留仍未清空/.test(permanent.output),
        `等满预算这一事实本身应被报出来(它排除了「只是慢」这一解释);实际:${permanent.output}`,
      );

      // 既有安装那一轮:「安装目录」这一项本来就判不了,不该为此白等整个收尾预算。
      const preexistingDir = await withCapturedOutput(() =>
        runInstallWithFakeResidue({
          installDir: path.join(root, "installed4", FIXTURE_PRODUCT),
          scratchRoot: path.join(root, "scratch-preexistingdir"),
          leaveRegistry: true,
          installDirExistedBefore: true,
          timeoutMs: 8000,
        }),
      );
      assert(
        preexistingDir.result.code === 1,
        `卸载注册表项残留仍须判红;实际 ${preexistingDir.result.code}\n${preexistingDir.output}`,
      );
      assert(
        preexistingDir.output.includes(FIXTURE_NEW_KEY),
        `既有目录那一轮同样要逐项点名(跳过等待 ≠ 跳过判定);实际:${preexistingDir.output}`,
      );
      assert(
        !/等待卸载器收尾/.test(preexistingDir.output),
        `安装目录安装前就存在那一轮不等收尾(那一项判不了,等它只是白等预算);实际:${preexistingDir.output}`,
      );
      console.log(
        "[ok] install-smoke:卸载后残留快照等「卸载器收尾」(残留集合清空)再拍,滞后清理不判红(无假阳性),真残留仍判红",
      );
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
