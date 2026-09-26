/**
 * 几何门禁(几何 + 跨 DPI 缩放档位):在真实 Electron 窗口里按规格场景采样 renderer 几何,
 * 交由纯判定层(geometry-core)裁决,并按多个设备缩放档位各跑一遍,失败非零退出。
 *
 * 用途:把「视口容纳 / 水平溢出 / 固定槽占位 / 阶段跳动 / 紧凑档免滚动 / 列轴对齐」
 * 这类此前只能靠人工目检的布局不变量变成可执行门禁,截图与机器可读 JSON 报告同时留存
 * (报告供 CI artifact 与代理排障,截图供目检复核);跨 DPI 档位让同一套 12 场景 × 10 恒定组
 * 在 125% / 150% 等缩放下也各跑一遍,并对关键槽位与舞台几何做档位间像素 diff。
 *
 * 复用 visual-check 的场景序列与 preload(同一套离线 api 桩与驱动手法),
 * 故本门禁与目检工具对同一批界面状态给出一致结论;差别只在"是否裁决并退出码"。
 *
 * 角色(同一入口,按环境变量切换 —— 设备缩放因子只在 Chromium 启动早期可读,一档必须一进程):
 *   编排(默认,electron scripts/check-geometry.mjs):先跑本文件内的判定层自检,再按
 *     M2W_GEOMETRY_SCALES 逐档起 worker 子进程(同一可执行文件 + 本脚本),收各档报告、
 *     算跨 DPI 像素基线与 diff、落一份总报告。
 *   worker(内部):M2W_GEOMETRY_ROLE=worker + M2W_GEOMETRY_SCALE_FACTOR=<档位>,只跑该档 12 场景。
 *
 * 文件布局(按职责分段,判定口径只出现在判定段):
 *   §1 缩放档位解析 / §2 缩放生效与单档状态 / §3 跨 DPI 像素基线与 diff / §4 总判定与退出码
 *   §5 判定层自检(锚点 + 负向探针)/ §6 驱动层(页面探针、视口落定、场景驱动)
 *   §7 worker 角色 / §8 编排角色 / §9 角色分派与退出
 * 暂不拆独立岛:eslint 的 default-project 上限(200)已被本仓用满,新增 .mjs 会让
 * `npm run lint` 直接报 "Too many files (>200)";拆岛需与调高该上限同批进行。
 *
 * 阈值口径(单 DPI 与跨 DPI 分开,缩放只增不改):
 * - 单 DPI 判定(容差 1px、固定槽区间、舞台/动作栏恒定、紧凑档滚动预算 1px)在
 *   test/tools/geometry/geometry-core.mjs 内;每个缩放档位都用**同一套** tolPx=1 跑它,
 *   档位之间不因缩放而放宽任何既有阈值。
 * - 跨 DPI diff 单独放宽到 2 CSS px:布局在 CSS px 内算,理论上各档位应相同;但窗口尺寸要经
 *   「DIP → 物理像素 → DIP」两次取整(实测各档误差 0~2px,见 §6 settleViewport),叠加不同
 *   GPU/驱动下 1~2px 栅格化抖动,同一元素 rect 会在 1~2px 间摆动。2px 是"吸收上述取整与抖动"
 *   够用、又不至于掩盖真实回归的上限(恒定契约本身是 0px 级契约,放到 4px 以上就失去守护意义)。
 *   宁可漏报 —— 环境差异不得把门禁变成常态红灯。
 * - 不落任何跨运行基线文件:基线是"同一次门禁运行内各档位互比"。提交一份机器相关的基线会让
 *   换机器/换驱动的一方必然判红,那是环境噪声不是回归。
 *
 * 前置:npm run build(dist/renderer 就绪,否则快速失败并给出修复动作)。
 * 用法:electron scripts/check-geometry.mjs
 *   M2W_GEOMETRY_SCALES      缩放档位列表(默认**仅 native**,即不干预系统缩放;多档须显式指定,
 *                          例如 native,1.25,1.5 —— 理由见 DEFAULT_SCALES 处注)
 *   M2W_GEOMETRY_CROSS_TOL_PX 跨 DPI diff 阈值 CSS px(默认 2,取值理由见文件头)
 *   M2W_GEOMETRY_EXPECT_DPR  显式钉住期望 devicePixelRatio(如 CI 断言必须落在 100%);
 *                            不设则强制档按档位值校验、native 档只要求读到稳定有效读数
 *   M2W_GEOMETRY_RUN_TIMEOUT_MS 单档 worker 硬超时 ms(默认 900000,超时记「未测量」)
 *   M2W_GEOMETRY_SELFTEST=0  跳过判定层自检(默认跑:纯函数,含负向探针)
 *   M2W_GEOMETRY_SELFTEST_ONLY=1 只跑判定层自检不起窗口(秒级,用于快速核验判定层)
 *   M2W_GEOMETRY_REPORT      总报告输出路径(默认 output/artifacts/ui-geometry/report.json;
 *                            各档明细与截图在其同级 scale-<档位>/ 下)
 *   M2W_GEOMETRY_SHOT_DIR    worker 角色截图目录(编排角色自动下发,一般不用手设)
 *   M2W_GEOMETRY_TOL_PX      恒定判定容差 px(默认 1)
 *   M2W_GEOMETRY_SCROLL_PX   紧凑/半屏档舞台区纵向滚动预算 px(默认 1,吸收分数像素舍入)
 *   M2W_GEOMETRY_SETTLE_MS   场景驱动后的起跳等待 ms(默认 250)
 *   M2W_GEOMETRY_STABLE_RESIZE_MS  resize 后的最小布局稳定窗口 ms(默认 1500,覆盖档位切换重排)
 *   M2W_GEOMETRY_STABLE_STEP_MS    交互驱动后的最小布局稳定窗口 ms(默认 250)
 *   M2W_GEOMETRY_MAX_WAIT_MS       单场景落定等待上限 ms(默认 15000)
 *   M2W_GEOMETRY_VIEWPORT_SETTLE_MS 视口落定等待上限 ms(默认 10000)
 *   M2W_GEOMETRY_VIEWPORT_COMPENSATIONS 视口取整补偿最大额外次数(默认 2)
 * 退出码:0 全绿 / 1 实测红灯 / 2 有档位未测量(未测量 ≠ 通过)
 */
import { app, BrowserWindow, screen } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSTANT_GROUPS,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  evaluateMediaCondition,
  extractHeightMediaConditions,
  runGeometryGate,
} from "../test/tools/geometry/geometry-core.mjs";
// 舞台/纸面/滚动容器 key 判定层只内部使用、未再导出,这三项直接取规格单源
import { PAPER_KEY, SCROLL_KEY, STAGE_KEY } from "../test/tools/geometry/geometry-spec.mjs";
import {
  buildFreezeAnimationScript,
  buildMeasureScript,
  parseMeasureScript,
} from "../test/tools/geometry/geometry-page.mjs";

/**
 * @typedef {object} ScaleRequest 缩放档位请求
 * @property {"native" | "forced"} mode native=不干预系统缩放(量当前值);forced=进程内强制因子
 * @property {number} [value] 强制因子值(仅 mode==="forced")
 */

/**
 * @typedef {object} ScaleEffect 缩放生效裁决
 * @property {boolean} inEffect 缩放因子是否真正生效(实读 devicePixelRatio 与期望一致)
 * @property {number | null} expected 期望的 devicePixelRatio(native 且未指定期望时为 null)
 * @property {number[]} measured 页面实读到的 devicePixelRatio 读数(去重后)
 * @property {number | null} displayScaleFactor Electron 报告的显示器缩放(仅作旁证)
 * @property {string | null} reason 未生效原因(在效时为 null)
 */

/**
 * @typedef {object} ScaleRun 单档位运行记录(判定输入与报告输出共用形状)
 * @property {string} label 档位标签(报告键与产物目录名,如 native / 1.25x)
 * @property {ScaleRequest} request 档位请求
 * @property {"measured" | "failed" | "unmeasured"} status 单档状态
 * @property {string | null} reason 非 measured 状态的显式原因
 * @property {number[]} [measuredDevicePixelRatios] 页面实读 devicePixelRatio 读数
 * @property {number | null} [displayScaleFactor] Electron 报告的显示器缩放
 * @property {object[]} [findings] 判定层产出的几何 finding
 * @property {number | null} [viewportMaxDeltaPx] 实测视口与规格视口的最大轴向偏差
 * @property {object[]} [samples] 该档 12 场景采样明细
 */

/**
 * @typedef {{ left: number, top: number, width: number, height: number }} Rect4 四轴矩形
 */

