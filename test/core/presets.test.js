// @ts-check
/**
 * TEMPLATE_PRESETS / matchesPreset 契约单测:
 * - matchesPreset:预设与「自身数据构成的设置」自匹配;default 预设与 DEFAULT_SETTINGS
 *   匹配;微调任一排版/页面字段 → 不匹配;
 * - 值域契约:全部预设的 字号/行距/边距 落在范围常量(BODY_SIZE/LINE_SPACING/MARGIN)内
 *   (「预设值已定稿,勿改」的契约锚,防止改坏或越界);
 * - id 唯一性:模板下拉按 id 定位,重复 id 会串预设。
 * - 预设说明三语化:每个内置预设声明唯一 hintI18nKey 且三语字典均命中;
 *   hint 字段是字典缺键时的回退底(非空),且与 zh 键值逐字一致(免得两处各改一处)。
 * 注意:渲染侧保证「预设字段键完整」(TypeScript 结构类型),本段只断言值与匹配语义。
 */
import { LANGUAGES, DICT } from "../../dist/core/i18n/index.js";
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_SETTINGS,
  DEFAULT_WATERMARK,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM,
  MARGIN_MIN_MM,
} from "../../dist/core/settings/settings-defaults.js";
import { TEMPLATE_PRESETS, matchesPreset } from "../../dist/core/settings/presets.js";

/** @typedef {import("../../dist/core/settings/presets.js").TemplatePreset} TemplatePreset */
/** @typedef {import("../../dist/core/settings/settings-defaults.js").HeaderFooterSettings} HeaderFooterSettings */
/** @typedef {import("../../dist/core/settings/settings-defaults.js").WatermarkSettings} WatermarkSettings */

/**
 * 由预设排版 + 页面设置 + 完整交付链构成一份完整设置(其余字段取默认值)。
 * @param {string} id 预设 id
 * @param {Partial<typeof DEFAULT_SETTINGS>} [extra] 追加覆盖字段(微调场景)
 * @returns {typeof DEFAULT_SETTINGS} 完整设置
 */
function settingsFromPreset(id, extra) {
  const preset = TEMPLATE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`预设不存在: ${id}`);
  return {
    ...DEFAULT_SETTINGS,
    typography: { ...preset.typography },
    pageSetup: { ...preset.pageSetup },
    ...(preset.headerFooter ? { headerFooter: { ...preset.headerFooter } } : {}),
    ...(preset.watermark ? { watermark: { ...preset.watermark } } : {}),
    ...(preset.equationNumbering !== undefined
      ? { equationNumbering: preset.equationNumbering }
      : {}),
    ...(preset.breakBeforeH1 !== undefined
      ? { breakBeforeH1: preset.breakBeforeH1 }
      : {}),
    ...extra,
  };
}

/**
 * 断言辅助:统一报错格式(与 slug 段同风格)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} label 失败标签
 * @returns {void}
 */
function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} 断言失败: ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
  }
}

/** 三语字典视图(LANGUAGES 的 code 为 string,需经 Record 视图按语言码取值) */
const DICT_VIEW = /** @type {Record<string, Record<string, string>>} */ (DICT);

/**
 * 内置预设的 hintI18nKey 是必填契约(本段逐条断言其非空且唯一)。TemplatePreset 上
 * 它是可选属性(自定义预设可留空),故在拿它当字典索引前先收窄成 string,让「缺键」
 * 以断言失败的形式报出,而不是把 undefined 当索引塞进 Record 视图。
 * @param {TemplatePreset} preset 预设
 * @returns {string} 非空 i18n 键
 */
function hintKeyOf(preset) {
  const key = preset.hintI18nKey;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`预设 ${preset.id} 应声明非空 hintI18nKey`);
  }
  return key;
}

/**
 * 内置预设的「完整交付链」:headerFooter / watermark / equationNumbering /
 * breakBeforeH1 在 TemplatePreset 上均可选(仅内置预设携带,用户自定义预设不存),
 * 而本段断言的前提正是「每个内置预设都携带」。故先在一个守卫里把这四个字段
 * 收窄成必填再断言与读取 —— 缺失即以断言失败报出,而不是让 undefined 流进
 * `preset.watermark.text` 这类属性读取。
 * @param {TemplatePreset} preset 预设
 * @returns {{ headerFooter: HeaderFooterSettings, watermark: WatermarkSettings,
 *   equationNumbering: boolean, breakBeforeH1: boolean }} 交付链四字段(均必填)
 */
