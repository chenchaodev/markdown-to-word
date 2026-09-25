/**
 * 自定义预设交互:另存为弹窗(显隐/焦点陷阱/错误提示)、保存/删除、预设 JSON
 * 导入导出;纯逻辑(预设映射/名校验/上限判断/名称解析)在 settings-logic.ts,
 * 本模块只保留 DOM 交互与持久化调用。拆自 settings-panel.ts(D2,纯搬移
 * 零行为改动)。依赖方向:本模块 → settings-panel(回填/写回/选项重建单源),
 * 不反向;事件绑定侧(settings-bindings-preset)与 renderer Esc 分支 import 本模块。
 */
import {
  TEMPLATE_PRESETS,
} from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
import {
  buildCustomPresetEntry,
  customPresetNameFromId,
  customPresetToTemplate,
  removeCustomPresetByName,
  validatePresetName,
} from "./settings-logic.js";
import {
  presetNameInput,
  presetSaveBtn,
  presetSaveDialog,
  presetSaveError,
  quickPresetSelect,
  templatePresetSelect,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError, setStatus, trapFocus } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import {
  applySettingsToControls,
  persistSettings,
  rebuildPresetOptions,
} from "./settings-panel.js";

/* 另存为预设弹窗焦点陷阱句柄:打开时启用,关闭时解除 */
let presetSaveTrap: (() => void) | null = null;

/** 另存为预设弹窗:打开(清空输入与错误,焦点进输入框)。 */
export function openPresetSaveDialog(): void {
  presetNameInput.value = "";
  presetSaveError.classList.add("hidden");
  presetSaveError.textContent = "";
  presetSaveDialog.classList.remove("hidden");
  presetNameInput.focus();
  // Tab 循环不逃逸到背景页。二次调用防御——先解除
  // 旧陷阱再启用新陷阱,避免重复 open 时旧 keydown 监听句柄被覆盖而泄漏。
  presetSaveTrap?.();
  presetSaveTrap = trapFocus(presetSaveDialog);
}

/** 关闭另存为预设弹窗(导出:renderer Esc 分支与弹窗内按钮共用,统一解除焦点陷阱)。 */
export function closePresetSaveDialog(): void {
  presetSaveTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  presetSaveTrap = null;
  presetSaveDialog.classList.add("hidden");
  presetSaveBtn.focus(); // 焦点还给触发按钮,便于键盘继续操作
}

function showPresetSaveError(message: string): void {
  presetSaveError.textContent = message;
  presetSaveError.classList.remove("hidden");
}

/** 保存当前排版+页面设置为自定义预设(名称非空、同名拒绝;成功后下拉选中新预设)。 */
export async function saveCustomPreset(): Promise<void> {
  const name = presetNameInput.value.trim();
  // 达上限不再静默截断,弹窗内明确提示先删除(校验逻辑在 settings-logic)
  const error = validatePresetName(name, state.settings.customPresets);
  if (error) {
    showPresetSaveError(error);
    return;
  }
  const entry = buildCustomPresetEntry(name, state.settings);
  const next = [...state.settings.customPresets, entry];
  try {
    const saved = await window.api.settingsSet({ customPresets: next });
    state.settings.customPresets = saved.customPresets;
    closePresetSaveDialog();
    rebuildPresetOptions();
    // 显式选中新预设(值=当前设置,resolvePresetSelection 保持选中,不被硬编码项弹回)
    templatePresetSelect.value = customPresetToTemplate(entry).id;
    quickPresetSelect.value = templatePresetSelect.value; // 镜像同步
    applySettingsToControls(); // 当前设置即新预设 → 自动选中并显示其 hint
  } catch {
    showPresetSaveError(t("preset.saveFailed"));
  }
}

/** 删除当前选中的自定义预设;删除后回退「默认」预设(整体套用并持久化)。 */
export function deleteCustomPreset(): void {
  const name = customPresetNameFromId(templatePresetSelect.value);
  if (!name) return;
  const next = removeCustomPresetByName(state.settings.customPresets, name);
  void window.api
    .settingsSet({ customPresets: next })
    .then((saved) => {
      state.settings.customPresets = saved.customPresets;
      rebuildPresetOptions();
      // 回退「默认」:与下拉选中 default 行为一致(整体套用 + 回填 + 持久化)
      const preset = TEMPLATE_PRESETS.find((p) => p.id === "default");
      if (!preset) return;
      state.settings.typography = { ...preset.typography };
      state.settings.pageSetup = { ...preset.pageSetup };
      state.hydratingSettings = true;
      applySettingsToControls();
      state.hydratingSettings = false;
      persistSettings({
        typography: { ...state.settings.typography },
        pageSetup: { ...state.settings.pageSetup },
      });
    })
    .catch(() => setError(t("preset.deleteFailed")));
}

/** 导入自定义预设 JSON:main 打开对话框 → 读文件 → 与现有合并(同名覆盖,上限 10)→ 持久化。
 *  成功后同步最新列表并重刷下拉;取消无动作;失败状态区提示。 */
export async function importCustomPresets(): Promise<void> {
  try {
    const r = await window.api.importPresets();
    if (!r.ok) {
      setError(t("preset.importFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    // 合并结果已在 main 持久化,这里只同步内存列表供下拉重刷(失败静默,反馈不受影响)
    try {
      const fresh = await window.api.settingsGet();
      state.settings.customPresets = fresh.customPresets;
    } catch {
      /* 忽略:列表刷新失败时下拉保持旧数据 */
    }
    rebuildPresetOptions();
    applySettingsToControls(); // 重刷后按 matchesPreset 重算 select/hint,不强制切换选中项
    setStatus(
      r.overridden > 0
        ? t("preset.importedOverridden", {
            imported: r.imported,
            overridden: r.overridden,
          })
        : t("preset.imported", { count: r.imported }),
    );
  } catch (err) {
    const message = errorMessage(err);
    setError(t("preset.importFailed", { error: message }));
  }
}

/** 导出全部自定义预设为 JSON 文件;成功时反馈数量,取消无动作。 */
export async function exportCustomPresets(): Promise<void> {
  try {
    const r = await window.api.exportPresets();
    if (!r.ok) {
      setError(t("preset.exportFailed", { error: r.error }));
      return;
    }
    if (r.canceled) return; // 用户取消:无动作
    setStatus(t("preset.exported", { count: r.count }));
  } catch (err) {
    const message = errorMessage(err);
    setError(t("preset.exportFailed", { error: message }));
  }
}
