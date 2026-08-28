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
}
