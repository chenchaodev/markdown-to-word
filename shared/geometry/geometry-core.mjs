// @ts-check
/**
 * geometry gate 判定层(纯函数,零 DOM / 零 Electron / 零 IO):
 * 规格从 geometry-spec 单源引入,本文件只负责「样本 → findings → ok」的裁决:
 *   1) 视口容纳、响应式档位生效、舞台状态生效、必需节点在场/可见;
 *   2) 水平溢出与 overflow-x:hidden 容器内的内容裁切;
 *   3) 紧凑/半屏档免滚动、固定槽不塌陷、列轴对齐与越界;
 *   4) 恒定断言组(阶段跳动);
 *   5) 设置抽屉:控件存在/可见/组归属/组内顺序/无裁切/门控显隐与分档可用性。
 *
 * 失败语义:缺场景 / 场景步骤失败 / 缺选择器 / 必需节点不可见 / 视口不匹配 /
 * 响应式档位未生效 / 舞台状态不匹配 / 水平溢出 / 水平裁切 / 槽塌陷 / 槽越界(撑高) /
 * 阶段跳动超阈值 / 紧凑档纵向滚动 / 列轴漂移 / 抽屉未开 / 抽屉 tab 未切到位 /
 * 抽屉控件缺失、错组、乱序、门控反向、分档可用性反向,一律记 error 并使 ok=false;
 * 任何"跳过"都必须以 finding 形式显式出现,禁止静默通过。
 *
 * 判定全部为纯函数,采样由外部注入 —— 真实窗口采样见 gates/geometry/check-geometry.mjs,
 * 合成样本负探针见 test/gates/geometry-gate.test.js。故门禁判定不依赖人工目检,
 * 判定逻辑本身可在无 Electron 环境下完整验证。
 */
import {
  CONSTANT_GROUPS,
  CSS_TOKEN_RULES,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  DRAWER_CLIP_KEYS,
  DRAWER_CONDITIONS,
  DRAWER_CONTROL_KEYS,
  DRAWER_DISABLED_TIERS,
  DRAWER_GROUP_BY_KEY,
  DRAWER_ROW_BAND_PX,
  DRAWER_SELECTORS,
  NODE_SELECTORS,
  PAPER_KEY,
  SCENARIOS,
  SCROLL_KEY,
  SLOT_INVARIANTS,
  STAGE_KEY,
  X_CLIP_KEYS,
  drawerControl,
  drawerControlSelector,
  evaluateMediaCondition,
} from "./geometry-spec.mjs";

// 规格单源再导出:消费方(驱动脚本 / 测试段)只需从 geometry-core 引入即可拿到全部契约
export {
  CONSTANT_GROUPS,
  CSS_TOKEN_RULES,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  DRAWER_CLIP_KEYS,
  DRAWER_CONDITIONS,
  DRAWER_CONTROL_KEYS,
  DRAWER_CONTROLS,
  DRAWER_DISABLED_TIERS,
  DRAWER_GROUPS,
  DRAWER_GROUP_BY_KEY,
  DRAWER_MASTER_DEFAULTS,
  DRAWER_ROW_BAND_PX,
  DRAWER_SELECTORS,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  X_CLIP_KEYS,
  drawerControl,
  drawerControlKey,
  drawerControlSelector,
  drawerGroupControls,
  drawerProbeSpec,
  drawerTabSelector,
  evaluateMediaCondition,
  extractHeightMediaConditions,
} from "./geometry-spec.mjs";

/* ---------- 判定层的类型契约(采样形状与 finding 形状;规格项类型单源在 geometry-spec) ---------- */

/**
 * @typedef {object} Rect 矩形(页面侧 getBoundingClientRect 结果,已保留两位小数)
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} NodeSample 单个节点的度量样本(选择器不存在时取值为 null)
 * @property {Rect} rect
 * @property {boolean} visible 可见(display/visibility/尺寸判据合成)
 * @property {string} display
 * @property {string | null} dataStage 舞台状态载体节点的 data-stage
 * @property {number} [borderLeft] 左边线宽(内容盒换算用)
 * @property {number} clientWidth
 * @property {number} clientHeight
 * @property {number} scrollWidth
 * @property {number} scrollHeight
 */

/**
 * @typedef {object} DrawerControlSample 单个抽屉控件的度量样本
 * @property {boolean} found 抽屉内是否查到该控件
 * @property {string | null} [group] 控件最近祖先的 data-group(实测组归属)
 * @property {boolean} [disabled] 控件是否 disabled(灰禁判据)
 * @property {boolean | null} [checked] 开关勾选态 / radio 组有无选中;非勾选控件为 null
 * @property {string | null} [value] radio 组选中档位;非 radio 组为 null
 * @property {Rect} [rect]
 * @property {boolean} [visible] 可见(display/visibility/尺寸判据合成)
 * @property {string} [display]
 * @property {number} [clientWidth]
 * @property {number} [scrollWidth]
 */

/**
 * @typedef {object} DrawerSample 设置抽屉的度量样本
 * @property {number} measured 查到的控件数(0 = 扫描面整体失效,判红而不是静默绿)
 * @property {boolean} shellVisible 抽屉遮罩是否可见
 * @property {string | null} activeGroup 当前激活面板的 data-group
 * @property {Record<string, DrawerControlSample>} controls 控件度量表(键见 DRAWER_CONTROL_KEYS)
 * @property {Record<string, NodeSample | null>} panels overflow-x:hidden 容器度量表
 */

