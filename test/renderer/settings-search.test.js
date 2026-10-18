// @ts-check
/**
 * 设置抽屉 P2 · 跨组检索 + Tab 键盘可达性段(ADR-077;PLAN #03)。
 *
 * 本段守两件新行为,都是**真行为断言**(跑真函数、看真 DOM 结果):
 *
 * 一、**跨组检索**(`settings-panel.initSettingsSearch`,读点 `refreshSearchResults`):
 *   输入即按声明表 `labelKey` 单源取控件行标签,对六组全部控件做包含匹配,然后
 *   ① 每个 tab 的命中数写进该组计数位;② 状态行写总命中数 / 无命中空态;
 *   ③ 有命中时激活首个命中组并把首个命中控件滚入视野。**不隐藏任何控件**
 *   (几何规格只有两种可见性形态,本功能不入第三种)。语言切换经
 *   `refreshDynamicSettingsText` 复算同一处,故计数文案不会停留在旧语言。
 *   命中集里另有一条**具体落点**断言:「模板预设」恰 1 条且落在 01 预设组
 *   (PLAN #04 的退出条件 —— 01 组的展示升级不许动检索面)。
 *
 * 二、**Tab roving tabindex + 方向键**:`aria-selected` / `tabindex` / `.active` 类
 *   三者同刻同改;↑/↓ 环形移动、Home/End 跳首尾,且键盘激活会抢焦点(自动激活)。
 *
 * DOM 侧用共享 stub(见 dom-stub.js):`document.querySelectorAll` 走段内 `selectorGroups`
 * 注入(选择器命中由用例给,不在 stub 里做全局表);tab 的计数位由元素级
 * `querySelector(".tab-count")` 探针命中。tab / 面板分组从**真实 index.html** 解析,
 * 不另抄一份组名清单。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";
import {
  installDomStub,
  makeElement,
  makeClassList,
  makeKeyEvent,
  fireListener,
} from "./dom-stub.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert, assertEq } = createAsserter("settings-search");

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**。被测 dist 模块由**字面量**说明符的
 * 运行期动态 import 载入(门禁静态抽取器认 `import("字面量")` 这一形态);仍保持**动态**
 * import 而非静态:dist 的 dom/refs.js 在模块求值期就抓 document,必须晚于 installDomStub。
 *
 * 主体依据(头注两条行为 + 实现位置):
 * - `settings/settings-panel.ts` —— `initSettingsTabs`(点击 + ↑/↓/Home/End + roving
 *   tabindex)与 `initSettingsSearch` / `refreshSearchResults` / `jumpToFirstSearchHit`
 *   (检索计数 / 状态行 / 首个命中跳转)的定义处;
 * - `settings/settings-controls-table.ts` —— 检索标签的单源 `ControlRow.labelKey`
 *   (经 `controlTable()` 读);
 * - `dom/refs.ts` —— `settingsFilterInput` / `settingsFilterStatus` 两处引用;
 * - `index.html` —— 检索行与 tab 的 markup(计数位 span、`aria-selected`、`tabindex`);
 * - `style/settings.css` —— `.drawer-search` / `.filter-status` / `.tab-count` 的呈现。
 */
export const covers = [
  "src/renderer/settings/settings-panel.ts",
  "src/renderer/settings/settings-controls-table.ts",
  "src/renderer/settings/settings-drawer.ts",
  "src/renderer/dom/refs.ts",
  "src/renderer/index.html",
  "src/renderer/style/settings.css",
];

// 显式声明本段无验收样例(契约见 gates/fixtures/check-segment-contracts.mjs 文件头)
export const fixtures = null;

/**
 * 取某标签名的全部**属性串**(一标签一串,跨行属性也算同一串:`[^>]` 含换行)。
 * @param {string} html
 * @param {string} tagName
 * @returns {string[]}
 */
function tagAttrsOf(html, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, "g");
  return [...html.matchAll(re)].map((m) => m[1] ?? "");
}

/**
 * 从属性串里取 `data-group` 的值。
 * @param {string} attrs
 * @returns {string}
 */
function dataGroupOf(attrs) {
  return /data-group="([^"]+)"/.exec(attrs)?.[1] ?? "";
}

/**
 * 命中数期望(手工可核的事实:查询 → 命中条数 / 各组分布 / 首个命中组)。
 * 这些是**关于 zh 字典与控制组归属的稳定事实**,不是把生产侧过滤逻辑重抄一遍 ——
 * 生产侧按 `t(labelKey)` 现算且不在此重述。`total > 0` 由用例当场兜住(防空探针)。
 * @typedef {object} HitExpectation
 * @property {number} total
 * @property {Record<string, number>} byGroup
 * @property {string} firstGroup
 */

