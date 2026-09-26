// @ts-check
/**
 * 测试段执行框架(逐段子进程隔离,正式口径见 docs/ADR.md 的 ADR-015「测试工程化与范围纳入」):
 * - 段文件 = test/segments/、test/main/ 或 test/renderer/ 下 *.test.js,须导出 async function run()
 * - 新增测试 = 新建段文件即可,零注册(入口按目录顺序自动发现)
 * - 单段筛选(选择面):设 M2W_ONLY=basic-render,mermaid 可只跑名称含任一子串的段
 *   (逗号分隔多个子串,大小写不敏感,匹配段名如 segments/basic-render.test.js;
 *   不设该变量时行为与全量运行完全一致)。筛选在**父进程**做,子进程只跑指定段。
 * - 「选择」与「发现」是两个语义(见 resolveOnlySelection 的契约单源):M2W_ONLY 只
 *   回答「harness 这一轮跑哪些**顶层**段」;段内自己 runAll/discoverSegments 要跑哪些段
 *   由该调用显式声明(only 参数),不受外层筛选词影响 —— 否则段内自测(如本框架的
 *   runner-report 自测段)会被外层筛选词滤空,且隔离模型下(M2W_ONLY 单段调试)恒红。
 * - 执行模型(默认):父进程为每段派生**独立 Electron 子进程**(test/common/segment-host.mjs),
 *   段内崩溃/悬挂/超时只终结该段(超时由父进程真杀进程树,非 race 后放弃),其余段照常跑完;
 *   每段独立 userData 目录(见 test/common/userdata.js),退出即清理,故段间零状态串扰。
 * - 并发(零状态串扰的另一面收益):设 M2W_TEST_CONCURRENCY=n 让编排器用 n 个槽位并发跑段
 *   (默认 1 = 与旧串行路径逐字等价,见 resolveConcurrency)。并发 > 1 时段输出改走管道、
 *   逐行加「[段名] 」前缀(见 createPrefixedForwarder 的两条硬约束),失败段的原始输出并进
 *   该段既有 failure.log。命中 EXCLUSIVE_SEGMENTS 的段整轮先以并发 1 单独跑完,其余段才进池;
 *   段结果一律按发现顺序返回,故报告与完成顺序无关。并发变量不下传段内嵌套编排(与 ONLY_ENV
 *   同一纪律:并发面/选择面只属顶层编排,段内自跑是夹具进程)。
 * - 回退模型(仅供二分定位):设 M2W_ACCEPTANCE_INPROC=1 切回同进程顺序执行 +
 *   看门狗(race 后放弃,悬挂段无法终止,靠入口收尾硬退出释放);生产/CI 走默认隔离模型。
 * - case 级契约(可选):段内用 test/common/case.js 的 createCaseSuite 登记具名 case,
 *   run() 返回 `{ cases }` 即可;隔离模型下由子进程结构化回传(形状与同进程一致),
 *   runner 聚合后由入口打印 case 级报告。段内 case 失败同样把整段判失败
 *   (错误聚合为一条 Error),未接入的旧段行为不变(抛错即段失败)。
 * - 失败产物:失败段统一落盘 output/artifacts/failures/<段名>/(失败日志 + 该段登记的
 *   buffer 快照),见 artifacts.saveFailureArtifacts。隔离模型下 buffer 快照经
 *   base64 由子进程回传(仅失败段带),落盘仍只有父进程一处。
 */
