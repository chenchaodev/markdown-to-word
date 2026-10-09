// @ts-check
/**
 * geometry gate 判定层回归与负探针(位于 test/shared/ = 镜像 shared/ 的段目录;
 * 被测为 shared/geometry/ 下的纯判定层,不经 dist 编译产物、不启真实窗口):
 * - 正向:按规格合成一整套"应当全绿"的采样样本,门禁判定必须零 finding;
 * - 负向:逐类注入故障(缺场景 / 缺选择器 / 必需节点不可见 / 视口不匹配 / 响应式档位未生效 /
 *   舞台状态不匹配 / 水平溢出 / 水平裁切 / 紧凑档滚动 / 固定槽塌陷 / 列轴漂移 / 阶段跳动 /
 *   场景步骤失败 / 抽屉控件缺失 / 抽屉错组 / 抽屉乱序 / 抽屉控件不可见 / 抽屉门控反向 /
 *   抽屉分档可用性反向 / 抽屉 tab 未切到位 / 抽屉未开 / 抽屉扫描面零命中 / 抽屉水平裁切),
 *   断言**失败的规则名与场景**都命中 —— 只看"判红"会让"因错误原因失败"蒙混过关;
 * - 规格自洽:场景/节点/恒定组/抽屉四张表互相引用不得悬空,880×620 与 640×560 档必须各有场景,
 *   抽屉分组与控件清单须与 index.html 的 data-group 面板对得上;
 * - 媒体查询:从真实样式表抽出的高度档条件可被求值器覆盖,未覆盖写法显式抛错而非忽略。
 * - CSS 令牌恒等:取消态配色判定的正负探针(取消态被读成成功绿/失败红、掉出中性区间、
 *   成功失败同色、读数漏项/漂移/目标缺失 —— 均须判红并命中预期规则名)。
 *
 * 真实窗口采样链路(隐藏窗口 resize 后响应式档位重排滞后约 1s,故按布局稳定窗口采样)
 * 由 `electron gates/geometry/check-geometry.mjs` 承担,本段只锁判定语义,两者互不依赖。
 */
import fs from "node:fs";
import path from "node:path";
import {
  CONSTANT_GROUPS,
  CSS_TOKEN_RULES,
  DRAWER_CLIP_KEYS,
  DRAWER_CONDITIONS,
  DRAWER_CONTROLS,
  DRAWER_CONTROL_KEYS,
  DRAWER_DISABLED_TIERS,
  DRAWER_GROUPS,
  DRAWER_GROUP_BY_KEY,
  DRAWER_MASTER_DEFAULTS,
  DRAWER_SELECTORS,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  X_CLIP_KEYS,
  drawerControl,
  drawerControlKey,
  drawerControlSelector,
  drawerGroupControls,
  evaluateMediaCondition,
  extractHeightMediaConditions,
  judgeCssTokens,
  runGeometryGate,
} from "../../shared/geometry/geometry-core.mjs";
import { buildViewportSettledScript, parseMeasureScript } from "../../shared/geometry/geometry-page.mjs";
import { LIVENESS_PATHS, checkPathLiveness, mediaConditions } from "../../gates/geometry/geometry/driver.mjs";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("geometry-gate");

/** 场景表项(契约单源 geometry-spec) @typedef {typeof SCENARIOS[number]} Scenario */
/** 门禁采样结果 @typedef {Parameters<typeof runGeometryGate>[0][number]} GeometrySample */
/** 节点度量样本 @typedef {NonNullable<GeometrySample["nodes"][string]>} NodeSample */
/** 抽屉度量样本 @typedef {NonNullable<GeometrySample["drawer"]>} DrawerSample */
/** 抽屉控件度量 @typedef {NonNullable<DrawerSample["controls"][string]>} DrawerControlSample */
/** 门禁判定结果 @typedef {ReturnType<typeof runGeometryGate>} GateResult */
/** 门禁阈值与档位条件 @typedef {NonNullable<Parameters<typeof runGeometryGate>[1]>} GateOptions */
/** 布局盒(left/top/width/height) @typedef {{left: number, top: number, width: number, height: number}} LayoutBox */
/**
 * 标称布局(各视口档内部自洽,判定不依赖绝对值)。
 * @typedef {object} NominalLayout
 * @property {Scenario["viewport"]} viewport 场景视口
 * @property {number} headerH 顶栏高
 * @property {LayoutBox} wrap 舞台容器
 * @property {LayoutBox} stage 纸面
 * @property {LayoutBox} quickBar 快捷条
 * @property {number} paperContentLeft 纸面内容盒左边
 * @property {number} paperContentWidth 纸面内容盒宽
 * @property {number} barTop 底部操作栏顶边
 * @property {number} feedTop 固定消息槽顶边
 * @property {number} histTop 历史槽顶边
 * @property {number} barH 操作栏高
 * @property {number} feedH 消息槽高
 * @property {number} headH 历史槽高
 */

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游代码依赖收窄(如 `pick` 判控件存在后直接返回它)⇒ 这里保留一层带窄化签名的壳,
 * 函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败说明
 * @returns {asserts cond} 条件不成立即抛错(供后续行收窄)
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/**
 * 节点 key 是否已在选择器表登记(NODE_SELECTORS 是只读字面量表,动态 key 需显式查询)。
 * @param {string} key 节点 key
 * @returns {boolean} 是否登记
 */
function hasNodeSelector(key) {
  return Object.hasOwn(NODE_SELECTORS, key);
}

/**
 * 真实样式表里的高度档媒体查询(与门禁驱动同源同法)。
 * @returns {string[]} 条件串(去重、保持出现序)
 */
function readMediaConditions() {
  const styleDir = path.join(ROOT, "src", "renderer", "style");
  /** @type {string[]} */
  const conds = [];
  for (const file of fs.readdirSync(styleDir).filter((f) => f.endsWith(".css"))) {
    for (const cond of extractHeightMediaConditions(fs.readFileSync(path.join(styleDir, file), "utf8"))) {
      if (!conds.includes(cond)) conds.push(cond);
    }
  }
  return conds;
}

const MEDIA_CONDITIONS = readMediaConditions();

/**
 * 合成一个节点度量:padding 盒由 rect + border 推出,滚动尺寸默认等于可视尺寸(即无溢出)。
 * @param {number} left 左
 * @param {number} top 上
 * @param {number} width 宽
 * @param {number} height 高
 * @param {{borderLeft?: number, visible?: boolean, display?: string, dataStage?: string | null, scrollWidth?: number, scrollHeight?: number}} [extra] 覆盖项
 * @returns {NodeSample} 节点度量
 */
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
 * @param {Scenario["viewport"]} viewport 场景视口
 * @returns {NominalLayout} 标称布局
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

/** @type {Map<string, NominalLayout>} */
const LAYOUTS = new Map(SCENARIOS.map((sc) => [sc.viewport.join("x"), layoutFor(sc.viewport)]));

/**
 * 造一份"应当全绿"的场景采样。
 * @param {Scenario} sc 场景表项
 * @param {(sample: GeometrySample) => void} [mutate] 就地改写采样的钩子
 * @returns {GeometrySample} 场景采样
 */
function sampleFor(sc, mutate = () => {}) {
  const L = LAYOUTS.get(sc.viewport.join("x"));
  if (L === undefined) throw new Error(`geometry-gate 场景「${sc.id}」缺少标称布局`);
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
  /** @type {GeometrySample} */
  const sample = {
    id: sc.id,
    viewport: { width: sc.viewport[0], height: sc.viewport[1] },
    tiers: Object.fromEntries(
      MEDIA_CONDITIONS.map((cond) => [cond, evaluateMediaCondition(cond, { width: sc.viewport[0], height: sc.viewport[1] })]),
    ),
    doc: { scrollWidth: sc.viewport[0], clientWidth: sc.viewport[0], scrollHeight: 0, clientHeight: 0 },
    nodes,
    ...(sc.drawerTab === undefined ? {} : { drawer: drawerSampleFor(sc, L) }),
    error: null,
  };
  mutate(sample);
  return sample;
}

