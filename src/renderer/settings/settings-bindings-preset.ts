/**
 * 预设组(Tab「预 设」)接线:模板预设 select(抽屉与快速参数条两处镜像共用
 * 套用路径)/另存为预设弹窗/删除自定义预设/预设 JSON 导入导出/Word 模板导入。
 * 套用逻辑 applyTemplatePreset 为跨模块契约(成书向导亦 import 本模块调用),
 * 随本组落位——预设即本组的核心写入路径。
 * 分组口径 = index.html 六组 Tab 的 data-group=preset;拆自
 * settings-bindings.ts(纯搬移零行为改动),编排入口在 settings-bindings。
 */
import type { TemplatePreset } from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
import { allPresets, presetDisplayName } from "./settings-logic.js";
import {
  docxTemplateImportBtn,
  presetDeleteBtn,
  presetExportBtn,
  presetImportBtn,
  presetNameInput,
  presetSaveBtn,
  presetSaveCancel,
  presetSaveDialog,
  presetSaveOk,
  quickPresetSelect,
  templatePresetSelect,
} from "../dom/refs.js";
import { state } from "../state/state.js";
// 预设切换即时反馈(toast 单实例,ui/toast)
import { showToast } from "../ui/toast.js";
import {
  applySettingsToControls,
  importDocxTemplate,
  persistSettings,
} from "./settings-panel.js";
import {
  closePresetSaveDialog,
  deleteCustomPreset,
  exportCustomPresets,
  importCustomPresets,
  openPresetSaveDialog,
  saveCustomPreset,
} from "./settings-preset-actions.js";

/**
 * 预设切换 toast 的被覆盖组标签(与模板预设应用逻辑同步):
 * 预设整体写入 pageSetup(「页面」组)与 typography——其中字体/字号/行距/缩进/
 * 对齐/标题档位属「文字」组,headingNumbering/captionNumbering 属「编号与目录」组。
 * TemplatePreset 契约两组均为必填,正常全部列出;字段级判断仅为契约演进留余地。
 */
function presetCoveredGroupLabels(preset: TemplatePreset): string {
  const groups: string[] = [];
  // 重组后预设覆盖「排版」(页面 + 文字合并)与「编号与目录」两组
  if (preset.pageSetup || preset.typography) {
    groups.push(t("settings.groupTypography"));
  }
  if (preset.typography) {
    const typo = preset.typography;
    if (
      typo.headingNumbering !== undefined ||
      typo.captionNumbering !== undefined
    ) {
      groups.push(t("settings.groupNumbering"));
    }
  }
  // 完整交付链:页眉页脚 / 水印 / 编号(breakBeforeH1 亦属编号组)
  if (preset.headerFooter) {
    groups.push(t("settings.groupHeaderFooter"));
  }
  if (preset.watermark) {
    groups.push(t("settings.groupWatermark"));
  }
  if (preset.equationNumbering !== undefined || preset.breakBeforeH1 !== undefined) {
    groups.push(t("settings.groupNumbering"));
  }
  return groups.join(" · ");
}

/**
 * 套用模板预设(抽屉 select 与快速参数条 select 共用):
 * 整体套用排版与页面设置,hydration 保护下统一回填所有相关控件并持久化;
 * 回填同时按匹配结果同步两侧 select 与 hint(当前即所选预设)。
 */
export function applyTemplatePreset(presetId: string): void {
  if (state.hydratingSettings) return;
  const preset = allPresets(state.settings.customPresets).find(
    (p) => p.id === presetId,
  );
  if (!preset) return;
  state.settings.typography = { ...preset.typography };
  state.settings.pageSetup = { ...preset.pageSetup };
  if (preset.headerFooter) state.settings.headerFooter = { ...preset.headerFooter };
  if (preset.watermark) state.settings.watermark = { ...preset.watermark };
  if (preset.equationNumbering !== undefined) {
    state.settings.equationNumbering = preset.equationNumbering;
  }
  if (preset.breakBeforeH1 !== undefined) {
    state.settings.breakBeforeH1 = preset.breakBeforeH1;
  }
  state.hydratingSettings = true;
  applySettingsToControls();
  state.hydratingSettings = false;
  persistSettings({
    typography: { ...state.settings.typography },
    pageSetup: { ...state.settings.pageSetup },
    ...(preset.headerFooter ? { headerFooter: { ...state.settings.headerFooter } } : {}),
    ...(preset.watermark ? { watermark: { ...state.settings.watermark } } : {}),
    ...(preset.equationNumbering !== undefined
      ? { equationNumbering: state.settings.equationNumbering }
      : {}),
    ...(preset.breakBeforeH1 !== undefined
      ? { breakBeforeH1: state.settings.breakBeforeH1 }
      : {}),
  });
  // 预设切换即时反馈——toast 列出被覆盖的设置组
  // 预设名经 presetDisplayName 取当前语言文案(内置走字典/自定义走用户命名),
  // 不得直接用 preset.name ——那是中文原文,en/ja 下会与外层英文/日文句子混排。
  showToast(
    t("toast.presetSwitched", {
      name: presetDisplayName(preset),
      groups: presetCoveredGroupLabels(preset),
    }),
  );
}

/** 预设组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindPresetGroup(): void {
  // 模板预设:整体套用排版与页面设置(抽屉与快速参数条两处 select
  // 共用 applyTemplatePreset,硬编码 + 自定义预设统一走此路径)
  templatePresetSelect.addEventListener("change", () => {
    applyTemplatePreset(templatePresetSelect.value);
  });

  quickPresetSelect.addEventListener("change", () => {
    applyTemplatePreset(quickPresetSelect.value);
  });

  // 另存为预设(弹窗输入名称 → 保存当前排版+页面设置)
  presetSaveBtn.addEventListener("click", openPresetSaveDialog);
  presetSaveCancel.addEventListener("click", closePresetSaveDialog);
  presetSaveOk.addEventListener("click", () => void saveCustomPreset());
  presetNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCustomPreset();
    }
  });
  presetSaveDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === presetSaveDialog) closePresetSaveDialog();
  });
  // 仅自定义预设可删;删除后回退「默认」
  presetDeleteBtn.addEventListener("click", deleteCustomPreset);
  // 预设 JSON 导入 / 导出(IIFE + void,规避 no-misused-promises)
  presetImportBtn.addEventListener("click", () => void importCustomPresets());
  presetExportBtn.addEventListener("click", () => void exportCustomPresets());
  // Word 模板导入(IIFE + void,规避 no-misused-promises)
  docxTemplateImportBtn.addEventListener("click", () => void importDocxTemplate());
}
