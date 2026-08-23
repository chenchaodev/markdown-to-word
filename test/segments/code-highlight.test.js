/**
 * 代码块 docx 语法高亮段(实现 src/core/docx/handlers/code-highlight.ts,GitHub Light 色板):
 * 已知语言(hljs.getLanguage 命中)→ hljs.highlight HTML 解析为 TextRun 序列,
 * token 类 → 色板颜色(大写无 #);无语言/未知语言 → 返回 null,renderCode 降级
 * 等宽文本(无 <w:color>)。
 * 实现事实(2026-08-16 实测):
 * - ```ts 样例:keyword(const/function/return)→ CF222E;string(`Hello, )→ 0A3069;
 *   subst(${name})无色板类 → 默认色;comment → 6E7781 + <w:i/><w:iCs/>;
 *   title(hello)→ 8250DF;built_in(string)→ 0550AE;number(1)→ 0550AE。
 * - 特殊字符:hljs 输出 &lt;/&amp;/&gt; 实体,解析时解码还原,docx 库再按 XML
 *   转义序列化 → w:t 内为 &lt; b &amp;&amp; c &gt; d(无 &amp;lt; 双重转义)。
 * - 换行:每行一个或多个 run,行间 TextRun({ text: "", break: 1 }) → <w:br/>;
 *   3 行代码 → 2 个 <w:br/>。
 * - 解析失败/文本完整性校验失败 → null 降级(原等宽文本路径,行为不变)。
 */
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { formatWarning } from "../../dist/core/i18n.js";
import hljs from "highlight.js/lib/common";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

// 3 行 ts 代码:关键字/数字/注释(特殊字符)/函数名/内置类型/模板字符串
const MD_TS =
  "```ts\nconst x = 1; // note a < b && c > d\nfunction hello(name: string): string {\n  return `Hello, ${name}`;\n```\n";
// 无语言围栏:降级等宽文本(无高亮)
const MD_PLAIN = "```\nconst plain = 1;\n```\n";
// 未知语言围栏:hljs.getLanguage 未命中 → 降级等宽文本(无高亮)
const MD_UNKNOWN = "```nolangxyz\nconst unknown = 1;\n```\n";

// 场景样例导出(gen-fixtures 落盘为 acceptance/code-highlight[-plain|-unknown].md)
export const fixtures = {
  main: MD_TS,
  plain: MD_PLAIN,
  unknown: MD_UNKNOWN,
};