import { spawn, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { saveFailureArtifacts } from "./artifacts.js";
import { drainSuites } from "./case.js";
import { repoRelative } from "./paths.js";
import { createTempUserData, removeTempUserData, USER_DATA_ENV } from "./userdata.js";

/** 段子进程宿主入口(父进程与宿主共用同一 Electron 可执行文件,一次只跑一个段) */
const SEGMENT_HOST = fileURLToPath(new URL("./segment-host.mjs", import.meta.url));
/** 父进程 → 子进程:待跑段文件绝对路径 */
export const SEGMENT_FILE_ENV = "M2W_SEGMENT_FILE";
/** 父进程 → 子进程:结果回传文件绝对路径(宿主原子写,父进程读) */
export const SEGMENT_RESULT_ENV = "M2W_SEGMENT_RESULT";
/** 顶层段筛选词的环境变量名(选择面输入;段内发现面不消费,见 resolveOnlySelection) */
export const ONLY_ENV = "M2W_ONLY";
/** 顶层段并发槽位数环境变量名(并发面输入;默认 1 = 串行,段内嵌套编排不消费) */
export const CONCURRENCY_ENV = "M2W_TEST_CONCURRENCY";
/** 覆盖采集环境变量名(c8 只注入这一个;覆盖率那一轮由 c8 设,见 package.json 的 test:coverage) */
const COVERAGE_ENV = "NODE_V8_COVERAGE";
/** 回退开关:设 1/true 切回同进程模型(仅二分定位用,默认隔离) */
export const INPROC_ENV = "M2W_ACCEPTANCE_INPROC";
/** 每段 userData 目录名前缀(与段内业务临时目录 m2w-* 区分,便于识别残留) */
const SEGMENT_USERDATA_PREFIX = "m2w-segment-";
/** 结果回传文件名(落在该段 userData 目录内,随目录一起清理) */
const RESULT_FILE = "segment-result.json";
/** 硬杀进程树后等待 exit 事件的上限(超过则按"已终止"记账并继续,留痕告警) */
const KILL_GRACE_MS = 10000;
/** 段退出后等待其 stdout/stderr 管道排空的上限(到期照常 flush,见 drainPipes) */
const PIPE_DRAIN_MS = 2000;
/** 并发模式下失败段原始输出的缓冲上限:头留这么多(段开头最有诊断价值) */
const LOG_HEAD_LIMIT = 200 * 1024;
/** 并发模式下失败段原始输出的缓冲上限:尾留这么多(崩溃点通常在末尾) */
const LOG_TAIL_LIMIT = 200 * 1024;

/**
 * 必须独占槽位的段(整轮先以并发 1 单独跑完,不与其余段并发),硬编码不做配置化。
 * 匹配口径与 M2W_ONLY 一致(对完整段名做大小写不敏感的包含匹配),故段在目录间移动不失效。
 * - `gate-probes` 独占的原因:该段断言「真实工作树内容指纹前后未变」,而 scripts/gate-probes/
 *   contract.mjs 的 PROTECTED_PATHS 含 `output`;同一轮里约 20 个段绿跑时都会经 saveArtifact
 *   写 output/artifacts/*.docx|pdf(runner 自测段还会建删 output/tmp/),它 14 秒的探针窗口内
 *   `output/` 几乎必然变动 → **确定性自判红**,不是 flake。故必须独占,且不得用「加开关把它
 *   降级成建议项」来绕过(那等于永久删掉沙箱纪律那道守护)。
 * - 若将来再出现同类对工作树/共享路径敏感的段(如新增的指纹/快照比对段),加进这个集合即可,
 *   不要改成配置项:配置化等于允许有人在 CI 上把它关掉,而这类假红是「确定性的」,危害远大于
 *   串行那十几秒。
 */
const EXCLUSIVE_SEGMENTS = ["gate-probes"];

/* ---------- 本文件契约类型(单一来源,消费方 import type 用) ---------- */

/**
 * @typedef {import("./case.js").CaseResult} CaseResult 单个 case 的结果(契约单源在 case.js)
 */

/**
 * @typedef {object} SegmentDescriptor 段描述(发现阶段产出)
 * @property {string} dir 段所在目录绝对路径
 * @property {string} file 段文件名
 * @property {string} name 段名(目录前缀 + 文件名,如 segments/basic-render.test.js)
 */

/**
 * @typedef {object} SegmentRunResult 单段执行的原始结果(隔离模型与同进程回退模型共用形状)
 * @property {boolean} ok
 * @property {number} ms
 * @property {unknown} [ret] 段 run() 返回值
 * @property {unknown} [error] 段级错误(隔离模型恒为 Error;回退模型为段内抛出原值)
 * @property {boolean} [timedOut]
 * @property {string} [log] 段 stdout/stderr 原文(仅并发模式的管道转发有;串行模式无此键)
 */

/**
 * @typedef {object} SegmentResultEntry runAll 汇总的段结果项(报告与失败产物的事实来源)
 * @property {string} file 段名
 * @property {boolean} ok
 * @property {number} ms
 * @property {unknown} [error]
 * @property {boolean} [timedOut]
 * @property {CaseResult[]} [cases] 接入 case 契约的段才有
 * @property {string} [failureDir] 失败产物目录(仅失败段落盘成功后有)
 */

/**
 * @typedef {object} ChildExitInfo 子进程退出/硬杀记账信息(隔离模型 settle 的载荷)
 * @property {number | null} code 退出码(null = 信号终止或启动失败)
 * @property {string | null} signal 终止信号
 * @property {boolean} timedOut 是否由硬超时触发
 * @property {boolean} [unterminated] 硬杀后仍未退出(句柄被占用等)
 * @property {Error} [spawnError] 子进程启动失败
 */

/**
 * 段选择/段发现语义的解析单源(两个语义在此分开,调用点不再各打补丁):
 * - `only` 未声明(undefined)→ 读环境变量 ONLY_ENV:顶层 harness 的默认行为
 *   (这一轮 harness 跑哪些顶层段),亦即既有单段筛选用法;
 * - `only` 显式为 null → **不筛选**:段内嵌套编排用它把「发现面」与外层「选择面」
 *   隔开(段内自跑要跑哪些段由自己声明,不被外层筛选词误伤);
 * - `only` 显式为字符串 → 用该词筛选(段内自跑要筛子集时直接给词,不必改环境变量)。
 * 空串/纯空白视为不筛选(与「未设环境变量」同义)。
 * @param {string | null | undefined} only 调用方声明的筛选词
 * @returns {string | null} 生效的筛选词;null = 不筛选
 */
export function resolveOnlySelection(only) {
  if (only === null) return null;
  const raw = typeof only === "string" ? only : process.env[ONLY_ENV];
  return raw?.trim() || null;
}

/**
 * 并发槽位数解析单源(与 resolveIsolation 同款「显式优先、否则读环境变量」形态):
 * - `options.concurrency` 是合法正整数 → 直接采用(调用方显式声明,供嵌套编排/测试注入);
 * - 否则读环境变量 CONCURRENCY_ENV;**未设时为 1**,即默认路径与旧的逐字串行执行等价。
 * 非法值(0 / 负数 / 小数 / `abc` / 空串 / NaN)一律回落到 1 —— 绝不接受它变成"无限并发"
 * 或 NaN 个 worker(那会让 118 段同时抢核,得到的是超时与句柄争抢,不是加速)。超过段数的值
 * 夹取到段数(槽位多于段只是空转,语义上无差别,夹取后报告更好解释)。
 * 段内嵌套编排拿不到这个变量(父进程剥掉,见 runSegmentIsolated):并发面只属顶层编排。
 * @param {{ concurrency?: number, total?: number }} [options] 显式并发与本轮段数(夹取用)
 * @returns {number} 生效槽位数(≥1 的整数)
 */
export function resolveConcurrency({ concurrency, total } = {}) {
  const requested = typeof concurrency === "number" ? concurrency : Number(process.env[CONCURRENCY_ENV]);
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return typeof total === "number" && Number.isInteger(total) && total > 0 ? Math.min(requested, total) : requested;
}

/**
 * 段是否命中独占集合(须整轮单独跑,不进并发池):口径与 EXCLUSIVE_SEGMENTS 的定义一致,
 * 命中理由见该常量注释(独占是因为对工作树/共享路径敏感,与其它段并发必假红)。
 * @param {SegmentDescriptor} s 段描述
 * @returns {boolean} true = 独占段
 */
function isExclusiveSegment(s) {
  const lower = s.name.toLowerCase();
  return EXCLUSIVE_SEGMENTS.some((needle) => lower.includes(needle));
}

/**
 * 按传入目录顺序发现全部测试段文件(目录内按文件名排序);
 * 返回 { dir, file, name },name 带目录前缀(如 segments/basic-render.test.js),
 * 避免跨目录重名混淆,也便于阅读。
 * only 的三态语义见 resolveOnlySelection:未声明=读 M2W_ONLY(顶层默认)/ null=不筛选
 * (段内嵌套编排)/ 字符串=按词筛。筛选对完整段名做大小写不敏感的包含匹配。
 * @param {string[]} dirs 段目录绝对路径(按此顺序发现)
 * @param {{ only?: string | null }} [options] 发现面的显式声明
 * @returns {Promise<SegmentDescriptor[]>}
 */
export async function discoverSegments(dirs, { only } = {}) {
  /** @type {SegmentDescriptor[]} */
  const found = [];
  for (const dir of dirs) {
    const prefix = path.basename(dir);
    const entries = await fs.readdir(dir);
    for (const f of entries.filter((f) => f.endsWith(".test.js")).sort()) {
      found.push({ dir, file: f, name: `${prefix}/${f}` });
    }
  }
  const selection = resolveOnlySelection(only);
  if (selection === null) return found;
  const needles = selection.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return found;
  return found.filter((s) => needles.some((n) => s.name.toLowerCase().includes(n)));
}

/**
 * 加载并执行单个测试段(段内断言失败应 throw,由调用方汇总)。
 * 返回段 run() 的返回值(case 契约的 `{ cases, artifacts }` 即由此上送)。
 * @param {string} fileUrl 段文件 URL
 * @returns {Promise<unknown>} 段 run() 返回值
 */
export async function runSegment(fileUrl) {
  const mod = await import(fileUrl);
  if (typeof mod.run !== "function") {
    throw new Error("测试段缺少 run() 导出");
  }
  return await mod.run();
}

/* ---------- case 契约聚合(同进程与子进程两条路径共用,单一来源) ---------- */

/**
 * case 级失败聚合为一条 Error:段内 case 不抛,段级失败由这里归一(栈替换为 case 明细,
 * 避免报告里出现 runner 内部帧淹没真实失败点)。
 * @param {CaseResult[]} cases
 * @returns {Error}
 */
export function caseFailureError(cases) {
  const failed = cases.filter((c) => !c.ok);
  const detail = failed
    .map((c) => `  - ${c.group ? `${c.group} › ` : ""}${c.name}: ${c.message ?? "未知失败"}`)
    .join("\n");
  const error = new Error(`${failed.length}/${cases.length} 个 case 失败:\n${detail}`);
  error.stack = error.message;
  return error;
}

/**
 * 收集一段的 case 结果与产物快照(同进程与子进程宿主共用的同一判定):
 * 段 run() 回传优先;未回传则取本进程登记的 suite(防漏回传被静默判过)。
 * @param {unknown} ret 段 run() 返回值
 * @returns {{ cases: CaseResult[], artifacts: {name: string, buffers: Record<string, Buffer>}[] }}
 */
export function collectSegmentOutcome(ret) {
  const collected = drainSuites();
  /** @type {{ cases?: CaseResult[], artifacts?: {name: string, buffers: Record<string, Buffer>}[] }} */
  const payload = /** @type {any} */ (ret) ?? {};
  return {
    cases: Array.isArray(payload.cases) ? payload.cases : collected.flatMap((h) => h.cases),
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : collected.flatMap((h) => h.snapshots),
  };
}

/**
 * 判定一段的成败:段级抛错优先,否则有失败 case 即判失败(错误聚合为一条)。
 * @param {{cases: CaseResult[]}} outcome collectSegmentOutcome 的结果
 * @param {unknown} [error] 段级错误(无则按 case 结果判定)
 * @returns {Error | undefined} 段级错误(通过则 undefined)
 */
export function segmentOutcomeError(outcome, error) {
  if (error) return /** @type {Error} */ (error);
  return outcome.cases.some((c) => !c.ok) ? caseFailureError(outcome.cases) : undefined;
}

/* ---------- 子进程结果回传载荷(父子契约,宿主写 / 父进程读) ---------- */

/**
 * @typedef {object} SegmentResultPayload 子进程 → 父进程的结果载荷
 * @property {boolean} complete run() 是否已跑完(false = 段被硬终止,只有超时前进度)
 * @property {boolean} ok 段是否通过
 * @property {{message: string, stack?: string} | null} error 段级错误(已归一为可序列化形状)
 * @property {CaseResult[]} cases case 结果(形状与同进程一致,见 case.js CaseResult)
 * @property {{name: string, buffers: Record<string, string>}[]} artifacts 产物快照(base64;仅失败段带)
 */

/**
 * 产物快照编码为 JSON 形状(buffer → base64):仅失败段回传,成功段不付序列化成本。
 * @param {{name: string, buffers: Record<string, Buffer>}[]} snapshots
 * @returns {{name: string, buffers: Record<string, string>}[]}
 */
export function encodeArtifactSnapshots(snapshots) {
  return snapshots.map(({ name, buffers }) => ({
    name,
    buffers: Object.fromEntries(
      Object.entries(buffers).map(([ext, buf]) => [ext, Buffer.from(buf).toString("base64")]),
    ),
  }));
}

/**
 * 产物快照解码回 Buffer 集合(父进程落盘失败快照用)。
 * @param {{name: string, buffers: Record<string, string>}[]} snapshots
 * @returns {{name: string, buffers: Record<string, Buffer>}[]}
 */
export function decodeArtifactSnapshots(snapshots) {
  return snapshots.map(({ name, buffers }) => ({
    name,
    buffers: Object.fromEntries(
      Object.entries(buffers).map(([ext, b64]) => [ext, Buffer.from(b64, "base64")]),
    ),
  }));
}

/**
 * 原子写结果回传文件(先写 .tmp 再 rename,避免父进程读到半截 JSON)。
 * @param {string} resultPath 结果文件路径
 * @param {SegmentResultPayload} payload 结果载荷
 */
export function writeSegmentResult(resultPath, payload) {
  const tmp = `${resultPath}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fsSync.renameSync(tmp, resultPath);
}

/**
 * 读回结果载荷;文件不存在/JSON 损坏(如宿主被硬杀在写盘中途)→ null,由父进程按
 * 崩溃/超时归一。
 * @param {string} resultPath 结果文件路径
 * @returns {Promise<SegmentResultPayload | null>}
 */
export async function readSegmentResult(resultPath) {
  let text;
  try {
    text = await fs.readFile(resultPath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 把回传载荷的段级错误还原为 Error 对象(报告按 error.stack 打印,形状与同进程一致)。
 * @param {SegmentResultPayload} payload
 * @returns {Error | undefined}
 */
export function reviveSegmentError(payload) {
  if (!payload.error) return undefined;
  const error = new Error(payload.error.message);
  if (payload.error.stack) error.stack = payload.error.stack;
  return error;
}

/* ---------- 隔离执行:父进程派生一个段一个子进程 ---------- */

/**
 * 硬杀子进程及其派生进程:Windows 无进程组,`taskkill /T` 才能连带终止 Electron
 * 拉起的渲染/GPU 进程(否则渲染进程会变孤儿,句柄不释放 → 临时目录删不掉);
 * 其它平台用 SIGKILL。
 * @param {import("node:child_process").ChildProcess} child 子进程句柄
 */
function killProcessTree(child) {
  if (typeof child.pid !== "number") return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGKILL");
}

/**
 * 隔离模型下跑单段:派生独立 Electron 子进程,硬超时真杀进程树,读回结构化结果。
 * - 段内抛错 → 子进程回传 error,本段失败(其余段不受影响);
 * - 段崩溃(渲染进程崩溃/未捕获异常/硬 exit)→ 无回传或 complete=false,按崩溃归一;
 * - 超时 → 杀掉进程树,该段记 timeout 失败;回传文件里若有超时前已完成的 case
 *   (宿主经 case 进度钩子增量落盘),一并作为失败面证据;
 * - 子进程 env 不含 ONLY_ENV 与 CONCURRENCY_ENV(顶层筛选词/并发槽位只属顶层,段内发现面
 *   与嵌套编排都不消费:段内自跑派生的是夹具进程,叠上外层池会与池抢核);
 * - 嵌套编排(父进程自身是段宿主)派生的子进程 env 另不含覆盖采集环境(见该分支注释)。
 * @param {SegmentDescriptor} s 段描述
 * @param {number} timeout 硬超时(ms);0/NaN 等无效值 = 不启用(等段自然结束)
 * @param {{ captureLog?: boolean }} [options] captureLog = 走管道转发段输出(并发模式)
 * @returns {Promise<SegmentRunResult>}
 */
async function runSegmentIsolated(s, timeout, { captureLog = false } = {}) {
  const start = Date.now();
  const userDataDir = createTempUserData(SEGMENT_USERDATA_PREFIX);
  const resultPath = path.join(userDataDir, RESULT_FILE);
  // 串行(并发 = 1):段内 stdout/stderr 直接继承父进程,段内日志原样出现在总输出里,不经管道。
  // 并发(> 1):多段子进程的输出会互相穿插,改走管道逐行加「[段名] 」前缀(前缀让归属可辨),
  // 并按上限缓冲原文供失败日志取用(见 createPrefixedForwarder 的两条硬约束)。
  // 顶层筛选词 ONLY_ENV 与并发变量 CONCURRENCY_ENV 都不下传:段清单与槽位数已由
  // M2W_SEGMENT_FILE 与父进程池决定,子进程再读到它们只会让「段内自跑」被外层筛选词误伤、
  // 或让夹具进程与外层池抢核(发现面/并发面必须互不影响,见文件头)
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {
    ...process.env,
    [SEGMENT_FILE_ENV]: path.join(s.dir, s.file),
    [SEGMENT_RESULT_ENV]: resultPath,
    // 覆盖(而非透传)外层的同名变量:嵌套编排(如 runner 自测段内再跑子进程段)
    // 时每段仍拿自己的新目录
    [USER_DATA_ENV]: userDataDir,
  };
  delete childEnv[ONLY_ENV];
  delete childEnv[CONCURRENCY_ENV];
  // 覆盖采集环境不下传给**嵌套编排**的子进程(段内自跑派生的是夹具进程,不执行 dist/**,
  // 对覆盖汇总零贡献)。原因不是省时间而是稳定性:c8 的覆盖写手挂在被测进程的退出路径上,
  // 活着的 Electron 主进程硬退(app.exit / process.exit)时回写覆盖会在 Windows runner 上
  // 以 0xC0000005 访问冲突**取代真实退出码**,于是「段崩溃应上报退出码」这类断言会以与
  // 被测行为无关的方式判红。判据取「父进程自身是段宿主」(M2W_SEGMENT_FILE 存在),故顶层
  // 段的覆盖采集不受影响。若将来新增的嵌套编排会执行 dist/**,必须在此显式保留采集 ——
  // 否则是静默少算覆盖率(比崩溃更难发现)。
  if (process.env[SEGMENT_FILE_ENV] !== undefined) delete childEnv[COVERAGE_ENV];
  const child = spawn(process.execPath, [SEGMENT_HOST], {
    stdio: ["ignore", captureLog ? "pipe" : "inherit", captureLog ? "pipe" : "inherit"],
    windowsHide: true,
    env: childEnv,
  });
  /** @type {ReturnType<typeof createPrefixedForwarder> | null} */
  let outForwarder = null;
  /** @type {ReturnType<typeof createPrefixedForwarder> | null} */
  let errForwarder = null;
  if (captureLog && child.stdout !== null && child.stderr !== null) {
    // setEncoding 必须在挂 data 之前:管道只搬字节,字符串化发生在读端
    outForwarder = createPrefixedForwarder(process.stdout, s.name);
    errForwarder = createPrefixedForwarder(process.stderr, s.name);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => outForwarder?.push(String(chunk)));
    child.stderr.on("data", (chunk) => errForwarder?.push(String(chunk)));
  }


  const timeoutEnabled = timeout > 0 && Number.isFinite(timeout);
  const exit = await /** @type {Promise<ChildExitInfo>} */ (
    new Promise((resolve) => {
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      /** @type {NodeJS.Timeout | undefined} */
      let graceTimer;
      let timedOut = false;
      const settle = (/** @type {ChildExitInfo} */ value) => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
        resolve(value);
      };
      if (timeoutEnabled) {
        timer = setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
          // 兜底:极端情况下(句柄被占用等)进程没被终结,不再无限等 exit,继续记账
          graceTimer = setTimeout(() => settle({ code: null, signal: "SIGKILL", timedOut, unterminated: true }), KILL_GRACE_MS);
        }, timeout);
      }
      child.once("error", (error) => settle({ code: null, signal: null, timedOut, spawnError: error }));
      child.once("exit", (code, signal) => settle({ code, signal, timedOut }));
    })
  );

  // 段已退出后管道里可能还留着内核已缓冲的数据,先排空再 flush 行拆分余量(否则尾部输出被截);
  // 排空有上限,被硬杀且句柄未释放的段可能永不 close,不能让它把编排器挂住
  if (outForwarder !== null && errForwarder !== null) {
    await drainPipes([child.stdout, child.stderr]);
    outForwarder.flush();
    errForwarder.flush();
  }
  const segmentLog =
    outForwarder === null || errForwarder === null
      ? ""
      : [outForwarder.text(), errForwarder.text()].filter((t) => t !== "").join("\n");
  /** 附上段输出(仅并发模式有;串行模式结果形状与旧路径逐字一致,无 log 键) */
  const withLog = (/** @type {SegmentRunResult} */ r) => (segmentLog === "" ? r : { ...r, log: segmentLog });

  const payload = await readSegmentResult(resultPath);
  removeTempUserData(userDataDir);
  const ms = Date.now() - start;
  const timedOut = Boolean(exit.timedOut);

  // 段已跑完 run() 并回传(退出慢/被杀只是收尾问题)→ 采信其结果
  if (payload?.complete) {
    if (timedOut) {
      console.warn(`[warn] ${s.name}:已回传完整结果但未在 ${timeout}ms 内退出,已终止子进程(段结果采信回传)`);
    }
    // 段级错误必须一并回传:只采信 ok 标志会把"段内抛错/case 失败"误判成通过
    const error = reviveSegmentError(payload);
    return withLog({
      ok: payload.ok && !error,
      ms,
      ret: {
        cases: Array.isArray(payload.cases) ? payload.cases : [],
        artifacts: decodeArtifactSnapshots(Array.isArray(payload.artifacts) ? payload.artifacts : []),
      },
      ...(error ? { error } : {}),
    });
  }

  const partialCases = Array.isArray(payload?.cases) ? payload.cases : [];
  if (timedOut) {
    return withLog({
      ok: false,
      ms,
      ret: { cases: partialCases, artifacts: [] },
      error: new Error(
        `测试段超时(${timeout}ms): ${s.name}(已硬终止该段子进程,后续段继续执行;以下 case 为超时前已完成的进度)`,
      ),
      timedOut: true,
    });
  }
  if (exit.unterminated) {
    console.warn(`[warn] ${s.name}:硬杀后子进程仍未退出(${KILL_GRACE_MS}ms),继续后续段(可能残留句柄)`);
    return withLog({
      ok: false,
      ms,
      ret: { cases: partialCases, artifacts: [] },
      error: new Error(`测试段子进程未在硬杀后退出(${KILL_GRACE_MS}ms): ${s.name}`),
    });
  }
  if (exit.spawnError) {
    return withLog({ ok: false, ms, error: new Error(`测试段子进程启动失败: ${s.name}: ${exit.spawnError.message}`) });
  }
  return withLog({
    ok: false,
    ms,
    ret: { cases: partialCases, artifacts: [] },
    error: new Error(
      `测试段子进程异常退出(${describeChildExitCode(exit.code)},无完整结果回传): ${s.name}(段崩溃;后续段继续执行)`,
    ),
  });
}

/**
 * 把子进程退出码标注成可读文案(win32 专属判读)。
 *
 * 为什么需要:Windows 上进程被**异常终止**时,父进程拿到的「退出码」其实是 NTSTATUS
 * 异常码,如 `3221225477` = `0xC0000005` = `STATUS_ACCESS_VIOLATION`(访问冲突)。
 * 直接印十进制,读者只会当成一个无意义的大数 —— 2026-09-26 那次 runner-only 失败
 * 就是这样:两轮复发各只拿到「实际 3221225477」这一个数字,无法据此判断是段自身崩了
 * 还是宿主被外部终止。标出异常名与「这通常不是段的断言失败」,下次复发日志自带线索。
 *
 * 口径:仅在 `code > 0x7fffffff`(即高位置 1 的 32 位值)时按 NTSTATUS 解读;
 * `0xC0000005` 这类高位异常码的十进制必然大于该界,正常的 0–255 退出码不会命中;
 * 边界值取自 Node 对 win32 退出码的既有处理(`process.exitCode` 在 win32 上限 32 位)。
 * 未收录的异常码只标「高位值(疑似异常终止)」,不猜具体含义。
 * @param {number | null | undefined} code 子进程退出码
 * @returns {string} 可直接嵌进错误文案的描述
 */
export function describeChildExitCode(code) {
  if (code === null || code === undefined) return "无退出码";
  if (!Number.isInteger(code) || code <= 0) return `退出码 ${String(code)}`;
  if (code <= 0x7fffffff) return `退出码 ${String(code)}`;
  const status = code >>> 0;
  const known = /** @type {Record<number, string>} */ ({
    0xc0000005: "STATUS_ACCESS_VIOLATION(访问冲突)",
    0xc0000409: "STATUS_STACK_BUFFER_OVERRUN(栈缓冲区溢出,常为 __fastfail)",
    0xc0000374: "STATUS_HEAP_CORRUPTION(堆损坏)",
    0xc0000006: "STATUS_IN_PAGE_ERROR(分页文件/内存映射读取失败)",
    0xc000001d: "STATUS_ILLEGAL_INSTRUCTION(非法指令)",
    0xc0000139: "STATUS_ENTRYPOINT_NOT_FOUND(入口点缺失)",
    0xc0000138: "STATUS_ORDINAL_NOT_FOUND(导出序号缺失)",
    0xc0000135: "STATUS_DLL_NOT_FOUND(DLL 缺失)",
    0xc0000142: "STATUS_DLL_INIT_FAILED(DLL 初始化失败)",
  });
  const name = known[status];
  return name === undefined
    ? `高位值 ${String(code)}(0x${status.toString(16).toUpperCase()},疑似异常终止,含义未收录)`
    : `异常终止 ${String(code)}=0x${status.toString(16).toUpperCase()} ${name} —— 这不是段的断言失败`;
}

/**
 * 等待一批管道的 close(任一流关完即视为排空,实际是同一子进程的两个句柄,一起关):
 * 段退出后 stdout/stderr 里可能还留着已缓冲数据,提前 flush 会截掉尾部输出。但被硬杀且
 * 句柄未释放的段可能永不 close,故设上限 PIPE_DRAIN_MS,到期照常 resolve —— 宁可尾部少几行,
 * 也不能让编排器挂在等管道上。
 * @param {(NodeJS.ReadableStream | null)[]} streams 待排空的流
 * @returns {Promise<void>}
 */
function drainPipes(streams) {
  const open = streams.filter((s) => s !== null);
  if (open.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, PIPE_DRAIN_MS);
    for (const s of open) s.once("close", finish);
  });
}

/**
 * 并发模式下某段输出的转发器:逐行加「[段名] 」前缀转发到父进程控制台,并按上限缓冲
 * 原文(head+tail)供失败日志取用。两条硬约束(都是踩过的坑,勿简化):
 * 1. **读端必须显式 `setEncoding("utf8")`**(由调用方在挂 data 之前做):管道只搬字节,
 *    损坏发生在读端 —— 不设编码时 Node 按 latin1 解码,会把 UTF-8 中文打成乱码,且事后
 *    无法修复。制表符不受影响:它是单字节,任何编码都不动它。仓库现成反例见
 *    test/segments/entry-exit-guard.test.js(Electron 子进程 + pipe + setEncoding("utf8")
 *    + 断言中文输出,长期为绿)。
 * 2. **只按 "\n" 切行做前缀,不得碰 "\t" 与 "\r"**:列对齐类输出里制表符有语义;行拆分器
 *    保留半行余量(chunk 边界不与行边界对齐,不能按 chunk 直接加前缀),进程退出时 flush
 *    余量,否则最后一行会丢。
 * @param {NodeJS.WriteStream} stream 转发目标流(段 stdout → process.stdout,stderr → process.stderr)
 * @param {string} name 段名(前缀内容)
 * @returns {{ push: (chunk: string) => void, flush: () => void, text: () => string }} 转发器
 */
function createPrefixedForwarder(stream, name) {
  const prefix = `[${name}] `;
  /** 上一 chunk 末尾的半行(下次 push 时先接上) */
  let remainder = "";
  let head = "";
  let tail = "";
  let total = 0;
  /** 记入缓冲:头满后只留尾(崩溃点通常在末尾);按字符数近似字节数,够用且不拆代理对
   * @param {string} text 一行原文(含结尾换行)
   * @returns {void}
   */
  const record = (text) => {
    total += text.length;
    let rest = text;
    if (head.length < LOG_HEAD_LIMIT) {
      const room = LOG_HEAD_LIMIT - head.length;
      const take = rest.length <= room ? rest : rest.slice(0, room);
      head += take;
      rest = rest.slice(take.length);
    }
    if (rest.length > 0) {
      const merged = tail + rest;
      tail = merged.length > LOG_TAIL_LIMIT ? merged.slice(merged.length - LOG_TAIL_LIMIT) : merged;
    }
  };
  return {
    push(chunk) {
      const lines = (remainder + chunk).split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        record(`${line}\n`);
        stream.write(`${prefix}${line}\n`);
      }
    },
    flush() {
      if (remainder === "") return;
      record(remainder);
      stream.write(`${prefix}${remainder}\n`);
      remainder = "";
    },
    text() {
      const omitted = total - head.length - tail.length;
      return omitted > 0
        ? `${head}…[段输出中间省略 ${omitted} 字符(缓冲上限:头 ${LOG_HEAD_LIMIT} + 尾 ${LOG_TAIL_LIMIT})]…\n${tail}`
        : head + tail;
    },
  };
}

/**
 * 并发池:n 个槽位各自串行取段,返回结果与入参顺序一致(与完成顺序无关)。
 * 单段 execute 已把抛错/超时/崩溃收敛为返回值(隔离模型下父进程硬杀其进程树),故池本身
 * 不做错误处理;真冒出未归一的异常也按段失败记账,不让整轮编排崩在编排器里。
 * @param {SegmentDescriptor[]} segments 待执行段(池内取用顺序)
 * @param {(s: SegmentDescriptor) => Promise<SegmentRunResult>} execute 单段执行器
 * @param {number} concurrency 槽位数(≥1;1 = 纯串行,与旧路径等价)
 * @returns {Promise<SegmentRunResult[]>} 与 segments 同序的结果
 */
async function runSegmentPool(segments, execute, concurrency) {
  /** @type {(SegmentRunResult | undefined)[]} */
  const slots = new Array(segments.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const segment = segments[index];
      if (segment === undefined) return;
      try {
        slots[index] = await execute(segment);
      } catch (err) {
        slots[index] = {
          ok: false,
          ms: 0,
          error: new Error(
            `段执行器抛出未归一异常: ${segment.name}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          ),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, () => worker()));
  return slots.map((r, i) => r ?? { ok: false, ms: 0, error: new Error(`段未执行(并发池记账缺口): ${segments[i]?.name ?? i}`) });
}

