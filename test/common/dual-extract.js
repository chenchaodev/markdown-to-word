// @ts-check
/**
 * 双管线(docx ↔ pdf)产物提取器:测试树共享的单源纯函数层。
 *
 * 职责边界:只做「产物字节 / HTML → 可断言的结构化事实」,不含判定(哪一侧该是什么、
 * 差异是否在契约内)与阈值(预算取值 / 白名单 / 正则族在 core 各有单源模块)。判定与
 * 阈值留在消费段,避免测试关注点反向渗进提取器。
 *
 * 为何下沉到 test/common(而非留在差异矩阵段):
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
 * 题注锚点(fig/tab/eq-)同形 w:anchor 但不是目录条目,须排除——否则目录断言会把
 * 题注跳转当成标题条目。
 * @param {string} xml document.xml 文本
 * @returns {string[]} 标题 slug 锚点(排除 fig/tab/eq 题注锚点)
 */
export function docxTocAnchors(xml) {
  return [...xml.matchAll(/<w:hyperlink w:history="1" w:anchor="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((a) => a !== undefined)
    .filter((a) => !/^(fig|tab|eq)-/.test(a));
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
 * @param {string} xml document.xml 文本
 * @param {string} anchor w:anchor 目标名
 * @returns {string} 片段文本(无该链接时为空串)
 */
export function docxLinkBody(xml, anchor) {
  const start = xml.indexOf(`w:anchor="${anchor}"`);
  if (start < 0) return "";
  const end = xml.indexOf("</w:hyperlink>", start);
  return end < 0 ? "" : xml.slice(start, end);
}

/**
 * pdf 目录条目(h1-h3 → toc-lN)。
 * @param {string} html pdf HTML 文档
 * @returns {{level: number, id: string}[]} 目录条目
 */
export function pdfTocItems(html) {
  /** @type {{level: number, id: string}[]} */
  const items = [];
  for (const m of html.matchAll(/<li class="toc-l(\d)"><a href="#([^"]+)"/g)) {
    const level = m[1];
    const id = m[2];
    if (level !== undefined && id !== undefined) items.push({ level: Number(level), id });
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