export async function run() {
  // ---- 1. ```ts 高亮:keyword/string/comment 着色 + 特殊字符还原 ----
  const buffer = await renderDocx(parseMarkdown(MD_TS));
  if (buffer.length === 0) {
    throw new Error("code-highlight 断言失败:docx buffer 为空");
  }
  const xml = await unzipPart(buffer, "word/document.xml");
  // keyword(const/function/return)→ CF222E
  if (!xml.includes('<w:color w:val="CF222E"/>')) {
    throw new Error('code-highlight 断言失败:keyword 未着色(期望 <w:color w:val="CF222E"/>)');
  }
  // string(模板字符串 `Hello, )→ 0A3069
  if (!xml.includes('<w:color w:val="0A3069"/>')) {
    throw new Error('code-highlight 断言失败:string 未着色(期望 <w:color w:val="0A3069"/>)');
  }
  // comment → 6E7781 + 斜体(<w:i/>)
  if (!xml.includes('<w:color w:val="6E7781"/>') || !xml.includes("<w:i/>")) {
    throw new Error("code-highlight 断言失败:comment 未着色/未斜体(期望 6E7781 + <w:i/>)");
  }
  // 特殊字符还原:hljs 实体解码后 docx 库按 XML 转义序列化(< → &lt;),无双重转义
  if (!xml.includes('<w:t xml:space="preserve">// note a &lt; b &amp;&amp; c &gt; d</w:t>')) {
    throw new Error("code-highlight 断言失败:注释特殊字符未正确还原(< > & 应解码后转义序列化)");
  }
  if (xml.includes("&amp;lt;")) {
    throw new Error("code-highlight 断言失败:特殊字符双重转义残留(&amp;lt; 说明实体未解码)");
  }
  console.log("[ok] code-highlight:```ts 高亮(keyword/string/comment 着色 + 特殊字符还原)断言通过");

  // ---- 2. 无语言围栏 → 无高亮(无 <w:color) ----
  const plainXml = await unzipPart(await renderDocx(parseMarkdown(MD_PLAIN)), "word/document.xml");
  if (!plainXml.includes("const plain = 1;")) {
    throw new Error("code-highlight 断言失败:无语言代码块文本缺失");
  }
  if (plainXml.includes("<w:color")) {
    throw new Error("code-highlight 断言失败:无语言代码块不应有高亮(<w:color)");
  }
  console.log("[ok] code-highlight:无语言代码块降级等宽文本(无 <w:color)断言通过");

  // ---- 3. 未知语言围栏 → 无高亮 ----
  const unknownXml = await unzipPart(await renderDocx(parseMarkdown(MD_UNKNOWN)), "word/document.xml");
  if (!unknownXml.includes("const unknown = 1;")) {
    throw new Error("code-highlight 断言失败:未知语言代码块文本缺失");
  }
  if (unknownXml.includes("<w:color")) {
    throw new Error("code-highlight 断言失败:未知语言代码块不应有高亮(<w:color)");
  }
  console.log("[ok] code-highlight:未知语言代码块降级等宽文本(无 <w:color)断言通过");

  // ---- 4. 行结构:3 行代码 → 2 个 <w:br/> ----
  if ((xml.match(/<w:br\/>/g) || []).length !== 2) {
    throw new Error("code-highlight 断言失败:3 行代码换行 run(<w:br/>)数量 != 2");
  }
  console.log("[ok] code-highlight:行结构(3 行 → 2 个 <w:br/>)断言通过");

  // ---- 5. 文本完整:原文各片段均出现在 XML 中(高亮拆分不丢内容) ----
  const fragments = [
    "const",
    " x = ",
    "1",
    "; ",
    "// note a &lt; b &amp;&amp; c &gt; d",
    "function",
    "hello",
    "name",
    "string",
    "return",
    "`Hello, ",
    "${name}",
  ];
  for (const frag of fragments) {
    if (!xml.includes(`<w:t xml:space="preserve">${frag}</w:t>`)) {
      throw new Error(`code-highlight 断言失败:高亮拆分后缺少文本片段「${frag}」`);
    }
  }
  console.log("[ok] code-highlight:文本完整(高亮拆分后原文各片段均在)断言通过");

  // ---- 6. B4:语言已知但 hljs 高亮抛错 → 降级等宽 + warn.highlightFallback 警告 ----
  // 依据(src/core/docx/handlers/code-highlight.ts):getLanguage 命中后 highlight 抛错(语言包
  // 异常)→ onFallback(lang) 回调 + null;renderCode 经回调上报 keyed 警告并降级等宽文本。
  // 触发方式与 basic-render pdf 侧一致(注册编译期即抛错的坏语言,用后注销)。
  hljs.registerLanguage("broken", () => ({ match: "x", begin: /y/ }));
  try {
    const brokenWarnings = [];
    const brokenBuffer = await renderDocx(parseMarkdown("```broken\nif (a < b) {}\n```\n"), {
      warnings: brokenWarnings,
    });
    const brokenXml = await unzipPart(brokenBuffer, "word/document.xml");
    if (!brokenWarnings.some((w) => formatWarning(w) === "代码高亮失败,已降级为纯文本: broken")) {
      throw new Error(`code-highlight 断言失败:hljs 抛错未产生高亮降级警告,warnings=${JSON.stringify(brokenWarnings)}`);
    }
    if (!brokenXml.includes("if (a &lt; b) {}")) {
      throw new Error("code-highlight 断言失败:hljs 抛错降级后代码文本缺失");
    }
    if (brokenXml.includes("<w:color")) {
      throw new Error("code-highlight 断言失败:hljs 抛错降级不应有高亮色(<w:color)");
    }
    console.log("[ok] code-highlight:B4 hljs 抛错降级等宽 + 高亮降级警告 断言通过");
  } finally {
    hljs.unregisterLanguage("broken");
  }

  await saveArtifact("code-highlight", { docx: buffer });
}