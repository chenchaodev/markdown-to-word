/**
 * 页眉页脚与水印组(Tab「页眉页脚与水印」)接线:页眉模式(自定义字段块随之
 * 显隐)/页眉文字/页脚开关/logo 选择与清除/水印文字/角度/不透明度/浅灰。
 *
 * 域内 change 监听由声明表统一接线;本文件只留表接不了的两类:
 *  - logo 的「选择图片…」/「清除」两个**动作按钮**(走 main 的文件对话框,
 *    其可写控件不是文本输入,故是 chip 而非值控件);
 *  - 水印角度与不透明度的钳制钩子(上下限是该控件自己的口径,不合进通用路径)。
 * 分组口径 = index.html 六组 Tab 的 data-group=headerwatermark。
 */
import { t } from "../../core/i18n/index.js";
import { headerLogoClearBtn, headerLogoPickBtn } from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError } from "../ui/dom-ops.js";
import { errorMessage } from "../state/pure.js";
import {
  bindControlGroup,
  type WriteHooksOf,
  type WriteHook,
} from "./settings-controls-table.js";
import { controlDom, persistSettings, settingsWriteContext, syncHeaderLogoDisplay } from "./settings-panel.js";

/** 水印角度:0–360 度;非数值输入回显当前设置值(钳制口径与边距不同,故各写各的)。 */
const watermarkAngleHook: WriteHook = (ctx, control, write) => {
  const clamped = Math.min(360, Math.max(0, control.valueAsNumber));
  if (!Number.isFinite(clamped)) {
    control.setValue(String(ctx.settings().watermark.angle));
    return;
  }
  write(clamped);
  control.setValue(String(clamped));
};

/** 水印不透明度:0–1;非数值输入回显当前设置值。 */
const watermarkOpacityHook: WriteHook = (ctx, control, write) => {
  const clamped = Math.min(1, Math.max(0, control.valueAsNumber));
  if (!Number.isFinite(clamped)) {
    control.setValue(String(ctx.settings().watermark.opacity));
    return;
  }
  write(clamped);
  control.setValue(String(clamped));
};

/** 本组声明了写侧钩子的条目(键集由表反推,多写/漏写即 tsc 报错)。 */
export const headerWatermarkWriteHooks: WriteHooksOf<"headerwatermark"> = {
  watermarkAngle: watermarkAngleHook,
  watermarkOpacity: watermarkOpacityHook,
};

/** 页眉页脚与水印组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindHeaderWatermarkGroup(hooks: WriteHooksOf<"headerwatermark">): void {
  bindControlGroup("headerwatermark", controlDom, settingsWriteContext, hooks);

  // logo 选择:main 打开文件对话框(限图片扩展名),返回绝对路径或 null(取消)
  headerLogoPickBtn.addEventListener("click", () => {
    void (async () => {
      try {
        const logoPath = await window.api.selectHeaderLogo();
        if (!logoPath) return; // 用户取消
        state.settings.headerFooter.headerLogoPath = logoPath;
        syncHeaderLogoDisplay(logoPath); // 动态节点单源(settings-panel)
        persistSettings({ headerFooter: { ...state.settings.headerFooter } });
      } catch (err) {
        setError(t("settings.selectDirFailed", { error: errorMessage(err) }));
      }
    })();
  });

  headerLogoClearBtn.addEventListener("click", () => {
    state.settings.headerFooter.headerLogoPath = "";
    syncHeaderLogoDisplay("");
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  });
}
