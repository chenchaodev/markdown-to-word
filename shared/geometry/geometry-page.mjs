// @ts-check
/**
 * geometry gate 页面侧探针:构造注入 renderer 执行的度量脚本(纯函数,零 DOM/零 Electron)。
 *
 * 一次注入量全部受测节点(选择器表来自 geometry-spec 单源)+ 响应式档位状态 + 设置抽屉的
 * 控件清单,返回 JSON 字符串:视口、档位(matchMedia)、文档滚动尺寸、舞台状态、每个节点的
 * rect/可见性/盒/滚动尺寸,以及抽屉控件的存在性/文档序/所属分组/门控态。
 * 取不到的选择器显式返回 null —— 由判定层记 selector-missing error,不在页面侧静默吞掉。
 */
import { evaluateMediaCondition } from "./geometry-core.mjs";
import { drawerProbeSpec } from "./geometry-spec.mjs";

/** 数值归一:保留两位小数,避免亚像素抖动淹没 JSON 差异 */
const ROUND_FN = 'const r2 = (n) => Math.round(n * 100) / 100;';

/**
 * 构造度量脚本源码。
 *
 * 抽屉段**无条件**随行采集(参数取默认值):worker 只构建一次度量脚本供全部场景复用,
 * 按场景重建脚本就得改 worker 的采样循环(不在本门禁的可写面内),而抽屉那点度量很便宜
 * —— 每个控件一次 getBoundingClientRect。抽屉是否参与判定由判定层按场景的 drawerTab 决定。
 * @param {Record<string,string>} selectorMap key → CSS 选择器(geometry-core.NODE_SELECTORS)
 * @param {string[]} mediaConditions 需读出匹配态的媒体查询条件(来自 CSS 单源)
 * @param {object} [drawerSpec] 抽屉探针参数(缺省取规格单源 drawerProbeSpec)
 * @returns {string} 可直接交给 webContents.executeJavaScript 的表达式
 */
export function buildMeasureScript(selectorMap, mediaConditions = [], drawerSpec = drawerProbeSpec()) {
  const spec = JSON.stringify(selectorMap);
  const conds = JSON.stringify(mediaConditions);
  const drawerSpecJson = JSON.stringify(drawerSpec);
  return `(() => {
  const SPEC = ${spec};
  const CONDS = ${conds};
  const DRAWER = ${drawerSpecJson};
  ${ROUND_FN}
  const measure = (el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      rect: { left: r2(b.left), top: r2(b.top), right: r2(b.right), bottom: r2(b.bottom), width: r2(b.width), height: r2(b.height) },
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0,
      display: cs.display,
      dataStage: el.dataset ? (el.dataset.stage === undefined ? null : el.dataset.stage) : null,
      borderLeft: el.clientLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  };
  const nodes = {};
  for (const key of Object.keys(SPEC)) {
    const el = document.querySelector(SPEC[key]);
    nodes[key] = el === null ? null : measure(el);
  }
  const drawer = (() => {
    const out = { measured: 0, shellVisible: false, activeGroup: null, controls: {}, panels: {} };
    const shell = document.querySelector(DRAWER.shell);
    if (shell === null) return out;
    const shellBox = shell.getBoundingClientRect();
    out.shellVisible = getComputedStyle(shell).display !== 'none' && shellBox.width > 0 && shellBox.height > 0;
    const active = document.querySelector(DRAWER.activePanel);
    out.activeGroup = active === null ? null : (active.getAttribute('data-group') || null);
    const resolved = [];
    for (const entry of DRAWER.controls) {
      const members = Array.from(document.querySelectorAll(entry[1]));
      if (members.length === 0) { out.controls[entry[0]] = { found: false }; continue; }
      resolved.push([entry[0], members]);
    }
    for (const entry of resolved) {
      const members = entry[1];
      const el = members[0];
      const type = el.getAttribute('type') || '';
      const hit = type === 'radio' ? members.find((m) => m.checked === true) : undefined;
      const groupEl = el.closest('[data-group]');
      out.measured += 1;
      out.controls[entry[0]] = {
        found: true,
        group: groupEl === null ? null : (groupEl.getAttribute('data-group') || null),
        disabled: el.disabled === true,
        // radio 组记「组内有无选中 + 选中档位」:门控判据要读主控当前在哪一档,
        // 只看首个成员会把「checked 落在别的成员上」读成未选中
        checked: type === 'checkbox' ? el.checked === true : (type === 'radio' ? hit !== undefined : null),
        value: type === 'radio' ? (hit === undefined ? null : String(hit.value)) : null,
        ...measure(el),
      };
    }
    for (const entry of DRAWER.panels) {
      const el = document.querySelector(entry[1]);
      out.panels[entry[0]] = el === null ? null : measure(el);
    }
    return out;
  })();
  const de = document.documentElement;
  const tiers = {};
  for (const cond of CONDS) tiers[cond] = window.matchMedia(cond).matches;
  return JSON.stringify({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    tiers,
    doc: {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      scrollHeight: de.scrollHeight,
      clientHeight: de.clientHeight,
      bodyScrollWidth: document.body.scrollWidth,
    },
    nodes,
    drawer,
  });
})()`;
}

