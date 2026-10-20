// @ts-check
/**
 * 双管线(docx ↔ pdf)产物提取器:测试树共享的单源纯函数层。
 *
 * 职责边界:只做「产物字节 / HTML → 可断言的结构化事实」,不含判定(哪一侧该是什么、
 * 差异是否在契约内)与阈值(预算取值 / 白名单 / 正则族在 core 各有单源模块)。判定与
 * 阈值留在消费段,避免测试关注点反向渗进提取器。
 *
 * 为何下沉到 test/harness(而非留在差异矩阵段):
 * 1) 提取逻辑是「产物结构 → 事实」的稳定映射,不随某一段的判定意图变化,留在段里等于
 *    让通用能力跟着单段生命周期走;
 * 2) 多段读同一种产物结构(docx 书签 / 目录锚点 / 交叉引用跳转体、pdf 目录条目 / 标题
 *    锚点),各自正则重抄一遍必然漂移(同一锚点在一个段判过、在另一个段因漏抄属性而
 *    静默漏检);
 * 3) 依赖方向单向:本文件 → docx-utils(zip 解包),不依赖任何段,被段单向 import。
 *
 * 正则与结构假设写在这里而不是各行 verify 内,正是为了让「同一锚点的解释」只有一处。
 */
import { unzipPart } from "./docx-utils.js";

/**
 * docx 产物 → document.xml 文本(矩阵各行的 docx 侧事实由此取)。
 * @param {Buffer} buffer docx 产物字节(须先经 asDocxArtifact/docxBufferOf 收窄)
 * @returns {Promise<string>} document.xml 文本
 */
export async function docxXml(buffer) {
  return unzipPart(buffer, "word/document.xml");
}

/**
 * docx 目录条目锚点(静态 TOC 条目 = 指向标题 slug 的 w:hyperlink)。
 * 题注锚点(fig/tab/eq-)与图表清单条目(cap-)同形 w:anchor 但不是目录条目,须排除——
 * 否则目录断言会把题注跳转 / 清单条目当成标题条目。
 * @param {string} xml document.xml 文本
 * @returns {string[]} 标题 slug 锚点(排除 fig/tab/eq 题注锚点与 cap 合成锚点)
 */
