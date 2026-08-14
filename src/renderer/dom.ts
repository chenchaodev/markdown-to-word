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
// 页面设置面板
export const paperSelect = document.getElementById("paperSelect") as HTMLSelectElement;
export const orientationInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="orientation"]',
);
export const breakBeforeH1Input = document.getElementById(
  "breakBeforeH1",
) as HTMLInputElement;
export const tocInput = document.getElementById("toc") as HTMLInputElement;
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
// 批次 11:最近转换区块(默认态/单文件态显示;点击条目一键重转)
export const recentSection = document.getElementById("recentSection") as HTMLElement;
export const recentList = document.getElementById("recentList") as HTMLUListElement;
export const recentClearBtn = document.getElementById(
  "recentClearBtn",
) as HTMLButtonElement;
// 批次 11:设置面板 details(panelOpen 展开态记忆)
export const settingsPanel = document.getElementById(
  "settingsPanel",
) as HTMLDetailsElement;
export const typographyPanel = document.getElementById(
  "typographyPanel",
) as HTMLDetailsElement;
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
