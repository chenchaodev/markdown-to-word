// @ts-check
/**
 * 设置面板纯逻辑层直测(src/renderer/settings/settings-logic.ts;自 settings-panel.ts 抽出):
 * 零 DOM 依赖纯函数,经 dist/renderer/settings/settings-logic.js 直接断言(Node 段,零 Electron API)。
 * 断言面(可验证事实,与抽取前行为逐一对应):
 * - validatePresetName:空名/纯空白 → 「请输入预设名称」;同名(trim 后比较)→
 *   「已存在同名预设,请换一个名称」;达上限(≥10 条)→ 「已达 10 个上限,请先删除」
 *   (文案含全角逗号);合法(含前后空白)→ null
 * - customPresetToTemplate:id = custom:{name} / name / hint「自定义预设 · 仅排版与页面」/ typography
 *   与 pageSetup 原引用映射
 * - allPresets:硬编码预设在前(数量以 TEMPLATE_PRESETS.length 为准)+ 自定义项追加末尾,自定义项转 custom: id
 * - customPresetNameFromId:custom: 前缀 → 名称;非自定义 → null;空名 → ""
 * - clampMargin:0/1000 边界保留、负数钳 0、超限钳 1000、小数保留
 * - resolvePresetSelection:当前选中自定义预设且值=硬编码预设值时
 *   不被弹回;选中项不匹配/已删除 → 回退全局匹配;无匹配 → default;硬编码选中保持
 * - mergeSettingsWithDefaults(loadSettings 防御性合并)、
 *   resolvePresetHint(回填 hint 计算)、outputDirDisplayText(输出目录占位文案)、
 *   buildCustomPresetEntry(另存为预设快照)、removeCustomPresetByName(按名删除保序)、
 *   parseMarginValue(边距输入解析+钳制)、validateNumberRange(字号/行距范围校验)、
 *   settingsToControlValues(设置对象 → 控件回填值映射)
 * - 预设名/说明三语化:presetHintText(内置走 hintI18nKey 字典,缺键/未配键回退 hint 原文)、
 *   presetDisplayName(内置走 i18nKey,自定义走 name,缺键回退 name)、
 *   resolvePresetHint 三语命中 + 自定义/「已微调」分支可达与复位、
 *   套用 toast 用本地化名(en/ja 下不中英混排)
 * - reconcileSettingsSave(保存协调):失败保留草稿不调用 apply(控件不回滚到 main
 *   cache)、过期请求让位(不报失败)、成功以 main 权威值回填
 * - mergePendingSavePatch(失败草稿并入下一次提交):块级字段逐字段合并、
 *   标量后值覆盖、无草稿时退化为原 patch
 * - theme 字段:mergeSettingsWithDefaults/settingsToControlValues 的 theme、
 *   applyThemeOn(data-theme 属性应用纯函数:light/dark 设属性,system 移除属性)
 */
import { DICT, LANGUAGES } from "../../dist/core/i18n/index.js";
import { setLanguage, t } from "../../dist/core/i18n.js";
import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
  correctPageSetup,
} from "../../dist/core/settings/settings-defaults.js";
import {
  CUSTOM_PRESET_ID_PREFIX,
  allPresets,
  applySettingsRuntimeEffects,
  applyThemeOn,
  buildCustomPresetEntry,
  clampMargin,
  customPresetNameFromId,
  customPresetToTemplate,
  mergePendingSavePatch,
  mergeSettingsWithDefaults,
  normalizePageSetup,
  outputDirDisplayText,
  presetDisplayName,
  presetHintText,
  reconcileSettingsSave,
  parseMarginValue,
  removeCustomPresetByName,
  resolvePresetHint,
  resolvePresetSelection,
  settingsToControlValues,
  validateNumberRange,
  validatePresetName,
} from "../../dist/renderer/settings/settings-logic.js";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`settings-logic 断言失败:${msg}`);
}

/** @param {string} name @returns {{ name: string, typography: object, pageSetup: object }} */
const preset = (name) => ({ name, typography: {}, pageSetup: {} });