/**
 * @typedef {object} GeometrySample 单个场景的采样结果
 * @property {string} id 场景 id(与 SCENARIOS 对齐)
 * @property {{ width: number, height: number }} viewport 实际视口
 * @property {Record<string, boolean>} [tiers] 媒体查询条件的匹配态(页面侧 matchMedia 读出)
 * @property {{ scrollWidth: number, clientWidth: number, scrollHeight: number, clientHeight: number }} doc 文档滚动尺寸
 * @property {Record<string, NodeSample | null>} nodes 节点度量表(键见 NODE_SELECTORS)
 * @property {DrawerSample} [drawer] 抽屉度量(仅场景声明 drawerTab 时参与判定)
 * @property {string | null} [error] 场景步骤失败原因(有则该场景几何判定跳过,本条显式记 finding)
 */

/**
 * @typedef {object} Box 列轴比对用的盒(padding box 或 border box)
 * @property {number} left
 * @property {number} right
 * @property {number} width
 */

/**
 * @typedef {object} CssTokenReading 单条令牌恒等判据的页面读数(页面侧探针产出)
 * @property {string} name 规则 id(对齐 CSS_TOKEN_RULES.name)
 * @property {string} property 被读色的 CSS 属性
 * @property {boolean} mountFound 真实锚点是否在页面上找到(false = 挂载面已漂移,判红)
 * @property {boolean} [targetFound] 被读色节点是否取到(false = 读数不可信,判红;合成宿主恒为 true)
 * @property {{ base: string, ok: string, fail: string, canceled: string }} colors 四态计算色
 * @property {string} expected 中性令牌的实算色(取消态须落在它上面)
 * @property {{ token: string, color: string }[]} forbidden 语义对立令牌的实算色(逐根点名)
 */

/**
 * @typedef {object} GeometryFinding 一条门禁 finding
 * @property {string} rule 规则名(报告按此归类)
 * @property {string} severity 严重级别(现只有 error)
 * @property {string} scenario 场景 id
 * @property {string | null} node 节点 key(与场景无关的规则为 null)
 * @property {string} message 失败消息(须可定位:规则/场景/节点/数字)
 * @property {string} [expected] 期望值(可读形态)
 * @property {string} [actual] 实测值(可读形态)
 * @property {string} [group] 所属恒定组 id(仅恒定组判定)
 * @property {string} [axes] 参与比对的轴(仅恒定组判定)
 */

/**
 * @typedef {object} GateOptions 门禁阈值与档位条件(缺省取规格单源默认值)
 * @property {number} [tolPx] 容差(px)
 * @property {number} [scrollBudgetPx] 紧凑档纵向滚动预算(px)
 * @property {string[]} [mediaConditions] 需校验匹配态的媒体查询条件
 */

/** 矩形格式化(日志/失败定位用)
 * @param {Rect | null | undefined} rect
 * @returns {string}
 */
export function formatRect(rect) {
  if (rect === undefined || rect === null) return "(无)";
  return `[l=${rect.left} t=${rect.top} w=${rect.width} h=${rect.height}]`;
}

/** 两矩形的逐轴差值(px);返回 { max, prop }。axes 缺省比对四个几何轴
 * @param {Rect} a
 * @param {Rect} b
 * @param {("left" | "top" | "width" | "height")[]} [axes]
 * @returns {{ max: number, prop: string }}
 */
export function rectDelta(a, b, axes = ["left", "top", "width", "height"]) {
  let max = 0;
  let prop = "";
  for (const key of axes) {
    const d = Math.abs(a[key] - b[key]);
    if (d > max) {
      max = d;
      prop = key;
    }
  }
  return { max, prop };
}

/**
 * 节点的"纸面盒"(padding box):rect.left + border 宽 → 内容左沿;clientWidth → 内容宽。
 * 列轴断言用 padding box 而非 border box,否则 .stage 的 1px 边线会让成员凭空左移 1px。
 * @param {NodeSample} node 节点度量样本
 * @returns {Box}
 */
export function paddingBox(node) {
  const left = node.rect.left + (node.borderLeft ?? 0);
  return { left, right: left + node.clientWidth, width: node.clientWidth };
}

/** border box(视觉外沿):含自身边线,卡片/输入框类元素的列轴外沿语义
 * @param {NodeSample} node 节点度量样本
 * @returns {Box}
 */
export function borderBox(node) {
  return { left: node.rect.left, right: node.rect.right, width: node.rect.width };
}

/** 按列组声明的 box 语义取盒(border = 视觉外沿,padding = 去自身边线后的内容盒)
 * @param {NodeSample} node 节点度量样本
 * @param {"border" | "padding"} kind 列组声明的盒语义
 * @returns {Box}
 */
export function nodeBox(node, kind) {
  return kind === "border" ? borderBox(node) : paddingBox(node);
}

/**
 * 主控是否处于「从属项应当可见 / 可用」的档位。
 * 读的是**样本实测**的主控态(checked / value),不是规格里声明的档位 —— 声明写错会让
 * 门禁自洽而假绿,实测才是被测对象。返回 null 表示主控样本不可用(不可判定)。
 * @param {DrawerControlSample | undefined} master 主控样本
 * @param {{ masterKind: "switch" | "radio", on?: boolean | string }} cond 条件声明
 * @returns {boolean | null} null = 主控不可判定
 */
