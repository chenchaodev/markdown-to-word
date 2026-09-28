/**
 * 编号与目录组(Tab「编号与目录」)接线:一级标题前分页/目录开关与粒度/
 * 公式编号/标题编号/题注编号。
 *
 * 本组 6 个控件的 change **全部**走声明表的通用落值(含两个门控联动:
 * 目录总开关驱动目录下拉的整块移除)—— 组内没有一条需要自定义写侧钩子,
 * 故本文件只剩接线入口本身。标题与题注编号落 typography 块,整块写回由表按块产出。
 * 分组口径 = index.html 六组 Tab 的 data-group=numbering。
 */
import { bindControlGroup } from "./settings-controls-table.js";
import { controlDom, settingsWriteContext } from "./settings-panel.js";

/** 编号与目录组全部控件接线(bindSettingsEvents 编排调用)。 */
export function bindNumberingGroup(): void {
  bindControlGroup("numbering", controlDom, settingsWriteContext, {});
}
