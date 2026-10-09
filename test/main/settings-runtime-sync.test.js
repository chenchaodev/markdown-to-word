// @ts-check
/**
 * 设置落盘后 main 侧运行时副作用段(src/main/ipc/register.ts 的运行时副作用区块;
 * 经 dist/main/ipc/register.js,运行于 Electron 主进程——模块 import electron 与
 * menu/buildAppMenu,须在 Electron 环境加载):
 * 断言面(纯判定 + 注入触点,零真实窗口/磁盘依赖):
 * - planSettingsRuntimeSync:语言变 → { language, menu:true };主题变 → { overlay };
 *   两者都变 → 三项齐全;都没变 → 全 null/false(不做无谓动作);
 * - before=null(启动路径)→ 全量应用一次(主进程初值即默认,不比较);
 * - applySettingsRuntimeSync:按判定调用注入的 setLanguage/buildMenu/syncOverlay,
 *   且 syncOverlay 拿到 resolveMainWindow() 解析出的窗口;
 * - overlay 真链路:注入真实 syncTitleBarOverlay + 假窗口 → win32 下按主题
 *   写入对应配色与高度(非 win32 为平台内空操作,断言不调用);
 * - applyStartupSettingsRuntime:启动入口等价 before=null 的全量应用。
 */
import {
  applySettingsRuntimeSync,
  applyStartupSettingsRuntime,
  planSettingsRuntimeSync,
} from "../../dist/main/ipc/register.js";
import {
  syncTitleBarOverlay,
  TITLE_BAR_OVERLAY_COLORS,
  TITLE_BAR_OVERLAY_HEIGHT,
} from "../../dist/main/windows/title-bar-overlay.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("settings-runtime-sync");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游代码依赖收窄 ⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/** 假 BrowserWindow(overlay 只需 isDestroyed + setTitleBarOverlay 两个面) */
/** @typedef {{ isDestroyed: () => boolean, setTitleBarOverlay: (options: TitleBarOverlay) => void }} FakeWindow */
/** 下发给 setTitleBarOverlay 的 overlay 参数(配色 + 高度) */
/** @typedef {{ color: string, symbolColor: string, height: number }} TitleBarOverlay */
/** 界面语言(契约单源) */
/** @typedef {import("../../dist/core/i18n/index.js").Language} Language */
/** 主题偏好(契约单源) */
/** @typedef {import("../../dist/core/settings/settings-defaults.js").ThemePreference} ThemePreference */
/** 运行时副作用注入面(契约单源) */
/** @typedef {import("../../dist/main/ipc/register.js").SettingsRuntimeDeps} SettingsRuntimeDeps */
/** 一次调用的记录元素(动作名 + 该动作的参数) */
/** @typedef {(string | TitleBarOverlay | FakeWindow | null)[]} CallRecord */

/**
 * 假窗口 → BrowserWindow 的入参收窄:SettingsRuntimeDeps.syncOverlay 的
 * 第二参与 syncTitleBarOverlay 的第一参都是 electron 的 BrowserWindow
 * (175 个成员),而本段只需其中 isDestroyed / setTitleBarOverlay 两面 ——
 * 假窗口按「被消费的那两面」如实建模,注入契约面时在此单点收窄。
 * 不用 fake-window 形态冒充整类:那会让读者以为夹具实现了 175 个成员。
 * @param {FakeWindow | null} win 假窗口
 * @returns {import("electron").BrowserWindow | null} 契约面的窗口引用
 */
const asMainWindow = (win) => /** @type {import("electron").BrowserWindow | null} */ (/** @type {unknown} */ (win));

/**
 * 记录调用序的假触点(返回值即调用序列,便于断言「调了谁、传了什么」)。
 * deps 的类型即契约面 SettingsRuntimeDeps(注入点签名不得比契约宽)。
 * @param {FakeWindow | null} [win] 假窗口
 * @returns {{ calls: CallRecord[], deps: SettingsRuntimeDeps }} 调用序列 + 注入依赖
 */
function spyDeps(win = null) {
  const calls = /** @type {CallRecord[]} */ ([]);
  return {
    calls,
    deps: {
      setLanguage: (/** @type {Language} */ lang) => calls.push(["setLanguage", lang]),
      buildMenu: () => calls.push(["buildMenu"]),
      syncOverlay: (/** @type {ThemePreference} */ pref, target) =>
        calls.push(["syncOverlay", pref, /** @type {FakeWindow | null} */ (/** @type {unknown} */ (target))]),
      resolveMainWindow: () => asMainWindow(win),
    },
  };
}

/**
 * 假 BrowserWindow(overlay 只需 isDestroyed + setTitleBarOverlay 两个面)。
 * @returns {{ calls: TitleBarOverlay[], win: FakeWindow }} 下发记录 + 假窗口
 */
