// @ts-check
/**
 * 剪贴板样板块与辅助模块段:直接到达 `core/clipboard/{styles,blocks,html-text}` 与
 * `core/markdown/{markdown-it-factory,task-list,caption-numbering}`。
 *
 * 与 `clipboard-render.test.js` 的分工:那一段测**拼接后的片段形态**(无 style 标签、
 * 编号物化、表格承载等);本段测**构成片段的零件**本身 —— 版心 pt 换算、内联样式串、
 * 单格表格开闭标签、列宽分配、纯文本回退、共享 markdown-it 工厂、任务列表替换、
 * 题注编号文本。零件判红时不必从整段 HTML 反推是哪一件坏了。
 */
import {
  bodyFontDeclarations,
  contentWidthPt,
  paragraphStyle,
} from "../../dist/core/clipboard/styles.js";
import {
  blockquoteOpen,
  codeBlockTable,
  resolveColumnWidths,
  tableOpen,
} from "../../dist/core/clipboard/blocks.js";
import { htmlToPlainText } from "../../dist/core/clipboard/html-text.js";
import { createBaseMarkdownIt } from "../../dist/core/markdown/markdown-it-factory.js";
import { replaceTaskCheckboxes } from "../../dist/core/markdown/task-list.js";
import {
  bumpCaptionCounter,
  captionNumberText,
  createCaptionCounters,
} from "../../dist/core/markdown/caption-numbering.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import { DEFAULT_PAGE_SETUP } from "../../dist/core/settings/settings-defaults.js";
import { createCaseSuite } from "../harness/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();

  await suite.case("版心宽按 mm→pt 换算且落在纸张范围内", () => {
    const width = contentWidthPt(DEFAULT_PAGE_SETUP);
    // A4 宽 595pt;任何合法页边距下内容区都应小于纸宽、大于半页
    if (!(width > 250 && width < 595)) {
      throw new Error(`版心宽换算异常:${width}pt`);
    }
  });

  await suite.case("正文段落样式含首行缩进,列表内取消缩进", () => {
    const normal = paragraphStyle(DEFAULT_TYPOGRAPHY, false);
    const inList = paragraphStyle(DEFAULT_TYPOGRAPHY, true);
    if (!/text-indent\s*:\s*24pt/.test(normal)) {
      throw new Error(`首行缩进应为 2 × 12pt = 24pt,实际:${normal}`);
    }
    if (/text-indent/.test(inList)) {
      throw new Error("列表内段落不应带首行缩进");
    }
  });

  await suite.case("字体声明同时给中文 eastAsia 槽", () => {
    const decl = bodyFontDeclarations(DEFAULT_TYPOGRAPHY);
    if (!/font-family\s*:/.test(decl) || !/mso-fareast-font-family\s*:/.test(decl)) {
      throw new Error(`字体声明缺少 font-family 或 mso-fareast-font-family:${decl}`);
    }
  });

  await suite.case("代码块为单格表格承载且保留前导空格", () => {
    const html = codeBlockTable("line1\n  indented", 414, DEFAULT_TYPOGRAPHY);
    /** @type {Array<[string, RegExp]>} */
    const required = [
      ["table", /<table[^>]*border="0"/],
      ["单格 td", /<td[^>]*>/],
      ["td 左边框", /border-left\s*:\s*4pt/],
      ["换行", /<br>/],
      ["前导空格", /\s{2}indented/],
    ];
    for (const [label, re] of required) {
      if (!re.test(html)) throw new Error(`代码块缺少${label}`);
    }
  });

  await suite.case("引用块左边框挂在 td 上", () => {
    const html = blockquoteOpen(414, DEFAULT_TYPOGRAPHY);
    if (!/<td[^>]*border-left\s*:\s*3pt/.test(html)) {
      throw new Error(`引用块左边框未挂在 td 上:${html}`);
    }
  });

  await suite.case("表格宽度为固定 pt 且带 Word AutoFit 关闭属性", () => {
    const html = tableOpen(414);
    if (!/width\s*:\s*414pt/.test(html)) throw new Error(`表宽不是 414pt:${html}`);
    if (!/mso-table-layout-alt\s*:\s*fixed/.test(html)) {
      throw new Error("缺少 mso-table-layout-alt:fixed(Word 会按内容 AutoFit)");
    }
    if (/width\s*:\s*100%/.test(html)) throw new Error("不得使用 width:100%");
  });

  await suite.case("列宽分配总和等于内容区宽", () => {
    const widths = resolveColumnWidths(3, null, 414);
    if (widths.length !== 3) throw new Error(`列数应为 3,实际 ${widths.length}`);
    const sum = widths.reduce((acc, value) => acc + value, 0);
    if (Math.abs(sum - 414) > 0.01) throw new Error(`列宽总和 ${sum} ≠ 414`);
    if (widths.some((value) => value <= 0)) throw new Error(`列宽不得为 0:${widths.join(",")}`);
  });

  await suite.case("纯文本回退保留块边界", () => {
    const text = htmlToPlainText("<p>第一段</p><p>第二段</p>");
    if (!text.includes("第一段") || !text.includes("第二段")) {
      throw new Error(`纯文本丢失内容:${text}`);
    }
    if (!/\n/.test(text)) throw new Error(`纯文本未保留段落换行:${text}`);
  });

  await suite.case("共享 markdown-it 工厂可渲染基础语法", () => {
    const html = createBaseMarkdownIt().render("**粗体**");
    if (!/<strong>粗体<\/strong>/.test(html)) throw new Error(`工厂渲染异常:${html}`);
  });

  await suite.case("任务列表 checkbox 转字符并解包 label", () => {
    const checked =
      '<input type="checkbox" class="task-list-item-checkbox" checked="checked" disabled="disabled">' +
      '<label class="task-list-item-label" for="task-item-0"> 已完成</label>';
    const unchecked =
      '<input type="checkbox" class="task-list-item-checkbox" disabled="disabled">' +
      '<label class="task-list-item-label" for="task-item-1"> 未完成</label>';
    const checkedOut = replaceTaskCheckboxes(checked);
    const uncheckedOut = replaceTaskCheckboxes(unchecked);
    if (!checkedOut.includes("☑")) throw new Error("选中项未转为 ☑");
    if (!uncheckedOut.includes("☐")) throw new Error("未选中项未转为 ☐");
    if (/<input|<label/.test(checkedOut + uncheckedOut)) {
      throw new Error("checkbox / label 结构未清理干净");
    }
  });

  await suite.case("题注编号:有 h1 带章节号,无 h1 只留序数", () => {
    const counters = createCaptionCounters();
    const first = bumpCaptionCounter(counters, "fig");
    const second = bumpCaptionCounter(counters, "fig");
    if (first !== 1 || second !== 2) throw new Error("题注序数未按类型独立递增");
    const withChapter = captionNumberText("fig", second, {
      headingNumbering: true,
      hasH1: true,
      chapterNumber: 3,
    });
    if (withChapter !== "图 3.2") throw new Error(`章节号拼接异常:${withChapter}`);
    const withoutChapter = captionNumberText("tab", 5, {
      headingNumbering: true,
      hasH1: false,
      chapterNumber: 0,
    });
    if (withoutChapter !== "表 5") throw new Error(`无 h1 时不应带章节号:${withoutChapter}`);
  });

  return { cases: suite.results };
}
