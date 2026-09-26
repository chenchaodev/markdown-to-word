/**
 * geometry gate 判定层回归与负探针(位于 test/segments/ = 跨域守护段;
 * 被测为 test/tools/geometry/ 下的纯判定层,不经 dist 编译产物、不启真实窗口):
 * - 正向:按规格合成一整套"应当全绿"的采样样本,门禁判定必须零 finding;
 * - 负向:逐类注入故障(缺场景 / 缺选择器 / 必需节点不可见 / 视口不匹配 / 响应式档位未生效 /
 *   舞台状态不匹配 / 水平溢出 / 水平裁切 / 紧凑档滚动 / 固定槽塌陷 / 列轴漂移 / 阶段跳动 /
 *   场景步骤失败),断言**失败的规则名与场景**都命中 —— 只看"判红"会让"因错误原因失败"蒙混过关;
 * - 规格自洽:场景/节点/恒定组三张表互相引用不得悬空,880×620 与 640×560 档必须各有场景;
 * - 媒体查询:从真实样式表抽出的高度档条件可被求值器覆盖,未覆盖写法显式抛错而非忽略。
 *
 * 真实窗口采样链路(隐藏窗口 resize 后响应式档位重排滞后约 1s,故按布局稳定窗口采样)
 * 由 `electron scripts/check-geometry.mjs` 承担,本段只锁判定语义,两者互不依赖。
 */
import fs from "node:fs";
import path from "node:path";
import {
  CONSTANT_GROUPS,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  X_CLIP_KEYS,
  evaluateMediaCondition,
  extractHeightMediaConditions,
  runGeometryGate,
} from "../tools/geometry/geometry-core.mjs";
import { buildViewportSettledScript, parseMeasureScript } from "../tools/geometry/geometry-page.mjs";
import { ROOT } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`geometry-gate 断言失败:${msg}`);
}

/** 真实样式表里的高度档媒体查询(与门禁驱动同源同法) */
function readMediaConditions() {
  const styleDir = path.join(ROOT, "src", "renderer", "style");
  const conds = [];
  for (const file of fs.readdirSync(styleDir).filter((f) => f.endsWith(".css"))) {
    for (const cond of extractHeightMediaConditions(fs.readFileSync(path.join(styleDir, file), "utf8"))) {
      if (!conds.includes(cond)) conds.push(cond);
    }
  }
  return conds;
}

const MEDIA_CONDITIONS = readMediaConditions();

/** 合成一个节点度量:padding 盒由 rect + border 推出,滚动尺寸默认等于可视尺寸(即无溢出) */
function node(left, top, width, height, extra = {}) {
  const borderLeft = extra.borderLeft ?? 0;
  return {
    rect: { left, top, right: left + width, bottom: top + height, width, height },
    visible: extra.visible ?? true,
    display: extra.display ?? (extra.visible === false ? "none" : "block"),
    dataStage: extra.dataStage ?? null,
    borderLeft,
    clientWidth: width - borderLeft * 2,
    clientHeight: height,
    scrollWidth: extra.scrollWidth ?? width - borderLeft * 2,
    scrollHeight: extra.scrollHeight ?? height,
  };
}

/**
 * 各视口档的标称布局(内部自洽即可:舞台高度 = min(可用高, 设计高),纸面 760/591 宽,
 * 队列列 = 纸面内容盒内缩 14px,固定槽高度按档位取值)。
 * 取值贴近真实实测,便于失败信息里的数字可读;判定不依赖这些数字的绝对值。
 */
function layoutFor(viewport) {
  const isTall = viewport[1] > 640;
  const paperWidth = viewport[0] <= 720 ? 591 : 760;
  const paperLeft = (viewport[0] - paperWidth) / 2;
  const headerH = isTall ? 44 : 40;
  const wrapPadTop = isTall ? 16 : 12;
  const barH = 62;
  // 消息区固定槽高度 = base.css --feed-h 令牌值(常规 96 / 矮窗 86),不是自适应
  const feedH = isTall ? 96 : 86;
  const headH = isTall ? 40 : 36;
  const barTop = viewport[1] - barH;
  const feedTop = barTop - feedH;
  const histTop = feedTop - headH;
  const wrapTop = headerH;
  const wrapH = histTop - wrapTop;
  const paperContentLeft = paperLeft + 1; // .stage 有 1px 边线
  const paperContentWidth = paperWidth - 2;
  const stageH = Math.min(wrapH - wrapPadTop - 10, isTall ? 362 : 320);
  const quickBarH = isTall ? 42 : viewport[0] <= 720 ? 82 : 36;
  const stageTop = wrapTop + wrapPadTop;
  return {
    viewport,
    headerH,
    wrap: { left: 0, top: wrapTop, width: viewport[0], height: wrapH },
    stage: { left: paperLeft, top: stageTop, width: paperWidth, height: stageH },
    quickBar: { left: paperContentLeft, top: stageTop + stageH - quickBarH, width: paperContentWidth, height: quickBarH },
    paperContentLeft,
    paperContentWidth,
    barTop,
    feedTop,
    histTop,
    barH,
    feedH,
    headH,
  };
}

