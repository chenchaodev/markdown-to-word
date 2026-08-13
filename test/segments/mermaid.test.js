/**
 * Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c):
 * 注入 fake resolver 断言 core 层行为(真实渲染由 test/main/mermaid-service.test.js 覆盖),
 * 零依赖真实渲染。断言依据 src/core/mermaid.ts 契约与实现事实(勿臆测):
 *
 * 实现事实(2026-08-13 实测):
 * - docx 成功路径(docx/render.ts renderCode):mermaid 围栏 + resolver →
 *   ImageRun png + scaleToFit(width,height)(>400 等比缩到 400),document.xml
 *   含 drawingML <a:blip> 与 cx/cy EMU(px × 9525);media 部件存在(zipContains
 *   "word/media");resolver 收到的 code 无尾随换行(remark fence 语义)。
 *   600×300 → 400×200 → cx="3810000" cy="1905000"。
 * - docx 降级:resolver 返回 null → 等宽代码块原文保留、无 <a:blip>;
 *   抛错 → 同样降级,警告带 reason。警告文案:
 *   "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块" /
 *   `Mermaid 渲染失败: ${reason},已降级为代码块`。
 * - docx 无 resolver:mermaid 围栏走原文本代码块,行为不变。
 * - pdf 成功路径(pdf/render.ts replaceMermaidPlaceholders):highlight 回调产出
 *   <div class="mermaid">(escapeHtml 文本)占位 → 替换为
 *   <div class="mermaid-svg">SVG</div>,无占位残留;resolver 收到 decodeEntities
 *   还原后的原码(含尾随换行,markdown-it fence 语义),特殊字符逐字符往返。
 * - pdf 降级:→ <pre class="mermaid-fallback"><code>escapeHtml(原码)</code></pre>
 *   + 警告;单引号不转义、双引号→&quot;、< > & → &lt; &gt; &amp;。
 * - pdf 无 resolver:不产占位,走原 hljs 兜底(<pre class="hljs"><code>…</code></pre>,
 *   内容经 markdown-it escapeHtml,如 --> 呈 --&gt;)。
 * - 非 mermaid 围栏(如 js)不被 mermaid 分支劫持,docx 文本 / pdf hljs 高亮。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart, zipContains } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

// 1x1 真实 PNG 魔数头(docx 不校验内容,unzipPart 只读 xml,media 存在性用 zipContains)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><text>fake</text></svg>';

const MD_OK = "# 图表\n\n```mermaid\ngraph TD\n  A-->B\n```\n";
// 特殊字符围栏:占位→解码→(成功)resolver 逐字符还原 / (降级)escapeHtml 转义
const MD_SPECIAL = '# 图\n\n```mermaid\ngraph TD; A["<x> & \'q\'"]\n```\n';
const MD_JS = "# 代码\n\n```js\nconst a = 1;\n```\n";

/** Mermaid 图表渲染 core 层契约 */
export async function run() {
  // ---- 1/9. docx 成功路径:resolver 被调用(围栏原文)→ 内嵌 PNG 图片(缩放 600×300→400×200) ----
  {
    const received = [];
    const okResolver = async (code) => {
      received.push(code);
      return { svg: FAKE_SVG, png: PNG_MAGIC, width: 600, height: 300 };
    };
    const warnings = [];
    const docx = await convert(MD_OK, "docx", { baseDir: FIXTURES_DIR, warnings, mermaidResolver: okResolver });
    const xml = unzipPart(docx.buffer, "word/document.xml");
    if (received.length !== 1 || received[0] !== "graph TD\n  A-->B") {
      throw new Error(`docx 成功路径:resolver 未收到围栏原文,received=${JSON.stringify(received)}(remark fence 去尾换行)`);
    }
    if (!xml.includes("a:blip") || !xml.includes("<w:drawing>")) {
      throw new Error("docx 成功路径:document.xml 缺少内嵌图片(drawingML <a:blip> 或 <w:drawing>)");
    }
    if (!xml.includes('cx="3810000"') || !xml.includes('cy="1905000"')) {
      throw new Error("docx 成功路径:图片缩放 EMU 错误(600×300 → scaleToFit 400×200 × 9525)");
    }
    if (!zipContains(docx.buffer, "word/media")) {
      throw new Error("docx 成功路径:zip 缺少 media 部件");
    }
    if (warnings.some((x) => x.includes("Mermaid"))) {
      throw new Error(`docx 成功路径:不应产生 Mermaid 警告,warnings=${JSON.stringify(warnings)}`);
    }
    await saveArtifact("mermaid", { docx: docx.buffer });
    console.log("[ok] mermaid:docx 成功路径 resolver 收围栏原文 + a:blip/缩放 EMU/media 部件,断言通过");
  }

  // ---- 2/9. docx 降级路径:resolver 返回 null → 代码原文保留 + 无图片 + 警告 ----
  {
    const warnings = [];
    const docx = await convert(MD_OK, "docx", {
      baseDir: FIXTURES_DIR,
      warnings,
      mermaidResolver: async () => null,
    });
    const xml = unzipPart(docx.buffer, "word/document.xml");
    if (xml.includes("a:blip")) {
      throw new Error("docx 降级路径:null 结果不应内嵌图片");
    }
    if (!xml.includes("graph TD")) {
      throw new Error("docx 降级路径:代码原文未保留");
    }
    if (!warnings.includes("Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块")) {
      throw new Error(`docx 降级路径:缺少空结果降级警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] mermaid:docx 降级路径(null)代码原文保留 + 警告,断言通过");
  }

  // ---- 2b. docx 降级路径(抛错):警告带 reason ----
  {
    const warnings = [];
    const docx = await convert(MD_OK, "docx", {
      baseDir: FIXTURES_DIR,
      warnings,
      mermaidResolver: async () => {
        throw new Error("boom");
      },
    });
    const xml = unzipPart(docx.buffer, "word/document.xml");
    if (xml.includes("a:blip") || !xml.includes("graph TD")) {
      throw new Error("docx 降级路径(抛错):应降级为代码块原文且无图片");
    }
    if (!warnings.includes("Mermaid 渲染失败: boom,已降级为代码块")) {
      throw new Error(`docx 降级路径(抛错):缺少带 reason 的警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] mermaid:docx 降级路径(抛错 boom)警告带 reason,断言通过");
  }

  // ---- 3/9. docx 无 resolver:原行为不变(代码块文本,无图片,无警告) ----
  {
    const warnings = [];
    const docx = await convert(MD_OK, "docx", { baseDir: FIXTURES_DIR, warnings });
    const xml = unzipPart(docx.buffer, "word/document.xml");
    if (xml.includes("a:blip")) {
      throw new Error("docx 无 resolver:mermaid 围栏不应内嵌图片(原行为)");
    }
    if (!xml.includes("graph TD")) {
      throw new Error("docx 无 resolver:代码文本应保留");
    }
    if (warnings.some((x) => x.includes("Mermaid"))) {
      throw new Error(`docx 无 resolver:不应产生 Mermaid 警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] mermaid:docx 无 resolver 原行为不变,断言通过");
  }

  // ---- 4/9. pdf 成功路径:mermaid-svg 内联 + 无占位残留 + 特殊字符逐字符还原 ----
  {
    const received = [];
    const okResolver = async (code) => {
      received.push(code);
      return { svg: FAKE_SVG, png: PNG_MAGIC, width: 600, height: 300 };
    };
    const pdf = await convert(MD_SPECIAL, "pdf", { baseDir: FIXTURES_DIR, warnings: [], mermaidResolver: okResolver });
    if (!pdf.html.includes('<div class="mermaid-svg">')) {
      throw new Error('pdf 成功路径:缺少 <div class="mermaid-svg">');
    }
    if (!pdf.html.includes(FAKE_SVG)) {
      throw new Error("pdf 成功路径:SVG 内容未内联");
    }
    if (pdf.html.includes('<div class="mermaid">')) {
      throw new Error("pdf 成功路径:存在占位残留 <div class=\"mermaid\">");
    }
    // 特殊字符(8/9):escapeHtml(占位)→ decodeEntities(还原)对称,resolver 收到逐字符原码
    if (received.length !== 1 || received[0] !== 'graph TD; A["<x> & \'q\'"]\n') {
      throw new Error(`pdf 成功路径:resolver 未收到逐字符原码(含尾随换行),received=${JSON.stringify(received)}`);
    }
    console.log("[ok] mermaid:pdf 成功路径 mermaid-svg 内联 + 特殊字符逐字符往返,断言通过");
  }

  // ---- 5/9. pdf 降级路径:null → mermaid-fallback 转义代码块 + 警告 ----
  {
    const warnings = [];
    const pdf = await convert(MD_SPECIAL, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings,
      mermaidResolver: async () => null,
    });
    if (!pdf.html.includes('<pre class="mermaid-fallback"><code>')) {
      throw new Error('pdf 降级路径:缺少 <pre class="mermaid-fallback">');
    }
    if (pdf.html.includes('<div class="mermaid-svg">')) {
      throw new Error("pdf 降级路径:null 结果不应内联 SVG");
    }
    // 原文保留(转义形态:双引号→&quot;、< >→&lt; &gt;、&→&amp;,单引号不转)
    if (!pdf.html.includes("&quot;&lt;x&gt; &amp; 'q'&quot;")) {
      throw new Error("pdf 降级路径:fallback 代码块缺少转义原文");
    }
    if (pdf.html.includes("<x>")) {
      throw new Error("pdf 降级路径:fallback 泄漏明文 <x>(未转义)");
    }
    if (!warnings.includes("Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块")) {
      throw new Error(`pdf 降级路径:缺少降级警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] mermaid:pdf 降级路径(null)mermaid-fallback 转义原文 + 警告,断言通过");
  }

  // ---- 6/9. pdf 无 resolver:原 hljs 兜底(不产占位、无 mermaid class) ----
  {
    const pdf = await convert(MD_OK, "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
    // markdown-it 兜底:非注册语言经 escapeHtml(--&gt;),内容行保留缩进,包装为 hljs pre
    if (!pdf.html.includes('<pre class="hljs"><code>graph TD\n  A--&gt;B\n</code></pre>')) {
      throw new Error("pdf 无 resolver:缺少原 hljs 兜底代码块(转义形态)");
    }
    if (pdf.html.includes("class=\"mermaid")) {
      throw new Error("pdf 无 resolver:不应出现 mermaid 占位/容器 class");
    }
    console.log("[ok] mermaid:pdf 无 resolver 原 hljs 兜底,断言通过");
  }

  // ---- 7/9. 非 mermaid 围栏不变(docx 文本 / pdf hljs 高亮,带 resolver 也不被劫持) ----
  {
    const docx = await convert(MD_JS, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      mermaidResolver: async () => ({ svg: FAKE_SVG, png: PNG_MAGIC, width: 100, height: 50 }),
    });
    const xml = unzipPart(docx.buffer, "word/document.xml");
    if (xml.includes("a:blip")) {
      throw new Error("非 mermaid 围栏:js 围栏不应走 mermaid 图片分支");
    }
    if (!xml.includes("const a = 1;")) {
      throw new Error("非 mermaid 围栏:docx 应保留 js 代码文本");
    }
    const pdf = await convert(MD_JS, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      mermaidResolver: async () => ({ svg: FAKE_SVG, png: PNG_MAGIC, width: 100, height: 50 }),
    });
    if (!pdf.html.includes('<pre class="hljs"><code class="language-js">')) {
      throw new Error("非 mermaid 围栏:pdf 应走 js hljs 高亮(带 resolver 也不变)");
    }
    if (pdf.html.includes("class=\"mermaid")) {
      throw new Error("非 mermaid 围栏:pdf 不应出现 mermaid class");
    }
    console.log("[ok] mermaid:非 mermaid 围栏(js)docx 文本 / pdf hljs 不变,断言通过");
  }

  console.log("[ok] mermaid:core 层契约测试全部通过(9 条验收点)");
}
