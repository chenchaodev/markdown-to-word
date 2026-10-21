/**
 * 排版组(Tab「排 版」)接线:纸张/方向/四边边距/中西文字体/正文字号(stepper +
 * 中文字号号数制下拉)/行距(含滑杆回显)/标题字号与间距档位/首行缩进/对齐。
 *
 * 域内 change 监听由声明表统一接线(键路径、控件定位、读侧、整块写回与门控联动
 * 都在表里),本文件只留表接不了的四类:
 *  - 六处带钳制 / 校验 / 错误回显的写侧钩子(合法区间与提示文案是各控件自己的口径);
 *  - 正文字号 stepper 的 ± 按钮(它经 change 走既有校验/持久化链路);
 *  - 中文字号号数制下拉(派生控件:表里只有它的定位与检索标签,写侧与回显在此手写);
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
import { CJK_FONT_SIZES, cjkFontSizePtOfId } from "../../core/settings/typography.js";
import { t, type I18nKey } from "../../core/i18n/index.js";
import { parseMarginValue, validateNumberRange } from "./settings-logic.js";
import {
  bodySizeDecBtn,
  bodySizeError,
  bodySizeIncBtn,
  bodySizePtInput,
  cjkFontSizeSelect,
  fontAsciiError,
  fontEastAsiaError,
  lineSpacingError,
  lineSpacingInput,
  lineSpacingValue,
  marginError,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { hideFieldError, showFieldError } from "../dom/dom-ops.js";
import {
  bindControlGroup,
  type WriteHooksOf,
  type WriteHook,
} from "./settings-controls-table.js";
import {
  controlDom,
  CUSTOM_FONT_SIZE_ID,
  settingsWriteContext,
  syncCjkFontSizeSelection,
} from "./settings-panel.js";

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

/** 正文字号 stepper 的写侧钩子:区间校验(沿用通用 numberHook)+ 落值后立刻回显号数制档位。 */
const bodySizeNumberHook = numberHook("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX, bodySizeError);

/**
 * 正文字号 stepper 的写侧钩子:校验与落值沿用通用 numberHook,落定后**当场**回显
 * 号数制下拉(不等落盘往返 —— 那是异步 IPC,视觉上会滞后一帧,而档位切换是用户
 * 盯着看的动作)。回显只读设置、只写下拉,不产生 change,故不成回环。
 */
const bodySizeHook: WriteHook = (ctx, control, write) => {
  bodySizeNumberHook(ctx, control, write);
  syncCjkFontSizeSelection();
};

/**
 * 生成中文字号下拉的选项:号数制 9 档 + 「自定义」状态档。
 *
 * 档位序与磅值取自 core 的 CJK_FONT_SIZES(单源,本文件不另抄一份档位表);
 * 档位文案经字典(键 = typography.size.<档位 id>,键后缀即 core 表里的 id)。
 * 「自定义」档标 disabled:它是「当前磅值不在号数制表内」的**状态**而非可选目标 ——
 * 用户挑不出一个「自定义」来(可挑的只有 9 个号数制档),要自定义磅值走 stepper。
 *
 * ⚠ 耦合一处:core 表新增档位时,字典须同步补 `typography.size.<新 id>` 键 ——
 * 键缺了不会报错,只会让该档文案回退成裸键(三份字典都缺时)。
 */
function buildCjkFontSizeOptions(): void {
  cjkFontSizeSelect.replaceChildren();
  for (const entry of CJK_FONT_SIZES) {
    const key = `typography.size.${entry.id}` as I18nKey;
    const option = document.createElement("option");
    option.value = entry.id;
    option.setAttribute("data-i18n", key);
    option.textContent = t(key);
    cjkFontSizeSelect.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM_FONT_SIZE_ID;
  custom.disabled = true;
  custom.setAttribute("data-i18n", "typography.size.custom");
  custom.textContent = t("typography.size.custom");
  cjkFontSizeSelect.appendChild(custom);
}

/** 本组声明了写侧钩子的条目(键集由表反推,多写/漏写即 tsc 报错)。 */
export const typographyWriteHooks: WriteHooksOf<"typography"> = {
  marginTop: marginHook("marginTop"),
  marginBottom: marginHook("marginBottom"),
  marginLeft: marginHook("marginLeft"),
  marginRight: marginHook("marginRight"),
  fontAscii: fontHook("fontAscii", fontAsciiError, "settings.fontAsciiEmpty"),
  fontEastAsia: fontHook("fontEastAsia", fontEastAsiaError, "settings.fontEastAsiaEmpty"),
  bodySizePt: bodySizeHook,
  lineSpacing: numberHook("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX, lineSpacingError),
};

/** 排版组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindTypographyGroup(hooks: WriteHooksOf<"typography">): void {
  // 纸张/方向/标题档位/对齐等 seg 分段与各值控件的 change 统一由表接线
  bindControlGroup("typography", controlDom, settingsWriteContext, hooks);

  // 中文字号下拉的选项:先就位再回填(回填要按 option value 选档)
  buildCjkFontSizeOptions();

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

  // 中文字号下拉:选中即写 —— 把该档磅值写进正文字号 stepper 后**派发 change**,
  // 走 stepper 既有的校验/持久化链路(不另造写回通道;真值仍是 typography.bodySizePt,
  // 本控件不新增持久化键)。「自定义」档不是可选目标:按当前磅值回显,不改设置。
  cjkFontSizeSelect.addEventListener("change", () => {
    const pt = cjkFontSizePtOfId(cjkFontSizeSelect.value);
    if (pt === null) {
      syncCjkFontSizeSelection();
      return;
    }
    bodySizePtInput.value = String(pt);
    bodySizePtInput.dispatchEvent(new Event("change"));
  });

  // 行距 range 滑杆 mono 实时回显(input 拖动期跟随;
  // change 落定走上方的校验/持久化链路)
  lineSpacingInput.addEventListener("input", () => {
    lineSpacingValue.textContent = lineSpacingInput.value;
  });
}