/**
 * 解析度量脚本返回值(页面返回 JSON 字符串)。
 * 解析失败一律抛错(由驱动记 scenario-failed),不返回半成品样本。
 * @param {unknown} raw 页面侧 executeJavaScript 的返回值
 * @returns {{ nodes: Record<string, object | null>, drawer?: object, viewport?: { width: number, height: number } }} 度量样本
 */
export function parseMeasureScript(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`度量脚本返回非字符串(实际 ${typeof raw});页面侧可能抛错`);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `度量脚本返回值不是合法 JSON:${err instanceof Error ? err.message : String(err)};返回片段 ${raw.slice(0, 200)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`度量脚本返回值缺少 nodes 字段:返回片段 ${String(raw).slice(0, 200)}`);
  }
  const sample = /** @type {{ nodes?: unknown }} */ (parsed);
  if (sample.nodes === undefined) {
    throw new Error(`度量脚本返回值缺少 nodes 字段:返回片段 ${String(raw).slice(0, 200)}`);
  }
  return /** @type {{ nodes: Record<string, object | null>, drawer?: object, viewport?: { width: number, height: number } }} */ (sample);
}

/**
 * 构造"视口与响应式档位均已到位"的等待表达式。
 * 高度维度媒体查询在隐藏窗口 setContentSize 之后会滞后一帧以上才重算(实测约 1s),
 * 只等 innerWidth/innerHeight 会量到上一档布局(实测 880 档首个场景量到 960 档的
 * --tbh / 历史标题条高度 / 动作栏高度),故把档位匹配态一并作为落定判据。
 * @param {[number, number]} viewport 目标视口 [宽, 高]
 * @param {string[]} [mediaConditions] 需一并判定的媒体查询条件(来自 CSS 单源)
 * @returns {string} 可直接交给 webContents.executeJavaScript 的表达式
 */
export function buildViewportSettledScript(viewport, mediaConditions = []) {
  const checks = [
    `Math.abs(window.innerWidth - ${viewport[0]}) <= 1`,
    `Math.abs(window.innerHeight - ${viewport[1]}) <= 1`,
    ...mediaConditions.map(
      (cond) =>
        `window.matchMedia(${JSON.stringify(cond)}).matches === ` +
        JSON.stringify(evaluateMediaCondition(cond, { width: viewport[0], height: viewport[1] })),
    ),
  ];
  return `(${checks.join(" && ")})`;
}

/** 冻结动效的注入脚本(隐藏窗口 CSS transition 时钟不推进,浮层 opacity 会冻在中间帧) */
export function buildFreezeAnimationScript() {
  return (
    'const s = document.createElement("style");' +
    's.id = "geo-freeze";' +
    's.textContent = "*,*::before,*::after{transition-duration:0.01ms!important;animation-duration:0.01ms!important}";' +
    'document.head.appendChild(s);'
  );
}

/**
 * 构造 CSS 令牌恒等探针脚本(取消态不得被读成成功绿 / 失败红)。
 *
 * 两种宿主(见 CSS_TOKEN_RULE.hostSelector / host):
 *   - **真实节点**:规则给了 hostSelector 就直接在它身上切态修饰类,读它的计算色,读完
 *     把类名原样复原。量到的就是用户眼前那个元素,不存在「替身与真身不等价」的问题。
 *   - **合成节点**:线上此刻不存在该节点时(批量条目静止态下一条都没有),按真实类名造一个
 *     插到锚点旁边(继承祖先上下文与线上一致),读完即摘。
 *
 * 两条踩过的坑(改动本函数前先读):
 *   ① `getPropertyValue` **只认 dashed 属性名**:传 "borderTopColor" 静默返回空串,不报错
 *     —— 判据会读到 "" 然后一路判红,看起来像配色坏了,实则是探针写错了。故 spec 里
 *     property 一律写 dashed。
 *   ② `document.createElement("svg")` 造的是 **HTML 命名空间**元素,不参与
 *     `.result-summary--ok .result-summary-icon` 这套类规则(实测替身量到绿、真图标量不到)。
 *     故图标那条必须走真实节点,不能造替身。
 *
 * 令牌实算色**过一遍浏览器**取(临时节点 color:var(--x) 后读 getComputedStyle),不直接读
 * getPropertyValue 的字面量 —— `--line` 浅色档写 #e2e2dc、深色档写 #2a2f38,字面量既比不过
 * border-top-color 的 rgb() 形态,也不随 data-theme / prefers-color-scheme 变。
 * @param {import("./geometry-spec.mjs").CssTokenRule[]} rules 令牌恒等判据表(单源)
 * @returns {string} 可直接交给 webContents.executeJavaScript 的表达式
 */
export function buildCssTokenScript(rules) {
  const spec = JSON.stringify(rules);
  return `(() => {
  const RULES = ${spec};
  const tokenColor = (token) => {
    const probe = document.createElement('span');
    probe.style.setProperty('color', 'var(' + token + ')');
    probe.style.setProperty('position', 'absolute');
    probe.style.setProperty('left', '-9999px');
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  };
  const out = [];
  for (const rule of RULES) {
    const host = rule.hostSelector === undefined
      ? document.createElement(rule.host.tag)
      : document.querySelector(rule.hostSelector);
    const mountFound = document.querySelector(rule.mount) !== null;
    if (rule.hostSelector === undefined) {
      host.className = rule.host.baseClass;
      const anchor = document.querySelector(rule.mount);
      if (anchor !== null && anchor.parentNode !== null) {
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
      } else {
        document.body.appendChild(host);
      }
    }
    // 真实宿主可能被改过类名(线上 hidden 等),切态前先把它当时的类名存下来作复原基线
    const baseClassName = host.className;
    const target = rule.targetSelector !== undefined
      ? document.querySelector(rule.targetSelector)
      : (rule.target === undefined
        ? host
        : (() => {
            const t = document.createElement(rule.target.tag);
            t.className = rule.target.baseClass;
            host.appendChild(t);
            return t;
          })());
    const colors = {};
    if (target === null) {
      // 被读色节点取不到:不猜不留空,交判定层记 finding(见 judgeCssTokens 的 readings 守卫)
      out.push({
        name: rule.name,
        property: rule.property,
        mountFound: false,
        targetFound: false,
        colors: { base: '', ok: '', fail: '', canceled: '' },
        expected: tokenColor(rule.expectedToken),
        forbidden: rule.forbiddenTokens.map((token) => ({ token, color: tokenColor(token) })),
      });
      if (rule.hostSelector === undefined) host.remove();
      continue;
    }
    for (const state of ['base', 'ok', 'fail', 'canceled']) {
      host.className = baseClassName;
      if (state !== 'base' && rule.states[state] !== undefined) host.classList.add(rule.states[state]);
      colors[state] = getComputedStyle(target).getPropertyValue(rule.property).trim();
    }
    // 复原:真实宿主把类名还原,合成宿主整棵摘掉 —— 探针不得给后续测量留痕
    if (rule.hostSelector === undefined) host.remove();
    else host.className = baseClassName;
    out.push({
      name: rule.name,
      property: rule.property,
      mountFound,
      targetFound: true,
      colors,
      expected: tokenColor(rule.expectedToken),
      forbidden: rule.forbiddenTokens.map((token) => ({ token, color: tokenColor(token) })),
    });
  }
  return JSON.stringify(out);
})()`;
}

/**
 * 解析令牌恒等探针返回值(页面返回 JSON 字符串)。
 * @param {unknown} raw 页面侧 executeJavaScript 的返回值
 * @returns {import("./geometry-core.mjs").CssTokenReading[]} 令牌读数(判定层输入)
 */
export function parseCssTokenScript(raw) {
  if (typeof raw !== "string") {
    throw new Error(`令牌恒等探针返回非字符串(实际 ${typeof raw});页面侧可能抛错`);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `令牌恒等探针返回值不是合法 JSON:${err instanceof Error ? err.message : String(err)};返回片段 ${raw.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`令牌恒等探针返回值不是数组;返回片段 ${String(raw).slice(0, 200)}`);
  }
  return /** @type {import("./geometry-core.mjs").CssTokenReading[]} */ (parsed);
}
