/**
 * 设置控件事件绑定编排(组合根 init 处调用):按 index.html 六组 Tab 依次接线,
 * 各组实现在同名分组文件(纯搬移拆分,零行为改动):
 * - settings-bindings-preset.ts     预 设(含 applyTemplatePreset 跨模块契约)
 * - settings-bindings-typography.ts 排 版(纸张/边距/字体/字号/行距/档位/对齐)
 * - settings-bindings-headerwatermark.ts 页眉页脚与水印
 * - settings-bindings-numbering.ts  编号与目录
 * - settings-bindings-convert.ts    转 换(格式/输出目录/AI 清理/PDF CSS)
 * - settings-bindings-app.ts        应 用(恢复默认/语言/主题)
 * 各组监听器相互独立,调用顺序无行为含义;控件 id/name 不在本链路触碰
 * (HTML/refs 零改动,契约由 refs.ts 类型导出在编译期守卫)。
 *
 * 加载/回填/持久化单源 settings-panel.ts、预设弹窗与导入导出单源
 * settings-preset-actions.ts(均不反向依赖本模块)。保留的非分组接线:
 * - #quickBar 位于拖放区内部,click/keydown 整体阻断冒泡,防止操作参数时
 *   误触发拖放区「点击=选择文件」语义(阻断不影响控件自身交互)。
 *
 * 快速参数条(主界面)镜像接线(分散归组,单列仅作索引):
 * - 预设 select 两处(#templatePreset / #quickPreset)共用 applyTemplatePreset(preset 组);
 * - 输出目录两处 chips 由 setOutputDirDisplay 同写,「更改…」两钮共用 pickOutputDir(convert 组);
 * - paper/orientation 镜像分段为同名 radio 组,change 绑定经 paperInputs/
 *   orientationInputs 全文档查询自动覆盖(typography 组,零额外代码)。
 */
import { quickBar } from "../dom/refs.js";
import { bindPresetGroup } from "./settings-bindings-preset.js";
import { bindTypographyGroup } from "./settings-bindings-typography.js";
import { bindHeaderWatermarkGroup } from "./settings-bindings-headerwatermark.js";
import { bindNumberingGroup } from "./settings-bindings-numbering.js";
import { bindConvertGroup } from "./settings-bindings-convert.js";
import { bindAppGroup } from "./settings-bindings-app.js";

/** 设置事件绑定入口(任一控件变更即时生效并持久化;须先于 loadSettings 回填)。 */
export function bindSettingsEvents(): void {
  bindPresetGroup();
  bindTypographyGroup();
  bindHeaderWatermarkGroup();
  bindNumberingGroup();
  bindConvertGroup();
  bindAppGroup();

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