const LAYOUTS = new Map(SCENARIOS.map((sc) => [sc.viewport.join("x"), layoutFor(sc.viewport)]));

/** 造一份"应当全绿"的场景采样 */
function sampleFor(sc, mutate = () => {}) {
  const L = LAYOUTS.get(sc.viewport.join("x"));
  const queueLeft = L.paperContentLeft + 14;
  const queueWidth = L.paperContentWidth - 28;
  const isEmpty = sc.expectStage === "empty";
  const progressShown = sc.steps.some((step) => step.op === "progress" && step.show === true);
  const nodes = {
    dropZone: node(L.wrap.left, L.wrap.top, L.wrap.width, L.wrap.height, {
      borderLeft: 0,
      dataStage: sc.expectStage,
    }),
    stage: node(L.stage.left, L.stage.top, L.stage.width, L.stage.height, { borderLeft: 1 }),
    stagePanes: node(L.paperContentLeft, L.stage.top, L.paperContentWidth, L.stage.height - L.quickBar.height),
    quickBar: node(L.quickBar.left, L.quickBar.top, L.quickBar.width, L.quickBar.height),
    actionbar: node(0, L.barTop, L.viewport[0], L.barH),
    feed: node(0, L.feedTop, L.viewport[0], L.feedH),
    history: node(0, L.histTop, L.viewport[0], L.headH),
    historyHead: node(L.paperContentLeft, L.histTop, L.paperContentWidth, L.headH),
    recentList: node(0, L.histTop, 120, L.headH),
    status: node(0, L.feedTop, L.viewport[0], 20),
    progress: progressShown
      ? node(20, L.barTop - 26, L.viewport[0] - 40, 24)
      : node(0, 0, 0, 0, { visible: false, display: "none" }),
    dropCore: node(L.paperContentLeft + 120, L.stage.top + 40, Math.max(L.paperContentWidth - 240, 120), 180),
    ph: node(queueLeft, L.stage.top + 10, queueWidth, 29),
    listcard: node(queueLeft, L.stage.top + 49, queueWidth, Math.max(L.stage.height - 120, 60), { borderLeft: 1 }),
    fhint: node(queueLeft, L.stage.top + L.stage.height - 30, queueWidth, 18),
    multiList: isEmpty
      ? node(queueLeft, L.stage.top + 49, queueWidth, 40, { visible: false, display: "none" })
      : node(queueLeft, L.stage.top + 49, queueWidth, 40),
  };
  const sample = {
    id: sc.id,
    viewport: { width: sc.viewport[0], height: sc.viewport[1] },
    tiers: Object.fromEntries(
      MEDIA_CONDITIONS.map((cond) => [cond, evaluateMediaCondition(cond, { width: sc.viewport[0], height: sc.viewport[1] })]),
    ),
    doc: { scrollWidth: sc.viewport[0], clientWidth: sc.viewport[0], scrollHeight: 0, clientHeight: 0 },
    nodes,
    error: null,
  };
  mutate(sample);
  return sample;
}

const cleanSamples = () => SCENARIOS.map((sc) => sampleFor(sc));

/** 跑门禁并断言某条规则命中指定场景(不只看"判红",还看"因什么原因红") */
function expectRule(samples, rule, scenario, options = {}) {
  const result = runGeometryGate(samples, { mediaConditions: MEDIA_CONDITIONS, ...options });
  assert(result.ok === false, `注入「${rule}」故障后期禁仍判绿(门禁漏检)`);
  const hit = result.findings.filter((f) => f.rule === rule && (scenario === null || f.scenario === scenario));
  assert(hit.length > 0, `注入「${rule}」故障后未命中该规则,实际命中:${result.findings.map((f) => `${f.rule}@${f.scenario}`).join(",") || "无"}`);
  assert(
    String(hit[0].message).length > 20,
    `「${rule}」的失败信息须可定位(含规则/场景/节点/数字),实际:${hit[0].message}`,
  );
  return result;
}

