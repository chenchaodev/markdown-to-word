/**
 * 转换组(Tab「转 换」)接线:输出格式(主窗分段,语义属本组的快速参数条镜像)/
 * 转换后行为/AI 清理/Obsidian 兼容与附件目录/PDF 自定义 CSS 文本域与导入清除/
 * 输出目录选择与复位(抽屉与快速参数条两处入口共用同一写入路径)。
 * 分组口径 = index.html 六组 Tab 的 data-group=convert;拆自
 * settings-bindings.ts(D2,纯搬移零行为改动),编排入口在 settings-bindings。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import { t } from "../../core/i18n.js";
import { outputDirDisplayText } from "./settings-logic.js";
import {
  afterConvertInputs,
  aiCleanupInput,
  formatInputs,
  obsidianAttachmentFolderInput,
  obsidianCompatInput,
  outputDirPick,
  outputDirReset,
  outputDirValue,
  pdfCssClearBtn,
  pdfCssImportBtn,
  pdfCssStatus,
  pdfCssTextInput,
  quickOutputDirChip,
  quickOutputPickBtn,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError } from "../state/utils.js";
import { errorMessage } from "../state/pure.js";
import { clearPdfCss, importPdfCss, persistSettings } from "./settings-panel.js";

type AfterConvert = AppSettings["afterConvert"];

/** 输出目录显示文本双写:抽屉 chip 与快速参数条 chip 同值同 title。 */
function setOutputDirDisplay(dir: string): void {
  const text = outputDirDisplayText(dir);
  outputDirValue.textContent = text;
  outputDirValue.title = text;
  quickOutputDirChip.textContent = text;
  quickOutputDirChip.title = text;
}

/** 打开目录选择对话框(抽屉「更改…」与快速参数条「更改…」共用);取消无动作。 */
async function pickOutputDir(): Promise<void> {
  try {
    const dir = await window.api.selectDir();
    if (!dir) return; // 用户取消
    state.settings.outputDir = dir;
    setOutputDirDisplay(dir);
    persistSettings({ outputDir: dir });
  } catch (err) {
    const message = errorMessage(err);
    setError(t("settings.selectDirFailed", { error: message }));
  }
}

/** 转换组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindConvertGroup(): void {
  // 格式选择:记录当前选中格式(转换时使用),并持久化到设置
  formatInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.selectedFormat = input.value as "docx" | "pdf";
      state.settings.format = state.selectedFormat;
      persistSettings({ format: state.selectedFormat });
    });
  });

  aiCleanupInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.aiCleanup = aiCleanupInput.checked;
    persistSettings({ aiCleanup: state.settings.aiCleanup });
  });
  obsidianCompatInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.obsidianCompat = obsidianCompatInput.checked;
    persistSettings({ obsidianCompat: state.settings.obsidianCompat });
  });
  obsidianAttachmentFolderInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.obsidianAttachmentFolder = obsidianAttachmentFolderInput.value.trim();
    persistSettings({ obsidianAttachmentFolder: state.settings.obsidianAttachmentFolder });
  });

  afterConvertInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked || state.hydratingSettings) return;
      state.settings.afterConvert = input.value as AfterConvert;
      persistSettings({ afterConvert: state.settings.afterConvert });
    });
  });

  // PDF 样式 CSS 导入 / 清除(IIFE + void,规避 no-misused-promises)
  pdfCssImportBtn.addEventListener("click", () => void importPdfCss());
  pdfCssClearBtn.addEventListener("click", clearPdfCss);

  // PDF 自定义 CSS 文本域(与导入/清除同写
  // settings.pdfCss,状态行与清除按钮可见性同步回填逻辑)
  pdfCssTextInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.pdfCss = pdfCssTextInput.value;
    persistSettings({ pdfCss: pdfCssTextInput.value });
    pdfCssStatus.textContent = pdfCssTextInput.value
      ? t("settings.pdfCssImported")
      : t("settings.pdfCssNone");
    pdfCssClearBtn.classList.toggle("hidden", !pdfCssTextInput.value);
  });

  // 输出目录选择 / 恢复默认(空串 = 与源文件相同目录);
  // 抽屉与快速参数条两处入口共享 pickOutputDir / setOutputDirDisplay
  outputDirPick.addEventListener("click", () => void pickOutputDir());

  quickOutputPickBtn.addEventListener("click", () => void pickOutputDir());

  outputDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    setOutputDirDisplay("");
    persistSettings({ outputDir: "" });
  });
}
