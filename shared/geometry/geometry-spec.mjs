// @ts-check
/**
 * geometry gate 规格单源(零 DOM / 零 Electron / 零 IO):测量节点表、场景表(视口/驱动步骤/
 * 必需节点/截图名)、设置抽屉的分组与控件清单及门控表、恒定断言组、固定槽下限、容差与
 * 滚动预算默认值、CSS 令牌恒等表,以及高度维度媒体查询的抽取与求值。
 * 判定规则在 geometry-core,页面侧探针在 geometry-page。
 *
 * 契约/常量单源:驱动(采样)与判定(裁决)共用本表,新增测量点、场景或抽屉控件只改这里。
 */

/* ---------- 规格表项的类型契约(判定层与驱动脚本共同消费) ---------- */

/**
 * @typedef {[number, number]} Viewport 场景视口(定长二元组,消费方按下标取宽高)
 */

/**
 * @typedef {object} ColumnAxis 列轴断言组
 * @property {string} name 组名(报告用)
 * @property {"border" | "padding"} box 比对用的盒语义
 * @property {string[]} members 组内成员节点 key
 * @property {string} [ref] 参照节点 key(缺省时以首个可用成员为参照)
 */

/**
 * @typedef {object} Scenario 场景表项
 * @property {string} id 场景 id(采样结果以 id 对齐)
 * @property {Viewport} viewport 场景视口
 * @property {string} [expectStage] 期望的舞台状态(data-stage)
 * @property {boolean} [compact] 是否为紧凑/半屏档(纵向滚动免滚动断言对象)
 * @property {string} [shot] 截图名后缀
 * @property {{ op: string, [k: string]: unknown }[]} steps 声明式驱动指令
 * @property {string[]} [visible] 必需在场且可见的节点 key
 * @property {string[]} [present] 必需在场的节点 key(允许隐藏)
 * @property {ColumnAxis[]} columnAxis 列轴断言组
 * @property {string} [drawerTab] 期望激活的抽屉分组(缺省 = 该场景不参与抽屉判定)
 * @property {Record<string, boolean | string>} [drawerMasters] 本场景驱动后的抽屉主控档位。
 *   既用于生成驱动步骤、也作为合成「应当全绿」样本的基线;**判定层不读它** —— 门禁的可见性
 *   预期一律由样本实测到的主控态反推,故这里写错档位时门禁会在真实窗口跑出与声明相反的
 *   可见性而判红,不会因为声明自洽而假绿。
 */

/**
 * @typedef {object} ConstantGroup 恒定断言组(组内节点在成员场景间几何须恒等)
 * @property {string} id 组 id
 * @property {string} node 受约束节点 key
 * @property {string} baseline 基准场景 id
 * @property {string[]} members 参与断言的场景 id
 * @property {("left" | "top" | "width" | "height")[]} [axes] 比对轴(缺省四轴全比)
 * @property {string} why 契约说明(失败消息引用)
 */

/**
 * @typedef {object} SlotInvariant 固定槽高度区间
 * @property {string} node 槽节点 key
 * @property {number} minHeight 高度下限(防塌陷)
 * @property {number} [maxHeight] 高度上限(防被内容撑高/退化为自适应)
 * @property {string} why 契约说明
 */

/** 场景视口(与 visual-check 同口径:基准 960×680 / 紧凑 880×620 / 半屏 640×560) */
/** @type {Viewport} */
export const VIEWPORT_BASE = [960, 680];
/** @type {Viewport} */
export const VIEWPORT_COMPACT = [880, 620];
/** @type {Viewport} */
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
 * @type {ColumnAxis[]}
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

/* ══════════════ 设置抽屉:分组 · 控件清单 · 门控 · 场景 ══════════════
   抽屉是全部设置控件的家,而既有几何门禁只测主窗舞台 —— 步 03 要做表驱动重构、
   其退出条件写着「控件位置与可见性不得变化」,却没有任何探测器看着抽屉。故本节
   把抽屉接进同一条链内门禁。判据是**结构不变式**(存在/组归属/组内顺序/无裁切/门控显隐),
   不是像素快照:快照会因平台、主题、字体与缩放档假红,而结构不变式在任何机器上都成立。 */

