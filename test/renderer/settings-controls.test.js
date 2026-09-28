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
 * 用法:M2W_ONLY=settings-controls M2W_PROBE=ref-id npm run test
 */
const PROBE = process.env.M2W_PROBE ?? "";

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
  el("toc").checked = false;
  fireListener(el("toc"), "change");
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

  dom.restore();
  console.log(
    `[ok] settings-controls:${controls.length} 个控件逐条 hydrate/bind/reset 通过 + 3 个手写门控双向(change/回填)通过 + 控件 id 交叉校验与 radio 组零命中守护通过`,
  );
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