/**
 * 同进程回退模型下的单段执行(仅二分定位用,见文件头「回退模型」):
 * - 超时 → 该段标记失败,继续放行后续段(一次看全失败面),置 timedOut 标志。
 * - 已知局限:悬挂段与 runner 同进程,无法终止其 promise;超时后悬挂段仍后台残留,
 *   由 runAll 跑完全部段、入口打印结果后硬退出统一释放其资源。
 * - 段 promise 统一收敛为 `{ ret }`(正常)或 `{ error }`(段内抛错),故只有看门狗
 *   超时会走 reject 分支,`timedOut` 不再靠错误文案嗅探。
 * @param {SegmentDescriptor} s 段描述
 * @param {number} timeout 看门狗超时(ms);0/NaN 等无效值 = 不启用
 * @returns {Promise<SegmentRunResult>}
 */
async function runSegmentWithWatchdog(s, timeout) {
  const start = Date.now();
  /** @type {Promise<{ ret: unknown, error?: undefined } | { error: unknown, ret?: undefined }>} */
  const segmentPromise = runSegment(pathToFileURL(path.join(s.dir, s.file)).href).then(
    (ret) => ({ ret }),
    (error) => ({ error }),
  );
  const watchdogEnabled = timeout > 0 && Number.isFinite(timeout);
  let timer;
  /** @type {Promise<never> | undefined} */
  let watchdog;
  if (watchdogEnabled) {
    watchdog = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`测试段超时(${timeout}ms): ${s.name}(该段记失败,后续段继续执行,进程收尾硬退出释放悬挂资源)`)),
        timeout,
      );
    });
  }
  try {
    const settled = await (watchdog ? Promise.race([segmentPromise, watchdog]) : segmentPromise);
    if (settled.error) {
      return { ok: false, ms: Date.now() - start, error: settled.error, timedOut: watchdogEnabled ? false : undefined };
    }
    return { ok: true, ms: Date.now() - start, ret: settled.ret, timedOut: watchdogEnabled ? false : undefined };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err, timedOut: true };
  } finally {
    clearTimeout(timer);
    // 输家 promise 挂空 catch,防迟到的 unhandledRejection(悬挂段随进程硬退出终结)
    segmentPromise.catch(() => {});
    watchdog?.catch(() => {});
  }
}