export function masterSatisfied(master, cond) {
  if (master === undefined || master.found !== true) return null;
  return cond.masterKind === "switch" ? master.checked === true : master.value === cond.on;
}

/**
 * 抽屉单场景判定(纯函数)。判据是结构不变式而非像素快照:存在且可见、组归属、
 * 组内顺序、无水平裁切、门控显隐、灰禁分档可用性。
 *
 * 「应当可见」= 所属分组是激活分组 × 其条件从属项被主控满足,两者都取自样本实测;
 * 因此删掉任一手写同步函数(页眉自定义折叠 / 目录模式收起 / AI 清理分档灰禁)都会立刻
 * 判红,而不会因为「门控表自洽」而放行。
 * @param {import("./geometry-spec.mjs").Scenario} sc 场景表项(须声明 drawerTab)
 * @param {GeometrySample} sample 该场景的采样
 * @param {number} tolPx 容差(px)
 * @param {(rule: string, node: string | null, message: string, extra?: Pick<GeometryFinding, "expected" | "actual">) => void} add finding 登记
 * @returns {void}
 */
function judgeDrawerScenario(sc, sample, tolPx, add) {
  const label = `场景「${sc.id}」`;
  // 结构节点表按字面量对象声明(键名写错即编译期报错);按 Record 索引与既有 sel() 同理
  /** @param {string} key @returns {string} */
  const drawerSel = (key) => /** @type {Record<string, string>} */ (DRAWER_SELECTORS)[key] ?? key;
  const drawer = sample.drawer;
  if (drawer === undefined || drawer === null) {
    add(
      "selector-missing",
      "drawer",
      `${label}度量样本没有 drawer 段(页面侧度量脚本未采集抽屉);抽屉判据已跳过,本条已显式记录`,
    );
    return;
  }
  // 抽屉没开时量到的是「面板 display:none 下的零尺寸节点」,继续判只会刷出一屏
  // 不可见噪声掩盖根因,故先拦并给一条可定位的 finding
  if (!drawer.shellVisible) {
    add("drawer-closed", "drawer", `${label}抽屉处于关闭态(${drawerSel("shell")} 不可见),抽屉判据已跳过`);
    return;
  }
  if (!(drawer.measured > 0)) {
    add(
      "selector-missing",
      "drawer",
      `${label}抽屉控件清单一个节点都没量到(实测 measured=0):扫描面整体失效,` +
        `禁止按「无控件即无问题」静默通过;检查 ${drawerSel("shell")} 与各控件选择器`,
    );
    return;
  }
  if (drawer.activeGroup !== sc.drawerTab) {
    add(
      "drawer-tab-mismatch",
      DRAWER_SELECTORS.activePanel,
      `${label}抽屉当前激活分组为 ${String(drawer.activeGroup)},规格要求 "${sc.drawerTab}";` +
        `场景未按预期切到该组,量到的是上一组的面板`,
      { expected: String(sc.drawerTab), actual: String(drawer.activeGroup) },
    );
  }

  // 条件从属项的「主控是否满足」先算一遍:主控缺样本时可见性预期落空,故集中在此处
  // 一次性报错,而不是在每个从属控件上重复同一条噪声
  /** @type {Map<string, boolean | null>} */
  const satisfied = new Map();
  for (const cond of DRAWER_CONDITIONS) {
    const state = masterSatisfied(drawer.controls[cond.master], cond);
    satisfied.set(cond.control, state);
    if (state === null) {
      add(
        "drawer-master-unreadable",
        cond.master,
        `${label}条件从属项 ${cond.control} 的主控 ${cond.master} 在抽屉内不可读,` +
          `该从属项可见性不可判定(本条已显式记录);${cond.why}`,
      );
    }
  }
  /** @type {Map<string, boolean | null>} 灰禁从属项 → 总开关是否已开(null = 不可判定) */
  const tierMasterOn = new Map();
  for (const tier of DRAWER_DISABLED_TIERS) {
    const on = masterSatisfied(drawer.controls[tier.master], { masterKind: "switch" });
    tierMasterOn.set(tier.control, on);
    if (on === null) {
      add(
        "drawer-master-unreadable",
        tier.master,
        `${label}灰禁从属项 ${tier.control} 的主控 ${tier.master} 在抽屉内不可读,可用性不可判定(本条已显式记录);${tier.why}`,
      );
    }
  }

  const vw = sample.viewport.width;
  for (const key of DRAWER_CONTROL_KEYS) {
    const control = drawer.controls[key];
    if (control === undefined || control.found !== true) {
      add("selector-missing", key, `${label}抽屉控件 ${key}(${drawerControlSelector(drawerControl(key))} 不在抽屉内)`);
      continue;
    }
    const declared = DRAWER_GROUP_BY_KEY.get(key);
    if (control.group !== declared) {
      add(
        "drawer-group-mismatch",
        key,
        `${label}抽屉控件 ${key} 落在 data-group="${String(control.group)}" 面板内,规格声明为 "${String(declared)}";` +
          `控件归组错位会让 Tab 与面板的对应关系失真`,
        { expected: String(declared), actual: String(control.group) },
      );
    }
    const condOn = satisfied.get(key);
    const inActive = declared === sc.drawerTab;
    const expectVisible = inActive && (condOn ?? true);
    if (expectVisible && control.visible !== true) {
      add(
        "selector-hidden",
        key,
        `${label}抽屉控件 ${key} 应在场可见却不可见(display=${String(control.display)},rect=${formatRect(control.rect)})`,
      );
    }
    if (!expectVisible && control.visible === true) {
      add(
        "drawer-gate-inverted",
        key,
        `${label}抽屉控件 ${key} 应当不可见却可见:${
          inActive
            ? `条件从属项被主控收起(主控实测态未满足展开条件;见 ${DRAWER_CONDITIONS.find((c) => c.control === key)?.why ?? "门控表未登记"})`
            : `其所属分组 "${String(declared)}" 不是本场景激活的 "${String(sc.drawerTab)}"(非激活面板应整块 display:none)`
        };面板切换或门控同步失效`,
      );
    }
    // 抽屉是 fixed 浮层,溢出不进文档 scrollWidth,水平容纳只能逐控件对视口判
    if (control.visible === true && control.rect !== undefined) {
      const { left, right } = control.rect;
      if (left < -tolPx || right > vw + tolPx) {
        add(
          "viewport-overflow",
          key,
          `${label}抽屉控件 ${key} 越出视口(左 ${left} 右 ${right},视口宽 ${vw},rect=${formatRect(control.rect)})`,
          { expected: `[0, ${vw}]`, actual: `[${left}, ${right}]` },
        );
      }
    }
    for (const tier of DRAWER_DISABLED_TIERS) {
      if (tier.control !== key) continue;
      // 总开关开着 → 分档可用;关着 → 灰禁但**不移除**(IA §3 规则 1 的唯一例外)
      const masterOn = tierMasterOn.get(tier.control) ?? null;
      if (masterOn === null) continue; // 不可判定已由 drawer-master-unreadable 记过
      const expectDisabled = !masterOn;
      if (control.disabled !== expectDisabled) {
        add(
          "drawer-tier-availability",
          key,
          `${label}抽屉分档 ${key} 的可用性与总开关 ${tier.master} 不匹配:总开关 ${String(masterOn)} 时应当 ` +
            `${expectDisabled ? "disabled(灰禁,不移除)" : "可用"},实测 disabled=${String(control.disabled)};${tier.why}`,
          { expected: `disabled=${String(expectDisabled)}`, actual: `disabled=${String(control.disabled)}` },
        );
      }
    }
  }

  // 组内顺序:声明序(组序 × 组内序)须与**视觉序**同序(自上而下,同一行自左而右)。
  // 判视觉序而非 DOM 序的理由见 DRAWER_ROW_BAND_PX 的注;只取可见控件 —— 收起态的控件
  // 位置无意义,其顺序由对应的「展开态」场景判(几何门禁为每个门控都排了开/关两态)。
  const byVisual = DRAWER_CONTROL_KEYS.flatMap((key) => {
    const control = drawer.controls[key];
    return control !== undefined && control.found === true && control.visible === true && control.rect !== undefined
      ? [{ key, rect: control.rect }]
      : [];
  }).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  // 行聚簇:顶沿相差在带宽内的归入同一行(网格并排的输入实测顶沿完全相同),否则起新行
  /** @type {Map<string, { row: number, left: number }>} */
  const position = new Map();
  let rowTop = null;
  let row = -1;
  for (const item of byVisual) {
    if (rowTop === null || item.rect.top - rowTop > DRAWER_ROW_BAND_PX) {
      row += 1;
      rowTop = item.rect.top;
    }
    position.set(item.key, { row, left: item.rect.left });
  }
  /** @type {string | null} */
  let prevKey = null;
  /** @type {{ row: number, left: number } | null} */
  let prevPos = null;
  for (const key of DRAWER_CONTROL_KEYS) {
    const pos = position.get(key);
    if (pos === undefined) continue;
    if (prevPos !== null && (pos.row < prevPos.row || (pos.row === prevPos.row && pos.left <= prevPos.left))) {
      add(
        "drawer-order-mismatch",
        key,
        `${label}抽屉控件组内顺序与声明不一致:${String(prevKey)} 位于第 ${prevPos.row + 1} 行左沿 ${prevPos.left},` +
          `而 ${key} 位于第 ${pos.row + 1} 行左沿 ${pos.left};控件位置不得变化(步 03 的退出条件)`,
        {
          expected: `${String(prevKey)} 在 ${key} 之前`,
          actual: `row ${prevPos.row + 1}/${pos.row + 1},left ${prevPos.left}/${pos.left}`,
        },
      );
    }
    prevKey = key;
    prevPos = pos;
  }

  // 抽屉内水平裁切:面板区与 tab 导航都是 overflow-x:hidden
  for (const key of DRAWER_CLIP_KEYS) {
    const panel = drawer.panels[key];
    if (panel === null || panel === undefined) {
      add("selector-missing", key, `${label}抽屉滚动容器 ${key}(${drawerSel(key)})不存在`);
      continue;
    }
    const over = panel.scrollWidth - panel.clientWidth;
    if (over > tolPx) {
      add(
        "horizontal-clip",
        key,
        `${label}${drawerSel(key)} 内有 ${over}px 内容被裁切(overflow-x:hidden,` +
          `scrollWidth=${panel.scrollWidth} > clientWidth=${panel.clientWidth})`,
        { expected: `scrollWidth<=clientWidth+${tolPx}`, actual: String(over) },
      );
    }
  }
}

