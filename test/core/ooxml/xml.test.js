// @ts-check
/**
 * OOXML XML 扫描器测试(src/core/ooxml/xml.ts):
 * - 属性顺序无关(本层存在的理由:前身 template-import.ts 的正则写法在属性换序时即失效)
 * - 命名空间前缀不写死:元素与属性都按本地名取;全名与本地名不一致时不误取
 * - 实体解码(五个具名 + 十进制/十六进制数字实体)、自闭合、CDATA、注释与声明跳过
 * - 畸形输入尽力解析不抛
 * 纯函数段,无产物输出。
 */
import {
  attrOf,
  boolAttr,
  childOf,
  childrenOf,
  decodeEntities,
  findDescendant,
  findDescendants,
  localNameOf,
  numAttr,
  parseXml,
} from "../../../dist/core/ooxml/xml.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "OOXML XML 扫描器测试:属性顺序无关/前缀不写死/实体解码/自闭合/畸形降级",
};
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();

  await suite.case("parseXml:解析嵌套结构并按本地名取子元素", () => {
    const root = parseXml(`<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p/></w:body></w:document>`);
    assert(root !== null, "应解析出根元素");
    if (root === null) return;
    assert(root.localName === "document", `根元素本地名应为 document,实际 ${root.localName}`);
    const body = childOf(root, "body");
    assert(body !== null, "应取到 body 子元素");
    assert(childrenOf(root, "body").length === 1, "body 子元素应恰有一个");
    assert(childrenOf(root, "p").length === 0, "根下不应有 p 子元素(p 在 body 内)");
  });

  await suite.case("属性顺序无关:换序后取值不变", () => {
    const a = parseXml(`<w:style w:type="paragraph" w:styleId="Heading1"/>`);
    const b = parseXml(`<w:style w:styleId="Heading1" w:type="paragraph"/>`);
    assert(a !== null && b !== null, "两段都应解析成功");
    if (a === null || b === null) return;
    assert(attrOf(a, "styleId") === "Heading1", "第一种写法应取到 styleId");
    assert(attrOf(b, "styleId") === "Heading1", "换序后仍应取到 styleId");
    assert(attrOf(b, "type") === "paragraph", "换序后仍应取到 type");
  });

  await suite.case("前缀不写死:换前缀后按本地名仍取得到", () => {
    const root = parseXml(`<doc:document xmlns:doc="urn:d"><doc:body/></doc:document>`);
    assert(root !== null, "应解析成功");
    if (root === null) return;
    assert(root.localName === "document", "本地名应剥掉前缀");
    assert(childOf(root, "body") !== null, "换前缀后仍应按本地名取到 body");
    assert(localNameOf("w:styles") === "styles", "localNameOf 应剥掉前缀");
    assert(localNameOf("styles") === "styles", "无前缀时原样返回");
  });

  await suite.case("全名与本地名不一致时不误取(r:id 与 w:id 同名)", () => {
    const root = parseXml(`<w:p r:id="rId7" w:id="9"/>`);
    assert(root !== null, "应解析成功");
    if (root === null) return;
    assert(attrOf(root, "r:id") === "rId7", "按全名应取到 rId7");
    assert(attrOf(root, "id") === "rId7", "按本地名应取到首个同本地名属性");
    assert(attrOf(root, "w:id") === undefined, "按全名 w:id 不应误取 r:id 的值");
  });

  await suite.case("实体解码:五个具名 + 十进制 + 十六进制", () => {
    assert(decodeEntities("a &amp; b") === "a & b", "&amp; 应解码");
    assert(decodeEntities("&lt;p&gt;") === "<p>", "&lt;/&gt; 应解码");
    assert(decodeEntities("&quot;q&quot;") === '"q"', "&quot; 应解码");
    assert(decodeEntities("&apos;a&apos;") === "'a'", "&apos; 应解码");
    assert(decodeEntities("&#x4e2d;") === "中", "十六进制数字实体应解码");
    assert(decodeEntities("&#20013;") === "中", "十进制数字实体应解码");
    assert(decodeEntities("&unknown;") === "&unknown;", "未知实体应原样保留");
    const root = parseXml(`<w:t>a &amp; b &#x6587;</w:t>`);
    assert(root !== null, "应解析成功");
    if (root !== null) assert(root.text === "a & b 文", `文本应解码为「a & b 文」,实际 ${root.text}`);
  });

  await suite.case("自闭合元素与 xml:space 属性", () => {
    const root = parseXml(`<w:p><w:r><w:br/><w:t xml:space="preserve"> 空格  </w:t></w:r></w:p>`);
    assert(root !== null, "应解析成功");
    if (root === null) return;
    const run = childOf(root, "r");
    assert(run !== null, "应取到 r");
    const t = childOf(run, "t");
    assert(t !== null, "应取到 t");
    assert(t !== null && t.text === " 空格  ", `xml:space=preserve 的文本不应被裁剪,实际 ${t?.text}`);
    assert(childOf(run, "br") !== null, "自闭合的 w:br 应成元素");
    assert(attrOf(t, "space") === "preserve", "xml:space 属性应可读(按本地名)");
  });

  await suite.case("CDATA、注释与声明被正确处理", () => {
    const root = parseXml(`<?xml version="1.0"?><!-- 注释 --><w:t><![CDATA[<raw>]]></w:t>`);
    assert(root !== null, "应解析成功");
    if (root !== null) assert(root.text === "<raw>", `CDATA 文本应原样保留,实际 ${root.text}`);
  });

  await suite.case("数值与布尔属性的取值口径", () => {
    const root = parseXml(`<w:x w:val="42" w:on="1" w:off="0" w:bad="abc"/>`);
    assert(root !== null, "应解析成功");
    if (root === null) return;
    assert(numAttr(root, "val") === 42, "数值属性应读出 42");
    assert(numAttr(root, "bad") === undefined, "非数值属性应读出 undefined");
    assert(boolAttr(root, "on") === true, "on=1 应读出 true");
    assert(boolAttr(root, "off") === false, "off=0 应读出 false");
    assert(boolAttr(root, "bad") === undefined, "无法判定的布尔值应读出 undefined");
    assert(boolAttr(root, "missing") === undefined, "缺属性应读出 undefined");
  });

  await suite.case("子树查找:findDescendant / findDescendants", () => {
    const root = parseXml(`<w:drawing><wp:inline><wp:extent cx="10" cy="20"/><a:graphic><a:blip r:embed="rId1"/></a:graphic></wp:inline></w:drawing>`);
    assert(root !== null, "应解析成功");
    if (root === null) return;
    const extent = findDescendant(root, "extent");
    assert(extent !== null, "应找到 extent");
    assert(attrOf(extent, "cx") === "10", "extent 的 cx 应为 10");
    const blip = findDescendant(root, "blip");
    assert(attrOf(blip, "embed") === "rId1", "blip 的 embed 应为 rId1");
    assert(findDescendants(root, "extent").length === 1, "子树里 extent 应恰有一个");
    assert(findDescendant(root, "nothing") === null, "不存在的名字应返回 null");
  });

  await suite.case("畸形输入:不抛,尽力解析或返回 null", () => {
    const broken = parseXml(`<w:p><w:r><w:t>未闭合`);
    assert(broken !== null, "未闭合标签应尽力解析出已有部分");
    assert(parseXml("") === null, "空串应返回 null");
    assert(parseXml("不是 xml") === null, "非 XML 文本应返回 null");
    const partial = parseXml(`<w:p><w:r/></w:p><w:extra/>`);
    assert(partial !== null, "多根元素应取到第一个");
    if (partial !== null) assert(partial.localName === "p", "应取到第一个根元素 p");
  });

  console.log("[ok] OOXML XML 扫描器:属性顺序无关/前缀不写死/实体解码/自闭合/畸形降级 断言通过");
  return { cases: suite.results };
}
