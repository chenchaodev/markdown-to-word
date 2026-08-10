/**
 * 标题编号 + 内部/外部链接验收(原 make-batch4-sample.mjs 段 3,补 h4-h6):
 * linkMd → docx;断言 numbering.xml 多级 text 模板、document.xml 的
 * w:hyperlink w:anchor 内部锚点与标题书签(编号不破坏 Bookmark);
 * h4-h6:样式(Heading4/5/6)/书签齐全,编号仅挂 h1-h3(实现事实:
 * renderHeading 的 numbering 条件 depth <= 3,书签为全级别)。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 标题编号 + 内部/外部链接验收(批次 5b) */
export async function run() {
  // 内部锚点 [x](#二级标题) → InternalHyperlink(anchor=docxBookmarkId);外链 → ExternalHyperlink
  const linkMd = `---
title: 标题编号与链接测试
---

# 第一章

正文,链接到[二级标题](#二级标题),以及外链[示例站](https://example.com)。

## 二级标题

三级子节见下。

### 三级子节

- 项目一
- 项目二

#### 四级标题

##### 五级标题

###### 六级标题
`;
  const linkDocx = await convert(linkMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const numberingXml = unzipPart(linkDocx.buffer, "word/numbering.xml");
  const documentXml = unzipPart(linkDocx.buffer, "word/document.xml");
  // 标题编号:numbering.xml 含多级 text 模板 %1 / %1.%2 / %1.%2.%3
  // (reference 名 "md-heading" 是库内部标识,不写进 XML,断言 text 模板即可)
  if (!numberingXml.includes('w:lvlText w:val="%1"/>') || !numberingXml.includes('w:lvlText w:val="%1.%2"/>')) {
    throw new Error("标题编号断言失败:numbering.xml 缺少多级 text 模板");
  }
  // 内部链接:document.xml 含 w:hyperlink w:anchor 指向标题书签
  if (!documentXml.includes('w:hyperlink') || !documentXml.includes('w:anchor="二级标题"')) {
    throw new Error("内部链接断言失败:document.xml 缺少 w:hyperlink w:anchor");
  }
  // 标题书签仍在(编号不破坏 Bookmark)
  if (!documentXml.includes('w:bookmarkStart w:name="二级标题"')) {
    throw new Error("标题书签断言失败:编号后 Bookmark 丢失");
  }
  // h4-h6 渲染正确:样式齐全(Heading4/5/6 段落样式)+ 书签全级别
  // (parse.ts 为所有标题生成 data.id,renderHeading 对任意 depth 挂 Bookmark)
  for (const [style, name] of [["Heading4", "四级标题"], ["Heading5", "五级标题"], ["Heading6", "六级标题"]]) {
    if (!documentXml.includes(`<w:pStyle w:val="${style}"/>`)) {
      throw new Error(`标题样式断言失败:缺少 ${style} 段落样式`);
    }
    if (!documentXml.includes(`w:bookmarkStart w:name="${name}"`)) {
      throw new Error(`标题书签断言失败:${name} 书签缺失`);
    }
  }
  // 编号仅挂 h1-h3:headingNumberingOptions 只生成 3 级(levels 0-2),
  // renderHeading numbering 条件为 depth <= 3 → h4-h6 段落无 w:numPr
  for (const name of ["四级标题", "五级标题", "六级标题"]) {
    const para = paragraphXmlAt(documentXml, documentXml.indexOf(`w:bookmarkStart w:name="${name}"`));
    if (para.includes("w:numPr")) {
      throw new Error(`标题编号断言失败:${name} 不应有 w:numPr(编号仅 h1-h3)`);
    }
  }
  // 对照:h1 正文段落(以书签锚定,避开目录页同名词条)应带 w:numPr
  const h1Para = paragraphXmlAt(documentXml, documentXml.indexOf('w:bookmarkStart w:name="第一章"'));
  if (!h1Para.includes("w:numPr")) {
    throw new Error("标题编号断言失败:h1 段落缺少 w:numPr(编号应生效)");
  }
  console.log("[ok] docx 标题编号/内部链接:numbering md-heading + hyperlink anchor + 书签齐全;h4-h6 样式/书签齐全且无编号");
  await saveArtifact("heading-links", { docx: linkDocx.buffer });
}

/** 取 document.xml 中以 searchIdx 为锚的段落 XML(回溯 <w:p> 起点、前瞻 </w:p> 终点) */
function paragraphXmlAt(documentXml, searchIdx) {
  const start = documentXml.lastIndexOf("<w:p>", searchIdx);
  const end = documentXml.indexOf("</w:p>", searchIdx);
  if (start === -1 || end === -1) throw new Error(`段落定位失败(searchIdx=${searchIdx})`);
  return documentXml.slice(start, end + 6);
}
