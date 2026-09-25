/**
 * geometry gate 规格单源(零 DOM / 零 Electron / 零 IO):测量节点表、场景表(视口/驱动步骤/
 * 必需节点/截图名)、恒定断言组、固定槽下限、容差与滚动预算默认值,以及高度维度媒体查询的
 * 抽取与求值。判定规则在 geometry-core,页面侧探针在 geometry-page。
 *
 * 契约/常量单源:驱动(采样)与判定(裁决)共用本表,新增测量点或场景只改这里。
 */
/** 场景视口(与 visual-check 同口径:基准 960×680 / 紧凑 880×620 / 半屏 640×560) */
export const VIEWPORT_BASE = [960, 680];
export const VIEWPORT_COMPACT = [880, 620];
export const VIEWPORT_HALFSCREEN = [640, 560];

/**
 * 测量节点单源表:key → CSS 选择器。
 * 契约相关节点(舞台/参数条/动作栏/消息槽/历史槽)与场景态专属节点
 * (空态投放核、文件队列三件套)都在此登记,新增测量点只改这一张表。
 */
export const NODE_SELECTORS = {
  dropZone: "#dropZone", // 舞台容器(同时是垂直滚动容器与 data-stage 载体)
  stage: ".stage", // 几何恒定契约主体(纸面)
  stagePanes: ".stage-panes", // 三态 pane 区
  quickBar: ".quick-bar", // 舞台内常驻参数条(纸面脚注区)
  actionbar: ".actionbar", // 底部动作栏(贴视口下缘)
  feed: "#messageSlot", // 消息区常驻槽(状态行/跳过列表/结果汇总)
  history: "#historyBar", // 历史条(标题条常驻占位)
  historyHead: ".h-head", // 历史标题条:40px(矮窗 36px)常驻占位
  recentList: "#recentList", // 历史列表(内部滚动,overflow-x:hidden)
  status: "#status", // 状态行(消息槽首行)
  progress: "#progressArea", // 转换进度行(动作栏内,常隐)
  dropCore: ".drop-core", // 空态投放核(居中,不参与列轴断言)
  ph: ".ph", // 文件队列标题行
  listcard: ".listcard", // 文件队列卡
  fhint: ".fhint", // 队列底部输出语义说明
  multiList: "#multiList", // 队列列表
};

/** 舞台状态载体节点 key(用于校验场景是否真的生效) */
export const STAGE_KEY = "dropZone";
/** 纵向滚动容器 key(紧凑档"免滚动"断言对象) */
export const SCROLL_KEY = "dropZone";
/** 纸面 key(列轴越界守护的参照盒) */
export const PAPER_KEY = "stage";
/**
 * 水平裁切守护节点:这些容器 CSS 为 overflow-x:hidden,scrollWidth 超过 clientWidth
 * 意味着内容被裁切而不可见(比全局横向滚动更隐蔽),必须显式守护。
 */
export const X_CLIP_KEYS = ["dropZone", "feed", "recentList"];

/**
 * 列轴断言组(文件态通用):纸面上有两条不同的列,故分开断言而不是"全部同左同宽"。
 * - 队列列:标题行/队列卡/输出说明同左同宽(drop.css .pane-files 的 14px 内缩列,组内互齐);
 *   比对 border box —— .listcard 自带 1px 边线,比 padding box 会凭空内缩 1px。
 * - 纸面脚注列:参数条铺满纸面内容盒(drop.css .quick-bar),以 .stage 内容盒为参照;
 *   比对 padding box —— .stage 自带 1px 边线,比 border box 会整体偏移 1px。
 * 无 ref 的组以首个成员为参照;所有成员另受"不得越出纸面内容盒"守护(border box vs 纸面 padding box)。
 */
const FILE_COLUMNS = [
  { name: "queue-column", box: "border", members: ["ph", "listcard", "fhint"] },
  { name: "paper-footnote-column", box: "padding", members: ["quickBar"], ref: PAPER_KEY },
];

/** 全部场景的公共必需可见节点(任何视口下都必须在场且可见) */
const COMMON_VISIBLE = ["dropZone", "stage", "stagePanes", "quickBar", "actionbar", "feed", "historyHead"];
/** 全部场景的公共必需在场节点(允许隐藏,如进度行/状态行) */
const COMMON_PRESENT = [
  "history",
  "status",
  "progress",
  "recentList",
  "ph",
  "listcard",
  "fhint",
  "multiList",
  "dropCore",
];

