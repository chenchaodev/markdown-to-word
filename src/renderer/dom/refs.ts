/**
 * renderer DOM 元素引用(纯 getElementById / querySelector 映射,无逻辑):
 * R7 自 renderer.ts 抽出,常量名与语义原样保留,renderer.ts 经命名导入使用。
 * 模块加载时机与 renderer.ts 相同(script type=module),元素必然已就绪。
 */
export const dropZone = document.getElementById("dropZone") as HTMLDivElement;
export const selectBtn = document.getElementById("selectBtn") as HTMLButtonElement;
export const dropDefault = document.getElementById("dropDefault") as HTMLDivElement;
export const dropFile = document.getElementById("dropFile") as HTMLDivElement;
export const fileNameEl = document.getElementById("fileName") as HTMLParagraphElement;
export const filePathEl = document.getElementById("filePath") as HTMLParagraphElement;
export const dropMulti = document.getElementById("dropMulti") as HTMLDivElement;
export const multiCount = document.getElementById("multiCount") as HTMLParagraphElement;
export const multiList = document.getElementById("multiList") as HTMLUListElement;
export const statusEl = document.getElementById("status") as HTMLParagraphElement;
// P1-1:格式分段控件(顶栏;radio 语义保留,name="format" 与绑定不变)
export const convertBtn = document.getElementById("convertBtn") as HTMLButtonElement;
export const batchBtn = document.getElementById("batchBtn") as HTMLButtonElement;
export const mergeBtn = document.getElementById("mergeBtn") as HTMLButtonElement;
export const convertHint = document.querySelector<HTMLSpanElement>(".convert .hint");
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
export const paperSelect = document.getElementById("paperSelect") as HTMLSelectElement;
// P0-4:方向由双 radio 改单 select(value 与原 radio 一致,绑定/回填同步迁移)
export const orientationSelect = document.getElementById(
  "orientationSelect",
) as HTMLSelectElement;
export const breakBeforeH1Input = document.getElementById(
  "breakBeforeH1",
) as HTMLInputElement;
export const tocInput = document.getElementById("toc") as HTMLInputElement;
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
export const bodySizePtInput = document.getElementById(
  "bodySizePt",
) as HTMLInputElement;
export const lineSpacingInput = document.getElementById(
  "lineSpacing",
) as HTMLInputElement;
// F3 标题排版粒度:标题字号/间距档位 select(三档,选项静态于 index.html)
export const headingScaleSelect = document.getElementById(
  "headingScaleSelect",
) as HTMLSelectElement;
export const headingSpacingSelect = document.getElementById(
  "headingSpacingSelect",
) as HTMLSelectElement;
export const firstLineIndentInput = document.getElementById(
  "firstLineIndent",
) as HTMLInputElement;
export const alignJustifyInput = document.getElementById(
  "alignJustify",
) as HTMLInputElement;
export const headingNumberingInput = document.getElementById(
  "headingNumbering",
) as HTMLInputElement;
export const captionNumberingInput = document.getElementById(
  "captionNumbering",
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
// 批次 7:列表工具(单文件移除 / 多文件追加与清空)
export const removeFileBtn = document.getElementById(
  "removeFileBtn",
) as HTMLButtonElement;
// 迭代 4:单文件态「预览」按钮(转换前预览排版,与 PDF 同排版)
export const previewBtn = document.getElementById("previewBtn") as HTMLButtonElement;
// 批次 12(A):单文件态「追加文件」按钮(对话框追加,与多文件态 appendBtn 同语义)
export const appendFileBtn = document.getElementById(
  "appendFileBtn",
) as HTMLButtonElement;
export const appendBtn = document.getElementById("appendBtn") as HTMLButtonElement;
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
// 批次 11:最近转换(P1-3 起为主舞台空态快捷 chips:容器 + chips 列表 + 清空入口)
export const recentChips = document.getElementById(
  "recentChips",
) as HTMLDivElement;
export const recentChipList = document.getElementById(
  "recentChipList",
) as HTMLDivElement;
export const recentClearBtn = document.getElementById(
  "recentClearBtn",
) as HTMLButtonElement;
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
// 批次 11 迭代 2:完成弹窗「不再提示」/ 设置面板「转换完成弹窗提示」(同字段双向同步)
export const completeDialogSuppressInput = document.getElementById(
  "completeDialogSuppress",
) as HTMLInputElement;
export const completeDialogPromptInput = document.getElementById(
  "completeDialogPrompt",
) as HTMLInputElement;
// 批次 11 迭代 2:批量弹窗「重试失败项 / 复制全部路径」
export const batchDialogRetry = document.getElementById(
  "batchDialogRetry",
) as HTMLButtonElement;
export const batchDialogCopyAll = document.getElementById(
  "batchDialogCopyAll",
) as HTMLButtonElement;