/**
 * 门禁判定主入口(纯函数)。
 * @param {GeometrySample[]} samples 采样列表,每项 { id, viewport, tiers, doc, nodes, error? };
 *   nodes[key] = { rect, visible, display, dataStage, borderLeft, clientWidth, clientHeight,
 *                  scrollWidth, scrollHeight } | null(选择器不存在);
 *   tiers[条件] = matchMedia(条件).matches(页面侧读出,用于档位生效断言)
 * @param {GateOptions} [options] { tolPx, scrollBudgetPx, mediaConditions }
 * @returns {{ ok: boolean, findings: GeometryFinding[], stats: object, passedScenarios: string[] }}
 */
export function runGeometryGate(samples, options = {}) {
  const tolPx = options.tolPx ?? DEFAULT_TOL_PX;
  const scrollBudgetPx = options.scrollBudgetPx ?? DEFAULT_SCROLL_BUDGET_PX;
  const mediaConditions = options.mediaConditions ?? [];
  /** @type {GeometryFinding[]} */
  const findings = [];
  /**
   * 登记一条 finding(所有判定失败与"显式跳过"都走这里,禁止静默通过)。
   * @param {string} rule 规则名
   * @param {string} scenario 场景 id
   * @param {string | null} node 节点 key
   * @param {string} message 失败消息
   * @param {Pick<GeometryFinding, "expected" | "actual" | "group" | "axes">} [extra] 期望/实测等补充字段
   * @returns {void}
   */
  const add = (rule, scenario, node, message, extra = {}) => {
    findings.push({ rule, severity: "error", scenario, node, message, ...extra });
  };
  const byId = new Map(samples.map((s) => [s.id, s]));
  // NODE_SELECTORS 按字面量对象声明(键名写错即编译期报错);此处按 Record 索引是契约的一部分:
  // 未登记的键回退为「键名即选择器」
  /**
   * @param {string} key 节点 key
   * @returns {string} CSS 选择器
   */
  const sel = (key) => /** @type {Record<string, string>} */ (NODE_SELECTORS)[key] ?? key;

  for (const sc of SCENARIOS) {
    const sample = byId.get(sc.id);
    if (sample === undefined) {
      add(
        "scenario-missing",
        sc.id,
        null,
        `场景「${sc.id}」没有采样结果(驱动步骤异常或被跳过);门禁不允许静默跳过,须显式失败`,
      );
      continue;
    }
    if (sample.error) {
      add(
        "scenario-failed",
        sc.id,
        null,
        `场景「${sc.id}」采样失败:${sample.error};该场景几何判定已跳过(本条已显式记录)`,
      );
      continue;
    }
    const label = `场景「${sc.id}」`;

    // 视口口径:resize 未生效则后续判定全部失真,先拦
    // 容差同 tolPx:窗口管理器对 setContentSize 与 innerWidth 存在 1px 取整差
    const wantW = sc.viewport[0];
    const wantH = sc.viewport[1];
    if (
      Math.abs(sample.viewport.width - wantW) > tolPx ||
      Math.abs(sample.viewport.height - wantH) > tolPx
    ) {
      add(
        "viewport-mismatch",
        sc.id,
        null,
        `${label}实际视口 ${sample.viewport.width}×${sample.viewport.height} 与规格 ${wantW}×${wantH} 不符,setContentSize 未生效`,
        { expected: `${wantW}×${wantH}`, actual: `${sample.viewport.width}×${sample.viewport.height}` },
      );
    }

    // 响应式档位:高度维度的媒体查询必须已在该视口生效(隐藏窗口重算滞后会让整档样式未应用)
    for (const cond of mediaConditions) {
      const expected = evaluateMediaCondition(cond, { width: wantW, height: wantH });
      const actual = sample.tiers?.[cond];
      if (actual !== expected) {
        add(
          "tier-mismatch",
          sc.id,
          cond,
          `${label}响应式档位 ${cond} 应为 ${expected},页面实际 ${String(actual)};` +
            `高度档未生效时量到的是上一档布局(矮窗档决定 --tbh/--panes-h/--quickbar-h)`,
          { expected: String(expected), actual: String(actual) },
        );
      }
    }

    // 舞台状态:场景必须真的驱动到位,否则量到的是上一个状态
    const stageNode = sample.nodes[STAGE_KEY];
    if (sc.expectStage !== undefined && stageNode !== null && stageNode !== undefined) {
      if (stageNode.dataStage !== sc.expectStage) {
        add(
          "stage-mismatch",
          sc.id,
          STAGE_KEY,
          `${label}舞台状态为 data-stage="${String(stageNode.dataStage)}",规格要求 "${sc.expectStage}";场景未按预期生效`,
          { expected: sc.expectStage, actual: String(stageNode.dataStage) },
        );
      }
    }

    // 必需节点:在场 + 可见
    for (const key of sc.present ?? []) {
      if (sample.nodes[key] === null || sample.nodes[key] === undefined) {
        add("selector-missing", sc.id, key, `${label}必需节点 ${key}(${sel(key)}) 在 DOM 中不存在`);
      }
    }
    for (const key of sc.visible ?? []) {
      const node = sample.nodes[key];
      if (node === null || node === undefined) {
        add("selector-missing", sc.id, key, `${label}必需可见节点 ${key}(${sel(key)}) 在 DOM 中不存在`);
        continue;
      }
      if (!node.visible) {
        add(
          "selector-hidden",
          sc.id,
          key,
          `${label}必需可见节点 ${key}(${sel(key)}) 不可见(display=${node.display},rect=${formatRect(node.rect)})`,
        );
      }
    }

    // 视口容纳:关键元素不得越出视口(负向:左/右/上/下溢出)
    const vw = sample.viewport.width;
    const vh = sample.viewport.height;
    for (const key of sc.visible ?? []) {
      const node = sample.nodes[key];
      if (node === null || node === undefined || !node.visible) continue;
      const { left, top, right, bottom } = node.rect;
      const over = [];
      if (left < -tolPx) over.push(`左溢出 ${(-left).toFixed(2)}px`);
      if (top < -tolPx) over.push(`上溢出 ${(-top).toFixed(2)}px`);
      if (right > vw + tolPx) over.push(`右溢出 ${(right - vw).toFixed(2)}px`);
      if (bottom > vh + tolPx) over.push(`下溢出 ${(bottom - vh).toFixed(2)}px`);
      if (over.length > 0) {
        add(
          "viewport-overflow",
          sc.id,
          key,
          `${label}节点 ${key}(${sel(key)}) ${over.join("、")}(视口 ${vw}×${vh},rect=${formatRect(node.rect)})`,
          { expected: `right<=${vw} bottom<=${vh}`, actual: `right=${right} bottom=${bottom}` },
        );
      }
    }

    // 水平溢出:全局横向滚动条 + overflow-x:hidden 容器内的内容裁切
    const docOver = sample.doc.scrollWidth - sample.doc.clientWidth;
    if (docOver > tolPx) {
      add(
        "horizontal-overflow",
        sc.id,
        "document",
        `${label}文档横向溢出 ${docOver}px(scrollWidth=${sample.doc.scrollWidth} > clientWidth=${sample.doc.clientWidth})`,
        { expected: `scrollWidth<=clientWidth+${tolPx}`, actual: String(docOver) },
      );
    }
    for (const key of X_CLIP_KEYS) {
      const node = sample.nodes[key];
      if (node === null || node === undefined) continue;
      const over = node.scrollWidth - node.clientWidth;
      if (over > tolPx) {
        add(
          "horizontal-clip",
          sc.id,
          key,
          `${label}${sel(key)} 内有 ${over}px 内容被裁切(overflow-x:hidden,scrollWidth=${node.scrollWidth} > clientWidth=${node.clientWidth})`,
          { expected: `scrollWidth<=clientWidth+${tolPx}`, actual: String(over) },
        );
      }
    }

    // 紧凑/半屏档免滚动:舞台区纵向溢出须在预算内
    if (sc.compact === true) {
      const node = sample.nodes[SCROLL_KEY];
      if (node !== null && node !== undefined) {
        const over = node.scrollHeight - node.clientHeight;
        if (over > scrollBudgetPx) {
          add(
            "compact-scroll",
            sc.id,
            SCROLL_KEY,
            `${label}${sc.viewport.join("×")} 下舞台区出现纵向滚动 ${over}px(scrollHeight=${node.scrollHeight} > clientHeight=${node.clientHeight},预算 ${scrollBudgetPx}px);契约见 drop.css .stage 高度 min(100%, 设计高)`,
            { expected: `scrollHeight<=clientHeight+${scrollBudgetPx}`, actual: String(over) },
          );
        }
      }
    }

    // 固定槽:常驻占位节点必须落在 [minHeight, maxHeight?] 区间内
    // (下限防塌陷;上限用于「固定槽被撑爆/退化为自适应」——消息区改为 height:auto
    //  或结果汇总撑高时,高度会冲出上限,这条正是「恢复固定槽」的守护)
    for (const slot of SLOT_INVARIANTS) {
      const node = sample.nodes[slot.node];
      if (node === null || node === undefined || !node.visible) continue;
      if (node.rect.height < slot.minHeight) {
        add(
          "slot-collapsed",
          sc.id,
          slot.node,
          `${label}固定槽 ${slot.node}(${sel(slot.node)}) 高度 ${node.rect.height}px 低于下限 ${slot.minHeight}px;${slot.why}`,
          { expected: `height>=${slot.minHeight}`, actual: String(node.rect.height) },
        );
      }
      if (slot.maxHeight !== undefined && node.rect.height > slot.maxHeight) {
        add(
          "slot-overflow",
          sc.id,
          slot.node,
          `${label}固定槽 ${slot.node}(${sel(slot.node)}) 高度 ${node.rect.height}px 超出上限 ${slot.maxHeight}px(固定槽被内容撑高/退化为自适应);${slot.why}`,
          { expected: `height<=${slot.maxHeight}`, actual: String(node.rect.height) },
        );
      }
    }

    // 列轴对齐:队列列组内互齐、纸面脚注列与纸面内容盒齐,且都不得越出纸面内容盒
    for (const group of sc.columnAxis ?? []) {
      if (group.ref !== undefined) {
        const refNode = sample.nodes[group.ref];
        if (refNode === null || refNode === undefined || !refNode.visible) {
          add(
            "column-missing",
            sc.id,
            group.ref,
            `${label}列组「${group.name}」的参照节点 ${group.ref}(${sel(group.ref)}) 不可用`,
          );
          continue;
        }
      }
      const paperNode = sample.nodes[PAPER_KEY];
      const paperBox =
        paperNode !== null && paperNode !== undefined && paperNode.visible ? paddingBox(paperNode) : null;
      // 上方已校验 ref 节点在场且可见,此处取盒安全(ref === undefined 即无参照盒)
      const refBox =
        group.ref === undefined
          ? null
          : nodeBox(/** @type {NodeSample} */ (sample.nodes[group.ref]), group.box);
      let firstBox = null;
      let firstKey = null;
      for (const key of group.members) {
        const node = sample.nodes[key];
        if (node === null || node === undefined || !node.visible) continue;
        const box = nodeBox(node, group.box);
        if (paperBox !== null && (box.left < paperBox.left - tolPx || box.right > paperBox.right + tolPx)) {
          add(
            "column-bleed",
            sc.id,
            key,
            `${label}${sel(key)} 越出纸面内容盒(左 ${box.left} vs ${paperBox.left},右 ${box.right} vs ${paperBox.right});列组「${group.name}」`,
            { expected: `[${paperBox.left}, ${paperBox.right}]`, actual: `[${box.left}, ${box.right}]` },
          );
        }
        const target = refBox ?? firstBox;
        if (target === null) {
          firstBox = box;
          firstKey = key;
          continue;
        }
        const dLeft = Math.abs(box.left - target.left);
        const dWidth = Math.abs(box.width - target.width);
        if (dLeft > tolPx || dWidth > tolPx) {
          // target 非空 ⇒ 或 refBox 非空(此时 group.ref 必已定义),或已记下首个可用成员 firstKey
          const refKey = /** @type {string} */ (refBox !== null ? group.ref : firstKey);
          add(
            "column-drift",
            sc.id,
            key,
            `${label}列组「${group.name}」成员 ${sel(key)} 与参照 ${sel(refKey)} 不齐` +
              `(左差 ${dLeft.toFixed(2)}px,宽差 ${dWidth.toFixed(2)}px;左 ${box.left} 宽 ${box.width} vs 左 ${target.left} 宽 ${target.width})`,
            {
              expected: `left=${target.left} width=${target.width}`,
              actual: `left=${box.left} width=${box.width}`,
            },
          );
        }
      }
    }

    // 设置抽屉:控件存在/可见/组归属/组内顺序/无裁切/门控显隐与分档可用性
    if (sc.drawerTab !== undefined) {
      judgeDrawerScenario(sc, sample, tolPx, (rule, node, message, extra) =>
        add(rule, sc.id, node, message, extra ?? {}),
      );
    }
  }

  // 恒定断言组:逐轴比对,超容差即"跳动"
  for (const group of CONSTANT_GROUPS) {
    const axes = group.axes ?? ["left", "top", "width", "height"];
    const baseSample = byId.get(group.baseline);
    const baseNode = baseSample === undefined ? undefined : baseSample.nodes[group.node];
    if (
      baseSample === undefined ||
      baseSample.error ||
      baseNode === null ||
      baseNode === undefined ||
      !baseNode.visible
    ) {
      add(
        "group-baseline-missing",
        group.baseline,
        group.node,
        `恒定组「${group.id}」的基准场景「${group.baseline}」缺少可用的 ${group.node}(${sel(group.node)}),整组判定跳过(本条已显式记录)`,
      );
      continue;
    }
    for (const id of group.members) {
      const sample = byId.get(id);
      const node = sample === undefined ? undefined : sample.nodes[group.node];
      if (sample === undefined || sample.error || node === null || node === undefined || !node.visible) {
        add(
          "group-member-missing",
          id,
          group.node,
          `恒定组「${group.id}」成员场景「${id}」缺少可用的 ${group.node}(${sel(group.node)}),该成员判定跳过(本条已显式记录)`,
        );
        continue;
      }
      const delta = rectDelta(baseNode.rect, node.rect, axes);
      if (delta.max > tolPx) {
        add(
          "geometry-jump",
          id,
          group.node,
          `恒定组「${group.id}」成员「${id}」相对基准「${group.baseline}」${axes.join("/")} 跳动 ${delta.max.toFixed(2)}px` +
            `(轴:${delta.prop};${formatRect(baseNode.rect)} -> ${formatRect(node.rect)});${group.why}`,
          {
            expected: formatRect(baseNode.rect),
            actual: formatRect(node.rect),
            group: group.id,
            axes: axes.join("/"),
          },
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    stats: {
      scenarios: SCENARIOS.length,
      samples: samples.length,
      groups: CONSTANT_GROUPS.length,
      findings: findings.length,
      tolPx,
      scrollBudgetPx,
      mediaConditions: mediaConditions.length,
      /** 参与抽屉判定的场景数与被抽屉判据覆盖的控件数(步 03-0 的护栏规模,报告里可见) */
      drawerScenarios: SCENARIOS.filter((s) => s.drawerTab !== undefined).length,
      drawerControls: DRAWER_CONTROL_KEYS.length,
    },
    /** 供日志打印:已采样且无步骤失败的场景 id */
    passedScenarios: SCENARIOS.map((s) => s.id).filter((id) => {
      const s = byId.get(id);
      return s !== undefined && !s.error;
    }),
  };
}

/* ══════════════ CSS 令牌恒等判定(取消态不得被读成成功绿 / 失败红) ══════════════
   纯函数,零 DOM / 零 Electron / 零 IO:输入页面侧探针的读数,输出 findings。
   与几何判定并列而非混入 runGeometryGate:它**不依赖任何场景样本**(与视口/档位无关),
   单独一个 worker 级读数即可裁决,故不塞进「按 SCENARIOS 逐条遍历」的主体里。 */

/**
 * 令牌恒等判定主入口(纯函数)。
 *
 * 每条规则同时要求三条成立,任一不成立即记 finding:
 *   A 三态互斥 —— canceled 既不等于 ok 也不等于 fail(ok===fail 也一并记,那说明
 *     成功/失败两态压根没分开,配色契约整体失效);
 *   B 中性区间 —— canceled 等于 expectedToken 的实算色;
 *   C 语义对立 —— canceled 不等于 forbiddenTokens 里任何一根的实算色。
 *
 * **防恒真**:C 与 A 看似重复(成功绿既是 ok 态色也是 forbidden 色),但 C 是**逐根点名**,
 * 独立于三态 —— 若某天 ok/fail 态类名被改掉、A 因「三态两两不等」而侥幸通过,C 仍会
 * 按令牌名逮住「取消态被读成 --ok」。两条都在,恒真要同时骗过它们才算骗过。
 *
 * @param {CssTokenReading[]} readings 页面侧探针读数
 * @returns {{ ok: boolean, findings: GeometryFinding[], stats: object }} 裁决结果
 */
export function judgeCssTokens(readings) {
  /** @type {GeometryFinding[]} */
  const findings = [];
  /**
   * @param {string} rule 规则名
   * @param {string} message 失败消息
   * @param {string} [expected] 期望值
   * @param {string} [actual] 实测值
   * @returns {void}
   */
  const add = (rule, message, expected, actual) => {
    findings.push({
      rule: `css-token/${rule}`,
      severity: "error",
      // 与场景无关的规则:scenario 记 null,报告里据此知道它不挂在任何场景下
      scenario: "css-token-identity",
      node: null,
      message,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    });
  };

  const byName = new Map(readings.map((r) => [r.name, r]));
  // 表里有、读数里没有 = 探针漏项;读数里有、表里没有 = 表与探针漂移。两者都显式记 finding,
  // 禁止「少跑几条也判绿」—— 那正是这批判据从源文本正则迁出来的原因(旧判据恒真)。
  for (const rule of CSS_TOKEN_RULES) {
    const reading = byName.get(rule.name);
    if (reading === undefined) {
      add(rule.name, `令牌恒等判据「${rule.name}」没有读数(页面侧探针漏项);禁止少跑判据后判绿`);
      continue;
    }
    if (!reading.mountFound || reading.targetFound === false) {
      add(
        rule.name,
        `令牌恒等判据「${rule.name}」的目标节点在页面上取不到(锚点或被读色节点缺失,读数不可信);` +
          `不得以空串读数继续判色`,
        `锚点与被读色节点均存在`,
        reading.targetFound === false ? `被读色节点缺失(${rule.name})` : `锚点缺失(${rule.name})`,
      );
      continue;
    }
    const c = reading.colors;
    // 读数为空串 = 探针失效(取不到节点 / 属性名写错),不是「三态恰好同色」。
    // 不先拦掉它,空串会让下面 A-1/A-2/A-3 全部「命中」,把探针的错读成三条配色回归,
    // 报告把人引向完全错误的方向;先拦成一条明确的探针失败。
    const blankStates = /** @type {const} */ (["base", "ok", "fail", "canceled"]).filter(
      (s) => c[s].trim() === "" || reading.expected.trim() === "",
    );
    if (blankStates.length > 0) {
      add(
        rule.name,
        `令牌恒等判据「${rule.name}」读到空读数(${blankStates.join("/")});` +
          `探针未取到计算色(节点缺失或属性名非 dashed),本条按探针失效判红,不得当作配色回归`,
      );
      continue;
    }
    // A 三态互斥
    if (c.canceled === c.ok) {
      add(
        rule.name,
        `${rule.why};取消态被读成成功态同色(${reading.property} 实算相同)`,
        `canceled ≠ ok(${c.ok})`,
        `canceled = ok = ${c.canceled}`,
      );
    }
    if (c.canceled === c.fail) {
      add(
        rule.name,
        `${rule.why};取消态被读成失败态同色(${reading.property} 实算相同)`,
        `canceled ≠ fail(${c.fail})`,
        `canceled = fail = ${c.canceled}`,
      );
    }
    if (c.ok === c.fail) {
      add(
        rule.name,
        `${rule.why};成功态与失败态算出同一个颜色(配色语义未分开,后续比对都失去意义)`,
        `ok ≠ fail`,
        `ok = fail = ${c.ok}`,
      );
    }
    // B 中性区间
    if (c.canceled !== reading.expected) {
      add(
        rule.name,
        `${rule.why};取消态未落在中性区间(${reading.property} 不是中性令牌的实算色)`,
        reading.expected,
        c.canceled,
      );
    }
    // C 语义对立(逐根点名)
    for (const item of reading.forbidden) {
      if (c.canceled === item.color) {
        add(
          rule.name,
          `${rule.why};取消态被读成 ${item.token}(语义对立色)的实算色`,
          `canceled ≠ ${item.token}(${item.color})`,
          c.canceled,
        );
      }
    }
  }
  for (const reading of readings) {
    if (!CSS_TOKEN_RULES.some((rule) => rule.name === reading.name)) {
      add(
        reading.name,
        `令牌恒等读数「${reading.name}」不在 CSS_TOKEN_RULES 表里(规格与探针漂移)`,
        "读数项均登记在案",
        "存在未登记读数",
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    stats: {
      rules: CSS_TOKEN_RULES.length,
      readings: readings.length,
      findings: findings.length,
    },
  };
}
