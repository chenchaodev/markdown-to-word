/**
 * 设置面板纯逻辑层直测(src/renderer/settings-logic.ts;批次 12 自 settings-panel.ts 抽出):
 * 零 DOM 依赖纯函数,经 dist/renderer/settings-logic.js 直接断言(Node 段,零 Electron API)。
 * 断言面(可验证事实,与抽取前行为逐一对应):
 * - validatePresetName:空名/纯空白 → 「请输入预设名称」;同名(trim 后比较)→
 *   「已存在同名预设,请换一个名称」;达上限(≥10 条)→ 「已达 10 个上限,请先删除」
 *   (文案含全角逗号);合法(含前后空白)→ null
 * - customPresetToTemplate:id = custom:{name} / name / hint「自定义预设」/ typography
 *   与 pageSetup 原引用映射
 * - allPresets:硬编码 3 项在前 + 自定义项追加末尾,自定义项转 custom: id
 * - customPresetNameFromId:custom: 前缀 → 名称;非自定义 → null;空名 → ""
 * - clampMargin:0/1000 边界保留、负数钳 0、超限钳 1000、小数保留
 * - resolvePresetSelection(批次 13 bug 回归):当前选中自定义预设且值=硬编码预设值时
 *   不被弹回;选中项不匹配/已删除 → 回退全局匹配;无匹配 → default;硬编码选中保持
 * - 批次 15(R2)新增:mergeSettingsWithDefaults(loadSettings 防御性合并)、
 *   resolvePresetHint(回填 hint 计算)、outputDirDisplayText(输出目录占位文案)、
 *   buildCustomPresetEntry(另存为预设快照)、removeCustomPresetByName(按名删除保序)、
 *   parseMarginValue(边距输入解析+钳制)、validateNumberRange(字号/行距范围校验)、
 *   settingsToControlValues(设置对象 → 控件回填值映射)
 * - B13 新增:mergeSettingsWithDefaults/settingsToControlValues 的 theme 字段、
 *   applyThemeOn(data-theme 属性应用纯函数:light/dark 设属性,system 移除属性)
 */
import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
} from "../../dist/core/settings/settings-defaults.js";
import {
  CUSTOM_PRESET_ID_PREFIX,
  allPresets,
  applyThemeOn,
  buildCustomPresetEntry,
  clampMargin,
  customPresetNameFromId,
  customPresetToTemplate,
  mergeSettingsWithDefaults,
  outputDirDisplayText,
  parseMarginValue,
  removeCustomPresetByName,
  resolvePresetHint,
  resolvePresetSelection,
  settingsToControlValues,
  validateNumberRange,
  validatePresetName,
} from "../../dist/renderer/settings-logic.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`settings-logic 断言失败:${msg}`);
}

const preset = (name) => ({ name, typography: {}, pageSetup: {} });