/**
 * @typedef {object} DrawerControl 抽屉值控件项(定位二选一:id 控件用 id,radio 分段用组名)
 * @property {string} [key] 控件键;缺省取 id ?? name。键名取**设置键**(path-chip 等
 *   「元素 id 与设置键不同名」的控件用 key 显式对齐),便于与 settings-ia.md、
 *   settings-bindings-* 逐条对照。
 * @property {string} [id] 元素 id 定位
 * @property {string} [name] radio 组名定位(分段控件无 id)
 */

/**
 * @typedef {object} DrawerCondition 条件从属项(主控不满足即**整块收起**)
 * @property {string} control 从属控件键
 * @property {string} master 主控控件键
 * @property {"switch" | "radio"} masterKind 主控形态
 * @property {boolean | string} [on] 主控处于何态时从属项可见(switch 取 true,radio 取档位值)
 * @property {string} why 契约说明(失败消息引用)
 */

/**
 * @typedef {object} DrawerTier 灰禁从属项(主控关时 **disabled 但不移除**)
 * @property {string} control 从属控件键
 * @property {string} master 主控控件键
 * @property {string} why 契约说明
 */

/** 抽屉结构节点选择器(开合入口 / 遮罩 / 两个 overflow-x:hidden 滚动区 / 当前激活面板) */
export const DRAWER_SELECTORS = {
  open: "#settingsOpenBtn", // 顶栏齿轮:抽屉唯一打开入口
  shell: "#settingsDrawer", // 遮罩容器(带 .hidden 工具类,关闭态即整块不可见)
  panels: "#settingsDrawer .settings-panels", // 右侧面板区(overflow-y:auto + overflow-x:hidden)
  tabs: "#settingsDrawer .settings-tabs", // 左侧竖向导航(overflow-y:auto + overflow-x:hidden)
  activePanel: "#settingsDrawer .settings-panels > .sec.active", // 当前激活面板(判 tab 是否真的切到位)
};
/**
 * 抽屉内的水平裁切守护容器:scrollWidth 超过 clientWidth 即内容被裁掉而不可见。
 * 抽屉是 position:fixed 浮层,其溢出**不进**文档 scrollWidth,故全局
 * horizontal-overflow 规则看不见它,必须逐容器显式守护。
 */
export const DRAWER_CLIP_KEYS = ["panels", "tabs"];

/**
 * 抽屉六组(= index.html 的 data-group 面板取值;同值的 tab 按钮另有 6 枚,
 * 即每个取值出现 2 次 = 1 枚 tab + 1 个 panel)。组序即 IA 的决策序。
 */
export const DRAWER_GROUPS = ["preset", "typography", "headerwatermark", "numbering", "convert", "app"];

/**
 * 抽屉值控件清单单源:组 → 组内控件的**声明顺序**(= index.html 内的出现顺序,
 * 判定即比它 —— 这条直接对应步 03 的退出条件「控件位置不得变化」)。
 *
 * 选择器一律以 #settingsDrawer 为作用域:`paper` / `orientation` 在顶栏快速参数条
 * (#quickBar)里各有一份镜像副本(document 级同名 radio 分组,点任一侧互斥同步),
 * 不加作用域会量到快速参数条那一侧、把抽屉的排版组判成「不存在」。
 * @type {Record<string, DrawerControl[]>}
 */