/**
 * 失败日志正文:段名/耗时/超时标记 + case 明细(含失败消息、栈、附件引用)+ 段输出
 * (仅并发模式的管道缓冲有,见 createPrefixedForwarder)+ 段级错误。
 * @param {{file: string, ms: number, timedOut?: boolean, cases?: CaseResult[], error?: unknown, log?: string}} r 段结果
 * @returns {string}
 */
function buildFailureLog(r) {
  const lines = [
    `段: ${r.file}`,
    `结果: 失败${r.timedOut ? "(超时终止,以下 case 为超时前已完成的进度)" : ""}`,
    `耗时: ${r.ms}ms`,
    "",
  ];
  if (Array.isArray(r.cases) && r.cases.length > 0) {
    lines.push("case 明细:");
    for (const c of r.cases) {
      const title = c.group ? `${c.group} › ${c.name}` : c.name;
      lines.push(`  - [${c.ok ? "通过" : "失败"}] ${title} (${c.ms}ms)`);
      // 附件对通过 case 同样登记(快照取该段已产出的产物),故两种状态都列
      if (Array.isArray(c.attachments) && c.attachments.length > 0) {
        lines.push(`      附件: ${c.attachments.join(", ")}`);
      }
      if (!c.ok) {
        lines.push(`      消息: ${c.message ?? "未知失败"}`);
        // 栈首行通常是 "Error: <消息>",与上面的消息行重复,去掉只留调用帧
        const frames = typeof c.stack === "string" ? c.stack.split("\n") : [];
        if (frames.length > 0 && c.message && (frames[0] ?? "").includes(c.message)) frames.shift();
        if (frames.length > 0) {
          lines.push(...frames.map((line) => `      ${line}`));
        }
      }
    }
    lines.push("");
  }
  // 并发模式下段 stdout/stderr 已被管道缓冲(头尾各留上限,中间标注省略),并进同一份
  // failure.log:崩溃/超时的真正原因通常只在段自己的输出里,不另开目录
  if (typeof r.log === "string" && r.log !== "") {
    lines.push("段输出(stdout/stderr):", r.log, "");
  }
  lines.push("段级错误:", r.error instanceof Error ? (r.error.stack ?? r.error.message) : String(r.error));
  return `${lines.join("\n")}\n`;
}

