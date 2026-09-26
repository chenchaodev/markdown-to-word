/**
 * 几何门禁判定层(缩放档位):缩放档位解析、缩放因子是否真正生效的裁决、单档状态语义。
 *
 * 纯函数,零 Electron / 零 fs / 零 DOM:所有判定都能脱离窗口独立验证(见 selftest.mjs),
 * 也便于按档位做纯数据推演。这里是「缩放没真正生效就不算测到」这条防假绿规则的唯一出处。
 *
 * 阈值口径(单 DPI 与跨 DPI 分开,缩放只增不改):
 * - 单 DPI 判定(容差 1px、固定槽区间、舞台/动作栏恒定、紧凑档滚动预算 1px)在
 *   test/tools/geometry/geometry-core.mjs 内;每个缩放档位都用**同一套** tolPx=1 跑它。
 * - 本文件只管「这一档位是否真的被测到、测到的是什么状态」,不参与任何像素阈值比较。
 * - 退出码语义表(EXIT_CODE_SEMANTICS)随总判定语义一并定义在此,供报告自解释。
 *
 * 依赖方向:本文件不依赖任何其它岛(判定层是依赖链末端)。
 */
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

/* ══════════════ §1 缩放档位解析(纯函数)══════════════ */

/** 默认缩放档位:仅 native 单档(不干预系统缩放)。多档须显式指定,理由见下方裁决注释 */
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


/**
 * 缩放档视口取整假红的窄口径上限(视口轴向偏差,DIP px)。
 * 取整补偿后仍残留的偏差落在本上限内时,只把 viewport-mismatch 判为「未测量」(退出码 2);
 * 超出上限则照常判红 —— 真正的 setContentSize 失效不会只有 2px。
 */
const VIEWPORT_ROUNDING_MAX_PX = 3;

/** 档位数量上限(运行成本随档位数线性增长,超限显式拒绝而不是跑十几分钟) */
const MAX_SCALE_REQUESTS = 8;


/**
 * 解析缩放档位列表(逗号分隔)。`native` 表示不干预系统缩放,量当前值;
 * 其余为正数因子(1 / 1.25 / 1.5 …),由驱动以进程内开关模拟。
 * 非法值 / 重复值一律抛错:缩放档位写错若被静默忽略,门禁会拿默认档位跑出一份看似齐全的
 * 报告,那是典型的假绿。
 * @param {string | undefined | null} raw 原始字符串(未设置或全空白 → 默认档位)
 * @returns {ScaleRequest[]} 档位请求列表
 */
export function parseScales(raw) {
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
export function scaleLabel(request) {
  return request.mode === "native" ? "native" : `${String(request.value)}x`;
}

/**
 * 档位请求的文本形态(传环境变量给子进程 / 报错展示用)。
 * @param {ScaleRequest} request 档位请求
 * @returns {string} native 或因子数值文本
 */
export function scaleRequestText(request) {
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
export function measureScaleEffect({
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
export function classifyScaleRun(run) {
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
