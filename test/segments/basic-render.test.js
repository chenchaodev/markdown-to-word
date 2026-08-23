/**
 * 基础渲染段:全要素中英混排样例 → docx + pdf。
 * 来源:scripts/g1-verify.mjs 全文(样例 md 原样保留;图片引用改为 FIXTURES_DIR 下
 * g1-tiny.png,imageResolver 基准目录用 FIXTURES_DIR;原无断言,补 buffer/表格/粗体断言)。
 * 补充断言(中优先级缺口):代码块 docx 序列化(hljs 高亮/Consolas/10pt/逐行 w:br)、
 * 代码块 pdf hljs 高亮(language-ts 围栏 + token 类 span)、引用块(左缩进 720 + 灰底
 * F2F2F2)、列表(w:numPr + numbering.xml bullet/decimal)、表格表头加粗(w:b/w:bCs)。
 * 图片尺寸(R4:H3 行为修复):1×1 小图不放大(9525 EMU)、800×400 大图等比缩到 400 宽
 * (3810000×1905000 EMU)、webp 降级为占位文本 + 警告(独立转换,不污染主样例)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdown } from "../../dist/core/parse.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { convert } from "../../dist/core/convert.js";
import hljs from "highlight.js/lib/common";
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

![大图](./img-800x400.png)

---

文档结尾 End of document。
`;

// 主样例导出(gen-fixtures 落盘为 acceptance/basic-render.md;样例内 ./g1-tiny.png
// 与 ./img-800x400.png 由生成器复制到 acceptance/ 下,引用路径不改写)
export const fixtures = { main: markdown };

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
  const documentXml = await unzipPart(buffer, "word/document.xml");
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
  // 代码块(renderCode):```ts 已知语言 → hljs 语法高亮(code-highlight.ts,GitHub Light
  // 色板),每个 token 一个 TextRun(字体 CODE_FONT=Consolas、字号 CODE_SIZE=20
  // half-points=10pt → w:sz/w:szCs val="20"),行间 <w:br/> run;无语言/未知语言
  // 降级为等宽文本原样输出。function 关键字 → keyword 类 → CF222E。
  if (!documentXml.includes('<w:color w:val="CF222E"/>')) {
    throw new Error('basic-render 断言失败:代码块 function 关键字未着色(<w:color w:val="CF222E"/>)');
  }
  // 高亮 run 结构:Consolas + w:sz val=20(10pt)的 rPr 片段(每个代码 run 均带)
  if (
    !documentXml.includes(
      '<w:rFonts w:ascii="Consolas" w:cs="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas"/>' +
        '<w:sz w:val="20"/><w:szCs w:val="20"/>',
    )
  ) {
    throw new Error("basic-render 断言失败:代码块 run 缺少 Consolas + w:sz val=20(10pt)");
  }
  // 高亮拆分后文本片段仍完整(模板字符串被拆为 string 段 `Hello, / subst 段 ${name} /
  // 默认段,不再整行单 run):逐片段断言,保证文本内容不丢失
  const codeFragments = [
    '<w:t xml:space="preserve">function</w:t>',
    '<w:t xml:space="preserve">hello</w:t>',
    '<w:t xml:space="preserve">name</w:t>',
    '<w:t xml:space="preserve">string</w:t>',
    '<w:t xml:space="preserve">return</w:t>',
    '<w:t xml:space="preserve">`Hello, </w:t>',
    '<w:t xml:space="preserve">${name}</w:t>',
    '<w:t xml:space="preserve">}</w:t>',
  ];
  for (const frag of codeFragments) {
    if (!documentXml.includes(frag)) {
      throw new Error(`basic-render 断言失败:代码块高亮拆分后缺少片段 ${frag}`);
    }
  }
  // 3 行代码 → 2 个行间换行 run(renderCode 每非末行追加 break run)
  if ((documentXml.match(/<w:br\/>/g) || []).length !== 2) {
    throw new Error("basic-render 断言失败:代码块换行 run(<w:br/>)数量 != 2(3 行 2 断)");
  }
  // 代码块段落左缩进 360 twips(renderCode indent: { left: 360 };末行 } 为默认色单 run)
  if (!paragraphProps(documentXml, "}").includes('<w:ind w:left="360"/>')) {
    throw new Error('basic-render 断言失败:代码块段落缺少 w:ind w:left="360"');
  }
  console.log("[ok] basic-render:代码块 docx 序列化(hljs 高亮/Consolas/10pt/逐行 w:br)断言通过");

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
  const numberingXml = await unzipPart(buffer, "word/numbering.xml");
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

  // ---------- 补充断言:图片尺寸与 webp 降级(实现 src/core/docx/render.ts imageToDocx) ----------
  // 尺寸规则:解析出 PNG/JPEG 尺寸后,宽 ≤ 400 原尺寸(不放大),宽 > 400 等比缩到 400;
  // 无法解析尺寸 → 400×300 兜底。docx 库按像素转 EMU(1px = 9525 EMU),
  // 序列化为 <wp:extent cx="…" cy="…"/>。
  // g1-tiny.png(1×1):宽 ≤ 400 不放大 → 1×1(期望 cx=9525 cy=9525)
  if (!documentXml.includes('<wp:extent cx="9525" cy="9525"/>')) {
    throw new Error("basic-render 断言失败:1×1 小图被放大(期望 cx=9525 cy=9525 原尺寸)");
  }
  // img-800x400.png(2:1):宽 > 400 等比缩到 400 → 400×200(期望 cx=3810000 cy=1905000)
  if (!documentXml.includes('<wp:extent cx="3810000" cy="1905000"/>')) {
    throw new Error("basic-render 断言失败:800×400 大图未等比缩放(期望 cx=3810000 cy=1905000)");
  }
  console.log("[ok] basic-render:图片尺寸(docx 小图不放大 + 大图等比缩放)断言通过");

  // webp 降级:docx 库不支持 webp 内嵌 → 占位文本 + 警告。
  // 独立转换(单独 markdown + resolver 返回 RIFF....WEBP 魔数),不污染主样例断言。
  const webpWarnings = [];
  const webpBuffer = await renderDocx(parseMarkdown("![webp](./fake.webp)"), {
    imageResolver: async (src) =>
      src === "./fake.webp"
        ? Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
        : null,
    warnings: webpWarnings,
  });
  const webpWarnOk = webpWarnings.some((w) => w.includes("webp") && w.includes("已跳过"));
  if (!webpWarnOk) {
    throw new Error("basic-render 断言失败:webp 图片未产生降级警告(期望含 webp 与 已跳过)");
  }
  const webpXml = await unzipPart(webpBuffer, "word/document.xml");
  if (!webpXml.includes("[图片: webp]")) {
    throw new Error("basic-render 断言失败:webp 图片未降级为占位文本([图片: webp])");
  }
  if (webpXml.includes("<w:drawing>")) {
    throw new Error("basic-render 断言失败:webp 图片不应生成 drawing(未降级)");
  }
  console.log("[ok] basic-render:webp 图片降级(warning + 占位文本,主样例不受影响)断言通过");

  // ---------- B3c:未知魔数图片跳过嵌入(sniffImageType null 化,imageToDocx 调用方处理) ----------
  // 依据(src/core/image-type.ts):B3 起未知字节头返回 null(不再伪装 png),
  // docx imageToDocx 收到 null → 追加「图片格式无法识别,已跳过」警告 + 占位文本。
  const unknownWarnings = [];
  const unknownBuffer = await renderDocx(parseMarkdown("![坏图](./junk.bin)"), {
    imageResolver: async () => Buffer.from("not-an-image"),
    warnings: unknownWarnings,
  });
  if (!unknownWarnings.some((w) => w.includes("图片格式无法识别") && w.includes("junk.bin"))) {
    throw new Error(`basic-render 断言失败:未知魔数图片未产生跳过警告,warnings=${JSON.stringify(unknownWarnings)}`);
  }
  const unknownXml = await unzipPart(unknownBuffer, "word/document.xml");
  if (!unknownXml.includes("[图片: 坏图]")) {
    throw new Error("basic-render 断言失败:未知魔数图片未降级为占位文本");
  }
  if (unknownXml.includes("<w:drawing>")) {
    throw new Error("basic-render 断言失败:未知魔数图片不应生成 drawing");
  }
  console.log("[ok] basic-render:B3 未知魔数图片跳过嵌入(警告 + 占位文本)断言通过");

  // ---------- B3c:GFM 表格对齐(renderTable node.align → 段落 w:jc center/right) ----------
  // 依据(src/core/docx/render.ts):mdast 表格 align 数组逐列映射 AlignmentType,
  // 未声明列保持缺省(左对齐,无 w:jc)。docx 库序列化:<w:jc w:val="center"/>。
  const alignDocx = await convert(
    "| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| a | b | c |",
    "docx",
    { baseDir: FIXTURES_DIR, warnings: [] },
  );
  const alignXml = await unzipPart(alignDocx.buffer, "word/document.xml");
  if (!alignXml.includes('<w:jc w:val="center"/>')) {
    throw new Error("basic-render 断言失败:表格居中列缺少 w:jc center");
  }
  if (!alignXml.includes('<w:jc w:val="right"/>')) {
    throw new Error("basic-render 断言失败:表格右对齐列缺少 w:jc right");
  }
  // 居中列单元格文本 b 的段落属性含 center(列对齐落到单元格内段落)
  const bProps = (() => {
    const idx = alignXml.indexOf(`<w:t xml:space="preserve">b</w:t>`);
    if (idx === -1) throw new Error("basic-render 断言失败:表格居中列文本 b 未找到");
    const start = alignXml.lastIndexOf("<w:pPr>", idx);
    const end = alignXml.indexOf("</w:pPr>", start);
    return start === -1 || end === -1 ? "" : alignXml.slice(start, end);
  })();
  if (!bProps.includes('w:val="center"')) {
    throw new Error(`basic-render 断言失败:居中列单元格段落属性缺 center:${bProps}`);
  }
  console.log("[ok] basic-render:B3 表格列对齐(:--/:-:/--: → 缺省/center/right)断言通过");

  // ---------- B3c:自闭合 <br/> 白名单放行(html-whitelist 三处扫描器同步) ----------
  // 此前 <br/> 整串判非法:docx 危险段丢弃 / pdf 整段转义。B3 起仅空标签 br 放行自闭合。
  const brDocx = await convert("<strong>粗</strong><br/>换行后", "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const brXml = await unzipPart(brDocx.buffer, "word/document.xml");
  if (!brXml.includes("<w:br/>")) throw new Error("basic-render 断言失败:<br/> 未产出换行 run(<w:br/>)");
  if (!brXml.includes("换行后")) throw new Error("basic-render 断言失败:<br/> 后文本被危险段丢弃");
  if (!brXml.includes(">粗<")) throw new Error("basic-render 断言失败:<strong> 内容丢失");
  const brPdf = await convert("<strong>粗</strong><br/>换行后", "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  if (brPdf.html.includes("&lt;strong&gt;")) {
    throw new Error(`basic-render 断言失败:pdf 侧合法表达式仍被转义:\n${brPdf.html}`);
  }
  if (!brPdf.html.includes("<br/>") || !brPdf.html.includes("<strong>粗</strong>")) {
    throw new Error(`basic-render 断言失败:pdf 侧 <br/>/<strong> 未按白名单原样输出:\n${brPdf.html}`);
  }
  console.log("[ok] basic-render:B3 自闭合 <br/> 白名单放行(docx 渲染 + pdf 不转义)断言通过");

  // 缺失图片警告(M6:检查并入 imageResolver 失败路径,dist/core/convert.ts 已移除
  // stat 预扫;docx imageToDocx resolver 返回 null → warnings 追加统一文案
  // 「图片加载失败: <src>」,本地与外链同构)。样例引用不存在的 missing-img.png
  // (无 fixture,与 toc-caption 段 missing-fig.png 同做法);resolver 注入 null 模拟缺失。
  const missingWarnings = [];
  await convert("![缺图](missing-img.png)", "docx", {
    baseDir: FIXTURES_DIR,
    imageResolver: async () => null,
    warnings: missingWarnings,
  });
  const missingWarnOk = missingWarnings.some(
    (w) => w.includes("图片加载失败:") && w.includes("missing-img.png"),
  );
  if (!missingWarnOk) {
    throw new Error("basic-render 断言失败:warnings 缺少「图片加载失败: missing-img.png」");
  }
  console.log("[ok] basic-render:缺失图片警告(warnings 含「图片加载失败:」与文件名)断言通过");

  // pdf 侧同文案:checkLocalImages 经 resolver 失败路径(M6 替代 convert 层 stat 预扫)
  const pdfMissingWarnings = [];
  await convert("![缺图](missing-img.png)", "pdf", {
    baseDir: FIXTURES_DIR,
    imageResolver: async () => null,
    warnings: pdfMissingWarnings,
  });
  if (!pdfMissingWarnings.some((w) => w.includes("图片加载失败:") && w.includes("missing-img.png"))) {
    throw new Error("basic-render 断言失败:pdf 缺失图片应产生统一「图片加载失败:」警告");
  }
  console.log("[ok] basic-render:pdf 缺失图片警告(统一文案经 resolver 失败路径)断言通过");

  // ---------- G8 补齐:convert warnings ?? [] 兜底(convert.ts:67) ----------
  // 依据(dist/core/convert.ts):context.warnings 缺省时内部兜底为空数组,转换不抛错;
  // 缺失图片等警告路径在无 warnings 收集器时静默(不崩溃)。
  const noWarnDocx = await convert("![缺图](missing.png)", "docx", { baseDir: FIXTURES_DIR });
  if (noWarnDocx.buffer.length === 0) {
    throw new Error("basic-render 断言失败:convert 无 warnings 参数时应正常产出 docx buffer");
  }
  const noWarnPdf = await convert("![缺图](missing.png)", "pdf", { baseDir: FIXTURES_DIR });
  if (noWarnPdf.html.length === 0) {
    throw new Error("basic-render 断言失败:convert 无 warnings 参数时应正常产出 pdf html");
  }
  console.log("[ok] basic-render:convert 无 warnings 参数(warnings ?? [] 兜底)docx/pdf 均正常产出");

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

  // ---------- G8 补齐:hljs.highlight 抛错 → 转义兜底(render.ts:109-110) ----------
  // 依据(dist/core/pdf/render.ts highlight):hljs.getLanguage 命中后 highlight 抛错
  // (语言包异常)→ catch 回退转义输出 <pre class="hljs"><code>escapeHtml(str)</code></pre>。
  // 触发:注册编译期即抛错的坏语言(match 与 begin 并存,hljs compileMatch 抛
  // "begin & end are not supported with match"),经 highlight.js/lib/common 共享实例
  // 注入(与 render.ts 同一模块单例);用后 unregister 清理,不影响其他断言。
  hljs.registerLanguage("broken", () => ({ match: "x", begin: /y/ }));
  try {
    const brokenPdf = await convert("```broken\nif (a < b && c > d) {}\n```\n", "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
    });
    if (!brokenPdf.html.includes('<pre class="hljs"><code>if (a &lt; b &amp;&amp; c &gt; d) {}\n</code></pre>')) {
      throw new Error("basic-render 断言失败:hljs 抛错未回退转义输出(期望 escapeHtml 兜底)");
    }
    if (brokenPdf.html.includes('<span class="hljs-keyword">')) {
      throw new Error("basic-render 断言失败:hljs 抛错回退不应含 token 类 span(未走 highlight)");
    }
    console.log("[ok] basic-render:hljs.highlight 抛错回退转义输出(render.ts:109-110)断言通过");
  } finally {
    hljs.unregisterLanguage("broken");
  }

  // ---------- G8 补齐:脚注定义内 blockquote/thematicBreak(render.ts:955-961) ----------
  // 依据(src/core/docx/render.ts renderFootnoteDefinition):脚注定义子块复用块渲染,
  // blockquote → renderBlockquote(左缩进 720 + 灰底 F2F2F2),thematicBreak →
  // renderThematicBreak(下边框 single 999999);产物在 footnotes.xml 部件。
  const fnDocx = await convert("正文[^1]\n\n[^1]: 脚注内容\n\n    > 引用内容\n\n    ---\n", "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
  });
  const fnXml = await unzipPart(fnDocx.buffer, "word/footnotes.xml");
  if (!fnXml.includes("引用内容")) {
    throw new Error("basic-render 断言失败:脚注定义内 blockquote 文本未渲染");
  }
  if (!fnXml.includes('<w:shd w:fill="F2F2F2" w:val="clear"/>') || !fnXml.includes('<w:ind w:left="720"/>')) {
    throw new Error("basic-render 断言失败:脚注内 blockquote 缺少灰底/左缩进(renderBlockquote)");
  }
  if (!fnXml.includes('<w:pBdr><w:bottom w:val="single" w:color="999999" w:sz="6"/>')) {
    throw new Error("basic-render 断言失败:脚注内 thematicBreak 缺少下边框(renderThematicBreak)");
  }
  console.log("[ok] basic-render:脚注定义内 blockquote/thematicBreak 渲染断言通过");

  await saveArtifact("basic-render", { docx: buffer });
}
