/**
 * 转换组(Tab「转 换」)接线:AI 清理(含其下两个分档)/Obsidian 兼容与附件目录/
 * 转换后行为/PDF 自定义 CSS(导入与清除)/输出目录选择与复位。
 *
 * 域内 change 监听由声明表统一接线;本文件只留表接不了的部分:
 *  - PDF CSS 的导入 / 清除、输出目录的「更改…」/「恢复默认」:动作按钮,不是值控件;
 *  - 一个写侧钩子:PDF CSS 的状态行与清除钮是**设置值驱动的展示位**,change 侧
 *    同样要同步(其余 5 处展示位由动作入口或整体回填驱动,见表的 VALUE_DRIVEN_EFFECTS)。
 * 分组口径 = index.html 六组 Tab 的 data-group=convert。
 * 顶栏格式分段(group=mirror,抽屉外)在编排根 settings-bindings.ts 接线。
 */
import { t } from "../../core/i18n.js";
import {
  outputDirPick,
  outputDirReset,
  pdfCssClearBtn,
  pdfCssImportBtn,
  quickOutputPickBtn,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { setError } from "../ui/dom-ops.js";
import { errorMessage } from "../state/pure.js";
import {
  bindControlGroup,
  type WriteHook,
  type WriteHooksOf,
} from "./settings-controls-table.js";
import {
  clearPdfCss,
  controlDom,
  importPdfCss,
  persistSettings,
  settingsWriteContext,
  syncOutputDirDisplay,
  syncPdfCssState,
} from "./settings-panel.js";

/** 打开目录选择对话框(抽屉「更改…」与快速参数条「更改…」共用);取消无动作。 */
async function pickOutputDir(): Promise<void> {
  try {
    const dir = await window.api.selectDir();
    if (!dir) return; // 用户取消
    state.settings.outputDir = dir;
    syncOutputDirDisplay(dir); // 动态节点单源(settings-panel)
    persistSettings({ outputDir: dir });
  } catch (err) {
    const message = errorMessage(err);
    setError(t("settings.selectDirFailed", { error: message }));
  }
}

/** PDF 自定义 CSS:状态行与清除按钮是设置值驱动的展示位,change 侧同样要同步
 *  (其余 5 处展示位由动作入口或整体回填驱动,见表的 VALUE_DRIVEN_EFFECTS)。 */
const pdfCssHook: WriteHook = (_ctx, control, write) => {
  write(control.value);
  syncPdfCssState(control.value); // 状态行与清除按钮显隐单源
};

/** 本组声明了写侧钩子的条目(键集由表反推,多写/漏写即 tsc 报错)。 */
export const convertWriteHooks: WriteHooksOf<"convert"> = {
  pdfCss: pdfCssHook,
};

/** 转换组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindConvertGroup(hooks: WriteHooksOf<"convert">): void {
  bindControlGroup("convert", controlDom, settingsWriteContext, hooks);

  // PDF 样式 CSS 导入 / 清除(IIFE + void,规避 no-misused-promises)
  pdfCssImportBtn.addEventListener("click", () => void importPdfCss());
  pdfCssClearBtn.addEventListener("click", clearPdfCss);

  // 输出目录选择 / 恢复默认(空串 = 与源文件相同目录);
  // 抽屉与快速参数条两处入口共享 pickOutputDir / syncOutputDirDisplay
  outputDirPick.addEventListener("click", () => void pickOutputDir());

  quickOutputPickBtn.addEventListener("click", () => void pickOutputDir());

  outputDirReset.addEventListener("click", () => {
    state.settings.outputDir = "";
    syncOutputDirDisplay("");
    persistSettings({ outputDir: "" });
  });
}
