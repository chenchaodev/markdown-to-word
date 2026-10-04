// @ts-check
/**
 * 阶段 4 UX 缺口回归段(可观察行为 + 源契约双层断言):
 *
 * (1) 队列行 Enter/Space 不穿透拖放区
 *     - 行内 Enter/Space 必须 stopPropagation(否则被判为「容器自身目标」
 *       而打开文件对话框,叠加第二个动作);Enter 与双击同语义=预览该行;
 *       Space 只占用不误开预览。
 *     - 拖放区自身的键盘入口对行目标必须完全无动作。
 * (1b) 队列行忙碌两态(假可供性):转换中不可拖拽(draggable=false)、
 *     不可双击预览、悬停提示收敛为纯路径、容器挂忙碌类;结束后全部恢复。
 * (1c) 模态关闭后动作按钮必须重算(用户实测 2026-09-29:批量转换完成后转换/批量/
 *     合并/追加/清空/选择六枚按钮永久灰态,界面像卡死):弹窗开 → 六枚全灰,
 *     关闭该弹窗 → 六枚全恢复。覆盖批量 / 完成 / 预检报告三条真实关闭路径。
 * (2) 动态状态节点不被 applyStaticTexts 覆盖
 *     - index.html 中输出目录双 chip / Logo / PDF CSS / 预设提示一律不带
 *       data-i18n(带了就等于被字典默认值覆盖真实值);
 *     - 仍保留 data-i18n 的节点,静态回退文案与 zh 字典逐字一致;
 *     - settings-panel 导出 refreshDynamicSettingsText(语言切换后的重算入口)。
 * (3) 复制反馈
 *     - 标签与「已复制」是两个独立节点,反馈只切显隐,不改写标签文案;
 *     - 单实例复位:弹窗打开即复位,反馈不跨弹窗残留;
 *     - 读屏播报落在常驻 live region #copyLive(按钮内显隐互换播报不可靠)。
 * (3b) 完成态收束重放:res-beat 每次 showSummary 都重新挂上。
 * (4) 取消态
 *     - 汇总条取消态既不挂 ok 也不挂 fail,图标为中性横杠;
 *     - 批量弹窗标题按结果取语义(失败 / 全取消 / 完成),不恒写「完成」。
 * (5) 转换忙碌态:showProgress/hideProgress 切换消息槽 aria-busy。
 * (6) AI 清理两个分档(保守规整 / 结构改写):置灰跟随总开关 —— 关闭时控件
 *     disabled 且出现可见说明行(不只靠颜色),重新打开后恢复各自上次的选择;
 *     源契约侧锁定「分档落在 05 转换组、排在总开关之下、初始态即 disabled」。
 * (7) 目录模式下拉 tocMode:随自动目录开关整块移除(隐藏而非灰禁)—— 关闭时
 *     不可见也不可交互,重新打开恢复上次选择;源契约侧锁定总开关 change 与回填
 *     两条路径都重算显隐,且 .hidden 保住 !important(压得过行内 display:block)。
 *     (6)(7) 的「两条接线路径都重算」此前是源码正则,已改为行为断言并迁至
 *     settings-controls 段;本段保留对**同步函数本身**与 .hidden 契约的守护。
 *
 * DOM 侧用最小 stub 直接驱动 dist renderer 模块(与 convert-command-lock 段同一套
 * 元素表约定);源码契约侧只断言「某元素的 data-i18n 缺席」这类静态事实。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../common/paths.js";
import { installDomStub, fireListener, makeElement, makeKeyEvent } from "./dom-stub.js";

/**
 * 断言失败即抛错;声明为断言函数,使类型检查在断言通过后收窄被测值
 * (cond 为假即抛,后续代码无须再判空)。
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`ui-interaction-guards 断言失败:${msg}`);
}

/** @param {string} rel @returns {string} */
const distUrl = (rel) => pathToFileURL(path.join(ROOT, "dist", rel)).href;

/** 冲刷微任务与已就绪的宏任务,让未 await 的命令链(void 启动)跑完。 */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 取 index.html 中指定 id 的元素标签文本(源契约断言用)。
 * @param {string} html
 * @param {string} id
 * @returns {string}
 */