/** 当前激活面板的组名(无激活面板返回空串)。 @param {any[]} panels @returns {string} */
function activePanelGroup(panels) {
  return panels.find((p) => p.classList.contains("active"))?.dataset.group ?? "";
}

/**
 * 造一个 `scrollIntoView` 探针:记录每次调用的入参(用于断言「首个命中控件被滚入视野」)。
 * @param {Array<{ block?: string }>} calls 调用记录累加器
 * @returns {(opts?: { block?: string }) => void}
 */
function scrollSpy(calls) {
  return (opts) => {
    calls.push(opts ?? {});
  };
}

export async function run() {
  const suite = createCaseSuite();
  const indexHtml = fs.readFileSync(path.join(ROOT, "src", "renderer", "index.html"), "utf8");
  // 计数类断言先抹掉 HTML 注释(注释里提到 role="tab" 的说明文字不是渲染属性,会污染计数)
  const htmlNoComments = indexHtml.replace(/<!--[\s\S]*?-->/g, " ");

  // tab / 面板分组从真实 index.html 解析(不另抄一份组名清单;两组必须一一配对)
  const tabGroups = tagAttrsOf(indexHtml, "button")
    .filter((a) => /class="settings-tab[^"]*"/.test(a))
    .map(dataGroupOf);
  const panelGroups = tagAttrsOf(indexHtml, "section")
    .filter((a) => /aria-labelledby="settingsTab-/.test(a))
    .map(dataGroupOf);

  /**
   * tab 元素 + 它的计数位探针。classList 走空集构造(dom-stub 默认给 ["hidden"],
   * 那会让「没被隐藏」类断言失去判别力)。
   */
  const tabs = tabGroups.map((group) => {
    const el = makeElement({ id: `settingsTab-${group}`, classList: makeClassList([]) });
    el.dataset.group = group;
    const count = makeElement({ id: `settingsTab-${group}-count`, classList: makeClassList([]) });
    el.querySelector = (sel) => (sel === ".tab-count" ? count : null);
    return { group, el, count };
  });
  const panels = panelGroups.map((group) => {
    const el = makeElement({ id: `settingsPanel-${group}`, classList: makeClassList([]) });
    el.dataset.group = group;
    return el;
  });
  // 初始态复刻 index.html:首个 tab 选中(roving tabindex 的 0 位),其面板 active
  tabs[0]?.el.classList.add("active");
  tabs[0]?.el.setAttribute("aria-selected", "true");
  tabs[0]?.el.setAttribute("tabindex", "0");
  panels[0]?.classList.add("active");

  const dom = installDomStub({
    api: { uiStateSet: async () => ({}), uiStateGet: async () => ({}) },
    trackFocus: true,
    selectorGroups: {
      ".settings-tab": tabs.map((t) => t.el),
      ".settings-panels > .sec": panels,
    },
  });

  try {
    // ⚠ 先装 stub 再 import dist:dist 的 dom/refs.js 在模块求值期就抓 document
    const panel = await import("../../dist/renderer/settings/settings-panel.js");
    const i18n = await import("../../dist/core/i18n/index.js");
    // 文案断言与字典同语言(逐段子进程本已是默认 zh,这里显式钉住,免得对前序状态有隐含假设)
    i18n.setLanguage("zh");

    const filter = dom.elementFor("settingsFilter");
    const filterStatus = dom.elementFor("settingsFilterStatus");

    panel.initSettingsTabs();

    await suite.case("契约 · tab 与面板按 data-group 一一配对,且检索入口不是第三个 tab", () => {
      assert(tabGroups.length === 6, `index.html 应有 6 个 .settings-tab,实际 ${tabGroups.length}`);
      assert(
        tabGroups.join(",") === panelGroups.join(","),
        `tab 与面板的组名/顺序必须逐项一致,实际 tab=[${tabGroups.join(",")}] 面板=[${panelGroups.join(",")}]`,
      );
      // 检索入口刻意不带 role="tab"/"tabpanel"(几何规格与静态契约都按 === 6 计数)
      assertEq(
        (htmlNoComments.match(/role="tab"/g) ?? []).length,
        6,
        'index.html 的 role="tab" 计数',
      );
      assertEq(
        (htmlNoComments.match(/role="tabpanel"/g) ?? []).length,
        6,
        'index.html 的 role="tabpanel" 计数',
      );
      const searchInputAttrs = tagAttrsOf(indexHtml, "input").find((a) =>
        /id="settingsFilter"/.test(a),
      );
      assert(searchInputAttrs !== undefined, "index.html 应有 #settingsFilter 这个检索输入框");
      assert(
        !/role=/.test(/** @type {string} */ (searchInputAttrs)),
        "检索输入框不得带任何 role(它不是分组导航的一员)",
      );
    });

    await suite.case("点击 tab:类名 / aria-selected / roving tabindex / 面板显隐四处同变", () => {
      fireListener(/** @type {any} */ (tabs[1]?.el), "click");
      assert(tabs[1]?.el.classList.contains("active") === true, "点击后该 tab 应加 .active");
      assert(tabs[0]?.el.classList.contains("active") === false, "旧 tab 应摘掉 .active");
      assertEq(tabs[1]?.el.getAttribute("aria-selected"), "true", "点击后 aria-selected");
      assertEq(tabs[0]?.el.getAttribute("aria-selected"), "false", "旧 tab 的 aria-selected");
      assertEq(tabs[1]?.el.getAttribute("tabindex"), "0", "选中项的 roving tabindex");
      assertEq(tabs[0]?.el.getAttribute("tabindex"), "-1", "未选中项的 roving tabindex");
      assertEq(
        panels[1]?.classList.contains("active"),
        true,
        "被点组的面板应 active",
      );
      assertEq(panels[0]?.classList.contains("active"), false, "旧面板应摘掉 active");
    });

    await suite.case("↓ 方向键环移到下一组(自动激活 + 抢焦点)", () => {
      const keyEvent = makeKeyEvent("ArrowDown", tabs[1]?.el);
      fireListener(/** @type {any} */ (tabs[1]?.el), "keydown", keyEvent);
      assertEq(keyEvent.preventDefaultCalled, true, "方向键应 preventDefault(防页面滚动)");
      assert(
        tabs[2]?.el.classList.contains("active") === true,
        "↓ 应把 active 移到下一组(自动激活)",
      );
      assertEq(tabs[2]?.el.getAttribute("aria-selected"), "true", "↓ 后新组的 aria-selected");
      assertEq(tabs[2]?.el.getAttribute("tabindex"), "0", "↓ 后新组的 roving tabindex");
      assertEq(panels[2]?.classList.contains("active"), true, "↓ 后新组面板应 active");
      assert(
        dom.document.activeElement === tabs[2]?.el,
        "↓ 应把焦点移到新组(自动激活,键盘不留在原处)",
      );
    });

    await suite.case("↑ 在首项环回末项;Home / End 跳首尾", () => {
      // ↑ 在首项 → 环回末项
      fireListener(
        /** @type {any} */ (tabs[0]?.el),
        "keydown",
        makeKeyEvent("ArrowUp", tabs[0]?.el),
      );
      const last = tabs[tabs.length - 1];
      assert(
        last?.el.classList.contains("active") === true,
        "↑ 在首项应环回末项(而不是卡住)",
      );
      assert(
        dom.document.activeElement === last?.el,
        "↑ 环回时焦点应随激活一起落到末项",
      );
      // Home → 首项
      fireListener(
        /** @type {any} */ (tabs[3]?.el),
        "keydown",
        makeKeyEvent("Home", tabs[3]?.el),
      );
      assert(tabs[0]?.el.classList.contains("active") === true, "Home 应跳到首项");
      assert(dom.document.activeElement === tabs[0]?.el, "Home 后焦点应在首项");
      // End → 末项
      fireListener(
        /** @type {any} */ (tabs[1]?.el),
        "keydown",
        makeKeyEvent("End", tabs[1]?.el),
      );
      assert(tabs[tabs.length - 1]?.el.classList.contains("active") === true, "End 应跳到末项");
    });

    await suite.case("检索:命中计数落到各 tab、状态行报总数,并激活首个命中组", () => {
      // 「模式」在控件行标签里只出现两次:页眉模式(03 组)与目录模式(04 组)——
      // 跨组命中,故能同时验「分组计数」与「首个命中组」两件事
      /** @type {HitExpectation} */
      const expected = { total: 2, byGroup: { headerwatermark: 1, numbering: 1 }, firstGroup: "headerwatermark" };
      assert(expected.total > 0, "「模式」应至少命中一条(否则本用例没有判别力)");
      filter.value = "模式";
      fireListener(filter, "input");
      for (const { group, count } of tabs) {
        const want = expected.byGroup[group] ?? 0;
        assertEq(count.textContent, want > 0 ? String(want) : "", `${group} 组的命中计数位`);
      }
      assertEq(
        filterStatus.textContent,
        i18n.t("settings.searchHits", { count: expected.total }),
        "状态行应报总命中数(文案来自字典,随语言变)",
      );
      assertEq(activePanelGroup(panels), expected.firstGroup, "应激活首个命中组");
    });

    await suite.case("检索:「模板预设」命中 01 组(预设说明的展示升级不动检索落点)", () => {
      // 01 组唯一控件行标签就是「模板预设」(settings.presetLabel);快速参数条那枚是
      // mirror 条目(labelKey=null),不进检索 ⇒ 命中恰 1 条、落在 preset 组。
      /** @type {HitExpectation} */
      const expected = { total: 1, byGroup: { preset: 1 }, firstGroup: "preset" };
      filter.value = "模板预设";
      fireListener(filter, "input");
      for (const { group, count } of tabs) {
        const want = expected.byGroup[group] ?? 0;
        assertEq(count.textContent, want > 0 ? String(want) : "", `${group} 组的命中计数位`);
      }
      assertEq(
        filterStatus.textContent,
        i18n.t("settings.searchHits", { count: expected.total }),
        "状态行应报「模板预设」的总命中数",
      );
      assertEq(activePanelGroup(panels), "preset", "「模板预设」应命中并跳到 01 预设组");
    });

    await suite.case("检索:无命中写空态文案、计数位清零,且不改动当前激活组", () => {
      const before = activePanelGroup(panels);
      filter.value = "zzz-无此设置项";
      fireListener(filter, "input");
      assertEq(
        filterStatus.textContent,
        i18n.t("settings.searchNoHits"),
        "无命中应写空态文案(不是空白,也不是旧计数)",
      );
      for (const { group, count } of tabs) {
        assertEq(count.textContent, "", `${group} 组无命中时计数位应为空(:empty 收掉占位)`);
      }
      assertEq(activePanelGroup(panels), before, "无命中时不应改动当前激活组(无处可跳)");
    });

    await suite.case("检索:清空查询即收回计数与状态行", () => {
      filter.value = "   ";
      fireListener(filter, "input");
      assertEq(filterStatus.textContent, "", "空查询应清空状态行(:empty 收掉整行)");
      for (const { group, count } of tabs) {
        assertEq(count.textContent, "", `${group} 组空查询时计数位应为空`);
      }
    });

    await suite.case("检索:首个命中控件被滚入视野(id 落点与 radio 落点两形态)", () => {
      // 形态一:按 id 定位(marginTop 是「边距 (mm)」块的首条)
      const marginTop = dom.elementFor("marginTop");
      /** @type {Array<{ block?: string }>} */
      const scrollCalls = [];
      /** @type {any} */ (marginTop).scrollIntoView = scrollSpy(scrollCalls);
      filter.value = "边距";
      fireListener(filter, "input");
      assertEq(activePanelGroup(panels), "typography", "「边距」命中组应为 02 排版");
      assertEq(scrollCalls.length, 1, "首个命中控件应被滚入视野一次");
      assertEq(scrollCalls[0]?.block, "nearest", "滚动应按最近边(block: nearest)");

      // 形态二:radio 分段按组名取组内首个成员(document 级选择器)
      const alignEl = makeElement({ id: "align-probe", classList: makeClassList([]) });
      /** @type {Array<{ block?: string }>} */
      const radioScrolls = [];
      /** @type {any} */ (alignEl).scrollIntoView = scrollSpy(radioScrolls);
      /** @type {any} */ (dom.document).querySelector = (/** @type {string} */ sel) =>
        sel === 'input[name="align"]' ? alignEl : null;
      filter.value = "对齐";
      fireListener(filter, "input");
      assertEq(radioScrolls.length, 1, "radio 落点也应被滚入视野一次");
    });

    await suite.case("检索不新增可见性形态:面板类名只动 active,控件不被隐藏", () => {
      filter.value = "页眉";
      fireListener(filter, "input");
      for (const p of panels) {
        assert(
          p.classList.contains("hidden") === false,
          `面板 ${p.dataset.group} 被隐藏了 —— 检索只做计数与跳转,不得引入第三种可见性形态`,
        );
      }
      assertEq(activePanelGroup(panels), "headerwatermark", "「页眉」命中组应为 03");
    });

    console.log(
      "[ok] settings-search:6 组 tab 与面板配对 + 点击/↑↓/Home/End 键盘导航(类名/aria-selected/"
        + "roving tabindex/焦点四处同变)+ 跨组检索(分组计数 / 状态行 / 首个命中跳转 / 无命中空态 / "
        + "清空回收 / 「模板预设」落 01 组)+ 检索不新增可见性形态,全部通过",
    );
    return { cases: suite.results };
  } finally {
    dom.restore();
  }
}
