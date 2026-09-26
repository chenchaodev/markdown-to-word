/**
 * 成书向导字段校验与共用零件(拆分自 book-wizard.ts,纯搬移零行为改动)
 * 「校验」块:边距 / 字号 / 行距 / 字体的钳制校验绑定(非法回显当前设置值 +
 * 字段内 i18n 提示),复用 settings-logic 纯函数与既有 settings.* 提示键,
 * 实时写 state.settings + persistSettings(与设置抽屉同源,关向导不丢设置);
 * 控件形态沿用既有令牌类(.mm-grid / .stepper / .segmented / .switch-input / .path-chip)。
 * 另含步骤渲染与外壳共用的零件:DOM 构造 h、开关行 swRow、目录/Logo 选择、
 * radio 构造与取值回填小工具、步骤用设置类型别名。
 * 依赖方向:本模块 → core / state / settings-panel / settings-logic(单向),
 * 不反向引用步骤渲染与外壳(两岛均单向 import 本模块)。
 */
import { t } from "../../core/i18n.js";
import { MARGIN_MAX_MM, type AppSettings } from "../../core/settings/settings-defaults.js";
import { state } from "../state/state.js";
import { hideFieldError, setError, showFieldError } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import {
  headerLogoDisplayName,
  outputDirDisplayText,
  parseMarginValue,
  validateNumberRange,
  type MarginField,
} from "../settings/settings-logic.js";
import { persistSettings } from "../settings/settings-panel.js";

