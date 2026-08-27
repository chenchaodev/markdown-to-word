/**
 * TOC 静态目录 + 图/表题注编号测试(原 make-batch4-sample.mjs 段 9):
 * 8a 免更新路线:docx TableOfContents beginDirty:false + cachedEntries
 * (静态条目,纯超链接跳书签、无页码)→ 打开即见、不弹「更新域」提示;
 * 8b 前缀行识别:「图: /表:」(半角/全角冒号)紧跟图/表段落之后 → 题注,
 * 静态注入编号「图 1.1」= 最近 h1 章节号 + 章节内序数(SEQ \s 1 语义),
 * 图/表独立计数、h1 处重置;孤立前缀行(前无图/表)按普通段落。
 * 注意:题注行与图/表之间须空行(图:无空行会并入图所在段落;表:无空行会被
 * GFM 表格规则吞成表格行)。
 */
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";
import { FIXTURES_DIR } from "../common/paths.js";

/** 主样例:TOC + 题注(含孤立题注/缺失图片),gen-fixtures 落盘为 acceptance/toc-caption.md */
const batch8Md = `# 第一章

图: 第一章的图(孤立题注,前无图 → 普通段落)

![示例图](missing-fig.png)

图: 总体架构示意图

表: 无前导对象的表题注(孤立,普通段落)

| 列A | 列B |
| --- | --- |
| 1 | 2 |

表: 参数说明表

## 1.1 小节

![小节图](missing-fig2.png)

图: 小节内的图

# 第二章

| X | Y |
| --- | --- |
| a | b |

表: 第二章的表

图: 第二章开头无图的孤立题注(普通段落)
`;
export const fixtures = { main: batch8Md };

export async function run() {
  const batch8Docx = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const b8Document = await unzipPart(batch8Docx.buffer, "word/document.xml");
  // 8a-1:TOC 域指令仍在(w:sdt > w:instrText TOC \o "1-3" \h)
  if (!b8Document.includes("TOC")) throw new Error("批次8断言失败:document.xml 缺少 TOC 域指令");
  // 8a-2:beginDirty:false → w:dirty="false"(显式关,Word 打开不提示更新域)
  if (!b8Document.includes('w:dirty="false"') || b8Document.includes('w:dirty="true"')) {
    throw new Error("批次8断言失败:静态目录 dirty 属性应为 false(免更新路线)");
  }
  // 8a-3:cachedEntries 静态条目 → 目录内超链接指向标题书签(w:hyperlink 带 w:history 属性)
  if (!b8Document.includes('w:anchor="第一章"')) {
    throw new Error("批次8断言失败:静态目录条目缺少指向标题书签的超链接");
  }
  // F7-①:field 模式 → beginDirty:true(Word/WPS 打开弹更新提示并注入真实页码),条目仍指向书签
  const batch8FieldToc = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [], tocMode: "field" });
  const fieldDoc = await unzipPart(batch8FieldToc.buffer, "word/document.xml");
  if (!fieldDoc.includes('w:dirty="true"')) {
    throw new Error("F7-①断言失败:field 模式目录 dirty 属性应为 true(触发 Word 更新域)");
  }
  if (!fieldDoc.includes('w:anchor="第一章"')) {
    throw new Error("F7-①断言失败:field 模式目录条目仍应指向标题书签");
  }
  // 8b-1:静态编号注入(章节号 + 章节内序数,图/表独立、h1 重置)
  for (const needle of ["图 1.1 总体架构示意图", "表 1.1 参数说明表", "图 1.2 小节内的图", "表 2.1 第二章的表"]) {
    if (!b8Document.includes(needle)) throw new Error(`批次8断言失败:题注编号缺失(${needle})`);
  }
  // 8b-2:孤立前缀行按普通段落(原文保留,不编号)
  if (!b8Document.includes("图: 第一章的图(孤立题注,前无图 → 普通段落)")) {
    throw new Error("批次8断言失败:孤立「图:」行应按普通段落保留原文");
  }
  // 8a-4:toc 关闭 → docx 无 TOC 指令
  const batch8NoToc = await convert(batch8Md, "docx", { baseDir: FIXTURES_DIR, warnings: [], toc: false });
  if ((await unzipPart(batch8NoToc.buffer, "word/document.xml")).includes("TOC")) {
    throw new Error("批次8断言失败:toc:false 时 document.xml 不应含 TOC 指令");
  }
  // 8b-3:captionNumbering 关闭 → 题注行按普通段落(原文保留)
  const batch8NoCaption = await convert(batch8Md, "docx", {
    baseDir: FIXTURES_DIR, warnings: [],
    typography: { ...DEFAULT_TYPOGRAPHY, captionNumbering: false },
  });
  if (!(await unzipPart(batch8NoCaption.buffer, "word/document.xml")).includes("图: 总体架构示意图")) {
    throw new Error("批次8断言失败:captionNumbering:false 时题注行应保留前缀原文");
  }
  console.log("[ok] docx 静态目录 + 题注编号:TOC 免更新/条目超链接/编号注入/孤立行/开关 断言通过");

  const batch8Pdf = await convert(batch8Md, "pdf", { baseDir: FIXTURES_DIR, title: "批次8验收", warnings: [] });
  // 8b-4:PDF 题注 class + 前缀剥除(编号走 CSS counter 伪元素,不进文本节点)
  if (!batch8Pdf.html.includes('<p class="fig-caption">总体架构示意图</p>')) {
    throw new Error("批次8断言失败:PDF 缺少 fig-caption 题注(class/前缀剥除)");
  }
  if (!batch8Pdf.html.includes('<p class="tab-caption">参数说明表</p>')) {
    throw new Error("批次8断言失败:PDF 缺少 tab-caption 题注");
  }
  // 8b-5:题注 CSS counter(章节号 + 序数,h1 重置语义)
  if (!batch8Pdf.html.includes(".fig-caption::before") || !batch8Pdf.html.includes('content: "图 " counter(h1c) "." counter(figc)')) {
    throw new Error("批次8断言失败:PDF 缺少题注编号 CSS counter 规则");
  }
  // 8b-6:孤立前缀行不标记为题注(前无图/表)
  if (batch8Pdf.html.includes('class="fig-caption">图:')) {
    throw new Error("批次8断言失败:孤立「图:」行不应标记为 fig-caption");
  }
  // 8a-5:toc 关闭 → PDF 无目录
  const batch8PdfNoToc = await convert(batch8Md, "pdf", { baseDir: FIXTURES_DIR, title: "批次8验收", warnings: [], toc: false });
  if (batch8PdfNoToc.html.includes('class="toc"')) {
    throw new Error("批次8断言失败:toc:false 时 PDF 不应含目录");
  }
  console.log("[ok] PDF 题注 + 目录开关:fig/tab-caption、CSS counter、孤立行、toc 开关 断言通过");

  const batch8PdfBin = await htmlToPdf(batch8Pdf.html, batch8Pdf.footerTemplate);
  await saveArtifact("toc-caption", { docx: batch8Docx.buffer, pdf: batch8PdfBin });
}