export const DRAWER_CONTROLS = {
  preset: [{ id: "templatePreset" }],
  typography: [
    { name: "paper" },
    { name: "orientation" },
    { id: "marginTop" },
    { id: "marginBottom" },
    { id: "marginLeft" },
    { id: "marginRight" },
    { id: "fontEastAsia" },
    { id: "fontAscii" },
    { id: "bodySizePt" },
    { id: "lineSpacing" },
    { name: "headingScale" },
    { name: "headingSpacing" },
    { id: "firstLineIndent" },
    { name: "align" },
  ],
  headerwatermark: [
    { name: "headerMode" },
    { id: "headerText" },
    { key: "headerLogoPath", id: "headerLogoStatus" }, // 值载体是 path-chip,不是选择按钮
    { name: "headerLayout" },
    { id: "footerEnabled" },
    { id: "watermarkText" },
    { id: "watermarkAngle" },
    { id: "watermarkOpacity" },
    { id: "watermarkGray" },
  ],
  numbering: [
    { id: "headingNumbering" },
    { id: "captionNumbering" },
    { id: "equationNumbering" },
    { id: "toc" },
    { id: "tocMode" },
    { id: "breakBeforeH1" },
  ],
  convert: [
    { id: "aiCleanup" },
    { id: "aiCleanupTidy" },
    { id: "aiCleanupRewrite" },
    { id: "obsidianCompat" },
    { id: "obsidianAttachmentFolder" },
    { key: "outputDir", id: "outputDirValue" }, // 值载体是 path-chip
    { name: "afterConvert" },
    { key: "pdfCss", id: "pdfCssText" },
  ],
  app: [{ name: "theme" }, { id: "languageSelect" }],
};

/**
 * 取分组的控件清单(未登记即抛错:分组名写错必须在**构造规格时**炸掉,
 * 而不是留一个空数组、再被判定层的「零命中」规则误报成选择器问题)。
 * @param {string} group 分组
 * @returns {DrawerControl[]} 组内控件(声明顺序)
 */
export function drawerGroupControls(group) {
  const list = DRAWER_CONTROLS[group];
  if (list === undefined) throw new Error(`抽屉分组未登记于 DRAWER_CONTROLS:${group}`);
  return list;
}

/** 控件键扁平序(组序 × 组内声明序):组内顺序判据比的就是这串序的实测文档序 */
export const DRAWER_CONTROL_KEYS = DRAWER_GROUPS.flatMap((group) => drawerGroupControls(group).map(drawerControlKey));

/** 控件键 → 该控件所属组(判定层做组归属比对时取声明值) */
export const DRAWER_GROUP_BY_KEY = new Map(
  DRAWER_GROUPS.flatMap((group) => drawerGroupControls(group).map((control) => [drawerControlKey(control), group])),
);

/**
 * 条件从属项(主控不满足即整块收起,IA §3 规则 1 的两级形态):
 * 凹陷容器 `.cond` 收起用 grid-template-rows:0fr + visibility:hidden,
 * 单控件条件子行走 .hidden 工具类。两者对判定层都是「rect 归零 / 不可见」。
 * @type {DrawerCondition[]}
 */
export const DRAWER_CONDITIONS = [
  {
    control: "tocMode",
    master: "toc",
    masterKind: "switch",
    on: true,
    why: "目录模式是 toc 的条件子行:toc 关时 .hidden 整块移除(不灰禁,摆一个选了也不生效的下拉是骗人)",
  },
  {
    control: "headerText",
    master: "headerMode",
    masterKind: "radio",
    on: "custom",
    why: "自定义页眉文字在 #headerCustomFields 凹陷容器内,仅 headerMode=custom 展开",
  },
  {
    control: "headerLogoPath",
    master: "headerMode",
    masterKind: "radio",
    on: "custom",
    why: "页眉图片 chip 与文字/布局同处一个凹陷容器,随 headerMode=custom 一同展开",
  },
  {
    control: "headerLayout",
    master: "headerMode",
    masterKind: "radio",
    on: "custom",
    why: "页眉布局与文字/图片同处一个凹陷容器,随 headerMode=custom 一同展开",
  },
  {
    control: "footerEnabled",
    master: "headerMode",
    masterKind: "radio",
    on: "custom",
    why: "自定义页脚开关在凹陷容器内且仅自定义模式生效(默认模式的固定页码页脚不受它控制)",
  },
];

