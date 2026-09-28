/**
 * 应用组(Tab「应 用」)接线:抽屉底部恢复默认/界面语言切换/外观主题。
 *
 * change 监听由声明表统一接线;本文件只留:
 *  - 抽屉底部「恢复默认」(复位集与白名单都在声明表里 —— 见 resetSettingsToDefaults);
 *  - 两个写侧钩子:外观主题即时改文档根的 data-theme、界面语言切换要重刷静态文案
 *    与动态节点(这两处的副作用是运行时效果,不是「写设置」能表达的)。
 * 语言选项须在**接线之前**按注册表重建(输入为运行期生成,顺序不可倒)。
 * 分组口径 = index.html 六组 Tab 的 data-group=app。
 */
import { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";
import { applyStaticTexts, setLanguage, t, type Language } from "../../core/i18n.js";
import { drawerResetBtn } from "../dom/refs.js";
import { state } from "../state/state.js";
import { setStatus } from "../ui/dom-ops.js";
import { renderSelection } from "../convert/file-list.js";
import { showToast } from "../ui/toast.js";
import {
  bindControlGroup,
  resetSettingsToDefaults,
  type WriteHook,
  type WriteHooksOf,
} from "./settings-controls-table.js";
import {
  applySettingsToControls,
  applyTheme,
  controlDom,
  mirrorLanguage,
  persistSettings,
  rebuildLanguageOptions,
  refreshDynamicSettingsText,
  settingsWriteContext,
} from "./settings-panel.js";

/** 外观主题:即时生效(system = 移除属性,CSS @media prefers-color-scheme 接管)。 */
const themeHook: WriteHook = (_ctx, control, write) => {
  const theme = control.value as AppSettings["theme"];
  applyTheme(theme);
  write(theme);
};

/** 界面语言:即时生效 —— 静态文案重刷 + 动态节点按新语言重算,
 *  状态栏/文件列表/最近区块等动态区域显式重渲染。 */
const languageHook: WriteHook = (_ctx, control, write) => {
  const lang = control.value as Language;
  setLanguage(lang);
  mirrorLanguage(lang); // 切换落定即镜像,下次启动 lang-bootstrap.js 尽早生效
  applyStaticTexts(); // 静态文案:字典 → DOM
  // 动态状态节点(输出目录 / PDF CSS / Logo / 预设提示)不带 data-i18n,
  // 必须在此按新语言重算,否则会停在旧语言文案(见 settings-panel 同名注释)
  refreshDynamicSettingsText();
  write(lang); // 落值与持久化排在 UI 重刷之后(与旧接线同序)
  setStatus("");
  renderSelection();
  void state.recentRefreshHandler?.();
};

/** 本组声明了写侧钩子的条目(键集由表反推,多写/漏写即 tsc 报错)。 */
export const appWriteHooks: WriteHooksOf<"app"> = {
  theme: themeHook,
  languageSelect: languageHook,
};

/** 应用组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindAppGroup(hooks: WriteHooksOf<"app">): void {
  rebuildLanguageOptions();
  bindControlGroup("app", controlDom, settingsWriteContext, hooks);

  // 抽屉底部「恢复默认」——按声明表算出的复位集复位并整体持久化
  //(theme/language 与自定义预设是表里显式登记的保留项,不随此键重置;toast 只陈述事实)
  drawerResetBtn.addEventListener("click", () => {
    if (state.hydratingSettings) return;
    const patch = resetSettingsToDefaults(state.settings, DEFAULT_SETTINGS);
    state.hydratingSettings = true;
    applySettingsToControls();
    state.hydratingSettings = false;
    persistSettings(patch);
    showToast(t("toast.settingsReset"));
  });
}
