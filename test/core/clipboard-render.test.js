// @ts-check
/**
 * 剪贴板片段渲染段:REQ-254 的形态硬约束。
 *
 * 本段只断言**可机械判定**的形态(不替代 Word / WPS 实测):
 * - 全内联 style、无 `<style>`、无 `file://`、无 `width:100%`;
 * - 标题/题注编号已物化为字面文本(不依赖 CSS counter);
 * - 代码块/引用块是单格表格承载(底色/边框只挂 td),表格宽为固定 pt;
 * - 图片一律 data URI,失败降级为灰色占位 + 警告(不静默丢图);
 * - 公式降级为 TeX 源码、内部锚点降级为纯文本、裸 HTML 一律转义。
 *
 * 保真形态的来源见 docs/evidence/20261019-185151-剪贴板保真spike两轮结果.md。
 */
import { renderClipboardFragment } from "../../dist/core/clipboard/render-fragment.js";
import { createCaseSuite } from "../harness/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** 1×1 透明 PNG:足够通过魔数嗅探,不依赖任何夹具文件 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 渲染一次的默认选项:路径边界 identity,图片解析由各 case 注入
 * @param {string} md
 * @param {Partial<import("../../dist/core/clipboard/render-fragment.js").RenderClipboardOptions>} [overrides]
 */
async function render(md, overrides = {}) {
  /** @type {import("../../dist/core/i18n/index.js").ConvertWarning[]} */
  const warnings = [];
  const fragment = await renderClipboardFragment(md, {
    baseDir: process.cwd(),
    realpathSync: (candidate) => candidate,
    warnings,
    ...overrides,
  });
  return { ...fragment, warnings };
}

export async function run() {
  const suite = createCaseSuite();

  await suite.case("无 style 标签 / 无 file:// / 无百分比表格宽", async () => {
    const { html } = await render(
      "# 标题\n\n正文\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    /** @type {Array<[string, RegExp]>} */
    const forbidden = [
      ["<style> 标签", /<style[\s>]/i],
      ["file:// 引用", /file:\/\//i],
      ["width:100%", /width\s*:\s*100%/i],
    ];
    for (const [label, re] of forbidden) {
      if (re.test(html)) throw new Error(`片段不应出现${label}`);
    }
    if (!/mso-table-layout-alt\s*:\s*fixed/i.test(html)) {
      throw new Error("表格缺少 mso-table-layout-alt:fixed(Word 会按内容 AutoFit)");
    }
    if (!/mso-fareast-font-family/i.test(html)) {
      throw new Error("缺少 mso-fareast-font-family,中文会回落到 Word 默认中文字体");
    }
  });

  await suite.case("标题编号与题注编号已物化为字面文本", async () => {
    // 题注识别要求前面有被引用的图/表(caption.ts 的口径),故先放一张表
    const { html } = await render(
      "# 一级\n\n## 二级\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n图: 说明文字\n",
    );
    if (!/<h1[^>]*>\s*1\s/.test(html)) throw new Error("h1 未写入字面编号 1");
    if (!/<h2[^>]*>\s*1\.1\s/.test(html)) throw new Error("h2 未写入字面编号 1.1");
    if (!/图\s*1\.1/.test(html)) throw new Error("题注未写入字面编号(图 1.1)");
    if (/counter\(/.test(html) || /::before/.test(html)) {
      throw new Error("片段不得依赖 CSS counter / ::before");
    }
  });

  await suite.case("代码块与引用块由单格表格承载,边框只在 td 上", async () => {
    const { html } = await render("```js\nconst a = 1;\n```\n\n> 引用一段\n");
    if (!/border-left\s*:\s*4pt solid/.test(html)) {
      throw new Error("代码块缺少 td 左边框(4pt)");
    }
    if (!/border-left\s*:\s*3pt solid/.test(html)) {
      throw new Error("引用块缺少 td 左边框(3pt)");
    }
    if (/<pre[^>]*background/i.test(html)) {
      throw new Error("代码块的底色不得挂在 pre 上(Word 会丢弃)");
    }
    if (!/white-space\s*:\s*pre-wrap/.test(html)) {
      throw new Error("代码块缺少 white-space:pre-wrap");
    }
  });

  await suite.case("图片经注入 resolver 转为 data URI", async () => {
    const { html, warnings } = await render("![示意](pic.png)\n", {
      imageResolver: async () => TINY_PNG,
    });
    if (!/src="data:image\/png;base64,/.test(html)) {
      throw new Error("本地图片未转成 data URI");
    }
    if (warnings.length !== 0) throw new Error(`成功路径不应产生警告,实际 ${warnings.length} 条`);
  });

  await suite.case("图片失败降级为灰色占位并留警告(不静默丢图)", async () => {
    const { html, warnings } = await render("![示意图](missing.png)\n", {
      imageResolver: async () => null,
    });
    if (!/\[图片缺失:\s*示意图\]/.test(html)) {
      throw new Error("失败图片未输出占位文本");
    }
    if (/file:\/\//i.test(html)) throw new Error("失败路径不得回退 file://");
    if (warnings.length === 0) throw new Error("图片失败必须至少产生一条警告");
  });

  await suite.case("公式降级为 TeX 源码,不输出 KaTeX class 树", async () => {
    const { html } = await render("行内 $a^2+b^2$ 与块级:\n\n$$\nE = mc^2\n$$\n");
    if (!/a\^2\+b\^2/.test(html)) throw new Error("行内公式未保留 TeX 源码");
    if (!/E = mc\^2/.test(html)) throw new Error("块级公式未保留 TeX 源码");
    if (/class="katex/.test(html)) throw new Error("不得输出 KaTeX DOM(class 树在粘贴后失真)");
  });

  await suite.case("内部锚点降级为纯文本", async () => {
    const { html } = await render("见 [第三章](#sec:chapter3)。\n");
    if (/href="#/.test(html)) throw new Error("内部锚点在粘贴后必然失效,不得输出 href=\"#...\"");
    if (!/第三章/.test(html)) throw new Error("降级后应保留链接文本");
  });

  await suite.case("裸 HTML 一律转义", async () => {
    const { html } = await render("<script>alert(1)</script>\n\n正文\n");
    if (/<script/i.test(html)) throw new Error("裸 HTML 未转义");
    if (!/&lt;script&gt;/.test(html)) throw new Error("转义后应保留可见文本");
  });

  await suite.case("page-break 转为 Word 认的分页属性", async () => {
    const { html } = await render("第一页\n\n<!-- page-break -->\n\n第二页\n");
    if (!/page-break-before\s*:\s*always/i.test(html)) {
      throw new Error("page-break 未转成 page-break-before:always");
    }
  });

  await suite.case("纯文本回退保留段落边界", async () => {
    const { text } = await render("# 标题\n\n第一段\n\n第二段\n\n- 项目\n");
    if (!text.includes("标题") || !text.includes("第一段") || !text.includes("第二段")) {
      throw new Error("纯文本回退丢失正文内容");
    }
    if (!/\n/.test(text)) throw new Error("纯文本回退未保留换行");
  });

  return { cases: suite.results };
}
