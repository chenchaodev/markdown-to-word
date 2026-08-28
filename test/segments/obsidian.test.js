import { normalizeObsidian } from "../../dist/core/markdown/obsidian.js";

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
}