/**
 * 灰禁从属项(主控关时 **disabled 但不移除**):IA §3 规则 1 的唯一例外。
 * 用灰禁而非收起是因为收起会丢掉用户上次的选择、且每次开关总开关都造成布局位移;
 * 代价是它**保持可见**,故可用性判据是 disabled 态而不是可见性 —— 把这两条混成一条
 * 会让门禁逼实现去改 IA 已拍板的行为。
 * @type {DrawerTier[]}
 */
export const DRAWER_DISABLED_TIERS = [
  {
    control: "aiCleanupTidy",
    master: "aiCleanup",
    why: "AI 清理分档:总开关关时置灰 + 保留一行可见说明,不移除",
  },
  {
    control: "aiCleanupRewrite",
    master: "aiCleanup",
    why: "AI 清理分档:总开关关时置灰 + 保留一行可见说明,不移除",
  },
];

/**
 * 抽屉三个主控的出厂默认档(core/settings/settings-defaults.ts 的镜像)。
 * 只服务于**合成样本**与阅读规格时的默认预期;判定层不读本表(见 Scenario.drawerMasters
 * 那条注:门禁的预期由样本实测反推)。
 * toc 的出厂值是**开**(见 settings-defaults 的 `toc: true`)—— 照直觉写成 false 会让
 * 「关态」场景的驱动步骤变成「再点一次打开」,于是关态与开态两场景拍到同一张脸。
 */
export const DRAWER_MASTER_DEFAULTS = { toc: true, aiCleanup: false, headerMode: "default" };

/**
 * 同一「视觉行」的判定带宽(px):抽屉里的多字段网格(四边边距的 mm-grid)把两个输入并排放在
 * 一行,实测顶沿**完全相同**;而相邻行的间距实测 ≥ 20px。故组内顺序按「视觉行 + 左沿」判,
 * 带宽只用来吸收亚像素与居中对齐抖动,取 4px —— 远小于行距,不会把相邻两行并成一行。
 *
 * 为什么不按 DOM 序判:04 组的 `tocMode` 下拉在 DOM 里排在 `toc` 开关**之前**(开关是
 * .sw-row 这条 flex 行的最后一个子元素、居右),但视觉上开关在上、下拉在下 —— 步 03 的退出
 * 条件写的是「控件**位置**不得变化」,故判据是视觉位置,DOM 序是实现细节。
 */
export const DRAWER_ROW_BAND_PX = 4;

/**
 * 控件键:缺省取 id ?? name(key 显式给出时以它为准)。
 * @param {DrawerControl} control 控件项
 * @returns {string} 控件键
 */
export function drawerControlKey(control) {
  const key = control.key ?? control.id ?? control.name;
  if (key === undefined) {
    throw new Error("抽屉控件项未给出定位:须声明 id 或 name 之一(定位形态由 geometry-gate 段逐条校验)");
  }
  return key;
}

/**
 * 控件在抽屉内的 CSS 选择器(一律带 #settingsDrawer 作用域,理由见 DRAWER_CONTROLS 注)。
 * @param {DrawerControl} control 控件项
 * @returns {string} CSS 选择器
 */
export function drawerControlSelector(control) {
  if (control.name !== undefined) return `${DRAWER_SELECTORS.shell} input[name="${control.name}"]`;
  if (control.id !== undefined) return `${DRAWER_SELECTORS.shell} [id="${control.id}"]`;
  throw new Error(
    `抽屉控件「${control.key ?? "?"}」未给出定位:须声明 id 或 name 之一(定位形态由 geometry-gate 段逐条校验)`,
  );
}

/**
 * 取控件项(按键反查;未登记即抛错,而不是回退成「键名即选择器」——
 * 抽屉的定位形态有 id / radio 组名两套,回退会把拼错的键变成一个静默落空的选择器)。
 * @param {string} key 控件键
 * @returns {DrawerControl} 控件项
 */
export function drawerControl(key) {
  for (const group of DRAWER_GROUPS) {
    const hit = drawerGroupControls(group).find((control) => drawerControlKey(control) === key);
    if (hit !== undefined) return hit;
  }
  throw new Error(`抽屉控件键未登记于 DRAWER_CONTROLS:${key}`);
}