/** 抽屉的标称外框(宽 min(440, 100vw-48);数值贴近实测,判定不依赖绝对值) */
const DRAWER_WIDTH = 440;
const DRAWER_TABS_W = 96;
const DRAWER_HEAD_H = 52;
const DRAWER_FOOT_H = 56;

/**
 * 某抽屉场景的主控档位:出厂默认(DRAWER_MASTER_DEFAULTS)叠上该场景显式驱动的档位。
 * 门禁判定层不读场景声明(它按样本实测反推预期),这份只用来合成「应当全绿」的样本基线。
 * @param {Scenario} sc 场景表项
 * @returns {Record<string, boolean | string>} 主控键 → 档位
 */
function masterStateFor(sc) {
  return { ...DRAWER_MASTER_DEFAULTS, ...(sc.drawerMasters ?? {}) };
}

/**
 * 造一份「应当全绿」的抽屉度量:全部控件在场、落在声明分组、文档序与声明序同序;
 * 激活面板内的控件有非零 rect,非激活面板的控件与被门控收起的从属项为零尺寸 + display:none。
 *
 * checked / value 只对**主控**给真值:判定层只读主控态来反推可见性预期,其余控件的
 * 勾选态与档位不进任何判据,故不必逐个编 —— 页面侧实测会给出真实值,门禁也不看。
 * @param {Scenario} sc 抽屉场景(须声明 drawerTab)
 * @param {NominalLayout} L 该视口的标称布局
 * @returns {DrawerSample} 抽屉度量
 */
function drawerSampleFor(sc, L) {
  const tab = sc.drawerTab;
  if (tab === undefined) throw new Error(`场景「${sc.id}」未声明 drawerTab,不能合成抽屉样本`);
  const masters = masterStateFor(sc);
  const shellLeft = L.viewport[0] - DRAWER_WIDTH;
  const panelLeft = shellLeft + DRAWER_TABS_W;
  const panelWidth = DRAWER_WIDTH - DRAWER_TABS_W;
  const panelTop = L.headerH + DRAWER_HEAD_H;
  const panelHeight = L.viewport[1] - panelTop - DRAWER_FOOT_H;
  /** @type {Record<string, DrawerControlSample>} */
  const controls = {};
  let row = 0;
  for (const key of DRAWER_CONTROL_KEYS) {
    const locator = drawerControl(key);
    const isRadio = locator.name !== undefined;
    const isMaster = Object.hasOwn(DRAWER_MASTER_DEFAULTS, key);
    const cond = DRAWER_CONDITIONS.find((c) => c.control === key);
    const tier = DRAWER_DISABLED_TIERS.find((t) => t.control === key);
    const condOn =
      cond === undefined
        ? true
        : cond.masterKind === "switch"
          ? masters[cond.master] === true
          : masters[cond.master] === cond.on;
    const visible = DRAWER_GROUP_BY_KEY.get(key) === tab && condOn;
    const box = node(
      visible ? panelLeft + 20 : 0,
      visible ? panelTop + 24 + row * 22 : 0,
      visible ? panelWidth - 40 : 0,
      visible ? 20 : 0,
      visible ? {} : { visible: false, display: "none" },
    );
    controls[key] = {
      found: true,
      group: DRAWER_GROUP_BY_KEY.get(key) ?? null,
      disabled: tier === undefined ? false : masters[tier.master] !== true,
      checked: isMaster && !isRadio ? masters[key] === true : isRadio,
      value: isRadio ? String(masters[key] ?? "default") : null,
      rect: box.rect,
      visible: box.visible,
      display: box.display,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
    };
    if (visible) row += 1;
  }
  /** @type {Record<string, NodeSample | null>} */
  const panels = {
    panels: node(panelLeft, panelTop, panelWidth, panelHeight),
    tabs: node(shellLeft, panelTop, DRAWER_TABS_W, panelHeight),
  };
  return { measured: DRAWER_CONTROL_KEYS.length, shellVisible: true, activeGroup: tab, controls, panels };
}

/** @returns {GeometrySample[]} 全绿样本集(每个规格场景一份) */
const cleanSamples = () => SCENARIOS.map((sc) => sampleFor(sc));

/**
 * 反查抽屉场景 id(按「激活分组 + 目标主控档位」)。写成反查而不是在测试里写死 id:
 * 场景改名后测试跟着报错,而不是静默指向一个不存在的场景让 expectRule 假通过。
 * @param {string} tab 激活分组
 * @param {Record<string, boolean | string>} [masters] 目标主控档位
 * @returns {string} 场景 id
 */
function drawerScenarioId(tab, masters = {}) {
  const want = JSON.stringify({ ...DRAWER_MASTER_DEFAULTS, ...masters });
  const hit = SCENARIOS.find((sc) => sc.drawerTab === tab && JSON.stringify(masterStateFor(sc)) === want);
  if (hit === undefined) {
    throw new Error(`规格里找不到抽屉场景:分组 ${tab} + 档位 ${JSON.stringify(masters)}`);
  }
  return hit.id;
}

/**
 * 取抽屉样本里的某个控件(缺项即抛错:负探针的键名写错必须炸在这里,
 * 而不是静默写到 undefined 上让 expectRule 因错误原因通过)
 * @param {DrawerSample} d 抽屉度量
 * @param {string} key 控件键
 * @returns {DrawerControlSample} 控件度量
 */
function pick(d, key) {
  const c = d.controls[key];
  assert(c !== undefined, `抽屉样本里没有控件 ${key}`);
  return c;
}

/**
 * 负探针的「控件被收起」注入:归零 rect + display:none(实测里 .hidden / .cond 收起
 * 落到页面侧就是这两个信号;visible 随之置 false,否则会同时命中 overflow 之类噪声规则)
 * @param {DrawerSample} d 抽屉度量
 * @param {string} key 控件键
 * @returns {void}
 */
function collapse(d, key) {
  const c = pick(d, key);
  c.visible = false;
  c.display = "none";
  c.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  c.clientWidth = 0;
  c.scrollWidth = 0;
}

/**
 * 负探针的「控件被错误地摆出来」注入:给它一个落在抽屉内的非零盒
 * @param {DrawerSample} d 抽屉度量
 * @param {string} key 控件键
 * @returns {void}
 */
function expand(d, key) {
  const c = pick(d, key);
  c.visible = true;
  c.display = "block";
  c.rect = { left: 640, top: 300, right: 900, bottom: 322, width: 260, height: 22 };
  c.clientWidth = 260;
  c.scrollWidth = 260;
}

/**
 * 负探针的「控件越出视口右缘」注入
 * @param {DrawerSample} d 抽屉度量
 * @param {string} key 控件键
 * @param {number} right 目标右沿
 * @returns {void}
 */
function pushRight(d, key, right) {
  const c = pick(d, key);
  const rect = c.rect;
  if (rect === undefined) throw new Error(`控件 ${key} 的样本缺少 rect`);
  c.rect = { left: rect.left, top: rect.top, right, bottom: rect.bottom, width: right - rect.left, height: rect.height };
}

/**
 * 负探针的「两个控件在视觉上对调」注入:整行互换(底沿跟着走,故仍是合法盒)。
 * 顺序判据比的是视觉行 + 左沿,所以要注入位置而不是序号。
 * @param {DrawerSample} d 抽屉度量
 * @param {string} a 控件键
 * @param {string} b 控件键
 * @returns {void}
 */
function swapRows(d, a, b) {
  const first = pick(d, a);
  const second = pick(d, b);
  const saved = first.rect;
  if (saved === undefined || second.rect === undefined) throw new Error(`控件 ${a} 或 ${b} 的样本缺少 rect`);
  first.rect = second.rect;
  second.rect = saved;
}

/**
 * 负探针的「抽屉内水平裁切」注入(浮层不进文档 scrollWidth,只能逐容器造)
 * @param {DrawerSample} d 抽屉度量
 * @param {string} key 容器键(DRAWER_CLIP_KEYS)
 * @param {number} overPx 超出量
 * @returns {void}
 */
function clipPanel(d, key, overPx) {
  const p = d.panels[key];
  if (p === null || p === undefined) throw new Error(`抽屉样本里没有容器 ${key}`);
  p.scrollWidth = p.clientWidth + overPx;
}

