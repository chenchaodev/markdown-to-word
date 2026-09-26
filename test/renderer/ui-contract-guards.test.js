// @ts-check
/**
 * 阶段 4 视觉/无障碍契约守护段(纯静态断言,零 DOM / 零 Electron):
 *
 * (1) 令牌完整性:四份样式(base/drop/dialogs/about)里出现的每个 var(--x)
 *     都必须在 base.css(或 about.html 自带令牌块)里定义 —— 未定义令牌在运行时
 *     静默失效(曾经就有 --text-2 这种「写了但从不存在」的颜色)。
 * (2) 固定消息槽:--feed-h 令牌在常规档/矮窗档都存在,.feed 用它锁高
 *     而不是 height:auto(几何恒定契约的一半;另一半在 geometry gate)。
 * (3) 对比度:按 WCAG 相对亮度公式实算两套主题的关键配对(弱化文字、朱砂文字、
 *     成功色),阈值 4.5:1 —— 改色即重算,不必等人工目检。
 * (4) 视觉债回归:脉冲只属主按钮、完成态不呼吸、队列无卡壳、向导源行三列网格。
 * (5) 无障碍静态契约:设置 Tab 的 tablist/tab/tabpanel 双向关联、错误节点 role=alert
 *     + aria-controls、开关的 aria-labelledby/describedby、进度条 valuetext/describedby、
 *     状态行 role/aria-atomic、index.html 内所有 label[for] 均有对应 id。
 * (6) about 窗:自带令牌覆盖 = 自带引用、双来源深色(data-theme 优先 + 系统兜底)、
 *     降低动态效果全局块。
 * (7) geometry 规格:消息槽的高度区间与三档恒定组都在表里。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`ui-contract-guards 断言失败:${msg}`);
}

/**
 * 取正则捕获组(缺失即断言失败,避免后续断言在 undefined 上静默失真)。
 * @param {RegExpExecArray} match
 * @param {number} index
 * @returns {string}
 */
function capture(match, index) {
  const value = match[index];
  assert(value !== undefined, `正则第 ${index} 个捕获组缺失`);
  return value;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const read = (/** @type {string[]} */ ...rel) => fs.readFileSync(path.join(repoRoot, ...rel), "utf8");

const STYLE_DIR = ["src", "renderer", "style"];
/** 去注释后再做规则/令牌解析:注释里出现的选择器与令牌名(如「见 .feed)」)不是声明 */
const stripComments = (/** @type {string} */ css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const baseCss = stripComments(read(...STYLE_DIR, "base.css"));
const dropCss = stripComments(read(...STYLE_DIR, "drop.css"));
const dialogsCss = stripComments(read(...STYLE_DIR, "dialogs.css"));
const indexHtml = read("src", "renderer", "index.html");
const aboutHtml = read("src", "renderer", "about.html");

/* ---------------- 颜色工具(WCAG 2.x 相对亮度 / 对比度 / alpha 合成) ---------------- */

/**
 * 颜色通道值。
 * @typedef {{ r: number, g: number, b: number, a: number }} RgbColor
 */

/**
 * 解析 #rgb/#rrggbb/rgb()/rgba() 为通道值(不可解析返回 null,由调用方按「缺色即红」处理)。
 * @param {string} value
 * @returns {RgbColor | null}
 */
function parseColor(value) {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const digits = capture(hex, 1);
    const s = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba) {
    const parts = capture(rgba, 1).split(/[,/]/).map((/** @type {string} */ p) => p.trim());
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts[3] === undefined ? 1 : Number(parts[3]),
    };
  }
  return null;
}

/**
 * 单通道线性化(WCAG 2.x)。
 * @param {number} v
 * @returns {number}
 */
