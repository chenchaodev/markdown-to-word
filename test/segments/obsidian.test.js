// @ts-check
import { normalizeObsidian } from "../../dist/core/markdown/obsidian.js";

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // 普通双链
  const a = normalizeObsidian("见 [[笔记一]]");
  if (a !== "见 [笔记一](笔记一.md)") throw new Error(`双链转换失败: ${JSON.stringify(a)}`);
  console.log("[ok] obsidian: 普通双链");

  // 带别名
  const b = normalizeObsidian("见 [[笔记一|别名]]");
  if (b !== "见 [别名](笔记一.md)") throw new Error(`双链别名失败: ${JSON.stringify(b)}`);
  console.log("[ok] obsidian: 双链别名");

  // 带锚点
  const c = normalizeObsidian("见 [[笔记一#章节]]");
  if (c !== "见 [笔记一](笔记一.md#章节)") throw new Error(`双链锚点失败: ${JSON.stringify(c)}`);
  console.log("[ok] obsidian: 双链锚点");

  // 图片嵌入 + 附件文件夹
  const d = normalizeObsidian("![[图1.png]]", { attachmentFolder: "Attachments" });
  if (d !== "![图1](Attachments/图1.png)") throw new Error(`图片嵌入失败: ${JSON.stringify(d)}`);
  console.log("[ok] obsidian: 图片嵌入 + 附件文件夹");

  // 笔记嵌入 → 链接
  const e = normalizeObsidian("![[笔记一]]");
  if (e !== "[笔记一](笔记一.md)") throw new Error(`笔记嵌入失败: ${JSON.stringify(e)}`);
  console.log("[ok] obsidian: 笔记嵌入");

  // 空附件文件夹时不加前缀
  const f = normalizeObsidian("![[图1.png]]", { attachmentFolder: "" });
  if (f !== "![图1](图1.png)") throw new Error(`空附件文件夹失败: ${JSON.stringify(f)}`);
  console.log("[ok] obsidian: 空附件文件夹");

  // fenced code:反引号/波浪号及 info string 内均不改写
  for (const source of [
    "```md\n[[代码笔记]]\n![[图.png]]\n```",
    "~~~obsidian meta\n[[代码笔记]]\n![[图.png]]\n~~~",
  ]) {
    if (normalizeObsidian(source) !== source) {
      throw new Error(`fenced code 被误改: ${JSON.stringify(source)}`);
    }
  }
  console.log("[ok] obsidian: fenced code/info string 跳过");

  // inline code:支持单/多反引号，只改写代码外双链
  const inline = normalizeObsidian("外 [[外链]] `内 [[代码]]` ``多 [[代码]]``");
  if (inline !== "外 [外链](外链.md) `内 [[代码]]` ``多 [[代码]]``") {
    throw new Error(`inline code 边界失败: ${JSON.stringify(inline)}`);
  }
  console.log("[ok] obsidian: inline code 跳过");

  // HTML code:code/pre 的完整内容视为代码；普通 HTML 标签外的双链仍改写
  const htmlInline = normalizeObsidian("前 [[外链]] <code>内 [[代码]]</code> 后 [[尾链]]");
  if (htmlInline !== "前 [外链](外链.md) <code>内 [[代码]]</code> 后 [尾链](尾链.md)") {
    throw new Error(`HTML inline code 边界失败: ${JSON.stringify(htmlInline)}`);
  }
  const htmlBlock = "前 [[外链]]\n<pre>\n内 [[代码]]\n![[图.png]]\n</pre>\n后 [[尾链]]";
  if (normalizeObsidian(htmlBlock) !== "前 [外链](外链.md)\n<pre>\n内 [[代码]]\n![[图.png]]\n</pre>\n后 [尾链](尾链.md)") {
    throw new Error(`HTML block code 边界失败: ${JSON.stringify(normalizeObsidian(htmlBlock))}`);
  }
  console.log("[ok] obsidian: HTML code 跳过");

  // escaped 双链保持 Markdown 字面量；CRLF/CR 与无目标输入也不发生额外改写
  for (const source of [
    String.raw`\[\[不应改写\]\] 与 [[应改写]]`,
    "```\r\n[[代码]]\r\n```\r\n正文",
    "~~~\r[[代码]]\r~~~",
    "无目标文本",
  ]) {
    const expected = source === String.raw`\[\[不应改写\]\] 与 [[应改写]]`
      ? String.raw`\[\[不应改写\]\] 与 [应改写](应改写.md)`
      : source;
    const actual = normalizeObsidian(source);
    if (actual !== expected) {
      throw new Error(`Obsidian 跳过边界失败: ${JSON.stringify({ source, expected, actual })}`);
    }
  }
  console.log("[ok] obsidian: escaped 文本/CRLF/CR/无目标输入保持或仅改写目标");
}