function tagOf(html, id) {
  const re = new RegExp(`<[^>]*id="${id}"[^>]*>`, "s");
  const m = re.exec(html);
  if (!m) throw new Error(`ui-interaction-guards:index.html 未找到 id="${id}"`);
  return m[0];
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 图标路径探针:showSummary 经 querySelector 取图标节点,只写 d 属性。
 * @typedef {object} StubIconPath
 * @property {Record<string, string>} attrs
 * @property {(k: string, v: string) => void} setAttribute
 */

/**
 * 取正则捕获组(缺失即断言失败,避免断言在 undefined 上静默失真)。
 * @param {RegExpExecArray} match
 * @param {number} index
 * @returns {string}
 */
function capture(match, index) {
  const value = match[index];
  assert(value !== undefined, `正则第 ${index} 个捕获组缺失`);
  return value;
}

/**
 * 元素树节点(只存结构断言要问的三件事:自身 id、data-group 属性、父子与序)。
 * @typedef {object} TreeNode
 * @property {string} tag 标签名(小写)
 * @property {Record<string, string>} attrs 属性表(键小写)
 * @property {TreeNode | null} parent 父节点
 * @property {number} order 文档序(先序遍历序号,全局唯一递增)
 */

/**
 * 元素树的查询面。
 * @typedef {object} ElementTree
 * @property {(id: string) => TreeNode | undefined} byId 按 id 取节点
 * @property {(id: string) => string | null} groupOf 取该节点最近 data-group 祖先的取值
 * @property {(id: string) => number} orderOf 取该节点的文档序
 */

/** 自闭合/无内容标签(HTML 里不写结束标签,遇它们不得压栈,否则整棵树错位) */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * 解析标签属性串为键值表(键小写;无值属性给空串,存在性由 hasOwnProperty 判定)。
 * @param {string} text 属性串
 * @returns {Record<string, string>}
 */
function parseTreeAttrs(text) {
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
 * 把 index.html 解析成元素树(结构断言的底座)。
 *
 * 为什么不用「正则切段」:那类判据把**排版**当契约(index.html 换一次缩进、
 * 属性换一次顺序、嵌套一个 div 就判红),而本段要守的是**层级从属**
 * (谁是谁的祖先、谁在谁前面)—— 那是 DOM 语义,与源码排版无关。
 *
 * 解析口径:先剥注释与 script/style 正文(里面的尖括号不是标签),再按标签栈走;
 * 自闭合标签与 void 标签不压栈。属性值里的 `>` 由引号配对规则整体吃掉,不会截断标签。
 * @param {string} html index.html 全文
 * @returns {ElementTree} 元素树查询面
 */
function parseElementTree(html) {
  const body = html.slice(html.indexOf("<body") === -1 ? 0 : html.indexOf("<body"));
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  /** @type {TreeNode[]} */
  const all = [];
  /** @type {TreeNode[]} */
  const stack = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    if (closing) {
      // 容错回退:只弹到最近的一个同名开标签,避免一处书写失误把整棵树带偏
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]?.tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    /** @type {TreeNode} */
    const node = {
      tag: name,
      attrs: parseTreeAttrs(m[3] ?? ""),
      parent: stack[stack.length - 1] ?? null,
      order: all.length,
    };
    all.push(node);
    if (VOID_TAGS.has(name)) continue;
    const selfClosed = /\/\s*$/.test(m[3] ?? "");
    if (!selfClosed) stack.push(node);
  }
  const byIdMap = new Map();
  for (const node of all) {
    const id = node.attrs.id;
    if (id !== undefined && id !== "" && !byIdMap.has(id)) byIdMap.set(id, node);
  }
  return {
    byId: (id) => byIdMap.get(id),
    groupOf(id) {
      for (let cur = byIdMap.get(id)?.parent ?? null; cur !== null; cur = cur.parent) {
        const group = cur.attrs["data-group"];
        if (group !== undefined && group !== "") return group;
      }
      return null;
    },
    orderOf(id) {
      const node = byIdMap.get(id);
      assert(node !== undefined, `index.html 未解析到 #${id}(orderOf 的前提不成立)`);
      return node.order;
    },
  };
}

export async function run() {
  // ---------- 源契约:动态节点不得挂 data-i18n ----------
  const indexHtml = fs.readFileSync(path.join(ROOT, "src", "renderer", "index.html"), "utf8");
  const DYNAMIC_IDS = [
    "quickOutputDir",
    "outputDirValue",
    "headerLogoStatus",
    "pdfCssStatus",
    "templatePresetHint",
  ];
  for (const id of DYNAMIC_IDS) {
    const tag = tagOf(indexHtml, id);
    assert(
      !tag.includes("data-i18n"),
      `动态状态节点 #${id} 不应带 data-i18n(applyStaticTexts 会用字典默认值覆盖真实值):${tag}`,
    );
  }

  // 仍保留 data-i18n 的节点:静态回退与 zh 字典逐字一致(防止改写一处漏另一处)
  const i18n = await import(distUrl("core/i18n/index.js"));
  const STATIC_KEYS = [
    "settings.presetScopeNote",
    "settings.tagNotInPreset",
    "settings.watermarkNote",
    "settings.headerFooterDefaultNote",
  ];
  for (const key of STATIC_KEYS) {
    const re = new RegExp(`data-i18n="${key}"[^>]*>([^<]*)<`, "s");
    const m = re.exec(indexHtml);
    assert(m, `index.html 应保留静态回退节点 ${key}`);
    assert(
      capture(m, 1).trim() === i18n.DICT.zh[key],
      `${key} 静态回退与 zh 字典不一致:回退=${capture(m, 1).trim()} 字典=${i18n.DICT.zh[key]}`,
    );
  }

  // ---------- DOM 行为 ----------
  let openMarkdownsCalls = 0;
  let openPreviewCalls = 0;
  // (1c) 要驱动真实转换链(预检 → 转换 → 结果弹窗),故补三个转换面 IPC 桩。
  // 预检默认无告警(静默放行);需要报告弹窗的小节把 precheckWarnings 置上。
  /** @type {string[]} */
  let precheckWarnings = [];
  const dom = installDomStub({
    api: {
      openMarkdowns: async () => { openMarkdownsCalls++; return []; },
      openPreview: async () => { openPreviewCalls++; return { ok: true }; },
      uiStateSet: async () => ({}),
      precheck: async () => precheckWarnings,
      convert: async () => ({ ok: true, outputPath: "C:\\out\\a.docx", warnings: [] }),
      convertBatch: async () => ({
        items: [
          { file: "C:\\docs\\a.md", ok: true, outputPath: "C:\\out\\a.docx", warnings: [] },
          { file: "C:\\docs\\b.md", ok: true, outputPath: "C:\\out\\b.docx", warnings: [] },
        ],
        okCount: 2,
        failCount: 0,
        canceledCount: 0,
      }),
    },
  });

  try {
    const dialogs = await import(distUrl("renderer/ui/dialogs.js"));
    const selection = await import(distUrl("renderer/convert/events/selection.js"));
    const { state } = await import(distUrl("renderer/state/state.js"));
    const panel = await import(distUrl("renderer/settings/settings-panel.js"));

    // (1) 队列行 Enter/Space 边界
    state.selectedFiles = ["a.md", "b.md"];
    state.mode = null;
    selection.bindSelectionEvents();

    const row = makeElement({ dataset: { index: "0" } });
    // 行目标对事件边界选择器「命中自身」(closest 返回自己),模拟真实 DOM
    row.closest = (/** @type {string} */ selector) => (selector.includes(".multi-item") ? row : null);

    const multiList = dom.elementFor("multiList");
    const enterEvent = makeKeyEvent("Enter", row);
    fireListener(multiList, "keydown", enterEvent);
    assert(enterEvent.propagationStopped, "队列行 Enter 必须 stopPropagation(不穿透拖放区)");
    assert(enterEvent.defaultPrevented, "队列行 Enter 应 preventDefault");
    assert(openPreviewCalls === 1, `队列行 Enter 应预览该行,实际 openPreview=${openPreviewCalls}`);

    const spaceEvent = makeKeyEvent(" ", row);
    fireListener(multiList, "keydown", spaceEvent);
    assert(spaceEvent.propagationStopped, "队列行 Space 必须 stopPropagation(不穿透拖放区)");
    assert(spaceEvent.defaultPrevented, "队列行 Space 应 preventDefault(不滚动列表)");
    assert(openPreviewCalls === 1, "队列行 Space 只占用,不触发预览(避免误开窗口)");

    // ---- (1b) 队列行忙碌两态:转换中不可拖拽 / 不可双击预览,结束后恢复 ----
    // 假可供性:动作栏按钮转换中已 disabled,队列行若仍给 grab 光标、仍可双击,
    // 用户会以为改得了顺序/看得 了预览 —— 而这些对本次转换无效。
    // 事件层早有 state.mode 守卫(dblclick / dragstart / Alt+± / 移除),
    // 本段守的是「声明层」:draggable 真的置 false、容器挂忙碌类、悬停提示收回。
    const fileList = await import(distUrl("renderer/convert/file-list.js"));
    // 队列容器要有可枚举的行,替掉 stub 的恒空 querySelectorAll
    /** @type {Array<{ draggable?: boolean; title?: string; dataset: Record<string, string> }>} */
    const renderedRows = [];
    const listEl = dom.elementFor("multiList");
    listEl.querySelectorAll = (/** @type {string} */ sel) =>
      sel === ".multi-item" ? /** @type {never} */ (renderedRows) : [];

    state.selectedFiles = ["a.md", "b.md"];
    state.mode = null;
    // 空闲态:可拖、挂「双击预览」提示(期望值由字典推,不写死文案)
    const previewHint = i18n.DICT.zh["file.dblclickPreview"];
    renderedRows.length = 0;
    fileList.renderMultiList();
    renderedRows.push(
      { draggable: true, title: "x", dataset: { index: "0" } },
      { draggable: true, title: "x", dataset: { index: "1" } },
    );
    fileList.updateActionButtons();
    assert(!listEl.classList.contains("mlist--busy"), "空闲态队列容器不应挂 mlist--busy");
    assert(
      renderedRows.every((r) => r.draggable === true),
      "空闲态(多文件)队列行应可拖",
    );
    assert(
      renderedRows[0]?.title === previewHint.replace("${path}", "a.md") &&
        renderedRows[1]?.title === previewHint.replace("${path}", "b.md"),
      `空闲态悬停提示应为「路径 + 双击预览」,实际 ${JSON.stringify(renderedRows.map((r) => r.title))}`,
    );

    // 转换中:draggable 置 false、容器挂忙碌类、提示收敛为纯路径
    state.mode = "batch";
    fileList.updateActionButtons();
    assert(listEl.classList.contains("mlist--busy"), "转换中队列容器应挂 mlist--busy(可见的禁用表达)");
    assert(
      renderedRows.every((r) => r.draggable === false),
      "转换中队列行必须 draggable=false(浏览器根本不发起拖拽)",
    );
    assert(
      renderedRows[0]?.title === "a.md" && renderedRows[1]?.title === "b.md",
      `转换中悬停提示应收敛为纯路径(不再承诺双击预览),实际 ${JSON.stringify(renderedRows.map((r) => r.title))}`,
    );
    // 双击预览在转换中不发起
    const previewsBeforeBusy = openPreviewCalls;
    fireListener(listEl, "dblclick", { stopPropagation() {}, target: row });
    assert(
      openPreviewCalls === previewsBeforeBusy,
      "转换中双击队列行不得打开预览窗口(state.mode 守卫)",
    );
    // 动作栏按钮与队列读同一个 busy:按钮灰了队列就不该还能拖
    assert(
      dom.elementFor("batchBtn").disabled === true,
      "转换中批量按钮应置灰(与队列忙碌同源)",
    );

    // 转换结束:两态全部恢复
    state.mode = null;
    fileList.updateActionButtons();
    assert(!listEl.classList.contains("mlist--busy"), "转换结束队列容器应摘掉 mlist--busy");
    assert(
      renderedRows.every((r) => r.draggable === true),
      "转换结束队列行应恢复可拖",
    );
    assert(
      renderedRows[0]?.title === previewHint.replace("${path}", "a.md") &&
        renderedRows[1]?.title === previewHint.replace("${path}", "b.md"),
      `转换结束悬停提示应恢复「路径 + 双击预览」,实际 ${JSON.stringify(renderedRows.map((r) => r.title))}`,
    );
    // 恢复后双击预览照常发起
    fireListener(listEl, "dblclick", { stopPropagation() {}, target: row });
    assert(
      openPreviewCalls === previewsBeforeBusy + 1,
      `转换结束双击队列行应恢复预览,实际 openPreview 增量 ${openPreviewCalls - previewsBeforeBusy}`,
    );
    // ---- (1c) 模态关闭后动作按钮必须重算(用户实测 2026-09-29:批量转换完成后
    //      转换/批量/合并/追加/清空/选择六枚按钮永久灰态,界面像卡死)----
    // 根因是判据纯 DOM 派生:isBusy → isConvertCommandBlocked →
    // isModalCommandBlocked 读 ".dialog-overlay:not(.hidden)"。结果弹窗在
    // endControlledRun 的 updateActionButtons() **之前**打开,那一版按钮态就是
    // 「弹窗开着」的灰态;关闭路径若不重算,按钮永远停在这一版(此后无任何路径
    // 再调 updateActionButtons)。故此处跑真实转换,再逐条关闭路径取按钮态。
    //
    // 段内把模态判定接上真实语义:stub 的 document.querySelector 恒返 null,那样
    // 「弹窗开着」这一态压根不成立(修复前按钮也不会灰,断言就测不到这个坑)。
    // 经 any 断开 stub 的声明形状(它把 querySelector 声明为 () => null,见 dom-stub
    // 契约注记:选择器表按需开启);这里不扩 stub 契约面,覆写只在本段内生效。
    /** @type {any} */
    const fakeDoc = dom.document;
    const MODAL_IDS = ["completeDialog", "precheckDialog", "batchDialog", "presetSaveDialog"];
    fakeDoc.querySelector = (/** @type {string} */ selector) => {
      if (!selector.includes("dialog-overlay")) return null;
      return MODAL_IDS.map((id) => dom.elementFor(id)).find((el) => !el.classList.contains("hidden")) ?? null;
    };
    // 六枚动作按钮的置灰判据同源(isBusy),故按同一组断言读
    const ACTION_BTN_IDS = [
      "convertBtn",
      "batchBtn",
      "mergeBtn",
      "appendFileBtn",
      "clearListBtn",
      "selectBtn",
    ];
    /**
     * 本判据该管的几枚:忙碌之外还有一条「可见性」判据 —— 单文件态只亮转换、
     * 多文件态只亮批量/合并,被隐藏的那一枚(disabled 随之而来)不属 busy。
     * @param {number} fileCount 当前选中文件数
     * @returns {string[]}
     */
    const expectedEnabled = (fileCount) =>
      ACTION_BTN_IDS.filter((id) => {
        if (id === "convertBtn") return fileCount === 1;
        if (id === "batchBtn" || id === "mergeBtn") return fileCount >= 2;
        return true;
      });
    /** 忙碌之外仍灰着的动作按钮 id(经函数取值:断言的类型收窄会把数组长度锁死)。 */
    const stillGreyed = () =>
      expectedEnabled(state.selectedFiles.length).filter((id) => dom.elementFor(id).disabled === true);
    /** 此刻仍可点的动作按钮 id(与 stillGreyed 互为反面,失败文案更可读)。 */
    const notGreyedYet = () => ACTION_BTN_IDS.filter((id) => dom.elementFor(id).disabled !== true);
    /** 从干净态起算:四个遮罩全部复位为隐藏(前序小节 showCompleteDialog 后未关闭)。 */
    const hideAllModals = () => {
      for (const id of MODAL_IDS) dom.elementFor(id).classList.add("hidden");
    };
    const flow = await import(distUrl("renderer/convert/convert-flow.js"));
    hideAllModals();
    state.selectedFiles = ["C:\\docs\\a.md", "C:\\docs\\b.md"];
    state.mode = null;
    state.suppressCompleteDialog = false;

    // ① 批量:真实 runBatch 走到「弹窗先开、endControlledRun 后置灰」那一刻
    precheckWarnings = [];
    await flow.runBatch();
    assert(
      !dom.elementFor("batchDialog").classList.contains("hidden"),
      "批量转换完成后应弹出批量汇总弹窗(本小节前提)",
    );
    assert(
      notGreyedYet().length === 0,
      `弹窗可见期间六枚动作按钮应全部置灰(转换中/模态同源),实际未置灰=${JSON.stringify(notGreyedYet())}`,
    );
    // 确定 / 点遮罩 / Esc 三种关闭方式都经 hideBatchDialog,这里直接调该唯一关闭函数
    dialogs.hideBatchDialog();
    assert(
      stillGreyed().length === 0,
      `关闭批量弹窗后动作按钮必须重算为可用(多文件态 convertBtn 由 n!==1 单独置灰),实际仍灰=${JSON.stringify(stillGreyed())}`,
    );

    // ② 单文件完成弹窗:与批量同一根因(弹窗在收尾重算之前打开);单文件态下
    //    六枚按钮都该可用,这一条把 convertBtn 也纳入判据
    state.selectedFiles = ["C:\\docs\\a.md"];
    await flow.runConvert("C:\\docs\\a.md", "docx");
    assert(
      !dom.elementFor("completeDialog").classList.contains("hidden"),
      "单文件转换成功后应弹出完成弹窗(本小节前提)",
    );
    assert(
      notGreyedYet().length === 0,
      `完成弹窗可见期间六枚动作按钮应全部置灰,实际未置灰=${JSON.stringify(notGreyedYet())}`,
    );
    dialogs.hideCompleteDialog();
    assert(
      stillGreyed().length === 0,
      `关闭完成弹窗后六枚动作按钮必须重算为可用,实际仍灰=${JSON.stringify(stillGreyed())}`,
    );

    // ③ 预检报告弹窗:关掉报告后链内续作转换并弹完成窗,关掉完成窗才回到可用态
    //    (报告期按钮灰是命令锁而非模态,这一条守的是关闭链整体不再留残态)
    hideAllModals();
    state.mode = null;
    precheckWarnings = ["围栏未闭合"];
    const pendingConvert = flow.runConvert("C:\\docs\\a.md", "docx"); // 不 await:先关报告
    await flush();
    assert(
      !dom.elementFor("precheckDialog").classList.contains("hidden"),
      "预检有告警时应弹出报告对话框(本小节前提)",
    );
    assert(
      notGreyedYet().length === 0,
      `预检报告决策期间六枚动作按钮应全部置灰(命令锁持有中),实际未置灰=${JSON.stringify(notGreyedYet())}`,
    );
    dialogs.closePrecheckDialog(true); // 「继续转换」→ 链内续作
    await pendingConvert;
    assert(
      !dom.elementFor("completeDialog").classList.contains("hidden"),
      "预检放行后应完成转换并弹完成窗(本小节前提)",
    );
    dialogs.hideCompleteDialog();
    assert(
      stillGreyed().length === 0,
      `预检 → 转换 → 关闭完成弹窗后六枚动作按钮必须重算为可用,实际仍灰=${JSON.stringify(stillGreyed())}`,
    );
    precheckWarnings = [];
    hideAllModals(); // 收尾:不留可见模态,后续小节从干净态起算
    state.selectedFiles = ["a.md", "b.md"];
    state.mode = null;

    // 收尾复位,不影响后续小节
    state.selectedFiles = ["a.md", "b.md"];
    state.mode = null;
    // 拖放区自身入口对行目标必须无动作
    const dropZone = dom.elementFor("dropZone");
    const beforeMarkdowns = openMarkdownsCalls;
    const rowOnZone = makeKeyEvent("Enter", row);
    fireListener(dropZone, "keydown", rowOnZone);
    assert(!rowOnZone.defaultPrevented, "拖放区键盘入口不得对队列行目标生效");
    assert(openMarkdownsCalls === beforeMarkdowns, "拖放区不得因队列行按键打开文件对话框");

    // 行外目标(纸面空白)仍应照常打开对话框(边界不得收得太紧)
    const paper = makeElement();
    paper.closest = () => null;
    const paperEvent = makeKeyEvent("Enter", paper);
    fireListener(dropZone, "keydown", paperEvent);
    assert(paperEvent.defaultPrevented, "纸面空白处的 Enter 仍应打开文件对话框");
    assert(openMarkdownsCalls === beforeMarkdowns + 1, "纸面空白 Enter 应恰好触发一次 openDialog");

    // (3) 复制反馈:只切显隐,不改写标签
    const label = dom.elementFor("completeDialogCopyLabel");
    const ok = dom.elementFor("completeDialogCopyOk");
    label.classList.remove("hidden");
    ok.classList.add("hidden");
    dialogs.showCopyFeedback();
    assert(label.classList.contains("hidden"), "复制反馈期间标签应隐藏");
    assert(!ok.classList.contains("hidden"), "复制反馈期间「已复制」应显示");
    assert(label.textContent === "", "复制反馈不得改写标签文案(会抹掉 data-i18n)");

    // (3b) 读屏播报位:常驻 live region 承接「已复制」。
    // 按钮内的显隐互换靠不住(反馈节点文本不变,live region 收不到变更),
    // 播报必须落在 #copyLive 上,且弹窗打开即清空(不跨弹窗残留)。
    // 注:被测代码「先清空再写」是为了让连续复制同一路径也构成一次内容变更 ——
    // 那取决于读屏对 live region 的实际反应,stub 观察不到(末态两种写法一致),
    // 本段只守「写入 + 复位清空」这两个可断言面。
    const copyLive = dom.elementFor("copyLive");
    dialogs.showCopyFeedback();
    assert(
      copyLive.textContent === i18n.DICT.zh["common.copied"],
      `复制成功应写读屏播报位「${i18n.DICT.zh["common.copied"]}」,实际 ${JSON.stringify(copyLive.textContent)}`,
    );
    dialogs.showCopyFeedback();
    assert(
      copyLive.textContent === i18n.DICT.zh["common.copied"],
      "连续复制后播报位仍应持有最新文案(不得被后一次调用清空)",
    );

    // 弹窗打开即复位(不得跨弹窗残留)
    dialogs.showCopyFeedback();
    dialogs.showCompleteDialog("C:\\out\\a.docx");
    assert(!label.classList.contains("hidden"), "完成弹窗打开应复位复制反馈(标签恢复)");
    assert(ok.classList.contains("hidden"), "完成弹窗打开应复位复制反馈(反馈消失)");
    assert(
      copyLive.textContent === "",
      `完成弹窗打开应清空复制播报位(不得跨弹窗残留),实际 ${JSON.stringify(copyLive.textContent)}`,
    );

    // (4) 取消态:中性、不挂 ok/fail
    const resultSummary = dom.elementFor("resultSummary");
    // 图标路径探针:showSummary 只对 querySelector 结果写 d 属性,断言读回同一处
    /** @type {StubIconPath} */
    const iconPath = {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
    };
    dom.elementFor("summaryIcon").querySelector = () => iconPath;
    /** 取探针当前 d 属性(每次 showSummary 覆写,断言读回同一处)。 */
    const iconD = () => iconPath.attrs.d;

    dialogs.showSummary({ kind: "canceled", title: "已取消" });
    assert(resultSummary.classList.contains("result-summary--canceled"), "取消态应挂 canceled 修饰类");
    assert(!resultSummary.classList.contains("result-summary--ok"), "取消态不得显示成功绿态");
    assert(!resultSummary.classList.contains("result-summary--fail"), "取消态不得显示失败红态");
    assert(iconD() === "M6 12h12", `取消态图标应为中性横杠,实际 ${iconD()}`);

    dialogs.showSummary({ kind: "ok", title: "完成" });
    assert(resultSummary.classList.contains("result-summary--ok"), "成功态应挂 ok 修饰类");
    assert(!resultSummary.classList.contains("result-summary--canceled"), "成功态不得残留 canceled 修饰类");
    assert(iconD() === "M20 6L9 17l-5-5", "成功态图标应为对勾");

    // (4b) 完成态收束重放:汇总条常驻、不再回 hidden,动画默认只播首帧,
    // showSummary 必须摘挂重放,否则第二次转换起就再也看不到收束。
    assert(
      resultSummary.classList.contains("res-beat"),
      "showSummary 应给汇总条挂 res-beat(完成态收束的触发类)",
    );
    // 手动摘掉模拟「首帧已播完」,再调一次必须重新挂上
    resultSummary.classList.remove("res-beat");
    dialogs.showSummary({ kind: "ok", title: "完成" });
    assert(
      resultSummary.classList.contains("res-beat"),
      "第二次完成也应重新挂 res-beat(收束须每次转换都播,不能只在会话首帧播一次)",
    );

    dialogs.showSummary({ kind: "fail", title: "失败", error: "x" });
    assert(resultSummary.classList.contains("result-summary--fail"), "失败态应挂 fail 修饰类");
    assert(!resultSummary.classList.contains("result-summary--ok"), "失败态不得残留 ok 修饰类");

    // (4) 批量弹窗标题按结果取语义
    const titleEl = dom.elementFor("batchDialogTitle");
    /**
     * @param {{ okCount?: number, failCount?: number, canceledCount?: number }} over
     * @returns {{ items: unknown[], okCount: number, failCount: number, canceledCount: number }}
     */
    const batchResult = (over) => ({
      items: [],
      okCount: 0,
      failCount: 0,
      canceledCount: 0,
      ...over,
    });
    dialogs.showBatchDialog(batchResult({ okCount: 2 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["dialog.batch.title"],
      `全成功标题应为「${i18n.DICT.zh["dialog.batch.title"]}」,实际 ${titleEl.textContent}`,
    );
    dialogs.showBatchDialog(batchResult({ okCount: 1, failCount: 1 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["convert.batch.failedTitle"],
      `含失败标题应为失败标题,实际 ${titleEl.textContent}`,
    );
    dialogs.showBatchDialog(batchResult({ canceledCount: 2 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["common.canceled"],
      `全取消标题应为中性取消标题,实际 ${titleEl.textContent}`,
    );

    // (5) 转换忙碌态:进度区启停同时把消息槽标 aria-busy。
    // 百分比之外读屏还需要一个「正在转换」的整体状态位 —— 挂在消息槽上,
    // 与状态行(role=status)的阶段播报分工:一个说「在做什么」,一个说「忙」。
    const utils = await import(distUrl("renderer/ui/dom-ops.js"));
    const messageSlot = dom.elementFor("messageSlot");
    utils.showProgress();
    assert(
      messageSlot.getAttribute("aria-busy") === "true",
      `showProgress 应把消息槽标 aria-busy=true,实际 ${JSON.stringify(messageSlot.getAttribute("aria-busy"))}`,
    );
    utils.hideProgress();
    assert(
      messageSlot.getAttribute("aria-busy") === "false",
      `hideProgress 应把消息槽写回 aria-busy=false,实际 ${JSON.stringify(messageSlot.getAttribute("aria-busy"))}`,
    );
    // 显式写回 "false" 而非摘除属性:摘除依赖 removeAttribute,而段内自建的
    // 最小元素 stub 未必提供该方法(见 dom-stub.js 契约注记)

    // (2) 动态节点重算入口存在
    assert(
      typeof panel.refreshDynamicSettingsText === "function",
      "settings-panel 应导出 refreshDynamicSettingsText(语言切换后重算动态节点)",
    );
    assert(
      typeof panel.syncOutputDirDisplay === "function" &&
        typeof panel.syncPdfCssState === "function" &&
        typeof panel.syncHeaderLogoDisplay === "function",
      "settings-panel 应导出三个动态节点同步函数(单一来源)",
    );

    // (6) AI 清理两个分档:置灰跟随总开关(行为)+ 落在转换组总开关之下(源契约)
    //     可用性不只靠颜色:控件 disabled(移出焦点序)+ 一行可见文字说明。
    assert(
      typeof panel.syncAiCleanupTierAvailability === "function",
      "settings-panel 应导出 syncAiCleanupTierAvailability(分档可用性单一来源)",
    );
    const aiCleanupEl = dom.elementFor("aiCleanup");
    const tidyEl = dom.elementFor("aiCleanupTidy");
    const rewriteEl = dom.elementFor("aiCleanupRewrite");
    const lockedEl = dom.elementFor("aiCleanupTiersLocked");
    // 读当前置灰态(经取值再断言:直接比较 checked/disabled 会与前一条断言的
    // 类型收窄打架,读一次值可同时避开收窄与 stub 初值两个坑)
    const tierDisabled = () => [tidyEl.disabled === true, rewriteEl.disabled === true];
    // 先摆成「未置灰」,确保后续断言测的是本函数而不是 stub 初值
    lockedEl.classList.add("hidden");
    aiCleanupEl.checked = false;
    panel.syncAiCleanupTierAvailability();
    assert(
      tierDisabled().every(Boolean),
      `总开关关闭时两个分档都应置灰(不可操作),实际 ${JSON.stringify(tierDisabled())}`,
    );
    assert(
      !lockedEl.classList.contains("hidden"),
      "总开关关闭时应出现可见的置灰说明(可用性不只靠颜色表达)",
    );
    // 重新打开总开关:两个分档恢复可操作,各自上次的选择原样保留
    tidyEl.checked = false;
    rewriteEl.checked = true;
    aiCleanupEl.checked = true;
    panel.syncAiCleanupTierAvailability();
    assert(
      tierDisabled().every((flag) => !flag),
      `总开关重新打开后两个分档应恢复可操作,实际 ${JSON.stringify(tierDisabled())}`,
    );
    assert(lockedEl.classList.contains("hidden"), "总开关打开后置灰说明应消失");
    assert(
      tidyEl.checked === false && rewriteEl.checked === true,
      "重新打开总开关后,两个分档应保留各自上次的选择(不重置)",
    );

    // ---- 层级从属(结构断言):分档是总开关的下属项,不是别的分组的平级功能 ----
    // 判据是「元素树」而不是「源码文本」:在解析出的标签树上问「最近祖先后代是谁」
    // 与「谁在谁前面」。正则切段依赖字面形态(属性书写顺序 / 换行 / 嵌套 </section>
    // 的位置),改一次排版就假红;结构断言只依赖父子与序,排版变更不该判红。
    const tree = parseElementTree(indexHtml);
    for (const id of ["aiCleanup", "aiCleanupTidy", "aiCleanupRewrite", "aiCleanupTiersLocked"]) {
      assert(tree.byId(id) !== undefined, `index.html 未解析到 #${id}(元素树构建有缺口)`);
    }
    for (const id of ["aiCleanupTidy", "aiCleanupRewrite", "aiCleanupTiersLocked"]) {
      assert(
        tree.groupOf(id) === "convert",
        `#${id} 应落在 05 转换组内(最近 data-group 祖先为 convert),实际 ${
          String(tree.groupOf(id))
        };AI 清理的细分项不是别的分组的平级功能`,
      );
    }
    assert(
      tree.orderOf("aiCleanupTidy") > tree.orderOf("aiCleanup"),
      "分档控件在 DOM 上应排在总开关 aiCleanup 之后(层级从属靠位置表达,不只靠 class)",
    );
    assert(
      tree.orderOf("aiCleanupTiersLocked") > tree.orderOf("aiCleanupRewrite"),
      "置灰说明行应排在两个分档之后(说明的是分档,不是总开关)",
    );
    // 初始 disabled 同样走结构判据(元素自身属性),不读原始标签串
    assert(
      tree.byId("aiCleanupTidy")?.attrs.disabled !== undefined &&
        tree.byId("aiCleanupRewrite")?.attrs.disabled !== undefined,
      "两个分档的初始态应随总开关默认关(静态 HTML 即带 disabled,不靠 JS 补)",
    );
    // 「总开关 change 与回填两条路径都重算分档可用性」此前由两条源码正则守护;
    // 已改为**行为断言**(真跑 change 事件与 applySettingsToControls 后读置灰态),
    // 落在 settings-controls 段(逐控件基线 + 3 个手写门控双向),正则本身不再作护栏。

    // (7) 目录模式下拉 tocMode:随自动目录开关整块移除(行为)+ 两处接线齐全(源契约)
    //     灰禁会留下一个可点、但不生效的下拉(用户能选一个不会生效的模式),
    //     故按 settings-ia §3 走「模式不满足即整块移除」那一路。
    assert(
      typeof panel.syncTocModeVisibility === "function",
      "settings-panel 应导出 syncTocModeVisibility(目录下拉显隐单一来源)",
    );
    const tocEl = dom.elementFor("toc");
    const tocModeEl = dom.elementFor("tocMode");
    // stub 元素的 classList 初值带 hidden,先摘掉以免正态断言测的是 stub 而非本函数
    tocModeEl.classList.remove("hidden");
    tocModeEl.value = "field";
    tocEl.checked = false;
    panel.syncTocModeVisibility();
    assert(
      tocModeEl.classList.contains("hidden"),
      "自动目录关闭时目录模式下拉应整块移除(display:none ⇒ 既不可见也不可聚焦/交互)",
    );
    assert(
      tocModeEl.value === "field",
      "收起不得丢掉上次选的目录模式(重新打开自动目录即恢复)",
    );
    tocEl.checked = true;
    panel.syncTocModeVisibility();
    assert(
      !tocModeEl.classList.contains("hidden"),
      "自动目录开启后目录模式下拉应重新出现",
    );
    assert(
      tocModeEl.value === "field",
      "展开后目录模式应仍是收起前那次选择(不重置)",
    );

    // 「两条接线路径(总开关 change / 回填)都重算显隐」此前由两条源码正则守护;
    // 已改为**行为断言**(真跑 toc change 与 applySettingsToControls 后读 .hidden),
    // 落在 settings-controls 段,正则本身不再作护栏。
    // 「.hidden 带 !important 才压得过 tocMode 的行内 display:block」此前由一条读
    // base.css 正则守护 —— 那是源文本形态,且**恒真**:它只看规则里有没有那三个字符,
    // 不看浏览器最终算出什么。改判据为**真实级联结果**:摘掉 !important 后,
    // 行内 display:block 赢,收起门控静默失效(check:geometry 的 drawer-gate-inverted
    // 在真实窗口里量到 tocMode 仍可见即判红 —— 见 geometry-spec DRAWER_CONDITIONS
    // 的 tocMode 条目与 settings-panel.syncTocModeVisibility 的注)。
    // 本段这条只守「被守护的机制真被用上了」:该 select 必须仍带行内 display,
    // 否则 !important 那一层压力根本不存在,几何门禁也就无从判红(压力源不能被悄悄拆掉)。
    const tocModeTag = tagOf(indexHtml, "tocMode");
    assert(
      /style="[^"]*display:\s*block/.test(tocModeTag),
      `#tocMode 应仍带行内 display:block —— 它是 .hidden 必须靠 !important 压过的压力源;` +
        `拆掉它等于拆掉这条门禁的判据前提(几何门禁将无从判红)。实际标签:${tocModeTag}`,
    );

    // ======================================================================
    // (8) 语言切换:静态文案与动态节点**都**必须落到新语言(行为断言)
    // ======================================================================
    // 此前由一条读 settings-bindings-app.ts 源码的正则守护「applyStaticTexts()
    // 出现在 refreshDynamicSettingsText() 之前」。那是源文本形态:它只看两个标识符
    // 在文件里的先后,看不到任何运行结果 —— 把 refreshDynamicSettingsText() 整个
    // 删掉(动态节点就此停在旧语言)它照样绿,把它挪到 setLanguage() 之前(动态节点
    // 按旧语言重算)它也照样绿。改判据为**端到端可观察结果**:真跑语言钩子,
    // 然后读真实 DOM 上两类节点各自的 textContent。
    //
    // 为什么必须盯住动态节点:动态展示位(输出目录 / PDF CSS / Logo)在 index.html
    // 里不带 data-i18n(见本段开头「动态节点不被 applyStaticTexts 覆盖」那条),
    // applyStaticTexts 扫不到它们,只有 refreshDynamicSettingsText 会重算;反过来
    // 静态节点只由 applyStaticTexts 刷。**两类都断言**才等于覆盖了原来那条正则的
    // 全部意图(且更强:它还锁住了「钩子确实跑过」这件事本身)。
    const appBindings = await import(distUrl("renderer/settings/settings-bindings-app.js"));
    // i18n 逻辑层(setLanguage / applyStaticTexts 的实现侧):core/i18n/index.js 只是
    // 注册表(DICT / LANGUAGES),两处不是同一个模块,别混用
    const i18nLogic = await import(distUrl("core/i18n/index.js"));
    const outputDirEl = dom.elementFor("outputDirValue");
    const pdfCssEl = dom.elementFor("pdfCssStatus");
    const logoEl = dom.elementFor("headerLogoStatus");
    const staticLabel = dom.elementFor("presetScopeNote");
    // 四枚节点一律先摆成「不可能与任何语言文案相同」的哨兵:钩子若没跑到它们身上,
    // 断言读到哨兵即红 —— 避开「恰好与旧语言一致」造成的恒真(REQ-080 同类坑)。
    const STALE = "«未按新语言重算»";
    outputDirEl.textContent = STALE;
    pdfCssEl.textContent = STALE;
    logoEl.textContent = STALE;
    staticLabel.dataset.i18n = "settings.presetScopeNote";
    staticLabel.textContent = STALE;
    // 让 applyStaticTexts 扫得到这一枚:按需给 document.querySelectorAll 开一个口
    // (与上文 dialog-overlay 同一手法 —— 只在本段内覆写,不扩 stub 契约面)。
    const realQuerySelectorAll = fakeDoc.querySelectorAll;
    fakeDoc.querySelectorAll = (/** @type {string} */ selector) =>
      selector === "[data-i18n]" ? [staticLabel] : realQuerySelectorAll(selector);

    state.settings.language = "zh";
    i18nLogic.setLanguage("zh");
    /** @type {unknown} */
    let writtenLang = null;
    // 真跑语言钩子:appWriteHooks.languageSelect 就是 change 事件线上那个函数
    // (经 bindControlGroup 派发);此处直接调它,省一层与本判据无关的事件接线噪声。
    appBindings.appWriteHooks.languageSelect(
      panel.settingsWriteContext,
      /** @type {any} */ ({ value: "en", checked: false, valueAsNumber: Number.NaN }),
      (/** @type {unknown} */ value) => { writtenLang = value; },
    );
    assert(writtenLang === "en", `语言钩子应落值 en,实际 ${JSON.stringify(writtenLang)}`);

    // 动态节点:必须已是 en 文案(哨兵被覆盖 = 钩子确实重算过它们)
    const enDict = i18n.DICT.en;
    assert(
      outputDirEl.textContent === enDict["settings.outputDirDefault"],
      `语言切到 en 后输出目录 chip 应重算为英文文案,实际 ${JSON.stringify(outputDirEl.textContent)}`,
    );
    assert(
      pdfCssEl.textContent === enDict["settings.pdfCssNone"],
      `语言切到 en 后 PDF CSS 状态行应重算为英文文案,实际 ${JSON.stringify(pdfCssEl.textContent)}`,
    );
    assert(
      logoEl.textContent === enDict["settings.headerLogoNone"],
      `语言切到 en 后页眉 Logo 回显应重算为英文文案,实际 ${JSON.stringify(logoEl.textContent)}`,
    );
    // 静态节点:applyStaticTexts 那一路
    assert(
      staticLabel.textContent === enDict["settings.presetScopeNote"],
      `语言切到 en 后静态 data-i18n 节点应刷为英文文案,实际 ${JSON.stringify(staticLabel.textContent)}`,
    );
    // <html lang> 同步(applyStaticTexts 的另一半职责:BCP 47 映射)
    assert(
      fakeDoc.documentElement.lang === i18n.htmlLangOf("en"),
      `语言切到 en 后 <html lang> 应为 en-US,实际 ${JSON.stringify(fakeDoc.documentElement.lang)}`,
    );
    fakeDoc.querySelectorAll = realQuerySelectorAll;
    // 复位语言,免得后续小节(及 dist 模块单例)停在 en
    i18nLogic.setLanguage("zh");
    state.settings.language = "zh";

    // ======================================================================
    // (9) 取消态配色:CSS 令牌恒等(已迁至 check:geometry)
    // ======================================================================
    // 「取消态边框/图标为中性发丝线与 --mut 弱化色」此前是三条读 dialogs.css 的
    // 正则。它们有两个问题:① 源文本形态 —— 只看声明块里有没有那几个字符,看不到
    // 浏览器最终算出什么颜色;② 恒真 —— 把 border-color 改成任何别的中性色(哪怕
    // 是另一根发丝线令牌)它都绿,而「取消态不得被读成成功绿/失败红」才是契约。
    // 已迁到 check:geometry(真实窗口量 getComputedStyle 的最终计算色,与成功/
    // 失败两态的实际计算色比对),并在那里扩了 CSS 令牌恒等职责 —— 见该脚本文件头。
    // 本段不再有任何 dialogs.css 源文本断言。

    console.log("[ok] ui-interaction-guards:队列行键盘边界与忙碌两态 / 模态关闭后动作按钮重算 / 动态节点不被覆盖 / 复制反馈复位与读屏播报 / 完成态收束重放 / 取消中性态与批量标题 / aria-busy / AI 清理分档置灰跟随总开关(行为 + 层级从属结构) / 目录模式下拉随总开关收起 / 语言切换后静态与动态节点同刷新语言 断言通过");
  } finally {
    dom.restore();
  }
}