/** 分组 tab 按钮选择器(tab 按钮与面板同以 data-group 命名,id 前缀 settingsTab-)
 * @param {string} group 分组
 * @returns {string} CSS 选择器
 */
export function drawerTabSelector(group) {
  if (!DRAWER_GROUPS.includes(group)) throw new Error(`抽屉分组未登记于 DRAWER_GROUPS:${group}`);
  return `#settingsTab-${group}`;
}

/**
 * 主控档位切换的驱动步骤。值表达的是「点击**之后**主控应处的档位」,故布尔值即
 * 「点一次开关」(场景按序推进且每个主控只切一次,故点位恒为出厂默认关 → 开);
 * radio 档位值则点组内该 value 的成员。
 * @param {string} master 主控控件键
 * @param {boolean | string} value 点击后应处的档位
 * @returns {{ op: string, selector: string }} 声明式驱动指令
 */
export function drawerMasterStep(master, value) {
  const base = drawerControlSelector(drawerControl(master));
  const selector = typeof value === "boolean" ? base : `${base}[value="${String(value)}"]`;
  return { op: "click", selector };
}

/** 页面侧抽屉度量脚本的探针参数(选择器全部来自本表,页面侧不再拼选择器) */
export function drawerProbeSpec() {
  return {
    shell: DRAWER_SELECTORS.shell,
    activePanel: DRAWER_SELECTORS.activePanel,
    controls: DRAWER_CONTROL_KEYS.map((key) => [key, drawerControlSelector(drawerControl(key))]),
    panels: DRAWER_CLIP_KEYS.map((key) => [key, /** @type {Record<string, string>} */ (DRAWER_SELECTORS)[key] ?? key]),
  };
}

/**
 * 抽屉场景项:通用场景之上补「激活分组 + 主控档位」,驱动步骤由主控档位生成。
 * 写成工厂而非让 9 条场景各写一遍 steps:抽屉开合与 tab 切法只有这一种,
 * 复制到每条场景里等于把驱动配方散成 9 份副本,改一处要改九处。
 * @param {string} id 场景 id
 * @param {string} group 激活分组
 * @param {Record<string, boolean | string>} masters 主控档位(空对象 = 全部保持出厂默认)
 * @param {string} shot 截图名后缀
 * @returns {Scenario} 场景表项
 */
function drawerScenario(id, group, masters, shot) {
  return {
    id,
    viewport: VIEWPORT_BASE,
    expectStage: "empty",
    shot,
    drawerTab: group,
    drawerMasters: masters,
    steps: [
      { op: "click", selector: DRAWER_SELECTORS.open },
      { op: "click", selector: drawerTabSelector(group) },
      ...Object.entries(masters).map(([master, value]) => drawerMasterStep(master, value)),
    ],
    // 抽屉是 fixed 浮层,开合不得改写主窗舞台几何 —— 顺带把公共可见节点判据带上,
    // 这条不变量正是「抽屉接进来没把主窗顶歪」的守护
    visible: [...COMMON_VISIBLE],
    present: COMMON_PRESENT,
    columnAxis: [], // 抽屉有独立的列轴语义,不在主窗纸面列轴断言里凑数
  };
}

/**
 * 抽屉场景序列(接在主窗场景之后):六个分组各一态以覆盖全部控件的可见性,
 * 另加三组「门控开/关」对照 —— 页眉自定义折叠、AI 清理分档灰禁、目录模式收起各测两个方向,
 * 只测关闭侧等于放行「打开总开关后从属项仍然不出现」这种最常见的实现漏项。
 * 截图名用「8-drawer-<分组>」而不带序号:与 visual-check 的 ui:shots 同一命名,
 * 交叉核对两份产物时不必在序号与分组名之间做 mental map;门控专属的三态带档位后缀。
 */
