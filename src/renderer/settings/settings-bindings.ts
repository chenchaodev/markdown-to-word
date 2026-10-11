/**
 * 设置控件事件绑定编排(组合根 init 处调用):按 index.html 六组 Tab 依次接线。
 * 各组的**值控件 change 监听**由声明表统一接线(键路径、读侧、落值、整块写回与
 * 门控联动都在表里),各分组文件只留表接不了的部分:
 * - settings-bindings-preset.ts     预 设(派生 select 套用 + 弹窗 / 导入导出)
 * - settings-bindings-typography.ts 排 版(六处钳制钩子 + 字号 stepper + 滑杆回显)
 * - settings-bindings-headerwatermark.ts 页眉页脚与水印(水印两处钳制 + logo 动作钮)
 * - settings-bindings-numbering.ts  编号与目录(全组走通用落值,无自定义钩子)
 * - settings-bindings-convert.ts    转 换(PDF CSS 展示位钩子 + 导入清除 / 目录动作钮)
 * - settings-bindings-app.ts        应 用(主题 / 语言钩子 + 抽屉「恢复默认」)
 * 钩子表由各组按声明表反推出的键集自行声明(少一个实现即编译期红,多写也红),
 * 本文件只负责把它们交给各组的接线入口。
 *
 * 加载/回填/持久化单源 settings-panel.ts、预设弹窗与导入导出单源
 * settings-preset-actions.ts(均不反向依赖本模块)。保留的非分组接线:
 * - #quickBar 位于拖放区内部,click/keydown 整体阻断冒泡,防止操作参数时
 *   误触发拖放区「点击=选择文件」语义(阻断不影响控件自身交互)。
 *
 * 快速参数条(主界面)镜像接线:预设 select 两处共用 applyTemplatePreset(preset 组);
 * 输出目录两处 chips 由同步函数同写、两处「更改…」共用 pickOutputDir(convert 组);
 * paper/orientation 镜像分段为同名 radio 组,表接线的全文档成组查询自动覆盖
 * (typography 组,零额外代码);顶栏格式分段(group=mirror)在本文件接线。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import { quickBar } from "../dom/refs.js";
import { bindControlGroup, type WriteHook } from "./settings-controls-table.js";
import { controlDom, settingsWriteContext } from "./settings-panel.js";
import { bindPresetGroup } from "./settings-bindings-preset.js";
import { bindTypographyGroup, typographyWriteHooks } from "./settings-bindings-typography.js";
import {
  bindHeaderWatermarkGroup,
  headerWatermarkWriteHooks,
} from "./settings-bindings-headerwatermark.js";
import { bindNumberingGroup } from "./settings-bindings-numbering.js";
import { bindConvertGroup, convertWriteHooks } from "./settings-bindings-convert.js";
import { bindAppGroup, appWriteHooks, type AppGroupDeps } from "./settings-bindings-app.js";

/** 顶栏格式分段(抽屉外,group=mirror)的写侧钩子:转换时读的是 selectedFormat,
 *  它与 settings.format 双写,故落值前先同步镜像态。 */
const formatHook: WriteHook = (ctx, control, write) => {
  const format = control.value as AppSettings["format"];
  ctx.setSelectedFormat(format);
  write(format);
};

/**
 * 设置事件绑定入口(任一控件变更即时生效并持久化;须先于 loadSettings 回填)。
 *
 * `deps` 是**编排层当前承的端口全集**:此刻只有应用组一条(语言钩子要重渲染
 * convert 侧的选择区)。逐组接入后此处成为各组 deps 的并集 —— 哪个组需要跨功能
 * 协作,就把它的端口在这里汇进来,而不是让该组自己去 import(ADR-075 §四)。
 */
export function bindSettingsEvents(deps: AppGroupDeps): void {
  bindPresetGroup();
  bindTypographyGroup(typographyWriteHooks);
  bindHeaderWatermarkGroup(headerWatermarkWriteHooks);
  bindNumberingGroup();
  bindConvertGroup(convertWriteHooks);
  bindAppGroup(appWriteHooks(deps));

  /* ---------- 抽屉外镜像与顶栏控件 ---------- */
  // 顶栏格式分段:同一套落值通道,只是主控在抽屉外
  bindControlGroup("mirror", controlDom, settingsWriteContext, { format: formatHook });

  /* ---------- 快速参数条冒泡守卫 ----------
   * #quickBar 位于拖放区(#dropZone 点击/键盘 = 选择文件)内部:
   * click 与键盘事件整体阻断冒泡,防止调参动作误触「打开文件对话框」;
   * 阻断不影响各控件的自身交互(select 展开/radio 切换/button click 正常触发)。 */
  quickBar.addEventListener("click", (event) => event.stopPropagation());
  // 仅阻断 Enter/Space(拖放区以此打开文件对话框);Esc / Ctrl+Enter 等全局快捷键
  // 监听在 document 上,须放行冒泡,否则聚焦参数条内时抽屉无法 Esc 关闭
  quickBar.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  });
}
