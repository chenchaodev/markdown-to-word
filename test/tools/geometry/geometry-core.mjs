// @ts-check
/**
 * geometry gate 判定层(纯函数,零 DOM / 零 Electron / 零 IO):
 * 规格从 geometry-spec 单源引入,本文件只负责「样本 → findings → ok」的裁决:
 *   1) 视口容纳、响应式档位生效、舞台状态生效、必需节点在场/可见;
 *   2) 水平溢出与 overflow-x:hidden 容器内的内容裁切;
 *   3) 紧凑/半屏档免滚动、固定槽不塌陷、列轴对齐与越界;
 *   4) 恒定断言组(阶段跳动)。
 *
 * 失败语义:缺场景 / 场景步骤失败 / 缺选择器 / 必需节点不可见 / 视口不匹配 /
 * 响应式档位未生效 / 舞台状态不匹配 / 水平溢出 / 水平裁切 / 槽塌陷 / 槽越界(撑高) /
 * 阶段跳动超阈值 / 紧凑档纵向滚动 / 列轴漂移,一律记 error 并使 ok=false;
 * 任何"跳过"都必须以 finding 形式显式出现,禁止静默通过。
 *
 * 判定全部为纯函数,采样由外部注入 —— 真实窗口采样见 scripts/check-geometry.mjs,
 * 合成样本负探针见 test/segments/geometry-gate.test.js。故门禁判定不依赖人工目检,
 * 判定逻辑本身可在无 Electron 环境下完整验证。
 */
import {
  CONSTANT_GROUPS,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  NODE_SELECTORS,
  PAPER_KEY,
  SCENARIOS,
  SCROLL_KEY,
  SLOT_INVARIANTS,
  STAGE_KEY,
  X_CLIP_KEYS,
  evaluateMediaCondition,
} from "./geometry-spec.mjs";

// 规格单源再导出:消费方(驱动脚本 / 测试段)只需从 geometry-core 引入即可拿到全部契约
export {
  CONSTANT_GROUPS,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  X_CLIP_KEYS,
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
 * @typedef {object} GeometrySample 单个场景的采样结果
 * @property {string} id 场景 id(与 SCENARIOS 对齐)
 * @property {{ width: number, height: number }} viewport 实际视口
 * @property {Record<string, boolean>} [tiers] 媒体查询条件的匹配态(页面侧 matchMedia 读出)
 * @property {{ scrollWidth: number, clientWidth: number, scrollHeight: number, clientHeight: number }} doc 文档滚动尺寸
 * @property {Record<string, NodeSample | null>} nodes 节点度量表(键见 NODE_SELECTORS)
 * @property {string | null} [error] 场景步骤失败原因(有则该场景几何判定跳过,本条显式记 finding)
 */

/**
 * @typedef {object} Box 列轴比对用的盒(padding box 或 border box)
 * @property {number} left
 * @property {number} right
 * @property {number} width
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
    //  或结果汇总撑高时,高度会冲出上限,这条正是 OPT-4.4 恢复固定槽的守护)
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
    },
    /** 供日志打印:已采样且无步骤失败的场景 id */
    passedScenarios: SCENARIOS.map((s) => s.id).filter((id) => {
      const s = byId.get(id);
      return s !== undefined && !s.error;
    }),
  };
}
