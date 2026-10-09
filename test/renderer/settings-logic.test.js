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
 *   cloneDefaultSettings(默认设置深拷贝工厂:6 组与单例互非引用、两次调用互非引用)、
 *   resolvePresetHint(回填 hint 计算)、outputDirDisplayText(输出目录占位文案)、
 *   buildCustomPresetEntry(另存为预设快照)、removeCustomPresetByName(按名删除保序)、
 *   parseMarginValue(边距输入解析+钳制)、validateNumberRange(字号/行距范围校验)、
 *   settingsToControlValues(设置对象 → 控件回填值映射;表驱动,类型从 AppSettings 派生,
 *     path-chip 的展示文本不入此映射)。注:dist 是编译产物(无类型标注),故本段按
 *     运行期取值断言 —— 回显值的**类型派生**由 src 侧 typecheck 守(声明表逐条 read
 *     的返回类型即映射值的类型),此段另加一条键集断言兜住"漏登记一条"。
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
import { setLanguage, t } from "../../dist/core/i18n/index.js";
import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_PRESETS,
  cloneDefaultSettings,
  correctPageSetup,
} from "../../dist/core/settings/settings-defaults.js";
import { TEMPLATE_PRESETS } from "../../dist/core/settings/presets.js";
import {
  CUSTOM_PRESET_ID_PREFIX,
  allPresets,
  applySettingsRuntimeEffects,
  applyThemeOn,
  buildCustomPresetEntry,
  clampMargin,
  customPresetNameFromId,
  customPresetToTemplate,
  headerLogoDisplayName,
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
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("settings-logic");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游代码依赖收窄(如判 `appliedValue !== null` 后直读其 `.format`、判字典键存在后
 * 直传给 `includes`)⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

// 预设夹具取**真实的默认形状**而非空对象字面量(ADR-069 的类型面对齐)。
// ⚠ 此处**刻意不再手写 `@returns`**:原注解写的是 `{typography: object, pageSetup: object}`,
// 理由是「dist 编译产物无类型标注」—— 那条前提在 `declaration` 打开后已失效(ADR-069)。
// 留着它的害处不只类型不准:**JSDoc `@returns` 会覆盖推断**,于是函数体改成什么样都不生效,
// 且文件里十几处 `preset(...)` 调用点全被这条陈旧注解拖判红。类型从函数体推断即可 ——
// `cloneDefaultSettings()` 的返回类型来自产物声明,`CustomPreset` 要的形状它本就满足。
/** @param {string} name */
const preset = (name) => {
  const base = cloneDefaultSettings();
  return { name, typography: base.typography, pageSetup: base.pageSetup };
};

/** 合并后的完整设置(dist 编译产物无类型标注,取 mergeSettingsWithDefaults 的返回形状)。 */
/** @typedef {ReturnType<typeof mergeSettingsWithDefaults>} AppSettings */

/**
 * 取控件回填值映射。dist 无类型标注,故在此只声明"取值形状"这一层:
 * 开关与分档为 boolean,其余(文本/数值/枚举档/path-chip 之外的一切)为 string。
 * 键集与逐键类型在 src 侧由声明表派生并过 typecheck —— 此处不复制那份形状,
 * 免得测试里再养一份手抄副本(那正是本次要消掉的债)。
 * @param {AppSettings} settings
 * @returns {Record<string, string | boolean>}
 */
function controlValues(settings) {
  return /** @type {Record<string, string | boolean>} */ (settingsToControlValues(settings));
}

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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** renderer 纯函数单测(纯 Node 段,零 Electron API) */
export async function run() {
  const suite = createCaseSuite();
  // ---------- validatePresetName ----------
  // 取数(上限列表与既有名夹具)留在 case 外:两条上限判定共用同一份列表
  const full = Array.from({ length: MAX_CUSTOM_PRESETS }, (_, i) => preset(`p${i}`));
  await suite.case("validatePresetName:空名与纯空白名 → 请输入预设名称", () => {
    assert(
      validatePresetName("", []) === "请输入预设名称",
      "空名应返回「请输入预设名称」",
    );
    assert(
      validatePresetName("   ", []) === "请输入预设名称",
      "纯空白名应返回「请输入预设名称」",
    );
  });
  await suite.case("validatePresetName:同名按 trim 后比较判重(含前后空白名)", () => {
    assert(
      validatePresetName("我的模板", [preset("我的模板")]) === "已存在同名预设,请换一个名称",
      "同名应返回「已存在同名预设,请换一个名称」",
    );
    assert(
      validatePresetName(" 我的模板 ", [preset("我的模板")]) === "已存在同名预设,请换一个名称",
      "前后空白名与既有名 trim 后相同 → 应判同名",
    );
  });
  await suite.case("validatePresetName:达上限给出上限文案,未达上限且合法 → null", () => {
    assert(
      validatePresetName("新模板", full) === `已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除`,
      `达上限应返回「已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除」(全角逗号统一为半角)`,
    );
    assert(
      validatePresetName(" 新模板 ", full.slice(0, MAX_CUSTOM_PRESETS - 1)) === null,
      "未达上限且无同名 → null",
    );
    assert(validatePresetName("新模板", []) === null, "空列表合法 → null");
  });
  console.log("[ok] validatePresetName:空名/纯空白/同名(trim 比较)/达上限文案/合法 → null 断言通过");

  // ---------- customPresetToTemplate ----------
  // 契约要的是完整的 TypographySettings / PageSetup,而夹具原先只给一两个字段。
// 注意保留**原引用**:下面那条断言校验的是 `tpl.typography === typography`(同一对象),
// 所以这里用「按默认补齐后再覆盖少数字段」,而不是就地散着写两份字面量。
const presetBase = cloneDefaultSettings();
const typography = { ...presetBase.typography, fontAscii: "Arial", fontEastAsia: "宋体" };
// 标注契约类型(非 `any`):`paper: "A4"` 写进新对象字面量时会被拓宽成 `string`,
// 而 PageSetup["paper"] 是五值联合。此处只补回联合、**值一个不动** ——
// 下方「原引用映射」断言依赖的仍是同一个 `pageSetup` 对象。
/** @type {AppSettings["pageSetup"]} */
const pageSetup = { ...presetBase.pageSetup, paper: "A4" };
  const tpl = customPresetToTemplate({ name: "我的模板", typography, pageSetup });
  await suite.case("customPresetToTemplate:id(custom: 前缀)/name/hint 映射正确", () => {
    assert(
      tpl.id === `${CUSTOM_PRESET_ID_PREFIX}我的模板` &&
        tpl.name === "我的模板" &&
        tpl.hint === "自定义预设 · 仅排版与页面",
      "customPresetToTemplate:id(custom: 前缀)/name/hint 应正确映射",
    );
  });
  await suite.case("customPresetToTemplate:typography/pageSetup 原引用映射", () => {
    assert(tpl.typography === typography && tpl.pageSetup === pageSetup, "customPresetToTemplate:typography/pageSetup 应原引用映射");
  });
  console.log("[ok] customPresetToTemplate:id= custom:name / name / hint / 原引用映射 断言通过");

  // ---------- allPresets ----------
  const combined = allPresets([preset("我的模板"), preset("简报二")]);
  // 按下标取值在 noUncheckedIndexedAccess 下是 `T | undefined`,直接 `.id` 会判红。
  // 用解构 + `?.`:**取不到时 `undefined?.id === 期望` 为 false,断言照样失败** ——
  // 强度未被削弱,只是不再要求作者先写一遍判空。
  const [firstCustom, secondCustom] = combined.slice(TEMPLATE_PRESETS.length);
  await suite.case("allPresets:硬编码预设原样在前,自定义项追加末尾且 id 带 custom: 前缀", () => {
    assert(combined.length === TEMPLATE_PRESETS.length + 2, "allPresets:硬编码 + 自定义数量正确");
    for (let i = 0; i < TEMPLATE_PRESETS.length; i++) {
      assert(combined[i] === TEMPLATE_PRESETS[i], "allPresets:硬编码预设应原样在前");
    }
    assert(
      firstCustom?.id === `${CUSTOM_PRESET_ID_PREFIX}我的模板` &&
        secondCustom?.id === `${CUSTOM_PRESET_ID_PREFIX}简报二`,
      "allPresets:自定义项应追加末尾且 id 带 custom: 前缀",
    );
  });
  await suite.case("allPresets:空自定义列表 → 仅硬编码内置预设", () => {
    assert(allPresets([]).length === TEMPLATE_PRESETS.length, "allPresets:空自定义列表 → 仅硬编码内置预设(TEMPLATE_PRESETS.length 项)");
  });
  console.log("[ok] allPresets:硬编码在前 + 自定义追加(custom: id) + 空列表 断言通过");

  // ---------- customPresetNameFromId ----------
  await suite.case("customPresetNameFromId:custom: 前缀解析出名称,空名 → 空串", () => {
    assert(
      customPresetNameFromId(`${CUSTOM_PRESET_ID_PREFIX}我的模板`) === "我的模板",
      "custom: 前缀 → 名称",
    );
    assert(customPresetNameFromId(`${CUSTOM_PRESET_ID_PREFIX}`) === "", "custom: 前缀后空名 → 空串");
  });
  await suite.case("customPresetNameFromId:硬编码值与非前缀值 → null", () => {
    assert(customPresetNameFromId("default") === null, "硬编码预设值 → null");
    assert(customPresetNameFromId("customxx") === null, "非前缀值 → null");
  });
  console.log("[ok] customPresetNameFromId:前缀解析/空名/硬编码与无关值 → null 断言通过");

  // ---------- clampMargin ----------
  await suite.case("clampMargin:0/1000 边界保留,负数与超限钳制,区间内小数保留", () => {
    assert(clampMargin(0) === 0, "0 边界应保留");
    assert(clampMargin(1000) === 1000, "1000 边界应保留");
    assert(clampMargin(-5) === 0, "-5 应钳到 0");
    assert(clampMargin(1001) === 1000, "1001 应钳到 1000");
    assert(clampMargin(12.5) === 12.5, "区间内小数应保留");
  });
  console.log("[ok] clampMargin:0/1000 边界保留、负数/超限钳制、小数保留 断言通过");

  // ---------- resolvePresetSelection(自定义预设不被弹回硬编码项) ----------
  const paperTpl = TEMPLATE_PRESETS.find((p) => p.id === "paper");
  // 段级前置守卫(不进 case):paperLike / off 两个夹具与本组全部判定都建立在
  // paperTpl 已取到之上,它缺失时整组无从判定 ⇒ 留在 case 外当守卫
  assert(paperTpl, "TEMPLATE_PRESETS 应含 paper(学术论文)预设");
  // ⚠ 刻意保持只给 `{typography, pageSetup}`:`resolvePresetSelection` 内部只经 `matchesPreset`
  // 读这些块,补齐其余字段会**改变匹配结果**(实测:补默认后「选中项不一致 → 回退全局匹配
  // paper」那条判红),即为了让类型通过而悄悄改掉了被测语义。
  // 入参此后已按此收窄成 `PresetMatchSettings`(`Pick<AppSettings, "typography" | "pageSetup">`
  // 再叠加四个可选块,见 core/settings/presets.ts,裁决见 ADR-070)—— 本夹具的窄形状正落在
  // 该类型的合法范围内,故这处「刻意保持窄」仍然必要,不是历史遗留。
  const paperLike = () => ({
    typography: { ...paperTpl.typography },
    pageSetup: { ...paperTpl.pageSetup },
  });
  const custom = { name: "同名", ...paperLike() }; // 值恰与「学术论文」预设全等
  // 无任何匹配用的对照:同上刻意只给这两块,补默认会改变 matchesPreset 的比较结果
  const off = {
    typography: { ...paperTpl.typography, bodySizePt: 99 },
    pageSetup: { ...paperTpl.pageSetup },
  };
  await suite.case("resolvePresetSelection:值=paper 的自定义预设被选中时不弹回硬编码 paper", () => {
    // 1. 回归场景:自定义预设值=paper 预设值、当前选中该自定义 → 保持选中,不弹回 paper
    assert(
      resolvePresetSelection([custom], paperLike(), `${CUSTOM_PRESET_ID_PREFIX}同名`) ===
        `${CUSTOM_PRESET_ID_PREFIX}同名`,
      "值=paper 的自定义预设被选中时不应弹回硬编码 paper",
    );
  });
  await suite.case("resolvePresetSelection:选中项不匹配或已删除都回退全局匹配", () => {
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
  });
  await suite.case("resolvePresetSelection:无任何匹配 → default;硬编码选中且一致 → 保持", () => {
    // 4. 无任何匹配 → default
    assert(
      resolvePresetSelection([], off, "default") === "default",
      "无任何匹配 → 回退 default",
    );
    // 5. 硬编码预设正常选中(设置=paper 值、选中 paper → 保持 paper)
    assert(
      resolvePresetSelection([], paperLike(), "paper") === "paper",
      "硬编码选中且与设置一致 → 保持",
    );
  });
  console.log("[ok] resolvePresetSelection:选中保持(不弹回)/回退全局匹配/已删回退/无匹配 default/硬编码保持 断言通过");

  // ---------- cloneDefaultSettings(默认设置深拷贝工厂) ----------
  // 判据落在**引用身份**而非取值:工厂一旦退回「返回 DEFAULT_SETTINGS 本身」或
  // 只展开顶层键不换分组块,下面两条立刻红,而「与默认值等值」那条仍绿 ——
  // 正是这类改坏只能靠引用断言才看得见的原因。
  {
    const GROUP_KEYS = [
      "pageSetup",
      "typography",
      "headerFooter",
      "watermark",
      "aiCleanup",
      "obsidian",
    ];
    /**
 * 按**运行期键名**做「非同一引用」比对用的索引视图。
 *
 * ⚠ 这是一次有意的动态索引:`GROUP_KEYS` 是运行时数组,而 `AppSettings` 没有索引签名,
 * 故必须显式转成索引视图。转换**经 `unknown` 中转**才合法 —— 直接转会被 TS2352 判红
 * (理由是两个类型「无足够重叠」),这不是可以随手 `as` 掉的噪音,而是 TS 在提醒你这一步
 * 跨出了静态可知的范围。
 *
 * ⚠ 这里**刻意不写第二份 `AppSettings` 形状**:形状的唯一来源是产物声明
 * (`dist/core/settings/settings-defaults.d.ts`)。测试里再抄一份就又回到了 ADR-069
 * 要拆的那个错配 —— 跑的是产物、查的是手写副本。
 */
/** @param {AppSettings} settings */
const indexedView = (settings) =>
  /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (settings));

const defaultsView = indexedView(DEFAULT_SETTINGS);
const cloned = cloneDefaultSettings();
const clonedView = indexedView(cloned);
const again = cloneDefaultSettings();
const againView = indexedView(again);
    await suite.case("cloneDefaultSettings:六个分组与单例互非引用,两次调用互非引用", () => {
      for (const group of GROUP_KEYS) {
        assert(
          clonedView[group] !== defaultsView[group],
          `${group} 应为新建对象,不得与 DEFAULT_SETTINGS 共用引用`,
        );
      }
      for (const group of GROUP_KEYS) {
        assert(againView[group] !== clonedView[group], `两次调用的 ${group} 互非同一引用`);
      }
    });
    await suite.case("cloneDefaultSettings:与 DEFAULT_SETTINGS 等值,customPresets 数组也换新", () => {
      assert(
        JSON.stringify(cloned) === JSON.stringify(DEFAULT_SETTINGS),
        "工厂应产出与 DEFAULT_SETTINGS 等值的设置(逐字段对拍)",
      );
      assert(
        cloned.customPresets !== DEFAULT_SETTINGS.customPresets,
        "customPresets 数组也应换新(默认恒空,但数组引用同属单例面)",
      );
    });
  }
  console.log("[ok] cloneDefaultSettings:6 组与单例互非引用/两次调用互非引用/与默认值等值 断言通过");

  // ---------- mergeSettingsWithDefaults(loadSettings 防御性合并) ----------
  // 取数(各次 merge 的结果 + 回调捕获)留在 case 外:判定对象全在这些派生值上
  const partial = mergeSettingsWithDefaults({ format: "pdf", outputDir: "C:\\out" });
  const merged = mergeSettingsWithDefaults({
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 99 },
    typography: { ...DEFAULT_SETTINGS.typography, bodySizePt: 20 },
  });
  const invalidGeometry = mergeSettingsWithDefaults({
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginBottom: 1000 },
  });
  /** @type {string | null} */
  let mergePageError = null;
  mergeSettingsWithDefaults(
    { pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginBottom: 1000 } },
    (/** @type {string} */ message) => { mergePageError = message; },
  );
  await suite.case("mergeSettingsWithDefaults:完整设置原样透传,显式字段保留", () => {
    assert(
      JSON.stringify(mergeSettingsWithDefaults(DEFAULT_SETTINGS)) === JSON.stringify(DEFAULT_SETTINGS),
      "完整设置应原样透传",
    );
    assert(partial.format === "pdf" && partial.outputDir === "C:\\out", "显式字段应保留");
  });
  await suite.case("mergeSettingsWithDefaults:缺字段走默认值兜底(pageSetup/typography/customPresets)", () => {
    assert(
      partial.pageSetup.paper === DEFAULT_SETTINGS.pageSetup.paper &&
        partial.typography.fontAscii === DEFAULT_SETTINGS.typography.fontAscii,
      "缺 pageSetup/typography 字段 → 默认值兜底",
    );
    assert(
      Array.isArray(partial.customPresets) && partial.customPresets.length === 0,
      "缺 customPresets → 默认空数组",
    );
  });
  await suite.case("mergeSettingsWithDefaults:分组块部分字段合并(显式覆盖 + 默认兜底)", () => {
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
  });
  await suite.case("mergeSettingsWithDefaults:空对象 → 全默认;theme 缺省 system、显式值保留", () => {
    assert(mergeSettingsWithDefaults({}).outputDir === "", "空对象 → 全默认(outputDir 空串)");
    assert(
      mergeSettingsWithDefaults({}).theme === "system",
      "缺 theme → 默认 system(theme 键)",
    );
    assert(
      mergeSettingsWithDefaults({ theme: "dark" }).theme === "dark",
      "显式 theme=dark 应保留",
    );
  });
  await suite.case("mergeSettingsWithDefaults:非法几何复用 core 确定性修正,并上送可见错误", () => {
    assert(
      invalidGeometry.pageSetup.marginTop === 0 && invalidGeometry.pageSetup.marginBottom === 296,
      "IPC 防御性合并遇到非法几何应复用 core 确定性修正(top=0/bottom=296)",
    );
    assert(typeof mergePageError === "string", "merge 发现非法几何时应上送可见错误");
  });
  await suite.case("mergeSettingsWithDefaults:AI 清理两档缺整块/缺字段/显式 false 各按语义兜底", () => {
    // AI 清理两档:旧档缺整块 / 块内缺字段 → 兜底默认(与 main 侧 loadSettings 同语义)
    assert(
      JSON.stringify(mergeSettingsWithDefaults({}).aiCleanup) ===
        JSON.stringify({ enabled: false, tidy: true, rewrite: true }),
      "缺整块 → 默认(两档开、总开关关,与 main 侧字段级兜底一致)",
    );
    assert(
      mergeSettingsWithDefaults({ aiCleanup: { enabled: true } }).aiCleanup.tidy === true,
      "块内缺字段 → 该字段兜底默认,不得把 undefined 带进设置状态",
    );
    assert(
      mergeSettingsWithDefaults({ aiCleanup: { tidy: false, rewrite: false } }).aiCleanup.enabled ===
        false &&
        mergeSettingsWithDefaults({ aiCleanup: { tidy: false, rewrite: false } }).aiCleanup.rewrite ===
          false,
      "显式 false 的档位应保留(不得被默认覆盖)",
    );
  });
  await suite.case("mergeSettingsWithDefaults:缺 obsidian 整块 → 默认", () => {
    assert(
      JSON.stringify(mergeSettingsWithDefaults({}).obsidian) ===
        JSON.stringify({ compat: false, attachmentFolder: "Attachments" }),
      "缺 obsidian 整块 → 默认(与 main 侧字段级兜底一致)",
    );
  });
  console.log("[ok] mergeSettingsWithDefaults:完整透传/显式字段保留/缺字段默认兜底/部分字段合并/theme 兜底/AI 清理两档兜底/非法几何回退 断言通过");

  // ---------- normalizePageSetup(复用 core validatePageSetup 的 renderer 输入防线) ----------
  const validPage = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    paper: "A5",
    marginLeft: 30,
    marginRight: 30,
  });
  const invalidA4 = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    marginBottom: 1000,
  });
  const invalidA5 = normalizePageSetup({
    ...DEFAULT_SETTINGS.pageSetup,
    paper: "A5",
    marginLeft: 74,
    marginRight: 74,
  });
  await suite.case("normalizePageSetup:合法页面设置原样通过且无错误", () => {
    assert(
      validPage.corrected === false && validPage.error === null && validPage.pageSetup.paper === "A5",
      "合法页面设置应原样通过且无错误",
    );
  });
  await suite.case("normalizePageSetup:A4 下边距 1000 由 core 几何策略修正并提供可见错误", () => {
    assert(
      invalidA4.corrected === true &&
        typeof invalidA4.error === "string" &&
        invalidA4.error.includes("页面内容区") &&
        invalidA4.pageSetup.marginTop === 0 &&
        invalidA4.pageSetup.marginBottom === 296,
      "A4 下边距 1000 应由 core 几何策略修正并提供可见错误",
    );
  });
  await suite.case("normalizePageSetup:A5 零内容区按 core 策略确定性修正", () => {
    assert(
      invalidA5.corrected === true &&
        invalidA5.pageSetup.paper === "A5" &&
        invalidA5.pageSetup.marginLeft === 73 &&
        invalidA5.pageSetup.marginRight === 74,
      "A5 零内容区应按 core 策略确定性修正，不得把非法几何写入 renderer 状态",
    );
  });
  console.log("[ok] normalizePageSetup:core validator 合法透传/非法几何回退+可见错误 断言通过");

  // partial pageSetup patch 与 main sanitize 一样以 fallback=当前值合并。
  const partialPage = normalizePageSetup(
    { paper: "A5" },
    { ...DEFAULT_SETTINGS.pageSetup, marginTop: 11, marginBottom: 12, marginLeft: 13, marginRight: 14 },
  );
  const sameCorrection = normalizePageSetup({
    paper: "A4", orientation: "portrait", marginTop: 200, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  const coreCorrection = correctPageSetup({
    paper: "A4", orientation: "portrait", marginTop: 200, marginBottom: 200, marginLeft: 10, marginRight: 10,
  });
  // 标注类型(非 `any`):两者的赋值都发生在 onMigrationWarning 回调内,流分析跨不过回调,
  // 读它们的位置又在 case 的闭包里 ⇒ 不标注会退成隐式 any
  /** @type {string | null} */
  let migrationWarning = null;
  /** @type {number} */
  let migrationWarningCount = 0;
  // 标注契约类型(非 `any`):`kind`/`persistence`/`reasons[]` 写在对象字面量里会被拓宽成
  // `string`/`string[]`,而 AppSettings["migration"] 是字面量联合。此处只把字面量联合补回,
  // **运行时值与下方「同一 migration 只提示一次」断言完全不变**。
  /** @type {AppSettings} */
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
  await suite.case("normalizePageSetup:partial patch 复用当前 fallback,不重置未提供边距", () => {
    assert(
      partialPage.corrected === false &&
        partialPage.pageSetup.paper === "A5" &&
        partialPage.pageSetup.marginTop === 11 &&
        partialPage.pageSetup.marginBottom === 12 &&
        partialPage.pageSetup.marginLeft === 13 &&
        partialPage.pageSetup.marginRight === 14,
      "partial pageSetup 应复用当前 fallback，不得重置未提供边距",
    );
  });
  await suite.case("normalizePageSetup:与 core 纠正策略对非法几何输出完全一致", () => {
    assert(
      JSON.stringify(sameCorrection.pageSetup) === JSON.stringify(coreCorrection.pageSetup) &&
        JSON.stringify(sameCorrection.reasons) === JSON.stringify(coreCorrection.reasons),
      "renderer normalize 与 core 纠正策略应对非法几何输出完全一致",
    );
  });
  await suite.case("merge:同一 migration 只交给 renderer 用户提示一次(不重复显示 scheduled warning)", () => {
    assert(
      migrationWarning === "旧页面几何已自动修正" && migrationWarningCount === 1,
      "同一 migration 应交给 renderer 用户提示一次，不能重复显示 scheduled warning",
    );
  });
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
  await suite.case("reconcileSettingsSave:失败保留编辑内容(不调用 apply 回滚)并把错误交给失败回调", () => {
    assert(
      failedSave === "failed" && applied === null && failureShown &&
        failure instanceof Error && failure.message === "disk full",
      "保存失败应保留编辑内容(不调用 apply 回滚)并把错误交给失败回调",
    );
    assert(
      draft.format === "pdf",
      "失败路径不得修改调用方持有的草稿对象",
    );
  });
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
  await suite.case("reconcileSettingsSave:过期请求的失败不回填也不报错(让位给更新请求收敛)", () => {
    assert(
      staleFailure === "superseded" && staleApplied === null && !staleFailureShown,
      "过期请求的失败不应回填也不应报错(避免覆盖更新请求的收敛结果)",
    );
  });
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
  // ⚠ 此前这里是 `controlValues(/** @type {AppSettings} */ (successApplied))` —— 一个**不成立的断言**:
  // successApplied 的类型是 `AppSettings | null`,把 null 直接断言成 AppSettings 属 TS2352,
  // 且断言之后 `successApplied.theme` 会落到 `never` 上(前一个条件用 `?.` 已把它收窄成 null)。
  // 正确写法:先显式判空,并让「为空」这条路径**自己失败**,再取值 —— 断言强度不降反升
  // (原来 null 会静默走进 `?.` 的 false 分支,现在直接报「apply 未被调用」)。
  // ⚠ 这里必须经**读取函数**取值(与上方 lastFailure 同一手法):`successApplied` 的赋值
  // 发生在 `apply` 回调内部,流分析看不到那一次赋值,故直接读时它仍被收窄成初始 `null`;
  // 再叠加下面的 `!== null` 判空就被压成 `never`,`.format`/`.theme` 随即判红。
  // 读取函数返回的是**声明类型** `AppSettings | null`,判空后正常收窄为 `AppSettings`。
  const lastApplied = () => successApplied;
  const appliedValue = lastApplied();
  await suite.case("reconcileSettingsSave:成功时 apply 被调用并以 main 权威值回填 state/控件", () => {
    assert(appliedValue !== null, "保存成功时 apply 必须被调用");
    // 取数(控件回填映射)放在判空之后:appliedValue 为 null 时上面那条已判红,
    // 而下面这条若独立成 case 就会拿着 null 去算映射,把「apply 未被调用」这条真因盖掉
    const successControls = controlValues(appliedValue);
    assert(
      successSave === "saved" && appliedValue.format === "pdf" &&
        successControls.format === "pdf" && appliedValue.theme === "dark",
      "保存成功应以 main 权威值回填 state/控件",
    );
  });
  console.log("[ok] reconcileSettingsSave:失败保留草稿不回滚/过期请求让位/成功权威回填断言通过");

  // mergePendingSavePatch：失败草稿必须并入下一次提交（否则失败字段永远只存内存）
  const pendingMerged = mergePendingSavePatch(
    { format: "pdf", typography: { bodySizePt: 13, fontAscii: "Inter" } },
    { theme: "dark", typography: { bodySizePt: 15 } },
  );
  const freshMerged = mergePendingSavePatch({}, { format: "pdf" });
  // 同字段二次编辑：用户最新值覆盖草稿值（不复活旧值）
  const reeditMerged = mergePendingSavePatch({ theme: "dark" }, { theme: "light" });
  // 渲染前变换两组同为块级：草稿里改过的档位不得被下一次只带部分字段的提交挤掉
  const blockMerged = mergePendingSavePatch(
    { aiCleanup: { enabled: true, tidy: false, rewrite: false }, obsidian: { compat: true, attachmentFolder: "A" } },
    { aiCleanup: { rewrite: true }, obsidian: { attachmentFolder: "B" } },
  );
  await suite.case("mergePendingSavePatch:草稿标量字段与新 patch 一并提交,块级逐字段合并", () => {
    assert(
      pendingMerged.format === "pdf" && pendingMerged.theme === "dark",
      `草稿标量字段应与新 patch 一并提交,实际 ${JSON.stringify(pendingMerged)}`,
    );
    assert(
      pendingMerged.typography?.bodySizePt === 15 && pendingMerged.typography?.fontAscii === "Inter",
      `块级字段应逐字段合并(新值覆盖同名字段,未提及字段保留草稿值),实际 ${JSON.stringify(pendingMerged.typography)}`,
    );
  });
  await suite.case("mergePendingSavePatch:无草稿时退化为原 patch(不注入空块)", () => {
    assert(
      freshMerged.format === "pdf" && freshMerged.typography === undefined,
      "无草稿时应退化为原 patch(不注入空块)",
    );
  });
  await suite.case("mergePendingSavePatch:同一字段的再次编辑以最新值为准(不复活旧值)", () => {
    assert(
      reeditMerged.theme === "light",
      `同一字段的再次编辑应以最新值为准,实际 ${String(reeditMerged.theme)}`,
    );
  });
  await suite.case("mergePendingSavePatch:aiCleanup / obsidian 两块逐字段合并", () => {
    assert(
      JSON.stringify(blockMerged.aiCleanup) === JSON.stringify({ enabled: true, tidy: false, rewrite: true }),
      `aiCleanup 块应逐字段合并,实际 ${JSON.stringify(blockMerged.aiCleanup)}`,
    );
    assert(
      JSON.stringify(blockMerged.obsidian) === JSON.stringify({ compat: true, attachmentFolder: "B" }),
      `obsidian 块应逐字段合并,实际 ${JSON.stringify(blockMerged.obsidian)}`,
    );
  });
  console.log("[ok] mergePendingSavePatch:草稿并入提交/块级深合并(含 aiCleanup/obsidian)/最新编辑优先断言通过");

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
  await suite.case("applySettingsRuntimeEffects:同步 selectedFormat/语言/语言镜像/静态文案/主题", () => {
    assert(
      JSON.stringify(runtimeEffects) === JSON.stringify([
        ["format", "pdf"], ["language", "en"], ["mirror", "en"], ["texts"], ["theme", "dark"],
      ]),
      "权威设置副作用应同步 selectedFormat/语言/语言镜像/静态文案/主题",
    );
  });
  console.log("[ok] applySettingsRuntimeEffects:selectedFormat/语言/主题副作用断言通过");

  // ---------- resolvePresetHint(回填 hint 计算;三语 + 分支可达与复位) ----------
  // 语言为 i18n 模块级状态:本段内切语言,段末复位 zh(后续断言依赖中文文案)
  const paperPreset = TEMPLATE_PRESETS.find((p) => p.id === "paper");
  // 段级前置守卫(不进 case):下面三组 presetHintText / presetDisplayName 的判定都以
  // paperPreset 已取到为前提,它缺失时整组无从判定
  assert(paperPreset, "TEMPLATE_PRESETS 应含 paper(学术论文)预设");
  // 取数与守卫留在 case 外:`toast 不应混入中文预设名`这条判定读的是 zh 字典那一项,
  // 只在非 zh 语言分支里被用到,收窄若随取数一起进 case 就只在那条分支内成立。
  // 与下方循环内那条 `localizedPaperName` 守卫不重复:那条逐 code 证「当前语言」那一项,
  // 这条证的是「中文」那一项 —— 非 zh 分支成立与否与当前 code 无关。
  const zhPaperDictName = DICT.zh["preset.paper"];
  assert(zhPaperDictName !== undefined, "zh 字典应注册 preset.paper 键(套用 toast 的混排判定依赖它)");
  // 取数留在 case 外:zh 下 paper 的提示值被下面两处引用(命中判定 + 分支复位判定)
  const zhPaperHint = resolvePresetHint([], "paper");
  await suite.case("resolvePresetHint:zh 下内置预设命中 → 取 hintI18nKey 字典值 + isCustom=false", () => {
    // zh(默认):内置预设命中 → 字典值(= hint 兜底原文)+ isCustom=false
    assert(
      zhPaperHint.isCustom === false && zhPaperHint.hint === paperPreset.hint,
      "zh:内置预设命中 → 其 hint + isCustom=false",
    );
    assert(
      zhPaperHint.hint === dictText("zh", paperPreset.hintI18nKey),
      "zh:提示应取自 hintI18nKey 字典值(与 hint 兜底原文同源)",
    );
  });
  await suite.case("resolvePresetHint:en / ja 下提示随语言切换,不回落中文也不显裸键", () => {
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
  });
  // 全部内置预设:三语下均命中各自字典键(逐个确认无遗漏预设)。
  // ⚠ 每个(预设 × 语言)一个 case:某一格没命中不该让其余各格的判定都不跑
  for (const p of TEMPLATE_PRESETS) {
    for (const { code } of LANGUAGES) {
      await suite.case(`resolvePresetHint:预设 ${p.id} 在 ${code} 下命中 ${code}.${p.hintI18nKey}`, () => {
        setLanguage(code);
        const hit = resolvePresetHint([], p.id);
        assert(
          hit.isCustom === false && hit.hint === dictText(code, p.hintI18nKey),
          `${code}:预设 ${p.id} 提示应等于 ${code}.${p.hintI18nKey}`,
        );
      });
    }
  }
  setLanguage("zh");
  // 缺键安全回退:字典未命中 → 回落 hint 原文(不显裸键、不抛错)
  const unknownKeyPreset = { ...paperPreset, hintI18nKey: "preset.hintNoSuchKey" };
  await suite.case("resolvePresetHint:hintI18nKey 字典缺键或未声明 → 回退 hint 原文,且不显裸键", () => {
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
  });
  await suite.case("resolvePresetHint:自定义预设命中 → 走 preset.customHint 且随语言切换", () => {
    // 自定义预设分支(customHint 随语言)
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
  });
  await suite.case("resolvePresetHint:未知 id → 「已微调」文案,分支可复位、自定义已删也落此支", () => {
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
  });
  console.log("[ok] resolvePresetHint:三语命中全部内置预设/自定义/未知 id 分支与复位/缺键回退 hint 原文 断言通过");

  // ---------- presetDisplayName(预设名本地化:下拉/向导/toast 共用单一口径) ----------
  await suite.case("presetDisplayName:zh 下内置预设名取字典值;en / ja 取本语言字典值", () => {
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
  });
  // 自定义预设无 i18nKey → 直接用用户命名的 name(任何语言都不翻译用户数据)
  const named = customPresetToTemplate(preset("我的模板"));
  await suite.case("presetDisplayName:自定义预设名在三语下都原样用 name", () => {
    for (const { code } of LANGUAGES) {
      setLanguage(code);
      assert(presetDisplayName(named) === "我的模板", `${code}:自定义预设名应原样用 name`);
    }
    setLanguage("zh");
  });
  await suite.case("presetDisplayName:i18nKey 字典缺键或未声明 → 回退 name", () => {
    assert(
      presetDisplayName({ ...paperPreset, i18nKey: "preset.noSuchKey" }) === paperPreset.name,
      "i18nKey 字典缺键 → 回退 name(安全回退底)",
    );
    assert(
      presetDisplayName({ ...paperPreset, i18nKey: undefined }) === paperPreset.name,
      "未声明 i18nKey → name",
    );
  });
  // 套用预设 toast:名随语言,en/ja 下不出现中文(不得中英/中日混排)。每语言一个 case
  for (const { code } of LANGUAGES) {
    await suite.case(`presetDisplayName:${code} 下套用 toast 含本语言预设名且无中文混排`, () => {
      setLanguage(code);
      const toast = t("toast.presetSwitched", {
        name: presetDisplayName(paperPreset),
        groups: "Typography · Numbering",
      });
      // dictText 的返回是 `string | undefined`(缺键即 undefined)。此处**先判存在再取值**:
      // 不能用 `?? ""` —— `"x".includes("")` 恒为 true,那会把断言变成永真、等于悄悄删掉它。
      // 缺键时下面这条 assert 直接失败,与旧写法(`includes` 收到非串参数)同样判红,只是更早更明确。
      const localizedPaperName = dictText(code, "preset.paper");
      assert(localizedPaperName !== undefined, `${code}:字典应注册 preset.paper 键`);
      assert(
        toast.includes(localizedPaperName),
        `${code}:套用 toast 应含本语言预设名(实测 ${JSON.stringify(toast)})`,
      );
      if (code === "zh") return;
      assert(
        !toast.includes(zhPaperDictName),
        `${code}:套用 toast 不应混入中文预设名(混排回归,实测 ${JSON.stringify(toast)})`,
      );
      if (code === "en") {
        assert(
          !/[一-鿿]/.test(toast),
          `en:套用 toast 不应含任何汉字(实测 ${JSON.stringify(toast)})`,
        );
      }
    });
  }
  setLanguage("zh");
  console.log("[ok] presetDisplayName:内置三语命中/自定义原样 name/缺键回退 name + toast 无中英混排 断言通过");

  // ---------- outputDirDisplayText(输出目录占位文案) ----------
  await suite.case("outputDirDisplayText:非空原样返回,空串 → 占位文案", () => {
    assert(outputDirDisplayText("C:\\out") === "C:\\out", "非空目录原样返回");
    assert(outputDirDisplayText("") === "与源文件相同目录", "空串 → 「与源文件相同目录」");
  });
  console.log("[ok] outputDirDisplayText:非空原样/空串占位文案 断言通过");

  // ---------- buildCustomPresetEntry(另存为预设数据变换) ----------
  const srcSettings = {
    ...DEFAULT_SETTINGS,
    typography: { ...DEFAULT_SETTINGS.typography, bodySizePt: 14 },
    pageSetup: { ...DEFAULT_SETTINGS.pageSetup, marginTop: 30 },
  };
  const entry = buildCustomPresetEntry("我的模板", srcSettings);
  await suite.case("buildCustomPresetEntry:名称 + 排版/页面设置快照", () => {
    assert(
      entry.name === "我的模板" &&
        entry.typography.bodySizePt === 14 &&
        entry.pageSetup.marginTop === 30,
      "名称 + 排版/页面设置快照",
    );
  });
  // 改动快照是下一步的取数,故与「深拷贝」判定分成两个 case(后者是独立的一件事)
  entry.typography.bodySizePt = 99;
  await suite.case("buildCustomPresetEntry:快照深拷贝,改结果不影响源设置", () => {
    assert(srcSettings.typography.bodySizePt === 14, "快照深拷贝:改结果不影响源设置");
  });
  console.log("[ok] buildCustomPresetEntry:名称/快照/深拷贝 断言通过");

  // ---------- removeCustomPresetByName(删除预设数据变换) ----------
  const list = [preset("a"), preset("b"), preset("c")];
  const removed = removeCustomPresetByName(list, "b");
  await suite.case("removeCustomPresetByName:按名删除且保序", () => {
    assert(
      JSON.stringify(removed.map((/** @type {{ name: string }} */ p) => p.name)) === JSON.stringify(["a", "c"]),
      "按名删除且保序",
    );
  });
  await suite.case("removeCustomPresetByName:无匹配 → 原列表;空列表 → 空数组", () => {
    assert(removeCustomPresetByName(list, "不存在").length === 3, "无匹配 → 原列表");
    assert(removeCustomPresetByName([], "a").length === 0, "空列表 → 空数组");
  });
  console.log("[ok] removeCustomPresetByName:按名删除保序/无匹配/空列表 断言通过");

  // ---------- parseMarginValue(边距输入解析+钳制) ----------
  await suite.case("parseMarginValue:有限数钳制,NaN / Infinity → null", () => {
    assert(parseMarginValue(12.5) === 12.5, "有限数 → 原值");
    assert(parseMarginValue(-5) === 0, "负数 → 钳 0");
    assert(parseMarginValue(1001) === 1000, "超上限 → 钳 1000");
    assert(parseMarginValue(NaN) === null, "NaN → null");
    assert(parseMarginValue(Infinity) === null, "Infinity → null");
  });
  console.log("[ok] parseMarginValue:有限数钳制/NaN/Infinity → null 断言通过");

  // ---------- validateNumberRange(字号/行距范围校验) ----------
  await suite.case("validateNumberRange:范围内/边界 → true,越界与 NaN → false", () => {
    assert(validateNumberRange(12, 8, 24) === true, "范围内 → true");
    assert(validateNumberRange(8, 8, 24) === true, "下边界 → true");
    assert(validateNumberRange(24, 8, 24) === true, "上边界 → true");
    assert(validateNumberRange(7.9, 8, 24) === false, "低于下限 → false");
    assert(validateNumberRange(24.1, 8, 24) === false, "高于上限 → false");
    assert(validateNumberRange(NaN, 8, 24) === false, "NaN → false");
  });
  console.log("[ok] validateNumberRange:范围内/边界/越界/NaN 断言通过");

  // ---------- settingsToControlValues(设置对象 → 控件回填值映射) ----------
  // 整对象按 AppSettings 标注(ADR-069:类型面与被测物归一后的直接收益)—— 此前这份夹具
  // 是裸字面量,`format` / `paper` / `orientation` / `align` / `afterConvert` 全被推成
  // `string`,而契约要的是各自的字面量并集。指 `src/` 时这层不匹配被推断掩盖,指 `dist/`
  // 后立刻判红:那正是「测试跑的是产物、类型查的是源码」这个错配被拆穿的样子。
  const customSettings = /** @type {AppSettings} */ ({
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
  });
  const cv = controlValues(customSettings);
  // 取数(其余各组回填映射 + 声明表)留在 case 外:键集对账要用到它们
  const eqOffCv = controlValues({
    ...DEFAULT_SETTINGS,
    equationNumbering: false,
  });
  const leftCv = controlValues({
    ...DEFAULT_SETTINGS,
    typography: { ...DEFAULT_SETTINGS.typography, align: "left" },
  });
  const emptyDirCv = controlValues(DEFAULT_SETTINGS);
  const darkCv = controlValues({ ...DEFAULT_SETTINGS, theme: "dark" });
  const tierOnCv = controlValues(DEFAULT_SETTINGS);
  const tierOffCv = controlValues({
    ...DEFAULT_SETTINGS,
    aiCleanup: { enabled: true, tidy: false, rewrite: true },
    obsidian: { compat: true, attachmentFolder: "Assets" },
  });
  await suite.case("settingsToControlValues:paper/orientation、四条边距、字号/行距映射(数值转字符串)", () => {
    assert(cv.paper === "A3" && cv.orientation === "landscape", "paper/orientation 映射");
    // 边距四条各自成条目(不再聚成 margins 子表):控件与键一一对应,
    // 故回填值映射也是一条控件一个键
    assert(
      cv.marginTop === "30.5" &&
        cv.marginBottom === String(DEFAULT_SETTINGS.pageSetup.marginBottom) &&
        cv.marginLeft === String(DEFAULT_SETTINGS.pageSetup.marginLeft) &&
        cv.marginRight === String(DEFAULT_SETTINGS.pageSetup.marginRight),
      "四条边距转字符串",
    );
    assert(cv.bodySizePt === "14" && cv.lineSpacing === "1.25", "字号/行距转字符串");
  });
  await suite.case("settingsToControlValues:align / afterConvert / format / equationNumbering / pdfCss 映射", () => {
    assert(cv.align === "justify", "align=justify → 枚举原样映射");
    assert(cv.afterConvert === "open" && cv.format === "pdf", "afterConvert/format 映射");
    assert(cv.equationNumbering === true, "equationNumbering 映射(默认 true)");
    assert(cv.pdfCss === DEFAULT_SETTINGS.pdfCss, "pdfCss 映射(回填曾绕过回显类型直读 settings)");
    assert(eqOffCv.equationNumbering === false, "equationNumbering=false 应映射为 false");
    assert(leftCv.align === "left", "align=left → 枚举原样映射");
  });
  await suite.case("settingsToControlValues:path-chip(输出目录 / 页眉 logo)不入回显值映射", () => {
    // 输出目录与页眉 logo 不在此映射里:它们是 path-chip,展示文本(占位文案 / 文件名)
    // 不是设置值本身,原先的 outputDirText / headerLogoPath 两个字段是回填根本不消费的死字段
    assert(
      !("outputDir" in emptyDirCv) && !("headerLogoPath" in emptyDirCv),
      "path-chip 不应进回显值映射(此前的两个死字段已随派生消失)",
    );
    assert(outputDirDisplayText("C:\\out") === "C:\\out", "非空输出目录原样");
    assert(outputDirDisplayText("") === "与源文件相同目录", "空输出目录 → 占位文案");
    assert(
      headerLogoDisplayName("C:\\img\\logo.png") === "logo.png" && headerLogoDisplayName("") === "",
      "logo 路径 → 文件名(与两个分隔符)",
    );
  });
  await suite.case("settingsToControlValues:theme 默认 system、显式 dark 原样映射", () => {
    assert(emptyDirCv.theme === "system", "theme 默认映射为 system");
    assert(darkCv.theme === "dark", "theme=dark 应原样映射");
  });
  await suite.case("settingsToControlValues:AI 清理总开关与两档各自映射,互不影响", () => {
    // AI 清理两档:两个档位各自映射,互不影响(回填层不得把两档并成一个值)
    assert(
      tierOnCv.aiCleanup === false && tierOnCv.aiCleanupTidy === true && tierOnCv.aiCleanupRewrite === true,
      "总开关默认关、两档默认开应分别映射",
    );
    assert(
      tierOffCv.aiCleanup === true && tierOffCv.aiCleanupTidy === false && tierOffCv.aiCleanupRewrite === true,
      "只关保守规整档时,总开关与结构改写档应不受影响",
    );
  });
  await suite.case("settingsToControlValues:obsidian 两字段映射到各自的平级控件值", () => {
    assert(
      tierOffCv.obsidianCompat === true && tierOffCv.obsidianAttachmentFolder === "Assets",
      "obsidian 两字段应从分组对象映射到各自的平级控件值",
    );
  });
  // 派生类型是真的派生:从 AppSettings 加一个字段而不进声明表,下面这行即编译报错
  // (逐条 read 的返回类型即映射值的类型,故错值/漏键都被 typecheck 判掉)
  // 键集逐条对账:每条声明的值控件都必须在此映射里有一个键,且不多不少 ——
  // 漏一条(忘记声明)与多一条(声明了却没进映射)都判红
  const table = await import("../../dist/renderer/settings/settings-controls-table.js");
  // dist 为编译产物、元素可空推断出 undefined,故整表取形状一次(放宽理由同 controlValues)
  // dist 为编译产物、整表是只读的(`Object.freeze` 推成 readonly)—— 目标类型也写 readonly,
  // 否则「可变数组」的目标类型本身不成立,这条 cast 会被判红(不是被测物有问题)
  const tableRows = /** @type {readonly { kind: string; key: string }[]} */ (table.controlTable());
  const declaredValueKeys = tableRows
    .filter((r) => r.kind === "value")
    .map((r) => r.key)
    .sort();
  const mappedKeys = Object.keys(emptyDirCv).sort();
  await suite.case("settingsToControlValues:回显值映射的键集与声明表的值控件条目一致(不多不少)", () => {
    assert(
      JSON.stringify(declaredValueKeys) === JSON.stringify(mappedKeys),
      `回显值映射的键集应与声明表的值控件条目一致:多 ${JSON.stringify(mappedKeys.filter((k) => !declaredValueKeys.includes(k)))},少 ${JSON.stringify(declaredValueKeys.filter((k) => !mappedKeys.includes(k)))}`,
    );
  });
  console.log(
    `[ok] settingsToControlValues:全字段映射/数值转字符串/align 判定/pdfCss 纳入/path-chip 不入/theme 映射/键集与声明表一致 断言通过`,
  );

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
  // `@type {const}` 断言保住两个字面量(`@type {const}` 是 TS 5.0+ 的 JSDoc 写法):
  // 裸数组字面量在 for-of 里会被推成 `string[]`,而契约要的是 ThemePreference。
  // ⚠ 每个 theme 一个 case:light 判红不该让 dark 的判定不跑
  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await suite.case(`applyThemeOn:theme=${theme} 设 data-theme 属性`, () => {
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
    });
  }
  // system → 移除 data-theme 属性(CSS @media prefers-color-scheme 接管)
  await suite.case("applyThemeOn:theme=system 移除 data-theme 属性(交回 CSS media 查询)", () => {
    const sysTarget = makeTarget();
    applyThemeOn(sysTarget, "system");
    const removeCall = recordAt(sysTarget.calls, 0);
    assert(
      sysTarget.calls.length === 1 &&
        removeCall[0] === "remove" &&
        removeCall[1] === "data-theme",
      "theme=system 应移除 data-theme 属性",
    );
  });
  console.log("[ok] applyThemeOn:light/dark 设属性/system 移除属性 断言通过");

  return { cases: suite.results };
}