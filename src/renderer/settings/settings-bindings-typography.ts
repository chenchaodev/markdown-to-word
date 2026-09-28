/**
 * 排版组(Tab「排 版」)接线:纸张/方向/四边边距/中西文字体/正文字号(stepper)/
 * 行距(含滑杆回显)/标题字号与间距档位/首行缩进/对齐。
 *
 * 域内 change 监听由声明表统一接线(键路径、控件定位、读侧、整块写回与门控联动
 * 都在表里),本文件只留表接不了的三类:
 *  - 六处带钳制 / 校验 / 错误回显的写侧钩子(合法区间与提示文案是各控件自己的口径);
 *  - 正文字号 stepper 的 ± 按钮(它经 change 走既有校验/持久化链路);
 *  - 行距滑杆**拖动期**的实时回显(change 落定那一侧仍由表接线)。
 * 分组口径 = index.html 六组 Tab 的 data-group=typography;编排入口在 settings-bindings。
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM as MARGIN_MAX,
} from "../../core/settings/settings-defaults.js";
import { t, type I18nKey } from "../../core/i18n.js";
import { parseMarginValue, validateNumberRange } from "./settings-logic.js";
import {
  bodySizeDecBtn,
  bodySizeError,
  bodySizeIncBtn,
  bodySizePtInput,
  fontAsciiError,
  fontEastAsiaError,
  lineSpacingError,
  lineSpacingInput,
  lineSpacingValue,
  marginError,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { hideFieldError, showFieldError } from "../ui/dom-ops.js";
import {
  bindControlGroup,
  type WriteHooksOf,
  type WriteHook,
} from "./settings-controls-table.js";
import { controlDom, settingsWriteContext } from "./settings-panel.js";

/** 四条边(共用一条 marginError 提示行)。 */
type MarginKey = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";
/** 两个字体的空输入提示键(文案随语言变,故传键不传已求值的字符串)。 */
type FontEmptyKey = "settings.fontAsciiEmpty" | "settings.fontEastAsiaEmpty";

/** 边距输入:非法值回显当前设置,合法值钳制后写回;非法时字段内提示。 */
const marginHook =
  (key: MarginKey): WriteHook =>
  (ctx, control, write) => {
    const clamped = parseMarginValue(control.valueAsNumber);
    if (clamped === null) {
      control.setValue(String(ctx.settings().pageSetup[key])); // 空/非法输入:恢复为当前设置值
      showFieldError(marginError, t("settings.marginRange", { max: MARGIN_MAX }));
      return;
    }
    write(clamped);
    control.setValue(String(clamped)); // 回显钳制后的值,与主进程持久化结果一致
    hideFieldError(marginError);
  };

/** 字体输入:空输入回显当前设置并提示(整串空白同样算空)。 */
const fontHook =
  (key: "fontAscii" | "fontEastAsia", errorEl: HTMLElement, emptyKey: FontEmptyKey): WriteHook =>
  (ctx, control, write) => {
    const value = control.value.trim();
    if (!value) {
      control.setValue(ctx.settings().typography[key]); // 空输入:恢复为当前设置值
      showFieldError(errorEl, t(emptyKey as I18nKey));
      return;
    }
    write(value);
    hideFieldError(errorEl);
  };

/** 字号 / 行距输入:空、非数字或超出范围时回显当前设置值,并字段内提示。 */
const numberHook =
  (key: "bodySizePt" | "lineSpacing", min: number, max: number, errorEl: HTMLElement): WriteHook =>
  (ctx, control, write) => {
    const value = control.valueAsNumber;
    if (!validateNumberRange(value, min, max)) {
      control.setValue(String(ctx.settings().typography[key])); // 空/非法/超范围:恢复为当前设置值
      showFieldError(errorEl, t("settings.numberRange", { min, max }));
      return;
    }
    write(value);
    hideFieldError(errorEl);
  };

/** 本组声明了写侧钩子的条目(键集由表反推,多写/漏写即 tsc 报错)。 */
export const typographyWriteHooks: WriteHooksOf<"typography"> = {
  marginTop: marginHook("marginTop"),
  marginBottom: marginHook("marginBottom"),
  marginLeft: marginHook("marginLeft"),
  marginRight: marginHook("marginRight"),
  fontAscii: fontHook("fontAscii", fontAsciiError, "settings.fontAsciiEmpty"),
  fontEastAsia: fontHook("fontEastAsia", fontEastAsiaError, "settings.fontEastAsiaEmpty"),
  bodySizePt: numberHook("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX, bodySizeError),
  lineSpacing: numberHook("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX, lineSpacingError),
};

/** 排版组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindTypographyGroup(hooks: WriteHooksOf<"typography">): void {
  // 纸张/方向/标题档位/对齐等 seg 分段与各值控件的 change 统一由表接线
  bindControlGroup("typography", controlDom, settingsWriteContext, hooks);

  // 正文字号 stepper ± 按钮(±0.5,上下限钳制后经既有 change 链路
  // 校验/持久化;非法输入以当前设置值为基准,不放大脏值)
  const stepBodySize = (delta: number): void => {
    if (state.hydratingSettings) return;
    const base = Number.isFinite(bodySizePtInput.valueAsNumber)
      ? bodySizePtInput.valueAsNumber
      : state.settings.typography.bodySizePt;
    const next = Math.min(BODY_SIZE_MAX, Math.max(BODY_SIZE_MIN, base + delta));
    bodySizePtInput.value = String(next);
    bodySizePtInput.dispatchEvent(new Event("change"));
  };
  bodySizeDecBtn.addEventListener("click", () => stepBodySize(-0.5));
  bodySizeIncBtn.addEventListener("click", () => stepBodySize(0.5));

  // 行距 range 滑杆 mono 实时回显(input 拖动期跟随;
  // change 落定走上方的校验/持久化链路)
  lineSpacingInput.addEventListener("input", () => {
    lineSpacingValue.textContent = lineSpacingInput.value;
  });
}