/**
 * 跑门禁并断言某条规则命中指定场景(不只看"判红",还看"因什么原因红")。
 * @param {GeometrySample[]} samples 注入故障后的采样集
 * @param {string} rule 期望命中的规则名
 * @param {string | null} scenario 期望命中的场景 id(null = 不限场景)
 * @param {GateOptions} [options] 门禁阈值覆盖
 * @returns {GateResult} 门禁判定结果
 */
function expectRule(samples, rule, scenario, options = {}) {
  const result = runGeometryGate(samples, { mediaConditions: MEDIA_CONDITIONS, ...options });
  assert(result.ok === false, `注入「${rule}」故障后期禁仍判绿(门禁漏检)`);
  const hit = result.findings.filter((f) => f.rule === rule && (scenario === null || f.scenario === scenario));
  const first = hit[0];
  assert(first !== undefined, `注入「${rule}」故障后未命中该规则,实际命中:${result.findings.map((f) => `${f.rule}@${f.scenario}`).join(",") || "无"}`);
  assert(
    String(first.message).length > 20,
    `「${rule}」的失败信息须可定位(含规则/场景/节点/数字),实际:${first.message}`,
  );
  return result;
}

/**
 * 改写某场景的某个节点度量(负探针的统一入口):
 * fn(node, nodes, key) 就地改度量;返回非 undefined 则整体替换该节点(如置 null 模拟选择器缺失)。
 * @param {GeometrySample[]} samples 原采样集
 * @param {string} scenarioId 目标场景 id
 * @param {string} key 目标节点 key
 * @param {(node: NodeSample, nodes: Record<string, NodeSample | null>, key: string) => NodeSample | null | undefined | void} fn 改写钩子
 * @returns {GeometrySample[]} 改写后的采样集
 */
function withNode(samples, scenarioId, key, fn) {
  return samples.map((s) => {
    if (s.id !== scenarioId) return s;
    const nodes = { ...s.nodes };
    // 放宽理由:样本已构造完成(nodes 全部为 NodeSample),Record 索引的
    // null | undefined 只来自类型层面;「置 null 模拟选择器缺失」由返回值覆盖表达。
    const replacement = fn(/** @type {NodeSample} */ (nodes[key]), nodes, key);
    if (replacement !== undefined) nodes[key] = replacement;
    return { ...s, nodes };
  });
}

/**
 * 改写某抽屉场景的抽屉度量(抽屉负探针的统一入口)。深拷贝后再改:抽屉段是嵌套两层的
 * 对象,浅拷贝会连带污染同一份 cleanSamples() 的其他场景,让「只注入一处故障」变成
 * 「注入一片故障」,红在错误的规则上。
 * @param {GeometrySample[]} samples 原采样集
 * @param {string} scenarioId 目标场景 id
 * @param {(drawer: DrawerSample) => void} fn 改写钩子
 * @returns {GeometrySample[]} 改写后的采样集
 */