const DRAWER_SCENARIOS = [
  drawerScenario("drawer-preset-960", "preset", {}, "8-drawer-preset"),
  drawerScenario("drawer-typography-960", "typography", {}, "8-drawer-typography"),
  drawerScenario("drawer-headerwatermark-960", "headerwatermark", {}, "8-drawer-headerwatermark"),
  drawerScenario(
    "drawer-headerwatermark-custom-960",
    "headerwatermark",
    { headerMode: "custom" },
    "8-drawer-headerwatermark-custom",
  ),
  // 04 组:toc 出厂即开,故「关态」是基准场景、「开态」是点一次关掉
  drawerScenario("drawer-numbering-960", "numbering", {}, "8-drawer-numbering"),
  drawerScenario("drawer-numbering-toc-960", "numbering", { toc: false }, "8-drawer-numbering-toc-off"),
  drawerScenario("drawer-convert-960", "convert", {}, "8-drawer-convert"),
  drawerScenario("drawer-convert-ai-960", "convert", { aiCleanup: true }, "8-drawer-convert-ai-on"),
  drawerScenario("drawer-app-960", "app", {}, "8-drawer-app"),
];

/**
 * 场景表(顺序即驱动顺序,单窗口逐步推进,复刻 visual-check 的场景序列):
 * steps 为声明式驱动指令,由 gates/geometry/check-geometry.mjs 解释执行;
 * 视口变化由驱动自动 setContentSize(不必写 resize 步骤),实际视口与规格不符即判失败。
 * 前 12 条是主窗舞台,后 9 条是设置抽屉(接在末尾:抽屉要驱动开关改设置态,
 * 放前面会让既有主窗场景量到被改过的设置)。
 * @type {Scenario[]}
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
  ...DRAWER_SCENARIOS,
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
 * @type {ConstantGroup[]}
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
    why: "固定槽:历史标题条为 40px 常驻占位(矮窗档 36px),浮层开合与文件态切换不得改变占位高度(其纵向位置由固定消息槽 --feed-h 钉死,见 feed-slot 组)",
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
  // 消息区固定槽:--feed-h 令牌锁高,状态行/跳过列表/结果汇总的增减
  // 一律不改写槽高,故其上下邻居(舞台下沿、历史条上沿)也不再被推挤。
  {
    id: "feed-slot-960",
    node: "feed",
    axes: ["height"],
    baseline: "empty-960",
    members: STATES_960,
    why: "固定消息槽:常规档 --feed-h=96px,转换开始/完成时状态行与结果汇总条的增减不得改写槽高(超出部分在槽内滚动)",
  },
  {
    id: "feed-slot-880",
    node: "feed",
    axes: ["height"],
    baseline: "compact-multi-880",
    members: STATES_COMPACT,
    why: "紧凑档固定消息槽:矮窗档 --feed-h=86px,进度行显隐与历史浮层开合不得改写槽高",
  },
  {
    id: "feed-slot-640",
    node: "feed",
    axes: ["height"],
    baseline: "halfscreen-multi-640",
    members: ["halfscreen-multi-640", "halfscreen-empty-640"],
    why: "半屏档固定消息槽:640×560 仍走矮窗档 --feed-h=86px,清空列表(文件态→空态)不得改写槽高",
  },
];

/**
 * 固定槽高度区间(px):常驻占位不得塌陷(下限),也不得被内容撑高/退化为自适应(上限)。
 * 上限取「两档令牌值 + 1px 容差」:--feed-h 常规 96 / 矮窗 86,超出即说明 .feed 又回到
 * height:auto(恢复固定槽之前的状态),或结果汇总把槽顶开。
 * @type {SlotInvariant[]}
 */
export const SLOT_INVARIANTS = [
  { node: "historyHead", minHeight: 30, why: "历史标题条常驻占位(常规档 40px / 矮窗档 36px)" },
  {
    node: "feed",
    minHeight: 80,
    maxHeight: 97,
    why: "消息区固定槽(常规档 96px / 矮窗档 86px,见 base.css --feed-h);低于 80 是塌陷,高于 97 说明被内容撑高",
  },
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
 * @param {string} cssText 样式表全文
 * @returns {string[]} 条件串(去重、保持出现序)
 */
export function extractHeightMediaConditions(cssText) {
  /** @type {string[]} */
  const found = [];
  for (const m of cssText.matchAll(/@media\s*(\([^)]*\bheight\b[^)]*\))/g)) {
    // 捕获组恒有值(模式里括号内为必选),?? "" 只是满足定长元组索引的取值域
    const cond = (m[1] ?? "").replace(/\s+/g, " ").trim();
    if (!found.includes(cond)) found.push(cond);
  }
  return found;
}