/** renderer 纯函数单测(纯 Node 段,零 Electron API) */
export async function run() {
  // ---------- validatePresetName ----------
  assert(
    validatePresetName("", []) === "请输入预设名称",
    "空名应返回「请输入预设名称」",
  );
  assert(
    validatePresetName("   ", []) === "请输入预设名称",
    "纯空白名应返回「请输入预设名称」",
  );
  assert(
    validatePresetName("我的模板", [preset("我的模板")]) === "已存在同名预设,请换一个名称",
    "同名应返回「已存在同名预设,请换一个名称」",
  );
  assert(
    validatePresetName(" 我的模板 ", [preset("我的模板")]) === "已存在同名预设,请换一个名称",
    "前后空白名与既有名 trim 后相同 → 应判同名",
  );
  const full = Array.from({ length: MAX_CUSTOM_PRESETS }, (_, i) => preset(`p${i}`));
  assert(
    validatePresetName("新模板", full) === `已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除`,
    `达上限应返回「已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除」(B6:全角逗号统一为半角)`,
  );
  assert(
    validatePresetName(" 新模板 ", full.slice(0, MAX_CUSTOM_PRESETS - 1)) === null,
    "未达上限且无同名 → null",
  );
  assert(validatePresetName("新模板", []) === null, "空列表合法 → null");
  console.log("[ok] validatePresetName:空名/纯空白/同名(trim 比较)/达上限文案/合法 → null 断言通过");

  // ---------- customPresetToTemplate ----------
  const typography = { fontAscii: "Arial", fontEastAsia: "宋体" };
  const pageSetup = { paper: "A4" };
  const tpl = customPresetToTemplate({ name: "我的模板", typography, pageSetup });
  assert(
    tpl.id === `${CUSTOM_PRESET_ID_PREFIX}我的模板` &&
      tpl.name === "我的模板" &&
      tpl.hint === "自定义预设",
    "customPresetToTemplate:id(custom: 前缀)/name/hint 应正确映射",
  );
  assert(tpl.typography === typography && tpl.pageSetup === pageSetup, "customPresetToTemplate:typography/pageSetup 应原引用映射");
  console.log("[ok] customPresetToTemplate:id= custom:name / name / hint / 原引用映射 断言通过");

  // ---------- allPresets ----------
  const combined = allPresets([preset("我的模板"), preset("简报二")]);
  assert(combined.length === TEMPLATE_PRESETS.length + 2, "allPresets:硬编码 + 自定义数量正确");
  for (let i = 0; i < TEMPLATE_PRESETS.length; i++) {
    assert(combined[i] === TEMPLATE_PRESETS[i], "allPresets:硬编码预设应原样在前");
  }
  assert(
    combined[TEMPLATE_PRESETS.length].id === `${CUSTOM_PRESET_ID_PREFIX}我的模板` &&
      combined[TEMPLATE_PRESETS.length + 1].id === `${CUSTOM_PRESET_ID_PREFIX}简报二`,
    "allPresets:自定义项应追加末尾且 id 带 custom: 前缀",
  );
  assert(allPresets([]).length === TEMPLATE_PRESETS.length, "allPresets:空自定义列表 → 仅硬编码 3 项");
  console.log("[ok] allPresets:硬编码在前 + 自定义追加(custom: id) + 空列表 断言通过");

  // ---------- customPresetNameFromId ----------
  assert(
    customPresetNameFromId(`${CUSTOM_PRESET_ID_PREFIX}我的模板`) === "我的模板",
    "custom: 前缀 → 名称",
  );
  assert(customPresetNameFromId(`${CUSTOM_PRESET_ID_PREFIX}`) === "", "custom: 前缀后空名 → 空串");
  assert(customPresetNameFromId("default") === null, "硬编码预设值 → null");
  assert(customPresetNameFromId("customxx") === null, "非前缀值 → null");
  console.log("[ok] customPresetNameFromId:前缀解析/空名/硬编码与无关值 → null 断言通过");

  // ---------- clampMargin ----------
  assert(clampMargin(0) === 0, "0 边界应保留");
  assert(clampMargin(1000) === 1000, "1000 边界应保留");
  assert(clampMargin(-5) === 0, "-5 应钳到 0");
  assert(clampMargin(1001) === 1000, "1001 应钳到 1000");
  assert(clampMargin(12.5) === 12.5, "区间内小数应保留");
  console.log("[ok] clampMargin:0/1000 边界保留、负数/超限钳制、小数保留 断言通过");

  // ---------- resolvePresetSelection(批次 13 bug 回归:自定义预设不被弹回硬编码项) ----------
  const paperTpl = TEMPLATE_PRESETS.find((p) => p.id === "paper");
  const paperLike = () => ({
    typography: { ...paperTpl.typography },
    pageSetup: { ...paperTpl.pageSetup },
  });
  const custom = { name: "同名", ...paperLike() }; // 值恰与「学术论文」预设全等

  // 1. 回归场景:自定义预设值=paper 预设值、当前选中该自定义 → 保持选中,不弹回 paper
  assert(
    resolvePresetSelection([custom], paperLike(), `${CUSTOM_PRESET_ID_PREFIX}同名`) ===
      `${CUSTOM_PRESET_ID_PREFIX}同名`,
    "值=paper 的自定义预设被选中时不应弹回硬编码 paper",
  );
  // 2. 当前选中与设置不匹配(设置=paper 值、选中 default)→ 回退全局匹配 → paper
  assert(
    resolvePresetSelection([custom], paperLike(), "default") === "paper",
    "选中项与设置不一致 → 回退全局匹配(paper)",
  );
  // 3. 当前选中对应预设不存在(已删除)→ 回退全局匹配
  assert(
    resolvePresetSelection([], paperLike(), `${CUSTOM_PRESET_ID_PREFIX}已删`) === "paper",
    "选中项已不存在 → 回退全局匹配",
  );
  // 4. 无任何匹配 → default
  const off = {
    typography: { ...paperTpl.typography, bodySizePt: 99 },
    pageSetup: { ...paperTpl.pageSetup },
  };
  assert(
    resolvePresetSelection([], off, "default") === "default",
    "无任何匹配 → 回退 default",
  );
  // 5. 硬编码预设正常选中(设置=paper 值、选中 paper → 保持 paper)
  assert(
    resolvePresetSelection([], paperLike(), "paper") === "paper",
    "硬编码选中且与设置一致 → 保持",
  );
  console.log("[ok] resolvePresetSelection:选中保持(不弹回)/回退全局匹配/已删回退/无匹配 default/硬编码保持 断言通过");

  // ---------- mergeSettingsWithDefaults(批次 15 R2:loadSettings 防御性合并) ----------
  assert(
    JSON.stringify(mergeSettingsWithDefaults(DEFAULT_SETTINGS)) === JSON.stringify(DEFAULT_SETTINGS),
    "完整设置应原样透传",
  );
  const partial = mergeSettingsWithDefaults({ format: "pdf", outputDir: "C:\\out" });
  assert(partial.format === "pdf" && partial.outputDir === "C:\\out", "显式字段应保留");
  assert(
    partial.pageSetup.paper === DEFAULT_SETTINGS.pageSetup.paper &&
      partial.typography.fontAscii === DEFAULT_SETTINGS.typography.fontAscii,
    "缺 pageSetup/typography 字段 → 默认值兜底",
  );
  assert(
    Array.isArray(partial.customPresets) && partial.customPresets.length === 0,
    "缺 customPresets → 默认空数组",
  );
  const merged = mergeSettingsWithDefaults({
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 99 },
    typography: { ...DEFAULT_SETTINGS.typography, bodySizePt: 20 },
  });
  assert(
    merged.pageSetup.marginTop === 99 &&
      merged.pageSetup.marginBottom === DEFAULT_SETTINGS.pageSetup.marginBottom,
    "pageSetup 部分字段合并(显式覆盖 + 默认兜底)",
  );
  assert(
    merged.typography.bodySizePt === 20 &&
      merged.typography.fontAscii === DEFAULT_SETTINGS.typography.fontAscii,
    "typography 部分字段合并(显式覆盖 + 默认兜底)",
  );
  assert(mergeSettingsWithDefaults({}).outputDir === "", "空对象 → 全默认(outputDir 空串)");
  // B13:theme 缺失 → 默认 system;显式值保留
  assert(
    mergeSettingsWithDefaults({}).theme === "system",
    "缺 theme → 默认 system(B13)",
  );
  assert(
    mergeSettingsWithDefaults({ theme: "dark" }).theme === "dark",
    "显式 theme=dark 应保留",
  );
  console.log("[ok] mergeSettingsWithDefaults:完整透传/显式字段保留/缺字段默认兜底/部分字段合并/theme 兜底 断言通过");

  // ---------- resolvePresetHint(批次 15 R2:回填 hint 计算) ----------
  const paperTplHint = TEMPLATE_PRESETS.find((p) => p.id === "paper").hint;
  const paperHint = resolvePresetHint([], "paper");
  assert(
    paperHint.isCustom === false && paperHint.hint === paperTplHint,
    "硬编码预设命中 → 其 hint + isCustom=false",
  );
  const customHint = resolvePresetHint([preset("我的模板")], `${CUSTOM_PRESET_ID_PREFIX}我的模板`);
  assert(
    customHint.isCustom === false && customHint.hint === "自定义预设",
    "自定义预设命中(allPresets 含 custom 项)→ 其 hint(customPresetToTemplate 生成)+ isCustom=false",
  );
  const unknownHint = resolvePresetHint([], "不存在的id");
  assert(
    unknownHint.isCustom === true && unknownHint.hint === "已微调,与模板预设不一致",
    "未知 id → 同自定义提示文案 + isCustom=true",
  );
  console.log("[ok] resolvePresetHint:硬编码命中/自定义/未知 id 文案与 isCustom 断言通过");

  // ---------- outputDirDisplayText(批次 15 R2:输出目录占位文案) ----------
  assert(outputDirDisplayText("C:\\out") === "C:\\out", "非空目录原样返回");
  assert(outputDirDisplayText("") === "与源文件相同目录", "空串 → 「与源文件相同目录」");
  console.log("[ok] outputDirDisplayText:非空原样/空串占位文案 断言通过");

  // ---------- buildCustomPresetEntry(批次 15 R2:另存为预设数据变换) ----------
  const srcSettings = {
    ...DEFAULT_SETTINGS,
    typography: { ...DEFAULT_SETTINGS.typography, bodySizePt: 14 },
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 30 },
  };
  const entry = buildCustomPresetEntry("我的模板", srcSettings);
  assert(
    entry.name === "我的模板" &&
      entry.typography.bodySizePt === 14 &&
      entry.pageSetup.marginTop === 30,
    "名称 + 排版/页面设置快照",
  );
  entry.typography.bodySizePt = 99;
  assert(srcSettings.typography.bodySizePt === 14, "快照深拷贝:改结果不影响源设置");
  console.log("[ok] buildCustomPresetEntry:名称/快照/深拷贝 断言通过");

  // ---------- removeCustomPresetByName(批次 15 R2:删除预设数据变换) ----------
  const list = [preset("a"), preset("b"), preset("c")];
  const removed = removeCustomPresetByName(list, "b");
  assert(
    JSON.stringify(removed.map((p) => p.name)) === JSON.stringify(["a", "c"]),
    "按名删除且保序",
  );
  assert(removeCustomPresetByName(list, "不存在").length === 3, "无匹配 → 原列表");
  assert(removeCustomPresetByName([], "a").length === 0, "空列表 → 空数组");
  console.log("[ok] removeCustomPresetByName:按名删除保序/无匹配/空列表 断言通过");

  // ---------- parseMarginValue(批次 15 R2:边距输入解析+钳制) ----------
  assert(parseMarginValue(12.5) === 12.5, "有限数 → 原值");
  assert(parseMarginValue(-5) === 0, "负数 → 钳 0");
  assert(parseMarginValue(1001) === 1000, "超上限 → 钳 1000");
  assert(parseMarginValue(NaN) === null, "NaN → null");
  assert(parseMarginValue(Infinity) === null, "Infinity → null");
  console.log("[ok] parseMarginValue:有限数钳制/NaN/Infinity → null 断言通过");

  // ---------- validateNumberRange(批次 15 R2:字号/行距范围校验) ----------
  assert(validateNumberRange(12, 8, 24) === true, "范围内 → true");
  assert(validateNumberRange(8, 8, 24) === true, "下边界 → true");
  assert(validateNumberRange(24, 8, 24) === true, "上边界 → true");
  assert(validateNumberRange(7.9, 8, 24) === false, "低于下限 → false");
  assert(validateNumberRange(24.1, 8, 24) === false, "高于上限 → false");
  assert(validateNumberRange(NaN, 8, 24) === false, "NaN → false");
  console.log("[ok] validateNumberRange:范围内/边界/越界/NaN 断言通过");

  // ---------- settingsToControlValues(批次 15 R2:设置对象 → 控件回填值映射) ----------
  const customSettings = {
    ...DEFAULT_SETTINGS,
    format: "pdf",
    pageSetup: {
      ...DEFAULT_SETTINGS.pageSetup,
      paper: "A3",
      orientation: "landscape",
      marginTop: 30.5,
    },
    typography: {
      ...DEFAULT_SETTINGS.typography,
      bodySizePt: 14,
      lineSpacing: 1.25,
      align: "justify",
    },
    afterConvert: "open",
    outputDir: "C:\\out",
  };
  const cv = settingsToControlValues(customSettings);
  assert(cv.paper === "A3" && cv.orientation === "landscape", "paper/orientation 映射");
  assert(
    cv.margins.marginTop === "30.5" &&
      cv.margins.marginBottom === String(DEFAULT_SETTINGS.pageSetup.marginBottom),
    "边距转字符串",
  );
  assert(cv.bodySizePt === "14" && cv.lineSpacing === "1.25", "字号/行距转字符串");
  assert(cv.alignJustify === true, "align=justify → checked=true");
  assert(cv.afterConvert === "open" && cv.format === "pdf", "afterConvert/format 映射");
  assert(cv.equationNumbering === true, "equationNumbering 映射(默认 true)");
  assert(cv.outputDirText === "C:\\out", "非空输出目录原样");
  const eqOffCv = settingsToControlValues({
    ...DEFAULT_SETTINGS,
    equationNumbering: false,
  });
  assert(eqOffCv.equationNumbering === false, "equationNumbering=false 应映射为 false");
  const leftCv = settingsToControlValues({
    ...DEFAULT_SETTINGS,
    typography: { ...DEFAULT_SETTINGS.typography, align: "left" },
  });
  assert(leftCv.alignJustify === false, "align=left → checked=false");
  const emptyDirCv = settingsToControlValues(DEFAULT_SETTINGS);
  assert(emptyDirCv.outputDirText === "与源文件相同目录", "空输出目录 → 占位文案");
  // B13:theme 映射(默认 system / 显式 dark)
  assert(emptyDirCv.theme === "system", "theme 默认映射为 system");
  const darkCv = settingsToControlValues({ ...DEFAULT_SETTINGS, theme: "dark" });
  assert(darkCv.theme === "dark", "theme=dark 应原样映射");
  console.log("[ok] settingsToControlValues:全字段映射/数值转字符串/align 判定/输出目录文案/theme 映射 断言通过");

  // ---------- applyThemeOn(B13:data-theme 属性应用,DOM 无关直测) ----------
  const makeTarget = () => {
    const calls = [];
    return {
      calls,
      setAttribute(name, value) { calls.push(["set", name, value]); },
      removeAttribute(name) { calls.push(["remove", name]); },
    };
  };
  // 显式 light/dark → 设 data-theme 属性
  for (const theme of ["light", "dark"]) {
    const target = makeTarget();
    applyThemeOn(target, theme);
    assert(
      target.calls.length === 1 &&
        target.calls[0][0] === "set" &&
        target.calls[0][1] === "data-theme" &&
        target.calls[0][2] === theme,
      `theme=${theme} 应设 data-theme="${theme}"`,
    );
  }
  // system → 移除 data-theme 属性(CSS @media prefers-color-scheme 接管)
  const sysTarget = makeTarget();
  applyThemeOn(sysTarget, "system");
  assert(
    sysTarget.calls.length === 1 &&
      sysTarget.calls[0][0] === "remove" &&
      sysTarget.calls[0][1] === "data-theme",
    "theme=system 应移除 data-theme 属性",
  );
  console.log("[ok] applyThemeOn:light/dark 设属性/system 移除属性 断言通过");
}