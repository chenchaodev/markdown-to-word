/**
 * 应用组(Tab「应 用」)接线:抽屉底部恢复默认/界面语言切换/外观主题。
 * 语言选项须在绑定前按注册表重建(输入为运行期生成,顺序不可倒)。
 * 分组口径 = index.html 六组 Tab 的 data-group=app;拆自
 * settings-bindings.ts(D2,纯搬移零行为改动),编排入口在 settings-bindings。
 */
import { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";
import { applyStaticTexts, setLanguage, t, type Language } from "../../core/i18n.js";
import { drawerResetBtn, languageSelect, themeInputs } from "../dom/refs.js";
import { state } from "../state/state.js";
import { setStatus } from "../state/utils.js";
import { renderSelection } from "../convert/file-list.js";
import { showToast } from "../ui/toast.js";
import {
  applySettingsToControls,
  applyTheme,
  mirrorLanguage,
  persistSettings,
  rebuildLanguageOptions,
  refreshDynamicSettingsText,
} from "./settings-panel.js";

/** 应用组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindAppGroup(): void {
  // 抽屉底部「恢复默认」——转换相关各组复位为默认值并整体持久化
  //(theme/language 与自定义预设保留,不随此键重置;toast 只陈述事实)
  drawerResetBtn.addEventListener("click", () => {
    if (state.hydratingSettings) return;
    const d = DEFAULT_SETTINGS;
    state.settings.pageSetup = { ...d.pageSetup };
    state.settings.typography = { ...d.typography };
    state.settings.breakBeforeH1 = d.breakBeforeH1;
    state.settings.toc = d.toc;
    state.settings.tocMode = d.tocMode;
    state.settings.equationNumbering = d.equationNumbering;
    state.settings.aiCleanup = d.aiCleanup;
    state.settings.obsidianCompat = d.obsidianCompat;
    state.settings.obsidianAttachmentFolder = d.obsidianAttachmentFolder;
    state.settings.afterConvert = d.afterConvert;
    state.settings.outputDir = d.outputDir;
    state.settings.pdfCss = d.pdfCss;
    state.settings.headerFooter = { ...d.headerFooter };
    state.settings.watermark = { ...d.watermark };
    state.hydratingSettings = true;
    applySettingsToControls();
    state.hydratingSettings = false;
    persistSettings({
      pageSetup: { ...state.settings.pageSetup },
      typography: { ...state.settings.typography },
      breakBeforeH1: state.settings.breakBeforeH1,
      toc: state.settings.toc,
      tocMode: state.settings.tocMode,
      equationNumbering: state.settings.equationNumbering,
      aiCleanup: state.settings.aiCleanup,
      obsidianCompat: state.settings.obsidianCompat,
      obsidianAttachmentFolder: state.settings.obsidianAttachmentFolder,
      afterConvert: state.settings.afterConvert,
      outputDir: state.settings.outputDir,
      pdfCss: state.settings.pdfCss,
      headerFooter: { ...state.settings.headerFooter },
      watermark: { ...state.settings.watermark },
    });
    showToast(t("toast.settingsReset"));
  });

  // i18n:界面语言切换(自 radio 组改 select;选项由 LANGUAGES 注册表动态生成,
  // 须先于事件绑定重建;即时生效:静态文案重刷 + 动态节点按新语言重算,
  // 状态栏/文件列表/最近区块等动态区域显式重渲染)
  rebuildLanguageOptions();
  languageSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const lang = languageSelect.value as Language;
    state.settings.language = lang;
    setLanguage(lang);
    mirrorLanguage(lang); // 切换落定即镜像,下次启动 lang-bootstrap.js 尽早生效
    applyStaticTexts(); // 静态文案:字典 → DOM
    // 动态状态节点(输出目录 / PDF CSS / Logo / 预设提示)不带 data-i18n,
    // 必须在此按新语言重算,否则会停在旧语言文案(见 settings-panel 同名注释)
    refreshDynamicSettingsText();
    persistSettings({ language: lang });
    setStatus("");
    renderSelection();
    void state.recentRefreshHandler?.();
  });

  // 外观主题切换(radio;即时生效:data-theme 属性设/移除 + 持久化;
  // system = 移除属性,CSS @media prefers-color-scheme 接管)
  themeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      const theme = input.value as AppSettings["theme"];
      state.settings.theme = theme;
      applyTheme(theme);
      persistSettings({ theme });
    });
  });
}
