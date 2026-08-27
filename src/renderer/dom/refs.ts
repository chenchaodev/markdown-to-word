/**
 * renderer DOM 元素引用(纯 getElementById / querySelector 映射,无逻辑):
 * R7 自 renderer.ts 抽出,常量名与语义原样保留,renderer.ts 经命名导入使用。
 * 模块加载时机与 renderer.ts 相同(script type=module),元素必然已就绪。
 * UI 改版 v4:单文件卡退役(统一队列卡),fileName/filePath/removeFileBtn/
 * appendBtn 等旧单文件态元素随之移除;新增快速参数条三引用(qb 前缀语义)。
 */
export const dropZone = document.getElementById("dropZone") as HTMLDivElement;
export const selectBtn = document.getElementById("selectBtn") as HTMLButtonElement;
export const multiCount = document.getElementById("multiCount") as HTMLParagraphElement;
export const multiList = document.getElementById("multiList") as HTMLUListElement;
export const statusEl = document.getElementById("status") as HTMLParagraphElement;
// P1-1:格式分段控件(顶栏;radio 语义保留,name="format" 与绑定不变)
export const convertBtn = document.getElementById("convertBtn") as HTMLButtonElement;
export const batchBtn = document.getElementById("batchBtn") as HTMLButtonElement;
export const mergeBtn = document.getElementById("mergeBtn") as HTMLButtonElement;
// 界面重构 v3:快捷键提示随模式切换(单文件/批量语义),span 固定 id 于动作栏内
export const convertHint = document.getElementById("convertHint");
export const completeDialog = document.getElementById(
  "completeDialog",
) as HTMLDivElement;
export const completeOutputPath = document.getElementById(
  "completeOutputPath",
) as HTMLParagraphElement;
export const completeDialogOk = document.getElementById(
  "completeDialogOk",
) as HTMLButtonElement;
export const formatInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="format"]',
);
// i18n:界面语言 select(P0-4 自 radio 组迁移;选项由 settings-panel.rebuildLanguageOptions
// 按 LANGUAGES 注册表动态生成,模块加载期尚为空,回填在 rebuild 之后)
export const languageSelect = document.getElementById(
  "languageSelect",
) as HTMLSelectElement;
// B13:外观主题选择(P0-4 起为分段控件呈现;radio 语义保留,name="theme")
export const themeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="theme"]',
);
// 页面设置面板
// 界面重构 v3:纸张/方向自 select 改 seg 分段(radio 组;guidelines §3.1 枚举 ≤5 → seg,
// 与 alignInputs/themeInputs 同款组绑定模式;原 paperSelect/orientationSelect 单元素
// id 随形态转换退役,读写链路在 settings-bindings/settings-panel 同步迁移)。
// UI 改版 v4:name 全文档成组——快速参数条的镜像分段(同名 radio)自动并入本组,
// 绑定与回填零改动覆盖两处控件
export const paperInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="paper"]',
);
export const orientationInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="orientation"]',
);
export const breakBeforeH1Input = document.getElementById(
  "breakBeforeH1",
) as HTMLInputElement;
export const tocInput = document.getElementById("toc") as HTMLInputElement;
export const tocModeSelect = document.getElementById("tocMode") as HTMLSelectElement;
export const equationNumberingInput = document.getElementById(
  "equationNumbering",
) as HTMLInputElement;
export const afterConvertInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="afterConvert"]',
);
export const marginInputs = {
  marginTop: document.getElementById("marginTop") as HTMLInputElement,
  marginBottom: document.getElementById("marginBottom") as HTMLInputElement,
  marginLeft: document.getElementById("marginLeft") as HTMLInputElement,
  marginRight: document.getElementById("marginRight") as HTMLInputElement,
};
// 排版设置面板
export const fontAsciiInput = document.getElementById("fontAscii") as HTMLInputElement;
export const fontEastAsiaInput = document.getElementById(
  "fontEastAsia",
) as HTMLInputElement;
// 界面重构 v3:正文字号改 stepper 形态(input id 不变,± 步进按钮为新增元素)
export const bodySizePtInput = document.getElementById(
  "bodySizePt",
) as HTMLInputElement;
export const bodySizeDecBtn = document.getElementById(
  "bodySizeDecBtn",
) as HTMLButtonElement;
export const bodySizeIncBtn = document.getElementById(
  "bodySizeIncBtn",
) as HTMLButtonElement;
// 界面重构 v3:行距改 range 滑杆(input id 不变)+ mono 实时回显
export const lineSpacingInput = document.getElementById(
  "lineSpacing",
) as HTMLInputElement;
export const lineSpacingValue = document.getElementById(
  "lineSpacingValue",
) as HTMLOutputElement;
// F3 标题排版粒度:标题字号/间距档位(界面重构 v3 自 select 改 seg 分段,三档;
// 组绑定模式同上)
export const headingScaleInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="headingScale"]',
);
export const headingSpacingInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="headingSpacing"]',
);
export const firstLineIndentInput = document.getElementById(
  "firstLineIndent",
) as HTMLInputElement;
// 界面重构 v3:对齐方式由布尔 checkbox 升级为枚举分段(radio 组,left/justify);
// 存储契约不变(typography.align),旧布尔档由 mergeSettingsWithDefaults 归一化
export const alignInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="align"]',
);
export const headingNumberingInput = document.getElementById(
  "headingNumbering",
) as HTMLInputElement;
export const captionNumberingInput = document.getElementById(
  "captionNumbering",
) as HTMLInputElement;
// F4 页眉页脚:模式/文字/logo 选择清除与回显/布局/页脚开关
// 界面重构 v3:页眉模式与页眉布局自 select 改 seg 分段(模式 + 条件字段容器,
// IA §3.1 抽屉唯一折叠形态;主控 seg 置首)
export const headerModeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="headerMode"]',
);
export const headerCustomFields = document.getElementById(
  "headerCustomFields",
) as HTMLDivElement;
export const headerTextInput = document.getElementById(
  "headerText",
) as HTMLInputElement;
export const headerLogoStatus = document.getElementById(
  "headerLogoStatus",
) as HTMLSpanElement;
export const headerLogoPickBtn = document.getElementById(
  "headerLogoPick",
) as HTMLButtonElement;
export const headerLogoClearBtn = document.getElementById(
  "headerLogoClear",
) as HTMLButtonElement;
export const headerLayoutInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="headerLayout"]',
);
export const footerEnabledInput = document.getElementById(
  "footerEnabled",
) as HTMLInputElement;
// 文字水印(F5)
export const watermarkTextInput = document.getElementById(
  "watermarkText",
) as HTMLInputElement;
export const watermarkAngleInput = document.getElementById(
  "watermarkAngle",
) as HTMLInputElement;
export const watermarkOpacityInput = document.getElementById(
  "watermarkOpacity",
) as HTMLInputElement;
export const watermarkGrayInput = document.getElementById(
  "watermarkGray",
) as HTMLInputElement;
// 模板预设
export const templatePresetSelect = document.getElementById(
  "templatePreset",
) as HTMLSelectElement;
export const templatePresetHint = document.getElementById(
  "templatePresetHint",
) as HTMLSpanElement;
// 批次 11 迭代 3:自定义预设(另存为 / 删除 / 命名弹窗)
export const presetSaveBtn = document.getElementById(
  "presetSaveBtn",
) as HTMLButtonElement;
export const presetDeleteBtn = document.getElementById(
  "presetDeleteBtn",
) as HTMLButtonElement;
// 批次 13:预设 JSON 导入 / 导出
export const presetImportBtn = document.getElementById(
  "presetImportBtn",
) as HTMLButtonElement;
export const presetExportBtn = document.getElementById(
  "presetExportBtn",
) as HTMLButtonElement;
// 批次 16:PDF 样式 CSS 导入(导入 / 清除 / 状态显示)
// 界面重构 v3:补 IA 06 规定的 textarea 形态(与导入/清除同写 settings.pdfCss)
export const pdfCssTextInput = document.getElementById(
  "pdfCssText",
) as HTMLTextAreaElement;
export const pdfCssImportBtn = document.getElementById(
  "pdfCssImportBtn",
) as HTMLButtonElement;
export const pdfCssClearBtn = document.getElementById(
  "pdfCssClearBtn",
) as HTMLButtonElement;
export const pdfCssStatus = document.getElementById(
  "pdfCssStatus",
) as HTMLSpanElement;
export const presetSaveDialog = document.getElementById(
  "presetSaveDialog",
) as HTMLDivElement;
export const presetNameInput = document.getElementById(
  "presetNameInput",
) as HTMLInputElement;
export const presetSaveError = document.getElementById(
  "presetSaveError",
) as HTMLParagraphElement;
export const presetSaveOk = document.getElementById(
  "presetSaveOk",
) as HTMLButtonElement;
export const presetSaveCancel = document.getElementById(
  "presetSaveCancel",
) as HTMLButtonElement;
// 完成弹窗附加按钮与错误提示
export const completeDialogReveal = document.getElementById(
  "completeDialogReveal",
) as HTMLButtonElement;
export const completeDialogOpen = document.getElementById(
  "completeDialogOpen",
) as HTMLButtonElement;
export const completeDialogError = document.getElementById(
  "completeDialogError",
) as HTMLParagraphElement;
// 批量结果汇总弹窗
export const batchDialog = document.getElementById("batchDialog") as HTMLDivElement;
export const batchSummary = document.getElementById("batchSummary") as HTMLParagraphElement;
export const batchResultList = document.getElementById(
  "batchResultList",
) as HTMLUListElement;
export const batchDialogOk = document.getElementById(
  "batchDialogOk",
) as HTMLButtonElement;
export const batchDialogReveal = document.getElementById(
  "batchDialogReveal",
) as HTMLButtonElement;
export const batchDialogError = document.getElementById(
  "batchDialogError",
) as HTMLParagraphElement;
// F6:转换预检报告弹窗
export const precheckDialog = document.getElementById(
  "precheckDialog",
) as HTMLDivElement;
export const precheckDialogDesc = document.getElementById(
  "precheckDesc",
) as HTMLParagraphElement;
export const precheckList = document.getElementById(
  "precheckList",
) as HTMLUListElement;
export const precheckContinue = document.getElementById(
  "precheckContinue",
) as HTMLButtonElement;
export const precheckCancel = document.getElementById(
  "precheckCancel",
) as HTMLButtonElement;
// UI 改版 v4:统一队列卡头部动作。previewBtn 仅单文件可见(updateActionButtons
// 切换 hidden);appendFileBtn 两态共用(追加合并语义);clearListBtn 清空选择
export const previewBtn = document.getElementById("previewBtn") as HTMLButtonElement;
export const appendFileBtn = document.getElementById(
  "appendFileBtn",
) as HTMLButtonElement;
export const clearListBtn = document.getElementById(
  "clearListBtn",
) as HTMLButtonElement;
// 批次 7:转换进度(进度条 + 百分比 + 取消)
export const progressArea = document.getElementById("progressArea") as HTMLDivElement;
export const progressTrack = document.getElementById(
  "progressTrack",
) as HTMLDivElement;
export const progressFill = document.getElementById("progressFill") as HTMLDivElement;
export const progressText = document.getElementById("progressText") as HTMLSpanElement;
export const cancelBtn = document.getElementById("cancelBtn") as HTMLButtonElement;
// 批次 7:转换结果汇总(常驻,不依赖弹窗;打开引导 + 可折叠警告)
export const resultSummary = document.getElementById("resultSummary") as HTMLDivElement;
export const summaryIcon = document.getElementById("summaryIcon") as HTMLElement;
export const summaryText = document.getElementById("summaryText") as HTMLParagraphElement;
export const summaryPath = document.getElementById("summaryPath") as HTMLParagraphElement;
export const summaryError = document.getElementById("summaryError") as HTMLParagraphElement;
export const summaryRevealBtn = document.getElementById(
  "summaryRevealBtn",
) as HTMLButtonElement;
export const summaryOpenBtn = document.getElementById(
  "summaryOpenBtn",
) as HTMLButtonElement;
export const summaryDetailsBtn = document.getElementById(
  "summaryDetailsBtn",
) as HTMLButtonElement;
export const summaryWarnings = document.getElementById(
  "summaryWarnings",
) as HTMLDetailsElement;
export const summaryWarningsToggle = document.getElementById(
  "summaryWarningsToggle",
) as HTMLElement;
export const summaryWarningsList = document.getElementById(
  "summaryWarningsList",
) as HTMLUListElement;
// 批次 7:字段级错误提示(边距 / 字体 / 字号 / 行距)
export const marginError = document.getElementById("marginError") as HTMLParagraphElement;
// B9 拖放反馈细化:被跳过的非 Markdown 文件名列表(可折叠;复用汇总条 details 样式类)
export const dropSkipped = document.getElementById("dropSkipped") as HTMLDetailsElement;
export const dropSkippedToggle = document.getElementById(
  "dropSkippedToggle",
) as HTMLElement;
export const dropSkippedList = document.getElementById(
  "dropSkippedList",
) as HTMLUListElement;
export const fontAsciiError = document.getElementById(
  "fontAsciiError",
) as HTMLParagraphElement;
export const fontEastAsiaError = document.getElementById(
  "fontEastAsiaError",
) as HTMLParagraphElement;
export const bodySizeError = document.getElementById(
  "bodySizeError",
) as HTMLParagraphElement;
export const lineSpacingError = document.getElementById(
  "lineSpacingError",
) as HTMLParagraphElement;
// 批次 7:输出目录设置
export const outputDirValue = document.getElementById(
  "outputDirValue",
) as HTMLSpanElement;
export const outputDirPick = document.getElementById(
  "outputDirPick",
) as HTMLButtonElement;
export const outputDirReset = document.getElementById(
  "outputDirReset",
) as HTMLButtonElement;
// 批次 7:完成弹窗复制路径
export const completeDialogCopy = document.getElementById(
  "completeDialogCopy",
) as HTMLButtonElement;
export const completeDialogTitle = document.getElementById(
  "completeDialogTitle",
) as HTMLHeadingElement;
export const completeDialogDesc = document.getElementById(
  "completeDialogDesc",
) as HTMLParagraphElement;
// 界面重构 v3 → UI 改版 v4:最近转换「常驻折叠条」改「浮出面板」——标题条常驻占位,
// 展开体为浮层(.h-body absolute);折叠语义 data-open 不变,refs 契约原样保留:
// 折叠条容器(data-open 驱动展开/收起;无记录整块 hidden)+ 标题条切换钮 +
// 条数徽标 + 列表本体(内部滚动);「清空记录」入口 id 沿用 recentClearBtn
export const historyBar = document.getElementById("historyBar") as HTMLElement;
export const histToggle = document.getElementById("histToggle") as HTMLButtonElement;
export const histCount = document.getElementById("histCount") as HTMLSpanElement;
export const recentList = document.getElementById("recentList") as HTMLUListElement;
export const recentClearBtn = document.getElementById(
  "recentClearBtn",
) as HTMLButtonElement;
// toast 轻提示(预设切换等即时反馈;单实例,showToast 写入)
export const toastEl = document.getElementById("toast") as HTMLDivElement;
// P0-3 设置抽屉:overlay 根容器(开合记忆 ui-state.panelOpen.page)+ 顶栏入口
export const settingsDrawer = document.getElementById(
  "settingsDrawer",
) as HTMLDivElement;
export const drawerCloseBtn = document.getElementById(
  "drawerCloseBtn",
) as HTMLButtonElement;
export const settingsOpenBtn = document.getElementById(
  "settingsOpenBtn",
) as HTMLButtonElement;
// 抽屉副标题(问题 3):「当前预设 · 纸张」(文案由 settings-panel 合成、
// settings-drawer.updateDrawerMeta 写入;空串时 CSS :empty 隐藏)
export const drawerSubtitle = document.getElementById(
  "drawerSubtitle",
) as HTMLParagraphElement;
// 界面重构 v3:抽屉底部「完成」按钮(关闭抽屉;焦点归还链与关闭按钮一致)
export const drawerDoneBtn = document.getElementById(
  "drawerDoneBtn",
) as HTMLButtonElement;
// 界面重构 v3:抽屉底部「恢复默认」(mockup 抽屉底栏左位;转换相关各组复位,
// 接线见 settings-bindings.bindSettingsEvents)
export const drawerResetBtn = document.getElementById(
  "drawerResetBtn",
) as HTMLButtonElement;
// 批次 11 迭代 2:完成弹窗「不再提示」(设置面板侧「转换完成弹窗提示」控件已按
// settings-ia.md 迁移映射表移除——场景被 afterConvert 覆盖;仅保留弹窗内入口)
export const completeDialogSuppressInput = document.getElementById(
  "completeDialogSuppress",
) as HTMLInputElement;
// 批次 11 迭代 2:批量弹窗「重试失败项 / 复制全部路径」
export const batchDialogRetry = document.getElementById(
  "batchDialogRetry",
) as HTMLButtonElement;
export const batchDialogCopyAll = document.getElementById(
  "batchDialogCopyAll",
) as HTMLButtonElement;
// ── UI 改版 v4:快速参数条(舞台内底部;预设/纸张/方向/输出目录四项高频直达)──
// 容器(位于 #dropZone 内部,click/keydown 需阻断冒泡防触发拖放区打开对话框);
// 预设镜像 select(选项由 rebuildPresetOptions 同步维护);输出目录镜像 chip 与
// 更改按钮(paper/orientation 镜像分段为同名 radio,自动并入上方组引用,无需单列)
export const quickBar = document.getElementById("quickBar") as HTMLDivElement;
export const quickPresetSelect = document.getElementById(
  "quickPreset",
) as HTMLSelectElement;
export const quickOutputDirChip = document.getElementById(
  "quickOutputDir",
) as HTMLSpanElement;
export const quickOutputPickBtn = document.getElementById(
  "quickOutputPick",
) as HTMLButtonElement;

/**
 * seg 分段(radio 组)当前选中值读取(无选中返回空串):
 * 界面重构 v3 随枚举控件 select → seg 形态转换新增的唯读助手,
 * 供 settings-panel 回填合成(抽屉副标题/条件块显隐)使用;事件写入侧
 * 在 change 监听内直接读 input.value,不经此函数。
 */
export function checkedRadioValue(
  inputs: NodeListOf<HTMLInputElement>,
): string {
  return Array.from(inputs).find((input) => input.checked)?.value ?? "";
}