/**
 * 求值高度/宽度维度媒体查询在给定视口下是否成立。
 * 只支持 (min|max)-(width|height): Npx;出现其他写法(复合条件、em/rem、其他特征)
 * 直接抛错 —— 宁可门禁红并要求扩展求值器,也不静默跳过未覆盖的档位。
 * @param {string} condition 媒体查询条件串(如 (min-height: 640px))
 * @param {{ width: number, height: number }} viewport 视口尺寸(px)
 * @returns {boolean} 条件在该视口下是否成立
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

/* ══════════════ CSS 令牌恒等(取消态不得被读成成功绿 / 失败红) ══════════════
   判据形态:**浏览器实算色**,不是样式表文本。这三条断言此前是 ui-interaction-guards
   段里三条读 dialogs.css 的正则,现已迁到本门禁。迁动的理由是原判据有两处硬伤:
     ① 源文本形态 —— 正则只确认「声明块里出现过那几个字符」,看不到浏览器最终算出什么;
     ② 恒真 —— 把 border-color 改成任何另一根中性色令牌(哪怕同样是发丝线)它照样绿,
        而真正的契约是「取消态不得被读成成功绿 / 失败红」,不是「必须恰好是 --line」。
   迁到这里后判据是:按真实类名把节点摆到 成功 / 失败 / 取消 三个态,读 getComputedStyle
   的**计算色**,判定层要求三条同时成立:
     A. 三态互不相等(取消态若被读成成功绿/失败红,即 canceled===ok 或 canceled===fail);
     B. 取消态落在中性区间(等于 expectedToken 的实算色);
     C. 取消态不等于任何 forbiddenTokens 的实算色(语义对立面,逐根点名比)。

   为什么并在本门禁(职责由「几何」扩到「CSS 令牌恒等」):本门禁已在链内
   (verify:ci 末环)、已在真实 Electron 窗口里跑,且已有同类「结构不变式」判据
   (抽屉控件门控面)。另起一个门禁会多一次 Electron 冷启动,而这一条要的就是
   「真实窗口 + 真实级联」—— 与几何门禁的运行面完全重合。代价是本门禁不再纯几何,
   故在 gates/geometry/check-geometry.mjs 的文件头写明扩展理由与边界。

   本表**只守配色契约**,不守「取消时是否真的挂上了取消类名」—— 那是 dialogs.ts 的行为,
   由 ui-interaction-guards 段的取消态行为断言负责。两者互补不重叠:那边验「类名挂对了」,
   这边验「挂对之后浏览器算出来的颜色是中性而非成功/失败色」。 */

/**
 * @typedef {object} CssTokenNodeRule 被读色节点的构造说明
 * @property {string} tag 标签名
 * @property {string} baseClass 基础类名(不加任何态修饰类时的形态)
 */

/**
 * @typedef {object} CssTokenRule CSS 令牌恒等判据一项
 * @property {string} name 规则 id(报告里按此归类)
 * @property {string} mount 真实锚点选择器(合成节点插到它的**下一个兄弟位**;宿主为真实节点时
 *   它同时就是「在谁身上切态」的选择器)
 * @property {string} [hostSelector] 用**线上真实节点**当宿主(切态时只增删态修饰类,
 *   原有类名原样保留,读完复原);缺省则按 host 合成一个
 * @property {CssTokenNodeRule} [host] 合成宿主的构造(缺省 hostSelector 时必填)
 * @property {string} [targetSelector] 被读色节点已存在于线上时用选择器取(缺省则按 target 合成)
 * @property {CssTokenNodeRule} [target] 被读色的节点(缺省 = 宿主自身)
 * @property {string} property 读取的 CSS 属性(**dashed 形态**,如 border-top-color:
 *   getPropertyValue 只认 dashed,传 camelCase 静默返回空串)
 * @property {{ ok: string, fail: string, canceled: string }} states 三态各自的修饰类名
 * @property {string} expectedToken 取消态须落在的中性令牌(判据 B)
 * @property {string[]} forbiddenTokens 取消态不得等于的令牌(成功绿 / 失败红,判据 C)
 * @property {string} why 契约说明(失败消息引用)
 * @property {string} whyReal 选真实节点而非合成的理由(写进头注,防下任「顺手改成合成」)
 */

