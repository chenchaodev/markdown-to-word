// G1 验证脚本:全要素中英混排样例 → docx
// 运行:node scripts/g1-verify.mjs (需先 npm run build)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../dist/core/parse.js";
import { renderDocx } from "../dist/core/docx/render.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output");

// 1x1 红色 PNG,写入临时图片供样例引用
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const markdown = `# G1 验证文档 中文标题

这是第一段,包含中文与 English mixed text,还有 **粗体内容** 和 *斜体内容*,以及 \`inline code\`。

## 二级标题 列表测试

- 无序项目一 Apple
- 无序项目二 香蕉
  - 嵌套子项 1
  - 嵌套子项 2
    - 三级嵌套 deep nest
- 回到一级

1. 有序第一步
2. 有序第二步
   1. 有序嵌套 a
   2. 有序嵌套 b

## 表格测试

| 功能 | 状态 | 说明 |
| ---- | ---- | ---- |
| 标题渲染 | 完成 | 支持 1-6 级 |
| 表格 | 完成 | GFM 表格 |
| 中文 | 正常 | 微软雅黑 |

## 代码块

\`\`\`ts
function hello(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

## 引用与删除线

> 这是引用块内容,Quote with mixed 中文。

这是 ~~删除线文字~~ 和 [链接到 GitHub](https://github.com)。

## 图片与分割线

![测试图片](./g1-tiny.png)

---

文档结尾 End of document。
`;

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "g1-tiny.png"), TINY_PNG);

const ast = parseMarkdown(markdown);
const buffer = await renderDocx(ast, {
  imageResolver: async (src) => {
    if (src.startsWith("http://") || src.startsWith("https://")) return null;
    const p = path.resolve(outDir, src);
    try {
      return await fs.readFile(p);
    } catch {
      return null;
    }
  },
});

const outPath = path.join(outDir, "g1-sample.docx");
await fs.writeFile(outPath, buffer);
console.log(`OK: ${outPath} (${buffer.length} bytes)`);