/* ---------- 极简 DOM 构造助手(步骤渲染与外壳共用,避免散落 createElement) ---------- */
type Props = Record<string, unknown>;
export function h(tag: string, props: Props = {}, children: (Node | string)[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") el.className = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v as Record<string, string>);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.append(c);
  return el;
}

/**
 * 向导内 id 发放器(每次打开向导重建 DOM,id 需在同一文档内唯一且可被
 * label/aria-describedby 反查):同一 key 在一次向导会话内返回同一个 id,
 * 重建时由新的控件树重新登记(旧节点已随外壳摘除)。
 */
let wizardIdSeq = 0;
export function wizardId(prefix: string): string {
  wizardIdSeq += 1;
  return `wiz-${prefix}-${wizardIdSeq}`;
}

/**
 * 带程序关联的字段行:label(for → control.id)+ 可选说明行 / 错误节点
 * (aria-describedby)。读屏用户聚焦控件时能听到「字段名 + 说明(+ 错误)」。
 * 结构沿用既有 .wz-field > .wz-label + 控件 + .wz-hint(说明在控件之后,与向导
 * 其余提示行同序),不新增控件形态。错误节点须带 role=alert(见 fieldErrorNode)。
 */
export function fieldRow(
  labelKey: string,
  control: HTMLElement,
  opts: { hintKey?: string; hintText?: string; errorEl?: HTMLElement } = {},
): HTMLElement {
  const controlId = control.id.length > 0 ? control.id : wizardId("field");
  control.id = controlId;
  const hintText = opts.hintText ?? (opts.hintKey ? t(opts.hintKey as never) : "");
  const hintId = hintText.length > 0 ? wizardId("hint") : "";
  const errorId = opts.errorEl?.id ?? "";
  const described = [hintId, errorId].filter((token) => token.length > 0);
  control.setAttribute("aria-invalid", "false");
  if (described.length > 0) control.setAttribute("aria-describedby", described.join(" "));
  const children: HTMLElement[] = [
    h("label", { class: "wz-label", for: controlId, dataset: { i18n: labelKey }, text: t(labelKey as never) }),
    control,
  ];
  if (hintId.length > 0) {
    children.push(
      h("span", {
        class: "wz-hint",
        id: hintId,
        dataset: opts.hintKey ? { i18n: opts.hintKey } : {},
        text: hintText,
      }),
    );
  }
  if (opts.errorEl) children.push(opts.errorEl);
  return h("div", { class: "wz-field" }, children);
}

/**
 * 成组字段行(单选组 / 下拉 / 文件选择这类"控件 + 说明块"的整组形态):
 * 可见标签用 span(id 供反查)而不是 label[for] —— 整组不是单一表单控件,
 * for 指向容器没有意义;改为 role=group + aria-labelledby,并把同一 id 挂到
 * 真实控件上(读屏进组与聚焦控件时都能听到组名)。
 */
export function groupRow(
  labelKey: string,
  control: HTMLElement,
  labelTarget?: HTMLElement,
): HTMLElement {
  const controlId = control.id.length > 0 ? control.id : wizardId("group");
  control.id = controlId;
  const labelId = `${controlId}-label`;
  (labelTarget ?? control).setAttribute("aria-labelledby", labelId);
  return h("div", { class: "wz-field", role: "group", "aria-labelledby": labelId }, [
    h("span", { class: "wz-label", id: labelId, dataset: { i18n: labelKey }, text: t(labelKey as never) }),
    control,
  ]);
}

/* ---------- 向导内设置绑定助手 ----------
 * 复用 settings-logic 的钳制/校验纯函数与既有 i18n 提示键,实时写
 * state.settings + autosave(与设置抽屉同源,关向导不丢设置)。
 * 错误一律「就地可见」:错误节点带 role=alert,并把控件传入 show/hideFieldError,
 * 由其维护 aria-invalid / aria-describedby。 */

/** 错误节点(带 role=alert 供读屏即时播报;id 供控件 aria-describedby 反查)。 */
export function fieldErrorNode(): HTMLElement {
  return h("p", { class: "field-error hidden", id: wizardId("err"), role: "alert" });
}

/** 边距输入:复用 parseMarginValue 钳制 + settings.marginRange 提示,实时写 pageSetup。 */
export function bindMarginInput(key: MarginField, input: HTMLInputElement, errorEl: HTMLElement): void {
  input.addEventListener("change", () => {
    const clamped = parseMarginValue(input.valueAsNumber);
    if (clamped === null) {
      input.value = String(state.settings.pageSetup[key]);
      showFieldError(errorEl, t("settings.marginRange", { max: MARGIN_MAX_MM }), input);
      return;
    }
    state.settings.pageSetup[key] = clamped;
    input.value = String(clamped);
    hideFieldError(errorEl, input);
    persistSettings({ pageSetup: { ...state.settings.pageSetup } });
  });
}

/** 字号/行距输入:复用 validateNumberRange + settings.numberRange 提示,实时写 typography。 */
export function bindTypographyNumber(
  key: "bodySizePt" | "lineSpacing",
  input: HTMLInputElement,
  errorEl: HTMLElement,
  min: number,
  max: number,
): void {
  input.addEventListener("change", () => {
    const value = input.valueAsNumber;
    if (!validateNumberRange(value, min, max)) {
      input.value = String(state.settings.typography[key]);
      showFieldError(errorEl, t("settings.numberRange", { min, max }), input);
      return;
    }
    state.settings.typography[key] = value;
    hideFieldError(errorEl, input);
    persistSettings({ typography: { ...state.settings.typography } });
  });
}

/** 字体 combo 输入:空值恢复并提示,实时写 typography。 */
export function bindFontInput(
  key: "fontAscii" | "fontEastAsia",
  input: HTMLInputElement,
  errorEl: HTMLElement,
  emptyKey: string,
): void {
  input.addEventListener("change", () => {
    const value = input.value.trim();
    if (!value) {
      input.value = state.settings.typography[key];
      showFieldError(errorEl, t(emptyKey as never), input);
      return;
    }
    state.settings.typography[key] = value;
    hideFieldError(errorEl, input);
    persistSettings({ typography: { ...state.settings.typography } });
  });
}

/** 标题档位 seg:实时写 typography(headingScale / headingSpacing)。 */
export function bindHeadingTier(name: string, value: string): void {
  if (name === "headingScale") {
    state.settings.typography.headingScale = value as AppSettings["typography"]["headingScale"];
  } else {
    state.settings.typography.headingSpacing = value as AppSettings["typography"]["headingSpacing"];
  }
  persistSettings({ typography: { ...state.settings.typography } });
}

/**
 * 开关行(13px 主标签 + 11.5px 灰色说明 + switch),复用 .sw-row 形态。
 * 无障碍:标签与说明都是 span(非 label 元素),故以 aria-labelledby /
 * aria-describedby 显式关联到 switch —— 否则读屏只会报「复选框」。
 */
export function swRow(
  labelKey: string,
  subKey: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const labelId = wizardId("swlabel");
  const subId = wizardId("swdesc");
  const input = h("input", {
    type: "checkbox",
    class: "switch-input",
    "aria-labelledby": labelId,
    "aria-describedby": subId,
    ...(checked ? { checked: true } : {}),
  }) as HTMLInputElement;
  input.addEventListener("change", () => onChange(input.checked));
  return h("div", { class: "sw-row" }, [
    h("span", {}, [
      h("span", { class: "row-l", id: labelId, dataset: { i18n: labelKey }, text: t(labelKey as never) }),
      h("span", { class: "row-sub", id: subId, dataset: { i18n: subKey }, text: t(subKey as never) }),
    ]),
    input,
  ]);
}

/** 输出目录选择:复用抽屉同款逻辑(selectDir → 写 state.settings + 更新 chip + 持久化)。 */
export async function pickOutputDir(chip: HTMLElement): Promise<void> {
  try {
    const dir = await window.api.selectDir();
    if (!dir) return; // 用户取消
    state.settings.outputDir = dir;
    const text = outputDirDisplayText(dir);
    chip.textContent = text;
    chip.title = text;
    persistSettings({ outputDir: dir });
  } catch (err) {
    setError(t("settings.selectDirFailed", { error: errorMessage(err) }));
  }
}

/** 页眉 Logo 选择:复用抽屉同款逻辑(selectHeaderLogo → 写 headerFooter + 更新状态 + 持久化)。 */
export async function pickHeaderLogo(statusEl: HTMLElement, clearBtn: HTMLButtonElement): Promise<void> {
  try {
    const logoPath = await window.api.selectHeaderLogo();
    if (!logoPath) return; // 用户取消
    state.settings.headerFooter.headerLogoPath = logoPath;
    const name = headerLogoDisplayName(logoPath);
    statusEl.textContent = name;
    statusEl.title = name;
    clearBtn.classList.remove("hidden");
    persistSettings({ headerFooter: { ...state.settings.headerFooter } });
  } catch (err) {
    setError(t("settings.selectDirFailed", { error: errorMessage(err) }));
  }
}

/* ---------- 小工具:radio / 取值 / 回填 ---------- */
/**
 * 命名 radio 组:组名一律由外层 groupRow 以 aria-labelledby 指向可见标签提供
 * (名字取自可见文案,且随语言切换由 applyStaticTexts 一起刷新);
 * 单项由 label 包裹天然可读。
 */
export function radioGroup(children: HTMLElement[]): HTMLElement {
  return h("span", { class: "segmented seg-sm", role: "radiogroup" }, children);
}

export function radio(name: string, value: string, label: string, checked: boolean): HTMLElement {
  const input = h("input", { type: "radio", name, value, ...(checked ? { checked: true } : {}) });
  return h("label", { class: "segment" }, [input, h("span", { text: label })]);
}
export function checkedValue(group: HTMLElement): string {
  const inputs = group.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  return Array.from(inputs).find((i) => i.checked)?.value ?? "";
}
export function setChecked(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((i) => {
    i.checked = i.value === value;
  });
}

/* 设置类型别名(避免重复 import 长类型链) */
export type AppHeaderMode = "default" | "custom" | "none";
export type AppHeaderLayout = "center" | "leftRight";
export type AppTocMode = "static" | "field";
