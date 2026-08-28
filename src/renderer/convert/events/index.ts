/**
 * 事件绑定组合入口:bindEvents() 保留为唯一对外签名(组合根零感知),内部逐域调用:
 * - selection       选择/拖放区点击与多文件列表交互(convert/events/selection.ts)
 * - drop            外部文件拖入与跳过列表(convert/events/drop.ts)
 * - convert-actions 转换按钮/快捷键/进度订阅(convert/events/convert-actions.ts)
 * - dialogs-events  弹窗交互/汇总条/菜单转发/Esc(convert/events/dialogs-events.ts)
 * 调用顺序 = 原单函数内的注册顺序;跨域仅 document keydown 两处(快捷键 / Esc)
 * 同元素同类型,二者按键互斥,顺序无行为影响。时序不变:绑定先于设置回填。
 */
import { bindSelectionEvents } from "./selection.js";
import { bindDropEvents } from "./drop.js";
import { bindConvertActionsEvents } from "./convert-actions.js";
import { bindDialogEvents } from "./dialogs-events.js";

export function bindEvents(): void {
  bindSelectionEvents();
  bindDropEvents();
  bindConvertActionsEvents();
  bindDialogEvents();
}
