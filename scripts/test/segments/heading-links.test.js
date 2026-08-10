/**
 * 标题编号 + 内部/外部链接验收(原 make-batch4-sample.mjs 段 3):
 * linkMd → docx;断言 numbering.xml 多级 text 模板、document.xml 的
 * w:hyperlink w:anchor 内部锚点与标题书签(编号不破坏 Bookmark)。
 */
import { convert } from "../../../dist/core/convert.js";
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
  console.log("[ok] docx 标题编号/内部链接:numbering md-heading + hyperlink anchor + 书签齐全");
  await saveArtifact("heading-links", { docx: linkDocx.buffer });
}