function channelLuminance(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 相对亮度。
 * @param {RgbColor} color
 * @returns {number}
 */
function relativeLuminance(color) {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

/** alpha 合成:半透明令牌(--acc-soft)落到不透明底(--card)上后的实际观感色 */
/**
 * alpha 合成:半透明令牌(--acc-soft)落到不透明底(--card)上后的实际观感色
 * @param {RgbColor} fg
 * @param {RgbColor} bg
 * @returns {RgbColor}
 */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/**
 * 两色对比度(WCAG 相对亮度公式);输入为 CSS 颜色文本,不可解析即断言失败。
 * @param {string | undefined} fg
 * @param {string | undefined} bg
 * @returns {number}
 */
function contrast(fg, bg) {
  const a = relativeLuminance(over(colorOf(fg, "前景色"), colorOf(bg, "背景色")));
  const b = relativeLuminance(colorOf(bg, "背景色"));
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 取可解析颜色(令牌缺失或格式不认识即断言失败,避免对比度计算静默失真)。
 * @param {string | undefined} value
 * @param {string} label
 * @returns {RgbColor}
 */
function colorOf(value, label) {
  const color = parseColor(value ?? "");
  assert(color, `${label} 不是可解析颜色:${JSON.stringify(value)}`);
  return color;
}

/** 取某个选择器块内的自定义属性(name → 原始值) */
/**
 * @param {string} css
 * @param {string} selector
 * @returns {Map<string, string>}
 */
function tokensIn(css, selector) {
  const at = css.indexOf(selector);
  assert(at >= 0, `样式表里找不到令牌块「${selector}」`);
  const open = css.indexOf("{", at);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(capture(m, 1), capture(m, 2).trim());
  }
  return map;
}

/** 取 @media 条件内某个选择器块的令牌(用于系统深色兜底块) */
/**
 * @param {string} css
 * @param {string} mediaCondition
 * @param {string} selector
 * @returns {Map<string, string>}
 */
function tokensInMedia(css, mediaCondition, selector) {
  const at = css.indexOf(`@media ${mediaCondition}`);
  assert(at >= 0, `样式表里找不到媒体查询「@media ${mediaCondition}」`);
  const rest = css.slice(at);
  const rel = tokensIn(rest, selector);
  assert(rel.size > 0, `媒体查询 ${mediaCondition} 内的 ${selector} 未定义任何令牌`);
  return rel;
}

/* ---------------- 断言辅助 ---------------- */

/** 取规则体:{选择器} { ... }(取第一个匹配块) */
/**
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function ruleBody(css, selector) {
  const at = css.indexOf(selector);
  assert(at >= 0, `找不到规则「${selector}」`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`规则「${selector}」缺少闭合花括号`);
}

/**
 * @param {string} css
 * @returns {Set<string>}
 */
function definedVarNames(css) {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => capture(m, 1)));
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /* ---------- 1. 令牌完整性:引用了就得定义 ---------- */
  // 1a. 主窗三份样式:每个 var(--x) 要么在 base.css 定义,要么自带兜底值
  const baseVars = definedVarNames(baseCss);
  /** @type {[string, string][]} */
  const STYLE_SOURCES = [
    ["base.css", baseCss],
    ["drop.css", dropCss],
    ["dialogs.css", dialogsCss],
  ];
  for (const [name, css] of STYLE_SOURCES) {
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/g)) {
      const token = capture(m, 1);
      const hasFallback = capture(m, 2).trim().startsWith(",");
      assert(
        baseVars.has(token) || hasFallback,
        `${name} 引用了未定义令牌 var(${token})${hasFallback ? "(虽有兜底值,但 base.css 仍应定义)" : ""}`,
      );
    }
  }
  // 1b. about.html 不引样式表:引用的令牌必须在自己页面里定义
  const aboutStyleRaw = aboutHtml.slice(0, aboutHtml.indexOf("</style>"));
  const aboutStyle = stripComments(aboutStyleRaw);
  const aboutDefined = definedVarNames(aboutStyle);
  const aboutUsed = new Set([...aboutStyle.matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/g)].map((m) => capture(m, 1)));
  for (const token of aboutUsed) {
    assert(
      aboutDefined.has(token),
      `about.html 引用了未在本页定义的令牌 var(${token})(about 窗不引样式表,不会继承主窗令牌)`,
    );
  }
  assert(
    !/var\(--text-2\)/.test([baseCss, dropCss, dialogsCss, aboutHtml].join("\n")),
    "仍存在 var(--text-2):该令牌从未定义,行内单位等处会静默回落为继承色",
  );

  /* ---------- 2. 固定消息槽 ---------- */
  const rootTokens = tokensIn(baseCss, ":root");
  assert(rootTokens.get("--feed-h") === "96px", `--feed-h 常规档应为 96px,实际 ${rootTokens.get("--feed-h")}`);
  const shortFeed = tokensInMedia(baseCss, "(max-height: 640px)", ":root");
  assert(
    shortFeed.get("--feed-h") === "86px",
    `--feed-h 矮窗档(≤640)应为 86px,实际 ${shortFeed.get("--feed-h")}`,
  );
  const feedBody = ruleBody(baseCss, ".feed");
  assert(/height:\s*var\(--feed-h\)/.test(feedBody), `.feed 必须用 --feed-h 锁高,实际规则体:${feedBody}`);
  assert(
    !/height:\s*auto/.test(feedBody),
    ".feed 不得回退 height:auto(固定槽是几何恒定契约:状态行/结果汇总增减不得改写舞台与历史条预算)",
  );

  /* ---------- 3. 对比度(实算,两套主题) ---------- */
  const darkExplicit = tokensIn(baseCss, 'html[data-theme="dark"]');
  const darkSystem = tokensInMedia(baseCss, "(prefers-color-scheme: dark)", 'html:not([data-theme="light"])');
  assert(
    darkExplicit.get("--acc-ink") !== undefined && darkSystem.get("--acc-ink") !== undefined,
    "--acc-ink(朱砂文字色)必须在两处深色令牌块都定义",
  );
  /** @type {[string, Map<string, string>][]} */
  const THEMES = [
    ["light", rootTokens],
    ["dark", darkExplicit],
    ["dark@system", darkSystem],
  ];
  // 关键配对:弱化文字对次级面/卡面、次文对卡面、朱砂文字对卡面/次级面/朱砂软底、成功色对卡面
  /** @type {[string, string][]} */
  const PAIRS = [
    ["--mut", "--card-2"],
    ["--mut", "--card"],
    ["--ink-2", "--card"],
    ["--ink", "--canvas"],
    ["--acc-ink", "--card"],
    ["--acc-ink", "--card-2"],
    ["--ok", "--card"],
  ];
  for (const [themeName, tokens] of THEMES) {
    for (const [fg, bg] of PAIRS) {
      const fgValue = tokens.get(fg);
      const bgValue = tokens.get(bg);
      assert(fgValue && bgValue, `${themeName} 主题缺少 ${fg} 或 ${bg}`);
      const ratio = contrast(fgValue, bgValue);
      assert(
        ratio >= 4.5,
        `${themeName} 主题 ${fg}(${fgValue}) 对 ${bg}(${bgValue}) 仅 ${ratio.toFixed(2)}:1,低于 4.5:1`,
      );
    }
    // 朱砂文字落到 --acc-soft 软底上(错误块的真实底色):先合成再算
    const softBg = over(
      colorOf(tokens.get("--acc-soft"), `${themeName} --acc-soft`),
      colorOf(tokens.get("--card"), `${themeName} --card`),
    );
    const softHex = `#${[softBg.r, softBg.g, softBg.b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    const softRatio = contrast(tokens.get("--acc-ink"), softHex);
    assert(
      softRatio >= 4.5,
      `${themeName} 主题 --acc-ink 对 --acc-soft 软底(${softHex})仅 ${softRatio.toFixed(2)}:1,低于 4.5:1`,
    );
  }

  /* ---------- 4. 视觉债回归 ---------- */
  // 4a. 脉冲只属唯一付印主按钮(双脉冲:合并按钮也带光环 → 红不再专属付印)
  assert(
    /\.btn-primary\.pulse:not\(:disabled\)\s*\{[^}]*animation:\s*btn-pulse/.test(baseCss),
    "脉冲引导应限定在 .btn-primary.pulse(主按钮),不得回到 .btn.pulse 全局",
  );
  assert(
    !/\.btn\.pulse[^-][^{]*\{[^}]*animation:\s*btn-pulse/.test(baseCss),
    "仍有 .btn.pulse 宽泛选择器带 btn-pulse 动画(次级按钮会被一起点亮)",
  );
  // 4b. 完成态是确定结果:静态圆点,不呼吸(呼吸会被读成「还没结束」)
  const okDot = /\.status--ok::before\s*\{([^}]*)\}/.exec(baseCss);
  assert(okDot, "找不到 .status--ok::before 规则");
  const okDotBody = capture(okDot, 1);
  assert(
    !/animation/.test(okDotBody),
    `.status--ok::before 不应带动画(完成态确定),实际:${okDotBody}`,
  );
  // 4c. 队列不再套卡壳(纸面上再嵌一张卡,层级多一层)
  const listcardBody = ruleBody(dropCss, ".listcard");
  assert(
    !/border(-radius)?\s*:/.test(listcardBody),
    `.listcard 不应再自带边线/圆角(队列行直接排在纸面上),实际:${listcardBody}`,
  );
  // 4d. 向导合并源行是三列(直接套主队列四列会把文件名挤进序号列)
  const wizardRow = /\.wizard-body \.mlist \.multi-item\s*\{([^}]*)\}/.exec(dialogsCss);
  assert(wizardRow, "dialogs.css 缺少 .wizard-body .mlist .multi-item 三列网格规则");
  const wizardRowBody = capture(wizardRow, 1);
  assert(
    /grid-template-columns:\s*22px minmax\(0, 1fr\) auto/.test(wizardRowBody),
    `向导源行应收敛为三列(序号 + 文件名 + 操作),实际:${wizardRowBody}`,
  );

  /* ---------- 5. 无障碍静态契约(index.html) ---------- */
  // 5a. 设置分组 = 标准 tablist/tab/tabpanel,双向关联
  assert(/<nav class="settings-tabs"[^>]*role="tablist"/s.test(indexHtml), "设置分组导航缺 role=tablist");
  const tabs = [...indexHtml.matchAll(/<button[^>]*class="settings-tab[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert(tabs.length === 6, `设置分组应为 6 个 tab(抽屉六组),实际 ${tabs.length}`);
  const tabIds = new Set();
  for (const tag of tabs) {
    assert(/\brole="tab"/.test(tag), `分组按钮缺 role="tab":${tag}`);
    assert(/\btabindex="/.test(tag), `分组按钮缺 roving tabindex:${tag}`);
    const controls = /aria-controls="([^"]+)"/.exec(tag);
    const selected = /aria-selected="(true|false)"/.exec(tag);
    const id = /\bid="([^"]+)"/.exec(tag);
    assert(controls && selected && id, `分组按钮缺 aria-controls/aria-selected/id:${tag}`);
    const controlsId = capture(controls, 1);
    const tabId = capture(id, 1);
    assert(
      indexHtml.includes(`id="${controlsId}"`),
      `tab ${tabId} 的 aria-controls="${controlsId}"在页面上不存在对应面板`,
    );
    assert(
      indexHtml.includes(`aria-labelledby="${tabId}"`),
      `面板未通过 aria-labelledby 回指标签 ${tabId}`,
    );
    tabIds.add(tabId);
  }
  assert(
    (indexHtml.match(/role="tabpanel"/g) ?? []).length === 6,
    "设置面板应恰有 6 个 role=tabpanel",
  );
  // 5b. 字段错误:就地可见 + 可被读屏关联
  /** @type {[string, string | null][]} */
  const ERROR_NODES = [
    ["marginError", null], // 四格共享一条错误:不声明 aria-controls
    ["fontEastAsiaError", "fontEastAsia"],
    ["fontAsciiError", "fontAscii"],
    ["bodySizeError", "bodySizePt"],
    ["lineSpacingError", "lineSpacing"],
  ];
  for (const [id, controls] of ERROR_NODES) {
    const re = new RegExp(`<p id="${id}"[^>]*>`, "s");
    const m = re.exec(indexHtml);
    assert(m, `index.html 未找到字段错误节点 #${id}`);
    const errorTag = capture(m, 0);
    assert(/\brole="alert"/.test(errorTag), `字段错误节点 #${id} 缺 role="alert"(错误须即时播报)`);
    if (controls === null) {
      assert(
        !/aria-controls=/.test(errorTag),
        `#${id} 是共享型错误,不应声明 aria-controls(会假装指向某一个控件)`,
      );
      continue;
    }
    assert(
      new RegExp(`aria-controls="${controls}"`).test(errorTag),
      `#${id} 应声明 aria-controls="${controls}"(showFieldError 靠它回标 aria-invalid)`,
    );
    assert(
      new RegExp(`id="${controls}"[^>]*aria-describedby="${id}"`).test(indexHtml),
      `控件 #${controls} 应静态指向 aria-describedby="${id}"`,
    );
  }
  // 5c. 开关:标签与说明都是 span,必须显式关联(否则读屏只报「复选框」)
  for (const m of indexHtml.matchAll(/<input type="checkbox" id="([A-Za-z0-9]+)" class="switch-input"([^>]*)\/?>/g)) {
    const switchId = capture(m, 1);
    const labelled = /aria-labelledby="([^"]+)"/.exec(capture(m, 2));
    const described = /aria-describedby="([^"]+)"/.exec(capture(m, 2));
    assert(labelled, `开关 #${switchId} 缺 aria-labelledby`);
    assert(described, `开关 #${switchId} 缺 aria-describedby`);
    for (const [kind, ref] of [
      ["aria-labelledby", capture(labelled, 1)],
      ["aria-describedby", capture(described, 1)],
    ]) {
      assert(
        indexHtml.includes(`id="${ref}"`),
        `开关 #${switchId} 的 ${kind}="${ref}"指向的元素不存在`,
      );
    }
  }
  // 5d. 进度:进度条须有可读文本(纯百分比无信息量)并指向阶段播报位
  const track = /<div[^>]*id="progressTrack"[^>]*>/s.exec(indexHtml);
  assert(track, "index.html 未找到 #progressTrack");
  const trackTag = capture(track, 0);
  assert(/\brole="progressbar"/.test(trackTag), "#progressTrack 缺 role=progressbar");
  assert(/\baria-valuetext="/.test(trackTag), "#progressTrack 缺 aria-valuetext(百分比对读屏无信息量)");
  assert(
    /aria-describedby="status"/.test(trackTag),
    "#progressTrack 应经 aria-describedby 指向 #status(阶段文案播报位)",
  );
  // 5e. 状态行:错误走 alert(打断)、整句播报
  const status = /<p id="status"[^>]*>/.exec(indexHtml);
  assert(status, "index.html 未找到 #status");
  const statusTag = capture(status, 0);
  assert(/\brole="status"/.test(statusTag), "#status 缺 role=status(setStatus 按语义切 alert)");
  assert(/\baria-atomic="true"/.test(statusTag), "#status 缺 aria-atomic(整句播报,避免半截更新被漏读)");

  /* ---------- 6. index.html / about.html 的 label[for] 与 id 自洽 ---------- */
  /** @type {[string, string][]} */
  const PAGES = [
    ["index.html", indexHtml],
    ["about.html", aboutHtml],
  ];
  for (const [name, html] of PAGES) {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => capture(m, 1)));
    for (const m of html.matchAll(/\bfor="([^"]+)"/g)) {
      const target = capture(m, 1);
      assert(ids.has(target), `${name} 的 label[for="${target}"]没有对应控件(id 不存在)`);
    }
    // 引用完整性:aria-labelledby / describedby / controls 指向的 id 必须存在
    for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
      for (const m of html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))) {
        for (const ref of capture(m, 1).split(/\s+/).filter(Boolean)) {
          assert(ids.has(ref), `${name} 的 ${attr}="${ref}"指向的元素不存在`);
        }
      }
    }
  }

  /* ---------- 7. about 窗:主题与动效 ---------- */
  assert(
    /html\[data-theme="dark"\] \.about-root/.test(aboutStyle),
    "about.html 缺显式深色块(宿主写 data-theme 时应即刻跟随主窗主题)",
  );
  assert(
    /@media \(prefers-color-scheme: dark\)[\s\S]*\.about-root:not\(\[data-theme="light"\]\)/.test(aboutStyle),
    "about.html 缺系统深色兜底块(与主窗双来源口径一致)",
  );
  const reduceBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {4}\}/.exec(aboutStyle);
  assert(reduceBlock, "about.html 缺降低动效块");
  assert(
    /transition-duration:\s*0\.01ms\s*!important/.test(capture(reduceBlock, 1)),
    "about.html 的降动效块只关了钤印动画,未覆盖全局过渡(按钮/链接仍有动效)",
  );
  // 令牌与主窗同源:同名令牌值必须一致(冷灰纸 + 朱砂身份不得两窗分叉)
  const aboutLight = tokensIn(aboutStyle, ".about-root");
  for (const token of ["--canvas", "--card", "--ink", "--ink-2", "--mut", "--line", "--acc"]) {
    const main = (rootTokens.get(token) ?? "").toLowerCase().replace(/\s+/g, "");
    const about = (aboutLight.get(token) ?? "").toLowerCase().replace(/\s+/g, "");
    assert(main !== "" && about !== "", `${token} 在 base.css 或 about.html 缺失`);
    assert(
      main === about,
      `${token} 两窗取值不一致(base.css ${main} / about.html ${about});改色必须两边同改`,
    );
  }

  /* ---------- 8. geometry 规格:固定槽锁高已登记 ---------- */
  const { CONSTANT_GROUPS, SLOT_INVARIANTS } = await import("../tools/geometry/geometry-spec.mjs");
  const feedSlot = SLOT_INVARIANTS.find((s) => s.node === "feed");
  assert(feedSlot, "geometry 规格缺少消息区固定槽不变量");
  assert(feedSlot.minHeight > 30, "消息区固定槽下限过松(30px 拦不住塌陷)");
  assert(
    feedSlot.maxHeight !== undefined,
    "消息区固定槽缺上限:退化为 height:auto(撑高)时门禁不会判红",
  );
  for (const id of ["feed-slot-960", "feed-slot-880", "feed-slot-640"]) {
    const group = CONSTANT_GROUPS.find((g) => g.id === id);
    assert(group, `geometry 规格缺少恒定组 ${id}`);
    assert(group.node === "feed", `${id} 的节点应为 feed`);
    assert(
      (group.axes ?? []).join() === "height",
      `${id} 只应锁高度(axes:["height"]),实际 ${JSON.stringify(group.axes)}`,
    );
    assert(group.members.length >= 2, `${id} 至少要含两个状态,才能谈「恒定」`);
  }
}
