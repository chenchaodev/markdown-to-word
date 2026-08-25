/**
 * 标题栏 overlay 配色单源测试(src/main/windows/title-bar-overlay.ts 纯逻辑层;
 * 测试经 dist/main/windows/title-bar-overlay.js,运行于 Electron 主进程——
 * 模块 import nativeTheme,须在 Electron 环境加载):
 * 断言面(界面重构 v3):
 * - 常量契约:light/dark 色值与高度与视觉基准一致(#F7F7F4/#1E2126、#191D23/#E9E7E1、44px),
 *   防 BrowserWindow 初始 options 与运行时同步两侧漂移;
 * - isThemePreference IPC 入参守卫:三枚举放行,非法值(null/数字/未知串)拒绝;
 * - resolveEffectiveTheme:显式 light/dark 原样透传;system 解析结果与
 *   nativeTheme.shouldUseDarkMode 一致且必为二枚举之一;
 * - syncTitleBarOverlay 空安全:null / 已销毁窗口不抛错(非 win32 亦静默空操作)。
 */
import { nativeTheme } from "electron";
import {
  isThemePreference,
  resolveEffectiveTheme,
  syncTitleBarOverlay,
  TITLE_BAR_OVERLAY_COLORS,
  TITLE_BAR_OVERLAY_HEIGHT,
} from "../../dist/main/windows/title-bar-overlay.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`title-bar-overlay 断言失败:${msg}`);
}

export async function run() {
  // ---- 常量契约(与 docs/design/ui-mockup.html 视觉基准一致;改动须双侧同步) ----
  assert(TITLE_BAR_OVERLAY_HEIGHT === 44, `height 应为 44,实际 ${TITLE_BAR_OVERLAY_HEIGHT}`);
  assert(TITLE_BAR_OVERLAY_COLORS.light.color === "#F7F7F4", "light.color 漂移");
  assert(TITLE_BAR_OVERLAY_COLORS.light.symbolColor === "#1E2126", "light.symbolColor 漂移");
  assert(TITLE_BAR_OVERLAY_COLORS.dark.color === "#191D23", "dark.color 漂移");
  assert(TITLE_BAR_OVERLAY_COLORS.dark.symbolColor === "#E9E7E1", "dark.symbolColor 漂移");
  console.log("[ok] title-bar-overlay:overlay 色值/高度常量契约 断言通过");

  // ---- IPC 入参守卫 ----
  for (const v of ["system", "light", "dark"]) {
    assert(isThemePreference(v), `isThemePreference 应放行 "${v}"`);
  }
  for (const v of [null, undefined, 42, "auto", "", "Light"]) {
    assert(!isThemePreference(v), `isThemePreference 应拒绝 ${JSON.stringify(v)}`);
  }
  console.log("[ok] title-bar-overlay:isThemePreference 入参守卫 断言通过");

  // ---- 主题解析:显式透传 + system 按 nativeTheme 解析 ----
  assert(resolveEffectiveTheme("light") === "light", "显式 light 应透传");
  assert(resolveEffectiveTheme("dark") === "dark", "显式 dark 应透传");
  const expected = nativeTheme.shouldUseDarkMode ? "dark" : "light";
  assert(resolveEffectiveTheme("system") === expected, "system 应解析为 nativeTheme 实际生效主题");
  console.log("[ok] title-bar-overlay:resolveEffectiveTheme 主题解析 断言通过");

  // ---- 空安全:不抛错即通过(setTitleBarOverlay 失败路径由警告留痕,不中断) ----
  syncTitleBarOverlay(null, "dark");
  const fakeDestroyed = { isDestroyed: () => true };
  syncTitleBarOverlay(fakeDestroyed, "light");
  console.log("[ok] title-bar-overlay:syncTitleBarOverlay 空引用/已销毁安全 断言通过");
}
