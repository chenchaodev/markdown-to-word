/**
 * 任务列表验收(GFM task list;此前无测试覆盖):
 * - docx:remark-gfm 将 [x]/[ ] 标记剥除(段落文本为「已完成」「待办」),renderList
 *   按普通项目符号列表渲染(w:numPr md-list-bullet),无 checkbox 特殊处理;
 * - pdf:markdown-it + @mdit/plugin-tasklist 渲染 checkbox 结构
 *   (ul.task-list-container > li.task-list-item > input + label)。
 * 实现疑点:renderPdfHtml 的 replaceTaskCheckboxes 本应将 checkbox 替换为 ☑/☐
 * (规避 Chromium 打印 bug),但其正则(<input class="…" type="checkbox" disabled…>)
 * 与插件实际输出不匹配——属性顺序 type 在前、多 id 属性、布尔属性序列化为
 * checked="checked" → 替换当前不生效,input 原样保留。本段按现状断言,
 * 修复后需同步更新(替换生效时 input 消失、☑/☐ 出现)。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { htmlToPdf } from "../common/pdf-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 任务列表验收 */
export async function run() {
  const taskMd = `# 任务列表测试

- [x] 已完成
- [ ] 待办
- 普通项
`;

  // ---------- docx ----------
  const docxArtifact = await convert(taskMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const documentXml = unzipPart(docxArtifact.buffer, "word/document.xml");
  // 列表项文本:[x]/[ ] 标记已被 remark-gfm 剥除(断言「已完成」「待办」渲染)
  for (const text of ["已完成", "待办", "普通项"]) {
    const idx = documentXml.indexOf(text);
    if (idx === -1) throw new Error(`任务列表断言失败:docx 缺少列表项文本 ${text}`);
    // 按普通列表项渲染:段落含 ListParagraph 样式 + w:numPr(无 checkbox 特殊处理,
    // 与普通列表项一致 → 「普通项」同样命中,即 docx 侧不受影响)
    const para = paragraphXmlAt(documentXml, idx);
    if (!para.includes("ListParagraph") || !para.includes("w:numPr")) {
      throw new Error(`任务列表断言失败:${text} 未按普通列表项渲染(缺 ListParagraph/w:numPr)`);
    }
  }
  // checked 状态忽略:docx 无 checkbox 字形(☑/☐ 均不应出现)
  if (documentXml.includes("☑") || documentXml.includes("☐")) {
    throw new Error("任务列表断言失败:docx 不应出现 ☑/☐ checkbox 字形");
  }
  console.log("[ok] docx 任务列表:[x]/[ ] 标记剥除、按普通列表项渲染、无 checkbox 字形");

  // ---------- pdf ----------
  const pdfArtifact = await convert(taskMd, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "任务列表测试",
    warnings: [],
  });
  const pdfHtml = pdfArtifact.html;
  // 任务列表结构:plugin 输出 ul.task-list-container > li.task-list-item(input + label)
  if (!pdfHtml.includes('<ul class="task-list-container">') || !pdfHtml.includes('<li class="task-list-item">')) {
    throw new Error("任务列表断言失败:PDF 缺少任务列表容器/条目结构");
  }
  // checkbox 元素保留现状(replaceTaskCheckboxes 未命中,见文件头注释;
  // 修复生效后 input 消失、☑/☐ 出现,本断言会失败提示更新)
  if (!pdfHtml.includes('class="task-list-item-checkbox"')) {
    throw new Error("任务列表断言失败:PDF 缺少 task-list-item-checkbox checkbox 结构");
  }
  // 标记剥除后的列表项文本
  if (!pdfHtml.includes("已完成") || !pdfHtml.includes("待办")) {
    throw new Error("任务列表断言失败:PDF 缺少列表项文本(已完成/待办)");
  }
  // 非任务列表的普通列表项不受影响(无 task-list-item class,插件仅包裹任务条目)
  if (!pdfHtml.includes("<li>普通项</li>")) {
    throw new Error("任务列表断言失败:普通列表项不应带任务列表样式");
  }
  console.log("[ok] PDF 任务列表:容器/条目/checkbox 结构、文本、普通项不受影响 断言通过");

  const pdfBin = await htmlToPdf(pdfArtifact.html, pdfArtifact.footerTemplate);
  await saveArtifact("task-list", { docx: docxArtifact.buffer, pdf: pdfBin });
}

/** 取 document.xml 中以 searchIdx 为锚的段落 XML(回溯 <w:p> 起点、前瞻 </w:p> 终点) */
function paragraphXmlAt(documentXml, searchIdx) {
  const start = documentXml.lastIndexOf("<w:p>", searchIdx);
  const end = documentXml.indexOf("</w:p>", searchIdx);
  if (start === -1 || end === -1) throw new Error(`段落定位失败(searchIdx=${searchIdx})`);
  return documentXml.slice(start, end + 6);
}