/**
 * case 汇总(仅统计接入 case 契约的段)。
 * @param {{cases?: CaseResult[]}[]} results 段结果
 * @returns {{ segments: number, passed: number, failed: number, total: number }}
 */
export function summarizeCases(results) {
  let segments = 0;
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (!Array.isArray(r.cases) || r.cases.length === 0) continue;
    segments += 1;
    for (const c of r.cases) {
      if (c.ok) passed += 1;
      else failed += 1;
    }
  }
  return { segments, passed, failed, total: passed + failed };
}

/**
 * case 级报告正文(入口打印):失败 case 显示「段名 › case 名: 消息」+ 附件/失败产物
 * 路径;每段显示通过数;末尾一行合计。无 case 契约的段 = 返回空串(旧段输出不变)。
 * @param {SegmentResultEntry[]} results 段结果
 * @returns {string} 多行报告;无 case 结果时为空串
 */
export function formatCaseReport(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length > 0);
  if (withCases.length === 0) return "";
  const lines = [];
  for (const r of withCases) {
    const cases = r.cases ?? []; // 上方 filter 已保证为非空数组
    const failed = cases.filter((c) => !c.ok).length;
    lines.push(`[cases] ${r.file}: ${cases.length - failed} 通过 / ${failed} 失败`);
    for (const c of cases) {
      if (c.ok) continue;
      const title = c.group ? `${c.group} › ${c.name}` : c.name;
      lines.push(`  [case-fail] ${r.file} › ${title}: ${c.message ?? "未知失败"}`);
      if (Array.isArray(c.attachments) && c.attachments.length > 0) {
        lines.push(`    附件: ${c.attachments.join(", ")}`);
      }
    }
    if (r.failureDir) {
      lines.push(`    失败产物: ${r.failureDir}`);
    }
  }
  const { segments, passed, failed, total } = summarizeCases(results);
  lines.push(`[cases] 合计: ${total} case(${segments} 段接入 case 契约): ${passed} 通过 / ${failed} 失败`);
  return lines.join("\n");
}

