/**
 * 事件绑定组合入口:内部逐域调用:
 * - selection       选择/拖放区点击与多文件列表交互(convert/events/selection.ts)
 * - drop            外部文件拖入与跳过列表(convert/events/drop.ts)
 * - convert-actions 转换按钮/快捷键/进度订阅(convert/events/convert-actions.ts)
 * - dialogs-events  弹窗交互/汇总条/菜单转发/Esc(convert/events/dialogs-events.ts)
 * 调用顺序 = 原单函数内的注册顺序;跨域仅 document keydown 两处(快捷键 / Esc)
 * 同元素同类型,二者按键互斥,顺序无行为影响。时序不变:绑定先于设置回填。
 *
 * 端口注入:原为「组合根零感知」的零参入口,现接 `deps`(ADR-075 §四 的端口形态)。
 * 组合根持有各 feature 那份 deps 并预先绑成零参闭包(如 wizard 的 `openWizard`)
 * 传进来,于是 convert 无需知道别的 feature 的 deps 形状(⚠ 若让 convert 侧自己
 * import 那个类型,会造出一条新的 type-only 跨 feature 边,正是 ADR-075 点名的两侧
 * 分叉口)。
 *
 * convert 自身的呈现面(ui/dialogs 的五个符号)在 convert 刀里接进同一份 deps:
 * `ConvertFlowDeps` 由 convert-flow 自报,`bindSelectionEvents` /
 * `bindConvertActionsEvents` / `bindDialogEvents` 三域共用它;选择管线那份
 * `FileListDeps` 由 convert/file-list 自报,`bindDropEvents` 单独用它
 * (`satisfies` 窄化后传入,故本域只需那份最小面)—— 组合根只需装配
 * **一个**对象(与 `bookWizardDeps` 同一形态)。
 */
import { bindSelectionEvents, type SelectionEventsDeps } from "./selection.js";
import { bindDropEvents } from "./drop.js";
import { bindConvertActionsEvents, type ConvertActionsEventsDeps } from "./convert-actions.js";
import { bindDialogEvents, type DialogEventsDeps } from "./dialogs-events.js";
import type { FileListDeps } from "../file-list.js";
import type { ConvertFlowDeps } from "../convert-flow.js";

/**
 * 本入口注入的端口全集。**逐条随对应那一刀增补,不留空壳类型**。
 *
 * 各域自报自己那份(`SelectionEventsDeps` / `DialogEventsDeps` 等),本文件只做聚合 ——
 * 反过来让各域从本文件 import 类型会造出 `index → selection → index` 的模块环。
 */
export interface ConvertEventsDeps extends DialogEventsDeps {
  /** 打开成书向导模态(组合根已把 wizard 的 deps 绑好,故此处是零参闭包)。 */
  openWizard: () => void;
}

export function bindEvents(deps: ConvertEventsDeps): void {
  bindSelectionEvents(deps satisfies ConvertFlowDeps & SelectionEventsDeps);
  bindDropEvents(deps satisfies FileListDeps);
  bindConvertActionsEvents(deps satisfies ConvertActionsEventsDeps);
  bindDialogEvents(deps satisfies DialogEventsDeps);
}
