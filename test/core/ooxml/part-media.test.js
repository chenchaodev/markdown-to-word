// @ts-check
/**
 * 媒体部件访问测试(src/core/ooxml/part-media.ts):
 * - 列举包内媒体部件、按部件名读字节
 * - rId → 媒体部件路径的还原(内部媒体可还原;外部关系与非媒体目标 ⇒ null)
 * - 本层只给字节与路径,不落盘(落盘在 core 之外)
 */
import JSZip from "jszip";
import { listMediaParts, mediaPartForRelationship, readMediaPart } from "../../../dist/core/ooxml/part-media.js";
import { parseRelationships } from "../../../dist/core/ooxml/part-rels.js";
import { openDocxPackage } from "../../../dist/core/ooxml/parts.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "媒体部件访问测试:列举/读字节 + rId→媒体部件路径还原 + 外部与非媒体的 null 降级",
};
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();

  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document/>");
  zip.file("word/media/image1.png", new Uint8Array([10, 20, 30]));
  zip.file("word/media/image2.png", new Uint8Array([40]));
  zip.file("word/_rels/document.xml.rels", "<Relationships/>");
  const buffer = await zip.generateAsync({ type: "uint8array" });
  const pkg = await openDocxPackage(buffer);
  assert(pkg !== null, "包应解包成功");
  if (pkg === null) throw new Error("解包失败(前置断言已报)");

  await suite.case("listMediaParts:只列 word/media/ 下的部件", () => {
    const media = listMediaParts(pkg);
    assert(media.length === 2, `媒体部件应有 2 个,实际 ${media.length}`);
    assert(media.includes("word/media/image1.png"), "应含 image1.png");
    assert(!media.includes("word/document.xml"), "不应含非媒体部件");
  });

  await suite.case("readMediaPart:读回字节、缺部件为 null", async () => {
    const bytes = await readMediaPart(pkg, "word/media/image1.png");
    assert(bytes !== null, "图片应读出字节");
    assert(bytes?.length === 3, `字节长度应为 3,实际 ${bytes?.length}`);
    const missing = await readMediaPart(pkg, "word/media/none.png");
    assert(missing === null, "缺部件应读出 null");
  });

  await suite.case("mediaPartForRelationship:内部媒体关系可还原成部件路径", () => {
    const rels = parseRelationships(
      `<Relationships xmlns="urn:rel">` +
        `<Relationship Id="rId1" Type="urn:image" Target="media/image1.png"/>` +
        `<Relationship Id="rId2" Type="urn:hyperlink" Target="https://example.com" TargetMode="External"/>` +
        `<Relationship Id="rId3" Type="urn:styles" Target="styles.xml"/>` +
        `</Relationships>`,
    );
    assert(mediaPartForRelationship(pkg, rels, "rId1") === "word/media/image1.png", "rId1 应还原成媒体部件路径");
    assert(mediaPartForRelationship(pkg, rels, "rId2") === null, "外部关系不应还原成媒体部件");
    assert(mediaPartForRelationship(pkg, rels, "rId3") === null, "非媒体目标不应还原成媒体部件");
    assert(mediaPartForRelationship(pkg, rels, "rId404") === null, "未知 rId 应返回 null");
    assert(mediaPartForRelationship(pkg, undefined, "rId1") === null, "缺关系表应返回 null");
  });

  await suite.case("mediaPartForRelationship:引用指向包内不存在的部件 ⇒ null", () => {
    const rels = parseRelationships(
      `<Relationships xmlns="urn:rel"><Relationship Id="rId9" Type="urn:image" Target="media/missing.png"/></Relationships>`,
    );
    assert(mediaPartForRelationship(pkg, rels, "rId9") === null, "包内无此部件时应返回 null");
  });

  console.log("[ok] 媒体部件访问:列举/读字节 + rId 还原 + null 降级 断言通过");
  return { cases: suite.results };
}