/**
 * @typedef {object} CrossDpiCell 基线单元(某场景某节点在各档位下的像素几何)
 * @property {string} scenario 场景 id
 * @property {string} node 节点 key
 * @property {Record<string, Rect4 | null>} rects 各档位 rect
 * @property {Record<string, boolean>} visible 各档位可见性
 * @property {number} maxDeltaPx 四轴上的最大档位间偏差
 * @property {string} maxDeltaAxis 偏差最大的轴
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const selfPath = fileURLToPath(import.meta.url);
const distIndex = path.join(root, "dist", "renderer", "index.html");
const preload = path.join(root, "test", "tools", "visual-preload.cjs");
const styleDir = path.join(root, "src", "renderer", "style");
const outDir = path.join(root, "output", "artifacts", "ui-geometry");

const reportPath = path.resolve(
  root,
  process.env.M2W_GEOMETRY_REPORT ?? path.join("output", "artifacts", "ui-geometry", "report.json"),
);

const fixtures = (names) =>
  names.map((n) => path.join(root, "test", "fixtures", "acceptance", n));

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`环境变量 ${name} 非数值:${raw}`);
  }
  return value;
};

/** 可选数值环境变量(未设置或空白 → null;用于"钉住期望值"这类可选项) */
const envOptionalNumber = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 非法(须为正数):${raw}`);
  }
  return value;
};

/* ══════════════ §1 缩放档位解析(纯函数)══════════════ */

/** 默认缩放档位:系统当前缩放 + 两个常见 Windows 缩放档(125% / 150%) */
// 默认**只跑 native 单档**,这是刻意的 CI 安全取舍(2026-09-26 主会话裁决):
// 跨档位需要 Chromium 认 --force-device-scale-factor,而「认不认」取决于 runner 环境 ——
// 本地已实测三档 dpr 精确回报(2 / 1.25 / 1.5),但 CI runner 的行为**无法在本地验证**。
// 若 runner 不认,worker 会判「未测量」并以退出码 2 结束,而 `verify:ci` 里的
// `npm run check:geometry` 会因此变红 —— 「未测量」不等于「失败」,不该让 CI 背这个风险。
// 故默认保持单档(与本项改造前的行为完全一致),跨档位改为**显式选择**:
//   M2W_GEOMETRY_SCALES=native,1.25,1.5 npm run check:geometry
// 在 CI 中启用多档的前提是先用一次 lane 实跑确认该 runner 认这个开关;在此之前不得设为默认。
const DEFAULT_SCALES = ["native"];

/**
 * devicePixelRatio 期望值的判定容差。
 * Chromium 在 --force-device-scale-factor 下回报的是精确值(实测 1/1.25/1.5/2 均精确),
 * 留 0.01 只是吸收浮点表达误差,不吸收真实的不生效(那会差 0.25 以上)。
 */
const DPR_EPSILON = 0.01;

/** 跨 DPI diff 阈值(CSS px);取值理由见文件头 */
const DEFAULT_CROSS_DPI_TOL_PX = 2;

/**
 * 缩放档视口取整假红的窄口径上限(视口轴向偏差,DIP px)。
 * 取整补偿后仍残留的偏差落在本上限内时,只把 viewport-mismatch 判为「未测量」(退出码 2);
 * 超出上限则照常判红 —— 真正的 setContentSize 失效不会只有 2px。
 */
const VIEWPORT_ROUNDING_MAX_PX = 3;

/** 档位数量上限(运行成本随档位数线性增长,超限显式拒绝而不是跑十几分钟) */
const MAX_SCALE_REQUESTS = 8;

/** 退出码语义(写进报告,让读报告的人不必回查源码就知道 2 与 0 的区别) */
const EXIT_CODE_SEMANTICS = {
  0: "全绿:请求的每个缩放档位都真测过且几何判定全绿,跨 DPI diff 在容差内(单档时为 not-applicable)",
  1: "实测红灯:有档位测了且红,或跨 DPI diff 超容差",
  2: "部分:已测档位全绿,但有档位未测量(未测量 ≠ 通过)",
};

/**
 * 解析缩放档位列表(逗号分隔)。`native` 表示不干预系统缩放,量当前值;
 * 其余为正数因子(1 / 1.25 / 1.5 …),由驱动以进程内开关模拟。
 * 非法值 / 重复值一律抛错:缩放档位写错若被静默忽略,门禁会拿默认档位跑出一份看似齐全的
 * 报告,那是典型的假绿。
 * @param {string | undefined | null} raw 原始字符串(未设置或全空白 → 默认档位)
 * @returns {ScaleRequest[]} 档位请求列表
 */
function parseScales(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const tokens = text === "" ? [...DEFAULT_SCALES] : text.split(",").map((t) => t.trim()).filter((t) => t !== "");
  if (tokens.length > MAX_SCALE_REQUESTS) {
    throw new Error(`缩放档位共 ${tokens.length} 个,超过上限 ${MAX_SCALE_REQUESTS}(运行成本随档位数线性增长)`);
  }
  const requests = tokens.map(parseScaleToken);
  const seen = new Set();
  for (const request of requests) {
    const key = scaleRequestText(request);
    if (seen.has(key)) {
      throw new Error(`缩放档位重复:${key}(同一档位跑两遍只会重复耗时,不会增加覆盖)`);
    }
    seen.add(key);
  }
  return requests;
}

/**
 * 解析单个档位 token。
 * @param {string} token 档位 token
 * @returns {ScaleRequest} 档位请求
 */
function parseScaleToken(token) {
  if (token.toLowerCase() === "native") return { mode: "native" };
  const value = Number(token);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`缩放档位「${token}」非法:只接受 native 或正数因子(如 native,1.25,1.5)`);
  }
  if (value > 8) {
    throw new Error(`缩放档位「${token}」超出合理范围(1 ~ 8):设备缩放因子不会到这个量级`);
  }
  return { mode: "forced", value };
}

/**
 * 档位标签:同时用作报告键与产物目录名。必须确定(不含时间戳/随机串),
 * 且可安全作 Windows 目录名。
 * @param {ScaleRequest} request 档位请求
 * @returns {string} 档位标签(native / 1x / 1.25x)
 */
function scaleLabel(request) {
  return request.mode === "native" ? "native" : `${String(request.value)}x`;
}

/**
 * 档位请求的文本形态(传环境变量给子进程 / 报错展示用)。
 * @param {ScaleRequest} request 档位请求
 * @returns {string} native 或因子数值文本
 */
function scaleRequestText(request) {
  return request.mode === "native" ? "native" : String(request.value);
}

/* ══════════════ §2 缩放生效与单档状态(纯函数)══════════════ */

/**
 * 裁决缩放因子是否**真正生效**(防假绿核心)。
 *
 * 判据是页面实读 devicePixelRatio(请求与实读在同一进程内给出,读数缺失或与期望不符即视为
 * 没测成)。native 档不做「等于某个数」的断言:它没有声称要达到什么因子,只需证明确实读到了
 * 稳定有效的读数;若调用方用 expectedDevicePixelRatio 显式钉住(如 CI 断言渲染进程必须落在
 * 100%),则对该期望值同样严格。
 * @param {object} input 输入
 * @param {ScaleRequest} input.request 档位请求
 * @param {unknown[]} input.measuredDevicePixelRatios 页面实读 devicePixelRatio 读数
 * @param {number | null} [input.displayScaleFactor] Electron 报告的显示器缩放(旁证)
 * @param {number | null} [input.expectedDevicePixelRatio] 显式期望值(覆盖推导值)
 * @returns {ScaleEffect} 生效裁决
 */
function measureScaleEffect({
  request,
  measuredDevicePixelRatios,
  displayScaleFactor = null,
  expectedDevicePixelRatio = null,
}) {
  const readings = [
    ...new Set(
      (Array.isArray(measuredDevicePixelRatios) ? measuredDevicePixelRatios : [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0),
    ),
  ].sort((a, b) => a - b);
  const expected =
    expectedDevicePixelRatio ?? (request.mode === "forced" ? /** @type {number} */ (request.value) : null);
  /** @type {ScaleEffect} */
  const base = { inEffect: false, expected, measured: readings, displayScaleFactor, reason: null };
  if (readings.length === 0) {
    return { ...base, reason: "页面侧未读到有效 devicePixelRatio,缩放是否生效无法判定(本档不计入门禁)" };
  }
  if (readings.length > 1) {
    return {
      ...base,
      reason: `同一次运行内 devicePixelRatio 读数不一致(${readings.join(" / ")}),缩放档位不稳定(本档不计入门禁)`,
    };
  }
  const measured = /** @type {number} */ (readings[0]);
  if (expected !== null && Math.abs(measured - expected) > DPR_EPSILON) {
    return {
      ...base,
      reason:
        `页面实读 devicePixelRatio=${measured},期望 ${expected}(差 ${Math.abs(measured - expected).toFixed(3)} > 容差 ${DPR_EPSILON});` +
        `缩放未真正生效,或调用方钉住的期望值与实跑档位不符 —— 两种情况都使本档不可信,` +
        `本档不计入门禁(不得因「跑完了」而记通过)`,
    };
  }
  return { ...base, inEffect: true };
}

/**
 * 单档状态裁决:measured(真测且绿)/ failed(测了且红)/ unmeasured(没测成)。
 *
 * 缩放档的「视口取整」窄口径降级:缩放档下若**仅**剩 viewport-mismatch 且实测视口偏差在取整
 * 上限内,判 unmeasured(退出码 2)而非 failed —— 那是 setContentSize 的 DIP↔物理像素取整,
 * 不是界面回归;判红会让门禁因环境噪声常态红,判绿则是假绿,故两者都不取。只要掺进任何其它
 * finding,或偏差超出取整上限,一律 failed。
 * @param {ScaleRun} run 单档运行记录
 * @returns {{ status: ScaleRun["status"], reason: string | null, reclassified: object[] }} 状态裁决
 */
function classifyScaleRun(run) {
  const findings = run.findings ?? [];
  const effect = measureScaleEffect({
    request: run.request,
    measuredDevicePixelRatios: run.measuredDevicePixelRatios ?? [],
    displayScaleFactor: run.displayScaleFactor ?? null,
  });
  if (!effect.inEffect) {
    return { status: "unmeasured", reason: effect.reason, reclassified: [] };
  }
  if (findings.length === 0) {
    return { status: "measured", reason: null, reclassified: [] };
  }
  const viewportMaxDeltaPx = run.viewportMaxDeltaPx ?? Number.POSITIVE_INFINITY;
  const onlyViewportRounding =
    run.request.mode === "forced" &&
    findings.every((f) => /** @type {{ rule?: string }} */ (f).rule === "viewport-mismatch") &&
    viewportMaxDeltaPx <= VIEWPORT_ROUNDING_MAX_PX;
  if (onlyViewportRounding) {
    return {
      status: "unmeasured",
      reason:
        `仅剩视口取整类 finding(实测视口最大偏差 ${viewportMaxDeltaPx}px ≤ 取整上限 ${VIEWPORT_ROUNDING_MAX_PX}px):` +
        `setContentSize 的 DIP↔物理像素取整所致,非界面回归;本档记「未测量」而非通过(退出码 2)`,
      reclassified: findings,
    };
  }
  return { status: "failed", reason: null, reclassified: [] };
}

/* ══════════════ §3 跨 DPI 像素基线与 diff(纯函数)══════════════ */

/** 跨 DPI 基线参与比较的轴(与单 DPI 恒定组判定同轴) */
const DIFF_AXES = ["left", "top", "width", "height"];

/**
 * 取 rect 的四轴(right/bottom 是 left+width / top+height 的派生量,不比)。
 * @param {Record<string, number>} rect 页面侧 rect
 * @returns {Rect4} 四轴
 */
function pickRect(rect) {
  return { left: Number(rect.left), top: Number(rect.top), width: Number(rect.width), height: Number(rect.height) };
}

/**
 * 档位间逐轴偏差(返回最大偏差、对应轴与逐轴明细文本)。
 * @param {Record<string, Rect4 | null>} rects 各档位 rect(null = 该档无读数,不参与)
 * @returns {{ max: number, prop: string, byAxis: string }} 偏差
 */
function axesDeltas(rects) {
  const present = Object.values(rects).filter((r) => r !== null && r !== undefined);
  let max = 0;
  let prop = "";
  /** @type {string[]} */
  const parts = [];
  for (const axis of DIFF_AXES) {
    const values = present.map((r) => /** @type {{ [k: string]: number }} */ (r)[axis]);
    const spread = values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
    parts.push(`${axis} ${spread.toFixed(2)}`);
    if (spread > max) {
      max = spread;
      prop = axis;
    }
  }
  return { max, prop, byAxis: parts.join(" / ") };
}

/**
 * rect 格式化(报告/日志用)。
 * @param {Rect4 | null} rect 四轴
 * @returns {string} 可读形态
 */
function formatRect(rect) {
  return rect === null || rect === undefined ? "(无读数)" : `l=${rect.left} t=${rect.top} w=${rect.width} h=${rect.height}`;
}

/**
 * 采集跨 DPI 像素基线:各档位下关键槽位与舞台几何的 rect 读数。
 * 只采 status==="measured" 的档位;场景在部分档位缺失时跳过该单元并登记原因
 * (跨档位比较要求同场景同节点都在场,否则差异无从归因)。
 * @param {object} input 输入
 * @param {ScaleRun[]} input.runs 各档位运行记录(含 samples)
 * @param {string[]} input.nodes 受基线约束的节点 key(由驱动从规格单源派生后注入)
 * @returns {{ nodes: string[], factors: { label: string, devicePixelRatio: number | null }[], cells: CrossDpiCell[], skipped: { scenario: string, reason: string }[] }} 基线
 */
function buildCrossDpiBaseline({ runs, nodes }) {
  const measured = runs.filter((run) => run.status === "measured" && Array.isArray(run.samples));
  /** @type {{ label: string, devicePixelRatio: number | null }[]} */
  const factors = measured.map((run) => ({
    label: run.label,
    devicePixelRatio: run.measuredDevicePixelRatios?.[0] ?? null,
  }));
  /** @type {CrossDpiCell[]} */
  const cells = [];
  /** @type {{ scenario: string, reason: string }[]} */
  const skipped = [];
  const scenarioIds = [...new Set(measured.flatMap((run) => run.samples.map((s) => s.id)))].sort();
  for (const scenario of scenarioIds) {
    const perRun = measured.map((run) => ({ run, sample: run.samples.find((s) => s.id === scenario) }));
    const missing = perRun.filter((entry) => entry.sample === undefined).map((entry) => entry.run.label);
    if (missing.length > 0) {
      skipped.push({ scenario, reason: `档位 ${missing.join("、")} 未采到该场景(无法跨档位比较)` });
      continue;
    }
    for (const node of nodes) {
      /** @type {Record<string, Rect4 | null>} */
      const rects = {};
      /** @type {Record<string, boolean>} */
      const visible = {};
      for (const { run, sample } of perRun) {
        const nodeSample = /** @type {Record<string, { rect: Record<string, number>, visible: boolean } | null>} */ (
          sample.nodes
        )[node];
        const present = nodeSample !== null && nodeSample !== undefined;
        rects[run.label] = present ? pickRect(nodeSample.rect) : null;
        visible[run.label] = present && nodeSample.visible === true;
      }
      const deltas = axesDeltas(rects);
      cells.push({ scenario, node, rects, visible, maxDeltaPx: deltas.max, maxDeltaAxis: deltas.prop });
    }
  }
  return { nodes: [...nodes], factors, cells, skipped };
}

/**
 * 跨 DPI diff:基线单元之间的档位间偏差与可见性漂移。
 * 阈值单独取 DEFAULT_CROSS_DPI_TOL_PX(不改动单 DPI 的 1px 判定口径)。
 * @param {object} input 输入
 * @param {ReturnType<typeof buildCrossDpiBaseline>} input.baseline 基线
 * @param {number} [input.tolPx] 跨 DPI 阈值(CSS px)
 * @returns {{ status: "not-applicable" | "within-tolerance" | "over-tolerance", tolPx: number, maxDeltaPx: number, compared: number, findings: object[], skipped: { scenario: string, reason: string }[] }} diff 结果
 */
function diffCrossDpi({ baseline, tolPx = DEFAULT_CROSS_DPI_TOL_PX }) {
  /** @type {{ rule: string, scenario: string, node: string, message: string, expected: string, actual: string }[]} */
  const findings = [];
  const factorLabels = baseline.factors.map((f) => f.label);
  const comparable = factorLabels.length >= 2;
  let maxDeltaPx = 0;
  for (const cell of baseline.cells) {
    const missingLabels = factorLabels.filter((label) => cell.rects[label] === undefined);
    if (missingLabels.length > 0) {
      findings.push({
        rule: "cross-dpi-incomparable",
        scenario: cell.scenario,
        node: cell.node,
        message: `节点 ${cell.node} 在档位 ${missingLabels.join("、")} 无读数,无法跨 DPI 比较`,
        expected: `档位 ${factorLabels.join("/")} 均有读数`,
        actual: `缺 ${missingLabels.join("/")}`,
      });
      continue;
    }
    // 可见性/在场判据:只看"各档位之间是否不一致"。
    // 某节点在所有档位一致地缺席或一致地隐藏(空态下的队列三件套:元素在 DOM 里但宽 0)
    // 不是漂移,不能因此判红;真正要抓的是"这个档位在场/可见、那个档位不在场/不可见"。
    const presentLabels = factorLabels.filter(
      (label) => cell.rects[label] !== null && cell.rects[label] !== undefined,
    );
    if (presentLabels.length === 0) continue; // 该场景本就没有此节点:无可比,不记 finding
    const absentLabels = factorLabels.filter((label) => !presentLabels.includes(label));
    if (absentLabels.length > 0) {
      findings.push({
        rule: "cross-dpi-visibility",
        scenario: cell.scenario,
        node: cell.node,
        message: `节点 ${cell.node} 在档位 ${absentLabels.join("/")} 无读数,在档位 ${presentLabels.join("/")} 在场`,
        expected: "各档位该节点都在场",
        actual: `${absentLabels.join("/")} 缺读数`,
      });
    }
    const visiblePatterns = new Set(presentLabels.map((label) => cell.visible[label] === true));
    if (visiblePatterns.size > 1) {
      const visibleLabels = presentLabels.filter((label) => cell.visible[label] === true);
      const hidden = presentLabels.filter((label) => cell.visible[label] !== true);
      findings.push({
        rule: "cross-dpi-visibility",
        scenario: cell.scenario,
        node: cell.node,
        message: `节点 ${cell.node} 的可见性随缩放档位变化:档位 ${visibleLabels.join("/")} 可见,${hidden.join("/")} 不可见`,
        expected: "各档位可见性一致",
        actual: `${visibleLabels.join("/")}=可见,${hidden.join("/")}=不可见`,
      });
    }
    maxDeltaPx = Math.max(maxDeltaPx, cell.maxDeltaPx);
    if (cell.maxDeltaPx > tolPx) {
      findings.push({
        rule: "cross-dpi-drift",
        scenario: cell.scenario,
        node: cell.node,
        message:
          `节点 ${cell.node} 跨缩放档位 ${cell.maxDeltaAxis} 偏差 ${cell.maxDeltaPx.toFixed(2)}px > 跨 DPI 容差 ${tolPx}px` +
          `(${factorLabels.map((label) => `${label}=${formatRect(cell.rects[label])}`).join(" | ")})`,
        expected: `各档位互差 <= ${tolPx}px`,
        actual: axesDeltas(cell.rects).byAxis,
      });
    }
  }
  const status = !comparable ? "not-applicable" : findings.length > 0 ? "over-tolerance" : "within-tolerance";
  return {
    status,
    tolPx,
    maxDeltaPx: Math.round(maxDeltaPx * 100) / 100,
    compared: baseline.cells.length,
    findings,
    skipped: baseline.skipped,
  };
}

/* ══════════════ §4 总判定与退出码(纯函数)══════════════ */

/**
 * 总判定与退出码:
 * - 0 全绿:所有请求档位都真测过(measured)且绿,跨 DPI diff 在容差内(或只请求了单档,无从比较);
 * - 1 实测红灯:任一档位测了且红,或跨 DPI diff 超容差;
 * - 2 部分:已测档位全绿,但有档位「未测量」(跑不了 / 缩放未生效 / worker 未产出报告)。
 * 「未测量」绝不折成 0:门禁没测到就是没测到,退出码要能让人在 CI 上分辨 0 与 2。
 * @param {object} input 输入
 * @param {ScaleRun[]} input.runs 各档位运行记录
 * @param {ReturnType<typeof diffCrossDpi>} input.crossDpi 跨 DPI diff 结果
 * @returns {{ code: number, status: "pass" | "fail" | "partial", ok: boolean, failed: string[], unmeasured: string[], measured: string[] }} 总判定
 */
function decideGateOutcome({ runs, crossDpi }) {
  const failed = runs.filter((r) => r.status === "failed").map((r) => r.label);
  const unmeasured = runs.filter((r) => r.status === "unmeasured").map((r) => r.label);
  const measured = runs.filter((r) => r.status === "measured").map((r) => r.label);
  const code = failed.length > 0 || crossDpi.status === "over-tolerance" ? 1 : unmeasured.length > 0 ? 2 : 0;
  return { code, status: code === 0 ? "pass" : code === 1 ? "fail" : "partial", ok: code === 0, failed, unmeasured, measured };
}

/* ══════════════ §5 判定层自检(锚点 + 负向探针)══════════════ */

/**
 * 合成一条跨 DPI 用的运行记录(节点矩形由 rect 给定)。
 * @param {object} input 输入
 * @param {string} input.label 档位标签
 * @param {string | number} input.requested 档位请求文本
 * @param {string} input.scenario 场景 id
 * @param {string} input.node 节点 key
 * @param {Rect4 | null} input.rect 该档位 rect
 * @param {boolean} [input.visible] 可见性
 * @param {number} [input.dpr] 该档位实读 devicePixelRatio
 * @param {string[]} [input.scenarios] 需要一并产出的其它场景 id(同节点)
 * @returns {ScaleRun} 运行记录
 */
function fakeRun({ label, requested, scenario, node, rect, visible = true, dpr = 1, scenarios = [] }) {
  const request =
    requested === "native"
      ? { mode: /** @type {const} */ ("native") }
      : { mode: /** @type {const} */ ("forced"), value: Number(requested) };
  const mk = (id) => ({
    id,
    nodes: {
      [node]:
        rect === null ? null : { rect: { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }, visible },
    },
  });
  return {
    label,
    request,
    status: /** @type {const} */ ("measured"),
    reason: null,
    measuredDevicePixelRatios: [dpr],
    displayScaleFactor: dpr,
    findings: [],
    samples: [mk(scenario), ...scenarios.map((id) => mk(id))],
  };
}

/**
 * 自检断言辅助:条件为假即抛出,错误消息带断言名与实参。
 * @param {string} name 断言名
 * @param {boolean} condition 条件
 * @param {string} detail 失败细节
 * @returns {void}
 */
function expect(name, condition, detail) {
  if (!condition) throw new Error(`${name}:${detail}`);
}

/**
 * 自检断言辅助:断言某函数确实抛错(负向探针的通用形态)。
 * @param {string} name 断言名
 * @param {() => unknown} fn 待测函数
 * @param {string} [keyword] 期望错误消息含有的关键字
 * @returns {void}
 */
function expectThrows(name, fn, keyword) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (keyword !== undefined && !message.includes(keyword)) {
      throw new Error(`${name}:抛错但消息不含关键字「${keyword}」,实际:${message}`);
    }
    return;
  }
  throw new Error(`${name}:期望抛错却正常返回(参数错误被静默吞掉 → 假绿)`);
}

/**
 * 跑判定层全部自检。
 *
 * 为什么要有这一层:缩放参数化引入的新风险几乎全是「假绿」类 —— 参数写错被默认值吞掉、
 * 缩放因子没生效却记通过、跨 DPI 阈值取得过紧把环境噪声当回归(或过松到毫无守护)。
 * 这些都不该靠人工实跑发现,所以每条新判定都配一组负向探针:注入故障 → 必须判红/记未测量。
 * 探针一律断言「必须不通过」,绝不改成「总是通过」来掩盖空过。
 * @returns {{ ok: boolean, checks: { name: string, ok: boolean, detail: string | null }[], anchors: number, probes: number }} 自检结果
 */
function runScaleSelfTest() {
  /** @type {{ name: string, ok: boolean, detail: string | null }[]} */
  const checks = [];
  /**
   * @param {string} name 断言名(以 probe: 前缀标记负向探针)
   * @param {() => void} fn 断言体
   * @returns {void}
   */
  const check = (name, fn) => {
    try {
      fn();
      checks.push({ name, ok: true, detail: null });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  /* ---------- §1 参数解析 ---------- */
  check("parseScales:未设置时只用 native 单档(多档须显式指定,避免 CI 因 runner 不认缩放开关而红)", () => {
    const list = parseScales(undefined);
    expect("默认档位数为 1", list.length === 1, `实得 ${JSON.stringify(list)}`);
    expect("默认档位即 native", list[0]?.mode === "native", JSON.stringify(list[0]));
    // 默认单档**不等于**多档能力消失:显式请求时仍须解析出三档,否则这条裁决会顺手削掉能力
    const multi = parseScales("native,1.25,1.5");
    expect("显式多档仍解析出 3 档", multi.length === 3, JSON.stringify(multi));
    expect(
      "显式多档档位值正确",
      multi[1]?.value === 1.25 && multi[2]?.value === 1.5,
      JSON.stringify(multi),
    );
  });
  check("parseScales:空白与冗余分隔符归一", () => {
    const list = parseScales(" 1.25 , , 1.5 ");
    expect("档位数", list.length === 2, JSON.stringify(list));
    expect("档位值", list[0].value === 1.25 && list[1].value === 1.5, JSON.stringify(list));
  });
  check("probe:非法 token 必须抛错", () => {
    expectThrows("parseScales(abc)", () => parseScales("abc"), "非法");
    expectThrows("parseScales(native,xyz)", () => parseScales("native,xyz"), "非法");
  });
  check("probe:非正因子必须抛错", () => {
    expectThrows("parseScales(0)", () => parseScales("0"), "非法");
    expectThrows("parseScales(-1.5)", () => parseScales("-1.5"), "非法");
  });
  check("probe:重复档位必须抛错", () => {
    expectThrows("parseScales(1.25,1.25)", () => parseScales("1.25,1.25"), "重复");
  });
  check("probe:档位数量超限必须抛错", () => {
    expectThrows("parseScales(9 档)", () => parseScales("1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8"), "上限");
  });

  /* ---------- §2 缩放是否真生效(防假绿) ---------- */
  check("measureScaleEffect:forced 档读数与期望一致 → 生效", () => {
    const effect = measureScaleEffect({
      request: { mode: "forced", value: 1.25 },
      measuredDevicePixelRatios: [1.25, 1.25, 1.25],
    });
    expect("生效", effect.inEffect === true, JSON.stringify(effect));
  });
  check("measureScaleEffect:native 档有有效读数即生效(不强行等于某个数)", () => {
    const effect = measureScaleEffect({ request: { mode: "native" }, measuredDevicePixelRatios: [2] });
    expect("生效", effect.inEffect === true, JSON.stringify(effect));
    expect("native 无期望值", effect.expected === null, JSON.stringify(effect));
  });
  check("probe:缩放未生效(读数≠期望)必须判未生效", () => {
    const effect = measureScaleEffect({
      request: { mode: "forced", value: 1.25 },
      measuredDevicePixelRatios: [1.5],
    });
    expect("未生效", effect.inEffect === false, JSON.stringify(effect));
    expect("原因含未生效字样", (effect.reason ?? "").includes("未真正生效"), String(effect.reason));
  });
  check("probe:显式期望值(CI 钉住)不满足时必须判未生效", () => {
    const effect = measureScaleEffect({
      request: { mode: "forced", value: 1.25 },
      measuredDevicePixelRatios: [1.25],
      expectedDevicePixelRatio: 1,
    });
    expect("未生效", effect.inEffect === false, JSON.stringify(effect));
  });
  check("probe:读数缺失必须判未生效", () => {
    const effect = measureScaleEffect({ request: { mode: "forced", value: 1.5 }, measuredDevicePixelRatios: [] });
    expect("未生效", effect.inEffect === false, JSON.stringify(effect));
    expect("原因含无法判定", (effect.reason ?? "").includes("无法判定"), String(effect.reason));
  });
  check("probe:同一次运行读数不一致必须判未生效", () => {
    const effect = measureScaleEffect({
      request: { mode: "forced", value: 1.5 },
      measuredDevicePixelRatios: [1.5, 1.25],
    });
    expect("未生效", effect.inEffect === false, JSON.stringify(effect));
    expect("原因含不一致", (effect.reason ?? "").includes("不一致"), String(effect.reason));
  });

  /* ---------- §2 单档状态语义 ---------- */
  check("classifyScaleRun:绿 → measured", () => {
    const verdict = classifyScaleRun({
      label: "1.25x",
      request: { mode: "forced", value: 1.25 },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [1.25],
      findings: [],
    });
    expect("measured", verdict.status === "measured", JSON.stringify(verdict));
  });
  check("classifyScaleRun:有真实 finding → failed", () => {
    const verdict = classifyScaleRun({
      label: "1.25x",
      request: { mode: "forced", value: 1.25 },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [1.25],
      findings: [{ rule: "geometry-jump" }],
    });
    expect("failed", verdict.status === "failed", JSON.stringify(verdict));
  });
  check("probe:缩放未生效 → unmeasured(不得记通过)", () => {
    const verdict = classifyScaleRun({
      label: "1.5x",
      request: { mode: "forced", value: 1.5 },
      status: "unmeasured",
      reason: null,
      measuredDevicePixelRatios: [1.25],
      findings: [],
    });
    expect("unmeasured", verdict.status === "unmeasured", JSON.stringify(verdict));
    expect("有原因", (verdict.reason ?? "").length > 0, "reason 为空");
  });
  check("probe:仅视口取整类 finding 且偏差在上限内 → unmeasured(不判红也不判绿)", () => {
    const verdict = classifyScaleRun({
      label: "1.5x",
      request: { mode: "forced", value: 1.5 },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [1.5],
      viewportMaxDeltaPx: 2,
      findings: [{ rule: "viewport-mismatch" }],
    });
    expect("unmeasured", verdict.status === "unmeasured", JSON.stringify(verdict));
    expect("降级条目被登记", verdict.reclassified.length === 1, JSON.stringify(verdict.reclassified));
  });
  check("probe:视口偏差超出取整上限 → failed(真实失效仍要判红)", () => {
    const verdict = classifyScaleRun({
      label: "1.5x",
      request: { mode: "forced", value: 1.5 },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [1.5],
      viewportMaxDeltaPx: 40,
      findings: [{ rule: "viewport-mismatch" }],
    });
    expect("failed", verdict.status === "failed", JSON.stringify(verdict));
  });
  check("probe:视口取整 finding 混进其它 finding → failed", () => {
    const verdict = classifyScaleRun({
      label: "1.5x",
      request: { mode: "forced", value: 1.5 },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [1.5],
      viewportMaxDeltaPx: 2,
      findings: [{ rule: "viewport-mismatch" }, { rule: "compact-scroll" }],
    });
    expect("failed", verdict.status === "failed", JSON.stringify(verdict));
  });
  check("probe:native 档的视口偏差不适用取整降级(系统缩放下视口偏差是真实信号)", () => {
    const verdict = classifyScaleRun({
      label: "native",
      request: { mode: "native" },
      status: "measured",
      reason: null,
      measuredDevicePixelRatios: [2],
      viewportMaxDeltaPx: 2,
      findings: [{ rule: "viewport-mismatch" }],
    });
    expect("failed", verdict.status === "failed", JSON.stringify(verdict));
  });

  /* ---------- §3 跨 DPI 像素基线与 diff ---------- */
  const rectA = { left: 8, top: 16, width: 944, height: 528 };
  check("diffCrossDpi:各档位完全一致 → within-tolerance", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1 }),
        fakeRun({ label: "1.5x", requested: 1.5, scenario: "s1", node: "stage", rect: rectA, dpr: 1.5 }),
      ],
      nodes: ["stage"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("within-tolerance", diff.status === "within-tolerance", JSON.stringify(diff));
    expect("最大偏差 0", diff.maxDeltaPx === 0, String(diff.maxDeltaPx));
  });
  check("diffCrossDpi:1.5px 抖动被跨 DPI 容差吸收(阈值宽松但不失效)", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1 }),
        runWithRect(1.5, { ...rectA, left: rectA.left + 1.5 }, 1.5),
      ],
      nodes: ["stage"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("within-tolerance", diff.status === "within-tolerance", JSON.stringify(diff.findings));
    expect("偏差被记录", diff.maxDeltaPx === 1.5, String(diff.maxDeltaPx));
  });
  check("probe:3px 偏差必须判超容差(阈值不能宽到没有守护)", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1 }),
        runWithRect(1.5, { ...rectA, height: rectA.height + 3 }, 1.5),
      ],
      nodes: ["stage"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("over-tolerance", diff.status === "over-tolerance", JSON.stringify(diff));
    expect("命中 cross-dpi-drift", diff.findings.some((f) => f.rule === "cross-dpi-drift"), JSON.stringify(diff.findings));
  });
  check("diffCrossDpi:各档位一致地隐藏/缺席(空态队列三件套)不算漂移", () => {
    const hiddenRect = { ...rectA, width: 0, height: 0 };
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "listcard", rect: hiddenRect, visible: false, dpr: 1 }),
        fakeRun({ label: "1.5x", requested: 1.5, scenario: "s1", node: "listcard", rect: hiddenRect, visible: false, dpr: 1.5 }),
      ],
      nodes: ["listcard"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("一致隐藏不记 finding", diff.findings.length === 0, JSON.stringify(diff.findings));
    expect("within-tolerance", diff.status === "within-tolerance", diff.status);
  });
  check("probe:某档位缺该节点读数必须记 finding", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "listcard", rect: rectA, dpr: 1 }),
        fakeRun({ label: "1.5x", requested: 1.5, scenario: "s1", node: "listcard", rect: null, dpr: 1.5 }),
      ],
      nodes: ["listcard"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("命中 cross-dpi-visibility", diff.findings.some((f) => f.rule === "cross-dpi-visibility"), JSON.stringify(diff.findings));
  });
  check("probe:可见性随档位漂移必须记 finding", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1 }),
        fakeRun({ label: "1.5x", requested: 1.5, scenario: "s1", node: "stage", rect: rectA, visible: false, dpr: 1.5 }),
      ],
      nodes: ["stage"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("命中可见性 finding", diff.findings.some((f) => f.rule === "cross-dpi-visibility"), JSON.stringify(diff.findings));
    expect("over-tolerance", diff.status === "over-tolerance", diff.status);
  });
  check("probe:某档位缺该场景时跳过并登记原因,不得当成一致", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [
        fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1, scenarios: ["s2"] }),
        fakeRun({ label: "1.5x", requested: 1.5, scenario: "s1", node: "stage", rect: rectA, dpr: 1.5 }),
      ],
      nodes: ["stage"],
    });
    expect("跳过登记", baseline.skipped.length === 1, JSON.stringify(baseline.skipped));
    const diff = diffCrossDpi({ baseline });
    expect("未比对项不出 finding(diff 只看 cells)", diff.findings.length === 0, JSON.stringify(diff.findings));
  });
  check("probe:只有一个档位时 diff 为 not-applicable(不得记成通过)", () => {
    const baseline = buildCrossDpiBaseline({
      runs: [fakeRun({ label: "1x", requested: 1, scenario: "s1", node: "stage", rect: rectA, dpr: 1 })],
      nodes: ["stage"],
    });
    const diff = diffCrossDpi({ baseline });
    expect("not-applicable", diff.status === "not-applicable", diff.status);
  });

  /* ---------- §4 总退出码 ---------- */
  const greenDiff = { status: /** @type {const} */ ("within-tolerance"), tolPx: 2, maxDeltaPx: 0, compared: 1, findings: [], skipped: [] };
  const overDiff = { ...greenDiff, status: /** @type {const} */ ("over-tolerance") };
  const oneRun = (status) => [{ label: "1x", request: { mode: "forced", value: 1 }, status, reason: null, findings: [] }];
  check("decideGateOutcome:全部实测且绿 → 0/pass", () => {
    const outcome = decideGateOutcome({ runs: oneRun("measured"), crossDpi: greenDiff });
    expect("code 0", outcome.code === 0, JSON.stringify(outcome));
    expect("ok", outcome.ok === true, JSON.stringify(outcome));
  });
  check("probe:有档位未测量 → 2/partial(未测量不得当通过)", () => {
    const outcome = decideGateOutcome({
      runs: [...oneRun("measured"), { ...oneRun("unmeasured")[0], label: "1.5x" }],
      crossDpi: greenDiff,
    });
    expect("code 2", outcome.code === 2, JSON.stringify(outcome));
    expect("ok=false", outcome.ok === false, JSON.stringify(outcome));
    expect("未测量被点名", outcome.unmeasured.join() === "1.5x", JSON.stringify(outcome));
  });
  check("probe:有档位实测红灯 → 1/fail", () => {
    const outcome = decideGateOutcome({ runs: oneRun("failed"), crossDpi: greenDiff });
    expect("code 1", outcome.code === 1, JSON.stringify(outcome));
  });
  check("probe:跨 DPI 超容差 → 1/fail", () => {
    const outcome = decideGateOutcome({ runs: oneRun("measured"), crossDpi: overDiff });
    expect("code 1", outcome.code === 1, JSON.stringify(outcome));
  });
  check("probe:未测量优先于 not-applicable(不得因无从比较而记绿)", () => {
    const outcome = decideGateOutcome({
      runs: oneRun("unmeasured"),
      crossDpi: { ...greenDiff, status: /** @type {const} */ ("not-applicable") },
    });
    expect("code 2", outcome.code === 2, JSON.stringify(outcome));
  });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    anchors: checks.filter((c) => !c.name.startsWith("probe:")).length,
    probes: checks.filter((c) => c.name.startsWith("probe:")).length,
  };
}

/**
 * 自检用的 1.5 档记录(与 fakeRun 同构,只是把矩形与 dpr 参数化,避免重复样板)。
 * @param {number} dpr 档位因子
 * @param {Rect4} rect 该档位矩形
 * @param {number} measured 实读 dpr
 * @returns {ScaleRun} 运行记录
 */
function runWithRect(dpr, rect, measured) {
  return fakeRun({ label: `${dpr}x`, requested: dpr, scenario: "s1", node: "stage", rect, dpr: measured });
}

/* ══════════════ §6 驱动层(页面探针、视口落定、场景驱动)══════════════ */

const config = {
  tolPx: envNumber("M2W_GEOMETRY_TOL_PX", DEFAULT_TOL_PX),
  scrollBudgetPx: envNumber("M2W_GEOMETRY_SCROLL_PX", DEFAULT_SCROLL_BUDGET_PX),
  settleMs: envNumber("M2W_GEOMETRY_SETTLE_MS", 250),
  stableAfterResizeMs: envNumber("M2W_GEOMETRY_STABLE_RESIZE_MS", 1500),
  stableAfterStepMs: envNumber("M2W_GEOMETRY_STABLE_STEP_MS", 250),
  maxWaitMs: envNumber("M2W_GEOMETRY_MAX_WAIT_MS", 15000),
  viewportSettleMs: envNumber("M2W_GEOMETRY_VIEWPORT_SETTLE_MS", 10000),
  // 视口取整补偿次数上限(负数/小数归零):补偿只是把驱动取整误差压回容差,不是无限重试
  viewportCompensations: Math.max(0, Math.trunc(envNumber("M2W_GEOMETRY_VIEWPORT_COMPENSATIONS", 2))),
  crossTolPx: envNumber("M2W_GEOMETRY_CROSS_TOL_PX", DEFAULT_CROSS_DPI_TOL_PX),
  runTimeoutMs: envNumber("M2W_GEOMETRY_RUN_TIMEOUT_MS", 900000),
  expectDpr: envOptionalNumber("M2W_GEOMETRY_EXPECT_DPR"),
  selfTest: process.env.M2W_GEOMETRY_SELFTEST !== "0",
  selfTestOnly: process.env.M2W_GEOMETRY_SELFTEST_ONLY === "1",
};

/**
 * 跨 DPI 像素基线覆盖的节点(从规格单源派生,不另列一份清单):
 * 恒定组受约束节点(舞台/动作栏/历史标题条/消息槽)+ 固定槽 + 舞台容器/纸面/滚动容器
 * + 各场景列轴组成员(队列三件套与纸面脚注条)—— 即「关键槽位与舞台几何」全集。
 */
const CROSS_DPI_NODES = [
  ...new Set([
    ...CONSTANT_GROUPS.map((group) => group.node),
    ...SLOT_INVARIANTS.map((slot) => slot.node),
    STAGE_KEY,
    SCROLL_KEY,
    PAPER_KEY,
    ...SCENARIOS.flatMap((scenario) =>
      (scenario.columnAxis ?? []).flatMap((group) => [group.ref, ...group.members]),
    ),
  ].filter((key) => typeof key === "string")),
].sort();

/**
 * 高度维度媒体查询条件单源:从 renderer 样式表实读(不硬编码档位断点)。
 * 既用于「该视口下响应式档位是否真的生效」断言,也用于 resize 后的落定判据。
 * @returns {string[]} 条件串(去重、保持出现序)
 */
function readMediaConditions() {
  const conds = [];
  for (const file of fs.readdirSync(styleDir).filter((f) => f.endsWith(".css"))) {
    for (const cond of extractHeightMediaConditions(fs.readFileSync(path.join(styleDir, file), "utf8"))) {
      if (!conds.includes(cond)) conds.push(cond);
    }
  }
  if (conds.length === 0) {
    throw new Error("renderer 样式表未找到任何高度维度媒体查询;档位断言将失去依据,请复核样式表结构");
  }
  return conds;
}

const mediaConditions = readMediaConditions();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待页面表达式为真(状态迁移/首渲染就绪;固定时长在冷启动下会抢拍) */
async function waitFor(exec, expr, timeout = 5000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await exec(`!!(${expr})`)) return;
    await wait(60);
  }
  throw new Error(`等待页面条件超时:${label}`);
}

/** 存在性断言后再点击:选择器缺失时给出可定位的错误,不静默跳过 */
async function click(exec, selector) {
  const exists = await exec(`document.querySelector(${JSON.stringify(selector)}) !== null`);
  if (!exists) {
    throw new Error(`驱动步骤失败:选择器不存在 ${selector}`);
  }
  await exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

const OPS = {
  /** 设定下一次对话框返回的路径列表(消费即清空) */
  setFiles: (exec, step) =>
    exec(`window.__vc.setNextOpen(${JSON.stringify(fixtures(step.fixtures ?? []))})`),
  click: (exec, step) => click(exec, step.selector),
  /** 模拟转换中:进度行显隐 + 状态行写入(与 visual-check 同手法,验几何恒定) */
  progress: async (exec, step) => {
    if (step.show === true) {
      await exec(
        `document.getElementById("progressArea").classList.remove("hidden");` +
          `document.getElementById("progressFill").style.width = "45%";` +
          `document.getElementById("progressText").textContent = "45%";` +
          `document.getElementById("status").textContent = "正在转换 basic-render.md …";`,
      );
    } else {
      await exec(
        `document.getElementById("progressArea").classList.add("hidden");` +
          `document.getElementById("progressFill").style.width = "0%";` +
          `document.getElementById("progressText").textContent = "0%";` +
          `document.getElementById("status").textContent = "";`,
      );
    }
  },
};

/**
 * 布局落定采样:连续稳定达到 minStableMs 才采用。
 *
 * 依据(Windows 隐藏窗口实测):setContentSize 后 innerWidth/innerHeight 与 matchMedia
 * 立即更新,但当响应式档位发生切换时(如 960×680 → 880×620,矮窗档 --tbh 生效),
 * 布局树要约 1s 后才真正重排 —— 期间量到的是"新视口 + 旧档位"混合态
 * (实测 --tbh 已是 40px 而 .h-head 仍 40px 高、.stage 仍按上一档偏移 8px)。
 * 故不能只等视口/档位标志位,必须要求布局采样在最小稳定窗口内保持不变。
 * resize 后用较长窗口(默认 1500ms),交互驱动用短窗口(默认 250ms,点击为同步重排)。
 * 超过 maxWaitMs 仍未收敛则返回最后一次采样 —— 残留不稳定会由判定层的恒定/越界断言暴露。
 */
async function measureStable(exec, measureSource, minStableMs, maxWaitMs) {
  const t0 = Date.now();
  let prev = null;
  let prevAt = 0;
  for (;;) {
    const cur = parseMeasureScript(await exec(measureSource));
    const now = Date.now();
    if (prev !== null && JSON.stringify(cur) === JSON.stringify(prev) && now - prevAt >= minStableMs) {
      return cur;
    }
    if (now - t0 >= maxWaitMs) return cur;
    prev = cur;
    prevAt = now;
    await wait(150);
  }
}

/**
 * 视口落定探针表达式(页面侧一次读出视口与响应式档位匹配态)。
 * 与 geometry-page 的 buildViewportSettledScript 同形,但这里需要的是**带偏差的读数**
 * (取整补偿要用实测差值回补),故就地构造;共享探针模块属 test/ 契约,不在本改动面内。
 * @param {[number, number]} viewport 目标视口
 * @returns {string} 表达式
 */
function buildViewportProbe(viewport) {
  const tierChecks = mediaConditions.map(
    (cond) =>
      `window.matchMedia(${JSON.stringify(cond)}).matches === ` +
      JSON.stringify(evaluateMediaCondition(cond, { width: viewport[0], height: viewport[1] })),
  );
  return (
    `JSON.stringify({ vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, tiersOk: ` +
    `${tierChecks.length === 0 ? "true" : tierChecks.join(" && ")} })`
  );
}

/**
 * 轮询视口与档位,返回最后一次读数(不抛错:由调用方决定是补偿还是失败)。
 * @param {(code: string) => Promise<unknown>} exec 页面执行器
 * @param {[number, number]} viewport 目标视口
 * @param {number} tolPx 视口容差(CSS px)
 * @param {number} timeoutMs 落定等待上限
 * @returns {Promise<{ settled: boolean, vw: number, vh: number, tiersOk: boolean }>} 读数
 */
async function pollViewport(exec, viewport, tolPx, timeoutMs) {
  const probe = buildViewportProbe(viewport);
  const t0 = Date.now();
  for (;;) {
    const last = JSON.parse(await exec(probe));
    const settled =
      last.tiersOk && Math.abs(last.vw - viewport[0]) <= tolPx && Math.abs(last.vh - viewport[1]) <= tolPx;
    if (settled || Date.now() - t0 >= timeoutMs) {
      return { settled, vw: last.vw, vh: last.vh, tiersOk: last.tiersOk };
    }
    await wait(60);
  }
}

/**
 * setContentSize + 落定 + **取整补偿**。
 *
 * 取整补偿的依据(本机逐档实测,setContentSize 的 DIP 入参 → 页面实读 innerWidth/innerHeight):
 *   缩放 1    → 960×680 偏差 0
 *   缩放 1.25 → 960×680 偏差 0
 *   缩放 2    → 961×681 偏差 +1
 *   缩放 1.5  → 962×682 偏差 +2(补偿一次后精确命中 960×680)
 *   缩放 2.25 → 961×682 偏差 +1/+2(补偿一次后 960×679,落在容差内)
 * 即入参是 DIP,窗口管理器按物理像素量化后再折回 DIP,各档误差不同。不补偿的话 1.5 档会以
 * viewport-mismatch 判红 —— 那是驱动取整,不是界面回归;为缩放档放宽容差同样不对(会把真实
 * 溢出一起放过)。故按"实测差回补"再试一次,补偿后仍以原容差判定,次数有上限;超限即按未落定
 * 失败(不静默放行)。native 档(本机缩放 2)首次即落在容差内,补偿不触发 —— 单 DPI 判定口径
 * 零变化。
 * @param {BrowserWindow} win 窗口
 * @param {(code: string) => Promise<unknown>} exec 页面执行器
 * @param {[number, number]} viewport 目标视口
 * @returns {Promise<{ attempts: number, compensated: boolean, requested: [number, number], actual: [number, number] }>} 落定证据
 */
async function settleViewport(win, exec, viewport) {
  let requestW = viewport[0];
  let requestH = viewport[1];
  for (let attempt = 0; attempt <= config.viewportCompensations; attempt += 1) {
    // setContentSize 而非 setSize:视口(= 内容区)才是规格口径,
    // setSize 含窗口边框与标题栏,量到的视口会系统性小于规格
    win.setContentSize(requestW, requestH);
    const probe = await pollViewport(exec, viewport, config.tolPx, config.viewportSettleMs);
    if (probe.settled) {
      return { attempts: attempt + 1, compensated: attempt > 0, requested: [requestW, requestH], actual: [probe.vw, probe.vh] };
    }
    if (!probe.tiersOk) {
      throw new Error(
        `视口 ${viewport.join("×")} 落定后响应式档位仍不匹配(实读 ${probe.vw}×${probe.vh},` +
          `档位条件 ${JSON.stringify(mediaConditions)});高度档未生效时量到的是上一档布局`,
      );
    }
    requestW = viewport[0] + (viewport[0] - probe.vw);
    requestH = viewport[1] + (viewport[1] - probe.vh);
  }
  throw new Error(
    `视口 ${viewport.join("×")} 在 ${config.viewportCompensations + 1} 次 setContentSize 内未落入 ±${config.tolPx}px` +
      `(DIP↔物理像素取整补偿无法收敛)`,
  );
}

async function screenshot(win, shotDir, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(shotDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  return `${name}.png (${image.getSize().width}x${image.getSize().height})`;
}

/** 实测视口与规格视口的最大轴向偏差(供「视口取整类 finding」窄口径降级判定用) */
function viewportMaxDelta(samples) {
  const want = new Map(SCENARIOS.map((sc) => [sc.id, sc.viewport]));
  let max = 0;
  for (const sample of samples) {
    if (sample.error || sample.viewport === undefined) continue;
    const spec = want.get(sample.id);
    if (spec === undefined) continue;
    max = Math.max(max, Math.abs(sample.viewport.width - spec[0]), Math.abs(sample.viewport.height - spec[1]));
  }
  return max;
}

/**
 * 写报告(确定性:无时间戳、无随机目录名、无绝对路径)。
 * @param {string} file 报告绝对路径
 * @param {object} report 报告正文
 * @returns {void}
 */
function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/** 规格与配置的公共部分(总报告与各档报告共用同一份,便于交叉核对) */
function reportSpecs() {
  return { scenarios: SCENARIOS, constantGroups: CONSTANT_GROUPS, selectors: NODE_SELECTORS, mediaConditions };
}

/* ══════════════ §7 worker 角色:在指定缩放档位下采 12 场景并裁决 ═══════════════ */

/**
 * worker 角色:在指定缩放档位下采 12 场景样本并裁决。
 * @returns {Promise<number>} 退出码(0 绿 / 1 红 / 2 未测量)
 */
async function runWorker() {
  const scales = parseScales(process.env.M2W_GEOMETRY_SCALE_FACTOR ?? "native");
  if (scales.length !== 1) {
    throw new Error(`worker 角色只接受单一缩放档位,收到「${process.env.M2W_GEOMETRY_SCALE_FACTOR}」`);
  }
  const request = scales[0];
  const label = scaleLabel(request);
  const workerReport =
    process.env.M2W_GEOMETRY_REPORT === undefined ? null : path.resolve(root, process.env.M2W_GEOMETRY_REPORT);
  const shotDir =
    process.env.M2W_GEOMETRY_SHOT_DIR === undefined
      ? (workerReport ?? path.join(outDir, `scale-${label}`))
      : path.resolve(root, process.env.M2W_GEOMETRY_SHOT_DIR);
  const reportFile = workerReport ?? path.join(shotDir, "report.json");

  if (!fs.existsSync(distIndex)) {
    throw new Error(`dist/renderer/index.html 不存在,先执行 npm run build 再跑 geometry gate(${distIndex})`);
  }
  fs.mkdirSync(shotDir, { recursive: true });
  // 缩放因子只在 Chromium 启动早期生效,必须早于 app ready 追加进程内开关;
  // 这是**模拟**系统缩放,不改系统 DPI 设置(改用户环境需授权,门禁不得做)
  if (request.mode === "forced") {
    app.commandLine.appendSwitch("force-device-scale-factor", String(request.value));
  }
  await app.whenReady();

  // 保持进程存活:窗口全部关闭后不自动退出,由末尾显式 app.exit(code) 收尾(退出码可控)
  app.on("window-all-closed", () => {});
  const displayScaleFactor = screen.getPrimaryDisplay().scaleFactor;

  const win = new BrowserWindow({
    show: false,
    width: SCENARIOS[0].viewport[0],
    height: SCENARIOS[0].viewport[1],
    webPreferences: {
      preload,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 隐藏窗口仍正常出帧:capturePage 拿最新画面
    },
  });

  await win.loadFile(distIndex);
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await exec(buildFreezeAnimationScript());

  // 缩放生效核验(防假绿第一道):页面实读 devicePixelRatio 与期望因子不符 → 本档不跑场景,
  // 直接记「未测量」。跑完 12 场景却不知道跑在什么缩放下,等于没测。
  const bootReadings = [Number(await exec("window.devicePixelRatio"))];
  const bootEffect = measureScaleEffect({
    request,
    measuredDevicePixelRatios: bootReadings,
    displayScaleFactor,
    expectedDevicePixelRatio: config.expectDpr,
  });
  if (!bootEffect.inEffect) {
    writeReport(reportFile, {
      tool: "check-geometry",
      scaleFactor: {
        label,
        requested: scaleRequestText(request),
        mode: request.mode,
        expectedDevicePixelRatio: bootEffect.expected,
        measuredDevicePixelRatios: bootEffect.measured,
        displayScaleFactor,
        inEffect: false,
        effectReason: bootEffect.reason,
      },
      status: "unmeasured",
      ok: false,
      reason: bootEffect.reason,
      geometry: null,
      reclassified: [],
      viewport: null,
      options: { ...config },
      specs: reportSpecs(),
      samples: [],
    });
    console.error(`[geo] 档位 ${label} 未测量:${bootEffect.reason}`);
    win.destroy();
    return 2;
  }
  console.log(`[geo] 档位 ${label}:devicePixelRatio=${bootEffect.measured.join("/")}(期望 ${String(bootEffect.expected)})`);

  // 就绪判定:i18n 静态文案已应用(版本徽章回填)+ 历史条完成首渲染
  await waitFor(
    exec,
    `document.getElementById("appVersion").textContent.length > 0 && ` +
      `document.getElementById("recentList").children.length > 0`,
    5000,
    "init ready",
  );

  const measureSource = buildMeasureScript(NODE_SELECTORS, mediaConditions);
  const samples = [];
  const settles = [];
  let current = null; // 首个场景也走 setContentSize,保证视口口径与规格一致

  for (const sc of SCENARIOS) {
    const [wantW, wantH] = sc.viewport;
    const resized = current === null || current[0] !== wantW || current[1] !== wantH;
    if (resized) {
      // 视口与响应式档位同时到位再量:高度媒体查询在隐藏窗口 resize 后重算滞后
      settles.push({ scenario: sc.id, ...(await settleViewport(win, exec, sc.viewport)) });
      current = [wantW, wantH];
    }
    let sample = { id: sc.id, viewport: { width: wantW, height: wantH }, shot: null, error: null };
    try {
      for (const step of sc.steps) {
        const op = OPS[step.op];
        if (op === undefined) {
          throw new Error(`未知驱动指令:${step.op}(规格表与驱动实现漂移)`);
        }
        await op(exec, step);
      }
      await wait(config.settleMs);
      const measured = await measureStable(
        exec,
        measureSource,
        resized ? config.stableAfterResizeMs : config.stableAfterStepMs,
        config.maxWaitMs,
      );
      if (sc.shot) {
        sample.shot = await screenshot(win, shotDir, sc.shot);
      }
      sample = { ...sample, ...measured, error: null };
    } catch (err) {
      sample.error = err instanceof Error ? err.message : String(err);
      if (sc.shot) {
        // 失败场景同样留痕截图,便于定位驱动/界面哪一步先崩
        sample.shot = await screenshot(win, shotDir, `${sc.shot}-FAILED`);
      }
    }
    samples.push(sample);
    const stage = sample.nodes?.dropZone?.dataStage ?? "(未测到)";
    console.log(
      `[geo] ${sc.id} ${wantW}×${wantH} stage=${stage} ` +
        `${sample.error ? `失败:${sample.error}` : (sample.shot ?? "(无截图)")}`,
    );
  }

  win.destroy();

  const result = runGeometryGate(samples, {
    tolPx: config.tolPx,
    scrollBudgetPx: config.scrollBudgetPx,
    mediaConditions,
  });
  const dprReadings = samples
    .map((sample) => sample.devicePixelRatio)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const maxDeltaPx = viewportMaxDelta(samples);
  // 判定层 finding 原样保留;状态语义(measured/failed/unmeasured)与跨档基线由编排层汇总
  const verdict = classifyScaleRun({
    label,
    request,
    status: /** @type {const} */ ("measured"),
    reason: null,
    measuredDevicePixelRatios: dprReadings,
    displayScaleFactor,
    findings: result.findings,
    viewportMaxDeltaPx: maxDeltaPx,
  });
  writeReport(reportFile, {
    tool: "check-geometry",
    scaleFactor: {
      label,
      requested: scaleRequestText(request),
      mode: request.mode,
      expectedDevicePixelRatio: bootEffect.expected,
      measuredDevicePixelRatios: dprReadings,
      displayScaleFactor,
      inEffect: bootEffect.inEffect,
      effectReason: bootEffect.reason,
    },
    status: verdict.status,
    ok: verdict.status === "measured",
    reason: verdict.reason,
    geometry: { ok: result.ok, stats: result.stats, findings: result.findings },
    reclassified: verdict.reclassified,
    viewport: {
      maxAbsDeltaPx: maxDeltaPx,
      compensationsUsed: settles.filter((item) => item.compensated).length,
      settles,
    },
    options: { ...config },
    specs: reportSpecs(),
    samples,
  });

  for (const f of result.findings) {
    console.error(`[geo:fail] ${f.rule} | ${f.scenario} | ${f.node ?? "-"} | ${f.message}`);
  }
  if (verdict.status === "measured") {
    console.log(
      `[geo:ok] 档位 ${label} 几何门禁通过:${result.stats.scenarios} 场景 / ${result.stats.groups} 恒定组 / ` +
        `容差 ${config.tolPx}px / 紧凑滚动预算 ${config.scrollBudgetPx}px;报告 ${path.relative(root, reportFile)}`,
    );
    return 0;
  }
  if (verdict.status === "unmeasured") {
    console.error(`[geo:partial] 档位 ${label} 记「未测量」(≠ 通过):${verdict.reason ?? "(无原因)"}`);
    return 2;
  }
  console.error(
    `[geo:fail] 档位 ${label} 几何门禁失败:共 ${result.findings.length} 项` +
      `(报告 ${path.relative(root, reportFile)},截图目录 ${path.relative(root, shotDir)})`,
  );
  return 1;
}

/* ══════════════ §8 编排角色:多档位串行 + 跨 DPI 基线 + 总报告 ═══════════════ */

/**
 * 起一个 worker 子进程并等它结束。
 * @param {object} input 输入
 * @param {ScaleRequest} input.request 档位请求
 * @param {string} input.label 档位标签
 * @param {string} input.reportPath worker 报告绝对路径
 * @param {string} input.shotDir worker 截图目录绝对路径
 * @returns {Promise<{ exitCode: number | null, signal: string | null, timedOut: boolean }>} 子进程结果
 */
function runWorkerProcess({ request, label, reportPath: workerReportPath, shotDir }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [selfPath], {
      env: {
        ...process.env,
        M2W_GEOMETRY_ROLE: "worker",
        M2W_GEOMETRY_SCALE_FACTOR: scaleRequestText(request),
        M2W_GEOMETRY_REPORT: workerReportPath,
        M2W_GEOMETRY_SHOT_DIR: shotDir,
        M2W_GEOMETRY_TOL_PX: String(config.tolPx),
        M2W_GEOMETRY_SCROLL_PX: String(config.scrollBudgetPx),
        M2W_GEOMETRY_SETTLE_MS: String(config.settleMs),
        M2W_GEOMETRY_STABLE_RESIZE_MS: String(config.stableAfterResizeMs),
        M2W_GEOMETRY_STABLE_STEP_MS: String(config.stableAfterStepMs),
        M2W_GEOMETRY_MAX_WAIT_MS: String(config.maxWaitMs),
        M2W_GEOMETRY_VIEWPORT_SETTLE_MS: String(config.viewportSettleMs),
        M2W_GEOMETRY_VIEWPORT_COMPENSATIONS: String(config.viewportCompensations),
        M2W_GEOMETRY_EXPECT_DPR: config.expectDpr === null ? "" : String(config.expectDpr),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    // 实时转发子进程输出并加档位前缀:长跑(每档 12 场景)无输出会让人以为卡死
    forward(child.stdout, label, false);
    forward(child.stderr, label, true);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[geo] 档位 ${label} 超过硬超时 ${config.runTimeoutMs}ms,终止 worker(该档记「未测量」)`);
      child.kill();
    }, config.runTimeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`[geo ${label}] worker 启动失败:${error instanceof Error ? error.message : String(error)}`);
      resolve({ exitCode: null, signal: null, timedOut });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut });
    });
  });
}