/**
 * 场景表(顺序即驱动顺序,单窗口逐步推进,复刻 visual-check 的场景序列):
 * steps 为声明式驱动指令,由 scripts/check-geometry.mjs 解释执行;
 * 视口变化由驱动自动 setContentSize(不必写 resize 步骤),实际视口与规格不符即判失败。
 */
export const SCENARIOS = [
  {
    id: "empty-960",
    viewport: VIEWPORT_BASE,
    expectStage: "empty",
    shot: "1-empty",
    steps: [],
    visible: [...COMMON_VISIBLE, "dropCore"],
    present: COMMON_PRESENT,
    columnAxis: [], // 空态投放核居中,不参与列轴断言
  },
  {
    id: "single-960",
    viewport: VIEWPORT_BASE,
    expectStage: "single",
    shot: "2-single",
    steps: [
      { op: "setFiles", fixtures: ["basic-render.md"] },
      { op: "click", selector: "#selectBtn" },
    ],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "multi-960",
    viewport: VIEWPORT_BASE,
    expectStage: "multi",
    shot: "3-multi",
    steps: [
      { op: "setFiles", fixtures: ["toc-caption.md", "page-setup.md"] },
      { op: "click", selector: "#appendFileBtn" },
    ],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "converting-960",
    viewport: VIEWPORT_BASE,
    expectStage: "multi",
    shot: "3b-converting",
    steps: [{ op: "progress", show: true }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList", "progress", "status"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "after-convert-960",
    viewport: VIEWPORT_BASE,
    expectStage: "multi",
    steps: [{ op: "progress", show: false }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "history-open-960",
    viewport: VIEWPORT_BASE,
    expectStage: "multi",
    shot: "4-history-open",
    steps: [{ op: "click", selector: "#histToggle" }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "history-closed-960",
    viewport: VIEWPORT_BASE,
    expectStage: "multi",
    steps: [{ op: "click", selector: "#histToggle" }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "compact-multi-880",
    viewport: VIEWPORT_COMPACT,
    compact: true,
    expectStage: "multi",
    shot: "5-compact-multi",
    steps: [],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "compact-converting-880",
    viewport: VIEWPORT_COMPACT,
    compact: true,
    expectStage: "multi",
    steps: [{ op: "progress", show: true }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList", "progress", "status"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "compact-history-open-880",
    viewport: VIEWPORT_COMPACT,
    compact: true,
    expectStage: "multi",
    steps: [{ op: "progress", show: false }, { op: "click", selector: "#histToggle" }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "halfscreen-multi-640",
    viewport: VIEWPORT_HALFSCREEN,
    compact: true,
    expectStage: "multi",
    shot: "6-halfscreen-multi",
    steps: [{ op: "click", selector: "#histToggle" }],
    visible: [...COMMON_VISIBLE, "ph", "listcard", "fhint", "multiList"],
    present: COMMON_PRESENT,
    columnAxis: FILE_COLUMNS,
  },
  {
    id: "halfscreen-empty-640",
    viewport: VIEWPORT_HALFSCREEN,
    compact: true,
    expectStage: "empty",
    shot: "7-halfscreen-empty",
    steps: [{ op: "click", selector: "#clearListBtn" }],
    visible: [...COMMON_VISIBLE, "dropCore"],
    present: COMMON_PRESENT,
    columnAxis: [],
  },
];

const STATES_960 = [
  "empty-960",
  "single-960",
  "multi-960",
  "converting-960",
  "after-convert-960",
  "history-open-960",
  "history-closed-960",
];
const STATES_COMPACT = ["compact-multi-880", "compact-converting-880", "compact-history-open-880"];

/**
 * 恒定断言组:同视口内,某节点在多个状态间几何必须恒等(逐轴差值 > 容差即"跳动")。
 * members 显式列出,故「哪个状态参与了哪个不变量」在规格里可读、可审;
 * axes 缺省比对 left/top/width/height,只关心占位高度的槽节点用 axes:["height"] 收窄。
 */
export const CONSTANT_GROUPS = [
  {
    id: "stage-960",
    node: "stage",
    baseline: "empty-960",
    members: STATES_960,
    why: "几何恒定契约:index.html 舞台区注释「三种舞台状态同高,历史开合 / 消息增减 / 进度条出现均不改写本区块一个像素」",
  },
  {
    id: "actionbar-960",
    node: "actionbar",
    baseline: "empty-960",
    members: STATES_960,
    why: "动作栏贴视口下缘,进度行显隐不得改写其几何(进度行出现时按钮组禁止换行下移)",
  },
  {
    id: "history-slot-960",
    node: "historyHead",
    axes: ["height"],
    baseline: "empty-960",
    members: STATES_960,
    why: "固定槽:历史标题条为 40px 常驻占位(矮窗档 36px),浮层开合与文件态切换不得改变占位高度(其纵向位置由上方消息区内容自适应决定,不在本不变量内)",
  },
  {
    id: "stage-880",
    node: "stage",
    baseline: "compact-multi-880",
    members: STATES_COMPACT,
    why: "紧凑档几何恒定:880×620 下进度行显隐与历史浮层开合不得改写舞台几何",
  },
  {
    id: "actionbar-880",
    node: "actionbar",
    baseline: "compact-multi-880",
    members: STATES_COMPACT,
    why: "紧凑档动作栏恒定:矮窗档 min-height 52px,进度行不得顶动按钮组",
  },
  {
    id: "history-slot-880",
    node: "historyHead",
    axes: ["height"],
    baseline: "compact-multi-880",
    members: STATES_COMPACT,
    why: "紧凑档固定槽:历史标题条占位高度在浮层开合与进度行显隐前后恒定",
  },
  {
    id: "stage-640",
    node: "stage",
    baseline: "halfscreen-multi-640",
    members: ["halfscreen-multi-640", "halfscreen-empty-640"],
    why: "半屏档两态外框相同(舞台高度=min(可用高,设计高),设计高取矮窗档令牌),文件态与空态舞台几何须恒等",
  },
];

/**
 * 固定槽不塌陷下限(px):消息区与历史标题条是常驻占位,高度趋零即布局塌陷。
 * 只断言"不塌陷",不断言具体档位值(档位值由 CONSTANT_GROUPS 的恒等性覆盖)。
 */
export const SLOT_INVARIANTS = [
  { node: "historyHead", minHeight: 30, why: "历史标题条常驻占位(常规档 40px / 矮窗档 36px)" },
  { node: "feed", minHeight: 30, why: "消息区常驻槽(状态行 / 跳过列表 / 结果汇总)" },
];

/** 默认容差(px):亚像素舍入 + 1px 边框级抖动不算跳动 */
export const DEFAULT_TOL_PX = 1;
/**
 * 默认紧凑档纵向滚动预算(px):舞台区在紧凑/半屏档须免滚动
 * (drop.css .stage 高度 min(100%, 设计高) 的设计目的:任何窗口尺寸下参数脚注区都在视野内、页面零滚动)。
 * 1px 预算吸收分数像素布局(高度 min(100%,…) 与 100% 之间取整)带来的舍入。
 */
export const DEFAULT_SCROLL_BUDGET_PX = 1;

/** 高度维度媒体查询的书写形式(求值器只认这四种,其余显式报错而非忽略) */
const MEDIA_CONDITION_RE = /^\(\s*(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/;

/**
 * 抽出样式表里的高度维度媒体查询条件(去重、保持出现序)。
 * 高度维度的响应式档是几何前提(矮窗档令牌决定 --tbh/--panes-h/--quickbar-h),
 * 而隐藏窗口在 Windows 上 setContentSize 后媒体查询重算会滞后一帧以上 ——
 * 条件本身从 CSS 单源取出,既做「档位是否生效」断言,又做 resize 落定判据。
 */
export function extractHeightMediaConditions(cssText) {
  const found = [];
  for (const m of cssText.matchAll(/@media\s*(\([^)]*\bheight\b[^)]*\))/g)) {
    const cond = m[1].replace(/\s+/g, " ").trim();
    if (!found.includes(cond)) found.push(cond);
  }
  return found;
}

/**
 * 求值高度/宽度维度媒体查询在给定视口下是否成立。
 * 只支持 (min|max)-(width|height): Npx;出现其他写法(复合条件、em/rem、其他特征)
 * 直接抛错 —— 宁可门禁红并要求扩展求值器,也不静默跳过未覆盖的档位。
 */
export function evaluateMediaCondition(condition, viewport) {
  const m = MEDIA_CONDITION_RE.exec(condition);
  if (m === null) {
    throw new Error(
      `媒体查询条件「${condition}」超出求值器覆盖范围(只支持 (min|max)-(width|height): Npx);` +
        `扩展 geometry-spec.evaluateMediaCondition 后再启用,禁止静默忽略`,
    );
  }
  const bound = Number(m[3]);
  const actual = m[2] === "width" ? viewport.width : viewport.height;
  return m[1] === "max" ? actual <= bound : actual >= bound;
}
