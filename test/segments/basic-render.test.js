/**
 * 基础渲染段:全要素中英混排样例 → docx + pdf。
 * 来源:scripts/g1-verify.mjs 全文(样例 md 原样保留;图片引用改为 FIXTURES_DIR 下
 * g1-tiny.png,imageResolver 基准目录用 FIXTURES_DIR;原无断言,补 buffer/表格/粗体断言)。
 * 补充断言(中优先级缺口):代码块 docx 序列化(Consolas/10pt/逐行 w:br/不做行内解析)、
 * 代码块 pdf hljs 高亮(language-ts 围栏 + token 类 span)、引用块(左缩进 720 + 灰底
 * F2F2F2)、列表(w:numPr + numbering.xml bullet/decimal)、表格表头加粗(w:b/w:bCs)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdown } from "../../dist/core/parse.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { convert } from "../../dist/core/convert.js";
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

/**
 * 定位文本所在段落属性:取该文本 w:t 之前最近一个 <w:pPr> 到其 </w:pPr> 的片段
 * (列表/引用/代码块的序列化事实:段属性在文本 run 之前,前一段属性已闭合)。
 */
function paragraphProps(xml, text) {
  const idx = xml.indexOf(`<w:t xml:space="preserve">${text}</w:t>`);
  if (idx === -1) throw new Error(`basic-render 断言失败:document.xml 缺少文本「${text}」`);
  const start = xml.lastIndexOf("<w:pPr>", idx);
  const end = xml.indexOf("</w:pPr>", start);
  if (start === -1 || end === -1) {
    throw new Error(`basic-render 断言失败:文本「${text}」前未找到段落属性(<w:pPr>)`);
  }
  return xml.slice(start, end);
}

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

  // ---------- 补充断言:代码块 / 引用块 / 列表 / 表格表头(实现 src/core/docx/render.ts) ----------
  // 代码块(renderCode):单段落,每行一个 TextRun(字体 CODE_FONT=Consolas、字号 CODE_SIZE=20
  // half-points=10pt → w:sz/w:szCs val="20"),行间 <w:br/> run;内容原样(不做行内解析)。
  const codeRun =
    '<w:rPr><w:rFonts w:ascii="Consolas" w:cs="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas"/>' +
    '<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>' +
    '<w:t xml:space="preserve">function hello(name: string): string {</w:t>';
  if (!documentXml.includes(codeRun)) {
    throw new Error("basic-render 断言失败:代码块首行 run 缺少 Consolas + w:sz val=20(10pt)");
  }
  // 不做行内解析:模板字符串 `Hello, ${name}` 逐字出现在单个 w:t 内(无行内样式拆分)
  if (!documentXml.includes('<w:t xml:space="preserve">  return `Hello, ${name}`;</w:t>')) {
    throw new Error("basic-render 断言失败:代码块未原样输出模板字符串(疑似做了行内解析)");
  }
  if (!documentXml.includes('<w:t xml:space="preserve">}</w:t>')) {
    throw new Error("basic-render 断言失败:代码块缺少末行(})");
  }
  // 3 行代码 → 2 个行间换行 run(renderCode lines.forEach 每非末行追加 break run)
  if ((documentXml.match(/<w:br\/>/g) || []).length !== 2) {
    throw new Error("basic-render 断言失败:代码块换行 run(<w:br/>)数量 != 2(3 行 2 断)");
  }
  // 代码块段落左缩进 360 twips(renderCode indent: { left: 360 })
  if (!paragraphProps(documentXml, "function hello(name: string): string {").includes('<w:ind w:left="360"/>')) {
    throw new Error('basic-render 断言失败:代码块段落缺少 w:ind w:left="360"');
  }
  console.log("[ok] basic-render:代码块 docx 序列化(Consolas/10pt/逐行 w:br/原样输出)断言通过");

  // 引用块(renderBlockquote):indent left 720 + shading fill F2F2F2(type clear)
  const quotePPr = paragraphProps(documentXml, "这是引用块内容,Quote with mixed 中文。");
  if (!quotePPr.includes('<w:shd w:fill="F2F2F2" w:val="clear"/>')) {
    throw new Error('basic-render 断言失败:引用块段落缺少灰底(<w:shd w:fill="F2F2F2" w:val="clear"/>)');
  }
  if (!quotePPr.includes('<w:ind w:left="720"/>')) {
    throw new Error('basic-render 断言失败:引用块段落缺少左缩进(<w:ind w:left="720"/>)');
  }
  console.log("[ok] basic-render:引用块 docx 序列化(左缩进 720 + 灰底 F2F2F2)断言通过");

  // 列表(renderList):无序/有序分别挂 numbering(reference md-list-bullet/md-list-number,
  // level = min(listLevel,3));docx 库序列化为 w:numPr 引用 numbering.xml 的抽象编号。
  // 文本前最近一个 pPr 即本列表项段落属性(w:pStyle ListParagraph + w:numPr)
  const listCases = [
    ["无序项目一 Apple", 0], // 无序顶层
    ["嵌套子项 1", 1], // 无序二级
    ["三级嵌套 deep nest", 2], // 无序三级
    ["有序第一步", 0], // 有序顶层
    ["有序嵌套 a", 1], // 有序二级
  ];
  for (const [text, level] of listCases) {
    const pPr = paragraphProps(documentXml, text);
    if (!pPr.includes("<w:numPr>")) throw new Error(`basic-render 断言失败:列表项「${text}」缺少 w:numPr`);
    if (!pPr.includes(`<w:ilvl w:val="${level}"/>`)) {
      throw new Error(`basic-render 断言失败:列表项「${text}」期望 w:ilvl val="${level}"`);
    }
  }
  const numberingXml = unzipPart(buffer, "word/numbering.xml");
  // 无序列表:bullet 项目符号 •(numberingOptions bulletText[0],序列化 w:lvlText w:val="•")
  if (!numberingXml.includes('<w:numFmt w:val="bullet"/>') || !numberingXml.includes('<w:lvlText w:val="•"/>')) {
    throw new Error('basic-render 断言失败:numbering.xml 缺少无序列表(bullet + lvlText "•")');
  }
  // 有序列表:decimal 序号 %1.(numberingOptions text: `%${level+1}.` → w:lvlText w:val="%1.")
  if (!numberingXml.includes('<w:numFmt w:val="decimal"/>') || !numberingXml.includes('<w:lvlText w:val="%1."/>')) {
    throw new Error('basic-render 断言失败:numbering.xml 缺少有序列表(decimal + lvlText "%1.")');
  }
  console.log("[ok] basic-render:列表 docx 序列化(w:numPr/ilvl 层级 + numbering.xml bullet/decimal)断言通过");

  // 表格表头(renderTable rowIndex===0 传 style { bold: true } → run 级 <w:b/><w:bCs/>;
  // 数据行无样式,run 无 rPr)
  for (const head of ["功能", "状态", "说明"]) {
    if (!documentXml.includes(`<w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${head}</w:t>`)) {
      throw new Error(`basic-render 断言失败:表格表头「${head}」run 缺少加粗(<w:b/><w:bCs/>)`);
    }
  }
  if (documentXml.includes('<w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">标题渲染</w:t>')) {
    throw new Error("basic-render 断言失败:表格数据行「标题渲染」不应加粗(仅表头行加粗)");
  }
  console.log("[ok] basic-render:表格表头加粗(w:b/w:bCs,仅首行)断言通过");

  // 缺失图片警告(convert 层 collectMissingImageWarnings,dist/core/convert.ts):
  // 遍历 mdast 的 image 节点,本地路径 stat 失败 → warnings 追加「缺少图片文件: <src>」
  // (文案带源文件名;http/data: 跳过)。样例引用不存在的 missing-img.png(无 fixture,
  // 与 toc-caption 段 missing-fig.png 同做法,fixtures 仅 g1-tiny.png 与 manual/)。
  const missingWarnings = [];
  await convert("![缺图](missing-img.png)", "docx", {
    baseDir: FIXTURES_DIR,
    warnings: missingWarnings,
  });
  const missingWarnOk = missingWarnings.some(
    (w) => w.includes("缺少图片文件:") && w.includes("missing-img.png"),
  );
  if (!missingWarnOk) {
    throw new Error("basic-render 断言失败:warnings 缺少「缺少图片文件: missing-img.png」");
  }
  console.log("[ok] basic-render:缺失图片警告(warnings 含「缺少图片文件:」与文件名)断言通过");

  // ---------- 补充断言:代码块 pdf hljs 高亮(实现 src/core/pdf/render.ts highlight) ----------
  // ```ts 围栏 → <pre class="hljs"><code class="language-ts"> + hljs.highlight(value) 的
  // token 类 span(hljs 11.x:keyword/title function_/params/attr/built_in/string/subst)
  const pdfArtifact = await convert(markdown, "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  const pdfChecks = [
    ['<pre class="hljs"><code class="language-ts">', "language-ts 围栏"],
    ['<span class="hljs-keyword">function</span>', "hljs-keyword"],
    ['<span class="hljs-title function_">hello</span>', "hljs-title function_"],
    ['<span class="hljs-built_in">string</span>', "hljs-built_in"],
    ['<span class="hljs-subst">${name}</span>', "hljs-subst 模板插值"],
    ["</code></pre>", "hljs 收尾"],
  ];
  for (const [needle, label] of pdfChecks) {
    if (!pdfArtifact.html.includes(needle)) {
      throw new Error(`basic-render 断言失败:PDF 代码高亮缺少 ${label}`);
    }
  }
  console.log("[ok] basic-render:代码块 pdf 高亮(language-ts 围栏 + hljs token 类 span)断言通过");

  await saveArtifact("basic-render", { docx: buffer });
}
