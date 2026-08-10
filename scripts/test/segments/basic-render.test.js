/**
 * 基础渲染段:全要素中英混排样例 → docx。
 * 来源:scripts/g1-verify.mjs 全文(样例 md 原样保留;图片引用改为 FIXTURES_DIR 下
 * g1-tiny.png,imageResolver 基准目录用 FIXTURES_DIR;原无断言,补 buffer/表格/粗体断言)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdown } from "../../../dist/core/parse.js";
import { renderDocx } from "../../../dist/core/docx/render.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

// 全要素中英混排样例(md 字符串原样保留;图片引用 ./g1-tiny.png,由 imageResolver 基准到 FIXTURES_DIR)
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

export async function run() {
  const ast = parseMarkdown(markdown);
  const buffer = await renderDocx(ast, {
    imageResolver: async (src) => {
      if (src.startsWith("http://") || src.startsWith("https://")) return null;
      const p = path.resolve(FIXTURES_DIR, src);
      try {
        return await fs.readFile(p);
      } catch {
        return null;
      }
    },
  });

  // 断言 1:docx buffer 非空
  if (buffer.length === 0) {
    throw new Error("basic-render 断言失败:docx buffer 为空");
  }
  const documentXml = unzipPart(buffer, "word/document.xml");
  // 断言 2:document.xml 含表格
  if (!documentXml.includes("<w:tbl")) {
    throw new Error("basic-render 断言失败:document.xml 缺少表格(<w:tbl)");
  }
  // 断言 3:document.xml 含粗体文本
  if (!documentXml.includes("粗体内容")) {
    throw new Error("basic-render 断言失败:document.xml 缺少粗体文本(粗体内容)");
  }
  console.log("[ok] basic-render:全要素样例渲染成功,表格与粗体文本断言通过");
  await saveArtifact("basic-render", { docx: buffer });
}
