// @ts-check
/**
 * geometry gate 页面侧探针:构造注入 renderer 执行的度量脚本(纯函数,零 DOM/零 Electron)。
 *
 * 一次注入量全部受测节点(选择器表来自 geometry-core 单源)+ 响应式档位状态,返回 JSON 字符串:
 * 视口、档位(matchMedia)、文档滚动尺寸、舞台状态、每个节点的 rect/可见性/盒/滚动尺寸。
 * 取不到的选择器显式返回 null —— 由判定层记 selector-missing error,不在页面侧静默吞掉。
 */
import { evaluateMediaCondition } from "./geometry-core.mjs";

/** 数值归一:保留两位小数,避免亚像素抖动淹没 JSON 差异 */
const ROUND_FN = 'const r2 = (n) => Math.round(n * 100) / 100;';

/**
 * 构造度量脚本源码。
 * @param {Record<string,string>} selectorMap key → CSS 选择器(geometry-core.NODE_SELECTORS)
 * @param {string[]} mediaConditions 需读出匹配态的媒体查询条件(来自 CSS 单源)
 * @returns {string} 可直接交给 webContents.executeJavaScript 的表达式
 */
export function buildMeasureScript(selectorMap, mediaConditions = []) {
  const spec = JSON.stringify(selectorMap);
  const conds = JSON.stringify(mediaConditions);
  return `(() => {
  const SPEC = ${spec};
  const CONDS = ${conds};
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
  });
})()`;
}

/**
 * 解析度量脚本返回值(页面返回 JSON 字符串)。
 * 解析失败一律抛错(由驱动记 scenario-failed),不返回半成品样本。
 * @param {unknown} raw 页面侧 executeJavaScript 的返回值
 * @returns {{ nodes: Record<string, object | null>, viewport?: { width: number, height: number } }} 度量样本
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
  return /** @type {{ nodes: Record<string, object | null>, viewport?: { width: number, height: number } }} */ (sample);
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