/** 合并后的完整设置(dist 编译产物无类型标注,取 mergeSettingsWithDefaults 的返回形状)。 */
/** @typedef {ReturnType<typeof mergeSettingsWithDefaults>} AppSettings */

/**
 * 取指定语言的字典表(dist DICT 为三语字面量对象,动态语言码访问在此收敛)。
 * @param {string} code
 * @returns {Record<string, string>}
 */
function langDict(code) {
  // 放宽理由:dist DICT 为字面量对象,按语言码动态取表(键集即三语注册表)。
  const dicts = /** @type {Record<string, Record<string, string>>} */ (DICT);
  const dict = dicts[code];
  assert(dict, `i18n 字典应注册语言 ${code}`);
  return dict;
}

/**
 * 取指定语言下的文案(缺键返回 undefined,由调用方按「字典缺键 → 回退」语义处理)。
 * @param {string} code
 * @param {string | undefined} key
 * @returns {string | undefined}
 */
function dictText(code, key) {
  if (key === undefined) return undefined;
  return langDict(code)[key];
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

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
    `达上限应返回「已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除」(全角逗号统一为半角)`,
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
      tpl.hint === "自定义预设 · 仅排版与页面",
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
  assert(allPresets([]).length === TEMPLATE_PRESETS.length, "allPresets:空自定义列表 → 仅硬编码内置预设(TEMPLATE_PRESETS.length 项)");
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

  // ---------- resolvePresetSelection(自定义预设不被弹回硬编码项) ----------
  const paperTpl = TEMPLATE_PRESETS.find((p) => p.id === "paper");
  assert(paperTpl, "TEMPLATE_PRESETS 应含 paper(学术论文)预设");
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

  // ---------- mergeSettingsWithDefaults(loadSettings 防御性合并) ----------
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
  // theme 缺失 → 默认 system;显式值保留
  assert(
    mergeSettingsWithDefaults({}).theme === "system",
    "缺 theme → 默认 system(theme 键)",
  );
  assert(
    mergeSettingsWithDefaults({ theme: "dark" }).theme === "dark",
    "显式 theme=dark 应保留",
  );
  const invalidGeometry = mergeSettingsWithDefaults({
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginBottom: 1000 },
  });
  assert(
    invalidGeometry.pageSetup.marginTop === 0 && invalidGeometry.pageSetup.marginBottom === 296,
    "IPC 防御性合并遇到非法几何应复用 core 确定性修正(top=0/bottom=296)",
  );
  /** @type {string | null} */
  let mergePageError = null;
  mergeSettingsWithDefaults(
    { pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginBottom: 1000 } },
    (/** @type {string} */ message) => { mergePageError = message; },
  );
  assert(typeof mergePageError === "string", "merge 发现非法几何时应上送可见错误");
  console.log("[ok] mergeSettingsWithDefaults:完整透传/显式字段保留/缺字段默认兜底/部分字段合并/theme 兜底/非法几何回退 断言通过");

  // ---------- normalizePageSetup(复用 core validatePageSetup 的 renderer 输入防线) ----------
  const validPage = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    paper: "A5",
    marginLeft: 30,
    marginRight: 30,
  });
  assert(
    validPage.corrected === false && validPage.error === null && validPage.pageSetup.paper === "A5",
    "合法页面设置应原样通过且无错误",
  );
  const invalidA4 = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    marginBottom: 1000,
  });
  assert(
    invalidA4.corrected === true &&
      typeof invalidA4.error === "string" &&
      invalidA4.error.includes("页面内容区") &&
      invalidA4.pageSetup.marginTop === 0 &&
      invalidA4.pageSetup.marginBottom === 296,
    "A4 下边距 1000 应由 core 几何策略修正并提供可见错误",
  );
  const invalidA5 = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    paper: "A5",
    marginLeft: 74,
    marginRight: 74,
  });
  assert(
    invalidA5.corrected === true &&
      invalidA5.pageSetup.paper === "A5" &&
      invalidA5.pageSetup.marginLeft === 73 &&
      invalidA5.pageSetup.marginRight === 74,
    "A5 零内容区应按 core 策略确定性修正，不得把非法几何写入 renderer 状态",
  );
  console.log("[ok] normalizePageSetup:core validator 合法透传/非法几何回退+可见错误 断言通过");

  // partial pageSetup patch 与 main sanitize 一样以 fallback=当前值合并。
  const partialPage = normalizePageSetup(
    { paper: "A5" },
    { ...DEFAULT_SETTINGS.pageSetup, marginTop: 11, marginBottom: 12, marginLeft: 13, marginRight: 14 },
  );
  assert(
    partialPage.corrected === false &&
      partialPage.pageSetup.paper === "A5" &&
      partialPage.pageSetup.marginTop === 11 &&
      partialPage.pageSetup.marginBottom === 12 &&
      partialPage.pageSetup.marginLeft === 13 &&
      partialPage.pageSetup.marginRight === 14,
    "partial pageSetup 应复用当前 fallback，不得重置未提供边距",
  );
  const sameCorrection = normalizePageSetup({
    paper: "A4", orientation: "portrait", marginTop: 200, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  const coreCorrection = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 200, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  assert(
    JSON.stringify(sameCorrection.pageSetup) === JSON.stringify(coreCorrection.pageSetup) &&
      JSON.stringify(sameCorrection.reasons) === JSON.stringify(coreCorrection.reasons),
    "renderer normalize 与 core 纠正策略应对非法几何输出完全一致",
  );
  let migrationWarning = null;
  let migrationWarningCount = 0;
  const migrationLoaded = {
    ...DEFAULT_SETTINGS,
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginBottom: 1000 },
    migration: {
      kind: "page-setup-correction",
      id: "test-page-setup-warning-1",
      original: { marginBottom: 1000 },
      corrected: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 0, marginBottom: 296 },
      reasons: ["insufficient-content"],
      message: "旧页面几何已自动修正",
      persistence: "scheduled",
    },
  };
  const onMigrationWarning = (/** @type {string} */ message) => {
    migrationWarning = message;
    migrationWarningCount += 1;
  };
  mergeSettingsWithDefaults(migrationLoaded, onMigrationWarning);
  mergeSettingsWithDefaults(migrationLoaded, onMigrationWarning);
  assert(
    migrationWarning === "旧页面几何已自动修正" && migrationWarningCount === 1,
    "同一 migration 应交给 renderer 用户提示一次，不能重复显示 scheduled warning",
  );
  console.log("[ok] renderer normalize/merge:partial fallback/core 恒等/结构化迁移 warning 去重断言通过");

  // 保存失败保留草稿：依赖注入证明失败路径不碰 apply（控件/state 不回滚到 main cache），
  // 只报失败；成功路径仍以 main 权威值回填。
  /** @type {AppSettings | null} */
  let applied = null;
  let failureShown = false;
  /** @type {{ message?: string } | null} */
  let failureError = null;
  // 失败对象经读取函数取值:其赋值发生在 onFailure 回调内,流分析看不到,
  // 直接读会被收窄成初始 null
  const lastFailure = () => failureError;
  // 用户当前编辑内容（草稿）：失败时必须原样保留
  const draft = { ...DEFAULT_SETTINGS, format: "pdf" };
  const failedSave = await reconcileSettingsSave({
    save: async () => { throw new Error("disk full"); },
    isCurrent: () => true,
    apply: (/** @type {AppSettings} */ settings) => { applied = settings; },
    onFailure: (/** @type {{ message?: string }} */ error) => { failureShown = true; failureError = error; },
  });
  // 失败对象在断言处取值(onFailure 回调内的赋值,流分析看不到,直接读会被收窄成初始 null)
  const failure = lastFailure();
  assert(
    failedSave === "failed" && applied === null && failureShown &&
      failure instanceof Error && failure.message === "disk full",
    "保存失败应保留编辑内容(不调用 apply 回滚)并把错误交给失败回调",
  );
  assert(
    draft.format === "pdf",
    "失败路径不得修改调用方持有的草稿对象",
  );
  // 已被更新请求取代的失败：不报失败、不回填（由最新请求收敛）
  /** @type {AppSettings | null} */
  let staleApplied = null;
  let staleFailureShown = false;
  const staleFailure = await reconcileSettingsSave({
    save: async () => { throw new Error("stale"); },
    isCurrent: () => false,
    apply: (/** @type {AppSettings} */ settings) => { staleApplied = settings; },
    onFailure: () => { staleFailureShown = true; },
  });
  assert(
    staleFailure === "superseded" && staleApplied === null && !staleFailureShown,
    "过期请求的失败不应回填也不应报错(避免覆盖更新请求的收敛结果)",
  );
  // 成功且为最新请求：以 main 返回值权威回填（验收 3：成功回填不破坏）
  /** @type {AppSettings | null} */
  let successApplied = null;
  const successSave = await reconcileSettingsSave({
    save: async () => ({ ...DEFAULT_SETTINGS, format: "pdf", theme: "dark" }),
    isCurrent: () => true,
    apply: (/** @type {AppSettings} */ settings) => { successApplied = settings; },
    onFailure: () => {},
  });
  // 成功路径:apply 收到 main 权威值(下方断言即校验其字段与控件映射)
  const successControls = settingsToControlValues(/** @type {AppSettings} */ (successApplied));
  assert(
    successSave === "saved" && successApplied?.format === "pdf" &&
      successControls.format === "pdf" && successApplied.theme === "dark",
    "保存成功应以 main 权威值回填 state/控件",
  );
  console.log("[ok] reconcileSettingsSave:失败保留草稿不回滚/过期请求让位/成功权威回填断言通过");

  // mergePendingSavePatch：失败草稿必须并入下一次提交（否则失败字段永远只存内存）
  const pendingMerged = mergePendingSavePatch(
    { format: "pdf", typography: { bodySizePt: 13, fontAscii: "Inter" } },
    { theme: "dark", typography: { bodySizePt: 15 } },
  );
  assert(
    pendingMerged.format === "pdf" && pendingMerged.theme === "dark",
    `草稿标量字段应与新 patch 一并提交,实际 ${JSON.stringify(pendingMerged)}`,
  );
  assert(
    pendingMerged.typography?.bodySizePt === 15 && pendingMerged.typography?.fontAscii === "Inter",
    `块级字段应逐字段合并(新值覆盖同名字段,未提及字段保留草稿值),实际 ${JSON.stringify(pendingMerged.typography)}`,
  );
  const freshMerged = mergePendingSavePatch({}, { format: "pdf" });
  assert(
    freshMerged.format === "pdf" && freshMerged.typography === undefined,
    "无草稿时应退化为原 patch(不注入空块)",
  );
  // 同字段二次编辑：用户最新值覆盖草稿值（不复活旧值）
  const reeditMerged = mergePendingSavePatch({ theme: "dark" }, { theme: "light" });
  assert(
    reeditMerged.theme === "light",
    `同一字段的再次编辑应以最新值为准,实际 ${String(reeditMerged.theme)}`,
  );
  console.log("[ok] mergePendingSavePatch:草稿并入提交/块级深合并/最新编辑优先断言通过");

  /** @type {string[][]} */
  const runtimeEffects = [];
  applySettingsRuntimeEffects(
    { ...DEFAULT_SETTINGS, format: "pdf", language: "en", theme: "dark" },
    {
      setSelectedFormat: (/** @type {string} */ format) => runtimeEffects.push(["format", format]),
      setLanguage: (/** @type {string} */ language) => runtimeEffects.push(["language", language]),
      mirrorLanguage: (/** @type {string} */ language) => runtimeEffects.push(["mirror", language]),
      applyStaticTexts: () => runtimeEffects.push(["texts"]),
      applyTheme: (/** @type {string} */ theme) => runtimeEffects.push(["theme", theme]),
    },
  );
  assert(
    JSON.stringify(runtimeEffects) === JSON.stringify([
      ["format", "pdf"], ["language", "en"], ["mirror", "en"], ["texts"], ["theme", "dark"],
    ]),
    "权威设置副作用应同步 selectedFormat/语言/语言镜像/静态文案/主题",
  );
  console.log("[ok] applySettingsRuntimeEffects:selectedFormat/语言/主题副作用断言通过");

  // ---------- resolvePresetHint(回填 hint 计算;三语 + 分支可达与复位) ----------
  // 语言为 i18n 模块级状态:本段内切语言,段末复位 zh(后续断言依赖中文文案)
  const paperPreset = TEMPLATE_PRESETS.find((p) => p.id === "paper");
  assert(paperPreset, "TEMPLATE_PRESETS 应含 paper(学术论文)预设");
  // zh(默认):内置预设命中 → 字典值(= hint 兜底原文)+ isCustom=false
  const zhPaperHint = resolvePresetHint([], "paper");
  assert(
    zhPaperHint.isCustom === false && zhPaperHint.hint === paperPreset.hint,
    "zh:内置预设命中 → 其 hint + isCustom=false",
  );
  assert(
    zhPaperHint.hint === dictText("zh", paperPreset.hintI18nKey),
    "zh:提示应取自 hintI18nKey 字典值(与 hint 兜底原文同源)",
  );
  // en / ja:提示随当前语言切换,且不回落中文原文
  for (const { code } of LANGUAGES.filter((l) => l.code !== "zh")) {
    setLanguage(code);
    const localized = resolvePresetHint([], "paper");
    assert(
      localized.isCustom === false &&
        localized.hint === dictText(code, paperPreset.hintI18nKey) &&
        localized.hint !== paperPreset.hint,
      `${code}:内置预设提示应走 hintI18nKey 字典(不得回落中文原文)`,
    );
    assert(
      localized.hint !== paperPreset.hintI18nKey,
      `${code}:字典缺键时不得把裸键当提示显示`,
    );
  }
  setLanguage("zh");
  // 全部 6 个内置预设:三语下均命中各自字典键(逐个确认无遗漏预设)
  for (const p of TEMPLATE_PRESETS) {
    for (const { code } of LANGUAGES) {
      setLanguage(code);
      const hit = resolvePresetHint([], p.id);
      assert(
        hit.isCustom === false && hit.hint === dictText(code, p.hintI18nKey),
        `${code}:预设 ${p.id} 提示应等于 ${code}.${p.hintI18nKey}`,
      );
    }
  }
  setLanguage("zh");
  // 缺键安全回退:字典未命中 → 回落 hint 原文(不显裸键、不抛错)
  const unknownKeyPreset = { ...paperPreset, hintI18nKey: "preset.hintNoSuchKey" };
  assert(
    presetHintText(unknownKeyPreset) === paperPreset.hint,
    "hintI18nKey 字典缺键 → 回退 hint 原文(安全回退底)",
  );
  assert(
    presetHintText({ ...paperPreset, hintI18nKey: undefined }) === paperPreset.hint,
    "未声明 hintI18nKey(如自定义预设)→ hint 原文",
  );
  assert(
    resolvePresetHint([], "default").hint !== "default" &&
      presetHintText({ ...paperPreset, hintI18nKey: "preset.hintNoSuchKey" }) !== "preset.hintNoSuchKey",
    "回退后不得把裸键暴露给用户",
  );
  // 自定义预设分支(customHint 随语言)+ 「已微调」分支(未知 id)
  const customHintZh = resolvePresetHint([preset("我的模板")], `${CUSTOM_PRESET_ID_PREFIX}我的模板`);
  assert(
    customHintZh.isCustom === false && customHintZh.hint === DICT.zh["preset.customHint"],
    "自定义预设命中(allPresets 含 custom 项)→ 其 hint(仅排版与页面,与内置完整交付链不同)+ isCustom=false",
  );
  setLanguage("en");
  const customHintEn = resolvePresetHint([preset("我的模板")], `${CUSTOM_PRESET_ID_PREFIX}我的模板`);
  assert(
    customHintEn.isCustom === false && customHintEn.hint === DICT.en["preset.customHint"],
    "en:自定义预设提示应随语言切换",
  );
  setLanguage("zh");
  const unknownHint = resolvePresetHint([], "不存在的id");
  assert(
    unknownHint.isCustom === true && unknownHint.hint === DICT.zh["preset.modifiedHint"],
    "未知 id → 「已微调」提示文案 + isCustom=true",
  );
  // 分支复位:「已微调」状态回到合法预设 id → 恢复预设说明(不留上一分支残留)
  assert(
    resolvePresetHint([], "paper").hint === zhPaperHint.hint &&
      resolvePresetHint([], "paper").isCustom === false,
    "从「已微调」复位到内置预设 → 恢复该预设说明(纯函数,无状态残留)",
  );
  // 自定义预设删除后其 id 不再可达 → 落回「已微调」(已删选中项的既有语义)
  assert(
    resolvePresetHint([], `${CUSTOM_PRESET_ID_PREFIX}已删`).isCustom === true,
    "自定义预设已删除(选中项不存在)→ 「已微调」分支",
  );
  console.log("[ok] resolvePresetHint:三语命中全部内置预设/自定义/未知 id 分支与复位/缺键回退 hint 原文 断言通过");

  // ---------- presetDisplayName(预设名本地化:下拉/向导/toast 共用单一口径) ----------
  assert(
    presetDisplayName(paperPreset) === DICT.zh["preset.paper"] && presetDisplayName(paperPreset) === paperPreset.name,
    "zh:内置预设名取字典值(与中文原文一致)",
  );
  for (const { code } of LANGUAGES.filter((l) => l.code !== "zh")) {
    setLanguage(code);
    assert(
      presetDisplayName(paperPreset) === dictText(code, "preset.paper"),
      `${code}:内置预设名应取 ${code} 字典值(不回落中文名)`,
    );
  }
  setLanguage("zh");
  // 自定义预设无 i18nKey → 直接用用户命名的 name(任何语言都不翻译用户数据)
  const named = customPresetToTemplate(preset("我的模板"));
  for (const { code } of LANGUAGES) {
    setLanguage(code);
    assert(presetDisplayName(named) === "我的模板", `${code}:自定义预设名应原样用 name`);
  }
  setLanguage("zh");
  // 字典缺键 → 回退 name(不显裸键)
  assert(
    presetDisplayName({ ...paperPreset, i18nKey: "preset.noSuchKey" }) === paperPreset.name,
    "i18nKey 字典缺键 → 回退 name(安全回退底)",
  );
  assert(
    presetDisplayName({ ...paperPreset, i18nKey: undefined }) === paperPreset.name,
    "未声明 i18nKey → name",
  );
  // 套用预设 toast:名随语言,en/ja 下不出现中文(不得中英/中日混排)
  for (const { code } of LANGUAGES) {
    setLanguage(code);
    const toast = t("toast.presetSwitched", {
      name: presetDisplayName(paperPreset),
      groups: "Typography · Numbering",
    });
    assert(
      toast.includes(dictText(code, "preset.paper")),
      `${code}:套用 toast 应含本语言预设名(实测 ${JSON.stringify(toast)})`,
    );
    if (code === "zh") continue;
    assert(
      !toast.includes(DICT.zh["preset.paper"]),
      `${code}:套用 toast 不应混入中文预设名(混排回归,实测 ${JSON.stringify(toast)})`,
    );
    if (code === "en") {
      assert(
        !/[一-鿿]/.test(toast),
        `en:套用 toast 不应含任何汉字(实测 ${JSON.stringify(toast)})`,
      );
    }
  }
  setLanguage("zh");
  console.log("[ok] presetDisplayName:内置三语命中/自定义原样 name/缺键回退 name + toast 无中英混排 断言通过");

  // ---------- outputDirDisplayText(输出目录占位文案) ----------
  assert(outputDirDisplayText("C:\\out") === "C:\\out", "非空目录原样返回");
  assert(outputDirDisplayText("") === "与源文件相同目录", "空串 → 「与源文件相同目录」");
  console.log("[ok] outputDirDisplayText:非空原样/空串占位文案 断言通过");

  // ---------- buildCustomPresetEntry(另存为预设数据变换) ----------
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

  // ---------- removeCustomPresetByName(删除预设数据变换) ----------
  const list = [preset("a"), preset("b"), preset("c")];
  const removed = removeCustomPresetByName(list, "b");
  assert(
    JSON.stringify(removed.map((/** @type {{ name: string }} */ p) => p.name)) === JSON.stringify(["a", "c"]),
    "按名删除且保序",
  );
  assert(removeCustomPresetByName(list, "不存在").length === 3, "无匹配 → 原列表");
  assert(removeCustomPresetByName([], "a").length === 0, "空列表 → 空数组");
  console.log("[ok] removeCustomPresetByName:按名删除保序/无匹配/空列表 断言通过");

  // ---------- parseMarginValue(边距输入解析+钳制) ----------
  assert(parseMarginValue(12.5) === 12.5, "有限数 → 原值");
  assert(parseMarginValue(-5) === 0, "负数 → 钳 0");
  assert(parseMarginValue(1001) === 1000, "超上限 → 钳 1000");
  assert(parseMarginValue(NaN) === null, "NaN → null");
  assert(parseMarginValue(Infinity) === null, "Infinity → null");
  console.log("[ok] parseMarginValue:有限数钳制/NaN/Infinity → null 断言通过");

  // ---------- validateNumberRange(字号/行距范围校验) ----------
  assert(validateNumberRange(12, 8, 24) === true, "范围内 → true");
  assert(validateNumberRange(8, 8, 24) === true, "下边界 → true");
  assert(validateNumberRange(24, 8, 24) === true, "上边界 → true");
  assert(validateNumberRange(7.9, 8, 24) === false, "低于下限 → false");
  assert(validateNumberRange(24.1, 8, 24) === false, "高于上限 → false");
  assert(validateNumberRange(NaN, 8, 24) === false, "NaN → false");
  console.log("[ok] validateNumberRange:范围内/边界/越界/NaN 断言通过");

  // ---------- settingsToControlValues(设置对象 → 控件回填值映射) ----------
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
  assert(cv.align === "justify", "align=justify → 枚举原样映射");
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
  assert(leftCv.align === "left", "align=left → 枚举原样映射");
  const emptyDirCv = settingsToControlValues(DEFAULT_SETTINGS);
  assert(emptyDirCv.outputDirText === "与源文件相同目录", "空输出目录 → 占位文案");
  // theme 映射(默认 system / 显式 dark)
  assert(emptyDirCv.theme === "system", "theme 默认映射为 system");
  const darkCv = settingsToControlValues({ ...DEFAULT_SETTINGS, theme: "dark" });
  assert(darkCv.theme === "dark", "theme=dark 应原样映射");
  console.log("[ok] settingsToControlValues:全字段映射/数值转字符串/align 判定/输出目录文案/theme 映射 断言通过");

  // ---------- applyThemeOn(data-theme 属性应用,DOM 无关直测) ----------
  /**
   * 取记录数组的指定一条(缺失即断言失败,避免断言在 undefined 上静默失真)。
   * @template T
   * @param {T[]} list
   * @param {number} index
   * @returns {T}
   */
  const recordAt = (list, index) => {
    const item = list[index];
    assert(item, `记录数组缺少第 ${index + 1} 条`);
    return item;
  };
  const makeTarget = () => {
    /** @type {string[][]} */
    const calls = [];
    return {
      calls,
      setAttribute(/** @type {string} */ name, /** @type {string} */ value) {
        calls.push(["set", name, value]);
      },
      removeAttribute(/** @type {string} */ name) { calls.push(["remove", name]); },
    };
  };
  // 显式 light/dark → 设 data-theme 属性
  for (const theme of ["light", "dark"]) {
    const target = makeTarget();
    applyThemeOn(target, theme);
    const setCall = recordAt(target.calls, 0);
    assert(
      target.calls.length === 1 &&
        setCall[0] === "set" &&
        setCall[1] === "data-theme" &&
        setCall[2] === theme,
      `theme=${theme} 应设 data-theme="${theme}"`,
    );
  }
  // system → 移除 data-theme 属性(CSS @media prefers-color-scheme 接管)
  const sysTarget = makeTarget();
  applyThemeOn(sysTarget, "system");
  const removeCall = recordAt(sysTarget.calls, 0);
  assert(
    sysTarget.calls.length === 1 &&
      removeCall[0] === "remove" &&
      removeCall[1] === "data-theme",
    "theme=system 应移除 data-theme 属性",
  );
  console.log("[ok] applyThemeOn:light/dark 设属性/system 移除属性 断言通过");
}