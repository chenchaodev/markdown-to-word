/**
 * TEMPLATE_PRESETS / matchesPreset 契约单测:
 * - matchesPreset:预设与「自身数据构成的设置」自匹配;default 预设与 DEFAULT_SETTINGS
 *   匹配;微调任一排版/页面字段 → 不匹配;
 * - 值域契约:全部预设的 字号/行距/边距 落在范围常量(BODY_SIZE/LINE_SPACING/MARGIN)内
 *   (「预设值已定稿,勿改」的契约锚,防止改坏或越界);
 * - id 唯一性:模板下拉按 id 定位,重复 id 会串预设。
 * 注意:渲染侧保证「预设字段键完整」(TypeScript 结构类型),本段只断言值与匹配语义。
 */
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
  TEMPLATE_PRESETS,
  matchesPreset,
} from "../../dist/core/settings/settings-defaults.js";

/** 由预设排版 + 页面设置 + 完整交付链构成一份完整设置(其余字段取默认值) */
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

/** 断言辅助:统一报错格式(与 slug 段同风格) */
function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} 断言失败: ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
  }
}

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

  // ---------- 完整交付链:每个内置预设均携带 headerFooter/watermark/编号 ----------
  for (const preset of TEMPLATE_PRESETS) {
    assertEq(
      preset.headerFooter !== undefined,
      true,
      `预设 ${preset.id} 携带 headerFooter`,
    );
    assertEq(
      preset.watermark !== undefined,
      true,
      `预设 ${preset.id} 携带 watermark`,
    );
    assertEq(
      preset.equationNumbering !== undefined,
      true,
      `预设 ${preset.id} 携带 equationNumbering`,
    );
    assertEq(
      preset.breakBeforeH1 !== undefined,
      true,
      `预设 ${preset.id} 携带 breakBeforeH1`,
    );
    // 交付链字段须为 sane 默认值(无 watermark、页眉=标题居中+页码)
    assertEq(
      preset.watermark.text,
      DEFAULT_WATERMARK.text,
      `预设 ${preset.id} watermark.text 默认空`,
    );
    assertEq(
      preset.headerFooter.headerMode,
      DEFAULT_HEADER_FOOTER.headerMode,
      `预设 ${preset.id} headerMode 默认`,
    );
  }
  console.log("[ok] 完整交付链:全部内置预设携带 headerFooter/watermark/equationNumbering/breakBeforeH1 断言通过");

  // ---------- 预设 → 设置合并:新字段等于预设值(数据层模拟 applyTemplatePreset) ----------
  for (const preset of TEMPLATE_PRESETS) {
    const merged = {
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
    };
    assertEq(
      merged.equationNumbering,
      preset.equationNumbering,
      `合并 equationNumbering(${preset.id})`,
    );
    assertEq(
      merged.breakBeforeH1,
      preset.breakBeforeH1,
      `合并 breakBeforeH1(${preset.id})`,
    );
    assertEq(
      merged.headerFooter.headerMode,
      preset.headerFooter.headerMode,
      `合并 headerFooter(${preset.id})`,
    );
    assertEq(
      merged.watermark.text,
      preset.watermark.text,
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
  assertEq(!!defaultPreset, true, "default 预设存在");
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
