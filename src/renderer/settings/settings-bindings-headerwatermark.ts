/**
 * 页眉页脚与水印组(Tab「页眉页脚与水印」)接线:页眉模式(自定义字段块随之
 * 显隐)/页眉文字/页脚开关/logo 选择与清除/水印文字/角度/不透明度/浅灰——
 * 变更钳制后即时写回并持久化。
 * 分组口径 = index.html 六组 Tab 的 data-group=headerwatermark;拆自
 * settings-bindings.ts(纯搬移零行为改动),编排入口在 settings-bindings。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
import {
  footerEnabledInput,
  headerLayoutInputs,
  headerLogoClearBtn,
  headerLogoPickBtn,
  headerModeInputs,
  headerTextInput,
  watermarkAngleInput,
  watermarkGrayInput,
  watermarkOpacityInput,
  watermarkTextInput,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import {
  persistHeaderFooter,
  persistWatermark,
  syncHeaderCustomVisibility,
  syncHeaderLogoDisplay,
} from "./settings-panel.js";

/** 页眉页脚与水印组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindHeaderWatermarkGroup(): void {
  // 页眉模式改 seg 分段(模式 + 条件字段容器);
  // 自定义控件块仅 custom 模式展开(.cond.show)
  headerModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.headerFooter.headerMode = input.value as AppSettings["headerFooter"]["headerMode"];
      // 自定义控件块(文字/logo/布局)仅 custom 模式可见
      syncHeaderCustomVisibility();
      persistHeaderFooter();
    });
  });

  headerTextInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.headerFooter.headerText = headerTextInput.value.trim();
    persistHeaderFooter();
  });

  headerLayoutInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.headerFooter.headerLayout = input.value as AppSettings["headerFooter"]["headerLayout"];
      persistHeaderFooter();
    });
  });

  footerEnabledInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.headerFooter.footerEnabled = footerEnabledInput.checked;
    persistHeaderFooter();
  });

  // logo 选择:main 打开文件对话框(限图片扩展名),返回绝对路径或 null(取消)
  headerLogoPickBtn.addEventListener("click", () => {
    void (async () => {
      try {
        const logoPath = await window.api.selectHeaderLogo();
        if (!logoPath) return; // 用户取消
        state.settings.headerFooter.headerLogoPath = logoPath;
        syncHeaderLogoDisplay(logoPath); // 动态节点单源(settings-panel)
        persistHeaderFooter();
      } catch (err) {
        setError(t("settings.selectDirFailed", { error: errorMessage(err) }));
      }
    })();
  });

  headerLogoClearBtn.addEventListener("click", () => {
    state.settings.headerFooter.headerLogoPath = "";
    syncHeaderLogoDisplay("");
    persistHeaderFooter();
  });

  // 文字水印:任一控件变更即时生效并持久化
  watermarkTextInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.watermark.text = watermarkTextInput.value;
    persistWatermark();
  });

  watermarkAngleInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const clamped = Math.min(360, Math.max(0, watermarkAngleInput.valueAsNumber));
    if (!Number.isFinite(clamped)) {
      watermarkAngleInput.value = String(state.settings.watermark.angle);
      return;
    }
    state.settings.watermark.angle = clamped;
    watermarkAngleInput.value = String(clamped);
    persistWatermark();
  });

  watermarkOpacityInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const clamped = Math.min(1, Math.max(0, watermarkOpacityInput.valueAsNumber));
    if (!Number.isFinite(clamped)) {
      watermarkOpacityInput.value = String(state.settings.watermark.opacity);
      return;
    }
    state.settings.watermark.opacity = clamped;
    watermarkOpacityInput.value = String(clamped);
    persistWatermark();
  });

  watermarkGrayInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.watermark.gray = watermarkGrayInput.checked;
    persistWatermark();
  });
}
