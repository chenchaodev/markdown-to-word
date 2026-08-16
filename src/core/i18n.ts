/**
 * 界面多语言(i18n):main + renderer 共享的纯模块(零外部导入)。
 * - 字典 DICT:zh 值 = 现有文案原文逐字保留(默认行为等价,既有测试断言不变);
 *   en 值 = 英文直译
 * - key 按模块前缀命名:convert.stage.read / dialog.complete.title / menu.file 等
 * - 参数插值:t("key", { error }) 模板用 ${error} 占位(与既有模板字符串一致)
 * - 缺失 key:回退返回 key 本身(不抛错)
 * - applyStaticTexts:遍历 [data-i18n] / [data-i18n-placeholder] / [data-i18n-title] /
 *   [data-i18n-aria-label] 替换静态文案(仅 renderer 调用;main 进程 import 本模块
 *   不触碰 DOM——document 只在函数体内引用,模块加载期零副作用)
 * - 语言来源:renderer 经 settings.language(loadSettings 后 setLanguage + applyStaticTexts);
 *   main 进程启动时 setLanguage(loadSettings().language)
 */
export type Language = "zh" | "en";

const DICT: Record<Language, Record<string, string>> = {
  zh: {
    /* ---------- 应用 / 窗口 ---------- */
    "app.title": "Markdown 转换工具",

    /* ---------- 通用 ---------- */
    "common.canceled": "已取消",
    "common.unknownError": "未知错误",
    "common.unknownReason": "未知原因",
    "common.reveal": "打开所在文件夹",
    "common.open": "打开文件",
    "common.revealFailed": "无法打开所在文件夹:${error}",
    "common.openFailed": "无法打开文件:${error}",
    "common.openFailedPlain": "无法打开文件",
    "common.copied": "已复制",
    "common.copyFailed": "复制失败,请手动选择文本复制",
    "common.copyPath": "复制路径",
    "common.cancel": "取消",
    "common.ok": "确定",
    "common.save": "保存",
    "common.preview": "预览",
    "common.remove": "移除",
    "common.moveUp": "上移",
    "common.moveDown": "下移",

    /* ---------- 转换(convert-flow / renderer / 底部操作栏) ---------- */
    "convert.stage.converting": "正在转换…",
    "convert.stage.read": "正在读取文件…",
    "convert.stage.render": "正在渲染文档…",
    "convert.stage.done": "正在完成…",
    "convert.canceled.title": "转换已取消",
    "convert.done.status": "转换完成:${outputPath}",
    "convert.done.title": "转换完成",
    "convert.failed.status": "转换失败:${error}",
    "convert.failed.title": "转换失败",
    "convert.batch.stage": "正在批量转换 ${count} 个文件…",
    "convert.batch.canceledSuffix": ",取消 ${count}",
    "convert.batch.doneMixed": "批量完成:成功 ${ok} / 失败 ${fail}${canceled}",
    "convert.batch.doneAll": "批量完成:成功 ${count} 个文件${canceled}",
    "convert.batch.failed": "批量转换失败:${error}",
    "convert.batch.failedTitle": "批量转换失败",
    "convert.batch.progress": "第 ${index} / ${total} 个:${file} · ${stage}",
    "convert.merge.stage": "正在合并转换…",
    "convert.merge.canceledTitle": "合并已取消",
    "convert.merge.done": "合并完成:${outputPath}",
    "convert.merge.doneTitle": "合并完成",
    "convert.merge.failed": "合并失败:${error}",
    "convert.merge.failedTitle": "合并失败",
    "convert.merge.nameSuffix": "${name}-合并",
    "convert.canceling": "正在取消…",
    "convert.cancelFailed": "取消失败,请重试",
    "convert.start": "开始转换",
    "convert.startTitle": "开始转换(Ctrl+Enter)",
    "convert.batch": "批量转换",
    "convert.batchTitle": "批量转换:每个文件单独生成一个文档(Ctrl+Enter)",
    "convert.merge": "合并转换",
    "convert.mergeTitle": "合并转换:将所有文件合成一个文档,输出文件名含「-合并」",

    /* ---------- 文件选择 / 列表 ---------- */
    "file.onlyMarkdown": "仅支持 .md / .markdown 文件",
    "file.selectFirst": "请先选择 Markdown 文件",
    "file.noMarkdown": "未找到 Markdown 文件",
    "file.noMarkdownSkipped": "未找到 Markdown 文件(跳过 ${count} 个非 Markdown 项)",
    "file.readFailed": "读取文件失败:${error}",
    "file.pathUnavailable": "无法获取文件路径,请改用「选择文件」按钮",
    "file.removedRemaining": "已移除,剩余 ${count} 个文件",
    "file.selectedCount": "已选择 ${count} 个 Markdown 文件",
    "file.selectedSummary": "已选择 ${count} 个文件",
    "file.skippedSuffix": "${summary}(跳过 ${count} 个非 Markdown 项)",
    "file.dblclickPreview": "${path}\n双击预览该行",
    "file.removeAria": "移除 ${name}",
    "file.clearList": "清空列表",
    "file.areaLabel": "文件选择",

    /* ---------- 弹窗 / 对话框 ---------- */
    "dialog.complete.title": "转换完成",
    "dialog.failed.title": "转换失败",
    "dialog.complete.desc": "文档已生成,输出路径如下",
    "dialog.failed.desc": "${name} 未能转换",
    "dialog.suppress": "不再提示",
    "dialog.batch.title": "批量转换完成",
    "dialog.openMarkdowns": "选择 Markdown 文件",
    "dialog.selectDir": "选择输出目录",
    "dialog.importPresets": "导入模板预设",
    "dialog.exportPresets": "导出模板预设",
    "dialog.importPdfCss": "导入 PDF 样式 CSS",
    "dialog.about.title": "关于",
    "dialog.about.message": "Markdown 转换工具",
    "dialog.about.detail": "版本 ${version}\n\n将 Markdown 文件转换为 Word 或 PDF 文档",
    "dialog.openFailed": "打开文件对话框失败:${error}",

    /* ---------- 批量结果 ---------- */
    "batch.summary": "成功 ${ok} / 失败 ${fail}${canceled}",
    "batch.canceledSuffix": " / 取消 ${count}",
    "batch.warningPrefix": "警告:${warning}",
    "batch.canceledMsg": "已取消,未转换",
    "batch.retry": "重试失败项",
    "batch.copyAll": "复制全部路径",

    /* ---------- 汇总条 ---------- */
    "summary.warnings": "警告(${count})",
    "summary.details": "失败详情",
    "summary.revealTitle": "在资源管理器中显示输出文件",

    /* ---------- 最近转换 ---------- */
    "recent.title": "最近转换",
    "recent.sectionLabel": "最近转换",
    "recent.clear": "清空最近",
    "recent.reconvert": "重新转换 ${path}",
    "recent.reconvertAria": "重新转换 ${name}",
    "recent.loadOnly": "仅加载",
    "recent.loadOnlyTitle": "仅加载到文件列表(不转换) ${path}",
    "recent.loadOnlyAria": "仅加载 ${name}",
    "recent.loaded": "已加载:${name}",
    "recent.time.today": "今天 ${time}",
    "recent.time.yesterday": "昨天 ${time}",
    "recent.time.monthDay": "${month}月${day}日",
    "recent.time.fullDate": "${year}年${month}月${day}日",

    /* ---------- 设置面板 ---------- */
    "settings.title": "设置",
    "settings.summaryHint": "模板、页面、排版与导出",
    "settings.autoSaveNote": "设置即时生效并自动保存",
    "settings.groupTemplate": "模板",
    "settings.groupPage": "页面",
    "settings.groupTypography": "排版",
    "settings.groupExport": "导出",
    "settings.groupLanguage": "界面语言",
    "settings.langZh": "中文",
    "settings.langEn": "English",
    "settings.presetLabel": "模板预设",
    "settings.paper": "纸张",
    "settings.orientation": "方向",
    "settings.portrait": "纵向",
    "settings.landscape": "横向",
    "settings.margins": "边距 (mm)",
    "settings.marginTop": "上",
    "settings.marginBottom": "下",
    "settings.marginLeft": "左",
    "settings.marginRight": "右",
    "settings.breakBeforeH1": "每个一级标题前分页",
    "settings.toc": "自动生成目录",
    "settings.tocHint": "(Word 打开即见,免更新域)",
    "settings.fontAscii": "西文字体",
    "settings.fontAsciiHint": "(正文中的字母与数字)",
    "settings.fontEastAsia": "中文字体",
    "settings.fontEastAsiaHint": "(正文中的汉字)",
    "settings.bodySize": "正文字号",
    "settings.bodySizeHint": "(pt)",
    "settings.lineSpacing": "行距",
    "settings.lineSpacingHint": "(倍数)",
    "settings.firstLineIndent": "首行缩进 2 字符",
    "settings.alignJustify": "两端对齐",
    "settings.alignJustifyHint": "(取消后为左对齐)",
    "settings.headingNumbering": "章节自动编号",
    "settings.captionNumbering": "图/表题注自动编号",
    "settings.captionNumberingHint": "(「图: 标题」前缀行识别)",
    "settings.equationNumbering": "公式编号",
    "settings.outputDir": "输出目录",
    "settings.outputDirDefault": "与源文件相同目录",
    "settings.outputDirPick": "选择…",
    "settings.outputDirReset": "恢复默认",
    "settings.afterConvert": "导出后",
    "settings.afterNone": "不自动执行",
    "settings.completeDialogPrompt": "转换完成弹窗提示",
    "settings.outputFormat": "输出格式",
    "settings.pdfCssImported": "已导入自定义 CSS",
    "settings.pdfCssNone": "未导入",
    "settings.cssImport": "导入 CSS…",
    "settings.cssImportTitle": "导入 CSS 文件作为 PDF 样式模板(追加到默认样式之后覆盖)",
    "settings.cssClear": "清除",
    "settings.cssClearTitle": "清除已导入的 PDF 样式 CSS",
    "settings.cssImportFailed": "导入 CSS 失败:${error}",
    "settings.cssImported": "已导入: ${name}",
    "settings.cssImportedStatus": "已导入 PDF 样式:${name}",
    "settings.marginRange": "请输入 0–${max} 之间的数字",
    "settings.numberRange": "请输入 ${min}–${max} 之间的数字",
    "settings.fontAsciiEmpty": "西文字体不能为空,已恢复原值",
    "settings.fontEastAsiaEmpty": "中文字体不能为空,已恢复原值",
    "settings.selectDirFailed": "选择输出目录失败:${error}",
    "settings.cssTooLarge": "CSS 文件过大(超过 ${kb}KB 上限)",

    /* ---------- 模板预设 ---------- */
    "preset.default": "默认",
    "preset.paper": "学术论文",
    "preset.business": "商务简报",
    "preset.saveAs": "另存为预设…",
    "preset.saveAsTitle": "另存为预设",
    "preset.saveDesc": "将当前排版与页面设置保存为自定义预设",
    "preset.delete": "删除预设",
    "preset.import": "导入预设…",
    "preset.importTitle": "从 JSON 文件导入自定义预设",
    "preset.export": "导出预设…",
    "preset.exportTitle": "导出全部自定义预设为 JSON 文件",
    "preset.nameLabel": "预设名称",
    "preset.namePlaceholder": "例如:我的报告模板",
    "preset.nameRequired": "请输入预设名称",
    "preset.nameDuplicate": "已存在同名预设,请换一个名称",
    "preset.nameLimit": "已达 ${max} 个上限，请先删除",
    "preset.customHint": "自定义预设",
    "preset.modifiedHint": "已微调,与模板预设不一致",
    "preset.hintTitle": "选择模板将覆盖排版与页面设置",
    "preset.saveFailed": "保存失败,请重试",
    "preset.deleteFailed": "删除预设失败,请重试",
    "preset.importFailed": "导入预设失败:${error}",
    "preset.importedOverridden": "已导入 ${imported} 个预设(覆盖 ${overridden} 个同名)",
    "preset.imported": "已导入 ${count} 个预设",
    "preset.exportFailed": "导出预设失败:${error}",
    "preset.exported": "已导出 ${count} 个预设",
    "preset.noneToExport": "暂无自定义预设可导出",
    "preset.readFailed": "读取文件失败:${error}",
    "preset.writeFailed": "写入文件失败:${error}",
    "preset.invalidJson": "文件不是有效的 JSON",
    "preset.unsupportedVersion": "不支持的模板文件版本",
    "preset.noValidPresets": "文件不含有效预设",

    /* ---------- 预览 ---------- */
    "preview.failed": "无法预览「${name}」:${reason}。请确认文件仍可读后重试",
    "preview.title": "预览转换排版(与 PDF 同排版)",
    "preview.aria": "预览 ${name}",
    "preview.errorTitle": "预览不可用",
    "preview.sourceMissing": "源文件已不存在:${path}",
    "preview.windowTitle": "预览 - ${name}",

    /* ---------- 拖放区 / 选择入口 ---------- */
    "drop.ariaLabel": "点击或拖入 Markdown 文件（支持多个）",
    "drop.title": "点击或拖入 Markdown 文件",
    "drop.hint": "将 Markdown 文件或文件夹拖到此处",
    "drop.or": "或",
    "drop.change": "点击更换文件，或拖入添加",
    "drop.multiHint": "拖拽或按钮可调整顺序；点击或拖入可继续添加",
    "drop.dblclickHint": "双击列表行可预览排版",
    "select.label": "选择文件",
    "select.title": "选择 Markdown 文件(Ctrl+O)",
    "append.label": "追加文件",
    "append.title": "添加更多文件(Ctrl+O)",

    /* ---------- 快捷键提示 / 格式 / 进度 ---------- */
    "hint.single": "Ctrl+Enter 转换 · Ctrl+O 添加文件",
    "hint.batch": "Ctrl+Enter 批量转换 · Ctrl+O 添加文件",
    "format.docx": "Word (.docx)",
    "format.pdf": "PDF (.pdf)",
    "progress.ariaLabel": "转换进度",

    /* ---------- 应用菜单 ---------- */
    "menu.file": "文件",
    "menu.openFile": "打开文件…",
    "menu.quit": "退出",
    "menu.help": "帮助",
    "menu.about": "关于",
  },
  en: {
    /* ---------- App / window ---------- */
    "app.title": "Markdown Converter",

    /* ---------- Common ---------- */
    "common.canceled": "Canceled",
    "common.unknownError": "Unknown error",
    "common.unknownReason": "Unknown reason",
    "common.reveal": "Open containing folder",
    "common.open": "Open file",
    "common.revealFailed": "Cannot open containing folder: ${error}",
    "common.openFailed": "Cannot open file: ${error}",
    "common.openFailedPlain": "Cannot open file",
    "common.copied": "Copied",
    "common.copyFailed": "Copy failed, please select and copy the text manually",
    "common.copyPath": "Copy path",
    "common.cancel": "Cancel",
    "common.ok": "OK",
    "common.save": "Save",
    "common.preview": "Preview",
    "common.remove": "Remove",
    "common.moveUp": "Move up",
    "common.moveDown": "Move down",

    /* ---------- Convert ---------- */
    "convert.stage.converting": "Converting…",
    "convert.stage.read": "Reading file…",
    "convert.stage.render": "Rendering document…",
    "convert.stage.done": "Finishing…",
    "convert.canceled.title": "Conversion canceled",
    "convert.done.status": "Conversion complete: ${outputPath}",
    "convert.done.title": "Conversion complete",
    "convert.failed.status": "Conversion failed: ${error}",
    "convert.failed.title": "Conversion failed",
    "convert.batch.stage": "Converting ${count} files…",
    "convert.batch.canceledSuffix": ", ${count} canceled",
    "convert.batch.doneMixed": "Batch complete: ${ok} succeeded / ${fail} failed${canceled}",
    "convert.batch.doneAll": "Batch complete: ${count} files succeeded${canceled}",
    "convert.batch.failed": "Batch conversion failed: ${error}",
    "convert.batch.failedTitle": "Batch conversion failed",
    "convert.batch.progress": "File ${index} / ${total}: ${file} · ${stage}",
    "convert.merge.stage": "Merging…",
    "convert.merge.canceledTitle": "Merge canceled",
    "convert.merge.done": "Merge complete: ${outputPath}",
    "convert.merge.doneTitle": "Merge complete",
    "convert.merge.failed": "Merge failed: ${error}",
    "convert.merge.failedTitle": "Merge failed",
    "convert.merge.nameSuffix": "${name}-merged",
    "convert.canceling": "Canceling…",
    "convert.cancelFailed": "Cancel failed, please retry",
    "convert.start": "Start Conversion",
    "convert.startTitle": "Start Conversion (Ctrl+Enter)",
    "convert.batch": "Batch Convert",
    "convert.batchTitle": "Batch convert: generate one document per file (Ctrl+Enter)",
    "convert.merge": "Merge Convert",
    "convert.mergeTitle": "Merge convert: combine all files into one document, output name contains \"-merged\"",

    /* ---------- File selection / list ---------- */
    "file.onlyMarkdown": "Only .md / .markdown files are supported",
    "file.selectFirst": "Please select a Markdown file first",
    "file.noMarkdown": "No Markdown files found",
    "file.noMarkdownSkipped": "No Markdown files found (skipped ${count} non-Markdown items)",
    "file.readFailed": "Failed to read files: ${error}",
    "file.pathUnavailable": "Cannot get file path, please use the \"Select Files\" button instead",
    "file.removedRemaining": "Removed, ${count} files remaining",
    "file.selectedCount": "${count} Markdown files selected",
    "file.selectedSummary": "${count} files selected",
    "file.skippedSuffix": "${summary} (skipped ${count} non-Markdown items)",
    "file.dblclickPreview": "${path}\nDouble-click to preview this row",
    "file.removeAria": "Remove ${name}",
    "file.clearList": "Clear list",
    "file.areaLabel": "File selection",

    /* ---------- Dialogs ---------- */
    "dialog.complete.title": "Conversion complete",
    "dialog.failed.title": "Conversion failed",
    "dialog.complete.desc": "Document generated, output path below",
    "dialog.failed.desc": "${name} could not be converted",
    "dialog.suppress": "Don't show again",
    "dialog.batch.title": "Batch conversion complete",
    "dialog.openMarkdowns": "Select Markdown files",
    "dialog.selectDir": "Select output directory",
    "dialog.importPresets": "Import template presets",
    "dialog.exportPresets": "Export template presets",
    "dialog.importPdfCss": "Import PDF style CSS",
    "dialog.about.title": "About",
    "dialog.about.message": "Markdown Converter",
    "dialog.about.detail": "Version ${version}\n\nConvert Markdown files to Word or PDF documents",
    "dialog.openFailed": "Failed to open file dialog: ${error}",

    /* ---------- Batch results ---------- */
    "batch.summary": "${ok} succeeded / ${fail} failed${canceled}",
    "batch.canceledSuffix": " / ${count} canceled",
    "batch.warningPrefix": "Warning: ${warning}",
    "batch.canceledMsg": "Canceled, not converted",
    "batch.retry": "Retry failed items",
    "batch.copyAll": "Copy all paths",

    /* ---------- Summary bar ---------- */
    "summary.warnings": "Warnings (${count})",
    "summary.details": "Failure details",
    "summary.revealTitle": "Show output file in Explorer",

    /* ---------- Recent conversions ---------- */
    "recent.title": "Recent conversions",
    "recent.sectionLabel": "Recent conversions",
    "recent.clear": "Clear recent",
    "recent.reconvert": "Re-convert ${path}",
    "recent.reconvertAria": "Re-convert ${name}",
    "recent.loadOnly": "Load only",
    "recent.loadOnlyTitle": "Load into file list only (no conversion) ${path}",
    "recent.loadOnlyAria": "Load only ${name}",
    "recent.loaded": "Loaded: ${name}",
    "recent.time.today": "Today ${time}",
    "recent.time.yesterday": "Yesterday ${time}",
    "recent.time.monthDay": "${month}/${day}",
    "recent.time.fullDate": "${year}/${month}/${day}",

    /* ---------- Settings panel ---------- */
    "settings.title": "Settings",
    "settings.summaryHint": "Templates, page, typography and export",
    "settings.autoSaveNote": "Settings take effect immediately and are saved automatically",
    "settings.groupTemplate": "Templates",
    "settings.groupPage": "Page",
    "settings.groupTypography": "Typography",
    "settings.groupExport": "Export",
    "settings.groupLanguage": "Interface language",
    "settings.langZh": "中文",
    "settings.langEn": "English",
    "settings.presetLabel": "Template preset",
    "settings.paper": "Paper",
    "settings.orientation": "Orientation",
    "settings.portrait": "Portrait",
    "settings.landscape": "Landscape",
    "settings.margins": "Margins (mm)",
    "settings.marginTop": "Top",
    "settings.marginBottom": "Bottom",
    "settings.marginLeft": "Left",
    "settings.marginRight": "Right",
    "settings.breakBeforeH1": "Page break before each H1",
    "settings.toc": "Auto-generate table of contents",
    "settings.tocHint": "(visible when opened in Word, no field update needed)",
    "settings.fontAscii": "Western font",
    "settings.fontAsciiHint": "(letters and numbers in body text)",
    "settings.fontEastAsia": "Chinese font",
    "settings.fontEastAsiaHint": "(Chinese characters in body text)",
    "settings.bodySize": "Body font size",
    "settings.bodySizeHint": "(pt)",
    "settings.lineSpacing": "Line spacing",
    "settings.lineSpacingHint": "(multiple)",
    "settings.firstLineIndent": "First-line indent 2 characters",
    "settings.alignJustify": "Justify",
    "settings.alignJustifyHint": "(left-aligned when unchecked)",
    "settings.headingNumbering": "Auto-number headings",
    "settings.captionNumbering": "Auto-number figure/table captions",
    "settings.captionNumberingHint": "(recognizes lines prefixed with \"Figure: title\")",
    "settings.equationNumbering": "Equation numbering",
    "settings.outputDir": "Output directory",
    "settings.outputDirDefault": "Same directory as source file",
    "settings.outputDirPick": "Choose…",
    "settings.outputDirReset": "Reset to default",
    "settings.afterConvert": "After export",
    "settings.afterNone": "Do nothing",
    "settings.completeDialogPrompt": "Show completion dialog",
    "settings.outputFormat": "Output format",
    "settings.pdfCssImported": "Custom CSS imported",
    "settings.pdfCssNone": "Not imported",
    "settings.cssImport": "Import CSS…",
    "settings.cssImportTitle": "Import a CSS file as the PDF style template (appended after default styles to override)",
    "settings.cssClear": "Clear",
    "settings.cssClearTitle": "Clear the imported PDF style CSS",
    "settings.cssImportFailed": "CSS import failed: ${error}",
    "settings.cssImported": "Imported: ${name}",
    "settings.cssImportedStatus": "PDF style imported: ${name}",
    "settings.marginRange": "Enter a number between 0 and ${max}",
    "settings.numberRange": "Enter a number between ${min} and ${max}",
    "settings.fontAsciiEmpty": "Western font cannot be empty, restored to previous value",
    "settings.fontEastAsiaEmpty": "Chinese font cannot be empty, restored to previous value",
    "settings.selectDirFailed": "Failed to select output directory: ${error}",
    "settings.cssTooLarge": "CSS file too large (exceeds ${kb}KB limit)",

    /* ---------- Template presets ---------- */
    "preset.default": "Default",
    "preset.paper": "Academic paper",
    "preset.business": "Business brief",
    "preset.saveAs": "Save as preset…",
    "preset.saveAsTitle": "Save as preset",
    "preset.saveDesc": "Save current typography and page settings as a custom preset",
    "preset.delete": "Delete preset",
    "preset.import": "Import presets…",
    "preset.importTitle": "Import custom presets from a JSON file",
    "preset.export": "Export presets…",
    "preset.exportTitle": "Export all custom presets to a JSON file",
    "preset.nameLabel": "Preset name",
    "preset.namePlaceholder": "e.g. My report template",
    "preset.nameRequired": "Please enter a preset name",
    "preset.nameDuplicate": "A preset with this name already exists, please choose another",
    "preset.nameLimit": "Reached the limit of ${max}, please delete one first",
    "preset.customHint": "Custom preset",
    "preset.modifiedHint": "Modified, no longer matches a template preset",
    "preset.hintTitle": "Selecting a template overrides typography and page settings",
    "preset.saveFailed": "Save failed, please retry",
    "preset.deleteFailed": "Delete failed, please retry",
    "preset.importFailed": "Preset import failed: ${error}",
    "preset.importedOverridden": "Imported ${imported} presets (overrode ${overridden} with the same name)",
    "preset.imported": "Imported ${count} presets",
    "preset.exportFailed": "Preset export failed: ${error}",
    "preset.exported": "Exported ${count} presets",
    "preset.noneToExport": "No custom presets to export",
    "preset.readFailed": "Failed to read file: ${error}",
    "preset.writeFailed": "Failed to write file: ${error}",
    "preset.invalidJson": "File is not valid JSON",
    "preset.unsupportedVersion": "Unsupported template file version",
    "preset.noValidPresets": "File contains no valid presets",

    /* ---------- Preview ---------- */
    "preview.failed": "Cannot preview \"${name}\": ${reason}. Please verify the file is still readable and retry",
    "preview.title": "Preview conversion layout (same as PDF)",
    "preview.aria": "Preview ${name}",
    "preview.errorTitle": "Preview unavailable",
    "preview.sourceMissing": "Source file no longer exists: ${path}",
    "preview.windowTitle": "Preview - ${name}",

    /* ---------- Drop zone / selection entry ---------- */
    "drop.ariaLabel": "Click or drop Markdown files (multiple supported)",
    "drop.title": "Click or drop Markdown files",
    "drop.hint": "Drop Markdown files or folders here",
    "drop.or": "or",
    "drop.change": "Click to change the file, or drop to add",
    "drop.multiHint": "Drag or use buttons to reorder; click or drop to add more",
    "drop.dblclickHint": "Double-click a row to preview the layout",
    "select.label": "Select Files",
    "select.title": "Select Markdown files (Ctrl+O)",
    "append.label": "Add Files",
    "append.title": "Add more files (Ctrl+O)",

    /* ---------- Shortcut hints / formats / progress ---------- */
    "hint.single": "Ctrl+Enter convert · Ctrl+O add files",
    "hint.batch": "Ctrl+Enter batch convert · Ctrl+O add files",
    "format.docx": "Word (.docx)",
    "format.pdf": "PDF (.pdf)",
    "progress.ariaLabel": "Conversion progress",

    /* ---------- App menu ---------- */
    "menu.file": "File",
    "menu.openFile": "Open File…",
    "menu.quit": "Quit",
    "menu.help": "Help",
    "menu.about": "About",
  },
};

/** 当前语言(模块级状态;默认 zh,setLanguage 更新)。 */
let current: Language = "zh";

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
}

/**
 * 取当前语言文案;缺失 key 回退返回 key 本身(不抛错)。
 * 参数插值:模板 ${name} 占位,params 提供同名值;缺失参数保留占位符原样。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = DICT[current][key] ?? key;
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * 应用静态文案(仅 renderer 调用;main 进程 import 本模块不触碰 DOM):
 * - [data-i18n] → textContent(含 <title>/<option> 等)
 * - [data-i18n-placeholder] → placeholder 属性
 * - [data-i18n-title] → title 属性
 * - [data-i18n-aria-label] → aria-label 属性
 * 同时同步 <html lang>。语言切换后须再次调用。
 */
export function applyStaticTexts(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel ?? ""));
  });
}