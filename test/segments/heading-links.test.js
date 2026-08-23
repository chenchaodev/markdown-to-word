/**
 * 标题编号 + 内部/外部链接验收(原 make-batch4-sample.mjs 段 3,补 h4-h6/外链 rels):
 * linkMd → docx;断言 numbering.xml 多级 text 模板、document.xml 的
 * w:hyperlink w:anchor 内部锚点与标题书签(编号不破坏 Bookmark);
 * h4-h6:样式(Heading4/5/6)/书签齐全,编号仅挂 h1-h3(实现事实:
 * renderHeading 的 numbering 条件 depth <= 3,书签为全级别);
 * 外链:URL 仅入 word/_rels/document.xml.rels(hyperlink 关系 + TargetMode External),
 * document.xml 经 r:id 引用(关系 Id 随机生成,动态比对)。
 */
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

/** 主样例:标题编号 + 内部锚点/外部链接 + h1-h6(gen-fixtures 落盘为 acceptance/heading-links.md) */
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
export const fixtures = { main: linkMd };

/** 标题编号 + 内部/外部链接验收(批次 5b) */
export async function run() {
  const linkDocx = await convert(linkMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const numberingXml = await unzipPart(linkDocx.buffer, "word/numbering.xml");
  const documentXml = await unzipPart(linkDocx.buffer, "word/document.xml");
  // R4 回归守卫:书签 w:id 文档内唯一。docx Bookmark 组件每枚独立计数恒为 1 →
  // 全文档标题/公式书签 w:id 全部冲突(Word 要求文档内唯一,实测 WPS 显示异常);
  // bookmarkChildren 改用 ctx.bookmarkNextId 自增,每枚 bookmarkStart/End 对独占 id。
  // 此处收集全部 w:bookmarkStart 的 w:id,去重后数量须等于总数。
  const bookmarkIds = [...documentXml.matchAll(/w:bookmarkStart[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  if (bookmarkIds.length === 0) {
    throw new Error("书签断言失败:document.xml 无 w:bookmarkStart w:id");
  }
  if (new Set(bookmarkIds).size !== bookmarkIds.length) {
    throw new Error(`书签断言失败:w:id 文档内不唯一(共 ${bookmarkIds.length} 枚,去重后 ${new Set(bookmarkIds).size} 枚)`);
  }
  console.log(`[ok] docx 书签 w:id 文档内唯一(${bookmarkIds.length} 枚)`);
  // 标题编号:numbering.xml 含多级 text 模板 %1 / %1.%2 / %1.%2.%3
  // (reference 名 "md-heading" 是库内部标识,不写进 XML,断言 text 模板即可)
  if (!numberingXml.includes('w:lvlText w:val="%1"/>') || !numberingXml.includes('w:lvlText w:val="%1.%2"/>')) {
    throw new Error("标题编号断言失败:numbering.xml 缺少多级 text 模板");
  }
  // 内部链接:document.xml 含 w:hyperlink w:anchor 指向标题书签
  if (!documentXml.includes('w:hyperlink') || !documentXml.includes('w:anchor="二级标题"')) {
    throw new Error("内部链接断言失败:document.xml 缺少 w:hyperlink w:anchor");
  }
  // 外链(ExternalHyperlink 实现事实):URL 只进 rels(document.xml 经 r:id 引用,
  // 关系 Id 为 docx 库随机生成,须动态比对);关系类型 hyperlink + TargetMode External
  const relsXml = await unzipPart(linkDocx.buffer, "word/_rels/document.xml.rels");
  if (!relsXml.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"')) {
    throw new Error("外链断言失败:document.xml.rels 缺少 hyperlink 关系类型");
  }
  if (!relsXml.includes('Target="https://example.com"') || !relsXml.includes('TargetMode="External"')) {
    throw new Error("外链断言失败:rels 缺少 Target=https://example.com 或 TargetMode=External");
  }
  const extLink = /<w:hyperlink[^>]*r:id="([^"]+)"/.exec(documentXml);
  if (!extLink) {
    throw new Error("外链断言失败:document.xml 缺少带 r:id 的外部超链接元素");
  }
  if (!relsXml.includes(`Id="${extLink[1]}"`)) {
    throw new Error(`外链断言失败:document.xml 的 r:id(${extLink[1]}) 在 rels 中无对应关系`);
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
  console.log("[ok] docx 外链:rels hyperlink External 关系 + document.xml r:id 匹配");
  await saveArtifact("heading-links", { docx: linkDocx.buffer });
}

/** 取 document.xml 中以 searchIdx 为锚的段落 XML(回溯 <w:p> 起点、前瞻 </w:p> 终点) */
function paragraphXmlAt(documentXml, searchIdx) {
  const start = documentXml.lastIndexOf("<w:p>", searchIdx);
  const end = documentXml.indexOf("</w:p>", searchIdx);
  if (start === -1 || end === -1) throw new Error(`段落定位失败(searchIdx=${searchIdx})`);
  return documentXml.slice(start, end + 6);
}
