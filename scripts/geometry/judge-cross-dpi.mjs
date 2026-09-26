/**
 * 几何门禁判定层(跨 DPI 像素基线与总判定):记录各缩放档位下关键槽位与舞台几何的像素读数、
 * 做档位间 diff,并把各档状态 + diff 结果收敛成总判定与退出码。
 *
 * 纯函数,零 Electron / 零 fs / 零 DOM(依赖方向:仅依赖本岛内的类型与常量)。
 *
 * 阈值口径(与单 DPI 判定分开,缩放只增不改):
 * - 跨 DPI diff 单独放宽到 2 CSS px:布局在 CSS px 内算,理论上各档位应相同;但窗口尺寸要经
 *   「DIP → 物理像素 → DIP」两次取整(实测各档误差 0~2px,取整补偿见 driver.mjs settleViewport),
 *   叠加不同 GPU/驱动下 1~2px 栅格化抖动,同一元素 rect 会在 1~2px 间摆动。2px 是
 *   「吸收上述取整与抖动」够用、又不至于掩盖真实回归的上限(恒定契约本身是 0px 级契约,
 *   放到 4px 以上就失去守护意义)。宁可漏报 —— 环境差异不得把门禁变成常态红灯。
 * - 单 DPI 的 1px 容差、固定槽区间、恒定组与滚动预算一律不在本文件判定,它们由
 *   test/tools/geometry/geometry-core.mjs 以同一套参数在每个档位上各跑一遍。
 * - 不落任何跨运行基线文件:基线是「同一次门禁运行内各档位互比」。提交一份机器相关的基线会让
 *   换机器/换驱动的一方必然判红,那是环境噪声不是回归。
 *
 * 退出码:0 全绿 / 1 实测红灯 / 2 有档位未测量(未测量 ≠ 通过)。
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

/** 跨 DPI diff 阈值(CSS px);取值理由见本文件头 */
export const DEFAULT_CROSS_DPI_TOL_PX = 2;

/** 退出码语义(写进报告,让读报告的人不必回查源码就知道 2 与 0 的区别) */
export const EXIT_CODE_SEMANTICS = {
  0: "全绿:请求的每个缩放档位都真测过且几何判定全绿,跨 DPI diff 在容差内(单档时为 not-applicable)",
  1: "实测红灯:有档位测了且红,或跨 DPI diff 超容差",
  2: "部分:已测档位全绿,但有档位未测量(未测量 ≠ 通过)",
};

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
export function buildCrossDpiBaseline({ runs, nodes }) {
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
export function diffCrossDpi({ baseline, tolPx = DEFAULT_CROSS_DPI_TOL_PX }) {
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
export function decideGateOutcome({ runs, crossDpi }) {
  const failed = runs.filter((r) => r.status === "failed").map((r) => r.label);
  const unmeasured = runs.filter((r) => r.status === "unmeasured").map((r) => r.label);
  const measured = runs.filter((r) => r.status === "measured").map((r) => r.label);
  const code = failed.length > 0 || crossDpi.status === "over-tolerance" ? 1 : unmeasured.length > 0 ? 2 : 0;
  return { code, status: code === 0 ? "pass" : code === 1 ? "fail" : "partial", ok: code === 0, failed, unmeasured, measured };
}