function fakeWindow() {
  const calls = /** @type {TitleBarOverlay[]} */ ([]);
  return {
    calls,
    win: {
      isDestroyed: () => false,
      setTitleBarOverlay: (/** @type {TitleBarOverlay} */ options) => calls.push(options),
    },
  };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  await suite.describe("planSettingsRuntimeSync", async (s) => {
    // ---- 1. 判定:单项变化 / 无变化 / 双项变化 ----
    await s.case("仅语言变化 → { language, menu:true, overlay:null }", () => {
      const langOnly = planSettingsRuntimeSync(
        { language: "zh", theme: "system" },
        { language: "en", theme: "system" },
      );
      assert(langOnly.language === "en" && langOnly.menu === true && langOnly.overlay === null,
        `仅语言变化应得 { language:'en', menu:true, overlay:null },实际 ${JSON.stringify(langOnly)}`);
    });

    await s.case("仅主题变化 → { language:null, menu:false, overlay }", () => {
      const themeOnly = planSettingsRuntimeSync(
        { language: "zh", theme: "system" },
        { language: "zh", theme: "dark" },
      );
      assert(themeOnly.language === null && themeOnly.menu === false && themeOnly.overlay === "dark",
        `仅主题变化应得 { language:null, menu:false, overlay:'dark' },实际 ${JSON.stringify(themeOnly)}`);
    });

    await s.case("双项变化 → 三项齐全", () => {
      const both = planSettingsRuntimeSync(
        { language: "zh", theme: "light" },
        { language: "ja", theme: "dark" },
      );
      assert(both.language === "ja" && both.menu === true && both.overlay === "dark",
        `双项变化应三项齐全,实际 ${JSON.stringify(both)}`);
    });

    await s.case("无变化 → 全不动作", () => {
      const none = planSettingsRuntimeSync(
        { language: "en", theme: "dark" },
        { language: "en", theme: "dark" },
      );
      assert(none.language === null && none.menu === false && none.overlay === null,
        `无变化应全不动作,实际 ${JSON.stringify(none)}`);
    });

    // 启动路径(before=null):主进程一切都是初值 → 全量应用
    await s.case("启动路径(before=null) → 全量应用", () => {
      const startup = planSettingsRuntimeSync(null, { language: "en", theme: "light" });
      assert(startup.language === "en" && startup.menu === true && startup.overlay === "light",
        `启动路径(before=null)应全量应用,实际 ${JSON.stringify(startup)}`);
    });
  });
  console.log("[ok] settings-runtime-sync:planSettingsRuntimeSync 语言/主题/双项/无变化/启动全量 断言通过");

  // ---- 2. 执行:语言变化 → setLanguage + buildMenu,且不经 syncOverlay ----
  const langCase = spyDeps();
  applySettingsRuntimeSync(
    { language: "zh", theme: "system" },
    { language: "en", theme: "system" },
    langCase.deps,
  );
  await suite.case("语言变化按序调 setLanguage + buildMenu(不经 syncOverlay)", () => {
    assert(JSON.stringify(langCase.calls) === JSON.stringify([["setLanguage", "en"], ["buildMenu"]]),
      `语言变化应按序调 setLanguage('en') + buildMenu,实际 ${JSON.stringify(langCase.calls)}`);
  });

  // 主题变化 → 只同步 overlay(不重置语言、不重建菜单)
  const { calls: themeCalls, deps: themeDeps } = spyDeps();
  applySettingsRuntimeSync(
    { language: "en", theme: "system" },
    { language: "en", theme: "dark" },
    themeDeps,
  );
  await suite.case("主题变化只调 syncOverlay(不重置语言/不重建菜单)", () => {
    assert(themeCalls.length === 1 && themeCalls[0]?.[0] === "syncOverlay" && themeCalls[0]?.[1] === "dark",
      `主题变化应只调 syncOverlay('dark'),实际 ${JSON.stringify(themeCalls)}`);
  });

  // 无变化 → 零调用
  const idleCase = spyDeps();
  applySettingsRuntimeSync(
    { language: "en", theme: "dark" },
    { language: "en", theme: "dark" },
    idleCase.deps,
  );
  await suite.case("无变化零副作用调用", () => {
    assert(idleCase.calls.length === 0,
      `无变化不应有任何副作用调用,实际 ${JSON.stringify(idleCase.calls)}`);
  });
  console.log("[ok] settings-runtime-sync:applySettingsRuntimeSync 按判定分发(setLanguage/buildMenu/syncOverlay/无变化零调用)断言通过");

  // ---- 3. syncOverlay 拿到 resolveMainWindow() 解析出的窗口(不经 getMainWindow 二次解析) ----
  const target = fakeWindow();
  const targetCase = spyDeps(target.win);
  applySettingsRuntimeSync(
    { language: "zh", theme: "light" },
    { language: "zh", theme: "dark" },
    targetCase.deps,
  );
  await suite.case("syncOverlay 第二参为 resolveMainWindow() 解析结果", () => {
    assert(targetCase.calls.length === 1 && targetCase.calls[0]?.[2] === target.win,
      "syncOverlay 第二参应为 resolveMainWindow() 解析结果");
  });

  // ---- 4. overlay 真链路:真实 syncTitleBarOverlay + 假窗口 → 写入对应配色 ----
  await suite.describe("overlay 真链路", async (s) => {
    // const 标注:数组元素推成 "light"|"dark" 字面量联合(否则 theme 会退化成 string)
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      const fw = fakeWindow();
      applySettingsRuntimeSync(
        { language: "zh", theme: "system" },
        { language: "zh", theme },
        {
          setLanguage: () => {},
          buildMenu: () => {},
          syncOverlay: (pref, win) => syncTitleBarOverlay(win, pref),
          resolveMainWindow: () => asMainWindow(fw.win),
        },
      );
      await s.case(`theme=${theme} → 按窗口下发对应配色与高度`, () => {
        if (process.platform === "win32") {
          assert(fw.calls.length === 1, `theme=${theme} 应向主窗口下发一次 setTitleBarOverlay,实际 ${fw.calls.length} 次`);
          const got = fw.calls[0];
          assert(got !== undefined, `theme=${theme} 应取到唯一一次下发的 overlay 参数`);
          const want = TITLE_BAR_OVERLAY_COLORS[/** @type {"light" | "dark"} */ (theme)];
          assert(
            got.color === want.color && got.symbolColor === want.symbolColor &&
              got.height === TITLE_BAR_OVERLAY_HEIGHT,
            `theme=${theme} overlay 配色/高度不符,实际 ${JSON.stringify(got)}`,
          );
        } else {
          // 非 win32:无边框路线不启用 overlay,平台内空操作(不得抛错)
          assert(fw.calls.length === 0, `非 win32 不应下发 overlay,实际 ${fw.calls.length} 次`);
        }
      });
    }
    // 「跟随系统」也走同一入口(配色由 nativeTheme 解析,单源在 title-bar-overlay)
    const sysFw = fakeWindow();
    applySettingsRuntimeSync(
      { language: "zh", theme: "dark" },
      { language: "zh", theme: "system" },
      {
        setLanguage: () => {},
        buildMenu: () => {},
        syncOverlay: (pref, win) => syncTitleBarOverlay(win, pref),
        resolveMainWindow: () => asMainWindow(sysFw.win),
      },
    );
    await s.case("theme=system → 下发一次且配色取自 light/dark 两态之一", () => {
      if (process.platform === "win32") {
        const got = sysFw.calls[0];
        assert(got !== undefined, "system 主题应取到唯一一次下发的 overlay 参数");
        const colors = [TITLE_BAR_OVERLAY_COLORS.light, TITLE_BAR_OVERLAY_COLORS.dark];
        assert(
          sysFw.calls.length === 1 &&
            colors.some((c) => c.color === got.color && c.symbolColor === got.symbolColor) &&
            got.height === TITLE_BAR_OVERLAY_HEIGHT,
          `system 主题应下发一次且配色取自 light/dark 两态之一,实际 ${JSON.stringify(sysFw.calls)}`,
        );
      }
    });
  });
  console.log("[ok] settings-runtime-sync:overlay 真链路(light/dark/system 配色与高度按窗口下发)断言通过");

  // ---- 5. 启动入口:等价 before=null 全量应用 ----
  const startupCase = spyDeps();
  const plan = applyStartupSettingsRuntime({ language: "ja", theme: "light" }, startupCase.deps);
  await suite.case("启动入口依次 setLanguage + buildMenu + syncOverlay", () => {
    assert(plan.language === "ja" && plan.menu === true && plan.overlay === "light",
      `启动入口应返回全量 plan,实际 ${JSON.stringify(plan)}`);
    assert(
      JSON.stringify(startupCase.calls) === JSON.stringify([
        ["setLanguage", "ja"],
        ["buildMenu"],
        ["syncOverlay", "light", null],
      ]),
      `启动入口应依次 setLanguage + buildMenu + syncOverlay,实际 ${JSON.stringify(startupCase.calls)}`,
    );
  });
  console.log("[ok] settings-runtime-sync:applyStartupSettingsRuntime 启动全量(setLanguage/buildMenu/syncOverlay)断言通过");

  return { cases: suite.results };
}
