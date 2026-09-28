// @ts-check
/**
 * 设置抽屉逐控件基线段(步 03-0 的行为护栏):
 *
 * 这批断言是**步 03 表驱动重构的基线** —— 重构后必须仍然全绿,故它们必须是
 * 真行为断言(跑真函数、看真 DOM 结果),而非「源文本正则存在」这类文本检查。
 * 覆盖三条行为,每个控件一条,共 43 个值控件(6 个 data-group × 抽屉内 + 3 个抽屉外镜像):
 *   - hydrate:给一份已知 settings 跑 applySettingsToControls,逐控件断言 DOM 值;
 *   - bind:逐控件模拟 change,断言写回 state.settings 且走了 persistSettings 通道;
 *   - reset:跑抽屉「恢复默认」,断言该重置的回到 DEFAULT_SETTINGS、刻意不重置的
 *     (format / theme / language / customPresets)保持原值;并单测 outputDirReset
 *     只清 outputDir、不动其他。
 *
 * DOM 来自**真实 index.html**:本段解析 index.html 得到 id 集合与每个
 * `input[name=…]` 分段(radio)组的成员,据此给 dom-stub 播种元素属性与选择器命中。
 * 控件的 HTML 初值(checked/value)刻意与基线 settings 不同 —— 断言因此是「回填把
 * 控件改成了设置值」而非「控件本来就是这个值」,回填漏一个字段即判红。
 *
 * 3 个手写门控(页眉自定义折叠 + inert / AI 清理分档灰禁 / 目录模式 .hidden)在本段
 * 做**关闭态与开启态双向**行为断言,且同时覆盖 change 接线与回填两条路径(取代
 * ui-interaction-guards 里针对这两处的源文本正则)。
 *
 * 另含 refs↔index.html 的控件 id 交叉校验(拼错即红)与 radio 组零命中守护 ——
 * 两者与逐控件断言同属「控件 id 拼错能在测试期暴露」的判据,放本段便于共用同一
 * 份 index.html 解析。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDomStub, makeElement, makeClassList, fireListener } from "./dom-stub.js";
// 单向读几何规格(纯规格文件,不反向依赖生产侧:见 assertTableContract 的注)
import {
  DRAWER_CONTROL_KEYS,
  DRAWER_GROUP_BY_KEY,
} from "../tools/geometry/geometry-spec.mjs";

/**
 * 断言失败即抛错;声明为断言函数使类型收窄。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`settings-controls 断言失败:${msg}`);
}

/**
 * 深比较(复位保留类断言要比较整块设置,不能只比引用)。
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 沿点分路径读对象字段。
 * @param {Record<string, unknown>} root
 * @param {string[]} keys
 * @returns {unknown}
 */
function getPath(root, keys) {
  return keys.reduce(
    (acc, k) => (acc && typeof acc === "object" ? (/** @type {Record<string, unknown>} */ (acc))[k] : undefined),
    /** @type {unknown} */ (root),
  );
}

// ---------- index.html 解析(元素属性 + radio 分段组) ----------

/**
 * 解析标签属性串为键值对。
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseAttrs(text) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    attrs[name.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/**
 * 从 HTML 抽出全部开始标签(剥注释与 script 体,避免正文里的尖括号干扰)。
 * @param {string} src
 * @returns {{ tag: string; attrs: Record<string, string>; offset: number }[]}
 */
function parseTags(src) {
  const body = src.slice(src.indexOf("<body"));
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  /** @type {{ tag: string; attrs: Record<string, string>; offset: number }[]} */
  const out = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    out.push({ tag: name.toLowerCase(), attrs: parseAttrs(m[2] ?? ""), offset: m.index });
  }
  return out;
}

/**
 * 元素初始属性 → dom-stub 元素字段。
 * @param {Record<string, string>} attrs
 * @returns {Record<string, unknown>}
 */
function propsOf(attrs) {
  return {
    value: attrs.value ?? "",
    checked: attrs.checked !== undefined,
    disabled: attrs.disabled !== undefined,
    className: attrs.class ?? "",
    inert: attrs.inert !== undefined,
    classList: makeClassList((attrs.class ?? "").split(/\s+/).filter(Boolean)),
  };
}

// ---------- 基线 settings(逐字段刻意偏离 HTML 初值与默认值) ----------

/** 抽屉「恢复默认」不重置的字段(刻意白名单:应用偏好与自定义预设保留)。 */
const PRESERVED_KEYS = ["version", "format", "customPresets", "language", "theme"];

