// @ts-check
/**
 * OOXML 部件访问层测试(src/core/ooxml/parts.ts):
 * - 解包成功的包:has / readText / readBinary / listParts 四条口径
 * - 目录条目不算部件;缺部件读出 null(不抛)
 * - 非 zip / 损坏字节 ⇒ openDocxPackage 返回 null(不抛),沿用浅导入 v1 的降级口径
 * 纯函数段(只读内存中的 zip),无产物输出。
 */
import JSZip from "jszip";
import { openDocxPackage } from "../../../dist/core/ooxml/parts.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "OOXML 部件访问层测试:解包/读文本/读二进制/列部件 + 损坏包降级为 null",
};
export const fixtures = null;

/**
 * 解包并断言成功(失败即抛,后续断言才有意义)。
 * @param {Uint8Array} buffer zip 字节
 * @returns {Promise<import("../../../dist/core/ooxml/parts.js").DocxPackage>} 包访问器
 */
async function openOrThrow(buffer) {
  const pkg = await openDocxPackage(buffer);
  assert(pkg !== null, "合法 zip 应解包成功");
  if (pkg === null) throw new Error("解包失败(前置断言已报)");
  return pkg;
}

export async function run() {
  const suite = createCaseSuite();

  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document/>");
  zip.file("word/styles.xml", "<w:styles/>");
  zip.file("word/media/image1.png", new Uint8Array([1, 2, 3]));
  const buffer = await zip.generateAsync({ type: "uint8array" });
  const pkg = await openOrThrow(buffer);

  await suite.case("has:存在的部件为真、不存在的部件为假", () => {
    assert(pkg.has("word/document.xml"), "word/document.xml 应存在");
    assert(pkg.has("word/media/image1.png"), "word/media/image1.png 应存在");
    assert(!pkg.has("word/numbering.xml"), "word/numbering.xml 不应存在");
  });

  await suite.case("readText:读回部件原文、缺部件为 null", async () => {
    const text = await pkg.readText("word/styles.xml");
    assert(text === "<w:styles/>", `styles.xml 读回应为 <w:styles/>,实际 ${text}`);
    const missing = await pkg.readText("word/numbering.xml");
    assert(missing === null, `缺部件应读出 null,实际 ${missing}`);
  });

  await suite.case("readBinary:读回字节、缺部件为 null", async () => {
    const bytes = await pkg.readBinary("word/media/image1.png");
    assert(bytes !== null, "图片部件应读出字节");
    if (bytes !== null) {
      assert(bytes.length === 3, `图片字节长度应为 3,实际 ${bytes.length}`);
      assert(bytes[0] === 1 && bytes[2] === 3, `图片字节内容应为 [1,2,3],实际 ${Array.from(bytes)}`);
    }
    const missing = await pkg.readBinary("word/media/none.png");
    assert(missing === null, `缺部件应读出 null,实际 ${missing}`);
  });

  await suite.case("listParts:列出全部部件且不含目录条目", () => {
    const parts = pkg.listParts();
    assert(parts.length === 3, `部件数应为 3,实际 ${parts.length}:${parts.join(",")}`);
    assert(parts.includes("word/document.xml"), "部件清单应含 word/document.xml");
    assert(!parts.some((part) => part.endsWith("/")), `部件清单不应含目录条目:${parts.join(",")}`);
  });

  await suite.case("openDocxPackage:非 zip 字节返回 null(不抛)", async () => {
    const broken = await openDocxPackage(new Uint8Array([1, 2, 3, 4, 5]));
    assert(broken === null, `非 zip 字节应返回 null,实际 ${broken === null ? "null" : "包"}`);
  });

  await suite.case("openDocxPackage:空字节返回 null(不抛)", async () => {
    const empty = await openDocxPackage(new Uint8Array());
    assert(empty === null, "空字节应返回 null");
  });

  console.log("[ok] OOXML 部件访问层:解包/读文本/读二进制/列部件 + 损坏包降级 断言通过");
  return { cases: suite.results };
}