/**
 * 改写某场景的某个节点度量(负探针的统一入口):
 * fn(node, nodes, key) 就地改度量;返回非 undefined 则整体替换该节点(如置 null 模拟选择器缺失)。
 */
function withNode(samples, scenarioId, key, fn) {
  return samples.map((s) => {
    if (s.id !== scenarioId) return s;
    const nodes = { ...s.nodes };
    const replacement = fn(nodes[key], nodes, key);
    if (replacement !== undefined) nodes[key] = replacement;
    return { ...s, nodes };
  });
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---------- 1. 正向:全绿样本零 finding ----------
  const green = runGeometryGate(cleanSamples(), { mediaConditions: MEDIA_CONDITIONS });
  assert(
    green.ok,
    `标称样本应全绿,实际命中:${green.findings.map((f) => `${f.rule}@${f.scenario}:${f.message}`).join(" | ")}`,
  );
  assert(green.findings.length === 0, "全绿样本不应产生任何 finding");
  assert(green.stats.scenarios === SCENARIOS.length, "统计的场景数应与规格表一致");
  assert(green.passedScenarios.length === SCENARIOS.length, "全部场景都应有有效采样");

  // ---------- 2. 负向:缺场景 / 场景步骤失败(不得静默跳过) ----------
  expectRule(cleanSamples().filter((s) => s.id !== "multi-960"), "scenario-missing", "multi-960");
  expectRule(cleanSamples().map((s) => (s.id === "single-960" ? { ...s, error: "选择器不存在 #selectBtn" } : s)), "scenario-failed", "single-960");

  // ---------- 3. 负向:缺选择器 / 必需节点不可见 ----------
  expectRule(withNode(cleanSamples(), "multi-960", "listcard", () => null), "selector-missing", "multi-960");
  expectRule(
    withNode(cleanSamples(), "converting-960", "progress", (n) => {
      n.visible = false;
      n.display = "none";
      n.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }),
    "selector-hidden",
    "converting-960",
  );

  // ---------- 4. 负向:视口不匹配 / 响应式档位未生效 / 舞台状态不匹配 ----------
  expectRule(
    cleanSamples().map((s) => (s.id === "compact-multi-880" ? { ...s, viewport: { width: 880, height: 700 } } : s)),
    "viewport-mismatch",
    "compact-multi-880",
  );
  expectRule(
    cleanSamples().map((s) =>
      s.id === "compact-multi-880" ? { ...s, tiers: { ...s.tiers, [MEDIA_CONDITIONS[0]]: false } } : s,
    ),
    "tier-mismatch",
    "compact-multi-880",
  );
  expectRule(
    withNode(cleanSamples(), "single-960", "dropZone", (n) => {
      n.dataStage = "empty";
    }),
    "stage-mismatch",
    "single-960",
  );

  // ---------- 5. 负向:视口容纳 / 水平溢出 / 水平裁切 ----------
  expectRule(
    withNode(cleanSamples(), "halfscreen-multi-640", "actionbar", (n) => {
      n.rect = { ...n.rect, width: n.rect.width + 80, right: n.rect.right + 80 };
    }),
    "viewport-overflow",
    "halfscreen-multi-640",
  );
  expectRule(
    cleanSamples().map((s) => ({ ...s, doc: { ...s.doc, scrollWidth: s.doc.scrollWidth + 40 } })),
    "horizontal-overflow",
    "empty-960",
  );
  expectRule(
    withNode(cleanSamples(), "multi-960", "dropZone", (n) => {
      n.scrollWidth = n.clientWidth + 24;
    }),
    "horizontal-clip",
    "multi-960",
  );

  // ---------- 6. 负向:紧凑档免滚动 / 固定槽塌陷 / 列轴漂移与越界 ----------
  expectRule(
    withNode(cleanSamples(), "halfscreen-empty-640", "dropZone", (n) => {
      n.scrollHeight = n.clientHeight + 9;
    }),
    "compact-scroll",
    "halfscreen-empty-640",
  );
  expectRule(
    withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
      n.rect = { left: n.rect.left, top: n.rect.top, right: n.rect.left, bottom: n.rect.top, width: 0, height: 0 };
    }),
    "slot-collapsed",
    "multi-960",
  );
  expectRule(
    withNode(cleanSamples(), "single-960", "fhint", (n) => {
      n.rect = { ...n.rect, left: n.rect.left + 12, right: n.rect.right + 12 };
      n.clientWidth = n.clientWidth + 12;
    }),
    "column-drift",
    "single-960",
  );
  expectRule(
    withNode(cleanSamples(), "single-960", "quickBar", (n) => {
      n.rect = { ...n.rect, left: n.rect.left - 30, right: n.rect.right - 30 };
      n.clientWidth = n.clientWidth - 30;
    }),
    "column-bleed",
    "single-960",
  );

  // ---------- 7. 负向:阶段跳动(容差内放过、超阈值判红) ----------
  const jump = (delta) =>
    withNode(cleanSamples(), "converting-960", "stage", (n) => {
      n.rect = {
        ...n.rect,
        top: n.rect.top + delta,
        bottom: n.rect.bottom + delta,
        height: n.rect.height + delta,
      };
      n.clientHeight = n.clientHeight + delta;
    });
  const withinTol = runGeometryGate(jump(0.5), { mediaConditions: MEDIA_CONDITIONS });
  assert(withinTol.ok, `容差内的 0.5px 抖动不应判红,实际:${withinTol.findings.map((f) => f.rule).join(",")}`);
  expectRule(jump(4), "geometry-jump", "converting-960");
  // 槽节点只锁高度:仅纵向位移不判红(位置由固定槽之上的布局决定)
  const slotShift = withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
    n.rect = { ...n.rect, top: n.rect.top + 9, bottom: n.rect.bottom + 9 };
  });
  assert(
    runGeometryGate(slotShift, { mediaConditions: MEDIA_CONDITIONS }).ok,
    "固定槽仅位置平移(高度不变)不应判红",
  );
  expectRule(
    withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
      n.rect = { ...n.rect, height: n.rect.height + 6, bottom: n.rect.bottom + 6 };
    }),
    "geometry-jump",
    "multi-960",
  );

  // ---------- 7b. 固定消息槽(OPT-4.4):高度恒定 + 撑高即判红 ----------
  // (1) 完成态(状态行 + 结果汇总条同处一槽)不得改写槽高
  expectRule(
    withNode(cleanSamples(), "after-convert-960", "feed", (n) => {
      n.rect = { ...n.rect, height: n.rect.height + 30, bottom: n.rect.bottom + 30 };
      n.clientHeight = n.clientHeight + 30;
    }),
    "geometry-jump",
    "after-convert-960",
  );
  // (2) 槽退化为 height:auto(结果汇总撑高)即越上限
  expectRule(
    withNode(cleanSamples(), "after-convert-960", "feed", (n) => {
      n.rect = { ...n.rect, height: 214, bottom: n.rect.top + 214 };
      n.clientHeight = 214;
    }),
    "slot-overflow",
    "after-convert-960",
  );
  // (3) 槽塌陷(高度趋零)命中下限,而不是被上限规则漏过
  expectRule(
    withNode(cleanSamples(), "compact-multi-880", "feed", (n) => {
      n.rect = { ...n.rect, height: 24, bottom: n.rect.top + 24 };
      n.clientHeight = 24;
    }),
    "slot-collapsed",
    "compact-multi-880",
  );

  // ---------- 8. 容差与滚动预算可注入(门禁松紧由参数决定,而非硬编码) ----------
  // 同一份 0.5px 抖动样本:默认容差 1px 放过,容差收紧到 0 即判红
  expectRule(jump(0.5), "geometry-jump", "converting-960", { tolPx: 0 });
  // 滚动预算同理:预算收到 -1 时"零溢出"也判红,证明 compact-scroll 真的在比较预算
  expectRule(cleanSamples(), "compact-scroll", "compact-multi-880", { scrollBudgetPx: -1 });

  // ---------- 9. 规格自洽:三张表互不悬空,且覆盖两档关键视口 ----------
  const ids = new Set(SCENARIOS.map((sc) => sc.id));
  assert(ids.size === SCENARIOS.length, "场景 id 必须唯一");
  for (const sc of SCENARIOS) {
    for (const key of [...(sc.visible ?? []), ...(sc.present ?? [])]) {
      assert(NODE_SELECTORS[key] !== undefined, `场景「${sc.id}」引用了未登记的测量节点 ${key}`);
    }
    for (const group of sc.columnAxis ?? []) {
      if (group.ref !== undefined) {
        assert(NODE_SELECTORS[group.ref] !== undefined, `场景「${sc.id}」列组参照节点未登记:${group.ref}`);
      }
      for (const key of group.members) {
        assert(NODE_SELECTORS[key] !== undefined, `场景「${sc.id}」列组成员未登记:${key}`);
      }
      assert(
        ["border", "padding"].includes(group.box),
        `列组「${group.name}」须声明 box 语义(border/padding),实际 ${String(group.box)}`,
      );
    }
  }
  for (const key of X_CLIP_KEYS) {
    assert(NODE_SELECTORS[key] !== undefined, `水平裁切守护节点未登记:${key}`);
  }
  for (const slot of SLOT_INVARIANTS) {
    assert(NODE_SELECTORS[slot.node] !== undefined, `固定槽节点未登记:${slot.node}`);
    assert(slot.minHeight > 0 && slot.why.length > 0, `固定槽「${slot.node}」须给出下限与依据`);
  }
  for (const group of CONSTANT_GROUPS) {
    assert(NODE_SELECTORS[group.node] !== undefined, `恒定组「${group.id}」节点未登记:${group.node}`);
    assert(ids.has(group.baseline), `恒定组「${group.id}」基准场景不存在:${group.baseline}`);
    for (const id of group.members) {
      assert(ids.has(id), `恒定组「${group.id}」成员场景不存在:${id}`);
    }
    assert(group.members.includes(group.baseline), `恒定组「${group.id}」成员须含基准场景 ${group.baseline}`);
    assert(group.why.length > 10, `恒定组「${group.id}」须写明契约出处(why)`);
  }
  for (const wanted of ["880x620", "640x560"]) {
    assert(
      SCENARIOS.some((sc) => sc.viewport.join("x") === wanted),
      `规格须覆盖关键视口 ${wanted}`,
    );
  }
  const compactScenarios = SCENARIOS.filter((o) => o.compact === true);
  assert(compactScenarios.length > 0, "须有场景承载紧凑档免滚动断言");
  assert(
    compactScenarios.every((o) => o.viewport[1] <= 640),
    "紧凑档场景的视口高须 <= 640(矮窗档),否则断言的不是紧凑档",
  );

  // ---------- 10. 媒体查询:真实样式表的高度档可求值,未覆盖写法显式抛错 ----------
  assert(MEDIA_CONDITIONS.length > 0, "真实样式表未找到高度维度媒体查询,档位断言将失去依据");
  for (const cond of MEDIA_CONDITIONS) {
    assert(evaluateMediaCondition(cond, { width: 960, height: 680 }) === false, `960×680 下 ${cond} 应不成立`);
    assert(evaluateMediaCondition(cond, { width: 640, height: 560 }) === true, `640×560 下 ${cond} 应成立`);
  }
  let unsupportedThrew = false;
  try {
    evaluateMediaCondition("(max-height: 40em)", { width: 960, height: 680 });
  } catch {
    unsupportedThrew = true;
  }
  assert(unsupportedThrew, "求值器遇到未覆盖写法应显式抛错(禁止静默忽略未覆盖的响应式档)");
  assert(
    extractHeightMediaConditions("@media (max-width: 720px) { .a { color: red } }").length === 0,
    "宽度维度媒体查询不应被当作高度档抽出",
  );

  // ---------- 11. 页面侧脚本契约:等待表达式与解析器 ----------
  const settled = buildViewportSettledScript([880, 620], MEDIA_CONDITIONS);
  assert(settled.includes("innerWidth"), "落定等待表达式应包含视口判定");
  assert(
    MEDIA_CONDITIONS.every((cond) => settled.includes(cond)),
    "落定等待表达式应包含全部高度档条件",
  );
  assert(settled.includes("=== true"), "880×620 下 (max-height: 640px) 的期望值应为 true");
  assert(!settled.includes("=== false"), "880×620 下不应出现 === false 的档位期望值");
  const parsed = parseMeasureScript(JSON.stringify({ nodes: {} }));
  assert(parsed.nodes !== undefined, "度量脚本解析应返回含 nodes 的对象");
  for (const bad of [null, 42, "{not json", "{}"]) {
    let threw = false;
    try {
      parseMeasureScript(bad);
    } catch {
      threw = true;
    }
    assert(threw, `度量脚本返回值非法时(${JSON.stringify(bad)})应显式抛错,不返回半成品样本`);
  }

  console.log(
    `[ok] geometry-gate:判定层正负探针通过(场景 ${SCENARIOS.length} / 恒定组 ${CONSTANT_GROUPS.length} / ` +
      `高度档 ${MEDIA_CONDITIONS.length} 条;13 类负向故障均按规则命中)`,
  );
}