const BASE = {
  version: 1,
  format: "pdf",
  pageSetup: { paper: "A3", orientation: "landscape", marginTop: 31, marginBottom: 32, marginLeft: 33, marginRight: 34 },
  typography: {
    fontAscii: "Georgia", fontEastAsia: "仿宋", bodySizePt: 16, lineSpacing: 1.75,
    firstLineIndent: true, align: "left", headingNumbering: true, captionNumbering: true,
    headingScale: "spacious", headingSpacing: "compact",
  },
  breakBeforeH1: true,
  toc: true,
  tocMode: "field",
  equationNumbering: true,
  afterConvert: "open",
  outputDir: "C:\\out\\x",
  // 自定义预设刻意取「与默认设置全等」的快照:resolvePresetSelection 只在预设**匹配**
  // 当前设置时才保持选中(不匹配会被 find 弹回),故复位后要断言它仍可选回,快照必须
  // 与默认一致。此处占位,值在拿到 DEFAULT_SETTINGS 后回填(避免复制默认值字面量)。
  customPresets: /** @type {any[]} */ ([]),
  pdfCss: "body{color:red}",
  language: "en",
  theme: "dark",
  headerFooter: {
    headerMode: "custom", headerText: "Header", headerLogoPath: "C:\\img\\logo.png",
    headerLayout: "leftRight", footerEnabled: true,
  },
  watermark: { text: "W", angle: 45, opacity: 0.5, gray: true },
  aiCleanup: { enabled: true, tidy: true, rewrite: true },
  obsidian: { compat: true, attachmentFolder: "att" },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
/** @param {string} rel @returns {string} */
const distUrl = (rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;

// 显式声明本段无验收样例
export const fixtures = null;

/**
 * 负探针故障注入开关(默认空 = 关闭,CI 全程不生效)。
 * 设 M2W_PROBE=<模式> 会在**断言代码完全不变**的前提下,只把某个「输入」改坏,
 * 用来自证对应那条护栏真会变红(改完记得撤销本开关的说明或保留为回归入口):
 *   - ref-id         :把 refs.ts 源码里一个 getElementById 的 id 改成不存在的值
 *                     → 期望红在「控件 id 交叉校验」;
 *   - ref-radio      :把一个 radio 组选择器的 name 改成 index.html 里不存在的组
 *                     → 期望红在「radio 组零命中守护」(模拟静默空转);
 *   - control-expect :<控件名> 把某个控件的**期望值**改错(断言逻辑不动)
 *                     → 期望红在该控件的逐条 hydrate 断言上。
 *   - unhook:<id>    :把某个值控件的 change 监听**摘掉**(只改输入:移除该元素上登记的
 *                     监听器,断言逻辑不动)
 *                     → 期望红在该控件的逐条 bind 断言(表里有条目 ≠ 真的挂了监听)。
 *   - mislabel       :把某个条目的 reset 口径**误标**成 reset(theme 改为 reset)
 *                     → 期望红在「保留集双向一致」断言。
 *   - drop-entry     :从表里删掉一条条目(tocMode)
 *                     → 期望红在「控件在声明表里没有条目」。
 *   - drop-reset     :给设置契约加一个没有表条目的顶层键(新增设置忘登记的事故形态)
 *                     → 期望红在「顶层键既不在声明表的块里、也不在无控件键清单里」
 *                     (复位块覆盖判据)。
 *   - unregister-gate:把 tocModeVisibility 这条门控从 CONTROL_GATES 登记里摘掉
 *                     → 期望红在「关掉自动目录:change 路径应同步收起目录下拉」
 *                     (门控的 change 侧接缝按登记反查,摘掉即静默不生效)。
 * 用法:M2W_ONLY=settings-controls M2W_PROBE=ref-id npm run test
 */
const PROBE = process.env.M2W_PROBE ?? "";

/**
 * 声明表的一行(dist 编译产物,无类型标注;形状与生产侧 ControlRow 一一对应)。
 * @typedef {object} ControlRow
 * @property {string} key 控件键
 * @property {string} kind 形态:value / chip / derived
 * @property {string} group 所属抽屉组("mirror" = 抽屉外镜像与顶栏控件)
 * @property {string} reset 复位处置:reset / preserve / derived
 * @property {string | null} block 顶层块(派生键为 null)
 * @property {string[]} ids 元素 id 集合
 * @property {string[]} radioNames radio 组名集合
 * @property {boolean} hooked 是否声明了写侧钩子
 */

/**
 * 登记在生产侧声明表里的一条「设置值驱动的显隐/文案」效果(dist 无类型标注)。
 * @typedef {object} ValueDrivenEffect
 * @property {string} id 效果键
 * @property {string[]} sources 驱动源(设置控件键)
 * @property {{ target: string; effect: string }[]} sites 落点展示位与处置形态
 * @property {string} where 实现落点
 */

/**
 * 逐控件用例。
 * @typedef {object} Control
 * @property {string} name 控件名(index.html id 或 radio 组 name)
 * @property {string} group 所属抽屉组(镜像控件标 "mirror")
 * @property {() => unknown} get 读当前 DOM 值(hydrate / reset 断言用)
 * @property {(s: any) => unknown} expect 给定设置,该控件应有的 DOM 值
 * @property {(v: any) => void | Promise<void>} drive 模拟一次用户 change,写入 v
 * @property {any} bindValue drive 后期望 state.settings 落地的值
 * @property {any} [driveValue] 写入控件的值;缺省用 bindValue(预设 select 写的是预设 id,与落地字段不同)
 * @property {string[]} statePath drive 后期望 state.settings 该路径的值 === bindValue
 * @property {string} patchKey drive 后期望 persistSettings payload 含此键
 * @property {string} [patchField] 若为块级写回,payload[patchKey][patchField] === bindValue
 * @property {boolean} inReset 是否属抽屉「恢复默认」的复位集
 * @property {string[]} [resetPath] 复位后该路径应 === DEFAULT_SETTINGS 同路径
 */

export async function run() {
  const indexHtml = fs.readFileSync(path.join(repoRoot, "src", "renderer", "index.html"), "utf8");
  const tags = parseTags(indexHtml);
  const drawerOffset = tags.find((t) => t.attrs.id === "settingsDrawer")?.offset ?? Infinity;

  /** @type {Map<string, Record<string, unknown>>} */
  const idProps = new Map();
  /** @type {Map<string, { el: any; inDrawer: boolean }[]>} */
  const groups = new Map();
  /** @type {Set<string>} */
  const htmlIds = new Set();
  for (const { tag, attrs, offset } of tags) {
    if (attrs.id) {
      htmlIds.add(attrs.id);
      idProps.set(attrs.id, propsOf(attrs));
    }
    if (tag === "input" && attrs.name) {
      const list = groups.get(attrs.name) ?? [];
      list.push({ el: makeElement(propsOf(attrs)), inDrawer: offset > drawerOffset });
      groups.set(attrs.name, list);
    }
  }

  /** @type {Record<string, any[]>} */
  const selectorGroups = {};
  for (const [name, list] of groups) selectorGroups[`input[name="${name}"]`] = list.map((x) => x.el);

  // persistSettings 通道记录器
  let savedCount = 0;
  /** @type {any} */
  let lastPatch = null;

  const dist = (/** @type {string} */ rel) => distUrl(rel);

  // ⚠️ 先装 stub 再 import dist:dist 的 dom/refs.js 在**模块求值期**就调
  // document.getElementById,document 必须在 import 之前就位。api 里的闭包引用
  // 下方才声明的 state / mergeSettingsWithDefaults —— 只在测试执行期(此时已赋值)
  // 才被调用,故无 TDZ 问题。
  const dom = installDomStub({
    api: {
      // settingsSet 回传「合并后的权威设置」——与 main 行为一致;否则 applyAuthoritative
      // 会用返回值覆盖 state,「复位保留」类断言会失真。
      settingsSet: async (/** @type {any} */ patch) => {
        savedCount++;
        lastPatch = patch;
        return mergeSettingsWithDefaults({ ...state.settings, ...patch });
      },
      settingsGet: async () => structuredClone(BASE),
      previewRefresh: async () => {},
      uiStateSet: async () => ({}),
      selectDir: async () => "C:\\picked",
      selectHeaderLogo: async () => "C:\\img\\picked.png",
    },
    elementProps: (id) => idProps.get(id),
    selectorGroups,
  });

  const { mergeSettingsWithDefaults, outputDirDisplayText, headerLogoDisplayName } =
    await import(dist("renderer/settings/settings-logic.js"));
  const table = await import(dist("renderer/settings/settings-controls-table.js"));
  const { state } = await import(dist("renderer/state/state.js"));
  // t / setLanguage 在 i18n 逻辑层(core/i18n.js);注册表 index.js 只有 DICT/LANGUAGES
  const i18n = await import(dist("core/i18n.js"));
  const panel = await import(dist("renderer/settings/settings-panel.js"));
  const bindings = await import(dist("renderer/settings/settings-bindings.js"));
  const { DEFAULT_SETTINGS } = await import(dist("core/settings/settings-defaults.js"));
  const { TEMPLATE_PRESETS } = await import(dist("core/settings/presets.js"));

  /** 取 id 元素 */
  const el = (/** @type {string} */ id) => dom.elementFor(id);
  /** radio 组某成员集合(抽屉内);抽屉外组(如顶栏 format)退回全组 */
  const radioScope = (/** @type {string} */ name) => {
    const drawer = (groups.get(name) ?? []).filter((x) => x.inDrawer).map((x) => x.el);
    return drawer.length > 0 ? drawer : (groups.get(name) ?? []).map((x) => x.el);
  };
  /** radio 组当前选中值 */
  const checkedRadio = (/** @type {string} */ name) => {
    const checked = radioScope(name).filter((i) => i.checked);
    return checked.length === 1 ? checked[0].value : checked.map((i) => i.value);
  };
  /** 模拟浏览器点选一枚 radio:同组互斥(先全不选中,再选中目标)后派发 change */
  const clickRadio = (/** @type {string} */ name, /** @type {string} */ value) => {
    const scope = radioScope(name);
    const target = scope.find((i) => i.value === value);
    assert(target, `radio 组 ${name} 里没有值为 ${value} 的成员(index.html 与声明不一致)`);
    for (const i of scope) i.checked = i === target;
    fireListener(/** @type {any} */ (target), "change");
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** 把内存设置恢复为基线并回填 */
  const rehydrate = () => {
    state.settings = structuredClone(BASE);
    i18n.setLanguage(BASE.language);
    panel.applySettingsToControls();
  };

  // 自定义预设快照取默认设置(见 BASE.customPresets 注记),不复制默认值字面量
  BASE.customPresets = [
    {
      name: "我的预设",
      typography: { ...DEFAULT_SETTINGS.typography },
      pageSetup: { ...DEFAULT_SETTINGS.pageSetup },
    },
  ];

  // 预设下拉选项先就位(与 loadSettings 同序)
  state.settings = structuredClone(BASE);
  panel.rebuildPresetOptions();
  bindings.bindSettingsEvents();

  // 负探针 · unhook:<控件 id>:**摘掉**某个值控件的 change 监听(只改输入:把该元素上
  // 登记的监听器移除,断言逻辑一行不动)。表驱动收敛后「表里有条目」与「真的挂了监听」
  // 是两件事 —— 这条探针证明逐控件 bind 断言测的是后者:摘掉后该控件的 drive 必然红。
  if (PROBE.startsWith("unhook:")) {
    const target = PROBE.slice("unhook:".length);
    el(target).removeEventListener("change");
  }

  /* ---------- 逐控件表(43 个值控件) ---------- */
  /** @type {Control[]} */
  const controls = [];
  /** 追加一个控件 */
  const add = (/** @type {Control} */ c) => { controls.push(c); };

  // ── preset 组 ──
  add({
    name: "templatePreset", group: "preset",
    get: () => el("templatePreset").value,
    expect: () => "default",
    drive: (v) => { el("templatePreset").value = v; fireListener(el("templatePreset"), "change"); },
    driveValue: "business",
    bindValue: 11, // business 预设正文字号
    statePath: ["typography", "bodySizePt"],
    patchKey: "typography", patchField: "bodySizePt",
    inReset: false, // 派生控件:随 typography/pageSetup 复位,无独立字段
  });
  add({
    name: "quickPreset", group: "mirror",
    get: () => el("quickPreset").value,
    expect: () => "default",
    drive: (v) => { el("quickPreset").value = v; fireListener(el("quickPreset"), "change"); },
    driveValue: "official-cn",
    bindValue: 16, // official-cn 预设正文字号
    statePath: ["typography", "bodySizePt"],
    patchKey: "typography", patchField: "bodySizePt",
    inReset: false,
  });

  // ── typography 组 ──
  add({
    name: "paper", group: "typography",
    get: () => checkedRadio("paper"),
    expect: (s) => s.pageSetup.paper,
    drive: (v) => clickRadio("paper", v),
    bindValue: "Legal", statePath: ["pageSetup", "paper"],
    patchKey: "pageSetup", patchField: "paper", inReset: true, resetPath: ["pageSetup", "paper"],
  });
  add({
    name: "orientation", group: "typography",
    get: () => checkedRadio("orientation"),
    expect: (s) => s.pageSetup.orientation,
    drive: (v) => clickRadio("orientation", v),
    bindValue: "portrait", statePath: ["pageSetup", "orientation"],
    patchKey: "pageSetup", patchField: "orientation", inReset: true, resetPath: ["pageSetup", "orientation"],
  });
  for (const [field, driven] of /** @type {[string, number][]} */ ([["marginTop", 21], ["marginBottom", 22], ["marginLeft", 23], ["marginRight", 24]])) {
    add({
      name: field, group: "typography",
      get: () => el(field).value,
      expect: (s) => String(s.pageSetup[field]),
      drive: (v) => { el(field).value = v; fireListener(el(field), "change"); },
      bindValue: driven, statePath: ["pageSetup", field],
      patchKey: "pageSetup", patchField: field, inReset: true, resetPath: ["pageSetup", field],
    });
  }
  add({
    name: "fontEastAsia", group: "typography",
    get: () => el("fontEastAsia").value,
    expect: (s) => s.typography.fontEastAsia,
    drive: (v) => { el("fontEastAsia").value = v; fireListener(el("fontEastAsia"), "change"); },
    bindValue: "黑体", statePath: ["typography", "fontEastAsia"],
    patchKey: "typography", patchField: "fontEastAsia", inReset: true, resetPath: ["typography", "fontEastAsia"],
  });
  add({
    name: "fontAscii", group: "typography",
    get: () => el("fontAscii").value,
    expect: (s) => s.typography.fontAscii,
    drive: (v) => { el("fontAscii").value = v; fireListener(el("fontAscii"), "change"); },
    bindValue: "Arial", statePath: ["typography", "fontAscii"],
    patchKey: "typography", patchField: "fontAscii", inReset: true, resetPath: ["typography", "fontAscii"],
  });
  add({
    name: "bodySizePt", group: "typography",
    get: () => el("bodySizePt").value,
    expect: (s) => String(s.typography.bodySizePt),
    drive: (v) => { el("bodySizePt").value = v; fireListener(el("bodySizePt"), "change"); },
    bindValue: 18, statePath: ["typography", "bodySizePt"],
    patchKey: "typography", patchField: "bodySizePt", inReset: true, resetPath: ["typography", "bodySizePt"],
  });
  add({
    name: "lineSpacing", group: "typography",
    get: () => el("lineSpacing").value,
    expect: (s) => String(s.typography.lineSpacing),
    drive: (v) => { el("lineSpacing").value = v; fireListener(el("lineSpacing"), "change"); },
    bindValue: 2, statePath: ["typography", "lineSpacing"],
    patchKey: "typography", patchField: "lineSpacing", inReset: true, resetPath: ["typography", "lineSpacing"],
  });
  add({
    name: "headingScale", group: "typography",
    get: () => checkedRadio("headingScale"),
    expect: (s) => s.typography.headingScale,
    drive: (v) => clickRadio("headingScale", v),
    bindValue: "compact", statePath: ["typography", "headingScale"],
    patchKey: "typography", patchField: "headingScale", inReset: true, resetPath: ["typography", "headingScale"],
  });
  add({
    name: "headingSpacing", group: "typography",
    get: () => checkedRadio("headingSpacing"),
    expect: (s) => s.typography.headingSpacing,
    drive: (v) => clickRadio("headingSpacing", v),
    bindValue: "spacious", statePath: ["typography", "headingSpacing"],
    patchKey: "typography", patchField: "headingSpacing", inReset: true, resetPath: ["typography", "headingSpacing"],
  });
  add({
    name: "firstLineIndent", group: "typography",
    get: () => el("firstLineIndent").checked,
    expect: (s) => s.typography.firstLineIndent,
    drive: (v) => { el("firstLineIndent").checked = v; fireListener(el("firstLineIndent"), "change"); },
    bindValue: false, statePath: ["typography", "firstLineIndent"],
    patchKey: "typography", patchField: "firstLineIndent", inReset: true, resetPath: ["typography", "firstLineIndent"],
  });
  add({
    name: "align", group: "typography",
    get: () => checkedRadio("align"),
    expect: (s) => s.typography.align,
    drive: (v) => clickRadio("align", v),
    bindValue: "justify", statePath: ["typography", "align"],
    patchKey: "typography", patchField: "align", inReset: true, resetPath: ["typography", "align"],
  });

  // ── headerwatermark 组 ──
  add({
    name: "headerMode", group: "headerwatermark",
    get: () => checkedRadio("headerMode"),
    expect: (s) => s.headerFooter.headerMode,
    drive: (v) => clickRadio("headerMode", v),
    bindValue: "none", statePath: ["headerFooter", "headerMode"],
    patchKey: "headerFooter", patchField: "headerMode", inReset: true, resetPath: ["headerFooter", "headerMode"],
  });
  add({
    name: "headerText", group: "headerwatermark",
    get: () => el("headerText").value,
    expect: (s) => s.headerFooter.headerText,
    drive: (v) => { el("headerText").value = v; fireListener(el("headerText"), "change"); },
    bindValue: "书名", statePath: ["headerFooter", "headerText"],
    patchKey: "headerFooter", patchField: "headerText", inReset: true, resetPath: ["headerFooter", "headerText"],
  });
  add({
    name: "headerLogoPath", group: "headerwatermark",
    get: () => el("headerLogoStatus").textContent,
    expect: (s) => headerLogoDisplayName(s.headerFooter.headerLogoPath) || i18n.t("settings.headerLogoNone"),
    // 走「选择图片…」按钮(主路径):选完回写路径并持久化;不得先点清除(那是另一条
    // 写入路径,会让本控件一次 drive 触发两次 settingsSet)
    drive: async () => { fireListener(el("headerLogoPick"), "click"); await flush(); },
    bindValue: "C:\\img\\picked.png", statePath: ["headerFooter", "headerLogoPath"],
    patchKey: "headerFooter", patchField: "headerLogoPath", inReset: true, resetPath: ["headerFooter", "headerLogoPath"],
  });
  add({
    name: "headerLayout", group: "headerwatermark",
    get: () => checkedRadio("headerLayout"),
    expect: (s) => s.headerFooter.headerLayout,
    drive: (v) => clickRadio("headerLayout", v),
    bindValue: "center", statePath: ["headerFooter", "headerLayout"],
    patchKey: "headerFooter", patchField: "headerLayout", inReset: true, resetPath: ["headerFooter", "headerLayout"],
  });
  add({
    name: "footerEnabled", group: "headerwatermark",
    get: () => el("footerEnabled").checked,
    expect: (s) => s.headerFooter.footerEnabled,
    drive: (v) => { el("footerEnabled").checked = v; fireListener(el("footerEnabled"), "change"); },
    bindValue: false, statePath: ["headerFooter", "footerEnabled"],
    patchKey: "headerFooter", patchField: "footerEnabled", inReset: true, resetPath: ["headerFooter", "footerEnabled"],
  });
  add({
    name: "watermarkText", group: "headerwatermark",
    get: () => el("watermarkText").value,
    expect: (s) => s.watermark.text,
    drive: (v) => { el("watermarkText").value = v; fireListener(el("watermarkText"), "change"); },
    bindValue: "机密", statePath: ["watermark", "text"],
    patchKey: "watermark", patchField: "text", inReset: true, resetPath: ["watermark", "text"],
  });
  add({
    name: "watermarkAngle", group: "headerwatermark",
    get: () => el("watermarkAngle").value,
    expect: (s) => String(s.watermark.angle),
    drive: (v) => { el("watermarkAngle").value = v; fireListener(el("watermarkAngle"), "change"); },
    bindValue: 90, statePath: ["watermark", "angle"],
    patchKey: "watermark", patchField: "angle", inReset: true, resetPath: ["watermark", "angle"],
  });
  add({
    name: "watermarkOpacity", group: "headerwatermark",
    get: () => el("watermarkOpacity").value,
    expect: (s) => String(s.watermark.opacity),
    drive: (v) => { el("watermarkOpacity").value = v; fireListener(el("watermarkOpacity"), "change"); },
    bindValue: 0.8, statePath: ["watermark", "opacity"],
    patchKey: "watermark", patchField: "opacity", inReset: true, resetPath: ["watermark", "opacity"],
  });
  add({
    name: "watermarkGray", group: "headerwatermark",
    get: () => el("watermarkGray").checked,
    expect: (s) => s.watermark.gray,
    drive: (v) => { el("watermarkGray").checked = v; fireListener(el("watermarkGray"), "change"); },
    bindValue: false, statePath: ["watermark", "gray"],
    patchKey: "watermark", patchField: "gray", inReset: true, resetPath: ["watermark", "gray"],
  });

  // ── numbering 组 ──
  add({
    name: "headingNumbering", group: "numbering",
    get: () => el("headingNumbering").checked,
    expect: (s) => s.typography.headingNumbering,
    drive: (v) => { el("headingNumbering").checked = v; fireListener(el("headingNumbering"), "change"); },
    bindValue: false, statePath: ["typography", "headingNumbering"],
    patchKey: "typography", patchField: "headingNumbering", inReset: true, resetPath: ["typography", "headingNumbering"],
  });
  add({
    name: "captionNumbering", group: "numbering",
    get: () => el("captionNumbering").checked,
    expect: (s) => s.typography.captionNumbering,
    drive: (v) => { el("captionNumbering").checked = v; fireListener(el("captionNumbering"), "change"); },
    bindValue: false, statePath: ["typography", "captionNumbering"],
    patchKey: "typography", patchField: "captionNumbering", inReset: true, resetPath: ["typography", "captionNumbering"],
  });
  add({
    name: "equationNumbering", group: "numbering",
    get: () => el("equationNumbering").checked,
    expect: (s) => s.equationNumbering,
    drive: (v) => { el("equationNumbering").checked = v; fireListener(el("equationNumbering"), "change"); },
    bindValue: false, statePath: ["equationNumbering"],
    patchKey: "equationNumbering", inReset: true, resetPath: ["equationNumbering"],
  });
  add({
    name: "toc", group: "numbering",
    get: () => el("toc").checked,
    expect: (s) => s.toc,
    drive: (v) => { el("toc").checked = v; fireListener(el("toc"), "change"); },
    bindValue: false, statePath: ["toc"],
    patchKey: "toc", inReset: true, resetPath: ["toc"],
  });
  add({
    name: "tocMode", group: "numbering",
    get: () => el("tocMode").value,
    expect: (s) => s.tocMode,
    drive: (v) => { el("tocMode").value = v; fireListener(el("tocMode"), "change"); },
    bindValue: "static", statePath: ["tocMode"],
    patchKey: "tocMode", inReset: true, resetPath: ["tocMode"],
  });
  add({
    name: "breakBeforeH1", group: "numbering",
    get: () => el("breakBeforeH1").checked,
    expect: (s) => s.breakBeforeH1,
    drive: (v) => { el("breakBeforeH1").checked = v; fireListener(el("breakBeforeH1"), "change"); },
    bindValue: false, statePath: ["breakBeforeH1"],
    patchKey: "breakBeforeH1", inReset: true, resetPath: ["breakBeforeH1"],
  });

  // ── convert 组 ──
  add({
    name: "aiCleanup", group: "convert",
    get: () => el("aiCleanup").checked,
    expect: (s) => s.aiCleanup.enabled,
    drive: (v) => { el("aiCleanup").checked = v; fireListener(el("aiCleanup"), "change"); },
    bindValue: false, statePath: ["aiCleanup", "enabled"],
    patchKey: "aiCleanup", patchField: "enabled", inReset: true, resetPath: ["aiCleanup", "enabled"],
  });
  add({
    name: "aiCleanupTidy", group: "convert",
    get: () => el("aiCleanupTidy").checked,
    expect: (s) => s.aiCleanup.tidy,
    drive: (v) => { el("aiCleanupTidy").checked = v; fireListener(el("aiCleanupTidy"), "change"); },
    bindValue: false, statePath: ["aiCleanup", "tidy"],
    patchKey: "aiCleanup", patchField: "tidy", inReset: true, resetPath: ["aiCleanup", "tidy"],
  });
  add({
    name: "aiCleanupRewrite", group: "convert",
    get: () => el("aiCleanupRewrite").checked,
    expect: (s) => s.aiCleanup.rewrite,
    drive: (v) => { el("aiCleanupRewrite").checked = v; fireListener(el("aiCleanupRewrite"), "change"); },
    bindValue: false, statePath: ["aiCleanup", "rewrite"],
    patchKey: "aiCleanup", patchField: "rewrite", inReset: true, resetPath: ["aiCleanup", "rewrite"],
  });
  add({
    name: "obsidianCompat", group: "convert",
    get: () => el("obsidianCompat").checked,
    expect: (s) => s.obsidian.compat,
    drive: (v) => { el("obsidianCompat").checked = v; fireListener(el("obsidianCompat"), "change"); },
    bindValue: false, statePath: ["obsidian", "compat"],
    patchKey: "obsidian", patchField: "compat", inReset: true, resetPath: ["obsidian", "compat"],
  });
  add({
    name: "obsidianAttachmentFolder", group: "convert",
    get: () => el("obsidianAttachmentFolder").value,
    expect: (s) => s.obsidian.attachmentFolder,
    drive: (v) => { el("obsidianAttachmentFolder").value = v; fireListener(el("obsidianAttachmentFolder"), "change"); },
    bindValue: "附件2", statePath: ["obsidian", "attachmentFolder"],
    patchKey: "obsidian", patchField: "attachmentFolder", inReset: true, resetPath: ["obsidian", "attachmentFolder"],
  });
  add({
    name: "outputDir", group: "convert",
    get: () => el("outputDirValue").textContent,
    expect: (s) => outputDirDisplayText(s.outputDir),
    drive: async () => { fireListener(el("outputDirPick"), "click"); await flush(); },
    bindValue: "C:\\picked", statePath: ["outputDir"],
    patchKey: "outputDir", inReset: true, resetPath: ["outputDir"],
  });
  add({
    name: "afterConvert", group: "convert",
    get: () => checkedRadio("afterConvert"),
    expect: (s) => s.afterConvert,
    drive: (v) => clickRadio("afterConvert", v),
    bindValue: "show-in-folder", statePath: ["afterConvert"],
    patchKey: "afterConvert", inReset: true, resetPath: ["afterConvert"],
  });
  add({
    name: "pdfCss", group: "convert",
    get: () => el("pdfCssText").value,
    expect: (s) => s.pdfCss,
    drive: (v) => { el("pdfCssText").value = v; fireListener(el("pdfCssText"), "change"); },
    bindValue: "p{color:#00f}", statePath: ["pdfCss"],
    patchKey: "pdfCss", inReset: true, resetPath: ["pdfCss"],
  });

  // ── app 组 ──
  add({
    name: "theme", group: "app",
    get: () => checkedRadio("theme"),
    expect: (s) => s.theme,
    drive: (v) => clickRadio("theme", v),
    bindValue: "light", statePath: ["theme"],
    patchKey: "theme", inReset: false,
  });
  add({
    name: "languageSelect", group: "app",
    get: () => el("languageSelect").value,
    expect: (s) => s.language,
    drive: (v) => { el("languageSelect").value = v; fireListener(el("languageSelect"), "change"); },
    bindValue: "ja", statePath: ["language"],
    patchKey: "language", inReset: false,
  });

  // ── 抽屉外镜像 ──
  add({
    name: "quickOutputDir", group: "mirror",
    get: () => el("quickOutputDir").textContent,
    expect: (s) => outputDirDisplayText(s.outputDir),
    drive: async () => { fireListener(el("quickOutputPick"), "click"); await flush(); },
    bindValue: "C:\\picked", statePath: ["outputDir"],
    patchKey: "outputDir", inReset: true, resetPath: ["outputDir"],
  });
  add({
    name: "format", group: "mirror",
    get: () => checkedRadio("format"),
    expect: (s) => s.format,
    drive: (v) => clickRadio("format", v),
    bindValue: "docx", statePath: ["format"],
    patchKey: "format", inReset: false,
  });

  // =========================================================================
  /* ---------- 1) hydrate:逐控件回填断言 ---------- */
  // =========================================================================
  // 负探针 control-expect:<控件名>:只把该控件的**期望值**改错(断言与回填逻辑都不动),
  // 用来自证逐控件断言真有牙 —— 期望红在该控件这一条上。
  if (PROBE.startsWith("control-expect")) {
    const probeName = PROBE.slice("control-expect:".length) || "marginTop";
    const target = controls.find((c) => c.name === probeName);
    assert(target, `负探针:控件表里找不到 ${probeName}`);
    target.expect = () => "__故意写错的期望值__";
  }
  rehydrate();
  for (const c of controls) {
    assert(
      deepEqual(c.get(), c.expect(BASE)),
      `hydrate:${c.name} 回填值应为 ${JSON.stringify(c.expect(BASE))},实际 ${JSON.stringify(c.get())}`,
    );
  }

  // templatePreset/quickPreset 追踪设置:把排版+页面对齐 business 预设后,回填应选中它
  const business = TEMPLATE_PRESETS.find((/** @type {any} */ p) => p.id === "business");
  assert(business, "内置预设目录缺 business(逐控件断言的追踪探针依赖它)");
  state.settings.typography = structuredClone(business.typography);
  state.settings.pageSetup = structuredClone(business.pageSetup);
  state.settings.headerFooter = structuredClone(business.headerFooter ?? DEFAULT_SETTINGS.headerFooter);
  state.settings.watermark = structuredClone(business.watermark ?? DEFAULT_SETTINGS.watermark);
  state.settings.equationNumbering = business.equationNumbering ?? true;
  state.settings.breakBeforeH1 = business.breakBeforeH1 ?? false;
  panel.applySettingsToControls();
  assert(
    el("templatePreset").value === "business" && el("quickPreset").value === "business",
    `templatePreset/quickPreset 应追踪设置为 business,实际 ${el("templatePreset").value}/${el("quickPreset").value}`,
  );

  // =========================================================================
  /* ---------- 2) bind:逐控件 change 写回 + 持久化通道 ---------- */
  // =========================================================================
  for (const c of controls) {
    rehydrate(); // 每个控件从已知基线出发,互不污染
    const before = savedCount;
    await c.drive(c.driveValue === undefined ? c.bindValue : c.driveValue);
    // 写回内存态
    assert(
      deepEqual(getPath(state.settings, c.statePath), c.bindValue),
      `bind:${c.name} change 后 state.settings.${c.statePath.join(".")} 应为 ${JSON.stringify(c.bindValue)},实际 ${JSON.stringify(getPath(state.settings, c.statePath))}`,
    );
    // 走持久化通道
    assert(savedCount === before + 1, `bind:${c.name} 应恰好触发一次 settingsSet`);
    assert(lastPatch && c.patchKey in lastPatch, `bind:${c.name} 持久化 payload 应含 ${c.patchKey},实际 ${JSON.stringify(Object.keys(lastPatch ?? {}))}`);
    if (c.patchField) {
      assert(
        deepEqual(/** @type {any} */ (lastPatch)[c.patchKey][c.patchField], c.bindValue),
        `bind:${c.name} 持久化 payload.${c.patchKey}.${c.patchField} 应为 ${JSON.stringify(c.bindValue)},实际 ${JSON.stringify(/** @type {any} */ (lastPatch)[c.patchKey][c.patchField])}`,
      );
    } else {
      assert(
        deepEqual(lastPatch[c.patchKey], c.bindValue),
        `bind:${c.name} 持久化 payload.${c.patchKey} 应为 ${JSON.stringify(c.bindValue)},实际 ${JSON.stringify(lastPatch[c.patchKey])}`,
      );
    }
    await flush(); // 让权威回填落定,清掉异步尾巴
  }

  // =========================================================================
  /* ---------- 3) reset:抽屉「恢复默认」 ---------- */
  // =========================================================================
  rehydrate();
  const beforeReset = structuredClone(state.settings);
  savedCount = 0; lastPatch = null;
  fireListener(el("drawerResetBtn"), "click");
  await flush();
  // 3a) 该重置的字段回到 DEFAULT_SETTINGS
  for (const c of controls) {
    if (!c.inReset || !c.resetPath) continue;
    assert(
      deepEqual(getPath(state.settings, c.resetPath), getPath(DEFAULT_SETTINGS, c.resetPath)),
      `reset:${c.name} 复位后 state.settings.${c.resetPath.join(".")} 应回到默认,实际 ${JSON.stringify(getPath(state.settings, c.resetPath))}`,
    );
  }
  // 3b) 刻意不重置的字段保持原值
  for (const key of PRESERVED_KEYS) {
    assert(
      deepEqual(state.settings[key], beforeReset[key]),
      `reset:字段 ${key} 属刻意保留集,复位后应保持 ${JSON.stringify(beforeReset[key])},实际 ${JSON.stringify(state.settings[key])}`,
    );
  }
  // 3c) 复位后的持久化 payload 只含复位集(不含保留集)
  const resetPatchKeys = Object.keys(lastPatch ?? {});
  for (const key of PRESERVED_KEYS) {
    assert(!(key in (lastPatch ?? {})), `reset:复位 payload 不应含保留字段 ${key},实际键 ${resetPatchKeys.join(",")}`);
  }
  for (const key of ["pageSetup", "typography", "breakBeforeH1", "toc", "tocMode", "equationNumbering", "aiCleanup", "obsidian", "afterConvert", "outputDir", "pdfCss", "headerFooter", "watermark"]) {
    assert(resetPatchKeys.includes(key), `reset:复位 payload 应含 ${key},实际键 ${resetPatchKeys.join(",")}`);
  }
  // 3d) 复位后逐控件 DOM 与默认一致(该重置的控件真的回到了默认视图)
  for (const c of controls) {
    if (!c.inReset) continue;
    const expected = c.expect(DEFAULT_SETTINGS);
    // outputDir 复位为空 → chip 显示「与源文件相同目录」;其余按默认
    assert(
      deepEqual(c.get(), expected),
      `reset:${c.name} 复位后 DOM 应为 ${JSON.stringify(expected)},实际 ${JSON.stringify(c.get())}`,
    );
  }
  // 3e) 派生控件(无独立 reset 字段)也须随复位重算:两个预设 select 无 resetPath,
  //     但它们是回填的产物 —— 复位后应重新解析到「默认」预设,不得停在复位前的值。
  assert(
    el("templatePreset").value === "default" && el("quickPreset").value === "default",
    `reset:复位后两个预设 select 应重解析为 default,实际 ${el("templatePreset").value}/${el("quickPreset").value}`,
  );
  // 自定义预设被保留(不属复位集),故复位后仍应能选回它 —— 白名单的正向证据
  const customId = `custom:${state.settings.customPresets[0].name}`;
  el("templatePreset").value = customId;
  panel.applySettingsToControls();
  assert(
    el("templatePreset").value === customId,
    `reset:自定义预设属保留集,复位后选中它不应被弹回,实际 ${el("templatePreset").value}`,
  );

  // =========================================================================
  /* ---------- 4) outputDirReset:只清 outputDir ---------- */
  // =========================================================================
  rehydrate();
  const beforeLocal = structuredClone(state.settings);
  beforeLocal.outputDir = "C:\\zzz";
  state.settings.outputDir = "C:\\zzz";
  el("outputDirValue").textContent = "C:\\zzz";
  el("quickOutputDir").textContent = "C:\\zzz";
  savedCount = 0; lastPatch = null;
  fireListener(el("outputDirReset"), "click");
  await flush();
  assert(state.settings.outputDir === "", `outputDirReset 应把 outputDir 清空,实际 ${JSON.stringify(state.settings.outputDir)}`);
  assert(
    deepEqual(lastPatch, { outputDir: "" }),
    `outputDirReset 的持久化 payload 应恰为 {outputDir:""}(只清一项),实际 ${JSON.stringify(lastPatch)}`,
  );
  assert(
    el("outputDirValue").textContent === outputDirDisplayText("") && el("quickOutputDir").textContent === outputDirDisplayText(""),
    "outputDirReset 应同步两处 chip 为「与源文件相同目录」",
  );
  for (const key of PRESERVED_KEYS) {
    if (key === "outputDir") continue;
    assert(
      deepEqual(state.settings[key], beforeReset[key]),
      `outputDirReset 不应动保留字段 ${key}`,
    );
  }
  assert(
    deepEqual(state.settings.typography, beforeLocal.typography) &&
      deepEqual(state.settings.pageSetup, beforeLocal.pageSetup) &&
      deepEqual(state.settings.watermark, beforeLocal.watermark),
    "outputDirReset 不应动 typography/pageSetup/watermark",
  );

  // =========================================================================
  /* ---------- 5) 3 个手写门控:关闭态/开启态双向 + change/回填两条路径 ---------- */
  // =========================================================================
  const headerFields = el("headerCustomFields");
  const tidyEl = el("aiCleanupTidy");
  const rewriteEl = el("aiCleanupRewrite");
  const lockedEl = el("aiCleanupTiersLocked");
  const tocModeEl = el("tocMode");
  // 经取值函数读,避免 assert 断言函数把属性窄化到上一次的值(既有段同款处理)
  const customInert = () => headerFields.inert === true;
  const customShown = () => headerFields.classList.contains("show");
  const tierDisabled = () => [tidyEl.disabled === true, rewriteEl.disabled === true];

  // 5a) 页眉自定义折叠 + inert(回填路径)
  rehydrate(); // headerMode=custom
  assert(customShown() && !customInert(), "页眉模式 custom:自定义块应展开且可聚焦");
  state.settings.headerFooter.headerMode = "default";
  panel.applySettingsToControls();
  assert(!customShown() && customInert(), "页眉模式 default:自定义块应收起且 inert");
  state.settings.headerFooter.headerMode = "custom";
  panel.applySettingsToControls();
  assert(customShown() && !customInert(), "页眉模式回 custom:应重新展开");
  // 5a-change) 页眉模式 change 接线也重算显隐
  clickRadio("headerMode", "none");
  assert(!customShown() && customInert(), "切到 none:change 路径应同步收起自定义块");

  // 5b) AI 清理分档灰禁 + 说明行(回填路径,双向)
  rehydrate(); // aiCleanup.enabled=true
  assert(!tierDisabled().some(Boolean) && lockedEl.classList.contains("hidden"), "总开关开:分档可操作且说明行隐藏");
  state.settings.aiCleanup.enabled = false;
  panel.applySettingsToControls();
  assert(tierDisabled().every(Boolean), "总开关关:两个分档应置灰");
  assert(!lockedEl.classList.contains("hidden"), "总开关关:应出现可见置灰说明行");
  // 5b-change) 总开关 change 接线也重算可用性
  el("aiCleanup").checked = true;
  fireListener(el("aiCleanup"), "change");
  // 同步判一次(不等落盘往返):change 侧的门控调用必须当场发生 —— 异步的落权威值
  // 回填也会重算门控,只判 await flush 之后的状态会被它掩盖掉(change 侧漏接线照样绿)
  assert(!tierDisabled().some(Boolean), "重开总开关:分档应**当场**恢复可操作(change 路径,未等落盘往返)");
  assert(lockedEl.classList.contains("hidden"), "重开总开关:置灰说明行应当场消失(change 路径,未等落盘往返)");
  await flush();
  assert(!tierDisabled().some(Boolean), "重开总开关:分档应恢复可操作(change 路径)");
  assert(lockedEl.classList.contains("hidden"), "重开总开关:置灰说明行应消失");

  // 5c) 目录模式 .hidden 整块移除(回填路径,双向)
  rehydrate(); // toc=true
  assert(!tocModeEl.classList.contains("hidden"), "自动目录开:目录下拉应可见");
  state.settings.toc = false;
  panel.applySettingsToControls();
  assert(tocModeEl.classList.contains("hidden"), "自动目录关:目录下拉应整块移除");
  state.settings.toc = true;
  panel.applySettingsToControls();
  assert(!tocModeEl.classList.contains("hidden"), "自动目录回开:目录下拉应重新出现");
  // 5c-change) toc change 接线也重算显隐
  // 负探针 unregister-gate:把「目录模式可见性」这条门控**从登记里摘掉**(只改输入:
  // splice 掉 CONTROL_GATES 里的那一条,断言逻辑一行不动)—— 门控的 change 侧接缝
  // 正是按这份登记反查的,摘掉后 change 路径不再重算显隐。期望红在下面这条断言。
  if (PROBE === "unregister-gate") {
    const at = table.CONTROL_GATES.findIndex((/** @type {{ id: string }} */ g) => g.id === "tocModeVisibility");
    assert(at >= 0, "负探针 unregister-gate:CONTROL_GATES 里找不到 tocModeVisibility");
    table.CONTROL_GATES.splice(at, 1);
  }
  el("toc").checked = false;
  fireListener(el("toc"), "change");
  // 同 5b:当场判一次,不等落盘往返(否则落权威值回填的重算会掩盖 change 侧漏接线)
  assert(tocModeEl.classList.contains("hidden"), "关掉自动目录:change 路径应**当场**收起目录下拉(未等落盘往返)");
  await flush();
  assert(tocModeEl.classList.contains("hidden"), "关掉自动目录:change 路径应同步收起目录下拉");

  // =========================================================================
  /* ---------- 6) 控件 id 交叉校验 + radio 组零命中守护 ---------- */
  // =========================================================================
  // 负探针:只改坏 refs 源码(断言逻辑不动),用来自证下面这条护栏真会变红
  let refsSource = fs.readFileSync(path.join(repoRoot, "src", "renderer", "dom", "refs.ts"), "utf8");
  if (PROBE === "ref-id") {
    refsSource = refsSource.replace('getElementById("toc")', 'getElementById("tocTypo_typo")');
  } else if (PROBE === "ref-radio") {
    refsSource = refsSource.replace('input[name="paper"]', 'input[name="paperr"]');
  }
  assertRefContract(refsSource, indexHtml);

  // 负探针 · mislabel:把 theme 的复位口径**误标**成 reset(只改输入:直接改 dist 产物里
  // 的表条目,断言逻辑一行不动)。theme 属应用偏好,抽屉「恢复默认」刻意保留 ——
  // 误标后它会被算进复位集,期望红在「保留集双向一致」与「复位集 ⊆ 顶层键 − 保留集」。
  if (PROBE === "mislabel") {
    table.CONTROL_ENTRIES.theme.reset = "reset";
  }
  // 负探针 · drop-entry:从表里**删掉**一条 reset 条目(tocMode 独占 tocMode 块)。
  // 期望红在「控件在声明表里没有条目」。
  if (PROBE === "drop-entry") {
    delete table.CONTROL_ENTRIES.tocMode;
  }
  // 负探针 · drop-reset:给设置契约加一个**没有表条目**的顶层键(只改输入:往传给校验
  // 函数的 defaults 副本里塞一个新键,断言逻辑一行不动)—— 这正是「新增一项设置却忘了
  // 在表里登记」的事故形态。期望红在「顶层键既不在声明表的块里、也不在无控件键清单里
  // (复位口径漏登记)」,即复位块覆盖判据。
  const defaultsForContract =
    PROBE === "drop-reset" ? { ...DEFAULT_SETTINGS, 未登记的新键: true } : DEFAULT_SETTINGS;
  assertTableContract(table, controls, indexHtml, defaultsForContract, panel);

  dom.restore();
  console.log(
    `[ok] settings-controls:${controls.length} 个控件逐条 hydrate/bind/reset 通过 + 3 个手写门控双向(change/回填,change 侧当场判)通过 + 控件 id 交叉校验与 radio 组零命中守护通过 + 声明表与几何规格交叉校验通过 + 声明表写侧对称(每个可写条目都被 drive 过)与钩子/门控/效果登记覆盖通过`,
  );
}

/**
 * 声明表与四份既有事实的交叉校验 —— 步 03 的两条硬判据落在这里。
 *
 * 双向判据一:「每个控件都有表条目」且「每个表条目的控件 id 都在 index.html 里」。
 * 双向判据二:声明表的**抽屉内**控件键集合与 test/tools/geometry/geometry-spec.mjs 的
 * DRAWER_CONTROL_KEYS 一致(差额 3 个抽屉外镜像/顶栏控件按分工归本判据的 id 侧校验)。
 *
 * 判据一之外还有一条**写侧**的对称校验:声明表里每个可写(值控件)条目都必须
 * 真的挂了 change 监听 —— 由「逐控件 drive → 断言 state.settings 被写」反推,
 * 而不是再写一条文本正则(表里有条目但没人挂监听,只有这条会红)。
 * 另附:钩子表覆盖(声明了钩子的键必有实现)、门控与设置值驱动效果的落点一处不少
 * 且 where 指向的函数真实存在。
 *
 * ⚠️ 几何规格**不得** import 生产侧的声明表 —— 那会给纯规格文件加一条 build 顺序依赖,
 * 而「判定逻辑可在无 Electron 环境下完整验证」是它的刻意设计。故本段反向读它。
 *
 * @param {any} table 生产侧声明表模块(dist 编译产物,无类型标注)
 * @param {Control[]} controls 逐控件基线表
 * @param {string} indexHtml index.html 源码
 * @param {Record<string, unknown>} defaults DEFAULT_SETTINGS(dist 编译产物)
 * @param {any} panel 生产侧 settings-panel 模块(门控/效果的实现落点核对)
 * @returns {void} 有偏差即抛
 */
function assertTableContract(table, controls, indexHtml, defaults, panel) {
  /** @type {ControlRow[]} */
  const rows = table.controlTable();
  /** @type {Map<string, ControlRow>} */
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const htmlIds = new Set(
    parseTags(indexHtml).filter((t) => t.attrs.id).map((t) => t.attrs.id),
  );
  const htmlRadioNames = new Set(
    parseTags(indexHtml)
      .filter((t) => t.tag === "input" && t.attrs.name)
      .map((t) => /** @type {string} */ (t.attrs.name)),
  );

  // 判据一 · 正向:每个控件(逐控件基线表)都必须有表条目。
  // 镜像控件(quickOutputDir 是 outputDir chip 的镜像展示位)也算有表条目,
  // 但不要求自己是独立条目 —— 判据是「有表条目覆盖」,不是「必须独立成条」。
  const covered = new Set();
  for (const row of rows) {
    covered.add(row.key);
    for (const id of row.ids) covered.add(id);
    for (const name of row.radioNames) covered.add(name);
  }
  for (const c of controls) {
    assert(
      covered.has(c.name),
      `控件 ${c.name} 在声明表里没有条目(新增控件的成本判据:1 个表条目 + 1 个 HTML 控件)`,
    );
  }

  // 判据一 · 反向:每个表条目的 id / radio 组名都必须在 index.html 里(拼错即红)
  for (const row of rows) {
    for (const id of row.ids) {
      assert(htmlIds.has(id), `声明表条目 ${row.key} 引用了 index.html 中不存在的 id "${id}"`);
    }
    for (const name of row.radioNames) {
      assert(
        htmlRadioNames.has(name),
        `声明表条目 ${row.key} 的 radio 组名 input[name="${name}"] 在 index.html 命中 0 个元素`,
      );
    }
  }

  // 判据一 · 写侧对称:每个**值控件**条目都必须被逐控件基线 drive 过一次。
  // 逐控件 drive 走的是真 change 事件,并断言 state.settings 被写 + 走了持久化通道
  // (见上文第 2 段),故这条等值于「表里每个可写条目都真的挂了监听」——
  // 只声明不挂监听(漏接线)会红在这一条,而不是静默通过。
  const drivenNames = new Set(controls.map((c) => c.name));
  for (const row of rows) {
    if (row.kind !== "value") continue;
    assert(
      drivenNames.has(row.key),
      `值控件 ${row.key} 在声明表里可写,但逐控件基线里没有对应条目(它的 change 监听没人验证过,可能压根没挂)`,
    );
  }
  // 钩子表覆盖:声明了写侧钩子的键必有实现(缺一个即编译期红;这里再判一次运行期,
  // 因为「声明了钩子却静默走通用路径」会让钳制整段失效且运行期无任何症状)。
  const hookedKeys = table.HOOKED_WRITE_KEYS;
  assert(
    Array.isArray(hookedKeys) && hookedKeys.length > 0,
    "声明表应登记写侧钩子键(HOOKED_WRITE_KEYS),否则钳制类控件无挂载口径",
  );
  for (const row of rows) {
    const declared = hookedKeys.includes(/** @type {string} */ (row.key));
    assert(
      declared === (row.hooked === true),
      `控件 ${row.key} 的「需写侧钩子」登记与扁平视图的 hooked 标记不一致`,
    );
  }
  // 扁平视图的 hooked 标记本身由 HOOKED_WRITE_KEYS 派生(controlTable 内部),
  // 故上一条等价于「表里没有的键不会被标成需钩子」;这里再确保每个声明的键都在表内。
  const rowKeys = new Set(rows.map((r) => r.key));
  for (const key of hookedKeys) {
    assert(rowKeys.has(/** @type {string} */ (key)), `HOOKED_WRITE_KEYS 里的 ${key} 不在声明表中`);
  }

  // 判据二:抽屉内控件键集合 ⇄ 几何规格。
  // 抽屉外 3 个(quickPreset / quickOutputDir 镜像 / format 顶栏)不在 DRAWER_GROUPS 内,
  // 声明表里以 group="mirror" 标出,故两边天然错开而不是靠手写差额名单。
  const declaredDrawerKeys = new Set(
    rows.filter((r) => r.group !== "mirror").map((r) => r.key),
  );
  const specDrawerKeys = new Set(DRAWER_CONTROL_KEYS);
  const onlyInTable = [...declaredDrawerKeys].filter((k) => !specDrawerKeys.has(k));
  const onlyInSpec = [...specDrawerKeys].filter((k) => !declaredDrawerKeys.has(k));
  assert(
    onlyInTable.length === 0 && onlyInSpec.length === 0,
    `声明表与几何规格的抽屉内控件键集合不一致:仅表里有 ${JSON.stringify(onlyInTable)},仅规格里有 ${JSON.stringify(onlyInSpec)}`,
  );
  // 组归属也要一致(几何门禁按组判位置,组错了位置判据就整体失效)
  for (const row of rows) {
    if (row.group === "mirror") continue;
    assert(
      DRAWER_GROUP_BY_KEY.get(row.key) === row.group,
      `声明表条目 ${row.key} 的组归属 ${row.group} 与几何规格 ${DRAWER_GROUP_BY_KEY.get(row.key)} 不一致`,
    );
  }

  // 复位口径:「有控件的块 ∪ 无控件键」必须等于 AppSettings 的全部顶层键 ——
  // 抽屉「恢复默认」的白名单是复位的真源,不能靠"表里没有它就算保留"。
  const topKeys = new Set(Object.keys(defaults));
  const coveredBlocks = new Set([...table.declaredBlockKeys(), ...table.KEYS_WITHOUT_CONTROL]);
  for (const key of topKeys) {
    assert(
      coveredBlocks.has(key),
      `顶层键 ${key} 既不在声明表的块里、也不在无控件键清单里(复位口径漏登记)`,
    );
  }
  for (const key of coveredBlocks) {
    assert(topKeys.has(key), `声明表登记了顶层键 ${key},但 DEFAULT_SETTINGS 里没有它`);
  }
  // 刻意保留集双向一致:表里标 preserve 的条目 + 无控件键 = PRESERVED_KEYS。
  // 逐控件基线用**设置键**名,声明表用控件键,故经 block 换算(派生键无块)。
  const preservedBlocks = new Set(
    rows.filter((r) => r.reset === "preserve").map((r) => r.block ?? r.key),
  );
  const tablePreserved = new Set([...preservedBlocks, ...table.KEYS_WITHOUT_CONTROL]);
  for (const key of tablePreserved) {
    assert(
      PRESERVED_KEYS.includes(key),
      `声明表把 ${key} 标为刻意保留,但逐控件基线的保留集里没有它(保留口径漂移)`,
    );
  }
  for (const key of PRESERVED_KEYS) {
    assert(
      tablePreserved.has(key),
      `逐控件基线把 ${key} 列为保留字段,声明表里却没有登记为保留(现登记 ${JSON.stringify([...tablePreserved])})`,
    );
  }
  // 复位集(标 reset 的条目)与保留集必须互补:一个控件不能两头都算,也不能两头都不算
  for (const row of rows) {
    if (row.reset === "derived") continue;
    assert(
      PRESERVED_KEYS.includes(row.block ?? "") === (row.reset === "preserve"),
      `控件 ${row.key} 的复位口径(${row.reset})与它的设置块 ${row.block} 在保留集里的归属不一致`,
    );
  }
  // 复位集本身也判一次:表算出的 resetBlockKeys 必须恰好是「全部顶层键 − 保留集」。
  // 这条是 reset 表驱动的判据(抽屉 payload 的键集由它生成),漏一个块即复位不到默认。
  const resetBlocks = new Set(table.resetBlockKeys());
  const expectedReset = new Set([...topKeys].filter((k) => !PRESERVED_KEYS.includes(k)));
  for (const key of expectedReset) {
    assert(
      resetBlocks.has(/** @type {string} */ (key)),
      `顶层键 ${key} 既不在保留集也不在复位集(抽屉「恢复默认」将漏掉它)`,
    );
  }
  for (const key of resetBlocks) {
    assert(
      expectedReset.has(/** @type {string} */ (key)),
      `声明表把 ${key} 算进复位集,但它属保留集(theme/language/customPresets/version 刻意不重置)`,
    );
  }

  // 依赖登记:门控与「设置值驱动的显隐」两处都不得漏,且引用的 id 必须真实存在。
  // 3 个手写门控逐个点名(IA 拍板的三种形态:条件字段整块移除 ×2 + 分档灰禁 ×1)。
  for (const gate of table.CONTROL_GATES) {
    assert(
      byKey.has(gate.master),
      `门控 ${gate.id} 的主控 ${gate.master} 不在声明表里`,
    );
    // 主控必须可写(它是「主控一动即重算从属项」的那一侧),否则门控在 change 侧无处触发
    assert(
      byKey.get(gate.master)?.kind === "value",
      `门控 ${gate.id} 的主控 ${gate.master} 不是可写值控件(门控的 change 侧接不上)`,
    );
    for (const dep of gate.dependents) {
      assert(byKey.has(dep), `门控 ${gate.id} 的从属项 ${dep} 不在声明表里`);
    }
  }
  for (const gateId of ["headerCustomVisibility", "aiCleanupTierAvailability", "tocModeVisibility"]) {
    assert(
      table.CONTROL_GATES.some((/** @type {{ id: string }} */ g) => g.id === gateId),
      `手写门控 ${gateId} 未登记在 CONTROL_GATES 里(新增门控必须登记,否则同步函数无处挂载)`,
    );
  }
  // 门控的「实现落点」必须是 settings-panel 上真实存在的导出 —— 登记不能只是一段
  // 注释里的名字(函数改名/漏导出时这里即红)。
  for (const gate of table.CONTROL_GATES) {
    const fn = gate.where.split(".").pop();
    assert(
      typeof panel[/** @type {string} */ (fn)] === "function",
      `门控 ${gate.id} 的实现落点 ${gate.where} 在 settings-panel 上不存在`,
    );
  }
  const effectTargets = new Set(
    table.VALUE_DRIVEN_EFFECTS.flatMap(
      (/** @type {ValueDrivenEffect} */ e) => e.sites.map((s) => s.target),
    ),
  );
  // 这 8 个落点就是「设置值 → 控件显隐/文案」的全部站点(6 条效果),
  // 逐个点名以免新增站点时靠"记得登记"。
  for (const target of [
    "templatePresetHint",
    "outputDirValue",
    "quickOutputDir",
    "pdfCssStatus",
    "pdfCssClearBtn",
    "headerLogoClear",
    "presetDeleteBtn",
    "drawerSubtitle",
  ]) {
    assert(
      effectTargets.has(target),
      `展示位 ${target} 受设置值驱动,但未登记在 VALUE_DRIVEN_EFFECTS 里`,
    );
  }
  for (const effect of table.VALUE_DRIVEN_EFFECTS) {
    for (const source of effect.sources) {
      assert(byKey.has(source), `设置值驱动效果 ${effect.id} 的来源 ${source} 不在声明表里`);
    }
    for (const site of effect.sites) {
      assert(htmlIds.has(site.target), `设置值驱动效果 ${effect.id} 的落点 ${site.target} 不在 index.html 里`);
    }
    // 效果 id 逐个点名:少登记一条即红(登记是"显式例外"的载体,靠漏写不算登记)
    const fn = effect.where.split(".").pop();
    assert(
      typeof panel[/** @type {string} */ (fn)] === "function",
      `设置值驱动效果 ${effect.id} 的实现落点 ${effect.where} 在 settings-panel 上不存在`,
    );
  }
  for (const effectId of [
    "presetDeletable",
    "presetHint",
    "pdfCssState",
    "headerLogoState",
    "outputDirChips",
    "drawerSubtitle",
  ]) {
    assert(
      table.VALUE_DRIVEN_EFFECTS.some((/** @type {{ id: string }} */ e) => e.id === effectId),
      `设置值驱动效果 ${effectId} 未登记在 VALUE_DRIVEN_EFFECTS 里`,
    );
  }
}

/**
 * 取 refs 源码里所有 getElementById 的 id。
 * @param {string} refsSource
 * @returns {string[]}
 */
function refIdsOf(refsSource) {
  return [...refsSource.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)]
    .map((m) => /** @type {string} */ (m[1]));
}

/**
 * 取 refs 源码里所有 `input[name="…"]` 分段选择器的组名(多行形态,只取到 name)。
 * @param {string} refsSource
 * @returns {string[]}
 */
function radioSelectorsOf(refsSource) {
  return [...refsSource.matchAll(/querySelectorAll<[^>]*>\(\s*["']input\[name=["']?([^"'\]]+)["']?\]/g)]
    .map((m) => /** @type {string} */ (m[1]));
}

/**
 * 控件 id 交叉校验 + radio 组零命中守护(纯判定:读两份源码文本,不改任何运行态;
 * 负探针与 run() 共用同一函数,保证自证走的是真实判定)。
 *
 * 两类失效形态:
 *  - getElementById 拼错 → 运行时值为 null,首次 addEventListener 才抛(栈指向消费点);
 *  - radio 组 querySelectorAll 拼错 → 静默得到空 NodeList,回填与绑定双双空转、连错都不报。
 * 故两条都要在**测试期**先判掉。
 *
 * @param {string} refsSource refs.ts 源码
 * @param {string} htmlSource index.html 源码
 * @returns {void} 有失效即抛
 */
export function assertRefContract(refsSource, htmlSource) {
  const tags = parseTags(htmlSource);
  const htmlIds = new Set(tags.filter((t) => t.attrs.id).map((t) => t.attrs.id));
  const groupNames = new Set(
    tags.filter((t) => t.tag === "input" && t.attrs.name).map((t) => t.attrs.name),
  );
  // getElementById 拼错 → 判红
  for (const id of refIdsOf(refsSource)) {
    assert(htmlIds.has(id), `refs.ts 引用了 index.html 中不存在的控件 id "${id}"`);
  }
  // radio 组选择器拼错 → 零命中判红(静默空转的先兆)
  const selectors = radioSelectorsOf(refsSource);
  assert(selectors.length >= 10, `refs.ts 应有 10 个 radio 组选择器,实际解析到 ${selectors.length}`);
  for (const name of selectors) {
    assert(
      groupNames.has(name),
      `refs.ts 的 radio 组选择器 input[name="${name}"] 在 index.html 命中 0 个元素(拼错会静默空转)`,
    );
  }
}