/**
 * 执行模型判定:默认逐段子进程隔离;显式传 isolate 优先,其次看回退开关
 * M2W_ACCEPTANCE_INPROC(设 1/true/yes/on 切回同进程顺序 + 看门狗,仅供二分定位)。
 * @param {{ isolate?: boolean }} [options] runAll 的 options
 * @returns {boolean} true = 逐段独立子进程
 */
export function resolveIsolation(options = {}) {
  if (typeof options.isolate === "boolean") return options.isolate;
  const raw = process.env[INPROC_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return !["1", "true", "yes", "on"].includes(raw);
}

/**
 * 执行全部测试段(目录顺序 + 目录内文件名排序),返回逐段结果。
 * options.segmentTimeoutMs:单段硬超时(ms),由入口(acceptance.mjs)从环境变量
 * M2W_ACCEPTANCE_SEGMENT_TIMEOUT_MS 读入并传入;0 或 NaN 等无效值 = 不启用(等段自然结束)。
 * options.isolate:执行模型,默认取 resolveIsolation(子进程隔离;M2W_ACCEPTANCE_INPROC 可回退)。
 * options.only:段选择的显式声明(三态语义见 resolveOnlySelection):未声明 = 顶层默认读
 *   M2W_ONLY(既有单段筛选用法);null = 不筛选(段内嵌套编排跑全量);字符串 = 只跑命中段。
 * options.concurrency:并发槽位数,默认取 resolveConcurrency(未设/非法 → 1,即逐字等价的串行)。
 * 调度形态:命中 EXCLUSIVE_SEGMENTS 的独占段**整轮先以并发 1 跑完**(它们对工作树指纹敏感,
 * 与其它段并发必假红),其余段交给 n 槽并发池(段间零状态串扰,并发安全);结果最终按**发现
 * 顺序**输出,故 [ok] 列表、case 合计与 [stats] 最慢段都与完成顺序无关。
 * 某段失败/超时/崩溃 → 只终结该段(隔离模型下父进程真杀其进程树),**继续执行后续段**
 * (一次看全失败面);同进程回退模型下看门狗超时无法终止悬挂段,返回值 hung=true
 * 提示入口须硬退出释放资源。
 * 失败段额外:落盘失败产物(failureDir = output/artifacts/failures/<段名>/);
 * 落盘失败只告警不中断(降级留痕,失败面仍以段级报告为准)。
 * 返回 { results, hung };results 每项 = { file, ok, ms, error?, timedOut?,
 * cases?, failureDir? }。
 * @param {string[]} dirs 段目录(按此顺序发现)
 * @param {{ segmentTimeoutMs?: number, isolate?: boolean, only?: string | null, concurrency?: number }} [options]
 * @returns {Promise<{ results: SegmentResultEntry[], hung: boolean }>}
 */
export async function runAll(dirs, options = {}) {
  const timeout = Number(options.segmentTimeoutMs ?? 0);
  const isolate = resolveIsolation(options);
  const segments = await discoverSegments(dirs, { only: options.only });
  // 解析两次是刻意的:夹取只该约束「真正派生 worker 的地方」(池内 worker 数 = min(并发, 段数)),
  // 而输出模式跟的是**请求的档位** —— 设了并发就一律走管道转发,于是「M2W_TEST_CONCURRENCY=4 +
  // 单段筛选」这种最常见的本地复现姿势也验得到读端 utf8 解码(否则该模式只在全量轮次出现,
  // 而没人会在全量输出里逐行盯中文有没有乱码)。默认(未设变量 → 1)的 stdio 与输出格式一字不动。
  const asked = resolveConcurrency({ concurrency: options.concurrency });
  const captureLog = asked > 1;
  const clamped = resolveConcurrency({ concurrency: options.concurrency, total: segments.length });
  // 同进程回退模型强制串行:该模型段与编排器共享一个进程的 case 登记器、模块与全局状态
  // (本就是零隔离),并发执行只会互相污染;它本就是仅供二分定位的串行回退路径
  const concurrency = isolate ? clamped : 1;
  /** @type {(s: SegmentDescriptor) => Promise<SegmentRunResult>} */
  const execute = isolate
    ? (s) => runSegmentIsolated(s, timeout, { captureLog })
    : (s) => runSegmentWithWatchdog(s, timeout);
  const exclusive = segments.filter((s) => isExclusiveSegment(s));
  const pooled = segments.filter((s) => !isExclusiveSegment(s));
  const runOrder = [...exclusive, ...pooled];
  /** @type {SegmentRunResult[]} */
  const raw = [];
  for (const s of exclusive) {
    raw.push(await execute(s));
  }
  raw.push(...(await runSegmentPool(pooled, execute, concurrency)));
  /** @type {SegmentResultEntry[]} */
  const results = [];
  let hung = false;
  for (const [i, s] of runOrder.entries()) {
    const r = raw[i];
    if (r === undefined) throw new Error(`段结果缺失(编排器记账缺口): ${s.name}`);
    // 段 run() 回传的 case 结果优先;未回传则取本段登记的 suite(防漏回传被静默判过;
    // 隔离模型下宿主已在子进程内做完同一收集,此处 drain 只在同进程回退模型生效)
    const outcome = collectSegmentOutcome(r.ret);
    const error = r.error ?? segmentOutcomeError(outcome);
    /** @type {SegmentResultEntry} */
    const entry = {
      file: s.name,
      ok: !error,
      ms: r.ms,
      ...(error ? { error } : {}),
      ...(r.timedOut === undefined ? {} : { timedOut: r.timedOut }),
      ...(outcome.cases.length > 0 ? { cases: outcome.cases } : {}),
    };
    if (!entry.ok) {
      try {
        const { dir } = await saveFailureArtifacts(s.name, {
          log: buildFailureLog({ ...entry, cases: outcome.cases, ...(r.log === undefined ? {} : { log: r.log }) }),
          buffers: outcome.artifacts,
        });
        entry.failureDir = repoRelative(dir);
      } catch (err) {
        // 落盘失败不掩盖段级失败面:告警留痕,退出码仍由段结果决定
        console.warn(`[warn] 失败产物落盘失败(${s.name}): ${err instanceof Error ? err.message : err}`);
      }
      // hung 只在同进程回退模型成立:隔离模型下超时段已被父进程硬杀,无残留悬挂段
      if (r.timedOut && !isolate) hung = true;
    }
    results.push(entry);
  }
  // 报告确定性:按发现顺序输出(独占段被提前跑过,完成顺序已不等于发现顺序)
  const discoveryIndex = new Map(segments.map((s, i) => [s.name, i]));
  results.sort(
    (a, b) => (discoveryIndex.get(a.file) ?? 0) - (discoveryIndex.get(b.file) ?? 0),
  );
  return { results, hung };
}