export function docxTocAnchors(xml) {
  return [...xml.matchAll(/<w:hyperlink w:history="1" w:anchor="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((a) => a !== undefined)
    .filter((a) => !/^(fig|tab|eq|cap)-/.test(a));
}

/**
 * docx 图表清单页区间片段(图目录在前、表目录在后;文档无清单页时为空数组)。
 *
 * 为什么要区间:清单条目是 `<w:hyperlink w:history="1" w:anchor="…">`,与正文交叉引用
 * **同形**,没有专属 OOXML 标记,故只能按清单页结构取:标题段(图目录/表目录)+
 * 若干条目段 + 末尾分页段(见 docx/chrome.ts renderCaptionListPage)。取不到区间
 * (例如 list 未生成)时返回空数组,清单断言自然判红而不是误读正文引用。
 * @param {string} xml document.xml 文本
 * @returns {string[]} 清单页 XML 片段(逐段,供拼接与剔除)
 */
function docxCaptionListParts(xml) {
  /** @type {string[]} */
  const parts = [];
  for (const title of ["图目录", "表目录"]) {
    const re = new RegExp(
      `<w:p>(?:(?!</w:p>)[\\s\\S])*?<w:t xml:space="preserve">${title}</w:t>[\\s\\S]*?<w:br w:type="page"/>[\\s\\S]*?</w:p>`,
      "g",
    );
    for (const m of xml.matchAll(re)) {
      const part = m[0];
      if (part !== undefined) parts.push(part);
    }
  }
  return parts;
}

/**
 * 清单页区间拼接(图目录在前、表目录在后;供锚点/条目提取)。
 * @param {string} xml document.xml 文本
 * @returns {string} 清单页 XML 片段拼接
 */
function docxCaptionListRegion(xml) {
  return docxCaptionListParts(xml).join("");
}

/**
 * 去掉清单页区间(供「读正文引用」的提取器)。
 * @param {string} xml document.xml 文本
 * @returns {string} 剔除清单页区间后的 document.xml 文本
 */
function stripDocxCaptionLists(xml) {
  let out = xml;
  for (const part of docxCaptionListParts(xml)) out = out.replace(part, "");
  return out;
}

/**
 * docx 图表清单条目锚点(清单条目 = 指向题注书签的 w:hyperlink;锚点即题注书签名:
 * 有 label 时为 fig-/tab-<label>,无 label 时为合成 cap-<全文序数>)。
 * 「清单条目可点」= 该锚点在同文档里真有对应书签,交叉断言用 docxBookmarks。
 * @param {string} xml document.xml 文本
 * @returns {string[]} 清单条目锚点(文档顺序;无清单页为空数组)
 */
export function docxCaptionListAnchors(xml) {
  return [...docxCaptionListRegion(xml).matchAll(/<w:hyperlink w:history="1" w:anchor="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((a) => a !== undefined);
}

/**
 * docx 图表清单条目(锚点 + 条目文本):文本取条目链接体内 w:t 拼接,用于把
 * 「条目文本含编号」绑定到具体跳转目标。顺序 = 图目录条目在前、表目录条目在后。
 * @param {string} xml document.xml 文本
 * @returns {{anchor: string, text: string}[]} 清单条目(无清单页为空数组)
 */
export function docxCaptionListEntries(xml) {
  return [
    ...docxCaptionListRegion(xml).matchAll(
      /<w:hyperlink w:history="1" w:anchor="([^"]+)">([\s\S]*?)<\/w:hyperlink>/g,
    ),
  ].map(([, anchor, body]) => ({
    anchor: anchor ?? "",
    text: [...(body ?? "").matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1] ?? "").join(""),
  }));
}

/**
 * docx 书签名(标题 / 题注 / 公式锚点)。
 * @param {string} xml document.xml 文本
 * @returns {string[]} w:name 列表
 */
export function docxBookmarks(xml) {
  return [...xml.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((a) => a !== undefined);
}

/**
 * docx 内部超链接的内部片段(自 w:anchor 起到 </w:hyperlink> 止),用于把
 * 「引用文本 / 编号」绑定到「跳转目标」,证明命中的是哪一条目标。
 * 只看「锚点是否存在」判不出「命中了哪一条」——同名 label(fig:same / tab:same)下
 * 必须读链接体里的编号文本,才能证明查表键按 kind 分了命名空间。
 * 图表清单条目与正文交叉引用同形同锚点,故先剔掉清单页区间:本函数读的是**正文引用**
 * (清单条目文本走 docxCaptionListEntries,否则清单里排在正文之前的那一条会冒充引用)。
 * @param {string} xml document.xml 文本
 * @param {string} anchor w:anchor 目标名
 * @returns {string} 片段文本(无该链接时为空串)
 */
export function docxLinkBody(xml, anchor) {
  const bodyXml = stripDocxCaptionLists(xml);
  const start = bodyXml.indexOf(`w:anchor="${anchor}"`);
  if (start < 0) return "";
  const end = bodyXml.indexOf("</w:hyperlink>", start);
  return end < 0 ? "" : bodyXml.slice(start, end);
}

/**
 * pdf 内部链接的内部片段(自 <a href="#锚点"> 起到 </a> 止),docxLinkBody 的 pdf 侧
 * 同构件:两侧「命中哪一条」的读法只此一处定义,一段判过、另一段就不必再抄裸字符串。
 *
 * 与 docxLinkBody 同为「片段原文」语义(不剥标签):docx 侧编号文本与锚点属性同在
 * `<w:hyperlink>` 内,html 侧同理,故消费方一律用 `.includes(编号文本)` 判「这一条链
 * 的文本是不是被替换成了编号」。空串 = 无此链(悬空引用在 pdf 侧不留死链,故空串即
 * 「判悬空」,这是「不该命中」类断言的口径)。
 * 图表清单条目同样指向题注锚点且排在正文之前,故先剔掉 `data-caption-list` 容器
 * (清单条目文本走 pdfCaptionListItems)。
 * @param {string} html pdf HTML 文档
 * @param {string} anchorId 目标锚点 id(如 fig:same;题注锚点带 kind 前缀)
 * @returns {string} 链接体片段文本(无该链接时为空串)
 */
export function pdfLinkBody(html, anchorId) {
  const bodyHtml = html.replace(/<ul\b[^>]*\bdata-caption-list\b[^>]*>[\s\S]*?<\/ul>/g, "");
  const start = bodyHtml.indexOf(`href="#${anchorId}"`);
  if (start < 0) return "";
  // 开标签的 '>':href 值内不含 '>',故其后第一个 '>' 即开标签末尾
  const open = bodyHtml.indexOf(">", start);
  if (open < 0) return "";
  const end = bodyHtml.indexOf("</a>", open);
  return end < 0 ? "" : bodyHtml.slice(open + 1, end);
}

/**
 * pdf 目录条目(h1-h3 → toc-lN)。作用域限 `<ul data-toc>` 容器 —— 图表清单的
 * `data-caption-list` 条目复用 toc-lN 样式类,不限定会把清单条目混进目录条目。
 * 文档无该标记(外部/旧产物)时退回全文,保持旧口径。
 * @param {string} html pdf HTML 文档
 * @returns {{level: number, id: string}[]} 目录条目
 */
export function pdfTocItems(html) {
  const list = /<ul\b[^>]*\bdata-toc\b[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  const region = list?.[1] ?? html;
  /** @type {{level: number, id: string}[]} */
  const items = [];
  for (const m of region.matchAll(/<li class="toc-l(\d)"><a href="#([^"]+)"/g)) {
    const level = m[1];
    const id = m[2];
    if (level !== undefined && id !== undefined) items.push({ level: Number(level), id });
  }
  return items;
}

/**
 * pdf 图表清单条目(锚点 + 条目文本),按文档顺序(图目录条目在前、表目录在后)。
 * 条目文本是 escapeHtml 后的原文(消费方断言中文/编号,不涉实体还原)。
 * @param {string} html pdf HTML 文档
 * @returns {{anchor: string, text: string}[]} 清单条目(无清单页为空数组)
 */
export function pdfCaptionListItems(html) {
  /** @type {{anchor: string, text: string}[]} */
  const items = [];
  for (const ul of html.matchAll(/<ul\b[^>]*\bdata-caption-list\b[^>]*>([\s\S]*?)<\/ul>/g)) {
    for (const li of (ul[1] ?? "").matchAll(/<li class="toc-l1"><a href="#([^"]+)">([\s\S]*?)<\/a><\/li>/g)) {
      const anchor = li[1];
      const text = li[2];
      if (anchor !== undefined && text !== undefined) items.push({ anchor, text });
    }
  }
  return items;
}

/**
 * pdf 正文标题层级与锚点 id。
 * @param {string} html pdf HTML 文档
 * @returns {{level: number, id: string}[]} 正文标题
 */
export function pdfHeadingIds(html) {
  /** @type {{level: number, id: string}[]} */
  const heads = [];
  for (const m of html.matchAll(/<h([1-6]) id="([^"]+)"/g)) {
    const level = m[1];
    const id = m[2];
    if (level !== undefined && id !== undefined) heads.push({ level: Number(level), id });
  }
  return heads;
}

/**
 * 统计子串在产物文本中的出现次数(数量型断言的通用口径:两侧都用同一函数计数,
 * 免得一处数「包含的段落数」、另一处数「出现次数」而得出不可比的结论)。
 * @param {string} haystack 被统计文本
 * @param {string} needle 子串
 * @returns {number} 出现次数
 */
export function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}
