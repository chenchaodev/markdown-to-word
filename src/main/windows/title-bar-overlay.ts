/**
 * 界面重构 v3:Windows 标题栏 overlay(titleBarOverlay)配色单源。
 * - 色值/高度常量唯一来源:BrowserWindow 初始 options 与运行时 setTitleBarOverlay
 *   均从这里取值,禁止散落字面量;
 * - 主题主动方是 renderer(设置面板切换 + 持久化),经 IPC「theme:syncOverlay」
 *   把主题偏好推给 main;「跟随系统」在此按 nativeTheme.shouldUseDarkMode 解析为
 *   实际生效主题(renderer 的 CSS @media prefers-color-scheme 自动接管视觉层,
 *   overlay 是原生绘制必须由 main 手动跟随);
 * - 仅 Windows 生效(titleBarOverlay 为 Windows/Linux 特性,本项目只对 win32 启用
 *   无边框路线),其他平台直接空操作。
 */
import { nativeTheme, type BrowserWindow } from "electron";
import type { ThemePreference } from "../../core/settings/settings-defaults.js";

/** 标题栏高度(px):与渲染层自绘标题栏视觉基准(docs/design/ui-mockup.html)对齐。 */
export const TITLE_BAR_OVERLAY_HEIGHT = 44;

/** overlay 配色(light/dark 两态;色值与渲染层 CSS 变量基准一致,勿单侧改动)。 */
export const TITLE_BAR_OVERLAY_COLORS = {
  light: { color: "#F7F7F4", symbolColor: "#1E2126" },
  dark: { color: "#191D23", symbolColor: "#E9E7E1" },
} as const;

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** IPC 入参守卫(preload 白名单外仍须校验;与 core ThemePreference 契约同枚举)。 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** 「跟随系统」→ 实际生效主题(nativeTheme 为 main 侧系统深浅色唯一事实源)。 */
export function resolveEffectiveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return pref;
}

/**
 * 按主题偏好同步主窗口标题栏 overlay 配色。
 * 失败不中断(仅警告留痕):overlay 配色失败不影响功能,旧配色残留可接受,
 * 不值得为此打断主题切换链路。
 */
export function syncTitleBarOverlay(win: BrowserWindow | null, pref: ThemePreference): void {
  if (!win || win.isDestroyed()) return;
  if (process.platform !== "win32") return; // 无边框路线仅 win32 启用,其他平台无 overlay 可设
  try {
    win.setTitleBarOverlay({
      ...TITLE_BAR_OVERLAY_COLORS[resolveEffectiveTheme(pref)],
      height: TITLE_BAR_OVERLAY_HEIGHT,
    });
  } catch (err) {
    console.warn("[main] setTitleBarOverlay 失败(标题栏按钮区配色未更新):", err);
  }
}