function withDrawer(samples, scenarioId, fn) {
  return samples.map((s) => {
    if (s.id !== scenarioId || s.drawer === undefined) return s;
    const drawer = JSON.parse(JSON.stringify(s.drawer));
    fn(drawer);
    return { ...s, drawer };
  });
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // ---------- 1. 正向:全绿样本零 finding ----------
  // 门禁判定结果是本段全部判定的取数(每条 case 各自重跑,此处这份供正向断言用)
  const green = runGeometryGate(cleanSamples(), { mediaConditions: MEDIA_CONDITIONS });
  await suite.describe("正向 · 标称样本", async (s) => {
    await s.case("标称样本全绿(ok 为真)", () => {
      assert(
        green.ok,
        `标称样本应全绿,实际命中:${green.findings.map((f) => `${f.rule}@${f.scenario}:${f.message}`).join(" | ")}`,
      );
    });
    await s.case("标称样本零 finding", () => {
      assert(green.findings.length === 0, "全绿样本不应产生任何 finding");
    });
    await s.case("统计的场景数与规格表一致", () => {
      // 放宽理由:门禁的 stats 声明为 object(判定层刻意不外泄内部结构),
      // 此处只按契约读取 scenarios 计数。
      const greenStats = /** @type {{ scenarios: number }} */ (green.stats);
      assert(greenStats.scenarios === SCENARIOS.length, "统计的场景数应与规格表一致");
    });
    await s.case("全部场景都有有效采样", () => {
      assert(green.passedScenarios.length === SCENARIOS.length, "全部场景都应有有效采样");
    });
  });

  // ---------- 2. 负向:缺场景 / 场景步骤失败(不得静默跳过) ----------
  await suite.case("负探针 · 缺场景判红在 scenario-missing", () => {
    expectRule(cleanSamples().filter((s) => s.id !== "multi-960"), "scenario-missing", "multi-960");
  });
  await suite.case("负探针 · 场景步骤失败判红在 scenario-failed", () => {
    expectRule(cleanSamples().map((s) => (s.id === "single-960" ? { ...s, error: "选择器不存在 #selectBtn" } : s)), "scenario-failed", "single-960");
  });

  // ---------- 3. 负向:缺选择器 / 必需节点不可见 ----------
  await suite.case("负探针 · 节点缺失判红在 selector-missing", () => {
    expectRule(withNode(cleanSamples(), "multi-960", "listcard", () => null), "selector-missing", "multi-960");
  });
  await suite.case("负探针 · 必需节点不可见判红在 selector-hidden", () => {
    expectRule(
      withNode(cleanSamples(), "converting-960", "progress", (n) => {
        n.visible = false;
        n.display = "none";
        n.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      }),
      "selector-hidden",
      "converting-960",
    );
  });

  // ---------- 4. 负向:视口不匹配 / 响应式档位未生效 / 舞台状态不匹配 ----------
  await suite.case("负探针 · 视口不匹配判红在 viewport-mismatch", () => {
    expectRule(
      cleanSamples().map((s) => (s.id === "compact-multi-880" ? { ...s, viewport: { width: 880, height: 700 } } : s)),
      "viewport-mismatch",
      "compact-multi-880",
    );
  });
  // 首个高度档条件(缺省 "" 只在样式表未抽出任何条件时兜底,本段末尾另有非空断言)
  const [firstMediaCondition = ""] = MEDIA_CONDITIONS;
  await suite.case("负探针 · 响应式档位未生效判红在 tier-mismatch", () => {
    expectRule(
      cleanSamples().map((s) =>
        s.id === "compact-multi-880" ? { ...s, tiers: { ...s.tiers, [firstMediaCondition]: false } } : s,
      ),
      "tier-mismatch",
      "compact-multi-880",
    );
  });
  await suite.case("负探针 · 舞台状态不匹配判红在 stage-mismatch", () => {
    expectRule(
      withNode(cleanSamples(), "single-960", "dropZone", (n) => {
        n.dataStage = "empty";
      }),
      "stage-mismatch",
      "single-960",
    );
  });

  // ---------- 5. 负向:视口容纳 / 水平溢出 / 水平裁切 ----------
  await suite.case("负探针 · 视口容纳不下判红在 viewport-overflow", () => {
    expectRule(
      withNode(cleanSamples(), "halfscreen-multi-640", "actionbar", (n) => {
        n.rect = { ...n.rect, width: n.rect.width + 80, right: n.rect.right + 80 };
      }),
      "viewport-overflow",
      "halfscreen-multi-640",
    );
  });
  await suite.case("负探针 · 文档水平溢出判红在 horizontal-overflow", () => {
    expectRule(
      cleanSamples().map((s) => ({ ...s, doc: { ...s.doc, scrollWidth: s.doc.scrollWidth + 40 } })),
      "horizontal-overflow",
      "empty-960",
    );
  });
  await suite.case("负探针 · 节点水平裁切判红在 horizontal-clip", () => {
    expectRule(
      withNode(cleanSamples(), "multi-960", "dropZone", (n) => {
        n.scrollWidth = n.clientWidth + 24;
      }),
      "horizontal-clip",
      "multi-960",
    );
  });

  // ---------- 6. 负向:紧凑档免滚动 / 固定槽塌陷 / 列轴漂移与越界 ----------
  await suite.case("负探针 · 紧凑档免滚动预算超支判红在 compact-scroll", () => {
    expectRule(
      withNode(cleanSamples(), "halfscreen-empty-640", "dropZone", (n) => {
        n.scrollHeight = n.clientHeight + 9;
      }),
      "compact-scroll",
      "halfscreen-empty-640",
    );
  });
  await suite.case("负探针 · 固定槽塌陷判红在 slot-collapsed", () => {
    expectRule(
      withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
        n.rect = { left: n.rect.left, top: n.rect.top, right: n.rect.left, bottom: n.rect.top, width: 0, height: 0 };
      }),
      "slot-collapsed",
      "multi-960",
    );
  });
  await suite.case("负探针 · 列轴漂移判红在 column-drift", () => {
    expectRule(
      withNode(cleanSamples(), "single-960", "fhint", (n) => {
        n.rect = { ...n.rect, left: n.rect.left + 12, right: n.rect.right + 12 };
        n.clientWidth = n.clientWidth + 12;
      }),
      "column-drift",
      "single-960",
    );
  });
  await suite.case("负探针 · 列轴越界判红在 column-bleed", () => {
    expectRule(
      withNode(cleanSamples(), "single-960", "quickBar", (n) => {
        n.rect = { ...n.rect, left: n.rect.left - 30, right: n.rect.right - 30 };
        n.clientWidth = n.clientWidth - 30;
      }),
      "column-bleed",
      "single-960",
    );
  });

  // ---------- 7. 负向:阶段跳动(容差内放过、超阈值判红) ----------
  /** @param {number} delta 位移量(px) */
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
  await suite.case("阶段抖动 · 容差内的位移不判红", () => {
    const withinTol = runGeometryGate(jump(0.5), { mediaConditions: MEDIA_CONDITIONS });
    assert(withinTol.ok, `容差内的 0.5px 抖动不应判红,实际:${withinTol.findings.map((f) => f.rule).join(",")}`);
  });
  await suite.case("负探针 · 超容差位移判红在 geometry-jump", () => {
    expectRule(jump(4), "geometry-jump", "converting-960");
  });
  // 槽节点只锁高度:仅纵向位移不判红(位置由固定槽之上的布局决定)
  await suite.case("阶段抖动 · 固定槽仅位置平移不判红", () => {
    const slotShift = withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
      n.rect = { ...n.rect, top: n.rect.top + 9, bottom: n.rect.bottom + 9 };
    });
    assert(
      runGeometryGate(slotShift, { mediaConditions: MEDIA_CONDITIONS }).ok,
      "固定槽仅位置平移(高度不变)不应判红",
    );
  });
  await suite.case("负探针 · 固定槽撑高判红在 geometry-jump", () => {
    expectRule(
      withNode(cleanSamples(), "multi-960", "historyHead", (n) => {
        n.rect = { ...n.rect, height: n.rect.height + 6, bottom: n.rect.bottom + 6 };
      }),
      "geometry-jump",
      "multi-960",
    );
  });

  // ---------- 7b. 固定消息槽:高度恒定 + 撑高即判红 ----------
  await suite.case("负探针 · 完成态改写消息槽高判红在 geometry-jump", () => {
    // (1) 完成态(状态行 + 结果汇总条同处一槽)不得改写槽高
    expectRule(
      withNode(cleanSamples(), "after-convert-960", "feed", (n) => {
        n.rect = { ...n.rect, height: n.rect.height + 30, bottom: n.rect.bottom + 30 };
        n.clientHeight = n.clientHeight + 30;
      }),
      "geometry-jump",
      "after-convert-960",
    );
  });
  await suite.case("负探针 · 消息槽撑高越上限判红在 slot-overflow", () => {
    // (2) 槽退化为 height:auto(结果汇总撑高)即越上限
    expectRule(
      withNode(cleanSamples(), "after-convert-960", "feed", (n) => {
        n.rect = { ...n.rect, height: 214, bottom: n.rect.top + 214 };
        n.clientHeight = 214;
      }),
      "slot-overflow",
      "after-convert-960",
    );
  });
  await suite.case("负探针 · 消息槽塌陷命中下限而非被上限规则漏过", () => {
    // (3) 槽塌陷(高度趋零)命中下限,而不是被上限规则漏过
    expectRule(
      withNode(cleanSamples(), "compact-multi-880", "feed", (n) => {
        n.rect = { ...n.rect, height: 24, bottom: n.rect.top + 24 };
        n.clientHeight = 24;
      }),
      "slot-collapsed",
      "compact-multi-880",
    );
  });

  // ---------- 8. 容差与滚动预算可注入(门禁松紧由参数决定,而非硬编码) ----------
  await suite.case("负探针 · 容差收紧到 0 时同一抖动判红在 geometry-jump", () => {
    // 同一份 0.5px 抖动样本:默认容差 1px 放过,容差收紧到 0 即判红
    expectRule(jump(0.5), "geometry-jump", "converting-960", { tolPx: 0 });
  });
  await suite.case("负探针 · 滚动预算收到 -1 时零溢出也判红在 compact-scroll", () => {
    // 滚动预算同理:预算收到 -1 时"零溢出"也判红,证明 compact-scroll 真的在比较预算
    expectRule(cleanSamples(), "compact-scroll", "compact-multi-880", { scrollBudgetPx: -1 });
  });

  // ---------- 8b. 抽屉:控件缺失 / 错组 / 乱序 / 不可见 ----------
  await suite.describe("负探针 · 抽屉控件四类失效", async (s) => {
    await s.case("抽屉控件不存在判红在 selector-missing", () => {
      // (1) 控件不存在:精确红在 selector-missing,而不是被「抽屉里 0 个异常」静默放过
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          d.controls.marginTop = { found: false };
        }),
        "selector-missing",
        drawerScenarioId("typography"),
      );
    });
    await s.case("控件被挪到别的 panel 判红在 drawer-group-mismatch", () => {
      // (2) 控件被挪到别的 panel
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          pick(d, "marginTop").group = "numbering";
        }),
        "drawer-group-mismatch",
        drawerScenarioId("typography"),
      );
    });
    await s.case("组内顺序被打乱判红在 drawer-order-mismatch", () => {
      // (3) 组内顺序被打乱(正文字号与行距在视觉上对调)
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          swapRows(d, "bodySizePt", "lineSpacing");
        }),
        "drawer-order-mismatch",
        drawerScenarioId("typography"),
      );
    });
    await s.case("控件被收起判红在 selector-hidden", () => {
      // (4) 控件 rect 归零 / 被 display:none 隐藏
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          collapse(d, "bodySizePt");
        }),
        "selector-hidden",
        drawerScenarioId("typography"),
      );
    });
    await s.case("抽屉开着但面板没切到位判红在 drawer-tab-mismatch", () => {
      // (5) 抽屉开着但某个分组的面板没切到位 → 量到的是上一组
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("app"), (d) => {
          d.activeGroup = "convert";
        }),
        "drawer-tab-mismatch",
        drawerScenarioId("app"),
      );
    });
    await s.case("抽屉没开判红在 drawer-closed", () => {
      // (6) 抽屉没开
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("preset"), (d) => {
          d.shellVisible = false;
        }),
        "drawer-closed",
        drawerScenarioId("preset"),
      );
    });
    await s.case("扫描面零命中判红在 selector-missing", () => {
      // (7) 扫描面零命中:一个控件都没量到时必须判红,不能当成「无问题」
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("preset"), (d) => {
          d.measured = 0;
        }),
        "selector-missing",
        drawerScenarioId("preset"),
      );
    });
    await s.case("抽屉内水平裁切判红在 horizontal-clip", () => {
      // (8) 抽屉内水平裁切(浮层不进文档 scrollWidth,故只能逐容器判)
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          clipPanel(d, "panels", 18);
        }),
        "horizontal-clip",
        drawerScenarioId("typography"),
      );
    });
    await s.case("抽屉控件越出视口右缘判红在 viewport-overflow", () => {
      // (9) 抽屉控件越出视口右缘
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("typography"), (d) => {
          pushRight(d, "bodySizePt", 996);
        }),
        "viewport-overflow",
        drawerScenarioId("typography"),
      );
    });
  });

  // ---------- 8c. 抽屉门控:两个方向都要判红 ----------
  await suite.describe("负探针 · 抽屉门控双向", async (s) => {
    await s.case("该收起的从属项仍可见判红在 drawer-gate-inverted(目录下拉)", () => {
      // (1) 该收起的从属项仍然可见(toc 关着而目录下拉摆在那儿;toc 出厂即开,关态是点一次关掉那侧)
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("numbering", { toc: false }), (d) => {
          expand(d, "tocMode");
        }),
        "drawer-gate-inverted",
        drawerScenarioId("numbering", { toc: false }),
      );
    });
    await s.case("该出现的从属项不出现判红在 selector-hidden(目录下拉)", () => {
      // (2) 同一门控的另一侧:toc 开着而目录下拉不出现(只测关闭侧会放过这类漏项)
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("numbering"), (d) => {
          collapse(d, "tocMode");
        }),
        "selector-hidden",
        drawerScenarioId("numbering"),
      );
    });
    await s.case("页眉自定义折叠关闭侧判红在 drawer-gate-inverted", () => {
      // (3) 页眉自定义折叠的关闭侧
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("headerwatermark"), (d) => {
          expand(d, "headerText");
        }),
        "drawer-gate-inverted",
        drawerScenarioId("headerwatermark"),
      );
    });
    await s.case("页眉自定义折叠另一侧判红在 selector-hidden", () => {
      // (4) 页眉自定义折叠的另一侧(headerMode=custom 而凹陷容器没收起)
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("headerwatermark", { headerMode: "custom" }), (d) => {
          collapse(d, "headerLayout");
        }),
        "selector-hidden",
        drawerScenarioId("headerwatermark", { headerMode: "custom" }),
      );
    });
    await s.case("总开关关着而分档可点判红在 drawer-tier-availability", () => {
      // (5) AI 清理分档是**灰禁不是收起**(IA §3 规则 1 的唯一例外):总开关关着却可点即判红
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("convert"), (d) => {
          pick(d, "aiCleanupTidy").disabled = false;
        }),
        "drawer-tier-availability",
        drawerScenarioId("convert"),
      );
    });
    await s.case("总开关开着而分档仍灰禁判红在 drawer-tier-availability", () => {
      // (6) 反向:总开关开着而分档仍灰禁
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("convert", { aiCleanup: true }), (d) => {
          pick(d, "aiCleanupRewrite").disabled = true;
        }),
        "drawer-tier-availability",
        drawerScenarioId("convert", { aiCleanup: true }),
      );
    });
    await s.case("门控主控不可读判红在 drawer-master-unreadable", () => {
      // (7) 主控自身不可读:门控预期落空,须显式记 finding 而不是按「收起」放行
      expectRule(
        withDrawer(cleanSamples(), drawerScenarioId("numbering", { toc: false }), (d) => {
          d.controls.toc = { found: false };
        }),
        "drawer-master-unreadable",
        drawerScenarioId("numbering", { toc: false }),
      );
    });
  });

  // ---------- 9. 规格自洽:三张表互不悬空,且覆盖两档关键视口 ----------
  /** @type {Set<string>} */
  const ids = new Set(SCENARIOS.map((sc) => sc.id));
  const compactScenarios = SCENARIOS.filter((o) => o.compact === true);
  // ids / compactScenarios 是本组多条断言共用的派生集,留在 case 外
  await suite.describe("规格自洽 · 场景/节点/恒定组三表", async (s) => {
    await s.case("场景 id 唯一", () => {
      assert(ids.size === SCENARIOS.length, "场景 id 必须唯一");
    });
    await s.case("场景引用的测量节点与列组成员都已登记", () => {
      for (const sc of SCENARIOS) {
        for (const key of [...(sc.visible ?? []), ...(sc.present ?? [])]) {
          assert(hasNodeSelector(key), `场景「${sc.id}」引用了未登记的测量节点 ${key}`);
        }
        for (const group of sc.columnAxis ?? []) {
          if (group.ref !== undefined) {
            assert(hasNodeSelector(group.ref), `场景「${sc.id}」列组参照节点未登记:${group.ref}`);
          }
          for (const key of group.members) {
            assert(hasNodeSelector(key), `场景「${sc.id}」列组成员未登记:${key}`);
          }
          assert(
            ["border", "padding"].includes(group.box),
            `列组「${group.name}」须声明 box 语义(border/padding),实际 ${String(group.box)}`,
          );
        }
      }
    });
    await s.case("水平裁切守护节点都已登记", () => {
      for (const key of X_CLIP_KEYS) {
        assert(hasNodeSelector(key), `水平裁切守护节点未登记:${key}`);
      }
    });
    await s.case("固定槽节点已登记且给出下限与依据", () => {
      for (const slot of SLOT_INVARIANTS) {
        assert(hasNodeSelector(slot.node), `固定槽节点未登记:${slot.node}`);
        assert(slot.minHeight > 0 && slot.why.length > 0, `固定槽「${slot.node}」须给出下限与依据`);
      }
    });
    await s.case("恒定组的节点/成员场景/契约出处都在册", () => {
      for (const group of CONSTANT_GROUPS) {
        assert(hasNodeSelector(group.node), `恒定组「${group.id}」节点未登记:${group.node}`);
        assert(ids.has(group.baseline), `恒定组「${group.id}」基准场景不存在:${group.baseline}`);
        for (const id of group.members) {
          assert(ids.has(id), `恒定组「${group.id}」成员场景不存在:${id}`);
        }
        assert(group.members.includes(group.baseline), `恒定组「${group.id}」成员须含基准场景 ${group.baseline}`);
        assert(group.why.length > 10, `恒定组「${group.id}」须写明契约出处(why)`);
      }
    });
    await s.case("两档关键视口各有场景承载", () => {
      for (const wanted of ["880x620", "640x560"]) {
        assert(
          SCENARIOS.some((sc) => sc.viewport.join("x") === wanted),
          `规格须覆盖关键视口 ${wanted}`,
        );
      }
    });
    await s.case("紧凑档场景存在且视口高不高于矮窗档", () => {
      assert(compactScenarios.length > 0, "须有场景承载紧凑档免滚动断言");
      assert(
        compactScenarios.every((o) => o.viewport[1] <= 640),
        "紧凑档场景的视口高须 <= 640(矮窗档),否则断言的不是紧凑档",
      );
    });
  });

  // ---------- 10. 媒体查询:真实样式表的高度档可求值,未覆盖写法显式抛错 ----------
  await suite.describe("媒体查询 · 高度档可求值", async (s) => {
    await s.case("真实样式表抽出了高度维度媒体查询", () => {
      assert(MEDIA_CONDITIONS.length > 0, "真实样式表未找到高度维度媒体查询,档位断言将失去依据");
    });
    // 每条高度档一行 case:case 名用条件串本身(它就是这一行的稳定标识)
    for (const cond of MEDIA_CONDITIONS) {
      await s.case(`高度档求值方向:${cond}`, () => {
        assert(evaluateMediaCondition(cond, { width: 960, height: 680 }) === false, `960×680 下 ${cond} 应不成立`);
        assert(evaluateMediaCondition(cond, { width: 640, height: 560 }) === true, `640×560 下 ${cond} 应成立`);
      });
    }
    await s.case("未覆盖写法显式抛错而非静默忽略", () => {
      let unsupportedThrew = false;
      try {
        evaluateMediaCondition("(max-height: 40em)", { width: 960, height: 680 });
      } catch {
        unsupportedThrew = true;
      }
      assert(unsupportedThrew, "求值器遇到未覆盖写法应显式抛错(禁止静默忽略未覆盖的响应式档)");
    });
    await s.case("宽度维度媒体查询不被当作高度档抽出", () => {
      assert(
        extractHeightMediaConditions("@media (max-width: 720px) { .a { color: red } }").length === 0,
        "宽度维度媒体查询不应被当作高度档抽出",
      );
    });
  });

  // ---------- 11. 页面侧脚本契约:等待表达式与解析器 ----------
  const settled = buildViewportSettledScript([880, 620], MEDIA_CONDITIONS);
  await suite.describe("页面侧脚本契约", async (s) => {
    await s.case("落定等待表达式包含视口判定与全部高度档条件", () => {
      assert(settled.includes("innerWidth"), "落定等待表达式应包含视口判定");
      assert(
        MEDIA_CONDITIONS.every((cond) => settled.includes(cond)),
        "落定等待表达式应包含全部高度档条件",
      );
    });
    await s.case("880×620 下的档位期望值全为 true(不出现 === false)", () => {
      assert(settled.includes("=== true"), "880×620 下 (max-height: 640px) 的期望值应为 true");
      assert(!settled.includes("=== false"), "880×620 下不应出现 === false 的档位期望值");
    });
    await s.case("度量脚本解析返回含 nodes 的对象", () => {
      const parsed = parseMeasureScript(JSON.stringify({ nodes: {} }));
      assert(parsed.nodes !== undefined, "度量脚本解析应返回含 nodes 的对象");
    });
    for (const bad of [null, 42, "{not json", "{}"]) {
      await s.case(`度量脚本返回值非法时显式抛错:${JSON.stringify(bad)}`, () => {
        let threw = false;
        try {
          parseMeasureScript(bad);
        } catch {
          threw = true;
        }
        assert(threw, `度量脚本返回值非法时(${JSON.stringify(bad)})应显式抛错,不返回半成品样本`);
      });
    }
  });

  // ---------- 11b. 抽屉规格自洽:表 ↔ 表 ↔ index.html 三方对得上 ----------
  const registered = new Set(DRAWER_CONTROL_KEYS);
  const masterKeys = new Set(Object.keys(DRAWER_MASTER_DEFAULTS));
  const drawerScenarios = SCENARIOS.filter((s) => s.drawerTab !== undefined);
  // 顺序判据只取可见控件(收起态位置无意义),故每个控件至少要在一条场景里可见,
  // 否则它的组内顺序永远无人判 —— 门禁"覆盖了 40 个控件"这句话就会掺水。
  // 这份合成是纯取数(逐场景重造抽屉度量),留在 case 外
  const everVisible = new Set();
  for (const sc of drawerScenarios) {
    const drawer = drawerSampleFor(sc, /** @type {NominalLayout} */ (LAYOUTS.get(sc.viewport.join("x"))));
    for (const [key, control] of Object.entries(drawer.controls)) {
      if (control.visible === true) everVisible.add(key);
    }
  }
  // index.html 交叉比对:分组取值、tab 顺序、控件锚点所在面板(读盘 + 切片留在 case 外)
  const html = fs.readFileSync(path.join(ROOT, "src", "renderer", "index.html"), "utf8");
  const panelGroups = [...html.matchAll(/<section[^>]*\bdata-group="([^"]+)"/g)].map((m) => m[1]);
  const tabOrder = [...html.matchAll(/id="settingsTab-([^"]+)"/g)].map((m) => m[1]);
  /** 分组 → 该 <section> 到下一个 <section> 之间的正文 */
  const panelSlices = new Map();
  const sectionStarts = [...html.matchAll(/<section\b/g)].map((m) => m.index ?? 0);
  for (const [index, at] of sectionStarts.entries()) {
    const group = /\bdata-group="([^"]+)"/.exec(html.slice(at, html.indexOf(">", at)));
    if (group === null) continue;
    const end = index + 1 < sectionStarts.length ? sectionStarts[index + 1] : html.length;
    panelSlices.set(group[1], html.slice(at, end));
  }
  await suite.describe("规格自洽 · 抽屉三表与 index.html 对得上", async (s) => {
    await s.case("抽屉分组/控件键唯一且 DRAWER_CONTROLS 与分组一一对应", () => {
      assert(new Set(DRAWER_GROUPS).size === DRAWER_GROUPS.length, "抽屉分组必须唯一");
      assert(
        Object.keys(DRAWER_CONTROLS).length === DRAWER_GROUPS.length,
        `DRAWER_CONTROLS 的键须与 DRAWER_GROUPS 一一对应,实际 ${Object.keys(DRAWER_CONTROLS).join(",")}`,
      );
      assert(new Set(DRAWER_CONTROL_KEYS).size === DRAWER_CONTROL_KEYS.length, "抽屉控件键必须全表唯一");
    });
    await s.case("每个分组的控件定位二选一、选择器带抽屉作用域、组映射一致", () => {
      for (const group of DRAWER_GROUPS) {
        const list = drawerGroupControls(group);
        assert(list.length > 0, `抽屉分组 ${group} 未登记任何控件`);
        for (const control of list) {
          const key = drawerControlKey(control);
          // 定位形态二选一:同时给或都不给都会让选择器语义漂移(前者命中 id 而忽略 name)
          assert(
            (control.id === undefined) !== (control.name === undefined),
            `抽屉控件 ${key} 的定位须给 id 或 name 之一(实际 id=${String(control.id)} name=${String(control.name)})`,
          );
          const selector = drawerControlSelector(control);
          assert(
            selector.startsWith(`${DRAWER_SELECTORS.shell} `),
            `抽屉控件 ${key} 的选择器必须以 ${DRAWER_SELECTORS.shell} 为作用域(实际 ${selector});` +
              `paper/orientation 在快速参数条有镜像副本,不加作用域会量错侧`,
          );
          assert(DRAWER_GROUP_BY_KEY.get(key) === group, `抽屉控件 ${key} 的组映射与声明组不一致`);
        }
      }
    });
    await s.case("抽屉水平裁切守护容器都在 DRAWER_SELECTORS 登记", () => {
      for (const key of DRAWER_CLIP_KEYS) {
        assert(Object.hasOwn(DRAWER_SELECTORS, key), `抽屉水平裁切守护容器未在 DRAWER_SELECTORS 登记:${key}`);
      }
    });
    await s.case("条件从属项的控件/主控已登记且形态与契约出处齐备", () => {
      for (const cond of DRAWER_CONDITIONS) {
        assert(registered.has(cond.control), `条件从属项的控件未登记:${cond.control}`);
        assert(registered.has(cond.master), `条件从属项 ${cond.control} 的主控未登记:${cond.master}`);
        assert(["switch", "radio"].includes(cond.masterKind), `条件从属项 ${cond.control} 的主控形态非法`);
        assert(cond.why.length > 10, `条件从属项 ${cond.control} 须写明契约出处(why)`);
      }
      assert(
        new Set(DRAWER_CONDITIONS.map((c) => c.control)).size === DRAWER_CONDITIONS.length,
        "同一控件不得登记为两条条件从属项",
      );
    });
    await s.case("灰禁从属项已登记且不与收起形态重复", () => {
      for (const tier of DRAWER_DISABLED_TIERS) {
        assert(registered.has(tier.control), `灰禁从属项的控件未登记:${tier.control}`);
        assert(registered.has(tier.master), `灰禁从属项 ${tier.control} 的主控未登记:${tier.master}`);
        assert(
          !DRAWER_CONDITIONS.some((c) => c.control === tier.control),
          `控件 ${tier.control} 不得同时登记为「收起」与「灰禁」两种门控形态`,
        );
        assert(tier.why.length > 10, `灰禁从属项 ${tier.control} 须写明契约出处(why)`);
      }
    });
    await s.case("主控默认值表覆盖门控表引用的每个主控", () => {
      // 少一个就会让合成样本的门控预期落空
      for (const gate of [...DRAWER_CONDITIONS, ...DRAWER_DISABLED_TIERS]) {
        assert(masterKeys.has(gate.master), `DRAWER_MASTER_DEFAULTS 缺少主控 ${gate.master}(被 ${gate.control} 引用)`);
      }
    });
    await s.case("每个抽屉分组都有承载场景", () => {
      for (const group of DRAWER_GROUPS) {
        assert(
          SCENARIOS.some((sc) => sc.drawerTab === group),
          `抽屉分组 ${group} 没有承载场景,其控件可见性无人判定`,
        );
      }
    });
    await s.case("抽屉场景的驱动步骤与声明的主控档位一致且每个主控只切一次", () => {
      // 抽屉场景的驱动步骤:开抽屉 → 切 tab → 逐个切主控档位;选择器全部由声明档位推出
      // masterSwitches 跨场景累积(「同一主控只许切一次」本身就是跨场景判据),故整段一条 case
      const masterSwitches = new Map();
      for (const sc of drawerScenarios) {
        const tab = /** @type {string} */ (sc.drawerTab);
        const masterEntries = Object.entries(sc.drawerMasters ?? {});
        assert(sc.steps[0]?.selector === DRAWER_SELECTORS.open, `抽屉场景「${sc.id}」首步须是打开抽屉`);
        assert(sc.steps[1]?.selector === `#settingsTab-${tab}`, `抽屉场景「${sc.id}」第二步须切到分组 tab ${tab}`);
        assert(
          sc.steps.length === 2 + masterEntries.length,
          `抽屉场景「${sc.id}」的步骤数须与声明的主控档位数一致(声明 ${masterEntries.map(([k]) => k).join(",") || "无"})`,
        );
        masterEntries.forEach(([master, value], i) => {
          const base = drawerControlSelector(drawerControl(master));
          const want = typeof value === "boolean" ? base : `${base}[value="${String(value)}"]`;
          assert(
            sc.steps[i + 2]?.selector === want,
            `抽屉场景「${sc.id}」第 ${i + 3} 步须是主控 ${master} 的档位切换(期望 ${want},实际 ${String(sc.steps[i + 2]?.selector)})`,
          );
          // 驱动步是「点一次」,同一主控被点第二次就回到原档位:只许在一条场景里切一次
          const previous = masterSwitches.get(master);
          assert(previous === undefined, `主控 ${master} 在场景「${String(previous)}」已切过一次,不得在「${sc.id}」再切`);
          masterSwitches.set(master, sc.id);
        });
      }
    });
    await s.case("每个门控主控都有切到开启档的场景", () => {
      // 只测关闭侧会放过「只判了一边」这类漏项
      for (const gate of [...DRAWER_CONDITIONS, ...DRAWER_DISABLED_TIERS]) {
        assert(
          drawerScenarios.some((sc) => (sc.drawerMasters ?? {})[gate.master] !== undefined),
          `主控 ${gate.master} 没有「切到开启档」的场景,门控(${gate.control})只测了关闭侧`,
        );
      }
    });
    await s.case("每个抽屉控件至少在一条场景里可见", () => {
      for (const key of DRAWER_CONTROL_KEYS) {
        assert(everVisible.has(key), `抽屉控件 ${key} 在任何抽屉场景里都不可见,其组内顺序无人判定`);
      }
    });
    await s.case("index.html 的抽屉面板分组与 tab 顺序都等于 DRAWER_GROUPS", () => {
      assert(
        panelGroups.join(",") === DRAWER_GROUPS.join(","),
        `index.html 的抽屉面板分组与 DRAWER_GROUPS 不一致(实际 ${panelGroups.join(",")})`,
      );
      assert(
        tabOrder.join(",") === DRAWER_GROUPS.join(","),
        `index.html 的抽屉 tab 顺序与 DRAWER_GROUPS 不一致(实际 ${tabOrder.join(",")})`,
      );
    });
    await s.case("index.html 里每个控件的锚点都在其声明分组的面板内", () => {
      for (const group of DRAWER_GROUPS) {
        const slice = panelSlices.get(group);
        assert(slice !== undefined, `index.html 找不到 data-group="${group}" 面板正文`);
        for (const control of drawerGroupControls(group)) {
          const anchor = control.name !== undefined ? `name="${control.name}"` : `id="${control.id}"`;
          assert(
            slice.includes(anchor),
            `抽屉控件 ${drawerControlKey(control)} 的锚点 ${anchor} 不在 data-group="${group}" 面板内;控件归组与规格声明对不上`,
          );
        }
      }
    });
  });

  // ---------- CSS 令牌恒等判定层(正 + 负探针) ----------
  // 这批判据此前是读 dialogs.css 的正则(源文本形态 + 恒真),已迁到 check:geometry。
  // 真实窗口那一侧由 check:geometry 验,本段锁的是**判定语义**:同样的读数,判定层必须
  // 「绿则全绿、红则按规则名命中」—— 少了这层,判定逻辑的回归只能靠起窗口才发现。
  /** @param {string} name @returns {import("../../shared/geometry/geometry-core.mjs").CssTokenReading} */
  const cssTokenGood = (name) => ({
    name,
    property: "border-top-color",
    mountFound: true,
    targetFound: true,
    colors: {
      base: "rgb(200, 200, 200)",
      ok: "rgba(47, 125, 79, 0.12)",
      fail: "rgba(181, 48, 28, 0.3)",
      canceled: "rgb(226, 226, 220)",
    },
    expected: "rgb(226, 226, 220)",
    forbidden: [
      { token: "--ok-soft", color: "rgba(47, 125, 79, 0.12)" },
      { token: "--acc-ring", color: "rgba(181, 48, 28, 0.3)" },
    ],
  });
  /** 依规格表逐项造读数:表加项而样本漏项,正向样本自己就先判红(不靠人记得同步) */
  const cssTokenAllGood = () =>
    CSS_TOKEN_RULES.map((rule) => cssTokenGood(String(rule.name)));
  // 正向判定结果(纯取数:整表读数跑一次判定)留在 case 外
  const goodToken = judgeCssTokens(cssTokenAllGood());
  // 规格表非空是下面每条 tokenProbe 的共同前提(探针按规则名定位读数),留在 case 外:
  // 表为空时该让整段在此中止,而不是让每条探针各报一次「规则不在规格表里」
  const firstRule = cssTokenAllGood()[0];
  assert(firstRule !== undefined, "CSS_TOKEN_RULES 为空:令牌恒等判据整体缺失(不得因无判据而判绿)");
  const firstRuleName = String(firstRule.name);

  /**
   * 负探针:注入一种故障,断言判红**且命中那一条具体判据**。
   *
   * 为什么断言消息而不只是规则名(踩过的坑):同一规则名下有多条独立判据(A 三态互斥的
   * 三条 / B 中性区间 / C 逐根点名),关掉其中一条后别的照样会产 finding —— 只查规则名
   * 时,「关掉一条判据」被邻条掩盖,负探针恒绿,等于白写。逐条点名消息才关得住。
   *
   * 每次都注入**全表**读数(只坏一项),免得漏项 guard 抢先报错、掩盖真正的故障原因。
   * @param {string} why 故障名
   * @param {(r: ReturnType<typeof cssTokenGood>) => void} inject 故障注入
   * @param {string} expectRule 期望命中的规则名
   * @param {string} expectMessage 期望命中的**那一条判据**的消息片段
   * @returns {void}
   */
  const tokenProbe = (why, inject, expectRule, expectMessage) => {
    const readings = cssTokenAllGood();
    const target = readings.find((r) => r.name === expectRule);
    assert(target !== undefined, `负探针「${why}」指定的规则 ${expectRule} 不在规格表里`);
    inject(target);
    const got = judgeCssTokens(readings);
    assert(!got.ok, `令牌恒等负探针「${why}」应判红,却判绿(恒真)`);
    assert(
      got.findings.some((f) => f.rule.includes(expectRule) && f.message.includes(expectMessage)),
      `令牌恒等负探针「${why}」未命中预期判据「${expectMessage}」,实际 ` +
        `${JSON.stringify(got.findings.map((f) => f.message))}`,
    );
  };
  // 每条负探针自带「造全表读数 → 坏一项 → 判定」全链,case 名用故障名
  await suite.describe("CSS 令牌恒等判定层", async (s) => {
    await s.case("正向 · 三态互不相等且取消态落在中性区间时零 finding", () => {
      assert(
        goodToken.ok && goodToken.findings.length === 0,
        `令牌恒等正向样本应零 finding,实际 ${JSON.stringify(goodToken.findings)}`,
      );
    });
    await s.case("负探针 · 取消态被读成成功态同色", () => {
      tokenProbe(
        "取消态被读成成功态同色",
        (r) => { r.colors.canceled = r.colors.ok; },
        firstRuleName,
        "取消态被读成成功态同色",
      );
    });
    await s.case("负探针 · 取消态被读成失败态同色", () => {
      tokenProbe(
        "取消态被读成失败态同色",
        (r) => { r.colors.canceled = r.colors.fail; },
        firstRuleName,
        "取消态被读成失败态同色",
      );
    });
    await s.case("负探针 · 成功态与失败态同色", () => {
      tokenProbe(
        "成功态与失败态同色",
        (r) => { r.colors.fail = r.colors.ok; },
        firstRuleName,
        "成功态与失败态算出同一个颜色",
      );
    });
    await s.case("负探针 · 取消态掉出中性区间", () => {
      tokenProbe(
        "取消态掉出中性区间",
        (r) => { r.colors.canceled = "rgb(1, 2, 3)"; },
        firstRuleName,
        "取消态未落在中性区间",
      );
    });
    await s.case("负探针 · 取消态等于语义对立令牌色", () => {
      tokenProbe(
        "取消态等于语义对立令牌色",
        (r) => { r.colors.canceled = "rgba(47, 125, 79, 0.12)"; },
        firstRuleName,
        "被读成 --ok-soft",
      );
    });
    // 探针漏项/漂移:少一条读数也必须判红,不许「少跑判据也判绿」(这正是迁移的病根)
    await s.case("读数漏项时判红(不得因少跑判据而判绿)", () => {
      assert(
        !judgeCssTokens(cssTokenAllGood().slice(1)).ok,
        "令牌恒等判定在读数漏项时必须判红(漏项不得静默通过)",
      );
    });
    await s.case("读数项不在规格表里时判红", () => {
      /** @type {import("../../shared/geometry/geometry-core.mjs").CssTokenReading[]} */
      const driftedReadings = cssTokenAllGood().map((r, i) =>
        i === 0 ? { ...r, name: "not-in-spec" } : r,
      );
      const drifted = judgeCssTokens(driftedReadings);
      assert(
        !drifted.ok && drifted.findings.some((f) => f.rule.includes("not-in-spec")),
        "读数项不在 CSS_TOKEN_RULES 表里时必须判红(规格与探针漂移)",
      );
    });
    await s.case("被读色节点缺失时判红", () => {
      // 目标节点取不到:空串读数不得继续参与判色
      /** @type {import("../../shared/geometry/geometry-core.mjs").CssTokenReading[]} */
      const noTargetReadings = cssTokenAllGood().map((r) => ({ ...r, targetFound: false }));
      assert(
        !judgeCssTokens(noTargetReadings).ok,
        "被读色节点缺失时必须判红(空串读数不可信)",
      );
    });
    await s.case("空串读数判红且报读到空读数", () => {
      // 空串读数(探针拿到空值)本身也必须判红,不得因「三态全等」而被当成一致通过
      /** @type {import("../../shared/geometry/geometry-core.mjs").CssTokenReading[]} */
      const blankReadings = cssTokenAllGood().map((r, i) =>
        i === 0
          ? { ...r, colors: { base: "", ok: "", fail: "", canceled: "" }, expected: "" }
          : r,
      );
      const blankResult = judgeCssTokens(blankReadings);
      assert(!blankResult.ok, "读数为空串时必须判红(探针失效不得伪装成三态一致)");
      assert(
        blankResult.findings.some((f) => f.message.includes("读到空读数")),
        `空串读数应报「读到空读数」(探针失效),实际 ${JSON.stringify(blankResult.findings.map((f) => f.message))}`,
      );
    });
  });

  // ---------- 12. 路径常量存活性(正锚点 + 负向夹具) ----------
  // 判据在门禁入口(见 gates/geometry/check-geometry.mjs 的 runLivenessGate),本段锁它的语义。
  // 为什么要它:全仓根锚定路径拼接里只有约四分之一是纯字面量,任何「谁可以引谁」的静态
  // import 规则只能看见那四分之一,换个写法就绕过(ADR-043 点名的失效形态);存活性锚在
  // 常量声明上,抓的是真实失效 —— 路径悬空时消费它的那一行必坏。
  // (1) 反向锚点:真实仓库里清单上的常量必须全部在位(清单为空 = 断言恒绿,必须先钉住)
  // firstEntry 是下面负向夹具的取数来源(负向夹具要指名一个真实常量),留在 case 外
  const firstEntry = LIVENESS_PATHS[0];
  assert(firstEntry !== undefined, "存活性清单为空:断言会恒绿,等于没有门禁");
  // 负向夹具:造一个悬空常量,必须判红**且指名是哪个常量**
  // 用注入的探针伪造悬空,不动真实磁盘(夹具不得污染工作树)
  const danglingName = firstEntry.name;
  const danglingTarget = firstEntry.target;
  const injected = checkPathLiveness((p) => p !== danglingTarget);
  const named = injected.dangling[0];
  // (3) 多项同时悬空要逐项点名,不得只报第一项(漏报的那项仍会在后面炸出无关面孔)
  const twoDangling = checkPathLiveness((p) => !LIVENESS_PATHS.slice(0, 2).some((item) => item.target === p));
  await suite.describe("路径常量存活性", async (s) => {
    await s.case("真实仓库的存活性清单全部在位", () => {
      const realLiveness = checkPathLiveness();
      assert(
        realLiveness.ok,
        `真实仓库的存活性清单应全部在位,实际悬空:${JSON.stringify(realLiveness.dangling)}`,
      );
    });
    await s.case("清单每项都锚定在项目根之下", () => {
      // 清单里的每项都必须真的指向 root 之下的路径(防止有人把产出目录塞进清单,
      // 那样门禁会在正常流程下判红 —— 断言覆盖面必须只含「必然已存在」的常量)
      for (const item of LIVENESS_PATHS) {
        assert(
          path.isAbsolute(item.target) && item.target.startsWith(ROOT),
          `存活性清单项 ${item.name} 未锚定在项目根之下:${item.target}`,
        );
      }
    });
    await s.case("负向夹具:造出悬空常量即判红", () => {
      assert(!injected.ok, `造出悬空常量 ${danglingName} 后仍判绿(存活性门禁漏检)`);
    });
    await s.case("负向夹具:悬空清单指名常量", () => {
      assert(
        injected.dangling.length === 1 && named !== undefined && named.name === danglingName,
        `悬空清单须指名常量 ${danglingName},实际 ${JSON.stringify(injected.dangling)}`,
      );
    });
    await s.case("负向夹具:悬空项带出该常量的绝对路径", () => {
      assert(
        named?.target === danglingTarget,
        "悬空项须带出该常量的绝对路径(否则定位不到是哪个路径没了)",
      );
    });
    await s.case("两项同时悬空时逐项点名", () => {
      assert(
        !twoDangling.ok && twoDangling.dangling.length === 2,
        `两项同时悬空时应逐项点名,实际 ${JSON.stringify(twoDangling.dangling)}`,
      );
    });
    // (4) 惰性化回归:import 本模块不得触发读盘(REQ-127)。
    // 判据是「导出的 mediaConditions 是函数」——顶层自执行若回来,它会变回顶层常量。
    await s.case("mediaConditions 是惰性函数(REQ-127)", () => {
      assert(
        typeof mediaConditions === "function",
        `mediaConditions 应为惰性函数(REQ-127),实际 ${typeof mediaConditions}`,
      );
    });
    await s.case("mediaConditions 惰性求值且已记忆化", () => {
      // 两次调用返回同一份(整轮只读一次盘),且内容与本段自读的一致
      const firstRead = mediaConditions();
      const secondRead = mediaConditions();
      assert(
        firstRead === secondRead,
        "mediaConditions 未记忆化:落定判据每轮读几十次盘",
      );
      assert(
        firstRead.join("|") === MEDIA_CONDITIONS.join("|"),
        "driver 的 mediaConditions 与本段自读结果不一致(两处读法已漂移)",
      );
    });
  });

  console.log(
    `[ok] geometry-gate:判定层正负探针通过(场景 ${SCENARIOS.length} / 恒定组 ${CONSTANT_GROUPS.length} / ` +
      `高度档 ${MEDIA_CONDITIONS.length} 条;抽屉 ${DRAWER_CONTROL_KEYS.length} 控件 / ` +
      `${SCENARIOS.filter((sc) => sc.drawerTab !== undefined).length} 场景,负向故障均按规则命中;` +
      `CSS 令牌恒等 ${CSS_TOKEN_RULES.length} 项正负探针通过;` +
      `路径常量存活性 ${LIVENESS_PATHS.length} 项在位,负向夹具判红并点名)`,
  );
  return { cases: suite.results };
}
