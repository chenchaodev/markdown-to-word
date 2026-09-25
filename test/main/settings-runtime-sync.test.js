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

function assert(cond, msg) {
  if (!cond) throw new Error(`settings-runtime-sync 断言失败:${msg}`);
}

/** 记录调用序的假触点(返回值即调用序列,便于断言「调了谁、传了什么」)。 */
function spyDeps(win = null) {
  const calls = [];
  return {
    calls,
    deps: {
      setLanguage: (lang) => calls.push(["setLanguage", lang]),
      buildMenu: () => calls.push(["buildMenu"]),
      syncOverlay: (pref, target) => calls.push(["syncOverlay", pref, target]),
      resolveMainWindow: () => win,
    },
  };
}

/** 假 BrowserWindow(overlay 只需 isDestroyed + setTitleBarOverlay 两个面)。 */
function fakeWindow() {
  const calls = [];
  return {
    calls,
    win: {
      isDestroyed: () => false,
      setTitleBarOverlay: (options) => calls.push(options),
    },
  };
}

export async function run() {
  // ---- 1. 判定:单项变化 / 无变化 / 双项变化 ----
  const langOnly = planSettingsRuntimeSync(
    { language: "zh", theme: "system" },
    { language: "en", theme: "system" },
  );
  assert(langOnly.language === "en" && langOnly.menu === true && langOnly.overlay === null,
    `仅语言变化应得 { language:'en', menu:true, overlay:null },实际 ${JSON.stringify(langOnly)}`);

  const themeOnly = planSettingsRuntimeSync(
    { language: "zh", theme: "system" },
    { language: "zh", theme: "dark" },
  );
  assert(themeOnly.language === null && themeOnly.menu === false && themeOnly.overlay === "dark",
    `仅主题变化应得 { language:null, menu:false, overlay:'dark' },实际 ${JSON.stringify(themeOnly)}`);

  const both = planSettingsRuntimeSync(
    { language: "zh", theme: "light" },
    { language: "ja", theme: "dark" },
  );
  assert(both.language === "ja" && both.menu === true && both.overlay === "dark",
    `双项变化应三项齐全,实际 ${JSON.stringify(both)}`);

  const none = planSettingsRuntimeSync(
    { language: "en", theme: "dark" },
    { language: "en", theme: "dark" },
  );
  assert(none.language === null && none.menu === false && none.overlay === null,
    `无变化应全不动作,实际 ${JSON.stringify(none)}`);

  // 启动路径(before=null):主进程一切都是初值 → 全量应用
  const startup = planSettingsRuntimeSync(null, { language: "en", theme: "light" });
  assert(startup.language === "en" && startup.menu === true && startup.overlay === "light",
    `启动路径(before=null)应全量应用,实际 ${JSON.stringify(startup)}`);
  console.log("[ok] settings-runtime-sync:planSettingsRuntimeSync 语言/主题/双项/无变化/启动全量 断言通过");

  // ---- 2. 执行:语言变化 → setLanguage + buildMenu,且不经 syncOverlay ----
  const langCase = spyDeps();
  applySettingsRuntimeSync(
    { language: "zh", theme: "system" },
    { language: "en", theme: "system" },
    langCase.deps,
  );
  assert(JSON.stringify(langCase.calls) === JSON.stringify([["setLanguage", "en"], ["buildMenu"]]),
    `语言变化应按序调 setLanguage('en') + buildMenu,实际 ${JSON.stringify(langCase.calls)}`);

  // 主题变化 → 只同步 overlay(不重置语言、不重建菜单)
  const { calls: themeCalls, deps: themeDeps } = spyDeps();
  applySettingsRuntimeSync(
    { language: "en", theme: "system" },
    { language: "en", theme: "dark" },
    themeDeps,
  );
  assert(themeCalls.length === 1 && themeCalls[0][0] === "syncOverlay" && themeCalls[0][1] === "dark",
    `主题变化应只调 syncOverlay('dark'),实际 ${JSON.stringify(themeCalls)}`);

  // 无变化 → 零调用
  const idleCase = spyDeps();
  applySettingsRuntimeSync(
    { language: "en", theme: "dark" },
    { language: "en", theme: "dark" },
    idleCase.deps,
  );
  assert(idleCase.calls.length === 0,
    `无变化不应有任何副作用调用,实际 ${JSON.stringify(idleCase.calls)}`);
  console.log("[ok] settings-runtime-sync:applySettingsRuntimeSync 按判定分发(setLanguage/buildMenu/syncOverlay/无变化零调用)断言通过");

  // ---- 3. syncOverlay 拿到 resolveMainWindow() 解析出的窗口(不经 getMainWindow 二次解析) ----
  const target = fakeWindow();
  const targetCase = spyDeps(target.win);
  applySettingsRuntimeSync(
    { language: "zh", theme: "light" },
    { language: "zh", theme: "dark" },
    targetCase.deps,
  );
  assert(targetCase.calls.length === 1 && targetCase.calls[0][2] === target.win,
    "syncOverlay 第二参应为 resolveMainWindow() 解析结果");

  // ---- 4. overlay 真链路:真实 syncTitleBarOverlay + 假窗口 → 写入对应配色 ----
  for (const theme of ["light", "dark"]) {
    const fw = fakeWindow();
    applySettingsRuntimeSync(
      { language: "zh", theme: "system" },
      { language: "zh", theme: theme },
      {
        setLanguage: () => {},
        buildMenu: () => {},
        syncOverlay: (pref, win) => syncTitleBarOverlay(win, pref),
        resolveMainWindow: () => fw.win,
      },
    );
    if (process.platform === "win32") {
      assert(fw.calls.length === 1, `theme=${theme} 应向主窗口下发一次 setTitleBarOverlay,实际 ${fw.calls.length} 次`);
      const got = fw.calls[0];
      const want = TITLE_BAR_OVERLAY_COLORS[theme];
      assert(
        got.color === want.color && got.symbolColor === want.symbolColor &&
          got.height === TITLE_BAR_OVERLAY_HEIGHT,
        `theme=${theme} overlay 配色/高度不符,实际 ${JSON.stringify(got)}`,
      );
    } else {
      // 非 win32:无边框路线不启用 overlay,平台内空操作(不得抛错)
      assert(fw.calls.length === 0, `非 win32 不应下发 overlay,实际 ${fw.calls.length} 次`);
    }
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
      resolveMainWindow: () => sysFw.win,
    },
  );
  if (process.platform === "win32") {
    const got = sysFw.calls[0];
    const colors = [TITLE_BAR_OVERLAY_COLORS.light, TITLE_BAR_OVERLAY_COLORS.dark];
    assert(
      sysFw.calls.length === 1 &&
        colors.some((c) => c.color === got.color && c.symbolColor === got.symbolColor) &&
        got.height === TITLE_BAR_OVERLAY_HEIGHT,
      `system 主题应下发一次且配色取自 light/dark 两态之一,实际 ${JSON.stringify(sysFw.calls)}`,
    );
  }
  console.log("[ok] settings-runtime-sync:overlay 真链路(light/dark/system 配色与高度按窗口下发)断言通过");

  // ---- 5. 启动入口:等价 before=null 全量应用 ----
  const startupCase = spyDeps();
  const plan = applyStartupSettingsRuntime({ language: "ja", theme: "light" }, startupCase.deps);
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
  console.log("[ok] settings-runtime-sync:applyStartupSettingsRuntime 启动全量(setLanguage/buildMenu/syncOverlay)断言通过");
}