function deliveryChainOf(preset) {
  const { headerFooter, watermark, equationNumbering, breakBeforeH1 } = preset;
  if (!headerFooter) {
    throw new Error(`预设 ${preset.id} 携带 headerFooter 断言失败: false(期望 true)`);
  }
  if (!watermark) {
    throw new Error(`预设 ${preset.id} 携带 watermark 断言失败: false(期望 true)`);
  }
  if (equationNumbering === undefined) {
    throw new Error(`预设 ${preset.id} 携带 equationNumbering 断言失败: false(期望 true)`);
  }
  if (breakBeforeH1 === undefined) {
    throw new Error(`预设 ${preset.id} 携带 breakBeforeH1 断言失败: false(期望 true)`);
  }
  return { headerFooter, watermark, equationNumbering, breakBeforeH1 };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** TEMPLATE_PRESETS / matchesPreset 契约单测 */
export async function run() {
  // ---------- 预设数量与 id 唯一性(模板下拉按 id 定位) ----------
  assertEq(TEMPLATE_PRESETS.length, 6, "预设数量");
  const ids = new Set(TEMPLATE_PRESETS.map((p) => p.id));
  assertEq(ids.size, TEMPLATE_PRESETS.length, "预设 id 唯一");
  assertEq(
    TEMPLATE_PRESETS.every((p) => p.id && p.name && p.hint),
    true,
    "预设 id/name/hint 非空",
  );
  console.log(`[ok] 预设结构:${TEMPLATE_PRESETS.length} 个预设,id 唯一,name/hint 非空 断言通过`);

  // ---------- 预设说明三语化:hintI18nKey 契约(内置 6 预设必填 + 三语齐备) ----------
  const hintKeys = new Set();
  for (const preset of TEMPLATE_PRESETS) {
    // 收窄成 string 后再拿它做唯一性判定与字典索引(见 hintKeyOf 的说明)
    const hintKey = hintKeyOf(preset);
    assertEq(
      hintKeys.has(hintKey),
      false,
      `hintI18nKey 应唯一(重复:${hintKey})`,
    );
    hintKeys.add(hintKey);
    // hint 是字典缺键时的回退底:删掉/清空会让缺键语言退化成空提示
    assertEq(
      typeof preset.hint === "string" && preset.hint.length > 0,
      true,
      `预设 ${preset.id} hint 回退原文应非空`,
    );
    // 三语字典均须有该键(渲染层 presetHintText 据此取当前语言说明)
    for (const { code } of LANGUAGES) {
      // 字典键来自 i18n 注册表(动态字符串),静态结构类型无法收窄 → 显式字典视图
      const dict = DICT_VIEW[code];
      if (!dict) throw new Error(`i18n 字典缺少语言 ${code}`);
      const value = dict[hintKey];
      assertEq(
        typeof value === "string" && value.length > 0,
        true,
        `${code} 字典应含非空 ${hintKey}`,
      );
    }
    // zh 键值 = hint 回退原文(两处文案同源,任一处改动须同步,防 zh 显示与缺键回退漂移)
    const zhDict = /** @type {Record<string, string>} */ (DICT.zh);
    assertEq(
      zhDict[hintKey],
      preset.hint,
      `zh.${hintKey} 应与预设 ${preset.id} 的 hint 逐字一致`,
    );
  }
  assertEq(
    hintKeys.size,
    TEMPLATE_PRESETS.length,
    "hintI18nKey 键数应与预设数一致",
  );
  console.log(
    `[ok] 预设说明三语化:${TEMPLATE_PRESETS.length} 个内置预设均声明唯一 hintI18nKey,${LANGUAGES.map((l) => l.code).join("/")} 字典齐备,zh 键值 = hint 回退原文 断言通过`,
  );

  // ---------- 完整交付链:每个内置预设均携带 headerFooter/watermark/编号 ----------
  for (const preset of TEMPLATE_PRESETS) {
    // 四条「存在」断言 + 收窄合并在 deliveryChainOf 里(它逐条比对 undefined 后返回必填视图)
    const chain = deliveryChainOf(preset);
    // 交付链字段须为 sane 默认值(无 watermark、页眉=标题居中+页码)
    assertEq(
      chain.watermark.text,
      DEFAULT_WATERMARK.text,
      `预设 ${preset.id} watermark.text 默认空`,
    );
    assertEq(
      chain.headerFooter.headerMode,
      DEFAULT_HEADER_FOOTER.headerMode,
      `预设 ${preset.id} headerMode 默认`,
    );
  }
  console.log("[ok] 完整交付链:全部内置预设携带 headerFooter/watermark/equationNumbering/breakBeforeH1 断言通过");

  // ---------- 预设 → 设置合并:新字段等于预设值(数据层模拟 applyTemplatePreset) ----------
  for (const preset of TEMPLATE_PRESETS) {
    // 本段合并的就是 applyTemplatePreset 的形状;交付链四字段经守卫收窄后必填,
    // 故四处条件展开收敛成直接赋值(条件展开的存在性已被上一段的守卫断掉)
    const chain = deliveryChainOf(preset);
    const merged = {
      ...DEFAULT_SETTINGS,
      typography: { ...preset.typography },
      pageSetup: { ...preset.pageSetup },
      headerFooter: { ...chain.headerFooter },
      watermark: { ...chain.watermark },
      equationNumbering: chain.equationNumbering,
      breakBeforeH1: chain.breakBeforeH1,
    };
    assertEq(
      merged.equationNumbering,
      chain.equationNumbering,
      `合并 equationNumbering(${preset.id})`,
    );
    assertEq(
      merged.breakBeforeH1,
      chain.breakBeforeH1,
      `合并 breakBeforeH1(${preset.id})`,
    );
    assertEq(
      merged.headerFooter.headerMode,
      chain.headerFooter.headerMode,
      `合并 headerFooter(${preset.id})`,
    );
    assertEq(
      merged.watermark.text,
      chain.watermark.text,
      `合并 watermark(${preset.id})`,
    );
  }
  console.log("[ok] 预设→设置合并:新字段(equationNumbering/breakBeforeH1/headerFooter/watermark)等于预设值 断言通过");

  // ---------- matchesPreset:自匹配 + 默认设置匹配 + 微调不匹配 ----------
  for (const preset of TEMPLATE_PRESETS) {
    assertEq(
      matchesPreset(preset, settingsFromPreset(preset.id)),
      true,
      `matchesPreset 自匹配(${preset.id})`,
    );
  }
  // default 预设与 DEFAULT_SETTINGS 完全一致(默认模板 = 默认设置)
  const defaultPreset = TEMPLATE_PRESETS.find((p) => p.id === "default");
  // find() 带 undefined,而 matchesPreset 的首参要 TemplatePreset(默认模板的存在性
  // 是本段前提,不是被断言的行为)—— 与 settingsFromPreset 内 find 后的守卫同一口径。
  if (!defaultPreset) throw new Error("default 预设不存在");
  assertEq(
    matchesPreset(defaultPreset, DEFAULT_SETTINGS),
    true,
    "default 预设匹配 DEFAULT_SETTINGS",
  );
  // 微调任一字段 → 不匹配(排版侧代表:字号;页面侧代表:上边距)
  assertEq(
    matchesPreset(
      defaultPreset,
      settingsFromPreset("default", { typography: { ...DEFAULT_SETTINGS.typography, bodySizePt: 13 } }),
    ),
    false,
    "微调字号后不匹配",
  );
  assertEq(
    matchesPreset(
      defaultPreset,
      settingsFromPreset("default", { pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 30 } }),
    ),
    false,
    "微调上边距后不匹配",
  );
  // 完整交付链:headerFooter 被改 → 不匹配(预设定义了 headerFooter)
  assertEq(
    matchesPreset(
      defaultPreset,
      settingsFromPreset("default", {
        headerFooter: { ...DEFAULT_SETTINGS.headerFooter, headerMode: "none" },
      }),
    ),
    false,
    "改 headerFooter 后不匹配",
  );
  // watermark 被改 → 不匹配
  assertEq(
    matchesPreset(
      defaultPreset,
      settingsFromPreset("default", {
        watermark: { ...DEFAULT_SETTINGS.watermark, text: "机密" },
      }),
    ),
    false,
    "改 watermark 后不匹配",
  );
  // equationNumbering 被改 → 不匹配
  assertEq(
    matchesPreset(
      defaultPreset,
      settingsFromPreset("default", { equationNumbering: !DEFAULT_SETTINGS.equationNumbering }),
    ),
    false,
    "改 equationNumbering 后不匹配",
  );
  console.log("[ok] matchesPreset:全预设自匹配、default 匹配默认设置、微调任一字段(含交付链)不匹配 断言通过");

  // ---------- 值域契约:预设值落在范围常量内(改预设值时须同步本段) ----------
  for (const preset of TEMPLATE_PRESETS) {
    const { typography: t, pageSetup: p } = preset;
    if (t.bodySizePt < BODY_SIZE_MIN || t.bodySizePt > BODY_SIZE_MAX) {
      throw new Error(`预设 ${preset.id} 字号越界: ${t.bodySizePt}(范围 ${BODY_SIZE_MIN}-${BODY_SIZE_MAX})`);
    }
    if (t.lineSpacing < LINE_SPACING_MIN || t.lineSpacing > LINE_SPACING_MAX) {
      throw new Error(`预设 ${preset.id} 行距越界: ${t.lineSpacing}(范围 ${LINE_SPACING_MIN}-${LINE_SPACING_MAX})`);
    }
    const margins = [p.marginTop, p.marginBottom, p.marginLeft, p.marginRight];
    for (const margin of margins) {
      if (margin < MARGIN_MIN_MM || margin > MARGIN_MAX_MM) {
        throw new Error(`预设 ${preset.id} 边距越界: ${margin}(范围 ${MARGIN_MIN_MM}-${MARGIN_MAX_MM})`);
      }
    }
  }
  console.log(`[ok] 值域契约:${TEMPLATE_PRESETS.length} 个预设的字号/行距/四边距均在范围常量内 断言通过`);
}
