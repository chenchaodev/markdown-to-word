/**
 * 判定层自检(锚点 + 负向探针):逐条验证缩放判定与跨 DPI 基线判定的语义,含注入故障的负向探针。
 *
 * 为什么要有这一层:缩放参数化引入的新风险几乎全是「假绿」类 —— 参数写错被默认值吞掉、
 * 缩放因子没生效却记通过、跨 DPI 阈值取得过紧把环境噪声当回归(或过松到毫无守护)。
 * 这些都不该靠人工实跑发现,所以每条新判定都配一组负向探针:注入故障 → 必须判红/记未测量。
 * 探针一律断言「必须不通过」,绝不改成「总是通过」来掩盖空过。
 *
 * 纯函数,零 Electron / 零 fs(只依赖两个判定岛)。入口在每次门禁运行前跑一遍,
 * M2W_GEOMETRY_SELFTEST_ONLY=1 可单独秒级运行。
 */
import { classifyScaleRun, measureScaleEffect, parseScales } from "./judge-scale.mjs";
import { buildCrossDpiBaseline, decideGateOutcome, diffCrossDpi } from "./judge-cross-dpi.mjs";

/** @typedef {import("./judge-scale.mjs").ScaleRun} ScaleRun */
/** @typedef {import("./judge-cross-dpi.mjs").Rect4} Rect4 */

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
export function runScaleSelfTest() {
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