/**
 * 把子进程输出按行转发(带档位前缀)。
 * @param {NodeJS.ReadableStream | null} stream 输出流
 * @param {string} label 档位标签
 * @param {boolean} isErr 是否走 stderr
 * @returns {void}
 */
function forward(stream, label, isErr) {
  if (stream === null) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(label, line, isErr);
  });
  stream.on("end", () => {
    if (buffer !== "") emit(label, buffer, isErr);
  });
}

/**
 * 单行转发。
 * @param {string} label 档位标签
 * @param {string} line 文本
 * @param {boolean} isErr 是否走 stderr
 * @returns {void}
 */
function emit(label, line, isErr) {
  const text = `[geo ${label}] ${line}`;
  if (isErr) console.error(text);
  else console.log(text);
}

/**
 * 读 worker 报告;读不到一律当作「没有测到」,不返回半成品。
 * @param {string} file 报告绝对路径
 * @returns {object | null} 报告或 null
 */
function readWorkerReport(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`[geo] worker 报告无法解析(${path.basename(file)}):${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 由 worker 退出码 + 报告组装该档运行记录。
 *
 * 防假绿:报告说「measured/绿」但进程退出码非 0 时,以退出码为准记 failed ——
 * 判定与退出码不一致本身就是脚本缺陷,不能按绿放行。
 * @param {object} input 输入
 * @param {ScaleRequest} input.request 档位请求
 * @param {string} input.label 档位标签
 * @param {number | null} input.exitCode worker 退出码
 * @param {boolean} input.timedOut 是否超时被杀
 * @param {object | null} input.parsed worker 报告
 * @param {string} input.reportRelative 报告相对路径(写入总报告)
 * @param {string} shotDir 截图目录绝对路径
 * @returns {object} 运行记录
 */
function toRunRecord({ request, label, exitCode, timedOut, parsed, reportRelative, shotDir }) {
  const base = {
    label,
    requested: scaleRequestText(request),
    mode: request.mode,
    workerExitCode: exitCode,
    workerTimedOut: timedOut,
    report: reportRelative,
    shots: path.relative(root, shotDir).replaceAll("\\", "/"),
  };
  if (parsed === null) {
    return {
      ...base,
      status: /** @type {const} */ ("unmeasured"),
      reason: `worker 未产出可读报告(退出码 ${String(exitCode)}${timedOut ? ",已超时终止" : ""});该档未测量,不得记通过`,
      devicePixelRatio: { expected: null, measured: [], displayScaleFactor: null },
      viewport: null,
      geometry: null,
      samples: null,
    };
  }
  const scaleFactor = parsed.scaleFactor ?? {};
  const reportedStatus = parsed.status ?? "unmeasured";
  const inconsistent = reportedStatus === "measured" && exitCode !== 0;
  return {
    ...base,
    status: inconsistent ? /** @type {const} */ ("failed") : reportedStatus,
    reason:
      (inconsistent ? `worker 报告判绿但退出码为 ${String(exitCode)}(判定与退出码不一致,以退出码为准);` : "") +
      (parsed.reason ?? null),
    devicePixelRatio: {
      expected: scaleFactor.expectedDevicePixelRatio ?? null,
      measured: Array.isArray(scaleFactor.measuredDevicePixelRatios) ? scaleFactor.measuredDevicePixelRatios : [],
      displayScaleFactor: scaleFactor.displayScaleFactor ?? null,
    },
    viewport: parsed.viewport ?? null,
    geometry: parsed.geometry ?? null,
    samples: Array.isArray(parsed.samples) ? parsed.samples : null,
  };
}

/**
 * 编排入口:逐档跑 worker → 收报告 → 跨 DPI 基线与 diff → 落总报告 → 给退出码。
 * @param {ScaleRequest[]} scales 档位请求列表
 * @returns {Promise<number>} 退出码
 */
async function runOrchestrator(scales) {
  const baseDir = path.dirname(reportPath);
  /** @type {object[]} */
  const runs = [];
  for (const request of scales) {
    const label = scaleLabel(request);
    const shotDir = path.join(baseDir, `scale-${label}`);
    const workerReportPath = path.join(shotDir, "report.json");
    fs.mkdirSync(shotDir, { recursive: true });
    console.log(
      `[geo] 档位 ${label}(${request.mode === "native" ? "系统当前缩放" : `强制 ${String(request.value)}`})开始:` +
        `${SCENARIOS.length} 场景 × ${CONSTANT_GROUPS.length} 恒定组`,
    );
    const { exitCode, timedOut } = await runWorkerProcess({ request, label, reportPath: workerReportPath, shotDir });
    const record = toRunRecord({
      request,
      label,
      exitCode,
      timedOut,
      parsed: readWorkerReport(workerReportPath),
      reportRelative: path.relative(root, workerReportPath).replaceAll("\\", "/"),
      shotDir,
    });
    runs.push(record);
    const dprText = record.devicePixelRatio.measured.length > 0 ? record.devicePixelRatio.measured.join("/") : "(未读到)";
    if (record.status === "measured") {
      console.log(
        `[geo] 档位 ${label}:devicePixelRatio=${dprText}(期望 ${String(record.devicePixelRatio.expected)})→ ` +
          `${record.geometry?.stats?.scenarios ?? 0} 场景 / ${record.geometry?.stats?.groups ?? 0} 恒定组 绿`,
      );
    } else {
      console.error(`[geo:warn] 档位 ${label} ${record.status}:${record.reason ?? "(无原因)"}`);
    }
  }

  const diffable = runs
    .filter((run) => run.status === "measured" && run.samples !== null)
    .map((run) => ({
      label: run.label,
      request: scales.find((s) => scaleLabel(s) === run.label) ?? { mode: /** @type {const} */ ("native") },
      status: /** @type {const} */ ("measured"),
      reason: null,
      measuredDevicePixelRatios: run.devicePixelRatio.measured,
      displayScaleFactor: run.devicePixelRatio.displayScaleFactor,
      findings: [],
      samples: run.samples,
    }));
  const baseline = buildCrossDpiBaseline({ runs: diffable, nodes: CROSS_DPI_NODES });
  const crossDpi = diffCrossDpi({ baseline, tolPx: config.crossTolPx });
  const outcome = decideGateOutcome({ runs, crossDpi });

  const baselineRun = runs.find((run) => run.label === "native") ?? runs.find((run) => run.status === "measured") ?? null;
  const stats = runs.find((run) => run.geometry !== null)?.geometry?.stats;
  writeReport(reportPath, {
    tool: "check-geometry",
    schema: 2,
    ok: outcome.ok,
    status: outcome.status,
    exitCode: outcome.code,
    exitCodeSemantics: EXIT_CODE_SEMANTICS,
    options: {
      tolPx: config.tolPx,
      scrollBudgetPx: config.scrollBudgetPx,
      settleMs: config.settleMs,
      stableAfterResizeMs: config.stableAfterResizeMs,
      stableAfterStepMs: config.stableAfterStepMs,
      maxWaitMs: config.maxWaitMs,
      viewportSettleMs: config.viewportSettleMs,
      viewportCompensations: config.viewportCompensations,
      crossDpiTolPx: config.crossTolPx,
      runTimeoutMs: config.runTimeoutMs,
      expectDevicePixelRatio: config.expectDpr,
      scales: scales.map((request) => ({
        label: scaleLabel(request),
        requested: scaleRequestText(request),
        mode: request.mode,
      })),
    },
    stats: {
      scenarios: stats?.scenarios ?? SCENARIOS.length,
      groups: stats?.groups ?? CONSTANT_GROUPS.length,
      scalesRequested: runs.length,
      scalesMeasured: outcome.measured.length,
      scalesUnmeasured: outcome.unmeasured.length,
      scalesFailed: outcome.failed.length,
      crossDpiNodes: CROSS_DPI_NODES.length,
      crossDpiCells: crossDpi.compared,
      crossDpiStatus: crossDpi.status,
    },
    specs: reportSpecs(),
    scales: runs.map((run) => {
      const entry = { ...run };
      // 各档采样明细留在各自报告里,总报告不重复内联多份(基线档除外)
      delete entry.samples;
      return entry;
    }),
    crossDpi: {
      status: crossDpi.status,
      tolPx: crossDpi.tolPx,
      maxDeltaPx: crossDpi.maxDeltaPx,
      compared: crossDpi.compared,
      factors: baseline.factors,
      nodes: baseline.nodes,
      cells: baseline.cells,
      findings: crossDpi.findings,
      skipped: crossDpi.skipped,
    },
    findings: runs.flatMap((run) => (run.geometry?.findings ?? []).map((finding) => ({ scale: run.label, ...finding }))),
    // 基线档(系统当前缩放,缺失时取首个实测档)的完整采样明细内联在此;
    // 各档明细在各自报告里(总报告不重复内联多份 12 场景采样)
    baseline:
      baselineRun === null
        ? null
        : {
            label: baselineRun.label,
            devicePixelRatio: baselineRun.devicePixelRatio,
            report: baselineRun.report,
            samples: baselineRun.samples,
          },
  });

  for (const finding of crossDpi.findings) {
    console.error(`[geo:fail] ${finding.rule} | ${finding.scenario} | ${finding.node} | ${finding.message}`);
  }
  for (const run of runs) {
    for (const finding of run.geometry?.findings ?? []) {
      console.error(`[geo:fail] [${run.label}] ${finding.rule} | ${finding.scenario} | ${finding.node ?? "-"} | ${finding.message}`);
    }
  }
  printSummary({ runs, crossDpi, outcome, stats });
  return outcome.code;
}

/**
 * 打印总摘要(成功 / 红灯 / 未测量三种语义分别成句,不让「跑完了」看起来像「通过了」)。
 * @param {object} input 输入
 * @param {object[]} input.runs 各档运行记录
 * @param {ReturnType<typeof diffCrossDpi>} input.crossDpi 跨 DPI diff 结果
 * @param {ReturnType<typeof decideGateOutcome>} input.outcome 总判定
 * @param {object | undefined} input.stats 判定层统计(取首个有值的档位)
 * @returns {void}
 */
function printSummary({ runs, crossDpi, outcome, stats }) {
  const measuredText = runs
    .filter((run) => run.status === "measured")
    .map((run) => `${run.label}(dpr=${run.devicePixelRatio.measured.join("/")})`)
    .join("、");
  const reportRel = path.relative(root, reportPath);
  if (outcome.code === 0) {
    console.log(
      `[geo:ok] 几何门禁通过:实测 ${measuredText};${stats?.scenarios ?? SCENARIOS.length} 场景 / ` +
        `${stats?.groups ?? CONSTANT_GROUPS.length} 恒定组 / 容差 ${config.tolPx}px / ` +
        `紧凑滚动预算 ${config.scrollBudgetPx}px;跨 DPI 基线 ${crossDpi.compared} 单元` +
        `(最大偏差 ${crossDpi.maxDeltaPx}px ≤ 容差 ${crossDpi.tolPx}px,状态 ${crossDpi.status});报告 ${reportRel}`,
    );
    return;
  }
  if (outcome.code === 1) {
    console.error(
      `[geo:fail] 几何门禁失败:档位 ${outcome.failed.join("、") || "(无)"} 判红` +
        `${crossDpi.status === "over-tolerance" ? `,跨 DPI 基线超容差 ${config.crossTolPx}px` : ""}` +
        `(实测 ${measuredText};报告 ${reportRel},截图目录见报告 scales[].shots)`,
    );
    return;
  }
  console.error(
    `[geo:partial] 几何门禁部分完成:未测量档位 ${outcome.unmeasured.join("、")};` +
      `已测档位 ${outcome.measured.join("、") || "(无)"} 全绿,跨 DPI 状态 ${crossDpi.status}。` +
      `未测量 ≠ 通过,退出码 2;详见报告 ${reportRel} 的 scales[].reason`,
  );
}

/* ══════════════ §9 角色分派与退出 ═══════════════ */

/**
 * 编排角色的判定层自检门:不通过就不启动任何窗口(判定层自身不可信时不得再给结论)。
 * @returns {number} 退出码(0 通过)
 */
function runSelfTestGate() {
  const selfTest = runScaleSelfTest();
  if (config.selfTestOnly) {
    for (const item of selfTest.checks) {
      console.log(`[geo:selftest] ${item.ok ? "PASS" : "FAIL"} ${item.name}${item.detail === null ? "" : ` | ${item.detail}`}`);
    }
  }
  if (!selfTest.ok) {
    for (const item of selfTest.checks.filter((c) => !c.ok)) {
      console.error(`[geo:fail] 自检断言不成立 ${item.name}:${item.detail ?? ""}`);
    }
    console.error("[geo:fail] 缩放判定层自检不通过,门禁不启动(判定层自身不可信时不得再给结论)");
    return 1;
  }
  console.log(
    `[geo:selftest] 缩放判定层自检通过:${selfTest.checks.length} 条断言(锚点 ${selfTest.anchors} / 负向探针 ${selfTest.probes})`,
  );
  return 0;
}

async function main() {
  if (process.versions.electron === undefined) {
    throw new Error(
      `本脚本须经 Electron 运行(需真实窗口采样):请用 npm run check:geometry` +
        `(直接 node 运行会因取不到 app/BrowserWindow 而失败)`,
    );
  }
  if (process.env.M2W_GEOMETRY_ROLE === "worker") return runWorker();
  // 编排角色自身不建窗口,只负责起子进程与汇总;等 ready 只是为了让 app.exit 收尾干净
  await app.whenReady();
  if (config.selfTestOnly) return runSelfTestGate() === 0 ? 0 : 1;
  if (config.selfTest && runSelfTestGate() !== 0) return 1;
  return runOrchestrator(parseScales(process.env.M2W_GEOMETRY_SCALES));
}

// 退出码用 app.exit(显式码):Electron 的 app.quit() 走自身退出路径,
// 只设 process.exitCode 不生效(实测门禁判红而进程仍退出 0)。
// 报告与逐条 finding 已在 exit 之前落盘/打印,截图同时留存,便于 CI artifact 排障。
main().then(
  (code) => {
    process.exitCode = code;
    app.exit(code);
  },
  (err) => {
    console.error("[geo:fail] geometry gate 执行异常:", err);
    process.exitCode = 1;
    app.exit(1);
  },
);
