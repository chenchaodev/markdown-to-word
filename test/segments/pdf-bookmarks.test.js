/**
 * PDF 书签端到端(R8 批 4 A2;smoke 书签断言的独立化 + buildBookmarkTree 层级直测):
 * convert("pdf") 中间 html → htmlToPdf(printToPDF 链路,与主进程 renderPdf 对齐)
 * → extractHeadings + buildBookmarkTree → injectBookmarks → PDFDocument 回读:
 * Outlines 存在、中文标题(PDFHexString 解码)、Dest[0] 为页面 PDFRef(防「全部回退首页」回归)。
 */
import { convert } from "../../dist/core/convert.js";
import { buildBookmarkTree, injectBookmarks, lookupNamedDest } from "../../dist/core/pdf/bookmarks.js";
import { extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { FIXTURES_DIR } from "../common/paths.js";
import { htmlToPdf } from "../common/pdf-utils.js";

/** 断言 PDF 大纲首条目:Title(中文)与 Dest[0] 页面 PDFRef(与 smoke assertOutline 同款) */
async function assertOutline(pdfBytes, expectedTitle, label) {
  const doc = await PDFDocument.load(pdfBytes);
  const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!outlinesRef) throw new Error(`${label} 缺少 Outlines 大纲`);
  const outlinesDict = doc.context.lookup(outlinesRef, PDFDict);
  if (!outlinesDict) throw new Error(`${label} Outlines 字典解析失败`);
  const firstRef = outlinesDict.get(PDFName.of("First"));
  if (!firstRef) throw new Error(`${label} 大纲缺少 First 条目`);
  const firstDict = doc.context.lookup(firstRef, PDFDict);
  const title = firstDict?.get(PDFName.of("Title"));
  if (!(title instanceof PDFHexString) || title.decodeText() !== expectedTitle) {
    throw new Error(`${label} 书签标题异常: ${title?.toString()}`);
  }
  // 回归:书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转,见批次 4 修复)
  const destArr = firstDict?.get(PDFName.of("Dest"));
  if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
    throw new Error(`${label} 书签 Dest 异常: ${destArr?.toString()}`);
  }
}

/** 主样例:多级标题 + 显式分页(书签层级/跨级回挂,gen-fixtures 落盘为 acceptance/pdf-bookmarks.md) */
const md = `# 书签一级标题

正文一。

## 书签二级标题

正文二。

### 三级子节

正文三。

<!-- page-break -->

## 第二页小节

跨页小节。
`;
export const fixtures = { main: md };

/** PDF 书签端到端验收 */
export async function run() {
  const artifact = await convert(md, "pdf", {
    baseDir: FIXTURES_DIR,
    title: "书签验收",
    warnings: [],
  });

  // 1. 提取 + 建树:三级标题 → 扁平列表 → 嵌套树(h1 顶层,h2/h3 挂最近上级)
  const headings = extractHeadings(artifact.html);
  if (headings.length !== 4) throw new Error(`extractHeadings 数量异常: ${headings.length}`);
  const tree = buildBookmarkTree(headings);
  if (tree.length !== 1 || tree[0].title !== "书签一级标题") throw new Error("书签树:h1 未作顶层");
  const second = tree[0].children?.[0];
  if (!second || second.title !== "书签二级标题") throw new Error("书签树:h2 未挂 h1 下");
  if (!second.children || second.children[0].title !== "三级子节") throw new Error("书签树:h3 未挂 h2 下");
  // 第二页小节与 h1 同级(层级回退),非 h2 的子树
  if (tree.length !== 1 || tree[0].children?.length !== 2) throw new Error("书签树:跨级后 h2 未回挂顶层");
  console.log("[ok] 书签树:多级标题嵌套 + 跨级回挂结构正确");

  // 2. 端到端:printToPDF 产物 → 注入 → 回读(中文标题 + Dest 页面引用)
  const pdf = await htmlToPdf(artifact.html, artifact.footerTemplate);
  const withBookmarks = await injectBookmarks(new Uint8Array(pdf), tree);
  await assertOutline(withBookmarks, "书签一级标题", "书签端到端");
  console.log("[ok] 书签端到端:Outlines 注入,中文标题 + Dest 页面引用正确");

  // ---------- G3 补齐:lookupNamedDest 解析路径直测(bookmarks.ts) ----------
  // 依据(dist/core/pdf/bookmarks.ts):旧式 /Dests 字典(82-84)、decodeURIComponent
  // catch(100-101,非法百分号编码名原样返回)、PDFDict 间接目标(109-115,/D 解引用)。
  // 构造:PDFDocument.create + catalog 挂 /Dests(经 register 为间接对象,与真实 PDF
  // 一致),save → load 回读后 lookupNamedDest 断言(与 printToPDF 产物同构)。

  // 3. 旧式 Dests 字典:key 为 PDFName 百分号编码 UTF-8(#25 转义 %),decodeText +
  // decodeURIComponent 还原中文后命中
  {
    const doc = await PDFDocument.create();
    doc.addPage();
    const dests = doc.context.obj({});
    dests.set(PDFName.of("%E7%9B%AE%E6%A0%87"), doc.context.obj([doc.getPage(0).ref, "Fit"]));
    doc.catalog.set(PDFName.of("Dests"), doc.context.register(dests));
    const reloaded = await PDFDocument.load(await doc.save());
    const dest = lookupNamedDest(reloaded, "目标");
    if (!(dest instanceof PDFArray) || !(dest.asArray()[0] instanceof PDFRef)) {
      throw new Error(`书签断言失败:旧式 Dests 字典未解析出命名目标「目标」,dest=${dest?.toString()}`);
    }
    console.log("[ok] 书签:旧式 /Dests 字典(百分号编码 UTF-8 key)解析命中");
  }

  // 4. decodeURIComponent catch:非法百分号编码名(%zz 非十六进制)原样返回并命中
  {
    const doc = await PDFDocument.create();
    doc.addPage();
    const dests = doc.context.obj({});
    dests.set(PDFName.of("a%zz"), doc.context.obj([doc.getPage(0).ref, "Fit"]));
    doc.catalog.set(PDFName.of("Dests"), doc.context.register(dests));
    const reloaded = await PDFDocument.load(await doc.save());
    const dest = lookupNamedDest(reloaded, "a%zz");
    if (!(dest instanceof PDFArray)) {
      throw new Error(`书签断言失败:非法百分号编码名应原样匹配(destKeyText catch),dest=${dest?.toString()}`);
    }
    console.log("[ok] 书签:decodeURIComponent catch(非法 % 编码)原样返回并命中");
  }

  // 5. PDFDict 间接目标:dest 值为字典,取 /D 键(经 PDFRef 解引用)得到 dest 数组
  {
    const doc = await PDFDocument.create();
    doc.addPage();
    const destArr = doc.context.obj([doc.getPage(0).ref, "Fit"]);
    const destRef = doc.context.register(destArr);
    const destDict = doc.context.obj({ D: destRef });
    const dests = doc.context.obj({});
    dests.set(PDFName.of("indirect"), destDict);
    doc.catalog.set(PDFName.of("Dests"), doc.context.register(dests));
    const reloaded = await PDFDocument.load(await doc.save());
    const dest = lookupNamedDest(reloaded, "indirect");
    if (!(dest instanceof PDFArray) || !(dest.asArray()[0] instanceof PDFRef)) {
      throw new Error(`书签断言失败:PDFDict 间接目标(/D 解引用)未解析,dest=${dest?.toString()}`);
    }
    console.log("[ok] 书签:PDFDict 间接目标(/D → PDFRef → PDFArray)解析命中");
  }
}
