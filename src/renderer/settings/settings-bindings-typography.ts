/**
 * 排版组(Tab「排 版」)接线:纸张/方向/四边边距/中西文字体/正文字号(stepper)/
 * 行距(含滑杆回显)/标题字号与间距档位/首行缩进/对齐——变更钳制校验后
 * 即时写回并持久化;字号/行距/边距非法输入以当前设置值兜底并字段内提示。
 * 分组口径 = index.html 六组 Tab 的 data-group=typography;拆自
 * settings-bindings.ts(纯搬移零行为改动),编排入口在 settings-bindings。
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MARGIN_MAX_MM as MARGIN_MAX,
  type AppSettings,
  type PageSetup,
} from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
import { parseMarginValue, validateNumberRange } from "./settings-logic.js";
import {
  alignInputs,
  bodySizeDecBtn,
  bodySizeError,
  bodySizeIncBtn,
  bodySizePtInput,
  firstLineIndentInput,
  fontAsciiError,
  fontAsciiInput,
  fontEastAsiaError,
  fontEastAsiaInput,
  headingScaleInputs,
  headingSpacingInputs,
  lineSpacingError,
  lineSpacingInput,
  lineSpacingValue,
  marginError,
  marginInputs,
  orientationInputs,
  paperInputs,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { hideFieldError, showFieldError } from "../state/utils.js";
import { persistPageSetup, persistTypography } from "./settings-panel.js";

type Paper = PageSetup["paper"];
type Orientation = PageSetup["orientation"];

/** 边距输入:非法值回显当前设置,合法值钳制后写回;非法时字段内提示。 */
function handleMarginChange(key: keyof typeof marginInputs): void {
  if (state.hydratingSettings) return;
  const input = marginInputs[key];
  const clamped = parseMarginValue(input.valueAsNumber);
  if (clamped === null) {
    input.value = String(state.settings.pageSetup[key]); // 空/非法输入:恢复为当前设置值
    showFieldError(marginError, t("settings.marginRange", { max: MARGIN_MAX }));
    return;
  }
  state.settings.pageSetup[key] = clamped;
  input.value = String(clamped); // 回显钳制后的值,与主进程持久化结果一致
  hideFieldError(marginError);
  persistPageSetup();
}

/** 字号 / 行距输入:空、非数字或超出范围时回显当前设置值,并字段内提示。 */
function handleTypographyNumberChange(
  key: "bodySizePt" | "lineSpacing",
  min: number,
  max: number,
): void {
  if (state.hydratingSettings) return;
  const input = key === "bodySizePt" ? bodySizePtInput : lineSpacingInput;
  const errorEl = key === "bodySizePt" ? bodySizeError : lineSpacingError;
  const value = input.valueAsNumber;
  if (!validateNumberRange(value, min, max)) {
    input.value = String(state.settings.typography[key]); // 空/非法/超范围:恢复为当前设置值
    showFieldError(errorEl, t("settings.numberRange", { min, max }));
    return;
  }
  state.settings.typography[key] = value;
  hideFieldError(errorEl);
  persistTypography();
}

/** 排版组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindTypographyGroup(): void {
  // 纸张/方向改 seg 分段(radio 组;枚举 ≤5 → seg),组绑定模式与 alignInputs/themeInputs 一致。
  // paperInputs/orientationInputs 为全文档同名组查询——快速参数条的
  // 镜像分段自动纳入绑定与回填,此处零改动
  paperInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.pageSetup.paper = input.value as Paper;
      persistPageSetup();
    });
  });

  orientationInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.pageSetup.orientation = input.value as Orientation;
      persistPageSetup();
    });
  });

  (Object.keys(marginInputs) as (keyof typeof marginInputs)[]).forEach((key) => {
    marginInputs[key].addEventListener("change", () => handleMarginChange(key));
  });

  fontAsciiInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const value = fontAsciiInput.value.trim();
    if (!value) {
      fontAsciiInput.value = state.settings.typography.fontAscii; // 空输入:恢复为当前设置值
      showFieldError(fontAsciiError, t("settings.fontAsciiEmpty"));
      return;
    }
    state.settings.typography.fontAscii = value;
    hideFieldError(fontAsciiError);
    persistTypography();
  });

  fontEastAsiaInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    const value = fontEastAsiaInput.value.trim();
    if (!value) {
      fontEastAsiaInput.value = state.settings.typography.fontEastAsia; // 空输入:恢复为当前设置值
      showFieldError(fontEastAsiaError, t("settings.fontEastAsiaEmpty"));
      return;
    }
    state.settings.typography.fontEastAsia = value;
    hideFieldError(fontEastAsiaError);
    persistTypography();
  });

  bodySizePtInput.addEventListener("change", () =>
    handleTypographyNumberChange("bodySizePt", BODY_SIZE_MIN, BODY_SIZE_MAX),
  );

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

  lineSpacingInput.addEventListener("change", () =>
    handleTypographyNumberChange("lineSpacing", LINE_SPACING_MIN, LINE_SPACING_MAX),
  );

  // 行距 range 滑杆 mono 实时回显(input 拖动期跟随;
  // change 落定走上方既有校验/持久化链路)
  lineSpacingInput.addEventListener("input", () => {
    lineSpacingValue.textContent = lineSpacingInput.value;
  });

  // 标题排版粒度:标题字号/间距档位(seg 分段,三档;变更即时生效并持久化)
  headingScaleInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.headingScale = input.value as AppSettings["typography"]["headingScale"];
      persistTypography();
    });
  });

  headingSpacingInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.headingSpacing = input.value as AppSettings["typography"]["headingSpacing"];
      persistTypography();
    });
  });

  firstLineIndentInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.firstLineIndent = firstLineIndentInput.checked;
    persistTypography();
  });

  // 对齐方式由布尔 checkbox 升级为枚举 radio 组(left/justify),
  // 存储契约不变(typography.align);选中值即写入
  alignInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.typography.align = input.value as AppSettings["typography"]["align"];
      persistTypography();
    });
  });
}