/**
 * 取消态配色恒等表。
 *
 * 比对的是「令牌实算色相等与否」,不是字面色值:主题换色(data-theme /
 * prefers-color-scheme 各有一套令牌值)时两侧会一起变,字面量比法会假红。
 * 令牌实算色由页面侧探针**过一遍浏览器**取得(临时节点 color:var(--x) 后读
 * getComputedStyle),故 --line 写成 #e2e2dc 还是 rgb(226,226,220) 都比得动。
 *
 * 前两条用**线上真实节点**(#resultSummary / 其内真图标)而非合成节点:真图标是 SVG
 * 命名空间元素,实测用 document.createElement("svg") 造的 HTML 命名空间替身**不参与
 * 同一套类规则**,量到的不是用户看到的东西 —— 替身量绿、真图标不绿,判据就成摆设。
 * 第三条用合成节点是因为批量条目在静止态下一条都不存在(要真跑一次批量转换才有),
 * 且它本就是纯 HTML 元素(li/span),合成与真实同构。
 * @type {CssTokenRule[]}
 */
export const CSS_TOKEN_RULES = [
  {
    name: "canceled-summary-neutral-border",
    mount: "#resultSummary",
    hostSelector: "#resultSummary",
    property: "border-top-color",
    states: {
      ok: "result-summary--ok",
      fail: "result-summary--fail",
      canceled: "result-summary--canceled",
    },
    expectedToken: "--line",
    forbiddenTokens: ["--ok-soft", "--acc-ring"],
    why: "取消态汇总条边框须为中性发丝线,不得沿用成功绿 / 失败红(取消不是成功也不是失败)",
    whyReal: "线上 #resultSummary 就是被读色的节点本身,合成替身没有任何额外信息量",
  },
  {
    name: "canceled-muted-icon",
    mount: "#resultSummary",
    hostSelector: "#resultSummary",
    targetSelector: "#summaryIcon",
    property: "color",
    states: {
      ok: "result-summary--ok",
      fail: "result-summary--fail",
      canceled: "result-summary--canceled",
    },
    expectedToken: "--mut",
    forbiddenTokens: ["--ok", "--acc"],
    why: "取消态图标须为 --mut 弱化色,不得读成成功绿 / 失败红",
    whyReal: "真图标是 SVG 命名空间元素:HTML 命名空间的同名替身不参与这套类规则,量它等于量了个不存在的东西",
  },
  {
    name: "canceled-batch-item-muted-icon",
    mount: "#batchResultList",
    host: { tag: "li", baseClass: "batch-item" },
    target: { tag: "span", baseClass: "batch-item-icon" },
    property: "color",
    states: {
      ok: "batch-item--success",
      fail: "batch-item--fail",
      canceled: "batch-item--canceled",
    },
    expectedToken: "--mut",
    forbiddenTokens: ["--ok", "--acc"],
    why: "批量条目取消图标须为 --mut 弱化色,不得读成成功绿 / 失败红",
    whyReal: "静止态下一个批量条目都不存在(要真跑一次批量转换才有),且 li/span 与真实同构",
  },
];

/**
 * 令牌恒等规则 id 单源:门禁报告与统计按此列出已跑的判据项,避免「表加了项但没人报」。
 * @type {string[]}
 */
export const CSS_TOKEN_RULE_IDS = CSS_TOKEN_RULES.map((rule) => rule.name);


