// @ts-check
import { cleanupMarkdown } from "../../dist/core/markdown/ai-cleanup.js";

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
}
