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
 */
import {
  MAX_CUSTOM_PRESETS,
  TEMPLATE_PRESETS,
} from "../../dist/core/settings-defaults.js";
import {
  CUSTOM_PRESET_ID_PREFIX,
  allPresets,
  clampMargin,
  customPresetNameFromId,
  customPresetToTemplate,
  resolvePresetSelection,
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
    validatePresetName("新模板", full) === `已达 ${MAX_CUSTOM_PRESETS} 个上限，请先删除`,
    `达上限应返回「已达 ${MAX_CUSTOM_PRESETS} 个上限,请先删除」(全角逗号)`,
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
}