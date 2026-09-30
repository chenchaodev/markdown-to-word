// @ts-check
import { cleanupMarkdown } from "../../dist/core/markdown/ai-cleanup.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 断言实际值与期望值一致。
 * @param {string} actual
 * @param {string} expected
 * @param {string} label
 */
function expectEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}:${JSON.stringify({ expected, actual })}`);
  }
}

/**
 * 只开指定规则、关掉其余全部：用于断言单条规则的净效果。
 * @param {string} source
 * @param {{stripCitationMarkers?: boolean, stripEmoji?: boolean, fixHeadingLevels?: boolean}} on
 */
function cleanupOnly(source, on) {
  return cleanupMarkdown(source, {
    normalizeQuotes: false,
    fixListMarkers: false,
    trimBlankLines: false,
    stripCitationMarkers: false,
    stripEmoji: false,
    fixHeadingLevels: false,
    ...on,
  });
}

export async function run() {
  // 智能引号归一（' ' " " → ' "）
  const q = cleanupMarkdown("他说\u2018你好\u2019和\u201C世界\u201D");
  if (q !== "他说'你好'和\"世界\"") throw new Error(`智能引号未归一: ${JSON.stringify(q)}`);
  console.log("[ok] ai-cleanup: 智能引号归一");

  // en dash → em dash
  const d = cleanupMarkdown("范围 1\u201310");
  if (d !== "范围 1\u201410") throw new Error(`en dash 未归一: ${JSON.stringify(d)}`);
  console.log("[ok] ai-cleanup: en dash → em dash");

  // 列表标记补空格
  const l = cleanupMarkdown("-item\n*item\n+item");
  if (l !== "- item\n* item\n+ item") throw new Error(`列表标记未补空格: ${JSON.stringify(l)}`);
  console.log("[ok] ai-cleanup: 列表标记补空格");

  // -3 不被误判为列表
  const neg = cleanupMarkdown("-3 degrees");
  if (neg !== "-3 degrees") throw new Error(`-3 被误改: ${JSON.stringify(neg)}`);
  console.log("[ok] ai-cleanup: -3 不被误判");

  // 折叠多余空行 + 去行尾空白
  const b = cleanupMarkdown("a   \n\n\n\nb");
  if (b !== "a\n\nb") throw new Error(`空行折叠失败: ${JSON.stringify(b)}`);
  console.log("[ok] ai-cleanup: 空行折叠 + 去行尾空白");

  // 代码围栏内不规整
  const code = cleanupMarkdown("```\n他说\u2018你好\u2019\n```");
  if (code !== "```\n他说\u2018你好\u2019\n```") throw new Error(`代码围栏被误改: ${JSON.stringify(code)}`);
  console.log("[ok] ai-cleanup: 代码围栏内跳过");

  // frontmatter 保留且正文规整
  const fm = cleanupMarkdown("---\ntitle: 测试\n---\n# 标题\n内容\u2018引号\u2019");
  if (!fm.startsWith("---\ntitle: 测试\n---\n")) throw new Error(`frontmatter 被破坏: ${JSON.stringify(fm)}`);
  if (!fm.includes("内容'引号'")) throw new Error(`frontmatter 后正文未规整: ${JSON.stringify(fm)}`);
  console.log("[ok] ai-cleanup: frontmatter 保留且正文规整");

  // 所有规则关闭:必须逐字节保持输入(包括 CRLF/CR、行尾空白与转义)
  for (const source of [
    "正文‘引号’–dash\r\n- item   \r\n",
    "正文‘引号’–dash\r- item   \r",
  ]) {
    const unchanged = cleanupMarkdown(source, {
      normalizeQuotes: false,
      fixListMarkers: false,
      trimBlankLines: false,
      stripCitationMarkers: false,
      stripEmoji: false,
      fixHeadingLevels: false,
    });
    if (unchanged !== source) {
      throw new Error(`AI 清理规则全关时输入发生变化:${JSON.stringify({ source, unchanged })}`);
    }
  }
  console.log("[ok] ai-cleanup: 规则全关时输入字节级不变");

  // fenced code:反引号/波浪号、info string 与代码内空行均原样保留
  for (const source of [
    "```js\nconst s = '说–';\n\n\nconst t = 1;\n```",
    "~~~ markdown meta\n正文‘不处理’\n\n行尾空白不应被删  \n~~~",
  ]) {
    if (cleanupMarkdown(source) !== source) {
      throw new Error(`fenced code 被误改:${JSON.stringify(source)}`);
    }
  }
  console.log("[ok] ai-cleanup: fenced code/info string/代码内空行跳过");

  // inline code 与 HTML code:仅代码片段原样，代码外仍执行清理
  const inline = cleanupMarkdown("外‘前’ `内‘码’–尾` 外‘后’–");
  if (inline !== "外'前' `内‘码’–尾` 外'后'—") {
    throw new Error(`inline code 边界错误:${JSON.stringify(inline)}`);
  }
  const htmlInline = cleanupMarkdown("外‘前’<code>内‘码’–尾</code>外‘后’–");
  if (htmlInline !== "外'前'<code>内‘码’–尾</code>外'后'—") {
    throw new Error(`HTML inline code 边界错误:${JSON.stringify(htmlInline)}`);
  }
  const htmlBlock = "外‘前’\n<pre>\n内‘码’–尾  \n\n\n</pre>\n外‘后’–";
  const cleanedHtmlBlock = cleanupMarkdown(htmlBlock);
  if (cleanedHtmlBlock !== "外'前'\n<pre>\n内‘码’–尾  \n\n\n</pre>\n外'后'—") {
    throw new Error(`HTML block code 边界错误:${JSON.stringify(cleanedHtmlBlock)}`);
  }
  console.log("[ok] ai-cleanup: inline code/HTML code 位置感知跳过");

  // escaped 文本:转义列表标记不得被补空格
  if (cleanupMarkdown("\\-item 与正常-item") !== "\\-item 与正常-item") {
    throw new Error(`escaped 文本被误改:${JSON.stringify(cleanupMarkdown("\\-item 与正常-item"))}`);
  }
  console.log("[ok] ai-cleanup: escaped 文本跳过");

  // 正式 frontmatter 契约:LF/CRLF/CR 均原样保留；未知 key 块按普通正文处理
  for (const eol of ["\n", "\r\n", "\r"]) {
    const frontmatter = ["---", "title:  原样标题  ", "---"].join(eol);
    const result = cleanupMarkdown(`${frontmatter}${eol}${eol}正文‘引号’–`);
    if (!result.startsWith(frontmatter + eol)) {
      throw new Error(`frontmatter 行尾未原样保留:${JSON.stringify({ eol, result })}`);
    }
  }
  const thematic = cleanupMarkdown("---\n这是普通‘文字’\n---\n正文‘引号’–");
  if (thematic !== "---\n这是普通'文字'\n---\n正文'引号'—") {
    throw new Error(`普通 thematic break 被误当 frontmatter:${JSON.stringify(thematic)}`);
  }
  console.log("[ok] ai-cleanup: 复用正式 frontmatter 边界且 thematic break 不误判");

  // 零改动契约同样覆盖新增三个字段:含引用标记/emoji/## 的输入在全关时逐字节不变
  for (const source of [
    "## 标题 [1]【2】\n\n正文 👨‍👩‍👧 与 [1]   \r\n",
    "正文 [1] 👋\r### 跳级标题\r",
  ]) {
    const unchanged = cleanupMarkdown(source, {
      normalizeQuotes: false,
      fixListMarkers: false,
      trimBlankLines: false,
      stripCitationMarkers: false,
      stripEmoji: false,
      fixHeadingLevels: false,
    });
    if (unchanged !== source) {
      throw new Error(`新增规则全关时输入发生变化:${JSON.stringify({ source, unchanged })}`);
    }
  }
  console.log("[ok] ai-cleanup: 新增三字段全关时输入字节级不变");

  // 新增三字段默认全开;单独关掉它们不影响原有三条规则
  const oldRulesOnly = cleanupMarkdown("## 标题 [1] 👋\n\n正文‘引号’–", {
    stripCitationMarkers: false,
    stripEmoji: false,
    fixHeadingLevels: false,
  });
  expectEq(oldRulesOnly, "## 标题 [1] 👋\n\n正文'引号'—", "只关新增三字段");
  console.log("[ok] ai-cleanup: 新增三字段单独关闭只影响自己");

  // 裸数字引用标记:各形态都清掉,并连同紧邻前置空白一起收掉
  expectEq(cleanupOnly("见此 [1]。", { stripCitationMarkers: true }), "见此。", "单条引用标记");
  expectEq(cleanupOnly("见此[1]。", { stripCitationMarkers: true }), "见此。", "无空格引用标记");
  expectEq(
    cleanupOnly("引用 [1,2] 与 [1,3-5] 和 [1, 2] 与【1】【1,2】", { stripCitationMarkers: true }),
    "引用 与 和 与",
    "多形态引用标记",
  );
  expectEq(
    cleanupOnly("| 引用 | [1] | 尾 |", { stripCitationMarkers: true }),
    "| 引用 | | 尾 |",
    "表格单元内清标记且不删坏竖线",
  );
  console.log("[ok] ai-cleanup: 裸数字引用标记清理");

  // 引用标记不得误伤的形态:脚注、链接、图片、引用式链接、链接定义、作者-年份式
  for (const source of [
    "脚注引用[^1]与脚注定义[^1]: 脚注文本",
    "[文本](https://example.com) ![图](https://example.com/a.png) [文本][ref]",
    "[1]: https://example.com\n  [2]: https://example.com",
    "(Smith, 2020)、Smith (2020)、Smith 等 (2020)",
    String.raw`\[1] 与 \![图]`,
  ]) {
    const kept = cleanupOnly(source, { stripCitationMarkers: true });
    if (kept !== source) {
      throw new Error(`引用标记误伤:${JSON.stringify({ source, kept })}`);
    }
  }
  console.log("[ok] ai-cleanup: 脚注/链接/链接定义/作者-年份式不被当引用标记");

  // 链接/图片的目标 URL 对所有规则不可见:URL 内的裸标记与 emoji 都不被改坏
  for (const source of [
    "[下载](http://a.com/[1])",
    "![图](http://a.com/[1].png)",
    "[下载](<http://a.com/[1]>)",
    "![图](<http://a.com/[1].png> \"标题\")",
    "[下载](http://a.com/😀[1]) 看 [文本](http://a.com/😀)",
  ]) {
    const kept = cleanupMarkdown(source);
    if (kept !== source) {
      throw new Error(`链接目标 URL 被误改:${JSON.stringify({ source, kept })}`);
    }
  }
  console.log("[ok] ai-cleanup: 链接/图片 destination(含 <> 与 title)不被改写");

  // 链接文本仍在保护区外:URL 受保护的同时,链接外的裸标记照旧清理
  expectEq(cleanupMarkdown("[a](x) 与 (见 [1])"), "[a](x) 与 (见)", "括号内裸标记仍清理");
  expectEq(cleanupMarkdown("[文本](url) 👋 与 [1]"), "[文本](url)  与", "链接文本不受影响");
  console.log("[ok] ai-cleanup: destination 保护区不误伤链接文本与链接外标记");

  // emoji:附属成分整体消费,不留残渣(ZWJ/肤色/旗帜/键帽/变体选择符)
  expectEq(cleanupOnly("你好 👋 世界", { stripEmoji: true }), "你好  世界", "单 emoji");
  expectEq(
    cleanupOnly("👨‍👩‍👧👩‍💻👍🏽🇨🇳1️⃣❤️", { stripEmoji: true }),
    "",
    "emoji 附属成分整体消费",
  );
  console.log("[ok] ai-cleanup: emoji 清理(含 ZWJ/肤色/旗帜/键帽)");

  // emoji 不得误伤:文本呈现符号与中英文/CJK 标点原样保留
  const keepSymbols =
    "© ® ™ ‼ ⁉ ℹ 〰 〽 ㊗ ㊙ ✓ ✔ ✗ ✘ § † ※ ♠ → ★ ☆ " +
    "中文，。！？；：（）「」【】 英文,.;:!() 数字 0123 字母 abc XYZ";
  expectEq(cleanupOnly(keepSymbols, { stripEmoji: true }), keepSymbols, "文本呈现符号保留");
  console.log("[ok] ai-cleanup: ©®™/✓§† 等文本呈现符号不被当 emoji");

  // 三条新规则的保护区:代码围栏/行内代码/HTML/frontmatter 内原样保留
  for (const { source, expected } of [
    { source: "```\n注释 [1] 👋\n```", expected: "```\n注释 [1] 👋\n```" },
    { source: "~~~\n注释 [1] 👋\n~~~", expected: "~~~\n注释 [1] 👋\n~~~" },
    { source: "行内 `[1]`👋 行内", expected: "行内 `[1]` 行内" },
    { source: "前 <code>内[1]👋</code>后", expected: "前 <code>内[1]👋</code>后" },
    { source: "前 [1]👋<code>内[1]👋</code>后 [1]👋", expected: "前<code>内[1]👋</code>后" },
    {
      source: "---\ntitle: 含 [1] 与 👋\n---\n正文 [1] 👋",
      expected: "---\ntitle: 含 [1] 与 👋\n---\n正文",
    },
  ]) {
    expectEq(cleanupMarkdown(source), expected, `保护区:${JSON.stringify(source)}`);
  }
  console.log("[ok] ai-cleanup: 新增三规则的代码围栏/行内代码/HTML/frontmatter 保护");

  // 标题层级:无 h1 整体上移一级(h1 为上限,不越界)
  expectEq(cleanupOnly("## A\n### B", { fixHeadingLevels: true }), "# A\n## B", "无 h1 上移一级");
  expectEq(cleanupOnly("#### deep", { fixHeadingLevels: true }), "### deep", "h4 上移");
  expectEq(cleanupOnly("###### only", { fixHeadingLevels: true }), "##### only", "h6 上移不越 h1 上限");
  console.log("[ok] ai-cleanup: 无 h1 时标题整体上移一级");

  // 标题层级:跳级补齐为 +1;上移与跳级同时存在时先上移再补跳级
  expectEq(cleanupOnly("# A\n### C", { fixHeadingLevels: true }), "# A\n## C", "h1→h3 补齐");
  expectEq(
    cleanupOnly("# A\n#### D\n###### F", { fixHeadingLevels: true }),
    "# A\n## D\n### F",
    "连续跳级逐级补齐",
  );
  expectEq(cleanupOnly("## A\n#### D", { fixHeadingLevels: true }), "# A\n## D", "先上移再补跳级");
  expectEq(cleanupOnly("# A\n## B", { fixHeadingLevels: true }), "# A\n## B", "已合规不改");
  expectEq(
    cleanupOnly("### A\n##### C", { fixHeadingLevels: true }),
    "## A\n### C",
    "跳级判定基于上移后的级别",
  );
  console.log("[ok] ai-cleanup: 跳级补齐为 +1");

  // 标题层级:代码围栏内的 # 注释不算标题;锚点与双链不被破坏
  expectEq(
    cleanupOnly("## 上移\n\n```py\n# 注释\n## 也是注释\n```\n\n### 二级", { fixHeadingLevels: true }),
    "# 上移\n\n```py\n# 注释\n## 也是注释\n```\n\n## 二级",
    "围栏内井号行不算标题",
  );
  expectEq(
    cleanupOnly("## 标题 {#sec:intro}\n正文见 [[笔记一]] 与 [[笔记|别名]]", { fixHeadingLevels: true }),
    "# 标题 {#sec:intro}\n正文见 [[笔记一]] 与 [[笔记|别名]]",
    "锚点与双链保留",
  );
  expectEq(
    cleanupOnly("", { fixHeadingLevels: true }),
    "",
    "空文档零改动",
  );
  expectEq(
    cleanupOnly("正文无标题", { fixHeadingLevels: true }),
    "正文无标题",
    "无标题零改动",
  );
  expectEq(
    cleanupOnly("####### 七个井号\n#无空格", { fixHeadingLevels: true }),
    "####### 七个井号\n#无空格",
    "非 ATX 标题行不动",
  );
  console.log("[ok] ai-cleanup: 围栏/锚点/双链/空文档边界");

  // 默认全开:三条新规则在真实混合稿上叠加生效,脚注与链接不受影响
  expectEq(cleanupMarkdown("## 标题 [1] 👋"), "# 标题", "三规则默认全开");
  const mixed = cleanupMarkdown(
    "# 标题\n\n见此 [1] 与 [文本](url) 与脚注[^1]。\n\n[^1]: 脚注定义\n\n```\n[1] 👋\n```\n",
  );
  for (const fragment of [
    "见此 与 [文本](url) 与脚注[^1]。",
    "[^1]: 脚注定义",
    "```\n[1] 👋\n```",
  ]) {
    if (!mixed.includes(fragment)) {
      throw new Error(`混合稿片段缺失或被误改:${JSON.stringify({ fragment, mixed })}`);
    }
  }
  console.log("[ok] ai-cleanup: 混合稿上三规则叠加且脚注/链接/围栏完好");
}
