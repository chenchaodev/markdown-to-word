/**
 * 编号与目录组(Tab「编号与目录」)接线:一级标题前分页/目录开关与粒度/
 * 公式编号/标题编号/题注编号——变更即时写回并持久化(标题与题注编号经
 * typography 整体写回,与排版组共用 persistTypography)。
 * 分组口径 = index.html 六组 Tab 的 data-group=numbering;拆自
 * settings-bindings.ts(D2,纯搬移零行为改动),编排入口在 settings-bindings。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import {
  breakBeforeH1Input,
  captionNumberingInput,
  equationNumberingInput,
  headingNumberingInput,
  tocInput,
  tocModeSelect,
} from "../dom/refs.js";
import { state } from "../state/state.js";
import { persistSettings, persistTypography } from "./settings-panel.js";

/** 编号与目录组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindNumberingGroup(): void {
  breakBeforeH1Input.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.breakBeforeH1 = breakBeforeH1Input.checked;
    persistSettings({ breakBeforeH1: state.settings.breakBeforeH1 });
  });

  tocInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.toc = tocInput.checked;
    persistSettings({ toc: state.settings.toc });
  });

  tocModeSelect.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.tocMode = tocModeSelect.value as AppSettings["tocMode"];
    persistSettings({ tocMode: state.settings.tocMode });
  });

  equationNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.equationNumbering = equationNumberingInput.checked;
    persistSettings({ equationNumbering: state.settings.equationNumbering });
  });

  headingNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.headingNumbering = headingNumberingInput.checked;
    persistTypography();
  });

  captionNumberingInput.addEventListener("change", () => {
    if (state.hydratingSettings) return;
    state.settings.typography.captionNumbering = captionNumberingInput.checked;
    persistTypography();
  });
}
